# Workflow Details

Maister provides six workflow types, each with phases tailored to its needs. All workflows pause between phases for your review and input.

## Development Workflow

The unified development workflow handles features, enhancements, and bug fixes through a 14-phase adaptive pipeline. Phases activate or skip based on task type.

```
/maister:development
/maister:development "Add two-factor authentication"
/maister:development "Fix login timeout" --type=bug
```

When run without arguments, the plugin extracts the task description from your conversation and auto-detects the type (feature, bug, or enhancement). Use `--type=` only when you want to override the auto-detection.

**Flags**: `--type=bug|enhancement|feature`, `--e2e`, `--user-docs`, `--code-review`, `--research=PATH`, `--sequential`; `--from=PHASE` on the prose phases only

### Interpreter

This workflow exists twice: as the prose phases in the development skill, and as a workflow
definition — a graph of nodes with declared dependencies and guards — that the workflow engine
freezes into the task's state and executes. Both interpreters produce the same task directory.

`/maister:development` runs the definition — it ships as `builtin:development`, with a diagram
generated from it (regenerate that diagram, never edit it). Research runs on the engine by
default too, and a third definition ships without a command of its own — the chain-only
`plan` workflow described below, which the engine runs when a chain dispatches it.

Definitions resolve eject → generated → overlay → built-in, and the first hit wins: an eject at
`.maister/workflows/<name>.yml`, then a generated chain at `.maister/workflows/generated/<name>.yml`,
then an overlay at `.maister/workflows/<name>.overlay.yml`, then the shipped built-in. So a project
can eject a shipped graph into its own workspace, or lay an overlay over it, without patching the
plugin. That route reaches a workflow wherever the engine executes it — research, development and
the chain-only `plan` today, so ejecting or overlaying `builtin:development` takes effect on the
next run. A generated chain — one the planner published for a single ticket — is complete in itself
and is never overlaid or ejected; it is resolved by name like any other and deleted by the
workspace's `prune` command once its runs have closed. Writing a chain of your own, naming your
own skills and agents from its nodes, and what an overlay may change are covered in
[Extending maister](extending.md).

`/maister:development` runs on the workflow engine by default. To run its prose phases instead,
set `MAISTER_WORKFLOW_PROSE` to any non-empty value:

```
MAISTER_WORKFLOW_PROSE=1 /maister:development "..."
```

One variable covers every workflow that has a prose twin — its scope is the whole plugin, not a
single workflow — so while it is set, research runs on prose too.

The two resume flags differ by interpreter. The engine resumes by recomputing which nodes are
ready from the frozen state, so there is no mid-graph entry point to start from and no attempt
counter in that state to reset — attempt budgets are node prose. An engine-executed run declines
`--from=PHASE` and `--reset-attempts` by name rather than accepting a flag it would silently
ignore. Development's prose phases do take `--from=PHASE`, so selecting them is the route when
you need to re-enter a run partway.

### Phases

| # | Phase | Applies To |
|---|-------|-----------|
| 1 | Codebase analysis + clarifications | All |
| 2 | Gap analysis with decision gates | All |
| 3 | TDD Red gate (write failing test first) | Bug fixes only |
| 4 | UI mockups (ASCII) | Features & enhancements (UI-heavy) |
| 5 | Requirements + specification | All |
| 6 | Specification audit | All (recommended) |
| 7 | Implementation planning | All |
| 8 | Implementation execution | All |
| 9 | TDD Green gate (verify test passes) | Bug fixes only |
| 10 | Verification options selection | All |
| 11 | Verification + issue resolution | All |
| 12 | E2E testing | Optional (`--e2e`) |
| 13 | User documentation | Optional (`--user-docs`) |
| 14 | Finalization | All |

### Research-Based Development

Start development informed by a completed research workflow. Research context flows through all phases:

```
/maister:development "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
```

Research artifacts are copied to `analysis/research-context/` and summaries pass to every subagent.

### Resume

