---
name: migration
description: Orchestrates the complete migration workflow from current state analysis through implementation to compatibility verification. Handles technology migrations, platform changes, and architecture pattern transitions with adaptive risk assessment, incremental execution, and rollback planning. Use when migrating technologies, platforms, or architecture patterns.
user-invocable: true
---

# Migration Orchestrator

Systematic migration workflow from current state analysis to verified migration with rollback capabilities.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md` - Delegation rules, interactive mode, state schema, initialization, context passing, issue resolution

### Step 2: Initialize Workflow

1. **Create Task Items**: Use `TaskCreate` for all phases (see Phase Configuration), then set dependencies with `TaskUpdate addBlockedBy`
2. **Create Task Directory**: `.maister/tasks/migrations/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with migration context

**Output**:
```
🚀 Migration Orchestrator Started

Task: [migration description]
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
1. Skill tool - `maister-codebase-analyzer`
2. Update state with analysis results
3. Direct - use ask_user for max 5 critical clarifying questions about migration scope, target system, and constraints
4. Save clarifications to `analysis/clarifications.md`
**Output**: `analysis/current-state-analysis.md`, `analysis/clarifications.md`
**State**: Update task_context with current system info, `task_context.clarifications_resolved`

→ **AUTO-CONTINUE** — Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 2.

---

### Phase 2: Target State Planning & Gap Analysis

**Purpose**: Define target system and identify migration gaps
**Execute**: Task tool - `maister-gap-analyzer` subagent
**Output**: `analysis/target-state-plan.md`
**State**: Update `migration_context.migration_type`, `target_system`, `risk_level`, `breaking_changes`

**Gap Analyzer Tasks**:
1. Define target system from migration description
2. Identify gaps (features to migrate, APIs to adapt, data to transform)
3. Classify migration type (code/data/architecture)
4. Recommend migration strategy (incremental/big-bang/dual-run/phased)
5. External research via WebSearch for version upgrades

→ Pause

ask_user - Display executive summary before asking. Extract from gap analysis: current system overview, target system, migration type classified, number of gaps identified, recommended strategy, risk level. Format as brief overview then "Continue to migration strategy?"

---

### Phase 3: Migration Requirements & Strategy Specification

> **Phase gate**: Requires `ask_user` confirmation from Phase 2 before executing.

**Purpose**: Gather migration requirements, then create detailed migration specification with rollback procedures
**Execute**:

**Part A — Migration Requirements Gathering (inline)**:
1. Direct - use ask_user for migration-specific requirements (3-5 questions):
   - Migration scope and boundaries (what's in/out of migration)
   - Rollback expectations and downtime tolerance
   - Data migration specifics (if data migration type)
   - Dual-run requirements (if applicable)
   - Existing code/config to preserve
   - Frame as confirmable assumptions: "I assume X, is that correct?"
2. Save gathered requirements to `analysis/requirements.md`

**Part B — Specification Creation (subagent)**:
3. Task tool - `maister-specification-creator` subagent

**Context to pass to subagent**: task_path, task_type (migration), task_description, requirements_path (analysis/requirements.md), project_context_paths, migration_type, current_system, target_system, risk_level, breaking_changes, phase_summaries (current_state_analysis, gap_analysis)

**Output**: `analysis/requirements.md`, `implementation/spec.md`, `analysis/rollback-plan.md`, optionally `analysis/dual-run-plan.md`
**State**: Update `rollback_plan_created`, `dual_run_configured`

→ Pause

ask_user - Display executive summary before asking. Read `implementation/spec.md` and extract: migration strategy chosen, scope boundaries, rollback approach, breaking changes identified, key constraints. Format as brief overview then "Continue to implementation planning?"

---

### Phase 4: Implementation Planning

> **Phase gate**: Requires `ask_user` confirmation from Phase 3 before executing.

**Purpose**: Break migration into task groups with rollback steps
**Execute**: Task tool - `maister-implementation-planner` subagent
**Output**: `implementation/implementation-plan.md` with rollback procedures
**State**: Update task groups and dependencies

**Context to pass to subagent**: task_path, task_type (migration), migration_type, task_description, phase_summaries (current_state_analysis, gap_analysis, specification)

→ Pause

ask_user - Display executive summary before asking. Read `implementation/implementation-plan.md` and extract: number of task groups, total steps, rollback steps included, key dependencies, execution sequence. Format as brief overview then "Continue to execute migration?"

---

### Phase 5: Migration Execution

> **Phase gate**: Requires `ask_user` confirmation from Phase 4 before executing.

**Purpose**: Execute migration steps with incremental verification

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me implement this directly..." — STOP. Delegate to implementer.
- ❌ "This migration is simple enough to code inline..." — STOP. Simplicity is NOT a reason to skip delegation.

**INVOKE NOW** — Skill tool call:

**Execute**: Skill tool - `maister-implementer`
**Output**: Implemented migration changes, `implementation/work-log.md`
**State**: Update implementation progress, extract phase_summaries.implementation

📋 **Standards Reminder**: Review `.maister/docs/INDEX.md` before implementing.

**SELF-CHECK**: Did you just invoke the Skill tool with `maister-implementer`? Or did you start writing migration code yourself? If the latter, STOP immediately and invoke the Skill tool instead.

**⚠️ POST-IMPLEMENTATION CONTINUATION** — After the skill completes and returns control:
1. Read `orchestrator-state.yml` to confirm you are the orchestrator
2. Update state: add Phase 5 to `completed_phases`
3. Proceed to Phase 6

→ Pause

ask_user - Display executive summary before asking. Extract from `phase_summaries.implementation` and `implementation/work-log.md`: migration steps completed, files changed, test results, rollback readiness status. Format as brief overview then "Continue to verification?"

---

### Phase 6: Verification + Compatibility Testing

> **Phase gate**: Requires `ask_user` confirmation from Phase 5 before executing.

**Purpose**: Verify migration success with compatibility and rollback testing
**Execute**: Skill tool - `maister-implementation-verifier`
**Output**: `verification/implementation-verification.md`, `verification/compatibility-test-results.md`
**State**: Update verification results

**Migration-Specific Checks**:
- Verify old system still works (if dual-run)
- Test rollback procedures (non-destructive)
- Validate data integrity (for data migrations)
- Check performance benchmarks (before/after)

**⚠️ POST-VERIFICATION CONTINUATION** — After the skill completes and returns control:
1. Read `orchestrator-state.yml` to confirm you are the orchestrator
2. Update state: add Phase 6 to `completed_phases`
3. Evaluate verdict: if PASS → Phase 8, if fixable issues → Phase 7, otherwise stop workflow

→ Pause

ask_user - Display executive summary before asking. Extract from verification results: overall verdict, issue counts by severity, compatibility test results, data integrity status, rollback test results. Format as detailed overview then "Continue to Phase [7 or 8]?"

---

### Phase 7: Migration Issue Resolution (Conditional)

> **Phase gate**: Requires `ask_user` confirmation from Phase 6 before executing.

**Purpose**: Fix verification issues through direct editing and re-verification
**Execute**: Direct - apply fixes, re-verify
**Output**: Updated code, `verification_context.fixes_applied`
**State**: Update `reverify_count`, `decisions_made`

**Skip if**: verdict = PASS

**Process**:
1. Display detailed issue breakdown grouped by category and severity, listing location, description, and fixability
2. Present all critical + warning issues as a numbered list
3. ask_user — "Which issues should I fix?" with options: "Fix all fixable issues" / "Let me choose specific issues" / "Skip fixes, proceed as-is"
4. Fix selected issues
5. ask_user — "Re-run verification to check fixes?" with options: "Yes, re-run verification" / "No, proceed to next phase"
6. If re-run → re-invoke `maister-implementation-verifier` → return to Step 1
7. Max 3 iterations

**Data Safety Critical**: HALT on any data integrity issue - never auto-fix data problems. Always present data issues to user with rollback option.

**Exit Conditions**:
- ✅ No critical issues remain → Proceed to Phase 8
- ⚠️ Max iterations (3) reached → Ask user: proceed with warnings or rollback
- ❌ Data integrity issues → HALT immediately, recommend rollback

→ Pause

ask_user - Display executive summary: total issues found, issues fixed, issues remaining by severity. Then "Continue to documentation?"

---

### Phase 8: Documentation (Optional)

> **Phase gate**: Requires `ask_user` confirmation from the preceding phase before executing.

**Purpose**: Create migration guide for end users
**Execute**: Task tool - `maister-user-docs-generator` subagent
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
- `/maister-migration [description] [--type=TYPE]` (new)
- `/maister-migration [task-path] [--from=PHASE]` (resume)

Task directory: `.maister/tasks/migrations/YYYY-MM-DD-task-name/`
