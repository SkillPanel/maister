import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadCanonicalAgentIr } from "../../plugins/maister/lib/distribution/agent-ir.mjs";
import {
  buildAgentManifest,
  loadAgentProjectionContract,
} from "../../plugins/maister/lib/distribution/agent-manifest.mjs";
import {
  AgentProjectionError,
  createAgentProjection,
  projectAgents,
} from "../../plugins/maister/lib/distribution/agent-projector.mjs";
import { validateAgentProjection } from "../../plugins/maister/lib/distribution/agent-projection-validator.mjs";
import { loadOverlay } from "../../plugins/maister/lib/distribution/overlay-loader.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PLUGIN_ROOT = path.join(ROOT, "plugins/maister");
const PROJECTION_CONTRACT_PATH = path.join(PLUGIN_ROOT, "agent-projection-v1.json");
const PROJECTION_FIXTURE_PATH = path.join(
  ROOT,
  "tests/fixtures/platform-independent/agent-projection/named-transforms.json",
);
const TARGETS = ["codex", "cursor", "kiro-cli", "pi"];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function checkedInOverlay(target) {
  const overlayRoot = path.join(PLUGIN_ROOT, "overlays", target);
  return loadOverlay({
    overlayPath: path.join(overlayRoot, "overlay.yml"),
    inventoryPath: path.join(overlayRoot, "inventory.yml"),
  }).overlay;
}

function loadContext() {
  const projectionContract = loadAgentProjectionContract({ projectionPath: PROJECTION_CONTRACT_PATH });
  const agentIr = loadCanonicalAgentIr({
    agentsRoot: path.join(PLUGIN_ROOT, "agents"),
    skillsRoot: path.join(PLUGIN_ROOT, "skills"),
    expectedRoleIds: projectionContract.expected_role_ids,
  });
  const overlays = Object.fromEntries(TARGETS.map((target) => [target, checkedInOverlay(target)]));
  const manifest = buildAgentManifest({ agentIr, projectionContract, overlays });
  return { agentIr, manifest, overlays, projectionContract };
}

function supportAssetsFor(manifest, target) {
  const overlayRoot = path.join(PLUGIN_ROOT, "overlays", target);
  return manifest.support_inventory
    .filter((support) => support.target === target)
    .flatMap((support) => support.assets.map((asset) => ({
      support_id: support.support_id,
      kind: asset.kind,
      source: asset.source,
      destination: asset.destination,
      mode: asset.mode,
      content: fs.readFileSync(path.join(overlayRoot, asset.source), "utf8"),
    })));
}

function createProjection(target, context = loadContext()) {
  return createAgentProjection({
    agentIr: context.agentIr,
    manifest: context.manifest,
    target,
    supportAssets: supportAssetsFor(context.manifest, target),
  });
}

function outputByPath(projection, relativePath) {
  const output = projection.outputs.find(({ path: outputPath }) => outputPath === relativePath);
  assert.ok(output, `missing projection output ${relativePath}`);
  return output;
}

function expectProjectionError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AgentProjectionError);
    assert.equal(error.code, code);
    assert.equal(error.retryable, false);
    assert.match(error.message, new RegExp(`\\[${code}\\]`, "u"));
    return true;
  });
}

function snapshotFiles(root) {
  const snapshot = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        snapshot.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          mode: (fs.statSync(absolute).mode & 0o7777).toString(8).padStart(4, "0"),
          sha256: sha256(fs.readFileSync(absolute)),
        });
      }
    }
  };
  visit(root);
  return snapshot.sort((left, right) => left.path.localeCompare(right.path, "en-US"));
}

test("projects an exact canonical bijection and separate support inventory for every host", () => {
  const context = loadContext();
  const expectedCounts = {
    codex: { canonical: 56, support: 0 },
    cursor: { canonical: 28, support: 1 },
    "kiro-cli": { canonical: 56, support: 4 },
    pi: { canonical: 28, support: 0 },
  };

  for (const target of TARGETS) {
    const projection = createProjection(target, context);
    assert.deepEqual(projection.canonical_role_ids, context.projectionContract.expected_role_ids);
    assert.equal(projection.outputs.filter(({ ownership }) => ownership === "canonical").length, expectedCounts[target].canonical);
    assert.equal(projection.outputs.filter(({ ownership }) => ownership === "support").length, expectedCounts[target].support);
    assert.deepEqual(
      projection.support_inventory.map(({ support_id }) => support_id),
      context.manifest.support_inventory.filter((entry) => entry.target === target).map(({ support_id }) => support_id),
    );
  }
});

