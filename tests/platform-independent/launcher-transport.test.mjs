import assert from "node:assert/strict";
import test from "node:test";

import { createReleaseTransport } from "../../lib/launcher/release-transport.mjs";

const METADATA_URL = "https://api.github.com/repos/mateuszrapacz/maister/releases/tags/v2.2.1";
const TAG_REF_URL = "https://api.github.com/repos/mateuszrapacz/maister/git/ref/tags/v2.2.1";
const TAG_OBJECT_URL = "https://api.github.com/repos/mateuszrapacz/maister/git/tags/1111111111111111111111111111111111111111";
const ASSET_URL = "https://api.github.com/repos/mateuszrapacz/maister/releases/assets/42";
const DIRECT_ASSET_URL = "https://github.com/mateuszrapacz/maister/releases/download/v2.2.1/maister-codex.tar.gz";

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

function requestLimits(overrides = {}) {
  return {
    bytes: 1024,
    wallMs: 30_000,
    idleMs: 15_000,
    ...overrides,
  };
}

function discardSink() {
  return {
    async write() {},
    async close() {},
    async abort() {},
    async cleanup() {},
  };
}

function fakeTime(initial = 0) {
  let now = initial;
  let nextId = 1;
  const timers = new Map();
  const scheduled = [];
  const sleeps = [];
  const clock = {
    now: () => now,
    advance: (milliseconds) => { now += milliseconds; },
  };
  const scheduler = {
    setTimeout(callback, milliseconds) {
      const handle = nextId;
      nextId += 1;
      timers.set(handle, { callback, milliseconds });
      scheduled.push(milliseconds);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    async sleep(milliseconds) {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    fireNext() {
      const next = timers.entries().next().value;
      assert.ok(next, "an active timer must exist");
      const [handle, timer] = next;
      timers.delete(handle);
      now += timer.milliseconds;
      timer.callback();
    },
    scheduled,
    sleeps,
  };
  return { clock, scheduler };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("authorizes exact GitHub API routes and fixed direct release asset routes", async () => {
  const observations = [];
  const transport = createReleaseTransport({
    fetchImpl: async (url, options) => {
      observations.push({ url: String(url), headers: new Headers(options.headers) });
      return response("ok", { headers: { "content-type": "application/octet-stream", "content-length": "2" } });
    },
  });

  await transport.request({
    url: ASSET_URL,
    headers: { authorization: "Bearer sentinel" },
    acceptedContentTypes: ["application/octet-stream"],
    sink: discardSink(),
  }, requestLimits({ bytes: 2 }));

  assert.equal(observations[0].headers.get("authorization"), "Bearer sentinel");
  assert.equal(observations[0].headers.get("accept"), "application/octet-stream");
  assert.equal(observations[0].headers.get("x-github-api-version"), "2022-11-28");

  await transport.request({
    url: DIRECT_ASSET_URL,
    acceptedContentTypes: ["application/octet-stream"],
    sink: discardSink(),
  }, requestLimits({ bytes: 2 }));
  assert.equal(observations[1].url, DIRECT_ASSET_URL);
  assert.equal(observations[1].headers.get("accept"), "application/octet-stream");

  for (const url of [
    "http://api.github.com/repos/mateuszrapacz/maister/releases/assets/42",
    "https://api.github.com/repos/other/maister/releases/assets/42",
    "https://api.github.com/repos/mateuszrapacz/maister/releases/assets/not-a-number",
    "https://github.com/mateuszrapacz/maister/releases/download/v2.2.1/not-allowlisted.bin",
    "https://github.com/mateuszrapacz/maister/releases/download/v2.2.1/maister-codex.tar.gz?token=secret",
  ]) {
    await assert.rejects(() => transport.request({
      url,
      headers: { authorization: "Bearer sentinel" },
      acceptedContentTypes: ["application/octet-stream"],
    }, requestLimits()), { kind: /E_LAUNCHER_TRANSPORT_(?:URL|HOST|ROUTE)/u });
  }
  assert.equal(observations.length, 2);
});

test("authorizes only the exact stable tag ref and full annotated-tag object routes", async () => {
  const observed = [];
  const transport = createReleaseTransport({
    fetchImpl: async (url) => {
      observed.push(String(url));
      return response("{}", { headers: { "content-type": "application/json", "content-length": "2" } });
    },
  });

  for (const url of [TAG_REF_URL, TAG_OBJECT_URL]) {
    await transport.request({ url, acceptedContentTypes: ["application/json"] }, requestLimits({ bytes: 2 }));
  }
  assert.deepEqual(observed, [TAG_REF_URL, TAG_OBJECT_URL]);

  for (const url of [
    "https://api.github.com/repos/mateuszrapacz/maister/git/ref/tags/latest",
    "https://api.github.com/repos/mateuszrapacz/maister/git/refs/tags/v2.2.1",
    "https://api.github.com/repos/mateuszrapacz/maister/git/tags/not-a-full-sha",
    `${TAG_OBJECT_URL}?token=secret`,
  ]) {
    await assert.rejects(
      () => transport.request({ url, acceptedContentTypes: ["application/json"] }, requestLimits()),
      { kind: "E_LAUNCHER_TRANSPORT_ROUTE" },
    );
  }
  assert.equal(observed.length, 2);
});

test("uses manual 302 redirects, revalidates hosts, and strips authorization permanently cross-host", async () => {
  const observations = [];
  const transport = createReleaseTransport({
    fetchImpl: async (url, options) => {
      observations.push({ url: String(url), headers: new Headers(options.headers), redirect: options.redirect });
      if (observations.length === 1) {
        return response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/signed/file?token=secret" } });
      }
      if (observations.length === 2) {
        return response(null, { status: 302, headers: { location: ASSET_URL } });
      }
      return response("ok", { headers: { "content-type": "application/octet-stream" } });
    },
  });

  const result = await transport.request({
    url: ASSET_URL,
    headers: { authorization: "Bearer sentinel" },
    acceptedContentTypes: ["application/octet-stream"],
    sink: discardSink(),
  }, requestLimits());

  assert.deepEqual(observations.map(({ redirect }) => redirect), ["manual", "manual", "manual"]);
  assert.equal(observations[0].headers.get("authorization"), "Bearer sentinel");
  assert.equal(observations[1].headers.get("authorization"), null);
  assert.equal(observations[2].headers.get("authorization"), null);
  assert.equal(result.finalUrl, ASSET_URL);

  const hostile = createReleaseTransport({
    fetchImpl: async () => response(null, { status: 302, headers: { location: "https://evil.example/file?signature=sentinel" } }),
  });
  await assert.rejects(() => hostile.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink: discardSink() }, requestLimits()), (error) => {
    assert.equal(error.kind, "E_LAUNCHER_TRANSPORT_HOST");
    assert.doesNotMatch(JSON.stringify(error), /sentinel|signature=/u);
    return true;
  });
});

test("does not restore authorization when a cross-host delivery retries from the API URL", async () => {
  const observedAuthorization = [];
  let calls = 0;
  const transport = createReleaseTransport({
    sleep: async () => {},
    fetchImpl: async (_url, options) => {
      calls += 1;
      observedAuthorization.push(new Headers(options.headers).get("authorization"));
      if (calls === 1) return response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/file" } });
      if (calls === 2) return response(null, { status: 503 });
      return response("ok", { headers: { "content-type": "application/octet-stream" } });
    },
  });

  await transport.request({
    url: ASSET_URL,
    headers: { authorization: "Bearer sentinel" },
    acceptedContentTypes: ["application/octet-stream"],
    sink: discardSink(),
  }, requestLimits());
  assert.deepEqual(observedAuthorization, ["Bearer sentinel", null, null]);
});

test("allows no more than five redirects and accepts only direct 200 or 302 statuses", async () => {
  let calls = 0;
  const transport = createReleaseTransport({
    fetchImpl: async () => {
      calls += 1;
      return response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/file-${calls}` } });
    },
  });
  await assert.rejects(() => transport.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink: discardSink() }, requestLimits()), { kind: "E_LAUNCHER_TRANSPORT_REDIRECT" });
  assert.equal(calls, 6);

  for (const status of [201, 301, 303, 307, 308, 404]) {
    const direct = createReleaseTransport({ fetchImpl: async () => response(null, { status }) });
    await assert.rejects(() => direct.request({ url: METADATA_URL, acceptedContentTypes: ["application/json"] }, requestLimits()), { kind: "E_LAUNCHER_TRANSPORT_HTTP" });
  }
});

test("starts a fresh 15-second pre-header deadline immediately before every redirect and retry fetch", async () => {
  const { clock, scheduler } = fakeTime();
  const fetchStarts = [];
  let calls = 0;
  const transport = createReleaseTransport({
    clock,
    scheduler,
    retryDelayMs: 500,
    fetchImpl: async () => {
      fetchStarts.push(clock.now());
      calls += 1;
      clock.advance(1_000);
      if (calls === 1) return response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/file" } });
      if (calls === 2) return response(null, { status: 503 });
      return response("ok", { headers: { "content-type": "application/octet-stream" } });
    },
  });

  await transport.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink: discardSink() }, requestLimits({ aggregateDeadlineAt: 180_000 }));

  assert.deepEqual(fetchStarts, [0, 1_000, 2_500]);
  assert.deepEqual(scheduler.sleeps, [500]);
  assert.deepEqual(scheduler.scheduled.slice(0, 3), [15_000, 15_000, 15_000]);
});

test("caps every attempt and body idle deadline by non-resetting resource and aggregate walls", async () => {
  const { clock, scheduler } = fakeTime(10_000);
  const transport = createReleaseTransport({
    clock,
    scheduler,
    fetchImpl: async () => {
      clock.advance(4_000);
      return response("ok", { headers: { "content-type": "application/json" } });
    },
  });

  await transport.request({ url: METADATA_URL, acceptedContentTypes: ["application/json"] }, requestLimits({ wallMs: 8_000, aggregateDeadlineAt: 16_000 }));
  assert.deepEqual(scheduler.scheduled, [6_000, 2_000, 2_000]);
});

test("types pre-header and body-idle expiry separately and does not retry body-idle failure", async () => {
  {
    const { clock, scheduler } = fakeTime();
    let calls = 0;
    const transport = createReleaseTransport({
      clock,
      scheduler,
      fetchImpl: async (_url, { signal }) => {
        calls += 1;
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
    });
    const pending = transport.request({ url: METADATA_URL, acceptedContentTypes: ["application/json"] }, requestLimits({ wallMs: 15_000 }));
    scheduler.fireNext();
    await assert.rejects(pending, { kind: "E_LAUNCHER_PREHEADER_TIMEOUT" });
    assert.equal(calls, 1, "an exhausted resource wall prevents retry");
  }

  {
    const { clock, scheduler } = fakeTime();
    let calls = 0;
    let finishRead;
    const body = {
      getReader() {
        return {
          read() { return new Promise((resolve) => { finishRead = resolve; }); },
          async cancel() { finishRead({ done: true }); },
          releaseLock() {},
        };
      },
    };
    const transport = createReleaseTransport({
      clock,
      scheduler,
      fetchImpl: async () => {
        calls += 1;
        return { status: 200, headers: new Headers({ "content-type": "application/octet-stream" }), body };
      },
    });
    const pending = transport.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink: discardSink() }, requestLimits());
    await settle();
    scheduler.fireNext();
    await assert.rejects(pending, { kind: "E_LAUNCHER_BODY_IDLE_TIMEOUT" });
    assert.equal(calls, 1);
  }
});

test("retries only eligible pre-semantic transport failures and 408, 429, or 5xx", async () => {
  for (const first of [408, 429, 500, 599]) {
    let calls = 0;
    const transport = createReleaseTransport({
      sleep: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? response(null, { status: first })
          : response("{}", { headers: { "content-type": "application/json" } });
      },
    });
    await transport.request({ url: METADATA_URL, acceptedContentTypes: ["application/json"] }, requestLimits());
    assert.equal(calls, 2);
  }

  for (const first of [400, 401, 403, 404]) {
    let calls = 0;
    const transport = createReleaseTransport({
      fetchImpl: async () => { calls += 1; return response(null, { status: first }); },
    });
    await assert.rejects(() => transport.request({ url: METADATA_URL, acceptedContentTypes: ["application/json"] }, requestLimits()), { kind: "E_LAUNCHER_TRANSPORT_HTTP" });
    assert.equal(calls, 1);
  }
});

test("streams with backpressure through the sink and cleans partial output on failure", async () => {
  const events = [];
  const chunks = [Buffer.from("ab"), Buffer.from("cd")];
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const sink = {
    async write(chunk) { events.push(`write:${Buffer.from(chunk).toString()}`); },
    async close() { events.push("close"); },
    async abort() { events.push("abort"); },
    async cleanup() { events.push("cleanup"); },
  };
  const transport = createReleaseTransport({ fetchImpl: async () => response(body, { headers: { "content-type": "application/octet-stream", "content-length": "4" } }) });
  const result = await transport.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink }, requestLimits({ bytes: 4 }));
  assert.deepEqual(events, ["write:ab", "write:cd", "close"]);
  assert.equal(result.bytes, undefined);
  assert.equal(result.observedBytes, 4);

  const partialEvents = [];
  const failingSink = {
    async write() { throw Object.assign(new Error("disk full"), { kind: "E_TEST_SINK" }); },
    async abort() { partialEvents.push("abort"); },
    async close() { partialEvents.push("close"); },
    async cleanup() { partialEvents.push("cleanup"); },
  };
  const failingTransport = createReleaseTransport({
    fetchImpl: async () => response("x", { headers: { "content-type": "application/octet-stream" } }),
  });
  await assert.rejects(() => failingTransport.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink: failingSink }, requestLimits()), { kind: "E_TEST_SINK" });
  assert.deepEqual(partialEvents, ["abort", "close", "cleanup"]);
});

test("does not retry a semantic sink TypeError after response headers", async () => {
  let calls = 0;
  const transport = createReleaseTransport({
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return response("x", { headers: { "content-type": "application/octet-stream" } });
    },
  });
  await assert.rejects(() => transport.request({
    url: ASSET_URL,
    acceptedContentTypes: ["application/octet-stream"],
    sink: {
      async write() { throw new TypeError("semantic sink failure"); },
      async close() {},
      async abort() {},
      async cleanup() {},
    },
  }, requestLimits()), TypeError);
  assert.equal(calls, 1);
});

test("enforces declared and observed byte bounds and rejects truncation", async () => {
  for (const [body, contentLength, expectedKind] of [
    ["ok", "3", "E_LAUNCHER_TRANSPORT_TRUNCATED"],
    ["large", "5", "E_LAUNCHER_TRANSPORT_LIMIT"],
    ["large", null, "E_LAUNCHER_TRANSPORT_LIMIT"],
  ]) {
    const transport = createReleaseTransport({
      fetchImpl: async () => response(body, { headers: { "content-type": "application/octet-stream", ...(contentLength === null ? {} : { "content-length": contentLength }) } }),
    });
    await assert.rejects(() => transport.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink: discardSink() }, requestLimits({ bytes: 4 })), { kind: expectedKind });
  }
});

test("requires an explicit sink for every API asset body", async () => {
  let calls = 0;
  const transport = createReleaseTransport({ fetchImpl: async () => { calls += 1; return response("x"); } });
  await assert.rejects(() => transport.request({
    url: ASSET_URL,
    acceptedContentTypes: ["application/octet-stream"],
  }, requestLimits()), { kind: "E_LAUNCHER_TRANSPORT_SINK" });
  assert.equal(calls, 0);
});

test("external abort is terminal, redacted, and never retried", async () => {
  const controller = new AbortController();
  let calls = 0;
  const transport = createReleaseTransport({
    sleep: async () => { throw new Error("must not retry"); },
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  });
  const pending = transport.request({ url: METADATA_URL, acceptedContentTypes: ["application/json"] }, requestLimits({ signal: controller.signal }));
  controller.abort("signed-token=sentinel");
  await assert.rejects(pending, (error) => {
    assert.equal(error.kind, "E_LAUNCHER_TRANSPORT_ABORTED");
    assert.doesNotMatch(JSON.stringify(error), /sentinel|signed-token/u);
    return true;
  });
  assert.equal(calls, 1);
});

test("external abort cancels active body consumption and cleans the partial sink", async () => {
  const controller = new AbortController();
  const events = [];
  let finishRead;
  const body = {
    getReader() {
      return {
        read() { return new Promise((resolve) => { finishRead = resolve; }); },
        async cancel() { events.push("cancel"); finishRead({ done: true }); },
        releaseLock() {},
      };
    },
  };
  const sink = {
    async write() {},
    async abort() { events.push("abort"); },
    async close() { events.push("close"); },
    async cleanup() { events.push("cleanup"); },
  };
  const transport = createReleaseTransport({
    fetchImpl: async () => ({ status: 200, headers: new Headers({ "content-type": "application/octet-stream" }), body }),
  });
  const pending = transport.request({ url: ASSET_URL, acceptedContentTypes: ["application/octet-stream"], sink }, requestLimits({ signal: controller.signal }));
  await settle();
  controller.abort("sentinel-secret");
  await assert.rejects(pending, { kind: "E_LAUNCHER_TRANSPORT_ABORTED" });
  assert.deepEqual(events, ["cancel", "abort", "close", "cleanup"]);
});
