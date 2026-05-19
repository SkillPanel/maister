---
name: maister:development
description: Unified orchestrator for all development tasks. ALWAYS execute when invoked — never skip for 'straightforward' tasks. Phases adapt based on detected task characteristics rather than predetermined types. Use for any development work that modifies code.
user-invocable: true
---

# Development Orchestrator

Unified workflow for all development tasks — bug fixes, enhancements, and new features. Phases activate based on context and analysis findings, not predetermined task types.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).` / `→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `AskUserQuestion` at a gate. They apply only to your discretionary clarifications.

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.

### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md` - Delegation rules, interactive mode, state schema, initialization, context passing, issue resolution

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
2. **Create Task Directory**: `.maister/tasks/development/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with task info and research reference
4. **Discover project documentation**: Read `.maister/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section. This includes predefined docs (vision, roadmap, tech-stack, architecture) AND any user-added project docs (e.g., deployment.md, api-strategy.md). Store complete list as `project_context.project_doc_paths` in state.

### Step 4: Ingest Design Context

Mockups and design artifacts become **binding inputs** to implementation when present. Auto-detect from three sources and unify under `analysis/design-context/`. Skip silently when no sources exist — non-UI tasks see no change.

**Source 1 — Product-design task path**: If the argument resolves to a `.maister/tasks/product-design/*` directory (presence of `outputs/product-brief.md` or `analysis/mockups/`):
- Copy `outputs/product-brief.md` → `analysis/design-context/brief.md`
- Copy `analysis/mockups/*` → `analysis/design-context/mockups/`

**Source 2 — Inline mockup references in task description**: Scan the task description for absolute or relative paths ending in `.html`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.pdf`, plus design-tool URLs (Figma, Sketch Cloud, Zeplin):
- For each resolvable local file: copy into `analysis/design-context/mockups/`
- For URLs: append the link to `analysis/design-context/external-links.md` (do not fetch — leave to user)

**Source 3 — Legacy locations** (resumed tasks, mid-flight migrations): If `analysis/visuals/` or `analysis/ui-mockups.md` is populated and `analysis/design-context/` does not yet exist, migrate the legacy contents into `design-context/` (visuals → `mockups/`, `ui-mockups.md` → `ascii/ui-mockups.md`).

**After ingestion** (when `design-context/` was populated):
- Generate `analysis/design-context/INDEX.md` enumerating every screen/component with stable IDs (e.g., `screen:login`, `component:user-card`) inferred from filenames and content. One row per screen/component with: id, source mockup, brief description.
- Set `task_context.design_reference` and `phase_summaries.design` (one-paragraph summary + path to INDEX.md).

**Skip if no sources detected** — proceed to phase execution without `design-context/`.

**Output**:
```
🚀 Development Orchestrator Started

Task: [description]
Directory: [task-path]

