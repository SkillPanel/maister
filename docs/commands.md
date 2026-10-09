# Command Reference

## Unified Entry Point

### `/maister:work [input]`

Auto-classifies your task and routes to the appropriate workflow. Accepts:

- **No arguments**: Extracts the task from your current conversation context
- Task description: `/maister:work "Add user profile page"`
- Task folder path: `/maister:work .maister/tasks/development/2026-02-17-user-profile` (resumes)
- GitHub issue URL: `/maister:work https://github.com/org/repo/issues/42`

The plugin classifies the task type with confidence scoring, asks for confirmation, then starts the matching workflow.

Workflows your project defines in `.maister/workflows/` are candidates too. When your description
matches one of them, `/maister:work` offers it beside the best built-in match, and the manual
selection lists them after the built-ins. A task folder of a workflow started by name resumes the
same way as any other.

### `/maister:run <name> ["title"] [key=value ...] [--profile=NAME] [--overlay=PATH ...] [--check]`

Starts a workflow by name: one your project defines in `.maister/workflows/<name>.yml`, an eject
or an overlay of a built-in, or a built-in itself. It finds the definition, checks that it
validates, asks for any required input you did not give, and starts the run. From there the run
behaves like any built-in one: the same dashboard, the same gates, and the same way of resuming.

| Argument | Description |
|----------|-------------|
| `<name>` | The workflow's file name without `.yml`, or a built-in's name |
| `"title"` | Free text: the run's title. When the workflow has exactly one required text input you did not give, this fills it too |
| `key=value` | One input the definition declares. Quote a value with spaces: `team="Payments Core"` |
| `--profile=NAME` | A profile one of the run's overlays declares |
| `--overlay=PATH` | An extra overlay laid over the definition, after any `<name>.overlay.yml` found beside it. Repeatable |
| `--check` | Validate the workflow as it would run, overlays and profile included, and start nothing |

**Names are looked up in one order, and the first match wins:**
1. `.maister/workflows/<name>.yml` (your own workflow, or an eject of a built-in);
2. `.maister/workflows/generated/<name>.yml`;
3. `.maister/workflows/<name>.overlay.yml` (laid over the built-in);
4. the built-in.

An overlay beside a definition of its own name is not applied, and the command says so.

**The run's folder is the workflow's name**: `.maister/tasks/<name>/YYYY-MM-DD-<title>/`.

**Resume** with `/maister:run <task-path>` (the folder name alone also works) or with
`/maister:work <task-path>`. The run continues from the graph it started with. An overlay or
profile edited since then does not change it.

**List** your project's workflows with `/maister:run --list`. With no argument at all, it lists
them and asks which to start.

**Check** a workflow with `/maister:run <name> --check`, adding `--overlay` and `--profile` as for
a run. It finds and validates the workflow and starts nothing. Each error names the file, the node
and the field, with a one-line fix where the fix is mechanical. The report then lists the
warnings, where each skill and agent was found, and the inputs a start would ask for. Warnings
never block. One worth knowing: `skip-guard-not-pure` names a gate whose guard reads something
the run itself found, rather than something you chose, and which decides more than "go on". Such
a gate is asked whatever its guard reads; guard it on an input or on another gate's answer, or
make it a single plain continue. This is the
check to run while writing a definition or an overlay; the
[workflow definition grammar](../plugins/maister/skills/workflow-engine/references/grammar.md)
covers every key it judges.

**What it will not start:**
- A *chain*, meaning a definition whose nodes dispatch work into member repositories with `dir:`,
  including a `dir:` node an overlay adds. Chains are started from maister cockpit.
- A workflow named `bug-fixes`, `enhancements`, `new-features`, `refactoring` or `mockups`. Those
  task folder names are reserved: nothing lists a run from them, so a run started under one could
  never be found again. Rename the workflow.
- A file whose `name:` differs from its file name.
- A definition that does not validate. The errors name the file, the node and the field.

**Examples**:
```bash
/maister:run onboarding team=payments
/maister:run release-notes "Notes for 4.2" since=v4.1.0
/maister:run research "How should retries back off?" --profile=quick   # a profile .maister/workflows/research.overlay.yml declares
/maister:run .maister/tasks/onboarding/2026-09-30-onboarding-payments
/maister:run --list
/maister:run onboarding --check
```

