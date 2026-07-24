import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertMutationBoundary,
  assertPathIdentity,
  capturePathIdentity,
  distributionError,
  ensureDirectoryPath,
  readFileNoFollow,
  throwDistributionError,
  withMutationBoundary,
} from "./path-safety.mjs";
import { readJournal, validateJournal, appendTransition, isTerminal } from "./journal-schema.mjs";
import { readReceipt, UUID } from "./receipt-schema.mjs";
import { hashFile, hashTree } from "./hash-tree.mjs";
import { resolveTargetSettingPath } from "./target-paths.mjs";

const MODE = /^[0-7]{4}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function flushDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0));
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertContained(root, candidate, label) {
  const rootAbsolute = path.resolve(root);
  const candidateAbsolute = path.resolve(candidate);
  const relative = path.relative(rootAbsolute, candidateAbsolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throwDistributionError("E_RECOVERY_PATH", `${label} escapes its permitted root`, { root: rootAbsolute, candidate: candidateAbsolute });
  }
  return candidateAbsolute;
}

/** Check every existing component without following a pre-existing symlink. */
export function assertSafePath(candidate, { root = null, label = "path", allowMissing = true, allowLeafSymlink = false } = {}) {
  return capturePathIdentity(candidate, {
    root,
    label,
    allowMissing,
    allowLeafSymlink,
    errorCode: "E_RECOVERY_PATH",
  }).path;
}

export function ensureDirectoryTree(directory, { root = null, label = "directory", mode = null, privateMode = false } = {}) {
  const absolute = path.resolve(directory);
  const permittedRoot = path.resolve(root ?? path.dirname(absolute));
  let anchor = permittedRoot;
  while (!fs.lstatSync(anchor, { throwIfNoEntry: false }) && anchor !== path.dirname(anchor)) anchor = path.dirname(anchor);
  const ensured = ensureDirectoryPath(absolute, {
    root: anchor,
    label,
    mode: mode ?? 0o755,
    privateMode,
    errorCode: "E_RECOVERY_PATH",
  });
  flushDirectory(ensured);
  return ensured;
}

function secureRemove(target, options = {}) {
  const absolute = assertSafePath(target, { ...options, allowMissing: true });
  if (!fs.lstatSync(absolute, { throwIfNoEntry: false }) && !fs.lstatSync(path.dirname(absolute), { throwIfNoEntry: false })) return;
  const targetIdentity = capturePathIdentity(absolute, {
    root: options.root,
    label: options.label ?? "path",
    allowMissing: true,
    allowLeafSymlink: options.allowLeafSymlink ?? false,
    errorCode: "E_RECOVERY_PATH",
  });
  assertPathIdentity(targetIdentity, { label: options.label ?? "path", errorCode: "E_RECOVERY_PATH" });
  return withMutationBoundary(absolute, {
    root: options.root ?? path.parse(absolute).root,
    label: options.label ?? "path",
    allowMissing: true,
    allowLeafSymlink: options.allowLeafSymlink ?? false,
    beforeMutation: options.beforeMutation,
    errorCode: "E_RECOVERY_PATH",
  }, (boundary) => {
    assertPathIdentity(targetIdentity, { label: options.label ?? "path", errorCode: "E_RECOVERY_PATH" });
    fs.rmSync(absolute, { recursive: true, force: true });
    if (boundary.parentDescriptor !== null) {
      try { fs.fsyncSync(boundary.parentDescriptor); } catch (error) {
        if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
      }
    } else flushDirectory(path.dirname(absolute));
  });
}

