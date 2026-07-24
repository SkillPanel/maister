import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { extractArchiveFile, inspectArchiveFile } from "../../lib/launcher/archive-port.mjs";
import { validateExtractedRelease } from "../../lib/launcher/extracted-release.mjs";
import { e3AttestationDigest, portableCoreTreeHash } from "../../plugins/maister/lib/distribution/e3-attestation.mjs";
import { hashTree } from "../../plugins/maister/lib/distribution/hash-tree.mjs";

const SOURCE_COMMIT = "a".repeat(40);
const ARCHIVE_SHA256 = "b".repeat(64);
const VERSION = "2.2.1";
const REQUIRED_RUNTIME_FILES = [
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
];

function writeOctal(buffer, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0") + "\0";
  buffer.write(encoded, offset, length, "ascii");
}

function tarEntry(name, contents = Buffer.alloc(0), {
  type = "0",
  mode = 0o644,
  uid = 0,
  gid = 0,
  uname = "",
  gname = "",
  linkname = "",
  prefix = "",
  declaredSize = null,
} = {}) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, uid);
  writeOctal(header, 116, 8, gid);
  writeOctal(header, 124, 12, type === "5" ? 0 : declaredSize ?? contents.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write(linkname, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "latin1");
  header.write("00", 263, 2, "ascii");
  header.write(uname, 265, 32, "utf8");
  header.write(gname, 297, 32, "utf8");
  header.write(prefix, 345, 155, "utf8");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return Buffer.concat([header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)]);
}

function archive(entries) {
  return zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]), { level: 6, mtime: 0 });
}

function withArchive(bytes, operation) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maister-archive-test-"));
  const source = path.join(scratch, "archive.tar.gz");
  fs.writeFileSync(source, bytes, { mode: 0o600 });
  return Promise.resolve(operation({ scratch, source })).finally(() => fs.rmSync(scratch, { recursive: true, force: true }));
}

function writeFixtureFile(root, relative, contents = `${relative}\n`, mode = 0o644) {
  const destination = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  fs.writeFileSync(destination, contents, { mode });
  fs.chmodSync(destination, mode);
}

function candidateFixture(root, target = "codex") {
  const pluginRoot = path.join(root, "plugins", "maister");
  for (const relative of REQUIRED_RUNTIME_FILES) writeFixtureFile(pluginRoot, relative, undefined, relative.endsWith("maister-install.mjs") ? 0o755 : 0o644);
  writeFixtureFile(pluginRoot, `overlays/${target}/overlay.yml`, "schema_version: 1\n");
  writeFixtureFile(pluginRoot, `overlays/${target}/inventory.yml`, "schema_version: 1\n");
  writeFixtureFile(pluginRoot, "common/runtime.txt", "portable core\n");
  const portableDigest = portableCoreTreeHash(root);
  const attestation = {
    schema_version: 1,
    kind: "maister/e3-portable-core",
    test_command: "make test-core",
    result: "passed",
    source_commit: SOURCE_COMMIT,
    source_version: VERSION,
    portable_core_tree_hash: portableDigest,
    scenario: "portable-core",
    scenario_version: "1",
    tested_at: "2026-07-20T10:00:00.000Z",
    expires_at: "2026-07-21T10:00:00.000Z",
    artifact_digest: portableDigest,
  };
  const attestationBytes = Buffer.from(`${JSON.stringify(attestation)}\n`);
  writeFixtureFile(pluginRoot, ".maister-e3-attestation.json", attestationBytes);
  const contentHash = hashTree(root, { ignore: (relative) => relative === "plugins/maister/.maister-source.json" }).contentHash;
  writeFixtureFile(pluginRoot, ".maister-source.json", `${JSON.stringify({
    schema_version: 1,
    source_version: VERSION,
    source_commit: SOURCE_COMMIT,
    content_hash: contentHash,
  })}\n`);
  return {
    attestation,
    attestationBytes,
    contentHash,
    portableDigest,
  };
}

