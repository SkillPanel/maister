import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  parseCanonicalYaml,
} from "../../skills/orchestrator-framework/bin/orchestrator-state-schema.mjs";
import {
  OverlayValidationError,
  throwOverlayError,
} from "./errors.mjs";
import { SUPPORTED_TARGET_IDS } from "./targets.mjs";

const LAYOUT_KINDS = new Set(["file", "tree", "template"]);
const OWNERSHIP = new Set(["whole_file", "managed_keys", "plugin_private", "managed_array_entries"]);
const SETTING_FORMATS = new Set(["json", "toml", "yaml", "shell"]);
const CAPABILITY_CLASSES = new Set(["semantic", "safety", "persistence", "rollback", "packaging"]);
const EVIDENCE_IDS = new Set(["E1", "E2", "E3", "E4", "E5", "E6"]);
const PROFILE_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const CANONICAL_ROLE_IDS = [
  "advisor",
  "bottleneck-analyzer",
  "code-quality-pragmatist",
  "code-reviewer",
  "codebase-analysis-reporter",
  "docs-operator",
  "e2e-test-verifier",
  "gap-analyzer",
  "html-companion-writer",
  "implementation-completeness-checker",
  "implementation-planner",
  "information-gatherer",
  "production-readiness-checker",
  "project-analyzer",
  "reality-assessor",
  "research-planner",
  "research-synthesizer",
  "solution-brainstormer",
  "solution-designer",
  "spec-auditor",
  "specification-creator",
  "task-classifier",
  "task-group-implementer",
  "test-suite-runner",
  "thermo-nuclear-code-quality-review-subagent",
  "thermo-nuclear-review-subagent",
  "ui-mockup-generator",
  "user-docs-generator",
];
const TARGET_PROJECTION_IDENTITIES = Object.freeze({
  codex: { adapter: "codex.exec", representation: "codex-prompt-schema", supportIds: [] },
  cursor: { adapter: "cursor.native", representation: "cursor-markdown", supportIds: ["explore"] },
  "kiro-cli": { adapter: "kiro-cli.native", representation: "kiro-descriptor-prompt", supportIds: ["explore", "maister"] },
  pi: { adapter: "pi.native", representation: "pi-agent-frontmatter", supportIds: [] },
});
const REQUIRED_PRIMITIVES = [
  "user_gate",
  "delegate_agent",
  "track_progress",
  "resolve_task_root",
  "persist_state",
  "continue_workflow",
];
const OVERLAY_FIELDS = [
  "schema_version",
  "overlay_id",
  "overlay_version",
  "target",
  "layout",
  "settings",
  "semantic_bindings",
  "inventory",
  "validation",
  "capabilities",
  "native_assets",
  "agent_projection",
];
const OVERLAY_OPTIONAL_FIELDS = ["compatibility", "probes"];
const TARGET_FIELDS = ["id", "host_version_constraint", "discovery_roots"];
const TARGET_OPTIONAL_FIELDS = ["adapter_id", "projection", "platform", "path_policy"];
const LAYOUT_FIELDS = ["source", "destination", "kind", "mode", "ownership"];
const LAYOUT_OPTIONAL_FIELDS = ["merge", "child_prefix", "native"];
const SETTING_FIELDS = ["path", "format", "ownership", "managed_keys", "merge_policy"];
const SETTING_OPTIONAL_FIELDS = ["array_path", "identity", "entries"];
const BINDING_FIELDS = ["adapter", "capability", "fail_closed"];
const INVENTORY_FIELDS = ["required", "optional", "forbidden"];
const INVENTORY_OPTIONAL_FIELDS = ["command_origins", "skill_origins", "role_origins", "support_inventory"];
const VALIDATION_FIELDS = ["forbidden_vocabulary", "executable_paths", "syntax_checks"];
const VALIDATION_OPTIONAL_FIELDS = ["forbidden_topology"];
const CAPABILITY_FIELDS = ["class", "required_evidence"];
const NATIVE_ASSET_FIELDS = ["source", "destination", "mode", "sha256"];
const AGENT_PROJECTION_FIELDS = [
  "schema_version",
  "contract",
  "projector_version",
  "adapter_id",
  "representation",
  "canonical_roles",
  "destinations",
  "transform_ids",
  "execution_profile_ids",
  "support_inventory",
];
const PROJECTION_DESTINATION_FIELDS = ["kind", "path_template", "mode"];
const SUPPORT_ROLE_FIELDS = ["support_id", "native_role_external_id", "assets"];
const SUPPORT_ASSET_FIELDS = ["kind", "source", "destination", "mode"];
const INVENTORY_FIXTURE_FIELDS = ["schema_version", "target", "overlay_version", ...INVENTORY_FIELDS, "agent_projection"];

