---
name: migration-orchestrator
description: Orchestrates the complete migration workflow from current state analysis through implementation to compatibility verification. Handles technology migrations, platform changes, and architecture pattern transitions with adaptive risk assessment, incremental execution, and rollback planning. Supports interactive mode (pause between phases) and YOLO mode (continuous execution). Use when migrating technologies, platforms, or architecture patterns.
---

# Migration Orchestrator

Systematic migration workflow from current state analysis to verified migration with rollback capabilities.

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
2. **Create Task Directory**: `.maister/tasks/migrations/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with mode and migration context

**Output**:
```
🚀 Migration Orchestrator Started

Task: [migration description]
Mode: [Interactive/YOLO]
Directory: [task-path]

Starting Phase 1: Analyze current state...
```

---

## When to Use

Use for:
- Migrating from one framework/library to another (e.g., Vue 2 → Vue 3, Express → Fastify)
- Changing database platforms (e.g., MySQL → PostgreSQL, MongoDB → DynamoDB)
- Refactoring architecture patterns (e.g., REST → GraphQL, Monolith → Microservices)
- Upgrading major versions with breaking changes

**DO NOT use for**: New features, bug fixes, pure refactoring without technology change.

---

## Core Principles

1. **Analyze Before Migrating**: Understand current system before planning target state
2. **Risk Assessment**: Classify migration type (code/data/architecture) and assess complexity
3. **Incremental Execution**: Support phased migration with rollback points
4. **Rollback Planning**: Document undo procedures for each migration phase
5. **Dual-Run Support**: Enable running old and new systems in parallel during transition

---

## Migration Types

| Type | Keywords | Strategy | Risk Focus |
|------|----------|----------|------------|
| **Code** | framework, library, upgrade | Incremental or phased | Breaking changes, API differences |
| **Data** | database, schema, data migration | Dual-run (zero downtime) | Data integrity, checksums |
| **Architecture** | REST→GraphQL, monolith→microservices | Dual-run or phased | Compatibility, rollback |

---

## Phase Configuration

| Phase | content | activeForm | Agent/Skill |
|-------|---------|------------|-------------|
| 1 | "Analyze current state" | "Analyzing current state" | codebase-analyzer |
| 2 | "Plan target state and gaps" | "Planning target state and gaps" | gap-analyzer |
| 3 | "Gather requirements & create migration strategy" | "Gathering requirements & creating migration strategy" | Direct + specification-creator (subagent) |
| 4 | "Plan implementation" | "Planning implementation" | implementation-planner (subagent) |
| 5 | "Execute migration" | "Executing migration" | implementer |
| 6 | "Verify and test compatibility" | "Verifying and testing compatibility" | implementation-verifier |
| 7 | "Resolve verification issues" | "Resolving verification issues" | Direct (conditional) |
| 8 | "Generate documentation" | "Generating documentation" | user-docs-generator (optional) |

---

## Workflow Phases

### Phase 1: Current State Analysis & Clarifications

**Purpose**: Comprehensive analysis of current system before migration, followed by scope/requirements clarification
**Execute**:
1. Skill tool - `maister:codebase-analyzer`
2. Update state with analysis results
3. Direct - use AskUserQuestion for max 5 critical clarifying questions about migration scope, target system, and constraints
4. Save clarifications to `analysis/clarifications.md`
**Output**: `analysis/current-state-analysis.md`, `analysis/clarifications.md`
**State**: Update task_context with current system info, `task_context.clarifications_resolved`

**YOLO Mode**: Accept all recommended defaults for clarifications

→ **AUTO-CONTINUE** — Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 2.

---

### Phase 2: Target State Planning & Gap Analysis

**Purpose**: Define target system and identify migration gaps
**Execute**: Task tool - `maister:gap-analyzer` subagent
**Output**: `analysis/target-state-plan.md`
**State**: Update `migration_context.migration_type`, `target_system`, `risk_level`, `breaking_changes`

**Gap Analyzer Tasks**:
1. Define target system from migration description
2. Identify gaps (features to migrate, APIs to adapt, data to transform)
3. Classify migration type (code/data/architecture)
4. Recommend migration strategy (incremental/big-bang/dual-run/phased)
5. External research via WebSearch for version upgrades

→ Pause

**Interactive**: AskUserQuestion - "Gap analysis complete. Continue to migration strategy?"
**YOLO**: "→ Continuing to Phase 3..."

---

### Phase 3: Migration Requirements & Strategy Specification

**Purpose**: Gather migration requirements, then create detailed migration specification with rollback procedures
**Execute**:

**Part A — Migration Requirements Gathering (inline)**:
1. Direct - use AskUserQuestion for migration-specific requirements (3-5 questions):
   - Migration scope and boundaries (what's in/out of migration)
   - Rollback expectations and downtime tolerance
   - Data migration specifics (if data migration type)
   - Dual-run requirements (if applicable)
   - Existing code/config to preserve
   - Frame as confirmable assumptions: "I assume X, is that correct?"
2. Save gathered requirements to `analysis/requirements.md`

**Part B — Specification Creation (subagent)**:
3. Task tool - `maister:specification-creator` subagent

**Context to pass to subagent**: task_path, task_type (migration), task_description, requirements_path (analysis/requirements.md), project_context_paths, migration_type, current_system, target_system, risk_level, breaking_changes, phase_summaries (current_state_analysis, gap_analysis)

**Output**: `analysis/requirements.md`, `implementation/spec.md`, `analysis/rollback-plan.md`, optionally `analysis/dual-run-plan.md`
**State**: Update `rollback_plan_created`, `dual_run_configured`

**YOLO Mode**: Accept recommended defaults for all migration questions

→ Pause

**Interactive**: AskUserQuestion - "Migration specification complete. Continue to implementation planning?"
**YOLO**: "→ Continuing to Phase 4..."

---

### Phase 4: Implementation Planning

**Purpose**: Break migration into task groups with rollback steps
**Execute**: Task tool - `maister:implementation-planner` subagent
**Output**: `implementation/implementation-plan.md` with rollback procedures
**State**: Update task groups and dependencies

**Context to pass to subagent**: task_path, task_type (migration), migration_type, task_description, phase_summaries (current_state_analysis, gap_analysis, specification)

→ Pause

**Interactive**: AskUserQuestion - "Implementation plan ready. Continue to execute migration?"
**YOLO**: "→ Continuing to Phase 5..."

---

### Phase 5: Migration Execution

**Purpose**: Execute migration steps with incremental verification
**Execute**: Skill tool - `maister:implementer`
**Output**: Implemented migration changes, `implementation/work-log.md`
**State**: Update implementation progress

**Standards Reminder**: Review `.maister/docs/INDEX.md` before implementing.

→ Pause

**Interactive**: AskUserQuestion - "Migration execution complete. Continue to verification?"
**YOLO**: "→ Continuing to Phase 6..."

---

### Phase 6: Verification + Compatibility Testing

**Purpose**: Verify migration success with compatibility and rollback testing
**Execute**: Skill tool - `maister:implementation-verifier`
**Output**: `verification/implementation-verification.md`, `verification/compatibility-test-results.md`
**State**: Update verification results

**Migration-Specific Checks**:
- Verify old system still works (if dual-run)
- Test rollback procedures (non-destructive)
- Validate data integrity (for data migrations)
- Check performance benchmarks (before/after)

→ Conditional: if verdict=PASS skip to Phase 8, if fixable issues continue to Phase 7, otherwise stop workflow

---

### Phase 7: Migration Issue Resolution (Conditional)

**Purpose**: Fix verification issues through direct editing and re-verification
**Execute**: Direct - apply fixes, re-verify
**Output**: Updated code, `verification_context.fixes_applied`
**State**: Update `reverify_count`, `decisions_made`

**Skip if**: verdict = PASS

**Process**:
1. Parse issues (categorize: auto-fixable, needs decision, not fixable)
2. Apply auto-fixes (test fixes, config adjustments, deprecation warnings)
3. For user decisions: AskUserQuestion with rollback option
4. Re-verify after fixes (max 3 iterations)

**Data Safety Critical**: HALT on any data integrity issue - never auto-fix data problems.

**Exit Conditions**:
- ✅ New verdict = PASS → Proceed to Phase 8
- ⚠️ Max iterations (3) reached → Ask user: proceed with warnings or rollback
- ❌ Data integrity issues → HALT immediately, recommend rollback

→ Pause

**Interactive**: AskUserQuestion - "Issues resolved. Continue to documentation?"
**YOLO**: "→ Continuing to Phase 8..."

---

### Phase 8: Documentation (Optional)

**Purpose**: Create migration guide for end users
**Execute**: Task tool - `maister:user-docs-generator` subagent
**Output**: `documentation/migration-guide.md`
**State**: Set documentation complete

**Skip if**: `options.docs_enabled = false`

**Documentation Covers**:
- Migration overview and goals
- Prerequisites and preparation steps
- Step-by-step migration procedure
- Rollback procedures
- Troubleshooting common issues

→ End of workflow

---

## Domain Context (State Extensions)

Migration-specific fields in `orchestrator-state.yml`:

```yaml
migration_context:
  migration_type: "code" | "data" | "architecture" | "general"
  current_system:
    description: null
    technologies: []
  target_system:
    description: null
    technologies: []
  migration_strategy:
    approach: "incremental" | "big-bang" | "dual-run" | "phased"
    phases: []
  risk_level: null
  breaking_changes: []
  rollback_plan_created: false
  dual_run_configured: false

