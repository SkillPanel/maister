---
name: development-orchestrator
description: Unified orchestrator for all development tasks (bug fixes, enhancements, new features). Adapts workflow phases based on task type while maintaining consistent quality gates. Supports interactive mode (pause between phases) and YOLO mode (continuous execution). Use for any development work that modifies code.
---

# Development Orchestrator

Unified workflow for bug fixes, enhancements, and new features with task-type-specific adaptations.

## MANDATORY Initialization (Before Any Phase Work)

**CRITICAL: You MUST complete these steps BEFORE executing any workflow phase:**

### Step 1: Create TodoWrite with All Phases

**Immediately use the TodoWrite tool** to create todos for all phases:

```
Use TodoWrite tool with todos:
[
  {"content": "Analyze codebase", "status": "pending", "activeForm": "Analyzing codebase"},
  {"content": "Clarify requirements", "status": "pending", "activeForm": "Clarifying requirements"},
  {"content": "Analyze gaps", "status": "pending", "activeForm": "Analyzing gaps"},
  {"content": "Create specification", "status": "pending", "activeForm": "Creating specification"},
  {"content": "Audit specification", "status": "pending", "activeForm": "Auditing specification"},
  {"content": "Plan implementation", "status": "pending", "activeForm": "Planning implementation"},
  {"content": "Execute implementation", "status": "pending", "activeForm": "Executing implementation"},
  {"content": "Verify implementation", "status": "pending", "activeForm": "Verifying implementation"},
  {"content": "Finalize workflow", "status": "pending", "activeForm": "Finalizing workflow"}
]
```

Add task-type-specific phases as needed:
- **Bug fixes**: Add `{"content": "Write failing test (TDD Red)", "status": "pending", "activeForm": "Writing failing test"}` after "Analyze gaps" and `{"content": "Verify test passes (TDD Green)", "status": "pending", "activeForm": "Verifying test passes"}` after "Execute implementation"
- **Features/Enhancements with UI** (ui_heavy=true): Add `{"content": "Clarify UI approach", "status": "pending", "activeForm": "Clarifying UI approach"}` and `{"content": "Generate UI mockups", "status": "pending", "activeForm": "Generating UI mockups"}` after "Analyze gaps"
- **Complex tasks** (multiple approaches or high risk): Add `{"content": "Clarify technical approach", "status": "pending", "activeForm": "Clarifying technical approach"}` before "Create specification"

### Step 2: Output Initialization Summary

**Output this summary to the user:**

```
🚀 Development Orchestrator Started

Task: [task description]
Type: [Bug Fix / Enhancement / Feature]
Mode: [Interactive/YOLO]
Directory: [task-path]

Workflow phases:
[Todos list with status]

[Interactive mode] You'll be prompted for review after each phase.
[YOLO mode] All phases will run continuously.

Starting Phase 1: Analyze codebase...
```

### Step 3: Phase Summary Output (After Each Phase)

**CRITICAL: After EVERY phase completes, output a summary BEFORE prompting the user:**

```
✅ Phase [N] Complete: [Phase Name]

Results:
- [Key result 1 - what was accomplished]
- [Key result 2 - what was produced]

Outputs:
- [output-file.md]

Status: Success
```

**DO NOT skip this summary.** Users need visibility into what each phase accomplished.

See `orchestrator-framework/references/phase-execution-pattern.md` STEP 7 for full template.

### Step 4: Only Then Proceed to Phase 1

After completing Steps 1, 2, and understanding Step 3, proceed to Phase 1 (Codebase Analysis).

---

## When to Use This Skill

Use for **all development tasks**:
- **Bug fixes**: Fix defects, errors, crashes
- **Enhancements**: Improve existing features
- **New features**: Add completely new functionality

**DO NOT use for**:
- Performance optimization (use `performance-orchestrator`)
- Security remediation (use `security-orchestrator`)
- Code migrations (use `migration-orchestrator`)
- Documentation only (use `documentation-orchestrator`)
- Pure refactoring (use `refactoring-orchestrator`)

