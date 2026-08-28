# Development workflow — node prose

The node-by-node companion to `development.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need, what guards them and what they declare. It says
nothing about the operator questions asked *inside* a node, the executive
summaries printed before a gate fires, the self-checks that decide whether a
node succeeded, or how many times the engine may re-drive one. Those live here.

**State the consequence plainly**: a reader of `development.yml` alone cannot
see that the run asks ten further questions beyond its eleven gates, and the
generated diagram does not show them either. Anyone reasoning about how
interactive this workflow is must read this file, not the graph.

**Recovery budgets are prose here on purpose.** They must never be written into
`with:`, which is an unconstrained free-form object — an attempts key sitting
there would read like a grammar feature while being inert data the engine never
consults. Eight nodes carry a budget; the rest carry none and re-drive nothing.

**A skip does not cascade.** A node whose guard is false is marked skipped, and
a skip satisfies everything downstream. That is why the closing gate of a
conditional stretch repeats its stretch's guard: an unguarded gate would fire
for a stretch that never ran.

## The phase numbers, and where they went

Six gate questions name a phase number the graph does not have. The numbers are
kept verbatim from the workflow's prose form, because equality against that form
is the strongest thing anyone can assert about the two being the same workflow.
This table is how a reader resolves one to the other:

| Prose phase | Node | Closing gate |
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
| 9 | `tdd-green` | `tdd-green-approval` |
| 10 | `verification-options` | none — it auto-continues |
| 11 | `verification` | `verification-approval` |
| 12 | `e2e-verification` | `e2e-approval` |
| 13 | `user-docs` | `docs-approval` |
| 14 | `finalization` | none — the workflow ends |

A gate may name a destination that is then skipped. `tdd-red-approval` names
phase 4, `specification-approval` names the audit, `verification-approval` names
phase 12 and `e2e-approval` names phase 13 — every one of those destinations is
guarded, and a guard may be false by the time its gate is asked. That is the
normal shape of a guarded chain, not a defect in the question, but the operator
must not have to discover it after answering.

**Name the true destination before the gate fires, not after.** Immediately
before asking one of those four gates, print one line stating which node will
actually run next — evaluate the destination's guard against the values already
declared by completed nodes, exactly as the ready set will, and say plainly when
the destination the question names is going to be skipped:

```
Next: specification — phase 4 (UI mockups) is skipped, the gap analysis found mockups are not needed.
```

The line is printed by the node that closes into the gate, in the same breath as
its executive summary where it has one, so the operator answers with it on
screen. It changes no question text and no option: the `ask:` value stays
verbatim, which is what keeps the equality assertion against the prose form
intact, and the line carries what the fixed question cannot. When the guard is
true, the line says so in the same shape and costs one sentence.

---

## Run-scoped context

Four fields reach every delegate without appearing in any node's `with:`,
because they belong to the run rather than to a node:

- `task_path` — the task directory every artifact path is relative to.
- `html_style_guide_path` — passed **only** when `options.html_output` is true.
  When it is false, no companion is requested and no dashboard file is written.
- `project_doc_paths` — discovered by the first node and read from state after.
- the accumulated `phase_summaries` — the full detail of everything decided so
  far, verbatim, never re-summarized.

Anything node-scoped is in `with:` instead. Every prompt that asks a delegate to
write an artifact also carries the artifact summary contract, so the summary
this workflow lifts into state is one the delegate wrote rather than one the
engine invented. Five artifacts additionally get an HTML companion when
`html_output` is true — the specification, the implementation plan, the
verification report, the browser-verification report and the visual-fidelity
report — and each companion path is registered under `artifacts[].html` on the
summary entry that owns it.

**Operator visibility.** Refresh the dashboard when a node starts, **before
every gate fires** — the operator reviews the finished node's artifacts while
answering — after every node completes or skips, on every gate decision and at
finalization. It is a terse projection of state; never duplicate artifact
content into it.

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

The eleven gates are not in that table on purpose:
**each gate node renders the icon of the node it closes** — `gap-approval`
`analysis`, `tdd-red-approval` `verify`, `mockup-approval` `spec`,
`specification-approval` `spec`, `spec-audit-approval` `verify`,
`planning-approval` `plan`, `implementation-approval` `code`,
`tdd-green-approval` `verify`, `verification-approval` `verify`, `e2e-approval`
`verify`, `docs-approval` `docs`. A gate inherits rather than owns its icon, so
a gate that picked its own would break the visual pairing between a stretch and
the approval that closes it.

---

## Embedded mode

**There is none.** This workflow is never invoked as a sub-run of another, which
is why the definition declares no embedded input and why `finalization` carries
no guard. Every reference to development elsewhere in the tree hands an operator
a next step — a suggested command, a handoff path — rather than executing one,
so there is no parent to owe a handoff block to and no output contract to keep.

If that ever changes, it changes here first: an embedded input, a guard on
`finalization`, and a named handoff block in this section. Until then a reader
finding no embedded behaviour has found the intended answer rather than a gap.

---

## `intake`

Executed inline, before any analysis. It establishes the task directory, the
state file and the two context ingests the rest of the run reads from.

**Before anything else**: when the invocation supplied no task description, ask
the operator for it. Nothing downstream is meaningful without one, and inventing
a task description is the documented failure mode. This is the first of the ten
in-node questions.

1. **Capture the clock** — read the wall clock through the shell rather than
   from context. Every timestamp written this turn uses that one value; a
   date-only or midnight-stamped value is the documented failure mode.
2. **Create and initialize** the task directory and its state file, with the
   task description, the risk placeholder and an empty `phase_summaries` map.
3. **Read the project configuration** and set `options.html_output` (default true
   when the file or the key is absent) and `options.mockup_format` (default
   `html`, read later by `ui-mockups`). When `html_output` is false, skip the
   dashboard entirely — no dashboard asset, no data projection, no browser open.
   Otherwise copy the dashboard asset to the task root, write the initial data
   projection with every node pending, and open it in the operator's browser by
   the plain absolute path. On failure print the path; never block.
4. **Print the startup banner** — the task description, the task directory and
   the dashboard path, then say which node runs first.
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
   `analysis/design-context/`: a product-design task path, whose brief and
   mockups are copied in; inline mockup paths and design-tool links found in the
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
absent path as "no such context" rather than as a failure.

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

> **ANTI-PATTERN**: Do NOT explore the codebase inline instead of delegating.
> The `maister-codebase-analyzer` skill dispatches parallel explorers and
> produces the structured analysis the rest of the run reads.

After the skill returns, write the analysis summary, the key files and the
primary language into state. Then ask the operator **at most five** critical
clarifying questions — the second of the ten in-node questions. The count is
adaptive: ask only what the analysis could not settle, and ask nothing when it
settled everything. Both answers to every one of them continue the run, which is
why they are asked here rather than at a gate.

Save the answers to `analysis/clarifications.md`, then set
`task_context.clarifications_resolved` to true. A run that asked no question
still writes the file and still sets the flag: it resolved the clarifications by
having none to ask.

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

> **ANTI-PATTERN**: Do NOT judge the task characteristics yourself. The
> `maister-gap-analyzer` agent makes that assessment from the codebase analysis,
> and overriding it with a complexity judgement — "the UI change is small", "no
> new screens, just a component" — is the documented failure mode.

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
  through. It guards both TDD stretches and both of their gates.
- `mockups_needed` folds the prose form's two-clause condition into one bool,
  because a `when` clause accepts exactly one optionally-negated reference and
  no expression language. It is true when the task is UI-heavy **and** the
  design-context mockups directory was not already populated by the intake
  ingest. Decide it here, declare it as one bool, and say in this node's summary
  which of the two clauses settled it.

`risk_level` is declared but guards nothing. It is state and dashboard content,
and it is a closed enum so it stays flow-safe through the flow map.

**The scope decisions.** Parse the decisions the analyzer flagged as critical or
important. When either list is non-empty, ask them — the third of the ten
in-node questions. Every decision is its own single-select question with its own
option set, never flattened into one question's option list; critical decisions
get a call each with full context, important ones may be grouped as up to four
separate questions in one call. When both lists are empty, record that no scope
decision was needed. Both answers continue the run either way, which is why this
is a node question and not the gate. Save the outcome to
`analysis/scope-clarifications.md`, and record
`task_context.scope_expanded` — true when a decision widened the work beyond
what the invocation described, false when none did.

**Seed the optional-verification defaults** from the characteristics: a UI-heavy
task seeds both browser tests and user documentation on; a task that creates new
entities seeds user documentation on. Command flags override the seeds. The two
keys are `orchestrator.options.e2e_enabled` and
`orchestrator.options.user_docs_enabled`, by those exact names — they are
`orchestrator.options` keys at this point, not declared values — the
declared bools that guard the two stretches are emitted later, by
`verification-options`.

**Executive summary before the gate.** Read `analysis/gap-analysis.md` and
extract: the task type detected, the risk level, which characteristics are
enabled — the TDD stretches, the mockups, browser tests, user docs — and the
scope decisions made, if any. Print that summary immediately before
`gap-approval` fires, so the operator answers with it on screen.

**Recovery budget**: 2 attempts — re-analyze with the clarifications folded in
on the second, and ask the operator when the second also comes back thin.

**Phase summary keys**: `gap_analysis` and `scope_clarifications`. Mirror this
node's summary into `task_context.phase_summaries.gap_analysis` with the
integration points, and the scope round into
`task_context.phase_summaries.scope_clarifications` with whether scope expanded,
each with `node: gap-analysis` on the entry.

---

## `gap-approval`

A gate. Ask the question the definition carries, record the answer, and stop the
run on the stop option — nothing after a stopped node ever becomes ready.

**Its question is deliberately neutral, and that is a recorded divergence.** The
prose form routes three ways here by reading the task characteristics and names
the destination in the question. The graph has no routing construct and needs
none: the destination is already fixed by the guards on the four nodes that
follow, so the gate asks only whether to continue at all. The executive summary
`gap-analysis` printed carries the detail the routed question used to carry.

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

**Recovery budget**: 2 attempts — rewrite the test on the second, and when the
second also cannot produce a failing run, skip the TDD stretch and document why
in the gate artifact rather than proceeding on a test that proves nothing.

---

## `tdd-red-approval`

A gate, guarded by the same condition as the node before it. When no reproducible
defect was found, this gate is skipped along with `tdd-red` and the run continues
to the mockup stretch without asking.

Its question names phase 4, whose node is itself guarded. The mockup guard is
already settled here — `gap-analysis` declared it two nodes ago — so print the
true-destination line before asking, per § `The phase numbers, and where they
went`: when mockups are not needed, the operator is told that answering continue
goes to the specification, not to phase 4.

---

## `ui-mockups`

Delegated to the mockup studio through the Skill tool, and only when the gap
analysis decided mockups are needed.

> **ANTI-PATTERN**: Do NOT hand-write mockups inline. The
> `maister-mockup-studio` skill runs design-resource discovery first — binding
> standards, tokens and components — and renders against what it found.

Pass the mockup format from `options.mockup_format` (default `html`; the studio
falls back to a terminal rendering on its own when the runtime cannot serve one),
the output directory, single-pass generation, and the instruction to append
stable-id rows to the design index. Record the format actually used and any
fallback note in this node's summary — a run that fell back silently cannot be
told from one that did not. Record what the studio's design-resource discovery
bound to — the standards, design system and design skills it found — as
`task_context.design_resources`, so a later reader can tell what the screens
were rendered against.

**The revise loop, and why it is not a gate.** After the studio returns, the
operator may want changes. A gate carries exactly one continue and no back-edge,
so revise is a third effect the grammar has not got. It lives here instead, as
an in-node loop the graph and the diagram cannot show: present the rendered
screens, ask whether to accept or revise — the sixth of the ten in-node
questions — and on revise re-invoke the studio with the requested changes and
ask again. **Attempt budget: 3 revise rounds.** After the third, present what
exists and continue to the gate; the gate's stop option remains the route out
for an operator who wants none of it.

**Print the gallery pointer immediately before the gate fires.** The gate's own
question is authoring-time constant — it is covered by the graph hash, so it
cannot interpolate anything — and this is the compensating behaviour, which is a
recorded divergence from the prose form's interpolated question. When the studio
reports a live gallery address, print it verbatim in the line before the gate,
with the navigation the operator has: the gallery grid, each screen, previous
and next, and back to the grid. **When the companion never came up** — a
terminal rendering, or a browser or port failure — say so plainly and reference
the saved mockup files by path instead. Never print an address that was never
served.

**Companion-server teardown.** The gate is where the operator actually reviews
the screens, and it fires *after* this node returns, so the server must still be
up when it fires. Do not shut it down between generation and the gate, and never
shut it down from inside the revise loop — a re-invocation reuses the same
server. Tear it down **only after the gate resolves to continue**, by posting to
the server's shutdown route. On a stop, the run ends and the server goes with the
session.

**Recovery budget**: none beyond the revise rounds above — a studio that cannot
render at all falls back rather than failing, and the fallback is a recorded
note, not a retry.

**Phase summary keys**: `ui_mockups` and `design`. Mirror this node's summary
into `task_context.phase_summaries.ui_mockups` with the components designed, and
overwrite `task_context.phase_summaries.design` with the screen and component
counts and the index path, each with `node: ui-mockups` on the entry. The
overwrite is intended — see the precedence sentence in the phase-key section.

---

## `mockup-approval`

A gate, guarded by the same condition as the node before it. When mockups were
not needed, this gate is skipped along with `ui-mockups` and the run continues to
the specification without asking.

**Its question drops the interpolated gallery address, and that is a recorded
divergence.** The address is printed by `ui-mockups` in the line immediately
before this gate fires, for the reason given in that node's section: a gate
question is frozen into the graph hash and cannot carry a value that differs per
run.

---

## `specification`

Executed inline in three parts, the last of them delegated. This is the widest
node in the run: it asks two of the ten in-node questions, writes three
artifacts and emits the guard for the audit stretch.

**Part A — technical and architecture clarification (inline, conditional).**
When the task admits several viable approaches, ask three to five technical
questions — the fourth of the ten in-node questions. When several architectural
approaches are genuinely open, present two or three of them and let the operator
choose; the chosen one is passed to the specification writer so the document is
written against a decided architecture rather than around an open one. Skip this
part entirely for a simple, low-risk task with one obvious approach. Save what
was asked to `analysis/technical-clarifications.md`, then set
`task_context.tech_clarified` to true. A run that skipped this part still sets
it: it settled the technical questions by having none to ask.

**Part B — requirements gathering (inline).** Ask the specification questions,
with the count adapted to how much the invocation already said: a brief
description earns six to eight questions, a standard one four to six, a detailed
one two or three focused ones. Frame them as confirmable assumptions rather than
open prompts. Three are always asked whatever the count: how users reach the
feature and which personas it serves; which existing components and patterns it
should reuse; and whether any visual assets exist that have not been ingested
yet. Save the whole round to `analysis/requirements.md` — the initial
description, the questions and answers, the similar features found, the
functional requirements, the reuse opportunities, the scope boundaries and the
technical considerations.

**Part C — specification creation (delegate).**

> **ANTI-PATTERN**: Do NOT write the specification inline. Not because the task
> looks complex, and not only when it does — the `maister-specification-creator`
> agent writes it every time. Simplicity is never a reason to skip the
> delegation.

Invoke the specification creator through the Task tool. Everything node-scoped
it needs is in `with:`; the run-scoped four supply the rest, including the style
guide path that produces the specification's HTML companion.

> **SELF-CHECK**: after the Task tool returns, verify that
> `implementation/spec.md` exists and covers the requirements gathered in Part B.
> If missing: **STOP. Do NOT proceed.** Re-invoke with corrected context.

**The audit opt-in — the fifth of the ten in-node questions.** Ask *"Run
specification audit? (Recommended)"*, with **"Yes, run audit (Recommended)"** as
the first option and a decline as the second. Skip the question when the audit
input was already supplied: `yes` or `no` settles it and the question is not
asked. Either way, record the answer as this node's declared boolean output —
that bool is what guards `spec-audit` and `spec-audit-approval` — and record the
same value as `orchestrator.options.spec_audit_enabled`, so the state file names
the choice for every reader that never sees the graph values.

This is asked here rather than as a gate because it decides *whether a phase
runs*, which is exactly what a `when` guard expresses, and because both answers
continue the run. A declining answer makes the audit stretch skip, and a skip
satisfies everything downstream.

**Executive summary before the gate.** Read `implementation/spec.md` and
extract: the specification title, the scope boundaries — what is included and
what is excluded — how many key requirements it carries, which architecture
approach was chosen if any, and the assumptions it makes. Print that summary
immediately before `specification-approval` fires.

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

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

Its question names the audit, whose node is guarded by the boolean
`specification` just emitted — settled, so print the true-destination line before
asking, per § `The phase numbers, and where they went`. When the operator
declined the audit, the operator is told before answering that continue goes to
planning.

---

## `spec-audit`

Delegated to the specification auditor through the Task tool, and only when the
audit opt-in came back yes.

> **ANTI-PATTERN**: Do NOT review the specification yourself. The
> `maister-spec-auditor` agent audits it from a senior auditor's perspective and
> verifies claims against the codebase rather than trusting them.

The auditor returns a verdict — pass, pass with concerns, or fail — issue counts
by severity, and the findings themselves. Write all of it to
`verification/spec-audit.md` and record the verdict in state.

A failing verdict does not end the run on its own. It is what the operator reads
at the gate, and the gate's stop option is the route out.

**Executive summary before the gate.** Read `verification/spec-audit.md` and
extract: the overall verdict, the issue counts by severity, and the top one or
two critical findings when there are any. Print that summary immediately before
`spec-audit-approval` fires.

**Recovery budget**: none — an audit that returns is an audit, whatever its
verdict.

**Phase summary key**: `spec_audit`. Mirror this node's summary into
`task_context.phase_summaries.spec_audit` with the verdict, and with `node:
spec-audit` on the entry.

---

## `spec-audit-approval`

A gate, guarded by the same condition as the node before it. When the audit was
declined, this gate is skipped along with `spec-audit` and the run continues to
planning without asking.

---

## `planning`

Delegated to the implementation planner through the Task tool.

> **ANTI-PATTERN**: Do NOT break the work into steps inline. The
> `maister-implementation-planner` agent produces the task groups, their
> dependencies and their test-first step lists. Simplicity is not a reason to
> skip the delegation.

The planner reads the specification and, when the audit ran, its findings. When
a design index exists, it must enumerate every screen and component in it, map
each task group to the ones it implements through the visual-reference field,
and produce `implementation/visual-coverage.md` proving every screen is covered
by at least one group. When no design index exists, that artifact is not written
and the field is omitted entirely — a task with no UI surface sees no change.

> **SELF-CHECK**: after the Task tool returns, verify that
> `implementation/implementation-plan.md` exists and that its groups cover the
> specification's requirements. If missing: **STOP. Do NOT proceed.**

**Executive summary before the gate.** Read
`implementation/implementation-plan.md` and extract: how many task groups it
carries, the total number of implementation steps, the key dependencies between
groups, and the estimated complexity. Print that summary immediately before
`planning-approval` fires.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
gaps named in the context.

**Phase summary key**: `implementation_plan`. Mirror this node's summary into
`task_context.phase_summaries.implementation_plan` with the task-group count,
and with `node: planning` on the entry. Register the companion path under that
entry's `artifacts[].html`.

---

## `planning-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

