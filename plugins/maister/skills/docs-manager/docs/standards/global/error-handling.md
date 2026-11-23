## Error Handling

### Clear User Messages
An error shown to a user or returned to an API caller says what went wrong and, for rejected input, which field and what it accepts. It carries no stack trace, raw exception or database message, internal path or secret: log those instead.

### Catch Only to Act
Catch an error only where the code can act on it: recover, retry, or rethrow it as an error the caller can tell apart (a distinct type, error value or code). Let the rest reach one handler at the boundary (request handler, job runner, CLI entry point) that logs it and reports the failure. Never swallow an error or return a default that hides it; a fallback the spec asks for is logged and shown as partial.

### Retry with Backoff
Retry a call to another service only for a transient failure (a timeout, 429, 503) and only when the operation is idempotent or carries an idempotency key. Cap the attempts, back off exponentially with jitter, retry in one layer only (not around a client that already retries), and give every remote call a timeout.

### Resource Cleanup
Release what a change opens (a file, a pooled connection, a lock, a listener, a timer, a subscription) on every path, errors and early returns included: use the language's scoped form (`with`, `using`, try-with-resources, `defer`) or the framework's cleanup hook, not a close call an exception can skip.
