import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { FLOW_SKILL_IDS } from "../../plugins/maister/lib/distribution/flow-skill-projection.mjs";
import { loadOverlay } from "../../plugins/maister/lib/distribution/overlay-loader.mjs";
import { PI_ORCHESTRATION_COMMANDS } from "../../plugins/maister/skills/orchestrator-framework/bin/agent-runtime/host-adapters/pi-native.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PI_OVERLAY = path.join(ROOT, "plugins/maister/overlays/pi/overlay.yml");
const PI_INVENTORY = path.join(ROOT, "plugins/maister/overlays/pi/inventory.yml");
const FIXTURE_PI_OVERLAY = path.join(
	ROOT,
	"tests/fixtures/platform-independent/overlays/pi/overlay.yml",
);
const FIXTURE_PI_INVENTORY = path.join(
	ROOT,
	"tests/fixtures/platform-independent/overlays/pi/inventory.yml",
);
const CURSOR_PROJECTION = path.join(
	ROOT,
	"plugins/maister/overlays/cursor/skill-projection-v1.json",
);
const CODEX_INVENTORY = path.join(
	ROOT,
	"plugins/maister/overlays/codex/inventory.yml",
);
const OVERLAY_LOADER = path.join(
	ROOT,
	"plugins/maister/lib/distribution/overlay-loader.mjs",
);
const FLOW_PROJECTION_MODULE = path.join(
	ROOT,
	"plugins/maister/lib/distribution/flow-skill-projection.mjs",
);

function skillOriginSources(overlay) {
	return overlay.inventory.skill_origins.map(({ source }) => source);
}

test("registers issue in PI_SKILL_IDS and Pi skill_origins at count 36", () => {
	const loaderSource = fs.readFileSync(OVERLAY_LOADER, "utf8");
	assert.match(
		loaderSource,
		/"init",\s*"issue",\s*"linguistic-boundary-verifier"/u,
		"PI_SKILL_IDS must list issue alphabetically after init",
	);

	const { overlay } = loadOverlay({
		overlayPath: PI_OVERLAY,
		inventoryPath: PI_INVENTORY,
	});
	assert.equal(overlay.inventory.skill_origins.length, 36);
	assert.deepEqual(
		skillOriginSources(overlay).filter((source) => source === "skills/issue"),
		["skills/issue"],
	);
	const sources = skillOriginSources(overlay);
	const initIndex = sources.indexOf("skills/init");
	const issueIndex = sources.indexOf("skills/issue");
	const linguisticIndex = sources.indexOf("skills/linguistic-boundary-verifier");
	assert.ok(initIndex >= 0 && issueIndex === initIndex + 1);
	assert.ok(linguisticIndex === issueIndex + 1);
});

test("Cursor skill-projection maps issue → maister-issue", () => {
	const manifest = JSON.parse(fs.readFileSync(CURSOR_PROJECTION, "utf8"));
	const mapping = manifest.mappings.find(({ source }) => source === "issue");
	assert.ok(mapping, "skill-projection-v1.json must map source issue");
	assert.equal(mapping.target, "maister-issue");
	assert.match(mapping.source_fingerprint, /^[0-9a-f]{64}$/u);
});

test("PI_ORCHESTRATION_COMMANDS includes maister-issue slash peer", () => {
	const entry = PI_ORCHESTRATION_COMMANDS.find(
		({ name }) => name === "maister-issue",
	);
	assert.ok(entry, "PI_ORCHESTRATION_COMMANDS must include maister-issue");
	assert.equal(entry.invocation, "/skill:maister-issue");
	assert.equal(typeof entry.description, "string");
	assert.ok(entry.description.trim().length > 0);
});

