# ADR-0002 — Coordination branch

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § C6 (coordination branch layout), § C7 (events); ADR-0003

## TL;DR
Cross-repo coordination state lives on an orphan branch `maister/coordination` in the umbrella repository, mounted as a worktree at `.maister/umbrella/` and never merged with `main` in either direction. Git is the transport: every machine fetches, rebases and pushes the same append-only tree.

## ADR-0002: Coordination branch {#adr-0002}

### Status
Accepted. Contract `C6` in `compatibility-contracts.md`; a path-pattern register at v1, with no document schema.

### Context
A chain run spans several repositories and several operators' machines, and its state has to survive every daemon on every one of them being killed. Nothing may be written into member repositories, and nothing may reach the umbrella repository's `main` — coordination traffic must not look like project history or trigger anybody's CI.

### Decision Drivers
- No server, no database: the product ships without a component anyone has to host
- Concurrent writers on different machines must not conflict, and must not need locking
- Coordination data must be trivially separable from project history and from member repos

### Considered Options
1. A hosted coordination service the daemons talk to
2. A regular branch (or directory on `main`) in the umbrella repository
3. An orphan branch mounted as a worktree, written only as new files ← chosen

The hosted service was rejected against the product constraint that there is no central database and nothing anyone has to run: a coordination outage would stop every chain at once. A regular branch was rejected because coordination traffic then shares a history with the project — mergeable by accident, and CI-triggering by default.

### Decision Outcome
Chosen option: **the orphan branch**, because an unrelated history cannot be merged into project history by accident, a worktree gives every process an ordinary filesystem path to read, and "every file is written once" turns concurrent multi-machine writes into distinct paths that rebase cleanly without locks. The layout is fixed (`runs/<run_id>/`, `ledger/events/`, `outbox/<dispatch_id>/`, `archive/`); the only mutable file is a run's `orchestrator-state.yml`, whose single writer is the engine on the driver's machine. The sync loop fetches, rebases and pushes on a 30 s interval or after any local write, retrying a rejected push at most three times before quarantining and re-cloning. Indexes are derived locally and never committed. The daemon writes nothing to member repos and nothing to `main` — a CI assertion, not a convention.

### Consequences

#### Good
- Zero hosted infrastructure; the host's own access control decides who can coordinate
- Deleting every daemon's cache and re-cloning reproduces the identical fleet view

#### Bad
- Latency is a fetch interval, not a socket — an answer raised on one machine reaches another in up to 30 s
- Operators see an unfamiliar branch they must be told never to merge; host protection has to forbid delete and force-push
- Repository size grows with run count until archiving is used, and an orphan worktree confuses tooling that assumes one branch per checkout