function assertSafeLink(linkPath, destinationRoot) {
  const linkIdentity = capturePathIdentity(linkPath, {
    root: destinationRoot,
    label: "backup symlink",
    allowMissing: false,
    allowLeafSymlink: true,
    errorCode: "E_RECOVERY_PATH",
  });
  const linkTarget = fs.readlinkSync(linkPath);
  assertPathIdentity(linkIdentity, { label: "backup symlink", errorCode: "E_RECOVERY_PATH" });
  if (path.isAbsolute(linkTarget) || linkTarget.includes("\0")) throwDistributionError("E_RECOVERY_PATH", "backup contains an absolute symlink", { linkPath });
  const rootReal = fs.realpathSync(destinationRoot);
  const linkDirectoryReal = fs.realpathSync(path.dirname(linkPath));
  const lexical = path.resolve(linkDirectoryReal, linkTarget);
  assertContained(rootReal, lexical, "backup symlink");
  try {
    assertContained(rootReal, fs.realpathSync(linkPath), "backup symlink");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return linkTarget;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function formatMode(mode) {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

function fingerprintEntry(entryPath, { root, label = "backup entry" } = {}) {
  const absolute = assertSafePath(entryPath, {
    root,
    label,
    allowMissing: true,
    allowLeafSymlink: true,
  });
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isSymbolicLink()) {
    return { type: "symlink", mode: formatMode(stat.mode), target: assertSafeLink(absolute, root ?? path.dirname(absolute)) };
  }
  if (stat.isFile()) {
    return { type: "file", mode: formatMode(stat.mode), sha256: sha256(readFileNoFollow(absolute, { root, label, errorCode: "E_RECOVERY_PATH" })) };
  }
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(absolute).sort().map((name) => ({
      name,
      fingerprint: fingerprintEntry(path.join(absolute, name), { root, label: `${label}/${name}` }),
    }));
    return { type: "directory", mode: formatMode(stat.mode), entries };
  }
  throwDistributionError("E_RECOVERY_BACKUP", `unsupported backup entry type: ${absolute}`, { path: absolute });
}

function manifestPayload(manifest) {
  return {
    schema_version: manifest.schema_version,
    home: manifest.home,
    roots: manifest.roots,
    settings: manifest.settings,
    active_receipt: manifest.active_receipt,
  };
}

function manifestHash(manifest) {
  return sha256(canonical(manifestPayload(manifest)));
}

function snapshotRecord(source, destination, options) {
  const snapshot = snapshotEntry(source, destination, options);
  return {
    ...snapshot,
    fingerprint: snapshot.exists ? fingerprintEntry(destination, { root: options.destinationRoot ?? path.dirname(destination), label: "snapshot fingerprint" }) : null,
  };
}

export function copyTreeEntry(source, destination, { sourceRoot = null, destinationRoot = null } = {}) {
  const sourceAbsolute = assertSafePath(source, { root: sourceRoot, label: "backup source", allowMissing: false, allowLeafSymlink: true });
  const destinationAbsolute = assertSafePath(destination, { root: destinationRoot, label: "backup destination", allowLeafSymlink: true });
  const sourceIdentity = capturePathIdentity(sourceAbsolute, {
    root: sourceRoot,
    label: "backup source",
    allowMissing: false,
    allowLeafSymlink: true,
    errorCode: "E_RECOVERY_PATH",
  });
  return withMutationBoundary(destinationAbsolute, {
    root: destinationRoot ?? path.parse(destinationAbsolute).root,
    label: "backup destination",
    allowMissing: true,
    allowLeafSymlink: true,
    errorCode: "E_RECOVERY_PATH",
  }, (boundary) => {
    const destinationParent = path.dirname(destinationAbsolute);
    ensureDirectoryPath(destinationParent, {
      root: destinationRoot ?? path.dirname(destinationParent),
      label: "backup destination parent",
      mode: null,
      errorCode: "E_RECOVERY_PATH",
    });
    assertPathIdentity(sourceIdentity, { label: "backup source", errorCode: "E_RECOVERY_PATH" });
    assertPathIdentity(boundary.parentSnapshot, { label: "backup destination parent", errorCode: "E_RECOVERY_PATH" });
    const stat = fs.lstatSync(sourceAbsolute);
    const existing = fs.lstatSync(destinationAbsolute, { throwIfNoEntry: false });
    if (existing) secureRemove(destinationAbsolute, { root: destinationRoot, label: "backup destination", allowLeafSymlink: true });
    assertMutationBoundary(boundary, { includeTarget: false });
    if (stat.isSymbolicLink()) {
      const target = assertSafeLink(sourceAbsolute, sourceRoot ?? path.dirname(sourceAbsolute));
      fs.symlinkSync(target, destinationAbsolute);
    } else if (stat.isDirectory()) {
      ensureDirectoryPath(destinationAbsolute, {
        root: destinationRoot ?? destinationParent,
        label: "backup destination",
        mode: stat.mode & 0o7777,
        errorCode: "E_RECOVERY_PATH",
      });
      for (const name of fs.readdirSync(sourceAbsolute).sort()) {
        copyTreeEntry(path.join(sourceAbsolute, name), path.join(destinationAbsolute, name), { sourceRoot: sourceRoot ?? sourceAbsolute, destinationRoot: destinationRoot ?? destinationAbsolute });
      }
      fs.chmodSync(destinationAbsolute, stat.mode & 0o7777);
      flushDirectory(destinationAbsolute);
    } else if (stat.isFile()) {
      const bytes = readFileNoFollow(sourceAbsolute, { root: sourceRoot ?? path.parse(sourceAbsolute).root, label: "backup source", errorCode: "E_RECOVERY_PATH" });
      const noFollow = fs.constants.O_NOFOLLOW ?? 0;
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow;
      let descriptor;
      try {
        try {
          descriptor = fs.openSync(destinationAbsolute, flags, stat.mode & 0o7777);
        } catch (error) {
          if (error.code === "EINVAL" || error.code === "ENOTSUP") descriptor = fs.openSync(destinationAbsolute, flags & ~noFollow, stat.mode & 0o7777);
          else throw error;
        }
        fs.writeFileSync(descriptor, bytes);
        fs.fchmodSync(descriptor, stat.mode & 0o7777);
        fs.fsyncSync(descriptor);
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    } else {
      throwDistributionError("E_RECOVERY_ENTRY", `unsupported backup entry: ${sourceAbsolute}`, { source: sourceAbsolute });
    }
    flushDirectory(path.dirname(destinationAbsolute));
    assertPathIdentity(sourceIdentity, { label: "backup source", errorCode: "E_RECOVERY_PATH" });
  });
}

export function snapshotEntry(source, destination, { sourceRoot = null, destinationRoot = null } = {}) {
  assertSafePath(source, { root: sourceRoot, label: "snapshot source" });
  const stat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!stat) return { exists: false, mode: null };
  copyTreeEntry(source, destination, { sourceRoot, destinationRoot });
  return { exists: true, mode: (stat.mode & 0o7777).toString(8).padStart(4, "0") };
}

function durableJson(filePath, value, mode = 0o600) {
  const parent = path.dirname(filePath);
  return withMutationBoundary(filePath, {
    root: path.dirname(parent),
    label: "durable JSON",
    allowMissing: true,
    errorCode: "E_RECOVERY_PATH",
  }, (boundary) => {
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
    let descriptor;
    try {
      try {
        descriptor = fs.openSync(temporary, flags, mode);
      } catch (error) {
        if (error.code === "EINVAL" || error.code === "ENOTSUP") descriptor = fs.openSync(temporary, flags & ~(fs.constants.O_NOFOLLOW ?? 0), mode);
        else throw error;
      }
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fchmodSync(descriptor, mode);
      fs.fsyncSync(descriptor);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    assertPathIdentity(boundary.parentSnapshot, { label: "durable JSON parent", errorCode: "E_RECOVERY_PATH" });
    fs.renameSync(temporary, filePath);
    if (boundary.parentDescriptor !== null) {
      try { fs.fsyncSync(boundary.parentDescriptor); } catch (error) {
        if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
      }
    } else flushDirectory(parent);
  });
}

function topologySnapshot(home, rootPath) {
  const relative = path.relative(path.resolve(home), path.resolve(rootPath));
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throwDistributionError("E_RECOVERY_PATH", "managed root must be contained by home", { home, rootPath });
  }
  const records = [];
  let current = path.resolve(home);
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) {
      throwDistributionError("E_RECOVERY_PATH", "managed root topology contains a non-directory", { path: current });
    }
    records.push({
      path: path.relative(home, current).split(path.sep).join("/"),
      exists: Boolean(stat),
      mode: stat ? formatMode(stat.mode) : null,
    });
  }
  return records;
}

