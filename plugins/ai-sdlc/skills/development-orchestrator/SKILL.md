---
name: development-orchestrator
description: Unified orchestrator for all development tasks (bug fixes, enhancements, new features). Adapts workflow phases based on task type while maintaining consistent quality gates. Supports interactive mode (pause between phases) and YOLO mode (continuous execution). Use for any development work that modifies code.
---

# Development Orchestrator

Unified workflow for bug fixes, enhancements, and new features with task-type-specific adaptations.

## MANDATORY Initialization (Before Any Phase Work)

**CRITICAL: You MUST complete these steps BEFORE executing any workflow phase:**

### Step 0: Load Framework Patterns

**STOP. You MUST read these files NOW using the Read tool before continuing:**

1. `../orchestrator-framework/references/phase-execution-pattern.md` - 7-step phase loop
2. `../orchestrator-framework/references/delegation-enforcement.md` - Delegation patterns and subagent result handling
3. `../orchestrator-framework/references/interactive-mode.md` - Phase gates and AUTO-CONTINUE
4. `../orchestrator-framework/references/state-management.md` - State file operations
5. `../orchestrator-framework/references/issue-resolution-pattern.md` - Fix-then-reverify loop for Phase 11.5

**⚠️ FAILURE TO READ THESE FILES IS A WORKFLOW VIOLATION.**

These patterns define:
- How to execute each phase (7-step loop)
- How to delegate to skills (mandatory patterns)
- When to auto-continue vs pause (Phase Gates and ⚡ AUTO)
- How to consume subagent results and continue workflow
- How to manage orchestrator-state.yml
- How to resolve issues after verification (fix/ask/reverify)

**SELF-CHECK:**
- [ ] Did you use the Read tool to read all 5 files?
- [ ] Do you understand the AUTO-CONTINUE pattern in interactive-mode.md?
- [ ] Do you understand Pattern 6 (Consuming Subagent Results) in delegation-enforcement.md?
- [ ] Do you understand the fix-then-reverify loop in issue-resolution-pattern.md?

If NO to any: STOP and read the files now.

### Step 0.5: Load Research Context (Conditional)

**When**: `--research=<path>` argument provided OR first argument auto-detected as research folder

**Auto-Detection Logic**:
1. Check if first arg is a path (starts with `.` or `/` or contains `/`)
2. Check if `[path]/orchestrator-state.yml` exists
3. Read `task.type` from that file
4. If `task.type: research`, treat as research-based mode
5. Extract task description from research question in state file

**Process**:
1. Validate research task exists and has `analysis/research-report.md`
2. If auto-detected (no explicit task description), extract from research:
   - Read `task.description` or research question from `orchestrator-state.yml`
   - Use as development task description
3. Read research artifacts:
   - `[research-path]/analysis/research-report.md` (REQUIRED)
   - `[research-path]/outputs/recommendations.md` (optional)
   - `[research-path]/outputs/specifications.md` (optional)
   - `[research-path]/outputs/knowledge-base.md` (optional)
   - `[research-path]/orchestrator-state.yml` (for metadata)
4. Extract summaries:
   - Summary: 1-2 sentences from research-report executive summary (max 500 chars)
   - Key findings: Top 5 bullet points from findings
   - Recommended approach: Primary recommendation from recommendations.md
   - Decisions made: Key decisions already made during research
5. Create `analysis/research-context/` directory in task folder
6. Copy research artifacts to `analysis/research-context/`
7. Store in orchestrator-state.yml (see Domain Context section for schema)

**Output on success**:
```
📚 Research Context Loaded
Research: [research_question]
Type: [research_type]
Confidence: [confidence_level]
Key findings: [count] items extracted
Artifacts copied to: analysis/research-context/

This research will inform all workflow phases.
```

**If research path invalid**:
```
⚠️ Research path provided but invalid:
- Path: [research-path]
- Issue: [research-report.md not found / directory doesn't exist / not a research task]

Continuing without research context. You can reference research manually during workflow.
```

**Skip if**: No `--research` argument AND first argument is not a research folder path

### Step 1: Create TodoWrite with All Phases

**Immediately use the TodoWrite tool** to create todos for all phases:

```
Use TodoWrite tool with todos:
[
  {"content": "Check dependencies", "status": "pending", "activeForm": "Checking dependencies"},
  {"content": "Analyze codebase", "status": "pending", "activeForm": "Analyzing codebase"},
  {"content": "Clarify requirements", "status": "pending", "activeForm": "Clarifying requirements"},
  {"content": "Analyze gaps", "status": "pending", "activeForm": "Analyzing gaps"},
  {"content": "Write failing test (TDD Red)", "status": "pending", "activeForm": "Writing failing test"},
  {"content": "Clarify scope & approach", "status": "pending", "activeForm": "Clarifying scope & approach"},
  {"content": "Generate UI mockups", "status": "pending", "activeForm": "Generating UI mockups"},
  {"content": "Clarify technical approach", "status": "pending", "activeForm": "Clarifying technical approach"},
  {"content": "Create specification", "status": "pending", "activeForm": "Creating specification"},
  {"content": "Decide architecture", "status": "pending", "activeForm": "Deciding architecture"},
  {"content": "Audit specification", "status": "pending", "activeForm": "Auditing specification"},
  {"content": "Plan implementation", "status": "pending", "activeForm": "Planning implementation"},
  {"content": "Execute implementation", "status": "pending", "activeForm": "Executing implementation"},
  {"content": "Verify test passes (TDD Green)", "status": "pending", "activeForm": "Verifying test passes"},
  {"content": "Prompt verification options", "status": "pending", "activeForm": "Prompting verification options"},
  {"content": "Verify implementation", "status": "pending", "activeForm": "Verifying implementation"},
  {"content": "Resolve verification issues", "status": "pending", "activeForm": "Resolving verification issues"},
  {"content": "Run E2E tests", "status": "pending", "activeForm": "Running E2E tests"},
  {"content": "Generate user documentation", "status": "pending", "activeForm": "Generating user documentation"},
  {"content": "Finalize workflow", "status": "pending", "activeForm": "Finalizing workflow"}
]
```

