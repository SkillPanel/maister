import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AgentProjectionError,
  failAgentProjection,
  projectionDigest,
  TARGET_TRANSFORMS,
  validateAgentProjection,
} from "./agent-projection-validator.mjs";
import {
  normalizedPathKey,
  normalizeRelativePath,
  resolveInside,
} from "./path-safety.mjs";
import { canonicalJson } from "./provenance.mjs";

const TARGET_IDENTITIES = Object.freeze({
  codex: Object.freeze({ adapter: "codex.exec", nativePrefix: null }),
  cursor: Object.freeze({ adapter: "cursor.native", nativePrefix: "maister-" }),
  "kiro-cli": Object.freeze({ adapter: "kiro-cli.native", nativePrefix: "maister-" }),
  pi: Object.freeze({ adapter: "pi.native", nativePrefix: "maister:" }),
});
const KIRO_TOOL_NAMES = Object.freeze({
  read: Object.freeze(["read"]),
  search: Object.freeze(["grep", "glob"]),
  write: Object.freeze(["write"]),
  shell: Object.freeze(["shell"]),
  web: Object.freeze(["web_fetch", "web_search"]),
  browser: Object.freeze(["aws"]),
  cloud: Object.freeze(["aws"]),
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function observedModeMatches(expected, observed) {
  // Windows does not preserve POSIX permission bits. Content and entry type
  // remain authoritative, but the observed numeric mode cannot be compared.
  return process.platform === "win32" || expected === observed;
}

function textOutput({ outputPath, kind, mode, ownership, roleId = null, supportId = null, content }) {
  const normalizedContent = content.replaceAll("\r\n", "\n").replace(/\n*$/u, "\n");
  const bytes = Buffer.from(normalizedContent, "utf8");
  return {
    path: outputPath,
    kind,
    mode,
    ownership,
    role_id: roleId,
    support_id: supportId,
    content: normalizedContent,
    size: bytes.length,
    sha256: sha256(bytes),
  };
}

function jsonOutput(options, value) {
  return textOutput({ ...options, content: `${canonicalJson(value)}\n` });
}

function validateInputs(agentIr, manifest, target) {
  if (!TARGET_IDENTITIES[target]) {
    failAgentProjection("E_AGENT_PROJECTION_SCHEMA", `unsupported target ${target}`, { target });
  }
  if (!agentIr || agentIr.schema_version !== 1 || !Array.isArray(agentIr.roles)) {
    failAgentProjection("E_AGENT_PROJECTION_INVENTORY", "validated Agent IR is required");
  }
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.rows)) {
    failAgentProjection("E_AGENT_PROJECTION_BINDING", "validated agent manifest is required");
  }
  if (manifest.canonical_set_digest !== agentIr.canonical_set_digest) {
    failAgentProjection("E_AGENT_PROJECTION_BINDING", "manifest canonical-set digest differs from Agent IR", {
      manifestDigest: manifest.canonical_set_digest,
      agentIrDigest: agentIr.canonical_set_digest,
    });
  }
  const roleIds = agentIr.roles.map(({ role_id: roleId }) => roleId);
  const sortedRoleIds = [...roleIds].sort((left, right) => left.localeCompare(right, "en-US"));
  if (roleIds.length !== 28 || new Set(roleIds).size !== roleIds.length || canonicalJson(roleIds) !== canonicalJson(sortedRoleIds)) {
    failAgentProjection("E_AGENT_PROJECTION_INVENTORY", "Agent IR must contain the exact sorted 28-role inventory", {
      actual: roleIds,
    });
  }
  const rows = manifest.rows.filter((row) => row.target === target);
  if (rows.length !== roleIds.length) {
    failAgentProjection("E_AGENT_PROJECTION_INVENTORY", `${target} manifest coverage is incomplete`, {
      expected: roleIds.length,
      actual: rows.length,
    });
  }
  const rowsByRole = new Map();
  for (const row of rows) {
    if (rowsByRole.has(row.role_id)) {
      failAgentProjection("E_AGENT_PROJECTION_COLLISION", `${target} manifest has duplicate role ${row.role_id}`, {
        roleId: row.role_id,
      });
    }
    rowsByRole.set(row.role_id, row);
  }
  for (const role of agentIr.roles) {
    const row = rowsByRole.get(role.role_id);
    if (!row) {
      failAgentProjection("E_AGENT_PROJECTION_INVENTORY", `${target} manifest is missing ${role.role_id}`, {
        roleId: role.role_id,
      });
    }
    const identity = TARGET_IDENTITIES[target];
    const expectedNativeId = identity.nativePrefix === null ? null : `${identity.nativePrefix}${role.role_id}`;
    if (
      row.logical_role_id !== role.logical_role_id
      || row.source_path !== role.source_path
      || row.source_sha256 !== role.source_sha256
      || row.adapter_id !== identity.adapter
      || row.native_role_external_id !== expectedNativeId
    ) {
      failAgentProjection("E_AGENT_PROJECTION_BINDING", `${target} manifest row is not bound to canonical role ${role.role_id}`, {
        roleId: role.role_id,
      });
    }
    if (canonicalJson(row.transform_ids) !== canonicalJson(TARGET_TRANSFORMS[target])) {
      failAgentProjection("E_AGENT_PROJECTION_TRANSFORM", `${target} manifest row has undeclared transforms`, {
        roleId: role.role_id,
        transformIds: row.transform_ids,
      });
    }
    if (!Array.isArray(row.destinations) || row.destinations.length === 0) {
      failAgentProjection("E_AGENT_PROJECTION_INVENTORY", `${target} manifest row has no destinations`, { roleId: role.role_id });
    }
    for (const destination of row.destinations) {
      try {
        const normalized = normalizeRelativePath(destination.path, `${target}.${role.role_id}.destination`);
        if (normalized !== destination.path) throw new Error("destination is not normalized");
      } catch (error) {
        failAgentProjection("E_AGENT_PROJECTION_PATH", `${target} manifest has an unsafe destination`, {
          roleId: role.role_id,
          path: destination.path,
        }, { cause: error });
      }
    }
  }
  const normalizedDestinations = new Map();
  for (const row of rows) {
    for (const destination of row.destinations) {
      const key = normalizedPathKey(destination.path.normalize("NFC"));
      if (normalizedDestinations.has(key)) {
        failAgentProjection("E_AGENT_PROJECTION_COLLISION", `${target} destinations collide after normalization`, {
          path: destination.path,
          previous: normalizedDestinations.get(key),
        });
      }
      normalizedDestinations.set(key, destination.path);
    }
  }
  return { rowsByRole, roleIds };
}

