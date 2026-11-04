# Product design workflow — node prose

The node-by-node companion to `product-design.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names.

## The context block

The block is `design_context`, and this workflow writes no other context block.

| Key | Written by | Holds |
|---|---|---|
| `research_reference` | `intake` | `{path, research_question}` of a research task named on invocation |
| `project_context_summary` | `intake` | a few lines on what the explore found |
| `greenfield` | `intake` | true when the explore found no docs, screens or code |
| `scope_areas` | `intake` | the two to five decisions the scope names, one line each |
| `quick_design_question` | `intake` | the bounded question, only when the scope recommends quick-design |
| `design_resources` | `sketches`, `screens` | per turn: the version it drew, the grounding digest, its staleness and what it bound to |
| `midway_options` | `convergence` | options drawn midway: `{area, slug, version}` |

The run's options live under `orchestrator.options`: `html_output` and
`mockup_format`.

---

## Embedded mode

**This workflow is child-capable** (engine `references/sub-runs.md`). The
`embedded` input means *this run is a sub-run of another run*; the engine
supplies it at the child freeze and no command exposes it. A parent may pass
`specification: true` in the same `with:` to ask for the specification outcome;
its first gate is still asked.

Its only effect is the guard on `completion`, which is skipped for a child;
everything else runs unchanged, gates and in-node questions included.

A parent reads only the workflow-level `outputs:` block: `brief`,
`delivery_scope` and `mockups`, the last absent when no screens were drawn. Their
paths — `outputs/product-brief.md`, `outputs/delivery-scope.yml` and
`analysis/mockups/` — are a contract and do not move.

---

## `intake`

**Does.**

1. **Initialize** as the framework's *Initialization Steps* say. Set
   `options.mockup_format` from `.maister/config.yml`, default `html`.
2. **Import research** the `research` input names: its report, synthesis and
   solution exploration, where they exist, brought under
   `context/research-context/` in one `import` call (engine § *The invocation
   contract*), never a shell copy. Record `design_context.research_reference`
   with the source path. Research is supporting context: a source the verb
   skips becomes `{risk: "research not imported: <each skipped file and its reason>", tag: open, change: "read it at <source path>"}`,
   and the design goes on, citing the research at its source path. Never ask
   anybody to copy it in.
3. **Explore silently.** Just before the launch, run
   `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=Explore --host=copilot --state=<task path>/orchestrator-state.yml --node=intake`
   once. Then fan out two or three read-only agents in one message, through the
   Task tool with `agent_type="explore"`, and copy the two values the line
   prints into every call's `model` and `reasoning_effort` fields, leaving out only a field
   printed as `omit` (`orchestrator-patterns.md` § 1, *Model and Effort on Every
   Agent Call*). A built-in agent carries none of this plugin's rules, so each
   prompt carries them:
   - the project root as an absolute path, and every file it names as an
     absolute path under that root;
   - the rule "Search, list and glob only under `<project root>` — never in a
     parent folder, the home folder or anywhere outside it.";
   - the instruction to create, write or modify no file and to answer as text;
   - one question, and a reply limit of a few hundred words with file paths,
     never a report.

   The questions, one to an agent:
   - `product`: the product and its docs, from `.maister/docs/INDEX.md` and the
     user docs it names;
   - `screens`: the screens and code the task's nouns match, and what each shows
     or does today;
   - `tracker`, only when the task names an issue: the issue with its comments.

   Write each reply to `analysis/explore/<topic>.md`. Record
   `project_context.project_doc_paths` (top level, beside the orchestrator and
   context blocks) as those briefs, repository-relative, followed by the doc
   pages the first one matched, and record `design_context.greenfield` and
   `design_context.project_context_summary`. There is no whole-repository scan,
   and no flag for one.
4. **Fill the gaps, one page at most.** Read the exploration mode of
   `<plugin root>/skills/product-design/references/interaction-patterns.md` for
   its question design. Ask only where the explore could not
   answer what the design needs: up to four questions in one call, each generated
   from what was found, with concrete answers and a "Not sure yet" that does not
   block. For an existing product: which screens, which users, what exists
   elsewhere. For greenfield: who uses it, what they do today, what should be
   different. Never a blank form, and never "what do you want?". A "Not sure yet"
   is written as an assumption to check, as the *Without* line below does. When
   nothing in the project is on screen, never offer an API, a response or an
   endpoint as the thing to design: the design is the behaviour.
5. **Write `analysis/scope.md`** in plain words, from the replies, the answers and
   any imported research: the problem in a sentence; who it is for; what exists
   today; the two to five decisions; what there is to draw; the recommended
   outcome and its reason from the signals — the task's length, the screens it
   names, the decisions it implies, greenfield or not; what the person gets; how
   many more times they will be asked; and what is left out. When the signals say
   one bounded question, it says so and recommends quick-design, recording
   `design_context.quick_design_question`. Record `design_context.scope_areas`,
   and the value `draws`: whether the design has anything a person sees. With
   `draws` false, the scope says what the design covers: **behaviour, rules and
   wording** — what a client can do and when, what is refused and what the message
   says, what order things come in — while the contract (field names and types,
   endpoints, status codes, response shapes) is left to development's
   specification. Every later step reads this scope, so the decisions are written
   that way here.

**Asks.** Each answer is recorded under its id with the topic after it.

**With question sets** (`scope-questions`): every gap question in this node's
first request. A follow-up round only for a question an answer raised, at most
two rounds.

**Without question sets** (`scope-questions`): nothing is asked. Each gap is
written into `analysis/scope.md` as an assumption to check, and recorded as an
`open` risk whose `change` is the answer that settles it, so `correct-scope`
offers it.

**Writes.** `analysis/scope.md` and `analysis/explore/`. The explore briefs go on
the summary's artifacts with `role: evidence`.

**Summary.** A `headline` with the recommended outcome in plain words. `summary`
is the scope proposal condensed: the problem, the users, what exists, the
decisions, what is drawn and the questions still to come. `delegated` lists
`Explore` as the brief prints it. In `risks`, each assumption as `open`. The
summary carries no `recommends`: that is `problem`'s.

**Re-run.** After `correct-scope`. Do not create the task or import again. Keep
the explore briefs, and dispatch one `Explore` agent on what the note corrects,
its brief added beside them, with the `model` and `reasoning_effort` of a fresh
`dispatch-model` line as in step 3: a declared delegate is dispatched on every attempt.
Apply the note to `analysis/scope.md`, and record `draws` afresh. A risk the note
settles is written `tag: resolved`.

**Budget.** A failed `Explore` agent is dispatched once more with a narrower
question; after that, its gap becomes a question or an assumption.

---

## `problem`

**Does.** Write `analysis/problem-statement.md` from the scope, the explore briefs
and the answers: the problem, the users and what exists; the constraints, from the
standards read and the decisions taken; the success criteria; the user stories,
each journey-level, id `user-story-<topic>`, marked drafted (engine
`references/in-node-questions.md`, *One topic is one drafted story*); and what is
out of scope.

Then write two or three persona cards to `analysis/personas.md`, each with a name,
a role, what they do today, what they want from this and what would make them
stop. For an existing product, draw them from the docs' own user descriptions; for
greenfield, from the answers, each card labelled "Assumption to check".

**Summary.** A `headline` with the problem in a sentence. `summary` covers the
statement, the personas by name under "Who this is for", and the outcome
recommended. Always write `recommends: {option, reason}`:

- `brief-with-screens`, unless the signals call for the specification: several
  interacting screens or rules, or a development run to follow at once;
- `brief-with-spec` when the `specification` input is true, its reason saying the
  specification is written either way.

The reason says whether screens will be drawn. When the intake recorded `draws`
false, it says none are drawn on either outcome and that the design settles
behaviour, rules and wording, the contract being left to development. When the scope recommends quick-design, the risk
`{risk: "<the bounded question>: one bounded question", tag: stop}` makes the gate
recommend `use-quick-design`. Each drafted story is an `open` risk with its
correction as `change`. The artifacts are the problem statement (`role: primary`)
and the personas (`role: review`).

**Re-run.** Revise from the note. When the scope changed, check every card and
story still fits.

**Budget.** Re-draft from the explore briefs once.

---

## `problem-approval`

**Exception.** Its stop, "Use quick-design instead", ends the run with the engine's
wrap-up, and the **Next** line is
`/maister-copilot:quick-design "<the question from design_context.quick_design_question, else the task>"`,
in place of the development command.

---

## `alternatives`

**Does.** **Deliberately non-interactive**: alternatives generated outside the
conversation are not anchored on its first idea. Hand the brainstormer:

- the scope, whose two to five decisions are its areas;
- the explore briefs, the problem statement and the personas;
- the depth sentence: "options differ in what the person sees and does, never in
  schema or API; with nothing on screen, they differ in behaviour, rules and
  wording";
- `visual_marks`, so it marks each area whose alternatives differ in what a person
  sees;
- the instruction to read its inputs in full and to group the alternatives by
  decision area, with a recommendation for each;
- the absolute path of
  `<plugin root>/skills/workflow-engine/references/decision-areas.md`, the areas
  file's shape, with the plugin root written out, since the agent cannot expand a
  variable.

Record `visual_areas` from the agent's return. When the return carries none, it is
true exactly when the areas file marks any area `visual: true`.

A return without alternatives in `analysis/alternatives.md` is re-invoked with
corrected context. After a second failure, ask *"The brainstorm failed twice:
<cause>. Try again?"* — *"Try once more (Recommended)"*, saying why it may work
now, or *"Draft the alternatives here"*, warning that they would be anchored on
the ideas already discussed.

**Asks.**

**With question sets** (`brainstormer-retry`): the first request of this node's
attempt, or a follow-up round after one; once the attempt's rounds are spent,
the default below is taken.

**Without question sets** (`brainstormer-retry`): neither. The node is recorded
`failed`; inline alternatives are exactly the anchoring this node avoids, and a
re-drive is the operator's route back in.

**Writes.** A missing `analysis/decision-areas.json` (`areas_path: null`, the
reason in the agent's warnings) is never re-driven for. A written one goes on
the summary's artifacts with `role: evidence`.

**Summary.** The number of decision areas (from the areas file when there is
one), of visual areas and of alternatives, and each area's recommendation, in
`summary` and **never in `decisions`**: a recommendation is not a decision. The
node entry adds `alternatives_count`.

**Re-run.** Hand the brainstormer the note and the existing
`analysis/alternatives.md` to revise in place with fresh alternatives, listing
the ones already explored as considered.

---

## `sketches`

**Does.** One turn of the studio into `analysis/mockups/`, asking nothing. The
format comes from `options.mockup_format`, with the studio's own ASCII fallback.
Pass it:

- `scope`: the slugs of every option of every area marked visual, plus
  `who-this-is-for`. Every sketch slug is `<area id>-<option id>`, in this node
  and in a midway draw alike, because `area-brief` finds a sketch by that name and
  `screens` drops it by that name;
- `brief`: one small screen per such option, and a first screen, "Who this is
  for", from the persona cards; the other areas stay text;
- `note`: on a re-run, the revise note from `prior-context`.

The turn's version is the sketch version, `v001` on a fresh folder.

**Writes.** Add the turn to `design_context.design_resources` from the version's
manifest.

**Summary.** The `headline` names the version and the gallery path, or the ASCII
document ("v001 of the sketches, one page per option; open
analysis/mockups/versions/v001/index.html"). Each `degraded` reason the turn
returned is an `open` risk. The node entry adds `mockup_references`, the flat pages
of the version's screens.

**Re-run.** One more turn against the folder's latest version.

**Budget.** Retry the turn once.

---

## `convergence`

**Does.** Read the convergence mode of
`<plugin root>/skills/product-design/references/interaction-patterns.md` first if
this session has not. Each decision is recorded as what a person sees and does, or,
with nothing on screen, as behaviour, a rule or a message's words — never as a field,
an endpoint or a status code. Ask one area per call through `area-brief`, as engine
`references/in-node-questions.md` § *Decision areas from the brainstorm* says. With
this node's `with: sketches`, each question carries the sketch lines (each option's
page and the gallery, for a visual area) and the "Investigate first" line; how each
picker carries them, and the warnings to relay in the summary, are in that section.

Read each answer one of three ways, in session and under a driver:

- **An alternative's id or title** is the choice.
- **Own words starting with "Check"** are an investigation, recorded under the
  area's question id as given. Check it from the code or the docs, add one line to
  the area's record in `analysis/design-decisions.md`, then ask the same area again
  **under the same question id, in a follow-up round**. In session, the write sends
  both answers, the re-asked one with the next `round` (2, then 3), as a follow-up's
  fold would stamp it. Under a driver the follow-up request carries the round and is
  worded the same, so the fold replaces the Check answer and the line in the area's
  record is what stays. The later round's answer is the one in effect.
- **Own words naming an approach not in the list** are an option asked for midway.
  In session, confirm it in one line before anything is drawn, which also catches an
  answer that meant a check. Under a driver the node spends no follow-up round on a
  confirmation: it takes it as the choice and says so in its summary. Either way it is
  recorded as the chosen approach outside the file's list, and:
  - **when the intake recorded `draws` true**, whatever the area's mark, draw it as
    one inline call of the `mockup-studio` skill through the Skill tool, on
    the same folder: `task_path` the run's directory, `output_subdir: analysis/mockups`,
    no `record`, `note` the approach in the person's own words, `scope` its slug,
    `<area id>-<the approach's name in kebab case>`. Record `{area, slug, version}` in
    `design_context.midway_options`;
  - **only when `draws` is false** is it recorded as text and not drawn: nothing else
    would drop the page from the flat view, and development imports that view as
    binding.

