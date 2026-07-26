import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../../plugins/maister/bin/maister-install.mjs";
import {
  assertUsableE3Attestation,
  consumeE3Attestation,
  e3AttestationDigest,
  loadE3Attestation,
  requireE3Attestation,
  validateE3Attestation,
} from "../../plugins/maister/lib/distribution/e3-attestation.mjs";
import { parseCliArgs } from "../../plugins/maister/lib/distribution/cli-contract.mjs";
import {
  EVIDENCE_RESULTS,
  EVIDENCE_LEVELS,
  createEvidenceRecord,
  validateEvidenceSet,
  validateEvidenceRecord,
} from "../../plugins/maister/lib/distribution/evidence-schema.mjs";
import {
  collectEvidence,
  evaluateCapability,
  evidenceNeedsRenewal,
} from "../../plugins/maister/lib/distribution/evidence-policy.mjs";
import { createProvenance } from "../../plugins/maister/lib/distribution/provenance.mjs";
import {
  HostProbeTimeoutError,
  defaultRun,
  probeHost,
} from "../../plugins/maister/lib/distribution/host-probes/base.mjs";
import { probeCodex } from "../../plugins/maister/lib/distribution/host-probes/codex.mjs";
import { probeCursor } from "../../plugins/maister/lib/distribution/host-probes/cursor.mjs";
import { probeKiroCli } from "../../plugins/maister/lib/distribution/host-probes/kiro-cli.mjs";
import { runCursorInvocationScenario } from "../../plugins/maister/lib/distribution/host-probes/scenarios/cursor.mjs";
import {
  assertCleanRepositoryTopology,
  assertCleanTopology,
  compareShadowParity,
  loadParityBaseline,
  validateParityBaseline,
} from "../../plugins/maister/bin/shadow-parity.mjs";
import { SUPPORTED_TARGET_IDS } from "../../plugins/maister/lib/distribution/targets.mjs";

const FIXTURES = path.resolve("tests/fixtures/platform-independent/evidence");
const E3_ATTESTATION_FIXTURE = path.join(FIXTURES, "e3-portable-core-attestation.json");
const SOURCE_ROOT = path.resolve("tests/fixtures/platform-independent/source-repos/basic");
const NOW = "2026-07-14T20:00:00.000Z";

function runGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function record(overrides = {}) {
  const base = {
    target: "codex",
    capability: "E1",
    host_version: "1.2.3",
    scenario: "overlay-contract-v1",
    timestamp: "2026-07-14T19:00:00.000Z",
    result: "passed",
    provenance: {
      source_commit: "a".repeat(40),
      source_version: "2.2.1",
      overlay_version: "1.0.0",
      scenario_version: "1.0.0",
    },
    expires_at: "2026-07-15T19:00:00.000Z",
    ...overrides,
  };
  if (base.result === "unavailable" && !base.provenance.reason) {
    base.provenance = { ...base.provenance, reason: "fixture-unavailable" };
  }
  if (base.capability === "E5" || base.capability === "E6") {
    base.provenance = { ...nativeProvenance(base.target), ...base.provenance };
  }
  return base;
}

const NATIVE_BINDING = Object.freeze({
  source_commit: "a".repeat(40),
  source_version: "2.2.1",
  overlay_id: "maister/codex",
  overlay_version: "1.0.0",
  host: "codex",
  scenario_version: "1.0.0",
  schema_version: 1,
  projector_version: "1.0.0",
  canonical_set_digest: "b".repeat(64),
  manifest_digest: "c".repeat(64),
  projected_tree_digest: "d".repeat(64),
});

function nativeProvenance(target, overrides = {}) {
  return {
    ...NATIVE_BINDING,
    overlay_id: `maister/${target}`,
    host: target,
    ...overrides,
  };
}

function nativeManifest(target) {
  const roleIds = ["code-reviewer", "implementation-planner", "advisor"];
  return {
    canonical_set_digest: NATIVE_BINDING.canonical_set_digest,
    manifest_digest: NATIVE_BINDING.manifest_digest,
    projected_tree_digest: NATIVE_BINDING.projected_tree_digest,
    rows: roleIds.map((roleId) => ({
      target,
      logical_role_id: `maister:${roleId}`,
      adapter_id: target === "codex" ? "codex.exec" : `${target}.native`,
      native_role_external_id: target === "codex" ? null : `maister-${roleId}`,
      source_sha256: crypto.createHash("sha256").update(roleId).digest("hex"),
      execution_policy: {
        model: { model: "gpt-5.6-terra" },
        reasoning: { effort: "high" },
        output_schema: { schema_id: "maister.agent-role-result.v1" },
      },
    })),
  };
}

function availableVersion() {
  return { status: 0, stdout: "1.2.3\n", stderr: "", error: null };
}

function codexCapability(overrides = {}) {
  const base = {
    schema_version: 1,
    executable: { available: true, path: "/usr/local/bin/codex" },
    authentication: { available: true, authenticated: true },
    version: { value: "1.2.3", allowed: true },
    controls: {
      working_root: true,
      model: true,
      reasoning_effort: true,
      sandbox: true,
      jsonl: true,
      output_schema: true,
      last_message: true,
      ignore_user_config: true,
    },
    model: { available: true, supported: true, value: null },
    reasoning: { available: true, supported: true, value: null },
  };
  return {
    ...base,
    authentication: { ...base.authentication, ...overrides.authentication },
    version: { ...base.version, ...overrides.version },
    controls: { ...base.controls, ...overrides.controls },
    model: { ...base.model, ...overrides.model },
    reasoning: { ...base.reasoning, ...overrides.reasoning },
  };
}

function codexCapabilityPort(overrides = {}) {
  const observation = codexCapability(overrides);
  return {
    inspect() {
      return structuredClone(observation);
    },
  };
}

function matchingInvocation(request) {
  const expectedPolicy = {
    model: request.requested_execution_policy.model.model,
    reasoning_effort: request.requested_execution_policy.reasoning.effort,
  };
  return {
    logical_role_id: request.logical_role_id,
    observed_native_role_external_id: request.native_role_external_id,
    prompt_digest: request.prompt_digest,
    canonical_prompt_digest: request.canonical_prompt_digest,
    nonce: request.nonce,
    output_schema: request.output_schema,
    canonical_set_digest: request.canonical_set_digest,
    manifest_digest: request.manifest_digest,
    projected_tree_digest: request.projected_tree_digest,
    dispatch_id: request.dispatch_id,
    session_id: `session-${request.dispatch_id}`,
    effective_execution_policy: request.requested_execution_policy,
    execution_policy_evidence: {
      requested: expectedPolicy,
      accepted: expectedPolicy,
      observed: { ...expectedPolicy, status: "observed" },
    },
    behavior: request.expected_behavior,
  };
}

