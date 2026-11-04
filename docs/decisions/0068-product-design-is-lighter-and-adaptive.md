# ADR-0068 — Product design is lighter and adaptive

**Status**: Accepted · **Date**: 2026-11-03 · **Supersedes**: ADR-0064 · **Amends**: ADR-0061 (which option the previewing picker moves into the question) · **Builds on**: ADR-0028, ADR-0063, ADR-0065, ADR-0066 · **Sources**: `plugins/maister/skills/workflow-engine/workflows/product-design.yml` and `product-design.md`; `workflows/development.md` (`intake`); `skills/quick-design/SKILL.md`; `scripts/lib/area-brief.mjs`, `decision-areas.mjs`, `gate-brief.mjs` (`richHeldPicker`), `items.mjs` (`isEarlierAnswer`); `references/decision-areas.md`, `in-node-questions.md`; `tests/engine/product-design.test.mjs`, `area-brief.test.mjs`, `in-step-questions.test.mjs`, `research-routes.test.mjs`, `development-intake.test.mjs`

## TL;DR
Product design ran ten phases and six checkpoints, went down to the technical specification, drew
its mockups after the direction was chosen, and took flags to say how deep to go before anything
had been read. It is replaced in place by six steps and three gates. The run explores first and
proposes the scope; the first gate's two continues choose the outcome, and its stop hands a bounded
question to quick-design. Each choice is decided with sketches of its options, and the final screens
are approved with the brief. Development learns to import a quick-design decision. Two engine rules
follow: a gate with its stop recommended names a revise in the question, and a later round's answer
supersedes an earlier one in the same attempt. The product-design graph hash moves; development's
and research's do not.

## ADR-0068 {#adr-0068}

### Status
Accepted. It supersedes ADR-0064: product-design has no gate of its own for the screens any more.
ADR-0028's rule holds, and development's mockup gate keeps its revise. It amends ADR-0061's picker
rule, and every other part of ADR-0061 stands. Frozen runs keep their own graph.

### Context
The old shape asked a person to judge the size of a design before the run had looked at anything:
two flags chose the depth, a third chose the mockup format, and a detection step guessed the rest
and asked for it to be confirmed. Most of a run's questions came between the checkpoints, as
exploration and section-by-section refinement. A driven run that could not ask took their defaults,
so the one place its design could change was a pause meant for approval.

The order worked against the decisions too. The alternatives were chosen from text and the screens
drawn afterwards, so a person first saw a choice once it was made, and the specification went into
detail the development workflow's own specification writes again.

ADR-0063 made a mockup turn cheap and non-interactive, ADR-0065 lets a guard require two values, and
ADR-0066 lets a step send follow-up rounds under a driver. Those three make a shorter graph possible.

### Decision
- **The shape.** Six steps and three gates, in twelve nodes: explore and propose the scope
  (`intake`); the problem and the personas (`problem`), closed by `problem-approval`; the brainstorm
  (`alternatives`); sketch and converge (`sketches`, `convergence`), closed by `direction-approval`;
  specify, draw the final screens and write the brief (`specification`, `screens`, `brief`), closed
  by `brief-approval`; and `completion`. Options differ in what a person sees and does, never in
  schema or API. The definition keeps its name, its `research`, `task_description` and `embedded`
  inputs and its three exposed outputs, whose paths do not move. The depth and format flags are gone;
  `mockup_format` in `.maister/config.yml` chooses the format.
- **Four bools and their guards.** `with_spec`, set by the first gate's two continues, and the
  `specification` input, which a parent or a driver sets, guard `specification`, joined by `||`.
  `draws`, the intake's finding that the design has anything a person sees, guards `screens`.
  `visual_areas`, the brainstorm's finding that any area is marked visual, joins `draws` by `&&` to
  guard `sketches`. Guards sit on task nodes only: all three gates are always asked, because each
  closes a document written on every path.