Starting Phase 1: Codebase Analysis...
```

---

## When to Use

Use for **all development tasks**: bug fixes, enhancements, new features, and any work that modifies code.

**DO NOT use for**: Performance optimization, security remediation, migrations, documentation-only, pure refactoring (use specialized orchestrators).

---

## Phase Configuration

| Phase | content | activeForm | Activation |
|-------|---------|------------|------------|
| 1 | "Analyze codebase & clarify requirements" | "Analyzing codebase & clarifying" | Always |
| 2 | "Analyze gaps & clarify scope" | "Analyzing gaps & clarifying scope" | Always |
| 3 | "Write failing test (TDD Red)" | "Writing failing test" | When `has_reproducible_defect` |
| 4 | "Generate UI mockups" | "Generating UI mockups" | When `ui_heavy` |
| 5 | "Gather requirements & create specification" | "Gathering requirements & creating specification" | Always |
| 6 | "Audit specification" | "Auditing specification" | Always (conditional) |
| 7 | "Plan implementation" | "Planning implementation" | Always |
| 8 | "Execute implementation" | "Executing implementation" | Always |
| 9 | "Verify test passes (TDD Green)" | "Verifying test passes" | When Phase 3 was executed |
| 10 | "Prompt verification options" | "Prompting verification options" | Always |
| 11 | "Verify implementation & resolve issues" | "Verifying implementation" | Always |
| 12 | "Run E2E tests" | "Running E2E tests" | When `e2e_enabled` |
| 13 | "Generate user documentation" | "Generating user documentation" | When `user_docs_enabled` |
| 14 | "Finalize workflow" | "Finalizing workflow" | Always |

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

→ **AUTO-CONTINUE** — Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 2.

---

### Phase 2: Gap Analysis & Scope Clarification

**Purpose**: Compare current vs desired state, detect task characteristics, then resolve scope/approach decisions
**Execute**:
1. Task tool - `maister:gap-analyzer` subagent
2. **Extract and store structured data from gap-analyzer result**:
   a. Read `task_characteristics` from gap-analyzer output — 5 fields: `has_reproducible_defect`, `modifies_existing_code`, `creates_new_entities`, `involves_data_operations`, `ui_heavy`
   b. Write all 5 fields to `orchestrator-state.yml` at `task_context.task_characteristics`
   c. Read `risk_level` from output and write to `task_context.risk_level`
   d. Extract phase summary (1-2 sentences) and write to `phase_summaries.gap_analysis`
   e. **SELF-CHECK**: "Did I read the 5 task_characteristics from the gap-analyzer output and write them to state? Let me re-read `orchestrator-state.yml` to verify the values match the gap-analyzer output."

**⛔ DECISION GATE** (mandatory — do NOT skip):
- Parse `decisions_needed` from gap-analyzer output
- If `decisions_needed.critical` OR `decisions_needed.important` is non-empty:
  - MUST use `AskUserQuestion` — one question per critical decision, batch important decisions into a single multi-select question
- If both are empty: Note "No scope decisions needed" in state

**SELF-CHECK** before continuing: "Did the gap-analyzer return `decisions_needed` items? If yes, did I invoke `AskUserQuestion`? If I skipped this, STOP and go back."

3. Save scope clarifications to `analysis/scope-clarifications.md`
4. **Set optional phase defaults** based on detected characteristics:
   - If `task_characteristics.ui_heavy: true` → set `options.e2e_enabled: true`, `options.user_docs_enabled: true`
   - If `task_characteristics.creates_new_entities: true` → set `options.user_docs_enabled: true`
   - Command flags (`--e2e`, `--no-e2e`, `--user-docs`, `--no-user-docs`) override these defaults

**Output**: `analysis/gap-analysis.md`, `analysis/scope-clarifications.md` (conditional)
**State**: Update `task_context.task_characteristics`, `task_context.scope_expanded`, `options.e2e_enabled`, `options.user_docs_enabled`, `phase_summaries.gap_analysis`

**Context to pass**: Risk level, codebase summary, key files, clarifications, project_doc_paths (from state)

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

The Phase 2 exit gate **always** invokes `AskUserQuestion`. The branching is over *which questions get asked*, not whether to ask:
1. If `decisions_needed.critical` or `.important` is non-empty → present the DECISION GATE questions first (see DECISION GATE block above)
2. Then **always** ask the executive-summary routing question (Phase 3 / 4 / 5 based on `task_characteristics`) shown below

Empty `decisions_needed` skips step 1 only. Step 2 is unconditional. There is no path through Phase 2 that bypasses `AskUserQuestion`.

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "The UI change is small/simple, skipping Phase 4..." — STOP. If `ui_heavy` is true, Phase 4 runs. The gap-analyzer made this assessment, not you.
- ❌ "No new screens needed, just a component..." — STOP. `ui_heavy` is a signal from the gap-analyzer. Do NOT override it with your own complexity judgment.

AskUserQuestion - Display executive summary before asking. Read `analysis/gap-analysis.md` and extract: task type detected, risk level, key characteristics enabled (TDD gates, UI mockups, E2E, user docs), scope decisions made (if any). Then read `task_context.task_characteristics` from `orchestrator-state.yml` and determine the next phase:
- If `has_reproducible_defect` is true → ask "Continue to Phase 3: TDD Red Gate?"
- If `ui_heavy` is true → ask "Continue to Phase 4: UI Mockup Generation?"
- Otherwise → ask "Continue to Phase 5: Technical Approach, Requirements & Specification?"

---

### Phase 3: TDD Red Gate (Conditional)

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from Phase 2 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Write a failing test that reproduces the defect
**Execute**: Direct - write test, verify it FAILS
**Output**: `implementation/tdd-red-gate.md`, failing test file
**State**: Update `tdd_red_passed: true`

**Skip if**: `task_characteristics.has_reproducible_defect` is false (not set by gap-analyzer)

**Critical**: Test MUST fail before implementation (proves defect exists)

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - "TDD red gate complete. Continue to Phase 4?"

---

### Phase 4: UI Mockup Generation (Conditional)

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from the preceding phase in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Generate ASCII mockups showing UI integration
**Execute**: Task tool - `maister:ui-mockup-generator` subagent
**Output**: `analysis/design-context/ascii/ui-mockups.md` + appended entries in `analysis/design-context/INDEX.md`
**State**: Update `phase_summaries.ui_mockups`, `phase_summaries.design`

**Skip if**:
- `task_characteristics.ui_heavy` is false, OR
- `analysis/design-context/mockups/` is already populated (Step 4 ingested external mockups — no need to regenerate ASCII)

**Context to pass**: Gap analysis, scope decisions, component choices, `analysis/design-context/INDEX.md` path (if exists from Step 4)

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - "UI mockups complete. Continue to Phase 5?"

---

### Phase 5: Technical Approach, Requirements & Specification

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from the preceding phase in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**⛔ ROUTING GUARD**: Read `task_context.task_characteristics` from `orchestrator-state.yml`. If `has_reproducible_defect` is true and Phase 3 is NOT in `completed_phases` → STOP, execute Phase 3 first. If `ui_heavy` is true and Phase 4 is NOT in `completed_phases` → STOP, execute Phase 4 first.

**Purpose**: Resolve technical decisions, gather specification requirements, then create comprehensive specification
**Execute**:

**Part A — Technical & Architecture Clarification (inline, conditional)**:
1. If complex task with multiple approaches: Direct - use AskUserQuestion for 3-5 technical questions
2. If multiple valid architectural approaches exist: Present 2-3 approaches via AskUserQuestion. The chosen approach is passed to specification-creator so the spec is written with the decided architecture.
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
     3. **Visual Assets**: Any mockups, wireframes, screenshots? Place in `analysis/design-context/mockups/` (or reference paths inline — Step 4 auto-ingests them)
4. Check for visual assets in `analysis/design-context/` (single source of truth — populated by Step 4 ingestion and/or Phase 4 ASCII generation):
   - If `design-context/INDEX.md` exists: note for subagent context (mockup files become binding inputs)
   - If user provides new mockups during this phase: place them in `analysis/design-context/mockups/`, regenerate `INDEX.md`
   - If not found and non-UI task: skip visual asset processing
5. Save gathered requirements to `analysis/requirements.md` with: initial description, Q&A from all rounds, similar features identified, visual assets and insights, functional requirements summary, reusability opportunities, scope boundaries, technical considerations

**Part C — Specification Creation (subagent)**:

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the specification..." — STOP. Delegate to specification-creator.
- ❌ "I'll write the spec based on requirements..." — STOP. Delegate to specification-creator.
- ❌ "The task is simple enough to spec inline..." — STOP. Simplicity is NOT a reason to skip delegation.

**INVOKE NOW** — Task tool call:

6. Task tool - `maister:specification-creator` subagent

**Context to pass to subagent**: task_path, task_description, task_characteristics, requirements_path (analysis/requirements.md), project_context_paths (INDEX.md + project_doc_paths from state — all discovered project docs), risk_level, phase_summaries (codebase_analysis, gap_analysis, clarifications, scope_clarifications, ui_mockups, design), research_context (if any), design_reference (if any — points spec-creator to `analysis/design-context/` for mockups and brief)

**SELF-CHECK**: Did you just invoke the Task tool with `maister:specification-creator`? Or did you start writing spec.md yourself? If the latter, STOP immediately and invoke the Task tool instead.

**Output**: `analysis/technical-clarifications.md` (conditional), `analysis/requirements.md`, `implementation/spec.md`
**State**: Update `task_context.tech_clarified`, `task_context.architecture_decision`, `phase_summaries.specification`

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - Display executive summary before asking. Read `implementation/spec.md` and extract: spec title, scope boundaries (what's included and excluded), number of key requirements, architecture approach chosen (if any), assumptions made. Format as brief overview then "Continue to specification audit?"

---

### Phase 6: Specification Audit (Recommended)

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from Phase 5 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Independent review of specification before implementation
**Execute**: Task tool - `maister:spec-auditor` subagent
**Output**: `verification/spec-audit.md`
**State**: Update `options.spec_audit_enabled`

**Recommended**: Always. Present spec audit as the recommended default. User can skip if they choose.

AskUserQuestion - "Run specification audit? (Recommended)" with "Yes, run audit (Recommended)" as first option

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - Display executive summary before asking. Read `verification/spec-audit.md` and extract: overall verdict (pass/pass-with-concerns/fail), issue counts by severity, top 1-2 critical findings if any. Format as brief overview then "Continue to implementation planning?"

---

### Phase 7: Implementation Planning

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from Phase 6 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Break specification into implementation steps

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the implementation plan..." — STOP. Delegate to implementation-planner.
- ❌ "I'll break this into steps..." — STOP. Delegate to implementation-planner.
- ❌ "This is simple enough to plan inline..." — STOP. Simplicity is NOT a reason to skip delegation.

**INVOKE NOW** — Task tool call:

**Execute**: Task tool - `maister:implementation-planner` subagent
**Output**: `implementation/implementation-plan.md`
**State**: Update task groups and dependencies

**Context to pass to subagent**: task_path, task_description, task_characteristics, phase_summaries (specification, gap_analysis, codebase_analysis, design), research_context (if any), design_reference (if any — when `analysis/design-context/INDEX.md` exists, planner MUST enumerate every screen/component, map task groups to them via the required `Visual References` field, and produce `implementation/visual-coverage.md` proving every screen is covered by ≥1 group)

**SELF-CHECK**: Did you just invoke the Task tool with `maister:implementation-planner`? Or did you start writing implementation-plan.md yourself? If the latter, STOP immediately and invoke the Task tool instead.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - Display executive summary before asking. Read `implementation/implementation-plan.md` and extract: number of task groups, total implementation steps, key dependencies between groups, estimated complexity. Format as brief overview then "Continue to implementation?"

---

### Phase 8: Implementation

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from Phase 7 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Execute the implementation plan

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me implement this directly..." — STOP. Delegate to implementation-plan-executor.
- ❌ "This is simple enough to code inline..." — STOP. Simplicity is NOT a reason to skip delegation.

**INVOKE NOW** — Skill tool call:

**Execute**: Skill tool - `maister:implementation-plan-executor`
**Output**: Implemented code, `implementation/work-log.md`
**State**: Update implementation progress, extract phase_summaries.implementation

**SELF-CHECK**: Did you just invoke the Skill tool with `maister:implementation-plan-executor`? Or did you start writing code yourself? If the latter, STOP immediately and invoke the Skill tool instead.

**⚠️ POST-IMPLEMENTATION CONTINUATION** — After the skill completes and returns control:
1. Read `orchestrator-state.yml` to confirm you are the orchestrator
2. Update state: add Phase 8 to `completed_phases`
3. Evaluate conditional: if `task_characteristics.has_reproducible_defect` AND Phase 3 in `completed_phases` → Phase 9, else → Phase 10

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - Display executive summary before asking. Extract from `phase_summaries.implementation` and `implementation/work-log.md`: task groups completed, files changed, test results from incremental runs, any known issues or deferred items. Format as brief overview then "Continue to verification?"

---

### Phase 9: TDD Green Gate (Conditional)

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from Phase 8 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Verify the failing test now passes
**Execute**: Direct - run the test written in Phase 3
**Output**: `implementation/tdd-green-gate.md`
**State**: Update `tdd_green_passed: true`

**Skip if**: Phase 3 was not executed

**Critical**: Test MUST pass (proves defect is fixed)

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - "TDD gate passed. Continue to Phase 10?"

---

### Phase 10: Verification Options Prompt

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from the preceding phase in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Determine which verification checks to run using tiered decision matrix
**Execute**: Direct - display plan, confirm/adjust via AskUserQuestion
**Output**: Updated state with all verification options
**State**: Set `options.code_review_enabled`, `options.pragmatic_review_enabled`, `options.reality_check_enabled`, `options.production_check_enabled`, `options.e2e_enabled`, `options.user_docs_enabled`
**Auto-set**: `skip_test_suite: true` (full test suite already passed during implementation phase; cleared before re-verification if fixes are applied)

**Step 1**: Display the verification plan:
```
Verification Plan:
  Obligatory (always run):
    ✓ Completeness check
    ✓ Test suite (skipped — passed during implementation; re-enabled after fixes)

  Recommended (adjustable):
    ✓ Code review — quality and security analysis
    ✓ Pragmatic review — detects over-engineering
    ✓ Reality check — validates work solves the problem
    ✓ Production readiness — deployment readiness checks

  Conditional:
    [✓/—] E2E browser testing — [reason]
    [✓/—] User documentation — [reason]