const PI_COMMAND_IDS = [
  "modeling-aggregate-designer",
  "modeling-context-distiller",
  "quick-metaprogram-classifier",
  "quick-problem-classifier",
  "quick-requirements-critic",
  "quick-transcript-critic",
  "reviews-code",
  "reviews-linguistic-boundaries",
  "reviews-pragmatic",
  "reviews-production-readiness",
  "reviews-reality-check",
  "reviews-spec-audit",
  "reviews-test-strategy",
  "work",
];
const PI_SKILL_IDS = [
  "aggregate-designer",
  "bye",
  "codebase-analyzer",
  "context-distiller",
  "dev",
  "development",
  "docs-manager",
  "grill-me",
  "grill-with-docs",
  "implementation-plan-executor",
  "implementation-verifier",
  "init",
  "issue",
  "linguistic-boundary-verifier",
  "metaprogram-classifier",
  "migration",
  "next",
  "orchestrator-framework",
  "performance",
  "problem-classifier",
  "product-design",
  "quick-bugfix",
  "quick-dev",
  "quick-plan",
  "requirements-critic",
  "research",
  "resume",
  "standards-discover",
  "standards-update",
  "status",
  "test-strategy-reviewer",
  "thermo-nuclear-code-quality-review",
  "thermo-nuclear-review",
  "thermos",
  "transcript-critic",
  "work",
];
const PI_REQUIRED_INVENTORY = [
  "package.json",
  ".maister-source.json",
  "agent-projection-v1.json",
  "pi-command-projection-v1.json",
  "extensions/maister.ts",
  "skills/**/SKILL.md",
  "prompts/*.md",
  "agents/maister-*.md",
  "common/**",
  "lib/**",
  "bin/**",
  "orchestrator-framework/**",
];

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureMapping(value, location, code = "E_OVERLAY_SCHEMA") {
  if (!isMapping(value)) throwOverlayError(code, `${location} must be a mapping`, { location });
}

function ensureFields(value, fields, location, code = "E_OVERLAY_SCHEMA", { optional = [] } = {}) {
  ensureMapping(value, location, code);
  const allowed = new Set([...fields, ...optional]);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) {
    throwOverlayError(code, `${location} has unknown field ${unknown}`, { location, field: unknown });
  }
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) {
    throwOverlayError(code, `${location} is missing ${missing}`, { location, field: missing });
  }
}

function ensureString(value, location, code = "E_OVERLAY_SCHEMA") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throwOverlayError(code, `${location} must be a non-empty NUL-free string`, { location });
  }
}

function ensureBoolean(value, location, code = "E_OVERLAY_SCHEMA") {
  if (typeof value !== "boolean") throwOverlayError(code, `${location} must be boolean`, { location });
}

function ensureInteger(value, location, code = "E_OVERLAY_SCHEMA") {
  if (!Number.isInteger(value)) throwOverlayError(code, `${location} must be an integer`, { location });
}

function ensureArray(value, location, code = "E_OVERLAY_SCHEMA") {
  if (!Array.isArray(value)) throwOverlayError(code, `${location} must be a sequence`, { location });
}

function ensureUnique(values, location, code = "E_OVERLAY_SCHEMA") {
  if (new Set(values).size !== values.length) {
    throwOverlayError(code, `${location} must contain unique values`, { location });
  }
}

function ensureSemver(value, location) {
  ensureString(value, location);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value)) {
    throwOverlayError("E_OVERLAY_SCHEMA", `${location} must be a semantic version`, { location });
  }
}

function ensureMode(value, location) {
  ensureString(value, location);
  if (!/^0[0-7]{3,4}$/u.test(value)) {
    throwOverlayError("E_OVERLAY_SCHEMA", `${location} must be an octal mode`, { location });
  }
}

function ensureRelativePath(value, location, { allowGlob = false } = {}) {
  ensureString(value, location, "E_OVERLAY_PATH");
  if (
    value.startsWith("/")
    || value.startsWith("~")
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.includes("\\")
  ) {
    throwOverlayError("E_OVERLAY_PATH", `${location} must be target-relative`, { location, value });
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throwOverlayError("E_OVERLAY_PATH", `${location} contains an unsafe path segment`, { location, value });
  }
  if (!allowGlob && /[*?\[\]{}]/u.test(value)) {
    throwOverlayError("E_OVERLAY_PATH", `${location} cannot contain a glob`, { location, value });
  }
  return path.posix.normalize(value);
}

function ensurePathList(values, location, options = {}) {
  ensureArray(values, location);
  const normalized = values.map((value, index) => ensureRelativePath(value, `${location}[${index}]`, options));
  ensureUnique(normalized, location, "E_OVERLAY_COLLISION");
  return normalized;
}

function normalizedInventoryPath(value) {
  return path.posix.normalize(value).toLocaleLowerCase("en-US");
}

