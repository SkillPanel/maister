import { setTimeout as delay } from "node:timers/promises";

import { API_HOST, DIRECT_RELEASE_HOST, REDIRECT_HOSTS } from "./release-contract.mjs";

const API_VERSION = "2022-11-28";
const MAX_ATTEMPTS = 2;
const MAX_REDIRECTS = 5;
const PREHEADER_MS = 15_000;
const MAX_BACKOFF_MS = 5_000;
const METADATA_ROUTE = /^\/repos\/mateuszrapacz\/maister\/releases\/tags\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const TAG_REF_ROUTE = /^\/repos\/mateuszrapacz\/maister\/git\/ref\/tags\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const TAG_OBJECT_ROUTE = /^\/repos\/mateuszrapacz\/maister\/git\/tags\/[0-9a-f]{40}$/u;
const ASSET_ROUTE = /^\/repos\/mateuszrapacz\/maister\/releases\/assets\/[1-9]\d*$/u;
const DIRECT_ASSET_ROUTE = /^\/mateuszrapacz\/maister\/releases\/download\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\/(?:maister-(?:codex|cursor|kiro-cli|pi)\.tar\.gz|SHA256SUMS|SBOM\.cdx\.json|PROVENANCE\.json)$/u;
const ALLOWED_HOSTS = new Set([API_HOST, ...REDIRECT_HOSTS]);

function transportError(kind, message, details = {}) {
  const error = new Error(message);
  error.kind = kind;
  error.details = details;
  return error;
}

function redactUrl(parsed) {
  return `${parsed.origin}${parsed.pathname}${parsed.search ? "?<redacted>" : ""}`;
}

function parseHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw transportError("E_LAUNCHER_TRANSPORT_URL", "release transport URL is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.port !== "" || parsed.hash !== "") {
    throw transportError("E_LAUNCHER_TRANSPORT_URL", "release transport requires a plain HTTPS URL");
  }
  return parsed;
}

function routeType(parsed) {
  if (parsed.hostname === API_HOST) {
    if (parsed.search !== "") return null;
    if (METADATA_ROUTE.test(parsed.pathname) || TAG_REF_ROUTE.test(parsed.pathname) || TAG_OBJECT_ROUTE.test(parsed.pathname)) return "metadata";
    if (ASSET_ROUTE.test(parsed.pathname)) return "asset";
    return null;
  }
  if (parsed.hostname === DIRECT_RELEASE_HOST && parsed.search === "" && DIRECT_ASSET_ROUTE.test(parsed.pathname)) return "direct-asset";
  return null;
}

function validateInitialUrl(value) {
  const parsed = parseHttpsUrl(value);
  if (parsed.hostname !== API_HOST && parsed.hostname !== DIRECT_RELEASE_HOST) {
    throw transportError("E_LAUNCHER_TRANSPORT_HOST", "release transport host is not allowlisted", { host: parsed.hostname });
  }
  const type = routeType(parsed);
  if (type === null) {
    throw transportError("E_LAUNCHER_TRANSPORT_ROUTE", "release transport API route is not authorized");
  }
  return { parsed, type };
}

function validateRedirectUrl(value, base) {
  let resolved;
  try {
    resolved = new URL(value, base);
  } catch {
    throw transportError("E_LAUNCHER_TRANSPORT_URL", "release redirect URL is invalid");
  }
  const parsed = parseHttpsUrl(resolved);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw transportError("E_LAUNCHER_TRANSPORT_HOST", "release redirect destination is not allowlisted", { host: parsed.hostname });
  }
  if (parsed.hostname === API_HOST && routeType(parsed) === null) {
    throw transportError("E_LAUNCHER_TRANSPORT_ROUTE", "release redirect API route is not authorized");
  }
  return parsed;
}

function normalizedHeaders(headers) {
  const result = {};
  for (const [name, value] of new Headers(headers).entries()) result[name] = value;
  return result;
}

function removeAuthorization(headers) {
  delete headers.authorization;
  return headers;
}

function defaultScheduler(sleep) {
  return {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    sleep,
  };
}

function positiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw transportError("E_LAUNCHER_TRANSPORT_LIMIT", `${label} must be a positive finite number`);
  }
  return value;
}

