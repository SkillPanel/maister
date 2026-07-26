import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RELEASE_INTERFACE = path.join(ROOT, "plugins/maister/bin/release-interface.mjs");
const SOURCE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

function tempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runMake(argumentsList, env = {}) {
  return spawnSync("make", argumentsList, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function dryRunMake(target) {
  return spawnSync("make", ["-n", "--no-print-directory", target], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function productionMarkerInventory() {
  const source = fs.readFileSync(path.join(ROOT, "plugins/maister/lib/distribution/transaction-manager.mjs"), "utf8");
  const values = (name) => {
    const match = source.match(new RegExp(`const ${name} = (?:(?:Object\\.freeze|new Set)\\()?\\[(?<body>[\\s\\S]*?)\\]\\)?;`, "u"));
    assert.ok(match?.groups?.body, `missing production ${name}`);
    return [...match.groups.body.matchAll(/"([a-z0-9-]+)"/gu)].map((entry) => entry[1]);
  };
  return {
    canonical: values("DURABLE_BOUNDARY_MARKERS"),
    native: values("NATIVE_DURABLE_BOUNDARY_MARKERS"),
  };
}

function exactTestExists(source, name) {
  return source.includes(`test(${JSON.stringify(name)}`);
}

function runInterface(command, env = {}) {
  return spawnSync(process.execPath, [RELEASE_INTERFACE, command], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("fast and slow Make closures select the installer aggregate exactly as owned", () => {
  const expectedCounts = new Map([
    ["test", 0],
    ["validate", 0],
    ["test-targets", 0],
    ["test-platform-independent", 0],
    ["test-install", 1],
    ["test-slow", 1],
  ]);

  for (const [target, expected] of expectedCounts) {
    const result = dryRunMake(target);
    assert.equal(result.status, 0, `${target}: ${result.stdout}\n${result.stderr}`);
    const output = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).join("\n");
    assert.equal(countMatches(output, /(?:^|\s)tests\/platform-independent\/installer-transaction\.test\.mjs(?:\s|$)/gmu), expected, target);
    if (expected === 0) {
      assert.doesNotMatch(output, /tests\/platform-independent\/\*\.test\.mjs/u, `${target} must not use a wildcard capable of selecting the aggregate`);
    }
  }
});

test("PR and release workflows have exactly one explicit slow owner and no alternate owner", () => {
  const validation = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-generated-variants.yml"), "utf8");
  const release = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const scripts = Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {});

  assert.equal(countMatches(validation, /\bmake test-slow\b/gu), 1);
  assert.match(validation, /runs-on: ubuntu-latest[\s\S]*name: .*slow.*installer[\s\S]*run: make test-slow/iu);
  assert.match(validation, /timeout-minutes:\s*(?:1[6-9]|[2-9]\d|\d{3,})\b/u);
  assert.equal(countMatches(release, /\bmake test-slow\b/gu), 1);
  assert.equal(countMatches(release, /node --test tests\/platform-independent\/installer-transaction\.test\.mjs/gu), 0);
  assert.match(release, /launcher-matrix:[\s\S]*matrix:[\s\S]*ubuntu-latest, macos-latest/u);
  assert.doesNotMatch(release, /windows-latest|runner\.os.*Windows|Windows.*installer transaction/iu);
  assert.equal(countMatches(release, /name: Run slow installer transaction coverage\n\s+run: make test-slow/gu), 1);
  assert.match(release, /installer-abrupt-crash\.test\.mjs/u);
  assert.match(release, /installer-multiple-journals\.test\.mjs/u);

  assert.equal(countMatches(validation, /installer-transaction\.test\.mjs/gu), 0, "PR workflow");
  for (const [label, source] of [["PR workflow", validation], ["release workflow", release]]) {
    assert.equal(countMatches(source, /\bmake test-install\b/gu), 0, label);
    assert.equal(countMatches(source, /npm (?:run )?[^\n]*(?:test-slow|test-install)/gu), 0, label);
  }
  assert.equal(scripts.filter((value) => /(?:test-slow|test-install|installer-transaction\.test\.mjs)/u.test(value)).length, 0);
});

test("validation workflow triggers and coverage base protect inventory changes on PRs and pushes", () => {
  const validation = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-generated-variants.yml"), "utf8");
  const inventoryPath = "tests/fixtures/installer-transaction-coverage-owners.json";

  assert.equal(countMatches(validation, new RegExp(inventoryPath.replaceAll(".", "\\."), "gu")), 2);
  assert.match(validation, /PR_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(validation, /PUSH_BEFORE_REF: \$\{\{ github\.event\.before \}\}/u);
  assert.match(validation, /GITHUB_EVENT_NAME.*pull_request[\s\S]*COVERAGE_BASE_REF=.*PR_BASE_REF/u);
  assert.match(validation, /PUSH_BEFORE_REF.*0000000000000000000000000000000000000000[\s\S]*COVERAGE_BASE_REF=.*PUSH_BEFORE_REF/u);
  assert.match(validation, /git rev-parse --verify .*\$\{GITHUB_SHA\}\^/u);
  assert.match(validation, /else\s+echo "::error::[^"]+"\s+exit 1/u);
  assert.match(validation, /COVERAGE_BASE_REF=.*[\s\\]*node --test tests\/platform-independent\/make-interface\.test\.mjs/u);
});

test("coverage-owner inventory is schema-valid and equals production marker ownership", () => {
  const inventoryPath = path.join(ROOT, "tests/fixtures/installer-transaction-coverage-owners.json");
  const rows = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const required = ["id", "disposition", "original_file", "original_line", "original_test", "item_type", "item", "target", "marker", "behavioral_contract", "surviving_file", "surviving_test", "isolation", "verification_command"];
  const ids = new Set();

  assert.ok(Array.isArray(rows) && rows.length > 0);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...required].sort(), row.id);
    assert.match(row.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.equal(ids.has(row.id), false, row.id);
    ids.add(row.id);
    assert.ok(["retain", "combine", "remove"].includes(row.disposition), row.id);
    assert.ok(["assertion", "invocation", "durable-marker", "failure-selector"].includes(row.item_type), row.id);
    assert.ok(["codex", "cursor", "kiro-cli", "pi", null].includes(row.target), row.id);
    assert.ok(["isolated-mutable", "immutable-shareable", "not-applicable"].includes(row.isolation), row.id);
    assert.ok(Number.isInteger(row.original_line) && row.original_line > 0, row.id);
    assert.ok(row.behavioral_contract.trim() && row.verification_command.trim(), row.id);
    for (const file of [row.original_file, row.surviving_file]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${row.id}: ${file}`);
    const owner = fs.readFileSync(path.join(ROOT, row.surviving_file), "utf8");
    assert.equal(exactTestExists(owner, row.surviving_test), true, `${row.id}: ${row.surviving_test}`);
    if (row.disposition === "retain") assert.equal(row.surviving_file, row.original_file, row.id);
    else assert.notEqual(row.surviving_test, row.original_test, row.id);
  }

  const { canonical, native } = productionMarkerInventory();
  const durable = rows.filter(({ item_type }) => item_type === "durable-marker").map(({ item }) => item).sort();
  assert.deepEqual(durable, [...canonical, ...native].sort());
  const selectors = rows.filter(({ item_type }) => item_type === "failure-selector").map(({ marker, item }) => `${marker}:${item}`).sort();
  assert.deepEqual(selectors, canonical.flatMap((marker) => [`${marker}:${marker}`, `${marker}:after-${marker}`]).sort());
});

test("coverage base diff maps aggregate removals bidirectionally", { skip: !process.env.COVERAGE_BASE_REF }, () => {
  const base = process.env.COVERAGE_BASE_REF;
  const aggregate = "tests/platform-independent/installer-transaction.test.mjs";
  const diff = execFileSync("git", ["diff", "--unified=0", base, "--", aggregate], { cwd: ROOT, encoding: "utf8" });
  const removals = [];
  let baseLine = 0;
  for (const line of diff.split(/\r?\n/u)) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/u);
    if (hunk) { baseLine = Number(hunk[1]); continue; }
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (/\binvoke\s*\(/u.test(line)) removals.push({ original_line: baseLine, item_type: "invocation" });
      if (/\bassert\s*\./u.test(line)) removals.push({ original_line: baseLine, item_type: "assertion" });
      baseLine += 1;
    } else if (!line.startsWith("+")) baseLine += 1;
  }
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/installer-transaction-coverage-owners.json"), "utf8"))
    .filter(({ disposition, original_file }) => disposition !== "retain" && original_file === aggregate)
    .map(({ original_line, item_type }) => ({ original_line, item_type }));
  assert.deepEqual(rows.sort((a, b) => a.original_line - b.original_line), removals.sort((a, b) => a.original_line - b.original_line));
});

test("Make delegates caller-controlled release values without shell or inline-JS interpolation", () => {
  const makefile = fs.readFileSync(path.join(ROOT, "Makefile"), "utf8");

  assert.match(makefile, /release-interface\.mjs generate-e3/u);
  assert.match(makefile, /release-interface\.mjs package/u);
  assert.match(makefile, /release-interface\.mjs install/u);
  assert.match(makefile, /export\s+TARGET\s+DIST_DIR\s+SOURCE_DATE_EPOCH/u);
  assert.doesNotMatch(makefile, /node --input-type=module -e/u);
  assert.doesNotMatch(makefile, /--(?:target|source|home|output|source-commit|source-version|test-command|result|scenario-version|expires-at)\s+[^\n]*\$\(/u);
});

test("Make rejects SUPPORTED_TARGETS overrides before evaluating caller syntax", () => {
  const root = tempDirectory("maister-make-supported-targets-");
  const makeFunctionMarker = path.join(root, "make-function-injected");
  const shellMarker = path.join(root, "shell-injected");

  const makeFunction = runMake([
    "validate",
    `SUPPORTED_TARGETS=$(shell touch ${makeFunctionMarker})`,
  ]);
  assert.notEqual(makeFunction.status, 0, `${makeFunction.stdout}\n${makeFunction.stderr}`);
  assert.equal(fs.existsSync(makeFunctionMarker), false, "Make function syntax must not execute");

  const shellSyntax = runMake([
    "validate",
    `SUPPORTED_TARGETS=codex; touch ${shellMarker}; #`,
  ]);
  assert.notEqual(shellSyntax.status, 0, `${shellSyntax.stdout}\n${shellSyntax.stderr}`);
  assert.equal(fs.existsSync(shellMarker), false, "shell metacharacters must not execute");
  assert.match(`${makeFunction.stdout}\n${makeFunction.stderr}\n${shellSyntax.stdout}\n${shellSyntax.stderr}`, /SUPPORTED_TARGETS.*not configurable/u);
});

test("release interface validates every target from the central registry", () => {
  const result = runInterface("validate-overlays");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.targets.map(({ target }) => target), ["codex", "cursor", "kiro-cli", "pi"]);
  assert.equal(payload.targets.every(({ ok }) => ok === true), true);
});

test("Make and release CI keep projection, target checks, evidence, topology, current admission, and package lifecycle in dependency order", () => {
  const makefile = fs.readFileSync(path.join(ROOT, "Makefile"), "utf8");
  const validationWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/validate-generated-variants.yml"), "utf8");
  const releaseWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");

  assert.match(makefile, /test-targets:/u);
  assert.match(makefile, /test-targets:/u);
  assert.match(makefile, /test-materializer\n/u);
  assert.match(makefile, /test-install\n/u);
  assert.match(makefile, /validate: check-cursor-projection/u);
  assert.match(makefile, /test: test-core test-runtime test-pi test-evidence test-current-target-admission test-topology/u);
  assert.match(validationWorkflow, /make test-overlay TARGET=codex/u);
  assert.match(validationWorkflow, /make test-overlay TARGET=cursor/u);
  assert.match(validationWorkflow, /make test-overlay TARGET=kiro-cli/u);
  assert.match(validationWorkflow, /make test-overlay TARGET=pi/u);
  assert.match(validationWorkflow, /make test-current-target-admission/u);
  assert.match(validationWorkflow, /make test-core test-runtime test-pi test-evidence/u);
  assert.match(releaseWorkflow, /make test-core test-runtime/u);
  assert.match(validationWorkflow, /permissions:\s+contents: read/u);
  assert.match(releaseWorkflow, /permissions:\s+contents: read/u);
  assert.match(releaseWorkflow, /github-release:[\s\S]*permissions:\s+contents: write/u);
  assert.match(releaseWorkflow, /public-smoke:\s+needs: github-release/u);
  assert.match(validationWorkflow, /make test-topology/u);
  const projection = releaseWorkflow.indexOf("make validate");
  const admission = releaseWorkflow.indexOf("make test-current-target-admission");
  const e3 = releaseWorkflow.indexOf("make generate-e3-attestation");
  const packageIndex = releaseWorkflow.indexOf("make package TARGET=codex");
  const lifecycle = releaseWorkflow.indexOf("Verify packaged lifecycle and sidecars");
  assert.ok(projection >= 0 && admission > projection && e3 > admission && packageIndex > e3 && lifecycle > packageIndex);
  assert.doesNotMatch(makefile, /test-parity-release|PARITY_ORACLE|PARITY_REPORT/u);
  assert.doesNotMatch(validationWorkflow, /three-target|test-parity-release|parity-release/u);
  assert.doesNotMatch(releaseWorkflow, /three-target|test-parity-release|parity-release/u);
});

test("Make rejects an unsafe package version without executing shell text", () => {
  const root = tempDirectory("maister-make-package-safety-");
  const marker = path.join(root, "package-injected");
  const maliciousVersion = `safe"; touch ${marker}; #`;
  const result = runMake([
    "package",
    "TARGET=codex",
    `DIST_DIR=${path.join(root, "dist")}`,
    `SOURCE_COMMIT=${SOURCE_COMMIT}`,
    `SOURCE_VERSION=${maliciousVersion}`,
    "SOURCE_DATE_EPOCH=1784073600",
  ]);

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(marker), false, "caller text must never execute as shell syntax");
  assert.match(`${result.stdout}\n${result.stderr}`, /E_RELEASE_INTERFACE/u);
});

test("Make rejects an unsafe E3 command without executing shell text", () => {
  const root = tempDirectory("maister-make-e3-safety-");
  const marker = path.join(root, "e3-injected");
  const result = runMake([
    "generate-e3-attestation",
    `E3_OUTPUT=${path.join(root, "e3.json")}`,
    `SOURCE_COMMIT=${SOURCE_COMMIT}`,
    "SOURCE_VERSION=test",
    "E3_RESULT=passed",
    `E3_TEST_COMMAND=make test-core; touch ${marker}; #`,
    "SOURCE_DATE_EPOCH=1784073600",
  ]);

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(marker), false, "attestation command text must never execute as shell syntax");
  assert.match(`${result.stdout}\n${result.stderr}`, /E_RELEASE_INTERFACE/u);
});

