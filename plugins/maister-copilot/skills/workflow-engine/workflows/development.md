# Development workflow — node prose

The node-by-node companion to `development.yml`: what the graph cannot carry —
the questions asked *inside* a node, what each node writes for its gate brief,
the self-checks that decide success, and what each node does between attempts.
The engine executes every `direct:` node from its section below.

## `intake`

**Does.** Establishes, before any analysis, the task directory, the state file
and the context ingests the rest of the run reads from.

1. **Initialize** as `orchestrator-patterns.md` § 5 says.
2. **Read the project configuration** for `options.mockup_format` (default
   `html`, read later by `ui-mockups`).
3. **Discover the project documentation** — read the documentation index under
   the project's docs directory if one exists and extract every path from its
   project-documentation sections, predefined and operator-added alike. Record
   them as `project_context.project_doc_paths`, a top-level block of its own.
4. **Detect research context** — when the invocation named a completed research
   task, as the sole argument or through the research input, bring its report and
   artifacts under `analysis/research-context/` with `import`. Record
   `task_context.research_reference`: the source path, the copied path, the
   research question, the research type and the confidence level. Research
   **informs** every later node and skips none of them, so a source the verb
   skips becomes an `open` risk naming each skipped file and the source path
   the later nodes read it at, and the node goes on.
5. **Ingest design context from three sources** and unify them under
   `analysis/design-context/`: a product-design task path, named in the
   description or supplied through the design input, whose brief is imported
   as `brief.md` and whose mockups under `mockups/`; inline mockup paths and
   design-tool links in the task description, the files imported under
   `mockups/` and the links recorded; and legacy locations from a resumed run,
   imported the same way. Skip silently when no source exists. Every file
   comes in through `import` — mockups are often binary, which only the verb
   carries intact. The mockups are **binding**, so a mockup the verb skips
   fails the node, its summary naming each skipped file and the verb's
   reason: a run that silently lost a screen would build the wrong one.

   **A mockup is a picture of the thing, never the thing itself.** An ingested
   mockup is a *binding* input to the implementation, so decide per matched
   path, before importing anything:

   | The matched path | Treat it as |
   |---|---|
   | outside the project working tree — a scratch directory, a downloads folder, an absolute path elsewhere | a mockup: import it |
   | inside the project, under a design location — `design/`, `designs/`, `mockups/`, a product-design task directory, or an existing `analysis/design-context/` | a mockup: import it |
   | inside the project and tracked as source — `git ls-files --error-unmatch <path>` exits `0` and it is not under a design location | the **subject** of the work: do not import it, do not give it an index row, and do not let it set `design_reference` |

   The extension alone never decides: *"fix the column order in
   `src/board.html`"* names the file the run edits. When the table excludes a
   path, say so in one line in the node summary. Design-tool links — Figma,
   Sketch Cloud, Zeplin — are never files this run changes, and are recorded.

   **The design input** names a product-design task directory, or the brief
   inside one (`outputs/product-brief.md`), whose task directory is two levels
   up. It is a design source by declaration, so the table does not judge it.
   When it resolves to no product-design task — nothing there, or no brief — say
   so in one line in the node summary and continue without it.
6. **Ingest the architecture** when the architecture input names one: a
   high-level design document, or a research task directory whose
   `outputs/high-level-design.md` is that document. Import it into
   `analysis/architecture-context/` as `high-level-design.md`, and
   `decision-log.md` from the same directory beside it when it exists. Record
   `task_context.architecture_reference`: the source path, the copied path and
   whether a decision log came with it. The architecture **constrains** the
   specification and the plan and skips no node. When the input resolves to no
   file, say so in one line in the node summary and continue without it; when
   the verb skips a file that exists, record an `open` risk naming it and its
   source path, which the specification and the plan then read instead.
7. **Generate the design index** when any design source was ingested — one row
   per screen or component with a stable id, its source mockup and a one-line
   description.
   Downstream nodes reference screens by those ids and by nothing else.
8. **Record `task_context.design_reference`** whenever a design ingest happened
   — which of the three sources supplied it, the product-design task path when
   that was the source, how many mockups were copied, whether a brief came with
   them, and the index path. It stays unset when no source existed.
