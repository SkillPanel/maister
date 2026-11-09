# ADR-0070 — A development run refreshes the grounding pack it changed

**Status**: Accepted · **Date**: 2026-11-08 · **Sources**: `plugins/maister/skills/workflow-engine/workflows/development.md` § `finalization`; `plugins/maister/skills/mockup-studio/scripts/turn.mjs` (`ground-status --state`); `scripts/lib/grounding.mjs` (`touchedSince`); `references/grounding-pack.md`; `tests/engine/grounding-refresh.test.mjs`

## TL;DR
A development run whose change touches a file the grounding pack records rebuilds the pack at
finalization with the existing `--ground` builder and commits it with the change. The run's diff
decides, read by `ground-status --state`. With no pack, or nothing touched, the run is unchanged
and asks nothing. A failed rebuild leaves the pack as it was and is an open risk. It is a step
inside `finalization`, not a node, so no graph hash moves.

## ADR-0070 {#adr-0070}

### Status
Accepted.

### Context
Mockups are drawn from the pack at `.maister/docs/design-context/`. A turn uses a stale pack as it
is (ADR-0063), and only `--ground` refreshed it, so a change to the theme or the app shell left
later mockups in the old look. A pack refreshed by hand in a dispatched worktree was lost unless
someone committed it.

### Decision
- **The guard is the run's diff.** `turn.mjs ground-status --state=<run state>` compares each
  recorded source as the run's base commit (`task.base_commit`) holds it with the working tree, by
  the staleness hashing rules, and prints `touched`. A pack already stale at the base and left
  alone by the run is not refreshed. No pack, or no base, is `touched: []`. An unreadable base is
  `base-unknown`.
- **One builder.** The refresh invokes the studio with `--ground`. No second way of building; no
  mockup is drawn and no task folder is touched.
- **A step, not a node.** Finalization already writes the commit message and makes the run's own
  commit. A node would move the graph hash, add a node to every run's dashboard and need a recorded
  value to guard on that nothing records.
- **The pack goes with the change.** The publish commit carries it; a run that makes no commit says
  so in its close.
- **Failure is a risk.** The pack folder is copied aside first and put back on failure; an `open`
  risk names what failed. The run never fails for it.

### Consequences
- Before finalization the pack is outside the change. Every delegate's run context carries a
  `grounding pack` line when the project has one, saying no gap, requirement, task group or edit
  names it and no step runs `--ground`; the task-group implementer's rules say the same. The task
  folder's `analysis/design-context/` is a different folder and is unaffected.
- Development's graph hash does not move. A frozen run takes the step when it reaches finalization,
  since the node prose is read live.
- Out of scope: asking before drawing on a stale pack, tracking more sources, a turn rebuilding a
  pack, a CI check.
