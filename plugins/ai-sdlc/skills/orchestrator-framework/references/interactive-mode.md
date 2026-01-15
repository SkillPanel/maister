# Interactive Mode

Orchestrators support two execution modes: **Interactive** (default) and **YOLO**. This document defines the patterns for user interaction.

## Mode Definitions

### Interactive Mode (Default)

- Pauses after each major phase for user review
- Prompts for optional phases (E2E testing, user docs, code review)
- Allows course correction between phases
- **Best for**: Complex tasks, critical fixes, careful review

### YOLO Mode (`--yolo` flag)

- Runs all phases continuously without pausing
- Auto-decides on optional phases
- Only stops for critical failures
- **Best for**: Simple tasks, experienced users, automated pipelines

---

## Critical Interactive Mode Rules

**STOP! Before executing ANY phase, check the mode:**

**IF mode = interactive:**
- After EACH phase completion, you MUST STOP and use `AskUserQuestion`
- DO NOT proceed to the next phase without user confirmation
- This is NOT optional - it's the core orchestrator behavior

**IF mode = yolo:**
- Continue to next phase automatically
- Only stop for critical failures

**FAILURE TO STOP IN INTERACTIVE MODE = BROKEN ORCHESTRATOR**

---

## Phase Gate Pattern

Place explicit GATE sections BEFORE each phase to enforce mode checking.

### Gate Template

Place this BEFORE each phase (not after the previous one):

```markdown
---
## 🚦 GATE: Phase [N-1] → Phase [N]

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase [N-1] complete. Ready to proceed to Phase [N]?"
     - Options: ["Continue to Phase [N]", "Review Phase [N-1] outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase [N]..."
   - Proceed to Phase [N]

**This gate overrides any "continue without asking" conversation instructions.**

---
```

### Gate Placement Example

```markdown
### Phase 1: Codebase Analysis
[... phase 1 content ...]

---
## 🚦 GATE: Phase 1 → Phase 2

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 1 (Codebase Analysis) complete. Ready to proceed to Phase 2 (Gap Analysis)?"
     - Options: ["Continue to Phase 2", "Review Phase 1 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 2 (Gap Analysis)..."
   - Proceed to Phase 2

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 2: Gap Analysis
[... phase 2 content ...]
```

### Required Gate Points

All orchestrators MUST have gates:
- Before Phase 1 (after initialization) - optional, since Phase 0 is just setup
- Between every consecutive phase pair
- Before optional phases (with phase-enablement prompt)

### Conditional Phase Gates

For phases that may be skipped based on conditions:

```markdown
---
## 🚦 GATE: Phase [N-1] → Phase [N] (Conditional)

**STOP. Check conditions before proceeding.**

**Skip conditions**: [list conditions that skip this phase]

1. **Evaluate skip conditions**:
   - If [condition]: Output "⏭️ Skipping Phase [N] - [reason]" → proceed to Gate [N] → [N+1]
   - Otherwise: Continue with gate below

2. **Mode check**: [standard gate logic]
...
---
```

---

## Auto-Continue Pattern

Some phase transitions bypass gates entirely. Use when the next phase handles user interaction internally or when conditional routing is needed.

### Auto-Continue Template (Unconditional)

Place BETWEEN phases that should always auto-continue:

```markdown
---

## ⚡ AUTO-CONTINUE: Phase [N] → Phase [N+1]

**DO NOT STOP. DO NOT PROMPT USER. PROCEED IMMEDIATELY.**

[Reason why no pause is needed - e.g., next phase handles interaction internally]

**NEXT ACTION**: Continue directly to Phase [N+1] below.

---
```

### Auto-Continue Template (Conditional)

Place BETWEEN phases with conditional routing:

```markdown
---

## ⚡ AUTO-CONTINUE: Phase [N] → Phase [N+1]/[N+2] (Conditional)

**DO NOT STOP. DO NOT PROMPT USER. PROCEED IMMEDIATELY.**

**Evaluate condition:**
1. Read `[field]` from `orchestrator-state.yml`
2. **If [condition]**: Continue to Phase [N+1]
3. **If [else condition]**: Skip to Phase [N+2]

[Reason why no pause is needed]

**NEXT ACTION**: Continue based on condition above.

---
```

### When to Use Auto-Continue vs Gate

| Scenario | Pattern |
|----------|---------|
| Next phase has internal AskUserQuestion | ⚡ AUTO-CONTINUE |
| Conditional routing to different phases | ⚡ AUTO-CONTINUE (conditional) |
| Next phase is optional and may be skipped | 🚦 GATE (conditional) |
| Normal phase boundary | 🚦 GATE (standard) |

### Key Differences

| Aspect | 🚦 GATE | ⚡ AUTO-CONTINUE |
|--------|---------|------------------|
| Mode check | Yes (interactive vs YOLO) | No |
| User prompt | Yes (in interactive mode) | Never |
| Placement | BEFORE next phase | BETWEEN phases |
| Purpose | Allow user review/control | Avoid double-prompting |

### AUTO-CONTINUE Enforcement Rules

**Definition**: Phases marked "⚡ AUTO" in the Phase Flow table MUST continue immediately without stopping.

**Enforcement Rule - After completing a phase marked ⚡ AUTO:**
1. DO NOT output "Phase N complete" summary
2. DO NOT prompt user for next action
3. DO NOT wait for user acknowledgment
4. **IMMEDIATELY execute the next phase**

