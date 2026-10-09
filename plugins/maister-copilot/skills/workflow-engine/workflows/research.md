# Research workflow — node prose

The node-by-node companion to `research.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need and what they declare. It says nothing about the
operator questions asked *inside* a node, the self-checks that decide whether a
node succeeded, or how many times the engine may re-drive one. Those live here.

**State the consequence plainly**: a reader of `research.yml` alone cannot see
that the run asks up to six further questions beyond the three gates it can
reach, and the
generated diagram does not show them either. In run order: the research question
when none was given, a clarification when the question is unclear, a retry when
the brainstormer fails twice, one question per decision area in the convergence,
the design constraints, and a retry when the designer fails twice. A typical run
with brainstorming on and design off answers two plus one per decision area: the
foundation gate, the areas and the convergence gate.

**The optional stretches are decided at the gates, never inside a node.**
Whether brainstorming runs, and whether the design runs without it, is the
answer to `foundation-approval`; whether the design follows brainstorming is the
answer to `convergence-approval`. Each gate offers one continue per way on, and
the continue chosen sets the values the stretches' guards read (engine § Gates).
The node each gate closes writes which continue it recommends and why, as
`recommends` on its closing summary; its section below says how it chooses.
A run for its findings only, `findings_only`, offers neither stretch: the
findings gate takes the foundation gate's place and the run ends after it.
Anyone reasoning about how interactive this workflow is must read this file,
not the graph.

**Every answered question is recorded** on the asking node's summary
`decisions`, one entry per question, as engine § *In-node questions* says:
`by: operator` with the question's id — the id its default names below — the
question, the answer, the recommended answer and whether the two match. More
details is never recorded.

**Every question asked inside a node names its default here.** Under a `cockpit`
driver whose features list `question-sets`, a node asks through the cockpit, in
one request per attempt, and each section's **With question sets** line says
whether its question goes there. Under any other `cockpit` or `dispatch` driver
nobody is in the session, so none of them is asked: each takes the default its
own section states under **Without question sets** and the node records that
it did. The rule, the recording shape and what is never defaulted past belong to
the engine skill, which states them once; this file only says what each
question takes.

**Retry budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — `max_attempts` sitting
there would read like a grammar feature while being inert data the engine never
consults.

---

## Run-scoped context

The four fields every delegate receives outside `with:` — `task_path`,
`html_style_guide_path`, the project's documentation paths and the prior-phase
passage fetched with `prior-context` — and the `${…}` substitution that fills
`with:` are the engine's, stated once in engine § *Run-scoped context* and
§ *Interpolating `${…}`*. What this workflow adds: the documentation paths are
discovered by `research-foundation` and recorded as
`research_context.project_doc_paths`, and every later node reads them from
state.

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

**What a gate needs from its closing node.** Each of the three nodes a gate
needs — `research-foundation`, `solution-convergence` and `high-level-design` —
writes, in its closing summary, what engine § *Before every gate* asks for: a
one-sentence `headline` of at most 220 characters covering the whole stretch the
gate closes, the findings in `summary`, decisions as `{decision, by}` items and
risks as `{risk, tag, change}` objects. Each node's *Gate brief content*
paragraph says what goes where. A finding is never a risk: an `open` risk is an
uncertainty the user can still change, and its `change` is what a revise
offers. Each node records only the decisions it made and the risks it raised:
one the foundation or the brainstorm already recorded stays on that node and is
never restated by a later one, reworded or not.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `research-foundation` | `analysis` |
| `solution-generation` | `spec` |
| `solution-convergence` | `plan` |
| `high-level-design` | `spec` |
| `completion` | `done` |

The four gates are not in that table on purpose:
**each gate node renders the icon of the phase it gates** — `foundation-approval`
and `findings-approval` `analysis`, `convergence-approval` `plan`,
`design-approval` `spec`. A gate inherits rather
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
and the parent records it under its node's `absent` when it adopts this run's
outcome (engine § *Recording an outcome*), so the absence is not reported as
missing.

**A parent that wants the findings and nothing after them** sets
`findings_only` in the node that starts this run. The foundation gate is then
skipped and the findings gate is asked in its place — continue, revise or stop,
with no way on to brainstorming or the design — so the child's gate cannot
offer a stretch the parent has no use for, and the two flags are not read. The
input defaults to false, and a run started by command never sets it: an
operator who wants the findings alone finishes with the research at the
foundation gate.

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

**The context seed.** The freeze sends `research_question`, the question input
verbatim, and `research_type` when the invocation supplied one, as its `context`,
so `research_context` is on disk before this node starts. Step 1 writes a
classified type over an absent one.

**Each of steps 1–3 ends with one milestone write.** This node is the longest
stretch of the run, and the dashboard is projected only when state is written, so
a node that writes nothing between its start and its end leaves the operator
looking at an empty phase for its whole length. After a step's artifacts are on
disk, make one `write-state` call. It carries this node's `node_summaries` entry
and its mirrored `phase-1` entry, and each lists every artifact written so far,
not just the latest step's. A node summary's `artifacts` field and a phase summary
entry each replace whole, so a milestone that sent only the new artifact would
erase the earlier ones. The call carries no
`nodes` patch: the node is still `running`, and only its closing write changes
that. Step 4 needs no milestone of its own, because the node's closing write
registers the report.

The `phase-1` entry also carries `steps_completed`, the steps finished so far by
name — `initialize`, `plan`, `gather`, `synthesize` — on every milestone and on
the closing write. The context fields a step settles ride in that step's
milestone as `context`, rather than as a write of their own.

**Before anything else**: when the invocation supplied no question, ask the
operator for it, as free text. Nothing downstream is meaningful without one, and
inventing a question is the documented failure mode.

**With question sets** (`research-question`): never reached either — the start
brief supplies the question.

**Without question sets** (`research-question`): none, because the
question is never reached — the start brief supplied it and the freeze persisted
it. A non-terminal run that has no research question is `RUN-FAILED`, never a
run with an invented one.

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
reading that drops part of what was asked (engine § *In-node questions*) — and
the operator's own wording goes through Other. Each reading is a question the
research could answer as it stands, so the answer is folded in without a second
round.

Then **discover the
project documentation**: read the documentation index under `.maister/docs/` if
one exists and extract every path from its project-documentation section —
predefined and operator-added alike — recording them as
`research_context.project_doc_paths`.

The step's milestone records `research_type`, `research_question`, `scope` as a
map of three lists — `included`, `excluded`, `constraints` — and
`project_doc_paths`, which is `[]` when there is no index. The planner is
handed the same scope, so a resumed run and a parent reading the state see the
boundaries the research was actually given.

### Step 2 — plan (delegate)

*Writes* `planning/research-plan.md`, `planning/sources.md`. *Resume check*: if
both exist, go to step 3.

Invoke the `maister-copilot:research-planner` agent through the Task tool. Choosing
the methodology is the planner's job, so the planner — not this node — reads
the methodology reference; pass its path rather than reading it here.

Context for the planner: `task_path`, the research brief path, the research
type, the research question, the scope, `project_doc_paths`, and
`methodology_reference` — the absolute path of
`${MAISTER_PLUGIN_ROOT}/skills/research/references/research-methodologies.md`,
which the planner reads in full before it classifies the question.

When the planner returns, the step's milestone records `methodology` and
`sources`, both lists lifted from what the planner wrote: the methods its plan
chose, and the sources `planning/sources.md` names. They are read from the two
files, not recomposed. The synthesizer's methodology comes from this record.

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

Each gatherer is the `maister-copilot:information-gatherer` agent, invoked through the
Task tool. Context for each gatherer: its own `source_category`, and the findings
file prefix it writes under `analysis/findings/`.

### Step 4 — synthesize (delegate)

*Writes* `analysis/synthesis.md`, `outputs/research-report.md`. *Resume check*:
if both exist, this node is complete.

Invoke the research synthesizer, the `maister-copilot:research-synthesizer` agent, through
the Task tool.

Context for the synthesizer: `task_path`, the findings directory path, the
research question, the research type and the methodology.

**Recommend the way on, never ask it.** Which way the run goes on is the answer
to `foundation-approval`, whose three continues set the values the brainstorming
and design guards read. This node only says which of the three it recommends, as
`recommends` on its closing summary (engine § *Before every gate*), with a
one-line reason. It reads the two flags as `brainstorm_flag` and `design_flag`:

- **`brainstorm_flag` is `yes`** — recommend `continue-to-brainstorming`, reason
  "Brainstorming asked for when the run started". The design is decided at the
  brainstorming gate.
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

The gate is still asked: a flag sets the recommendation, never the answer.

**For the findings only, recommend nothing.** When the run is for its findings
only, the foundation gate is skipped and the findings gate has one continue, so
there is no way on to choose between: write no `recommends`, and read neither
flag.

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

**Operator visibility**: the artifacts appear on the dashboard as the steps
produce them — the brief, then the plan and the sources, then the findings, each
through its step's milestone write — and the report must be registered
**before** the following gate fires, because the operator reviews it while
answering.

**Gate brief content.** Into this node's closing summary: a `headline` giving
the answer the research reached and its confidence in one sentence ("Adopting
the adapter keeps the public API intact; confidence medium, two sources
disagree on performance"). In `summary`, the top findings, each in plain words
with what it means for the question, and how many sources fed them. In
`decisions`, the choices the research itself made — the methodology, a scope
boundary drawn in step 1 — each `{decision, by: run}`; an answered
clarification is the operator decision described above, never restated as a
`by: run` item. In `risks`, each gap
the synthesis documented: one the operator could close is `{risk, tag: open,
change}`, its `change` the evidence or scope that would close it ("benchmark
the adapter on the production data set"); one outside this question is `tag:
followup`. In `artifacts`, the report carries `role: primary` and the brief, the
plan and the synthesis `role: review`, so the gate offers the report for review
first. In `recommends`, the continue of `foundation-approval` this node
recommends and its reason, as above.

**When re-run after a revise.** `foundation-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. The
resume checks above do not apply to this attempt: every artifact is on disk
from the first one, and skipping the steps that wrote them would re-run nothing.
Judge from the note which step it reaches back to, and run that step and every
step after it again. A note about the question or its scope reaches step 1; one
about the sources or the method reaches step 2; one about missing evidence
reaches step 3; one about the conclusions reaches step 4 alone. Each step
revises its artifacts in place, with the note in its delegate's context, and
keeps what the note does not touch. Record the declared values again, because a
revise clears them. Say in the summary which steps ran again and what changed.