The answer `investigate-first`, or an alternative with `check` text beside it, is an
investigation too, so that alternative is not yet the choice; `investigate-first` with
no `check` text is asked once what to check. An option asked for midway comes through
the list's Other (type your answer). `check` text naming an approach, not something to
look at, is read as one too, confirmed in one line as above.

On a `decision-areas-*` warning, compose every area from
`analysis/alternatives.md`, recording each answer as
`convergence-decisions-<the area's name as a slug>`. Then summarise the chosen
direction across the areas, naming the sketches, for `direction-approval`.

**Asks.**

**With question sets** (`convergence-decisions`): every decision area in this
node's first request, one question per area, its `why` naming any other area its
choice depends on. Before it suspends, `analysis/alternatives.md` and the
drafted decision sheet in `analysis/design-decisions.md` are on disk. After the
answers, record each as an operator decision and the chosen direction exactly as
a terminal run does. Two chosen alternatives that conflict are an `open` risk
whose `change` names the switch that resolves it. The areas a check was asked for
are asked again in one follow-up round, under the same question ids (`area-brief
--patch-file` with `--area` repeated), and the later round's answer supersedes the
investigation. Once the rounds are spent, the area stays open for
`direction-approval` with the finding in its risk: its last Check answer stays
recorded as given and is counted, and the area's `open` risk, with `decision_areas`
holding its `chosen_approach` unset, is what says it is undecided.

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
  alternatives to choose between and worded to whoever reads the gate
  ("<area>: you have not yet chosen between <A> and <B>"), never naming a role
  as the one who decides (`orchestrator-patterns.md` § 7).

