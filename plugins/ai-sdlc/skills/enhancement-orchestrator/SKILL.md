---
name: enhancement-orchestrator
description: Orchestrates the complete enhancement workflow from existing feature analysis through implementation to backward compatibility verification. Handles improvements to existing features with adaptive risk assessment, targeted regression testing, and compatibility checking. Supports interactive mode (pause between phases) and YOLO mode (continuous execution). Use when enhancing, improving, or extending existing features.
---

# Enhancement Orchestrator

This skill orchestrates the complete development workflow for enhancing existing features, ensuring backward compatibility, targeted regression testing, and systematic risk assessment.

## When to Use This Skill

Use this skill when:
- Improving existing feature capabilities
- Adding functionality to existing components
- Modifying behavior of existing features
- Refactoring existing code while preserving behavior
- Extending APIs or interfaces
- Upgrading existing implementations

**DO NOT use for:**
- Completely new features (use `feature-orchestrator`)
- Bug fixes (use `bug-fix-orchestrator`)
- Pure refactoring without functional changes

## Core Principles

1. **Analyze Before Enhancing**: Understand existing implementation first
2. **Backward Compatibility**: Preserve existing functionality by default
3. **Targeted Testing**: Run 30-70% of test suite based on impact
4. **Risk Assessment**: Classify enhancement type and assess impact
5. **Gap Identification**: Compare current vs desired state explicitly
6. **Complete Workflow**: Guide through all phases systematically
7. **Progress with TodoWrite**: You MUST use TodoWrite tool for progress tracking during all workflow phases!

---

## MANDATORY Initialization (Before Any Phase Work)

**CRITICAL: You MUST complete these steps BEFORE executing any workflow phase:**

### Step 1: Create TodoWrite with All Phases

**Immediately use the TodoWrite tool** to create todos for all phases:

```
Use TodoWrite tool with todos:
[
  {"content": "Check dependencies", "status": "pending", "activeForm": "Checking dependencies"},
  {"content": "Analyze existing feature", "status": "pending", "activeForm": "Analyzing existing feature"},
  {"content": "Analyze gaps and impact", "status": "pending", "activeForm": "Analyzing gaps and impact"},
  {"content": "Generate UI mockups", "status": "pending", "activeForm": "Generating UI mockups"},
  {"content": "Create specification", "status": "pending", "activeForm": "Creating specification"},
  {"content": "Plan implementation", "status": "pending", "activeForm": "Planning implementation"},
  {"content": "Execute implementation", "status": "pending", "activeForm": "Executing implementation"},
  {"content": "Prompt verification options", "status": "pending", "activeForm": "Prompting verification options"},
  {"content": "Verify and check compatibility", "status": "pending", "activeForm": "Verifying and checking compatibility"},
  {"content": "Run E2E tests", "status": "pending", "activeForm": "Running E2E tests"},
  {"content": "Generate user documentation", "status": "pending", "activeForm": "Generating user documentation"},
  {"content": "Finalize workflow", "status": "pending", "activeForm": "Finalizing workflow"}
]
```

### Step 2: Output Initialization Summary

**Output this summary to the user:**

```
🚀 Enhancement Orchestrator Started

Enhancement: [enhancement description]
Mode: [Interactive/YOLO]
Starting Phase: [phase name]

Workflow Phases:
0. [ ] Existing Feature Analysis → existing-feature-analyzer subagent
1. [ ] Gap Analysis & Impact Assessment → gap-analyzer subagent
2. [ ] UI Mockup Generation (optional) → ui-mockup-generator subagent
3. [ ] Specification → specification-creator skill
4. [ ] Planning → implementation-planner skill
5. [ ] Implementation → implementer skill
6. [ ] Verification + Compatibility → implementation-verifier skill
7. [ ] E2E Testing (optional) → e2e-test-verifier subagent
8. [ ] User Documentation (optional) → user-docs-generator subagent
9. [ ] Finalization

State file: [task-path]/orchestrator-state.yml

[Interactive mode] You'll be prompted for review after each phase.
[YOLO mode] All phases will run continuously. Buckle up! 🎢

Starting Phase 0: Existing Feature Analysis...
```

### Step 3: Only Then Proceed to Phase 0

After completing Steps 1 and 2, proceed to Phase 0 (Existing Feature Analysis).

---

## Progress Tracking

Use `TodoWrite` to show real-time progress to the user. Create todos at workflow start, update at each phase transition.

**Phase Todos**:

| Phase | content | activeForm |
|-------|---------|------------|
| 0.5 | "Check dependencies" | "Checking dependencies" |
| 0 | "Analyze existing feature" | "Analyzing existing feature" |
| 1 | "Analyze gaps and impact" | "Analyzing gaps and impact" |
| 2 | "Generate UI mockups" | "Generating UI mockups" |
| 3 | "Create specification" | "Creating specification" |
| 4 | "Plan implementation" | "Planning implementation" |
| 5 | "Execute implementation" | "Executing implementation" |
| 5.5 | "Prompt verification options" | "Prompting verification options" |
| 6 | "Verify and check compatibility" | "Verifying and checking compatibility" |
| 7 | "Run E2E tests" | "Running E2E tests" |
| 8 | "Generate user documentation" | "Generating user documentation" |
| 9 | "Finalize workflow" | "Finalizing workflow" |

**Rules**:
- Create all phase todos at workflow start (pending)
- Mark current phase `in_progress` before execution
- Mark phase `completed` immediately after success
- Optional phases skipped: mark as `completed`
- State file remains source of truth for resume logic

## Execution Modes

### Interactive Mode (Default)
- Pauses after each major phase for user review
- Prompts for optional verification checks (code review, production readiness)
- Prompts for optional phases (E2E tests, user docs)
- Allows course correction between phases
- Best for: Complex enhancements, breaking changes, careful review