function codexSchema(role) {
  return {
    $id: `https://maister.dev/schemas/agent-role-result/v1/${role.role_id}.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      details: { additionalProperties: true, type: "object" },
      logical_role_id: { const: role.logical_role_id },
      status: { enum: ["completed", "blocked", "failed"], type: "string" },
      summary: { minLength: 1, type: "string" },
    },
    required: ["logical_role_id", "status", "summary", "details"],
    title: `Maister ${role.role_id} result`,
    type: "object",
  };
}

function yamlScalar(value) {
  return JSON.stringify(value);
}

function cursorAgent(role) {
  const lines = [
    "---",
    `name: maister-${role.role_id}`,
    `description: ${yamlScalar(role.description)}`,
    `model: ${role.model_profile_id}`,
  ];
  if (role.color !== null) lines.push(`color: ${role.color}`);
  if (role.skill_dependencies.length > 0) {
    lines.push("skills:", ...role.skill_dependencies.map((skillId) => `  - maister-${skillId}`));
  }
  lines.push("---", "", role.instruction_body.replace(/\n$/u, ""));
  return `${lines.join("\n")}\n`;
}

function piAgent(role, row) {
  const lines = [
    "---",
    `name: ${yamlScalar(`maister:${role.role_id}`)}`,
    `description: ${yamlScalar(role.description)}`,
    `maister_role_id: ${yamlScalar(role.role_id)}`,
    `native_role_external_id: ${yamlScalar(`maister:${role.role_id}`)}`,
    `canonical_source: ${yamlScalar(role.source_path)}`,
    `canonical_source_sha256: ${yamlScalar(row.source_sha256)}`,
    `projection_schema: ${yamlScalar("pi-agent-frontmatter-v1")}`,
    `execution_profile: ${yamlScalar(row.execution_profile_id)}`,
    "---",
    "",
    role.instruction_body.replace(/\n$/u, ""),
  ];
  return `${lines.join("\n")}\n`;
}

function kiroTools(row) {
  const resolved = [];
  for (const logicalTool of row.execution_policy.tools.tools) {
    const nativeTools = KIRO_TOOL_NAMES[logicalTool];
    if (!nativeTools) {
      failAgentProjection("E_AGENT_PROJECTION_TRANSFORM", `Kiro has no declared tool transform for ${logicalTool}`, {
        logicalTool,
        roleId: row.role_id,
      });
    }
    for (const nativeTool of nativeTools) {
      if (!resolved.includes(nativeTool)) resolved.push(nativeTool);
    }
  }
  return resolved;
}

function kiroDescriptor(role, row) {
  const tools = kiroTools(row);
  const descriptor = {
    allowedTools: tools,
    description: role.description,
    name: `maister-${role.role_id}`,
    prompt: `file://./instructions/maister-${role.role_id}.md`,
    tools,
  };
  if (role.skill_dependencies.length > 0) {
    descriptor.resources = role.skill_dependencies.map(
      (skillId) => `skill://~/.kiro/skills/maister-${skillId}/SKILL.md`,
    );
  }
  return descriptor;
}

