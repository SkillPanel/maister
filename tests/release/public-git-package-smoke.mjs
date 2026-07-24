import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { observeNetworkRequest } from "./network-observer.mjs";

const REPOSITORY = "mateuszrapacz/maister";
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const TARGETS = ["codex", "cursor", "kiro-cli"];
const INVOCATION_PATHS = ["npm-install", "npm-exec"];
const ALLOWED_NETWORK_HOSTS = new Set([
  "api.github.com", "github.com", "objects.githubusercontent.com",
  "registry.npmjs.org", "release-assets.githubusercontent.com",
]);
const MAX_REDIRECTS = 5;
const AMBIENT_TRANSPORT_ENVIRONMENT_NAMES = [
  "GIT_SSH_COMMAND", "GIT_SSH", "GIT_PROXY_COMMAND", "SSH_AUTH_SOCK",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
];
const CREDENTIAL_ENVIRONMENT_NAMES = [
  "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_AUTH_TOKEN", "GH_ENTERPRISE_TOKEN",
  "NODE_AUTH_TOKEN", "NPM_TOKEN", "GIT_ASKPASS", "SSH_ASKPASS",
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const tag = argument("--tag") ?? process.env.GITHUB_REF_NAME ?? null;
const commit = argument("--commit") ?? process.env.GITHUB_SHA ?? null;
const evidencePath = path.resolve(argument("--evidence") ?? ".maister-public-smoke-evidence.ndjson");
assert.match(tag ?? "", /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u);
assert.match(commit ?? "", /^[0-9a-f]{40}$/u);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-public-git-smoke-"));
const observations = path.resolve(".maister-network-observations.ndjson");
const observer = path.resolve("tests/release/network-observer.mjs");
fs.rmSync(observations, { force: true });
fs.rmSync(evidencePath, { force: true });

const cleanEnvironment = { ...process.env };
for (const name of CREDENTIAL_ENVIRONMENT_NAMES) delete cleanEnvironment[name];
for (const name of AMBIENT_TRANSPORT_ENVIRONMENT_NAMES) delete cleanEnvironment[name];
for (const name of Object.keys(cleanEnvironment)) {
  if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(name)) delete cleanEnvironment[name];
  if (/^(?:GIT_(?:SSH(?:_COMMAND|_VARIANT)?|PROXY_COMMAND|CURL_VERBOSE|TRACE(?:_CURL|_PACKET|_PERFORMANCE)?)|SSH_AUTH_SOCK|(?:HTTP|HTTPS|ALL|NO)_PROXY|npm_config_)/iu.test(name)) delete cleanEnvironment[name];
}
const emptyGitConfig = path.join(root, "empty-gitconfig");
const isolatedHome = path.join(root, "transport-home");
Object.assign(cleanEnvironment, {
  GH_CONFIG_DIR: path.join(root, "empty-gh-config"),
  GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_GLOBAL: emptyGitConfig,
  GIT_CONFIG_KEY_0: "credential.helper",
  GIT_CONFIG_VALUE_0: "",
  GIT_CONFIG_KEY_1: "url.https://github.com/.insteadOf",
  GIT_CONFIG_VALUE_1: "ssh://git@github.com/",
  GIT_CONFIG_KEY_2: "url.https://github.com/.insteadOf",
  GIT_CONFIG_VALUE_2: "git@github.com:",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: isolatedHome,
  MAISTER_NETWORK_OBSERVATIONS: observations,
  NODE_OPTIONS: `--import=${pathToFileURL(observer).href}`,
  USERPROFILE: isolatedHome,
  npm_config_cache: path.join(root, "npm-cache"),
  npm_config_userconfig: path.join(root, "empty-npmrc"),
});
fs.mkdirSync(cleanEnvironment.GH_CONFIG_DIR, { recursive: true });
fs.mkdirSync(isolatedHome, { recursive: true });
fs.writeFileSync(emptyGitConfig, "", { mode: 0o600 });
fs.writeFileSync(cleanEnvironment.npm_config_userconfig, "", { mode: 0o600 });

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(executable, args, environment, label, { machineReadable = true } = {}) {
  const result = spawnSync(executable, args, {
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    timeout: 240_000,
  });
  assert.equal(result.error, undefined, `${label}: child process could not start`);
  assert.equal(result.status, 0, `${label}: child process failed (status=${result.status ?? "unknown"}, signal=${result.signal ?? "none"})`);
  if (!machineReadable) return Object.freeze({ exit_code: result.status });
  const jsonLines = result.stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  assert.ok(jsonLines.length > 0, `${label}: expected a machine-readable lifecycle result`);
  const terminal = jsonLines.at(-1);
  assert.equal(terminal?.ok, true, `${label}: lifecycle result must be successful`);
  return Object.freeze({
    command: terminal.command,
    exit_code: result.status,
    ok: terminal.ok,
    receipt_path: terminal.receipt_path ?? null,
  });
}

