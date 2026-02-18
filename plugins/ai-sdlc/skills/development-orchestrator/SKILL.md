---
name: development-orchestrator
description: Unified orchestrator for all development tasks (bug fixes, enhancements, new features). Adapts workflow phases based on task type while maintaining consistent quality gates. Supports interactive mode (pause between phases) and YOLO mode (continuous execution). Use for any development work that modifies code.
---

# Development Orchestrator

Unified workflow for bug fixes, enhancements, and new features with task-type-specific adaptations.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 1: Load Framework Patterns

**Read ALL framework reference files NOW using the Read tool:**

1. `../orchestrator-framework/references/phase-execution-pattern.md` - Phase execution and transitions
2. `../orchestrator-framework/references/interactive-mode.md` - Mode-aware pause behavior
3. `../orchestrator-framework/references/delegation-enforcement.md` - Delegation patterns
4. `../orchestrator-framework/references/state-management.md` - State file and context
5. `../orchestrator-framework/references/initialization-pattern.md` - Directory structure
6. `../orchestrator-framework/references/issue-resolution-pattern.md` - Fix-then-reverify cycles

### Step 2: Detect Research Context

**If argument is a research folder path** (matches `.maister/tasks/research/*`):
- Auto-detect research folder, extract task description from `research_context.research_question`
- Read research artifacts (see Research-Based Development section below)
- Set `research_reference` in state automatically

**If `--research=<path>` flag provided**:
- Read research artifacts from specified path
- Copy to `analysis/research-context/`
- Set `research_reference` in state

### Step 3: Initialize Workflow

1. **Create Task Items**: Use `TaskCreate` for all phases (see Phase Configuration), then set dependencies with `TaskUpdate addBlockedBy`
2. **Create Task Directory**: `.maister/tasks/[type]/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with mode, task info, and research reference

**Output**:
```
🚀 Development Orchestrator Started

Task: [description]
Type: [Bug Fix / Enhancement / Feature]
Mode: [Interactive/YOLO]
Directory: [task-path]

