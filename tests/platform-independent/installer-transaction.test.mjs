import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeTest, { after as nodeAfter } from "node:test";

import { runCli } from "../../plugins/maister/bin/maister-install.mjs";
import { hashTree } from "../../plugins/maister/lib/distribution/hash-tree.mjs";
import { materialize } from "../../plugins/maister/lib/distribution/materializer.mjs";
import { readJournal } from "../../plugins/maister/lib/distribution/journal-schema.mjs";
import {
	readManifest,
	recoverJournal,
	removeEntry,
	restoreFullBackup,
	snapshotState,
} from "../../plugins/maister/lib/distribution/recovery.mjs";
import { atomicWriteSetting } from "../../plugins/maister/lib/distribution/settings-owner.mjs";
import { getTargetPaths } from "../../plugins/maister/lib/distribution/target-paths.mjs";
import {
	readReceipt,
	validateReceipt,
} from "../../plugins/maister/lib/distribution/receipt-schema.mjs";
import { validateJournal } from "../../plugins/maister/lib/distribution/journal-schema.mjs";
import {
	acquireLock,
	executeLifecycle,
} from "../../plugins/maister/lib/distribution/transaction-manager.mjs";
import { createEvidenceRecord } from "../../plugins/maister/lib/distribution/evidence-schema.mjs";
import {
	e3AttestationDigest,
	portableCoreTreeHash,
} from "../../plugins/maister/lib/distribution/e3-attestation.mjs";
import { runWithExternalWatchdog } from "../helpers/external-test-watchdog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE_ROOT = path.join(
	ROOT,
	"tests/fixtures/platform-independent/source-repos/basic",
);
const MULTI_ROOT_HOME = path.join(
	ROOT,
	"tests/fixtures/platform-independent/user-homes/multi-root",
);
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TARGETS = ["codex", "cursor", "kiro-cli", "pi"];
function resolveGenericMatrixEntry(target) {
	return { target, runLifecycle: true };
}

// The aggregate is intentionally exhaustive and can run close to eleven
// minutes on a busy CI host. Keep the external watchdog bounded, but leave
// enough margin for the same test when invoked through Make/CI supervision.
const PROGRESS_FIXTURE_ENV = "MAISTER_INSTALLER_TRANSACTION_PROGRESS_FIXTURE";
const progressFixture = process.env[PROGRESS_FIXTURE_ENV] ?? null;
const HARNESS_DEADLINE_MS = progressFixture === "target-timeout" ? 300 : 15 * 60 * 1000;
const HARNESS_HEARTBEAT_MS = progressFixture ? 10 : 30 * 1000;
const HARNESS_CHILD_ENV = "MAISTER_INSTALLER_TRANSACTION_CHILD";
const isHarnessChild = process.env[HARNESS_CHILD_ENV] === "1";
const after = isHarnessChild ? nodeAfter : () => {};
const harnessStartedAt = Date.now();
const harnessSandboxes = new Set();
let harnessInvocationCount = 0;
let activeScenario = null;
let activeScenarioStartedAt = null;
let activeTarget = null;

function emitProgress(event, target = activeTarget) {
	if (!activeScenario) return;
	process.stderr.write(
		`${JSON.stringify({
			kind: "maister.installer-transaction.heartbeat",
			event,
			scenario: activeScenario,
			target,
			elapsed_ms: Date.now() - harnessStartedAt,
			scenario_elapsed_ms:
				event === "scenario-finish"
					? Date.now() - activeScenarioStartedAt
					: null,
			sandbox_count: harnessSandboxes.size,
			invocation_count: harnessInvocationCount,
		})}\n`,
	);
}

async function runScenario(name, callback, context) {
	activeScenario = name;
	activeScenarioStartedAt = Date.now();
	emitProgress("scenario-start", null);
	try {
		return await callback(context);
	} finally {
		activeTarget = null;
		emitProgress("scenario-finish", null);
		activeScenario = null;
		activeScenarioStartedAt = null;
	}
}

async function runTarget(target, callback) {
	activeTarget = target;
	emitProgress("target-start");
	try {
		return await callback();
	} finally {
		emitProgress("target-finish");
		activeTarget = null;
	}
}

function registerAggregateTest(name, options, callback) {
	if (typeof options === "function") {
		callback = options;
		options = undefined;
	}
	return nodeTest(name, options, (context) => runScenario(name, callback, context));
}

const test = isHarnessChild && !progressFixture ? registerAggregateTest : () => {};

if (!isHarnessChild) {
	nodeTest(
		"installer transaction aggregate has an external watchdog and terminal classification",
		{ timeout: HARNESS_DEADLINE_MS + 60_000 },
		async () => {
			let finalTreeEvidence =
				progressFixture === "pre-progress" ? [{ fixture: "pre-progress" }] : [];
			let lastProgress = null;
			const childEnvironment = { ...process.env, [HARNESS_CHILD_ENV]: "1" };
			delete childEnvironment.NODE_TEST_CONTEXT;
			const result = await runWithExternalWatchdog({
				command: process.execPath,
				args: ["--test", import.meta.filename],
				cwd: ROOT,
				env: childEnvironment,
				heartbeatKind: "maister.installer-transaction.heartbeat",
				heartbeatDeadlineMs: null,
				supervisorHeartbeatMs: HARNESS_HEARTBEAT_MS,
				totalDeadlineMs: HARNESS_DEADLINE_MS,
				maximumCaptureBytes: 256 * 1024,
				onStdout: (chunk) => process.stderr.write(chunk),
				onStderr: (chunk) => process.stderr.write(chunk),
				onSupervisorHeartbeat: (record) =>
					process.stderr.write(
						`${JSON.stringify({ ...record, last_progress: lastProgress })}\n`,
					),
				onRecord: (record) => {
					if (
						record?.kind === "maister.installer-transaction.heartbeat" &&
						[
							"scenario-start",
							"target-start",
							"heartbeat",
							"target-finish",
							"scenario-finish",
						].includes(record.event)
					) {
						lastProgress = record;
					}
					if (
						record?.kind === "maister.installer-transaction.final-tree-evidence"
					) {
						finalTreeEvidence = record.final_tree_evidence;
					}
				},
			});
			process.stderr.write(
				`${JSON.stringify({
					kind: "maister.installer-transaction.terminal",
					classification: result.classification,
					code: result.code,
					signal: result.signal,
					elapsed_ms: result.elapsedMs,
					stdout_truncated: result.stdoutTruncated,
					stderr_truncated: result.stderrTruncated,
					lastRecord: result.lastRecord,
					last_progress: lastProgress,
					final_tree_evidence: finalTreeEvidence,
				})}\n`,
			);
			assert.equal(result.classification, "passed", result.stderr);
			assert.equal(result.code, 0);
			assert.ok(
				finalTreeEvidence.length > 0,
				"child must emit terminal final-tree evidence",
			);
		},
	);
}

function compactTreeEvidence(candidate) {
	const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
	if (!stat) return { exists: false };
	const mode = (stat.mode & 0o7777).toString(8).padStart(4, "0");
	if (stat.isDirectory()) {
		const entries = [];
		const visit = (current, relative) => {
			for (const name of fs.readdirSync(current).sort()) {
				const child = path.join(current, name);
				const childRelative = relative ? `${relative}/${name}` : name;
				const childStat = fs.lstatSync(child);
				const childMode = (childStat.mode & 0o7777)
					.toString(8)
					.padStart(4, "0");
				if (childStat.isDirectory()) {
					entries.push({
						path: childRelative,
						type: "directory",
						mode: childMode,
					});
					visit(child, childRelative);
				} else if (childStat.isSymbolicLink()) {
					entries.push({
						path: childRelative,
						type: "symlink",
						mode: childMode,
						link_target: fs.readlinkSync(child),
					});
				} else if (childStat.isFile()) {
					entries.push({
						path: childRelative,
						type: "file",
						mode: childMode,
						size: childStat.size,
						sha256: crypto
							.createHash("sha256")
							.update(fs.readFileSync(child))
							.digest("hex"),
					});
				} else {
					entries.push({
						path: childRelative,
						type: "unsupported",
						mode: childMode,
					});
				}
			}
		};
		visit(candidate, "");
		const contentHash = crypto
			.createHash("sha256")
			.update(entries.map((entry) => JSON.stringify(entry)).join("\n"))
			.digest("hex");
		return {
			exists: true,
			type: "directory",
			mode,
			entries: entries.length,
			content_hash: contentHash,
		};
	}
	if (stat.isSymbolicLink())
		return {
			exists: true,
			type: "symlink",
			mode,
			link_target: fs.readlinkSync(candidate),
		};
	return {
		exists: true,
		type: "file",
		mode,
		sha256: crypto
			.createHash("sha256")
			.update(fs.readFileSync(candidate))
			.digest("hex"),
	};
}

function aggregateFinalTreeEvidence() {
	return [...harnessSandboxes].map(({ root, home, state }) => ({
		sandbox: path.basename(root),
		home: compactTreeEvidence(home),
		state: compactTreeEvidence(state),
	}));
}

const heartbeat = isHarnessChild
	? setInterval(() => emitProgress("heartbeat"), HARNESS_HEARTBEAT_MS)
	: null;
heartbeat?.unref();

after(() => {
	clearInterval(heartbeat);
	if (progressFixture === "pre-progress") return;
	process.stderr.write(
		`${JSON.stringify({
			kind: "maister.installer-transaction.final-tree-evidence",
			elapsed_ms: Date.now() - harnessStartedAt,
			final_tree_evidence: aggregateFinalTreeEvidence(),
		})}\n`,
	);
});

const cleanGit = {
	topLevel: () => SOURCE_ROOT,
	head: () => COMMIT,
	status: () => [],
};

function sandbox() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-installer-"));
	const home = path.join(root, "home");
	const state = path.join(root, "state");
	const sourceRoot = path.join(root, "source");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(state, { recursive: true, mode: 0o700 });
	fs.chmodSync(state, 0o700);
	fs.cpSync(SOURCE_ROOT, sourceRoot, { recursive: true });
	fs.mkdirSync(path.join(sourceRoot, "plugins/maister"), { recursive: true });
	// ponytail: basename denylist covers contract exclusions; add path-aware filter if nested names collide
	const excludeNames = new Set([
		".git",
		"node_modules",
		"credentials",
		"sessions",
		".pi",
	]);
	const copyOptions = {
		recursive: true,
		filter: (source) => !excludeNames.has(path.basename(source)),
	};
	fs.cpSync(
		path.join(ROOT, "plugins/maister/overlays"),
		path.join(sourceRoot, "plugins/maister/overlays"),
		copyOptions,
	);
	fs.cpSync(
		path.join(ROOT, "plugins/maister/agent-projection-v1.json"),
		path.join(sourceRoot, "plugins/maister/agent-projection-v1.json"),
	);
	for (const directory of [
		"agents",
		"skills",
		"bin",
		"lib",
		"common",
		"commands",
	]) {
		fs.cpSync(
			path.join(ROOT, "plugins/maister", directory),
			path.join(sourceRoot, "plugins/maister", directory),
			copyOptions,
		);
	}
	const git = {
		topLevel: () => fs.realpathSync(sourceRoot),
		head: () => COMMIT,
		status: () => [],
	};
	const coreHash = portableCoreTreeHash(sourceRoot);
	const attestationPath = path.join(root, "e3-attestation.json");
	fs.writeFileSync(
		attestationPath,
		`${JSON.stringify(
			{
				schema_version: 1,
				kind: "maister/e3-portable-core",
				test_command:
					"node --test tests/platform-independent/portable-core.test.mjs",
				result: "passed",
				source_commit: COMMIT,
				source_version: "unknown",
				portable_core_tree_hash: coreHash,
				scenario: "portable-core-v1",
				scenario_version: "1.0.0",
				tested_at: "2026-07-15T00:00:00.000Z",
				expires_at: "2027-07-15T00:00:00.000Z",
				artifact_digest: coreHash,
			},
			null,
			2,
		)}\n`,
	);
	const env = {
		...process.env,
		HOME: home,
		XDG_STATE_HOME: state,
		MAISTER_ENABLE_FAILURE_INJECTION: "1",
		MAISTER_EVIDENCE_NOW: "2026-07-15T00:00:00.000Z",
		MAISTER_CODEX_NATIVE_DEPLOYMENT: "0",
	};
	// ponytail: strip inherited Pi redirects; intentional overrides set per-test on box.env
	delete env.PI_CODING_AGENT_DIR;
	delete env.PI_CODING_AGENT_SESSION_DIR;
	delete env.PI_PACKAGE_DIR;
	const box = {
		root,
		home,
		state,
		sourceRoot,
		git,
		attestationPath,
		env,
	};
	harnessSandboxes.add(box);
	return box;
}

// ponytail: test-only containment vs box.root; upgrade if symlink escapes need realpath
function resolveWithExistingAncestor(candidate) {
	let current = path.resolve(candidate);
	const missing = [];
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current);
		if (parent === current) break;
		missing.unshift(path.basename(current));
		current = parent;
	}
	return path.join(fs.realpathSync(current), ...missing);
}

