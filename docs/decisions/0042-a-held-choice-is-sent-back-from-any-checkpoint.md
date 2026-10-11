# ADR-0042 — A held choice is sent back from the checkpoint in front of it

**Status**: Accepted · **Date**: 2026-10-11 · **Builds on**: ADR-0040 (in-node questions under the autonomy ceiling, the `held-approval` checkpoint), ADR-0028 (a gate's revise option) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs` (`gateHeldRevises`, `isAppliedHeldRevise`); `scripts/lib/gate-brief.mjs` (`revisionsOf`, `reviseStretches`, the rich picker's overflow); `scripts/lib/revise.mjs` (`gateRevise`, `openRevision`); `scripts/lib/state.mjs` (`assertOptions`, `foldAnswers`); `SKILL.md` § Revising at a gate (*For a held choice*); `tests/engine/in-node-classing.test.mjs`

## TL;DR
A checkpoint that lists choices held for approval could only approve them all with its continue,
or stop. Now, while choices are held, a frozen gate also offers a revise for each step behind it
that holds one and that none of its own revises already re-runs: `revise-<node>`, the shape
`held-approval` already offers. A person who disagrees with one held choice sends its step back
with a note, and the other held choices stay held for the next continue.

## ADR-0042: A held choice is sent back from the checkpoint in front of it {#adr-0042}

### Status
Accepted. No definition changes and no built-in hash moves.
- A frozen gate's options, request and pickers gain `revise-<node>` options while choices are
  held, with `effect: revise`, a required note, `reruns` and the gate's revision count.
- The writer accepts such an answer on the gate while it is offered, and keeps an applied one
  (its `option`, `reruns` and `attempt`) as history.
- `gate-revise` applies it over the gate's own revise stretch; `resume-check` reports it.

### Context
ADR-0040 forced the next checkpoint while a choice was held and listed the choices there first,
but its continue approved every one of them. A person who disagreed with one could reject it
only by stopping the run, unless the gate happened to declare a revise reaching that step. The
closing checkpoint already offered a revise per step holding a choice.

### Decision
**Offer the closing checkpoint's revise at every checkpoint that lists held choices.** It is
offered for a node behind the gate, in its needs closure, so the gate's own revise stretch
applies unchanged: that node, everything behind the gate that depends on it, and the gate. It
is not offered when one of the gate's own revises already re-runs the node, when its id is one
of the gate's options, when its stretch holds a sub-run that has started, or once the gate's ten
revisions are spent. It is never recommended, except where the no-choice rule recommends the
revise that supplies a missing choice. A revise approves nothing.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep stop as the only way to reject | Ends the run to undo one choice the person could correct with a note |
| Approve held choices one by one at the continue | A new answer shape, and a rejected choice still needs its step re-run |
| Reset everything downstream of the step, as `held-approval` does | The gate is not the end of the run; its own revise stretch is what every revise at a gate resets |

### Consequences
- A gate with several held choices may offer more options than the rich picker's four slots:
  it lists the gate's own options and the revises nearest the end, and its question names the
  rest, reached by typing.
- A step that is not behind the gate is reached at a later checkpoint, or at `held-approval`.
- A reader of a gate request or a gate's decisions meets option ids its definition does not
  declare, always `revise-<node>` with `effect: revise`.