function validateTarget(target) {
  ensureFields(target, TARGET_FIELDS, "target", "E_OVERLAY_SCHEMA", { optional: TARGET_OPTIONAL_FIELDS });
  if (!SUPPORTED_TARGET_IDS.includes(target.id)) {
    throwOverlayError("E_OVERLAY_TARGET", `target.id is unsupported: ${target.id}`, { target: target.id });
  }
  ensureString(target.host_version_constraint, "target.host_version_constraint");
  ensurePathList(target.discovery_roots, "target.discovery_roots");
  const optionalPresent = TARGET_OPTIONAL_FIELDS.filter((field) => Object.hasOwn(target, field));
  if (target.id !== "pi" && optionalPresent.length > 0) {
    throwOverlayError("E_OVERLAY_TARGET", `target has Pi-only fields: ${optionalPresent.join(", ")}`, {
      target: target.id,
      fields: optionalPresent,
    });
  }
  if (target.id === "pi") {
    ensureFields(target, [...TARGET_FIELDS, ...TARGET_OPTIONAL_FIELDS], "target");
    if (target.adapter_id !== "pi.native" || target.projection !== "pi.native" || target.platform !== "posix") {
      throwOverlayError("E_OVERLAY_TARGET", "Pi target identity or platform is invalid", { target: target.id });
    }
    ensureFields(target.path_policy, [
      "agent_root_env",
      "default_agent_root",
      "settings_path",
      "session_root_env",
      "package_root_env",
      "package_path",
      "containment",
    ], "target.path_policy", "E_OVERLAY_PATH");
    for (const field of [
      "agent_root_env",
      "default_agent_root",
      "settings_path",
      "session_root_env",
      "package_root_env",
      "package_path",
      "containment",
    ]) {
      ensureString(target.path_policy[field], `target.path_policy.${field}`, "E_OVERLAY_PATH");
    }
    if (target.path_policy.agent_root_env !== "PI_CODING_AGENT_DIR"
      || target.path_policy.default_agent_root !== "$HOME/.pi/agent"
      || target.path_policy.settings_path !== "settings.json"
      || target.path_policy.session_root_env !== "PI_CODING_AGENT_SESSION_DIR"
      || target.path_policy.package_root_env !== "PI_PACKAGE_DIR"
      || target.path_policy.package_path !== "maister"
      || target.path_policy.containment !== "agent_root") {
      throwOverlayError("E_OVERLAY_PATH", "Pi target path policy is not the closed v1 contract", { target: target.id });
    }
  }
}