function canonicalOutputs(agentIr, rowsByRole, target) {
  const outputs = [];
  for (const role of agentIr.roles) {
    const row = rowsByRole.get(role.role_id);
    const destinations = new Map(row.destinations.map((destination) => [destination.kind, destination]));
    if (target === "codex") {
      const prompt = destinations.get("prompt");
      const schema = destinations.get("output-schema");
      if (!prompt || !schema) {
        failAgentProjection("E_AGENT_PROJECTION_INVENTORY", `Codex destinations are incomplete for ${role.role_id}`);
      }
      outputs.push(textOutput({
        outputPath: prompt.path,
        kind: prompt.kind,
        mode: prompt.mode,
        ownership: "canonical",
        roleId: role.role_id,
        content: role.instruction_body,
      }));
      outputs.push(jsonOutput({
        outputPath: schema.path,
        kind: schema.kind,
        mode: schema.mode,
        ownership: "canonical",
        roleId: role.role_id,
      }, codexSchema(role)));
    } else if (target === "cursor") {
      const agent = destinations.get("agent");
      if (!agent || agent.path !== `agents/maister-${role.role_id}.md`) {
        failAgentProjection("E_AGENT_PROJECTION_BINDING", `Cursor destination does not match exact native identity for ${role.role_id}`);
      }
      outputs.push(textOutput({
        outputPath: agent.path,
        kind: agent.kind,
        mode: agent.mode,
        ownership: "canonical",
        roleId: role.role_id,
        content: cursorAgent(role),
      }));
    } else if (target === "pi") {
      const agent = destinations.get("package-agent");
      if (!agent || agent.path !== `agents/maister-${role.role_id}.md`) {
        failAgentProjection("E_AGENT_PROJECTION_BINDING", `Pi destination does not match exact package-agent identity for ${role.role_id}`);
      }
      outputs.push(textOutput({
        outputPath: agent.path,
        kind: agent.kind,
        mode: agent.mode,
        ownership: "canonical",
        roleId: role.role_id,
        content: piAgent(role, row),
      }));
    } else {
      const descriptor = destinations.get("descriptor");
      const prompt = destinations.get("prompt");
      if (
        !descriptor
        || !prompt
        || descriptor.path !== `agents/maister-${role.role_id}.json`
        || prompt.path !== `agents/instructions/maister-${role.role_id}.md`
      ) {
        failAgentProjection("E_AGENT_PROJECTION_BINDING", `Kiro destinations do not match exact native identity for ${role.role_id}`);
      }
      outputs.push(jsonOutput({
        outputPath: descriptor.path,
        kind: descriptor.kind,
        mode: descriptor.mode,
        ownership: "canonical",
        roleId: role.role_id,
      }, kiroDescriptor(role, row)));
      outputs.push(textOutput({
        outputPath: prompt.path,
        kind: prompt.kind,
        mode: prompt.mode,
        ownership: "canonical",
        roleId: role.role_id,
        content: role.instruction_body,
      }));
    }
  }
  return outputs;
}

function supportOutputs(manifest, target, supportAssets) {
  const expectedSupport = manifest.support_inventory.filter((entry) => entry.target === target);
  if (!Array.isArray(supportAssets)) {
    failAgentProjection("E_AGENT_PROJECTION_INVENTORY", "supportAssets must be a sequence");
  }
  const supplied = new Map();
  for (const asset of supportAssets) {
    const key = `${asset.support_id}\0${asset.source}\0${asset.destination}`;
    if (supplied.has(key)) {
      failAgentProjection("E_AGENT_PROJECTION_COLLISION", `duplicate support asset ${asset.destination}`, {
        destination: asset.destination,
      });
    }
    supplied.set(key, asset);
  }
  const outputs = [];
  const inventory = [];
  for (const support of expectedSupport) {
    const outputPaths = [];
    for (const expectedAsset of support.assets) {
      const key = `${support.support_id}\0${expectedAsset.source}\0${expectedAsset.destination}`;
      const asset = supplied.get(key);
      if (
        !asset
        || asset.kind !== expectedAsset.kind
        || asset.mode !== expectedAsset.mode
        || typeof asset.content !== "string"
      ) {
        failAgentProjection("E_AGENT_PROJECTION_INVENTORY", `support asset is missing or differs from its manifest: ${expectedAsset.source}`, {
          supportId: support.support_id,
          source: expectedAsset.source,
        });
      }
      const outputOptions = {
        outputPath: expectedAsset.destination,
        kind: expectedAsset.kind,
        mode: expectedAsset.mode,
        ownership: "support",
        supportId: support.support_id,
      };
      if (expectedAsset.destination.endsWith(".json")) {
        let parsed;
        try {
          parsed = JSON.parse(asset.content);
        } catch (error) {
          failAgentProjection("E_AGENT_PROJECTION_SCHEMA", `support asset is not valid JSON: ${expectedAsset.source}`, {
            supportId: support.support_id,
            source: expectedAsset.source,
          }, { cause: error });
        }
        outputs.push(jsonOutput(outputOptions, parsed));
      } else {
        outputs.push(textOutput({ ...outputOptions, content: asset.content }));
      }
      outputPaths.push(expectedAsset.destination);
      supplied.delete(key);
    }
    inventory.push({ support_id: support.support_id, output_paths: outputPaths.sort() });
  }
  if (supplied.size > 0) {
    failAgentProjection("E_AGENT_PROJECTION_INVENTORY", "supportAssets contains an undeclared asset", {
      asset: supplied.values().next().value.source,
    });
  }
  return { outputs, inventory };
}