9. **Ingest a context pack** when the context input names one — a file or a
   directory handed over by whatever started the run. Import it under
   `analysis/work-context/` as it is, and record `task_context.work_reference`
   with its `path` as given. The pack has no shape the run may assume: read it
   as background that **informs** every later node, never as a specification,
   and let it skip nothing. When the path is missing or the verb skips any of
   it, record an `open` risk naming what was skipped and the source path, and
   continue without it.

**Summary.** The entry carries the research reference and the ingested
design.

**Budget.** None: a source it cannot find is an absence, not a failure.

## `codebase-analysis`

**Does.** After the skill returns, write the analysis summary, the key files
and the primary language into state.

**Asks.** The clarifications, as **one page of at most four tabs**, only what
the analysis could not settle, each tab's options two or three answers drawn
from what it found. Never ask here what the scope decisions in `gap-analysis`
will decide. When more than four things are open, ask the four that change the
most and name the rest in the file as unsettled, the analysis's own answer
standing.

**With question sets** (`clarifications`): in this node's one request.

**Without question sets** (`clarifications`): none is asked; the analysis's
answers stand, and what it could not settle is named in the file as unsettled.

**Writes.** `analysis/clarifications.md` is this step's own: save the answers
there, then set `task_context.clarifications_resolved` to true — also when no
question was asked: the file is still written.

**Summary.** The entry carries the key files and the primary language as
`key_files` and `primary_language`. Every decision and risk of the analysis
and of the clarifications goes on this one entry.

**Budget.** Expand the search patterns on the second attempt, and prompt the
operator when the second also comes back thin.

## `gap-analysis`

**Does.** Two of its declared values guard later nodes, so record the analyzer's
assessment as returned, never adjusted by your own sense of the change's size.

**Write the structured result to state before anything else**: the five task
characteristics — a reproducible defect, whether existing code is modified,
whether new entities are created, whether data operations are involved, and
whether the task is UI-heavy — under `task_context.task_characteristics`, and
the risk level to `task_context.risk_level`.

> **SELF-CHECK**: re-read the state file and confirm the five characteristics
> match what the analyzer returned. A run that recorded four of five continues
> and silently skips a stretch.

The two declared guards:

- `has_reproducible_defect` is the analyzer's own field, carried straight
  through.
- `mockups_needed` is true when the task is UI-heavy **and** the design-context
  mockups directory was not already populated by the intake ingest. Say in this
  node's summary which of the two clauses settled it.

**Seed the optional-verification defaults** from the characteristics: a UI-heavy
task seeds both browser tests and user documentation on; a task that creates new
entities seeds user documentation on. Command flags override the seeds. The keys
are `orchestrator.options.e2e_enabled` and
`orchestrator.options.user_docs_enabled`, by those exact names; they only shape
the recommendations `verification-options` and `verification` make.

**Asks.** The scope decisions. When the analyzer flagged critical or important
decisions, ask each as its own question, its recommended option first: a
critical one in a call of its own, important ones up to four to a call. When
both lists are empty, record that no scope decision was needed.

**With question sets** (`scope-decisions`): in this node's one request, each
decision its own question, critical ones included.

**Without question sets** (`scope-decisions`): each decision takes the option
the analyzer recommended. A decision left without a recommendation is not
guessed at: it is written to `analysis/scope-clarifications.md` as open and
recorded as an `open` risk, its `change` naming the choice still to make, so it
reaches an operator at `gap-approval`.

**Writes.** `scope` (`analysis/scope-clarifications.md`) is written by this
step after the scope decisions, never by the analyzer: the outcome, with
`task_context.scope_expanded` recorded — true when a decision widened the work
beyond what the invocation described.

