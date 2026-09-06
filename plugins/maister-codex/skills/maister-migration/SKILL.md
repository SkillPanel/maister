---
name: maister-migration
description: Run a resumable, rollback-aware migration workflow from current-state analysis through target design, incremental execution, compatibility and integrity verification, and documentation. Use for framework or major-version upgrades, platform changes, database or schema moves, API transitions, and architecture-pattern migrations.
---

# Maister Migration

Treat rollback, compatibility, and data integrity as deliverables, not afterthoughts. Never execute a destructive cutover or rollback without explicit user authorization.

Read `references/migration-types.md` when classifying the task and `references/migration-strategies.md` when choosing incremental, phased, dual-run, or big-bang execution. At every user gate, prefer `request_user_input` when available; otherwise ask the equivalent concise question in the final response and pause.

## Initialize or resume

Load and follow `$maister-codex:maister-orchestrator-framework`. Its state, timestamp, phase-gate, artifact-summary, dashboard, HTML-companion, recovery, and user-confirmed rollback contracts are mandatory.

For a new task, create `.maister/tasks/migrations/YYYY-MM-DD-task-slug/` with `analysis/`, `implementation/`, `verification/`, `documentation/`, and `orchestrator-state.yml`. Read `.maister/config.yml`, `.maister/docs/INDEX.md`, all applicable project documents and standards, and parse `--type`, `--sequential`, and `--from=PHASE`.

For a resume, restore the first incomplete phase from state unless `--from` was explicitly requested, read all completed artifacts, and preserve recorded decisions. Mandatory gates require a fresh user response.

State must include the framework fields plus:

```yaml
migration_context:
  migration_type: general       # code | data | architecture | general
  current_system: {description: null, technologies: []}
  target_system: {description: null, technologies: []}
  migration_strategy: {approach: null, phases: []}
  risk_level: null
  breaking_changes: []
  rollback_plan_created: false
  dual_run_configured: false
  integrity_checks: []
  compatibility_matrix: []
external_research:
  performed: false
  sources: []
  breaking_changes: []
verification_context:
  last_status: null
  issues_found: []
  fixes_applied: []
  reverify_count: 0
orchestrator:
  options:
    html_output: true
    sequential: false
    docs_enabled: false
```

## Phases

### 1. Current-state analysis and clarification

Load `$maister-codex:maister-codebase-analysis`. Map versions, dependencies, configuration, runtime and deployment topology, schemas and data ownership, integrations, public contracts, tests, consumers, generated files, and operational constraints. Ask only critical questions about scope, target, downtime, compatibility, and regulated or irreversible data. Write `analysis/current-state-analysis.md` and `analysis/clarifications.md`, then auto-continue.

### 2. Target-state and gap analysis

Define the target system and classify the migration as code, data, architecture, or mixed. Compare current and target capabilities, APIs, data models, operational behavior, and tooling. When version-specific behavior may have changed, verify it with primary official sources and cite them.

Write `analysis/target-state-plan.md` with gaps, breaking changes, dependency ordering, risk level, and evaluated strategies: incremental, phased, dual-run, or big-bang. Prefer reversible, observable steps; justify any big-bang approach. Mandatory gate: present current and target summaries, type, strategy, critical gaps, and risk.

### 3. Requirements and migration specification

Confirm scope and exclusions, downtime and maintenance windows, backward/forward compatibility, data retention and reconciliation, rollout population, feature flags, cutover authority, rollback triggers, and existing behavior that must remain.

Write:

- `analysis/requirements.md`;
- `implementation/spec.md` with acceptance criteria and standards;
- `analysis/rollback-plan.md` with trigger, owner, exact reversal or restore procedure, validation, and point-of-no-return;
- `analysis/dual-run-plan.md` when old and new paths coexist, including synchronization, comparison, divergence handling, and retirement criteria.

For data migrations, specify backup/restore validation, counts, checksums or invariants, idempotency, resumability, and reconciliation. For API or architecture migrations, specify contract/version compatibility and consumer sequencing. Mandatory specification-approval gate.

### 4. Implementation planning

Write `implementation/implementation-plan.md` with small migration task groups, dependencies, disjoint file ownership, preconditions, focused tests, compatibility and integrity checks, rollout/rollback step for each group, observability, and stop conditions. Include explicit checkpoints before irreversible work. Mandatory plan-approval gate.

### 5. Migration execution

Load `$maister-codex:maister-implementation-plan-executor`. Execute only the approved pre-cutover changes and non-destructive migration steps. Use parallel waves only for disjoint work; `--sequential` disables them. Verify every group incrementally and update `implementation/work-log.md` with commands, outcomes, checkpoints, and rollback readiness.

Stop for approval before external deployment, production cutover, destructive schema/data operations, removal of the old path, or any step crossing a documented point of no return. Do not silently change strategy. Mandatory execution-summary gate.

### 6. Verification and compatibility testing

Load `$maister-codex:maister-verify` for completeness, standards, tests, and selected reviews. Write `verification/implementation-verification.md` and `verification/compatibility-test-results.md` covering:

- old/new API, schema, configuration, and consumer compatibility;
- data counts, checksums or invariants, ordering, null/default handling, and retry/idempotency behavior;
- rollback rehearsal or a clearly identified untested rollback assumption;
- dual-run divergence and cutover criteria when applicable;
- security, performance, deployment, and observability regressions.

An integrity failure is a hard stop. Never normalize it as a warning. Mandatory gate with verdict, compatibility results, integrity status, and rollback readiness.

### 7. Migration issue resolution

Run only when verification found issues. Ask which fixable issues to address, apply approved fixes, and reverify up to three cycles. Refresh the canonical verification and compatibility reports each time. Never roll back automatically. Unresolved critical compatibility or integrity issues block completion unless the user explicitly stops the workflow or accepts a non-production handoff. Mandatory resolution gate.

### 8. Documentation and finalization

When requested or needed by risk, write `documentation/migration-guide.md` with prerequisites, staged procedure, cutover checklist, verification, rollback, troubleshooting, owner handoffs, and old-system retirement criteria. Mark state complete only when required checks pass or accepted exceptions are recorded. Summarize changes, compatibility, integrity evidence, rollback readiness, remaining operational actions, and commit/deployment guidance.

## Artifacts

```text
analysis/current-state-analysis.md
analysis/clarifications.md
analysis/target-state-plan.md
analysis/requirements.md
analysis/rollback-plan.md
analysis/dual-run-plan.md                 # conditional
implementation/spec.md
implementation/implementation-plan.md
implementation/work-log.md
verification/implementation-verification.md
verification/compatibility-test-results.md
documentation/migration-guide.md          # conditional
```

## Recovery limits

- Phases 1-4: two attempts; then surface the missing source, target detail, or decision.
- Phase 5: five focused correction attempts; never use rollback as automatic recovery.
- Phases 6-7: three fix-and-reverify cycles and an immediate halt on integrity loss.
- Documentation: one retry, then produce a text-only guide from verified artifacts.