function fileObservation(content, mode = "0644") {
  return {
    present: true,
    type: "file",
    mode,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

function absentObservation() {
  return { present: false };
}

function e3Attestation() {
  return JSON.parse(fs.readFileSync(E3_ATTESTATION_FIXTURE, "utf8"));
}

function e3CandidateProvenance(overrides = {}) {
  return {
    resolvedCommit: "a".repeat(40),
    sourceVersion: "2.2.1",
    overlayVersion: "1.0.0",
    scenarioVersion: "1.0.0",
    portableCoreTreeHash: "b".repeat(64),
    artifactDigest: "c".repeat(64),
    ...overrides,
  };
}

const EXPECTED_PARITY_CATEGORIES = new Set(["packaging", "expected-deletion"]);
const OBSERVED_PARITY_CATEGORIES = new Set(["inventory", "permission", "semantic", "hook", "symlink", "topology"]);

function assertImmutableObservation(observation, location) {
  assert.ok(Object.isFrozen(observation), `${location} must be frozen`);
  for (const [sideName, side] of Object.entries(observation)) {
    assert.ok(Object.isFrozen(side), `${location}.${sideName} must be frozen`);
    assert.equal(typeof side.present, "boolean", `${location}.${sideName}.present`);
    if (!side.present) {
      assert.deepEqual(Object.keys(side), ["present"], `${location}.${sideName} absent shape`);
      continue;
    }
    assert.ok(["file", "directory", "symlink"].includes(side.type), `${location}.${sideName}.type`);
    assert.match(side.mode, /^0[0-7]{3,4}$/u, `${location}.${sideName}.mode`);
    if (side.type === "file") assert.match(side.sha256, /^[0-9a-f]{64}$/u, `${location}.${sideName}.sha256`);
    if (side.type === "symlink") assert.equal(typeof side.target, "string", `${location}.${sideName}.target`);
  }
}

function assertParityBaselineInvariants(baseline) {
  assert.ok(Object.isFrozen(baseline), "baseline must be frozen");
  assert.ok(Object.isFrozen(baseline.rules), "baseline rules must be frozen");
  assert.ok(baseline.rules.length > 0, "baseline rules must be non-empty");
  assert.equal(
    new Set(baseline.rules.map((rule) => rule.rule_instance)).size,
    baseline.rules.length,
    "normalized rule instances must be unique",
  );

  const exactRules = baseline.rules.filter((rule) => rule.pattern === undefined);
  const exactPaths = exactRules.map((rule) => rule.path);
  assert.ok(exactRules.length > 0, "baseline must contain exact rules");
  assert.equal(new Set(exactPaths).size, exactPaths.length, "exact rule paths must be unique");

  for (const [index, rule] of baseline.rules.entries()) {
    assert.ok(Object.isFrozen(rule), `rule ${index} must be frozen`);
    assert.ok(EXPECTED_PARITY_CATEGORIES.has(rule.category), `rule ${index} category`);
    assert.ok(OBSERVED_PARITY_CATEGORIES.has(rule.observed_category), `rule ${index} observed category`);
    if (rule.pattern !== undefined) {
      assert.notEqual(rule.pattern, "*");
      assert.notEqual(rule.pattern, "**");
      assert.notEqual(rule.pattern, "**/*");
      assert.ok(!rule.pattern.startsWith("**"), `rule ${index} pattern must be bounded`);
      assert.ok(!rule.pattern.includes("**") || rule.pattern.endsWith("/**"), `rule ${index} recursive pattern must be a suffix`);
      assert.ok(Number.isInteger(rule.max_matches) && rule.max_matches >= 1 && rule.max_matches <= 64, `rule ${index} max_matches`);
      assert.ok(Object.isFrozen(rule.observations), `rule ${index} observations must be frozen`);
      for (const [pathName, observation] of Object.entries(rule.observations)) {
        assertImmutableObservation(observation, `rule ${index}.${pathName}`);
      }
    } else {
      assert.equal(typeof rule.path, "string", `rule ${index} exact path`);
      assertImmutableObservation(rule.observation, `rule ${index}.${rule.path}`);
    }
  }
}

test("validates E1-E6 records and rejects malformed outcomes", () => {
  const fixtureRecords = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, "records.json"), "utf8"),
  );
  for (const evidence of fixtureRecords) {
    assert.equal(validateEvidenceRecord(evidence).target, evidence.target);
    assert.ok(EVIDENCE_RESULTS.has(evidence.result));
  }
  assert.throws(
    () => validateEvidenceRecord({ ...record(), result: "skipped" }),
    /E_EVIDENCE_SCHEMA/,
  );
  assert.throws(
    () => validateEvidenceRecord({ ...record(), provenance: null }),
    /E_EVIDENCE_SCHEMA/,
  );
  assert.throws(
    () => validateEvidenceRecord({ ...record(), capability: "E7" }),
    /E_EVIDENCE_SCHEMA/,
  );
  assert.throws(
    () => validateEvidenceRecord({ ...record(), unexpected: true }),
    /E_EVIDENCE_SCHEMA/,
  );
});

test("validates and consumes a fresh E3 portable-core attestation", () => {
  const attestation = loadE3Attestation({ path: E3_ATTESTATION_FIXTURE, now: NOW });
  assert.equal(attestation.result, "passed");
  assert.match(e3AttestationDigest(attestation), /^[0-9a-f]{64}$/u);
  const evidence = consumeE3Attestation({
    attestation,
    target: "codex",
    hostVersion: "1.2.3",
    provenance: e3CandidateProvenance(),
    now: NOW,
  });
  assert.equal(evidence.capability, "E3");
  assert.equal(evidence.result, "passed");
  assert.equal(evidence.scenario, "portable-core-v1");
  assert.equal(evidence.provenance.command, attestation.test_command);
  assert.equal(evidence.provenance.artifact_digest, attestation.artifact_digest);
  assert.equal(evidence.provenance.portable_core_tree_hash, attestation.portable_core_tree_hash);
  assert.match(evidence.provenance.attestation_digest, /^[0-9a-f]{64}$/u);
});

test("rejects missing E3 attestations at the CLI boundary", async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "maister-e3-missing-state-"));
  const result = await runCli([
    "install",
    "--target", "codex",
    "--source", `local:${SOURCE_ROOT}`,
    "--home", path.join(state, "home"),
    "--json",
  ], {
    env: { ...process.env, XDG_STATE_HOME: path.join(state, "xdg") },
    git: {
      topLevel: () => SOURCE_ROOT,
      head: () => "a".repeat(40),
      status: () => [],
    },
  });
  const response = JSON.parse(result.output);
  assert.equal(result.status, 4);
  assert.equal(response.ok, false);
  assert.equal(response.error.kind, "E_EVIDENCE_ATTESTATION_MISSING");
  assert.throws(() => requireE3Attestation(null), /E_EVIDENCE_ATTESTATION_MISSING/);
});

test("accepts both explicit E3 CLI option names but rejects ambiguous input", () => {
  const env = { ...process.env };
  const evidence = parseCliArgs([
    "install", "--target", "codex", "--source", "local:/checkout", "--evidence", E3_ATTESTATION_FIXTURE,
  ], env);
  assert.equal(evidence.attestationPath, E3_ATTESTATION_FIXTURE);
  const attestation = parseCliArgs([
    "update", "--target", "cursor", "--source", "local:/checkout", "--attestation", E3_ATTESTATION_FIXTURE,
  ], env);
  assert.equal(attestation.attestationPath, E3_ATTESTATION_FIXTURE);
  assert.throws(
    () => parseCliArgs([
      "install", "--target", "codex", "--source", "local:/checkout",
      "--evidence", E3_ATTESTATION_FIXTURE, "--attestation", E3_ATTESTATION_FIXTURE,
    ], env),
    /E_USAGE/,
  );
});

