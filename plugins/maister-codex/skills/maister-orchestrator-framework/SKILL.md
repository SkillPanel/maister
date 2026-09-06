---
name: maister-orchestrator-framework
description: Apply Maister's shared rules for resumable, state-driven workflow orchestration, phase gates, recovery, dashboards, and artifact handoffs. Use when creating, auditing, or running a multi-phase Maister workflow.
---

# Maister Orchestrator Framework

Treat this as the shared foundation for every multi-phase Maister workflow. It is primarily an internal reference skill; domain orchestrators load it rather than duplicating its contracts.

Before initializing or resuming a workflow, read `references/orchestrator-patterns.md` completely. When authoring or auditing an orchestrator, also read `references/orchestrator-creation-checklist.md`. Read `references/html-report-style.md` only when HTML companions are enabled.

## Required invariants

- Keep `orchestrator-state.yml` as the durable source of truth. Chat history and transient progress UI are not resume state.
- Capture real UTC timestamps from the system before writing state, logs, or dashboard data.
- Validate completed-phase artifacts before resuming and continue at the first incomplete valid phase.
- Complete phase work, persist artifacts, and refresh the dashboard before presenting a phase gate. Mark the phase complete only after the gate is resolved.
- Ask the user about unresolved product decisions, destructive recovery, rollback, and critical verification findings. At a gate, prefer `request_user_input` when it is available; otherwise ask one concise direct question in the final response. End the turn when an immediate answer is required.
- Never roll back, reset, or discard work without explicit approval.
- Load `.maister/docs/INDEX.md` and the standards relevant to each phase.
- Delegate only independent work. Parallel writes require disjoint declared file ownership; otherwise serialize them.
- Open every durable markdown artifact with the `TL;DR`, `Key Decisions`, and `Open Questions / Risks` contract from the reference.

## Optional operator output

Read `.maister/config.yml` once at initialization and persist effective options into state. When `html_output` is true, copy `assets/dashboard.html` into the task root and maintain `dashboard-data.js` as a projection of state. HTML companions must follow `references/html-report-style.md`; markdown remains canonical. Browser opening is best-effort and must not block the workflow.

Return control to the calling workflow after applying these rules.
