# Orchestrator Patterns

Shared execution rules, schemas, and patterns for all workflow orchestrators.

---

## 1. Delegation Rules

**Always use Skill/Task tools to delegate. Never execute delegated work inline.**

When a phase requires delegation:
1. Use the **Skill tool** for **skills** — loads SKILL.md instructions into the main agent's context; the main agent executes the skill's instructions and continues with the orchestrator workflow afterward
2. Use the **Task tool** for **subagents/agents** — spawns an isolated subprocess that returns results when complete
3. Wait for completion before continuing

**Skills and agents are NOT interchangeable.** Skills always use Skill tool; agents always use Task tool. Never invoke a skill via Task tool (`subagent_type`) — it will fail with "Agent type not found."

**Why skills MUST use Skill tool**: Skills like `codebase-analyzer`, `implementer`, and `implementation-verifier` spawn their own subagents (Explore agents, reporters, planners). Subagents cannot spawn other subagents — so these skills must run in the main agent context via Skill tool.

**Companion agent pattern** (e.g., `docs-operator`): Only works for skills that do NOT spawn subagents (like `docs-manager` which only does file operations). A companion agent preloads the skill via the `skills` frontmatter field and is invoked via Task tool. This pattern fails for any skill that needs to spawn subagents.

### Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| "I'll analyze the codebase..." | Bypasses codebase-analyzer skill | Use `Skill` tool with `maister-codebase-analyzer` |
| "Let me create the specification..." | Bypasses specification-creator | Use `Task` tool with `maister-specification-creator` subagent |
| "Looking at the gaps between..." | Bypasses gap-analyzer subagent | Use `Task` tool with `maister-gap-analyzer` |
| "I'll implement this by..." | Bypasses implementer skill | Use `Skill` tool with `maister-implementer` |
| Reading a SKILL.md then doing the work | Skill files are instructions FOR skills | Use Skill tool to invoke |
| Spawning Explore agents in orchestrator | Codebase-analyzer manages its own agents | Invoke skill, let IT spawn agents |

### When Inline Execution is Acceptable

These do NOT require delegation:

1. **Clarifying questions phases** — AskUserQuestion is direct
2. **State updates** — Reading/writing orchestrator-state.yml
3. **Phase announcements** — Outputting status messages
4. **Simple decisions** — Enabling/disabling optional phases
5. **Finalization** — Creating summary, updating metadata

For all analysis, planning, implementation, and verification phases: **ALWAYS DELEGATE**.

**Never acceptable inline** (regardless of perceived task simplicity):
- Specification creation → always delegate to `maister-specification-creator` subagent
- Implementation planning → always delegate to `maister-implementation-planner` subagent
- Gap analysis → always delegate to `maister-gap-analyzer` subagent
- Codebase analysis → always delegate to `maister-codebase-analyzer` skill
- Code review → always delegate to `maister-code-reviewer` subagent
- Test execution → always delegate to `maister-test-suite-runner` subagent
- Implementation completeness → always delegate to `maister-implementation-completeness-checker` subagent

"The task is simple" is NOT a valid reason to skip delegation.

---

## 2. Interactive Mode

**In interactive mode, `→ Pause` means STOP and USE AskUserQuestion.** This is NOT optional. You MUST invoke the `AskUserQuestion` tool and WAIT for user response. Proceeding without it is a protocol violation.

**Interactive Mode** (default): Pauses at `→ Pause` transitions for user review. Prompts for optional phases. Best for complex tasks and careful review.

**YOLO Mode** (`--yolo`): Runs all phases continuously. Auto-decides on optional phases. Only stops for critical failures.

### AUTO-CONTINUE Rules

When a phase ends with `→ **AUTO-CONTINUE**`:
- You MAY output a brief phase summary (1-2 lines)
- Do NOT end your turn
- Do NOT use AskUserQuestion
- Do NOT wait for user input
- After any summary, proceed immediately to the next phase

