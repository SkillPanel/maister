import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ASSET_BY_TARGET,
  REQUIRED_ASSETS,
  directReleaseAssetUrl,
  releaseMetadataUrl,
  resolveReleaseMetadata,
  validateReleaseMetadata,
  verifySidecars,
} from "../../lib/launcher/release-contract.mjs";
import { createReleaseTransport } from "../../lib/launcher/release-transport.mjs";

const METADATA_URL = "https://api.github.com/repos/mateuszrapacz/maister/releases/tags/v2.2.1";
const ASSET_URL = "https://api.github.com/repos/mateuszrapacz/maister/releases/assets/1";
const TAG_REFERENCE_URL = "https://api.github.com/repos/mateuszrapacz/maister/git/ref/tags/v2.2.1";
const RELEASE_COMMIT = "b".repeat(40);

function tagReference(commit = RELEASE_COMMIT) {
  return { ref: "refs/tags/v2.2.1", object: { type: "commit", sha: commit } };
}

function collectingSink() {
  const chunks = [];
  return {
    async write(chunk) { chunks.push(Buffer.from(chunk)); },
    async close() {},
    async abort() { chunks.length = 0; },
    async cleanup() { chunks.length = 0; },
    bytes() { return Buffer.concat(chunks); },
  };
}

function release(overrides = {}) {
  return {
    tag_name: "v2.2.1", draft: false, prerelease: false, published_at: "2026-07-19T00:00:00Z",
    assets: REQUIRED_ASSETS.map((name, index) => ({
      id: index + 1,
      name,
      state: "uploaded",
      size: 1,
      url: `https://api.github.com/repos/mateuszrapacz/maister/releases/assets/${index + 1}`,
      browser_download_url: `https://github.com/mateuszrapacz/maister/releases/download/v2.2.1/${name}`,
    })),
    ...overrides,
  };
}

test("exact release metadata selects only the closed target asset map", () => {
  for (const [target, selectedName] of Object.entries(ASSET_BY_TARGET)) {
    assert.equal(validateReleaseMetadata(release(), { version: "2.2.1", target }).selectedName, selectedName);
  }
  for (const value of [release({ tag_name: "v2.2.2" }), release({ draft: true }), release({ prerelease: true }), release({ published_at: null })]) {
    assert.throws(() => validateReleaseMetadata(value, { version: "2.2.1", target: "codex" }));
  }
  assert.throws(() => validateReleaseMetadata(release({ assets: [...release().assets, release().assets[0]] }), { version: "2.2.1", target: "codex" }), { kind: "E_LAUNCHER_RELEASE_ASSETS" });
});

test("required assets have positive numeric API IDs and exact fixed-repository API URLs", () => {
  const metadata = release();
  const selected = validateReleaseMetadata(metadata, { version: "2.2.1", target: "codex" }).selected;
  assert.equal(selected.id, 1);
  assert.equal(selected.url, "https://api.github.com/repos/mateuszrapacz/maister/releases/assets/1");

  for (const asset of [
    { ...metadata.assets[0], id: "1" },
    { ...metadata.assets[0], id: 0 },
    { ...metadata.assets[0], url: metadata.assets[0].browser_download_url },
    { ...metadata.assets[0], url: "https://api.github.com/repos/other/repository/releases/assets/1" },
    { ...metadata.assets[0], url: "https://api.github.com/repos/mateuszrapacz/maister/releases/assets/2" },
    { ...metadata.assets[0], url: "https://api.github.com/repos/mateuszrapacz/maister/releases/assets/1?token=secret" },
  ]) {
    assert.throws(() => validateReleaseMetadata(release({ assets: [asset, ...metadata.assets.slice(1)] }), {
      version: "2.2.1",
      target: "codex",
    }), { kind: "E_LAUNCHER_RELEASE_ASSETS" });
  }

  const browserOnlyAsset = { ...metadata.assets[0] };
  delete browserOnlyAsset.url;
  assert.throws(() => validateReleaseMetadata(release({
    assets: [browserOnlyAsset, ...metadata.assets.slice(1)],
  }), { version: "2.2.1", target: "codex" }), { kind: "E_LAUNCHER_RELEASE_ASSETS" });
  assert.equal(Object.hasOwn(selected, "browser_download_url"), false);
});