```
/maister:development [task-path]
MAISTER_WORKFLOW_PROSE=1 /maister:development [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases (prose only): `analysis`, `gap`, `spec`, `plan`, `implement`, `verify`

Pass the task path alone to resume on the engine: it recomputes which nodes are ready from the
frozen graph, and declines `--from=PHASE` and `--reset-attempts` by name. Both flags apply in
full on the prose phases — see **Interpreter** above.

---

## Performance Optimization

Static code analysis to detect bottlenecks, followed by standard spec/plan/implement/verify pipeline.

```
/maister:performance
/maister:performance "Optimize dashboard loading time"
```

### Phases

| # | Phase |
|---|-------|
| 1 | Codebase analysis + clarifications |
| 2 | Static performance analysis (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks) |
| 3 | Requirements + specification |
| 4 | Specification audit (conditional) |
| 5 | Implementation planning |
| 6 | Implementation execution |
| 7 | Verification options |
| 8 | Verification + issue resolution |
| 9 | Finalization |

**Optional profiling data**: You can provide runtime profiling data, flame graphs, or APM screenshots. The workflow creates `analysis/user-profiling-data/` for these files.

### Resume

```
/maister:performance [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `analysis`, `specification`, `planning`, `implementation`, `verification`

---

## Migration

Technology, data, and architecture migrations with rollback planning and risk assessment.

```
/maister:migration
/maister:migration "Migrate from REST to GraphQL" --type=code
```

**Migration types**: `code`, `data`, `architecture`, `general`

### Phases

| # | Phase |
|---|-------|
| 1 | Current state analysis |
| 2 | Target state planning + gap identification |
| 3 | Migration requirements + strategy specification (includes rollback plan) |
| 4 | Implementation planning |
| 5 | Migration execution |
| 6 | Verification + compatibility testing |
| 7 | Issue resolution (conditional, halts on data integrity issues) |
| 8 | Documentation (optional) |

**Key behaviors**:
- Rollback planning is mandatory
- Dual-run support for zero-downtime migrations
- Halts on data integrity issues (no automatic recovery)
- External research for version upgrades via web search

### Resume

```
/maister:migration [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `analysis`, `target`, `spec`, `plan`, `execute`, `verify`, `docs`

---

## Research

Multi-source research with synthesis, optional solution brainstorming, and high-level design.

```
/maister:research
/maister:research "What authentication approach fits our architecture?" --type=technical
```

**Research types**: `technical`, `requirements`, `literature`, `mixed`

**Flags**: `--brainstorm` (force brainstorming phases), `--no-brainstorm` (skip them)

### Interpreter

Research runs on the workflow engine by default: the workflow ships as a definition — a graph
of nodes with declared dependencies and guards — which the engine freezes into the task's state
and executes. The same phases also exist as prose in the workflow's own skill, and both produce
the same task directory.

To run the prose phases instead, set `MAISTER_WORKFLOW_PROSE` to any non-empty value:

```
MAISTER_WORKFLOW_PROSE=1 /maister:research "..."
```

Use it if the machine has no Node runtime (the engine writes state through a script and needs
one), or to get the previous behaviour back in one step. Unset it to return to the default.

A task directory created before the engine carries no frozen graph, and is always resumed by
the prose phases whatever the variable says.

### Phases

| # | Phase |
|---|-------|
| 1 | Research foundation: initialize → plan methodology → gather information (parallel) → synthesize findings |
| 2 | Brainstorming decision (evaluate value) |
| 3 | Solution brainstorming (HMW questions + user preferences) |
| 4 | High-level design (C4 diagrams + ADR documentation) |
| 5 | Review outputs |
| 6 | Verification (optional) |
| 7 | Integration (optional) |
| 8 | Spawn development workflow (optional) |

Information gathering runs parallel subagents across multiple source categories (codebase, docs, config, external).

### Resume

```
/maister:research [task-path]
```

Resume takes no phase flag on either interpreter. The engine recomputes which nodes are ready
from the frozen graph, so there is no phase to enter from and no attempt counter to clear:
`--from=PHASE` and `--reset-attempts` are declined by name rather than quietly ignored. The
prose phases carry no phase flag either — they re-enter by artifact presence, skipping every
phase whose outputs are already on disk, so a plain re-run picks up near where the last one
stopped.

---

## Product Design

Interactive workflow for designing features and products before building them. Transforms ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Phases adapt based on design characteristics (greenfield vs enhancement, simple vs complex, UI-focused vs backend).

```
/maister:product-design
/maister:product-design "Design a dashboard for monitoring API usage"
/maister:product-design --research=.maister/tasks/research/2026-01-12-auth-research
```

When run without arguments, the plugin extracts the design brief from your conversation.

**Flags**: `--research=PATH`, `--no-visual`, `--from=PHASE`

### Phases

| # | Phase | Activation |
|---|-------|------------|
| 0 | Initialize, gather context & detect characteristics | Always |
| 1 | Context synthesis (codebase analysis or mini-research) | Always (scope adapts) |
| 2 | Problem space exploration (interactive, iterative) | Always (depth adapts) |
| 3 | User & persona exploration | Greenfield or complex designs |
| 4 | Design alternatives generation (agent-driven, unbiased) | Always |
| 5 | Converge on design direction (interactive) | Always |
| 6 | Feature specification, section-by-section (interactive) | Always (depth adapts) |
| 7 | Visual prototyping (browser-based companion with ASCII fallback) | UI-focused designs |
| 8 | Review & hand off product brief | Always |

Phases 2, 5, and 6 include iterative refinement loops — you can request revisions before moving on. Phase 4 uses an agent to generate alternatives without anchoring bias.

The output is a structured product brief that can be passed directly to the development workflow:

```
/maister:development .maister/tasks/product-design/2026-03-10-api-dashboard
```

### Resume

```
/maister:product-design [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `context`, `synthesis`, `problem`, `personas`, `alternatives`, `convergence`, `specification`, `prototyping`, `handoff`

---

## Chain-Only Workflows

Not every workflow type has a command. The `plan` workflow is reachable only from a chain: a
node that reads `uses: workflow:plan` with a `dir:` naming a member dispatches a worker into that
repository, and the worker runs the definition there. There is nothing to type, and nothing to
resume by hand.

It exists for scoped work that needs a plan rather than an implementation — the case a chain hits
when a ticket's next step is "decide how", not "build it". Four nodes: discover the project's
standards, write the plan, pause at an approval gate, then hand off. Stopping at the gate ends the
run with the plan as its deliverable; continuing records the plan path and the outcome in the run's
own state. Either way the plan file is written into the member's task directory inside the dispatch's own
worktree. A dispatched run's declared values do not cross back into the chain that dispatched it,
so a follower node must never be guarded on the outcome. How a follower obtains the plan file is
not defined at this version: the run directory is named at run time, and a follower's inputs are
static literals, so nothing shipped routes that path from a dispatched run's artifact into a
follower's input. Today the plan is a deliverable a human, a reviewer or the daemon collects.

Its runs land in `.maister/tasks/plan/<YYYY-MM-DD-slug>/` with the same task root every other
workflow writes — state, dashboard, gate files — so a plan run is visible to the cockpit and its
gate is answerable there like any other. Its one subdirectory is `implementation/`, holding
`plan.md`.

For plan work you drive yourself, use `/maister:quick-plan`.

---

## Task Directory Structure

All workflows create structured directories in `.maister/tasks/`:

```
.maister/tasks/
├── development/           # All development tasks (features, bugs, enhancements)
├── performance/           # Performance optimization
├── migrations/            # Migrations
├── research/              # Research
├── product-design/        # Product design
└── plan/                  # Chain-only plan runs
```

Each task folder follows the pattern `YYYY-MM-DD-task-name/` and always starts with the same three files:

```
2026-02-17-user-auth/
├── orchestrator-state.yml        # Workflow state (pause/resume, phase tracking)
├── dashboard.html                # Operator dashboard (copied plugin asset)
└── dashboard-data.js             # Dashboard data, rewritten after each phase
```

What sits beside them depends on the workflow:

| Workflow | Subdirectories |
|----------|----------------|
| **development** | `analysis/` (codebase analysis, gap analysis, `research-context/`, `design-context/`), `implementation/` (spec, plan, work log), `verification/`, `documentation/` |
| **research** | `planning/` (brief, plan, sources), `analysis/` (`findings/`, synthesis), `outputs/` (report, decision log) |
| **product-design** | `context/` (your input materials), `analysis/` (problem statement, personas, alternatives, feature spec, `mockups/`), `outputs/` (product brief) |
| **performance** | `analysis/` (bottleneck analysis, `user-profiling-data/`), `implementation/`, `verification/` |
| **migration** | `analysis/` (current state, target state, rollback plan), `implementation/`, `verification/`, `documentation/` |
| **plan** | `implementation/` (the plan) |

A run that hands work out to another repository also writes a `dispatch/` directory beside
those, holding one envelope per dispatched node.

### Umbrella workspaces

A workspace whose members are checkouts of separate repositories carries a second tree, beside
the task directories and independent of them:

```
.maister/
├── umbrella.yml                    # The workspace manifest: members, branch convention, defaults
├── workflows/                      # Workflow definitions and overlays this workspace owns
│   └── generated/                  # Chains generated for one ticket: git-ignored, pruned once their runs close
└── umbrella/
    ├── runs/<run-id>/              # One directory per coordinated run
    ├── ledger/
    │   ├── entries/                # One file per dispatch — the unit of visible work
    │   ├── index.yml               # Regenerated whole after every op
    │   └── ledger.log              # Append-only, one line per op, written after the entry
    └── outbox/<dispatch-id>/       # Numbered result messages, append-only, never rewritten
```

The ledger is the answer to "what work is out, who has it, and how did it end". Each entry is
rewritten atomically by one op at a time, the index is derived from the entries rather than
maintained alongside them, and the log records every op in the order it committed — so a
ledger that disagrees with its index is repaired by regenerating the index, never the other
way round.

The outbox is the return channel: a worker appends `status`, `followup`, `artifact`, `blocked`
and `closeout` messages as numbered files, and nothing ever rewrites one. Messages accumulate;
the last word on a dispatch is its close-out, not the state of a file that kept being edited.

The normative layout and naming rules are `plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md § A4`.

## Internal Skills

These skills are invoked automatically by the orchestrators — you don't call them directly:

| Skill | What It Does |
|-------|-------------|
| **codebase-analyzer** | Launches parallel Explore subagents to analyze your codebase, synthesizes findings into a report |
| **implementer** | Executes implementation plans with mandatory standards reading and test-driven enforcement |
| **implementation-plan-executor** | Adaptive execution (direct for ≤5 steps, delegated for 6+) with continuous standards discovery |
| **implementation-verifier** | Delegates verification to specialized subagents: test runner, code reviewer, pragmatic reviewer, reality assessor, production readiness checker |
| **task-classifier** | Classifies task descriptions into types (bug, feature, enhancement, performance, migration, research) with confidence scoring |
| **docs-manager** | Internal engine for managing `.maister/docs/` structure, INDEX.md, and standards files |
