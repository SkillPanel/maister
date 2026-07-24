#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_NAME = "@mateuszrapacz/maister";
const PACKAGE_REPOSITORY = "mateuszrapacz/maister";
const MANIFEST_NAME = ".maister-resolved-commit.json";
const TEMP_PREFIX = `${MANIFEST_NAME}.tmp-`;
const TEMP_PATTERN = /^\.maister-resolved-commit\.json\.tmp-\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const NPM_RESOLVED_COMMIT = /^(?:git\+)?(?:https?|ssh):\/\/(?:git@)?github\.com\/mateuszrapacz\/maister\.git#([0-9a-f]{40})$/u;
const GIT_REQUEST = Object.freeze({
  executable: "git",
  argv: Object.freeze(["rev-parse", "--verify", "HEAD^{commit}"]),
  shell: false,
  timeoutMs: 5_000,
  maxStdoutBytes: 128,
  maxStderrBytes: 8_192,
});

function packageIdentityError(message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.kind = "E_LAUNCHER_PACKAGE_IDENTITY";
  return error;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function captureDirectory(directoryPath) {
  const absolutePath = path.resolve(directoryPath);
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (cause) {
    throw packageIdentityError("package checkout could not be inspected", cause);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw packageIdentityError("package checkout must be a no-follow directory");
  }
  const realPath = fs.realpathSync.native(absolutePath);
  const realStat = fs.lstatSync(realPath);
  if (realStat.isSymbolicLink() || !realStat.isDirectory()) {
    throw packageIdentityError("actual package checkout must be a no-follow directory");
  }
  return Object.freeze({ path: realPath, stat: realStat });
}

function revalidatePathIdentity(filePath, expectedStat, type) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (cause) {
    throw packageIdentityError(`${type} identity could not be revalidated`, cause);
  }
  const validType = type === "package checkout" ? stat.isDirectory() : stat.isFile();
  if (stat.isSymbolicLink() || !validType || !sameIdentity(stat, expectedStat)) {
    throw packageIdentityError(`${type} identity changed during preparation`);
  }
}

function readRegularJson(filePath, label, maxBytes = 16_384) {
  let descriptor;
  try {
    const before = fs.lstatSync(filePath);
    if (before.isSymbolicLink() || !before.isFile() || before.size > maxBytes) {
      throw packageIdentityError(`${label} must be a bounded no-follow regular file`);
    }
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      throw packageIdentityError(`${label} identity changed while opening`);
    }
    const value = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    const after = fs.lstatSync(filePath);
    if (!sameIdentity(opened, after)) {
      throw packageIdentityError(`${label} identity changed while reading`);
    }
    return Object.freeze({ value, stat: after });
  } catch (cause) {
    if (cause?.kind === "E_LAUNCHER_PACKAGE_IDENTITY") throw cause;
    throw packageIdentityError(`${label} could not be read`, cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function validatePackageJson(metadata) {
  if (
    metadata === null
    || typeof metadata !== "object"
    || Array.isArray(metadata)
    || metadata.name !== PACKAGE_NAME
    || typeof metadata.version !== "string"
    || !STABLE_SEMVER.test(metadata.version)
    || metadata.repository?.type !== "git"
    || metadata.repository?.url !== "git+https://github.com/mateuszrapacz/maister.git"
  ) {
    throw packageIdentityError("package metadata identity is invalid");
  }
  return metadata.version;
}

function validateManifest(manifest, packageVersion) {
  const expectedKeys = ["schema_version", "repository", "package_version", "resolved_commit"];
  if (
    manifest === null
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || Object.keys(manifest).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(manifest, key))
    || manifest.schema_version !== 1
    || manifest.repository !== PACKAGE_REPOSITORY
    || manifest.package_version !== packageVersion
    || typeof manifest.resolved_commit !== "string"
    || !FULL_COMMIT.test(manifest.resolved_commit)
  ) {
    throw packageIdentityError("resolved commit manifest identity is invalid");
  }
}

export function resolvedCommitFromNpmEnvironment(environment = process.env) {
  for (const value of [environment.npm_package_resolved, environment._PACOTE_NO_PREPARE_]) {
    if (typeof value !== "string") continue;
    for (const line of value.split(/\r?\n/u)) {
      const match = NPM_RESOLVED_COMMIT.exec(line.trim());
      if (match) return match[1];
    }
  }
  return null;
}

function cleanupStaleProducerTemporaries(packageRoot) {
  for (const name of fs.readdirSync(packageRoot)) {
    if (!name.startsWith(TEMP_PREFIX) || !TEMP_PATTERN.test(name)) continue;
    const candidate = path.join(packageRoot, name);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw packageIdentityError("producer temporary identity is invalid");
    }
    fs.unlinkSync(candidate);
  }
}