test("two independent projections have identical paths, bytes, modes, hashes, order, and digests", () => {
  const firstContext = loadContext();
  const secondContext = loadContext();

  for (const target of TARGETS) {
    const first = createProjection(target, firstContext);
    const second = createProjection(target, secondContext);
    assert.deepEqual(second, first);
    assert.deepEqual(second.outputs.map(({ path: outputPath }) => outputPath), first.outputs.map(({ path: outputPath }) => outputPath));
    assert.ok(first.outputs.every(({ sha256: outputHash, content }) => outputHash === sha256(Buffer.from(content, "utf8"))));
    assert.equal(second.manifest_digest, first.manifest_digest);
    assert.equal(second.projected_tree_digest, first.projected_tree_digest);
  }
});

test("all textual outputs use UTF-8 LF, one trailing newline, canonical JSON, and stable modes", () => {
  for (const target of TARGETS) {
    const projection = createProjection(target);
    for (const output of projection.outputs) {
      assert.equal(output.mode, "0644");
      assert.equal(output.content.includes("\r"), false, output.path);
      assert.match(output.content, /(?<!\n)\n$/u, output.path);
      assert.equal(Buffer.from(output.content, "utf8").toString("utf8"), output.content);
      if (output.path.endsWith(".json")) {
        const parsed = JSON.parse(output.content);
        assert.equal(`${JSON.stringify(parsed, Object.keys(parsed).sort())}\n`.includes("\r"), false);
      }
    }
  }
});

test("named transform fixtures bind canonical bodies and host-specific shapes", () => {
  const fixture = JSON.parse(fs.readFileSync(PROJECTION_FIXTURE_PATH, "utf8"));
  const codex = createProjection("codex");
  const cursor = createProjection("cursor");
  const kiro = createProjection("kiro-cli");

	const codexPrompt = outputByPath(codex, "skills/maister-orchestrator-framework/agents/maister-advisor.md").content;
  for (const required of fixture["canonical-body-v1"].required) assert.ok(codexPrompt.includes(required));
  const codexSchema = JSON.parse(outputByPath(codex, fixture["codex-output-schema-v1"].path).content);
  assert.equal(codexSchema.properties.logical_role_id.const, fixture["codex-output-schema-v1"].requiredRole);

  const cursorAgent = outputByPath(cursor, fixture["cursor-frontmatter-v1"].path).content;
  for (const required of fixture["cursor-frontmatter-v1"].required) assert.ok(cursorAgent.includes(required));
  for (const forbidden of fixture["cursor-frontmatter-v1"].forbidden) assert.equal(cursorAgent.includes(forbidden), false);

  const kiroDescriptor = JSON.parse(outputByPath(kiro, fixture["kiro-descriptor-v1"].path).content);
  assert.equal(kiroDescriptor.name, fixture["kiro-descriptor-v1"].requiredName);
  assert.equal(kiroDescriptor.prompt, fixture["kiro-descriptor-v1"].requiredPrompt);
});

test("Codex emits complete prompts and role-specific schemas without native TOML agents", () => {
  const context = loadContext();
  const projection = createProjection("codex", context);

  for (const role of context.agentIr.roles) {
    assert.equal(
	      outputByPath(projection, `skills/maister-orchestrator-framework/agents/maister-${role.role_id}.md`).content,
      role.instruction_body,
    );
    const schema = JSON.parse(outputByPath(
      projection,
	      `skills/maister-orchestrator-framework/agent-schemas/maister-${role.role_id}.schema.json`,
    ).content);
    assert.equal(schema.properties.logical_role_id.const, role.logical_role_id);
  }
  assert.ok(projection.outputs.every(({ path: outputPath }) => !outputPath.endsWith(".toml")));
});

test("Cursor emits all exact maister native IDs including E2E with no Advisor-only metadata", () => {
  const context = loadContext();
  const projection = createProjection("cursor", context);
  const canonicalPaths = projection.outputs
    .filter(({ ownership }) => ownership === "canonical")
    .map(({ path: outputPath }) => outputPath);

  assert.deepEqual(
    canonicalPaths,
    context.agentIr.roles.map(({ role_id: roleId }) => `agents/maister-${roleId}.md`),
  );
  assert.ok(canonicalPaths.includes("agents/maister-e2e-test-verifier.md"));
  const advisor = outputByPath(projection, "agents/maister-advisor.md").content;
  assert.match(advisor, /^---\nname: maister-advisor\n/u);
  assert.equal(advisor.includes("readonly:"), false);
  assert.equal(advisor.includes("name: maister-maister-"), false);
  for (const outputPath of canonicalPaths) {
    assert.match(outputPath, /^agents\/maister-[a-z0-9-]+\.md$/u);
  }
});