---

## `implementation`

Delegated to the implementation-plan executor through the Skill tool. This is
the node that writes code, and it is the only one that does.

> **ANTI-PATTERN**: Do NOT write the code inline. Not for a small plan, not for
> a single-group plan — the `maister-implementation-plan-executor` skill runs
> the groups, dispatches the implementers and keeps the plan's progress marks in
> step with what actually landed.

**The sequential input, and where the executor reads it.** Before invoking the
skill, record the input's value as `orchestrator.options.sequential`: the
executor reads that state key rather than the node input, so an input that is
never landed there is an input the run silently ignores. When it is true the
executor runs one task group at a time instead of dispatching independent
groups in parallel waves. It defaults to parallel.

**After the skill returns**, reconcile the plan's HTML companion when one exists
— every group whose steps are all marked done in the document must read as done
in the companion too, and a companion still showing outstanding work after a
complete run is a stale projection rather than a finding. Then record what
landed: the groups completed, the files changed and the incremental test results.

> **SELF-CHECK**: did the executor run, or did you start editing files yourself?
> If the latter, **STOP** and invoke the skill instead.

**Executive summary before the gate.** Read `implementation/work-log.md` and
this node's own summary and extract: the task groups completed, the files
changed, the test results from the incremental runs, and any known issues or
deferred items. Print that summary immediately before
`implementation-approval` fires.