### YOLO Mode
- Runs all phases continuously without pausing
- Auto-decides on optional verification checks based on enhancement type and risk
- Auto-decides on optional phases based on enhancement type
- Reports progress but doesn't wait for approval
- Best for: Simple additive enhancements, experienced users

## Workflow Phases

### Phase 0.5: Dependency Check (If Part of Initiative)

**Purpose**: Validate dependencies if this task is part of a larger initiative

**When**: Before Phase 0 (Existing Feature Analysis), only if task has `initiative_id` in metadata.yml

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
      - Log: "All dependencies satisfied, proceeding to existing feature analysis"
      - Continue to Phase 0

**Outputs**:
- None if dependencies satisfied (continues to Phase 0)
- Updated metadata.yml with status="blocked" if dependencies not satisfied
- Error message with blocking dependency list

**Integration**:
- Minimal change to existing workflow
- No impact on standalone tasks (skipped automatically)
- Ensures task only starts when prerequisites complete

### Phase 0: Existing Feature Analysis (15-20 min)
**Agent**: `ai-sdlc:existing-feature-analyzer` (subagent)

**Purpose**: Locate and analyze existing feature before enhancing

**Actions**:
1. **Invoke existing-feature-analyzer via Task tool:**
   ```
   Use Task tool with parameters:
   - subagent_type: "ai-sdlc:existing-feature-analyzer"
   - description: "Analyze existing feature"
   - prompt: "Analyze existing feature for enhancement: [enhancement description]. Task path: [task-path]"
   ```
2. Wait for completion (subagent executes 7-phase analysis workflow independently)
3. Parse structured result (status, report_path, summary, files_found, complexity, effort_estimate)
4. Present findings to user (interactive mode) or continue (YOLO mode)
5. Handle user response: proceed / exit / review report

**What the Subagent Does**:
- Auto-detects feature files using multi-strategy search (filename, keywords, code patterns)
- Scores matches by relevance and confidence
- Analyzes functionality, dependencies, test coverage, complexity
- Creates comprehensive baseline analysis report

**Outputs**: `analysis/existing-feature-analysis.md`

**Auto-Fix**: If feature not found, subagent expands search or prompts user (max 2 attempts)

**Reference**: `agents/existing-feature-analyzer.md` (subagent details)

### Phase 1: Gap Analysis & Impact Assessment (20-30 min)
**Agent**: `gap-analyzer` (subagent)

**Purpose**: Compare current vs desired state, classify enhancement type, analyze user journey impact, ensure data lifecycle completeness

**Actions**:
1. **Invoke gap-analyzer via Task tool:**
   ```
   Use Task tool with parameters:
   - subagent_type: "ai-sdlc:gap-analyzer"
   - description: "Analyze gaps and impact"
   - prompt: "Analyze gaps for enhancement: [enhancement description]. Task path: [task-path]. Existing analysis: [analysis-path]"
   ```
2. Wait for completion (subagent executes 9-phase analysis workflow independently)
3. Parse structured result (gaps_identified, gap_count, enhancement_type, risk_level, ui_heavy, critical_issues, non_critical_issues)
4. If `gaps_identified = true`, **ALWAYS** present findings to user and prompt for scope decision
5. Handle user decision on scope (accept expanded / modify description / continue minimal / review full report / exit)

**What the Subagent Does**:
- Identifies gaps (missing, incomplete, behavioral changes)
- Classifies enhancement type: **Additive** (low risk, strict compatibility) / **Modificative** (medium-high risk, managed compatibility) / **Refactor-based** (medium-high risk, strict compatibility)
- **Performs external research** (WebSearch) when enhancement involves external standards (WCAG, OWASP), authentication methods (OAuth, JWT), or API integrations
- Performs user journey impact assessment (reachability, personas, discoverability)
- Executes data lifecycle analysis with actual codebase verification (detects orphaned operations, finds ALL touchpoints)
- Detects UI-heavy work for mockup generation
- Categorizes gaps as critical vs non-critical
- **ALWAYS recommends scope expansion when ANY gaps found** (regardless of severity)

**External Research** (automatic):
The gap-analyzer automatically performs web research when it detects:
- External standards (WCAG, OWASP, RFC, HIPAA, GDPR)
- Authentication/security methods (OAuth, JWT, SSO, SAML, MFA)
- Third-party API integrations (Stripe, Twilio, etc.)
This enriches the gap analysis with current best practices and implementation guidelines.

**Scope Expansion Handling**:
If ANY gaps detected (`gaps_identified = true`):
- **ALWAYS use AskUserQuestion** to present findings and get user decision
- Show gap breakdown: X critical, Y non-critical
- Present original scope vs recommended expanded scope with detailed reasoning
- Show what's included in each severity category
- Offer options: accept expanded (all) / accept critical only / modify description / continue minimal (with warnings) / review full report / exit
- If modify: re-invoke subagent with adjusted description (max 2 attempts)
- Update orchestrator state with decision

**Key Principle**: Never proceed with minimal scope automatically when gaps exist. User must explicitly choose to continue with incomplete implementation.