export function snapshotState({ managedRoots, managedInventory, settings, backupRoot, activeReceiptPath = null, home }) {
  if (!Array.isArray(managedRoots) || managedRoots.length === 0) throwDistributionError("E_RECOVERY_BACKUP", "managed roots are required", {});
  if (!Array.isArray(managedInventory)) throwDistributionError("E_RECOVERY_BACKUP", "managed inventory is required", {});
  ensureDirectoryTree(backupRoot, { root: path.dirname(backupRoot), label: "backup root", mode: 0o700, privateMode: true });
  if (settings.length > 0) ensureDirectoryTree(path.join(backupRoot, "settings"), { root: backupRoot, label: "backup settings root", mode: 0o700, privateMode: true });
  const roots = managedRoots.map((root) => {
    const topology = topologySnapshot(home, root.path);
    if (root.ownership === "whole_tree") {
      const backupPath = path.join(backupRoot, "target");
      return {
        root_id: root.rootId,
        path: root.path,
        ownership: root.ownership,
        topology,
        tree: { ...snapshotRecord(root.path, backupPath, { sourceRoot: home, destinationRoot: backupRoot }), backup_path: backupPath },
        leaves: [],
      };
    }
    const entries = managedInventory
      .filter((entry) => entry.root_id === root.rootId && entry.type !== "directory")
      .sort((left, right) => left.path.localeCompare(right.path));
    const leavesRoot = path.join(backupRoot, "roots", root.rootId, "leaves");
    if (entries.length > 0) ensureDirectoryTree(leavesRoot, { root: backupRoot, label: "leaf backup root", mode: 0o700, privateMode: true });
    const leaves = entries.map((entry, index) => {
      const targetPath = path.join(root.path, ...entry.path.split("/"));
      const backupPath = path.join(leavesRoot, String(index));
      return {
        path: entry.path,
        target_path: targetPath,
        backup_path: backupPath,
        ...snapshotRecord(targetPath, backupPath, { sourceRoot: home, destinationRoot: backupRoot }),
      };
    });
    return { root_id: root.rootId, path: root.path, ownership: root.ownership, topology, tree: null, leaves };
  });
  const settingRecords = [];
  for (const [index, setting] of settings.entries()) {
    const backupPath = path.join(backupRoot, "settings", String(index));
    const snapshot = snapshotRecord(setting.targetPath, backupPath, { sourceRoot: path.dirname(setting.targetPath), destinationRoot: backupRoot });
    settingRecords.push({ path: setting.path, targetPath: setting.targetPath, backupPath, ...snapshot });
  }
  const activeReceiptBackup = path.join(backupRoot, "active-receipt.json");
  const activeReceipt = activeReceiptPath
    ? { path: activeReceiptPath, backupPath: activeReceiptBackup, ...snapshotRecord(activeReceiptPath, activeReceiptBackup, { sourceRoot: path.dirname(activeReceiptPath), destinationRoot: backupRoot }) }
    : { path: null, backupPath: activeReceiptBackup, exists: false, mode: null, fingerprint: null };
  const manifest = { schema_version: 2, home: path.resolve(home), roots, settings: settingRecords, active_receipt: activeReceipt };
  manifest.manifest_hash = manifestHash(manifest);
  durableJson(path.join(backupRoot, "manifest.json"), manifest, 0o600);
  return manifest;
}

