# Gap Analysis: Applications Module (Catalog Requests)

**Date**: 2026-08-11
**Task**: `.maister/tasks/development/2026-08-11-applications-module-catalog`
**Inputs**: `analysis/codebase-analysis.md` (Phase 1, incl. 8 falsified grounding-doc claims), `analysis/clarifications.md` (binding operator answers), `analysis/research-context/{research-report,solution-exploration,high-level-design,decision-log,synthesis}.md`
**Repos inspected**: `repo-alpha` (worktree `feature-widget`), `repo-beta`

## TL;DR
This is a pure create-new-capability task with two embedded modify-existing slices (`survey`, `workflow` seeds) and a third, undeclared one: **the frontend**. Every backend mechanism has a live precedent, but three user journeys - requester creates/withdraws a request, handler decides, coordinator configures the handler group and attests the handoff - have **no surface anywhere** in `repo-beta`, and one table (`application_handler_config`) has **no writer at all** in the design. Shipping the HLD as written produces a backend that is complete, correct, and reachable only by curl. Risk is **high**, driven by full-scope-in-one-run plus cross-repo (`auth`), out-of-repo (Notifier templates) and cross-project (FE) coordination - not by algorithmic difficulty.

## Key Decisions
- **FORM step gets a module-specific handler, not the stock `AwaitSurveyResponseStepHandler`** - verified: the stock handler has no prefill concept (fatal for ADR-004 attempt >= 2), stamps the edition only from a `workflowContext["enrollmentId"]` WIDGET enrollment, and the `SurveyStepOpenedEvent` the HLD assumed is a `performancereview`-owned event, not a survey-module one. The ADR-008 "FORM-step reuse check" is hereby answered: **no reuse**.
- **`WidgetSurveyContextContributor` already covers the form-header context** if the module stamps `subject_edition_uuid` on the response (`widget/training/infrastructure/WidgetSurveyContextContributor.java:50-56` self-selects on `facts.subjectEditionUuid()`), so `ApplicationSurveyContextContributor` from the HLD is likely dead weight - flagged as a decision, not assumed away.
- **`ACTION_ITEM` `step_type_registry` seed is NOT a blocker for this design** - the module ships two custom step codes (ADR-008); the missing seed only bites if the validated authoring path is used AND an `ACTION_ITEM` step appears in a definition. It is opportunistic platform repair, and its inclusion is a scope decision, not a prerequisite.
- **Task characteristics**: not a defect fix; modifies existing code; creates new entities; heavy data operations; **UI-heavy** (see journey analysis).

## Open Questions / Risks
- `application_handler_config` is an **orphaned CREATE**: read by the DECISION step handler, written by nobody. The HLD's enablement checklist step (2) is a manual SQL insert. Without a management endpoint the module cannot be enabled for a second company without a DBA.
- **Zero-handler resolution is undesigned**: if the configured team is empty (or all members left), the DECISION step writes zero `asked` rows, creates an item with zero assignees, and parks forever with no timeout enforcement (`timeoutDuration` is verified unenforced). Nothing surfaces this.
- The action-item **`inline-with-outcome`** completion archetype is **more built than the HLD assumed**: the FE panel exists and is wired (`ActionDetailPanel.tsx` -> `InlineWithOutcomePanel`), and `POST /actionItems/{id}/complete` already accepts and persists `outcome` + `resultData` (`actionitem/web/CompleteActionItemRequest.java`, `domain/ActionItem.java:159-167`). Only the backend's `outcomeSchema` emission is dormant. This makes an in-panel approve/reject genuinely cheap - but `ActionItemCompletedEvent` carries `completedByPersonId` **without** `outcome`/`resultData`, so mirroring the decision into module tables needs that event widened or a facade read-back.
- A new `/admin/*` screen is a **three-repo** change: `repo-beta` (feature folder) **plus** the Angular host `repo-beta` (`app-routes.ts` `microAppRoute` + `app-menu.module.ts` entry). `/admin/cadence` is itself not registered in the host's `ADMIN_ROUTING` - do not assume the host wiring is generic.
- There is **no CSV export UI pattern in either frontend repo** - the only export UI is client-side `xlsx` built in-browser from fetched rows (`features/people/list/excelExport/`). A server-produced CSV download has no reusable helper.
- `application_notification_attempt` has no retention policy and grows unbounded per request per template.
- Full-scope-in-one-run + net-new prefill inside the shared `survey` module + `auth`-repo dependency + unverifiable Notifier provisioning stack sequentially; a single blocked link stalls launch, not just a slice.

---

## Summary
- **Risk Level**: **High** (drops to medium-high if the FE surfaces are explicitly deferred and the module is accepted as dormant-until-FE)
- **Estimated Effort**: **High** - ~40-60 new + ~10 modified backend files across 6 modules, plus 3 net-new FE surfaces if in scope
- **Detected Characteristics**: `modifies_existing_code`, `creates_new_entities`, `involves_data_operations`, `ui_heavy`
