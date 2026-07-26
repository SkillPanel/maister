import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	createPiCommandProjection,
	projectPiCommands,
	validatePiCommandOrigins,
} from "../../plugins/maister/lib/distribution/pi-command-projection.mjs";
import { materialize } from "../../plugins/maister/lib/distribution/materializer.mjs";
import { canonicalJson } from "../../plugins/maister/lib/distribution/provenance.mjs";
import { loadOverlay } from "../../plugins/maister/lib/distribution/overlay-loader.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PI_OVERLAY_ROOT = path.join(ROOT, "plugins/maister/overlays/pi");
const PLUGIN_ROOT = path.join(ROOT, "plugins/maister");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const repositoryGit = {
	topLevel: () => ROOT,
	head: () => COMMIT,
	status: () => [],
};

function sha256(bytes) {
	return crypto.createHash("sha256").update(bytes).digest("hex");
}

function loadPiOverlay() {
	return loadOverlay({
		overlayPath: path.join(PI_OVERLAY_ROOT, "overlay.yml"),
		inventoryPath: path.join(PI_OVERLAY_ROOT, "inventory.yml"),
	}).overlay;
}

function temporaryRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "maister-pi-package-"));
}

function relativePath(root, absolute) {
	return path.relative(root, absolute).split(path.sep).join("/");
}

function snapshotTree(root) {
	const snapshot = [];
	const visit = (directory) => {
		for (const entry of fs
			.readdirSync(directory, { withFileTypes: true })
			.sort((left, right) => left.name.localeCompare(right.name))) {
			const absolute = path.join(directory, entry.name);
			const relative = relativePath(root, absolute);
			const stat = fs.lstatSync(absolute);
			const mode = (stat.mode & 0o7777).toString(8).padStart(4, "0");
			if (entry.isDirectory()) {
				snapshot.push({ path: relative, type: "directory", mode });
				visit(absolute);
			} else if (entry.isFile()) {
				const bytes = fs.readFileSync(absolute);
				snapshot.push({
					path: relative,
					type: "file",
					mode,
					sha256: sha256(bytes),
				});
			} else if (entry.isSymbolicLink()) {
				snapshot.push({
					path: relative,
					type: "symlink",
					mode,
					target: fs.readlinkSync(absolute),
				});
			}
		}
	};
	visit(root);
	return snapshot;
}

function packageOptions(stagingRoot, overlay = undefined) {
	return {
		source: `local:${ROOT}`,
		target: "pi",
		...(overlay
			? { overlay }
			: {
					overlayPath: path.join(PI_OVERLAY_ROOT, "overlay.yml"),
					inventoryPath: path.join(PI_OVERLAY_ROOT, "inventory.yml"),
				}),
		stagingRoot,
		git: repositoryGit,
		sourceVersion: "1.2.3",
		hostVersion: "1.0.0",
	};
}

test("projects the exact closed Pi command inventory with raw-source bindings", () => {
	const overlay = loadPiOverlay();
	const origins = overlay.inventory.command_origins;
	assert.equal(origins.length, 14);
	validatePiCommandOrigins(origins);

	const projection = createPiCommandProjection({
		sourceRoot: PLUGIN_ROOT,
		origins,
	});
	const outputs = projectPiCommands({ sourceRoot: PLUGIN_ROOT, origins });

	assert.deepEqual(
		projection.entries,
		origins.map(
			({
				source,
				destination,
				kind,
				transform_id: transformId,
				sha256: sourceSha256,
			}) => ({
				source,
				destination,
				kind,
				transform_id: transformId,
				sha256: sourceSha256,
			}),
		),
	);
	assert.equal(
		projection.digest,
		sha256(Buffer.from(canonicalJson(projection.entries), "utf8")),
	);

	for (const [index, origin] of origins.entries()) {
		const output = outputs[index];
		const raw = fs.readFileSync(path.join(PLUGIN_ROOT, origin.source));
		const expectedContent = raw
			.toString("utf8")
			.replaceAll("\r\n", "\n")
			.replace(/\n*$/u, "\n");
		assert.equal(output.path, origin.destination);
		assert.equal(output.source_sha256, origin.sha256);
		assert.equal(output.content, expectedContent);
		assert.equal(output.sha256, sha256(Buffer.from(expectedContent, "utf8")));
	}

	assert.deepEqual(
		createPiCommandProjection({ sourceRoot: PLUGIN_ROOT, origins }),
		projection,
	);
});