**Recovery budget**: 5 attempts — the widest in the run, because the failures
here are ordinary and local: fix a syntax error, fix an import, fix a failing
test, and re-run. When the fifth attempt has not cleared it, stop and ask the
operator rather than continuing on a red suite.

**Phase summary key**: `implementation`. Mirror this node's summary into
`task_context.phase_summaries.implementation`, with `node: implementation` on
the entry.

---

## `implementation-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

Its question names verification, but the node that follows it is `tdd-green`,
which is guarded. When no reproducible defect was found, that stretch skips and
the run reaches the verification options directly.

---

## `tdd-green`

Executed inline, and only when the gap analysis found a reproducible defect —
the same guard `tdd-red` carried, repeated here because a skip does not cascade
and the two stretches are one decision.

Re-run the test `tdd-red` wrote and **confirm that it now passes**. Record the
test file, the command and the passing output in
`implementation/tdd-green-gate.md`, alongside the failing output from the red
gate so the two read as one piece of evidence.

> **SELF-CHECK**: is this the same test, run the same way, as the red gate
> recorded? A different test passing proves nothing about the defect.

**Recovery budget**: 3 attempts — when the test still fails, return to the
implementation rather than adjusting the test. A test edited until it passes is
the documented failure mode of this node.

---

## `tdd-green-approval`

