---
name: performance-orchestrator
description: Orchestrates performance optimization workflows with profiling, benchmarking, and load testing. Measures baseline, identifies bottlenecks, implements optimizations incrementally with benchmarks, and verifies production readiness.
---

# Performance Orchestrator

Systematic performance optimization workflow from profiling to production-ready deployment.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 1: Load Framework Patterns

**Read ALL framework reference files NOW using the Read tool:**

1. `../orchestrator-framework/references/phase-execution-pattern.md`
2. `../orchestrator-framework/references/interactive-mode.md`
3. `../orchestrator-framework/references/delegation-enforcement.md`
4. `../orchestrator-framework/references/state-management.md`
5. `../orchestrator-framework/references/initialization-pattern.md`
6. `../orchestrator-framework/references/issue-resolution-pattern.md`

### Step 2: Initialize Workflow

1. **Create Task Items**: Use `TaskCreate` for all phases (see Phase Configuration), then set dependencies with `TaskUpdate addBlockedBy`
2. **Create Task Directory**: `.ai-sdlc/tasks/performance/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with mode and performance context

**Output**:
```
🚀 Performance Orchestrator Started

Task: [performance issue description]
Mode: [Interactive/YOLO]
Directory: [task-path]

Starting Phase 0: Profile and establish baseline...
```

---

## When to Use

Use for:
- Application slow (response time >1s, high latency)
- Need systematic optimization workflow
- Want benchmarking and verification
- Require load testing before production
- Performance issues reported

**DO NOT use for**: New features, bug fixes, refactoring without performance goals.

---

## Core Principles

1. **Measure First**: Never optimize without baseline metrics
2. **Benchmark-Driven**: Prove every optimization with benchmarks
3. **Incremental**: One optimization at a time (attribute improvements)
4. **Production-Realistic**: Test with real data volumes and traffic patterns
5. **Quantitative**: Use objective metrics, not subjective feelings

---

## Phase Configuration

| Phase | content | activeForm | Agent/Skill |
|-------|---------|------------|-------------|
| 0 | "Profile and establish baseline" | "Profiling and establishing baseline" | performance-profiler |
| 1 | "Analyze bottlenecks and plan" | "Analyzing bottlenecks and planning" | bottleneck-analyzer |
| 2 | "Implement with benchmarking" | "Implementing with benchmarking" | Direct + implementation-changes-planner |
| 3 | "Verify performance improvements" | "Verifying performance improvements" | performance-verifier |
| 3.5 | "Resolve verification issues" | "Resolving verification issues" | Direct (conditional) |
| 4 | "Load test and check readiness" | "Load testing and checking readiness" | Direct + production-readiness-checker |

---

## Workflow Phases

### Phase 0: Performance Baseline & Profiling

**Purpose**: Measure current performance metrics to establish baseline
**Execute**: Task tool - `ai-sdlc:performance-profiler` subagent
**Output**: `analysis/performance-baseline.md`
**State**: Update `performance_context.baseline_p95`, `target_p95`

**Profiler Tasks**:
1. Measure response time (p50, p95, p99)
2. Measure throughput (req/sec, saturation point)
3. Profile CPU usage (hot functions)
4. Profile memory usage (heap size, growth, leaks)
5. Count database queries (N+1 patterns, slow queries)
6. Identify performance hotspots

→ Pause

**Interactive**: AskUserQuestion - "Baseline established. Continue to bottleneck analysis?"
**YOLO**: "→ Continuing to Phase 1..."

---

### Phase 1: Bottleneck Analysis & Optimization Planning

**Purpose**: Identify bottlenecks and create prioritized optimization plan
**Execute**: Task tool - `ai-sdlc:bottleneck-analyzer` subagent
**Output**: `implementation/optimization-plan.md`
**State**: Update `performance_context.optimizations_planned`

**Analyzer Tasks**:
1. Analyze database performance (N+1 queries, missing indexes)
2. Review CPU hotspots (inefficient algorithms)
3. Detect memory issues (leaks, excessive allocations)
4. Identify I/O bottlenecks (blocking operations)
5. Classify and prioritize bottlenecks (P0/P1/P2/P3)

→ Pause

**Interactive**: AskUserQuestion - "Optimization plan ready. Continue to implementation?"
**YOLO**: "→ Continuing to Phase 2..."

---

### Phase 2: Implementation with Benchmarking

**Purpose**: Implement optimizations with before/after benchmarks
**Execute**: Direct for simple (1-3 files), Task tool - `ai-sdlc:implementation-changes-planner` for complex (4+ files)
**Output**: Modified code, `implementation/benchmarks/*.txt`
**State**: Increment `performance_context.optimizations_completed` after each

**Standards Reminder**: Review `.ai-sdlc/docs/INDEX.md` before implementing.

**Process** (for each optimization in priority order):
1. Benchmark before
2. Implement optimization
3. Benchmark after
4. Verify improvement vs target
5. Run tests (ensure no regressions)
6. Update plan (mark complete/failed)

→ Pause

**Interactive**: AskUserQuestion - "Optimizations complete. Continue to verification?"
**YOLO**: "→ Continuing to Phase 3..."

---

### Phase 3: Performance Verification

**Purpose**: Verify optimizations achieved targets with no regressions
**Execute**: Task tool - `ai-sdlc:performance-verifier` subagent
**Output**: `verification/performance-verification.md` with verdict
**State**: Update `performance_context.verification_verdict`, `overall_improvement`

**Verdict Criteria**:
- **PASS**: All critical targets met, no critical regressions
- **PASS with Concerns**: Most targets met (>80%), minor regressions only
- **FAIL**: Critical targets not met (<80%) or critical regressions

→ Conditional: if verdict=PASS skip to Phase 4, if fixable issues continue to Phase 3.5, otherwise stop workflow

---

### Phase 3.5: Issue Resolution (Conditional)

**Purpose**: Fix performance issues through direct editing and re-verification
**Execute**: Direct - apply fixes, re-verify with performance-verifier
**Output**: Updated code, `verification_context.fixes_applied`
**State**: Update `reverify_count`, `decisions_made`

**Skip if**: verdict = PASS

**Process**:
1. Parse issues (categorize: auto-fixable, needs decision, not fixable)
2. Apply auto-fixes (cache config, query hints, index additions)
3. For user decisions: AskUserQuestion with options
4. Re-verify after fixes (max 3 iterations)

**Exit Conditions**:
- ✅ New verdict = PASS → Proceed to Phase 4
- ⚠️ Max iterations (3) reached → Ask user: continue with concerns or stop
- ❌ Critical regressions remain → Report to user, recommend stopping

→ Pause

**Interactive**: AskUserQuestion - "Issues resolved. Continue to load testing?"
**YOLO**: "→ Continuing to Phase 4..."

---

### Phase 4: Load Testing & Production Readiness

**Purpose**: Verify performance under production-like load
**Execute**: Direct for load tests, Task tool - `ai-sdlc:production-readiness-checker` subagent for production check
**Output**: `verification/load-test-results.md`, `verification/production-readiness-report.md`
**State**: Set load testing and production readiness results

**Load Test Scenarios**:
- Ramp-up: Gradually increase to 200 VUs over 10 minutes
- Sustained: 500 VUs for 30 minutes
- Spike: 10x sudden increase to 1000 VUs

**Success Criteria**:
- CPU <90%, memory stable
- Error rates <1%
- Response times within targets under load

→ End of workflow

---

## Domain Context (State Extensions)

Performance-specific fields in `orchestrator-state.yml`:

```yaml
performance_context:
  baseline_p95: null  # milliseconds
  target_p95: null    # milliseconds
  optimizations_planned: null
  optimizations_completed: 0
  verification_verdict: null
  overall_improvement: null

verification_context:
  last_status: null
  issues_found: null
  fixes_applied: []
  decisions_made: []
  reverify_count: 0

options:
  skip_load_testing: false
  skip_production_check: false
```

---

## Task Structure

```
.ai-sdlc/tasks/performance/YYYY-MM-DD-task-name/
├── orchestrator-state.yml
├── analysis/
│   └── performance-baseline.md        # Phase 0
├── implementation/
│   ├── optimization-plan.md           # Phase 1
│   └── benchmarks/                    # Phase 2
└── verification/
    ├── performance-verification.md    # Phase 3
    ├── load-test-results.md           # Phase 4
    └── production-readiness-report.md # Phase 4 (optional)
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 0 | 2 | Expand profiling, try alternatives |
| 1 | 2 | Prompt user if bottleneck unclear |
| 2 | 3 | Fix syntax errors, retry benchmarks |
| 3 | 0 | Read-only, report only |
| 3.5 | 3 | Fix-then-reverify cycles |
| 4 | 1 | Retry failed load tests |

---

## Command Integration

Invoked via:
- `/ai-sdlc:performance:new [description] [--yolo]`
- `/ai-sdlc:performance:resume [task-path]`

Task directory: `.ai-sdlc/tasks/performance/YYYY-MM-DD-task-name/`
