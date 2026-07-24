import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
	assertPathIdentity,
	capturePathIdentity,
	distributionError,
	readFileNoFollow,
	throwDistributionError,
	withMutationBoundary,
} from "./path-safety.mjs";
import { canonicalJson } from "./provenance.mjs";

const MANAGED_ARRAY_OWNERSHIP_SCHEMA = "managed_array_entries_v1";
const PI_LOCAL_PACKAGE_SCHEMA = "pi_local_package_v1";
const MANAGED_ARRAY_FILTERS = Object.freeze({
	extensions: "./extensions/maister.ts",
	skills: "./skills",
	prompts: "./prompts",
});

function getNested(object, dotted) {
	return dotted
		.split(".")
		.reduce(
			(current, key) =>
				current === undefined || current === null ? undefined : current[key],
			object,
		);
}

function setNested(object, dotted, value) {
	const parts = dotted.split(".");
	let current = object;
	for (const part of parts.slice(0, -1)) {
		if (
			!current[part] ||
			typeof current[part] !== "object" ||
			Array.isArray(current[part])
		)
			current[part] = {};
		current = current[part];
	}
	current[parts.at(-1)] = value;
}

function deleteNested(object, dotted) {
	const parts = dotted.split(".");
	const parents = [];
	let current = object;
	for (const part of parts.slice(0, -1)) {
		if (!current || typeof current !== "object") return;
		parents.push([current, part]);
		current = current[part];
	}
	if (current && typeof current === "object") delete current[parts.at(-1)];
	for (const [parent, part] of parents.toReversed()) {
		if (
			parent[part] &&
			typeof parent[part] === "object" &&
			!Array.isArray(parent[part]) &&
			Object.keys(parent[part]).length === 0
		)
			delete parent[part];
	}
}

function jsonPathValue(object, dotted) {
	return dotted
		.split(".")
		.reduce(
			(current, key) =>
				current === undefined || current === null ? undefined : current[key],
			object,
		);
}

function cloneJson(value) {
	return value === undefined ? undefined : structuredClone(value);
}

