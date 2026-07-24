import crypto from "node:crypto";

export const REPOSITORY = "mateuszrapacz/maister";
export const API_HOST = "api.github.com";
export const DIRECT_RELEASE_HOST = "github.com";
export const REDIRECT_HOSTS = Object.freeze(new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]));
export const ASSET_BY_TARGET = Object.freeze({
  codex: "maister-codex.tar.gz",
  cursor: "maister-cursor.tar.gz",
  "kiro-cli": "maister-kiro-cli.tar.gz",
  pi: "maister-pi.tar.gz",
});
export const REQUIRED_ASSETS = Object.freeze([...Object.values(ASSET_BY_TARGET), "SHA256SUMS", "SBOM.cdx.json", "PROVENANCE.json"]);
export const RESOURCE_LIMITS = Object.freeze({
  release: 1024 * 1024,
  checksums: 64 * 1024,
  sbom: 8 * 1024 * 1024,
  provenance: 4 * 1024 * 1024,
  archive: 256 * 1024 * 1024,
});

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const MAX_TAG_PEEL_DEPTH = 8;
const PRIVATE_ACCESS_STATUSES = new Set([401, 403, 404]);
const SIDECAR_LIMIT_BY_NAME = Object.freeze({
  SHA256SUMS: RESOURCE_LIMITS.checksums,
  "SBOM.cdx.json": RESOURCE_LIMITS.sbom,
  "PROVENANCE.json": RESOURCE_LIMITS.provenance,
});

function releaseError(kind, message, details = {}) {
  const error = new Error(message);
  error.kind = kind;
  error.details = details;
  throw error;
}

function exactAssetMap(assets) {
  if (!Array.isArray(assets)) releaseError("E_LAUNCHER_RELEASE_ASSETS", "release assets must be an array");
  const byName = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset.name !== "string") releaseError("E_LAUNCHER_RELEASE_ASSETS", "release asset metadata is malformed");
    if (byName.has(asset.name)) releaseError("E_LAUNCHER_RELEASE_ASSETS", `release contains duplicate asset ${asset.name}`);
    byName.set(asset.name, asset);
  }
  for (const name of REQUIRED_ASSETS) {
    if (!byName.has(name)) releaseError("E_LAUNCHER_RELEASE_ASSETS", `release is missing required asset ${name}`);
  }
  return byName;
}

function validateAsset(asset, maximumBytes) {
  if (
    !Number.isSafeInteger(asset.id)
    || asset.id < 1
    || asset.state !== "uploaded"
    || !Number.isSafeInteger(asset.size)
    || asset.size < 1
    || asset.size > maximumBytes
  ) {
    releaseError("E_LAUNCHER_RELEASE_ASSETS", `release asset metadata is invalid for ${asset.name}`);
  }
  let parsed;
  try {
    parsed = new URL(asset.url);
  } catch {
    releaseError("E_LAUNCHER_RELEASE_ASSETS", `release asset API URL is invalid for ${asset.name}`);
  }
  const expectedPath = `/repos/${REPOSITORY}/releases/assets/${asset.id}`;
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== API_HOST
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== expectedPath
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    releaseError("E_LAUNCHER_RELEASE_ASSETS", `release asset API URL is invalid for ${asset.name}`);
  }
  return Object.freeze({
    id: asset.id,
    name: asset.name,
    state: asset.state,
    size: asset.size,
    url: parsed.href,
    digest: asset.digest ?? null,
  });
}

export function releaseMetadataUrl(version) {
  if (typeof version !== "string" || !STABLE_SEMVER.test(version)) {
    releaseError("E_LAUNCHER_RELEASE_IDENTITY", "package version must be one stable X.Y.Z release");
  }
  return `https://${API_HOST}/repos/${REPOSITORY}/releases/tags/v${version}`;
}

export function releaseTagReferenceUrl(version) {
  releaseMetadataUrl(version);
  return `https://${API_HOST}/repos/${REPOSITORY}/git/ref/tags/v${version}`;
}

export function directReleaseAssetUrl(version, name) {
  releaseMetadataUrl(version);
  if (!REQUIRED_ASSETS.includes(name)) {
    releaseError("E_LAUNCHER_RELEASE_ASSETS", `direct release asset is not allowlisted: ${name}`);
  }
  return `https://${DIRECT_RELEASE_HOST}/${REPOSITORY}/releases/download/v${version}/${name}`;
}

function directReleaseMetadata({ version, target }) {
  const assets = new Map(REQUIRED_ASSETS.map((name) => [name, Object.freeze({
    id: null,
    name,
    state: "uploaded",
    size: null,
    url: directReleaseAssetUrl(version, name),
    digest: null,
    direct: true,
  })]));
  const selectedName = ASSET_BY_TARGET[target];
  if (!selectedName) releaseError("E_LAUNCHER_RELEASE_ASSETS", "selected target archive metadata is invalid", { target });
  return Object.freeze({
    repository: REPOSITORY,
    tag: `v${version}`,
    target,
    selectedName,
    selected: assets.get(selectedName),
    sidecars: Object.freeze({
      checksums: assets.get("SHA256SUMS"),
      sbom: assets.get("SBOM.cdx.json"),
      provenance: assets.get("PROVENANCE.json"),
    }),
    assets,
    releaseTargetCommit: null,
    accessMode: "anonymous-direct",
    metadataUrl: `https://${DIRECT_RELEASE_HOST}/${REPOSITORY}/releases/tag/v${version}`,
  });
}

