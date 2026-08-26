# ADR-0004 — Tracker mirror

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § C7 (T1 row), § A1 (`task.key`); `plugins/maister/skills/orchestrator-framework/schemas/event.schema.json` (`$defs.mirror_data`); ADR-0003

## TL;DR
The issue tracker is a one-way mirror of coordination events, never a source of truth. Each successful tracker call is recorded as a `mirror` event carrying the created key, which is what makes mirroring idempotent and a failed mirror a visible warning rather than a stalled run.

## ADR-0004: Tracker mirror {#adr-0004}

### Status
Accepted. Contract `T1` in `compatibility-contracts.md`, carried inside `event.schema.json` (`$defs.mirror_data`).

### Context
Teams want their tracker to show what the fleet is doing, but a tracker is a remote system with rate limits, expiring tokens and per-instance workflow rules. Anything that lets it drive a run makes an outage a work stoppage; anything that writes twice makes a retry produce duplicate tickets.

### Decision Drivers
- A tracker outage, a revoked token or a missing configuration must never block or fail a run
- Retries must be safe: the same event must not create a second ticket
- Trackers differ (Jira transitions versus GitHub labels) — the differences belong in a map, not in the engine

### Considered Options
1. Tracker as the source of truth — read and write, tickets drive the run
2. Two-way sync with conflict resolution between ledger and tracker
3. One-way mirror, idempotent through `mirror` events ← chosen

Tracker-as-source-of-truth was rejected because it converts every tracker outage, token expiry and workflow-rule change into a stopped fleet. Two-way sync was rejected because there is no correct resolution when a ticket edited in the tracker disagrees with an immutable event log: honouring the edit means rewriting history the fold treats as final.

### Decision Outcome
Chosen option: **the one-way mirror**, because it is the only shape in which the tracker can be absent, broken or half-configured without changing what a run does. Five primitives (`create`, `link`, `transition`, `comment`, `search`) back Jira and GitHub Issues at launch; the mapping from ledger event to tracker action is a table (run start → epic or parent issue, dispatch `create` → child, `status` → transition or label, `followup` → sub-task, `closeout` → comment and close, gate `request`/`answer` → comment). Every call that succeeds writes a `mirror` event storing the resulting key, so "no `mirror` child" means "not yet mirrored" and a retry is a lookup rather than a second create. Only `assignee` and `status` are read back, and only for display. The intake key adopted from an existing ticket is `task.key`, frozen as a core-optional string in the state contract (§ A1). Failures retry with backoff and surface as an Attention item; they never block a run.

### Consequences

#### Good
- The tracker is optional at every level: no configuration, a revoked token or a 401 all leave the run untouched
- Idempotency is a property of the ledger, not of the adapter's memory, so it survives a daemon restart mid-retry

#### Bad
- Edits made in the tracker do not flow back, so a ticket someone renames or re-assigns silently diverges from the ledger
- Mirroring is eventually consistent: a run can be well ahead of its tickets while a backoff is in progress
- `task.key` is core-optional so it can carry the intake key, widening the state contract for a tracker-only concern