**Recovery budgets**: step 1 one attempt, and ask the operator to clarify an
unclear question, as step 1 says, rather than guessing; step 2 two attempts, expanding the search
patterns and falling back to a mixed methodology; step 3 three attempts,
retrying only the failed gatherers and continuing with the categories that
succeeded; step 4 two attempts, requesting targeted re-gathering for the gaps.

**With question sets** (`question-clarification`): asked through the cockpit, in
this node's one request, its sharpened readings generated before it suspends
(*In-node questions*).

**Without question sets** (`question-clarification`): none. Step 1
cannot ask an absent operator to clarify an unclear question, and it must not
guess one, so an unclear question exhausts the step's single attempt and the
node is recorded `failed`. A re-drive carrying the clarification is the route
back in.

**Phase summary key**: `phase-1`. Mirror this node's summary into
`research_context.phase_summaries.phase-1`, with `node: research-foundation` on
the entry.

---

## `foundation-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded off when the run is for its findings only, and otherwise the
one that decides which way the run goes on. Its
three continues are `continue-to-brainstorming`, which sets
`brainstorming_enabled` true and `design_enabled` false so the brainstorm runs
next and its gate decides the design; `continue-to-design`, which sets them the
other way round so the brainstorm stretch is skipped and the design runs next;
and `finish-with-research`, which sets both false so every optional stretch is
skipped and the final summary runs next — or, in an embedded run, the run
simply ends. Beside them its revise. It carries no stop: finishing with the
research is the way out, and the four options are the most its question holds,
so More details is the typed fallback.

