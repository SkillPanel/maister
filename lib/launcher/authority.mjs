import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hashTree } from "../../plugins/maister/lib/distribution/hash-tree.mjs";
import { CLI_CONTRACT_VERSION } from "../../plugins/maister/lib/distribution/cli-contract.mjs";
import { SUPPORTED_TARGET_IDS } from "../../plugins/maister/lib/distribution/targets.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TARGETS = new Set(SUPPORTED_TARGET_IDS);

function authorityError(kind, message, details = {}) {
  const error = new Error(message);
  error.kind = kind;
  error.details = details;
  return error;
}

function fail(message, details = {}) {
  throw authorityError("E_OFFLINE_AUTHORITY", message, details);
}

function migration(message, details = {}) {
  throw authorityError("E_OFFLINE_AUTHORITY_MIGRATION", message, details);
}

function safeLstat(filePath, label, { allowMissing = false } = {}) {
  let stat;
  try { stat = fs.lstatSync(filePath, { throwIfNoEntry: false }); } catch (cause) {
    throw authorityError("E_OFFLINE_AUTHORITY_IO", `${label} could not be read`, { cause: cause.code ?? "io" });
  }
  if (!stat && !allowMissing) fail(`${label} is missing`);
  return stat;
}

function modeIsAuthoritative() {
  // Windows ACLs are not represented by the POSIX mode bits exposed by Node.
  // Keep the file-type, no-follow, identity, and content checks authoritative;
  // the numeric mode itself cannot be used as a security decision there.
  return process.platform !== "win32";
}

function assertPrivateFile(filePath, label) {
  const stat = safeLstat(filePath, label);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular no-follow file`);
  if (modeIsAuthoritative() && (stat.mode & 0o777) !== 0o600) fail(`${label} has an unsafe mode`);
  return stat;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size;
}

function readVerifiedFile(filePath, label, { privateMode = false } = {}) {
  const before = safeLstat(filePath, label);
  if (!before.isFile() || before.isSymbolicLink()) fail(`${label} must be a regular no-follow file`);
  if (modeIsAuthoritative() && privateMode && (before.mode & 0o777) !== 0o600) fail(`${label} has an unsafe mode`);
  if (modeIsAuthoritative() && !privateMode && (before.mode & 0o0022) !== 0) fail(`${label} has group/other write permissions`);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    if (!sameIdentity(before, opened) || !opened.isFile()) fail(`${label} changed while it was opened`);
    const bytes = fs.readFileSync(descriptor);
    const closed = fs.fstatSync(descriptor);
    if (!sameIdentity(opened, closed) || closed.size !== bytes.length) fail(`${label} changed while it was read`);
    return bytes;
  } catch (cause) {
    if (cause?.kind === "E_OFFLINE_AUTHORITY") throw cause;
    throw authorityError("E_OFFLINE_AUTHORITY_IO", `${label} could not be read`, { cause: cause.code ?? "io" });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertClosureFile(filePath, label) {
  const stat = safeLstat(filePath, label);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular no-follow file`);
  if (modeIsAuthoritative() && (stat.mode & 0o0022) !== 0) fail(`${label} has group/other write permissions`);
  return stat;
}

