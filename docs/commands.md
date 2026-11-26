# Command Reference

For people who use Maister and want the exact arguments and flags of a command. Each command is
listed with what it takes and a line on what it does; how a workflow runs step by step is in
[Workflows](workflows.md).

On GitHub Copilot CLI the commands are typed the same way, `/maister:<name>` (see
[Maister on GitHub Copilot CLI](copilot.md)).

## Notes for every workflow command

**Starting without a description.** `/maister:development`, `/maister:performance`,
`/maister:migration`, `/maister:research` and `/maister:product-design` can be run with no
description: the task is taken from your conversation so far.

**Resuming.** Pass the task folder alone, for example
`/maister:development .maister/tasks/development/2026-02-17-user-profile`. The run continues from
where it stopped. A task folder started on the 2.x plugin is not resumed; the message says where to
finish it, and [Upgrading from 2.x](upgrading-from-2x.md) explains why.

<a id="flags-that-are-not-taken"></a>
**Flags that are not taken.** `--from=PHASE` and `--reset-attempts` came from the 2.x plugin. A
3.0 run cannot start in the middle or reset its attempts, so any workflow command that receives
either one names it as not taken and carries on without it. Any other flag a workflow does not
know is named the same way, in one line, and never dropped silently.

---

## Unified entry point

### `/maister:work [input]`

Reads the task, picks the workflow that fits and starts it, or resumes a task folder. Accepts:

| Input | Example |
|-------|---------|
| Task description | `/maister:work "Add user profile page"` |
| Task folder path | `/maister:work .maister/tasks/development/2026-02-17-user-profile` (resumes) |
| Task folder name alone | `/maister:work 2026-02-17-user-profile` (searches every task type) |
| GitHub issue | `#456`, `GH-456` or the issue URL |
| Jira ticket | `PROJ-456` or the ticket URL |
| Azure DevOps work item | `AB#123` or the work item URL |
| No argument | Asks what you want to work on |

When it is confident about the workflow it starts it straight away and says why in one line.
When it is less sure, or the description covers several tasks, it asks once, with its best guess
recommended. Workflows your project defines in `.maister/workflows/` are candidates too: when one
matches, it asks before starting it. A finished or failed task folder gets one question about what
to do next; one in progress resumes without asking.

### `/maister:run <name> ["title"] [key=value ...] [--profile=NAME] [--overlay=PATH ...] [--check]`

Starts a workflow by name: one your project defines in `.maister/workflows/<name>.yml`, an eject
or an overlay of a built-in, or a built-in itself. It finds the definition, checks that it is
valid, asks for any required input you did not give, and starts the run. From there the run
behaves like any built-in one: the same dashboard, the same checkpoints and the same way of
resuming.

| Argument | Description |
|----------|-------------|
| `<name>` | The workflow's file name without `.yml`, or a built-in's name |
| `"title"` | Free text: the run's title. When the workflow has exactly one required text input you did not give, this fills it too |
| `key=value` | One input the definition declares. Quote a value with spaces: `team="Payments Core"`. A key the definition does not declare is refused |
| `--profile=NAME` | A profile one of the run's overlays declares |
| `--overlay=PATH` | An extra overlay laid over the definition, after any `<name>.overlay.yml` found beside it. Repeatable |
| `--check` | Validate the workflow as it would run, overlays and profile included, and start nothing |
| `<task folder>` | In place of a name: resume that run (the folder name alone also works) |
| `--list` | List your project's workflows and start nothing |

**Names are looked up in one order, and the first match wins:**
1. `.maister/workflows/<name>.yml` (your own workflow, or an eject of a built-in);
2. `.maister/workflows/<name>.overlay.yml` (laid over the built-in);
3. the built-in.

An overlay beside a definition of its own name is not applied, and the command says so.

**The run's folder is the workflow's name**: `.maister/tasks/<name>/YYYY-MM-DD-<title>/`.

**Resume** with `/maister:run <task folder>` or `/maister:work <task folder>`. The run continues
from the graph it started with; an overlay or profile edited since then does not change it.

**With no argument**, it lists your project's workflows: with one, it starts it; with several, it
asks which.