## Core Principles

1. **Unified Workflow**: Same phases for all task types, different focus
2. **Task-Type Awareness**: Adapt behavior based on bug/enhancement/feature
3. **TDD for Bugs**: Mandatory Red→Green discipline for bug fixes
4. **Gap Analysis for All**: Compare current vs desired state systematically
5. **Clarifying Questions First**: Resolve ambiguities BEFORE detailed analysis

---

## Framework Patterns

This orchestrator follows shared patterns. See:

- **Phase Execution**: `../orchestrator-framework/references/phase-execution-pattern.md`
- **State Management**: `../orchestrator-framework/references/state-management.md`
- **Interactive Mode**: `../orchestrator-framework/references/interactive-mode.md`
- **Initialization**: `../orchestrator-framework/references/initialization-pattern.md`

---

## Task Type Detection

**Automatic Detection** from task description:

| Type | Keywords | Directory |
|------|----------|-----------|
| **Bug** | fix, bug, broken, error, crash, fails, not working | `.ai-sdlc/tasks/bug-fixes/` |
| **Enhancement** | improve, enhance, better, update, modify, extend | `.ai-sdlc/tasks/enhancements/` |
| **Feature** | add, new, create, build, implement, introduce | `.ai-sdlc/tasks/new-features/` |

**Override**: Use `--type=bug|enhancement|feature` flag

---

## Phase Configuration

| Phase | content | activeForm | Task Types |
|-------|---------|------------|------------|
| 0 | "Check dependencies" | "Checking dependencies" | All (if initiative) |
| 1 | "Analyze codebase" | "Analyzing codebase" | All |
| 1.5 | "Clarify requirements" | "Clarifying requirements" | All |
| 2 | "Analyze gaps" | "Analyzing gaps" | All |
| 3 | "Write failing test (TDD Red)" | "Writing failing test" | Bug only |
| 3.5 | "Clarify UI approach" | "Clarifying UI approach" | Enhancement, Feature (if ui_heavy) |
| 4 | "Generate UI mockups" | "Generating UI mockups" | Enhancement, Feature (if ui_heavy) |
| 4.5 | "Clarify technical approach" | "Clarifying technical approach" | All (if complex) |
| 5 | "Create specification" | "Creating specification" | All |
| 5.5 | "Decide architecture" | "Deciding architecture" | Feature, Enhancement (conditional) |
| 6 | "Audit specification" | "Auditing specification" | All |
| 7 | "Plan implementation" | "Planning implementation" | All |
| 8 | "Execute implementation" | "Executing implementation" | All |
| 9 | "Verify test passes (TDD Green)" | "Verifying test passes" | Bug only |
| 10 | "Prompt verification options" | "Prompting verification options" | All |
| 11 | "Verify implementation" | "Verifying implementation" | All |
| 12 | "Run E2E tests" | "Running E2E tests" | Optional |
| 13 | "Generate user documentation" | "Generating user documentation" | Optional |
| 14 | "Finalize workflow" | "Finalizing workflow" | All |

**Workflow Overview**: 17 phases (0-14 + 1.5, 3.5, 4.5, 5.5), with some conditional

**CRITICAL TodoWrite Usage**:
1. At workflow start: Create todos for ALL phases using the Phase Configuration table above (all status=pending)
2. Before each phase: Update that phase to status=in_progress
3. After each phase: Update that phase to status=completed

---

## Workflow Phases

### Phase 0: Dependency Check (If Part of Initiative)

**When**: Only if task has `initiative_id` in metadata.yml

**Process**: Check all dependencies are "completed". If blocked, update status and exit.

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 1.

---

### Phase 1: Codebase Analysis

**Skill**: `codebase-analyzer`

**Invocation**:
```
Use Skill tool:
  skill: "ai-sdlc:codebase-analyzer"
```

**Purpose**: Analyze codebase to understand context before making changes

**Focus by Task Type**:

| Task Type | Agent 1 Focus | Agent 2 Focus | Agent 3 Focus |
|-----------|---------------|---------------|---------------|
| **Bug** | Find buggy code path | Trace execution flow | Find tests, reproduction hints |
| **Enhancement** | Find feature files | Analyze current behavior | Find tests, API consumers |
| **Feature** | Find similar patterns | Analyze architecture | Find integration points |

**Outputs**: `analysis/codebase-analysis.md`

**State Update**: After codebase-analyzer completes:
- Read structured output `risk_level` from analysis results
- Update `task_context.risk_level` in orchestrator-state.yml

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 1.5.

---

### Phase 1.5: Clarifying Questions (Before Gap Analysis)

**Execution**: Main orchestrator (direct with AskUserQuestion)

**Purpose**: Resolve scope and requirements ambiguities BEFORE detailed gap analysis

**Why Before Gap Analysis**: Scope decisions should be made before detailed analysis (saves effort)

**Question Categories**:

| Category | When to Ask |
|----------|-------------|
| **Scope** | Task mentions something that may or may not be included |
| **Integration** | Codebase shows related systems |
| **Patterns** | Multiple patterns exist in codebase |
| **Edge Cases** | Edge cases not specified |
| **Compatibility** | Existing API/behavior affected |

**Process**:
1. Analyze codebase-analysis.md for question triggers
2. Generate max 5 critical, 5 important questions
3. Present critical questions via AskUserQuestion
4. Handle important questions (offer defaults)
5. Document answers in `analysis/clarifications.md`

**YOLO Mode**: Accept all recommended defaults, log acceptance

**State Update**: After clarifications complete:
- Set `task_context.clarifications_resolved: true` in orchestrator-state.yml

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 2.

---

### Phase 2: Gap Analysis

**Agent**: `gap-analyzer` (subagent)

**Purpose**: Compare current state vs desired state

**Task tool invocation**:
```
subagent_type: "ai-sdlc:gap-analyzer"
description: "Analyze gaps"
prompt: |
  Analyze gaps for [task_type]: [description].
  Task path: [task-path]
  Analysis: analysis/codebase-analysis.md
  Clarifications: analysis/clarifications.md
  Task type: [task_type]
```

**Gap Analysis by Task Type**:

| Task Type | Current State | Desired State | Key Output |
|-----------|---------------|---------------|------------|
| **Bug** | Buggy behavior | Correct behavior | Reproduction data, regression risks |
| **Enhancement** | Existing feature | Improved feature | Data lifecycle, user journey impact |
| **Feature** | No feature | Integrated feature | Integration points, patterns to follow |

**Outputs**: `analysis/gap-analysis.md`

**State Update**: After gap-analyzer completes, read structured output:
- Update `task_context.ui_heavy` from output `ui_heavy` field
- Update `task_context.risk_level` from output `risk_level` (if currently null)
- For bugs: Update `task_context.reproduction_data` from output `reproduction_data`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 3.

---

### Phase 3: TDD Red Gate (Bug Only)

**When**: task_type = "bug" AND TDD applicable

**Purpose**: Write a failing test that reproduces the bug

**Process**:
1. Using reproduction data from Phase 2, write test with exact inputs/state
2. Assert expected correct behavior
3. Run test - **Verify test FAILS** (proves bug exists)
4. If test passes: Bug doesn't exist or test doesn't reproduce it

**Critical Gate**: Cannot proceed if test passes before implementation

**TDD Exception Path**: Document in `implementation/tdd-exception.md` with alternative validation

**Outputs**: `implementation/tdd-red-gate.md`, failing test file

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 3.5.

---

### Phase 3.5: Clarify UI Approach (Conditional)

**Execution**: Main orchestrator (direct with AskUserQuestion)

**When**: task_type = enhancement/feature AND ui_heavy = true (from gap analysis)

**Skip if**: Bug fix, not UI-heavy, or UI approach already clear

**Purpose**: Resolve UI-specific decisions BEFORE generating mockups

**Question Categories**:

| Category | Example Questions |
|----------|-------------------|
| **Component Choice** | "Use existing DatePicker or build custom?" |
| **Layout** | "Modal dialog or inline expansion?" |
| **Styling** | "Match existing theme or new design?" |
| **Interaction** | "Immediate save or explicit submit?" |

