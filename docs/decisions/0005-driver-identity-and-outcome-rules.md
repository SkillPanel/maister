# ADR-0005 — Driver identity, run-outcome rule and approval-relay lever

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § E1 (driver), § C5 (outcome rule), § H1 (hook floors); `plugins/maister/skills/orchestrator-framework/schemas/driver.schema.json`, `markers.schema.json`, `hook-payloads.schema.json`; ADR-0001

## TL;DR
Measuring the gate protocol against real headless sessions changed three things in the frozen contracts: `orchestrator.driver` gains `cwd` and `session.model` and is rewritten only by the daemon; a process exit code is not an outcome signal on either provider; and the approval relay moves onto `PreToolUse` / `permissionRequest`, because Claude's `PermissionRequest` never fires headless.

## ADR-0005: Driver identity, run-outcome rule and approval-relay lever {#adr-0005}

### Status
Accepted. Amends ADR-0001 in detail; frozen alongside the contract register as `E1`, `C5` and the approval-relay rules in § H1.

### Context
ADR-0001 was specified before anything had been run headless. Executing the protocol literally against Claude Code 2.1.245 and Copilot CLI 1.0.80 with a stand-in engine — roughly 160 sessions — contradicted three assumptions in the specification, each in a way a schema written from that specification would have baked in permanently.

### Decision Drivers
- The contracts are frozen once; a wrong field is expensive to correct afterwards
- The daemon must be able to tell a finished run from a failed one without guessing
- Where empirical behaviour contradicts documentation, the fixtures decide

### Considered Options
1. Freeze the contracts as specified and patch them after the first real chain run
2. Re-specify from scratch against measured behaviour
3. Absorb the measured amendments into the freeze, leaving the protocol intact ← chosen

Patching afterwards was rejected because the freeze is what the fixtures, the schemas and both providers' adapters are built from: a field corrected later costs a contract version. Re-specifying from scratch was rejected as disproportionate — the protocol itself held under measurement; three assumptions inside it did not.

### Decision Outcome
Chosen option: **absorb the amendments**. `E1` gains `driver.cwd` (absolute) because resume is cwd-coupled on both providers — Claude resolves the session from anywhere but the model then acts on the original absolute paths, and Copilot keeps the session's own cwd regardless of the daemon's; `driver.session.model` becomes a field so the interim Claude-model pin inside Copilot is visible in state; and the daemon, never the engine, rewrites `driver.session` before a re-spawn, because a suspended engine cannot record the id of the session that will replace it and every measured run left it stale. `C5` records that the process exit code is 0 on both providers even for `RUN-FAILED`, a denied tool or a hook-blocked stop, so the outcome is derived from on-disk `gate_pending` and `gates/` state **first**, then the last non-empty assistant line against the frozen marker vocabulary, then `permission_denials[]` (Claude) or `hook.end` events (Copilot); the marker line is advisory and on-disk state outranks it. The approval relay is redesigned: on Claude it rides `PreToolUse` in **default** permission mode behind a static `--allowedTools` safe-list, granting via `permissionDecision: allow`, and is never paired with bypass mode, since `PermissionRequest` is dead code under `-p`; on Copilot it rides `permissionRequest`, which does fire and grant headless, with the shim catching every internal error and exiting 0 with empty stdout so the provider falls through to its own policy. Non-empty denials mark a turn incomplete regardless of what the model says.

### Consequences

#### Good
- The frozen shapes match measured behaviour, so the first real chain run is not also the first contract revision
- The relay's failure direction is right on both providers by construction: Claude falls to headless deny, Copilot falls through to its own policy

#### Bad
- A run directory that is moved or copied can only be re-entered by a new session, because `driver.cwd` is absolute
- `session.model` exists to record an interim constraint (GPT drivers corrupt nested YAML) and will outlive it
- Several of these behaviours are undocumented on the provider side, so they are pinned by fixtures and must be re-verified on every provider version bump