function candidateInput(root, fixture, overrides = {}) {
  return {
    root,
    target: "codex",
    version: VERSION,
    packageCommit: SOURCE_COMMIT,
    releaseTargetCommit: SOURCE_COMMIT,
    now: "2026-07-20T12:00:00.000Z",
    asset: {
      id: 42,
      name: "maister-codex.tar.gz",
      size: 1234,
      digest: `sha256:${ARCHIVE_SHA256}`,
    },
    plan: Object.freeze({
      schemaVersion: 1,
      archiveSha256: ARCHIVE_SHA256,
      counters: Object.freeze({ compressedBytes: 1234, expandedTarBytes: 4096, regularFileBytes: 1024, entries: 20, regularFiles: 16, directories: 4 }),
      entries: Object.freeze([]),
    }),
    sidecars: Object.freeze({
      archiveSha256: ARCHIVE_SHA256,
      sourceCommit: SOURCE_COMMIT,
      e3AttestationDigest: e3AttestationDigest(fixture.attestation),
      e3AttestationSha256: crypto.createHash("sha256").update(fixture.attestationBytes).digest("hex"),
    }),
    ...overrides,
  };
}

test("streaming inspection produces exact digests and a deeply immutable plan before extraction", async () => {
  const bytes = archive([
    tarEntry("plugins/maister/", Buffer.alloc(0), { type: "5", mode: 0o755 }),
    tarEntry("plugins/maister/bin/", Buffer.alloc(0), { type: "5", mode: 0o755 }),
    tarEntry("plugins/maister/bin/maister-install.mjs", Buffer.from("#!/usr/bin/env node\n"), { mode: 0o755 }),
  ]);
  await withArchive(bytes, async ({ scratch, source }) => {
    const plan = await inspectArchiveFile(source);
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.counters), true);
    assert.equal(Object.isFrozen(plan.entries), true);
    assert.equal(plan.entries.every(Object.isFrozen), true);
    assert.deepEqual(plan.counters, {
      compressedBytes: bytes.length,
      expandedTarBytes: 3 * 512 + 512 + 1024,
      regularFileBytes: 20,
      entries: 3,
      regularFiles: 1,
      directories: 2,
    });
    assert.equal(plan.archiveSha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(plan.entries.at(-1).sha256, crypto.createHash("sha256").update("#!/usr/bin/env node\n").digest("hex"));

    const target = path.join(scratch, "extract");
    const extracted = await extractArchiveFile(plan, source, target);
    assert.equal(fs.readFileSync(path.join(extracted.root, "plugins/maister/bin/maister-install.mjs"), "utf8"), "#!/usr/bin/env node\n");
  });
});

test("inspection rejects traversal, links, ownership, modes, collisions, and extensions without writes", async () => {
  const hostile = [
    archive([tarEntry("plugins/maister/../escape")]),
    archive([tarEntry("plugins/maister/link", Buffer.alloc(0), { type: "2" })]),
    archive([tarEntry("plugins/maister/world", Buffer.from("x"), { mode: 0o666 })]),
    archive([tarEntry("plugins/maister/A"), tarEntry("plugins/maister/a")]),
    archive([tarEntry("plugins/maister/pax", Buffer.from("path=x\n"), { type: "x" })]),
    archive([tarEntry("plugins/maister/sparse", Buffer.alloc(0), { type: "S" })]),
    archive([tarEntry("plugins/maister/owner", Buffer.from("x"), { uname: "root" })]),
    archive([tarEntry("plugins/maister/Case/one"), tarEntry("plugins/maister/case/two")]),
    archive([tarEntry("plugins/maister/.git/config")]),
  ];
  for (const bytes of hostile) {
    await withArchive(bytes, async ({ scratch, source }) => {
      await assert.rejects(() => inspectArchiveFile(source), { kind: /E_LAUNCHER_ARCHIVE/u });
      assert.deepEqual(fs.readdirSync(scratch), ["archive.tar.gz"]);
    });
  }
});

test("inspection accepts every executable runtime file shipped in the release", async () => {
  const bytes = archive([
    tarEntry("plugins/maister/bin/maister-agent-gate.mjs", Buffer.from("gate\n"), { mode: 0o755 }),
    tarEntry("plugins/maister/skills/init/bin/reconcile-gate-config.sh", Buffer.from("#!/bin/sh\n"), { mode: 0o755 }),
  ]);
  await withArchive(bytes, async ({ source }) => {
    const plan = await inspectArchiveFile(source);
    assert.equal(plan.counters.regularFiles, 2);
    assert.equal(plan.entries.every((entry) => entry.mode === 0o755), true);
  });
});

