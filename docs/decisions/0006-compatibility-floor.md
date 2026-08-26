# ADR-0006 — Compatibility floor 2.2.3 and tolerance rules

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § 2 (floor), § A1, § A2; `fixtures/contracts/README.md`

## TL;DR
Compatibility starts at plugin 2.2.3: the contracts are frozen from the shapes that version and later write, and a task directory below the floor is an inventory row — listed, never parsed, never resumed. Above the floor the rules are additive-only, absence is the default, and an unknown version degrades rather than throws.

## ADR-0006: Compatibility floor 2.2.3 and tolerance rules {#adr-0006}

### Status
Accepted. Narrows the "render and resume forever" scope the earlier compatibility decision promised, keeping the render half and dropping the resume half.

### Context
The original scope promised that every task directory ever written would keep rendering and stay resumable. Surveying real runs showed the cost of that promise sits entirely in the resume half — per-version schemas, knowledge of superseded layouts, and a fixture matrix per version — while task directories are in practice short-lived and consulted afterwards as documentation.

### Decision Drivers
- Rendering an old directory is cheap; resuming one is where the per-version cost lives
- Contracts frozen from real files, not from prose about files
- A reader must never refuse a document it partly understands

### Considered Options
1. Support every version ever written, render and resume
2. Support the current version only; older directories are invisible
3. Floor at plugin 2.2.3, render and resume at or above it, inventory below ← chosen

Supporting every version was costed and rejected: a schema per version and a fixture matrix per version, paid on every release forever, to keep restartable something that in practice is read rather than restarted. Current-version-only was rejected for the opposite reason — hiding a directory destroys the documentation value that is the whole reason old runs are kept.

### Decision Outcome
Chosen option: **floor at 2.2.3**. Contracts `A1`-`A6` are frozen from the shapes plugin 2.2.3 and later write, and golden fixtures are sampled only from real runs at or above it. A directory is at the floor when its `orchestrator-state.yml` parses, `orchestrator.created` is a full non-midnight timestamp and `task.title` exists; otherwise it is listed by directory name, date prefix and type, never parsed for state, never rendered from `dashboard-data.js`, never resumed — legacy type directories (`bug-fixes/`, `enhancements/`, `new-features/`, `refactoring/`, `mockups/`) unconditionally so. Its files stay browsable as plain artifacts. No migration script exists or will. The tolerance rules apply from the floor forward: **additive only** (add fields, never rename, remove or re-type one), **absence is the default** (a missing optional key reads as empty or null, never as an error), **unknown version degrades** (a `version: 99` document renders what the reader recognises and records `newer-format`), and **unknown keys are preserved** by any reader that rewrites a document. `dashboard-data.js` is write-strict / read-tolerant: new writers emit one strict-JSON statement, while readers also parse the bare-key literal form that nine of ten real files use. Artifacts written by `2.2.4-beta.1` sample as floor artifacts because that release's only delta is a version bump — shape-neutral, verified by diff — and each fixture records its `writer_version` so the claim stays checkable.

### Consequences

#### Good
- One schema per contract instead of one per version, and a fixture corpus that stays a fixed size
- The tolerance rules make every reader forward-compatible by default, so an additive change ships without a coordinated upgrade

#### Bad
- Runs started before 2.2.3 cannot be resumed at all, and no tool will ever convert them
- Two workflow types had no qualifying real run, so their fixtures are hand-synthesized and flagged `synthetic: true` until a real one lands — they prove the schema, not the writer
- "Read-tolerant" means the reader accepts shapes the writer must not produce, a split that only a lint keeps honest
