# Decision log

**Scope**: this repository — the plugin, its generated Copilot variant, the contract register and the gate hooks · **Format**: MADR · **Normative shapes**: `plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md`

## TL;DR
Thirteen accepted decisions. The first seven come from the contract freeze and the gate-hook work; ADR-0008 to ADR-0013 come from the workflow engine that executes a definition as a run. ADR-0001 is the load-bearing one — a gate suspends the process and a fail-closed hook makes the suspension real; ADR-0002 to ADR-0004 freeze the three coordination shapes it rests on; ADR-0005 records what measuring the protocol headless changed in it; ADR-0006 sets the compatibility floor and the tolerance rules; ADR-0007 settles what the hooks run on and where their files live.
Alternatives are not restated: each ADR states in its own Considered Options why the ones it rejected were rejected.

## Key Decisions
- Gate-suspend (option 1C) works on both providers and is fail-closed by construction (ADR-0001)
- Coordination is an orphan branch of immutable event files, never merged (ADR-0002, ADR-0003)
- The tracker is a one-way mirror keyed by `mirror` events, never a source of truth (ADR-0004)
- Compatibility starts at plugin 2.2.3; below the floor a task dir is an inventory row (ADR-0006)
- Hooks are zero-dependency Node in exec form; nothing they write lands in the consumer tree (ADR-0007)
- A node names its mechanism explicitly; the engine executes `direct:` nodes itself from the prose beside the definition (ADR-0008)
- A gate asked and answered in one turn writes no pending marker — marking one would deny the engine's own state writer (ADR-0009)
- The shipped definition's node ids are public API; no node carries an outcome clause, which is what makes a stop terminate (ADR-0010)
- The workflow diagram is generated and golden-file tested, and deliberately not a registered shape (ADR-0011)
- State is written by a script at a mandated canonical indent, gated on the hook's own reader, with no fallback writer (ADR-0012)
- The prose twin of a definition-backed workflow is the rollout escape hatch and is retired once the engine is proven (ADR-0013)

## Index

> **Numbering note**: This series (ADR-0001…, four digits) is the plugin repository's decision log. Two earlier series carry three-digit numbers and are cited, never renumbered: the v3 engine research decision log (ADR-001…012, fixed inputs, never re-opened) and the cockpit research decision log (GUI-ADR-001…013). Both are kept with the design workspace rather than in this repository, so they are named here and not linked.

| ADR | Title | Status | Date | Supersedes |
|---|---|---|---|---|
| [ADR-0001](0001-gate-suspend-protocol.md) | Gate-suspend protocol | Accepted | 2026-08-26 | The fail-open-hook doctrine of the cockpit research log, for the gate hook only |
| [ADR-0002](0002-coordination-branch.md) | Coordination branch | Accepted | 2026-08-26 | — |
| [ADR-0003](0003-event-schema.md) | Event schema | Accepted | 2026-08-26 | — |
| [ADR-0004](0004-tracker-mirror.md) | Tracker mirror | Accepted | 2026-08-26 | — |
| [ADR-0005](0005-driver-identity-and-outcome-rules.md) | Driver identity, run-outcome rule and approval-relay lever | Accepted | 2026-08-26 | Amends ADR-0001 (step order, commit point, failure rows) |
| [ADR-0006](0006-compatibility-floor.md) | Compatibility floor 2.2.3 and tolerance rules | Accepted | 2026-08-26 | The "render and resume forever" compatibility scope (narrowed: no resume below the floor) |
| [ADR-0007](0007-hook-runtime-and-artifact-homes.md) | Hook runtime and artifact homes | Accepted | 2026-08-26 | — |
| [ADR-0008](0008-direct-scheme-for-workflow-node-references.md) | The `direct:` scheme for workflow node references | Accepted | 2026-08-26 | — |
| [ADR-0009](0009-terminal-mode-gate-state.md) | Terminal-mode gate state | Accepted | 2026-08-26 | — |
| [ADR-0010](0010-built-in-workflow-node-ids.md) | Built-in workflow node ids as public API | Accepted | 2026-08-26 | — |
| [ADR-0011](0011-generated-workflow-diagrams.md) | Generated workflow diagrams are non-contractual | Accepted | 2026-08-26 | — |
| [ADR-0012](0012-engine-state-writes.md) | Engine state writes | Accepted | 2026-08-26 | — |
| [ADR-0013](0013-prose-workflow-twin-is-transitional.md) | The prose workflow twin is transitional | Accepted | 2026-08-26 | — |
