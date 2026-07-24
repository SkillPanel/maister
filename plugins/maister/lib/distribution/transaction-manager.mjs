import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
	assertPathIdentity,
	capturePathIdentity,
	DistributionError,
	distributionError,
	ensureDirectoryRoot,
	readFileNoFollow,
	throwDistributionError,
} from "./path-safety.mjs";
import { loadOverlay } from "./overlay-loader.mjs";
import { materialize } from "./materializer.mjs";
import { revalidateResolvedSource, resolveSource } from "./source-resolver.mjs";
import { hashFile, hashTree } from "./hash-tree.mjs";
import { assertNoDrift, describe } from "./drift-detector.mjs";
import {
	assertManagedArrayUnchanged,
	assertManagedKeysUnchanged,
	atomicWriteSetting,
	formatMode,
	prepareSetting,
	removeManagedArrayEntry,
	removeManagedKeys,
} from "./settings-owner.mjs";
import { getTargetPaths, resolveTargetSettingPath } from "./target-paths.mjs";
import {
	requireControlPlane,
	validateReceipt,
	readReceipt,
	UUID,
} from "./receipt-schema.mjs";
import {
	appendTransition,
	isUnresolved,
	readJournal,
	validateJournal,
} from "./journal-schema.mjs";
import {
	collectEvidence,
	evaluateTarget,
	FAIL_CLOSED_CLASSES,
} from "./evidence-policy.mjs";
import {
	createEvidenceRecord,
	normalizeEvidenceProvenance,
	validateEvidenceRecord,
} from "./evidence-schema.mjs";
import {
	consumeE3Attestation,
	portableCoreTreeHash,
	requireE3Attestation,
} from "./e3-attestation.mjs";
import { getTargetDefinition } from "./targets.mjs";
import { canonicalJson } from "./provenance.mjs";
import {
	attachCodexDeployment,
	defaultCodexDeploymentRunner,
	detachCodexDeployment,
	installPreparedCodexDeployment,
	prepareCodexDeployment,
	removeCodexDeployment,
	removeCodexMarketplace,
	verifyCodexDeployment,
} from "./codex-deployment.mjs";
import {
	assertSafePath,
	copyTreeEntry,
	ensureDirectoryTree,
	readManifest,
	pruneUnreferencedControlPlanes,
	recoverJournal,
	removeEntry,
	restoreFullBackup,
	snapshotState,
} from "./recovery.mjs";
import { maybeDualWriteCursorAgents } from "./cursor-agents-fallback.mjs";
import { probeCursorForInstall } from "./host-probes/cursor.mjs";
import { probeKiroCliForInstall } from "./host-probes/kiro-cli.mjs";