function isContained(root, candidate) {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

function realpathAllowMissing(candidate) {
	let current = path.resolve(candidate);
	const suffix = [];
	while (!fs.lstatSync(current, { throwIfNoEntry: false })) {
		const parent = path.dirname(current);
		if (parent === current) return current;
		suffix.unshift(path.basename(current));
		current = parent;
	}
	return path.resolve(fs.realpathSync.native(current), ...suffix);
}

function isLocalPathSource(source) {
	return (
		source === "." ||
		source === ".." ||
		source.startsWith("./") ||
		source.startsWith("../") ||
		source.startsWith("/") ||
		source === "~" ||
		source.startsWith("~/")
	);
}

function normalizedSourcePath(
	source,
	{
		settingsPath,
		agentRoot,
		homeRoot = os.homedir(),
		strictContainment = false,
	},
) {
	if (
		typeof source !== "string" ||
		source.length === 0 ||
		source.includes("\0")
	)
		return null;
	const normalizedSource = source.normalize("NFC").replaceAll("\\", "/");
	if (!isLocalPathSource(normalizedSource)) return null;
	const expanded =
		normalizedSource === "~" || normalizedSource.startsWith("~/")
			? path.join(
					path.resolve(homeRoot),
					normalizedSource === "~" ? "" : normalizedSource.slice(2),
				)
			: normalizedSource;
	const lexical = path.resolve(path.dirname(settingsPath), expanded);
	const resolved = realpathAllowMissing(lexical);
	if (!isContained(agentRoot, resolved)) {
		if (strictContainment) {
			throwDistributionError(
				"E_SETTINGS_PATH",
				"managed package identity escapes the Pi agent root",
				{
					source,
					agentRoot,
					resolved,
				},
			);
		}
		return null;
	}
	return path.normalize(resolved).normalize("NFC");
}

function expectedManagedArrayIdentity({ targetPath, activeRoot }) {
	const agentRoot = path.dirname(activeRoot);
	const resolvedAgentRoot = realpathAllowMissing(agentRoot);
	const identity = realpathAllowMissing(activeRoot);
	if (!isContained(resolvedAgentRoot, identity)) {
		throwDistributionError(
			"E_SETTINGS_PATH",
			"managed package root escapes the Pi agent root",
			{
				activeRoot,
				agentRoot,
				identity,
			},
		);
	}
	return (
		normalizedSourcePath(
			path
				.relative(path.dirname(targetPath), activeRoot)
				.split(path.sep)
				.join("/"),
			{
				settingsPath: targetPath,
				agentRoot: resolvedAgentRoot,
				strictContainment: true,
			},
		) ?? identity
	);
}

function parseJsonSettings(text, location) {
	if (!text.trim()) return {};
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw distributionError(
			"E_SETTINGS_SYNTAX",
			"managed JSON settings are invalid",
			{ path: location },
			{ cause: error },
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throwDistributionError(
			"E_SETTINGS_SYNTAX",
			"managed JSON settings must be an object",
			{ path: location },
		);
	}
	return parsed;
}

function serializeJsonSettings(text, parsed) {
	const indentMatch = text.match(/\n([ \t]+)"/u);
	const indent = indentMatch ? indentMatch[1] : 2;
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	return `${JSON.stringify(parsed, null, indent).replaceAll("\n", newline)}${newline}`;
}

function settingsArray(settings, arrayPath, location) {
	const value = jsonPathValue(settings, arrayPath);
	if (value === undefined) return null;
	if (!Array.isArray(value))
		throwDistributionError(
			"E_SETTINGS_SYNTAX",
			`${location}.${arrayPath} must be an array`,
			{ path: location, array_path: arrayPath },
		);
	return value;
}

function packageEntrySource(entry) {
	if (typeof entry === "string") return entry;
	if (
		entry &&
		typeof entry === "object" &&
		!Array.isArray(entry) &&
		typeof entry.source === "string"
	)
		return entry.source;
	return null;
}

function normalizedPackageEntry(entry, context) {
	const source = packageEntrySource(entry);
	return source === null ? null : normalizedSourcePath(source, context);
}

function assertPackageFilters(entry, location) {
	if (entry && typeof entry === "object" && !Array.isArray(entry)) {
		if (entry.autoload === false)
			throwDistributionError(
				"E_SETTINGS_FILTER",
				"managed Pi package entry disables autoload",
				{ path: location },
			);
		for (const [field, required] of Object.entries(MANAGED_ARRAY_FILTERS)) {
			if (!Object.hasOwn(entry, field)) continue;
			if (!Array.isArray(entry[field]) || !entry[field].includes(required)) {
				throwDistributionError(
					"E_SETTINGS_FILTER",
					`managed Pi package entry excludes required ${field} resource`,
					{
						path: location,
						field,
						required,
					},
				);
			}
		}
	}
}

function unmanagedProjectionHash(settings, arrayPath, identity, context) {
	const projection = cloneJson(settings);
	const entries = settingsArray(projection, arrayPath, "settings");
	if (entries !== null) {
		const unmanaged = entries.filter(
			(entry) => normalizedPackageEntry(entry, context) !== identity,
		);
		if (unmanaged.length === 0) deleteNested(projection, arrayPath);
		else setNested(projection, arrayPath, unmanaged);
	}
	return sha256(Buffer.from(canonicalJson(projection), "utf8"));
}

function readManagedArrayState({
	definition,
	targetPath,
	activeRoot,
	homeRoot = os.homedir(),
}) {
	if (
		definition.format !== "json" ||
		definition.ownership !== "managed_array_entries"
	) {
		throwDistributionError(
			"E_SETTINGS_FORMAT",
			"managed-array preparation requires JSON managed_array_entries settings",
			{ path: definition.path },
		);
	}
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (stat?.isSymbolicLink())
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must not be a symlink: ${definition.path}`,
			{ path: definition.path },
		);
	if (stat && !stat.isFile())
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must be a regular file: ${definition.path}`,
			{ path: definition.path },
		);
	const exists = Boolean(stat);
	const before = exists
		? readFileNoFollow(targetPath, {
				root: path.dirname(targetPath),
				label: "settings target",
				errorCode: "E_SETTINGS_PATH",
			})
		: Buffer.alloc(0);
	const beforeText = before.toString("utf8");
	const parsed = parseJsonSettings(beforeText, definition.path);
	const entries = settingsArray(parsed, definition.array_path, definition.path);
	const agentRoot = realpathAllowMissing(path.dirname(activeRoot));
	const identity = expectedManagedArrayIdentity({ targetPath, activeRoot });
	const context = { settingsPath: targetPath, agentRoot, homeRoot };
	const matches = (entries ?? []).flatMap((entry, index) =>
		normalizedPackageEntry(entry, context) === identity
			? [{ entry, index }]
			: [],
	);
	if (matches.length > 1)
		throwDistributionError(
			"E_SETTINGS_DUPLICATE",
			"multiple Pi package entries resolve to the managed identity",
			{ path: definition.path, identity },
		);
	const existing = matches[0]?.entry ?? null;
	if (existing !== null) assertPackageFilters(existing, definition.path);
	const configuredEntry = definition.entries[0];
	const entryAfter =
		existing === null
			? cloneJson(
					typeof configuredEntry === "string"
						? configuredEntry
						: configuredEntry.source,
				)
			: cloneJson(existing);
	const candidate = cloneJson(parsed);
	const candidateEntries = entries ?? [];
	if (entries === null)
		setNested(candidate, definition.array_path, [entryAfter]);
	else if (existing === null)
		setNested(candidate, definition.array_path, [
			...candidateEntries,
			entryAfter,
		]);
	const candidateText = serializeJsonSettings(beforeText, candidate);
	const candidateBytes = Buffer.from(candidateText, "utf8");
	const beforeProjection = unmanagedProjectionHash(
		parsed,
		definition.array_path,
		identity,
		context,
	);
	const afterProjection = unmanagedProjectionHash(
		candidate,
		definition.array_path,
		identity,
		context,
	);
	if (beforeProjection !== afterProjection)
		throwDistributionError(
			"E_SETTINGS_MERGE",
			"managed Pi package merge changed unmanaged settings projection",
			{ path: definition.path },
		);
	const modeBefore = exists ? formatMode(stat.mode & 0o7777) : null;
	return {
		...definition,
		targetPath,
		bytes: candidateBytes,
		beforeSha256: exists ? sha256(before) : null,
		afterSha256: sha256(candidateBytes),
		beforeMode: modeBefore,
		mode: modeBefore ?? "0600",
		managedValues: null,
		managedArray: {
			ownership_schema: MANAGED_ARRAY_OWNERSHIP_SCHEMA,
			merge_schema: PI_LOCAL_PACKAGE_SCHEMA,
			settings_path: definition.path,
			array_path: definition.array_path,
			normalized_identity: identity,
			entry_representation:
				typeof entryAfter === "string" ? "string" : "object",
			entry_before: existing,
			entry_after: entryAfter,
			unmanaged_projection_sha256: afterProjection,
			mode_before: modeBefore,
			mode_after: modeBefore ?? "0600",
		},
	};
}

function assertManagedArrayEntryShape(entry, location) {
	if (typeof entry === "string") return;
	if (
		!entry ||
		typeof entry !== "object" ||
		Array.isArray(entry) ||
		typeof entry.source !== "string"
	) {
		throwDistributionError(
			"E_SETTINGS_SCHEMA",
			`managed Pi package entry is invalid: ${location}`,
			{ path: location },
		);
	}
	assertPackageFilters(entry, location);
}

export function assertManagedArrayUnchanged({
	definition,
	targetPath,
	activeRoot,
	receiptSetting = null,
	homeRoot = os.homedir(),
}) {
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (!stat || stat.isSymbolicLink() || !stat.isFile())
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi settings file is missing or unsafe",
			{ path: definition.path },
		);
	const bytes = readFileNoFollow(targetPath, {
		root: path.dirname(targetPath),
		label: "settings target",
		errorCode: "E_SETTINGS_PATH",
	});
	const text = bytes.toString("utf8");
	const parsed = parseJsonSettings(text, definition.path);
	const entries = settingsArray(parsed, definition.array_path, definition.path);
	if (entries === null)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi settings array is missing",
			{ path: definition.path, array_path: definition.array_path },
		);
	const identity = expectedManagedArrayIdentity({ targetPath, activeRoot });
	const context = {
		settingsPath: targetPath,
		agentRoot: realpathAllowMissing(path.dirname(activeRoot)),
		homeRoot,
	};
	const matches = entries.flatMap((entry, index) =>
		normalizedPackageEntry(entry, context) === identity
			? [{ entry, index }]
			: [],
	);
	if (matches.length !== 1)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi package identity is missing or duplicated",
			{ path: definition.path, identity, matches: matches.length },
		);
	try {
		assertManagedArrayEntryShape(matches[0].entry, definition.path);
	} catch (error) {
		if (receiptSetting && error?.kind === "E_SETTINGS_FILTER") {
			throwDistributionError(
				"E_DRIFT_CONFLICT",
				"managed Pi package entry filters have drifted",
				{ path: definition.path },
				{ cause: error },
			);
		}
		throw error;
	}
	if (!receiptSetting) return true;
	if (receiptSetting.after_sha256 !== sha256(bytes))
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi settings file bytes have drifted",
			{ path: definition.path },
		);
	const mode = formatMode(stat.mode & 0o7777);
	if (receiptSetting.mode_after !== mode && receiptSetting.mode !== mode)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi settings mode has drifted",
			{
				path: definition.path,
				expected: receiptSetting.mode_after ?? receiptSetting.mode,
				actual: mode,
			},
		);
	if (
		canonicalJson(matches[0].entry) !==
		canonicalJson(receiptSetting.entry_after)
	)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi package entry has drifted",
			{ path: definition.path },
		);
	const projection = unmanagedProjectionHash(
		parsed,
		definition.array_path,
		identity,
		context,
	);
	if (projection !== receiptSetting.unmanaged_projection_sha256)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"unmanaged Pi settings projection has drifted",
			{ path: definition.path },
		);
	return true;
}