function isContainedBySandbox(box, candidate) {
	const relative = path.relative(
		resolveWithExistingAncestor(box.root),
		resolveWithExistingAncestor(candidate),
	);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function assertContainedBySandbox(box, candidate, label = candidate) {
	assert.equal(
		isContainedBySandbox(box, candidate),
		true,
		`${label} must stay inside sandbox root (${candidate})`,
	);
}

function assertTargetPathsContained(box, paths) {
	for (const [key, value] of Object.entries(paths)) {
		if (typeof value === "string" && path.isAbsolute(value)) {
			assertContainedBySandbox(box, value, key);
		} else if (Array.isArray(value)) {
			for (const entry of value) {
				if (
					entry &&
					typeof entry.path === "string" &&
					path.isAbsolute(entry.path)
				) {
					assertContainedBySandbox(
						box,
						entry.path,
						`${key}.${entry.rootId ?? "path"}`,
					);
				}
			}
		}
	}
}

function args(command, target, box, extra = []) {
	return [
		command,
		"--target",
		target,
		"--source",
		`local:${box.sourceRoot}`,
		"--home",
		box.home,
		"--json",
		...extra,
	];
}

async function invoke(command, target, box, extra = []) {
	const cliArgs = args(command, target, box, extra);
	if (command === "install" || command === "update")
		cliArgs.push("--attestation", box.attestationPath);
	harnessInvocationCount += 1;
	return runCli(cliArgs, { env: box.env, git: box.git });
}

if (isHarnessChild && progressFixture) {
	nodeTest("installer transaction progress contract fixture", async () => {
		if (progressFixture === "pre-progress") {
			await new Promise((resolve) => setTimeout(resolve, 35));
			return;
		}
		if (progressFixture === "target-timeout") {
			await runScenario("fixture target timeout", () =>
				runTarget("cursor", () => new Promise(() => {})),
			);
			return;
		}
		await runScenario(`fixture ${progressFixture}`, async () => {
			const box = sandbox();
			if (progressFixture === "transitions") {
				await runTarget("codex", async () => {
					const failedAttempt = output(
						await invoke("unsupported-fixture-command", "codex", box),
					);
					assert.notEqual(failedAttempt.code, 0);
					emitProgress("heartbeat");
				});
			}
		});
	});
}

function output(result) {
	return typeof result.output === "string"
		? JSON.parse(result.output)
		: result.output;
}

function readAttestation(box) {
	return JSON.parse(fs.readFileSync(box.attestationPath, "utf8"));
}

function activePath(box, target = "codex") {
	return getTargetPaths({ target, home: box.home, env: box.env }).activeRoot;
}

function managedRootPath(box, target, rootId) {
	const root = getTargetPaths({
		target,
		home: box.home,
		env: box.env,
	}).managedRoots.find((entry) => entry.rootId === rootId);
	assert.ok(root, `${target}.${rootId}`);
	return root.path;
}

function snapshotPath(targetPath) {
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (!stat) return { exists: false };
	const mode = (stat.mode & 0o7777).toString(8).padStart(4, "0");
	if (stat.isDirectory())
		return {
			exists: true,
			type: "directory",
			mode,
			tree: hashTree(targetPath),
		};
	if (stat.isSymbolicLink())
		return {
			exists: true,
			type: "symlink",
			mode,
			linkTarget: fs.readlinkSync(targetPath),
		};
	return {
		exists: true,
		type: "file",
		mode,
		sha256: crypto
			.createHash("sha256")
			.update(fs.readFileSync(targetPath))
			.digest("hex"),
	};
}

function snapshotManagedHome(box) {
	return snapshotPath(box.home);
}

function snapshotStateRoot(box, target = "kiro-cli") {
	return snapshotPath(
		getTargetPaths({ target, home: box.home, env: box.env }).stateRoot,
	);
}

function seedMultiRootHome(box) {
	fs.cpSync(MULTI_ROOT_HOME, box.home, { recursive: true });
	return {
		descriptor: fs.readFileSync(
			path.join(box.home, ".kiro/agents/user-owned.json"),
		),
		prompt: fs.readFileSync(
			path.join(box.home, ".kiro/agents/instructions/user-owned.md"),
		),
		nested: fs.readFileSync(
			path.join(box.home, ".kiro/agents/user-space/nested.txt"),
		),
	};
}

function assertUnrelatedKiroContent(box, expected) {
	assert.deepEqual(
		fs.readFileSync(path.join(box.home, ".kiro/agents/user-owned.json")),
		expected.descriptor,
	);
	assert.deepEqual(
		fs.readFileSync(
			path.join(box.home, ".kiro/agents/instructions/user-owned.md"),
		),
		expected.prompt,
	);
	assert.deepEqual(
		fs.readFileSync(path.join(box.home, ".kiro/agents/user-space/nested.txt")),
		expected.nested,
	);
}

function prepareStateLayout(box, target = "kiro-cli") {
	const paths = getTargetPaths({ target, home: box.home, env: box.env });
	for (const directory of [
		paths.stateRoot,
		paths.journalsRoot,
		paths.receiptsRoot,
		paths.backupsRoot,
		paths.stagingRoot,
		paths.controlPlanesRoot,
	]) {
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		fs.chmodSync(directory, 0o700);
	}
	return paths;
}

function addReceiptOwnedStaleLeaf(
	receiptPath,
	nativeRoot,
	{ path: relativePath, bytes, mode = 0o640 },
) {
	const targetPath = path.join(nativeRoot, ...relativePath.split("/"));
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.writeFileSync(targetPath, bytes, { mode });
	fs.chmodSync(targetPath, mode);
	const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
	receipt.managed_inventory.push({
		root_id: "plugin_private",
		path: relativePath,
		type: "file",
		mode: mode.toString(8).padStart(4, "0"),
		sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
		link_target: null,
		ownership: "whole_file",
	});
	receipt.managed_inventory.sort(
		(left, right) =>
			left.root_id.localeCompare(right.root_id) ||
			left.path.localeCompare(right.path),
	);
	fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	return targetPath;
}

function readActiveSnapshot(box, target = "codex") {
	const active = activePath(box, target);
	return fs.existsSync(active)
		? hashTree(active, { allowMissingSymlinks: true })
		: null;
}

function clearJournals(box, target = "codex") {
	const journalsRoot = getTargetPaths({
		target,
		home: box.home,
		env: box.env,
	}).journalsRoot;
	for (const journal of fs.readdirSync(journalsRoot))
		fs.rmSync(path.join(journalsRoot, journal));
}

const PI_FIXTURE_REQUIRED_PATHS = Object.freeze([
	"common",
	"commands",
	"agents",
	"lib",
	"bin",
	"skills/orchestrator-framework/bin",
]);

const PI_PACKAGE_FORBIDDEN_PREFIXES = Object.freeze([
	"commands/",
	".git/",
	"node_modules/",
	"credentials/",
	"sessions/",
	".pi/",
]);

function pluginFixturePath(box, relative) {
	return path.join(box.sourceRoot, "plugins/maister", relative);
}

test("sandbox fixture includes repository-backed Pi package inputs", () => {
	const box = sandbox();
	const pluginRoot = path.join(box.sourceRoot, "plugins/maister");
	for (const relative of PI_FIXTURE_REQUIRED_PATHS) {
		const absolute = pluginFixturePath(box, relative);
		assert.equal(
			fs.lstatSync(absolute, { throwIfNoEntry: false })?.isDirectory(),
			true,
			relative,
		);
		assert.equal(
			fs.realpathSync(absolute).startsWith(fs.realpathSync(pluginRoot)),
			true,
			`${relative} must stay under sandbox plugin root`,
		);
	}
	assert.equal(
		fs.existsSync(path.join(pluginRoot, "overlays")),
		true,
		"overlays",
	);
	assert.equal(
		fs.existsSync(path.join(pluginRoot, "agent-projection-v1.json")),
		true,
		"agent-projection-v1.json",
	);
	const attestation = readAttestation(box);
	assert.equal(
		attestation.portable_core_tree_hash,
		portableCoreTreeHash(box.sourceRoot),
		"attestation must be calculated after fixture assembly",
	);
});

test("sandbox fixture lets Pi materialization reach package planning without E_MATERIALIZE_SOURCE", async () => {
	const box = sandbox();
	const stagingRoot = path.join(box.root, "pi-stage");
	let result;
	try {
		result = await materialize({
			source: `local:${box.sourceRoot}`,
			target: "pi",
			overlayPath: path.join(
				box.sourceRoot,
				"plugins/maister/overlays/pi/overlay.yml",
			),
			inventoryPath: path.join(
				box.sourceRoot,
				"plugins/maister/overlays/pi/inventory.yml",
			),
			stagingRoot,
			git: box.git,
			sourceVersion: "1.2.3",
			hostVersion: "1.0.0",
		});
	} catch (error) {
		assert.notEqual(
			error?.code ?? error?.kind,
			"E_MATERIALIZE_SOURCE",
			error?.message ?? String(error),
		);
		throw error;
	}
	assert.ok(result?.stagingRoot, "materialize must produce a package stage");
	assert.equal(
		fs.existsSync(path.join(result.stagingRoot, "package.json")),
		true,
	);
	assert.ok(
		result.commandProjection?.entries?.length > 0,
		"command projection must resolve overlay origins",
	);
});

test("sandbox fixture Pi package output keeps required inputs and excludes forbidden paths", async () => {
	const box = sandbox();
	const stagingRoot = path.join(box.root, "pi-stage");
	const result = await materialize({
		source: `local:${box.sourceRoot}`,
		target: "pi",
		overlayPath: path.join(
			box.sourceRoot,
			"plugins/maister/overlays/pi/overlay.yml",
		),
		inventoryPath: path.join(
			box.sourceRoot,
			"plugins/maister/overlays/pi/inventory.yml",
		),
		stagingRoot,
		git: box.git,
		sourceVersion: "1.2.3",
		hostVersion: "1.0.0",
	});
	const treePaths = hashTree(result.stagingRoot).entries.map(
		(entry) => entry.path,
	);
	for (const required of [
		"package.json",
		".maister-source.json",
		"agent-projection-v1.json",
		"pi-command-projection-v1.json",
		"extensions/maister.ts",
		"common",
		"lib",
		"bin",
		"orchestrator-framework/bin",
	]) {
		assert.equal(
			treePaths.some(
				(treePath) =>
					treePath === required || treePath.startsWith(`${required}/`),
			),
			true,
			`missing required package path: ${required}`,
		);
	}
	assert.equal(
		treePaths.some((treePath) => treePath.startsWith("prompts/")),
		true,
		"prompts",
	);
	assert.equal(
		treePaths.some((treePath) => /^agents\/maister-[^/]+\.md$/u.test(treePath)),
		true,
		"projected agents",
	);
	assert.equal(
		treePaths.some((treePath) => /(?:^|\/)SKILL\.md$/u.test(treePath)),
		true,
		"skills",
	);
	for (const prefix of PI_PACKAGE_FORBIDDEN_PREFIXES) {
		assert.equal(
			treePaths.some(
				(treePath) =>
					treePath === prefix.slice(0, -1) || treePath.startsWith(prefix),
			),
			false,
			`forbidden package path present: ${prefix}`,
		);
	}
});

test("sandbox HOME and XDG_STATE_HOME resolve below sandbox root", () => {
	const box = sandbox();
	assert.equal(path.resolve(box.env.HOME), path.resolve(box.home));
	assert.equal(path.resolve(box.env.XDG_STATE_HOME), path.resolve(box.state));
	assertContainedBySandbox(box, box.env.HOME, "HOME");
	assertContainedBySandbox(box, box.env.XDG_STATE_HOME, "XDG_STATE_HOME");
});

test("sandbox removes inherited Pi path overrides by default", () => {
	const keys = [
		"PI_CODING_AGENT_DIR",
		"PI_CODING_AGENT_SESSION_DIR",
		"PI_PACKAGE_DIR",
	];
	const previous = Object.fromEntries(
		keys.map((key) => [key, process.env[key]]),
	);
	try {
		for (const key of keys) {
			process.env[key] = path.join(os.tmpdir(), `host-${key}`);
		}
		const box = sandbox();
		for (const key of keys) {
			assert.equal(box.env[key], undefined, key);
		}
	} finally {
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	}
});

test("sandbox getTargetPaths scalars stay inside sandbox root", () => {
	const box = sandbox();
	const stateRoots = new Set();
	for (const target of TARGETS) {
		const paths = getTargetPaths({
			target,
			home: box.home,
			env: box.env,
			platform: target === "pi" ? "linux" : process.platform,
		});
		assertTargetPathsContained(box, paths);
		stateRoots.add(paths.stateRoot);
	}
	assert.equal(
		stateRoots.size,
		TARGETS.length,
		"each target must keep a unique state root inside the sandbox",
	);
});

test("sandbox containment rejects symlinked paths outside the root", () => {
	const box = sandbox();
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maister-outside-"));
	const link = path.join(box.root, "pi-agent-link");
	fs.symlinkSync(outside, link, "dir");
	try {
		assert.equal(isContainedBySandbox(box, path.join(link, "nested")), false);
	} finally {
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("sandbox intentional Pi coding-agent overrides stay inside sandbox", () => {
	const box = sandbox();
	const agentOverride = path.join(box.root, "pi-agent-override");
	const sessionOverride = path.join(box.root, "pi-session-override");
	const hostEscape = path.join(os.tmpdir(), "maister-host-escape");
	box.env.PI_CODING_AGENT_DIR = agentOverride;
	box.env.PI_CODING_AGENT_SESSION_DIR = sessionOverride;

	const piPaths = getTargetPaths({
		target: "pi",
		home: box.home,
		env: box.env,
		platform: "linux",
	});
	assertContainedBySandbox(box, piPaths.agentRoot, "agentRoot");
	assertContainedBySandbox(box, piPaths.sessionRoot, "sessionRoot");
	assertContainedBySandbox(box, piPaths.settingsPath, "settingsPath");
	assertContainedBySandbox(box, piPaths.activeRoot, "activeRoot");
	assert.equal(
		isContainedBySandbox({ root: hostEscape }, piPaths.agentRoot),
		false,
		"Pi agent override must not resolve under a host escape root",
	);

	const other = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	assert.notEqual(piPaths.stateRoot, other.stateRoot);
	assertContainedBySandbox(box, other.stateRoot, "codex.stateRoot");
	// ponytail: PI_PACKAGE_DIR intentionally unasserted — production getTargetPaths ignores it
});

test("rejects a staging-parent swap after validation without writing outside the staging root", async () => {
	const box = sandbox();
	const stagingParent = path.join(box.root, "staging-parent");
	const renamedParent = path.join(box.root, "staging-parent-original");
	const outside = path.join(box.root, "outside");
	const stagingRoot = path.join(stagingParent, "candidate");
	fs.mkdirSync(stagingParent, { recursive: true });
	fs.mkdirSync(outside, { recursive: true });
	fs.writeFileSync(path.join(outside, "sentinel.txt"), "outside-original\n");

	try {
		await assert.rejects(
			materialize({
				source: `local:${SOURCE_ROOT}`,
				target: "codex",
				overlayPath: path.join(
					ROOT,
					"plugins/maister/overlays/codex/overlay.yml",
				),
				inventoryPath: path.join(
					ROOT,
					"plugins/maister/overlays/codex/inventory.yml",
				),
				overlayBase: path.join(ROOT, "plugins/maister/overlays/codex"),
				stagingRoot,
				git: cleanGit,
				testHooks: {
					afterStagingParentValidation: () => {
						fs.renameSync(stagingParent, renamedParent);
						fs.symlinkSync(outside, stagingParent, "dir");
					},
				},
			}),
			(error) =>
				error?.kind === "E_MATERIALIZE_SYMLINK" ||
				error?.kind === "E_PATH_SECURITY",
		);
		assert.equal(fs.existsSync(path.join(outside, "candidate")), false);
		assert.equal(
			fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"),
			"outside-original\n",
		);
	} finally {
		fs.rmSync(stagingParent, { recursive: true, force: true });
		fs.rmSync(renamedParent, { recursive: true, force: true });
	}
});

test("state reads reject parent and leaf replacement without following an outside symlink", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const outside = path.join(box.root, "outside-state");
	fs.mkdirSync(outside);
	const sentinel = path.join(outside, "sentinel.txt");
	fs.writeFileSync(sentinel, "outside-original\n");

	const cases = [
		[
			"receipt",
			installed.receipt_path,
			paths.receiptsRoot,
			(filePath, beforeRead) => readReceipt(filePath, { paths, beforeRead }),
			"E_RECEIPT_IO",
		],
		[
			"journal",
			installed.journal_path,
			paths.journalsRoot,
			(filePath, beforeRead) => readJournal(filePath, { paths, beforeRead }),
			"E_JOURNAL_IO",
		],
	];
	for (const [label, filePath, stateRoot, reader, expectedKind] of cases) {
		const movedRoot = `${stateRoot}-original`;
		assert.throws(
			() =>
				reader(filePath, () => {
					fs.renameSync(stateRoot, movedRoot);
					fs.symlinkSync(outside, stateRoot, "dir");
				}),
			(error) => error?.kind === expectedKind,
			`${label} parent replacement after validation`,
		);
		fs.rmSync(stateRoot, { recursive: true, force: true });
		fs.renameSync(movedRoot, stateRoot);

		const movedFile = path.join(outside, `${label}.json`);
		assert.throws(
			() =>
				reader(filePath, () => {
					fs.renameSync(filePath, movedFile);
					fs.symlinkSync(movedFile, filePath);
				}),
			(error) => error?.kind === expectedKind,
			`${label} leaf replacement after validation`,
		);
		fs.rmSync(filePath, { force: true });
		fs.renameSync(movedFile, filePath);
	}
	assert.equal(fs.readFileSync(sentinel, "utf8"), "outside-original\n");
});

test("settings replacement rejects parent and leaf swaps after validation", () => {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "maister-settings-boundary-"),
	);
	const settingsRoot = path.join(root, "settings");
	const targetPath = path.join(settingsRoot, "config.json");
	const outside = path.join(root, "outside");
	fs.mkdirSync(settingsRoot);
	fs.mkdirSync(outside);
	fs.writeFileSync(targetPath, "original\n");
	fs.writeFileSync(path.join(outside, "sentinel.txt"), "outside-original\n");
	try {
		const movedRoot = `${settingsRoot}-original`;
		assert.throws(
			() =>
				atomicWriteSetting(targetPath, Buffer.from("parent-escape\n"), "0640", {
					beforeMutation: () => {
						fs.renameSync(settingsRoot, movedRoot);
						fs.symlinkSync(outside, settingsRoot, "dir");
					},
				}),
			(error) => error?.kind === "E_SETTINGS_PATH",
		);
		fs.rmSync(settingsRoot, { recursive: true, force: true });
		fs.renameSync(movedRoot, settingsRoot);
		assert.equal(
			fs.readFileSync(path.join(settingsRoot, "config.json"), "utf8"),
			"original\n",
		);

		const movedFile = path.join(outside, "config-original.json");
		assert.throws(
			() =>
				atomicWriteSetting(targetPath, Buffer.from("leaf-escape\n"), "0640", {
					beforeMutation: () => {
						fs.renameSync(targetPath, movedFile);
						fs.symlinkSync(movedFile, targetPath);
					},
				}),
			(error) => error?.kind === "E_SETTINGS_PATH",
		);
		fs.rmSync(targetPath, { force: true });
		fs.renameSync(movedFile, targetPath);
		assert.equal(fs.readFileSync(targetPath, "utf8"), "original\n");
		assert.equal(
			fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"),
			"outside-original\n",
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("recovery removal rejects a swapped parent before recursive deletion", () => {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "maister-recovery-boundary-"),
	);
	const parent = path.join(root, "managed");
	const target = path.join(parent, "candidate");
	const outside = path.join(root, "outside");
	const movedParent = `${parent}-original`;
	fs.mkdirSync(target, { recursive: true });
	fs.mkdirSync(outside);
	fs.writeFileSync(path.join(target, "keep.txt"), "keep\n");
	fs.writeFileSync(path.join(outside, "sentinel.txt"), "outside-original\n");
	try {
		assert.throws(
			() =>
				removeEntry(target, {
					root,
					label: "recovery target",
					beforeMutation: () => {
						fs.renameSync(parent, movedParent);
						fs.symlinkSync(outside, parent, "dir");
					},
				}),
			(error) => error?.kind === "E_RECOVERY_PATH",
		);
		fs.rmSync(parent, { recursive: true, force: true });
		fs.renameSync(movedParent, parent);
		assert.equal(
			fs.readFileSync(path.join(parent, "candidate", "keep.txt"), "utf8"),
			"keep\n",
		);
		assert.equal(
			fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"),
			"outside-original\n",
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function recoveryFixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-recovery-"));
	const home = path.join(root, "home");
	const stateRoot = path.join(root, "state");
	const activeRoot = path.join(home, ".codex", "maister");
	const settingsPath = path.join(home, "settings.json");
	const activeReceiptPath = path.join(stateRoot, "active-receipt.json");
	const backupRoot = path.join(stateRoot, "backups", "journal-1");
	const outside = path.join(root, "outside");
	fs.mkdirSync(path.join(activeRoot, "nested"), { recursive: true });
	fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
	fs.mkdirSync(outside, { recursive: true });
	fs.writeFileSync(path.join(outside, "sentinel.txt"), "outside-original\n");
	fs.writeFileSync(
		path.join(activeRoot, "nested", "file.txt"),
		"original-bytes\n",
	);
	fs.chmodSync(path.join(activeRoot, "nested", "file.txt"), 0o640);
	fs.symlinkSync("nested/file.txt", path.join(activeRoot, "link.txt"));
	fs.chmodSync(activeRoot, 0o750);
	fs.writeFileSync(settingsPath, "settings-original\n");
	fs.chmodSync(settingsPath, 0o640);
	fs.writeFileSync(activeReceiptPath, "receipt-original\n");
	fs.chmodSync(activeReceiptPath, 0o600);
	const settings = [{ path: "settings.json", targetPath: settingsPath }];
	const managedRoots = [
		{ rootId: "plugin_private", path: activeRoot, ownership: "whole_tree" },
	];
	const paths = {
		home,
		stateRoot,
		activeRoot,
		activeReceiptPath,
		managedRoots,
	};
	const manifest = snapshotState({
		managedRoots,
		managedInventory: [],
		settings,
		backupRoot,
		activeReceiptPath,
		home,
	});
	return {
		root,
		home,
		stateRoot,
		activeRoot,
		settingsPath,
		activeReceiptPath,
		backupRoot,
		outside,
		paths,
		manifest,
	};
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

function manifestHash(manifest) {
	return crypto
		.createHash("sha256")
		.update(
			canonical({
				schema_version: manifest.schema_version,
				home: manifest.home,
				roots: manifest.roots,
				settings: manifest.settings,
				active_receipt: manifest.active_receipt,
			}),
		)
		.digest("hex");
}

test("historical backup manifests remain readable after the settings root changes", () => {
	const fixture = recoveryFixture();
	const manifestPath = path.join(fixture.backupRoot, "manifest.json");
	const historical = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	historical.settings[0].targetPath = path.join(
		fixture.home,
		"settings/settings.json",
	);
	historical.manifest_hash = manifestHash(historical);
	fs.writeFileSync(manifestPath, `${JSON.stringify(historical, null, 2)}\n`);

	assert.doesNotThrow(() => readManifest(fixture.backupRoot));
	assert.throws(
		() => readManifest(fixture.backupRoot, { paths: fixture.paths }),
		(error) => error?.kind === "E_RECOVERY_BACKUP",
	);
	fs.rmSync(fixture.root, { recursive: true, force: true });
});

test("rejects backup tampering of bytes, modes, symlink targets, types, existence, and topology before restore", () => {
	const cases = [
		[
			"file bytes",
			(fixture) =>
				fs.writeFileSync(
					path.join(fixture.backupRoot, "target", "nested", "file.txt"),
					"tampered-bytes\n",
				),
		],
		[
			"file mode",
			(fixture) =>
				fs.chmodSync(
					path.join(fixture.backupRoot, "target", "nested", "file.txt"),
					0o600,
				),
		],
		[
			"directory mode",
			(fixture) =>
				fs.chmodSync(path.join(fixture.backupRoot, "target", "nested"), 0o700),
		],
		[
			"symlink target",
			(fixture) => {
				fs.writeFileSync(
					path.join(fixture.backupRoot, "target", "alternate.txt"),
					"alternate\n",
				);
				fs.rmSync(path.join(fixture.backupRoot, "target", "link.txt"));
				fs.symlinkSync(
					"alternate.txt",
					path.join(fixture.backupRoot, "target", "link.txt"),
				);
			},
		],
		[
			"entry type",
			(fixture) => {
				fs.rmSync(
					path.join(fixture.backupRoot, "target", "nested", "file.txt"),
				);
				fs.mkdirSync(
					path.join(fixture.backupRoot, "target", "nested", "file.txt"),
				);
			},
		],
		[
			"entry existence",
			(fixture) =>
				fs.rmSync(
					path.join(fixture.backupRoot, "target", "nested", "file.txt"),
				),
		],
		[
			"directory topology",
			(fixture) =>
				fs.writeFileSync(
					path.join(fixture.backupRoot, "target", "unexpected.txt"),
					"unexpected\n",
				),
		],
		[
			"setting mode",
			(fixture) =>
				fs.chmodSync(path.join(fixture.backupRoot, "settings", "0"), 0o600),
		],
		[
			"receipt bytes",
			(fixture) =>
				fs.writeFileSync(
					path.join(fixture.backupRoot, "active-receipt.json"),
					"tampered-receipt\n",
				),
		],
	];

	for (const [name, mutate] of cases) {
		const fixture = recoveryFixture();
		const targetBefore = hashTree(fixture.activeRoot);
		const settingsBefore = fs.readFileSync(fixture.settingsPath);
		const receiptBefore = fs.readFileSync(fixture.activeReceiptPath);
		mutate(fixture);
		assert.throws(
			() => restoreFullBackup(fixture.backupRoot, { paths: fixture.paths }),
			(error) =>
				error?.kind === "E_RECOVERY_BACKUP" ||
				error?.kind === "E_RECOVERY_PATH",
			name,
		);
		assert.deepEqual(hashTree(fixture.activeRoot), targetBefore, name);
		assert.deepEqual(
			fs.readFileSync(fixture.settingsPath),
			settingsBefore,
			name,
		);
		assert.deepEqual(
			fs.readFileSync(fixture.activeReceiptPath),
			receiptBefore,
			name,
		);
		assert.equal(
			fs.readFileSync(path.join(fixture.outside, "sentinel.txt"), "utf8"),
			"outside-original\n",
			name,
		);
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

async function assertCleanLifecycleForTarget(target, box) {
	const paths = getTargetPaths({ target, home: box.home, env: box.env });
	assertTargetPathsContained(box, paths);
	const installed = output(await invoke("install", target, box));
	assert.equal(installed.ok, true, `${target}: ${JSON.stringify(installed)}`);
	assert.equal(installed.code, 0, target);
	const installedReceipt = JSON.parse(
		fs.readFileSync(installed.receipt_path, "utf8"),
	);
	const installedControlPlane = path.join(
		paths.stateRoot,
		installedReceipt.control_plane.root_ref,
	);
	assert.equal(
		fs.existsSync(installedControlPlane),
		true,
		`${target}: control plane missing`,
	);
	assert.equal(
		hashTree(installedControlPlane).contentHash,
		installedReceipt.control_plane.tree_hash,
		`${target}: control plane hash`,
	);
	assert.equal(
		installedReceipt.control_plane.source_commit,
		installedReceipt.source.resolved_commit,
		`${target}: control plane source binding`,
	);
	assert.equal(fs.existsSync(installed.receipt_path), true, target);
	assert.equal(
		fs.existsSync(installed.journal_path),
		true,
		`${target}: journal`,
	);
	assert.equal(
		fs.existsSync(paths.lockPath),
		false,
		`${target}: lock released after success`,
	);
	assertContainedBySandbox(box, installed.receipt_path, `${target}: receipt`);
	assertContainedBySandbox(box, installed.journal_path, `${target}: journal`);
	assertContainedBySandbox(box, paths.stagingRoot, `${target}: stagingRoot`);
	assertContainedBySandbox(
		box,
		installedControlPlane,
		`${target}: controlPlane`,
	);
	assert.equal(fs.existsSync(activePath(box, target)), true, target);
	const verified = output(await invoke("verify", target, box));
	assert.equal(verified.code, 0, target);
	const updated = output(await invoke("update", target, box));
	assert.equal(updated.code, 0, target);
	const rolledBack = output(await invoke("rollback", target, box));
	assert.equal(rolledBack.code, 0, target);
	const recovered = output(await invoke("recover", target, box));
	assert.equal(recovered.code, 0, target);
	const uninstalled = output(await invoke("uninstall", target, box));
	assert.equal(uninstalled.code, 0, target);
	assert.equal(fs.existsSync(activePath(box, target)), false, target);
	assert.equal(fs.existsSync(installed.receipt_path), true, target);
	assertTargetPathsContained(
		box,
		getTargetPaths({ target, home: box.home, env: box.env }),
	);
	return { installed, paths, installedReceipt, installedControlPlane };
}

test("generic matrix contains one Pi entry and routes it on POSIX", () => {
	assert.deepEqual(
		TARGETS.filter((target) => target === "pi"),
		["pi"],
	);
	assert.deepEqual(resolveGenericMatrixEntry("pi"), {
		target: "pi",
		runLifecycle: true,
	});
});

test("clean lifecycle commands have durable receipts for every target seam", async () => {
	for (const target of TARGETS) {
		await runTarget(target, () => assertCleanLifecycleForTarget(target, sandbox()));
	}
});

test("candidate receipts consume the supplied portable-core E3 attestation", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	const attestation = readAttestation(box);
	const e3 = receipt.evidence.find((record) => record.capability === "E3");

	assert.equal(e3.result, "passed");
	assert.equal(e3.timestamp, attestation.tested_at);
	assert.equal(e3.expires_at, attestation.expires_at);
	assert.equal(
		e3.provenance.attestation_digest,
		e3AttestationDigest(attestation),
	);
	assert.equal(
		e3.provenance.portable_core_tree_hash,
		attestation.portable_core_tree_hash,
	);
	assert.equal(e3.provenance.artifact_digest, attestation.artifact_digest);
});

test("durable boundary inventory covers a private receipt-bound control-plane commit", async () => {
	const { DURABLE_BOUNDARY_MARKERS } = await import(
		"../../plugins/maister/lib/distribution/transaction-manager.mjs"
	);
	assert.deepEqual(DURABLE_BOUNDARY_MARKERS, [
		"lock-created",
		"journal-created",
		"target-staged",
		"control-plane-staged",
		"backup-captured",
		"control-plane-promoted",
		"verification-completed",
		"candidate-receipt-written",
		"active-pointer-transitioned",
		"rollback-started",
		"rollback-completed",
		"cleanup-prune-started",
		"cleanup-prune-completed",
		"terminal-journal-written",
	]);

	const box = sandbox();
	const observed = [];
	const result = await executeLifecycle("install", {
		target: "codex",
		source: `local:${box.sourceRoot}`,
		resolvedSourceRoot: box.sourceRoot,
		home: box.home,
		env: box.env,
		git: box.git,
		overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
		e3Attestation: readAttestation(box),
		onDurableBoundary: ({ marker }) => observed.push(marker),
	});
	assert.deepEqual(
		observed,
		DURABLE_BOUNDARY_MARKERS.filter(
			(marker) => !marker.startsWith("rollback-"),
		),
	);

	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const receipt = readReceipt(result.receiptPath, { paths });
	const closureRoot = path.join(
		paths.stateRoot,
		receipt.control_plane.root_ref,
	);
	for (const entry of hashTree(closureRoot).entries) {
		assert.equal(
			entry.mode,
			entry.type === "directory" ? "0700" : "0600",
			entry.path,
		);
	}
	assert.equal(
		(fs.statSync(closureRoot).mode & 0o777).toString(8).padStart(4, "0"),
		"0700",
	);

	const journal = readJournal(result.journalPath, { paths });
	assert.deepEqual(
		journal.steps.map(({ name }) => name),
		[
			"materialize",
			"stage-validated",
			"control-plane-staged",
			"snapshot",
			"control-plane-promoted",
			"commit",
			"integrity",
			"candidate-receipt-written",
			"active-pointer-transition",
			"receipt-published",
			"control-plane-pruned",
		],
	);
});

test("transaction lock rejects live owners and atomically replaces only a validated dead-owner lock", () => {
	const box = sandbox();
	const paths = prepareStateLayout(box, "codex");
	fs.writeFileSync(
		paths.lockPath,
		`${JSON.stringify({ pid: 123, acquired_at: "2026-07-15T00:00:00.000Z" })}\n`,
		{ mode: 0o600 },
	);
	assert.throws(
		() => acquireLock(paths.lockPath, { processKill: () => undefined }),
		{ kind: "E_LOCK_BUSY" },
	);
	const acquired = acquireLock(paths.lockPath, {
		processKill: () => {
			throw Object.assign(new Error("dead"), { code: "ESRCH" });
		},
	});
	assert.equal(
		JSON.parse(fs.readFileSync(paths.lockPath, "utf8")).pid,
		process.pid,
	);
	fs.rmSync(acquired.lockPath);
});

test("terminal cleanup prunes only proven-unreferenced control planes", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	assert.equal(installed.code, 0, JSON.stringify(installed));
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const installedReceipt = readReceipt(installed.receipt_path, { paths });
	const historicalClosure = path.join(
		paths.stateRoot,
		installedReceipt.control_plane.root_ref,
	);
	const orphanId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
	const orphanClosure = path.join(paths.controlPlanesRoot, orphanId);
	fs.mkdirSync(orphanClosure, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(orphanClosure, "orphan"), "unreferenced\n", {
		mode: 0o600,
	});

	const updated = output(await invoke("update", "codex", box));
	assert.equal(updated.code, 0, JSON.stringify(updated));
	const updatedReceipt = readReceipt(updated.receipt_path, { paths });
	assert.equal(
		fs.existsSync(historicalClosure),
		true,
		"history-referenced closure must survive",
	);
	assert.equal(
		fs.existsSync(
			path.join(paths.stateRoot, updatedReceipt.control_plane.root_ref),
		),
		true,
		"active closure must survive",
	);
	assert.equal(
		fs.existsSync(orphanClosure),
		false,
		"proven-unreferenced closure must be pruned",
	);
	const journal = readJournal(updated.journal_path, { paths });
	assert.equal(
		journal.steps.find(({ name }) => name === "control-plane-pruned")?.status,
		"completed",
	);
});

test("install fails closed when the overlay is outside the resolved source root and leaves no target", async () => {
	const box = sandbox();
	const sourceRoot = fs.mkdtempSync(
		path.join(box.root, "source-without-overlay-"),
	);
	fs.cpSync(SOURCE_ROOT, sourceRoot, { recursive: true });
	fs.rmSync(path.join(sourceRoot, "overlay.yml"));
	fs.rmSync(path.join(sourceRoot, "inventory.yml"));
	const sourceGit = {
		topLevel: () => fs.realpathSync(sourceRoot),
		head: () => COMMIT,
		status: () => [],
	};

	try {
		await assert.rejects(
			() =>
				executeLifecycle("install", {
					target: "codex",
					source: `local:${sourceRoot}`,
					resolvedSourceRoot: sourceRoot,
					home: box.home,
					env: box.env,
					git: sourceGit,
					overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
					e3Attestation: readAttestation(box),
				}),
			(error) => error?.kind === "E_OVERLAY_IO",
		);
		assert.equal(fs.existsSync(activePath(box)), false);
		assert.equal(
			fs.existsSync(
				getTargetPaths({ target: "codex", home: box.home, env: box.env })
					.activeReceiptPath,
			),
			false,
		);
	} finally {
		fs.rmSync(sourceRoot, { recursive: true, force: true });
	}
});

test("direct lifecycle rejects split resolved and materialized source roots before state mutation", async () => {
	const box = sandbox();
	const otherSourceRoot = path.join(box.root, "other-source");
	fs.cpSync(box.sourceRoot, otherSourceRoot, { recursive: true });
	fs.appendFileSync(
		path.join(otherSourceRoot, "common/agents/README.md"),
		"\nsource B\n",
	);
	const otherGit = {
		topLevel: () => fs.realpathSync(otherSourceRoot),
		head: () => COMMIT,
		status: () => [],
	};
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	assert.equal(fs.existsSync(paths.stateRoot), false);

	await assert.rejects(
		() =>
			executeLifecycle("install", {
				target: "codex",
				source: `local:${otherSourceRoot}`,
				resolvedSourceRoot: box.sourceRoot,
				home: box.home,
				env: box.env,
				git: otherGit,
				overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
				e3Attestation: readAttestation(box),
			}),
		(error) => error?.kind === "E_SOURCE_ROOT",
	);

	assert.equal(
		fs.existsSync(paths.stateRoot),
		false,
		"binding mismatch must not create lifecycle state",
	);
	assert.equal(
		fs.existsSync(paths.activeRoot),
		false,
		"binding mismatch must not mutate target content",
	);
});

test("direct executeLifecycle rejects a forged portable-core hash before publishing a receipt", async () => {
	const box = sandbox();
	const forged = {
		...readAttestation(box),
		portable_core_tree_hash: "0".repeat(64),
		artifact_digest: "0".repeat(64),
	};

	await assert.rejects(
		() =>
			executeLifecycle("install", {
				target: "codex",
				source: `local:${box.sourceRoot}`,
				resolvedSourceRoot: box.sourceRoot,
				home: box.home,
				env: box.env,
				git: box.git,
				overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
				e3Attestation: forged,
			}),
		(error) => error?.kind === "E_EVIDENCE_ATTESTATION_BINDING",
	);
	assert.equal(fs.existsSync(activePath(box)), false);
	assert.equal(
		fs.existsSync(
			getTargetPaths({ target: "codex", home: box.home, env: box.env })
				.activeReceiptPath,
		),
		false,
	);
});

test("missing, stale, failed, and forged E3 attestations fail before target mutation", async () => {
	const cases = [
		["missing", null],
		[
			"stale",
			(attestation) => ({
				...attestation,
				expires_at: "2026-07-15T00:00:00.000Z",
			}),
		],
		["failed", (attestation) => ({ ...attestation, result: "failed" })],
		[
			"forged",
			(attestation) => ({ ...attestation, source_commit: "f".repeat(40) }),
		],
	];

	for (const [name, mutate] of cases) {
		const box = sandbox();
		const extra = [];
		if (mutate) {
			const forgedPath = path.join(box.root, `${name}-e3.json`);
			fs.writeFileSync(
				forgedPath,
				`${JSON.stringify(mutate(readAttestation(box)), null, 2)}\n`,
			);
			extra.push("--attestation", forgedPath);
		}
		const result = output(
			await runCli(args("install", "codex", box, extra), {
				env: box.env,
				git: box.git,
			}),
		);
		assert.equal(result.code, 4, name);
		assert.equal(fs.existsSync(activePath(box)), false, name);
		assert.equal(
			fs.existsSync(
				getTargetPaths({ target: "codex", home: box.home, env: box.env })
					.activeReceiptPath,
			),
			false,
			name,
		);
	}
});

test("local CLI install honors the explicit dirty-source opt-in during source resolution", async () => {
	const box = sandbox();
	box.git.status = () => [" M local-fix.mjs"];

	const rejected = output(
		await runCli(args("install", "codex", box), { env: box.env, git: box.git }),
	);
	assert.equal(rejected.code, 3);
	assert.equal(rejected.error.kind, "E_SOURCE_DIRTY");

	box.env.MAISTER_ALLOW_DIRTY_LOCAL = "1";
	const installed = output(await invoke("install", "codex", box));
	assert.equal(installed.code, 0, JSON.stringify(installed));
	assert.equal(fs.existsSync(installed.receipt_path), true);
});

test("failed integrity verification leaves no false passed receipt", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const activeBefore = readActiveSnapshot(box);
	const activeReceiptBefore = fs.readFileSync(paths.activeReceiptPath);
	const failed = output(
		await invoke("update", "codex", box, [
			"--failure-point",
			"after-integrity",
		]),
	);
	const journal = JSON.parse(fs.readFileSync(failed.journal_path, "utf8"));

	assert.equal(failed.code, 7);
	assert.equal(journal.state, "recovered");
	assert.equal(journal.candidate_receipt, null);
	assert.equal(
		fs.existsSync(path.join(paths.receiptsRoot, `${journal.journal_id}.json`)),
		false,
	);
	assert.deepEqual(readActiveSnapshot(box), activeBefore);
	assert.deepEqual(
		fs.readFileSync(paths.activeReceiptPath),
		activeReceiptBefore,
	);
	assert.equal(fs.existsSync(installed.receipt_path), true);
});

test("E4 is created after committed integrity and before final receipt publication", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	const journal = JSON.parse(fs.readFileSync(installed.journal_path, "utf8"));
	const integrityIndex = journal.steps.findIndex(
		(step) => step.name === "integrity" && step.status === "completed",
	);
	const publicationIndex = journal.steps.findIndex(
		(step) => step.name === "receipt-published" && step.status === "completed",
	);
	const integrity = journal.steps[integrityIndex];
	const e4 = receipt.evidence.find((record) => record.capability === "E4");

	assert.equal(integrityIndex >= 0, true);
	assert.equal(publicationIndex > integrityIndex, true);
	assert.equal(
		Date.parse(e4.timestamp) >= Date.parse(integrity.timestamp),
		true,
	);
	assert.equal(Date.parse(e4.timestamp), Date.parse(receipt.installed_at));
	assert.equal(fs.existsSync(installed.receipt_path), true);

	const before = readActiveSnapshot(box);
	const interrupted = output(
		await invoke("update", "codex", box, ["--failure-point", "after-e4"]),
	);
	const interruptedJournal = JSON.parse(
		fs.readFileSync(interrupted.journal_path, "utf8"),
	);
	assert.equal(interrupted.code, 7);
	assert.equal(interruptedJournal.state, "failed");
	assert.equal(
		interruptedJournal.candidate_receipt.evidence.find(
			(record) => record.capability === "E4",
		).result,
		"passed",
	);
	assert.equal(
		fs.existsSync(
			path.join(
				getTargetPaths({ target: "codex", home: box.home, env: box.env })
					.receiptsRoot,
				`${interruptedJournal.journal_id}.json`,
			),
		),
		false,
	);
	assert.deepEqual(readActiveSnapshot(box), before);
});

test("update records the prior receipt and preserves unrelated target content", async () => {
	const box = sandbox();
	const first = output(await invoke("install", "codex", box));
	const userFile = path.join(activePath(box), "user-owned.txt");
	fs.writeFileSync(userFile, "keep me\n");
	const second = output(await invoke("update", "codex", box));
	assert.equal(second.code, 0);
	assert.equal(fs.readFileSync(userFile, "utf8"), "keep me\n");
	const receipt = JSON.parse(fs.readFileSync(second.receipt_path, "utf8"));
	assert.equal(
		receipt.transaction.previous_receipt_id,
		JSON.parse(fs.readFileSync(first.receipt_path, "utf8")).receipt_id,
	);
	assert.match(receipt.transaction.backup_manifest_hash, /^[0-9a-f]{64}$/u);
	const manifest = JSON.parse(
		fs.readFileSync(
			path.join(receipt.transaction.backup_root, "manifest.json"),
			"utf8",
		),
	);
	assert.equal(
		receipt.transaction.backup_manifest_hash,
		manifest.manifest_hash,
	);
});

test("rollback fails closed on a tampered transaction backup and preserves the active receipt", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	const updated = output(await invoke("update", "codex", box));
	const activeBefore = readActiveSnapshot(box);
	const receipt = JSON.parse(fs.readFileSync(updated.receipt_path, "utf8"));
	const backupFile = path.join(
		receipt.transaction.backup_root,
		"target",
		".codex-plugin",
		"plugin.json",
	);
	fs.writeFileSync(backupFile, "tampered-backup\n");

	const rolledBack = output(await invoke("rollback", "codex", box));
	assert.equal(rolledBack.code, 7);
	assert.deepEqual(readActiveSnapshot(box), activeBefore);
	const journal = JSON.parse(fs.readFileSync(rolledBack.journal_path, "utf8"));
	assert.equal(journal.state, "rollback_failed");
	assert.equal(
		JSON.parse(
			fs.readFileSync(
				getTargetPaths({ target: "codex", home: box.home, env: box.env })
					.activeReceiptPath,
				"utf8",
			),
		).receipt_id,
		receipt.receipt_id,
	);
});

test("managed Kiro MCP settings drift refuses an update", async () => {
	const box = sandbox();
	await invoke("install", "kiro-cli", box);
	const settings = path.join(box.home, ".kiro/settings/mcp.json");
	const value = JSON.parse(fs.readFileSync(settings, "utf8"));
	value.mcpServers.playwright.command = "drifted";
	fs.writeFileSync(settings, `${JSON.stringify(value, null, 2)}\n`);
	const result = output(await invoke("update", "kiro-cli", box));
	assert.equal(result.code, 5);
	assert.equal(result.error.kind, "E_DRIFT_CONFLICT");
});

test("Codex portable installation preserves native config without claiming its ownership", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	const settings = path.join(box.home, ".codex/config.toml");
	fs.appendFileSync(settings, 'user.preference = "preserve"\n');
	assert.equal(output(await invoke("update", "codex", box)).code, 0);
	assert.match(
		fs.readFileSync(settings, "utf8"),
		/user\.preference = "preserve"/u,
	);
	fs.appendFileSync(settings, "plugins.maister = false\n");
	const result = output(await invoke("update", "codex", box));
	assert.equal(result.code, 0);
});

test("Codex native deployment is receipt-bound across install, update, rollback, verify, and uninstall", async () => {
	const box = sandbox();
	box.env.MAISTER_CODEX_NATIVE_DEPLOYMENT = "1";
	const installedPlugins = new Map();
	const pluginSources = new Map();
	let currentPluginSource = null;
	const run = (command, argumentsList) => {
		if (command !== "codex")
			return { status: 1, stdout: "", stderr: "unexpected command" };
		if (
			argumentsList[0] === "plugin" &&
			argumentsList[1] === "marketplace" &&
			argumentsList[2] === "add"
		) {
			currentPluginSource = path.join(argumentsList[3], "plugins/maister");
			return { status: 0, stdout: "{}", stderr: "" };
		}
		if (argumentsList[0] === "plugin" && argumentsList[1] === "add") {
			const pluginId = argumentsList[2];
			const installedPath = path.join(
				box.root,
				"codex-cache",
				pluginId.replaceAll("@", "-"),
			);
			installedPlugins.set(pluginId, installedPath);
			pluginSources.set(pluginId, currentPluginSource);
			return {
				status: 0,
				stdout: JSON.stringify({ installedPath }),
				stderr: "",
			};
		}
		if (argumentsList[0] === "plugin" && argumentsList[1] === "list") {
			return {
				status: 0,
				stdout: JSON.stringify({
					installed: [...installedPlugins.entries()].map(
						([pluginId, installedPath]) => ({
							pluginId,
							name: "maister",
							installed: true,
							enabled: true,
							source: { path: pluginSources.get(pluginId) },
						}),
					),
					available: [],
				}),
				stderr: "",
			};
		}
		if (argumentsList[0] === "plugin" && argumentsList[1] === "remove") {
			installedPlugins.delete(argumentsList[2]);
			return { status: 0, stdout: "{}", stderr: "" };
		}
		return { status: 0, stdout: "{}", stderr: "" };
	};
	const lifecycle = (command, extra = {}) =>
		executeLifecycle(command, {
			target: "codex",
			source: `local:${box.sourceRoot}`,
			resolvedSourceRoot: box.sourceRoot,
			home: box.home,
			env: box.env,
			git: box.git,
			overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
			e3Attestation: readAttestation(box),
			codexDeploymentRunner: run,
			...extra,
		});

	const first = await lifecycle("install");
	const firstReceipt = JSON.parse(fs.readFileSync(first.receiptPath, "utf8"));
	assert.ok(firstReceipt.native_deployment);
	assert.equal(
		installedPlugins.has(firstReceipt.native_deployment.plugin_id),
		true,
	);

	const updated = await lifecycle("update");
	const updatedReceipt = JSON.parse(
		fs.readFileSync(updated.receiptPath, "utf8"),
	);
	assert.notEqual(
		updatedReceipt.native_deployment.plugin_id,
		firstReceipt.native_deployment.plugin_id,
	);
	assert.equal(
		installedPlugins.has(firstReceipt.native_deployment.plugin_id),
		false,
	);
	assert.equal(
		installedPlugins.has(updatedReceipt.native_deployment.plugin_id),
		true,
	);

	const verified = await lifecycle("verify");
	assert.equal(verified.receipt.receipt_id, updatedReceipt.receipt_id);
	await lifecycle("rollback");
	assert.equal(
		installedPlugins.has(updatedReceipt.native_deployment.plugin_id),
		false,
	);
	assert.equal(
		installedPlugins.has(firstReceipt.native_deployment.plugin_id),
		true,
	);

	await assert.rejects(
		() => lifecycle("update", { failurePoint: "native-deployment-installed" }),
		(error) => error?.kind === "E_TX_FAILURE",
	);
	assert.equal(
		installedPlugins.has(firstReceipt.native_deployment.plugin_id),
		true,
	);

	const uninstalled = await lifecycle("uninstall");
	const uninstalledReceipt = JSON.parse(
		fs.readFileSync(uninstalled.receiptPath, "utf8"),
	);
	assert.equal(uninstalledReceipt.native_deployment, null);
	assert.equal(
		installedPlugins.has(firstReceipt.native_deployment.plugin_id),
		false,
	);
});

test("uninstall drift rejection preserves exact managed tree and native settings state", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	const settings = path.join(box.home, ".codex/config.toml");
	fs.mkdirSync(path.dirname(settings), { recursive: true });
	fs.writeFileSync(settings, 'user.preference = "preserve"\n');
	fs.chmodSync(settings, 0o640);
	const managedFile = path.join(activePath(box), ".codex-plugin/plugin.json");
	fs.appendFileSync(managedFile, "drift\n");
	const beforeTree = readActiveSnapshot(box);
	const beforeSettings = fs.readFileSync(settings);
	const beforeMode = fs.statSync(settings).mode & 0o7777;

	const result = output(await invoke("uninstall", "codex", box));

	assert.equal(result.code, 5);
	assert.equal(result.error.kind, "E_DRIFT_CONFLICT");
	assert.deepEqual(readActiveSnapshot(box), beforeTree);
	assert.deepEqual(fs.readFileSync(settings), beforeSettings);
	assert.equal(fs.statSync(settings).mode & 0o7777, beforeMode);
});

test("a held target lock returns the stable lock-busy code", async () => {
	const box = sandbox();
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true });
	fs.mkdirSync(paths.lockPath);
	fs.writeFileSync(
		path.join(paths.lockPath, "owner.json"),
		JSON.stringify({ pid: process.pid + 1 }),
	);
	const result = output(await invoke("install", "codex", box));
	assert.equal(result.code, 6);
	assert.equal(result.error.kind, "E_LOCK_BUSY");
});

test("failure after snapshot restores a clean pre-install topology", async () => {
	const box = sandbox();
	const result = output(
		await invoke("install", "codex", box, [
			"--failure-point",
			"after-snapshot",
		]),
	);
	assert.equal(result.code, 7);
	assert.equal(fs.existsSync(activePath(box)), false);
	assert.equal(
		fs.readdirSync(
			getTargetPaths({ target: "codex", home: box.home, env: box.env })
				.stagingRoot,
		).length,
		0,
	);
});

test("failure after control-plane promotion removes the uncommitted authority closure", async () => {
	const box = sandbox();
	const result = output(
		await invoke("install", "codex", box, [
			"--failure-point",
			"after-control-plane",
		]),
	);
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	assert.equal(result.code, 7);
	const journal = JSON.parse(fs.readFileSync(result.journal_path, "utf8"));
	assert.equal(journal.state, "recovered");
	assert.equal(
		journal.backup_root,
		path.join(paths.backupsRoot, journal.journal_id),
	);
	assert.match(journal.backup_manifest_hash, /^[0-9a-f]{64}$/u);
	assert.equal(fs.readdirSync(paths.controlPlanesRoot).length, 0);
	assert.equal(fs.existsSync(paths.activeReceiptPath), false);
	assert.equal(fs.existsSync(activePath(box)), false);
});

test("incomplete rollback returns code 7 and preserves every recovery artifact", async () => {
	const box = sandbox();
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	let failure;
	try {
		await executeLifecycle("install", {
			target: "codex",
			source: `local:${box.sourceRoot}`,
			resolvedSourceRoot: box.sourceRoot,
			home: box.home,
			env: box.env,
			git: box.git,
			overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
			e3Attestation: readAttestation(box),
			onDurableBoundary: ({ marker, journal_id: journalId }) => {
				if (marker !== "control-plane-promoted") return;
				fs.appendFileSync(
					path.join(paths.backupsRoot, journalId, "manifest.json"),
					"tampered\n",
				);
				throw new Error("stop after promoted control plane");
			},
		});
	} catch (error) {
		failure = error;
	}

	assert.equal(failure?.kind, "E_RECOVERY_FAILURE");
	const journalPath = failure.details.journal_path;
	const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
	assert.equal(journal.state, "rollback_failed");
	assert.equal(
		fs.existsSync(paths.lockPath),
		true,
		"lock metadata must be retained",
	);
	assert.equal(
		fs.existsSync(journal.stage_root),
		true,
		"staging must be retained",
	);
	assert.equal(
		fs.existsSync(journal.backup_root),
		true,
		"backup must be retained",
	);
	assert.equal(
		fs.existsSync(journal.control_plane.destination_path),
		true,
		"promoted closure must be retained",
	);
	assert.equal(fs.existsSync(journalPath), true, "journal must be retained");
});

test("post-commit prune failure is retryable code 7 and preserves committed recovery state", async () => {
	const box = sandbox();
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	let failure;
	try {
		await executeLifecycle("install", {
			target: "codex",
			source: `local:${box.sourceRoot}`,
			resolvedSourceRoot: box.sourceRoot,
			home: box.home,
			env: box.env,
			git: box.git,
			overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
			e3Attestation: readAttestation(box),
			onDurableBoundary: ({ marker }) => {
				if (marker === "active-pointer-transitioned") {
					fs.mkdirSync(
						path.join(paths.controlPlanesRoot, "unsafe-cleanup-entry"),
					);
				}
			},
		});
	} catch (error) {
		failure = error;
	}

	assert.equal(failure?.kind, "E_RECOVERY_FAILURE");
	assert.equal(failure.retryable, true);
	const journal = readJournal(failure.details.journal_path, { paths });
	assert.equal(journal.state, "verified");
	assert.equal(journal.failure.kind, "E_RECOVERY_FAILURE");
	assert.equal(journal.failure.retryable, true);
	assert.equal(
		journal.steps.find(({ name }) => name === "receipt-published")?.status,
		"completed",
	);
	assert.equal(
		journal.steps.find(({ name }) => name === "control-plane-pruned")?.status,
		"pending",
	);
	assert.equal(fs.existsSync(paths.lockPath), true);
	assert.equal(fs.existsSync(journal.stage_root), true);
	assert.equal(fs.existsSync(journal.control_plane.destination_path), true);
	assert.equal(
		fs.existsSync(path.join(paths.receiptsRoot, `${journal.journal_id}.json`)),
		true,
	);
	assert.equal(
		JSON.parse(fs.readFileSync(paths.activeReceiptPath, "utf8")).receipt_id,
		journal.journal_id,
	);

	const committedHome = snapshotManagedHome(box);
	const committedPointer = snapshotPath(paths.activeReceiptPath);
	fs.rmSync(path.join(paths.controlPlanesRoot, "unsafe-cleanup-entry"), {
		recursive: true,
	});
	const retryOrphan = path.join(
		paths.controlPlanesRoot,
		"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	);
	fs.mkdirSync(retryOrphan, { mode: 0o700 });
	const recovered = await recoverJournal({
		journalPath: failure.details.journal_path,
		journal,
		paths,
		setJournalState: (next) =>
			fs.writeFileSync(
				failure.details.journal_path,
				`${JSON.stringify(next, null, 2)}\n`,
				{ mode: 0o600 },
			),
	});
	assert.equal(recovered.state, "recovered");
	assert.equal(fs.existsSync(retryOrphan), false);
	assert.equal(fs.existsSync(journal.stage_root), false);
	assert.deepEqual(snapshotManagedHome(box), committedHome);
	assert.deepEqual(snapshotPath(paths.activeReceiptPath), committedPointer);
});

test("failure during commit restores exact target bytes, modes, and links", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	const active = activePath(box);
	const linkTarget = path.join(active, "skills/example/SKILL.md");
	const link = path.join(active, "user-link");
	fs.symlinkSync(path.relative(path.dirname(link), linkTarget), link);
	const before = readActiveSnapshot(box);
	const result = output(
		await invoke("update", "codex", box, ["--failure-point", "during-commit"]),
	);
	assert.equal(result.code, 7);
	assert.deepEqual(readActiveSnapshot(box), before);
	assert.equal(
		fs.readlinkSync(link),
		path.relative(path.dirname(link), linkTarget),
	);
});

test("failed journals remain auditable and recovery is idempotent", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const activeBefore = readActiveSnapshot(box);
	const activeReceiptBefore = fs.readFileSync(
		getTargetPaths({ target: "codex", home: box.home, env: box.env })
			.activeReceiptPath,
	);
	clearJournals(box);
	const failed = output(
		await invoke("update", "codex", box, ["--failure-point", "during-commit"]),
	);
	const failedJournal = JSON.parse(
		fs.readFileSync(failed.journal_path, "utf8"),
	);

	assert.equal(failed.code, 7);
	assert.equal(failedJournal.state, "recovered");
	assert.equal(failedJournal.failure.kind, "E_TX_FAILURE");
	assert.equal(failedJournal.candidate_receipt, null);
	assert.equal(
		failedJournal.steps.some(
			(step) => step.name === "recovery" && step.status === "completed",
		),
		true,
	);
	assert.deepEqual(readActiveSnapshot(box), activeBefore);
	assert.deepEqual(
		fs.readFileSync(
			getTargetPaths({ target: "codex", home: box.home, env: box.env })
				.activeReceiptPath,
		),
		activeReceiptBefore,
	);

	const firstRecovery = output(await invoke("recover", "codex", box));
	const recoveredOnce = fs.readFileSync(failed.journal_path);
	const secondRecovery = output(await invoke("recover", "codex", box));
	const recoveredTwice = fs.readFileSync(failed.journal_path);
	assert.equal(firstRecovery.code, 0);
	assert.equal(secondRecovery.code, 0);
	assert.equal(JSON.parse(recoveredOnce).state, "recovered");
	assert.deepEqual(recoveredTwice, recoveredOnce);
	assert.deepEqual(readActiveSnapshot(box), activeBefore);
	assert.equal(fs.existsSync(installed.receipt_path), true);
});

