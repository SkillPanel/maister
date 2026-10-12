# Migration workflow — node prose

The node-by-node companion to `migration.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot**: the operator questions asked
*inside* a node, what each node writes into its closing summary for the gate
brief, the self-checks that decide whether a node succeeded, and how many times
the engine may re-drive one. Beyond its six gates the run asks three further
questions — in run order, the clarification page, the specification's
assumptions page and the issue-resolution fix loop, with a question per issue
and a data-integrity halt of its own. Neither `migration.yml` nor its diagram
shows them.

**Every question asked inside a node names its default here.** Under a `cockpit`
driver whose features list `question-sets`, a node asks through the cockpit, in
one request per attempt, as its section's **With question sets** line says.
Under any other `cockpit` or `dispatch` driver nobody is asked: each question
takes the default its section states under **Without question sets**, and the
node records that it did. The rule and the recording shape are the engine's
(`references/in-node-questions.md` § *When nobody can be asked*). One exception:
a data integrity issue is never defaulted past, and the node fails instead.

**When the run's policy classes in-node questions** — the freeze recorded
`orchestrator.classes_questions` — a node sends the question set it would ask to
the writer before asking anything, and asks only the ids the writer's `ask:`
line names; the rest are already on the node's summary (engine
`references/in-node-questions.md` § *When the policy classes a question*). No
section below changes for it.

**Recovery budgets are prose**, never `with:` data (engine *Recording an
outcome*). Seven nodes carry one; the rest re-drive nothing.

**A skip does not cascade.** Three nodes are guarded; a skipped node still
satisfies everything downstream. That is why `resolution-approval` repeats the
guard of `issue-resolution`: unguarded, it would ask an operator to approve a
stretch that never ran. Both stretches at the end can be skipped, so the gate
brief's `Next:` line, not a gate's question, names the node that actually runs,
with the skipped ones listed (engine `references/gates.md`).

---

## Run-scoped context

Every delegate prompt opens with the `run-context --node=<this node>` output,
pasted unedited (artifact writers: `prior-context --node=<this node>`, which
prints that block first): the task path, the HTML style guide, the documentation
paths, the scratch rule and the companions the node owes. What this workflow adds:

- **`task_path`** sits under the type directory `migrations/`, plural.
- **The documentation paths** are discovered by `intake` and recorded as
  `project_context.project_doc_paths`; every later node reads them from state.

> **ANTI-PATTERN**: Do NOT re-summarize a summary block. `decisions` and `risks`
> are copied out of the artifact's own Key Decisions and Open Questions / Risks
> blocks **item for item** — the same count, the same words, the artifact's
> order — into `phase_summaries`, `node_summaries` and the dashboard, each in
> the shape engine `references/gates.md` gives it. Left out are only a decision
> that restates an earlier answer and a risk an earlier node already recorded.
> `decisions: []` beside a specification carrying eight of them is the failure
> this block exists to stop.

---

## Phase summary keys

`node_summaries` is keyed by node id; `migration_context.phase_summaries` by
this workflow's own semantic keys. Four keys over four owning nodes:

| Node | `phase_summaries` keys |
|---|---|
| `current-state-analysis` | `current_state_analysis` |
| `gap-analysis` | `gap_analysis` |
| `specification` | `specification` |
| `execution` | `implementation` |

Every other node writes a node summary only. Each mirrored entry carries
`node:` naming the node it came from. `migration_context` is the only context
block this workflow writes. A phase key is never a node id — the key
`implementation` is owned by the node `execution`; a key written off the node id
succeeds and nothing reads it, so the mapping is pinned here.

---

## Icon hints

Each node writes the `icon_hint` named here; it is not derivable from the id:

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

**Each gate node renders the icon of the node it closes** — `gap-approval`
`analysis`, `specification-approval` `spec`, `planning-approval` `plan`,
`execution-approval` `code`, `verification-approval` `verify`,
`resolution-approval` `verify`.

---

## Embedded mode

**There is none.** Nothing runs this workflow as a sub-run, so the definition
declares no `embedded` input. Making it child-capable follows engine
`references/sub-runs.md` § *Making a workflow child-capable*, with the guard on
`finalization`, the one node after the guarded stretches that always runs.

---

## `intake`

Executed inline, before any analysis. It validates the invocation, establishes
the task directory and the state file, and settles the two options later nodes
read.

1. **Capture the clock** through the shell, not from context. Every timestamp
   written this turn uses that one value; a date-only or midnight-stamped value
   is the documented failure mode.
2. **Validate the type.** When the `type` input is present it must be one of
   `code`, `data`, `architecture` or `general`. On any other value **record this
   node `failed`**, naming those four in the failure, and the run ends
   `RUN-FAILED` with no further node run. A technology name belongs in the task
   description; when the input is absent the gap analysis classifies instead. A
   valid value is written to `migration_context.migration_type` and carried
   unchanged into the gap analysis. The task directory survives that failure —
   the graph is frozen before this node runs — holding a failed intake and
   nothing else.
3. **Create and initialize** the task directory under the `migrations/` type
   directory and its state file, with the task description and an empty
   `phase_summaries` map under `migration_context` — the writer seeds it on the
   first write that touches the block.
4. **Read the project configuration** and set `options.html_output` (default
   true when the file or the key is absent) and `options.mockup_format` (default
   `html`; no node here reads it, but a reader of state expects it). Mirror the
   `user_docs` input to `options.docs_enabled` in the same step. When
   `html_output` is false, skip the dashboard entirely — no dashboard asset, no
   data projection, no browser open. Otherwise the freeze installed
   `dashboard.html` in the task root — copy nothing; **run the platform opener**
   on the plain absolute path through the shell — `open "<task
   path>/dashboard.html"` on macOS, `xdg-open` on Linux, `start ""` on Windows.
   Never build a `file://` URL. On failure print the path; never block.
