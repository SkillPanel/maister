# State Management

How workflow state is persisted, managed, and used for pause/resume capability.

> **Note**: For the authoritative orchestrator state specification, see
> `plugins/ai-sdlc/skills/orchestrator-framework/references/state-management.md`

## Overview

State management enables workflows to pause and resume by persisting execution state to files. This allows long-running workflows to be interrupted and continued later without losing progress.

**Key Principle**: File-based state persistence for transparency and reliability.

## State File Location

```
.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml
```

**Format**: YAML for human readability

**Purpose**: Track workflow progress, configuration, and execution history

## State File Structure

```yaml
# Workflow identification
workflow: feature
task_type: new-features
task_id: 2025-11-17-user-profile-page

# Current execution state
current_phase: implementation
execution_mode: interactive

# Phase history
phase_history:
  - specification:
      status: completed
      started_at: 2025-11-17T10:00:00Z
      completed_at: 2025-11-17T10:28:00Z
      duration_minutes: 28
  - planning:
      status: completed
      started_at: 2025-11-17T10:30:00Z
      completed_at: 2025-11-17T10:52:00Z
      duration_minutes: 22
  - implementation:
      status: in_progress
      started_at: 2025-11-17T11:00:00Z
      progress_percent: 45

# Workflow configuration
options:
  yolo: false
  e2e: true
  user_docs: false
  from_phase: null

# Auto-recovery tracking
auto_fix_attempts:
  specification: 0
  planning: 0
  implementation: 2
  verification: 0

# Failure history
failures:
  - phase: implementation
    error: "Missing import: lodash"
    timestamp: 2025-11-17T11:15:00Z
    attempts: 1
    status: recovered
    recovery_action: "Installed lodash via npm"

# Timestamps
created_at: 2025-11-17T10:00:00Z
updated_at: 2025-11-17T11:30:00Z
last_resume_at: null
```

## State Operations

### 1. Initialize State (Workflow Start)

**When**: Beginning of new workflow

**Action**: Create orchestrator-state.yml

```yaml
workflow: feature
current_phase: specification
execution_mode: interactive
phase_history: []
options: {}
auto_fix_attempts: {}
failures: []
created_at: 2025-11-17T10:00:00Z
updated_at: 2025-11-17T10:00:00Z
```

---

### 2. Update State (After Each Phase)

**When**: Phase completion

**Action**: Update current_phase, add to phase_history

```yaml
current_phase: planning  # Updated from specification
phase_history:
  - specification:  # New entry
      status: completed
      duration_minutes: 28
```

---

### 3. Persist State (Continuous)

**When**: After significant events (phase start/end, errors, recoveries)

**Action**: Write current state to file

**Frequency**: Every major state change

---

### 4. Load State (Resume)

**When**: Resume command invoked

**Action**: Read orchestrator-state.yml

```bash
/ai-sdlc:feature:resume [task-path]
```

**Process**:
1. Read state file
2. Validate state consistency
3. Resume from `current_phase`
4. Apply `options` configuration
5. Continue execution

---

### 5. Reconstruct State (If Lost)

**When**: State file corrupted or missing

**Action**: Reconstruct from artifacts

```bash
/ai-sdlc:feature:resume [task-path] --reconstruct
```

**Reconstruction Process**:
1. Check for spec.md → specification phase completed
2. Check for implementation-plan.md → planning phase completed
3. Check for work-log.md → implementation phase started/completed
4. Check for verification report → verification phase completed
5. Rebuild state file with inferred phases

---

## Pause Mechanisms

### Manual Pause

**Method**: Simply stop responding or close Claude Code

**State**: Automatically saved at last checkpoint

**Resume**:
```bash
/ai-sdlc:feature:resume [task-path]
```

---

### Phase Boundaries (Interactive Mode)

**Method**: Workflow pauses automatically between phases

**State**: Saved after each phase completion

**Resume**: Answer prompt to continue or resume later

---

### Error Halt

**Method**: Workflow halts on unrecoverable error

**State**: Saved with failure details

**Resume**: Fix issue, then resume with reset attempts

---

## Resume Strategies

### 1. Standard Resume

```bash
/ai-sdlc:feature:resume [task-path]
```

Resumes from `current_phase` in state file

---

### 2. Override Resume Point

```bash
/ai-sdlc:feature:resume [task-path] --from=implementation
```