```

**Step 2** (3 questions):

**Q1** (always): AskUserQuestion (multi-select) — "Which standard verifications to run?"
Options: "Code review (Recommended)", "Pragmatic review (Recommended)", "Reality check (Recommended)", "Production readiness (Recommended)". All pre-selected.

**Q2** (SKIP if `options.e2e_enabled: false` and no `--e2e` flag): AskUserQuestion — "Enable E2E browser verification?" Options: "Yes (Recommended)", "No, skip".

**Q3** (SKIP if `options.user_docs_enabled: false` and no `--user-docs` flag): AskUserQuestion — "Generate user documentation?" Options: "Yes (Recommended)", "No, skip".

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

---

### Phase 11: Verification & Issue Resolution

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from Phase 10 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Comprehensive implementation verification with fix-then-reverify cycles
**Output**: `verification/implementation-verification.md`, optional code-review/pragmatic/reality reports, updated `implementation/work-log.md`
**State**: Update verification results, `verification_context`

**Execute**:

**Step 1**: Invoke Skill tool - `maister:implementation-verifier`

**Step 2**: Display detailed issue breakdown grouped by category and severity:
```
Verification Results:
  Critical ([N]):
    - [category]: [description] — [file:line] [fixable/manual]
    ...
  Warning ([N]):
    - [category]: [description] — [file:line] [fixable/manual]
    ...
  Info ([N]):
    - [description] (listed for awareness, not actionable)
