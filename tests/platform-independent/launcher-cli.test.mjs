import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCliArgs, parseLauncherCliArgs } from "../../plugins/maister/lib/distribution/cli-contract.mjs";
import { readPackageMetadata, validatePackageVersion, validateRuntimeVersion } from "../../lib/launcher/package-contract.mjs";

const commands = ["install", "update", "status", "verify", "uninstall", "rollback", "recover"];
const targets = ["codex", "cursor", "kiro-cli"];

test("public launcher accepts only the seven commands and three explicit targets", () => {
  for (const command of commands) {
    for (const target of targets) {
      assert.deepEqual(parseLauncherCliArgs([command, "--target", target]), { command, target, json: false });
      assert.deepEqual(parseLauncherCliArgs([command, "--target", target, "--json"]), { command, target, json: true });
    }
  }
});

test("public launcher rejects duplicate, positional, equals, alias, and pass-through inputs", () => {
  const rejected = [
    [], ["inspect", "--target", "codex"], ["install"],
    ["install", "--target", "codex", "--target", "codex"],
    ["install", "--target", "codex", "--json", "--json"],
    ["install", "--target=codex"], ["install", "-t", "codex"],
    ["install", "--target", "codex", "tail"], ["install", "--target", "codex", "--", "tail"],
    ...["--source", "--ref", "--home", "--attestation", "--failure-point", "--version", "--repository", "--url"].map((flag) => ["install", "--target", "codex", flag, "value"]),
  ];
  for (const argv of rejected) assert.throws(() => parseLauncherCliArgs(argv), { kind: "E_LAUNCHER_USAGE" }, argv.join(" "));
});

test("installer recovery accepts an operator-only UUID journal selector", () => {
  const journalId = "00000000-0000-4000-8000-000000000001";
  const parsed = parseCliArgs(["recover", "--target", "codex", "--journal-id", journalId], {});
  assert.equal(parsed.command, "recover");
  assert.equal(parsed.target, "codex");
  assert.equal(parsed.journalId, journalId);
  assert.throws(() => parseCliArgs(["status", "--target", "codex", "--journal-id", journalId], {}), { kind: "E_USAGE" });
});

test("public launcher accepts one canonical journal selector only for recover", () => {
  const journalId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseLauncherCliArgs(["recover", "--target", "codex", "--journal-id", journalId]), {
    command: "recover",
    target: "codex",
    json: false,
    journalId,
  });
  for (const argv of [
    ["status", "--target", "codex", "--journal-id", journalId],
    ["recover", "--target", "codex", "--journal-id", "not-a-uuid"],
    ["recover", "--target", "codex", "--journal-id", journalId, "--journal-id", journalId],
  ]) assert.throws(() => parseLauncherCliArgs(argv), { kind: "E_LAUNCHER_USAGE" });
});

test("package metadata is exact and stable", () => {
  const metadata = readPackageMetadata();
  assert.deepEqual(metadata, {
    name: "@mateuszrapacz/maister",
    version: "2.2.17",
    root: path.resolve("."),
    resolvedCommit: metadata.resolvedCommit,
  });
  assert.match(metadata.resolvedCommit, /^[0-9a-f]{40}$/u);
  for (const invalid of ["v2.2.1", "2.2", "02.2.1", "2.2.1-rc.1", "2.2.1+build", "latest", ""]) {
    assert.throws(() => validatePackageVersion(invalid), { kind: "E_LAUNCHER_PACKAGE_VERSION" });
  }
  assert.equal(validateRuntimeVersion("22.0.0"), "22.0.0");
  assert.throws(() => validateRuntimeVersion("21.9.0"), { kind: "E_LAUNCHER_PACKAGE_RUNTIME" });
});

test("package files allowlist excludes target payloads and task/build state", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.bin.maister, "bin/maister.mjs");
  assert.equal(packageJson.engines.node, ">=22");
  assert.equal(packageJson.dependencies.tar, "7.5.20");
  for (const forbidden of ["dist", ".maister", ".git", "plugins/maister/overlays", "plugins/maister/common"]) {
    assert.equal(packageJson.files.some((entry) => entry === forbidden || entry.startsWith(`${forbidden}/`)), false);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maister-package-contract-"));
  fs.rmSync(scratch, { recursive: true, force: true });
});
