# Performance workflow — node prose

The node-by-node companion to `performance.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

## `intake`

**Does.** Runs before any analysis. It establishes the task directory, the
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
   true when the file or the key is absent). When
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

**Budget.** None — a configuration file it cannot find is an absence, not a
failure.

---

## `codebase-analysis`

**Does.** Pass a performance-focused description: it is
what steers the explorers toward database query patterns, hot code paths, I/O
operations, caching layers, connection management and schema or migration
files. A description that names only the symptom sends them nowhere in
particular.

After the skill returns, write the analysis summary, the key files and the
primary language into state, then a short clarification round inline.

**Asks.** One page of at most four tabs:

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

**With question sets** (`clarifications`): asked through the cockpit, in this
node's one request.

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

**Writes.** `clarifications` is this step's own, not the skill's: save the
clarification answers to `analysis/clarifications.md`, then set
`performance_context.clarifications_resolved` to true — also when nothing was
asked.

**Summary.** Each answered tab is a `by: operator` decision, one per question.
The `codebase_analysis` mirror carries the key files and the primary language.

**Budget.** Expand the search patterns on the second attempt, and prompt the
operator when the second also comes back thin.

---

## `bottleneck-analysis`

**Does.** The bottleneck-analyzer reads source, schema and query patterns
together and produces the ranked list the specification is written against.
Everything after this node optimizes what it found.

**Check the profiling directory before delegating**. When
`analysis/user-profiling-data/` holds files, pass them: they turn a static
ranking into a measured one. When it is empty, the analysis is static-only —
this node asks nothing. Say in the phase summary which it was.

**Writes.** The structured result goes to state before anything else. Record
`performance_context.bottlenecks_identified` from the analyzer's count,
`performance_context.user_data_available` from whether the directory held
anything, and `performance_context.bottleneck_priorities` with its `p0`, `p1`,
`p2` and `p3` counts.

**Summary.** Read from `analysis/performance-analysis.md`:

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
- **`decisions`** — the ranking choices the analysis made, as `by: run`.
- **`risks`** — only what the analysis could not settle, as an `open` risk with
  its `change` (a hotspot it could only guess at without profiling data, say).

The `bottleneck_analysis` mirror carries the bottleneck list and
`user_data_incorporated`.

**Re-run.** Ask nothing about profiling data: read the directory as it stands.
The analyzer gets the existing `analysis/performance-analysis.md` to re-rank,
add or drop what the note names; write the structured result to state again.

**Budget.** Re-analyze with broader patterns on the second attempt, and ask the
operator when the second also comes back thin.

---

## `specification`

**Does.** Turns the ranked bottleneck list into a specification the planner can
break down, in two parts. Part A asks the optimization requirements (below)
inline. Part B then invokes the specification-creator agent through the Task
tool, whatever the task's size, with the performance task type, the `with:`
values and the `prior-context --node=specification` output.

**Asks.** Part A is **one page of three tabs**, each recommending an answer with
its reason:

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

**With question sets** (`optimization-priorities`): asked through the cockpit,
in this node's one request; "Choose individually" would
need a second ask, so it is not offered.

**Without question sets** (`optimization-priorities`): the
analyzer's own priorities stand — every P0 and P1 bottleneck it identified, with
the constraints tab's recommended bundle and no numeric target beyond what the
invocation already supplied — recorded as one `by: default` decision. Never
invent a performance target: it becomes an acceptance criterion nobody set.

**Writes.** `requirements` is this step's own: save the round to
`analysis/requirements.md` together with the performance issue
description, the bottleneck summary, the chosen priorities, the constraints and
the targets. `spec` is the specification creator's.

**Summary.** The `headline` — how many changes the specification plans and the
impact it expects, in one sentence; the optimization targets, the number of
changes and the expected impact in `summary`. Each answered tab is a
`by: operator` decision, one per question; the approach chosen is a `by: run`
decision beside them — neither those answers nor the analysis's ranking is
restated as the specification's; each assumption is an `open` risk whose
`change` says what would change if it is wrong.

**Re-run.** Keep Part A's answers: ask again only what the note reopens, and record the
change in `analysis/requirements.md`. In Part B, hand the specification creator
the note, the audit's findings still open when there are any — never the ones
the audit's fix pass already applied — and the existing
`implementation/spec.md`, to revise in place.

**Budget.** Regenerate the specification on the second attempt with the gaps
named in the context.

---

## `spec-audit`

**Does.** The auditor checks the spec's claims against the codebase before any
code exists; a fix pass then handles the findings with one obvious fix. **It
runs on every run** — no opt-in, no size threshold, no flag. Hand it the
`prior-context --background --node=spec-audit` output for the decisions, so it
can tell a finding with one obvious fix from one that needs a decision.

**The obvious fixes are made without asking**, as
`orchestrator-patterns.md` § 6, *The Specification Audit's Fix Pass*, says: one
amend pass of the `maister-copilot:specification-creator` agent over every finding
graded fixable, then one re-audit, only when a fix changed a requirement.

A failing verdict does not end the run on its own: the gate's stop option is the
route out.

**Asks.** Each finding that needs a decision after the fix pass and re-audit is
its own question (`orchestrator-patterns.md` § 6, step 5). Write the auditor's
decision findings, as its structured result gives them, to
`verification/spec-audit-findings.json`, each finding's `id` the auditor's
`name`, and build the set with `finding-brief` for this node: one question per
finding, most severe first. Hand every chosen change to the specification
creator in one more amend pass — no re-audit. A file `finding-brief` cannot use
is a fallback: compose the same questions yourself.

**With question sets** (`spec-audit-findings`): asked through the cockpit as
this node's one request, with the audit report and every fix written first.

**Without question sets** (`spec-audit-findings`): nothing is asked. A finding
the policy does not class stays open as an `open` risk; a classed one takes the
outcome the classing write gives it.

**Writes.** The report is the auditor's: if it returns the report as text and
the file does not exist, write that text to the path verbatim, once; never
append to it, edit it or annotate it. Record the verdict in state.

**Summary.** The `headline` — the final verdict, how many findings the run fixed
and what it means for planning, in one sentence; the overall verdict, the issue
counts by severity and how many were fixed in `summary`; each finding the audit
settled as a `by: audit` decision. The risks follow § 6's fix pass, step 6.

**Budget.** None — an audit that returns is an audit, whatever its verdict; a
fix pass that fails leaves its findings open for the gate.

---

## `planning`

**Does.** Whatever the task's size, the planner reads the specification, the
audit findings and the performance analysis, and sequences the optimizations so
that a change whose measurement depends on an earlier one lands after it.

**Summary.** The `headline` — the groups, the steps and the waves they run in,
in one sentence; how many task groups it carries and the total number of steps
in `summary`; the key dependencies between groups and the optimization sequence
as `by: run` decisions.

**Re-run.** The planner regroups, splits or re-sequences what the note names and
keeps the rest, checked against the optimization targets again.

**Budget.** Regenerate the plan on the second attempt with the gaps named in the
context.

---

## `implementation`

**Does.** Whatever the plan's size; it is the only node that changes code.

**Before invoking the skill, record the `sequential` input as
`orchestrator.options.sequential`** — the executor reads that state key, not the
node input. True runs one task group at a time instead of parallel waves. An
input the operator did not supply resolves to its declared `default: false` and
lands as `false`, never `null`.

**After the skill returns**, run the engine's `sync-plan` verb once against
`implementation/implementation-plan.md`: idempotent, and a no-op without a
companion, it catches a wave whose sync was missed. Then record what landed:
the groups completed, the files changed and the incremental test results.

**Summary.** The `headline` — the optimizations applied and the test result, in
one sentence; the optimizations applied, the files changed and the test results
from the incremental runs in `summary`; a known issue as an `open` risk with its
`change`, and an item deferred on purpose as a `followup` risk.

**Budget.** Fix a syntax error, an import or a failing test, and re-run. When
the last attempt has not cleared it, ask the operator rather than continuing on
a red suite.

---

## `verification-options`

**Does.** Writes no files, and decides which reviews the verification node runs.
It picks a subset rather than a route, which is why no gate asks it.

**Asks.** **The verification plan is the question's text** — the checks that
always run (the completeness check, the reality check and the pragmatic review)
and the recommended reviews, written into the question above its options. Say
exactly when the test suite runs: it already passed during implementation, so
the first verification pass does not run it again, and it runs on every pass
after a fix changes code. Never list it under "always runs".

Ask which additional verification checks to run, as bundles in one single-select:
**"Code review (Recommended)"**, its reason in the description, then
**"Code review and production readiness"**, then **"No additional checks"**.

**With question sets** (`standard-verifications`): asked through the cockpit, in
this node's one request.

**Without question sets** (`standard-verifications`): the
recommended bundle, code review only — production readiness off. The reality
check and the pragmatic review always run, so a defaulted run still gets both.

**Writes.** Record the outcome as `orchestrator.options` keys, by these exact
names — the verifier reads them by name, so a key missing or misspelled silently
runs a different review set:

- `code_review_enabled` and `production_check_enabled` — each true when the
  chosen bundle includes that review.
- `reality_check_enabled` and `pragmatic_review_enabled` — always true, written
  so a reader of state sees the whole set in one place.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop in `verification` clears it the moment a fix
  changes code.

**Summary.** The review set — code review and production readiness, each on or
off, beside the reality check and the pragmatic review — and whether the test
suite re-runs, in `summary`; the answer as one `by: operator` decision, or the
`by: default` decision when a non-terminal driver took the recommended bundle.

---

## `verification`

**Does.** Pass no style guide path: as a skill the verifier resolves the guide
itself and gates its own companion on the HTML output option.

**Show the issue breakdown** the verifier returns: the verdict, the counts by
severity, and the report's path from the project root
(`.maister/tasks/performance/<run>/verification/implementation-verification.md`).

**The fix loop runs on its own for the obvious fixes**, inline, following
`orchestrator-patterns.md` § 6, *Fix-Then-Reverify Loop*, step by step.
**Never proceed past an unresolved critical issue without an explicit answer
saying so** — a gate answered from outside is such an answer; a default is not.

**Asks.** Each issue that needs the user's decision is its own question, once
the automatic fixes and re-checks are done: write the verifier's decision fields
for those issues to `verification/verification-findings.json`, each issue's `id`
the verifier's `name` (issues with one root cause are one finding), and build
the set with `finding-brief` for this node, the first question naming the
report's path. A change the user picks is applied, logged and re-checked like
any fix — the gate after this node offers no revise, so this is where such a
change is taken. A file `finding-brief` cannot use is a fallback: compose the
same questions yourself.

**With question sets** (`verification-findings`): asked through the cockpit as
this node's one request in its attempt, with the verification report and every
fix so far written first.

**Without question sets** (`verification-findings`): nothing is asked. An issue
the policy does not class stays open as an `open` risk; a classed one takes the
outcome the classing write gives it.

**With question sets** (`verification-fix-loop`): asked through the cockpit only
when it is the first thing this node asks in its attempt, with the verification
report and every fix so far written first; after an earlier request in the same
attempt — the finding questions — the default below is taken.

**Without question sets** (`verification-fix-loop`): the loop runs
exactly as above — fixable, non-risky issues fixed and re-checked within the same
two re-checks — and nothing is asked. Every issue that needs a decision, and every
risky fix, stays open as an `open` risk in this node's summary, and the stopping
point takes "Continue as is". An issue still critical is **not** proceeded past:
it is an `open` risk, which the gate brief shows at `verification-approval` — where a person
answers.

**Writes.** The canonical report and its companion must carry the *final*
post-fix verdict before this node completes. Recompile a report still showing
the pre-fix state rather than leaving a side file to carry the truth.

**Summary.** The `headline` — the verdict, what was fixed and what is left, in
one sentence; the total issues found, how many were fixed and how many remain by
severity in `summary`; each answered fix-loop question as a `by: operator`
decision. The fixes and risks follow § 6's fix loop, steps 1 and 9.

**Budget.** Fix the failing tests and re-run before asking the operator how to
proceed.

---

## `finalization`

**Does.** Writes no files, and always runs.

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

**No close-out while a choice is held**. When the freeze recorded
`orchestrator.classes_questions`, this node runs `gate-brief --node=held-approval` before its
closing patch and before any close-out, as the engine's *Ending a dispatched run* says, and
closes as that section's outcomes direct.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the executive summary above. The engine refuses a
dispatched run that reaches its end with no close-out in the outbox
(`RUN-FAILED: closeout-unpublished`). Under a terminal driver there is no
outbox, and step 4 is what the operator gets instead.
