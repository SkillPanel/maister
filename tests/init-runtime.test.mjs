import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
	classifyState,
	preflight,
	recordAdvisorOutcome,
	runInit,
	validateCandidateConfig,
} from "../plugins/maister/skills/init/bin/maister-init-runtime.mjs";
import {
	defaultConfig,
	makeInitFixture,
	snapshot,
	treeBytes,
	writeState,
} from "./helpers/init-runtime-fixture.mjs";

const configPath = (root) => path.join(root, ".maister", "config.yml");

for (const state of ["fresh", "partial", "complete"]) {
	test(`classifies ${state} state deterministically`, () => {
		const fixture = makeInitFixture({ state });
		try {
			assert.equal(classifyState(fixture.root), state);
			assert.equal(
				preflight({
					projectRoot: fixture.root,
					advisor: "off",
					action: "cancel",
				}).classification,
				state,
			);
		} finally {
			fixture.cleanup();
		}
	});
}

test("fresh init creates the runtime artifacts without changing the Git index", () => {
	const fixture = makeInitFixture();
	try {
		const before = snapshot(fixture.root);
		const result = runInit({ projectRoot: fixture.root, advisor: "off" });
		assert.equal(result.classification, "fresh");
		assert.equal(result.action, "create");
		assert.equal(snapshot(fixture.root).index, before.index);
		for (const relative of [
			".maister/config.yml",
			".maister/docs/INDEX.md",
			".maister/docs/project/tech-stack.md",
			".maister/docs/standards/README.md",
		]) {
			assert.equal(
				fs.existsSync(path.join(fixture.root, relative)),
				true,
				relative,
			);
		}
	} finally {
		fixture.cleanup();
	}
});

test("Cancel is byte-for-byte, Git-status, and index invariant", () => {
	const fixture = makeInitFixture({ state: "partial" });
	try {
		fs.writeFileSync(path.join(fixture.root, "README.md"), "unstaged\n");
		const beforeTree = treeBytes(fixture.root);
		const beforeGit = snapshot(fixture.root);
		const result = runInit({
			projectRoot: fixture.root,
			action: "cancel",
			advisor: "off",
		});
		assert.equal(result.action, "cancel");
		assert.deepEqual(treeBytes(fixture.root), beforeTree);
		assert.deepEqual(snapshot(fixture.root), beforeGit);
	} finally {
		fixture.cleanup();
	}
});

test("repair preserves staged and unstaged user changes and writes only missing artifacts", () => {
	const fixture = makeInitFixture({ state: "partial" });
	try {
		const config = configPath(fixture.root);
		fs.writeFileSync(config, defaultConfig());
		fs.writeFileSync(path.join(fixture.root, "README.md"), "unstaged\n");
		fs.writeFileSync(path.join(fixture.root, "staged.txt"), "staged\n");
		requireGit(fixture.root, ["add", "staged.txt"]);
		const before = snapshot(fixture.root);
		const custom = fs.readFileSync(
			path.join(fixture.root, ".maister", "docs", "project", "custom.md"),
		);
		const result = runInit({
			projectRoot: fixture.root,
			action: "repair",
			advisor: "off",
		});
		assert.equal(result.action, "repair");
		assert.deepEqual(snapshot(fixture.root).index, before.index);
		assert.deepEqual(
			fs.readFileSync(
				path.join(fixture.root, ".maister", "docs", "project", "custom.md"),
			),
			custom,
		);
		assert.equal(
			fs.existsSync(
				path.join(fixture.root, ".maister", "docs", "standards", "README.md"),
			),
			true,
		);
	} finally {
		fixture.cleanup();
	}
});

test("backup is copy-based, rebuilds stale files, and complete rerun is idempotent", () => {
	const fixture = makeInitFixture({ state: "complete" });
	try {
		const beforeTree = treeBytes(fixture.root);
		fs.writeFileSync(
			path.join(fixture.root, ".maister", "docs", "project", "stale.md"),
			"stale\n",
		);
		const first = runInit({
			projectRoot: fixture.root,
			action: "backup",
			advisor: "off",
		});
		assert.equal(first.action, "backup");
		assert.equal(
			fs.existsSync(path.join(fixture.root, ".maister", "backups")),
			true,
		);
		const backupRoot = path.join(
			fixture.root,
			".maister",
			first.manifest.backup_path,
		);
		assert.deepEqual(
			fs.readFileSync(path.join(backupRoot, "docs", "INDEX.md")),
			beforeTree[".maister/docs/INDEX.md"],
		);
		assert.equal(
			fs.existsSync(
				path.join(fixture.root, ".maister", "docs", "project", "stale.md"),
			),
			false,
		);
		const second = runInit({
			projectRoot: fixture.root,
			action: "update",
			advisor: "off",
		});
		assert.equal(second.classification, "complete");
		assert.equal(second.action, "update");
		assert.equal(
			fs.readdirSync(path.join(fixture.root, ".maister", "backups")).length,
			1,
		);
	} finally {
		fixture.cleanup();
	}
});

