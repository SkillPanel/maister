# Phase Execution Pattern

All orchestrators follow this 7-step pattern for each phase in their workflow.

## The 7-Step Phase Loop

**FOR each phase in workflow, execute these steps:**

### STEP 1: Check if Phase Already Completed

Read `orchestrator-state.yml`:
- If phase in `completed_phases`: **Skip to next phase**
- If phase in `failed_phases` and max retries exceeded: **Halt with error**
- Otherwise: **Proceed with execution**

### STEP 1.5: Handle Phase Re-Run (Resume Only)

If resuming and phase was previously in `completed_phases` but removed due to missing artifacts:

1. Log: `🔄 Re-running Phase [N] due to missing artifacts`
2. Reset any phase-specific context if needed
3. Clear `auto_fix_attempts` for this phase (reset counter to 0)
4. Continue with normal phase execution

**Note**: This step only executes during resume when initialization detected missing artifacts.

### STEP 2: Update State to Current Phase

Update `orchestrator-state.yml`:

```yaml
orchestrator:
  current_phase: [phase-name]
  updated: [ISO 8601 timestamp]
```

### STEP 3: Pre-Phase Announcement

**Update TodoWrite**: Mark current phase as `in_progress`:
```
Use TodoWrite tool to update current phase status to "in_progress"
```

Output to user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase [N]: [Phase Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Phase description]

Invoking: [skill-name or agent-name]

Starting...
```

### STEP 4: Execute Phase

Execute the phase according to its definition in the orchestrator's Workflow Phases section.

This is where domain-specific logic runs (e.g., security analysis, performance profiling, codebase analysis).

### STEP 5: Handle Errors

If phase fails:

1. Increment `auto_fix_attempts.[phase]` in state
2. If under max attempts: Try auto-fix strategy (domain-specific)
3. If max attempts exceeded: Prompt user for decision

**User prompt for failures** (see `interactive-mode.md` for template):
- "Retry with guidance"
- "Skip this phase"
- "Rollback changes"
- "Stop workflow"

### STEP 6: Update State on Success

Update `orchestrator-state.yml`:

```yaml
orchestrator:
  completed_phases:
    - [phase-name]  # Add to list
  current_phase: [next-phase]
  updated: [ISO 8601 timestamp]
```

**Update TodoWrite**: Mark current phase as `completed`:
```
Use TodoWrite tool to update current phase status to "completed"
```

### STEP 7: Post-Phase Review

**IF interactive mode (not YOLO):**

1. Output completion summary with results
2. Use `AskUserQuestion` for user decision (see `interactive-mode.md`)
3. Wait for response and handle accordingly

**IF YOLO mode:**

Just output and continue:
```
✅ Phase [N] Complete: [Phase Name]
Status: [Success/Success with warnings]
→ Continuing to next phase...
```

---

## Phase Execution Diagram

```
┌─────────────────────────────────────────────┐
│           Phase Execution Loop               │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────┐                        │
│  │ STEP 1: Check   │──── Already done? ─────┼──→ Skip
│  │   completion    │                        │
│  └────────┬────────┘                        │
│           │                                 │
│  ┌────────▼────────┐                        │
│  │ STEP 2: Update  │                        │
│  │     state       │                        │
│  └────────┬────────┘                        │
│           │                                 │
│  ┌────────▼────────┐                        │
│  │ STEP 3: Announce│                        │
│  │     phase       │                        │
│  └────────┬────────┘                        │
│           │                                 │
│  ┌────────▼────────┐                        │
│  │ STEP 4: Execute │                        │
│  │  phase work     │──── Error? ────────────┼──→ STEP 5
│  └────────┬────────┘                        │
│           │                                 │
│  ┌────────▼────────┐                        │
│  │ STEP 6: Update  │                        │
│  │  success state  │                        │
│  └────────┬────────┘                        │
│           │                                 │
│  ┌────────▼────────┐                        │
│  │ STEP 7: Review  │──── Interactive? ──────┼──→ Prompt user
│  │  (if needed)    │                        │
│  └────────┬────────┘                        │
│           │                                 │
│           ▼                                 │
│      Next Phase                             │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Common Mistakes to Avoid

### ❌ Skipping Step 1 (Completion Check)

Always check if a phase is already done before executing. This enables resume capability.

### ❌ Forgetting Step 7 in Interactive Mode

In interactive mode, you MUST pause after each phase for user review. This is the core orchestrator behavior.

### ❌ Auto-Rolling Back on Failure

Never automatically rollback changes. Always ask the user first (Step 5).

### ❌ Not Updating State

Every phase transition must update `orchestrator-state.yml`. Without this, resume won't work.

---

## Standards Discovery Integration

Before certain phases, check `.ai-sdlc/docs/INDEX.md` for applicable standards:

- **Specification phases**: Read INDEX.md before creating specs
- **Planning phases**: Ensure plan follows project conventions
- **Implementation phases**: Continuous standards discovery
- **Verification phases**: Verify against documented standards

Include this reminder before applicable phases:

```
📋 Standards Discovery

Reading .ai-sdlc/docs/INDEX.md to check applicable standards...

[If INDEX.md exists]
Found standards:
- [List relevant standards]

Applying these standards during this phase.

[If INDEX.md doesn't exist]
No INDEX.md found. Proceeding without explicit standards.
Consider running /ai-sdlc:init-sdlc to initialize project documentation.
```

---

## Invocation Patterns

Orchestrators delegate work to either **Skills** or **Agents**. Use the correct tool for each.

### Invoking Skills

Use the `Skill` tool:

```
Use Skill tool:
  skill: "ai-sdlc:[skill-name]"
```

**Example** (invoking implementation-planner):
```
Use Skill tool:
  skill: "ai-sdlc:implementation-planner"
```

**Skills in AI SDLC**: `specification-creator`, `implementation-planner`, `implementer`, `implementation-verifier`, `codebase-analyzer`, `code-reviewer`, `production-readiness-checker`, `docs-manager`

### Invoking Agents (Subagents)

Use the `Task` tool with `subagent_type`:

```
Use Task tool:
  subagent_type: "ai-sdlc:[agent-name]"
  description: "[brief description]"
  prompt: "[detailed prompt for the agent]"
```

**Example** (invoking gap-analyzer):
```
Use Task tool:
  subagent_type: "ai-sdlc:gap-analyzer"
  description: "Analyze gaps"
  prompt: |
    Analyze gaps for [task_type]: [description].
    Task path: [task-path]
    ...
```

**Agents in AI SDLC**: `gap-analyzer`, `spec-auditor`, `ui-mockup-generator`, `e2e-test-verifier`, `user-docs-generator`, `security-analyzer`, `performance-profiler`, and others.

### Key Difference

| Type | Tool | When to Use |
|------|------|-------------|
| **Skill** | `Skill` | For structured workflows with multiple phases (planners, creators, verifiers) |
| **Agent** | `Task` | For specialized analysis tasks that run independently (analyzers, generators) |

**Rule of Thumb**: If it has a `skill.md` or `SKILL.md` file → use `Skill` tool. If it has an `agents/*.md` file → use `Task` tool.
