# ADR-0048 — A dispatched run is told by its `dispatch_id`, and `coordinator` is an actor role

**Status**: Accepted · **Date**: 2026-10-21 · **Builds on**: ADR-0006 (the compatibility floor), ADR-0037 (provenance keys), ADR-0047 (relayed answers) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/driver.mjs`, `complete.mjs`, `state.mjs`, `gate-brief.mjs`, `revise.mjs`; `skills/umbrella/scripts/lib/seed.mjs`; `skills/workflow-engine/SKILL.md`; `references/writing-state.md`, `references/gates.md`, `references/in-node-questions.md`, `references/sub-runs.md`; `skills/orchestrator-framework/references/orchestrator-patterns.md`; `tests/engine/dispatched-run.test.mjs`, `in-node-classing.test.mjs`, `in-step-questions.test.mjs`, `sub-runs.test.mjs`, `umbrella-seed.test.mjs`

## TL;DR
- **One driven kind.** A dispatch seed now tells its worker to record
  `orchestrator.driver: {kind: cockpit, cwd, dispatch_id}`. A dispatched run is one whose cockpit
  driver carries a `dispatch_id`, or that carries the legacy `kind: dispatch`.
- **The legacy kind reads as before, forever.** Runs recorded `{kind: dispatch, …}` exist, and the
  compatibility floor forbids dropping a form they use.
- **`via` stays `dispatch`** for an answer given in a dispatched run's session, on either form.
- **`coordinator`** joins `person` as a documented `actor.kind`.

## ADR-0048 {#adr-0048}

### Status
Accepted. No workflow definition changes, so no `graph_hash` moves. The gate-rule sentence is
unchanged: "`cockpit` or `dispatch`" stays true while legacy runs exist.

### Context
A run the cockpit drives directly and a run a worker starts for a dispatch differ only by the
dispatch they belong to, and a dispatched run already records that relation as
`orchestrator.driver.dispatch_id`. Keeping a second driven kind made every reader choose between
the kind and the id. The cockpit's coordinator also answers on a person's behalf, and nothing
named that actor.

### Decision
1. **The reading rule.** `isDispatchedRun` (`driver.mjs`) is the one reader: the driver's kind is
   `dispatch`, or it is `cockpit` with a non-empty `dispatch_id`. A terminal driver carrying an id
   is not dispatched.
2. **Close-out.** `run-complete` owes the outbox close-out in every dispatched run.
3. **Gates.** Both forms suspend; the suspending and driven kind sets keep `dispatch`.
4. **Question sets.** Honoured under a cockpit only when the run is not dispatched, whatever
   `features` it lists. A sub-run inherits no `question-sets` from a dispatched parent.
5. **`via`.** An answer given in a dispatched run's session is stamped `dispatch`, derived from the
   `dispatch_id` under the cockpit form. A reader of `via` sees one value for dispatched answers
   whichever form the run was recorded in, and `cockpit` keeps meaning a run the cockpit drives
   directly.
6. **Actor role.** `actor` stays `{kind, id}`, recorded as sent. `kind` names the role:
   `person`, or `coordinator` for the cockpit's coordinator answering on a person's behalf, which
   names the person in `on_behalf_of`. The writer has no closed set of kinds, so no validator
   changes.

### Consequences
- A downstream reader that keyed on `driver.kind == dispatch` to find dispatched runs must read
  the `dispatch_id` as well.
- A `via` reader needs no change.
- Stamping `via: cockpit` for a dispatched run's answers was rejected: answers recorded before
  this change say `dispatch`, so the same kind of answer would read two ways.
