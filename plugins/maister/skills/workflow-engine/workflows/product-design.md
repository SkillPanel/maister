# Product design workflow — node prose

The node-by-node companion to `product-design.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need, what guards them and what they declare. It says
nothing about the operator questions asked *inside* a node, what each node
writes into its closing summary for the gate brief, the self-checks that decide
whether a node succeeded, or how many times the engine may re-drive one. Those
live here.

**State the consequence plainly**: a reader of `product-design.yml` alone cannot
see that the run asks thirteen further questions beyond its five gates — and the
mockup studio runs a refinement loop of its own inside the prototyping node. The
generated diagram does not show them either. This is the most interactive
workflow in the plugin; anyone reasoning about how interactive it is must read
this file, not the graph.

**Every question asked inside a node names its default here.** Under a `cockpit`
or `dispatch` driver nobody is in the session, so none of them is asked: each
takes the default its own section states and the node records that it did. The
rule, the recording shape and what is never defaulted past belong to the engine
skill, which states them once; this file only says what each question takes.
One question is the exception the workflow makes on purpose: the convergence on
a design direction is never defaulted. Under a driver it is left open for the
direction gate to decide, because a direction nobody chose would be built into
every document after it (`idea-convergence` says how).

**Say plainly what a driven run produces.** This workflow is collaborative by
design: its exploration questions and refinement loops are not overhead around
the work, they *are* the work. A run under a `cockpit` or `dispatch` driver
takes every default below, so the problem statement, the personas, the
specification and the brief are drafts no operator shaped in session, and the
five gates are the only place an operator shapes them. Record that in the
artifacts rather than leaving it to be inferred: a document that does not say it
was drafted without review reads exactly like one that was reviewed.

**Recovery budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — an attempts key sitting
there would read like a grammar feature while being inert data the engine never
consults.

**A skip does not cascade, and two gates are unguarded on purpose.** The persona
exploration and the visual prototyping are guarded; a node whose guard is false
is skipped and still satisfies everything downstream. The gate after each of
them is not guarded, because each closes more than that node: `problem-approval`
closes the problem statement as well as the personas, and
`specification-approval` closes the specification as well as the prototypes. A
gate guarded like the node before it would let the problem statement or the
specification pass unreviewed whenever that node was skipped.

## The phase numbers, and where they went

The 2.x prose form of this workflow numbered its phases 0 to 8, but no gate
question names a phase number. This table maps the 2.x prose form's phases to
nodes:

| 2.x phase | Node | Closing gate |
|---|---|---|
| 0 | `intake` | `characteristics-approval` |
| 1 | `context-synthesis` | `context-approval` |
| 2 | `problem-exploration` | `problem-approval`, shared with the personas |
| 3 | `persona-exploration` | `problem-approval` |
| 4 | `idea-generation` | none — it continues into the convergence |
| 5 | `idea-convergence` | `direction-approval` |
| 6 | `feature-specification` | `specification-approval`, shared with the prototypes |
| 7 | `visual-prototyping` | `specification-approval` |
| 8 | `review-handoff` | none — the brief's approval is asked inside the node, and the workflow ends |

The two back-edges of the 2.x prose form are not loops here. Its "explore more"
from the convergence back to the brainstorm is the `direction-approval` option
`explore-more-alternatives`. Its return from the review to the specification when
the specification is thin is gone: the specification's own depth check and the
revise on `specification-approval` come first, and a gap the review still finds
is named in the brief as an open risk rather than sending the run backwards
after its last gate.

A gate question is authoring-time constant and covered by the graph hash, so it
cannot say where the run is really going; the gate brief's `Next:` line names
the node that actually runs, with the skipped ones listed (engine § Gates).

---

## Run-scoped context

The four fields every delegate receives outside `with:` — `task_path`,
`html_style_guide_path`, the project's documentation paths and the prior-phase
passage fetched with `prior-context` — and the `${…}` substitution that fills
`with:` are the engine's, stated once in engine § *Run-scoped context* and
§ *Interpolating `${…}`*. What this workflow adds:

- **`task_path`** sits under the type directory `product-design/`.
- **The documentation paths** are discovered by `intake` and recorded as
  `project_context.project_doc_paths`; every later node reads them from state.
- **Nothing is interpolated from a node a guard may skip.** The personas and the
  prototypes are read from disk, and only when the state records their node
  `completed`. A node that reads one says so in its own section.
- **Four artifacts get an HTML companion** when `html_output` is on. The
  brainstormer writes its own for `analysis/alternatives.md`, because it is
  handed the style guide path. The other three are written inline by a
  `direct:` node, so each gets its companion from the
  `maister:html-companion-writer` agent, invoked through the Task tool once the
  markdown is final: `analysis/design-decisions.md`,
  `analysis/feature-spec.md` and `outputs/product-brief.md`. Pass the
  markdown path, the style guide path, a label for the artifact and the sibling
  reports that exist, for the breadcrumb. Register the returned path under
  `artifacts[].html` on the summary entry that owns the artifact. A companion
  that fails never blocks the run: keep the markdown and say so in the summary.
  When `html_output` is false, invoke none and pass no style guide path.
- **Every artifact a node writes inline opens with the artifact summary
  contract** (framework § 7): TL;DR, Key Decisions and Open Questions / Risks.

> **ANTI-PATTERN**: Do NOT re-summarize a summary block. `decisions` and `risks`
> are copied out of the artifact's own Key Decisions and Open Questions / Risks
> blocks **item for item** — the same count, the same words, the artifact's
> order — into `phase_summaries`, into `node_summaries` and into the dashboard.
> Rewriting them in your own words loses the sentence the operator is about to
> approve at a gate; writing an empty `[]` because the node has already read
> the artifact loses it outright.

---

## The context block

The block is `design_context` — the name the state writer maps this workflow
to — and this workflow writes no other context block. A run whose state carries
a second one is a run two interpreters wrote, which the state contract refuses
out loud rather than merging.

| Key | Written by | Holds |
|---|---|---|
| `design_characteristics` | `intake` | the six characteristics as confirmed — `is_greenfield`, `is_enhancement`, `is_ui_focused`, `is_backend`, `is_complex`, `is_simple` |
| `complexity_level` | `intake` | `simple`, `standard` or `complex` |
| `collected_urls`, `research_topics`, `user_files_list` | `intake` | what the operator supplied as extra context; empty lists when nothing was |
| `research_reference` | `intake` | `{path, research_question}` of a research task named on invocation |
| `project_context_summary` | `intake` | a few lines on what the project documentation says |
| `refinement_iterations` | each looping node | rounds taken: `problem_statement`, `personas`, `direction`, `specification_sections` (a map by section), `prototypes` |
| `visual_companion` | `visual-prototyping` | `{available, port, pid, fallback_to_ascii}` as the mockup studio reported it |
| `design_resources` | `visual-prototyping` | what the studio's design-resource discovery bound to |
| `phase_summaries` | the mirroring nodes | see below |

The run's options live under `orchestrator.options`: `html_output`,
`mockup_format` and `visual_enabled`, the last derived by `intake`.

---

## Phase summary keys

`node_summaries` is keyed by node id; `design_context.phase_summaries` is keyed
by this workflow's own semantic keys — the keys the 2.x prose form wrote, kept so
a reader of either finds the same names. Eight nodes mirror their summary:

| Node | `phase_summaries` key | Fields beside the shared shape |
|---|---|---|
| `context-synthesis` | `context_synthesis` | `sources_count` |
| `problem-exploration` | `problem_exploration` | `problem_statement`, `constraints`, `success_criteria` |
| `persona-exploration` | `persona_exploration` | `personas`, `user_journeys` |
| `idea-generation` | `idea_generation` | `alternatives_count` |
| `idea-convergence` | `idea_convergence` | `selected_approach`, `trade_offs_accepted`, `decision_areas` |
| `feature-specification` | `feature_specification` | `spec_sections`, `sections_count` |
| `visual-prototyping` | `visual_prototyping` | `mockup_references` |
| `review-handoff` | `review_handoff` | `brief_layers` |

`intake` writes a node summary only. Each mirrored entry also carries `node:`
naming the node it came from, so the two directions stay readable from either
side. A phase key is never a node id, and writing one off the node id succeeds
and leaves a key nothing else reads, which is why the mapping is pinned here.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `intake` | `analysis` |
| `context-synthesis` | `analysis` |
| `problem-exploration` | `analysis` |
| `persona-exploration` | `analysis` |
| `idea-generation` | `plan` |
| `idea-convergence` | `plan` |
| `feature-specification` | `spec` |
| `visual-prototyping` | `spec` |
| `review-handoff` | `done` |

The five gates are not in that table on purpose: **each gate node renders the
icon of the node it closes** — `characteristics-approval` and
`context-approval` `analysis`, `problem-approval` `analysis`,
`direction-approval` `plan`, `specification-approval` `spec`. A gate inherits
rather than owns its icon, so a gate that picked its own would break the visual
pairing between a stretch and the approval that closes it.

---

## Embedded mode

**There is none.** This workflow is never invoked as a sub-run of another, which
is why the definition declares no embedded input and no workflow-level outputs.
Its result reaches the development workflow by path, not as a child: an operator
passes this run's task directory to the development command, and development's
intake copies the brief and the mockups from it. That hand-off reads two paths —
`outputs/product-brief.md` and `analysis/mockups/` — which is why the artifact
layout here is a contract and does not move.

If that ever changes, it changes here first, and it is the recipe the engine's
sub-run rule already sets out: an `embedded` input the engine supplies, a guard
on the closing node and a workflow-level `outputs:` block. No engine change is
involved; see the engine skill's *Sub-runs* section and the `sub-runs.md`
reference beside it.

---

## `intake`

Executed inline and interactive. It establishes the task directory and the
state, detects the design characteristics that decide which later nodes run,
and gathers whatever extra context the operator has.

1. **Capture the clock** — read the wall clock through the shell rather than
   from context. Every timestamp written this turn uses that one value; a
   date-only or midnight-stamped value is the documented failure mode.
2. **Create and initialize** the task directory under the `product-design/`
   type directory and its state, with an empty `phase_summaries` map under
   `design_context` — the state writer seeds it on the first context write.
   Create `context/`, with a `README.md` telling the operator to drop relevant
   files there — meeting notes, existing designs, spreadsheets, documents, PDFs,
   images — and `analysis/` and `outputs/`.
3. **Read the project configuration** and set `options.html_output` (default
   true when the file or the key is absent) and `options.mockup_format` (default
   `html`). Derive `options.visual_enabled`: false when the `no_visual` input is
   true or the mockup format is `ascii`, true otherwise — the flag is a per-run
   override of the setting, and both mean terminal mockups. When `html_output`
   is false, skip the dashboard entirely — no dashboard asset, no data
   projection, no browser open. Otherwise the freeze installed `dashboard.html`
   in the task root (see the changed paths it reported) — copy nothing; **run
   the platform opener** on the plain absolute path through the shell — `open
   "<task path>/dashboard.html"` on macOS, `xdg-open` on Linux, `start ""` on
   Windows. Never build a `file://` URL. On failure print the path; never block.