**Writes.** `analysis/design-decisions.md`: the chosen approach and its
rationale, the key decision per area, the trade-offs accepted, and the
alternatives considered in brief, pointing at `analysis/alternatives.md` for
the detail. Each chosen sketch — on a decision sheet, each recommended one — is
named by its version page, `analysis/mockups/versions/<version>/<slug>.html`, or
`analysis/mockups/versions/<version>/ascii-mockups.md#<slug>` for ASCII, the
version from `design_resources` or `midway_options`: the final screens remove every
flat sketch page, since no final screen keeps a sketch's slug.

**Summary.** With a choice made: a `headline` naming the direction, the
direction across the areas in `summary`, and the trade-offs it accepts in
`risks`, each `tag: tradeoff`. Without question sets: the items above, and a
`headline` and `summary` saying the direction is proposed and how many areas
await a choice. Risks are written after the answers: one the person's choice
settled is not carried (a recommendation they took is no longer "not yet chosen"),
and each open question is one risk, worded once. The node entry adds `selected_approach`,
`trade_offs_accepted` and `decision_areas` — each element `area`,
`alternatives_count`, `recommended` and `chosen_approach`. Every area is in
`decision_areas`; a dropped area is a defect to resolve before completing.

**Re-run.** After `revise-direction`: with a choice made, re-ask only the areas
the note reopens and keep the other choices; without question sets, take the
alternative the note names for each area it names, recorded as
`{decision: "<area>: <alternative> — chosen at the direction gate", by: operator}`
with who answered, and leave the rest open. An approach the note names outside the
list is read as an option asked for midway.