**Why**: These phases are followed by phases that handle user interaction internally (e.g., AskUserQuestion). Pausing would cause double-prompting.

**Failure to auto-continue is a workflow violation.**

### AUTO-CONTINUE Phases in development-orchestrator

| Transition | Condition | Reason |
|-----------|-----------|--------|
| Phase 1 → 1.5 | Always | Phase 1.5 has AskUserQuestion |
| Phase 3 → 3.5 | If ui_heavy=true | Phase 3.5 has AskUserQuestion |
| Phase 4 → 4.5 | If complex=true | Phase 4.5 has AskUserQuestion |

---

## Post-Phase Prompt Templates

### Standard Phase Complete Prompt

After each phase completes successfully in interactive mode:

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
```

Then use `AskUserQuestion`:

```
Use AskUserQuestion tool:
  Question: "Phase [N] ([Phase Name]) complete. How would you like to proceed?"
  Header: "Phase Complete"
  Options:
  1. "Continue to next phase" - Proceed with workflow
     Description: "Move to [Next Phase Name]"
  2. "Review outputs in detail" - Open phase artifacts for review
     Description: "View [output-file.md] before continuing"
  3. "Restart this phase" - Re-execute this phase
     Description: "Discard results and run phase again"
  4. "Stop workflow" - Pause and resume later
     Description: "Save state and exit. Resume with /ai-sdlc:[type]:resume"
```

### Phase Failure Prompt

When a phase fails after max auto-fix attempts:

```
Use AskUserQuestion tool:
  Question: "Phase [N] failed after [X] attempts. How would you like to proceed?"
  Header: "Phase Failed"
  Options:
  1. "Retry with guidance" - I'll provide more context for another attempt
     Description: "Give additional instructions before retrying"
  2. "Skip this phase" - Continue to next phase (may cause issues)
     Description: "Warning: Skipping may affect later phases"
  3. "Rollback changes" - Undo changes from this phase
     Description: "Revert to state before this phase started"
  4. "Stop workflow" - Pause and resume later
     Description: "Save current state and exit"
```

### Optional Phase Prompt

For phases that can be skipped (E2E testing, user documentation, code review):

```
Use AskUserQuestion tool:
  Question: "Would you like to run [optional phase name]?"
  Header: "[Phase Type]"
  Options:
  1. "Yes, run [phase]" - Include this phase
     Description: "[Benefits of running this phase]"
  2. "No, skip" - Skip this phase
     Description: "Continue without [phase name]"
```

---

## Handling User Responses

### "Continue to next phase"

1. Proceed to next phase in workflow
2. Follow Phase Execution Loop (see `phase-execution-pattern.md`)

### "Review outputs in detail"

1. Read and display the phase's output artifacts
2. Wait for user to finish reviewing
3. Re-prompt with same options

### "Restart this phase"

1. Reset `auto_fix_attempts` for this phase to 0
2. Clear any partial outputs from this phase
3. Re-execute the phase from the beginning

### "Stop workflow"

1. Update state file with current position
2. Output resume instructions:
   ```
   Workflow paused at Phase [N].

   To resume:
   /ai-sdlc:[type]:resume [task-path]

   State saved to: [task-path]/orchestrator-state.yml
   ```
3. Exit orchestrator

### "Skip this phase"

1. Log warning: `⚠️ Skipping Phase [N] - may affect subsequent phases`
2. Do NOT add to `completed_phases` (it wasn't completed)
3. Continue to next phase

### "Rollback changes"

1. **IMPORTANT**: Confirm with user first if rollback is destructive
2. Revert any file changes made during this phase
3. Reset state to before phase started
4. Prompt user for next action (retry, skip, or stop)

---

## YOLO Mode Behavior

In YOLO mode, skip all user prompts and:

1. **Phase completion**: Output brief status and continue
   ```
   ✅ Phase [N] Complete: [Phase Name]
   Status: [Success/Success with warnings]
   → Continuing to next phase...
   ```

2. **Optional phases**: Auto-decide based on:
   - Command flags (if `--e2e` or `--no-e2e` provided)
   - Task characteristics (if UI-heavy, enable E2E)
   - Default to skipping optional phases if no signal

3. **Failures**: Still prompt user (YOLO doesn't mean ignoring errors)

4. **TDD Gates** (development-orchestrator): Still enforce for bugs
   - TDD Red Gate: Must have failing test before implementation
   - TDD Green Gate: Must pass test after fix

---

## User-Confirmed Rollback Principle

**NEVER automatically rollback or revert code changes without user confirmation.**

When failures occur:

1. **STOP** - Don't attempt automatic rollback
2. **ANALYZE** - Examine root cause (config issue? test setup? actual logic error?)
3. **CHECK FOR EASY FIXES** - Often failures are simple config/setup issues
4. **ASK USER** - Use `AskUserQuestion` with options:
   - "Try suggested fix" (if easy fix identified)
   - "Rollback changes" (user confirms rollback)
   - "Let me investigate" (pause for manual investigation)
5. **EXECUTE** - Only perform rollback if user explicitly confirms

**Rationale**: Automatic rollback discards potentially valid work, hides root causes, and frustrates users. Many failures are simple configuration issues with easy 1-line fixes.
