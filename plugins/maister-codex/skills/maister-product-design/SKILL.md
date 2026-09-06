---
name: maister-product-design
description: Turn a fuzzy product or feature idea into an approved, development-ready product brief through context synthesis, problem and persona exploration, alternative generation, sequential decision convergence, feature specification, and optional visual prototyping. Use before implementation when user needs, scope, behavior, or experience remain uncertain.
---

# Maister Product Design

Design the complete reachable user experience, not an isolated screen or backend capability. Keep divergent idea generation separate from convergent user decisions.

Read `references/characteristic-detection.md` during initialization and `references/interaction-patterns.md` before interactive exploration, convergence, or refinement. At every user gate, prefer `request_user_input` when available and follow its two-or-three-choice contract; otherwise ask the equivalent concise question in the final response and pause.

## Initialize or resume

Load and follow `$maister-codex:maister-orchestrator-framework`. Its state, timestamp, phase-gate, artifact-summary, dashboard, HTML-companion, recovery, and resume contracts are mandatory.

For a new task, create `.maister/tasks/product-design/YYYY-MM-DD-task-slug/` with `context/`, `analysis/mockups/`, `outputs/`, and `orchestrator-state.yml`. Add `context/README.md` explaining where the user can place source materials. Read `.maister/config.yml`, project documentation and standards, and parse `--research`, `--no-visual`, and `--from=PHASE`.

For a resume, read state and all approved phase artifacts, restore the first incomplete phase unless `--from` was explicitly requested, and preserve prior decisions and refinement history. Mandatory gates require a fresh user response.

State must include the framework fields plus:

```yaml
design_context:
  design_characteristics:
    is_greenfield: false
    is_enhancement: false
    is_ui_focused: false
    is_backend: false
    is_complex: false
    is_simple: false
  complexity_level: standard       # simple | standard | complex
  collected_urls: []
  research_topics: []
  user_files_list: []
  refinement_iterations: {phase_2: 0, phase_3: 0, phase_5: 0, phase_6_sections: {}, phase_7: 0}
  research_reference: {path: null, research_question: null}
orchestrator:
  options:
    html_output: true
    mockup_format: html
    visual_enabled: null
```

Derive `visual_enabled` at initialization: false when `--no-visual` was passed **or** `.maister/config.yml` sets `mockup_format: ascii`; true otherwise. An explicit per-run flag always overrides project configuration.

## Phases

### 0. Initialize and gather context

Interpret the idea and detect greenfield versus enhancement, product versus feature scope, UI versus backend focus, simple/standard/complex depth, affected personas, and whether research is needed. Inventory supplied files, URLs, design artifacts, and requested mini-research topics; import an explicit research task under `context/research-context/` without treating it as user approval of a design.

Present the detected characteristics and ask the user to confirm or correct them. Record scope, context sources, assumptions, and approved characteristics in state. Mandatory gate.

### 1. Context synthesis

For enhancements, load `$maister-codex:maister-codebase-analysis` to map the current user flow, navigation, permissions, components, data lifecycle, business rules, and existing constraints. For all tasks, read supplied context and relevant research; gather only missing facts, using current authoritative sources when external facts are unstable.

Write `analysis/design-context.md` with source inventory, current experience, business and technical constraints, known users, relevant standards and design system, contradictions, assumptions, and open questions. Ask for corrections before continuing. Mandatory gate.

### 2. Problem exploration

Explore one focused question at a time: who has the problem, their current behavior, trigger and frequency, consequence, desired outcome, constraints, failure cases, success measures, and why the problem matters now. Use propose-and-refine rather than a long questionnaire; track revisions.

Write `analysis/problem-statement.md` with problem statement, jobs or outcomes, constraints, non-goals, risks, and measurable success criteria. Determine whether persona exploration adds value: normally run it for greenfield, multi-persona, safety-sensitive, or complex flows; skip it for a well-understood narrow enhancement and record why. Mandatory gate to the recorded next phase.

### 3. User and persona exploration

When active, build evidence-backed persona cards and end-to-end journeys. For each persona include goals, context, capability/permission boundaries, pain points, discovery path, happy path, error/recovery path, and completion signal. Avoid invented demographics or false research claims.