Record the answer: the writer records the values the chosen continue sets on
this gate, and the guards after it read them. The continue `research-foundation`
recommends is the recommended option, its reason on that option; each continue's
preview names where it leads. Its revise option sends the run back to
`research-foundation` with the operator's note (engine § Gates, *Revising at a
gate*), and the way on is decided again when the gate is asked once more.

**The choices are also run options.** The write that records the answer also
records the two values it set as `orchestrator.options.brainstorming_enabled`
and `orchestrator.options.design_enabled`, for every reader of the run's state
that looks there for which optional stretches were chosen. `options` merges key
by key, so the write leaves `html_output` and the recorded inputs alone. The
gate's own values are what the guards read.

---

## `findings-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, asked only when the run is for its findings only, in the place of
`foundation-approval`, which is then skipped. It closes `research-foundation`
through the skipped gate, so its brief is the foundation's brief, the report
offered for review first. Its one continue, `continue-to-completion`, sets
nothing: the skipped foundation gate reads false, so the brainstorm and design
stretches are skipped and the final summary runs next — or, in an embedded run,
the run simply ends. Beside it its revise, which sends the run back to
`research-foundation` with the operator's note exactly as the foundation gate's
does, and its stop, which ends the run without the final summary and, for a
parent, as a stopped sub-run rather than a completed one. It records no run
options.

