# ADR-0059 — A node completes only after its needs have ended

**Status**: Accepted · **Date**: 2026-10-25 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs` (`settleNeeds`); `gate-brief.mjs` (`unmetNeeds`, `atClose`); `complete.mjs` (`runComplete`); `references/writing-state.md` § *When a write is refused*, § *When `run-complete` refuses*; `tests/engine/node-needs.test.mjs`

## TL;DR
A write that records a node `completed` while a node it needs has not ended is refused when that
need is still on the run's path, and records the need `skipped` itself when its guard keeps it off
the path. `run-complete` refuses a completed run whose record holds a completed node past an
unended need.

## ADR-0059 {#adr-0059}

### Status
Accepted. No definition changes and no graph hash moves.

### Context
A run recorded its implementation `completed` while the gate it needs, guarded off by an input, was
still `pending`, and closed with six such nodes pending. The writer checked a node's own status and
nothing about its needs, and the close judged pending nodes by the walk, which keeps a false-guard
node off the path whether or not anybody recorded it skipped. So the record closed `completed`, the
dashboard counted the pending nodes as phases not run, and nothing refused either write. A session
that recorded each skip itself left a whole record; one that did not left a broken one.

### Decision
1. **On the write that completes a node**, the writer reads the needs of each node the write moves
   to `completed`, on the document the write produced, so a need the same write ends counts.
   - A need still on the path, or an unended node behind one, refuses the write
     (`state-node-needs-unmet`), naming what to run first. Nothing is written.
   - A need the walk at the close takes off the path — a false guard, or a skip the ready-set rule
     decides — is recorded `skipped` by that write, stamped like any skip, and a `note:` line says
     so. The guard is the engine's own judgement, so the session is not asked to repeat it, and the
     record shows the skip on every host.
   - A start (`running`) is not judged.
2. **`run-complete` refuses `run-needs-unmet`** before `run-nodes-unfinished` when a completed node
   has an unended need, giving the patch that records the off-path ones skipped and naming any
   still on the path. It catches a record that reached the close by another way.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Refuse every unmet need, the off-path ones included | The session would echo back a skip the engine had already decided, a round trip on every guarded stretch, and a session that skips the echo still leaves the record broken until it obeys |
| Judge starts as well as completions | A session may start a step it was briefed before the record of the step ahead lands; the completion is where the record must be whole, and judging starts refused writes no record would have kept |
| Make the close refuse every pending node, off the path or not | A dangling node nothing needs is legitimately left pending by the walk; the defect was a completed node past an unended one |

### Consequences
- Tests that built a partial run by completing a node without the nodes before it record those
  nodes first.
- A session that forgets a skip loses nothing: the completing write records it.