4. **Relay the startup banner the freeze printed** (engine Step 4) if it is not
   already on screen; compose none.
5. **Discover the project documentation** — read the documentation index under
   the project's docs directory if one exists, extract every path from its
   project-documentation section, predefined and operator-added alike, and read
   them. Record the paths as `project_context.project_doc_paths`, a top-level
   sibling of the orchestrator and context blocks, and a few lines on what they
   say as `design_context.project_context_summary`.
6. **Import research** when the `research` input names a completed research
   task: read its report, its synthesis and its solution exploration where they
   exist, copy them under `context/research-context/`, and record
   `design_context.research_reference` with the path and the research question.
   When no research was named, the directory is not written, and that absence is
   sanctioned: record `absent: {research_context: "no research task was named"}`.
7. **Detect the design characteristics.** Read the characteristic-detection
   reference first,
   `${CLAUDE_PLUGIN_ROOT}/skills/product-design/references/characteristic-detection.md`.
   Detect the six characteristics from the description and the codebase signals,
   and derive the complexity: `simple` when the design is simple, `complex` when
   it is complex or greenfield, `standard` otherwise. When the signals are mixed,
   lean to the higher complexity.
8. **Ask for additional context** — *"Do you have additional context to
   provide?"* — with options for files to drop into `context/`, links to
   reference, topics to research on the web, more than one of those, and no
   additional context. Follow the answer: for files, tell the operator the
   folder, wait for their confirmation, then read and catalog what they dropped
   into `design_context.user_files_list`; for links, collect them in one
   question into `design_context.collected_urls`; for research topics, collect
   them into `design_context.research_topics`.

   **Default under a non-terminal driver** (`additional-context`): no
   additional context; the run proceeds on what the invocation, the research
   input and the project documentation supply. The three collectors are
   unreachable anyway — dropping files and confirming needs somebody at the
   keyboard — so the lists stay empty rather than half-gathered.
