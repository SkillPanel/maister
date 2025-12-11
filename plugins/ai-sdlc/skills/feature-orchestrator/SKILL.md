---
name: feature-orchestrator
description: Orchestrates the complete new feature development workflow from specification through implementation to verification. Supports both interactive mode (pause between phases) and YOLO mode (continuous execution). Handles failures with auto-recovery, flexible entry points, and optional E2E testing and user documentation generation.
---

# Feature Orchestrator

This skill orchestrates the complete development workflow for new features, ensuring all phases are executed systematically and best practices are followed.

## When to Use This Skill

Use this skill when:
- Starting development of a new feature from scratch
- You want guided workflow through spec → plan → implement → verify
- You need state management for multi-phase work (pause/resume capability)
- You want automated failure recovery during implementation
- You need optional E2E testing and user documentation generation

## Core Principles

1. **Complete Workflow**: Guides through all phases from specification to deployment readiness
2. **Flexible Entry**: Start from any phase if previous work exists
3. **Intelligent Automation**: YOLO mode for fast execution, Interactive mode for control
4. **Auto-Recovery**: Automatically attempts to fix common failures
5. **Standards Compliance**: Ensures continuous standards discovery throughout
6. **State Management**: Can pause and resume long-running workflows

## Progress Tracking

Use `TodoWrite` to show real-time progress to the user. Create todos at workflow start, update at each phase transition.

**Phase Todos**:

| Phase | content | activeForm |
|-------|---------|------------|
| 0.5 | "Check dependencies" | "Checking dependencies" |
| 1 | "Create specification" | "Creating specification" |
| 1.5 | "Generate UI mockups" | "Generating UI mockups" |
| 2 | "Plan implementation" | "Planning implementation" |
| 3 | "Execute implementation" | "Executing implementation" |
| 4 | "Prompt verification options" | "Prompting verification options" |
| 5 | "Verify implementation" | "Verifying implementation" |
| 6 | "Run E2E tests" | "Running E2E tests" |
| 7 | "Generate user documentation" | "Generating user documentation" |
| 8 | "Finalize workflow" | "Finalizing workflow" |

**Rules**:
- Create all phase todos at workflow start (pending)
- Mark current phase `in_progress` before execution
- Mark phase `completed` immediately after success
- Optional phases skipped: mark as `completed`
- State file remains source of truth for resume logic

---

## MANDATORY Initialization (Before Any Phase Work)

**CRITICAL: You MUST complete these steps BEFORE executing any workflow phase:**

### Step 1: Create TodoWrite with All Phases

**Immediately use the TodoWrite tool** to create todos for all phases:

```
Use TodoWrite tool with todos:
[
  {"content": "Check dependencies", "status": "pending", "activeForm": "Checking dependencies"},
  {"content": "Create specification", "status": "pending", "activeForm": "Creating specification"},
  {"content": "Generate UI mockups", "status": "pending", "activeForm": "Generating UI mockups"},
  {"content": "Plan implementation", "status": "pending", "activeForm": "Planning implementation"},
  {"content": "Execute implementation", "status": "pending", "activeForm": "Executing implementation"},
  {"content": "Prompt verification options", "status": "pending", "activeForm": "Prompting verification options"},
  {"content": "Verify implementation", "status": "pending", "activeForm": "Verifying implementation"},
  {"content": "Run E2E tests", "status": "pending", "activeForm": "Running E2E tests"},
  {"content": "Generate user documentation", "status": "pending", "activeForm": "Generating user documentation"},
  {"content": "Finalize workflow", "status": "pending", "activeForm": "Finalizing workflow"}
]
```

### Step 2: Output Initialization Summary

**Output this summary to the user:**

```
🚀 Feature Orchestrator Started

Feature: [feature description]
Mode: [Interactive/YOLO]

Workflow Phases:
0.5. [ ] Dependency Check (if part of initiative)
1. [ ] Specification → specification-creator skill
1.5. [ ] UI Mockups (optional) → ui-mockup-generator subagent
2. [ ] Implementation Planning → implementation-planner skill
3. [ ] Implementation → implementer skill
4. [ ] Verification Options Prompt
5. [ ] Verification → implementation-verifier skill
6. [ ] E2E Testing (optional) → e2e-test-verifier subagent
7. [ ] User Documentation (optional) → user-docs-generator subagent
8. [ ] Finalization

State file: [task-path]/orchestrator-state.yml

[Interactive mode] You'll be prompted for review after each phase.
[YOLO mode] All phases will run continuously.

Starting Phase 1: Create Specification...
```

### Step 3: Only Then Proceed to Phase 1

After completing Steps 1 and 2, proceed to Phase 0.5 (Dependency Check) or Phase 1 (Specification).

---

## Execution Modes

### Interactive Mode (Default)
- Pauses after each major phase for user review
- Prompts for optional verification checks (code review, production readiness)
- Prompts for optional phases (E2E tests, user docs)
- Allows course correction between phases
- Best for: Complex features, learning, careful review

### YOLO Mode
- Runs all phases continuously without pausing
- Auto-decides on optional verification checks based on implementation signals
- Auto-enables optional phases based on feature type
- Reports progress but doesn't wait for approval
- Best for: Simple features, experienced users, trusted automation

## Workflow Phases

### Phase 0.5: Dependency Check (If Part of Initiative)

**Purpose**: Validate dependencies if this task is part of a larger initiative

**When**: Before Phase 1 (Specification), only if task has `initiative_id` in metadata.yml

**Actions**:
1. Read task metadata.yml
2. Check if `initiative_id` field exists
3. If NO initiative_id: Skip this phase (standalone task)
4. If YES initiative_id:
   a. Read `dependencies` array from metadata.yml
   b. For each dependency task path:
      - Read dependency task's metadata.yml
      - Check `status` field
   c. If ANY dependency status != "completed":
      - BLOCK task execution
      - Update task status to "blocked" in metadata.yml
      - Exit with message: "Task blocked by dependencies: [list]. Dependencies must complete first. Check initiative status with: /ai-sdlc:initiative:status [initiative-path]"
   d. If ALL dependencies completed:
      - Log: "All dependencies satisfied, proceeding to specification"
      - Continue to Phase 1

**Outputs**:
- None if dependencies satisfied (continues to Phase 1)
- Updated metadata.yml with status="blocked" if dependencies not satisfied
- Error message with blocking dependency list

**Integration**:
- Minimal change to existing workflow
- No impact on standalone tasks (skipped automatically)
- Clean separation of initiative coordination from task execution