5. **Make sure the user has seen the start banner** (engine Step 4). If your
   messages since the freeze do not name the workflow and task, the checkpoints,
   the directory and the dashboard link, write them now, from the freeze's
   output, the paths copied as printed.
6. **Discover the project documentation** — from the documentation index under
   the project's docs directory, if one exists, extract every path in its
   project-documentation section, predefined and operator-added alike, into
   `project_context.project_doc_paths`: a top-level key of the patch, never
   nested inside the orchestrator or context block.

> **ANTI-PATTERN**: Do NOT print the dashboard path instead of opening it. A
> transcript with no `open`, `xdg-open` or `start ""` shipped a dashboard nobody
> ever saw.

**There is no gate after this node.** It auto-continues into the current-state
analysis.

**Recovery budget**: none — a configuration file it cannot find is an absence,
not a failure, and an invalid type is the failure above, never retried.

---

## `current-state-analysis`

Delegated to the codebase-analyzer skill through the Skill tool, then a short
clarification round inline.

The description passed to the analyzer names what is being migrated away from:
the framework, the platform, the schema or the architecture in use today, and
the seams that hold it to the rest of the codebase. A description naming only
the target sends the explorers to code that does not exist yet.

After the skill returns, write the current system's description and its
technologies into `migration_context.current_system`. Then ask the clarifications
as **one page** of at most four tabs (engine `references/in-node-questions.md`), one tab for
each thing about the target system or the constraints that the analysis could
not settle. Each tab's question states what the analysis found and what it could
not settle; its options are two or three generated answers, the recommended one
first with its reason in its description, and More details when the tab needs
more than its question holds. Ask nothing when the analysis settled everything.
**Never ask here what the specification's assumptions page frames** — the scope
boundaries, the rollback expectations and downtime tolerance, the data
specifics, the dual-run requirements and the code or configuration to preserve
are confirmed there, after the gap analysis has proposed them.