9. **Confirm the characteristics** — present each detected characteristic with
   its rationale and ask *"I detected these design characteristics. Please
   confirm or correct:"*, with options to accept them, to correct them, and to
   explain your thinking. Apply any correction before anything reads them; they
   are set once and do not change later in the run.

   **Default under a non-terminal driver** (`characteristics-confirmation`):
   the characteristics stand as detected, with no override. They decide which
   nodes run, so the rationale for each goes into this node's summary, where
   `characteristics-approval` shows it.
10. **Record the outcome**: the characteristics, the complexity level and the
    collected context under `design_context`, and this node's three declared
    values — `personas_enabled` true when the design is greenfield or complex,
    `prototyping_enabled` true when it is UI-focused, and `complexity_level`.
    Those values are what guard the persona and prototyping nodes, so write
    them in the same patch that marks the node `completed`.

**Gate brief content.** Into this node's closing summary: in `summary`, each
characteristic that holds, with its one-line rationale, the complexity level,
and in plain words which optional stretches will run — "personas will be drafted;
no screens to prototype". In `decisions`, a correction the operator made, or the
two `defaulted:` entries. In `risks`, any characteristic detected on thin
evidence, as an `open:` item, so an operator who disagrees sees it before the
run builds on it.

**Recovery budget**: one attempt — in a terminal run, ask the operator to
clarify a description too thin to classify. A driven run does not fail on one:
it classifies at the higher complexity, as the detection guidance says, and
names that in `risks`.

---

