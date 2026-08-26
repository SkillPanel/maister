# Codebase Analysis Report

**Date**: 2026-08-11
**Task**: New `applications` module owning the Northwind catalog-request aggregate
**Description**: Implement a new `applications` module in repo-alpha (Spring Boot 4.1 / Java 25 modular monolith) owning the catalog-request (catalog requests) aggregate for Northwind. Driven by the existing workflow engine (2-step COMPANY-scope definition: form -> decision), forms via the extended survey module, handler work list via the action-item "My actions" surface. Module owns step/asked/decided state correlated to engine rows by FK-less uuids; withdraw-to-terminal requester editing with fresh prefilled survey response; write-once terminal `outcome` column with open-uniqueness partial index; CSV export + handoff attestation rows; requester-facing Notifier notifications with a module-owned send-attempt log; new `applications` permission domain requiring a coordinated auth-repo deploy.
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis (architecture), Context Discovery (integration requirements), Pattern Mining)

---

## TL;DR
Every mechanism the design depends on exists in code and has a live, copyable precedent - module wiring, StepHandler SPI, `ImperativeActionItemTemplate`, partial unique indexes, FK-less uuid correlation, claim-before-send dispatch logs, CSV download. Five grounding-doc claims are wrong and would misdirect the spec if carried forward: `WorkflowFacade` is not the authoring path, `ReconciliationPrefillService` is not an answer-copy precedent (prefill is net-new), `PortalModulesConfig` registration is optional, `SurveyFacade` is a concrete `@Service` with no withdraw/prefill, and `SurveyContextContributor`/facade package placements differ from the HLD. Two platform gaps must be closed by this module: the missing `ACTION_ITEM` `step_type_registry` seed and the team-assignee zero-notification trap. Overall: complex, medium-high risk, dominated by cross-repo (`auth`) and out-of-repo (Notifier templates) coordination rather than by repo-alpha-side code volume.

## Key Decisions
- Clone `talentmetrics` for module layout, borrow `widget/approval` for the decision aggregate - newest complete module + closest functional analogue to a write-once decision.
- Repositories and `Db*QueryService` in `infrastructure/`; facade as interface in `shared/` + `Impl` in `application/` - the two newest modules use `infrastructure/`, and interface-in-`shared` is the stronger cross-module surface (both precedents exist; pick deliberately).
- Author the 2-step COMPANY definition with a code-owned generator modelled on `WorkflowDefinitionGeneratorService`, but name the exact validating method (`WorkflowDefinitionFacade.createFullWorkflowDefinition`) - `createWorkflowDefinition` does not validate.
- Ship the `ACTION_ITEM` `step_type_registry` seed as a standalone `context:global` changeset before anything else - the validated authoring path rejects the canonical human step without it.
- Model handler groups as N person assignment rows resolved at activation time, not as a team assignee - team-assigned items send zero Notifier notifications.
- Copy `ReminderDispatch`'s native `INSERT ... ON CONFLICT DO NOTHING` returning `int` for the send-attempt log; never `save()` + catch `DataIntegrityViolationException` (poisons the transaction).
- Withdraw-to-terminal + fresh prefilled response is the only supported edit path; post-SUBMITTED answer mutation has no history table and five one-shot submit side effects.

## Open Questions / Risks
- Prefill-assign is **net-new work**, not an adaptation - no code anywhere copies `QuestionAnswer` rows between responses. Estimate accordingly.
- `SurveyFacade` needs three new methods (withdraw, prefill-assign, status transition) and is a concrete `@Service`, so the survey module must be modified, not merely consumed.
- New `applications` permission domain blocks on the separate `auth` repo (`PermissionDefinition` mirror + `permission` insert + **`permission_domain` insert**); the permission is unusable until auth ships.
- Notifier templates for every `applications:*` id in every language must be provisioned in the external Notifier service - no in-repo artifact, no CI check, silent drop until done.
- Whether to reuse `AwaitSurveyResponseStepHandler` for the FORM step is unresolved: it resolves the respondent from `initiatedByPersonId`/`workflowContext.roles` and stamps a WIDGET edition. A module-specific handler may be cleaner.
- Whether to add `ApplicationsContextConfiguration` to `PortalModulesConfig` is a real decision (it is `@Profile(NOT_TEST)`, so listing changes test-context behaviour), not a mandatory step.
- ArchUnit freeze store has `freeze.refreeze = true` - new violations are silently absorbed. Review `git diff src/test/resources/archunit_store/` on every PR.
- The engine records no decided-by concept, closes no action items on cancel, and unparks no `AWAITING_SIGNAL` rows. All withdraw/cancel cleanup is module-owned.

---

## Corrections to the grounding docs

These were found by three agents independently verifying `analysis/research-context/{research-report,high-level-design,decision-log}.md` against code. They are the highest-value output of this phase; each must survive into the specification.