A gate, guarded by the same condition as the node before it. When no reproducible
defect was found, this gate is skipped along with `tdd-green` and the run
continues to the verification options without asking.

---

## `verification-options`

Executed inline, writes no files, and decides both optional verification
stretches of the run. Its two declared boolean outputs are what the later `when`
guards read.

**Print the verification plan first** — the obligatory checks that always run,
the recommended reviews with their current setting, and the two conditional
stretches with the reason each is on or off. The operator adjusts what they see;
a question asked without the plan on screen asks about nothing.

Then ask three questions — the seventh, eighth and ninth of the ten:

1. **Which standard verifications to run.** This one carries the multi-choice
   flag (see `gate.schema.json`), with the four reviews — code review, pragmatic
   review, reality check and production readiness — all pre-selected. A gate
   cannot express it: a gate's options map option ids to continue or stop, and
   this question picks a subset rather than a route. The generated Copilot
   variant additionally rewrites a multi-choice question into a run of
   single-choice ones, which is a second reason it belongs in a node.
2. **Browser verification on or off**, recommended on. Its answer is this node's
   `browser_tests_enabled` output.
3. **User documentation on or off**, recommended on. Its answer is this node's
   `user_docs_enabled` output.

**Skip a question whose answer was already supplied.** The browser-tests and
user-docs inputs are tri-state: absent means ask, and `yes` or `no` means the
flag settled it. The seeds `gap-analysis` wrote from the task characteristics
are defaults for the recommendation, not answers.