## `characteristics-approval`

A gate. Ask it as engine § Gates says — the gate brief, then the definition's
`ask:` — record the answer, and stop the run on the stop option — nothing after
a stopped node ever becomes ready.

It has no revise option, because the characteristics are not a document: they
are corrected inside `intake`, at its confirmation question, before this gate
fires. An operator answering from outside who finds them wrong stops here and
starts a new task whose description says what the design is.

---

## `context-synthesis`

Executed inline, delegating the codebase and the web. It turns every context
source into one document the later nodes read in full.

1. **For an enhancement**, delegate the codebase analysis to the
   `maister:codebase-analyzer` skill through the Skill tool, with this task's
   path, rather than reading the project yourself — it keeps raw exploration out
   of this conversation and writes `analysis/codebase-analysis.md`. When the
   skill returns, continue with this node. For a greenfield design there is no
   codebase to analyse; the artifact is not written, and that absence is
   sanctioned: record `absent: {codebase_analysis: "a greenfield design has no
   codebase to analyse"}`.
2. **Read every file** in `context/`, whatever the operator dropped there.
3. **Fetch every link** in `design_context.collected_urls`.
4. **Research each topic** in `design_context.research_topics` through a
   `maister:information-gatherer` agent per topic, launched in parallel through
   the Task tool with the topic, its scope and the task path — it keeps raw
   findings out of this conversation.
5. **Write `analysis/design-context.md`**, synthesising every source: the
   project documentation (vision, roadmap, stack, architecture and any
   operator-added documents), the codebase summary for an enhancement, the
   key takeaways of each supplied file and link, the research findings, the
   connections between sources, and what all of it implies for the design.
6. **Ask for corrections** — *"Context synthesis complete. Key findings: …
   Any corrections or additions before we explore the problem space?"*, with the
   two or three key findings in the question. Fold any correction into the
   document.

   **Default under a non-terminal driver** (`context-corrections`): none; the
   synthesis stands as written. `context-approval` carries the same key
   findings, so an operator corrects them there.

**Gate brief content.** In `summary`, the two or three key findings and how many
sources fed them; in `decisions`, the implications for the design; in `risks`,
the gaps — a source that could not be read, a link that would not load, a topic
the research could not settle.

**Recovery budget**: two attempts — re-invoke the codebase analyzer or the
information gatherer with adjusted context on the second.

**Phase summary key**: `context_synthesis`, with `sources_count` and `node:
context-synthesis`.

---

## `context-approval`

A gate. Ask it as engine § Gates says, record the answer, and stop the run on
the stop option. It has no revise option: the synthesis is corrected inside its
node, at the corrections question.

---

## `problem-exploration`

Executed inline and interactive. Read the interaction-patterns reference first,
`${CLAUDE_PLUGIN_ROOT}/skills/product-design/references/interaction-patterns.md`
— the exploration and convergence modes, the refinement loop and how its options
are designed. Read `analysis/design-context.md` in full, not only its summary,
so every question can be specific to this project.

1. **Explore.** Announce exploration mode, then ask context-aware questions
   **one at a time** — two or three for a simple design, four to six for a
   standard one, eight to ten for a complex or greenfield one. After each answer,
   synthesise what you heard before asking the next, so the operator can see it
   was integrated and correct a misreading before it compounds.

   **Default under a non-terminal driver** (`problem-questions`): no question is
   asked, and the draft is derived from the design context, the description and
   the project documentation alone. Mark it in the document as a proposal: a
   problem statement built without the operator's answers is one, and saying so
   is the difference between a gate an operator reads carefully and one they
   wave through.
2. **Converge.** Announce the switch, then present the complete draft: the
   problem statement, the key constraints and the success criteria.
3. **Refine** — ask with options to approve and continue, to change the problem
   scope, the constraints or the success criteria, to rethink the approach, and
   to explain your thinking. On a change, present the complete revised draft and
   ask again; count each round in
   `design_context.refinement_iterations.problem_statement`. After the soft cap
   — two rounds for a simple design, three otherwise — the options shift to
   encourage approval, and the operator can still take one more round.

   **Default under a non-terminal driver** (`problem-refinement`): approve and
   continue — no round is taken and the count stays at zero.
   `problem-approval` is the operator's route back.
4. **Write `analysis/problem-statement.md`**: the approved problem statement,
   constraints, success criteria and the key assumptions behind them — the full
   exploration, which the brief later condenses.

**Gate brief content.** In `summary`, the problem statement in a sentence or
two, and the number of constraints and success criteria; in `decisions`, the
scope choices the exploration settled, or the `defaulted:` entries; in `risks`,
the assumptions the statement rests on.

