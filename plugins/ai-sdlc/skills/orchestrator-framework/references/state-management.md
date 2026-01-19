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

# Task metadata (unified - no separate metadata.yml)
task:
  title: [human-readable task title]
  description: [full task description]
  type: bug | enhancement | feature | performance | security | migration | refactoring | research | documentation
  status: pending | in_progress | completed | failed | blocked

  # Initiative coordination (null for standalone tasks)
  initiative_id: null                  # Path to parent initiative if part of one
  dependencies: []                     # Paths to tasks this depends on
  blocks: []                           # Tasks blocked by this one

  # Optional metadata
  tags: []
  priority: null                       # high | medium | low
  milestone: null

  # Time tracking
  estimated_hours: null
  actual_hours: null
```

## Extension Pattern

Orchestrators add domain-specific fields using naming convention `[domain]_context`:

- `task_context` (development)
- `security_context` (security)
- `performance_context` (performance)
- `migration_context` (migration)
- `refactoring_context` (refactoring)
- `documentation_context` (documentation)

**See each orchestrator's SKILL.md "Domain Context" section for full schema.**

### Example: Development Orchestrator

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

### Shared: research_reference

When a development workflow is started from a completed research task (`--research` flag or auto-detected), the following fields are populated:

```yaml
orchestrator:
  task_context:
    # Research linkage (populated if --research provided)
    research_reference:
      path: null                    # Path to research task directory
      research_question: null       # Original research question
      research_type: null           # technical | requirements | literature | mixed
      confidence_level: null        # high | medium | low

    phase_summaries:
      research:                     # "Phase -1" - populated at init
        summary: null               # 1-2 sentence summary
        key_findings: []            # Max 5 bullet points
        recommended_approach: null  # Primary recommendation
        decisions_made: []          # Key decisions from research
```

**Note**: Research context flows to ALL phases via Pattern 7 (context passing). Research artifacts are also copied to `analysis/research-context/` for full access.

### Shared: verification_context

All orchestrators with Issue Resolution phases add this shared schema:

```yaml
  # Added after verification phase (e.g., Phase 11.5, 3.5, 5.5, 2.5)
  verification_context:
    last_status: passed | passed_with_issues | failed | null
    issues_found: []                     # Issue summaries from verifier
    fixes_applied: []                    # What was auto-fixed
    decisions_made: []                   # User decisions on issues
    reverify_count: 0                    # Current iteration (max 3)
```

Orchestrators with Issue Resolution: development, security, performance, migration, refactoring, documentation

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

### State Update Categories

**1. Domain-specific updates** - Vary by orchestrator, documented in each SKILL.md:
- Analysis phases → populate `[domain]_context` fields (risk_level, ui_heavy, etc.)
- Look for `**State Update**:` sections in phase definitions

**2. Verification updates** - Shared pattern across all orchestrators with Issue Resolution:
- Verification phase → `verification_context.last_status`, `issues_found`
- Issue Resolution phase → `fixes_applied`, `decisions_made`, `reverify_count`

**Reference**: See each orchestrator's SKILL.md for specific state update points per phase.

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

## Context Accumulation

After each phase, extract key findings into `[domain]_context.phase_summaries`:

```yaml
[domain]_context:
  phase_summaries:
    [phase_name]:
      summary: "1-2 sentence summary of phase findings"
      [key_field_1]: [value]
      [key_field_2]: [value]
```

Each orchestrator defines its own phase_summaries schema in its SKILL.md.

---

## Resume Context Loading

When resuming, reconstruct context for downstream phases:

1. Read `orchestrator-state.yml` → get `completed_phases[]` and `phase_summaries`
2. If `phase_summaries` missing for a completed phase, read artifact file and extract
3. Build context summary from `phase_summaries` for next subagent invocation
4. Pass context in subagent prompt (see Pattern 7 in delegation-enforcement.md)