**Example metadata.yml with initiative fields**:
```yaml
name: SSO Integration
type: enhancement
status: pending
priority: high

# Initiative-specific fields
initiative_id: 2025-11-14-auth-system
dependencies:
  - .ai-sdlc/tasks/new-features/2025-11-14-basic-login
  - .ai-sdlc/tasks/migrations/2025-11-14-database-schema
blocks: [2025-11-16-mfa-enhancement]
milestone: Core Features

estimated_hours: 50
actual_hours: 0
```

### Phase 1: Specification Creation
**Skill**: `specification-creator`

**Actions**:
1. Initialize task structure in `.ai-sdlc/tasks/new-features/`
2. Research requirements through Q&A
3. Analyze visual assets if provided
4. Search for reusable components
5. Create comprehensive spec.md
6. Verify specification quality

**Outputs**:
- `implementation/spec.md` - Feature specification
- `analysis/requirements.md` - Requirements gathering results
- `analysis/visuals/` - Design mockups (if provided)
- `verification/spec-verification.md` - Specification quality report
- `metadata.yml` - Task metadata

**Auto-Fix Strategy**:
- If spec verification fails: Re-invoke specification-creator with issues as context
- If requirements unclear: Re-run research phase with clarifying questions asked using AskUserQuestion
- Max attempts: 2

### Phase 1.5a: Specification Audit (Run Automatically)
**Agent**: `spec-auditor` (subagent)

**Purpose**: Verify specification completeness and clarity before implementation

**Triggered When**: Always after Phase 1 (Specification Creation) - runs automatically in both Interactive and YOLO modes

**Actions**:
1. Invoke spec-auditor via Task tool with implementation/spec.md path
2. Review audit findings for ambiguities, gaps, implementability issues
3. If critical issues found: Pause workflow, request clarification
4. If minor issues: Note in work-log and continue

**Outputs**:
- `verification/spec-audit.md` - Audit findings and recommendations

**Auto-Fix Strategy**:
- If ambiguities found: Highlight specific sections needing clarification
- Max attempts: 1 (prompt user if unresolved)

### Phase 1.5: UI Mockup Generation (Optional)
**Agent**: `ui-mockup-generator`

**Purpose**: Generate ASCII mockups for UI-heavy features

**Triggered When**:
- Interactive mode: Prompt user if UI-heavy keywords detected in spec
- YOLO mode: Auto-run if UI-heavy keywords detected in spec
- Explicit flag: `--ui-mockups` in command
- Manual decision: User confirms during Phase 1 review

**UI-Heavy Detection**:
Keywords indicating UI-intensive work:
- Display: show, display, render, view, visualize
- Components: button, form, modal, table, card, list, grid, dropdown, menu
- Screens: page, screen, view, panel, sidebar, toolbar
- Actions: add [UI element], create [UI element], design, layout
- UI Changes: redesign, restyle, improve UI, enhance UX

**Actions**:
1. Scan spec.md for UI-heavy keywords
2. If UI-heavy OR user confirms:
   - Invoke `ui-mockup-generator` subagent via Task tool
   - Pass task path and spec location
   - Wait for mockup generation complete
3. If not UI-heavy: Skip to Phase 2 (Planning)

**Outputs**:
- `analysis/ui-mockups.md` - ASCII diagrams showing layout integration
- Component reuse plan
- Integration point annotations

**Auto-Fix Strategy**:
- If mockup generation fails: Continue without mockups (optional phase)
- Mockups are helpful but not required for feature success
- Max attempts: 1

**Benefits**:
- Visualize layout before implementation
- Identify reusable components early
- Ensure consistency with existing UI patterns
- Prevent navigation/discoverability issues

**Reference**: `agents/ui-mockup-generator.md`

### Phase 2: Implementation Planning
**Skill**: `implementation-planner`

**Actions**:
1. Analyze specification and requirements
2. Determine task groups (1-6 based on complexity)
3. Create implementation steps with test-driven approach
4. Set dependencies between groups
5. Define acceptance criteria

**Outputs**:
- `implementation/implementation-plan.md` - Detailed implementation steps

**Auto-Fix Strategy**:
- If planning incomplete: Regenerate with specific constraints
- If dependencies incorrect: Re-analyze and regenerate
- Max attempts: 2

### Phase 3: Implementation
**Skill**: `implementer`

**Standards Reminder**: The implementer skill reads `.ai-sdlc/docs/INDEX.md` for continuous standards discovery throughout execution. Ensure relevant standards context from previous phases is available.

**Actions**:
1. Execute implementation/implementation-plan.md step by step
2. Continuous standards discovery from docs/INDEX.md
3. Adaptive execution mode (direct/plan-execute/orchestrated)
4. Test-driven approach (write tests → implement → verify)
5. Incremental verification per task group

**Outputs**:
- Implemented code changes
- Updated `implementation/implementation-plan.md` (all steps complete)
- `implementation/work-log.md` - Activity log

**Auto-Fix Strategy**:
- If implementation step fails: Re-run with error context
- If tests fail: Analyze and fix (max 3 attempts per group)
- If standards missing: Re-check INDEX.md and apply
- Max overall retries: 5

### Phase 4: Optional Verification Checks Prompt
**Purpose**: Determine which optional verification checks to run

**Triggered When**: After Phase 3 (Implementation) complete, before Phase 5 (Verification)

**Actions**:

1. **Analyze implementation for recommendation signals**:

   Gather data from completed implementation:
   - Files modified count (from work-log.md or git diff)
   - Critical files touched: auth, payment, security, database (check file paths)
   - Feature type: new-feature (from task path)
   - Complexity: from planning phase (implementation/implementation-plan.md task groups count)
   - Deployment target: from metadata.yml or default to "production"

2. **Determine recommendation level for each check**:

   **Code Review Recommendation**:
   ```
   IF files_modified >= 20 OR critical_files_modified.length > 0 OR complexity == "high":
     recommendation = "strongly_recommended"
     reason = "20+ files modified" OR "Includes [auth/payment/security] changes" OR "High complexity"
   ELSE IF files_modified >= 10 OR complexity == "medium":
     recommendation = "recommended"
     reason = "10-19 files modified" OR "Medium complexity"
   ELSE:
     recommendation = "optional"
     reason = "Minor changes, low complexity"
   ```

   **Production Readiness Recommendation**:
   ```
   IF deployment_target == "production" AND (user_facing == true OR infrastructure_changes == true):
     recommendation = "strongly_recommended"
     reason = "Production deployment + user-facing changes" OR "Infrastructure changes detected"
   ELSE IF deployment_target == "production" OR user_facing == true:
     recommendation = "recommended"
     reason = "Production deployment" OR "User-facing changes"
   ELSE:
     recommendation = "optional"
     reason = "Dev/staging deployment, internal feature"
   ```