Save the answers to `analysis/clarifications.md`, then set
`migration_context.clarifications_resolved` to true — also when nothing was
asked — and record each answered tab as a `by: operator` decision on this node's
summary, one per question.

**With question sets** (`clarifications`): asked through the cockpit, in this
node's one request (engine `references/in-node-questions.md`).

**Without question sets** (`clarifications`): none is asked, and
the analysis's own answers stand. The file is written and
`migration_context.clarifications_resolved` set as for a run with nothing to
ask; what the analysis could not settle about scope, target system or
constraints is recorded in the file as unsettled rather than guessed at.

**There is no gate after this node.** It auto-continues into the gap analysis.

**Recovery budget**: 2 attempts — expand the search patterns on the second, and
prompt the operator for file paths when the second also comes back thin.

**Phase summary key**: `current_state_analysis`. Mirror this node's summary into
`migration_context.phase_summaries.current_state_analysis` with the current
system and its technologies, and with `node: current-state-analysis` on the
entry.

---

## `gap-analysis`

Delegated to the gap-analyzer agent through the Task tool. Everything after
this node migrates what it found missing.

The analyzer's five tasks, in order: define the target system from the migration
description; identify the gaps — features to migrate, APIs to adapt, data to
transform; classify the migration type as `code`, `data`, `architecture` or
`general`, **keeping a type the invocation supplied rather than reclassifying
it**; recommend a strategy (incremental, big-bang, dual-run or phased); and
research the target's breaking changes on the web when a version upgrade is in
scope.

**Write the structured result to state before anything else.** Record
`migration_context.migration_type` — the declared value this node emits, which
the specification, planning and verification nodes read —
`migration_context.target_system`, `migration_context.migration_strategy`,
`migration_context.risk_level` and `migration_context.breaking_changes`.
`target_system` is `{description, technologies}`, the shape of
`current_system`. `migration_strategy` is `{approach, phases}`: `approach` is
exactly one of `incremental`, `big-bang`, `dual-run` or `phased`, and `phases` a
list of strings, one per migration phase in order. The web research lands in
`external_research`, a top-level sibling of the context block, under its four
keys: `performed`, `category`, `breaking_changes` and `migration_guide_url`.
With no research needed, `performed: false`, `category` null and
`breaking_changes` `[]`; breaking changes found by reading the code go to
`migration_context.breaking_changes`, never into `external_research`.

**Gate brief content.** Read `analysis/target-state-plan.md` and write into this
node's closing `node_summaries` entry, as engine `references/gates.md` says: a `headline` — the
recommended strategy and the risk level in one sentence ("Move the API from
Express 4 to 5 incrementally, in three phases; medium risk from two removed
middleware hooks"); a `summary` of one labelled line for each of the current
system, the target system, the migration type classified, how many gaps were
identified, the recommended strategy and the risk level — a one-line recap does
not replace them; the strategy and the type as `by: run` decisions, never an
earlier answer restated; and each open risk as an `open` risk with its `change`.

**When re-run after a revise.** `prior-context` carries the operator's note
under *Revision requested*. Hand the analyzer the note and the existing
`analysis/target-state-plan.md` to revise in place — the gaps, the strategy or
the risk the note names — keeping the migration type unless the note changes it.
Write the structured result to state and record `migration_type` again, because
a revise clears the declared value. Say in the summary what changed.

**Recovery budget**: 2 attempts — re-prompt for the target details on the
second, and ask the operator when the second also comes back thin.

**Phase summary key**: `gap_analysis`. Mirror this node's summary into
`migration_context.phase_summaries.gap_analysis` with the gap list, the strategy
and the risk level, and with `node: gap-analysis` on the entry.

---

## `gap-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option —
nothing after a stopped node ever becomes ready. Its revise option sends the run
back to `gap-analysis` with the operator's note (engine `references/gates.md`, *Revising at a
gate*). `specification` runs next.

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
question (engine `references/in-node-questions.md`) whose text lists each assumption on a
line of its own, with what it rests on in a few words — never "the assumptions
above" — and offer **"Accept all N as stated (Recommended)"** first, its reason
that each one follows from the approved gap analysis, then "Go through them one
by one", which pages them one tab each, and More details. Record the answer as
`by: operator` decisions, one per question answered, and save the round to
`analysis/requirements.md`.