test("rejects malformed, stale, and failed E3 attestations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-e3-invalid-"));
  const malformedPath = path.join(root, "malformed.json");
  fs.writeFileSync(malformedPath, JSON.stringify({ ...e3Attestation(), unexpected: true }));
  assert.throws(() => loadE3Attestation({ path: malformedPath, now: NOW }), /E_EVIDENCE_ATTESTATION_SCHEMA/);

  const stalePath = path.join(root, "stale.json");
  fs.writeFileSync(stalePath, JSON.stringify({ ...e3Attestation(), expires_at: "2026-07-15T12:00:00.000Z" }));
  assert.throws(() => loadE3Attestation({ path: stalePath, now: "2026-07-16T00:00:00.000Z" }), /E_EVIDENCE_ATTESTATION_STALE/);

  const failedPath = path.join(root, "failed.json");
  fs.writeFileSync(failedPath, JSON.stringify({ ...e3Attestation(), result: "failed" }));
  assert.throws(() => loadE3Attestation({ path: failedPath, now: NOW }), /E_EVIDENCE_ATTESTATION_FAILED/);
  assert.equal(validateE3Attestation(JSON.parse(fs.readFileSync(failedPath, "utf8"))).result, "failed");
  assert.throws(() => assertUsableE3Attestation(JSON.parse(fs.readFileSync(failedPath, "utf8")), { now: NOW }), /E_EVIDENCE_ATTESTATION_FAILED/);
});

test("discovers the self-contained archive location and rejects candidate mismatches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-e3-archive-"));
  const location = path.join(root, "plugins", "maister");
  fs.mkdirSync(location, { recursive: true });
  fs.copyFileSync(E3_ATTESTATION_FIXTURE, path.join(location, ".maister-e3-attestation.json"));
  const attestation = loadE3Attestation({ archiveRoot: root, now: NOW });
  assert.equal(attestation.source_commit, "a".repeat(40));
  assert.throws(
    () => consumeE3Attestation({
      attestation,
      target: "codex",
      hostVersion: "1.2.3",
      provenance: e3CandidateProvenance({ resolvedCommit: "d".repeat(40) }),
      now: NOW,
    }),
    /E_EVIDENCE_ATTESTATION_BINDING/,
  );
  assert.throws(
    () => consumeE3Attestation({
      attestation,
      target: "codex",
      hostVersion: "1.2.3",
      provenance: e3CandidateProvenance({ artifactDigest: "d".repeat(64) }),
      now: NOW,
    }),
    /E_EVIDENCE_ATTESTATION_BINDING/,
  );
});

test("collects one validated E1-E6 set and records unavailable native outcomes explicitly", () => {
  const provenance = {
    ...nativeProvenance("cursor"),
  };
  const collected = collectEvidence({
    target: "cursor",
    hostVersion: "unknown",
    provenance,
    timestamp: NOW,
    records: [
      record({ target: "cursor", capability: "E1", timestamp: NOW }),
      record({ target: "cursor", capability: "E2", timestamp: NOW }),
      record({ target: "cursor", capability: "E3", timestamp: NOW }),
      record({ target: "cursor", capability: "E4", timestamp: NOW }),
    ],
  });

  assert.deepEqual(
    collected.map((evidence) => evidence.capability),
    [...EVIDENCE_LEVELS].sort(),
  );
  assert.deepEqual(
    collected.filter((evidence) => evidence.result === "unavailable").map((evidence) => evidence.capability),
    ["E5", "E6"],
  );
  assert.ok(collected.filter((evidence) => evidence.result === "unavailable").every((evidence) => evidence.provenance.reason));
  assert.deepEqual(validateEvidenceSet(collected), collected);
});

test("collectEvidence preserves installer-facing incomplete unavailable native prerequisites", () => {
  const collected = collectEvidence({
    target: "codex",
    hostVersion: "unknown",
    timestamp: NOW,
    provenance: {
      source_commit: "a".repeat(40),
      source_version: "2.2.1",
      overlay_version: "1.0.0",
      scenario_version: "1.0.0",
    },
    records: ["E1", "E2", "E3", "E4"].map((capability) => record({ capability, timestamp: NOW })),
  });
  const native = collected.filter((evidence) => evidence.capability === "E5" || evidence.capability === "E6");
  assert.deepEqual(native.map((evidence) => evidence.result), ["unavailable", "unavailable"]);
  assert.ok(native.every((evidence) => evidence.provenance.reason === "not-collected"));
  assert.ok(native.every((evidence) => evidence.provenance.overlay_id === undefined));
});

test("creates complete immutable provenance hashes for source, overlay, materialized output, and provenance", () => {
  const sourceHash = "a".repeat(64);
  const overlayHash = "b".repeat(64);
  const materializedHash = "c".repeat(64);
  const provenance = createProvenance({
    source: {
      kind: "local",
      requestedSource: "local:/checkout",
      requestedRef: "HEAD",
      resolvedCommit: "d".repeat(40),
      sourceVersion: "2.2.1",
      contentHash: sourceHash,
    },
    overlay: {
      overlay_id: "maister/codex",
      overlay_version: "1.0.0",
      contractHash: overlayHash,
      target: { id: "codex", host_version_constraint: "0.145.0" },
    },
    hostVersion: "1.2.3",
    contentHash: materializedHash,
  });

  assert.equal(provenance.sourceHash, sourceHash);
  assert.equal(provenance.overlayHash, overlayHash);
  assert.equal(provenance.materializedHash, materializedHash);
  assert.equal(provenance.contentHash, materializedHash);
  assert.equal(provenance.hashes.source, sourceHash);
  assert.equal(provenance.hashes.overlay, overlayHash);
  assert.equal(provenance.hashes.materialized, materializedHash);
  assert.equal(provenance.hashes.provenance, provenance.provenanceHash);
  assert.equal(provenance.overlayId, "maister/codex");
  assert.throws(
    () => createProvenance({
      source: {
        kind: "local",
        requestedSource: "local:/checkout",
        requestedRef: "HEAD",
        resolvedCommit: "d".repeat(40),
        sourceVersion: "2.2.1",
        contentHash: "not-a-hash",
      },
      overlay: {
        overlay_id: "maister/codex",
        overlay_version: "1.0.0",
        contractHash: overlayHash,
        target: { id: "codex", host_version_constraint: "0.145.0" },
      },
      contentHash: materializedHash,
    }),
    /E_PROVENANCE_HASH/,
  );
});

test("never promotes unavailable evidence to a passed capability", () => {
  const result = evaluateCapability({
    target: "cursor",
    capability: "native_runtime",
    capabilityClass: "semantic",
    requiredEvidence: ["E1", "E3", "E5", "E6"],
    records: [
      record({ target: "cursor", capability: "E1" }),
      record({ target: "cursor", capability: "E3" }),
      record({ target: "cursor", capability: "E5", result: "unavailable" }),
      record({ target: "cursor", capability: "E6", result: "unavailable" }),
    ],
    now: NOW,
  });
  assert.equal(result.passed, false);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.unavailable, ["E5", "E6"]);
});

