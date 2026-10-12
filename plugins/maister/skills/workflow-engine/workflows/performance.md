# Performance workflow — node prose

The node-by-node companion to `performance.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot**: the operator questions asked
*inside* a node, what each node writes into its closing summary for the gate
brief, the self-checks that decide whether a node succeeded, and how many times
the engine may re-drive one. Beyond its six gates the run asks five further
questions — in run order, the clarification page with its profiling-data tab,
the specification's requirements page, the audit findings that need a decision,
the choice of checks, and the verification fix loop with a question per issue.
Neither `performance.yml` nor its diagram shows them.

**Every question asked inside a node names its default here.** Under a `cockpit`
driver whose features list `question-sets`, a node asks through the cockpit, in
one request per attempt, as its section's **With question sets** line says.
Under any other `cockpit` or `dispatch` driver nobody is asked: each question
takes the default its section states under **Without question sets**, and the
node records that it did. The rule and the recording shape are the engine's
(`references/in-node-questions.md` § *When nobody can be asked*).

**When the run's policy classes in-node questions** — the freeze recorded
`orchestrator.classes_questions` — a node sends the question set it would ask to
the writer before asking anything, and asks only the ids the writer's `ask:`
line names; the rest are already on the node's summary (engine
`references/in-node-questions.md` § *When the policy classes a question*). No
section below changes for it.

**Recovery budgets are prose**, never `with:` data (engine *Recording an
outcome*). Six nodes carry one; the rest re-drive nothing.

**No node is guarded**, so every phase runs on every run and nothing is ever
skipped: the specification audit has no opt-in, and profiling data changes what
a node reads, not whether it runs. The gate brief's `Next:` line is therefore
always the next node in run order (engine `references/gates.md`).

---

## Run-scoped context

Every delegate prompt opens with the `run-context --node=<this node>` output,
pasted unedited (artifact writers: `prior-context --node=<this node>`, which
prints that block first): the task path, the HTML style guide, the documentation
paths, the scratch rule and the companions the node owes. What this workflow adds:

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

`node_summaries` is keyed by node id; `performance_context.phase_summaries` by
this workflow's own semantic keys. Four keys over four owning nodes:

| Node | `phase_summaries` keys |
|---|---|
| `codebase-analysis` | `codebase_analysis` |
| `bottleneck-analysis` | `bottleneck_analysis` |
| `specification` | `specification` |
| `implementation` | `implementation` |

Every other node writes a node summary only. Each mirrored entry carries
`node:` naming the node it came from. `performance_context` is the only context
block this workflow writes. A phase key is never a node id: a key written off
the node id succeeds and nothing reads it, so the mapping is pinned here.

---

## Icon hints

Each node writes the `icon_hint` named here; it is not derivable from the id:

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

**Each gate node renders the icon of the node it closes** — `bottleneck-approval`
`analysis`, `specification-approval` `spec`, `spec-audit-approval` `verify`,
`planning-approval` `plan`, `implementation-approval` `code`,
`verification-approval` `verify`.

---

## Embedded mode

**There is none.** Nothing runs this workflow as a sub-run, so the definition
declares no `embedded` input and `finalization` carries no guard. Making it
child-capable follows engine `references/sub-runs.md` § *Making a workflow
child-capable*, with the guard on `finalization`.

---

## `intake`

Executed inline, before any analysis. It establishes the task directory, the
state file and the profiling-data drop point the analysis node reads from.

1. **Capture the clock** through the shell, not from context. Every timestamp
   written this turn uses that one value; a date-only or midnight-stamped value
   is the documented failure mode.
2. **Create and initialize** the task directory and its state file, with the
   task description and an empty `phase_summaries` map under
   `performance_context` — the writer seeds it on the first write that touches
   the block.
3. **Create `analysis/user-profiling-data/`**, empty — this node's declared
   artifact. **An empty directory is the answer "no profiling data", not a
   missing artifact.**
4. **Read the project configuration** and set `options.html_output` (default
   true when the file or the key is absent) and `options.mockup_format` (default
   `html`; no node here reads it, but a reader of state expects it). When
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

**There is no gate after this node.** It auto-continues into the codebase
analysis.

**Recovery budget**: none — a configuration file it cannot find is an absence,
not a failure.

---

## `codebase-analysis`

Delegated to the codebase-analyzer skill through the Skill tool, every time,
then a short clarification round inline.

Pass the enhancement task type and a performance-focused description: it is
what steers the explorers toward database query patterns, hot code paths, I/O
operations, caching layers, connection management and schema or migration
files. A description that names only the symptom sends them nowhere in
particular.

After the skill returns, write the analysis summary, the key files and the
primary language into state. Then ask **one page** (engine `references/in-node-questions.md`) of at most four tabs:

- **Clarifications** — one tab for each thing about the performance concern, the
  suspected hotspots or the optimization goals that the analysis could not
  settle, at most three of them. Each tab's question states what the analysis
  found and what it could not settle; its options are two or three generated
  answers, the recommended one first with its reason in its description, and
  More details when the tab needs more than its question holds. Never ask what
  the specification's priorities, constraints or targets will ask.
- **Profiling data** — one tab, asked while `analysis/user-profiling-data/` is
  empty: "Do you have profiling data — flame graphs, APM screenshots, slow-query
  logs — for the bottleneck analysis?", with **"No, analyse the code alone
  (Recommended): the code shows the hotspots"** and **"Yes, I'll add files to
  `analysis/user-profiling-data/`"**, its description giving the folder's path
  from the project root.
  When the folder already holds files, the tab is not asked: say in one line
  that they will be used.

When the analysis settled everything and the folder holds files, nothing is
asked. When the answer is "Yes", say where the folder is and wait for the user
to say the files are there before this node completes.

Save the clarification answers to `analysis/clarifications.md`, then set
`performance_context.clarifications_resolved` to true — also when nothing was
asked. Record each answered tab as a `by: operator` decision on this node's
summary, one per question.

**With question sets** (`clarifications`): asked through the cockpit, in this
node's one request (engine `references/in-node-questions.md`).

**Without question sets** (`clarifications`): none is asked, and
the analysis's own answers stand. The file is written and
`performance_context.clarifications_resolved` set as for a run with nothing to
ask; what the analysis could not settle about hotspots or goals is recorded in
the file as unsettled rather than guessed at.

**With question sets** (`profiling-data`): asked through the cockpit, in the
same request as the clarifications; its "Yes" option says the files must be in
the folder before answering, because the node does not wait after it resumes.

**Without question sets** (`profiling-data`): no profiling data,
and the run proceeds on static analysis alone, recorded as a `by: default`
decision. Never wait for files under a driver — nobody can drop them.

**There is no gate after this node.** It auto-continues into the bottleneck
analysis.

**Recovery budget**: 2 attempts — expand the search patterns on the second, and
prompt the operator when the second also comes back thin.

**Phase summary key**: `codebase_analysis`. Mirror this node's summary into
`performance_context.phase_summaries.codebase_analysis` with the key files and
the primary language, and with `node: codebase-analysis` on the entry.

---

## `bottleneck-analysis`

Delegated to the bottleneck-analyzer agent through the Task tool; it reads
source, schema and query patterns together and produces the ranked list the
specification is written against. Everything after this node optimizes what it
found.

**Check the profiling directory before delegating.** When
`analysis/user-profiling-data/` holds files, pass them: they turn a static
ranking into a measured one. When it is empty, the analysis is static-only —
this node asks nothing. Say in the phase summary which it was.

**Write the structured result to state before anything else.** Record
`performance_context.bottlenecks_identified` from the analyzer's count,
`performance_context.user_data_available` from whether the directory held
anything, and `performance_context.bottleneck_priorities` with its `p0`, `p1`,
`p2` and `p3` counts.

**Gate brief content.** Read `analysis/performance-analysis.md` and write into
this node's closing `node_summaries` entry, as engine `references/gates.md` says:

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

The gate's `ask:` is constant and cannot carry these counts; the brief shows
them at `bottleneck-approval`.

**When re-run after a revise.** `prior-context` carries the operator's note
under *Revision requested*. Ask nothing about profiling data: read the directory
as it stands. Hand the analyzer the note and the existing
`analysis/performance-analysis.md` to revise in place — re-rank, add or drop
what the note names — then write the structured result to state again, because
a revise clears it. Say in the summary and the headline what changed.

**Recovery budget**: 2 attempts — re-analyze with broader patterns on the
second, and ask the operator when the second also comes back thin.

**Phase summary key**: `bottleneck_analysis`. Mirror this node's summary into
`performance_context.phase_summaries.bottleneck_analysis` with the bottleneck
list and `user_data_incorporated`, and with `node: bottleneck-analysis` on the
entry.

---

## `bottleneck-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option —
nothing after a stopped node ever becomes ready. Its revise option sends the run
back to `bottleneck-analysis` with the operator's note (engine `references/gates.md`,
*Revising at a gate*). The bottleneck counts are in the brief, not the question.