---

## `solution-generation`

Delegated to the solution brainstormer through the Task tool. Read the
brainstorming-techniques reference first,
`${MAISTER_PLUGIN_ROOT}/skills/research/references/brainstorming-techniques.md` — divergent and convergent techniques,
scope guardrails.

The `maister-copilot:solution-brainstormer` agent generates the alternatives rather than
an inline list, because it works from the research evidence alone and writes the
exploration the convergence step below presents area by area.

Everything node-scoped the delegate needs is in `with:`; the run-scoped five
supply the rest. `output_path` is exact — the delegate must write to
`outputs/solution-exploration.md` and nowhere else.

If the agent returns without `outputs/solution-exploration.md`, or with one that
holds no alternatives, re-invoke it with corrected context and `output_path` set
to that exact path; if the second attempt also fails, ask the operator whether to
try again or to go on without the alternatives. The question says what failed
and why: *"Brainstorming failed twice: <cause>. Try again?"*. Its options are
*"Try once more (Recommended)"*, its description saying why another attempt may
work now — the context changed, the failure looked transient — and *"Skip
brainstorming"*, its description *"go on without the alternatives"*.

That retry-or-skip question is asked inside the node because sending a failed
node round again needs a construct the grammar reserves without implementing.

**With question sets** (`brainstormer-retry`): asked through the cockpit only
when it is the first thing this node asks in its attempt; after an earlier
request in the same attempt, the default below is taken (*In-node questions*).

**Without question sets** (`brainstormer-retry`): none — neither
retry nor skip. With the budget exhausted and nobody to ask, the node is
recorded `failed` rather than silently skipped, because skipped brainstorming
satisfies everything downstream and would hide the failure from every later
reader. A re-drive is the operator's route back in.

This node ends with no gate: it continues straight into convergence.

**Gate brief content.** Its closing `node_summaries` entry carries a `headline`
saying, in one sentence, how many alternatives the brainstorm found across how
many decision areas and what it recommends overall. The recommendations go in
`summary` and in the exploration file, **never in `decisions`**: a
recommendation is not a decision, and the user makes the decisions area by area
in `solution-convergence`. A `by: run` item here would credit the analysis with
what the user is about to choose. In `risks`, only what the brainstorm itself
raises; a gap the research foundation recorded stays there.

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

> **ANTI-PATTERN**: Do NOT put several decision areas in one call, as tabs of a
> page or as one combined "do you agree?" question, and do NOT offer them as
> accept-all. One call = one question = one decision area. A later area can
> depend on an earlier answer, so convergence is strictly sequential. (With
> question sets every area goes in the node's one request instead, still one
> question per area — see below.)
>
> **ANTI-PATTERN**: Do NOT give the first area its full detail and the rest a
> recommendation line. EVERY area's question, options and previews carry the
> SAME level of detail — every alternative with its description, pros and cons.

The protocol:

