# Orchestrator Creation Checklist

Use this checklist when creating or auditing a Maister orchestrator. Do not load it during routine execution.

## Required structure

- [ ] The skill frontmatter contains only `name` and a trigger-focused `description`.
- [ ] Initialization reads `orchestrator-patterns.md` completely.
- [ ] New runs create a task directory and `orchestrator-state.yml`; resumes validate existing state and artifacts.
- [ ] Every phase defines its purpose, prerequisites, output, state update, and transition.
- [ ] Every user gate states exactly what needs approval or a decision.
- [ ] Every user gate prefers `request_user_input` when available and has a concise final-response fallback.
- [ ] Structured questions use two or three mutually exclusive choices, put the recommendation first with `(Recommended)`, and rely on Codex's automatic free-form option.
- [ ] State remains `in_progress` until the gate is answered.
- [ ] Automatic transitions continue in the same turn when no external wait is required.
- [ ] Context handoffs contain task metadata, relevant phase summaries, decisions, risks, standards, and artifact paths.
- [ ] All returned `decisions_needed` items are surfaced rather than silently accepted.
- [ ] `.maister/docs/INDEX.md` routes standards for specification, planning, implementation, and verification.
- [ ] Progress UI is optional; `orchestrator-state.yml` and artifacts are canonical.
- [ ] Parallel work has explicit, disjoint ownership. Overlapping or uncertain writes are serialized.
- [ ] Recovery is bounded, logged, and never rolls back or discards work without approval.
- [ ] Every durable markdown artifact follows the shared summary contract.
- [ ] Dashboard and HTML companions obey `options.html_output` and never replace markdown.
- [ ] Real UTC timestamps are captured from the system before each state, log, or dashboard write.
- [ ] Finalization records checks, known issues, artifact links, and remaining risks.

## Failure patterns to reject

| Pattern | Required correction |
| --- | --- |
| Treating chat history as resume state | Read and validate `orchestrator-state.yml` and artifacts |
| Marking a phase complete before approval | Persist work, present gate, then complete after the answer |
| Asking a vague multi-decision question | Present each exclusive decision with its own context and options |
| Assuming `request_user_input` exists in every mode | Use it when available; otherwise ask the gate question in the final response |
| Using execution approval for a product decision | Reserve approval escalation for sensitive tool execution and use the user-gate contract for decisions |
| Inventing timestamps from the conversation date | Run the system clock command and use full ISO 8601 UTC |
| Delegating overlapping writes | Split ownership or serialize |
| Letting workers edit shared state or logs | Keep shared artifacts owned by the coordinator |
| Reporting a fixable verification issue without resolving it | Apply safe fixes and reverify within the bounded loop |
| Automatically resetting, reverting, or overwriting work | Obtain explicit approval |
| Generating HTML-only conclusions | Keep markdown canonical and content-equivalent |

Use `orchestrator-patterns.md` as the normative contract.
