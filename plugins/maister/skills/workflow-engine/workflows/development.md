# Development workflow — node prose

The node-by-node companion to `development.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need, what guards them and what they declare. It says
nothing about the operator questions asked *inside* a node, what each node
writes into its closing summary for the gate brief, the self-checks that decide whether a
node succeeded, or how many times the engine may re-drive one. Those live here.

**State the consequence plainly**: a reader of `development.yml` alone cannot
see that the run asks eleven further questions beyond its ten gates, and the
generated diagram does not show them either. Anyone reasoning about how
interactive this workflow is must read this file, not the graph. The eleven
reach the user as eight asks, in run order:

1. `intake` — the task description, only when the invocation gave none.
2. `codebase-analysis` — one page of the clarifications the analysis could not
   settle.
3. `gap-analysis` — the scope decisions.
4. `specification`, Part A — a page of technical questions, then each open
   architecture choice in its own call.
5. `specification`, Part B — the assumptions page, with the audit opt-in as its
   last tab.
6. `verification-options` — the checks page: the reviews, browser checks and
   user documentation, one tab each.
7. `verification` — the fix loop's decision pages and its stopping question,
   only when something needs the user.
8. `user-docs` — the guide fixes, only when a suggestion adds or rewrites
   content.

Only the assumptions page and the checks page are asked on every attended run;
the rest are asked only when the run does not already know the answer.

**Every answer is recorded as one decision**, on the asking node's summary: one
`by: operator` entry per answered question — a page of four tabs is four entries
— carrying the question, the answer, the recommended answer and whether the two
match, as engine § *In-node questions* says. More details is never recorded.
These entries are what the gate brief counts as the user's own choices, so a
"Gate brief content" paragraph below never lists them again.

**Every question asked inside a node names its default here.** Under a `cockpit`
or `dispatch` driver nobody is in the session, so none of them is asked: each
takes the default its own section states and the node records it as a
`by: default` decision carrying the question's id. The rule and what is never
defaulted past belong to the engine skill, which states them once; this file
only says what each question takes.

**What a closing node writes for its gate.** Every node a gate needs writes, in
its closing `node_summaries` entry, a one-sentence `headline` (at most 220
characters) covering the whole stretch the gate closes; a `summary` carrying the
findings; the decisions the run, an audit or a default made in this node, each
credited by its `by` and never an earlier answer restated; and the risks as objects tagged `open` (still changeable, with the
`change` a revise would make), `tradeoff` (a consequence kept on purpose),
`followup` (outside this run's scope) or `stop` (the run should not go on).
Findings go in the summary, never in the risks. The writing rules are engine
§ *Before every gate*; each "Gate brief content" paragraph below names what
belongs where for its node.

**Recovery budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — an attempts key sitting
there would read like a grammar feature while being inert data the engine never
consults. Eight nodes carry a budget; the rest carry none and re-drive nothing.

**A skip does not cascade.** A node whose guard is false is marked skipped, and
a skip satisfies everything downstream. The skip is stamped in a patch that lands
no later than the next executed node's `running` patch — earlier, or in that
same patch — never after the run has moved on. That is why the closing gate of a
conditional stretch repeats its stretch's guard: an unguarded gate would fire
for a stretch that never ran.

## The phase numbers, and where they went

No gate question names a phase number; this table maps the 2.x prose form's phases
to nodes:

| 2.x phase | Node | Closing gate |
|---|---|---|
| Initialization steps 2-4 | `intake` | none — it auto-continues |
| 1 | `codebase-analysis` | none — it auto-continues |
| 2 | `gap-analysis` | `gap-approval` |
| 3 | `tdd-red` | `tdd-red-approval` |
| 4 | `ui-mockups` | `mockup-approval` |
| 5 | `specification` | `specification-approval` |
| 6 | `spec-audit` | `spec-audit-approval` |
| 7 | `planning` | `planning-approval` |
| 8 | `implementation` | `implementation-approval` |
| 9 | `tdd-green` | none — its evidence reaches `verification-approval` |
| 10 | `verification-options` | none — it auto-continues |
| 11 | `verification` | `verification-approval` |
| 12 | `e2e-verification` | `e2e-approval` |
| 13 | `user-docs` | `docs-approval` |
| 14 | `finalization` | none — the workflow ends |

The node after a gate may be skipped by its guard. The gate brief names the node
that actually runs next, with the skipped ones listed, so no node here names a
destination (engine § Gates). Each continue option's label in the definition's
`display:` block names the stretch that usually follows; where the guards leave
no usual one, the label names none.

---

## Run-scoped context

The four fields every delegate receives outside `with:` — `task_path`,
`html_style_guide_path`, the project's documentation paths and the prior-phase
passage fetched with `prior-context` — and the `${…}` substitution that fills
`with:` are the engine's, stated once in engine § *Run-scoped context* and
§ *Interpolating `${…}`*. What this workflow adds:

- **The documentation paths** are discovered by `intake` and recorded as
  `project_context.project_doc_paths`; every later node reads them from state.
- **Five artifacts get an HTML companion** when `html_output` is on: the
  specification, the implementation plan, the verification report, the
  browser-verification report and the visual-fidelity report. Each companion
  path is registered under `artifacts[].html` on the summary entry that owns it.

---

## Phase summary keys

`node_summaries` is keyed by node id; `task_context.phase_summaries` is keyed by
this workflow's own semantic keys, and the two namespaces do not line up. A node
may own more than one key — twelve keys over eight owning nodes:

| Node | `phase_summaries` keys |
|---|---|
| `intake` | `research`, `design` |
| `codebase-analysis` | `codebase_analysis`, `clarifications` |
| `gap-analysis` | `gap_analysis`, `scope_clarifications` |
| `ui-mockups` | `ui_mockups`, `design` |
| `specification` | `specification`, `architecture_decision` |
| `spec-audit` | `spec_audit` |
| `planning` | `implementation_plan` |
| `implementation` | `implementation` |

Every other node writes a node summary only. Each mirrored entry also carries
`node:` naming the node it came from, so the two directions stay readable from
either side.

**`design` has two owners, and the precedence is stated once here.** `intake`
seeds it from whatever design context it ingested; `ui-mockups` overwrites it
when that stretch runs. Last writer wins, and the last writer is `ui-mockups`.
Nowhere else in this file is that precedence restated, so this is the sentence
to read when the two entries disagree.

A phase key is never a node id. Writing one off the node id succeeds and the run
keeps going with a key nothing else reads, which is why the mapping is pinned
here rather than derived.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `intake` | `analysis` |
| `codebase-analysis` | `analysis` |
| `gap-analysis` | `analysis` |
| `tdd-red` | `verify` |
| `ui-mockups` | `spec` |
| `specification` | `spec` |
| `spec-audit` | `verify` |
| `planning` | `plan` |
| `implementation` | `code` |
| `tdd-green` | `verify` |
| `verification-options` | `plan` |
| `verification` | `verify` |
| `e2e-verification` | `verify` |
| `user-docs` | `docs` |
| `finalization` | `done` |

The ten gates are not in that table on purpose:
**each gate node renders the icon of the node it closes** — `gap-approval`
`analysis`, `tdd-red-approval` `verify`, `mockup-approval` `spec`,
`specification-approval` `spec`, `spec-audit-approval` `verify`,
`planning-approval` `plan`, `implementation-approval` `code`,
`verification-approval` `verify`, `e2e-approval` `verify`, `docs-approval`
`docs`. A gate inherits rather than owns its icon, so
a gate that picked its own would break the visual pairing between a stretch and
the approval that closes it.

---

## Embedded mode

**There is none.** This workflow is never invoked as a sub-run of another, which
is why the definition declares no embedded input and why `finalization` carries
no guard. Every reference to development elsewhere in the tree hands an operator
a next step — a suggested command, a handoff path — rather than executing one,
so there is no parent to owe a handoff block to and no output contract to keep.

If that ever changes, it changes here first, and it is the recipe the engine's
sub-run rule already sets out: an `embedded` input the engine supplies, a guard
on the closing node — `finalization`, which exists only to tell an operator the
run is over — and a workflow-level `outputs:` block declaring what a parent may
read. No engine change is involved; see the engine skill's *Sub-runs* section
and the `sub-runs.md` reference beside it. Until then a reader finding no
embedded behaviour has found the intended answer rather than a gap.

---

## `intake`

Executed inline, before any analysis. It establishes the task directory, the
state file and the two context ingests the rest of the run reads from.

**Before anything else**: when the invocation supplied no task description, ask
the operator for it. Nothing downstream is meaningful without one, and inventing
a task description is the documented failure mode. Ask it as free text — "What
should this run build or fix? One or two sentences." This is the first of the
eight asks.

**Default under a non-terminal driver** (`task-description`): none, because the
question is never reached — the start brief supplied the description and the
freeze persisted it. A non-terminal run that has no description is
`RUN-FAILED`, never a run with an invented one.

1. **Capture the clock** — read the wall clock through the shell rather than
   from context. Every timestamp written this turn uses that one value; a
   date-only or midnight-stamped value is the documented failure mode.
2. **Create and initialize** the task directory and its state file, with the
   task description, the risk placeholder and an empty `phase_summaries` map.
3. **Read the project configuration** and set `options.html_output` (default true
   when the file or the key is absent) and `options.mockup_format` (default
   `html`, read later by `ui-mockups`). When `html_output` is false, skip the
   dashboard entirely — no dashboard asset, no data projection, no browser open.
   Otherwise the freeze installed `dashboard.html` in the task root (see the
   changed paths it reported) — copy nothing; open it in the operator's browser
   by the plain absolute path, never a `file://` URL. On failure print the path;
   never block.