1. Read `outputs/solution-exploration.md`.
2. For each decision area **sequentially** — do NOT pre-ask a later area before
   the current one is answered — ask **one question in this call**, carrying the
   whole area itself (engine § *In-node questions*):
   - **the question**: the area's name, why the decision matters in a sentence
     or two, and each alternative in one line — each named in words, never by a
     code the report defines;
   - **the options**: this area's alternatives, the recommended one first and
     marked `(Recommended)`, its description giving the reason in a sentence;
     each other option's description giving its key pro and its key con in a
     few words — where the tool shows no descriptions, the question's line for
     it does — and **More details** last;
   - **the recommendation**: the question's last line before the ask is
     "Recommended: <alternative> — <reason>", because the form shows no option
     descriptions; the question is plain text, with no `**` or list markers,
     which the form shows as typed;
   - **the cap**: an area carrying more alternatives than the options hold
     beside More details offers the recommended alternative and its strongest
     rivals, and names the remaining ones in the question text, which the user
     reaches through the free-text answer. The cap binds the option list and
     nothing else — every alternative is still in the question's lines and in
     More details, and an area silently reduced is the failure this paragraph
     exists to prevent.

   If the user picks an alternative, record the choice as an operator decision
   (`question_id` the area's name as a short slug) and move on. If the user
   picks **More details** (or types "details", or asks about one alternative),
   write the area out in full as engine § *In-node questions* says — every
   alternative's two-to-three-sentence description, pros and cons and the
   detailed trade-off of the one asked about, then the recommendation and why —
   and ask the same area again. Nothing is recorded. The loop stays inside the
   area; no construct in the grammar expresses it.
3. After every area is resolved, write a brief summary of the chosen
   combination into this node's summary entry — alongside the decision areas
   and the deferred ideas — and never into a declared value output.
4. Record the chosen approach per decision area.

**What the summary entry carries.** Beside `summary` and the `decisions` list
every summary may carry, this node's phase entry carries two keys and no others:
`decision_areas`, a list whose every element has
exactly `area` (the decision area's name), `alternatives_count` (how many
alternatives were presented for it) and `chosen_approach` (the alternative the
user picked); and `deferred_ideas`, the ideas parked rather than decided.
`decision_areas` is also what the resume check above reads — an element whose
`chosen_approach` is already set is an area a resumed run must not re-ask, so an
entry written without that key costs the user the whole area again.

> **SELF-CHECK before each question**: does the question itself name THIS
> area, why it matters and every alternative, and does each option's
> description carry its pro and con — the recommended one's its reason? If the
> question holds only the area's name and the options only their names, STOP
> and write them out. And, in a terminal run, does this call contain exactly
> one question about exactly one area? If it carries more, STOP and split it.

> **GATE CHECK**: verify that EVERY decision area was resolved — asked and
> answered in a terminal run or through the cockpit, defaulted and recorded
> without question sets, and in every case present in `decision_areas`. An area
> a run without question sets could not default is recorded as open, never
> dropped. If any area was skipped
> for any reason — a missing file, a failed read — STOP and resolve it. Do not
> mark this node complete without convergence on all areas.
> Never paper over a missed gate by updating state.

**With question sets** (`convergence-decisions`): asked through the cockpit,
every area in this node's one request, one question per area with the same
detail as above; an area whose choice depends on another names that area in its
question (*In-node questions*). Each answer is recorded as an operator decision
and as the area's `chosen_approach`.

**Without question sets** (`convergence-decisions`): each area
takes the alternative this node recommends for it, recorded as `{decision, by:
default, question_id}`, and More details is never taken — there is nobody to
present the deeper analysis to. Every area is still worked in full: the
alternatives are weighed, the recommendation is reasoned, and `chosen_approach`
is written for every element of `decision_areas`, so a resumed run re-asks
nothing and the following gate shows the operator the whole combination. An
area with no recommendation is not guessed at — it is recorded with
`chosen_approach` unset and as a `{risk, tag: open, change}` risk naming the
alternatives to choose between, which the gate's revise offers.

**Recommend the design, never ask it.** Whether the design follows is the
answer to `convergence-approval`. This node says which of its two continues it
recommends, as `recommends` on its closing summary, with a one-line reason. It
reads the design flag as `design_flag`: `yes` recommends `continue-to-design`,
reason "Design asked for when the run started"; `no` recommends
`finish-without-design`, reason "Design declined when the run started".
Absent, recommend `continue-to-design` when the converged approach leaves
architectural decisions to record, the research type is requirements-shaped or
mixed, or the design would feed a development run, with the reason in this
convergence's own terms ("The chosen storage and sync approaches need their
boundaries drawn"); otherwise `finish-without-design`, saying why ("The chosen
approach is a configuration change with nothing to design").

**Gate brief content.** `convergence-approval` closes the stretch from the
brainstorm to this node. Into this node's closing
summary: a `headline` naming the converged approach and how many areas it
settles in one sentence. In `summary`, the chosen combination in a line per
area and the deferred ideas in one line. In `decisions`, the operator's answer
per area as recorded above, or the defaults; the brainstormer's per-area
recommendations stay on its own node, and nothing earlier is restated here. In `risks`,
the trade-offs the chosen combination accepts on purpose, `tag: tradeoff`; an
area left open, `tag: open` with the `change` that would settle it; a deferred
idea worth its own task, `tag: followup` — never a risk the foundation or the
brainstorm already recorded, which the gate reads from there. In `recommends`,
the continue of `convergence-approval` this node recommends and its reason, as
above.

**When re-run after a revise.** `convergence-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. The
resume check above does not apply to this attempt — every area carries a choice
from the first one. The earlier choices stand: read them from this node's
summary entry, which stays on record until this attempt rewrites it, and re-ask
only the areas the note reopens, each in full as above. Without question sets,
take the alternative the note
names for each area it names — recorded as the operator's choice — and keep the
rest. Record the declared value again, because a revise clears it, and say in
the summary which areas changed.

This node's one declared output is the identifier of the converged approach.
Do not confuse it with the per-area chosen approaches recorded in the summary
entry: both names are kept, and they mean different things.

**Recovery budget**: one attempt — re-read the exploration file and re-present
the decision areas.

**Phase summary key**: `phase-4`. Mirror this node's summary into
`research_context.phase_summaries.phase-4`, with `node: solution-convergence` on
the entry. Its `decision_areas`, when mirrored, takes the node's own shape —
`{area, alternatives_count, chosen_approach}` per area — never a list of names;
the writer refuses any other shape.

---

## `convergence-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded by the same condition as the two nodes before it, and the one
that decides the design after brainstorming. When the foundation gate skipped
brainstorming, this gate is skipped along with it, and the design follows the
foundation gate's answer. Its two continues are `continue-to-design`, which
sets `design_enabled` true so the design runs next, and `finish-without-design`,
which sets it false so the design stretch is skipped and the final summary runs
next; beside them its revise and its stop. Record the answer, and stop the run
on the stop option. The continue `solution-convergence` recommends is the
recommended option, its reason on that option.

The write that records a continue also records its value as
`orchestrator.options.design_enabled`, as `foundation-approval` does.

Its revise option sends the run back to `solution-convergence` with the
operator's note, which re-asks only the areas the note reopens (engine § Gates,
*Revising at a gate*); the brainstorm is not run again.

