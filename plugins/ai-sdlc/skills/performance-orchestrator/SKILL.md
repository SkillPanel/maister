---
name: performance-orchestrator
description: Orchestrates performance optimization workflows using static code analysis to identify bottlenecks (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks). Accepts optional user-provided profiling data. Reuses standard specification, planning, implementation, and verification phases.
---

# Performance Orchestrator

Static-analysis-first performance optimization workflow. Identifies bottlenecks by reading code, then uses the standard specification/planning/implementation/verification pipeline to fix them.

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
2. **Create Task Directory**: `.maister/tasks/performance/YYYY-MM-DD-task-name/`
3. **Create Subdirectories**: `analysis/`, `analysis/user-profiling-data/`, `implementation/`, `verification/`
4. **Initialize State**: Create `orchestrator-state.yml` with mode and performance context

**Output**:
```
Performance Orchestrator Started

Task: [performance issue description]
Mode: [Interactive/YOLO]
Directory: [task-path]

Starting Phase 1: Codebase Analysis...
```

---

## When to Use

Use for:
- Application slow (response time issues, high latency)
- Need systematic bottleneck identification and resolution
- Want static code analysis for performance anti-patterns
- Have user-provided profiling data to act on
- Database query optimization needed
- Algorithm or I/O inefficiencies suspected

**DO NOT use for**: New features, bug fixes, refactoring without performance goals.

---

## Core Principles

1. **Static Analysis First**: Read code to detect patterns. Don't try to run profiling tools.
2. **User Data Welcome**: Incorporate user-provided profiling data when available
3. **Reuse Standard Phases**: Use proven specification/planning/implementation/verification pipeline
4. **Conservative Estimates**: Provide improvement ranges, not false precision
5. **Practical Optimizations**: Focus on patterns the agent CAN detect and fix

---

## Phase Configuration

| Phase | content | activeForm | Agent/Skill |
|-------|---------|------------|-------------|
| 1 | "Analyze codebase" | "Analyzing codebase" | codebase-analyzer |
| 2 | "Analyze performance bottlenecks" | "Analyzing performance bottlenecks" | bottleneck-analyzer |
| 3 | "Gather requirements & create specification" | "Gathering requirements & creating specification" | specification-creator |
| 4 | "Audit specification" | "Auditing specification" | spec-auditor (conditional) |
| 5 | "Plan implementation" | "Planning implementation" | implementation-planner |
| 6 | "Execute implementation" | "Executing implementation" | implementation-plan-executor |
| 7 | "Prompt verification options" | "Prompting verification options" | Direct |
| 8 | "Verify implementation & resolve issues" | "Verifying implementation" | implementation-verifier |
| 9 | "Finalize workflow" | "Finalizing workflow" | Direct |

---

## Workflow Phases

### Phase 1: Codebase Analysis & Clarifications

**Purpose**: Comprehensive codebase exploration for performance context, followed by scope/requirements clarification
**Execute**:
1. Skill tool - `maister:codebase-analyzer`
2. Update state with analysis results
3. Direct - use AskUserQuestion for max 5 critical clarifying questions about performance concerns, hotspots, and optimization goals
4. Save clarifications to `analysis/clarifications.md`
**Output**: `analysis/codebase-analysis.md`, `analysis/clarifications.md`
**State**: Update `performance_context.phase_summaries.codebase_analysis`, `task_context.clarifications_resolved`

Pass `task_type="enhancement"` and the performance-focused description. The codebase-analyzer adaptively selects parallel Explore agents based on task complexity. For performance tasks, the description should guide agents toward: database query patterns, hot code paths, I/O operations, caching layers, connection management, schema/migration files.

**YOLO Mode**: Accept all recommended defaults for clarifications

→ **AUTO-CONTINUE** — Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 2.

---

### Phase 2: Static Performance Analysis

**Purpose**: Identify bottlenecks through static code analysis + optional user profiling data
**Execute**: Task tool - `maister:bottleneck-analyzer` subagent
**Output**: `analysis/performance-analysis.md`
**State**: Update `performance_context.bottlenecks_identified`, `performance_context.user_data_available`, `performance_context.bottleneck_priorities`

**Process**:
1. Check if `analysis/user-profiling-data/` contains any files
2. If empty, use AskUserQuestion:
   - Question: "Do you have profiling data to provide (flame graphs, APM screenshots, slow query logs)?"
   - Options: "Yes, let me add files to analysis/user-profiling-data/" | "No, proceed with static analysis only"
