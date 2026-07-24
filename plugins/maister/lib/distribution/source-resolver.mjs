import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hashTree } from "./hash-tree.mjs";
import {
	DistributionError,
	ensureDirectoryRoot,
	throwDistributionError,
} from "./path-safety.mjs";

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const SHORT_COMMIT = /^[0-9a-f]{7,39}$/iu;
const SAFE_GITHUB_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const ARCHIVE_MANIFEST = ".maister-source.json";

function archiveModeFor(relative, stat) {
	if (process.platform !== "win32") return null;
	if (stat.isDirectory()) return 0o755;
	if (
		/^plugins\/maister\/bin\/(?:maister-agent-gate|maister-install|materialize)\.mjs$/u.test(relative)
		|| /^plugins\/maister\/overlays\/(?:codex|cursor|kiro-cli|pi)\/assets\/hooks\/[^/]+\.sh$/u.test(relative)
		|| relative === "plugins/maister/skills/init/bin/reconcile-gate-config.sh"
		|| relative === "plugins/maister/overlays/cursor/assets/skills/maister-init/bin/reconcile-gate-config.sh"
	) return 0o755;
	return 0o644;
}

function timeoutMs(options = {}) {
	const value =
		options.gitTimeoutMs ??
		options.env?.MAISTER_GIT_TIMEOUT_MS ??
		DEFAULT_GIT_TIMEOUT_MS;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10 * 60 * 1000) {
		throwDistributionError(
			"E_SOURCE_TIMEOUT",
			"Git timeout must be an integer between 1ms and 10 minutes",
			{ value },
		);
	}
	return parsed;
}

function validateRef(ref, location = "source ref") {
	if (
		typeof ref !== "string" ||
		ref.length === 0 ||
		ref.includes("\0") ||
		!SAFE_REF.test(ref)
	) {
		throwDistributionError(
			"E_SOURCE_REF",
			`${location} contains unsafe characters`,
			{ ref },
		);
	}
	if (
		ref.startsWith("/") ||
		ref.endsWith("/") ||
		ref.endsWith(".") ||
		ref.includes("..") ||
		ref.includes("//") ||
		ref.includes("@{") ||
		/[~^:?*[\]\\]/u.test(ref)
	) {
		throwDistributionError(
			"E_SOURCE_REF",
			`${location} is not a valid Git ref`,
			{ ref },
		);
	}
	return ref;
}

function validateGithubComponent(value, location) {
	if (!SAFE_GITHUB_COMPONENT.test(value) || value === "." || value === "..") {
		throwDistributionError(
			"E_SOURCE_SCHEME",
			`${location} is not a valid GitHub identifier`,
			{ value },
		);
	}
	return value;
}