**Example AskUserQuestion Prompt**:
```
Question: "Gap analysis found 5 issues (2 critical, 3 non-critical). How should we proceed with the scope?"

Header: "Scope Decision"

Options:
1. "Expand scope (all gaps)" - Include all 5 identified gaps in implementation
   Description: "Implement complete solution addressing all critical and non-critical gaps. Ensures feature completeness and better UX. Estimated +40% effort."

2. "Expand scope (critical only)" - Include only 2 critical gaps
   Description: "Address critical gaps (orphaned operations, safety issues) but skip non-critical enhancements. Functional but not optimal. Estimated +20% effort."

3. "Keep minimal scope (with warnings)" - Original scope only, skip all gaps
   Description: "Proceed with original request only. WARNING: Will result in incomplete/orphaned functionality. User must explicitly acknowledge risks."

4. "Modify description" - Adjust enhancement description and re-analyze
   Description: "Refine the enhancement description to better match your intent. Will re-run gap analysis."

5. "Review full report" - Open analysis/gap-analysis.md for details
   Description: "View complete gap analysis with evidence, touchpoints, and recommendations before deciding."

Multi-select: false

Show breakdown:
- Critical gaps: Orphaned display (no input mechanism), Missing from prescription workflow (safety)
- Non-critical gaps: Missing from search results, Missing from dashboard, No bulk operations

Original scope: "Display allergy info on patient summary"
Recommended scope: "Complete allergy management with input + display in 5 key touchpoints"
```

**Outputs**: `analysis/gap-analysis.md`

**Auto-Fix**: Re-analyze or prompt user if classification unclear (max 2 attempts)

**Reference**: `agents/gap-analyzer.md` (subagent details)

### Phase 2: UI Mockup Generation (Optional, 15-25 min)
**Agent**: `ui-mockup-generator` (subagent)

**Purpose**: Generate ASCII mockups showing how new UI integrates with existing layout

**Triggered When**:
- ui_heavy flag is true from Phase 1, OR
- User confirms during Phase 1 review

**Actions**:
1. Check ui_heavy flag from gap analysis
2. If true (or user confirms), invoke ui-mockup-generator subagent
3. Wait for mockup generation
4. If fails, continue without mockups (optional phase)

**Outputs**: `analysis/ui-mockups.md` (ASCII diagrams, component reuse plan, integration points)

**Reference**: `agents/ui-mockup-generator.md`

### Phase 3: Specification (Enhanced)
**Skill**: `specification-creator` (enhanced context)

**Actions**:
1. Pass existing analysis + gap analysis to spec creator
2. Include current state and desired state sections
3. Add compatibility requirements
4. Add implementation constraints from gap analysis
5. Create enhanced specification

**Outputs**:
- `implementation/spec.md` - Enhanced specification with compatibility requirements
- `implementation/requirements.md` - Requirements gathering results

**Auto-Fix Strategy**:
- If spec verification fails: Re-invoke with issues
- Max attempts: 2

### Phase 3.5: Specification Audit (Run Automatically)
**Agent**: `spec-auditor` (subagent)

**Purpose**: Verify enhancement specification completeness before implementation

**Triggered When**: Always after Phase 3 (Specification) - runs automatically in both Interactive and YOLO modes

**Actions**:
1. Invoke spec-auditor via Task tool with implementation/spec.md path
2. Verify enhancement scope is clear and gap analysis is complete
3. Check compatibility requirements are specified
4. If critical issues found: Pause for resolution
5. If minor issues: Note and continue

**Outputs**:
- `verification/spec-audit.md` - Audit findings and recommendations

**Auto-Fix Strategy**:
- If ambiguities found: Highlight specific sections needing clarification
- Max attempts: 1 (prompt user if unresolved)

### Phase 4: Planning (Enhanced)
**Skill**: `implementation-planner` (enhanced context)

**Actions**:
1. Pass spec + gap analysis to implementation planner
2. Include targeted regression test selection
3. Add preservation requirements
4. Create implementation plan with targeted testing

**Outputs**:
- `implementation/implementation-plan.md` - Plan with targeted testing strategy

**Targeted Testing**: 30-70% of test suite based on impact:
- **Tier 1 (Direct)**: Tests for modified files - ALWAYS RUN
- **Tier 2 (Integration)**: Integration tests - RUN if scope > small
- **Tier 3 (Domain)**: All domain tests - RUN if scope = large

**Auto-Fix Strategy**:
- If planning incomplete: Regenerate with constraints
- Max attempts: 2

**Reference**: `references/targeted-regression-testing.md`

### Phase 5: Implementation
**Skill**: `implementer`

**Standards Reminder**: The implementer skill reads `.ai-sdlc/docs/INDEX.md` for continuous standards discovery throughout execution. Ensure relevant standards context from previous phases is available.

**Actions**:
1. Execute implementation/implementation-plan.md step by step
2. Continuous standards discovery from docs/INDEX.md
3. Test-driven approach (write tests → implement → verify)
4. Run targeted regression tests incrementally

**Outputs**:
- Implemented code changes
- Updated `implementation/implementation-plan.md` (all steps complete)
- `implementation/work-log.md` - Activity log

**Auto-Fix Strategy**:
- If step fails: Re-run with error context (max 3 attempts per group)
- If tests fail: Analyze and fix
- Max overall retries: 5

### Phase 5.5: Optional Verification Checks Prompt
**Purpose**: Determine which optional verification checks to run

**Triggered When**: After Phase 5 (Implementation) complete, before Phase 6 (Verification + Compatibility)

**Actions**:

1. **Analyze implementation for recommendation signals**:

   Gather data from completed implementation:
   - Files modified count (from work-log.md or git diff)
   - Critical files touched: auth, payment, security, database (check file paths)
   - Enhancement type: from gap-analysis.md (additive/modificative/refactor-based)
   - Complexity: from planning phase (implementation-plan.md task groups count)
   - Deployment target: from metadata.yml or default to "production"
   - Risk level: from gap-analysis.md

