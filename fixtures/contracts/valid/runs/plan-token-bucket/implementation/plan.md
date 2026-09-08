# Implementation Plan - Token bucket rate limiter for the request pipeline

## TL;DR
1. Adds a dependency-free token bucket rate limiter to `api-service` as a pure core (`src/rate-limit/token-bucket.js`), a keyed store (`bucket-store.js`), and a framework-agnostic middleware adapter (`middleware.js`).
2. Because this repo has no request pipeline at all (only `src/index.js` exporting a no-op, no `package.json`), the plan also proposes the minimal pipeline shape the limiter attaches to: a `(ctx, next)` async middleware chain plus a thin `node:http` host.
3. Algorithm: lazy-refill token bucket, `capacity` burst + `refillPerSec` sustained rate, per-key buckets keyed by a pluggable `keyFn`, monotonic clock injected for testability.
4. Exceeding the limit returns HTTP 429 with `Retry-After` and `RateLimit-*` headers; the limiter never throws and fails open only by explicit config.
5. **No project standards were found** - there is no `.maister/docs/INDEX.md` and no docs index was supplied; running the project's initialization command would establish them.

## Key Decisions
- **In-process `Map` store, no Redis** - the repo has zero dependencies and no deployment topology defined; a shared store is a documented extension point (`BucketStore` interface), not day-one scope.
- **Lazy refill on read, no timers** - O(1) per request, no background interval to leak or to keep the event loop alive; the alternative (a refill timer) is rejected as unnecessary cost per bucket.
- **Monotonic clock (`performance.now()` / `process.hrtime.bigint()`) injected as `now()`** - wall clock (`Date.now()`) is subject to NTP steps and adjustable jumps, which can grant infinite tokens or freeze a bucket.
- **Framework-agnostic core** - `TokenBucket` knows nothing about HTTP; the HTTP semantics (429, headers, key extraction) live only in the middleware adapter, so the core is unit-testable without a server.
- **Fractional tokens** - allows sub-1/s rates (e.g. 0.5 req/s) without special casing; comparisons use `tokens >= cost` with a small epsilon guard.
- **`node:test` + `node:assert` as the test runner** - keeps the zero-dependency posture; no test framework needs installing.
- **Add a `package.json` with `"type": "module"`** - `src/index.js` already uses `export`, which currently only works via `.mjs` or an implicit assumption; this is a prerequisite, flagged as such.
- **Deny (429) by default when over limit, sweep idle buckets on a size threshold** - an unbounded `Map` keyed by client IP is a memory-exhaustion vector.

## Open Questions / Risks
- **No pipeline exists.** The plan invents one. If a framework (Express/Fastify/Hono) is already intended for `api-service`, the adapter in `middleware.js` should be swapped for that framework's signature before implementation starts - confirm with the operator.
- **Multi-instance correctness.** An in-process limiter allows `N x rate` in aggregate across N instances. Acceptable for a single-process service; a reviewer deploying replicas must weigh moving to a shared store (Redis `INCR`+TTL or a Lua token bucket) with its added latency and failure modes.
- **Key selection is a security decision.** Keying on raw `req.socket.remoteAddress` is wrong behind a proxy; keying on `X-Forwarded-For` is spoofable unless a trusted-proxy count is configured. Defaulting to remote address and making `keyFn` mandatory-by-config is the safer route - needs an operator call.
- **Fail-open vs fail-closed** on store errors: irrelevant for the in-memory store, becomes a real decision if a shared store lands. Config flag reserved now, semantics deferred.
- **No CI, no lint config, no formatter** in the repo - nothing enforces the conventions this plan follows.
- **`web-client` sibling** exists in the workspace; if it needs to surface rate-limit state to users, the `RateLimit-*` response headers are the contract. Not in scope here.

---

## 1. Current state of the repository

Tracked files, in full:

- `README.md` - a single line, `# api-service`
- `src/index.js` - `export const noop = () => {};`

There is no `package.json`, no test runner, no lint config, no CI, no HTTP server, and no request pipeline of any kind. `.maister/` contains only task state for this planning run, not documentation. The sibling member `web-client` is equally empty.

