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