test("FLOW_SKILL_IDS stays at six and Codex FLOW required skills stay six", () => {
	assert.equal(FLOW_SKILL_IDS.length, 6);
	assert.deepEqual([...FLOW_SKILL_IDS], [
		"bye",
		"dev",
		"next",
		"resume",
		"status",
		"work",
	]);
	assert.equal(FLOW_SKILL_IDS.includes("issue"), false);

	const inventory = fs.readFileSync(CODEX_INVENTORY, "utf8");
	const flowRequired = [
		"skills/maister-bye/SKILL.md",
		"skills/maister-dev/SKILL.md",
		"skills/maister-next/SKILL.md",
		"skills/maister-resume/SKILL.md",
		"skills/maister-status/SKILL.md",
		"skills/maister-work/SKILL.md",
	];
	for (const entry of flowRequired) {
		assert.match(inventory, new RegExp(`^\\s*-\\s+${entry.replaceAll("/", "\\/")}$`, "mu"));
	}
	assert.doesNotMatch(inventory, /skills\/maister-issue\/SKILL\.md/u);
});

test("does not dual-surface issue as commands/issue.md or PI command origin", () => {
	assert.equal(
		fs.existsSync(path.join(ROOT, "plugins/maister/commands/issue.md")),
		false,
	);
	const { overlay } = loadOverlay({
		overlayPath: PI_OVERLAY,
		inventoryPath: PI_INVENTORY,
	});
	assert.equal(
		overlay.inventory.command_origins.some(
			({ source }) => source === "commands/issue.md",
		),
		false,
	);
	const loaderSource = fs.readFileSync(OVERLAY_LOADER, "utf8");
	assert.doesNotMatch(
		loaderSource,
		/PI_COMMAND_IDS\s*=\s*\[[^\]]*"issue"/su,
	);
});

test("fixture and live Pi inventories keep skills/issue with matching neighbors", () => {
	const live = loadOverlay({
		overlayPath: PI_OVERLAY,
		inventoryPath: PI_INVENTORY,
	}).overlay;
	const fixture = loadOverlay({
		overlayPath: FIXTURE_PI_OVERLAY,
		inventoryPath: FIXTURE_PI_INVENTORY,
	}).overlay;

	assert.equal(live.inventory.skill_origins.length, 36);
	assert.equal(fixture.inventory.skill_origins.length, 36);

	const liveSources = skillOriginSources(live);
	const fixtureSources = skillOriginSources(fixture);
	assert.deepEqual(liveSources, fixtureSources);

	const issueIndex = liveSources.indexOf("skills/issue");
	assert.ok(issueIndex > 0);
	assert.equal(liveSources[issueIndex - 1], "skills/init");
	assert.equal(liveSources[issueIndex + 1], "skills/linguistic-boundary-verifier");
	assert.equal(fixtureSources[issueIndex], "skills/issue");
});

test("PI_ORCHESTRATION_COMMANDS maister-issue is create-only peer between init and performance", () => {
	const names = PI_ORCHESTRATION_COMMANDS.map(({ name }) => name);
	assert.equal(names.includes("maister-issue"), true);
	assert.equal(names.includes("maister-development"), true);
	assert.equal(names.includes("maister-research"), true);

	const initIndex = names.indexOf("maister-init");
	const issueIndex = names.indexOf("maister-issue");
	const performanceIndex = names.indexOf("maister-performance");
	assert.ok(initIndex >= 0 && issueIndex === initIndex + 1);
	assert.ok(performanceIndex === issueIndex + 1);

	const entry = PI_ORCHESTRATION_COMMANDS[issueIndex];
	assert.match(entry.description, /create|local|\.maister\/issues/iu);
	assert.doesNotMatch(entry.description, /\bFLOW\b|list|close|sync/iu);
});

test("FLOW projection module stays six-set and never lists issue", () => {
	assert.equal(FLOW_SKILL_IDS.length, 6);
	assert.equal(FLOW_SKILL_IDS.includes("issue"), false);
	const flowModule = fs.readFileSync(FLOW_PROJECTION_MODULE, "utf8");
	assert.match(flowModule, /export const FLOW_SKILL_IDS = Object\.freeze\(\[/u);
	assert.doesNotMatch(flowModule, /"issue"/u);
	assert.doesNotMatch(flowModule, /maister-issue/u);
});
