# Decision Log: Applications Module (Catalog Requests)

**Date**: 2026-08-10 | **Companion to**: `high-level-design.md` | Alternatives analyzed in `solution-exploration.md` (referenced, not re-litigated).

## TL;DR
Nine accepted ADRs: seven ratify the converged per-area choices from solution exploration (validated-path generator + `ACTION_ITEM` seed, domain-owned step/asked/decided state, evaluator-gated decision endpoint, withdraw-to-terminal editing, workflow-id subject binding, CSV-plus-attestation handoff, lean notifications with an attempt log), and two are structural decisions the design itself introduces (module-owned step codes with activation-time handler resolution; a write-once terminal `outcome` column carrying the open-uniqueness index). The most consequential are ADR-002 (where process truth lives) and ADR-004 (how requesters edit without ever reopening SUBMITTED).

---

## ADR-001: Provision workflow definitions via a module-owned generator through the validated path, and ship the `ACTION_ITEM` registry seed

### Status
Accepted

### Context
The engine's authoring API is superadmin-only, so per-company provisioning must be programmatic. Two provisioning styles exist in prod: global TEMPLATE + clone (WIDGET) and repository-direct generator (performancereview) - both bypass `WorkflowValidationService`. `ACTION_ITEM`, the canonical human step, has no `step_type_registry` seed, so the validated path rejects any definition using it today.

### Decision Drivers
- The catalog process is fixed by the product - per-request variation is bind-time config, not definition variation.
- Validation at provisioning time catches config drift before it surfaces as a runtime failure inside Temporal.
- Registry seeds are idempotent `context:global` changesets - near-zero risk, platform-wide benefit.

### Considered Options
1. Global TEMPLATE + clone-per-company (solution-exploration Alt 1A)
2. Module-owned generator, repository-direct save (Alt 1B)
3. Module-owned generator through the validated facade path + ship the missing seeds (Alt 1C)

### Decision Outcome
Chosen option: **Alt 1C**, because one idempotent seed converts the engine's only safety net from bypassed to active at near-1B cost, and the definition stays code-owned and versioned with the module. (Converged in Phase 4; rationale detail in solution-exploration.md Area 1.)

### Consequences

#### Good
- Provisioning-time validation of step config, handler existence, and registry membership.
- The `ACTION_ITEM` seed is platform repair inherited by every future consumer of the validated path.
- Definition changes ship as code reviews, not data migrations.

#### Bad
- Two extra global seed changesets (`ACTION_ITEM` + the module's own step codes) and facade wiring beyond the bare repository-direct save.
- Validation coverage is only as good as the registry schemas.

---
