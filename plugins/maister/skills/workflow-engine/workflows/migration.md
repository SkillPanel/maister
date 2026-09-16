# Migration workflow — node prose

The node-by-node companion to `migration.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need, what guards them and what they declare. It says
nothing about the operator questions asked *inside* a node, the executive
summaries printed before a gate fires, the self-checks that decide whether a
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
never ran would fire and ask an operator to approve nothing. It is also why
every gate whose named destination may be skipped has a **true-destination
line** printed before it by the node that closes into it — the question is a
constant fixed at authoring time, and the node that will actually run next is
not.

## The phase numbers, and where they went

The prose form of this workflow numbers its phases, and one gate question names
a phase number the graph does not have. This table is how a reader resolves one
to the other:

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

**The two true-destination rules.** Both stretches at the end of this workflow
can be skipped, so the two gates in front of them say where the run is really
going:

- **Before `verification-approval`**, printed by `verification`: `Next:
  issue-resolution` when `issues_to_resolve` is true. Otherwise `Next:
  documentation`, or `Next: finalization` when `user_docs` is false.
- **Before `resolution-approval`**, printed by `issue-resolution`: `Next:
  documentation`, or `Next: finalization` when `user_docs` is false.

A gate question is authoring-time constant and covered by the graph hash, so it
cannot carry a value that differs per run. The line above it can, and is where
the operator reads what continuing actually does.

---

## Run-scoped context

Four fields reach every delegate without appearing in any node's `with:`,
because they belong to the run rather than to a node:

- `task_path` — the task directory every artifact path is relative to. For this
  workflow the type directory is `migrations/`, plural.
- `html_style_guide_path` — passed **only** when `options.html_output` is true.
  When it is false, no companion is requested and no dashboard file is written.
- `project_doc_paths` — discovered by `intake` and read from state after.
- the accumulated `phase_summaries` — the full detail of everything decided so
  far, verbatim, never re-summarized. **Fetch this one; do not write it.** The
  engine's `prior-context` verb takes the run's state file and prints the whole
  passage — every phase, its decisions and its risks, one bullet each with the
  count beside the heading. Run it in the turn that composes the prompt and
  paste its output in under its own heading, unedited.

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
the composing step is gone. Call `prior-context` with the run's state file, paste
its stdout into the prompt, and leave it alone: trimming it, re-ordering it or
tightening it is the same defect by hand. It reads the run and writes nothing, so
call it as often as a turn needs it — and what it prints is what every delegate
that writes an artifact receives.

Anything node-scoped is in `with:` instead. Every prompt that asks a delegate to
write an artifact also carries the artifact summary contract, so the summary
this workflow lifts into state is one the delegate wrote rather than one the
engine invented. Three artifacts additionally get an HTML companion when
`html_output` is true — the specification, the implementation plan and the
verification report — and each companion path is registered under
`artifacts[].html` on the summary entry that owns it.

**Operator visibility.** Rewrite `dashboard-data.js` in the same turn as the
`write-state` call that records the change. **There is no dashboard verb** — no
verb this workflow calls touches the projection, so it is only ever as fresh as
the last turn that rewrote it by hand, and a rewrite point with no rewrite
beside it is a dashboard the operator reads as stale. Five points, and every one
of them already makes a state write: when a node starts, **before every gate
fires** — the operator reviews the finished node's artifacts while answering —
after every node completes, on every gate decision, and at finalization. A
skipped node is written to the dashboard too, with the reason its guard gave, so
an operator can tell a stretch that was skipped from one that never existed. It
is a terse projection of state; never duplicate artifact content into it.

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

If that ever changes, it changes here first: an embedded input and a named
handoff block in this section. Until then a reader finding no embedded behaviour
has found the intended answer rather than a gap.

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
   when the file or the key is absent). Mirror the `user_docs` input to
   `options.docs_enabled` in the same step: the documentation node is guarded on
   the input, and a reader of state needs the same answer visible where every
   other option lives. When `html_output` is false, skip the dashboard entirely
   — no dashboard asset, no data projection, no browser open. Otherwise copy the
   dashboard asset to the task root, write the initial data projection with
   every node pending, and **run the platform opener** on the plain absolute
   path through the shell — `open "<task path>/dashboard.html"` on macOS,
   `xdg-open` on Linux, `start ""` on Windows. Never build a `file://` URL; the
   opener resolves a plain path itself. On failure print the path; never block.
6. **Print the startup banner** — the task description, the task directory and
   the dashboard path, then say which node runs first.
