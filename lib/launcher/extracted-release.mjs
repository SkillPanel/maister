import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertUsableE3Attestation, e3AttestationDigest } from "../../plugins/maister/lib/distribution/e3-attestation.mjs";

const TARGET_ARCHIVES = Object.freeze({
  codex: "maister-codex.tar.gz",
  cursor: "maister-cursor.tar.gz",
  "kiro-cli": "maister-kiro-cli.tar.gz",
  pi: "maister-pi.tar.gz",
});
const INSTALLER_RELATIVE_PATH = "plugins/maister/bin/maister-install.mjs";
const REQUIRED_RUNTIME_FILES = Object.freeze([
  "agent-projection-v1.json",
  "agents/advisor.md",
  "bin/maister-install.mjs",
  "bin/project-agents.mjs",
  "lib/distribution/agent-projector.mjs",
  "skills/orchestrator-framework/bin/agent-runtime/agent-resolver.mjs",
  "skills/orchestrator-framework/bin/agent-runtime/create-runtime.mjs",
  "skills/orchestrator-framework/bin/agent-runtime/production-runtime.mjs",
  "skills/orchestrator-framework/bin/agent-runtime/production-owner.mjs",
  "bin/maister-agent-gate.mjs",
  "skills/orchestrator-framework/bin/agent-runtime/dispatch-task-preparer.mjs",
  "skills/orchestrator-framework/bin/agent-runtime/node-process-port.mjs",
  "skills/orchestrator-framework/bin/agent-runtime/host-adapters/exact-native.mjs",
]);
const SOURCE_MANIFEST_FIELDS = Object.freeze(["content_hash", "schema_version", "source_commit", "source_version"]);
const SHA256 = /^[0-9a-f]{64}$/u;
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const MAX_JSON_BYTES = 256 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;