**Process**:
1. Analyze gap-analysis.md for UI-related gaps
2. Generate max 3-5 UI-specific questions
3. Present via AskUserQuestion
4. Document answers in `analysis/ui-clarifications.md`

**YOLO Mode**: Accept all recommended defaults, log acceptance

**State Update**: After UI clarifications complete:
- Set `task_context.ui_clarified: true` in orchestrator-state.yml

**Outputs**: `analysis/ui-clarifications.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 4.

---

### Phase 4: UI Mockup Generation (Conditional)

**Agent**: `ui-mockup-generator` (subagent)

**When**: Enhancement or feature with `ui_heavy = true`

**Outputs**: `analysis/ui-mockups.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 4.5.

---

### Phase 4.5: Clarify Technical Approach (Conditional)

**Execution**: Main orchestrator (direct with AskUserQuestion)

**When**: Complex task OR multiple valid approaches detected in gap analysis

**Skip if**: Simple/straightforward task, or technical approach already clear from requirements

**Trigger Detection**:
- Gap analysis mentions multiple approaches
- Risk level = medium or high
- New technology/library decision needed
- Core architecture affected (data model, API, state management)

**Purpose**: Resolve technical decisions BEFORE creating specification

**Question Categories**:

| Category | Example Questions |
|----------|-------------------|
| **Data Model** | "New entity or extend existing?" |
| **API Design** | "REST endpoint or extend existing?" |
| **State Management** | "Local state or global store?" |
| **Compatibility** | "Break backward compat or maintain?" |

**Process**:
1. Analyze gap-analysis.md for technical decision points
2. Generate max 3-5 technical questions
3. Present via AskUserQuestion
4. Document answers in `analysis/technical-clarifications.md`

**YOLO Mode**: Accept all recommended defaults, log acceptance

**State Update**: After technical clarifications complete:
- Set `task_context.tech_clarified: true` in orchestrator-state.yml

**Outputs**: `analysis/technical-clarifications.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 5.

---

### Phase 5: Specification

**Skill**: `specification-creator`

**Invocation**:
```
Use Skill tool:
  skill: "ai-sdlc:specification-creator"
```

**Standards Reminder**: Review `.ai-sdlc/docs/INDEX.md` before creating spec

**Task-Type-Specific Sections**:
- **Bug**: Root cause, fix approach, regression prevention
- **Enhancement**: Compatibility requirements, backward compat
- **Feature**: Architecture decisions, integration approach

**Outputs**: `implementation/spec.md`, `implementation/requirements.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 5.5.

---

### Phase 5.5: Architecture Decision (Conditional)

**When**: Feature or enhancement with architectural choices (multiple valid approaches)

**Skip if**: Bug fix, straightforward task, or spec already contains clear approach

**Trigger Detection**:
- Spec mentions "could use X or Y"
- Multiple patterns exist for similar features
- New technology/library decision
- Core architecture affected (auth, data layer, state)

**Process**:
1. Identify 2-3 distinct approaches from spec + codebase
2. Evaluate each: alignment, complexity, risk, maintainability
3. Present approaches to user with recommendation
4. Get user selection via AskUserQuestion
5. Document decision in `implementation/spec.md` Technical Approach section

**YOLO Mode**: Auto-select recommended approach

**State Update**: After user selects approach (or YOLO auto-selects):
- Set `task_context.architecture_decision` to selected approach name in orchestrator-state.yml

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 6.

---

### Phase 6: Specification Audit

**Agent**: `spec-auditor` (subagent)

**Purpose**: Verify specification completeness

**Outputs**: `verification/spec-audit.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 7.

---

### Phase 7: Implementation Planning

**Skill**: `implementation-planner`

**Invocation**:
```
Use Skill tool:
  skill: "ai-sdlc:implementation-planner"
