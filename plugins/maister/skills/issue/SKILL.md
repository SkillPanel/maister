---
name: maister-issue
description: "Create a local Markdown issue under .maister/issues/ (create-only)."
argument-hint: "[problem description or title]"
user-invocable: true
---

Create exactly one local Markdown issue file. Do not list, do not update, do
not close, and do not delete issues. Do not sync to GitHub/Jira. Do not start
`/maister-work`, FLOW skills, or other orchestrators. Remote tracker IDs are
not `.maister/issues/` files.

## Algorithm

1. **Gather input** — Prefer the invocation argument as title/body. If empty,
   scan recent conversation for a clear finding. If still insufficient, ask
   once for a short problem statement; do not run a multi-phase interview.
2. **Derive title** — Concise H1 problem statement (phrase, not an essay).
3. **Derive slug** — Lowercase kebab-case from the title; ASCII letters/digits/
   hyphens only; collapse runs; trim leading/trailing hyphens.
4. **Build path** — `.maister/issues/YYYY-MM-DD-<slug>.md` using the **UTC**
   date (`date -u +"%Y-%m-%d"`).
5. **Resolve collision** — If the path exists, try `<slug>-2`, `<slug>-3`, …
   (numeric suffix) or a longer disambiguating slug until free. Never overwrite.
6. **Ensure directory** — Create `.maister/issues/` if missing.
7. **Write file** — Use the required core template below. Fill Evidence and
   Acceptance from input, or honest placeholders / observable criteria.
8. **Confirm** — Verify the file exists and is non-empty.
9. **Report** — Print the path (absolute or repo-relative), title, Status, and
   Priority. Stop.

## Defaults

| Field | Default |
|-------|---------|
| Status | `open` |
| Added | same UTC date as the filename prefix |
| Area | inferred when clear; else `unspecified` |
| Priority | inferred `P0`–`P2` when clear; else `P2` |

Optional middle sections (`## Risks`, `## Consequences`, `## Required
investigation`, `## Required implementation`) may appear between Problem and
Acceptance when the input clearly warrants them. Always include Problem,
Evidence (or placeholder), and Acceptance criteria.

## Required core template

```markdown
# <Title>

- **Status:** open
- **Added:** YYYY-MM-DD
- **Area:** <inferred or "unspecified">
- **Priority:** <P0|P1|P2; default P2 if unspecified>

## Problem

<problem narrative from args/conversation>

## Evidence

<evidence if available; otherwise a short placeholder noting none provided>

## Acceptance criteria

- <observable criteria derived from the problem>
```
