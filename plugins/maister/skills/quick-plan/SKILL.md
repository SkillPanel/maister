---
name: maister:quick-plan
description: Enter planning mode with Maister standards enforcement
argument-hint: "[task description]"
---

# Quick Plan — Plan Mode with Standards Enforcement

This works exactly like Claude Code's built-in plan mode, with one addition: the resulting plan must discover and enforce the project's coding standards from `.maister/docs/`.

## Workflow

1. **Get the task** — Use the argument if provided. If none, take it from the recent conversation (what was just discussed, an error, a request left open). Only when nothing there is inferable, ask with `AskUserQuestion`: "What would you like to plan?"

2. **Enter plan mode** — Call `EnterPlanMode` and let plan mode run exactly as it normally does (explore the codebase, design the approach, write the plan, then `ExitPlanMode` for approval). Do not redefine its phases.

3. **Discover and enforce standards (the addition)** — While planning:
   - Read `.maister/docs/INDEX.md` to find which standards exist.
   - **Then read the specific standard files it points to that are relevant to this task.** Reading INDEX.md alone is NOT sufficient — this is mandatory.
   - Fold the matched standards into the plan itself: reference the governing standard where it shapes a step, and include a **`## Standards Compliance Checklist`** — one checkbox per applicable guideline the implementation must satisfy (each annotated with its source file, e.g. `(from standards/backend/api.md)`). This checklist is verified after implementation.

   If `.maister/docs/INDEX.md` does not exist, plan normally and note in the plan: "No Maister standards found. Consider running `/maister:init`."

Do not call `ExitPlanMode` until the plan reflects the applicable standards and includes the Standards Compliance Checklist (or the "no standards found" note).

4. **After approval — implement and verify (mandatory)** — Once the plan is approved and you implement it, go through the `## Standards Compliance Checklist` and verify each item — mark pass/fail and report it. Address any failure before marking the task complete.
