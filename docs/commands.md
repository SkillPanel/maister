# Command Reference

## Unified Entry Point

### `/maister:work [input]`

Auto-classifies your task and routes to the appropriate workflow. Accepts:

- **No arguments**: Extracts the task from your current conversation context
- Task description: `/maister:work "Add user profile page"`
- Task folder path: `/maister:work .maister/tasks/new-features/2026-02-17-user-profile` (resumes)
- GitHub issue URL: `/maister:work https://github.com/org/repo/issues/42`

The plugin classifies the task type with confidence scoring, asks for confirmation, then launches the matching orchestrator.

---

## Development

### `/maister:development [description | task-path]`

Starts the unified development workflow (14 adaptive phases) or resumes an existing one. All arguments are optional — when run without a description, the plugin extracts it from your current conversation. Pass an existing task path to resume. Task type (bug/enhancement/feature) is auto-detected from context when `--type` is omitted.

| Flag | Description |
|------|-------------|
| `--type=bug\|enhancement\|feature` | Specify task type (auto-detected if omitted) |
| `--e2e` | Include E2E testing phase |
| `--user-docs` | Generate user documentation phase |
| `--code-review` | Include code review phase |
| `--research=PATH` | Start development informed by a completed research task |
| `--sequential` | Run task groups one at a time instead of in parallel waves |
| `--from=PHASE` | Prose phases only — see below |
| `--reset-attempts` | Prose phases only — see below |

**Runs on the workflow engine.** This workflow ships as a workflow definition — a graph of nodes the engine freezes into the task's state and executes — and that is what `/maister:development` runs. The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no mid-graph entry point to jump to and no attempt counter held in state to reset: it declines both flags by name rather than accepting one it would ignore. Resume an engine run by passing the task path alone.

The prose phases remain, selected by setting `MAISTER_WORKFLOW_PROSE` to any non-empty value, and they do take `--from=PHASE` — so a mid-workflow re-entry is a real route, on that path. The variable is global to every workflow that has a prose twin, research included, for as long as it is set.

**Task directory**: `.maister/tasks/development/`
**Resume phases** (prose only): `analysis`, `gap`, `spec`, `plan`, `implement`, `verify`

---

## Performance

### `/maister:performance [description | task-path]`

Starts performance optimization with static bottleneck analysis (9 phases) or resumes an existing one. Can be run without arguments — the plugin extracts the optimization target from your conversation. Detects N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, and memory leak patterns.

| Flag | Description |
|------|-------------|
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

You can optionally provide profiling data (flame graphs, APM screenshots) — the workflow creates a directory for these.

**Task directory**: `.maister/tasks/performance/`
**Resume phases**: `analysis`, `specification`, `planning`, `implementation`, `verification`

---

## Migration

### `/maister:migration [description | task-path]`

Starts migration workflow (8 phases) with mandatory rollback planning and risk assessment, or resumes an existing one. Can be run without arguments — the plugin extracts migration details from your conversation.

| Flag | Description |
|------|-------------|
| `--type=code\|data\|architecture\|general` | Migration type (affects risk focus) |
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

**Task directory**: `.maister/tasks/migrations/`
**Resume phases**: `analysis`, `target`, `spec`, `plan`, `execute`, `verify`, `docs`

---

## Research

### `/maister:research [question | task-path]`

Starts research workflow (8 phases) with multi-source gathering, synthesis, and optional solution brainstorming, or resumes an existing one. Can be run without arguments — the plugin extracts the research question from your conversation.

| Flag | Description |
|------|-------------|
| `--type=technical\|requirements\|literature\|mixed` | Research methodology type |
| `--brainstorm` | Force brainstorming + design phases |
| `--no-brainstorm` | Skip brainstorming phases |
| `--from=PHASE` | Not taken by either interpreter — see below |
| `--reset-attempts` | Not taken by either interpreter — see below |

**Neither flag applies to research.** Research runs on the workflow engine by default, and the engine resumes by recomputing which nodes are ready from the graph frozen into the task's state: there is no mid-graph entry point to jump to, and no attempt counter held in state to reset. A run on the engine declines both by name rather than accepting one it would ignore. The prose phases, selected by setting `MAISTER_WORKFLOW_PROSE` to any non-empty value, do not implement a phase jump either — they re-enter by artifact presence, skipping each step whose output is already on disk. Resume research by passing the task path alone.

Research output can feed into development: `/maister:development --research=.maister/tasks/research/...`

**Task directory**: `.maister/tasks/research/`
**Resume phases**: `foundation`, `brainstorming-decision`, `brainstorming`, `design`, `outputs`, `verification`, `integration`

---

## Product Design

### `/maister:product-design [description | task-path]`

Starts the interactive product/feature design workflow (9 adaptive phases) or resumes an existing one. Transforms ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Can be run without arguments — the plugin extracts the design brief from your conversation.

| Flag | Description |
|------|-------------|
| `--research=PATH` | Start design informed by a completed research task |
| `--no-visual` | Skip browser-based visual companion (use ASCII mockups only) |
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

Design output can feed directly into development: `/maister:development .maister/tasks/product-design/...`

**Task directory**: `.maister/tasks/product-design/`
**Resume phases**: `context`, `synthesis`, `problem`, `personas`, `alternatives`, `convergence`, `specification`, `prototyping`, `handoff`

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
checks structure and ids, checks the graph is acyclic, resolves references, applies overlays,
checks gate shape, checks every `dir:` against the manifest's member list, checks that every
`dir:` node names a target that can honour a driver, and warns on reserved keys, collecting
findings per stage rather than stopping at the first.

| Flag | Description |
|------|-------------|
| `--root DIR` | The workspace root. Defaults to the current directory |
| `--definition FILE` | A chain file to validate with the workspace (repeatable). None judges the workspace alone |