test("recovery removes orphan candidate receipts and staging while retaining the forensic journal and backup", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	clearJournals(box);
	const failed = output(
		await invoke("update", "codex", box, ["--failure-point", "after-receipt"]),
	);
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const journal = JSON.parse(fs.readFileSync(failed.journal_path, "utf8"));
	const candidateReceiptPath = path.join(
		paths.receiptsRoot,
		`${journal.journal_id}.json`,
	);
	assert.equal(fs.existsSync(candidateReceiptPath), true);
	assert.equal(fs.existsSync(journal.stage_root), false);
	assert.equal(
		fs.existsSync(journal.candidate_receipt.transaction.backup_root),
		true,
	);

	const recovered = output(await invoke("recover", "codex", box));
	assert.equal(recovered.code, 0);
	assert.equal(fs.existsSync(candidateReceiptPath), false);
	assert.equal(
		fs.existsSync(journal.candidate_receipt.transaction.backup_root),
		true,
	);
	assert.equal(fs.existsSync(failed.journal_path), true);
	assert.equal(
		JSON.parse(fs.readFileSync(failed.journal_path, "utf8")).state,
		"recovered",
	);
});

test("recover and rollback restore exact prior state and topology", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	const active = activePath(box);
	fs.writeFileSync(path.join(active, "user-owned.txt"), "unmanaged\n");
	const linkTarget = path.join(active, "skills/example/SKILL.md");
	const link = path.join(active, "user-link");
	fs.symlinkSync(path.relative(path.dirname(link), linkTarget), link);
	fs.chmodSync(path.join(active, "user-owned.txt"), 0o751);
	const before = readActiveSnapshot(box);
	clearJournals(box);
	const failed = output(
		await invoke("update", "codex", box, ["--failure-point", "during-commit"]),
	);
	assert.equal(failed.code, 7);
	assert.equal(output(await invoke("recover", "codex", box)).code, 0);
	assert.deepEqual(readActiveSnapshot(box), before);
	const updated = output(await invoke("update", "codex", box));
	assert.equal(updated.code, 0);
	const rolledBack = output(await invoke("rollback", "codex", box));
	assert.equal(rolledBack.code, 0);
	assert.deepEqual(readActiveSnapshot(box), before);
	assert.equal(
		fs.readFileSync(path.join(active, "user-owned.txt"), "utf8"),
		"unmanaged\n",
	);
	assert.equal(
		fs.readlinkSync(link),
		path.relative(path.dirname(link), linkTarget),
	);
	assert.match(
		crypto
			.createHash("sha256")
			.update(JSON.stringify(rolledBack))
			.digest("hex"),
		/^[0-9a-f]{64}$/u,
	);
});