All three are asked here rather than at a gate because every answer continues
the run. A "no" makes the guarded stretch skip, and a skip satisfies everything
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
  and `production_check_enabled` — one per review of the first question, each
  true when that review stayed selected and false when the operator dropped it.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop clears it the moment a fix changes code.
- `e2e_enabled` and `user_docs_enabled` — the second and third answers, mirrored
  from the two declared values under the state names the run has used since
  `gap-analysis` seeded them.

**There is no gate after this node.** It auto-continues into verification.

**Recovery budget**: none — this node asks and records.

---

## `verification`

Delegated to the implementation verifier through the Skill tool, then a fix loop
inline.

> **ANTI-PATTERN**: Do NOT verify the implementation inline. The
> `maister-implementation-verifier` skill runs the completeness check, the test
> suite and the selected reviews, and compiles them into one report.

Pass no style guide path: as a skill it resolves the guide itself and gates its
own companion on the HTML output option.

**Display the issue breakdown** the verifier returns, grouped by category and
severity, with the file and line for each and whether it is fixable
automatically or needs a hand.

**The fix loop — the tenth of the ten in-node questions.** When the verdict is
anything but a clean pass, present the critical and warning issues as a numbered
list and ask which to fix: all the fixable ones, a chosen subset, or none.
Apply the chosen fixes, log each one, and re-enable the full test suite because
code changed. Record the applied fixes as `verification_context.fixes_applied`
and raise `verification_context.reverify_count` by one **before** re-invoking
the verifier: those two keys are what tell the verifier it is running after
fixes, and a re-run that cannot see them rewrites nothing, leaving the pre-fix
report standing. Then ask whether to re-run the verification; a yes re-invokes
the verifier and returns to the breakdown. Both answers continue the run, which is
why this is a node question rather than a gate.