2. **Determine recommendation level for each check**:

   **Code Review Recommendation**:
   ```
   # For enhancements, code review is always recommended (modificative changes are risky)
   IF enhancement_type == "modificative" OR enhancement_type == "refactor-based":
     recommendation = "strongly_recommended"
     reason = "All modificative/refactor enhancements should have code review"
   ELSE IF files_modified >= 10 OR critical_files_modified.length > 0 OR complexity == "high" OR risk_level == "high":
     recommendation = "strongly_recommended"
     reason = "{N} files modified" OR "Includes critical file changes" OR "High complexity/risk"
   ELSE:
     recommendation = "recommended"
     reason = "Enhancement workflows benefit from code review"
   ```

   **Production Readiness Recommendation**:
   ```
   IF deployment_target == "production" AND (user_facing == true OR infrastructure_changes == true OR enhancement_type == "modificative"):
     recommendation = "strongly_recommended"
     reason = "Production deployment + modificative changes" OR "Infrastructure changes detected"
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
      Description: "Run basic verification only (implementation plan, tests, standards, docs, compatibility). Faster but less comprehensive."
   ```

   **YOLO Mode**:

   Auto-decide without prompting:
   ```
   # For enhancements, always enable code review (no "optional" tier anymore)
   code_review_enabled = true
   code_review_scope = "all"
   Output: "✅ Auto-enabling code review (recommended for all enhancements)"

   IF production_readiness_recommendation == "strongly_recommended":
     production_check_enabled = true
     production_check_target = "production"
     Output: "✅ Auto-enabling production readiness (strongly recommended: {reason})"
   ELSE:
     production_check_enabled = false
     Output: "⏭️ Skipping production readiness (not critical for this enhancement)"

   # Reality assessment and pragmatic review are always enabled for enhancements
   pragmatic_review_enabled = true
   reality_check_enabled = true
   Output: "✅ Auto-enabling reality assessment + pragmatic review (mandatory for enhancements)"
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
       pragmatic_review_enabled: true      # Always true for enhancements
       reality_check_enabled: true          # Always true for enhancements
   ```

6. **Output confirmation**:

   ```
   ✅ Verification Configuration

   Will run:
   - ✅ Basic Verification (implementation plan, tests, standards, docs)
   - ✅ Compatibility Verification (backward compatibility checks)
   - ✅ Reality Assessment (always enabled for enhancements)
   - ✅ Pragmatic Review (always enabled for enhancements)
   [If code_review_enabled]
   - ✅ Code Review (Scope: {scope})
   [If production_check_enabled]
   - ✅ Production Readiness Check (Target: {target})

   Proceeding to Phase 6: Verification + Compatibility...
   ```

**Outputs**:
- Updated `orchestrator-state.yml` with verification options
- Verification configuration logged

**Auto-Fix Strategy**:
- N/A - This is a decision phase, not an execution phase

### Phase 6: Verification + Compatibility
**Skill**: `implementation-verifier` + Compatibility checks

**Actions**:
1. Read verification options from orchestrator-state.yml (set in Phase 5.5)
2. Run standard verification (plan completion, full test suite, standards)
3. **Backward Compatibility Verification**:
   - Default behavior test (component works without new features)
   - API compatibility (existing usage patterns compile)
   - Existing usage patterns (test all real-world usages)
   - Console warnings check
   - Snapshot comparison
4. Optional: Code review (if code_review_enabled == true from orchestrator state)
5. Optional: Production readiness check (if production_check_enabled == true from orchestrator state)
6. **Targeted Regression Testing**: Run comprehensive targeted test suite
7. Create verification + compatibility report

**Note**: implementation-verifier will NOT prompt the user because orchestrator already decided in Phase 5.5

**Outputs**:
- `verification/implementation-verification.md` - Comprehensive report
- Status: ✅ Passed | ⚠️ Passed with Issues | ❌ Failed

**Auto-Fix Strategy**:
- If tests fail: Invoke implementer with fixes (max 2 attempts)
- If compatibility fails: Report (verification is read-only)
- Max attempts: 3

**Reference**: `references/compatibility-verification.md`

### Phase 6a: Reality Check (Run Automatically)
**Agent**: `reality-assessor` (subagent)

**Purpose**: Validate enhancement works in context of existing feature

**Triggered When**: Always after Phase 6 (Verification + Compatibility) - runs automatically in both Interactive and YOLO modes

**Actions**:
1. Invoke reality-assessor via Task tool with task directory path
2. Test backward compatibility in real user workflows
3. Verify enhancement integrates properly with existing feature
4. Check user workflows still function as expected
5. Assess if enhancement solves the stated problem without breaking existing behavior

**Outputs**:
- `verification/reality-check.md` - Reality assessment with GO/NO-GO recommendation

**Critical Failure Handling**:
- If reality-check returns NO-GO in YOLO mode: Pause workflow
- In interactive mode: Show results and prompt user decision

### Phase 6b: Pragmatic Review (Run Automatically)
**Agent**: `code-quality-pragmatist` (subagent)

**Purpose**: Ensure enhancement doesn't over-complicate existing code

**Triggered When**: Always after Phase 6a (Reality Check) - runs automatically in both Interactive and YOLO modes

**Actions**:
1. Invoke code-quality-pragmatist via Task tool with implementation paths
2. Check for scope creep and unnecessary abstractions
3. Verify enhancement matches project scale
4. Identify if enhancement added excessive complexity
5. Recommend simplifications if needed

**Outputs**:
- `verification/pragmatic-review.md` - Over-engineering assessment with simplification recommendations

**Critical Failure Handling**:
- If CRITICAL over-engineering found in YOLO mode: Continue with warning (non-blocking)
- In interactive mode: Show findings for user review

### Phase 7: E2E Testing (Optional)
**Agent**: `e2e-test-verifier`

**Triggered When**:
- Interactive mode: Prompt user after Phase 6
- YOLO mode: Auto-run if spec mentions UI/frontend
- Explicit flag: `--e2e` in command

**Actions**:
1. Execute browser-based tests from spec
2. Capture screenshots as evidence
3. Create E2E verification report

