# Research workflow — node prose

The node-by-node companion to `research.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need and what they declare. It says nothing about the
operator questions asked *inside* a node, the self-checks that decide whether a
node succeeded, or how many times the engine may re-drive one. Those live here.

**State the consequence plainly**: a reader of `research.yml` alone cannot see
that the run asks eight further questions beyond its three gates, and the
generated diagram does not show them either. Anyone reasoning about how
interactive this workflow is must read this file, not the graph.

**Every question asked inside a node names its default here.** Under a `cockpit`
or `dispatch` driver nobody is in the session, so none of them is asked: each
takes the default its own section states and the node records that it did. The
rule, the recording shape and what is never defaulted past belong to the engine
skill, which states them once; this file only says what each question takes.

**Retry budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — `max_attempts` sitting
there would read like a grammar feature while being inert data the engine never
consults.

---

## Run-scoped context

Four fields reach every delegate without appearing in any node's `with:`,
because they belong to the run rather than to a node:

- `task_path` — the task directory every artifact path is relative to.
- `html_style_guide_path` — passed **only** when `options.html_output` is true.
  When it is false, no companion is requested and no dashboard file is written.
- `project_doc_paths` — discovered by the first node and read from state after.
- the accumulated `phase_summaries` — the full converged detail of everything
  decided so far, verbatim, never re-summarized. **Fetch this one; do not write
  it.** The engine's `prior-context` verb takes the run's state file and prints
  the whole passage — every phase, its decisions and its risks, one bullet each
  with the count beside the heading. Run it once for each delegate prompt, in the
  turn that composes that prompt, and paste its output in under its own heading,
  unedited.

**The prior-phase passage of a delegate prompt is fetched, not composed.** Four
attended runs measured the same thing: this rule holds where the lift is
mechanical and happens once, and fails where a node writes the passage afresh
from an artifact it has already read — thirteen items arrived as seven clauses on
one line, and nothing in the prompt recorded that they had ever been thirteen. So
the composing step is gone. Call `prior-context` with the run's state file **at
each consuming delegate** — one call per prompt, in the turn that composes it —
paste its stdout into the prompt, and leave it alone: trimming it, re-ordering it
or tightening it is the same defect by hand. Re-using a rendering produced for an
earlier delegate is not licensed however recent it looks: a summary written in
between makes it stale, the prompt records nothing about when it was taken, and a
prompt that happens to be current is current by timing rather than by
construction. The verb reads the run and writes nothing, so the extra call costs
nothing — and what it prints at the moment a prompt is composed is what that
delegate receives.

Anything node-scoped is in `with:` instead. Every prompt that asks a delegate to
write an artifact also carries the artifact summary contract, so the summary
this workflow lifts into state is one the delegate wrote rather than one the
engine invented.

---

## Phase summary keys

`node_summaries` is keyed by node id; `research_context.phase_summaries` is keyed
by this workflow's own phase keys, and the two namespaces do not line up. Four
nodes mirror their summary into a phase entry, under the key named here and
never under their node id:

| Node | `phase_summaries` key |
|---|---|
| `research-foundation` | `phase-1` |
| `solution-generation` | `phase-3` |
| `solution-convergence` | `phase-4` |
| `high-level-design` | `phase-5` |

Every other node writes a node summary only. Each mirrored entry also carries
`node:` naming the node it came from, so the two directions stay readable from
either side.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `research-foundation` | `analysis` |
| `optional-phases-decision` | `plan` |
| `solution-generation` | `spec` |
| `solution-convergence` | `plan` |
| `high-level-design` | `spec` |
| `completion` | `done` |

The three gates are not in that table on purpose:
**each gate node renders the icon of the phase it gates** — `foundation-approval`
`analysis`, `convergence-approval` `plan`, `design-approval` `spec`. A gate inherits rather
than owns its icon, so a gate that picked its own would break the visual pairing
between a stretch and the approval that closes it.

---

## Embedded mode

**There is one, and this is the workflow that has it.** Research is
child-capable: a parent whose node names this workflow starts a run of it as a
child, and `embedded` means exactly that — *this run is a sub-run of another
run*. The engine supplies the input at the child freeze; an operator never
types it and no command exposes it.

Its only effect is the guard on `completion`, which is therefore skipped for a
child. That node exists to tell an operator the run is over and to suggest what
to do next; a parent handles its own next steps, so it has nothing to say to
one. Everything else in the graph runs unchanged, gates included — a child
suspends on its own gates in its own Run view.

What a parent may read is the workflow-level `outputs:` block in
`research.yml`, and nothing else: six artifact keys — `research_report`,
`report`, `findings_directory`, `solution_exploration`, `high_level_design`,
`decision_log` — and one value, `conclusions`. `report` aliases
`research_report` on purpose, so a chain authored against
`${research.artifacts.report}` keeps resolving. Three of the artifacts belong
to nodes a guard may skip; an entry whose node was skipped is simply absent,
and the parent's missing-artifact rule decides what follows.

**Nothing is copied and nothing is handed back in prose.** A parent addresses
this run's artifacts through the child's own `task_path`, so a copy in the
parent's tree would be a second copy that nothing keeps in step. The mechanics
— the freeze, the child directory name, the ending and what a parent reads when
— belong to the engine skill's *Sub-runs* section, which states them once for
every workflow.

---

## `research-foundation`

Four sequential steps, executed inline. On resume, check the artifacts each step
declares and skip the ones already on disk — the four resume checks below are
what make a re-entered run cheap instead of destructive.

**Before anything else**: when the invocation supplied no question, ask the
operator for it. Nothing downstream is meaningful without one, and inventing a
question is the documented failure mode.

**Default under a non-terminal driver** (`research-question`): none, because the
question is never reached — the start brief supplied it and the freeze persisted
it. A non-terminal run that has no research question is `RUN-FAILED`, never a
run with an invented one.

### Step 1 — initialize (inline)

*Writes* `planning/research-brief.md`. *Resume check*: if the brief exists, go
to step 2.

Parse the question, classify the research type from its keywords when the
invocation did not supply one, determine scope (included, excluded,
constraints), define success criteria and write the brief. Then **discover the
project documentation**: read the documentation index under `.maister/docs/` if
one exists and extract every path from its project-documentation section —
predefined and operator-added alike — recording them as
`research_context.project_doc_paths`.

### Step 2 — plan (delegate)

*Writes* `planning/research-plan.md`, `planning/sources.md`. *Resume check*: if
both exist, go to step 3.

Read the research-methodologies reference first — type classification,
methodology selection, gathering strategies. Then invoke the research planner
through the Task tool.

Context for the planner: `task_path`, the research brief path, the research
type, the research question, the scope, and `project_doc_paths`.

### Step 3 — gather (parallel delegates)

*Writes* `analysis/findings/*.md`. *Resume check*: if any findings file exists,
go to step 4.

Read the **Gathering Strategy** section of the plan for the categories and the
count, capped at eight. When the plan names none, fall back to four categories:
codebase, documentation, configuration, external.

Record the strategy as `research_context.gathering_strategy`, a map of exactly
three fields: `categories`, the list actually launched; `count`, how many
gatherers ran; and `source`, `planner` when the plan named the strategy and
`default` when the fallback supplied it. All three are written whichever way the
strategy was chosen — a run that records the categories but not their origin
cannot be told apart from one that silently fell back.

**CRITICAL: Launch all N agents in ONE message for parallel execution.** Sequential launches turn a parallel step into an N-times-longer one for no benefit.

Context for each gatherer: its own `source_category`, and the findings file
prefix it writes under `analysis/findings/`.

### Step 4 — synthesize (delegate)

*Writes* `analysis/synthesis.md`, `outputs/research-report.md`. *Resume check*:
if both exist, this node is complete.

Invoke the research synthesizer through the Task tool.

Context for the synthesizer: `task_path`, the findings directory path, the
research question, the research type and the methodology.

The synthesizer returns pattern analysis and cross-references, the report that
answers the question, a confidence level per finding and the documented gaps.
Record the overall confidence — it is a declared value output of this node and
two later nodes read it.

**Record `conclusions` in the same breath**, the node's second declared value:
the one-line conclusion of the research just reported — the sentence the
executive summary opens with, reduced to a handle. It is a handle and not the
content; the full conclusion is the report, and whoever needs the detail reads
the report. It goes onto a one-line node entry, so it must be flow-safe: no
newline, no carriage return, no tab, no quote character. A short hyphenated
phrase inside the bare charset (`adapter-scope-bounded`) is preferred and needs
no quoting at all; a plain sentence without punctuation the emitter must escape
is permitted. A value that is not flow-safe is refused at the write, which
fails this node halfway through the graph.

**Operator visibility**: refresh the dashboard after each of the four steps, so
brief, plan, findings and report appear as they land rather than all at once.
The report must be registered **before** the following gate fires — the operator
reviews it while answering.

**Recovery budgets**: step 1 one attempt, and ask the operator to clarify an
unclear question rather than guessing; step 2 two attempts, expanding the search
patterns and falling back to a mixed methodology; step 3 three attempts,
retrying only the failed gatherers and continuing with the categories that
succeeded; step 4 two attempts, requesting targeted re-gathering for the gaps.

**Default under a non-terminal driver** (`question-clarification`): none. Step 1
cannot ask an absent operator to clarify an unclear question, and it must not
guess one, so an unclear question exhausts the step's single attempt and the
node is recorded `failed`. A re-drive carrying the clarification is the route
back in.

**Phase summary key**: `phase-1`. Mirror this node's summary into
`research_context.phase_summaries.phase-1`, with `node: research-foundation` on
the entry.

---

## `foundation-approval`

A gate. Ask the question the definition carries, record the answer, and stop the
run on the stop option — nothing after a stopped node ever becomes ready.

---

## `optional-phases-decision`

Executed inline, writes no files, and decides both optional stretches of the
run independently. Its two declared boolean outputs are what the later `when`
guards read.

Read the synthesis summary and the research type, then judge each half:

- **Brainstorming is valuable** when the synthesis identified several viable
  approaches, when the problem sits in a new domain rather than a
  well-understood one, and when competing trade-offs were found.
- **Design is valuable** when the research points at architectural decisions,
  when the research type is requirements-shaped or mixed, and when the design
  artifacts would feed a development run.

Then ask — **unless the corresponding flag was already supplied**, in which case
that answer is settled and the question is not asked:

1. *"[Brainstorming recommendation]. Would you like to explore solution
   alternatives?"* — options *"Yes, explore alternatives"* and *"No, skip
   brainstorming"*.
2. *"[Design recommendation]. Would you like to generate a high-level design?"*
   — options *"Yes, generate design"* and *"No, skip design"*.

Both of these are asked **inside this node** rather than as gate nodes, because
both answers continue the run: a gate's effect vocabulary is continue or stop
with exactly one continue, and neither answer here stops anything. A "no" makes
the guarded nodes skip, and a skip satisfies everything downstream.

**Default under a non-terminal driver** (`brainstorm-opt-in`): the
recommendation this node computed from the synthesis — the same judgement that
would have been interpolated into the question text. It is recorded as the
node's brainstorming output exactly as an answer would be, and a supplied flag
still settles it without a default being taken at all.

**Default under a non-terminal driver** (`design-opt-in`): the computed design
recommendation, by the same rule, recorded as the node's design output.

**Recovery budget**: one attempt — re-evaluate the recommendation when the
synthesis reads unclearly.

---

## `solution-generation`

Delegated to the solution brainstormer through the Task tool. Read the
brainstorming-techniques reference first — divergent and convergent techniques,
scope guardrails.

> **ANTI-PATTERN**: Do NOT generate solution alternatives inline. The
> `maister:solution-brainstormer` agent has specialized multi-perspective
> analysis capabilities.

Everything node-scoped the delegate needs is in `with:`; the run-scoped four
supply the rest. `output_path` is exact — the delegate must write to
`outputs/solution-exploration.md` and nowhere else.

> **SELF-CHECK**: after the Task tool returns, verify that `outputs/solution-exploration.md` exists and contains alternatives. If missing: **STOP. Do NOT proceed.** Re-invoke the brainstormer with corrected context, ensuring `output_path` is that exact path. If the second attempt also fails, ask the operator whether to retry or to skip the brainstorming stretch.

That retry-or-skip question is the third of the in-node questions, and it exists
because re-driving a failed node needs a construct the grammar reserves without
implementing.

**Default under a non-terminal driver** (`brainstormer-retry`): none — neither
retry nor skip. With the budget exhausted and nobody to ask, the node is
recorded `failed` rather than silently skipped, because a skipped brainstorming
stretch satisfies everything downstream and would hide the failure from every
later reader. A re-drive is the operator's route back in.

This node ends with no gate: it continues straight into convergence.

**Recovery budget**: two attempts, the second with adjusted context.

**Phase summary key**: `phase-3`. Mirror this node's summary into
`research_context.phase_summaries.phase-3`, with `node: solution-generation` on
the entry.

---

## `solution-convergence`

Executed inline and interactive. This is the node the graph can say least
about, and the one where the failure modes are best documented.

*Resume check*: when the recorded decision areas already carry a chosen
approach, skip those areas and resume at the first unresolved one.

> **ANTI-PATTERN**: Do NOT present all decision areas in a single summary table and ask one combined "do you agree?" question. Each area MUST get its own detailed presentation and its own AskUserQuestion call.
>
> **ANTI-PATTERN**: Do NOT show full alternatives/pros/cons for the first area and then shortcut remaining areas to just a recommendation line + question. EVERY area gets the SAME level of detail — all alternatives with descriptions, pros, and cons. No exceptions.
>
> **ANTI-PATTERN**: Do NOT batch multiple decision areas into one AskUserQuestion call. The tool accepts up to 4 questions per call — using that capacity here IS the documented failure mode. One call = one question = one decision area. Convergence is strictly sequential.

The protocol:

1. Read `outputs/solution-exploration.md`.
2. For each decision area **sequentially** — later areas may depend on earlier
   answers, so do NOT pre-render or pre-ask a later area before the current one
   is answered. Output all of (a)-(d) **before** asking:
   a. **Area header**: the area name and why the decision matters, in a sentence
      or two of context.
   b. **Alternatives detail**: for EVERY alternative in this area, its name and
      a two-to-three-sentence description, its pros and its cons.
   c. **Recommendation**: which alternative is recommended, and why, in one
      sentence.
   d. **One question in this call**: this area's alternatives as options, the
      recommended one marked, plus a "Need more info" option. An area carrying
      more than three alternatives cannot list them all: the question tool takes
      at most four options and "Need more info" always occupies one of them. Offer
      the recommended alternative and the two strongest rivals, and name the
      remaining ones in the question text, which the operator reaches through the
      free-text option. The cap binds the option list and nothing else — every
      alternative is still presented in full at (b), and an area silently reduced
      to three is the failure this paragraph exists to prevent.
   e. If the operator picks an alternative, record the choice and move on.
   f. If the operator picks **"Need more info"**, present the detailed trade-off
      analysis for the requested alternative and then re-ask the same area. The
      loop stays inside the area; no construct in the grammar expresses it.
3. After every area is resolved, present a brief summary of the chosen
   combination. That summary belongs in this node's summary entry — alongside
   the decision areas and the deferred ideas — and never in a declared value
   output.
4. Record the chosen approach per decision area.

**What the summary entry carries.** Beside `summary` and the `decisions` list
every summary may carry, this node's phase entry carries two keys and no others:
`decision_areas`, a list whose every element has
exactly `area` (the decision area's name), `alternatives_count` (how many
alternatives were presented for it) and `chosen_approach` (the alternative the
operator picked); and `deferred_ideas`, the ideas parked rather than decided.
`decision_areas` is also what the resume check above reads — an element whose
`chosen_approach` is already set is an area a resumed run must not re-ask, so an
entry written without that key costs the operator the whole area again.

> **SELF-CHECK before each question**: did you output the alternatives with
> pros and cons for THIS area? If you showed only a recommendation line, STOP
> and output the full detail first. And does this call contain exactly one
> question about exactly one area? If it carries more, STOP and split it.

> **GATE CHECK**: verify that EVERY decision area was resolved — asked and
> answered in a terminal run, defaulted and recorded under a non-terminal one,
> and in both cases present in `decision_areas`. An area a non-terminal run
> could not default is recorded as open, never dropped. If any area was skipped
> for any reason — a missing file, a failed read — STOP and resolve it. Do not
> mark this node complete without convergence on all areas.
> Never paper over a missed gate by updating state.

**Default under a non-terminal driver** (`convergence-decisions`): each area
takes the alternative this node recommends for it, and "Need more info" is never
taken — there is nobody to present the deeper analysis to. Every area is still
worked in full: the alternatives are presented, the recommendation is reasoned,
and `chosen_approach` is written for every element of `decision_areas`, so a
resumed run re-asks nothing and the following gate shows the operator the whole
combination. An area with no recommendation is not guessed at — it is recorded
with `chosen_approach` unset and named in the context line before the gate.

This node's one declared output is the identifier of the converged approach.
Do not confuse it with the per-area chosen approaches recorded in the summary
entry: both names are kept, and they mean different things.

**Recovery budget**: one attempt — re-read the exploration file and re-present
the decision areas.

**Phase summary key**: `phase-4`. Mirror this node's summary into
`research_context.phase_summaries.phase-4`, with `node: solution-convergence` on
the entry.

---

## `convergence-approval`

A gate, guarded by the same condition as the two nodes before it. When
brainstorming was declined, this gate is skipped along with them and the run
continues to the design stretch without asking.

---

## `high-level-design`

Executed inline in three parts. Read the design-techniques reference first —
decision-record format and decision-documentation patterns.

**Part A — design direction (inline).** When convergence ran, confirm the
selected approaches. When it was skipped, use the research report's
recommendations as the design input instead. Then ask the operator the free-text
question *"Any architectural constraints or preferences?"*. The answer feeds the
delegate and decides nothing about the flow, which is why it is asked here
rather than at a gate.

**Default under a non-terminal driver** (`design-constraints`): none is
supplied, and the delegate is invoked on the convergence output and the research
report alone. This is the cheapest question in the run to default: its answer
feeds a prompt and decides nothing about the flow, so an absent one costs the
design nothing a stated constraint would have added.

**Part B — design generation (delegate).**

> **ANTI-PATTERN**: Do NOT generate architecture diagrams or decision records
> inline. The `maister:solution-designer` agent has specialized architecture and
> decision-documentation capabilities.

Invoke the solution designer through the Task tool. The node-scoped context is
in `with:`, plus the design preferences from Part A. **When brainstorming was
skipped**, `exploration` and `selected_approach` resolve to nothing: omit them
from the delegate's context entirely rather than passing empty values, and say
that the design input is the research report's recommendations.

> **SELF-CHECK**: after the Task tool returns, verify that both `outputs/high-level-design.md` and `outputs/decision-log.md` exist. If missing: **STOP. Do NOT proceed to Part C.** Re-invoke the designer with corrected context. If the second attempt also fails, ask the operator whether to retry or to skip the design stretch.

**Default under a non-terminal driver** (`designer-retry`): none — neither retry
nor skip. The budget is exhausted and nobody is there, so the node is recorded
`failed` rather than skipped, for the same reason the brainstormer's retry
question is: a skip satisfies everything downstream and would hide the failure.

**Part C — summary (inline).** Read both artifacts and present an executive
summary: the architecture style and its key components, how many decisions were
recorded, a one-line highlight per key decision, and the integration points with
the existing system where there are any.

**Recovery budget**: two attempts, the second with adjusted context.

**Phase summary key**: `phase-5`. Mirror this node's summary into
`research_context.phase_summaries.phase-5`, with `node: high-level-design` on
the entry.

---

## `design-approval`

A gate, guarded by the design condition. Skipped with the design node when the
operator declined design.

---

## `completion`

Executed inline, writes no files, and runs only when this run is its own — a
parent handles its own next steps, so the guard skips this node whenever the
run is a sub-run of another.

1. Inventory the outputs: the research report always, plus the solution
   exploration, the high-level design and the decision log when the stretches
   that produce them ran.
2. Present the executive summary: the key findings and the confidence level,
   which optional stretches ran, and the key decision highlights when they did.
3. When design artifacts exist, suggest continuing in a fresh session — clear
   the context or start a new session first, then start a development run
   against this task directory.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, with the inventory above as what it summarizes. A dispatching
chain has no second way to learn this run is over: a run that finishes and
publishes nothing leaves the chain waiting forever, with the report written and
every local sign saying success. The engine refuses a dispatched run that reaches
its end with no close-out in the outbox (`RUN-FAILED: closeout-unpublished`).
Under a terminal driver there is no seed and no outbox, and the executive summary
above is what the operator gets instead.

There is no gate after this node. The workflow ends here.

**Recovery budget**: none — this node summarizes and nothing else.
