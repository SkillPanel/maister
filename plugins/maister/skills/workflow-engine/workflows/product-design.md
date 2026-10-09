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
see that the run asks ten further kinds of question beyond its five gates — and
the mockup studio runs a refinement loop of its own inside the prototyping node.
In run order: the additional context, the problem questions in pages, the
problem statement's approval, the persona questions in pages, the persona
cards' approval, a retry when the brainstormer fails twice, one question per
decision area in the convergence, each specification section's approval, the
depth enrichments for a complex design, and the brief's approval. The design
characteristics and the context summary are not asked about inside their nodes:
their gates show them and revise them. A standard design — no personas, three
decision areas, six sections, two pages of problem questions — answers about
nineteen questions, gates included; a complex one adds the persona pages and
cards and more areas and sections. A simple run (*Depth* below) asks far
fewer: the additional context, the problem questions and the problem
statement's approval, three or four specification sections and the brief's
approval, around its two gates. The generated diagram does not show them either. This is the most
interactive workflow in the plugin; anyone reasoning about how interactive it is
must read this file, not the graph.

**Every question asked inside a node names its default here.** Under a `cockpit`
driver whose features list `question-sets`, a node asks through the cockpit, in
one request per attempt, and each section's **With question sets** line says
whether its question goes there. Under any other `cockpit` or `dispatch` driver
nobody is in the session, so none of them is asked: each takes the default its
own section states under **Without question sets** and the node records that
it did. The rule, the recording shape and what is never defaulted past belong to
the engine skill, which states them once; this file only says what each
question takes.
One question is the exception the workflow makes on purpose: the convergence on
a design direction is never defaulted. With question sets it is asked through
the cockpit; without them it is left open for the direction gate to decide,
because a direction nobody chose would be built into
every document after it (`idea-convergence` says how).

**Every question carries what it asks about** (engine § *In-node questions*).
This workflow presents drafts and asks about them — the problem statement, the
persona cards, each decision area, each specification section, the enrichments,
the brief — and the question, its options and their previews are the only text
sure to reach the screen. So each such question names in its own text what the
draft settles, and each option says what it changes. More details is its last
option while a slot is free, and typed as "details" when four options fill the
slots: the draft written out in full, then the same question again. Every ask
fits four options.
<!-- rich-picker -->
The approve option's preview holds the draft — whole when it fits, as its points
when it would pass the preview's limit — so the user reads it beside the options
without asking.
<!-- /rich-picker -->
<!-- plain-picker
Without previews, the question lists the draft's points, one line each, and More
details carries the full text.
-->
The operator's own words are always the question's free-text answer, which
takes no option slot: no question offers an option to explain their thinking.

**Every answered question is recorded** on the asking node's summary
`decisions`, one entry per question, as engine § *In-node questions* says:
`by: operator` with the question's id — the id its default names below, with
the topic, persona or section after it where a node asks several — the
question, the answer, the recommended answer and whether the two match. A page
of four answers is four entries. More details is never recorded.

**Say plainly what a driven run produces.** This workflow is collaborative by
design: its exploration questions and refinement loops are not overhead around
the work, they *are* the work. A run under a `cockpit` or `dispatch` driver
takes every default below — with question sets, every one its node cannot ask
in its one request — so the problem statement, the personas, the
specification and the brief are drafts no operator refined in session, and the
gates — five, or two in a simple run — with any first-round answers given through the cockpit, are the only
place an operator shapes them. Record that in the
artifacts rather than leaving it to be inferred: a document that does not say it
was drafted without review reads exactly like one that was reviewed.

**Recovery budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — an attempts key sitting
there would read like a grammar feature while being inert data the engine never
consults.

**A skip does not cascade, and two gates are unguarded on purpose.** The persona
exploration and the visual prototyping are guarded; a node whose guard is false
is skipped and still satisfies everything downstream. The nodes the run's depth
skips are guarded on the input instead (*Depth*), and `completion` on whether
the run is embedded (*Embedded mode*). The gate after each of
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
| 8 | `review-handoff` | none — the brief's approval is asked inside the node |
| — | `completion` | none — the workflow ends; skipped when the run is embedded |

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
- **Nothing is interpolated from a node a guard may skip.** The personas, the
  alternatives, the decision record and the prototypes are read from disk, and
  only when the state records their node `completed`. A node that reads one says
  so in its own section.
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
  The one exception is `outputs/delivery-scope.yml`, a file a machine reads,
  which carries its fixed shape and nothing else.