**Budget.** Re-read the alternatives and re-ask the areas.

---

## `direction-approval`

**Exception.** Its continue option means more under a driver. When
`convergence` left the areas open, continuing is the operator adopting
every recommendation on the decision sheet; the gate's recorded answer, with who
gave it, is that choice. Nothing is written back into the sheet.

---

## `specification`

**Does.** Inline, with no agent and no question. Read
`analysis/design-decisions.md` first; for a decision sheet with areas left open, a
continue recorded at `direction-approval` means every recommendation was adopted,
and the specification says so, naming who answered.

Write `analysis/feature-spec.md` at design level, per screen or step: what it
shows; its states and their words; who may act; each data rule in one line; the
stories it serves, by id; and what it keeps or changes of what exists.

The user stories from `analysis/problem-statement.md` open it, each by its id and
whole. A story the direction changes is restated as changed, and is an `open` risk.

Entities with fields and types, endpoints and their shapes, migrations and component
names are always out of its scope: the development workflow's specification creator
owns those. With nothing on screen, each step is a behaviour: who may do it, what
is refused and in what words, what order results come in.

**Summary.** The `headline` gives the count of screens or steps. `decisions` are the
scope boundaries, each `{decision, by: run}`, never restating the earlier direction;
`risks` are the open answers, each `tag: open`.

