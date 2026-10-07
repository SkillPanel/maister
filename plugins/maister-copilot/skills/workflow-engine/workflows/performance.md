# Performance workflow — node prose

The node-by-node companion to `performance.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need and what they declare. It says nothing about the
operator questions asked *inside* a node, what each node writes into its closing
summary for the gate brief, the self-checks that decide whether a node succeeded, or how many
times the engine may re-drive one. Those live here.

**State the consequence plainly**: a reader of `performance.yml` alone cannot
see that the run asks four further questions beyond its six gates — in run
order, the clarification page with its profiling-data tab, the specification's
requirements page, the choice of checks and the verification fix loop — and the
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

No gate question names a phase number; this table maps the 2.x prose form's phases
to nodes:

| 2.x phase | Node | Closing gate |
|---|---|---|
| Initialization steps 1-7 | `intake` | none — it auto-continues |
| 1 | `codebase-analysis` | none — it auto-continues |
| 2 | `bottleneck-analysis` | `bottleneck-approval` |
| 3 | `specification` | `specification-approval` |
| 4 | `spec-audit` | `spec-audit-approval` |
| 5 | `planning` | `planning-approval` |
| 6 | `implementation` | `implementation-approval` |
| 7 | `verification-options` | none — it auto-continues |
| 8 | `verification` | `verification-approval` |
| 9 | `finalization` | none — the workflow ends |

The gate brief's `Next:` line names the node that actually runs after each gate
(engine § Gates); here every node runs on every run, so it is always the next
node in the table.

---

## Run-scoped context

The four fields every delegate receives outside `with:` — `task_path`,
`html_style_guide_path`, the project's documentation paths and the prior-phase
passage fetched with `prior-context` — and the `${…}` substitution that fills
`with:` are the engine's, stated once in engine § *Run-scoped context* and
§ *Interpolating `${…}`*. What this workflow adds:

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
> recorded where it was made.
> Rewriting them in your own words loses the sentence the operator is about to
> approve at a gate; writing an empty `[]` because the node has already read
> the artifact loses it outright, and `decisions: []` beside a specification
> carrying eight of them is the failure this block exists to stop.

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

The six gates are not in that table on purpose:
**each gate node renders the icon of the node it closes** — `bottleneck-approval`
`analysis`, `specification-approval` `spec`, `spec-audit-approval` `verify`,
`planning-approval` `plan`, `implementation-approval` `code`,
`verification-approval` `verify`. A
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
   when the file or the key is absent) and `options.mockup_format` (default
   `html`) beside it. The second is framework-mandated for every orchestrator and
   inert here — no node reads it — but a reader of state expects it. When
   `html_output` is false, skip the dashboard entirely — no dashboard asset, no data projection, no browser open.
   Otherwise the freeze installed `dashboard.html` in the task root (see the
   changed paths it reported) — copy nothing; **run the platform opener** on the
   plain absolute path through the shell — `open "<task path>/dashboard.html"`
   on macOS, `xdg-open` on Linux, `start ""` on Windows. Never build a `file://`
   URL; the opener resolves a plain path itself. On failure print the path;
   never block.
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

**There is no gate after this node.** It auto-continues into the codebase
analysis.

**Recovery budget**: none — this node establishes state, and a configuration
file it cannot find is an absence rather than a failure.

---

## `codebase-analysis`

Delegated to the codebase analyzer through the Skill tool, then a short
clarification round inline.

The codebase-analyzer skill runs this exploration every time rather than an
inline read: it dispatches parallel explorers and produces the structured
analysis every later node reads.

Pass the enhancement task type and a performance-focused description. The
analyzer adaptively selects its explorers, and for a performance run the
description is what steers them toward database query patterns, hot code paths,
I/O operations, caching layers, connection management and schema or migration
files. A description that names only the symptom sends them nowhere in
particular.

After the skill returns, write the analysis summary, the key files and the
primary language into state. Then ask **one page** (engine § *In-node
questions*) of at most four tabs:

- **Clarifications** — one tab for each thing about the performance concern, the
  suspected hotspots or the optimization goals that the analysis could not
  settle, at most three of them. Each tab's question states what the analysis
  found and what it could not settle; its options are two or three generated
  answers, the recommended one first with its reason in its description, and
  More details when the tab needs more than its question holds. Ask only what
  the analysis could not settle, and never what the specification's priorities,
  constraints or targets will ask.
- **Profiling data** — one tab, asked while `analysis/user-profiling-data/` is
  empty: "Do you have profiling data — flame graphs, APM screenshots, slow-query
  logs — for the bottleneck analysis?", with **"No, analyse the code alone
  (Recommended): the code shows the hotspots"** and **"Yes, I'll add files to
  `analysis/user-profiling-data/`"**, its description giving the folder's path
  from the project root.
  When the folder already holds files, the tab is not asked: say in one line
  that they will be used.

When the analysis settled everything and the folder holds files, nothing is
asked. Every answer continues the run, which is why the page is asked here
rather than at a gate. When the answer is "Yes", say where the folder is and
wait for the user to say the files are there before this node completes.

Save the clarification answers to `analysis/clarifications.md`, then set
`performance_context.clarifications_resolved` to true. A run that asked no
clarification still writes the file and still sets the flag: it resolved the
clarifications by having none to ask. Record each answered tab as a
`by: operator` decision on this node's summary, one per question, as engine
§ *In-node questions* says.

**Default under a non-terminal driver** (`clarifications`): none is asked, and
the analysis's own answers stand. The file is written and
`performance_context.clarifications_resolved` set exactly as they are for a run
with nothing to ask, and what the analysis could not settle about hotspots or
goals is recorded in the file as unsettled rather than guessed at.

**Default under a non-terminal driver** (`profiling-data`): no profiling data,
and the run proceeds on static analysis alone, recorded as a `by: default`
decision. Waiting for files nobody can drop is the one thing this question must
not do under a driver — the wait never ends.

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

The bottleneck-analyzer agent does the analysis rather than an inline read or
grep, because it reads source, schema and query patterns together and produces
the ranked list the specification is written against.

**Check the profiling directory before delegating.** `intake` declared
`analysis/user-profiling-data/` and created it empty, and `codebase-analysis`
already asked whether the user has files for it. When it holds files, pass
them: flame graphs, APM screenshots and slow-query logs turn a static ranking
into a measured one. When it is empty, the analysis is static-only — this node
asks nothing. Say in the phase summary which it was, because a bottleneck list
built without profiling data otherwise reads the same as one built with it.

**Write the structured result to state before anything else.** Record
`performance_context.bottlenecks_identified` from the analyzer's count,
`performance_context.user_data_available` from whether the directory held
anything, and `performance_context.bottleneck_priorities` with its `p0`, `p1`,
`p2` and `p3` counts.

**Gate brief content.** Read `analysis/performance-analysis.md` and write into
this node's closing `node_summaries` entry, as engine § Gates says:

- **`headline`** — one sentence for the whole analysis stretch, led by the top
  finding and what fixing it changes ("Found 5 bottlenecks, 2 critical: the
  order report runs one database query per order, 5,001 per report, where 2
  would do").
- **`summary`** — how many bottlenecks were identified, how many are critical
  (P0) and how many high (P1), whether profiling data was incorporated, and the
  top one or two findings in plain words. **Findings belong here, never in
  `risks`.** The analyzer's bottleneck ids (B1, B2…) and priority codes (P0
  critical, P1 high, P2 medium, P3 low) are spelled out at first use, and a
  bottleneck is named by what it is ("one database call per order"), never by its
  id alone.
- **`decisions`** — the ranking choices the analysis made, as `by: run`, never
  an earlier answer restated.
- **`risks`** — only what the analysis could not settle, as an `open` risk with
  its `change` (a hotspot it could only guess at without profiling data, say).

**This is the compensating behaviour for the gate's constant `ask:`**, which
cannot carry those counts — the gate brief shows them at `bottleneck-approval`.