test("metadata route is the exact stable package-version tag with no moving fallback", () => {
  assert.equal(
    releaseMetadataUrl("2.2.1"),
    "https://api.github.com/repos/mateuszrapacz/maister/releases/tags/v2.2.1",
  );
  for (const version of ["latest", "2.2", "v2.2.1", "2.2.1-beta.1"]) {
    assert.throws(() => releaseMetadataUrl(version), { kind: "E_LAUNCHER_RELEASE_IDENTITY" });
  }
});

test("anonymous metadata success bypasses credential resolution entirely", async () => {
  const requests = [];
  let credentialCalls = 0;
  const result = await resolveReleaseMetadata({
    version: "2.2.1",
    target: "codex",
    async requestMetadata(request) {
      requests.push(request);
      return { status: 200, value: request.url === METADATA_URL ? release() : tagReference() };
    },
    async resolveCredential() {
      credentialCalls += 1;
      throw new Error("credential resolver must be bypassed");
    },
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ url }) => url), [METADATA_URL, TAG_REFERENCE_URL]);
  assert.ok(requests.every(({ credential, attempt }) => credential === null && attempt === "anonymous"));
  assert.equal(credentialCalls, 0);
  assert.equal(result.accessMode, "anonymous");
  assert.equal(result.releaseTargetCommit, RELEASE_COMMIT);
});

test("anonymous GitHub API rate limiting falls back to exact direct release assets", async () => {
  const result = await resolveReleaseMetadata({
    version: "2.2.1",
    target: "codex",
    async requestMetadata() {
      return { status: 403, value: null };
    },
    async resolveCredential() {
      return { kind: "anonymous", source: "none" };
    },
  });

  assert.equal(result.accessMode, "anonymous-direct");
  assert.equal(result.releaseTargetCommit, null);
  assert.equal(result.selected.id, null);
  assert.equal(result.selected.direct, true);
  assert.equal(result.selected.url, directReleaseAssetUrl("2.2.1", "maister-codex.tar.gz"));
  assert.equal(result.sidecars.provenance.url, directReleaseAssetUrl("2.2.1", "PROVENANCE.json"));
});

test("exact annotated release tag is independently peeled to one full commit", async () => {
  const tagObject = "a".repeat(40);
  const releaseCommit = "b".repeat(40);
  const requests = [];
  const result = await resolveReleaseMetadata({
    version: "2.2.1",
    target: "codex",
    async requestMetadata(request) {
      requests.push(request);
      if (request.url === METADATA_URL) return { status: 200, value: release() };
      if (request.url.endsWith("/git/ref/tags/v2.2.1")) {
        return { status: 200, value: { ref: "refs/tags/v2.2.1", object: { type: "tag", sha: tagObject } } };
      }
      if (request.url.endsWith(`/git/tags/${tagObject}`)) {
        return { status: 200, value: { object: { type: "commit", sha: releaseCommit } } };
      }
      throw new Error(`unexpected metadata URL: ${request.url}`);
    },
    async resolveCredential() {
      throw new Error("credential resolver must be bypassed");
    },
  });

  assert.equal(result.releaseTargetCommit, releaseCommit);
  assert.deepEqual(requests.map(({ url }) => url), [
    METADATA_URL,
    "https://api.github.com/repos/mateuszrapacz/maister/git/ref/tags/v2.2.1",
    `https://api.github.com/repos/mateuszrapacz/maister/git/tags/${tagObject}`,
  ]);
  assert.ok(requests.every(({ credential, attempt }) => credential === null && attempt === "anonymous"));
});

