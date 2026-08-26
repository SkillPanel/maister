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
  decided so far, verbatim, never re-summarized.

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

When a parent orchestrator invoked this workflow rather than an operator, the
`completion` node is skipped and the parent handles its own next steps. Two
things are owed to the parent instead:

1. **Copy the research report** into the parent task's `analysis/research/`
   directory, so the parent's later phases read it from their own tree.
2. **Return the handoff block** — `research_outputs`, with exactly five keys,
   each an artifact path or nothing when the stretch that writes it did not run:

```yaml
research_outputs:
  research_report: "[path to outputs/research-report.md]"
  findings_directory: "[path to analysis/findings/]"
  solution_exploration: "[path to outputs/solution-exploration.md]"
  high_level_design: "[path to outputs/high-level-design.md]"
  decision_log: "[path to outputs/decision-log.md]"
```

The key names are the parent's contract, not a convenience: a parent reads them
by name, so a renamed or omitted key reaches the parent as a missing artifact
rather than as an error.

---

## `research-foundation`

Four sequential steps, executed inline. On resume, check the artifacts each step
declares and skip the ones already on disk — the four resume checks below are
what make a re-entered run cheap instead of destructive.

**Before anything else**: when the invocation supplied no question, ask the
operator for it. Nothing downstream is meaningful without one, and inventing a
question is the documented failure mode.

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
Record the overall confidence — it is this node's declared value output and two
later nodes read it.

**Operator visibility**: refresh the dashboard after each of the four steps, so
brief, plan, findings and report appear as they land rather than all at once.
The report must be registered **before** the following gate fires — the operator
reviews it while answering.

**Recovery budgets**: step 1 one attempt, and ask the operator to clarify an
unclear question rather than guessing; step 2 two attempts, expanding the search
patterns and falling back to a mixed methodology; step 3 three attempts,
retrying only the failed gatherers and continuing with the categories that
succeeded; step 4 two attempts, requesting targeted re-gathering for the gaps.

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
      recommended one marked, plus a "Need more info" option.
   e. If the operator picks an alternative, record the choice and move on.
   f. If the operator picks **"Need more info"**, present the detailed trade-off
      analysis for the requested alternative and then re-ask the same area. The
      loop stays inside the area; no construct in the grammar expresses it.
3. After every area is resolved, present a brief summary of the chosen
   combination. That summary belongs in this node's summary entry — alongside
   the decision areas and the deferred ideas — and never in a declared value
   output.
4. Record the chosen approach per decision area.

**What the summary entry carries.** Beside `summary`, this node's phase entry
carries two keys and no others: `decision_areas`, a list whose every element has
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

> **GATE CHECK**: verify that a question was asked for EVERY decision area. If
> any area was skipped for any reason — a missing file, a failed read — STOP and
> resolve it. Do not mark this node complete without convergence on all areas.
> Never paper over a missed gate by updating state.

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

Executed inline, writes no files, and runs only when the workflow was invoked on
its own — a parent orchestrator handles its own next steps, so this node is
skipped in embedded mode.

1. Inventory the outputs: the research report always, plus the solution
   exploration, the high-level design and the decision log when the stretches
   that produce them ran.
2. Present the executive summary: the key findings and the confidence level,
   which optional stretches ran, and the key decision highlights when they did.
3. When design artifacts exist, suggest continuing in a fresh session — clear
   the context or start a new session first, then start a development run
   against this task directory.

There is no gate after this node. The workflow ends here.

**Recovery budget**: none — this node summarizes and nothing else.
