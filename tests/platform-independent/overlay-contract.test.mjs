import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	AgentIrValidationError,
	loadCanonicalAgentIr,
	parseAgentSources,
} from "../../plugins/maister/lib/distribution/agent-ir.mjs";
import {
	AgentManifestValidationError,
	buildAgentManifest,
	loadAgentProjectionContract,
	validateAgentProjectionContract,
} from "../../plugins/maister/lib/distribution/agent-manifest.mjs";
import {
	loadOverlay,
	parseOverlayYaml,
	validateOverlay,
} from "../../plugins/maister/lib/distribution/overlay-loader.mjs";
import { projectCursorSkills } from "../../plugins/maister/lib/distribution/cursor-skill-projector.mjs";
import { SUPPORTED_TARGET_IDS } from "../../plugins/maister/lib/distribution/targets.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FIXTURE_ROOT = path.join(
	ROOT,
	"tests/fixtures/platform-independent/overlays",
);
const CHECKED_IN_OVERLAY_ROOT = path.join(ROOT, "plugins/maister/overlays");
const AGENT_FIXTURE_ROOT = path.join(
	ROOT,
	"tests/fixtures/platform-independent/agent-ir",
);
const AGENT_PROJECTION_PATH = path.join(
	ROOT,
	"plugins/maister/agent-projection-v1.json",
);
const CANONICAL_AGENT_ROOT = path.join(ROOT, "plugins/maister/agents");
const CANONICAL_SKILL_ROOT = path.join(ROOT, "plugins/maister/skills");
const EXPECTED_ROLE_IDS = [
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
const REQUIRED_PRIMITIVES = [
	"continue_workflow",
	"delegate_agent",
	"persist_state",
	"resolve_task_root",
	"track_progress",
	"user_gate",
];
const PORTABLE_RUNTIME_MODULES = [
	"skills/orchestrator-framework/bin/gate-evaluator.mjs",
	"skills/orchestrator-framework/bin/orchestrator-state-repository.mjs",
	"skills/orchestrator-framework/bin/orchestrator-state-schema.mjs",
	"skills/orchestrator-framework/bin/phase-continue.mjs",
	"skills/orchestrator-framework/bin/workflow-continuation.mjs",
];

const REQUIRED_INVENTORY = {
	codex: [
		".codex-plugin/plugin.json",
		"skills/**/SKILL.md",
		"skills/maister-bye/SKILL.md",
		"skills/maister-dev/SKILL.md",
		"skills/maister-next/SKILL.md",
		"skills/maister-resume/SKILL.md",
		"skills/maister-status/SKILL.md",
		"skills/maister-work/SKILL.md",
		"skills/**/agents/openai.yaml",
		"hooks/hooks.json",
		"skills/maister-orchestrator-framework/bin/gate-evaluator.mjs",
	],
	cursor: [
		".cursor-plugin/plugin.json",
		"skills/maister-*/SKILL.md",
		"skills/maister-bye/SKILL.md",
		"skills/maister-dev/SKILL.md",
		"skills/maister-next/SKILL.md",
		"skills/maister-resume/SKILL.md",
		"skills/maister-status/SKILL.md",
		"skills/maister-work/SKILL.md",
		"agents/maister-*.md",
		"rules/*.mdc",
		"hooks/hooks.json",
	],
	"kiro-cli": [
		"skills/maister-**/SKILL.md",
		"skills/maister-bye/SKILL.md",
		"skills/maister-dev/SKILL.md",
		"skills/maister-next/SKILL.md",
		"skills/maister-resume/SKILL.md",
		"skills/maister-status/SKILL.md",
		"skills/maister-work/SKILL.md",
		"agents/maister*.json",
		"agents/instructions/maister-*.md",
		"steering/maister-*.md",
		"hooks/maister-*.sh",
		"maister-agent-tools.json",
	],
	pi: [
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
	],
};
const LEGACY_PROJECTION_TARGET_IDS = ["codex", "cursor", "kiro-cli"];

function fixturePaths(target) {
	const fixtureRoot = path.join(FIXTURE_ROOT, target);
	return {
		overlayPath: path.join(fixtureRoot, "overlay.yml"),
		inventoryPath: path.join(fixtureRoot, "inventory.yml"),
	};
}

function checkedInOverlayPaths(target) {
	const overlayRoot = path.join(CHECKED_IN_OVERLAY_ROOT, target);
	return {
		overlayPath: path.join(overlayRoot, "overlay.yml"),
		inventoryPath: path.join(overlayRoot, "inventory.yml"),
	};
}

function readFixture(target) {
	const { overlayPath } = fixturePaths(target);
	return parseOverlayYaml(fs.readFileSync(overlayPath, "utf8"), overlayPath);
}

function expectOverlayError(action, code) {
	assert.throws(action, (error) => {
		assert.equal(error.code, code);
		assert.match(error.message, new RegExp(code));
		assert.equal(error.retryable, false);
		return true;
	});
}

function expectTypedError(action, ErrorType, code) {
	assert.throws(action, (error) => {
		assert.ok(error instanceof ErrorType);
		assert.equal(error.code, code);
		assert.equal(error.retryable, false);
		assert.match(error.message, new RegExp(`\\[${code}\\]`, "u"));
		return true;
	});
}

function readAgentFixture(relativePath) {
	const sourcePath = path.join(AGENT_FIXTURE_ROOT, relativePath);
	return {
		path: `agents/${path.basename(relativePath)}`,
		source: fs.readFileSync(sourcePath, "utf8"),
	};
}

function readProjectionContract() {
	return JSON.parse(fs.readFileSync(AGENT_PROJECTION_PATH, "utf8"));
}

function loadRealAgentIr() {
	return loadCanonicalAgentIr({
		agentsRoot: CANONICAL_AGENT_ROOT,
		skillsRoot: CANONICAL_SKILL_ROOT,
		expectedRoleIds: EXPECTED_ROLE_IDS,
	});
}

test("accepts valid registered target fixtures with required inventories", () => {
	for (const target of SUPPORTED_TARGET_IDS) {
		const loaded = loadOverlay(fixturePaths(target));
		const checkedIn = loadOverlay(checkedInOverlayPaths(target));

		assert.equal(loaded.overlay.schema_version, 1);
		assert.equal(loaded.overlay.target.id, target);
		assert.deepEqual(loaded.inventory.required, REQUIRED_INVENTORY[target]);
		if (target === "codex") assert.deepEqual(loaded.overlay.settings, []);
		else assert.ok(loaded.overlay.settings.length > 0);
		assert.deepEqual(
			Object.keys(loaded.overlay.semantic_bindings).sort(),
			REQUIRED_PRIMITIVES,
		);
		assert.deepEqual(
			checkedIn.overlay.agent_projection,
			loaded.overlay.agent_projection,
		);
	}
});

test("accepts the closed Pi target, ownership, compatibility, probes, bindings, and inventories", () => {
	const { overlay, inventory } = loadOverlay(fixturePaths("pi"));

	assert.deepEqual(overlay.target, {
		id: "pi",
		adapter_id: "pi.native",
		projection: "pi.native",
		host_version_constraint: ">=0.80.10 <0.82.0",
		platform: "posix",
		discovery_roots: [".pi/agent/maister"],
		path_policy: {
			agent_root_env: "PI_CODING_AGENT_DIR",
			default_agent_root: "$HOME/.pi/agent",
			settings_path: "settings.json",
			session_root_env: "PI_CODING_AGENT_SESSION_DIR",
			package_root_env: "PI_PACKAGE_DIR",
			package_path: "maister",
			containment: "agent_root",
		},
	});
	assert.deepEqual(overlay.compatibility, {
		pi: "0.80.10",
		node: "25.9.0",
		pi_subagents: "0.35.1",
		delegation_protocol: 1,
	});
	assert.deepEqual(overlay.probes, {
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
	});
	assert.equal(overlay.layout[0].ownership, "plugin_private");
	assert.equal(overlay.settings.length, 1);
	assert.deepEqual(overlay.settings[0], {
		path: "settings.json",
		format: "json",
		ownership: "managed_array_entries",
		managed_keys: [],
		array_path: "packages",
		identity: "pi_local_package_v1",
		entries: [{ source: "./maister" }],
		merge_policy: "preserve_unmanaged_refuse_drift",
	});
	assert.deepEqual(
		Object.keys(overlay.semantic_bindings).sort(),
		REQUIRED_PRIMITIVES,
	);
	assert.equal(overlay.semantic_bindings.delegate_agent.adapter, "pi.native");
	assert.equal(
		overlay.semantic_bindings.track_progress.adapter,
		"execution-event-writer",
	);
	assert.equal(overlay.inventory.command_origins.length, 14);
	assert.equal(overlay.inventory.skill_origins.length, 36);
	assert.equal(overlay.inventory.role_origins.length, 28);
	assert.deepEqual(overlay.inventory.support_inventory, []);
	assert.ok(overlay.validation.forbidden_topology.includes("commands/**"));
	assert.ok(overlay.validation.forbidden_topology.includes("pi-subagents/**"));
	assert.deepEqual(inventory.agent_projection, overlay.agent_projection);
});

test("rejects Pi unknown fields, unsafe paths, duplicate destinations, incomplete roles, missing bindings, and bundled pi-subagents", () => {
	const mutations = [
		(overlay) => {
			overlay.probes.unexpected = true;
		},
		(overlay) => {
			overlay.layout[0].destination = "../outside";
		},
		(overlay) => {
			overlay.inventory.command_origins.push({
				...overlay.inventory.command_origins[0],
			});
		},
		(overlay) => {
			overlay.inventory.role_origins.pop();
		},
		(overlay) => {
			delete overlay.semantic_bindings.continue_workflow;
		},
		(overlay) => {
			overlay.inventory.required.push("pi-subagents/**");
		},
	];
	for (const mutate of mutations) {
		const overlay = readFixture("pi");
		mutate(overlay);
		expectOverlayError(
			() => validateOverlay(overlay),
			"E_OVERLAY_" +
				(mutations.indexOf(mutate) === 1
					? "PATH"
					: mutations.indexOf(mutate) === 2
						? "COLLISION"
						: mutations.indexOf(mutate) === 3
							? "INVENTORY"
							: mutations.indexOf(mutate) === 4
								? "BINDINGS"
								: mutations.indexOf(mutate) === 5
									? "COLLISION"
									: "SCHEMA"),
		);
	}
});

test("keeps the checked-in Cursor skill projection equivalent and detects isolated drift", async () => {
	const repositoryRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "maister-cursor-projection-"),
	);
	for (const relative of [
		"plugins/maister/commands",
		"plugins/maister/skills",
		"plugins/maister/overlays/cursor/assets/skills",
		"plugins/maister/overlays/cursor/skill-projection-v1.json",
	]) {
		const destination = path.join(repositoryRoot, relative);
		fs.mkdirSync(path.dirname(destination), { recursive: true });
		fs.cpSync(path.join(ROOT, relative), destination, { recursive: true });
	}

	const equivalent = await projectCursorSkills({ repositoryRoot, check: true });
	assert.equal(equivalent.changed, 0);
	assert.ok(equivalent.files > 0);

	fs.appendFileSync(
		path.join(
			repositoryRoot,
			"plugins/maister/overlays/cursor/assets/skills/maister-development/SKILL.md",
		),
		"\nprojection drift\n",
	);
	await assert.rejects(
		projectCursorSkills({ repositoryRoot, check: true }),
		/Cursor skill projection is stale/u,
	);
});