**When re-run after a revise.** `problem-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. The note
may be about the personas alone: then keep this document unchanged, say so in
the summary, and let `persona-exploration` take it. Otherwise revise the
document in place, asking again only what the note reopens, and say in the
summary what changed.

**Recovery budget**: one attempt — re-phrase a question the operator's answer
left unclear.

**Phase summary key**: `problem_exploration`, with `problem_statement`,
`constraints`, `success_criteria` and `node: problem-exploration`.

---

## `persona-exploration`

Executed inline and interactive, and **guarded** on `personas_enabled`: it runs
only for a greenfield or complex design. When the guard is false it is skipped,
and `problem-approval` still fires for the problem statement.

1. **Explore** the user types — their goals, pain points and how they discover
   the feature — **one question at a time**, referencing the design context and
   the problem statement.

   **Default under a non-terminal driver** (`persona-questions`): no question is
   asked; the persona cards are drafted from the design context and the problem
   statement alone and marked as drafted rather than confirmed, for the reason
   the problem statement is marked.
2. **Converge** on one to three persona cards, by complexity: name, role, goals,
   pain points and the key journey.
3. **Refine** — ask with options to approve the personas and continue, to change
   a named persona, to add one, to remove one, and to explain your thinking. On a
   change, present the complete revised set and ask again; count each round in
   `design_context.refinement_iterations.personas`, with the same soft cap.

   **Default under a non-terminal driver** (`persona-refinement`): approve and
   continue, with the count at zero. `problem-approval` is where they change.
4. **Write `analysis/personas.md`**: each persona card and its user journey, with
   any insight about how users discover the feature.

**Gate brief content.** In `summary`, the personas by name and role in one line
each; in `decisions`, what set them apart, or the `defaulted:` entries; in
`risks`, a user type the exploration left out on purpose.

**When re-run after a revise.** The stretch from `problem-exploration` re-runs
this node. Read the note: revise the cards it names in place, keep the others,
and when the problem statement changed, check every card still fits it. Say in
the summary what changed.

**Recovery budget**: one attempt — re-present the personas with adjusted
framing.

**Phase summary key**: `persona_exploration`, with `personas`, `user_journeys`
and `node: persona-exploration`.

---

## `problem-approval`

A gate, **unguarded**, closing the problem statement and — when they were
drafted — the personas. Its brief renders both summaries. Ask it as engine
§ Gates says, record the answer, and stop the run on the stop option.

Its revise option re-runs the stretch from `problem-exploration` with the
operator's note: the problem statement, then the personas when their guard
holds, then this gate again (engine § Gates, *Revising at a gate*). One option
covers both documents, because the personas are drawn from the problem statement
and a revise that changed only one could leave them disagreeing; each node keeps
what the note does not touch.

---

## `idea-generation`

Delegated to the solution brainstormer through the Task tool, **deliberately
non-interactive**: alternatives generated outside the conversation are not
anchored on the first idea anybody in it had.

The `maister:solution-brainstormer` agent generates the alternatives rather than
an inline list. Everything node-scoped it needs is in `with:`; the run-scoped
four supply the rest, including the style guide path for its HTML companion.
Also hand it:

- the design characteristics from state;
- the personas file, `analysis/personas.md`, **only when the state records
  `persona-exploration` completed** — it is never interpolated, because the node
  may have been skipped;
- the instruction to read the design context, the problem statement and the
  personas in full, and to write to `analysis/alternatives.md` exactly and
  nowhere else, with alternatives and trade-offs grouped by decision area and a
  recommendation for each area.

If the agent returns without `analysis/alternatives.md`, or with one that holds
no alternatives, re-invoke it with corrected context. If the second attempt
also fails, ask the operator whether to retry once more or to proceed with
alternatives drafted inline — and say, when they choose the second, that inline
alternatives lose the point of generating them apart.

**Default under a non-terminal driver** (`brainstormer-retry`): neither. With the
budget exhausted and nobody to ask, the node is recorded `failed`. Inline
alternatives drafted by the same conversation are exactly the anchoring this
node exists to avoid, and a re-drive is the operator's route back in.

**Node summary.** The number of decision areas and of alternatives, and each
area's recommendation in `decisions`. There is no gate after this node; it
continues straight into the convergence, whose gate renders this summary too.

**When re-run after a revise.** `direction-approval`'s option to explore more
sent the run back, and the note says what the first set lacked. Hand the
brainstormer the note and the existing `analysis/alternatives.md`, and ask it to
revise the file in place with fresh alternatives beyond the ones already
explored, listing those as considered rather than deleting them.

**Recovery budget**: two attempts, the second with adjusted context.

**Phase summary key**: `idea_generation`, with `alternatives_count` and `node:
idea-generation`.

---

## `idea-convergence`

Executed inline and interactive. Read the interaction-patterns reference first
if this session has not — the convergence mode. Announce convergence mode, then
walk the alternatives one decision area at a time.

> **ANTI-PATTERN**: Do NOT present all decision areas in a single summary table
> and ask one combined question. Each area MUST get its own detailed
> presentation and its own question.
>
> **ANTI-PATTERN**: Do NOT shortcut the remaining areas after showing full
> detail for the first. EVERY area gets the SAME level of detail.

1. **Read `analysis/alternatives.md`.**
2. **For each decision area, sequentially** — later areas may depend on earlier
   answers, so do not pre-ask a later one:
   a. the area's name and why the decision matters, in a sentence or two;
   b. for EVERY alternative, its name, a short description, its pros and its
      cons;
   c. the recommended alternative and why, in one sentence;
   d. **one question for this area**: its alternatives as options, the
      recommended one marked `(Recommended)`, plus "Need more info" and "Let me
      explain my thinking". An area with more alternatives than the options hold
      offers the recommended one and its strongest rivals and names the rest in
      the question text;
   e. on "Need more info", present the deeper trade-off analysis and ask the
      same area again; on a choice, record it and move on.
3. **Summarise the chosen direction** across the areas, then **refine** it — ask
   with options to approve the direction and continue, to refine it (adjust
   choices — re-ask the areas the operator names), and to explain your thinking.
   Count each round in `design_context.refinement_iterations.direction`.
   Exploring more alternatives is not offered here: it re-runs the brainstorm,
   which only `direction-approval` can do, and the gate offers it.
4. **Write `analysis/design-decisions.md`**: the chosen approach and its
   rationale, the key decision per area, the trade-offs accepted, and the
   alternatives considered in brief, pointing at `analysis/alternatives.md` for
   the detail. Then its HTML companion (*Run-scoped context*).

> **SELF-CHECK before each question**: did you output the full alternatives with
> pros and cons for THIS area? If you showed only a recommendation line, STOP
> and output the full detail first.

**Default under a non-terminal driver** (`convergence-decisions` and
`direction-refinement`): **neither is defaulted — the decision is left for
`direction-approval`.** Choosing a direction is the one decision in this workflow
the run does not take on the operator's behalf, because everything after it is
built on it. So this node does every part of the convergence except the choice:

- every area is still worked in full — alternatives, pros and cons, the
  recommendation and its strongest rival — and written into
  `analysis/design-decisions.md` as a **decision sheet**, which opens by saying
  the direction is proposed, not chosen, and that continuing at the direction
  gate adopts every recommendation in it;
- `decisions` carries one item per area, `<area>: <recommended alternative>
  recommended — adopted if you continue`;
- `risks` carries one item per area, `open: <area> — take <strongest rival>
  instead of the recommended <recommended alternative>`, most consequential area
  first. The gate's revise suggestions are generated from these, so each
  suggestion an operator can pick is a concrete switch;
- `decision_areas` records every area with `recommended` set and
  `chosen_approach` unset, and `selected_approach` stays unset.

This is a deliberate exception to the rule that a node resolves the decisions it
owes: the decision is owed to the gate, and the gate's answer is what resolves
it. An area with no recommendation is recorded the same way, its risk naming the
alternatives to choose between.

> **GATE CHECK**: verify that EVERY decision area is in `decision_areas` —
> chosen in a terminal run, or recorded open with its recommendation under a
> driver. An area dropped for any reason — a missing file, a failed read — is a
> defect: STOP and resolve it. Do not mark this node complete without every area
> accounted for.

**Gate brief content.** In a terminal run: the chosen direction in a sentence in
`summary`, one decision per area in `decisions`, the trade-offs accepted in
`risks`. Under a driver: the items above, and a `summary` that says the
direction is proposed and how many areas await the operator's choice.

**When re-run after a revise.** `direction-approval` sent the run back. After
`refine-direction`, read the note: in a terminal run, re-ask only the areas it
reopens and keep the other choices; under a driver, take the alternative the
note names for each area it names — the operator's choice, recorded as
`<area>: <alternative> — chosen at the direction gate` — and leave the rest open
as before. After `explore-more-alternatives` the alternatives are new: work every
area afresh, keeping a choice only for an area that survives unchanged. Rewrite
`analysis/design-decisions.md` in place and say in the summary what changed.

**Recovery budget**: one attempt — re-read the alternatives and re-present the
decision areas.

**Phase summary key**: `idea_convergence`, with `selected_approach`,
`trade_offs_accepted`, `decision_areas` — each element `area`,
`alternatives_count`, `recommended` and `chosen_approach` — and `node:
idea-convergence`.

---

## `direction-approval`

A gate. Ask it as engine § Gates says, record the answer, and stop the run on the
stop option.

**Its continue option means more under a driver.** When `idea-convergence` left
the areas open, continuing is the operator adopting every recommendation on the
decision sheet as their choice; the gate's recorded answer, with who gave it, is
that choice. Nothing is written back into the decision sheet — it already says
that continuing adopts it.

It has two revise options. `refine-direction` re-runs the convergence with the
operator's note, to change choices among the alternatives already generated.
`explore-more-alternatives` re-runs the brainstorm first and then the
convergence, for when none of the alternatives fits.

---

## `feature-specification`

Executed inline and interactive: the specification is proposed and refined
section by section, never drafted whole and never delegated.

> **ANTI-PATTERN**: Do NOT draft every section at once and ask for one approval.
> Each section is proposed, reviewed and approved on its own.
>
> **ANTI-PATTERN**: Do NOT delegate to the specification creator. This
> specification is authored here, in convergence with the operator.

**Read the direction first.** Read `analysis/design-decisions.md`. When it is a
decision sheet with areas left open, read `direction-approval`'s recorded answer
from the state: a continue means the operator adopted every recommendation, and
the specification states in its Key Decisions that the direction was adopted at
the direction gate, naming who answered. When it records choices, follow them.

**Scale the sections to the complexity**: three or four sections of about 20 to
50 lines each for a simple design — what to build; five or six of about 50 to
100 for a standard one — what, and the key decisions about how; six to eight of
about 100 to 300 for a complex one — what, how, edge cases and the schemas and
contracts, ready to implement from.

> **Section depth principle**: each section holds enough that a developer could
> implement that aspect without asking a clarifying question. Before presenting
> one, ask yourself: "If I had only this section and the codebase, could I write
> the code?" In a complex design, a section about data lists every entity with
> its fields and types; one about an interface lists every endpoint or method
> with its input and output shapes; one about a workflow lists every state and
> transition with its guards and side effects; one about an integration gives
> the connection points, the data flow and the error handling.

**For each section:**

1. Draft it at the depth above and present it in full.
2. Ask with options to approve it as implementation-ready, to add more detail,
   to change its scope, to rethink it, and to explain your thinking. On a change,
   present the complete revised section and ask again; count rounds per section
   in `design_context.refinement_iterations.specification_sections`, with the
   soft cap.
3. **On approval, append the section to `analysis/feature-spec.md` at once** —
   the file, not the conversation, is the source of truth, so never hold the
   sections back until the end.

**Default under a non-terminal driver** (`specification-sections`): every
section is approved as drafted and appended in order. The depth principle carries
the weight the loop would have: a section drafted for an absent operator is still
written to the depth a developer could implement from, and a section that cannot
reach it without an answer says which answer it needs rather than being padded to
look finished.

**Depth verification, for a complex design.** Once every section is written,
re-read the whole file against the depth principle: entities with fields and
types, interfaces with shapes, workflows with states and transitions,
integrations with their connection details. For each thin section, draft an
enrichment and ask whether to append it.

**Default under a non-terminal driver** (`depth-enrichment`): the enrichment is
appended as drafted, marked as added by the depth check.

> **ANTI-PATTERN**: Do NOT skip the depth verification because each section was
> approved. Approval confirms direction; the verification is what makes the
> specification implementation-ready.

Then present a short summary of the specification, and write its HTML companion
(*Run-scoped context*).

**Gate brief content.** In `summary`, the sections by name and what the feature
does in two sentences; in `decisions`, the scope boundaries and the key "how"
decisions; in `risks`, every answer a section said it still needs, as `open:`
items.

**When re-run after a revise.** `specification-approval` sent the run back. Read
the note, revise in place the sections it reaches — through the same per-section
loop in a terminal run — keep every other section as approved, and run the depth
verification again for a complex design. Say in the summary which sections
changed.

**Recovery budget**: one attempt — re-draft a section with a different approach.

**Phase summary key**: `feature_specification`, with `spec_sections`,
`sections_count` and `node: feature-specification`.

---

## `visual-prototyping`

Delegated to the mockup studio through the Skill tool, and **guarded** on
`prototyping_enabled`: it runs only for a UI-focused design. When the guard is
false it is skipped, and `specification-approval` still fires for the
specification.

The `maister:mockup-studio` skill draws the screens rather than inline markup,
because it runs design-resource discovery first — binding the project's
standards, tokens and components — and renders against what it found. Pass:

- the mockup format: `html` when `options.visual_enabled` is true, `ascii`
  otherwise;
- the output directory, full iteration and no index rows, as `with:` names them;
- the instruction to draw **user-facing wireframes of the feature's actual
  screens** — an "add item" form, an alert dialog, whatever the specification
  describes — never generic placeholders or technical diagrams;
- the specification, the design decisions and the design context, and the
  personas' journeys from `analysis/personas.md` **only when the state records
  `persona-exploration` completed**.

**The refinement loop is the studio's own, and it stays in the node.** Full
iteration runs the studio's interactive loop — screens approved or revised one by
one, re-rendered in place while the companion stays up — which is why the gate
after this node offers no revise of the prototypes: a revise would restart the
studio cold for every round.

**Default under a non-terminal driver** (the studio's `mockup-refinement`): the
studio reads the driver from this run's state and degrades full iteration to a
single pass on its own, saying so in the notes it returns. Put that note in this
node's summary: a set of screens nobody refined otherwise reads like a set
somebody approved.

**Record** the studio's returned files in this node's summary, the companion's
status as `design_context.visual_companion`, what its discovery bound to as
`design_context.design_resources`, and the rounds as
`design_context.refinement_iterations.prototypes`.

**Gate brief content: the gallery pointer.** When the studio reports a live
gallery address, write it verbatim into this node's `summary`, with the
navigation the operator has, so `specification-approval` shows where to look.
When the companion never came up — terminal mockups, or a browser or port
failure — say so plainly and name the saved files instead. Never write an
address that was never served.

**The companion stays up until the brief.** The operator reviews the screens at
`specification-approval`, which fires after this node returns, so do not shut
the server down here; `review-handoff` does.

**When the stretch re-runs.** A revise of the specification re-runs this node
after it. Re-invoke the studio with the revised specification and regenerate only
the screens the revision touches, reusing the server still running.

**Recovery budget**: two attempts — restart the companion on the second; the
studio falls back to terminal mockups on its own when it cannot render, and that
fallback is a recorded note, not a retry.

**Phase summary key**: `visual_prototyping`, with `mockup_references` and `node:
visual-prototyping`.

---

## `specification-approval`

A gate, **unguarded**, closing the specification and — when they were drawn —
the prototypes. Its brief renders both summaries, the gallery pointer among them.
Ask it as engine § Gates says, record the answer, and stop the run on the stop
option.

Its revise option re-runs the stretch from `feature-specification` with the
operator's note: the specification, then the prototypes when their guard holds,
then this gate again — so screens drawn from a changed specification are redrawn
from it. There is no revise of the prototypes alone; the studio's loop inside
`visual-prototyping` is where screens are changed.

---

## `review-handoff`

Executed inline and interactive. It assembles the product brief, asks for its
final approval and closes the run.

1. **Check the specification once more, for a complex design.** Re-read
   `analysis/feature-spec.md` and confirm each section answers both what to build
   and how. A gap found here does not send the run back — the specification's
   own depth check and its gate came first — it is named in the brief's Open
   Questions / Risks and in this node's `risks`.
2. **Assemble the layered brief** from the documents on disk. It is a summary
   for handoff that points at the detailed documents rather than repeating them:
   - **Core brief**, always: the problem statement, the target users, the feature
     overview, the constraints, the success criteria and the acceptance criteria,
     condensed from the problem statement and the specification;
   - **Persona cards**, when the state records `persona-exploration` completed;
   - **Design decisions**, a summary per decision area, pointing at the decision
     record and the alternatives;
   - **Mockup references**, when the state records `visual-prototyping`
     completed — links to the files under `analysis/mockups/`, and terminal
     mockups inline;
   - **References**: every analysis document the run produced.
3. **Write `outputs/product-brief.md`** and present it in full.
4. **Approve** — ask with options to approve the brief, to revise a section, to
   add missing information, and to explain your thinking. On a change, revise
   and present the complete brief again.

   **Default under a non-terminal driver** (`brief-approval`): approve the brief.
   It is the last question of the run and the one to be most careful with: the
   brief is what a development run is built from, so record in its Open
   Questions / Risks that it was assembled without in-session review, and name
   every section no operator confirmed in session.
5. **Shut the mockup companion down** if `visual-prototyping` started one, by
   posting to the server's shutdown route.
6. **Write the brief's HTML companion** (*Run-scoped context*) after approval,
   so it shows the approved brief — never once per revision round.
7. **Set the task status to completed.**

**The hand-off to development.** The brief and the mockups are what the
development workflow builds from: given this run's task directory, its intake
copies `outputs/product-brief.md` and `analysis/mockups/` into its own design
context, and the mockups become binding visual references for its plan, its
implementation and its browser verification.

**Close for whoever reads the end** (the engine skill's run-end rule). In a
terminal run a person reads it: write the closing patch and call `run-complete`
first, then end with one wrap-up message — what was designed in a few lines, the
brief's path, each artifact the verb reported missing named in plain words, the
dashboard link, and this next step exactly, inventing no other command:

```
Product brief approved and saved to: [task-path]/outputs/product-brief.md

To start development based on this design, clear context first or start a new session, then run:
/maister:development [task-path]
```

The verb's own lines are never shown. Under a `cockpit` or `dispatch` driver
tooling reads it, and the order is reversed: the wrap-up is printed as ordinary
text **before** the `run-complete` call; after it, print nothing but the lines
the verb printed, copied exactly, its marker last. Never type a marker the verb
did not print.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the wrap-up above. A run that finishes and
publishes nothing leaves a dispatching chain waiting forever, and the engine
refuses a dispatched run that reaches its end with no close-out in the outbox
(`RUN-FAILED: closeout-unpublished`).

There is no gate after this node. The workflow ends here.

**Recovery budget**: one attempt — re-assemble the brief from the documents on
disk.

**Phase summary key**: `review_handoff`, with `brief_layers` and `node:
review-handoff`.