test("safe Make release values preserve the generate-then-package interface", () => {
  const root = tempDirectory("maister-make-release-interface-");
  const e3Output = path.join(root, "evidence with spaces", "e3.json");
  const generated = runMake([
    "generate-e3-attestation",
    `E3_OUTPUT=${e3Output}`,
    `SOURCE_COMMIT=${SOURCE_COMMIT}`,
    "SOURCE_VERSION=test",
    "E3_RESULT=passed",
    "E3_TEST_COMMAND=make test-core",
    "SOURCE_DATE_EPOCH=1784073600",
  ]);
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  assert.equal(fs.existsSync(e3Output), true);

  const packaged = runMake([
    "package",
    "TARGET=codex",
    `DIST_DIR=${path.join(root, "package with spaces")}`,
    `SOURCE_COMMIT=${SOURCE_COMMIT}`,
    "SOURCE_VERSION=test",
    "SOURCE_DATE_EPOCH=1784073600",
    `E3_ATTESTATION=${e3Output}`,
  ]);
  assert.equal(packaged.status, 0, `${packaged.stdout}\n${packaged.stderr}`);
  assert.equal(fs.existsSync(path.join(root, "package with spaces", "maister-codex.tar.gz")), true);
});

test("release interface validates command, epoch, and path formats before work", () => {
  const root = tempDirectory("maister-release-interface-validation-");
  const base = {
    E3_OUTPUT: path.join(root, "e3.json"),
    SOURCE_COMMIT,
    SOURCE_VERSION: "test",
    E3_RESULT: "passed",
    E3_TEST_COMMAND: "make test-core",
    SOURCE_DATE_EPOCH: "1784073600",
  };

  const unsafeCommand = runInterface("generate-e3", {
    ...base,
    E3_TEST_COMMAND: "make test-core; touch /tmp/should-not-run",
  });
  assert.notEqual(unsafeCommand.status, 0);
  assert.match(`${unsafeCommand.stdout}\n${unsafeCommand.stderr}`, /E_RELEASE_INTERFACE_COMMAND/u);

  const unsafeEpoch = runInterface("generate-e3", {
    ...base,
    SOURCE_DATE_EPOCH: "1784073600.5",
  });
  assert.notEqual(unsafeEpoch.status, 0);
  assert.match(`${unsafeEpoch.stdout}\n${unsafeEpoch.stderr}`, /E_RELEASE_INTERFACE_EPOCH/u);

  const unsafePath = runInterface("package", {
    ...base,
    TARGET: "codex",
    DIST_DIR: `${root}/bad\npath`,
  });
  assert.notEqual(unsafePath.status, 0);
  assert.match(`${unsafePath.stdout}\n${unsafePath.stderr}`, /E_RELEASE_INTERFACE_PATH/u);
});