test("keeps the six portable primitives bound to the five single-source runtime modules", () => {
	const primitivesPath = path.join(
		ROOT,
		"plugins/maister/common/primitives.yml",
	);
	const manifest = parseOverlayYaml(
		fs.readFileSync(primitivesPath, "utf8"),
		primitivesPath,
	);

	assert.equal(manifest.schema_version, 1);
	assert.deepEqual(
		manifest.primitives.map(({ id }) => id).sort(),
		REQUIRED_PRIMITIVES,
	);
	assert.deepEqual(manifest.runtime_modules, PORTABLE_RUNTIME_MODULES);
	assert.ok(
		manifest.primitives.every(
			({ fail_closed, module, operation }) =>
				fail_closed === true &&
				PORTABLE_RUNTIME_MODULES.includes(module) &&
				typeof operation === "string" &&
				operation.length > 0,
		),
	);
	for (const module of PORTABLE_RUNTIME_MODULES) {
		assert.equal(
			fs.existsSync(path.join(ROOT, "plugins/maister", module)),
			true,
			module,
		);
	}
});

test("rejects unknown overlay fields", () => {
	const overlay = readFixture("codex");
	overlay.unexpected_field = true;

	expectOverlayError(() => validateOverlay(overlay), "E_OVERLAY_SCHEMA");
});