> **ANTI-PATTERN**: Do NOT re-summarize a summary block. `decisions` and `risks`
> are copied out of the artifact's own Key Decisions and Open Questions / Risks
> blocks **item for item** — the same count, the same words, the artifact's
> order — into `phase_summaries`, into `node_summaries` and into the dashboard,
> each item's words as the `decision` or the `risk` of its typed entry, with the
> `by` or the `tag` (and an open risk's `change`) beside them. Rewriting them in
> your own words loses the sentence the operator is about to approve at a gate;
> writing an empty `[]` because the node has already read the artifact loses it
> outright. The operator's in-step answers are recorded beside them, one per
> question, and are not copied into the artifact's blocks. A risk an earlier
> node already recorded is left out: it stays where it was raised.

---

## The context block

The block is `design_context` — the name the state writer maps this workflow
to — and this workflow writes no other context block. A run whose state carries
a second one is a run two interpreters wrote, which the state contract refuses
out loud rather than merging.

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

`intake` and `completion` write a node summary only. Each mirrored entry also carries `node:`
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
| `review-handoff` | `docs` |
| `completion` | `done` |

The five gates are not in that table on purpose: **each gate node renders the
icon of the node it closes** — `characteristics-approval` and
`context-approval` `analysis`, `problem-approval` `analysis`,
`direction-approval` `plan`, `specification-approval` `spec`. A gate inherits
rather than owns its icon, so a gate that picked its own would break the visual
pairing between a stretch and the approval that closes it.

---

## Depth

The `simple` input is the run's depth. False, the default, is the whole
workflow as this file describes it. True is the shortest run that still ends in
a brief and a delivery scope an operator can approve. It is a depth, not a
reading of the design: the detected complexity says how deep each document goes,
the depth says which stretches run, and when the input is true it wins.

The `full` input is the other end: the full design, whatever the detection
reads. Every stretch runs, as at the default, and the intake records the design
`complex` — so the personas are drafted and each node asks and writes at its
complex depth. A caller that asked for the full design must get it; a
description too short to read as complex is no reason to draft fewer
personas than were asked for. It needs no guard of its own: the persona guard
already reads what the intake records. Both inputs true contradict each other,
and `simple` wins, because its guards have already taken the stretches out of
the graph; the intake names the contradiction as an `open` risk.

| Skipped in a simple run | Why it can go |
|---|---|
| `characteristics-approval` | the characteristics it corrects only switch the personas and prototypes, which the depth already turns off |
| `context-approval` | a correction to the context shows up as one to the problem statement built on it, which `problem-approval` revises |
| `persona-exploration` | the intake records `personas_enabled` false |
| `idea-generation`, `idea-convergence`, `direction-approval` | the specification states the approach itself, and its gate approves it |
| `visual-prototyping`, unless the description asks for screens | the intake records `prototyping_enabled` true only then |

Two gates remain, `problem-approval` and `specification-approval`, beside the
brief's own approval inside `review-handoff`. Each skipped node is guarded on
the input in the definition or by a value the intake derives from it, so the
dashboard and every gate brief name them skipped. Nothing they would have written
is interpolated into a node that still runs; the nodes that read the decision
record or the alternatives read them only when the state records their node
`completed`, and say what they do otherwise.

---

## Embedded mode

**This workflow is child-capable.** A parent whose node names it starts a run
of it as a child, and the `embedded` input means exactly that — *this run is a
sub-run of another run*. The engine supplies it at the child freeze; an
operator never types it and no command exposes it. A parent may pass `simple`
or `full` in the same `with:`, which is how a chain chooses the depth: a parent
whose own run was asked for the full design passes `full: true`, because
`simple: false` alone leaves the depth to the detection.

Its only effect is the guard on `completion`, which is therefore skipped for a
child: that node tells an operator the run is over and points at the
development command, and a parent handles its own next steps. Everything else
runs unchanged, gates and in-node questions included — a child suspends on its
own gates in its own Run view. `review-handoff` runs on every path, so the brief
and the delivery scope are written whether or not the run is embedded; at a
workspace root the scope is still drawn from the members the workspace manifest
declares.

What a parent may read is the workflow-level `outputs:` block in
`product-design.yml`, and nothing else: `brief`, `delivery_scope` and `mockups`.
The mockups belong to a node a guard may skip; when no screens were drawn the
entry is simply absent, and the parent records it under its node's `absent`
when it adopts this run's outcome (engine § *Recording an outcome*). The three
paths — `outputs/product-brief.md`, `outputs/delivery-scope.yml` and
`analysis/mockups/` — are why the artifact layout here is a contract and does
not move.

**Nothing is copied and nothing is handed back in prose.** A parent addresses
this run's artifacts through the child's own `task_path`. The mechanics — the
freeze, the child directory name, the ending and what a parent reads when —
belong to the engine skill's *Sub-runs* section, which states them once for
every workflow.

A run that is not embedded reaches development by path, as before: an operator
passes its task directory to the development command, and development's intake
copies the brief and the mockups from it.

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
   Write `context/README.md`, telling the operator to drop relevant files
   there — meeting notes, existing designs, spreadsheets, documents, PDFs,
   images.
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
4. **Make sure the user has seen the start banner** (engine Step 4). It is the
   run's first message — if your messages since the freeze do not name the workflow
   and task, the checkpoints, the directory and the dashboard link, write them now,
   from the freeze's output, the paths copied as printed.
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
   lean to the higher complexity. **When the `simple` input is true the depth
   wins** (*Depth*): record the complexity `simple` whatever the signals say, and
   when they said more, name it in `risks` as `{risk: "detected as <level>; the
   simple depth was requested", tag: open, change: "run the full design"}`.
   **When the `full` input is true**, record the complexity `complex` whatever
   the signals say, and say in the summary that the full design was requested.
   When both are true, `simple` wins as above, and `risks` carries `{risk: "both
   the simple and the full depth were requested; the simple design ran", tag:
   open, change: "run again with only the full depth"}`.
8. **Ask for additional context** in one call: *"Any additional context for
   this design?"*, a multi-select of four options —
   - *"No additional context (Recommended)"* first, its description saying the
     run goes on from the description, the project documentation and the
     research named, if any;
   - *"Files"*, its description naming the folder — `<task path>/context/`,
     from the project root — and asking the operator to drop the files there
     before answering, so they are in place when the answer arrives;
   - *"Links"*, and *"Topics to research"*, each description saying to type
     them in this same call's free-text answer, one per line.

   Nothing ticked is the same answer as the recommended one, so the empty set
   loses nothing. Follow the answer: read and catalog what is in `context/`
   into `design_context.user_files_list`; sort what was typed into
   `design_context.collected_urls` and `design_context.research_topics`. Only
   when Files was chosen and the folder is still empty, ask once more — the
   question naming the folder, with *"Read the folder again (Recommended)"* and
   *"Go on without files"*.
<!-- plain-picker
   Under this picker the four options are one property of type array, none of
   them the default, and the links and topics a text property beside it.
-->

   **With question sets** (`additional-context`): asked through the cockpit, in
   this node's one request (*In-node questions*). Files go in the folder before
   answering; a folder still empty after a Files answer is not asked about
   again, and the run goes on without files.

   **Without question sets** (`additional-context`): no
   additional context; the run proceeds on what the invocation, the research
   input and the project documentation supply. Dropping files and typing links
   needs somebody at the keyboard, so the lists stay empty rather than
   half-gathered.
9. **Record the outcome**: the characteristics, the complexity level and the
   collected context under `design_context`, and this node's three declared
   values — `personas_enabled` true when the design is greenfield or complex,
   `prototyping_enabled` true when it is UI-focused, and `complexity_level`. In a
   simple run `personas_enabled` is false, and `prototyping_enabled` is true only
   when the description itself asks for screens or mockups; in a full run
   `personas_enabled` is true.
   Those values are what guard the persona and prototyping nodes, so write
   them in the same patch that marks the node `completed`.

The characteristics are not asked about here. `characteristics-approval` shows
them with their rationale, in a terminal run and under a driver alike, and its
revise is how an operator corrects one. A simple run skips that gate; the
characteristics are still recorded, and the brief names them.

**Gate brief content.** Into this node's closing summary: a `headline` naming
the kind of design, its complexity and which optional parts will run, in one
sentence ("A complex greenfield design with a user interface: personas will be
drafted and the screens prototyped"). In `summary`, each characteristic that
holds, with its one-line rationale, the complexity level, and in plain words
which optional parts will run — "personas will be drafted; no screens to
prototype". In `decisions`, the additional-context answer as recorded above, or
`{decision, by: default, question_id: additional-context}`. In `risks`, each
characteristic detected on thin evidence as `{risk, tag: open, change}`, its
`change` the correction ("treat it as an enhancement of the existing app"), so
the gate's revise offers it before the run builds on it.

**When re-run after a revise.** `characteristics-approval` sent the run back,
and `prior-context` carries the operator's note under *Revision requested*. The
task directory, the state, the dashboard, the project documentation and any
imported research are already in place: do not create, open or import them
again. Apply the note to the characteristics, keeping the exclusive pairs
consistent, derive the complexity again, and record all three declared values
again — a revise clears them, and they decide whether the personas and the
prototypes run. Ask nothing already answered: the additional context stands. A
thin-evidence risk the note settles is written `tag: resolved`. Say in the
summary what changed and which optional parts now run.

**Recovery budget**: one attempt — in a terminal run, a description too thin to
classify is clarified with one question offering two or three readings of it,
the closest first, marked `(Recommended)` with why. A driven run does not fail
on one: it classifies at the higher complexity, as the detection guidance says,
and names that in `risks`.

---

## `characteristics-approval`

Ask it from `gate-brief --json` as engine § Gates says. Skipped in a simple run
(*Depth*).

A gate. Record the answer, and stop the run on the stop option — nothing after
a stopped node ever becomes ready.

This gate is where the characteristics are confirmed, because it is the one
checkpoint that reaches the operator in a terminal run and under a driver
alike. Its revise option, `revise-characteristics`, sends the run back to
`intake` with the operator's note: the note is the correction, `intake` applies
it and derives again which optional parts run, and this gate is asked again
(engine § Gates, *Revising at a gate*).

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

The synthesis is not asked about here: `context-approval` shows it, and its
revise is how an operator corrects or adds to it.

**Gate brief content.** Into this node's closing summary: a `headline` giving
the finding that most shapes the design and how many sources fed the synthesis,
in one sentence. In `summary`, the two or three key findings in plain words. In
`decisions`, the implications for the design, each `{decision, by: run}`, never
an earlier answer restated. In
`risks`, what the synthesis left open, each `{risk, tag: open, change}` worded
so its `change` can be folded in as it stands — an unsettled choice the sources
raise, a constraint it had to infer, a finding resting on one thin source, a
source that could not be read, a link that would not load, a topic the research
could not settle — because the gate's revise offers those changes as the
corrections to pick.

**When re-run after a revise.** `context-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Fold the
note's corrections and additions into `analysis/design-context.md` in place:
read a file or fetch a link the note adds, research a topic it adds or reopens,
and run the codebase analysis again only when the note is about the codebase.
Keep everything the note does not touch, and ask nothing already answered. Say
in the summary what changed.

**Recovery budget**: two attempts — re-invoke the codebase analyzer or the
information gatherer with adjusted context on the second.

**Phase summary key**: `context_synthesis`, with `sources_count` and `node:
context-synthesis`.

---

## `context-approval`

Ask it from `gate-brief --json` as engine § Gates says. Skipped in a simple run
(*Depth*).

A gate. Record the answer, and stop the run on the stop option. Its revise
option, `revise-context`, sends the run back to `context-synthesis` with the
operator's note — the corrections and additions to fold in — and this gate is
asked again (engine § Gates, *Revising at a gate*).

---

## `problem-exploration`

Executed inline and interactive. Read the interaction-patterns reference first,
`${CLAUDE_PLUGIN_ROOT}/skills/product-design/references/interaction-patterns.md`
— the exploration and convergence modes, the refinement loop and how its options
are designed. Read `analysis/design-context.md` in full, not only its summary,
so every question can be specific to this project.

1. **Explore.** Announce exploration mode in a line, then ask context-aware
   questions **in pages of up to four** — two or three for a simple design, four
   to six for a standard one, eight to ten for a complex or greenfield one. A
   page holds only questions that stand on their own; one whose framing depends
   on another's answer waits for the next page. Each question carries its own
   synthesis line — what the run already understands that bears on it, from the
   design context, the description or an earlier page ("The sync conflicts come
   up in three support threads, all from teams sharing one calendar") — and two
   or three answers generated from it, the one the context best supports first,
   marked `(Recommended)` with why. The operator's own words go through Other.
   Fold each page's answers in before the next, so the next page builds on them
   and a misreading is corrected before it compounds.

   **With question sets** (`problem-questions`): the first page — the questions
   that stand on their own — is asked through the cockpit, in this node's one
   request (*In-node questions*). A question that waits on another's answer is
   not asked, and the draft is marked as a proposal where it rests on one.

   **Without question sets** (`problem-questions`): no question is
   asked, and the draft is derived from the design context, the description and
   the project documentation alone. Mark it in the document as a proposal: a
   problem statement built without the operator's answers is one, and saying so
   is the difference between a gate an operator reads carefully and one they
   wave through.
2. **Converge.** Announce the switch, then present the complete draft: the
   problem statement, the key constraints and the success criteria.
3. **Refine** — ask *"Use this problem statement?"*, the question giving the
   statement in a sentence or two. Options: *"Approve (Recommended)"*, its
   description saying what the draft settles; *"Change the scope"* and *"Change
   constraints or success criteria"*, each description naming the change the
   run judges likeliest, from the weakest assumption, so it can be applied as it
   stands; and **More details** last. A different change, or a rethink, is typed
   through Other.
<!-- rich-picker -->
   The approve option's preview holds the draft: the problem statement, the
   constraints and the success criteria.
<!-- /rich-picker -->
<!-- plain-picker
   The question lists the constraints and the success criteria, one line each,
   after the statement.
-->
   On a change, revise the draft and ask again; count each round in
   `design_context.refinement_iterations.problem_statement`. After the soft cap
   — two rounds for a simple design, three otherwise — the approve option's
   description says how many rounds were taken, and the operator can still take
   one more.

   **With question sets** (`problem-refinement`): asked through the cockpit only
   when it is the first thing this node asks in its attempt; after an earlier
   request in the same attempt, the default below is taken (*In-node
   questions*).

   **Without question sets** (`problem-refinement`): approve and
   continue — no round is taken and the count stays at zero.
   `problem-approval` is the operator's route back.
4. **Write `analysis/problem-statement.md`**: the approved problem statement,
   constraints, success criteria and the key assumptions behind them — the full
   exploration, which the brief later condenses.

**Gate brief content.** Into this node's closing summary: a `headline` giving
the problem in one sentence. In `summary`, the problem statement in a sentence or two, and the
number of constraints and success criteria. In `decisions`, the scope choices
the exploration settled, each `{decision, by: run}`, beside the operator's
answers as recorded above, or `{decision, by: default, question_id}` for each
defaulted question; an earlier answer is never restated as the exploration's. In
`risks`, the assumptions the statement rests on, each
`{risk, tag: open, change}` with what would change if it is wrong; a need left
out of scope on purpose is `tag: tradeoff`.

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
   the feature — in pages of up to four independent questions, as the problem
   exploration does: each question carries its own synthesis line from the
   design context and the problem statement, and two or three generated
   answers, the best-supported first and marked `(Recommended)` with why.

   **With question sets** (`persona-questions`): the first page is asked through
   the cockpit, in this node's one request (*In-node questions*); a question
   that waits on another's answer is not asked, and the cards it would shape are
   marked as drafted.

   **Without question sets** (`persona-questions`): no question is
   asked; the persona cards are drafted from the design context and the problem
   statement alone and marked as drafted rather than confirmed, for the reason
   the problem statement is marked.
2. **Converge** on one to three persona cards, by complexity: name, role, goals,
   pain points and the key journey.
3. **Refine** — ask *"Use these personas?"*, the question naming each persona
   by name and role in a line. Options: *"Approve (Recommended)"*, its
   description saying what the set covers; *"Change a persona"*, *"Add a
   persona"* and *"Remove a persona"*, each description naming the persona and
   the change the run judges likeliest. The four fill the slots, so the
   question ends with `Type "details" for the full cards.`
<!-- rich-picker -->
   The approve option's preview holds the cards, each with its goals, pain
   points and key journey.
<!-- /rich-picker -->
   On a change, revise the set and ask again; count each round in
   `design_context.refinement_iterations.personas`, with the same soft cap.

   **With question sets** (`persona-refinement`): asked through the cockpit only
   when it is the first thing this node asks in its attempt; after an earlier
   request in the same attempt, the default below is taken (*In-node
   questions*).

   **Without question sets** (`persona-refinement`): approve and
   continue, with the count at zero. `problem-approval` is where they change.
4. **Write `analysis/personas.md`**: each persona card and its user journey, with
   any insight about how users discover the feature.

**Gate brief content.** Into this node's closing summary: a `headline` covering
the problem and the personas in one sentence, since `problem-approval` closes
both. In `summary`, the personas by name and role in one line each. In `decisions`, what set them apart, each `{decision, by: run}`, beside
the operator's answers as recorded above or the `{decision, by: default,
question_id}` entries; an earlier answer is never restated here. In `risks`, a
user type the exploration left out on
purpose, `tag: tradeoff`, or one it could not settle, `tag: open` with the
`change` that would add it.

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

Ask it from `gate-brief --json` as engine § Gates says.

A gate, **unguarded**, closing the problem statement and — when they were
drafted — the personas. Its brief renders both summaries, or names the personas
skipped. Record the answer, and stop the run on the stop option.

Its revise option re-runs the stretch from `problem-exploration` with the
operator's note: the problem statement, then the personas when their guard
holds, then this gate again (engine § Gates, *Revising at a gate*). One option
covers both documents, because the personas are drawn from the problem statement
and a revise that changed only one could leave them disagreeing; each node keeps
what the note does not touch.

---

## `idea-generation`

Skipped in a simple run (*Depth*). Delegated to the solution brainstormer
through the Task tool, **deliberately non-interactive**: alternatives generated outside the conversation are not
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
also fails, ask *"Idea generation failed twice: <cause>. Try again?"*, with
*"Try once more (Recommended)"*, its description saying why another attempt may
work now, and *"Draft the alternatives here"*, its description carrying the
warning: alternatives drafted in this conversation are anchored on the ideas
already discussed, which is what generating them apart avoids.

**With question sets** (`brainstormer-retry`): asked through the cockpit only
when it is the first thing this node asks in its attempt; after an earlier
request in the same attempt, the default below is taken (*In-node questions*).

**Without question sets** (`brainstormer-retry`): neither. With the
budget exhausted and nobody to ask, the node is recorded `failed`. Inline
alternatives drafted by the same conversation are exactly the anchoring this
node exists to avoid, and a re-drive is the operator's route back in.

**Node summary.** The number of decision areas and of alternatives, and each
area's recommendation, in `summary` and **never in `decisions`**: a
recommendation is not a decision, and the operator makes the decisions area by
area in the convergence. A `by: run` item here would credit the brainstorm with
what the operator is about to choose. There is no gate after this node; it
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

Skipped in a simple run (*Depth*). Executed inline and interactive. Read the interaction-patterns reference first
if this session has not — the convergence mode. Announce convergence mode in a
line, then walk the alternatives one decision area at a time.

> **ANTI-PATTERN**: Do NOT put several decision areas in one call, as tabs of a
> page or as one combined question, and do NOT offer them as accept-all. One
> call, one question, one area: a later area can depend on an earlier answer.
> (With question sets every area goes in the node's one request instead, still
> one question per area — see below.)
>
> **ANTI-PATTERN**: Do NOT shortcut the remaining areas after giving the first
> its full detail. EVERY area's question, options and previews carry the SAME
> level of detail.

1. **Read `analysis/alternatives.md`.**
2. **For each decision area, sequentially** — do not pre-ask a later one — ask
   **one question for this area**, carrying the whole area itself (engine
   § *In-node questions*):
   - **the question** names the area, why the decision matters in a sentence or
     two, and each alternative in a line;
   - **the options** are its alternatives, the recommended one first and marked
     `(Recommended)`, its description giving the reason in a sentence; each
     other option's description gives its key pro and con in a few words (the
     question's line for it, where the tool shows no descriptions); **More
     details** is last;
<!-- rich-picker -->
   - **the previews**: each alternative's own option carries its
     two-to-three-sentence description, its pros and its cons, and the
     recommended one's preview adds the reason it is recommended;
<!-- /rich-picker -->
<!-- plain-picker
   - **the recommendation**: the question's last line before the ask is
     "Recommended: <alternative> — <reason>", because the form shows no option
     descriptions;
-->
   - **the cap**: an area with more alternatives than the options hold beside
     More details offers the recommended one and its strongest rivals and names
     the rest in the question text, which the operator reaches by typing.

   The operator explains their thinking through the free-text answer. On More
   details (or a typed "details"), write the area out in full — every
   alternative's two-to-three-sentence description, pros and cons, the deeper
   trade-off analysis, the recommendation and why — and ask the same area
   again, recording nothing; on a choice, record it as an operator decision and
   move on.
3. **Summarise the chosen direction** across the areas into this node's
   summary. It is not asked about here: `direction-approval` follows directly,
   shows it, and offers re-asking chosen areas or brainstorming new
   alternatives.
4. **Write `analysis/design-decisions.md`**: the chosen approach and its
   rationale, the key decision per area, the trade-offs accepted, and the
   alternatives considered in brief, pointing at `analysis/alternatives.md` for
   the detail. Then its HTML companion (*Run-scoped context*).

> **SELF-CHECK before each question**: does the question itself name THIS area,
> why it matters and every alternative, and does each option's description carry
> its pro and con — the recommended one's its reason? If the question holds only
> the area's name, STOP and write it out. And, in a terminal run, does this
> call ask exactly one area?

**With question sets** (`convergence-decisions`): asked through the cockpit —
every decision area in this node's one request, one question per area (*In-node
questions*). Each question names its area; its `why` says why the area matters
and names any other area its choice depends on. Each alternative is an option
whose description carries its key pros and cons, the recommended one carrying
`recommended` and its reason. Before it suspends, `analysis/alternatives.md` and
the drafted decision sheet in `analysis/design-decisions.md` are on disk. After
the answers, the node records each as an operator decision and records the
chosen direction exactly as a terminal run does: `decision_areas` with
`chosen_approach` set, `selected_approach`, and `analysis/design-decisions.md`
rewritten as chosen, not proposed. Any two chosen alternatives that conflict are
recorded as an `open` risk whose `change` names the switch that resolves it, for
`direction-approval`.

**Without question sets** (`convergence-decisions`): **not
defaulted — the decision is left for `direction-approval`.** Choosing a
direction is the one decision in this workflow the run does not take on the
operator's behalf, because everything after it is built on it. So this node does
every part of the convergence except the choice:

- every area is still worked in full — alternatives, pros and cons, the
  recommendation and its strongest rival — and written into
  `analysis/design-decisions.md` as a **decision sheet**, which opens by saying
  the direction is proposed, not chosen, and that continuing at the direction
  gate adopts every recommendation in it;
- `decisions` carries one item per area, `{decision: "<area>: <recommended
  alternative> recommended — adopted if you continue", by: run}`;
- `risks` carries one item per area, most consequential area first,
  `{risk: "<area>: <recommended alternative> is adopted if you continue", tag:
  open, change: "take <strongest rival> instead"}`. The gate's revise
  suggestions are generated from these, so each suggestion an operator can pick
  is a concrete switch;
- `decision_areas` records every area with `recommended` set and
  `chosen_approach` unset, and `selected_approach` stays unset.

This is a deliberate exception to the rule that a node resolves the decisions it
owes: the decision is owed to the gate, and the gate's answer is what resolves
it. An area with no recommendation is recorded the same way, its risk naming the
alternatives to choose between.

> **GATE CHECK**: verify that EVERY decision area is in `decision_areas` —
> chosen in a terminal run or through the cockpit, or recorded open with its
> recommendation without question sets. An area dropped for any reason — a
> missing file, a failed read — is a defect: STOP and resolve it. Do not mark
> this node complete without every area accounted for.

**Gate brief content.** In a terminal run or with question sets: a `headline`
naming the chosen direction in one sentence, the direction across the areas in
`summary`, the operator's answer per area in `decisions` and no earlier answer
restated, and the trade-offs the direction accepts in `risks`, each `tag:
tradeoff`, beside any conflict risk recorded above. Without question sets: the
items above, a `headline` and a `summary` that say the direction is proposed
and how many areas await the operator's choice.

**When re-run after a revise.** `direction-approval` sent the run back. After
`refine-direction`, read the note: in a terminal run or with question sets,
re-ask only the areas it reopens and keep the other choices; without question
sets, take the alternative the note names for each area it names — the
operator's choice, recorded as `{decision: "<area>: <alternative> — chosen at
the direction gate", by: operator}` with who answered — and leave the rest open
as before. After `explore-more-alternatives` the alternatives are new: work
every area afresh, keeping a choice only for an area that survives unchanged. Rewrite
`analysis/design-decisions.md` in place and say in the summary what changed.

**Recovery budget**: one attempt — re-read the alternatives and re-present the
decision areas.

**Phase summary key**: `idea_convergence`, with `selected_approach`,
`trade_offs_accepted`, `decision_areas` — each element `area`,
`alternatives_count`, `recommended` and `chosen_approach` — and `node:
idea-convergence`.

---

## `direction-approval`

Ask it from `gate-brief --json` as engine § Gates says. Skipped in a simple run,
with the brainstorm and the convergence before it (*Depth*).

A gate. Record the answer, and stop the run on the stop option. It follows the
convergence directly: the direction is approved here and nowhere before it.

**Its continue option means more under a driver.** When `idea-convergence` left
the areas open, continuing is the operator adopting every recommendation on the
decision sheet as their choice; the gate's recorded answer, with who gave it, is
that choice. Nothing is written back into the decision sheet — it already says
that continuing adopts it.

It has two revise options. `refine-direction` re-runs the convergence with the
operator's note, re-asking the areas the note names among the alternatives
already generated. `explore-more-alternatives` re-runs the brainstorm first and
then the convergence, for when none of the alternatives fits.

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
completed, read `analysis/design-decisions.md` — never through `with:`, since
the node may have been skipped. When it is a decision sheet with areas left
open, read `direction-approval`'s recorded answer from the state: a continue
means the operator adopted every recommendation, and the specification states
in its Key Decisions that the direction was adopted at the direction gate,
naming who answered. When it records choices, follow them.

**In a simple run there is no decision record**, because the convergence was
skipped. The specification's first section is then **Approach**: the direction
the feature takes in a paragraph, and the one or two alternatives it passed over
in a line each with why. Its choices go in `decisions` as `{decision, by: run}`,
and `specification-approval` is where the operator approves them; a choice the
run made on thin evidence goes in `risks` as `open`, with the other way as its
`change`.

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

1. Draft it at the depth above.
2. Ask *"Approve the <section> section?"*, the question saying in a line what
   the section settles. Options: *"Approve (Recommended)"*, its description
   saying the section is implementation-ready and why; *"Add more detail"*,
   *"Change its scope"* and *"Rethink it"*, each description naming the change
   the run judges likeliest, so it can be applied as it stands. The four fill
   the slots, so the question ends with `Type "details" for the full section.`,
   and a typed "details" writes the section out whole and asks again.
<!-- rich-picker -->
   The approve option's preview holds the section as its points — every entity,
   interface, state or rule it settles, a line each — within 1,800 characters,
   since a preview over the limit is not shown at all.
<!-- /rich-picker -->
<!-- plain-picker
   The question lists the section's points, a line each, before the ask.
-->
   On a change, revise the section and ask again; count rounds per section in
   `design_context.refinement_iterations.specification_sections`, with the soft
   cap.
3. **On approval, append the section to `analysis/feature-spec.md` at once** —
   the file, not the conversation, is the source of truth, so never hold the
   sections back until the end.

**With question sets** (`specification-sections`): asked through the cockpit,
every section in this node's one request, one question per section (*In-node
questions*). Each section is drafted and written to `analysis/feature-spec.md`
before it suspends; a change the operator asks for is applied after the answers
without another round.

**Without question sets** (`specification-sections`): every
section is approved as drafted and appended in order. The depth principle carries
the weight the loop would have: a section drafted for an absent operator is still
written to the depth a developer could implement from, and a section that cannot
reach it without an answer says which answer it needs rather than being padded to
look finished.

**Depth verification, for a complex design.** Once every section is written,
re-read the whole file against the depth principle: entities with fields and
types, interfaces with shapes, workflows with states and transitions,
integrations with their connection details. For each thin section, draft an
enrichment, then ask about all of them in one question: *"Add these N
enrichments to the specification?"*, the question listing each one in a line —
the section and what it adds. Options: *"Accept all N enrichments
(Recommended)"*, its description saying the depth check found those sections
short of implementation-ready; *"Choose which to add"*, which opens a
multi-select of the enrichments, each labelled `(Recommended)`; *"Keep the
sections as approved"*; and **More details**, which writes each enrichment out
in full and asks again.

**With question sets** (`depth-enrichment`): asked through the cockpit only when
it is the first thing this node asks in its attempt; after the sections'
request, the default below is taken (*In-node questions*).

**Without question sets** (`depth-enrichment`): every enrichment
is appended as drafted, marked as added by the depth check.

> **ANTI-PATTERN**: Do NOT skip the depth verification because each section was
> approved. Approval confirms direction; the verification is what makes the
> specification implementation-ready.

Then present a short summary of the specification, and write its HTML companion
(*Run-scoped context*).

**Gate brief content.** Into this node's closing summary: a `headline` saying
what the feature does and how many sections specify it, in one sentence. In
`summary`, the sections by name and what the feature does in two sentences. In
`decisions`, the scope boundaries and the key "how" decisions, each `{decision,
by: run}`, beside the operator's answers as recorded above or the defaulted
entries; the direction chosen at the convergence, or any other earlier answer,
is never restated as the specification's. In `risks`, every answer a section said it still needs, each `{risk,
tag: open, change}` — the question, and what the answer would change; a scope
boundary drawn on purpose is `tag: tradeoff`.

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
- the specification and the design context; the decision record,
  `analysis/design-decisions.md`, **only when the state records
  `idea-convergence` completed** — in a simple run the specification's Approach
  section carries the direction; and the personas' journeys from
  `analysis/personas.md` **only when the state records `persona-exploration`
  completed**.

**The refinement loop is the studio's own, and it stays in the node.** Full
iteration runs the studio's interactive loop — screens approved or revised one by
one, re-rendered in place while the companion stays up — which is why the gate
after this node offers no revise of the prototypes: a revise would restart the
studio cold for every round.

**With question sets**: the same — refining mockups needs the browser companion
in session, so it is not carried as a question.

**Without question sets** (the studio's `mockup-refinement`): the
studio reads the driver from this run's state and degrades full iteration to a
single pass on its own, saying so in the notes it returns. Put that note in this
node's summary: a set of screens nobody refined otherwise reads like a set
somebody approved.

**Record** the studio's returned files in this node's summary, the companion's
status as `design_context.visual_companion`, what its discovery bound to as
`design_context.design_resources`, and the rounds as
`design_context.refinement_iterations.prototypes`.

**Gate brief content: the gallery pointer.** When the studio reports a live
gallery address, put it, verbatim, in this node's `headline` — the screens
drawn and where to see them, in one sentence — and open its `summary` with it
and the navigation the operator has, so `specification-approval` shows where to
look: a brief that has to trim keeps each summary's opening sentences. When the
companion never came up — terminal mockups, or a browser or port failure — say
so plainly and name the saved files instead. Never write an address that was
never served.

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

Ask it from `gate-brief --json` as engine § Gates says.

A gate, **unguarded**, closing the specification and — when they were drawn —
the prototypes. In a simple run it also approves the approach the specification
states, since no direction gate came before it. Its brief renders both summaries, the gallery pointer among them,
or names the prototypes skipped. Record the answer, and stop the run on the stop
option.

Its revise option re-runs the stretch from `feature-specification` with the
operator's note: the specification, then the prototypes when their guard holds,
then this gate again — so screens drawn from a changed specification are redrawn
from it. There is no revise of the prototypes alone; the studio's loop inside
`visual-prototyping` is where screens are changed.

---

## `review-handoff`

Executed inline and interactive. It assembles the product brief and the
delivery scope and asks for the brief's final approval. It runs on every path —
embedded or not, at either depth — because a parent reads what it writes; the
run's own close is `completion`'s.

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
     record and the alternatives, when the state records `idea-convergence`
     completed; in a simple run, the specification's Approach section condensed,
     pointing at the specification;
   - **Mockup references**, when the state records `visual-prototyping`
     completed — links to the files under `analysis/mockups/`, and terminal
     mockups inline;
   - **Delivery scope**, always: each member in scope as one plain sentence —
     the member, what changes there, and what it waits for — in order, then
     each member left out with its reason. It is a layer like the others, so
     the approval below names it and approving the brief approves the scope;
   - **References**: every analysis document the run produced.
3. **Write `outputs/product-brief.md` and `outputs/delivery-scope.yml`.** The
   scope says where the work lands; its shape and rules are the umbrella
   skill's `references/delivery-scope.md`. When the project root holds a
   workspace manifest (`.maister/umbrella.yml`), every member its `members:`
   map declares goes either in scope, with its one-line statement, or out of
   scope, with its reason; a member is in scope when the specification changes
   something it owns. Order the members in scope by what consumes what: a
   member whose work needs another's first lists it under `depends_on`. With no
   manifest the run is a single repository and the scope is one member, the
   repository, stating the feature in one line. Draw every statement and reason
   from the specification and the design decisions — the decision record when
   the convergence ran, the Approach section otherwise — never from a guess about
   code nobody read. The brief's scope layer and the file say the same thing,
   so a revision of that layer rewrites both.
4. **Approve** — ask *"Approve the product brief?"*, the question naming its
   layers in a line. Options: *"Approve (Recommended)"*, its description *"the
   brief only restates approved sections"*; *"Revise a section"* and *"Add
   missing information"*, each description naming the section or the gap the
   run judges likeliest; and **More details** last, which writes the brief out
   in full and asks again.
<!-- rich-picker -->
   The approve option's preview holds the brief as its points, a line per
   layer and per key decision, within the preview's limit.
<!-- /rich-picker -->
<!-- plain-picker
   The question lists the brief's points, a line per layer, before the ask.
-->
   On a change, revise the brief and ask again.

   **With question sets** (`brief-approval`): asked through the cockpit, in this
   node's one request, the brief already written to `outputs/product-brief.md`
   (*In-node questions*).

   **Without question sets** (`brief-approval`): approve the brief.
   It is the last question of the run and the one to be most careful with: the
   brief is what a development run is built from, so record in its Open
   Questions / Risks that it was assembled without in-session review, and name
   every section no operator confirmed in session.
5. **Shut the mockup companion down** if `visual-prototyping` started one, by
   posting to the server's shutdown route.
6. **Write the brief's HTML companion** (*Run-scoped context*) after approval,
   so it shows the approved brief — never once per revision round.
There is no gate after this node. `completion` follows unless the run is
embedded, and nothing follows when it is.

**Node summary.** The `headline` names what was designed in a sentence; the
`summary` carries the delivery scope in one more — the members in scope in
order and any left out, for instance *"two members in scope, `api` before
`web`; `mobile` left out"* — so the hand-off says where the work lands.

**Recovery budget**: one attempt — re-assemble the brief and the scope from the
documents on disk.

**Phase summary key**: `review_handoff`, with `brief_layers` and `node:
review-handoff`.

---

## `completion`

Executed inline, writes no files, and runs only when this run is its own — a
parent handles its own next steps, so the guard skips this node whenever the
run is a sub-run of another.

**The hand-off to development.** The brief and the mockups are what the
development workflow builds from: given this run's task directory, its intake
copies `outputs/product-brief.md` and `analysis/mockups/` into its own design
context, and the mockups become binding visual references for its plan, its
implementation and its browser verification. The development command takes the
directory either as its sole argument or through its design flag. The delivery
scope is what a delivery spanning several repositories is planned from: one
development run per member in scope, in its `depends_on` order.

**Close for whoever reads the end** (the engine skill's run-end rule). In a
terminal run a person reads it: write the closing patch and call `run-complete`
first, then end with one wrap-up message that fits one screen and is the last
thing the run prints — the engine's six sections (Done: what was designed, in a
sentence; Needs you, with each artifact the verb reported missing named in plain
words; Follow-ups; Next; Files: the brief's path and the scope's; Dashboard), and
nothing after the Dashboard line. **Next** carries this next step exactly,
inventing no other command:

```
Product brief approved and saved to: [task-path]/outputs/product-brief.md

To start development based on this design, clear context first or start a new session, then run:
/maister:development [task-path]
```

The verb's own lines are never shown. Under a `cockpit` or `dispatch` driver
tooling reads it, and the order is reversed: the wrap-up is printed as ordinary
text **before** the `run-complete` call; after it, print nothing but the lines
the verb printed, copied exactly, its marker last. Never type a marker the verb
did not print. The same rule holds for a run a gate's stop option ended, which
never reaches this node. An embedded run, whose guard skips this node, ends as a
sub-run does: in session with no wrap-up, since its parent's ending carries it,
and under a driver on the verb's marker.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the wrap-up above. A run that finishes and
publishes nothing leaves a dispatching chain waiting forever, and the engine
refuses a dispatched run that reaches its end with no close-out in the outbox
(`RUN-FAILED: closeout-unpublished`).

There is no gate after this node. The workflow ends here.

**Node summary.** The `headline` repeats what was designed and where the brief
is, in a sentence.

**Recovery budget**: none — this node summarizes and nothing else.
