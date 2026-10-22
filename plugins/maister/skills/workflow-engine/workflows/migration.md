# Migration workflow — node prose

The node-by-node companion to `migration.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

## `intake`

**Does.** Validates the invocation, establishes the task directory and the
state file, and settles the HTML output option later nodes read.

1. **Capture the clock** through the shell, not from context. Every timestamp
   written this turn uses that one value.
2. **Validate the type.** When the `type` input is present it must be one of
   `code`, `data`, `architecture` or `general`. On any other value **record this
   node `failed`**, naming those four in the failure, and the run ends
   `RUN-FAILED` with no further node run. A valid value is written to
   `migration_context.migration_type` and carried unchanged into the gap
   analysis.
3. **Create and initialize** the task directory under the `migrations/` type
   directory and its state file, with the task description.
4. **Read the project configuration** and set `options.html_output` (default
   true when the file or the key is absent). When `html_output` is false, skip
   the dashboard entirely — no dashboard asset, no data projection, no browser
   open. Otherwise the freeze installed `dashboard.html` in the task root — copy
   nothing; **run the platform opener** on the plain absolute path through the
   shell — `open "<task path>/dashboard.html"` on macOS, `xdg-open` on Linux,
   `start ""` on Windows. Never build a `file://` URL. On failure print the
   path; never block.
5. **Make sure the user has seen the start banner** (engine Step 4). If your
   messages since the freeze do not name the workflow and task, the checkpoints,
   the directory and the dashboard link, write them now, from the freeze's
   output, the paths copied as printed.
6. **Discover the project documentation** — from the documentation index under
   the project's docs directory, if one exists, extract every path in its
   project-documentation sections, predefined and operator-added alike, into
   `project_context.project_doc_paths`: a top-level key of the patch, never
   nested inside the orchestrator or context block.

---

## `current-state-analysis`

**Does.** The description passed to the analyzer names what is being migrated
away from: the framework, the platform, the schema or the architecture in use
today, and the seams that hold it to the rest of the codebase. A description
naming only the target sends the explorers to code that does not exist yet.

After the skill returns, write the current system's description and its
technologies into `migration_context.current_system`, then run the
clarification round below.

**Asks.** One page of at most four tabs, one for each thing about the target
system or the constraints that the analysis could not settle, each stating what
the analysis found; ask nothing when it settled everything. **Never ask
here what the specification's assumptions page frames** — the scope boundaries,
the rollback expectations and downtime tolerance, the data specifics, the
dual-run requirements and the code or configuration to preserve are confirmed
there, after the gap analysis has proposed them.

**With question sets** (`clarifications`): asked through the cockpit, in this
node's one request.

**Without question sets** (`clarifications`): none is asked, and
the analysis's own answers stand. The file is written and
`migration_context.clarifications_resolved` set as for a run with nothing to
ask; what the analysis could not settle about scope, target system or
constraints is recorded in the file as unsettled rather than guessed at.

**Writes.** Save the answers to `analysis/clarifications.md`, then set
`migration_context.clarifications_resolved` to true — also when nothing was
asked.

**Summary.** The entry carries the current system and
its technologies.

**Budget.** Expand the search patterns on the second attempt, and prompt the
operator for file paths when the second also comes back thin.

---

## `gap-analysis`

**Does.** The analyzer's five tasks, in order: define the target system from
the migration description; identify the gaps — features to migrate, APIs to
adapt, data to transform; classify the migration type as `code`, `data`,
`architecture` or `general`, **keeping a type the invocation supplied rather
than reclassifying it**; recommend a strategy (incremental, big-bang, dual-run
or phased); and research the target's breaking changes on the web when a
version upgrade is in scope.

**Writes.** The analyzer writes the target-state plan to the declared
`target_state` path, handed to it as its `output_path`.

Write the structured result to state before anything else, under
`migration_context`: `migration_type` (the declared value, also kept there),
`target_system` (`{description, technologies}`, the shape of
`current_system`), `migration_strategy` (`{approach, phases}` — `approach`
exactly one of the four strategies, `phases` one string per phase in order),
`risk_level` and `breaking_changes`. The web research lands in
`external_research`, a top-level sibling of the context block, under
`performed`, `category`, `breaking_changes` and `migration_guide_url` — with
none needed, `performed: false`, `category` null and `breaking_changes` `[]`.
Breaking changes found by reading the code go to
`migration_context.breaking_changes`, never into `external_research`.