test("rejects overlays with missing semantic bindings", () => {
	const overlay = readFixture("cursor");
	delete overlay.semantic_bindings.continue_workflow;

	expectOverlayError(() => validateOverlay(overlay), "E_OVERLAY_BINDINGS");
});

test("rejects incomplete, extra, or non-fail-closed semantic binding fields", () => {
	const mutations = [
		(overlay) => {
			overlay.semantic_bindings.user_gate.fail_closed = false;
		},
		(overlay) => {
			delete overlay.semantic_bindings.delegate_agent.adapter;
		},
		(overlay) => {
			overlay.semantic_bindings.persist_state.unreviewed = true;
		},
		(overlay) => {
			overlay.semantic_bindings.unreviewed_primitive = {
				adapter: "x",
				capability: "semantic",
				fail_closed: true,
			};
		},
	];
	for (const mutate of mutations) {
		const overlay = readFixture("codex");
		mutate(overlay);
		expectOverlayError(() => validateOverlay(overlay), "E_OVERLAY_BINDINGS");
	}
});

test("rejects invalid ownership combinations", () => {
	const overlay = readFixture("kiro-cli");
	overlay.settings[0].ownership = "whole_file";
	overlay.settings[0].managed_keys = ["chat.defaultAgent"];

	expectOverlayError(() => validateOverlay(overlay), "E_OVERLAY_OWNERSHIP");
});

test("rejects absolute and traversing destinations", () => {
	for (const destination of [
		"/outside",
		"../outside",
		"nested/../../outside",
	]) {
		const overlay = readFixture("codex");
		overlay.layout[0].destination = destination;

		expectOverlayError(() => validateOverlay(overlay), "E_OVERLAY_PATH");
	}
});

test("rejects normalized inventory collisions and foreign-host or Claude vocabulary", () => {
	const collision = readFixture("cursor");
	collision.inventory.required.push("SKILLS/MAISTER-*/SKILL.md");
	expectOverlayError(() => validateOverlay(collision), "E_OVERLAY_COLLISION");

	const foreignHost = readFixture("codex");
	foreignHost.native_assets[0].source = "assets/claude/plugin.json";
	expectOverlayError(
		() => validateOverlay(foreignHost),
		"E_OVERLAY_VOCABULARY",
	);
});