function exactFields(value, fields, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throwDistributionError("E_RECOVERY_BACKUP", `${location} must be an object`, { location });
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) throwDistributionError("E_RECOVERY_BACKUP", `${location} has unknown field ${unknown}`, { field: unknown });
  for (const field of fields) if (!Object.hasOwn(value, field)) throwDistributionError("E_RECOVERY_BACKUP", `${location} is missing ${field}`, { field });
}

function validateFingerprint(value, location) {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throwDistributionError("E_RECOVERY_BACKUP", `${location} fingerprint must be an object or null`, { location });
  if (value.type === "file") {
    exactFields(value, ["type", "mode", "sha256"], location);
    if (!MODE.test(value.mode) || !SHA256.test(value.sha256)) throwDistributionError("E_RECOVERY_BACKUP", `${location} file fingerprint is invalid`, { location });
    return;
  }
  if (value.type === "symlink") {
    exactFields(value, ["type", "mode", "target"], location);
    if (!MODE.test(value.mode) || typeof value.target !== "string" || value.target.length === 0 || path.isAbsolute(value.target) || value.target.includes("\0")) throwDistributionError("E_RECOVERY_BACKUP", `${location} symlink fingerprint is invalid`, { location });
    return;
  }
  if (value.type === "directory") {
    exactFields(value, ["type", "mode", "entries"], location);
    if (!MODE.test(value.mode) || !Array.isArray(value.entries)) throwDistributionError("E_RECOVERY_BACKUP", `${location} directory fingerprint is invalid`, { location });
    let previous = null;
    for (const [index, entry] of value.entries.entries()) {
      exactFields(entry, ["name", "fingerprint"], `${location}.entries[${index}]`);
      if (typeof entry.name !== "string" || entry.name.length === 0 || entry.name.includes("/") || (previous !== null && previous >= entry.name)) throwDistributionError("E_RECOVERY_BACKUP", `${location} directory topology is invalid`, { location });
      previous = entry.name;
      validateFingerprint(entry.fingerprint, `${location}.entries[${index}].fingerprint`);
    }
    return;
  }
  throwDistributionError("E_RECOVERY_BACKUP", `${location} has an unsupported fingerprint type`, { location });
}

function validateSnapshotRecord(record, location) {
  if (typeof record.exists !== "boolean" || (record.mode !== null && !MODE.test(record.mode))) throwDistributionError("E_RECOVERY_BACKUP", `${location} existence or mode is invalid`, { location });
  validateFingerprint(record.fingerprint, `${location}.fingerprint`);
  if (record.exists !== (record.fingerprint !== null)) throwDistributionError("E_RECOVERY_BACKUP", `${location} existence does not match its fingerprint`, { location });
}

function validateTopology(topology, location, home, expectedRoot) {
  if (!Array.isArray(topology) || topology.length === 0) throwDistributionError("E_RECOVERY_BACKUP", `${location} must be a non-empty array`, { location });
  let previous = null;
  for (const [index, entry] of topology.entries()) {
    exactFields(entry, ["path", "exists", "mode"], `${location}[${index}]`);
    if (typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.split("/").some((part) => !part || part === "." || part === "..")) throwDistributionError("E_RECOVERY_BACKUP", `${location} contains an unsafe path`, { path: entry.path });
    if (typeof entry.exists !== "boolean" || (entry.mode !== null && !MODE.test(entry.mode)) || entry.exists !== (entry.mode !== null)) throwDistributionError("E_RECOVERY_BACKUP", `${location} contains invalid topology state`, { path: entry.path });
    const absolute = path.resolve(home, ...entry.path.split("/"));
    assertContained(home, absolute, "backup topology");
    if (previous && path.dirname(absolute) !== previous) throwDistributionError("E_RECOVERY_BACKUP", `${location} is not a contiguous parent chain`, {});
    previous = absolute;
  }
  if (path.resolve(previous) !== path.resolve(expectedRoot)) throwDistributionError("E_RECOVERY_BACKUP", `${location} does not terminate at its managed root`, {});
}

function expectedSettingTargetPath(setting, paths) {
  if (paths) return resolveTargetSettingPath(paths, setting.path);
  return setting.targetPath;
}

