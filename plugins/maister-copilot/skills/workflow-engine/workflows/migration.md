# Migration workflow — node prose

The node-by-node companion to `migration.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need, what guards them and what they declare. It says
nothing about the operator questions asked *inside* a node, what each node
writes into its closing summary for the gate brief, the self-checks that decide whether a
node succeeded, or how many times the engine may re-drive one. Those live here.

**State the consequence plainly**: a reader of `migration.yml` alone cannot see
that the run asks three further questions beyond its six gates — in run
order, the clarification page, the specification's assumptions page and the
issue-resolution fix loop, whose data-integrity halt is its own question — and
the generated diagram does not show them either. Anyone reasoning about how
interactive this workflow is must read this file, not the graph.

**Every question asked inside a node names its default here.** Under a `cockpit`
driver whose features list `question-sets`, a node asks through the cockpit, in
one request per attempt, and each section's **With question sets** line says
whether its question goes there. Under any other `cockpit` or `dispatch` driver
nobody is in the session, so none of them is asked: each takes the default its
own section states under **Without question sets** and the node records that
it did. The rule, the recording shape and what is never defaulted past belong to
the engine skill, which states them once; this file only says what each
question takes.
One of the three is the exception the rule reserves: a data integrity issue is
never defaulted past, and the node fails instead.

**Recovery budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — an attempts key sitting
there would read like a grammar feature while being inert data the engine never
consults. Seven nodes carry a budget; the rest carry none and re-drive nothing.

**A skip does not cascade.** Three nodes are guarded, and a node whose guard is
false is skipped and still satisfies everything downstream. That is why
`resolution-approval` repeats the guard of `issue-resolution` rather than
sitting unguarded behind it: an unguarded gate at the end of a stretch that
never ran would fire and ask an operator to approve nothing.

## The phase numbers, and where they went

The 2.x prose form of this workflow numbered its phases, but no gate question names a
phase number. This table maps the 2.x prose form's phases to nodes:

| 2.x phase | Node | Closing gate |
|---|---|---|
| Initialization steps 1-7 | `intake` | none — it auto-continues |
| 1 | `current-state-analysis` | none — it auto-continues |
| 2 | `gap-analysis` | `gap-approval` |
| 3 | `specification` | `specification-approval` |
| 4 | `planning` | `planning-approval` |
| 5 | `execution` | `execution-approval` |
| 6 | `verification` | `verification-approval` |
| 7 | `issue-resolution` | `resolution-approval` |
| 8 | `documentation` | none — the 2.x prose form has no gate here either |
| no 2.x phase → `finalization` | `finalization` | none — the workflow ends |

Both stretches at the end of this workflow can be skipped. A gate question is
authoring-time constant and covered by the graph hash, so it cannot say where
the run is really going; the gate brief's `Next:` line names the node that
actually runs, with the skipped ones listed (engine § Gates).

---

## Run-scoped context

The four fields every delegate receives outside `with:` — `task_path`,
`html_style_guide_path`, the project's documentation paths and the prior-phase
passage fetched with `prior-context` — and the `${…}` substitution that fills
`with:` are the engine's, stated once in engine § *Run-scoped context* and
§ *Interpolating `${…}`*. What this workflow adds:

- **`task_path`** sits under the type directory `migrations/`, plural.
- **The documentation paths** are discovered by `intake` and recorded as
  `project_context.project_doc_paths`; every later node reads them from state.
- **Three artifacts get an HTML companion** when `html_output` is on: the
  specification, the implementation plan and the verification report. Each
  companion path is registered under `artifacts[].html` on the summary entry
  that owns it.

> **ANTI-PATTERN**: Do NOT re-summarize a summary block. `decisions` and `risks`
> are copied out of the artifact's own Key Decisions and Open Questions / Risks
> blocks **item for item** — the same count, the same words, the artifact's
> order — into `phase_summaries`, into `node_summaries` and into the dashboard,
> each item in the shape engine § Gates gives it: a decision with who settled
> it, a risk with its tag. The items left out are a decision that restates an
> earlier answer and a risk an earlier node already recorded: each is already
> recorded where it was made. Rewriting them in your own words loses the sentence the operator is about to
> approve at a gate; writing an empty `[]` because the node has already read
> the artifact loses it outright, and `decisions: []` beside a specification
> carrying eight of them is the failure this block exists to stop.

---

## Phase summary keys

`node_summaries` is keyed by node id; `migration_context.phase_summaries` is
keyed by this workflow's own semantic keys, and the two namespaces do not line
up. Four keys over four owning nodes:

| Node | `phase_summaries` keys |
|---|---|
| `current-state-analysis` | `current_state_analysis` |
| `gap-analysis` | `gap_analysis` |
| `specification` | `specification` |
| `execution` | `implementation` |

Every other node writes a node summary only. Each mirrored entry also carries
`node:` naming the node it came from, so the two directions stay readable from
either side.

The block is `migration_context`, and this workflow writes no other context
block. A run whose state carries a second one is a run two interpreters wrote,
which the state contract refuses out loud rather than merging.

A phase key is never a node id. The last row above is the one that proves it:
the key `implementation` is owned by the node `execution`. Writing a key off the
node id succeeds and the run keeps going with a key nothing else reads, which is
why the mapping is pinned here rather than derived.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `intake` | `analysis` |
| `current-state-analysis` | `analysis` |
| `gap-analysis` | `analysis` |
| `specification` | `spec` |
| `planning` | `plan` |
| `execution` | `code` |
| `verification` | `verify` |
| `issue-resolution` | `verify` |
| `documentation` | `docs` |
| `finalization` | `done` |

The six gates are not in that table on purpose:
**each gate node renders the icon of the node it closes** — `gap-approval`
`analysis`, `specification-approval` `spec`, `planning-approval` `plan`,
`execution-approval` `code`, `verification-approval` `verify`,
`resolution-approval` `verify`. A gate inherits rather than owns its icon, so a
gate that picked its own would break the visual pairing between a phase and the
approval that closes it.

---

## Embedded mode

**There is none.** This workflow is never invoked as a sub-run of another, which
is why the definition declares no embedded input. Every reference to migration
elsewhere in the tree hands an operator a next step — a suggested command, a
handoff path — rather than executing one, so there is no parent to owe a handoff
block to and no output contract to keep.

If that ever changes, it changes here first, and it is the recipe the engine's
sub-run rule already sets out: an `embedded` input the engine supplies, a guard
on the closing node — here `finalization`, the one node after the guarded
stretches that always runs — and a workflow-level `outputs:` block declaring
what a parent may read. No engine change is involved; see the engine skill's
*Sub-runs* section and the `sub-runs.md` reference beside it. Until then a
reader finding no embedded behaviour has found the intended answer rather than
a gap.

---

## `intake`

Executed inline, before any analysis. It validates the invocation, establishes
the task directory and the state file, and settles the two options later nodes
read.

1. **Capture the clock** — read the wall clock through the shell rather than
   from context. Every timestamp written this turn uses that one value; a
   date-only or midnight-stamped value is the documented failure mode.
2. **Validate the type.** When the `type` input is present it must be one of
   `code`, `data`, `architecture` or `general`. On any other value **record this
   node `failed`**, naming those four in the failure, and the run ends
   `RUN-FAILED` with no further node run. A technology name belongs in the task
   description rather than in this input; when the input is absent the gap
   analysis classifies instead. A valid value is written to
   `migration_context.migration_type` and carried unchanged into the gap
   analysis, which declares it as its closed enum.
   **The task directory survives that failure, and the 2.x prose form's does not.**
   The graph is frozen before the first node runs, so by the time this node can
   reject the value the directory exists. It holds a failed intake and nothing
   else, and the state left behind is what an operator reads before re-invoking
   with a value from the list.
3. **Create and initialize** the task directory under the `migrations/` type
   directory and its state file, with the task description and an empty
   `phase_summaries` map under `migration_context`. The map is the state writer's to seed — the first write that touches
   the context block creates it empty — so a node that has nothing to mirror
   still leaves a reader something to read.
4. **Read the project configuration** and set `options.html_output` (default true
   when the file or the key is absent) and `options.mockup_format` (default
   `html`) beside it. The second is framework-mandated for every orchestrator and
   inert here — no node reads it — but a reader of state expects it. Mirror the `user_docs` input to
   `options.docs_enabled` in the same step: the documentation node is guarded on
   the input, and a reader of state needs the same answer visible where every
   other option lives. When `html_output` is false, skip the dashboard entirely
   — no dashboard asset, no data projection, no browser open. Otherwise the freeze
   installed `dashboard.html` in the task root (see the changed paths it reported)
   — copy nothing; **run the platform opener** on the plain absolute path through
   the shell — `open "<task path>/dashboard.html"` on macOS,
   `xdg-open` on Linux, `start ""` on Windows. Never build a `file://` URL; the
   opener resolves a plain path itself. On failure print the path; never block.