**Exit conditions**: no critical issue remains; or the operator explicitly chose
to proceed as-is; or the budget below is exhausted, at which point ask once
whether to proceed with the known issues or to stop. **Never proceed past an
unresolved critical issue without an explicit answer saying so.**

> **GATE CHECK**: the canonical report and its companion must carry the *final*
> post-fix verdict before this node completes. A report still showing the
> pre-fix state after fixes landed is a stale artifact, and the operator answers
> the next gate against it. Recompile it rather than leaving a side file to
> carry the truth.

**Executive summary before the gate.** Read
`verification/implementation-verification.md` and extract: the total issues
found, how many were fixed, and how many remain by severity. Print that summary
immediately before `verification-approval` fires.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed.

---

## `verification-approval`

A gate, unguarded. Ask the question the definition carries, record the answer,
and stop the run on the stop option.

Its question names phase 12, whose node is guarded by a boolean
`verification-options` settled before the verification node ran, so print the
true-destination line before asking, per § `The phase numbers, and where they
went`. When browser verification was declined, the line names the user
documentation instead — or `finalization`, when that was declined as well.

---

## `e2e-verification`

Delegated to the browser-verification agent through the Task tool, and only when
the browser-tests bool came back true.

> **ANTI-PATTERN**: Do NOT generate browser test files. The
> `maister-e2e-test-verifier` agent drives a live browser through the running
> application and collects evidence; it is a verification pass, not a test-suite
> author.

