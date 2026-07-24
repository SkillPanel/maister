import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseCanonicalYaml } from "../../skills/orchestrator-framework/bin/orchestrator-state-schema.mjs";
import { loadOverlay, validateOverlay } from "./overlay-loader.mjs";
import { AgentIrValidationError, loadCanonicalAgentIr } from "./agent-ir.mjs";
import {
	AgentManifestValidationError,
	buildAgentManifest,
	loadAgentProjectionContract,
} from "./agent-manifest.mjs";
import { AgentProjectionError, projectAgents } from "./agent-projector.mjs";
import {
	createPiCommandProjection,
	projectPiCommands,
} from "./pi-command-projection.mjs";
import { adaptMaterializedFlowSkills } from "./flow-skill-projection.mjs";
import { PI_EXTENSION_SOURCE } from "./pi-extension-source.mjs";
import { canonicalJson, createProvenance } from "./provenance.mjs";
import { revalidateResolvedSource, resolveSource } from "./source-resolver.mjs";
import { hashFile, hashTree } from "./hash-tree.mjs";
import {
	assertSameFilesystem,
	assertSafeSymlink,
	assertPathIdentity,
	capturePathIdentity,
	DistributionError,
	ensureDirectoryRoot,
	ensureDirectoryPath,
	normalizeRelativePath,
	normalizedPathKey,
	readFileNoFollow,
	resolveInside,
	throwDistributionError,
} from "./path-safety.mjs";

const AGENT_PROJECTION_TARGETS = Object.freeze([
	"codex",
	"cursor",
	"kiro-cli",
	"pi",
]);

const PI_PACKAGE_MANIFEST = Object.freeze({
	name: "maister",
	version: "1.0.0-generated",
	private: true,
	description: "Maister workflow package for Pi",
	pi: Object.freeze({
		extensions: Object.freeze(["./extensions/maister.ts"]),
		skills: Object.freeze(["./skills"]),
		prompts: Object.freeze(["./prompts"]),
		subagents: Object.freeze({
			agents: Object.freeze(["./agents"]),
		}),
	}),
});

const HISTORICAL_TEMPLATE_EXCEPTIONS = Object.freeze({
	codex: Object.freeze({
		"skills/maister-product-design/server/template.html": new Set([
			"{{TITLE}}",
			"{{NAV}}",
			"{{CONTENT}}",
			"{{ANNOTATIONS}}",
		]),
	}),
	"kiro-cli": Object.freeze({
		"skills/maister-product-design/server/template.html": new Set([
			"{{TITLE}}",
			"{{NAV}}",
			"{{CONTENT}}",
			"{{ANNOTATIONS}}",
		]),
	}),
	cursor: Object.freeze({
		"skills/maister-product-design/server/template.html": new Set([
			"{{TITLE}}",
			"{{NAV}}",
			"{{CONTENT}}",
			"{{ANNOTATIONS}}",
		]),
	}),
	pi: Object.freeze({
		"skills/product-design/server/template.html": new Set([
			"{{TITLE}}",
			"{{NAV}}",
			"{{CONTENT}}",
			"{{ANNOTATIONS}}",
		]),
	}),
});

const HISTORICAL_VOCABULARY_EXCEPTIONS = Object.freeze({
	codex: Object.freeze({
		"skills/maister-docs-manager/docs/INDEX.md": Object.freeze(["claude"]),
		"skills/maister-docs-manager/SKILL.md": Object.freeze(["claude"]),
		"skills/maister-init/SKILL.md": Object.freeze(["claude"]),
		"skills/maister-migration/references/migration-strategies.md": Object.freeze([
			"claude",
		]),
		"skills/maister-migration/references/migration-types.md": Object.freeze(["claude"]),
		"skills/maister-orchestrator-framework/agents/maister-e2e-test-verifier.md": Object.freeze([
			"claude",
		]),
		"skills/maister-orchestrator-framework/assets/dashboard.html": Object.freeze([
			"cursor",
		]),
		"skills/maister-orchestrator-framework/bin/orchestrator-state-repository.mjs":
			Object.freeze(["cursor"]),
		"skills/maister-orchestrator-framework/references/gate-decision-engine.md":
			Object.freeze(["cursor", "kiro"]),
		"skills/maister-orchestrator-framework/references/host-capabilities.yml":
			Object.freeze(["cursor", "kiro"]),
		"skills/maister-orchestrator-framework/references/html-report-style.md":
			Object.freeze(["cursor"]),
		"skills/maister-orchestrator-framework/references/orchestrator-patterns.md":
			Object.freeze(["claude"]),
		"skills/maister-product-design/server/template.html": Object.freeze(["cursor"]),
		"skills/maister-quick-plan/SKILL.md": Object.freeze(["claude"]),
		"skills/maister-standards-discover/references/docs-extractor-prompt.md":
			Object.freeze(["claude"]),
		"skills/maister-standards-discover/SKILL.md": Object.freeze(["claude"]),
		"skills/maister-standards-update/SKILL.md": Object.freeze(["claude"]),
	}),
	"kiro-cli": Object.freeze({
		"skills/maister-docs-manager/docs/INDEX.md": Object.freeze(["claude"]),
		"skills/maister-docs-manager/SKILL.md": Object.freeze(["claude"]),
		"skills/maister-init/SKILL.md": Object.freeze(["codex", "claude"]),
		"skills/maister-migration/references/migration-strategies.md":
			Object.freeze(["claude"]),
		"skills/maister-migration/references/migration-types.md": Object.freeze([
			"claude",
		]),
		"skills/maister-orchestrator-framework/assets/dashboard.html":
			Object.freeze(["cursor"]),
		"skills/maister-orchestrator-framework/bin/orchestrator-state-repository.mjs":
			Object.freeze(["cursor"]),
		"skills/maister-orchestrator-framework/references/gate-decision-engine.md":
			Object.freeze(["codex", "cursor"]),
		"skills/maister-orchestrator-framework/references/host-capabilities.yml":
			Object.freeze(["codex", "cursor"]),
		"skills/maister-orchestrator-framework/references/html-report-style.md":
			Object.freeze(["cursor"]),
		"skills/maister-orchestrator-framework/references/orchestrator-patterns.md":
			Object.freeze(["claude"]),
		"skills/maister-product-design/server/template.html": Object.freeze([
			"cursor",
		]),
		"skills/maister-quick-plan/SKILL.md": Object.freeze(["claude"]),
		"skills/maister-standards-discover/references/docs-extractor-prompt.md":
			Object.freeze(["claude"]),
		"skills/maister-standards-discover/SKILL.md": Object.freeze(["claude"]),
		"skills/maister-standards-update/SKILL.md": Object.freeze(["claude"]),
	}),
});

const HISTORICAL_REFERENCE_EXCEPTIONS = Object.freeze({
	"skills/maister-orchestrator-framework/references/html-report-style.md":
		Object.freeze([
			"../dashboard.html",
			"spec.html",
			"implementation-plan.html",
			"../verification/implementation-verification.html",
			"[twin].md",
		]),
	"agents/maister-user-docs-generator.md": Object.freeze([
		"screenshots/01-action.png",
		"screenshots/02-action.png",
	]),
	"skills/maister-orchestrator-framework/agents/maister-e2e-test-verifier.md": Object.freeze([
		"screenshots/...",
	]),
	"skills/maister-orchestrator-framework/agents/maister-user-docs-generator.md": Object.freeze([
		"screenshots/01-action.png",
		"screenshots/02-action.png",
	]),
});