Conventions that can honestly be inferred, and which this plan follows:

- ES modules with named exports (`export const ...`)
- Source under `src/`
- Zero runtime dependencies
- Lowercase-kebab file naming (only one data point: `index.js`; kebab is the ecosystem default and is used consistently below)

Nothing else is inferable. **No project standards were found.** Running the project's initialization command would generate `.maister/docs/INDEX.md` and establish standards that future plans could bind to; until then this plan is self-contained and a reviewer should treat its style choices as proposals, not house rules.

## 2. The token bucket algorithm

State per bucket: `tokens` (float) and `lastRefillMs` (float, monotonic).

| Parameter | Meaning | Proposed default |
|---|---|---|
| `capacity` | Maximum tokens; equals the largest instantaneous burst allowed | `20` |
| `refillPerSec` | Tokens added per second; equals the sustained request rate | `10` |
| `cost` | Tokens consumed per request (per-route override possible) | `1` |
| `initialTokens` | Tokens a fresh bucket starts with | `capacity` (new clients get a full burst) |

Lazy refill, executed on every `tryRemove(cost)`:

```
elapsedMs = max(0, now() - lastRefillMs)
tokens    = min(capacity, tokens + (elapsedMs / 1000) * refillPerSec)
lastRefillMs = now()
if tokens >= cost - EPSILON:
    tokens -= cost
    return { allowed: true,  remaining: floor(tokens), retryAfterMs: 0 }
else:
    deficit      = cost - tokens
    retryAfterMs = ceil(deficit / refillPerSec * 1000)
    return { allowed: false, remaining: floor(tokens), retryAfterMs }
```

Notes a reviewer should check:

- `elapsedMs` is clamped at 0 so a non-monotonic clock can never *remove* tokens; with a monotonic source this clamp is dead code but cheap insurance.
- `tokens` is clamped at `capacity` **after** refill, so a bucket idle for a day still only grants one burst - this is the property that makes the limiter bounded.
- `retryAfterMs` is derived, not guessed; it is exactly the time until `cost` tokens exist.
- Refill is never performed on a timer. Every bucket is O(1) memory and costs work only when its key is touched.
- `EPSILON = 1e-9` guards float accumulation so that a bucket that should be exactly at 1.0 token is not denied.

**Per-key buckets.** `BucketStore` maps `key -> { tokens, lastRefillMs }`. Keys come from a `keyFn(ctx)`; the default is the remote address, and the config can substitute an API-key or user-id extractor. Buckets are created on first sight with `initialTokens`.

**Eviction.** A bucket is fully refilled after `capacity / refillPerSec` seconds of idleness, at which point it is indistinguishable from a fresh bucket and can be dropped. The store sweeps entries idle for longer than `idleTtlMs` (default `max(60_000, 2 x capacity / refillPerSec x 1000)`), triggered opportunistically when `size > maxKeys` (default `10_000`) rather than on an interval - again, no timers. If a sweep cannot get below `maxKeys`, the oldest entries are evicted outright.

## 3. Where the limiter attaches - and the pipeline that does not exist yet

**This repo has no request pipeline.** There is no server, no router, no middleware concept. The limiter therefore cannot simply "be added to the pipeline"; the plan must propose the pipeline's shape and place the limiter in it.

Proposed minimal shape, chosen to be the smallest thing that is still a real pipeline and to remain replaceable if a framework is adopted later:

```
node:http server
  +- createPipeline([ ...middleware ])   // src/pipeline/pipeline.js
       +- requestContext   (ctx = { req, res, state, log })
       +- rateLimit(...)   <- the limiter attaches HERE
       +- router / handler
```

A middleware is `async (ctx, next) => {}`. `next()` invokes the rest of the chain. A middleware that does not call `next()` terminates the request - which is exactly how the limiter short-circuits with 429.

**Position matters and is a reviewable decision.** The limiter is placed *early* - after context construction (it needs the remote address) but *before* routing, authentication, body parsing, and any I/O. Rationale: the point of a rate limiter is to shed load before it costs anything. The trade-off: because it runs before auth, it cannot key on an authenticated user id in the default configuration. If per-user limits are wanted, a second limiter instance placed after auth (with a different `keyFn` and its own store) is the composition, not a reordering of the first - both would be documented in the README.

