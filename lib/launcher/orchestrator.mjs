import fs from "node:fs";
import path from "node:path";

import { createArchivePort } from "./archive-port.mjs";
import { createAuthorityStore } from "./authority.mjs";
import { resolveGitHubCredential } from "./credential-provider.mjs";
import { validateExtractedRelease } from "./extracted-release.mjs";
import { delegateInstaller, childStatus } from "./process-port.mjs";
import { directReleaseAssetUrl, RESOURCE_LIMITS, resolveReleaseMetadata, verifySidecars } from "./release-contract.mjs";
import { createReleaseTransport } from "./release-transport.mjs";
import { createTempRoot } from "./temp-root.mjs";

const SIDECARS = Object.freeze([
  ["SHA256SUMS", "checksums", RESOURCE_LIMITS.checksums],
  ["SBOM.cdx.json", "sbom", RESOURCE_LIMITS.sbom],
  ["PROVENANCE.json", "provenance", RESOURCE_LIMITS.provenance],
]);

function launcherDiagnostic(options, stderr, phase, event, details) {
  if (typeof stderr?.write !== "function") return;
  if (options.json) {
    stderr.write(`${JSON.stringify({ schema_version: 1, namespace: "maister.launcher", ok: true, phase, event, details })}\n`);
    return;
  }
  const message = event === "resolved"
    ? `Resolved ${details.requested_version} -> ${details.resolved_version} (v${details.resolved_version}), target ${details.target}, asset ${details.asset}`
      : event === "retained"
        ? `maister: launcher retained ${details.root} for installer recovery; do not delete it until the transaction is terminal`
        : event === "recovery-command"
          ? `maister: recovery command: ${details.command}`
          : `maister: launcher cleanup retained ${details.root}: ${details.message}`;
  stderr.write(`${message}\n`);
}

function quoteShellArgument(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function childJournalId(childOutcome) {
  if (typeof childOutcome?.stdout !== "string") return null;
  for (const line of childOutcome.stdout.trim().split(/\r?\n/u).reverse()) {
    try {
      const parsed = JSON.parse(line);
      const journalPath = parsed?.journal_path;
      const match = typeof journalPath === "string" ? journalPath.match(/[\\/]([0-9a-f-]{36})\.json$/iu) : null;
      if (match) return match[1];
    } catch { /* child output may include non-JSON lines */ }
  }
  return null;
}

function credentialHeaders(packageMetadata, credential, accept = "application/vnd.github+json") {
  return {
    accept,
    "user-agent": `@mateuszrapacz/maister/${packageMetadata.version}`,
    ...(credential?.kind === "authenticated" ? { authorization: `Bearer ${credential.token}` } : {}),
  };
}

function createFileSink(filePath) {
  let handle = null;
  let closed = false;
  const ensureOpen = async () => {
    if (handle === null) handle = await fs.promises.open(filePath, "wx", 0o600);
    return handle;
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    if (handle !== null) {
      await handle.sync();
      await handle.close();
      handle = null;
    }
  };
  return Object.freeze({
    async write(chunk) {
      const selectedHandle = await ensureOpen();
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await selectedHandle.write(chunk, offset, chunk.length - offset);
        if (bytesWritten <= 0) throw Object.assign(new Error("release sink made no write progress"), { kind: "E_LAUNCHER_TRANSPORT_SINK" });
        offset += bytesWritten;
      }
    },
    close,
    async abort() {
      try { await close(); } catch { /* cleanup below remains authoritative */ }
    },
    async cleanup() {
      try { await close(); } finally { await fs.promises.rm(filePath, { force: true }); }
    },
  });
}

function readBoundedFile(filePath, maximumBytes, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) {
    throw Object.assign(new Error(`${label} is missing or exceeds its bound`), { kind: "E_LAUNCHER_SIDECAR" });
  }
  return fs.readFileSync(filePath);
}