**Skip phases based on task type** (remove from todo list when known):

At initialization (task type known):
- **Not part of initiative**: Skip "Check dependencies"
- **Not bug fix**: Skip "Write failing test (TDD Red)" and "Verify test passes (TDD Green)"
- **Bug fix**: Skip "Run E2E tests" and "Generate user documentation"

After gap analysis (clarification needs known):
- **No clarifications needed** (no decisions_needed, no scope_expansion_recommended, ui_heavy=false): Skip "Clarify scope & approach"
- **Not UI-heavy** (ui_heavy=false): Skip "Generate UI mockups" and "Run E2E tests"
- **Simple task** (not complex, single approach): Skip "Clarify technical approach" and "Decide architecture"

After Phase 11 (verification results known):
- **Verification passed**: Skip "Resolve verification issues" (no issues to resolve)

After Phase 10 (user can override):
- **User disabled E2E**: Skip "Run E2E tests"
- **User disabled docs**: Skip "Generate user documentation"

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

## Phase Flow Quick Reference

| Transition | Type | Reason |
|------------|------|--------|
| Phase 0 → 1 | 🚦 GATE | Standard pause point |
| **Phase 1 → 1.5** | ⚡ AUTO | Phase 1.5 handles interaction |
| Phase 1.5 → 2 | 🚦 GATE | Standard pause point |
| Phase 2 → 3 | 🚦 GATE | Standard pause point |
| **Phase 3 → 3.5** | ⚡ AUTO (conditional) | If ui_heavy; skip to 4.5 otherwise |
| Phase 3.5 → 4 | 🚦 GATE | Standard pause point |
| **Phase 4 → 4.5** | ⚡ AUTO (conditional) | If complex; skip to 5 otherwise |
| Phase 4.5 → 5 | 🚦 GATE | Standard pause point |
| Phase 5 → 5.5 | 🚦 GATE | Standard pause point |
| Phase 5.5 → 6 | 🚦 GATE | Standard pause point |
| Phase 6 → 7 | 🚦 GATE | Standard pause point |
| Phase 7 → 8 | 🚦 GATE | Standard pause point |
| Phase 8 → 9 | 🚦 GATE (conditional) | TDD gate for bugs only |
| Phase 9 → 10 | 🚦 GATE | Standard pause point |
| Phase 10 → 11 | 🚦 GATE | Standard pause point |
| **Phase 11 → 11.5** | ⚡ AUTO | Issue resolution handles interaction |
| Phase 11.5 → 12 | 🚦 GATE | Standard pause point |
| Phase 12 → 13 | 🚦 GATE | Standard pause point |
| Phase 13 → 14 | 🚦 GATE | Standard pause point |

**Legend**:
- 🚦 GATE = Check mode, prompt if interactive, auto-continue if YOLO
- ⚡ AUTO = Always continue immediately (no mode check, no user prompt)
- (conditional) = Check conditions before applying pattern

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
| 3.5 | "Clarify scope & approach" | "Clarifying scope & approach" | All (if needs_clarification) |
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

**When**: Only if task has `initiative_id` in `orchestrator-state.yml` task section

**Process**: Check all dependencies are "completed". If blocked, update status and exit.

---

