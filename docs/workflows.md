# Workflow Details

Maister ships five workflows, each with phases tailored to its needs, and runs workflows your project defines on the same engine. All workflows pause between phases for your review and input.

A run started from the cockpit, dispatched into another repository, or started by another run as
a step of its own, has nobody sitting in the session — so it asks nothing there. The pauses
between phases still happen: each one suspends the run and waits for you to answer it from outside. The smaller questions a phase asks along the way
reach you too when the run is driven from a cockpit that can show a set of questions: the phase
gathers every question it has into one card, suspends once, and carries on with your answers,
which are recorded as yours. A question that only comes up after that card is answered — another
refinement round, a retry — cannot wait a second time in the same phase and takes its stated
default. A run driven any other way, such as one dispatched into another repository, asks none of
them: each one takes a stated default instead: a clarification goes unasked
and the analysis stands, an opt-in and a decision take what the phase recommends, a revise-or-accept
loop accepts what it has, and a phase that has run out of recovery attempts fails rather than
guessing. Every default a run takes is written onto that phase's summary, beside its decisions, so
the run's dashboard and its state both show which questions were answered for you and what the
answer was — and the next pause is where you change any of it.

## Permissions in a run the cockpit drives

In your terminal, a run asks permission the way your CLI always does, under your own settings. A
session the cockpit drives still runs under its CLI's own permission system: the cockpit sets that
system up from the session's preset or the worker's autonomy tier, and decides no call itself.

- **Claude Code.** The level becomes Claude's own permission rules, and the session runs in auto
  mode, which judges any call no rule covers; a read-only session only reads and asks nothing. A
  call a rule holds — a push, a pull request, a release or a merge, and at the most careful level
  a commit or an install too — reaches you as a card in the cockpit and waits until you answer it.
  **Allow for the session** adds one more of Claude's own rules. The engine's own state writes are
  allowed, so a run does not ask you to approve itself.
- **Copilot CLI.** Copilot cannot stop and ask in the middle of a headless turn, so each turn starts
  with a fixed list of allowed and refused tools. A refused call reaches you as a card. **Allow from
  next turn** adds the narrowest rule Copilot honours for that command, from the session's next
  turn; it never applies to the turn that was refused.
- **Grants from a gate.** A gate option that also pushes the branch and opens a pull request says so
  on its card. Choosing it grants exactly that, to the worker whose gate you answered, for that
  worker's own branch. On Claude the grant becomes the session's own rules until the run hands off;
  on Copilot it covers the worker's next turn only, and the turn after is refused again. The run
  lists every grant in force, each with a revoke.