**Outputs**:
- `verification/e2e-verification-report.md`
- `verification/screenshots/` - Evidence screenshots

**Auto-Fix Strategy**:
- If E2E tests fail: Invoke implementer with UI fixes (max 2 attempts)

### Phase 8: User Documentation (Optional)
**Agent**: `user-docs-generator`

**Triggered When**:
- Interactive mode: Prompt user after Phase 7 (or 6 if E2E skipped)
- YOLO mode: Auto-run if user-facing feature
- Explicit flag: `--user-docs` in command

**Actions**:
1. Generate user guide with "What's New" section
2. Capture UI screenshots with Playwright
3. Write non-technical documentation

**Outputs**:
- `documentation/user-guide.md`
- `documentation/screenshots/` - Step-by-step screenshots

**Auto-Fix Strategy**:
- If screenshot capture fails: Document without screenshots
- Max attempts: 1

### Phase 9: Finalization
**Actions**:
1. Create comprehensive workflow summary
2. Update task metadata status to "completed"
3. Optionally update roadmap
4. Provide commit message template
5. Guide next steps

**Outputs**:
- Workflow summary report
- Updated `metadata.yml`
- Commit message template

---

## Output Directory Structure

All workflow artifacts are organized in the task directory. This structure is used regardless of how the skill is invoked (via command, direct skill invocation, or orchestrator):

```
.ai-sdlc/tasks/enhancements/YYYY-MM-DD-enhancement-name/
├── metadata.yml                           # Task metadata and tracking
├── orchestrator-state.yml                 # Workflow state (pause/resume)
├── analysis/
│   ├── existing-feature-analysis.md      # Phase 0 output
│   ├── gap-analysis.md                   # Phase 1 output
│   └── ui-mockups.md                     # Phase 2 output (optional)
├── implementation/
│   ├── spec.md                           # Phase 3 output
│   ├── requirements.md                   # Phase 3 output
│   ├── implementation-plan.md            # Phase 4 output
│   └── work-log.md                       # Phase 5 output
├── verification/
│   ├── implementation-verification.md    # Phase 6 output
│   └── e2e-verification-report.md        # Phase 7 output (optional)
└── documentation/
    ├── user-guide.md                     # Phase 8 output (optional)
    └── screenshots/                       # User guide screenshots
```

**Directory Purpose**:
- `analysis/` - Feature analysis and gap analysis results (Phases 0-2)
- `implementation/` - Specification, requirements, implementation plan, and work log (Phases 3-5)
- `verification/` - Verification reports and test results (Phases 6-7)
- `documentation/` - User-facing documentation (Phase 8)

**Key Files**:
- `metadata.yml` - Task metadata (status, priority, tags, time tracking)
- `orchestrator-state.yml` - Workflow state for pause/resume capability
- `spec.md` - Main specification document (WHAT to build)
- `implementation-plan.md` - Implementation steps breakdown (HOW to build)
- `work-log.md` - Chronological activity log

---

## Orchestrator Workflow Execution

### Initialization

**STEP 1: Parse Command Arguments**

Extract from invocation:
- Enhancement description (if provided)
- Execution mode: `--yolo` flag or default interactive
- Entry point: `--from=phase` (analysis, gap, spec, plan, implement, verify)
- Optional phase flags: `--e2e`, `--user-docs`
- Task path: If resuming existing task

**STEP 2: Determine Starting Phase**

**If task path provided** (resuming):
1. Read `orchestrator-state.yml` if exists
2. Check completed_phases
3. Determine next phase to execute
4. Validate prerequisites for that phase

**If new enhancement**:
1. Start from specified phase (`--from`) or Phase 0 (default)
2. If starting mid-workflow, validate required files exist:
   - Starting from gap: Requires analysis/existing-feature-analysis.md
   - Starting from spec: Requires analysis/gap-analysis.md
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
1. Start from beginning (Phase 0: Existing Feature Analysis)
2. Provide/create missing files manually
3. Specify different entry point with --from

Which option would you like?
```

**STEP 3: Initialize State Management**

Create/update `orchestrator-state.yml`:

**Determine intelligent defaults for optional phases:**

```
IF --e2e flag provided:
  e2e_enabled = true
ELSE IF --no-e2e flag provided:
  e2e_enabled = false
ELSE:
  e2e_enabled = null  # Will be decided after Phase 1 based on ui_heavy flag and frontend file detection

IF --user-docs flag provided:
  user_docs_enabled = true
ELSE IF --no-user-docs flag provided:
  user_docs_enabled = false
ELSE:
  user_docs_enabled = null  # Will be decided after Phase 1 based on ui_heavy flag and user-facing detection
```

```yaml
orchestrator:
  mode: interactive  # or yolo
  started_phase: analysis  # or gap, spec, plan, implement, verify
  current_phase: analysis
  completed_phases: []
  failed_phases: []
  auto_fix_attempts:
    analysis: 0
    gap_analysis: 0
    specification: 0
    planning: 0
    implementation: 0
    verification: 0
    e2e_testing: 0
  options:
    e2e_enabled: null  # null = auto-decide, true = force run, false = force skip
    user_docs_enabled: null  # null = auto-decide, true = force run, false = force skip
  enhancement_context:
    type: null  # additive, modificative, refactor-based
    risk_level: null
    compatibility_level: null
    targeted_tests: []
  created: 2025-10-27T12:00:00Z
  updated: 2025-10-27T12:00:00Z
  task_path: .ai-sdlc/tasks/enhancements/2025-10-27-enhancement-name
```

**STEP 4: Output Initialization Summary**

```
🚀 Enhancement Orchestrator Started

Enhancement: [enhancement description]
Mode: [Interactive/YOLO]
Starting Phase: [phase name]

