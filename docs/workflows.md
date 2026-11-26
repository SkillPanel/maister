# Workflows

For people choosing and running one of Maister's six built-in workflows: when to use each, its
steps and checkpoints, what it leaves behind, and how to resume it.

| Workflow | Use it to |
|---|---|
| [Development](#development) | Build a feature, an enhancement or a bug fix |
| [Performance](#performance) | Find and fix bottlenecks |
| [Migration](#migration) | Move to another technology, data layout or architecture, with a rollback plan |
| [Research](#research) | Answer a question from the code, the docs and the web, optionally through to a design |
| [Product design](#product-design) | Decide what to build before building it |
| [Mockup studio](#mockup-studio) | Draw one new version of a set of UI mockups |

Not sure which one fits? `/maister:work "<task>"` reads the task and proposes a workflow.

**How every run works.** A run goes step by step and stops at checkpoints, where you continue,
send a step back with a note, or stop. Every workflow needs Node.js 20 or newer; without it the
command stops before it creates anything and says why. Each run gets a task directory under
`.maister/tasks/` and a dashboard. A first run, walked through checkpoint by checkpoint, is in
[Getting started](getting-started.md); every flag is in [Commands](commands.md); the task directory
layout is in [Configuration](configuration.md).

**Resuming.** Pass the run's task directory to its command, for example
`/maister:development .maister/tasks/development/2026-03-24-user-auth`, or to `/maister:work`. The
run carries on from where it stopped. There is no way to start a run part way through:
`--from=PHASE` and `--reset-attempts` are declined by name. To redo a step, send it back from its
checkpoint; to change finished work, start a new task.

A task directory started on the 2.x plugin is not resumed: the command says so and changes nothing
in it. See [Upgrading from 2.x](upgrading-from-2x.md).

In the lists below, *(when …)* marks a step that runs only in that case. A skipped step keeps its
place on the dashboard.

---

## Development

For features, enhancements and bug fixes. The analysis decides which optional steps run: it
detects whether the task fixes a reproducible bug, and adds the failing-test-first steps when it
does; it adds UI mockups when the change is UI-heavy.

```
/maister:development "Add two-factor authentication"
/maister:development "Fix login timeout"
/maister:development
```

Without a description, the task is taken from your conversation.

### Steps

1. Intake: sets up the task directory and brings in any research, design, architecture or
   context you passed
2. Codebase analysis, with clarifying questions
3. Gap analysis: what has to change, and the decisions it needs
4. Failing test *(when the task fixes a bug)*: a test that shows the bug, written first
5. UI mockups *(when the change is UI-heavy)*
6. Specification: requirements, then `spec.md`. It asks only the real choices still open (an
   approach, a story with two plausible behaviours, an assumption the analysis could not settle);
   every other story and assumption is written into the spec as drafted or assumed, and you review
   them at the specification checkpoint, which lists the stories nobody confirmed
7. Specification audit *(when you choose it at the specification checkpoint)*
8. Implementation planning: task groups, each with its tests
9. Implementation: task groups in parallel waves (one at a time with `--sequential`)
10. Passing test *(when the task fixes a bug)*: the failing test now passes
11. Choosing the checks: asks whether to write a user guide (unless `--user-docs` or
    `--no-user-docs` answered it)
12. Verification: the tests and the project's other checks, three reviews (spec conformance, code
    risk, simplicity), and the automatic fixes
13. Browser checks *(when you choose them at the verification checkpoint)*
14. User documentation *(when you asked for a user guide)*
15. Finalization: the summary, the commit message, the standard candidates

### Checkpoints

Always asked:

- **Gap analysis** — continue, revise the gap analysis, or stop.
- **Specification** — *Continue to the specification audit* or *Continue to planning, skip the
  audit*; revise the specification; or stop. `--audit` / `--no-audit` set which continue is
  recommended.
- **Implementation plan** — continue to the implementation, revise the plan, or stop. With
  `--publish`, continuing also approves publishing (below).
- **Implementation** — continue or stop.
- **Verification** — *Continue to the browser checks* or *Continue without browser checks*; or
  stop. `--e2e` / `--no-e2e` set which continue is recommended.

Asked when their step ran: **Failing test** (continue or stop), **UI mockups** (continue, revise
the mockups, or stop), **Specification audit** (continue, revise the specification, or stop),
**Browser checks** (continue or stop), **User documentation** (continue or stop).

### Building on earlier work

- **Research.** `--research=<research task directory>` copies the research into
  `analysis/research-context/`, and every step reads it.
- **A design.** `--design=<product-design task directory or its brief>` copies the brief and the
  mockups into `analysis/design-context/`. The mockups become binding references for the plan, the
  implementation and the browser checks. A quick design works the same way: name its task directory
  or its `decision.md`, and the decision comes with the pages of the options you chose, never the
  rejected ones.
- **An architecture.** `--architecture=<design document, or a research task that wrote one>`
  copies it into `analysis/architecture-context/`, with the decision log beside it. Its interfaces,
  contracts and decisions are built as stated; where this repository cannot follow them, the
  specification or the plan raises it as an open risk at its checkpoint.
- **Anything else.** `--context=<file or directory>` copies a context pack into
  `analysis/work-context/` as background for every step.

Passing a research or product-design task directory as the only argument works too:
`/maister:development .maister/tasks/product-design/2026-03-10-api-dashboard`, optionally followed by
instructions such as `Implement only phase 1`.

### What it leaves behind

The specification, the plan, the work log and the verification report, plus the reports of the
optional steps that ran (layout: [Configuration](configuration.md)). With HTML pages on, two
explainer pages too, each one page that answers one question from several documents, every figure
one a source states and every section linked to its evidence:

- `implementation/spec-explainer.html`, written before the specification checkpoint: what the
  change will do, what the spec commits to, and which stories and assumptions nobody confirmed.
- `verification/change-explainer.html`, written at finalization, when every report is in: what was
  built, whether it is safe to merge, and what is left.

The run does not commit. It
writes the commit message to `commit-message.txt` in the task directory and names the next steps:
commit, review the diff, open a pull request, deploy.

**Publishing.** With `--publish`, the plan checkpoint's continue also approves publishing. When the
run finishes it commits what it changed on its own branch (never the default branch: it creates a
branch for the task first), pushes it and opens one pull request, or updates the one already open
from that branch. Nothing is ever merged.

**Standard candidates.** While implementing, each task group notes what the next change should know
that no standard holds yet: a convention, a pitfall met, an important fact about the code. At
finalization the run merges duplicates, counts a lesson an earlier run already noted as one more
sighting of it instead of filing it again, matches the rest against your existing standards,
keeps at most five new ones and suggests where each belongs, with the evidence. It writes no
standard and asks nothing about them: it lists them in its closing message, files them in
`.maister/standard-candidates/` (a folder meant to be committed with your standards) with its own
record in `standard-candidates.json`, and names `/maister:standards-update` under **Next**. Run that command
with no argument and it offers the latest run's candidates, with the earlier ones that run met
again, and adds the ones you choose; one seen in two runs or more is recommended. Performance and migration do the same. See
[Standards](standards.md).

**The grounding pack.** When the change touches a file the project's mockup grounding pack was
built from, the run rebuilds the pack at its end, asks nothing, and the refreshed pack belongs in
the same commit as the change. See [Mockups](mockups.md).

---

## Performance

Static analysis finds the bottlenecks, then the usual specify, plan, implement and verify steps fix
them. It looks for N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leak
patterns and caching opportunities.

```
/maister:performance "Optimize dashboard loading time"
```

**Profiling data is optional.** The run creates `analysis/user-profiling-data/` in its task
directory and asks whether you have flame graphs, APM screenshots or slow-query logs. Files you put
there inform the analysis; an empty folder means static analysis alone.

### Steps

1. Intake
2. Codebase analysis
3. Bottleneck analysis
4. Specification
5. Specification audit
6. Implementation planning
7. Implementation
8. Choosing the checks (asks nothing)
9. Verification, with the automatic fixes
10. Finalization

### Checkpoints

All always asked: **Bottleneck analysis**, **Specification**, **Specification audit** and
**Implementation plan** (each: continue, revise, or stop), then **Implementation** and
**Verification** (continue or stop).

It leaves the bottleneck analysis, the specification, the plan, the work log, the verification
report and `standard-candidates.json`. With HTML pages on, finalization also writes
`verification/performance-explainer.html`: one page on what was slow, what changed and how much
faster it is, every figure one the analysis or the verification measured or states.

---

## Migration

Technology, data and architecture migrations, with a rollback plan and risk assessment.

```
/maister:migration "Migrate from REST to GraphQL" --type=code
```

The migration type (`code`, `data`, `architecture` or `general`) sets the risk focus; without
`--type`, the gap analysis decides it.

### Steps

1. Intake
2. Current state analysis
3. Gap analysis: the target state, and the strategy it recommends (incremental, big-bang or dual-run)
4. Specification, with the rollback plan beside it. It asks only the assumptions that are real
   choices; the rest are written into the spec as stated assumptions, for the specification checkpoint
5. Migration planning: each task group leaves the system in a state the rollback plan can still undo
6. Migration execution
7. Verification, with compatibility tests and, for a data migration, data integrity checks
8. Issue resolution *(when verification left issues)*
9. Documentation *(with `--user-docs`)*: a migration guide
10. Finalization

### Checkpoints

Always asked: **Gap analysis**, **Specification** and **Migration plan** (each: continue, revise,
or stop), then **Migration execution** and **Verification** (continue or stop). **Issue
resolution** (continue or stop) is asked when that step ran.

A data integrity issue is never fixed automatically: the run halts on it and asks you.

It leaves the current and target state analyses, the specification and rollback plan, the plan, the
work log, the verification and compatibility reports, the migration guide when asked for, and
`standard-candidates.json`.

---

## Research

Research from several sources (the codebase, the docs, the configuration, the web), synthesized into
a report, with optional solution brainstorming and a high-level design.

```
/maister:research "What authentication approach fits our architecture?" --type=technical
```

Research types: `technical`, `requirements`, `literature`, `mixed`.

### Steps

1. Research foundation: plan the method, gather information with parallel subagents, synthesize
   the findings, write the report and, with HTML pages on, a one-page explainer
2. Solution brainstorming *(when you choose it)*: alternatives per decision area, with the evidence
3. Solution convergence *(with brainstorming)*: you decide one area at a time
4. High-level design *(when you choose it)*: C4 diagrams and decision records
5. Final summary

### Checkpoints

- **Research** (always) — *Continue to brainstorming*, *Continue to the design, skip
  brainstorming*, or *Continue* to the final summary; revise the research; or stop. `--brainstorm`
  / `--no-brainstorm` and `--design` / `--no-design` set which continue is recommended.
- **Brainstorming** (when it ran) — *Continue to the design* or *Continue* without one; ask the
  decision areas again; or stop.
- **Design** (when it ran) — continue, revise the design, or stop.

With HTML pages on, each checkpoint lists the explainer first.

It leaves the research brief, plan and sources, the findings, the synthesis,
`outputs/research-explainer.html` (with HTML pages on) and `outputs/research-report.md`; with
brainstorming, the solution exploration; with a design, `outputs/high-level-design.md` and the
decision log. The closing message names the next step,
`/maister:development --research=<task directory>`, in a fresh session. When the research wrote a
design, `/maister:development --architecture=<task directory>` builds within it instead.

---

## Product design

For deciding what to build before building it. It explores the project, proposes the scope, decides
each choice with sketches, and writes a product brief with its final screens for development.

```
/maister:product-design "Design a dashboard for monitoring API usage"
/maister:product-design --research=.maister/tasks/research/2026-01-12-auth-research
```

It starts by exploring on its own: small read-only agents read the docs and the screens the task
touches, and only what they could not answer is asked, up to four questions with concrete answers and
a "Not sure yet" that does not block. From then on it asks one question per decision area, plus its
three checkpoints.

Options differ in what a person sees and does, never in schema or API. An area whose options look
different is sketched first, one small page per option. Answer an area with an option, or in your own
words: start with "Check" and what to look at, and the run checks it from the code or the docs and
asks that area again; name an approach that is not listed, and it becomes the choice.

For a single bounded design question, `/maister:quick-design` is lighter: it runs in the session,
asks one question set and writes a one-page `decision.md` under `.maister/tasks/design/` (see
[Commands](commands.md)).

### Steps

1. Explore and propose the scope
2. Problem and personas
3. Brainstorm alternatives: an agent generates them without anchoring on one
4. Sketches *(when the design has something to see and an area's options differ in it)*
5. Converge on a direction
6. Feature specification *(when you choose that outcome)*
7. Final screens *(when the design has something to see)*: drawn as one mockup version after the
   direction
8. Product brief and delivery scope
9. Completion: the hand-off to development

### Checkpoints

All three are always asked.

- **Scope** — shows the scope proposal, the problem and the personas, and asks which outcome to
  produce: **A design brief** (recommended unless the signals call for more), or **A brief with a
  feature specification**, for several interacting screens or rules. It also offers **Correct the
  scope**, **Revise the problem**, and **Use quick-design instead**, which ends the run and names
  the `/maister:quick-design` command to run next.
- **Design direction** — continue, revise the direction, or stop.
- **Brief and screens** — approve the brief, change the screens and the brief, change the brief
  only, or stop.

A design with nothing to draw says so at the first checkpoint, and goes through without sketches or
screens. The mockups follow `mockup_format` in `.maister/config.yml`: HTML by default, or ASCII.

### What it leaves behind

`outputs/product-brief.md`, which ends with a delivery scope (what changes and in what order, and
anything left out with the reason), also written as `outputs/delivery-scope.yml`. Approving the brief
approves the scope. With HTML pages on, `outputs/product-explainer.html` beside it is the page for
stakeholders: what is being built, what was decided and why, on one page linked to its evidence. The final screens replace the sketches in `analysis/mockups/`, and every version
stays under `analysis/mockups/versions/`. Pass the task directory to development:

```
/maister:development .maister/tasks/product-design/2026-03-10-api-dashboard
```

---

## Mockup studio

The mockup studio draws one new version of a set of UI mockups and stops. It asks nothing and has
no checkpoints. Every earlier version stays; run it again for the next one. Use it to sketch screens
outside a development or product-design run, or to iterate on a set you already have.

```
/maister:mockup-studio --turn "Draw the settings page"
```

Versions, the gallery, the grounding pack and the HTML and ASCII formats, and the written scope the studio can write for one turn, are covered in
[Mockups](mockups.md).

---

## Bringing a branch up to date

`/maister:update-branch` merges the default branch into the current branch, resolves any conflict
from the branch's intent, runs the project's checks and commits the merge. It never pushes. When a
workflow run is unfinished on the branch, the run's start commit moves to the merged commit, so the
run's next review counts only the run's own work.

```
/maister:update-branch
```

Pass `--onto <branch>` when the branch was cut from a branch other than the default one:

```
/maister:update-branch --onto feature/search
```

Each call leaves a JSON result, `update-branch.json` in the run's task directory, saying what it
did. The flags and the result are described in [Commands](commands.md).

---

## Your own workflows

A project can define workflows of its own in `.maister/workflows/`, overlay a built-in to add or
disable steps, or eject a built-in into an editable copy. They run like the built-ins, with the same
checkpoints, dashboard and resume, and start with `/maister:run <name>`. See
[Extending maister](extending.md) and the [Built-in workflow reference](workflow-reference.md).