**Common mistake**: Outputting a summary and then stopping/ending the turn. The summary is fine — stopping is not.

### Anti-Patterns

| Anti-Pattern | Why It's Wrong |
|--------------|----------------|
| Proceeding without AskUserQuestion in interactive mode | User loses control, can't review or stop |
| Saying "I'll pause here" without tool call | Words are not pauses. Tool invocation required. |
| Auto-accepting subagent decisions without asking | User must consent to scope/approach decisions |

---

## 3. Context Passing & Decisions

### Context Passing

All subagent prompts must include context from prior phases:

```
prompt: |
  [Task instructions]
  Task path: [path]

  ## CONTEXT FROM PRIOR PHASES
  [Key state fields from orchestrator-state.yml]
  [Summaries of completed phases from phase_summaries]

  ## RESEARCH CONTEXT (if research_reference exists)
  Research question: [research_reference.research_question]
  Summary: [phase_summaries.research.summary]

  ## ARTIFACTS TO READ
  [List relevant files for full details]
```

**Why**: Subagents run in isolated context. Without summaries, they must re-parse entire files and miss prior decisions.

### Context Extraction

After each phase, extract key findings into `[domain]_context.phase_summaries`:

1. Parse subagent output for key fields
2. Create 1-2 sentence summary
3. Update state: `[domain]_context.phase_summaries.[phase_name]`

This enables context passing to downstream phases and supports resume.

### Decision Enforcement

When a subagent returns `decisions_needed` items, the orchestrator MUST present them to the user (interactive) or log them (YOLO). Decisions are never silently skipped.

**Anti-Patterns** (NEVER do this):

| Anti-Pattern | Why It's Wrong |
|---|---|
| "I'll accept the recommended defaults" | User loses control over critical scope decisions |
| Logging decisions without asking (interactive mode) | Documentation is not consent |
| "The recommendations are clear, no need to ask" | Clarity is not consent. User may disagree. |
| Skipping decisions because task seems simple | Simple tasks can have non-obvious scope implications |

**Decision Gate Pattern**:

1. **Parse**: Extract all critical and important decisions from subagent output
2. **Present** (Interactive): Use `AskUserQuestion` for each critical decision; batch important decisions into sequential single-select
3. **Accept** (YOLO): Auto-accept defaults, log each decision to `analysis/scope-clarifications.md`
4. **SELF-CHECK**: "Did I present/log ALL decisions from `decisions_needed`? If not, STOP."

---

## 4. State Schema

All orchestrators use `orchestrator-state.yml` at `.maister/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml`.

### Common Fields

```yaml
orchestrator:
  # Execution mode
  mode: interactive | yolo

  # Phase tracking
  started_phase: [phase-name]
  completed_phases: []
  failed_phases: []

  # Auto-fix tracking (per phase)
  auto_fix_attempts:
    phase-1: 0
    phase-2: 0

  # Optional phase flags
  options:
    e2e_enabled: true | false | null
    user_docs_enabled: true | false | null
    code_review_enabled: true | false | null

  # Timestamps
  created: [ISO 8601 timestamp]
  updated: [ISO 8601 timestamp]
  task_path: .maister/tasks/[type]/YYYY-MM-DD-task-name

  # Task tracking IDs (maps phase names to TaskCreate IDs)
  task_ids:
    phase-1: null
    phase-2: null

# Task metadata
task:
  title: [human-readable task title]
  description: [full task description]
  status: pending | in_progress | completed | failed | blocked
  tags: []
  priority: null  # high | medium | low
```

### Extension Pattern

Orchestrators add domain-specific fields using `[domain]_context`:

| Domain | Context Field | Example Fields |
|--------|---------------|----------------|
| Development | `task_context` | risk_level, ui_heavy, architecture_decision |
| Performance | `performance_context` | baseline_p95, target_p95, optimizations_completed |
| Migration | `migration_context` | migration_type, steps_completed |
| Research | `research_context` | research_type, research_question, confidence_level |