7. **Discover the project documentation** — read the documentation index under
   the project's docs directory if one exists and extract every path from its
   project-documentation section, predefined and operator-added alike. Record
   them as `project_context.project_doc_paths`, a top-level sibling of the
   orchestrator and context blocks and never nested inside either — the state
   writer's patch carries `project_context` as its own key.

> **ANTI-PATTERN**: Do NOT print the dashboard path instead of opening it. The
> path hint in the banner is a second copy for the operator's scrollback, not
> the opener — a run whose transcript carries no `open`, `xdg-open` or
> `start ""` shipped a dashboard nobody ever saw, and every later rewrite of it
> was written for no reader.

**There is no gate after this node.** It auto-continues into the current-state
analysis.

**Recovery budget**: none — this node establishes state, and a configuration
file it cannot find is an absence rather than a failure. An invalid type is not
a failure to retry either: it is the failure above.

---

## `current-state-analysis`

Delegated to the codebase analyzer through the Skill tool, then a short
clarification round inline.

> **ANTI-PATTERN**: Do NOT explore the codebase inline instead of delegating.
> The codebase-analyzer skill dispatches parallel explorers and produces the
> structured analysis the rest of the run reads.

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

> **ANTI-PATTERN**: Do NOT define the target state yourself. The gap-analyzer
> agent defines it from the migration description, enumerates the gaps and
> recommends the strategy the specification is written against.

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
`migration_context.risk_level` and `migration_context.breaking_changes`. The
web research lands in `external_research`, a top-level sibling of the context
block rather than a field inside it.

> **SELF-CHECK**: did you invoke the Task tool with the gap analyzer, or did you
> start sketching the target state yourself? If the latter, STOP and invoke the
> Task tool.

**Executive summary before the gate.** Read `analysis/target-state-plan.md` and
print, immediately before `gap-approval` fires: the current system, the target
system, the migration type classified, how many gaps were identified, the
recommended strategy and the risk level.

**Recovery budget**: 2 attempts — re-prompt for the target details on the
second, and ask the operator when the second also comes back thin.

**Phase summary key**: `gap_analysis`. Mirror this node's summary into
`migration_context.phase_summaries.gap_analysis` with the gap list, the strategy
and the risk level, and with `node: gap-analysis` on the entry.

---

## `gap-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option — nothing after a stopped node ever becomes
ready.

Its question names the migration strategy, and the specification is what writes
one. Nothing between here and there is guarded, so the node the question names
is the node the run reaches and no true-destination line is owed.

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
so they are named in the executive summary before this node's gate whatever else
the round covered.

**Part B — specification creation (delegate).**

> **ANTI-PATTERN**: Do NOT write the specification inline. Not because the
> migration looks small, and not only when it does — the specification-creator
> agent writes it every time. Simplicity is never a reason to skip the
> delegation.

Invoke the specification creator through the Task tool with the migration task
type. Everything node-scoped it needs is in `with:`; the run-scoped four supply
the rest, including the style guide path that produces the specification's HTML
companion, and the project documentation paths `intake` discovered.

The rollback plan is written in this node and declared as its artifact, because
every later node reads it: the planner sequences the undo steps, and the
verifier tests them. **The dual-run plan is not declared**, because only a
dual-run strategy produces one — write `analysis/dual-run-plan.md` when the
strategy is dual-run and record it on this node's summary, and write nothing
when it is not.

> **SELF-CHECK**: after the Task tool returns, verify that
> `implementation/spec.md` and `analysis/rollback-plan.md` both exist and that
> the specification covers the requirements gathered in Part A. If either is
> missing: **STOP. Do NOT proceed.** Re-invoke with corrected context.

Record `migration_context.rollback_plan_created` and
`migration_context.dual_run_configured` from what actually landed.

**Executive summary before the gate.** Read `implementation/spec.md` and
extract: the migration strategy chosen, the scope boundaries, the rollback
approach, the breaking changes identified and the key constraints. Print that
summary immediately before `specification-approval` fires, with the rollback
expectations and the downtime tolerance named whether or not Part A was
answered.

**Recovery budget**: 2 attempts — re-gather the requirements and regenerate the
specification and the rollback plan on the second, with the gaps named in the
context.

**Phase summary key**: `specification`. Mirror this node's summary into
`migration_context.phase_summaries.specification`, with `node: specification` on
the entry, and register the companion path under that entry's
`artifacts[].html`.

---

## `specification-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `planning`

Delegated to the implementation planner through the Task tool.

