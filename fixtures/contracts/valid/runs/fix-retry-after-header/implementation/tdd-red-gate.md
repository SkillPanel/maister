# Reproduction  -  rate-limited responses omit Retry-After

## TL;DR

Red proven. A request over the limit returns 429 with no `Retry-After` header.
The new test asserts the header is present and carries whole seconds to refill.
It failed on the assertion, not on its own setup, which is what makes the red real.

## Key Decisions

- Asserted the header's value, not only its presence: a header carrying the wrong unit is
  the same outage for a client that backs off on it, and the project's header conventions
  fix `Retry-After` as whole seconds.
- Traced first. The 429 is raised in two places  -  the sustained-rate deny and the burst
  deny  -  and only the first is the one the statement describes.

## Open Questions / Risks

- The burst path also returns 429 and is not covered by this reproduction. Whether it has
  the same defect is unknown and was not investigated: it is outside the statement.

## Root cause hypothesis

`src/limiter/deny.js` builds its response through `errorBody()`, the shared error-shape
helper. That helper sets a status and a body and no headers at all, so every field the
deny branch wanted to send as a header is dropped on the floor. The bucket's refill
estimate is computed two lines earlier and then used only in the body's `detail` string.

## The test

`test/limiter/deny.test.js`, new case "429 carries Retry-After in whole seconds":
drives the limiter past its rate, then asserts `res.headers['retry-after']` equals the
ceiling of the bucket's seconds-to-refill.

Command: `npm test -- test/limiter/deny.test.js`

```
FAIL test/limiter/deny.test.js
  429 carries Retry-After in whole seconds
    expected '2', got undefined
1 failing
```