export function removeManagedArrayEntry({
	definition,
	targetPath,
	activeRoot,
	expected = null,
	homeRoot = os.homedir(),
	returnDetails = false,
}) {
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (!stat) return null;
	if (stat.isSymbolicLink() || !stat.isFile())
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must be a regular file: ${definition.path}`,
			{ path: definition.path },
		);
	const before = readFileNoFollow(targetPath, {
		root: path.dirname(targetPath),
		label: "settings target",
		encoding: "utf8",
		errorCode: "E_SETTINGS_PATH",
	});
	const parsed = parseJsonSettings(before, definition.path);
	const entries = settingsArray(parsed, definition.array_path, definition.path);
	if (entries === null)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi settings array is missing",
			{ path: definition.path },
		);
	const identity = expectedManagedArrayIdentity({ targetPath, activeRoot });
	const context = {
		settingsPath: targetPath,
		agentRoot: realpathAllowMissing(path.dirname(activeRoot)),
		homeRoot,
	};
	const matches = entries.filter(
		(entry) => normalizedPackageEntry(entry, context) === identity,
	);
	if (matches.length !== 1)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi package identity is missing or duplicated",
			{ path: definition.path, identity, matches: matches.length },
		);
	assertManagedArrayEntryShape(matches[0], definition.path);
	if (
		expected?.entry_after !== undefined &&
		canonicalJson(matches[0]) !== canonicalJson(expected.entry_after)
	)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed Pi package entry has drifted before removal",
			{ path: definition.path },
		);
	const candidate = cloneJson(parsed);
	setNested(
		candidate,
		definition.array_path,
		entries.filter(
			(entry) => normalizedPackageEntry(entry, context) !== identity,
		),
	);
	const bytes = Buffer.from(serializeJsonSettings(before, candidate), "utf8");
	return returnDetails
		? {
				bytes,
				expected: {
					exists: true,
					sha256: sha256(Buffer.from(before, "utf8")),
					mode: formatMode(stat.mode & 0o7777),
				},
			}
		: bytes;
}

function jsonCandidate(text, keys, desired) {
	let parsed = {};
	if (text.trim()) {
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw distributionError(
				"E_SETTINGS_SYNTAX",
				"managed JSON settings are invalid",
				{},
				{ cause: error },
			);
		}
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throwDistributionError(
			"E_SETTINGS_SYNTAX",
			"managed JSON settings must be an object",
			{},
		);
	for (const key of keys) setNested(parsed, key, desired[key]);
	const indentMatch = text.match(/\n([ \t]+)"/u);
	const indent = indentMatch ? indentMatch[1] : 2;
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	return `${JSON.stringify(parsed, null, indent).replaceAll("\n", newline)}${newline}`;
}

function tomlValue(value) {
	if (typeof value === "boolean" || typeof value === "number")
		return String(value);
	return JSON.stringify(value);
}

function tomlValues(text, keys) {
	const values = {};
	for (const key of keys) {
		const expression = new RegExp(
			`^\\s*${key.replaceAll(".", "\\.")}\\s*=\\s*(.*?)\\s*(?:#.*)?$`,
			"gmu",
		);
		let match;
		while ((match = expression.exec(text)) !== null) {
			const raw = match[1].trim();
			try {
				values[key] =
					raw === "true" ? true : raw === "false" ? false : JSON.parse(raw);
			} catch {
				values[key] = raw;
			}
		}
	}
	return values;
}

