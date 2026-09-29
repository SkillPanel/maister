---
name: maister-quick-plan
description: Create a bounded, standards-aware implementation plan without editing application code, then implement it after explicit approval when requested in the same workflow. Use for clear tasks that need planning but not a durable full specification or multi-phase Maister task.
---

# Maister Quick Plan

Explore only the code paths needed for a concrete plan. Read `.maister/docs/INDEX.md` and every linked standard relevant to the proposed work. Do not modify application code before plan approval.

Return a plan with scope, assumptions, open questions, evidence, files and symbols, ordered implementation steps, focused and broader tests, dependencies, risks, rollback, and a Standards Compliance Checklist naming each source standard.

Request plan approval with `request_user_input` when available, offering implementation, revision, or plan-only handoff; otherwise ask the same concise choice in the final response. Pause after the question. If the user approves implementation, load `$maister-codex:maister-quick-dev` with the approved plan and verify every checklist item after the change. If they ask only for a plan, stop. Escalate to `$maister-codex:maister-development` when requirements discovery, architecture decisions, schema changes, staged artifacts, or extensive verification are needed.