## 4. Files to add or change

All paths relative to the worktree root.

**Add**

- `package.json` - `{"name":"api-service","type":"module","private":true,"scripts":{"test":"node --test"}}`. *Prerequisite*: `src/index.js` already uses ESM syntax that is not valid without this.
- `src/rate-limit/token-bucket.js` - `createTokenBucket({capacity, refillPerSec, now})` returning `{ tryRemove(cost), peek(), state() }`. Pure, no HTTP, no `Map`.
- `src/rate-limit/bucket-store.js` - `createMemoryBucketStore({capacity, refillPerSec, now, maxKeys, idleTtlMs})` returning `{ consume(key, cost), size(), sweep(), clear() }`. Owns the `Map` and eviction.
- `src/rate-limit/clock.js` - `monotonicNowMs()` plus a `createManualClock()` test double with `advance(ms)`. Isolating this is what makes refill-over-time tests deterministic instead of `setTimeout`-flaky.
- `src/rate-limit/middleware.js` - `rateLimit(options)` returning a `(ctx, next)` middleware. Owns key extraction, 429 response, headers, `skip` predicate.
- `src/rate-limit/config.js` - `resolveRateLimitConfig(env, overrides)`; env parsing, defaults, validation.
- `src/rate-limit/index.js` - public re-exports.
- `src/pipeline/pipeline.js` - `createPipeline(middlewares)` -> `(ctx) => Promise<void>`.
- `src/pipeline/context.js` - `createContext(req, res)`.
- `src/server.js` - `createServer({config})` wiring `node:http` to the pipeline with the limiter installed.
- `test/token-bucket.test.js`, `test/bucket-store.test.js`, `test/rate-limit-middleware.test.js`, `test/pipeline.test.js`, `test/server-rate-limit.test.js` - `node:test`.

**Change**

- `src/index.js` - export the public surface (`createServer`, `rateLimit`, `createTokenBucket`) alongside or in place of `noop`. Removing `noop` is a breaking change to the only existing export; keep it unless the operator says otherwise.
- `README.md` - usage, configuration table, the multi-instance caveat.

## 5. Sequencing - task groups

### Group A - Project scaffolding (prerequisite)
Add `package.json` with `"type": "module"` and `"test": "node --test"`. Add `test/` directory. Verify `node --test` runs green on an empty suite and that `src/index.js` imports cleanly.

Tests:
1. `smoke.test.js` asserts `import { noop } from '../src/index.js'` resolves and `noop()` returns `undefined` - proves ESM resolution works after the `package.json` change.
2. Asserts `node --test` exits 0 with at least one test discovered - proves the runner is wired.

### Group B - Token bucket core
Implement `clock.js` and `token-bucket.js`. No HTTP, no store.

Tests (`test/token-bucket.test.js`, manual clock throughout):
1. **Burst to capacity** - a fresh bucket with `capacity=5` allows exactly 5 consecutive `tryRemove(1)` calls; the 6th returns `allowed: false`.
2. **Refill over time** - after exhausting a `capacity=5, refillPerSec=10` bucket, advancing the manual clock by 100 ms yields exactly 1 more allowed call, and a 7th is denied; advancing 500 ms restores the full 5.
3. **Refill is capped at capacity** - advancing 10 minutes on an idle bucket still allows only `capacity` calls, not more.
4. **`retryAfterMs` is exact** - a bucket at 0 tokens with `refillPerSec=10` and `cost=1` reports `retryAfterMs === 100`; advancing that exact amount makes the next call succeed.
5. **Cost > 1** - `tryRemove(3)` on a bucket holding 2 tokens is denied and consumes nothing (`peek()` still reports 2); `tryRemove(3)` with 3 tokens succeeds and leaves 0.
6. **Fractional rates** - `refillPerSec=0.5` grants 1 token after 2000 ms and 0 after 1999 ms.
7. **Clock never goes backwards** - feeding a `now()` that regresses does not increase tokens and does not throw.
8. **Invalid params rejected** - `capacity <= 0`, `refillPerSec <= 0`, or non-finite values throw a descriptive `TypeError` at construction, not at first request.