3. **Check for explicit command flags** (override auto-detection):

   ```
   IF --code-review flag set:
     code_review_enabled = true
     code_review_scope = flag value OR "all"
     skip_prompt = true
   ELSE IF --no-code-review flag set:
     code_review_enabled = false
     skip_prompt = true

   IF --production-check flag set:
     production_check_enabled = true
     production_check_target = flag value OR "production"
     skip_prompt = true
   ELSE IF --no-production-check flag set:
     production_check_enabled = false
     skip_prompt = true
   ```

4. **Prompt user (if no explicit flags)**:

   **Interactive Mode**:

   Use **AskUserQuestion** tool:

   ```
   Question: "Which verification checks should I run? (Select all that apply)"

   Header: "Verification Options"

   Multi-select: true

   Options:
   1. Label: "Code Review [STRONGLY RECOMMENDED]" (if strongly_recommended)
      OR "Code Review [Recommended]" (if recommended)
      OR "Code Review [Optional]" (if optional)
      Description: "Automated quality, security, and performance analysis. [Reason: {reason}]. Adds ~3 minutes."

   2. Label: "Production Readiness [STRONGLY RECOMMENDED]" (if strongly_recommended)
      OR "Production Readiness [Recommended]" (if recommended)
      OR "Production Readiness [Optional]" (if optional)
      Description: "Verify deployment readiness: config, monitoring, security. [Reason: {reason}]. Adds ~4 minutes."

   3. Label: "Skip optional checks"
      Description: "Run basic verification only (implementation plan, tests, standards, docs). Faster but less comprehensive."
   ```

   **YOLO Mode**:

   Auto-decide without prompting:
   ```
   IF code_review_recommendation in ["strongly_recommended", "recommended"]:
     code_review_enabled = true
     code_review_scope = "all"
     Output: "✅ Auto-enabling code review ({recommendation}: {reason})"
   ELSE:
     code_review_enabled = false
     Output: "⏭️ Skipping code review (optional for this change)"

   IF production_readiness_recommendation == "strongly_recommended":
     production_check_enabled = true
     production_check_target = "production"
     Output: "✅ Auto-enabling production readiness (strongly recommended: {reason})"
   ELSE:
     production_check_enabled = false
     Output: "⏭️ Skipping production readiness (not critical for this change)"

   # Reality assessment and pragmatic review are always enabled for features
   pragmatic_review_enabled = true
   reality_check_enabled = true
   Output: "✅ Auto-enabling reality assessment + pragmatic review (mandatory for features)"
   ```

5. **Update orchestrator state** with decisions:

   ```yaml
   orchestrator:
     options:
       code_review_enabled: true | false
       code_review_scope: "all" | "quality" | "security" | "performance"
       code_review_requested_by: "auto" | "user" | "flag"
       production_check_enabled: true | false
       production_check_target: "production" | "staging"
       production_check_requested_by: "auto" | "user" | "flag"
       pragmatic_review_enabled: true      # Always true for features
       reality_check_enabled: true          # Always true for features
   ```

6. **Output confirmation**:

   ```
   ✅ Verification Configuration

   Will run:
   - ✅ Basic Verification (implementation plan, tests, standards, docs)
   - ✅ Reality Assessment (always enabled for features)
   - ✅ Pragmatic Review (always enabled for features)
   [If code_review_enabled]
   - ✅ Code Review (Scope: {scope})
   [If production_check_enabled]
   - ✅ Production Readiness Check (Target: {target})

   Proceeding to Phase 5: Verification...
   ```

**Outputs**:
- Updated `orchestrator-state.yml` with verification options
- Verification configuration logged

**Auto-Fix Strategy**:
- N/A - This is a decision phase, not an execution phase

### Phase 5: Verification
**Skill**: `implementation-verifier`

**Actions**:
1. Read verification options from orchestrator-state.yml (set in Phase 4)
2. Verify implementation plan completion
3. Run full test suite (entire project)
4. Check standards compliance
5. Validate documentation completeness
6. Optional: Code review (if code_review_enabled == true from orchestrator state)
7. Optional: Production readiness check (if production_check_enabled == true from orchestrator state)
8. Create comprehensive verification report

**Note**: implementation-verifier will NOT prompt the user because orchestrator already decided in Phase 4

**Outputs**:
- `verification/implementation-verification.md` - Verification report
- Status: ✅ Passed | ⚠️ Passed with Issues | ❌ Failed

**Auto-Fix Strategy**:
- If tests fail: Invoke implementer with fix instructions (max 2 attempts)
- If standards missing: Document in report (verification is read-only)
- If documentation incomplete: Create minimal docs automatically
- Max attempts: 2

### Phase 5a: Reality Check (Run Automatically)
**Agent**: `reality-assessor` (subagent)

**Purpose**: Validate work actually functions end-to-end (not just passes tests)

**Triggered When**: Always after Phase 5 (Verification) - runs automatically in both Interactive and YOLO modes

**Actions**:
1. Invoke reality-assessor via Task tool with task directory path
2. Test user workflows from specification
3. Verify error scenarios and edge cases
4. Check integration points function correctly
5. Assess if feature solves the stated problem

**Outputs**:
- `verification/reality-check.md` - Reality assessment with GO/NO-GO recommendation

**Critical Failure Handling**:
- If reality-check returns NO-GO in YOLO mode: Pause workflow
- In interactive mode: Show results and prompt user decision

### Phase 5b: Pragmatic Review (Run Automatically)
**Agent**: `code-quality-pragmatist` (subagent)

**Purpose**: Detect over-engineering and ensure code matches project scale

**Triggered When**: Always after Phase 5a (Reality Check) - runs automatically in both Interactive and YOLO modes

**Actions**:
1. Invoke code-quality-pragmatist via Task tool with implementation paths
2. Evaluate pattern appropriateness for project scale
3. Identify unnecessary complexity or abstractions
4. Check for intrusive automation or premature optimization
5. Recommend simplifications if needed

**Outputs**:
- `verification/pragmatic-review.md` - Over-engineering assessment with simplification recommendations

**Critical Failure Handling**:
- If CRITICAL over-engineering found in YOLO mode: Continue with warning (non-blocking)
- In interactive mode: Show findings for user review

### Phase 6: E2E Testing (Optional)
**Agent**: `e2e-test-verifier`

**Triggered When**:
- Interactive mode: Prompt user after Phase 5 (Verification)
- YOLO mode: Auto-run if spec mentions UI/frontend
- Explicit flag: `--e2e` in command

**Actions**:
1. Validate playwright-mcp availability
2. Check application is running
3. Execute browser-based tests from spec user stories
4. Capture screenshots as evidence
5. Create E2E verification report

**Outputs**:
- `verification/e2e-verification-report.md`
- `verification/screenshots/` - Evidence screenshots