function validateSink(sink, required) {
  if (sink === undefined && !required) return;
  if (
    sink === null
    || typeof sink !== "object"
    || ["write", "close", "abort", "cleanup"].some((method) => typeof sink[method] !== "function")
  ) {
    throw transportError("E_LAUNCHER_TRANSPORT_SINK", required
      ? "API asset transport requires an explicit streaming file sink"
      : "release transport sink seam is incomplete");
  }
}

function earliestDeadline(now, phaseMs, resourceDeadline, aggregateDeadline, phaseKind) {
  const candidates = [
    { at: now + phaseMs, kind: phaseKind },
    { at: resourceDeadline, kind: "E_LAUNCHER_RESOURCE_TIMEOUT" },
    { at: aggregateDeadline, kind: "E_LAUNCHER_AGGREGATE_TIMEOUT" },
  ];
  return candidates.reduce((earliest, candidate) => candidate.at < earliest.at ? candidate : earliest);
}

function timeoutMessage(kind) {
  if (kind === "E_LAUNCHER_PREHEADER_TIMEOUT") return "release request exceeded its pre-header deadline";
  if (kind === "E_LAUNCHER_BODY_IDLE_TIMEOUT") return "release response body exceeded its idle deadline";
  if (kind === "E_LAUNCHER_AGGREGATE_TIMEOUT") return "release acquisition exceeded its aggregate deadline";
  return "release resource exceeded its wall deadline";
}

async function timedOperation({ operation, controller, deadline, clock, scheduler, awaitOnTimeout = true }) {
  const remaining = deadline.at - clock.now();
  if (remaining <= 0) throw transportError(deadline.kind, timeoutMessage(deadline.kind));
  let timedOut = false;
  let rejectTimeout;
  const timeoutPromise = new Promise((_resolve, reject) => { rejectTimeout = reject; });
  const timeoutHandle = scheduler.setTimeout(() => {
    timedOut = true;
    const error = transportError(deadline.kind, timeoutMessage(deadline.kind));
    controller.abort(error);
    rejectTimeout(error);
  }, remaining);
  let operationPromise;
  try {
    operationPromise = Promise.resolve(operation());
  } catch (error) {
    operationPromise = Promise.reject(error);
  }
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      if (awaitOnTimeout) await operationPromise.catch(() => {});
      else operationPromise.catch(() => {});
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    scheduler.clearTimeout(timeoutHandle);
  }
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch { /* preserve the primary transport result */ }
}

function declaredLength(response, maximum) {
  const value = response.headers.get("content-length");
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw transportError("E_LAUNCHER_TRANSPORT_LIMIT", "response Content-Length is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw transportError("E_LAUNCHER_TRANSPORT_LIMIT", "response exceeds its declared byte limit");
  }
  return parsed;
}

function memorySink() {
  const chunks = [];
  return {
    async write(chunk) { chunks.push(Buffer.from(chunk)); },
    async close() {},
    async abort() { chunks.length = 0; },
    async cleanup() { chunks.length = 0; },
    result(total) { return Buffer.concat(chunks, total); },
  };
}

async function closeFailedSink(sink, error) {
  try { await sink.abort?.(error); } catch { /* preserve primary error */ }
  try { await sink.close?.(); } catch { /* preserve primary error */ }
  try { await sink.cleanup?.(); } catch { /* preserve primary error */ }
}

async function consumeBody({ response, maximum, idleMs, resourceDeadline, aggregateDeadline, controller, externalSignal, sink, clock, scheduler }) {
  const selectedSink = sink ?? memorySink();
  const reader = response.body?.getReader?.();
  let externalCancellation = null;
  const abortFromCaller = () => {
    const error = transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
    controller.abort(error);
    externalCancellation = Promise.resolve(reader?.cancel(error)).catch(() => {});
  };
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  let observed = 0;
  let completed = false;
  try {
    const expected = declaredLength(response, maximum);
    if (reader !== undefined) {
      while (true) {
        const deadline = earliestDeadline(clock.now(), idleMs, resourceDeadline, aggregateDeadline, "E_LAUNCHER_BODY_IDLE_TIMEOUT");
        const item = await timedOperation({
          controller,
          deadline,
          clock,
          scheduler,
          awaitOnTimeout: false,
          operation: async () => {
            const next = await reader.read();
            if (next.done) return next;
            const nextObserved = observed + next.value.byteLength;
            if (nextObserved > maximum) {
              throw transportError("E_LAUNCHER_TRANSPORT_LIMIT", "streamed response exceeds its observed byte limit");
            }
            await selectedSink.write(next.value);
            return { ...next, observed: nextObserved };
          },
        });
        if (externalSignal?.aborted) throw transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
        if (item.done) break;
        observed = item.observed;
      }
    }
    if (expected !== null && observed !== expected) {
      throw transportError("E_LAUNCHER_TRANSPORT_TRUNCATED", "response body does not match its declared length", { declaredBytes: expected, observedBytes: observed });
    }
    await selectedSink.close?.();
    completed = true;
    return {
      observedBytes: observed,
      ...(sink === undefined ? { bytes: selectedSink.result(observed) } : {}),
    };
  } catch (error) {
    controller.abort(error);
    if (externalCancellation !== null) await externalCancellation;
    else try { await reader?.cancel(error); } catch { /* preserve primary error */ }
    await closeFailedSink(selectedSink, error);
    if (externalSignal?.aborted) throw transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
    throw error;
  } finally {
    externalSignal?.removeEventListener("abort", abortFromCaller);
    try { reader?.releaseLock(); } catch { /* stream cleanup is best-effort after the primary result */ }
    if (!completed && !controller.signal.aborted) controller.abort();
  }
}

