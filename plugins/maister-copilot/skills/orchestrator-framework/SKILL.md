---
name: orchestrator-framework
description: Shared orchestration patterns for all workflow orchestrators. NOT an executable skill - provides reference documentation for phase execution, state management, phase gates, and initialization. All orchestrators reference these patterns.
user-invocable: false
---

# Orchestrator Framework

This skill provides **shared reference documentation** for all orchestrator skills in the maister plugin. It is NOT an executable skill - orchestrators reference these patterns and implement them for their specific domain.

## Purpose

Reduce duplication across orchestrators by documenting common patterns once:

- **Phase Blocks**: Simple phase structure with inline transitions (`→ MANDATORY GATE`, `→ AUTO-CONTINUE`) — the two transition types; see `orchestrator-patterns.md` § 2 for semantics
- **State Management**: `orchestrator-state.yml` schema and operations
- **Phase Gates**: Pause behavior and user prompts
- **Initialization**: Task directory setup, metadata, task creation patterns

## How Orchestrators Use This

Each orchestrator reads the framework reference file at initialization (Step 1):

```markdown
### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md`
```

## Reference Files

| File | Purpose |
|------|---------|
| `references/orchestrator-patterns.md` | Delegation rules, phase gates, state schema (normative shapes: `compatibility-contracts.md`), initialization, context passing, issue resolution |
| `references/orchestrator-creation-checklist.md` | Authoring checklist for creating new orchestrators (not loaded at runtime) |
| `references/html-report-style.md` | Style guide for HTML companion reports (passed to companion-writing agents) |
| `references/compatibility-contracts.md` | **Normative** compatibility-contract register: state, dashboard, config, task-dir layout (§ A4), summary blocks, timestamps, workflow grammar, driver, gates, coordination, hook floors |
| `schemas/*.schema.json` | JSON Schemas for every contract in the register; validated by the compatibility suite |
| `assets/dashboard.html` | The frozen operator dashboard, copied into every task dir — MD5 pinned in `compatibility-contracts.md` § A4 |

## Key Principles

All orchestrators follow these principles:

1. **State-Driven Execution**: `orchestrator-state.yml` is source of truth
2. **Resume Capability**: Any orchestrator can be paused and resumed
3. **Interactive**: Pause after each phase for user review
4. **User-Confirmed Rollback**: Never auto-rollback without user approval
5. **Task Progress**: Always track progress with TaskCreate/TaskUpdate tools
6. **Standards Discovery**: Reference `.maister/docs/INDEX.md` throughout

## Orchestrators Using This Framework

- `development` (bug fixes, enhancements, features)
- `performance`
- `migration`
- `research`
- `product-design`

Library consumers — not orchestrators themselves, but they read and write the same state and artifacts:

- `implementation-plan-executor`
- `implementation-verifier`

## NOT an Executable Skill

This skill does NOT get invoked directly. It exists to:
1. Provide discoverable documentation for orchestrator patterns
2. Serve as single source of truth for common logic
3. Enable consistent behavior across all orchestrators

When building new orchestrators, reference these patterns rather than duplicating them.
