# Development workflow — node prose

The node-by-node companion to `development.yml`: what the graph cannot carry —
the questions asked *inside* a node, what each node writes for its gate brief,
the self-checks that decide success, and each node's recovery budget. The engine
executes every `direct:` node from its section below.

**The run asks eleven questions beyond its gates**, which neither the graph nor
its diagram shows. They reach the user as nine asks, in run order:

1. `intake` — the task description, only when the invocation gave none.
2. `codebase-analysis` — one page of the clarifications the analysis could not
   settle.
3. `gap-analysis` — the scope decisions.
4. `specification`, Part A — a page of technical questions, then each open
   architecture choice in its own call.
5. `specification`, Part B — the drafted stories, then the assumptions page.
6. `spec-audit` — one question per audit finding that needs a decision, only
   when the audit ran and left one.
7. `verification-options` — the checks page: the reviews and the user
   documentation, one tab each.
8. `verification` — one question per issue that needs the user, then the fix
   loop's stopping question, only when something needs the user.
9. `user-docs` — the guide fixes, only when a suggestion adds or rewrites
   content.

Only the assumptions page and the checks page are asked on every attended run;
the rest are asked only when the run does not already know the answer. Every
answer is recorded as engine `references/in-node-questions.md` says; the gate
brief counts those entries as the user's own, so no "Gate brief content"
paragraph below lists them again.

**Every question asked inside a node names its default here.** Under a `cockpit`
driver whose features list `question-sets`, a node asks through the cockpit, in
one request per attempt, and each section's **With question sets** line says
whether its question goes there. Under any other `cockpit` or `dispatch` driver
nobody is in the session: each question takes the default its section states
under **Without question sets**, recorded as a `by: default` decision carrying
the question's id. The rule and what is never defaulted past are the engine's.

**When the run's policy classes in-node questions** — the freeze recorded
`orchestrator.classes_questions` — a node sends the question set it would ask to the writer
before asking anything, and asks only the ids the writer's `ask:` line names. The rest were
settled, defaulted or held under the run's autonomy ceiling and are already on the node's
summary. The engine skill states the rule once; no section below changes for it.

**What a closing node writes for its gate**: a `headline`, a `summary` with the
findings, the decisions this node made, and the risks it raised, tagged `open`
(with the `change` a revise would make), `tradeoff`, `followup` or `stop` — by
engine `references/gates.md` § *Before every gate*. Each "Gate brief content"
paragraph below names what belongs where for its node.

**A skip does not cascade.** A node whose guard is false is marked skipped, and
a skip satisfies everything downstream. The skip is stamped in a patch that
lands no later than the next executed node's `running` patch — earlier, or in
that same patch — never after the run has moved on. That is why the closing gate
of a conditional stretch repeats its stretch's guard. The gate brief names the
node that actually runs next, with the skipped ones listed, so no node here
names a destination.

**There is no embedded mode.** Nothing runs this workflow as a sub-run, so the
definition declares no embedded input, `finalization` carries no guard, and
there is no handoff block or output contract to keep.

## Run-scoped context

Every delegate prompt opens with the `run-context --node=<this node>` output,
pasted unedited (artifact writers: `prior-context --node=<this node>`, which
prints that block first): the task path, the HTML style guide, the documentation
paths, the scratch rule and the companions the node owes. What this workflow
adds:

- **The documentation paths** are discovered by `intake` and recorded as
  `project_context.project_doc_paths`; every later node reads them from state.

## Phase summary keys

Twelve keys over eight owning nodes; every other node writes a node summary
only. Each mirrored entry carries `node:` naming the node it came from.

| Node | `phase_summaries` keys, and what each carries beyond the summary |
|---|---|
| `intake` | `research` (the research reference), `design` (the ingested design) |
| `codebase-analysis` | `codebase_analysis` (key files, primary language), `clarifications` |
| `gap-analysis` | `gap_analysis` (integration points), `scope_clarifications` (whether scope expanded) |
| `ui-mockups` | `ui_mockups` (components designed), `design` (screen and component counts, index path) |
| `specification` | `specification`, `architecture_decision` (the chosen approach and its rationale) |
| `spec-audit` | `spec_audit` (the verdict) |
| `planning` | `implementation_plan` (the task-group count) |
| `implementation` | `implementation` |

The `specification` and `implementation_plan` entries register their companion
path under `artifacts[].html`.

**`design` has two owners.** `intake` seeds it from whatever design context it
ingested; `ui-mockups` overwrites it when that stretch runs. Last writer wins,
and the last writer is `ui-mockups`.

## `intake`

Executed inline, before any analysis, with no gate after it. It establishes the
task directory, the state file and the context ingests the rest of the run reads
from.

**Before anything else**: when the invocation supplied no task description, ask
for it as free text — "What should this run build or fix? One or two sentences."
Never invent one.

**With question sets** (`task-description`): never reached either — the start
brief supplies the description.

**Without question sets** (`task-description`): none, because the
question is never reached — the start brief supplied the description and the
freeze persisted it. A non-terminal run that has no description is
`RUN-FAILED`, never a run with an invented one.

1. **Capture the clock** through the shell rather than from context. Every
   timestamp written this turn uses that one value; a date-only or
   midnight-stamped value is the documented failure mode.
2. **Create and initialize** the task directory and its state file, with the
   task description, the risk placeholder and an empty `phase_summaries` map.
3. **Read the project configuration** and set `options.html_output` (default
   true when the file or the key is absent) and `options.mockup_format` (default
   `html`, read later by `ui-mockups`). When `html_output` is false, skip the
   dashboard entirely — no dashboard asset, no data projection, no browser open.
   Otherwise the freeze installed `dashboard.html` in the task root — copy
   nothing; open it in the operator's browser by the plain absolute path, never
   a `file://` URL. On failure print the path; never block.
4. **Make sure the user has seen the start banner** (engine Step 4); if not,
   write it now from the freeze's output.
5. **Discover the project documentation** — read the documentation index under
   the project's docs directory if one exists and extract every path from its
   project-documentation section, predefined and operator-added alike. Record
   them as `project_context.project_doc_paths`, a top-level sibling of the
   orchestrator and task-context blocks, never nested inside either.
6. **Detect research context** — when the invocation named a completed research
   task, as the sole argument or through the research input, copy its report and
   artifacts under `analysis/research-context/`. Record
   `task_context.research_reference`: the copied path, the research question,
   the research type and the confidence level. Research **informs** every later
   node and skips none of them.