4. **Make sure the user has seen the start banner** (engine Step 4). It is the
   run's first message — if your messages since the freeze do not name the workflow
   and task, the checkpoints, the directory and the dashboard link, write them now,
   from the freeze's output, the paths copied as printed.
5. **Discover the project documentation** — read the documentation index under
   the project's docs directory if one exists and extract every path from its
   project-documentation section, predefined and operator-added alike. Record
   them as `project_context.project_doc_paths`, a top-level sibling of the
   orchestrator and task-context blocks and never nested inside either — the
   state writer's patch carries `project_context` as its own key.
6. **Detect research context** — when the invocation named a completed research
   task, either as the sole argument or through the research input, read that
   task's report and artifacts and copy them under `analysis/research-context/`.
   Record it as `task_context.research_reference`, carrying the copied path,
   the research question, the research type and the confidence level. Research
   **informs** every later node and skips none of them.
7. **Ingest design context from three sources** and unify them under
   `analysis/design-context/`: a product-design task path, named in the
   description or supplied through the design input, whose brief and mockups
   are copied in; inline mockup paths and design-tool links found in the
   task description, the files copied in and the links recorded; and legacy
   locations from a resumed run, migrated in. Skip silently when no source
   exists — a task with no UI surface sees no change.

   **A mockup is a picture of the thing, never the thing itself.** An ingested
   mockup becomes a *binding* input to the implementation, so a path matched out
   of the task description is ingested only when it is a design source rather
   than a file this run is going to change. Decide it per path, before copying
   anything:

   | The matched path | Treat it as |
   |---|---|
   | outside the project working tree — a scratch directory, a downloads folder, an absolute path elsewhere | a mockup: copy it in |
   | inside the project, under a design location — `design/`, `designs/`, `mockups/`, a product-design task directory, or an existing `analysis/design-context/` | a mockup: copy it in |
   | inside the project and tracked as source — `git ls-files --error-unmatch <path>` exits `0` and it is not under a design location | the **subject** of the work: do not copy it, do not give it an index row, and do not let it set `design_reference` |

   The extension alone does not decide, and matching on it alone is the failure
   this rule exists to prevent: a description reading *"fix the column order in
   `src/board.html`"* names the file the run edits, and ingesting it would make
   the pre-change file a binding design input to its own replacement — and would
   bias the run toward the mockup stretch on top. When a path is excluded by the
   table, say so in one line in the node summary, so the operator can see that a
   file they named was read as a target rather than silently ignored.

   Design-tool links — Figma, Sketch Cloud, Zeplin — are unaffected: a URL is
   never a file this run changes, and is recorded as before.

   **The design input** names a product-design task directory, or the brief
   inside one (`outputs/product-brief.md`), whose task directory is then two
   levels up. It is a design source by declaration, so the table above does not
   judge it: it is the product-design source exactly as if the description had
   named that directory. When it resolves to no product-design task — nothing
   there, or no brief — say so in one line in the node summary and continue
   without it; the operator asked for it, so its absence is never silent.
8. **Generate the design index** when anything was ingested — one row per screen
   or component with a stable id, its source mockup and a one-line description.
   Downstream nodes reference screens by those ids and by nothing else.
9. **Record `task_context.design_reference`** whenever an ingest happened —
   which of the three sources supplied it, the product-design task path when
   that was the source, how many mockups were copied, whether a brief came with
   them, and the index path. It stays unset when no source existed, and the
   specification node passes it to the specification writer.

Both declared artifacts are directories or an index inside one, and either may
be absent at run time when its source was: a node reading one must treat an
absent path as "no such context" rather than as a failure. Record each one that
was not written under this node's `absent` — `research_context` when no research
was named, `design_index` when nothing was ingested — with that as the reason
(engine § *Recording an outcome*).

**There is no gate after this node.** It auto-continues into the analysis node.

**Phase summary keys**: `research` and `design`. Mirror the research reference
into `task_context.phase_summaries.research` and the ingested design summary
into `task_context.phase_summaries.design`, each with `node: intake` on the
entry. The `design` entry is overwritten later when the mockup stretch runs —
see the precedence sentence in the phase-key section above.

**Recovery budget**: none — this node establishes state and ingests context, and
a source it cannot find is an absence rather than a failure.

---

## `codebase-analysis`

Delegated to the codebase analyzer through the Skill tool, then a short
clarification round inline.

The `maister:codebase-analyzer` skill runs this exploration every time rather
than an inline read: it dispatches parallel explorers and produces the
structured analysis every later node reads.

After the skill returns, write the analysis summary, the key files and the
primary language into state. Then ask the clarifications — the second of the
eight asks — as **one page of at most four tabs**. The count is adaptive: ask
only what the analysis could not settle, and ask nothing when it settled
everything. Each tab states, in its own question, what the analysis could not
settle and why it matters; its options are two or three answers generated from
what the analysis found, the recommended one first with its reason in its
description, and More details last when the context is longer than the tab
holds. Never ask here what the scope decisions in `gap-analysis` will decide —
the scope of the change, what to include or leave out — because those come next
with the analyzer's own recommendation. When more than four things are open,
ask the four that change the most and let the analysis's own answer stand for
the rest, named as unsettled in the file. Every answer continues the run, which
is why they are asked here rather than at a gate.

Save the answers to `analysis/clarifications.md`, then set
`task_context.clarifications_resolved` to true. A run that asked no question
still writes the file and still sets the flag: it resolved the clarifications by
having none to ask.