### `/maister:workflow-author <subcommand> [args]`

Helps you write your own workflow definitions and overlays, and check them before a run. It
writes only under `.maister/workflows/` and never starts, resumes or changes a run. Use
`/maister:run` to run a workflow.

| Subcommand | What it does |
|------------|--------------|
| `new <name>` | Asks what the workflow is for, its inputs, phases, gates, executors and artifacts. Then it writes `<name>.yml` and a `<name>.md` companion with a section for each `direct:` node, and checks both. Ask for a workflow that another workflow can call and it follows the child-capable recipe |
| `overlay <builtin>` | Shows the built-in's nodes first, then writes `<builtin>.overlay.yml`, plus `.overlay.md` when you add `direct:` nodes. An added phase or verifier gets a `before:`, and changed inputs are a `tune` of `with`. When a change needs an eject rather than an overlay, it tells you |
| `check [<name> \| --all]` | The `/maister:run <name> --check` report. On top of it, three checks: a project skill or agent whose file name differs from its `name:` or that sits only under `.github/`, an installed plugin's skill named without its plugin, and an artifact path that leaves the run directory. `--all` checks every workflow and overlay in the project |
| `nodes <builtin>` | The built-in's nodes in order, with needs, guards, values and artifacts. It also lists which nodes can be disabled cleanly and which make good `before:` anchors |
| `preview <name>` | Draws the resolved graph as ASCII: the overlays and profile applied, every guard in words, and nodes that nothing waits for |

`--overlay=PATH` and `--profile=NAME` work with `check` and `preview` as they do with `/maister:run`.

**Examples**:
```bash
/maister:workflow-author new release-notes
/maister:workflow-author overlay development
/maister:workflow-author nodes development
/maister:workflow-author check release-notes
/maister:workflow-author check --all
/maister:workflow-author preview development --profile=quick
```

---

## Development

### `/maister:development [description | task-path]`

Starts the unified development workflow (14 adaptive phases) or resumes an existing one. All arguments are optional — when run without a description, the plugin extracts it from your current conversation. Pass an existing task path to resume. Whether the task fixes a reproducible bug is detected by the analysis, which adds the failing-test-first phases when it does.

| Flag | Description |
|------|-------------|
| `--audit` / `--no-audit` | Recommend running or skipping the specification audit; the specification checkpoint still asks, with one continue for each |
| `--e2e` / `--no-e2e` | Recommend running or skipping the E2E browser checks; the verification checkpoint still asks, with one continue for each |
| `--user-docs` / `--no-user-docs` | Generate or skip user documentation without being asked (asked if omitted) |
| `--research=PATH` | Start development informed by a completed research task |
| `--design=PATH` | Start development from a completed product-design task: its brief and mockups become the design context |
| `--architecture=PATH` | Build within a high-level design — a design document, or a research task that wrote one: its interfaces, contracts and decisions constrain the specification and the plan |
| `--sequential` | Run task groups one at a time instead of in parallel waves |
| `--from=PHASE` | Declined by name — see below |
| `--reset-attempts` | Declined by name — see below |

**Runs on the workflow engine.** This workflow ships as a workflow definition — a graph of nodes the engine freezes into the task's state and executes — and that is what `/maister:development` runs. The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no mid-graph entry point to jump to and no attempt counter held in state to reset: it declines both flags by name rather than accepting one it would ignore. Resume a run by passing the task path alone; a task directory started on the 2.x plugin is refused with a message that says where to finish it.

**Task directory**: `.maister/tasks/development/`

---

## Performance

### `/maister:performance [description | task-path]`

Starts performance optimization with static bottleneck analysis (9 phases) or resumes an existing one. Can be run without arguments — the plugin extracts the optimization target from your conversation. Detects N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, and memory leak patterns.

| Flag | Description |
|------|-------------|
| `--sequential` | Run task groups one at a time instead of in parallel waves |
| `--from=PHASE` | Declined by name — see below |
| `--reset-attempts` | Declined by name — see below |

You can optionally provide profiling data (flame graphs, APM screenshots) — the workflow creates a directory for these.

**Runs on the workflow engine.** This workflow ships as a workflow definition — a graph of nodes the engine freezes into the task's state and executes — and that is what `/maister:performance` runs. The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no mid-graph entry point to jump to and no attempt counter held in state to reset: it declines both flags by name rather than accepting one it would ignore. Resume a run by passing the task path alone; a task directory started on the 2.x plugin is refused with a message that says where to finish it.