7. **Ingest design context from three sources** and unify them under
   `analysis/design-context/`: a product-design task path, named in the
   description or supplied through the design input, whose brief and mockups are
   copied in; inline mockup paths and design-tool links in the task description,
   the files copied in and the links recorded; and legacy locations from a
   resumed run, migrated in. Skip silently when no source exists.

   **A mockup is a picture of the thing, never the thing itself.** An ingested
   mockup is a *binding* input to the implementation, so decide per matched
   path, before copying anything:

   | The matched path | Treat it as |
   |---|---|
   | outside the project working tree — a scratch directory, a downloads folder, an absolute path elsewhere | a mockup: copy it in |
   | inside the project, under a design location — `design/`, `designs/`, `mockups/`, a product-design task directory, or an existing `analysis/design-context/` | a mockup: copy it in |
   | inside the project and tracked as source — `git ls-files --error-unmatch <path>` exits `0` and it is not under a design location | the **subject** of the work: do not copy it, do not give it an index row, and do not let it set `design_reference` |

   The extension alone never decides: *"fix the column order in
   `src/board.html`"* names the file the run edits. When the table excludes a
   path, say so in one line in the node summary. Design-tool links — Figma,
   Sketch Cloud, Zeplin — are never files this run changes, and are recorded.

   **The design input** names a product-design task directory, or the brief
   inside one (`outputs/product-brief.md`), whose task directory is two levels
   up. It is a design source by declaration, so the table does not judge it.
   When it resolves to no product-design task — nothing there, or no brief — say
   so in one line in the node summary and continue without it.
8. **Ingest the architecture** when the architecture input names one: a
   high-level design document, or a research task directory whose
   `outputs/high-level-design.md` is that document. Copy it to
   `analysis/architecture-context/high-level-design.md`, and `decision-log.md`
   from the same directory to `analysis/architecture-context/decision-log.md`
   when it exists. Record `task_context.architecture_reference`: the source
   path, the copied path and whether a decision log came with it. The
   architecture **constrains** the specification and the plan and skips no node.
   When the input resolves to no file, say so in one line in the node summary
   and continue without it.
9. **Generate the design index** when any design source was ingested — one row
   per screen or component with a stable id, its source mockup and a one-line
   description.
   Downstream nodes reference screens by those ids and by nothing else.
10. **Record `task_context.design_reference`** whenever a design ingest happened
    — which of the three sources supplied it, the product-design task path when
    that was the source, how many mockups were copied, whether a brief came with
    them, and the index path. It stays unset when no source existed.

Any of the three declared artifacts may be absent when its source was. Record
each one not written under this node's `absent` — `research_context` when no
research was named, `design_index` when nothing was ingested,
`architecture_context` when no architecture was supplied or it resolved to no
file — with that as the reason (engine § *Recording an outcome*).

**Recovery budget**: none — a source it cannot find is an absence, not a
failure.

## `codebase-analysis`

Delegated to the `maister:codebase-analyzer` skill through the Skill tool, every
time, then a short clarification round inline; no gate follows.

After the skill returns, write the analysis summary, the key files and the
primary language into state. Then ask the clarifications as **one page of at
most four tabs**, only what the analysis could not settle, and nothing when it
settled everything. Each tab states what is open and why it matters; its options
are two or three answers generated from what the analysis found, the recommended
one first with its reason in its description, and More details last when the
context is longer than the tab holds. Never ask here what the scope decisions in
`gap-analysis` will decide. When more than four things are open, ask the four
that change the most and let the analysis's own answer stand for the rest, named
as unsettled in the file.

Save the answers to `analysis/clarifications.md`, then set
`task_context.clarifications_resolved` to true — also when no question was
asked: the file is still written.

**With question sets** (`clarifications`): asked through the cockpit, in this
node's one request (engine `references/in-node-questions.md`).

**Without question sets** (`clarifications`): none is asked, and the analysis's
own answers stand. The file is written and the flag set as for a run that had
nothing to ask, and what the analysis could not settle is named in the file as
unsettled rather than guessed at.

**Recovery budget**: 2 attempts — expand the search patterns on the second, and
prompt the operator when the second also comes back thin.

## `gap-analysis`

Delegated to the `maister:gap-analyzer` agent through the Task tool. Two of its
three declared values are guards that decide which later nodes run, so record
the analyzer's assessment as returned, never adjusted by your own sense of the
change's size.

**Write the structured result to state before anything else**: the five task
characteristics — a reproducible defect, whether existing code is modified,
whether new entities are created, whether data operations are involved, and
whether the task is UI-heavy — under `task_context.task_characteristics`, and
the risk level to `task_context.risk_level`.

> **SELF-CHECK**: re-read the state file and confirm the five characteristics
> match what the analyzer returned. A run that recorded four of five continues
> and silently skips a stretch.

**The two declared guards.**

- `has_reproducible_defect` is the analyzer's own field, carried straight
  through. It guards the failing-test stretch and its gate, and `tdd-green`.
- `mockups_needed` is true when the task is UI-heavy **and** the design-context
  mockups directory was not already populated by the intake ingest. Say in this
  node's summary which of the two clauses settled it.

`risk_level` is declared but guards nothing; it is state and dashboard content.

**The scope decisions.** When the analyzer flagged critical or important
decisions, ask them. Every decision is its own single-select question with its
own option set; critical decisions get a call each with full context, important
ones may be grouped as up to four separate questions in one call. Each question
carries its decision whole — what is undecided, why it matters and what each
option would change (engine `references/in-node-questions.md`). The analyzer's
recommended option comes first, marked `(Recommended)`, with its reason in its
description; More details is last while a slot is free. When both lists are
empty, record that no scope decision was needed. Save the outcome to
`analysis/scope-clarifications.md`, and record `task_context.scope_expanded` —
true when a decision widened the work beyond what the invocation described.

**With question sets** (`scope-decisions`): asked through the cockpit, in this
node's one request, each decision its own question, critical ones included
(engine `references/in-node-questions.md`).

**Without question sets** (`scope-decisions`): each decision takes the option
the analyzer recommended. A decision left without a recommendation is not
guessed at: it is written to `analysis/scope-clarifications.md` as open and
recorded as an `open` risk, its `change` naming the choice still to make, so it
reaches an operator at `gap-approval`.

**Seed the optional-verification defaults** from the characteristics: a UI-heavy
task seeds both browser tests and user documentation on; a task that creates new
entities seeds user documentation on. Command flags override the seeds. The keys
are `orchestrator.options.e2e_enabled` and
`orchestrator.options.user_docs_enabled`, by those exact names. They only seed:
`user_docs_enabled` is declared later by `verification-options`, and
`browser_tests_enabled` is set by the answer to `verification-approval`, whose
recommendation `verification` takes from this seed.

