---
name: maister-development
description: Run Maister’s full adaptive, resumable development workflow for features, enhancements, complex bugs, and multi-file implementation. Use when work needs analysis, requirements and specification, test-first planning, implementation, verification, and optional design, E2E, or user documentation.
---

# Maister Development

Load and follow `$maister-codex:maister-orchestrator-framework` before starting or resuming; its state, timestamp, phase-gate, artifact-summary, dashboard, HTML-companion, recovery, and user-confirmed rollback contracts are mandatory. Use `.maister/tasks/development/YYYY-MM-DD-task-slug/` as the durable record. State and artifacts, not chat history, determine the next action. Never overwrite artifacts or roll back code without explicit approval.

Initialize `analysis/`, `implementation/`, `verification/`, `documentation/`, `orchestrator-state.yml`, and `implementation/work-log.md`. Read `.maister/config.yml` (`html_output: true`, `mockup_format: html` by default), `.maister/docs/INDEX.md`, every applicable standard, and every project document linked from the index. When HTML output is enabled, copy the shared dashboard asset and maintain `dashboard-data.js` as described by the framework.

## Adaptive phases

| # | Phase | Required outcome | Transition |
| --- | --- | --- | --- |
| 1 | Codebase analysis | `analysis/codebase-analysis.md`, clarifications, risks | Continue |
| 2 | Gap and scope analysis | `analysis/gap-analysis.md`, characteristics, decisions | User gate |
| 3 | TDD red | Focused failing regression test when defect is reproducible | Continue |
| 4 | UI mockups | Binding design context for UI-heavy work | User gate |
| 5 | Requirements and specification | `analysis/requirements.md`, `implementation/spec.md` | User gate |
| 6 | Specification audit | `verification/spec-audit.md` for complex/high-risk work | Resolve or gate |
| 7 | Implementation planning | `implementation/implementation-plan.md`, dependencies and ownership | User gate |
| 8 | Implementation | Code, focused tests, completed plan steps, work log | User gate on deviation/failure |
| 9 | TDD green | Red test and related tests pass | Continue |
| 10 | Verification selection | Persist enabled optional reviews | User gate |
| 11 | Verification and issue resolution | Canonical verification report and fix history | User gate for non-trivial fixes |
| 12 | E2E verification | Runtime user-flow evidence when enabled/applicable | Continue or gate on blockers |
| 13 | User documentation | User guide and screenshots when enabled/applicable | Continue |
| 14 | Finalization | Completed state, summary, risks, commit suggestion | Finish |

Run conditional phases only when evidence activates them and record every skip with its reason. Phase 3 activates for a reproducible defect. Phase 4 activates for UI-heavy work lacking binding design context. Phase 6 is recommended for complex, safety-sensitive, migration-like, or ambiguous specifications. Phases 12 and 13 activate from user options or task characteristics.

## Analyze and specify

Delegate to the installed specialist agents per the framework's delegation rule: `maister-gap-analyzer` for Phase 2, `maister-specification-creator` for Phase 5, `maister-spec-auditor` for Phase 6, `maister-implementation-planner` for Phase 7, `maister-e2e-test-verifier` for Phase 12, and `maister-user-docs-generator` for Phase 13; perform each lane inline under the same contract when an agent is not installed.

Load `$maister-codex:maister-codebase-analysis` for Phase 1. In Phase 2, compare current and desired behavior, identify reusable patterns and integration points, and assess user reachability, personas, navigation, permissions, complete data lifecycle, critical touchpoints, and orphaned inputs or displays. Persist characteristics such as `has_reproducible_defect`, `modifies_existing`, `new_capability`, `data_operations`, `ui_heavy`, and `risk_level`.

For Phase 3, add only the smallest valid regression test. If it already passes, stop and correct the reproduction. For Phase 4, load `$maister-codex:maister-mockup-studio` with `iteration: single`, `emit_index_rows: true`, and the task’s design context. Preserve external design inputs under `analysis/design-context/` and treat indexed mockups as binding.

The specification must cover the problem, personas and user journey, functional behavior, acceptance criteria, scope and non-goals, data and security implications, failure behavior, standards, observability, documentation, rollout, and rollback. Audit it with `$maister-codex:maister-reviews-spec-audit` when Phase 6 is active. When HTML output is enabled, write the `spec.html` and `implementation-plan.html` companions per the framework's companion table as each markdown artifact is approved.

## Plan and implement

The plan must define cohesive task groups, dependencies, exact or expected files, file ownership, test-first steps, validation commands, visual references, rollback actions, and acceptance coverage. Detect overlapping file ownership before assigning parallel groups. Load `$maister-codex:maister-implementation-plan-executor` for Phase 8; do not bypass it by implementing the approved plan inline.

Implementation runs focused tests after each group and continuously applies newly relevant standards. A red regression test must become green before verification. Stop for architecture changes, data-integrity risk, scope expansion, repeated failures, or any deviation that invalidates the approved specification or plan.

## Verify and finalize

Phase 10 records options for code review, pragmatic review, production readiness, reality assessment, E2E, and user docs. Load `$maister-codex:maister-verify` once for the canonical verification cycle; never launch competing full test suites. Present non-trivial findings before modifying code. After fixes, re-run affected checks and refresh the canonical report so no stale verdict remains.

E2E uses the bundled Playwright MCP when available and writes evidence under `verification/`; degrade to explicit manual steps when unavailable. User documentation reuses E2E screenshots before capturing new ones. Finalization verifies all required artifacts, acceptance criteria, plan checkboxes, standards, and final verdict before setting `status: completed`.

## State and recovery

Record timestamps, status, current and completed phases, attempts, phase summaries, decisions, applicable standards, project documents, task characteristics, design/research context, verification options, artifacts, and failures. Support `--from`, `--reset-attempts`, `--research=<task>`, `--e2e`, `--user-docs`, and `--sequential`. Limit analysis/spec/plan attempts to two, implementation groups to three unless the failure is clearly transient, and verification/fix cycles to three. Exhausted attempts pause the task; they never authorize rollback.