**Task directory**: `.maister/tasks/performance/`

---

## Migration

### `/maister:migration [description | task-path]`

Starts migration workflow (8 phases) with mandatory rollback planning and risk assessment, or resumes an existing one. Can be run without arguments — the plugin extracts migration details from your conversation.

| Flag | Description |
|------|-------------|
| `--type=code\|data\|architecture\|general` | Migration type (affects risk focus) |
| `--user-docs` | Generate the migration guide in the documentation phase |
| `--sequential` | Run one task group at a time during execution |
| `--from=PHASE` | Declined by name — see below |
| `--reset-attempts` | Declined by name — see below |

**Runs on the workflow engine.** This workflow ships as a workflow definition — a graph of nodes the engine freezes into the task's state and executes — and that is what `/maister:migration` runs. The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no mid-graph entry point to jump to and no attempt counter held in state to reset: it declines both flags by name rather than accepting one it would ignore. Resume a run by passing the task path alone; a task directory started on the 2.x plugin is refused with a message that says where to finish it.

**Task directory**: `.maister/tasks/migrations/`

---

## Research

### `/maister:research [question | task-path]`

Starts research workflow with multi-source gathering, synthesis, and optional solution brainstorming and high-level design, or resumes an existing one. Can be run without arguments — the plugin extracts the research question from your conversation.

| Flag | Description |
|------|-------------|
| `--type=technical\|requirements\|literature\|mixed` | Research methodology type |
| `--brainstorm` / `--no-brainstorm` | Recommend going on to solution brainstorming, or past it, at the checkpoint after the research (still asked) |
| `--design` / `--no-design` | Recommend going on to the high-level design, or finishing without one, at the checkpoint that decides it (still asked) |
| `--from=PHASE` | Declined by name — see below |
| `--reset-attempts` | Declined by name — see below |

**Neither flag applies to research.** Research runs on the workflow engine, and the engine resumes by recomputing which nodes are ready from the graph frozen into the task's state: there is no mid-graph entry point to jump to, and no attempt counter held in state to reset. A run on the engine declines both by name rather than accepting one it would ignore. Resume research by passing the task path alone; a task directory started on the 2.x plugin is refused with a message that says where to finish it.

Research output can feed into development: `/maister:development --research=.maister/tasks/research/...`

A research run can also be started by another run rather than by this command — a chain names the
workflow from one of its nodes, supplies the question, and waits for the report and conclusions the
research definition declares. A chain that wants the findings alone says so, and the checkpoint
after the research then offers continue, revise or stop, with no brainstorming or design. Such a
run is named after the run that started it,
`.maister/tasks/research/<parent's date>-<parent's name>-<node>/`, and is otherwise an ordinary
research run: same phases, same gates, listed and resumed the same way. The run that started it is
not yet re-driven automatically when the research ends — under the cockpit the parent waits until it
is woken, while in the terminal the research runs in the same session and the parent carries on.

**Task directory**: `.maister/tasks/research/`

---

## Product Design

### `/maister:product-design [description | task-path]`

Starts the interactive product/feature design workflow (ten phases and five checkpoints, of which `--simple` keeps the problem and specification checkpoints and skips the personas, the brainstorm and, unless asked for, the prototypes) or resumes an existing one. Transforms ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Can be run without arguments — the plugin extracts the design brief from your conversation.

| Flag | Description |
|------|-------------|
| `--research=PATH` | Start design informed by a completed research task |
| `--no-visual` | Skip browser-based visual companion (use ASCII mockups only) |
| `--simple` | Short design: two checkpoints (problem, specification), no personas, no brainstorm of alternatives, prototypes only when asked for |
| `--full` | Full design whatever the detected complexity: personas drafted and every phase at its deepest |
| `--from=PHASE` | Declined by name — see below |
| `--reset-attempts` | Declined by name — see below |

**Neither resume flag applies to product design.** Product design runs on the workflow engine, and the engine resumes by recomputing which nodes are ready from the graph frozen into the task's state: there is no mid-graph entry point to jump to, and no attempt counter held in state to reset. A run on the engine declines both by name rather than accepting one it would ignore. Resume a design by passing the task path alone; a task directory started on the 2.x plugin is refused with a message that says where to finish it.