function validateManifest(manifest, backupRoot, paths = null) {
  exactFields(manifest, ["schema_version", "home", "roots", "settings", "active_receipt", "manifest_hash"], "backup manifest");
  if (manifest.schema_version !== 2) throwDistributionError("E_RECOVERY_BACKUP", "backup manifest schema_version must be 2", {});
  if (!SHA256.test(manifest.manifest_hash) || manifest.manifest_hash !== manifestHash(manifest)) throwDistributionError("E_RECOVERY_BACKUP", "backup manifest integrity hash is invalid", {});
  const backupAbsolute = path.resolve(backupRoot);
  assertSafePath(backupAbsolute, { root: path.dirname(backupAbsolute), label: "backup root", allowMissing: false });
  if (!path.isAbsolute(manifest.home) || path.normalize(manifest.home) !== manifest.home || (paths && manifest.home !== paths.home)) throwDistributionError("E_RECOVERY_BACKUP", "backup home does not match target", {});
  if (!Array.isArray(manifest.roots) || manifest.roots.length === 0) throwDistributionError("E_RECOVERY_BACKUP", "backup roots must be a non-empty array", {});
  for (const [rootIndex, root] of manifest.roots.entries()) {
    const location = `backup roots[${rootIndex}]`;
    exactFields(root, ["root_id", "path", "ownership", "topology", "tree", "leaves"], location);
    const expected = paths?.managedRoots?.[rootIndex];
    if (typeof root.root_id !== "string" || !path.isAbsolute(root.path) || path.normalize(root.path) !== root.path) throwDistributionError("E_RECOVERY_BACKUP", `${location} identity is invalid`, {});
    if (!new Set(["whole_tree", "leaf_set"]).has(root.ownership)) throwDistributionError("E_RECOVERY_BACKUP", `${location} ownership is invalid`, {});
    if (expected && (root.root_id !== expected.rootId || root.path !== expected.path || root.ownership !== expected.ownership)) throwDistributionError("E_RECOVERY_BACKUP", `${location} does not match target paths`, {});
    validateTopology(root.topology, `${location}.topology`, manifest.home, root.path);
    if (!Array.isArray(root.leaves)) throwDistributionError("E_RECOVERY_BACKUP", `${location}.leaves must be an array`, {});
    if (root.ownership === "whole_tree") {
      if (root.leaves.length !== 0 || !root.tree) throwDistributionError("E_RECOVERY_BACKUP", `${location} whole-tree snapshot is invalid`, {});
      exactFields(root.tree, ["exists", "mode", "fingerprint", "backup_path"], `${location}.tree`);
      validateSnapshotRecord(root.tree, `${location}.tree`);
      if (root.tree.backup_path !== path.join(backupAbsolute, "target")) throwDistributionError("E_RECOVERY_BACKUP", `${location}.tree backup path is invalid`, {});
    } else {
      if (root.tree !== null) throwDistributionError("E_RECOVERY_BACKUP", `${location} leaf-set tree must be null`, {});
      for (const [leafIndex, leaf] of root.leaves.entries()) {
        const leafLocation = `${location}.leaves[${leafIndex}]`;
        exactFields(leaf, ["path", "target_path", "backup_path", "exists", "mode", "fingerprint"], leafLocation);
        if (typeof leaf.path !== "string" || path.isAbsolute(leaf.path) || leaf.path.split("/").some((part) => !part || part === "." || part === "..")) throwDistributionError("E_RECOVERY_BACKUP", `${leafLocation}.path is unsafe`, {});
        if (leaf.target_path !== path.join(root.path, ...leaf.path.split("/"))) throwDistributionError("E_RECOVERY_BACKUP", `${leafLocation}.target_path is invalid`, {});
        if (leaf.backup_path !== path.join(backupAbsolute, "roots", root.root_id, "leaves", String(leafIndex))) throwDistributionError("E_RECOVERY_BACKUP", `${leafLocation}.backup_path is invalid`, {});
        validateSnapshotRecord(leaf, leafLocation);
      }
    }
  }
  if (!Array.isArray(manifest.settings)) throwDistributionError("E_RECOVERY_BACKUP", "backup settings must be an array", {});
  for (const [index, setting] of manifest.settings.entries()) {
    exactFields(setting, ["path", "targetPath", "backupPath", "exists", "mode", "fingerprint"], `backup settings[${index}]`);
    if (typeof setting.path !== "string" || path.isAbsolute(setting.path) || setting.path.split("/").some((part) => !part || part === "." || part === "..")) throwDistributionError("E_RECOVERY_BACKUP", "backup setting path is invalid", { path: setting.path });
    if (path.normalize(setting.backupPath) !== setting.backupPath || setting.backupPath !== path.join(backupAbsolute, "settings", String(index))) throwDistributionError("E_RECOVERY_BACKUP", "backup setting path is invalid", { path: setting.backupPath });
    validateSnapshotRecord(setting, `backup settings[${index}]`);
    const expectedTargetPath = expectedSettingTargetPath(setting, paths);
    if (!path.isAbsolute(setting.targetPath) || path.normalize(setting.targetPath) !== setting.targetPath || path.resolve(setting.targetPath) !== path.resolve(expectedTargetPath)) throwDistributionError("E_RECOVERY_BACKUP", "backup setting target is outside home", { path: setting.targetPath });
    assertSafePath(setting.targetPath, { root: paths?.home ?? path.dirname(setting.targetPath), label: "backup setting target" });
  }
  exactFields(manifest.active_receipt, ["path", "backupPath", "exists", "mode", "fingerprint"], "backup active receipt");
  if (manifest.active_receipt.path !== null) {
    if (!path.isAbsolute(manifest.active_receipt.path) || path.normalize(manifest.active_receipt.path) !== manifest.active_receipt.path || (paths && path.resolve(manifest.active_receipt.path) !== path.resolve(paths.activeReceiptPath))) throwDistributionError("E_RECOVERY_BACKUP", "backup active receipt path does not match target", {});
    assertSafePath(manifest.active_receipt.path, { root: paths?.stateRoot ?? path.dirname(manifest.active_receipt.path), label: "backup active receipt" });
  }
  if (path.normalize(manifest.active_receipt.backupPath) !== manifest.active_receipt.backupPath || manifest.active_receipt.backupPath !== path.join(backupAbsolute, "active-receipt.json")) throwDistributionError("E_RECOVERY_BACKUP", "backup active receipt backup path is invalid", {});
  validateSnapshotRecord(manifest.active_receipt, "backup active receipt");
  return manifest;
}

