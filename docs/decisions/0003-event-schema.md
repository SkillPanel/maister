# ADR-0003 — Event schema

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § C7; `plugins/maister/skills/orchestrator-framework/schemas/event.schema.json`; ADR-0002

## TL;DR
Coordination state is event-sourced. Each event is one immutable file named by a UUIDv7 id under `ledger/events/`; entry state is a fold over the events for a `dispatch_id` in `at` order, and indexes are derived locally rather than committed.

## ADR-0003: Event schema {#adr-0003}

### Status
Accepted. Contract `C7` in `compatibility-contracts.md`, schema `event.schema.json`; `mirror` event data is the `T1` payload (ADR-0004).

### Context
ADR-0002 makes git the transport, which means the write model must be conflict-free by construction rather than by merge resolution. It also means the same events are read by three different processes — the engine, the daemon and the cockpit — on machines whose clocks disagree by minutes.

### Decision Drivers
- Two machines writing at once must produce distinct paths, never a conflicted file
- Replaying the same events on two machines must yield byte-identical state
- Clock skew must be unable to invent an illegal state transition

### Considered Options
1. A single mutable state document per entry, updated in place
2. An append-only log file per entry
3. One immutable file per event, folded on read ← chosen

A mutable document per entry conflicts on every concurrent edit, which is precisely what the branch in ADR-0002 cannot resolve. An append-only log per entry is better but still one shared path: two machines appending at once produce a textual conflict that only a lock — the thing this design refuses to need — can prevent.

### Decision Outcome
Chosen option: **one file per event**, because a file written exactly once cannot conflict — two operators acting simultaneously produce two paths, and the rebase in ADR-0002's sync loop is a no-op merge. Events carry `version`, a UUIDv7 `id` that is the file's identity, `at`, `actor` (`email`, `machine`, `via`), optional `run_id` / `dispatch_id`, a `type` from the frozen set (`create`, `claim`, `status`, `constraint`, `followup`, `closeout`, `dismiss`, `archive`, `mirror`) and a per-type `data` map. The fold applies events for a `dispatch_id` in `at` order, ties broken by `id`; a `status` transition that is illegal per the state machine is **ignored and flagged**, never reordered — which is what makes skewed clocks harmless. Files are never rewritten, so history is the audit trail.

### Consequences

#### Good
- Deterministic replay: the same event set folds identically on every machine, and the ledger view needs no synchronisation
- Adding an event type is additive — old readers skip what they do not recognise instead of failing

#### Bad
- Reading current state means reading many small files; without the local derived index the cockpit would re-fold on every glance
- The event set is frozen at v1, so a genuinely new coordination verb costs a contract change rather than a field
- An event rejected by the fold (illegal transition) is invisible until something surfaces the flag, so the flag must reach the operator