Workflow Phases:
0. [x] Existing Feature Analysis - [Starting here / Already complete / Pending]
1. [ ] Gap Analysis & Impact Assessment
1.5 [ ] UI Mockup Generation (optional) - [Enabled / Will prompt / Disabled]
2. [ ] Specification
3. [ ] Planning
4. [ ] Implementation
5. [ ] Verification + Compatibility
6. [ ] E2E Testing (optional) - [Enabled / Will prompt / Disabled]
7. [ ] User Documentation (optional) - [Enabled / Will prompt / Disabled]
8. [ ] Finalization

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

**For Phases 0-1** (Subagent execution via Task tool):
```
Invoke specialized subagents via Task tool:
- Phase 0: existing-feature-analyzer subagent (subagent_type: "ai-sdlc:existing-feature-analyzer")
- Phase 1: gap-analyzer subagent (subagent_type: "ai-sdlc:gap-analyzer")
```

**For Phase 1.5** (Agent - Optional):
```
Check if UI mockups should be generated:

IF ui_heavy flag is true (from Phase 1) OR user confirms:
  Invoke ui-mockup-generator via Task tool:
  - subagent_type: "ui-mockup-generator"
  - prompt: "Generate UI mockups for task at [task-path]"
  - Pass task path and context
  - Capture output

  IF mockup generation successful:
    - Set ui_mockups_generated = true in state
    - Continue to Phase 2
  ELSE:
    - Log failure (mockups optional)
    - Continue to Phase 2 (don't block workflow)

ELSE:
  Skip Phase 1.5, continue to Phase 2
```

**For Phases 2-5** (Skills):
```
Invoke skill via Skill tool:
- specification-creator for Phase 2
- implementation-planner for Phase 3
- implementer for Phase 4
- implementation-verifier for Phase 5

Pass enhancement context (existing analysis, gap analysis, etc.)
Capture output and results.
```

**For Phases 6-7** (Agents):
```
Invoke agent via Task tool with subagent_type:
- e2e-test-verifier for Phase 6
- user-docs-generator for Phase 7

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
- Execute auto-fix strategy

**STEP 6: Update State After Phase**

If success:
```yaml
orchestrator:
  completed_phases:
    - [phase-name]
  enhancement_context:  # Update with phase results
    type: [additive/modificative/refactor-based]  # from Phase 1
    risk_level: [low/medium/high]  # from Phase 1
    compatibility_level: [strict/moderate/flexible]  # from Phase 1
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

[If Phase 1 complete, show classification]
📊 Enhancement Classification:
- Type: [Additive/Modificative/Refactor-based]
- Risk: [Low/Medium/High]
- Compatibility: [Strict/Moderate/Flexible]

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

**STEP 8: Optional Phase Decision (Phases 6 & 7)**

After Phase 5 (Verification), decide whether to run E2E testing and user documentation phases.

**Auto-Detection Signals:**

Analyze these factors to determine recommendation level (strongly_recommended / recommended / optional):

*For E2E Testing:*
- ui_heavy flag from gap analysis
- Frontend files modified (components/, pages/, ui/, views/)
- Spec mentions UI/interaction keywords
- Enhancement type (modificative + frontend changes = higher priority)

*For User Documentation:*
- ui_heavy flag from gap analysis
- User-facing keywords in spec
- Frontend files modified
- Enhancement type (additive/modificative = higher priority than refactor-based)

**Override Flags:**
- --e2e / --no-e2e: Force enable/skip E2E testing
- --user-docs / --no-user-docs: Force enable/skip user documentation

**Interactive Mode:**
- ALWAYS prompt user with recommendation level and reasoning
- Show detected signals and confidence
- Make acceptance easy for recommended phases ([Y/n] vs [y/N])

**YOLO Mode:**
- Auto-run if recommended or strongly recommended (conservative: when in doubt, run tests)
- Only skip if clearly optional (no UI indicators, backend-only changes)

### Finalization

**STEP 1: Generate Workflow Summary**

Create comprehensive summary similar to feature-orchestrator but include:
- Enhancement type classification
- Compatibility verification results
- Targeted regression test results
- Breaking changes (if any)

**STEP 2: Update Task Metadata**

Update `metadata.yml` with completion timestamp.

**STEP 3: Optional Roadmap Update**

Check and update `.ai-sdlc/docs/project/roadmap.md` if exists.

**STEP 4: Output Final Summary to User**

```
🎉 Enhancement Complete!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enhancement: [enhancement name]
Type: [Additive/Modificative/Refactor-based]
Risk: [Low/Medium/High]
Status: [Overall status with icon]
Duration: [duration]

Phases Completed: [N]/[M]
✅ Existing Feature Analysis
✅ Gap Analysis & Impact Assessment
✅ Specification
✅ Planning
✅ Implementation
✅ Verification + Compatibility
[✅/⏭️] E2E Testing
[✅/⏭️] User Documentation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 Location: [task-path]

📊 Key Metrics:
- Enhancement type: [Additive/Modificative/Refactor-based]
- Compatibility: [100% backward compatible / Managed changes]
- Targeted tests: [count] ([percentage]% of suite)
- Full test suite: [count] tests ([percentage]% passing)
- Files modified: [count]
- Standards applied: [count]

📄 Reports:
- Feature analysis: analysis/existing-feature-analysis.md
- Gap analysis: analysis/gap-analysis.md
- Specification: implementation/spec.md
- Implementation plan: implementation/implementation-plan.md
- Work log: implementation/work-log.md
- Verification + Compatibility: verification/implementation-verification.md
[If E2E] - E2E tests: verification/e2e-verification-report.md
[If docs] - User guide: documentation/user-guide.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[If backward compatible]
✅ 100% Backward Compatible - Ready to Commit & Deploy!

[If breaking changes]
⚠️ Breaking Changes Detected

Migration required:
- [Change 1]
- [Change 2]

See gap-analysis.md for migration guide.

Next steps:
1. Review outputs in [task-path]
2. [If breaking] Review and apply migration guide
3. Commit changes (suggested message in workflow summary)
4. Create pull request
5. Deploy to staging/production

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Workflow summary saved to:
[task-path]/workflow-summary.md

Thank you for using the Enhancement Orchestrator! 🚀
```