**Default under a non-terminal driver** (`clarifications`): none is asked, and
the analysis's own answers stand. The file is written and the flag set exactly
as they are for a run that had nothing to ask, and what the analysis could not
settle is named in the file as unsettled rather than guessed at.

**There is no gate after this node.** It auto-continues into gap analysis.

**Recovery budget**: 2 attempts — expand the search patterns on the second, and
prompt the operator when the second also comes back thin.

**Phase summary keys**: `codebase_analysis` and `clarifications`. Mirror this
node's summary into `task_context.phase_summaries.codebase_analysis` with the
key files and the primary language, and the clarification round into
`task_context.phase_summaries.clarifications`, each with `node:
codebase-analysis` on the entry.

---

## `gap-analysis`

Delegated to the gap analyzer through the Task tool. This node decides the shape
of the rest of the run: two of its three declared values are guards, and four
later nodes plus two later gates read them.

The task characteristics are the `maister:gap-analyzer` agent's assessment,
made from the codebase analysis; record them as returned rather than adjusting
them by your own sense of the change's size, because they are guards that decide
which later nodes run.

**Extract the structured result and write it to state before anything else.**
Read the five task characteristics the analyzer returns — a reproducible defect,
whether existing code is modified, whether new entities are created, whether
data operations are involved, and whether the task is UI-heavy — and write all
five under `task_context.task_characteristics`. Read the risk level and write it
to `task_context.risk_level`.

> **SELF-CHECK**: re-read the state file and confirm the five characteristics
> match what the analyzer returned. A run that recorded four of five continues
> and silently skips a stretch.

**The two declared guards.**

- `has_reproducible_defect` is the analyzer's own field, carried straight
  through. It guards the failing-test stretch and its gate, and the
  passing-test node after the implementation.
- `mockups_needed` folds the 2.x prose form's two-clause condition into one bool,
  because a `when` clause accepts exactly one optionally-negated reference and
  no expression language. It is true when the task is UI-heavy **and** the
  design-context mockups directory was not already populated by the intake
  ingest. Decide it here, declare it as one bool, and say in this node's summary
  which of the two clauses settled it.

`risk_level` is declared but guards nothing. It is state and dashboard content,
and it is a closed enum so it stays flow-safe through the flow map.

**The scope decisions.** Parse the decisions the analyzer flagged as critical or
important. When either list is non-empty, ask them — the third of the eight
asks. Every decision is its own single-select question with its own option set,
never flattened into one question's option list; critical decisions get a call
each with full context, important ones may be grouped as up to four separate
questions in one call. Each question carries its decision whole — what is
undecided, why it matters and what each option would change — never "the
decision above" (engine § *In-node questions*). The option the analyzer
recommends comes first, marked `(Recommended)`, with the analyzer's reason in its
description; More details is last while a slot is free, and every question fits
four options. When both lists are empty, record that no scope decision was
needed. Both answers continue the run either way, which is why this
is a node question and not the gate. Save the outcome to
`analysis/scope-clarifications.md`, and record
`task_context.scope_expanded` — true when a decision widened the work beyond
what the invocation described, false when none did.

**Default under a non-terminal driver** (`scope-decisions`): each decision takes
the option the analyzer recommended. A decision the analyzer left without a
recommendation is not guessed at: it stays open, is written to
`analysis/scope-clarifications.md` as open, and is recorded as an `open` risk
in this node's summary, its `change` naming the choice still to make, so it
reaches an operator at `gap-approval`.

**Seed the optional-verification defaults** from the characteristics: a UI-heavy
task seeds both browser tests and user documentation on; a task that creates new
entities seeds user documentation on. Command flags override the seeds. The two
keys are `orchestrator.options.e2e_enabled` and
`orchestrator.options.user_docs_enabled`, by those exact names — they are
`orchestrator.options` keys at this point, not declared values — the
declared bools that guard the two stretches are emitted later, by
`verification-options`.