- **The scope is in the first gate's continues.** The intake proposes the scope in
  `analysis/scope.md` and records `draws`; `problem-approval` needs both `intake` and `problem`, so its
  brief renders the proposal beside the problem. It offers "A design brief with screens", "A brief
  with a feature specification", "Correct the scope", "Revise the problem" and "Use quick-design
  instead". `problem` always writes what it recommends, because the engine's own fallback would
  recommend the continue that turns on the most steps. A corrected scope re-runs the intake, which
  records `draws` afresh, so the correction can switch the drawing on or off.
- **Every gate carries the way back.** `direction-approval` re-runs the convergence.
  `brief-approval` re-runs the brief alone, or everything from `specification`, on every path: a skipped
  `specification` is reset and skipped again, and `screens` and `brief` run behind it, so one target
  serves both routes and a specification can never be left behind the screens drawn from it. No node
  runs an approval loop of its own.
- **Quick-design is the stop, and a development source.** When the signals say one bounded question,
  a `stop` risk on `problem`'s summary makes the first gate recommend `use-quick-design`; the run ends
  with `/maister:quick-design` and that question as its next step. Development's intake gains a fourth
  design source: a quick-design task or its `decision.md`. `decision.md` is imported as the design
  intent and read beside a brief by the specification and the plan. Only the flat pages of the chosen
  options come with it, and none when its mockup line ends with them skipped.
- **`area-brief`'s two additions are opt-in, and the sketch slug is one rule.** An area may carry an
  optional `visual` bool. A node whose `with:` names `sketches`, a literal folder, gets the sketch lines
  on each visual area and "Investigate first" on every area; a node that does not name it gets what
  it got before, so research's questions stay byte-identical. Every sketch slug is
  `<area id>-<option id>`, shared by the sketches step, `area-brief` and what `screens` drops, because
  an option id is unique only within its area. Final screens have slugs of their own, so the flat view
  holds them alone, and the decisions file and the brief name each chosen sketch by its version page.
- **A revise named in the question.** ADR-0061 moved a gate's surplus unrecommended stop into the
  question. With the stop recommended it could not move, and the picker listed five options. When a
  gate's own options still outnumber the four slots, its unrecommended revises now follow, the last
  revise first. A continue and the recommended option are never moved, and the labels-only picker still
  lists every option. Research's foundation gate gains the same fix.
- **A later round's answer is the one in effect.** Within one attempt, a later round's answer to the
  same question supersedes the earlier round's, which stays in the list as history and is never counted
  as a choice. A round never outranks an attempt. The convergence relies on it: a "Check …" answer is
  investigated and the same area is asked again under the same question id. Neither engine rule adds a
  verb, a flag or a refusal.

### Alternatives considered

| Alternative | Why not |
|---|---|
| A sibling workflow beside the old shape | Two definitions for one job, and a person must choose between them before the run has read anything; the old shape would keep every cost this decision removes |
| An enum `shape` value steering the route | Guards read bools and the grammar has no comparison, so it would need a grammar change; and a `shape` chosen up front is the same early guess the flags made |
| A scope question inside the intake | A run that cannot ask would take its default and move on; a gate reaches the person in a terminal and under a driver alike, and carries the revise and the stop |

### Consequences

#### Good
- A person is asked after the run has looked, sees the options drawn when deciding, and gets to a brief
  with far fewer questions, while a driven run has the same three checkpoints as a terminal one.
- A bounded question leaves early for quick-design, and that decision can still start development.
- The previewing picker never lists more options than the question tool takes.

#### Bad
- The product-design hash moves, so its fixtures and baselines are regenerated, and a parent or a
  chain step that bound a removed input binds `specification` instead.
- The screens have no gate of their own: a person who wants only them changed revises through the
  screens and the brief together.
- Only the first checkpoint decides the outcome, and no later gate goes back to it, so a change of
  mind later means stopping and starting again.