const INSTALLER_VERSION = "1.0.0";
const CONTROL_PLANE_SCHEMA_VERSION = 1;
const CLI_CONTRACT_VERSION = 1;
const DURABLE_BOUNDARY_MARKERS = Object.freeze([
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
const DURABLE_BOUNDARY_MARKER_SET = new Set(DURABLE_BOUNDARY_MARKERS);
const NATIVE_DURABLE_BOUNDARY_MARKERS = new Set([
	"native-deployment-prepared",
	"native-deployment-installed",
	"native-previous-retire-intent",
	"native-previous-retired",
	"native-deployment-removal-intent",
	"native-deployment-removed",
]);
const DEFAULT_SCENARIO_VERSION = "1.0.0";
const BASE_EVIDENCE = Object.freeze([
	["E1", "overlay-contract-v1"],
	["E2", "materialize-v1"],
	["E3", "portable-core-v1"],
	["E4", "installer-transaction-v1"],
]);
const NATIVE_EVIDENCE = new Set(["E5", "E6"]);
const RELEASE_POLICIES = Object.freeze({
	"offline-provisional": Object.freeze({
		id: "offline-provisional",
		allowProvisionalPackaging: true,
		requireFailClosed: false,
	}),
	strict: Object.freeze({
		id: "strict",
		allowProvisionalPackaging: false,
		requireFailClosed: true,
	}),
});

function observedModeMatches(expected, observed) {
	// Windows ACLs are not represented by the POSIX mode bits exposed by Node.
	// Keep bytes, entry types, and path identities authoritative instead.
	return process.platform === "win32" || expected === observed;
}

function codexNativeDeploymentEnabled(options, target) {
	return (
		target === "codex" &&
		options.nativeDeployment !== false &&
		options.env?.MAISTER_CODEX_NATIVE_DEPLOYMENT !== "0"
	);
}

function codexDeploymentRunner(options) {
	return (
		options.codexDeploymentRunner ??
		options.codexRunner ??
		defaultCodexDeploymentRunner
	);
}

function codexDeploymentEnvironment(options) {
	return options.env ?? process.env;
}

function ensureCodexDeploymentAttached({ deployment, run, env }) {
	try {
		verifyCodexDeployment({ deployment, run, env });
		return deployment;
	} catch {
		return attachCodexDeployment({ deployment, run, env });
	}
}

function recoverCodexNativeJournal(journal, options, paths) {
	if (!codexNativeDeploymentEnabled(options, paths.target)) return;
	const run = codexDeploymentRunner(options);
	const env = codexDeploymentEnvironment(options);
	const current = journal.native_deployment ?? null;
	const previous = journal.previous_native_deployment ?? null;
	const hasStep = (name) => journal.steps.some((step) => step.name === name);
	if (journal.command === "uninstall") {
		if (current && hasStep("native-deployment-removed"))
			ensureCodexDeploymentAttached({ deployment: current, run, env });
		return;
	}
	if (current) removeCodexDeployment({ deployment: current, run, env, paths });
	if (
		previous &&
		(journal.command === "rollback" || hasStep("native-previous-retired"))
	) {
		ensureCodexDeploymentAttached({ deployment: previous, run, env });
	}
}

function sha256(bytes) {
	return crypto.createHash("sha256").update(bytes).digest("hex");
}

function now() {
	return new Date().toISOString();
}

function selectedReleasePolicy(options = {}) {
	const requested =
		options.releasePolicy ?? options.supportPolicy ?? "offline-provisional";
	if (typeof requested === "string") {
		const alias =
			requested === "provisional-packaging" ? "offline-provisional" : requested;
		const policy = RELEASE_POLICIES[alias];
		if (!policy)
			throwDistributionError(
				"E_EVIDENCE_POLICY",
				`unsupported release policy: ${requested}`,
				{ policy: requested },
			);
		return policy;
	}
	if (!requested || typeof requested !== "object" || Array.isArray(requested)) {
		throwDistributionError(
			"E_EVIDENCE_POLICY",
			"release policy must be a supported policy name",
			{ policy: requested },
		);
	}
	const id = requested.id ?? "offline-provisional";
	const base = RELEASE_POLICIES[id];
	if (!base)
		throwDistributionError(
			"E_EVIDENCE_POLICY",
			`unsupported release policy: ${id}`,
			{ policy: id },
		);
	return Object.freeze({
		id,
		allowProvisionalPackaging:
			requested.allowProvisionalPackaging ?? base.allowProvisionalPackaging,
		requireFailClosed: requested.requireFailClosed ?? base.requireFailClosed,
	});
}

function provenanceHashes(provenance) {
	return {
		source_hash: provenance.sourceHash,
		overlay_hash: provenance.overlayHash,
		materialized_hash: provenance.materializedHash,
		provenance_hash: provenance.provenanceHash,
	};
}

function receiptProvenance(provenance) {
	if (!provenance.agent_projection)
		throwDistributionError(
			"E_PROVENANCE_INCOMPLETE",
			"materialization did not produce agent projection provenance",
			{},
		);
	return {
		...provenanceHashes(provenance),
		agent_projection: provenance.agent_projection,
	};
}

function persistedManagedRoots(paths) {
	return paths.managedRoots.map(({ rootId, path: rootPath, ownership }) => ({
		root_id: rootId,
		path: rootPath,
		ownership,
	}));
}

function managedRootMap(paths) {
	return new Map(paths.managedRoots.map((root) => [root.rootId, root]));
}

function evidenceBinding(provenance, scenarioVersion) {
	const projection = provenance.agent_projection;
	return {
		source_commit: provenance.resolvedCommit,
		source_version: provenance.sourceVersion,
		overlay_id: provenance.overlayId,
		overlay_version: provenance.overlayVersion,
		host: provenance.host,
		scenario_version: scenarioVersion,
		schema_version: projection?.schema_version,
		projector_version: projection?.projector_version,
		canonical_set_digest: projection?.canonical_set_digest,
		manifest_digest: projection?.manifest_digest,
		projected_tree_digest: projection?.projected_tree_digest,
		...provenanceHashes(provenance),
	};
}

function nativeEvidenceInput(options = {}) {
	const supplied =
		options.evidenceRecords ??
		options.nativeEvidence ??
		options.evidence ??
		options.hostProbe?.records ??
		[];
	if (supplied === null || supplied === undefined) return [];
	if (!Array.isArray(supplied))
		throwDistributionError(
			"E_EVIDENCE_SCHEMA",
			"native evidence must be an array",
			{ field: "evidenceRecords" },
		);
	return supplied;
}

/**
 * Cursor install: attach hybrid disk E5 when the caller did not supply native
 * evidence. E6 stays unavailable — CLI cannot prove live Task enum.
 */
function withCursorHybridHostProbe({
	options,
	paths,
	overlay,
	provenance,
	timestamp,
}) {
	if (paths?.target !== "cursor") return options;
	if (nativeEvidenceInput(options).length > 0) return options;
	const binding = evidenceBinding(
		provenance,
		options.scenarioVersion ?? DEFAULT_SCENARIO_VERSION,
	);
	const probe = probeCursorForInstall({
		pluginRoot: paths.activeRoot,
		overlay,
		// Include transaction hash binding up front so evidence_id digests match.
		provenance: {
			...provenance,
			...binding,
			hostVersion: provenance.hostVersion,
		},
		now: timestamp,
		clock: () => timestamp,
	});
	if (!probe?.records?.length) {
		return {
			...options,
			unavailableEvidenceReason:
				options.unavailableEvidenceReason ??
				"cursor-live-task-enum-unobservable-from-cli",
		};
	}
	return {
		...options,
		hostProbe: probe,
		unavailableEvidenceReason:
			options.unavailableEvidenceReason ??
			"cursor-live-invocation-unobservable-from-cli",
	};
}

/**
 * Kiro CLI install: attach hybrid disk E5 when the caller did not supply native
 * evidence. E6 stays unavailable — CLI cannot prove live nativePort.launch.
 */
function withKiroCliHybridHostProbe({
	options,
	paths,
	overlay,
	provenance,
	timestamp,
}) {
	if (paths?.target !== "kiro-cli") return options;
	if (nativeEvidenceInput(options).length > 0) return options;
	const probe = probeKiroCliForInstall({
		kiroHome: paths.activeRoot,
		overlay,
		provenance,
		now: timestamp,
		clock: () => timestamp,
	});
	if (!probe?.records?.length) {
		return {
			...options,
			unavailableEvidenceReason:
				options.unavailableEvidenceReason ??
				"kiro-cli-live-invocation-unobservable-from-cli",
		};
	}
	return {
		...options,
		hostProbe: probe,
		unavailableEvidenceReason:
			options.unavailableEvidenceReason ??
			"kiro-cli-live-invocation-unobservable-from-cli",
	};
}

function createValidatedPortableEvidence({
	target,
	materialized,
	attestation,
	portableCoreHash,
	options,
	timestamp,
}) {
	const validation = materialized.validation ?? {};
	const checks = Object.entries(validation);
	if (
		!validation.inventory?.ok ||
		checks.length === 0 ||
		checks.some(([, result]) => result?.ok !== true)
	) {
		throwDistributionError(
			"E_EVIDENCE_POLICY",
			"installer evidence requires successful materialization assertions",
			{
				target,
				checks: checks.map(([name, result]) => ({
					name,
					ok: result?.ok === true,
				})),
			},
		);
	}
	const provenance = evidenceBinding(
		materialized.provenance,
		options.scenarioVersion ?? DEFAULT_SCENARIO_VERSION,
	);
	const e1 = createEvidenceRecord({
		target,
		capability: "E1",
		hostVersion: materialized.provenance.hostVersion,
		scenario: "overlay-contract-v1",
		result: "passed",
		provenance,
		timestamp,
	});
	const e2 = createEvidenceRecord({
		target,
		capability: "E2",
		hostVersion: materialized.provenance.hostVersion,
		scenario: "materialize-v1",
		result: "passed",
		provenance,
		timestamp,
	});
	const e3 = consumeE3Attestation({
		attestation,
		target,
		hostVersion: materialized.provenance.hostVersion,
		provenance: {
			...provenance,
			resolvedCommit: materialized.provenance.resolvedCommit,
			sourceVersion: materialized.provenance.sourceVersion,
			overlayVersion: materialized.provenance.overlayVersion,
			scenarioVersion: options.scenarioVersion ?? DEFAULT_SCENARIO_VERSION,
			portableCoreTreeHash: portableCoreHash,
			artifactDigest: portableCoreHash,
		},
		now: timestamp,
		requireArtifactDigest: true,
	});
	return [e1, e2, e3];
}

function collectCandidateEvidence({
	target,
	provenance,
	options,
	timestamp,
	records,
}) {
	const scenarioVersion = options.scenarioVersion ?? DEFAULT_SCENARIO_VERSION;
	const binding = evidenceBinding(provenance, scenarioVersion);
	const base = records.map((record) => validateEvidenceRecord(record));
	const baseByCapability = new Map(
		base.map((record) => [record.capability, record]),
	);
	const native = [];
	for (const record of nativeEvidenceInput(options)) {
		const validated = validateEvidenceRecord(record);
		if (validated.target !== target) {
			throwDistributionError(
				"E_EVIDENCE_SCHEMA",
				"native evidence target does not match the transaction target",
				{ target, actual: validated.target },
			);
		}
		const normalized = normalizeEvidenceProvenance(
			validated.provenance,
			binding,
		);
		for (const field of [
			"source_commit",
			"source_version",
			"overlay_version",
			"scenario_version",
			...Object.keys(provenanceHashes(provenance)),
		]) {
			if (normalized[field] !== binding[field]) {
				throwDistributionError(
					"E_PROVENANCE_HASH",
					`native evidence provenance does not match the candidate: ${field}`,
					{ field },
				);
			}
		}
		if (baseByCapability.has(validated.capability)) {
			const expected = baseByCapability.get(validated.capability);
			if (
				validated.result !== "passed" ||
				validated.host_version !== expected.host_version ||
				validated.scenario !== expected.scenario
			) {
				throwDistributionError(
					"E_EVIDENCE_SCHEMA",
					`installer-owned evidence ${validated.capability} does not match the validated transaction`,
					{ capability: validated.capability },
				);
			}
			continue;
		}
		if (!NATIVE_EVIDENCE.has(validated.capability)) {
			throwDistributionError(
				"E_EVIDENCE_SCHEMA",
				"installer accepts only E1-E6 evidence capabilities",
				{ capability: validated.capability },
			);
		}
		if (validated.host_version !== provenance.hostVersion) {
			throwDistributionError(
				"E_EVIDENCE_SCHEMA",
				`native evidence host version does not match the transaction: ${validated.capability}`,
				{ capability: validated.capability },
			);
		}
		native.push(
			validateEvidenceRecord({ ...validated, provenance: normalized }),
		);
	}
	return collectEvidence({
		target,
		records: [...base, ...native],
		hostVersion: provenance.hostVersion,
		provenance: binding,
		timestamp,
		scenarioVersion,
		unavailableReason:
			options.unavailableEvidenceReason ?? "runtime-or-scenario-unavailable",
	});
}

function evaluateCandidateCompatibility({
	target,
	overlay,
	records,
	provenance,
	options,
	installedAt,
}) {
	const scenarioVersion = options.scenarioVersion ?? DEFAULT_SCENARIO_VERSION;
	const policy = selectedReleasePolicy(options);
	const evaluations = evaluateTarget({
		target,
		records,
		capabilities: overlay.capabilities,
		now: installedAt,
		hostVersion: provenance.hostVersion,
		overlayVersion: provenance.overlayVersion,
		sourceCommit: provenance.resolvedCommit,
		scenarioVersion,
	});
	const baseline = records.filter((record) =>
		BASE_EVIDENCE.some(([level]) => level === record.capability),
	);
	if (
		baseline.length !== BASE_EVIDENCE.length ||
		baseline.some((record) => record.result !== "passed")
	) {
		throwDistributionError(
			"E_EVIDENCE_POLICY",
			"portable baseline evidence E1-E4 must pass before installation",
			{
				target,
				baseline: baseline.map((record) => ({
					capability: record.capability,
					result: record.result,
				})),
				policy: policy.id,
			},
		);
	}
	const failClosed = evaluations.filter((evaluation) =>
		FAIL_CLOSED_CLASSES.includes(evaluation.capabilityClass),
	);
	const failedClosed = failClosed.filter(
		(evaluation) => evaluation.status !== "passed",
	);
	const unavailableOnly = failedClosed.every(
		(evaluation) =>
			evaluation.status === "blocked" &&
			evaluation.unavailable.length > 0 &&
			evaluation.failed.length === 0 &&
			evaluation.missing.length === 0 &&
			evaluation.expired.length === 0,
	);
	if (
		failedClosed.length > 0 &&
		(!unavailableOnly || policy.requireFailClosed)
	) {
		throwDistributionError(
			"E_EVIDENCE_POLICY",
			"required semantic, safety, persistence, or rollback evidence is not satisfied",
			{
				target,
				policy: policy.id,
				evaluations: failedClosed,
			},
		);
	}
	const provisional = evaluations.some(
		(evaluation) => evaluation.status === "provisional",
	);
	if (provisional && !policy.allowProvisionalPackaging) {
		throwDistributionError(
			"E_EVIDENCE_POLICY",
			"provisional packaging is not permitted by the release policy",
			{
				target,
				policy: policy.id,
				evaluations,
			},
		);
	}
	const status = evaluations.every(
		(evaluation) => evaluation.status === "passed",
	)
		? "supported"
		: failedClosed.length > 0 || provisional
			? "provisional"
			: "blocked";
	return {
		policy: policy.id,
		scenario_version: scenarioVersion,
		status,
		evaluations,
	};
}

function flushDirectory(directory) {
	let descriptor;
	try {
		descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
		fs.fsyncSync(descriptor);
	} catch (error) {
		if (!["EINVAL", "ENOTSUP", "EPERM", "EISDIR"].includes(error.code)) throw error;
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor);
	}
}

function ensureDirectories(paths) {
	assertSafePath(paths.home, {
		root: path.dirname(paths.home),
		label: "home",
		allowMissing: false,
	});
	const homeStat = fs.lstatSync(paths.home);
	if (!homeStat.isDirectory())
		throwDistributionError("E_PATH_SECURITY", "home must be a directory", {
			home: paths.home,
		});
	const stateBase = path.dirname(path.dirname(paths.stateRoot));
	ensureDirectoryTree(stateBase, {
		root: path.dirname(stateBase),
		label: "state base",
		mode: 0o755,
	});
	ensureDirectoryTree(paths.stateRoot, {
		root: stateBase,
		label: "state root",
		mode: 0o700,
		privateMode: true,
	});
	for (const directory of [
		paths.journalsRoot,
		paths.receiptsRoot,
		paths.backupsRoot,
		paths.stagingRoot,
		paths.controlPlanesRoot,
	]) {
		ensureDirectoryTree(directory, {
			root: paths.stateRoot,
			label: "private state directory",
			mode: 0o700,
			privateMode: true,
		});
	}
	for (const filePath of [paths.activeReceiptPath, paths.lockPath])
		assertSafePath(filePath, { root: paths.stateRoot, label: "state file" });
	for (const root of paths.managedRoots)
		assertSafePath(root.path, {
			root: paths.home,
			label: `managed root ${root.rootId}`,
		});
}

function durableJson(filePath, value, mode = 0o600, { root = null } = {}) {
	const parent = path.dirname(filePath);
	const permittedRoot = root ?? path.dirname(parent);
	if (root) assertSafePath(filePath, { root, label: "durable state path" });
	else assertSafePath(filePath, { root: parent, label: "durable state path" });
	ensureDirectoryTree(parent, {
		root: root ?? path.dirname(parent),
		label: "durable state parent",
		mode: 0o700,
		privateMode: Boolean(root),
	});
	const parentIdentity = capturePathIdentity(parent, {
		root: root ?? path.dirname(parent),
		label: "durable state parent",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(parentIdentity, {
		label: "durable state parent",
		errorCode: "E_PATH_SECURITY",
	});
	const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
	assertSafePath(temporary, {
		root: permittedRoot,
		label: "durable temporary path",
	});
	const descriptor = fs.openSync(
		temporary,
		fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
		mode,
	);
	try {
		fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		fs.fchmodSync(descriptor, mode);
		fs.fsyncSync(descriptor);
	} finally {
		fs.closeSync(descriptor);
	}
	try {
		const temporaryIdentity = capturePathIdentity(temporary, {
			root: permittedRoot,
			label: "durable temporary path",
			allowMissing: false,
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(parentIdentity, {
			label: "durable state parent",
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(temporaryIdentity, {
			label: "durable temporary path",
			errorCode: "E_PATH_SECURITY",
		});
		fs.renameSync(temporary, filePath);
		assertPathIdentity(parentIdentity, {
			label: "durable state parent",
			errorCode: "E_PATH_SECURITY",
		});
		const destinationIdentity = capturePathIdentity(filePath, {
			root: permittedRoot,
			label: "durable state path",
			allowMissing: false,
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(destinationIdentity, {
			label: "durable state path",
			errorCode: "E_PATH_SECURITY",
		});
		flushDirectory(parent);
	} catch (error) {
		try {
			assertPathIdentity(parentIdentity, {
				label: "durable state parent",
				errorCode: "E_PATH_SECURITY",
			});
			removeEntry(temporary, {
				root: permittedRoot,
				label: "durable temporary path",
			});
		} catch {
			/* preserve residue when the destination parent is no longer trusted */
		}
		throw error;
	}
}

function readStableFile(filePath, { root, label }) {
	assertSafePath(filePath, { root, label, allowMissing: false });
	const parentIdentity = capturePathIdentity(path.dirname(filePath), {
		root,
		label: `${label} parent`,
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	const fileIdentity = capturePathIdentity(filePath, {
		root,
		label,
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(parentIdentity, {
		label: `${label} parent`,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(fileIdentity, { label, errorCode: "E_PATH_SECURITY" });
	const bytes = readFileNoFollow(filePath, {
		root,
		label,
		encoding: "utf8",
		beforeOpen: () => {
			assertPathIdentity(parentIdentity, {
				label: `${label} parent`,
				errorCode: "E_PATH_SECURITY",
			});
			assertPathIdentity(fileIdentity, { label, errorCode: "E_PATH_SECURITY" });
		},
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(parentIdentity, {
		label: `${label} parent`,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(fileIdentity, { label, errorCode: "E_PATH_SECURITY" });
	return bytes;
}

function lockOwnerIsAlive(pid, processKill = process.kill.bind(process)) {
	try {
		processKill(pid, 0);
		return true;
	} catch (error) {
		if (error?.code === "ESRCH") return false;
		return true;
	}
}

function removeStaleLock(lockPath, lockParent, existing, processKill) {
	if (
		!existing.isFile() ||
		existing.isSymbolicLink() ||
		(process.platform !== "win32" && (existing.mode & 0o777) !== 0o600) ||
		existing.size > 8_192
	)
		return false;
	let value;
	try {
		value = JSON.parse(
			readFileNoFollow(lockPath, {
				root: lockParent,
				label: "lock path",
				encoding: "utf8",
				errorCode: "E_PATH_SECURITY",
			}),
		);
	} catch {
		return false;
	}
	if (
		!value ||
		Object.keys(value).sort().join(",") !== "acquired_at,pid" ||
		!Number.isSafeInteger(value.pid) ||
		value.pid < 1 ||
		typeof value.acquired_at !== "string" ||
		!Number.isFinite(Date.parse(value.acquired_at)) ||
		lockOwnerIsAlive(value.pid, processKill)
	)
		return false;
	const identity = capturePathIdentity(lockPath, {
		root: lockParent,
		label: "stale lock",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(identity, {
		label: "stale lock",
		errorCode: "E_PATH_SECURITY",
	});
	removeEntry(lockPath, { root: lockParent, label: "stale lock" });
	flushDirectory(lockParent);
	return true;
}

function acquireLock(
	lockPath,
	{ processKill = process.kill.bind(process) } = {},
) {
	assertSafePath(lockPath, {
		root: path.dirname(lockPath),
		label: "lock path",
	});
	const lockParent = path.dirname(lockPath);
	const lockParentIdentity = capturePathIdentity(lockParent, {
		root: path.dirname(lockParent),
		label: "lock parent",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(lockParentIdentity, {
		label: "lock parent",
		errorCode: "E_PATH_SECURITY",
	});
	const existing = fs.lstatSync(lockPath, { throwIfNoEntry: false });
	if (
		existing &&
		!removeStaleLock(lockPath, lockParent, existing, processKill)
	) {
		throwDistributionError(
			"E_LOCK_BUSY",
			"target installation lock is held",
			{ lockPath },
			{ retryable: true },
		);
	}
	try {
		assertPathIdentity(lockParentIdentity, {
			label: "lock parent",
			errorCode: "E_PATH_SECURITY",
		});
		const descriptor = fs.openSync(
			lockPath,
			fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
			0o600,
		);
		try {
			fs.writeFileSync(
				descriptor,
				`${JSON.stringify({ pid: process.pid, acquired_at: now() })}\n`,
				"utf8",
			);
			fs.fsyncSync(descriptor);
		} finally {
			fs.closeSync(descriptor);
		}
		assertPathIdentity(lockParentIdentity, {
			label: "lock parent",
			errorCode: "E_PATH_SECURITY",
		});
		const lockIdentity = capturePathIdentity(lockPath, {
			root: lockParent,
			label: "lock path",
			allowMissing: false,
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(lockIdentity, {
			label: "lock path",
			errorCode: "E_PATH_SECURITY",
		});
		flushDirectory(path.dirname(lockPath));
		return { lockPath };
	} catch (error) {
		if (error.code === "EEXIST" || error.code === "EISDIR")
			throwDistributionError(
				"E_LOCK_BUSY",
				"target installation lock is held",
				{ lockPath },
				{ retryable: true },
			);
		throwDistributionError(
			"E_LOCK_IO",
			`could not acquire target lock: ${error.message}`,
			{ lockPath },
			{ cause: error },
		);
	}
}

function releaseLock(lock) {
	try {
		removeEntry(lock.lockPath, {
			root: path.dirname(lock.lockPath),
			label: "lock path",
		});
	} catch {
		/* cleanup is best effort after a completed transaction */
	}
}

function readReceiptSafely(filePath, paths) {
	assertSafePath(filePath, {
		root: paths.receiptsRoot,
		label: "receipt path",
		allowMissing: false,
	});
	const parentIdentity = capturePathIdentity(path.dirname(filePath), {
		root: paths.receiptsRoot,
		label: "receipt parent",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	const receiptIdentity = capturePathIdentity(filePath, {
		root: paths.receiptsRoot,
		label: "receipt path",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(parentIdentity, {
		label: "receipt parent",
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(receiptIdentity, {
		label: "receipt path",
		errorCode: "E_PATH_SECURITY",
	});
	const receipt = readReceipt(filePath, {
		paths,
		beforeRead: () => {
			assertPathIdentity(parentIdentity, {
				label: "receipt parent",
				errorCode: "E_PATH_SECURITY",
			});
			assertPathIdentity(receiptIdentity, {
				label: "receipt path",
				errorCode: "E_PATH_SECURITY",
			});
		},
	});
	assertPathIdentity(parentIdentity, {
		label: "receipt parent",
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(receiptIdentity, {
		label: "receipt path",
		errorCode: "E_PATH_SECURITY",
	});
	return receipt;
}

function readActive(paths) {
	assertSafePath(paths.activeReceiptPath, {
		root: paths.stateRoot,
		label: "active receipt",
	});
	const activeParentIdentity = capturePathIdentity(
		path.dirname(paths.activeReceiptPath),
		{
			root: paths.stateRoot,
			label: "active receipt parent",
			allowMissing: false,
			errorCode: "E_PATH_SECURITY",
		},
	);
	const activeStat = fs.lstatSync(paths.activeReceiptPath, {
		throwIfNoEntry: false,
	});
	if (!activeStat) return null;
	if (!activeStat.isFile())
		throwDistributionError(
			"E_RECEIPT_IO",
			"active receipt pointer must be a regular file",
			{ path: paths.activeReceiptPath },
		);
	const activeIdentity = capturePathIdentity(paths.activeReceiptPath, {
		root: paths.stateRoot,
		label: "active receipt",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(activeParentIdentity, {
		label: "active receipt parent",
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(activeIdentity, {
		label: "active receipt",
		errorCode: "E_PATH_SECURITY",
	});
	try {
		const pointer = JSON.parse(
			readStableFile(paths.activeReceiptPath, {
				root: paths.stateRoot,
				label: "active receipt",
			}),
		);
		if (!pointer || typeof pointer !== "object" || Array.isArray(pointer))
			throw new Error("invalid active receipt pointer");
		if (pointer.schema_version === 1) {
			throwDistributionError(
				"E_CLEAN_INSTALL_REQUIRED",
				"active receipt schema v1 is unsupported; a clean install with empty Maister target state is required",
				{
					persisted_schema_version: 1,
					required_schema_version: 2,
					artifact: "active receipt",
				},
			);
		}
		const keys = Object.keys(pointer);
		if (
			keys.length !== 3 ||
			pointer.schema_version !== 2 ||
			typeof pointer.receipt_id !== "string" ||
			typeof pointer.receipt_path !== "string"
		)
			throw new Error("invalid active receipt pointer");
		if (!UUID.test(pointer.receipt_id))
			throw new Error("invalid active receipt id");
		const expectedPath = path.join(
			paths.receiptsRoot,
			`${pointer.receipt_id}.json`,
		);
		if (pointer.receipt_path !== expectedPath)
			throwDistributionError(
				"E_RECEIPT_SCHEMA",
				"active receipt path is outside the receipts root",
				{ receipt_path: pointer.receipt_path },
			);
		assertSafePath(pointer.receipt_path, {
			root: paths.receiptsRoot,
			label: "active receipt target",
			allowMissing: false,
		});
		assertPathIdentity(activeParentIdentity, {
			label: "active receipt parent",
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(activeIdentity, {
			label: "active receipt",
			errorCode: "E_PATH_SECURITY",
		});
		return {
			receipt: readReceiptSafely(pointer.receipt_path, paths),
			receiptPath: pointer.receipt_path,
		};
	} catch (error) {
		if (["E_RECEIPT_SCHEMA", "E_CLEAN_INSTALL_REQUIRED"].includes(error?.kind))
			throw error;
		throw distributionError(
			"E_RECEIPT_IO",
			"active receipt pointer is invalid",
			{ path: paths.activeReceiptPath },
			{ cause: error },
		);
	}
}

function readReceiptById(paths, receiptId) {
	if (!receiptId) return null;
	if (typeof receiptId !== "string" || !UUID.test(receiptId))
		throwDistributionError("E_RECEIPT_SCHEMA", "receipt id must be a UUID", {
			receiptId,
		});
	const filePath = path.join(paths.receiptsRoot, `${receiptId}.json`);
	assertSafePath(filePath, {
		root: paths.receiptsRoot,
		label: "receipt path",
		allowMissing: false,
	});
	return { receipt: readReceiptSafely(filePath, paths), receiptPath: filePath };
}

function assertNoLegacyState(paths) {
	const stateStat = fs.lstatSync(paths.stateRoot, { throwIfNoEntry: false });
	if (!stateStat) return;
	if (!stateStat.isDirectory() || stateStat.isSymbolicLink())
		throwDistributionError(
			"E_PATH_SECURITY",
			"state root must be a real directory",
			{ path: paths.stateRoot },
		);
	const candidates = [paths.activeReceiptPath];
	for (const root of [paths.receiptsRoot, paths.journalsRoot]) {
		const stat = fs.lstatSync(root, { throwIfNoEntry: false });
		if (!stat) continue;
		if (!stat.isDirectory() || stat.isSymbolicLink())
			throwDistributionError(
				"E_PATH_SECURITY",
				"transaction state directory must be a real directory",
				{ path: root },
			);
		for (const name of fs
			.readdirSync(root)
			.filter((entry) => entry.endsWith(".json")))
			candidates.push(path.join(root, name));
	}
	for (const candidate of candidates) {
		const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
		if (!stat) continue;
		if (!stat.isFile() || stat.isSymbolicLink()) continue;
		let parsed;
		try {
			parsed = JSON.parse(
				readFileNoFollow(candidate, {
					root: paths.stateRoot,
					label: "persisted transaction state",
					encoding: "utf8",
					errorCode: "E_PATH_SECURITY",
				}),
			);
		} catch {
			continue;
		}
		if (parsed?.schema_version === 1) {
			throwDistributionError(
				"E_CLEAN_INSTALL_REQUIRED",
				"persisted receipt or journal schema v1 is unsupported; a clean install with empty Maister target state is required",
				{
					persisted_schema_version: 1,
					required_schema_version: 2,
					path: candidate,
				},
			);
		}
	}
}

function writeJournal(paths, journal) {
	validateJournal(journal, { paths });
	const journalPath = path.join(
		paths.journalsRoot,
		`${journal.journal_id}.json`,
	);
	durableJson(journalPath, journal, 0o600, { root: paths.journalsRoot });
	return journalPath;
}

function transition(paths, journal, state, details = {}) {
	const next = appendTransition(journal, state, details);
	writeJournal(paths, next);
	return next;
}

function failureInjection(options, point) {
	if (options.failurePoint === point)
		throwDistributionError(
			"E_TX_FAILURE",
			`injected transaction failure at ${point}`,
			{ point },
		);
}

function durableBoundary(options, marker, details = {}) {
	if (!DURABLE_BOUNDARY_MARKER_SET.has(marker)) {
		throwDistributionError(
			"E_TRANSACTION",
			"unknown durable transaction boundary",
			{ marker },
		);
	}
	options.onDurableBoundary?.(Object.freeze({ marker, ...details }));
	if (
		options.failurePoint === marker ||
		options.failurePoint === `after-${marker}`
	) {
		throwDistributionError(
			"E_TX_FAILURE",
			`injected transaction failure at ${marker}`,
			{ point: marker },
		);
	}
}

function nativeDurableBoundary(options, marker, details = {}) {
	if (!NATIVE_DURABLE_BOUNDARY_MARKERS.has(marker)) {
		throwDistributionError(
			"E_TRANSACTION",
			"unknown native transaction boundary",
			{ marker },
		);
	}
	options.onDurableBoundary?.(Object.freeze({ marker, ...details }));
	if (
		options.failurePoint === marker ||
		options.failurePoint === `after-${marker}`
	) {
		throwDistributionError(
			"E_TX_FAILURE",
			`injected transaction failure at ${marker}`,
			{ point: marker },
		);
	}
}

function sourcePathValue(source) {
	if (typeof source !== "string" || source.trim() === "") return null;
	if (source.startsWith("local:")) return source.slice("local:".length);
	if (source.startsWith("file:")) {
		try {
			return new URL(source).pathname;
		} catch {
			return null;
		}
	}
	if (source.startsWith("github:")) return null;
	return source;
}

function assertSourceRootBinding(source, options = {}) {
	const boundRoot = ensureDirectoryRoot(
		path.resolve(source.root),
		"resolved source root",
	);
	const candidates = [
		["resolvedSourceRoot", options.resolvedSourceRoot],
		["source", sourcePathValue(options.source)],
	];
	for (const [field, candidate] of candidates) {
		if (typeof candidate !== "string" || candidate.trim() === "") continue;
		const candidateRoot = ensureDirectoryRoot(
			path.resolve(candidate),
			`${field} root`,
		);
		if (candidateRoot !== boundRoot) {
			throwDistributionError(
				"E_SOURCE_ROOT",
				`${field} does not match the resolved lifecycle source binding`,
				{
					field,
					expected: boundRoot,
					actual: candidateRoot,
				},
			);
		}
	}
	return boundRoot;
}

function assertMaterializedSourceBinding(expected, actual) {
	const fields = [
		"kind",
		"root",
		"requestedSource",
		"requestedRef",
		"resolvedCommit",
		"sourceVersion",
		"contentHash",
		"dirty",
		"statusFingerprint",
	];
	for (const field of fields) {
		const expectedValue =
			field === "root"
				? fs.realpathSync(expected[field])
				: (expected[field] ?? null);
		const actualValue =
			field === "root"
				? fs.realpathSync(actual[field])
				: (actual[field] ?? null);
		if (expectedValue !== actualValue) {
			throwDistributionError(
				"E_SOURCE_BINDING",
				"materialized source does not match the lifecycle source binding",
				{
					field,
					expected: expectedValue,
					actual: actualValue,
				},
			);
		}
	}
}

function candidateOverlay(
	source,
	target,
	overlayRoot,
	{ resolvedSourceRoot = null, sourceBound = false } = {},
) {
	const sourceCandidates = [];
	const sourceCandidate = resolvedSourceRoot ?? sourcePathValue(source);
	if (sourceCandidate) {
		const sourceAbsolute = sourceBound
			? ensureDirectoryRoot(
					path.resolve(sourceCandidate),
					"resolved source root",
				)
			: path.resolve(sourceCandidate);
		sourceCandidates.push(
			path.join(sourceAbsolute, "plugins/maister/overlays", target),
			path.join(sourceAbsolute, "overlays", target),
			sourceAbsolute,
		);
	}
	const candidates = sourceBound
		? sourceCandidates
		: [...sourceCandidates, path.join(overlayRoot ?? "", target)];
	if (sourceBound && candidates.length === 0) {
		throwDistributionError(
			"E_SOURCE_ROOT",
			"install/update requires an overlay from the resolved source root",
			{
				target,
				source: source ?? null,
			},
		);
	}
	const selected = candidates.find(
		(directory) =>
			fs.existsSync(path.join(directory, "overlay.yml")) &&
			fs.existsSync(path.join(directory, "inventory.yml")),
	);
	if (!selected)
		throwDistributionError(
			"E_OVERLAY_IO",
			`overlay is not available for ${target}`,
			{ target, candidates },
		);
	if (sourceBound) {
		const sourceRoot = ensureDirectoryRoot(
			path.resolve(sourceCandidate),
			"resolved source root",
		);
		for (const candidate of [
			selected,
			path.join(selected, "overlay.yml"),
			path.join(selected, "inventory.yml"),
		]) {
			capturePathIdentity(candidate, {
				root: sourceRoot,
				label: "source-bound overlay path",
				allowMissing: false,
				errorCode: "E_PATH_SECURITY",
			});
		}
	}
	return {
		overlayPath: path.join(selected, "overlay.yml"),
		inventoryPath: path.join(selected, "inventory.yml"),
		overlayBase: selected,
	};
}

function ownershipFor(plan, relative) {
	const ownership =
		plan.find((entry) => entry.destination === relative)?.ownership ??
		"whole_file";
	return ownership === "plugin_private" ? "whole_file" : ownership;
}

function receiptInventory(stagingRoot, plan, paths, projection) {
	const entries = [];
	const seen = new Set();
	const rootOwnership = new Map(
		paths.managedRoots.map((r) => [r.rootId, r.ownership]),
	);
	for (const entry of hashTree(stagingRoot).entries) {
		const rootId = "plugin_private";
		const relativePath = entry.path;
		if (rootOwnership.get(rootId) === "leaf_set" && entry.type === "directory")
			continue;
		const identity = `${rootId}\0${relativePath}`;
		if (seen.has(identity))
			throwDistributionError(
				"E_MATERIALIZE_COLLISION",
				"materialized outputs collide in a managed root",
				{ root_id: rootId, path: relativePath },
			);
		seen.add(identity);
		entries.push({
			root_id: rootId,
			path: relativePath,
			source_path: entry.path,
			type: entry.type,
			mode: entry.mode,
			sha256: entry.type === "file" ? entry.sha256 : null,
			link_target: entry.type === "symlink" ? entry.target : null,
			ownership: ownershipFor(plan, entry.path),
		});
	}
	return entries.sort(
		(left, right) =>
			left.root_id.localeCompare(right.root_id) ||
			left.path.localeCompare(right.path),
	);
}

function persistedInventory(entries) {
	return entries.map(({ source_path: _sourcePath, ...entry }) => entry);
}

function assertNoUnmanagedCollisions(
	candidateInventory,
	previousReceipt,
	paths,
	{ allowLeafSetOverwrite = false } = {},
) {
	const roots = managedRootMap(paths);
	const owned = new Set(
		(previousReceipt?.managed_inventory ?? []).map(
			(entry) => `${entry.root_id}\0${entry.path}`,
		),
	);
	if (!previousReceipt) {
		for (const root of paths.managedRoots.filter(
			({ ownership }) => ownership === "whole_tree",
		)) {
			if (fs.lstatSync(root.path, { throwIfNoEntry: false })) {
				throwDistributionError(
					"E_DRIFT_CONFLICT",
					"an unmanaged whole-tree root already exists",
					{ root_id: root.rootId, path: root.path },
				);
			}
		}
	}
	const collisions = [];
	for (const entry of candidateInventory.filter(
		({ type }) => type !== "directory",
	)) {
		const identity = `${entry.root_id}\0${entry.path}`;
		if (owned.has(identity)) continue;
		const root = roots.get(entry.root_id);
		const actual = describe(root.path, entry.path);
		if (actual.exists) {
			if (root.ownership === "leaf_set" && allowLeafSetOverwrite) {
				collisions.push({ root_id: entry.root_id, path: entry.path, actual });
			} else {
				throwDistributionError(
					"E_DRIFT_CONFLICT",
					"unmanaged content collides with a managed destination",
					{
						root_id: entry.root_id,
						path: entry.path,
						actual,
					},
				);
			}
		}
	}
	return collisions;
}

function removeManagedPath(root, relative, type) {
	const absolute = path.resolve(root, ...relative.split("/"));
	assertSafePath(absolute, { root, label: "managed target path" });
	const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
	if (!stat) return;
	if (type === "directory") {
		const parent = path.dirname(absolute);
		const parentIdentity = capturePathIdentity(parent, {
			root,
			label: "managed target parent",
			allowMissing: false,
			errorCode: "E_PATH_SECURITY",
		});
		const targetIdentity = capturePathIdentity(absolute, {
			root,
			label: "managed target path",
			allowMissing: false,
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(parentIdentity, {
			label: "managed target parent",
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(targetIdentity, {
			label: "managed target path",
			errorCode: "E_PATH_SECURITY",
		});
		try {
			fs.rmdirSync(absolute);
		} catch (error) {
			if (!["ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
		}
		assertPathIdentity(parentIdentity, {
			label: "managed target parent",
			errorCode: "E_PATH_SECURITY",
		});
	} else
		removeEntry(absolute, {
			root,
			label: "managed target path",
			allowLeafSymlink: true,
		});
}

function validateReceiptPaths(receipt, paths) {
	const roots = managedRootMap(paths);
	for (const root of receipt.managed_roots) {
		const expected = roots.get(root.root_id);
		if (
			!expected ||
			expected.path !== root.path ||
			expected.ownership !== root.ownership
		)
			throwDistributionError(
				"E_RECEIPT_SCHEMA",
				"receipt managed roots differ from target paths",
				{ root_id: root.root_id },
			);
		assertSafePath(root.path, {
			root: paths.home,
			label: `managed receipt root ${root.root_id}`,
		});
	}
	for (const entry of receipt.managed_inventory) {
		const root = roots.get(entry.root_id);
		if (!root)
			throwDistributionError(
				"E_RECEIPT_SCHEMA",
				"managed inventory references an unknown root",
				{ root_id: entry.root_id },
			);
		assertSafePath(path.resolve(root.path, ...entry.path.split("/")), {
			root: paths.home,
			label: "managed receipt path",
			allowLeafSymlink: true,
		});
	}
	for (const setting of receipt.settings) {
		const targetPath = settingTargetPath(paths, setting);
		assertSafePath(targetPath, {
			root: paths.home,
			label: "settings receipt path",
		});
	}
}

function commitWholeTree({
	stagingRoot,
	activeRoot,
	candidateInventory,
	previousReceipt,
	failurePoint,
	home,
}) {
	const parent = path.dirname(activeRoot);
	ensureDirectoryTree(parent, {
		root: home,
		label: "active target parent",
		mode: 0o755,
	});
	assertSafePath(activeRoot, { root: parent, label: "active target" });
	const parentIdentity = capturePathIdentity(parent, {
		root: path.dirname(parent),
		label: "active target parent",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	const activeIdentity = capturePathIdentity(activeRoot, {
		root: parent,
		label: "active target",
		allowMissing: true,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(parentIdentity, {
		label: "active target parent",
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(activeIdentity, {
		label: "active target",
		errorCode: "E_PATH_SECURITY",
	});
	const replacement = path.join(
		parent,
		`.maister-replacement-${crypto.randomUUID()}`,
	);
	const displaced = path.join(
		parent,
		`.maister-displaced-${crypto.randomUUID()}`,
	);
	assertSafePath(replacement, { root: parent, label: "replacement target" });
	ensureDirectoryTree(replacement, {
		root: parent,
		label: "replacement target",
		mode: 0o700,
	});
	try {
		const activeStat = fs.lstatSync(activeRoot, { throwIfNoEntry: false });
		if (activeStat)
			copyTreeEntry(activeRoot, replacement, {
				sourceRoot: activeRoot,
				destinationRoot: parent,
			});
		const next = new Set(candidateInventory.map((entry) => entry.path));
		if (previousReceipt) {
			for (const entry of previousReceipt.managed_inventory
				.filter(({ root_id: rootId }) => rootId === "plugin_private")
				.sort((left, right) => right.path.length - left.path.length)) {
				if (!next.has(entry.path))
					removeManagedPath(replacement, entry.path, entry.type);
			}
		}
		let operations = 0;
		for (const entry of candidateInventory.filter(
			(value) => value.type === "directory",
		)) {
			copyTreeEntry(
				path.join(stagingRoot, ...entry.source_path.split("/")),
				path.join(replacement, ...entry.path.split("/")),
				{ sourceRoot: stagingRoot, destinationRoot: replacement },
			);
		}
		for (const entry of candidateInventory.filter(
			(value) => value.type !== "directory",
		)) {
			copyTreeEntry(
				path.join(stagingRoot, ...entry.source_path.split("/")),
				path.join(replacement, ...entry.path.split("/")),
				{ sourceRoot: stagingRoot, destinationRoot: replacement },
			);
			operations += 1;
			if (failurePoint === "during-commit" && operations === 1)
				failureInjection({ failurePoint }, "during-commit");
		}
		flushDirectory(replacement);
		assertPathIdentity(parentIdentity, {
			label: "active target parent",
			errorCode: "E_PATH_SECURITY",
		});
		assertPathIdentity(activeIdentity, {
			label: "active target",
			errorCode: "E_PATH_SECURITY",
		});
		if (activeStat) {
			fs.renameSync(activeRoot, displaced);
			assertPathIdentity(parentIdentity, {
				label: "active target parent",
				errorCode: "E_PATH_SECURITY",
			});
			try {
				fs.renameSync(replacement, activeRoot);
			} catch (error) {
				fs.renameSync(displaced, activeRoot);
				throw error;
			}
			flushDirectory(parent);
			removeEntry(displaced, { root: parent, label: "displaced target" });
			flushDirectory(parent);
		} else {
			fs.renameSync(replacement, activeRoot);
			assertPathIdentity(parentIdentity, {
				label: "active target parent",
				errorCode: "E_PATH_SECURITY",
			});
			flushDirectory(parent);
		}
	} catch (error) {
		removeEntry(replacement, { root: parent, label: "replacement target" });
		throw error;
	}
}

function assertRootInventoryUnchanged(receipt, rootId, paths) {
	if (!receipt) return;
	const root = managedRootMap(paths).get(rootId);
	const conflicts = [];
	for (const entry of receipt.managed_inventory.filter(
		({ root_id: entryRootId }) => entryRootId === rootId,
	)) {
		const actual = describe(root.path, entry.path);
		const matches =
			actual.exists &&
			actual.type === entry.type &&
			observedModeMatches(entry.mode, actual.mode) &&
			(entry.type !== "file" || actual.sha256 === entry.sha256) &&
			(entry.type !== "symlink" || actual.linkTarget === entry.link_target);
		if (!matches)
			conflicts.push({
				root_id: rootId,
				path: entry.path,
				expected: entry,
				actual,
			});
	}
	if (conflicts.length > 0)
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"managed content changed at a mutation boundary",
			{ conflicts },
		);
}

function commitLeafSet({
	stagingRoot,
	root,
	candidateInventory,
	previousReceipt,
	paths,
}) {
	ensureDirectoryTree(root.path, {
		root: paths.home,
		label: `${root.rootId} root`,
		mode: 0o755,
	});
	const next = new Set(
		candidateInventory.map(({ path: entryPath }) => entryPath),
	);
	const previous =
		previousReceipt?.managed_inventory.filter(
			({ root_id: rootId }) => rootId === root.rootId,
		) ?? [];
	for (const entry of [...previous].sort(
		(left, right) => right.path.length - left.path.length,
	)) {
		if (!next.has(entry.path))
			removeManagedPath(root.path, entry.path, entry.type);
	}
	for (const entry of candidateInventory) {
		const destination = path.join(root.path, ...entry.path.split("/"));
		ensureDirectoryTree(path.dirname(destination), {
			root: paths.home,
			label: `${root.rootId} leaf parent`,
			mode: 0o755,
		});
		copyTreeEntry(
			path.join(stagingRoot, ...entry.source_path.split("/")),
			destination,
			{ sourceRoot: stagingRoot, destinationRoot: paths.home },
		);
	}
	flushDirectory(root.path);
}

function commitManagedRoots({
	stagingRoot,
	candidateInventory,
	previousReceipt,
	paths,
	options,
}) {
	for (const root of paths.managedRoots) {
		assertRootInventoryUnchanged(previousReceipt, root.rootId, paths);
		const rootInventory = candidateInventory.filter(
			({ root_id: rootId }) => rootId === root.rootId,
		);
		if (root.ownership === "whole_tree") {
			commitWholeTree({
				stagingRoot,
				activeRoot: root.path,
				candidateInventory: rootInventory,
				previousReceipt,
				failurePoint: options.failurePoint,
				home: paths.home,
			});
		} else {
			commitLeafSet({
				stagingRoot,
				root,
				candidateInventory: rootInventory,
				previousReceipt,
				paths,
			});
		}
		failureInjection(options, `after-root-${root.rootId}`);
	}
}

function commitSettings(settings, paths, failurePoint) {
	let operations = 0;
	for (const setting of settings) {
		const parent = path.dirname(setting.targetPath);
		ensureDirectoryTree(parent, {
			root: paths.home,
			label: "settings parent",
			mode: 0o755,
		});
		assertSafePath(setting.targetPath, {
			root: paths.home,
			label: "settings target",
		});
		atomicWriteSetting(
			setting.targetPath,
			setting.bytes,
			setting.mode ?? "0600",
			{
				expected: {
					exists: setting.beforeSha256 !== null,
					sha256: setting.beforeSha256,
					mode: setting.beforeMode,
				},
			},
		);
		operations += 1;
		if (failurePoint === "during-commit" && operations === 1)
			failureInjection({ failurePoint }, "during-commit");
	}
}

function settingTargetPath(paths, definition) {
	return resolveTargetSettingPath(paths, definition.path);
}

function hasJsonValue(value) {
	if (Array.isArray(value)) return value.length > 0 && value.some(hasJsonValue);
	if (value !== null && typeof value === "object")
		return Object.values(value).some(hasJsonValue);
	return value !== undefined;
}

function isEmptyManagedJson(bytes) {
	try {
		return !hasJsonValue(JSON.parse(bytes.toString("utf8")));
	} catch {
		return false;
	}
}

function pruneEmptyDirectories(root) {
	const stat = fs.lstatSync(root, { throwIfNoEntry: false });
	if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return;
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory() && !entry.isSymbolicLink())
			pruneEmptyDirectories(path.join(root, entry.name));
	}
	try {
		fs.rmdirSync(root);
	} catch (error) {
		if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
	}
}

function validateSettingPaths(overlay, paths) {
	for (const definition of overlay.settings) {
		const targetPath = settingTargetPath(paths, definition);
		assertSafePath(targetPath, { root: paths.home, label: "settings target" });
		assertSafePath(path.dirname(targetPath), {
			root: paths.home,
			label: "settings parent",
		});
	}
}

function prepareSettings({ overlay, paths, target, activeRoot, stagingRoot }) {
	validateSettingPaths(overlay, paths);
	return overlay.settings.map((definition) =>
		prepareSetting({
			definition,
			targetPath: settingTargetPath(paths, definition),
			target,
			activeRoot,
			stagedPath: path.join(stagingRoot, ...definition.path.split("/")),
			homeRoot: paths.home,
		}),
	);
}

function settingsReceipt(settings, backupRoot) {
	return settings.map((setting, index) => ({
		path: setting.path,
		format: setting.format,
		ownership: setting.ownership,
		managed_keys: setting.managed_keys,
		before_sha256: setting.beforeSha256,
		after_sha256: setting.afterSha256,
		backup_ref: path.relative(
			backupRoot,
			path.join(backupRoot, "settings", String(index)),
		),
		mode: setting.mode,
		before_mode: setting.beforeMode,
		...(setting.managedArray ?? {}),
		...(setting.managedValues ? { managed_values: setting.managedValues } : {}),
	}));
}

function verifyReceipt(
	receiptState,
	paths,
	overlay,
	expectedProjection = null,
) {
	const conflicts = [];
	const roots = managedRootMap(paths);
	for (const entry of receiptState.managed_inventory) {
		const root = roots.get(entry.root_id);
		const absolute = path.resolve(root.path, ...entry.path.split("/"));
		assertSafePath(absolute, {
			root: paths.home,
			label: "managed receipt path",
			allowLeafSymlink: true,
		});
		const actual = describe(root.path, entry.path);
		if (
			!actual.exists ||
			actual.type !== entry.type ||
			!observedModeMatches(entry.mode, actual.mode) ||
			(entry.type === "file" && actual.sha256 !== entry.sha256) ||
			(entry.type === "symlink" && actual.linkTarget !== entry.link_target)
		)
			conflicts.push({ root_id: entry.root_id, path: entry.path });
	}
	for (const setting of receiptState.settings) {
		const definition = overlay.settings.find(
			({ path: settingPath }) => settingPath === setting.path,
		);
		const targetPath = settingTargetPath(paths, definition ?? setting);
		assertSafePath(targetPath, {
			root: paths.home,
			label: "settings receipt path",
		});
		const stat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
		if (
			!stat ||
			stat.isSymbolicLink() ||
			!stat.isFile() ||
			(setting.ownership === "whole_file" &&
				hashFile(targetPath) !== setting.after_sha256) ||
			!observedModeMatches(setting.mode, formatMode(stat.mode))
		)
			conflicts.push(setting.path);
		if (setting.ownership === "managed_array_entries") {
			try {
				assertManagedArrayUnchanged({
					definition,
					targetPath,
					activeRoot: paths.activeRoot,
					receiptSetting: setting,
					homeRoot: paths.home,
				});
			} catch (error) {
				if (error?.kind === "E_DRIFT_CONFLICT") conflicts.push(setting.path);
				else throw error;
			}
		} else if (setting.ownership === "managed_keys") {
			try {
				assertManagedKeysUnchanged({
					definition,
					targetPath,
					target: paths.target,
					activeRoot: paths.activeRoot,
					receiptSetting: setting,
				});
			} catch (error) {
				if (error?.kind === "E_DRIFT_CONFLICT") conflicts.push(setting.path);
				else throw error;
			}
		}
	}
	if (conflicts.length > 0)
		throwDistributionError(
			"E_INTEGRITY",
			"post-commit integrity verification failed",
			{ conflicts },
		);
	if (overlay.target.id !== receiptState.target.id)
		throwDistributionError(
			"E_INTEGRITY",
			"receipt target does not match overlay",
			{},
		);
	if (
		expectedProjection !== null &&
		canonicalJson(receiptState.provenance?.agent_projection) !==
			canonicalJson(expectedProjection)
	) {
		throwDistributionError(
			"E_INTEGRITY",
			"receipt projection provenance does not match the verified materialization",
			{},
		);
	}
}

function normalizePrivateControlPlane(root) {
	const visit = (current) => {
		const stat = fs.lstatSync(current);
		if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
			throwDistributionError(
				"E_CONTROL_PLANE_TYPE",
				"verified control-plane closure contains an unsupported entry",
				{ path: current },
			);
		}
		if (stat.isDirectory()) {
			fs.chmodSync(current, 0o700);
			for (const name of fs.readdirSync(current).sort())
				visit(path.join(current, name));
			return;
		}
		fs.chmodSync(current, 0o600);
	};
	visit(root);
}

function stageControlPlane({
	sourceRoot,
	stageRoot,
	paths,
	journalId,
	source,
}) {
	const sourcePluginRoot = path.join(sourceRoot, "plugins", "maister");
	const stagePath = path.join(stageRoot, "control-plane");
	const destinationPath = path.join(paths.controlPlanesRoot, journalId);
	ensureDirectoryTree(stagePath, {
		root: stageRoot,
		label: "control-plane staging root",
		mode: 0o700,
		privateMode: true,
	});
	ensureDirectoryTree(path.join(stagePath, "plugins"), {
		root: stageRoot,
		label: "control-plane staging plugins root",
		mode: 0o700,
		privateMode: true,
	});
	copyTreeEntry(sourcePluginRoot, path.join(stagePath, "plugins", "maister"), {
		sourceRoot,
		destinationRoot: stageRoot,
	});
	normalizePrivateControlPlane(stagePath);
	const tree = hashTree(stagePath);
	if (tree.entries.some((entry) => entry.type === "symlink")) {
		throwDistributionError(
			"E_CONTROL_PLANE_TYPE",
			"verified control-plane closure contains a symlink",
			{ source: sourcePluginRoot },
		);
	}
	const installerPath = path.join(
		stagePath,
		"plugins",
		"maister",
		"bin",
		"maister-install.mjs",
	);
	const installerStat = fs.lstatSync(installerPath, { throwIfNoEntry: false });
	if (!installerStat?.isFile() || installerStat.isSymbolicLink())
		throwDistributionError(
			"E_CONTROL_PLANE_TOPOLOGY",
			"verified control-plane installer is missing or unsafe",
			{ path: installerPath },
		);
	const installerSha256 = hashFile(installerPath);
	return Object.freeze({
		schema_version: CONTROL_PLANE_SCHEMA_VERSION,
		root_ref: `control-planes/${journalId}`,
		installer_ref: `control-planes/${journalId}/plugins/maister/bin/maister-install.mjs`,
		stage_path: stagePath,
		destination_path: destinationPath,
		tree_hash: tree.contentHash,
		installer_sha256: installerSha256,
		cli_contract_version: CLI_CONTRACT_VERSION,
		source_version: source.sourceVersion,
		source_commit: source.resolvedCommit,
		source_content_hash: source.sourceHash,
		cleanup_owner: "transaction",
	});
}

function stageExistingControlPlane({ previous, stageRoot, paths, journalId }) {
	const sourceRoot = path.join(paths.stateRoot, previous.root_ref);
	const stagePath = path.join(stageRoot, "control-plane");
	const destinationPath = path.join(paths.controlPlanesRoot, journalId);
	assertSafePath(sourceRoot, {
		root: paths.controlPlanesRoot,
		label: "previous control-plane root",
		allowMissing: false,
	});
	ensureDirectoryTree(stagePath, {
		root: stageRoot,
		label: "control-plane staging root",
		mode: 0o700,
		privateMode: true,
	});
	copyTreeEntry(sourceRoot, stagePath, {
		sourceRoot: paths.controlPlanesRoot,
		destinationRoot: paths.stagingRoot,
	});
	normalizePrivateControlPlane(stagePath);
	const tree = hashTree(stagePath);
	const installerPath = path.join(
		stagePath,
		"plugins",
		"maister",
		"bin",
		"maister-install.mjs",
	);
	const installerStat = fs.lstatSync(installerPath, { throwIfNoEntry: false });
	if (!installerStat?.isFile() || installerStat.isSymbolicLink())
		throwDistributionError(
			"E_CONTROL_PLANE_TOPOLOGY",
			"previous control-plane installer is missing or unsafe",
			{ path: installerPath },
		);
	return Object.freeze({
		schema_version: previous.schema_version,
		root_ref: `control-planes/${journalId}`,
		installer_ref: `control-planes/${journalId}/plugins/maister/bin/maister-install.mjs`,
		stage_path: stagePath,
		destination_path: destinationPath,
		tree_hash: tree.contentHash,
		installer_sha256: hashFile(installerPath),
		cli_contract_version: previous.cli_contract_version,
		source_version: previous.source_version,
		source_commit: previous.source_commit,
		source_content_hash: previous.source_content_hash,
		cleanup_owner: "transaction",
	});
}

function receiptControlPlane(controlPlane) {
	return {
		schema_version: controlPlane.schema_version,
		root_ref: controlPlane.root_ref,
		installer_ref: controlPlane.installer_ref,
		tree_hash: controlPlane.tree_hash,
		installer_sha256: controlPlane.installer_sha256,
		cli_contract_version: controlPlane.cli_contract_version,
		source_version: controlPlane.source_version,
		source_commit: controlPlane.source_commit,
		source_content_hash: controlPlane.source_content_hash,
	};
}

function promoteControlPlane(controlPlane, paths) {
	if (fs.lstatSync(controlPlane.destination_path, { throwIfNoEntry: false })) {
		throwDistributionError(
			"E_CONTROL_PLANE_COLLISION",
			"receipt-bound control-plane destination already exists",
			{ destination: controlPlane.destination_path },
		);
	}
	const stageIdentity = capturePathIdentity(controlPlane.stage_path, {
		root: paths.stagingRoot,
		label: "control-plane staging root",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	const destinationParent = path.dirname(controlPlane.destination_path);
	ensureDirectoryTree(destinationParent, {
		root: paths.controlPlanesRoot,
		label: "control-plane destination parent",
		mode: 0o700,
		privateMode: true,
	});
	const destinationParentIdentity = capturePathIdentity(destinationParent, {
		root: paths.controlPlanesRoot,
		label: "control-plane destination parent",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(stageIdentity, {
		label: "control-plane staging root",
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(destinationParentIdentity, {
		label: "control-plane destination parent",
		errorCode: "E_PATH_SECURITY",
	});
	try {
		fs.renameSync(controlPlane.stage_path, controlPlane.destination_path);
	} catch (error) {
		throwDistributionError(
			"E_CONTROL_PLANE_ATOMIC",
			"control-plane promotion must be an atomic same-filesystem rename",
			{
				source: controlPlane.stage_path,
				destination: controlPlane.destination_path,
			},
			{ cause: error, retryable: true },
		);
	}
	flushDirectory(destinationParent);
	const tree = hashTree(controlPlane.destination_path);
	const installerPath = path.join(
		controlPlane.destination_path,
		"plugins",
		"maister",
		"bin",
		"maister-install.mjs",
	);
	if (
		tree.contentHash !== controlPlane.tree_hash ||
		hashFile(installerPath) !== controlPlane.installer_sha256
	) {
		throwDistributionError(
			"E_CONTROL_PLANE_INTEGRITY",
			"promoted control-plane does not match its staged hashes",
			{ destination: controlPlane.destination_path },
		);
	}
}

function newJournal({
	command,
	paths,
	journalId,
	stageRoot,
	previousReceipt,
	candidateReceipt = null,
	controlPlane = null,
	backupRoot = null,
	backupManifestHash = null,
	nativeDeployment = null,
	previousNativeDeployment = null,
}) {
	const started = now();
	return {
		schema_version: 2,
		journal_id: journalId,
		command,
		target: paths.target,
		started_at: started,
		updated_at: started,
		state: "prepared",
		state_history: [{ state: "prepared", timestamp: started }],
		stage_root: stageRoot,
		managed_roots: persistedManagedRoots(paths),
		previous_receipt: previousReceipt?.receiptPath ?? null,
		candidate_receipt: candidateReceipt,
		control_plane: controlPlane,
		native_deployment: nativeDeployment,
		previous_native_deployment: previousNativeDeployment,
		backup_root: backupRoot,
		backup_manifest_hash: backupManifestHash,
		lock: { path: paths.lockPath },
		steps: [],
		failure: null,
	};
}

function failedJournal(paths, journal, state, failure) {
	const steps =
		state === "recovered" &&
		!journal.steps.some(
			(step) => step.name === "recovery" && step.status === "completed",
		)
			? [
					...journal.steps,
					{
						name: "recovery",
						status: "completed",
						timestamp: now(),
						before_ref: failure.details?.backup_root ?? null,
						after_hash: null,
					},
				]
			: journal.steps;
	const next = appendTransition(journal, state, {
		steps,
		failure: {
			kind: failure.kind,
			details: failure.details ?? {},
			retryable: Boolean(failure.retryable),
		},
	});
	try {
		writeJournal(paths, next);
	} catch (journalError) {
		failure.details = {
			...(failure.details ?? {}),
			journal_write_error: journalError.message,
		};
	}
	return next;
}

async function installOrUpdate(command, options, paths) {
	const active = readActive(paths);
	const previousReceipt = active?.receipt ?? null;
	const overlayFiles = candidateOverlay(
		options.source,
		paths.target,
		options.overlayRoot,
		{
			resolvedSourceRoot: options.resolvedSourceRoot,
			sourceBound: true,
		},
	);
	const overlay = loadOverlay(overlayFiles).overlay;
	validateSettingPaths(overlay, paths);
	if (command === "install" && previousReceipt?.status === "installed")
		throwDistributionError(
			"E_DRIFT_CONFLICT",
			"target is already installed; use update",
			{ target: paths.target },
		);
	if (previousReceipt?.status === "installed") {
		validateReceiptPaths(previousReceipt, paths);
		assertNoDrift({
			receipt: previousReceipt,
			paths,
			settingsRoot: paths.home,
			settingDefinitions: overlay.settings,
		});
	}
	const e3Attestation = requireE3Attestation(options.e3Attestation, {
		now: now(),
	});
	const sourceRoot = options.resolvedSource.root;
	const portableCoreHashBeforeMaterialize =
		options.portableCoreHash ?? portableCoreTreeHash(sourceRoot);
	const journalId = crypto.randomUUID();
	const stageRoot = path.join(paths.stagingRoot, journalId);
	ensureDirectoryTree(stageRoot, {
		root: paths.stagingRoot,
		label: "staging root",
		mode: 0o700,
		privateMode: true,
	});
	let journal = null;
	let journalPath = null;
	let backupRoot;
	let backupManifestHash = null;
	let settings = [];
	let controlPlane = null;
	let nativeDeployment = null;
	const previousNativeDeployment = previousReceipt?.native_deployment ?? null;
	let previousNativeRetired = false;
	try {
		const materialized = await materialize({
			source: options.source,
			target: paths.target,
			overlayPath: overlayFiles.overlayPath,
			inventoryPath: overlayFiles.inventoryPath,
			overlayBase: overlayFiles.overlayBase,
			stagingRoot: stageRoot,
			ref: options.ref,
			git: options.git,
			github: options.github,
			sourceVersion: options.sourceVersion,
			hostVersion: options.hostVersion,
			allowDirtyLocal: options.allowDirtyLocal,
			resolvedSource: options.resolvedSource,
		});
		assertMaterializedSourceBinding(
			options.resolvedSource,
			materialized.sourceBinding,
		);
		const portableCoreHash = portableCoreTreeHash(sourceRoot);
		if (portableCoreHash !== portableCoreHashBeforeMaterialize) {
			throwDistributionError(
				"E_SOURCE_CONTENT_HASH",
				"portable-core bytes changed during lifecycle execution",
				{
					sourceRoot,
					before: portableCoreHashBeforeMaterialize,
					after: portableCoreHash,
				},
			);
		}
		assertSafePath(stageRoot, {
			root: paths.stagingRoot,
			label: "staging root",
			allowMissing: false,
		});
		const candidateInventory = receiptInventory(
			stageRoot,
			materialized.plan,
			paths,
			materialized.projection,
		);
		settings = prepareSettings({
			overlay,
			paths,
			target: paths.target,
			activeRoot: paths.activeRoot,
			stagingRoot: stageRoot,
		});
		const collisions = assertNoUnmanagedCollisions(
			candidateInventory,
			previousReceipt,
			paths,
			{
				allowLeafSetOverwrite: Boolean(previousReceipt),
			},
		);
		if (!previousReceipt) {
			for (const definition of overlay.settings) {
				if (definition.ownership === "whole_file") {
					const targetPath = settingTargetPath(paths, definition);
					const stagedPath = path.join(
						stageRoot,
						...definition.path.split("/"),
					);
					const targetStat = fs.lstatSync(targetPath, {
						throwIfNoEntry: false,
					});
					if (
						targetStat &&
						!targetStat.isSymbolicLink() &&
						fs.existsSync(stagedPath) &&
						hashFile(targetPath) !== hashFile(stagedPath)
					)
						throwDistributionError(
							"E_DRIFT_CONFLICT",
							`existing user settings conflict with ${definition.path}`,
							{ path: definition.path },
						);
				}
			}
		}
		journal = newJournal({
			command,
			paths,
			journalId,
			stageRoot,
			previousReceipt: active,
		});
		journalPath = writeJournal(paths, journal);
		durableBoundary(options, "journal-created", {
			journal_id: journalId,
			journal_path: journalPath,
		});
		journal = transition(paths, journal, "staged", {
			steps: [
				...journal.steps,
				{
					name: "materialize",
					status: "completed",
					timestamp: now(),
					before_ref: null,
					after_hash: materialized.contentHash,
				},
				{
					name: "stage-validated",
					status: "completed",
					timestamp: now(),
					before_ref: null,
					after_hash: materialized.contentHash,
				},
			],
		});
		durableBoundary(options, "target-staged", {
			journal_id: journalId,
			stage_root: stageRoot,
		});
		controlPlane = stageControlPlane({
			sourceRoot,
			stageRoot,
			paths,
			journalId,
			source: materialized.provenance,
		});
		journal = transition(paths, journal, "staged", {
			control_plane: controlPlane,
			steps: [
				...journal.steps,
				{
					name: "control-plane-staged",
					status: "completed",
					timestamp: now(),
					before_ref: controlPlane.stage_path,
					after_hash: controlPlane.tree_hash,
				},
			],
		});
		durableBoundary(options, "control-plane-staged", {
			journal_id: journalId,
			tree_hash: controlPlane.tree_hash,
		});
		backupRoot = path.join(paths.backupsRoot, journalId);
		const snapshotInventory = persistedInventory(
			[
				...candidateInventory,
				...(previousReceipt?.managed_inventory ?? []),
			].filter(
				(entry, index, entries) =>
					entries.findIndex(
						(candidate) =>
							candidate.root_id === entry.root_id &&
							candidate.path === entry.path,
					) === index,
			),
		);
		const backupManifest = snapshotState({
			managedRoots: paths.managedRoots,
			managedInventory: snapshotInventory,
			settings,
			backupRoot,
			activeReceiptPath: paths.activeReceiptPath,
			home: paths.home,
		});
		backupManifestHash = backupManifest.manifest_hash;
		const portableEvidence = createValidatedPortableEvidence({
			target: paths.target,
			materialized,
			attestation: e3Attestation,
			portableCoreHash,
			options,
			timestamp: now(),
		});
		journal = transition(paths, journal, "snapshotted", {
			backup_root: backupRoot,
			backup_manifest_hash: backupManifestHash,
			steps: [
				...journal.steps,
				{
					name: "snapshot",
					status: "completed",
					timestamp: now(),
					before_ref: backupRoot,
					after_hash: null,
				},
			],
		});
		durableBoundary(options, "backup-captured", {
			journal_id: journalId,
			backup_root: backupRoot,
			backup_manifest_hash: backupManifestHash,
		});
		failureInjection(options, "after-snapshot");
		journal = transition(paths, journal, "committing");
		commitManagedRoots({
			stagingRoot: stageRoot,
			candidateInventory,
			previousReceipt,
			paths,
			options,
		});
		failureInjection(options, "after-tree-swap");
		commitSettings(settings, paths, options.failurePoint);
		failureInjection(options, "after-settings");
		promoteControlPlane(controlPlane, paths);
		durableBoundary(options, "control-plane-promoted", {
			journal_id: journalId,
			destination_path: controlPlane.destination_path,
		});
		failureInjection(options, "after-control-plane");
		journal = transition(paths, journal, "committed", {
			steps: [
				...journal.steps,
				{
					name: "control-plane-promoted",
					status: "completed",
					timestamp: now(),
					before_ref: controlPlane.stage_path,
					after_hash: controlPlane.tree_hash,
				},
			],
		});
		if (codexNativeDeploymentEnabled(options, paths.target)) {
			const prepared = prepareCodexDeployment({
				paths,
				deploymentId: journalId,
				activeRoot: paths.activeRoot,
			});
			journal = transition(paths, journal, "committed", {
				native_deployment: prepared,
				previous_native_deployment: previousNativeDeployment,
				steps: [
					...journal.steps,
					{
						name: "native-deployment-prepared",
						status: "completed",
						timestamp: now(),
						before_ref: prepared.marketplace_root,
						after_hash: prepared.source_tree_hash,
					},
				],
			});
			nativeDurableBoundary(options, "native-deployment-prepared", {
				journal_id: journalId,
				marketplace_root: prepared.marketplace_root,
			});
			writeJournal(paths, journal);
			const allowedNativePluginIds = previousNativeDeployment?.plugin_id
				? [previousNativeDeployment.plugin_id]
				: [];
			nativeDeployment = installPreparedCodexDeployment({
				deployment: prepared,
				run: codexDeploymentRunner(options),
				env: codexDeploymentEnvironment(options),
				allowedPluginIds: allowedNativePluginIds,
			});
			verifyCodexDeployment({
				deployment: nativeDeployment,
				run: codexDeploymentRunner(options),
				env: codexDeploymentEnvironment(options),
				allowedPluginIds: allowedNativePluginIds,
			});
			journal = transition(paths, journal, "committed", {
				native_deployment: nativeDeployment,
				steps: [
					...journal.steps,
					{
						name: "native-deployment-installed",
						status: "completed",
						timestamp: now(),
						before_ref: prepared.marketplace_root,
						after_hash: sha256(Buffer.from(canonicalJson(nativeDeployment))),
					},
				],
			});
			nativeDurableBoundary(options, "native-deployment-installed", {
				journal_id: journalId,
				plugin_id: nativeDeployment.plugin_id,
			});
			writeJournal(paths, journal);
			if (
				previousNativeDeployment &&
				previousNativeDeployment.plugin_id !== nativeDeployment.plugin_id
			) {
				const retirementStep = {
					name: "native-previous-retired",
					status: "pending",
					timestamp: now(),
					before_ref: previousNativeDeployment.plugin_id,
					after_hash: null,
				};
				journal = transition(paths, journal, "committed", {
					steps: [...journal.steps, retirementStep],
				});
				nativeDurableBoundary(options, "native-previous-retire-intent", {
					journal_id: journalId,
					plugin_id: previousNativeDeployment.plugin_id,
				});
				detachCodexDeployment({
					deployment: previousNativeDeployment,
					run: codexDeploymentRunner(options),
					env: codexDeploymentEnvironment(options),
				});
				previousNativeRetired = true;
				journal = transition(paths, journal, "committed", {
					steps: journal.steps.map((step) =>
						step === retirementStep
							? { ...step, status: "completed", timestamp: now() }
							: step,
					),
				});
				nativeDurableBoundary(options, "native-previous-retired", {
					journal_id: journalId,
					plugin_id: previousNativeDeployment.plugin_id,
				});
				writeJournal(paths, journal);
				removeCodexMarketplace({
					deployment: previousNativeDeployment,
					run: codexDeploymentRunner(options),
					env: codexDeploymentEnvironment(options),
				});
			}
		}
		const storedInventory = persistedInventory(candidateInventory);
		const managedHash = sha256(Buffer.from(canonicalJson(storedInventory)));
		journal = transition(paths, journal, "committed", {
			steps: [
				...journal.steps,
				{
					name: "commit",
					status: "completed",
					timestamp: now(),
					before_ref: backupRoot,
					after_hash: managedHash,
				},
			],
		});
		const receiptState = {
			target: { id: paths.target },
			managed_inventory: storedInventory,
			settings: settingsReceipt(settings, backupRoot),
			provenance: receiptProvenance(materialized.provenance),
		};
		verifyReceipt(
			receiptState,
			paths,
			overlay,
			materialized.provenance.agent_projection,
		);
		const integrityHash = managedHash;
		const integrityTimestamp = now();
		failureInjection(options, "after-integrity");
		const e4Timestamp = now();
		const e4 = createEvidenceRecord({
			target: paths.target,
			capability: "E4",
			hostVersion: materialized.provenance.hostVersion,
			scenario: "installer-transaction-v1",
			result: "passed",
			provenance: evidenceBinding(
				materialized.provenance,
				options.scenarioVersion ?? DEFAULT_SCENARIO_VERSION,
			),
			timestamp: e4Timestamp,
		});
		const evidenceOptions = withKiroCliHybridHostProbe({
			options: withCursorHybridHostProbe({
				options,
				paths,
				overlay,
				provenance: materialized.provenance,
				timestamp: e4Timestamp,
			}),
			paths,
			overlay,
			provenance: materialized.provenance,
			timestamp: e4Timestamp,
		});
		const evidence = collectCandidateEvidence({
			target: paths.target,
			provenance: materialized.provenance,
			options: evidenceOptions,
			timestamp: e4Timestamp,
			records: [...portableEvidence, e4],
		});
		const compatibility = evaluateCandidateCompatibility({
			target: paths.target,
			overlay,
			records: evidence,
			provenance: materialized.provenance,
			options,
			installedAt: e4Timestamp,
		});
		const targetDefinition = getTargetDefinition(paths.target);
		if (!targetDefinition)
			throwDistributionError(
				"E_TARGET_SCHEMA",
				`unsupported target: ${paths.target}`,
				{ target: paths.target },
			);
		const candidateReceipt = validateReceipt(
			{
				schema_version: 2,
				receipt_id: journalId,
				installer_version: INSTALLER_VERSION,
				status: "installed",
				installed_at: e4Timestamp,
				target: {
					id: paths.target,
					overlay_id: targetDefinition.overlayId,
					overlay_version: materialized.provenance.overlayVersion,
					host_version: materialized.provenance.hostVersion,
				},
				source: {
					kind: materialized.provenance.sourceKind,
					requested: materialized.provenance.requestedSource,
					requested_ref: materialized.provenance.requestedRef,
					resolved_commit: materialized.provenance.resolvedCommit,
					source_version: materialized.provenance.sourceVersion,
					content_hash: materialized.provenance.sourceHash,
				},
				control_plane: receiptControlPlane(controlPlane),
				managed_roots: persistedManagedRoots(paths),
				managed_inventory: storedInventory,
				settings: receiptState.settings,
				native_deployment: nativeDeployment,
				provenance: receiptState.provenance,
				compatibility,
				evidence,
				transaction: {
					journal_id: journalId,
					backup_root: backupRoot,
					backup_manifest_hash: backupManifestHash,
					previous_receipt_id: previousReceipt?.receipt_id ?? null,
				},
			},
			{ paths },
		);
		journal = transition(paths, journal, "verified", {
			candidate_receipt: candidateReceipt,
			steps: [
				...journal.steps,
				{
					name: "integrity",
					status: "completed",
					timestamp: integrityTimestamp,
					before_ref: null,
					after_hash: integrityHash,
				},
			],
		});
		durableBoundary(options, "verification-completed", {
			journal_id: journalId,
			receipt_id: candidateReceipt.receipt_id,
		});
		failureInjection(options, "after-e4");
		const receiptPath = path.join(
			paths.receiptsRoot,
			`${candidateReceipt.receipt_id}.json`,
		);
		durableJson(receiptPath, candidateReceipt, 0o600, {
			root: paths.receiptsRoot,
		});
		journal = transition(paths, journal, "verified", {
			steps: [
				...journal.steps,
				{
					name: "candidate-receipt-written",
					status: "completed",
					timestamp: now(),
					before_ref: receiptPath,
					after_hash: sha256(Buffer.from(canonicalJson(candidateReceipt))),
				},
			],
		});
		durableBoundary(options, "candidate-receipt-written", {
			journal_id: journalId,
			receipt_path: receiptPath,
		});
		durableJson(
			paths.activeReceiptPath,
			{
				schema_version: 2,
				receipt_id: candidateReceipt.receipt_id,
				receipt_path: receiptPath,
			},
			0o600,
			{ root: paths.stateRoot },
		);
		journal = transition(paths, journal, "verified", {
			steps: [
				...journal.steps,
				{
					name: "active-pointer-transition",
					status: "completed",
					timestamp: now(),
					before_ref: active?.receiptPath ?? null,
					after_hash: sha256(Buffer.from(receiptPath)),
				},
			],
		});
		durableBoundary(options, "active-pointer-transitioned", {
			journal_id: journalId,
			receipt_path: receiptPath,
		});
		failureInjection(options, "after-receipt");
		journal = transition(paths, journal, "verified", {
			steps: [
				...journal.steps,
				{
					name: "receipt-published",
					status: "completed",
					timestamp: now(),
					before_ref: null,
					after_hash: sha256(Buffer.from(JSON.stringify(candidateReceipt))),
				},
			],
		});
		const cleanupStep = {
			name: "control-plane-pruned",
			status: "pending",
			timestamp: now(),
			before_ref: paths.controlPlanesRoot,
			after_hash: null,
		};
		journal = transition(paths, journal, "verified", {
			steps: [...journal.steps, cleanupStep],
		});
		durableBoundary(options, "cleanup-prune-started", {
			journal_id: journalId,
		});
		const pruned = pruneUnreferencedControlPlanes(paths);
		journal = transition(paths, journal, "verified", {
			steps: journal.steps.map((step) =>
				step === cleanupStep
					? {
							...step,
							status: "completed",
							timestamp: now(),
							after_hash: sha256(Buffer.from(canonicalJson(pruned))),
						}
					: step,
			),
		});
		durableBoundary(options, "cleanup-prune-completed", {
			journal_id: journalId,
			pruned,
		});
		durableBoundary(options, "terminal-journal-written", {
			journal_id: journalId,
			journal_path: journalPath,
		});
		removeEntry(stageRoot, { root: paths.stagingRoot, label: "staging root" });
		return { receipt: candidateReceipt, receiptPath, journalPath, collisions };
	} catch (error) {
		let failure = error;
		if (
			!(failure instanceof DistributionError) &&
			typeof failure?.kind !== "string"
		)
			failure = distributionError(
				"E_TRANSACTION",
				failure.message,
				{ journal_id: journalId },
				{ cause: failure },
			);
		if (!journal) {
			try {
				removeEntry(stageRoot, {
					root: paths.stagingRoot,
					label: "staging root",
				});
			} catch {
				/* preflight failure must preserve the original error */
			}
			throw failure;
		}
		if (
			journal.steps.some(
				(step) =>
					step.name === "receipt-published" && step.status === "completed",
			)
		) {
			const cleanupFailure = distributionError(
				"E_RECOVERY_FAILURE",
				"transaction committed but post-commit cleanup is incomplete",
				{
					journal_id: journalId,
					journal_path: journalPath,
					backup_root: backupRoot ?? null,
				},
				{ cause: failure, retryable: true },
			);
			journal = appendTransition(journal, "verified", {
				failure: {
					kind: cleanupFailure.kind,
					details: cleanupFailure.details,
					retryable: true,
				},
			});
			writeJournal(paths, journal);
			throw cleanupFailure;
		}
		let nativeRecoveryError = null;
		if (codexNativeDeploymentEnabled(options, paths.target)) {
			const currentNative = nativeDeployment ?? journal.native_deployment;
			const priorWasRetired =
				previousNativeRetired ||
				journal.steps.some(
					(step) =>
						step.name === "native-previous-retired" &&
						step.status === "completed",
				);
			try {
				if (currentNative) {
					removeCodexDeployment({
						deployment: currentNative,
						run: codexDeploymentRunner(options),
						env: codexDeploymentEnvironment(options),
						paths,
					});
				}
				if (priorWasRetired && previousNativeDeployment) {
					attachCodexDeployment({
						deployment: previousNativeDeployment,
						run: codexDeploymentRunner(options),
						env: codexDeploymentEnvironment(options),
					});
				}
			} catch (recoveryError) {
				nativeRecoveryError = recoveryError;
			}
		}
		let failureState = "failed";
		const backupManifestPath = backupRoot
			? path.join(backupRoot, "manifest.json")
			: null;
		let backupManifestIdentity = null;
		let backupGuardError = null;
		if (backupManifestPath) {
			try {
				backupManifestIdentity = capturePathIdentity(backupManifestPath, {
					root: backupRoot,
					label: "backup manifest",
					allowMissing: true,
					errorCode: "E_PATH_SECURITY",
				});
			} catch (guardError) {
				backupGuardError = guardError;
			}
		}
		if (backupGuardError) {
			failure = distributionError(
				"E_RECOVERY_FAILURE",
				"transaction failed and the backup manifest boundary is unsafe",
				{
					journal_id: journalId,
					backup_root: backupRoot,
				},
				{ cause: backupGuardError, retryable: true },
			);
			failureState = "rollback_failed";
		} else if (backupManifestIdentity && !backupManifestIdentity.missing) {
			try {
				assertPathIdentity(backupManifestIdentity, {
					label: "backup manifest",
					errorCode: "E_PATH_SECURITY",
				});
				restoreFullBackup(backupRoot, {
					paths,
					expectedManifestHash:
						backupManifestHash ??
						journal.candidate_receipt?.transaction?.backup_manifest_hash ??
						null,
				});
				if (journal.candidate_receipt === null) failureState = "recovered";
			} catch (restoreError) {
				failure = distributionError(
					"E_RECOVERY_FAILURE",
					"transaction failed and exact recovery failed",
					{ journal_id: journalId, backup_root: backupRoot },
					{ cause: restoreError, retryable: true },
				);
				failureState = "rollback_failed";
			}
		}
		if (nativeRecoveryError) {
			failure = distributionError(
				"E_RECOVERY_FAILURE",
				"Codex native deployment rollback could not be completed",
				{
					journal_id: journalId,
					native_deployment:
						nativeDeployment?.plugin_id ??
						journal.native_deployment?.plugin_id ??
						null,
				},
				{ cause: nativeRecoveryError, retryable: true },
			);
			failureState = "rollback_failed";
		}
		if (failureState !== "rollback_failed") {
			try {
				removeEntry(stageRoot, {
					root: paths.stagingRoot,
					label: "staging root",
				});
			} catch {
				/* journal records the transaction failure */
			}
		}
		if (
			failureState !== "rollback_failed" &&
			controlPlane &&
			fs.lstatSync(controlPlane.destination_path, { throwIfNoEntry: false })
		) {
			try {
				removeEntry(controlPlane.destination_path, {
					root: paths.controlPlanesRoot,
					label: "control-plane residue",
				});
			} catch {
				/* journal records cleanup residue */
			}
		}
		failure.details = {
			...(failure.details ?? {}),
			journal_path: journalPath,
			backup_root: backupRoot ?? null,
		};
		failedJournal(paths, journal, failureState, failure);
		throw failure;
	}
}

async function uninstall(options, paths) {
	const active = readActive(paths);
	if (!active || active.receipt.status === "uninstalled")
		return {
			receipt: active?.receipt ?? null,
			receiptPath: active?.receiptPath ?? null,
			journalPath: null,
		};
	const overlayFiles = candidateOverlay(
		options.source ?? paths.home,
		paths.target,
		options.overlayRoot,
	);
	const overlay = loadOverlay(overlayFiles).overlay;
	validateSettingPaths(overlay, paths);
	if (active.receipt.status === "installed") {
		validateReceiptPaths(active.receipt, paths);
		assertNoDrift({
			receipt: active.receipt,
			paths,
			settingsRoot: paths.home,
			settingDefinitions: overlay.settings,
		});
	}
	const journalId = crypto.randomUUID();
	const stageRoot = path.join(paths.stagingRoot, journalId);
	const backupRoot = path.join(paths.backupsRoot, journalId);
	ensureDirectoryTree(stageRoot, {
		root: paths.stagingRoot,
		label: "staging root",
		mode: 0o700,
		privateMode: true,
	});
	const activeNativeDeployment = active.receipt.native_deployment ?? null;
	let journal = newJournal({
		command: "uninstall",
		paths,
		journalId,
		stageRoot,
		previousReceipt: active,
		nativeDeployment: activeNativeDeployment,
	});
	const journalPath = writeJournal(paths, journal);
	let controlPlane = null;
	let nativeDeploymentDetached = false;
	try {
		durableBoundary(options, "journal-created", {
			journal_id: journalId,
			journal_path: journalPath,
		});
		if (active.receipt.control_plane) {
			controlPlane = stageExistingControlPlane({
				previous: active.receipt.control_plane,
				stageRoot,
				paths,
				journalId,
			});
			journal = transition(paths, journal, "prepared", {
				control_plane: controlPlane,
				steps: [
					{
						name: "control-plane-staged",
						status: "completed",
						timestamp: now(),
						before_ref: controlPlane.stage_path,
						after_hash: controlPlane.tree_hash,
					},
				],
			});
			durableBoundary(options, "control-plane-staged", {
				journal_id: journalId,
				tree_hash: controlPlane.tree_hash,
			});
		}
		const settings = overlay.settings.map((definition) => ({
			...definition,
			targetPath: settingTargetPath(paths, definition),
		}));
		const backupManifest = snapshotState({
			managedRoots: paths.managedRoots,
			managedInventory: active.receipt.managed_inventory,
			settings,
			backupRoot,
			activeReceiptPath: paths.activeReceiptPath,
			home: paths.home,
		});
		let originalReceipt = active.receipt;
		while (originalReceipt.transaction.previous_receipt_id) {
			originalReceipt = readReceiptById(
				paths,
				originalReceipt.transaction.previous_receipt_id,
			).receipt;
		}
		// The oldest backup may have been created by a previous settings-root
		// layout. Its topology is only used for parent-directory pruning, so
		// validate it against its recorded paths rather than today's resolver.
		const originalTopology = readManifest(
			originalReceipt.transaction.backup_root,
		);
		journal = transition(paths, journal, "snapshotted", {
			backup_root: backupRoot,
			backup_manifest_hash: backupManifest.manifest_hash,
			steps: [
				{
					name: "snapshot",
					status: "completed",
					timestamp: now(),
					before_ref: backupRoot,
					after_hash: null,
				},
			],
		});
		durableBoundary(options, "backup-captured", {
			journal_id: journalId,
			backup_root: backupRoot,
			backup_manifest_hash: backupManifest.manifest_hash,
		});
		journal = transition(paths, journal, "committing");
		const previous = active.receipt;
		const roots = managedRootMap(paths);
		for (const entry of [...previous.managed_inventory].sort(
			(left, right) => right.path.length - left.path.length,
		)) {
			removeManagedPath(roots.get(entry.root_id).path, entry.path, entry.type);
		}
		for (const definition of settings) {
			assertSafePath(definition.targetPath, {
				root: paths.home,
				label: "settings target",
			});
			if (definition.ownership === "managed_array_entries") {
				const receiptSetting = active.receipt.settings.find(
					({ path: settingPath }) => settingPath === definition.path,
				);
				const bytes = removeManagedArrayEntry({
					definition,
					targetPath: definition.targetPath,
					activeRoot: paths.activeRoot,
					expected: receiptSetting,
					homeRoot: paths.home,
					returnDetails: true,
				});
				if (bytes) {
					const stat = fs.lstatSync(definition.targetPath, {
						throwIfNoEntry: false,
					});
					atomicWriteSetting(
						definition.targetPath,
						bytes.bytes,
						stat ? formatMode(stat.mode) : "0600",
						{ expected: bytes.expected },
					);
				}
			} else if (definition.ownership === "managed_keys") {
				const stat = fs.lstatSync(definition.targetPath, {
					throwIfNoEntry: false,
				});
				const originalSetting = active.receipt.settings.find(
					({ path: settingPath }) => settingPath === definition.path,
				);
				const bytes = removeManagedKeys({
					definition,
					targetPath: definition.targetPath,
					returnDetails: true,
				});
				if (bytes && stat) {
					if (
						originalSetting?.before_sha256 === null &&
						definition.format === "json" &&
						isEmptyManagedJson(bytes.bytes)
					) {
						removeEntry(definition.targetPath, {
							root: paths.home,
							label: "settings target",
						});
					} else {
						atomicWriteSetting(
							definition.targetPath,
							bytes.bytes,
							formatMode(stat.mode),
							{ expected: bytes.expected },
						);
					}
				}
			} else
				removeEntry(definition.targetPath, {
					root: paths.home,
					label: "settings target",
				});
		}
		for (const root of originalTopology.roots) {
			if (root.topology.at(-1)?.exists === false)
				pruneEmptyDirectories(root.path);
		}
		for (const root of originalTopology.roots) {
			for (const topology of [...root.topology]
				.reverse()
				.filter(({ exists }) => !exists)) {
				const directory = path.join(paths.home, ...topology.path.split("/"));
				const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
				if (stat?.isDirectory() && !stat.isSymbolicLink()) {
					try {
						fs.rmdirSync(directory);
					} catch (error) {
						if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
							throw error;
					}
				}
			}
		}
		if (controlPlane) {
			promoteControlPlane(controlPlane, paths);
			durableBoundary(options, "control-plane-promoted", {
				journal_id: journalId,
				destination_path: controlPlane.destination_path,
			});
			journal = transition(paths, journal, "committed", {
				steps: [
					...journal.steps,
					{
						name: "control-plane-promoted",
						status: "completed",
						timestamp: now(),
						before_ref: controlPlane.stage_path,
						after_hash: controlPlane.tree_hash,
					},
				],
			});
		}
		const receipt = validateReceipt(
			{
				...previous,
				receipt_id: journalId,
				status: "uninstalled",
				installed_at: now(),
				control_plane: controlPlane
					? receiptControlPlane(controlPlane)
					: previous.control_plane,
				native_deployment: null,
				managed_inventory: [],
				settings: [],
				transaction: {
					journal_id: journalId,
					backup_root: backupRoot,
					backup_manifest_hash: backupManifest.manifest_hash,
					previous_receipt_id: previous.receipt_id,
				},
			},
			{ paths },
		);
		journal = transition(paths, journal, "committed", {
			candidate_receipt: receipt,
			steps: [
				...journal.steps,
				{
					name: "uninstall",
					status: "completed",
					timestamp: now(),
					before_ref: previous.receipt_id,
					after_hash: null,
				},
			],
		});
		const receiptPath = path.join(
			paths.receiptsRoot,
			`${receipt.receipt_id}.json`,
		);
		durableJson(receiptPath, receipt, 0o600, { root: paths.receiptsRoot });
		journal = transition(paths, journal, "committed", {
			steps: [
				...journal.steps,
				{
					name: "candidate-receipt-written",
					status: "completed",
					timestamp: now(),
					before_ref: receiptPath,
					after_hash: sha256(Buffer.from(canonicalJson(receipt))),
				},
			],
		});
		durableBoundary(options, "candidate-receipt-written", {
			journal_id: journalId,
			receipt_path: receiptPath,
		});
		durableJson(
			paths.activeReceiptPath,
			{
				schema_version: 2,
				receipt_id: receipt.receipt_id,
				receipt_path: receiptPath,
			},
			0o600,
			{ root: paths.stateRoot },
		);
		journal = transition(paths, journal, "committed", {
			steps: [
				...journal.steps,
				{
					name: "active-pointer-transition",
					status: "completed",
					timestamp: now(),
					before_ref: active.receiptPath,
					after_hash: sha256(Buffer.from(receiptPath)),
				},
			],
		});
		durableBoundary(options, "active-pointer-transitioned", {
			journal_id: journalId,
			receipt_path: receiptPath,
		});
		if (
			codexNativeDeploymentEnabled(options, paths.target) &&
			activeNativeDeployment
		) {
			const removalStep = {
				name: "native-deployment-removed",
				status: "pending",
				timestamp: now(),
				before_ref: activeNativeDeployment.plugin_id,
				after_hash: null,
			};
			journal = transition(paths, journal, "committed", {
				native_deployment: activeNativeDeployment,
				steps: [...journal.steps, removalStep],
			});
			nativeDurableBoundary(options, "native-deployment-removal-intent", {
				journal_id: journalId,
				plugin_id: activeNativeDeployment.plugin_id,
			});
			detachCodexDeployment({
				deployment: activeNativeDeployment,
				run: codexDeploymentRunner(options),
				env: codexDeploymentEnvironment(options),
			});
			nativeDeploymentDetached = true;
			journal = transition(paths, journal, "committed", {
				native_deployment: activeNativeDeployment,
				steps: journal.steps.map((step) =>
					step === removalStep
						? { ...step, status: "completed", timestamp: now() }
						: step,
				),
			});
			nativeDurableBoundary(options, "native-deployment-removed", {
				journal_id: journalId,
				plugin_id: activeNativeDeployment.plugin_id,
			});
			writeJournal(paths, journal);
			removeCodexMarketplace({
				deployment: activeNativeDeployment,
				run: codexDeploymentRunner(options),
				env: codexDeploymentEnvironment(options),
			});
		}
		journal = transition(paths, journal, "rolled_back", {
			steps: [
				...journal.steps,
				{
					name: "receipt-published",
					status: "completed",
					timestamp: now(),
					before_ref: null,
					after_hash: sha256(Buffer.from(JSON.stringify(receipt))),
				},
			],
		});
		if (activeNativeDeployment && nativeDeploymentDetached) {
			removeCodexDeployment({
				deployment: activeNativeDeployment,
				run: codexDeploymentRunner(options),
				env: codexDeploymentEnvironment(options),
				paths,
			});
		}
		const cleanupStep = {
			name: "control-plane-pruned",
			status: "pending",
			timestamp: now(),
			before_ref: paths.controlPlanesRoot,
			after_hash: null,
		};
		journal = transition(paths, journal, "rolled_back", {
			steps: [...journal.steps, cleanupStep],
		});
		durableBoundary(options, "cleanup-prune-started", {
			journal_id: journalId,
		});
		const pruned = pruneUnreferencedControlPlanes(paths);
		journal = transition(paths, journal, "rolled_back", {
			steps: journal.steps.map((step) =>
				step === cleanupStep
					? {
							...step,
							status: "completed",
							timestamp: now(),
							after_hash: sha256(Buffer.from(canonicalJson(pruned))),
						}
					: step,
			),
		});
		durableBoundary(options, "cleanup-prune-completed", {
			journal_id: journalId,
			pruned,
		});
		durableBoundary(options, "terminal-journal-written", {
			journal_id: journalId,
			journal_path: journalPath,
		});
		removeEntry(stageRoot, { root: paths.stagingRoot, label: "staging root" });
		return { receipt, receiptPath, journalPath };
	} catch (error) {
		let failure =
			error instanceof DistributionError || typeof error?.kind === "string"
				? error
				: distributionError(
						"E_TRANSACTION",
						error.message,
						{},
						{ cause: error },
					);
		if (
			journal.steps.some(
				(step) =>
					step.name === "receipt-published" && step.status === "completed",
			)
		) {
			failure = distributionError(
				"E_RECOVERY_FAILURE",
				"uninstall committed but post-commit cleanup is incomplete",
				{
					journal_id: journalId,
					journal_path: journalPath,
					backup_root: backupRoot,
				},
				{ cause: failure, retryable: true },
			);
			journal = appendTransition(journal, journal.state, {
				failure: {
					kind: failure.kind,
					details: failure.details,
					retryable: true,
				},
			});
			writeJournal(paths, journal);
			throw failure;
		}
		if (nativeDeploymentDetached && activeNativeDeployment) {
			try {
				attachCodexDeployment({
					deployment: activeNativeDeployment,
					run: codexDeploymentRunner(options),
					env: codexDeploymentEnvironment(options),
				});
			} catch (restoreError) {
				failure = distributionError(
					"E_RECOVERY_FAILURE",
					"uninstall rollback could not restore the Codex plugin",
					{
						journal_id: journalId,
						plugin_id: activeNativeDeployment.plugin_id,
					},
					{ cause: restoreError, retryable: true },
				);
			}
		}
		let state = "failed";
		try {
			restoreFullBackup(backupRoot, {
				paths,
				expectedManifestHash:
					journal.candidate_receipt?.transaction?.backup_manifest_hash ?? null,
			});
		} catch (restoreError) {
			state = "rollback_failed";
			failure.details = {
				...(failure.details ?? {}),
				recovery_error: restoreError.message,
			};
		}
		if (state !== "rollback_failed") {
			try {
				removeEntry(stageRoot, {
					root: paths.stagingRoot,
					label: "staging root",
				});
			} catch {
				/* preserve forensic residue if cleanup is unsafe */
			}
		}
		if (
			state !== "rollback_failed" &&
			controlPlane &&
			fs.lstatSync(controlPlane.destination_path, { throwIfNoEntry: false })
		) {
			try {
				removeEntry(controlPlane.destination_path, {
					root: paths.controlPlanesRoot,
					label: "control-plane residue",
				});
			} catch {
				/* preserve the forensic journal */
			}
		}
		failure.details = {
			...(failure.details ?? {}),
			journal_path: journalPath,
			backup_root: backupRoot,
		};
		failedJournal(paths, journal, state, failure);
		throw failure;
	}
}

async function rollback(options, paths) {
	const active = readActive(paths);
	const previousId = active?.receipt?.transaction?.previous_receipt_id;
	if (!active || !previousId)
		throwDistributionError(
			"E_TRANSACTION",
			"no previous receipt is available for rollback",
			{ target: paths.target },
		);
	const overlayFiles = candidateOverlay(
		options.source ?? paths.home,
		paths.target,
		options.overlayRoot,
	);
	const overlay = loadOverlay(overlayFiles).overlay;
	if (active.receipt.status === "installed") {
		validateReceiptPaths(active.receipt, paths);
		assertNoDrift({
			receipt: active.receipt,
			paths,
			settingsRoot: paths.home,
			settingDefinitions: overlay.settings,
		});
	}
	const previous = readReceiptById(paths, previousId);
	const journalId = crypto.randomUUID();
	const journal = newJournal({
		command: "rollback",
		paths,
		journalId,
		stageRoot: path.join(paths.stagingRoot, journalId),
		previousReceipt: active,
		backupRoot: active.receipt.transaction.backup_root,
		backupManifestHash: active.receipt.transaction.backup_manifest_hash,
		nativeDeployment: active.receipt.native_deployment ?? null,
		previousNativeDeployment: previous.receipt.native_deployment ?? null,
	});
	const journalPath = writeJournal(paths, journal);
	durableBoundary(options, "journal-created", {
		journal_id: journalId,
		journal_path: journalPath,
	});
	try {
		durableBoundary(options, "rollback-started", {
			journal_id: journalId,
			receipt_id: active.receipt.receipt_id,
		});
		restoreFullBackup(active.receipt.transaction.backup_root, {
			paths,
			expectedManifestHash: active.receipt.transaction.backup_manifest_hash,
		});
		const restored = readActive(paths);
		if (
			!restored ||
			restored.receipt.receipt_id !== previous.receipt.receipt_id ||
			restored.receiptPath !== previous.receiptPath
		)
			throwDistributionError(
				"E_RECOVERY_FAILURE",
				"rollback did not restore the exact active receipt",
				{
					expected: previous.receiptPath,
					actual: restored?.receiptPath ?? null,
				},
			);
		if (
			codexNativeDeploymentEnabled(options, paths.target) &&
			active.receipt.native_deployment
		) {
			removeCodexDeployment({
				deployment: active.receipt.native_deployment,
				run: codexDeploymentRunner(options),
				env: codexDeploymentEnvironment(options),
				paths,
			});
			if (previous.receipt.native_deployment) {
				attachCodexDeployment({
					deployment: previous.receipt.native_deployment,
					run: codexDeploymentRunner(options),
					env: codexDeploymentEnvironment(options),
				});
			}
		}
		const completed = transition(paths, journal, "rolled_back", {
			steps: [
				{
					name: "rollback",
					status: "completed",
					timestamp: now(),
					before_ref: active.receipt.receipt_id,
					after_hash: sha256(
						Buffer.from(canonicalJson(previous.receipt.managed_inventory)),
					),
				},
				{
					name: "restore-active-receipt",
					status: "completed",
					timestamp: now(),
					before_ref: previous.receiptPath,
					after_hash: null,
				},
			],
		});
		durableBoundary(options, "rollback-completed", {
			journal_id: journalId,
			receipt_id: previous.receipt.receipt_id,
		});
		durableBoundary(options, "terminal-journal-written", {
			journal_id: journalId,
			journal_path: journalPath,
		});
		return {
			receipt: previous.receipt,
			receiptPath: previous.receiptPath,
			journalPath,
			journal: completed,
		};
	} catch (error) {
		const failure =
			error?.kind === "E_RECOVERY_FAILURE"
				? error
				: distributionError(
						"E_RECOVERY_FAILURE",
						"rollback could not restore the prior transaction",
						{},
						{ cause: error, retryable: true },
					);
		failure.details = {
			...(failure.details ?? {}),
			journal_path: journalPath,
			backup_root: active.receipt.transaction.backup_root,
		};
		failedJournal(paths, journal, "rollback_failed", failure);
		throw failure;
	}
}

function journalFiles(paths) {
	assertSafePath(paths.journalsRoot, {
		root: paths.stateRoot,
		label: "journals root",
		allowMissing: false,
	});
	const rootIdentity = capturePathIdentity(paths.journalsRoot, {
		root: paths.stateRoot,
		label: "journals root",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(rootIdentity, {
		label: "journals root",
		errorCode: "E_PATH_SECURITY",
	});
	const files = fs.readdirSync(paths.journalsRoot);
	assertPathIdentity(rootIdentity, {
		label: "journals root",
		errorCode: "E_PATH_SECURITY",
	});
	return files
		.filter((file) => file.endsWith(".json"))
		.map((file) => {
			if (!/^[0-9a-f-]{36}\.json$/iu.test(file))
				throwDistributionError(
					"E_JOURNAL_SCHEMA",
					"journal filename must contain a UUID",
					{ file },
				);
			const journalPath = path.join(paths.journalsRoot, file);
			assertSafePath(journalPath, {
				root: paths.journalsRoot,
				label: "journal path",
				allowMissing: false,
			});
			const journalIdentity = capturePathIdentity(journalPath, {
				root: paths.journalsRoot,
				label: "journal path",
				allowMissing: false,
				errorCode: "E_PATH_SECURITY",
			});
			assertPathIdentity(journalIdentity, {
				label: "journal path",
				errorCode: "E_PATH_SECURITY",
			});
			const stat = fs.lstatSync(journalPath);
			if (!stat.isFile())
				throwDistributionError(
					"E_JOURNAL_IO",
					"journal must be a regular file",
					{ journalPath },
				);
			const journal = readJournal(journalPath, { paths });
			assertPathIdentity(rootIdentity, {
				label: "journals root",
				errorCode: "E_PATH_SECURITY",
			});
			assertPathIdentity(journalIdentity, {
				label: "journal path",
				errorCode: "E_PATH_SECURITY",
			});
			return { journalPath, journal };
		});
}

function selectedRecoveryJournal(paths, journalId) {
	if (journalId == null) return null;
	if (!UUID.test(journalId))
		throwDistributionError("E_USAGE", "--journal-id must be a UUID", {
			journal_id: journalId,
		});
	const journalPath = path.join(paths.journalsRoot, `${journalId}.json`);
	assertSafePath(journalPath, {
		root: paths.journalsRoot,
		label: "journal path",
		allowMissing: false,
	});
	const journalIdentity = capturePathIdentity(journalPath, {
		root: paths.journalsRoot,
		label: "journal path",
		allowMissing: false,
		errorCode: "E_PATH_SECURITY",
	});
	assertPathIdentity(journalIdentity, {
		label: "journal path",
		errorCode: "E_PATH_SECURITY",
	});
	const journal = readJournal(journalPath, { paths });
	if (journal.journal_id !== journalId || journal.target !== paths.target) {
		throwDistributionError(
			"E_JOURNAL_SCHEMA",
			"requested journal identity does not match the selected target",
			{ journal_id: journalId, target: paths.target },
		);
	}
	return { journalPath, journal };
}

export async function executeLifecycle(command, options) {
	let resolvedSource = null;
	if (command === "install" || command === "update") {
		resolvedSource = options.resolvedSource
			? await revalidateResolvedSource(options.resolvedSource, options)
			: await resolveSource(options.source, options);
		const resolvedSourceRoot = assertSourceRootBinding(resolvedSource, options);
		resolvedSource = Object.freeze({
			...resolvedSource,
			root: resolvedSourceRoot,
		});
	}
	const paths = getTargetPaths({
		target: options.target,
		home: options.home,
		env: options.env,
		kiroHome: options.kiroHome,
	});
	assertNoLegacyState(paths);
	ensureDirectories(paths);
	if (command === "status" || command === "verify") {
		const active = readActive(paths);
		if (!active) return { receipt: null, receiptPath: null, journalPath: null };
		requireControlPlane(active.receipt, { paths });
		if (active.receipt.status === "installed") {
			const overlay = loadOverlay(
				candidateOverlay(
					options.source ?? options.home,
					paths.target,
					options.overlayRoot,
				),
			).overlay;
			validateSettingPaths(overlay, paths);
			validateReceiptPaths(active.receipt, paths);
			assertNoDrift({
				receipt: active.receipt,
				paths,
				settingsRoot: paths.home,
				settingDefinitions: overlay.settings,
			});
			if (command === "verify")
				verifyReceipt(
					active.receipt,
					paths,
					overlay,
					active.receipt.provenance.agent_projection,
				);
			if (codexNativeDeploymentEnabled(options, paths.target)) {
				if (!active.receipt.native_deployment) {
					throwDistributionError(
						"E_CODEX_DEPLOYMENT",
						"receipt has no native Codex deployment; reinstall or update the target",
						{ target: paths.target },
					);
				}
				verifyCodexDeployment({
					deployment: active.receipt.native_deployment,
					run: codexDeploymentRunner(options),
					env: codexDeploymentEnvironment(options),
				});
			}
		}
		return {
			receipt: active.receipt,
			receiptPath: active.receiptPath,
			journalPath: null,
		};
	}
	if (command === "uninstall" || command === "rollback") {
		const active = readActive(paths);
		if (active) requireControlPlane(active.receipt, { paths });
	}
	const resolvedSourceRoot = resolvedSource?.root ?? null;
	const portableCoreHash = resolvedSourceRoot
		? portableCoreTreeHash(resolvedSourceRoot)
		: null;
	const lock = acquireLock(paths.lockPath);
	let preserveLock = false;
	try {
		durableBoundary(options, "lock-created", {
			target: paths.target,
			lock_path: paths.lockPath,
		});
		if (command === "install" || command === "update") {
			const result = await installOrUpdate(
				command,
				{
					...options,
					resolvedSource,
					resolvedSourceRoot,
					portableCoreHash,
				},
				paths,
			);
			// Fallback dual-write is secondary to the committed plugin path; never fail install/update.
			let dualWrite = {
				attempted: false,
				ok: true,
				copied: 0,
				destinations: [],
				backups: [],
				pruned: [],
				errors: [],
			};
			try {
				dualWrite = maybeDualWriteCursorAgents({
					target: paths.target,
					agentsFallback: options.agentsFallback,
					activeRoot: paths.activeRoot,
					home: paths.home,
				});
			} catch (error) {
				dualWrite = {
					attempted:
						options.agentsFallback === true && paths.target === "cursor",
					ok: false,
					copied: 0,
					destinations: [],
					backups: [],
					pruned: [],
					errors: [{ destination: paths.activeRoot, message: error.message }],
				};
			}
			return { ...result, dualWrite };
		}
		if (command === "uninstall") return await uninstall(options, paths);
		if (command === "rollback") return await rollback(options, paths);
		if (command === "recover") {
			const requested = selectedRecoveryJournal(paths, options.journalId);
			const unresolved = (requested ? [requested] : journalFiles(paths))
				.filter(({ journal }) => isUnresolved(journal))
				.sort((left, right) => {
					const updated =
						Date.parse(right.journal.updated_at) -
						Date.parse(left.journal.updated_at);
					return (
						updated ||
						Date.parse(right.journal.started_at) -
							Date.parse(left.journal.started_at) ||
						right.journal.journal_id.localeCompare(left.journal.journal_id)
					);
				});
			if (requested && unresolved.length === 0) {
				throwDistributionError(
					"E_RECOVERY_FAILURE",
					"requested journal is already terminal and cannot be selected for recovery",
					{ journal_id: requested.journal.journal_id },
				);
			}
			if (!requested && unresolved.length > 1) {
				throwDistributionError(
					"E_RECOVERY_AMBIGUOUS",
					"multiple unresolved journals require an exact --journal-id",
					{
						journal_ids: unresolved
							.map(({ journal }) => journal.journal_id)
							.sort(),
					},
				);
			}
			if (unresolved.length === 0) {
				const active = readActive(paths);
				return {
					receipt: active?.receipt ?? null,
					receiptPath: active?.receiptPath ?? null,
					journalPath: null,
				};
			}
			const selected = unresolved[0];
			await recoverJournal({
				journalPath: selected.journalPath,
				journal: selected.journal,
				paths,
				setJournalState: (next) => writeJournal(paths, next),
				nativeRecovery: (current) =>
					recoverCodexNativeJournal(current, options, paths),
			});
			const active = readActive(paths);
			return {
				receipt: active?.receipt ?? null,
				receiptPath: active?.receiptPath ?? null,
				journalPath: selected.journalPath,
			};
		}
		throwDistributionError(
			"E_USAGE",
			`unsupported lifecycle command: ${command}`,
			{ command },
		);
	} catch (error) {
		preserveLock = error?.kind === "E_RECOVERY_FAILURE";
		throw error;
	} finally {
		if (!preserveLock) releaseLock(lock);
	}
}

export {
	DURABLE_BOUNDARY_MARKERS,
	INSTALLER_VERSION,
	acquireLock,
	durableJson,
	readActive,
	writeJournal,
	receiptInventory,
};