test("rejects symlink escapes at target, state, settings, and staging boundaries", async () => {
	const cases = [
		{
			name: "target parent",
			setup: (box, outside) => {
				const parent = path.join(box.home, ".codex/plugins");
				fs.mkdirSync(parent, { recursive: true });
				fs.symlinkSync(outside, path.join(parent, "local"));
			},
		},
		{
			name: "state root",
			setup: (box, outside) => {
				const paths = getTargetPaths({
					target: "codex",
					home: box.home,
					env: box.env,
				});
				fs.mkdirSync(path.dirname(paths.stateRoot), {
					recursive: true,
					mode: 0o700,
				});
				fs.symlinkSync(outside, paths.stateRoot);
			},
		},
		{
			name: "staging root",
			setup: (box, outside) => {
				const paths = getTargetPaths({
					target: "codex",
					home: box.home,
					env: box.env,
				});
				fs.mkdirSync(path.dirname(paths.stagingRoot), {
					recursive: true,
					mode: 0o700,
				});
				fs.symlinkSync(outside, paths.stagingRoot);
			},
		},
	];
	for (const scenario of cases) {
		const box = sandbox();
		const outside = path.join(
			box.root,
			`${scenario.name.replaceAll(" ", "-")}-outside`,
		);
		fs.mkdirSync(outside, { recursive: true });
		const sentinel = path.join(outside, "sentinel");
		fs.writeFileSync(sentinel, "must remain untouched\n");
		scenario.setup(box, outside);
		const result = output(await invoke("install", "codex", box));
		assert.notEqual(result.code, 0, scenario.name);
		assert.equal(
			fs.readFileSync(sentinel, "utf8"),
			"must remain untouched\n",
			scenario.name,
		);
		assert.equal(fs.readdirSync(outside).length, 1, scenario.name);
	}
});