function validationError(kind, message, details = {}, cause) {
  const error = new Error(message, cause === undefined ? {} : { cause });
  error.kind = kind;
  error.details = details;
  throw error;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function compareEntries(left, right) {
  const foldedLeft = left.path.toLocaleLowerCase("en-US");
  const foldedRight = right.path.toLocaleLowerCase("en-US");
  return foldedLeft < foldedRight ? -1 : foldedLeft > foldedRight ? 1 : left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function exactObjectFields(value, fields, kind, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) validationError(kind, `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    validationError(kind, `${label} has unknown or missing fields`, { expected, actual });
  }
}

function rootIdentity(root) {
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", "extracted release root is missing or unsafe");
  return Object.freeze({ dev: stat.dev, ino: stat.ino, realpath: fs.realpathSync.native(root) });
}

function assertRootIdentity(root, expected) {
  const actual = rootIdentity(root);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.realpath !== expected.realpath) {
    validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", "extracted release root identity changed during validation");
  }
}

async function openRegularNoFollow(filePath, label) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024) validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", `${label} is missing or unsafe`);
    return { handle, stat };
  } catch (cause) {
    await handle?.close();
    if (cause?.kind) throw cause;
    validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", `${label} is missing or unsafe`, { path: filePath }, cause);
  }
}

async function hashRegularFile(filePath, label) {
  const { handle, stat: before } = await openRegularNoFollow(filePath, label);
  try {
    const hash = crypto.createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: STREAM_CHUNK_BYTES })) hash.update(chunk);
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", `${label} changed while hashing`, { path: filePath });
    }
    return { sha256: hash.digest("hex"), size: before.size };
  } finally {
    await handle.close();
  }
}

async function readJsonNoFollow(filePath, label) {
  const { handle, stat: before } = await openRegularNoFollow(filePath, label);
  try {
    if (before.size > MAX_JSON_BYTES) validationError("E_LAUNCHER_EXTRACTED_SCHEMA", `${label} exceeds its size limit`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", `${label} changed while reading`, { path: filePath });
    }
    try {
      return { value: JSON.parse(bytes.toString("utf8")), bytes };
    } catch (cause) {
      validationError("E_LAUNCHER_EXTRACTED_SCHEMA", `${label} is not valid JSON`, {}, cause);
    }
  } finally {
    await handle.close();
  }
}

async function streamingTreeHash(root, { ignore = () => false } = {}) {
  const entries = [];
  async function visit(current, relative) {
    const names = await fs.promises.readdir(current);
    names.sort();
    for (const name of names) {
      const child = path.join(current, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      if (ignore(childRelative)) continue;
      const stat = await fs.promises.lstat(child);
      const mode = (stat.mode & 0o7777).toString(8).padStart(4, "0");
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", "extracted release contains an unsupported filesystem type", { path: childRelative });
      }
      if (stat.isDirectory()) {
        entries.push({ path: childRelative, type: "directory", mode });
        await visit(child, childRelative);
      } else {
        const hashed = await hashRegularFile(child, childRelative);
        entries.push({ path: childRelative, type: "file", mode, size: hashed.size, sha256: hashed.sha256 });
      }
    }
  }
  await visit(root, "");
  entries.sort(compareEntries);
  const canonical = entries.map((entry) => JSON.stringify(entry)).join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function requireIdentity({ version, packageCommit, releaseTargetCommit, sidecars, manifest }) {
  if (!/^\d+\.\d+\.\d+$/u.test(version ?? "")
    || !FULL_COMMIT.test(packageCommit ?? "")
    || !FULL_COMMIT.test(releaseTargetCommit ?? "")
    || packageCommit !== releaseTargetCommit
    || packageCommit !== sidecars?.sourceCommit
    || packageCommit !== manifest.source_commit
    || version !== manifest.source_version) {
    validationError("E_LAUNCHER_RELEASE_IDENTITY", "package, Release, sidecar, and archive source identity disagree");
  }
}

function requireArchiveEvidence({ target, asset, plan, sidecars }) {
  const expectedName = TARGET_ARCHIVES[target];
  const directAsset = asset?.direct === true;
  if (!expectedName
    || (!directAsset && (!Number.isSafeInteger(asset?.id) || asset.id <= 0))
    || asset.name !== expectedName
    || !Number.isSafeInteger(asset.size)
    || asset.size !== plan?.counters?.compressedBytes
    || !SHA256.test(plan?.archiveSha256 ?? "")) {
    validationError("E_LAUNCHER_RELEASE_IDENTITY", "selected archive identity does not match the inspected candidate");
  }
  if (sidecars?.archiveSha256 !== plan.archiveSha256) validationError("E_LAUNCHER_DIGEST_MISMATCH", "archive SHA-256 disagrees with required sidecars");
  if (asset.digest !== null && asset.digest !== undefined && asset.digest !== `sha256:${plan.archiveSha256}`) {
    validationError("E_LAUNCHER_DIGEST_MISMATCH", "GitHub asset digest disagrees with the streamed archive SHA-256");
  }
}

async function requireRuntimeClosure(pluginRoot, target) {
  for (const relative of REQUIRED_RUNTIME_FILES) await hashRegularFile(path.join(pluginRoot, ...relative.split("/")), `runtime closure ${relative}`);
  for (const required of ["overlay.yml", "inventory.yml"]) {
    await hashRegularFile(path.join(pluginRoot, "overlays", target, required), `selected overlay ${required}`);
  }
  for (const sibling of Object.keys(TARGET_ARCHIVES).filter((candidate) => candidate !== target)) {
    if (fs.lstatSync(path.join(pluginRoot, "overlays", sibling, "assets"), { throwIfNoEntry: false })) {
      validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", "release contains foreign target assets", { target: sibling });
    }
  }
}

export async function validateExtractedRelease({
  root,
  target,
  version,
  packageCommit,
  releaseTargetCommit,
  asset,
  plan,
  sidecars,
  now,
}) {
  if (!Object.hasOwn(TARGET_ARCHIVES, target)) validationError("E_LAUNCHER_RELEASE_IDENTITY", "selected target is unsupported", { target });
  const identity = rootIdentity(root);
  const topLevel = await fs.promises.readdir(root);
  if (topLevel.length !== 1 || topLevel[0] !== "plugins") validationError("E_LAUNCHER_EXTRACTED_TOPOLOGY", "release archive must have exactly the plugins top-level root");
  const pluginRoot = path.join(root, "plugins", "maister");
  await requireRuntimeClosure(pluginRoot, target);
  requireArchiveEvidence({ target, asset, plan, sidecars });

  const manifestPath = path.join(pluginRoot, ".maister-source.json");
  const { value: manifest } = await readJsonNoFollow(manifestPath, "source manifest");
  exactObjectFields(manifest, SOURCE_MANIFEST_FIELDS, "E_LAUNCHER_SOURCE_MANIFEST", "source manifest");
  if (manifest.schema_version !== 1 || !FULL_COMMIT.test(manifest.source_commit ?? "") || !SHA256.test(manifest.content_hash ?? "")) {
    validationError("E_LAUNCHER_SOURCE_MANIFEST", "source manifest fields are invalid");
  }
  requireIdentity({ version, packageCommit, releaseTargetCommit, sidecars, manifest });
  const observedContentHash = await streamingTreeHash(root, { ignore: (relative) => relative === "plugins/maister/.maister-source.json" });
  if (observedContentHash !== manifest.content_hash) validationError("E_LAUNCHER_SOURCE_MANIFEST", "source manifest content hash does not match extracted bytes");

  const attestationPath = path.join(pluginRoot, ".maister-e3-attestation.json");
  const { value: rawAttestation, bytes: attestationBytes } = await readJsonNoFollow(attestationPath, "E3 attestation");
  let attestation;
  try {
    attestation = assertUsableE3Attestation(rawAttestation, { now });
  } catch (cause) {
    validationError("E_LAUNCHER_E3_MISMATCH", "embedded E3 is invalid, failed, unavailable, or expired", {}, cause);
  }
  const portableCoreRoot = path.join(pluginRoot, "common");
  const portableCoreDigest = await streamingTreeHash(portableCoreRoot);
  if (attestation.source_commit !== manifest.source_commit
    || attestation.source_version !== version
    || attestation.portable_core_tree_hash !== portableCoreDigest
    || attestation.artifact_digest !== portableCoreDigest
    || e3AttestationDigest(attestation) !== sidecars?.e3AttestationDigest
    || crypto.createHash("sha256").update(attestationBytes).digest("hex") !== sidecars?.e3AttestationSha256) {
    validationError("E_LAUNCHER_E3_MISMATCH", "embedded E3, portable core, source manifest, and sidecars disagree");
  }
  assertRootIdentity(root, identity);

  const installerPath = path.join(root, ...INSTALLER_RELATIVE_PATH.split("/"));
  const selectedOverlay = `plugins/maister/overlays/${target}`;
  return deepFreeze({
    schemaVersion: 1,
    evidenceClass: "integrity-only",
    publisherAuthenticated: false,
    packageVersion: version,
    releaseTag: `v${version}`,
    releaseTargetCommit,
    target,
    root,
    rootIdentity: identity,
    asset: {
      id: asset.id,
      name: asset.name,
      size: asset.size,
      sha256: plan.archiveSha256,
      githubDigestPresent: asset.digest !== null && asset.digest !== undefined,
    },
    source: { version, commit: manifest.source_commit, contentHash: manifest.content_hash },
    e3: {
      digest: sidecars.e3AttestationDigest,
      sha256: sidecars.e3AttestationSha256,
      portableCoreDigest,
    },
    counters: plan.counters,
    selectedOverlay,
    installerRelativePath: INSTALLER_RELATIVE_PATH,
    installerPath,
    sourceCommit: manifest.source_commit,
    sourceVersion: version,
    sourceContentHash: manifest.content_hash,
    e3AttestationDigest: sidecars.e3AttestationDigest,
  });
}
