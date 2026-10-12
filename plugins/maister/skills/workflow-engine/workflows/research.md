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
resolving.

**A parent that wants the findings and nothing after them** sets
`findings_only` in the node that starts this run. The foundation gate is then
skipped and the findings gate is asked in its place — continue, revise or stop,
with no way on to brainstorming or the design — and the two flags are not read.
The input defaults to false, and a run started by command never sets it.

---

## `research-foundation`

**Does.** Four sequential steps, executed inline. On resume, check the
artifacts each step declares and skip the ones already on disk.

The freeze sends `research_question`, the question input verbatim, and
`research_type` when the invocation supplied one, as its `context`, so
`research_context` is on disk before this node starts. Step 1 writes a
classified type over an absent one.

**Each of steps 1–3 ends with one milestone write**, so the dashboard shows the
longest stretch of the run as it fills. After a step's artifacts are on disk,
make one `write-state` call carrying this node's `node_summaries` entry and its
mirrored `phase-1` entry, each listing every artifact written so far, not just
the latest step's — both replace whole. The call carries no `nodes` patch: the
node is still `running`, and only its closing write changes that. Step 4 needs
no milestone, because the closing write registers the report.

The `phase-1` entry also carries `steps_completed`, the steps finished so far by
name — `initialize`, `plan`, `gather`, `synthesize` — on every milestone and on
the closing write. The context fields a step settles ride in that step's
milestone as `context`, rather than as a write of their own.

### Step 1 — initialize (inline)

*Writes* `planning/research-brief.md`. *Resume check*: if the brief exists, go
to step 2.

Parse the question, classify the research type from its keywords when the
invocation did not supply one, determine scope (included, excluded,
constraints), define success criteria and write the brief.

**When the question is too unclear to scope**, ask rather than guess. The
question quotes the operator's question and says in a line what makes it
unclear; its options are two or three sharpened readings of it, generated from
the question, the project documentation and the codebase — the closest to what
was asked first, marked `(Recommended)` with why it reads closest, and never a
reading that drops part of what was asked (engine `references/in-node-questions.md`) — and
the operator's own wording goes through Other. Each reading is a question the
research could answer as it stands, so the answer is folded in without a second
round.

Then **discover the project documentation**: read the documentation index under
`.maister/docs/` if one exists and extract every path from its
project-documentation section — predefined and operator-added alike — recording
them as `research_context.project_doc_paths`.

The step's milestone records `research_type`, `research_question`, `scope` as a
map of three lists — `included`, `excluded`, `constraints` — and
`project_doc_paths`, which is `[]` when there is no index. The planner is
handed the same scope.

### Step 2 — plan (delegate)

*Writes* `planning/research-plan.md`, `planning/sources.md`. *Resume check*: if
both exist, go to step 3.

Delegate to the `maister:research-planner` agent. The planner, not this node,
reads the methodology reference; pass its path rather than reading it here.

Context for the planner: the research brief path, the research type, the
research question, the scope, `project_doc_paths` and `methodology_reference`,
plus the `run-context` output. `methodology_reference` is the absolute path of
`${CLAUDE_PLUGIN_ROOT}/skills/research/references/research-methodologies.md`,
which the planner reads in full before it classifies the question.

When the planner returns, the step's milestone records `methodology` and
`sources`, both lists lifted from what the planner wrote: the methods its plan
chose, and the sources `planning/sources.md` names — read from the two files,
not recomposed. The synthesizer's methodology comes from this record.

### Step 3 — gather (parallel delegates)

*Writes* `analysis/findings/*.md`. *Resume check*: if any findings file exists,
go to step 4.

Read the **Gathering Strategy** section of the plan for the categories and the
count, capped at eight. When the plan names none, fall back to four categories:
codebase, documentation, configuration, external.

Record the strategy as `research_context.gathering_strategy`, a map of exactly
three fields: `categories`, the list actually launched; `count`, how many
gatherers ran; and `source`, `planner` when the plan named the strategy and
`default` when the fallback supplied it — all three whichever way it was chosen.

Launch all N gatherers in ONE message, so they run in parallel. Each is the
`maister:information-gatherer` agent. Context for each gatherer: its own
`source_category` and the findings file prefix it writes under
`analysis/findings/`, plus the `run-context` output.

### Step 4 — synthesize (delegate)

*Writes* `analysis/synthesis.md`, `outputs/research-report.md`. *Resume check*:
if both exist, this node is complete.