5. **Make sure the user has seen the start banner** (engine Step 4). It is the
   run's first message — if your messages since the freeze do not name the workflow
   and task, the checkpoints, the directory and the dashboard link, write them now,
   from the freeze's output, the paths copied as printed.
6. **Discover the project documentation** — read the documentation index under
   the project's docs directory if one exists and extract every path from its
   project-documentation section, predefined and operator-added alike. Record
   them as `project_context.project_doc_paths`, a top-level sibling of the
   orchestrator and context blocks and never nested inside either — the state
   writer's patch carries `project_context` as its own key.

> **ANTI-PATTERN**: Do NOT print the dashboard path instead of opening it. The
> path hint in the banner is a second copy for the operator's scrollback, not
> the opener — a run whose transcript carries no `open`, `xdg-open` or
> `start ""` shipped a dashboard nobody ever saw, and every projection written
> into it afterwards was written for no reader.

**There is no gate after this node.** It auto-continues into the current-state
analysis.

**Recovery budget**: none — this node establishes state, and a configuration
file it cannot find is an absence rather than a failure. An invalid type is not
a failure to retry either: it is the failure above.

---

## `current-state-analysis`

Delegated to the codebase analyzer through the Skill tool, then a short
clarification round inline.

Delegate the exploration to the codebase-analyzer skill rather than reading the
codebase yourself — it dispatches parallel explorers and writes the structured
analysis every later node reads.

