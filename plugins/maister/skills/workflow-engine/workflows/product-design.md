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
| `visual-prototyping`, unless the decision turns on layout or presentation | the intake judges that, says why, and records `prototyping_enabled` from it; the operator can override it in the intake's request |

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

**Does.**

1. **Initialize** as the framework's *Initialization Steps* say.
   Set `options.mockup_format`
   (default `html`) and `options.visual_enabled`: false when `no_visual` is
   true or the format is `ascii`. Write `context/README.md`, inviting the
   operator to drop relevant files there.
2. **Read the project documentation** the docs index lists, if one exists.
   Record the paths as `project_context.project_doc_paths` (top level, beside
   the orchestrator and context blocks) and a few lines on them as
   `design_context.project_context_summary`.
3. **Import research** the `research` input names: its report, synthesis and
   solution exploration, where they exist, brought under
   `context/research-context/` in one `import` call (engine § *The invocation
   contract*), never a shell copy. Record `design_context.research_reference`
   with the source path. Research is supporting context: a source the verb
   skips becomes `{risk: "research not imported: <each skipped file and its reason>", tag: open, change: "read it at <source path>"}`,
   and the design goes on, citing the research at its source path. Never ask
   anybody to copy it in.
4. **Detect the characteristics** and the complexity as
   `${CLAUDE_PLUGIN_ROOT}/skills/product-design/references/characteristic-detection.md`
   says; read it first. Record the six flags as
   `design_context.design_characteristics` (*The context block*). **When
   `simple` is true the depth wins** (*Depth*): record `simple`, and when the
   signals said more, add
   `{risk: "detected as <level>; the simple depth was requested", tag: open, change: "run the full design"}`.
   **When `full` is true**, record `complex` and say so in the summary. When
   both are true, `simple` wins, and `risks` carries
   `{risk: "both the simple and the full depth were requested; the simple design ran", tag: open, change: "run again with only the full depth"}`.
5. **Ask for additional context**: *"Any additional context for this
   design?"*, a multi-select — *"No additional context (Recommended)"*, going
   on from the description, the docs and any research; *"Files"*, naming
   `<task path>/context/` and asking for the files there before answering;
   *"Links"* and *"Topics to research"*, typed one per line in the free-text
   answer. Nothing ticked is the recommended answer. Catalog `context/` into
   `design_context.user_files_list`; sort what was typed into
   `collected_urls` and `research_topics`. When Files was chosen and the
   folder is still empty, ask once more, naming the folder: *"Go on without
   files (Recommended)"* or *"I have added the files; read the folder again"*.
   *Files* and the read-again option each say a person put files in the
   folder, so both are marked `person_act` and neither is ever recommended
   (`references/in-node-questions.md` § *An option only a person can take*).
   **A simple run asks a second question in the same request**, the mockup
   override: *"Draw mockups of the screens?"*, with *"Draw the screens"* and
   *"No screens"*, the intake's mockup judgment (step 6, made with the
   detection in step 4) recommended and its reason
   in that option's description. The answer decides `prototyping_enabled`.
<!-- plain-picker
   Under this picker the four options are one property of type array, none of them the default, and
   the links and topics a text property beside it; a simple run's mockup override is an enum
   property of its two options, the judgment its default.
-->
6. **Record the three values** in the patch that marks the node `completed`,
   since they guard later nodes: `personas_enabled` (greenfield or complex),
   `prototyping_enabled` (UI-focused) and `complexity_level`. A simple run
   records `personas_enabled` false, and judges `prototyping_enabled` by
   whether the decision turns on how something looks or is laid out — placing,
   grouping or showing information on a screen, comparing layouts, a new screen
   or card — rather than on behaviour, data, policy or wording only; the
   override in step 5 has the last word. A full run records
   `personas_enabled` true.

A simple run skips `characteristics-approval`; the characteristics are still
recorded, and the brief names them.

**Asks.**

**With question sets** (`additional-context`, and `mockups` in a simple run):
asked in this node's one request. A folder still empty after a Files answer is not asked about again,
and the run goes on without files.