**Auto-Fix Strategy**:
- If E2E tests fail: Invoke implementer with UI fixes (max 2 attempts)
- If application not running: Prompt user to start
- Max attempts: 2

### Phase 7: User Documentation (Optional)
**Agent**: `user-docs-generator`

**Triggered When**:
- Interactive mode: Prompt user after Phase 6 (or 5 if E2E skipped)
- YOLO mode: Auto-run if spec indicates user-facing features
- Explicit flag: `--user-docs` in command

**Actions**:
1. Analyze spec for user workflows
2. Use Playwright to capture UI screenshots
3. Write non-technical user guide
4. Include troubleshooting and tips

**Outputs**:
- `documentation/user-guide.md`
- `documentation/screenshots/` - Step-by-step screenshots

**Auto-Fix Strategy**:
- If screenshot capture fails: Document without screenshots
- If application not running: Prompt user
- Max attempts: 1 (docs are optional)

### Phase 8: Finalization
**Actions**:
1. Create comprehensive workflow summary
2. Update task metadata status to "completed"
3. Optionally update roadmap in docs/project/roadmap.md
4. Provide commit message template
5. Guide next steps (PR creation, deployment)

**Outputs**:
- Workflow summary report
- Updated `metadata.yml`
- Commit message template

---

## Output Directory Structure

All workflow artifacts are organized in the task directory. This structure is used regardless of how the skill is invoked (via command, direct skill invocation, or orchestrator):

```
.ai-sdlc/tasks/new-features/YYYY-MM-DD-feature-name/
├── metadata.yml                           # Task metadata and tracking
├── orchestrator-state.yml                 # Workflow state (pause/resume)
├── analysis/
│   ├── requirements.md                   # Gathered requirements
│   └── visuals/                           # Design mockups and wireframes
├── implementation/
│   ├── spec.md                           # Specification (WHAT to build)
│   ├── implementation-plan.md            # Implementation steps (HOW to build)
│   └── work-log.md                       # Activity log
├── verification/
│   ├── implementation-verification.md    # Verification report
│   └── e2e-verification-report.md        # E2E tests (optional)
└── documentation/
    ├── user-guide.md                     # User documentation (optional)
    └── screenshots/                       # User guide screenshots
```

**Directory Purpose**:
- `analysis/` - Requirements gathering and visual assets
- `implementation/` - Specification, implementation plan, and work log
- `verification/` - Verification and E2E test reports
- `documentation/` - User-facing documentation

**Key Files**:
- `metadata.yml` - Task metadata (status, priority, tags, time tracking)
- `orchestrator-state.yml` - Workflow state for pause/resume capability
- `implementation/spec.md` - Main specification document (WHAT to build)
- `implementation/implementation-plan.md` - Implementation steps breakdown (HOW to build)
- `implementation/work-log.md` - Chronological activity log

---

## Orchestrator Workflow Execution

### Initialization

**STEP 1: Parse Command Arguments**

Extract from invocation:
- Feature description (if provided)
- Execution mode: `--yolo` flag or default interactive
- Entry point: `--from=phase` (spec, plan, implement, verify)
- Optional phase flags: `--e2e`, `--user-docs`
- Task path: If resuming existing task

**STEP 2: Determine Starting Phase**

**If task path provided** (resuming):
1. Read `orchestrator-state.yml` if exists
2. Check completed_phases
3. Determine next phase to execute
4. Validate prerequisites for that phase

**If new feature**:
1. Start from specified phase (`--from`) or Phase 1 (default)
2. If starting mid-workflow, validate required files exist:
   - Starting from plan: Requires implementation/spec.md
   - Starting from implement: Requires implementation/spec.md + implementation/implementation-plan.md
   - Starting from verify: Requires implementation/spec.md + implementation/implementation-plan.md + implementation complete

**If prerequisites missing**:
```
❌ Cannot start from [phase] - missing prerequisites!

Required files:
- [file1]: ❌ Missing
- [file2]: ❌ Missing

Options:
1. Start from beginning (Phase 1: Specification)
2. Provide/create missing files manually
3. Specify different entry point with --from

Which option would you like?
```

**STEP 3: Initialize State Management**

Create/update `orchestrator-state.yml`:

```yaml
orchestrator:
  mode: interactive  # or yolo
  started_phase: specification  # or plan, implement, verify
  current_phase: specification
  completed_phases: []
  failed_phases: []
  auto_fix_attempts:
    specification: 0
    ui_mockup_generation: 0
    planning: 0
    implementation: 0
    verification: 0
    e2e_testing: 0
  options:
    ui_mockups_enabled: false  # or true if --ui-mockups flag
    e2e_enabled: false  # or true if --e2e flag
    user_docs_enabled: false  # or true if --user-docs flag
  created: 2025-10-26T12:00:00Z
  updated: 2025-10-26T12:00:00Z
  task_path: .ai-sdlc/tasks/new-features/2025-10-26-feature-name
```

**STEP 4: Output Initialization Summary**

```
🚀 Feature Development Orchestrator Started

Feature: [feature name/description]
Mode: [Interactive/YOLO]
Starting Phase: [phase name]

Workflow Phases:
1. [x] Specification - [Starting here / Already complete / Pending]
1.5 [ ] UI Mockup Generation (optional) - [Enabled / Will prompt / Disabled]
2. [ ] Planning - [Next / Pending / Will skip]
3. [ ] Implementation
4. [ ] Verification
5. [ ] E2E Testing (optional) - [Enabled / Will prompt / Disabled]
6. [ ] User Documentation (optional) - [Enabled / Will prompt / Disabled]

State file: [path]/orchestrator-state.yml

[Interactive mode message]
You'll be prompted for review after each phase.

[YOLO mode message]
All phases will run continuously. Buckle up! 🎢

Press Enter to begin...
```

### Phase Execution Loop

**FOR each phase in workflow:**

**STEP 1: Check if Phase Already Completed**

Read `orchestrator-state.yml`:
- If phase in `completed_phases`: Skip to next phase
- If phase in `failed_phases` and max retries exceeded: Halt with error
- Otherwise: Proceed with execution

**STEP 2: Update State to Current Phase**

```yaml
orchestrator:
  current_phase: [phase-name]
  updated: [current-timestamp]
```

**STEP 3: Pre-Phase Announcement**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase [N]: [Phase Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Phase description]

Invoking: [skill-name/agent-name]

Starting...
```

**STEP 4: Execute Phase**

**For Phases 1-4** (Skills):
```
Invoke skill via Skill tool:
- specification-creator for Phase 1
- implementation-planner for Phase 2
- implementer for Phase 3
- implementation-verifier for Phase 4

