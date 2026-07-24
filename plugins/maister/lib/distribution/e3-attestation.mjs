import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createEvidenceRecord, normalizeEvidenceProvenance } from "./evidence-schema.mjs";
import { hashTree } from "./hash-tree.mjs";
import { extendEvidenceProvenance } from "./provenance.mjs";
import { throwDistributionError } from "./path-safety.mjs";

export const E3_ATTESTATION_SCHEMA_VERSION = 1;
export const E3_ATTESTATION_KIND = "maister/e3-portable-core";
export const E3_ATTESTATION_LOCATIONS = Object.freeze([
  ".maister-e3-attestation.json",
  ".maister/evidence/e3-portable-core.json",
  "plugins/maister/.maister-e3-attestation.json",
  "plugins/maister/evidence/e3-portable-core.json",
]);
const PORTABLE_CORE_ROOTS = Object.freeze(["common", "plugins/maister/common"]);

const ATTESTATION_FIELDS = Object.freeze([
  "schema_version",
  "kind",
  "test_command",
  "result",
  "source_commit",
  "source_version",
  "portable_core_tree_hash",
  "scenario",
  "scenario_version",
  "tested_at",
  "expires_at",
  "artifact_digest",
]);
const ATTESTATION_RESULTS = new Set(["passed", "failed", "unavailable"]);
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const MAX_ATTESTATION_BYTES = 256 * 1024;
const MAX_COMMAND_LENGTH = 4096;
const MAX_TEXT_LENGTH = 256;

function portableCoreModeFor(_relative, stat) {
  if (stat.isDirectory()) return 0o755;
  if (stat.isSymbolicLink()) return 0o777;
  return 0o644;
}

function fail(code, message, details = {}, options = {}) {
  throwDistributionError(`E_EVIDENCE_ATTESTATION_${code}`, message, details, options);
}

function assertObject(value, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("SCHEMA", `${location} must be an object`, { location });
  }
}

function assertText(value, location, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0") || value.length > maxLength) {
    fail("SCHEMA", `${location} must be a bounded non-empty string`, { location });
  }
}

function assertTimestamp(value, location) {
  assertText(value, location, 32);
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    fail("SCHEMA", `${location} must be an ISO timestamp`, { location, value });
  }
}

function assertHash(value, location) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("SCHEMA", `${location} must be a lowercase SHA-256 hash`, { location, value });
  }
}

function assertCommit(value, location) {
  if (typeof value !== "string" || !FULL_COMMIT.test(value)) {
    fail("SCHEMA", `${location} must be a lowercase full commit`, { location, value });
  }
}

function assertFresh(attestation, now) {
  const nowTimestamp = typeof now === "string" ? now : new Date().toISOString();
  assertTimestamp(nowTimestamp, "now");
  if (Date.parse(attestation.expires_at) <= Date.parse(nowTimestamp)) {
    fail("STALE", "E3 attestation has expired", {
      expires_at: attestation.expires_at,
      now: nowTimestamp,
    });
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateE3Attestation(value, { now, requireFresh = false } = {}) {
  assertObject(value, "attestation");
  const keys = Object.keys(value).sort();
  const expected = [...ATTESTATION_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail("SCHEMA", "E3 attestation has unknown or missing fields", {
      expected: ATTESTATION_FIELDS,
      actual: Object.keys(value),
    });
  }
  if (value.schema_version !== E3_ATTESTATION_SCHEMA_VERSION) {
    fail("SCHEMA", "E3 attestation schema_version is unsupported", { schema_version: value.schema_version });
  }
  if (value.kind !== E3_ATTESTATION_KIND) {
    fail("SCHEMA", "E3 attestation kind is unsupported", { kind: value.kind });
  }
  assertText(value.test_command, "attestation.test_command", MAX_COMMAND_LENGTH);
  if (!ATTESTATION_RESULTS.has(value.result)) {
    fail("SCHEMA", "attestation.result is unsupported", { result: value.result });
  }
  assertCommit(value.source_commit, "attestation.source_commit");
  assertText(value.source_version, "attestation.source_version");
  assertHash(value.portable_core_tree_hash, "attestation.portable_core_tree_hash");
  assertText(value.scenario, "attestation.scenario");
  assertText(value.scenario_version, "attestation.scenario_version");
  assertTimestamp(value.tested_at, "attestation.tested_at");
  assertTimestamp(value.expires_at, "attestation.expires_at");
  if (Date.parse(value.expires_at) <= Date.parse(value.tested_at)) {
    fail("SCHEMA", "attestation.expires_at must be after tested_at", {
      tested_at: value.tested_at,
      expires_at: value.expires_at,
    });
  }
  assertHash(value.artifact_digest, "attestation.artifact_digest");
  const validated = Object.freeze({ ...value });
  if (requireFresh) assertFresh(validated, now);
  return validated;
}

export function assertUsableE3Attestation(value, options = {}) {
  const attestation = validateE3Attestation(value, { ...options, requireFresh: true });
  if (attestation.result !== "passed") {
    fail("FAILED", `E3 attestation result is ${attestation.result}`, { result: attestation.result });
  }
  return attestation;
}

export function e3AttestationDigest(value) {
  const attestation = validateE3Attestation(value);
  return crypto.createHash("sha256").update(canonicalJson(attestation)).digest("hex");
}

function readAttestationFile(filePath, options = {}) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail("IO", `could not read E3 attestation: ${filePath}`, { path: filePath, code: error.code ?? null });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("IO", "E3 attestation must be a regular file", { path: filePath });
  }
  if (stat.size > MAX_ATTESTATION_BYTES) {
    fail("IO", "E3 attestation exceeds the maximum size", { path: filePath, max_bytes: MAX_ATTESTATION_BYTES });
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail("SCHEMA", "E3 attestation is not valid JSON", { path: filePath }, { cause: error });
  }
  return assertUsableE3Attestation(value, options);
}