test("parses the exact real 28-role inventory into immutable sorted Agent IR", () => {
	const ir = loadRealAgentIr();

	assert.equal(ir.schema_version, 1);
	assert.deepEqual(
		ir.roles.map(({ role_id }) => role_id),
		EXPECTED_ROLE_IDS,
	);
	assert.match(ir.canonical_set_digest, /^[0-9a-f]{64}$/u);
	assert.ok(Object.isFrozen(ir));
	assert.ok(Object.isFrozen(ir.roles));
	assert.ok(
		ir.roles.every(
			(role) =>
				Object.isFrozen(role) && Object.isFrozen(role.skill_dependencies),
		),
	);
	assert.ok(
		ir.roles.every((role) => role.source_path === `agents/${role.role_id}.md`),
	);
	assert.ok(
		ir.roles.every(
			(role) => role.logical_role_id === `maister:${role.role_id}`,
		),
	);
	assert.ok(ir.roles.every((role) => role.instruction_body.trim().length > 0));
	assert.deepEqual(
		ir.roles.find(({ role_id }) => role_id === "docs-operator")
			.skill_dependencies,
		["docs-manager"],
	);
});

test("produces the same Agent IR and canonical-set digest on independent reads", () => {
	const first = loadRealAgentIr();
	const second = loadRealAgentIr();

	assert.deepEqual(second, first);
	assert.equal(second.canonical_set_digest, first.canonical_set_digest);
});

test("preserves complete instruction bodies and source-order skill dependencies", () => {
	const result = parseAgentSources({
		sources: [readAgentFixture("valid/reviewer.md")],
		skillsRoot: path.join(AGENT_FIXTURE_ROOT, "valid/skills"),
		expectedRoleIds: ["reviewer"],
	});
	const [role] = result.roles;

	assert.deepEqual(role.skill_dependencies, ["alpha", "beta"]);
	assert.equal(role.model_profile_id, "inherit");
	assert.equal(role.color, "blue");
	assert.equal(
		role.instruction_body,
		"# Reviewer\n\nKeep every instruction byte.\n",
	);
});

test("rejects mismatched identity, unknown metadata, and missing behavior bodies with typed errors", () => {
	const cases = [
		["invalid/mismatched-name.md", "E_AGENT_IR_IDENTITY"],
		["invalid/unknown-field.md", "E_AGENT_IR_FRONTMATTER"],
		["invalid/missing-body.md", "E_AGENT_IR_BODY"],
	];
	for (const [fixture, code] of cases) {
		expectTypedError(
			() =>
				parseAgentSources({
					sources: [readAgentFixture(fixture)],
					skillsRoot: path.join(AGENT_FIXTURE_ROOT, "valid/skills"),
					expectedRoleIds: [path.basename(fixture, ".md")],
				}),
			AgentIrValidationError,
			code,
		);
	}
});

test("rejects YAML aliases, tags, and non-string metadata scalars", () => {
	const cases = [
		"invalid/yaml-alias.md",
		"invalid/yaml-tag.md",
		"invalid/scalar-description.md",
	];
	for (const fixture of cases) {
		expectTypedError(
			() =>
				parseAgentSources({
					sources: [readAgentFixture(fixture)],
					skillsRoot: path.join(AGENT_FIXTURE_ROOT, "valid/skills"),
					expectedRoleIds: [path.basename(fixture, ".md")],
				}),
			AgentIrValidationError,
			"E_AGENT_IR_FRONTMATTER",
		);
	}
});

test("rejects duplicate, case-folded, and normalized source identity collisions", () => {
	const canonical = readAgentFixture("valid/reviewer.md").source;
	const collisions = [
		[
			{ path: "agents/reviewer.md", source: canonical },
			{ path: "agents/reviewer.md", source: canonical },
		],
		[
			{ path: "agents/reviewer.md", source: canonical },
			{
				path: "agents/Reviewer.md",
				source: canonical.replace("name: reviewer", "name: Reviewer"),
			},
		],
		[
			{
				path: "agents/cafe\u0301.md",
				source: canonical.replace("name: reviewer", "name: cafe\u0301"),
			},
			{
				path: "agents/caf\u00e9.md",
				source: canonical.replace("name: reviewer", "name: caf\u00e9"),
			},
		],
	];
	for (const sources of collisions) {
		expectTypedError(
			() =>
				parseAgentSources({
					sources,
					skillsRoot: path.join(AGENT_FIXTURE_ROOT, "valid/skills"),
				}),
			AgentIrValidationError,
			"E_AGENT_IR_COLLISION",
		);
	}
});

test("rejects unsafe, missing, and duplicate skill dependencies", () => {
	const valid = readAgentFixture("valid/reviewer.md").source;
	const cases = [
		valid.replace("  - alpha", "  - ../alpha"),
		valid.replace("  - alpha", "  - missing"),
		valid.replace("  - beta", "  - alpha"),
	];
	for (const source of cases) {
		expectTypedError(
			() =>
				parseAgentSources({
					sources: [{ path: "agents/reviewer.md", source }],
					skillsRoot: path.join(AGENT_FIXTURE_ROOT, "valid/skills"),
					expectedRoleIds: ["reviewer"],
				}),
			AgentIrValidationError,
			"E_AGENT_IR_DEPENDENCY",
		);
	}
});

