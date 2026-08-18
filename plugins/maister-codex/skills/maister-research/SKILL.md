---
name: maister-research
description: Run a resumable evidence-based research workflow that defines a question, plans methodology, gathers and cites multiple source types, synthesizes findings, and optionally explores solutions and produces high-level design decisions. Use for technical, requirements, literature, product, or mixed investigations before implementation.
---

# Maister Research

Separate evidence, interpretation, and recommendation. Cite sources at the claim they support, record uncertainty, and never convert an inference into a fact.

Read `references/research-methodologies.md` when planning evidence collection. Read `references/brainstorming-techniques.md` only for solution generation and `references/design-techniques.md` only for high-level design. At every user gate, prefer `request_user_input` when available; otherwise ask the equivalent concise question in the final response and pause.

## Initialize or resume

Load and follow `$maister-codex:maister-orchestrator-framework`. Its state, timestamp, phase-gate, artifact-summary, dashboard, HTML-companion, recovery, and resume contracts are mandatory.

For a new task, create `.maister/tasks/research/YYYY-MM-DD-task-slug/` with `planning/`, `analysis/findings/`, `outputs/`, and `orchestrator-state.yml`. Read `.maister/config.yml` and relevant project documentation. Parse `--type`, `--brainstorm`, `--no-brainstorm`, `--design`, `--no-design`, and `--from=PHASE`; contradictory flags must be resolved before work.

For a resume, restore the first incomplete step or phase from state unless `--from` was explicitly requested, read all existing findings and outputs, and gather only missing evidence. Mandatory gates require a fresh user response.

State must include the framework fields plus:

```yaml
research_context:
  research_type: mixed          # technical | requirements | literature | product | mixed
  research_question: null
  scope: {included: [], excluded: [], constraints: []}
  methodology: []
  sources: []
  confidence_level: null
  gathering_strategy: {categories: [], count: 0, source: null}
  phase_summaries: {}
options:
  html_output: true
  brainstorming_enabled: null
  design_enabled: null
```

## Phases

### 1. Research foundation

Complete and persist each step separately so resume can continue within the phase. Delegate steps to the installed specialist agents per the framework's delegation rule when available — `maister-research-planner` for planning, `maister-information-gatherer` for gathering lanes, `maister-research-synthesizer` for synthesis — otherwise perform them inline.

1. **Brief:** clarify the research question, decision it informs, audience, scope, exclusions, constraints, freshness needs, and success criteria. Classify the research type. Write `planning/research-brief.md`.
2. **Plan:** write `planning/research-plan.md` and `planning/sources.md` with methodology, source categories, search questions, validation approach, stop criteria, and a bounded gathering strategy. Prefer primary sources for technical claims and current authoritative sources for unstable facts.
3. **Gather:** investigate independent categories in parallel when useful: codebase, project documentation, configuration and tests, official external documentation, and other explicitly authorized sources. Write one or more cited files under `analysis/findings/`. Record inaccessible, contradictory, stale, or low-quality sources instead of hiding them.
4. **Synthesize:** cross-check claims across sources, resolve or expose conflicts, distinguish consensus from isolated evidence, and write `analysis/synthesis.md` plus `outputs/research-report.md`.

The report must contain the question, methodology, source coverage, findings with citations, patterns, counter-evidence, gaps, confidence, conclusions, and actionable recommendations. Mandatory gate: summarize findings, confidence, important uncertainties, and whether more gathering is warranted.

### 2. Optional-phase decision

Evaluate brainstorming and design independently. Brainstorming is useful when the evidence supports multiple approaches; high-level design is useful when a selected approach needs architecture, boundaries, data flow, or recorded decisions. Respect explicit flags. Otherwise present the recommendation and ask separately whether to enable each phase. Persist both decisions.

### 3. Solution generation

When brainstorming is enabled, delegate to the installed `maister-solution-brainstormer` agent when available so the initial alternatives are not biased by the orchestrator's preferred answer. Write `outputs/solution-exploration.md` with problem reframing, at least two materially distinct alternatives when evidence allows, evidence links, trade-offs, constraints, scope guardrails, deferred ideas, and a reasoned recommendation. If the artifact is missing or contains no alternatives, retry once before asking whether to skip.

Skip cleanly when disabled and record the reason. Auto-continue to convergence when enabled.

### 4. Solution convergence

Read the exploration artifact and identify independent decision areas. For each area, sequentially present all viable alternatives, evidence, pros, cons, risks, and the recommendation. If more than three alternatives remain viable, synthesize them into two or three meaningful choice families while preserving the complete comparison in the artifact, then ask exactly one focused decision question. Later questions may depend on earlier answers; do not batch them. Record selections, accepted trade-offs, “need more information” follow-ups, and deferred ideas in state and the exploration artifact. Mandatory gate after every decision area is resolved.

### 5. High-level design

When design is enabled, delegate to the installed `maister-solution-designer` agent when available, confirm architectural constraints, and transform the selected approach into `outputs/high-level-design.md` and `outputs/decision-log.md`. Include system context, containers/components at appropriate depth, interfaces, data flow, trust and failure boundaries, rollout/operability concerns, success criteria, and MADR-style decisions with considered options and consequences. Do not invent implementation details unsupported by research. Retry once if either artifact is missing. Mandatory design-approval gate.

Skip cleanly when disabled and record the reason.

### 6. Completion and handoff

Ensure the research report reflects any later decisions without erasing original evidence. Mark state complete and summarize findings, source coverage, confidence, selected solutions, design outputs, unresolved questions, and recommended next action. For implementation work, hand off the task path to `$maister-codex:maister-development`; research informs its phases but does not replace codebase analysis, specification, planning, or verification.

When embedded in another workflow, omit only the conversational completion ceremony; preserve all artifacts and return their paths:

```yaml
research_outputs:
  research_report: outputs/research-report.md
  findings_directory: analysis/findings/
  solution_exploration: outputs/solution-exploration.md
  high_level_design: outputs/high-level-design.md
  decision_log: outputs/decision-log.md
```

## Artifacts

```text
planning/research-brief.md
planning/research-plan.md
planning/sources.md
analysis/findings/*.md
analysis/synthesis.md
outputs/research-report.md
outputs/solution-exploration.md       # conditional
outputs/high-level-design.md          # conditional
outputs/decision-log.md               # conditional
```

## Evidence rules

- Browse for current, niche, externally sourced, or explicitly requested facts; use primary official sources for technical behavior.
- Keep direct quotations short and within source limits; paraphrase with precise citations.
- Record source title, URL or repository path, publication/version date when relevant, access date, and which claim it supports.
- Treat absent evidence as unknown, not false. State when a recommendation is an inference.
- Re-gather when sources conflict materially or confidence is too low for the requested decision.

## Recovery limits

- Brief: one clarification attempt.
- Planning and synthesis: two attempts; use a simpler mixed methodology or targeted re-gathering.
- Gathering: three retries for failed categories only; preserve successful work.
- Brainstorming and design: two attempts each, then ask to skip or stop.
- Convergence: one re-presentation per decision area; never fabricate a user choice.