The pauses between phases are asked as described above whatever the level, and the plugin's guard
against destructive commands from subagents applies under the cockpit as in your terminal. Neither
CLI's rules hold everything: a rule matches the start of a command, so it holds nothing spelled
another way. Each level's details, and what is not held, are in the cockpit's guides:
[Autonomy tiers and permissions](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/autonomy.md),
[What Claude cannot hold](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/what-claude-cannot-hold.md),
[What Copilot can and cannot hold](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/copilot.md)
and [How a Claude session asks you](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/sessions.md#how-a-claude-session-asks-you-and-when-it-falls-back).

## Development Workflow

The unified development workflow handles features, enhancements, and bug fixes through a 14-phase adaptive pipeline. Phases activate or skip based on task type.

```
/maister:development
/maister:development "Add two-factor authentication"
/maister:development "Fix login timeout"
```

When run without arguments, the plugin extracts the task description from your conversation. The analysis detects whether the task fixes a reproducible bug, and adds the failing-test-first phases when it does.

**Flags**: `--research=PATH`, `--context=PATH`, `--design=PATH`, `--architecture=PATH`, `--audit` / `--no-audit`, `--e2e` / `--no-e2e`, `--user-docs` / `--no-user-docs`, `--sequential`, `--publish`. `--user-docs` / `--no-user-docs` answers its question up front; without it, the run asks. The specification audit and the browser checks are decided at the checkpoint before each — *Continue to the specification audit* or *Continue to planning, skip the audit*, and *Continue to the browser checks* or *Continue without browser checks* — so `--audit` / `--no-audit` and `--e2e` / `--no-e2e` set which of the two is recommended; the checkpoint still asks. `--context=PATH` hands the run a context pack — a file or a directory — that the intake copies into `analysis/work-context/` as background for every phase; a path that cannot be read is reported and the run continues without it.

**Browser steps.** The browser checks, the user guide's screenshots and the HTML mockup gallery use whichever browser tool your session has — `playwright-cli` first, then a Playwright MCP server you configured, Claude in Chrome, then the Claude desktop app's built-in browser. Maister ships none. In a session without one, the run says so where it would offer a browser step, names the tools that would add one, and recommends the browser-less way on: *Continue without browser checks*, the user guide off (or on, without screenshots), and the mockup gallery's address to open yourself or ASCII mockups. It never fails the run for it. Screenshots land in the run's `verification/screenshots/` and `documentation/screenshots/`.

**Publishing.** With `--publish` the plan checkpoint offers *Continue to the implementation — also pushes the branch and opens the pull request*. That one answer approves the plan and the publication: when the run finishes it commits what it changed on its own branch (never the default branch), pushes it and opens one pull request, or updates the one already open from that branch. Nothing is ever merged. Without the flag the plan checkpoint is the plain one, and publishing stays a next step the run names at the end. A run started by a workspace dispatch gets the same choice from its `publish` input.

### How it runs

This workflow is a workflow definition — a graph of nodes with declared dependencies and guards —
that the workflow engine freezes into the task's state and executes. It needs Node.js 20 or newer;
without it the command stops before creating a task directory and says so.

`/maister:development` runs the definition — it ships as `builtin:development`, with a diagram
generated from it (regenerate that diagram, never edit it). Research, performance, migration and
product design run on the engine too.

Definitions resolve eject → generated → overlay → built-in, and the first hit wins: an eject at
`.maister/workflows/<name>.yml`, then a generated chain at `.maister/workflows/generated/<name>.yml`,
then an overlay at `.maister/workflows/<name>.overlay.yml`, then the shipped built-in. So a project
can eject a shipped graph into its own workspace, or lay an overlay over it, without patching the
plugin. That route reaches every built-in workflow, because the engine executes all of them, so
ejecting or overlaying `builtin:development` takes effect on the next run. A generated chain — one the planner published for a single ticket — is complete in itself
and is never overlaid or ejected; it is resolved by name like any other and deleted by the
workspace's `prune` command once its runs have closed. Writing a chain of your own, naming your
own skills and agents from its nodes, and what an overlay may change are covered in
[Extending maister](extending.md).

The engine records every state change in two steps. It writes the change to one fixed file in the
task directory, `.state-patch.json`, then runs its own writer, a shell command, which reads that
file and deletes it. Your own permission settings decide whether either step asks first. Accepting
edits for the session (or an edit rule for `**/.state-patch.json`) covers the file, and an allow
rule for the plugin's engine command — or approving it once with *don't ask again* — covers the
writer, so you are not asked to approve your own workflow several times per phase. (The Pro
Edition's gate hook allows both steps itself, and nothing at all while a run waits at a gate.)

The engine resumes by recomputing which nodes are ready from the frozen state, so there is no
mid-graph entry point to start from. A run declines `--from=PHASE` and `--reset-attempts` by name
rather than accepting a flag it would silently ignore. The one way back inside a run is a gate's
revise option ([Sending a run back from a gate](#sending-a-run-back-from-a-gate)). Re-entering a
run partway at a node of your choosing is planned for a later release; until then, revise at a gate
or start a new task. A task started on 2.x that needs a phase jump is finished on 2.x (see
[Task directories from 2.x](#task-directories-from-2x)).

### Phases

| # | Phase | Applies To |
|---|-------|-----------|
| 1 | Codebase analysis + clarifications | All |
| 2 | Gap analysis with decision gates | All |
| 3 | TDD Red gate (write failing test first) | Bug fixes only |
| 4 | UI mockups | Features & enhancements (UI-heavy) |
| 5 | Requirements + specification | All |
| 6 | Specification audit | Decided at the specification checkpoint (recommended; `--audit` / `--no-audit` set the recommendation) |
| 7 | Implementation planning | All |
| 8 | Implementation execution | All |
| 9 | TDD Green (confirm the failing test now passes) | Bug fixes only |
| 10 | Verification options selection (reviews, user guide) | All |
| 11 | Verification + issue resolution | All |
| 12 | E2E testing | Decided at the verification checkpoint (`--e2e` / `--no-e2e` set the recommendation) |
| 13 | User documentation | Optional (`--user-docs`) |
| 14 | Finalization | All |

**Standard candidates.** While implementing, each task group notes what the next change should
know that no standard holds yet — a convention, a pitfall met, an important fact about the code —
with why it matters, where it applies and what showed it. At finalization (development,
performance and migration alike) a light-model pass merges duplicates, matches each against your
existing standards ("extend rule X" rather than a near-duplicate), suggests where it belongs — a
standards file, or a project document under `.maister/docs/project/` for a decision or a fact
about the system — and shows the evidence. You choose which to keep; each one chosen goes through
`/maister:standards-update`.

### Research-Based Development

Start development informed by a completed research workflow. Research context flows through all phases:

```
/maister:development "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
```

Research artifacts are copied to `analysis/research-context/` and summaries pass to every subagent.

A completed product design feeds development the same way: `--design=PATH` names its task directory
(or its brief), and the brief and mockups are copied to `analysis/design-context/`, the mockups
becoming binding visual references for the plan, the implementation and the browser checks.

```
/maister:development "Build the API usage dashboard" --design=.maister/tasks/product-design/2026-03-10-api-dashboard
```

A high-level design constrains development the same way: `--architecture=PATH` names the design
document (or a research task that wrote one), and it is copied to `analysis/architecture-context/`
with the decision log beside it. The interfaces, contracts and decisions it names are built as
stated, never decided again; where this repository cannot follow them, the specification or the
plan raises it as an open risk at its checkpoint. A run started by another — a chain step in a
multi-repository workspace — passes the same path as its `architecture` input.

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

**Flags**: `--sequential`

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

**Flags**: `--type=TYPE`, `--brainstorm` / `--no-brainstorm`, `--design` / `--no-design`, `--context=PATH`. `--context=PATH` hands the run a context pack that the first phase copies into `analysis/work-context/` as background. Solution brainstorming and the high-level design are decided at the checkpoints before them. The research checkpoint offers *Continue to brainstorming*, *Continue to the design, skip brainstorming* and *Continue to final summary*. When brainstorming ran, its checkpoint offers *Continue to the design* and *Continue to final summary*. Under a parent run the last continue names the parent's next step instead, since the research then skips its own summary. The flags set which way on is recommended; the checkpoint still asks.

**Research also runs as a step inside another run.** A chain can name it from a node, and the node
then starts a research run instead of a command doing it: the question comes from the node rather
than from you, the run gets a task directory of its own named after the run that started it, and
the node waits until it ends. What the calling run may read back is what the research definition
declares — its report and its conclusions — and nothing else. A research run started this way
skips the step that exists only to tell an operator the run is over; everything before it is the
same phases, checkpoints included. A calling run can also ask for the findings only: the
checkpoint after the research then offers *Continue*, *Revise the research* and *Stop here*, and
brainstorming and the design are never offered. Nothing about it needs setting up on your side, and a research
run you start yourself is unaffected.

### How it runs

Research runs on the workflow engine: the workflow ships as a definition — a graph of nodes with
declared dependencies and guards — which the engine freezes into the task's state and executes.
Like the other engine workflows, it needs Node.js 20 or newer.

### Phases

| # | Phase | Applies To |
|---|-------|-----------|
| 1 | Research foundation: initialize → plan methodology → gather information (parallel) → synthesize findings | All |
| 2 | Solution brainstorming (alternatives per decision area, evidence-driven) | Decided at the research checkpoint (`--brainstorm` / `--no-brainstorm` set the recommendation) |
| 3 | Solution convergence (one decision area at a time) | With brainstorming |
| 4 | High-level design (C4 diagrams + decision records) | Decided at the research checkpoint, or at the brainstorming checkpoint when brainstorming ran (`--design` / `--no-design` set the recommendation) |
| 5 | Final summary | Runs you start yourself |

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

**Flags**: `--research=PATH`, `--no-visual`, `--simple`, `--full`

`--simple` runs the short design: no characteristics or context checkpoint, no personas, no
brainstorm of alternatives or direction checkpoint, and no prototypes unless the design turns on
layout or presentation — the intake judges that, says why, and lets you override it in the same
question that asks for additional context. The specification states the approach itself, and you approve the problem and the
specification before the brief and its delivery scope.

`--full` runs the full design whatever the description suggests: the design is treated as
complex, so personas are drafted and every phase goes to its deepest. Without it the depth
follows what the run detects, and a short description of a modest change gets no personas.

For a single bounded design question, `/maister:quick-design` is lighter still: it runs in the
session rather than on the engine, asks one question set and writes a one-page `decision.md` under
`.maister/tasks/design/` (see [Commands](commands.md#maisterquick-design-design-question)).

### How it runs

Product design runs on the workflow engine: the workflow ships as a definition — a graph of nodes
with declared dependencies and guards — which the engine freezes into the task's state and
executes. Like the other engine workflows, it needs Node.js 20 or newer.

It is the most interactive of the workflows. Its exploration questions and refinement loops are
the work rather than overhead around it, so the phases ask a good deal between the gates. Driven
from a cockpit that can show a set of questions, each phase sends you its questions as one card —
the design direction too, every decision area at once, each with its alternatives, their pros and
cons and a recommendation, and each carrying its full write-up, so an area can be decided without
opening the alternatives document. A run that cannot ask takes each question's stated default
instead, and the documents it writes say they were drafted without review. Choosing a design direction is
the one exception: such a run never picks one itself. It lays the alternatives out with a
recommendation for each decision, and the direction pause is where you choose — continuing adopts
the recommendations, and sending the run back names the ones you want instead.

### Phases

| # | Phase | Activation | Pause after it |
|---|-------|------------|----------------|
| 1 | Intake: gather context & detect characteristics | Always | Confirm the characteristics |
| 2 | Context synthesis (codebase analysis or mini-research) | Always (scope adapts) | Approve the context |
| 3 | Problem space exploration (interactive, iterative) | Always (depth adapts) | — |
| 4 | User & persona exploration | Greenfield or complex designs, or `--full` | Approve the problem and personas |
| 5 | Design alternatives generation (agent-driven, unbiased) | Always | — |
| 6 | Converge on design direction (interactive) | Always | Approve the direction |
| 7 | Feature specification, section-by-section (interactive) | Always (depth adapts) | — |
| 8 | Visual prototyping (browser-based companion with ASCII fallback) | UI-focused designs | Approve the specification and prototypes |
| 9 | Review & hand off product brief | Always | The brief's own approval; the workflow ends |

The problem statement and the specification are always reviewed at a pause, even when the persona
or prototyping phase after them is skipped. The problem, convergence and specification phases
include iterative refinement loops — you can request revisions before moving on — and the mockup
studio runs its own loop over the screens. Phase 5 uses an agent to generate alternatives without
anchoring bias; when none of them fits, the direction pause can send the run back to generate more.

The output is a structured product brief that can be passed directly to the development workflow:

```
/maister:development .maister/tasks/product-design/2026-03-10-api-dashboard
```

The brief ends with a delivery scope, which you approve with it: the repositories the work lands
in, what changes in each and in what order, and any left out with the reason. In a single
repository it names that repository; in a multi-repository workspace it names the workspace's
members. It is also written as `outputs/delivery-scope.yml`, so a delivery planned across several
repositories can start one development run per repository in scope, in that order.

### Resume

```
/maister:product-design [task-path]
```

The engine resumes by recomputing which nodes are ready from the frozen graph, so it has no
mid-graph entry point and no attempt counter: it declines `--from=PHASE` and `--reset-attempts`
by name. A task directory started on the 2.x plugin is not resumed — see
[Task directories from 2.x](#task-directories-from-2x).

---

## Chain-Only Workflows

Not every workflow type has a command: `plan`, `change` and `fix` are reachable only from a chain,
which dispatches them into a member repository. They are a Pro Edition feature — see
[Pro Edition](../README.md#pro-edition).

---

## Answering a question

Every question a run asks — a gate or a question inside a phase — carries what you need to decide
in its own text. A decision lists each alternative with its key trade-off. The run's first
question also opens with one line naming the workflow, how many checkpoints it has and the
dashboard. In Claude Code, moving to an option shows its detail beside the options: what choosing
it does, or an alternative's description, pros and cons. Where a question's context is long it
offers **More details**, which writes all of it out and asks the same question again; it records
nothing. When every option slot is taken, type *details* instead.

A recommended answer gives its reason. Questions that stand on their own — assumptions to
confirm, issues to decide — come as pages of up to four, and a later page says how many are left.
A design decision comes one area at a time, each with every alternative, its pros and cons and
the recommendation, because a later area can depend on an earlier answer; it is never offered as
accept-all. In research and product design the areas are asked from the record the brainstorm keeps
beside its document, word for word, and a cockpit shows each area with its full write-up — the same
text **More details** writes out in the terminal. Questions about one behaviour — who may deactivate a user, where the action is, what
is stored and audited, who sees the user afterwards — come as one drafted story instead, its
defaults filled in: accept it, accept it with the corrections the run lists, take the alternative
story it offers where there is one, or write your own. Each story is one answer, kept as a
requirement that the specification carries under the story's id and that the spec conformance
review confirms was built. A question the run can already answer from its own analysis is not asked: it says the
answer in one line instead ("User guide: on — asked for when the run started").
Every answer you give is kept in the task's state, with whether you took the recommendation.

A recommendation also names the files it rests on, when there are any: the specification, the
findings, the brainstorm, a decision record. In the terminal the question reads as before. A run
the cockpit drives sends each checkpoint and each question with that list as `evidence`, paths
from the repository root, so whoever answers can open what the recommendation was built from. A
file that is missing is left off the list with a warning; the question is still asked.

A checkpoint that approves one output says which, as its `subject`: the delivery scope, the
product brief, the specification, the plan or the screens, with the file's path inside the task
folder. A cockpit leads the checkpoint with that output, shown as what it is. A checkpoint that
approves none of them names no subject, and reads as before.

At a checkpoint the question is one line: what finished, and whether it is ready to go on. Where the run goes if you continue is named by the continue option.
Where the next phase is optional, the checkpoint before it decides it in the same question, with one continue for each way on: development's specification checkpoint offers *Continue to the specification audit* and *Continue to planning, skip the audit*, and its verification checkpoint *Continue to the browser checks* and *Continue without browser checks*; research's checkpoint after the research offers *Continue to brainstorming*, *Continue to the design, skip brainstorming* and *Continue to final summary*. The recommended one gives its reason, and each names where it leads and what it skips.
Beside the continue option you see the checkpoint at a glance:
- *Done*: what the stretch since the last checkpoint produced, in a sentence;
- *Found*: what the phase found, its summary in full;
- *Next*: the phase that runs, and any it skips;
- *Review*: the files to open, named inside the task folder;
- up to three risks still open, a reason to stop first;
- how many fixes the run made without asking, with up to three of them named — what was wrong and what changed;
- up to three decisions the run made, each marked with the phase that settled it, an audit or a default;
- one line counting your own choices and naming any that differ from the recommendation.

Every risk, fix and decision is shown whole. When they do not all fit, the last ones give way to a
count of how many more are under **More details** — decisions first, then fixes, then risks.

On GitHub Copilot CLI, which shows no previews, the same glance is the question itself, with the
ask as its last line.

**More details** lists every risk, grouped by what they are:
- *Open*: still yours to change, and with any reason to stop the source of a revise's suggested notes;
- *Trade-offs accepted*: consequences of a choice already made;
- *Follow-ups*: for after this run.

Stop is recommended, and opens with its reason, when a phase found a reason to stop. The run's
closing message lists what is still open and the follow-ups. The dashboard shows every decision
with who settled it and every risk with its tag.

**The automatic fix loop.** When verification finds issues — in development and performance, and
in migration's issue resolution — the run fixes every issue that is clear and not risky without
asking, then checks again on its own, up to two times. Only then does it ask: one question per
issue that needs your decision, and whether to take another round, continue as is or stop. The
gate after it lists every fix made without asking. A run with nobody in the session continues as
is, and the issues it could not fix stay open for that gate. Each review finding that needs your
decision, from the specification audit as well as from verification, is asked as its own question:
the proposed change, its alternatives and "Accept the risk and list it", with the recommended one
and the reason for it.

**When the run's policy classes questions.** None does by default. Where an autonomy policy
classes the questions a phase asks, the run settles the routine ones within its
autonomy ceiling and shows them to you at the next checkpoint. A run nobody can ask — a dispatched
one — takes a default for the rest, and holds any choice that needs your approval. Held choices
come first at the next checkpoint, and continuing approves them; to reject one, send its phase
back from that checkpoint with *Revise <phase>* and a note, and the others stay held for the
next continue. A choice it could not make
because nothing was recommended is held with no choice yet, and the checkpoint asks you to send
that phase back with your choice in the note: continuing never decides it. When no
checkpoint follows one,
the run asks one more, *Held for approval*, before it finishes: approve and finish, send a phase
back, or stop. The dashboard marks each held choice approved once you have.

---

## Sending a run back from a gate

Some approval gates offer a third answer beside continue and stop: **revise**. It sends the run
back to the phase that wrote the document you are approving, with a note saying what to change.
That phase runs again over its own output, everything between it and the gate runs again after
it, and the gate asks you once more.

| Workflow | Gates that offer a revise | Re-runs |
|---|---|---|
| Development | gap analysis, UI mockups, specification, specification audit, plan | gap analysis; the mockups; the specification (from both of its gates); planning |
| Research | research foundation, convergence, design | the research foundation; the solution convergence; the high-level design |
| Performance | bottleneck analysis, specification, specification audit, plan | the bottleneck analysis; the specification; planning |
| Migration | gap analysis, specification, plan | the gap analysis; the specification; planning |
| Product design | characteristics, context, problem and personas, design direction (two options), specification and prototypes | the intake; the context synthesis; the problem exploration and the personas after it; the convergence alone, or the alternatives generation and the convergence; the specification and the prototypes after it |

Verification and issue resolution offer no revise: their phases fix what they find through the
automatic fix loop ([Answering a question](#answering-a-question)) before the gate asks. Product design's document phases loop too, but only when somebody is in the
session; a run driven from outside skips those loops, so its pauses are where the documents change.

- **The note is chosen, not typed.** After you pick revise, the gate offers up to four suggested
  changes drawn from what the phase left open — a reason to stop first, each with the change it
  needs where the phase named one — none of them ticked in advance. Pick any of them; typing your
  own is there too, for anything the suggestions miss. Nothing is offered just to fill the list:
  with fewer than two suggestions you type the note, and "yes" sends the one there is.
- **Revise as often as you need.** The option says how often the checkpoint has sent the run back
  so far, and mentions an earlier revise of the same document at another checkpoint. A safety
  ceiling of ten per checkpoint stops a runaway loop; at it, the gate offers only continue and
  stop.
- **What you see.** The dashboard tags each re-run phase with its attempt, and the gate keeps every
  revise with its note, so the run's record says why each phase ran more than once. A resumed run
  picks up a revise where it stopped.

A revise is an in-run answer. It does not reopen a run that has finished; to change finished work,
start a new task.

## Choosing subagent models

Most of a workflow's work is done by subagents. By default:

- **The clerical agents** (project analysis, the docs operator, task classification, the
  test-suite runner and HTML companions) and **the codebase scouts** maister starts (`Explore`)
  run on the `light` tier: a lightweight model on high effort.
- **Implementers follow the plan.** Each task group runs on the tier its plan gives it, `light`,
  `standard` or `deep`; a group with no tier runs on `standard`, and a fourth `deep` group in a
  run asks first. On Copilot, where the deep model bills 15 requests each, groups stop at
  `standard`.
- **The reviewers** — the three verification reviews and the specification audit — run on the
  `deep` tier on Claude Code and on `standard` on Copilot, where the deep model bills 15
  requests each.
- **Verification's fixes** — the ones the fix loop after implementation applies without asking —
  run on your session's model, and so do **the verification runner** and **the implementation
  runner** that carry those loops.
- **Every other agent** runs on your session's model.

`/maister:init` writes these defaults into `.maister/config.yml` as a `subagents` block you can
edit, adding it to a config that has none and leaving an existing block alone. In a codebase of
more than 2,000 files it puts `Explore` on `standard`, still on high effort, and its summary says
so. The block governs the agent calls maister makes; the explore agents your host's own plan mode
starts are outside it. The block holds:

- **A ladder of three tiers**, `light`, `standard` and `deep`, each naming a model per host
  (Claude Code takes `haiku`, `sonnet`, `opus` or `fable`; Copilot takes a model id). `inherit`
  in a cell, or as an entry's `model`, means your session's model.
- **Assignments** per agent, per workflow (`workflows.<name>.agents`) or per step
  (`workflows.<name>.nodes.<step>.agents`): a tier, a named preset, or a model and effort. A tier
  may differ by host, `{ claude: deep, copilot: standard }`; a host the map leaves out is passed
  over, as a Claude Code model pin is on Copilot, and the next entry or default answers. The
  most specific entry naming an agent wins, and any entry naming it beats a `default`: a default
  covers only the agents nobody names, so the clerical agents stay on the lightweight model
  until you name them.
- **Effort.** A tier's effort applies to every agent on it unless the agent's entry sets its
  own; remapping a tier's models keeps its effort unless you set one there. `effort: inherit`
  sends none.
- **Implementers by plan tier.** The implementation plan gives each task group a tier with a
  one-line reason. With `task-group-implementer: { choose: by-plan-tier }`, the default, each
  group runs on the cheapest model allowed for its tier, under a `ceiling`, which may differ by
  host (`{ claude: deep, copilot: standard }` by default). A group that fails is
  retried once on the next tier up before you are asked, and `budget` (by default `{ deep: 3 }`)
  makes the run ask before it sends one more group to a tier. The work log records the model each group ran
  on, and the implementation summary gives the tally.

A run copies the block into its state when it starts, so a resumed run keeps its models and an
edit applies to the next run. A block with an error is set aside with a warning and the defaults
apply; `/maister:run --check <workflow>` shows the warnings without starting anything. An overlay
or a profile may carry the same block, without the ladder.

## Implementation in one subagent

Implementation runs in waves: each wave starts the task groups that can run side by side, one
implementer subagent each, and every group that comes back is checked and recorded before the next
wave starts. Where your host lets a subagent start subagents of its own, the run hands all of that
to one subagent, the implementation runner, and your session makes one call per pass instead of
several per group. You are asked exactly what you were asked before: a group that failed again
after moving up a model, a group that skipped its tests, or a wave that would run past the model
budget. Your answers go to the runner's next pass. The same setting decides it as for verification
below, and a run that stops part way through picks up from the plan and the work log.

## Verification in one subagent

Verification runs many steps: the tests and the project's other checks, three reviews, the merge of
their findings, the
report, the fixes made without asking and their re-checks. Where your host lets a subagent start
subagents of its own, the run hands that whole loop to one subagent, the verification runner, and
your session makes one call per pass instead of one per step. You are asked exactly what you were
asked before: a finding that needs your decision, a risky fix, or what to do once the automatic
re-checks are spent. Your answers go to the runner's next pass.

The run decides when it starts. On Claude Code the runner is used unless
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set to 1; on Copilot CLI it is always used; a run the
cockpit drives uses it too. Where it cannot be used, or the runner finds it cannot start subagents,
verification runs in your session as before, and the status line says `inline` instead of `nested`
while it runs. A run that stops part way through verification picks up from the files the last pass
left, whichever way it ran.

**The three reviews.** Every cycle runs the same three, in one pass:
- **spec conformance** — does the code obey what the spec, the clarifications and your decisions
  say? It writes down the rules first, quoted (who may do what, what must never happen, ordering,
  what a failure must do), checks every operation the change adds against them, then each
  requirement and story, the work log's claims against the code and tests, and any document the
  change made false;
- **code risk** — what can break, leak or fall over where your project runs: correctness, failure
  paths, security and resilience keyed to the project profile, how CI and the build run the
  change, operational hygiene (documented settings, kill switches, logging) where the project is
  operated, and the standards that govern the change;
- **simplicity** — complexity the project does not need for its scale, at most five findings.

**What each reviewer is given.** The same review brief, a small file of facts: the commit the run
started from, the files it changed (marking generated files, such as lock files, and data files,
such as fixtures, which a reviewer skips unless a finding turns on them), the test result and the
result of every other check the project runs (lint, format, typecheck, build — the test run
always runs those, even when the suite itself already passed during implementation), the paths of
the run's documents and the project profile. Nobody writes a reviewer a prompt for your change:
each reads the spec, the plan, the work log and its *Known open problems*, and decides where to
look. Code risk and the test run read whatever they need — diffs, callers, history, CI and build
files; spec conformance and simplicity read the changed files and only what a finding turns on.
Every review covers only what the run changed; a defect found outside the change counts only when
it is critical, and a deviation you decided on is not reported as a defect. Standards are judged,
not matched by name: code risk takes the standards the run says it applied together with those it
judges, from one read of your `.maister/docs/INDEX.md`, to govern what the change does, and
reports each rule the code breaks.

**What gets fixed.** Critical and warning findings are fixed without asking when the fix is safe;
info findings are listed in the report and fixed only when you choose them.

## What the reviewers check: the project profile

The reviews check what applies to your project, not a fixed web-service checklist. A CLI or a
plugin is not asked for a health endpoint, rate limiting or CORS, and a project with no database
is not asked for down-migrations or connection pooling. What the project is comes from the
`project:` key of `.maister/config.yml`:

```yaml
project:
  kind: cli                  # web-app | service | daemon | cli | library | plugin | desktop | mobile | data-pipeline | infra
  runtime: "node 20"         # the language and its version
  deploy: package-registry   # none | local | container | kubernetes | serverless | package-registry | app-store
  exposure: local            # local | internal | public: who can reach its entry points
  data: []                   # the stores it writes, e.g. [postgres, files]; [] for none
  scale: team                # single-user | team | multi-tenant
  ui: none                   # none | web | tui | native
```

Every field is optional, and one left out rules no check out. `/maister:init` fills the key in
from its project analysis when your config has none, leaving the fields it could not settle
commented out, and leaves an existing key alone; its summary shows what it wrote. Correct any line
by hand. A run copies the profile into its state when it starts, so an edit applies to the next
run. A value maister does not know is a warning, and that field is left out; it never stops a
run, and `/maister:run --check <workflow>` shows the warning without starting anything.

Without the key, each reviewer works the profile out from `.maister/docs/project/` and says in its
report what it inferred. The reviews judge a safeguard from the same profile: a missing pool, cache or rate limit is code
risk's finding only when the project needs it, and one that is there is the simplicity review's finding
only when the project does not, so the two never ask for opposite things.

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
refused.

To finish a 2.x task, install the 2.x line as the README's
[Staying on 2.x](../README.md#staying-on-2x) section describes, and resume it there. To start the
work over on 3.0, run the command again without a task path.

A development or research task can instead continue as a new 3.0 run started with
`--context=<the 2.x task directory>`. The new run's first phase copies that folder whole, its
`orchestrator-state.yml` included, into `analysis/work-context/` and reads it as background for
every phase, never as a specification. Nothing of the 2.x state is resumed: the run starts at its
first phase and asks every gate again, and the 2.x folder is not changed. Performance, migration
and product-design take no `--context`.

## Task Directory Structure

All workflows create structured directories in `.maister/tasks/`:

```
.maister/tasks/
├── development/           # All development tasks (features, bugs, enhancements)
├── performance/           # Performance optimization
├── migrations/            # Migrations
├── research/              # Research
├── product-design/        # Product design
├── design/                # Quick design: decision.md, and mockups/ when made — no state or dashboard
└── <name>/                # A workflow your project defines, started by name
```

Each task folder follows the pattern `YYYY-MM-DD-task-name/` and always starts with the same three files and a `display/` directory:

```
2026-02-17-user-auth/
├── orchestrator-state.yml        # Workflow state (pause/resume, phase tracking)
├── dashboard.html                # Operator dashboard (copied plugin asset)
├── dashboard-data.js             # Dashboard data, written by the engine from the run's state
└── display/                      # What the terminal draws beside the session; ignored by git
```

What sits beside them depends on the workflow:

| Workflow | Subdirectories |
|----------|----------------|
| **development** | `analysis/` (codebase analysis, gap analysis, `research-context/`, `design-context/`), `implementation/` (spec, plan, work log), `verification/`, `documentation/` |
| **research** | `planning/` (brief, plan, sources), `analysis/` (`findings/`, synthesis), `outputs/` (report, decision log, `decision-areas.json`) |
| **product-design** | `context/` (your input materials), `analysis/` (problem statement, personas, alternatives, `decision-areas.json`, feature spec, `mockups/`), `outputs/` (product brief, delivery scope) |
| **performance** | `analysis/` (bottleneck analysis, `user-profiling-data/`), `implementation/`, `verification/` |
| **migration** | `analysis/` (current state, target state, rollback plan), `implementation/`, `verification/`, `documentation/` |

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

`dashboard-data.js` is a projection of a run's state rather than a document kept beside it. The
engine writes it: every state change it commits republishes the file from the state
it has just written, so what the dashboard draws is never older than the state behind it, and no
turn between phases has to remember to rewrite it. A run with `html_output: false` in
`.maister/config.yml` gets no data file — if one is already on disk it is removed rather than left
there to be polled. The implementation and verification phases run under a skill
rather than under the engine, and they keep the dashboard live the same way everything else does:
by writing state. After each implementation wave
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
`gap-analysis` becomes `Gap analysis`, a known acronym kept in capitals (`notes-api` becomes `Notes API`). An empty or multi-line title is refused when the definition is
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

### The run in the terminal

In Claude Code's terminal and its desktop app's Code tab, the plugin draws a run beside the session.
You see the start banner in the transcript and the run's phase in the status line under the prompt,
for example `Development · phase 5/12 · Implementation planning · <task>`. At each checkpoint, a
short panel sits above the question: what the checkpoint closes, what was done, how much was
decided and how much is open, what runs next and which files to review. It stays in view whichever
option you are looking at. A question that is not a checkpoint gets no panel.

The phase count leaves out checkpoints. It holds for the whole run: a step the run skips keeps its
place, drawn as a hollow dot among the phase dots, so the total never shrinks.

What it draws comes from small files the engine writes for it, in each run's `display/` directory.
The engine also keeps a pointer per session under `.maister/display/sessions/`, which is how the
drawing finds the run your session is driving. Both directories ignore themselves in git, so none of
these files shows in `git status`.

The drawing is extra and never required. It needs a Claude Code release that runs plugin hooks
modules, and a folder you have trusted. In the VS Code extension, in `claude -p`, with modules
switched off, or in GitHub Copilot CLI, nothing is drawn: each checkpoint question carries its
context as it always has.

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

## Internal Skills

These skills are machinery: an orchestrator invokes them, and none of them has a command of its
own. Each one declares that in its own frontmatter, which is where this table comes from.

| Skill | What It Does |
|-------|-------------|
| **codebase-analyzer** | Launches parallel exploration subagents sized to the task, then has a reporter subagent merge their findings into one report |
| **docs-manager** | The engine behind `.maister/docs/`: file operations, the standards index, and the project instructions that point at it |
| **implementation-plan-executor** | Runs an implementation plan by handing each task group to an implementer subagent and recording progress and the work log -- through the implementation runner subagent where the host can nest subagents, or in the session where it cannot -- and asks only the decisions the waves hand back |
| **implementation-verifier** | Runs verification -- the tests and the project's other checks, the spec conformance, code risk and simplicity reviews, the fixes they call for and their re-checks -- by handing the loop to the verification runner subagent where the host can nest subagents, or in the session where it cannot, and asks only the decisions the loop hands back |
| **orchestrator-framework** | Not executable at all: the shared patterns every orchestrator reads for phase execution, state, gates and initialization |
| **workflow-engine** | Runs a workflow definition as a graph -- resolves it, freezes it into the run's state, executes the ready set, and asks or suspends at each gate according to the run's driver. Handed its runs by a workflow's own command, or by `/maister:run` for a workflow started by name |