test("rejects unsafe, stale, and reordered Pi command bindings before projection", () => {
	const origins = structuredClone(loadPiOverlay().inventory.command_origins);

	const unsafe = structuredClone(origins);
	unsafe[0].destination = "../escape.md";
	assert.throws(
		() => validatePiCommandOrigins(unsafe),
		(error) => error.code === "E_AGENT_PROJECTION_PATH",
	);

	const stale = structuredClone(origins);
	stale[0].sha256 = "0".repeat(64);
	assert.throws(
		() => validatePiCommandOrigins(stale),
		(error) => error.code === "E_AGENT_PROJECTION_BINDING",
	);

	const reordered = [...origins].reverse();
	assert.throws(
		() => validatePiCommandOrigins(reordered),
		(error) => error.code === "E_AGENT_PROJECTION_BINDING",
	);
});

test("materializes a deterministic Pi package with exact public inventory and manifest", async () => {
	const root = temporaryRoot();
	try {
		const first = await materialize(packageOptions(path.join(root, "first")));
		const second = await materialize(packageOptions(path.join(root, "second")));

		assert.deepEqual(
			snapshotTree(first.stagingRoot),
			snapshotTree(second.stagingRoot),
		);
		assert.equal(first.commandProjection.entries.length, 14);
		assert.equal(first.projection.outputs.length, 28);

		const packageManifest = JSON.parse(
			fs.readFileSync(path.join(first.stagingRoot, "package.json"), "utf8"),
		);
		assert.deepEqual(packageManifest, {
			name: "maister",
			version: "1.0.0-generated",
			private: true,
			description: "Maister workflow package for Pi",
			pi: {
				extensions: ["./extensions/maister.ts"],
				skills: ["./skills"],
				prompts: ["./prompts"],
				subagents: {
					agents: ["./agents"],
				},
			},
		});

		const sourceManifest = JSON.parse(
			fs.readFileSync(
				path.join(first.stagingRoot, ".maister-source.json"),
				"utf8",
			),
		);
		assert.deepEqual(Object.keys(sourceManifest).sort(), [
			"content_hash",
			"schema_version",
			"source_commit",
			"source_version",
		]);
		assert.equal(sourceManifest.schema_version, 1);
		assert.equal(sourceManifest.source_commit, COMMIT);
		assert.equal(sourceManifest.source_version, "1.2.3");
		assert.match(sourceManifest.content_hash, /^[0-9a-f]{64}$/u);

		const skillDirectories = fs
			.readdirSync(path.join(first.stagingRoot, "skills"), {
				withFileTypes: true,
			})
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		const promptFiles = fs.readdirSync(path.join(first.stagingRoot, "prompts"));
		const agentFiles = fs.readdirSync(path.join(first.stagingRoot, "agents"));
		assert.equal(skillDirectories.length, 36);
		assert.equal(promptFiles.length, 14);
		assert.equal(agentFiles.length, 28);
		assert.ok(agentFiles.every((file) => /^maister-[^/]+\.md$/u.test(file)));

		const skillNames = skillDirectories.map((directory) => {
			const skill = fs.readFileSync(
				path.join(first.stagingRoot, "skills", directory, "SKILL.md"),
				"utf8",
			);
			return /^name:\s*(\S+)$/mu.exec(skill)?.[1];
		});
		assert.equal(new Set(skillNames).size, 36);
		assert.ok(
			skillNames.every((name) =>
				/^maister-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name),
			),
		);
		assert.equal(skillNames.includes("maister-development"), true);
		assert.equal(skillNames.includes("maister-grill-me"), true);
		assert.equal(skillNames.includes("maister-issue"), true);
		assert.equal(
			skillNames.some((name) => name.startsWith("maister-maister-")),
			false,
		);

		const treePaths = snapshotTree(first.stagingRoot).map(
			({ path: treePath }) => treePath,
		);
		assert.equal(
			treePaths.some((treePath) => treePath.startsWith("commands/")),
			false,
		);
		assert.equal(
			treePaths.some((treePath) => treePath.startsWith("pi-subagents/")),
			false,
		);
		assert.equal(treePaths.includes("extensions/maister.ts"), true);
		assert.equal(treePaths.includes("agent-projection-v1.json"), true);
		assert.equal(treePaths.includes("pi-command-projection-v1.json"), true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("fails closed on Pi command drift without leaving a partial package", async () => {
	const root = temporaryRoot();
	const stagingRoot = path.join(root, "stage");
	try {
		const overlay = structuredClone(loadPiOverlay());
		overlay.inventory.command_origins[0].sha256 = "0".repeat(64);
		await assert.rejects(
			materialize(packageOptions(stagingRoot, overlay)),
			(error) => error.code === "E_AGENT_PROJECTION_BINDING",
		);
		assert.equal(fs.existsSync(stagingRoot), false);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