Starting Phase 1: Codebase Analysis...
```

---

## When to Use

Use for **all development tasks**:
- **Bug fixes**: Fix defects, errors, crashes
- **Enhancements**: Improve existing features
- **New features**: Add completely new functionality

**DO NOT use for**: Performance optimization, security remediation, migrations, documentation-only, pure refactoring (use specialized orchestrators).

---

## Task Type Detection

| Type | Keywords | Directory |
|------|----------|-----------|
| **Bug** | fix, bug, broken, error, crash | `.maister/tasks/bug-fixes/` |
| **Enhancement** | improve, enhance, better, update | `.maister/tasks/enhancements/` |
| **Feature** | add, new, create, build, implement | `.maister/tasks/new-features/` |

**Override**: Use `--type=bug|enhancement|feature` flag

---

## Phase Configuration

| Phase | content | activeForm | Task Types |
|-------|---------|------------|------------|
| 1 | "Analyze codebase & clarify requirements" | "Analyzing codebase & clarifying" | All |
| 2 | "Analyze gaps & clarify scope" | "Analyzing gaps & clarifying scope" | All |
| 3 | "Write failing test (TDD Red)" | "Writing failing test" | Bug only |
| 4 | "Generate UI mockups" | "Generating UI mockups" | Enhancement, Feature (if ui_heavy) |
| 5 | "Gather requirements & create specification" | "Gathering requirements & creating specification" | All |
| 6 | "Audit specification" | "Auditing specification" | All (conditional) |
| 7 | "Plan implementation" | "Planning implementation" | All |
| 8 | "Execute implementation" | "Executing implementation" | All |
| 9 | "Verify test passes (TDD Green)" | "Verifying test passes" | Bug only |
| 10 | "Prompt verification options" | "Prompting verification options" | All |
| 11 | "Verify implementation & resolve issues" | "Verifying implementation" | All |
| 12 | "Run E2E tests" | "Running E2E tests" | Optional |
| 13 | "Generate user documentation" | "Generating user documentation" | Optional |
| 14 | "Finalize workflow" | "Finalizing workflow" | All |

---

## Workflow Phases

### Phase 1: Codebase Analysis & Clarifications

**Purpose**: Comprehensive codebase exploration followed by scope/requirements clarification
**Execute**:
1. Skill tool - `maister:codebase-analyzer`
2. Update state with analysis results
3. Direct - use AskUserQuestion for max 5 critical clarifying questions
4. Save clarifications to `analysis/clarifications.md`
**Output**: `analysis/codebase-analysis.md`, `analysis/clarifications.md`
**State**: Update `task_context.risk_level`, `phase_summaries.codebase_analysis`, `task_context.clarifications_resolved`

**YOLO Mode**: Accept all recommended defaults for clarifications

→ **AUTO-CONTINUE** — Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 2.

---

### Phase 2: Gap Analysis & Scope Clarification

**Purpose**: Compare current vs desired state, then resolve scope/approach decisions
**Execute**:
1. Task tool - `maister:gap-analyzer` subagent
2. Update state with gap analysis results

**⛔ DECISION GATE** (mandatory — do NOT skip):
- Parse `decisions_needed` from gap-analyzer output
- If `decisions_needed.critical` OR `decisions_needed.important` is non-empty:
  - **Interactive**: MUST use `AskUserQuestion` — one question per critical decision, batch important decisions into a single multi-select question
  - **YOLO**: Accept recommended defaults, but LOG each decision (id, issue, chosen option, rationale) to `analysis/scope-clarifications.md`
- If both are empty: Note "No scope decisions needed" in state

**SELF-CHECK** before continuing: "Did the gap-analyzer return `decisions_needed` items? If yes, did I invoke `AskUserQuestion` (interactive) or log decisions (YOLO)? If I skipped this, STOP and go back."

3. Save scope clarifications to `analysis/scope-clarifications.md`

**Output**: `analysis/gap-analysis.md`, `analysis/scope-clarifications.md` (conditional)
**State**: Update `task_context.ui_heavy`, `task_context.scope_expanded`, `options.e2e_enabled`

**Context to pass**: Risk level, codebase summary, key files, clarifications

→ Pause (when decisions exist), otherwise Conditional

**Interactive** (decisions exist): AskUserQuestion - "Scope decisions resolved. Continue to Phase 3/4?"
**Interactive** (no decisions): AskUserQuestion - "Gap analysis complete, no decisions needed. Continue to Phase 3/4?"
**YOLO**: "→ Continuing..."

→ Conditional: if task_type=bug then continue to Phase 3, else skip to Phase 4

---

### Phase 3: TDD Red Gate (Bug Only)

**Purpose**: Write a failing test that reproduces the bug
**Execute**: Direct - write test, verify it FAILS
**Output**: `implementation/tdd-red-gate.md`, failing test file
**State**: Update `tdd_red_passed: true`

**Skip if**: task_type != "bug"

**Critical**: Test MUST fail before implementation (proves bug exists)

→ Pause

**Interactive**: AskUserQuestion - "TDD red gate complete. Continue to Phase 4?"
**YOLO**: "→ Continuing to Phase 4..."

---

### Phase 4: UI Mockup Generation (Conditional)

**Purpose**: Generate ASCII mockups showing UI integration
**Execute**: Task tool - `maister:ui-mockup-generator` subagent
**Output**: `analysis/ui-mockups.md`
**State**: Update `phase_summaries.ui_mockups`

**Skip if**: Bug fix OR `ui_heavy = false`

**Context to pass**: Gap analysis, scope decisions, component choices

→ Pause

**Interactive**: AskUserQuestion - "UI mockups complete. Continue to Phase 5?"
**YOLO**: "→ Continuing to Phase 5..."

---

### Phase 5: Technical Approach, Requirements & Specification

**Purpose**: Resolve technical decisions, gather specification requirements, then create comprehensive specification
**Execute**:

**Part A — Technical & Architecture Clarification (inline, conditional)**:
1. If complex task with multiple approaches: Direct - use AskUserQuestion for 3-5 technical questions
2. If multiple valid architectural approaches exist (feature/enhancement): Present 2-3 approaches via AskUserQuestion. The chosen approach is passed to specification-creator so the spec is written with the decided architecture.
3. Save to `analysis/technical-clarifications.md` (conditional)

**Skip technical clarification if**: Simple task, risk_level = low, no multiple approaches detected

**Part B — Requirements Gathering (inline)**:
3. Direct - use AskUserQuestion for specification requirements:
   - Adaptive question count based on description length:
     - Brief (<30 words): 6-8 questions
     - Standard (30-100 words): 4-6 questions
     - Detailed (>100 words): 2-3 focused questions
   - Frame as confirmable assumptions: "I assume X, is that correct?"
   - REQUIRED questions (always include):
     1. **User Journey**: How will users discover/access this? Which personas? How fits existing workflows?
     2. **Existing Code Reuse**: Similar features, UI components, backend patterns to reference?
     3. **Visual Assets**: Any mockups, wireframes, screenshots? Place in `analysis/visuals/`
4. Check for visual assets in `analysis/visuals/` (even if user says none)
   - If found: note for subagent context
   - If not found and non-UI task: skip visual asset processing
5. Save gathered requirements to `analysis/requirements.md` with: initial description, Q&A from all rounds, similar features identified, visual assets and insights, functional requirements summary, reusability opportunities, scope boundaries, technical considerations

**Part C — Specification Creation (subagent)**:

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the specification..." — STOP. Delegate to specification-creator.
- ❌ "I'll write the spec based on requirements..." — STOP. Delegate to specification-creator.
- ❌ "The task is simple enough to spec inline..." — STOP. Simplicity is NOT a reason to skip delegation.

**INVOKE NOW** — Task tool call:

6. Task tool - `maister:specification-creator` subagent

**Context to pass to subagent**: task_path, task_type, task_description, requirements_path (analysis/requirements.md), project_context_paths (INDEX.md, vision.md, roadmap.md, tech-stack.md), risk_level, ui_heavy, scope_expanded, phase_summaries (codebase_analysis, gap_analysis, clarifications, scope_clarifications, ui_mockups), research_context (if any)

**SELF-CHECK**: Did you just invoke the Task tool with `maister:specification-creator`? Or did you start writing spec.md yourself? If the latter, STOP immediately and invoke the Task tool instead.

**Output**: `analysis/technical-clarifications.md` (conditional), `analysis/requirements.md`, `implementation/spec.md`
**State**: Update `task_context.tech_clarified`, `task_context.architecture_decision`, `phase_summaries.specification`

**YOLO Mode**: Accept recommended defaults for all questions (including architecture), then invoke subagent

→ Pause

**Interactive**: AskUserQuestion - "Specification created. Continue to Phase 6?"
**YOLO**: "→ Continuing to Phase 6..."

---

### Phase 6: Specification Audit (Recommended)

**Purpose**: Independent review of specification before implementation
**Execute**: Task tool - `maister:spec-auditor` subagent
**Output**: `verification/spec-audit.md`
**State**: Update `options.spec_audit_enabled`

**Recommended**: Always. Present spec audit as the recommended default. User can skip if they choose.

**Interactive**: AskUserQuestion - "Run specification audit? (Recommended)" with "Yes, run audit (Recommended)" as first option
**YOLO**: Always run

→ Pause

**Interactive**: AskUserQuestion - "Audit complete. Continue to Phase 7?"
**YOLO**: "→ Continuing to Phase 7..."

---

### Phase 7: Implementation Planning

**Purpose**: Break specification into implementation steps

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the implementation plan..." — STOP. Delegate to implementation-planner.
- ❌ "I'll break this into steps..." — STOP. Delegate to implementation-planner.
- ❌ "This is simple enough to plan inline..." — STOP. Simplicity is NOT a reason to skip delegation.

**INVOKE NOW** — Task tool call:

**Execute**: Task tool - `maister:implementation-planner` subagent
**Output**: `implementation/implementation-plan.md`
**State**: Update task groups and dependencies

**Context to pass to subagent**: task_path, task_type, task_description, phase_summaries (specification, gap_analysis, codebase_analysis), research_context (if any)

**SELF-CHECK**: Did you just invoke the Task tool with `maister:implementation-planner`? Or did you start writing implementation-plan.md yourself? If the latter, STOP immediately and invoke the Task tool instead.

→ Pause

**Interactive**: AskUserQuestion - "Plan created. Continue to Phase 8?"
**YOLO**: "→ Continuing to Phase 8..."

---

### Phase 8: Implementation

**Purpose**: Execute the implementation plan
**Execute**: Skill tool - `maister:implementation-plan-executor`
**Output**: Implemented code, `implementation/work-log.md`
**State**: Update implementation progress

→ Conditional: if task_type=bug then continue to Phase 9, else skip to Phase 10

---

### Phase 9: TDD Green Gate (Bug Only)

**Purpose**: Verify the failing test now passes
**Execute**: Direct - run the test written in Phase 3
**Output**: `implementation/tdd-green-gate.md`
**State**: Update `tdd_green_passed: true`

**Skip if**: task_type != "bug" OR Phase 3 was skipped

**Critical**: Test MUST pass (proves bug is fixed)

→ Pause

**Interactive**: AskUserQuestion - "TDD gate passed. Continue to Phase 10?"
**YOLO**: "→ Continuing to Phase 10..."

---

### Phase 10: Verification Options Prompt

**Purpose**: Determine which verification checks to run
**Execute**: Direct - analyze implementation, use AskUserQuestion for options
**Output**: Updated state with verification options
**State**: Set `options.code_review_enabled`, `options.e2e_enabled`, `options.user_docs_enabled`

**Always enabled**: Reality check, pragmatic review
**Auto-set**: `skip_test_suite: true` (full test suite already passed during implementation phase; cleared before re-verification if fixes are applied)

→ Pause

**Interactive**: AskUserQuestion - "Options selected. Continue to Phase 11?"
**YOLO**: "→ Continuing to Phase 11..."

---

### Phase 11: Verification & Issue Resolution

**Purpose**: Comprehensive implementation verification with fix-then-reverify cycles
**Execute**:
1. Skill tool - `maister:implementation-verifier`
2. If issues found: Fix trivial issues directly, AskUserQuestion for non-trivial
3. Before re-verification: set `skip_test_suite: false` (code changed, tests must re-run)
4. Re-verify after fixes (max 3 fix-then-reverify cycles)
**Output**: `verification/implementation-verification.md`, optional code-review/pragmatic/reality reports, updated `implementation/work-log.md`
**State**: Update verification results, `verification_context`

→ Pause

**Interactive**: AskUserQuestion - "Verification complete. Continue to Phase 12?"
**YOLO**: "→ Continuing to Phase 12..."

---

### Phase 12: E2E Testing (Optional)

**Purpose**: End-to-end browser testing with screenshots
**Execute**: Task tool - `maister:e2e-test-verifier` subagent
**Output**: `verification/e2e-verification-report.md`, screenshots
**State**: Update E2E results

**Skip if**: `options.e2e_enabled = false` OR bug fix

→ Pause

**Interactive**: AskUserQuestion - "E2E complete. Continue to Phase 13?"
**YOLO**: "→ Continuing to Phase 13..."

---

### Phase 13: User Documentation (Optional)

**Purpose**: Generate user-facing documentation with screenshots
**Execute**: Task tool - `maister:user-docs-generator` subagent
**Output**: `documentation/user-guide.md`, screenshots
**State**: Update docs generation status

**Skip if**: `options.user_docs_enabled = false` OR bug fix

→ Pause

**Interactive**: AskUserQuestion - "Documentation complete. Continue to Phase 14?"
**YOLO**: "→ Continuing to Phase 14..."

---

### Phase 14: Finalization

**Purpose**: Complete workflow and provide next steps
**Execute**: Direct - create summary, update state, guide commit
**Output**: Workflow summary
**State**: Set `task.status: completed`

**Process**:
1. Create workflow summary
2. Update task status to "completed"
3. Provide commit message template
4. Guide next steps (code review, PR, deployment)

→ End of workflow

---

## Domain Context (State Extensions)

Development-specific fields in `orchestrator-state.yml`:

```yaml
orchestrator:
  task_type: bug | enhancement | feature
  options:
    spec_audit_enabled: true
    skip_test_suite: true
    e2e_enabled: null
    user_docs_enabled: null
    code_review_enabled: true
    pragmatic_review_enabled: true
    reality_check_enabled: true
  task_context:
    type: bug | enhancement | feature
    risk_level: null
    ui_heavy: null
    clarifications_resolved: null
    scope_expanded: null
    architecture_decision: null
    tdd_applicable: true  # Bug only
    reproduction_data: null  # Bug only
    research_reference:
      path: null
      research_question: null
      research_type: null
      confidence_level: null
    phase_summaries:
      research: {summary: null, key_findings: [], recommended_approach: null}
      codebase_analysis: {key_files: [], primary_language: null, summary: null}
      clarifications: []
      gap_analysis: {integration_points: [], summary: null}
      scope_clarifications: {scope_expanded: null, summary: null}
      ui_mockups: {components_designed: [], summary: null}
      specification: {summary: null}
      architecture_decision: {decision: null, summary: null}