function assertFingerprint(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) throwDistributionError("E_RECOVERY_BACKUP", `${label} does not match its recorded backup fingerprint`, { label });
}

function verifyManifestContents(manifest, backupRoot) {
  const backupAbsolute = path.resolve(backupRoot);
  const expectedTopLevel = ["manifest.json"];
  const wholeTree = manifest.roots.find((root) => root.ownership === "whole_tree");
  if (wholeTree?.tree.exists) expectedTopLevel.push("target");
  if (manifest.roots.some((root) => root.ownership === "leaf_set" && root.leaves.length > 0)) expectedTopLevel.push("roots");
  if (manifest.settings.length > 0) expectedTopLevel.push("settings");
  if (manifest.active_receipt.exists) expectedTopLevel.push("active-receipt.json");
  const actualTopLevel = fs.readdirSync(backupAbsolute).sort();
  expectedTopLevel.sort();
  if (canonical(actualTopLevel) !== canonical(expectedTopLevel)) throwDistributionError("E_RECOVERY_BACKUP", "backup topology contains unrecorded residue", { expected: expectedTopLevel, actual: actualTopLevel });
  if (wholeTree) assertFingerprint(fingerprintEntry(wholeTree.tree.backup_path, { root: backupAbsolute, label: "backup target" }), wholeTree.tree.fingerprint, "backup target");
  for (const root of manifest.roots.filter((entry) => entry.ownership === "leaf_set")) {
    for (const [index, leaf] of root.leaves.entries()) {
      assertFingerprint(fingerprintEntry(leaf.backup_path, { root: backupAbsolute, label: `backup ${root.root_id} leaf[${index}]` }), leaf.fingerprint, `backup ${root.root_id} leaf[${index}]`);
    }
  }
  for (const [index, setting] of manifest.settings.entries()) {
    assertFingerprint(fingerprintEntry(setting.backupPath, { root: backupAbsolute, label: `backup setting[${index}]` }), setting.fingerprint, `backup setting[${index}]`);
  }
  assertFingerprint(fingerprintEntry(manifest.active_receipt.backupPath, { root: backupAbsolute, label: "backup active receipt" }), manifest.active_receipt.fingerprint, "backup active receipt");
  return manifest;
}

export function readManifest(backupRoot, { paths = null } = {}) {
  try {
    const backupAbsolute = path.resolve(backupRoot);
    assertSafePath(backupAbsolute, { root: path.dirname(backupAbsolute), label: "backup root", allowMissing: false });
    const manifest = JSON.parse(readFileNoFollow(path.join(backupRoot, "manifest.json"), {
      root: backupAbsolute,
      label: "backup manifest",
      encoding: "utf8",
      errorCode: "E_RECOVERY_PATH",
    }));
    return verifyManifestContents(validateManifest(manifest, backupRoot, paths), backupRoot);
  } catch (error) {
    if (error?.kind === "E_RECOVERY_BACKUP") throw error;
    throw distributionError("E_RECOVERY_BACKUP", `could not read backup manifest: ${backupRoot}`, { backupRoot }, { cause: error });
  }
}

export function restoreFullBackup(backupRoot, { paths = null, expectedManifestHash = null } = {}) {
  const manifest = readManifest(backupRoot, { paths });
  if (expectedManifestHash !== null && expectedManifestHash !== manifest.manifest_hash) throwDistributionError("E_RECOVERY_BACKUP", "backup manifest hash does not match the transaction record", { backupRoot });
  const home = paths?.home ?? manifest.home;
  for (const root of manifest.roots) {
    if (root.ownership === "whole_tree") {
      secureRemove(root.path, { root: home, label: `restore ${root.root_id}` });
      if (root.tree.exists) copyTreeEntry(root.tree.backup_path, root.path, { sourceRoot: root.tree.backup_path, destinationRoot: home });
      continue;
    }
    for (const leaf of [...root.leaves].sort((left, right) => right.path.length - left.path.length)) {
      secureRemove(leaf.target_path, { root: home, label: `restore ${root.root_id} leaf`, allowLeafSymlink: true });
    }
    for (const leaf of root.leaves.filter((entry) => entry.exists)) {
      copyTreeEntry(leaf.backup_path, leaf.target_path, { sourceRoot: path.dirname(leaf.backup_path), destinationRoot: home });
    }
  }
  for (const setting of manifest.settings) {
    secureRemove(setting.targetPath, { root: home, label: "restore setting" });
    if (setting.exists) copyTreeEntry(setting.backupPath, setting.targetPath, { sourceRoot: path.dirname(setting.backupPath), destinationRoot: home });
  }
  const receipt = manifest.active_receipt;
  if (receipt.path) {
    secureRemove(receipt.path, { root: paths?.stateRoot ?? path.dirname(receipt.path), label: "restore active receipt" });
    if (receipt.exists) copyTreeEntry(receipt.backupPath, receipt.path, { sourceRoot: path.dirname(receipt.backupPath), destinationRoot: paths?.stateRoot ?? path.dirname(receipt.path) });
  }
  for (const topology of manifest.roots.flatMap((root) => [root.topology])) {
    for (const entry of topology.filter((item) => item.exists)) {
      const directory = path.join(home, ...entry.path.split("/"));
      ensureDirectoryTree(directory, { root: path.dirname(directory), label: "restore managed-root topology", mode: Number.parseInt(entry.mode, 8) });
      fs.chmodSync(directory, Number.parseInt(entry.mode, 8));
    }
    for (const entry of [...topology].reverse().filter((item) => !item.exists)) {
      const directory = path.join(home, ...entry.path.split("/"));
      const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) throwDistributionError("E_RECOVERY_FAILURE", "managed-root topology restore found a non-directory", { path: directory });
        try { fs.rmdirSync(directory); } catch (error) {
          if (!['ENOENT'].includes(error.code)) throwDistributionError("E_RECOVERY_FAILURE", "managed-root topology could not be restored exactly", { path: directory }, { cause: error });
        }
      }
    }
  }
  verifyManifestContents(manifest, backupRoot);
  for (const root of manifest.roots) {
    if (root.ownership === "whole_tree") {
      assertFingerprint(fingerprintEntry(root.path, { root: home, label: `restored ${root.root_id}` }), root.tree.exists ? root.tree.fingerprint : null, `restored ${root.root_id}`);
    } else {
      for (const leaf of root.leaves) assertFingerprint(fingerprintEntry(leaf.target_path, { root: home, label: `restored ${root.root_id} leaf` }), leaf.exists ? leaf.fingerprint : null, `restored ${root.root_id} leaf`);
    }
  }
  for (const setting of manifest.settings) assertFingerprint(fingerprintEntry(setting.targetPath, { root: paths?.home ?? path.dirname(setting.targetPath), label: "restored setting" }), setting.exists ? setting.fingerprint : null, "restored setting");
  if (manifest.active_receipt.path) assertFingerprint(fingerprintEntry(manifest.active_receipt.path, { root: paths?.stateRoot ?? path.dirname(manifest.active_receipt.path), label: "restored active receipt" }), manifest.active_receipt.exists ? manifest.active_receipt.fingerprint : null, "restored active receipt");
  return manifest;
}

