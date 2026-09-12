---
name: performance
description: Orchestrates performance optimization workflows using static code analysis to identify bottlenecks (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks). Accepts optional user-provided profiling data. Reuses standard specification, planning, implementation, and verification phases.
user-invocable: true
---

# Performance Orchestrator

Static-analysis-first performance optimization workflow. Identifies bottlenecks by reading code, then uses the standard specification/planning/implementation/verification pipeline to fix them.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `ask_user` at a gate. They apply only to your discretionary clarifications. Invoke `ask_user` when `orchestrator.driver.kind` is absent or `terminal`; when it is `cockpit` or `dispatch` you MUST NOT ask in session — suspend the run with one `gate-request` call, which writes the request file, the gate index and `gate_pending` together, then rewrite the dashboard data, print `GATE-PENDING: <node>` as the last line and end the turn instead (`compatibility-contracts.md § E2`).

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1. The questions this workflow asks *inside* a phase follow the same driver: § 2.2 states what a non-terminal run takes instead of asking, and every one of them names its default below.

### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md` - Delegation rules, interactive mode, state schema, initialization, context passing, issue resolution

### Step 2: Initialize Workflow

1. **Capture the clock**: run `date -u +"%Y-%m-%dT%H:%M:%SZ"` via Bash NOW — you do NOT know the time from context. Every timestamp written this turn (`created`, `updated`, `generated`, `phases[].started`) uses this value. Date-only or `T00:00:00Z` values are the documented failure mode (orchestrator-patterns.md § 4 Timestamp Rule). Re-run `date` in later turns before writing timestamps.
2. **Create Task Items**: Use `TaskCreate` for all phases (see Phase Configuration), then set dependencies with `TaskUpdate addBlockedBy`
3. **Create Task Directory**: `.maister/tasks/performance/YYYY-MM-DD-task-name/`
4. **Create Subdirectories**: `analysis/`, `analysis/user-profiling-data/`, `implementation/`, `verification/`
5. **Initialize State**: Create `orchestrator-state.yml` with performance context
6. **Set up Operator Dashboard** (orchestrator-patterns.md § 8) — first read `.maister/config.yml` and set `orchestrator.options.html_output` (default true if the file/key is absent). **When `html_output` is false, SKIP this entire step** — no `dashboard.html`, no `dashboard-data.js`, no browser auto-open — and proceed. Otherwise: copy `../orchestrator-framework/assets/dashboard.html` to the task root as `dashboard.html`, write the initial `dashboard-data.js` (all phases pending, `task.type: "performance"`), then **auto-open it in the user's browser** (`open` / `xdg-open` / `start` per platform, passing the plain absolute filesystem path — NEVER a hand-built `file://` URL; on failure just print the path — never block). On resume: re-copy `dashboard.html` only if missing; regenerate `dashboard-data.js` from state; then auto-open it in the browser again (same opener as a new task — the OS focuses an already-open tab rather than duplicating).
7. **Discover project documentation**: Read `.maister/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section — includes predefined docs AND any user-added project docs. Store as `project_context.project_doc_paths` in state.

**Output**:
```
Performance Orchestrator Started

Task: [performance issue description]
Directory: [task-path]
Dashboard: open [task-path]/dashboard.html in a browser to monitor progress

