---
name: orchestrator-framework
description: Shared orchestration patterns for all workflow orchestrators. NOT an executable skill - provides reference documentation for phase execution, state management, phase gates, and initialization. All orchestrators reference these patterns.
user-invocable: false
---

# Orchestrator Framework

This skill provides **shared reference documentation** for all orchestrator skills in the maister plugin. It is NOT an executable skill - orchestrators reference these patterns and implement them for their specific domain.

## Purpose

Reduce duplication across orchestrators by documenting common patterns once:

- **Delegation**: Skill tool for skills, Task tool for agents — the workflow engine's § *Delegation by scheme*
- **Gates**: Pause behavior, the driver rule and in-node question defaults — § 2
- **State Management**: `orchestrator-state.yml` and the context blocks — the workflow engine's `references/writing-state.md`
- **Initialization**: Task directory setup and naming — the workflow engine's § *Starting a run*

## How Orchestrators Use This

The workflow engine's Step 1 reads `../workflow-engine/references/node-summaries.md`, the shape
of every step's summary. The framework file holds § 2, the gate rule, and § 7, the artifact
summary contract, and its index names where each of its other former sections now lives:

1. `../orchestrator-framework/references/orchestrator-patterns.md`

## Reference Files

| File | Purpose |
|------|---------|
| `references/orchestrator-patterns.md` | The gate rule (§ 2, § 2.1, § 2.2) and the artifact summary contract (§ 7), with an index of where the other shared rules went |
| `references/orchestrator-creation-checklist.md` | Authoring checklist for a new built-in workflow definition (not loaded at runtime) |
| `references/html-report-style.md` | Style guide for HTML companion reports (delegates take its path from the `html:` line of `run-context`) |
| `scripts/check-explainer.mjs` | Checks an explainer page against its sources: every figure traces, every section links to an existing heading, nothing loads from outside (exit 0 clean, 1 findings, 2 could not run) |
| `references/standards-compliance-checklist.md` | How a workflow discovers the project's standards, writes the Standards Compliance Checklist and verifies it after implementation (read by quick-plan, quick-dev and quick-bugfix) |
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