---

## `specification`

Executed inline in two parts, the second of them delegated. It turns the ranked
bottleneck list into a specification the planner can break down.

**Part A — optimization requirements (inline).** Ask **one page of three tabs**
(engine `references/in-node-questions.md`), each recommending an answer with its reason:

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

<!-- rich-picker -->
The recommended priorities option's preview lists each bottleneck it covers
with its file and the change the analysis expects; each generated target's
preview says what it measures and where.
<!-- /rich-picker -->
<!-- plain-picker
The page is one form of three properties; where the tool shows no option
descriptions, each option's reason is its line in the property's description.
-->

Record each answered tab as a `by: operator` decision, one per question. Save
the round to `analysis/requirements.md` together with the performance issue
description, the bottleneck summary, the chosen priorities, the constraints and
the targets.

**With question sets** (`optimization-priorities`): asked through the cockpit,
in this node's one request (engine `references/in-node-questions.md`); "Choose individually" would
need a second ask, so it is not offered.

**Without question sets** (`optimization-priorities`): the
analyzer's own priorities stand — every P0 and P1 bottleneck it identified, with
the constraints tab's recommended bundle and no numeric target beyond what the
invocation already supplied — recorded as one `by: default` decision. Never
invent a performance target: it becomes an acceptance criterion nobody set.