Delegate to the research synthesizer, the `maister:research-synthesizer` agent.

Context for the synthesizer: the findings directory path, the research
question, the research type, the methodology and `project_doc_paths`, plus the
`run-context` output.

**Read the synthesizer's `companion`** from its structured result, never from its
prose; its handling follows `orchestrator-patterns.md` § 9.

The synthesizer returns pattern analysis and cross-references, the report that
answers the question, a confidence level per finding and the documented gaps;
the overall confidence is `confidence_level`.

**Record `conclusions` in the same breath**, the node's second declared value:
the one-line conclusion of the research — the sentence the executive summary
opens with, reduced to a handle; the full conclusion is the report. It goes onto
a one-line node entry, so it must be flow-safe: no newline, no carriage return,
no tab, no quote character. A short hyphenated phrase inside the bare charset
(`adapter-scope-bounded`) is preferred; a plain sentence without punctuation the
emitter must escape is permitted. A value that is not flow-safe is refused at
the write, which fails this node.

**Asks.** Before step 1, when the invocation supplied no question, ask the
operator for it as free text; never invent one. Step 1 asks the clarification
it describes.

**With question sets** (`research-question`): never reached either — the start
brief supplies the question.

**Without question sets** (`research-question`): none, because the
question is never reached — the start brief supplied it and the freeze persisted
it. A non-terminal run that has no research question is `RUN-FAILED`, never a
run with an invented one.

**With question sets** (`question-clarification`): its sharpened readings
generated before it suspends.

**Without question sets** (`question-clarification`): none. Step 1
cannot ask an absent operator to clarify an unclear question, and it must not
guess one, so an unclear question exhausts the step's single attempt and the
node is recorded `failed`. A re-drive carrying the clarification is the route
back in.