**Check** a workflow with `/maister:run <name> --check`, adding `--overlay` and `--profile` as for
a run. It starts nothing. Each error names the file, the step and the field, with a one-line fix
where the fix is mechanical; the report then lists the warnings (which never block), where each
skill and agent was found, and the inputs a start would ask for. What the warnings mean is in
[Extending Maister](extending.md).

**What it will not start:**
- A workflow named `bug-fixes`, `enhancements`, `new-features`, `refactoring` or `mockups`. Those
  task folder names are reserved: nothing lists a run from them, so a run started under one could
  never be found again. Rename the workflow.
- A file whose `name:` differs from its file name.
- A definition that is not valid. The errors name the file, the step and the field.

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
writes only under `.maister/workflows/` and never starts, resumes or changes a run; use
`/maister:run` to run a workflow. With no subcommand it lists your workflows and overlays and the
subcommands. How definitions and overlays work is in [Extending Maister](extending.md).

| Subcommand | What it does |
|------------|--------------|
| `new <name>` | Asks what the workflow is for, its inputs, steps, checkpoints and artifacts, then writes `<name>.yml` and its `<name>.md` companion and checks both |
| `overlay <builtin>` | Shows what the built-in lets an overlay change, then writes `<builtin>.overlay.yml` (plus `.overlay.md` when you add steps of your own). When a change needs an eject rather than an overlay, it tells you |
| `check [<name> \| --all]` | The `/maister:run <name> --check` report, plus checks the validator does not make: the skills and agents a step calls, the prose sections, the HTML pages a step owes and whether the workflow says it changes code. `--all` checks every workflow and overlay in the project, which is worth running after a plugin update |
| `nodes <builtin>` | The built-in's steps in order, with what each needs, its guard, its values and artifacts, which steps can be disabled cleanly and which make good `before:` anchors |
| `preview <name>` | Draws the resolved graph as ASCII: the overlays and profile applied, every guard in words, and steps that nothing waits for |

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

### `/maister:development [description | task-folder]`

Starts the development workflow for a bug fix, an enhancement or a new feature, or resumes one.
The analysis finds whether the task fixes a reproducible bug, and adds the failing-test-first steps
when it does; there is no task-type flag.

| Flag | Description |
|------|-------------|
| `--e2e` / `--no-e2e` | Recommend running or skipping the browser checks; the verification checkpoint is still asked |
| `--user-docs` / `--no-user-docs` | Write or skip user documentation without being asked (asked when omitted) |
| `--research=PATH` | Start from a completed research task |
| `--context=PATH` | A context pack: a file or a directory inside the project, relative to the project root, copied into the task's `analysis/work-context/` as background for every step. A path that cannot be read, or that leads outside the project, is reported and the run continues without it |
| `--design=PATH` | Start from a completed product-design task, or from a quick-design task or its `decision.md`: the brief or the decision, and the mockups of what was chosen, become the design context, and those mockups are binding (see [Mockups](mockups.md)) |
| `--architecture=PATH` | Build within a high-level design, a design document or a research task that wrote one: its interfaces, contracts and decisions constrain the specification and the plan |
| `--sequential` | Run task groups one at a time instead of in parallel waves |
| `--publish` | Approving the plan also publishes: when the run finishes it commits on its own branch, pushes it and opens a pull request, or updates the one already open from that branch |

