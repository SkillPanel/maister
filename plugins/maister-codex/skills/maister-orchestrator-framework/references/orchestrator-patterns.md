# Orchestrator Patterns

Shared execution rules for Maister's resumable multi-phase workflows.

## 1. Coordination and delegation

Run orchestration in the main agent context. Load named Maister skills through the available skill mechanism and follow each selected `SKILL.md` completely. Use subagents only when the user or workflow explicitly authorizes delegation.

Delegate independent discovery, planning review, implementation, or verification when it improves quality or latency. Preserve these ownership rules:

- The coordinator owns `orchestrator-state.yml`, shared plans, indexes, dashboards, and work logs.
- Read-only investigations may run in parallel.
- Parallel writers require declared, pairwise-disjoint file sets.
- If ownership is missing, overlapping, glob-ambiguous, or stateful runtime resources conflict, serialize the work.
- Wait for all members of a wave before scheduling work that depends on that wave.
- Do not cancel successful siblings because one worker failed.

Inline work is appropriate for state transitions, context extraction, user gates, simple configuration decisions, and final summaries. A workflow may require a specialist skill or agent for other phases; honor that explicit contract.

When a skill names a specialist agent (for example `maister-task-group-implementer` or `maister-spec-auditor`), check whether that agent is installed under `.codex/agents/` — `$maister-codex:maister-init` offers these templates. If it is installed and delegation is available, delegate to it with the lane's context and output contract. If it is not installed or subagents are unavailable, perform the same lane inline under the same contract and note the fallback in the work log; a missing agent never blocks the workflow.

## 2. Phase transitions and user gates

Use this Codex-native interaction contract at every gate:

1. Prefer `request_user_input` when that tool is available (normally in Plan mode). Ask one to three short questions, each with two or three mutually exclusive choices. Put the recommended choice first and suffix its label with `(Recommended)`. Do not add an `Other` choice; Codex supplies the free-form escape hatch.
2. If `request_user_input` is unavailable, present the same context and choices as one concise direct question in the final response, then end the turn. Do not represent a missing tool as approval or silently choose for the user.
3. Use execution approval/escalation only for permission to perform a sensitive tool action. Never use it as a substitute for a product, scope, design, or workflow decision.
4. Persist the pending question and available choices in the phase gate before pausing. After the user answers, record the answer and resume from durable state.

Use two transition kinds:

- `PAUSE`: user approval or a material decision is required. Persist the completed phase output, refresh the dashboard, use the interaction contract to present the concrete question, and end the turn. Do not mark the phase complete until the answer arrives.
- `AUTO-CONTINUE`: prerequisites are satisfied and no external answer is needed. Update state and continue in the same turn.

At every phase entry, verify the previous required gate was resolved. A gate should explain the artifact or finding under review, the recommended option, alternatives with trade-offs, and the consequence of postponing. Keep structured choice labels short; put trade-offs in their descriptions or the surrounding prose.

When multiple decisions arrive from a worker, preserve their boundaries. Present critical decisions separately. Group only genuinely independent questions, and never flatten mutually exclusive options from different decisions into one list.

## 3. Context passing

Give each delegated phase only the context it needs, but always include:

```markdown
## Accumulated context

### Task
- Title: ...
- Type: ...
- Task path: ...

### Relevant completed phases
- [phase]: [1-2 sentence summary]
- Decisions: ...
- Risks: ...
- Artifacts: ...

### Standards
- .maister/docs/standards/... — [why it applies]

### Required output
- Path: ...
- Summary contract: TL;DR, Key Decisions, Open Questions / Risks
```

After a phase, extract its summary, decisions, risks, artifacts, issues, and unresolved decisions into state. Paths alone are not sufficient context; do not duplicate entire large artifacts when a focused excerpt and path will do.

## 4. Durable state

Store state at `.maister/tasks/<workflow>/YYYY-MM-DD-<slug>/orchestrator-state.yml`.

Capture every timestamp by running `date -u +"%Y-%m-%dT%H:%M:%SZ"` immediately before the write. Use the captured value for writes in that operation. Never invent a date-only or midnight timestamp. Date-only task-directory prefixes are allowed.

Minimum schema:

```yaml
orchestrator:
  workflow: development
  current_phase: analyze
  started_phase: analyze
  completed_phases: []
  failed_phases: []
  options:
    sequential: false
    html_output: true
    mockup_format: html
  auto_fix_attempts: {}
  created: 2026-01-01T12:00:00Z
  updated: 2026-01-01T12:00:00Z
  task_path: .maister/tasks/development/2026-01-01-example

task:
  title: Example
  description: Full task description
  status: in_progress
  tags: []
  priority: null

phase_summaries: {}
verification_context:
  last_status: null
  issues_found: []
  fixes_applied: []
  decisions_made: []
  reverify_count: 0
```

Each `phase_summaries.<phase>` entry uses:

```yaml
summary: Brief operator-facing result
decisions: []
risks: []
artifacts:
  - path: implementation/spec.md
    label: Specification
    html: implementation/spec.html
gate:
  question: null
  answer: null
started: null
completed: null
```

Add domain context under a named field such as `task_context`, `performance_context`, `migration_context`, `research_context`, or `design_context`. Do not overload common fields. Domain state examples are partial extensions: merge their mappings into this schema, retaining the other framework fields. All options live under `orchestrator.options`; phase summaries live only at the root; `verification_context.issues_found` is always a list of findings (derive counts from its length).