3. If user chooses to add files, wait for them, then proceed

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me analyze the bottlenecks myself..." — STOP. Delegate to bottleneck-analyzer.
- ❌ "I'll grep for N+1 patterns..." — STOP. Delegate to bottleneck-analyzer.

**INVOKE NOW** — Task tool call:

4. Task tool - `maister:bottleneck-analyzer` subagent

**Context to pass**: task_path, description, codebase analysis summary from Phase 1, user data paths (if any)

**SELF-CHECK**: Did you just invoke the Task tool with `maister:bottleneck-analyzer`? Or did you start analyzing code yourself? If the latter, STOP and invoke the Task tool.

→ Pause

**Interactive**: AskUserQuestion - "Performance analysis complete. [N] bottlenecks identified ([P0 count] P0, [P1 count] P1). Continue to specification?"
**YOLO**: "→ Continuing to Phase 3..."

---

### Phase 3: Requirements & Specification

**Purpose**: Gather optimization requirements and create specification
**Output**: `analysis/requirements.md`, `implementation/spec.md`
**State**: Update `performance_context.phase_summaries.specification`

**Part A — Requirements Gathering (inline)**:

1. Present bottleneck summary from Phase 2 to user
2. Use AskUserQuestion for optimization priorities:
   - Which bottleneck priorities to address? (All P0+P1, P0 only, specific ones)
   - Any constraints? (backward compatibility, memory limits, no new dependencies)
   - Performance targets? (specific response time goals, if known)
3. Save gathered requirements to `analysis/requirements.md` with: performance issue description, bottleneck analysis summary, optimization priorities, constraints, targets

**YOLO Mode**: Address all P0+P1 bottlenecks, no special constraints

**Part B — Specification Creation (subagent)**:

📋 **Standards Discovery**: Read `.maister/docs/INDEX.md` before creating spec.

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the specification..." — STOP. Delegate to specification-creator.
- ❌ "I'll write the spec based on the analysis..." — STOP. Delegate to specification-creator.

**INVOKE NOW** — Task tool call:

4. Task tool - `maister:specification-creator` subagent

**Context to pass**: task_path, task_type="performance", task_description, requirements_path (analysis/requirements.md), project_context_paths (INDEX.md, vision.md, roadmap.md, tech-stack.md), phase_summaries (codebase_analysis, bottleneck_analysis)

**SELF-CHECK**: Did you just invoke the Task tool with `maister:specification-creator`? Or did you start writing spec.md yourself? If the latter, STOP and invoke the Task tool.

→ Pause

**Interactive**: AskUserQuestion - "Specification created. Continue to Phase 4?"
**YOLO**: "→ Continuing to Phase 4..."

---

### Phase 4: Specification Audit (Conditional)

**Purpose**: Independent review of optimization specification
**Execute**: Task tool - `maister:spec-auditor` subagent
**Output**: `verification/spec-audit.md`
**State**: Update `options.spec_audit_enabled`

**Run if**: >5 optimizations planned, spec >50 lines, or user requests
**Skip if**: Simple optimization (1-3 changes)

**Interactive**: AskUserQuestion to decide - "Run specification audit?"
**YOLO**: Auto-decide based on optimization count

→ Pause

**Interactive**: AskUserQuestion - "Audit complete. Continue to Phase 5?"
**YOLO**: "→ Continuing to Phase 5..."

---

### Phase 5: Implementation Planning

**Purpose**: Break optimization specification into implementation steps

📋 **Standards Discovery**: Read `.maister/docs/INDEX.md` before planning.

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the implementation plan..." — STOP. Delegate to implementation-planner.
- ❌ "I'll break this into optimization steps..." — STOP. Delegate to implementation-planner.

**INVOKE NOW** — Task tool call:

**Execute**: Task tool - `maister:implementation-planner` subagent
**Output**: `implementation/implementation-plan.md`
**State**: Update task groups and dependencies

**Context to pass**: task_path, task_type="performance", task_description, phase_summaries (specification, bottleneck_analysis, codebase_analysis)

**SELF-CHECK**: Did you just invoke the Task tool with `maister:implementation-planner`? Or did you start writing the plan yourself? If the latter, STOP and invoke the Task tool.

→ Pause

**Interactive**: AskUserQuestion - "Implementation plan created. Continue to Phase 6?"
**YOLO**: "→ Continuing to Phase 6..."

---

### Phase 6: Implementation

**Purpose**: Execute the optimization plan

📋 **Standards Discovery**: Implementation reads `.maister/docs/INDEX.md` continuously.