**Without question sets** (`additional-context`, `mockups`): no additional context; the
lists stay empty rather than half-gathered. In a simple run the mockup
judgment stands.

**Summary.** A `headline` naming the kind of design, its complexity and which
optional parts will run. In `summary`, each characteristic that holds with its
one-line rationale; a simple run adds the mockup choice and its reason, e.g.
*"Mockups: yes — the options differ in card layout"*, naming an override. In `risks`, each characteristic detected on thin evidence
as `{risk, tag: open, change}`, its `change` the correction, so the gate's
revise offers it.

**Re-run.** The note is the correction. Do not create the task directory or
state, or import the docs or research, again. Apply the note, keeping the
exclusive pairs consistent, and derive the complexity again; a thin-evidence
risk it settles is written `tag: resolved`. Say which optional parts now run.

**Budget.** In a terminal run, a description too thin to classify is clarified
with one question offering two or three readings, the closest first and
recommended. A driven run classifies at the higher complexity and names that in
`risks`.

---

## `context-synthesis`

**Does.**

1. **For an enhancement**, run the `maister:codebase-analyzer` skill through
   the Skill tool with this task's path; it writes
   `analysis/codebase-analysis.md`. Continue here when it returns.
2. **Read every file** in `context/` and **fetch every link** in
   `design_context.collected_urls`.
3. **Research each topic** in `design_context.research_topics` through a
   `maister:information-gatherer` agent per topic, launched in parallel through
   the Task tool with the topic and its scope, plus the `run-context` output.
4. **Write `analysis/design-context.md`**, synthesising every source — the
   docs, the codebase summary, each file's and link's takeaways, the research —
   with the connections between them and what they imply for the design.

**Summary.** A `headline` giving the finding that most shapes the design and
how many sources fed it. In `summary`, the two or three key findings. In
`decisions`, the implications for the design, each `{decision, by: run}`. In
`risks`, what the synthesis left open — an unsettled choice, an inferred
constraint, a thin source, a source that would not load, an unsettled topic —
each `{risk, tag: open, change}`. The node entry adds `sources_count`.

**Re-run.** Read a file or fetch a link the note adds, research a topic it
adds or reopens, and run the codebase analysis again only when the note is
about the codebase.

**Budget.** The second attempt re-invokes the codebase analyzer or the
information gatherer with adjusted context.

---

## `problem-exploration`

**Does.** Read
`${CLAUDE_PLUGIN_ROOT}/skills/product-design/references/interaction-patterns.md`
first — the modes, the question design and the refinement loop. Read
`analysis/design-context.md` in full, then the `open` risks in `prior-context`
and the open questions of any research under `context/research-context/`.

1. **Explore** in pages of context-aware questions, as many as
   `characteristic-detection.md` sets for the complexity, folding each page's
   answers in before the next. Questions about one behaviour are one drafted
   story (engine `references/in-node-questions.md`), id `user-story-<topic>`,
   asked in the same pages.
2. **Converge** on the complete draft: the problem statement, the key
   constraints and the success criteria.
3. **Refine** — ask *"Use this problem statement?"*, the question giving the
   statement in a sentence or two. Options: *"Approve (Recommended)"*, its
   description saying what the draft settles; *"Change the scope"* and *"Change
   constraints or success criteria"*, each naming the likeliest change, from the
   weakest assumption; and **More details** last.
<!-- rich-picker -->
   The approve option's preview holds the draft: the problem statement, the
   constraints and the success criteria.
<!-- /rich-picker -->
<!-- plain-picker
   The question lists the constraints and the success criteria, one line each, after the statement.
-->
   On a change, revise and ask again, counting rounds in
   `design_context.refinement_iterations.problem_statement` against the soft cap.

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
statement and the number of constraints and success criteria. In `decisions`,
the scope choices settled, each `{decision, by: run}`. In `risks`, the
assumptions the statement rests on, each `{risk, tag: open, change}` — a story
taken as drafted is one, its `change` the correction listed for it; a need left
out on purpose is `tag: tradeoff`. The node entry adds `problem_statement`,
`constraints` and `success_criteria`.