test("Cursor explore destination is agents/maister-explore.md without double-prefixed name", () => {
  const projection = createProjection("cursor");
  const explore = outputByPath(projection, "agents/maister-explore.md");
  assert.equal(explore.ownership, "support");
  assert.match(explore.content, /^---\nname: maister-explore\n/u);
  assert.equal(explore.content.includes("name: maister-maister-"), false);
  assert.equal(
    projection.outputs.some(({ path: outputPath }) => outputPath === "agents/explore.md"),
    false,
  );
});

test("Pi emits one exact package-agent descriptor per canonical role", () => {
  const context = loadContext();
  const projection = createProjection("pi", context);
  const canonicalOutputs = projection.outputs.filter(({ ownership }) => ownership === "canonical");

  assert.deepEqual(
    canonicalOutputs.map(({ path: outputPath }) => outputPath),
    context.agentIr.roles.map(({ role_id: roleId }) => `agents/maister-${roleId}.md`),
  );
  for (const role of context.agentIr.roles) {
    const output = outputByPath(projection, `agents/maister-${role.role_id}.md`);
    assert.match(output.content, new RegExp(`^---\\nname: "maister:${role.role_id}"\\n`, "u"));
    assert.match(output.content, new RegExp(`\\nmaister_role_id: "${role.role_id}"\\n`, "u"));
    assert.match(output.content, /\nprojection_schema: "pi-agent-frontmatter-v1"\n/u);
    assert.match(output.content, /\ncanonical_source_sha256: "[0-9a-f]{64}"\n/u);
    assert.equal(output.content.includes("name: maister-"), false);
  }
});

test("Kiro emits descriptor/prompt pairs with 100 percent relative reference closure", () => {
  const context = loadContext();
  const projection = createProjection("kiro-cli", context);
  const outputPaths = new Set(projection.outputs.map(({ path: outputPath }) => outputPath));

  for (const role of context.agentIr.roles) {
    const descriptorPath = `agents/maister-${role.role_id}.json`;
    const promptPath = `agents/instructions/maister-${role.role_id}.md`;
    const descriptor = JSON.parse(outputByPath(projection, descriptorPath).content);
    assert.equal(descriptor.name, `maister-${role.role_id}`);
    assert.equal(descriptor.prompt, `file://./instructions/maister-${role.role_id}.md`);
    assert.ok(outputPaths.has(promptPath));
  }
});

test("support assets have explicit ownership and hashes and cannot satisfy canonical completeness", () => {
  for (const target of ["cursor", "kiro-cli"]) {
    const projection = createProjection(target);
    for (const support of projection.support_inventory) {
      assert.ok(support.output_paths.length > 0);
      assert.ok(support.output_paths.every((outputPath) => outputByPath(projection, outputPath).ownership === "support"));
      assert.ok(support.output_paths.every((outputPath) => /^[0-9a-f]{64}$/u.test(outputByPath(projection, outputPath).sha256)));
      assert.equal(projection.canonical_role_ids.includes(support.support_id.split(":").at(-1)), false);
    }
  }
});

test("missing or substituted canonical roles fail before writing staging output", () => {
  const context = loadContext();
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-projection-missing-"));
  const missingIr = structuredClone(context.agentIr);
  missingIr.roles.pop();
  expectProjectionError(
    () => projectAgents({
      agentIr: missingIr,
      manifest: context.manifest,
      target: "codex",
      stagingRoot,
      supportAssets: [],
    }),
    "E_AGENT_PROJECTION_INVENTORY",
  );
  assert.deepEqual(fs.readdirSync(stagingRoot), []);

  const substitutedManifest = structuredClone(context.manifest);
  substitutedManifest.rows.find((row) => row.target === "codex").source_sha256 = "0".repeat(64);
  expectProjectionError(
    () => projectAgents({
      agentIr: context.agentIr,
      manifest: substitutedManifest,
      target: "codex",
      stagingRoot,
      supportAssets: [],
    }),
    "E_AGENT_PROJECTION_BINDING",
  );
  assert.deepEqual(fs.readdirSync(stagingRoot), []);
});

test("undeclared transforms and unsafe destinations fail with no staging output", () => {
  const context = loadContext();
  const mutations = [
    ["E_AGENT_PROJECTION_TRANSFORM", (manifest) => { manifest.rows.find((row) => row.target === "cursor").transform_ids.push("cursor-secret-rewrite-v1"); }],
    ["E_AGENT_PROJECTION_PATH", (manifest) => { manifest.rows.find((row) => row.target === "cursor").destinations[0].path = "../outside.md"; }],
  ];
  for (const [code, mutate] of mutations) {
    const manifest = structuredClone(context.manifest);
    mutate(manifest);
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-projection-invalid-"));
    expectProjectionError(
      () => projectAgents({
        agentIr: context.agentIr,
        manifest,
        target: "cursor",
        stagingRoot,
        supportAssets: supportAssetsFor(context.manifest, "cursor"),
      }),
      code,
    );
    assert.deepEqual(fs.readdirSync(stagingRoot), []);
  }
});

