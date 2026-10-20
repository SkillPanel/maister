---
name: orchestrator-framework
description: Shared orchestration patterns for all workflow orchestrators. NOT an executable skill - provides reference documentation for phase execution, state management, phase gates, and initialization. All orchestrators reference these patterns.
user-invocable: false
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` on a fresh project — run `mkdir -p` on that folder first.

# Orchestrator Framework

This skill provides **shared reference documentation** for all orchestrator skills in the maister plugin. It is NOT an executable skill - orchestrators reference these patterns and implement them for their specific domain.

## Purpose

Reduce duplication across orchestrators by documenting common patterns once:

- **Delegation**: Skill tool for skills, Task tool for agents — § 1
- **Gates**: Pause behavior, the driver rule and in-node question defaults — § 2
- **State Management**: `orchestrator-state.yml` schema and the context blocks — § 4
- **Initialization**: Task directory setup and naming — § 5

## How Orchestrators Use This

The workflow engine reads the framework reference file at initialization (its Step 1), and each
workflow's node prose cites it by section:

1. `../orchestrator-framework/references/orchestrator-patterns.md`

## Reference Files

| File | Purpose |
|------|---------|
| `references/orchestrator-patterns.md` | Delegation rules, phase gates, state schema, initialization, context passing, issue resolution — the normative shapes for this edition |
| `references/orchestrator-creation-checklist.md` | Authoring checklist for a new built-in workflow definition (not loaded at runtime) |
| `references/html-report-style.md` | Style guide for HTML companion reports (delegates take its path from the `html:` line of `run-context`) |
| `assets/dashboard.html` | The frozen operator dashboard, copied into every task dir |

## Key Principles

All orchestrators follow these principles:

1. **State-Driven Execution**: `orchestrator-state.yml` is source of truth, written only through the engine's `write-state` verb
2. **Resume Capability**: Any run can be paused and resumed from its frozen graph
3. **Interactive**: Pause at each gate for user review
4. **User-Confirmed Rollback**: Never auto-rollback without user approval
5. **Visible Progress**: The state file and the dashboard projected from it are the run's tracker
6. **Standards Discovery**: Reference `.maister/docs/INDEX.md` throughout

## Orchestrators Using This Framework

- `development` (bug fixes, enhancements, features), `performance`, `migration`, `research` and
  `product-design` — through the workflow engine, which runs each one's definition and cites this
  framework from its node prose

Library consumers — not orchestrators themselves, but they read and write the same state and artifacts:

- `implementation-plan-executor`
- `implementation-verifier`

## NOT an Executable Skill

This skill does NOT get invoked directly. It exists to:
1. Provide discoverable documentation for orchestrator patterns
2. Serve as single source of truth for common logic
3. Enable consistent behavior across all orchestrators

When building new orchestrators, reference these patterns rather than duplicating them.