test("expires evidence per capability and renews on version or scenario changes", () => {
  const evidence = record({ capability: "E4" });
  assert.equal(
    evidenceNeedsRenewal(evidence, {
      now: NOW,
      hostVersion: "1.2.3",
      overlayVersion: "1.0.0",
      sourceCommit: "a".repeat(40),
      scenarioVersion: "1.0.0",
    }),
    false,
  );
  assert.equal(
    evidenceNeedsRenewal(evidence, {
      now: NOW,
      hostVersion: "1.2.4",
      overlayVersion: "1.0.0",
      sourceCommit: "a".repeat(40),
      scenarioVersion: "1.0.0",
    }),
    true,
  );
  assert.equal(
    evidenceNeedsRenewal(evidence, {
      now: "2026-07-16T20:00:00.000Z",
      hostVersion: "1.2.3",
      overlayVersion: "1.0.0",
      sourceCommit: "a".repeat(40),
      scenarioVersion: "1.0.0",
    }),
    true,
  );
});

test("renews evidence on every provenance fingerprint and every non-pass outcome", () => {
  const evidence = record({ capability: "E4" });
  const context = {
    now: NOW,
    hostVersion: "1.2.3",
    overlayVersion: "1.0.0",
    sourceCommit: "a".repeat(40),
    scenarioVersion: "1.0.0",
  };
  for (const changed of [
    { overlayVersion: "1.0.1" },
    { sourceCommit: "b".repeat(40) },
    { scenarioVersion: "2.0.0" },
  ]) {
    assert.equal(evidenceNeedsRenewal(evidence, { ...context, ...changed }), true);
  }
  assert.equal(evidenceNeedsRenewal({ ...evidence, result: "failed" }, context), true);
  assert.equal(
    evidenceNeedsRenewal({
      ...evidence,
      result: "unavailable",
      provenance: { ...evidence.provenance, reason: "fixture-unavailable" },
    }, context),
    true,
  );
});

test("a newer failed or unavailable record supersedes an older passed record", () => {
  const result = evaluateCapability({
    target: "codex",
    capability: "safety_hooks",
    capabilityClass: "safety",
    requiredEvidence: ["E1"],
    records: [
      record({ capability: "E1", timestamp: "2026-07-14T19:00:00.000Z", result: "passed" }),
      record({ capability: "E1", timestamp: "2026-07-14T19:30:00.000Z", result: "unavailable" }),
    ],
    now: NOW,
  });
  assert.equal(result.passed, false);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.unavailable, ["E1"]);
});

test("semantic, safety, persistence, and rollback capabilities fail closed on incomplete evidence", () => {
  for (const capabilityClass of ["semantic", "safety", "persistence", "rollback"]) {
    const result = evaluateCapability({
      target: "codex",
      capability: `${capabilityClass}_capability`,
      capabilityClass,
      requiredEvidence: ["E1", "E4"],
      records: [record({ capability: "E1" })],
      now: NOW,
    });
    assert.equal(result.status, "blocked", capabilityClass);
    assert.equal(result.passed, false, capabilityClass);
  }
});

test("host probe timeouts are bounded and returned as typed failed evidence", () => {
  assert.throws(
    () => defaultRun(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { timeoutMs: 25 }),
    (error) => error instanceof HostProbeTimeoutError && error.code === "E_HOST_PROBE_TIMEOUT" && error.retryable === true,
  );

  const result = probeHost({
    target: "codex",
    now: NOW,
    provenance: nativeProvenance("codex"),
    run: () => { throw new HostProbeTimeoutError("codex", ["--version"], 25); },
  });
  assert.equal(result.error.kind, "E_HOST_PROBE_TIMEOUT");
  assert.deepEqual(result.records.map((evidence) => evidence.result), ["failed", "failed"]);
  assert.ok(result.records.every((evidence) => evidence.provenance.reason === "timeout"));

  const unavailable = probeHost({
    target: "cursor",
    now: NOW,
    provenance: nativeProvenance("cursor"),
    run: () => ({ status: null, error: { code: "ENOENT" }, stdout: "", stderr: "" }),
  });
  assert.equal(unavailable.error, null);
  assert.deepEqual(unavailable.records.map((evidence) => evidence.result), ["unavailable", "unavailable"]);
  assert.ok(unavailable.records.every((evidence) => evidence.provenance.reason === "runtime-not-installed"));
});

test("Codex version success alone never passes E5 or E6", () => {
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: { inspect() { return null; } },
    invoke: null,
  });
  assert.deepEqual(result.records.map(({ result: outcome }) => outcome), ["unavailable", "unavailable"]);
  assert.equal(result.records[0].provenance.reason, "safe-adapter-unavailable");
  assert.equal(result.records[1].provenance.reason, "scenario-not-configured");
});

test("Codex E5 passes only with its authenticated managed exec control surface", () => {
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: codexCapabilityPort(),
  });
  assert.equal(result.records[0].result, "passed");
  assert.equal(result.records[0].provenance.discovery_subject, "codex.exec");
});

test("Codex missing authentication is unavailable rather than a discovery pass", () => {
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: codexCapabilityPort({ authentication: { authenticated: false } }),
  });
  assert.equal(result.records[0].result, "unavailable");
  assert.equal(result.records[0].provenance.reason, "authentication-unavailable");
});

test("Codex missing a required exec control is unavailable rather than structurally supported", () => {
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: codexCapabilityPort({ controls: { output_schema: false } }),
  });
  assert.equal(result.records[0].result, "unavailable");
  assert.equal(result.records[0].provenance.reason, "required-control-unavailable");
});

test("Cursor E5 passes only when the observed native inventory exactly matches its manifest", () => {
  const manifest = nativeManifest("cursor");
  const result = probeCursor({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("cursor"),
    manifest,
    discover: () => ({ native_role_external_ids: manifest.rows.map((row) => row.native_role_external_id) }),
  });
  assert.equal(result.records[0].result, "passed");
  assert.deepEqual(result.records[0].provenance.native_role_external_ids, [
    "maister-advisor", "maister-code-reviewer", "maister-implementation-planner",
  ]);
});

test("Cursor E5 fails when an observed native ID shadows a manifest ID", () => {
  const manifest = nativeManifest("cursor");
  const result = probeCursor({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("cursor"),
    manifest,
    discover: () => ({ native_role_external_ids: [
      "maister-advisor", "maister-code-reviewer", "maister-code-reviewer", "maister-implementation-planner",
    ] }),
  });
  assert.equal(result.records[0].result, "failed");
  assert.equal(result.records[0].provenance.reason, "native-inventory-collision");
});

test("Kiro E5 fails for a missing observed manifest identity", () => {
  const manifest = nativeManifest("kiro-cli");
  const result = probeKiroCli({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("kiro-cli"),
    manifest,
    discover: () => ({ native_role_external_ids: manifest.rows.slice(0, 2).map((row) => row.native_role_external_id) }),
  });
  assert.equal(result.records[0].result, "failed");
  assert.equal(result.records[0].provenance.reason, "native-inventory-mismatch");
});