A run driven from outside the session — from the cockpit, or dispatched — asks none of the questions inside the phases and takes each one's stated default, and its documents say they were drafted without review. It never chooses a design direction itself: the direction pause lists each decision with its recommendation, and that is where you choose.

Design output can feed directly into development: `/maister:development .maister/tasks/product-design/...`, or `--design=PATH` beside a description of your own. The brief ends with the delivery scope — the repositories in scope, in order — also written as `outputs/delivery-scope.yml`.

**Task directory**: `.maister/tasks/product-design/`

### `/maister:mockup-studio "<screen or feature>"`

Generates UI mockups for one screen or feature, on its own rather than as a step inside
another workflow. It finds the project's design language first — standards, design
system, component library, whatever design skills are installed — and binds the mockups
to it by real token and component names, so what you see is what the codebase can
actually build.

Two formats. The default renders HTML and CSS in a browser through a local visual
companion, which is the one worth having for anything visual. Where there is no browser
to open, it falls back to terminal ASCII, which shows layout and placement and nothing
about style.

Between rounds it asks what to change and re-renders, so a screen converges in the
session rather than in a handoff. The development and product-design workflows call the
same command at their mockup step, so a mockup made here and one made inside a workflow
are the same artifact.

**Task directory**: `.maister/tasks/mockups/`

---

## Reviews & Audits

Standalone review commands that can be run anytime, independent of workflows.

### `/maister:reviews-code [path]`

Automated code quality, security, and performance analysis.

| Flag | Description |
|------|-------------|
| `--scope=quality\|security\|performance\|all` | Focus area (default: `all`) |

Analyzes complexity, duplication, code smells, security vulnerabilities, and performance issues. Generates report with severity levels (Critical/Warning/Info).

### `/maister:reviews-pragmatic [path]`

Detects over-engineering and ensures code matches project scale. Identifies excessive abstraction, enterprise patterns in simple code, infrastructure overkill. Recommends specific simplifications with before/after examples.

### `/maister:reviews-reality-check [task-path]`

Validates that completed work actually solves the intended problem. Runs tests, checks end-to-end workflows, and evaluates error scenarios. Returns deployment decision: Ready / Issues Found / Not Ready.

### `/maister:reviews-spec-audit [spec-path]`

Independent specification audit with senior auditor perspective.

| Flag | Description |
|------|-------------|
| `--post-implementation` | Compare spec vs actual implementation (default: pre-implementation) |

Identifies ambiguities, missing details, and gaps. Uses external tools (GitHub CLI, Azure CLI) for verification.

### `/maister:reviews-production-readiness [path]`

Pre-deployment verification across 7 dimensions: configuration, monitoring, error handling, performance, security, deployment, and GO/NO-GO recommendation.

| Flag | Description |
|------|-------------|
| `--target=prod\|staging` | Target environment (default: `prod` with full rigor) |

---

## Standards

### `/maister:init [--standards-from=PATH]`

Initialize the Maister framework. Scans your codebase with a project-analyzer subagent, presents findings for confirmation, then generates:

- `.maister/docs/` with INDEX.md, project docs (vision, roadmap, tech-stack), and coding standards
- `.maister/tasks/` directory structure
- CLAUDE.md integration

| Flag | Description |
|------|-------------|
| `--standards-from=PATH` | Copy standards from another project's `.maister/docs/standards/` instead of built-in defaults. Useful when starting a new project that should follow the same conventions as an existing one. |

If `.maister/` already exists, offers to backup, update, or cancel.

### `/maister:standards-discover [--scope=SCOPE]`

Auto-discovers coding standards from multiple sources in parallel: config files, source code patterns, documentation, pull requests, and CI/CD pipelines.

| Flag | Description |
|------|-------------|
| `--scope=full\|quick\|frontend\|backend\|testing\|custom` | Discovery scope (default: `full`) |
| `--confidence=N` | Minimum confidence threshold, 0-100 (default: `60`) |
| `--auto-apply` | Auto-apply standards with 90%+ confidence |
| `--skip-external` | Skip PR and CI/CD analysis |
| `--pr-count=N` | Number of PRs to analyze (default: `10`, max: `20`) |

Presents findings in confidence tiers (high/medium/low) for review before applying.

### `/maister:standards-update [description] [--from=PATH]`