---

## `high-level-design`

Executed inline in three parts. Read the design-techniques reference first,
`${MAISTER_PLUGIN_ROOT}/skills/research/references/design-techniques.md` —
decision-record format and decision-documentation patterns.

**Part A — design direction (inline).** When convergence ran, confirm the
selected approaches. When the foundation gate went to the design and skipped
brainstorming, use the research report's
recommendations as the design input instead. Then ask *"Any architectural
constraints or preferences for the design?"*, the question naming the selected
approach per area (or the report's recommendations) in a line each, so the user
answers against what they can see. Its options are the answers themselves:
*"No extra constraints (Recommended)"* first, its description saying the design
follows the chosen approach and the research alone, then one to three
constraints generated from what the research found — "Keep zero runtime
dependencies", "Stay ESM-only" — each worded so it can be handed to the
designer as it stands. Anything else, or a combination, is typed through Other.
The answer feeds the delegate and decides nothing about the flow, which is why
it is asked here rather than at a gate.

**With question sets** (`design-constraints`): asked through the cockpit, in
this node's one request (*In-node questions*).

**Without question sets** (`design-constraints`): none is
supplied, and the delegate is invoked on the convergence output and the research
report alone. This is the cheapest question in the run to default: its answer
feeds a prompt and decides nothing about the flow, so an absent one costs the
design nothing a stated constraint would have added.

**Part B — design generation (delegate).**

The `maister-copilot:solution-designer` agent writes the architecture and the decision
records rather than an inline draft, because it produces the C4 views and the
decision log in the shapes Part C presents.

Invoke the solution designer through the Task tool. The node-scoped context is
in `with:`, plus the design preferences from Part A. **When brainstorming was
skipped**, `exploration` and `selected_approach` resolve to nothing: omit them
from the delegate's context entirely rather than passing empty values, and say
that the design input is the research report's recommendations.

If the agent returns without both `outputs/high-level-design.md` and
`outputs/decision-log.md`, re-invoke it with corrected context before Part C; if
the second attempt also fails, ask the operator whether to try again or to go on
without the design: *"High-level design failed twice: <cause>. Try again?"*,
with *"Try once more (Recommended)"*, its description saying why another attempt
may work now, and *"Skip the design"*, its description *"finish with the
research and the chosen approach"*.

**With question sets** (`designer-retry`): asked through the cockpit only when
it is the first thing this node asks in its attempt; after an earlier request in
the same attempt — the constraints question, say — the default below is taken
(*In-node questions*).

**Without question sets** (`designer-retry`): none — neither retry
nor skip. The budget is exhausted and nobody is there, so the node is recorded
`failed` rather than skipped, for the same reason the brainstormer's retry
question is: a skip satisfies everything downstream and would hide the failure.

**Part C — summary (inline).** Read both artifacts and present an executive
summary: the architecture style and its key components, how many decisions were
recorded, a one-line highlight per key decision, and the integration points with
the existing system where there are any.

**When re-run after a revise.** `design-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Keep the
Part A answer unless the note changes a constraint, and do not ask it again. In
Part B, hand the solution designer the note and both existing artifacts, and ask
it to revise the design and the decision log in place — a decision the note
overturns is recorded as superseded rather than deleted. Say in the summary what
changed.

**Gate brief content.** Into this node's closing summary: a `headline` naming
the architecture style and how many decisions were recorded, in one sentence.
In `summary`, the Part C executive summary — the key components, a line per key
decision and the integration points. In `decisions`, the key design decisions,
each `{decision, by: run}` — only what this node settled, never a convergence
answer or another earlier answer restated; the constraints answer is the
operator decision described above. In `risks`, a decision the designer could not settle without
an answer, `tag: open` with the `change` that answer would make; a consequence
the design accepts on purpose, `tag: tradeoff`; work it names for later,
`tag: followup` — only what the design raises, never an earlier node's risk
restated.

**Recovery budget**: two attempts, the second with adjusted context.

**Phase summary key**: `phase-5`. Mirror this node's summary into
`research_context.phase_summaries.phase-5`, with `node: high-level-design` on
the entry.

---

## `design-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded by the design condition: the design was chosen at the foundation
gate or at the brainstorming gate. Skipped with the design node otherwise. Its revise option sends the run back to
`high-level-design` with the operator's note (engine § Gates, *Revising at a
gate*).

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
3. Suggest the next step as the command that takes it: in a fresh session —
   clear the context or start a new session first —
   `/maister-copilot:development --research=<this task directory, from the project root>`
   to build on the findings.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, with the inventory above as what it summarizes. A dispatching