The whole workflow rests on understanding the system before anything is moved,
so the description passed to the analyzer names what is being migrated away
from: the framework, the platform, the schema or the architecture in use today,
and the seams that hold it to the rest of the codebase. A description naming
only the target sends the explorers to code that does not exist yet.

After the skill returns, write the current system's description and its
technologies into `migration_context.current_system`. Then ask the clarifications
as **one page** of at most four tabs (engine § *In-node questions*), one tab for
each thing about the target system or the constraints that the analysis could
not settle. Each tab's question states what the analysis found and what it could
not settle; its options are two or three generated answers, the recommended one
first with its reason in its description, and More details when the tab needs
more than its question holds. Ask only what the analysis could not settle, and
ask nothing when it settled everything. **Never ask here what the
specification's assumptions page frames** — the scope boundaries, the rollback
expectations and downtime tolerance, the data specifics, the dual-run
requirements and the code or configuration to preserve are confirmed there, as
assumptions, after the gap analysis has proposed them. Every answer continues the
run, which is why the page is asked here rather than at a gate.

Save the answers to `analysis/clarifications.md`, then set
`migration_context.clarifications_resolved` to true, and record each answered tab
as a `by: operator` decision on this node's summary, one per question, as engine
§ *In-node questions* says. A run that asked no question still writes the file
and still sets the flag: it resolved the clarifications by having none to ask.

**With question sets** (`clarifications`): asked through the cockpit, in this
node's one request (*In-node questions*).

**Without question sets** (`clarifications`): none is asked, and
the analysis's own answers stand. The file is written and
`migration_context.clarifications_resolved` set exactly as they are for a run
with nothing to ask, and what the analysis could not settle about scope, target
system or constraints is recorded in the file as unsettled rather than guessed
at.

**There is no gate after this node.** It auto-continues into the gap analysis.

**Recovery budget**: 2 attempts — expand the search patterns on the second, and
prompt the operator for file paths when the second also comes back thin.

**Phase summary key**: `current_state_analysis`. Mirror this node's summary into
`migration_context.phase_summaries.current_state_analysis` with the current
system and its technologies, and with `node: current-state-analysis` on the
entry.

---

## `gap-analysis`

Delegated to the gap analyzer through the Task tool. This is the node the whole
workflow turns on: everything after it migrates what this node found missing.

Delegate to the gap-analyzer agent rather than sketching the target state
yourself — it defines the target from the migration description, enumerates the
gaps and recommends the strategy the specification is written against.

The analyzer's five tasks, in order: define the target system from the migration
description; identify the gaps — features to migrate, APIs to adapt, data to
transform; classify the migration type as `code`, `data`, `architecture` or
`general`, **keeping a type the invocation supplied rather than reclassifying
it**; recommend a strategy (incremental, big-bang, dual-run or phased); and
research the target's breaking changes on the web when a version upgrade is in
scope.

**Write the structured result to state before anything else.** Record
`migration_context.migration_type` — the declared value this node emits, which
is what the specification, planning and verification nodes read —
`migration_context.target_system`, `migration_context.migration_strategy`,
`migration_context.risk_level` and `migration_context.breaking_changes`.
`migration_context.target_system` is `{description, technologies}` — the same
shape as `current_system`: a description string and a list of technology
names. `migration_context.migration_strategy` is `{approach, phases}`, where
`approach` is exactly one of `incremental`, `big-bang`, `dual-run` or `phased`,
and `phases` is a list of strings, one per migration phase in order. The
web research lands in `external_research`, a top-level sibling of the context
block rather than a field inside it, under its four keys: `performed`,
`category`, `breaking_changes` and `migration_guide_url` — `performed: false`
with the rest empty when no research was needed, never a shape of its own. With
`external_research.performed: false`, `category` is null and `breaking_changes`
is `[]`; breaking changes found by reading the code go to
`migration_context.breaking_changes`, never into `external_research`.