```

**Standards Reminder**: Review `.ai-sdlc/docs/INDEX.md` for project conventions

**Task-Type-Specific Considerations**:
- **Bug**: Regression test preservation
- **Enhancement**: Targeted regression testing (30-70%)
- **Feature**: Integration order

**Outputs**: `implementation/implementation-plan.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 8.

---

### Phase 8: Implementation

**Skill**: `implementer`

**Invocation**:
```
Use Skill tool:
  skill: "ai-sdlc:implementer"
```

**Standards Reminder**: Continuous standards discovery from docs/INDEX.md

**Outputs**: Implemented code, updated implementation-plan.md, `implementation/work-log.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 9.

---

### Phase 9: TDD Green Gate (Bug Only)

**When**: task_type = "bug" AND Phase 3 was executed

**Purpose**: Verify the failing test now passes

**Critical Gate**: Test must pass. If still fails, implementation didn't fix bug.

**Outputs**: `implementation/tdd-green-gate.md`

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 10.

---

### Phase 10: Verification Options Prompt

**Purpose**: Determine which optional verification checks to run

**Process**:
1. Analyze implementation for signals (files changed, coverage, complexity, risk)
2. Determine recommendations based on task type
3. Prompt user (Interactive) or auto-decide (YOLO)
4. Update orchestrator-state.yml with options

**Verification Options**:
- Code Review (strongly recommended for all)
- Production Readiness (recommended if deploying)
- Reality Assessment (always enabled)
- Pragmatic Review (always enabled)

**State Update**: After user selection (Interactive) or auto-decision (YOLO):
- Set `options.code_review_enabled` based on user choice or auto-decision
- Set `options.code_review_scope` if code review enabled ("full", "changed-files", etc.)
- Set `options.production_check_enabled` based on user choice or auto-decision
- Set `options.pragmatic_review_enabled: true` (always enabled)
- Set `options.reality_check_enabled: true` (always enabled)
- Set `options.e2e_enabled` based on user choice, `--e2e` flag, or YOLO auto-decision (UI-related tasks)
- Set `options.user_docs_enabled` based on user choice, `--user-docs` flag, or YOLO auto-decision (features/enhancements)

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 11.

---

### Phase 11: Verification

**Skill**: `implementation-verifier`

**Invocation**:
```
Use Skill tool:
  skill: "ai-sdlc:implementation-verifier"
```

**Reads orchestrator-state.yml** to determine which checks to run

**Expected Artifacts**:

| Artifact | Condition |
|----------|-----------|
| `verification/implementation-verification.md` | Always |
| `verification/code-review-report.md` | If code_review_enabled |
| `verification/pragmatic-review.md` | If pragmatic_review_enabled |
| `verification/production-readiness-report.md` | If production_check_enabled |
| `verification/reality-check.md` | If reality_check_enabled |

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 12.

---

### Phase 12: E2E Testing (Optional)

**Agent**: `e2e-test-verifier`

**When**: Interactive prompts, YOLO auto-runs if UI-related, or `--e2e` flag

**Outputs**: `verification/e2e-verification-report.md`, screenshots

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 13.

---

### Phase 13: User Documentation (Optional)

**Agent**: `user-docs-generator`

**When**: Feature or enhancement (not bugs), user request or `--user-docs` flag

**Outputs**: `documentation/user-guide.md`, screenshots

**⏸️ INTERACTIVE MODE: STOP HERE** - After this phase completes, use `AskUserQuestion` before proceeding to Phase 14.

---

### Phase 14: Finalization

**Process**:
1. Create workflow summary
2. Update metadata.yml status to "completed"
3. Provide commit message template
4. Guide next steps

---

## Domain Context (State Extensions)

Development-specific fields in `orchestrator-state.yml`:

```yaml
orchestrator:
  task_type: bug | enhancement | feature
  options:
    e2e_enabled: null
    user_docs_enabled: null
    code_review_enabled: null
    code_review_scope: null
    production_check_enabled: null
    pragmatic_review_enabled: null
    reality_check_enabled: null
  task_context:
    type: bug | enhancement | feature
    risk_level: null
    ui_heavy: null
    clarifications_resolved: null
    architecture_decision: null        # Feature/Enhancement only
    tdd_applicable: true               # Bug only
    reproduction_data: null            # Bug only
