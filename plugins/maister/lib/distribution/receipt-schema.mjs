import fs from "node:fs";
import path from "node:path";

import { distributionError, readFileNoFollow } from "./path-safety.mjs";
import { EVIDENCE_LEVELS, validateEvidenceSet } from "./evidence-schema.mjs";
import { getTargetDefinition, SUPPORTED_TARGET_IDS } from "./targets.mjs";

const RECEIPT_FIELDS = [
  "schema_version", "receipt_id", "installer_version", "status", "installed_at",
  "target", "source", "managed_roots", "managed_inventory", "settings", "provenance", "compatibility", "evidence", "transaction",
];
const CONTROL_PLANE_FIELDS = [
  "schema_version", "root_ref", "installer_ref", "tree_hash", "installer_sha256",
  "cli_contract_version", "source_version", "source_commit", "source_content_hash",
];
const TARGET_FIELDS = ["id", "overlay_id", "overlay_version", "host_version"];
const SOURCE_FIELDS = ["kind", "requested", "requested_ref", "resolved_commit", "source_version", "content_hash"];
const HASH_PROVENANCE_FIELDS = ["source_hash", "overlay_hash", "materialized_hash", "provenance_hash"];
const PROVENANCE_FIELDS = [...HASH_PROVENANCE_FIELDS, "agent_projection"];
const PROJECTION_FIELDS = ["schema_version", "projector_version", "canonical_set_digest", "manifest_digest", "projected_tree_digest"];
const COMPATIBILITY_FIELDS = ["policy", "scenario_version", "status", "evaluations"];
const EVALUATION_FIELDS = ["target", "capability", "capabilityClass", "required", "passedEvidence", "unavailable", "failed", "missing", "expired", "passed", "status"];
const MANAGED_ROOT_FIELDS = ["root_id", "path", "ownership"];
const INVENTORY_FIELDS = ["root_id", "path", "type", "mode", "sha256", "link_target", "ownership"];
const SETTING_FIELDS = ["path", "format", "ownership", "managed_keys", "before_sha256", "after_sha256", "backup_ref", "mode", "before_mode"];
const MANAGED_ARRAY_RECEIPT_FIELDS = [
  "ownership_schema", "merge_schema", "settings_path", "array_path", "normalized_identity",
  "entry_representation", "entry_before", "entry_after", "unmanaged_projection_sha256", "mode_before", "mode_after",
];
const MANAGED_KEYS_RECEIPT_FIELDS = ["managed_values"];
const TRANSACTION_FIELDS = ["journal_id", "backup_root", "backup_manifest_hash", "previous_receipt_id"];
const NATIVE_DEPLOYMENT_FIELDS = [
  "schema_version", "marketplace_name", "plugin_id", "plugin_version",
  "marketplace_root", "plugin_root", "installed_path", "source_tree_hash",
];
const STATUSES = new Set(["installed", "uninstalled"]);
const INVENTORY_TYPES = new Set(["file", "directory", "symlink"]);
const OWNERSHIP = new Set(["whole_file", "managed_keys", "managed_array_entries"]);
const ROOT_OWNERSHIP = new Set(["whole_tree", "leaf_set"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const MODE = /^[0-7]{4}$/u;
const COMPATIBILITY_POLICIES = new Set(["offline-provisional", "strict"]);
const COMPATIBILITY_STATUSES = new Set(["supported", "provisional", "blocked"]);
const CAPABILITY_CLASSES = new Set(["semantic", "safety", "persistence", "rollback", "packaging"]);
const EVALUATION_STATUSES = new Set(["passed", "provisional", "blocked"]);

function invalid(message, details = {}) {
  throw distributionError("E_RECEIPT_SCHEMA", message, details);
}

function rejectLegacySchema(value, label) {
  if (value?.schema_version === 1) {
    throw distributionError(
      "E_CLEAN_INSTALL_REQUIRED",
      `${label} schema v1 is unsupported; a clean install with empty Maister target state is required`,
      { persisted_schema_version: 1, required_schema_version: 2, artifact: label },
    );
  }
}

function object(value, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${location} must be an object`, { location });
}

function exactFields(value, fields, location) {
  object(value, location);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) invalid(`${location} has unknown field ${unknown}`, { location, field: unknown });
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) invalid(`${location} is missing ${missing}`, { location, field: missing });
}

function exactFieldsWithOptional(value, fields, optionalFields, location) {
  object(value, location);
  const allowed = new Set([...fields, ...optionalFields]);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) invalid(`${location} has unknown field ${unknown}`, { location, field: unknown });
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) invalid(`${location} is missing ${missing}`, { location, field: missing });
}

function string(value, location, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    invalid(`${location} must be a non-empty string`, { location });
  }
}

function nullableHash(value, location, required = false) {
  if (value === null && !required) return;
  if (typeof value !== "string" || !SHA256.test(value)) invalid(`${location} must be a lowercase SHA-256 hash or null`, { location });
}

function nullableMode(value, location, required = false) {
  if (value === null && !required) return;
  if (typeof value !== "string" || !MODE.test(value)) invalid(`${location} must be a four-digit octal mode or null`, { location });
}

function array(value, location) {
  if (!Array.isArray(value)) invalid(`${location} must be an array`, { location });
}

function relativePath(value, location) {
  string(value, location);
  if (value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/u.test(value) || value.includes("\\")) {
    invalid(`${location} must be a relative POSIX path`, { location, value });
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    invalid(`${location} contains an unsafe path segment`, { location, value });
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value) invalid(`${location} must already be normalized`, { location, value });
  return normalized;
}

function absolutePath(value, location) {
  string(value, location);
  if (!path.isAbsolute(value) || path.normalize(value) !== value) invalid(`${location} must be a normalized absolute path`, { location, value });
  return value;
}

function contained(root, candidate, location) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    invalid(`${location} escapes its permitted root`, { location, root, candidate });
  }
}

function isoDate(value, location) {
  string(value, location);
  if (!Number.isFinite(Date.parse(value))) invalid(`${location} must be an ISO timestamp`, { location });
}

function validateManagedRoots(roots, receipt, paths) {
  array(roots, "managed_roots");
  if (roots.length === 0) invalid("managed_roots must not be empty");
  const seen = new Set();
  for (const [index, root] of roots.entries()) {
    const location = `managed_roots[${index}]`;
    exactFields(root, MANAGED_ROOT_FIELDS, location);
    string(root.root_id, `${location}.root_id`);
    if (!/^[a-z][a-z0-9_]*$/u.test(root.root_id)) invalid(`${location}.root_id is unsafe`, { root_id: root.root_id });
    if (seen.has(root.root_id)) invalid("managed root IDs must be unique", { root_id: root.root_id });
    seen.add(root.root_id);
    absolutePath(root.path, `${location}.path`);
    if (!ROOT_OWNERSHIP.has(root.ownership)) invalid(`${location}.ownership is unsupported`, { ownership: root.ownership });
  }
  const definition = getTargetDefinition(receipt.target.id);
  const expectedIds = definition.managedRoots.map(({ rootId }) => rootId);
  if (roots.length !== expectedIds.length || roots.some((root, index) => root.root_id !== expectedIds[index])) {
    invalid("managed_roots do not match the target registry", { expected: expectedIds, actual: roots.map(({ root_id: rootId }) => rootId) });
  }
  for (const [index, expected] of definition.managedRoots.entries()) {
    if (roots[index].ownership !== expected.ownership) invalid("managed root ownership does not match the target registry", { root_id: expected.rootId });
    if (paths) {
      const resolved = paths.managedRoots.find(({ rootId }) => rootId === expected.rootId);
      if (!resolved || roots[index].path !== resolved.path) invalid("managed root path does not match the target registry", { root_id: expected.rootId });
    }
  }
  return new Map(roots.map((root) => [root.root_id, root]));
}

function validateInventory(entries, rootsById) {
  array(entries, "managed_inventory");
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const location = `managed_inventory[${index}]`;
    exactFields(entry, INVENTORY_FIELDS, location);
    string(entry.root_id, `${location}.root_id`);
    const root = rootsById.get(entry.root_id);
    if (!root) invalid(`${location}.root_id is not declared`, { root_id: entry.root_id });
    const entryPath = relativePath(entry.path, `${location}.path`);
    const identity = `${entry.root_id}\0${entryPath}`;
    if (seen.has(identity)) invalid("managed inventory identities must be unique", { root_id: entry.root_id, path: entryPath });
    seen.add(identity);
    if (!INVENTORY_TYPES.has(entry.type)) invalid(`${location}.type is unsupported`, { location });
    if (!MODE.test(entry.mode)) invalid(`${location}.mode must be a four-digit octal mode`, { location });
    if (!OWNERSHIP.has(entry.ownership)) invalid(`${location}.ownership is unsupported`, { location });
    if (entry.type === "file") nullableHash(entry.sha256, `${location}.sha256`, true);
    else if (entry.sha256 !== null) invalid(`${location}.sha256 must be null for non-files`, { location });
    if (entry.type === "symlink") string(entry.link_target, `${location}.link_target`);
    else if (entry.link_target !== null) invalid(`${location}.link_target must be null for non-symlinks`, { location });
    if (entry.type === "symlink") {
      if (path.isAbsolute(entry.link_target)) invalid(`${location}.link_target must be relative`, { location });
      const linkLocation = path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), entry.link_target));
      if (linkLocation === ".." || linkLocation.startsWith("../")) invalid(`${location}.link_target escapes its managed root`, { location });
    }
    if (root.ownership === "leaf_set" && entry.type === "directory") invalid(`${location} leaf-set inventory must contain leaves only`, { location });
  }
  for (const entry of entries) {
    let parent = path.posix.dirname(entry.path);
    while (parent !== ".") {
      const ancestor = entries.find((candidate) => candidate.root_id === entry.root_id && candidate.path === parent);
      if (ancestor && ancestor.type !== "directory") invalid("managed_inventory contains a child below a non-directory entry", { path: entry.path, ancestor: parent });
      parent = path.posix.dirname(parent);
    }
  }
}

function validatePackageEntry(value, location, nullable) {
  if (nullable && value === null) return;
  if (typeof value === "string") {
    string(value, location);
    return;
  }
  object(value, location);
  string(value.source, `${location}.source`);
}

function validateSettings(settings, { paths } = {}) {
  array(settings, "settings");
  const seen = new Set();
  for (const [index, setting] of settings.entries()) {
    const location = `settings[${index}]`;
    exactFieldsWithOptional(setting, SETTING_FIELDS, [...MANAGED_ARRAY_RECEIPT_FIELDS, ...MANAGED_KEYS_RECEIPT_FIELDS], location);
    const settingPath = relativePath(setting.path, `${location}.path`);
    if (seen.has(settingPath)) invalid("settings paths must be unique", { path: settingPath });
    seen.add(settingPath);
    string(setting.format, `${location}.format`);
    if (!OWNERSHIP.has(setting.ownership)) invalid(`${location}.ownership is unsupported`, { location });
    array(setting.managed_keys, `${location}.managed_keys`);
    for (const [keyIndex, key] of setting.managed_keys.entries()) relativePath(key, `${location}.managed_keys[${keyIndex}]`);
    if (setting.ownership === "whole_file" && setting.managed_keys.length > 0) invalid(`${location}.managed_keys must be empty for whole_file`, { location });
    if (setting.ownership === "managed_keys" && setting.managed_keys.length === 0) invalid(`${location}.managed_keys must be non-empty`, { location });
    const hasManagedArrayFields = MANAGED_ARRAY_RECEIPT_FIELDS.some((field) => Object.hasOwn(setting, field));
    const hasManagedKeysFields = MANAGED_KEYS_RECEIPT_FIELDS.some((field) => Object.hasOwn(setting, field));
    if (setting.ownership === "managed_array_entries") {
      if (!hasManagedArrayFields) invalid(`${location} is missing managed-array receipt fields`, { location });
      for (const field of MANAGED_ARRAY_RECEIPT_FIELDS) if (!Object.hasOwn(setting, field)) invalid(`${location} is missing ${field}`, { location, field });
      if (setting.ownership_schema !== "managed_array_entries_v1") invalid(`${location}.ownership_schema is unsupported`, { location });
      if (setting.merge_schema !== "pi_local_package_v1") invalid(`${location}.merge_schema is unsupported`, { location });
      if (setting.settings_path !== setting.path) invalid(`${location}.settings_path must equal settings.path`, { location });
      relativePath(setting.array_path, `${location}.array_path`);
      absolutePath(setting.normalized_identity, `${location}.normalized_identity`);
      if (!new Set(["string", "object"]).has(setting.entry_representation)) invalid(`${location}.entry_representation is unsupported`, { location });
      validatePackageEntry(setting.entry_before, `${location}.entry_before`, true);
      validatePackageEntry(setting.entry_after, `${location}.entry_after`, false);
      if ((setting.entry_representation === "string" && typeof setting.entry_after !== "string")
        || (setting.entry_representation === "object" && (!setting.entry_after || typeof setting.entry_after !== "object" || Array.isArray(setting.entry_after)))) {
        invalid(`${location}.entry_representation does not match entry_after`, { location });
      }
      nullableHash(setting.unmanaged_projection_sha256, `${location}.unmanaged_projection_sha256`, true);
      nullableMode(setting.mode_before, `${location}.mode_before`);
      nullableMode(setting.mode_after, `${location}.mode_after`, true);
      if (setting.mode_after !== setting.mode) invalid(`${location}.mode_after must equal mode`, { location });
    } else if (hasManagedArrayFields) {
      invalid(`${location} has managed-array receipt fields for a non-managed-array setting`, { location });
    }
    if (setting.ownership === "managed_keys" && hasManagedKeysFields) {
      object(setting.managed_values, `${location}.managed_values`);
      const managedKeys = new Set(setting.managed_keys);
      const valueKeys = Object.keys(setting.managed_values);
      if (valueKeys.length !== managedKeys.size || valueKeys.some((key) => !managedKeys.has(key))) {
        invalid(`${location}.managed_values must match managed_keys`, { location });
      }
    } else if (setting.ownership !== "managed_keys" && hasManagedKeysFields) {
      invalid(`${location} has managed-key receipt fields for a non-managed-key setting`, { location });
    }
    nullableHash(setting.before_sha256, `${location}.before_sha256`);
    nullableHash(setting.after_sha256, `${location}.after_sha256`);
    relativePath(setting.backup_ref, `${location}.backup_ref`);
    nullableMode(setting.mode, `${location}.mode`, true);
    nullableMode(setting.before_mode, `${location}.before_mode`);
    if (paths) {
      const targetPath = path.resolve(paths.home, ...settingPath.split("/"));
      contained(paths.home, targetPath, `${location}.path`);
      const expectedBackup = path.posix.join("settings", String(index));
      if (setting.backup_ref !== expectedBackup) invalid(`${location}.backup_ref does not match its setting index`, { location });
    }
  }
}

function validateProvenance(provenance, source) {
  exactFields(provenance, PROVENANCE_FIELDS, "provenance");
  for (const field of HASH_PROVENANCE_FIELDS) nullableHash(provenance[field], `provenance.${field}`, true);
  if (provenance.source_hash !== source.content_hash) invalid("provenance.source_hash must equal source.content_hash");
  exactFields(provenance.agent_projection, PROJECTION_FIELDS, "provenance.agent_projection");
  if (!Number.isSafeInteger(provenance.agent_projection.schema_version) || provenance.agent_projection.schema_version < 1) {
    invalid("provenance.agent_projection.schema_version must be a positive integer");
  }
  string(provenance.agent_projection.projector_version, "provenance.agent_projection.projector_version");
  for (const field of PROJECTION_FIELDS.slice(2)) nullableHash(provenance.agent_projection[field], `provenance.agent_projection.${field}`, true);
}

function validateControlPlane(controlPlane, receipt, paths) {
  exactFields(controlPlane, CONTROL_PLANE_FIELDS, "control_plane");
  if (controlPlane.schema_version !== 1) invalid("control_plane.schema_version must be 1");
  const expectedRootRef = `control-planes/${receipt.receipt_id}`;
  const expectedInstallerRef = `${expectedRootRef}/plugins/maister/bin/maister-install.mjs`;
  if (relativePath(controlPlane.root_ref, "control_plane.root_ref") !== expectedRootRef) {
    invalid("control_plane.root_ref must be receipt-bound", { expected: expectedRootRef, actual: controlPlane.root_ref });
  }
  if (relativePath(controlPlane.installer_ref, "control_plane.installer_ref") !== expectedInstallerRef) {
    invalid("control_plane.installer_ref must be contained by its receipt-bound root", { expected: expectedInstallerRef, actual: controlPlane.installer_ref });
  }
  nullableHash(controlPlane.tree_hash, "control_plane.tree_hash", true);
  nullableHash(controlPlane.installer_sha256, "control_plane.installer_sha256", true);
  if (!Number.isSafeInteger(controlPlane.cli_contract_version) || controlPlane.cli_contract_version !== 1) invalid("control_plane.cli_contract_version is unsupported");
  string(controlPlane.source_version, "control_plane.source_version");
  if (!COMMIT.test(controlPlane.source_commit)) invalid("control_plane.source_commit must be a full commit hash");
  nullableHash(controlPlane.source_content_hash, "control_plane.source_content_hash", true);
  if (controlPlane.source_version !== receipt.source.source_version
      || controlPlane.source_commit !== receipt.source.resolved_commit
      || controlPlane.source_content_hash !== receipt.source.content_hash) {
    invalid("control_plane source identity must equal the receipt source identity");
  }
  if (paths) {
    if (!paths.controlPlanesRoot) invalid("target paths do not declare controlPlanesRoot");
    const rootPath = path.resolve(paths.stateRoot, ...controlPlane.root_ref.split("/"));
    const installerPath = path.resolve(paths.stateRoot, ...controlPlane.installer_ref.split("/"));
    contained(paths.controlPlanesRoot, rootPath, "control_plane.root_ref");
    contained(rootPath, installerPath, "control_plane.installer_ref");
    if (rootPath !== path.join(paths.controlPlanesRoot, receipt.receipt_id)) invalid("control_plane.root_ref resolves to the wrong receipt root");
    if (installerPath !== path.join(rootPath, "plugins", "maister", "bin", "maister-install.mjs")) invalid("control_plane.installer_ref resolves to the wrong installer");
  }
}

export function validateNativeDeployment(deployment, receipt, paths, location = "native_deployment") {
  if (deployment === null) return;
  exactFields(deployment, NATIVE_DEPLOYMENT_FIELDS, location);
  if (deployment.schema_version !== 1) invalid(`${location}.schema_version must be 1`);
  string(deployment.marketplace_name, `${location}.marketplace_name`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(deployment.marketplace_name)) invalid(`${location}.marketplace_name is unsafe`);
  string(deployment.plugin_id, `${location}.plugin_id`);
  if (deployment.plugin_id !== `maister@${deployment.marketplace_name}`) invalid(`${location}.plugin_id does not match its marketplace`);
  string(deployment.plugin_version, `${location}.plugin_version`);
  absolutePath(deployment.marketplace_root, `${location}.marketplace_root`);
  absolutePath(deployment.plugin_root, `${location}.plugin_root`);
  if (deployment.plugin_root !== path.join(deployment.marketplace_root, "plugins", "maister")) invalid(`${location}.plugin_root is not derived from its marketplace root`);
  if (deployment.installed_path !== null) absolutePath(deployment.installed_path, `${location}.installed_path`);
  nullableHash(deployment.source_tree_hash, `${location}.source_tree_hash`, false);
  if (receipt.target.id !== "codex") invalid(`${location} is only supported for the codex target`);
  if (paths) {
    contained(paths.stateRoot, deployment.marketplace_root, `${location}.marketplace_root`);
    if (deployment.marketplace_root !== path.join(paths.stateRoot, "native", "codex", path.basename(deployment.marketplace_root))) {
      invalid(`${location}.marketplace_root is outside the target deployment namespace`);
    }
  }
}

function validateLevelList(value, location, required, evidenceByCapability, expectedResult = null) {
  array(value, location);
  const seen = new Set();
  for (const [index, level] of value.entries()) {
    if (!EVIDENCE_LEVELS.has(level)) invalid(`${location}[${index}] is not a valid evidence level`, { level });
    if (seen.has(level)) invalid(`${location} must contain unique evidence levels`, { level });
    seen.add(level);
    if (!required.has(level)) invalid(`${location}[${index}] is not required by this capability`, { level });
    const record = evidenceByCapability.get(level);
    if (!record) invalid(`${location}[${index}] has no corresponding evidence record`, { level });
    if (expectedResult && record.result !== expectedResult) invalid(`${location}[${index}] does not match its evidence result`, { level, result: record.result });
  }
  return seen;
}

function validateEvaluations(compatibility, receipt, evidence) {
  exactFields(compatibility, COMPATIBILITY_FIELDS, "compatibility");
  string(compatibility.policy, "compatibility.policy");
  if (!COMPATIBILITY_POLICIES.has(compatibility.policy)) invalid("compatibility.policy is unsupported", { policy: compatibility.policy });
  string(compatibility.scenario_version, "compatibility.scenario_version");
  if (!COMPATIBILITY_STATUSES.has(compatibility.status)) invalid("compatibility.status is unsupported", { status: compatibility.status });
  array(compatibility.evaluations, "compatibility.evaluations");
  if (compatibility.evaluations.length === 0) invalid("compatibility.evaluations must not be empty");
  const evidenceByCapability = new Map(evidence.map((record) => [record.capability, record]));
  const capabilities = new Set();
  const evaluations = [];
  for (const [index, evaluation] of compatibility.evaluations.entries()) {
    const location = `compatibility.evaluations[${index}]`;
    exactFields(evaluation, EVALUATION_FIELDS, location);
    if (capabilities.has(evaluation.capability)) invalid("compatibility evaluations must have unique capabilities", { capability: evaluation.capability });
    capabilities.add(evaluation.capability);
    if (evaluation.target !== receipt.target.id) invalid(`${location}.target does not match the receipt target`, { target: evaluation.target });
    string(evaluation.capability, `${location}.capability`);
    if (!CAPABILITY_CLASSES.has(evaluation.capabilityClass)) invalid(`${location}.capabilityClass is unsupported`, { capabilityClass: evaluation.capabilityClass });
    const required = new Set(validateLevelList(evaluation.required, `${location}.required`, new Set(EVIDENCE_LEVELS), evidenceByCapability));
    const passed = validateLevelList(evaluation.passedEvidence, `${location}.passedEvidence`, required, evidenceByCapability, "passed");
    const unavailable = validateLevelList(evaluation.unavailable, `${location}.unavailable`, required, evidenceByCapability, "unavailable");
    const failed = validateLevelList(evaluation.failed, `${location}.failed`, required, evidenceByCapability, "failed");
    const missing = validateLevelList(evaluation.missing, `${location}.missing`, required, evidenceByCapability);
    const expired = validateLevelList(evaluation.expired, `${location}.expired`, required, evidenceByCapability, "passed");
    const classified = new Set([...passed, ...unavailable, ...failed, ...missing, ...expired]);
    if (classified.size !== required.size) invalid(`${location} does not classify every required evidence level`, { capability: evaluation.capability });
    if (evaluation.missing.length > 0) invalid(`${location}.missing is incompatible with a complete E1-E6 evidence set`, { capability: evaluation.capability });
    if (typeof evaluation.passed !== "boolean") invalid(`${location}.passed must be boolean`);
    if (evaluation.passed !== (passed.size === required.size)) invalid(`${location}.passed does not match passedEvidence`, { capability: evaluation.capability });
    if (!EVALUATION_STATUSES.has(evaluation.status)) invalid(`${location}.status is unsupported`, { status: evaluation.status });
    if (evaluation.status === "passed" && !evaluation.passed) invalid(`${location}.passed status requires passed=true`, { capability: evaluation.capability });
    if (evaluation.status !== "passed" && evaluation.passed) invalid(`${location}.passed=true requires passed status`, { capability: evaluation.capability });
    if (evaluation.status === "provisional" && (evaluation.capabilityClass !== "packaging" || unavailable.size === 0)) {
      invalid(`${location}.provisional is only valid for packaging with unavailable native evidence`, { capability: evaluation.capability });
    }
    evaluations.push(evaluation);
  }
  if (compatibility.status === "supported" && evaluations.some((evaluation) => evaluation.status !== "passed")) {
    invalid("supported compatibility requires every capability evaluation to pass");
  }
  if (compatibility.status === "provisional") {
    const unresolved = evaluations.filter((evaluation) => evaluation.status !== "passed");
    const provisionalAllowed = unresolved.length > 0 && unresolved.every((evaluation) => (
      evaluation.unavailable.length > 0
      && evaluation.failed.length === 0
      && evaluation.missing.length === 0
      && evaluation.expired.length === 0
    ));
    if (!provisionalAllowed) invalid("provisional compatibility cannot conceal failed, missing, or expired required evidence");
  }
  return evaluations;
}

function validateEvidenceAndCompatibility(receipt) {
  let evidence;
  try {
    evidence = validateEvidenceSet(receipt.evidence, { target: receipt.target.id });
  } catch (error) {
    invalid("evidence must be a strict, complete E1-E6 set", { cause: error.message });
  }
  const baseline = evidence.filter((record) => ["E1", "E2", "E3", "E4"].includes(record.capability));
  if (baseline.length !== 4 || baseline.some((record) => record.result !== "passed")) {
    invalid("candidate receipts require passed E1-E4 evidence", {
      baseline: baseline.map((record) => ({ capability: record.capability, result: record.result })),
    });
  }
  for (const [index, record] of evidence.entries()) {
    const location = `evidence[${index}]`;
    if (record.host_version !== receipt.target.host_version) invalid(`${location}.host_version does not match target.host_version`, { location });
    const provenance = record.provenance;
    for (const field of ["source_commit", "source_version", "overlay_version", "scenario_version"]) {
      const expected = field === "source_commit" ? receipt.source.resolved_commit
        : field === "source_version" ? receipt.source.source_version
          : field === "overlay_version" ? receipt.target.overlay_version
            : receipt.compatibility.scenario_version;
      if (provenance[field] !== expected) invalid(`${location}.provenance.${field} is not bound to the receipt`, { location, field });
    }
    for (const field of HASH_PROVENANCE_FIELDS) {
      const evidenceField = field;
      if (provenance[evidenceField] !== receipt.provenance[field]) invalid(`${location}.provenance.${evidenceField} is not bound to the receipt hash`, { location, field: evidenceField });
    }
  }
  validateEvaluations(receipt.compatibility, receipt, evidence);
  return evidence;
}

export function validateReceipt(receipt, { paths = null, receiptPath = null } = {}) {
  rejectLegacySchema(receipt, "receipt");
  exactFieldsWithOptional(receipt, RECEIPT_FIELDS, ["control_plane", "native_deployment"], "receipt");
  if (receipt.schema_version !== 2) invalid("receipt schema_version must be 2");
  string(receipt.receipt_id, "receipt_id");
  if (!UUID.test(receipt.receipt_id)) invalid("receipt_id must be a UUID", { receipt_id: receipt.receipt_id });
  string(receipt.installer_version, "installer_version");
  if (!STATUSES.has(receipt.status)) invalid(`unsupported receipt status: ${receipt.status}`);
  isoDate(receipt.installed_at, "installed_at");
  exactFields(receipt.target, TARGET_FIELDS, "target");
  string(receipt.target.id, "target.id");
  if (!SUPPORTED_TARGET_IDS.includes(receipt.target.id)) invalid("target.id is unsupported", { target: receipt.target.id });
  const targetDefinition = getTargetDefinition(receipt.target.id);
  if (receipt.target.overlay_id !== targetDefinition.overlayId) invalid("target.overlay_id does not match the target registry", { target: receipt.target.id, overlay_id: receipt.target.overlay_id });
  for (const field of TARGET_FIELDS.slice(1)) string(receipt.target[field], `target.${field}`);
  if (paths && receipt.target.id !== paths.target) invalid("receipt target does not match the requested target", { target: receipt.target.id, expected: paths.target });
  exactFields(receipt.source, SOURCE_FIELDS, "source");
  for (const field of SOURCE_FIELDS.slice(0, -1)) string(receipt.source[field], `source.${field}`);
  if (!COMMIT.test(receipt.source.resolved_commit)) invalid("source.resolved_commit must be a full commit hash");
  nullableHash(receipt.source.content_hash, "source.content_hash", true);
  if (Object.hasOwn(receipt, "control_plane")) validateControlPlane(receipt.control_plane, receipt, paths);
  if (Object.hasOwn(receipt, "native_deployment")) validateNativeDeployment(receipt.native_deployment, receipt, paths);
  const rootsById = validateManagedRoots(receipt.managed_roots, receipt, paths);
  validateInventory(receipt.managed_inventory, rootsById);
  validateSettings(receipt.settings, { paths });
  validateProvenance(receipt.provenance, receipt.source);
  validateEvidenceAndCompatibility(receipt);
  exactFields(receipt.transaction, TRANSACTION_FIELDS, "transaction");
  if (receipt.transaction.journal_id !== null) {
    string(receipt.transaction.journal_id, "transaction.journal_id");
    if (!UUID.test(receipt.transaction.journal_id)) invalid("transaction.journal_id must be a UUID");
  }
  if (receipt.transaction.backup_root !== null) absolutePath(receipt.transaction.backup_root, "transaction.backup_root");
  nullableHash(receipt.transaction.backup_manifest_hash, "transaction.backup_manifest_hash", receipt.transaction.backup_root !== null);
  if (receipt.transaction.backup_root === null && receipt.transaction.backup_manifest_hash !== null) invalid("transaction.backup_manifest_hash requires transaction.backup_root");
  if (receipt.transaction.previous_receipt_id !== null) {
    string(receipt.transaction.previous_receipt_id, "transaction.previous_receipt_id");
    if (!UUID.test(receipt.transaction.previous_receipt_id)) invalid("transaction.previous_receipt_id must be a UUID");
  }
  if (paths) {
    if (receipt.transaction.journal_id !== receipt.receipt_id) invalid("transaction.journal_id must equal receipt_id");
    if (receipt.transaction.backup_root !== null) {
      const expected = path.join(paths.backupsRoot, receipt.receipt_id);
      if (receipt.transaction.backup_root !== expected) invalid("transaction.backup_root is outside the target backup root", { backup_root: receipt.transaction.backup_root });
    }
  }
  if (receiptPath) {
    const normalizedReceiptPath = path.resolve(receiptPath);
    if (path.basename(normalizedReceiptPath) !== `${receipt.receipt_id}.json`) invalid("receipt path does not match receipt_id", { receiptPath });
    if (paths) contained(paths.receiptsRoot, normalizedReceiptPath, "receipt path");
  }
  return receipt;
}

export function controlPlaneMigrationRequired(receipt) {
  object(receipt, "receipt");
  return !Object.hasOwn(receipt, "control_plane");
}

export function requireControlPlane(receipt, { paths = null } = {}) {
  validateReceipt(receipt, { paths });
  if (controlPlaneMigrationRequired(receipt)) {
    throw distributionError(
      "E_OFFLINE_AUTHORITY_MIGRATION",
      "the active receipt predates receipt-bound offline authority; run install or update from a verified release",
      { receipt_id: receipt.receipt_id },
    );
  }
  return receipt.control_plane;
}

export function readReceipt(filePath, context = {}) {
  const { paths = null, beforeRead = null } = context;
  try {
    const receipt = JSON.parse(readFileNoFollow(filePath, {
      root: paths?.receiptsRoot ?? path.dirname(filePath),
      label: "receipt",
      encoding: "utf8",
      beforeOpen: beforeRead,
      errorCode: "E_PATH_SECURITY",
    }));
    return validateReceipt(receipt, { paths, receiptPath: filePath });
  } catch (error) {
    if (["E_RECEIPT_SCHEMA", "E_RECEIPT_IO", "E_CLEAN_INSTALL_REQUIRED"].includes(error?.kind)) throw error;
    throw distributionError("E_RECEIPT_IO", `could not read receipt: ${filePath}`, { filePath }, { cause: error });
  }
}

export function readActiveReceipt(paths) {
  if (!paths?.activeReceiptPath || !paths?.stateRoot || !paths?.receiptsRoot) {
    throw distributionError("E_RECEIPT_IO", "target paths are required to read the active receipt", {});
  }
  const activeStat = fs.lstatSync(paths.activeReceiptPath, { throwIfNoEntry: false });
  if (!activeStat) return null;
  if (!activeStat.isFile() || activeStat.isSymbolicLink()) {
    throw distributionError("E_RECEIPT_IO", "active receipt pointer must be a regular file", { path: paths.activeReceiptPath });
  }
  try {
    const pointer = JSON.parse(readFileNoFollow(paths.activeReceiptPath, {
      root: paths.stateRoot,
      label: "active receipt pointer",
      encoding: "utf8",
      errorCode: "E_RECEIPT_IO",
    }));
    rejectLegacySchema(pointer, "active receipt");
    exactFields(pointer, ["schema_version", "receipt_id", "receipt_path"], "active receipt");
    if (pointer.schema_version !== 2) invalid("active receipt schema_version must be 2");
    if (!UUID.test(pointer.receipt_id)) invalid("active receipt receipt_id must be a UUID");
    absolutePath(pointer.receipt_path, "active receipt receipt_path");
    const expectedPath = path.join(paths.receiptsRoot, `${pointer.receipt_id}.json`);
    if (pointer.receipt_path !== expectedPath) {
      invalid("active receipt path does not match its receipt ID", { expected: expectedPath, actual: pointer.receipt_path });
    }
    contained(paths.receiptsRoot, pointer.receipt_path, "active receipt receipt_path");
    return { receipt: readReceipt(pointer.receipt_path, { paths }), receiptPath: pointer.receipt_path };
  } catch (error) {
    if (["E_RECEIPT_SCHEMA", "E_RECEIPT_IO", "E_CLEAN_INSTALL_REQUIRED"].includes(error?.kind)) throw error;
    throw distributionError("E_RECEIPT_IO", "active receipt pointer is invalid", { path: paths.activeReceiptPath }, { cause: error });
  }
}

export { CONTROL_PLANE_FIELDS, RECEIPT_FIELDS, MODE, SHA256, UUID, relativePath, contained };