test("inspection rejects concatenated gzip members and every trailing byte", async () => {
  const valid = archive([tarEntry("plugins/maister/file", Buffer.from("x"))]);
  for (const bytes of [Buffer.concat([valid, valid]), Buffer.concat([valid, Buffer.from("surprise")]), Buffer.concat([valid, Buffer.alloc(512)])]) {
    await withArchive(bytes, ({ source }) => assert.rejects(() => inspectArchiveFile(source), { kind: "E_LAUNCHER_ARCHIVE_GZIP" }));
  }
});

test("inspection rejects cross-platform paths, ownership, and unsupported topology", async () => {
  const hostile = [
    "plugins/maister//empty-segment",
    "plugins/maister\\windows-separator",
    "plugins/maister/C:/drive-path",
    "//server/share",
  ];
  for (const name of hostile) {
    await withArchive(archive([tarEntry(name)]), ({ source }) => assert.rejects(() => inspectArchiveFile(source), { kind: /E_LAUNCHER_ARCHIVE/u }));
  }
  await withArchive(archive([tarEntry("plugins/maister/uid", Buffer.from("x"), { uid: 1 })]),
    ({ source }) => assert.rejects(() => inspectArchiveFile(source), { kind: "E_LAUNCHER_ARCHIVE_OWNER" }));
  await withArchive(archive([
    tarEntry("plugins/maister/file", Buffer.from("x")),
    tarEntry("plugins/maister/file/nested", Buffer.from("x")),
  ]), ({ source }) => assert.rejects(() => inspectArchiveFile(source), { kind: "E_LAUNCHER_ARCHIVE_COLLISION" }));
});

test("inspection rejects malformed checksums, truncation, unsafe metadata, and size limits", async () => {
  const invalidChecksumTar = Buffer.concat([tarEntry("plugins/maister/file", Buffer.from("x")), Buffer.alloc(1024)]);
  invalidChecksumTar[148] ^= 1;
  const badGzipChecksum = archive([tarEntry("plugins/maister/file", Buffer.from("x"))]);
  badGzipChecksum[badGzipChecksum.length - 8] ^= 1;
  const hostile = [
    [zlib.gzipSync(invalidChecksumTar), "E_LAUNCHER_ARCHIVE_HEADER"],
    [zlib.gzipSync(Buffer.alloc(100)), "E_LAUNCHER_ARCHIVE_HEADER"],
    [badGzipChecksum, "E_LAUNCHER_ARCHIVE_GZIP"],
    [archive([tarEntry("plugins/maister/too-large", Buffer.alloc(0), { declaredSize: 128 * 1024 * 1024 + 1 })]), "E_LAUNCHER_ARCHIVE_LIMIT"],
    [archive([tarEntry("plugins/maister/setuid", Buffer.from("x"), { mode: 0o4644 })]), "E_LAUNCHER_ARCHIVE_MODE"],
    [archive([tarEntry("plugins/maister/type-bits", Buffer.from("x"), { mode: 0o100644 })]), "E_LAUNCHER_ARCHIVE_MODE"],
    [archive([tarEntry("plugins/maister/control-\u0001")]), "E_LAUNCHER_ARCHIVE_PATH"],
    [archive([tarEntry("plugins/maister/caf\u00e9"), tarEntry("plugins/maister/cafe\u0301")]), "E_LAUNCHER_ARCHIVE_COLLISION"],
    [archive([tarEntry("plugins/maister/device", Buffer.alloc(0), { type: "3" })]), "E_LAUNCHER_ARCHIVE_TYPE"],
  ];
  for (const [bytes, kind] of hostile) {
    await withArchive(bytes, ({ source }) => assert.rejects(() => inspectArchiveFile(source), { kind }));
  }
});

test("extraction refuses a pre-existing target", async () => {
  const bytes = archive([tarEntry("plugins/maister/file", Buffer.from("x"))]);
  await withArchive(bytes, async ({ scratch, source }) => {
    const plan = await inspectArchiveFile(source);
    const target = path.join(scratch, "existing");
    fs.mkdirSync(target);
    await assert.rejects(() => extractArchiveFile(plan, source, target), { kind: "E_LAUNCHER_ARCHIVE_TARGET" });
  });
});

