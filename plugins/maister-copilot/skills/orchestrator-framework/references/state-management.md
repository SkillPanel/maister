# State Management

All orchestrators use `orchestrator-state.yml` to track workflow progress, enable resume capability, and manage error recovery.

## State File Location

```
.maister/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml
```

---

## Common State Schema

All orchestrators share these fields:

```yaml
orchestrator:
  # Execution mode
  mode: interactive | yolo

  # Phase tracking
  started_phase: [phase-name]
  current_phase: [phase-name]
  completed_phases: []
  failed_phases: []

  # Auto-fix tracking (per phase)
  auto_fix_attempts:
    phase-1: 0
    phase-2: 0
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
  task_path: .maister/tasks/[type]/YYYY-MM-DD-task-name

  # Task tracking IDs (maps phase names to TaskCreate IDs)
  task_ids:
    phase-1: null    # populated during initialization
    phase-2: null
    # ... one entry per phase

# Task metadata
task:
  title: [human-readable task title]
  description: [full task description]
  type: bug | enhancement | feature | performance | security | migration | refactoring | research | documentation
  status: pending | in_progress | completed | failed | blocked

  # Initiative coordination (null for standalone)
  initiative_id: null
  dependencies: []
  blocks: []

  # Optional metadata
  tags: []
  priority: null  # high | medium | low
  milestone: null
  estimated_hours: null
  actual_hours: null
```

---

## Extension Pattern

Orchestrators add domain-specific fields using `[domain]_context`:

| Domain | Context Field | Example Fields |
|--------|---------------|----------------|
| Development | `task_context` | type, risk_level, ui_heavy, architecture_decision |
| Security | `security_context` | baseline_vulnerabilities, fixes_completed |
| Performance | `performance_context` | baseline_p95, target_p95, optimizations_completed |
| Migration | `migration_context` | migration_type, steps_completed |
| Refactoring | `refactoring_context` | refactoring_type, baseline_fingerprint |
| Documentation | `documentation_context` | doc_type, target_audience |
| Research | `research_context` | research_type, research_question, confidence_level |

**See each orchestrator's SKILL.md "Domain Context" section for full schema.**

---

## Shared: research_reference

When development starts from completed research (`--research` flag or auto-detected research folder):

```yaml
task_context:
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

Research context flows to ALL phases via context passing. Artifacts are also copied to `analysis/research-context/`.

---

## Shared: verification_context

All orchestrators with Issue Resolution phases use this schema:

```yaml
verification_context:
  last_status: passed | passed_with_issues | failed | null
  issues_found: []           # Issue summaries from verifier
  fixes_applied: []          # What was auto-fixed
  decisions_made: []         # User decisions on issues
  reverify_count: 0          # Current iteration (max 3)
```

Applies to: development, security, performance, migration, refactoring, documentation

---

## State Operations

State is updated at key points in each phase:

| Operation | When | Fields Updated |
|-----------|------|----------------|
| Create | Workflow start | All fields initialized, `mode`, `started_phase`, timestamps |
| Phase Start | Before execution | `current_phase`, `updated` |
| Phase Complete | After success | `completed_phases` (add), `current_phase` (next), `updated` |
| Phase Failure | After max attempts | `failed_phases` (add with error), `updated` |
| Retry | On each retry | `auto_fix_attempts.[phase]` (increment), `updated` |
| Context Update | After subagent | Domain-specific fields from subagent output |

---

## Consuming Subagent Outputs

After each phase, update state from subagent results:

1. Parse structured output from subagent (YAML/JSON in result)
2. Map to state fields defined in orchestrator schema
3. Update `orchestrator-state.yml`

**Why**: Conditional phases depend on state (e.g., `ui_heavy=true` triggers UI Mockups phase). Missing updates break workflow logic.

---

## Context Accumulation

After each phase, extract key findings to `phase_summaries`:

```yaml
[domain]_context:
  phase_summaries:
    [phase_name]:
      summary: "1-2 sentence summary"
      [key_field]: [value]
```

**Why**: Enables context passing to downstream phases and supports resume with consistent context.

---

## Resume Logic

When resuming:

1. **Read state file** - Load `orchestrator-state.yml`
2. **Validate artifacts** - Check expected files for `completed_phases`. If missing, remove from list.
3. **Find resume point** - First phase not in `completed_phases`
4. **Check prerequisites** - Verify required artifacts exist before starting

| Starting From | Required Prerequisites |
|---------------|----------------------|
| Gap Analysis | `analysis/codebase-analysis.md` |
| Specification | `analysis/gap-analysis.md` |
| Planning | `implementation/spec.md` |
| Implementation | spec.md + implementation-plan.md |
| Verification | Implementation complete |

If prerequisites missing, use AskUserQuestion to let user choose: start from Phase 1, specify different phase, or exit.

---

## Resume Context Loading

When resuming mid-workflow:

1. Read `completed_phases[]` and `phase_summaries` from state
2. If `phase_summaries` missing for completed phase, extract from artifact file
3. Build context summary for next subagent prompt
4. Pass context using Pattern 7 from delegation-enforcement.md

---

## Task System Integration

`orchestrator-state.yml` remains the source of truth for workflow control. The Task system (`TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`) provides UX visibility and structured progress tracking.

| Aspect | Source of Truth | Task System Role |
|--------|----------------|------------------|
| Phase completion | `completed_phases[]` | Mirrors as `completed` status |
| Resume logic | `orchestrator-state.yml` | Complementary overview via `TaskList` |
| Error tracking | `auto_fix_attempts`, `failed_phases` | Not tracked in tasks |
| Phase dependencies | Workflow sequence in SKILL.md | Expressed via `addBlockedBy` |
| Delegation tracking | Phase definitions | `owner` field on tasks |
| Phase timing | Not tracked | `metadata: {started_at, completed_at}` |
| Phase artifacts | Phase outputs in task directory | `metadata: {artifact_paths}` |

On resume, `TaskList` can complement state file reading by providing a quick visual overview of completed vs pending phases before resuming execution.