**Gate brief content.** Read `analysis/gap-analysis.md`. The `headline` says
what the analysis found: the gap between the code and the task, and the largest
part of it ("Tags need a field on every note and a filter on list(); nothing in
the store validates input today"); which optional work runs next is the gate's
*Next* line, never the headline. In `summary`, the gaps found and why each
optional stretch is on or off, said as the operator would say it ("no
reproducible defect, so no failing test first"), never by value name. In
`decisions`, what the gap analysis itself settled, `by: run` — not what
`codebase-analysis` already recorded, even where the analysis repeats it. In
`risks`: each uncertainty the user could still change as `open`; each
consequence of a settled scope choice as a `tradeoff`; each gap outside this
change's scope as a `followup`.

**When re-run after a revise** (`gap-approval`, the note in `prior-context`):
hand the analyzer the note and the existing `analysis/gap-analysis.md` to revise
in place. Record the five characteristics, the risk level and all three declared
values again — a revise clears them, and a changed `mockups_needed` or
`has_reproducible_defect` is how a revise switches a stretch on or off. Ask the
scope decisions again only where the note reopens one. Say in the summary what
changed and why.

**Recovery budget**: 2 attempts — re-analyze with the clarifications folded in
on the second, and ask the operator when the second also comes back thin.

## `gap-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate.
Record the answer, and stop the run on the stop option. Its revise option sends
the run back to `gap-analysis` with the operator's note (engine
`references/gates.md`, *Revising at a gate*). Its question is deliberately
neutral: the guards on the nodes that follow fix the destination, and the brief
carries what `gap-analysis` found and the node that runs next.

## `tdd-red`

Executed inline, and only when the gap analysis found a reproducible defect.
Write a test that reproduces the defect, run it, and **confirm that it fails**:
the failing run is the evidence the defect exists, and `tdd-green` re-runs the
same test as the evidence it is fixed. Record the test file, the command that
runs it and the failing output in `implementation/tdd-red-gate.md`.

> **SELF-CHECK**: did the test actually fail, and did it fail for the reason the
> defect describes rather than for a missing import or a typo? A test failing
> for the wrong reason passes `tdd-green` for the wrong reason too.

**Gate brief content.** Read `implementation/tdd-red-gate.md`. The `headline`
says which test now reproduces the defect and how it fails. In `summary`, the
test file, the command and the failure, tied to the defect. In `risks`, a
failure whose reason is in doubt as `open`, its `change` the rewrite that would
settle it; a stretch skipped because no failing run could be produced as a
`tradeoff`, saying the fix will land without a failing test to prove it.

**Recovery budget**: 2 attempts — rewrite the test on the second, and when the
second also cannot produce a failing run, skip the TDD stretch and document why
in the gate artifact rather than proceeding on a test that proves nothing.

## `tdd-red-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
guarded by the same condition as `tdd-red`, and skipped with it.

**There is no matching approval for the passing test.** `tdd-green` re-runs this
test after the fix, and its red-to-green evidence reaches the user at
`verification-approval`, so the implementation is approved once, not twice.

## `ui-mockups`

Delegated to the `maister:mockup-studio` skill through the Skill tool, and only
when the gap analysis decided mockups are needed. The studio runs
design-resource discovery first and renders against what it found.

Pass the mockup format from `options.mockup_format` (default `html`; the studio
falls back to a terminal rendering on its own when the runtime cannot serve
one), the output directory, single-pass generation, and the instruction to
append stable-id rows to the design index. Record the format actually used and
any fallback note in this node's summary. Record what the discovery bound to —
the standards, design system and design skills it found — as
`task_context.design_resources`.

**This node asks nothing.** The screens are reviewed at `mockup-approval`, whose
revise option sends the run back here with the operator's note.

**Gate brief content: the gallery pointer.** The gate question is fixed by the
graph hash and cannot carry the address, so the brief does. When the studio
reports a live gallery address, open the `headline` with it, verbatim, and say
how many screens it holds ("Mockups ready at http://localhost:4173 — four
screens: the board, the card editor, the empty state and the error state"). Open
the `summary` with the same address and the navigation the operator has: the
gallery grid, each screen, previous and next, and back to the grid; then the
screens and components designed and what each settles. A brief that has to trim
keeps the headline whole and the summary's opening sentences. **When the
companion never came up** — a terminal rendering, or a browser or port failure —
say so plainly and reference the saved mockup files by path. Never write an
address that was never served. In `risks`, each screen the studio could not bind
to the project's design resources as `open`, its `change` what a revise would
render instead.

**When re-run after a revise** (`mockup-approval`, the note in `prior-context`):
hand the studio the note and the existing mockups under
`analysis/design-context/`, to change what the note names and keep the rest —
the same screen ids, a row appended only for a screen the note adds. Reuse the
companion server when it is still up. Write the gallery pointer again, and say
which screens changed and why.

**Companion-server teardown.** The gate fires *after* this node returns, so the
server must still be up then. Do not shut it down between generation and the
gate, nor on a revise. Tear it down **only after the gate resolves to
continue**, by posting to the server's shutdown route. On a stop, the server
goes with the session.

**Recovery budget**: none — a studio that cannot render falls back rather than
failing, and the fallback is a recorded note, not a retry.

## `mockup-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
guarded by the same condition as `ui-mockups`, and skipped with it. Record the
answer, and stop the run on the stop option. **Its revise option is the way to
change the screens**: it sends the run back to `ui-mockups` with the operator's
note (engine `references/gates.md`, *Revising at a gate*), and the gate is asked
again with the new gallery pointer. The revise suggestions come from the
stretch's `open` risks.

## `specification`

Executed inline in three parts, the last of them delegated. It holds the
technical questions, the drafted stories and the assumptions page, writes three
artifacts, and recommends whether the audit runs.

**An architecture constrains every part.** When the intake copied one in — this
node reads it as `architecture` — the interfaces, contracts and decisions it
names are constraints on this repository's part of the change, never work to
redo or choices to make again. A point where the codebase, the requirements or
the specification cannot follow it is raised as an `open` risk, never resolved
silently either way.

**Part A — technical and architecture clarification (inline, conditional).**

- **Technical questions.** When the task admits several viable approaches, ask
  what the analysis and the scope decisions left open as **one page of at most
  four tabs**, shaped like the `codebase-analysis` clarifications. Never ask
  again what the scope decisions settled.
- **The architecture choice.** When several architectural approaches are
  genuinely open, each open choice is a decision area by engine
  `references/in-node-questions.md`, asked **one area per call** with its full
  context, never paged with the technical tabs or another area: the question
  names the area, why it matters and each approach in a line; each option is an
  approach, the recommended one first with its reason, its description its key
  trade-off in a few words; More details while a slot is free. An area with more
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

An area the architecture input already decides is not asked. The chosen approach
is passed to the specification writer. Skip this part entirely for a simple,
low-risk task with one obvious approach. Save what was asked to
`analysis/technical-clarifications.md`, then set `task_context.tech_clarified`
to true — also when this part was skipped; when it wrote no clarifications file,
record `technical_clarifications` under this node's `absent`, the reason that
there was one obvious approach (engine § *Recording an outcome*).

**With question sets** (`technical-questions`): asked through the cockpit, in
this node's one request, each architecture area its own question beside the
technical ones (engine `references/in-node-questions.md`).

**Without question sets** (`technical-questions`): the recommended answer to
each technical question and the recommended approach for each architecture area.
When no approach is recommended, none is invented: the choice is written to
`analysis/technical-clarifications.md` as open and recorded as an `open` risk,
its `change` naming the choice still to make, so it reaches an operator at
`specification-approval`.

**Part B — requirements gathering (inline).** The drafted stories, then one page
confirming the specification's assumptions.

*The stories.* Group what the specification still has to settle by topic: each
behaviour a user or a calling system triggers and then observes — deactivating a
user, exporting a report — is one topic, drafted into one story by engine
`references/in-node-questions.md` (*One topic is one drafted story*), never
asked as separate tabs. Draft each from the analysis, the gap analysis and its
scope answers, and the design context. A story the design brief already carries
(`analysis/design-context/brief.md`) is carried as it stands and not asked
again. Ask each story as its own question, id `user-story-<topic>`, up to four
that stand on their own to a page; a story whose framing depends on another's
answer waits for the next page. A change nobody triggers or observes — a
refactor, or a defect fix the failing test already pins — has no stories. Each
story goes into `analysis/requirements.md` under **User stories**, by its id,
with its five parts and how it was settled: accepted, accepted with the listed
corrections and written as corrected, the alternative, the operator's own words,
or taken as drafted without an answer and marked drafted, not confirmed. The
specification keeps that section and the verification checks it, by id.

**With question sets** (`user-story`): each story is its own question in the
same request as the technical questions, its `why` naming what the story settles
(engine `references/in-node-questions.md`). Each draft, its corrections and its
alternative are in `analysis/requirements.md` before the node suspends, so the
answer is applied from the file.

**Without question sets** (`user-story`): each story is taken as drafted and
recorded `by: default` under its own id. `analysis/requirements.md` marks it
drafted, not confirmed, and the specification carries it that way.

*The assumptions tab.* Only what changes no story is an assumption. Frame the
specification questions as confirmable assumptions, the count adapted to how
much the invocation already said: a brief description earns six to eight, a
standard one four to six, a detailed one two or three. Offer "Accept all N as
stated (Recommended)" first, its question stating each assumption on a line of
its own, and go through them one by one, each in its own tab, four to a page,
only when the user asks to (engine `references/in-node-questions.md`). Two are
always among them: which existing components and patterns the change should
reuse, and whether any visual assets exist that have not been ingested yet. A
third, how users reach the feature and which personas it serves, only when the
run drafted no story. The visual-assets assumption is not asked when the gap
analysis recorded the task as not UI-heavy and intake found no design source;
`analysis/requirements.md` then says "no visual assets: the change has no user
interface". Save the whole round to `analysis/requirements.md` — the initial
description, the user stories, the questions and answers, the similar features
found, the functional requirements, the reuse opportunities, the scope
boundaries and the technical considerations.

**With question sets** (`specification-requirements`): asked through the
cockpit, in the same request as the technical questions (engine
`references/in-node-questions.md`); going through the assumptions one by one
would be a second ask, so it is not offered.

**Without question sets** (`specification-requirements`): the assumptions stand
as framed, recorded in `analysis/requirements.md` and carried into the
specification as stated assumptions rather than settled fact.

**Part C — specification creation (delegate).** Invoke the
`maister:specification-creator` agent through the Task tool, every time. Its
node-scoped context is in `with:`; the `prior-context --node=specification`
output supplies the rest, including the `html:` line for the companion. When an
architecture was ingested, hand it over with the rule above: a conflict the
creator finds is listed in the specification as an open risk. If the agent
returns without `implementation/spec.md`, or with one that leaves a requirement
from Part B uncovered — a story in `analysis/requirements.md` missing from the
specification's User Stories under its id among them — re-invoke it with the
missing context rather than writing the specification yourself.

**Recommend the audit, never ask it.** Write `recommends` on the closing summary
naming one continue of `specification-approval`, with a one-line reason (engine
`references/gates.md` § *Before every gate*):

- **The audit input was supplied** — this node reads it as `audit_flag`. `yes`
  recommends `continue-to-spec-audit`, reason "Asked for when the run started";
  `no` recommends `continue-to-planning`, reason "Declined when the run
  started". The gate is still asked.
- **Absent** — recommend `continue-to-spec-audit`, reason "Cheaper than finding
  the same gaps during implementation", or a reason in this change's own terms
  ("The spec changes a public API; an audit checks every caller before
  planning"). Recommend `continue-to-planning` only when this specification has
  nothing an audit would check, and say why ("A one-line configuration change
  with no open assumption").

**Gate brief content.** Read `implementation/spec.md`. The `headline` names what
the specification settles and how many requirements it carries ("The spec adds
tag filtering to list() and CSV export, with 11 requirements and no breaking
change"). In `summary`, the specification title and the scope boundaries. In
`decisions`, the architecture approach the analysis settled without asking,
`by: run`, and the decisions the architecture input settled for this repository,
named as taken from it, `by: run`. In `risks`, each assumption the specification
makes as `open`, its `change` what would change if it is wrong ("CSV cells are
never quoted", change: "quote cells that hold a comma") — never a bare
"Assumption: …"; a story taken as drafted is one such assumption, its `change`
the correction Part B listed for it; each consequence accepted on purpose, such
as a breaking change, as a `tradeoff`; each related problem left out of scope as
a `followup`; each conflict with the architecture input as `open`, its `change`
what would follow either way. In `recommends`, as above.

**When re-run after a revise** (`specification-approval` or
`spec-audit-approval`, the note in `prior-context` beside the previous
summaries, the audit's findings among them when it ran): keep the answers Part A
and Part B already have, asking again only what the note reopens, and record
what changed in `analysis/technical-clarifications.md` or
`analysis/requirements.md`. Write `recommends` again: when the audit already
ran, recommend it again only when the revision changed what it checked, and say
so; when the note asks for or against the audit, recommend what it says. In Part
C, hand the creator the note, the audit's findings still open — never the ones
its fix pass applied — and the existing `implementation/spec.md` to revise in
place. Say in the summary what changed, and write the headline again.

**Recovery budget**: 2 attempts — regenerate the specification on the second
with the gaps named in the context.

**Write the chosen approach to `task_context.architecture_decision`** — the
sibling field beside the summaries map — where later nodes read it.

## `specification-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
unguarded, and the one that decides the audit. `continue-to-spec-audit` sets
`spec_audit_enabled` true so the audit stretch runs next; `continue-to-planning`
sets it false so the stretch is skipped; beside them its revise and its stop.
Record the answer, and stop the run on the stop option; the guards of
`spec-audit` and `spec-audit-approval` read the recorded value. The continue
`specification` recommends is the recommended option. Its revise sends the run
back to `specification` with the operator's note (engine `references/gates.md`,
*Revising at a gate*), and the audit is decided again when the gate is asked
once more.

## `spec-audit`

Delegated to the `maister:spec-auditor` agent through the Task tool, then a fix
pass, and only when the operator chose `continue-to-spec-audit`. The auditor
checks the spec's claims against the codebase rather than trusting them.

The auditor's prompt names its report path `verification/spec-audit.md` and
hands it the user's earlier answers — `analysis/requirements.md`,
`analysis/technical-clarifications.md` when it exists, and the decisions
`prior-context --background` returns — so it can tell a finding with one obvious
fix from one that needs a decision. The report carries a verdict — pass, pass
with concerns, or fail — issue counts by severity, and the findings, each graded
fixable or needing a decision. The report is the auditor's: if it returns the
report as text and the file does not exist, write that text to the path
verbatim, once; never append to, edit or annotate it. Record the verdict in
state.

**The obvious fixes are made without asking**
(`orchestrator-patterns.md` § 6, *The Specification Audit's Fix Pass*, which
this follows step by step):

- **One fix pass.** Hand every fixable finding, with its change, to the
  `maister:specification-creator` agent through the Task tool in its amend mode.
  It applies exactly those changes to `implementation/spec.md`, and to
  `analysis/requirements.md` where a fix reaches it, and says per fix whether it
  was applied and whether it changed a requirement.
- **One re-audit, only when a fix changed a requirement**: the auditor again,
  with the same inputs; it rewrites the report. Its new findings are not fixed
  again, and a fixed finding that comes back is no progress: both stay open.
- **Record** each applied fix in this node's summary's `fixes_applied` as
  `{finding, change}`, and the re-audits as `reaudit_count` (0 or 1).

**Each finding that needs a decision is its own question**, only when the audit
(after its fix pass and re-audit) leaves one (`orchestrator-patterns.md` § 6,
step 5; engine `references/in-node-questions.md` § *Findings that need a
decision*). Write the auditor's decision findings, as its structured result
gives them, to `verification/spec-audit-findings.json`, each finding's `id` the
auditor's `name`, and build the set with `finding-brief` for this node. Send it
through the classing write when the run classes questions, then ask what is
left: one question per finding, most severe first, each with the auditor's
change and alternatives, "Accept the risk and list it", the recommended choice
with its reason, and the finding's evidence. Hand every chosen change to the
specification creator in one more amend pass — no re-audit — and record each
answer as the writer folds it; an accepted risk becomes a `tradeoff` risk. A
held choice goes on provisionally, and the gate after this node approves it. A
file `finding-brief` cannot use is a fallback: compose the same questions
yourself.

**With question sets** (`spec-audit-findings`): asked through the cockpit as
this node's one request, with the audit report and every fix written first.

**Without question sets** (`spec-audit-findings`): nothing is asked. A finding
the policy does not class stays open as an `open` risk; a classed one takes the
outcome the classing write gives it.

A failing verdict does not end the run on its own: the gate's stop option is the
route out.

**Gate brief content.** Read `verification/spec-audit.md`. The `headline` gives
the final verdict, how many findings the run fixed and what is left for planning
("The audit passes the spec after three fixes; one concern is left, not blocking
a plan"). In `summary`, the verdict, the issue counts by severity, how many were
fixed and the findings still open in plain words; when no re-audit ran, say that
the report still lists the findings the run fixed. Never repeat a fix from
`fixes_applied` in `decisions`. In `decisions`, only a point the spec left open
that the audit resolved against the codebase, `by: audit`; a check that merely
confirmed the spec goes in the summary. In `risks`, only the findings still open
— undecided, not applied, or found by the re-audit — as `open`, their `change`
what a revise of the specification would do, the critical ones first; each
finding the operator accepted as a `tradeoff`; one outside this change as a
`followup`. A finding the run fixed or the operator settled is never an open
risk.

**Recovery budget**: none — an audit that returns is an audit, whatever its
verdict; a fix pass that fails leaves its findings open for the gate.

## `spec-audit-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
guarded by the same condition as `spec-audit`, and skipped with it. Its brief
lists what the run fixed and, as open items, only the findings left; the revise
option's suggested notes come from those. Its revise sends the run back to
`specification` with the operator's note, the audit's open findings reaching the
re-run through the prior context; the specification is then approved again at
`specification-approval`, which decides the audit again (engine
`references/gates.md`, *Revising at a gate*).

## `planning`

Delegated to the `maister:implementation-planner` agent through the Task tool,
every time.

The planner reads the specification and, when the audit ran, its findings. When
a design index exists, it must enumerate every screen and component in it, map
each task group to the ones it implements through the visual-reference field,
and produce `implementation/visual-coverage.md` proving every screen is covered
by at least one group. When no design index exists, that artifact is not written
and the field is omitted; record `visual_coverage` under this node's `absent`,
the reason that there is no design index to cover (engine § *Recording an
outcome*).

When an architecture was ingested — read here as `architecture` — hand it to the
planner with the specification's rule: the groups build against the interfaces
and contracts it names and never redesign them, and a step that cannot follow it
is raised as an `open` risk in this node's summary.

If the planner returns without `implementation/implementation-plan.md`, or with
groups that leave a specification requirement uncovered, re-invoke it with the
missing context rather than writing the plan yourself.

**Gate brief content.** Read `implementation/implementation-plan.md`. The
`headline` gives how many task groups and steps the plan carries and how many
waves they run in ("Four task groups, 23 steps, in three waves"). In `summary`,
the groups in a line each and the estimated complexity. In `decisions`, the key
ordering and dependency choices, `by: run`. In `risks`, each uncertainty the
user could still change as `open`; each cost accepted on purpose, such as a
group that must run alone, as a `tradeoff`.

**When re-run after a revise** (`planning-approval`, the note in
`prior-context`): hand the planner the note and the existing plan to revise in
place — regroup, split or reorder what the note names and keep the rest — and to
check coverage again, `implementation/visual-coverage.md` included when a design
index exists. Say what changed, and write the headline again.

**Recovery budget**: 2 attempts — regenerate the plan on the second with the
gaps named in the context.

## `planning-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. Asked when
the `publish` input is off, which is the default. A gate, guarded by that input
alone. Record the answer, and stop the run on the stop option. Its revise option
sends the run back to `planning` with the operator's note (engine
`references/gates.md`, *Revising at a gate*).

## `planning-approval-publish`

Ask it from `gate-brief --json` as engine `references/gates.md` says. Asked
instead of `planning-approval` when the `publish` input is on. A gate, guarded
by that input alone. Record the answer, and stop the run on the stop option. Its
revise option sends the run back to `planning` with the operator's note. Its
continue grants `push` and `pr-create`: every picker label and the checkpoint
say so, the answer is the approval, and a driver registers the grant for the
worker when it delivers the answer. Nothing is pushed here; `finalization`
publishes.

## `implementation`

Delegated to the `maister:implementation-plan-executor` skill through the Skill
tool, every time. This is the only node that writes code.

**The sequential input.** Before invoking the skill, record the input's value as
`orchestrator.options.sequential`: the executor reads that state key, not the
node input. When true it runs one task group at a time instead of parallel
waves; it defaults to parallel.

**After the skill returns**, run the engine's `sync-plan` verb once against
`implementation/implementation-plan.md` — idempotent, a no-op without a
companion, and it catches a wave whose sync was missed. Then record what landed:
the groups completed, the files changed and the incremental test results.

**Gate brief content.** Read `implementation/work-log.md`. The `headline` gives
what landed and how the tests stand ("All four task groups landed; 40 of 40
tests pass"). In `summary`, the task groups completed, the files changed and the
incremental test results. In `decisions`, each choice the executor made where
the plan left room, `by: run`. In `risks`, each known issue the user could still
act on as `open`; each item deferred on purpose as a `tradeoff`; each problem
found outside this change as a `followup`.

**Recovery budget**: 5 attempts — fix a syntax error, an import or a failing
test, and re-run. When the fifth has not cleared it, stop and ask the operator
rather than continuing on a red suite.

## `implementation-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
unguarded. Record the answer, and stop the run on the stop option.

## `tdd-green`

Executed inline, with no gate after it, and only when the gap analysis found a
reproducible defect — the guard `tdd-red` carried, repeated because a skip does
not cascade.

Re-run the test `tdd-red` wrote and **confirm that it now passes**. Record the
test file, the command and the passing output in
`implementation/tdd-green-gate.md`, beside the failing output `tdd-red`
recorded, so the two read as one piece of evidence.

> **SELF-CHECK**: is this the same test, run the same way, as `tdd-red`
> recorded? A different test passing proves nothing about the defect.

**Gate brief content.** Its summary is part of the stretch
`verification-approval` closes. Read `implementation/tdd-green-gate.md`. The
`headline` carries the red-to-green evidence ("The failing test for the
empty-tag crash now passes: red before the fix, green after it"). In `summary`,
the test, the command and the pair of outcomes. In `risks`, any other test the
change turned red, or a doubt that the passing run exercises the defect, as
`open`, its `change` the return to the implementation that would settle it.

**Recovery budget**: 3 attempts — when the test still fails, return to the
implementation rather than adjusting the test. A test edited until it passes is
the documented failure mode of this node.

## `verification-options`

Executed inline, with no gate after it; writes no files, and decides which
reviews run and whether the user guide is written. Its declared boolean output
is what the user-docs guards read. The browser checks are decided at
`verification-approval`, not here.

**The checks page.** One page of up to two tabs, each answer standing on its
own.

1. **The reviews tab, which carries the verification plan.** Its question is the
   plan — the checks that always run, the recommended reviews and one line
   saying the browser checks are decided at the verification gate ("Browser
   checks: decided when you approve the verification") — written into the
   question rather than printed ahead of it. **Each tab states its own choice
   only**: the user guide belongs to its own tab. Say exactly when the test
   suite runs: it already passed during implementation, so the first
   verification pass does not run it again, and it runs on every pass after a
   fix changes code — "Test suite: passed in implementation (40 of 40); runs
   again after any fix". Never list it under "always runs". The options are
   bundles in one single-select (engine `references/in-node-questions.md`):
   **"All four reviews (Recommended)"** — code review, pragmatic review, reality
   check and production readiness — its description saying why all four are
   worth their time for this change, then **"Code review only"**, then **"Choose
   individually"**, which opens the four as a multi-choice question after the
   page. **None of the four carries `(Recommended)` there**.
2. **The user-guide tab — on or off.** The recommended option is the seed
   `gap-analysis` wrote to `orchestrator.options.user_docs_enabled` — on when it
   is true, off when it is false or absent — its description giving the reason
   ("Recommended: the change adds public API, so a usage guide helps"). Its
   answer is this node's `user_docs_enabled` output.
<!-- plain-picker
Under a form picker the page is one form with a property per tab, and "Choose
individually" opens a second form with one array property holding the four
reviews, none of them preselected.
-->

**Skip a question whose answer was already supplied.** The user-docs input is
tri-state, read here as `user_docs_flag`. Absent means ask. `yes` or `no` means
the invocation settled it: leave the user-guide tab off the page, record the
value as the declared `user_docs_enabled` and its state mirror, record it as a
decision `by: operator` — the user chose it when they started the run — and say
so in one line of the reviews tab's plan ("User guide: on — asked for when the
run started"). In a terminal run the seed is a default for the recommendation,
not an answer.

**With question sets** (`standard-verifications`): asked through the cockpit, in
this node's one request (engine `references/in-node-questions.md`); "Choose
individually" would need a second ask, so it is not offered.

**Without question sets** (`standard-verifications`): the
recommended bundle, all four reviews.

**With question sets** (`user-docs`): asked through the cockpit, in this node's
one request (engine `references/in-node-questions.md`).

**Without question sets** (`user-docs`): the recommendation, by
the same rule, recorded as `user_docs_enabled`.

Also record the outcome as `orchestrator.options` keys, by these exact names —
the verifier reads them to decide which reviews run:

- `code_review_enabled`, `pragmatic_review_enabled`, `reality_check_enabled` and
  `production_check_enabled` — each true when the chosen bundle or the
  individual choice includes it, false otherwise.
- `skip_test_suite` — true here, because the full suite already ran during
  implementation; the fix loop clears it the moment a fix changes code.
- `user_docs_enabled` — the user-guide tab, mirrored from the declared value.

**Recovery budget**: none — this node asks and records.

## `verification`

Delegated to the `maister:implementation-verifier` skill through the Skill tool,
then a fix loop inline. Pass no style guide path: as a skill it resolves the
guide itself and gates its own companion on the HTML output option.

**Show the issue breakdown** the verifier returns: the verdict, the counts by
severity, and the report's path from the project root
(`.maister/tasks/development/<run>/verification/implementation-verification.md`).

**The fix loop runs on its own for the obvious fixes**
(`orchestrator-patterns.md` § 6, *Fix-Then-Reverify Loop*, which this follows
step by step):

- **Fixed without asking**: every unfixed issue the verifier marked fixable and
  not risky. Log each in the work log, in `verification_context.fixes_applied`
  and in this node's summary's `fixes_applied` as `{finding, change}`, and clear
  `skip_test_suite` when a fix changed code.
- **Re-checked without asking**: a full re-verification after a fix that changed
  behaviour; the verifier's `recheck: tests-only` after fixes that changed none.
  Each raises `verification_context.reverify_count` by one. **Two re-checks run
  without asking.** Say each as "re-check 1 of 2"; never announce a fix before it
  is made.
- **Asked only when** an issue needs the user's decision, a fix is risky, the
  two re-checks are spent with fixable issues still open, or there is no
  progress (the same issues return, or new ones keep appearing) — and only once
  the automatic fixes and re-checks are done. **Each such issue is its own
  question** (engine `references/in-node-questions.md` § *Findings that need a
  decision*): write the verifier's decision fields for those issues to
  `verification/verification-findings.json`, each issue's `id` the verifier's
  `name` (issues with one root cause are one finding), and build the set with
  `finding-brief` for this node. Send it through the classing write when the run
  classes questions, then ask what is left, paged as engine
  `references/in-node-questions.md` says, the first question naming the report's
  path; more than about eight first get the triage question. A change the user
  picks is applied, logged and re-checked like any fix — the gate after this
  node offers no revise; an accepted risk becomes a `tradeoff` risk; a held
  choice goes on provisionally, and `verification-approval` approves it. A file
  `finding-brief` cannot use is a fallback: compose the same questions yourself.
- **The stopping question** says what was fixed, what is left by severity and
  how many re-checks ran, and offers three ways on, one recommended with its
  reason in its description: **"Continue as is"** when only warnings remain
  ("only warnings are left; none blocks the change"); **"One more round"** when
  the last round made progress ("the last round cleared three issues; one more
  is likely to clear the rest"); **"Stop"** when a critical issue is left ("a
  critical issue is still open, and shipping past it is not safe"). More details
  is the fourth option.

**With question sets** (`verification-findings`): asked through the cockpit as
this node's one request in its attempt, with the verification report and every
fix so far written first.

**Without question sets** (`verification-findings`): nothing is asked. An issue
the policy does not class stays open as an `open` risk; a classed one takes the
outcome the classing write gives it.

**With question sets** (`verification-fix-loop`): asked through the cockpit only
when it is the first thing this node asks in its attempt, with the verification
report and every fix so far written first; after an earlier request in the same
attempt — the finding questions — the default below is taken (engine
`references/in-node-questions.md`).

**Without question sets** (`verification-fix-loop`): the loop runs
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
> pre-fix state after fixes landed is a stale artifact. Recompile it rather than
> leaving a side file to carry the truth.

**Gate brief content.** Read `verification/implementation-verification.md`. The
`headline` gives the final verdict and what is left ("Verification passes after
three fixes; two warnings remain"); when `tdd-green` ran, it also says the
failing test now passes. In `summary`, the total issues found, how many were
fixed and how many remain by severity. In `fixes_applied`, every fix made
without asking, `{finding, change}`; a fix is never also a decision. In
`decisions`, each review finding the verifier itself settled, `by: audit`. In
`risks`, each issue still needing a decision as `open`, the critical ones first;
each issue left for later as a `followup`; each warning kept on purpose as a
`tradeoff`. When the user chose "Stop", or the re-checks are spent with a
critical issue left, add one `stop` risk saying why the run should not go on.

**Recommend whether the browser checks run.** Write `recommends` naming
`continue-to-browser-checks` or `continue-past-verification` with a one-line
reason (engine `references/gates.md` § *Before every gate*):

- **The browser-tests input was supplied** — read here as `browser_tests_flag`.
  `yes` recommends `continue-to-browser-checks`, reason "Asked for when the run
  started"; `no` recommends `continue-past-verification`, reason "Declined when
  the run started". The gate is still asked.
- **The change has no user interface** — the gap analysis recorded the task as
  not UI-heavy: recommend `continue-past-verification`, reason "This change has
  no user interface".
- **Otherwise** — follow the seed `orchestrator.options.e2e_enabled`: true
  recommends `continue-to-browser-checks`, false or absent
  `continue-past-verification`, each with its reason in the change's own terms
  ("The change adds a page; driving it in a browser catches what the reviews
  cannot").

**Node summary**: no phase key. In the closing write, register
`verification/implementation-verification.md` under
`node_summaries.verification.artifacts`, its companion path as the entry's
`html`; `verification_context.last_status`, `verification_context.issues_found`
and `verification_context.reviews`, which the verifier records every cycle, are
not repeated.

**Recovery budget**: 3 attempts — fix the failing tests and re-run, three times
over, before asking the operator how to proceed.

## `verification-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
unguarded, and the one that decides the browser checks.
`continue-to-browser-checks` sets `browser_tests_enabled` true so the browser
stretch runs next; `continue-past-verification` sets it false so the stretch is
skipped; beside them its stop. Record the answer, and stop the run on the stop
option; the guards of `e2e-verification` and `e2e-approval` read the recorded
value. The continue `verification` recommends is the recommended option; a
`stop` risk from `verification` recommends the stop instead.

**Three names for the browser checks, on purpose.** The input is
`browser_tests`, the gate value is `browser_tests_enabled` (a guard reference
cannot carry a digit), and `orchestrator.options.e2e_enabled` is the seed that
only shapes the recommendation and is never mirrored from the answer.

## `e2e-verification`

Delegated to the `maister:e2e-test-verifier` agent through the Task tool, and
only when the operator chose `continue-to-browser-checks`. It drives a live
browser through the running application and collects evidence; no browser test
files are written.

Pass the specification, the verification report and, when design context exists,
the mockup directory, plus the `run-context` output. With the mockup directory
the agent also writes the structural visual-fidelity comparison
`verification/visual-fidelity.md`, which is informational and never decides
whether this node succeeded. Decide whether design context exists on disk: the
mockup reference resolves to its declared path even when the mockup stretch was
skipped. When it does not exist, pass no mockup directory and record `fidelity`
under this node's `absent`, the reason that there was no design to compare
against (engine § *Recording an outcome*).

**This node and `user-docs` share one browser.** Never dispatch the two delegate
calls in one message, even when both stretches are enabled: concurrent dispatch
corrupts both sessions.

**Read the verifier's structured result, never its prose.** `verdict` is the
verdict the summary reports; `status: failed`, with `verdict: null`, means the
verification could not run, which is a finding (the recovery budget below). Then
its `companion`: `written` and `disabled` need nothing. On `not-requested` the
run context was missing from the prompt: invoke the agent again with it. On
`failed`, run `maister:html-companion-writer` once for each report whose `.html`
is missing, with the `run-context --node=e2e-verification` output; a second miss
is left for `run-complete` to report. `disabled` while the run context's `html:`
was a path is a defect: name it in this node's `risks`.

**Gate brief content.** The `headline` gives the verdict and the scenario counts
("Browser checks pass: 9 of 10 scenarios, one failing on the empty board"). In
`summary`, the verdict, the scenario counts — run, passed, failed — and, when
the visual-fidelity report was written, how closely the screens match the
mockups. In `risks`, each failed scenario as `open`, its `change` the fix it
calls for; a scenario that could not run for a reason outside this change, such
as a missing test account, as a `followup`.

**Recovery budget**: none — a browser session that cannot be established is
reported as a finding rather than retried blindly.

## `e2e-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
guarded by the same condition as `e2e-verification`, and skipped with it. There
is no return to it from the documentation stretch: the browser stretch completes
or skips before `user-docs` starts.

## `user-docs`

Delegated to the `maister:user-docs-generator` agent through the Task tool, and
only when the user-docs bool came back true. The guide is written to
`documentation/user-guide.md` and nowhere else.

**Reuse the browser stretch's screenshots when it ran.** Pass the screenshot
directory with the instruction to reuse what applies before capturing anything
new. When the browser stretch was skipped, omit the directory entirely rather
than passing an empty path.

**The prior decisions are background for this delegate, not content.** Fetch
them with `prior-context --background`: the guide must stay consistent with the
run's decisions and risks, and never quote them as a section of it.

**Take the fixes the generator names.** When every suggestion only removes
content that is not for the guide's readers — an extra helper beyond the change,
a section aimed at maintainers — apply them all without asking and record each
in this node's summary's `fixes_applied`. Ask only when a suggestion adds or
rewrites content: one single-select before closing, its question naming each
such change in a line, with **"Apply them, then continue (Recommended)"** first,
its description saying why the guide reads better with them, then **"Keep the
guide as written"**, and More details last. The `docs-approval` gate can only
continue or stop, so this is where such a fix is taken. Ask nothing when the
generator suggested nothing.

**With question sets** (`docs-fixes`): asked through the cockpit, in this node's
one request, with the guide as written already on disk (engine
`references/in-node-questions.md`).

**Without question sets** (`docs-fixes`): apply the suggested
changes, recorded as one `by: default` decision.

**Gate brief content.** The `headline` names the guide and the flows it covers
("The user guide covers filtering by tag and exporting to CSV, with six
screenshots"). In `summary`, the guide's path, the flows it covers and whether
its screenshots were reused or captured fresh. In `fixes_applied`, each fix
applied without asking, `{finding, change}`. In `risks`, each flow the generator
could not document as `open`, its `change` what a second pass would add.

**Recovery budget**: none — a guide the generator could not complete is reported
rather than retried.

## `docs-approval`

Ask it from `gate-brief --json` as engine `references/gates.md` says. A gate,
guarded by the same condition as `user-docs`, and skipped with it.

## `finalization`

Executed inline, writes no files, always runs, and ends the workflow; no gate
follows.

1. **Inventory the outputs**: the specification, the plan and the verification
   report always; the TDD gate artifacts, the mockups and their index, the
   audit, the browser reports and the user guide when the stretches that produce
   them ran. Say plainly which stretches were skipped and why. Take the
   inventory from disk and not from state: `run-complete` checks every declared
   artifact and every declared HTML companion, printing a `missing-artifact:` or
   `missing-companion:` line for each one absent, and those lines are relayed
   below; check by hand only a path a summary lists beyond the declarations
   (`orchestrator-patterns.md` § 10).
2. **Present the executive summary**: what was built, which task groups landed,
   the verification verdict with any issues left open, and the risk level the
   gap analysis recorded.
3. **Set the task status to completed**.
4. **Guide the next steps**, which for this workflow are its own four: a commit
   message covering the change; a review of the diff; a pull request; and
   deployment as the project's own process has it. Suggest a fresh session for
   whatever comes next. **Write the commit message to `commit-message.txt` in
   the task directory** and name the file; never print the message itself.
5. **Publish when the plan gate granted it.** Only when `planning-approval-publish`
   completed on its continue — read from state; under the plain plan gate this
   step does not exist. Commit what the run changed on its own branch if any of
   it is uncommitted, with `commit-message.txt` as the message. Never push the
   repository's default branch: on it, create a branch named for the task first.
   Push the branch, then publish once per branch — `gh pr view` first, and when a
   pull request from it is already open the push has updated it, so it is not
   opened again; otherwise `gh pr create` against the default branch, its body
   drawn from the executive summary. Merging is never part of this. The pull
   request's URL goes in the close-out's `prs` under a dispatch driver, and under
   **Done** in a terminal run, where step 4's pull request is then dropped from
   **Next**. A push or a pull request that is refused or held is not routed
   around: under a dispatch driver the seed's close-out section says how it is
   reported; in a terminal run the held command goes under **Needs you**.

**Close for whoever reads the end** (the engine skill's run-end rule, its six
wrap-up sections and its order per driver). **Next** holds every one of step 4's
next steps, a line each: commit first, with the message file's path, then the
rest of this workflow's own four, then the fresh-session suggestion, none
dropped or merged. Each `missing-artifact:` and `missing-companion:` line the
verb printed is named in plain words under **Needs you**.

**No close-out while a choice is held.** When the freeze recorded
`orchestrator.classes_questions`, this node runs `gate-brief --node=held-approval` before its
closing patch and before any close-out, as the engine's *Ending a dispatched run* says.
`gate-brief-nothing-held` closes as usual; a continue records the approvals, then closes; a
revise runs the stretch again and publishes nothing; a stop closes as a stop. When the driver
refuses the checkpoint, the close-out is graded `failed` and names each held choice, and the run
ends on `run-held-unapproved`.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the executive summary above; a dispatched run that
ends with none is `RUN-FAILED: closeout-unpublished`. Under a terminal driver
step 4 is what the operator gets.

**Recovery budget**: none — this node summarizes and nothing else.