function validateLayout(layout) {
  ensureArray(layout, "layout");
  const destinations = new Map();
  layout.forEach((entry, index) => {
    const location = `layout[${index}]`;
    ensureFields(entry, LAYOUT_FIELDS, location, "E_OVERLAY_SCHEMA", { optional: LAYOUT_OPTIONAL_FIELDS });
    if (Object.hasOwn(entry, "merge") && typeof entry.merge !== "boolean") {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location}.merge must be boolean`, { location });
    }
    if (Object.hasOwn(entry, "native") && typeof entry.native !== "boolean") {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location}.native must be boolean`, { location });
    }
    ensureRelativePath(entry.source, `${location}.source`);
    const destination = ensureRelativePath(entry.destination, `${location}.destination`);
    if (!LAYOUT_KINDS.has(entry.kind)) {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location}.kind is unsupported`, { location });
    }
    ensureMode(entry.mode, `${location}.mode`);
    if (!OWNERSHIP.has(entry.ownership)) {
      throwOverlayError("E_OVERLAY_OWNERSHIP", `${location}.ownership is unsupported`, { location });
    }
    if (entry.ownership === "managed_keys" && entry.kind !== "file") {
      throwOverlayError("E_OVERLAY_OWNERSHIP", `${location} managed_keys ownership requires a file`, { location });
    }
    const key = destination.toLocaleLowerCase("en-US");
    const previous = destinations.get(key);
    if (previous && !previous.merge && !entry.merge) {
      throwOverlayError("E_OVERLAY_COLLISION", "layout destinations must contain unique values", {
        location: "layout destinations",
        destination,
      });
    }
    destinations.set(key, entry);
  });
}

function validateSettings(settings) {
  ensureArray(settings, "settings");
  const paths = [];
  settings.forEach((entry, index) => {
    const location = `settings[${index}]`;
    ensureFields(entry, SETTING_FIELDS, location, "E_OVERLAY_SCHEMA", { optional: SETTING_OPTIONAL_FIELDS });
    paths.push(ensureRelativePath(entry.path, `${location}.path`));
    if (!SETTING_FORMATS.has(entry.format)) {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location}.format is unsupported`, { location });
    }
    if (!OWNERSHIP.has(entry.ownership)) {
      throwOverlayError("E_OVERLAY_OWNERSHIP", `${location}.ownership is unsupported`, { location });
    }
    ensurePathList(entry.managed_keys, `${location}.managed_keys`);
    if (entry.ownership === "whole_file" && entry.managed_keys.length > 0) {
      throwOverlayError("E_OVERLAY_OWNERSHIP", `${location}.managed_keys must be empty for whole_file`, { location });
    }
    if (entry.ownership === "managed_keys" && entry.managed_keys.length === 0) {
      throwOverlayError("E_OVERLAY_OWNERSHIP", `${location}.managed_keys must be non-empty`, { location });
    }
    if (entry.merge_policy !== "preserve_unmanaged_refuse_drift") {
      throwOverlayError("E_OVERLAY_OWNERSHIP", `${location}.merge_policy is unsupported`, { location });
    }
    if (entry.ownership === "managed_array_entries") {
      ensureFields(entry, [...SETTING_FIELDS, ...SETTING_OPTIONAL_FIELDS], location, "E_OVERLAY_OWNERSHIP");
      if (entry.format !== "json" || entry.path !== "settings.json") {
        throwOverlayError("E_OVERLAY_OWNERSHIP", `${location} managed_array_entries requires settings.json JSON`, { location });
      }
      if (entry.managed_keys.length !== 0 || entry.array_path !== "packages" || entry.identity !== "pi_local_package_v1") {
        throwOverlayError("E_OVERLAY_OWNERSHIP", `${location} does not match the Pi managed-array contract`, { location });
      }
      ensureArray(entry.entries, `${location}.entries`, "E_OVERLAY_OWNERSHIP");
      if (entry.entries.length !== 1) {
        throwOverlayError("E_OVERLAY_OWNERSHIP", `${location}.entries must contain one generated package identity`, { location });
      }
      ensureFields(entry.entries[0], ["source"], `${location}.entries[0]`, "E_OVERLAY_OWNERSHIP");
      ensureString(entry.entries[0].source, `${location}.entries[0].source`, "E_OVERLAY_OWNERSHIP");
      if (entry.entries[0].source !== "./maister") {
        throwOverlayError("E_OVERLAY_OWNERSHIP", `${location}.entries[0].source must be ./maister`, { location });
      }
    } else if (SETTING_OPTIONAL_FIELDS.some((field) => Object.hasOwn(entry, field))) {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location} has Pi-only managed-array fields`, { location });
    }
  });
  ensureUnique(paths.map((value) => value.toLocaleLowerCase("en-US")), "settings paths", "E_OVERLAY_COLLISION");
}

function validateSemanticBindings(bindings) {
  ensureFields(bindings, REQUIRED_PRIMITIVES, "semantic_bindings", "E_OVERLAY_BINDINGS");
  Object.entries(bindings).forEach(([primitive, binding]) => {
    const location = `semantic_bindings.${primitive}`;
    ensureFields(binding, BINDING_FIELDS, location, "E_OVERLAY_BINDINGS");
    ensureString(binding.adapter, `${location}.adapter`, "E_OVERLAY_BINDINGS");
    ensureString(binding.capability, `${location}.capability`, "E_OVERLAY_BINDINGS");
    ensureBoolean(binding.fail_closed, `${location}.fail_closed`, "E_OVERLAY_BINDINGS");
    if (!binding.fail_closed) {
      throwOverlayError("E_OVERLAY_BINDINGS", `${location}.fail_closed must be true`, { location });
    }
  });
}

function validateInventory(inventory, location = "inventory") {
  ensureFields(inventory, INVENTORY_FIELDS, location, "E_OVERLAY_SCHEMA", { optional: INVENTORY_OPTIONAL_FIELDS });
  const normalized = new Map();
  for (const category of INVENTORY_FIELDS) {
    ensureArray(inventory[category], `${location}.${category}`);
    inventory[category].forEach((entry, index) => {
      const normalizedEntry = ensureRelativePath(entry, `${location}.${category}[${index}]`, { allowGlob: true });
      const key = normalizedInventoryPath(normalizedEntry);
      if (normalized.has(key)) {
        throwOverlayError("E_OVERLAY_COLLISION", `inventory paths collide after normalization: ${entry}`, {
          location,
          path: entry,
          previous: normalized.get(key),
        });
      }
      normalized.set(key, entry);
    });
  }
  return inventory;
}

function validatePiOriginList(inventory, field, expectedSources, location) {
  ensureArray(inventory[field], `${location}.${field}`, "E_OVERLAY_INVENTORY");
  const sources = [];
  const destinations = [];
  inventory[field].forEach((entry, index) => {
    const entryLocation = `${location}.${field}[${index}]`;
    ensureFields(entry, ["source", "destination", "kind"], entryLocation, "E_OVERLAY_INVENTORY", {
      optional: ["transform_id", "sha256", "logical_role_id"],
    });
    sources.push(ensureRelativePath(entry.source, `${entryLocation}.source`));
    destinations.push(ensureRelativePath(entry.destination, `${entryLocation}.destination`));
    ensureString(entry.kind, `${entryLocation}.kind`, "E_OVERLAY_INVENTORY");
    if (Object.hasOwn(entry, "transform_id")) ensureString(entry.transform_id, `${entryLocation}.transform_id`, "E_OVERLAY_INVENTORY");
    if (Object.hasOwn(entry, "sha256")) {
      ensureString(entry.sha256, `${entryLocation}.sha256`, "E_OVERLAY_INVENTORY");
      if (!/^[0-9a-f]{64}$/u.test(entry.sha256)) {
        throwOverlayError("E_OVERLAY_INVENTORY", `${entryLocation}.sha256 must be lowercase SHA-256`, { location: entryLocation });
      }
    }
    if (Object.hasOwn(entry, "logical_role_id")) ensureString(entry.logical_role_id, `${entryLocation}.logical_role_id`, "E_OVERLAY_INVENTORY");
  });
  ensureUnique(sources.map((value) => value.toLocaleLowerCase("en-US")), `${location}.${field} sources`, "E_OVERLAY_COLLISION");
  ensureUnique(destinations.map((value) => value.toLocaleLowerCase("en-US")), `${location}.${field} destinations`, "E_OVERLAY_COLLISION");
  if (inventory[field].length !== expectedSources.length) {
    throwOverlayError("E_OVERLAY_INVENTORY", `${location}.${field} must contain the closed inventory`, {
      expected: expectedSources.length,
      actual: inventory[field].length,
    });
  }
  if (JSON.stringify(sources) !== JSON.stringify(expectedSources)) {
    throwOverlayError("E_OVERLAY_INVENTORY", `${location}.${field} has unexpected source origins`, {
      expected: expectedSources,
      actual: sources,
    });
  }
}

function validatePiInventory(inventory, location = "inventory") {
  ensureFields(inventory, [...INVENTORY_FIELDS, ...INVENTORY_OPTIONAL_FIELDS], location, "E_OVERLAY_INVENTORY");
  if (JSON.stringify(inventory.required) !== JSON.stringify(PI_REQUIRED_INVENTORY)) {
    throwOverlayError("E_OVERLAY_INVENTORY", `${location}.required must be the closed Pi package inventory`, { location });
  }
  validatePiOriginList(
    inventory,
    "command_origins",
    PI_COMMAND_IDS.map((id) => `commands/${id}.md`),
    location,
  );
  validatePiOriginList(
    inventory,
    "skill_origins",
    PI_SKILL_IDS.map((id) => `skills/${id}`),
    location,
  );
  validatePiOriginList(
    inventory,
    "role_origins",
    CANONICAL_ROLE_IDS.map((id) => `agents/${id}.md`),
    location,
  );
  ensureArray(inventory.support_inventory, `${location}.support_inventory`, "E_OVERLAY_INVENTORY");
  if (inventory.support_inventory.length !== 0) {
    throwOverlayError("E_OVERLAY_INVENTORY", `${location}.support_inventory must be empty for Pi v1`, { location });
  }
}

function validateValidation(validation) {
  ensureFields(validation, VALIDATION_FIELDS, "validation", "E_OVERLAY_SCHEMA", { optional: VALIDATION_OPTIONAL_FIELDS });
  ensurePathList(validation.forbidden_vocabulary, "validation.forbidden_vocabulary");
  ensurePathList(validation.executable_paths, "validation.executable_paths", { allowGlob: true });
  ensureArray(validation.syntax_checks, "validation.syntax_checks");
  validation.syntax_checks.forEach((check, index) => {
    ensureString(check, `validation.syntax_checks[${index}]`);
    if (!/^[a-z]+:[^\s].*$/u.test(check)) {
      throwOverlayError("E_OVERLAY_SCHEMA", `validation.syntax_checks[${index}] must be format:path`, { index });
    }
  });
  ensureUnique(validation.syntax_checks, "validation.syntax_checks");
  if (Object.hasOwn(validation, "forbidden_topology")) {
    ensurePathList(validation.forbidden_topology, "validation.forbidden_topology", { allowGlob: true });
  }
}

function validateCapabilities(capabilities) {
  ensureMapping(capabilities, "capabilities");
  if (Object.keys(capabilities).length === 0) {
    throwOverlayError("E_OVERLAY_SCHEMA", "capabilities must not be empty", { location: "capabilities" });
  }
  Object.entries(capabilities).forEach(([capability, value]) => {
    const location = `capabilities.${capability}`;
    ensureFields(value, CAPABILITY_FIELDS, location);
    if (!CAPABILITY_CLASSES.has(value.class)) {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location}.class is unsupported`, { location });
    }
    ensureArray(value.required_evidence, `${location}.required_evidence`);
    value.required_evidence.forEach((evidence, index) => {
      if (!EVIDENCE_IDS.has(evidence)) {
        throwOverlayError("E_OVERLAY_SCHEMA", `${location}.required_evidence[${index}] is unsupported`, { location });
      }
    });
    ensureUnique(value.required_evidence, `${location}.required_evidence`);
  });
}

