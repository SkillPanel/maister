# State Management

All orchestrators use `orchestrator-state.yml` to track workflow progress, enable resume capability, and manage error recovery.

## State File Location

```
.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml
```

## Common State Schema

All orchestrators share these fields:

```yaml
orchestrator:
  # Execution mode
  mode: interactive | yolo

  # Phase tracking
  started_phase: [phase-name]          # First phase executed
  current_phase: [phase-name]          # Currently executing phase
  completed_phases: []                 # List of completed phase names
  failed_phases: []                    # List of failed phases with details

  # Auto-fix tracking (per phase)
  auto_fix_attempts:
    phase-0: 0
    phase-1: 0
    # ... one entry per phase

  # Optional phase flags
  options:
    e2e_enabled: true | false | null
    user_docs_enabled: true | false | null
    code_review_enabled: true | false | null
    # ... orchestrator-specific options

  # Timestamps
  created: [ISO 8601 timestamp]
  updated: [ISO 8601 timestamp]

  # Task reference
  task_path: .ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name
```

## Extension Pattern

Orchestrators add domain-specific fields under a `*_context` key:

### Development Orchestrator

```yaml
orchestrator:
  # ... common fields ...

  task_context:
    type: bug | enhancement | feature
    risk_level: low | medium | high | null
    ui_heavy: true | false | null
    tdd_applicable: true | false         # Bug only
    reproduction_data: null              # Bug only
    architecture_decision: null          # Feature/Enhancement only
```

### Security Orchestrator

```yaml
orchestrator:
  # ... common fields ...

  security_context:
    baseline_vulnerabilities: [number]
    critical_vulnerabilities: [number]
    fixes_planned: [number]
    compliance_frameworks: []            # GDPR, HIPAA, SOC2, PCI-DSS
```

### Performance Orchestrator

```yaml
orchestrator:
  # ... common fields ...

  performance_context:
    baseline_metrics:
      p50: null
      p95: null
      p99: null
      throughput: null
    optimization_target: null
    bottlenecks_identified: [number]
```

### Migration Orchestrator

```yaml
orchestrator:
  # ... common fields ...

  migration_context:
    migration_type: code | data | architecture | general
    current_system: {}
    target_system: {}
    breaking_changes: []
    rollback_strategy: null
```

### Refactoring Orchestrator

```yaml
orchestrator:
  # ... common fields ...

  refactoring_context:
    refactoring_type: extract | rename | restructure | simplify
    baseline_metrics:
      complexity: null
      duplication: null
      coverage: null
    behavioral_fingerprint: null
    branch_created: false
```

---

## State Operations

### Create Initial State

When starting a new workflow:

```yaml
orchestrator:
  mode: [from command args or default: interactive]
  started_phase: phase-0
  current_phase: phase-0
  completed_phases: []
  failed_phases: []
  auto_fix_attempts:
    # Initialize all phases to 0
  options:
    # Initialize all to null (decided later)
  created: [current ISO 8601 timestamp]
  updated: [current ISO 8601 timestamp]
  task_path: [full task directory path]

  # Add domain-specific context (initialized to nulls)
```

### Update Current Phase

Before executing a phase:

```yaml
orchestrator:
  current_phase: [new-phase-name]
  updated: [current ISO 8601 timestamp]
```

### Mark Phase Complete

After successful phase execution:

```yaml
orchestrator:
  completed_phases:
    - [add new phase to list]
  current_phase: [next-phase-name]
  updated: [current ISO 8601 timestamp]
```

### Record Phase Failure

When phase fails after max attempts:

```yaml
orchestrator:
  failed_phases:
    - phase: [phase-name]
      attempts: [attempt count]
      error: [error message]
      timestamp: [ISO 8601 timestamp]
  updated: [current ISO 8601 timestamp]
```

### Increment Auto-Fix Attempts

On each retry:

```yaml
orchestrator:
  auto_fix_attempts:
    [phase-name]: [previous + 1]
  updated: [current ISO 8601 timestamp]
```

---

## Consuming Subagent Outputs

When subagents return structured output, orchestrators must update state to enable conditional phases and provide context for downstream decisions.

### Pattern

After each subagent phase completes:

1. **Parse structured output** from subagent result (YAML/JSON in output)
2. **Map output fields** to state context fields defined in orchestrator schema
3. **Update orchestrator-state.yml** with mapped values
4. **Log update** for transparency

### Example: Gap Analyzer → Development Orchestrator

Gap analyzer returns structured output:

```yaml
analysis_complete: true
ui_heavy: true
risk_level: medium
reproduction_data: "Steps: 1. Login, 2. Click settings, 3. Error appears"
```

Orchestrator updates state:

```yaml
orchestrator:
  task_context:
    ui_heavy: true           # from output.ui_heavy
    risk_level: medium       # from output.risk_level
    reproduction_data: "..."  # from output.reproduction_data (bugs only)
  updated: [current ISO 8601 timestamp]
```

### Why This Matters

- **Conditional phases depend on state**: Phase 4 (UI Mockups) only runs if `ui_heavy = true`
- **Resume logic reads state**: Determines which phases are applicable
- **Downstream decisions need context**: Risk level affects verification depth
- **Missing updates = broken logic**: `ui_heavy` staying `null` means UI mockups never trigger

### Common State Update Points

| Orchestrator | Phase | Subagent | State Fields Updated |
|--------------|-------|----------|---------------------|
| Development | 1 | codebase-analyzer | `task_context.risk_level` |
| Development | 2 | gap-analyzer | `task_context.ui_heavy`, `risk_level`, `reproduction_data` |
| Refactoring | 1 | refactoring-planner | `refactoring_context.refactoring_type`, `total_increments` |
| Refactoring | 2 | behavioral-snapshot-capturer | `refactoring_context.baseline_fingerprint` |
| Security | 0 | security-analyzer | `security_context.baseline_vulnerabilities`, `critical_vulnerabilities` |
| Performance | 0 | performance-profiler | `performance_context.baseline_p95`, `target_p95` |
| Migration | 1 | gap-analyzer | `migration_context.migration_type`, `current_system`, `target_system` |

### Implementation Notes

- Each orchestrator's `SKILL.md` documents specific state updates after each phase
- Look for `**State Update**:` sections in phase definitions
- State updates are mandatory, not optional documentation

---

## Resume Logic

When resuming a workflow:

### Step 1: Read State File

```
Read: [task-path]/orchestrator-state.yml
```

### Step 2: Validate Artifacts

For each phase in `completed_phases`:

1. Look up expected artifacts for that phase
2. Check if artifact files exist in task directory
3. If artifact missing and condition is met:
   - Remove phase from `completed_phases`
   - Log: `⚠️ Phase [N] marked complete but artifact [path] missing. Will re-run.`
   - Update state file

### Step 3: Determine Resume Point

Resume from first phase that is:
- Not in `completed_phases`, OR
- Was removed from `completed_phases` due to missing artifacts

### Step 4: Validate Prerequisites

Before resuming from a mid-workflow phase, check prerequisites:

| Starting From | Required Prerequisites |
|---------------|----------------------|
| Gap Analysis | `analysis/codebase-analysis.md` |
| Specification | `analysis/gap-analysis.md` |
| Planning | `implementation/spec.md` |
| Implementation | `implementation/spec.md` + `implementation/implementation-plan.md` |
| Verification | Implementation complete |

If prerequisites missing, prompt user:

```
Use AskUserQuestion tool:
  Question: "Cannot start from [phase] - prerequisites missing. What would you like to do?"
  Header: "Prerequisites"
  Options:
  1. "Start from Phase 0" - Begin from the beginning
  2. "Specify different phase" - Choose another entry point
  3. "Exit" - Cancel and resolve manually
```

---

## metadata.yml (Companion File)

Each task also has `metadata.yml` for high-level tracking:

```yaml
task:
  title: [task name]
  description: [task description]
  type: [task type]
  status: in_progress | completed | failed | blocked
  created: [ISO 8601 timestamp]
  updated: [ISO 8601 timestamp]

  # Optional fields
  initiative_id: [if part of initiative]
  dependencies: []
  tags: []
```

**Key Difference**:
- `orchestrator-state.yml`: Detailed execution state (phases, attempts, options)
- `metadata.yml`: High-level task metadata (title, status, dependencies)