Pass the specification, the verification report and, when design context exists,
the mockup directory — with it the agent additionally performs a structural
visual-fidelity comparison and writes `verification/visual-fidelity.md`. That
report is informational: it never decides whether this node succeeded.

**This node and `user-docs` share one browser.** They must run strictly one
after the other, which the linear chain already guarantees — but never dispatch
the two delegate calls in one message even when both stretches are enabled.
Concurrent dispatch corrupts both sessions.

**Executive summary before the gate**: not required here — the gate's own
question is a short confirmation and the report is registered on the dashboard
before it fires.

**Recovery budget**: none — a browser session that cannot be established is
reported as a finding rather than retried blindly.

---

## `e2e-approval`

A gate, guarded by the same condition as the node before it. When browser
verification was declined, this gate is skipped along with `e2e-verification` and
the run continues to the user documentation without asking.

Its question names phase 13, whose node is guarded by a boolean already settled,
so print the true-destination line before asking, per § `The phase numbers, and
where they went`: when the user documentation was declined, continue goes to
`finalization`.

**The prose form's "return to the phase 12 gate" is dropped, and that is a
recorded divergence.** A `needs` graph is acyclic and a back-edge fails
validation. The compensating behaviour is the ordering rule above: the browser
stretch completes or skips before the documentation stretch starts, so there is
nothing to return to.

---

## `user-docs`

Delegated to the user-documentation generator through the Task tool, and only
when the user-docs bool came back true.

> **ANTI-PATTERN**: Do NOT write the user guide inline. The
> `maister-user-docs-generator` agent captures the screenshots and writes for a
> non-technical reader.

**Reuse the browser stretch's screenshots when it ran.** Pass the screenshot
directory together with the instruction to reuse what applies before capturing
anything new. When the browser stretch was skipped, omit the directory entirely
rather than passing an empty path.

The guide is written to `documentation/user-guide.md` and nowhere else.

**Recovery budget**: none — a guide the generator could not complete is reported
rather than retried.

---

## `docs-approval`

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
   summary should not have to infer a skip from a missing file.
2. **Present the executive summary**: what was built, which task groups landed,
   the verification verdict with any issues left open, and the risk level the
   gap analysis recorded.
3. **Set the task status to completed** and refresh the dashboard one last time.
4. **Guide the next steps**: a commit message covering the change, then review,
   pull request and deployment as the project's own process has them. Suggest a
   fresh session for whatever comes next rather than continuing in this one.

There is no gate after this node. The workflow ends here.

**Recovery budget**: none — this node summarizes and nothing else.