Write `analysis/personas.md`. Confirm coverage and refine once when needed. Skip cleanly when Phase 2 recorded that it adds no value. Mandatory gate.

### 4. Idea generation

Delegate generation to the installed `maister-solution-brainstormer` agent when available so alternatives are not biased by the orchestrator's preferred answer; otherwise generate inline. Generate materially distinct approaches grounded in the problem, context, personas, and project constraints. Include user-flow shape, reachability, reuse opportunities, trade-offs, risks, complexity, and what each approach deliberately excludes.

Write `analysis/alternatives.md`. If no viable alternatives were produced, retry once with adjusted framing; do not silently substitute the orchestrator's first idea. Auto-continue to convergence.

### 5. Idea convergence

Identify independent decision areas in the alternatives. For each area, sequentially present every viable option with evidence, pros, cons, user impact, implementation implications, risks, and a recommendation. If more than three viable options exist, synthesize them into two or three meaningful choice families while retaining the full comparison in prose or the artifact, then ask exactly one focused choice. Later areas may depend on earlier selections; never batch them into one approval.

Record selections, rationale, accepted trade-offs, rejected alternatives, and deferred ideas in `analysis/design-decisions.md`. Allow one targeted refinement cycle when the user rejects the option set. Mandatory direction-approval gate.

### 6. Feature specification

Build `analysis/feature-spec.md` section by section using propose-and-refine. Include:

- goals, non-goals, actors, permissions, entry points, discoverability, and navigation;
- happy, empty, loading, error, validation, cancellation, retry, and recovery states;
- functional rules, content/copy, data inputs and outputs, privacy/security, accessibility, and responsive behavior;
- complete entity lifecycle: create, view, update, delete or intentional omissions, plus every critical touchpoint;
- backend capability, rendered UI, route/navigation access, and authorization for every user operation;
- analytics, observability, rollout, dependencies, acceptance criteria, and unresolved questions.

Detect orphaned displays, orphaned inputs, unreachable components, dead ends, missing persona paths, and backend-only operations that users cannot perform. Confirm each material section and track refinement counts. Mandatory specification gate to visual prototyping or handoff.

### 7. Visual prototyping

Run only for UI-focused work. Load `$maister-codex:maister-mockup-studio` with the task path, approved decisions and spec, full refinement mode, and output `analysis/mockups/`. Pass `format: ascii` when `visual_enabled` is false (from `--no-visual` or `mockup_format: ascii`), otherwise `html`. Discovered design tokens, components, standards, and established interaction patterns are binding.

Prototype every critical screen and state needed to validate the journey, not generic dashboards. Preserve stable screen/component identifiers for downstream development. If HTML/browser rendering fails twice, fall back to ASCII and record it. Mandatory prototype-approval gate. Skip backend-only work with reason.

### 8. Review and handoff

Assemble `outputs/product-brief.md` from approved artifacts without introducing new decisions. Layer it for fast reading: executive summary; problem and users; selected direction and trade-offs; feature and journey specification; visual references; requirements and acceptance criteria; risks, dependencies, deferred scope, and open questions.

Audit the brief for problem-to-feature traceability, persona and journey coverage, reachability, lifecycle completeness, accessibility, feasibility, decision provenance, and consistency with mockups. Present discrepancies for resolution, then request final approval. Mark state complete only after approval.

Handoff with `$maister-codex:maister-development` using the product-design task path. The brief and mockups are binding inputs, but development must still perform codebase analysis, specification, implementation planning, and verification.

## Artifacts

```text
context/README.md
context/research-context/               # conditional
analysis/design-context.md
analysis/codebase-analysis.md            # enhancement work
analysis/problem-statement.md
analysis/personas.md                     # conditional
analysis/alternatives.md
analysis/design-decisions.md
analysis/feature-spec.md
analysis/mockups/                        # conditional
outputs/product-brief.md
```

## Recovery limits

- Phase 0: one clarification cycle.
- Phase 1: two targeted analysis/gathering attempts.
- Phases 2, 3, 5, and 6: one reframe or redraft per unresolved decision/section; never fabricate approval.
- Phase 4: two generation attempts.
- Phase 7: two HTML attempts, then ASCII fallback.
- Phase 8: one reassembly pass from approved artifacts; unresolved contradictions return to the owning phase.
