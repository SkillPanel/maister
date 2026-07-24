import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PACKAGE_NAME,
  readPackageMetadata,
} from "./package-contract.mjs";

const TAR_VERSION = "7.5.20";
const TAR_INTEGRITY = "sha512-9FcyK4PA6+WbzlTM9WhQm6vB5W7cP7dUiPsv1g7YDwEQnQ1CGpK3MGlKk/ITVWMk05kHZuBhmVhiv8LZoy/PFQ==";
const EXPECTED_FILES = Object.freeze([
  ".maister-resolved-commit.json",
  "bin/maister.mjs",
  "bin/prepare-resolved-commit.mjs",
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
const EXPECTED_SCRIPTS = Object.freeze({
  prepare: "node bin/prepare-resolved-commit.mjs",
  postinstall: "node bin/prepare-resolved-commit.mjs",
  validate: "node lib/launcher/verify-package-boundary.mjs",
  "test:launcher": "node --test tests/platform-independent/launcher-*.test.mjs",
});
const FORBIDDEN_FILE_ENTRY = /(?:^|\/)(?:\.git|\.maister(?:\/tasks)?|tests|fixtures|dist|settings|secrets)(?:\/|$)/u;
const PUBLICATION_LIFECYCLES = Object.freeze([
  "prepublish",
  "prepublishOnly",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
  "preinstall",
  "install",
]);

function boundaryError(message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.kind = "E_LAUNCHER_PACKAGE_BOUNDARY";
  return error;
}

function requireBoundary(condition, message) {
  if (!condition) throw boundaryError(message);
}

function readJson(filePath, label) {
  try {
    const stat = fs.lstatSync(filePath);
    requireBoundary(!stat.isSymbolicLink() && stat.isFile(), `${label} must be a no-follow regular file`);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (cause) {
    if (cause?.kind === "E_LAUNCHER_PACKAGE_BOUNDARY") throw cause;
    throw boundaryError(`${label} could not be read`, cause);
  }
}

export function verifyPackageBoundary(packageRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))) {
  const root = path.resolve(packageRoot);
  const packageJsonPath = path.join(root, "package.json");
  const packageLockPath = path.join(root, "package-lock.json");
  const packageJson = readJson(packageJsonPath, "package.json");
  const packageLock = readJson(packageLockPath, "package-lock.json");
  const metadata = readPackageMetadata(pathToFileURL(packageJsonPath));

  requireBoundary(metadata.name === PACKAGE_NAME, "package name is invalid");
  requireBoundary(packageJson.private === true, "root Git package must be private");
  requireBoundary(!Object.hasOwn(packageJson, "publishConfig"), "publishConfig is prohibited");
  requireBoundary(packageJson.type === "module", "root Git package must be ESM");
  requireBoundary(
    JSON.stringify(packageJson.bin) === JSON.stringify({ maister: "bin/maister.mjs" }),
    "root Git package must expose one maister binary",
  );
  requireBoundary(packageJson.engines?.node === ">=22", "root Git package must require Node >=22");
  requireBoundary(
    JSON.stringify(packageJson.dependencies) === JSON.stringify({ tar: TAR_VERSION }),
    "tar@7.5.20 must be the sole exact normal dependency",
  );
  requireBoundary(
    JSON.stringify(packageJson.files) === JSON.stringify(EXPECTED_FILES),
    "package runtime files allowlist is invalid",
  );
  for (const entry of packageJson.files) {
    requireBoundary(!FORBIDDEN_FILE_ENTRY.test(entry), `package files allowlist includes forbidden payload: ${entry}`);
    requireBoundary(!entry.includes(".maister-resolved-commit.json.tmp-"), "producer temporaries are prohibited");
  }
  requireBoundary(packageJson.files.includes("bin/prepare-resolved-commit.mjs"), "postinstall producer must ship at runtime");

  requireBoundary(
    JSON.stringify(packageJson.scripts) === JSON.stringify(EXPECTED_SCRIPTS),
    "package scripts must contain only the approved prepare and validation commands",
  );
  for (const lifecycle of PUBLICATION_LIFECYCLES) {
    requireBoundary(!Object.hasOwn(packageJson.scripts, lifecycle), `package lifecycle ${lifecycle} is prohibited`);
  }

  requireBoundary(packageLock.name === PACKAGE_NAME, "lockfile package name is invalid");
  requireBoundary(packageLock.version === metadata.version, "lockfile package version is invalid");
  requireBoundary(
    JSON.stringify(packageLock.packages?.[""]?.dependencies) === JSON.stringify({ tar: TAR_VERSION }),
    "lockfile root dependency contract is invalid",
  );
  requireBoundary(packageLock.packages?.["node_modules/tar"]?.version === TAR_VERSION, "locked tar version is invalid");
  requireBoundary(packageLock.packages?.["node_modules/tar"]?.integrity === TAR_INTEGRITY, "locked tar integrity is invalid");
  return Object.freeze({
    packageVersion: metadata.version,
    resolvedCommit: metadata.resolvedCommit,
  });
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  try {
    verifyPackageBoundary();
  } catch (error) {
    process.stderr.write(`Maister package validation failed (${error?.kind ?? "E_LAUNCHER_PACKAGE_BOUNDARY"}).\n`);
    process.exitCode = 1;
  }
}
