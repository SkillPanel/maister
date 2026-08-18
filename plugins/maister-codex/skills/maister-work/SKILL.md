---
name: maister-work
description: Route or resume any Maister software workflow, including development, performance, migration, research, product design, mockups, quick work, standards, and verification. Use when the user supplies a task, issue, task directory, or ambiguous engineering request and wants Maister to choose the workflow.
---

# Maister Work

Resolve task paths before classifying text. For an input path, try it as written, under `.maister/`, and by basename under `.maister/tasks/*/`. If `orchestrator-state.yml` exists, read it and route by its recorded workflow, phase, status, and options. Never restart or reclassify a resumable task silently.

For external issue URLs or identifiers, use an already-configured repository or issue connector when available. Otherwise preserve the supplied issue context and ask only for the missing description.

| Strongest signal | Load and follow |
| --- | --- |
| Clear isolated implementation | `$maister-codex:maister-quick-dev` |
| Reproducible isolated defect | `$maister-codex:maister-quick-bugfix` |
| Plan only | `$maister-codex:maister-quick-plan` |
| Feature, enhancement, complex bug | `$maister-codex:maister-development` |
| Latency, throughput, resource use | `$maister-codex:maister-performance` |
| Framework, API, schema, data, or architecture move | `$maister-codex:maister-migration` |
| Investigation or technology decision | `$maister-codex:maister-research` |
| Product/feature definition, personas, flows | `$maister-codex:maister-product-design` |
| UI wireframes or mockups | `$maister-codex:maister-mockup-studio` |
| Initialize or capture conventions | `$maister-codex:maister-init`, `$maister-codex:maister-standards-discover`, or `$maister-codex:maister-standards-update` |
| Verify completed Maister work | `$maister-codex:maister-verify` |

For ambiguous descriptions, delegate classification to the installed `maister-task-classifier` agent when available; otherwise classify inline. Use evidence rather than keywords when signals conflict. Prefer the domain workflow over generic development when the primary outcome is measurement, migration safety, research evidence, or product definition. For a genuine tie that changes artifacts or approval gates materially, prefer `request_user_input` when available to present the two choices; otherwise ask the same concise choice in the final response. Pause after the question. Otherwise announce the selected skill and continue.

## Resume behavior

- `in_progress` or `paused`: summarize completed phases, current phase, artifacts, decisions, failures, and remaining gates; continue from the recorded phase.
- `completed`: offer task details, focused re-verification, or a follow-up task; do not reopen automatically.
- `failed` or attempts exhausted: summarize the last failure and offer retry, resume from a named phase, or stop. Never discard existing work.
- A requested `--from=<phase>` changes the resume point only after validating prerequisites and recording the decision; preserve later artifacts until the user explicitly authorizes replacement.

Return the chosen workflow, confidence, evidence, task path when any, and next phase.