**Gate brief content.** Read `analysis/target-state-plan.md` and write into this
node's closing `node_summaries` entry, as engine § Gates says: a `headline` — the
recommended strategy and the risk level in one sentence ("Move the API from
Express 4 to 5 incrementally, in three phases; medium risk from two removed
middleware hooks"); a `summary` of one labelled line for each of the current
system, the target system, the migration type classified, how many gaps were
identified, the recommended strategy and the risk level — a one-line recap of
the work does not replace them, because the operator reads the six lines under
More details before approving the strategy; the strategy and the type as
`by: run` decisions, never an earlier answer restated; and each open risk as an `open` risk with its `change`.

**When re-run after a revise.** `gap-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Hand the
analyzer the note and the existing `analysis/target-state-plan.md`, and ask it to
revise the target state in place — the gaps, the strategy or the risk the note
names — keeping the migration type unless the note changes it. Write the
structured result to state and record `migration_type` again, because a revise
clears the declared value. Say in the summary what changed.

**Recovery budget**: 2 attempts — re-prompt for the target details on the
second, and ask the operator when the second also comes back thin.

**Phase summary key**: `gap_analysis`. Mirror this node's summary into
`migration_context.phase_summaries.gap_analysis` with the gap list, the strategy
and the risk level, and with `node: gap-analysis` on the entry.

---

## `gap-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option —
nothing after a stopped node ever becomes ready. Its revise option sends the run
back to `gap-analysis` with the operator's note (engine § Gates, *Revising at a
gate*).

The node the run reaches next is `specification` — nothing between here and
there is guarded — and the gate brief names it.

---

## `specification`

Executed inline in two parts, the second of them delegated. It turns the gap
list into a migration specification the planner can break down, with the
rollback procedure beside it.

**Part A — migration requirements (inline).** Frame three to five confirmable
assumptions from the gap analysis — *"I assume X"* — covering the migration scope
and its boundaries, the rollback expectations and downtime tolerance, and the
existing code or configuration to preserve. The data specifics are an assumption
only when the gap analysis classified the migration as `data`, and the dual-run
requirements only when it recommended a dual-run strategy. Ask them as one
question (engine § *In-node questions*) whose text lists each assumption on a
line of its own, with what it rests on in a few words — never "the assumptions
above" — and offer **"Accept all N as stated (Recommended)"** first, its reason
that each one follows from the approved gap analysis, then "Go through them one
by one", which pages them one tab each, and More details. Record the answer as
`by: operator` decisions, one per question answered, as engine § *In-node
questions* says, and save the round to `analysis/requirements.md`.

**With question sets** (`specification-requirements`): asked through the
cockpit, in this node's one request (*In-node questions*); "Go through them one
by one" would need a second ask, so it is not offered.

**Without question sets** (`specification-requirements`): the
assumptions stand as framed, recorded as one `by: default` decision. They are
written to be confirmable, so an unconfirmed one is recorded in
`analysis/requirements.md` and carried into the specification as a stated
assumption rather than as settled fact. Rollback
expectations and downtime tolerance are the two an operator most needs to see,
so they are named in this node's closing summary for the gate brief whatever
else the round covered.

**Part B — specification creation (delegate).**

Delegate the specification to the specification-creator agent through the Task
tool, whatever the migration's size — it owns `implementation/spec.md` and its
companion, and the planner and the verifier read the spec in that agent's shape.

Pass it the migration task type. Everything node-scoped it needs is in `with:`;
the run-scoped five supply the rest, including the style guide path that
produces the specification's HTML companion, and the project documentation paths
`intake` discovered. Two things are this node's own and reach it in neither:
the requirements path Part A just wrote, `analysis/requirements.md`, and the
migration facts already in state — `migration_context.current_system`,
`target_system`, `risk_level` and `breaking_changes` — which the specification
has to name rather than rediscover.

The rollback plan is written in this node and declared as its artifact, because
every later node reads it: the planner sequences the undo steps, and the
verifier tests them. **The dual-run plan is not declared**, because only a
dual-run strategy produces one — write `analysis/dual-run-plan.md` when the
strategy is dual-run and record it on this node's summary, and write nothing
when it is not.

When the Task tool returns, confirm that `implementation/spec.md` and
`analysis/rollback-plan.md` both exist and that the specification covers the
requirements gathered in Part A; if either file is missing, re-invoke with
corrected context rather than continuing, because the planner and the verifier
both read the rollback plan.

Record `migration_context.rollback_plan_created` and
`migration_context.dual_run_configured` from what actually landed.

**Gate brief content.** Read `implementation/spec.md` and write into this node's
closing `node_summaries` entry, as engine § Gates says: a `headline` — the scope
and the rollback approach in one sentence; the scope boundaries, the rollback
approach, and the rollback expectations and the downtime tolerance — named
whether or not Part A was answered — in `summary`; what the specification
itself settled, the rollback approach say, as `by: run` decisions, beside the
Part A answers already recorded — the strategy stays on `gap-analysis` and no
earlier answer is restated as the specification's; each
breaking change the migration ships on purpose as a `tradeoff` risk; and each
assumption or constraint that could still be wrong as an `open` risk with its
`change`. The `specification-approval` brief is rendered from it.