function appendBounded(chunks, chunk, currentBytes, maximumBytes, onOverflow) {
  const buffer = Buffer.from(chunk);
  if (currentBytes + buffer.length > maximumBytes) {
    onOverflow();
    return currentBytes;
  }
  chunks.push(buffer);
  return currentBytes + buffer.length;
}

export function runBoundedCommand(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.argv, {
      cwd: request.cwd,
      shell: request.shell,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const stop = () => {
      if (!child.killed) child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, request.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes = appendBounded(stdout, chunk, stdoutBytes, request.maxStdoutBytes, () => {
        stdoutTruncated = true;
        stop();
      });
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes = appendBounded(stderr, chunk, stderrBytes, request.maxStderrBytes, () => {
        stderrTruncated = true;
        stop();
      });
    });
    child.once("error", (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(packageIdentityError("Git commit resolution could not start", cause));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        stdoutTruncated,
        stderrTruncated,
      });
    });
  });
}

export async function prepareResolvedCommit({
  packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  runCommand = runBoundedCommand,
  renameFile = fs.renameSync,
  environment = process.env,
} = {}) {
  const checkout = captureDirectory(packageRoot);
  const packageJsonPath = path.join(checkout.path, "package.json");
  const packageJson = readRegularJson(packageJsonPath, "package metadata");
  const packageVersion = validatePackageJson(packageJson.value);
  const manifestPath = path.join(checkout.path, MANIFEST_NAME);

  cleanupStaleProducerTemporaries(checkout.path);

  let priorManifestStat = null;
  if (fs.existsSync(manifestPath)) {
    const priorManifest = readRegularJson(manifestPath, "resolved commit manifest");
    validateManifest(priorManifest.value, packageVersion);
    priorManifestStat = priorManifest.stat;
  }

  const result = await runCommand({
    ...GIT_REQUEST,
    argv: [...GIT_REQUEST.argv],
    cwd: checkout.path,
  });
  const gitResolvedCommit = result.stdout.toString("utf8").replace(/\n$/u, "");
  const resolvedCommit = (
    result.code === 0
    && result.signal === null
    && !result.timedOut
    && !result.stdoutTruncated
    && !result.stderrTruncated
    && FULL_COMMIT.test(gitResolvedCommit)
    && result.stdout.length === gitResolvedCommit.length + (result.stdout.at(-1) === 0x0a ? 1 : 0)
  )
    ? gitResolvedCommit
    : resolvedCommitFromNpmEnvironment(environment);
  if (!resolvedCommit) {
    throw packageIdentityError("Git did not resolve one lowercase full commit");
  }

  const manifest = Object.freeze({
    schema_version: 1,
    repository: PACKAGE_REPOSITORY,
    package_version: packageVersion,
    resolved_commit: resolvedCommit,
  });
  validateManifest(manifest, packageVersion);

  const temporaryName = `${TEMP_PREFIX}${process.pid}-${crypto.randomUUID()}`;
  const temporaryPath = path.join(checkout.path, temporaryName);
  let descriptor;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    fs.fchmodSync(descriptor, 0o600);
    const temporaryStat = fs.fstatSync(descriptor);
    if (!temporaryStat.isFile()) throw packageIdentityError("producer temporary must be a regular file");
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    revalidatePathIdentity(checkout.path, checkout.stat, "package checkout");
    revalidatePathIdentity(packageJsonPath, packageJson.stat, "package metadata");
    const temporaryLstat = fs.lstatSync(temporaryPath);
    if (temporaryLstat.isSymbolicLink() || !temporaryLstat.isFile() || !sameIdentity(temporaryStat, temporaryLstat)) {
      throw packageIdentityError("producer temporary identity changed before commit");
    }
    if (priorManifestStat === null) {
      if (fs.existsSync(manifestPath)) throw packageIdentityError("resolved commit manifest appeared during preparation");
    } else {
      revalidatePathIdentity(manifestPath, priorManifestStat, "resolved commit manifest");
    }

    renameFile(temporaryPath, manifestPath);
    const committed = readRegularJson(manifestPath, "resolved commit manifest");
    validateManifest(committed.value, packageVersion);
    if (process.platform !== "win32") {
      const directoryDescriptor = fs.openSync(checkout.path, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    }
    return manifest;
  } catch (cause) {
    if (cause?.kind === "E_LAUNCHER_PACKAGE_IDENTITY") throw cause;
    throw packageIdentityError("resolved commit manifest could not be committed", cause);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      const stat = fs.lstatSync(temporaryPath);
      if (!stat.isSymbolicLink() && stat.isFile()) fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  try {
    await prepareResolvedCommit();
  } catch (error) {
    process.stderr.write(`Maister package preparation failed (${error?.kind ?? "E_LAUNCHER_PACKAGE_IDENTITY"}).\n`);
    process.exitCode = 1;
  }
}