**Part B — specification creation (delegate).** Invoke the
specification-creator agent through the Task tool, whatever the task's size,
with the performance task type. Everything node-scoped it needs is in `with:`;
the `prior-context --node=specification` output supplies the rest, the `html:`
line and the documentation paths included.

If the agent returns without `implementation/spec.md`, or with one that leaves a
priority gathered in Part A uncovered, re-invoke it with the missing context
rather than writing the specification yourself.

**Gate brief content.** Read `implementation/spec.md` and write into this node's
closing `node_summaries` entry, as engine `references/gates.md` says: a `headline` — how many
changes the specification plans and the impact it expects, in one sentence; the
optimization targets, the number of changes and the expected impact in
`summary`; the approach chosen as a `by: run` decision, beside the Part A
answers already recorded — neither those answers nor the analysis's ranking is
restated as the specification's; each assumption as an `open` risk whose `change` says
what would change if it is wrong.

**When re-run after a revise.** `specification-approval` or
`spec-audit-approval` sent the run back; `prior-context` carries the operator's
note under *Revision requested*, beside the previous attempt's summaries. Keep
Part A's answers: ask again only what the note reopens, and record the change in
`analysis/requirements.md`. In Part B, hand the specification creator the note,
the audit's findings still open when there are any — never the ones the audit's
fix pass already applied — and the existing `implementation/spec.md`, to revise
in place. Say in the summary what changed.

**Recovery budget**: 2 attempts — regenerate the specification on the second
with the gaps named in the context.

**Phase summary key**: `specification`. Mirror this node's summary into
`performance_context.phase_summaries.specification`, with `node: specification`
on the entry, and register the companion path under that entry's
`artifacts[].html`.

---

## `specification-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `specification` with the operator's note
(engine `references/gates.md`, *Revising at a gate*). The audit its question
names runs next on every run.

---

## `spec-audit`

Delegated to the spec-auditor agent through the Task tool, then a fix pass for
the findings with one obvious fix. **It runs on every run** — no opt-in, no size
threshold, no flag. The auditor checks the spec's claims against the codebase
before any code exists.