Starts from specified phase, ignoring state file

---

### 3. Reset Attempts

```bash
/ai-sdlc:feature:resume [task-path] --reset-attempts
```

Resets `auto_fix_attempts` counters to 0

---

### 4. Clear Failures

```bash
/ai-sdlc:feature:resume [task-path] --clear-failures
```

Clears `failures` history

---

### 5. Reconstruct State

```bash
/ai-sdlc:feature:resume [task-path] --reconstruct
```

Rebuilds state from artifacts if state file lost

---

## State Consistency

### Validation on Resume

Before resuming, workflows validate:

1. **Phase Exists**: `current_phase` is valid phase name
2. **Prerequisites Met**: Required files exist for current phase
3. **No Corruption**: YAML is valid and parseable
4. **Logical Consistency**: Phase history makes sense

**If Invalid**: Attempt reconstruction or fail with clear error

---

### State Repair

**If state file corrupted**:
1. Attempt YAML repair
2. If repair fails, attempt reconstruction
3. If reconstruction fails, report error with manual fix instructions

---

## State in Initiative Workflows

Initiatives coordinate multiple task states:

**Initiative State**: `.ai-sdlc/docs/project/initiatives/[id]/initiative-state.yml`

```yaml
initiative_id: 2025-11-14-auth-system
current_level: 1  # Execution level

# Task states
tasks:
  - id: basic-login
    path: .ai-sdlc/tasks/new-features/2025-11-14-basic-login
    status: completed
    level: 0

  - id: sso-integration
    path: .ai-sdlc/tasks/new-features/2025-11-14-sso-integration
    status: in_progress
    level: 1

  - id: mfa-enhancement
    path: .ai-sdlc/tasks/enhancements/2025-11-16-mfa-enhancement
    status: blocked  # Waiting for dependencies
    level: 2
    dependencies: [sso-integration]

progress_percent: 33  # 1/3 tasks complete
```

**State Coordination**:
- Initiative polls task metadata.yml files
- Tasks update their own orchestrator-state.yml
- File-based coordination (no shared memory)

---

## State Benefits

### 1. Pause/Resume Capability

Long-running workflows can be interrupted:
- Take a break
- Investigate issues
- Work on other tasks
- Resume later from exact point

---

### 2. Progress Tracking

State file shows:
- Which phases complete
- How long each phase took
- Current progress percentage
- Remaining work

---

### 3. Failure Recovery

State captures:
- What failed
- How many attempts
- What recovery actions taken
- When to give up

---

### 4. Audit Trail

State provides history:
- When workflow started
- Phase durations
- Errors encountered
- Recovery actions

---

### 5. Debugging

State helps diagnose issues:
- Review phase history
- Check failure details
- See auto-fix attempts
- Understand current state

---

## State Inspection

### View Current State

```bash
cat .ai-sdlc/tasks/[type]/[task-name]/orchestrator-state.yml
```

**Look For**:
- `current_phase` - Where workflow is
- `phase_history` - What's completed
- `failures` - What went wrong
- `auto_fix_attempts` - How many recoveries tried

---

### View Initiative State

```bash
cat .ai-sdlc/docs/project/initiatives/[id]/initiative-state.yml
```

**Look For**:
- `tasks` - All task statuses
- `current_level` - Which execution level
- `progress_percent` - Overall completion

---

## Best Practices

### For Plugin Developers

1. **Persist Frequently**: Save state after every significant event
2. **Validate on Load**: Check state consistency before resuming
3. **Provide Reconstruction**: Enable state rebuild from artifacts
4. **Clear Error Messages**: Help users fix state issues
5. **Version State Schema**: Support migration if state format changes

### For Users

1. **Don't Edit Manually**: Let workflows manage state
2. **Inspect When Stuck**: Review state file to understand issue
3. **Use Resume Options**: Leverage --from, --reset-attempts when needed
4. **Keep Artifacts**: Don't delete spec.md, work-log.md (needed for reconstruction)
5. **Report Issues**: If state corruption occurs, report with state file

---

## Related Resources

- [Auto-Recovery](auto-recovery.md) - How failures update state
- [Architecture](../Architecture.md) - State management system design
- [Troubleshooting](../Troubleshooting.md) - State-related issues

---

**File-based state management enables reliable pause/resume**