**When re-run after a revise.** `specification-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Keep
Part A's answers: ask again only what the note reopens. Hand the specification
creator the note with the existing `implementation/spec.md` and
`analysis/rollback-plan.md`, and ask it to revise both in place — the rollback
plan follows any change to the specification it undoes — then record the two
`migration_context` flags from what landed again. Say in the summary what
changed.

**Recovery budget**: 2 attempts — re-gather the requirements and regenerate the
specification and the rollback plan on the second, with the gaps named in the
context.

**Phase summary key**: `specification`. Mirror this node's summary into
`migration_context.phase_summaries.specification`, with `node: specification` on
the entry, and register the companion path under that entry's
`artifacts[].html`.

---

## `specification-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `specification` with the operator's note
(engine § Gates, *Revising at a gate*).

---

## `planning`

Delegated to the implementation planner through the Task tool.

Delegate the plan to the implementation-planner agent, whatever the migration's
size — it produces the task groups, their dependencies and the test-first step
lists the executor runs.

The planner reads the specification, the rollback plan and the migration type,
and sequences the work so that each group leaves the system in a state the
rollback plan can still undo. Rollback steps belong in the plan itself rather
than in a separate document.

When the Task tool returns, confirm that `implementation/implementation-plan.md`
exists and that its groups carry the rollback steps; re-invoke with the
constraint named when either is missing, because a plan without them leaves the
execution with nothing to undo by.

**Gate brief content.** Read `implementation/implementation-plan.md` and write
into this node's closing `node_summaries` entry, as engine § Gates says: a
`headline` — the groups, the steps and whether each carries its rollback step,
in one sentence; a `summary` of one labelled line each for how many task groups
it carries, the total number of steps and whether rollback steps are included;
the key dependencies between groups and the execution sequence as `by: run`
decisions, never an earlier answer restated; open risks, if any, as `open` risks with their `change`. The
`planning-approval` brief is rendered from it.

**When re-run after a revise.** `planning-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Hand the
planner the note and the existing `implementation/implementation-plan.md`, and
ask it to revise the plan in place, keeping a rollback step on every group. Say
in the summary what changed.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
migration constraints named in the context.

**Phase summary key**: none. Register the plan's companion path on this node's
own summary entry under `artifacts[].html`; the four phase keys belong to the
nodes named in the phase-key section above and this is not one of them.

---

## `planning-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `planning` with the operator's note (engine
§ Gates, *Revising at a gate*).

---

## `execution`

Delegated to the implementation-plan executor through the Skill tool. This is
the node that changes code, and it is the only one that does.

Delegate the execution to the implementation-plan-executor skill, whatever the
plan's size — it runs the groups, dispatches the implementers and keeps the
plan's progress marks in step with what actually landed; this node never edits
the migrated code itself.

**The sequential input, and where the executor reads it.** Before invoking the
skill, record the input's value as `orchestrator.options.sequential`: the
executor reads that state key rather than the node input, so an input that is
never landed there is an input the run silently ignores. When it is true the
executor runs one task group at a time instead of dispatching independent groups
in parallel waves. It defaults to parallel, and a migration whose groups share
data state is the usual reason to set it.

**An input the operator did not supply is not an absent value.** `sequential`
declares `default: false`, so an invocation that never names it resolves to
`false` and lands as `false` — never `null`. `null` is what copying an absent
input writes rather than reading the default the definition already gives, and
it is not a value this option has.

**After the skill returns**, reconcile the plan's HTML companion: run the
engine's `sync-plan` verb once against `implementation/implementation-plan.md`.
It is the call the executor makes after every wave, so it is idempotent and a
no-op without a companion — here it catches a wave whose sync was missed. A
companion still showing outstanding work after a complete run is a stale
projection rather than a finding. Then record what
landed: the groups completed, the files changed, the incremental test results
and whether the rollback procedure is still ready to run.

**Gate brief content.** Read `implementation/work-log.md` and write into this
node's closing `node_summaries` entry, as engine § Gates says: a `headline` —
the steps completed, the test result and whether the rollback is still ready, in
one sentence; the migration steps completed, the files changed, the test results
from the incremental runs and the rollback readiness status in `summary`; a
known issue as an `open` risk with its `change`, and an item deferred on purpose
as a `followup` risk. The `execution-approval` brief is rendered from it.

**Recovery budget**: 5 attempts — the widest in the run, because the failures
here are ordinary and local: fix a syntax error, fix an import, fix a failing
test, and re-run. When the fifth attempt has not cleared it, stop and ask the
operator rather than continuing on a red suite.

**Phase summary key**: `implementation`. Mirror this node's summary into
`migration_context.phase_summaries.implementation`, with `node: execution` on
the entry. **The key is not the node id**, and this is the pairing the phase-key
section pins.