function annotatedTagUrl(sha) {
  if (!FULL_COMMIT.test(sha ?? "")) {
    releaseError("E_LAUNCHER_RELEASE_IDENTITY", "GitHub tag object has an invalid identity");
  }
  return `https://${API_HOST}/repos/${REPOSITORY}/git/tags/${sha}`;
}

function validatedTagObject(value, expectedRef = null) {
  if (expectedRef !== null && value?.ref !== expectedRef) {
    releaseError("E_LAUNCHER_RELEASE_IDENTITY", "GitHub tag reference does not match the exact release tag");
  }
  const object = value?.object;
  if (!object || !["commit", "tag"].includes(object.type) || !FULL_COMMIT.test(object.sha ?? "")) {
    releaseError("E_LAUNCHER_RELEASE_IDENTITY", "GitHub tag reference has an invalid target identity");
  }
  return object;
}

export function validateReleaseMetadata(value, { version, target }) {
  releaseMetadataUrl(version);
  const expectedTag = `v${version}`;
  if (
    !value
    || value.tag_name !== expectedTag
    || value.draft !== false
    || value.prerelease !== false
    || typeof value.published_at !== "string"
    || !Number.isFinite(Date.parse(value.published_at))
  ) {
    releaseError("E_LAUNCHER_RELEASE_IDENTITY", `GitHub release ${expectedTag} is absent or ineligible`);
  }
  const assets = exactAssetMap(value.assets);
  const selectedName = ASSET_BY_TARGET[target];
  if (!selectedName) {
    releaseError("E_LAUNCHER_RELEASE_ASSETS", "selected target archive metadata is invalid", { target, asset: selectedName });
  }
  const validatedAssets = new Map();
  for (const name of REQUIRED_ASSETS) {
    const maximumBytes = Object.hasOwn(SIDECAR_LIMIT_BY_NAME, name)
      ? SIDECAR_LIMIT_BY_NAME[name]
      : RESOURCE_LIMITS.archive;
    validatedAssets.set(name, validateAsset(assets.get(name), maximumBytes));
  }
  return Object.freeze({
    repository: REPOSITORY,
    tag: expectedTag,
    target,
    selectedName,
    selected: validatedAssets.get(selectedName),
    sidecars: Object.freeze({
      checksums: validatedAssets.get("SHA256SUMS"),
      sbom: validatedAssets.get("SBOM.cdx.json"),
      provenance: validatedAssets.get("PROVENANCE.json"),
    }),
    assets: validatedAssets,
  });
}

function accessError(status) {
  releaseError("E_LAUNCHER_RELEASE_ACCESS", "exact GitHub Release metadata is unavailable", {
    status: Number.isSafeInteger(status) ? status : null,
  });
}

export async function resolveReleaseMetadata({
  version,
  target,
  requestMetadata,
  resolveCredential,
}) {
  const metadataUrl = releaseMetadataUrl(version);
  const referenceUrl = releaseTagReferenceUrl(version);
  const request = (url, credential, attempt) => requestMetadata(Object.freeze({ url, credential, attempt }));
  const resolveWithCredential = async (credential, attempt) => {
    const metadataResponse = await request(metadataUrl, credential, attempt);
    if (metadataResponse?.status !== 200) return { status: metadataResponse?.status };
    const validatedRelease = validateReleaseMetadata(metadataResponse.value, { version, target });
    const referenceResponse = await request(referenceUrl, credential, attempt);
    if (referenceResponse?.status !== 200) return { status: referenceResponse?.status };
    let object = validatedTagObject(referenceResponse.value, `refs/tags/v${version}`);
    const visited = new Set();
    for (let depth = 0; object.type === "tag"; depth += 1) {
      if (depth >= MAX_TAG_PEEL_DEPTH || visited.has(object.sha)) {
        releaseError("E_LAUNCHER_RELEASE_IDENTITY", "GitHub annotated tag chain is cyclic or too deep");
      }
      visited.add(object.sha);
      const tagResponse = await request(annotatedTagUrl(object.sha), credential, attempt);
      if (tagResponse?.status !== 200) return { status: tagResponse?.status };
      object = validatedTagObject(tagResponse.value);
    }
    return { status: 200, validatedRelease, releaseTargetCommit: object.sha };
  };

  const anonymous = await resolveWithCredential(null, "anonymous");
  if (anonymous.status === 200) {
    return Object.freeze({
      ...anonymous.validatedRelease,
      releaseTargetCommit: anonymous.releaseTargetCommit,
      accessMode: "anonymous",
      metadataUrl,
    });
  }
  if (!PRIVATE_ACCESS_STATUSES.has(anonymous.status)) accessError(anonymous.status);
  const credential = await resolveCredential();
  if (credential?.kind !== "authenticated") {
    if (anonymous.status === 403) return directReleaseMetadata({ version, target });
    accessError(anonymous.status);
  }
  const authenticated = await resolveWithCredential(credential, "authenticated");
  if (authenticated.status !== 200) accessError(authenticated.status);
  return Object.freeze({
    ...authenticated.validatedRelease,
    releaseTargetCommit: authenticated.releaseTargetCommit,
    accessMode: "authenticated",
    metadataUrl,
  });
}