**When re-run after a revise.** `bottleneck-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Ask
nothing about profiling data: the directory is read as it stands, with any files
the note says were added. Hand the analyzer the note and the existing
`analysis/performance-analysis.md`, and ask it to revise the analysis in place —
re-rank, add or drop what the note names — then write the structured result to
state again, because a revise clears it. Say in the summary and the headline
what changed.

**Recovery budget**: 2 attempts — re-analyze with broader patterns on the
second, and ask the operator when the second also comes back thin.

**Phase summary key**: `bottleneck_analysis`. Mirror this node's summary into
`performance_context.phase_summaries.bottleneck_analysis` with the bottleneck
list and `user_data_incorporated`, and with `node: bottleneck-analysis` on the
entry.

---

## `bottleneck-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option —
nothing after a stopped node ever becomes ready. Its revise option sends the run
back to `bottleneck-analysis` with the operator's note (engine § Gates,
*Revising at a gate*).

**Its `ask:` drops the 2.x prose form's interpolated counts, and that is a
recorded divergence.** The prose asks it with the bottleneck count and the P0
and P1 counts spliced in. A gate's `ask:` is authoring-time constant and covered
by the graph hash, so it cannot carry a value that differs per run. The counts
are in the `bottleneck-analysis` headline and summary, which the gate brief
shows while the operator answers.

---

## `specification`

Executed inline in two parts, the second of them delegated. It turns the ranked
bottleneck list into a specification the planner can break down.

**Part A — optimization requirements (inline).** Ask **one page of three tabs**
(engine § *In-node questions*), each recommending an answer with its reason:

- **Priorities** — which bottlenecks to address. The question lists every
  critical (P0) and high (P1) bottleneck in its own text, one line each, named
  by what it is ("one database call per order", "the every-SKU-against-every-SKU
  scan") with its priority beside it — never "the bottlenecks above". Options:
  **"Every P0 and P1 (Recommended)"**, its reason the impact the analysis
  measured, then "The P0s only", then "Choose individually", which opens the
  bottlenecks as a multi-choice question.
- **Constraints** — what the optimization must keep. The recommended bundle is
  what the analysis implies: one that found the output must stay identical
  implies backward compatibility; one that found no dependency is needed implies
  no new dependencies. Offer bundles in one single-select: the implied set
  first, labelled `(Recommended)` with the finding that implies it as its reason
  ("Backward compatibility and no new dependencies (Recommended): the analysis
  requires the report's output to stay identical"), then **"No extra
  constraints"**, then **"Choose individually"**, which opens backward
  compatibility, memory limits and no new dependencies as a multi-choice
  question. When the analysis implies none, **"No extra constraints"** is the
  recommended bundle.
- **Targets** — whether there is a performance target. **"No numeric target
  (Recommended)"**, its reason that the verification then reports the change
  against what the analysis measured, then one or two targets generated from
  the analysis ("Report under 100 ms"), each saying what it would make the
  verification check; a target of the user's own comes through Other.

The page is one form of three properties; where the tool shows no option
descriptions, each option's reason is its line in the property's description.

Record each answered tab as a `by: operator` decision, one per question, as
engine § *In-node questions* says. Save the round to `analysis/requirements.md`
together with the performance issue description, the bottleneck summary, the
chosen priorities, the constraints and the targets.

**Default under a non-terminal driver** (`optimization-priorities`): the
analyzer's own priorities stand — every P0 and P1 bottleneck it identified, with
the constraints tab's recommended bundle and no numeric target beyond what the
invocation already supplied — recorded as one `by: default` decision.
An invented performance target is the failure mode here: a target nobody set
becomes an acceptance criterion the specification is written against, and the
verification node later reports against it as though someone had asked for it.

**Part B — specification creation (delegate).**

The specification-creator agent writes the specification every time, whatever
the task's size, because it searches for reusable code and checks coverage of
the priorities before the audit and the planner read the result.

Invoke the specification creator through the Task tool with the performance task
type. Everything node-scoped it needs is in `with:`; the run-scoped five supply
the rest, including the style guide path that produces the specification's HTML
companion, and the project documentation paths `intake` discovered.

If the agent returns without `implementation/spec.md`, or with one that leaves a
priority gathered in Part A uncovered, re-invoke it with the missing context
rather than writing the specification yourself.

**Gate brief content.** Read `implementation/spec.md` and write into this node's
closing `node_summaries` entry, as engine § Gates says: a `headline` — how many
changes the specification plans and the impact it expects, in one sentence; the
optimization targets, the number of changes and the expected impact in
`summary`; the approach chosen as a `by: run` decision, beside the Part A
answers already recorded — neither those answers nor the analysis's ranking is
restated as the specification's; each assumption as an `open` risk whose `change` says
what would change if it is wrong. The `specification-approval` brief is
rendered from it.

**When re-run after a revise.** `specification-approval` or
`spec-audit-approval` sent the run back, and `prior-context` carries the
operator's note under *Revision requested*, beside the previous attempt's
summaries — the audit's findings among them when it was the audit's gate. Keep
Part A's answers: ask again only what the note reopens, and record the change in
`analysis/requirements.md`. In Part B, hand the specification creator the note,
the audit's findings when there are any, and the existing `implementation/spec.md`,
and ask it to revise the specification in place. Say in the summary what changed.

**Recovery budget**: 2 attempts — regenerate the specification on the second
with the gaps named in the context.

**Phase summary key**: `specification`. Mirror this node's summary into
`performance_context.phase_summaries.specification`, with `node: specification`
on the entry, and register the companion path under that entry's
`artifacts[].html`.

---

## `specification-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `specification` with the operator's note
(engine § Gates, *Revising at a gate*).

Its question names the specification audit, and the audit is what runs next on
every run of this workflow; the gate brief's `Next:` line says the same.

---

## `spec-audit`

Delegated to the specification auditor through the Task tool. **It runs on every
run.** There is no opt-in, no size threshold and no flag: every performance
specification is reviewed before planning starts.

The spec-auditor agent audits the specification rather than an inline review,
because it checks the spec's claims against the codebase instead of trusting
them — and it runs before any code exists, so it audits the spec itself, not an
implementation.

The auditor's prompt names its report path `verification/spec-audit.md`, and
the auditor writes the report there: a verdict — pass, pass with concerns, or
fail — issue counts by severity, and the findings themselves. The report is the
auditor's. If the auditor returns its report as text and the file does not
exist, write that returned text to the path verbatim, once; never append to the
report, edit it, annotate it or resolve its findings. Record the verdict in
state.

This node asks the operator nothing — no question about findings, no revise round; the following gate is the operator's moment.

A failing verdict does not end the run on its own. It is what the operator reads
at the gate, and the gate's stop option is the route out.

**Gate brief content.** Read `verification/spec-audit.md` and write into this
node's closing `node_summaries` entry, as engine § Gates says: a `headline` —
the verdict and what it means for planning, in one sentence; the overall verdict
and the issue counts by severity in `summary`; each finding the audit settled
as a `by: audit` decision, never an earlier answer restated; each critical finding still open as an `open` risk
whose `change` is the fix the audit proposes. The `spec-audit-approval` brief is
rendered from it.

**Recovery budget**: none — an audit that returns is an audit, whatever its
verdict.

---

## `spec-audit-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `specification` with the operator's note;
the audit's findings reach the re-run through the prior context, and the
specification is approved and audited again before this gate asks once more
(engine § Gates, *Revising at a gate*).

---

## `planning`

Delegated to the implementation planner through the Task tool.

The implementation-planner agent writes the plan every time, whatever the
task's size, because it produces the task groups, their dependencies and the
test-first step lists the executor dispatches from.

The planner reads the specification, the audit findings and the performance
analysis, and sequences the optimizations so that a change whose measurement
depends on an earlier one lands after it.

If the planner returns without `implementation/implementation-plan.md`, or with
groups that leave an optimization target uncovered, re-invoke it with the
missing context rather than writing the plan yourself.

**Gate brief content.** Read `implementation/implementation-plan.md` and write
into this node's closing `node_summaries` entry, as engine § Gates says: a
`headline` — the groups, the steps and the waves they run in, in one sentence;
how many task groups it carries and the total number of steps in `summary`; the
key dependencies between groups and the optimization sequence as `by: run`
decisions, never an earlier answer restated; open risks, if any, as `open` risks with their `change`. The
`planning-approval` brief is rendered from it.

**When re-run after a revise.** `planning-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Hand the
planner the note and the existing `implementation/implementation-plan.md`, and
ask it to revise the plan in place — regroup, split or re-sequence what the note
names and keep the rest — and to check it against the optimization targets
again. Say in the summary what changed.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
gaps named in the context.

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

## `implementation`

Delegated to the implementation-plan executor through the Skill tool. This is
the node that changes code, and it is the only one that does.

The implementation-plan-executor skill applies the optimizations every time,
whatever the plan's size, because it runs the groups, dispatches the
implementers and keeps the plan's progress marks in step with what actually
landed.

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

**After the skill returns**, reconcile the plan's HTML companion: run the
engine's `sync-plan` verb once against `implementation/implementation-plan.md`.
It is the call the executor makes after every wave, so it is idempotent and a
no-op without a companion — here it catches a wave whose sync was missed. A
companion still showing outstanding work after a complete run is a stale
projection rather than a finding. Then record what
landed: the groups completed, the files changed and the incremental test results.

**Gate brief content.** Read `implementation/work-log.md` and write into this
node's closing `node_summaries` entry, as engine § Gates says: a `headline` —
the optimizations applied and the test result, in one sentence; the
optimizations applied, the files changed and the test results from the
incremental runs in `summary`; a known issue as an `open` risk with its
`change`, and an item deferred on purpose as a `followup` risk. The
`implementation-approval` brief is rendered from it.

**Recovery budget**: 5 attempts — the widest in the run, because the failures
here are ordinary and local: fix a syntax error, fix an import, fix a failing
test, and re-run. When the fifth attempt has not cleared it, stop and ask the
operator rather than continuing on a red suite.

**Phase summary key**: `implementation`. Mirror this node's summary into
`performance_context.phase_summaries.implementation`, with `node:
implementation` on the entry.

---

## `implementation-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

---

## `verification-options`

Executed inline, writes no files, and decides which reviews the verification
node runs.

**The verification plan is the question's text** — the checks that always run
(the completeness check, the reality check and the pragmatic review) and the
recommended reviews, written into the question above its options rather than
printed ahead of it. The user adjusts what they see; a question that does not
carry the plan asks about nothing. Say exactly when the test suite runs: it
already passed during implementation, so the first verification pass does not
run it again, and it runs on every pass after a fix changes code. Never list it
under "always runs".

Ask which additional verification checks to run, as bundles in one single-select
(engine § *In-node questions*): **"Code review (Recommended)"**, its reason in
the description, then **"Code review and production readiness"**, then **"No
additional checks"**. A gate cannot express it: a gate's options map option ids
to routes — continue, stop or revise — and this question picks a subset rather
than a route.

**Default under a non-terminal driver** (`standard-verifications`): the
recommended bundle, code review only — production readiness off. The reality
check and the pragmatic review are always enabled and are not part of this
question, so a defaulted run still gets both.

Record the outcome as `orchestrator.options` keys, by these exact names. The
verifier reads them by name to decide which reviews run, so a key that is
missing or spelled differently silently runs a different review set:

- `code_review_enabled` and `production_check_enabled` — each true when the
  chosen bundle includes that review.
- `reality_check_enabled` and `pragmatic_review_enabled` — always true. They are
  written here rather than assumed, so a reader of state can see the whole set
  in one place.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop in `verification` clears it the moment a fix
  changes code.

**Node summary.** Write into this node's closing `node_summaries` entry the
review set the verification will run — code review and production readiness,
each on or off, beside the reality check and the pragmatic review that always
run — and whether the test suite re-runs, in `summary`; in `decisions`, the
answer as one `by: operator` decision, or the `by: default` decision when a
non-terminal driver took the recommended bundle. No gate follows: the summary
reaches the `verification-approval` brief, which covers the whole stretch back
to the implementation gate.

**There is no gate after this node.** The answer is the approval, so the run
goes straight on to `verification`.

**Recovery budget**: none — this node asks and records.

---

## `verification`

Delegated to the implementation verifier through the Skill tool, then a fix loop
inline.

The implementation-verifier skill does the verification rather than an inline
review, because it runs the test suite first, as its own step, passes that
result into every review prompt, and compiles the completeness check and the
selected reviews into one report.

Pass no style guide path: as a skill it resolves the guide itself and gates its
own companion on the HTML output option.

**Show the issue breakdown** the verifier returns: the verdict, the counts by
severity, and the report's path from the project root
(`.maister/tasks/performance/<run>/verification/implementation-verification.md`).

**The fix loop runs on its own for the obvious fixes**
(`orchestrator-patterns.md` § 6, *Fix-Then-Reverify Loop*, which this follows
step by step):

- **Fixed without asking**: every unfixed issue the verifier marked fixable and
  not risky. Log each in the work log and in
  `verification_context.fixes_applied`, and clear `skip_test_suite` when a fix
  changed code.
- **Re-checked without asking**: a full re-verification after a fix that changed
  behaviour; the verifier's `recheck: tests-only` after fixes that changed none.
  Each raises `verification_context.reverify_count` by one. **Two re-checks run
  without asking.** Say each as "re-check 1 of 2"; never announce a fix before it
  is made. Each fix is a `by: run` decision.
- **Left for later without asking**: an item whose recommendation is to leave
  it — a pre-existing info item that predates the change — is a `followup`
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
  worst item in a few words — and offers "One more round", "Continue as is" and
  "Stop", one of them recommended with its reason in its description: "Continue
  as is" when only warnings remain, "One more round" when the last round made
  progress, "Stop" when a critical issue is left. "Continue as is" leaves each
  undecided issue an `open` risk for the gate; "Stop" writes a `stop` risk, so
  the gate recommends stopping.

**Default under a non-terminal driver** (`verification-fix-loop`): the loop runs
exactly as above — fixable, non-risky issues fixed and re-checked within the same
two re-checks — and nothing is asked. Every issue that needs a decision, and every
risky fix, stays open as an `open` risk in this node's summary, and the stopping
point takes "Continue as is". An issue still critical is **not** proceeded past:
it is an `open` risk, which the gate brief shows at `verification-approval` — where a person
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

**Gate brief content.** Read `verification/implementation-verification.md` and
write into this node's closing `node_summaries` entry, as engine § Gates says: a
`headline` — the verdict, what was fixed and what is left, in one sentence; the
total issues found, how many were fixed and how many remain by severity in
`summary`; each fix made without asking — its issue in a few words — as a
`by: run` decision, so the checkpoint shows exactly what changed without the
user choosing it; each answered fix-loop question as a `by: operator` decision;
no earlier answer restated; each issue still needing a decision as an `open` risk with the fix as its
`change`; each item left for later as a `followup` risk; and, when the user
chose "Stop" or the budget ran out with a critical issue open, a `stop` risk
saying why. The `verification-approval` brief is rendered from it.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed.

---

## `verification-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

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
   the user supplied data; watch the production metrics after deployment;
   and come back for the remaining P2 and P3 bottlenecks if they still matter.
   Suggest a fresh session for whatever comes next rather than continuing in
   this one.

**Close for whoever reads the end** (the engine skill's run-end rule). In a
terminal run a person reads it: write the closing patch and call `run-complete`
first, then end with one wrap-up message that fits one screen and is the last
thing the run prints. Its five lead lines are the engine's — Done, Needs you,
Next, Files, Dashboard — then, a line or two each: the rest of step 4's next
steps (all four of this workflow's own, then the fresh-session suggestion, none
dropped or merged) and each artifact the verb reported missing, named in plain
words. Nothing about how the run was carried out appears unless it changed the
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