test("only anonymous 401, 403, or privacy-preserving 404 permits one authenticated retry", async () => {
  for (const deniedStatus of [401, 403, 404]) {
    const requests = [];
    const result = await resolveReleaseMetadata({
      version: "2.2.1",
      target: "cursor",
      async requestMetadata(request) {
        requests.push(request);
        if (requests.length === 1) return { status: deniedStatus, value: null };
        return { status: 200, value: request.url === METADATA_URL ? release() : tagReference() };
      },
      async resolveCredential() {
        return { kind: "authenticated", source: "GH_TOKEN", token: "private-token" };
      },
    });

    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map(({ url }) => url), [METADATA_URL, METADATA_URL, TAG_REFERENCE_URL]);
    assert.equal(requests[0].credential, null);
    for (const request of requests.slice(1)) {
      assert.deepEqual(request.credential, {
        kind: "authenticated",
        source: "GH_TOKEN",
        token: "private-token",
      });
      assert.equal(request.attempt, "authenticated");
    }
    assert.equal(result.accessMode, "authenticated");
  }
});

test("tag resolution failures redact credentials and reject malformed or mismatched identities", async () => {
  const secret = "never-print-this-token";
  let thrown;
  try {
    await resolveReleaseMetadata({
      version: "2.2.1",
      target: "codex",
      async requestMetadata(request) {
        if (request.credential === null) return { status: 404, value: null };
        return { status: 200, value: request.url === METADATA_URL
          ? release()
          : { ref: "refs/tags/v2.2.2", object: { type: "commit", sha: "not-a-commit" } } };
      },
      async resolveCredential() {
        return { kind: "authenticated", source: "GH_TOKEN", token: secret };
      },
    });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown?.kind, "E_LAUNCHER_RELEASE_IDENTITY");
  assert.doesNotMatch(JSON.stringify({ message: thrown.message, details: thrown.details }), new RegExp(secret, "u"));
});

test("ineligible denial and anonymous credential fallback never retry metadata", async () => {
  for (const deniedStatus of [400, 408, 429, 500]) {
    let requests = 0;
    let credentialCalls = 0;
    await assert.rejects(resolveReleaseMetadata({
      version: "2.2.1",
      target: "codex",
      async requestMetadata() {
        requests += 1;
        return { status: deniedStatus, value: null };
      },
      async resolveCredential() {
        credentialCalls += 1;
        return { kind: "authenticated", source: "GH_TOKEN", token: "private-token" };
      },
    }), { kind: "E_LAUNCHER_RELEASE_ACCESS" });
    assert.equal(requests, 1);
    assert.equal(credentialCalls, 0);
  }

  let anonymousRequests = 0;
  await assert.rejects(resolveReleaseMetadata({
    version: "2.2.1",
    target: "codex",
    async requestMetadata() {
      anonymousRequests += 1;
      return { status: 404, value: null };
    },
    async resolveCredential() {
      return { kind: "anonymous", source: "none", commandStatus: "unavailable" };
    },
  }), { kind: "E_LAUNCHER_RELEASE_ACCESS" });
  assert.equal(anonymousRequests, 1);
});

