---
name: orchestrator-framework
description: Shared orchestration patterns for all workflow orchestrators. NOT an executable skill - provides reference documentation for phase execution, state management, interactive mode, and initialization. All orchestrators reference these patterns.
---

# Orchestrator Framework

This skill provides **shared reference documentation** for all orchestrator skills in the ai-sdlc plugin. It is NOT an executable skill - orchestrators reference these patterns and implement them for their specific domain.

## Purpose

Reduce duplication across orchestrators by documenting common patterns once:

- **Phase Blocks**: Simple phase structure with inline transitions (`→ Continue`, `→ Pause`, `→ Conditional`)
- **State Management**: `orchestrator-state.yml` schema and operations
- **Interactive Mode**: Mode-aware pause behavior and user prompts
- **Initialization**: Task directory setup, metadata, task creation patterns

## How Orchestrators Use This

Each orchestrator includes a "Framework Patterns" section that references these files:

```markdown
## Framework Patterns

This orchestrator follows shared patterns. See:

- **Phase Execution**: `../orchestrator-framework/references/phase-execution-pattern.md`
- **State Management**: `../orchestrator-framework/references/state-management.md`
- **Interactive Mode**: `../orchestrator-framework/references/interactive-mode.md`
- **Initialization**: `../orchestrator-framework/references/initialization-pattern.md`
```

## Reference Files

| File | Purpose |
|------|---------|
| `references/phase-execution-pattern.md` | Phase Block structure and transitions |
| `references/state-management.md` | State file schema and operations |
| `references/interactive-mode.md` | Pause behavior and user prompts |
| `references/initialization-pattern.md` | Startup sequence and task creation |
| `references/delegation-enforcement.md` | Skill/agent invocation patterns |

## Key Principles

All orchestrators follow these principles:

1. **State-Driven Execution**: `orchestrator-state.yml` is source of truth
2. **Resume Capability**: Any orchestrator can be paused and resumed
3. **Interactive by Default**: Pause after each phase for user review (unless YOLO)
4. **User-Confirmed Rollback**: Never auto-rollback without user approval
5. **Task Progress**: Always track progress with TaskCreate/TaskUpdate tools
6. **Standards Discovery**: Reference `.ai-sdlc/docs/INDEX.md` throughout

## Orchestrators Using This Framework

- `development-orchestrator` (bug fixes, enhancements, features)
- `performance-orchestrator`
- `migration-orchestrator`
- `research-orchestrator`

## NOT an Executable Skill

This skill does NOT get invoked directly. It exists to:
1. Provide discoverable documentation for orchestrator patterns
2. Serve as single source of truth for common logic
3. Enable consistent behavior across all orchestrators

When building new orchestrators, reference these patterns rather than duplicating them.
