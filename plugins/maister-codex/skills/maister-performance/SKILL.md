---
name: maister-performance
description: Run a resumable, evidence-driven performance optimization workflow using static bottleneck analysis, optional profiling evidence, measurable targets, standards-aware implementation, and verification. Use for slow queries, latency, blocking I/O, excessive memory, algorithmic hot paths, or scalability problems; use maister-development for work without a performance objective.
---

# Maister Performance

Optimize only bottlenecks supported by evidence. Static analysis can identify likely causes, but never claim a measured improvement without comparable before-and-after runtime data.

Read `references/performance-optimization-guide.md` during static analysis for detection patterns, evidence thresholds, and measurement guidance. At every user gate, prefer `request_user_input` when available; otherwise ask the equivalent concise question in the final response and pause.

## Initialize or resume

Load and follow `$maister-codex:maister-orchestrator-framework`. Its state, timestamp, phase-gate, artifact-summary, dashboard, HTML-companion, recovery, and user-confirmed rollback contracts are mandatory.

For a new task, create `.maister/tasks/performance/YYYY-MM-DD-task-slug/` with `analysis/user-profiling-data/`, `implementation/`, `verification/`, and `orchestrator-state.yml`. Read `.maister/config.yml`, `.maister/docs/INDEX.md`, every relevant project document and standard, and record their paths. Support `--sequential` and `--from=PHASE`.

For a resume, read state and every completed artifact, restore the first incomplete phase unless `--from` was explicitly requested, preserve earlier decisions, and never repeat approved work without explaining why. A mandatory gate always requires a fresh user response; do not infer approval from permission mode or earlier approvals.

State must include the framework fields plus:

```yaml
performance_context:
  bottlenecks_identified: 0
  user_data_available: false
  bottleneck_priorities: {p0: 0, p1: 0, p2: 0, p3: 0}
  baseline_metrics: []
  target_metrics: []
verification_context:
  last_status: null
  issues_found: []
  fixes_applied: []
  reverify_count: 0
orchestrator:
  options:
    html_output: true
    sequential: false
    spec_audit_enabled: null
    production_check_enabled: null
```

## Phases

### 1. Codebase analysis and clarification

Load `$maister-codex:maister-codebase-analysis`. Trace query construction, schemas and indexes, hot loops, I/O, concurrency, caching, memory ownership, and existing performance tests or observability. Ask only critical questions about the affected flow, workload, environment, and desired outcome. Write `analysis/codebase-analysis.md` and `analysis/clarifications.md`, then auto-continue.

### 2. Static performance analysis

Check `analysis/user-profiling-data/`. If empty, ask whether the user has flame graphs, APM traces, slow-query logs, heap data, or benchmark results; continue with static evidence if not.

Delegate to the installed `maister-bottleneck-analyzer` agent when available; otherwise analyze inline. Write `analysis/performance-analysis.md` with each bottleneck's location, execution path, evidence, impact, confidence, P0-P3 priority, proposed measurement, and plausible remediation. Cover N+1 queries, missing or unusable indexes, unbounded work, O(n²) patterns, blocking I/O, excess allocations or retention, connection pressure, and safe caching opportunities. Distinguish measured facts from inferences and avoid false precision.

Mandatory gate: summarize counts by priority, evidence quality, and unresolved measurement gaps; ask whether to continue.

### 3. Requirements and specification

Confirm which bottlenecks are in scope, compatibility and resource constraints, acceptable dependencies, baseline conditions, target metrics, and regression tolerances. Write `analysis/requirements.md`.

Write `implementation/spec.md` covering problem, selected bottlenecks, current evidence, optimization approach, acceptance criteria, measurement protocol, observability, rollback, tests, standards, and non-goals. Every expected improvement is a range or hypothesis unless measured. Mandatory specification-approval gate.

### 4. Specification audit

Recommend an independent audit for high-risk, multi-layer, or data-store changes; honor explicit enable/disable flags. Load `$maister-codex:maister-reviews-spec-audit` when enabled and save `verification/spec-audit.md`. Resolve critical ambiguity before proceeding. Mandatory gate whether the audit ran or was explicitly skipped.

### 5. Implementation planning

Write `implementation/implementation-plan.md` with dependency-aware task groups, owned files, test-first steps, benchmarks or query-plan checks, validation commands, observability changes, rollback actions, and the order needed to keep measurements comparable. Mandatory plan-approval gate.

### 6. Implementation

Load `$maister-codex:maister-implementation-plan-executor`. Apply only approved optimizations, run focused tests or measurements after each cohesive group, and update `implementation/work-log.md`. Parallelize only groups with disjoint files and dependencies; `--sequential` disables wave execution. Stop at material deviations, regressions, or evidence contradicting the approach. Never weaken correctness for speed without explicit approval. Mandatory implementation-summary gate.

### 7. Verification options

Always select completeness, standards compliance, and the full test suite. Ask which additional checks to run: code review, pragmatic review, production readiness, or reality assessment. Default production readiness on for deployment-sensitive changes. Persist the selection. Mandatory gate.

### 8. Verification and issue resolution

Load `$maister-codex:maister-verify`. Write the canonical `verification/implementation-verification.md` and HTML companion when enabled. Include test results, standards compliance, before/after evidence when available, target comparison, remaining performance hypotheses, and prioritized findings.

For fixable findings, ask which to fix, apply only approved fixes, and reverify up to three cycles. Refresh the canonical report after every cycle; side reports never replace it. Do not claim success when no comparable runtime measurement exists—report “implementation verified; runtime impact unmeasured.” Do not proceed with unresolved critical issues without explicit approval. Mandatory final-verification gate.

### 9. Finalization

Mark state complete and summarize bottlenecks addressed, files changed, tests, measurements, achieved or pending targets, known risks, and commit guidance. Recommend representative runtime profiling and production monitoring rather than presenting static estimates as results.

## Artifacts

```text
analysis/codebase-analysis.md
analysis/clarifications.md
analysis/performance-analysis.md
analysis/user-profiling-data/
analysis/requirements.md
implementation/spec.md
implementation/implementation-plan.md
implementation/work-log.md
verification/spec-audit.md
verification/implementation-verification.md
```

## Recovery limits

- Phases 1-3 and 5: two attempts; then surface the missing evidence or decision.
- Phase 6: five focused correction attempts, without automatic rollback.
- Phase 8: three fix-and-reverify cycles; stop on unresolved correctness, integrity, or critical production issues.
- Missing profiling data is not a failure. Preserve confidence labels and finish with an explicit measurement plan.
