import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseCanonicalYaml } from "../../plugins/maister/skills/orchestrator-framework/bin/orchestrator-state-schema.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PROJECTED_SKILL = path.join(
	ROOT,
	"plugins/maister/overlays/cursor/assets/skills/maister-issue/SKILL.md",
);
const CANONICAL_SKILL = path.join(ROOT, "plugins/maister/skills/issue/SKILL.md");
const CURSOR_PROJECTION = path.join(
	ROOT,
	"plugins/maister/overlays/cursor/skill-projection-v1.json",
);
const GENERATOR = path.join(
	ROOT,
	"plugins/maister/bin/generate-cursor-skills.mjs",
);

function readProjectedFrontmatter() {
	assert.equal(
		fs.existsSync(PROJECTED_SKILL),
		true,
		`projected Cursor skill missing at ${PROJECTED_SKILL}`,
	);
	const text = fs.readFileSync(PROJECTED_SKILL, "utf8");
	const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
	assert.ok(match, "projected maister-issue skill must have YAML frontmatter");
	return parseCanonicalYaml(match[1]);
}

test("projected Cursor maister-issue SKILL.md exists after generate", () => {
	assert.equal(fs.existsSync(PROJECTED_SKILL), true);
});

test("projected Cursor maister-issue frontmatter name is maister-issue", () => {
	const frontmatter = readProjectedFrontmatter();
	assert.equal(frontmatter.name, "maister-issue");
});

test("generate-cursor-skills.mjs --check succeeds for issue projection", () => {
	const result = spawnSync(process.execPath, [GENERATOR, "--check"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	assert.equal(
		result.status,
		0,
		`cursor projection --check failed:\n${result.stdout}\n${result.stderr}`,
	);
	assert.match(result.stdout, /Cursor skill projection check passed/u);
});

test("projected Cursor maister-issue body keeps create-only path and template markers", () => {
	assert.equal(fs.existsSync(PROJECTED_SKILL), true);
	const projected = fs.readFileSync(PROJECTED_SKILL, "utf8");
	const canonical = fs.readFileSync(CANONICAL_SKILL, "utf8");

	assert.match(projected, /\.maister\/issues\//u);
	assert.match(projected, /Never overwrite/iu);
	assert.match(projected, /# <Title>/u);
	assert.match(projected, /\*\*Status:\*\*\s*open/u);
	assert.match(projected, /## Acceptance criteria/u);
	assert.match(projected, /do not list|Do not list/u);
	assert.match(projected, /GitHub|Jira/u);

	// Projection may rewrite invocation syntax; core create-only contract must remain.
	const projectedBody = projected.replace(/^---\n[\s\S]*?\n---\n/u, "");
	const canonicalBody = canonical.replace(/^---\n[\s\S]*?\n---\n/u, "");
	assert.match(projectedBody, /Create exactly one local Markdown issue/u);
	assert.equal(
		projectedBody.includes(".maister/issues/"),
		canonicalBody.includes(".maister/issues/"),
	);
});

test("Cursor mapping fingerprint for issue matches projected asset on disk", async () => {
	const manifest = JSON.parse(fs.readFileSync(CURSOR_PROJECTION, "utf8"));
	const mapping = manifest.mappings.find(({ source }) => source === "issue");
	assert.ok(mapping, "issue mapping must exist");
	assert.equal(mapping.target, "maister-issue");
	assert.equal(fs.existsSync(PROJECTED_SKILL), true);

	const sourceDirectory = path.join(ROOT, "plugins/maister/skills/issue");
	const entries = fs
		.readdirSync(sourceDirectory, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
	assert.deepEqual(entries, ["SKILL.md"]);

	const hash = createHash("sha256");
	for (const relative of entries) {
		hash.update(relative);
		hash.update("\0");
		hash.update(fs.readFileSync(path.join(sourceDirectory, relative)));
		hash.update("\0");
	}
	assert.equal(
		mapping.source_fingerprint,
		hash.digest("hex"),
		"skill-projection fingerprint must match canonical issue skill tree",
	);
});