function parseJson(bytes, label) {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (cause) {
    const error = new Error(`${label} is not valid JSON`, { cause });
    error.kind = "E_LAUNCHER_SIDECAR";
    throw error;
  }
}

function uniqueByName(entries, label) {
  const result = new Map();
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.name !== "string" || result.has(entry.name)) releaseError("E_LAUNCHER_SIDECAR", `${label} contains ambiguous artifact names`);
    result.set(entry.name, entry);
  }
  return result;
}

export function verifySidecars({ archiveBytes, archiveSha256: observedArchiveSha256, assetName, checksumsBytes, sbomBytes, provenanceBytes, version }) {
  const archiveSha256 = observedArchiveSha256
    ?? crypto.createHash("sha256").update(archiveBytes).digest("hex");
  if (!/^[0-9a-f]{64}$/u.test(archiveSha256)) {
    releaseError("E_LAUNCHER_DIGEST_MISMATCH", "archive SHA-256 is missing or invalid", { asset: assetName });
  }
  const checksums = new Map();
  for (const line of Buffer.from(checksumsBytes).toString("utf8").split(/\r?\n/u).filter(Boolean)) {
    const match = /^(?<hash>[0-9a-f]{64})\s+(?:\*|)(?<name>[^\s]+)$/u.exec(line);
    if (!match || checksums.has(match.groups.name)) releaseError("E_LAUNCHER_SIDECAR", "SHA256SUMS is malformed or ambiguous");
    checksums.set(match.groups.name, match.groups.hash);
  }
  if (checksums.size !== Object.values(ASSET_BY_TARGET).length || Object.values(ASSET_BY_TARGET).some((name) => !checksums.has(name))) {
    releaseError("E_LAUNCHER_SIDECAR", "SHA256SUMS must contain exactly one archive for every current target");
  }
  const sbom = parseJson(sbomBytes, "SBOM.cdx.json");
  const provenance = parseJson(provenanceBytes, "PROVENANCE.json");
  const components = uniqueByName(sbom.components, "SBOM");
  const artifacts = uniqueByName(provenance.build?.artifacts, "provenance");
  const expectedArchives = Object.values(ASSET_BY_TARGET);
  if (components.size !== expectedArchives.length || artifacts.size !== expectedArchives.length
    || expectedArchives.some((name) => !components.has(name) || !artifacts.has(name))) {
    releaseError("E_LAUNCHER_SIDECAR", "SBOM and provenance must bind exactly one artifact for every target archive");
  }
  const sbomHash = components.get(assetName)?.hashes?.find((hash) => hash?.alg === "SHA-256")?.content;
  const provenanceArtifact = artifacts.get(assetName);
  const firstAttestation = artifacts.get(expectedArchives[0])?.attestation;
  for (const name of expectedArchives) {
    const component = components.get(name);
    const artifact = artifacts.get(name);
    if (component.version !== version || artifact.attestation?.digest !== firstAttestation?.digest || artifact.attestation?.sha256 !== firstAttestation?.sha256) {
      releaseError("E_LAUNCHER_E3_MISMATCH", "target archives do not share one release version and E3 attestation", { asset: name });
    }
  }
  if (checksums.get(assetName) !== archiveSha256 || sbomHash !== archiveSha256 || provenanceArtifact?.sha256 !== archiveSha256) {
    releaseError("E_LAUNCHER_DIGEST_MISMATCH", "archive digest does not agree across required sidecars", { asset: assetName });
  }
  if (sbom.metadata?.component?.version !== version || provenance.source?.version !== version || !/^[0-9a-f]{40}$/u.test(provenance.source?.commit ?? "")) {
    releaseError("E_LAUNCHER_RELEASE_SKEW", "sidecar source version or commit does not match the package release");
  }
  if (provenanceArtifact.attestation?.digest !== provenance.portable_core_attestation?.digest
    || provenanceArtifact.attestation?.sha256 !== provenance.portable_core_attestation?.sha256) {
    releaseError("E_LAUNCHER_E3_MISMATCH", "selected archive E3 observation does not match release provenance");
  }
  return Object.freeze({
    archiveSha256,
    sourceCommit: provenance.source.commit,
    e3AttestationDigest: provenance.portable_core_attestation.digest,
    e3AttestationSha256: provenance.portable_core_attestation.sha256,
  });
}