### Group C - Keyed store and eviction
Implement `bucket-store.js` over the Group B core.

Tests (`test/bucket-store.test.js`):
1. **Per-key isolation** - exhausting key `a` leaves key `b` with a full bucket; `b`'s allowances are unaffected by `a`'s denials, and vice versa.
2. **Per-key independent refill** - `a` and `b` exhausted at different simulated times refill on their own schedules.
3. **Lazy creation** - `size()` is 0 before any `consume`, 1 after one key, 2 after two.
4. **Idle sweep** - a key untouched for `> idleTtlMs` is removed by `sweep()`; a recently touched key survives.
5. **Sweeping is behaviour-preserving** - a swept key that reappears behaves identically to a fresh one (full burst), which is why dropping it is safe.
6. **`maxKeys` bound** - inserting `maxKeys + 100` distinct keys leaves `size() <= maxKeys`.
7. **`clear()`** empties the store and resets all limits.

### Group D - Pipeline
Implement `context.js` and `pipeline.js`. Independent of C; can be done in parallel.

Tests (`test/pipeline.test.js`):
1. Middlewares execute in registration order and unwind in reverse.
2. A middleware that omits `next()` short-circuits - downstream middleware never runs.
3. A middleware that throws propagates the rejection to the pipeline caller (no silent swallow).
4. `createContext` exposes `req`, `res`, and a mutable `state` object shared across the chain.

### Group E - Rate-limit middleware
Implement `config.js` and `middleware.js`, composing C and D.

Tests (`test/rate-limit-middleware.test.js`, fake `ctx`/`res`, manual clock):
1. Under the limit, `next()` is invoked and the response is untouched apart from headers.
2. Over the limit, `next()` is **not** invoked, status is 429, and the body is the configured JSON payload.
3. 429 responses carry `Retry-After` in whole seconds (`ceil(retryAfterMs/1000)`, minimum 1) and `RateLimit-Reset`.
4. Allowed responses carry `RateLimit-Limit` and `RateLimit-Remaining`, with `Remaining` decrementing across successive calls.
5. **Per-key isolation at the HTTP layer** - two `ctx` objects with different remote addresses do not share a budget.
6. A custom `keyFn` is honoured (e.g. keying on an `x-api-key` header collapses two different IPs into one bucket).
7. The `skip` predicate bypasses the limiter entirely - no headers set, no tokens consumed.
8. **Refill over time end-to-end** - a key denied at 429 is allowed again after the manual clock advances past `Retry-After`.

### Group F - Server wiring, exports, docs
Implement `server.js`, update `src/index.js` and `README.md`.

Tests (`test/server-rate-limit.test.js`, real `node:http` on an ephemeral port):
1. `capacity` requests in a tight loop all return 200; the next returns 429 - burst behaviour survives the real stack.
2. The 429 response has a parseable `Retry-After` header.
3. Two clients simulated via distinct `keyFn` inputs are isolated over real HTTP.
4. The server closes cleanly with no lingering handles - proves no timer was introduced.

## 6. Configuration surface

Resolved by `resolveRateLimitConfig(process.env, overrides)`; explicit `overrides` beat env, env beats defaults.

| Key | Env var | Default | Notes |
|---|---|---|---|
| `enabled` | `RATE_LIMIT_ENABLED` | `true` | A single kill switch is worth having |
| `capacity` | `RATE_LIMIT_CAPACITY` | `20` | Burst size |
| `refillPerSec` | `RATE_LIMIT_REFILL_PER_SEC` | `10` | Sustained rate |
| `cost` | - | `1` | Per-call override at the call site |
| `maxKeys` | `RATE_LIMIT_MAX_KEYS` | `10000` | Memory bound |
| `idleTtlMs` | `RATE_LIMIT_IDLE_TTL_MS` | derived | Eviction threshold |
| `keyFn` | - | remote address | Code-only; not env-configurable |
| `skip` | - | `() => false` | e.g. exempt `/health` |
| `statusCode` | - | `429` | |
| `headers` | `RATE_LIMIT_HEADERS` | `true` | Emit `RateLimit-*` |