test("rejects unsafe canonical source paths and incomplete expected inventories", () => {
	const source = readAgentFixture("valid/reviewer.md").source;
	expectTypedError(
		() =>
			parseAgentSources({
				sources: [{ path: "agents/../reviewer.md", source }],
				skillsRoot: path.join(AGENT_FIXTURE_ROOT, "valid/skills"),
			}),
		AgentIrValidationError,
		"E_AGENT_IR_PATH",
	);
	expectTypedError(
		() =>
			parseAgentSources({
				sources: [{ path: "agents/reviewer.md", source }],
				skillsRoot: path.join(AGENT_FIXTURE_ROOT, "valid/skills"),
				expectedRoleIds: ["reviewer", "missing-role"],
			}),
		AgentIrValidationError,
		"E_AGENT_IR_INVENTORY",
	);
});

test("loads a closed versioned projection contract with exact canonical and support inventories", () => {
	const contract = loadAgentProjectionContract({
		projectionPath: AGENT_PROJECTION_PATH,
	});

	assert.equal(contract.schema_version, 1);
	assert.equal(contract.projector_version, "1.0.0");
	assert.deepEqual(
		contract.roles.map(({ role_id }) => role_id),
		EXPECTED_ROLE_IDS,
	);
	assert.deepEqual(
		contract.support_inventory.map(({ support_id }) => support_id),
		["cursor:explore", "kiro-cli:explore", "kiro-cli:maister"],
	);
	assert.ok(Object.isFrozen(contract));
});

test("rejects unknown projection fields, unsupported profile IDs, and incomplete role coverage", () => {
	const mutations = [
		[
			(contract) => {
				contract.unexpected = true;
			},
			"E_AGENT_MANIFEST_SCHEMA",
		],
		[
			(contract) => {
				contract.roles[1].execution_profiles.codex = "codex.unknown";
			},
			"E_AGENT_MANIFEST_PROFILE",
		],
		[
			(contract) => {
				contract.roles.pop();
			},
			"E_AGENT_MANIFEST_INVENTORY",
		],
	];
	for (const [mutate, code] of mutations) {
		const contract = readProjectionContract();
		mutate(contract);
		expectTypedError(
			() => validateAgentProjectionContract(contract),
			AgentManifestValidationError,
			code,
		);
	}
});

test("builds a deterministic sorted manifest with exact target identities and profile bindings", () => {
	const ir = loadRealAgentIr();
	const contract = loadAgentProjectionContract({
		projectionPath: AGENT_PROJECTION_PATH,
	});
	const overlays = Object.fromEntries(
		LEGACY_PROJECTION_TARGET_IDS.map((target) => [
			target,
			loadOverlay(fixturePaths(target)).overlay,
		]),
	);
	const first = buildAgentManifest({
		agentIr: ir,
		projectionContract: contract,
		overlays,
	});
	const second = buildAgentManifest({
		agentIr: ir,
		projectionContract: contract,
		overlays,
	});

	assert.deepEqual(second, first);
	assert.equal(
		first.rows.length,
		EXPECTED_ROLE_IDS.length * LEGACY_PROJECTION_TARGET_IDS.length,
	);
	assert.match(first.manifest_digest, /^[0-9a-f]{64}$/u);
	assert.equal(first.canonical_set_digest, ir.canonical_set_digest);
	assert.deepEqual(
		first.support_inventory.map(({ support_id }) => support_id),
		["cursor:explore", "kiro-cli:explore", "kiro-cli:maister"],
	);
	assert.deepEqual(
		first.rows,
		[...first.rows].sort(
			(left, right) =>
				left.logical_role_id.localeCompare(right.logical_role_id, "en-US") ||
				left.target.localeCompare(right.target, "en-US"),
		),
	);
	for (const roleId of EXPECTED_ROLE_IDS) {
		const rows = first.rows.filter(({ role_id }) => role_id === roleId);
		assert.equal(rows.length, 3);
		assert.equal(
			rows.find(({ target }) => target === "codex").adapter_id,
			"codex.exec",
		);
		assert.equal(
			rows.find(({ target }) => target === "codex").native_role_external_id,
			null,
		);
		for (const target of ["cursor", "kiro-cli"]) {
			assert.equal(
				rows.find((row) => row.target === target).native_role_external_id,
				`maister-${roleId}`,
			);
		}
		assert.ok(rows.every((row) => row.logical_role_id === `maister:${roleId}`));
		assert.ok(
			rows.every(
				(row) =>
					row.source_sha256 ===
					ir.roles.find((role) => role.role_id === roleId).source_sha256,
			),
		);
		assert.ok(
			rows.every((row) => typeof row.execution_profile_id === "string"),
		);
		assert.ok(rows.every((row) => Object.isFrozen(row.execution_policy)));
	}
	for (const target of LEGACY_PROJECTION_TARGET_IDS) {
		const executionProfileFor = (roleId) =>
			first.rows.find((row) => row.role_id === roleId && row.target === target)
				.execution_profile_id;
		assert.equal(
			executionProfileFor("advisor"),
			executionProfileFor("bottleneck-analyzer"),
		);
	}
});