test("rejects untrusted active receipt paths and strict receipt tampering", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const outside = path.join(box.root, "outside");
	fs.mkdirSync(outside, { recursive: true });
	const pointer = JSON.parse(fs.readFileSync(paths.activeReceiptPath, "utf8"));
	fs.writeFileSync(
		paths.activeReceiptPath,
		JSON.stringify({
			...pointer,
			receipt_path: path.join(outside, "receipt.json"),
		}),
	);
	const status = output(await invoke("status", "codex", box));
	assert.notEqual(status.code, 0);
	assert.equal(status.error.kind, "E_RECEIPT_SCHEMA");

	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	assert.throws(
		() =>
			validateReceipt(
				{
					...receipt,
					managed_inventory: [
						{ ...receipt.managed_inventory[0], path: "../escape" },
					],
				},
				{ paths },
			),
		/E_RECEIPT_SCHEMA/u,
	);
	assert.throws(
		() =>
			validateReceipt(
				{
					...receipt,
					managed_inventory: [
						{ ...receipt.managed_inventory[0], sha256: "bad" },
					],
				},
				{ paths },
			),
		/E_RECEIPT_SCHEMA/u,
	);
	assert.throws(
		() => validateReceipt({ ...receipt, unexpected: true }, { paths }),
		/E_RECEIPT_SCHEMA/u,
	);
});