Validation is strict and fails at startup: non-numeric or non-positive values throw with the offending env var named. A limiter that silently degrades to "no limit" because of a typo is the worst failure mode available.

## 7. Observability

Deliberately minimal, because the repo has no logging or metrics infrastructure to hook into:

- An injectable `onDecision({ key, allowed, remaining, retryAfterMs })` callback on the middleware, defaulting to a no-op. This is the seam a real metrics client plugs into later without touching the limiter.
- `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` on every non-skipped response, and `Retry-After` on 429s - this is the observability the `web-client` sibling can actually consume.
- `store.stats()` returning `{ size, allowed, denied, evicted }` counters, exposed for a future `/metrics` or `/health` handler. Counters are plain numbers, reset only by `clear()`.
- Keys must **not** be logged verbatim at info level when they are IPs or API keys; the `onDecision` contract documents that the consumer owns redaction.

## 8. Trade-offs a reviewer must weigh

- **In-process vs shared store.** In-process is zero-dependency, sub-microsecond, and correct for one process. It is *wrong* the moment a second replica exists - the effective limit becomes `N x refillPerSec`, and a client can round-robin across replicas to multiply its burst. A shared store (Redis) fixes this at the cost of a network round trip on the hot path, a new failure domain, and a fail-open/fail-closed decision. The `BucketStore` interface is the mitigation: swapping implementations should touch no other file.
- **Monotonic vs wall clock.** `Date.now()` is simpler and serialisable but can jump forward (granting a windfall of tokens, defeating the limiter exactly during a clock correction) or backward. A monotonic source has no epoch meaning and cannot be shared across processes - which is another reason a Redis implementation would use the server's clock rather than the app's. Chosen: monotonic in-process, injected so tests are deterministic and a future shared store can substitute.
- **Lazy refill vs timer.** Lazy is O(1) per request with no background work and no event-loop keep-alive. A timer would give exact bucket state at any instant without a `consume` call - useful only if something *observes* buckets out of band, which nothing here does. Lazy also means eviction must be opportunistic, which is the one wart.
- **What happens when the limit is exceeded.** Options: (a) 429 immediately - chosen; honest, cheap, and lets the client back off with `Retry-After`. (b) Queue/delay the request until tokens exist - smooths traffic but converts a load-shedding mechanism into a memory and latency amplifier under attack; rejected. (c) Log and allow ("shadow mode") - genuinely useful for rollout; reachable via `enabled: false` plus `onDecision`, and worth calling out as the recommended first deployment step. (d) Drop the connection - hostile to legitimate clients; rejected.
- **Keying.** IP keying punishes NAT'd/corporate clients collectively and is trivially evaded with IPv6 address rotation. API-key or user keying is fairer and stronger but unavailable before authentication. This is a product decision, not an engineering one.
- **Placing the limiter before auth** sheds load maximally but means unauthenticated floods and legitimate authenticated traffic share a budget. The two-limiter composition (section 3) is the answer if that becomes a problem.

## 9. Acceptance criteria

1. `node --test` passes with all groups' tests green, from a clean checkout, with no network access and no installed dependencies.
2. `package.json` declares zero `dependencies`; the limiter imports only `node:` builtins.
3. A bucket configured `capacity=C, refillPerSec=R` demonstrably allows a burst of exactly `C`, then exactly `R` per second sustained, verified with a manual clock - not `setTimeout`.
4. Two distinct keys never influence each other's allowance, verified at both the store and HTTP layers.
5. Exceeding the limit yields status 429 with a `Retry-After` header whose value, once elapsed, permits the next request.
6. The store's entry count stays bounded under an adversarial stream of unique keys.
7. The process exits cleanly after `server.close()` - no timers, no open handles.
8. `README.md` documents every config key, the default values, the multi-instance caveat, and the shadow-mode rollout path.
9. The limiter core (`token-bucket.js`) has no import of `node:http` and no knowledge of requests.
10. The plan's own premise is recorded in the README: no project standards existed at implementation time, and the initialization command should be run to establish them.
