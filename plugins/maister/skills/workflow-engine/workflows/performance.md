# Performance workflow — node prose

The node-by-node companion to `performance.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need and what they declare. It says nothing about the
operator questions asked *inside* a node, the executive summaries printed before
a gate fires, the self-checks that decide whether a node succeeded, or how many
times the engine may re-drive one. Those live here.

**State the consequence plainly**: a reader of `performance.yml` alone cannot
see that the run asks five further questions beyond its seven gates, and the
generated diagram does not show them either. Anyone reasoning about how
interactive this workflow is must read this file, not the graph.

**Every question asked inside a node names its default here.** Under a `cockpit`
or `dispatch` driver nobody is in the session, so none of them is asked: each
takes the default its own section states and the node records that it did. The
rule, the recording shape and what is never defaulted past belong to the engine
skill, which states them once; this file only says what each question takes.

**Recovery budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — an attempts key sitting
there would read like a grammar feature while being inert data the engine never
consults. Six nodes carry a budget; the rest carry none and re-drive nothing.

**This workflow has no guard, so no skip can cascade.** Not one node carries a
`when` clause. Every phase runs on every run: the specification audit has no
opt-in and no size threshold, and the one optional thing the workflow takes —
profiling data the operator supplies — changes what a node *reads* rather than
whether a node *runs*. Nothing is ever skipped, so no gate repeats a guard and
no destination a gate names can go missing before the operator reaches it.

## The phase numbers, and where they went

One gate question names a phase number the graph does not have. The number is
kept verbatim from the workflow's prose form, because equality against that form
is the strongest thing anyone can assert about the two being the same workflow.
This table is how a reader resolves one to the other:

| Prose phase | Node | Closing gate |
|---|---|---|
| Initialization steps 1-7 | `intake` | none — it auto-continues |
| 1 | `codebase-analysis` | none — it auto-continues |
| 2 | `bottleneck-analysis` | `bottleneck-approval` |
| 3 | `specification` | `specification-approval` |
| 4 | `spec-audit` | `spec-audit-approval` |
| 5 | `planning` | `planning-approval` |
| 6 | `implementation` | `implementation-approval` |
| 7 | `verification-options` | `verification-options-approval` |
| 8 | `verification` | `verification-approval` |
| 9 | `finalization` | none — the workflow ends |

**No destination is ever skipped, so this file needs no true-destination line.**
A guarded chain has to name the node that will actually run next before a gate
fires, because a guard may be false by the time its gate is asked. Here every
node in the table runs on every run, so the node a gate's question names is the
node the run reaches. `verification-options-approval` names phase 8, and phase 8
is `verification` — always. A reader coming from a guarded definition should
read the absence of that rule here as the intended answer rather than as a gap.

---

## Run-scoped context

Four fields reach every delegate without appearing in any node's `with:`,
because they belong to the run rather than to a node:

- `task_path` — the task directory every artifact path is relative to.
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
or tightening it is the same defect by hand. Re-using a rendering produced for an
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

`node_summaries` is keyed by node id; `performance_context.phase_summaries` is
keyed by this workflow's own semantic keys, and the two namespaces do not line
up. Four keys over four owning nodes:

| Node | `phase_summaries` keys |
|---|---|
| `codebase-analysis` | `codebase_analysis` |
| `bottleneck-analysis` | `bottleneck_analysis` |
| `specification` | `specification` |
| `implementation` | `implementation` |

Every other node writes a node summary only. Each mirrored entry also carries
`node:` naming the node it came from, so the two directions stay readable from
either side.

The block is `performance_context`, and this workflow writes no other context
block. A run whose state carries a second one is a run two interpreters wrote,
which the state contract refuses out loud rather than merging.

A phase key is never a node id. Writing one off the node id succeeds and the run
keeps going with a key nothing else reads, which is why the mapping is pinned
here rather than derived.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `intake` | `analysis` |
| `codebase-analysis` | `analysis` |
| `bottleneck-analysis` | `analysis` |
| `specification` | `spec` |
| `spec-audit` | `verify` |
| `planning` | `plan` |
| `implementation` | `code` |
| `verification-options` | `verify` |
| `verification` | `verify` |
| `finalization` | `done` |

The seven gates are not in that table on purpose:
**each gate node renders the icon of the node it closes** — `bottleneck-approval`
`analysis`, `specification-approval` `spec`, `spec-audit-approval` `verify`,
`planning-approval` `plan`, `implementation-approval` `code`,
`verification-options-approval` `verify`, `verification-approval` `verify`. A
gate inherits rather than owns its icon, so a gate that picked its own would
break the visual pairing between a phase and the approval that closes it.

---

## Embedded mode

**There is none.** This workflow is never invoked as a sub-run of another, which
is why the definition declares no embedded input and why `finalization` carries
no guard. Every reference to performance elsewhere in the tree hands an operator
a next step — a suggested command, a handoff path — rather than executing one,
so there is no parent to owe a handoff block to and no output contract to keep.

If that ever changes, it changes here first, and it is the recipe the engine's
sub-run rule already sets out: an `embedded` input the engine supplies, a guard
on the closing node — `finalization` here — and a workflow-level `outputs:`
block declaring which of this workflow's keys a parent may read. No engine
change is involved; see the engine skill's *Sub-runs* section and the
`sub-runs.md` reference beside it. Until then a reader finding no embedded
behaviour has found the intended answer rather than a gap.

---

## `intake`

Executed inline, before any analysis. It establishes the task directory, the
state file and the profiling-data drop point the analysis node reads from.

1. **Capture the clock** — read the wall clock through the shell rather than
   from context. Every timestamp written this turn uses that one value; a
   date-only or midnight-stamped value is the documented failure mode.
2. **Create and initialize** the task directory and its state file, with the
   task description and an empty `phase_summaries` map under
   `performance_context`. The map is the state writer's to seed — the first write that touches
   the context block creates it empty — so a node that has nothing to mirror
   still leaves a reader something to read.
3. **Create the subdirectories** the later nodes write into — the analysis,
   implementation and verification directories, and
   `analysis/user-profiling-data/` beside them. That last one is the declared
   artifact of this node and it is created empty. **An empty directory is the
   answer "no profiling data", not a missing artifact**, and the node that reads
   it treats it that way.
4. **Read the project configuration** and set `options.html_output` (default true
   when the file or the key is absent). When `html_output` is false, skip the
   dashboard entirely — no dashboard asset, no data projection, no browser open.
   Otherwise copy the dashboard asset to the task root and **run the platform
   opener** on the plain absolute path through the shell — `open "<task path>/dashboard.html"`
   on macOS, `xdg-open` on Linux, `start ""` on Windows. Never build a `file://`
   URL; the opener resolves a plain path itself. On failure print the path;
   never block.