Errors exit `1` and name the file, node and field; warnings alone exit `0`, so a workspace can carry
advisory findings without being blocked. A freshly scaffolded manifest reports one advisory warning
about a reserved key — expected and harmless. The report lists each definition it judged and marks
the ones that sit in the generated home as generated; the rules are identical either way.

**The driver-capability check is new, and a chain that validated before this release can fail now.**
A node carrying `dir:` hands its work to a session with nobody at the keyboard, so its `uses:` has
to name a `workflow:` target or an orchestrator skill whose own file states the driver-qualified
gate rule; anything else is an error at that node's `uses` path. The report separates two cases: a
target that was read and does not state the rule, and a target this installation holds no file for
at all — the second says so, rather than claiming a target it never opened lacks the rule. The
recoveries are the same three either way: point `uses:` at a `workflow:` or at an orchestrator
skill, install whatever ships the skill it names, or drop the `dir:` and run the step in the
coordinating repository. On a node with no `dir:`, an unresolved `skill:` or `agent:` target still
only warns — the strictness is what dispatch itself requires, not a general tightening.

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

Both `--flag=value` and `--flag value` are accepted. Structured input arrives on standard input as
JSON rather than in an argument, so no quoting has to survive a shell.


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
| *stdin* | Optional overrides, as JSON |

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
| *stdin* | The op's arguments, as JSON |

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
| *stdin* | The message body, as JSON — required, since each type demands fields an empty body could not carry |

**Workspace directory**: `.maister/umbrella/`
**Verbs**: `init`, `validate`, `prune`, `envelope`, `seed`, `ledger`, `outbox`
**Entry point**: `/maister:umbrella init`, `/maister:umbrella validate` and `/maister:umbrella prune`;
the other verbs are run by a workflow's orchestrator and by the cockpit, not by a user.

### `/maister:chain-planner "<task>" [--name STEM] [--root DIR] [--generated] [--force]`

Turns a one-paragraph task description into a chain the workspace has already accepted. It reads the
manifest for the members, their providers and the workspace defaults, decides which nodes exist and
how they depend on one another, drafts the definition together with the prose companion that carries
its inline steps, and proves the draft with the workspace's own validator before publishing anything.
It authors only constructs the grammar actually has — there is no fan-out, routing or loop
construct, and a task that would need one is refused with the shape it would take rather than
written in a spelling that only warns. Run it from inside the workspace; a chain that will not
validate is reported and nothing is written.

| Flag | Description |
|------|-------------|
| `--name STEM` | The file stem to publish under. Derived from the task text when omitted; given explicitly it skips the derivation, not the charset and length checks |
| `--root DIR` | The workspace root. Defaults to the current directory |
| `--generated` | Publish into `.maister/workflows/generated/` — the home of chains authored for one ticket or one run rather than kept for reuse. Ignored by git, resolved by name like any other chain, never overlaid or ejected, and deleted by `/maister:umbrella prune` once the chain's runs have closed |
| `--force` | Publish over files of that stem that already exist in the target home, instead of refusing |

Run with no task text at all, it asks once for the paragraph and then proceeds. That is the only
question it ever asks: every other missing value takes its default, and a default that would be
wrong is a refusal with its recovery rather than a second prompt — which is what lets the planner
run headless.

**What is written**: three files under `<root>/.maister/workflows/` — or under its `generated/`
subdirectory with `--generated` — all of them or none: `<name>.yml`, the definition; `<name>.md`, the
prose companion, one section per inline node; and `<name>.plan.md`, the reasoning a reviewer reads
before starting anything. The stem must be free in both directories and among the built-in
workflow names, since the engine looks a name up across all of them. The report leads with the
definition's path relative to the workspace root, so a chain whose node ran the planner can carry it
onward as a value. Nothing is written under a member directory, nothing outside the framework
directory, and no run is started: the chain is reviewed in the cockpit's *Start a chain* dry-run —
generated chains in their own group — which is where a run begins.

**Examples**:
```bash
/maister:chain-planner "Roll the new auth token format out across the API and both clients"
/maister:chain-planner "Retire the legacy billing endpoint" --name billing-retirement
/maister:chain-planner "Bump the shared logger" --root /work/acme-platform --force
/maister:chain-planner "Apply the ALPHA-42 fix in repo-alpha" --name ticket-alpha-42-rollout --generated
```

---

## Quick Commands

Lightweight commands for small tasks that don't need a full orchestrator workflow.

### `/maister:quick-dev [task description]`

Implement a task directly — exactly as the main agent normally would, no planning mode — with standards enforcement. Reads INDEX.md and the specific matched standard files relevant to what you touch, applies them while implementing, and verifies compliance (pass/fail checklist) afterward.

**When to use**: Task is clear, no architectural decisions needed, you know what needs doing.

### `/maister:quick-plan [task description]`

Works exactly like Claude Code's built-in plan mode, with standards enforcement folded in. While planning, it reads INDEX.md and the specific matched standard files (INDEX.md alone is not enough), and the plan must reference the applicable standards and include a Standards Compliance Checklist (verified after implementation) before exiting plan mode.

This command is for planning you drive yourself; scoped plan work that a chain dispatches into another repository goes to the chain-only `plan` workflow instead (see [Workflow Details](workflows.md)).

### `/maister:quick-bugfix [bug description]`

Lightweight TDD-driven bug fix without a full orchestrator workflow. Analyzes the bug, writes a failing test, implements the fix, and verifies the test passes.

**When to use**: Simple, isolated bugs where you can quickly identify the root cause. If the bug is too complex (multiple files, unclear root cause, architectural impact), the skill suggests escalating to `/maister:development`.

No task directory created — works directly in your codebase.
