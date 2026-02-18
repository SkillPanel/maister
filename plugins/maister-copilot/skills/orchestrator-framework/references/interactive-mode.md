# Interactive Mode

Orchestrators support two execution modes: **Interactive** (default) and **YOLO**.

## Critical Rule

**In interactive mode, `→ Pause` means STOP and USE AskUserQuestion.**

This is NOT optional. This is NOT "output a message and continue."

You MUST:
1. Output phase summary
2. Invoke `AskUserQuestion` tool
3. WAIT for user response
4. Only proceed after user chooses "Continue"

If you proceed to the next phase without using AskUserQuestion, you have violated interactive mode.

---

## Mode Definitions

### Interactive Mode (Default)

- Pauses at `→ Pause` transitions for user review
- Prompts for optional phases (E2E testing, user docs, code review)
- Allows course correction between phases
- **Best for**: Complex tasks, critical fixes, careful review

### YOLO Mode (`--yolo` flag)

- Runs all phases continuously without pausing
- Auto-decides on optional phases
- Only stops for critical failures
- **Best for**: Simple tasks, experienced users, automated pipelines

---

## Pause Transition Behavior

When a phase ends with `→ Pause`:

### Interactive Mode

Output phase summary, then prompt:

```
✅ Phase [N] Complete: [Phase Name]

Results:
- [Key result 1]
- [Key result 2]

Status: [Success/Success with warnings]
```

Then use `AskUserQuestion`:

```
Use AskUserQuestion tool:
  Question: "Phase [N] complete. How would you like to proceed?"
  Header: "Phase Complete"
  Options:
  1. "Continue to next phase"
     Description: "Move to [Next Phase Name]"
  2. "Review outputs"
     Description: "View phase artifacts before continuing"
  3. "Stop workflow"
     Description: "Save state and exit. Resume later."
```

### YOLO Mode

Output brief status and continue:

```
✅ Phase [N] Complete: [Phase Name]
→ Continuing to next phase...
```

---

## Phase Failure Handling

When a phase fails after max auto-fix attempts:

```
Use AskUserQuestion tool:
  Question: "Phase [N] failed after [X] attempts. How would you like to proceed?"
  Header: "Phase Failed"
  Options:
  1. "Retry with guidance" - Give additional instructions
  2. "Skip this phase" - Continue (may cause issues later)
  3. "Stop workflow" - Pause and resume later
```

---

## Optional Phase Prompts

For optional phases (E2E testing, user documentation, code review):

```
Use AskUserQuestion tool:
  Question: "Would you like to run [optional phase name]?"
  Header: "[Phase Type]"
  Options:
  1. "Yes" - Include this phase
  2. "No, skip" - Continue without it
```

In YOLO mode, auto-decide based on:
- Command flags (`--e2e`, `--no-e2e`)
- Task characteristics (UI-heavy → enable E2E)
- Default to skipping if no signal

---

## User Response Handling

| Response | Action |
|----------|--------|
| **Continue** | Proceed to next phase |
| **Review outputs** | Display artifacts, then re-prompt |
| **Restart phase** | Reset attempts, re-execute |
| **Stop workflow** | Save state, output resume instructions |
| **Skip phase** | Log warning, continue (don't mark complete) |

---

## Anti-Patterns (NEVER DO THIS)

| Anti-Pattern | Why It's Wrong |
|--------------|----------------|
| Proceeding without AskUserQuestion | User loses control, can't review or stop |
| Saying "I'll pause here" without tool call | Words ≠ pauses. Tool invocation required. |
| Batching phases before pausing | User can't course-correct between phases |
| "Phase was simple, so I skipped pause" | ALL pauses are mandatory in interactive mode |
| Checking mode but not actually pausing | Reading state without acting on it |
| Auto-accepting subagent decisions without asking | User must consent to scope/approach decisions, even when recommendations exist |

---

## User-Confirmed Rollback Principle

**NEVER automatically rollback or revert code changes without user confirmation.**

When failures occur:

1. **STOP** - Don't attempt automatic rollback
2. **ANALYZE** - Examine root cause
3. **CHECK FOR EASY FIXES** - Many failures are simple config issues
4. **ASK USER** with options:
   - "Try suggested fix"
   - "Rollback changes"
   - "Let me investigate"
5. **EXECUTE** - Only rollback if user explicitly confirms

**Rationale**: Automatic rollback discards potentially valid work and hides root causes.