> **ANTI-PATTERN**: Do NOT break the migration into steps inline. The
> implementation-planner agent produces the task groups, their dependencies and
> their test-first step lists. Simplicity is not a reason to skip the
> delegation.

The planner reads the specification, the rollback plan and the migration type,
and sequences the work so that each group leaves the system in a state the
rollback plan can still undo. Rollback steps belong in the plan itself rather
than in a separate document.

> **SELF-CHECK**: after the Task tool returns, verify that
> `implementation/implementation-plan.md` exists and that its groups carry the
> rollback steps. If missing: **STOP. Do NOT proceed.**

**Executive summary before the gate.** Read
`implementation/implementation-plan.md` and extract: how many task groups it
carries, the total number of steps, whether rollback steps are included, the key
dependencies between groups and the execution sequence. Print that summary
immediately before `planning-approval` fires.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
migration constraints named in the context.

**Phase summary key**: none. Register the plan's companion path on this node's
own summary entry under `artifacts[].html`; the four phase keys belong to the
nodes named in the phase-key section above and this is not one of them.

---

## `planning-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `execution`

Delegated to the implementation-plan executor through the Skill tool. This is
the node that changes code, and it is the only one that does.

> **ANTI-PATTERN**: Do NOT apply the migration inline. Not for a small plan, not
> for a single-group plan — the implementation-plan-executor skill runs the
> groups, dispatches the implementers and keeps the plan's progress marks in
> step with what actually landed.

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

**After the skill returns**, reconcile the plan's HTML companion when one exists
— every group whose steps are all marked done in the document must read as done
in the companion too, and a companion still showing outstanding work after a
complete run is a stale projection rather than a finding. Then record what
landed: the groups completed, the files changed, the incremental test results
and whether the rollback procedure is still ready to run.

> **SELF-CHECK**: did the executor run, or did you start editing files yourself?
> If the latter, **STOP** and invoke the skill instead.

**Executive summary before the gate.** Read `implementation/work-log.md` and
this node's own summary and extract: the migration steps completed, the files
changed, the test results from the incremental runs and the rollback readiness
status. Print that summary immediately before `execution-approval` fires.

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

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `verification`

Delegated to the implementation verifier through the Skill tool, then the
migration-specific checks inline.

> **ANTI-PATTERN**: Do NOT verify the migration inline. The
> implementation-verifier skill runs the completeness check, the test suite and
> the selected reviews, and compiles them into one report.

Pass no style guide path: as a skill it resolves the guide itself and gates its
own companion on the HTML output option.

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
`verification_context.issues_found`, then **declare `issues_to_resolve`**: true
when the report carries at least one fixable issue, **or** any data integrity
issue at all. The second half is deliberate. A data integrity issue is never
fixed, and routing it into `issue-resolution` anyway is what puts the halt in
the node that owns it rather than leaving it to a gate.

**Executive summary before the gate.** Read
`verification/implementation-verification.md` and
`verification/compatibility-test-results.md` and extract: the overall verdict,
the issue counts by severity, the compatibility results, the data integrity
status and the rollback test results. Print that summary immediately before
`verification-approval` fires. **When the verdict failed and nothing in it is
fixable, the summary recommends `stop-migration` in as many words** — the prose
form stops the workflow by itself in that case, and the graph has no routing
construct to stop with, so the recommendation to the operator at the gate is
what replaces it.

**Print the true destination** on the line after that summary, because both
nodes the gate leads toward are guarded. It is `Next: issue-resolution` when
`issues_to_resolve` is true. Otherwise it is `Next: documentation`, and
`Next: finalization` when `user_docs` is false.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed. **A data integrity issue is
never one of those attempts**: it is not retried, it is carried into
`issue-resolution`, which halts on it.

---

## `verification-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

**Its question is neutral where the prose form's names a phase number, and that
is a recorded divergence.** The prose form asks "Continue to Phase [7 or 8]?",
interpolating the destination it computed. A gate question is authoring-time
constant and covered by the graph hash, so it cannot carry a destination that
differs per run. The true-destination line `verification` prints immediately
above this gate is where the operator reads where continuing goes.

**Its stop option is also the route out of a failed verification.** The prose
form stops the workflow automatically when the verdict failed with nothing
fixable; here the operator does it, having read the recommendation in the
executive summary.

---

## `issue-resolution`

Executed inline, and **guarded**: it runs only when `verification` declared
`issues_to_resolve`. Skipped, it still satisfies everything downstream, which is
why the gate that closes it repeats the same guard.

**Display the issue breakdown** the verifier returned, grouped by category and
severity, with the location, the description and the fixability of each.

