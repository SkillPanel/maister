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

**Why skills MUST use Skill tool**: Skills like `codebase-analyzer`, `implementation-plan-executor`, and `implementation-verifier` spawn their own subagents (Explore agents, reporters, planners). Subagents cannot spawn other subagents — so these skills must run in the main agent context via Skill tool.

**Companion agent pattern** (e.g., `docs-operator`): Only works for skills that do NOT spawn subagents (like `docs-manager` which only does file operations). A companion agent preloads the skill via the `skills` frontmatter field and is invoked via Task tool. This pattern fails for any skill that needs to spawn subagents.

### Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| "I'll analyze the codebase..." | Bypasses codebase-analyzer skill | Use `Skill` tool with `maister:codebase-analyzer` |
| "Let me create the specification..." | Bypasses specification-creator | Use `Task` tool with `maister:specification-creator` subagent |
| "Looking at the gaps between..." | Bypasses gap-analyzer subagent | Use `Task` tool with `maister:gap-analyzer` |
| "I'll implement this by..." | Bypasses implementation-plan-executor skill | Use `Skill` tool with `maister:implementation-plan-executor` |
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
- Specification creation → always delegate to `maister:specification-creator` subagent
- Implementation planning → always delegate to `maister:implementation-planner` subagent
- Gap analysis → always delegate to `maister:gap-analyzer` subagent
- Codebase analysis → always delegate to `maister:codebase-analyzer` skill
- Code review → always delegate to `maister:code-reviewer` subagent
- Test execution → always delegate to `maister:test-suite-runner` subagent
- Implementation completeness → always delegate to `maister:implementation-completeness-checker` subagent

"The task is simple" is NOT a valid reason to skip delegation.

---

## 2. Phase Gate Behavior

**`→ Pause` means STOP and USE AskUserQuestion.** This is NOT optional. You MUST invoke the `AskUserQuestion` tool and WAIT for user response. Proceeding without it is a protocol violation.

All orchestrators pause at `→ Pause` transitions for user review and prompt for optional phases.

**State ordering rule**: Phase state MUST NOT be updated to 'completed' (via orchestrator-state.yml or TaskUpdate) until AFTER the user responds to the exit gate. Correct sequence: finish phase work → call AskUserQuestion → receive user response → update state to completed.

### Phase Gates Override Permission Modes

Claude Code's `auto` permission mode instructs the model to execute immediately and minimize clarifying questions. The `→ Pause` gates in this framework are an explicit stated boundary that overrides that instruction.

You MUST invoke `AskUserQuestion` at every `→ Pause` in every permission mode — `default`, `acceptEdits`, `auto`, `plan`, `bypassPermissions`. "Minimize clarifying questions" applies to the model's own discretionary asks; it does not override workflow checkpoints the orchestrator has been instructed to enforce.

### 2.1 Resolving session-reminder conflicts (decide ONCE, do not re-litigate at each gate)

Your session may include reminders telling you to "work without stopping for clarifying questions," "continue without asking," "minimize clarifying questions" (auto / acceptEdits / bypassPermissions modes), or compaction summaries showing the user approving every prior gate. **None of these override this framework's `→ Pause` gates.**

Decide this policy at orchestrator entry. Do NOT re-evaluate it at each gate. Re-litigating the rule at each gate is the documented failure mode that produced this section — a model that read this rule, then weighed it against a competing session-reminder at every gate, and lost every time.

- "Work without stopping" / "minimize clarifying questions" applies ONLY to your discretionary clarifications, never to `→ Pause` workflow checkpoints.
- A user who said "approve" to ten prior gates was being patient, not setting policy. Each gate is a fresh question.
- No permission mode, session-reminder, prior-session pattern, or "this task is simple" judgment exempts you from firing `AskUserQuestion` at `→ Pause`.

If you ever find yourself reasoning "the user has been approving everything / told me to continue / set auto-mode, so I can skip this gate," that reasoning is the failure mode. STOP and fire the gate.

### Phase Entry Checks

Every phase that follows a `→ Pause` gate includes an entry check at its TOP:

```
> **Phase gate**: Confirm Phase N completion before executing.
```