---

## `execution-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

---

## `verification`

Delegated to the implementation verifier through the Skill tool, then the
migration-specific checks inline.

Delegate the verification to the implementation-verifier skill rather than
checking the migration yourself — it runs the test suite first, as its own step,
passes that result into every review prompt, and compiles the completeness check
and the reviews into one report.

Pass no style guide path: as a skill it resolves the guide itself and gates its
own companion on the HTML output option.

**Record the review set before invoking it.** This workflow asks no
verification-options question, and the verifier treats a review flag missing
from state as a question for the operator — one nobody answers under a
`cockpit` or `dispatch` driver. So write these `orchestrator.options` keys
first, by these exact names, because the verifier reads them by name:
`code_review_enabled`, `pragmatic_review_enabled` and `reality_check_enabled`
true; `production_check_enabled` false, since the deployment risks a migration
carries are what the compatibility checks and the rollback test below cover;
and `skip_test_suite` false, because a migration is verified against the full
suite, not against the executor's incremental runs.

**The four migration-specific checks.** After the verifier returns, run them and
write `verification/compatibility-test-results.md` — the artifact this node
always declares and always writes, each check recorded as ran and passed, ran
and failed, or not applicable:

1. **The old system still works**, when the strategy is dual-run.
2. **The rollback procedure**, tested non-destructively against the plan
   `specification` wrote.
3. **Data integrity**, for a data migration: the checksums, the row counts and
   the constraints the specification named.
4. **Performance benchmarks**, before and after, when the specification set any.

The verifier has already recorded `verification_context.last_status` and
`verification_context.issues_found`, on every cycle. Add an issue a check raised
to `issues_found` (the issue shape of `orchestrator-patterns.md` § 4). Send the
whole list, because a list replaces what it lands on. Then **declare `issues_to_resolve`**: true
when the report carries at least one open issue the fix loop acts on — one it
can fix, or one that needs the user's decision — **or** any data integrity
issue at all. The second half is deliberate. A data integrity issue is never
fixed, and routing it into `issue-resolution` anyway is what puts the halt in
the node that owns it rather than leaving it to a gate.

**Gate brief content.** Read `verification/implementation-verification.md` and
`verification/compatibility-test-results.md` and write into this node's closing
`node_summaries` entry, as engine § Gates says: a `headline` — the verdict, the
compatibility result and the data integrity status, in one sentence; the overall
verdict, the issue counts by severity, the compatibility results, the data
integrity status and the rollback test results in `summary`. **Tag each blocker
by what it is**: a critical issue still open is an `open` risk with the fix as
its `change`; a consequence the migration accepts on purpose — a breaking change
the specification chose — is a `tradeoff` risk; an issue that predates the
migration, a pre-existing security bug say, is a `followup` risk to fix in its
own change. **When the verdict failed and nothing in it is fixable, add a `stop`
risk** that says why — the 2.x prose form stops the workflow by itself in that
case, and the graph has no routing construct to stop with, so the gate brief
recommending `stop-migration` is what replaces it. The `verification-approval`
brief is rendered from this entry, and its `Next:` line names the node that
actually runs (engine § Gates).

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed. **A data integrity issue is
never one of those attempts**: it is not retried, it is carried into
`issue-resolution`, which halts on it.

---

## `verification-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

**Its `ask:` is neutral where the 2.x prose form's names a phase number, and that
is a recorded divergence.** The 2.x prose form asks "Continue to Phase [7 or 8]?",
interpolating the destination it computed. A gate's `ask:` is authoring-time
constant and covered by the graph hash, so it cannot carry a destination that
differs per run. The gate brief's `Next:` line is where the operator reads where
continuing goes.

**Its stop option is also the route out of a failed verification.** The prose
form stops the workflow automatically when the verdict failed with nothing
fixable; here the operator does it, with the `stop` risk's reason in the gate
brief, which then recommends the stop option.

---

## `issue-resolution`

Executed inline, and **guarded**: it runs only when `verification` declared
`issues_to_resolve`. Skipped, it still satisfies everything downstream, which is
why the gate that closes it repeats the same guard.

**Show the issue breakdown** the verifier returns: the verdict, the counts by
severity, and the report's path from the project root
(`.maister/tasks/migrations/<run>/verification/implementation-verification.md`).

**The fix loop runs on its own for the obvious fixes**
(`orchestrator-patterns.md` § 6, *Fix-Then-Reverify Loop*, which this follows
step by step):

- **Fixed without asking**: every unfixed issue the verifier marked fixable and
  not risky. Log each in the work log, in `verification_context.fixes_applied`
  and in this node's summary's `fixes_applied` as `{finding, change}`, and clear
  `skip_test_suite` when a fix changed code.
