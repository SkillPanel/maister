# Product design workflow — node prose

The node-by-node companion to `product-design.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

## The context block

The block is `design_context`, and this workflow writes no other context block.

| Key | Written by | Holds |
|---|---|---|
| `design_characteristics` | `intake` | the six characteristics as detected, or as corrected through a revise at `characteristics-approval` — `is_greenfield`, `is_enhancement`, `is_ui_focused`, `is_backend`, `is_complex`, `is_simple` |
| `complexity_level` | `intake` | `simple`, `standard` or `complex` |
| `collected_urls`, `research_topics`, `user_files_list` | `intake` | what the operator supplied as extra context; empty lists when nothing was |
| `research_reference` | `intake` | `{path, research_question}` of a research task named on invocation |
| `project_context_summary` | `intake` | a few lines on what the project documentation says |
| `refinement_iterations` | each looping node | rounds taken: `problem_statement`, `personas`, `specification_sections` (a map by section), `prototypes` |
| `visual_companion` | `visual-prototyping` | `{available, port, pid, fallback_to_ascii}` as the mockup studio reported it |
| `design_resources` | `visual-prototyping` | what the studio's design-resource discovery bound to |
| `phase_summaries` | the mirroring nodes | each under the keys its `brief:` `summary_keys` name, beside the fields its Summary part lists |

The run's options live under `orchestrator.options`: `html_output`,
`mockup_format` and `visual_enabled`, the last derived by `intake`.

---

## Depth

The `simple` input is the run's depth. False, the default, is the whole
workflow. True is the shortest run that still ends in a brief and a delivery
scope an operator can approve: the detected complexity says how deep each
document goes, the depth says which stretches run, and when the input is true it
wins.

The `full` input is the other end: every stretch runs and the intake records the
design `complex`, so the personas are drafted and each node asks and writes at
its complex depth, whatever the detection reads. Both inputs true contradict
each other, and `simple` wins; the intake names the contradiction as an `open`
risk.

| Skipped in a simple run | Why it can go |
|---|---|
| `characteristics-approval` | the characteristics it corrects only switch the personas and prototypes, which the depth already turns off |
| `context-approval` | a correction to the context shows up as one to the problem statement built on it, which `problem-approval` revises |
| `persona-exploration` | the intake records `personas_enabled` false |
| `idea-generation`, `idea-convergence`, `direction-approval` | the specification states the approach itself, and its gate approves it |
| `visual-prototyping`, unless the description asks for screens | the intake records `prototyping_enabled` true only then |

Two gates remain, `problem-approval` and `specification-approval`, beside the
brief's own approval inside `review-handoff`.

---

## Embedded mode

**This workflow is child-capable** (engine `references/sub-runs.md`). The
`embedded` input means *this run is a sub-run of another run*; the engine
supplies it at the child freeze and no command exposes it. A parent may pass
`simple` or `full` in the same `with:` to choose the depth: a parent asked for
the full design passes `full: true`, because `simple: false` alone leaves the
depth to the detection.

Its only effect is the guard on `completion`, which is skipped for a child;
everything else runs unchanged, gates and in-node questions included.

A parent reads only the workflow-level `outputs:` block: `brief`,
`delivery_scope` and `mockups`, the last absent when no screens were drawn. Their
paths — `outputs/product-brief.md`, `outputs/delivery-scope.yml` and
`analysis/mockups/` — are a contract and do not move.

---

## `intake`

**Does.** Establishes the task directory and the state, detects the design
characteristics that decide which later nodes run, and gathers whatever extra
context the operator has.

1. **Initialize** as the framework's *Initialization Steps* say — the clock, the
   configuration, the dashboard and the start banner — with an empty
   `phase_summaries` map under `design_context`. Also set
   `options.mockup_format` (default `html`) and derive `options.visual_enabled`:
   false when the `no_visual` input is true or the format is `ascii`. Write
   `context/README.md`, telling the operator to drop relevant files there —
   meeting notes, existing designs, spreadsheets, documents, PDFs, images.
2. **Discover the project documentation** — read the documentation index under
   the project's docs directory if one exists, extract every path from its
   project-documentation section, and read them. Record the paths as
   `project_context.project_doc_paths`, a top-level sibling of the orchestrator
   and context blocks, and a few lines on what they say as
   `design_context.project_context_summary`.
3. **Import research** when the `research` input names a completed research
   task: copy its report, synthesis and solution exploration, where they exist,
   under `context/research-context/`, and record
   `design_context.research_reference`.
4. **Detect the design characteristics** and the complexity as
   `${MAISTER_PLUGIN_ROOT}/skills/product-design/references/characteristic-detection.md`
   says; read it first. **When the `simple` input is true the depth wins**:
   record `simple`, and when the signals said more, add
   `{risk: "detected as <level>; the simple depth was requested", tag: open, change: "run the full design"}`.
   **When the `full` input is true**, record `complex` and say in the summary
   that the full design was requested. When both are true, `simple` wins, and
   `risks` carries
   `{risk: "both the simple and the full depth were requested; the simple design ran", tag: open, change: "run again with only the full depth"}`.
5. **Ask for additional context** in one call: *"Any additional context for
   this design?"*, a multi-select of four options —
   - *"No additional context (Recommended)"* first, its description saying the
     run goes on from the description, the project documentation and the
     research named, if any;
   - *"Files"*, its description naming the folder — `<task path>/context/`, from
     the project root — and asking the operator to drop the files there before
     answering;
   - *"Links"*, and *"Topics to research"*, each description saying to type
     them in this same call's free-text answer, one per line.

   Nothing ticked is the recommended answer. Catalog what is in `context/` into
   `design_context.user_files_list`; sort what was typed into
   `design_context.collected_urls` and `design_context.research_topics`. Only
   when Files was chosen and the folder is still empty, ask once more — the
   question naming the folder, with *"Read the folder again (Recommended)"* and
   *"Go on without files"*.
   Under this picker the four options are one property of type array, none of them the default, and
   the links and topics a text property beside it.
6. **Record the outcome**: this node's three declared values —
   `personas_enabled` true when the design is greenfield or complex,
   `prototyping_enabled` true when it is UI-focused, and `complexity_level`. In
   a simple run `personas_enabled` is false, and `prototyping_enabled` is true
   only when the description itself asks for screens or mockups; in a full run
   `personas_enabled` is true. Write them in the same patch that marks the node
   `completed`, since they guard the persona and prototyping nodes.

The characteristics are not asked about here: `characteristics-approval` shows
them with their rationale, and its revise corrects one. A simple run skips that
gate; the characteristics are still recorded, and the brief names them.

**Asks.**

**With question sets** (`additional-context`): asked in this node's one
request. A folder still empty after a Files answer is not asked about again,
and the run goes on without files.

**Without question sets** (`additional-context`): no additional context; the
lists stay empty rather than half-gathered.

**Summary.** A `headline` naming the kind of design, its complexity and which
optional parts will run ("A complex greenfield design with a user interface:
personas will be drafted and the screens prototyped"). In `summary`, each
characteristic that holds with its one-line rationale, the complexity level,
and which optional parts will run. In `risks`, each characteristic detected on
thin evidence as `{risk, tag: open, change}`, its `change` the correction
("treat it as an enhancement of the existing app"), so the gate's revise offers
it.

**Re-run.** The note is the correction. The task directory, the state, the
dashboard, the documentation and any imported research are in place: do not
create, open or import them again. Apply the note to the characteristics,
keeping the exclusive pairs consistent, and derive the complexity again. A
thin-evidence risk the note settles is written `tag: resolved`. Say which
optional parts now run.

**Budget.** In a terminal run, a description too thin to classify is clarified
with one question offering two or three readings of it, the closest first,
marked `(Recommended)` with why. A driven run classifies at the higher
complexity and names that in `risks`.

---

## `context-synthesis`

**Does.** Turns every context source into one document the later nodes read in
full.

1. **For an enhancement**, delegate the codebase analysis to the
   `codebase-analyzer` skill through the Skill tool, with this task's
   path; it writes `analysis/codebase-analysis.md`. When the skill returns,
   continue with this node.
2. **Read every file** in `context/`.
3. **Fetch every link** in `design_context.collected_urls`.
4. **Research each topic** in `design_context.research_topics` through a
   `maister-copilot:information-gatherer` agent per topic, launched in parallel through
   the Task tool with the topic and its scope, plus the `run-context` output.
5. **Write `analysis/design-context.md`**, synthesising every source: the
   project documentation, the codebase summary for an enhancement, the key
   takeaways of each supplied file and link, the research findings, the
   connections between sources, and what all of it implies for the design.

The synthesis is not asked about here: `context-approval` shows and revises it.

**Summary.** A `headline` giving the finding that most shapes the design and
how many sources fed the synthesis. In `summary`, the two or three key
findings. In `decisions`, the implications for the design, each
`{decision, by: run}`. In `risks`, what the synthesis left open, each
`{risk, tag: open, change}` worded so its `change` can be folded in as it
stands — an unsettled choice, an inferred constraint, a finding resting on one
thin source, a source that could not be read, a link that would not load, a
topic the research could not settle. The phase entry adds `sources_count`.

**Re-run.** Read a file or fetch a link the note adds, research a topic it
adds or reopens, and run the codebase analysis again only when the note is
about the codebase.

**Budget.** The second attempt re-invokes the codebase analyzer or the
information gatherer with adjusted context.

---

## `problem-exploration`

**Does.** Read
`${MAISTER_PLUGIN_ROOT}/skills/product-design/references/interaction-patterns.md`
first — the exploration and convergence modes and the refinement loop. Read
`analysis/design-context.md` in full, so every question is specific to this
project, then the `open` risks in `prior-context` and the open questions of any
imported research under `context/research-context/`.

1. **Explore.** Announce exploration mode in a line, then ask context-aware
   questions in pages, as many as `characteristic-detection.md` sets for the
   complexity. Each question carries its own synthesis line — what the run
   already understands that bears on it ("The sync conflicts come up in three
   support threads, all from teams sharing one calendar") — and two or three
   generated answers, the best-supported first. Fold each page's answers in
   before the next.

   Questions about one behaviour are one story (engine
   `references/in-node-questions.md`, *One topic is one drafted story*), id
   `user-story-<topic>`, asked in the same pages. Keep each story at the level
   of the journey, and name a screen or a control only where the design context
   already does: the layout is the specification's and the prototypes'.
2. **Converge.** Announce the switch, then present the complete draft: the
   problem statement, the key constraints and the success criteria.
3. **Refine** — ask *"Use this problem statement?"*, the question giving the
   statement in a sentence or two. Options: *"Approve (Recommended)"*, its
   description saying what the draft settles; *"Change the scope"* and *"Change
   constraints or success criteria"*, each description naming the change the run
   judges likeliest, from the weakest assumption; and **More details** last. A
   different change, or a rethink, is typed through Other.
   The question lists the constraints and the success criteria, one line each, after the statement.
   On a change, revise the draft and ask again; count each round in
   `design_context.refinement_iterations.problem_statement`. After the soft cap
   (`characteristic-detection.md`) the approve option's description says how
   many rounds were taken; the operator can still take one more.

**Asks.** Each answer is recorded under its id with the topic after it.

**With question sets** (`problem-questions`): the first page — the questions
that stand on their own — goes in this node's one request. A question that
waits on another's answer is not asked, and the draft is marked as a proposal
where it rests on one.

**Without question sets** (`problem-questions`): no question is asked; the
draft is derived from the design context, the description and the project
documentation alone, and marked in the document as a proposal.

**With question sets** (`user-story`): each story that stands on its own is
its own question in the first page's request, its draft, corrections and
alternative written to `analysis/problem-statement.md` before the node
suspends. A story that waits on another's answer is not asked, and is marked
drafted.

**Without question sets** (`user-story`): each story is taken as drafted,
recorded `by: default` under its own id, and marked drafted.

**With question sets** (`problem-refinement`): first-ask only: it goes in a
request only as the first thing this node asks in its attempt.

**Without question sets** (`problem-refinement`): approve and continue, the
count at zero. `problem-approval` is the operator's route back.

**Writes.** `analysis/problem-statement.md`: the approved problem statement,
constraints, success criteria, the user stories under **User stories**, each by
its id with how it was settled, and the key assumptions behind them.

**Summary.** A `headline` giving the problem in one sentence. In `summary`, the
problem statement in a sentence or two, and the number of constraints and
success criteria. In `decisions`, the scope choices the exploration settled,
each `{decision, by: run}`. In `risks`, the assumptions the statement rests on,
each `{risk, tag: open, change}` — a story taken as drafted is one, its `change`
the correction listed for it; a need left out of scope on purpose is
`tag: tradeoff`. The phase entry adds `problem_statement`, `constraints` and
`success_criteria`.

**Re-run.** A note about the personas alone leaves this document unchanged —
say so in the summary and let `persona-exploration` take it.

**Budget.** Re-phrase a question the operator's answer left unclear.

---

## `persona-exploration`

**Does.**

1. **Explore** the user types — their goals, pain points and how they discover
   the feature — in pages of independent questions, as the problem exploration
   does.
2. **Converge** on one to three persona cards, by complexity: name, role, goals,
   pain points and the key journey.
3. **Refine** — ask *"Use these personas?"*, the question naming each persona
   by name and role in a line. Options: *"Approve (Recommended)"*, its
   description saying what the set covers; *"Change a persona"*, *"Add a
   persona"* and *"Remove a persona"*, each description naming the persona and
   the change the run judges likeliest. The four fill the slots, so the
   question ends with `Type "details" for the full cards.`
   On a change, revise the set and ask again; count each round in
   `design_context.refinement_iterations.personas`, with the same soft cap.

**Asks.** Each answer is recorded under its id with the persona or topic after
it.

**With question sets** (`persona-questions`): the first page goes in this
node's one request; a question that waits on another's answer is not asked,
and the cards it would shape are marked as drafted.

**Without question sets** (`persona-questions`): no question is asked; the
cards are drafted from the design context and the problem statement alone and
marked as drafted rather than confirmed.

**With question sets** (`persona-refinement`): first-ask only: it goes in a
request only as the first thing this node asks in its attempt.

**Without question sets** (`persona-refinement`): approve and continue, the
count at zero. `problem-approval` is where they change.

**Writes.** `analysis/personas.md`: each persona card and its user journey,
with any insight about how users discover the feature.

**Summary.** A `headline` covering the problem and the personas in one
sentence, since `problem-approval` closes both. In `summary`, the personas by
name and role, one line each. In `decisions`, what set them apart, each
`{decision, by: run}`. In `risks`, a user type left out on purpose,
`tag: tradeoff`, or one the exploration could not settle, `tag: open` with the
`change` that would add it. The phase entry adds `personas` and
`user_journeys`.

**Re-run.** When the problem statement changed, check every card still fits
it.

**Budget.** Re-present the personas with adjusted framing.

---

## `idea-generation`

**Does.** **Deliberately non-interactive**: alternatives generated outside the
conversation are not anchored on the first idea anybody in it had. Also hand
the brainstormer:

- the design characteristics from state;
- `analysis/personas.md` **only when the state records `persona-exploration`
  completed**;
- the instruction to read the design context, the problem statement and the
  personas in full, and to group the alternatives and trade-offs by decision
  area with a recommendation for each area;
- the absolute path of
  `${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/references/decision-areas.md`,
  the areas file's shape, to read before it writes the file — it cannot expand
  the variable itself.

If the agent returns without `analysis/alternatives.md`, or with one that holds
no alternatives, re-invoke it with corrected context. If the second attempt also
fails, ask *"Idea generation failed twice: <cause>. Try again?"*, with *"Try
once more (Recommended)"*, its description saying why another attempt may work
now, and *"Draft the alternatives here"*, its description warning that
alternatives drafted in this conversation are anchored on the ideas already
discussed.

**Asks.**

**With question sets** (`brainstormer-retry`): first-ask only: it goes in a
request only as the first thing this node asks in its attempt.

**Without question sets** (`brainstormer-retry`): neither. The node is recorded
`failed`; inline alternatives are exactly the anchoring this node avoids, and a
re-drive is the operator's route back in.

**Writes.** A return without `analysis/decision-areas.json` — `areas_path:
null`, the reason in the agent's warnings — is not a failure: record the absence
with that reason and do not re-drive for it. Otherwise register the file on the
summary's artifacts with `role: evidence`.

**Summary.** The number of decision areas, taken from the areas file when there
is one, and of alternatives, and each area's recommendation, in `summary` and
**never in `decisions`**: a recommendation is not a decision, and the operator
decides area by area in the convergence. No gate follows; the convergence's
gate renders this summary too. The phase entry adds `alternatives_count`.

**Re-run.** `direction-approval`'s option to explore more sent the run back.
Hand the brainstormer the note and the existing `analysis/alternatives.md`, and
ask it to revise the file in place with fresh alternatives, listing the ones
already explored as considered.

---

## `idea-convergence`

**Does.** Read the interaction-patterns reference first if this session has
not. Announce convergence mode in a line, then ask the decision areas one per
call, in the order of the file `with: decision_areas` names, from `area-brief`
as engine `references/in-node-questions.md` § *Decision areas from the
brainstorm* says. On a `decision-areas-*` warning, compose every area from
`analysis/alternatives.md` as that reference says, recording each answer as
`convergence-decisions-<the area's name as a slug>`.

Then summarise the chosen direction across the areas; it is not asked about
here, since `direction-approval` follows directly.

**Asks.**

**With question sets** (`convergence-decisions`): every decision area in this
node's one request, one question per area, its `why` naming any other area its
choice depends on. Before it suspends, `analysis/alternatives.md` and the
drafted decision sheet in `analysis/design-decisions.md` are on disk. After the
answers, record each as an operator decision and the chosen direction exactly as
a terminal run does. Two chosen alternatives that conflict are an `open` risk
whose `change` names the switch that resolves it.

**Without question sets** (`convergence-decisions`): **not defaulted — the
decision is left for `direction-approval`**, because everything after it is
built on it. This node does every part of the convergence except the choice:
- every area is still worked in full — alternatives, pros and cons, the
  recommendation and its strongest rival — and written into
  `analysis/design-decisions.md` as a **decision sheet**, which opens by saying
  the direction is proposed, not chosen, and that continuing at the direction
  gate adopts every recommendation in it;
- `decisions` carries one item per area, `{decision: "<area>: <recommended
  alternative> recommended — adopted if you continue", by: run}`;
- `risks` carries one item per area, most consequential first,
  `{risk: "<area>: <recommended alternative> is adopted if you continue", tag: open, change: "take <strongest rival> instead"}`,
  so each revise suggestion at the gate is a concrete switch;
- `decision_areas` records every area with `recommended` set and
  `chosen_approach` unset, and `selected_approach` stays unset;
- an area with no recommendation is recorded the same way, its risk naming the
  alternatives to choose between.

**Writes.** `analysis/design-decisions.md`: the chosen approach and its
rationale, the key decision per area, the trade-offs accepted, and the
alternatives considered in brief, pointing at `analysis/alternatives.md` for
the detail.

**Summary.** With a choice made: a `headline` naming the chosen direction, the
direction across the areas in `summary`, and the trade-offs the direction
accepts in `risks`, each `tag: tradeoff`, beside any conflict risk. Without
question sets: the items above, and a `headline` and `summary` saying the
direction is proposed and how many areas await the operator's choice. The phase
entry adds `selected_approach`, `trade_offs_accepted` and `decision_areas` —
each element `area`, `alternatives_count`, `recommended` and `chosen_approach`,
the first two from the decision areas file when the areas came from it. Every
area is in `decision_areas`, chosen or recorded open with its recommendation;
an area dropped for any reason is a defect to resolve before completing.

**Re-run.** After `refine-direction`: with a choice made, re-ask only the areas
the note reopens and keep the other choices; without question sets, take the
alternative the note names for each area it names, recorded as
`{decision: "<area>: <alternative> — chosen at the direction gate", by: operator}`
with who answered, and leave the rest open. After `explore-more-alternatives`
the alternatives are new: work every area afresh, keeping a choice only for an
area that survives unchanged.

**Budget.** Re-read the alternatives and re-present the decision areas.

---

## `direction-approval`

**Exception.** Its continue option means more under a driver. When
`idea-convergence` left the areas open, continuing is the operator adopting
every recommendation on the decision sheet; the gate's recorded answer, with who
gave it, is that choice. Nothing is written back into the sheet.

---

## `feature-specification`

**Does.** The specification is proposed and refined section by section, never
drafted whole for one approval and never delegated to the specification
creator: it is authored here, in convergence with the operator.

Read the direction first. When the state records `idea-convergence` completed,
read `analysis/design-decisions.md`. When it is a decision sheet with areas left
open, read `direction-approval`'s recorded answer from the state: a continue
means the operator adopted every recommendation, and the specification states
in its Key Decisions that the direction was adopted at the direction gate,
naming who answered.

In a simple run there is no decision record. The specification's first section
is then **Approach**: the direction in a paragraph, and the one or two
alternatives it passed over in a line each with why. Its choices go in
`decisions` as `{decision, by: run}`; a choice made on thin evidence goes in
`risks` as `open`, with the other way as its `change`.

Keep the stories. When `analysis/problem-statement.md` holds user stories, write
them first into `analysis/feature-spec.md` under **User stories**, each by its
id and whole — they are not asked again. Each section names the stories it
serves. A story the chosen direction changes is restated as changed, and is an
`open` risk; a story no section serves is an `open` risk too, never a silent
drop.

Scale the number and depth of the sections to the complexity, as
`characteristic-detection.md` § *Adaptive Depth Scaling* sets.

> **Section depth principle**: each section holds enough that a developer could
> implement that aspect without asking a clarifying question — "If I had only
> this section and the codebase, could I write the code?" In a complex design, a
> section about data lists every entity with its fields and types; one about an
> interface every endpoint or method with its input and output shapes; one about
> a workflow every state and transition with its guards and side effects; one
> about an integration the connection points, the data flow and the error
> handling.

For each section:

1. Draft it at the depth above. A section never quietly drops a criterion the
   description states; one it leaves to another section names that section, and
   one the direction left out is an `open` risk.
2. Ask *"Approve the <section> section?"*, the question saying in a line what
   the section settles. Options: *"Approve (Recommended)"*, its description
   saying the section is implementation-ready and why; *"Add more detail"*,
   *"Change its scope"* and *"Rethink it"*, each description naming the change
   the run judges likeliest. The four fill the slots, so the question ends with
   `Type "details" for the full section.`
   The question lists the section's points, a line each, before the ask.
   On a change, revise the section and ask again; count rounds per section in
   `design_context.refinement_iterations.specification_sections`, with the soft
   cap.
3. **On approval, append the section to `analysis/feature-spec.md` at once** —
   the file, not the conversation, is the source of truth.

Depth verification, for a complex design, is never skipped because each section
was approved: approval confirms direction, the verification makes the
specification implementation-ready. Once every section is written, re-read the
whole file against the depth principle. For each thin section, draft an
enrichment, then ask about all of them in one question: *"Add these N
enrichments to the specification?"*, listing each one in a line — the section
and what it adds. Options: *"Accept all N enrichments (Recommended)"*, its
description saying the depth check found those sections short of
implementation-ready; *"Choose which to add"*, which opens a multi-select of the
enrichments, each labelled `(Recommended)`; *"Keep the sections as approved"*;
and **More details**.

Then present a short summary of the specification.

**Asks.** Each section's answer is recorded under its id with the section after
it.

**With question sets** (`specification-sections`): every section in this node's
one request, one question per section, each drafted and written to
`analysis/feature-spec.md` before it suspends; a change asked for is applied
after the answers without another round.

**Without question sets** (`specification-sections`): every section is approved
as drafted and appended in order, still written to the depth a developer could
implement from; a section that cannot reach it without an answer says which
answer it needs rather than being padded to look finished.

**With question sets** (`depth-enrichment`): first-ask only: after the
sections' request, the default below.

**Without question sets** (`depth-enrichment`): every enrichment
is appended as drafted, marked as added by the depth check.

**Writes.** When nobody could be asked, `analysis/feature-spec.md` says its
sections are drafts no operator refined in session.

**Summary.** A `headline` saying what the feature does and how many sections
specify it. In `summary`, the sections by name and what the feature does in two
sentences. In `decisions`, the scope boundaries and the key "how" decisions,
each `{decision, by: run}`; the direction chosen earlier is never restated as
the specification's. In `risks`, every answer a section said it still needs,
each `{risk, tag: open, change}`; a scope boundary drawn on purpose is
`tag: tradeoff`. The phase entry adds `spec_sections` and `sections_count`.

**Re-run.** Revise the sections the note reaches through the same per-section
loop in a terminal run, and run the depth verification again for a complex
design. Say which sections changed.

**Budget.** Re-draft a section with a different approach.

---

## `visual-prototyping`

**Does.** Pass the studio:

- the mockup format: `html` when `options.visual_enabled` is true, `ascii`
  otherwise;
- the instruction to draw **user-facing wireframes of the feature's actual
  screens** — an "add item" form, an alert dialog, whatever the specification
  describes — never generic placeholders or technical diagrams;
- the specification and the design context; `analysis/design-decisions.md`
  **only when the state records `idea-convergence` completed** — in a simple run
  the specification's Approach section carries the direction; and the personas'
  journeys from `analysis/personas.md` **only when the state records
  `persona-exploration` completed**.

The refinement loop is the studio's own, and it stays in the node: screens
approved or revised one by one, re-rendered while the companion stays up — which
is why the gate after this node offers no revise of the prototypes.

The companion stays up until the brief. The operator reviews the screens at
`specification-approval`, so do not shut the server down here; `review-handoff`
does.

**Asks.**

**With question sets**: the same — refining mockups needs the browser companion
in session, so it is not carried as a question.

**Without question sets** (the studio's `mockup-refinement`): the studio
degrades full iteration to a single pass on its own and says so in its notes.
Put that note in this node's summary.

**Writes.** Record the companion's status as `design_context.visual_companion`,
what its discovery bound to as `design_context.design_resources`, and the
rounds as `design_context.refinement_iterations.prototypes`.

**Summary.** The gallery pointer: when the studio reports a live gallery
address, put it, verbatim, in this node's `headline` — the screens drawn and
where to see them — and open its `summary` with it and the navigation the
operator has: a brief that has to trim keeps each summary's opening sentences.
When the companion never came up, say so plainly and name the saved files
instead. Never write an address that was never served. The phase entry adds
`mockup_references`, the studio's returned files.

**Re-run.** Re-invoke the studio with the revised specification and regenerate
only the screens the revision touches, reusing the server still running.

**Budget.** Restart the companion on the second attempt; the studio's fallback
to terminal mockups is a recorded note, not a retry.

---

## `review-handoff`

**Does.** Assembles the product brief and the delivery scope and asks for the
brief's final approval, on every path, because a parent reads what it writes.

1. **Check the specification once more, for a complex design.** Re-read
   `analysis/feature-spec.md` and confirm each section answers both what to
   build and how. A gap found here is named in the brief's Open Questions /
   Risks and in this node's `risks`; it does not send the run back.
2. **Assemble the layered brief** from the documents on disk, pointing at the
   detailed documents rather than repeating them:
   - **Core brief**, always: the problem statement, the target users, the
     feature overview, the constraints, the success criteria and the acceptance
     criteria, condensed; and the user stories from the specification, each by
     its id and whole — never condensed;
   - **Persona cards**, when the state records `persona-exploration` completed;
   - **Design decisions**, a summary per decision area, pointing at the decision
     record and the alternatives, when the state records `idea-convergence`
     completed; in a simple run, the specification's Approach section condensed;
   - **Mockup references**, when the state records `visual-prototyping`
     completed — links to the files under `analysis/mockups/`, and terminal
     mockups inline;
   - **Delivery scope**, always: each member in scope as one plain sentence —
     the member, what changes there, and what it waits for — in order, then each
     member left out with its reason. Approving the brief approves the scope;
   - **References**: every analysis document the run produced.
3. **Write `outputs/product-brief.md` and `outputs/delivery-scope.yml`**, the
   scope as the umbrella skill's `references/delivery-scope.md` shapes it. A
   member is in scope when the specification changes something it owns. Draw
   every statement from the specification and the design decisions — the
   decision record when the convergence ran, the Approach section otherwise —
   never from a guess about code nobody read.
4. **Approve** — ask *"Approve the product brief?"*, the question naming its
   layers in a line. Options: *"Approve (Recommended)"*, its description *"the
   brief only restates approved sections"*; *"Revise a section"* and *"Add
   missing information"*, each description naming the section or the gap the run
   judges likeliest; and **More details** last.
   The question lists the brief's points, a line per layer, before the ask.
   On a change, revise the brief and ask again.
5. **Shut the mockup companion down** if `visual-prototyping` started one, by
   posting to the server's shutdown route.

**Asks.**

**With question sets** (`brief-approval`): in this node's one request, the
brief already written to `outputs/product-brief.md`.

**Without question sets** (`brief-approval`): approve the brief, and record
in its Open Questions / Risks that it was assembled without in-session
review, naming every section no operator confirmed in session — the brief is
what a development run is built from.

**Writes.** `outputs/delivery-scope.yml` is read by a machine: it carries its
fixed shape and no artifact summary block. The brief's HTML page is written
after approval, so it shows the approved brief — never once per revision round.

**Summary.** The `headline` names what was designed in a sentence; the
`summary` carries the delivery scope in one more — for instance *"two members in
scope, `api` before `web`; `mobile` left out"*. The phase entry adds
`brief_layers`.

**Budget.** Re-assemble the brief and the scope from the documents on disk.

---

## `completion`

**Does.** The hand-off to development: given this run's task directory, the
development workflow's intake copies the brief and the mockups into its own
design context. A delivery spanning several repositories is planned from the
delivery scope: one development run per member in scope, in `depends_on` order.

**Close for whoever reads the end** with the engine's wrap-up (engine §
*Operator visibility*): Done names what was designed, Needs you each
`missing-artifact:` and `missing-companion:` line in plain words, Files the
brief and the scope. **Next** carries this next step exactly, inventing no
other command:

```
Product brief approved and saved to: [task-path]/outputs/product-brief.md

To start development based on this design, clear context first or start a new session, then run:
/maister-copilot:development [task-path]
```

A run a gate's stop option ended closes the same way.

No close-out while a choice is held: when the freeze recorded
`orchestrator.classes_questions`, this node runs
`gate-brief --node=held-approval` before its closing patch and before any
close-out, as the engine's *Ending a dispatched run* says.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the wrap-up above; otherwise the run ends
`RUN-FAILED: closeout-unpublished`.