**Summary.** For example: "Adopting the adapter keeps the public API intact;
confidence medium, two sources disagree on performance". In `summary`, the top
findings in plain words with what each means for the question, and how many
sources fed them. In `decisions`, the methodology and any scope boundary step 1
drew, `by: run`. In `risks`, each gap the synthesis documented: `open` when the
operator could close it, its `change` the evidence or scope that would ("benchmark
the adapter on the production data set"); `followup` when it lies outside the
question. The report is the `primary` artifact; the brief, the plan and the
synthesis are `review`.

Recommend the way on, never ask it: which way the run goes on is the answer to
`foundation-approval`, and this node says which of its three continues it
recommends. It reads the two flags as `brainstorm_flag` and `design_flag`:

- **`brainstorm_flag` is `yes`** — reason "Brainstorming asked for when the run
  started". The design is decided at the brainstorming gate.
- **`brainstorm_flag` is `no`** — recommend `continue-to-design` when
  `design_flag` is `yes`, reason "Design asked for, brainstorming declined when
  the run started"; otherwise `finish-with-research`, reason "Brainstorming
  declined when the run started", with "and the design" added when `design_flag`
  is `no` too. With `design_flag` absent, judge the design as below and
  recommend `continue-to-design` when it is valuable.
- **`brainstorm_flag` is absent** — judge from the synthesis. Brainstorming is
  valuable when it identified several viable approaches, when the problem sits in
  a new domain rather than a well-understood one, and when competing trade-offs
  were found. The design is valuable when the research points at architectural
  decisions, when the research type is requirements-shaped or mixed, and when the
  design artifacts would feed a development run. Recommend
  `continue-to-brainstorming` when brainstorming is valuable, else
  `continue-to-design` when the design is (or `design_flag` is `yes`), else
  `finish-with-research`. The reason is in this research's own terms ("The
  synthesis left three open choices about storage and sync"; "One approach
  stands; the findings name two architectural decisions"; "The question is
  answered; nothing is left to choose between").

The gate is still asked: a flag sets the recommendation, never the answer. For
the findings only, recommend nothing: the findings gate has one continue, so
write no `recommends` and read neither flag.

**Re-run.** The resume checks above do not apply. Rerun from the step the note
reaches back to: the question or its scope, step 1; the sources or the method,
step 2; missing evidence, step 3; the conclusions, step 4 alone. Each delegate
gets the note; the summary says which steps ran again.

**Budget.** Per step: step 1 one attempt; step 2 two, widening the search,
then a mixed methodology; step 3 three, retrying only failed gatherers; step 4
two, re-gathering for the gaps.

---

## `solution-generation`

**Does.** Read the brainstorming-techniques reference first,
`${CLAUDE_PLUGIN_ROOT}/skills/research/references/brainstorming-techniques.md` —
divergent and convergent techniques, scope guardrails. Hand the delegate the
absolute path of
`${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/references/decision-areas.md`, the
file's shape, to read before it writes the file — it cannot expand the variable
itself. An exploration that holds no alternatives fails the step like a missing
one.

**Asks.** When the second attempt also fails, ask whether to try again:
*"Brainstorming failed twice: <cause>. Try again?"*, with *"Try once more
(Recommended)"*, its description saying why another attempt may work now, and
*"Skip brainstorming"*, its description *"go on without the alternatives"*.

**With question sets** (`brainstormer-retry`): asked through the cockpit only
when it is the first thing this node asks in its attempt; after an earlier
request in the same attempt, the default below is taken.

**Without question sets** (`brainstormer-retry`): none — neither
retry nor skip. With the budget exhausted and nobody to ask, the node is
recorded `failed` rather than silently skipped, because skipped brainstorming
satisfies everything downstream and would hide the failure. A re-drive is the
operator's route back in.

**Writes.** A return without `outputs/decision-areas.json` — `areas_path: null`,
the reason in the agent's warnings — is not a failure, because convergence then
asks from the markdown: record the absence with the agent's reason, and do not
re-drive the node for it. Otherwise register the file with `role: evidence`,
beside the markdown, and take the summary's count of decision areas from it.

**Summary.** For example: "Seven alternatives across three decision areas;
event sourcing recommended overall". The recommendations go in `summary` and in
the exploration file, never in `decisions`: the operator decides area by area in
`solution-convergence`. In `risks`, only what the brainstorm itself raises.

**Budget.** The second attempt runs with corrected context.

---

## `solution-convergence`

**Does.** Executed inline and interactive. Ask each decision area as engine
`references/in-node-questions.md` § *Decision areas from the brainstorm* says,
from the file `with: decision_areas` names, in its order. *Resume check*: when
the recorded decision areas already carry a chosen approach, skip those areas
and resume at the first unresolved one.

Only when the verb prints a `decision-areas-*` warning, compose every area from
`outputs/solution-exploration.md` yourself, every area with the same detail —
never a full first area and a recommendation line for the rest:

- **the question**: the area's name, why the decision matters in a sentence
  or two, and each alternative in one line — each named in words, never by a
  code the report defines;
- **the options**: this area's alternatives, the recommended one first and
  marked `(Recommended)`, its description giving the reason in a sentence;
  each other option's description giving its key pro and its key con in a
  few words — where the tool shows no descriptions, the question's line for
  it does — and **More details** last;
<!-- rich-picker -->
- **the previews**: each alternative's own option carries its
  two-to-three-sentence description, its pros and its cons, and the
  recommended one's preview adds the reason it is recommended;
<!-- /rich-picker -->
<!-- plain-picker
- **the recommendation**: the question's last line before the ask is
  "Recommended: <alternative> — <reason>", because the form shows no option
  descriptions; the question is plain text, with no `**` or list markers,
  which the form shows as typed;
-->
- **the cap**: an area carrying more alternatives than the options hold
  beside More details offers the recommended alternative and its strongest
  rivals, and names the remaining ones in the question text, which the user
  reaches through the free-text answer. The cap binds the option list and
  nothing else — every alternative is still in the question's lines and in
  More details; an area silently reduced is a failure.

A composed area's answer is recorded under
`convergence-decisions-<the area's name as a slug>`. On More details (or
"details", or a question about one alternative), write the area out in full —
every alternative's two-to-three-sentence description, pros and cons and the
detailed trade-off of the one asked about, then the recommendation and why —
and ask the same area again; nothing is recorded. Before each composed
question, check that it names this area, why it matters and every alternative,
and that each option's description carries its pro and con; if not, write
them out.

Complete only when every decision area is in `decision_areas` — chosen,
defaulted, or recorded open where a run without question sets could not
default it. An area skipped for any reason, a missing file or a failed read, is
resolved first, never papered over by a state write. Then write the chosen
combination into this node's summary entry, never into a declared value:
`selected_approach` is the identifier of the converged approach, not the
per-area choices.

**Asks.** One question per decision area, in the file's order.

**With question sets** (`convergence-decisions`): one question per area, from
`area-brief` or, on a `decision-areas-*` warning, from the composed areas; an
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
alternatives to choose between, which the gate's revise offers.

**Summary.** For example: "Event-sourced storage with CRDT sync, settling three
areas". In `summary`, the chosen combination in a line per area and the
deferred ideas in one line; in `decisions`, the answer or default per area. In
`risks`, a trade-off the combination accepts on purpose `tradeoff`, an area left
open `open` with the `change` that would settle it, a deferred idea worth its
own task `followup`.

The entry and its `phase-4` mirror carry two more keys and no others:
`decision_areas`, a list whose every element has exactly `area` (the decision
area's name), `alternatives_count` (how many alternatives were presented for
it) and `chosen_approach` (the alternative the user picked) — the first two
from the decision areas file when the areas came from it — and
`deferred_ideas`, the ideas parked rather than decided. The writer refuses any
other `decision_areas` shape; the resume check reads it.

Recommend the design, never ask it: whether the design follows is the answer
to `convergence-approval`. A set `design_flag` gives the reason "Design asked
for when the run started" or "Design declined when the run started". Absent,
recommend `continue-to-design` when the converged approach leaves
architectural decisions to record, the research type is requirements-shaped or
mixed, or the design would feed a development run, with the reason in this
convergence's own terms ("The chosen storage and sync approaches need their
boundaries drawn"); otherwise `finish-without-design`, saying why ("The chosen
approach is a configuration change with nothing to design").

**Re-run.** The resume check does not apply. The earlier choices stand, read
from this node's summary entry until this attempt rewrites it; re-ask only the
areas the note reopens, each in full. Without question sets, take the
alternative the note names for each area it names, recorded as the operator's
choice. The brainstorm is not run again.

**Budget.** Re-read the exploration file and present the decision areas again.

---

## `high-level-design`

**Does.** Executed inline in three parts. Read the design-techniques reference
first, `${CLAUDE_PLUGIN_ROOT}/skills/research/references/design-techniques.md` —
decision-record format and decision-documentation patterns.

### Part A — design direction (inline)

When convergence ran, confirm the selected approaches. When the foundation gate
went to the design and skipped brainstorming, use the research report's
recommendations as the design input instead. Then ask the constraints question.

### Part B — design generation (delegate)

Delegate to the `maister:solution-designer` agent. Context for the
designer: everything `with:` names and the design preferences from Part A, plus
the `run-context` output. Paste it as `prior-context --node=high-level-design`.
**When brainstorming was skipped**, `exploration` and `selected_approach`
resolve to nothing: omit them from the delegate's context entirely rather than
passing empty values, and say that the design input is the research report's
recommendations.

### Part C — summary (inline)

Read both artifacts and present an executive
summary: the architecture style and its key components, how many decisions were
recorded, a one-line highlight per key decision, and the integration points with
the existing system where there are any.

**Asks.** The constraints question, *"Any architectural constraints or
preferences for the design?"*, names the selected approach per area (or the
report's recommendations) in a line each, so the user answers against what
they can see. Its options are the answers themselves: *"No extra constraints
(Recommended)"* first, its description saying the design follows the chosen
approach and the research alone, then one to three constraints generated from
what the research found — "Keep zero runtime dependencies", "Stay ESM-only" —
each worded so it can be handed to the designer as it stands. Anything else, or
a combination, is typed through Other.

When Part B's second attempt also fails: *"High-level design failed twice:
<cause>. Try again?"*, with *"Try once more (Recommended)"*, its description
saying why another attempt may work now, and *"Skip the design"*, its
description *"finish with the research and the chosen approach"*.

**With question sets** (`design-constraints`): asked through the cockpit, in
this node's one request.

**Without question sets** (`design-constraints`): none is
supplied, and the delegate is invoked on the convergence output and the research
report alone.

**With question sets** (`designer-retry`): asked through the cockpit only when
it is the first thing this node asks in its attempt; after an earlier request in
the same attempt — the constraints question, say — the default below is taken.

**Without question sets** (`designer-retry`): none — neither retry
nor skip. The budget is exhausted and nobody is there, so the node is recorded
`failed` rather than skipped, for the same reason as the brainstormer's retry:
a skip would hide the failure.

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
superseded rather than deleted.

**Budget.** The second attempt runs with corrected context.

---

## `completion`

**Does.** Executed inline, writes no files, and runs only when this run is its
own.

1. Inventory the outputs: the research report always, plus the solution
   exploration, the high-level design and the decision log when the stretches
   that produce them ran.
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
inventory.
