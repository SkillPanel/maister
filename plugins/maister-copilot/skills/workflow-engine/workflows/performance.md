# Performance workflow — node prose

The node-by-node companion to `performance.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

## `intake`

**Does.** Establishes, before any analysis, the task directory, the state file
and the profiling-data drop point the analysis node reads from.

1. **Initialize** as `orchestrator-patterns.md` § 5 says: the clock from the
   shell, the state file with the task description,
   `options.html_output`
   from the project configuration, the dashboard opened with the platform
   opener unless that is false — never its path printed instead — and the
   start banner shown.
2. **Create `analysis/user-profiling-data/`**, empty. **An empty directory is
   the answer "no profiling data", not a missing artifact.**
3. **Discover the project documentation** — every path in the
   project-documentation sections of the documentation index under the
   project's docs directory, if one exists, predefined and operator-added
   alike, into `project_context.project_doc_paths`: a top-level key of the
   patch, never nested inside the orchestrator or context block.

**Budget.** None — a configuration file it cannot find is an absence, not a
failure.

---

## `codebase-analysis`

**Does.** Pass a performance-focused description: it is
what steers the explorers toward database query patterns, hot code paths, I/O
operations, caching layers, connection management and schema or migration
files. A description that names only the symptom sends them nowhere in
particular. After the skill returns, ask the round below inline.

**Asks.** One page of at most four tabs:

- **Clarifications** — one tab for each thing about the performance concern, the
  suspected hotspots or the optimization goals that the analysis could not
  settle, at most three: the question says what the analysis found and what it
  could not settle, with two or three generated answers. Never ask what the
  specification's priorities, constraints or targets will ask.
- **Profiling data** — one tab, asked while `analysis/user-profiling-data/` is
  empty: "Do you have profiling data — flame graphs, APM screenshots, slow-query
  logs — for the bottleneck analysis?", with **"No, analyse the code alone
  (Recommended): the code shows the hotspots"** and **"Yes, I'll add files to
  `analysis/user-profiling-data/`"**, its description giving the folder's path
  from the project root.
  When the folder already holds files, the tab is not asked: say in one line
  that they will be used.

When the answer is "Yes", say where the folder is and wait for the user to say
the files are there before this node completes.

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

**Summary.** The entry carries the key files and the
primary language.

**Budget.** Expand the search patterns on the second attempt, and prompt the
operator when the second also comes back thin.

---

## `bottleneck-analysis`

**Does.** Check the profiling directory before delegating. When
`analysis/user-profiling-data/` holds files, pass them: they turn a static
ranking into a measured one. When it is empty, the analysis is static-only —
this node asks nothing. Say in the summary which it was.

**Writes.** The structured result goes to state before anything else. Record
`performance_context.bottlenecks_identified` from the analyzer's count,
`performance_context.user_data_available` from whether the directory held
anything, and `performance_context.bottleneck_priorities` with its `p0`, `p1`,
`p2` and `p3` counts.

**Summary.** Read from `analysis/performance-analysis.md`. The `headline` leads
with the top finding and what fixing it changes ("Found 5 bottlenecks, 2
critical: the order report runs one database query per order, 5,001 per
report, where 2 would do"). The `summary` gives how many bottlenecks were
identified, how many are critical (P0) and high (P1), whether profiling data
was incorporated, and the top one or two findings in plain words — **findings
belong here, never in `risks`**. Spell out the analyzer's ids (B1, B2…) and
priority codes (P0 critical, P1 high, P2 medium, P3 low) at first use, and
name a bottleneck by what it is ("one database call per order"), never by its
id alone. The ranking choices are `by: run` decisions; `risks` holds only what
the analysis could not settle, each `open` with its `change`. The
entry carries the bottleneck list and
`user_data_incorporated`.

**Re-run.** Ask nothing about profiling data: read the directory as it stands.
Write the structured result to state again.

**Budget.** Re-analyze with broader patterns on the second attempt, and ask the
operator when the second also comes back thin.

---

## `specification`

**Does.** Part A asks the optimization requirements below inline. Part B then
invokes the specification-creator agent through the Task tool, whatever the
task's size, with the performance task type, the `with:` values and the
`prior-context --node=specification` output.

**Asks.** Part A is **one page of three tabs**:

- **Priorities** — the question lists every critical (P0) and high (P1)
  bottleneck in its own text, one line each, named by what it is with its
  priority beside it — never "the bottlenecks above". Options: **"Every P0 and
  P1 (Recommended)"**, its reason the impact the analysis measured, then "The
  P0s only", then "Choose individually", which opens the bottlenecks as a
  multi-choice question.
- **Constraints** — one single-select of bundles. The recommended one is what
  the analysis implies, its reason the finding that implies it: output that
  must stay identical implies backward compatibility; no dependency needed
  implies no new dependencies. Then **"No extra constraints"** — the
  recommended one when the analysis implies none — then **"Choose
  individually"**, which opens backward compatibility, memory limits and no new
  dependencies as a multi-choice question.
- **Targets** — **"No numeric target (Recommended)"**, its reason that the
  verification then reports the change against what the analysis measured,
  then one or two targets generated from the analysis ("Report under 100 ms"),
  each saying what the verification would check; a target of the user's own
  comes through Other.

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
impact it expects; the optimization targets, the number of changes and the
expected impact in `summary`. The approach chosen is a `by: run` decision —
neither the answers nor the analysis's ranking is restated as the
specification's; each assumption is an `open` risk whose `change` says what
would change if it is wrong.

**Re-run.** Record a reopened answer's change in `analysis/requirements.md`.
Hand the specification creator the note, the audit's findings still open —
never the ones its fix pass already applied — and the existing
`implementation/spec.md`, to revise in place.

**Budget.** Regenerate the specification on the second attempt with the gaps
named in the context.

---

## `spec-audit`

**Does.** Runs on every run. Hand the auditor the
`prior-context --background --node=spec-audit` output for the decisions, so it
can tell a finding with one obvious fix from one that needs a decision. **The
obvious fixes are made without asking**, as `orchestrator-patterns.md` § 6,
*The Specification Audit's Fix Pass*, says. A failing verdict does not end the
run: the gate's stop option is the route out.

**Asks.** Each finding that needs a decision after the fix pass is its own
question (§ 6, step 5): write the auditor's decision findings, as its
structured result gives them, to `verification/spec-audit-findings.json`, each
finding's `id` the auditor's `name`, and build the set with `finding-brief` for
this node.

**With question sets** (`spec-audit-findings`): asked through the cockpit as
this node's one request, with the audit report and every fix written first.

**Without question sets** (`spec-audit-findings`): nothing is asked. A finding
the policy does not class stays open as an `open` risk; a classed one takes the
outcome the classing write gives it.

**Writes.** The report is the auditor's: if it returns the report as text and
the file does not exist, write that text to the path verbatim, once; never
append to it, edit it or annotate it. Record the verdict in state.

**Summary.** The `headline` — the final verdict, how many findings the run fixed
and what it means for planning; the verdict, the counts by severity and how
many were fixed in `summary`; each finding the audit settled as a `by: audit`
decision. The risks follow § 6's fix pass, step 6.

**Budget.** None — an audit that returns is an audit, whatever its verdict; a
fix pass that fails leaves its findings open for the gate.

---

## `planning`

**Does.** Whatever the task's size, the planner reads the specification, the
audit findings and the performance analysis, and sequences the optimizations so
that a change whose measurement depends on an earlier one lands after it.

**Summary.** The `headline` — the groups, the steps and the waves they run in;
how many task groups it carries and the total number of steps in `summary`; the
key dependencies between groups and the optimization sequence as `by: run`
decisions.

**Re-run.** Check the revised plan against the optimization targets again.

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

**Summary.** The `headline` — the optimizations applied and the test result;
the optimizations applied, the files changed and the test results from the
incremental runs in `summary`; a known issue as an `open` risk with its
`change`, and an item deferred on purpose as a `followup` risk.

**Budget.** Fix a syntax error, an import or a failing test, and re-run. When
the last attempt has not cleared it, ask the operator rather than continuing on
a red suite.

---

## `verification-options`

**Does.** Decides which reviews the verification node runs; it writes no files.

**Asks.** **The verification plan is the question's text** — the checks that
always run (the completeness check, the reality check and the pragmatic review)
and the recommended reviews, written into the question above its options. Say
exactly when the test suite runs: it already passed during implementation, so
the first verification pass does not run it again, and it runs on every pass
after a fix changes code. Never list it under "always runs".

Ask which additional verification checks to run, as bundles in one single-select:
**"Code review only (Recommended)"**, its reason in the description, then
**"All four reviews"**, then **"No additional checks"**.

**With question sets** (`standard-verifications`): asked through the cockpit, in
this node's one request.

**Without question sets** (`standard-verifications`): the
recommended bundle, code review only — production readiness off. The reality
check and the pragmatic review always run, so a defaulted run still gets both.

**Writes.** Record the outcome as `orchestrator.options` keys, by these exact
names — the verifier reads them by name, so a key missing or misspelled silently
runs a different review set: `code_review_enabled` and
`production_check_enabled`, each true when the chosen bundle includes it;
`reality_check_enabled` and `pragmatic_review_enabled`, always true; and
`skip_test_suite`, true here — the fix loop in `verification` clears it the
moment a fix changes code.

**Summary.** The review set — code review and production readiness, each on or
off, beside the reality check and the pragmatic review — and whether the test
suite re-runs, in `summary`.

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
the automatic fixes and re-checks are done (§ 6, step 5): write the verifier's
decision fields for those issues to `verification/verification-findings.json`,
each issue's `id` the verifier's `name`, and build the set with `finding-brief`
for this node. The gate after this node offers no revise, so a change the user
picks is taken here.

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

**Summary.** The `headline` — the verdict, what was fixed and what is left; the
total issues found, how many were fixed and how many remain by severity in
`summary`. The fixes and risks follow § 6's fix loop, steps 1 and 9.

**Budget.** Fix the failing tests and re-run before asking the operator how to
proceed.

---

## `finalization`

**Does.** Writes no files of its own beyond the roadmap ticks and the standards
chosen below, and always runs.

1. **Inventory the outputs**: the performance analysis, the requirements, the
   specification, the audit, the plan, the work log and the verification report.
   Nothing in this workflow is conditional, so an absent one is a defect to name.
   `run-complete` checks the declared ones on disk (`orchestrator-patterns.md`
   § 10); check by hand only a path a summary lists beyond them.
2. **Present the executive summary**: which bottlenecks were found, which
   optimizations landed, the verification verdict with any issues left open, and
   whether the ranking rested on profiling data or on static analysis alone.
3. **Tick the roadmap** when the project keeps one at
   `.maister/docs/project/roadmap.md`: mark done the items this run completed,
   matched against the specification, and say which, or that none matched. A
   tick changes no document's purpose, so its index entry stays as it is.
4. **Offer the standard candidates** the work log records — the implementers'
   and the fix loop's — as *Asks* below says, before the check, so a standard
   added here is in its view.
5. **Run the docs index check** from the project root: docs-manager's
   `scripts/docs-check.mjs` under the plugin root, by its absolute path. Its
   result goes under **Done** when it passes, warnings named in a line; each
   failure goes under **Needs you** with its fix, a refresh of the index
   (`/maister-copilot:standards-update --refresh-index`). INDEX.md is never edited here.
6. **Set the task status to completed**.
7. **Guide the next steps**, this workflow's own four: run the application and
   confirm the improvement by hand; profile with runtime tools to measure the
   actual impact, since the ranking was static unless the user supplied data;
   watch the production metrics after deployment; and come back for the
   remaining P2 and P3 bottlenecks if they still matter. Suggest a fresh session
   for whatever comes next.

**Close for whoever reads the end**, as the engine's *Operator visibility*
says. **Next** holds every one of step 7's next steps, a line each — all four,
then the fresh-session suggestion, none dropped or merged.

**No close-out while a choice is held**. When the freeze recorded
`orchestrator.classes_questions`, this node runs `gate-brief --node=held-approval` before its
closing patch and before any close-out, as the engine's *Ending a dispatched run* says, and
closes as that section's outcomes direct.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the executive summary above. The engine refuses a
dispatched run that reaches its end with no close-out in the outbox
(`RUN-FAILED: closeout-unpublished`). Under a terminal driver there is no
outbox, and step 7 is what the operator gets instead.

**Asks.** Only when the work log records standard candidates: one multi-select
question, each candidate an option — its label the convention in a few words,
its description the candidate line as written — the question saying that each
chosen one is added through standards-update, which asks where it goes. Each
chosen candidate is added with `standards-update`, its line as the
description, one after another; an unchosen one is dropped. With no candidates,
nothing is asked.

**With question sets** (`standard-candidates`): the same multi-select, with the
multi-choice flag, as this node's one request in its attempt; the chosen
candidates go under **Next**, each as the
`/maister-copilot:standards-update "<candidate>"` command to run, since adding one asks
its own questions in session.

**Without question sets** (`standard-candidates`): nothing is asked; every
candidate goes under **Next** as its `/maister-copilot:standards-update "<candidate>"`
command.