See [Notes for every workflow command](#notes-for-every-workflow-command) for starting without a
description, resuming and flags that are not taken.

**Task folder**: `.maister/tasks/development/`

---

## Performance

### `/maister:performance [description | task-folder]`

Starts performance optimization with static bottleneck analysis, or resumes one. It looks for
N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O and memory leak patterns, then
specifies, plans, implements and verifies the fix.

| Flag | Description |
|------|-------------|
| `--sequential` | Run task groups one at a time instead of in parallel waves |

The run creates `analysis/user-profiling-data/` in its task folder and asks whether you have
profiling data (flame graphs, APM screenshots, slow-query logs). Files you put there inform the
analysis; an empty folder means static analysis alone.

See [Notes for every workflow command](#notes-for-every-workflow-command).

**Task folder**: `.maister/tasks/performance/`

---

## Migration

### `/maister:migration [description | task-folder]`

Starts a migration with risk assessment and a rollback plan, or resumes one.

| Flag | Description |
|------|-------------|
| `--type=code\|data\|architecture\|general` | Migration type (affects the risk focus) |
| `--user-docs` | Write the migration guide in the documentation step |
| `--sequential` | Run task groups one at a time instead of in parallel waves |

See [Notes for every workflow command](#notes-for-every-workflow-command).

**Task folder**: `.maister/tasks/migrations/`

---

## Research

### `/maister:research [question | task-folder]`

Starts a research run, with multi-source gathering, synthesis, and optional solution
brainstorming and high-level design, or resumes one.

| Flag | Description |
|------|-------------|
| `--type=technical\|requirements\|literature\|mixed` | Research methodology type |
| `--brainstorm` / `--no-brainstorm` | Recommend going on to solution brainstorming, or past it, at the checkpoint after the research (still asked) |
| `--design` / `--no-design` | Recommend going on to the high-level design, or finishing without one, at the checkpoint that decides it (still asked) |
| `--context=PATH` | A context pack: a file or a directory inside the project, relative to the project root, copied into the task's `analysis/work-context/` as background for the brief, the plan and the gathering. A path that cannot be read, or that leads outside the project, is reported and the run continues without it |

Research output can feed into development:
`/maister:development --research=.maister/tasks/research/...`, or
`--architecture=.maister/tasks/research/...` when the research wrote a high-level design.

With HTML pages on, the run also writes `outputs/research-explainer.html`, a one-page explainer of the findings, where every figure is one a source states.

See [Notes for every workflow command](#notes-for-every-workflow-command).

**Task folder**: `.maister/tasks/research/`

---

## Product design

### `/maister:product-design [description | task-folder]`

Starts the product design workflow, or resumes one. It explores the project, proposes the scope,
decides each choice with sketches, and writes a product brief with its final screens. It has three
checkpoints. The first chooses the outcome: a design brief (with screens when there is anything to
see) or a brief with a feature specification; it can also stop in favour of
`/maister:quick-design` when one bounded question is all there is.

| Flag | Description |
|------|-------------|
| `--research=PATH` | Start from a completed research task |
| `--context=PATH` | A context pack: a file or a directory inside the project, relative to the project root, holding source material such as PDFs, images, a spec or extracted text. It is copied into the task's `analysis/work-context/` and read as background by the steps that frame the problem and decide the design. A path that cannot be read, or that leads outside the project, is reported and the run continues without it |

There is no flag for the specification outcome: you choose it at the first checkpoint.

Design output feeds development: `/maister:development .maister/tasks/product-design/...`, or
`--design=PATH` beside a description of your own.

See [Notes for every workflow command](#notes-for-every-workflow-command).

**Task folder**: `.maister/tasks/product-design/`

---

## Mockups

### `/maister:mockup-studio ["<note>"] [flags]`

Draws one new version of a set of UI mockups per call and never asks a question. What a turn is,
the version folder, the gallery and the grounding pack are explained in [Mockups](mockups.md).

| Flag | Description |
|------|-------------|
| `--turn "<note>"` | Draw one version from the note. A bare `/maister:mockup-studio "<note>"` is read the same way |
| `--ground` | Rebuild the grounding pack from scratch, and touch no task folder |
| `--task=<dir>` | Draw the next version in `<dir>/<subdir>/`. On a mockup studio folder (under `.maister/tasks/mockup-studio/`) the turn is a new recorded run; on another workflow's task folder it is drawn there with no run record |
| `--subdir=<rel>` | The folder under the task folder that holds the versions (default `analysis/mockups`) |
| `--against=<vNNN>` | Build on that version instead of the latest |
| `--scope=<slugs>` | Comma-separated screens to change or add; the rest carry over |
| `--fidelity=<sketch\|prototype>` | `sketch` (default) draws static pages; `prototype` also writes a working `prototype.html` whose scenes become the version's screens (HTML only) |
| `--format=<html\|ascii\|scope>` | Overrides `mockup_format` in `.maister/config.yml` for one turn; without either, `html`. `scope` writes a written scope instead of screens, and is never the project default |

Any other flag is named as not taken and the turn runs without it. A call with no note and no
`--ground` draws nothing and shows the command to use. Run from inside a task folder that already
holds versions, `--turn` works as if `--task` named that folder.

The same turn runs as a workflow with `/maister:run mockup-studio`, taking the inputs `note`,
`task_path`, `output_subdir`, `against`, `scope`, `fidelity`, `format`, `brief` and `grounding`.

**Task folder**: `.maister/tasks/mockup-studio/`

---

## Reviews and audits

Standalone review commands you can run at any time, outside a workflow. The three reviews run in
every workflow's verification too.

### `/maister:reviews-spec [task-folder | base]`

Checks that a change obeys its spec, clarifications and recorded decisions: the rules they set
(who may do what, what must never happen, ordering, what a failure must do), then each requirement
and story, the work log's claims against the code and tests, and the docs the change made false.
Needs a task folder with a spec; without one it says so and stops.

### `/maister:reviews-code-risk [task-folder | base]`

What in a change can break, leak or fall over where the project runs: correctness, failure paths,
security and resilience keyed to the project profile, how CI and the build run the change,
operational hygiene, and the standards that govern the change (the ones the task claims and the
ones it judges relevant from `.maister/docs/INDEX.md`).

### `/maister:reviews-simplicity [task-folder | base]`

Complexity the project does not need for its scale: abstraction with one use, infrastructure
beyond its scale, configuration sprawl, indirection and developer friction.

Each of the three reviews the change in a task folder, or the working tree against a base commit
or branch. With no argument it asks once what to review: the uncommitted changes, the latest task,
or this branch against the default branch. It writes its report under the task's `verification/`
folder, or under `.maister/reviews/` without a task, and changes no code.

### `/maister:reviews-spec-audit [spec-path] [--post-implementation]`

An independent audit of a specification for completeness, ambiguity, internal contradictions and
whether it can be built against the current code. With no path it offers the most recently changed
`spec.md` under `.maister/tasks/`. The report goes to the task's `verification/spec-audit.md` and
lists open ambiguities as questions; nothing is modified.

| Flag | Description |
|------|-------------|
| `--post-implementation` | Also compare the spec with what was built. Chosen on its own when an implementation exists next to the spec |

---

## Standards

What standards are and how workflows use them is in [Standards](standards.md).

### `/maister:init [--standards-from=PATH]`

Sets Maister up in a project: analyzes the codebase, confirms the findings with you, writes the
project documents and starter standards under `.maister/docs/`, writes `.maister/config.yml`, adds
the pointer to `.maister/docs/INDEX.md` in `CLAUDE.md`, and ends by running standards discovery.

| Flag | Description |
|------|-------------|
| `--standards-from=PATH` | Copy the starter standards from another project's `.maister/docs/standards/` instead of the built-in set. The other project must already have them |

When `.maister/` already exists, it asks whether to update the setup or start over (the old setup
is moved to `.maister.backup-<date>/`). Leaving without changes is the free-text answer.

### `/maister:standards-discover [flags]`

Finds the standards your code already follows, from configuration files, code, documentation, and
pull requests and CI, and offers them for your approval.

| Flag | Description |
|------|-------------|
| `--scope=SCOPE` | `full` (default), `quick` (configuration files only), a group of the built-in set (`global`, `testing`, `frontend`, `backend`, `data`, `cli`, `mobile`, `jobs`, `infra`), or a folder of your own that exists under `.maister/docs/standards/` |
| `--confidence=N` | Minimum confidence, 0 to 100, for a finding to be offered (default `60`). Findings below it are listed in the summary |
| `--auto-apply` | Apply findings at 90% confidence or more without asking. Conflicts are still asked |
| `--skip-external` | Skip pull request and CI analysis |
| `--pr-count=N` | Number of recent merged pull requests to analyze (default `20`) |

### `/maister:standards-update [description] [--from=PATH] [--built-in] [--refresh-index]`

Records a coding standard, or project knowledge (a decision, a fact about the system) in a project
document.

| Argument or flag | Description |
|------------------|-------------|
| No argument | Proposes conventions from your conversation. In a fresh session with nothing to scan, offers the standard candidates the most recent workflow run left in its task folder |
| `"description"` | The standard or the fact to record, for example `"prefer named exports over default exports"` |
| `"split <path>"` | Proposes splitting a standards file that has grown past its size guidance |
| `--from=PATH` | Import standards from another project's `.maister/docs/standards/`: shows what is new or changed and lets you choose |
| `--built-in` | Bring the built-in rules your setup was made with up to date: each rule the plugin has since rewritten, merged, moved, removed or added. Rules nobody edited are offered together in one question, save those folded into a rule your team edited, which are asked after it; a rule your team edited is asked on its own and never recommended; your own rules are never offered. Nothing is recorded, so a rule you keep is offered again next time. `/maister:init`'s update path offers the same review, with the groups your code calls for |
| `--refresh-index` | Bring `.maister/docs/INDEX.md` back in shape: rewrites the entries that run long or hold dates, ticket references or counts, adds missing entries, removes dead ones and settles a merge conflict. Touches no other document |

Outside `--built-in`, where each built-in rule's place is fixed, it always asks where a standard goes before writing it.

---

## Quick commands

Lightweight commands for small tasks that do not need a full workflow. Each follows the project's
standards; see [Standards](standards.md). Without an argument, each takes the task from your
conversation, and asks only when there is nothing to take.

### `/maister:quick-dev [task description]`

Implements the task directly, with no planning mode, reading the standards that apply to what it
touches, and reports a pass or fail Standards Compliance Checklist at the end.

**When to use**: the task is clear and needs no architectural decisions.

### `/maister:quick-plan [task description]`

Plan mode with the project's standards folded in. The plan names the standards that apply and
includes a Standards Compliance Checklist, which is checked after implementation.

### `/maister:quick-bugfix [bug description]`

A test-driven bug fix: analyzes the bug, presents a fix plan for approval, writes a failing test,
fixes the bug and confirms the test passes. No task folder is created.

**When to use**: a reproducible bug whose cause is likely in a few files. When the bug turns out to
be bigger (several subsystems, an unclear cause, architectural impact), it offers to switch to
`/maister:development` with the analysis so far.

### `/maister:quick-design [design question]`

Settles one small design question in the session: frames it, lays out two to four options per
decision area with pros, cons and a rough cost, recommends one, and asks every decision area in one
question set. When the decision turns on layout or presentation it sketches one mockup per option
with the mockup studio; the same question set lets you ask for mockups or skip them.

Writes `decision.md` under `.maister/tasks/design/YYYY-MM-DD-name/`: about a page with the context,
the options considered, the decision and its reason, consequences, unknowns to check and proposed
pieces of work, with the mockups beside it when they were made.

**When to use**: a bounded design question with at most three decision areas. When it needs
research or has more, it recommends `/maister:product-design` or `/maister:research` instead and
says why.

### `/maister:update-branch [--onto <ref>] [--run <task dir>] [--no-run] [--result <file>]`

Brings the current branch up to date with its default branch. It merges the default branch without
committing, resolves any conflict from the branch's own intent, runs the project's checks and
commits the merge. It never pushes, never stashes and never resets.

When the branch carries an unfinished workflow run, the run's start commit moves past the merged-in
work: to the merged commit for a run started where the branch left the default branch, or to the
merge commit itself for a run started on a commit of the branch's own. The run's next review then
counts only the run's own work, not what the merge brought in. `--run <task dir>` names the run to
move, and `--no-run` updates the branch alone. A run that started on a commit of the branch's own
and has commits of its own since is left as it was, and the command says so: moving its start
commit to the merge would hide those commits from its review, so the review still measures from
its own start.

Pass `--onto <branch>` when the branch was cut from a branch other than the default one, so the
merge brings in that branch instead.

Every call ends by writing one JSON result: the outcome (`merged`,
`merged-with-conflicts-resolved`, `up-to-date`, `refused` or `stopped`), the merge commit, each
conflict and how it was resolved, the check results, and the run's start commit before and after
the move. It goes to `update-branch.json` in the run's task directory, or to the file `--result`
names; its shape is listed in the plugin's `interface.json`.

In a run that is not driven from the terminal, nobody is asked anything. The command accepts its
own conflict resolutions when the run's spec, plan or work log, or the branch's own change, settles
each one. When one is not settled, it stops with the merge still in progress and nothing committed,
and the result names the files left. A caller that drives it names the run with `--run`.

**When to use**: the branch has fallen behind its default branch, or a run on it is about to be
reviewed and the merged-in work should not count as its own. See
[Troubleshooting](troubleshooting.md#the-review-counts-files-the-default-branch-brought-in).
