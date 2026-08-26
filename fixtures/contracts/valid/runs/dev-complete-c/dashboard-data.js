window.MAISTER_DATA = {
  generated: "2026-08-12T15:03:58Z",
  task: {
    title: "Catalog Applications UI",
    type: "development",
    status: "completed",
    description: "Implement the Catalog Applications frontend per the approved product-design package: employee request list + detail (embedded survey), handler decision surface, admin Processes CRUD and Handoff export, plus WIDGET integration points. BE reference: map worktree feature/widget (PR #2562).",
    path: ".maister/tasks/development/2026-08-12-catalog-applications-ui",
    current_activity: null
  },
  characteristics: { has_reproducible_defect: false, modifies_existing_code: true, creates_new_entities: true, involves_data_operations: true, ui_heavy: true, risk_level: "high" },
  phases: [
    { id: "phase-0", name: "Ingest design context", icon_hint: "analysis", status: "completed", started: "2026-08-11T22:44:20Z", completed: "2026-08-11T22:44:20Z", skip_reason: null,
      summary: "Product-design handoff ingested: 13 mockups, product brief, feature spec and decision log copied under analysis/design-context/ with a stable-ID INDEX.",
      decisions: [{ decision: "One feature module, one detail route, three doors", rationale: "Handler may hold no WIDGET permission; requester, handler and coordinator each enter from their own home surface but share src/features/applications and one detail route." }],
      risks: [],
      artifacts: [
        { path: "analysis/design-context/INDEX.md", label: "Design context index (18 screens)", html: null },
        { path: "analysis/design-context/source/feature-spec.md", label: "Feature spec (primary contract)", html: null },
        { path: "analysis/design-context/brief.md", label: "Product brief", html: null }
      ], gate: null },
    { id: "phase-1", name: "Analyze codebase & clarify requirements", icon_hint: "analysis", status: "completed", started: "2026-08-11T22:44:20Z", completed: "2026-08-11T23:48:30Z", skip_reason: null,
      summary: "Greenfield module, but every required UI archetype has a recent in-repo exemplar (adminCadence, myActions, widget approvals, surveyResponding). 60+ relevant files; complexity complex, risk medium-high.",
      decisions: [
        { decision: "Surgical acme-portal.d.ts hand-add rather than copying the BE worktree file", rationale: "A full copy drags ~400 lines of unrelated master drift (removed dueDate/plannedStart, analytics union reshape, endpoint renames) into this PR." },
        { decision: "Employee list stays a WIDGET-shell tab per the approved design", rationale: "Discoverability where requesters already are, accepting the shell's known fragility." },
        { decision: "Full scope in one pass (all 13 screens)", rationale: "Matches the spec and the already-shipped backend." },
        { decision: "Translate all 8 core locales now", rationale: "No raw keys in any language; uk.json needs explicit handling because the extractor omits it." }
      ],
      risks: [
        "No CSV/blob precedent in src/api - a new src/lib/browser/downloadBlob.ts is required.",
        "ActivityCatalogView.tsx has no tab registry; the 5 in-file edit sites are unstructured and untested.",
        "scripts/i18n-extract.ts CONFIG.locales omits uk, so uk.json silently drifts on every extract run.",
        "BE contract is still uncommitted on PR #2562; hand-added types must be re-verified against the merged file.",
        "SurveyResponseStatus.WITHDRAWN sweep spans surveyResponding, performanceReviews and surveys; non-exhaustive if-chains will not fail compilation."
      ],
      artifacts: [
        { path: "analysis/codebase-analysis.md", label: "Codebase analysis (60+ files)", html: null },
        { path: "analysis/clarifications.md", label: "Phase 1 clarifications", html: null }
      ], gate: { question: "Phase 1 clarifications", answer: "Surgical DTO add; WIDGET-shell tab; full scope; all 8 locales translated" } },
    { id: "phase-2", name: "Analyze gaps & clarify scope", icon_hint: "analysis", status: "completed", started: "2026-08-11T23:48:30Z", completed: "2026-08-12T06:26:39Z", skip_reason: null,
      summary: "Contract verification against the shipped BE found 17 divergences, 4 blocking. Scope is correct; the contract needed expanding. Four consolidated BE asks filed. BE worktree verified clean at 481610dc5.",
      decisions: [
        { decision: "isOwner gap resolved by a blocking BE ask, not a client-side workaround", rationale: "ApplicationDetailDto has no applicant identity; the own-list-cache fallback fails on cold deep-links, which is exactly how handlers and coordinators arrive." },
        { decision: "BE ask to widen handler-preview's gate and accept unsaved sources[]", rationale: "Endpoint is applications:request-gated and persisted-sources-only, so the specced live preview is unbuildable." },
        { decision: "BE ask for a repeatable status query param", rationale: "Composite Open/Closed chips are not expressible against a single-value param; axios already serialises arrays with arrayFormat repeat." },
        { decision: "BE ask for attestedByName; omit the Batches column meanwhile", rationale: "Rendering raw UUIDs is forbidden and a per-row person lookup is poor value." },
        { decision: "Verify the host /admin/* wildcard and ship a paired repo-beta menu-item change", rationale: "An unverified wildcard is a launch blocker, not a discoverability nit." },
        { decision: "Promote SurveySelector to src/components/connected/surveySelect", rationale: "A cross-feature deep import fails the CI Sheriff gate; the second consumer proves it belongs in shared." },
        { decision: "Parse ApplicationAnswerDto.value as a jsonb envelope and correct the test fixtures", rationale: "Value is {type,value} JSON text, not a date string; spec-literal fixtures would pass against a shape production never sends." },
        { decision: "Handler picker follows the spec; amend shared-audience-picker.md", rationale: "BE contract is a flat sources[], not CriteriaUnion, and the preview decision removes the shared module's main draw." },
        { decision: "Generate mockups for ALL uncovered surfaces (Phase 4 runs)", rationale: "Batches tab, AttestDialog, edit/withdraw modals, rejected-outcome card and race banner have no screen ID." },
        { decision: "Add all three safety-net specs", rationale: "Each can fail silently with no compile error and no existing test." },
        { decision: "Add uk to scripts/i18n-extract.ts CONFIG.locales", rationale: "The extractor silently skips Ukrainian on every run." }
      ],
      risks: [
        "BLOCKING: four BE asks must land before the capability model, process-editor preview, composite chips and the Batches attestedBy column can be implemented.",
        "The repo-beta (Angular host) change lives in a second repository and is outside this task's verification gates.",
        "Amending shared-audience-picker.md is a standards change requiring /maister:standards-update, not a silent edit.",
        "ActivityCatalogView has 6 unstructured edit sites (one more than the spec counted) in a 468-line file with no tab registry."
      ],
      artifacts: [
        { path: "analysis/gap-analysis.md", label: "Gap analysis (17 divergences, 4 blocking)", html: null },
        { path: "analysis/scope-clarifications.md", label: "Scope clarifications (15 decisions)", html: null },
        { path: "analysis/backend-asks.md", label: "Consolidated backend asks (4)", html: null }
      ],
      gate: { question: "Continue to Phase 4: UI mockups?", answer: "Continue to Phase 4: UI mockups" } },
    { id: "phase-4", name: "Generate UI mockups", icon_hint: "code", status: "completed", started: "2026-08-12T06:26:39Z", completed: "2026-08-12T06:47:10Z", skip_reason: null,
      summary: "Produced the 5 surfaces the design handoff left without a screen ID, bound to the existing mockups' exact token palette. 18 screens now indexed in design-context/INDEX.md.",
      decisions: [],
      risks: ["Live gallery on :3847 shows only the 5 new screens - the 13 handoff screens were copied as files without the server manifest, so they are reviewable on disk only."],
      artifacts: [
        { path: "analysis/design-context/mockups/admin-batches-tab.html", label: "Admin Batches tab", html: "analysis/design-context/mockups/admin-batches-tab.html" },
        { path: "analysis/design-context/mockups/attest-confirm-handoff-dialog.html", label: "Confirm handoff dialog (+ conflict state)", html: "analysis/design-context/mockups/attest-confirm-handoff-dialog.html" },
        { path: "analysis/design-context/mockups/edit-and-withdraw-modals.html", label: "Edit / Withdraw modals", html: "analysis/design-context/mockups/edit-and-withdraw-modals.html" },
        { path: "analysis/design-context/mockups/request-detail-rejected-outcome.html", label: "Request detail - rejected outcome", html: "analysis/design-context/mockups/request-detail-rejected-outcome.html" },
        { path: "analysis/design-context/mockups/decision-race-lost-banner.html", label: "Decision race lost banner", html: "analysis/design-context/mockups/decision-race-lost-banner.html" }
      ], gate: { question: "UI mockups complete - continue to Phase 5?", answer: "Continue to Phase 5: Specification" } },
    { id: "phase-5", name: "Gather requirements & create specification", icon_hint: "spec", status: "completed", started: "2026-08-12T07:23:26Z", completed: "2026-08-12T07:48:34Z", skip_reason: null,
      summary: "spec.md (526 lines) + HTML companion: 28 requirements, 16 reusable components, 17 new, all 18 screens referenced, 9 test groups. Every API signature re-verified against the BE types, surfacing two further contract corrections and an expanded host-routing blocker.",
      decisions: [
        { decision: "Picker maps subjectUuid = EligibleSubjectDto.editionId (A15)", rationale: "EligibleSubjectDto has no subjectUuid/subjectType; built literally from the design spec the create call would send undefined." },
        { decision: "v1 omits edition dates and location from the detail meta line (A16)", rationale: "ApplicationDetailDto carries neither; a second WIDGET fetch was rejected in favour of a logged BE follow-up." },
        { decision: "SurveySelector promotion adds optional label/id props", rationale: "Keeps the performanceReviews consumer on its existing keys - zero translation churn across 8 locales." },
        { decision: "Host changeset specified, not executed (4 edits, exact anchors)", rationale: "The host repo sits outside every verification gate this workflow runs." }
      ],
      risks: [
        "HOST BLOCKER (verified): repo-beta enumerates micro-app slugs in BOTH EMPLOYEE_ROUTING and ADMIN_ROUTING; applications is absent from both. /e/applications/:requestId 404s on a fresh load, which is exactly the handler new-tab journey from the My-actions CTA.",
        "ApplicationAnswerDto.value jsonb envelope is the highest-probability silent defect; fixtures must use the real BE shape.",
        "SUBJECT_ROUTE_BUILDERS is string-keyed - a wrong literal 404s with no compile or test signal on the handler only entry point.",
        "SurveyRespondentView.tsx:60 isReadOnly is the load-bearing site in the WITHDRAWN sweep; omission renders a withdrawn response editable.",
        "Live API unavailable until the auth repo ships the applications permission domain - gates E2E only."
      ],
      artifacts: [ { path: "implementation/spec.md", label: "Implementation specification (28 requirements)", html: "implementation/spec.html" } ],
      gate: { question: "Continue to specification audit?", answer: "Run the audit; host change stays a specified follow-up" } },
    { id: "phase-6", name: "Audit specification", icon_hint: "verify", status: "completed", started: "2026-08-12T07:00:00Z", completed: "2026-08-12T09:31:35Z", skip_reason: null,
      summary: "Audit returned FAIL (7 critical). Orchestrator verification reclassified 3 criticals as false positives - a global FriendlyIdModule converts UUID to and from base62, so the identity comparisons were always correct. Revised to PASS-WITH-CONCERNS; all 4 real criticals and 40 major/minor findings applied in spec revision 2.",
      decisions: [
        { decision: "Criticals 1-3 rejected as false positives, mechanism recorded in spec section T3a", rationale: "FriendlyIdAutoConfiguration registers FriendlyIdModule globally; FriendlyIdSafe accepts either encoding. Verified in BE source and confirmed by the project owner." },
        { decision: "Console renamed /admin/catalog to /admin/applications", rationale: "The Angular host enumerates admin slugs, so a type-specific slug costs a cross-repo PR per future application type." },
        { decision: "Requester process picker gated behind BE ask #5", rationale: "GET /applications/processes is manage-only, so a requester 403s; interim is single-process resolution." },
        { decision: "Amendment register rebuilt as CC1-CC22", rationale: "The A-series had contradictory and undefined entries and collided with two upstream A-series." },
        { decision: "Two unused endpoints removed rather than documented", rationale: "scope=company and GET handler-preview had zero v1 consumers." },
        { decision: "Handler-picker deviation recorded without amending the standard", rationale: "Owner declined the shared-audience-picker amendment." }
      ],
      risks: [
        "HOST BLOCKER: microAppRoute('applications', ...) needed in BOTH host route trees; the employee entry blocks the handler journey (inbox CTA opens a new tab = cold URL load), so that PR must land WITH this work.",
        "Scope grew by two requirements (answers surface, cancel) - machinery that existed with no requirement behind it.",
        "BE ask #5 (requester-readable process list) is open; multi-process companies get an error where the design promised a picker.",
        "The FriendlyID mechanism was verified from configuration, not a live payload; the first live-API smoke test should confirm it at the wire."
      ],
      artifacts: [
        { path: "verification/spec-audit.md", label: "Spec audit + orchestrator correction", html: null },
        { path: "implementation/spec.md", label: "Specification revision 2 (697 lines)", html: "implementation/spec.html" }
      ], gate: { question: "Continue to implementation planning?", answer: "Continue to Phase 7: Planning" } },
    { id: "phase-7", name: "Plan implementation", icon_hint: "plan", status: "completed", started: "2026-08-12T09:45:18Z", completed: "2026-08-12T09:56:03Z", skip_reason: null,
      summary: "25 task groups (22 code, 1 test review, 2 non-code), 148 steps, 6 dispatch waves, ~96 tests. Visual coverage 18/18. Surgical acme-portal.d.ts runs alone first; WITHDRAWN sweep follows immediately.",
      decisions: [
        { decision: "acme-portal.d.ts surgical type add is Group 1, alone, first", rationale: "Nothing typechecks until the 3 APPLICATIONS_* Permission members exist; avoids ~400 lines of master drift." },
        { decision: "Group 6 creates all 7 views as stubs plus both barrels", rationale: "Later view groups own exactly one file each, which is what makes Wave D parallel." },
        { decision: "Group 4 lands the full ~155-key i18n inventory in all 8 locales upfront", rationale: "Removes the worst shared-file contention - 8 JSON files against 13 UI groups." },
        { decision: "All 7 external WIDGET edit sites in one group with the activeTab regression spec", rationale: "A 468-line file with no tab registry gets one owner." },
        { decision: "Blocked process picker is Group 24, labelled and unstarted", rationale: "Deferral stays visible rather than silently dropped." }
      ],
      risks: [
        "Feature test total (~96) exceeds the 16-34 single-feature guidance, though per-group limits are respected.",
        "BE ask #5 OPEN - the v1 single-process create path is correct only while one enabled process exists per company.",
        "repo-beta EMPLOYEE_ROUTING entry is a functional blocker for the handler journey; landing it is outside this task's gates.",
        "Six files are touched by multiple groups - declared per group so the executor serializes them.",
        "Requirement 25 (cancel) has no dedicated mockup; planned inside Group 13 without inventing a screen ID."
      ],
      artifacts: [
        { path: "implementation/implementation-plan.md", label: "Implementation plan (25 groups, 148 steps)", html: "implementation/implementation-plan.html" },
        { path: "implementation/visual-coverage.md", label: "Visual coverage (18/18 screens)", html: null }
      ], gate: { question: "Continue to implementation?", answer: "Start implementation (parallel waves, Sonnet implementers)" } },
    { id: "phase-8", name: "Execute implementation", icon_hint: "code", status: "completed", started: "2026-08-12T13:22:31Z", completed: "2026-08-12T13:23:32Z", skip_reason: null,
      summary: "All 23 code groups delivered plus 3 unplanned remediations across 6 waves. Full suite 537/538 suites, 3436/3470 tests pass; the one failure is a pre-existing node-version environment check. typecheck / lint:strict / sheriff clean.",
      decisions: [
        { decision: "Removed the feature root barrel rather than adding four sub-barrels", rationale: "widget and adminCadence prove the no-root-barrel shape; one deletion cleared all 18 sheriff violations." },
        { decision: "Ran the integration pass BEFORE the final wave", rationale: "Seven groups still had to write into those directories; fixing first meant they inherited the structure." },
        { decision: "Process editor is a full page, not a drawer", rationale: "Mockup evidence; Group 21 also found the registered child routes were dead - no Outlet existed." },
        { decision: "Accepted a justified breach of the no-new-i18n-keys rule", rationale: "No Approve/Reject imperative existed; hardcoded English would violate a CRITICAL rule that outranks the instruction." },
        { decision: "Conflict rows show a shared cause rather than fabricated per-row reasons", rationale: "The BE carries only the first offending id; inventing a timestamp would be incorrect data presented as fact." }
      ],
      risks: [
        "Group 24 (>1-process requester picker) deliberately unimplemented pending BE ask #5.",
        "The repo-beta host changeset is documented but NOT applied - /e/applications/:requestId 404s on a cold load, which is the handler journey.",
        "Live API unavailable until the auth repo ships the applications permission domain; every endpoint 403s.",
        "OPEN PRODUCT QUESTION: process-editor Save blocks on known-zero resolution but not while the preview is in flight.",
        "resetMocks:true means a module-level mockReturnValue not re-armed in beforeEach passes for the wrong reason."
      ],
      artifacts: [
        { path: "implementation/work-log.md", label: "Work log (23 groups + 3 remediations)", html: null },
        { path: "implementation/implementation-plan.md", label: "Implementation plan (all groups complete except deferred G24)", html: "implementation/implementation-plan.html" },
        { path: "implementation/host-changeset.md", label: "repo-beta host changeset (ready to apply)", html: null }
      ], gate: { question: "Continue to verification?", answer: "All four standard verifications; E2E skipped (no live API)" } },
    { id: "phase-10", name: "Prompt verification options", icon_hint: "verify", status: "completed", started: "2026-08-12T13:23:32Z", completed: "2026-08-12T13:23:32Z", skip_reason: null, summary: "All four standard verifications enabled: code review, pragmatic review, reality check, production readiness. E2E disabled - every applications endpoint 403s until the auth-repo permission domain ships.", decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-11", name: "Verify implementation & resolve issues", icon_hint: "verify", status: "completed", started: "2026-08-12T13:23:32Z", completed: "2026-08-12T14:54:59Z", skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-12", name: "Run E2E tests", icon_hint: "verify", status: "skipped", started: null, completed: null, skip_reason: "No live API: every applications endpoint 403s until the auth repo ships the permission domain, and /e/applications 404s until the host changeset lands. Recorded as a post-merge task.", summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-13", name: "Generate user documentation", icon_hint: "docs", status: "skipped", started: null, completed: null, skip_reason: "Deferred until the auth permission domain lands - with no live API the guide could not carry real screenshots. Recorded as a post-rollout follow-up.", summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-14", name: "Finalize workflow", icon_hint: "done", status: "completed", started: "2026-08-12T14:56:59Z", completed: "2026-08-12T15:03:58Z", skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null }
  ],
  verification: {
    status: "passed",
    reverify_count: 1,
    issues: [
      { severity: "critical", category: "i18n", description: "i18n:validate failed with 20 orphan keys, blocking pre-push and CI", fixable: true, fixed: true },
      { severity: "critical", category: "regression", description: "403 regression on the pre-existing My Enrollments view - CTA query fired before the permission check", fixable: true, fixed: true },
      { severity: "critical", category: "correctness", description: "Approve-race rendered an untranslated hardcoded error and stranded the modal", fixable: true, fixed: true },
      { severity: "warning", category: "missing-feature", description: "PROCESS_AMBIGUOUS computed and translated but rendered by no component", fixable: true, fixed: true },
      { severity: "warning", category: "ux", description: "CTA opened the picker with no preselection", fixable: true, fixed: true },
      { severity: "warning", category: "security", description: "Catalog route ungated - only the tab chip was conditional", fixable: true, fixed: true },
      { severity: "warning", category: "correctness", description: "Read-only answers section could render an editable, auto-saving survey", fixable: true, fixed: true },
      { severity: "warning", category: "correctness", description: "WITHDRAWN responses trapped the viewer on section 1", fixable: true, fixed: true },
      { severity: "warning", category: "correctness", description: "Provisioning guard could never fire for >=2 processes", fixable: true, fixed: true },
      { severity: "warning", category: "error-handling", description: "List view had no isError branch - a 403 rendered the success empty state", fixable: true, fixed: true },
      { severity: "info", category: "release", description: "Host route registration and auth permission domain remain external release dependencies", fixable: false, fixed: false }
    ],
    fixes: [
      "3 criticals, 8 highs and the medium set fixed across 3 delegated fix groups",
      "18 orphan i18n keys deleted as superseded; 4 wired as genuine missing features",
      "SurveysListView act() flake fixed after proving the deterministic approach insufficient"
    ]
  }
};