**Execute**: Skill tool - `maister:implementation-plan-executor`
**Output**: Implemented optimizations, `implementation/work-log.md`
**State**: Update implementation progress

→ **AUTO-CONTINUE** — Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 7.

---

### Phase 7: Verification Options

**Purpose**: Determine which verification checks to run
**Execute**: Direct - use AskUserQuestion for options
**Output**: Updated state with verification options
**State**: Set `options.code_review_enabled`, `options.pragmatic_review_enabled`, `options.production_check_enabled`, `options.reality_check_enabled`

**Always enabled**: Reality check, pragmatic review
**Auto-set**: `skip_test_suite: true` (full test suite already passed during implementation phase; cleared before re-verification if fixes are applied)

**Interactive**: AskUserQuestion with multiselect - "Which additional verification checks?"
  - "Code review" (recommended)
  - "Production readiness check"
**YOLO**: Auto-enable code review, skip production readiness

→ Pause

**Interactive**: AskUserQuestion - "Options selected. Continue to Phase 8?"
**YOLO**: "→ Continuing to Phase 8..."

---

### Phase 8: Verification & Issue Resolution

**Purpose**: Comprehensive implementation verification with fix-then-reverify cycles
**Execute**:
1. Skill tool - `maister:implementation-verifier`
2. If issues found: Fix trivial issues directly, AskUserQuestion for non-trivial
3. Before re-verification: set `skip_test_suite: false` (code changed, tests must re-run)
4. Re-verify after fixes (max 3 fix-then-reverify cycles)
**Output**: `verification/implementation-verification.md`, optional review reports
**State**: Update `verification_context`

→ Pause

**Interactive**: AskUserQuestion - "Verification complete. Continue to finalization?"
**YOLO**: "→ Continuing to Phase 9..."

---

### Phase 9: Finalization

**Purpose**: Complete workflow and provide next steps
**Execute**: Direct - create summary, update state, guide commit
**Output**: Workflow summary
**State**: Set `task.status: completed`

**Process**:
1. Create workflow summary (bottlenecks found, optimizations implemented, verification result)
2. Update task status to "completed"
3. Provide commit message template
4. Guide performance-specific next steps:
   - Run the application and verify improvements manually
   - Consider profiling with runtime tools to measure actual impact
   - Monitor production metrics after deployment
   - Address remaining P2/P3 bottlenecks if needed

→ End of workflow

---

## Domain Context (State Extensions)

Performance-specific fields in `orchestrator-state.yml`:

```yaml
performance_context:
  bottlenecks_identified: null    # count from bottleneck-analyzer
  user_data_available: false      # whether user provided profiling data
  bottleneck_priorities:
    p0: 0
    p1: 0
    p2: 0
    p3: 0
  phase_summaries:
    codebase_analysis: {key_files: [], summary: null}
    bottleneck_analysis: {bottlenecks: [], summary: null, user_data_incorporated: false}
    specification: {summary: null}

verification_context:
  last_status: null
  issues_found: null
  fixes_applied: []
  decisions_made: []
  reverify_count: 0

options:
  spec_audit_enabled: null
  skip_test_suite: true
  code_review_enabled: true
  pragmatic_review_enabled: true
  reality_check_enabled: true
  production_check_enabled: null
```

---

## Task Structure

```
.maister/tasks/performance/YYYY-MM-DD-task-name/
├── orchestrator-state.yml
├── analysis/
│   ├── codebase-analysis.md           # Phase 1
│   ├── performance-analysis.md        # Phase 2
│   ├── user-profiling-data/           # Optional user-provided data
│   └── requirements.md                # Phase 3
├── implementation/
│   ├── spec.md                        # Phase 3
│   ├── implementation-plan.md         # Phase 5
│   └── work-log.md                    # Phase 6
└── verification/
    ├── spec-audit.md                  # Phase 4 (conditional)
    └── implementation-verification.md # Phase 8
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 1 | 2 | Expand search scope, prompt user for hints |
| 2 | 2 | Re-analyze with broader patterns, ask user |
| 3 | 2 | Regenerate spec with adjusted requirements |
| 5 | 2 | Regenerate plan |
| 6 | 5 | Fix syntax, imports, tests |
| 8 | 3 | Fix-then-reverify cycles |

---

## Command Integration

Invoked via:
- `/maister:performance-new [description] [--yolo]`
- `/maister:performance-resume [task-path]`

Task directory: `.maister/tasks/performance/YYYY-MM-DD-task-name/`