Capture output and results.
```

**For Phases 5-6** (Agents):
```
Invoke agent via Task tool with subagent_type:
- e2e-test-verifier for Phase 5
- user-docs-generator for Phase 6

Capture output and results.
```

**STEP 5: Analyze Phase Results**

Extract status from phase output:
- ✅ Success
- ⚠️ Success with warnings
- ❌ Failure

If ❌ Failure detected:
- Increment `auto_fix_attempts.[phase]` in state
- Check if max attempts reached
- Execute auto-fix strategy (see Auto-Fix Strategies section below)

**STEP 6: Update State After Phase**

If success:
```yaml
orchestrator:
  completed_phases:
    - [phase-name]
  updated: [timestamp]
```

If failure (after auto-fix attempts):
```yaml
orchestrator:
  failed_phases:
    - phase: [phase-name]
      attempts: [count]
      error: [error description]
  updated: [timestamp]
```

**STEP 7: Post-Phase Review (Interactive Mode Only)**

If interactive mode:
```
✅ Phase [N] Complete: [Phase Name]

Results:
- [Key result 1]
- [Key result 2]

Status: [Success/Success with warnings]

[If warnings exist]
⚠️ Warnings:
- [Warning 1]
- [Warning 2]

Would you like to:
1. Continue to next phase
2. Review outputs in detail
3. Restart this phase
4. Stop workflow (resume later)

Choice: _
```

Wait for user input.

If YOLO mode:
```
✅ Phase [N] Complete: [Phase Name]
Status: [Success/Success with warnings]
→ Continuing to next phase...
```

Proceed immediately without waiting.

**STEP 8: Optional Phase Decision (Phase 1.5 - UI Mockups)**

**After Phase 1 (Specification):**

Check if UI mockups should be generated:

1. **Scan spec.md for UI-heavy keywords**:
```bash
# UI-Heavy detection keywords
keywords="show display render view visualize button form modal table card list grid dropdown menu page screen panel sidebar toolbar design layout redesign restyle"

# Scan spec
ui_heavy=false
for keyword in $keywords; do
  if grep -iq "$keyword" "$TASK_PATH/implementation/spec.md"; then
    ui_heavy=true
    break
  fi
done
```

2. **Decision logic**:

**Interactive mode**:
```
If UI-heavy keywords detected:
  🎨 UI-Heavy Feature Detected

  Keywords found: [list of detected keywords]

  Would you like to generate UI mockups showing:
  - Layout integration with existing components
  - Reusable component identification
  - Navigation pattern consistency

  Generate UI mockups? [Y/n]: _

If user confirms OR --ui-mockups flag set:
  Proceed to mockup generation
Else:
  Skip to Phase 2 (Planning)

If no UI keywords detected:
  Skip to Phase 2 (Planning)
```

**YOLO mode**:
```
If UI-heavy keywords detected:
  ✅ UI-heavy feature detected - Auto-generating mockups

  Invoke ui-mockup-generator via Task tool:
  - subagent_type: "ui-mockup-generator"
  - prompt: "Generate UI mockups for task at [task-path]"

  Wait for completion

  IF mockup generation successful:
    - Set ui_mockups_generated = true in state
    - Output: ✅ UI mockups generated
    - Continue to Phase 2

  IF mockup generation fails:
    - Log failure (mockups optional)
    - Output: ⚠️ Mockup generation failed, continuing without mockups
    - Continue to Phase 2

Else:
  ⏭️ Non-UI feature - Skipping UI mockups
  Continue to Phase 2
```

**STEP 9: Optional Phase Decision (Phases 5 & 6)**

**For E2E Testing** (after Phase 4):

Interactive mode:
```
🧪 E2E Testing Available (Optional)

Implementation and verification complete. All mandatory phases are done.

Would you like to run end-to-end browser tests using Playwright?

This is optional but recommended if:
- Feature includes UI changes
- User workflows need validation
- Acceptance criteria include user interactions

Run E2E tests? [Y/n]: _
```

YOLO mode:
```
Checking if E2E testing applicable...
[If spec mentions UI/frontend/user-facing]
✅ UI feature detected - Auto-running E2E tests
[Otherwise]
⏭️ Non-UI feature - Skipping E2E tests
```

**For User Documentation** (after Phase 5 or 4):

Interactive mode:
```
📝 User Documentation Available

Would you like to generate end-user documentation?

Recommended if:
- Feature is user-facing
- New UI or workflows introduced
- Documentation needed for help center

Generate user documentation? [Y/n]: _
```

YOLO mode:
```
Checking if user docs applicable...
[If spec indicates user-facing feature]
✅ User-facing feature detected - Auto-generating docs
[Otherwise]
⏭️ Internal feature - Skipping user docs
```

### Auto-Fix Strategies

**Philosophy**: Attempt automated recovery before failing completely. Max 2-3 attempts per phase.

**Phase 1: Specification Failures**

**Scenario**: Spec verification fails (over-engineering, missing requirements, etc.)

Auto-fix approach:
1. Extract issues from verification report
2. Re-invoke specification-creator with context:
   ```
   Previous specification had issues. Please address:
   - [Issue 1]
   - [Issue 2]

   Existing files:
   - analysis/requirements.md (keep requirements)
   - implementation/spec.md (revise based on issues)
   ```
3. Max attempts: 2
4. If still failing: Report to user, halt workflow

**Phase 1.5: UI Mockup Generation Failures**

**Scenario**: Mockup generation fails (codebase unclear, no layout components found, etc.)

Auto-fix approach:
1. Log failure in state
2. Continue workflow without mockups
3. Mockups are optional - don't block workflow
4. Max attempts: 1 (don't retry - optional phase)

**Phase 2: Planning Failures**

**Scenario**: Implementation plan incomplete or dependencies incorrect

Auto-fix approach:
1. Analyze what's wrong with the plan
2. Re-invoke implementation-planner with constraints:
   ```
   Previous plan had issues:
   - [Issue description]

   Regenerate with these constraints:
   - [Constraint 1]
   - [Constraint 2]
   ```
3. Max attempts: 2
4. If still failing: Report to user, halt workflow

**Phase 3: Implementation Failures**

**Scenario A**: Specific step fails during implementation

Auto-fix approach:
1. Read error message and context
2. Re-invoke implementer with fix instructions:
   ```
   Step [X.Y] failed with error:
   [Error message]

   Retry this step with:
   - [Fix suggestion 1]
   - [Fix suggestion 2]

   Continue from step [X.Y]
   ```
3. Max attempts per step: 2
4. Max overall implementation retries: 5

**Scenario B**: Tests fail during incremental verification

Auto-fix approach:
1. Analyze test failures
2. Apply common fixes:
   - Missing imports
   - Syntax errors
   - Incorrect assertions
3. Re-run tests
4. Max attempts per task group: 3
5. If critical failures persist: Document and continue (will be caught in Phase 4)

**Phase 4: Verification Failures**

**Scenario A**: Test suite has failures

Auto-fix approach:
1. Read verification report failed tests section
2. Categorize failures:
   - Feature-related: Invoke implementer with fixes
   - Regressions: Analyze and fix
   - Pre-existing: Document and continue (don't block)
3. Re-run verification after fixes
4. Max attempts: 2

**Scenario B**: Standards compliance issues

Auto-fix approach:
1. This is documentation-only (verification is read-only)
2. Note in report for user to address
3. Don't block workflow

**Scenario C**: Documentation incomplete

Auto-fix approach:
1. Generate minimal missing documentation:
   - Update work-log.md with summary entry
   - Complete implementation/implementation-plan.md checkmarks
2. Re-run verification
3. Max attempts: 1

**Phase 5: E2E Testing Failures**

**Scenario**: E2E tests fail (UI issues, functionality broken)

Auto-fix approach:
1. Extract failing test scenarios
2. Invoke implementer with UI fix instructions:
   ```
   E2E test failed: [test name]

   Issue: [description from report]
   Screenshot: verification/screenshots/[filename]

   Fix the following:
   - [Fix 1]
   - [Fix 2]
   ```
3. Re-run E2E tests
4. Max attempts: 2
5. If still failing: Report to user (E2E is optional, don't halt)

**Phase 6: User Documentation Failures**

**Scenario**: Screenshot capture fails or application not running

Auto-fix approach:
1. If app not running: Prompt user to start app
2. If screenshots fail but app running: Generate docs without screenshots
3. Max attempts: 1
4. User docs are optional - don't block on failures

**Global Failure Handling**

If any phase exceeds max auto-fix attempts:

```
❌ Auto-fix failed after [N] attempts