The auditor's prompt names its report path `verification/spec-audit.md` and
hands it the user's earlier answers — `analysis/requirements.md` and the
decisions `prior-context --background` returns — so it can tell a finding with
one obvious fix from one that needs a decision. The report carries a verdict —
pass, pass with concerns, or fail — issue counts by severity, and the findings,
each graded fixable or needing a decision. The report is the auditor's: if it
returns the report as text and the file does not exist, write that text to the
path verbatim, once; never append to it, edit it or annotate it. Record the
verdict in state.

**The obvious fixes are made without asking**
(`orchestrator-patterns.md` § 6, *The Specification Audit's Fix Pass*): one fix
pass, in which the `maister:specification-creator` agent, through the Task tool
in its amend mode, applies every finding graded fixable to
`implementation/spec.md` (and to `analysis/requirements.md` where a fix reaches
it); then one re-audit, only when a fix changed a requirement. The re-audit's new
findings are not fixed again, and a fixed finding that comes back stays open.
Record each applied fix in this node's summary's `fixes_applied` as
`{finding, change}` and the re-audits as `reaudit_count`.

**Each finding that needs a decision is its own question**, only when the
audit (after its fix pass and re-audit) leaves one (`orchestrator-patterns.md`
§ 6, step 5; engine `references/in-node-questions.md` § *Findings that need a decision*). Write the auditor's
decision findings, as its structured result gives them, to
`verification/spec-audit-findings.json`, each finding's `id` the auditor's
`name`, and build the set with `finding-brief` for this node. Send it through
the classing write when the run classes questions, then ask what is left to
ask: one question per finding, most severe first. Hand every chosen change to
the specification creator in one more amend pass — no re-audit — and record
each answer as the writer folds it; an accepted risk becomes a `tradeoff` risk.
A held choice goes on provisionally, and the gate after this node approves it. A
file `finding-brief` cannot use is a fallback: compose the same questions
yourself.

**With question sets** (`spec-audit-findings`): asked through the cockpit as
this node's one request, with the audit report and every fix written first.

**Without question sets** (`spec-audit-findings`): nothing is asked. A finding
the policy does not class stays open as an `open` risk; a classed one takes the
outcome the classing write gives it.

A failing verdict does not end the run on its own: the gate's stop option is the
route out.

**Gate brief content.** Read `verification/spec-audit.md` and write into this
node's closing `node_summaries` entry, as engine `references/gates.md` says: a `headline` —
the final verdict, how many findings the run fixed and what it means for
planning, in one sentence; the overall verdict, the issue counts by severity
and how many were fixed in `summary`; the fixes already in `fixes_applied`,
never repeated in `decisions`; each finding the audit settled as a `by: audit`
decision, beside the answers to the finding questions; each finding still open —
undecided, not applied, or found by the re-audit — as an `open` risk whose
`change` is the fix the audit proposes, the critical ones first; each finding
the operator accepted as a `tradeoff`. A finding the run fixed or the operator
settled is never an open risk: the revise suggestions are drawn from the open
ones alone.

**Recovery budget**: none — an audit that returns is an audit, whatever its
verdict; a fix pass that fails leaves its findings open for the gate.

---

## `spec-audit-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Its brief lists what the run fixed and, as open items, only
the findings left; the revise option's suggested notes come from those. Record
the answer, and stop the run on the stop option. Its revise option sends the run
back to `specification` with the operator's note; the specification is approved
and audited again before this gate asks once more (engine `references/gates.md`,
*Revising at a gate*).

---

## `planning`

Delegated to the implementation-planner agent through the Task tool, whatever
the task's size. It reads the specification, the audit findings and the
performance analysis, and sequences the optimizations so that a change whose
measurement depends on an earlier one lands after it.

If the planner returns without `implementation/implementation-plan.md`, or with
groups that leave an optimization target uncovered, re-invoke it with the
missing context rather than writing the plan yourself.

**Gate brief content.** Read `implementation/implementation-plan.md` and write
into this node's closing `node_summaries` entry, as engine `references/gates.md` says: a
`headline` — the groups, the steps and the waves they run in, in one sentence;
how many task groups it carries and the total number of steps in `summary`; the
key dependencies between groups and the optimization sequence as `by: run`
decisions, never an earlier answer restated; open risks, if any, as `open` risks with their `change`.

**When re-run after a revise.** `prior-context` carries the operator's note
under *Revision requested*. Hand the planner the note and the existing
`implementation/implementation-plan.md` to revise in place — regroup, split or
re-sequence what the note names and keep the rest — checked against the
optimization targets again. Say in the summary what changed.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
gaps named in the context.

**Phase summary key**: none. Register the plan's companion path on this node's
own summary entry under `artifacts[].html`.

---

## `planning-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `planning` with the operator's note (engine
`references/gates.md`, *Revising at a gate*).