- **Re-checked without asking**: a full re-verification after a fix that changed
  behaviour; the verifier's `recheck: tests-only` after fixes that changed none.
  Each raises `verification_context.reverify_count` by one. **Two re-checks run
  without asking.** Say each as "re-check 1 of 2"; never announce a fix before it
  is made. A fix is never a decision: it is recorded in `fixes_applied` alone.
- **Left for later without asking**: an item whose recommendation is to leave
  it — a pre-existing info item that predates the migration — is a `followup`
  risk, never a question.
- **Asked only when** an issue needs the user's
  decision, a fix is risky, the two re-checks are spent with fixable issues still
  open, or there is no progress (the same issues return, or new ones keep
  appearing). Decisions go one per issue, paged as engine § *In-node questions* says, most severe
  first, each with generated ways to tackle it, the recommended one first with
  its reason, its tab stating the issue's file, line and what is wrong and each
  option what it changes; more than about eight first get the triage question.
  A change the user asks for here is applied, logged and re-checked like any
  fix — the gate after this node offers no revise, so this is where such a
  change is taken. Each answered question is a `by: operator` decision.
- **The stopping question** names what is left — the counts by severity and the
  worst item in a few words. **With a critical issue left**, it offers **"Stop
  here (Recommended): roll back with the plan's rollback steps"**, then "One
  more round" and "Continue as is"; "Stop here" writes a `stop` risk naming the
  issue and `analysis/rollback-plan.md`, so the gate recommends stopping and the
  end of the run names the rollback steps. **Without one**, it offers "One more
  round", "Continue as is" and "Stop", recommending "Continue as is" when only
  warnings remain and "One more round" when the last round made progress, the
  reason in the option's description. "Continue as is" leaves each undecided
  issue an `open` risk for the gate.

**Data integrity is never fixed without the user, and never by default.** A data
integrity issue is neither fixable nor a decision page item: it halts the loop
before anything else is asked. Under a terminal driver, ask one question whose
text names the issue — the table, the check that failed and by how much — and
offers **"Stop and roll back (Recommended)"**, its description saying the run
stops at the next checkpoint and the plan's rollback steps undo the migration,
then **"Continue anyway: I accept the data risk"**. "Stop and roll back" writes a
`stop` risk naming the issue and `analysis/rollback-plan.md`, so the gate
recommends stopping; the run never rolls anything back on its own. "Continue
anyway" records the answer as a `by: operator` decision and the issue as a
`tradeoff` risk, and the loop goes on with the remaining issues. With question
sets, the same question goes through the cockpit when it is the first thing this
node asks in its attempt. Otherwise, and under any other driver, there is nobody
to ask: **record this node `failed`**, and the run ends
`RUN-FAILED` with the state intact — the user arrives to the migration as the
verification left it, rather than to an automated repair already applied to their
data.

**With question sets** (`verification-fix-loop`): asked through the cockpit only
when it is the first thing this node asks in its attempt, with the verification
report and every fix so far written first; after an earlier request in the same
attempt, the default below is taken (*In-node questions*).

**Without question sets** (`verification-fix-loop`): the loop runs
exactly as above — fixable, non-risky issues fixed and re-checked within the same
two re-checks — and nothing is asked. Every issue that needs a decision, and every
risky fix, stays open as an `open` risk in this node's summary, and the stopping
point takes "Continue as is". An issue still critical is **not** proceeded past:
it is an `open` risk, which the gate brief shows at `resolution-approval` — where a person
answers.

**Exit conditions**: nothing fixable or undecided is left; or the user chose
"Continue as is"; or they chose "Stop". **Never proceed past an unresolved
critical issue without an explicit answer saying so** — a gate answered from
outside is such an answer; a default is not.

> **GATE CHECK**: the canonical report and its companion must carry the *final*
> post-fix verdict before this node completes. A report still showing the
> pre-fix state after fixes landed is a stale artifact, and the operator answers
> the next gate against it. Recompile it rather than leaving a side file to
> carry the truth.

**Gate brief content.** Write into this node's closing `node_summaries` entry,
as engine § Gates says: a `headline` — what was fixed, what is left and whether
the run recommends stopping, in one sentence; the total issues found, how many
were fixed and how many remain by severity in `summary`; each fix made without
asking — the issue and the change in a few words each — in `fixes_applied`, so
the checkpoint shows exactly what changed without the user choosing it, never
also as a decision; each answered question
as a `by: operator` decision; no earlier answer restated; each issue still needing a decision as an `open`
risk with the fix as its `change`; each item left for later as a `followup`
risk; a data risk the user accepted as a `tradeoff` risk; and the `stop` risk
when the user chose to stop and roll back. The `resolution-approval` brief is
rendered from it.

**Recovery budget**: none — this node's own loop, two re-checks without asking, is its limit,
and re-driving a node that halts on data integrity would re-run the thing it
refused.

---

## `resolution-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, **guarded on the same value as `issue-resolution`**. It asks only when
that stretch ran; when the stretch was skipped this gate is skipped with it, and
the run goes straight on to whatever comes next.