```

---

## Task Structure

```
.ai-sdlc/tasks/[type-directory]/YYYY-MM-DD-task-name/
├── metadata.yml
├── orchestrator-state.yml
├── analysis/
│   ├── codebase-analysis.md          # Phase 1
│   ├── clarifications.md             # Phase 1.5
│   ├── gap-analysis.md               # Phase 2
│   └── ui-mockups.md                 # Phase 4 (optional)
├── implementation/
│   ├── spec.md                       # Phase 5
│   ├── requirements.md               # Phase 5
│   ├── implementation-plan.md        # Phase 7
│   ├── work-log.md                   # Phase 8
│   ├── tdd-red-gate.md               # Phase 3 (bug only)
│   ├── tdd-green-gate.md             # Phase 9 (bug only)
│   └── tdd-exception.md              # If TDD skipped (bug only)
├── verification/
│   ├── spec-audit.md                 # Phase 6
│   ├── implementation-verification.md # Phase 11
│   ├── reality-check.md              # Phase 11
│   ├── pragmatic-review.md           # Phase 11
│   ├── code-review-report.md         # Phase 11 (optional)
│   ├── production-readiness-report.md # Phase 11 (optional)
│   └── e2e-verification-report.md    # Phase 12 (optional)
└── documentation/
    ├── user-guide.md                 # Phase 13 (optional)
    └── screenshots/
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 1 | 2 | Expand search, prompt user |
| 1.5 | 1 | Accept defaults if unclear |
| 2 | 2 | Re-analyze, ask user |
| 3 | 2 | Rewrite test, skip TDD with doc |
| 4 | 1 | Continue without mockups |
| 5 | 2 | Regenerate spec |
| 5.5 | 1 | Auto-select recommendation |
| 6 | 1 | Highlight issues |
| 7 | 2 | Regenerate plan |
| 8 | 5 | Fix syntax, imports, tests |
| 9 | 3 | Return to implementation |
| 11 | 3 | Fix tests, re-run |
| 12 | 2 | Prompt app start, fix UI |
| 13 | 1 | Text-only fallback |

---

## Command Flags

| Flag | Effect |
|------|--------|
| `--type=bug\|enhancement\|feature` | Override task type detection |
| `--yolo` | Continuous execution (TDD gates still enforced) |
| `--from=PHASE` | Start from specific phase |
| `--e2e` / `--no-e2e` | Force/skip E2E testing |
| `--user-docs` / `--no-user-docs` | Force/skip user documentation |
| `--code-review` / `--no-code-review` | Force/skip code review |

---

## Command Integration

Invoked via:
- `/ai-sdlc:development:new [description] [--type=TYPE] [--yolo]`
- `/ai-sdlc:development:resume [task-path] [--from=PHASE]`

**Legacy Aliases** (route to this orchestrator):
- `/ai-sdlc:bug-fix:new` → `--type=bug`
- `/ai-sdlc:enhancement:new` → `--type=enhancement`
- `/ai-sdlc:feature:new` → `--type=feature`

---

## TDD Gate Rules (Bug Fixes)

**Phase 3 (Red Gate)**:
- Test MUST FAIL before implementation
- If passes: Bug doesn't exist or test wrong
- Exception path available with documentation

**Phase 9 (Green Gate)**:
- Test MUST PASS after implementation
- If fails: Implementation didn't fix bug
- Cannot skip - TDD discipline enforced

**YOLO Mode**: TDD gates still enforced (cannot be bypassed)

---

## Success Criteria

Workflow successful when:

- Codebase analyzed and clarifications resolved
- Gap analysis complete for task type
- TDD gates pass (bug only)
- Specification created and audited
- Architecture decision documented (feature/enhancement if applicable)
- Implementation plan complete
- Implementation passes tests
- Verification complete with chosen checks
- Optional phases complete (if enabled)
- Ready for commit and code review