---

## `implementation`

Delegated to the implementation-plan-executor skill through the Skill tool,
whatever the plan's size. It is the only node that changes code.

**Before invoking the skill, record the `sequential` input as
`orchestrator.options.sequential`** — the executor reads that state key, not the
node input. True runs one task group at a time instead of parallel waves. An
input the operator did not supply resolves to its declared `default: false` and
lands as `false`, never `null`.

**After the skill returns**, run the engine's `sync-plan` verb once against
`implementation/implementation-plan.md`: idempotent, and a no-op without a
companion, it catches a wave whose sync was missed. Then record what landed:
the groups completed, the files changed and the incremental test results.

**Gate brief content.** Read `implementation/work-log.md` and write into this
node's closing `node_summaries` entry, as engine `references/gates.md` says: a `headline` —
the optimizations applied and the test result, in one sentence; the
optimizations applied, the files changed and the test results from the
incremental runs in `summary`; a known issue as an `open` risk with its
`change`, and an item deferred on purpose as a `followup` risk.

**Recovery budget**: 5 attempts — the failures here are ordinary and local: fix
a syntax error, an import or a failing test, and re-run. When the fifth attempt
has not cleared it, stop and ask the operator rather than continuing on a red
suite.

**Phase summary key**: `implementation`. Mirror this node's summary into
`performance_context.phase_summaries.implementation`, with `node:
implementation` on the entry.

---

## `implementation-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

---

## `verification-options`

Executed inline, writes no files, and decides which reviews the verification
node runs.

**The verification plan is the question's text** — the checks that always run
(the completeness check, the reality check and the pragmatic review) and the
recommended reviews, written into the question above its options. Say exactly
when the test suite runs: it already passed during implementation, so the first
verification pass does not run it again, and it runs on every pass after a fix
changes code. Never list it under "always runs".

Ask which additional verification checks to run, as bundles in one single-select
(engine `references/in-node-questions.md`): **"Code review (Recommended)"**, its reason in
the description, then **"Code review and production readiness"**, then **"No
additional checks"**. It picks a subset rather than a route, which is why no
gate asks it.

**With question sets** (`standard-verifications`): asked through the cockpit, in
this node's one request (engine `references/in-node-questions.md`).

**Without question sets** (`standard-verifications`): the
recommended bundle, code review only — production readiness off. The reality
check and the pragmatic review always run, so a defaulted run still gets both.

Record the outcome as `orchestrator.options` keys, by these exact names — the
verifier reads them by name, so a key missing or misspelled silently runs a
different review set:

- `code_review_enabled` and `production_check_enabled` — each true when the
  chosen bundle includes that review.
- `reality_check_enabled` and `pragmatic_review_enabled` — always true, written
  so a reader of state sees the whole set in one place.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop in `verification` clears it the moment a fix
  changes code.

**Node summary.** Write into this node's closing `node_summaries` entry the
review set — code review and production readiness, each on or off, beside the
reality check and the pragmatic review — and whether the test suite re-runs, in
`summary`; in `decisions`, the answer as one `by: operator` decision, or the
`by: default` decision when a non-terminal driver took the recommended bundle.
The `verification-approval` brief covers it.

**There is no gate after this node.** The answer is the approval, so the run
goes straight on to `verification`.

**Recovery budget**: none — this node asks and records.

---

## `verification`

Delegated to the implementation-verifier skill through the Skill tool, then a
fix loop inline. Pass no style guide path: as a skill it resolves the guide
itself and gates its own companion on the HTML output option.