5. **Print the startup banner** — the task description, the task directory and
   the dashboard path, then say which node runs first.
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

**There is no gate after this node.** It auto-continues into the codebase
analysis.

**Recovery budget**: none — this node establishes state, and a configuration
file it cannot find is an absence rather than a failure.

---

## `codebase-analysis`

Delegated to the codebase analyzer through the Skill tool, then a short
clarification round inline.

> **ANTI-PATTERN**: Do NOT explore the codebase inline instead of delegating.
> The codebase-analyzer skill dispatches parallel explorers and produces the
> structured analysis the rest of the run reads.

Pass the enhancement task type and a performance-focused description. The
analyzer adaptively selects its explorers, and for a performance run the
description is what steers them toward database query patterns, hot code paths,
I/O operations, caching layers, connection management and schema or migration
files. A description that names only the symptom sends them nowhere in
particular.

After the skill returns, write the analysis summary, the key files and the
primary language into state. Then ask the operator **at most five** critical
clarifying questions about the performance concern, the suspected hotspots and
the optimization goals. The count is adaptive: ask only what the analysis could
not settle, and ask nothing when it settled everything. Both answers to every
one of them continue the run, which is why they are asked here rather than at a
gate.

Save the answers to `analysis/clarifications.md`, then set
`performance_context.clarifications_resolved` to true. A run that asked no
question still writes the file and still sets the flag: it resolved the
clarifications by having none to ask.