**Summary.** A `headline` naming the recommended strategy and the risk level; a
`summary` of one labelled line each for the current system, the target system,
the migration type, the number of gaps, the strategy and the risk level; the
strategy and the type as `by: run` decisions. The entry carries
the gap list, the strategy and the risk level.

**Re-run.** Keep the migration type unless the note changes it, and write the
structured result to state again.

**Budget.** Re-prompt for the target details on the second attempt, and ask the
operator when the second also comes back thin.

---

## `specification`

**Does.** Turns the gap list into a migration specification the planner can
break down, with the rollback procedure beside it, in two parts: Part A frames
the migration requirements inline (Asks below), and Part B hands them to the
specification-creator agent, whatever the migration's size, with the migration
task type and the model and effort `dispatch-model
--agent=maister:specification-creator --node=specification` prints
(`orchestrator-patterns.md` § 1, *Model and Effort on Every Agent Call*).

Hand the creator two things beyond `with:` and `prior-context`: the
requirements Part A wrote, `analysis/requirements.md`, and the migration facts
in state — `migration_context.current_system`, `target_system`, `risk_level`
and `breaking_changes` — which the specification names, never rediscovers.

**Asks.** Frame three to five confirmable assumptions from the gap analysis —
*"I assume X"* — covering the scope and its boundaries, the rollback
expectations and downtime tolerance, and the existing code or configuration to
preserve; the data specifics only when the gap analysis classified the
migration as `data`, the dual-run requirements only when it recommended
dual-run. Ask them as one question listing each assumption on its own line with
what it rests on, offering **"Accept all N as stated (Recommended)"** first —
each follows from the approved gap analysis — then "Go through them one by
one", one tab each, and More details. Save the round to
`analysis/requirements.md`.

**With question sets** (`specification-requirements`): asked through the
cockpit, in this node's one request; "Go through them one by one" would need a
second ask, so it is not offered.

**Without question sets** (`specification-requirements`): the
assumptions stand as framed, recorded as one `by: default` decision, and carried
into `analysis/requirements.md` and the specification as stated assumptions
rather than settled fact. The rollback expectations and the downtime tolerance
are named in this node's closing summary whatever else the round covered.

**Writes.** `analysis/requirements.md` is Part A's; the creator writes the
specification and the rollback plan. **The dual-run plan is not declared** —
write `analysis/dual-run-plan.md` only for a dual-run strategy, and list it on
this node's summary. Record `migration_context.rollback_plan_created` and
`migration_context.dual_run_configured` from what actually landed.

**Summary.** A `headline` naming the scope and the rollback approach; the scope
boundaries, the rollback approach, the rollback expectations and the downtime
tolerance in `summary`, whether or not Part A was answered; what the
specification settled as `by: run` decisions — the strategy stays on
`gap-analysis`; each breaking change shipped on purpose as a `tradeoff` risk,
and each assumption that could still be wrong as an `open` risk with its
`change`.

**Re-run.** The creator revises the specification and the rollback plan
together — the rollback plan follows any change to what it undoes; record the
two `migration_context` flags again.

**Budget.** Re-gather the requirements and regenerate the specification and the
rollback plan on the second attempt, with the gaps named in the context.

---

## `planning`

**Does.** Whatever the migration's size, the planner reads the specification,
the rollback plan and the migration type, and sequences the work so that each
group leaves the system in a state the rollback plan can still undo. Rollback
steps belong in the plan itself: when the agent returns, confirm that its
groups carry them, and re-invoke with the constraint named when they do not.

**Summary.** A `headline` naming the groups, the steps and whether each carries
its rollback step; a `summary` of one labelled line each for how many task
groups it carries, the total number of steps and whether rollback steps are
included; the key dependencies between groups and the execution sequence as
`by: run` decisions.

**Re-run.** Keep a rollback step on every group.

**Budget.** Regenerate the plan on the second attempt with the migration
constraints named in the context.

---

## `execution`

**Does.** The only node that changes code; this node never edits the migrated
code itself.

Before invoking the skill, record the `sequential` input as
`orchestrator.options.sequential` — the executor reads that state key, not the
node input — as `false`, never `null`, when the operator did not supply it.
True runs one task group at a time instead of parallel waves.

After the skill returns, run the engine's `sync-plan` verb once against
`implementation/implementation-plan.md`: idempotent, and a no-op without a
companion, it catches a wave whose sync was missed.