const observedNpmVersion = spawnSync(npmExecutable(), ["--version"], {
  env: cleanEnvironment,
  encoding: "utf8",
  windowsHide: true,
  shell: process.platform === "win32",
});
assert.equal(observedNpmVersion.error, undefined, "npm client version probe could not start");
assert.equal(observedNpmVersion.status, 0, "npm client version probe failed");
const npmVersion = observedNpmVersion.stdout.trim();
assert.match(npmVersion, /^\d+\.\d+\.\d+$/u);
if (process.env.RELEASE_NPM_VERSION) assert.equal(npmVersion, process.env.RELEASE_NPM_VERSION);

function npmInvocation(packageSpec, command, target) {
  return ["exec", "--yes", `--package=${packageSpec}`, "--", "maister", command, "--target", target, "--json"];
}

function assertAllowedNetworkUrl(value) {
  const url = new URL(value);
  assert.ok(ALLOWED_NETWORK_HOSTS.has(url.hostname), `network host is outside the public smoke allowlist: ${url.hostname}`);
  assert.equal(url.username, "", "network URL must not contain a username");
  assert.equal(url.password, "", "network URL must not contain a password");
  if (url.hostname === "api.github.com") {
    assert.match(url.pathname, /^\/repos\/mateuszrapacz\/maister\//u, "GitHub API path is outside the repository allowlist");
  }
  return url;
}

async function anonymousRequest(url, accept) {
  let current = assertAllowedNetworkUrl(url);
  const headers = { accept, "user-agent": "maister-public-git-smoke" };
  for (let redirectCount = 0; ; redirectCount += 1) {
    observeNetworkRequest(current, { headers }, observations);
    const response = await fetch(current, { headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      assert.ok(redirectCount < MAX_REDIRECTS, "public smoke exceeded the redirect limit");
      const location = response.headers.get("location");
      assert.ok(location, "public smoke received a redirect without a location");
      current = assertAllowedNetworkUrl(new URL(location, current));
      continue;
    }
    assert.equal(response.status, 200, `anonymous GitHub request failed for ${current.pathname}`);
    return response;
  }
}

async function anonymousJson(url) {
  return (await anonymousRequest(url, "application/vnd.github+json")).json();
}

async function resolveTagCommit(releaseTag) {
  let object = (await anonymousJson(`${API_ROOT}/git/ref/tags/${releaseTag}`)).object;
  for (let depth = 0; object?.type === "tag" && depth < 8; depth += 1) {
    object = (await anonymousJson(`${API_ROOT}/git/tags/${object.sha}`)).object;
  }
  assert.equal(object?.type, "commit", "release tag must peel to one commit");
  assert.match(object.sha, /^[0-9a-f]{40}$/u);
  return object.sha;
}

function exactAssetMap(release) {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const name of [
    "maister-codex.tar.gz", "maister-cursor.tar.gz", "maister-kiro-cli.tar.gz",
    "SHA256SUMS", "SBOM.cdx.json", "PROVENANCE.json",
  ]) assert.ok(assets.has(name), `GitHub Release is missing ${name}`);
  return assets;
}

async function assetBytes(asset) {
  assert.match(asset.url, new RegExp(`^https://api\\.github\\.com/repos/${REPOSITORY}/releases/assets/[1-9]\\d*$`, "u"));
  return Buffer.from(await (await anonymousRequest(asset.url, "application/octet-stream")).arrayBuffer());
}

function checksumMap(bytes) {
  const checksums = new Map();
  for (const line of bytes.toString("utf8").split(/\r?\n/u).filter(Boolean)) {
    const match = /^([0-9a-f]{64})\s+(?:\*|)([^\s]+)$/u.exec(line);
    assert.ok(match, "SHA256SUMS contains a malformed line");
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

function packageIdentity(prefix) {
  const packageRoot = path.join(prefix, "node_modules", "@mateuszrapacz", "maister");
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, ".maister-resolved-commit.json"), "utf8"));
  assert.equal(metadata.name, "@mateuszrapacz/maister");
  assert.equal(manifest.package_version, metadata.version);
  assert.equal(manifest.resolved_commit, commit);
  return Object.freeze({ binary: path.join(packageRoot, "bin", "maister.mjs"), metadata, manifest });
}