function assertDirectory(directory, label) {
  const stat = safeLstat(directory, label);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a regular no-follow directory`);
  return stat;
}

function readJson(filePath, label) {
  try { return JSON.parse(readVerifiedFile(filePath, label, { privateMode: true }).toString("utf8")); } catch (cause) {
    if (cause?.kind?.startsWith("E_OFFLINE_AUTHORITY")) throw cause;
    throw authorityError("E_OFFLINE_AUTHORITY_SCHEMA", `${label} is not valid JSON`, { cause: cause.name });
  }
}

function contained(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(`${label} escapes the target state root`);
}

function relativeRef(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/") || path.isAbsolute(value)) fail(`${label} must be a relative POSIX path`);
  const normalized = path.posix.normalize(value);
  if (normalized !== value || value.split("/").some((part) => part === "" || part === "." || part === "..")) fail(`${label} is not normalized`);
  return value;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) fail(`${label} has an unexpected schema`);
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(readVerifiedFile(filePath, "control-plane installer")).digest("hex");
}

function validateClosure(root, installerPath, controlPlane, receipt) {
  assertDirectory(root, "control-plane root");
  const rootBefore = fs.lstatSync(root);
  const plan = hashTree(root);
  const rootAfter = fs.lstatSync(root);
  if (!sameIdentity(rootBefore, rootAfter)) fail("control-plane root changed during validation");
  const repeat = hashTree(root);
  if (repeat.contentHash !== plan.contentHash) fail("control-plane closure changed during validation");
  if (plan.entries.some((entry) => entry.type === "symlink")) fail("control-plane closure contains a symlink");
  if (plan.entries.some((entry) => entry.type !== "file" && entry.type !== "directory")) fail("control-plane closure contains an unsupported entry");
  if (plan.contentHash !== controlPlane.tree_hash) fail("control-plane tree hash does not match the active receipt");
  assertClosureFile(installerPath, "control-plane installer");
  if (hashFile(installerPath) !== controlPlane.installer_sha256) fail("control-plane installer hash does not match the active receipt");
  if (controlPlane.cli_contract_version !== CLI_CONTRACT_VERSION) fail("control-plane CLI contract is unsupported");
  if (controlPlane.source_version !== receipt.source.source_version
    || controlPlane.source_commit !== receipt.source.resolved_commit
    || controlPlane.source_content_hash !== receipt.source.content_hash) {
    fail("control-plane source binding does not match the active receipt");
  }
  if (path.relative(root, installerPath) !== "plugins/maister/bin/maister-install.mjs") fail("control-plane installer path is not canonical");
  return Object.freeze({ installerPath, treeHash: plan.contentHash, installerSha256: controlPlane.installer_sha256 });
}

function validateReceipt(receipt, target, paths) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) fail("active receipt is not an object");
  if (receipt.schema_version === 1) migration("active receipt schema v1 requires a clean install");
  if (receipt.schema_version !== 2) fail("active receipt schema is unsupported");
  if (!Object.hasOwn(receipt, "control_plane")) migration("active receipt predates receipt-bound control planes");
  if (!UUID.test(receipt.receipt_id ?? "")) fail("active receipt ID is invalid");
  if (receipt.target?.id !== target) fail("active receipt target does not match the requested target");
  if (!receipt.source || !COMMIT.test(receipt.source.resolved_commit ?? "") || !SHA256.test(receipt.source.content_hash ?? "")) fail("active receipt source binding is invalid");
  const controlPlane = receipt.control_plane;
  exactObject(controlPlane, ["schema_version", "root_ref", "installer_ref", "tree_hash", "installer_sha256", "cli_contract_version", "source_version", "source_commit", "source_content_hash"], "receipt.control_plane");
  if (controlPlane.schema_version !== 1 || !SHA256.test(controlPlane.tree_hash ?? "") || !SHA256.test(controlPlane.installer_sha256 ?? "") || !Number.isSafeInteger(controlPlane.cli_contract_version)) fail("active receipt control-plane schema is invalid");
  if (!COMMIT.test(controlPlane.source_commit ?? "") || !SHA256.test(controlPlane.source_content_hash ?? "") || typeof controlPlane.source_version !== "string") fail("active receipt control-plane source binding is invalid");
  relativeRef(controlPlane.root_ref, "control-plane.root_ref");
  relativeRef(controlPlane.installer_ref, "control-plane.installer_ref");
  if (controlPlane.root_ref !== `control-planes/${receipt.receipt_id}`) fail("control-plane root reference is not receipt-bound");
  if (controlPlane.installer_ref !== `${controlPlane.root_ref}/plugins/maister/bin/maister-install.mjs`) fail("control-plane installer reference is not receipt-bound");
  const receiptPath = path.join(paths.receiptsRoot, `${receipt.receipt_id}.json`);
  const root = path.join(paths.stateRoot, controlPlane.root_ref);
  const installerPath = path.join(paths.stateRoot, controlPlane.installer_ref);
  contained(paths.receiptsRoot, receiptPath, "receipt path");
  contained(paths.controlPlanesRoot, root, "control-plane root");
  contained(paths.controlPlanesRoot, installerPath, "control-plane installer");
  return validateClosure(root, installerPath, controlPlane, receipt);
}

export function getAuthorityPaths({ target, home = os.homedir(), env = process.env }) {
  if (!TARGETS.has(target)) throw authorityError("E_OFFLINE_AUTHORITY_USAGE", "unsupported target", { target });
  const homeRoot = path.resolve(home);
  const stateBase = path.resolve(env.XDG_STATE_HOME || path.join(homeRoot, ".local", "state"));
  const stateRoot = path.join(stateBase, "maister", target);
  return Object.freeze({
    target,
    home: homeRoot,
    stateRoot,
    receiptsRoot: path.join(stateRoot, "receipts"),
    controlPlanesRoot: path.join(stateRoot, "control-planes"),
    activeReceiptPath: path.join(stateRoot, "active-receipt.json"),
  });
}

export function createAuthorityStore({ home = os.homedir(), env = process.env } = {}) {
  return Object.freeze({
    readActiveReceipt(target) {
      const paths = getAuthorityPaths({ target, home, env });
      assertDirectory(paths.stateRoot, "target state root");
      assertDirectory(paths.receiptsRoot, "receipts root");
      assertDirectory(paths.controlPlanesRoot, "control-planes root");
      assertPrivateFile(paths.activeReceiptPath, "active receipt pointer");
      const pointer = readJson(paths.activeReceiptPath, "active receipt pointer");
      exactObject(pointer, ["schema_version", "receipt_id", "receipt_path"], "active receipt pointer");
      if (pointer.schema_version === 1) migration("active receipt pointer schema v1 requires a clean install");
      if (pointer.schema_version !== 2 || !UUID.test(pointer.receipt_id ?? "")) fail("active receipt pointer is invalid");
      const expectedReceiptPath = path.join(paths.receiptsRoot, `${pointer.receipt_id}.json`);
      if (pointer.receipt_path !== expectedReceiptPath) fail("active receipt pointer is not receipt-bound");
      contained(paths.receiptsRoot, pointer.receipt_path, "receipt path");
      const receipt = readJson(pointer.receipt_path, "active receipt");
      const authority = validateReceipt(receipt, target, paths);
      return Object.freeze({ ...authority, receiptPath: pointer.receipt_path, receipt, paths });
    },
  });
}
