# Research workflow — node prose

The node-by-node companion to `research.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

## Embedded mode

**There is one.** Research is child-capable: a parent whose node names this
workflow starts a run of it as a child, and `embedded` means exactly that —
*this run is a sub-run of another run*. The engine supplies the input at the
child freeze; an operator never types it and no command exposes it.

Its only effect is the guard on `completion`, which is therefore skipped for a
child: a parent handles its own next steps. Everything else in the graph runs
unchanged, gates included — a child suspends on its own gates in its own Run
view.

What a parent may read is the workflow-level `outputs:` block in
`research.yml`, and nothing else. `report` aliases `research_report` on
purpose, so a chain authored against `${research.artifacts.report}` keeps
resolving. `explainer` names the one-page explainer beside it, the research's
answer at a glance.

**The explainer's absence is the child's, not the parent's**: with HTML off,
or with a writer that failed twice, the child completes without the page and
records it absent on its own foundation. That sanction does not carry to a
parent: a parent that declares `explainer` permits its absence in its own
`brief:` and records `absent: {explainer: …}` on its step's summary when the
child's page is missing; otherwise `run-complete` prints a `missing-artifact`
line for it.

**A parent that wants the findings and nothing after them** sets
`findings_only` in the node that starts this run. The foundation gate is then
skipped and the findings gate is asked in its place — continue, revise or stop,
with no way on to brainstorming or the design — and the two flags are not read.
The input defaults to false, and a run started by command never sets it.

---

## `research-foundation`

**Does.** Five steps in order. On resume, skip each step whose artifacts are on
disk: the brief (1), the plan and `planning/sources.md` (2), any findings file
(3), the synthesis and the report (4), the explainer (5). The freeze has
already written the question, and any supplied type, to `research_context`; step 1 writes a
classified type over an absent one.

**Steps 1–3 each end with one milestone write**: this node's `node_summaries`
entry, listing every artifact written so far, and the context fields the step
settled as `context`. No `nodes` patch: only the
closing write changes the status.

### Step 1 — initialize (inline)

Write the brief: the question parsed, the type classified from its keywords when
none was supplied, the scope (included, excluded, constraints) and the success
criteria.

**When the question is too unclear to scope**, ask rather than guess: quote it
and say in a line what makes it unclear; offer two or three sharpened readings
generated from the question, the project documentation and the codebase, the
closest first and `(Recommended)` with why, never one that drops part of what
was asked, each answerable as it stands; the operator's own wording goes
through Other.

Then read the documentation index under `.maister/docs/`, if one exists, and
take every path in its project-documentation sections, predefined and
operator-added alike. The milestone records `research_type`,
`research_question`, `scope` as a map of three lists — `included`, `excluded`,
`constraints` — and `project_doc_paths`, `[]` when there is no index.
The recorded paths never include `INDEX.md` itself or any file under `standards/`: those reach every delegate through the index.

When the context input names a context pack — a file or a directory handed over
by whatever started the run — bring it under `analysis/work-context/` as it is
with `import` (its row: the engine's `references/verbs.md`), never a shell copy, and
record `research_context.work_reference` with its `path` as given. It is
background for the brief, the plan and the gatherers, never a substitute for
the question or for evidence they gather themselves. When the path is missing
or the verb skips any of it, record an `open` risk in the milestone summary
naming what was skipped and the source path, and continue without it.

### Step 2 — plan (delegate)

Delegate to the `maister:research-planner` agent. Context for the planner: the
brief path, the research type, the question, the scope, `project_doc_paths` and
`methodology_reference`, plus the `run-context` output. The planner, the
gatherers and the synthesizer are this node's declared delegates: the brief's
`delegates:` line names each with the model and effort its call carries, and
each is dispatched through the Task tool whatever the size of the project or
the question — the session never plans, gathers or synthesizes in their place.
Each milestone write lists the delegates dispatched so far under `delegated`,
and the closing write lists all three; the writer refuses the completion
without them. `methodology_reference`
is the absolute path of
`${MAISTER_PLUGIN_ROOT}/skills/research/references/research-methodologies.md`;
the planner reads it, this node does not.

The milestone records `methodology` and `sources`, lists read from the plan and
`planning/sources.md`, not recomposed; the synthesizer's methodology comes from
this record.

### Step 3 — gather (parallel delegates)

Take the categories from the plan's **Gathering Strategy** section, at most
eight; when it names none, use codebase, documentation, configuration and
external. Record `research_context.gathering_strategy` as exactly `categories`
(those launched), `count` and `source` (`planner` or `default`).

Launch every `maister:information-gatherer` in one message, so they run in
parallel. Context for each gatherer: its `source_category` and its findings file
prefix under `analysis/findings/`, plus the `run-context` output.

### Step 4 — synthesize (delegate)

Delegate to the `maister:research-synthesizer` agent. Context for the
synthesizer: the findings directory path, the question, the research type, the
methodology and `project_doc_paths`, plus the `run-context` output. Read its
`companion` from its structured result, never its prose; its overall confidence
is `confidence_level`.

**Record `conclusions` with it**: the executive summary's opening sentence
reduced to a handle, flow-safe — no newline, carriage return, tab or quote. A
short hyphenated phrase (`adapter-scope-bounded`) is preferred, a plain sentence
with nothing to escape permitted; the write refuses anything else, failing this
node.

### Step 5 — explain (delegate)

Runs when the `html:` line of this node's `run-context` output is a style-guide
path. When it reads `off`, the writer is not dispatched and the page is
recorded absent, as the Writes part below says.

Delegate to the `maister:explainer-writer` agent through the Task tool, with the
model and effort
`node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:explainer-writer --host=copilot --state=<task path>/orchestrator-state.yml --node=research-foundation`
prints: the writer is not one of the brief's declared delegates, so its call
takes them from that line. Context for the explainer writer: `page_path`, the
absolute path of `outputs/research-explainer.html`; `sources`, the absolute
paths of the report, the synthesis and the findings folder;
`stage: foundation`; `report_suite`, the run's pages that exist, as `{label, href}`
entries relative to `outputs/`, the report by its `.html` page or by its `.md`
when that page was not written; `check_script`, the absolute path of
`${MAISTER_PLUGIN_ROOT}/skills/orchestrator-framework/scripts/check-explainer.mjs`;
plus the `run-context` output.

Read the writer's structured result, never its prose. On `explainer: written`,
run the check yourself, with the page and the same sources:
`node ${MAISTER_PLUGIN_ROOT}/skills/orchestrator-framework/scripts/check-explainer.mjs --page=<page_path> --source=<each source>`.
The writer's own `check` is its report; this run is the step's.

**Send the writer back at most once**: when the check exits 1, with its
findings as `check_findings`; or when the result is `failed`, `not-requested`
or `disabled`, with the run context again. Then check again. What is left
after that is recorded, never retried:

- figures or links still flagged (exit 1): the page stays and is registered,
  with one `open` risk naming each finding, its change "correct or remove each
  figure on the page, or revise the research";
- a check that could not run (exit 2): the page stays and is registered, with
  the `open` risk "the explainer was not checked" and the reason;
- a writer that still returns no page: there is none, and the summary records
  the absence, as the Writes part below says.

**Asks.** Step 1 asks the clarification it describes. Before treating an answer as settled, apply the fact-or-choice test (engine `references/in-node-questions.md`, *A fact is what no answer would change*).

**With question sets** (clarification, `question-clarification`): its sharpened readings
generated before it suspends.

**Without question sets** (`question-clarification`): none. Step 1
cannot ask an absent operator to clarify an unclear question, and it must not
guess one, so an unclear question exhausts the step's single attempt and the
node is recorded `failed`. A re-drive carrying the clarification is the route
back in.

**Writes.** The closing write's `artifacts`, in this order: the explainer,
`outputs/research-explainer.html`, `role: primary`, label "Explainer", when
step 5 left it on disk; the report, `outputs/research-report.md`, `primary`,
with its page; the synthesis, `analysis/synthesis.md`, `review`; the brief and
the plan, `review`. Without the page the others keep this order, and the
summary carries `absent: {explainer: "<reason>"}` with exactly one of two
reasons: "HTML output is off for this run." or "The explainer writer failed
twice: <reason>.". When step 5 dispatched the writer, the closing write lists
`explainer-writer` under `delegated` beside the three declared delegates.

**Summary.** For example: "Adopting the adapter keeps the public API intact;
confidence medium, two sources disagree on performance". In `summary`, the top
findings in plain words with what each means for the question, and how many
sources fed them. In `decisions`, the methodology and any scope boundary step 1
drew, `by: run`. In `risks`, each gap the synthesis documented: `open` when the
operator could close it, its `change` the evidence or scope that would ("benchmark
the adapter on the production data set"); `followup` when it lies outside the
question.

Recommend one of `foundation-approval`'s three continues, never ask it; a flag
sets the recommendation, never the answer:

- **`brainstorm_flag` is `yes`** — reason "Brainstorming asked for when the run
  started"; the design is decided at the brainstorming gate.
- **`brainstorm_flag` is `no`** — `continue-to-design` when `design_flag` is
  `yes` ("Design asked for, brainstorming declined when the run started"),
  otherwise `finish-with-research` ("Brainstorming declined when the run
  started", adding "and the design" when `design_flag` is `no`); with
  `design_flag` absent, judge the design as below.
- **`brainstorm_flag` is absent** — judge from the synthesis. Brainstorming is
  valuable for several viable approaches, a new domain or competing trade-offs;
  the design for architectural decisions, a requirements-shaped or mixed type,
  or artifacts that would feed a development run. Recommend
  `continue-to-brainstorming`, else `continue-to-design` (also when
  `design_flag` is `yes`), else `finish-with-research`, the reason in this
  research's own terms ("The synthesis left three open choices about storage
  and sync").

For the findings only, write no `recommends` and read neither flag: the findings
gate has one continue.

**Re-run.** The resume checks above do not apply. Rerun from the step the note
reaches back to: the question or its scope, step 1; the sources or the method,
step 2; missing evidence, step 3; the conclusions, step 4. Step 5 runs after
every re-run step, whichever the note reaches, because the page reads what
those steps rewrite. Each delegate gets the note; the summary says which steps
ran again.

**Budget.** Per step: step 1 one attempt; step 2 two, widening the search,
then a mixed methodology; step 3 three, retrying only failed gatherers; step 4
two, re-gathering for the gaps; step 5 one re-dispatch of the writer.

---

## `solution-generation`

**Does.** Read the brainstorming-techniques reference first,
`${MAISTER_PLUGIN_ROOT}/skills/research/references/brainstorming-techniques.md`.
Hand the delegate the absolute path of
`${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/references/decision-areas.md`, the
areas file's shape; it cannot expand the variable. An exploration that holds no
alternatives fails the step like a missing one.

**Asks.** When the second attempt also fails: *"Brainstorming failed twice:
<cause>. Try again?"* — *"Try once more (Recommended)"*, saying why it may work
now, or *"Skip brainstorming"*, *"go on without the alternatives"*.

**With question sets** (`brainstormer-retry`): asked through the cockpit, as a
follow-up round when an earlier request of this attempt already went out; once
the attempt's follow-up rounds are spent, the default below is taken.

**Without question sets** (`brainstormer-retry`): none — neither
retry nor skip. With the budget exhausted and nobody to ask, the node is
recorded `failed` rather than silently skipped, because skipped brainstorming
satisfies everything downstream and would hide the failure. A re-drive is the
operator's route back in.

**Writes.** A return with `areas_path: null` is the sanctioned absence, never
re-driven. Otherwise check the areas file against the markdown before completing:
`node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs area-brief --state=<task path>/orchestrator-state.yml --node=solution-generation --check`.
A fallback warning re-delegates the brainstormer once, to rebuild the areas file
from `outputs/solution-exploration.md` as it stands; a second goes in the summary,
and convergence composes from the markdown. Register the areas file with
`role: evidence` beside the markdown, and take the summary's count of decision
areas from the check's `areas`.

**Summary.** For example: "Seven alternatives across three decision areas;
event sourcing recommended overall". The recommendations go in `summary` and in
the exploration file, never in `decisions`: the operator decides area by area in
`solution-convergence`. In `risks`, only what the brainstorm itself raises.

**Re-run.** Hand the brainstormer everything the first run hands it, with
`output_path` and `areas_output_path`, plus the note and the existing
`outputs/solution-exploration.md`, to revise in place and rewrite the areas file
whole from the revised markdown. Then check the pair as above.

**Budget.** The second attempt runs with corrected context.

---

## `solution-convergence`

**Does.** Ask each decision area as engine `references/in-node-questions.md` §
*Decision areas from the brainstorm* says. *Resume check*: skip the areas whose
recorded entry already carries a chosen approach.

Only on a `decision-areas-*` warning, compose every area from
`outputs/solution-exploration.md`, every one in the same detail — never a full
first area and a recommendation line for the rest:

- **the question**: the area's name, why it matters in a sentence or two, and
  each alternative in one line, named in words, never by a report's code;
- **the options**: the recommended alternative first, `(Recommended)`, its
  description the reason; each other's description its key pro and con —
  where the tool shows no descriptions, the question's line does — and
  **More details** last;
- **the call**: the area is a question set of one question, its options the
  alternatives with their descriptions, the recommended one marked, asked from
  `gate-brief --ask --patch-file` (`references/in-node-questions.md`), which
  carries each description and the recommendation into the form; the
  question is plain text, with no `**` or list markers, which the form shows
  as typed;
- **the cap**: with more alternatives than the options hold beside More
  details, offer the recommended one and its strongest rivals and name the
  rest in the question, for the free-text answer; every alternative stays in
  the question and in More details — an area silently reduced is a failure.

A composed area's answer is recorded under
`convergence-decisions-<the area's name as a slug>`. On More details (or a
question about one alternative), write the area out in full — each
alternative's description, pros and cons, the asked-about trade-off, then the
recommendation and why — and ask the area again, recording nothing.