test("preserves existing settings mode and keeps transaction state private", async () => {
	const box = sandbox();
	const settings = path.join(box.home, ".codex/config.toml");
	fs.mkdirSync(path.dirname(settings), { recursive: true });
	fs.writeFileSync(settings, 'user.preference = "preserve"\n');
	await invoke("install", "codex", box);
	fs.chmodSync(settings, 0o640);
	assert.equal(output(await invoke("update", "codex", box)).code, 0);
	assert.equal(fs.statSync(settings).mode & 0o7777, 0o640);
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	for (const directory of [
		paths.stateRoot,
		paths.journalsRoot,
		paths.receiptsRoot,
		paths.backupsRoot,
		paths.stagingRoot,
	]) {
		assert.equal(fs.statSync(directory).mode & 0o077, 0, directory);
	}
	for (const directory of [paths.journalsRoot, paths.receiptsRoot]) {
		for (const file of fs.readdirSync(directory))
			assert.equal(
				fs.statSync(path.join(directory, file)).mode & 0o077,
				0,
				file,
			);
	}
});

test("ambiguous recovery fails closed and exact journal recovery isolates unselected state", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	clearJournals(box);
	const first = output(
		await invoke("update", "codex", box, ["--failure-point", "after-e4"]),
	);
	const second = output(
		await invoke("update", "codex", box, ["--failure-point", "after-e4"]),
	);
	assert.equal(first.code, 7);
	assert.equal(second.code, 7);
	const interrupted = JSON.parse(fs.readFileSync(second.journal_path, "utf8"));
	const timestamp = new Date(Date.now() + 1000).toISOString();
	interrupted.state = "verified";
	interrupted.updated_at = timestamp;
	interrupted.state_history = interrupted.state_history.filter(
		(entry) => entry.state !== "failed",
	);
	interrupted.state_history.at(-1).timestamp = timestamp;
	interrupted.failure = null;
	fs.writeFileSync(
		second.journal_path,
		`${JSON.stringify(interrupted, null, 2)}\n`,
	);
	fs.writeFileSync(path.join(activePath(box), "partial-write"), "remove me\n");

	const beforeAmbiguous = snapshotStateRoot(box, "codex");
	const ambiguous = output(await invoke("recover", "codex", box));
	assert.equal(ambiguous.code, 7);
	assert.equal(ambiguous.error.kind, "E_RECOVERY_AMBIGUOUS");
	assert.deepEqual(snapshotStateRoot(box, "codex"), beforeAmbiguous);

	const firstBeforeSelectedRecovery = snapshotPath(first.journal_path);
	const recoveredNewest = output(
		await invoke("recover", "codex", box, [
			"--journal-id",
			interrupted.journal_id,
		]),
	);
	assert.equal(recoveredNewest.code, 0);
	assert.equal(
		path.resolve(recoveredNewest.journal_path),
		path.resolve(second.journal_path),
	);
	assert.equal(
		JSON.parse(fs.readFileSync(second.journal_path, "utf8")).state,
		"recovered",
	);
	assert.equal(
		fs.existsSync(path.join(activePath(box), "partial-write")),
		false,
	);
	assert.deepEqual(
		snapshotPath(first.journal_path),
		firstBeforeSelectedRecovery,
	);

	const recoveredOlder = output(
		await invoke("recover", "codex", box, [
			"--journal-id",
			JSON.parse(fs.readFileSync(first.journal_path, "utf8")).journal_id,
		]),
	);
	assert.equal(recoveredOlder.code, 0);
	assert.equal(
		JSON.parse(fs.readFileSync(first.journal_path, "utf8")).state,
		"recovered",
	);
});