test("Kiro E5 ignores unrelated user-owned descriptors beside Maister leaves", () => {
  const manifest = nativeManifest("kiro-cli");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maister-kiro-probe-"));
  const agents = path.join(home, "agents");
  fs.mkdirSync(agents, { recursive: true });
  for (const row of manifest.rows) {
    fs.writeFileSync(
      path.join(agents, `${row.native_role_external_id}.json`),
      `${JSON.stringify({ name: row.native_role_external_id })}\n`,
    );
  }
  fs.writeFileSync(
    path.join(agents, "user-owned.json"),
    `${JSON.stringify({ name: "user-owned" })}\n`,
  );
  try {
    const result = probeKiroCli({
      now: NOW,
      run: availableVersion,
      provenance: nativeProvenance("kiro-cli"),
      manifest,
      kiroHome: home,
    });
    assert.equal(result.records[0].result, "passed");
    assert.deepEqual(
      result.records[0].provenance.native_role_external_ids,
      manifest.rows.map((row) => row.native_role_external_id).sort(),
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("missing a safe versioned E6 scenario remains unavailable", () => {
  const manifest = nativeManifest("cursor");
  const result = probeCursor({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("cursor"),
    manifest,
    discover: () => ({ native_role_external_ids: manifest.rows.map((row) => row.native_role_external_id) }),
  });
  assert.equal(result.records[1].result, "unavailable");
  assert.equal(result.records[1].provenance.reason, "cursor-live-invocation-unobservable-from-cli");
});

test("Codex E6 resolves production-shaped namespaced manifest rows for two ordinary roles and advisor", () => {
  const calls = [];
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: codexCapabilityPort(),
    invoke: (request) => {
      calls.push(request);
      return matchingInvocation(request);
    },
  });
  assert.equal(result.records[1].result, "passed");
  assert.deepEqual(calls.map((call) => call.logical_role_id), [
    "maister:code-reviewer", "maister:implementation-planner", "maister:advisor",
  ]);
  assert.equal(new Set(calls.map((call) => call.prompt_digest)).size, 3);
  assert.equal(new Set(calls.map((call) => call.prompt)).size, 3);
  assert.equal(new Set(calls.map((call) => call.nonce)).size, 3);
  assert.equal(new Set(calls.map((call) => call.output_schema)).size, 3);
  assert.ok(calls.every((call) => call.prompt_digest === crypto.createHash("sha256").update(call.prompt).digest("hex")));
  assert.ok(calls.every((call) => call.canonical_prompt_digest === nativeManifest("codex").rows
    .find((row) => row.logical_role_id === call.logical_role_id).source_sha256));
});

test("Codex E6 remains unavailable when effective policy only echoes the request", () => {
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: codexCapabilityPort(),
    invoke: (request) => {
      const observation = matchingInvocation(request);
      delete observation.execution_policy_evidence;
      return observation;
    },
  });
  assert.equal(result.records[1].result, "unavailable");
  assert.equal(result.records[1].provenance.reason, "effective-policy-observation-unavailable");
});

test("a missing required E6 role is unavailable with a precise reason instead of throwing", () => {
  const manifest = nativeManifest("codex");
  manifest.rows = manifest.rows.filter((row) => row.logical_role_id !== "maister:advisor");
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest,
    capabilityPort: codexCapabilityPort(),
    invoke: matchingInvocation,
  });
  assert.equal(result.records[1].result, "unavailable");
  assert.equal(result.records[1].provenance.reason, "required-role-missing");
});

test("a discovery timeout does not contaminate a successful E6 record or returned probe error", () => {
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: { inspect() { throw new HostProbeTimeoutError("codex", ["discovery"], 25); } },
    invoke: matchingInvocation,
  });
  assert.equal(result.records[0].result, "failed");
  assert.equal(result.records[0].provenance.reason, "timeout");
  assert.equal(result.records[1].result, "passed");
  assert.equal(result.records[1].provenance.reason, undefined);
  assert.equal(result.error, null);
});

test("E6 fails after launch when Cursor reports the wrong native identity", () => {
  const manifest = nativeManifest("cursor");
  const result = probeCursor({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("cursor"),
    manifest,
    discover: () => ({ native_role_external_ids: manifest.rows.map((row) => row.native_role_external_id) }),
    invoke: (request) => ({ ...matchingInvocation(request), observed_native_role_external_id: "maister-wrong-role" }),
    runScenario: runCursorInvocationScenario,
  });
  assert.equal(result.records[1].result, "failed");
  assert.equal(result.records[1].provenance.reason, "wrong-observed-identity");
});

test("E6 fails after launch when Kiro does not observe the selected native identity", () => {
  const manifest = nativeManifest("kiro-cli");
  const result = probeKiroCli({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("kiro-cli"),
    manifest,
    discover: () => ({ native_role_external_ids: manifest.rows.map((row) => row.native_role_external_id) }),
    invoke: (request) => ({ ...matchingInvocation(request), observed_native_role_external_id: null }),
  });
  assert.equal(result.records[1].result, "failed");
  assert.equal(result.records[1].provenance.reason, "missing-observed-identity");
});

test("E6 fails when a started Codex scenario times out", () => {
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest: nativeManifest("codex"),
    capabilityPort: codexCapabilityPort(),
    invoke: () => ({ started: true, timed_out: true }),
  });
  assert.equal(result.records[1].result, "failed");
  assert.equal(result.records[1].provenance.reason, "scenario-timeout");
});

test("E6 fails when an invocation observation has a stale projection digest", () => {
  const manifest = nativeManifest("codex");
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest,
    capabilityPort: codexCapabilityPort(),
    invoke: (request) => ({ ...matchingInvocation(request), projected_tree_digest: "e".repeat(64) }),
  });
  assert.equal(result.records[1].result, "failed");
  assert.equal(result.records[1].provenance.reason, "digest-mismatch");
});

test("E6 fails when the role-specific behavior is wrong despite matching identity", () => {
  const manifest = nativeManifest("codex");
  const result = probeCodex({
    now: NOW,
    run: availableVersion,
    provenance: nativeProvenance("codex"),
    manifest,
    capabilityPort: codexCapabilityPort(),
    invoke: (request) => ({ ...matchingInvocation(request), behavior: "wrong-behavior" }),
  });
  assert.equal(result.records[1].result, "failed");
  assert.equal(result.records[1].provenance.reason, "wrong-behavior");
});

test("E5 and E6 native evidence requires complete projection provenance and renews on every binding", () => {
  const nativeEvidence = createEvidenceRecord({
    target: "codex",
    capability: "E5",
    hostVersion: "1.2.3",
    scenario: "codex-e5-v1",
    result: "passed",
    timestamp: "2026-07-14T19:00:00.000Z",
    expiresAt: "2026-07-15T19:00:00.000Z",
    provenance: nativeProvenance("codex"),
  });
  for (const changed of [
    { sourceVersion: "2.2.2" },
    { overlayId: "maister/codex-next" },
    { schemaVersion: 2 },
    { projectorVersion: "2.0.0" },
    { canonicalSetDigest: "e".repeat(64) },
    { manifestDigest: "f".repeat(64) },
    { projectedTreeDigest: "0".repeat(64) },
  ]) {
    assert.equal(evidenceNeedsRenewal(nativeEvidence, {
      now: NOW,
      hostVersion: "1.2.3",
      sourceCommit: NATIVE_BINDING.source_commit,
      sourceVersion: NATIVE_BINDING.source_version,
      overlayId: NATIVE_BINDING.overlay_id,
      overlayVersion: NATIVE_BINDING.overlay_version,
      scenarioVersion: NATIVE_BINDING.scenario_version,
      schemaVersion: NATIVE_BINDING.schema_version,
      projectorVersion: NATIVE_BINDING.projector_version,
      canonicalSetDigest: NATIVE_BINDING.canonical_set_digest,
      manifestDigest: NATIVE_BINDING.manifest_digest,
      projectedTreeDigest: NATIVE_BINDING.projected_tree_digest,
      ...changed,
    }), true);
  }
  assert.throws(() => createEvidenceRecord({
    target: "codex", capability: "E6", hostVersion: "1.2.3", scenario: "codex-e6-v1", result: "passed",
    provenance: { ...nativeProvenance("codex"), manifest_digest: undefined },
  }), /E_EVIDENCE_SCHEMA/);
});

