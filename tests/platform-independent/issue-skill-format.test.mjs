import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseCanonicalYaml } from "../../plugins/maister/skills/orchestrator-framework/bin/orchestrator-state-schema.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_PATH = path.join(ROOT, "plugins/maister/skills/issue/SKILL.md");
const SKILL_DIR = path.dirname(SKILL_PATH);

function readSkill() {
	assert.ok(fs.existsSync(SKILL_PATH), `missing skill at ${SKILL_PATH}`);
	const text = fs.readFileSync(SKILL_PATH, "utf8");
	const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
	assert.ok(match, "issue skill must have YAML frontmatter");
	return { text, frontmatter: parseCanonicalYaml(match[1]), body: text.slice(match[0].length) };
}

test("issue skill frontmatter is user-invocable maister-issue with description and argument-hint", () => {
	const { frontmatter } = readSkill();
	assert.equal(frontmatter.name, "maister-issue");
	assert.equal(frontmatter["user-invocable"], true);
	assert.equal(typeof frontmatter.description, "string");
	assert.ok(frontmatter.description.trim().length > 0, "description must be non-empty");
	assert.equal(typeof frontmatter["argument-hint"], "string");
	assert.ok(
		frontmatter["argument-hint"].trim().length > 0,
		"argument-hint must be non-empty",
	);
});

test("issue skill documents create-only path algorithm under .maister/issues/", () => {
	const { body } = readSkill();
	assert.match(body, /\.maister\/issues\//u);
	assert.match(body, /YYYY-MM-DD-kebab-slug\.md|YYYY-MM-DD-<slug>\.md/u);
	assert.match(body, /\bUTC\b/u);
	assert.match(body, /never overwrite|do not overwrite|Never overwrite/iu);
	assert.match(body, /slug-2|numeric suffix|<slug>-2|disambiguat/iu);
});

test("issue skill embeds required core issue template strings", () => {
	const { body } = readSkill();
	assert.match(body, /# <Title>/u);
	assert.match(body, /\*\*Status:\*\*\s*open/u);
	assert.match(body, /\*\*Added:\*\*/u);
	assert.match(body, /\*\*Area:\*\*/u);
	assert.match(body, /\*\*Priority:\*\*/u);
	assert.match(body, /## Problem/u);
	assert.match(body, /## Evidence/u);
	assert.match(body, /## Acceptance criteria/u);
	assert.match(body, /\bunspecified\b/u);
	assert.match(body, /\bP2\b/u);
});

test("issue skill states create-only non-behaviors", () => {
	const { body } = readSkill();
	assert.match(body, /do not list|not list|never list/iu);
	assert.match(body, /do not update|not update|never update/iu);
	assert.match(body, /do not close|not close|never close/iu);
	assert.match(body, /do not sync|not sync|never sync/iu);
	assert.match(body, /GitHub|Jira/u);
	assert.match(body, /maister-work|FLOW/u);
});
test("issue skill directory contains only SKILL.md (no references tree)", () => {
	assert.ok(fs.existsSync(SKILL_DIR), `missing skill directory ${SKILL_DIR}`);
	const entries = fs.readdirSync(SKILL_DIR);
	assert.deepEqual(entries, ["SKILL.md"]);
	assert.equal(fs.existsSync(path.join(SKILL_DIR, "references")), false);
});