**Gate brief content.** Read `analysis/gap-analysis.md` and write into this
node's closing `node_summaries` entry a `headline` saying, in one sentence, what
the analysis found: the gap between the code and the task, and the largest part
of it ("Tags need a field on every note and a filter on list(); nothing in the
store validates input today"). Which optional work runs next is the gate's
*Next* line, so the headline never repeats it. In `summary`, the gaps found and why each optional stretch is on or
off, said as the operator would say it ("no reproducible defect, so no failing
test first"), never by value name. In `decisions`, what the analysis settled on
its own, `by: run`; the scope answers are already there as the user's own, and
a defaulted one as `by: default`, so neither is restated as the analysis's. In
`risks`: each uncertainty the user could
still change as an `open` risk with the `change` a revise would make; each
consequence of a settled scope choice as a `tradeoff`; each gap the analysis
found outside this change's scope as a `followup`.

**When re-run after a revise.** `gap-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*, beside
the previous attempt's summary. Hand the analyzer the note and the existing
`analysis/gap-analysis.md`, and ask it to revise that analysis in place rather
than start over. Record the five characteristics, the risk level and all three
declared values again: a revise clears them, and the guards on the later
stretches read them afresh — a changed `mockups_needed` or
`has_reproducible_defect` is how a revise switches a stretch on or off. Ask the
scope decisions again only where the note reopens one; the earlier answers stand.
Say in the summary what changed and why.

**Recovery budget**: 2 attempts — re-analyze with the clarifications folded in
on the second, and ask the operator when the second also comes back thin.

**Phase summary keys**: `gap_analysis` and `scope_clarifications`. Mirror this
node's summary into `task_context.phase_summaries.gap_analysis` with the
integration points, and the scope round into
`task_context.phase_summaries.scope_clarifications` with whether scope expanded,
each with `node: gap-analysis` on the entry.

---

## `gap-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate. Record the answer, and stop the run on the stop option — nothing after
a stopped node ever becomes ready. Its revise option sends the run back to
`gap-analysis` with the operator's note (engine § Gates, *Revising at a gate*).

**Its question is deliberately neutral, and that is a recorded divergence.** The
prose form routes three ways here by reading the task characteristics and names
the destination in the question. The graph has no routing construct and needs
none: the destination is already fixed by the guards on the four nodes that
follow, so the gate asks only whether to continue at all. The gate brief carries
the detail the routed question used to carry: what the `gap-analysis` headline
and summary say was found, and the node that actually runs next.

---

## `tdd-red`

Executed inline, and only when the gap analysis found a reproducible defect.
Write a test that reproduces the defect, run it, and **confirm that it fails**.

A test that passes before any implementation has not reproduced anything. That
is the whole point of the node: the failing run is the evidence the defect
exists, and `tdd-green` later re-runs the same test as the evidence it is fixed.

Record the test file, the command that runs it and the failing output in
`implementation/tdd-red-gate.md`.

> **SELF-CHECK**: did the test actually fail, and did it fail for the reason the
> defect describes rather than for a missing import or a typo? A test failing
> for the wrong reason passes `tdd-green` for the wrong reason too.

**Gate brief content.** Read `implementation/tdd-red-gate.md` and write into
this node's closing `node_summaries` entry a `headline` saying, in one sentence,
which test now reproduces the defect and how it fails. In `summary`, the test
file, the command that runs it and the failure it produced, tied to the defect
it reproduces. In `risks`, a failure whose reason is in doubt as an `open` risk,
its `change` the rewrite that would settle it; a stretch skipped because no
failing run could be produced as a `tradeoff`, saying the fix will land without
a failing test to prove it.

**Recovery budget**: 2 attempts — rewrite the test on the second, and when the
second also cannot produce a failing run, skip the TDD stretch and document why
in the gate artifact rather than proceeding on a test that proves nothing.

---

## `tdd-red-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded by the same condition as the node before it. When no reproducible
defect was found, this gate is skipped along with `tdd-red` and the run continues
to the mockup stretch without asking.

The node after it, `ui-mockups`, is itself guarded. The gate brief names the
node that actually runs next.

**There is no matching approval for the passing test.** Once the fix lands,
`tdd-green` re-runs this test and the run goes straight on to choosing the
checks: the red-to-green evidence rides in that node's headline and reaches the
user at `verification-approval`, so the user approves the implementation once
rather than twice in a row.

---

## `ui-mockups`

Delegated to the mockup studio through the Skill tool, and only when the gap
analysis decided mockups are needed.

The `maister:mockup-studio` skill produces the mockups rather than inline
markup, because it runs design-resource discovery first — binding standards,
tokens and components — and renders against what it found.

Pass the mockup format from `options.mockup_format` (default `html`; the studio
falls back to a terminal rendering on its own when the runtime cannot serve one),
the output directory, single-pass generation, and the instruction to append
stable-id rows to the design index. Record the format actually used and any
fallback note in this node's summary — a run that fell back silently cannot be
told from one that did not. Record what the studio's design-resource discovery
bound to — the standards, design system and design skills it found — as
`task_context.design_resources`, so a later reader can tell what the screens
were rendered against.

**This node asks nothing.** The screens are reviewed at `mockup-approval`, whose
revise option sends the run back here with the operator's note; a second
accept-or-revise question in the node would only ask the same thing twice.

**Gate brief content: the gallery pointer.** The gate's own question is
authoring-time constant — it is covered by the graph hash, so it cannot
interpolate anything — and this is the compensating behaviour, which is a
recorded divergence from the 2.x prose form's interpolated question. When the studio
reports a live gallery address, write a `headline` that opens with it, verbatim,
and says how many screens it holds ("Mockups ready at http://localhost:4173 —
four screens: the board, the card editor, the empty state and the error
state"). Open the closing `summary` with the same address and the navigation the
operator has: the gallery grid, each screen, previous and next, and back to the
grid; then the screens and components designed and what each settles. A brief
that has to trim keeps the headline whole and a summary's opening sentences.
**When the companion never came up** — a terminal rendering, or a browser or
port failure — say so plainly in the headline and the summary and reference the
saved mockup files by path instead. Never write an address that was never
served. In `risks`, each screen the studio could not bind to the project's
design resources as an `open` risk, its `change` what a revise would render
instead.

**When re-run after a revise.** `mockup-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Hand the
studio the note and the existing mockups under `analysis/design-context/`, and
ask it to change what the note names and keep the rest — the same screen ids,
so the design index stays valid, with a row appended only for a screen the note
adds. Reuse the
companion server when it is still up. Write the headline and the gallery
pointer again, and say in the summary which screens changed and why.

**Companion-server teardown.** The gate is where the operator actually reviews
the screens, and it fires *after* this node returns, so the server must still be
up when it fires. Do not shut it down between generation and the gate, nor when
the gate sends the run back to revise — the re-run reuses the same server. Tear
it down **only after the gate resolves to continue**, by posting to the server's
shutdown route. On a stop, the run ends and the server goes with the session.

**Recovery budget**: none — a studio that cannot render at all falls back
rather than failing, and the fallback is a recorded note, not a retry.

**Phase summary keys**: `ui_mockups` and `design`. Mirror this node's summary
into `task_context.phase_summaries.ui_mockups` with the components designed, and
overwrite `task_context.phase_summaries.design` with the screen and component
counts and the index path, each with `node: ui-mockups` on the entry. The
overwrite is intended — see the precedence sentence in the phase-key section.

---

## `mockup-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded by the same condition as the node before it. When mockups were
not needed, this gate is skipped along with `ui-mockups` and the run continues to
the specification without asking. Record the answer, and stop the run on the
stop option.

**Its revise option is the way to change the screens.** It sends the run back to
`ui-mockups` with the operator's note (engine § Gates, *Revising at a gate*): the
studio changes what the note names against the existing mockups, and this gate
is asked again with the new gallery pointer. The revise suggestions come from
the stretch's `open` risks, so a screen that could not bind to the design
resources is offered as a change to make.

**Its question drops the interpolated gallery address, and that is a recorded
divergence.** The address is in the `ui-mockups` headline and summary, which the
gate brief renders, for the reason given in that node's section: a gate question
is frozen into the graph hash and cannot carry a value that differs per run.

---

## `specification`

Executed inline in three parts, the last of them delegated. This is the widest
node in the run: it holds two of the eight asks — the technical questions and
the assumptions page — writes three artifacts and emits the guard for the audit
stretch.

**Part A — technical and architecture clarification (inline, conditional).** The
fourth of the eight asks, in two kinds:

- **Technical questions.** When the task admits several viable approaches, ask
  what the analysis and the scope decisions left open as **one page of at most
  four tabs**, the same shape as the clarifications in `codebase-analysis`: each
  tab states what is open and why it matters, its options two or three generated
  answers, the recommended one first with its reason in its description, and
  More details last when the context is longer than the tab holds. Never ask
  again what the scope decisions already settled.
- **The architecture choice.** When several architectural approaches are
  genuinely open, each open choice is a decision area by engine § *In-node
  questions*, asked **one area per call** with its full context, never paged
  with the technical tabs or with another area: the question names the area, why
  it matters and each approach in a line; each option is an approach, the
  recommended one first with its reason, its description its key trade-off in a
  few words; More details is offered while a slot is free. An area with more
  approaches than the options hold offers the recommended one and its strongest
  rivals and names the rest in the question.
<!-- rich-picker -->
  Each approach's own option carries its full description, pros and cons as its
  preview, and the recommended one's preview adds why it is recommended.
<!-- /rich-picker -->
<!-- plain-picker
  The question carries each approach's line with its key pro and con, because
  the form shows no option descriptions beside the choices, and ends with
  "Recommended: <approach> — <reason>" before the ask.
-->

The chosen approach is passed to the specification writer so the document is
written against a decided architecture rather than around an open one. Skip this
part entirely for a simple, low-risk task with one obvious approach. Save what
was asked to `analysis/technical-clarifications.md`, then set
`task_context.tech_clarified` to true. A run that skipped this part still sets
it: it settled the technical questions by having none to ask. When it wrote no
clarifications file, it records `technical_clarifications` under this node's
`absent`, with the reason that there was one obvious approach (engine
§ *Recording an outcome*).

**Default under a non-terminal driver** (`technical-questions`): the recommended
answer to each technical question and the recommended approach for each
architecture area, and the specification is written against them. When no
approach is recommended, none is invented: the choice stays open, is written to
`analysis/technical-clarifications.md` as open, and is recorded as an `open`
risk in this node's summary, its `change` naming the choice still to make, so it
reaches an operator at `specification-approval`.

**Part B — requirements gathering (inline).** The fifth of the eight asks: one
page whose first tab confirms the specification's assumptions and whose last
tab is the audit opt-in.

*The assumptions tab.* Frame the specification questions as confirmable
assumptions rather than open prompts, with the count adapted to how much the
invocation already said: a brief description earns six to eight, a standard one
four to six, a detailed one two or three focused ones. Offer "Accept all N as
stated (Recommended)" first, its question stating each assumption on a line of
its own — never "the assumptions above" — and go through them one by one, each
stated in its own tab, four to a page, only when the user asks to (engine
§ *In-node questions*). Three are always among them whatever the count: how
users reach the feature and which personas it serves; which existing components
and patterns it should reuse; and whether any visual assets exist that have not
been ingested yet. The visual-assets assumption is the one exception to
"always": when the gap analysis recorded the task as not UI-heavy and intake
found no design source, the run already knows the answer — there is no
interface to draw — so it is not asked, and `analysis/requirements.md` says "no
visual assets: the change has no user interface" (engine § *In-node questions*,
asking only what the run does not know). Save the whole round to
`analysis/requirements.md` — the initial description, the questions and
answers, the similar features found, the functional requirements, the reuse
opportunities, the scope boundaries and the technical considerations.

*The audit tab.* Ask "Check the spec with an independent audit before planning?
It catches gaps and contradictions before any code is written." Its options: **"Yes, audit it (Recommended)"**, its description
"Cheaper than finding the same gaps during implementation", and **"No, go
straight to planning"**. Leave the tab off the page when the audit input was
already supplied — this node reads it as `audit_flag`: `yes` or `no` settles it
and nothing is asked, and the page's message says so in one line ("Specification
audit: on — asked for when the run started"). Absent means ask. Either way, the
answer becomes this node's declared boolean output in Part C. It is asked here
rather than as a gate because it decides *whether a phase runs*, which is
exactly what a `when` guard expresses, and because both answers continue the
run. A declining answer makes the audit stretch skip, and a skip satisfies
everything downstream.

**Default under a non-terminal driver** (`specification-requirements`): the
assumptions stand as framed. They are already written to be confirmable, so an
unconfirmed one is recorded in `analysis/requirements.md` and carried into the
specification as a stated assumption rather than as settled fact — which is what
`specification-approval` puts in front of an operator.

**Default under a non-terminal driver** (`audit-opt-in`): the recommended
option, so the audit runs. A supplied audit input still settles it without a
default being taken at all.

**Part C — specification creation (delegate).**

The `maister:specification-creator` agent writes the specification every time,
whatever the task's size, because it searches for reusable code and checks
requirement coverage before the audit and the planner read the result.

Invoke the specification creator through the Task tool. Everything node-scoped
it needs is in `with:`; the run-scoped five supply the rest, including the style
guide path that produces the specification's HTML companion.

If the agent returns without `implementation/spec.md`, or with one that leaves a
requirement gathered in Part B uncovered, re-invoke it with the missing context
rather than writing the specification yourself.

**Record the audit choice.** The audit tab's answer — or the supplied input, or
the default — is this node's declared boolean output, which is what guards
`spec-audit` and `spec-audit-approval`. Record the same value as
`orchestrator.options.spec_audit_enabled`, so the state file names the choice
for every reader that never sees the graph values.

**Gate brief content.** Read `implementation/spec.md` and write into this node's
closing `node_summaries` entry a `headline` naming, in one sentence, what the
specification settles and how many requirements it carries ("The spec adds tag
filtering to list() and CSV export, with 11 requirements and no breaking
change"). In `summary`, the specification title and the scope boundaries — what
is included and what is excluded. In `decisions`, the architecture approach the
analysis settled without asking, `by: run`; an architecture the user chose is
already there as their own answer, and a defaulted one as `by: default`. Only
what this node settled goes here: the scope answers given at the gap analysis,
or any other earlier answer, are never restated as the specification's. In
`risks`, each assumption the specification makes as an `open` risk whose `change`
says what would change if it is wrong ("CSV cells are never quoted", change:
"quote cells that hold a comma") — never a bare "Assumption: …", because a revise
offers that change; each consequence the specification accepts on purpose, such
as a breaking change it ships, as a `tradeoff`; each related problem it leaves
out of scope as a `followup`.

**When re-run after a revise.** `specification-approval` or
`spec-audit-approval` sent the run back, and `prior-context` carries the
operator's note under *Revision requested*, beside the previous attempt's
summaries — the audit's findings among them when the audit ran. Keep the answers
Part A and Part B already have: ask again only a question the note reopens, and
record what changed in `analysis/technical-clarifications.md` or
`analysis/requirements.md`. Do not ask the audit tab again: the answer given the
first time is `orchestrator.options.spec_audit_enabled`, and it is recorded as
the declared bool once more, because a revise clears it — unless the note asks
to change it. In Part C, hand the specification creator the note, the audit's
findings when there are any, and the existing `implementation/spec.md`, and ask
it to revise the specification in place. Say in the summary what changed, and
write the headline again for the revised specification.

**Recovery budget**: 2 attempts — regenerate the specification on the second
with the gaps named in the context.

**Phase summary keys**: `specification` and `architecture_decision`. Mirror this
node's summary into `task_context.phase_summaries.specification`, and the chosen
approach with its rationale into
`task_context.phase_summaries.architecture_decision`, each with `node:
specification` on the entry. Write the chosen approach a second time to
`task_context.architecture_decision` — the sibling field beside the summaries
map, not inside it — which is where later nodes read it from. Register the
companion path under the specification entry's `artifacts[].html`.

---

## `specification-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `specification` with the operator's note
(engine § Gates, *Revising at a gate*).

The node after it, `spec-audit`, is guarded by the boolean `specification` just
emitted. The gate brief names the node that actually runs next.

---

## `spec-audit`

Delegated to the specification auditor through the Task tool, and only when the
audit opt-in came back yes.

The `maister:spec-auditor` agent audits the specification rather than an
inline review, because it checks the spec's claims against the codebase instead
of trusting them — and it runs before any code exists, so it audits the spec
itself, not an implementation.

The auditor's prompt names its report path `verification/spec-audit.md`, and
the auditor writes the report there: a verdict — pass, pass with concerns, or
fail — issue counts by severity, and the findings themselves. The report is the
auditor's. If the auditor returns its report as text and the file does not
exist, write that returned text to the path verbatim, once; never append to the
report, edit it, annotate it or resolve its findings. Record the verdict in
state.

This node asks the operator nothing — no question about findings, no revise
round; the following gate is the operator's moment.

A failing verdict does not end the run on its own. It is what the operator reads
at the gate, and the gate's stop option is the route out.

**Gate brief content.** Read `verification/spec-audit.md` and write into this
node's closing `node_summaries` entry a `headline` giving, in one sentence, the
verdict and what it means for planning ("The audit passes the spec with two
concerns, neither blocking a plan"). In `summary`, the verdict, the issue counts
by severity and the top findings in plain words. The verdict — that the spec can
be built as written, or what stands in the way — is the headline and the summary,
never a decision. In `decisions`, only what the audit itself settled one way — a
point the spec left open that the audit resolved against the codebase — as `by:
audit`, never an earlier answer restated; a check that merely confirmed the spec is a finding, and goes in the
summary. In `risks`, each finding still
open as an `open` risk whose `change` is what a revise of the specification
would do about it, the critical ones first; a finding about something outside
this change as a `followup`. The findings are copied from the report, never
resolved here: the report stays the auditor's.

**Recovery budget**: none — an audit that returns is an audit, whatever its
verdict.

**Phase summary key**: `spec_audit`. Mirror this node's summary into
`task_context.phase_summaries.spec_audit` with the verdict, and with `node:
spec-audit` on the entry.

---

## `spec-audit-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded by the same condition as the node before it. When the audit was
declined, this gate is skipped along with `spec-audit` and the run continues to
planning without asking.

Its revise option sends the run back to `specification` with the operator's
note, and the audit's findings reach the re-run through the prior context. The
specification is then approved again at `specification-approval` and audited
again before this gate asks once more (engine § Gates, *Revising at a gate*).

---

## `planning`

Delegated to the implementation planner through the Task tool.

The `maister:implementation-planner` agent writes the plan every time, whatever
the task's size, because it produces the task groups, their dependencies and the
test-first step lists the executor dispatches from.

The planner reads the specification and, when the audit ran, its findings. When
a design index exists, it must enumerate every screen and component in it, map
each task group to the ones it implements through the visual-reference field,
and produce `implementation/visual-coverage.md` proving every screen is covered
by at least one group. When no design index exists, that artifact is not written
and the field is omitted entirely — a task with no UI surface sees no change —
and this node records `visual_coverage` under its `absent`, with the reason that
there is no design index to cover (engine § *Recording an outcome*).

If the planner returns without `implementation/implementation-plan.md`, or with
groups that leave a specification requirement uncovered, re-invoke it with the
missing context rather than writing the plan yourself.

**Gate brief content.** Read `implementation/implementation-plan.md` and write
into this node's closing `node_summaries` entry a `headline` giving, in one
sentence, how many task groups and steps the plan carries and how many waves
they run in ("Four task groups, 23 steps, in three waves"). In `summary`, the
groups in a line each and the estimated complexity. In `decisions`, the key
ordering and dependency choices the plan made, `by: run`, never an earlier
answer restated. In `risks`, each
uncertainty the user could still change as an `open` risk with the `change` a
revised plan would make; each cost the plan accepts on purpose, such as a group
that must run alone, as a `tradeoff`.

**When re-run after a revise.** `planning-approval` sent the run back, and
`prior-context` carries the operator's note under *Revision requested*. Hand the
planner the note and the existing `implementation/implementation-plan.md`, and
ask it to revise the plan in place — regroup, split or reorder what the note
names and keep the rest — and to check the coverage against the specification
again, `implementation/visual-coverage.md` included when a design index exists.
Say in the summary what changed, and write the headline again.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
gaps named in the context.

**Phase summary key**: `implementation_plan`. Mirror this node's summary into
`task_context.phase_summaries.implementation_plan` with the task-group count,
and with `node: planning` on the entry. Register the companion path under that
entry's `artifacts[].html`.

---

## `planning-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `planning` with the operator's note (engine
§ Gates, *Revising at a gate*).

---

## `implementation`

Delegated to the implementation-plan executor through the Skill tool. This is
the node that writes code, and it is the only one that does.

The `maister:implementation-plan-executor` skill writes the code every time,
whatever the plan's size, because it runs the groups, dispatches the implementers
and keeps the plan's progress marks in step with what actually landed.

**The sequential input, and where the executor reads it.** Before invoking the
skill, record the input's value as `orchestrator.options.sequential`: the
executor reads that state key rather than the node input, so an input that is
never landed there is an input the run silently ignores. When it is true the
executor runs one task group at a time instead of dispatching independent
groups in parallel waves. It defaults to parallel.

**After the skill returns**, reconcile the plan's HTML companion: run the
engine's `sync-plan` verb once against `implementation/implementation-plan.md`.
It is the call the executor makes after every wave, so it is idempotent and a
no-op without a companion — here it catches a wave whose sync was missed. A
companion still showing outstanding work after a complete run is a stale
projection rather than a finding. Then record what
landed: the groups completed, the files changed and the incremental test results.

**Gate brief content.** Read `implementation/work-log.md` and write into this
node's closing `node_summaries` entry a `headline` giving, in one sentence, what
landed and how the tests stand ("All four task groups landed; 40 of 40 tests
pass"). In `summary`, the task groups completed, the files changed and the test
results from the incremental runs. In `decisions`, each choice the executor made
on its own where the plan left room, `by: run`, never an earlier answer
restated. In `risks`, each known issue the
user could still act on as an `open` risk with its `change`; each item deferred
on purpose as a `tradeoff`; each problem found outside this change as a
`followup`.

**Recovery budget**: 5 attempts — the widest in the run, because the failures
here are ordinary and local: fix a syntax error, fix an import, fix a failing
test, and re-run. When the fifth attempt has not cleared it, stop and ask the
operator rather than continuing on a red suite.

**Phase summary key**: `implementation`. Mirror this node's summary into
`task_context.phase_summaries.implementation`, with `node: implementation` on
the entry.

---

## `implementation-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

---

## `tdd-green`

Executed inline, and only when the gap analysis found a reproducible defect —
the same guard `tdd-red` carried, repeated here because a skip does not cascade
and the two stretches are one decision.

Re-run the test `tdd-red` wrote and **confirm that it now passes**. Record the
test file, the command and the passing output in
`implementation/tdd-green-gate.md`, alongside the failing output `tdd-red`
recorded so the two read as one piece of evidence.

> **SELF-CHECK**: is this the same test, run the same way, as `tdd-red`
> recorded? A different test passing proves nothing about the defect.

**There is no gate after this node.** It continues into choosing the checks.

**Gate brief content.** There is no gate of its own after this node: its
summary is part of the stretch `verification-approval` closes, so the evidence
reaches the user there. Read `implementation/tdd-green-gate.md` and write into
this node's closing `node_summaries` entry a `headline` carrying the red-to-green
evidence in one sentence ("The failing test for the empty-tag crash now passes:
red before the fix, green after it"). In `summary`, the test that now passes, the
command and the pair of outcomes. In `risks`, any other test the change turned
red, or a doubt that the passing run exercises the defect, as an `open` risk
whose `change` is the return to the implementation that would settle it.

**Recovery budget**: 3 attempts — when the test still fails, return to the
implementation rather than adjusting the test. A test edited until it passes is
the documented failure mode of this node.

---

## `verification-options`

Executed inline, writes no files, and decides both optional verification
stretches of the run. Its two declared boolean outputs are what the later `when`
guards read.

**The checks page — the sixth of the eight asks.** One page of up to three tabs,
asked together because each answer stands on its own. A gate cannot express it:
a gate's options map option ids to routes — continue, stop or revise — and this
page picks a set of checks rather than a route.

1. **The reviews tab, which carries the verification plan.** Its question is the
   plan — the checks that always run, the recommended reviews, and the two
   conditional stretches with the reason each is on or off — written into the
   question rather than printed ahead of it. The user adjusts what they see; a
   question that does not carry the plan asks about nothing. Say exactly when
   the test suite runs: it already passed during implementation, so the first
   verification pass does not run it again, and it runs on every pass after a
   fix changes code — "Test suite: passed in implementation (40 of 40); runs
   again after any fix". Never list it under "always runs". The options are
   bundles in one single-select (engine § *In-node questions*): **"All four
   reviews (Recommended)"** — code review, pragmatic review, reality check and
   production readiness — its description saying why all four are worth their
   time for this change, then **"Code review only"**, then **"Choose
   individually"**, which opens the four as a multi-choice question after the
   page. **None of the four carries `(Recommended)` there**: the bundle already
   carried the recommendation, and a user who opened the list is choosing for
   themselves.
2. **The browser-checks tab — on or off.** The recommended option is the seed
   `gap-analysis` wrote to `orchestrator.options.e2e_enabled` — on when it is
   true, off when it is false or absent — and its description gives the reason
   in the change's own terms ("Recommended: the change adds a page, so driving
   it in a browser catches what the reviews cannot"). Its answer is this node's
   `browser_tests_enabled` output. **Not asked when the run already knows**: the
   gap analysis recorded the task as not UI-heavy, so there is no page to drive —
   record browser verification off and say so in the plan line ("Browser
   verification: off — this change has no user interface").
3. **The user-guide tab — on or off.** The recommended option is the seed
   `gap-analysis` wrote to `orchestrator.options.user_docs_enabled`, by the same
   rule, and its description gives the reason ("Recommended: the change adds
   public API, so a usage guide helps"). Its answer is this node's
   `user_docs_enabled` output.
<!-- plain-picker
Under a form picker the page is one form with a property per tab, and "Choose
individually" opens a second form with one array property holding the four
reviews, none of them preselected.
-->

**Skip a question whose answer was already supplied.** The browser-tests and
user-docs inputs are tri-state, and this node reads them as `browser_tests_flag`
and `user_docs_flag`. Absent means ask, as above. `yes` or `no` means the
invocation settled it: leave that tab off the page, record the value as the
declared output (`browser_tests_enabled` or `user_docs_enabled`) and its state
mirror, record it on this node's summary as a decision `by: operator` — the
user chose it when they started the run — and say so in the plan line in the
reviews tab ("Browser verification: on — asked for when the run started").
When both are supplied the page holds the reviews tab alone. In a terminal run the seeds `gap-analysis` wrote from the task
characteristics are defaults for the recommendation, not answers — an operator
is there, and the operator answers.

**Default under a non-terminal driver** (`standard-verifications`): the
recommended bundle, all four reviews.

**Default under a non-terminal driver** (`browser-tests`): the option this
node labels `(Recommended)`, which is the seed `gap-analysis` wrote — on for a
UI-heavy task, off otherwise. With nobody to answer, the recommendation is the
answer, and it is recorded as this node's `browser_tests_enabled` output.

**Default under a non-terminal driver** (`user-docs`): the recommendation, by
the same rule, recorded as `user_docs_enabled`.

All three tabs are asked here rather than at a gate because every answer
continues the run. A "no" makes the guarded stretch skip, and a skip satisfies everything
downstream.

**The three names of the browser-test concept are deliberate.** The input is
`browser_tests`, the declared value is `browser_tests_enabled`, and the state
option this node also writes is `e2e_enabled`. The declared value cannot carry
the digit the option name carries — the guard grammar's trailing character class
is lowercase and underscore only — and the state option is not a graph value, so
renaming it would break every existing state reader for nothing.

Also record the outcome as `orchestrator.options` keys, by these exact names.
The verifier reads them by name to decide which reviews run, so a key that is
missing or spelled differently silently runs a different review set:

- `code_review_enabled`, `pragmatic_review_enabled`, `reality_check_enabled`
  and `production_check_enabled` — one per review of the reviews tab, each
  true when the chosen bundle or the individual choice includes it and false
  otherwise.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop clears it the moment a fix changes code.
- `e2e_enabled` and `user_docs_enabled` — the second and third tabs, mirrored
  from the two declared values under the state names the run has used since
  `gap-analysis` seeded them.

**There is no gate after this node.** It auto-continues into verification.

**Recovery budget**: none — this node asks and records.

---

## `verification`

Delegated to the implementation verifier through the Skill tool, then a fix loop
inline.

The `maister:implementation-verifier` skill does the verification rather than
an inline review, because it runs the test suite first, as its own step, passes
that result into every review prompt, and compiles the completeness check and
the selected reviews into one report.

Pass no style guide path: as a skill it resolves the guide itself and gates its
own companion on the HTML output option.

**Show the issue breakdown** the verifier returns: the verdict, the counts by
severity, and the report's path from the project root
(`.maister/tasks/development/<run>/verification/implementation-verification.md`).

**The fix loop runs on its own for the obvious fixes**
(`orchestrator-patterns.md` § 6, *Fix-Then-Reverify Loop*, which this follows
step by step):

- **Fixed without asking**: every unfixed issue the verifier marked fixable and
  not risky. Log each in the work log and in
  `verification_context.fixes_applied`, and clear `skip_test_suite` when a fix
  changed code.
- **Re-checked without asking**: a full re-verification after a fix that changed
  behaviour; the verifier's `recheck: tests-only` after fixes that changed none.
  Each raises `verification_context.reverify_count` by one. **Two re-checks run
  without asking.** Say each as "re-check 1 of 2"; never announce a fix before it
  is made.
- **Asked — the seventh of the eight asks — only when** an issue needs the
  user's decision, a fix is risky, the two re-checks are spent with fixable
  issues still open, or there is no progress (the same issues return, or new
  ones keep appearing). Decisions go one per issue, paged as engine § *In-node
  questions* says, most severe first, each with generated ways to tackle it —
  the recommended one first with its reason — its tab stating the issue's file,
  line and what is wrong and each option what it changes; more than about eight
  first get the triage question. A change the user asks for here is applied,
  logged and re-checked like any fix — the gate after this node offers no
  revise, so this is where such a change is taken.
- **The stopping question** says what was fixed, what is left by severity and
  how many re-checks ran, and offers three ways on, one of them recommended
  with its reason in its description: **"Continue as is"** when only warnings
  remain ("only warnings are left; none blocks the change"); **"One more round"**
  when the last round made progress ("the last round cleared three issues; one
  more is likely to clear the rest"); **"Stop"** when a critical issue is left
  ("a critical issue is still open, and shipping past it is not safe"). More
  details is the fourth option.

**Default under a non-terminal driver** (`verification-fix-loop`): the loop runs
exactly as above — fixable, non-risky issues fixed and re-checked within the same
two re-checks — and nothing is asked. Every issue that needs a decision, and every
risky fix, stays open as an `open` risk in this node's summary, and the stopping
point takes "Continue as is". An issue still critical is **not** proceeded past:
it is an `open` risk, which reaches a person at `verification-approval`.

**Exit conditions**: nothing fixable or undecided is left; or the user chose
"Continue as is"; or they chose "Stop". **Never proceed past an unresolved
critical issue without an explicit answer saying so** — a gate answered from
outside is such an answer; a default is not.

> **GATE CHECK**: the canonical report and its companion must carry the *final*
> post-fix verdict before this node completes. A report still showing the
> pre-fix state after fixes landed is a stale artifact, and the operator answers
> the next gate against it. Recompile it rather than leaving a side file to
> carry the truth.

**Gate brief content.** Read `verification/implementation-verification.md` and
write into this node's closing `node_summaries` entry a `headline` giving, in one
sentence, the final verdict and what is left ("Verification passes after three
fixes; two warnings remain"). When `tdd-green` ran in this stretch, the headline
also says the failing test now passes, because this is the gate that closes it.
In `summary`, the total issues found, how many were fixed and how many remain by
severity. In `decisions`, each fix made without asking — its issue in a few
words — as `by: run`, so the checkpoint shows exactly what changed without the
user choosing it; each review finding the verifier itself settled as
`by: audit`; the user's answers on the decision pages are already there as their
own, and no earlier answer is restated here. In `risks`, each issue still needing a decision as an `open` risk with the
`change` that would settle it, the critical ones first; each issue the user left
for later as a `followup`; each warning kept on purpose as a `tradeoff`. When
the user chose "Stop", or the re-checks are spent with a critical issue left,
add one `stop` risk saying why the run should not go on, so the stop option is
the recommended one at the gate.

**Node summary**: no phase key. Register `verification/implementation-verification.md`
under `node_summaries.verification.artifacts`, with its companion path as the
entry's `html`, in the closing write. `verification_context.last_status` and
`verification_context.issues_found` are already recorded: the verifier writes
both on every cycle, and the dashboard's verification panel is projected from
them. The closing write does not repeat them.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed.

---

## `verification-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, unguarded. Record the answer, and stop the run on the stop option.

The node after it, `e2e-verification`, is guarded by a boolean
`verification-options` settled before the verification node ran. The gate
brief names the node that actually runs next.

---

## `e2e-verification`

Delegated to the browser-verification agent through the Task tool, and only when
the browser-tests bool came back true.

The `maister:e2e-test-verifier` agent drives a live browser through the running
application and collects evidence; it is a verification pass, so no browser
test files are written here.

Pass the specification, the verification report and, when design context exists,
the mockup directory — with it the agent additionally performs a structural
visual-fidelity comparison and writes `verification/visual-fidelity.md`. That
report is informational: it never decides whether this node succeeded. Decide
whether design context exists on disk: the mockup reference resolves to its
declared path even when the mockup stretch was skipped. When it does not exist,
pass no mockup directory and record `fidelity` under this node's `absent`, with
the reason that there was no design to compare against (engine § *Recording an
outcome*).

**This node and `user-docs` share one browser.** They must run strictly one
after the other, which the linear chain already guarantees — but never dispatch
the two delegate calls in one message even when both stretches are enabled.
Concurrent dispatch corrupts both sessions.

**Gate brief content.** Write into this node's closing `node_summaries` entry a
`headline` giving, in one sentence, the verdict and the scenario counts ("Browser
checks pass: 9 of 10 scenarios, one failing on the empty board"). In `summary`,
the verdict, the scenario counts — run, passed, failed — and, when the
visual-fidelity report was written, how closely the screens match the mockups.
In `risks`, each failed scenario as an `open` risk whose `change` is the fix it
calls for; a scenario that could not run for a reason outside this change, such
as a missing test account, as a `followup`.

**Recovery budget**: none — a browser session that cannot be established is
reported as a finding rather than retried blindly.

---

## `e2e-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded by the same condition as the node before it. When browser
verification was declined, this gate is skipped along with `e2e-verification` and
the run continues to the user documentation without asking.

The node after it, `user-docs`, is guarded by a boolean already settled. The gate
brief names the node that actually runs next.

**The 2.x prose form's "return to the phase 12 gate" is dropped, and that is a
recorded divergence.** A `needs` graph is acyclic and a back-edge fails
validation. The compensating behaviour is the ordering rule above: the browser
stretch completes or skips before the documentation stretch starts, so there is
nothing to return to.

---

## `user-docs`

Delegated to the user-documentation generator through the Task tool, and only
when the user-docs bool came back true.

The `maister:user-docs-generator` agent writes the guide rather than an inline
draft, because it captures the screenshots and writes for a non-technical reader.

**Reuse the browser stretch's screenshots when it ran.** Pass the screenshot
directory together with the instruction to reuse what applies before capturing
anything new. When the browser stretch was skipped, omit the directory entirely
rather than passing an empty path.

The guide is written to `documentation/user-guide.md` and nowhere else.

**The prior decisions are background for this delegate, not content.** Fetch
them with `prior-context --background` rather than the plain form: the guide is
for the people who use the change, and the run's decisions and risks are what it
must stay consistent with, never a section of it. The plain form's "binding"
framing once made a guide end with an appendix quoting every decision and risk
of the run.

**Take the fixes the generator names — the eighth of the eight asks, and asked
only sometimes.** The generator may report content it suggests removing or
changing — an extra helper beyond the change, a section aimed at maintainers
rather than users. When every suggestion only removes content that is not for
the guide's readers, apply them all without asking and record each as a
`by: run` decision, so the gate shows what was trimmed. Ask only when a
suggestion adds or rewrites content, because that changes what users read: one
single-select before closing, its question naming each such change in a line,
with **"Apply them, then continue (Recommended)"** first, its description
saying why the guide reads better with them, then **"Keep the guide as
written"**, and More details last. The `docs-approval` gate can only continue or
stop, so this is where such a fix is taken. Ask nothing when the generator
suggested nothing.

**Default under a non-terminal driver** (`docs-fixes`): apply the suggested
changes, recorded as one `by: default` decision.

**Gate brief content.** Write into this node's closing `node_summaries` entry a
`headline` naming, in one sentence, the guide and the flows it covers ("The user
guide covers filtering by tag and exporting to CSV, with six screenshots"). In
`summary`, the guide's path, the flows it covers and whether its screenshots were
reused from the browser stretch or captured fresh. In `decisions`, each fix
applied without asking, `by: run`. In `risks`, each flow the generator could not
document as an `open` risk whose `change` is what a second pass would add.

**Recovery budget**: none — a guide the generator could not complete is reported
rather than retried.

---

## `docs-approval`

Ask it from `gate-brief --json` as engine § Gates says.

A gate, guarded by the same condition as the node before it. When user
documentation was declined, this gate is skipped along with `user-docs` and the
run continues to finalization without asking.

---

## `finalization`

Executed inline, writes no files, and always runs — nothing invokes this
workflow as a sub-run, so there is no embedded case to guard against.

1. **Inventory the outputs**: the specification, the plan and the verification
   report always; the TDD gate artifacts, the mockups and their index, the
   audit, the browser reports and the user guide when the stretches that produce
   them ran. Say plainly which stretches were skipped and why — a reader of the
   summary should not have to infer a skip from a missing file. Take the
   inventory from disk and not from state: compare every artifact the run
   declared against what is actually there, and name every declared path that
   is absent (`orchestrator-patterns.md` § 10).
2. **Present the executive summary**: what was built, which task groups landed,
   the verification verdict with any issues left open, and the risk level the
   gap analysis recorded.
3. **Set the task status to completed**.
4. **Guide the next steps**, which for this workflow are its own four: a commit
   message covering the change; a review of the diff; a pull request; and
   deployment as the project's own process has it. Suggest a fresh session for
   whatever comes next rather than continuing in this one. **Write the commit
   message to `commit-message.txt` in the task directory** and name the file;
   never print the message itself — it alone pushed a closing message past one
   screen.

**Close for whoever reads the end** (the engine skill's run-end rule). In a
terminal run a person reads it: write the closing patch and call `run-complete`
first, then end with one wrap-up message that fits one screen and is the last
thing the run prints. Its five lead lines are the engine's — Done, Needs you,
Next (here: commit, with the message file's path), Files, Dashboard — then, a
line or two each: the rest of step 4's next steps (all four of this workflow's
own, then the fresh-session suggestion, none dropped or merged) and each
artifact the verb reported missing, named in plain words. A choice is credited
to whoever made it ("the spec keeps version 1.0.0", not "as you chose"), and
nothing about how the run was carried out appears unless it changed the result.
The verb's own lines are never shown. Under a `cockpit` or `dispatch`
driver tooling reads it, and the order is reversed: the executive summary and
every next step are printed as ordinary text **before** the `run-complete` call;
after it, print nothing but the lines the verb printed, copied exactly, its
marker last. Never type a marker the verb did not print.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the executive summary above. A dispatching chain
has no second way to learn this run is over: a run that finishes and publishes
nothing leaves the chain waiting forever, with the work done and every local sign
saying success. The engine refuses a dispatched run that reaches its end with no
close-out in the outbox (`RUN-FAILED: closeout-unpublished`). Under a terminal
driver there is no seed and no outbox, and step 4 above is what the operator gets
instead.

There is no gate after this node. The workflow ends here.

**Recovery budget**: none — this node summarizes and nothing else.