function compareOutputs(left, right) {
  const leftKey = normalizedPathKey(left.path);
  const rightKey = normalizedPathKey(right.path);
  return leftKey.localeCompare(rightKey, "en-US") || left.path.localeCompare(right.path, "en-US");
}

export function createAgentProjection({ agentIr, manifest, target, supportAssets = [] } = {}) {
  const { rowsByRole, roleIds } = validateInputs(agentIr, manifest, target);
  const canonical = canonicalOutputs(agentIr, rowsByRole, target);
  const support = supportOutputs(manifest, target, supportAssets);
  const outputs = [...canonical, ...support.outputs].sort(compareOutputs);
  const projection = {
    schema_version: manifest.schema_version,
    projector_version: manifest.projector_version,
    target,
    canonical_set_digest: agentIr.canonical_set_digest,
    manifest_digest: manifest.manifest_digest,
    transform_ids: [...TARGET_TRANSFORMS[target]],
    canonical_role_ids: [...roleIds],
    support_inventory: support.inventory,
    outputs,
    projected_tree_digest: projectionDigest(outputs),
  };
  return validateAgentProjection({ projection });
}

function validateStagingRoot(stagingRoot) {
  if (typeof stagingRoot !== "string" || stagingRoot.length === 0) {
    failAgentProjection("E_AGENT_PROJECTION_IO", "stagingRoot is required");
  }
  let stat;
  try {
    stat = fs.lstatSync(stagingRoot);
  } catch (error) {
    failAgentProjection("E_AGENT_PROJECTION_IO", "stagingRoot must already exist", { stagingRoot }, { cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    failAgentProjection("E_AGENT_PROJECTION_IO", "stagingRoot must be a real directory", { stagingRoot });
  }
}

function preflightOutput(stagingRoot, output) {
  let destination;
  try {
    destination = resolveInside(stagingRoot, output.path, "agent projection destination");
  } catch (error) {
    failAgentProjection("E_AGENT_PROJECTION_PATH", `projection output escapes staging: ${output.path}`, {
      path: output.path,
    }, { cause: error });
  }
  let current = path.dirname(destination);
  while (current !== stagingRoot && current.startsWith(`${stagingRoot}${path.sep}`)) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      failAgentProjection("E_AGENT_PROJECTION_DRIFT", `projection parent is not a safe directory: ${output.path}`, {
        path: output.path,
      });
    }
    current = path.dirname(current);
  }
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      failAgentProjection("E_AGENT_PROJECTION_DRIFT", `projection destination has an incompatible entry: ${output.path}`, {
        path: output.path,
      });
    }
    const existingMode = (existing.mode & 0o7777).toString(8).padStart(4, "0");
    const existingContent = fs.readFileSync(destination, "utf8");
    if (!observedModeMatches(output.mode, existingMode) || existingContent !== output.content) {
      failAgentProjection("E_AGENT_PROJECTION_DRIFT", `projection destination was hand edited: ${output.path}`, {
        path: output.path,
      });
    }
  }
  return { destination, exists: Boolean(existing) };
}

export function projectAgents({ agentIr, manifest, target, stagingRoot, supportAssets = [] } = {}) {
  validateStagingRoot(stagingRoot);
  const projection = createAgentProjection({ agentIr, manifest, target, supportAssets });
  const writes = projection.outputs.map((output) => ({ output, ...preflightOutput(path.resolve(stagingRoot), output) }));
  try {
    for (const { destination, exists, output } of writes) {
      if (exists) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      fs.writeFileSync(destination, output.content, { encoding: "utf8", flag: "wx", mode: Number.parseInt(output.mode, 8) });
      fs.chmodSync(destination, Number.parseInt(output.mode, 8));
    }
  } catch (error) {
    if (error instanceof AgentProjectionError) throw error;
    failAgentProjection("E_AGENT_PROJECTION_IO", `could not write isolated ${target} projection`, { stagingRoot }, { cause: error });
  }
  return projection;
}

export { AgentProjectionError };
