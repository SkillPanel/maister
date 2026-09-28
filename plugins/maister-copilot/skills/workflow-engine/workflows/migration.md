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
that the run asks three further questions beyond its six gates, and the
generated diagram does not show them either. Anyone reasoning about how
interactive this workflow is must read this file, not the graph.

**Every question asked inside a node names its default here.** Under a `cockpit`
or `dispatch` driver nobody is in the session, so none of them is asked: each
takes the default its own section states and the node records that it did. The
rule, the recording shape and what is never defaulted past belong to the engine
skill, which states them once; this file only says what each question takes.
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

The prose form of this workflow numbers its phases, but no gate question names a
phase number. This table maps the prose form's phases to nodes:

| Prose phase | Node | Closing gate |
|---|---|---|
| Initialization steps 1-7 | `intake` | none — it auto-continues |
| 1 | `current-state-analysis` | none — it auto-continues |
| 2 | `gap-analysis` | `gap-approval` |
| 3 | `specification` | `specification-approval` |
| 4 | `planning` | `planning-approval` |
| 5 | `execution` | `execution-approval` |
| 6 | `verification` | `verification-approval` |
| 7 | `issue-resolution` | `resolution-approval` |
| 8 | `documentation` | none — the prose form has no gate here either |
| no twin phase → `finalization` | `finalization` | none — the workflow ends |

Both stretches at the end of this workflow can be skipped. A gate question is
authoring-time constant and covered by the graph hash, so it cannot say where
the run is really going; the gate brief's `Next:` line names the node that
actually runs, with the skipped ones listed (engine § Gates).

---

## Run-scoped context

Four fields reach every delegate without appearing in any node's `with:`,
because they belong to the run rather than to a node:

- `task_path` — the task directory every artifact path is relative to. For this
  workflow the type directory is `migrations/`, plural.
- `html_style_guide_path` — passed **only** when `options.html_output` is true.
  When it is false, no companion is requested, no dashboard file is written, and an
  existing data file is removed.
- `project_doc_paths` — discovered by `intake` and read from state after.
- the accumulated `phase_summaries` — the full detail of everything decided so
  far, verbatim, never re-summarized. **Fetch this one; do not write it.** The
  engine's `prior-context` verb takes the run's state file and prints the whole
  passage — every phase, its decisions and its risks, one bullet each with the
  count beside the heading. Run it once for each delegate prompt, in the turn
  that composes that prompt, and paste its output in under its own heading,
  unedited.

> **ANTI-PATTERN**: Do NOT re-summarize a summary block. `decisions` and `risks`
> are copied out of the artifact's own Key Decisions and Open Questions / Risks
> blocks **item for item** — the same count, the same words, the artifact's
> order — into `phase_summaries`, into `node_summaries` and into the dashboard.
> Rewriting them in your own words loses the sentence the operator is about to
> approve at a gate; writing an empty `[]` because the node has already read
> the artifact loses it outright, and `decisions: []` beside a specification
> carrying eight of them is the failure this block exists to stop.

**The prior-phase passage of a delegate prompt is fetched, not composed.** Four
attended runs measured the same thing: this rule holds where the lift is
mechanical and happens once, and fails where a node writes the passage afresh
from an artifact it has already read — thirteen items arrived as seven clauses on
one line, and nothing in the prompt recorded that they had ever been thirteen. So
the composing step is gone. Call `prior-context` with the run's state file **at
each consuming delegate** — one call per prompt, in the turn that composes it —
paste its stdout into the prompt, and leave it alone: trimming it, re-ordering it
or tightening it is the same defect by hand. The stdout is pasted as text, whole:
never slice it with `sed`, `head`, `tail` or the like, and never pass a file path
or a saved copy in place of the pasted text. Re-using a rendering produced for an
earlier delegate is not licensed however recent it looks: a summary written in
between makes it stale, the prompt records nothing about when it was taken, and a
prompt that happens to be current is current by timing rather than by
construction. The verb reads the run and writes nothing, so the extra call costs
nothing — and what it prints at the moment a prompt is composed is what that
delegate receives.

Anything node-scoped is in `with:` instead. Every prompt that asks a delegate to
write an artifact also carries the artifact summary contract, so the summary
this workflow lifts into state is one the delegate wrote rather than one the
engine invented. Three artifacts additionally get an HTML companion when
`html_output` is true — the specification, the implementation plan and the
verification report — and each companion path is registered under
`artifacts[].html` on the summary entry that owns it.

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
   **The task directory survives that failure, and the prose form's does not.**
   The graph is frozen before the first node runs, so by the time this node can
   reject the value the directory exists. It holds a failed intake and nothing
   else, and the state left behind is what an operator reads before re-invoking
   with a value from the list.