test("adversarial strings stay data across Make and the release interface", () => {
  const root = tempDirectory("maister-release-interface-adversarial-");
  const marker = path.join(root, "sentinel");
  const base = {
    SOURCE_COMMIT,
    SOURCE_VERSION: "test",
    E3_RESULT: "passed",
    SOURCE_DATE_EPOCH: "1784073600",
  };
  const hostileVersions = [
    `quoted"value`,
    "line\nbreak",
    "value with spaces",
    `value; touch ${marker}`,
    "value${process.exit()}",
  ];
  for (const value of hostileVersions) {
    const output = path.join(root, `version-${hostileVersions.indexOf(value)}.json`);
    const result = runInterface("generate-e3", {
      ...base,
      E3_OUTPUT: output,
      E3_TEST_COMMAND: "make test-core",
      SOURCE_VERSION: value,
    });
    assert.notEqual(result.status, 0, JSON.stringify({ value, stdout: result.stdout, stderr: result.stderr }));
    assert.match(`${result.stdout}\n${result.stderr}`, /E_RELEASE_INTERFACE_VERSION/u);
  }

  const hostileCommands = [
    `make test-core; touch ${marker}`,
    "make test-core && echo injected",
    "make \"test-core\"",
    "make test-core\n touch sentinel",
    "make test-core }; process.exit() //",
  ];
  for (const value of hostileCommands) {
    const output = path.join(root, `command-${hostileCommands.indexOf(value)}.json`);
    const result = runInterface("generate-e3", {
      ...base,
      E3_OUTPUT: output,
      E3_TEST_COMMAND: value,
    });
    assert.notEqual(result.status, 0, JSON.stringify({ value, stdout: result.stdout, stderr: result.stderr }));
    assert.match(`${result.stdout}\n${result.stderr}`, /E_RELEASE_INTERFACE_COMMAND/u);
  }
  assert.equal(fs.existsSync(marker), false);

  const attestationDirectory = path.join(root, "attestation with spaces", "quote'folder");
  const attestationPath = path.join(attestationDirectory, "e3.json");
  const generated = runInterface("generate-e3", {
    ...base,
    E3_OUTPUT: attestationPath,
    E3_TEST_COMMAND: "make test-core",
  });
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);

  const firstDirectory = path.join(root, "dist with spaces one", "quote'folder");
  const secondDirectory = path.join(root, "dist with spaces two", "quote'folder");
  for (const directory of [firstDirectory, secondDirectory]) {
    const packaged = runInterface("package", {
      ...base,
      TARGET: "codex",
      DIST_DIR: directory,
      E3_ATTESTATION: attestationPath,
    });
    assert.equal(packaged.status, 0, `${packaged.stdout}\n${packaged.stderr}`);
  }
  const firstArchive = path.join(firstDirectory, "maister-codex.tar.gz");
  const secondArchive = path.join(secondDirectory, "maister-codex.tar.gz");
  assert.equal(fs.readFileSync(firstArchive).equals(fs.readFileSync(secondArchive)), true, "safe path punctuation must not affect deterministic packaging");

  for (const value of [
    `attestation; touch ${marker}`,
    "attestation\nwith-newline",
    "attestation${process.exit()}",
  ]) {
    const hostileAttestation = runInterface("package", {
      ...base,
      TARGET: "codex",
      DIST_DIR: path.join(root, "hostile-attestation-dist"),
      E3_ATTESTATION: path.join(root, value, "e3.json"),
    });
    assert.notEqual(hostileAttestation.status, 0);
    assert.match(`${hostileAttestation.stdout}\n${hostileAttestation.stderr}`, /E_RELEASE_INTERFACE_PATH/u);
  }

  for (const value of [
    `dist; touch ${marker}`,
    "dist\nwith-newline",
    "dist${process.exit()}",
  ]) {
    const hostileDirectory = runInterface("package", {
      ...base,
      TARGET: "codex",
      DIST_DIR: path.join(root, value),
      E3_ATTESTATION: attestationPath,
    });
    assert.notEqual(hostileDirectory.status, 0);
    assert.match(`${hostileDirectory.stdout}\n${hostileDirectory.stderr}`, /E_RELEASE_INTERFACE_PATH/u);
  }

  const safeAdmissionReport = runInterface("current-target-admission", {
    CURRENT_TARGET_ADMISSION_REPORT: path.join(root, "report with spaces 'quote'.json"),
  });
  assert.equal(safeAdmissionReport.status, 0, `${safeAdmissionReport.stdout}\n${safeAdmissionReport.stderr}`);

  for (const value of [
    `report; touch ${marker}`,
    "report\nwith-newline",
    "report${process.exit()}",
  ]) {
    const hostileAdmissionReport = runInterface("current-target-admission", {
      CURRENT_TARGET_ADMISSION_REPORT: path.join(root, value),
    });
    assert.notEqual(hostileAdmissionReport.status, 0);
    assert.match(`${hostileAdmissionReport.stdout}\n${hostileAdmissionReport.stderr}`, /E_RELEASE_INTERFACE_PATH/u);
  }
  assert.equal(fs.existsSync(marker), false);
});

test("install arguments are passed through the Node boundary and unsafe targets never execute", () => {
  const root = tempDirectory("maister-make-install-safety-");
  const marker = path.join(root, "install-injected");
  const maliciousTarget = `codex; touch ${marker}; #`;
  const result = runMake([
    "install",
    `TARGET=${maliciousTarget}`,
    `HOME=${path.join(root, "home")}`,
    "MAISTER_ALLOW_DIRTY_LOCAL=1",
  ]);

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(marker), false, "install target text must never execute as shell syntax");
  assert.match(`${result.stdout}\n${result.stderr}`, /E_RELEASE_INTERFACE_TARGET/u);
});