## 🚦 GATE: Phase 0 → Phase 1

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 0 (Dependency Check) complete. Ready to proceed to Phase 1 (Codebase Analysis)?"
     - Options: ["Continue to Phase 1", "Review Phase 0 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 1 (Codebase Analysis)..."
   - Proceed to Phase 1

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 1: Codebase Analysis

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading codebase-analyzer/SKILL.md and following its instructions directly
❌ WRONG: Spawning your own Explore subagents to analyze the codebase
❌ WRONG: Doing codebase analysis inline in the orchestrator thread
❌ WRONG: Skipping this phase because you "already know" the codebase

✅ RIGHT: Using the Skill tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 1 to: codebase-analyzer skill
Method: Skill tool
Expected outputs: analysis/codebase-analysis.md
```

**INVOKE NOW:**

Tool: `Skill`
Parameters:
  skill: "ai-sdlc:codebase-analyzer"

⏳ Wait for skill completion before continuing.

**What codebase-analyzer handles** (you do NOT do this):
- 3 parallel Explore subagents for comprehensive analysis
- Task-type-specific focus (bug/enhancement/feature)
- Risk level assessment
- Structured output for downstream phases

**Focus by Task Type**:

| Task Type | Agent 1 Focus | Agent 2 Focus | Agent 3 Focus |
|-----------|---------------|---------------|---------------|
| **Bug** | Find buggy code path | Trace execution flow | Find tests, reproduction hints |
| **Enhancement** | Find feature files | Analyze current behavior | Find tests, API consumers |
| **Feature** | Find similar patterns | Analyze architecture | Find integration points |

**Outputs**: `analysis/codebase-analysis.md`

**SELF-CHECK (before proceeding to Phase 1.5):**
- [ ] Did you invoke the Skill tool? (not just read this SKILL.md)
- [ ] Did you wait for the tool to return results?
- [ ] Is `analysis/codebase-analysis.md` present?

If NO to any: STOP - go back and invoke the Skill tool.

**State Update**: After codebase-analyzer completes:
- Update `task_context.risk_level` from output
- Extract to `phase_summaries.codebase_analysis`: key_files, primary_language, summary

---

## ⚡ AUTO-CONTINUE: Phase 1 → Phase 1.5

**DO NOT STOP. DO NOT PROMPT USER. PROCEED IMMEDIATELY.**

Phase 1.5 (Clarifying Questions) handles user interaction internally via AskUserQuestion prompts.
Pausing here would create double-prompting.

**NEXT ACTION**: Continue directly to Phase 1.5 below.

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

---

## 🚦 GATE: Phase 1.5 → Phase 2

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 1.5 (Clarifying Questions) complete. Ready to proceed to Phase 2 (Gap Analysis)?"
     - Options: ["Continue to Phase 2", "Review clarifications", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 2 (Gap Analysis)..."
   - Proceed to Phase 2

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 2: Gap Analysis

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/gap-analyzer.md and following its instructions directly
❌ WRONG: Doing gap analysis inline in the orchestrator thread
❌ WRONG: Comparing current vs desired state yourself

✅ RIGHT: Using the Task tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 2 to: gap-analyzer subagent
Method: Task tool
Expected outputs: analysis/gap-analysis.md
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:gap-analyzer"
  description: "Analyze gaps"
  prompt: |
    Analyze gaps for [task_type]: [description].
    Task path: [task-path]
    Task type: [task_type]

    ## CONTEXT FROM PRIOR PHASES
    Risk level: [from task_context.risk_level]
    Codebase summary: [from phase_summaries.codebase_analysis.summary]
    Key files: [from phase_summaries.codebase_analysis.key_files]
    Clarifications: [list from phase_summaries.clarifications]

    Artifacts: analysis/codebase-analysis.md, analysis/clarifications.md

⏳ Wait for subagent completion before continuing.

**Gap Analysis by Task Type**:

| Task Type | Current State | Desired State | Key Output |
|-----------|---------------|---------------|------------|
| **Bug** | Buggy behavior | Correct behavior | Reproduction data, regression risks |
| **Enhancement** | Existing feature | Improved feature | Data lifecycle, user journey impact |
| **Feature** | No feature | Integrated feature | Integration points, patterns to follow |

**Outputs**: `analysis/gap-analysis.md`

**SELF-CHECK (before proceeding to Phase 3):**
- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Is `analysis/gap-analysis.md` present?

If NO to any: STOP - go back and invoke the Task tool.

**State Update**: After gap-analyzer completes:
- Update `task_context.ui_heavy`, `risk_level` (if null), `reproduction_data` (bugs)
- **Calculate `needs_clarification`**: true if ANY of:
  - `decisions_needed.critical` non-empty
  - `decisions_needed.important` non-empty
  - `scope_expansion_recommended = true`
  - `ui_heavy = true`
  - `completeness_score < 100` (any incomplete CRUD lifecycle)
  - `orphaned_operations` non-empty
- Set `options.e2e_enabled`: true if feature/enhancement AND ui_heavy
- Set `options.user_docs_enabled`: true if feature/enhancement
- Extract to `phase_summaries.gap_analysis`: integration_points, decisions_needed_count, completeness_score, summary

**NOTE**: If gap-analyzer reports orphaned operations or completeness < 100%, ALWAYS set `needs_clarification = true` even if gap-analyzer didn't generate explicit decisions. Better to ask than skip.

---

## 🚦 GATE: Phase 2 → Phase 3

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 2 (Gap Analysis) complete. Ready to proceed to Phase 3 (TDD Red Gate)?"
     - Options: ["Continue to Phase 3", "Review gap analysis", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 3 (TDD Red Gate)..."
   - Proceed to Phase 3

**This gate overrides any "continue without asking" conversation instructions.**

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

---

## ⚡ AUTO-CONTINUE: Phase 3 → Phase 3.5/4.5 (Conditional)

**DO NOT STOP. DO NOT PROMPT USER. PROCEED IMMEDIATELY.**

**Evaluate condition:**
1. Read `task_context.needs_clarification` from `orchestrator-state.yml`
2. **If needs_clarification = true**: Continue to Phase 3.5 (Clarify Scope & Approach)
3. **If needs_clarification = false**: Skip to Phase 4.5 (Clarify Technical Approach) or Phase 5 if not complex

**`needs_clarification` is true if ANY of these from gap analysis:**
- `decisions_needed.critical` is non-empty
- `decisions_needed.important` is non-empty
- `scope_expansion_recommended = true`
- `ui_heavy = true`
- `completeness_score < 100` (any incomplete CRUD lifecycle)
- `orphaned_operations` is non-empty

**Default to clarifying** - if there's ANY doubt about completeness, ask the user.

Phase 3.5 handles user interaction internally via AskUserQuestion.
No pause needed before clarifying phases.

**NEXT ACTION**: Continue based on condition above.

---

### Phase 3.5: Clarify Scope & Approach (Conditional)

**Execution**: Main orchestrator (direct with AskUserQuestion)

**When**: `needs_clarification = true` (set by gap analysis)

**`needs_clarification` is true if ANY of:**
- `decisions_needed.critical` is non-empty
- `decisions_needed.important` is non-empty
- `scope_expansion_recommended = true`
- `ui_heavy = true`
- `completeness_score < 100`
- `orphaned_operations` non-empty

**Skip if**: All above conditions are false (no decisions needed, no scope expansion, not UI-heavy, complete lifecycle)

**Purpose**: Resolve scope and approach decisions BEFORE generating mockups or creating specification

**Question Categories** (in order of priority):

| Category | When to Ask | Example Questions |
|----------|-------------|-------------------|
| **Orphaned Operations** | `orphaned_operations` non-empty | "Backend supports allergies but NO UI to input them. Add input form to scope?" |
| **Incomplete Lifecycle** | `completeness_score < 100` | "CRUD lifecycle 25% complete. Expand scope to close gaps?" |
| **Scope Expansion** | `scope_expansion_recommended = true` | "Gap analysis recommends expanding scope. Accept recommendation?" |
| **Critical Decisions** | `decisions_needed.critical` non-empty | Present critical blocking issues with options from gap analysis |
| **Important Decisions** | `decisions_needed.important` non-empty | Present important issues with defaults from gap analysis |
| **Missing Touchpoints** | Safety-critical touchpoints missing | "Allergy info missing from prescription workflow (safety-critical). Include?" |
| **Component Choice** | `ui_heavy = true` | "Use existing DatePicker or build custom?" |
| **Layout** | `ui_heavy = true` | "Modal dialog or inline expansion?" |

**Process**:
1. Read gap-analysis.md structured output
2. **If `orphaned_operations` non-empty**: Ask about each orphaned operation (ALWAYS ask, never skip)
3. **If `completeness_score < 100`**: Ask about completing the lifecycle
4. If `scope_expansion_recommended = true`: Present scope expansion question
5. If `decisions_needed.critical` non-empty: Present critical decisions (blocking)
6. If `decisions_needed.important` non-empty: Present important decisions with defaults
7. If `ui_heavy = true`: Present UI-specific questions (max 3-5)
8. Document all answers in `analysis/scope-clarifications.md`

**NEVER skip orphaned operations questions** - these indicate incomplete features that users cannot use properly.

**YOLO Mode**: Accept all recommended defaults/recommendations, log acceptance

**State Update**: After clarifications complete:
- Set `task_context.clarifications_complete: true` in orchestrator-state.yml
- Set `task_context.scope_expanded: true/false` based on user's scope expansion decision

**Outputs**: `analysis/scope-clarifications.md`

---

## 🚦 GATE: Phase 3.5 → Phase 4

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 3.5 (Clarify Scope & Approach) complete. Ready to proceed to Phase 4 (UI Mockup Generation)?"
     - Options: ["Continue to Phase 4", "Review scope clarifications", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 4 (UI Mockup Generation)..."
   - Proceed to Phase 4

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 4: UI Mockup Generation (Conditional)

**When**: Enhancement or feature with `ui_heavy = true`

**Skip if**: Bug fix OR `ui_heavy = false`

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/ui-mockup-generator.md and following its instructions directly
❌ WRONG: Generating ASCII mockups inline in the orchestrator thread
❌ WRONG: Skipping this phase when ui_heavy = true

✅ RIGHT: Using the Task tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 4 to: ui-mockup-generator subagent
Method: Task tool
Expected outputs: analysis/ui-mockups.md
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:ui-mockup-generator"
  description: "Generate UI mockups"
  prompt: |
    Generate ASCII mockups for: [description]
    Task path: [task-path]

    ## CONTEXT FROM PRIOR PHASES
    Gap analysis: [from phase_summaries.gap_analysis.summary]
    Integration points: [from phase_summaries.gap_analysis.integration_points]
    Scope decisions: [from phase_summaries.scope_clarifications.summary]
    Component choices: [from phase_summaries.scope_clarifications.component_choices]

    Artifacts: analysis/gap-analysis.md, analysis/scope-clarifications.md

⏳ Wait for subagent completion before continuing.

**Outputs**: `analysis/ui-mockups.md`

**SELF-CHECK (before proceeding to Phase 4.5):**
- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Is `analysis/ui-mockups.md` present?

If NO to any: STOP - go back and invoke the Task tool.

---

## ⚡ AUTO-CONTINUE: Phase 4 → Phase 4.5/5 (Conditional)

**DO NOT STOP. DO NOT PROMPT USER. PROCEED IMMEDIATELY.**

**Evaluate condition:**
1. Read `task_context.risk_level` from `orchestrator-state.yml`
2. **If risk_level = medium/high OR complex task detected**: Continue to Phase 4.5
3. **If risk_level = low AND simple task**: Skip to Phase 5 (Specification)

Phase 4.5 handles user interaction internally via AskUserQuestion.
No pause needed before clarifying phases.

**NEXT ACTION**: Continue based on condition above.

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

---

## 🚦 GATE: Phase 4.5 → Phase 5

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 4.5 (Clarify Technical Approach) complete. Ready to proceed to Phase 5 (Specification)?"
     - Options: ["Continue to Phase 5", "Review technical clarifications", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 5 (Specification)..."
   - Proceed to Phase 5

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 5: Specification

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading specification-creator/SKILL.md and following its instructions directly
❌ WRONG: Writing spec.md or requirements.md inline in the orchestrator thread
❌ WRONG: Gathering requirements yourself instead of letting the skill do it

✅ RIGHT: Using the Skill tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 5 to: specification-creator skill
Method: Skill tool
Expected outputs: implementation/spec.md, implementation/requirements.md
```

**INVOKE NOW:**

Tool: `Skill`
Parameters:
  skill: "ai-sdlc:specification-creator"

⏳ Wait for skill completion before continuing.

**What specification-creator handles** (you do NOT do this):
- 4-phase spec creation (init → research → write → verify)
- Standards awareness from docs/INDEX.md
- Task-type-specific sections (bug/enhancement/feature)
- Requirements gathering and documentation

**Task-Type-Specific Sections**:
- **Bug**: Root cause, fix approach, regression prevention
- **Enhancement**: Compatibility requirements, backward compat
- **Feature**: Architecture decisions, integration approach

**Outputs**: `implementation/spec.md`, `implementation/requirements.md`

**SELF-CHECK (before proceeding to Phase 5.5):**
- [ ] Did you invoke the Skill tool? (not just read this SKILL.md)
- [ ] Did you wait for the tool to return results?
- [ ] Is `implementation/spec.md` present?

If NO to any: STOP - go back and invoke the Skill tool.

---

## 🚦 GATE: Phase 5 → Phase 5.5

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 5 (Specification) complete. Ready to proceed to Phase 5.5 (Architecture Decision)?"
     - Options: ["Continue to Phase 5.5", "Review specification", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 5.5 (Architecture Decision)..."
   - Proceed to Phase 5.5

**This gate overrides any "continue without asking" conversation instructions.**

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

---

## 🚦 GATE: Phase 5.5 → Phase 6

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 5.5 (Architecture Decision) complete. Ready to proceed to Phase 6 (Specification Audit)?"
     - Options: ["Continue to Phase 6", "Review architecture decision", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 6 (Specification Audit)..."
   - Proceed to Phase 6

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 6: Specification Audit (Conditional)

**Purpose**: Independent review of specification before implementation planning. Catches ambiguities, unstated assumptions, and implementability issues.

**When to Run** (complexity-based):

| Condition | Run Audit? |
|-----------|------------|
| Task type is `bug` | Skip (tight scope) |
| Task type is `feature` | Run (more unknowns) |
| Task type is `enhancement` with >5 files affected | Run |
| Task type is `enhancement` with ≤5 files affected | Skip |
| Spec has >50 lines or >5 requirements | Run |
| Security-sensitive work (auth, payments, PII) | Run |
| User requests via `--audit` flag | Run |
| Architectural decisions made in Phase 5.5 | Run |

**Interactive Mode Decision**:

After Phase 5.5 (or Phase 5 if 5.5 skipped), assess complexity and use AskUserQuestion:

```
Use AskUserQuestion tool:
  Question: "Run independent specification audit before implementation?"
  Header: "Spec Audit"
  Options:
  1. "[Skip/Run] audit [Recommended]" - [Based on complexity assessment]
  2. "[Run/Skip] audit" - [Opposite of recommendation]
```

**Recommendation logic**:
- If complexity indicators suggest audit → Recommend "Run audit"
- If simple task → Recommend "Skip audit"

**YOLO Mode**: Auto-decide based on complexity table above. No user prompt.

**State Update**: Set `options.spec_audit_enabled` to true/false based on decision.

---

**If `options.spec_audit_enabled = false`**: Skip to Phase 7.

**If `options.spec_audit_enabled = true`**:

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/spec-auditor.md and following its instructions directly
❌ WRONG: Auditing the specification inline in the orchestrator thread
❌ WRONG: Creating spec-audit.md yourself

✅ RIGHT: Using the Task tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 6 to: spec-auditor subagent
Method: Task tool
Expected outputs: verification/spec-audit.md
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:spec-auditor"
  description: "Audit specification"
  prompt: |
    Audit specification for: [description]
    Task path: [task-path]
    Task type: [task_type]

    ## CONTEXT FROM PRIOR PHASES
    Risk level: [from task_context.risk_level]
    Gap analysis: [from phase_summaries.gap_analysis.summary]
    Architecture decision: [from phase_summaries.architecture_decision.summary, if exists]

    Artifacts: implementation/spec.md, .ai-sdlc/docs/INDEX.md

⏳ Wait for subagent completion before continuing.

**Outputs**: `verification/spec-audit.md`

**SELF-CHECK (before proceeding to Phase 7):**
- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Is `verification/spec-audit.md` present?

If NO to any: STOP - go back and invoke the Task tool.

---

## 🚦 GATE: Phase 6 → Phase 7

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 6 (Specification Audit) complete. Ready to proceed to Phase 7 (Implementation Planning)?"
     - Options: ["Continue to Phase 7", "Review spec audit findings", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 7 (Implementation Planning)..."
   - Proceed to Phase 7

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 7: Implementation Planning

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading implementation-planner/SKILL.md and following its instructions directly
❌ WRONG: Creating implementation-plan.md inline in the orchestrator thread
❌ WRONG: Breaking down the spec into tasks yourself

✅ RIGHT: Using the Skill tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 7 to: implementation-planner skill
Method: Skill tool
Expected outputs: implementation/implementation-plan.md
```

**INVOKE NOW:**

Tool: `Skill`
Parameters:
  skill: "ai-sdlc:implementation-planner"

⏳ Wait for skill completion before continuing.

**What implementation-planner handles** (you do NOT do this):
- Task groups organized by layer (database, API, frontend, testing)
- Test-driven steps (2-8 tests per group)
- Dependency ordering and acceptance criteria
- Standards compliance checks from docs/INDEX.md

**Task-Type-Specific Considerations**:
- **Bug**: Regression test preservation
- **Enhancement**: Targeted regression testing (30-70%)
- **Feature**: Integration order

**Outputs**: `implementation/implementation-plan.md`

**SELF-CHECK (before proceeding to Phase 8):**
- [ ] Did you invoke the Skill tool? (not just read this SKILL.md)
- [ ] Did you wait for the tool to return results?
- [ ] Is `implementation/implementation-plan.md` present?

If NO to any: STOP - go back and invoke the Skill tool.

---

## 🚦 GATE: Phase 7 → Phase 8

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 7 (Implementation Planning) complete. Ready to proceed to Phase 8 (Implementation)?"
     - Options: ["Continue to Phase 8", "Review implementation plan", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 8 (Implementation)..."
   - Proceed to Phase 8

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 8: Implementation

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading implementer/SKILL.md and following its instructions directly
❌ WRONG: Writing code inline in the orchestrator thread
❌ WRONG: Executing implementation steps yourself
❌ WRONG: Reading docs/INDEX.md and implementing standards yourself

✅ RIGHT: Using the Skill tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 8 to: implementer skill
Method: Skill tool
Expected outputs: Implemented code, implementation/work-log.md
```

**INVOKE NOW:**

Tool: `Skill`
Parameters:
  skill: "ai-sdlc:implementer"

⏳ Wait for skill completion before continuing.

**What implementer handles** (you do NOT do this):
- Continuous standards discovery from docs/INDEX.md
- Execution mode selection (direct/delegated/orchestrated based on complexity)
- Progress tracking in work-log.md
- Test-driven verification per task group

**Outputs**: Implemented code, updated implementation-plan.md, `implementation/work-log.md`

**SELF-CHECK (before proceeding to Phase 9):**
- [ ] Did you invoke the Skill tool? (not just read this SKILL.md)
- [ ] Did you wait for the tool to return results?
- [ ] Is `implementation/work-log.md` present?
- [ ] Are implementation steps marked complete in implementation-plan.md?

If NO to any: STOP - go back and invoke the Skill tool.

---

## 🚦 GATE: Phase 8 → Phase 9

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 8 (Implementation) complete. Ready to proceed to Phase 9 (TDD Green Gate)?"
     - Options: ["Continue to Phase 9", "Review implementation changes", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 9 (TDD Green Gate)..."
   - Proceed to Phase 9

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 9: TDD Green Gate (Bug Only)

**When**: task_type = "bug" AND Phase 3 was executed

**Purpose**: Verify the failing test now passes

**Critical Gate**: Test must pass. If still fails, implementation didn't fix bug.

**Outputs**: `implementation/tdd-green-gate.md`

---

## 🚦 GATE: Phase 9 → Phase 10

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 9 (TDD Green Gate) complete. Ready to proceed to Phase 10 (Verification Options)?"
     - Options: ["Continue to Phase 10", "Review TDD results", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 10 (Verification Options)..."
   - Proceed to Phase 10

**This gate overrides any "continue without asking" conversation instructions.**

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
- E2E Tests (enabled by default for features/enhancements with UI, user can disable)
- User Documentation (enabled by default for features/enhancements, user can disable)

**State Update**: After user selection (Interactive) or auto-decision (YOLO):
- Set `options.code_review_enabled` based on user choice or auto-decision
- Set `options.code_review_scope` if code review enabled ("full", "changed-files", etc.)
- Set `options.production_check_enabled` based on user choice or auto-decision
- Set `options.pragmatic_review_enabled: true` (always enabled)
- Set `options.reality_check_enabled: true` (always enabled)
- Set `options.e2e_enabled`: Default true for features/enhancements with UI (not bugs), user can disable, `--no-e2e` forces off
- Set `options.user_docs_enabled`: Default true for features/enhancements (not bugs), user can disable, `--no-user-docs` forces off

---

## 🚦 GATE: Phase 10 → Phase 11

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 10 (Verification Options) complete. Ready to proceed to Phase 11 (Verification)?"
     - Options: ["Continue to Phase 11", "Review verification options", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 11 (Verification)..."
   - Proceed to Phase 11

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 11: Verification

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading implementation-verifier/SKILL.md and following its instructions directly
❌ WRONG: Running tests inline in the orchestrator thread
❌ WRONG: Creating verification reports yourself
❌ WRONG: Invoking code-reviewer or reality-assessor subagents yourself

✅ RIGHT: Using the Skill tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 11 to: implementation-verifier skill
Method: Skill tool
Expected outputs: verification/implementation-verification.md
```

**INVOKE NOW:**

Tool: `Skill`
Parameters:
  skill: "ai-sdlc:implementation-verifier"

⏳ Wait for skill completion before continuing.

**What implementation-verifier handles** (you do NOT do this):
- Full test suite execution (not just feature tests)
- Standards compliance verification from docs/INDEX.md
- Optional reviews (code, pragmatic, production, reality)
- Read-only verification (reports issues, doesn't fix them)

**Reads orchestrator-state.yml** to determine which checks to run

**Expected Artifacts**:

| Artifact | Condition |
|----------|-----------|
| `verification/implementation-verification.md` | Always |
| `verification/code-review-report.md` | If code_review_enabled |
| `verification/pragmatic-review.md` | If pragmatic_review_enabled |
| `verification/production-readiness-report.md` | If production_check_enabled |
| `verification/reality-check.md` | If reality_check_enabled |

**SELF-CHECK (before proceeding to Phase 12):**
- [ ] Did you invoke the Skill tool? (not just read this SKILL.md)
- [ ] Did you wait for the tool to return results?
- [ ] Is `verification/implementation-verification.md` present?

If NO to any: STOP - go back and invoke the Skill tool.

---

## ⚡ AUTO: Phase 11 → Phase 11.5

**Always auto-continue** to Phase 11.5 - issue resolution handles its own interaction.

---

### Phase 11.5: Issue Resolution

**When**: Verification found issues (status != "passed")

**Skip if**: Verification status is "passed" (no issues to resolve)

**Purpose**: Fix detected issues through agent reasoning, user decisions, and re-verification.

**Pattern**: You loaded `issue-resolution-pattern.md` in Step 0. Follow that pattern now.

**Development-specific notes**:
- Verifier: `ai-sdlc:implementation-verifier`
- Typical fixable issues: lint errors, formatting, missing imports, obvious typos
- State: `verification_context` in orchestrator-state.yml
- Re-verify by re-invoking the implementation-verifier skill

**Process summary**:
1. Read `issues[]` from verifier structured output
2. Fix trivial issues silently, ask user about non-trivial ones
3. Re-verify if fixes applied (max 3 iterations)
4. Exit when: passes, user proceeds with known issues, or max iterations

**Log all actions** to `implementation/work-log.md`

---

## 🚦 GATE: Phase 11.5 → Phase 12

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 11.5 (Issue Resolution) complete. Ready to proceed to Phase 12 (E2E Testing)?"
     - Options: ["Continue to Phase 12", "Review what was fixed", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 12 (E2E Testing)..."
   - Proceed to Phase 12

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 12: E2E Testing (Optional)

**When**: `options.e2e_enabled = true` (Interactive prompts, YOLO auto-runs if UI-related, or `--e2e` flag)

**Skip if**: `options.e2e_enabled = false` or bug fix

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/e2e-test-verifier.md and following its instructions directly
❌ WRONG: Running Playwright tests inline in the orchestrator thread
❌ WRONG: Taking screenshots yourself

✅ RIGHT: Using the Task tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 12 to: e2e-test-verifier subagent
Method: Task tool
Expected outputs: verification/e2e-verification-report.md, screenshots
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:e2e-test-verifier"
  description: "E2E verification"
  prompt: |
    Run E2E tests for: [description]
    Task path: [task-path]

    ## CONTEXT FROM PRIOR PHASES
    Specification: [from phase_summaries.specification.summary]
    UI mockups: [from phase_summaries.ui_mockups.summary, if exists]

    Artifacts: implementation/spec.md, analysis/ui-mockups.md

⏳ Wait for subagent completion before continuing.

**Outputs**: `verification/e2e-verification-report.md`, screenshots

**SELF-CHECK (before proceeding to Phase 13):**
- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Is `verification/e2e-verification-report.md` present?
- [ ] Is `verification/screenshots/` directory present and populated?
- [ ] Do all image references in report resolve to existing files?

If NO to any: STOP - go back and invoke the Task tool.

---

## 🚦 GATE: Phase 12 → Phase 13

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 12 (E2E Testing) complete. Ready to proceed to Phase 13 (User Documentation)?"
     - Options: ["Continue to Phase 13", "Review E2E test results", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 13 (User Documentation)..."
   - Proceed to Phase 13

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 13: User Documentation (Optional)

**When**: `options.user_docs_enabled = true` (Feature or enhancement, not bugs, user request or `--user-docs` flag)

**Skip if**: `options.user_docs_enabled = false` or bug fix

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/user-docs-generator.md and following its instructions directly
❌ WRONG: Writing user documentation inline in the orchestrator thread
❌ WRONG: Taking screenshots yourself

✅ RIGHT: Using the Task tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 13 to: user-docs-generator subagent
Method: Task tool
Expected outputs: documentation/user-guide.md, screenshots
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:user-docs-generator"
  description: "Generate user documentation"
  prompt: |
    Generate user documentation for: [description]
    Task path: [task-path]

    ## CONTEXT FROM PRIOR PHASES
    Specification: [from phase_summaries.specification.summary]
    Verification: Implementation verified, tests passing

    Artifacts: implementation/spec.md, analysis/ui-mockups.md

⏳ Wait for subagent completion before continuing.

**Outputs**: `documentation/user-guide.md`, screenshots

**SELF-CHECK (before proceeding to Phase 14):**
- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Is `documentation/user-guide.md` present?
- [ ] Is `documentation/screenshots/` directory present and populated?
- [ ] Do all image references in user guide resolve to existing files?

If NO to any: STOP - go back and invoke the Task tool.

---

## 🚦 GATE: Phase 13 → Phase 14

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 13 (User Documentation) complete. Ready to proceed to Phase 14 (Finalization)?"
     - Options: ["Continue to Phase 14", "Review user documentation", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 14 (Finalization)..."
   - Proceed to Phase 14

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 14: Finalization

**Process**:
1. Create workflow summary
2. Update `task.status` to "completed" in orchestrator-state.yml
3. Provide commit message template
4. Guide next steps

---

## Domain Context (State Extensions)

Development-specific fields in `orchestrator-state.yml`:

```yaml
orchestrator:
  task_type: bug | enhancement | feature
  options:
    spec_audit_enabled: null      # Conditional based on complexity (Phase 6)
    e2e_enabled: null             # Default true for features/enhancements with UI (Phase 10)
    user_docs_enabled: null       # Default true for features/enhancements (Phase 10)
    code_review_enabled: true     # Default enabled
    production_check_enabled: false  # Default disabled
    pragmatic_review_enabled: true   # Always enabled
    reality_check_enabled: true      # Always enabled
    code_review_scope: null
  task_context:
    type: bug | enhancement | feature
    risk_level: null
    ui_heavy: null
    needs_clarification: null          # Set by Phase 2 (true if decisions_needed OR scope_expansion OR ui_heavy)
    clarifications_resolved: null      # Set by Phase 1.5 (requirements clarifications)
    clarifications_complete: null      # Set by Phase 3.5 (scope & approach clarifications)
    scope_expanded: null               # Set by Phase 3.5 (if user agreed to scope expansion)
    architecture_decision: null        # Feature/Enhancement only
    tdd_applicable: true               # Bug only
    reproduction_data: null            # Bug only

    # Research linkage (populated if --research provided or auto-detected, see Step 0.5)
    research_reference:
      path: null                       # Path to research task directory
      research_question: null          # Original research question
      research_type: null              # technical | requirements | literature | mixed
      confidence_level: null           # high | medium | low

    # Phase summaries for context passing (see Pattern 7-8 in delegation-enforcement.md)
    phase_summaries:
      # Research is "phase -1" - populated at init if --research provided
      research:
        summary: null                  # 1-2 sentence summary
        key_findings: []               # Max 5 bullet points
        recommended_approach: null     # Primary recommendation
        decisions_made: []             # Key decisions from research
      codebase_analysis: {key_files: [], primary_language: null, summary: null}
      clarifications: []               # [{question, answer}]
      gap_analysis: {integration_points: [], summary: null}
      scope_clarifications: {scope_expanded: null, component_choices: [], summary: null}
      ui_mockups: {components_designed: [], summary: null}
      specification: {summary: null}
      architecture_decision: {decision: null, summary: null}
```

---

## Task Structure

```
.ai-sdlc/tasks/[type-directory]/YYYY-MM-DD-task-name/
├── orchestrator-state.yml           # Execution state + task metadata
├── analysis/
│   ├── research-context/             # From research (if --research provided)
│   │   ├── research-report.md        # Full research findings
│   │   ├── recommendations.md        # Decision frameworks (optional)
│   │   ├── specifications.md         # Research requirements (optional)
│   │   └── knowledge-base.md         # Reference patterns (optional)
│   ├── codebase-analysis.md          # Phase 1
│   ├── clarifications.md             # Phase 1.5
│   ├── gap-analysis.md               # Phase 2
│   ├── scope-clarifications.md       # Phase 3.5 (conditional)
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
│   ├── spec-audit.md                 # Phase 6 (conditional)
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
| `--audit` / `--no-audit` | Force/skip specification audit (Phase 6) |
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
