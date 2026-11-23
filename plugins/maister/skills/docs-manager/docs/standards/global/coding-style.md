## Coding Style

### Reuse What Exists
Before writing a helper or a component, search the project, its shared components and its UI library for one that does the job, and use or extend it. When the change would copy existing logic, move it into one place both callers use; extract nothing that has a single caller.

### Compatibility Only for Outside Users
When a change renames or reshapes something only this repository uses, update every caller and delete the old form: no alias, re-export, wrapper or fallback. What outside users rely on (a published API, package exports, CLI flags, configuration keys, stored formats) changes by adding; a removal, rename or change of meaning goes through the project's versioning or deprecation path, and the change says so.

### Comments Say Why
Match the comment density of the surrounding code. A comment says what the code cannot: why it is so, a constraint it keeps, what a workaround works around. It never restates the code or narrates the change ("added", "now uses", "fixed", a ticket number); that history belongs in the commit message.