function validateNativeAssets(nativeAssets) {
  ensureArray(nativeAssets, "native_assets");
  const destinations = [];
  nativeAssets.forEach((entry, index) => {
    const location = `native_assets[${index}]`;
    ensureFields(entry, NATIVE_ASSET_FIELDS, location);
    ensureRelativePath(entry.source, `${location}.source`);
    destinations.push(ensureRelativePath(entry.destination, `${location}.destination`));
    ensureMode(entry.mode, `${location}.mode`);
    ensureString(entry.sha256, `${location}.sha256`);
    if (!/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location}.sha256 must be a lowercase SHA-256`, { location });
    }
  });
  ensureUnique(destinations.map((value) => value.toLocaleLowerCase("en-US")), "native asset destinations", "E_OVERLAY_COLLISION");
}

function ensureProjectionPathTemplate(value, location) {
  ensureString(value, location, "E_OVERLAY_PATH");
  if (!/^([^{}]|\{role_id\})+$/u.test(value) || !value.includes("{role_id}")) {
    throwOverlayError("E_OVERLAY_PATH", `${location} must contain only the {role_id} template token`, { location, value });
  }
  ensureRelativePath(value.replaceAll("{role_id}", "role-id"), location);
  return value;
}

function validateAgentProjection(agentProjection, targetId, location = "agent_projection") {
  ensureFields(agentProjection, AGENT_PROJECTION_FIELDS, location);
  ensureInteger(agentProjection.schema_version, `${location}.schema_version`);
  if (agentProjection.schema_version !== 1) {
    throwOverlayError("E_OVERLAY_SCHEMA", `${location}.schema_version must be 1`, { location });
  }
  if (agentProjection.contract !== "agent-projection-v1.json") {
    throwOverlayError("E_OVERLAY_SCHEMA", `${location}.contract must reference agent-projection-v1.json`, { location });
  }
  ensureSemver(agentProjection.projector_version, `${location}.projector_version`);
  const identity = TARGET_PROJECTION_IDENTITIES[targetId];
  if (!identity || agentProjection.adapter_id !== identity.adapter || agentProjection.representation !== identity.representation) {
    throwOverlayError("E_OVERLAY_TARGET", `${location} adapter or representation does not match ${targetId}`, {
      location,
      target: targetId,
    });
  }
  ensureArray(agentProjection.canonical_roles, `${location}.canonical_roles`);
  agentProjection.canonical_roles.forEach((roleId, index) => ensureString(roleId, `${location}.canonical_roles[${index}]`));
  if (JSON.stringify(agentProjection.canonical_roles) !== JSON.stringify(CANONICAL_ROLE_IDS)) {
    throwOverlayError("E_OVERLAY_INVENTORY", `${location}.canonical_roles must be the exact sorted 28-role inventory`, {
      location,
      actual: agentProjection.canonical_roles,
    });
  }
  ensureArray(agentProjection.destinations, `${location}.destinations`);
  if (agentProjection.destinations.length === 0) {
    throwOverlayError("E_OVERLAY_SCHEMA", `${location}.destinations must not be empty`, { location });
  }
  const destinations = [];
  agentProjection.destinations.forEach((destination, index) => {
    const destinationLocation = `${location}.destinations[${index}]`;
    ensureFields(destination, PROJECTION_DESTINATION_FIELDS, destinationLocation);
    ensureString(destination.kind, `${destinationLocation}.kind`);
    destinations.push(ensureProjectionPathTemplate(destination.path_template, `${destinationLocation}.path_template`));
    ensureMode(destination.mode, `${destinationLocation}.mode`);
  });
  ensureUnique(destinations.map((value) => value.toLocaleLowerCase("en-US")), `${location}.destinations`, "E_OVERLAY_COLLISION");
  for (const field of ["transform_ids", "execution_profile_ids"]) {
    ensureArray(agentProjection[field], `${location}.${field}`);
    if (agentProjection[field].length === 0) {
      throwOverlayError("E_OVERLAY_SCHEMA", `${location}.${field} must not be empty`, { location });
    }
    agentProjection[field].forEach((value, index) => {
      ensureString(value, `${location}.${field}[${index}]`);
      if (!PROFILE_ID.test(value)) {
        throwOverlayError("E_OVERLAY_SCHEMA", `${location}.${field}[${index}] is not a safe ID`, { location, value });
      }
      if (field === "execution_profile_ids" && !value.startsWith(`${targetId}.`)) {
        throwOverlayError("E_OVERLAY_TARGET", `${location}.${field}[${index}] does not match ${targetId}`, { location, value });
      }
    });
    ensureUnique(agentProjection[field], `${location}.${field}`, "E_OVERLAY_COLLISION");
  }
  ensureArray(agentProjection.support_inventory, `${location}.support_inventory`);
  const supportIds = [];
  const supportDestinations = [];
  agentProjection.support_inventory.forEach((support, index) => {
    const supportLocation = `${location}.support_inventory[${index}]`;
    ensureFields(support, SUPPORT_ROLE_FIELDS, supportLocation);
    ensureString(support.support_id, `${supportLocation}.support_id`);
    ensureString(support.native_role_external_id, `${supportLocation}.native_role_external_id`);
    if (!/^[a-z][a-z0-9-]*$/u.test(support.support_id) || CANONICAL_ROLE_IDS.includes(support.support_id)) {
      throwOverlayError("E_OVERLAY_INVENTORY", `${supportLocation}.support_id must be separate from canonical roles`, {
        location: supportLocation,
        supportId: support.support_id,
      });
    }
    ensureArray(support.assets, `${supportLocation}.assets`);
    if (support.assets.length === 0) {
      throwOverlayError("E_OVERLAY_INVENTORY", `${supportLocation}.assets must not be empty`, { location: supportLocation });
    }
    support.assets.forEach((asset, assetIndex) => {
      const assetLocation = `${supportLocation}.assets[${assetIndex}]`;
      ensureFields(asset, SUPPORT_ASSET_FIELDS, assetLocation);
      ensureString(asset.kind, `${assetLocation}.kind`);
      ensureRelativePath(asset.source, `${assetLocation}.source`);
      supportDestinations.push(ensureRelativePath(asset.destination, `${assetLocation}.destination`));
      ensureMode(asset.mode, `${assetLocation}.mode`);
    });
    supportIds.push(support.support_id);
  });
  if (JSON.stringify(supportIds) !== JSON.stringify(identity.supportIds)) {
    throwOverlayError("E_OVERLAY_INVENTORY", `${location}.support_inventory differs from the target support contract`, {
      target: targetId,
      supportIds,
    });
  }
  ensureUnique(supportDestinations.map((value) => value.toLocaleLowerCase("en-US")), `${location}.support destinations`, "E_OVERLAY_COLLISION");
  return agentProjection;
}

function validatePiCompatibility(compatibility) {
  ensureFields(compatibility, ["pi", "node", "pi_subagents", "delegation_protocol"], "compatibility", "E_OVERLAY_SCHEMA");
  ensureSemver(compatibility.pi, "compatibility.pi");
  ensureSemver(compatibility.node, "compatibility.node");
  ensureSemver(compatibility.pi_subagents, "compatibility.pi_subagents");
  ensureInteger(compatibility.delegation_protocol, "compatibility.delegation_protocol");
  if (JSON.stringify(compatibility) !== JSON.stringify({
    pi: "0.80.10",
    node: "25.9.0",
    pi_subagents: "0.35.1",
    delegation_protocol: 1,
  })) {
    throwOverlayError("E_OVERLAY_SCHEMA", "Pi compatibility tuple is not the pinned v1 baseline", { location: "compatibility" });
  }
}

function validatePiProbes(probes) {
  ensureFields(probes, ["executable", "prerequisite"], "probes", "E_OVERLAY_SCHEMA");
  ensureFields(probes.executable, ["command", "version_args", "expected_version", "resolve_realpath"], "probes.executable", "E_OVERLAY_SCHEMA");
  ensureString(probes.executable.command, "probes.executable.command");
  ensureArray(probes.executable.version_args, "probes.executable.version_args");
  probes.executable.version_args.forEach((arg, index) => ensureString(arg, `probes.executable.version_args[${index}]`));
  ensureString(probes.executable.expected_version, "probes.executable.expected_version");
  ensureBoolean(probes.executable.resolve_realpath, "probes.executable.resolve_realpath");
  ensureFields(probes.prerequisite, ["package", "export", "version_range", "tested_version", "protocol_version"], "probes.prerequisite", "E_OVERLAY_SCHEMA");
  for (const field of ["package", "export", "version_range", "tested_version"]) {
    ensureString(probes.prerequisite[field], `probes.prerequisite.${field}`);
  }
  ensureInteger(probes.prerequisite.protocol_version, "probes.prerequisite.protocol_version");
  if (JSON.stringify(probes) !== JSON.stringify({
    executable: {
      command: "pi",
      version_args: ["--version"],
      expected_version: "0.80.10",
      resolve_realpath: true,
    },
    prerequisite: {
      package: "pi-subagents",
      export: "pi-subagents/delegation",
      version_range: ">=0.35.0 <0.36.0",
      tested_version: "0.35.1",
      protocol_version: 1,
    },
  })) {
    throwOverlayError("E_OVERLAY_SCHEMA", "Pi executable or prerequisite probes are not the pinned v1 contract", { location: "probes" });
  }
}

function validatePiOverlayContract(overlay) {
  ensureFields(overlay, [...OVERLAY_FIELDS, ...OVERLAY_OPTIONAL_FIELDS], "overlay", "E_OVERLAY_SCHEMA");
  validatePiCompatibility(overlay.compatibility);
  validatePiProbes(overlay.probes);
  if (overlay.layout.length !== 1 || overlay.layout[0].ownership !== "plugin_private") {
    throwOverlayError("E_OVERLAY_OWNERSHIP", "Pi must declare one plugin_private package tree", { location: "layout" });
  }
  if (overlay.settings.length !== 1 || overlay.settings[0].ownership !== "managed_array_entries") {
    throwOverlayError("E_OVERLAY_OWNERSHIP", "Pi must declare one managed_array_entries settings member", { location: "settings" });
  }
  validatePiInventory(overlay.inventory);
  if (!Array.isArray(overlay.validation.forbidden_topology)
    || !overlay.validation.forbidden_topology.includes("commands/**")
    || !overlay.validation.forbidden_topology.includes("pi-subagents/**")) {
    throwOverlayError("E_OVERLAY_INVENTORY", "Pi forbidden topology must exclude commands and bundled pi-subagents", {
      location: "validation.forbidden_topology",
    });
  }
}

function stringsForVocabularyScan(overlay) {
  return [
    overlay.overlay_id,
    overlay.overlay_version,
    overlay.target.host_version_constraint,
    ...overlay.target.discovery_roots,
    ...overlay.layout.flatMap((entry) => [entry.source, entry.destination]),
    ...overlay.settings.flatMap((entry) => [entry.path, entry.format, ...entry.managed_keys]),
    ...Object.values(overlay.semantic_bindings).flatMap((binding) => [binding.adapter, binding.capability]),
    ...overlay.inventory.required,
    ...overlay.inventory.optional,
    ...overlay.validation.executable_paths,
    ...overlay.validation.syntax_checks,
    ...Object.keys(overlay.capabilities),
    ...overlay.native_assets.flatMap((entry) => [entry.source, entry.destination]),
    overlay.agent_projection.contract,
    overlay.agent_projection.projector_version,
    overlay.agent_projection.adapter_id,
    overlay.agent_projection.representation,
    ...overlay.agent_projection.destinations.flatMap((entry) => [entry.kind, entry.path_template]),
    ...overlay.agent_projection.transform_ids,
    ...overlay.agent_projection.execution_profile_ids,
    ...overlay.agent_projection.support_inventory.flatMap((entry) => [
      entry.support_id,
      entry.native_role_external_id,
      ...entry.assets.flatMap((asset) => [asset.kind, asset.source, asset.destination]),
    ]),
  ];
}

function validateForbiddenVocabulary(overlay) {
  const vocabulary = overlay.validation.forbidden_vocabulary.map((word) => word.toLocaleLowerCase("en-US"));
  const found = stringsForVocabularyScan(overlay).find((value) => {
    const candidate = value.toLocaleLowerCase("en-US");
    return vocabulary.some((word) => candidate.includes(word));
  });
  if (found !== undefined) {
    throwOverlayError("E_OVERLAY_VOCABULARY", `overlay contains forbidden host vocabulary: ${found}`, { value: found });
  }
}

function compareInventory(overlayInventory, fixtureInventory) {
  const normalize = (inventory) => Object.fromEntries(
    [...INVENTORY_FIELDS, ...INVENTORY_OPTIONAL_FIELDS]
      .filter((field) => Object.hasOwn(inventory, field))
      .map((field) => [field, Array.isArray(inventory[field]) ? [...inventory[field]] : inventory[field]]),
  );
  if (JSON.stringify(normalize(overlayInventory)) !== JSON.stringify(normalize(fixtureInventory))) {
    throwOverlayError("E_OVERLAY_INVENTORY", "overlay inventory differs from the versioned inventory fixture", {});
  }
}

export function parseOverlayYaml(source, sourcePath = "<overlay>") {
  try {
    return parseCanonicalYaml(source);
  } catch (error) {
    if (error instanceof OverlayValidationError) throw error;
    throwOverlayError("E_OVERLAY_PARSE", `could not parse ${sourcePath}: ${error.message}`, { sourcePath }, { cause: error });
  }
}

export function validateOverlay(overlay, { sourcePath = "<overlay>" } = {}) {
  ensureFields(overlay, OVERLAY_FIELDS, "overlay", "E_OVERLAY_SCHEMA", { optional: OVERLAY_OPTIONAL_FIELDS });
  ensureInteger(overlay.schema_version, "schema_version");
  if (overlay.schema_version !== 1) {
    throwOverlayError("E_OVERLAY_SCHEMA", "schema_version must be 1", { sourcePath });
  }
  ensureString(overlay.overlay_id, "overlay_id");
  ensureSemver(overlay.overlay_version, "overlay_version");
  validateTarget(overlay.target);
  if (overlay.overlay_id !== `maister/${overlay.target.id}`) {
    throwOverlayError("E_OVERLAY_SCHEMA", "overlay_id must match target.id", { sourcePath });
  }
  validateLayout(overlay.layout);
  validateSettings(overlay.settings);
  validateSemanticBindings(overlay.semantic_bindings);
  validateInventory(overlay.inventory);
  validateValidation(overlay.validation);
  validateCapabilities(overlay.capabilities);
  validateNativeAssets(overlay.native_assets);
  validateAgentProjection(overlay.agent_projection, overlay.target.id);
  validateForbiddenVocabulary(overlay);
  if (overlay.target.id === "pi") {
    validatePiOverlayContract(overlay);
  } else if (OVERLAY_OPTIONAL_FIELDS.some((field) => Object.hasOwn(overlay, field))) {
    throwOverlayError("E_OVERLAY_SCHEMA", "compatibility and probes are Pi-only overlay fields", { sourcePath });
  }
  return overlay;
}

export function validateInventoryFixture(inventory, { sourcePath = "<inventory>" } = {}) {
  ensureFields(inventory, INVENTORY_FIXTURE_FIELDS, "inventory fixture", "E_OVERLAY_INVENTORY", {
    optional: INVENTORY_OPTIONAL_FIELDS,
  });
  ensureInteger(inventory.schema_version, "inventory fixture.schema_version");
  if (inventory.schema_version !== 1) {
    throwOverlayError("E_OVERLAY_INVENTORY", "inventory fixture schema_version must be 1", { sourcePath });
  }
  if (!SUPPORTED_TARGET_IDS.includes(inventory.target)) {
    throwOverlayError("E_OVERLAY_TARGET", `inventory fixture target is unsupported: ${inventory.target}`, { sourcePath });
  }
  ensureSemver(inventory.overlay_version, "inventory fixture.overlay_version");
  validateInventory({
    required: inventory.required,
    optional: inventory.optional,
    forbidden: inventory.forbidden,
  }, "inventory fixture");
  if (inventory.target === "pi") {
    const piInventory = Object.fromEntries(
      [...INVENTORY_FIELDS, ...INVENTORY_OPTIONAL_FIELDS]
        .filter((field) => Object.hasOwn(inventory, field))
        .map((field) => [field, inventory[field]]),
    );
    validatePiInventory(piInventory, "inventory fixture");
  }
  validateAgentProjection(inventory.agent_projection, inventory.target, "inventory fixture.agent_projection");
  return inventory;
}

export function loadOverlay({ overlayPath, inventoryPath }) {
  if (typeof overlayPath !== "string" || typeof inventoryPath !== "string") {
    throwOverlayError("E_OVERLAY_IO", "overlayPath and inventoryPath are required", {});
  }
  let overlaySource;
  let inventorySource;
  try {
    overlaySource = fs.readFileSync(overlayPath, "utf8");
    inventorySource = fs.readFileSync(inventoryPath, "utf8");
  } catch (error) {
    throwOverlayError("E_OVERLAY_IO", `could not read overlay contract: ${error.message}`, {
      overlayPath,
      inventoryPath,
    }, { cause: error });
  }
  const overlay = parseOverlayYaml(overlaySource, overlayPath);
  const inventoryFixture = parseOverlayYaml(inventorySource, inventoryPath);
  validateOverlay(overlay, { sourcePath: overlayPath });
  validateInventoryFixture(inventoryFixture, { sourcePath: inventoryPath });
  if (inventoryFixture.target !== overlay.target.id || inventoryFixture.overlay_version !== overlay.overlay_version) {
    throwOverlayError("E_OVERLAY_INVENTORY", "inventory fixture identity does not match overlay", { overlayPath, inventoryPath });
  }
  compareInventory(overlay.inventory, inventoryFixture);
  if (JSON.stringify(overlay.agent_projection) !== JSON.stringify(inventoryFixture.agent_projection)) {
    throwOverlayError("E_OVERLAY_INVENTORY", "overlay agent projection differs from the versioned inventory fixture", {});
  }
  return {
    overlay,
    inventory: inventoryFixture,
    inventoryFixture,
    overlayPath: path.resolve(overlayPath),
    inventoryPath: path.resolve(inventoryPath),
    contractHash: crypto.createHash("sha256").update(overlaySource).update(inventorySource).digest("hex"),
  };
}

export { normalizedInventoryPath };