Starting Phase 1: Codebase Analysis...
```

---

## Operator Visibility (applies to every phase)

> **Config gate**: these rules assume `options.html_output` is true (read from `.maister/config.yml` at init, default true). When **false**: skip the Dashboard-upkeep rule entirely (no dashboard files, no browser open, no rewrites) and the HTML-companions rule (do NOT pass `html_style_guide_path`; subagents write md only). The Artifact Summary Contract (§ 7 TL;DR blocks) and `phase_summaries` in state stay active either way.

Cross-cutting rules from `orchestrator-patterns.md` (same as the development orchestrator):

1. **Artifact Summary Contract (§ 7)**: every artifact-writing subagent prompt MUST include the contract instruction (artifacts open with TL;DR / Key Decisions / Open Questions / Risks — the writer heading is `## Open Questions / Risks`). At context extraction, lift `decisions`, `risks`, and `artifacts` into `phase_summaries.[phase]` — verbatim, never re-summarized.
2. **Dashboard upkeep (§ 8)**: rewrite `dashboard-data.js` at every phase START (mark `in_progress` before delegating), **BEFORE firing every exit gate** (register the finished phase's artifacts/summary/decisions/risks — the operator reviews them on the dashboard while answering; status stays `in_progress` until the gate passes), after every phase completion (including skipped phases, with reason), every gate decision, every verification cycle, and at finalization. Every rewrite starts with `date -u` (one call per turn). It is a terse projection of state — never duplicate artifact content into it.
3. **HTML companions (§ 9)**: pass `html_style_guide_path` (absolute path to `../orchestrator-framework/references/html-report-style.md`) to specification-creator, implementation-planner, and implementation-verifier. Register returned `html_path` values in `phase_summaries.[phase].artifacts[].html` so the dashboard hero cards link HTML first.
4. **icon_hint values** per phase: 1 `analysis`, 2 `analysis`, 3 `spec`, 4 `verify`, 5 `plan`, 6 `code`, 7 `verify`, 8 `verify`, 9 `done`.

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
1. Skill tool - `maister-codebase-analyzer`
2. Update state with analysis results
3. Direct - use ask_user for max 5 critical clarifying questions about performance concerns, hotspots, and optimization goals

**Default under a non-terminal driver** (`clarifications`): none is asked, and the analysis's own answers stand. The file is written and `clarifications_resolved` set exactly as they are for a run with nothing to ask, and what the analysis could not settle about hotspots or goals is recorded as unsettled rather than guessed at.
4. Save clarifications to `analysis/clarifications.md`
**Output**: `analysis/codebase-analysis.md`, `analysis/clarifications.md`
**State**: Update `performance_context.phase_summaries.codebase_analysis`, `task_context.clarifications_resolved`

Pass `task_type="enhancement"` and the performance-focused description. The codebase-analyzer adaptively selects parallel Explore agents based on task complexity. For performance tasks, the description should guide agents toward: database query patterns, hot code paths, I/O operations, caching layers, connection management, schema/migration files.

→ **AUTO-CONTINUE** — Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 2.

---

### Phase 2: Static Performance Analysis

**Purpose**: Identify bottlenecks through static code analysis + optional user profiling data
**Execute**: Task tool - `maister-bottleneck-analyzer` subagent
**Output**: `analysis/performance-analysis.md`
**State**: Update `performance_context.bottlenecks_identified`, `performance_context.user_data_available`, `performance_context.bottleneck_priorities`

**Process**:
1. Check if `analysis/user-profiling-data/` contains any files
2. If empty, use ask_user:
   - Question: "Do you have profiling data to provide (flame graphs, APM screenshots, slow query logs)?"
   - Options: "Yes, let me add files to analysis/user-profiling-data/" | "No, proceed with static analysis only"
3. If user chooses to add files, wait for them, then proceed

**Default under a non-terminal driver** (`profiling-data`): no profiling data, and the run proceeds on static analysis alone. Waiting for files nobody can drop is the one thing this question must not do under a driver -- the wait never ends. Say in the phase summary that the analysis was static-only, because a bottleneck list built without profiling data otherwise reads the same as one built with it.

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me analyze the bottlenecks myself..." — STOP. Delegate to bottleneck-analyzer.
- ❌ "I'll grep for N+1 patterns..." — STOP. Delegate to bottleneck-analyzer.

**INVOKE NOW** — Task tool call:

4. Task tool - `maister-bottleneck-analyzer` subagent

**Context to pass**: task_path, description, codebase analysis summary from Phase 1, user data paths (if any)

**SELF-CHECK**: Did you just invoke the Task tool with `maister-bottleneck-analyzer`? Or did you start analyzing code yourself? If the latter, STOP and invoke the Task tool.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - "Performance analysis complete. [N] bottlenecks identified ([P0 count] P0, [P1 count] P1). Continue to specification?"

---

### Phase 3: Requirements & Specification

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 2 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Gather optimization requirements and create specification
**Output**: `analysis/requirements.md`, `implementation/spec.md`
**State**: Update `performance_context.phase_summaries.specification`

**Part A — Requirements Gathering (inline)**:

1. Present bottleneck summary from Phase 2 to user
2. Use ask_user for optimization priorities:
   - Which bottleneck priorities to address? (All P0+P1, P0 only, specific ones)
   - Any constraints? (backward compatibility, memory limits, no new dependencies)
   - Performance targets? (specific response time goals, if known)
3. Save gathered requirements to `analysis/requirements.md` with: performance issue description, bottleneck analysis summary, optimization priorities, constraints, targets

**Default under a non-terminal driver** (`optimization-priorities`): the analyzer's own priorities stand -- every P0 and P1 bottleneck it identified, with no constraint and no numeric target beyond what the invocation already supplied. An invented performance target is the failure mode here: a target nobody set becomes an acceptance criterion the specification is written against.

**Part B — Specification Creation (subagent)**:

📋 **Standards Discovery**: Read `.maister/docs/INDEX.md` before creating spec.

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the specification..." — STOP. Delegate to specification-creator.
- ❌ "I'll write the spec based on the analysis..." — STOP. Delegate to specification-creator.

**INVOKE NOW** — Task tool call:

4. Task tool - `maister-specification-creator` subagent

**Context to pass**: task_path, task_type="performance", task_description, requirements_path (analysis/requirements.md), project_context_paths (INDEX.md + project_doc_paths from state — all discovered project docs), phase_summaries (codebase_analysis, bottleneck_analysis), html_style_guide_path (for the spec.html companion)

**SELF-CHECK**: Did you just invoke the Task tool with `maister-specification-creator`? Or did you start writing spec.md yourself? If the latter, STOP and invoke the Task tool.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - Display executive summary before asking. Read `implementation/spec.md` and extract: optimization targets, approach chosen, number of changes planned, expected impact. Format as brief overview then "Continue to specification audit?"

---

### Phase 4: Specification Audit (Conditional)

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 3 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Independent review of optimization specification
**Execute**: Task tool - `maister-spec-auditor` subagent
**Output**: `verification/spec-audit.md`
**State**: Update `options.spec_audit_enabled`

**Run if**: >5 optimizations planned, spec >50 lines, or user requests
**Skip if**: Simple optimization (1-3 changes)

ask_user to decide - "Run specification audit?"

**Default under a non-terminal driver** (`audit-opt-in`): the run-if criteria above decide it -- audit when more than five optimizations are planned or the specification runs past fifty lines, skip for a simple one-to-three-change optimization. The criteria are the recommendation, so with nobody to ask they are the answer, and `options.spec_audit_enabled` records it either way.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - Display executive summary before asking. Read `verification/spec-audit.md` and extract: overall verdict, issue counts by severity, top findings. Format as brief overview then "Continue to implementation planning?"

---

### Phase 5: Implementation Planning

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 4 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Break optimization specification into implementation steps

📋 **Standards Discovery**: Read `.maister/docs/INDEX.md` before planning.

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me create the implementation plan..." — STOP. Delegate to implementation-planner.
- ❌ "I'll break this into optimization steps..." — STOP. Delegate to implementation-planner.

**INVOKE NOW** — Task tool call:

**Execute**: Task tool - `maister-implementation-planner` subagent
**Output**: `implementation/implementation-plan.md`
**State**: Update task groups and dependencies

**Context to pass**: task_path, task_type="performance", task_description, phase_summaries (specification, bottleneck_analysis, codebase_analysis), html_style_guide_path (for the implementation-plan.html companion)

**SELF-CHECK**: Did you just invoke the Task tool with `maister-implementation-planner`? Or did you start writing the plan yourself? If the latter, STOP and invoke the Task tool.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - Display executive summary before asking. Read `implementation/implementation-plan.md` and extract: number of task groups, total steps, key dependencies, optimization sequence. Format as brief overview then "Continue to implementation?"

---

### Phase 6: Implementation

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 5 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Execute the optimization plan

📋 **Standards Discovery**: Implementation reads `.maister/docs/INDEX.md` continuously.

**ANTI-PATTERN — DO NOT DO THIS:**
- ❌ "Let me implement this directly..." — STOP. Delegate to implementation-plan-executor.
- ❌ "This is simple enough to code inline..." — STOP. Simplicity is NOT a reason to skip delegation.

**INVOKE NOW** — Skill tool call:

**Execute**: Skill tool - `maister-implementation-plan-executor`
**Output**: Implemented optimizations, `implementation/work-log.md`
**State**: Update implementation progress, extract phase_summaries.implementation

**SELF-CHECK**: Did you just invoke the Skill tool with `maister-implementation-plan-executor`? Or did you start writing code yourself? If the latter, STOP immediately and invoke the Skill tool instead.

**⚠️ POST-IMPLEMENTATION CONTINUATION** — After the skill completes and returns control:
1. **HTML plan reconciliation** (backstop for syncs missed during waves): if `implementation/implementation-plan.html` exists, for every group whose md checkboxes are all `[x]`, run the executor's idempotent marker-flip command (`sed` flipping `data-step="N\.[0-9]*" class="step todo"` and `data-group="N" class="group todo"` to `done`). VERIFY: when all md steps are checked, `grep -c 'class="step todo"' implementation/implementation-plan.html` must return 0.
2. Read `orchestrator-state.yml` to confirm you are the orchestrator
3. Update state: add Phase 6 to `completed_phases`
4. Proceed to Phase 7

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - Display executive summary before asking. Extract from `phase_summaries.implementation` and `implementation/work-log.md`: optimizations applied, files changed, test results, any known issues. Format as brief overview then "Continue to verification?"

---

### Phase 7: Verification Options

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 6 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Determine which verification checks to run
**Execute**: Direct - use ask_user for options
**Output**: Updated state with verification options
**State**: Set `options.code_review_enabled`, `options.pragmatic_review_enabled`, `options.production_check_enabled`, `options.reality_check_enabled`

**Always enabled**: Reality check, pragmatic review
**Auto-set**: `skip_test_suite: true` (full test suite already passed during implementation phase; cleared before re-verification if fixes are applied)

ask_user with sequential single-select - "Which additional verification checks?"
  - "Code review" (recommended)
  - "Production readiness check"

**Default under a non-terminal driver** (`standard-verifications`): the recommended selection -- code review on, production readiness off. Reality check and pragmatic review are always enabled and are not part of this question.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - "Options selected. Continue to Phase 8?"

---

### Phase 8: Verification & Issue Resolution

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 7 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Comprehensive implementation verification with user-driven fix cycles
**Output**: `verification/implementation-verification.md`, optional review reports
**State**: Update `verification_context`

**Execute**:

**Step 1**: Invoke Skill tool - `maister-implementation-verifier`

**Step 2**: Display detailed issue breakdown grouped by category and severity (critical/warning/info), listing location, description, and fixability for each.

**Step 3**: Gate on verification status:
- `status: passed` → skip to Pause
- `status: passed_with_issues` or `failed` → enter user-driven fix loop (Step 4)

**Step 4**: User-driven fix loop (max 3 iterations):
1. Present all critical + warning issues as a numbered list
2. ask_user — "Which issues should I fix?" with options: "Fix all fixable issues" / "Let me choose specific issues" / "Skip fixes, proceed as-is"
3. Fix selected issues
4. After fixes: set `skip_test_suite: false` (code changed, tests must re-run)
5. ask_user — "Re-run verification to check fixes?" with options: "Yes, re-run verification" / "No, proceed to next phase"
6. If re-run → re-invoke `maister-implementation-verifier` → return to Step 2

**Default under a non-terminal driver** (`verification-fix-loop`): fix every fixable issue, re-verify once, then continue to the gate. One re-verification is the whole budget -- a loop nobody can stop is not a loop -- and `skip_test_suite` is cleared before it exactly as an answered round clears it. An issue still critical afterwards is not proceeded past: it is named in the executive summary before this phase's exit gate, which is where an operator answers.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - Display executive summary: total issues found, issues fixed, issues remaining by severity. Then "Continue to finalization?"

---

### Phase 9: Finalization

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 8 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

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
    # Every entry also carries the shared base shape (orchestrator-patterns.md § 4):
    #   decisions: []   risks: []   artifacts: [{path, label, html}]
    codebase_analysis: {key_files: [], summary: null}
    bottleneck_analysis: {bottlenecks: [], summary: null, user_data_incorporated: false}
    specification: {summary: null}

verification_context:
  last_status: null
  issues_found: null
  fixes_applied: []
  decisions_made: []
  reverify_count: 0

# `options` lives under `orchestrator:`; `performance_context`, `verification_context`
# are its top-level siblings (compatibility-contracts.md § A1)
orchestrator:
  options:
    html_output: true  # Seeded from .maister/config.yml at init (default true). Gates dashboard + HTML companions.
    spec_audit_enabled: null
    skip_test_suite: true
    code_review_enabled: true
    pragmatic_review_enabled: true
    reality_check_enabled: true
    production_check_enabled: null
```

---

## Task Structure

The normative layout and naming rules are `../orchestrator-framework/references/compatibility-contracts.md § A4`; the tree below is this workflow's instance of them.

```
.maister/tasks/performance/YYYY-MM-DD-task-name/
├── orchestrator-state.yml
├── dashboard.html                     # Operator dashboard (copied plugin asset — never model-generated)
├── dashboard-data.js                  # Dashboard data projection (rewritten per phase/gate)
├── analysis/
│   ├── codebase-analysis.md           # Phase 1
│   ├── performance-analysis.md        # Phase 2
│   ├── user-profiling-data/           # Optional user-provided data
│   └── requirements.md                # Phase 3
├── implementation/
│   ├── spec.md                        # Phase 3
│   ├── spec.html                      # Phase 3 (HTML companion)
│   ├── implementation-plan.md         # Phase 5
│   ├── implementation-plan.html       # Phase 5 (HTML companion)
│   └── work-log.md                    # Phase 6
└── verification/
    ├── spec-audit.md                  # Phase 4 (conditional)
    ├── implementation-verification.md # Phase 8
    └── implementation-verification.html # Phase 8 (HTML companion)
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
- `/maister-performance [description] [--sequential]` (new)
- `/maister-performance [task-path] [--from=PHASE] [--sequential]` (resume)

Flags:
- `--from=PHASE`: Resume from specific phase
- `--sequential`: Disable parallel wave dispatch in `implementation-plan-executor`; run one task group at a time. Persisted as `orchestrator.options.sequential: true` in `orchestrator-state.yml`. Defaults to off (parallel waves).

Task directory: `.maister/tasks/performance/YYYY-MM-DD-task-name/`
