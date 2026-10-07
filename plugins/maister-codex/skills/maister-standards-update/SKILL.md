---
name: maister-standards-update
description: Add, revise, remove, or synchronize Maister coding standards from an explicit team convention, recent conversation, description, or another project. Use when the user states an always/never/prefer convention or asks to import standards from another path.
---

# Maister Standards Update

Infer a standard from the request or recent conversation only when the convention, scope, and intent are unambiguous. Otherwise obtain the missing rule, rationale, examples, exceptions, or target area.

For `--from=<path>`, validate both source and destination standards directories. Compare each source file with its local counterpart as missing, identical, or different. Present a selectable summary. For differences, offer replace, non-conflicting merge, or skip through `request_user_input` when available; otherwise ask the same concise choice in the final response. Never merge incompatible rules silently.

For a described convention, inspect existing standards and the bundled baseline shipped with `$maister-codex:maister-docs-manager` (`assets/standards/`). Select the most specific category/file, show the target and proposed markdown diff, and preserve unrelated content. Create a category or file only when no appropriate destination exists. Explicitly confirm removals and changes to human-authored rules using `request_user_input` when available, with a concise final-response question as fallback.

After approval, load `$maister-codex:maister-docs-manager` to apply the operation, regenerate INDEX entries with practice-specific descriptions, and validate root `AGENTS.md` documentation routing. Verify the file exists, the requested convention is represented accurately, examples remain valid, and the index link resolves. Summarize what changed, why, source evidence, conflicts, and which workflows now enforce it.
