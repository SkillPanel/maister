# ADR-0040 — In-node questions are classed under the run's autonomy ceiling

**Status**: Accepted · **Date**: 2026-10-10 · **Builds on**: ADR-0032 (in-step questions suspend as one question set), ADR-0037 (the autonomy policy and provenance) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs` (`ceilingOf`, `questionOutcome`, `effectiveCeiling`, `narrowerLevel`); `scripts/lib/question-triage.mjs` (`classSet`, `raiseTriage`, `outstandingHeld`, `approvalsOf`, `HELD_APPROVAL`, the moved `inNodeQuestions`); `scripts/lib/state.mjs` (the classing write, the freeze fact and the autonomy ceiling, `approveHeld`, the `held-approval` status exception); `scripts/lib/gate-brief.mjs` (`questionBrief`'s `asking` filter, the `held` list, the `held-approval` brief); `scripts/lib/complete.mjs` (`run-held-unapproved`); `scripts/lib/revise.mjs` (the `held-approval` revise, `openRevision`); `scripts/lib/dashboard.mjs`; `plugins/maister/skills/umbrella/scripts/lib/envelope.mjs`, `seed.mjs`; `SKILL.md` § In-node questions (*When the policy classes a question*), § The ready set, § Gates, § Ending a dispatched run; `tests/engine/question-triage.test.mjs`, `in-node-classing.test.mjs`, `autonomy-ceiling.test.mjs`, `same-questions.test.mjs`

## TL;DR
A policy that classed gates could not reach the questions a node asks inside itself, so a
dispatched run defaulted every one of them silently, an approval-class choice included. Now,
when the freeze records that the policy classes in-node questions, the node sends its question
set to the state writer before it asks. The writer settles what the run's autonomy ceiling
allows, puts the rest to a person where one can be asked, and otherwise defaults it or holds it
for approval. A held choice forces the next checkpoint and is listed there first; with none left,
the run raises a closing checkpoint, `held-approval`, before any close-out. The autonomy ceiling
is fixed at the freeze and can only narrow. With no policy file nothing changes.

## ADR-0040: In-node questions are classed under the run's autonomy ceiling {#adr-0040}

### Status
Accepted. No definition changes and no built-in hash moves: `held-approval` is a reserved id
outside the frozen graph.

Amended 2026-10-11: a reached checkpoint whose revises re-run only some of the steps holding a
question with no choice is asked and settles those, instead of sending all of them to
`held-approval`. A sub-run ready after such a step counts as a reached checkpoint with no revise:
the writer refuses to start it (`state-subrun-held-open`), `held-approval` is asked before it, and a
revise resets a sub-run that never started (`revise-stretch-has-subrun` now refuses only one that
has). The writer refuses a continue at `held-approval` that nobody could have been asked
(`state-held-approval-not-askable`): while the checkpoint is not askable, or under a `cockpit` or
`dispatch` driver without its request answering continue.
- New writer-owned keys: `orchestrator.classes_questions` (freeze only, present only as `true`)
  and a node summary's `asking`. `orchestrator.options.ceiling` is recorded at the freeze and may
  only narrow afterwards.
- A decision item may carry `assumption` and `reversal` (record only); a held item's triage
  carries `held: true`, a consult item's defaulted without advice `advice: not_obtained`; a
  continue records approval items.
- The checkpoint gains `held`, and its decision groups `class`.
- New refusals: `gate-brief-nothing-to-ask`, `gate-brief-nothing-held`, `run-held-unapproved`.
  New warnings: `held-gate-skipped:<gate>`, `autonomy-ceiling-parent-unread:<run>`.
- The dispatch envelope may carry the autonomy ceiling as `ceiling`, and the seed tells the worker to record it.

### Context
ADR-0037 gave a run a policy hash and raise-only triage on gate answers, and nothing more. In a
run nobody can be asked through, a node's own questions took their prose defaults with no class
and no trace of whether a person should have seen them. An operator who set an ask level got the
same silence for a routine choice as for one that needed approval. And nothing stopped a run, or
a run it dispatched, from settling more than the operator allowed.

### Decision
**The writer classes, the node asks what is left.** The freeze writes
`orchestrator.classes_questions: true` only when the loaded policy classes in-node questions for
the workflow. In such a run a node sends its question set, with optional one-line reasons, in a
summary patch. The writer classes each question raise-only — a triage the question already
carries can raise its class, never lower it — and records one of four outcomes:

| Outcome | When |
|---|---|
| settled, `by: run` | the class is within what the autonomy ceiling settles (at most record) |
| asked | above it, and a person can be asked: a terminal run, or a cockpit carrying question sets |
| defaulted, `by: default` | above it, and nobody can be asked; a consult item is marked advice not obtained |
| held, `by: default`, `held: true` | an approval-class question nobody can be asked |

A classed question that recommends nothing is never given a choice by the writer: one it would
settle, default or ask is left to ask, and stays open where nobody can be asked; one it would hold
is held with no choice taken. Only a revise of its step settles it, never a continue: the
first checkpoint the run reaches whose revise re-runs that step recommends that revise, and any
other reached checkpoint refuses and names it; where no reached checkpoint has such a revise,
`held-approval` is raised before the first of them, offering that revise and stop but no
continue. The person names their choice in the revise note; the step re-runs and sends the
question with that option recommended, so it is held with a provisional choice that a later
continue approves. A continue that approved a question nobody chose would record a decision
nobody made.

It prints `ask:` with the ids still to ask, and a cockpit request is built from those alone.
Settling and holding happen nowhere else, so two paths can never disagree. A triage the model
writes on a decision is dropped with a note.

**Held choices reach a person before the run ends.** While one waits, a gate whose guard reads a
task's value is asked whatever its guard reads, and lists the held choices first on every
surface, with the step that holds each, and every continue there says it approves them. Its
continue records one approval item per held choice. Only a run whose freeze recorded the classing
fact holds anything; elsewhere a held triage is inert. When no checkpoint follows, the
closing node asks `held-approval` before its closing patch and before any close-out: approve and
finish, revise the node that held the choice, or stop. Under dispatch no close-out is published
while a choice is held. Where the driver cannot carry the checkpoint, the close-out is graded
`failed` and names the held choices, and `run-complete` refuses `run-held-unapproved`, judged
before the close-out check. The writer accepts status writes for that one reserved id so a driven
run can suspend on it.

**The autonomy ceiling only narrows.** It is fixed at the freeze. A later write that widens or
removes it is dropped with a note. A child run records the narrower of its parent's and its own.
A dispatch envelope resolves it node → member → workspace default → the dispatcher's own, clamped
never wider than the dispatcher's.

### Alternatives considered

| Alternative | Why not |
|---|---|
| The node classes its own questions from the policy | Two places deciding what a person must see; prose drift would let one settle what the other holds |
| Hold nothing; default approval-class choices with their class | A choice that needed approval would ship unseen, only labelled |
| Add a closing gate to each definition | Every built-in hash would move, and runs with nothing held would ask it too |
| Let a later write raise the autonomy ceiling | A run, or a run it dispatched, could widen its own authority |
| Approve held choices only at `held-approval` | A checkpoint that already runs after them is where a person first sees them |

### Consequences
- Under the built-in default no state, request or checkpoint gains a new key, and every
  built-in asks the same questions.
- A product-design run whose policy holds its brief decision always ends at `held-approval`,
  since only the closing node follows that gate.
- With more than two nodes holding choices, the rich picker names some revises in the question
  instead of offering them, and the user reaches them by typing.
- A driver whose request writer refuses `held-approval` ends the run on `run-held-unapproved`
  until it carries the checkpoint.
- A dispatcher whose recorded policy hash no longer matches clamps only to its recorded autonomy ceiling.