See each orchestrator's SKILL.md "Domain Context" section for full schema.

### Shared: research_reference

When development starts from completed research (`--research` flag):

```yaml
task_context:
  research_reference:
    path: null
    research_question: null
    research_type: null           # technical | requirements | literature | mixed
    confidence_level: null        # high | medium | low

  phase_summaries:
    research:
      summary: null
      key_findings: []
      recommended_approach: null
      decisions_made: []
```

Research context flows to ALL phases via context passing. Artifacts are also copied to `analysis/research-context/`.

### Shared: verification_context

All orchestrators with verification phases use:

```yaml
verification_context:
  last_status: passed | passed_with_issues | failed | null
  issues_found: []
  fixes_applied: []
  decisions_made: []
  reverify_count: 0          # max 3
```

---

## 5. Initialization & Resume

### Initialization Steps

1. **Parse arguments**: Extract description, mode (`--yolo`), type, entry point (`--from`), optional flags
2. **Determine starting phase**: New task starts Phase 1; resume reads state for first incomplete phase
3. **Create task directory**: Standard structure with analysis/, implementation/, verification/, documentation/ *(skip on resume)*
4. **Create state file**: `orchestrator-state.yml` *(skip on resume)*
5. **Create task items**: `TaskCreate` for all phases, then `TaskUpdate addBlockedBy` for dependencies. On resume, also restore completed phase statuses.
6. **Output summary**: Show task info, mode, phases, starting message

### Task Name Generation

1. Extract 3-5 key words from description
2. Convert to lowercase kebab-case
3. Prepend current date: `YYYY-MM-DD`

Examples: "Fix login timeout bug" → `2025-12-17-fix-login-timeout`

### Task Restoration on Resume

Task system IDs are ephemeral to a session. On resume:

1. Create all phase tasks (same `TaskCreate` loop, all start pending)
2. Set dependencies (same `TaskUpdate addBlockedBy`)
3. Mark completed phases (`TaskUpdate` to `completed` with `metadata: {restored: true}`)
4. Update state with new task IDs

### Resume Logic

1. **Read state file** — Load `orchestrator-state.yml`
2. **Validate artifacts** — Check expected files for `completed_phases`. If missing, remove from list.
3. **Find resume point** — First phase not in `completed_phases`
4. **Check prerequisites** — Verify required artifacts exist
5. **Restore task items** — Re-create phase tasks and mark completed ones

| Starting From | Required Prerequisites |
|---------------|----------------------|
| Gap Analysis | `analysis/codebase-analysis.md` |
| Specification | `analysis/gap-analysis.md` |
| Planning | `implementation/spec.md` |
| Implementation | spec.md + implementation-plan.md |
| Verification | Implementation complete |

If prerequisites missing, use AskUserQuestion: "Start from Phase 1", "Specify different phase", or "Exit".

---

## 6. Issue Resolution

**Don't just report issues — resolve them.** Use after verification phases that return structured issues.

### Fix-Then-Reverify Loop

1. Read verification results (structured issues)
2. For each issue: trivial/auto-fixable → fix silently, log action; non-trivial → AskUserQuestion
3. If fixes applied → set `skip_test_suite: false` (code changed) → re-run verification
4. Loop until: passes OR user proceeds with known issues OR max iterations (3)

### Fixability Assessment

| Likely Fixable | Likely Not Fixable |
|----------------|-------------------|
| Lint errors | Architecture decisions |
| Formatting issues | Design trade-offs |
| Missing imports | Test logic errors |
| Obvious typos | Unclear requirements |
| Simple config fixes | Performance tuning choices |

### Exit Conditions

| Condition | Action |
|-----------|--------|
| Verification passes | Proceed to next phase |
| User chooses "Proceed with known issues" | Proceed with warning logged |
| Max iterations (3) reached | Ask user how to proceed |