Phase: [phase name]
Last error: [error description]

Options:
1. Continue workflow (skip this phase) - NOT RECOMMENDED
2. Fix manually and resume workflow
3. Stop workflow completely

State saved to: [orchestrator-state.yml]

To resume after manual fixes:
Use: /ai-sdlc:feature:resume [task-path]

What would you like to do? _
```

### Finalization

**STEP 1: Generate Workflow Summary**

Create comprehensive summary:

```markdown
# Feature Development Workflow Summary

**Feature**: [feature name]
**Task Path**: [path]
**Mode**: [Interactive/YOLO]
**Duration**: [start time] - [end time] ([duration])

## Completed Phases

1. ✅ Specification
   - Status: Success
   - Output: implementation/spec.md, analysis/requirements.md
   - Auto-fix attempts: 0

2. ✅ Planning
   - Status: Success
   - Output: implementation/implementation-plan.md
   - Task groups: [N]
   - Total steps: [M]

3. ✅ Implementation
   - Status: Success
   - Output: Implemented code, implementation/work-log.md
   - Execution mode: [Direct/Plan-Execute/Orchestrated]
   - Auto-fix attempts: [N]

4. ✅ Verification
   - Status: Passed [with Issues]
   - Test results: [P]/[T] passing ([percentage]%)
   - Standards compliance: [status]
   - Auto-fix attempts: [N]

5. [✅/⏭️] E2E Testing
   - Status: [Success/Skipped/Failed]
   - [If run] Test scenarios: [N] passed, [M] failed

6. [✅/⏭️] User Documentation
   - Status: [Success/Skipped/Failed]
   - [If run] Output: documentation/user-guide.md

## Overall Status

**Result**: ✅ Feature Complete | ⚠️ Complete with Issues | ❌ Failed

**Files Created/Modified**:
- [List key files]

**Standards Applied**:
- [List from work-log.md]

**Test Coverage**:
- Unit tests: [count]
- Integration tests: [count]
- E2E tests: [count if run]
- Total: [count] tests, [percentage]% passing

## Next Steps

1. Review all outputs in [task-path]
2. Review verification report: verification/implementation-verification.md
3. [If E2E run] Review E2E report: verification/e2e-verification-report.md
4. [If docs generated] Review user guide: documentation/user-guide.md
5. Create commit with suggested message below
6. Create pull request
7. [Optional] Deploy to staging/production

## Suggested Commit Message

```
[feat] Add [feature name]

[Brief description from spec]

Changes:
- [Key change 1]
- [Key change 2]
- [Key change 3]

Tests: [count] tests added, all passing
Standards: [standards applied]
Verification: [status]
```

## State File

Workflow state saved to:
[orchestrator-state.yml]

To review state or resume:
Use: /ai-sdlc:feature:resume [task-path]
```

**STEP 2: Update Task Metadata**

Update `metadata.yml`:

```yaml
name: [feature name]
type: new-feature
status: completed  # or review if issues exist
priority: [unchanged]
created: [unchanged]
updated: [current-timestamp]
completed: [current-timestamp]  # add this field
tags: [unchanged]
estimated_hours: [if was set]
actual_hours: [calculated from created to completed]
```

**STEP 3: Optional Roadmap Update**

Check if `.ai-sdlc/docs/project/roadmap.md` exists:

If yes:
1. Read roadmap
2. Search for matching items
3. Mark as complete with date
4. Report updates

If no:
```
Note: No roadmap found at docs/project/roadmap.md
If project uses roadmap, manually update it with this feature completion.
```

**STEP 4: Output Final Summary to User**

```
🎉 Feature Development Complete!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Feature: [feature name]
Status: [Overall status with icon]
Duration: [duration]

Phases Completed: [N]/[M]
✅ Specification
✅ Planning
✅ Implementation
✅ Verification
[✅/⏭️] E2E Testing
[✅/⏭️] User Documentation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 Location: [task-path]

📊 Key Metrics:
- Implementation steps: [N]
- Tests: [count] ([percentage]% passing)
- Files modified: [count]
- Standards applied: [count]

📄 Reports:
- Specification: implementation/spec.md
- Implementation plan: implementation/implementation-plan.md
- Work log: implementation/work-log.md
- Verification: verification/implementation-verification.md
[If E2E] - E2E tests: verification/e2e-verification-report.md
[If docs] - User guide: documentation/user-guide.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[If success]
✅ Ready to Commit & Deploy!

Next steps:
1. Review outputs in [task-path]
2. Commit changes (suggested message in workflow summary)
3. Create pull request
4. Deploy to staging/production

[If issues]
⚠️ Complete with Issues

Please review:
- [Issue 1]
- [Issue 2]

Address these issues before deployment.

[If failure]
❌ Workflow Incomplete

The following phases failed:
- [Failed phase 1]: [reason]
- [Failed phase 2]: [reason]