A correction to the alternatives — an answer or a `revise-convergence` note that
says an alternative in `outputs/solution-exploration.md` is wrong, missing or
misdescribed — is not edited here. Re-delegate the brainstormer as
`solution-generation`'s re-run says, with the correction as the note, as engine
`references/decision-areas.md` § *A correction* says; then run
`node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs area-brief --state=<task path>/orchestrator-state.yml --node=solution-convergence --check`,
re-delegating once on a fallback, and ask again the areas the correction changed,
keeping the other answers.

Complete only when every area is in `decision_areas` — chosen, defaulted, or
recorded open; an area skipped for any reason is resolved first, never papered
over by a state write. The chosen combination goes in this node's summary entry;
`selected_approach` is the converged approach's identifier, not the per-area
choices.

**Once every area is recorded, refresh the explainer** when the `html:` line of
`run-context --node=research-foundation` is a path; when it reads `off`, the
writer is not dispatched and nothing is registered for the page. First write
the `decisions` text — the chosen approach per area and the deferred ideas — to
a file in a directory `mktemp -d` makes. That decisions file is what a figure
the operator chose, in an Other answer say, traces to when the page is
checked; it is left where it is, not an artifact of the run, and never
registered.

Delegate to the `maister:explainer-writer` agent through the Task tool, with the
model and effort
`node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:explainer-writer --host=copilot --state=<task path>/orchestrator-state.yml --node=solution-convergence`
prints. Context for the explainer writer: `page_path`, the absolute path of
`outputs/research-explainer.html`; `sources`, the absolute paths of the report,
the synthesis, the findings folder, `outputs/solution-exploration.md` and the
decisions file; `stage: convergence`; `decisions`, that same text;
`report_suite`, the run's pages on disk now, as at the foundation, so a page
written while no explainer existed gains its Explainer link; `check_script`,
the absolute path of
`${MAISTER_PLUGIN_ROOT}/skills/orchestrator-framework/scripts/check-explainer.mjs`;
plus the `run-context --node=research-foundation` output.