function cleanupRecoveryResidue(journal, paths) {
  const residue = [journal.stage_root, path.join(paths.receiptsRoot, `${journal.journal_id}.json`), journal.control_plane?.destination_path].filter(Boolean);
  for (const candidate of residue) {
    const root = candidate === journal.stage_root
      ? paths.stagingRoot
      : candidate === journal.control_plane?.destination_path ? paths.controlPlanesRoot : paths.receiptsRoot;
    removeEntry(candidate, { root, label: "recovery residue" });
  }
}

function referencedControlPlaneIds(paths) {
  const referenced = new Set();
  for (const name of fs.readdirSync(paths.receiptsRoot).filter((entry) => entry.endsWith(".json")).sort()) {
    if (!UUID.test(path.basename(name, ".json"))) {
      throwDistributionError("E_CONTROL_PLANE_CLEANUP", "receipt filename is not safe for control-plane reference analysis", { name }, { retryable: true });
    }
    const receipt = readReceipt(path.join(paths.receiptsRoot, name), { paths });
    if (receipt.control_plane) referenced.add(path.posix.basename(receipt.control_plane.root_ref));
  }
  for (const name of fs.readdirSync(paths.journalsRoot).filter((entry) => entry.endsWith(".json")).sort()) {
    if (!UUID.test(path.basename(name, ".json"))) {
      throwDistributionError("E_CONTROL_PLANE_CLEANUP", "journal filename is not safe for control-plane reference analysis", { name }, { retryable: true });
    }
    const journal = readJournal(path.join(paths.journalsRoot, name), { paths });
    if (journal.control_plane) referenced.add(path.posix.basename(journal.control_plane.root_ref));
    if (journal.candidate_receipt?.control_plane) referenced.add(path.posix.basename(journal.candidate_receipt.control_plane.root_ref));
  }
  return referenced;
}

export function pruneUnreferencedControlPlanes(paths) {
  const referenced = referencedControlPlaneIds(paths);
  const pruned = [];
  for (const name of fs.readdirSync(paths.controlPlanesRoot).sort()) {
    if (!UUID.test(name)) {
      throwDistributionError("E_CONTROL_PLANE_CLEANUP", "control-plane root contains an unsafe entry", { name }, { retryable: true });
    }
    const candidate = path.join(paths.controlPlanesRoot, name);
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throwDistributionError("E_CONTROL_PLANE_CLEANUP", "control-plane entry is not a private directory", { path: candidate }, { retryable: true });
    }
    if (referenced.has(name)) continue;
    removeEntry(candidate, { root: paths.controlPlanesRoot, label: "unreferenced control-plane" });
    pruned.push(name);
  }
  return Object.freeze(pruned);
}

