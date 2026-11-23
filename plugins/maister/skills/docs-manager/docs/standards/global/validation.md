## Validation

### Validate at the Boundary
Check input where it enters (a request, CLI arguments, a file, a message, a third-party response) against what it must be (type, format, range or an allowed set, not a list of bad values) and reject it there. Past that boundary trust it: don't re-check values that internal code already validated or cannot produce.

### Prevent Injection Where Data Is Used
Stop injection where data is used, not by stripping characters from input: bind SQL values as parameters and map identifiers from input (a sort column, `ASC`/`DESC`) to a fixed list; pass command arguments as a list, not a shell string; let the template engine escape output and clean user-written HTML with a maintained sanitizer; keep file paths inside a fixed directory; parse outside data with a data-only loader, never `pickle`, `eval` or `yaml.load`; log input as separate fields, not inside the message.

### Consistent Enforcement
Put a business rule (a sufficient balance, a valid date range) where every entry point passes through it, such as the domain model or a service, not in one controller or form, so a new route, job or command cannot skip it.

### Server-Side Always
When the project owns both a client and its server, the server checks every input itself; checks in the browser or app only give early feedback and mirror the server's.