Update or create standards from conversation context or explicit description. When run without arguments, scans your current conversation for standards patterns like "we should always...", "our convention is...", "prefer X over Y" and proposes them as new standards.

| Flag | Description |
|------|-------------|
| `--from=PATH` | Sync standards from another project. Analyzes differences, shows what's missing or changed, and lets you select which standards to import. |

---

## Umbrella

A multi-repository workspace: an umbrella directory whose members are checkouts of separate
repositories, coordinated by a manifest and driven as chains by the cockpit. Two commands turn a
directory into one and judge it. The rest of the workspace runtime is machinery a running chain
uses, documented below for the operator who needs to know what wrote a ledger or an outbox.

### `/maister:umbrella init [--root DIR] [--members-root DIR] [--force]`

Scaffold a workspace: the manifest, the workflow directory with its `generated/` subdirectory, an
empty ledger with its index and log, and the outbox root. The `generated/` subdirectory is the home
of chains the planner publishes for one ticket; it gets an ignore file (`*` and `!.gitignore`) so
ticket-derived text is never committed by default, written only when absent and left alone by a
later `--force`. Members are discovered by a bounded two-level walk, following symlinks, so a
repository checked out inside the workspace is found without being listed by hand. Run it from the
workspace directory and `--root` defaults to it.

| Flag | Description |
|------|-------------|
| `--root DIR` | The workspace root. Defaults to the current directory |
| `--members-root DIR` | Where member checkouts live, when it is not the workspace root itself. Must be inside the workspace |
| `--scaffold` | Additionally create a knowledge README and a root guidance stub where neither exists — never overwriting one |
| `--force` | Replace an existing manifest instead of refusing |

Without `--scaffold`, `init` writes nothing outside the framework directory, and every target it
declines to write is named with a reason. A second `init` over an existing manifest refuses unless
`--force` is given; the ledger and the outbox are never touched either way.

**Examples**:
```bash
/maister:umbrella init
/maister:umbrella init --root /work/acme-platform --members-root repos
/maister:umbrella init --force
```

### `/maister:umbrella validate [--root DIR] [--definition FILE ...]`

Judge the workspace, and any chain files named with it. Deterministic and model-free: it parses,
checks structure and ids, checks the graph is acyclic, resolves references, checks gate shape,
checks every `dir:` against the manifest's member list, checks that every `dir:` node names a
target that can honour a driver, and warns on reserved keys, collecting findings per stage rather
than stopping at the first. It needs the workspace manifest, and it judges each definition as
written: no overlay or profile is applied. To check a workflow in a single project, or with its
overlays, use `/maister:run <name> --check`.

| Flag | Description |
|------|-------------|
| `--root DIR` | The workspace root. Defaults to the current directory |
| `--definition FILE` | A chain file to validate with the workspace (repeatable). None judges the workspace alone |

Errors exit `1` and name the file, node and field; warnings alone exit `0`, so a workspace can carry
advisory findings without being blocked. A freshly scaffolded manifest reports no findings at all.
The `auto-low` autonomy tier is no longer offered: wherever it is still set — on a member, in
`defaults`, or in a chain node's `with:` — `validate` warns `auto-low-retired`, keeps the value as
written and blocks nothing. Move to `attended`, `auto-medium` or `auto-high` when you choose.
The report lists each definition it judged and marks
the ones that sit in the generated home as generated; the rules are identical either way.

**A `dir:` node must name a target that can run unattended.**
A node carrying `dir:` hands its work to a session with nobody at the keyboard, so its `uses:` has
to name a `workflow:` target or an orchestrator skill that declares `driver_aware: true` in its
frontmatter (the plugin's own orchestrators state the driver-qualified gate rule in their body
instead, and both forms count); anything else is an error at that node's `uses` path. The report
separates two cases: a target that was read and declares neither, and a target no searched place
holds a file for at all — the second says so, rather than claiming a target it never opened lacks
the declaration. The recoveries are the same three either way: point `uses:` at a `workflow:` or at
a driver-aware skill, install whatever ships the skill it names, or drop the `dir:` and run the step
in the coordinating repository. On a node with no `dir:`, an unresolved `skill:` or `agent:` target
still only warns — the strictness is what dispatch itself requires, not a general tightening.