---

## State Management

**State File**: `.ai-sdlc/tasks/enhancements/[dated-name]/orchestrator-state.yml`

**Purpose**: Enables pause/resume capability, progress tracking, and auto-recovery across sessions.

### State File Format

Complete state file structure:

```yaml
orchestrator:
  version: 1.0.0
  mode: interactive  # or yolo
  status: in_progress  # or completed, failed
  current_phase: implementation
  completed_phases:
    - analysis
    - gap_analysis
    - specification
    - planning
  failed_phases: []
  auto_fix_attempts:
    analysis: 0
    gap_analysis: 0
    specification: 0
    planning: 0
    implementation: 2
    verification: 0
  enhancement_context:
    type: additive  # or modificative, refactor-based
    risk_level: low  # or medium, high
    ui_heavy: false
    targeted_tests: []
    files_analyzed: 3
    breaking_changes: false
  external_research:  # from Phase 1 gap-analyzer
    performed: false
    category: null  # version_upgrade|technology_migration|external_standards|auth_security|api_integration|architecture
    depth: null     # essential|expanded
    breaking_changes: []
    migration_guide_url: null
    confidence: null  # high|medium|low
  options:
    from: analysis
    e2e_enabled: null  # null = auto-detect, true/false = explicit
    user_docs_enabled: null
    yolo: false
  phase_results:
    analysis:
      status: completed
      files_analyzed: 3
      complexity: medium
    gap_analysis:
      status: completed
      enhancement_type: additive
      ui_heavy: false
    # ... other phases
  timestamps:
    started: 2025-10-27T09:00:00Z
    updated: 2025-10-27T14:30:00Z
  task_path: .ai-sdlc/tasks/enhancements/2025-10-27-add-sorting
```

### State Operations

**Save State**: After each phase completion/failure
**Load State**: At workflow start (new or resume)
**Update State**: During phase execution for progress tracking

### State Reconstruction

If state file is missing or corrupted, attempt reconstruction from existing artifacts:

**Phase Detection**:
- `analysis/existing-feature-analysis.md` exists → Phase 0 complete
- `analysis/gap-analysis.md` exists → Phase 1 complete
- `analysis/ui-mockups.md` exists → Phase 1.5 complete (optional)
- `implementation/spec.md` exists → Phase 2 complete
- `implementation/implementation-plan.md` exists → Phase 3 complete
- `implementation/work-log.md` exists → Phase 4 complete
- `verification/implementation-verification.md` exists → Phase 5 complete
- `verification/e2e-verification-report.md` exists → Phase 6 complete (optional)
- `documentation/user-guide.md` exists → Phase 7 complete (optional)

**Reconstruction Process**:
1. Check for existence of each phase's output files
2. Build list of completed phases
3. Determine current phase (first uncompleted phase in sequence)
4. Reset auto_fix_attempts to 0 (unknown from artifacts)
5. Mark state as reconstructed with medium confidence

**Limitations**: Reconstructed state lacks:
- Auto-fix attempt counts (resets to 0)
- Enhancement context details (type, risk_level)
- Phase-specific results and metadata
- Exact failure history

**Recommendation**: Always prefer original state file. Use reconstruction as fallback only.

---

## Auto-Recovery Features

| Phase | Auto-Fix Capabilities | Max Attempts |
|-------|----------------------|--------------|
| **Phase 0: Feature Analysis** | Expand search patterns, prompt user for files | 2 |
| **Phase 1: Gap Analysis** | Re-analyze, ask user to classify enhancement type | 2 |
| **Phase 2: UI Mockup Generation** | Continue without mockups (optional phase) | 1 |
| **Phase 3: Specification** | Regenerate spec addressing issues | 2 |
| **Phase 4: Planning** | Regenerate plan with corrected constraints | 2 |
| **Phase 5: Implementation** | Fix syntax, imports, tests, apply standards | 5 |
| **Phase 6: Verification** | Fix tests, re-run compatibility checks | 3 |
| **Phase 7: E2E Testing** | Prompt to start app, fix UI issues | 2 |
| **Phase 8: User Docs** | Text-only fallback if screenshots fail | 1 |

**Global Failure Handling**: After max attempts exhausted, prompt user to fix manually and resume.

---

## Integration Points

**Reused Skills**: specification-creator (Phase 3), implementation-planner (Phase 4), implementer (Phase 5), implementation-verifier (Phase 6)

**Invoked Subagents**: existing-feature-analyzer (Phase 0), gap-analyzer (Phase 1), ui-mockup-generator (Phase 2, optional), e2e-test-verifier (Phase 7, optional), user-docs-generator (Phase 8, optional)

**Standards Discovery**: Read `.ai-sdlc/docs/INDEX.md` throughout workflow, pass to implementer, verify in verification phase

**Commands**: `/ai-sdlc:enhancement:new` (start), `/ai-sdlc:enhancement:resume` (resume)

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
6. **Preserve enhancement context** across phases (type, risk, compatibility)

### Auto-Fix Boundaries

**Do auto-fix**:
- Feature file detection issues
- Classification uncertainties (ask user)
- Common syntax errors
- Missing imports
- Test assertion fixes
- Standards application

**Don't auto-fix**:
- Architectural issues
- Complex logic errors
- Security vulnerabilities
- Breaking compatibility without user approval