function explicitPath(value) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    fail("MISSING", "E3 attestation path must be a non-empty safe path", { path: value });
  }
  return path.resolve(value);
}

function archiveCandidates(root) {
  if (typeof root !== "string" || root.trim() === "") return [];
  let rootStat;
  try {
    rootStat = fs.statSync(root);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) return [];
  return E3_ATTESTATION_LOCATIONS.map((relative) => path.join(root, ...relative.split("/")));
}

export function loadE3Attestation({ path: requestedPath, archiveRoot, now } = {}) {
  if (requestedPath !== undefined && requestedPath !== null) {
    return readAttestationFile(explicitPath(requestedPath), { now });
  }
  const candidates = archiveCandidates(archiveRoot).filter((candidate) => fs.existsSync(candidate));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    fail("AMBIGUOUS", "multiple self-contained E3 attestations were found", { paths: candidates });
  }
  return readAttestationFile(candidates[0], { now });
}

export function portableCoreTreeHash(root) {
  const candidate = PORTABLE_CORE_ROOTS
    .map((relative) => path.join(root, ...relative.split("/")))
    .find((value) => fs.existsSync(value) && fs.statSync(value).isDirectory());
  if (!candidate) {
    fail("BINDING", "source does not contain a recognized portable-core tree", { root, expected: PORTABLE_CORE_ROOTS });
  }
  return hashTree(candidate, { modeFor: portableCoreModeFor }).contentHash;
}

export function requireE3Attestation(value, options = {}) {
  if (!value) fail("MISSING", "a valid E3 portable-core attestation is required", {});
  return assertUsableE3Attestation(value, options);
}

function candidateValue(provenance, ...fields) {
  for (const field of fields) {
    if (provenance?.[field] !== undefined) return provenance[field];
  }
  return undefined;
}

export function bindE3AttestationToProvenance(value, { provenance, now, requireArtifactDigest = true } = {}) {
  const attestation = assertUsableE3Attestation(value, { now });
  assertObject(provenance, "candidate provenance");
  const sourceCommit = candidateValue(provenance, "resolvedCommit", "source_commit");
  if (sourceCommit !== attestation.source_commit) {
    fail("BINDING", "E3 attestation source commit does not match the candidate", {
      expected: sourceCommit,
      actual: attestation.source_commit,
    });
  }
  const sourceVersion = candidateValue(provenance, "sourceVersion", "source_version");
  if (sourceVersion !== undefined && sourceVersion !== attestation.source_version) {
    fail("BINDING", "E3 attestation source version does not match the candidate", {
      expected: sourceVersion,
      actual: attestation.source_version,
    });
  }
  const portableCoreTreeHash = candidateValue(
    provenance,
    "portableCoreTreeHash",
    "portable_core_tree_hash",
    "sourceHash",
    "source_hash",
  );
  if (portableCoreTreeHash !== undefined && portableCoreTreeHash !== attestation.portable_core_tree_hash) {
    fail("BINDING", "E3 attestation portable-core hash does not match the candidate", {
      expected: portableCoreTreeHash,
      actual: attestation.portable_core_tree_hash,
    });
  }
  if (requireArtifactDigest) {
    const artifactDigest = candidateValue(
      provenance,
      "artifactDigest",
      "artifact_digest",
      "materializedHash",
      "materialized_hash",
      "sourceHash",
      "source_hash",
    );
    if (artifactDigest === undefined || artifactDigest !== attestation.artifact_digest) {
      fail("BINDING", "E3 attestation artifact digest does not match the candidate", {
        expected: artifactDigest,
        actual: attestation.artifact_digest,
      });
    }
  }
  return Object.freeze({
    attestation,
    attestation_digest: e3AttestationDigest(attestation),
    artifact_digest: attestation.artifact_digest,
    portable_core_tree_hash: attestation.portable_core_tree_hash,
  });
}

export function consumeE3Attestation({ attestation, target, hostVersion, provenance, now, requireArtifactDigest = true } = {}) {
  const binding = bindE3AttestationToProvenance(attestation, { provenance, now, requireArtifactDigest });
  const normalized = normalizeEvidenceProvenance(provenance);
  const evidenceProvenance = extendEvidenceProvenance(normalized, {
    command: binding.attestation.test_command,
    attestationDigest: binding.attestation_digest,
    artifactDigest: binding.artifact_digest,
    portableCoreTreeHash: binding.portable_core_tree_hash,
  });
  return createEvidenceRecord({
    target,
    capability: "E3",
    hostVersion,
    scenario: binding.attestation.scenario,
    result: "passed",
    provenance: evidenceProvenance,
    timestamp: binding.attestation.tested_at,
    expiresAt: binding.attestation.expires_at,
  });
}

export { ATTESTATION_FIELDS, ATTESTATION_RESULTS, MAX_ATTESTATION_BYTES };