To resume after fixes:
/ai-sdlc:feature:resume [task-path]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Workflow summary saved to:
[task-path]/workflow-summary.md

Thank you for using the Feature Orchestrator! 🚀
```

---

## Auto-Recovery Features

| Phase | Auto-Fix Capabilities | Max Attempts |
|-------|----------------------|--------------|
| **Phase 1: Specification** | Re-generates spec addressing verification issues | 2 |
| **Phase 1.5: UI Mockup Generation** | Continue without mockups (optional phase) | 1 |
| **Phase 2: Planning** | Regenerates plan with corrected constraints | 2 |
| **Phase 3: Implementation** | Fix syntax, imports, tests, apply standards | 5 |
| **Phase 4: Verification** | Fix tests, generate docs, re-run checks | 2 |
| **Phase 5: E2E Testing** | Prompt to start app, fix UI issues | 2 |
| **Phase 6: User Docs** | Text-only fallback if screenshots fail | 1 |

**Global Failure Handling**: After max attempts exhausted, prompt user to fix manually and resume.

---

## State Management

### State File Format

Location: `.ai-sdlc/tasks/new-features/[dated-name]/orchestrator-state.yml`

```yaml
orchestrator:
  # Execution configuration
  mode: interactive  # or yolo
  started_phase: specification  # Phase where workflow began
  current_phase: implementation  # Currently executing phase

  # Phase tracking
  completed_phases:
    - specification
    - planning
  failed_phases: []  # or [{phase: "implementation", attempts: 3, error: "..."}]

  # Auto-fix tracking
  auto_fix_attempts:
    specification: 0
    ui_mockup_generation: 0
    planning: 0
    implementation: 2
    verification: 0
    e2e_testing: 0
    user_docs: 0

  # Options
  options:
    ui_mockups_enabled: false
    e2e_enabled: false
    user_docs_enabled: false
    skip_code_review: false  # For verification phase
    skip_production_check: true  # For verification phase

  # Timestamps
  created: 2025-10-26T12:00:00Z
  updated: 2025-10-26T14:30:00Z
  completed: null  # Set when workflow finishes

  # Metadata
  task_path: .ai-sdlc/tasks/new-features/2025-10-26-user-profile-editing
  feature_description: "Add user profile editing capability"

  # Phase results (stored for resume)
  phase_results:
    specification:
      status: success
      output_files:
        - implementation/spec.md
        - analysis/requirements.md
    planning:
      status: success
      output_files:
        - implementation/implementation-plan.md
      task_groups: 4
      total_steps: 18
```

### State Operations

**Read State**:
```bash
if [ -f "$TASK_PATH/orchestrator-state.yml" ]; then
  # State exists, read it
  cat "$TASK_PATH/orchestrator-state.yml"
else
  # No state, starting fresh
  echo "No existing state found"
fi
```

**Update State** (after each phase):
```yaml
# Use edit to update specific fields
# Or rewrite entire file with updated values
```

**Resume from State**:
1. Read orchestrator-state.yml
2. Check completed_phases
3. Determine next phase
4. Validate prerequisites
5. Continue from next phase

### State Reconstruction

If state file is missing or corrupted, attempt reconstruction from existing artifacts:

**Phase Detection**:
- `analysis/requirements.md` exists → Specification phase complete
- `implementation/spec.md` exists → Specification phase complete
- `implementation/implementation-plan.md` exists → Planning phase complete
- `implementation/work-log.md` exists → Implementation phase complete
- `verification/implementation-verification.md` exists → Verification phase complete
- `verification/e2e-verification-report.md` exists → E2E Testing phase complete (optional)
- `documentation/user-guide.md` exists → User Documentation phase complete (optional)

**Reconstruction Process**:
1. Check for existence of each phase's output files
2. Build list of completed phases
3. Determine current phase (first uncompleted phase in sequence)
4. Reset auto_fix_attempts to 0 (unknown from artifacts)
5. Mark state as reconstructed with medium confidence

**Limitations**: Reconstructed state lacks:
- Auto-fix attempt counts (resets to 0)
- Phase-specific results and metadata
- Exact failure history
- Options configuration (e2e_enabled, user_docs_enabled)

**Recommendation**: Always prefer original state file. Use reconstruction as fallback only.

---

## Integration Points

### Reusing Existing Skills

**specification-creator**:
- Phase 1 execution
- Creates implementation/spec.md and all specification artifacts
- Already handles adaptive workflow and verification

**implementation-planner**:
- Phase 2 execution
- Creates implementation/implementation-plan.md
- Adapts task groups based on complexity

**implementer**:
- Phase 3 execution
- Executes implementation/implementation-plan.md
- Continuous standards discovery
- Adaptive execution modes

**implementation-verifier**:
- Phase 4 execution
- Comprehensive quality assurance
- Optional code review and production checks
- Read-only verification

### Invoking Agents

**e2e-test-verifier** (Phase 5):
```
Invoke via Task tool:
subagent_type: "e2e-test-verifier"
prompt: "Run end-to-end verification for task at [task-path]"
```

**user-docs-generator** (Phase 6):
```
Invoke via Task tool:
subagent_type: "user-docs-generator"
prompt: "Generate user documentation for task at [task-path]"
```

### Standards Compliance

Throughout workflow, ensure:
- Read `.ai-sdlc/docs/INDEX.md` at initialization
- Pass standards context to implementer
- Verify standards in verification phase
- Document applied standards in workflow summary

---

## Command Integration

This skill is invoked via:

**Primary**: `/ai-sdlc:feature:new [description] [options]`
**Resume**: `/ai-sdlc:feature:resume [task-path]`

See `commands/feature/new.md` and `commands/feature/resume.md` for command specifications.

---

## Error Handling Philosophy

**Graceful Degradation**:
- Attempt auto-fix before failing
- Document issues clearly
- Provide resume capability
- Never lose progress

**User Control**:
- Interactive mode gives control at phase boundaries
- YOLO mode trusts automation but reports issues
- Can always stop and resume manually
- State preserved across sessions

**Transparency**:
- All state in orchestrator-state.yml
- All outputs in task directory
- Clear status indicators
- Detailed error messages

---

## Important Guidelines

### Orchestration Best Practices

1. **Always update state file** after each phase
2. **Respect mode settings** - don't prompt in YOLO mode
3. **Validate prerequisites** before each phase
4. **Capture all outputs** for summary and resume
5. **Handle failures gracefully** with auto-recovery
6. **Preserve user context** across phases

### Auto-Fix Boundaries

**Do auto-fix**:
- Common syntax errors
- Missing imports
- Test assertion fixes
- Standards application
- Documentation generation

**Don't auto-fix**:
- Architectural issues
- Complex logic errors
- Security vulnerabilities
- User-decision-required items

When in doubt, report and prompt rather than auto-fix.

### State Consistency

**Always ensure**:
- State file matches actual phase status
- Completed phases list is accurate
- Failed phases tracked with reasons
- Auto-fix attempt counters incremented
- Timestamps updated

**State is source of truth** for resume capability.

### Mode Differences

**Interactive Mode**:
- Wait for user input between phases
- Prompt for optional phases
- Allow phase restart
- Show detailed results

**YOLO Mode**:
- No pauses between phases
- Auto-decide optional phases
- Report but don't wait
- Streamlined output

Both modes use same underlying logic, only differ in user interaction points.

---

## Reference Files

See `references/` directory for detailed guides:

- **workflow-phases.md**: Comprehensive phase-by-phase execution guide
- **auto-fix-strategies.md**: Detailed auto-recovery patterns for each failure type
- **state-management.md**: State file format and operations reference

These references provide additional details for specific orchestration scenarios.

---

## Example Workflows

### Example 1: New Feature, Interactive Mode

```
Command: /ai-sdlc:feature:new "Add user authentication"