test("returns no manifest when IR, target, or profile validation fails", () => {
	const ir = loadRealAgentIr();
	const contract = readProjectionContract();
	const overlays = Object.fromEntries(
		LEGACY_PROJECTION_TARGET_IDS.map((target) => [
			target,
			loadOverlay(fixturePaths(target)).overlay,
		]),
	);
	contract.roles[0].execution_profiles.codex = "codex.missing";
	let manifest;

	expectTypedError(
		() => {
			manifest = buildAgentManifest({
				agentIr: ir,
				projectionContract: contract,
				overlays,
			});
		},
		AgentManifestValidationError,
		"E_AGENT_MANIFEST_PROFILE",
	);
	assert.equal(manifest, undefined);
});

test("validates complete target projection tables and keeps support inventory separate", () => {
	for (const target of SUPPORTED_TARGET_IDS) {
		const { overlay } = loadOverlay(fixturePaths(target));
		assert.deepEqual(
			overlay.agent_projection.canonical_roles,
			EXPECTED_ROLE_IDS,
		);
		assert.ok(overlay.agent_projection.execution_profile_ids.length > 0);
		assert.ok(overlay.agent_projection.destinations.length > 0);
		assert.ok(
			overlay.agent_projection.support_inventory.every(
				({ support_id }) =>
					!overlay.agent_projection.canonical_roles.includes(support_id),
			),
		);
	}
	assert.deepEqual(readFixture("codex").agent_projection.support_inventory, []);
	assert.deepEqual(
		readFixture("cursor").agent_projection.support_inventory.map(
			({ support_id }) => support_id,
		),
		["explore"],
	);
	assert.deepEqual(
		readFixture("kiro-cli").agent_projection.support_inventory.map(
			({ support_id }) => support_id,
		),
		["explore", "maister"],
	);
});

test("rejects incomplete canonical coverage and unsafe projection or support destinations", () => {
	const incomplete = readFixture("cursor");
	incomplete.agent_projection.canonical_roles.pop();
	expectOverlayError(() => validateOverlay(incomplete), "E_OVERLAY_INVENTORY");

	const unsafeProjection = readFixture("codex");
	unsafeProjection.agent_projection.destinations[0].path_template =
		"../agents/{role_id}.md";
	expectOverlayError(() => validateOverlay(unsafeProjection), "E_OVERLAY_PATH");

	const unsafeSupport = readFixture("kiro-cli");
	unsafeSupport.agent_projection.support_inventory[0].assets[0].destination =
		"../agents/explore.json";
	expectOverlayError(() => validateOverlay(unsafeSupport), "E_OVERLAY_PATH");
});

test("rejects duplicate execution profiles and target-to-adapter identity mismatches", () => {
	const duplicate = readFixture("codex");
	duplicate.agent_projection.execution_profile_ids.push(
		duplicate.agent_projection.execution_profile_ids[0],
	);
	expectOverlayError(() => validateOverlay(duplicate), "E_OVERLAY_COLLISION");

	const mismatch = readFixture("cursor");
	mismatch.agent_projection.adapter_id = "kiro-cli.native";
	expectOverlayError(() => validateOverlay(mismatch), "E_OVERLAY_TARGET");
});

test("rejects unsupported overlay profile references during manifest construction", () => {
	const ir = loadRealAgentIr();
	const contract = loadAgentProjectionContract({
		projectionPath: AGENT_PROJECTION_PATH,
	});
	const overlays = Object.fromEntries(
		LEGACY_PROJECTION_TARGET_IDS.map((target) => [
			target,
			loadOverlay(fixturePaths(target)).overlay,
		]),
	);
	overlays.codex.agent_projection.execution_profile_ids[0] = "codex.unknown";

	expectTypedError(
		() =>
			buildAgentManifest({
				agentIr: ir,
				projectionContract: contract,
				overlays,
			}),
		AgentManifestValidationError,
		"E_AGENT_MANIFEST_PROFILE",
	);
});

test("rejects every prohibited Advisor-only projection or execution exception", () => {
	const mutations = [
		(contract) => {
			contract.roles[0].readonly = true;
		},
		(contract) => {
			contract.roles[0].sandbox = "read-only";
		},
		(contract) => {
			contract.roles[0].destination = "agents/advisor.md";
		},
		(contract) => {
			contract.roles[0].permissions_profile_id = "advisor-only";
		},
		(contract) => {
			contract.roles[0].model_profile_id = "advisor-only";
		},
		(contract) => {
			contract.roles[0].adapter_id = "advisor.special";
		},
		(contract) => {
			contract.roles[0].evidence_bypass = true;
		},
		(contract) => {
			contract.roles[0].lifecycle = "legacy";
		},
		(contract) => {
			contract.support_inventory.push({
				support_id: "codex:advisor",
				target: "codex",
				source: "advisor.toml",
				destination: ".codex/agents/advisor.toml",
				mode: "0644",
			});
		},
	];
	for (const mutate of mutations) {
		const contract = readProjectionContract();
		mutate(contract);
		expectTypedError(
			() => validateAgentProjectionContract(contract),
			AgentManifestValidationError,
			"E_AGENT_MANIFEST_ADVISOR",
		);
	}
});