**Default under a non-terminal driver** (`clarifications`): none is asked, and
the analysis's own answers stand. The file is written and
`performance_context.clarifications_resolved` set exactly as they are for a run
with nothing to ask, and what the analysis could not settle about hotspots or
goals is recorded in the file as unsettled rather than guessed at.

**There is no gate after this node.** It auto-continues into the bottleneck
analysis.

**Recovery budget**: 2 attempts — expand the search patterns on the second, and
prompt the operator when the second also comes back thin.

**Phase summary key**: `codebase_analysis`. Mirror this node's summary into
`performance_context.phase_summaries.codebase_analysis` with the key files and
the primary language, and with `node: codebase-analysis` on the entry.

---

## `bottleneck-analysis`

Delegated to the bottleneck analyzer through the Task tool. This is the node the
whole workflow turns on: everything after it optimizes what this node found.

> **ANTI-PATTERN**: Do NOT analyze the bottlenecks yourself, and do NOT grep for
> N+1 patterns inline. The bottleneck-analyzer agent reads source, schema and
> query patterns and produces the ranked list the specification is written
> against.

**Check the profiling directory before delegating.** `intake` declared
`analysis/user-profiling-data/` and created it empty. When it holds files, pass
them: flame graphs, APM screenshots and slow-query logs turn a static ranking
into a measured one. When it is empty, ask the operator whether they have any —
*"Do you have profiling data to provide (flame graphs, APM screenshots, slow
query logs)?"* — and when they say yes, wait for the files and then proceed.

**Default under a non-terminal driver** (`profiling-data`): no profiling data,
and the run proceeds on static analysis alone. Waiting for files nobody can drop
is the one thing this question must not do under a driver — the wait never ends.
Say in the phase summary that the analysis was static-only, because a bottleneck
list built without profiling data otherwise reads the same as one built with it.

**Write the structured result to state before anything else.** Record
`performance_context.bottlenecks_identified` from the analyzer's count,
`performance_context.user_data_available` from whether the directory held
anything, and `performance_context.bottleneck_priorities` with its `p0`, `p1`,
`p2` and `p3` counts.

> **SELF-CHECK**: did you invoke the Task tool with the bottleneck analyzer, or
> did you start reading code yourself? If the latter, STOP and invoke the Task
> tool.

**Executive summary before the gate.** Read `analysis/performance-analysis.md`
and print, immediately before `bottleneck-approval` fires: how many bottlenecks
were identified, how many are P0 and how many P1, whether profiling data was
incorporated, and the top one or two findings. **This is the compensating
behaviour for the gate's constant question**, which cannot carry those counts —
see `bottleneck-approval` below.

**Recovery budget**: 2 attempts — re-analyze with broader patterns on the
second, and ask the operator when the second also comes back thin.

**Phase summary key**: `bottleneck_analysis`. Mirror this node's summary into
`performance_context.phase_summaries.bottleneck_analysis` with the bottleneck
list and `user_data_incorporated`, and with `node: bottleneck-analysis` on the
entry.

---

## `bottleneck-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option — nothing after a stopped node ever becomes
ready.

**Its question drops the prose form's interpolated counts, and that is a
recorded divergence.** The prose asks it with the bottleneck count and the P0
and P1 counts spliced in. A gate question is authoring-time constant and covered
by the graph hash, so it cannot carry a value that differs per run. The counts
are printed by `bottleneck-analysis` in the line immediately before this gate
fires, which is where the operator reads them while answering.

---

## `specification`

Executed inline in two parts, the second of them delegated. It turns the ranked
bottleneck list into a specification the planner can break down.