**One branch per run and member.** A dispatch works in a worktree and on a branch named for the
run and the member, so every node a run dispatches into one member continues the same branch and
the same pull request. Two such nodes must therefore be ordered by `needs`, directly or through a
node between them; two that are not are an error at the later node's `dir` path, and the fix is
to add one to the other's `needs`. The manifest's `branch_convention` may name `{run_id}` and
`{member}` but not `{node}` or `{dispatch_id}`. A manifest scaffolded by an earlier version still
says `feature/{run_id}-{node}`: `validate` names it, and the fix is to edit it to
`feature/{run_id}-{member}`.

**Targets are looked for in the workspace first.** A `skill:` or `agent:` name is resolved against
the workspace's own `.claude/` and `.github/` trees, then your own under `~/.claude/` and
`~/.copilot/`, then the plugin, then every installed plugin; `skill:<plugin>:<name>` names one
plugin explicitly. The report's `resolved` list says, per node, which of the four places answered
and which file it found. [Extending maister](extending.md)
covers the order and the namespacing in full.

**Examples**:
```bash
/maister:umbrella validate
/maister:umbrella validate --definition .maister/workflows/rollout.yml
```

### `/maister:umbrella prune [--root DIR] [--name STEM] [--dry-run]`

Delete the generated chains whose runs have all closed. A generated chain is one the planner
published with `--generated`: authored for one ticket, carrying that ticket's text, living in
`.maister/workflows/generated/` rather than beside the reusable chains. Deleting it once its runs
close is safe by construction — a run freezes the resolved graph into its state before the first
node executes, and the only later read of the definition happens while a node is dispatched, proved
against the frozen hash; a run whose status is terminal and whose gate marker is clear dispatches
nothing again.

| Flag | Description |
|------|-------------|
| `--root DIR` | The workspace root. Defaults to the current directory |
| `--name STEM` | Prune this one chain. Refused if a run that has not closed names it |
| `--dry-run` | Report every decision and delete nothing |

Without `--name`, a chain is deleted when at least one run named it and every such run has closed;
a chain no run ever named is kept and reported as `never-started`, because the moment between
publishing and starting is exactly when a sweep would otherwise delete it — name its stem to remove
it deliberately. A chain an open run names is kept and reported as `run-open`. Only the generated
home is ever touched: a reusable chain at the top of `.maister/workflows/` is never a candidate,
whatever `--name` says. The cockpit calls the same command after a run closes, so there is one
deletion rule.

**Examples**:
```bash
/maister:umbrella prune --dry-run
/maister:umbrella prune --name ticket-alpha-42-rollout
```

All three commands report in plain language: what was found and written, what passed, or what was
deleted and what was kept, and each refusal by name with the move that clears it. No other verb is
reachable from the command —
`envelope`, `seed`, `ledger` and `outbox` are the machinery described next, and asking for one
gets you pointed here.

### The workspace runtime

Every verb, the two above included, runs through one workspace runtime that the commands, a
workflow's orchestrator and the cockpit daemon share. It is not something a user types: the two
commands above are the user surface, and the runtime's other verbs are listed here so the reports
and refusals they print are recognisable when a chain or the cockpit shows them. Node 20 or newer,
no dependencies to install. The verbs are the sanctioned way anything touches a workspace's files —
never an editor.

Each verb prints a JSON report. Exit `0` means the verb was accepted, exit `1` means it was
rejected with a named code and **nothing was published**, and exit `2` means the runtime itself did
not start. Every write commits through a temp file and a rename, so a rejected verb leaves the
files on disk byte-for-byte what they were.

Both `--flag=value` and `--flag value` are accepted. Structured input is JSON, never an argument,
so no quoting has to survive a shell. A caller writes it to `.umbrella-input.json` in the one place
the verb reads it from and names that file with `--input-file`: the dispatch's own outbox directory
for `outbox`, and the run's `dispatch/` directory for `envelope` and `ledger`. No two callers
working at once share a place. The file is deleted once the verb accepts it and kept when the verb
rejects it. Standard input still works for scripts.


**`envelope`** — build and publish one node's dispatch envelope, the contract between the run
and the worker who picks it up. It is built from the definition rather than from state: the
definition the run froze is re-resolved, the graph hash recomputed, and a mismatch refused
rather than dispatching work the run never planned. Provider and autonomy resolve node →
member → workspace default, and refuse at the end of that chain instead of acquiring a default
nobody chose.