When resuming older state, normalize legacy root `options` into `orchestrator.options` and domain-local `phase_summaries` into root `phase_summaries`, preserving all entries. If both locations disagree, surface the conflicting values for a decision before continuing. Convert a numeric zero `issues_found` to `[]`; recover nonzero counts from existing verification reports without inventing findings, or pause if the reports are missing. Record the normalization in the work log and preserve an original state copy before rewriting it.

Read `.maister/config.yml` once at initialization. Seed effective defaults into state so a resumed run remains consistent:

```yaml
html_output: true
mockup_format: html
```

Per-run flags override project configuration.

## 5. Initialization and resume

For a new workflow:

1. Parse the task and options.
2. Capture the UTC clock.
3. Create the task root and the workflow's required artifact directories.
4. Create state with all phases pending and the first phase active.
5. Load `.maister/docs/INDEX.md` and applicable standards.
6. If HTML output is enabled, copy the maintained dashboard asset and write the initial data projection.
7. Represent phases in the available progress UI when useful.

Generate the slug from three to five meaningful words in lowercase kebab-case. Reuse an existing matching task only when the user requested resume or state clearly identifies it.

For resume:

1. Read the full state file and all artifacts registered for completed phases.
2. Verify each artifact exists and is internally usable. If one is missing or corrupt, move the phase back to incomplete and record why.
3. Reconcile any stale `current_phase` with the first incomplete phase whose prerequisites are satisfied.
4. Restore progress UI from durable state; do not persist transient IDs as authoritative data.
5. Refresh dashboard data before doing new phase work.
6. If prerequisites for the intended phase are absent, present the safe resume choices and stop for the user.

## 6. Recovery and verification loops

Classify findings as:

- safe and mechanical: formatting, missing imports, obvious typos, narrow configuration corrections;
- material: architecture, product behavior, schema/data risk, test intent, performance trade-offs, destructive actions.

Apply safe fixes, log them, and rerun affected verification. Ask the user before material fixes, known-issue acceptance, scope changes, or rollback. Cap automatic fix/reverify loops at three attempts unless the domain workflow specifies a lower bound. Critical unresolved findings block completion.

## 7. Artifact summary contract

Every durable markdown artifact starts after its H1 with:

```markdown
## TL;DR
[Three to five concise lines stating the conclusion or delivered result.]

## Key Decisions
- [Decision] — [Rationale]

## Open Questions / Risks
- [Question or risk]
```

Omit empty decision or risk sections. Keep `TL;DR` to five lines. Exempt state files, dashboard data, raw mockups, screenshots, and append-only work logs. Lift these blocks into phase summaries without weakening or inventing meaning.

## 8. Operator dashboard

When `options.html_output` is true:

- copy `assets/dashboard.html` to the task root without modifying it;
- write `dashboard-data.js` as a full projection of state;
- refresh data at initialization, phase start, before every gate, after gate resolution, after phase completion, after verification cycles, and at finalization;
- best-effort open the plain absolute dashboard path with the platform opener; request approval when the environment requires it, and never block on failure.

Projection shape:

```js
window.MAISTER_DATA = {
  generated: "2026-01-01T12:00:00Z",
  task: { title: "", type: "", status: "in_progress", description: "", path: "", current_activity: null },
  characteristics: {},
  phases: [{
    id: "phase-1", name: "", icon_hint: "analysis", status: "pending",
    started: null, completed: null, skip_reason: null,
    summary: null, decisions: [], risks: [], artifacts: [], gate: null
  }],
  verification: { status: null, issues: [], fixes: [], reverify_count: 0 }
};
```

Set `task.type` to the workflow's canonical key — `development`, `performance`, `migration`, `research`, or `product-design` — because the dashboard selects its hero-artifact layout by that exact value and falls back to `development` for anything else.

Use only `critical`, `warning`, or `info` severities. Keep fixed issues with `fixed: true`. Prefix resolved retained risks with `resolved:`. Do not copy artifact bodies into dashboard data.

When HTML output is false, do not create dashboard files or report companions. Markdown, state, and summaries remain mandatory.

## 9. HTML companions

Markdown is canonical. A companion must contain the same conclusions and follow `references/html-report-style.md` in `$maister-codex:maister-orchestrator-framework`. Register its path in the matching phase artifact's `html` field. Prefer generating markdown and HTML from one finalized source context. Failure to generate HTML is non-blocking and must be logged.

When `options.html_output` is true, produce a companion for each high-value artifact as part of the step that finalizes the markdown. Whoever writes the markdown (the coordinator or a delegated worker such as `maister-html-companion-writer`) writes the sibling `.html` in the same directory:

| Artifact | Companion | Written when |
| --- | --- | --- |
| `implementation/spec.md` | `implementation/spec.html` | Specification approved |
| `implementation/implementation-plan.md` | `implementation/implementation-plan.html` | Plan approved |
| `verification/implementation-verification.md` | `verification/implementation-verification.html` | Each verification cycle |
| `verification/e2e-verification-report.md` | `verification/e2e-verification-report.html` | E2E phase completes |
| `verification/visual-fidelity.md` | `verification/visual-fidelity.html` | Visual fidelity report completes |
| `outputs/research-report.md` | `outputs/research-report.html` | Research synthesis approved |
| `outputs/solution-exploration.md` | `outputs/solution-exploration.html` | Convergence resolved |
| `outputs/high-level-design.md` | `outputs/high-level-design.html` | Design approved |
| `outputs/product-brief.md` | `outputs/product-brief.html` | Brief approved |

Refresh a companion whenever its markdown source materially changes; never leave a companion contradicting its source. When `html_output` is false, produce no companions.