**Re-run.** A note about the personas alone leaves this document unchanged —
say so in the summary and let `persona-exploration` take it.

**Budget.** Re-phrase a question the operator's answer left unclear.

---

## `persona-exploration`

**Does.**

1. **Explore** the user types — goals, pain points, how they discover the
   feature — in pages of independent questions.
2. **Converge** on one to three persona cards, by complexity: name, role, goals,
   pain points and the key journey.
3. **Refine** — ask *"Use these personas?"*, naming each persona and role in a
   line. Options: *"Approve (Recommended)"*, saying what the set covers;
   *"Change a persona"*, *"Add a persona"* and *"Remove a persona"*, each naming
   the persona and the likeliest change. The question ends with
   `Type "details" for the full cards.`
<!-- rich-picker -->
   The approve option's preview holds the cards, each with its goals, pain
   points and key journey.
<!-- /rich-picker -->
   On a change, revise and ask again, counting rounds in
   `design_context.refinement_iterations.personas` against the soft cap.

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

**Summary.** A `headline` covering the problem and the personas, since
`problem-approval` closes both. In `summary`, each persona's name and role. In
`decisions`, what set them apart, each `{decision, by: run}`. In `risks`, a
user type left out on purpose, `tag: tradeoff`, or one left unsettled,
`tag: open` with the `change` that would add it. The node entry adds
`personas` and `user_journeys`.

**Re-run.** When the problem statement changed, check every card still fits
it.

**Budget.** Re-present the personas with adjusted framing.

---

## `idea-generation`

**Does.** **Deliberately non-interactive**: alternatives generated outside the
conversation are not anchored on its first idea. Also hand the brainstormer:

- the design characteristics from state;
- `analysis/personas.md` **only when the state records `persona-exploration`
  completed**;
- the instruction to read its inputs in full and to group the alternatives by
  decision area, with a recommendation for each;
- the absolute path of
  `${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/references/decision-areas.md`,
  the areas file's shape — it cannot expand the variable itself.

A return without alternatives in `analysis/alternatives.md` is re-invoked with
corrected context. After a second failure, ask *"Idea generation failed twice:
<cause>. Try again?"* — *"Try once more (Recommended)"*, saying why it may work
now, or *"Draft the alternatives here"*, warning that they would be anchored on
the ideas already discussed.

**Asks.**

**With question sets** (`brainstormer-retry`): first-ask only: it goes in a
request only as the first thing this node asks in its attempt.

**Without question sets** (`brainstormer-retry`): neither. The node is recorded
`failed`; inline alternatives are exactly the anchoring this node avoids, and a
re-drive is the operator's route back in.