function parseSource(source) {
	if (typeof source !== "string" || source.length === 0) {
		throwDistributionError(
			"E_SOURCE_SCHEME",
			"source must be a non-empty local path or github:owner/repo",
			{ source },
		);
	}
	if (source.startsWith("local:"))
		return { kind: "local", value: source.slice("local:".length) };
	if (source.startsWith("github:")) {
		const value = source.slice("github:".length);
		const match = /^([^/]+)\/([^#]+)(?:#(.+))?$/u.exec(value);
		if (!match)
			throwDistributionError(
				"E_SOURCE_SCHEME",
				`invalid GitHub source: ${source}`,
				{ source },
			);
		return {
			kind: "github",
			owner: validateGithubComponent(match[1], "GitHub owner"),
			repo: validateGithubComponent(match[2], "GitHub repository"),
			inlineRef: match[3] ? validateRef(match[3], "GitHub inline ref") : null,
		};
	}
	if (source.startsWith("file:")) {
		try {
			return { kind: "local", value: new URL(source).pathname };
		} catch (error) {
			throwDistributionError(
				"E_SOURCE_SCHEME",
				`invalid file source: ${source}`,
				{ source },
				{ cause: error },
			);
		}
	}
	if (source.includes(":")) {
		throwDistributionError(
			"E_SOURCE_SCHEME",
			`unsupported source scheme: ${source.split(":", 1)[0]}`,
			{ source },
		);
	}
	return { kind: "local", value: source };
}

function runGit(root, args, options = {}) {
	const limit = timeoutMs(options);
	const command = root ? ["-C", root, ...args] : args;
	const execute = options.execFileSync ?? execFileSync;
	try {
		return execute("git", command, {
			encoding: "utf8",
			maxBuffer: MAX_GIT_OUTPUT_BYTES,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: limit,
		}).trim();
	} catch (error) {
		const details = {
			root,
			args,
			timeout_ms: limit,
			signal: error.signal ?? null,
			code: error.code ?? null,
		};
		if (error.code === "ETIMEDOUT" || error.killed === true) {
			throwDistributionError(
				"E_SOURCE_GIT_TIMEOUT",
				`git command timed out after ${limit}ms`,
				details,
				{ cause: error, retryable: true },
			);
		}
		throwDistributionError(
			"E_SOURCE_GIT",
			`git command failed${root ? ` for ${root}` : ""}`,
			details,
			{ cause: error },
		);
	}
}

function defaultGit(root, options = {}) {
	return {
		topLevel: () => runGit(root, ["rev-parse", "--show-toplevel"], options),
		head: () => runGit(root, ["rev-parse", "HEAD"], options),
		resolve: (ref) =>
			runGit(root, ["rev-parse", "--verify", `${ref}^{commit}`], options),
		status: () =>
			runGit(
				root,
				[
					"status",
					"--porcelain=v1",
					"--untracked-files=all",
					"--ignored=matching",
					"--no-renames",
				],
				options,
			),
	};
}

async function callAdapter(adapter, method, ...args) {
	const callable = adapter?.[method];
	if (typeof callable !== "function") return undefined;
	return callable(...args);
}

function statusDetails(status) {
	const entries = Array.isArray(status)
		? status.map(String).filter(Boolean)
		: typeof status === "string"
			? status.split(/\r?\n/u).filter(Boolean)
			: Array.isArray(status?.entries)
				? status.entries.map(String).filter(Boolean)
				: [];
	const ignored =
		entries.some((entry) => entry.startsWith("!!")) ||
		status?.ignored === true ||
		Number(status?.ignored ?? 0) > 0;
	const dirty =
		entries.length > 0 ||
		status?.dirty === true ||
		Number(status?.changed ?? 0) > 0 ||
		ignored;
	return { dirty: Boolean(dirty), ignored, entries };
}

function statusSnapshot(status) {
	const details = statusDetails(status);
	const entries = [...details.entries].sort();
	return {
		...details,
		entries,
		fingerprint: JSON.stringify({
			dirty: details.dirty,
			entries,
			ignored: details.ignored,
		}),
	};
}

function sameCheckoutRoot(candidate, expected) {
	try {
		return (
			path.resolve(fs.realpathSync(String(candidate))) ===
			path.resolve(expected)
		);
	} catch {
		return false;
	}
}

function githubCheckoutGit(root, details, options) {
	if (details.git && typeof details.git === "object") return details.git;
	if (options.githubGit && typeof options.githubGit === "object")
		return options.githubGit;
	if (options.git && typeof options.git === "object") return options.git;
	return fs.existsSync(path.join(root, ".git"))
		? defaultGit(root, options)
		: undefined;
}

async function verifyGithubCheckout({
	root,
	details,
	resolvedCommit,
	requestedRef,
	owner,
	repo,
	options,
}) {
	const actualHash = hashTree(root).contentHash;
	if (details.contentHash !== undefined) {
		if (
			typeof details.contentHash !== "string" ||
			!/^[0-9a-f]{64}$/iu.test(details.contentHash)
		) {
			throwDistributionError(
				"E_SOURCE_CONTENT_HASH",
				"GitHub resolver returned an invalid content hash",
				{
					owner,
					repo,
					requestedRef,
					contentHash: details.contentHash,
				},
			);
		}
		const expectedHash = details.contentHash.toLowerCase();
		if (expectedHash !== actualHash) {
			throwDistributionError(
				"E_SOURCE_CONTENT_HASH",
				"GitHub checkout bytes do not match resolver metadata",
				{
					owner,
					repo,
					requestedRef,
					root,
					expected: expectedHash,
					actual: actualHash,
				},
			);
		}
	}

	const git = githubCheckoutGit(root, details, options);
	if (!git) {
		const status = statusSnapshot(undefined);
		return {
			contentHash: actualHash,
			statusFingerprint: status.fingerprint,
			statusEntries: status.entries,
			identityMode: "content-hash",
		};
	}

	const topLevel = await callAdapter(git, "topLevel");
	if (topLevel === undefined || !sameCheckoutRoot(topLevel, root)) {
		throwDistributionError(
			"E_SOURCE_ROOT",
			"GitHub resolver checkout is not the selected Git root",
			{
				owner,
				repo,
				requestedRef,
				root,
				topLevel: topLevel ?? null,
			},
		);
	}
	const head = await callAdapter(git, "head");
	if (head === undefined) {
		throwDistributionError(
			"E_SOURCE_GIT",
			"GitHub resolver checkout did not provide HEAD",
			{
				owner,
				repo,
				requestedRef,
				root,
			},
		);
	}
	const headCommit = requireFullCommit(String(head), "HEAD");
	if (headCommit !== resolvedCommit) {
		throwDistributionError(
			"E_SOURCE_REF",
			"GitHub checkout HEAD does not match the resolved commit",
			{
				owner,
				repo,
				requestedRef,
				resolvedCommit,
				head: headCommit,
			},
		);
	}
	const status = await callAdapter(git, "status");
	if (status === undefined) {
		throwDistributionError(
			"E_SOURCE_GIT",
			"GitHub resolver checkout did not provide clean-checkout status",
			{
				owner,
				repo,
				requestedRef,
				root,
			},
		);
	}
	const statusResult = statusSnapshot(status);
	if (statusResult.dirty) {
		throwDistributionError(
			"E_SOURCE_DIRTY",
			"GitHub resolver checkout contains changed, untracked, or ignored inputs",
			{
				owner,
				repo,
				requestedRef,
				root,
				ignored: statusResult.ignored,
				entries: statusResult.entries,
			},
		);
	}
	return {
		contentHash: actualHash,
		statusFingerprint: statusResult.fingerprint,
		statusEntries: statusResult.entries,
		identityMode: "git",
	};
}

function readSourceVersion(root, fallback = "unknown") {
	for (const candidate of ["VERSION", "version", ".source-version"]) {
		const file = path.join(root, candidate);
		if (fs.existsSync(file) && fs.statSync(file).isFile()) {
			const value = fs.readFileSync(file, "utf8").trim();
			if (value) return value;
		}
	}
	return fallback;
}

function requireFullCommit(commit, requestedRef) {
	if (typeof commit !== "string" || !FULL_COMMIT.test(commit)) {
		const code =
			typeof commit === "string" && SHORT_COMMIT.test(commit)
				? "E_SOURCE_AMBIGUOUS_SHA"
				: "E_SOURCE_COMMIT";
		throwDistributionError(
			code,
			`source ref did not resolve to a full commit: ${requestedRef}`,
			{
				requestedRef,
				resolvedCommit: commit,
			},
		);
	}
	return commit.toLowerCase();
}

function archiveManifestFor(root) {
	const candidates = [
		path.join(root, ARCHIVE_MANIFEST),
		path.join(root, "plugins", "maister", ARCHIVE_MANIFEST),
	];
	for (const manifestPath of candidates) {
		if (!fs.existsSync(manifestPath)) continue;
		try {
			const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
			if (!value || value.schema_version !== 1) {
				throw new Error("unsupported archive source manifest");
			}
			return {
				path: manifestPath,
				relative: path.relative(root, manifestPath).split(path.sep).join("/"),
				value,
			};
		} catch (error) {
			throwDistributionError(
				"E_SOURCE_MANIFEST",
				`archive source manifest is invalid: ${manifestPath}`,
				{ manifestPath },
				{ cause: error },
			);
		}
	}
	return null;
}

function resolveArchive(root, requestedRef, options) {
	const manifest = archiveManifestFor(root);
	if (!manifest) return undefined;
	const resolvedCommit = requireFullCommit(
		manifest.value.source_commit,
		requestedRef,
	);
	if (
		requestedRef !== "HEAD" &&
		requestedRef.toLowerCase() !== resolvedCommit
	) {
		throwDistributionError(
			"E_SOURCE_REF",
			"archive source can only resolve its recorded immutable commit",
			{
				requestedRef,
				resolvedCommit,
			},
		);
	}
	const contentHash = manifest.value.content_hash;
	if (typeof contentHash !== "string" || !/^[0-9a-f]{64}$/u.test(contentHash)) {
		throwDistributionError(
			"E_SOURCE_MANIFEST",
			"archive source manifest must contain a SHA-256 content hash",
			{ manifest: manifest.path },
		);
	}
	const actualHash = hashTree(root, {
		ignore: (relative) => relative === manifest.relative,
		modeFor: archiveModeFor,
	}).contentHash;
	if (actualHash !== contentHash) {
		throwDistributionError(
			"E_SOURCE_CONTENT_HASH",
			"archive source bytes do not match the recorded content hash",
			{
				root,
				expected: contentHash,
				actual: actualHash,
			},
		);
	}
	return {
		kind: "local",
		requestedSource: `local:${root}`,
		root,
		requestedRef: resolvedCommit,
		resolvedCommit,
		sourceVersion:
			options.sourceVersion ?? manifest.value.source_version ?? "unknown",
		contentHash,
		dirty: false,
		statusFingerprint: "archive-clean",
		statusEntries: [],
		archive: true,
	};
}

async function resolveLocal(parsed, options) {
	const root = ensureDirectoryRoot(path.resolve(parsed.value), "local source");
	const requestedRef = options.ref ?? "HEAD";
	validateRef(requestedRef);
	if (SHORT_COMMIT.test(requestedRef) && !FULL_COMMIT.test(requestedRef))
		throwDistributionError(
			"E_SOURCE_AMBIGUOUS_SHA",
			`short source ref is not accepted: ${requestedRef}`,
			{ requestedRef },
		);
	if (!options.git && !fs.existsSync(path.join(root, ".git"))) {
		const archive = resolveArchive(root, requestedRef, options);
		if (archive) return archive;
	}
	const git = options.git ?? defaultGit(root, options);
	const topLevel = await callAdapter(git, "topLevel");
	if (topLevel !== undefined && !sameCheckoutRoot(topLevel, root)) {
		throwDistributionError(
			"E_SOURCE_ROOT",
			"local source is not the selected checkout root",
			{ root, topLevel },
		);
	}
	let commit;
	if (requestedRef === "HEAD") commit = await callAdapter(git, "head");
	else {
		try {
			commit = await callAdapter(git, "resolve", requestedRef);
		} catch (error) {
			throwDistributionError(
				"E_SOURCE_REF",
				`local source ref could not be resolved: ${requestedRef}`,
				{
					root,
					requestedRef,
				},
				{ cause: error },
			);
		}
	}
	if (commit === undefined) {
		throwDistributionError(
			"E_SOURCE_GIT",
			"local source adapter did not provide a commit",
			{ root, requestedRef },
		);
	}
	const resolvedCommit = requireFullCommit(String(commit), requestedRef);
	const head = await callAdapter(git, "head");
	if (head === undefined)
		throwDistributionError(
			"E_SOURCE_GIT",
			"local source adapter did not provide checkout HEAD",
			{ root, requestedRef },
		);
	const headCommit = requireFullCommit(String(head), "HEAD");
	if (headCommit !== resolvedCommit) {
		throwDistributionError(
			"E_SOURCE_REF",
			"local checkout HEAD does not match the resolved source ref",
			{
				root,
				requestedRef,
				resolvedCommit,
				head: headCommit,
			},
		);
	}
	const status = statusSnapshot(await callAdapter(git, "status"));
	if (status.dirty && !options.allowDirtyLocal) {
		throwDistributionError(
			"E_SOURCE_DIRTY",
			"local checkout has uncommitted, untracked, or ignored inputs; pass --allow-dirty-local explicitly",
			{
				root,
				ignored: status.ignored,
				entries: status.entries,
			},
		);
	}
	const contentHash = hashTree(root).contentHash;
	return {
		kind: "local",
		requestedSource: `local:${root}`,
		root,
		requestedRef,
		resolvedCommit,
		sourceVersion: options.sourceVersion ?? readSourceVersion(root),
		contentHash,
		dirty: status.dirty,
		statusFingerprint: status.fingerprint,
		statusEntries: status.entries,
		git,
	};
}

function githubUrl(owner, repo) {
	return `https://github.com/${owner}/${repo}.git`;
}

function resolveRemoteCommit(owner, repo, ref, options) {
	const output = runGit(
		null,
		["ls-remote", "--refs", githubUrl(owner, repo), ref],
		options,
	);
	const commits = output
		.split(/\r?\n/u)
		.map((line) => line.trim().split(/\s+/u)[0])
		.filter((value) => FULL_COMMIT.test(value));
	if (commits.length === 0) {
		throwDistributionError(
			"E_SOURCE_REF",
			`GitHub ref does not exist: ${ref}`,
			{ owner, repo, requestedRef: ref },
		);
	}
	const unique = [...new Set(commits.map((value) => value.toLowerCase()))];
	if (unique.length !== 1) {
		throwDistributionError(
			"E_SOURCE_REF",
			`GitHub ref resolved ambiguously: ${ref}`,
			{ owner, repo, requestedRef: ref, commits: unique },
		);
	}
	return unique[0];
}

function productionGithubResolver(options = {}) {
	return {
		resolveRef: ({ owner, repo, ref }) => {
			const limit = timeoutMs(options);
			const resolvedCommit = FULL_COMMIT.test(ref)
				? ref.toLowerCase()
				: resolveRemoteCommit(owner, repo, ref, {
						...options,
						gitTimeoutMs: limit,
					});
			const checkoutRoot = fs.mkdtempSync(
				path.join(os.tmpdir(), "maister-github-checkout-"),
			);
			try {
				runGit(null, ["init", "--quiet", checkoutRoot], {
					...options,
					gitTimeoutMs: limit,
				});
				runGit(
					checkoutRoot,
					["remote", "add", "origin", githubUrl(owner, repo)],
					{ ...options, gitTimeoutMs: limit },
				);
				runGit(
					checkoutRoot,
					["fetch", "--depth=1", "--no-tags", "origin", resolvedCommit],
					{ ...options, gitTimeoutMs: limit },
				);
				runGit(
					checkoutRoot,
					["checkout", "--detach", "--quiet", resolvedCommit],
					{ ...options, gitTimeoutMs: limit },
				);
				const head = requireFullCommit(
					runGit(checkoutRoot, ["rev-parse", "HEAD"], {
						...options,
						gitTimeoutMs: limit,
					}),
					ref,
				);
				if (head !== resolvedCommit) {
					throwDistributionError(
						"E_SOURCE_REF",
						"GitHub checkout HEAD does not match the resolved commit",
						{
							owner,
							repo,
							requestedRef: ref,
							resolvedCommit,
							head,
						},
					);
				}
				const status = statusDetails(
					runGit(
						checkoutRoot,
						[
							"status",
							"--porcelain=v1",
							"--untracked-files=all",
							"--ignored=matching",
							"--no-renames",
						],
						{ ...options, gitTimeoutMs: limit },
					),
				);
				if (status.dirty) {
					throwDistributionError(
						"E_SOURCE_DIRTY",
						"GitHub checkout contains untracked or ignored inputs",
						{
							owner,
							repo,
							resolvedCommit,
							entries: status.entries,
							ignored: status.ignored,
						},
					);
				}
				return {
					owner,
					repo,
					commit: resolvedCommit,
					root: checkoutRoot,
					sourceVersion: readSourceVersion(checkoutRoot),
					contentHash: hashTree(checkoutRoot).contentHash,
					cleanup: () =>
						fs.rmSync(checkoutRoot, { recursive: true, force: true }),
				};
			} catch (error) {
				fs.rmSync(checkoutRoot, { recursive: true, force: true });
				if (error instanceof DistributionError) throw error;
				throwDistributionError(
					"E_SOURCE_GIT",
					`could not create immutable GitHub checkout for ${owner}/${repo}`,
					{
						owner,
						repo,
						requestedRef: ref,
					},
					{ cause: error },
				);
			}
		},
	};
}

async function resolveGithub(parsed, options) {
	const requestedRef = options.ref ?? parsed.inlineRef;
	if (!requestedRef) {
		throwDistributionError(
			"E_SOURCE_REF",
			"GitHub sources require an explicit ref",
			{ source: `github:${parsed.owner}/${parsed.repo}` },
		);
	}
	validateRef(requestedRef, "GitHub ref");
	if (SHORT_COMMIT.test(requestedRef) && !FULL_COMMIT.test(requestedRef)) {
		throwDistributionError(
			"E_SOURCE_AMBIGUOUS_SHA",
			`short GitHub ref is not accepted: ${requestedRef}`,
			{ requestedRef },
		);
	}
	const resolver =
		options.github ??
		options.githubResolver ??
		productionGithubResolver(options);
	const resolveRef =
		typeof resolver === "function" ? resolver : resolver.resolveRef;
	if (typeof resolveRef !== "function") {
		throwDistributionError(
			"E_SOURCE_RESOLVER",
			"GitHub resolver must provide resolveRef",
			{},
		);
	}
	let result;
	try {
		result = await resolveRef({
			owner: parsed.owner,
			repo: parsed.repo,
			ref: requestedRef,
		});
	} catch (error) {
		if (error instanceof DistributionError) throw error;
		throwDistributionError(
			"E_SOURCE_REF",
			`GitHub ref could not be resolved: ${requestedRef}`,
			{
				owner: parsed.owner,
				repo: parsed.repo,
				requestedRef,
			},
			{ cause: error },
		);
	}
	const details =
		typeof result === "string" ? { commit: result } : (result ?? {});
	const resolvedCommit = requireFullCommit(
		details.commit ?? details.resolvedCommit,
		requestedRef,
	);
	const rootValue =
		details.root ?? details.checkoutRoot ?? options.checkoutRoot;
	let root;
	if (rootValue !== undefined && rootValue !== null) {
		if (typeof rootValue !== "string" || rootValue.length === 0) {
			throwDistributionError(
				"E_SOURCE_ROOT",
				"GitHub resolver returned an invalid checkout root",
				{
					owner: parsed.owner,
					repo: parsed.repo,
					requestedRef,
					root: rootValue,
				},
			);
		}
		root = ensureDirectoryRoot(path.resolve(rootValue), "GitHub checkout");
	}
	const verification = root
		? await verifyGithubCheckout({
				root,
				details,
				resolvedCommit,
				requestedRef,
				owner: parsed.owner,
				repo: parsed.repo,
				options,
			})
		: null;
	const contentHash = root
		? verification.contentHash
		: typeof details.contentHash === "string" &&
				/^[0-9a-f]{64}$/iu.test(details.contentHash)
			? details.contentHash.toLowerCase()
			: undefined;
	if (!contentHash) {
		throwDistributionError(
			"E_SOURCE_CONTENT_HASH",
			"GitHub resolution must provide a checkout or content hash",
			{
				owner: parsed.owner,
				repo: parsed.repo,
				requestedRef,
			},
		);
	}
	return {
		kind: "github",
		requestedSource: `github:${parsed.owner}/${parsed.repo}`,
		owner: parsed.owner,
		repo: parsed.repo,
		root,
		requestedRef,
		resolvedCommit,
		sourceVersion:
			options.sourceVersion ??
			details.sourceVersion ??
			(root ? readSourceVersion(root) : "unknown"),
		contentHash,
		dirty: false,
		statusFingerprint: verification?.statusFingerprint,
		statusEntries: verification?.statusEntries,
		identityMode: verification?.identityMode,
		git: root ? githubCheckoutGit(root, details, options) : undefined,
		cleanup:
			typeof details.cleanup === "function" ? details.cleanup : undefined,
	};
}

function sourceGitAdapter(source, options) {
	if (source.git && typeof source.git === "object") return source.git;
	if (options.git && typeof options.git === "object") return options.git;
	if (fs.existsSync(path.join(source.root, ".git")))
		return defaultGit(source.root, options);
	return undefined;
}

/**
 * Revalidate the exact source binding returned by resolveSource.
 *
 * This is deliberately a verification seam, not a second ref resolution: it
 * checks the same checkout root, commit, status snapshot, and content hash.
 * Materializers and lifecycle callers can use the returned binding as the
 * final-byte identity without asking a remote resolver to resolve the ref a
 * second time.
 */
export async function revalidateResolvedSource(source, options = {}) {
	if (
		!source ||
		typeof source !== "object" ||
		typeof source.root !== "string"
	) {
		throwDistributionError(
			"E_SOURCE_CONTENT",
			"resolved source must provide a checkout root",
			{},
		);
	}
	const root = ensureDirectoryRoot(source.root, "resolved source");
	if (path.resolve(root) !== path.resolve(source.root)) {
		throwDistributionError(
			"E_SOURCE_ROOT",
			"resolved source checkout root changed identity",
			{
				expected: source.root,
				actual: root,
			},
		);
	}

	if (source.archive) {
		const current = resolveArchive(root, source.resolvedCommit, options);
		if (!current || current.contentHash !== source.contentHash) {
			sourceMutationError(
				"E_SOURCE_CONTENT_HASH",
				"archive source bytes changed after resolution",
				{
					root,
					expected: source.contentHash,
					actual: current?.contentHash ?? null,
				},
			);
		}
		return Object.freeze({
			...source,
			root,
			contentHash: current.contentHash,
			statusFingerprint: "archive-clean",
			statusEntries: [],
		});
	}

	const git = sourceGitAdapter(source, options);
	if (!git) {
		if (source.kind === "github" && source.identityMode === "content-hash") {
			const contentHash = hashTree(root).contentHash;
			if (contentHash !== source.contentHash) {
				throwDistributionError(
					"E_SOURCE_CONTENT_HASH",
					"resolved source bytes changed after resolution",
					{
						root,
						expected: source.contentHash,
						actual: contentHash,
					},
				);
			}
			return Object.freeze({ ...source, root, contentHash });
		}
		throwDistributionError(
			"E_SOURCE_GIT",
			"resolved source cannot be rebound without a Git identity adapter",
			{ root },
		);
	}
	const topLevel = await callAdapter(git, "topLevel");
	if (topLevel === undefined || !sameCheckoutRoot(topLevel, root)) {
		throwDistributionError(
			"E_SOURCE_ROOT",
			"resolved source is not the selected checkout root",
			{
				root,
				topLevel: topLevel ?? null,
			},
		);
	}
	const head = await callAdapter(git, "head");
	if (head === undefined)
		throwDistributionError(
			"E_SOURCE_GIT",
			"resolved source adapter did not provide checkout HEAD",
			{ root },
		);
	const headCommit = requireFullCommit(String(head), "HEAD");
	if (headCommit !== source.resolvedCommit) {
		throwDistributionError(
			"E_SOURCE_REF",
			"resolved source checkout HEAD changed after resolution",
			{
				root,
				expected: source.resolvedCommit,
				actual: headCommit,
			},
		);
	}
	const status = await callAdapter(git, "status");
	if (status === undefined)
		throwDistributionError(
			"E_SOURCE_GIT",
			"resolved source adapter did not provide checkout status",
			{ root },
		);
	const currentStatus = statusSnapshot(status);
	if (currentStatus.fingerprint !== source.statusFingerprint) {
		throwDistributionError(
			"E_SOURCE_DIRTY",
			"resolved source checkout status changed after resolution",
			{
				root,
				expected: source.statusEntries ?? [],
				actual: currentStatus.entries,
				ignored: currentStatus.ignored,
			},
		);
	}
	if (
		source.kind === "local" &&
		currentStatus.dirty &&
		!options.allowDirtyLocal
	) {
		throwDistributionError(
			"E_SOURCE_DIRTY",
			"dirty local source requires explicit opt-in",
			{
				root,
				entries: currentStatus.entries,
				ignored: currentStatus.ignored,
			},
		);
	}
	if (source.kind !== "local" && currentStatus.dirty) {
		throwDistributionError(
			"E_SOURCE_DIRTY",
			"resolved non-local checkout is not clean",
			{
				root,
				entries: currentStatus.entries,
				ignored: currentStatus.ignored,
			},
		);
	}
	const contentHash = hashTree(root).contentHash;
	if (contentHash !== source.contentHash) {
		throwDistributionError(
			"E_SOURCE_CONTENT_HASH",
			"resolved source bytes changed after resolution",
			{
				root,
				expected: source.contentHash,
				actual: contentHash,
			},
		);
	}
	return Object.freeze({
		...source,
		root,
		resolvedCommit: headCommit,
		contentHash,
		dirty: currentStatus.dirty,
		statusFingerprint: currentStatus.fingerprint,
		statusEntries: currentStatus.entries,
		git,
	});
}

export async function resolveSource(source, options = {}) {
	const parsed = parseSource(source);
	return parsed.kind === "local"
		? resolveLocal(parsed, options)
		: resolveGithub(parsed, options);
}

export {
	DEFAULT_GIT_TIMEOUT_MS,
	DistributionError,
	parseSource,
	requireFullCommit,
	runGit,
	validateRef,
};