function isRetryableFailure(error) {
  return error?.kind === "E_LAUNCHER_TRANSPORT_RETRYABLE"
    || error?.kind === "E_LAUNCHER_PREHEADER_TIMEOUT";
}

function validateResponseHeaders(response, acceptedContentTypes) {
  const contentEncoding = (response.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (contentEncoding !== "identity") {
    throw transportError("E_LAUNCHER_TRANSPORT_ENCODING", "release response content encoding is not accepted", { contentEncoding });
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!acceptedContentTypes.includes(contentType)) {
    throw transportError("E_LAUNCHER_TRANSPORT_CONTENT_TYPE", "release response content type is not accepted", { contentType });
  }
}

export function createReleaseTransport({
  fetchImpl = globalThis.fetch,
  clock = { now: () => Date.now() },
  scheduler,
  sleep = delay,
  retryDelayMs = 250,
} = {}) {
  if (typeof fetchImpl !== "function" || typeof clock?.now !== "function") {
    throw new TypeError("release transport requires fetch and clock seams");
  }
  const selectedScheduler = scheduler ?? defaultScheduler(sleep);
  if (typeof selectedScheduler.setTimeout !== "function" || typeof selectedScheduler.clearTimeout !== "function" || typeof selectedScheduler.sleep !== "function") {
    throw new TypeError("release transport scheduler seam is incomplete");
  }

  return Object.freeze({
    async request({ url, headers = {}, acceptedContentTypes, sink }, limits = {}) {
      const initial = validateInitialUrl(url);
      if (!Array.isArray(acceptedContentTypes) || acceptedContentTypes.length === 0) {
        throw transportError("E_LAUNCHER_TRANSPORT_CONTENT_TYPE", "accepted response content types are required");
      }
      const maximum = positiveNumber(limits.bytes, "response byte limit");
      const wallMs = positiveNumber(limits.wallMs, "resource wall deadline");
      const idleMs = positiveNumber(limits.idleMs ?? PREHEADER_MS, "body idle deadline");
      validateSink(sink, initial.type === "asset" || initial.type === "direct-asset");
      let sinkDisposed = false;
      const trackedSink = sink === undefined ? undefined : {
        write: (chunk) => sink.write(chunk),
        async close() {
          await sink.close();
          sinkDisposed = true;
        },
        abort: (error) => sink.abort(error),
        async cleanup() {
          try { await sink.cleanup(); } finally { sinkDisposed = true; }
        },
      };
      const disposeSink = async (error) => {
        if (trackedSink !== undefined && !sinkDisposed) await closeFailedSink(trackedSink, error);
      };
      const start = clock.now();
      const resourceDeadline = start + wallMs;
      const aggregateDeadline = limits.aggregateDeadlineAt === undefined ? Number.POSITIVE_INFINITY : limits.aggregateDeadlineAt;
      if (typeof aggregateDeadline !== "number" || Number.isNaN(aggregateDeadline)) {
        throw transportError("E_LAUNCHER_TRANSPORT_LIMIT", "aggregate deadline is invalid");
      }

      const baseHeaders = normalizedHeaders(headers);
      baseHeaders["x-github-api-version"] = API_VERSION;
      if (initial.type === "asset" || initial.type === "direct-asset") baseHeaders.accept = "application/octet-stream";
      let lastError;
      let authorizationPermanentlyStripped = false;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let current = initial.parsed;
        let currentHeaders = { ...baseHeaders };
        try {
          for (let redirects = 0; ; redirects += 1) {
            if (limits.signal?.aborted) throw transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
            if (authorizationPermanentlyStripped || routeType(current) === null) removeAuthorization(currentHeaders);
            const controller = new AbortController();
            const abortFromCaller = () => controller.abort(transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted"));
            limits.signal?.addEventListener("abort", abortFromCaller, { once: true });
            let response;
            try {
              const deadline = earliestDeadline(clock.now(), PREHEADER_MS, resourceDeadline, aggregateDeadline, "E_LAUNCHER_PREHEADER_TIMEOUT");
              response = await timedOperation({
                controller,
                deadline,
                clock,
                scheduler: selectedScheduler,
                operation: () => fetchImpl(current, { headers: currentHeaders, redirect: "manual", signal: controller.signal }),
              });
            } catch (error) {
              if (limits.signal?.aborted || error?.kind === "E_LAUNCHER_TRANSPORT_ABORTED") {
                throw transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
              }
              if (error?.kind === undefined && ["TypeError", "AbortError"].includes(error?.name)) {
                throw transportError("E_LAUNCHER_TRANSPORT_RETRYABLE", "release transport failed before response headers");
              }
              throw error;
            } finally {
              limits.signal?.removeEventListener("abort", abortFromCaller);
            }

            if (response.status === 302) {
              if (redirects >= MAX_REDIRECTS) {
                await cancelBody(response);
                throw transportError("E_LAUNCHER_TRANSPORT_REDIRECT", "release transport exceeded five redirects");
              }
              const location = response.headers.get("location");
              if (location === null) {
                await cancelBody(response);
                throw transportError("E_LAUNCHER_TRANSPORT_REDIRECT", "release redirect is missing a location");
              }
              let next;
              try {
                next = validateRedirectUrl(location, current);
              } finally {
                await cancelBody(response);
              }
              if (next.hostname !== current.hostname) {
                authorizationPermanentlyStripped = true;
                removeAuthorization(currentHeaders);
              }
              current = next;
              continue;
            }

            if (response.status === 408 || response.status === 429 || (response.status >= 500 && response.status <= 599)) {
              await cancelBody(response);
              throw transportError("E_LAUNCHER_TRANSPORT_RETRYABLE", `release request returned HTTP ${response.status}`, { status: response.status });
            }
            if (response.status !== 200) {
              await cancelBody(response);
              throw transportError("E_LAUNCHER_TRANSPORT_HTTP", `release request returned HTTP ${response.status}`, { status: response.status });
            }
            try {
              validateResponseHeaders(response, acceptedContentTypes);
            } catch (error) {
              controller.abort(error);
              await cancelBody(response);
              await disposeSink(error);
              throw error;
            }
            const bodyResult = await consumeBody({
              response,
              maximum,
              idleMs,
              resourceDeadline,
              aggregateDeadline,
              controller,
              externalSignal: limits.signal,
              sink: trackedSink,
              clock,
              scheduler: selectedScheduler,
            });
            return Object.freeze({
              status: response.status,
              headers: response.headers,
              finalUrl: redactUrl(current),
              ...bodyResult,
            });
          }
        } catch (error) {
          if (limits.signal?.aborted || error?.kind === "E_LAUNCHER_TRANSPORT_ABORTED") {
            await disposeSink(error);
            throw transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
          }
          lastError = error;
          if (attempt === MAX_ATTEMPTS || !isRetryableFailure(error)) {
            await disposeSink(error);
            throw error;
          }
          const remaining = Math.min(resourceDeadline, aggregateDeadline) - clock.now();
          const backoff = Math.min(MAX_BACKOFF_MS, Math.max(0, retryDelayMs));
          if (backoff >= remaining) {
            await disposeSink(error);
            throw error;
          }
          try {
            await selectedScheduler.sleep(backoff, { signal: limits.signal });
          } catch (sleepError) {
            if (limits.signal?.aborted) {
              await disposeSink(sleepError);
              throw transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
            }
            await disposeSink(sleepError);
            throw sleepError;
          }
          if (limits.signal?.aborted) {
            await disposeSink(transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted"));
            throw transportError("E_LAUNCHER_TRANSPORT_ABORTED", "release acquisition was interrupted");
          }
        }
      }
      throw lastError;
    },
  });
}