**Re-run.** Revise what the note reaches.

**Budget.** Re-draft once.

---

## `screens`

**Does.** One turn of the studio on `analysis/mockups/`, built on the folder's latest
version: read `latest` from `analysis/mockups/versions/index.json` and pass it as
`against`, since the convergence may have added turns; with no index yet, this turn
is the first. The format comes from `options.mockup_format`.

It draws the final screens from `analysis/design-decisions.md`, the problem statement
and the personas, and from `analysis/feature-spec.md` **only when the state records
`specification` completed**. A decision sheet with areas left open reads as every
recommendation adopted once `direction-approval` continued.

Its note lists the final screens, each by a slug of its own (a screen name, free and
never prefixed), and tells the turn to `drop` every slug of `against` that is not a
final screen: the sketches and midway options (`<area id>-<option id>`), chosen or
not, and `who-this-is-for`. The flat view is then the final screens alone.

**Writes.** Add the turn to `design_context.design_resources` from the version's
manifest.

**Summary.** The `headline` names the version, the screens and the gallery file
("v003 — the share dialog and the guest calendar; open
analysis/mockups/versions/v003/index.html"), since the gate question cannot carry the
path. Each `degraded` reason the turn returned is an `open` risk. The node entry adds
`mockup_references`, the flat pages of the version's screens.

**Re-run.** One more turn on the latest version, with the note. The earlier versions
stay in the folder.

**Budget.** Retry the turn once.

---

## `brief`

**Does.** Runs on every path, because a parent reads what it writes
(*Embedded mode*). A decision sheet with areas left open reads as every recommendation
adopted once `direction-approval` continued.

1. **Assemble the layered `outputs/product-brief.md`** from the documents on disk,
   pointing at them rather than repeating them:
   - **Core**, always: the problem, the users, the constraints, the success and
     acceptance criteria, condensed; and the user stories, each by its id and whole —
     never condensed;
   - **Persona cards**;
   - **Design decisions** per area, pointing at the decision record and the
     alternatives, and naming each chosen sketch by its version page,
     `analysis/mockups/versions/<version>/<slug>.html`, or
     `analysis/mockups/versions/<version>/ascii-mockups.md#<slug>` for ASCII, the
     version from `design_resources` or `midway_options`;
   - **What changes, per screen**: when the state records `specification` completed,
     `analysis/feature-spec.md` carried in full instead. Otherwise this node writes it,
     from the decisions and the final screens: their titles and behaviour lines in
     `analysis/mockups/versions/<latest>/manifest.json` (`<latest>` from
     `analysis/mockups/versions/index.json`) and their annotations in
     `analysis/mockups/.mockups.json` for HTML, or
     `analysis/mockups/ascii-mockups.md` for ASCII; when `screens` was skipped, per
     step or flow from the decisions alone, as behaviour, rules and wording, never
     fields, endpoints, verbs, status codes or response nesting;
   - **Mockup references**, only when the state records `screens` completed: links to
     the flat pages under `analysis/mockups/` and the gallery, or the ASCII inline;
   - **Delivery scope**, always: each member in scope as one plain sentence — the
     member, what changes there, and what it waits for — in order, then each member
     left out with its reason, then each agreed exclusion. Approving the brief approves
     the scope;
   - **References**: every analysis document the run produced.
2. **List the agreed points** before writing the scope. An agreed point is anything
   this run settled about what is built or left out: each decision the earlier
   summaries record, whoever made it; each in-scope and out-of-scope item the scope, the
   specification and the design decisions state; each open item a later step settled,
   in the form it was settled; and each user story. Every inclusion lands in the
   statement of the member it changes; every exclusion is stated as left out, in the
   scope layer and in the statement of the member it would have changed. A point
   deliberately not carried is named in the scope layer with why.
3. **Write `outputs/delivery-scope.yml`** as
   `<plugin root>/skills/umbrella/references/delivery-scope.md` shapes it. A member is
   in scope when the design changes something it owns. Draw every statement from the
   agreed points and the documents on disk, never from a guess about code nobody read.
4. **Check the scope against the agreed points** — every one carried, or named as left
   out with why. Each point missing is an `open` risk naming it, with the `change` that
   would carry it. A scope that drops one, or states no exclusion after a run that
   agreed some, is not ready to approve.
5. **Write the HTML page `outputs/product-brief.html` before this node completes**,
   through the companion writer when `html_output` is on; `brief-approval` reviews it.

**Writes.** `outputs/delivery-scope.yml` carries its fixed shape and no artifact summary
block.

**Summary.** The `headline` names what was designed. `summary` is the gate's preview, a
line per layer: it gives the delivery scope in a sentence — *"two members in scope,
`api` before `web`; `mobile` left out"* — and the check's result, how many agreed points
the scope carries and each one still missing. When the state records `screens` skipped,
`summary` also says no screens were drawn, so both revises read as rewriting the brief,
with `change-screens-and-brief` rewriting the specification first when one was written.
`recommends` the `change-brief` revise when the check found a point missing, the reason
naming it. A point still missing at approval stays an `open` risk, so a parent's scope
gate sees it. A risk carried from an earlier step keeps that step's words, so it
is listed once, and a risk a later step or answer settled is not carried. The node
entry adds `brief_layers`.

**Re-run.** Apply the note, check the scope again and rewrite the page.

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
/maister-copilot:development [task-path]
```

A run a gate's stop option ended closes the same way, except `use-quick-design`, whose
**Next** is the `/maister-copilot:quick-design` line `problem-approval` names.

No close-out while a choice is held: when the freeze recorded
`orchestrator.classes_questions`, this node runs
`gate-brief --node=held-approval` before its closing patch and before any
close-out, as the engine's *Ending a dispatched run* says.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the grade and the summary the seed's close-out
contract asks for, drawn from the wrap-up above; otherwise the run ends
`RUN-FAILED: closeout-unpublished`.