**Part A — optimization requirements (inline).** Present the bottleneck summary,
then ask the operator which priorities to address (every P0 and P1, the P0s
only, or a named subset), what constraints apply (backward compatibility, memory
limits, no new dependencies), and whether there are performance targets —
specific response-time goals, when any are known. Save the round to
`analysis/requirements.md` together with the performance issue description, the
bottleneck summary, the chosen priorities, the constraints and the targets.

**Default under a non-terminal driver** (`optimization-priorities`): the
analyzer's own priorities stand — every P0 and P1 bottleneck it identified, with
no constraint and no numeric target beyond what the invocation already supplied.
An invented performance target is the failure mode here: a target nobody set
becomes an acceptance criterion the specification is written against, and the
verification node later reports against it as though someone had asked for it.

**Part B — specification creation (delegate).**

> **ANTI-PATTERN**: Do NOT write the specification inline. Not because the task
> looks small, and not only when it does — the specification-creator agent
> writes it every time. Simplicity is never a reason to skip the delegation.

Invoke the specification creator through the Task tool with the performance task
type. Everything node-scoped it needs is in `with:`; the run-scoped four supply
the rest, including the style guide path that produces the specification's HTML
companion, and the project documentation paths `intake` discovered.

> **SELF-CHECK**: after the Task tool returns, verify that
> `implementation/spec.md` exists and covers the priorities gathered in Part A.
> If missing: **STOP. Do NOT proceed.** Re-invoke with corrected context.

**Executive summary before the gate.** Read `implementation/spec.md` and
extract: the optimization targets, the approach chosen, how many changes are
planned, and the expected impact. Print that summary immediately before
`specification-approval` fires.

**Recovery budget**: 2 attempts — regenerate the specification on the second
with the gaps named in the context.

**Phase summary key**: `specification`. Mirror this node's summary into
`performance_context.phase_summaries.specification`, with `node: specification`
on the entry, and register the companion path under that entry's
`artifacts[].html`.

---

## `specification-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

Its question names the specification audit, and the audit is what runs next on
every run of this workflow. There is no guard to evaluate and no
true-destination line to print.

---

## `spec-audit`

Delegated to the specification auditor through the Task tool. **It runs on every
run.** There is no opt-in, no size threshold and no flag: every performance
specification is reviewed before planning starts.

> **ANTI-PATTERN**: Do NOT review the specification yourself. The spec-auditor
> agent audits it from a senior auditor's perspective and verifies claims
> against the codebase rather than trusting them.

The auditor returns a verdict — pass, pass with concerns, or fail — issue counts
by severity, and the findings themselves. Write all of it to
`verification/spec-audit.md` and record the verdict in state.

A failing verdict does not end the run on its own. It is what the operator reads
at the gate, and the gate's stop option is the route out.

**Executive summary before the gate.** Read `verification/spec-audit.md` and
extract: the overall verdict, the issue counts by severity, and the top one or
two critical findings when there are any. Print that summary immediately before
`spec-audit-approval` fires.

**Recovery budget**: none — an audit that returns is an audit, whatever its
verdict.

---

## `spec-audit-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `planning`

Delegated to the implementation planner through the Task tool.

> **ANTI-PATTERN**: Do NOT break the work into steps inline. The
> implementation-planner agent produces the task groups, their dependencies and
> their test-first step lists. Simplicity is not a reason to skip the
> delegation.

The planner reads the specification, the audit findings and the performance
analysis, and sequences the optimizations so that a change whose measurement
depends on an earlier one lands after it.

> **SELF-CHECK**: after the Task tool returns, verify that
> `implementation/implementation-plan.md` exists and that its groups cover the
> specification's optimization targets. If missing: **STOP. Do NOT proceed.**

**Executive summary before the gate.** Read
`implementation/implementation-plan.md` and extract: how many task groups it
carries, the total number of steps, the key dependencies between groups, and the
optimization sequence. Print that summary immediately before `planning-approval`
fires.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
gaps named in the context.