**With question sets** (`specification-requirements`): asked through the
cockpit, in this node's one request (engine `references/in-node-questions.md`); "Go through them one
by one" would need a second ask, so it is not offered.

**Without question sets** (`specification-requirements`): the
assumptions stand as framed, recorded as one `by: default` decision, and carried
into `analysis/requirements.md` and the specification as stated assumptions
rather than settled fact. The rollback expectations and the downtime tolerance
are named in this node's closing summary whatever else the round covered.

**Part B — specification creation (delegate).** Invoke the
specification-creator agent through the Task tool, whatever the migration's
size, with the migration task type. Everything node-scoped it needs is in
`with:`; the `prior-context --node=specification` output supplies the rest, the
`html:` line and the documentation paths included. Two things are this node's
own and reach it in neither: the requirements path Part A just wrote,
`analysis/requirements.md`, and the migration facts already in state —
`migration_context.current_system`, `target_system`, `risk_level` and
`breaking_changes` — which the specification has to name rather than rediscover.

The rollback plan is written in this node and declared as its artifact: the
planner sequences the undo steps, and the verifier tests them. **The dual-run
plan is not declared** — write `analysis/dual-run-plan.md` only when the
strategy is dual-run, and record it on this node's summary.

When the Task tool returns, confirm that `implementation/spec.md` and
`analysis/rollback-plan.md` both exist and that the specification covers the
requirements gathered in Part A; if either file is missing, re-invoke with
corrected context rather than continuing.

Record `migration_context.rollback_plan_created` and
`migration_context.dual_run_configured` from what actually landed.

**Gate brief content.** Read `implementation/spec.md` and write into this node's
closing `node_summaries` entry, as engine `references/gates.md` says: a `headline` — the scope
and the rollback approach in one sentence; the scope boundaries, the rollback
approach, and the rollback expectations and the downtime tolerance — named
whether or not Part A was answered — in `summary`; what the specification
itself settled, the rollback approach say, as `by: run` decisions, beside the
Part A answers already recorded — the strategy stays on `gap-analysis` and no
earlier answer is restated as the specification's; each
breaking change the migration ships on purpose as a `tradeoff` risk; and each
assumption or constraint that could still be wrong as an `open` risk with its
`change`.

**When re-run after a revise.** `prior-context` carries the operator's note
under *Revision requested*. Keep Part A's answers: ask again only what the note
reopens. Hand the specification creator the note with the existing
`implementation/spec.md` and `analysis/rollback-plan.md` to revise both in place
— the rollback plan follows any change to what it undoes — then record the two
`migration_context` flags again. Say in the summary what changed.

**Recovery budget**: 2 attempts — re-gather the requirements and regenerate the
specification and the rollback plan on the second, with the gaps named in the
context.

**Phase summary key**: `specification`. Mirror this node's summary into
`migration_context.phase_summaries.specification`, with `node: specification` on
the entry, and register the companion path under that entry's
`artifacts[].html`.

---

## `specification-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `specification` with the operator's note
(engine `references/gates.md`, *Revising at a gate*).

---

## `planning`

Delegated to the implementation-planner agent through the Task tool, whatever
the migration's size. It reads the specification, the rollback plan and the
migration type, and sequences the work so that each group leaves the system in a
state the rollback plan can still undo. Rollback steps belong in the plan
itself.

When the Task tool returns, confirm that `implementation/implementation-plan.md`
exists and that its groups carry the rollback steps; re-invoke with the
constraint named when either is missing.