test("normalized destination collisions fail before projection writes", () => {
  const context = loadContext();
  const manifest = structuredClone(context.manifest);
  const cursorRows = manifest.rows.filter((row) => row.target === "cursor");
  cursorRows[1].destinations[0].path = cursorRows[0].destinations[0].path.toLocaleUpperCase("en-US");
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-projection-collision-"));

  expectProjectionError(
    () => projectAgents({
      agentIr: context.agentIr,
      manifest,
      target: "cursor",
      stagingRoot,
      supportAssets: supportAssetsFor(context.manifest, "cursor"),
    }),
    "E_AGENT_PROJECTION_COLLISION",
  );
  assert.deepEqual(fs.readdirSync(stagingRoot), []);
});

test("unresolved Kiro prompt URIs fail projection validation", () => {
  const projection = structuredClone(createProjection("kiro-cli"));
  const descriptor = projection.outputs.find(({ path: outputPath }) => outputPath === "agents/maister-advisor.json");
  const parsed = JSON.parse(descriptor.content);
  parsed.prompt = "file://./instructions/missing-advisor.md";
  descriptor.content = `${JSON.stringify(parsed)}\n`;
  descriptor.sha256 = sha256(Buffer.from(descriptor.content));

  expectProjectionError(
    () => validateAgentProjection({ projection }),
    "E_AGENT_PROJECTION_REFERENCE",
  );
});

test("hand-edited candidate outputs fail without overwriting any staged bytes", () => {
  const context = loadContext();
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-projection-drift-"));
  const handEditedPath = path.join(stagingRoot, "agents/maister-advisor.md");
  fs.mkdirSync(path.dirname(handEditedPath), { recursive: true });
  fs.writeFileSync(handEditedPath, "hand edited\n", { mode: 0o644 });
  const before = snapshotFiles(stagingRoot);

  expectProjectionError(
    () => projectAgents({
      agentIr: context.agentIr,
      manifest: context.manifest,
      target: "cursor",
      stagingRoot,
      supportAssets: supportAssetsFor(context.manifest, "cursor"),
    }),
    "E_AGENT_PROJECTION_DRIFT",
  );
  assert.deepEqual(snapshotFiles(stagingRoot), before);
});

test("Windows accepts canonical projection bytes with non-authoritative mode bits", { skip: process.platform !== "win32" }, () => {
  const context = loadContext();
  const projection = createProjection("cursor", context);
  const output = outputByPath(projection, "agents/maister-advisor.md");
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-projection-windows-mode-"));
  const destination = path.join(stagingRoot, output.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, output.content, { mode: 0o666 });
  fs.chmodSync(destination, 0o666);

  assert.doesNotThrow(() => projectAgents({
    agentIr: context.agentIr,
    manifest: context.manifest,
    target: "cursor",
    stagingRoot,
    supportAssets: supportAssetsFor(context.manifest, "cursor"),
  }));
});

test("projection writes only beneath its isolated staging root", () => {
  const context = loadContext();
  const sourceBefore = snapshotFiles(path.join(PLUGIN_ROOT, "agents"));
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maister-projection-isolated-"));

  const result = projectAgents({
    agentIr: context.agentIr,
    manifest: context.manifest,
    target: "codex",
    stagingRoot,
    supportAssets: [],
  });

  assert.deepEqual(snapshotFiles(path.join(PLUGIN_ROOT, "agents")), sourceBefore);
  assert.equal(snapshotFiles(stagingRoot).length, result.outputs.length);
  assert.ok(result.outputs.every(({ path: outputPath }) => fs.existsSync(path.join(stagingRoot, outputPath))));
});

test("developer --check projects all targets in isolation without changing the checkout", () => {
  const checkoutBefore = snapshotFiles(path.join(PLUGIN_ROOT, "agents"));
  const command = spawnSync(
    process.execPath,
    [path.join(PLUGIN_ROOT, "bin/project-agents.mjs"), "--check", `--repository-root=${ROOT}`],
    { cwd: ROOT, encoding: "utf8" },
  );

  assert.equal(command.status, 0, command.stderr);
  const result = JSON.parse(command.stdout);
  assert.equal(result.ok, true);
  assert.deepEqual(result.targets.map(({ target }) => target), TARGETS);
  assert.deepEqual(snapshotFiles(path.join(PLUGIN_ROOT, "agents")), checkoutBefore);
});
