import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const COMMANDS_DOC = path.join(ROOT, "docs/commands.md");
const WORK_SKILL = path.join(ROOT, "plugins/maister/skills/work/SKILL.md");
const WORK_COMMAND = path.join(ROOT, "plugins/maister/commands/work.md");
const TASK_CLASSIFIER = path.join(ROOT, "plugins/maister/agents/task-classifier.md");

const SIX_FLOW = [
	"maister-bye",
	"maister-dev",
	"maister-next",
	"maister-resume",
	"maister-status",
	"maister-work",
];

function read(filePath) {
	assert.ok(fs.existsSync(filePath), `missing file: ${filePath}`);
	return fs.readFileSync(filePath, "utf8");
}

function extractLifecycleTable(doc) {
	const match = /## Unified lifecycle commands\n([\s\S]*?)(?=\n## )/u.exec(doc);
	assert.ok(match, "docs/commands.md must contain Unified lifecycle commands section");
	return match[1];
}

test("docs/commands.md documents first-class maister-issue create-only section with path shape", () => {
	const doc = read(COMMANDS_DOC);
	assert.match(doc, /\/maister-issue|\/maister:issue/u);
	assert.match(doc, /create-only|creates? (exactly )?one|create a local/iu);
	assert.match(doc, /\.maister\/issues\//u);
	assert.match(doc, /YYYY-MM-DD-kebab-slug\.md|YYYY-MM-DD-<slug>\.md/u);
	assert.match(doc, /\$maister:maister-issue|\/skill:maister-issue/u);
});

test("docs lifecycle six table still lists exactly the six flow-control skills", () => {
	const table = extractLifecycleTable(read(COMMANDS_DOC));
	const skillRows = [...table.matchAll(/^\| `(maister-[a-z-]+)` \|/gmu)].map((m) => m[1]);
	assert.deepEqual(skillRows, SIX_FLOW);
	assert.equal(skillRows.length, 6);
	assert.equal(skillRows.includes("maister-issue"), false);
	assert.doesNotMatch(table, /maister-issue/u);
});

test("work skill and task-classifier carry light remote-vs-local issue vocabulary notes", () => {
	const work = read(WORK_SKILL);
	const classifier = read(TASK_CLASSIFIER);

	for (const [label, text] of [
		["work skill", work],
		["task-classifier", classifier],
	]) {
		assert.match(text, /\.maister\/issues\//u, `${label} must mention .maister/issues/`);
		assert.match(
			text,
			/maister-issue|\/maister-issue/u,
			`${label} must mention maister-issue for local capture`,
		);
		assert.match(
			text,
			/remote|GitHub|Jira|Azure/u,
			`${label} must still acknowledge remote tracker inputs`,
		);
		assert.match(
			text,
			/not (?:the same as|a |\.maister)|≠|are not|\bis not\b|do not (?:treat|confuse)|unlike local/iu,
			`${label} must disambiguate remote tracker IDs from local issue files`,
		);
	}
});

test("work command twin mirrors light remote-vs-local issue vocabulary note when present", () => {
	const workCommand = read(WORK_COMMAND);
	// commands/work.md duplicates issue-tracker input language; keep the same light note.
	assert.match(workCommand, /\.maister\/issues\//u);
	assert.match(workCommand, /maister-issue|\/maister-issue/u);
});

test("docs six FLOW table stays untouched while issue lives outside lifecycle section", () => {
	const doc = read(COMMANDS_DOC);
	const table = extractLifecycleTable(doc);
	assert.doesNotMatch(table, /maister-issue/u);

	const issueHeading = /## Issue\n+### `\/maister:issue/u.exec(doc);
	assert.ok(issueHeading, "maister-issue must have its own docs heading outside FLOW six");
	const lifecycleStart = doc.indexOf("## Unified lifecycle commands");
	const issuePos = issueHeading.index;
	assert.ok(lifecycleStart >= 0);
	assert.ok(
		issuePos < lifecycleStart || issuePos > lifecycleStart + table.length,
		"issue section must not be nested inside the lifecycle six table",
	);
});