| # | Grounding-doc claim | Verified reality | Evidence |
|---|---|---|---|
| 1 | `WorkflowFacade` is the validated definition-authoring path (HLD :205, :252) | `WorkflowFacade` has **no authoring methods at all** - only start/cancel/pause/resume/retry/skip/fail. Authoring + validation live in `WorkflowDefinitionFacade` and `WorkflowDefinitionService.create`. Worse: `WorkflowDefinitionFacade.createWorkflowDefinition` (:50-67) is a bare `repository.save()` and does **not** validate. Only `addStepToWorkflow` (:95), `updateFullWorkflowDefinition` (:249) and `createFullWorkflowDefinition` (:469) validate. **The spec must name the exact method.** | `workflow/application/WorkflowFacade.java` (175 lines); `workflow/application/WorkflowDefinitionFacade.java:50-67, :95, :249, :469` |
| 2 | `ReconciliationPrefillService` is the live answer-copy precedent (HLD :192, :253) | It **reads** answers to build a payload (:144); it does not copy `QuestionAnswer` rows into a new response. No code anywhere copies answers between responses. **Prefill-assign is fully net-new.** | `performancereview/reconciliation/ReconciliationPrefillService.java:44+, :144` |
| 3 | Registering in `PortalModulesConfig` is required for a new module | Optional. The newest module `period` has `PeriodContextConfiguration` (:36) that appears in **no** `@Import`; `PortalModulesConfig.java:22-38` lists 15 configs and omits it, plus `AchievementContextConfiguration`, `WorkflowConfiguration`, `SurveyConfiguration`. Root `@SpringBootApplication` component scan picks them up. `PortalModulesConfig` is `@Profile(NOT_TEST)`, so listing there changes test-context behaviour. Where it actually bites: integration tests with explicit `classes = {...}` (e.g. `TenantIntegrationTest`). | `infrastructure/PortalModulesConfig.java:22-38`; `period/PeriodContextConfiguration.java:36`; `PortalApplication.java:7` |
| 4 | `SurveyFacade` is an interface in `survey/shared/` and can support the design as-is (HLD :201-202) | It is a concrete `@Service` **class** at `survey/application/SurveyFacade.java`, exposing `assignSurvey` (:61), `getResponseByStepExecutionId` (:84) and reads only. **Withdraw, prefill-assign and status transition are all new methods.** `survey/shared/` holds typed IDs, `SurveyContextContributor` and DTOs only. | `survey/application/SurveyFacade.java:61, :84` |
| 5 | `WorkflowFacade` lives in `workflow/shared/` | It is `workflow/application/WorkflowFacade.java`. `workflow/shared/` contains only `WorkflowInstanceDto.java`. | `workflow/application/WorkflowFacade.java` |
| 6 | Facade belongs in `shared/` per the `talentmetrics` template | `talentmetrics` puts its facade in `infrastructure/TalentMetricFacade.java`. The HLD's "facade in `shared/`" actually follows `performancereview/shared/PerformanceReviewFacade.java`. Both precedents exist - the proposed layout is a defensible **synthesis**, not any one module's layout. | `talentmetrics/infrastructure/TalentMetricFacade.java`; `performancereview/shared/PerformanceReviewFacade.java` |
| 7 | `survey` follows the `*ContextConfiguration` convention | `survey` has `SurveyConfiguration.java` (460 B), no consumer bean, and is absent from `PortalModulesConfig`. Do not cite it as the module-config template. | `survey/SurveyConfiguration.java` |
| 8 | Action-item `Db*QueryService` lives in `infrastructure/` | `actionitem` uses `infra/` (`actionitem/infra/DbActionItemQueryService.java`) and puts repositories in `domain/`. Everyone else uses `infrastructure/`. Follow the majority, not this precedent. | `actionitem/infra/DbActionItemQueryService.java` |

**Confirmed-correct grounding-doc claims** (verified, do not re-litigate): the `ACTION_ITEM` `step_type_registry` seed is genuinely missing (`grep "'ACTION_ITEM'" db/` -> 0 hits while `ActionItemStepHandler.java:61` declares the code) - the "platform repair" framing is right; the `question_answer` unique key is already widened to `UNIQUE NULLS NOT DISTINCT (survey_response_id, question_id, subject_key)`, so the rebase addendum's "copy `subject_key`" mandate holds; `SurveyContextContributor` is a real, self-selecting, first-non-empty-wins SPI with a working 69-line implementation; the ADR-008 mandate to compose `ActionItemFacade` rather than duplicate item mechanics matches `ActionItemStepHandler`'s shape; and the HLD's `category=applications` / `contextType=application_decision` / `kind=APPROVE` triple satisfies the descriptor's don't-make-them-identical rule.

---
