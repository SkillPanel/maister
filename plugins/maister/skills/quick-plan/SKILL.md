---
name: maister:quick-plan
description: Enter planning mode with Maister standards enforcement
argument-hint: "[task description]"
---

# Quick Plan — Plan Mode with Standards Enforcement

This works exactly like Claude Code's built-in plan mode, with one addition: the resulting plan must discover and enforce the project's coding standards from `.maister/docs/`.

## Workflow

1. **Get the task** — Use the argument if provided. If none, take it from the recent conversation (what was just discussed, an error, a request left open). Only when nothing there is inferable, ask in plain text — "What would you like to plan?" — and wait for the answer: with nothing to pick from it is not a question-tool call, which takes two options or more on Claude Code.

2. **Enter plan mode** — Call `EnterPlanMode` and let plan mode run exactly as it normally does (explore the codebase, design the approach, write the plan, then `ExitPlanMode` for approval). Do not redefine its phases.

3. **Discover and enforce standards (the addition)** — Before planning, read the Standards Compliance Checklist reference, `<plugin root>/skills/orchestrator-framework/references/standards-compliance-checklist.md` (the plugin root two levels above this skill's base directory, as an absolute path), and follow it while planning: it says where the standards come from and which files must be read, how to fold them into the plan and write its **`## Standards Compliance Checklist`**, and the note the plan carries when the project has no standards. This checklist is verified after implementation.

Do not call `ExitPlanMode` until the plan reflects the applicable standards and includes the Standards Compliance Checklist (or the "no standards found" note).

4. **After approval — implement and verify (mandatory)** — Once the plan is approved and you implement it, go through the `## Standards Compliance Checklist` and verify each item as the reference's *Verifying the checklist* says — mark pass/fail and report it. Address any failure before marking the task complete.

5. **Keep the docs index whole** — While implementing, never edit `.maister/docs/INDEX.md` or anything under `.maister/docs/standards/`, and no plan lists them as files to change; name every document you changed under `.maister/docs/` in your report. A convention worth keeping is suggested in one line for `/maister:standards-update`, never written into a standards file here.