**Gate brief content.** Read `implementation/implementation-plan.md` and write
into this node's closing `node_summaries` entry, as engine `references/gates.md` says: a
`headline` — the groups, the steps and whether each carries its rollback step,
in one sentence; a `summary` of one labelled line each for how many task groups
it carries, the total number of steps and whether rollback steps are included;
the key dependencies between groups and the execution sequence as `by: run`
decisions, never an earlier answer restated; open risks, if any, as `open` risks with their `change`.

**When re-run after a revise.** `prior-context` carries the operator's note
under *Revision requested*. Hand the planner the note and the existing
`implementation/implementation-plan.md` to revise in place, keeping a rollback
step on every group. Say in the summary what changed.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
migration constraints named in the context.

**Phase summary key**: none. Register the plan's companion path on this node's
own summary entry under `artifacts[].html`.

---

## `planning-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `planning` with the operator's note (engine
`references/gates.md`, *Revising at a gate*).

---

## `execution`

Delegated to the implementation-plan-executor skill through the Skill tool,
whatever the plan's size. It is the only node that changes code; this node never
edits the migrated code itself.

**Before invoking the skill, record the `sequential` input as
`orchestrator.options.sequential`** — the executor reads that state key, not the
node input. True runs one task group at a time instead of parallel waves; a
migration whose groups share data state is the usual reason to set it. An input
the operator did not supply resolves to its declared `default: false` and lands
as `false`, never `null`.

**After the skill returns**, run the engine's `sync-plan` verb once against
`implementation/implementation-plan.md`: idempotent, and a no-op without a
companion, it catches a wave whose sync was missed. Then record what landed:
the groups completed, the files changed, the incremental test results and
whether the rollback procedure is still ready to run.

**Gate brief content.** Read `implementation/work-log.md` and write into this
node's closing `node_summaries` entry, as engine `references/gates.md` says: a `headline` —
the steps completed, the test result and whether the rollback is still ready, in
one sentence; the migration steps completed, the files changed, the test results
from the incremental runs and the rollback readiness status in `summary`; a
known issue as an `open` risk with its `change`, and an item deferred on purpose
as a `followup` risk.

**Recovery budget**: 5 attempts — the failures here are ordinary and local: fix
a syntax error, an import or a failing test, and re-run. When the fifth attempt
has not cleared it, stop and ask the operator rather than continuing on a red
suite.

**Phase summary key**: `implementation`. Mirror this node's summary into
`migration_context.phase_summaries.implementation`, with `node: execution` on
the entry. **The key is not the node id.**

---

## `execution-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

---

## `verification`

Delegated to the implementation-verifier skill through the Skill tool, then the
migration-specific checks inline. Pass no style guide path: as a skill it
resolves the guide itself and gates its own companion on the HTML output option.

**Record the review set before invoking it.** This workflow asks no
verification-options question, and the verifier treats a review flag missing
from state as a question for the operator — one nobody answers under a
`cockpit` or `dispatch` driver. So write these `orchestrator.options` keys
first, by these exact names: `code_review_enabled`, `pragmatic_review_enabled`
and `reality_check_enabled` true; `production_check_enabled` false, since the
compatibility checks and the rollback test below cover a migration's deployment
risks; and `skip_test_suite` false, because a migration is verified against the
full suite.

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
to `issues_found` (the issue shape of `orchestrator-patterns.md` § 4), sending
the whole list, because a list replaces what it lands on. Then **declare
`issues_to_resolve`**: true when the report carries at least one open issue the
fix loop acts on — one it can fix, or one that needs the user's decision —
**or** any data integrity issue at all. A data integrity issue is never fixed;
routing it into `issue-resolution` puts the halt in the node that owns it.