| Flag | Description |
|------|-------------|
| `--run=PATH` | The run directory whose state froze the graph (required) |
| `--node=ID` | The node being dispatched (required) |
| `--ledger=PATH` | The ledger the dispatch is recorded in (required) |
| `--root=PATH` | The workspace root, consulted for the member, provider and autonomy tier (required) |
| `--input-file=PATH` | Optional overrides, as JSON, in `<run>/dispatch/.umbrella-input.json` — or on stdin |

**`seed`** — render the worker's prompt for a published envelope. A pure function of the
envelope: same envelope, same prompt, every time. The prompt carries a fixed set of sections in
a fixed order, stays within a line cap, and is refused rather than truncated if it would run
past it — a truncated prompt silently loses the close-out contract at the bottom.

| Flag | Description |
|------|-------------|
| `--envelope=PATH` | The published envelope to render (required) |
| `--siblings=N` | How many workers are running in this wave, so the prompt can say the worker has peers. A count, never a list: naming a sibling would name a repository the worker must not touch |

**`ledger`** — run one ledger op. The ops are `create-entry`, `claim`, `update-status`,
`add-constraint`, `add-followup`, `close-out` and the read-only `query`. Each one reads,
mutates, writes atomically, regenerates the index and appends exactly one log line after the
rename. Ids are allocated under a lock and never reused. `ledger-locked` is the one refusal
whose recovery is to re-issue the same op.

| Flag | Description |
|------|-------------|
| `--ledger=PATH` | The ledger directory (required) |
| `--op=NAME` | The op to run (required) |
| `--actor=NAME` | Who is performing it (required) |
| `--dispatch-id=ID` | The entry to act on — required by every op except `create-entry`, which allocates its own |
| `--run=PATH` | The calling run, which places the input file. Given only with `--input-file` |
| `--input-file=PATH` | The op's arguments, as JSON, in the calling run's `dispatch/.umbrella-input.json` — or on stdin |

**`outbox`** — append one message to a dispatch's outbox, the channel results come back on.
Messages are `status`, `followup`, `artifact`, `blocked` and `closeout`; they are written
append-only as numbered files and are never rewritten. When the outbox cannot be written,
`closeout` and `followup` degrade onto a printed result line as the last line of output — the
other three refuse, because a lost status is not a lost result.

| Flag | Description |
|------|-------------|
| `--outbox=PATH` | The outbox root (required) |
| `--dispatch-id=ID` | The dispatch the message belongs to (required) |
| `--type=NAME` | The message type (required) |
| `--input-file=PATH` | The message body, as JSON, in `<outbox>/<dispatch id>/.umbrella-input.json` — or on stdin. Required either way, since each type demands fields an empty body could not carry |

**Workspace directory**: `.maister/umbrella/`
**Verbs**: `init`, `validate`, `prune`, `envelope`, `seed`, `ledger`, `outbox`
**Entry point**: `/maister:umbrella init`, `/maister:umbrella validate` and `/maister:umbrella prune`;
the other verbs are run by a workflow's orchestrator and by the cockpit, not by a user.

## Quick Commands

Lightweight commands for small tasks that don't need a full orchestrator workflow.

### `/maister:quick-dev [task description]`

Implement a task directly — exactly as the main agent normally would, no planning mode — with standards enforcement. Reads INDEX.md and the specific matched standard files relevant to what you touch, applies them while implementing, and verifies compliance (pass/fail checklist) afterward.

**When to use**: Task is clear, no architectural decisions needed, you know what needs doing.

### `/maister:quick-plan [task description]`

Works exactly like Claude Code's built-in plan mode, with standards enforcement folded in. While planning, it reads INDEX.md and the specific matched standard files (INDEX.md alone is not enough), and the plan must reference the applicable standards and include a Standards Compliance Checklist (verified after implementation) before exiting plan mode.

### `/maister:quick-bugfix [bug description]`

Lightweight TDD-driven bug fix without a full orchestrator workflow. Analyzes the bug, writes a failing test, implements the fix, and verifies the test passes.

**When to use**: Simple, isolated bugs where you can quickly identify the root cause. If the bug is too complex (multiple files, unclear root cause, architectural impact), the skill suggests escalating to `/maister:development`.

No task directory created — works directly in your codebase.