test("records a guarded rollback failure instead of leaving a prepared journal", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	const updated = output(await invoke("update", "codex", box));
	const receipt = JSON.parse(fs.readFileSync(updated.receipt_path, "utf8"));
	fs.rmSync(receipt.transaction.backup_root, { recursive: true, force: true });
	const result = output(await invoke("rollback", "codex", box));
	assert.notEqual(result.code, 0);
	assert.equal(result.error.kind, "E_RECOVERY_FAILURE");
	assert.equal(
		JSON.parse(fs.readFileSync(result.journal_path, "utf8")).state,
		"rollback_failed",
	);
});

test("rejects illegal persisted journal transitions and malformed paths", async () => {
	const box = sandbox();
	await invoke("install", "codex", box);
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const journalPath = fs
		.readdirSync(paths.journalsRoot)
		.map((file) => path.join(paths.journalsRoot, file))
		.find((file) => file.endsWith(".json"));
	const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
	assert.throws(
		() =>
			validateJournal(
				{ ...journal, destination_root: path.join(paths.home, "../escape") },
				{ paths },
			),
		/E_JOURNAL_SCHEMA/u,
	);
	assert.throws(
		() =>
			validateJournal(
				{
					...journal,
					state: "prepared",
					state_history: [
						...journal.state_history,
						{ state: "prepared", timestamp: new Date().toISOString() },
					],
				},
				{ paths },
			),
		/E_JOURNAL_SCHEMA/u,
	);
});

test("candidate receipts bind complete provenance hashes to collected and evaluated E1-E6 evidence", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	const hashFields = [
		"source_hash",
		"overlay_hash",
		"materialized_hash",
		"provenance_hash",
	];

	assert.equal(receipt.target.overlay_id, "maister/codex");
	assert.deepEqual(Object.keys(receipt.provenance), [
		...hashFields,
		"agent_projection",
	]);
	for (const field of hashFields)
		assert.match(receipt.provenance[field], /^[0-9a-f]{64}$/u);
	assert.equal(receipt.source.content_hash, receipt.provenance.source_hash);
	assert.deepEqual(
		receipt.evidence.map((record) => record.capability),
		["E1", "E2", "E3", "E4", "E5", "E6"],
	);
	for (const record of receipt.evidence) {
		for (const field of hashFields)
			assert.equal(
				record.provenance[field],
				receipt.provenance[field],
				`${record.capability}.${field}`,
			);
		assert.equal(
			record.provenance.source_commit,
			receipt.source.resolved_commit,
		);
		assert.equal(
			record.provenance.source_version,
			receipt.source.source_version,
		);
		assert.equal(
			record.provenance.overlay_version,
			receipt.target.overlay_version,
		);
		assert.equal(
			record.provenance.scenario_version,
			receipt.compatibility.scenario_version,
		);
	}

	const byCapability = Object.fromEntries(
		receipt.compatibility.evaluations.map((evaluation) => [
			evaluation.capability,
			evaluation,
		]),
	);
	assert.equal(byCapability.safety_hooks.status, "passed");
	assert.equal(byCapability.state_persistence.status, "passed");
	assert.equal(byCapability.rollback.status, "passed");
	assert.equal(byCapability.native_discovery.status, "provisional");
	assert.equal(byCapability.semantic_bindings.status, "blocked");
	assert.equal(byCapability.native_runtime.status, "blocked");
	assert.equal(receipt.compatibility.status, "provisional");
	assert.deepEqual(
		receipt.evidence
			.filter((record) => ["E5", "E6"].includes(record.capability))
			.map((record) => record.result),
		["unavailable", "unavailable"],
	);
	for (const evaluation of receipt.compatibility.evaluations) {
		assert.equal(
			evaluation.passedEvidence.includes("E5") ||
				evaluation.passedEvidence.includes("E6"),
			false,
			evaluation.capability,
		);
	}
	assert.doesNotThrow(() => validateReceipt(receipt, { paths }));
});

test("receipt validation rejects tampered evidence, hashes, and evaluation promotion", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const paths = getTargetPaths({
		target: "codex",
		home: box.home,
		env: box.env,
	});
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));

	const tamperedEvidence = {
		...receipt,
		evidence: receipt.evidence.map((record) =>
			record.capability === "E4" ? { ...record, result: "failed" } : record,
		),
	};
	assert.throws(
		() => validateReceipt(tamperedEvidence, { paths }),
		/E_RECEIPT_SCHEMA/u,
	);

	const tamperedHash = {
		...receipt,
		provenance: { ...receipt.provenance, materialized_hash: "0".repeat(64) },
	};
	assert.throws(
		() => validateReceipt(tamperedHash, { paths }),
		/E_RECEIPT_SCHEMA/u,
	);

	const promotedUnavailable = {
		...receipt,
		evidence: receipt.evidence.map((record) =>
			record.capability === "E5"
				? {
						...record,
						result: "passed",
						provenance: { ...record.provenance, reason: undefined },
					}
				: record,
		),
	};
	assert.throws(
		() => validateReceipt(promotedUnavailable, { paths }),
		/E_RECEIPT_SCHEMA/u,
	);

	const unknownEvidenceField = {
		...receipt,
		evidence: receipt.evidence.map((record) =>
			record.capability === "E6" ? { ...record, unexpected: true } : record,
		),
	};
	assert.throws(
		() => validateReceipt(unknownEvidenceField, { paths }),
		/E_RECEIPT_SCHEMA/u,
	);

	const missingEvaluations = {
		...receipt,
		compatibility: { ...receipt.compatibility, evaluations: [] },
	};
	assert.throws(
		() => validateReceipt(missingEvaluations, { paths }),
		/E_RECEIPT_SCHEMA/u,
	);
});

test("supplied native evidence is accepted only when all provenance hashes match", async () => {
	const box = sandbox();
	const first = output(await invoke("install", "codex", box));
	const previous = JSON.parse(fs.readFileSync(first.receipt_path, "utf8"));
	const provenance = {
		source_commit: previous.source.resolved_commit,
		source_version: previous.source.source_version,
		overlay_version: previous.target.overlay_version,
		overlay_id: previous.target.overlay_id,
		host: previous.target.id,
		scenario_version: previous.compatibility.scenario_version,
		schema_version: previous.provenance.agent_projection.schema_version,
		projector_version: previous.provenance.agent_projection.projector_version,
		canonical_set_digest:
			previous.provenance.agent_projection.canonical_set_digest,
		manifest_digest: previous.provenance.agent_projection.manifest_digest,
		projected_tree_digest:
			previous.provenance.agent_projection.projected_tree_digest,
		source_hash: previous.provenance.source_hash,
		overlay_hash: previous.provenance.overlay_hash,
		materialized_hash: previous.provenance.materialized_hash,
		provenance_hash: previous.provenance.provenance_hash,
	};
	const timestamp = new Date().toISOString();
	const nativeEvidence = [
		createEvidenceRecord({
			target: "codex",
			capability: "E5",
			hostVersion: previous.target.host_version,
			scenario: "native-discovery-v1",
			result: "passed",
			provenance,
			timestamp,
		}),
		createEvidenceRecord({
			target: "codex",
			capability: "E6",
			hostVersion: previous.target.host_version,
			scenario: "native-runtime-v1",
			result: "passed",
			provenance,
			timestamp,
		}),
	];
	const updated = await executeLifecycle("update", {
		target: "codex",
		source: `local:${box.sourceRoot}`,
		resolvedSourceRoot: box.sourceRoot,
		sourceVersion: previous.source.source_version,
		hostVersion: previous.target.host_version,
		home: box.home,
		env: box.env,
		git: box.git,
		overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
		evidenceRecords: nativeEvidence,
		e3Attestation: readAttestation(box),
	});
	const receipt = JSON.parse(fs.readFileSync(updated.receiptPath, "utf8"));
	assert.equal(receipt.compatibility.status, "supported");
	assert.equal(
		receipt.evidence.every((record) => record.result === "passed"),
		true,
	);
	assert.equal(
		receipt.compatibility.evaluations.every(
			(evaluation) => evaluation.status === "passed",
		),
		true,
	);
	assert.doesNotThrow(() =>
		validateReceipt(receipt, {
			paths: getTargetPaths({ target: "codex", home: box.home, env: box.env }),
		}),
	);
});

test("offline provisional packaging is explicit and strict policy fails closed without native evidence", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	assert.equal(receipt.compatibility.policy, "offline-provisional");
	assert.equal(receipt.compatibility.status, "provisional");
	assert.equal(
		receipt.evidence.find((record) => record.capability === "E5").result,
		"unavailable",
	);
	assert.equal(
		receipt.evidence.find((record) => record.capability === "E6").result,
		"unavailable",
	);

	const strictBox = sandbox();
	await assert.rejects(
		() =>
			executeLifecycle("install", {
				target: "codex",
				source: `local:${strictBox.sourceRoot}`,
				resolvedSourceRoot: strictBox.sourceRoot,
				home: strictBox.home,
				env: strictBox.env,
				git: strictBox.git,
				overlayRoot: path.join(ROOT, "plugins/maister/overlays"),
				releasePolicy: "strict",
				e3Attestation: readAttestation(strictBox),
			}),
		(error) => error?.kind === "E_EVIDENCE_POLICY",
	);
	assert.equal(fs.existsSync(activePath(strictBox)), false);
});

test("receipt provenance and evidence survive update, exact rollback, and uninstall lifecycle", async () => {
	const box = sandbox();
	const first = output(await invoke("install", "codex", box));
	const firstReceipt = JSON.parse(fs.readFileSync(first.receipt_path, "utf8"));
	const updated = output(await invoke("update", "codex", box));
	const updatedReceipt = JSON.parse(
		fs.readFileSync(updated.receipt_path, "utf8"),
	);
	assert.deepEqual(updatedReceipt.provenance, firstReceipt.provenance);
	assert.deepEqual(
		updatedReceipt.evidence.map((record) => record.capability),
		firstReceipt.evidence.map((record) => record.capability),
	);

	const rolledBack = output(await invoke("rollback", "codex", box));
	const rolledBackReceipt = JSON.parse(
		fs.readFileSync(rolledBack.receipt_path, "utf8"),
	);
	assert.deepEqual(rolledBackReceipt.provenance, firstReceipt.provenance);
	assert.deepEqual(rolledBackReceipt.evidence, firstReceipt.evidence);
	assert.deepEqual(rolledBackReceipt.compatibility, firstReceipt.compatibility);

	const uninstalled = output(await invoke("uninstall", "codex", box));
	const uninstalledReceipt = JSON.parse(
		fs.readFileSync(uninstalled.receipt_path, "utf8"),
	);
	assert.equal(uninstalledReceipt.status, "uninstalled");
	assert.deepEqual(uninstalledReceipt.provenance, rolledBackReceipt.provenance);
	assert.deepEqual(uninstalledReceipt.evidence, rolledBackReceipt.evidence);
	assert.deepEqual(
		uninstalledReceipt.compatibility,
		rolledBackReceipt.compatibility,
	);
});

test("receipt and journal v2 bind managed roots, root-scoped inventory, and projection provenance", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "kiro-cli", box));
	const paths = getTargetPaths({
		target: "kiro-cli",
		home: box.home,
		env: box.env,
	});
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	const journal = JSON.parse(fs.readFileSync(installed.journal_path, "utf8"));

	assert.equal(receipt.schema_version, 2);
	assert.equal(journal.schema_version, 2);
	assert.deepEqual(
		receipt.managed_roots,
		paths.managedRoots.map(({ rootId, path: rootPath, ownership }) => ({
			root_id: rootId,
			path: rootPath,
			ownership,
		})),
	);
	assert.deepEqual(journal.managed_roots, receipt.managed_roots);
	assert.equal(
		receipt.managed_inventory.every(
			(entry) => typeof entry.root_id === "string",
		),
		true,
	);
	assert.equal(
		new Set(
			receipt.managed_inventory.map(
				(entry) => `${entry.root_id}\0${entry.path}`,
			),
		).size,
		receipt.managed_inventory.length,
	);
	assert.deepEqual(
		receipt.provenance.agent_projection,
		journal.candidate_receipt.provenance.agent_projection,
	);
	assert.deepEqual(Object.keys(receipt.provenance.agent_projection), [
		"schema_version",
		"projector_version",
		"canonical_set_digest",
		"manifest_digest",
		"projected_tree_digest",
	]);
	assert.doesNotThrow(() => validateReceipt(receipt, { paths }));
	assert.doesNotThrow(() => validateJournal(journal, { paths }));
});

