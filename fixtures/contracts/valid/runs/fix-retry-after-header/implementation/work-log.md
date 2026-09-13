# Work log  -  Retry-After on rate-limited responses

## Root cause, as confirmed

The hypothesis held. `src/limiter/deny.js` built its response through `errorBody()`, the
shared error-shape helper, which sets a status and a body and no headers. The refill
estimate the deny branch already computed was used only inside the body's `detail` string,
so it never reached the client in a form anything backs off on.

## What changed

| File | Change |
|---|---|
| `src/limiter/deny.js` | the sustained-rate deny branch sets `Retry-After` from the bucket's refill estimate, rounded up to whole seconds, on the response the helper returns |
| `test/limiter/deny.test.js` | the reproduction case from the red gate |

`errorBody()` is untouched.

## Why the header is set in the deny branch

The helper serves every error shape in the service  -  validation, not-found, conflict  -  and
`Retry-After` is meaningful for exactly one of them. Teaching the helper about it would put
a limiter concept into the path every other error takes.

## Why the estimate rounds up

The project's header conventions fix the unit as whole seconds. Rounding down tells a
client to retry while it is still limited, which produces a second 429 and, for a client
that backs off on the header, a tighter loop than no header at all.

## Red to green

```
$ npm test -- test/limiter/deny.test.js
  429 carries Retry-After in whole seconds ... ok
1 passing
```

## Left alone

The burst deny path also returns 429 and was not touched. Whether it has the same defect is
recorded as open in the reproduction and carried to the gate; fixing it would have taken the
run past the statement.
