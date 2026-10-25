# ADR-0061 — The research foundation gate offers a stop

**Status**: Accepted · **Date**: 2026-10-25 · **Amends**: ADR-0035 (the foundation gate's options) · **Sources**: `plugins/maister/skills/workflow-engine/workflows/research.yml`; `scripts/lib/gate-brief.mjs` (`richHeldPicker`); `tests/engine/research-routes.test.mjs`, `gate-wording.test.mjs`

## TL;DR
`foundation-approval` offers `stop-research` beside its three ways on and its revise, as every other
approval gate offers a stop. On the previewing picker, which lists four options, a gate whose own
options are more than four names its stop in the question as also offered.

## ADR-0061 {#adr-0061}

### Status
Accepted. The research definition's hash moves; frozen runs keep their own graph.

### Context
ADR-0035 left the foundation gate without a stop because its four options filled the previewing
picker, and finishing with the research was the way out. Users met it as the one approval gate with
no Stop, on both hosts, and finishing still runs the final summary, which a stop does not.

### Decision
- `foundation-approval` gains `stop-research: stop`, labelled "Stop here".
- The labels-only picker lists all five, More details after them.
- The previewing picker keeps every way on and the revise as options and names a gate's own stop in
  the question — "Also offered, not listed: Stop here (stop-research); name one to choose it." —
  whenever the gate's own options outnumber its four slots, the same way it already names the
  revises held choices add. A recommended stop is never moved out.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Drop "Continue to the design, skip brainstorming" to make room | Removes a route ADR-0035 added on purpose |
| Leave the gate without a stop | The only approval gate without one; finishing is not a stop, since it still writes the final summary |
