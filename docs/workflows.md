# Workflow Details

Maister provides six workflow types, each with phases tailored to its needs. All workflows pause between phases for your review and input.

A run started from the cockpit, dispatched into another repository, or started by another run as
a step of its own, has nobody sitting in the session — so it asks nothing there. The pauses
between phases still happen: each one suspends the run and waits for you to answer it from outside. The smaller questions a phase asks along the way
cannot wait like that, so each one takes a stated default instead: a clarification goes unasked
and the analysis stands, an opt-in and a decision take what the phase recommends, a revise-or-accept
loop accepts what it has, and a phase that has run out of recovery attempts fails rather than
guessing. Every default a run takes is written onto that phase's summary, beside its decisions, so
the run's dashboard and its state both show which questions were answered for you and what the
answer was — and the next pause is where you change any of it.

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
generated from it (regenerate that diagram, never edit it). Research and performance run on the
engine by default too. Three further definitions without a command of their own — `plan`, `change`
and `fix`, dispatched into a member by a chain — are a Pro Edition feature (see
[Pro Edition](../README.md#pro-edition)).

Definitions resolve eject → generated → overlay → built-in, and the first hit wins: an eject at
`.maister/workflows/<name>.yml`, then a generated chain at `.maister/workflows/generated/<name>.yml`,
then an overlay at `.maister/workflows/<name>.overlay.yml`, then the shipped built-in. So a project
can eject a shipped graph into its own workspace, or lay an overlay over it, without patching the
plugin. That route reaches a workflow wherever the engine executes it — research, development and
performance today, so ejecting or overlaying `builtin:development` takes effect
on the next run. A generated chain — one the planner published for a single ticket — is complete in itself
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
single workflow — so while it is set, research and performance run on prose too. The phases it
selects are a reference file beside the workflow's skill, not the skill body: `development`'s are
in `skills/development/references/development-twin.md`, and the other two follow the same naming.
On the default path nothing reads them.

The engine records every state change by running its own writer, which is a shell command, and no
permission mode covers the shell — so the plugin's gate hook allows those calls itself rather than
asking you to approve your own workflow several times per phase. It allows only that: a plain
`node` invocation of one of the plugin's two runtimes, at a path it has resolved and found inside
the installed plugin, naming a verb that runtime declares. Anything else — the same command
somewhere else, an unknown verb, a second command chained on the end — is left to your own
permission settings untouched, and while a run is waiting on a decision at a gate nothing is
allowed at all, the writer included.

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
| 4 | Specification audit |
| 5 | Implementation planning |
| 6 | Implementation execution |
| 7 | Verification options |
| 8 | Verification + issue resolution |
| 9 | Finalization |

**Optional profiling data**: You can provide runtime profiling data, flame graphs, or APM screenshots. The workflow creates `analysis/user-profiling-data/` for these files.

### Interpreter

This workflow exists twice as well: as the prose phases in the performance skill, and as a
workflow definition the engine freezes into the task's state and executes. Both interpreters
produce the same task directory.

`/maister:performance` runs the definition — it ships as `builtin:performance`, and resolves
eject → generated → overlay → built-in like every other definition, so a project can eject or
overlay it without patching the plugin.

To run the prose phases instead, set `MAISTER_WORKFLOW_PROSE` to any non-empty value:

```
MAISTER_WORKFLOW_PROSE=1 /maister:performance "..."
```

The variable is the same global switch the Development section describes — it selects the prose
twin for every workflow that has one, not for this workflow alone. This workflow's phases live in
`skills/performance/references/performance-twin.md`.

### Resume

```
/maister:performance [task-path]
```

The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no
mid-graph entry point and no attempt counter: it declines `--from=PHASE` and `--reset-attempts`
by name. Both flags apply in full on the prose phases only — see **Interpreter** above.

Resume phases (prose phases only): `analysis`, `specification`, `planning`, `implementation`, `verification`

---

## Migration

Technology, data, and architecture migrations with rollback planning and risk assessment.

```
/maister:migration
/maister:migration "Migrate from REST to GraphQL" --type=code
```
**Flags**: `--type=code|data|architecture|general`, `--user-docs`, `--sequential`, `--from=PHASE`

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

**Research also runs as a step inside another run.** A chain can name it from a node, and the node
then starts a research run instead of a command doing it: the question comes from the node rather
than from you, the run gets a task directory of its own named after the run that started it, and
the node waits until it ends. What the calling run may read back is what the research definition
declares — its report and its conclusions — and nothing else. A research run started this way
skips the step that exists only to tell an operator the run is over; everything before it is the
same eight phases, gates included. Nothing about it needs setting up on your side, and a research
run you start yourself is unaffected.

### Interpreter

Research runs on the workflow engine by default: the workflow ships as a definition — a graph
of nodes with declared dependencies and guards — which the engine freezes into the task's state
and executes. The same phases also exist as prose beside the workflow's own skill, in
`skills/research/references/research-twin.md`, and both produce the same task directory.

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

Not every workflow type has a command: `plan`, `change` and `fix` are reachable only from a chain,
which dispatches them into a member repository. They are a Pro Edition feature — see
[Pro Edition](../README.md#pro-edition).

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
├── plan/                  # Chain-only plan runs
├── change/                # Chain-only bounded-change runs
└── fix/                   # Chain-only defect-fix runs
```

Each task folder follows the pattern `YYYY-MM-DD-task-name/` and always starts with the same three files:

```
2026-02-17-user-auth/
├── orchestrator-state.yml        # Workflow state (pause/resume, phase tracking)
├── dashboard.html                # Operator dashboard (copied plugin asset)
└── dashboard-data.js             # Dashboard data, written by the engine from the run's state
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
| **change** | `implementation/` (work log), `verification/` (verification report) |
| **fix** | `implementation/` (reproduction, work log), `verification/` (verification report) |

A run that hands work out to another repository also writes a `dispatch/` directory beside
those, holding one envelope per dispatched node.

A run started by another run is listed here too, because it is nothing special:

| Kind of run | Where its directory goes |
|----------|----------------|
| **started by a command or the cockpit** | `.maister/tasks/<type>/YYYY-MM-DD-task-name/` |
| **started by another run** | `.maister/tasks/<its own type>/<parent's date>-<parent's name>-<node>/` — a **sibling** of the run that started it, under the folder of its own type, **never nested** inside the parent's directory |

The child's state records which run and which node started it, and that link is what ties the two
together — so a child lists, opens, resumes and is driven exactly like any other run, and the
parent finds it again by name after an interruption rather than by searching.

One boundary, for now: nothing re-drives a parent when its child ends. A run you are driving from
the terminal is unaffected, because the child runs in the same session and the parent picks the
child's outcome up in that same turn. A run driven by the cockpit parks once its child finishes and
waits until it is woken.

### Dashboard data

`dashboard-data.js` is a projection of a run's state rather than a document kept beside it. On the
engine path the engine writes it: every state change it commits republishes the file from the state
it has just written, so what the dashboard draws is never older than the state behind it, and
nothing else writes that file. A run with `html_output: false` in `.maister/config.yml` gets no data
file — if one is already on disk it is removed rather than left there to be polled. The prose
phases, which have no single writer to ride along with, still rewrite the file as each phase turns
over.

**Phase icons — the `display` block.** Which icon a viewer draws beside a phase cannot be worked out
from a node id, so a workflow definition may say it. `display` is a top-level key — a sibling of
`nodes:`, not something inside it:

```yaml
display:
  icons:
    intake:                 analysis
    specification:          spec
    specification-approval: spec
    planning:               plan
    implementation:         code
    verification:           verify
    user-docs:              docs
    finalization:           done
```

Each entry maps a node id to one of seven values: `analysis`, `spec`, `plan`, `code`, `verify`,
`docs`, `done`. A gate node conventionally takes the icon of the node it closes, the way
`specification-approval` follows `specification` above. A value outside the seven is refused when
the definition is validated, naming the spelling it did not recognise and the set it admits; an
entry for a node the graph does not declare is a warning only, since an overlay that disables a node
legitimately leaves its hint behind.

The block is cosmetic. It is no part of the graph's identity — correcting a glyph does not move the
definition's hash, so it cannot invalidate a frozen run or a chain built from the same graph — and
it may be omitted entirely: a definition of your own, or an ejected copy of a shipped one, is valid
saying nothing about icons at all, and the viewer falls back to its own default. The shipped
definitions each carry one, and are the worked examples.

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

The normative layout and naming rules ship with the Pro Edition's compatibility register.

## Internal Skills

These skills are machinery: an orchestrator invokes them, and none of them has a command of its
own. Each one declares that in its own frontmatter, which is where this table comes from.

| Skill | What It Does |
|-------|-------------|
| **codebase-analyzer** | Launches parallel exploration subagents sized to the task, then has a reporter subagent merge their findings into one report |
| **docs-manager** | The engine behind `.maister/docs/`: file operations, the standards index, and the project instructions that point at it |
| **implementation-plan-executor** | Runs an implementation plan by handing each task group to an implementer subagent, then records progress and the work log |
| **implementation-verifier** | Delegates verification to specialists -- completeness, test suite, code review, pragmatic review, production readiness, reality check -- and compiles one report. It reports; it never fixes |
| **orchestrator-framework** | Not executable at all: the shared patterns every orchestrator reads for phase execution, state, gates and initialization |
| **workflow-engine** | Runs a workflow definition as a graph -- resolves it, freezes it into the run's state, executes the ready set, and asks or suspends at each gate according to the run's driver |