function tomlCandidate(text, keys, desired) {
	let result = text || "";
	for (const key of keys) {
		const expression = new RegExp(
			`^(\\s*)${key.replaceAll(".", "\\.")}\\s*=.*$`,
			"mu",
		);
		const replacement = `${key} = ${tomlValue(desired[key])}`;
		if (expression.test(result))
			result = result.replace(
				expression,
				(match, indent) => `${indent}${replacement}`,
			);
		else
			result += `${result.length > 0 && !result.endsWith("\n") ? "\n" : ""}${replacement}\n`;
	}
	return result;
}

export function desiredManagedValues({ target, activeRoot, keys }) {
	const values = {};
	for (const key of keys) {
		if (key === "plugins.maister")
			values[key] =
				target === "codex" ? true : { enabled: true, root: activeRoot };
		else if (key === "chat.defaultAgent") values[key] = "maister";
		else if (key === "mcpServers.playwright")
			values[key] = { command: "npx", args: ["@playwright/mcp@latest"] };
		else values[key] = true;
	}
	return values;
}

function desiredManagedValuesFromStaged({
	definition,
	stagedPath,
	target,
	activeRoot,
}) {
	const values = desiredManagedValues({
		target,
		activeRoot,
		keys: definition.managed_keys,
	});
	if (
		definition.format !== "json" ||
		!stagedPath ||
		!fs.lstatSync(stagedPath, { throwIfNoEntry: false })
	)
		return values;
	const staged = parseJsonSettings(
		readFileNoFollow(stagedPath, {
			root: path.dirname(stagedPath),
			label: "staged setting",
			errorCode: "E_SETTINGS_PATH",
		}).toString("utf8"),
		definition.path,
	);
	for (const key of definition.managed_keys) {
		const value = getNested(staged, key);
		if (value !== undefined) values[key] = cloneJson(value);
	}
	return values;
}