```

**Step 3**: Gate on verification status:
- `status: passed` → skip to Post-Verification Continuation
- `status: passed_with_issues` or `failed` → enter user-driven fix loop (Step 4)

**Step 4**: User-driven fix loop (max 3 iterations):
1. Present all critical + warning issues as a numbered list
2. AskUserQuestion — "Which issues should I fix?" with options:
   - "Fix all fixable issues" (convenience default)
   - "Let me choose specific issues" (user picks by number)
   - "Skip fixes, proceed as-is"
3. Fix selected issues, log each to `verification_context.fixes_applied`
4. After fixes applied: set `skip_test_suite: false` (code changed, tests must re-run)
5. AskUserQuestion — "Re-run verification to check fixes?" with options:
   - "Yes, re-run verification" → re-invoke `maister:implementation-verifier` → return to Step 2
   - "No, proceed to next phase"
6. Update `verification_context.reverify_count`

**Exit conditions**:
- No critical issues remain → proceed
- User explicitly chooses "Skip fixes, proceed as-is" or "No, proceed to next phase" → proceed with issues logged
- Max 3 iterations reached → AskUserQuestion: "Proceed with known issues?" / "Stop workflow"
- **MUST NOT proceed with unresolved critical issues unless user explicitly approves**

**⚠️ POST-VERIFICATION CONTINUATION** — After issue resolution completes:
1. Read `orchestrator-state.yml` to confirm you are the orchestrator
2. Update state: add Phase 11 to `completed_phases`
3. Proceed to Phase 12

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - Display executive summary: total issues found, issues fixed, issues remaining by severity. Then "Continue to Phase 12?"

---

### Phase 12: E2E Testing (Optional)

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from Phase 11 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

> **⚠ Serialization rule**: Phases 12 and 13 share the Playwright MCP browser instance. They MUST run strictly sequentially. Do NOT dispatch the Phase 12 Task call and the Phase 13 Task call in the same assistant message, even when both are enabled. Wait for Phase 12 to return, honor the `→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).` / `AskUserQuestion` gate below, then start Phase 13. Concurrent dispatch will corrupt both browser sessions.

**Purpose**: Runtime browser verification with screenshots (via Playwright MCP tools, not test file generation)
**Execute**: Task tool - `maister:e2e-test-verifier` subagent
**Prompt must include**: task_path (absolute), spec_path, base_url. If `analysis/design-context/mockups/` exists, also include `design_context_path` so the verifier performs an LLM-judged structural visual-fidelity comparison and writes `verification/visual-fidelity.md`. Report saves to `{task_path}/verification/e2e-verification-report.md`.
**Output**: `verification/e2e-verification-report.md`, screenshots, `verification/visual-fidelity.md` (when mockups present — report-only, never gates completion)
**State**: Update E2E results; on success mark Phase 12 in `completed_phases` (Phase 13 reads this as a precondition).

**Skip if**: `options.e2e_enabled = false`

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - "E2E complete. Continue to Phase 13?"

---

### Phase 13: User Documentation (Optional)

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from the preceding phase in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

> **⚠ Serialization rule**: Phases 12 and 13 share the Playwright MCP browser instance — see the same rule on Phase 12. Phase 13 MUST NOT be dispatched in the same assistant message as Phase 12, regardless of how the user answered the gate.

**Preconditions**: If `options.e2e_enabled = true`, Phase 12 MUST be present in `completed_phases` before Phase 13 starts. If it is not yet completed (e.g., E2E is still running or failed), do not start Phase 13 — return to the Phase 12 gate.

**Purpose**: Generate user-facing documentation with screenshots
**Execute**: Task tool - `maister:user-docs-generator` subagent
**Prompt must include**: task_path (absolute), spec_path, base_url. **When Phase 12 ran successfully** (E2E enabled and completed), also include `e2e_screenshots_path: {task_path}/verification/screenshots/` together with the instruction *"Reuse applicable E2E screenshots from this directory before capturing new ones via Playwright."* When Phase 12 was skipped or failed, omit `e2e_screenshots_path` entirely. Guide saves to `{task_path}/documentation/user-guide.md`.
**Output**: `documentation/user-guide.md`, screenshots (reused from E2E run when applicable)
**State**: Update docs generation status

**Skip if**: `options.user_docs_enabled = false`

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `AskUserQuestion` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

AskUserQuestion - "Documentation complete. Continue to Phase 14?"

---

### Phase 14: Finalization

> **Phase entry self-check**: Before executing this phase, locate the `AskUserQuestion` tool call from the preceding phase in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `AskUserQuestion` call are protocol violations — never paper over a missed gate by updating state.

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
  options:
    spec_audit_enabled: true
    skip_test_suite: true
    e2e_enabled: null
    user_docs_enabled: null
    code_review_enabled: true
    pragmatic_review_enabled: true
    reality_check_enabled: true
    production_check_enabled: true
  task_context:
    risk_level: null
    clarifications_resolved: null
    scope_expanded: null
    architecture_decision: null
    task_characteristics:
      has_reproducible_defect: false
      modifies_existing_code: false
      creates_new_entities: false
      involves_data_operations: false
      ui_heavy: false
    research_reference:
      path: null
      research_question: null
      research_type: null
      confidence_level: null
    design_reference:
      source: null  # "product-design" | "inline-prompt" | "legacy-migration" | null
      product_design_path: null  # set when Source 1 detected
      mockup_count: 0
      has_brief: false
      index_path: null  # path to analysis/design-context/INDEX.md
    phase_summaries:
      research: {summary: null, key_findings: [], recommended_approach: null}
      design: {summary: null, screen_count: 0, component_count: 0, index_path: null}
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
.maister/tasks/development/YYYY-MM-DD-task-name/
├── orchestrator-state.yml
├── analysis/
│   ├── research-context/          # If --research provided
│   ├── design-context/            # If mockups detected (Step 4 ingestion or Phase 4 generation)
│   │   ├── mockups/               # HTML/PNG/screenshots (from product-design or inline prompt)
│   │   ├── ascii/                 # ASCII mockups from Phase 4 ui-mockup-generator
│   │   ├── brief.md               # Product brief (when ingested from product-design task)
│   │   ├── external-links.md      # Figma/Sketch/Zeplin URLs (no fetch — for reference)
│   │   └── INDEX.md               # Screen/component inventory with stable IDs
│   ├── codebase-analysis.md       # Phase 1
│   ├── clarifications.md          # Phase 1
│   ├── gap-analysis.md            # Phase 2
│   ├── scope-clarifications.md    # Phase 2 (conditional)
│   └── technical-clarifications.md # Phase 5 (conditional)
├── implementation/
│   ├── spec.md                    # Phase 5
│   ├── requirements.md            # Phase 5
│   ├── implementation-plan.md     # Phase 7
│   ├── visual-coverage.md         # Phase 7 (when design-context exists)
│   ├── work-log.md                # Phase 8
│   ├── tdd-red-gate.md            # Phase 3 (conditional)
│   └── tdd-green-gate.md          # Phase 9 (conditional)
├── verification/
│   ├── spec-audit.md              # Phase 6 (recommended)
│   ├── implementation-verification.md  # Phase 11
│   ├── e2e-verification-report.md      # Phase 12 (optional)
│   └── visual-fidelity.md              # Phase 12 (when design-context exists, report-only)
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
| `--from=PHASE` | Start from specific phase |
| `--research=PATH` | Link to completed research task |
| `--audit` / `--no-audit` | Force/skip specification audit |
| `--e2e` / `--no-e2e` | Force/skip E2E testing |
| `--user-docs` / `--no-user-docs` | Force/skip user documentation |
| `--sequential` | Disable parallel wave dispatch in the executor; run one task group at a time. Persisted as `orchestrator.options.sequential: true` in `orchestrator-state.yml` and read by `implementation-plan-executor` Phase 2. Defaults to off (parallel waves). |

---

## Research-Based Development

When starting development from a completed research task, the orchestrator loads research context to **INFORM** all phases.

### Invocation Methods

**Method 1: Research folder as sole argument** (recommended)
```
/maister:development .maister/tasks/research/2026-01-12-oauth-research
```
The orchestrator auto-detects this is a research folder and:
- Extracts task description from `research_context.research_question`
- Reads all research artifacts
- Sets `research_reference` in state

**Method 2: Explicit --research flag**
```
/maister:development "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
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