test("requires pinned Codex model and reasoning profiles while allowing no role-name conditionals", () => {
	const contract = loadAgentProjectionContract({
		projectionPath: AGENT_PROJECTION_PATH,
	});
	const codexProfiles = contract.profiles.execution.filter(
		({ target }) => target === "codex",
	);

	assert.ok(codexProfiles.length > 0);
	for (const profile of codexProfiles) {
		const model = contract.profiles.model.find(
			({ id }) => id === profile.model_profile_id,
		);
		const reasoning = contract.profiles.reasoning.find(
			({ id }) => id === profile.reasoning_profile_id,
		);
		assert.equal(model.allow_inherit, false);
		assert.equal(typeof model.model, "string");
		assert.ok(model.model.length > 0);
		assert.equal(reasoning.allow_inherit, false);
		assert.equal(typeof reasoning.effort, "string");
	}
	assert.equal(JSON.stringify(contract).includes("role_name_condition"), false);
});

test("keeps checked-in Cursor and Kiro agent assets limited to explicit support inputs", () => {
	const cursorAgentAssets = path.join(
		CHECKED_IN_OVERLAY_ROOT,
		"cursor/assets/agents",
	);
	const kiroAgentAssets = path.join(
		CHECKED_IN_OVERLAY_ROOT,
		"kiro-cli/assets/agents",
	);
	const cursorSupportAssets = path.join(
		CHECKED_IN_OVERLAY_ROOT,
		"cursor/assets/support-agents",
	);
	const kiroSupportAssets = path.join(
		CHECKED_IN_OVERLAY_ROOT,
		"kiro-cli/assets/support-agents",
	);

	const filesBelow = (root) =>
		fs.existsSync(root)
			? fs
					.readdirSync(root, { recursive: true })
					.filter((entry) => fs.statSync(path.join(root, entry)).isFile())
			: [];
	assert.deepEqual(filesBelow(cursorAgentAssets), []);
	assert.deepEqual(filesBelow(kiroAgentAssets), []);
	assert.deepEqual(
		fs
			.readdirSync(cursorSupportAssets, { recursive: true })
			.filter((entry) =>
				fs.statSync(path.join(cursorSupportAssets, entry)).isFile(),
			)
			.sort(),
		["explore.md"],
	);
	assert.deepEqual(
		fs
			.readdirSync(kiroSupportAssets, { recursive: true })
			.filter((entry) =>
				fs.statSync(path.join(kiroSupportAssets, entry)).isFile(),
			)
			.sort(),
		[
			"instructions/maister-explore.md",
			"instructions/maister.md",
			"maister-explore.json",
			"maister.json",
		],
	);
});

test("Cursor ownership globs require agents/maister-*.md and hooks/maister-*.sh", () => {
	for (const source of [
		readFixture("cursor"),
		loadOverlay(checkedInOverlayPaths("cursor")).overlay,
	]) {
		assert.ok(source.inventory.required.includes("agents/maister-*.md"));
		assert.equal(source.inventory.required.includes("agents/*.md"), false);
		assert.ok(source.inventory.optional.includes("hooks/maister-*.sh"));
		assert.equal(source.inventory.optional.includes("hooks/*.sh"), false);
		assert.deepEqual(source.validation.executable_paths, [
			"hooks/maister-*.sh",
		]);
	}
	const fixtureInventory = loadOverlay(fixturePaths("cursor")).inventory;
	const checkedInInventory = loadOverlay(
		checkedInOverlayPaths("cursor"),
	).inventory;
	assert.ok(fixtureInventory.required.includes("agents/maister-*.md"));
	assert.ok(fixtureInventory.optional.includes("hooks/maister-*.sh"));
	assert.ok(checkedInInventory.required.includes("agents/maister-*.md"));
	assert.ok(checkedInInventory.optional.includes("hooks/maister-*.sh"));
});

test("Cursor path_template and explore destination use maister-prefixed agent leaves", () => {
	for (const source of [
		readFixture("cursor"),
		loadOverlay(checkedInOverlayPaths("cursor")).overlay,
	]) {
		assert.equal(
			source.agent_projection.destinations[0].path_template,
			"agents/maister-{role_id}.md",
		);
		assert.equal(
			source.agent_projection.support_inventory[0].assets[0].destination,
			"agents/maister-explore.md",
		);
	}
});