test("extraction accepts only a plan produced by the pre-write inspector", async () => {
  const bytes = archive([tarEntry("plugins/maister/file", Buffer.from("x"))]);
  await withArchive(bytes, async ({ scratch, source }) => {
    const forgedPlan = Object.freeze({
      schemaVersion: 1,
      archiveSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      counters: Object.freeze({ compressedBytes: bytes.length }),
      entries: Object.freeze([]),
    });
    const target = path.join(scratch, "extract");
    await assert.rejects(() => extractArchiveFile(forgedPlan, source, target), { kind: "E_LAUNCHER_ARCHIVE_PLAN" });
    assert.equal(fs.existsSync(target), false);
  });
});

test("extraction rejects archive bytes not admitted by the inspection plan and cleans the root", async () => {
  const inspected = archive([tarEntry("plugins/maister/file", Buffer.from("good"))]);
  const substituted = archive([tarEntry("plugins/maister/file", Buffer.from("evil"))]);
  await withArchive(inspected, async ({ scratch, source }) => {
    const plan = await inspectArchiveFile(source);
    const substitutedPath = path.join(scratch, "substituted.tar.gz");
    const target = path.join(scratch, "extract");
    fs.writeFileSync(substitutedPath, substituted, { mode: 0o600 });
    await assert.rejects(() => extractArchiveFile(plan, substitutedPath, target), { kind: "E_LAUNCHER_ARCHIVE_INPUT" });
    assert.equal(fs.existsSync(target), false);
  });
});

test("candidate verification returns one deeply immutable integrity-only release descriptor", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-candidate-valid-"));
  try {
    const fixture = candidateFixture(root);
    const descriptor = await validateExtractedRelease(candidateInput(root, fixture));
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(Object.isFrozen(descriptor.asset), true);
    assert.equal(Object.isFrozen(descriptor.source), true);
    assert.equal(Object.isFrozen(descriptor.e3), true);
    assert.equal(Object.isFrozen(descriptor.counters), true);
    assert.equal(descriptor.publisherAuthenticated, false);
    assert.equal(descriptor.evidenceClass, "integrity-only");
    assert.equal(descriptor.releaseTag, "v2.2.1");
    assert.equal(descriptor.asset.sha256, ARCHIVE_SHA256);
    assert.equal(descriptor.source.commit, SOURCE_COMMIT);
    assert.equal(descriptor.source.contentHash, fixture.contentHash);
    assert.equal(descriptor.e3.portableCoreDigest, fixture.portableDigest);
    assert.equal(descriptor.selectedOverlay, "plugins/maister/overlays/codex");
    assert.equal(descriptor.installerRelativePath, "plugins/maister/bin/maister-install.mjs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidate verification fails closed when any archive, commit, runtime, source, or E3 observation disagrees", async () => {
  const cases = [
    ["package commit", (input) => ({ ...input, packageCommit: "c".repeat(40) }), "E_LAUNCHER_RELEASE_IDENTITY"],
    ["GitHub digest", (input) => ({ ...input, asset: { ...input.asset, digest: `sha256:${"d".repeat(64)}` } }), "E_LAUNCHER_DIGEST_MISMATCH"],
    ["sidecar digest", (input) => ({ ...input, sidecars: Object.freeze({ ...input.sidecars, archiveSha256: "e".repeat(64) }) }), "E_LAUNCHER_DIGEST_MISMATCH"],
    ["E3 digest", (input) => ({ ...input, sidecars: Object.freeze({ ...input.sidecars, e3AttestationDigest: "f".repeat(64) }) }), "E_LAUNCHER_E3_MISMATCH"],
  ];
  for (const [label, mutate, kind] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-candidate-reject-"));
    try {
      const fixture = candidateFixture(root);
      await assert.rejects(() => validateExtractedRelease(mutate(candidateInput(root, fixture))), { kind }, label);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-candidate-runtime-"));
  try {
    const fixture = candidateFixture(root);
    fs.rmSync(path.join(root, "plugins/maister/lib/distribution/agent-projector.mjs"));
    await assert.rejects(() => validateExtractedRelease(candidateInput(root, fixture)), { kind: "E_LAUNCHER_EXTRACTED_TOPOLOGY" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