**Writes.** A missing `analysis/decision-areas.json` (`areas_path: null`, the
reason in the agent's warnings) is never re-driven for. A written one goes on
the summary's artifacts with `role: evidence`.

**Summary.** The number of decision areas (from the areas file when there is
one) and of alternatives, and each area's recommendation, in `summary` and
**never in `decisions`**: a recommendation is not a decision. The node entry
adds `alternatives_count`.

**Re-run.** Hand the brainstormer the note and the existing
`analysis/alternatives.md` to revise in place with fresh alternatives, listing
the ones already explored as considered.

---

## `idea-convergence`

**Does.** Read the interaction-patterns reference first if this session has
not, then ask the decision areas as engine `references/in-node-questions.md` §
*Decision areas from the brainstorm* says. On a `decision-areas-*` warning,
compose every area from `analysis/alternatives.md`, recording each answer as
`convergence-decisions-<the area's name as a slug>`. Then summarise the chosen
direction across the areas, for `direction-approval`.

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

**Summary.** With a choice made: a `headline` naming the direction, the
direction across the areas in `summary`, and the trade-offs it accepts in
`risks`, each `tag: tradeoff`. Without question sets: the items above, and a
`headline` and `summary` saying the direction is proposed and how many areas
await a choice. The node entry adds `selected_approach`,
`trade_offs_accepted` and `decision_areas` — each element `area`,
`alternatives_count`, `recommended` and `chosen_approach`. Every area is in
`decision_areas`; a dropped area is a defect to resolve before completing.

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

**Does.** Authored here, section by section with the operator — never drafted
whole for one approval, never delegated to the specification creator.

Read the direction first. When the state records `idea-convergence` completed,
read `analysis/design-decisions.md`; for a decision sheet with areas left open,
a continue recorded at `direction-approval` means every recommendation was
adopted, and the Key Decisions say so, naming who answered.

A simple run (*Depth*) has no decision record: the first section is
**Approach** — the direction in a paragraph, and the one or two alternatives
passed over, a line each with why. Its choices go in `decisions` as
`{decision, by: run}`; one made on thin evidence is an `open` risk with the
other way as its `change`.

Write the user stories from `analysis/problem-statement.md` first, under **User
stories**, each by its id and whole; they are not asked again. Each section
names the stories it serves. A story the direction changes is restated as
changed; it, and any story no section serves, is an `open` risk, never a drop.

Scale the sections to the complexity, as `characteristic-detection.md` §
*Adaptive Depth Scaling* sets.

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
2. Ask *"Approve the <section> section?"*, saying in a line what it settles.
   Options: *"Approve (Recommended)"*, saying why it is implementation-ready;
   *"Add more detail"*, *"Change its scope"* and *"Rethink it"*, each naming the
   likeliest change. The question ends with
   `Type "details" for the full section.`
<!-- rich-picker -->
   The approve option's preview holds the section as its points — every entity,
   interface, state or rule it settles, a line each — within 1,800 characters.
<!-- /rich-picker -->
<!-- plain-picker
   The question lists the section's points, a line each, before the ask.
-->
   On a change, revise and ask again, counting rounds per section in
   `design_context.refinement_iterations.specification_sections`.
3. **On approval, append the section to `analysis/feature-spec.md` at once** —
   the file, not the conversation, is the source of truth.

**Depth verification**, for a complex design, runs even though each section was
approved: approval confirms direction, the check makes it implementation-ready.
Re-read the whole file against the depth principle, draft an enrichment for
each thin section, and ask once: *"Add these N enrichments to the
specification?"*, a line per enrichment — the section and what it adds.
Options: *"Accept all N enrichments (Recommended)"*; *"Choose which to add"*,
opening a multi-select of them, each labelled `(Recommended)`; *"Keep the
sections as approved"*; and **More details**.

Then present a short summary of the specification.

**Asks.** Each section's answer is its own decision, `question_id`
`specification-sections-<section>`.

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
specify it. In `summary`, the sections by name and the feature in two
sentences. In `decisions`, the scope boundaries and key "how" decisions, each
`{decision, by: run}`, never restating the earlier direction. In `risks`, every
answer a section still needs, `tag: open`; a scope boundary drawn on purpose,
`tag: tradeoff`. The node entry adds `spec_sections` and `sections_count`.

**Re-run.** Revise the sections the note reaches through the per-section loop
in a terminal run, and verify depth again for a complex design.

**Budget.** Re-draft a section with a different approach.

---

## `visual-prototyping`

**Does.** Pass the studio:

- the mockup format: `html` when `options.visual_enabled` is true, `ascii`
  otherwise;
- the instruction to draw **user-facing wireframes of the feature's actual
  screens**, as the specification describes them — never generic placeholders
  or technical diagrams;
- `analysis/design-decisions.md` **only when the state records
  `idea-convergence` completed** (in a simple run, *Depth*, the
  specification's Approach section carries the direction), and the personas'
  journeys from `analysis/personas.md` **only when the state records
  `persona-exploration` completed**.

The refinement loop is the studio's own, inside this node. Leave the companion
up: the screens are reviewed at `specification-approval`, and `review-handoff`
shuts it down.

**Asks.**

**With question sets**: the same — refining mockups needs the browser companion
in session, so it is not carried as a question.

**Without question sets** (the studio's `mockup-refinement`): the studio
degrades full iteration to a single pass on its own and says so in its notes.
Put that note in this node's summary.

**Writes.** Record the companion's status as `design_context.visual_companion`,
what its discovery bound to as `design_context.design_resources`, and the
rounds as `design_context.refinement_iterations.prototypes`.

**Summary.** When the studio reports a live gallery address, put it verbatim
in the `headline` with the screens drawn, and open `summary` with it and how to
navigate — a trimmed brief keeps opening sentences. When the companion never
came up, say so and name the saved files; never write an address never served.
The node entry adds `mockup_references`, the studio's returned files.

**Re-run.** Re-invoke the studio with the revised specification and regenerate
only the screens the revision touches, reusing the server still running.

**Budget.** Restart the companion on the second attempt; the studio's fallback
to terminal mockups is a recorded note, not a retry.

---

## `review-handoff`

**Does.** Runs on every path, because a parent reads what it writes
(*Embedded mode*).

1. **For a complex design, check the specification once more**: each section
   answers what to build and how. A gap is named in the brief's Open Questions
   / Risks and in `risks`; it does not send the run back.
2. **Assemble the layered brief** from the documents on disk, pointing at them
   rather than repeating them:
   - **Core brief**, always: the problem statement, the target users, the
     feature overview, the constraints, the success criteria and the acceptance
     criteria, condensed; and the user stories from the specification, each by
     its id and whole — never condensed;
   - **Persona cards**, when the state records `persona-exploration` completed;
   - **Design decisions**, a summary per decision area, pointing at the decision
     record and the alternatives, when the state records `idea-convergence`
     completed; in a simple run (*Depth*), the specification's Approach
     section condensed;
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
   every statement from the specification and the design decisions, never
   from a guess about code nobody read.
4. **Approve** — ask *"Approve the product brief?"*, naming its layers in a
   line. Options: *"Approve (Recommended)"*, described *"the brief only
   restates approved sections"*; *"Revise a section"* and *"Add missing
   information"*, each naming the likeliest section or gap; and **More
   details** last.
<!-- rich-picker -->
   The approve option's preview holds the brief as its points, a line per
   layer and per key decision, within the preview's limit.
<!-- /rich-picker -->
<!-- plain-picker
   The question lists the brief's points, a line per layer, before the ask.
-->
   On a change, revise the brief and ask again.
5. **Shut the mockup companion down** if `visual-prototyping` started one
   (`POST /shutdown`).

**Asks.**

**With question sets** (`brief-approval`): in this node's one request, the
brief already written to `outputs/product-brief.md`.

**Without question sets** (`brief-approval`): approve the brief, and record
in its Open Questions / Risks that it was assembled without in-session
review, naming every section no operator confirmed in session — the brief is
what a development run is built from.

**Writes.** `outputs/delivery-scope.yml` carries its fixed shape and no
artifact summary block. The brief's HTML page is written once, after approval.

**Summary.** The `headline` names what was designed; the `summary` gives the
delivery scope in a sentence — *"two members in scope, `api` before `web`;
`mobile` left out"*. The node entry adds `brief_layers`.

**Budget.** Re-assemble the brief and the scope from the documents on disk.

---

## `completion`

**Does.** The hand-off to development, whose intake copies the brief and the
mockups from this task directory. A delivery spanning several repositories is
one development run per member in scope, in `depends_on` order.

**Close** with the engine's wrap-up (engine § *Operator visibility*): Done
names what was designed, Needs you each `missing-artifact:` and
`missing-companion:` line in plain words, Files the brief and the scope.
**Next** carries this next step exactly, inventing no other command:

```
Product brief approved and saved to: [task-path]/outputs/product-brief.md

To start development based on this design, clear context first or start a new session, then run:
/maister:development [task-path]
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