When in doubt, report and prompt rather than auto-fix.

### State Consistency

**Always ensure**:
- State file matches actual phase status
- Completed phases list is accurate
- Failed phases tracked with reasons
- Auto-fix attempt counters incremented
- Enhancement context updated (type, risk, compatibility)
- Timestamps updated

**State is source of truth** for resume capability.

### Enhancement Type Awareness

**Key Differences by Type**:

**Additive** (Low Risk):
- Strict compatibility (100% backward compatible)
- Targeted tests: Tier 1 + Tier 2 only
- Default behavior test critical
- No breaking changes allowed

**Modificative** (Medium-High Risk):
- Moderate compatibility (managed changes)
- Targeted tests: All tiers
- Migration guide required if breaking
- Compatibility warnings expected

**Refactor-Based** (Medium-High Risk):
- Strict compatibility (behavior unchanged)
- Targeted tests: All tiers (comprehensive)
- Behavior snapshot comparison critical
- No functional changes allowed

Adapt verification rigor based on enhancement type.

---

## Reference Files

See `references/` directory for detailed algorithms:

- **existing-feature-analysis.md**: Feature auto-detection and analysis algorithms
- **gap-analysis.md**: Gap identification and enhancement type classification
- **compatibility-verification.md**: Backward compatibility testing patterns
- **targeted-regression-testing.md**: Test selection strategies and optimization

These references provide detailed implementation patterns for specific orchestration scenarios.

---

## Example Workflows

### Example 1: Additive Enhancement, Interactive Mode

```
Command: /ai-sdlc:enhancement:new "Add export button to user table"

Output:
🚀 Enhancement Orchestrator Started
Mode: Interactive
Starting Phase: Existing Feature Analysis

[Phase 0: Auto-detects UserTable.tsx]
✅ Feature Analysis Complete
Files found: src/components/UserTable.tsx (confidence: 95%)
-> Pause, show results, wait for user

[User approves]
[Phase 1: Gap Analysis]
✅ Gap Analysis Complete
Type: Additive (low risk)
Compatibility: Strict (100% backward compatible)
-> Pause, show classification, wait for user

[User approves]
[Phases 3-6: Spec → Plan → Implement → Verify + Compatibility]
✅ All phases complete

Prompt: Run E2E tests? [Y/n]
[User: Y]
[Phase 7: E2E Testing]
✅ E2E Testing Complete

Prompt: Generate user docs? [Y/n]
[User: Y]
[Phase 8: User Documentation]
✅ User Documentation Complete

[Finalization]
🎉 Enhancement Complete!
Type: Additive
Compatibility: 100% backward compatible
Ready to deploy!
```

### Example 2: Modificative Enhancement, YOLO Mode

```
Command: /ai-sdlc:enhancement:new "Change pagination from client to server" --yolo

Output:
🚀 Enhancement Orchestrator Started
Mode: YOLO 🎢
Starting Phase: Existing Feature Analysis

[Phase 0] Feature Analysis... ✅
[Phase 1] Gap Analysis... ✅
  Type: Modificative (medium-high risk)
  Compatibility: Moderate (breaking changes)
  Breaking changes detected - migration required
[Phase 2] UI Mockup... ⏭️ (non-UI enhancement)
[Phase 3] Specification... ✅
[Phase 4] Planning... ✅ (targeted tests: 45% of suite)
[Phase 5] Implementation... ✅ (3 auto-fixes applied)
[Phase 6] Verification + Compatibility... ⚠️
  Full test suite: 98% passing
  Compatibility: Breaking changes confirmed
  Migration guide required
[Phase 7] E2E Testing... ✅ (UI feature detected)
[Phase 8] User Docs... ✅ (user-facing change detected)

🎉 Enhancement Complete!
Type: Modificative
Status: ⚠️ Complete with Breaking Changes

Migration Required:
- Update pagination props (from pageSize to serverPagination)
- Modify API calls to use server-side pagination

See gap-analysis.md for migration guide.
Next steps: Review migration, commit, deploy
```

### Example 3: Resume from Failure

```
Command: /ai-sdlc:enhancement:resume .ai-sdlc/tasks/enhancements/2025-10-27-add-sorting

Output:
📂 Resuming Enhancement Workflow

Enhancement: Add sorting to user table
Last phase: Implementation (failed after 3 attempts)
Completed: Feature Analysis, Gap Analysis, Specification, Planning

Options:
1. Retry implementation (auto-fix again)
2. Skip to verification (if manually fixed)
3. Restart from planning
4. Abort workflow

Choice: 2

[Phase 6: Verification + Compatibility]
✅ Verification Complete
100% backward compatible
[Continue workflow...]
```

---

## Validation Checklist

Before completing workflow, verify:

✓ All phases executed or explicitly skipped
✓ State file reflects actual completion status
✓ Enhancement type classified and verified
✓ Compatibility verified and documented
✓ All outputs created in expected locations
✓ Metadata.yml updated with completion
✓ Workflow summary generated
✓ User provided with clear next steps
✓ Resume capability preserved if failed
✓ Breaking changes documented (if any)

---

## Success Criteria

Workflow is successful when:

1. ✅ All required phases complete without critical failures
2. ✅ Implementation passes verification (or passes with minor issues)
3. ✅ Backward compatibility verified (or breaking changes documented with migration)
4. ✅ Targeted regression tests passing (>90%)
5. ✅ Full test suite passing (>90%)
6. ✅ Standards applied throughout implementation
7. ✅ Complete documentation in task directory
8. ✅ State file reflects completion
9. ✅ User has clear path to commit and deploy

Enhancement orchestration provides complete, auditable, resumable workflow from existing feature to deployment-ready enhancement.