**Phase summary key**: none. Register the plan's companion path on this node's
own summary entry under `artifacts[].html`; the four phase keys belong to the
nodes named in the phase-key section above and this is not one of them.

---

## `planning-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `implementation`

Delegated to the implementation-plan executor through the Skill tool. This is
the node that changes code, and it is the only one that does.

> **ANTI-PATTERN**: Do NOT apply the optimizations inline. Not for a small plan,
> not for a single-group plan — the implementation-plan-executor skill runs the
> groups, dispatches the implementers and keeps the plan's progress marks in
> step with what actually landed.

**The sequential input, and where the executor reads it.** Before invoking the
skill, record the input's value as `orchestrator.options.sequential`: the
executor reads that state key rather than the node input, so an input that is
never landed there is an input the run silently ignores. When it is true the
executor runs one task group at a time instead of dispatching independent groups
in parallel waves. It defaults to parallel.

**An input the operator did not supply is not an absent value.** `sequential`
declares `default: false`, so an invocation that never names it resolves to
`false` and lands as `false` — never `null`. `null` is what copying an absent
input writes rather than reading the default the definition already gives, and
it is not a value this option has.

**After the skill returns**, reconcile the plan's HTML companion when one exists
— every group whose steps are all marked done in the document must read as done
in the companion too, and a companion still showing outstanding work after a
complete run is a stale projection rather than a finding. Then record what
landed: the groups completed, the files changed and the incremental test results.

> **SELF-CHECK**: did the executor run, or did you start editing files yourself?
> If the latter, **STOP** and invoke the skill instead.

**Executive summary before the gate.** Read `implementation/work-log.md` and
this node's own summary and extract: the optimizations applied, the files
changed, the test results from the incremental runs, and any known issues or
deferred items. Print that summary immediately before `implementation-approval`
fires.

**Recovery budget**: 5 attempts — the widest in the run, because the failures
here are ordinary and local: fix a syntax error, fix an import, fix a failing
test, and re-run. When the fifth attempt has not cleared it, stop and ask the
operator rather than continuing on a red suite.

**Phase summary key**: `implementation`. Mirror this node's summary into
`performance_context.phase_summaries.implementation`, with `node:
implementation` on the entry.

---

## `implementation-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `verification-options`

Executed inline, writes no files, and decides which reviews the verification
node runs.

**Print the verification plan first** — the checks that always run, and the
recommended reviews with their current setting. The operator adjusts what they
see; a question asked without the plan on screen asks about nothing.

Then ask which additional verification checks to run. This question carries
the multi-choice flag (see `gate.schema.json`), offering code review
(recommended) and a production-readiness check. A gate cannot express it: a gate's options map
option ids to continue or stop, and this question picks a subset rather than a
route. The generated Copilot variant additionally rewrites a multi-choice
question into a run of single-choice ones, which is a second reason it belongs
in a node.

**Default under a non-terminal driver** (`standard-verifications`): the
recommended selection — code review on, production readiness off. The reality
check and the pragmatic review are always enabled and are not part of this
question, so a defaulted run still gets both.

Record the outcome as `orchestrator.options` keys, by these exact names. The
verifier reads them by name to decide which reviews run, so a key that is
missing or spelled differently silently runs a different review set:

- `code_review_enabled` and `production_check_enabled` — the two answers of the
  question above, each true when that review stayed selected.
- `reality_check_enabled` and `pragmatic_review_enabled` — always true. They are
  written here rather than assumed, so a reader of state can see the whole set
  in one place.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop in `verification` clears it the moment a fix
  changes code.

**Recovery budget**: none — this node asks and records.

---

## `verification-options-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

**Its question names a phase number the graph lacks, and that is a recorded
divergence.** Equality with the prose form is the stronger assertion, so the
number stays verbatim; the phase-number table above is how a reader resolves it.
Phase 8 is `verification`, and because nothing in this workflow is guarded, that
is where continuing goes on every run.

