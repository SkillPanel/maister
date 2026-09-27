---
name: quick-dev
description: Implement a task directly with Maister standards enforcement (no planning mode)
argument-hint: "[task description]"
---

# Quick Dev — Direct Development with Standards Enforcement

This works exactly as if you asked the main agent to implement the task directly — no plan mode. The one addition: discover and enforce the project's coding standards from `.maister/docs/`.

## Workflow

1. **Get the task** — Use the argument if provided. If none, ask with `ask_user`: "What would you like to implement?"

2. **Implement it** — Explore the relevant code and make the changes exactly as you normally would for a direct development request.

3. **Discover and enforce standards (the addition)** — As you work:
   - Read `.maister/docs/INDEX.md` to find which standards exist.
   - **Then read the specific standard files it points to that are relevant to what you touch.** Reading INDEX.md alone is NOT sufficient — this is mandatory. When you reach a new area mid-task (e.g. auth, database, forms), read its standards before coding it.
   - Apply the matched standards while implementing.

4. **Verify compliance (mandatory)** — After implementing, go through each applicable standard and verify it was followed — report a **Standards Compliance Checklist** (pass/fail per guideline, each annotated with its source file) in your summary, alongside what changed and any tests run. Address any failure before marking the task complete.

If `.maister/docs/INDEX.md` does not exist, implement normally and note: "No Maister standards found. Consider running `/maister-copilot:init`."
