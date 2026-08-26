# Research Report: Applications Module Technical Grounding

**Research type**: Technical (codebase mechanics) | **Date**: 2026-08-10 | **Repo root**: `/home/dev/Repos/repo-alpha/.worktrees/feature-widget` (all paths worktree-relative)

## TL;DR
All five settled constraints are workable in `repo-alpha`; four are cheap with live precedents, and constraint 5 is a partial engine misfit: two open steps per subject need two workflow instances (the engine is strictly sequential), and the asked/decided many-to-one tables must be module-owned because the engine's assignee table is dead code and "who decided" has no engine representation. The loudest cost flags: notifications silently drop (external Notifier templates, no sent log), team-pool action-item assignees get zero notifications, no handoff-evidence channel exists anywhere, post-submission survey editing is the one expensive survey extension, and each new permission domain requires a coordinated deploy of the separate `auth` repo.

## Key Decisions
- **C5 satisfiability**: "two open steps per subject" is achievable only as two workflow instances per subject (perf-review parent/child precedent) or domain-owned step rows - never inside one instance. - The engine loop is a sequential `for` with a blocking await per step.
- **Asked/decided tables are the module's to build** - `workflow_step_execution_assignee` has zero writers; the live many-to-one precedent is `action_item_assignment`; decided-by is a single audit column set, not a table, anywhere in the repo.
- **Survey extension shape**: model requester edits/withdrawal as pre-SUBMITTED states (withdraw-and-edit before the handler decision) - post-SUBMITTED editing collides with five one-shot submit side effects, two live readers, and a no-history answer table.
- **Uniqueness lives on the request aggregate** - a global unique on `survey_response` would break performance review; the WIDGET partial-unique-index-over-open-status pattern is the exact precedent.
- **Handoff evidence must be new module state** - no export audit trail, sent log, or delivery confirmation exists on any channel; every candidate channel (CSV step, webhook, plugin pull) is fire-and-forget or disabled in prod.

## Open Questions / Risks
- Live tenant data could not be checked for duplicate open survey rows (no DB access); the sweep-first migration pattern reported in Area B is safe regardless.
- Cross-schema FK hazard: WIDGET's tenant-context bridge table holds unqualified FKs to global-context workflow tables resolved via `search_path` (`db/changelog/2026/db.changelog.2026-widget-z-activity-workflow-binding.sql:34,49-55`) - works today but unexamined for dedicated-tenant edge cases; a new module's correlation table should confirm the pattern before copying it.
- External Notifier service behavior (template rendering, per-language lookup) is inferred from the repo-alpha-side fire-and-forget publish and toolkit sources - not observable from this repo.
- `PortalModulesConfig` registration is convention for new modules but `workflow`/`period` skip it and run via root component scan (`PortalApplication` `@SpringBootApplication`); the practical difference matters only for explicit test-slice imports.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Research Objectives & Methodology](#research-objectives--methodology)
3. [Area A - Module Shape & Conventions](#area-a--module-shape--conventions)
4. [Area B - Survey Extension](#area-b--survey-extension)
5. [Area C - Workflow Engine as Host](#area-c--workflow-engine-as-host)
6. [Area D - Action-Item Integration](#area-d--action-item-integration)
7. [Area E - Permissions & Tenancy](#area-e--permissions--tenancy)
8. [Area F - Notifications](#area-f--notifications)
9. [Area G - API & Frontend Contract](#area-g--api--frontend-contract)
10. [Area H - Export](#area-h--export)
11. [Constraint-Cost Flags (consolidated)](#constraint-cost-flags-consolidated)
12. [Conclusions](#conclusions)
13. [Appendix: Sources & Confidence](#appendix-sources--confidence)

---