---

## `verification`

Delegated to the implementation verifier through the Skill tool, then a fix loop
inline.

> **ANTI-PATTERN**: Do NOT verify the implementation inline. The
> implementation-verifier skill runs the completeness check, the test suite and
> the selected reviews, and compiles them into one report.

Pass no style guide path: as a skill it resolves the guide itself and gates its
own companion on the HTML output option.

**Display the issue breakdown** the verifier returns, grouped by category and
severity, with the file and line for each and whether it is fixable
automatically or needs a hand.

**The fix loop.** When the verdict is anything but a clean pass, present the
critical and warning issues as a numbered list and ask which to fix: all the
fixable ones, a chosen subset, or none. Apply the chosen fixes, log each one,
and clear `skip_test_suite` because code changed. Record the applied fixes as
`verification_context.fixes_applied` and raise
`verification_context.reverify_count` by one **before** re-invoking the verifier:
those two keys are what tell the verifier it is running after fixes, and a re-run
that cannot see them rewrites nothing, leaving the pre-fix report standing. Then
ask whether to re-run the verification; a yes re-invokes the verifier and returns
to the breakdown. Both answers continue the run, which is why this is a node
question rather than a gate. **Budget: 3 fix rounds.**

**Default under a non-terminal driver** (`verification-fix-loop`): fix every
fixable issue, re-verify once, then continue to the gate. The re-run follows the
same rule as an answered one — `fixes_applied` recorded and `reverify_count`
raised before the verifier is re-invoked — and one re-verification is the whole
budget, because a loop nobody can stop is not a loop. An issue that remains
critical after it is **not** proceeded past: it is named in the line printed
before `verification-approval`, which is where an operator answers.

Also record `verification_context.last_status`,
`verification_context.issues_found` and `verification_context.decisions_made`, so
a later reader can tell a clean pass from a pass carried by an explicit
decision.

**Exit conditions**: no critical issue remains; or the operator explicitly chose
to proceed as-is; or the budget below is exhausted, at which point ask once
whether to proceed with the known issues or to stop. **Never proceed past an
unresolved critical issue without an explicit answer saying so** — a gate
answered from outside is such an answer; a default is not.

> **GATE CHECK**: the canonical report and its companion must carry the *final*
> post-fix verdict before this node completes. A report still showing the
> pre-fix state after fixes landed is a stale artifact, and the operator answers
> the next gate against it. Recompile it rather than leaving a side file to
> carry the truth.

**Executive summary before the gate.** Read
`verification/implementation-verification.md` and extract: the total issues
found, how many were fixed, and how many remain by severity. Print that summary
immediately before `verification-approval` fires.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed.

---

## `verification-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `finalization`

Executed inline, writes no files, and always runs — nothing invokes this
workflow as a sub-run, so there is no embedded case to guard against.

1. **Inventory the outputs**: the performance analysis, the requirements, the
   specification, the audit, the plan, the work log and the verification report.
   All seven exist on a run that reached here, because nothing in this workflow
   is conditional — so an absent one is a defect to name rather than a skip to
   explain. Take the inventory from disk and not from state: compare every
   artifact the run declared against what is actually there, and name every
   declared path that is absent (`orchestrator-patterns.md` § 10).
2. **Present the executive summary**: which bottlenecks were found, which
   optimizations landed, the verification verdict with any issues left open, and
   whether the ranking rested on profiling data or on static analysis alone.
3. **Set the task status to completed**.
4. **Guide the next steps**, which for this workflow are its own four: run the
   application and confirm the improvement by hand; profile with runtime tools
   to measure the actual impact, since this workflow's ranking was static unless
   the operator supplied data; watch the production metrics after deployment;
   and come back for the remaining P2 and P3 bottlenecks if they still matter.
   Suggest a fresh session for whatever comes next rather than continuing in
   this one.

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
