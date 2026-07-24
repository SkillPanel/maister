import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  e3AttestationDigest,
  portableCoreTreeHash,
  validateE3Attestation,
} from "../../plugins/maister/lib/distribution/e3-attestation.mjs";
import {
  E3GeneratorError,
  generateE3Attestation,
} from "../../plugins/maister/bin/generate-e3-attestation.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const SOURCE_DATE_EPOCH = 1784073600;

function tempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function generatorOptions(output, overrides = {}) {
  return {
    root: ROOT,
    output,
    sourceCommit: SOURCE_COMMIT,
    sourceVersion: "2.2.1",
    testCommand: "make test-core",
    result: "passed",
    sourceDateEpoch: SOURCE_DATE_EPOCH,
    ...overrides,
  };
}

test("generates deterministic, strictly bound portable-core E3 evidence", () => {
  const root = tempDirectory("maister-e3-generator-");
  const first = generateE3Attestation(generatorOptions(path.join(root, "first.json")));
  const second = generateE3Attestation(generatorOptions(path.join(root, "second.json")));
  const firstBytes = fs.readFileSync(first.output, "utf8");
  const secondBytes = fs.readFileSync(second.output, "utf8");

  assert.equal(firstBytes, secondBytes);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.attestation, validateE3Attestation(first.attestation));
  assert.equal(first.attestation.source_commit, SOURCE_COMMIT);
  assert.equal(first.attestation.source_version, "2.2.1");
  assert.equal(first.attestation.test_command, "make test-core");
  assert.equal(first.attestation.result, "passed");
  assert.equal(first.attestation.tested_at, "2026-07-15T00:00:00.000Z");
  assert.equal(first.attestation.expires_at, "2026-07-16T00:00:00.000Z");
  assert.equal(first.attestation.portable_core_tree_hash, portableCoreTreeHash(ROOT));
  assert.equal(first.attestation.artifact_digest, first.attestation.portable_core_tree_hash);
  assert.equal(first.digest, e3AttestationDigest(first.attestation));
});

test("portable-core hashes are independent of filesystem permission bits", () => {
  const root = tempDirectory("maister-e3-portable-mode-");
  const common = path.join(root, "common");
  const nested = path.join(common, "nested");
  fs.mkdirSync(nested, { recursive: true });
  const file = path.join(nested, "core.txt");
  fs.writeFileSync(file, "portable core\n");

  const baseline = portableCoreTreeHash(root);
  if (process.platform !== "win32") {
    fs.chmodSync(common, 0o700);
    fs.chmodSync(nested, 0o711);
    fs.chmodSync(file, 0o755);
  }
  assert.equal(portableCoreTreeHash(root), baseline);
});

test("requires an explicit result and bounds the attestation lifetime", () => {
  const root = tempDirectory("maister-e3-generator-invalid-");
  assert.throws(
    () => generateE3Attestation(generatorOptions(path.join(root, "missing-result.json"), { result: undefined })),
    (error) => error instanceof E3GeneratorError && error.code === "E3_GENERATOR_USAGE" && /never defaulted to passed/u.test(error.message),
  );
  assert.throws(
    () => generateE3Attestation(generatorOptions(path.join(root, "long-lived.json"), {
      expiresAt: "2026-07-22T13:15:14.000Z",
    })),
    (error) => error instanceof E3GeneratorError && error.code === "E3_GENERATOR_USAGE" && /at most seven days/u.test(error.message),
  );
  assert.throws(
    () => generateE3Attestation(generatorOptions(path.join(root, "wrong-commit.json"), {
      sourceCommit: "a".repeat(40),
    })),
    (error) => error instanceof E3GeneratorError && error.code === "E3_GENERATOR_BINDING",
  );
});