export function parseManagedValues(text, format, keys) {
	if (format === "json") {
		let parsed = {};
		if (text.trim()) {
			try {
				parsed = JSON.parse(text);
			} catch (error) {
				throw distributionError(
					"E_SETTINGS_SYNTAX",
					"managed JSON settings are invalid",
					{},
					{ cause: error },
				);
			}
		}
		return Object.fromEntries(keys.map((key) => [key, getNested(parsed, key)]));
	}
	if (format === "toml") return tomlValues(text, keys);
	throwDistributionError(
		"E_SETTINGS_FORMAT",
		`managed-key format is not supported: ${format}`,
		{ format },
	);
}

export function prepareSetting({
	definition,
	targetPath,
	target,
	activeRoot,
	stagedPath,
	homeRoot = os.homedir(),
}) {
	if (definition.ownership === "managed_array_entries") {
		return readManagedArrayState({
			definition,
			targetPath,
			activeRoot,
			homeRoot,
		});
	}
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (stat?.isSymbolicLink())
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must not be a symlink: ${definition.path}`,
			{ path: definition.path },
		);
	if (stat && !stat.isFile())
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must be a regular file: ${definition.path}`,
			{ path: definition.path },
		);
	const exists = stat !== undefined && stat !== null;
	const targetIdentity = capturePathIdentity(targetPath, {
		root: path.dirname(targetPath),
		label: "settings target",
		allowMissing: true,
		errorCode: "E_SETTINGS_PATH",
	});
	const before = exists
		? readFileNoFollow(targetPath, {
				root: path.dirname(targetPath),
				label: "settings target",
				errorCode: "E_SETTINGS_PATH",
			})
		: Buffer.alloc(0);
	assertPathIdentity(targetIdentity, {
		label: "settings target",
		errorCode: "E_SETTINGS_PATH",
	});
	const beforeText = before.toString("utf8");
	const beforeMode = exists ? formatMode(stat.mode & 0o7777) : null;
	const mode = beforeMode ?? "0600";
	if (definition.ownership === "whole_file") {
		const stagedStat = stagedPath
			? fs.lstatSync(stagedPath, { throwIfNoEntry: false })
			: null;
		if (!stagedStat || !stagedStat.isFile() || stagedStat.isSymbolicLink()) {
			throwDistributionError(
				"E_SETTINGS_SOURCE",
				`whole-file setting has no staged candidate: ${definition.path}`,
				{ path: definition.path },
			);
		}
		const candidate = readFileNoFollow(stagedPath, {
			root: path.dirname(stagedPath),
			label: "staged setting",
			errorCode: "E_SETTINGS_PATH",
		});
		return {
			...definition,
			path: definition.path,
			targetPath,
			bytes: candidate,
			beforeSha256: exists ? sha256(before) : null,
			afterSha256: sha256(candidate),
			beforeMode,
			mode,
			managedValues: null,
		};
	}
	const desired = desiredManagedValuesFromStaged({
		definition,
		stagedPath,
		target,
		activeRoot,
	});
	const candidateText =
		definition.format === "json"
			? jsonCandidate(beforeText, definition.managed_keys, desired)
			: tomlCandidate(beforeText, definition.managed_keys, desired);
	return {
		...definition,
		path: definition.path,
		targetPath,
		bytes: Buffer.from(candidateText, "utf8"),
		beforeSha256: exists ? sha256(before) : null,
		afterSha256: sha256(Buffer.from(candidateText, "utf8")),
		beforeMode,
		mode,
		managedValues: desired,
	};
}