**Summary.** The `headline` says what the analysis found: the gap between the
code and the task, and the largest part of it ("Tags need a field on every note
and a filter on list(); nothing in the store validates input today"); which
optional work runs next is the gate's *Next* line, never the headline. In
`summary`, the gaps found and why each optional stretch is on or off ("no
reproducible defect, so no failing test first"). In `decisions`, what the gap
analysis itself settled, `by: run`. In `risks`, each gap outside this change's
scope as a `followup`. The entry carries `integration_points` and
`scope_expanded`, whether scope expanded. Every decision and risk of the gap
analysis and of the scope decisions goes on this one entry.

**Re-run.** Record the five characteristics and the risk level again too: a
revise clears them, and a changed `mockups_needed` or `has_reproducible_defect`
is how a revise switches a stretch on or off.

**Budget.** Re-analyze with the clarifications folded in on the second attempt,
and ask the operator when the second also comes back thin.

## `tdd-red`

**Does.** Write a test that reproduces the defect, run it, and **confirm that
it fails**: the failing run is the evidence the defect exists, and `tdd-green`
re-runs the same test as the evidence it is fixed. Record the test file, the
command that runs it and the failing output in `implementation/tdd-red-gate.md`.

> **SELF-CHECK**: did the test actually fail, and did it fail for the reason the
> defect describes rather than for a missing import or a typo? A test failing
> for the wrong reason passes `tdd-green` for the wrong reason too.

**Summary.** The `headline` says which test now reproduces the defect and how
it fails. In `summary`, the test file, the command and the failure, tied to the
defect. In `risks`, a failure whose reason is in doubt as `open`, its `change`
the rewrite that would settle it; a stretch skipped because no failing run could
be produced as a `tradeoff`, saying the fix will land without a failing test to
prove it.

**Budget.** Rewrite the test on the second attempt; when the second also cannot
produce a failing run, skip the TDD stretch and document why in the gate
artifact rather than proceeding on a test that proves nothing.

## `ui-mockups`

**Does.** The studio runs design-resource discovery first and renders against
what it found. Pass the mockup format from `options.mockup_format` (default
`html`; the studio falls back to a terminal rendering on its own when the
runtime cannot serve one). Record what the discovery bound to — the standards,
design system and design skills it found — as `task_context.design_resources`.

**Companion-server teardown**: the gate fires *after* this node returns, so the
server must still be up then. Do not shut it down between generation and the
gate, nor on a revise. Tear it down **only after the gate resolves to
continue**, by posting to the server's shutdown route. On a stop, the server
goes with the session.

**Summary.** The gallery pointer: the gate question is fixed by the graph hash
and cannot carry the address, so the brief does. When the studio reports a live
gallery address, open the `headline` with it, verbatim, and say how many
screens it holds ("Mockups ready at http://localhost:4173 — four screens: the
board, the card editor, the empty state and the error state"). Open the
`summary` with the same address and the navigation the operator has: the
gallery grid, each screen, previous and next, and back to the grid; then the
screens and components designed and what each settles. A brief that has to trim
keeps the headline whole and the summary's opening sentences. **When the
companion never came up** — a terminal rendering, or a browser or port failure —
say so plainly and reference the saved mockup files by path. Never write an
address that was never served. In `risks`, each screen the studio could not bind
to the project's design resources as `open`, its `change` what a revise would
render instead: the revise of `mockup-approval` is the way to change the
screens. Record the format actually used and any fallback note. The
entry carries the components designed, the screen and component counts and
the index path.

**Re-run.** Hand the studio the existing mockups under
`analysis/design-context/`: the same screen ids, a row appended only for a
screen the note adds. Reuse the companion server when it is still up, write the
gallery pointer again, and say which screens changed.

**Budget.** None: a studio that cannot render falls back rather than failing,
and the fallback is a recorded note, not a retry.

## `specification`

**Does.** Three parts: the technical questions and the drafted stories with the
assumptions page (Asks), then the specification itself, written every time by
the `maister-copilot:specification-creator` agent, handed the `with:` values, Parts A
and B and the `prior-context --node=specification` output. Its call carries the
model and effort `dispatch-model --agent=maister-copilot:specification-creator
--node=specification` prints (`orchestrator-patterns.md` § 1, *Model and Effort on Every Agent Call*).

An ingested architecture constrains every part: the interfaces, contracts and
decisions it names are constraints on this repository's part of the change,
never work to redo or choices to make again. A point where the codebase, the
requirements or the specification cannot follow it is raised as an `open` risk,
never resolved silently either way; a conflict the creator finds is listed in
the specification as an open risk.

**Write the chosen approach to `task_context.architecture_decision`**, where
later nodes read it.

**Asks.** *Part A, technical and architecture clarification — conditional.*
Skip it entirely for a simple, low-risk task with one obvious approach.

- **Technical questions.** When the task admits several viable approaches, ask
  what the analysis and the scope decisions left open as **one page of at most
  four tabs**, shaped like the `codebase-analysis` clarifications.
- **The architecture choice.** When several architectural approaches are
  genuinely open, each open choice is a decision area by engine
  `references/in-node-questions.md`, asked **one area per call**, each option an
  approach.

An area the architecture input already decides is not asked. Save what was
asked to `analysis/technical-clarifications.md`, then set
`task_context.tech_clarified` to true — also when this part was skipped.

*Part B, the stories.* Each behaviour a user or a calling system triggers and
then observes is one topic, drafted into one story by engine
`references/in-node-questions.md` (*One topic is one drafted story*) from the
analysis, the scope answers and the design context, under id
`user-story-<topic>`. A story the design brief already carries
(`analysis/design-context/brief.md`) is not asked again. A story whose framing
depends on another's answer waits for the next page. A refactor, or a defect
fix the failing test already pins, has no stories.

*Part B, the assumptions tab.* Frame the specification questions as
confirmable assumptions, the count adapted to how much the invocation already
said: a brief description earns six to eight, a standard one four to six, a
detailed one two or three, asked as engine `references/in-node-questions.md`
asks assumptions. Two are always among them: which existing components and
patterns the change should reuse, and whether any visual assets exist that have
not been ingested yet. A third, how users reach
the feature and which personas it serves, only when the run drafted no story.
The visual-assets assumption is not asked when the gap analysis recorded the
task as not UI-heavy and intake found no design source;
`analysis/requirements.md` then says "no visual assets: the change has no user
interface".

**With question sets** (`technical-questions`): in this node's one request,
each architecture area its own question beside the technical ones.

**Without question sets** (`technical-questions`): the recommended answer to
each technical question and the recommended approach for each architecture area.
A choice with no recommendation is not invented: it is written to
`analysis/technical-clarifications.md` as open and recorded as an `open` risk.

**With question sets** (`user-story`): each story is its own question in the
same request as the technical questions. Each draft, its corrections and its
alternative are in `analysis/requirements.md` before the node suspends, so the
answer is applied from the file.

**Without question sets** (`user-story`): each story is taken as drafted and
recorded `by: default` under its own id. `analysis/requirements.md` marks it
drafted, not confirmed, and the specification carries it that way.

**With question sets** (`specification-requirements`): in the same request as
the technical questions; going through the assumptions one by one is not
offered.

**Without question sets** (`specification-requirements`): the assumptions stand
as framed, recorded in `analysis/requirements.md` and carried into the
specification as stated assumptions rather than settled fact.

**Writes.** `analysis/requirements.md` holds the whole round — the initial
description, the user stories, the questions and answers, the similar features
found, the functional requirements, the reuse opportunities, the scope
boundaries and the technical considerations. Each story sits under **User
stories** by its id, with its five parts and how it was settled; the
specification keeps that section and the verification checks it, by id.

**Summary.** The `headline` names what the specification settles and how many
requirements it carries ("The spec adds tag filtering to list() and CSV export,
with 11 requirements and no breaking change"). In `summary`, the specification
title and the scope boundaries. In `decisions`, the architecture approach the
analysis settled without asking, `by: run`, and the decisions the architecture
input settled for this repository, named as taken from it, `by: run`. In
`risks`, each assumption the specification makes as `open`, its `change` what
would change if it is wrong ("CSV cells are never quoted", change: "quote cells
that hold a comma") — never a bare "Assumption: …"; a story taken as drafted is
one such assumption, its `change` the correction Part B listed for it; each
conflict with the architecture input as `open`, its `change` what would follow
either way. The entry carries the chosen approach and its rationale as a
decision. Every decision and risk of Parts A and B goes on this one entry.

Recommend the audit, never ask it. A set audit input's reason is "Asked for
when the run started" or "Declined when the run started", and the gate is still
asked. Unset, recommend `continue-to-spec-audit`, reason "Cheaper than finding
the same gaps during implementation", or a reason in this change's own terms.
Recommend `continue-to-planning` only when this specification has nothing an
audit would check, and say why ("A one-line configuration change with no open
assumption").

**Re-run.** Record what changed in `analysis/technical-clarifications.md` or
`analysis/requirements.md`. When the audit already ran, recommend it again only
when the revision changed what it checked, and say so; when the note asks for or
against the audit, recommend what it says. Hand the creator the audit's findings still open — never the ones
its fix pass applied.

**Budget.** Regenerate the specification on the second attempt with the gaps
named in the context.

## `spec-audit`

**Does.** The auditor checks the spec's claims against the codebase rather than
trusting them. Hand it the user's earlier answers — `analysis/requirements.md`
and `analysis/technical-clarifications.md` when it exists — plus the
`prior-context --background --node=spec-audit` output for the decisions, so it
can tell a finding with one obvious fix from one that needs a decision. The
report is the auditor's: if it returns the report as text and the file does not
exist, write that text to the path verbatim, once; never append to, edit or
annotate it. Record the verdict in state.

**The fix pass follows `orchestrator-patterns.md` § 6**, *The Specification
Audit's Fix Pass*, step by step; the amend passes go to the
`maister-copilot:specification-creator` agent through the Task tool, each with the model
and effort `dispatch-model --agent=maister-copilot:specification-creator --node=spec-audit`
prints.

**Asks.** Each finding that needs a decision is its own question (step 5
there): write the auditor's decision findings to
`verification/spec-audit-findings.json`, each `id` the auditor's `name`, and
build the set with `finding-brief` for this node.

**With question sets** (`spec-audit-findings`): this node's one request, with
the audit report and every fix written first.

**Without question sets** (`spec-audit-findings`): nothing is asked; a finding
the policy does not class stays an `open` risk.

**Summary.** A failing verdict does not end the run on its own: the gate's stop
option is the route out. The `headline` gives the final verdict, how many
findings the run fixed and what is left for planning ("The audit passes the
spec after three fixes; one concern is left, not blocking a plan"). In
`summary`, the verdict, the issue counts by severity, how many were fixed and
the findings still open in plain words; when no re-audit ran, say that the
report still lists the findings the run fixed. In `decisions`, only a point the
spec left open that the audit resolved against the codebase, `by: audit`; a
check that merely confirmed the spec goes in the summary. In `risks`, the
findings still open as § 6 step 6 hands them, their `change` what a revise of
the specification would do. The entry carries the verdict as `verdict`.

**Budget.** None: an audit that returns is an audit, whatever its verdict; a
fix pass that fails leaves its findings open for the gate.

## `planning`

**Does.** The planner reads the specification and, when the audit ran, its
findings. When a design index exists, it must enumerate every screen and
component in it, map each task group to the ones it implements through the
visual-reference field, and produce `implementation/visual-coverage.md` proving
every screen is covered by at least one group. When no design index exists,
that artifact is not written and the field is omitted.

When an architecture was ingested — read here as `architecture` — hand it to the
planner with the specification's rule: the groups build against the interfaces
and contracts it names and never redesign them, and a step that cannot follow it
is raised as an `open` risk in this node's summary.

**Summary.** The `headline` gives how many task groups and steps the plan
carries and how many waves they run in ("Four task groups, 23 steps, in three
waves"). In `summary`, the groups in a line each and the estimated complexity.
In `decisions`, the key ordering and dependency choices, `by: run`. In `risks`,
a cost accepted on purpose, such as a group that must run alone, as a
`tradeoff`. The entry carries the task-group count as `task_groups`.

**Re-run.** Regroup, split or reorder what the note names and keep the rest,
and check coverage again, `implementation/visual-coverage.md` included when a
design index exists.

**Budget.** Regenerate the plan on the second attempt with the gaps named in
the context.

## `implementation`

**Does.** This is the only node that writes code.

The sequential input: before invoking the skill, record the input's value as
`orchestrator.options.sequential`: the executor reads that state key, not the
node input. When true it runs one task group at a time instead of parallel
waves; it defaults to parallel.

**After the skill returns**, run the engine's `sync-plan` verb once against
`implementation/implementation-plan.md` — idempotent, a no-op without a
companion, and it catches a wave whose sync was missed. Then record what landed:
the groups completed, the files changed and the incremental test results.

**Summary.** The `headline` gives what landed and how the tests stand ("All
four task groups landed; 40 of 40 tests pass"). In `summary`, the task groups
completed, the files changed, the incremental test results and the executor's
model tally ("light 2, standard 2, escalations 1"). In `decisions`,
each choice the executor made where the plan left room, `by: run`.

**Budget.** Fix a syntax error, an import or a failing test, and re-run. When
the fifth attempt has not cleared it, stop and ask the operator rather than
continuing on a red suite.

## `tdd-green`

**Does.** Re-run the test `tdd-red` wrote and **confirm that it now passes**.
Record the test file, the command and the passing output in
`implementation/tdd-green-gate.md`, beside the failing output `tdd-red`
recorded, so the two read as one piece of evidence.

> **SELF-CHECK**: is this the same test, run the same way, as `tdd-red`
> recorded? A different test passing proves nothing about the defect.

**Summary.** The passing test has no approval of its own: its summary is part
of the stretch `verification-approval` closes. The `headline` carries the
red-to-green evidence ("The failing test for the empty-tag crash now passes:
red before the fix, green after it"). In `summary`, the test, the command and
the pair of outcomes. In `risks`, any other test the change turned red, or a
doubt that the passing run exercises the defect, as `open`, its `change` the
return to the implementation that would settle it.

**Budget.** When the test still fails, return to the implementation rather than
adjusting the test. A test edited until it passes is the documented failure mode
of this node.

## `verification-options`

**Does.** Writes no files, and decides which reviews run and whether the user
guide is written. The browser checks are decided at `verification-approval`,
not here.

**Asks.** The checks page: one page of up to two tabs, each answer standing on
its own.

1. **The reviews tab, which carries the verification plan.** Its question is the
   plan — the checks that always run, the recommended reviews and one line
   saying the browser checks are decided at the verification gate. **Each tab
   states its own choice only**: the user guide belongs to its own tab. Say
   exactly when the test suite runs: it already passed during implementation,
   so the first verification pass does not run it again, and it runs on every
   pass after a fix changes code — "Test suite: passed in implementation (40 of
   40); runs again after any fix". Never list it under "always runs". The
   options are the bundles engine `references/in-node-questions.md` names, the
   four reviews being code review, pragmatic review, reality check and
   production readiness; "Choose individually" marks none as recommended.
2. **The user-guide tab — on or off.** The recommended option is the seed
   `gap-analysis` wrote to `orchestrator.options.user_docs_enabled` — on when it
   is true, off when it is false or absent — its description giving the reason
   ("Recommended: the change adds public API, so a usage guide helps"). Its
   answer is this node's `user_docs_enabled` output.
Under a form picker the page is one form with a property per tab, and "Choose
individually" opens a second form with one array property holding the four
reviews, none of them preselected.

The user-docs input (`user_docs_flag`) is tri-state. Absent means ask. `yes` or
`no` settled it when the run started: leave the user-guide tab off the page,
record the value as `user_docs_enabled` and its state mirror and as a decision
— `by: operator` when a person gave it at the start, `by: run` when a
dispatching run's arguments set it — and say so in one line of the reviews
tab's plan ("User guide: on — asked for when the run started"). In a terminal
run the seed is a default for the recommendation, not an answer.

**With question sets** (`standard-verifications`): in this node's one request;
"Choose individually" is not offered.

**Without question sets** (`standard-verifications`): the
recommended bundle, all four reviews.

**With question sets** (`user-docs`): in this node's one request.

**Without question sets** (`user-docs`): the recommendation, by
the same rule, recorded as `user_docs_enabled`.

**Writes.** The outcome as `orchestrator.options` keys, by these exact names —
the verifier reads them to decide which reviews run:

- `code_review_enabled`, `pragmatic_review_enabled`, `reality_check_enabled` and
  `production_check_enabled` — each true when the chosen bundle or the
  individual choice includes it, false otherwise.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop clears it the moment a fix changes code.
- `user_docs_enabled` — the user-guide tab, mirrored from the declared value.

## `verification`

**Does.** Pass no style guide path: as a skill it resolves the guide itself and
gates its own companion on the HTML output option.

**The loop runs in the verifier's hand-off**: with `work_log: true`, it hands
the cycles and the fix passes of `orchestrator-patterns.md` § 6 to the
verification runner when the run records `nested` delegation, and runs them
here otherwise. Either way this node asks only the decisions the loop hands
back, as below. What this node adds: **each fix is also logged in the work
log.**

> **GATE CHECK**: the canonical report and its companion must carry the *final*
> post-fix verdict before this node completes. A report still showing the
> pre-fix state after fixes landed is a stale artifact. Recompile it rather than
> leaving a side file to carry the truth.

**Asks.** The findings that need the user: write the verifier's decision fields
to `verification/verification-findings.json`, each `id` the verifier's `name`,
and build the set with `finding-brief` for this node. The gate after this node
offers no revise, so a change the user picks is applied here.

**With question sets** (`verification-findings`): this node's one request in its
attempt, with the verification report and every fix so far written first.

**Without question sets** (`verification-findings`): nothing is asked; an issue
the policy does not class stays an `open` risk.

**With question sets** (`verification-fix-loop`): the stopping question, asked
only when it is the first request of this node's attempt, with the report and
every fix written first; after the finding questions its default is taken.

**Without question sets** (`verification-fix-loop`): the loop runs as above and
nothing is asked: every issue that needs a decision and every risky fix stays an
`open` risk, and the stopping point takes "Continue as is". An issue still
critical is **not** proceeded past on a default: it reaches a person at
`verification-approval`.

**Summary.** The `headline` gives the final verdict and what is left
("Verification passes after three fixes; two warnings remain"); when
`tdd-green` ran, it also says the failing test now passes. In `summary`, the
total issues found, how many were fixed and how many remain by severity. In
`decisions`, each review finding the verifier itself settled, `by: audit`. In
`risks`, what § 6 step 9 hands the gate, the critical ones first; when the user
chose "Stop", one `stop` risk saying why the run should not go on.
`verification_context.last_status`, `issues_found` and `reviews`, which the
verifier records every cycle, are not repeated.

Recommend whether the browser checks run. A set browser-tests input's reason is
"Asked for when the run started" or "Declined when the run started", and the
gate is still asked. Unset, and the gap analysis recorded the task as not
UI-heavy: recommend `continue-past-verification`, reason "This change has no
user interface". Otherwise follow the seed `orchestrator.options.e2e_enabled`:
true recommends `continue-to-browser-checks`, false or absent
`continue-past-verification`, each with its reason in the change's own terms
("The change adds a page; driving it in a browser catches what the reviews
cannot"). The seed is never mirrored from the gate's answer.

**Budget.** Fix the failing tests and re-run, three times over, before asking
the operator how to proceed.

## `e2e-verification`

**Does.** It drives a live browser through the running application and
collects evidence; no browser test files are written. Hand it the `run-context`
output.

With the mockup directory the agent also writes the structural visual-fidelity
comparison `verification/visual-fidelity.md`, which is informational and never
decides whether this node succeeded. Decide whether design context exists on
disk: the mockup reference resolves to its declared path even when the mockup
stretch was skipped. When it does not exist, pass no mockup directory. Pass
the command it brings screenshots into the run with, as `import_command`: the
engine's `import` verb with this run's `--state` and
`--to=verification/screenshots`, written out whole with the plugin root as an
absolute path, so the delegate adds one `--from` per screenshot and never
copies through the shell.

**This node and `user-docs` share one browser**: never dispatch the two delegate
calls in one message, even when both stretches are enabled: concurrent dispatch
corrupts both sessions.

Read the verifier's structured result, never its prose: `verdict` is the
verdict the summary reports; `status: failed`, with `verdict: null`, means the
verification could not run, which is a finding (the budget below). Its
`companion` follows `orchestrator-patterns.md` § 9.

**Summary.** The `headline` gives the verdict and the scenario counts ("Browser
checks pass: 9 of 10 scenarios, one failing on the empty board"). In `summary`,
the verdict, the scenario counts — run, passed, failed — and, when the
visual-fidelity report was written, how closely the screens match the mockups.
In `risks`, each failed scenario as `open`, its `change` the fix it calls for; a
scenario that could not run for a reason outside this change, such as a missing
test account, as a `followup`.

**Budget.** None: a browser session that cannot be established is reported as
a finding rather than retried blindly.

## `user-docs`

**Does.** The guide is written to `documentation/user-guide.md` and nowhere
else.

Reuse the browser stretch's screenshots when it ran: pass the screenshot
directory with the instruction to reuse what applies before capturing anything
new, plus the `prior-context --background --node=user-docs` output. When the
browser stretch was skipped, omit the directory entirely rather than passing an
empty path. Pass `import_command` as `e2e-verification` does, with
`--to=documentation/screenshots`.

The prior decisions are background for this delegate, not content: the guide
must stay consistent with the run's decisions and risks, and never quote them
as a section of it.

**Asks.** Take the fixes the generator names. When every suggestion only
removes content that is not for the guide's readers — an extra helper beyond the
change, a section aimed at maintainers — apply them all without asking and
record each in this node's summary's `fixes_applied`. Ask only when a suggestion
adds or rewrites content: one single-select before closing, its question naming
each such change in a line, with **"Apply them, then continue (Recommended)"**
first, then **"Keep the guide as written"**. The `docs-approval` gate can only
continue or stop, so this is where such a fix is taken.

**With question sets** (`docs-fixes`): in this node's one request, with the
guide as written already on disk.

**Without question sets** (`docs-fixes`): apply the suggested
changes, recorded as one `by: default` decision.

**Summary.** The `headline` names the guide and the flows it covers ("The user
guide covers filtering by tag and exporting to CSV, with six screenshots"). In
`summary`, the guide's path, the flows it covers and whether its screenshots
were reused or captured fresh. In `fixes_applied`, each fix applied without
asking, `{finding, change}`. In `risks`, each flow the generator could not
document as `open`, its `change` what a second pass would add.

**Budget.** None: a guide the generator could not complete is reported rather
than retried.

## `finalization`

**Does.** It always runs and ends the workflow.

1. **Inventory the outputs**: the specification, the plan and the verification
   report always; the TDD gate artifacts, the mockups and their index, the
   audit, the browser reports and the user guide when the stretches that produce
   them ran. Say plainly which stretches were skipped and why. Take the
   inventory from disk as `orchestrator-patterns.md` § 10 says.
2. **Present the executive summary**: what was built, which task groups landed,
   the verification verdict with any issues left open, and the risk level the
   gap analysis recorded.
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
7. **Guide the next steps**, which for this workflow are its own four: a commit
   message covering the change; a review of the diff; a pull request; and
   deployment as the project's own process has it. Suggest a fresh session for
   whatever comes next. **Write the commit message to `commit-message.txt` in
   the task directory** and name the file; never print the message itself.
8. **Publish when the plan gate granted it.** Only when `planning-approval-publish`
   completed on its continue — read from state; under the plain plan gate this
   step does not exist. Commit what the run changed on its own branch if any of
   it is uncommitted, with `commit-message.txt` as the message. Never push the
   repository's default branch: on it, create a branch named for the task first.
   Push the branch, then publish once per branch — `gh pr view` first, and when a
   pull request from it is already open the push has updated it, so it is not
   opened again; otherwise `gh pr create` against the default branch, its body
   drawn from the executive summary. Merging is never part of this. The pull
   request goes in the close-out's `prs` as `{repo, number, url}` under a
   dispatch driver, and its URL under **Done** in a terminal run, where step 7's
   pull request is then dropped from **Next**. A push or a pull request that is refused or held is not routed
   around: under a dispatch driver the seed's close-out section says how it is
   reported; in a terminal run the held command goes under **Needs you**.

**Close for whoever reads the end** (the engine skill's run-end rule).
**Next** holds every one of step 7's next steps, a line each: commit first, with
the message file's path, then the rest of this workflow's own four, then the
fresh-session suggestion, none dropped or merged.

**No close-out while a choice is held**: when the freeze recorded
`orchestrator.classes_questions`, this node runs
`gate-brief --node=held-approval` before its closing patch and before any
close-out, and acts on its outcome as the engine's *Ending a dispatched run*
says.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the executive summary above; a dispatched run that
ends with none is `RUN-FAILED: closeout-unpublished`. Under a terminal driver
step 7 is what the operator gets.

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