**Gate brief content.** Read `verification/implementation-verification.md` and
`verification/compatibility-test-results.md` and write into this node's closing
`node_summaries` entry, as engine `references/gates.md` says: a `headline` — the verdict, the
compatibility result and the data integrity status, in one sentence; the overall
verdict, the issue counts by severity, the compatibility results, the data
integrity status and the rollback test results in `summary`. **Tag each blocker
by what it is**: a critical issue still open is an `open` risk with the fix as
its `change`; a consequence the migration accepts on purpose — a breaking change
the specification chose — is a `tradeoff` risk; an issue that predates the
migration, a pre-existing security bug say, is a `followup` risk to fix in its
own change. **When the verdict failed and nothing in it is fixable, add a `stop`
risk** that says why, so the gate brief recommends `stop-migration`.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed. **A data integrity issue is
never one of those attempts**: it is not retried, it is carried into
`issue-resolution`, which halts on it.

---

## `verification-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
question names no destination; the brief's `Next:` line says where continuing
goes. **Its stop option is also the route out of a failed verification**, which
the brief then recommends with the `stop` risk's reason.

---

## `issue-resolution`

Executed inline, and **guarded**: it runs only when `verification` declared
`issues_to_resolve`; the gate that closes it repeats the same guard.

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
- **Asked only when** an issue needs the user's decision, a fix is risky, the
  two re-checks are spent with fixable issues still open, or there is no
  progress (the same issues return, or new ones keep appearing) — and only once
  the automatic fixes and re-checks are done. **Each such issue is its own
  question** (engine `references/in-node-questions.md` § *Findings that need a decision*): write the verifier's
  decision fields for those issues to `verification/issue-resolution-findings.json`,
  each issue's `id` the verifier's `name` (issues with one root cause are one
  finding), and build the set with `finding-brief` for this node. Send it
  through the classing write when the run classes questions, then ask what is
  left to ask, paged, the first question naming the report's path; more than
  about eight first get the triage question. A change the user picks is
  applied, logged and re-checked like any fix — the gate after this node offers
  no revise, so this is where such a change is taken; an accepted risk becomes
  a `tradeoff` risk; a held choice goes on provisionally, and
  `resolution-approval` approves it. A file `finding-brief` cannot use is a
  fallback: compose the same questions yourself.
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
integrity issue is neither fixable nor a finding question: it halts the loop
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
to ask: **record this node `failed`**, and the run ends `RUN-FAILED` with the
state intact — never an automated repair applied to the user's data.

**With question sets** (`issue-resolution-findings`): asked through the cockpit
as this node's one request in its attempt, with the verification report and
every fix so far written first; after the data-integrity question in the same
attempt, the default below is taken.

**Without question sets** (`issue-resolution-findings`): nothing is asked. An
issue the policy does not class stays open as an `open` risk; a classed one
takes the outcome the classing write gives it.

**With question sets** (`verification-fix-loop`): asked through the cockpit only
when it is the first thing this node asks in its attempt, with the verification
report and every fix so far written first; after an earlier request in the same
attempt — the finding questions — the default below is taken (engine `references/in-node-questions.md`).

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
> post-fix verdict before this node completes. Recompile a report still showing
> the pre-fix state rather than leaving a side file to carry the truth.

**Gate brief content.** Write into this node's closing `node_summaries` entry,
as engine `references/gates.md` says: a `headline` — what was fixed, what is left and whether
the run recommends stopping, in one sentence; the total issues found, how many
were fixed and how many remain by severity in `summary`; each fix made without
asking — the issue and the change in a few words each — in `fixes_applied`,
never also as a decision; each answered question as a `by: operator` decision,
as the writer folds it; each risk the user accepted on a finding question as a
`tradeoff` risk; no earlier answer restated; each issue still needing a decision
as an `open` risk with the fix as its `change`; each item left for later as a
`followup` risk; a data risk the user accepted as a `tradeoff` risk; and the
`stop` risk when the user chose to stop and roll back.

**Recovery budget**: none — this node's own loop, two re-checks without asking,
is its limit, and re-driving a node that halts on data integrity would re-run
the thing it refused.

---

## `resolution-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, **guarded on the same value as `issue-resolution`**: skipped with that
stretch, and the run goes straight on to whatever comes next. Record the answer,
and stop the run on the stop option.

**Its `ask:` names the documentation, which may be skipped**; the gate brief's
`Next:` line names `finalization` when `user_docs` is false.

