window.MAISTER_DATA = {
  generated: "2026-08-11T14:23:49Z",
  task: {
    title: "Applications module - catalog requests (Northwind)",
    type: "development",
    status: "in_progress",
    description: "New `applications` module in repo-alpha owning the catalog-request aggregate, driven by the existing workflow engine (form -> decision), forms via the extended survey module, handler work list via action items. Grounded by the 2026-08-10 research task (report, exploration, HLD, 9 ADRs).",
    path: ".maister/tasks/development/2026-08-11-applications-module-catalog",
    current_activity: "Implementation complete - 16 of 16 groups, full suite green"
  },
  characteristics: {
    has_reproducible_defect: false,
    modifies_existing_code: true,
    creates_new_entities: true,
    involves_data_operations: true,
    ui_heavy: true,
    risk_level: "high"
  },
  phases: [
    { id: "phase-1", name: "Analyze codebase & clarify requirements", icon_hint: "analysis", status: "completed", started: "2026-08-10T22:50:05Z", completed: "2026-08-10T23:15:14Z", skip_reason: null,
      summary: "4 Explore agents mapped 90+ files across workflow, survey, actionitem, permissions, notifications and export. Every mechanism has a live precedent; 8 grounding-doc claims were falsified against code.",
      decisions: [
        { decision: "Clone talentmetrics layout; borrow widget/approval for the decision aggregate", rationale: "Cleanest complete module; widget/approval is the closest functional analogue for write-once decision columns" },
        { decision: "Repositories in infrastructure/, facade interface in shared/ + impl", rationale: "Two newest modules use infrastructure/; interface-in-shared is the stronger cross-module convention" },
        { decision: "Resolve handler groups to N person rows, never a team-assigned action item", rationale: "ActionItemNotificationHandler.personAssignees filters person_uuid only - team-assigned items send zero notifications" },
        { decision: "Scope: everything in the HLD, one run", rationale: "Operator chose full module over vertical slicing" },
        { decision: "ADR-004 in full - WITHDRAWN status AND fresh prefilled response", rationale: "Operator accepted the higher cost after being told prefill-assign is net-new" },
        { decision: "Handler group is dual-source: team reference and/or explicit person list", rationale: "Operator: 'probably both team and explicit person list should be possible'; exact config model still to pin in the spec" },
        { decision: "Subject binds to a WIDGET training edition/activity uuid", rationale: "Operator confirmed the concrete entity behind subject_type/subject_uuid" }
      ],
      risks: [
        "GROUNDING-DOC CORRECTION: WorkflowFacade has no authoring methods; authoring is WorkflowDefinitionFacade, and createWorkflowDefinition does NOT validate - only addStepToWorkflow/updateFullWorkflowDefinition/createFullWorkflowDefinition do. The spec must name the exact method.",
        "GROUNDING-DOC CORRECTION: ReconciliationPrefillService is not an answer-copy precedent - no code anywhere copies QuestionAnswer rows between responses. Prefill-assign is fully net-new.",
        "GROUNDING-DOC CORRECTION: SurveyFacade is a concrete @Service exposing assignSurvey + reads only - withdraw, prefill-assign and status transition are new methods inside the shared survey module.",
        "GROUNDING-DOC CORRECTION: PortalModulesConfig registration is optional (newest module `period` is absent from it) and is @Profile(NOT_TEST) - listing there changes test-context behaviour. Decide deliberately.",
        "Team-pool zero-notification trap: an action item assigned to a team sends no created/nudged notifications.",
        "ArchUnit freeze.refreeze = true silently absorbs new violations into src/test/resources/archunit_store/ - a green build does not prove compliance.",
        "workflow_step_execution_assignee confirmed dead (zero writers repo-wide); TaskStepHandler is @Deprecated with fake success.",
        "Blocking external work: auth repo needs a permission_domain insert for the new `applications` domain and must deploy first; Notifier templates are hand-provisioned with no in-repo artifact or CI check."
      ],
      artifacts: [
        { path: "analysis/codebase-analysis.md", label: "Codebase analysis (4 Explore agents, 90+ files, 8 grounding-doc corrections)", html: null },
        { path: "analysis/clarifications.md", label: "Phase 1 clarifications (scope, ADR-004, handler group, subject entity)", html: null }
      ], gate: null },
    { id: "phase-2", name: "Analyze gaps & clarify scope", icon_hint: "analysis", status: "completed", started: "2026-08-10T23:15:14Z", completed: "2026-08-10T23:44:20Z", skip_reason: null,
      summary: "Pure create-new-capability plus two declared modify-existing slices (survey, workflow seeds) and a third undeclared one: the frontend. 24 integration points. 13 decisions resolved at the gate.",
      decisions: [
        { decision: "Backend-only scope with tracked FE follow-up", rationale: "Module ships dormant-but-correct; every new screen is a three-repo change" },
        { decision: "ADR-003 upheld - dedicated evaluator-gated POST /applications/{id}/decide", rationale: "Operator chose HLD fidelity and a module-owned transaction over the cheaper already-built inline action-item outcome path" },
        { decision: "Polymorphic application_handler_source (kind = TEAM | PERSON), unioned and de-duplicated at activation", rationale: "A future third source kind is an enum value, not a schema change" },
        { decision: "One PR for everything, survey extension included", rationale: "Reviewers see why each survey change exists; accepted larger diff and concentrated risk" },
        { decision: "createFullWorkflowDefinition + APPLICATIONS_FORM / APPLICATIONS_DECISION / ACTION_ITEM seeds", rationale: "The only genuinely validating authoring method; ACTION_ITEM seed is platform repair" },
        { decision: "Module-specific FORM step handler", rationale: "Answers ADR-008's open reuse check - stock handler has no prefill concept, enrollmentId-keyed edition stamping, and a performancereview-owned event" },
        { decision: "GET/PUT endpoints for application_handler_config", rationale: "Closes the HLD gap where the table had no writer and no company could be configured" },
        { decision: "Untyped WIDGET uuid + stamp subject_edition_uuid", rationale: "Training name renders for free via the live WidgetSurveyContextContributor; adds a 4th SurveyFacade change" },
        { decision: "Follow `period`: no PortalModulesConfig entry, ship ApplicationsConsumerRegistrationArchTest", rationale: "PortalModulesConfig is @Profile(NOT_TEST); the yml registration has no compile-time check" },
        { decision: "All three safety behaviours in scope", rationale: "Zero-handler double guard, symmetric first-commit-wins 409, ops read endpoint over the attempt log" }
      ],
      risks: [
        "risk_level high: full scope in one run, no vertical slicing; the only modificative work sits inside shared `survey` (five one-shot submit side effects, two live answer readers, no answer history)",
        "Prefill-assign has zero repo precedent - net-new work inside a shared module",
        "One-PR choice concentrates risk: a survey regression blocks the entire module; full suite must run before push, not just feature tests",
        "auth repo deploy is BLOCKING - permission_domain insert for the new `applications` domain must land before or with repo-alpha",
        "Notifier templates (3 events x en+pl) are hand-provisioned externally with no in-repo artifact and no CI check - silent drop until done",
        "The FE follow-up task is a CONDITION of the backend-only decision, not an optional extra; every requester and coordinator journey is API-only until it ships",
        "Five silent-failure modes with no CI signal (yml registration, ArchUnit refreeze, typed-ID TS mapping, Notifier template absence, team-assigned action items)"
      ],
      artifacts: [
        { path: "analysis/gap-analysis.md", label: "Gap analysis (current vs desired, journeys, data lifecycle, 24 integration points)", html: null },
        { path: "analysis/scope-clarifications.md", label: "Scope clarifications (6 critical + 7 important decisions resolved)", html: null }
      ], gate: { question: "Phase 2 complete (risk: high, 13 decisions resolved). Continue to Phase 4: UI Mockup Generation to pin the FE contract?", answer: "Yes - run Phase 4 to pin the FE contract" } },
    { id: "phase-3", name: "Write failing test (TDD Red)", icon_hint: "verify", status: "skipped", started: null, completed: null, skip_reason: "No reproducible defect - pure create-new-capability. The missing ACTION_ITEM step_type_registry seed is a latent platform gap, not broken behaviour.", summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-4", name: "Generate UI mockups", icon_hint: "spec", status: "completed", started: "2026-08-10T23:44:20Z", completed: "2026-08-10T23:52:49Z", skip_reason: null,
      summary: "8 screens covering requester, handler, coordinator and ops - each carrying an API contract strip naming the endpoints it reads and the actions it calls. Bound to repo-beta's real Chakra v3 + ui-theme semantic tokens. Live gallery: http://localhost:3847",
      decisions: [
        { decision: "Every screen states its API contract inline", rationale: "The mockups double as the FE-BE interface spec, so backend endpoints are specified against real screens rather than guessed" },
        { decision: "Edge and error states are first-class screens", rationale: "The two 409 races, empty handler resolution and the missing-Notifier-template state are what a prose-only handoff loses" },
        { decision: "Reuse over invention - myActions entry point, existing survey renderer, EmptyState compound component", rationale: "The module is meant to ride existing surfaces, not replace them" }
      ],
      risks: [
        "Screens are HTML/CSS approximations, not Chakra code - the FE follow-up must rebuild them with the components named in the annotations",
        "All copy is placeholder English; a Polish-facing feature (catalog requests) needs a native pass on the pl bundle",
        "The handoff CSV column set is illustrative - real columns must be agreed with the external catalog provider",
        "The ops screen shows an applications:handed-off template, but settled scope names only submitted/approved/rejected - add the 4th template or drop it from the screen"
      ],
      artifacts: [
        { path: "analysis/design-context/INDEX.md", label: "Design context INDEX (8 screens, 8 components, stable IDs)", html: null },
        { path: "analysis/design-context/design-resources.md", label: "Design-resource discovery (3 tiers, binding rules)", html: null },
        { path: "analysis/design-context/mockups/new-catalog-request.html", label: "Screen: New Catalog Request", html: "analysis/design-context/mockups/new-catalog-request.html" },
        { path: "analysis/design-context/mockups/my-catalog-requests.html", label: "Screen: My Catalog Requests", html: "analysis/design-context/mockups/my-catalog-requests.html" },
        { path: "analysis/design-context/mockups/request-detail.html", label: "Screen: Request Detail", html: "analysis/design-context/mockups/request-detail.html" },
        { path: "analysis/design-context/mockups/withdraw-and-edit.html", label: "Screen: Withdraw and Edit", html: "analysis/design-context/mockups/withdraw-and-edit.html" },
        { path: "analysis/design-context/mockups/handler-decision.html", label: "Screen: Handler Decision", html: "analysis/design-context/mockups/handler-decision.html" },
        { path: "analysis/design-context/mockups/handler-group-configuration.html", label: "Screen: Handler Group Configuration", html: "analysis/design-context/mockups/handler-group-configuration.html" },
        { path: "analysis/design-context/mockups/handoff-export-and-attestation.html", label: "Screen: Handoff Export and Attestation", html: "analysis/design-context/mockups/handoff-export-and-attestation.html" },
        { path: "analysis/design-context/mockups/notification-attempt-log.html", label: "Screen: Notification Attempt Log", html: "analysis/design-context/mockups/notification-attempt-log.html" }
      ], gate: { question: "UI mockups complete - 8 screens. Continue to Phase 5 (requirements + specification)?", answer: "Approve - continue to Phase 5" } },
    { id: "phase-5", name: "Gather requirements & create specification", icon_hint: "spec", status: "completed", started: "2026-08-10T23:52:49Z", completed: "2026-08-11T00:18:23Z", skip_reason: null,
      summary: "45 requirements across 14 groups, 17 endpoints, 7 tables in 4 changesets, 5 typed IDs, 14 test classes. 40 verified reuse precedents vs 11 genuinely new components.",
      decisions: [
        { decision: "Withdraw creates a REPLACEMENT request row, not attempt++ in place", rationale: "The mockups' {withdrawnId, replacementId} and derivedStatus WITHDRAWN conflict with the HLD's in-place model; resolved in favour of the mockups as the binding FE contract, with lineage preserved via attempt + supersedes_request_uuid" },
        { decision: "application_handler_config carries survey_uuid + workflow_definition_uuid", rationale: "Enablement needs the survey binding and no other per-company record exists; adds a surveyId field to the config PUT body the mockup does not show" },
        { decision: "Open-uniqueness index + workflow_instance_uuid IS NULL service guard replaces the HLD's deterministic-Temporal-id duplicate-start guard", rationale: "WorkflowFacade.startWorkflow has no workflow-id parameter, so REJECT_DUPLICATE is not expressible without a workflow-module change" },
        { decision: "Dropped ApplicationSurveyContextContributor and a generic AssigneeResolver SPI", rationale: "Both judged unnecessary once the design was specified concretely" }
      ],
      risks: [
        "Engine-level duplicate-start dedupe is NOT available: WorkflowFacade.startWorkflow (workflow/application/WorkflowFacade.java:43) takes no workflow id, so the HLD's deterministic Temporal id + REJECT_DUPLICATE guard cannot be expressed. Substituted a DB uniqueness index + service guard; true engine dedupe would need a workflow-module change.",
        "CSV columns unconfirmed with the provider AND partly unsourceable: SurveyAssessmentContext supplies no training end date and no room data (editionLabel is location/city only) - 2 of the 13 provisional columns can only come from survey answers.",
        "DbSurveyAssessmentContextQueryService lives in widget/training/infrastructure/, not shared/ - cross-module consumption has precedent but may trip the module-boundary ArchUnit rule; whether a shared/ surface is needed is an implementation-time discovery.",
        "No repo precedent for write-once column discipline (ApprovalStep.decide has no such mapping) - enforced by a domain guard plus a test rather than a copied pattern.",
        "step_type_registry.category = 'HUMAN_TASK' assumed for the three seeds - needs confirmation against the live table.",
        "Input correction: SurveyStepOpenedEvent IS survey-owned, contrary to decision I2's third blocker. The module-specific FORM-handler decision still stands on the other two verified blockers."
      ],
      artifacts: [
        { path: "implementation/spec.md", label: "Specification (45 requirements, 17 endpoints, 7 tables, 14 test classes)", html: "implementation/spec.html" },
        { path: "analysis/requirements.md", label: "Requirements (journeys, reuse table, NFRs, scope boundaries)", html: null }
      ], gate: { question: "Specification complete. Continue to Phase 6: specification audit?", answer: "Yes - run the spec audit" } },
    { id: "phase-6", name: "Audit specification", icon_hint: "verify", status: "completed", started: "2026-08-11T00:18:23Z", completed: "2026-08-11T06:05:21Z", skip_reason: null,
      summary: "Verdict pass-with-concerns (4 critical, 9 major, 8 minor). ALL 21 findings applied to the spec, plus 4 unnumbered missing-failure-modes. Spec grew 83K -> 101K. ~55 of ~60 code citations had resolved exactly; the criticals were localized edits, not design reversals.",
      decisions: [
        { decision: "C1 fixed with an explicit entityManager.flush(), not a native @Modifying UPDATE", rationale: "@Version on application_step already supplies first-commit-wins; mixing native UPDATE with dirty-checked writes adds persistence-context staleness that is harder to specify correctly" },
        { decision: "C2 - StepRequest now passes null for timeoutDuration and maxRetryAttempts", rationale: "Verified WorkflowDefinitionFacade:438-448 does pass maxRetryAttempts through, so the original 0 would genuinely have disabled engine retries; recorded as silent-failure #4" },
        { decision: "C3 - ApplicationCreatedDto reduced to {requestId, workflowInstanceId}; FE polls GET /applications/{id}", rationale: "The engine offers no synchronous-first-step guarantee, so polling is the only honest answer. Recorded as mockup deviation #1" },
        { decision: "M2 - application_handler_config is the single survey_uuid source", rationale: "surveyUuid dropped from the seed schema and generator step config so PUT /handler-config is immediately effective" },
        { decision: "M8 - switched to applyComplete instead of hand-publishing DomainActionCompletedEvent", rationale: "DomainActionCompletedEvent is a reconciled-template idiom; applyComplete is the imperative-template route and is idempotent by design" }
      ],
      risks: [
        "NEW RISK from the fixes - the C4-3 analytics TOTAL_COUNT correction alters a LIVE, TENANT-VISIBLE completion-rate metric for every survey in every company. Rates rise slightly wherever withdrawn responses exist. Intended (a withdrawn response is not an incomplete one) but MUST be called out in the PR description or reviewers will read the shift as a regression.",
        "resolved: C1 - explicit flush between the withdrawn-row close and the replacement insert, promoted to requirement R7/30 with a test-#8 assertion",
        "resolved: C2 - StepRequest literal corrected; false 'order contiguous 0..n-1' invariant deleted",
        "resolved: C3 - DTO reduced; FE polls for the survey response id",
        "resolved: C4 - all 23 enum-read sites enumerated by polarity with per-site decisions; two sites change; test #11 renamed SurveyWithdrawnStatusBlastRadiusTest",
        "resolved: M5 - outcome precondition added to both step handlers, returning a non-parking success",
        "resolved: M6 - layering restated as convention; test #14 now writes both rules concretely",
        "resolved: m1 - step_type_registry category set to INTERACTION (was off-taxonomy HUMAN_TASK)",
        "resolved: M4 - rewritten around DbWidgetEditionQueryService.findEditionDetail:302; only room data is genuinely absent",
        "AUDITOR REFINED: there are exactly TWO negative-polarity Java predicates, not four. DbSurveyAnalyticsQueryService:179 is an unfiltered TOTAL_COUNT denominator that a grep for ne(SUBMITTED) would miss; the fourth is a schema index. The audit's effects table was right but its framing would have misdirected an implementer.",
        "Deliberately unfunded: a widget/**/shared/ edition facade (direct infrastructure consumption matches the live PendingSurveysEventHandler:47 precedent and violates no rule); attempt-log retention deferred until volume is observed."
      ],
      artifacts: [
        { path: "verification/spec-audit.md", label: "Specification audit (pass-with-concerns; 4 critical, 9 major, 8 minor)", html: null },
        { path: "implementation/spec.md", label: "Specification - REVISED, all 21 audit findings applied", html: "implementation/spec.html" }
      ], gate: { question: "Audit remediation complete (all 21 findings + 4 extra failure modes). Continue to Phase 7: implementation planning?", answer: "Yes - continue to planning" } },
    { id: "phase-7", name: "Plan implementation", icon_hint: "plan", status: "completed", started: "2026-08-11T06:05:21Z", completed: "2026-08-11T06:29:17Z", skip_reason: null,
      summary: "16 task groups, 125 steps, 8 waves. Critical path G1->G3->G6->G9->G11->G14->G15->G16. All five hard ordering constraints encoded structurally rather than as prose.",
      decisions: [
        { decision: "G5 (survey extension) scheduled early in wave 2 despite being off the critical path", rationale: "It carries the widest blast radius - surfacing regressions early beats discovering them at the full-suite run" },
        { decision: "JOOQ codegen placed INSIDE the migration group as step 1.8", rationale: "No scheduler can then break the DDL -> codegen -> read-service edge" },
        { decision: "G16 is terminal with a 'no further test run is planned' check as its first step", rationale: "./mvnw test re-emits the RAW acme-portal.d.ts and fails CI's up-to-date gate" }
      ],
      risks: [
        "Complexity is high not from algorithmic difficulty but from 11 silent-failure modes with no compile or CI signal, each mapped to a named guard in a specific group",
        "OPEN JUDGEMENT CALL: the SELECT ... FOR UPDATE on the request row in the workflow-start path (step 9.4) is the one concurrency control with NO dedicated test assertion. Test #8 covers the duplicate-create race, not the two-threads-both-see-NULL race that FOR UPDATE closes.",
        "Two spec items are implemented as INACTION with a documenting comment rather than code, which can read as an omission: R1/4 (no PortalModulesConfig entry, step 4.7) and blast-radius sites 2 and 4 (no change, step 5.7)",
        "Three requirements could not become actionable steps and are surfaced as external dependencies: the auth repo PR (BLOCKING, no CI enforcement); Notifier template provisioning (the plan ships only the DETECTION surface); the FE follow-up task",
        "Expected feature tests 74-110 across the spec's 14 test classes"
      ],
      artifacts: [
        { path: "implementation/implementation-plan.md", label: "Implementation plan (16 groups, 125 steps, 8 waves)", html: "implementation/implementation-plan.html" },
        { path: "implementation/visual-coverage.md", label: "Visual coverage (all 8 screens mapped; FE-only scope enumerated)", html: null }
      ], gate: { question: "Plan complete (16 groups, 125 steps). Address the untested FOR UPDATE control, and how should Phase 8 execute?", answer: "Add the assertion to G9.1 (done - step 9.1a added, test #8 now 5 assertions) | Execute SEQUENTIALLY, one group at a time | implementers run on Sonnet" } },
    { id: "phase-8", name: "Execute implementation", icon_hint: "code", status: "in_progress", started: "2026-08-11T06:29:17Z", completed: null, skip_reason: null,
      summary: "ALL 16 groups complete, 126/126 steps. Final full suite: 6658 tests, 0 failures, 9 errors (all verified GCS-credential env noise), 25/25 applications test classes green. 4 real regressions found and fixed - including a production HTTP 500 on every decision.",
      decisions: [
        { decision: "G8's action-item template re-typed onto a new ApplicationDecisionView record", rationale: "The mockup requires a handler to triage from the card; ApplicationStep carries only FK-less uuids, so the original content was identical for every request. Mockups are a binding contract per the Phase 4 gate." },
        { decision: "G5 changed blast-radius sites 1 and 3, left 2 and 4 unchanged with an explanatory comment", rationale: "Re-verification found exactly 23 read sites, matching the spec with no drift" },
        { decision: "G6 passes maxRetryAttempts as null after independently reading the StepRequest record", rationale: "Silent-failure #4 - passing 0 compiles cleanly and would have disabled engine retries on both steps" }
      ],
      risks: [
        "resolved: G6 verified StepRequest's 6th component is maxRetryAttempts, not step order - the plan's most dangerous line, confirmed against source rather than trusted",
        "resolved: G5 blast-radius re-verification found 23 sites, no drift from the spec's table",
        "resolved: G4's consumer-registration guard was verified RED before the yml edits and green after - not a vacuous pass",
        "OPEN - carry to G16 PR description: the analytics TOTAL_COUNT change shifts a live tenant-visible completion-rate metric for every survey in every company",
        "OPEN - carry to the auth PR: APPLICATIONS_REQUEST/DECIDE are registered definedOnPerson=true, which implies team-scope semantics this module never applies. Needs auth-owner confirmation.",
        "OPEN - G11 must add .isNotEmpty() to the @MapEventHandler arch assertion once the module's first handler exists; today it proves only the in-package invariant over an empty set",
        "resolved: G7 constructed ApplicationDecisionView; trainingLabel now uses DEVELOPMENT_ACTIVITY.TITLE instead of a raw edition UUID",
        "FOUND AND FIXED - production HTTP 500 on EVERY approved/rejected decision: @Modifying repository methods with no @Transactional, invoked post-commit where no ambient transaction exists. Masked by an inherited @Transactional in the module integration test; exposed only by the concurrency test's Propagation.NOT_SUPPORTED. resend (endpoint #17) had the identical defect.",
        "FOUND AND FIXED - HandoffService's widget bean broke the sliced TenantIntegrationTest context entirely (12 errors); G5's blast-radius test violated ActionItemModuleBoundaryTest 4 times; DbApplicationQueryServiceTest count assertion was genuine container pollution",
        "archunit_store diff (2 files, 32 insertions) reviewed and MUST BE COMMITTED - consistent with 42 pre-existing controller entries for the same web->infrastructure pattern; reverting makes skaffold fail CI on a dirty workspace",
        "CORRECTS THE SPEC AUDIT's M6: repo-wide ArchUnit layering IS enforced, via frozen noClasses() rules that a grep for 'layeredArchitecture|Architectures.' structurally cannot find",
        "Environment: Java 25 must be pinned explicitly (shell default is 26 -> Lombok constructor errors); ./mvnw test regenerates docs/acme-portal.d.ts RAW even with -Dexec.skip=true, reverted after every group until G16's terminal regen"
      ],
      artifacts: [
        { path: "implementation/work-log.md", label: "Work log - per-group standards trail, decisions, 4 regressions and their fixes", html: null },
        { path: "implementation/implementation-plan.md", label: "Implementation plan - all 126 steps complete", html: "implementation/implementation-plan.html" },
        { path: "documentation/pr-description.md", label: "PR description (10 required items, TOTAL_COUNT metric shift first)", html: null }
      ], gate: null },
    { id: "phase-9", name: "Verify test passes (TDD Green)", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-10", name: "Prompt verification options", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-11", name: "Verify implementation & resolve issues", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-12", name: "Run E2E tests", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-13", name: "Generate user documentation", icon_hint: "docs", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-14", name: "Finalize workflow", icon_hint: "done", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null }
  ],
  verification: { status: null, issues: [], fixes: [], reverify_count: 0 }
};
