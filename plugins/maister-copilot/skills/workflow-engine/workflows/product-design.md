# Product design workflow — node prose

The node-by-node companion to `product-design.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**Beyond its five gates the run asks in-node questions**, and the mockup studio
runs a refinement loop of its own inside the prototyping node. A simple run
(*Depth*) asks far fewer, around its two gates.

**Every question asked inside a node names its default here**, under **With
question sets** and **Without question sets**; the rule, the recording shape and
the More details request are the engine's (`references/in-node-questions.md`).
A refinement or retry question goes in a request only as the first thing its
node asks in its attempt. One question is never defaulted: the convergence on a
design direction, left open for the direction gate (`idea-convergence`).

**When the run's policy classes in-node questions** — the freeze recorded
`orchestrator.classes_questions` — a node sends its question set to the writer
first and asks only the ids the writer's `ask:` line names (engine
`references/in-node-questions.md` § *When the policy classes a question*).

**Each draft this workflow presents** — a story, the problem statement, the
persona cards, a decision area, a specification section, the enrichments, the
brief — is named in its own question with what it settles, and each option says
what it changes. Every ask fits four options.
Without previews, the question lists the draft's points, one line each, and More details carries the
full text.
Each answer is recorded `by: operator` under the id its default names, with the
topic, persona or section after it where a node asks several.

**A driven run produces drafts.** Under a `cockpit` or `dispatch` driver every
default it cannot ask is taken, so the problem statement, the personas, the
specification and the brief are drafts no operator refined in session, and the
gates are where an operator shapes them. Say so in the artifacts.

**Guards** are explained in `product-design.yml`: a skipped node satisfies
everything downstream, and the two gates after the guarded nodes stay unguarded.
Every gate is asked from `gate-brief --json` as engine `references/gates.md`
says; record the answer and stop the run on the stop option. A revise re-runs
the stretch its section names, then the gate again (*Revising at a gate*).

---

## Run-scoped context

Every delegate prompt opens with the `run-context --node=<this node>` output,
pasted unedited (artifact writers: `prior-context --node=<this node>`, which
prints that block first): the task path, the HTML style guide, the documentation
paths, the scratch rule and the companions the node owes. What this workflow
adds:

- **`task_path`** sits under the type directory `product-design/`.
- **The documentation paths** are discovered by `intake` and recorded as
  `project_context.project_doc_paths`; every later node reads them from state.
- **A `direct:` node that owes a companion** — the run context lists it under
  `companions:` — hands its final markdown to the
  `maister-copilot:html-companion-writer` agent through the Task tool, before this
  node's completion write: the markdown path, a label for the artifact and the
  sibling reports that exist, for the breadcrumb, plus the `run-context` output.
  With `html: off` there is nothing to hand over. A companion that fails never
  blocks the run: keep the markdown, say so in the summary, and leave the miss
  for `run-complete` to report.
- **`outputs/delivery-scope.yml`** is read by a machine: it carries its fixed
  shape and no artifact summary block.

---

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
| `phase_summaries` | the mirroring nodes | see below |

The run's options live under `orchestrator.options`: `html_output`,
`mockup_format` and `visual_enabled`, the last derived by `intake`.

---

## Phase summary keys

`design_context.phase_summaries` is keyed by this workflow's own semantic keys,
never by node id (engine § *Recording an outcome*). Eight nodes mirror their
summary, each entry carrying `node:` naming the node it came from:

| Node | `phase_summaries` key | Fields beside the shared shape |
|---|---|---|
| `context-synthesis` | `context_synthesis` | `sources_count` |
| `problem-exploration` | `problem_exploration` | `problem_statement`, `constraints`, `success_criteria` |
| `persona-exploration` | `persona_exploration` | `personas`, `user_journeys` |
| `idea-generation` | `idea_generation` | `alternatives_count` |
| `idea-convergence` | `idea_convergence` | `selected_approach`, `trade_offs_accepted`, `decision_areas` — each element `area`, `alternatives_count`, `recommended` and `chosen_approach`, the first two from the decision areas file when the areas came from it |
| `feature-specification` | `feature_specification` | `spec_sections`, `sections_count` |
| `visual-prototyping` | `visual_prototyping` | `mockup_references` |
| `review-handoff` | `review_handoff` | `brief_layers` |

`intake` and `completion` write a node summary only.

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

Executed inline and interactive. It establishes the task directory and the
state, detects the design characteristics that decide which later nodes run,
and gathers whatever extra context the operator has.

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
   `design_context.research_reference`. When no research was named, record
   `absent: {research_context: "no research task was named"}`.
4. **Detect the design characteristics.** Read
   `${MAISTER_PLUGIN_ROOT}/skills/product-design/references/characteristic-detection.md`
   first. Detect the six characteristics from the description and the codebase
   signals, and derive the complexity: `simple` when the design is simple,
   `complex` when it is complex or greenfield, `standard` otherwise; mixed
   signals lean higher. **When the `simple` input is true the depth wins**:
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

   **With question sets** (`additional-context`): asked in this node's one
   request. A folder still empty after a Files answer is not asked about again,
   and the run goes on without files.

   **Without question sets** (`additional-context`): no additional context; the
   lists stay empty rather than half-gathered.
6. **Record the outcome**: the characteristics, the complexity level and the
   collected context under `design_context`, and this node's three declared
   values — `personas_enabled` true when the design is greenfield or complex,
   `prototyping_enabled` true when it is UI-focused, and `complexity_level`. In
   a simple run `personas_enabled` is false, and `prototyping_enabled` is true
   only when the description itself asks for screens or mockups; in a full run
   `personas_enabled` is true. Write them in the same patch that marks the node
   `completed`, since they guard the persona and prototyping nodes.

The characteristics are not asked about here: `characteristics-approval` shows
them with their rationale, and its revise corrects one. A simple run skips that
gate; the characteristics are still recorded, and the brief names them.

**Gate brief content.** A `headline` naming the kind of design, its complexity
and which optional parts will run ("A complex greenfield design with a user
interface: personas will be drafted and the screens prototyped"). In `summary`,
each characteristic that holds with its one-line rationale, the complexity
level, and which optional parts will run. In `decisions`, the additional-context
answer, or `{decision, by: default, question_id: additional-context}`. In
`risks`, each characteristic detected on thin evidence as
`{risk, tag: open, change}`, its `change` the correction ("treat it as an
enhancement of the existing app"), so the gate's revise offers it.

**When re-run after a revise.** The note under *Revision requested* is the
correction. The task directory, the state, the dashboard, the documentation and
any imported research are in place: do not create, open or import them again.
Apply the note to the characteristics, keeping the exclusive pairs consistent,
derive the complexity again, and record all three declared values again — a
revise clears them. Ask nothing already answered. A thin-evidence risk the note
settles is written `tag: resolved`. Say in the summary what changed and which
optional parts now run.

**Recovery budget**: one attempt — in a terminal run, a description too thin to
classify is clarified with one question offering two or three readings of it,
the closest first, marked `(Recommended)` with why. A driven run classifies at
the higher complexity and names that in `risks`.

---

## `characteristics-approval`

Skipped in a simple run (*Depth*). The one checkpoint that confirms the
characteristics under every driver: `revise-characteristics` sends the run back
to `intake` with the operator's note as the correction.

---

## `context-synthesis`

Executed inline, delegating the codebase and the web. It turns every context
source into one document the later nodes read in full.

1. **For an enhancement**, delegate the codebase analysis to the
   `codebase-analyzer` skill through the Skill tool, with this task's
   path; it writes `analysis/codebase-analysis.md`. When the skill returns,
   continue with this node. For a greenfield design record
   `absent: {codebase_analysis: "a greenfield design has no codebase to analyse"}`.
2. **Read every file** in `context/`.
3. **Fetch every link** in `design_context.collected_urls`.
4. **Research each topic** in `design_context.research_topics` through a
   `maister-copilot:information-gatherer` agent per topic, launched in parallel through
   the Task tool with the topic, its scope and the task path.
5. **Write `analysis/design-context.md`**, synthesising every source: the
   project documentation, the codebase summary for an enhancement, the key
   takeaways of each supplied file and link, the research findings, the
   connections between sources, and what all of it implies for the design.

The synthesis is not asked about here: `context-approval` shows and revises it.

**Gate brief content.** A `headline` giving the finding that most shapes the
design and how many sources fed the synthesis. In `summary`, the two or three
key findings. In `decisions`, the implications for the design, each
`{decision, by: run}`, never an earlier answer restated. In `risks`, what the
synthesis left open, each `{risk, tag: open, change}` worded so its `change` can
be folded in as it stands — an unsettled choice, an inferred constraint, a
finding resting on one thin source, a source that could not be read, a link that
would not load, a topic the research could not settle — since the gate's revise
offers those changes.

**When re-run after a revise.** Fold the note's corrections and additions into
`analysis/design-context.md` in place: read a file or fetch a link the note
adds, research a topic it adds or reopens, and run the codebase analysis again
only when the note is about the codebase. Keep everything else, ask nothing
already answered, and say in the summary what changed.

**Recovery budget**: two attempts — re-invoke the codebase analyzer or the
information gatherer with adjusted context on the second.

---

## `context-approval`

Skipped in a simple run (*Depth*). `revise-context` sends the run back to
`context-synthesis` with the operator's note.

---

## `problem-exploration`

Executed inline and interactive. Read
`${MAISTER_PLUGIN_ROOT}/skills/product-design/references/interaction-patterns.md`
first — the exploration and convergence modes and the refinement loop. Read
`analysis/design-context.md` in full, so every question is specific to this
project, then the `open` risks in `prior-context` and the open questions of any
imported research under `context/research-context/`. A criterion one of them
says may be read two ways is answered the way that keeps it whole (engine
`references/in-node-questions.md`).

1. **Explore.** Announce exploration mode in a line, then ask context-aware
   questions **in pages of up to four** — two or three for a simple design, four
   to six for a standard one, eight to ten for a complex or greenfield one. A
   page holds only questions that stand on their own. Each question carries its
   own synthesis line — what the run already understands that bears on it ("The
   sync conflicts come up in three support threads, all from teams sharing one
   calendar") — and two or three generated answers, the best-supported first,
   marked `(Recommended)` with why. The recommended answer keeps every criterion
   the description states; one that narrows a criterion names what it drops and
   is never the recommendation. Fold each page's answers in before the next.

   **With question sets** (`problem-questions`): the first page — the questions
   that stand on their own — goes in this node's one request. A question that
   waits on another's answer is not asked, and the draft is marked as a proposal
   where it rests on one.

   **Without question sets** (`problem-questions`): no question is asked; the
   draft is derived from the design context, the description and the project
   documentation alone, and marked in the document as a proposal.

   **Questions about one behaviour are one story** (engine
   `references/in-node-questions.md`, *One topic is one drafted story*). Once a
   behaviour the feature must support is named — removing a member, sharing a
   calendar — its questions are drafted into one story asked as one question, id
   `user-story-<topic>`, in the same pages. Keep each story at the level of the
   journey, and name a screen or a control only where the design context already
   does: the layout is the specification's and the prototypes'. Each story goes
   into `analysis/problem-statement.md` under **User stories**, by its id, with
   how it was settled.

   **With question sets** (`user-story`): each story that stands on its own is
   its own question in the first page's request, its draft, corrections and
   alternative written to `analysis/problem-statement.md` before the node
   suspends. A story that waits on another's answer is not asked, and is marked
   drafted.

   **Without question sets** (`user-story`): each story is taken as drafted,
   recorded `by: default` under its own id, and marked drafted.
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
   — two rounds for a simple design, three otherwise — the approve option's
   description says how many rounds were taken; the operator can still take one
   more.

   **With question sets** (`problem-refinement`): first-ask only (above).

   **Without question sets** (`problem-refinement`): approve and continue, the
   count at zero. `problem-approval` is the operator's route back.
4. **Write `analysis/problem-statement.md`**: the approved problem statement,
   constraints, success criteria, the user stories as settled, and the key
   assumptions behind them.

**Gate brief content.** A `headline` giving the problem in one sentence. In
`summary`, the problem statement in a sentence or two, and the number of
constraints and success criteria. In `decisions`, the scope choices the
exploration settled, each `{decision, by: run}`, beside the operator's answers
or `{decision, by: default, question_id}` per defaulted question; an earlier
answer is never restated. In `risks`, the assumptions the statement rests on,
each `{risk, tag: open, change}` — a story taken as drafted is one, its `change`
the correction listed for it; a need left out of scope on purpose is
`tag: tradeoff`.

**When re-run after a revise.** A note about the personas alone leaves this
document unchanged — say so in the summary and let `persona-exploration` take
it. Otherwise revise the document in place, asking again only what the note
reopens, and say in the summary what changed.

**Recovery budget**: one attempt — re-phrase a question the operator's answer
left unclear.

---

## `persona-exploration`

Executed inline and interactive, and **guarded** on `personas_enabled`: it runs
only for a greenfield or complex design. When skipped, `problem-approval` still
fires for the problem statement.

1. **Explore** the user types — their goals, pain points and how they discover
   the feature — in pages of up to four independent questions, as the problem
   exploration does, never recommending an answer that narrows a criterion the
   description states.

   **With question sets** (`persona-questions`): the first page goes in this
   node's one request; a question that waits on another's answer is not asked,
   and the cards it would shape are marked as drafted.

   **Without question sets** (`persona-questions`): no question is asked; the
   cards are drafted from the design context and the problem statement alone and
   marked as drafted rather than confirmed.
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

   **With question sets** (`persona-refinement`): first-ask only (above).

   **Without question sets** (`persona-refinement`): approve and continue, the
   count at zero. `problem-approval` is where they change.
4. **Write `analysis/personas.md`**: each persona card and its user journey, with
   any insight about how users discover the feature.

**Gate brief content.** A `headline` covering the problem and the personas in
one sentence, since `problem-approval` closes both. In `summary`, the personas
by name and role, one line each. In `decisions`, what set them apart, each
`{decision, by: run}`, beside the operator's answers or the defaulted entries;
no earlier answer restated. In `risks`, a user type left out on purpose,
`tag: tradeoff`, or one the exploration could not settle, `tag: open` with the
`change` that would add it.

**When re-run after a revise.** Revise the cards the note names in place, keep
the others, and when the problem statement changed, check every card still fits
it. Say in the summary what changed.

**Recovery budget**: one attempt — re-present the personas with adjusted
framing.

---

## `problem-approval`

**Unguarded**, closing the problem statement and — when they were drafted — the
personas. Its revise option re-runs the stretch from `problem-exploration` with
the operator's note: the problem statement, then the personas when their guard
holds; each node keeps what the note does not touch.

---

## `idea-generation`

Skipped in a simple run (*Depth*). Delegated to the
`maister-copilot:solution-brainstormer` agent through the Task tool, **deliberately
non-interactive**: alternatives generated outside the conversation are not
anchored on the first idea anybody in it had. Everything node-scoped is in
`with:`; the `prior-context --node=idea-generation` output supplies the rest,
including the `html:` line. Also hand it:

- the design characteristics from state;
- `analysis/personas.md` **only when the state records `persona-exploration`
  completed**;
- the instruction to read the design context, the problem statement and the
  personas in full, and to write to `analysis/alternatives.md` exactly and
  nowhere else, with alternatives and trade-offs grouped by decision area and a
  recommendation for each area;
- `areas_output_path`, which is exact: `analysis/decision-areas.json` and
  nowhere else; and the absolute path of
  `${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/references/decision-areas.md`,
  the file's shape, to read before it writes the file — it cannot expand the
  variable itself.

A return without `analysis/decision-areas.json` — `areas_path: null`, the reason
in the agent's warnings — is not a failure: the convergence asks from the
markdown. Record `absent: {decision_areas: "<the reason>"}` and do not re-drive
for it. Otherwise register the file on the summary's artifacts with
`role: evidence`, and take the summary's count of decision areas from it.

If the agent returns without `analysis/alternatives.md`, or with one that holds
no alternatives, re-invoke it with corrected context. If the second attempt also
fails, ask *"Idea generation failed twice: <cause>. Try again?"*, with *"Try
once more (Recommended)"*, its description saying why another attempt may work
now, and *"Draft the alternatives here"*, its description warning that
alternatives drafted in this conversation are anchored on the ideas already
discussed.

**With question sets** (`brainstormer-retry`): first-ask only (above).

**Without question sets** (`brainstormer-retry`): neither. The node is recorded
`failed`; inline alternatives are exactly the anchoring this node avoids, and a
re-drive is the operator's route back in.

**Node summary.** The number of decision areas and of alternatives, and each
area's recommendation, in `summary` and **never in `decisions`**: a
recommendation is not a decision, and the operator decides area by area in the
convergence. No gate follows; the convergence's gate renders this summary too.

**When re-run after a revise.** `direction-approval`'s option to explore more
sent the run back. Hand the brainstormer the note and the existing
`analysis/alternatives.md`, and ask it to revise the file in place with fresh
alternatives, listing the ones already explored as considered.

**Recovery budget**: two attempts, the second with adjusted context.

---

## `idea-convergence`

Skipped in a simple run (*Depth*). Executed inline and interactive. Read the
interaction-patterns reference first if this session has not. Announce
convergence mode in a line, then walk the alternatives one decision area at a
time (engine `references/in-node-questions.md`).

> **ANTI-PATTERN**: Do NOT put several decision areas in one call, as tabs of a
> page or as one combined question, and do NOT offer them as accept-all. One
> call, one question, one area: a later area can depend on an earlier answer.
> (With question sets every area goes in the node's one request instead, still
> one question per area.)
>
> **ANTI-PATTERN**: Do NOT shortcut the remaining areas after giving the first
> its full detail. EVERY area's question, options and previews carry the SAME
> level of detail.

1. **Read `analysis/alternatives.md`**, and take the decision area ids and their
   order from the file `with: decision_areas` names.
2. **For each decision area, sequentially**, ask **one question for this area**
   from `area-brief --json`, as engine `references/in-node-questions.md` §
   *Decision areas from the brainstorm* says, pasted as given, and record the
   answer under the `question_id` it prints; on More details, print its
   `more_details` and ask the same area again. Only when the verb prints a
   `decision-areas-*` warning, compose every area yourself from the
   alternatives, recording each answer as
   `convergence-decisions-<the area's name as a slug>`:
   - **the question** names the area, why the decision matters in a sentence or
     two, and each alternative in a line;
   - **the options** are its alternatives, the recommended one first and marked
     `(Recommended)` with its reason; each other option's description gives its
     key pro and con in a few words; **More details** is last;
   - **the recommendation**: the question's last line before the ask is "Recommended: <alternative>
     — <reason>", because the form shows no option descriptions;
   - **the cap**: an area with more alternatives than the options hold offers
     the recommended one and its strongest rivals and names the rest in the
     question text.

   On a choice, record it as an operator decision and move on.
3. **Summarise the chosen direction** across the areas into this node's summary.
   It is not asked about here: `direction-approval` follows directly.
4. **Write `analysis/design-decisions.md`**: the chosen approach and its
   rationale, the key decision per area, the trade-offs accepted, and the
   alternatives considered in brief, pointing at `analysis/alternatives.md` for
   the detail. Then hand it to `maister-copilot:html-companion-writer` before this
   node's completion write (*Run-scoped context*).

> **SELF-CHECK before each question**: does the question itself name THIS area,
> why it matters and every alternative, and does each option's description carry
> its pro and con — the recommended one's its reason? If the question holds only
> the area's name, STOP and write it out. Does the recommended alternative keep
> every criterion the description states? If it narrows one, recommend the
> strongest alternative that does not, and say why. And, in a terminal run, does
> this call ask exactly one area?

**With question sets** (`convergence-decisions`): every decision area in this
node's one request, one question per area, its `why` naming any other area its
choice depends on. Before it suspends, `analysis/alternatives.md` and the
drafted decision sheet in `analysis/design-decisions.md` are on disk. After the
answers, record each as an operator decision and the chosen direction exactly as
a terminal run does. Two chosen alternatives that conflict are an `open` risk
whose `change` names the switch that resolves it. The set comes from
`area-brief --patch-file`, as engine `references/in-node-questions.md` says; on
a `decision-areas-*` warning, write it from the composed areas instead.


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
  `chosen_approach` unset, and `selected_approach` stays unset.

An area with no recommendation is recorded the same way, its risk naming the
alternatives to choose between.

> **GATE CHECK**: verify that EVERY decision area is in `decision_areas` —
> chosen, or recorded open with its recommendation without question sets. An
> area dropped for any reason is a defect: STOP and resolve it before marking
> this node complete.

**Gate brief content.** With a choice made: a `headline` naming the chosen
direction, the direction across the areas in `summary`, the operator's answer
per area in `decisions` and no earlier answer restated, and the trade-offs the
direction accepts in `risks`, each `tag: tradeoff`, beside any conflict risk.
Without question sets: the items above, and a `headline` and `summary` saying
the direction is proposed and how many areas await the operator's choice.

**When re-run after a revise.** After `refine-direction`: with a choice made,
re-ask only the areas the note reopens and keep the other choices; without
question sets, take the alternative the note names for each area it names,
recorded as
`{decision: "<area>: <alternative> — chosen at the direction gate", by: operator}`
with who answered, and leave the rest open. After `explore-more-alternatives`
the alternatives are new: work every area afresh, keeping a choice only for an
area that survives unchanged. Rewrite `analysis/design-decisions.md` in place
and say in the summary what changed.

**Recovery budget**: one attempt — re-read the alternatives and re-present the
decision areas.

---

## `direction-approval`

Skipped in a simple run (*Depth*). The direction is approved here and nowhere
before it.

**Its continue option means more under a driver.** When `idea-convergence` left
the areas open, continuing is the operator adopting every recommendation on the
decision sheet; the gate's recorded answer, with who gave it, is that choice.
Nothing is written back into the sheet.

`refine-direction` re-runs the convergence with the operator's note, re-asking
the areas the note names. `explore-more-alternatives` re-runs the brainstorm
first and then the convergence, for when none of the alternatives fits.

---

## `feature-specification`

Executed inline and interactive: the specification is proposed and refined
section by section, never drafted whole and never delegated.

> **ANTI-PATTERN**: Do NOT draft every section at once and ask for one approval.
> Each section is proposed, reviewed and approved on its own.
>
> **ANTI-PATTERN**: Do NOT delegate to the specification creator. This
> specification is authored here, in convergence with the operator.

**Read the direction first.** When the state records `idea-convergence`
completed, read `analysis/design-decisions.md`. When it is a decision sheet with
areas left open, read `direction-approval`'s recorded answer from the state: a
continue means the operator adopted every recommendation, and the specification
states in its Key Decisions that the direction was adopted at the direction
gate, naming who answered.

**In a simple run there is no decision record.** The specification's first
section is then **Approach**: the direction in a paragraph, and the one or two
alternatives it passed over in a line each with why. Its choices go in
`decisions` as `{decision, by: run}`; a choice made on thin evidence goes in
`risks` as `open`, with the other way as its `change`.

**Keep the stories.** When `analysis/problem-statement.md` holds user stories,
write them first into `analysis/feature-spec.md` under **User stories**, each by
its id and whole — they are not asked again. Each section names the stories it
serves. A story the chosen direction changes is restated as changed, and is an
`open` risk; a story no section serves is an `open` risk too, never a silent
drop.

**Scale the sections to the complexity**: three or four of about 20 to 50 lines
for a simple design — what to build; five or six of about 50 to 100 for a
standard one — what, and the key decisions about how; six to eight of about 100
to 300 for a complex one — what, how, edge cases and the schemas and contracts.

> **Section depth principle**: each section holds enough that a developer could
> implement that aspect without asking a clarifying question — "If I had only
> this section and the codebase, could I write the code?" In a complex design, a
> section about data lists every entity with its fields and types; one about an
> interface every endpoint or method with its input and output shapes; one about
> a workflow every state and transition with its guards and side effects; one
> about an integration the connection points, the data flow and the error
> handling.

**For each section:**

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

**With question sets** (`specification-sections`): every section in this node's
one request, one question per section, each drafted and written to
`analysis/feature-spec.md` before it suspends; a change asked for is applied
after the answers without another round.

**Without question sets** (`specification-sections`): every section is approved
as drafted and appended in order, still written to the depth a developer could
implement from; a section that cannot reach it without an answer says which
answer it needs rather than being padded to look finished.

**Depth verification, for a complex design.** Once every section is written,
re-read the whole file against the depth principle. For each thin section, draft
an enrichment, then ask about all of them in one question: *"Add these N
enrichments to the specification?"*, listing each one in a line — the section
and what it adds. Options: *"Accept all N enrichments (Recommended)"*, its
description saying the depth check found those sections short of
implementation-ready; *"Choose which to add"*, which opens a multi-select of the
enrichments, each labelled `(Recommended)`; *"Keep the sections as approved"*;
and **More details**.

**With question sets** (`depth-enrichment`): first-ask only (above); after the
sections' request, the default below.

**Without question sets** (`depth-enrichment`): every enrichment
is appended as drafted, marked as added by the depth check.

> **ANTI-PATTERN**: Do NOT skip the depth verification because each section was
> approved. Approval confirms direction; the verification is what makes the
> specification implementation-ready.

Then present a short summary of the specification, and hand
`analysis/feature-spec.md` to `maister-copilot:html-companion-writer` before this node's
completion write (*Run-scoped context*).

**Gate brief content.** A `headline` saying what the feature does and how many
sections specify it. In `summary`, the sections by name and what the feature
does in two sentences. In `decisions`, the scope boundaries and the key "how"
decisions, each `{decision, by: run}`, beside the operator's answers or the
defaulted entries; the direction chosen earlier is never restated as the
specification's. In `risks`, every answer a section said it still needs, each
`{risk, tag: open, change}`; a scope boundary drawn on purpose is
`tag: tradeoff`.

**When re-run after a revise.** Revise in place the sections the note reaches —
through the same per-section loop in a terminal run — keep every other section,
and run the depth verification again for a complex design. Say in the summary
which sections changed.

**Recovery budget**: one attempt — re-draft a section with a different approach.

---

## `visual-prototyping`

Delegated to the `mockup-studio` skill through the Skill tool, and
**guarded** on `prototyping_enabled`: it runs only for a UI-focused design. When
skipped, `specification-approval` still fires for the specification. The studio
runs design-resource discovery first and renders against what it found. Pass:

- the mockup format: `html` when `options.visual_enabled` is true, `ascii`
  otherwise;
- the output directory, full iteration and no index rows, as `with:` names them;
- the instruction to draw **user-facing wireframes of the feature's actual
  screens** — an "add item" form, an alert dialog, whatever the specification
  describes — never generic placeholders or technical diagrams;
- the specification and the design context; `analysis/design-decisions.md`
  **only when the state records `idea-convergence` completed** — in a simple run
  the specification's Approach section carries the direction; and the personas'
  journeys from `analysis/personas.md` **only when the state records
  `persona-exploration` completed**.

**The refinement loop is the studio's own, and it stays in the node**: screens
approved or revised one by one, re-rendered while the companion stays up — which
is why the gate after this node offers no revise of the prototypes.

**With question sets**: the same — refining mockups needs the browser companion
in session, so it is not carried as a question.

**Without question sets** (the studio's `mockup-refinement`): the studio reads
the driver from this run's state and degrades full iteration to a single pass on
its own, saying so in its notes. Put that note in this node's summary: a set of
screens nobody refined otherwise reads like a set somebody approved.

**Record** the studio's returned files in this node's summary, the companion's
status as `design_context.visual_companion`, what its discovery bound to as
`design_context.design_resources`, and the rounds as
`design_context.refinement_iterations.prototypes`.

**Gate brief content: the gallery pointer.** When the studio reports a live
gallery address, put it, verbatim, in this node's `headline` — the screens drawn
and where to see them — and open its `summary` with it and the navigation the
operator has: a brief that has to trim keeps each summary's opening sentences.
When the companion never came up, say so plainly and name the saved files
instead. Never write an address that was never served.

**The companion stays up until the brief.** The operator reviews the screens at
`specification-approval`, so do not shut the server down here; `review-handoff`
does.

**When the stretch re-runs.** Re-invoke the studio with the revised
specification and regenerate only the screens the revision touches, reusing the
server still running.

**Recovery budget**: two attempts — restart the companion on the second; the
studio's fallback to terminal mockups is a recorded note, not a retry.

---

## `specification-approval`

**Unguarded**, closing the specification and — when they were drawn — the
prototypes, the gallery pointer among their summary; in a simple run it also
approves the approach the specification states. Its revise option re-runs the
stretch from `feature-specification` with the operator's note, so screens drawn
from a changed specification are redrawn from it. Screens alone are changed in
the studio's loop inside `visual-prototyping`.

---

## `review-handoff`

Executed inline and interactive. It assembles the product brief and the delivery
scope and asks for the brief's final approval. It runs on every path — embedded
or not, at either depth — because a parent reads what it writes.

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
3. **Write `outputs/product-brief.md` and `outputs/delivery-scope.yml`.** The
   scope's shape and rules are the umbrella skill's
   `references/delivery-scope.md`. When the project root holds a workspace
   manifest (`.maister/umbrella.yml`), every member its `members:` map declares
   goes either in scope, with its one-line statement, or out of scope, with its
   reason; a member is in scope when the specification changes something it
   owns. Order the members in scope by what consumes what, listing a
   prerequisite under `depends_on`. With no manifest the scope is one member,
   the repository, stating the feature in one line. Draw every statement from
   the specification and the design decisions — the decision record when the
   convergence ran, the Approach section otherwise — never from a guess about
   code nobody read. A revision of the brief's scope layer rewrites both files.
4. **Approve** — ask *"Approve the product brief?"*, the question naming its
   layers in a line. Options: *"Approve (Recommended)"*, its description *"the
   brief only restates approved sections"*; *"Revise a section"* and *"Add
   missing information"*, each description naming the section or the gap the run
   judges likeliest; and **More details** last.
   The question lists the brief's points, a line per layer, before the ask.
   On a change, revise the brief and ask again.

   **With question sets** (`brief-approval`): in this node's one request, the
   brief already written to `outputs/product-brief.md`.

   **Without question sets** (`brief-approval`): approve the brief, and record
   in its Open Questions / Risks that it was assembled without in-session
   review, naming every section no operator confirmed in session — the brief is
   what a development run is built from.
5. **Shut the mockup companion down** if `visual-prototyping` started one, by
   posting to the server's shutdown route.
6. **Hand the brief to `maister-copilot:html-companion-writer`** (*Run-scoped context*)
   after approval and before this node's completion write, so the companion
   shows the approved brief — never once per revision round.

No gate follows. `completion` follows unless the run is embedded.

**Node summary.** The `headline` names what was designed in a sentence; the
`summary` carries the delivery scope in one more — for instance *"two members in
scope, `api` before `web`; `mobile` left out"*.

**Recovery budget**: one attempt — re-assemble the brief and the scope from the
documents on disk.

---

## `completion`

Executed inline, writes no files, and runs only when this run is its own; the
guard skips it whenever the run is a sub-run of another.

**The hand-off to development.** Given this run's task directory, the
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

**No close-out while a choice is held.** When the freeze recorded
`orchestrator.classes_questions`, this node runs
`gate-brief --node=held-approval` before its closing patch and before any
close-out, as the engine's *Ending a dispatched run* says.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the wrap-up above; otherwise the run ends
`RUN-FAILED: closeout-unpublished`.

The workflow ends here; no gate follows.

**Recovery budget**: none — this node summarizes and nothing else.