It offers just its continue and its stop; nothing rolls back automatically. A
rollback recommendation is a `stop` risk in the `issue-resolution` summary — the
gate brief then recommends the stop option — and the stop option here acts on it.

---

## `documentation`

Delegated to the user-docs-generator agent through the Task tool, and
**guarded** on the `user_docs` input: it runs only when the invocation asked for
a guide; absent means off, and nothing in this workflow asks about it in
session.

The guide covers the migration overview and its goals, the prerequisites and the
preparation steps, the step-by-step procedure, the rollback procedure and the
troubleshooting for the problems the verification actually found.

**The prior decisions are background for this delegate, not content.** Fetch
them with `prior-context --background` rather than the plain form: the guide
must stay consistent with the run's decisions and risks, never carry them as a
section.

**Node summary.** This node's closing `node_summaries` entry lifts the guide's
Key Decisions item for item into `decisions` as `by: run` — one entry per item,
in the guide's order, none merged and none reworded, leaving out an item that
restates an earlier answer — and its open questions and
risks the same way into `risks`, each tagged by what it is.

**This is a stretch of one, with no gate after it**; the guard ends with the
node.

**Recovery budget**: 1 attempt — on a failure, generate the guide as text only,
without screenshots, rather than leaving the run without one.

---

## `finalization`

Executed inline, writes no files, and **always runs**: the two stretches before
it are guarded, and a dispatched run has to publish its close-out from a node
that no guard can skip.

1. **Inventory the outputs**: the current-state analysis, the clarifications,
   the target-state plan, the requirements, the specification, the rollback
   plan, the implementation plan, the work log, the verification report and the
   compatibility results. The migration guide is there only when the run was
   asked for one, and the dual-run plan only for a dual-run strategy — name each
   absent one as skipped rather than as missing, and every other absence as a
   defect. Take the inventory from disk, not from state: `run-complete`
   checks every declared artifact and every declared HTML companion, printing a
   `missing-artifact:` or `missing-companion:` line for each one absent, and
   those lines are relayed below; check by hand only a path a summary lists
   beyond the declarations (`orchestrator-patterns.md` § 10).
2. **Present the executive summary**: what was migrated and to what, the
   strategy used, the verification verdict with any issues left open, whether
   the rollback procedure was tested and whether it is still available.
3. **Set the task status to completed**.
4. **Guide the next steps**, this workflow's own four: exercise the migrated
   system by hand before trusting it; keep the rollback plan reachable until the
   new system has run in production long enough to trust; watch the data and
   the error rates after deployment, closely for a data migration; and retire
   the old system, or the dual-run configuration, only once both have been true
   for a while. Suggest a fresh session for whatever comes next.

**Close for whoever reads the end**, as the engine's *Operator visibility*
says: in a terminal run, the closing patch and `run-complete` first, then the
six-section wrap-up as the last thing printed. **Next** holds every one of step
4's next steps, a line each — all four, then the fresh-session suggestion, none
dropped or merged. Each `missing-artifact:` and `missing-companion:` line the
verb printed is named in plain words under **Needs you**. Under a `cockpit` or
`dispatch` driver the executive summary and every next step are printed
**before** the `run-complete` call; after it, nothing but the lines the verb
printed, copied exactly, its marker last. Never type a marker the verb did not
print.

**No close-out while a choice is held.** When the freeze recorded
`orchestrator.classes_questions`, this node runs `gate-brief --node=held-approval` before its
closing patch and before any close-out, as the engine's *Ending a dispatched run* says, and
closes as that section's outcomes direct.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the executive summary above. The engine refuses a
dispatched run that reaches its end with no close-out in the outbox
(`RUN-FAILED: closeout-unpublished`). Under a terminal driver there is no
outbox, and step 4 is what the operator gets instead.

There is no gate after this node. The workflow ends here.

**Recovery budget**: none — this node summarizes and nothing else.