```

---

## Task Structure

```
.maister/tasks/[type]/YYYY-MM-DD-task-name/
├── orchestrator-state.yml
├── analysis/
│   ├── research-context/          # If --research provided
│   ├── codebase-analysis.md       # Phase 1
│   ├── clarifications.md          # Phase 1
│   ├── gap-analysis.md            # Phase 2
│   ├── scope-clarifications.md    # Phase 2 (conditional)
│   ├── technical-clarifications.md # Phase 5 (conditional)
│   └── ui-mockups.md              # Phase 4 (optional)
├── implementation/
│   ├── spec.md                    # Phase 5
│   ├── requirements.md            # Phase 5
│   ├── implementation-plan.md     # Phase 7
│   ├── work-log.md                # Phase 8
│   ├── tdd-red-gate.md            # Phase 3 (bug only)
│   └── tdd-green-gate.md          # Phase 9 (bug only)
├── verification/
│   ├── spec-audit.md              # Phase 6 (recommended)
│   ├── implementation-verification.md  # Phase 11
│   └── e2e-verification-report.md      # Phase 12 (optional)
└── documentation/
    └── user-guide.md              # Phase 13 (optional)
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 1 | 2 | Expand search, prompt user |
| 2 | 2 | Re-analyze, ask user |
| 3 | 2 | Rewrite test, skip TDD with doc |
| 5 | 2 | Regenerate spec |
| 7 | 2 | Regenerate plan |
| 8 | 5 | Fix syntax, imports, tests |
| 9 | 3 | Return to implementation |
| 11 | 3 | Fix tests, re-run |