chain has no second way to learn this run is over: a run that finishes and
publishes nothing leaves the chain waiting forever, with the report written and
every local sign saying success. The engine refuses a dispatched run that reaches
its end with no close-out in the outbox (`RUN-FAILED: closeout-unpublished`).
Under a terminal driver there is no seed and no outbox, and the executive summary
above is what the user gets instead.

There is no gate after this node. The workflow ends here.

**Close for whoever reads the end** (the engine skill's run-end rule). In a terminal run a
person reads it: write the closing patch and call `run-complete` first, then end with one
wrap-up message that fits one screen and is the last thing the run prints. Its sections
are the engine's six — Done (the answer and its confidence, in a sentence), Needs you (each open
item stated as an item to take into the next run, never asked as a question, and each artifact
the verb reported missing, named in plain words), Follow-ups, Next (the command from step 3),
Files (the outputs from the inventory), Dashboard — and nothing follows the Dashboard line. Nothing about how the run was carried out appears
unless it changed the result. The verb's own lines are never shown. Under a `cockpit` or `dispatch` driver tooling reads it: the executive summary goes
before the `run-complete` call, in the same final message or an earlier one, and the turn ends
on the lines the verb printed, its marker last and nothing after it. The same rule holds for a
run a gate's stop option ended, which never reaches this node. An embedded run, whose guard
skips this node, ends as a sub-run does: in session with no wrap-up, since its parent's ending
carries it, and under a driver on the verb's marker.

**Recovery budget**: none — this node summarizes and nothing else.