function recordEvidence(record) {
  fs.appendFileSync(evidencePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

const release = await anonymousJson(`${API_ROOT}/releases/tags/${tag}`);
assert.equal(release.tag_name, tag);
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
const releaseTargetCommit = await resolveTagCommit(tag);
assert.equal(releaseTargetCommit, commit);
const assets = exactAssetMap(release);
const checksums = checksumMap(await assetBytes(assets.get("SHA256SUMS")));
const provenance = JSON.parse((await assetBytes(assets.get("PROVENANCE.json"))).toString("utf8"));
assert.equal(provenance.source.commit, commit);

const selectors = [
  { kind: "tag", packageSpec: `github:${REPOSITORY}#${tag}`, selectorCommit: releaseTargetCommit },
  { kind: "commit", packageSpec: `github:${REPOSITORY}#${commit}`, selectorCommit: commit },
];

try {
  for (const selector of selectors) {
    const prefix = path.join(root, `${selector.kind}-package`);
    run(npmExecutable(), ["install", "--no-save", "--prefix", prefix, selector.packageSpec], cleanEnvironment, `materialize ${selector.kind}`, { machineReadable: false });
    const identity = packageIdentity(prefix);
    assert.equal(identity.manifest.resolved_commit, selector.selectorCommit);

    for (const invocationPath of INVOCATION_PATHS) {
      for (const target of TARGETS) {
        const environment = {
          ...cleanEnvironment,
          HOME: path.join(root, `${selector.kind}-${invocationPath}-${target}-home`),
          XDG_STATE_HOME: path.join(root, `${selector.kind}-${invocationPath}-${target}-state`),
        };
        fs.mkdirSync(environment.HOME, { recursive: true });
        fs.mkdirSync(environment.XDG_STATE_HOME, { recursive: true });
        const invoke = (command) => invocationPath === "npm-install"
          ? run(process.execPath, [identity.binary, command, "--target", target, "--json"], environment, `${selector.kind} ${invocationPath} ${target} ${command}`)
          : run(npmExecutable(), npmInvocation(selector.packageSpec, command, target), environment, `${selector.kind} ${invocationPath} ${target} ${command}`);
        const rawLifecycle = {
          install: invoke("install"),
          status: invoke("status"),
          verify: invoke("verify"),
          uninstall: invoke("uninstall"),
        };
        assert.equal(typeof rawLifecycle.install.receipt_path, "string", "install must emit a receipt path");
        const receipt = JSON.parse(fs.readFileSync(rawLifecycle.install.receipt_path, "utf8"));
        assert.equal(receipt.source.resolved_commit, commit);
        assert.match(receipt.source.content_hash ?? "", /^[0-9a-f]{64}$/u);
        const receiptE3 = receipt.evidence.find((record) => record.capability === "E3");
        assert.equal(receiptE3?.result, "passed");
        const lifecycle = Object.fromEntries(Object.entries(rawLifecycle).map(([command, result]) => [command, {
          command: result.command,
          exit_code: result.exit_code,
          ok: result.ok,
        }]));
        const assetName = `maister-${target}.tar.gz`;
        const asset = assets.get(assetName);
        const archiveDigest = checksums.get(assetName);
        assert.match(archiveDigest ?? "", /^[0-9a-f]{64}$/u);
        assert.equal(asset.digest === null || asset.digest === undefined || asset.digest === `sha256:${archiveDigest}`, true);
        const e3Digest = provenance.portable_core_attestation?.digest;
        assert.match(e3Digest ?? "", /^[0-9a-f]{64}$/u);
        assert.equal(receiptE3.provenance.attestation_digest, e3Digest);
        recordEvidence({
          schema_version: 1,
          kind: "maister/public-git-package-smoke",
          observed_at: new Date().toISOString(),
          platform: process.platform,
          architecture: process.arch,
          npm_version: npmVersion,
          package_spec: selector.packageSpec,
          invocation_path: invocationPath,
          selector_kind: selector.kind,
          selector_commit: selector.selectorCommit,
          package_manifest_commit: identity.manifest.resolved_commit,
          package_version: identity.metadata.version,
          release_tag: tag,
          release_target_commit: releaseTargetCommit,
          asset_identity: { id: asset.id, name: asset.name },
          asset_digest: archiveDigest,
          sidecar_source: {
            commit: provenance.source.commit,
            checksums: { id: assets.get("SHA256SUMS").id, name: "SHA256SUMS" },
            provenance: { id: assets.get("PROVENANCE.json").id, name: "PROVENANCE.json" },
          },
          archive_identity: {
            release_asset_id: asset.id,
            name: asset.name,
            sha256: archiveDigest,
            source_manifest_commit: receipt.source.resolved_commit,
            source_manifest_content_hash: receipt.source.content_hash,
          },
          e3_digest: e3Digest,
          target,
          lifecycle,
          terminal_lifecycle: "uninstalled",
          network_policy: {
            authorization: false,
            package_source: "github-only",
            npm_registry_access: "runtime-dependencies-read-only",
            repository: REPOSITORY,
          },
        });
      }
    }
  }

  const records = fs.readFileSync(observations, "utf8").trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  assert.ok(records.length > 0, "launcher network observations are required");
  assert.equal(records.every((record) => [
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "registry.npmjs.org",
    "release-assets.githubusercontent.com",
  ].includes(record.host)), true);
  assert.equal(records.every((record) => record.authorization === false), true);
  const evidence = fs.readFileSync(evidencePath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  assert.equal(evidence.length, selectors.length * INVOCATION_PATHS.length * TARGETS.length);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