Record the answer, and stop the run on the stop option.

**Its `ask:` names the documentation, which may be skipped.** The gate brief's
`Next:` line names `finalization` when `user_docs` is false, so an operator
answering "continue to documentation" is never surprised by a run that ends
instead.

**It is also the third answer the 2.x prose form has and the graph does not.** When
the fix iterations run out, the 2.x prose form asks whether to proceed with warnings
or to roll back. A gate's third effect, revise, only reruns an earlier node with
the operator's note, and no effect rolls anything back — this gate offers just its
continue and its stop — so the rollback recommendation is a `stop` risk in the
`issue-resolution` summary — the gate brief then recommends the stop option —
and the stop option here is what acts on it.

---

## `documentation`

Delegated to the user documentation generator through the Task tool, and
**guarded** on the `user_docs` input. It runs only when the invocation asked for
a guide; absent means off, and nothing in this workflow asks about it in
session.

Delegate the guide to the user-docs-generator agent rather than writing it
yourself — it writes for the end user rather than for the engineer, and captures
the screenshots the guide needs.

The guide covers the migration overview and its goals, the prerequisites and the
preparation steps, the step-by-step procedure, the rollback procedure and the
troubleshooting for the problems the verification actually found.

**The prior decisions are background for this delegate, not content.** Fetch
them with `prior-context --background` rather than the plain form: the guide is
for the people who run the migration, and the run's decisions and risks are what
it must stay consistent with, never a section of it.

**Node summary.** This node's closing `node_summaries` entry lifts the guide's
Key Decisions item for item into `decisions` as `by: run` — one entry per item,
in the guide's order, none merged and none reworded, leaving out an item that
restates an earlier answer — and its open questions and
risks the same way into `risks`, each tagged by what it is.

**This is a stretch of one, with no gate after it.** The 2.x prose form has none
either, so nothing here repeats its guard onto a following gate — the guard ends
with the node.

**Recovery budget**: 1 attempt — on a failure, generate the guide as text only,
without screenshots, rather than leaving the run without one.

---

## `finalization`

Executed inline, writes no files, and **always runs**. It is the one node in
this workflow the 2.x prose form has no phase for, and it exists because the two
stretches before it are guarded: a dispatched run has to publish its close-out
from a node that no guard can skip.

1. **Inventory the outputs**: the current-state analysis, the clarifications,
   the target-state plan, the requirements, the specification, the rollback
   plan, the implementation plan, the work log, the verification report and the
   compatibility results. The migration guide is there only when the run was
   asked for one, and the dual-run plan only for a dual-run strategy — name each
   absent one as skipped rather than as missing, and every other absence as a
   defect. Take the inventory from disk and not from state: compare every
   artifact the run declared against what is actually there, and name every
   declared path that is absent (`orchestrator-patterns.md` § 10).
2. **Present the executive summary**: what was migrated and to what, the
   strategy used, the verification verdict with any issues left open, whether
   the rollback procedure was tested and whether it is still available.
3. **Set the task status to completed**.
4. **Guide the next steps**, which for this workflow are its own four: exercise
   the migrated system by hand before trusting it; keep the rollback plan
   reachable until the new system has run in production long enough to trust;
   watch the data and the error rates after deployment, closely for a data
   migration; and retire the old system, or the dual-run configuration, only
   once both have been true for a while. Suggest a fresh session for whatever
   comes next rather than continuing in this one.

**Close for whoever reads the end** (the engine skill's run-end rule). In a
terminal run a person reads it: write the closing patch and call `run-complete`
first, then end with one wrap-up message that fits one screen and is the last
thing the run prints. Its sections are the engine's six — Done, Needs you,
Follow-ups, Next, Files, Dashboard — and nothing follows the Dashboard line.
**Next** holds every one of step 4's next steps, a line each: all four of this
workflow's own, then the fresh-session suggestion, none dropped or merged. Each
artifact the verb reported missing is named in plain words under **Needs you**.
Nothing about how the run was carried out appears unless it changed the
result. The verb's own lines are never shown. Under a `cockpit` or `dispatch`
driver tooling reads it, and the order is reversed: the executive summary and
every next step are printed as ordinary text **before** the `run-complete` call;
after it, print nothing but the lines the verb printed, copied exactly, its
marker last. Never type a marker the verb did not print.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the executive summary above. A dispatching chain
has no second way to learn this run is over: a run that finishes and publishes
nothing leaves the chain waiting forever, with the work done and every local sign
saying success. The engine refuses a dispatched run that reaches its end with no
close-out in the outbox (`RUN-FAILED: closeout-unpublished`). Under a terminal
driver there is no seed and no outbox, and step 4 above is what the operator gets
instead.

There is no gate after this node. The workflow ends here.

**Recovery budget**: none — this node summarizes and nothing else.