test("Kiro installs canonical and support leaves into the managed Kiro root only", async () => {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	const installed = output(await invoke("install", "kiro-cli", box));
	assert.equal(installed.code, 0, JSON.stringify(installed));
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	const nativeRoot = managedRootPath(box, "kiro-cli", "plugin_private");

	assert.equal(
		fs.existsSync(path.join(nativeRoot, "agents/maister-advisor.json")),
		true,
	);
	assert.equal(
		fs.existsSync(
			path.join(nativeRoot, "agents/instructions/maister-advisor.md"),
		),
		true,
	);
	assert.equal(
		fs.existsSync(path.join(nativeRoot, "agents/maister.json")),
		true,
	);
	assert.equal(
		fs.existsSync(path.join(nativeRoot, "agents/instructions/maister.md")),
		true,
	);
	assert.equal(
		receipt.managed_inventory.filter(
			(entry) => entry.root_id === "plugin_private",
		).length,
		77,
	);
	assert.equal(
		receipt.managed_inventory.some(
			(entry) =>
				entry.root_id === "plugin_private" && entry.path.startsWith("agents/"),
		),
		true,
	);
	assertUnrelatedKiroContent(box, unrelated);
});

test("Kiro installs settings under the native Kiro settings root", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "kiro-cli", box));
	const nativeMcpSettings = path.join(box.home, ".kiro/settings/mcp.json");
	const nativeSettings = path.join(box.home, ".kiro/settings/settings.json");

	assert.equal(installed.code, 0, JSON.stringify(installed));
	assert.equal(fs.existsSync(nativeMcpSettings), true);
	assert.equal(fs.existsSync(nativeSettings), true);
	assert.equal(fs.existsSync(path.join(box.home, "settings/mcp.json")), false);
	assert.equal(
		fs.existsSync(path.join(box.home, "settings/settings.json")),
		false,
	);
	assert.equal(
		JSON.parse(fs.readFileSync(nativeSettings, "utf8")).chat.defaultAgent,
		"maister",
	);
});

test("Kiro preserves existing native MCP settings while managing Maister's server", async () => {
	const box = sandbox();
	const nativeMcpSettings = path.join(box.home, ".kiro/settings/mcp.json");
	fs.mkdirSync(path.dirname(nativeMcpSettings), { recursive: true });
	fs.writeFileSync(
		nativeMcpSettings,
		`${JSON.stringify(
			{
				mcpServers: {
					"user-owned": { command: "user-tool" },
				},
			},
			null,
			2,
		)}\n`,
	);

	const installed = output(await invoke("install", "kiro-cli", box));
	const settings = JSON.parse(fs.readFileSync(nativeMcpSettings, "utf8"));

	assert.equal(installed.code, 0, JSON.stringify(installed));
	assert.deepEqual(settings.mcpServers["user-owned"], { command: "user-tool" });
	assert.deepEqual(settings.mcpServers.playwright, {
		command: "npx",
		args: ["@playwright/mcp@latest"],
	});
});

test("status and verify both detect drift in a Kiro native managed leaf", async () => {
	const box = sandbox();
	await invoke("install", "kiro-cli", box);
	const nativeLeaf = path.join(
		managedRootPath(box, "kiro-cli", "plugin_private"),
		"agents/maister-advisor.json",
	);
	fs.appendFileSync(nativeLeaf, "\n");

	for (const command of ["status", "verify"]) {
		const result = output(await invoke(command, "kiro-cli", box));
		assert.equal(result.code, 5, command);
		assert.equal(result.error.kind, "E_DRIFT_CONFLICT", command);
	}
});

test("byte-identical unmanaged Kiro native leaves collide before any mutation", async () => {
	const sourceBox = sandbox();
	await invoke("install", "kiro-cli", sourceBox);
	const identicalBytes = fs.readFileSync(
		path.join(
			managedRootPath(sourceBox, "kiro-cli", "plugin_private"),
			"agents/maister-advisor.json",
		),
	);

	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	const paths = prepareStateLayout(box);
	fs.writeFileSync(
		path.join(
			paths.managedRoots.find(({ rootId }) => rootId === "plugin_private").path,
			"agents/maister-advisor.json",
		),
		identicalBytes,
	);
	const homeBefore = snapshotManagedHome(box);
	const stateBefore = snapshotStateRoot(box);

	const result = output(await invoke("install", "kiro-cli", box));
	assert.equal(result.code, 5);
	assert.equal(result.error.kind, "E_DRIFT_CONFLICT");
	assert.deepEqual(snapshotManagedHome(box), homeBefore);
	assert.deepEqual(snapshotStateRoot(box), stateBefore);
	assert.equal(fs.existsSync(paths.lockPath), false);
	assert.equal(fs.readdirSync(paths.journalsRoot).length, 0);
	assertUnrelatedKiroContent(box, unrelated);
});

test("update removes an unchanged receipt-owned stale Kiro leaf", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "kiro-cli", box));
	const stalePath = addReceiptOwnedStaleLeaf(
		installed.receipt_path,
		managedRootPath(box, "kiro-cli", "plugin_private"),
		{ path: "agents/maister-stale.json", bytes: Buffer.from("stale-owned\n") },
	);

	const updated = output(await invoke("update", "kiro-cli", box));
	assert.equal(updated.code, 0);
	assert.equal(fs.existsSync(stalePath), false);
	const receipt = JSON.parse(fs.readFileSync(updated.receipt_path, "utf8"));
	assert.equal(
		receipt.managed_inventory.some(
			(entry) =>
				entry.root_id === "plugin_private" &&
				entry.path === "agents/maister-stale.json",
		),
		false,
	);
});

test("modified receipt-owned stale Kiro leaves fail update with zero mutation", async () => {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	const installed = output(await invoke("install", "kiro-cli", box));
	const stalePath = addReceiptOwnedStaleLeaf(
		installed.receipt_path,
		managedRootPath(box, "kiro-cli", "plugin_private"),
		{
			path: "agents/maister-stale.json",
			bytes: Buffer.from("receipt-owned\n"),
		},
	);
	fs.writeFileSync(stalePath, "operator-modified\n");
	const homeBefore = snapshotManagedHome(box);
	const stateBefore = snapshotStateRoot(box);

	const result = output(await invoke("update", "kiro-cli", box));
	assert.equal(result.code, 5);
	assert.equal(result.error.kind, "E_DRIFT_CONFLICT");
	assert.deepEqual(snapshotManagedHome(box), homeBefore);
	assert.deepEqual(snapshotStateRoot(box), stateBefore);
	assertUnrelatedKiroContent(box, unrelated);
});

test("Kiro uninstall removes only receipt-owned leaves and restores minimum parent topology", async () => {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	await invoke("install", "kiro-cli", box);
	const nativeRoot = managedRootPath(box, "kiro-cli", "plugin_private");

	const result = output(await invoke("uninstall", "kiro-cli", box));
	assert.equal(result.code, 0);
	assert.equal(
		fs.existsSync(path.join(nativeRoot, "agents/maister-advisor.json")),
		false,
	);
	assert.equal(
		fs.existsSync(
			path.join(nativeRoot, "agents/instructions/maister-advisor.md"),
		),
		false,
	);
	assert.equal(
		fs.existsSync(path.join(nativeRoot, "agents/maister.json")),
		false,
	);
	assert.equal(
		fs.existsSync(nativeRoot),
		true,
		"operator-owned siblings keep the shared native root present",
	);
	assertUnrelatedKiroContent(box, unrelated);
});

test("Kiro rollback restores the managed root while preserving unrelated native agents", async () => {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	await invoke("install", "kiro-cli", box);
	const before = snapshotManagedHome(box);
	await invoke("update", "kiro-cli", box);

	const rolledBack = output(await invoke("rollback", "kiro-cli", box));
	assert.equal(rolledBack.code, 0);
	assert.deepEqual(snapshotManagedHome(box), before);
	assertUnrelatedKiroContent(box, unrelated);
});

test("persisted v1 active receipt state is rejected before lifecycle mutation", async () => {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	const paths = prepareStateLayout(box);
	const receiptId = "00000000-0000-4000-8000-000000000001";
	const receiptPath = path.join(paths.receiptsRoot, `${receiptId}.json`);
	fs.writeFileSync(
		receiptPath,
		`${JSON.stringify({ schema_version: 1, receipt_id: receiptId })}\n`,
	);
	fs.writeFileSync(
		paths.activeReceiptPath,
		`${JSON.stringify({ schema_version: 1, receipt_id: receiptId, receipt_path: receiptPath })}\n`,
	);
	const homeBefore = snapshotManagedHome(box);
	const stateBefore = snapshotStateRoot(box);

	const result = output(await invoke("install", "kiro-cli", box));
	assert.equal(result.code, 4);
	assert.equal(result.error.kind, "E_CLEAN_INSTALL_REQUIRED");
	assert.match(result.message, /clean install/i);
	assert.deepEqual(snapshotManagedHome(box), homeBefore);
	assert.deepEqual(snapshotStateRoot(box), stateBefore);
	assertUnrelatedKiroContent(box, unrelated);
});

test("control-plane-less receipts reject state commands and migrate only through verified update", async () => {
	const box = sandbox();
	const installed = output(await invoke("install", "codex", box));
	assert.equal(installed.code, 0);
	const receipt = JSON.parse(fs.readFileSync(installed.receipt_path, "utf8"));
	delete receipt.control_plane;
	fs.writeFileSync(
		installed.receipt_path,
		`${JSON.stringify(receipt, null, 2)}\n`,
		{ mode: 0o600 },
	);

	const beforeStatus = snapshotStateRoot(box, "codex");
	const status = output(await invoke("status", "codex", box));
	assert.equal(status.code, 7);
	assert.equal(status.error.kind, "E_OFFLINE_AUTHORITY_MIGRATION");
	assert.deepEqual(snapshotStateRoot(box, "codex"), beforeStatus);

	const updated = output(await invoke("update", "codex", box));
	assert.equal(updated.code, 0, JSON.stringify(updated));
	const migrated = readReceipt(updated.receipt_path, {
		paths: getTargetPaths({ target: "codex", home: box.home, env: box.env }),
	});
	assert.equal(
		migrated.control_plane.root_ref,
		`control-planes/${migrated.receipt_id}`,
	);
});

test("persisted v1 journal state is rejected before lock or recovery mutation", async () => {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	const paths = prepareStateLayout(box);
	fs.writeFileSync(
		path.join(paths.journalsRoot, "00000000-0000-4000-8000-000000000001.json"),
		`${JSON.stringify({ schema_version: 1 })}\n`,
	);
	const homeBefore = snapshotManagedHome(box);
	const stateBefore = snapshotStateRoot(box);

	const result = output(await invoke("recover", "kiro-cli", box));
	assert.equal(result.code, 4);
	assert.equal(result.error.kind, "E_CLEAN_INSTALL_REQUIRED");
	assert.deepEqual(snapshotManagedHome(box), homeBefore);
	assert.deepEqual(snapshotStateRoot(box), stateBefore);
	assert.equal(fs.existsSync(paths.lockPath), false);
	assertUnrelatedKiroContent(box, unrelated);
});

async function assertKiroFailureRestores(point) {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	await invoke("install", "kiro-cli", box);
	clearJournals(box, "kiro-cli");
	const paths = getTargetPaths({
		target: "kiro-cli",
		home: box.home,
		env: box.env,
	});
	const homeBefore = snapshotManagedHome(box);
	const activeReceiptBefore = fs.readFileSync(paths.activeReceiptPath);

	const result = output(
		await invoke("update", "kiro-cli", box, ["--failure-point", point]),
	);
	assert.equal(result.code, 7, point);
	assert.deepEqual(snapshotManagedHome(box), homeBefore, point);
	assert.deepEqual(
		fs.readFileSync(paths.activeReceiptPath),
		activeReceiptBefore,
		point,
	);
	assert.equal(fs.existsSync(result.journal_path), true, point);
	assert.equal(
		fs.existsSync(
			JSON.parse(fs.readFileSync(result.journal_path, "utf8")).candidate_receipt
				?.transaction?.backup_root ?? path.dirname(result.journal_path),
		),
		true,
		point,
	);
	assertUnrelatedKiroContent(box, unrelated);
}

test("Kiro failure after snapshot restores every root and unrelated leaf", async () => {
	await assertKiroFailureRestores("after-snapshot");
});

test("Kiro failure during private-root mutation restores every root and unrelated leaf", async () => {
	await assertKiroFailureRestores("during-commit");
});

test("Kiro failure after the private root restores every root and unrelated leaf", async () => {
	await assertKiroFailureRestores("after-root-plugin_private");
});

test("Kiro failure after all root mutations restores every root and unrelated leaf", async () => {
	await assertKiroFailureRestores("after-tree-swap");
});

test("Kiro failure after settings mutation restores every root, setting, and unrelated leaf", async () => {
	await assertKiroFailureRestores("after-settings");
});

test("Kiro failure after integrity verification restores every root and unrelated leaf", async () => {
	await assertKiroFailureRestores("after-integrity");
});

test("Kiro failure after E4 construction restores every root and unrelated leaf", async () => {
	await assertKiroFailureRestores("after-e4");
});

test("Kiro failure after receipt publication restores the prior receipt and every root", async () => {
	await assertKiroFailureRestores("after-receipt");
});

test("one Kiro target lock protects the managed root with stable busy semantics", async () => {
	const box = sandbox();
	const unrelated = seedMultiRootHome(box);
	const paths = prepareStateLayout(box);
	fs.writeFileSync(paths.lockPath, "held\n");
	const homeBefore = snapshotManagedHome(box);

	const result = output(await invoke("install", "kiro-cli", box));
	assert.equal(result.code, 6);
	assert.equal(result.error.kind, "E_LOCK_BUSY");
	assert.deepEqual(snapshotManagedHome(box), homeBefore);
	assertUnrelatedKiroContent(box, unrelated);
});
