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

**Flags**: `--type=bug|enhancement|feature`, `--e2e`, `--user-docs`, `--code-review`, `--research=PATH`, `--sequential`

### How it runs

This workflow is a workflow definition — a graph of nodes with declared dependencies and guards —
that the workflow engine freezes into the task's state and executes. It needs Node.js 20 or newer;
without it the command stops before creating a task directory and says so.

`/maister:development` runs the definition — it ships as `builtin:development`, with a diagram
generated from it (regenerate that diagram, never edit it). Research, performance and migration
run on the engine by default too. Three further definitions without a command of their own — `plan`, `change`
and `fix`, dispatched into a member by a chain — are a Pro Edition feature (see
[Pro Edition](../README.md#pro-edition)).

Definitions resolve eject → generated → overlay → built-in, and the first hit wins: an eject at
`.maister/workflows/<name>.yml`, then a generated chain at `.maister/workflows/generated/<name>.yml`,
then an overlay at `.maister/workflows/<name>.overlay.yml`, then the shipped built-in. So a project
can eject a shipped graph into its own workspace, or lay an overlay over it, without patching the
plugin. That route reaches a workflow wherever the engine executes it — research, development,
performance and migration today, so ejecting or overlaying `builtin:development` takes effect
on the next run. A generated chain — one the planner published for a single ticket — is complete in itself
and is never overlaid or ejected; it is resolved by name like any other and deleted by the
workspace's `prune` command once its runs have closed. Writing a chain of your own, naming your
own skills and agents from its nodes, and what an overlay may change are covered in
[Extending maister](extending.md).

The engine records every state change in two steps. It writes the change to one fixed file in the
task directory, `.state-patch.json`, then runs its own writer, a shell command, which reads that
file and deletes it. Where the plugin's gate hook is installed, it allows both steps itself rather
than asking you to approve your own workflow several times per phase. It allows only that: the file
at that one name inside a task directory, and a plain `node` invocation of one of the plugin's two
runtimes, at a path it has resolved and found inside the installed plugin, naming a verb that
runtime declares. Anything else — the same command somewhere else, an unknown verb, a second command
chained on the end — is left to your own permission settings untouched, and while a run is waiting
on a decision at a gate nothing is allowed at all, the writer included. Without the hook, your own
permission settings decide. An allow rule for the plugin's engine script and an edit rule for
`**/.state-patch.json` (or accepting edits for the session) spare you those prompts.

The engine resumes by recomputing which nodes are ready from the frozen state, so there is no
mid-graph entry point to start from. A run declines `--from=PHASE` and `--reset-attempts` by name
rather than accepting a flag it would silently ignore. The one way back inside a run is a gate's
revise option ([Sending a run back from a gate](#sending-a-run-back-from-a-gate)). Re-entering a
run partway at a node of your choosing is planned for the engine; until then, a run that needs it
is one to finish on the 2.x line (see [Staying on 2.x](../README.md#staying-on-2x)).

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
```

Pass the task path to resume: the engine recomputes which nodes are ready from the frozen graph,
and declines `--from=PHASE` and `--reset-attempts` by name. A task directory started on the 2.x
plugin is not resumed — see [Task directories from 2.x](#task-directories-from-2x).

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

### How it runs

This workflow is a workflow definition the engine freezes into the task's state and executes.
Like development, it needs Node.js 20 or newer.

`/maister:performance` runs the definition — it ships as `builtin:performance`, and resolves
eject → generated → overlay → built-in like every other definition, so a project can eject or
overlay it without patching the plugin.

### Resume

```
/maister:performance [task-path]
```

The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no
mid-graph entry point and no attempt counter: it declines `--from=PHASE` and `--reset-attempts`
by name. A task directory started on the 2.x plugin is not resumed — see
[Task directories from 2.x](#task-directories-from-2x).

---

## Migration

Technology, data, and architecture migrations with rollback planning and risk assessment.

```
/maister:migration
/maister:migration "Migrate from REST to GraphQL" --type=code
```
**Flags**: `--type=code|data|architecture|general`, `--user-docs`, `--sequential`

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

### How it runs

This workflow is a workflow definition the engine freezes into the task's state and executes.
Like development, it needs Node.js 20 or newer.

`/maister:migration` runs the definition — it ships as `builtin:migration`, and resolves
eject → generated → overlay → built-in like every other definition, so a project can eject or
overlay it without patching the plugin.

### Resume

```
/maister:migration [task-path]
```

The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no
mid-graph entry point and no attempt counter: it declines `--from=PHASE` and `--reset-attempts`
by name. A task directory started on the 2.x plugin is not resumed — see
[Task directories from 2.x](#task-directories-from-2x).

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

### How it runs

Research runs on the workflow engine: the workflow ships as a definition — a graph of nodes with
declared dependencies and guards — which the engine freezes into the task's state and executes.
Like the other engine workflows, it needs Node.js 20 or newer.

### Phases

| # | Phase |
|---|-------|
| 1 | Research foundation: initialize → plan methodology → gather information (parallel) → synthesize findings |
| 2 | Brainstorming decision (evaluate value) |
| 3 | Solution brainstorming (HMW questions, evidence-driven) |
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

Resume takes no phase flag. The engine recomputes which nodes are ready from the frozen graph, so
there is no phase to enter from and no attempt counter to clear: `--from=PHASE` and
`--reset-attempts` are declined by name rather than quietly ignored. A task directory started on
the 2.x plugin is not resumed — see [Task directories from 2.x](#task-directories-from-2x).

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

### How it runs

Product design does not run on the workflow engine. It has no workflow definition: it runs
in-session as its own orchestrator skill, the one workflow in 3.0 that does — development,
performance, migration and research run on the engine. Its flags apply in full, `--from=PHASE`
and `--reset-attempts` included, and its task directory is resumed by the same skill that
started it. An engine definition is planned for a later 3.x release; adding it is not a breaking
change.

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

## Sending a run back from a gate

Some approval gates offer a third answer beside continue and stop: **revise**. It sends the run
back to the phase that wrote the document you are approving, with a note saying what to change.
That phase runs again over its own output, everything between it and the gate runs again after
it, and the gate asks you once more.

| Workflow | Gates that offer a revise | Re-runs |
|---|---|---|
| Development | gap analysis, specification, specification audit, plan | gap analysis; the specification (from both of its gates); planning |
| Research | research foundation, design | the research foundation; the high-level design |
| Performance | bottleneck analysis, specification, specification audit, plan | the bottleneck analysis; the specification; planning |
| Migration | gap analysis, specification, plan | the gap analysis; the specification; planning |

Gates whose phase already has its own review loop — UI mockups, verification and issue resolution —
keep that loop instead.

- **The note is chosen, not typed.** After you pick revise, the gate offers up to four suggested
  changes drawn from what the phase found — its open risks and its decisions — with one
  recommended. Pick any of them; typing your own is there too, for anything the suggestions miss.
- **Three revisions per gate.** The option says which revision it would be, and after the third
  the gate offers only continue and stop. A revise from a later gate that re-runs an earlier gate's
  phase counts against that earlier gate too, because it asks you again.
- **What you see.** The dashboard tags each re-run phase with its attempt, and the gate keeps every
  revise with its note, so the run's record says why each phase ran more than once. A resumed run
  picks up a revise where it stopped.

A revise is an in-run answer. It does not reopen a run that has finished; to change finished work,
start a new task.

## Your Own Workflows

A workflow your project defines, as `.maister/workflows/<name>.yml` with its prose in
`<name>.md`, runs on the same engine as the built-ins. Writing one is covered in
[Extending maister](extending.md).

| To | Type |
|----|------|
| Start it | `/maister:run <name> [key=value ...]` |
| Resume it | `/maister:run <task-path>` or `/maister:work <task-path>` |
| See what the project defines | `/maister:run --list` |
| Check it without starting it | `/maister:run <name> --check` |

`/maister:work` offers one of these workflows when your task description matches what it is for.

`/maister:run` works in a few steps:
1. It looks the name up in `.maister/workflows/`, then in `generated/`, then as an overlay over a
   built-in, then as a built-in. This means it can also start a built-in, with a `--profile` of
   your choosing.
2. It validates the definition.
3. It asks for any required input you did not give.
4. It hands the run to the engine. The run then has the same dashboard, gates and resume as a
   built-in.

`/maister:run` will not start a *chain*, meaning a definition whose nodes dispatch into member
repositories — including one an overlay adds. Chains are started from maister cockpit.

---

## Task directories from 2.x

A task started on the 2.x plugin is finished on 2.x. Its `orchestrator-state.yml` has no
`workflow:` block — the frozen graph every 3.0 run records — so there is nothing for the engine to
resume. `/maister:work`, `/maister:run` and each workflow's own command, given such a directory,
refuse it with a message that says so and change nothing in it. Its artifacts stay readable in
place, and it is still listed and shown like any other task directory; only resuming it is
refused. Product-design directories are the exception: that workflow still runs as its own
orchestrator and resumes its own directories.

To finish a 2.x task, install the 2.x line as the README's
[Staying on 2.x](../README.md#staying-on-2x) section describes, and resume it there. To start the
work over on 3.0, run the command again without a task path.

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
├── fix/                   # Chain-only defect-fix runs
└── <name>/                # A workflow your project defines, started by name
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
| **started by name** (`/maister:run <name>`) | `.maister/tasks/<name>/YYYY-MM-DD-task-name/` — a workflow's name is its type |
| **started by another run** | `.maister/tasks/<its own type>/<parent's date>-<parent's name>-<node>/` — a **sibling** of the run that started it, under the folder of its own type, **never nested** inside the parent's directory |

The child's state records which run and which node started it, and that link is what ties the two
together — so a child lists, opens, resumes and is driven exactly like any other run, and the
parent finds it again by name after an interruption rather than by searching.

One boundary, for now: nothing re-drives a parent when its child ends. A run you are driving from
the terminal is unaffected, because the child runs in the same session and the parent picks the
child's outcome up in that same turn. A run driven by the cockpit parks once its child finishes and
waits until it is woken.

### Dashboard data

`dashboard-data.js` is a projection of a run's state rather than a document kept beside it. For the
engine's workflows the engine writes it: every state change it commits republishes the file from the state
it has just written, so what the dashboard draws is never older than the state behind it, and no
turn between phases has to remember to rewrite it. A run with `html_output: false` in
`.maister/config.yml` gets no data file — if one is already on disk it is removed rather than left
there to be polled. Product design, which runs as its own orchestrator and has no single writer to
ride along with, still rewrites the file as each phase turns over. The implementation and
verification phases run for hours under a skill rather than under the engine, and they keep the
dashboard live the same way everything else does: by writing state. After each implementation wave
the plan's progress is republished, and after each verification cycle its verdict is, so the engine
remains the file's only writer.

**Phase icons and titles — the `display` block.** Which icon a viewer draws beside a phase, and what
it calls the phase, cannot be worked out from a node id, so a workflow definition may say both. `display` is a top-level key — a sibling of
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
  titles:
    specification-approval: "Approve specification"
    user-docs:              "User documentation"
```

Each entry maps a node id to one of seven values: `analysis`, `spec`, `plan`, `code`, `verify`,
`docs`, `done`. A gate node conventionally takes the icon of the node it closes, the way
`specification-approval` follows `specification` above. A value outside the seven is refused when
the definition is validated, naming the spelling it did not recognise and the set it admits; an
entry for a node the graph does not declare is a warning only, since an overlay that disables a node
legitimately leaves its hint behind.

`titles` maps a node id to the name the dashboard shows for that phase and the gate brief uses in its
`Next:` line — short, one line, sentence case. A node without one is shown as its id made readable:
`gap-analysis` becomes `Gap Analysis`. An empty or multi-line title is refused when the definition is
validated; a title for a node the graph does not declare warns, as a hint does.

`option_labels` maps a gate id, then each of its option ids, to the words the operator picks at
that gate — `"Continue to specification"`, `"Stop here"`. An option without one is shown as its id
in sentence case: `continue-past-analysis` becomes `Continue past analysis`. The answer is still
recorded by option id. `headers` maps a gate id to the short header shown above its question, at
most 12 characters; without one the question takes the title of the node the gate closes when it
fits. An empty value, a multi-line one or an overlong header is refused; a label or a header for a
node that is not a gate, or a label for an option the gate does not offer, warns.

The block is cosmetic. It is no part of the graph's identity — correcting a glyph, a title or a label does not move the
definition's hash, so it cannot invalidate a frozen run or a chain built from the same graph — and
it may be omitted entirely: a definition of your own, or an ejected copy of a shipped one, is valid
saying nothing about icons, titles or labels at all, and the viewer falls back to its own defaults. The shipped
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
| **workflow-engine** | Runs a workflow definition as a graph -- resolves it, freezes it into the run's state, executes the ready set, and asks or suspends at each gate according to the run's driver. Handed its runs by a workflow's own command, or by `/maister:run` for a workflow started by name |
