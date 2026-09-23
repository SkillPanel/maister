---
name: maister-quick-dev
description: Implement a clear, small software change directly while enforcing Maister project standards. Use for focused fixes or enhancements with no material architecture decision; use maister-development for larger or ambiguous work.
---

# Maister Quick Dev

Implement the request directly. Before modifying code, inspect the relevant code path, test conventions, and `.maister/docs/INDEX.md` when it exists. Read every standard linked from the index that governs the files or concerns being changed; reading only the index is insufficient.

Make the smallest defensible change. Preserve unrelated edits, do not introduce dependencies without confirmation, and do not use destructive Git operations. When the request expands into a multi-module change, uncertain requirements, schema change, or architecture choice, stop and recommend `$maister-codex:maister-development`.

Run the narrowest relevant checks, then broaden to the project’s prescribed test or lint command when the change warrants it. Report:

- changed files and user-visible behavior;
- tests and checks run, including failures not resolved;
- a Standards Compliance Checklist with one pass/fail item per applicable standard and its source file.

If `.maister/docs/INDEX.md` is absent, proceed normally and recommend `$maister-codex:maister-init` in the final summary.