export function assertManagedKeysUnchanged({
	definition,
	targetPath,
	target,
	activeRoot,
	receiptSetting = null,
}) {
	if (definition.ownership !== "managed_keys") return;
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (!stat) return;
	if (stat.isSymbolicLink() || !stat.isFile())
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must be a regular file: ${definition.path}`,
			{ path: definition.path },
		);
	const current = parseManagedValues(
		readFileNoFollow(targetPath, {
			root: path.dirname(targetPath),
			label: "settings target",
			encoding: "utf8",
			errorCode: "E_SETTINGS_PATH",
		}),
		definition.format,
		definition.managed_keys,
	);
	const expected =
		receiptSetting?.managed_values ??
		desiredManagedValues({ target, activeRoot, keys: definition.managed_keys });
	for (const key of definition.managed_keys) {
		if (JSON.stringify(current[key]) !== JSON.stringify(expected[key])) {
			throwDistributionError(
				"E_DRIFT_CONFLICT",
				`owned settings key has drifted: ${definition.path}.${key}`,
				{ path: definition.path, key },
			);
		}
	}
}

export function removeManagedKeys({
	definition,
	targetPath,
	returnDetails = false,
}) {
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (!stat) return null;
	if (stat.isSymbolicLink() || !stat.isFile())
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must be a regular file: ${definition.path}`,
			{ path: definition.path },
		);
	const text = readFileNoFollow(targetPath, {
		root: path.dirname(targetPath),
		label: "settings target",
		encoding: "utf8",
		errorCode: "E_SETTINGS_PATH",
	});
	if (definition.format === "json") {
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw distributionError(
				"E_SETTINGS_SYNTAX",
				"managed JSON settings are invalid",
				{},
				{ cause: error },
			);
		}
		for (const key of definition.managed_keys) deleteNested(parsed, key);
		const newline = text.includes("\r\n") ? "\r\n" : "\n";
		const bytes = Buffer.from(
			`${JSON.stringify(parsed, null, 2).replaceAll("\n", newline)}${newline}`,
			"utf8",
		);
		return returnDetails
			? {
					bytes,
					expected: {
						exists: true,
						sha256: sha256(Buffer.from(text, "utf8")),
						mode: formatMode(stat.mode & 0o7777),
					},
				}
			: bytes;
	}
	if (definition.format === "toml") {
		const lines = text
			.split(/(?<=\n)/u)
			.filter(
				(line) =>
					!definition.managed_keys.some((key) =>
						new RegExp(`^\\s*${key.replaceAll(".", "\\.")}\\s*=`, "u").test(
							line,
						),
					),
			);
		const bytes = Buffer.from(lines.join(""), "utf8");
		return returnDetails
			? {
					bytes,
					expected: {
						exists: true,
						sha256: sha256(Buffer.from(text, "utf8")),
						mode: formatMode(stat.mode & 0o7777),
					},
				}
			: bytes;
	}
	throwDistributionError(
		"E_SETTINGS_FORMAT",
		`managed-key format is not supported: ${definition.format}`,
		{ format: definition.format },
	);
}