Output:
🚀 Feature Development Orchestrator Started
Mode: Interactive
Starting Phase: Specification

[Executes Phase 1: Specification]
✅ Specification Complete
-> Pause, show results, wait for user

[User approves]
[Executes Phase 2: Planning]
✅ Planning Complete
-> Pause, show results, wait for user

[User approves]
[Executes Phase 3: Implementation]
✅ Implementation Complete
-> Pause, show results, wait for user

[User approves]
[Executes Phase 4: Verification]
✅ Verification Complete

Prompt: Run E2E tests? [Y/n]
[User: Y]
[Executes Phase 5: E2E Testing]
✅ E2E Testing Complete

Prompt: Generate user docs? [Y/n]
[User: Y]
[Executes Phase 6: User Documentation]
✅ User Documentation Complete

[Finalization]
🎉 Feature Development Complete!
[Summary output]
```

### Example 2: New Feature, YOLO Mode

```
Command: /ai-sdlc:feature:new "Fix payment gateway timeout" --yolo

Output:
🚀 Feature Development Orchestrator Started
Mode: YOLO 🎢
Starting Phase: Specification

[Phase 1] Specification... ✅
[Phase 2] Planning... ✅
[Phase 3] Implementation... ✅ (2 auto-fixes applied)
[Phase 4] Verification... ⚠️ (minor issues found)
[Phase 5] E2E Testing... ⏭️ Skipped (non-UI feature)
[Phase 6] User Docs... ⏭️ Skipped (internal feature)

🎉 Feature Development Complete!
Status: ⚠️ Complete with Issues
[Summary output with issues to address]
```

### Example 3: Resume from Failure

```
Command: /ai-sdlc:feature:resume .ai-sdlc/tasks/new-features/2025-10-26-shopping-cart

Output:
📂 Resuming Feature Workflow

Task: Shopping cart implementation
Last phase: Implementation (failed after 3 attempts)
Completed: Specification, Planning

Options:
1. Retry implementation (auto-fix again)
2. Skip to verification (if manually fixed)
3. Restart from planning
4. Abort workflow

Choice: 2

[Executes Phase 4: Verification]
✅ Verification Complete
[Continue workflow...]
```

### Example 4: Mid-Workflow Entry

```
Command: /ai-sdlc:feature:new --from=implement

Output:
🚀 Feature Development Orchestrator Started
Mode: Interactive
Starting Phase: Implementation

Checking prerequisites...
✅ implementation/spec.md found
✅ implementation/implementation-plan.md found

[Executes Phase 3: Implementation]
[Continue workflow...]
```

### Example 5: UI-Heavy Feature with Mockups

```
Command: /ai-sdlc:feature:new "Add analytics dashboard with charts"

Output:
🚀 Feature Development Orchestrator Started
Mode: Interactive
Starting Phase: Specification

[Phase 1: Specification]
✅ Specification Complete
- 12 requirements gathered
- UI-heavy feature detected (keywords: dashboard, charts)

🎨 UI-Heavy Feature Detected

Keywords found: dashboard, charts, display, view

Would you like to generate UI mockups showing:
- Layout integration with existing components
- Reusable component identification
- Navigation pattern consistency

Generate UI mockups? [Y/n]: Y

[Phase 1.5: UI Mockup Generation]
Invoking ui-mockup-generator...
✅ UI Mockups Generated
- Located: analysis/ui-mockups.md
- Reusable components: 3 identified
- Layout structure: Sidebar + Main content
- Navigation: Added to sidebar menu

[Phase 2: Planning]
✅ Planning Complete (mockups informed component reuse)

[Phase 3: Implementation]
✅ Implementation Complete (used 2 existing components)

[Phase 4: Verification]
✅ Verification Complete

[Finalization]
🎉 Feature Complete with UI Mockups!
```

### Example 6: YOLO Mode with Auto-Mockup

```
Command: /ai-sdlc:feature:new "Add export button to user table" --yolo

Output:
🚀 Feature Development Orchestrator Started
Mode: YOLO 🎢
Starting Phase: Specification

[1/7] Specification... ✅ (15m)
  UI-heavy: Yes (keywords: button, table)
[1.5/7] UI Mockup Generation...
  ✅ UI-heavy detected - Auto-generating mockups
  ✅ Mockups generated (3m)
  Reusable: Button.tsx, Table.tsx
[2/7] Planning... ✅ (12m)
[3/7] Implementation... ✅ (45m)
[4/7] Verification... ✅ (20m)
[5/7] E2E Testing... ⏭️ Skipped (minor UI change)
[6/7] User Docs... ⏭️ Skipped (internal feature)

🎉 Feature Complete!
Status: ✅ Success
Duration: 95 minutes
UI Mockups: planning/ui-mockups.md
```

---

## Validation Checklist

Before completing workflow, verify:

✓ All phases executed or explicitly skipped
✓ State file reflects actual completion status
✓ All outputs created in expected locations
✓ Metadata.yml updated with completion
✓ Workflow summary generated
✓ User provided with clear next steps
✓ Resume capability preserved if failed
✓ Auto-fix attempts logged in state

---

## Success Criteria

Workflow is successful when:

1. ✅ All required phases complete without critical failures
2. ✅ Implementation passes verification (or passes with minor issues)
3. ✅ All tests passing (or >90% with documented failures)
4. ✅ Standards applied throughout implementation
5. ✅ Complete documentation in task directory
6. ✅ State file reflects completion
7. ✅ User has clear path to commit and deploy

Feature orchestration provides complete, auditable, resumable workflow from idea to deployment-ready code.