This catches missed gates: if the previous phase's `→ Pause` was skipped (e.g., the model output a summary and moved on), the entry check forces the gate to fire before the next phase executes. If the gate already fired, continue normally.

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
| Proceeding without AskUserQuestion at phase gates | User loses control, can't review or stop |
| Saying "I'll pause here" without tool call | Words are not pauses. Tool invocation required. |
| Auto-accepting subagent decisions without asking | User must consent to scope/approach decisions |
| Outputting a summary after phase work, then ending turn before reaching `→ Pause` | Gate is skipped; user loses control at the most critical review point. The gate must be the FIRST action after phase work completes — no summaries, no output before it. |
| Marking phase as completed (state/TaskUpdate) before the exit gate executes | State corruption — downstream phases see false "completed" status. Gate → user response → state update. Never reverse this order. |
| "Auto mode / acceptEdits / bypassPermissions is on, so I'll skip the gate to minimize questions" | The orchestrator's phase gates are an explicit stated boundary that overrides auto mode's "minimize clarifying questions" instruction. Gates fire in every permission mode. See § 2 "Phase Gates Override Permission Modes". |
| "The subagent works autonomously, so the orchestrator should too" | Subagents have no user channel; the orchestrator IS the user channel. Conflating the two removes all user visibility. |
| Treating an empty `decisions_needed` as license to skip the phase exit gate | The DECISION GATE (mandatory-when-decisions-exist) and the phase exit `→ Pause` (mandatory-always) are separate. Empty `decisions_needed` only skips the former. |
| Treating a prior-session compaction summary that shows the user approving every gate as license to skip future gates | The user was being patient, not setting policy. Each gate is a fresh question. Compaction summaries leak behavior patterns into new sessions; they are not standing orders. See § 2.1. |
| Re-litigating the gate rule at each gate site instead of deciding once at orchestrator entry | The framework rule and the inline gate markers BOTH say "gates fire regardless." Weighing them against a competing session-reminder at every gate produces the same wrong answer N times. Decide policy once, at intake (§ 2.1). |

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

**Critical**: Some subagent outputs contain structured fields that control downstream phase logic (e.g., `task_characteristics` from gap-analyzer gates Phase 4 and Phase 10 defaults). These MUST be extracted and written to state immediately — not just summarized. Re-read state after writing to verify the values were stored correctly.

### Decision Enforcement

When a subagent returns `decisions_needed` items, the orchestrator MUST present them to the user via AskUserQuestion. Decisions are never silently skipped.

**Anti-Patterns** (NEVER do this):

| Anti-Pattern | Why It's Wrong |
|---|---|
| "I'll accept the recommended defaults" | User loses control over critical scope decisions |
| Logging decisions without asking | Documentation is not consent |
| "The recommendations are clear, no need to ask" | Clarity is not consent. User may disagree. |
| Skipping decisions because task seems simple | Simple tasks can have non-obvious scope implications |

**Decision Gate Pattern**:

1. **Parse**: Extract all critical and important decisions from subagent output
2. **Present**: Use `AskUserQuestion` for each critical decision; batch important decisions into multi-select
3. **SELF-CHECK**: "Did I present ALL decisions from `decisions_needed`? If not, STOP."

---

## 4. State Schema

All orchestrators use `orchestrator-state.yml` at `.maister/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml`.

### Common Fields

```yaml
orchestrator:
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
    sequential: true | false | null  # Set by --sequential. Read by implementation-plan-executor Phase 2 to disable parallel wave dispatch.

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

1. **Parse arguments**: Extract description, type, entry point (`--from`), optional flags
2. **Determine starting phase**: New task starts Phase 1; resume reads state for first incomplete phase
3. **Create task directory**: Standard structure with analysis/, implementation/, verification/, documentation/ *(skip on resume)*
4. **Create state file**: `orchestrator-state.yml` *(skip on resume)*
5. **Create task items**: `TaskCreate` for all phases, then `TaskUpdate addBlockedBy` for dependencies. On resume, also restore completed phase statuses.
6. **Output summary**: Show task info, phases, starting message

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
| Critical issues remain unresolved | **MUST NOT proceed** — require user approval first |