**The fix loop.** Present the critical and warning issues as a numbered list and
ask which to fix: all the fixable ones, a chosen subset, or none. Apply the
chosen fixes and log each one. Record the applied fixes as
`verification_context.fixes_applied`, add the operator's calls to
`verification_context.decisions_made`, and raise
`verification_context.reverify_count` by one **before** re-invoking the
verifier: those two keys are what tell the verifier it is running after fixes,
and a re-run that cannot see them rewrites nothing, leaving the pre-fix report
standing. Then ask whether to re-run the verification; a yes re-invokes the
verifier and returns to the breakdown. Both answers continue the run, which is
why this is a node question rather than a gate. **At most three iterations.**

**Data integrity is never auto-fixed.** On any data integrity issue, stop the
loop. Under a terminal driver, present the issue and the rollback option to the
operator first, exactly as the prose form does, and let them decide. Under any
other driver there is nobody to present it to: **record this node `failed`**,
and the run ends `RUN-FAILED` with the state intact. That is the whole point of
failing rather than skipping — an operator arrives to the migration's state as
the verification left it, rather than to an automated repair already applied to
their data.

**Default under a non-terminal driver** (`verification-fix-loop`): fix every
fixable issue, re-verify once, then continue to the gate — **except a data
integrity issue, which is never fixed and never proceeded past**, and which ends
the run as the paragraph above says. One re-verification is the whole budget,
because a loop nobody can stop is not a loop. A non-data issue still critical
after it is named in the line printed before `resolution-approval`, which is
where an operator answers.

**Exit conditions**: no critical issue remains; or the operator explicitly chose
to proceed as-is; or the three iterations are spent, at which point name the
issues still open and **recommend the rollback** before the gate. **Never
proceed past an unresolved critical issue without an explicit answer saying
so** — a gate answered from outside is such an answer; a default is not.

> **GATE CHECK**: the canonical report and its companion must carry the *final*
> post-fix verdict before this node completes. A report still showing the
> pre-fix state after fixes landed is a stale artifact, and the operator answers
> the next gate against it. Recompile it rather than leaving a side file to
> carry the truth.

**Executive summary before the gate.** Print, immediately before
`resolution-approval` fires: the total issues found, how many were fixed and how
many remain by severity, together with the rollback recommendation when the
iterations ran out.

**Print the true destination** on the line after it: `Next: documentation`, or
`Next: finalization` when `user_docs` is false.

**Recovery budget**: none — this node's own three-iteration loop is its limit,
and re-driving a node that halts on data integrity would re-run the thing it
refused.

---

## `resolution-approval`

A gate, **guarded on the same value as `issue-resolution`**. It asks only when
that stretch ran; when the stretch was skipped this gate is skipped with it, and
the run goes straight on to whatever comes next.

Ask the question the definition carries, record the answer, and stop the run on
the stop option.

**Its question names the documentation, which may be skipped.** That is what the
true-destination line above it is for: it names `finalization` when `user_docs`
is false, so an operator answering "continue to documentation" is never
surprised by a run that ends instead.

**It is also the third answer the prose form has and the graph does not.** When
the fix iterations run out, the prose form asks whether to proceed with warnings
or to roll back. A gate has one continue and one stop and no third effect, so
the rollback recommendation is printed by `issue-resolution` and the stop option
here is what acts on it.

---

## `documentation`

Delegated to the user documentation generator through the Task tool, and
**guarded** on the `user_docs` input. It runs only when the invocation asked for
a guide; absent means off, and nothing in this workflow asks about it in
session.

> **ANTI-PATTERN**: Do NOT write the migration guide inline. The
> user-docs-generator agent writes for the end user rather than for the
> engineer, and captures the screenshots the guide needs.

The guide covers the migration overview and its goals, the prerequisites and the
preparation steps, the step-by-step procedure, the rollback procedure and the
troubleshooting for the problems the verification actually found.

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
   defect.
2. **Present the executive summary**: what was migrated and to what, the
   strategy used, the verification verdict with any issues left open, whether
   the rollback procedure was tested and whether it is still available.
3. **Set the task status to completed** and refresh the dashboard one last time.
4. **Guide the next steps**, which for this workflow are its own four: exercise
   the migrated system by hand before trusting it; keep the rollback plan
   reachable until the new system has run in production long enough to trust;
   watch the data and the error rates after deployment, closely for a data
   migration; and retire the old system, or the dual-run configuration, only
   once both have been true for a while. Suggest a fresh session for whatever
   comes next rather than continuing in this one.

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