---

## Command Flags

| Flag | Effect |
|------|--------|
| `--type=bug\|enhancement\|feature` | Override task type detection |
| `--yolo` | Continuous execution (TDD gates still enforced) |
| `--from=PHASE` | Start from specific phase |
| `--research=PATH` | Link to completed research task |
| `--audit` / `--no-audit` | Force/skip specification audit |
| `--e2e` / `--no-e2e` | Force/skip E2E testing |
| `--user-docs` / `--no-user-docs` | Force/skip user documentation |

---

## Research-Based Development

When starting development from a completed research task, the orchestrator loads research context to **INFORM** all phases.

### Invocation Methods

**Method 1: Research folder as sole argument** (recommended)
```
/maister:development-new .maister/tasks/research/2026-01-12-oauth-research
```
The orchestrator auto-detects this is a research folder and:
- Extracts task description from `research_context.research_question`
- Reads all research artifacts
- Sets `research_reference` in state

**Method 2: Explicit --research flag**
```
/maister:development-new "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
```

### Research Artifacts (Standard List)

When research context is detected, read these files from the research folder:

| Artifact | Path | Purpose |
|----------|------|---------|
| State | `orchestrator-state.yml` | research_type, confidence_level |
| Report | `outputs/research-report.md` | Main findings and conclusions |
| Solution Exploration | `outputs/solution-exploration.md` | Alternatives and trade-offs (input to Phase 5) |
| High-Level Design | `outputs/high-level-design.md` | C4 architecture (input to Phase 5) |
| Decision Log | `outputs/decision-log.md` | ADR decisions (input to Phase 5) |

### How Research Informs Each Phase

**Research INFORMS phases, never SKIPS them.** Research context passes to ALL phases via `task_context.phase_summaries.research`. No phases are skipped.

| Phase | How Research Context is Used |
|-------|------------------------------|
| Phase 1 | Codebase analyzer receives research findings as search guidance |
| Phase 2 | Gap analyzer uses research recommendations for comparison |
| Phase 5 | Specification creator uses high-level-design.md as INPUT (still creates full spec). Architecture decisions use research report AND decision-log.md (lighter when ADRs comprehensive) |
| Phase 7 | Implementation planner references research approach for task grouping |

---

## Command Integration

Invoked via:
- `/maister:development-new [description] [--type=TYPE] [--yolo]`
- `/maister:development-resume [task-path] [--from=PHASE]`

---

## TDD Gate Rules (Bug Fixes)

**Phase 3 (Red Gate)**: Test MUST FAIL before implementation
**Phase 9 (Green Gate)**: Test MUST PASS after implementation
**YOLO Mode**: TDD gates still enforced (cannot be bypassed)