test("resume continues from a failed manifest and records Advisor separately", () => {
	const fixture = makeInitFixture();
	try {
		assert.throws(
			() =>
				runInit({
					projectRoot: fixture.root,
					advisor: "on",
					failurePoint: "artifacts",
				}),
			/injected init failure/,
		);
		const manifestPath = path.join(
			fixture.root,
			".maister",
			"init-runtime-manifest.json",
		);
		assert.equal(
			JSON.parse(fs.readFileSync(manifestPath, "utf8")).transaction.status,
			"failed",
		);
		const resumed = runInit({
			projectRoot: fixture.root,
			action: "resume",
			advisor: "on",
		});
		assert.equal(resumed.manifest.transaction.status, "succeeded");
		assert.equal(resumed.manifest.advisor.invoked, false);
		assert.throws(
			() =>
				recordAdvisorOutcome(fixture.root, {
					gate: "phase-exit",
					invoked: true,
					decision_recorded: false,
					logical_role_id: "other:advisor",
				}),
			/exact logical role/,
		);
		const advisor = recordAdvisorOutcome(fixture.root, {
			gate: "phase-exit",
			invoked: true,
			decision_recorded: true,
			logical_role_id: "maister:advisor",
			actor: "maister:advisor",
			model: "test-model",
			dispatch_id: "dispatch-1",
			input_digest: "a".repeat(64),
			selected_option: "Continue",
			confidence: "high",
			result_status: "continue",
			retry_count: 1,
			failure_details: null,
		});
		assert.equal(advisor.invoked, true);
		assert.equal(advisor.decision_recorded, true);
		assert.equal(advisor.events.length, 1);
		assert.equal(advisor.events[0].logical_role_id, "maister:advisor");
		assert.equal(advisor.events[0].input_digest, "a".repeat(64));
		assert.equal(advisor.events[0].retry_count, 1);
	} finally {
		fixture.cleanup();
	}
});

test("invalid fresh inputs fail before creating the project state directory", () => {
	const fixture = makeInitFixture();
	try {
		assert.throws(
			() =>
				runInit({
					projectRoot: fixture.root,
					advisor: "off",
					configText: "advisor: [unsafe]",
				}),
			/validation failed|gate config/,
		);
		assert.equal(fs.existsSync(path.join(fixture.root, ".maister")), false);
	} finally {
		fixture.cleanup();
	}
});

test("reconcile failure leaves a failed manifest and no candidate residue", () => {
	const fixture = makeInitFixture();
	try {
		assert.throws(
			() =>
				runInit({
					projectRoot: fixture.root,
					advisor: "off",
					failurePoint: "reconcile",
				}),
			/injected init failure/,
		);
		const manifest = JSON.parse(
			fs.readFileSync(
				path.join(fixture.root, ".maister", "init-runtime-manifest.json"),
				"utf8",
			),
		);
		assert.equal(manifest.transaction.status, "failed");
		assert.equal(
			fs
				.readdirSync(path.join(fixture.root, ".maister"))
				.some((name) => name.includes(".tmp") || name.includes("candidate")),
			false,
		);
	} finally {
		fixture.cleanup();
	}
});

test("candidate validation rejects unsafe config without project or temporary residue writes", () => {
	const fixture = makeInitFixture();
	try {
		const candidate = path.join(fixture.root, "candidate.yml");
		fs.writeFileSync(candidate, "advisor: &bad\n  enabled: false\n");
		assert.throws(
			() => validateCandidateConfig(candidate, { enabled: "on" }),
			/validation failed|anchors/,
		);
		assert.equal(fs.existsSync(path.join(fixture.root, ".maister")), false);
		assert.deepEqual(
			fs.readdirSync(fixture.root).filter((name) => name.includes("candidate")),
			["candidate.yml"],
		);
	} finally {
		fixture.cleanup();
	}
});

function requireGit(root, args) {
	execFileSync("git", args, { cwd: root });
}