**Summary.** A `headline` naming the steps completed, the test result and
whether the rollback is still ready; the steps completed, the files changed,
the incremental test results, the rollback readiness and the executor's model
tally in `summary`; a known
issue as an `open` risk with its `change`, and an item deferred on purpose as a
`followup` risk.

**Budget.** Fix a syntax error, an import or a failing test, and re-run. When
the last attempt has not cleared it, stop and ask rather than continue on a red
suite.

---

## `verification`

**Does.** Pass no style guide path; the verifier resolves its own. Invoke it
with `fixes: off`: it runs one verification cycle, through the verification
runner when the run records `nested` delegation and here otherwise, and fixes
nothing — the fix loop is `issue-resolution`'s.

Record the review set before invoking it: this workflow asks no
verification-options question, and the verifier would ask about a review flag
missing from state. Write these `orchestrator.options` keys by these exact
names: `code_review_enabled`, `pragmatic_review_enabled` and
`reality_check_enabled` true; `production_check_enabled` false, since the
checks below cover a migration's deployment risks; and `skip_test_suite` false
— a migration is verified against the full suite.

After the verifier returns, run the four migration-specific checks:

1. **The old system still works**, when the strategy is dual-run.
2. **The rollback procedure**, tested non-destructively against the plan
   `specification` wrote.
3. **Data integrity**, for a data migration: the checksums, the row counts and
   the constraints the specification named.
4. **Performance benchmarks**, before and after, when the specification set any.

The verifier has already recorded `verification_context.last_status` and
`issues_found`. Write each issue a check raised as a finding of
`verification/migration-checks-findings.json`, in the reviewers' findings
schema (`implementation-verifier/references/review-findings.md`) with the
cycle the verifier ran; a data integrity issue takes `category:
data-integrity` and `fixable: false`. Then run `findings-merge --state=<state>`
again and record `verification_context.issues_found` exactly as it prints, so
the issues keep their numbers in every later cycle. Then **declare
`issues_to_resolve`**: true when the
report carries an open issue the fix loop can fix or needs a decision on,
**or** any data integrity issue — never fixed here; `issue-resolution` owns
its halt.

**Writes.** `verification/compatibility-test-results.md` is this step's own,
always written after the verifier returns: each of the four checks recorded as
ran and passed, ran and failed, or not applicable.

**Summary.** A `headline` naming the verdict, the compatibility result and the
data integrity status; the verdict, the issue counts by severity, the
compatibility and rollback test results and the data integrity status in
`summary`. **Tag each blocker by what it is**: a critical issue still open is
an `open` risk with the fix as its `change`; a breaking change the
specification chose is a `tradeoff` risk; an issue that predates the migration
is a `followup` risk. **When the verdict failed and nothing in it is fixable,
add a `stop` risk** saying why.

**Budget.** Fix the failing tests and re-run before asking how to proceed. **A
data integrity issue is never one of those attempts**: `issue-resolution` halts
on it.

---

## `issue-resolution`

**Does.** Runs the fix loop of `orchestrator-patterns.md` § 6 on the
verifier's issues, after showing the verdict, the counts by severity and the
report's path from the project root. Once the data integrity question below is
settled, invoke the verifier's hand-off (Skill tool,
`maister:implementation-verifier`) with `node: issue-resolution`, `fixes: on`,
`findings_file: verification/issue-resolution-findings.json`, `work_log: true`
and `hold: data-integrity`: it hands the fix passes and re-checks to the
verification runner when the run records `nested` delegation, and runs them
here otherwise, and this node asks only the decisions it hands back. It adds:
each fix is also logged in the work log; a change the user picks is applied,
logged and re-checked here, because the gate after this node offers no revise;
and a data integrity issue is never fixed and never a finding (Asks below).

**Asks.** Write the issues still needing a person to
`verification/issue-resolution-findings.json`, each `id` the verifier's
`name`, and build the set with `finding-brief` for this node; compose the same
questions by hand only when it cannot use the file. At the stopping point
**with a critical issue left**, offer **"Stop here (Recommended): roll back
with the plan's rollback steps"**, then "One more round" and "Continue as is";
"Stop here" writes a `stop` risk naming the issue and
`analysis/rollback-plan.md`.