test("Cursor hooks.json commands and hook assets use maister-*.sh basenames only", () => {
	const hooksRoot = path.join(CHECKED_IN_OVERLAY_ROOT, "cursor/assets/hooks");
	const hooksJson = JSON.parse(
		fs.readFileSync(path.join(hooksRoot, "hooks.json"), "utf8"),
	);
	const commands = Object.values(hooksJson.hooks)
		.flat()
		.map(({ command }) => command);
	assert.ok(commands.length > 0);
	for (const command of commands) {
		assert.match(
			command,
			/\$\{CURSOR_PLUGIN_ROOT\}\/hooks\/maister-[a-z0-9-]+\.sh$/u,
		);
		assert.equal(command.includes("maister-maister-"), false);
	}

	const hookScripts = fs
		.readdirSync(hooksRoot)
		.filter((name) => name.endsWith(".sh"))
		.sort();
	assert.equal(hookScripts.length, 8);
	for (const name of hookScripts) {
		assert.match(name, /^maister-[a-z0-9-]+\.sh$/u);
		assert.equal(name.startsWith("maister-maister-"), false);
	}
	assert.deepEqual(hookScripts, [
		"maister-block-destructive-commands.sh",
		"maister-block-risky-subagents.sh",
		"maister-post-compact-reminder.sh",
		"maister-session-end-hook-state-cleanup.sh",
		"maister-skill-invocation-reminder.sh",
		"maister-stop-state-reminder.sh",
		"maister-subagent-start-tracker.sh",
		"maister-subagent-stop-cleanup.sh",
	]);
});

test("FR-8: Cursor skills and rules remain maister-prefixed without this-task renames", () => {
	const skillsRoot = path.join(CHECKED_IN_OVERLAY_ROOT, "cursor/assets/skills");
	const skillDirs = fs.readdirSync(skillsRoot).filter((name) => {
		return fs.statSync(path.join(skillsRoot, name)).isDirectory();
	});
	assert.ok(skillDirs.length > 0);
	for (const name of skillDirs) {
		assert.match(name, /^maister-[a-z0-9-]+$/u);
		assert.equal(name.startsWith("maister-maister-"), false);
	}

	const rulesRoot = path.join(CHECKED_IN_OVERLAY_ROOT, "cursor/assets/rules");
	const rules = fs
		.readdirSync(rulesRoot)
		.filter((name) => name.endsWith(".mdc"));
	assert.ok(rules.length > 0);
	for (const name of rules) {
		assert.match(name, /^maister-[a-z0-9-]+\.mdc$/u);
	}

	// Cursor packages slash commands as skills; there is no separate commands asset tree.
	assert.equal(
		fs.existsSync(path.join(CHECKED_IN_OVERLAY_ROOT, "cursor/assets/commands")),
		false,
	);
});

test("FR-8: Pi and Kiro production path templates stay prefixed templates (untouched by Cursor rename)", () => {
	const pi = loadOverlay(checkedInOverlayPaths("pi")).overlay;
	assert.equal(
		pi.agent_projection.destinations[0].path_template,
		"agents/maister-{role_id}.md",
	);
	assert.ok(pi.inventory.required.includes("agents/maister-*.md"));

	const kiro = loadOverlay(checkedInOverlayPaths("kiro-cli")).overlay;
	assert.equal(
		kiro.agent_projection.destinations[0].path_template,
		"agents/maister-{role_id}.json",
	);
	assert.ok(kiro.inventory.required.includes("agents/maister*.json"));
	assert.ok(kiro.validation.executable_paths.includes("hooks/maister-*.sh"));
});

test("Cursor parity baseline agent evidence uses maister-prefixed leaves (M2)", () => {
	const baseline = JSON.parse(
		fs.readFileSync(
			path.join(CHECKED_IN_OVERLAY_ROOT, "cursor/parity-baseline.json"),
			"utf8",
		),
	);
	assert.equal(baseline.target, "cursor");

	const inventory = baseline.rules.find(
		(rule) => rule.id === "cursor-prefixed-agent-leaf-inventory",
	);
	assert.ok(inventory);
	assert.ok(inventory.paths.length > 0);
	for (const entryPath of inventory.paths) {
		assert.match(entryPath, /^agents\/maister-[a-z0-9-]+\.md$/u);
		assert.equal(entryPath.includes("maister-maister-"), false);
	}
	assert.ok(inventory.paths.includes("agents/maister-explore.md"));
	assert.ok(inventory.paths.includes("agents/maister-advisor.md"));

	const deletions = baseline.rules.find(
		(rule) => rule.id === "cursor-short-agent-leaf-deletions",
	);
	assert.ok(deletions);
	assert.ok(deletions.paths.includes("agents/advisor.md"));
	assert.ok(deletions.paths.includes("agents/explore.md"));
	assert.equal(
		deletions.paths.some((entryPath) =>
			entryPath.startsWith("agents/maister-"),
		),
		false,
	);

	const semantic = baseline.rules.find(
		(rule) => rule.id === "cursor-common-source-semantic-migration",
	);
	assert.ok(semantic);
	assert.equal(
		semantic.paths.some((entryPath) => entryPath.startsWith("agents/")),
		false,
	);
});