function pathIsWithin(root, candidate) {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

function existingPathAnchor(candidate) {
	let current = path.resolve(candidate);
	while (!fs.lstatSync(current, { throwIfNoEntry: false })) {
		const parent = path.dirname(current);
		if (parent === current) return current;
		current = parent;
	}
	return current;
}

function sourceBoundaryFor(candidate, sourceRoot, overlayRoot) {
	const absolute = path.resolve(candidate);
	const boundaries = [
		{ root: sourceRoot, kind: "source" },
		...(overlayRoot ? [{ root: overlayRoot, kind: "overlay" }] : []),
	];
	return boundaries.find(({ root }) => pathIsWithin(root, absolute));
}

function assertSourceContained(candidate, sourceRoot, overlayRoot) {
	const boundary = sourceBoundaryFor(candidate, sourceRoot, overlayRoot);
	if (!boundary) {
		throwDistributionError(
			"E_MATERIALIZE_SOURCE",
			`source entry is outside approved roots: ${candidate}`,
			{ candidate },
		);
	}
	const stat = fs.lstatSync(candidate);
	if (stat.isSymbolicLink()) assertSafeSymlink(candidate, boundary.root);
	let real;
	try {
		real = fs.realpathSync(candidate);
	} catch (error) {
		const code =
			error.code === "ELOOP"
				? "E_MATERIALIZE_SYMLINK_CYCLE"
				: "E_MATERIALIZE_SYMLINK";
		throwDistributionError(
			code,
			`could not resolve source entry: ${candidate}`,
			{ candidate },
			{ cause: error },
		);
	}
	if (!pathIsWithin(boundary.root, real)) {
		throwDistributionError(
			"E_MATERIALIZE_SYMLINK",
			`source entry escapes its approved root: ${candidate}`,
			{
				candidate,
				root: boundary.root,
			},
		);
	}
	return boundary.root;
}

function sourceCandidates(sourceRoot, overlayBase, source) {
	const sourceParts = source.split("/");
	// The separately supplied overlay root is an explicit boundary for native assets only;
	// common sources are resolved from the immutable checkout and its in-root layouts.
	const candidates =
		source.startsWith("assets/") && overlayBase
			? [
					path.join(overlayBase, ...sourceParts),
					path.join(sourceRoot, ...sourceParts),
				]
			: [path.join(sourceRoot, ...sourceParts)];
	if (source.startsWith("common/")) {
		const relative = source.slice("common/".length);
		candidates.push(
			path.join(sourceRoot, "plugins", "maister", ...relative.split("/")),
		);
		candidates.push(path.join(sourceRoot, ...relative.split("/")));
	}
	if (source === "assets/skills") {
		candidates.push(path.join(sourceRoot, "common", "skills"));
		candidates.push(path.join(sourceRoot, "plugins", "maister", "skills"));
	}
	return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function locateSource(sourceRoot, overlayBase, source) {
	const normalized = normalizeRelativePath(source, "layout source");
	const overlayRoot = overlayBase
		? ensureDirectoryRoot(overlayBase, "overlay source root")
		: null;
	for (const candidate of sourceCandidates(
		sourceRoot,
		overlayRoot,
		normalized,
	)) {
		const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
		if (stat) {
			const boundary = assertSourceContained(
				candidate,
				sourceRoot,
				overlayRoot,
			);
			return { path: candidate, boundary };
		}
	}
	throwDistributionError(
		"E_MATERIALIZE_SOURCE",
		`source entry does not exist: ${source}`,
		{ source, sourceRoot },
	);
}

function entryType(stat) {
	if (stat.isDirectory()) return "directory";
	if (stat.isFile()) return "file";
	if (stat.isSymbolicLink()) return "symlink";
	throwDistributionError(
		"E_MATERIALIZE_TYPE",
		"unsupported source entry type",
		{ stat },
	);
}

function addPlanEntry(
	entries,
	destination,
	sourcePath,
	type,
	mode,
	owner,
	sourceRoot,
	applyMode,
	merge,
	native,
) {
	const normalizedDestination = normalizeRelativePath(
		destination,
		"layout destination",
	);
	entries.push({
		destination: normalizedDestination,
		sourcePath,
		type,
		mode,
		ownership: owner,
		sourceRoot,
		applyMode,
		merge,
		native,
	});
}

function expandSource(
	entries,
	sourcePath,
	destination,
	kind,
	mode,
	ownership,
	sourceRoot,
	enforceKind = true,
	merge = false,
	native = false,
	childPrefix = "",
) {
	const stat = fs.lstatSync(sourcePath);
	if (stat.isSymbolicLink()) assertSafeSymlink(sourcePath, sourceRoot);
	if (
		enforceKind &&
		kind === "file" &&
		!stat.isFile() &&
		!stat.isSymbolicLink()
	) {
		throwDistributionError(
			"E_MATERIALIZE_SOURCE",
			`file layout source is not a file: ${sourcePath}`,
			{ sourcePath },
		);
	}
	if (enforceKind && kind === "tree" && !stat.isDirectory()) {
		throwDistributionError(
			"E_MATERIALIZE_SOURCE",
			`tree layout source is not a directory: ${sourcePath}`,
			{ sourcePath },
		);
	}
	const type = entryType(stat);
	addPlanEntry(
		entries,
		destination,
		sourcePath,
		type,
		mode,
		ownership,
		sourceRoot,
		enforceKind,
		merge,
		native,
	);
	if (type !== "directory") return;
	for (const childName of fs.readdirSync(sourcePath).sort()) {
		const childSource = path.join(sourcePath, childName);
		const prefixedName = childPrefix ? `${childPrefix}${childName}` : childName;
		const childDestination = `${destination}/${prefixedName}`;
		expandSource(
			entries,
			childSource,
			childDestination,
			"tree",
			mode,
			ownership,
			sourceRoot,
			false,
			merge,
			native,
		);
	}
}

export function buildAssemblyPlan({
	sourceRoot,
	overlay,
	overlayBase,
	stagingRoot,
}) {
	const root = ensureDirectoryRoot(sourceRoot, "source root");
	const entries = [];
	for (const layout of overlay.layout ?? []) {
		const source = normalizeRelativePath(layout.source, "layout source");
		const destination = normalizeRelativePath(
			layout.destination,
			"layout destination",
		);
		const sourceLocation = locateSource(root, overlayBase, source);
		expandSource(
			entries,
			sourceLocation.path,
			destination,
			layout.kind,
			layout.mode,
			layout.ownership,
			sourceLocation.boundary,
			true,
			layout.merge === true,
			layout.native === true,
			layout.child_prefix ?? "",
		);
	}
	const destinations = new Map();
	for (const entry of entries) {
		const key = normalizedPathKey(entry.destination);
		const previous = destinations.get(key);
		if (
			previous &&
			previous.type !== "directory" &&
			entry.type !== "directory" &&
			entry.native &&
			!previous.native
		) {
			destinations.set(key, entry);
			continue;
		}
		if (
			previous &&
			previous.type !== "directory" &&
			entry.type !== "directory" &&
			previous.native &&
			!entry.native
		)
			continue;
		if (
			previous &&
			!(
				previous.type === "directory" &&
				entry.type === "directory" &&
				(previous.merge || entry.merge)
			)
		) {
			throwDistributionError(
				"E_MATERIALIZE_COLLISION",
				`destination collision after normalization: ${entry.destination}`,
				{
					destination: entry.destination,
					previous: previous.destination,
				},
			);
		}
		destinations.set(key, entry);
	}
	for (const entry of entries) {
		let parent = path.posix.dirname(entry.destination);
		while (parent !== ".") {
			const parentEntry = destinations.get(normalizedPathKey(parent));
			if (parentEntry && parentEntry.type !== "directory") {
				throwDistributionError(
					"E_MATERIALIZE_COLLISION",
					`file destination contains another destination: ${entry.destination}`,
					{
						destination: entry.destination,
						previous: parentEntry.destination,
					},
				);
			}
			parent = path.posix.dirname(parent);
		}
	}
	entries.sort((left, right) => {
		const a = normalizedPathKey(left.destination);
		const b = normalizedPathKey(right.destination);
		return a < b
			? -1
			: a > b
				? 1
				: left.destination.localeCompare(right.destination);
	});
	if (stagingRoot) {
		for (const entry of entries)
			resolveInside(stagingRoot, entry.destination, "assembly destination");
	}
	return Object.freeze(
		entries
			.filter(
				(entry) =>
					destinations.get(normalizedPathKey(entry.destination)) === entry,
			)
			.map((entry) => Object.freeze(entry)),
	);
}

function piPackageEntryMode(destination, type) {
	if (type === "directory") return "0755";
	return destination === "bin" || destination.startsWith("bin/")
		? "0755"
		: "0644";
}

function expandPiPackageSource(entries, sourcePath, destination, sourceRoot) {
	const sourceStat = fs.lstatSync(sourcePath, { throwIfNoEntry: false });
	if (!sourceStat) {
		throwDistributionError(
			"E_MATERIALIZE_SOURCE",
			`Pi package source does not exist: ${sourcePath}`,
			{ sourcePath },
		);
	}
	assertSourceContained(sourcePath, sourceRoot, null);
	if (sourceStat.isSymbolicLink()) {
		throwDistributionError(
			"E_MATERIALIZE_SYMLINK",
			`Pi package source must not contain symlinks: ${sourcePath}`,
			{ sourcePath },
		);
	}
	if (!sourceStat.isDirectory() && !sourceStat.isFile()) {
		throwDistributionError(
			"E_MATERIALIZE_TYPE",
			`unsupported Pi package source entry: ${sourcePath}`,
			{ sourcePath },
		);
	}
	const type = sourceStat.isDirectory() ? "directory" : "file";
	addPlanEntry(
		entries,
		destination,
		sourcePath,
		type,
		piPackageEntryMode(destination, type),
		"plugin_private",
		sourceRoot,
		true,
		false,
		false,
	);
	if (type !== "directory") return;
	for (const childName of fs.readdirSync(sourcePath).sort()) {
		expandPiPackageSource(
			entries,
			path.join(sourcePath, childName),
			`${destination}/${childName}`,
			sourceRoot,
		);
	}
}

function validatePackagePlan(entries, stagingRoot) {
	const destinations = new Map();
	for (const entry of entries) {
		const key = normalizedPathKey(entry.destination);
		const previous = destinations.get(key);
		if (previous) {
			throwDistributionError(
				"E_MATERIALIZE_COLLISION",
				`Pi package destination collides after normalization: ${entry.destination}`,
				{
					destination: entry.destination,
					previous: previous.destination,
				},
			);
		}
		destinations.set(key, entry);
	}
	for (const entry of entries) {
		let parent = path.posix.dirname(entry.destination);
		while (parent !== ".") {
			const parentEntry = destinations.get(normalizedPathKey(parent));
			if (parentEntry && parentEntry.type !== "directory") {
				throwDistributionError(
					"E_MATERIALIZE_COLLISION",
					`Pi package file destination contains another destination: ${entry.destination}`,
					{
						destination: entry.destination,
						previous: parentEntry.destination,
					},
				);
			}
			parent = path.posix.dirname(parent);
		}
	}
	const sorted = entries.sort((left, right) => {
		const a = normalizedPathKey(left.destination);
		const b = normalizedPathKey(right.destination);
		return a < b
			? -1
			: a > b
				? 1
				: left.destination.localeCompare(right.destination);
	});
	if (stagingRoot) {
		for (const entry of sorted)
			resolveInside(stagingRoot, entry.destination, "Pi package destination");
	}
	return Object.freeze(sorted.map((entry) => Object.freeze(entry)));
}

function buildPiPackagePlan({ sourceRoot, overlay, stagingRoot }) {
	const root = ensureDirectoryRoot(sourceRoot, "source root");
	const pluginRoot = projectionPluginRoot(root);
	const entries = [];
	const skillOrigins = overlay.inventory.skill_origins ?? [];
	for (const origin of skillOrigins) {
		expandPiPackageSource(
			entries,
			resolveInside(pluginRoot, origin.source, "Pi skill source"),
			origin.destination,
			root,
		);
	}
	for (const [source, destination] of [
		["common", "common"],
		["lib", "lib"],
		["bin", "bin"],
		["skills/orchestrator-framework/bin", "orchestrator-framework/bin"],
	]) {
		expandPiPackageSource(
			entries,
			resolveInside(pluginRoot, source, "Pi runtime source"),
			destination,
			root,
		);
	}
	return validatePackagePlan(entries, stagingRoot);
}

function globRegex(pattern) {
	const normalized = pattern.replaceAll("\\", "/");
	let expression = "^";
	for (let index = 0; index < normalized.length; index += 1) {
		const character = normalized[index];
		if (character === "*" && normalized[index + 1] === "*") {
			index += 1;
			if (normalized[index + 1] === "/") {
				index += 1;
				expression += "(?:.*/)?";
			} else {
				expression += ".*";
			}
		} else if (character === "*") expression += "[^/]*";
		else if (character === "?") expression += "[^/]";
		else
			expression += /[\\^$+.()|{}[\]]/u.test(character)
				? `\\${character}`
				: character;
	}
	return new RegExp(`${expression}$`, "u");
}

function matches(pattern, value) {
	return globRegex(pattern).test(value);
}

function observedModeMatches(expected, observed) {
	// Windows does not preserve POSIX permission bits when extracting or
	// copying release files. Archive headers, content hashes, and inventory
	// contracts remain authoritative there; filesystem mode is not.
	return process.platform === "win32" || expected === observed;
}

function stagingEntries(stagingRoot) {
	const tree = hashTree(stagingRoot);
	return {
		tree,
		entries: tree.entries,
		files: tree.entries.filter((entry) => entry.type !== "directory"),
	};
}

function readText(filePath) {
	try {
		const bytes = fs.readFileSync(filePath);
		if (bytes.includes(0)) return null;
		return bytes.toString("utf8");
	} catch {
		return null;
	}
}

function normalizeTextForParsing(text) {
	const withoutBom = text.startsWith("\ufeff") ? text.slice(1) : text;
	return withoutBom.replace(/\r\n?/gu, "\n");
}

function hasUnresolvedTemplateToken(text, filePath, target) {
	const tokens = [...text.matchAll(/\{\{[^}\n]+\}\}/gu)].map(
		(match) => match[0],
	);
	if (tokens.length === 0) return false;
	const extension = path.extname(filePath).toLocaleLowerCase("en-US");
	const historicalTokens =
		extension === ".html"
			? HISTORICAL_TEMPLATE_EXCEPTIONS[target]?.[filePath]
			: undefined;
	if (historicalTokens)
		return tokens.some((token) => !historicalTokens.has(token));
	if (extension === ".mjs" || extension === ".js") {
		return tokens.some(
			(token) =>
				!new RegExp(
					`(?:replace|replaceAll)\\(\\s*['"]${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
					"u",
				).test(text),
		);
	}
	return true;
}

function validateFrontmatter(stagingRoot, files) {
	for (const entry of files) {
		if (!/\.(?:md|markdown|mdx)$/iu.test(entry.path)) continue;
		const filePath = resolveInside(stagingRoot, entry.path, "frontmatter path");
		const text = readText(filePath);
		if (text === null) continue;
		const normalized = normalizeTextForParsing(text);
		if (!normalized.startsWith("---\n")) continue;
		const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized);
		if (!match) {
			throwDistributionError(
				"E_MATERIALIZE_SYNTAX",
				`unterminated frontmatter in ${entry.path}`,
				{ path: entry.path, format: "frontmatter" },
			);
		}
		try {
			validateFrontmatterSyntax(match[1]);
		} catch (error) {
			throwDistributionError(
				"E_MATERIALIZE_SYNTAX",
				`invalid frontmatter in ${entry.path}`,
				{
					path: entry.path,
					format: "frontmatter",
				},
				{ cause: error },
			);
		}
	}
	return { ok: true };
}

function canonicalFrontmatterSource(source) {
	return source
		.split("\n")
		.map((line) => {
			const mapping = /^\s*[A-Za-z_][\w-]*:\s?(.*)$/u.exec(line);
			const sequence = /^\s*-\s+(.*)$/u.exec(line);
			const value = (mapping?.[1] ?? sequence?.[1] ?? "").trimStart();
			if (/^[&*!]/u.test(value))
				throw new Error(
					"frontmatter anchors, aliases, and tags are not supported",
				);
			let quote = null;
			let result = "";
			for (let index = 0; index < line.length; index += 1) {
				const character = line[index];
				if (character === "\\" && quote === '"') {
					result += character;
					if (index + 1 < line.length) result += line[++index];
					continue;
				}
				if (
					(character === '"' || character === "'") &&
					(quote === null || quote === character)
				) {
					quote = quote === null ? character : null;
				}
				result += quote === null && /[&*!]/u.test(character) ? "_" : character;
			}
			return result;
		})
		.join("\n");
}

function validateFrontmatterSyntax(source) {
	const parsed = parseCanonicalYaml(canonicalFrontmatterSource(source));
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		Object.keys(parsed).length === 0
	) {
		throw new Error("frontmatter must be a non-empty YAML mapping");
	}
}

function validateTypeScriptSyntax(source) {
	if (source.trim().length === 0)
		throw new Error("TypeScript source must not be empty");
	const stack = [];
	let quote = null;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (lineComment) {
			if (character === "\n") lineComment = false;
			continue;
		}
		if (blockComment) {
			if (character === "*" && next === "/") {
				blockComment = false;
				index += 1;
			}
			continue;
		}
		if (quote !== null) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = null;
			continue;
		}
		if (character === "/" && next === "/") {
			lineComment = true;
			index += 1;
			continue;
		}
		if (character === "/" && next === "*") {
			blockComment = true;
			index += 1;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			continue;
		}
		if ("({[".includes(character)) stack.push(character);
		else if (")}]".includes(character)) {
			const expected = { ")": "(", "]": "[", "}": "{" }[character];
			if (stack.pop() !== expected)
				throw new Error("unbalanced TypeScript delimiters");
		}
	}
	if (quote !== null || blockComment || stack.length > 0)
		throw new Error("unterminated TypeScript construct");
}

function validateSyntax(stagingRoot, checks, files) {
	validateFrontmatter(stagingRoot, files);
	for (const entry of files) {
		if (!entry.path.endsWith(".json")) continue;
		const filePath = resolveInside(stagingRoot, entry.path, "JSON syntax path");
		const text = readText(filePath);
		try {
			if (text === null) throw new Error("not a text file");
			JSON.parse(text);
		} catch (error) {
			throwDistributionError(
				"E_MATERIALIZE_SYNTAX",
				`invalid json syntax in ${entry.path}`,
				{
					path: entry.path,
					format: "json",
				},
				{ cause: error },
			);
		}
	}
	for (const check of checks) {
		const separator = check.indexOf(":");
		const format = check.slice(0, separator);
		const pattern = check.slice(separator + 1);
		const selected = files.filter((entry) => matches(pattern, entry.path));
		for (const entry of selected) {
			const filePath = resolveInside(stagingRoot, entry.path, "syntax path");
			const text = readText(filePath);
			try {
				if (text === null) throw new Error("not a text file");
				if (format === "json") JSON.parse(text);
				else if (format === "yaml") parseCanonicalYaml(text);
				else if (format === "typescript") validateTypeScriptSyntax(text);
				else if (format === "markdown" || format === "frontmatter") {
					const normalized = normalizeTextForParsing(text);
					if (
						normalized.startsWith("---\n") &&
						!/^---\n[\s\S]*?\n---(?:\n|$)/u.test(normalized)
					) {
						throw new Error("unterminated frontmatter");
					}
				} else throw new Error(`unsupported syntax check: ${format}`);
			} catch (error) {
				throwDistributionError(
					"E_MATERIALIZE_SYNTAX",
					`invalid ${format} syntax in ${entry.path}`,
					{
						path: entry.path,
						format,
					},
					{ cause: error },
				);
			}
		}
	}
	return { ok: true };
}

function validateInventory(stagingRoot, inventory, files) {
	const paths = files.map((entry) => entry.path);
	for (const pattern of inventory.required) {
		if (!paths.some((value) => matches(pattern, value))) {
			throwDistributionError(
				"E_MATERIALIZE_INVENTORY",
				`required inventory entry is missing: ${pattern}`,
				{ pattern },
			);
		}
	}
	for (const pattern of inventory.forbidden) {
		const found = paths.find((value) => matches(pattern, value));
		if (found)
			throwDistributionError(
				"E_MATERIALIZE_INVENTORY",
				`forbidden inventory entry is present: ${found}`,
				{ pattern, found },
			);
	}
	return { ok: true, files: paths.sort() };
}

function validateModes(
	stagingRoot,
	executablePaths,
	files,
	projectedOutputs = [],
) {
	for (const pattern of executablePaths) {
		const selected = files.filter((entry) => matches(pattern, entry.path));
		for (const entry of selected) {
			if (process.platform !== "win32" && (Number.parseInt(entry.mode, 8) & 0o111) === 0) {
				throwDistributionError(
					"E_MATERIALIZE_MODE",
					`executable inventory entry is not executable: ${entry.path}`,
					{ path: entry.path },
				);
			}
		}
	}
	const entriesByPath = new Map(files.map((entry) => [entry.path, entry]));
	for (const output of projectedOutputs) {
		const entry = entriesByPath.get(output.path);
		if (!entry) continue;
		if (!observedModeMatches(output.mode, entry.mode)) {
			throwDistributionError(
				"E_MATERIALIZE_MODE",
				`projected inventory mode differs from its manifest: ${output.path}`,
				{
					path: output.path,
					expected: output.mode,
					actual: entry?.mode ?? null,
				},
			);
		}
	}
	return { ok: true };
}

function normalizedReference(reference, entryPath) {
	let value = reference.trim();
	if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1);
	try {
		value = decodeURIComponent(value);
	} catch {
		referenceValidationError(
			"reference contains invalid percent encoding",
			entryPath,
			reference,
		);
	}
	const separator = value.search(/[?#]/u);
	return separator === -1 ? value : value.slice(0, separator);
}

function referenceIsExternal(reference) {
	if (reference.startsWith("file://"))
		return !reference.startsWith("file://./");
	return (
		reference === "" ||
		reference.startsWith("#") ||
		reference.startsWith("/") ||
		reference.startsWith("//") ||
		/^(?:[A-Za-z][A-Za-z\d+.-]*:|data:|mailto:|javascript:)/u.test(reference)
	);
}

function referenceValidationError(message, entryPath, reference = undefined) {
	throwDistributionError("E_MATERIALIZE_REFERENCE", message, {
		path: entryPath,
		...(reference === undefined ? {} : { reference }),
	});
}

function referenceDefinitionKey(label) {
	return label.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function parseReferenceDefinitions(text, entryPath) {
	const definitions = new Map();
	const definitionLines = [];
	let offset = 0;
	for (const line of text.split(/\r?\n/u)) {
		const candidate = /^ {0,3}\[[^\]\r\n]+\]:/u.test(line);
		if (candidate) {
			const match =
				/^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(<[^>\r\n]*>|[^\s]+)(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)\r\n]*\)))?[ \t]*$/u.exec(
					line,
				);
			if (!match)
				referenceValidationError(
					"unsupported or ambiguous Markdown reference definition",
					entryPath,
					line.trim(),
				);
			const key = referenceDefinitionKey(match[1]);
			if (definitions.has(key))
				referenceValidationError(
					"duplicate Markdown reference definition",
					entryPath,
					match[1],
				);
			definitions.set(key, match[2]);
			definitionLines.push([offset, offset + line.length]);
		}
		offset += line.length + 1;
	}
	return { definitions, definitionLines };
}

function rangeContains(ranges, index) {
	return ranges.some(([start, end]) => index >= start && index < end);
}

function maskMarkdownCode(text) {
	const ranges = [];
	for (const match of text.matchAll(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu))
		ranges.push([match.index, match.index + match[0].length]);
	for (const match of text.matchAll(/`[^`\r\n]*`/gu))
		ranges.push([match.index, match.index + match[0].length]);
	if (ranges.length === 0) return text;
	const characters = text.split("");
	for (const [start, end] of ranges) {
		for (let index = start; index < end; index += 1) {
			if (characters[index] !== "\n" && characters[index] !== "\r")
				characters[index] = " ";
		}
	}
	return characters.join("");
}

function parseInlineDestination(text, start, entryPath) {
	let index = start;
	while (/\s/u.test(text[index] ?? "")) index += 1;
	if (index >= text.length)
		referenceValidationError(
			"unterminated Markdown inline reference",
			entryPath,
		);

	let destination;
	if (text[index] === "<") {
		const end = text.indexOf(">", index + 1);
		if (end === -1)
			referenceValidationError(
				"unterminated Markdown inline destination",
				entryPath,
			);
		destination = text.slice(index + 1, end);
		index = end + 1;
	} else {
		const destinationStart = index;
		let parentheses = 0;
		while (index < text.length) {
			const character = text[index];
			if (character === "(") parentheses += 1;
			else if (character === ")") {
				if (parentheses === 0) break;
				parentheses -= 1;
			} else if (/\s/u.test(character) && parentheses === 0) break;
			index += 1;
		}
		if (index === destinationStart)
			referenceValidationError(
				"Markdown inline reference has no destination",
				entryPath,
			);
		destination = text.slice(destinationStart, index);
	}

	while (/\s/u.test(text[index] ?? "")) index += 1;
	if (text[index] !== ")") {
		const titleStart = index;
		const quote = text[index];
		if (quote !== '"' && quote !== "'" && quote !== "(") {
			referenceValidationError(
				"unsupported or ambiguous Markdown inline reference title",
				entryPath,
				destination,
			);
		}
		const closing = quote === "(" ? ")" : quote;
		index += 1;
		let escaped = false;
		while (index < text.length) {
			const character = text[index];
			if (!escaped && character === "\\") escaped = true;
			else if (!escaped && character === closing) break;
			else escaped = false;
			index += 1;
		}
		if (index >= text.length)
			referenceValidationError(
				"unterminated Markdown inline reference title",
				entryPath,
				text.slice(titleStart),
			);
		index += 1;
		while (/\s/u.test(text[index] ?? "")) index += 1;
	}
	if (text[index] !== ")")
		referenceValidationError(
			"unterminated Markdown inline reference",
			entryPath,
			destination,
		);
	return { destination, end: index + 1 };
}

function referencesInText(text, entryPath) {
	text = normalizeTextForParsing(text);
	const references = [];
	const markdown = /\.(?:md|markdown|mdx)$/iu.test(entryPath);
	if (!markdown) {
		const attributes = new Map();
		const scanText = maskMarkdownCode(text);
		for (const match of scanText.matchAll(
			/\b(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/giu,
		))
			attributes.set(match.index, match[2]);
		for (const match of scanText.matchAll(/\b(?:href|src)\s*=/giu)) {
			if (!attributes.has(match.index))
				referenceValidationError(
					"HTML href/src attributes must use a quoted value",
					entryPath,
					match[0],
				);
		}
		return [...attributes.values()];
	}
	const scanText = maskMarkdownCode(text);
	if (/!?\[[^\]\r\n]*\[[^\]\r\n]*\]{2,}\s*(?:\(|\[)/u.test(scanText)) {
		referenceValidationError(
			"nested Markdown reference labels are not supported",
			entryPath,
		);
	}
	const { definitions, definitionLines } = parseReferenceDefinitions(
		scanText,
		entryPath,
	);
	for (const destination of definitions.values()) references.push(destination);

	const inlineRanges = [];
	for (const match of scanText.matchAll(/!?\[[^\]\r\n]*\]\(/gu)) {
		if (rangeContains(definitionLines, match.index)) continue;
		const parsed = parseInlineDestination(
			scanText,
			match.index + match[0].length,
			entryPath,
		);
		inlineRanges.push([match.index, parsed.end]);
		references.push(parsed.destination);
	}

	const fullReferenceRanges = [];
	for (const match of scanText.matchAll(
		/!?\[([^\]\r\n]+)\]\[([^\]\r\n]*)\]/gu,
	)) {
		if (
			rangeContains(definitionLines, match.index) ||
			rangeContains(inlineRanges, match.index)
		)
			continue;
		const key = referenceDefinitionKey(match[2] || match[1]);
		const destination = definitions.get(key);
		if (destination === undefined)
			referenceValidationError(
				"Markdown reference definition is missing",
				entryPath,
				match[2] || match[1],
			);
		fullReferenceRanges.push([match.index, match.index + match[0].length]);
		references.push(destination);
	}

	for (const match of scanText.matchAll(/!?\[([^\]\r\n]+)\]/gu)) {
		if (
			rangeContains(definitionLines, match.index) ||
			rangeContains(inlineRanges, match.index) ||
			rangeContains(fullReferenceRanges, match.index) ||
			scanText[match.index + match[0].length] === "(" ||
			scanText[match.index + match[0].length] === "["
		)
			continue;
		const destination = definitions.get(referenceDefinitionKey(match[1]));
		if (destination !== undefined) references.push(destination);
	}

	const attributes = new Map();
	for (const match of scanText.matchAll(
		/\b(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/giu,
	))
		attributes.set(match.index, match[2]);
	for (const match of scanText.matchAll(/\b(?:href|src)\s*=/giu)) {
		if (!attributes.has(match.index))
			referenceValidationError(
				"HTML href/src attributes must use a quoted value",
				entryPath,
				match[0],
			);
	}
	references.push(...attributes.values());
	return references;
}

function isHistoricalReferenceException(target, entryPath, reference) {
	const exceptions = HISTORICAL_REFERENCE_EXCEPTIONS[entryPath] ?? [];
	if (
		entryPath ===
			"skills/maister-orchestrator-framework/references/html-report-style.md" &&
		(target === "codex" || target === "kiro-cli")
	) {
		if (exceptions.includes(reference)) return true;
	}
	if (
		target === "codex" &&
		entryPath === "skills/maister-orchestrator-framework/agents/maister-e2e-test-verifier.md" &&
		exceptions.includes(reference)
	)
		return true;
	if (
		target === "codex" &&
		entryPath ===
			"skills/maister-orchestrator-framework/agents/maister-user-docs-generator.md" &&
		exceptions.includes(reference)
	)
		return true;
	return (
		target === "cursor" &&
		entryPath === "agents/maister-user-docs-generator.md" &&
		exceptions.includes(reference)
	);
}

function validateInternalReferences(stagingRoot, target, files, entries) {
	const stagedPaths = new Set(entries.map((entry) => entry.path));
	for (const entry of files) {
		const text = readText(
			resolveInside(stagingRoot, entry.path, "reference path"),
		);
		if (text === null) continue;
		const references = referencesInText(text, entry.path);
		if (target === "kiro-cli" && entry.path.endsWith(".json")) {
			let descriptor;
			try {
				descriptor = JSON.parse(text);
			} catch {
				descriptor = null;
			}
			if (descriptor && typeof descriptor.prompt === "string")
				references.push(descriptor.prompt);
		}
		for (const rawReference of references) {
			const reference = normalizedReference(rawReference, entry.path);
			if (isHistoricalReferenceException(target, entry.path, reference))
				continue;
			if (
				reference.startsWith("file://") &&
				!reference.startsWith("file://./")
			) {
				throwDistributionError(
					"E_MATERIALIZE_REFERENCE",
					`unsupported file URL in ${entry.path}: ${rawReference}`,
					{
						path: entry.path,
						reference: rawReference,
					},
				);
			}
			if (referenceIsExternal(reference)) continue;
			const targetPath = reference.startsWith("file://")
				? reference.slice("file://".length)
				: reference;
			if (targetPath.startsWith("/") || targetPath === "") {
				throwDistributionError(
					"E_MATERIALIZE_REFERENCE",
					`internal reference is not target-relative: ${entry.path} -> ${rawReference}`,
					{
						path: entry.path,
						reference: rawReference,
					},
				);
			}
			const candidate = path.posix.normalize(
				path.posix.join(path.posix.dirname(entry.path), targetPath),
			);
			if (
				candidate === ".." ||
				candidate.startsWith("../") ||
				!stagedPaths.has(candidate)
			) {
				throwDistributionError(
					"E_MATERIALIZE_REFERENCE",
					`internal reference does not resolve: ${entry.path} -> ${rawReference}`,
					{
						path: entry.path,
						reference: rawReference,
						resolved: candidate,
					},
				);
			}
		}
	}
	return { ok: true };
}

function validateContent(stagingRoot, overlay, files) {
	const forbidden = overlay.validation.forbidden_vocabulary.map((word) =>
		word.toLocaleLowerCase("en-US"),
	);
	const exceptions = HISTORICAL_VOCABULARY_EXCEPTIONS[overlay.target.id] ?? {};
	for (const entry of files) {
		const internalPiRuntime =
			overlay.target.id === "pi" &&
			(entry.path.startsWith("lib/") ||
				entry.path.startsWith("bin/") ||
				entry.path.startsWith("orchestrator-framework/bin/"));
		const text = readText(
			resolveInside(stagingRoot, entry.path, "content path"),
		);
		if (
			!internalPiRuntime &&
			text !== null &&
			hasUnresolvedTemplateToken(text, entry.path, overlay.target.id)
		) {
			throwDistributionError(
				"E_MATERIALIZE_TEMPLATE",
				`unresolved template token in ${entry.path}`,
				{ path: entry.path },
			);
		}
		if (text === null) continue;
		const exceptionWords = new Set(
			(exceptions[entry.path] ?? []).map((word) =>
				word.toLocaleLowerCase("en-US"),
			),
		);
		const found = internalPiRuntime
			? undefined
			: forbidden.find(
					(word) =>
						text.toLocaleLowerCase("en-US").includes(word) &&
						!exceptionWords.has(word),
				);
		if (found) {
			throwDistributionError(
				"E_OVERLAY_VOCABULARY",
				`forbidden host vocabulary in materialized content: ${entry.path}`,
				{
					path: entry.path,
					vocabulary: found,
				},
			);
		}
	}
	return { ok: true };
}

function validateNativeAssets(
	stagingRoot,
	overlay,
	plan,
	sourceRoot,
	overlayBase,
) {
	for (const nativeAsset of overlay.native_assets) {
		const sourceLocation = locateSource(
			sourceRoot,
			overlayBase,
			nativeAsset.source,
		);
		const sourceStat = fs.lstatSync(sourceLocation.path);
		if (!sourceStat.isFile()) {
			throwDistributionError(
				"E_MATERIALIZE_NATIVE",
				`native asset source is not a regular file: ${nativeAsset.source}`,
				{
					source: nativeAsset.source,
				},
			);
		}
		const sourceMode = (sourceStat.mode & 0o7777).toString(8).padStart(4, "0");
		if (!observedModeMatches(nativeAsset.mode, sourceMode)) {
			throwDistributionError(
				"E_MATERIALIZE_MODE",
				`native asset source mode does not match declaration: ${nativeAsset.source}`,
				{
					source: nativeAsset.source,
					expected: nativeAsset.mode,
					actual: sourceMode,
				},
			);
		}
		const destination = resolveInside(
			stagingRoot,
			nativeAsset.destination,
			"native asset destination",
		);
		const destinationEntry = plan.find(
			(entry) =>
				normalizedPathKey(entry.destination) ===
				normalizedPathKey(nativeAsset.destination),
		);
		if (!destinationEntry || destinationEntry.type !== "file") {
			throwDistributionError(
				"E_MATERIALIZE_NATIVE",
				`native asset destination is not a materialized regular file: ${nativeAsset.destination}`,
				{
					destination: nativeAsset.destination,
				},
			);
		}
		if (
			path.resolve(destinationEntry.sourcePath) !==
			path.resolve(sourceLocation.path)
		) {
			throwDistributionError(
				"E_MATERIALIZE_NATIVE",
				`native asset source is not the declared assembly source: ${nativeAsset.source}`,
				{
					source: nativeAsset.source,
					destination: nativeAsset.destination,
				},
			);
		}
		if (!fs.existsSync(destination)) {
			throwDistributionError(
				"E_MATERIALIZE_HASH",
				`native asset is missing: ${nativeAsset.destination}`,
				{ destination: nativeAsset.destination },
			);
		}
		const destinationStat = fs.lstatSync(destination);
		if (!destinationStat.isFile()) {
			throwDistributionError(
				"E_MATERIALIZE_NATIVE",
				`native asset destination is not a regular file: ${nativeAsset.destination}`,
				{
					destination: nativeAsset.destination,
				},
			);
		}
		const destinationMode = (destinationStat.mode & 0o7777)
			.toString(8)
			.padStart(4, "0");
		if (!observedModeMatches(nativeAsset.mode, destinationMode)) {
			throwDistributionError(
				"E_MATERIALIZE_MODE",
				`native asset mode does not match declaration: ${nativeAsset.destination}`,
				{
					destination: nativeAsset.destination,
					expected: nativeAsset.mode,
					actual: destinationMode,
				},
			);
		}
		const actualSource = hashFile(sourceLocation.path);
		const actualDestination = hashFile(destination);
		if (
			actualSource !== nativeAsset.sha256 ||
			actualDestination !== nativeAsset.sha256
		) {
			throwDistributionError(
				"E_MATERIALIZE_HASH",
				`native asset hash mismatch: ${nativeAsset.destination}`,
				{
					source: nativeAsset.source,
					destination: nativeAsset.destination,
					expected: nativeAsset.sha256,
					actualSource,
					actualDestination,
				},
			);
		}
	}
	return { ok: true };
}

function validateProjectedHashes(stagingRoot, projectedOutputs, files) {
	const entriesByPath = new Map(files.map((entry) => [entry.path, entry]));
	for (const output of projectedOutputs) {
		const entry = entriesByPath.get(output.path);
		if (!entry || entry.type !== "file") {
			throwDistributionError(
				"E_MATERIALIZE_HASH",
				`projected inventory entry is missing: ${output.path}`,
				{
					path: output.path,
				},
			);
		}
		const actual = hashFile(
			resolveInside(stagingRoot, output.path, "projected hash path"),
		);
		if (actual !== output.sha256) {
			throwDistributionError(
				"E_MATERIALIZE_HASH",
				`projected inventory hash differs from its manifest: ${output.path}`,
				{
					path: output.path,
					expected: output.sha256,
					actual,
				},
			);
		}
	}
	return {
		ok: true,
		files: projectedOutputs.map(({ path: outputPath }) => outputPath).sort(),
	};
}

function copyPlan(plan, stagingRoot, stagingIdentity) {
	for (const entry of plan) {
		assertPathIdentity(stagingIdentity, {
			label: "staging root",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		const destination = resolveInside(
			stagingRoot,
			entry.destination,
			"assembly destination",
		);
		const destinationParent = path.dirname(destination);
		const parentBefore = capturePathIdentity(destinationParent, {
			root: stagingRoot,
			label: "assembly destination parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		assertPathIdentity(parentBefore, {
			label: "assembly destination parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		ensureDirectoryPath(destinationParent, {
			root: stagingRoot,
			label: "assembly destination parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		const parentAfter = capturePathIdentity(destinationParent, {
			root: stagingRoot,
			label: "assembly destination parent",
			allowMissing: false,
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		assertPathIdentity(parentAfter, {
			label: "assembly destination parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		if (entry.type === "directory") {
			const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
			if (existing?.isSymbolicLink()) {
				throwDistributionError(
					"E_MATERIALIZE_SYMLINK",
					"staging destination must not be a symlink",
					{ destination },
				);
			}
			if (!existing) fs.mkdirSync(destination);
			if (!fs.lstatSync(destination).isDirectory()) {
				throwDistributionError(
					"E_MATERIALIZE_COLLISION",
					"staging destination is not a directory",
					{ destination },
				);
			}
			const sourceMode = fs.statSync(entry.sourcePath).mode & 0o7777;
			fs.chmodSync(
				destination,
				entry.applyMode ? Number.parseInt(entry.mode, 8) : sourceMode,
			);
		} else {
			if (fs.lstatSync(destination, { throwIfNoEntry: false })) {
				throwDistributionError(
					"E_MATERIALIZE_COLLISION",
					"staging destination is not empty",
					{ destination },
				);
			}
			if (entry.type === "symlink") {
				const target = assertSafeSymlink(entry.sourcePath, entry.sourceRoot);
				fs.symlinkSync(target, destination);
			} else {
				fs.copyFileSync(entry.sourcePath, destination);
				const sourceMode = fs.statSync(entry.sourcePath).mode & 0o7777;
				fs.chmodSync(
					destination,
					entry.applyMode ? Number.parseInt(entry.mode, 8) : sourceMode,
				);
			}
		}
		assertPathIdentity(parentAfter, {
			label: "assembly destination parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		assertPathIdentity(stagingIdentity, {
			label: "staging root",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
	}
}

function prepareStagingRoot(stagingRoot, stagingParent) {
	const identity = capturePathIdentity(stagingRoot, {
		root: stagingParent,
		label: "staging root",
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	if (!identity.missing) return true;
	ensureDirectoryPath(stagingRoot, {
		root: stagingParent,
		label: "staging root",
		mode: 0o700,
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	return false;
}

function loadMaterializerOverlay({
	overlay,
	overlayPath,
	inventoryPath,
	overlayContractHash,
}) {
	if (overlay) {
		validateOverlay(overlay);
		return {
			overlay,
			inventory: overlay.inventory,
			inventoryFixture: overlay.inventory,
			contractHash: overlayContractHash ?? null,
			overlayPath: null,
			inventoryPath: null,
		};
	}
	if (!overlayPath || !inventoryPath)
		throwDistributionError(
			"E_OVERLAY_IO",
			"overlayPath and inventoryPath are required",
			{},
		);
	return loadOverlay({ overlayPath, inventoryPath });
}

function projectionPluginRoot(sourceRoot) {
	const candidates = [path.join(sourceRoot, "plugins/maister"), sourceRoot];
	const pluginRoot = candidates.find(
		(candidate) =>
			fs
				.lstatSync(path.join(candidate, "agent-projection-v1.json"), {
					throwIfNoEntry: false,
				})
				?.isFile() &&
			fs
				.lstatSync(path.join(candidate, "agents"), { throwIfNoEntry: false })
				?.isDirectory(),
	);
	if (!pluginRoot) {
		throwDistributionError(
			"E_AGENT_MANIFEST_IO",
			"immutable source does not contain the agent projection inputs",
			{
				sourceRoot,
			},
		);
	}
	return ensureDirectoryRoot(pluginRoot, "agent projection plugin root");
}

function loadProjectionOverlays(pluginRoot) {
	return Object.fromEntries(
		AGENT_PROJECTION_TARGETS.map((target) => {
			const overlayRoot = path.join(pluginRoot, "overlays", target);
			const loaded = loadOverlay({
				overlayPath: path.join(overlayRoot, "overlay.yml"),
				inventoryPath: path.join(overlayRoot, "inventory.yml"),
			});
			return [target, loaded.overlay];
		}),
	);
}

function loadProjectionSupportAssets(pluginRoot, manifest, target) {
	const overlayRoot = path.join(pluginRoot, "overlays", target);
	return manifest.support_inventory
		.filter((support) => support.target === target)
		.flatMap((support) =>
			support.assets.map((asset) => {
				const sourcePath = resolveInside(
					overlayRoot,
					asset.source,
					"projection support source",
				);
				return {
					support_id: support.support_id,
					kind: asset.kind,
					source: asset.source,
					destination: asset.destination,
					mode: asset.mode,
					content: readFileNoFollow(sourcePath, {
						root: overlayRoot,
						label: "projection support source",
						encoding: "utf8",
						errorCode: "E_AGENT_PROJECTION_IO",
					}),
				};
			}),
		);
}

function writeGeneratedPackageFile(
	stagingRoot,
	relativePath,
	content,
	mode = "0644",
) {
	const destination = resolveInside(
		stagingRoot,
		relativePath,
		"generated Pi package file",
	);
	const parent = path.dirname(destination);
	ensureDirectoryPath(parent, {
		root: stagingRoot,
		label: "generated Pi package parent",
		mode: 0o755,
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
	if (existing) {
		throwDistributionError(
			"E_MATERIALIZE_COLLISION",
			`generated Pi package file already exists: ${relativePath}`,
			{
				path: relativePath,
			},
		);
	}
	const bytes = Buffer.from(content, "utf8");
	fs.writeFileSync(destination, bytes, {
		flag: "wx",
		mode: Number.parseInt(mode, 8),
	});
	fs.chmodSync(destination, Number.parseInt(mode, 8));
	return Object.freeze({
		path: relativePath,
		mode,
		size: bytes.length,
		sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
	});
}

const PI_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function piSkillName(name) {
	const normalized = name.replace(/^maister:/u, "maister-");
	return normalized.startsWith("maister-")
		? normalized
		: `maister-${normalized}`;
}

function normalizePiSkillNames(stagingRoot, origins) {
	for (const origin of origins) {
		const skillPath = resolveInside(
			stagingRoot,
			`${origin.destination}/SKILL.md`,
			"Pi skill path",
		);
		const content = fs.readFileSync(skillPath, "utf8");
		const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u.exec(
			content,
		);
		if (!frontmatter) continue;
		const name = /^name:\s*([^\r\n#]+?)\s*$/mu.exec(frontmatter[2]);
		if (!name) continue;
		const projectedName = piSkillName(name[1].trim());
		if (!PI_SKILL_NAME_PATTERN.test(projectedName)) {
			throwDistributionError(
				"E_MATERIALIZE_SYNTAX",
				`invalid projected Pi skill name: ${projectedName}`,
				{
					path: `${origin.destination}/SKILL.md`,
					name: projectedName,
				},
			);
		}
		if (projectedName === name[1].trim()) continue;
		const projectedFrontmatter = frontmatter[2].replace(
			name[0],
			`name: ${projectedName}`,
		);
		const projectedContent = `${frontmatter[1]}${projectedFrontmatter}${frontmatter[3]}${content.slice(frontmatter[0].length)}`;
		fs.writeFileSync(skillPath, projectedContent, "utf8");
	}
}

function piPackageManifestText() {
	return `${JSON.stringify(PI_PACKAGE_MANIFEST, null, 2)}\n`;
}

function piSourceManifestText(source, contentHash = null) {
	return `${canonicalJson({
		schema_version: 1,
		source_commit: source.resolvedCommit,
		source_version: source.sourceVersion,
		content_hash: contentHash,
	})}\n`;
}

function finalizePiSourceManifest(stagingRoot, source) {
	writeGeneratedPackageFile(
		stagingRoot,
		".maister-source.json",
		piSourceManifestText(source),
		"0644",
	);
	const contentHash = hashTree(stagingRoot, {
		ignore: (relative) => relative === ".maister-source.json",
	}).contentHash;
	const manifestPath = resolveInside(
		stagingRoot,
		".maister-source.json",
		"Pi source manifest",
	);
	fs.writeFileSync(manifestPath, piSourceManifestText(source, contentHash), {
		encoding: "utf8",
	});
	fs.chmodSync(manifestPath, 0o644);
	return contentHash;
}

function preparePiPackage({
	sourceRoot,
	stagingRoot,
	overlay,
	projectionContract,
}) {
	const pluginRoot = projectionPluginRoot(sourceRoot);
	const commandOrigins = overlay.inventory.command_origins;
	const commandProjection = createPiCommandProjection({
		sourceRoot: pluginRoot,
		origins: commandOrigins,
	});
	const commandOutputs = projectPiCommands({
		sourceRoot: pluginRoot,
		origins: commandOrigins,
	});
	writeGeneratedPackageFile(
		stagingRoot,
		"package.json",
		piPackageManifestText(),
		"0644",
	);
	writeGeneratedPackageFile(
		stagingRoot,
		"agent-projection-v1.json",
		`${canonicalJson(projectionContract)}\n`,
		"0644",
	);
	writeGeneratedPackageFile(
		stagingRoot,
		"pi-command-projection-v1.json",
		`${canonicalJson(commandProjection)}\n`,
		"0644",
	);
	writeGeneratedPackageFile(
		stagingRoot,
		"extensions/maister.ts",
		PI_EXTENSION_SOURCE,
		"0644",
	);
	for (const output of commandOutputs)
		writeGeneratedPackageFile(
			stagingRoot,
			output.path,
			output.content,
			output.mode,
		);
	adaptMaterializedFlowSkills(stagingRoot, "pi", {
		canonicalSkillsRoot: path.join(projectionPluginRoot(sourceRoot), "skills"),
	});
	normalizePiSkillNames(stagingRoot, overlay.inventory.skill_origins ?? []);
	return Object.freeze({ commandProjection, commandOutputs });
}

function canonicalProjectionPaths(overlay) {
	const paths = new Set();
	for (const roleId of overlay.agent_projection.canonical_roles) {
		for (const destination of overlay.agent_projection.destinations) {
			paths.add(
				normalizedPathKey(
					destination.path_template.replaceAll("{role_id}", roleId),
				),
			);
		}
	}
	return paths;
}

function withoutProjectionOwnedLeaves(plan, overlay) {
	const projectedPaths = canonicalProjectionPaths(overlay);
	return Object.freeze(
		plan.filter(
			(entry) =>
				entry.type === "directory" ||
				!projectedPaths.has(normalizedPathKey(entry.destination)),
		),
	);
}

function projectCanonicalAgents({ sourceRoot, selectedOverlay, stagingRoot }) {
	const pluginRoot = projectionPluginRoot(sourceRoot);
	const projectionContract = loadAgentProjectionContract({
		projectionPath: path.join(pluginRoot, "agent-projection-v1.json"),
	});
	const overlays = loadProjectionOverlays(pluginRoot);
	const target = selectedOverlay.target.id;
	if (
		canonicalJson(overlays[target].agent_projection) !==
		canonicalJson(selectedOverlay.agent_projection)
	) {
		throwDistributionError(
			"E_AGENT_MANIFEST_TARGET",
			"selected overlay projection differs from immutable source",
			{ target },
		);
	}
	const agentIr = loadCanonicalAgentIr({
		agentsRoot: path.join(pluginRoot, "agents"),
		skillsRoot: path.join(pluginRoot, "skills"),
		expectedRoleIds: projectionContract.expected_role_ids,
	});
	const manifest = buildAgentManifest({
		agentIr,
		projectionContract,
		overlays,
	});
	const supportAssets = loadProjectionSupportAssets(
		pluginRoot,
		manifest,
		target,
	);
	return projectAgents({
		agentIr,
		manifest,
		target,
		stagingRoot,
		supportAssets,
	});
}

function buildTargetAssemblyPlan({
	sourceRoot,
	overlay,
	overlayBase,
	stagingRoot,
}) {
	if (overlay.target.id === "pi") {
		return buildPiPackagePlan({ sourceRoot, overlay, stagingRoot });
	}
	return buildAssemblyPlan({ sourceRoot, overlay, overlayBase, stagingRoot });
}

function announcePhase(options, phase, details = {}) {
	options.testHooks?.onPhase?.(phase, details);
}

export async function materialize(options) {
	const loaded = loadMaterializerOverlay(options);
	if (options.target && loaded.overlay.target.id !== options.target) {
		throwDistributionError(
			"E_OVERLAY_TARGET",
			"overlay target does not match requested target",
			{ requested: options.target, actual: loaded.overlay.target.id },
		);
	}
	const source = options.resolvedSource
		? await revalidateResolvedSource(options.resolvedSource, options)
		: await resolveSource(options.source, options);
	if (!source.root)
		throwDistributionError(
			"E_SOURCE_CONTENT",
			"resolved source does not have a checkout root",
			{ source: source.requestedSource },
		);
	announcePhase(options, "source-revalidated", { source });
	const stagingRoot = path.resolve(options.stagingRoot ?? "");
	if (!options.stagingRoot)
		throwDistributionError("E_MATERIALIZE_IO", "stagingRoot is required", {});
	const stagingParent = path.dirname(stagingRoot);
	const stagingAnchor = existingPathAnchor(stagingParent);
	const stagingParentBefore = capturePathIdentity(stagingParent, {
		root: stagingAnchor,
		label: "staging parent",
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	options.testHooks?.afterStagingParentValidation?.({
		stagingParent,
		stagingRoot,
	});
	assertPathIdentity(stagingParentBefore, {
		label: "staging parent",
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	ensureDirectoryPath(stagingParent, {
		root: stagingAnchor,
		label: "staging parent",
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	const stagingParentIdentity = capturePathIdentity(stagingParent, {
		root: stagingAnchor,
		label: "staging parent",
		allowMissing: false,
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	assertPathIdentity(stagingParentIdentity, {
		label: "staging parent",
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	const createdStaging = !prepareStagingRoot(stagingRoot, stagingParent);
	if (fs.readdirSync(stagingRoot).length > 0)
		throwDistributionError("E_MATERIALIZE_IO", "staging root must be empty", {
			stagingRoot,
		});
	const stagingIdentity = capturePathIdentity(stagingRoot, {
		root: stagingParent,
		label: "staging root",
		allowMissing: false,
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	assertPathIdentity(stagingIdentity, {
		label: "staging root",
		errorCode: "E_MATERIALIZE_SYMLINK",
	});
	assertSameFilesystem(source.root, stagingRoot);
	const overlayBase = loaded.overlayPath
		? path.dirname(loaded.overlayPath)
		: options.overlayBase;
	let plan;
	let packageArtifacts = null;
	try {
		assertPathIdentity(stagingParentIdentity, {
			label: "staging parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		assertPathIdentity(stagingIdentity, {
			label: "staging root",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		plan = withoutProjectionOwnedLeaves(
			buildTargetAssemblyPlan({
				sourceRoot: source.root,
				overlay: loaded.overlay,
				overlayBase,
				stagingRoot,
			}),
			loaded.overlay,
		);
		const sourceBeforeAssembly = await revalidateResolvedSource(
			source,
			options,
		);
		copyPlan(plan, stagingRoot, stagingIdentity);
		if (loaded.overlay.target.id !== "pi") {
			adaptMaterializedFlowSkills(stagingRoot, loaded.overlay.target.id, {
				canonicalSkillsRoot: path.join(
					projectionPluginRoot(sourceBeforeAssembly.root),
					"skills",
				),
			});
		}
		announcePhase(options, "assembly-complete", { stagingRoot, plan });
		options.testHooks?.afterAssembly?.({
			source: sourceBeforeAssembly,
			stagingRoot,
			plan,
		});
		const sourceAfterAssembly = await revalidateResolvedSource(
			sourceBeforeAssembly,
			options,
		);
		announcePhase(options, "source-revalidated-after-assembly", {
			source: sourceAfterAssembly,
		});
		assertPathIdentity(stagingParentIdentity, {
			label: "staging parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		assertPathIdentity(stagingIdentity, {
			label: "staging root",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		if (loaded.overlay.target.id === "pi") {
			const pluginRoot = projectionPluginRoot(sourceAfterAssembly.root);
			const projectionContract = loadAgentProjectionContract({
				projectionPath: path.join(pluginRoot, "agent-projection-v1.json"),
			});
			packageArtifacts = preparePiPackage({
				sourceRoot: sourceAfterAssembly.root,
				stagingRoot,
				overlay: loaded.overlay,
				projectionContract,
			});
		}
		const projection = projectCanonicalAgents({
			sourceRoot: sourceAfterAssembly.root,
			selectedOverlay: loaded.overlay,
			stagingRoot,
		});
		announcePhase(options, "projection-complete", { stagingRoot, projection });
		options.testHooks?.afterProjection?.({
			source: sourceAfterAssembly,
			stagingRoot,
			plan,
			projection,
		});
		if (loaded.overlay.target.id === "pi")
			finalizePiSourceManifest(stagingRoot, sourceAfterAssembly);
		const sourceAfterProjection = await revalidateResolvedSource(
			sourceAfterAssembly,
			options,
		);
		assertPathIdentity(stagingParentIdentity, {
			label: "staging parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		assertPathIdentity(stagingIdentity, {
			label: "staging root",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		const staged = stagingEntries(stagingRoot);
		announcePhase(options, "staging-enumerated", {
			stagingRoot,
			entries: staged.entries,
		});
		const projectedOutputs = [
			...projection.outputs,
			...(packageArtifacts?.commandOutputs ?? []),
		];
		const validation = {
			inventory: validateInventory(
				stagingRoot,
				loaded.inventory,
				staged.entries,
			),
			syntax: validateSyntax(
				stagingRoot,
				loaded.overlay.validation.syntax_checks,
				staged.files,
			),
			modes: validateModes(
				stagingRoot,
				loaded.overlay.validation.executable_paths,
				staged.files,
				projectedOutputs,
			),
			references: validateInternalReferences(
				stagingRoot,
				loaded.overlay.target.id,
				staged.files,
				staged.entries,
			),
			hashes: Object.freeze({
				ok: true,
				native: validateNativeAssets(
					stagingRoot,
					loaded.overlay,
					plan,
					source.root,
					overlayBase,
				),
				projected: validateProjectedHashes(
					stagingRoot,
					projectedOutputs,
					staged.files,
				),
			}),
			content: validateContent(stagingRoot, loaded.overlay, staged.files),
		};
		announcePhase(options, "candidate-validated", { stagingRoot, validation });
		assertPathIdentity(stagingParentIdentity, {
			label: "staging parent",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		assertPathIdentity(stagingIdentity, {
			label: "staging root",
			errorCode: "E_MATERIALIZE_SYMLINK",
		});
		const contentHash = staged.tree.contentHash;
		const provenance = createProvenance({
			source: sourceAfterProjection,
			overlay: { ...loaded.overlay, contractHash: loaded.contractHash },
			hostVersion: options.hostVersion,
			contentHash,
			agentProjection: projection,
		});
		announcePhase(options, "provenance-finalized", { stagingRoot, provenance });
		return {
			stagingRoot,
			target: loaded.overlay.target.id,
			overlayVersion: loaded.overlay.overlay_version,
			plan,
			validation,
			projection,
			commandProjection: packageArtifacts?.commandProjection ?? null,
			provenance,
			sourceBinding: Object.freeze({
				kind: sourceAfterProjection.kind,
				root: sourceAfterProjection.root,
				archive: sourceAfterProjection.archive === true,
				requestedSource: sourceAfterProjection.requestedSource,
				requestedRef: sourceAfterProjection.requestedRef,
				resolvedCommit: sourceAfterProjection.resolvedCommit,
				sourceVersion: sourceAfterProjection.sourceVersion,
				contentHash: sourceAfterProjection.contentHash,
				dirty: sourceAfterProjection.dirty,
				statusFingerprint: sourceAfterProjection.statusFingerprint,
				statusEntries: Object.freeze([
					...(sourceAfterProjection.statusEntries ?? []),
				]),
			}),
			contentHash,
		};
	} catch (error) {
		if (createdStaging)
			fs.rmSync(stagingRoot, { recursive: true, force: true });
		if (
			error instanceof DistributionError ||
			error instanceof AgentIrValidationError ||
			error instanceof AgentManifestValidationError ||
			error instanceof AgentProjectionError
		)
			throw error;
		throwDistributionError(
			"E_MATERIALIZE_FAILED",
			`materialization failed: ${error.message}`,
			{ stagingRoot },
			{ cause: error },
		);
	}
}

export { DistributionError, validateInventory, validateSyntax, validateModes };