async function downloadReleaseAsset({ name, asset, filePath, packageMetadata, activeCredential, request, bytes }) {
  const download = (url, credential) => request({
    url,
    headers: credentialHeaders(packageMetadata, credential, "application/octet-stream"),
    acceptedContentTypes: ["application/octet-stream"],
    sink: createFileSink(filePath),
  }, { bytes, wallMs: 30_000 });
  try {
    await download(asset.url, activeCredential);
  } catch (error) {
    const status = error?.kind === "E_LAUNCHER_TRANSPORT_HTTP" ? error.details?.status : null;
    if (asset.direct === true || !Number.isInteger(status) || status < 400 || status > 599) throw error;
    // Anonymous GitHub API asset routes can be rate-limited after metadata
    // succeeds. Retry the exact versioned browser URL without credentials;
    // sidecars and archive identity remain verified below.
    fs.rmSync(filePath, { force: true });
    await download(directReleaseAssetUrl(packageMetadata.version, name), null);
  }
}

async function runInstallOrUpdate(options, packageMetadata, ports, { transport, archivePort, tempFactory, delegate, now, signal, clockNow }) {
  const operation = tempFactory.create();
  let childOutcome = null;
  let cleanupError = null;
  const networkDeadline = clockNow() + 180_000;
  const request = async (descriptor, { wallMs, bytes }) => {
    const remaining = networkDeadline - clockNow();
    if (remaining <= 0) throw Object.assign(new Error("release acquisition exceeded its total deadline"), { kind: "E_LAUNCHER_TRANSPORT_DEADLINE" });
    return transport.request(descriptor, {
      bytes,
      wallMs: Math.min(wallMs, remaining),
      idleMs: Math.min(15_000, remaining),
      aggregateDeadlineAt: networkDeadline,
      signal,
    });
  };
  try {
    let activeCredential = null;
    const release = await resolveReleaseMetadata({
      version: packageMetadata.version,
      target: options.target,
      resolveCredential: ports.resolveCredential ?? (() => resolveGitHubCredential()),
      requestMetadata: async ({ url, credential }) => {
        try {
          const response = await request({
            url,
            headers: credentialHeaders(packageMetadata, credential),
            acceptedContentTypes: ["application/json", "application/vnd.github+json"],
          }, { bytes: RESOURCE_LIMITS.release, wallMs: 30_000 });
          if (response.status !== 200) return { status: response.status, value: null };
          let value;
          try { value = JSON.parse(response.bytes.toString("utf8")); } catch {
            throw Object.assign(new Error("GitHub release metadata is not valid JSON"), { kind: "E_LAUNCHER_RELEASE_METADATA" });
          }
          activeCredential = credential;
          return { status: response.status, value };
        } catch (error) {
          if (error?.kind === "E_LAUNCHER_TRANSPORT_HTTP" && Number.isInteger(error?.details?.status)
            && error.details.status >= 400 && error.details.status <= 599) {
            return { status: error.details.status, value: null };
          }
          throw error;
        }
      },
    });
    const downloaded = {};
    for (const [name, key, bytes] of SIDECARS) {
      const filePath = path.join(operation.root, name);
      await downloadReleaseAsset({
        name,
        asset: release.assets.get(name),
        filePath,
        packageMetadata,
        activeCredential,
        request,
        bytes,
      });
      downloaded[key] = readBoundedFile(filePath, bytes, name);
    }
    const archivePath = path.join(operation.root, release.selectedName);
    await downloadReleaseAsset({
      name: release.selectedName,
      asset: release.selected,
      filePath: archivePath,
      packageMetadata,
      activeCredential,
      request,
      bytes: RESOURCE_LIMITS.archive,
    });
    const plan = await archivePort.inspect(archivePath);
    const sidecars = verifySidecars({
      archiveSha256: plan.archiveSha256,
      assetName: release.selectedName,
      checksumsBytes: downloaded.checksums,
      sbomBytes: downloaded.sbom,
      provenanceBytes: downloaded.provenance,
      version: packageMetadata.version,
    });
    const selectedAsset = release.selected.direct
      ? Object.freeze({ ...release.selected, size: plan.counters.compressedBytes })
      : release.selected;
    const releaseTargetCommit = release.releaseTargetCommit ?? sidecars.sourceCommit;
    const extractionRoot = path.join(operation.root, "release");
    await archivePort.extract(plan, archivePath, extractionRoot);
    const verified = await validateExtractedRelease({
      root: extractionRoot,
      target: options.target,
      version: packageMetadata.version,
      packageCommit: packageMetadata.resolvedCommit,
      releaseTargetCommit,
      asset: selectedAsset,
      plan,
      sidecars,
      now,
    });
    launcherDiagnostic(options, ports.stderr, "acquire", "resolved", {
      requested_version: options.requestedVersion ?? packageMetadata.version,
      resolved_version: packageMetadata.version,
      target: options.target,
      asset: release.selectedName,
    });
    const evidencePath = path.join(extractionRoot, "plugins", "maister", ".maister-e3-attestation.json");
    const argv = [options.command, "--target", options.target, "--source", `local:${extractionRoot}`, "--ref", verified.sourceCommit, "--evidence", evidencePath];
    if (options.json) argv.push("--json");
    childOutcome = await delegate({ installerPath: verified.installerPath, argv, stdout: ports.stdout, stderr: ports.stderr });
    const status = childStatus(childOutcome);
    if ((status === 7 || childOutcome.signal) && typeof operation.retain === "function") {
      operation.retain();
      launcherDiagnostic(options, ports.stderr, "delegate", "retained", { root: operation.root });
      const journalId = childJournalId(childOutcome);
      launcherDiagnostic(options, ports.stderr, "delegate", "recovery-command", {
        command: `${process.execPath} ${quoteShellArgument(verified.installerPath)} recover --target ${quoteShellArgument(options.target)}${journalId ? ` --journal-id ${quoteShellArgument(journalId)}` : ""} --source ${quoteShellArgument(`local:${extractionRoot}`)} --ref ${quoteShellArgument(verified.sourceCommit)} --json`,
      });
    }
    if (childOutcome.signal && typeof ports.onChildSignal === "function") ports.onChildSignal(childOutcome.signal);
    return status;
  } finally {
    try { operation.cleanup(); } catch (error) { cleanupError = error; }
    if (cleanupError) {
      launcherDiagnostic(options, ports.stderr, "cleanup", "cleanup-retained", { root: operation.root, message: cleanupError.message });
      if (childOutcome === null) throw cleanupError;
    }
  }
}