test("structural evidence cannot satisfy native discovery or invocation support", () => {
  const records = ["E1", "E2", "E3", "E4"].map((capability) => record({ capability }));
  const result = evaluateCapability({
    target: "codex",
    capability: "native_support",
    capabilityClass: "semantic",
    requiredEvidence: ["E1", "E2", "E3", "E4", "E5", "E6"],
    records,
    now: NOW,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missing, ["E5", "E6"]);
});

test("fails closed for semantic capabilities but permits packaging provisional status", () => {
  const records = [
    record({ target: "kiro-cli", capability: "E1" }),
    record({ target: "kiro-cli", capability: "E2" }),
    record({ target: "kiro-cli", capability: "E5", result: "unavailable" }),
  ];
  const semantic = evaluateCapability({
    target: "kiro-cli",
    capability: "native_discovery",
    capabilityClass: "semantic",
    requiredEvidence: ["E1", "E2", "E5"],
    records,
    now: NOW,
  });
  const packaging = evaluateCapability({
    target: "kiro-cli",
    capability: "native_discovery",
    capabilityClass: "packaging",
    requiredEvidence: ["E1", "E2", "E5"],
    records,
    now: NOW,
  });
  assert.equal(semantic.status, "blocked");
  assert.equal(packaging.status, "provisional");
  assert.equal(packaging.passed, false);
});

test("classifies only explicitly versioned packaging parity and reports zero unresolved differences", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-parity-"));
  const legacy = path.join(root, "legacy");
  const materialized = path.join(root, "materialized");
  fs.mkdirSync(path.join(legacy, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(materialized, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "runtime.mjs"), "same\n");
  fs.writeFileSync(path.join(materialized, "runtime.mjs"), "same\n");
  fs.writeFileSync(path.join(legacy, "hooks", "hooks.json"), "legacy-packaging\n");
  fs.writeFileSync(path.join(materialized, "hooks", "hooks.json"), "new-packaging\n");
  const baseline = {
    schema_version: 2,
    baseline_version: "2026-07-14.1",
    target: "codex",
    rules: [{
      id: "codex-hook-manifest-packaging",
      path: "hooks/hooks.json",
      category: "packaging",
      observed_category: "hook",
      rationale: "The host hook manifest is a target-owned packaging projection; portable runtime files remain byte-identical.",
      observation: {
        legacy: fileObservation("legacy-packaging\n"),
        materialized: fileObservation("new-packaging\n"),
      },
    }],
  };
  assert.equal(validateParityBaseline(baseline).target, "codex");
  const clean = compareShadowParity({
    target: "codex",
    legacyRoot: legacy,
    materializedRoot: materialized,
    baseline,
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.unresolved.length, 0);
  assert.equal(clean.expected.length, 1);

  const baselinePath = path.join(root, "reviewed-baseline.json");
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  const cli = spawnSync(process.execPath, [
    path.resolve("plugins/maister/bin/shadow-parity.mjs"),
    "--target", "codex",
    "--legacy-root", legacy,
    "--materialized-root", materialized,
    "--baseline", baselinePath,
  ], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).baseline_version, "2026-07-14.1");

  fs.writeFileSync(path.join(materialized, "runtime.mjs"), "semantic drift\n");
  const drift = compareShadowParity({
    target: "codex",
    legacyRoot: legacy,
    materializedRoot: materialized,
    baseline,
  });
  assert.equal(drift.ok, false);
  assert.ok(drift.unresolved.some((difference) => difference.path === "runtime.mjs"));

  const malformed = { ...baseline, rules: [{ ...baseline.rules[0], path: undefined, pattern: "**" }] };
  assert.throws(() => validateParityBaseline(malformed), /E_PARITY_BASELINE_SCOPE/);
  assert.throws(
    () => validateParityBaseline({
      ...baseline,
      rules: [{
        ...baseline.rules[0],
        id: "duplicate-exact-paths",
        path: undefined,
        paths: ["runtime.mjs", "runtime.mjs"],
      }],
    }),
    /E_PARITY_BASELINE_SCOPE/,
  );
  assert.throws(
    () => validateParityBaseline({
      ...baseline,
      rules: [{
        ...baseline.rules[0],
        observation: {
          legacy: fileObservation("same\n"),
          materialized: { ...fileObservation("same\n"), sha256: "not-a-fingerprint" },
        },
      }],
    }),
    /E_PARITY_BASELINE_OBSERVATION/,
  );
  assert.throws(() => validateParityBaseline({ ...baseline, rules: [{ ...baseline.rules[0], category: "semantic" }] }), /E_PARITY_BASELINE_CATEGORY/);
  assert.throws(() => validateParityBaseline({ ...baseline, rules: [{ ...baseline.rules[0], observed_category: "unknown" }] }), /E_PARITY_BASELINE_CATEGORY/);

  const stale = {
    ...baseline,
    rules: [{
      ...baseline.rules[0],
      path: "hooks/stale.sh",
      observation: { legacy: absentObservation(), materialized: absentObservation() },
    }],
  };
  assert.throws(
    () => compareShadowParity({ target: "codex", legacyRoot: legacy, materializedRoot: materialized, baseline: stale }),
    /E_PARITY_BASELINE_STALE/,
  );
  const wrongCategory = {
    ...baseline,
    rules: [{
      ...baseline.rules[0],
      path: "runtime.mjs",
      observed_category: "inventory",
      observation: { legacy: fileObservation("same\n"), materialized: fileObservation("same\n") },
    }],
  };
  assert.throws(
    () => compareShadowParity({ target: "codex", legacyRoot: legacy, materializedRoot: materialized, baseline: wrongCategory }),
    /E_PARITY_BASELINE_CATEGORY/,
  );

  const permissionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-parity-permissions-"));
  const permissionLegacy = path.join(permissionRoot, "legacy");
  const permissionMaterialized = path.join(permissionRoot, "materialized");
  fs.mkdirSync(path.join(permissionLegacy, "bin"), { recursive: true });
  fs.mkdirSync(path.join(permissionMaterialized, "bin"), { recursive: true });
  fs.writeFileSync(path.join(permissionLegacy, "bin", "run.sh"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(permissionMaterialized, "bin", "run.sh"), "#!/bin/sh\n");
  fs.chmodSync(path.join(permissionLegacy, "bin", "run.sh"), 0o755);
  fs.chmodSync(path.join(permissionMaterialized, "bin", "run.sh"), 0o644);
  assert.throws(
    () => compareShadowParity({
      target: "codex",
      legacyRoot: permissionLegacy,
      materializedRoot: permissionMaterialized,
      baseline: {
        schema_version: 2,
        baseline_version: "2026-07-14.1",
        target: "codex",
        rules: [{
          id: "unsafe-executable-mode",
          path: "bin/run.sh",
          category: "packaging",
          observed_category: "permission",
          rationale: "An executable hook or script must never be accepted as an ordinary legacy mode difference.",
          observation: {
            legacy: fileObservation("#!/bin/sh\n", "0755"),
            materialized: fileObservation("#!/bin/sh\n", "0644"),
          },
        }],
      },
    }),
    /E_PARITY_BASELINE_PERMISSION/,
  );

  const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-parity-stale-"));
  const staleLegacy = path.join(staleRoot, "legacy");
  const staleMaterialized = path.join(staleRoot, "materialized");
  fs.mkdirSync(path.join(staleLegacy, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(staleMaterialized, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(staleLegacy, "hooks", "observed.json"), "legacy\n");
  fs.writeFileSync(path.join(staleMaterialized, "hooks", "observed.json"), "candidate\n");
  const multiPathBaseline = {
    schema_version: 2,
    baseline_version: "2026-07-14.1",
    target: "codex",
    rules: [{
      id: "multi-path-hook-packaging",
      paths: ["hooks/observed.json", "hooks/stale.json"],
      category: "packaging",
      observed_category: "hook",
      rationale: "Each exact hook path is independently reviewed and must be observed in the legacy comparison.",
      observations: {
        "hooks/observed.json": {
          legacy: fileObservation("legacy\n"),
          materialized: fileObservation("candidate\n"),
        },
        "hooks/stale.json": {
          legacy: absentObservation(),
          materialized: absentObservation(),
        },
      },
    }],
  };
  assert.throws(
    () => compareShadowParity({ target: "codex", legacyRoot: staleLegacy, materializedRoot: staleMaterialized, baseline: multiPathBaseline }),
    /E_PARITY_BASELINE_STALE/,
  );

  const patternRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-parity-pattern-"));
  const patternLegacy = path.join(patternRoot, "legacy");
  const patternMaterialized = path.join(patternRoot, "materialized");
  fs.mkdirSync(patternLegacy, { recursive: true });
  fs.mkdirSync(path.join(patternMaterialized, "skills", "foo"), { recursive: true });
  fs.writeFileSync(path.join(patternMaterialized, "skills", "foo", "a.txt"), "a\n");
  fs.writeFileSync(path.join(patternMaterialized, "skills", "foo", "b.txt"), "b\n");
  const patternRule = {
    id: "constrained-pattern-packaging",
    pattern: "skills/foo/**",
    max_matches: 1,
    category: "packaging",
    observed_category: "inventory",
    rationale: "This constrained pattern is reviewed for at most one target-owned packaging entry.",
    observations: {
      "skills/foo/a.txt": { legacy: absentObservation(), materialized: fileObservation("a\n") },
      "skills/foo/b.txt": { legacy: absentObservation(), materialized: fileObservation("b\n") },
    },
  };
  assert.throws(
    () => compareShadowParity({
      target: "codex",
      legacyRoot: patternLegacy,
      materializedRoot: patternMaterialized,
      baseline: { schema_version: 2, baseline_version: "2026-07-14.1", target: "codex", rules: [patternRule] },
    }),
    /E_PARITY_BASELINE_MATCHES/,
  );
  assert.throws(
    () => validateParityBaseline({
      schema_version: 2,
      baseline_version: "2026-07-14.1",
      target: "codex",
      rules: [{ ...patternRule, max_matches: 0 }],
    }),
    /E_PARITY_BASELINE_SCOPE/,
  );
  assert.throws(
    () => compareShadowParity({
      target: "codex",
      legacyRoot: patternLegacy,
      materializedRoot: patternMaterialized,
      baseline: {
        schema_version: 2,
        baseline_version: "2026-07-14.1",
        target: "codex",
        rules: [{ ...patternRule, pattern: "skills/never/**", observations: { "skills/never/none.txt": { legacy: absentObservation(), materialized: fileObservation("none\n") } } }],
      },
    }),
    /E_PARITY_BASELINE_STALE/,
  );

  const strictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-parity-observation-"));
  const strictLegacy = path.join(strictRoot, "legacy");
  const strictMaterialized = path.join(strictRoot, "materialized");
  fs.mkdirSync(strictLegacy, { recursive: true });
  fs.mkdirSync(strictMaterialized, { recursive: true });
  const semanticPath = path.join(strictLegacy, "semantic.txt");
  const semanticCandidate = path.join(strictMaterialized, "semantic.txt");
  fs.writeFileSync(semanticPath, "legacy semantic\n");
  fs.writeFileSync(semanticCandidate, "candidate semantic\n");
  const semanticBaseline = {
    schema_version: 2,
    baseline_version: "2026-07-14.1",
    target: "codex",
    rules: [{
      id: "semantic-packaging",
      path: "semantic.txt",
      category: "packaging",
      observed_category: "semantic",
      rationale: "This exact path has a reviewed host packaging projection with immutable content fingerprints.",
      observation: {
        legacy: fileObservation("legacy semantic\n"),
        materialized: fileObservation("candidate semantic\n"),
      },
    }],
  };
  assert.equal(compareShadowParity({ target: "codex", legacyRoot: strictLegacy, materializedRoot: strictMaterialized, baseline: semanticBaseline }).ok, true);
  fs.writeFileSync(semanticCandidate, "tampered semantic\n");
  assert.throws(
    () => compareShadowParity({ target: "codex", legacyRoot: strictLegacy, materializedRoot: strictMaterialized, baseline: semanticBaseline }),
    /E_PARITY_BASELINE_OBSERVATION/,
  );

  const inventoryBaseline = {
    schema_version: 2,
    baseline_version: "2026-07-14.1",
    target: "codex",
    rules: [{
      id: "legacy-only-inventory",
      path: "legacy-only.txt",
      category: "expected-deletion",
      observed_category: "inventory",
      rationale: "This exact file is reviewed as legacy-only and must not appear as a candidate-only addition.",
      observation: { legacy: fileObservation("legacy-only\n"), materialized: absentObservation() },
    }],
  };
  const inventoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-parity-inventory-"));
  const inventoryLegacy = path.join(inventoryRoot, "legacy");
  const inventoryMaterialized = path.join(inventoryRoot, "materialized");
  fs.mkdirSync(inventoryLegacy, { recursive: true });
  fs.mkdirSync(inventoryMaterialized, { recursive: true });
  fs.writeFileSync(path.join(inventoryLegacy, "legacy-only.txt"), "legacy-only\n");
  assert.equal(compareShadowParity({ target: "codex", legacyRoot: inventoryLegacy, materializedRoot: inventoryMaterialized, baseline: inventoryBaseline }).ok, true);
  fs.unlinkSync(path.join(inventoryLegacy, "legacy-only.txt"));
  fs.writeFileSync(path.join(inventoryMaterialized, "legacy-only.txt"), "legacy-only\n");
  assert.throws(
    () => compareShadowParity({ target: "codex", legacyRoot: inventoryLegacy, materializedRoot: inventoryMaterialized, baseline: inventoryBaseline }),
    /E_PARITY_BASELINE_OBSERVATION/,
  );

  const modeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-parity-mode-"));
  const modeLegacy = path.join(modeRoot, "legacy");
  const modeMaterialized = path.join(modeRoot, "materialized");
  fs.mkdirSync(modeLegacy, { recursive: true });
  fs.mkdirSync(modeMaterialized, { recursive: true });
  const permissionPath = path.join(modeLegacy, "ordinary.md");
  const permissionCandidate = path.join(modeMaterialized, "ordinary.md");
  fs.writeFileSync(permissionPath, "ordinary\n");
  fs.writeFileSync(permissionCandidate, "ordinary\n");
  fs.chmodSync(permissionPath, 0o644);
  fs.chmodSync(permissionCandidate, 0o600);
  const permissionBaseline = {
    schema_version: 2,
    baseline_version: "2026-07-14.1",
    target: "codex",
    rules: [{
      id: "ordinary-mode-normalization",
      path: "ordinary.md",
      category: "packaging",
      observed_category: "permission",
      rationale: "This exact ordinary document has a reviewed non-executable mode normalization.",
      observation: { legacy: fileObservation("ordinary\n", "0644"), materialized: fileObservation("ordinary\n", "0600") },
    }],
  };
  assert.equal(compareShadowParity({ target: "codex", legacyRoot: modeLegacy, materializedRoot: modeMaterialized, baseline: permissionBaseline }).ok, true);
  fs.chmodSync(permissionCandidate, 0o666);
  assert.throws(
    () => compareShadowParity({ target: "codex", legacyRoot: modeLegacy, materializedRoot: modeMaterialized, baseline: permissionBaseline }),
    /E_PARITY_BASELINE_OBSERVATION/,
  );

  const expected = {
    codex: ["skills/init/SKILL.md", "skills/orchestrator-framework/references/host-capabilities.yml"],
    cursor: [
        "skills/maister-init/SKILL.md",
        "skills/maister-init/bin/reconcile-advisor-config.sh",
        "skills/maister-migration/references/migration-strategies.md",
        "skills/maister-migration/references/migration-types.md",
        "skills/maister-standards-discover/references/docs-extractor-prompt.md",
    ],
    "kiro-cli": [
        "hooks/.gitkeep",
        "hooks/post-compact-reminder-stub.sh",
        "skills/grill-me/SKILL.md",
        "skills/grill-with-docs/SKILL.md",
        "skills/init/SKILL.md",
        "skills/migration/SKILL.md",
        "skills/performance/SKILL.md",
        "skills/quick-bugfix/SKILL.md",
        "skills/quick-dev/SKILL.md",
        "skills/quick-plan/SKILL.md",
        "skills/research/SKILL.md",
        "skills/standards-discover/SKILL.md",
        "skills/standards-update/SKILL.md",
        "skills/thermos/SKILL.md",
    ],
  };
  for (const [target, sentinels] of Object.entries(expected)) {
    const baseline = loadParityBaseline(`plugins/maister/overlays/${target}/parity-baseline.json`, target);
    assertParityBaselineInvariants(baseline);
    const paths = baseline.rules.filter((rule) => rule.pattern === undefined).map((rule) => rule.path);
    assert.deepEqual(
      sentinels.filter((value) => paths.includes(value)),
      sentinels,
    );
  }
});

test("rejects final topology containing Claude, generated trees, or legacy references", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-topology-"));
  fs.mkdirSync(path.join(root, "plugins", "maister-codex"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "install from plugins/maister-codex\n");
  assert.throws(
    () => assertCleanTopology({
      root,
      forbiddenPaths: ["plugins/maister-codex"],
      forbiddenPatterns: ["Claude", "plugins/maister-codex"],
    }),
    /E_TOPOLOGY_STALE/,
  );
});

test("repository topology ignores operator residue but scans untracked and force-added ignored files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-repository-topology-"));
  runGit(root, ["init", "--quiet"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".idea/\n");
  fs.writeFileSync(path.join(root, "README.md"), "portable topology\n");
  fs.mkdirSync(path.join(root, ".idea"), { recursive: true });
  fs.writeFileSync(path.join(root, ".idea", "workspace.xml"), "plugins/maister-codex\n");
  runGit(root, ["add", ".gitignore", "README.md"]);

  assert.deepEqual(assertCleanRepositoryTopology({ root }).violations, []);

  const untracked = path.join(root, "stale-reference.md");
  fs.writeFileSync(untracked, "install from plugins/maister-codex\n");
  assert.throws(() => assertCleanRepositoryTopology({ root }), /E_TOPOLOGY_STALE/u);
  fs.rmSync(untracked);

  runGit(root, ["add", "--force", ".idea/workspace.xml"]);
  assert.throws(() => assertCleanRepositoryTopology({ root }), /E_TOPOLOGY_STALE/u);
});

test("repository topology fails closed when Git enumeration is unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-non-repository-topology-"));
  assert.throws(
    () => assertCleanRepositoryTopology({ root }),
    (error) => error?.code === "E_TOPOLOGY_GIT",
  );
});