Read the result, check, send the writer back at most once and record the risks
as the foundation's step 5 does, with one more `--source` for the decisions
file in each run of the check. A refresh that still fails after its
re-dispatch keeps the earlier page on disk but does not register it on this
step, and records the `open` risk "the explainer does not show this step's
decisions", its change "revise this step".

**Asks.** One question per decision area, in the file's order.

**With question sets** (`convergence-decisions`): one question per area, from
`area-brief` (its row: the engine's `references/verbs.md`) or, on a `decision-areas-*` warning, from the composed areas; an
area whose choice depends on another names that area in its question. Each
answer is recorded as an operator decision and as the area's
`chosen_approach`.

**Without question sets** (`convergence-decisions`): each area
takes the alternative this node recommends for it, recorded as `{decision, by:
default, question_id}`, and More details is never taken. Every area is still
worked in full: the alternatives are weighed, the recommendation is reasoned,
and `chosen_approach` is written for every element of `decision_areas`. An
area with no recommendation is not guessed at — it is recorded with
`chosen_approach` unset and as a `{risk, tag: open, change}` risk naming the
alternatives to choose between, which the gate's revise offers. Word it to
whoever reads the gate ("<area>: you have not yet chosen between <A> and
<B>"), never naming a role as the one who decides (`orchestrator-patterns.md`
§ 7).

**Writes.** When the refresh wrote the page, the closing write registers
`outputs/research-explainer.html` as this node's first artifact,
`role: primary`, label "Explainer", and lists `explainer-writer` under
`delegated`. With HTML off, or after a failed refresh, the page is not
registered here.

**Summary.** For example: "Event-sourced storage with CRDT sync, settling three
areas". In `summary`, the chosen combination in a line per area and the
deferred ideas in one line; in `decisions`, the answer or default per area. In
`risks`, a trade-off the combination accepts on purpose `tradeoff`, an area left
open `open` with the `change` that would settle it, a deferred idea worth its
own task `followup`.

The entry carries two more keys and no others:
`decision_areas`, a list whose every element has exactly `area`,
`alternatives_count` and `chosen_approach` — the first two from the areas file
when the areas came from it — and `deferred_ideas`, the ideas parked rather than
decided. The writer refuses any other `decision_areas` shape.

Recommend the design, never ask it. A set `design_flag` gives the reason "Design
asked for when the run started" or "Design declined when the run started".
Absent, recommend `continue-to-design` when the converged approach leaves
architectural decisions to record, the type is requirements-shaped or mixed, or
the design would feed a development run, the reason in this convergence's own
terms ("The chosen storage and sync approaches need their boundaries drawn");
otherwise `finish-without-design`, saying why.

**Re-run.** The resume check does not apply. Read the earlier choices from this
node's summary entry and re-ask only the areas the note reopens, each in full;
without question sets, take the alternative the note names for each, recorded as
the operator's choice. The brainstorm is not run again; the explainer is
refreshed again from the new choices, as above.

**Budget.** Re-read the exploration file and present the decision areas again.

---

## `high-level-design`

**Does.** Four parts. Read the design-techniques reference first,
`${MAISTER_PLUGIN_ROOT}/skills/research/references/design-techniques.md`.

### Part A — design direction (inline)

The design input is the selected approaches when convergence ran, else the
research report's recommendations. Ask the constraints question.

### Part B — design generation (delegate)

Delegate to the `maister:solution-designer` agent. Context for the designer:
everything `with:` names and the Part A answer as `design_preferences`, plus the
`prior-context --node=high-level-design` output. The designer is this node's
declared delegate: dispatch it on the model and effort the brief's `delegates:`
line prints, and list it under `delegated` in the closing write. **When brainstorming was
skipped**, omit `exploration` and `selected_approach` rather than passing empty
values, and say the design input is the report's recommendations.

### Part C — summary (inline)

Read both artifacts and present an executive summary: the architecture style and
its key components, how many decisions were recorded, a one-line highlight per
key decision, and the integration points with the existing system, if any.

### Part D — explainer (delegate)

Runs when the `html:` line of `run-context --node=research-foundation` is a
path; when it reads `off`, the writer is not dispatched and nothing is
registered for the page. First write the `decisions` text — the convergence's
chosen combination when it ran, read from its summary entry, this node's key
decisions and the Part A constraints answer — to a file in a directory
`mktemp -d` makes, as convergence does: the decisions file, left where it is
and never registered.

Delegate to the `maister:explainer-writer` agent through the Task tool, with the
model and effort
`node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:explainer-writer --host=copilot --state=<task path>/orchestrator-state.yml --node=high-level-design`
prints. Context for the explainer writer: `page_path`, the absolute path of
`outputs/research-explainer.html`; `sources`, the absolute paths of the report,
the synthesis, the findings folder, `outputs/high-level-design.md`,
`outputs/decision-log.md`, `outputs/solution-exploration.md` when brainstorming
ran, and the decisions file; `stage: design`; `decisions`, that same text;
`report_suite`, the run's pages on disk now, as at the foundation;
`check_script`, the absolute path of
`${MAISTER_PLUGIN_ROOT}/skills/orchestrator-framework/scripts/check-explainer.mjs`;
plus the `run-context --node=research-foundation` output.

Read the result, check, send the writer back at most once and record the risks
as the foundation's step 5 does, with one more `--source` for the decisions
file in each run of the check. A refresh that still fails after its
re-dispatch keeps the earlier page unregistered on this step, with the `open`
risk "the explainer does not show this step's decisions", its change "revise
this step".

**Asks.** The constraints question, *"Any architectural constraints or
preferences for the design?"*, lists the design input a line per area. Options:
*"No extra constraints (Recommended)"* — the design follows the chosen approach
and the research alone — then one to three constraints generated from the
findings, each worded to hand to the designer as it stands ("Keep zero runtime
dependencies"). After Part B's second failure: *"High-level design failed twice:
<cause>. Try again?"* — *"Try once more (Recommended)"*, saying why it may work
now, or *"Skip the design"*, *"finish with the research and the chosen
approach"*.

**With question sets** (clarification, `design-constraints`): asked through the cockpit, in
this node's first request.

**Without question sets** (`design-constraints`): none is
supplied, and the delegate is invoked on the convergence output and the research
report alone.

**With question sets** (`designer-retry`): asked through the cockpit, as a
follow-up round when an earlier request of this attempt — the constraints
question, say — already went out; once the attempt's follow-up rounds are spent,
the default below is taken.

**Without question sets** (`designer-retry`): none — neither retry
nor skip. The budget is exhausted and nobody is there, so the node is recorded
`failed` rather than skipped, for the same reason as the brainstormer's retry:
a skip would hide the failure.

**Writes.** The closing write's `artifacts`, in this order: the explainer,
`outputs/research-explainer.html`, `role: primary`, label "Explainer", when
Part D wrote it; the design, `outputs/high-level-design.md`, `primary`; the
decision log, `outputs/decision-log.md`, `review`. When Part D dispatched the
writer, `explainer-writer` is listed under `delegated` beside the designer.
With HTML off, or after a failed refresh, the page is not registered here.

**Summary.** For example: "Hexagonal core with two adapters; six decisions
recorded". In `summary`, the Part C executive summary. In `decisions`, the key
design decisions, `by: run` — only what this node settled; the constraints
answer is the operator's. In `risks`, a decision the designer could not settle
without an answer `open`, with the `change` that answer would make; a
consequence the design accepts on purpose `tradeoff`; work it names for later
`followup`.

**Re-run.** Keep the Part A answer unless the note changes a constraint, and do
not ask it again. In Part B, hand the designer the note and both existing
artifacts to revise in place — a decision the note overturns is recorded as
superseded rather than deleted. Part D then refreshes the explainer again.

**Budget.** The second attempt runs with corrected context.

---

## `completion`

**Does.** Executed inline, writes no files, and runs only when this run is its
own.

1. Inventory the outputs: the explainer when it was written, then the research
   report always, plus the solution exploration, the high-level design and the
   decision log when the stretches that produce them ran.
2. Present the executive summary: the key findings and the confidence level,
   which optional stretches ran, and the key decision highlights when they did.
3. Suggest the next step as the command that takes it: in a fresh session —
   clear the context or start a new session first —
   `/maister:development --research=<this task directory, from the project root>`
   to build on the findings.

No close-out while a choice is held: when the freeze recorded
`orchestrator.classes_questions`, this node runs `gate-brief --node=held-approval` before its
closing patch and before any close-out, as the engine's *Ending a dispatched run* says, and
closes as that section's outcomes direct.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, with the inventory above as what it summarizes. The engine
refuses a dispatched run that reaches its end with no close-out in the outbox
(`RUN-FAILED: closeout-unpublished`). Under a terminal driver there is no
outbox, and the executive summary above is what the user gets instead.

In a terminal run's wrap-up, Done gives the answer and its confidence in a
sentence, Next the command from step 3, and Files the outputs from the
inventory: the explainer first when it was written, then the report, then the
rest.
