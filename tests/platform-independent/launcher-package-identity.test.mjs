import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PACKAGE_NAME,
  PACKAGE_REPOSITORY,
  readPackageMetadata,
  readResolvedCommitManifest,
} from "../../lib/launcher/package-contract.mjs";
import {
  prepareResolvedCommit,
  resolvedCommitFromNpmEnvironment,
} from "../../bin/prepare-resolved-commit.mjs";

const VERSION = "2.2.1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TAR_INTEGRITY = "sha512-9FcyK4PA6+WbzlTM9WhQm6vB5W7cP7dUiPsv1g7YDwEQnQ1CGpK3MGlKk/ITVWMk05kHZuBhmVhiv8LZoy/PFQ==";
const MANIFEST_NAME = ".maister-resolved-commit.json";
const TEMP_PREFIX = `${MANIFEST_NAME}.tmp-`;

function createPackageRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-package-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: PACKAGE_NAME,
    version: VERSION,
    repository: {
      type: "git",
      url: "git+https://github.com/mateuszrapacz/maister.git",
    },
  }, null, 2)}\n`);
  return root;
}

function validManifest(overrides = {}) {
  return {
    schema_version: 1,
    repository: PACKAGE_REPOSITORY,
    package_version: VERSION,
    resolved_commit: COMMIT,
    ...overrides,
  };
}

function writeManifest(root, manifest = validManifest()) {
  const manifestPath = path.join(root, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  return manifestPath;
}

test("root Git package is private, exact, and carries only its runtime closure", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));

  assert.equal(packageJson.name, PACKAGE_NAME);
  assert.equal(packageJson.private, true);
  assert.equal(Object.hasOwn(packageJson, "publishConfig"), false);
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.bin, { maister: "bin/maister.mjs" });
  assert.deepEqual(packageJson.engines, { node: ">=22" });
  assert.deepEqual(packageJson.dependencies, { tar: "7.5.20" });
  assert.equal(packageLock.packages["node_modules/tar"].version, "7.5.20");
  assert.equal(packageLock.packages["node_modules/tar"].integrity, TAR_INTEGRITY);

  assert.equal(packageJson.scripts.prepare, "node bin/prepare-resolved-commit.mjs");
  for (const lifecycle of [
    "prepublish", "prepublishOnly", "prepack", "postpack", "publish", "postpublish",
    "preinstall", "install", "postinstall",
  ]) {
    assert.equal(Object.hasOwn(packageJson.scripts, lifecycle), false, `${lifecycle} must be absent`);
  }

  assert.deepEqual(packageJson.files, [
    MANIFEST_NAME,
    "bin/maister.mjs",
    "lib/launcher/**",
    "plugins/maister/lib/distribution/cli-contract.mjs",
    "plugins/maister/lib/distribution/e3-attestation.mjs",
    "plugins/maister/lib/distribution/evidence-schema.mjs",
    "plugins/maister/lib/distribution/hash-tree.mjs",
    "plugins/maister/lib/distribution/path-safety.mjs",
    "plugins/maister/lib/distribution/provenance.mjs",
    "plugins/maister/lib/distribution/targets.mjs",
    "README.md",
    "LICENSE",
  ]);
  for (const entry of packageJson.files) {
    assert.doesNotMatch(entry, /(?:^|\/)(?:\.git|\.maister\/tasks|tests|fixtures|dist|settings|secrets)(?:\/|$)/u);
    assert.equal(entry.includes(TEMP_PREFIX), false);
  }
  assert.equal(packageJson.files.includes("bin/prepare-resolved-commit.mjs"), false);
});

test("prepare records the actual checkout commit with the fixed bounded Git request", async (t) => {
  const packageRoot = createPackageRoot(t);
  const requests = [];

  const manifest = await prepareResolvedCommit({
    packageRoot,
    async runCommand(request) {
      requests.push(request);
      return {
        code: 0,
        signal: null,
        stdout: Buffer.from(`${COMMIT}\n`),
        stderr: Buffer.alloc(0),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    },
  });

  assert.deepEqual(requests, [{
    executable: "git",
    argv: ["rev-parse", "--verify", "HEAD^{commit}"],
    shell: false,
    cwd: fs.realpathSync(packageRoot),
    timeoutMs: 5_000,
    maxStdoutBytes: 128,
    maxStderrBytes: 8_192,
  }]);
  assert.deepEqual(manifest, validManifest());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(packageRoot, MANIFEST_NAME), "utf8")), validManifest());
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(packageRoot, MANIFEST_NAME)).mode & 0o777, 0o600);
  }
  assert.deepEqual(fs.readdirSync(packageRoot).filter((name) => name.startsWith(TEMP_PREFIX)), []);
});

test("prepare accepts npm's immutable GitHub resolution when npm materializes a tarball without .git", async (t) => {
  const packageRoot = createPackageRoot(t);

  assert.equal(
    resolvedCommitFromNpmEnvironment({
      npm_package_resolved: "git+https://github.com/" + PACKAGE_REPOSITORY + ".git#" + COMMIT,
    }),
    COMMIT,
  );
  assert.equal(
    resolvedCommitFromNpmEnvironment({
      _PACOTE_NO_PREPARE_: "git+ssh://git@github.com/" + PACKAGE_REPOSITORY + ".git#" + COMMIT,
    }),
    COMMIT,
  );
  assert.equal(
    resolvedCommitFromNpmEnvironment({
      npm_package_resolved: "git+https://github.com/" + PACKAGE_REPOSITORY + ".git#v2.2.2",
    }),
    null,
  );

  const manifest = await prepareResolvedCommit({
    packageRoot,
    environment: {
      npm_package_resolved: "git+https://github.com/" + PACKAGE_REPOSITORY + ".git#" + COMMIT,
    },
    async runCommand() {
      return {
        code: 128,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("fatal: not a git repository\n"),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    },
  });

  assert.deepEqual(manifest, validManifest());
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(packageRoot, MANIFEST_NAME), "utf8")), validManifest());
});

test("failed atomic replacement preserves a prior manifest and cleans only the owned temporary", async (t) => {
  const packageRoot = createPackageRoot(t);
  const manifestPath = writeManifest(packageRoot);
  const original = fs.readFileSync(manifestPath);

  await assert.rejects(prepareResolvedCommit({
    packageRoot,
    async runCommand() {
      return {
        code: 0,
        signal: null,
        stdout: Buffer.from(`${COMMIT}\n`),
        stderr: Buffer.alloc(0),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    },
    renameFile() {
      throw new Error("injected rename failure");
    },
  }), { kind: "E_LAUNCHER_PACKAGE_IDENTITY" });

  assert.deepEqual(fs.readFileSync(manifestPath), original);
  assert.deepEqual(fs.readdirSync(packageRoot).filter((name) => name.startsWith(TEMP_PREFIX)), []);
});

test("runtime no-follow accepts only the closed four-field manifest", (t) => {
  const packageRoot = createPackageRoot(t);
  writeManifest(packageRoot);

  assert.deepEqual(readResolvedCommitManifest(packageRoot, VERSION), validManifest());
  assert.deepEqual(readPackageMetadata(new URL(`file://${path.join(packageRoot, "package.json")}`)), {
    name: PACKAGE_NAME,
    version: VERSION,
    root: fs.realpathSync(packageRoot),
    resolvedCommit: COMMIT,
  });

  for (const invalid of [
    validManifest({ schema_version: 2 }),
    validManifest({ repository: "someone/else" }),
    validManifest({ package_version: "2.2.0" }),
    validManifest({ resolved_commit: COMMIT.toUpperCase() }),
    validManifest({ unexpected: true }),
  ]) {
    writeManifest(packageRoot, invalid);
    assert.throws(() => readResolvedCommitManifest(packageRoot, VERSION), {
      kind: "E_LAUNCHER_PACKAGE_IDENTITY",
    });
  }
});

test("runtime rejects missing, non-regular, and symlinked commit manifests", (t) => {
  const packageRoot = createPackageRoot(t);
  const manifestPath = path.join(packageRoot, MANIFEST_NAME);

  assert.throws(() => readResolvedCommitManifest(packageRoot, VERSION), {
    kind: "E_LAUNCHER_PACKAGE_IDENTITY",
  });

  fs.mkdirSync(manifestPath);
  assert.throws(() => readResolvedCommitManifest(packageRoot, VERSION), {
    kind: "E_LAUNCHER_PACKAGE_IDENTITY",
  });
  fs.rmdirSync(manifestPath);

  const targetPath = path.join(packageRoot, "manifest-target.json");
  fs.writeFileSync(targetPath, `${JSON.stringify(validManifest())}\n`);
  try {
    fs.symlinkSync(targetPath, manifestPath);
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) {
      t.skip("symlink creation is unavailable");
      return;
    }
    throw error;
  }
  assert.throws(() => readResolvedCommitManifest(packageRoot, VERSION), {
    kind: "E_LAUNCHER_PACKAGE_IDENTITY",
  });
});