test("the real repository topology and focused Make entry point use only registered hosts", () => {
  const topology = spawnSync(process.execPath, [
    path.resolve("plugins/maister/bin/shadow-parity.mjs"),
    "--topology",
    "--root", path.resolve("."),
  ], { encoding: "utf8" });
  assert.equal(topology.status, 0, topology.stderr);
  assert.deepEqual(JSON.parse(topology.stdout).violations, []);

  const releaseInterface = fs.readFileSync("plugins/maister/bin/release-interface.mjs", "utf8");
  assert.match(releaseInterface, /assertCleanRepositoryTopology\(\{ root: ROOT \}\)/u);
  assert.doesNotMatch(releaseInterface, /plugins\/maister-\(\?:codex\|cursor\|kiro\)/u);

  const makefile = fs.readFileSync("Makefile", "utf8");
  assert.doesNotMatch(makefile, /^SUPPORTED_TARGETS\s*[:?+]?=/mu);
  assert.match(makefile, /\$\(origin SUPPORTED_TARGETS\)/u);
  assert.match(makefile, /SUPPORTED_TARGETS is not configurable/u);
  assert.match(makefile, /^test-platform-independent:$/mu);
  assert.match(makefile, /node --test \$\(filter-out tests\/platform-independent\/installer-transaction\.test\.mjs,\$\(wildcard tests\/platform-independent\/\*\.test\.mjs\)\)/u);
  assert.match(makefile, /^validate: check-cursor-projection$/mu);
  assert.match(makefile, /release-interface\.mjs validate-overlays/u);
  assert.match(makefile, /^package: check-cursor-projection$/mu);
  assert.match(makefile, /generate-cursor-skills\.mjs --check/u);
  assert.doesNotMatch(makefile, /generated[-_]tree|maister-(?:codex|cursor|kiro)(?:\s|\/|$)/iu);

  const validationWorkflow = fs.readFileSync(".github/workflows/validate-generated-variants.yml", "utf8");
  for (const target of SUPPORTED_TARGET_IDS) {
    assert.match(validationWorkflow, new RegExp(`make test-overlay TARGET=${target}`, "u"));
  }
  assert.match(validationWorkflow, /make test-core test-runtime test-pi test-evidence/u);
  assert.match(validationWorkflow, /make test-topology/u);

  const releaseWorkflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
  for (const target of SUPPORTED_TARGET_IDS) {
    assert.match(releaseWorkflow, new RegExp(`make package TARGET=${target}`, "u"));
  }
  for (const document of ["README.md", "docs/README.md"]) {
    const content = fs.readFileSync(document, "utf8");
    assert.match(content, /common source/u, document);
    assert.match(content, /overlays/u, document);
    assert.match(content, /test-topology/u, document);
  }
});