export async function runLauncher(options, packageMetadata, ports = {}) {
  const transport = ports.transport ?? createReleaseTransport();
  if (!["install", "update"].includes(options.command)) {
    const authorityStore = ports.authorityStore ?? createAuthorityStore();
    const authority = authorityStore.readActiveReceipt(options.target);
    const argv = [options.command, "--target", options.target];
    if (options.journalId) argv.push("--journal-id", options.journalId);
    if (options.json) argv.push("--json");
    const childOutcome = await (ports.delegate ?? delegateInstaller)({
      installerPath: authority.installerPath,
      argv,
      stdout: ports.stdout,
      stderr: ports.stderr,
    });
    if (childOutcome.signal && typeof ports.onChildSignal === "function") ports.onChildSignal(childOutcome.signal);
    return childStatus(childOutcome);
  }
  const archivePort = ports.archivePort ?? createArchivePort();
  const tempFactory = ports.tempFactory ?? { create: createTempRoot };
  const delegate = ports.delegate ?? delegateInstaller;
  const now = ports.clock?.now?.() ?? new Date().toISOString();
  const clockNow = typeof ports.clock?.monotonicNow === "function" ? ports.clock.monotonicNow : () => Date.now();
  const signalSource = ports.signalSource ?? process;
  const acquisitionAbort = new AbortController();
  let receivedSignal = null;
  const onSignal = (signal) => {
    if (receivedSignal !== null) return;
    receivedSignal = signal;
    acquisitionAbort.abort(signal);
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  signalSource.on?.("SIGINT", onInt);
  signalSource.on?.("SIGTERM", onTerm);
  try {
    try {
      return await runInstallOrUpdate(options, packageMetadata, ports, {
        transport,
        archivePort,
        tempFactory,
        delegate,
        now,
        signal: acquisitionAbort.signal,
        clockNow,
      });
    } catch (error) {
      if (receivedSignal !== null) {
        if (typeof ports.onChildSignal === "function") ports.onChildSignal(receivedSignal);
        return childStatus({ code: null, signal: receivedSignal });
      }
      throw error;
    }
  } finally {
    signalSource.off?.("SIGINT", onInt);
    signalSource.off?.("SIGTERM", onTerm);
  }
}