function sha256(bytes) {
	return crypto.createHash("sha256").update(bytes).digest("hex");
}

function formatMode(mode) {
	return (mode & 0o7777).toString(8).padStart(4, "0");
}

function currentSettingState(targetPath) {
	const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
	if (!stat) return { exists: false, sha256: null, mode: null };
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throwDistributionError(
			"E_SETTINGS_PATH",
			`settings path must be a regular file: ${targetPath}`,
			{ targetPath },
		);
	}
	const contents = readFileNoFollow(targetPath, {
		root: path.dirname(targetPath),
		label: "settings target",
		errorCode: "E_SETTINGS_PATH",
	});
	return {
		exists: true,
		sha256: sha256(contents),
		mode: formatMode(stat.mode & 0o7777),
	};
}

function assertExpectedSettingState(targetPath, expected) {
	if (!expected) return;
	const actual = currentSettingState(targetPath);
	const expectedState = {
		exists:
			expected.exists ??
			(expected.beforeSha256 !== null && expected.beforeSha256 !== undefined),
		sha256: expected.sha256 ?? expected.beforeSha256 ?? null,
		mode: expected.mode ?? expected.beforeMode ?? null,
	};
	if (
		actual.exists !== expectedState.exists ||
		actual.sha256 !== expectedState.sha256 ||
		actual.mode !== expectedState.mode
	) {
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"concurrent write changed settings after preflight",
			{
				reason: "concurrent_write",
				targetPath,
				expected: expectedState,
				actual,
			},
		);
	}
}

export function atomicWriteSetting(
	targetPath,
	bytes,
	mode = "0600",
	{ beforeMutation = null, beforeRename = null, expected = null } = {},
) {
	const parent = path.dirname(targetPath);
	return withMutationBoundary(
		targetPath,
		{
			root: path.dirname(parent),
			label: "settings target",
			allowMissing: true,
			allowLeafSymlink: false,
			beforeMutation,
			errorCode: "E_SETTINGS_PATH",
		},
		(boundary) => {
			const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
			if (stat?.isSymbolicLink())
				throwDistributionError(
					"E_SETTINGS_PATH",
					`settings path must not be a symlink: ${targetPath}`,
					{ targetPath },
				);
			if (stat && stat.isDirectory())
				throwDistributionError(
					"E_SETTINGS_PATH",
					`settings path must not be a directory: ${targetPath}`,
					{ targetPath },
				);
			const temporary = `${targetPath}.${crypto.randomUUID()}.tmp`;
			const noFollow = fs.constants.O_NOFOLLOW ?? 0;
			const flags =
				fs.constants.O_WRONLY |
				fs.constants.O_CREAT |
				fs.constants.O_EXCL |
				noFollow;
			let descriptor;
			try {
				try {
					descriptor = fs.openSync(temporary, flags, Number.parseInt(mode, 8));
				} catch (error) {
					if (error.code === "EINVAL" || error.code === "ENOTSUP")
						descriptor = fs.openSync(
							temporary,
							flags & ~noFollow,
							Number.parseInt(mode, 8),
						);
					else throw error;
				}
				fs.writeFileSync(descriptor, bytes);
				fs.fchmodSync(descriptor, Number.parseInt(mode, 8));
				fs.fsyncSync(descriptor);
			} finally {
				if (descriptor !== undefined) fs.closeSync(descriptor);
			}
			let committed = false;
			try {
				assertPathIdentity(boundary.parentSnapshot, {
					label: "settings parent",
					errorCode: "E_SETTINGS_PATH",
				});
				if (typeof beforeRename === "function")
					beforeRename({ path: targetPath });
				assertExpectedSettingState(targetPath, expected);
				fs.renameSync(temporary, targetPath);
				committed = true;
				if (boundary.parentDescriptor !== null) {
					try {
						fs.fsyncSync(boundary.parentDescriptor);
					} catch (error) {
						if (!["EINVAL", "ENOTSUP", "EPERM", "EISDIR"].includes(error.code))
							throw error;
					}
				}
			} finally {
				if (!committed) fs.rmSync(temporary, { force: true });
			}
		},
	);
}

export { formatMode, getNested };