test("combined anonymous-first acquisition selects and streams the numeric API asset URL", async () => {
  const observations = [];
  const transport = createReleaseTransport({
    fetchImpl: async (url, options) => {
      observations.push({ url: String(url), headers: new Headers(options.headers) });
      if (String(url) === METADATA_URL) {
        return new Response(Buffer.from(JSON.stringify(release())), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(Buffer.from("archive"), {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": "7" },
      });
    },
  });
  let credentialCalls = 0;
  const resolved = await resolveReleaseMetadata({
    version: "2.2.1",
    target: "codex",
    async requestMetadata({ url, credential }) {
      assert.equal(credential, null);
      if (url === TAG_REFERENCE_URL) return { status: 200, value: tagReference() };
      const response = await transport.request({
        url,
        acceptedContentTypes: ["application/json"],
      }, { bytes: 1_048_576, wallMs: 30_000 });
      return { status: response.status, value: JSON.parse(response.bytes.toString("utf8")) };
    },
    async resolveCredential() {
      credentialCalls += 1;
      throw new Error("anonymous success must bypass credentials");
    },
  });
  const sink = collectingSink();
  const assetResponse = await transport.request({
    url: resolved.selected.url,
    acceptedContentTypes: ["application/octet-stream"],
    sink,
  }, { bytes: 256 * 1_024 * 1_024, wallMs: 120_000 });

  assert.equal(credentialCalls, 0);
  assert.deepEqual(observations.map(({ url }) => url), [METADATA_URL, ASSET_URL]);
  assert.equal(observations[0].headers.has("authorization"), false);
  assert.equal(observations[1].headers.has("authorization"), false);
  assert.equal(observations[1].headers.get("accept"), "application/octet-stream");
  assert.equal(assetResponse.observedBytes, 7);
  assert.equal(sink.bytes().toString("utf8"), "archive");
});

test("selected archive digest and source identity must agree across all sidecars", () => {
  const bytes = Buffer.from("archive");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const names = Object.values(ASSET_BY_TARGET);
  const checksumsBytes = Buffer.from(names.map((name) => `${name === names[0] ? digest : "0".repeat(64)}  ${name}`).join("\n") + "\n");
  const attestation = { digest: "a".repeat(64), sha256: "b".repeat(64) };
  const sbomBytes = Buffer.from(JSON.stringify({ metadata: { component: { version: "2.2.1" } }, components: names.map((name) => ({ name, version: "2.2.1", hashes: [{ alg: "SHA-256", content: name === names[0] ? digest : "0".repeat(64) }] })) }));
  const provenanceBytes = Buffer.from(JSON.stringify({
    source: { version: "2.2.1", commit: "c".repeat(40) },
    build: { artifacts: names.map((name) => ({ name, sha256: name === names[0] ? digest : "0".repeat(64), attestation })) },
    portable_core_attestation: attestation,
  }));
  assert.equal(verifySidecars({ archiveBytes: bytes, assetName: names[0], checksumsBytes, sbomBytes, provenanceBytes, version: "2.2.1" }).archiveSha256, digest);
  assert.throws(() => verifySidecars({ archiveBytes: Buffer.from("other"), assetName: names[0], checksumsBytes, sbomBytes, provenanceBytes, version: "2.2.1" }), { kind: "E_LAUNCHER_DIGEST_MISMATCH" });
});

test("transport strips authorization across allowlisted redirects and rejects hostile destinations", async () => {
  const observations = [];
  const fetchImpl = async (url, options) => {
    observations.push({ url: String(url), headers: { ...options.headers } });
    if (observations.length === 1) return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/file" } });
    return new Response(Buffer.from("ok"), { status: 200, headers: { "content-type": "application/octet-stream", "content-length": "2" } });
  };
  const transport = createReleaseTransport({ fetchImpl, sleep: async () => {} });
  const sink = collectingSink();
  const result = await transport.request({ url: ASSET_URL, headers: { authorization: "secret" }, acceptedContentTypes: ["application/octet-stream"], sink }, { bytes: 2, wallMs: 1000 });
  assert.equal(result.observedBytes, 2);
  assert.equal(sink.bytes().toString(), "ok");
  assert.equal(observations[0].headers.authorization, "secret");
  assert.equal(observations[1].headers.authorization, undefined);
  await assert.rejects(() => transport.request({ url: "https://evil.example/file", acceptedContentTypes: ["application/octet-stream"] }, { bytes: 2, wallMs: 1000 }), { kind: "E_LAUNCHER_TRANSPORT_HOST" });
});

test("transport enforces streamed byte limits", async () => {
  const transport = createReleaseTransport({ fetchImpl: async () => new Response(Buffer.from("too large"), { status: 200, headers: { "content-type": "application/octet-stream" } }) });
  await assert.rejects(() => transport.request({ url: METADATA_URL, acceptedContentTypes: ["application/octet-stream"] }, { bytes: 2, wallMs: 1000 }), { kind: "E_LAUNCHER_TRANSPORT_LIMIT" });
});

test("transport propagates an external acquisition abort without retrying", async () => {
  const controller = new AbortController();
  let calls = 0;
  const transport = createReleaseTransport({
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
    },
    sleep: async () => { throw new Error("must not retry"); },
  });
  const request = transport.request({ url: METADATA_URL, acceptedContentTypes: ["application/octet-stream"] }, { bytes: 2, wallMs: 1000, signal: controller.signal });
  controller.abort("operator interrupt");
  await assert.rejects(request, { kind: "E_LAUNCHER_TRANSPORT_ABORTED" });
  assert.equal(calls, 1);
});