A data integrity issue is neither fixable nor a finding question: it halts the
loop before anything else is asked, and is never fixed without the user or by
default. Under a terminal driver, ask one question naming the table, the check
that failed and by how much, offering **"Stop and roll back (Recommended)"** —
the run stops at the next checkpoint and the plan's rollback steps undo the
migration — then **"Continue anyway: I accept the data risk"**. "Stop and roll
back" writes a `stop` risk naming the issue and `analysis/rollback-plan.md`;
the run never rolls anything back on its own. "Continue anyway" records the
issue as a `tradeoff` risk, and the loop goes on. With question sets, the same
question goes through the cockpit when it is the first thing this node asks in
its attempt. Otherwise, and under any other driver, there is nobody to ask:
**record this node `failed`**, and the run ends `RUN-FAILED` with the state
intact — never an automated repair applied to the user's data.

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
attempt — the finding questions — the default below is taken.

**Without question sets** (`verification-fix-loop`): the loop runs
exactly as above — fixable, non-risky issues fixed and re-checked within the same
two re-checks — and nothing is asked. Every issue that needs a decision, and every
risky fix, stays open as an `open` risk in this node's summary, and the stopping
point takes "Continue as is". An issue still critical is **not** proceeded past:
it is an `open` risk, which the gate brief shows at `resolution-approval` — where a person
answers.

**Writes.** The canonical report and its companion carry the *final* post-fix
verdict before this node completes: recompile one still showing the pre-fix
state, never leave a side file to carry the truth.

**Summary.** A `headline` naming what was fixed, what is left and whether the
run recommends stopping; the issues found, fixed and remaining by severity in
`summary`; an accepted data risk as a `tradeoff` risk, and the `stop` risk when
the user chose to stop and roll back. Nothing rolls back automatically: the
`stop` risk is the rollback recommendation, and `resolution-approval`'s stop
option acts on it.

**Budget.** None: the loop's two re-checks are its limit, and re-driving a node
that halts on data integrity would re-run the thing it refused.

---

## `documentation`

**Does.** The guide covers the migration overview and its goals, the
prerequisites and the preparation steps, the step-by-step procedure, the
rollback procedure and the troubleshooting for the problems the verification
actually found.

Fetch the prior decisions with `prior-context --background`, not the plain
form: the guide stays consistent with the run's decisions and risks but never
carries them as a section.

**Writes.** The agent writes the guide to the declared `guide` path, handed to
it as its `output_path`.

**Budget.** On a failure, generate the guide as text only, without screenshots,
rather than leaving the run without one.

---

## `finalization`

**Does.** Writes no files of its own beyond the roadmap ticks and the standards
chosen below, and **always runs**.

1. **Inventory the outputs**: the current-state analysis, the clarifications,
   the target-state plan, the requirements, the specification, the rollback
   plan, the implementation plan, the work log, the verification report and the
   compatibility results. The migration guide is there only when the run was
   asked for one, and the dual-run plan only for a dual-run strategy — name each
   absent one as skipped rather than as missing, and every other absence as a
   defect. Take the inventory from disk, not from state, as
   `orchestrator-patterns.md` § 10 says.
2. **Present the executive summary**: what was migrated and to what, the
   strategy used, the verification verdict with any issues left open, whether
   the rollback procedure was tested and whether it is still available.
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
   (`/maister:standards-update --refresh-index`). INDEX.md is never edited here.
6. **Set the task status to completed**.
7. **Guide the next steps**, this workflow's own four: exercise the migrated
   system by hand before trusting it; keep the rollback plan reachable until the
   new system has run in production long enough to trust; watch the data and
   the error rates after deployment, closely for a data migration; and retire
   the old system, or the dual-run configuration, only once both have been true
   for a while. Suggest a fresh session for whatever comes next.

**Close for whoever reads the end**, as the engine's *Operator visibility*
says. **Next** holds every one of step 7's next steps, a line each — all four,
then the fresh-session suggestion, none dropped or merged.

**No close-out while a choice is held**: when the freeze recorded
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
chosen candidate is added with `maister:standards-update`, its line as the
description, one after another; an unchosen one is dropped. With no candidates,
nothing is asked.

**With question sets** (`standard-candidates`): the same multi-select, with the
multi-choice flag, as this node's one request in its attempt; the chosen
candidates go under **Next**, each as the
`/maister:standards-update "<candidate>"` command to run, since adding one asks
its own questions in session.

**Without question sets** (`standard-candidates`): nothing is asked; every
candidate goes under **Next** as its `/maister:standards-update "<candidate>"`
command.