**Show the issue breakdown** the verifier returns: the verdict, the counts by
severity, and the report's path from the project root
(`.maister/tasks/performance/<run>/verification/implementation-verification.md`).

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
  it — a pre-existing info item that predates the change — is a `followup`
  risk, never a question.
- **Asked only when** an issue needs the user's decision, a fix is
  risky, the two re-checks are spent with fixable issues still open, or there is
  no progress (the same issues return, or new ones keep appearing) — and only
  once the automatic fixes and re-checks are done. **Each such issue is its own
  question** (engine `references/in-node-questions.md` § *Findings that need a decision*): write the verifier's
  decision fields for those issues to `verification/verification-findings.json`,
  each issue's `id` the verifier's `name` (issues with one root cause are one
  finding), and build the set with `finding-brief` for this node. Send it
  through the classing write when the run classes questions, then ask what is
  left to ask, paged, the first question naming the report's path; more than
  about eight first get the triage question. A change the user
  picks is applied, logged and re-checked like any fix — the gate after this
  node offers no revise, so this is where such a change is taken; an accepted
  risk becomes a `tradeoff` risk; a held choice goes on provisionally, and
  `verification-approval` approves it. A file `finding-brief` cannot use is a
  fallback: compose the same questions yourself.
- **The stopping question** names what is left — the counts by severity and the
  worst item in a few words — and offers "One more round", "Continue as is" and
  "Stop", one of them recommended with its reason in its description: "Continue
  as is" when only warnings remain, "One more round" when the last round made
  progress, "Stop" when a critical issue is left. "Continue as is" leaves each
  undecided issue an `open` risk for the gate; "Stop" writes a `stop` risk, so
  the gate recommends stopping.

**With question sets** (`verification-findings`): asked through the cockpit as
this node's one request in its attempt, with the verification report and every
fix so far written first.

**Without question sets** (`verification-findings`): nothing is asked. An issue
the policy does not class stays open as an `open` risk; a classed one takes the
outcome the classing write gives it.

**With question sets** (`verification-fix-loop`): asked through the cockpit only
when it is the first thing this node asks in its attempt, with the verification
report and every fix so far written first; after an earlier request in the same
attempt — the finding questions — the default below is taken (engine `references/in-node-questions.md`).

**Without question sets** (`verification-fix-loop`): the loop runs
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
> post-fix verdict before this node completes. Recompile a report still showing
> the pre-fix state rather than leaving a side file to carry the truth.

**Gate brief content.** Read `verification/implementation-verification.md` and
write into this node's closing `node_summaries` entry, as engine `references/gates.md` says: a
`headline` — the verdict, what was fixed and what is left, in one sentence; the
total issues found, how many were fixed and how many remain by severity in
`summary`; each fix made without asking — the issue and the change in a few
words each — in `fixes_applied`, never also as a decision; each answered
fix-loop question as a `by: operator` decision; no earlier answer restated;
each issue still needing a decision as an `open` risk with the fix as its
`change`; each item left for later as a `followup` risk; and, when the user
chose "Stop" or the budget ran out with a critical issue open, a `stop` risk
saying why.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed.

---

## `verification-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

---

## `finalization`

Executed inline, writes no files, and always runs.

1. **Inventory the outputs**: the performance analysis, the requirements, the
   specification, the audit, the plan, the work log and the verification report.
   Nothing in this workflow is conditional, so an absent one is a defect to name.
   Take the inventory from disk, not from state: `run-complete` checks every
   declared artifact and every declared HTML companion, printing a
   `missing-artifact:` or `missing-companion:` line for each one absent, and
   those lines are relayed below; check by hand only a path a summary lists
   beyond the declarations (`orchestrator-patterns.md` § 10).
2. **Present the executive summary**: which bottlenecks were found, which
   optimizations landed, the verification verdict with any issues left open, and
   whether the ranking rested on profiling data or on static analysis alone.
3. **Set the task status to completed**.
4. **Guide the next steps**, this workflow's own four: run the application and
   confirm the improvement by hand; profile with runtime tools to measure the
   actual impact, since the ranking was static unless the user supplied data;
   watch the production metrics after deployment; and come back for the
   remaining P2 and P3 bottlenecks if they still matter. Suggest a fresh session
   for whatever comes next.

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