3. **Create and initialize** the task directory under the `migrations/` type
   directory and its state file, with the task description and an empty
   `phase_summaries` map under `migration_context`. The map is the state writer's to seed — the first write that touches
   the context block creates it empty — so a node that has nothing to mirror
   still leaves a reader something to read.
4. **Create the subdirectories** the later nodes write into — the analysis,
   implementation, verification and documentation directories.
5. **Read the project configuration** and set `options.html_output` (default true
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
6. **Relay the startup banner the freeze printed** (engine Step 4) if it is not
   already on screen; compose none.
7. **Discover the project documentation** — read the documentation index under
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
technologies into `migration_context.current_system`. Then ask the operator **at
most five** critical clarifying questions about the migration scope, the target
system and the constraints. The count is adaptive: ask only what the analysis
could not settle, and ask nothing when it settled everything. Both answers to
every one of them continue the run, which is why they are asked here rather than
at a gate.

Save the answers to `analysis/clarifications.md`, then set
`migration_context.clarifications_resolved` to true. A run that asked no
question still writes the file and still sets the flag: it resolved the
clarifications by having none to ask.

**Default under a non-terminal driver** (`clarifications`): none is asked, and
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
node's closing `node_summaries` entry a `summary` of one labelled line for each
of: the current system, the target system, the migration type classified, how
many gaps were identified, the recommended strategy and the risk level. A
one-line recap of the work does not replace them — the operator approves the
strategy from these six lines, which the gate brief renders in the
`gap-approval` question (engine § Gates).

**Recovery budget**: 2 attempts — re-prompt for the target details on the
second, and ask the operator when the second also comes back thin.

**Phase summary key**: `gap_analysis`. Mirror this node's summary into
`migration_context.phase_summaries.gap_analysis` with the gap list, the strategy
and the risk level, and with `node: gap-analysis` on the entry.

---

## `gap-approval`

A gate, unguarded. Ask it as engine § Gates says — the gate brief, then the
definition's `ask:` — record the answer, and stop the run on the stop option —
nothing after a stopped node ever becomes ready.

Its question names the stage just completed and no later one. The node the run
reaches next is `specification` — nothing between here and there is guarded —
and the gate brief's `Next:` line names it.

---

## `specification`

Executed inline in two parts, the second of them delegated. It turns the gap
list into a migration specification the planner can break down, with the
rollback procedure beside it.

**Part A — migration requirements (inline).** Present the gap summary, then ask
the operator three to five questions framed as confirmable assumptions — *"I
assume X, is that correct?"* — covering the migration scope and its boundaries,
the rollback expectations and downtime tolerance, the data specifics when this
is a data migration, the dual-run requirements when the strategy calls for one,
and the existing code or configuration to preserve. Save the round to
`analysis/requirements.md`.

**Default under a non-terminal driver** (`specification-requirements`): the
assumptions stand as framed. They are written to be confirmable, so an
unconfirmed one is recorded in `analysis/requirements.md` and carried into the
specification as a stated assumption rather than as settled fact. Rollback
expectations and downtime tolerance are the two an operator most needs to see,
so they are named in this node's closing summary for the gate brief whatever
else the round covered.

**Part B — specification creation (delegate).**

Delegate the specification to the specification-creator agent through the Task
tool, whatever the migration's size — it owns `implementation/spec.md` and its
companion, and the planner and the verifier read the spec in that agent's shape.

Pass it the migration task type. Everything node-scoped it needs is in `with:`;
the run-scoped four supply the rest, including the style guide path that
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
closing `node_summaries` entry: the scope boundaries, the rollback approach, and
the rollback expectations and the downtime tolerance — named whether or not
Part A was answered — in `summary`; the migration strategy chosen in
`decisions`; the breaking changes identified and the key constraints in `risks`.
The `specification-approval` question is the gate brief rendered from it
(engine § Gates).

**Recovery budget**: 2 attempts — re-gather the requirements and regenerate the
specification and the rollback plan on the second, with the gaps named in the
context.

**Phase summary key**: `specification`. Mirror this node's summary into
`migration_context.phase_summaries.specification`, with `node: specification` on
the entry, and register the companion path under that entry's
`artifacts[].html`.

---

## `specification-approval`

A gate, unguarded. Ask it as engine § Gates says — the gate brief, then the
definition's `ask:` — record the answer, and stop the run on the stop option.

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
into this node's closing `node_summaries` entry a `summary` of one labelled line
each for how many task groups it carries, the total number of steps and whether
rollback steps are included; the key dependencies between groups and the
execution sequence go in `decisions`. The `planning-approval` question is the
gate brief rendered from it (engine § Gates).

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
migration constraints named in the context.

**Phase summary key**: none. Register the plan's companion path on this node's
own summary entry under `artifacts[].html`; the four phase keys belong to the
nodes named in the phase-key section above and this is not one of them.

---

## `planning-approval`

A gate, unguarded. Ask it as engine § Gates says — the gate brief, then the
definition's `ask:` — record the answer, and stop the run on the stop option.

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
node's closing `node_summaries` entry: the migration steps completed, the files
changed, the test results from the incremental runs and the rollback readiness
status in `summary`; any known issues or deferred items in `risks`. The
`execution-approval` question is the gate brief rendered from it (engine
§ Gates).

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

A gate, unguarded. Ask it as engine § Gates says — the gate brief, then the
definition's `ask:` — record the answer, and stop the run on the stop option.

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

Record `verification_context.last_status` and
`verification_context.issues_found` (the issue shape of `orchestrator-patterns.md`
§ 4), then **declare `issues_to_resolve`**: true
when the report carries at least one fixable issue, **or** any data integrity
issue at all. The second half is deliberate. A data integrity issue is never
fixed, and routing it into `issue-resolution` anyway is what puts the halt in
the node that owns it rather than leaving it to a gate.

**Gate brief content.** Read `verification/implementation-verification.md` and
`verification/compatibility-test-results.md` and write into this node's closing
`node_summaries` entry: the overall verdict, the issue counts by severity, the
compatibility results, the data integrity status and the rollback test results
in `summary`; each critical issue still open as an `open:` risk. **When the
verdict failed and nothing in it is fixable, add a risk starting
`recommend stop:`** that says why — the prose form stops the workflow by itself
in that case, and the graph has no routing construct to stop with, so the gate
brief recommending `stop-migration` is what replaces it. The
`verification-approval` question is the gate brief rendered from this entry,
and its `Next:` line names the node that actually runs (engine § Gates).

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed. **A data integrity issue is
never one of those attempts**: it is not retried, it is carried into
`issue-resolution`, which halts on it.

---

## `verification-approval`

A gate, unguarded. Ask it as engine § Gates says — the gate brief, then the
definition's `ask:` — record the answer, and stop the run on the stop option.

**Its question is neutral where the prose form's names a phase number, and that
is a recorded divergence.** The prose form asks "Continue to Phase [7 or 8]?",
interpolating the destination it computed. A gate question is authoring-time
constant and covered by the graph hash, so it cannot carry a destination that
differs per run. The gate brief's `Next:` line is where the operator reads where
continuing goes.

**Its stop option is also the route out of a failed verification.** The prose
form stops the workflow automatically when the verdict failed with nothing
fixable; here the operator does it, having read the `recommend stop:` risk in
the gate brief, which then recommends the stop option.

---

## `issue-resolution`

Executed inline, and **guarded**: it runs only when `verification` declared
`issues_to_resolve`. Skipped, it still satisfies everything downstream, which is
why the gate that closes it repeats the same guard.

**Display the issue breakdown** the verifier returned, grouped by category and
severity, with the location, the description and the fixability of each.

**The fix loop.** Ask it as one single-select. The question text is the numbered critical and
warning list, one line per issue in the shape
`N. [severity] path:line — description (fixable | needs a hand)`, followed by
`Which to fix?`. The options are **"Fix all fixable (Recommended)"** and
**"None — proceed as is"**; a subset is chosen by typing its numbers through
Other. When nothing on the list is fixable, the `(Recommended)` label moves to
"None — proceed as is".
Apply the chosen fixes and log each one. Record the applied fixes as
`verification_context.fixes_applied`, and add the operator's calls to
`verification_context.decisions_made`.
After "None — proceed as is" nothing was fixed and nothing changed, so there
is nothing to re-verify: ask no re-run question and continue to the gate. When
at least one fix was applied, ask one single-select, `Re-run verification?`,
with the options
**"Re-verify now (Recommended)"** and **"No — continue to the gate"**. Only on
a yes, raise `verification_context.reverify_count` by one and re-invoke the
verifier, which returns to the breakdown; a no leaves the count alone, so it
counts only re-runs that happened. The recorded fixes and the raised count are
what tell the verifier it is running after fixes, and a re-run that cannot see
them rewrites nothing, leaving the pre-fix report standing. Both answers
continue the run, which is why this is a node question rather than a gate. **At most three iterations.**

**Data integrity is never auto-fixed.** On any data integrity issue, stop the
loop. Under a terminal driver, present the issue and the rollback option to the
operator first, exactly as the prose form does, and let them decide. Under any
other driver there is nobody to present it to: **record this node `failed`**,
and the run ends `RUN-FAILED` with the state intact. That is the whole point of
failing rather than skipping — an operator arrives to the migration's state as
the verification left it, rather than to an automated repair already applied to
their data.

**Default under a non-terminal driver** (`verification-fix-loop`): the
recommended option — fix every fixable issue and re-verify once, then continue to the gate; with
nothing fixable, proceed as is and continue to the gate without re-verifying — **except a data
integrity issue, which is never fixed and never proceeded past**, and which ends
the run as the paragraph above says. The default follows the same order as an
answered loop: apply the fixes, record `fixes_applied`, then, when a fix was applied — the recommended answer to the re-run
question — raise `reverify_count` by one and re-invoke the
verifier. One re-verification is the whole budget,
because a loop nobody can stop is not a loop. A non-data issue still critical
after it is recorded as an `open:` risk in this node's summary, which the gate
brief renders at `resolution-approval` — where an operator answers.

**Exit conditions**: no critical issue remains; or the operator explicitly chose
to proceed as-is; or the three iterations are spent, at which point name the
issues still open and **recommend the rollback** as a risk starting
`recommend stop:` in this node's summary. **Never
proceed past an unresolved critical issue without an explicit answer saying
so** — a gate answered from outside is such an answer; a default is not.

> **GATE CHECK**: the canonical report and its companion must carry the *final*
> post-fix verdict before this node completes. A report still showing the
> pre-fix state after fixes landed is a stale artifact, and the operator answers
> the next gate against it. Recompile it rather than leaving a side file to
> carry the truth.

**Gate brief content.** Write into this node's closing `node_summaries` entry:
the total issues found, how many were fixed and how many remain by severity in
`summary`; each critical issue still open as an `open:` risk; and, when the
iterations ran out, the rollback recommendation as a risk starting
`recommend stop:`. The `resolution-approval` question is the gate brief rendered
from it (engine § Gates).

**Recovery budget**: none — this node's own three-iteration loop is its limit,
and re-driving a node that halts on data integrity would re-run the thing it
refused.

---

## `resolution-approval`

A gate, **guarded on the same value as `issue-resolution`**. It asks only when
that stretch ran; when the stretch was skipped this gate is skipped with it, and
the run goes straight on to whatever comes next.

Ask it as engine § Gates says — the gate brief, then the definition's `ask:` —
record the answer, and stop the run on the stop option.

**Its question names the documentation, which may be skipped.** The gate brief's
`Next:` line names `finalization` when `user_docs` is false, so an operator
answering "continue to documentation" is never surprised by a run that ends
instead.

**It is also the third answer the prose form has and the graph does not.** When
the fix iterations run out, the prose form asks whether to proceed with warnings
or to roll back. A gate has one continue and one stop and no third effect, so
the rollback recommendation is a `recommend stop:` risk in the
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

**Node summary.** This node's closing `node_summaries` entry lifts the guide's
Key Decisions item for item into `decisions` — one entry per item, in the
guide's order, none merged and none reworded — and its open questions and risks
the same way into `risks`.

**This is a stretch of one, with no gate after it.** The prose form has none
either, so nothing here repeats its guard onto a following gate — the guard ends
with the node.

**Recovery budget**: 1 attempt — on a failure, generate the guide as text only,
without screenshots, rather than leaving the run without one.

---

## `finalization`

Executed inline, writes no files, and **always runs**. It is the one node in
this workflow the prose form has no phase for, and it exists because the two
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

**Print first, then close.** The executive summary and then every next step
from step 4 — all four of this workflow's own, then the fresh-session suggestion,
none dropped or merged — are printed as ordinary text **before** the engine's
`run-complete` call, and they are the last thing printed ahead of it. Only then
call `run-complete`. Its marker is the last line of its stdout; after the call,
print nothing but that line, copied exactly as the verb printed it. Never call
`run-complete` first and summarize after it, and never type a marker the verb did
not print.

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