## Design-Informed Development

When mockups or design artifacts are present, they become **binding inputs** to implementation — not optional references. The `analysis/design-context/` directory unifies all visual sources (product-design output, inline prompt references, Phase 4 ASCII generation) and propagates through every downstream phase.

### Auto-Detection Sources (Step 4 of Initialization)

**Source 1 — Product-design task path** (recommended handoff):
```
/maister:development .maister/tasks/product-design/2026-05-09-user-dashboard/
```
Auto-detected when the argument resolves to a `.maister/tasks/product-design/*` directory. Brief and mockups are copied into `design-context/`.

**Source 2 — Inline mockup paths in task description**:
```
/maister:development "Implement the dashboard from /tmp/dashboard-mockup.html"
```
Auto-detected file paths (`.html`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.pdf`) are copied into `design-context/mockups/`. Design-tool URLs (Figma, Sketch Cloud, Zeplin) are recorded in `design-context/external-links.md`.

**Source 3 — Phase 4 ASCII generation**: When no external mockups exist and `task_characteristics.ui_heavy` is true, `ui-mockup-generator` produces ASCII mockups in `design-context/ascii/`.

### How Design Context Informs Each Phase

**Design INFORMS phases, never SKIPS them.** Design context passes via `task_context.phase_summaries.design` and `task_context.design_reference`.

| Phase | How Design Context is Used |
|-------|------------------------------|
| Phase 4 | Skipped if `design-context/mockups/` already populated; otherwise outputs to `design-context/ascii/` |
| Phase 5 | `specification-creator` reads from `design-context/` (single source); produces "Visual Design" section in spec.md |
| Phase 7 | `implementation-planner` enumerates screens from `design-context/INDEX.md`, attaches required `Visual References` to UI task groups, produces `implementation/visual-coverage.md` proving every screen is covered by ≥1 group |
| Phase 8 | `task-group-implementer` reads each referenced mockup before coding; layout, copy, field order, and explicit states are binding |
| Phase 12 | `e2e-test-verifier` performs LLM-judged structural visual-fidelity comparison after capturing screenshots; writes `verification/visual-fidelity.md` (report-only, never gates completion) |

### Graceful Degradation

When no mockups are detected at any source, the entire design-context machinery is skipped:
- No `design-context/` directory
- No `design_reference` in state (remains null)
- No `Visual References` field in task groups (planner omits the section entirely)
- No `visual-coverage.md` or `visual-fidelity.md`

Non-UI tasks see zero behavior change.

---

## Command Integration

Invoked via:
- `/maister:development [description] [--e2e] [--user-docs] [--research=PATH]` (new)
- `/maister:development [task-path] [--from=PHASE] [--reset-attempts]` (resume)

---

## TDD Gate Rules

**Phase 3 (Red Gate)**: Test MUST FAIL before implementation (activated when gap-analyzer detects reproducible defect)
**Phase 9 (Green Gate)**: Test MUST PASS after implementation (activated when Phase 3 was executed)