external_research:
  performed: false
  category: null
  breaking_changes: []
  migration_guide_url: null

verification_context:
  last_status: null
  issues_found: null
  fixes_applied: []
  decisions_made: []
  reverify_count: 0

options:
  docs_enabled: false
```

---

## Task Structure

```
.maister/tasks/migrations/YYYY-MM-DD-migration-name/
├── orchestrator-state.yml
├── analysis/
│   ├── current-state-analysis.md     # Phase 1
│   ├── target-state-plan.md          # Phase 2
│   ├── requirements.md               # Phase 3
│   ├── rollback-plan.md              # Phase 3
│   └── dual-run-plan.md              # Phase 3 (if dual-run)
├── implementation/
│   ├── spec.md                       # Phase 3
│   ├── implementation-plan.md        # Phase 4
│   └── work-log.md                   # Phase 5
├── verification/
│   ├── implementation-verification.md    # Phase 6
│   └── compatibility-test-results.md     # Phase 6
└── documentation/
    └── migration-guide.md            # Phase 8 (optional)
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 1 | 2 | Expand search patterns, prompt user for file paths |
| 2 | 2 | Re-prompt for target details |
| 3 | 2 | Re-gather requirements, re-invoke spec-creator subagent, regenerate rollback plan |
| 4 | 2 | Regenerate with migration constraints |
| 5 | 5 | Fix syntax errors, prompt user on repeated failure |
| 6 | 3 | Fix-then-reverify. **HALT on data integrity issues** |
| 8 | 1 | Generate text-only without screenshots |

---

## Command Integration

Invoked via:
- `/maister:migration-new [description] [--yolo] [--type=TYPE]`
- `/maister:migration-resume [task-path] [--from=PHASE]`

Task directory: `.maister/tasks/migrations/YYYY-MM-DD-task-name/`