function validateRecoveryControlPlane(journal, paths) {
  if (!journal.control_plane) return;
  const candidates = [journal.control_plane.stage_path, journal.control_plane.destination_path]
    .filter((candidate) => fs.lstatSync(candidate, { throwIfNoEntry: false }));
  if (candidates.length > 1) {
    throwDistributionError("E_RECOVERY_PATH", "control-plane exists in both staged and promoted locations", { journal_id: journal.journal_id });
  }
  if (candidates.length === 0) return;
  const root = candidates[0];
  const permittedRoot = root === journal.control_plane.stage_path ? journal.stage_root : paths.controlPlanesRoot;
  assertSafePath(root, { root: permittedRoot, label: "recovery control-plane", allowMissing: false });
  const installer = path.join(root, "plugins", "maister", "bin", "maister-install.mjs");
  assertSafePath(installer, { root, label: "recovery control-plane installer", allowMissing: false });
  const installerStat = fs.lstatSync(installer);
  if (!installerStat.isFile() || installerStat.isSymbolicLink()) {
    throwDistributionError("E_RECOVERY_BACKUP", "control-plane installer is not a regular file", { path: installer });
  }
  const treeHash = hashTree(root).contentHash;
  const installerHash = hashFile(installer);
  if (treeHash !== journal.control_plane.tree_hash || installerHash !== journal.control_plane.installer_sha256) {
    throwDistributionError("E_RECOVERY_BACKUP", "control-plane does not match its journal hashes", {
      journal_id: journal.journal_id,
      expected_tree_hash: journal.control_plane.tree_hash,
      actual_tree_hash: treeHash,
      expected_installer_sha256: journal.control_plane.installer_sha256,
      actual_installer_sha256: installerHash,
    });
  }
}

export async function recoverJournal({ journalPath, journal, paths, setJournalState = () => {}, nativeRecovery = null }) {
  if (paths && journalPath) assertSafePath(journalPath, { root: paths.journalsRoot, label: "journal path", allowMissing: false });
  const current = journal ?? readJournal(journalPath, { paths });
  validateJournal(current, { paths });
  if (isTerminal(current)) return current;
  const publishedCommit = current.steps.some((step) => step.name === "receipt-published" && step.status === "completed");
  const pendingPrune = current.steps.find((step) => step.name === "control-plane-pruned" && step.status === "pending");
  if (publishedCommit && pendingPrune) {
    try {
      validateRecoveryControlPlane(current, paths);
      const pruned = pruneUnreferencedControlPlanes(paths);
      removeEntry(current.stage_root, { root: paths.stagingRoot, label: "completed transaction staging root" });
      const recovered = appendTransition(current, current.state === "rolled_back" ? "rolled_back" : "recovered", {
        failure: null,
        steps: [
          ...current.steps.map((step) => step === pendingPrune ? {
            ...step,
            status: "completed",
            timestamp: new Date().toISOString(),
            after_hash: sha256(canonical(pruned)),
          } : step),
          { name: "recovery", status: "completed", timestamp: new Date().toISOString(), before_ref: journalPath, after_hash: null },
        ],
      });
      setJournalState(recovered);
      return recovered;
    } catch (error) {
      const failure = distributionError("E_RECOVERY_FAILURE", "post-commit cleanup recovery could not finish", {
        journal_id: current.journal_id,
        journal_path: journalPath,
      }, { cause: error, retryable: true });
      const retained = appendTransition(current, "verified", {
        failure: { kind: failure.kind, details: failure.details, retryable: true },
      });
      try { setJournalState(retained); } catch { /* preserve the primary recovery failure */ }
      throw failure;
    }
  }
  const rollbackReceipt = current.command === "rollback" && current.previous_receipt
    ? readReceipt(current.previous_receipt, { paths })
    : null;
  const transaction = current.candidate_receipt?.transaction ?? rollbackReceipt?.transaction ?? {
    backup_root: current.backup_root,
    backup_manifest_hash: current.backup_manifest_hash,
  };
  const backupRoot = transaction?.backup_root;
  const expectedManifestHash = transaction?.backup_manifest_hash ?? null;
  if (!backupRoot) {
    const committed = current.steps.some((step) => step.name === "commit" && step.status === "completed");
    if (committed || !new Set(["prepared", "staged"]).has(current.state)) {
      throwDistributionError("E_RECOVERY_BACKUP", "journal has no recoverable backup", { journal_id: current.journal_id });
    }
    removeEntry(current.stage_root, { root: paths.stagingRoot, label: "pre-commit recovery staging root" });
    const recovered = appendTransition(current, "recovered", {
      failure: null,
      steps: [...current.steps, {
        name: "recovery",
        status: "completed",
        timestamp: new Date().toISOString(),
        before_ref: current.stage_root,
        after_hash: null,
      }],
    });
    setJournalState(recovered);
    return recovered;
  }
  try {
    validateRecoveryControlPlane(current, paths);
    restoreFullBackup(backupRoot, { paths, expectedManifestHash });
    if (typeof nativeRecovery === "function") nativeRecovery(current);
    cleanupRecoveryResidue(current, paths);
  } catch (error) {
    const failure = distributionError("E_RECOVERY_FAILURE", "journal recovery could not restore the verified backup", { journal_id: current.journal_id, backup_root: backupRoot }, { cause: error });
    const failed = appendTransition(current, "rollback_failed", { failure: { kind: failure.kind, details: failure.details, retryable: true } });
    try { setJournalState(failed); } catch { /* retain the original recovery error */ }
    throw failure;
  }
  const recovered = appendTransition(current, "recovered", {
    failure: current.failure ?? { kind: "E_RECOVERY_COMPLETED", details: {}, retryable: false },
    steps: [...current.steps, { name: "recovery", status: "completed", timestamp: new Date().toISOString(), before_ref: backupRoot, after_hash: null }],
  });
  setJournalState(recovered);
  return recovered;
}

export { removeEntry as removeEntry };

function removeEntry(target, options = {}) {
  secureRemove(target, options);
}
