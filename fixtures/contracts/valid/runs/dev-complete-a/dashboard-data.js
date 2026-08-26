window.MAISTER_DATA = {
  generated: "2026-08-12T19:59:24Z",
  task: {
    title: "ACME-1001 [INV] My progress - backend support for employee progress summary",
    type: "development",
    status: "completed",
    description: "Investigation turned build: serve the employee's all-time learning progress metrics for the \"My progress\" tile (ACME-1002) in a single call. Deliverable is a new self-scoped endpoint GET /widget/enrollments/my/summary plus follow-up ticket drafts for the gaps. Northwind (WIDGET) go-live 1 October 2026.",
    path: ".maister/tasks/development/2026-08-11-acme-1001-my-progress-backend",
    current_activity: null
  },
  characteristics: {
    has_reproducible_defect: false,
    modifies_existing_code: true,
    creates_new_entities: true,
    involves_data_operations: true,
    ui_heavy: false
  },
  phases: [
    {
      id: "phase-1",
      name: "Analyze codebase & clarify requirements",
      icon_hint: "analysis",
      status: "completed",
      started: "2026-08-11T20:27:00Z",
      completed: "2026-08-11T20:27:00Z",
      skip_reason: null,
      summary: "Metrics 1 and 4 are servable today from widget_enrollment in one jOOQ query. Metric 2 (certificates) lives entirely outside the Java backend as plugin-owned custom objects. Metric 3 (actual time) exists for LEDGER only, as a monotonic MAX of a single session, with zero read sites. Verdict on four metrics in a single call: NO.",
      decisions: [
        { decision: "Deliverable = investigation report + implementation of servable metrics", rationale: "User overrode the ticket's 'not in scope: building any of it' boundary; tile needed for 1 Oct Northwind go-live" },
        { decision: "Metric 2 (certificates) dropped from the tile", rationale: "personCertificate rows are manually self-reported/imported, never awarded by learning completion - the count would misrepresent platform-earned achievement" },
        { decision: "Metric 3 = SUM(progress/100 * COALESCE(edition.duration_seconds, activity.duration_seconds)), labelled as an estimate", rationale: "Uses the existing per-enrollment progress column so in-flight activities contribute partial credit; one query, no new tracking" },
        { decision: "Follow-up Jira tickets drafted in the report, not created via acli", rationale: "User wants to review before anything is written to Jira" }
      ],
      risks: [
        "Metric 2 sits outside the SQL boundary - personCertificate is a plugin custom object in custom_resource* tables, so no join with widget_enrollment is possible and a single call cannot cover all four metrics.",
        "widget_enrollment.total_time_ms is a monotonic MAX of one LEDGER session, not a lifetime sum; SUM() over it yields \"best single session per activity\". True lifetime time needs SUM(widget_ledger_attempt.session_time_ms), a table in no jOOQ query today.",
        "No \"ACHIEVED\" status exists on personCertificate - ACTIVE/EXPIRING_SOON/EXPIRED are computed at read time. The definition of \"achieved\" is an unanswered product question.",
        "Two competing LEDGER implementations: core Java WIDGET vs plugin-ledger-player (which ships an i18n key ledger.activities.myProgress = \"My progress\"). Canonical one undecided.",
        "Learning paths are themselves enrollments (path_enrollment_id parent/child) - a naive COUNT of completed enrollments double-counts path steps plus the path itself.",
        "resolved: No composite (company_uuid, person_uuid, status) index on widget_enrollment - Phase 2 confirmed idx_widget_enrollment_company_person_status already exists."
      ],
      artifacts: [
        { path: "analysis/codebase-analysis.md", label: "Codebase Analysis - verdict per metric", html: null },
        { path: "analysis/clarifications.md", label: "Clarifications", html: null }
      ],
      gate: { question: "Continue to Phase 2?", answer: "Continue" }
    },
    {
      id: "phase-2",
      name: "Analyze gaps & clarify scope",
      icon_hint: "analysis",
      status: "completed",
      started: "2026-08-11T20:27:00Z",
      completed: "2026-08-11T20:27:00Z",
      skip_reason: null,
      summary: "Additive, low-complexity build - one JOOQ query service, one DTO record, one new method on WidgetEnrollmentController. No migration, no new table, no new permission. All nine gap-analysis decisions resolved; the broken metric-3 formula fixed with a query-side clamp, domain fix deferred to a follow-up ticket.",
      decisions: [
        { decision: "D1 - real elapsed-time capture is OUT of this build", rationale: "Triples scope, changes a shipped contract, yields near-zero numbers for months; becomes follow-up ticket #1" },
        { decision: "D2 - query-side clamp now, domain fix as follow-up", rationale: "CASE WHEN status='COMPLETED' THEN 1.0 ELSE progress/100.0 END works on all historical rows with zero blast radius" },
        { decision: "D3 - exclude LEARNING_PATH containers, count the steps", rationale: "Correct under nesting; parent progress is already a derived aggregate of its children" },
        { decision: "D4 - return duration-coverage counters with the estimate", rationale: "Two extra filterWhere in the same statement; lets ACME-1002 caveat the number without a second backend round" },
        { decision: "D5 - exclude DROPPED and FAILED from the time sum", rationale: "User call, against the analyzer's recommendation to include them at progress weight" },
        { decision: "D6 - exclude ARCHIVED activities from both metrics", rationale: "User call, against the analyzer's recommendation to keep them" },
        { decision: "D7 - guard with repo-alpha:widget:enroll", rationale: "Consistent with every other method on WidgetEnrollmentController including the sibling dashboard tile" },
        { decision: "D8 - GET /widget/enrollments/my/summary", rationale: "/my convention; controller already registered in pom.xml so no <classes> change" },
        { decision: "D9 - seconds in the DTO", rationale: "Matches the duration_seconds source; formatting is the frontend's job" }
      ],
      risks: [
        "resolved: BLOCKING - Enrollment.complete() does not set progress=100, so 4 of 6 completion paths would report ZERO learning time for every classroom TRAINING. Fixed by the D2 query-side clamp.",
        "Semantic/product risk: an estimate presented as a headline number, computed over an optional, author-supplied, client-declared field, on a tile going live for a named customer on 1 October.",
        "duration_seconds is nullable on both development_activity and widget_training_edition - an employee whose activities mostly lack a declared duration sees a plausible-looking but badly undercounted number with no cue.",
        "D6 consequence: excluding ARCHIVED means an employee's completed count and learning time can DROP retroactively when an admin archives an old course. The tile is not monotonic.",
        "D5 + D2 interaction: PENDING_APPROVAL should contribute 0 since progress is 0 - stated explicitly in the spec rather than left incidental.",
        "Tile now has three metrics, not four - design change must go back to the mockup thread before layouts freeze.",
        "acme-portal.d.ts regen must be the LAST step before commit; a later ./mvnw test silently re-emits the raw file and fails CI."
      ],
      artifacts: [
        { path: "analysis/gap-analysis.md", label: "Gap Analysis - current vs desired, 9 open decisions", html: null },
        { path: "analysis/scope-clarifications.md", label: "Scope Clarifications - all 9 decisions resolved", html: null }
      ],
      gate: { question: "Continue to Phase 5: Technical Approach, Requirements & Specification?", answer: "Continue" }
    },
    {
      id: "phase-3",
      name: "Write failing test (TDD Red)",
      icon_hint: "verify",
      status: "skipped",
      started: null,
      completed: null,
      skip_reason: "has_reproducible_defect is false - additive feature, no defect to reproduce",
      summary: null, decisions: [], risks: [], artifacts: [], gate: null
    },
    {
      id: "phase-4",
      name: "Generate UI mockups",
      icon_hint: "spec",
      status: "skipped",
      started: null,
      completed: null,
      skip_reason: "ui_heavy is false - backend-only task, no UI surface in this repo",
      summary: null, decisions: [], risks: [], artifacts: [], gate: null
    },
    {
      id: "phase-5",
      name: "Gather requirements & create specification",
      icon_hint: "spec",
      status: "completed",
      started: "2026-08-11T20:27:00Z",
      completed: "2026-08-11T20:27:00Z",
      skip_reason: null,
      summary: "Spec for one new self-scoped endpoint GET /widget/enrollments/my/summary returning six fields in a single statement. 15 requirements (FR1-FR10, NFR1-NFR5), 7 reusable components, 4 new components, 10 tests. No migration, no new permission, no pom.xml change.",
      decisions: [
        { decision: "Six response fields, not the three the tile shows", rationale: "Extras are free in the same statement; widening later costs a acme-portal.d.ts regen plus a frontend round trip" },
        { decision: "Learning time is an estimate, labelled as one", rationale: "Nothing measures elapsed time for non-LEDGER types; real capture deferred (D1)" },
        { decision: "Query-side completion clamp instead of the domain fix (D2)", rationale: "Enrollment.complete() never sets progress=100, so 4 of 6 paths would contribute zero time; clamp is read-only with zero blast radius" },
        { decision: "Exclude LEARNING_PATH by activity type, not path_enrollment_id (D3)", rationale: "Container progress is a derived aggregate of steps; type-based filter stays correct under nesting" },
        { decision: "Exclude ARCHIVED (D6) and DROPPED/FAILED (D5) in the WHERE", rationale: "Uniform application to every field including the coverage denominator" },
        { decision: "Strictly self-scoped via SecurityHelper (FR8)", rationale: "A manager variant needs different authorization and belongs on its own ticket" },
        { decision: "Reuse WidgetEnrollmentController and repo-alpha:widget:enroll (D7, D8)", rationale: "Controller-local consistency; already in pom.xml <classes>, so no pom edit" },
        { decision: "Round the weighted BigDecimal sum to whole seconds", rationale: "sum() yields BigDecimal while estimatedLearningSeconds is a primitive long - derived decision flagged by the spec author" }
      ],
      risks: [
        "Tile is not monotonic - archiving a course retroactively lowers counts and learning time (D6)",
        "lastActivityAt is MAX over the filtered set, so archived/dropped/failed access yields an older timestamp than expected",
        "Estimate rests on client-declared progress and author-optional duration_seconds; coverage counters are the only mitigation",
        "Tile drops from four metrics to three - design change that must go back to the mockup email thread before layouts freeze",
        "No mockup in either repo; DTO shape inferred from the ticket's named metrics",
        "Running ./mvnw test after the acme-portal.d.ts regen silently re-emits the raw file and fails CI - regen must be last"
      ],
      artifacts: [
        { path: "analysis/requirements.md", label: "Requirements - FR1-FR10, NFR1-NFR5", html: null },
        { path: "implementation/spec.md", label: "Specification", html: "implementation/spec.html" }
      ],
      gate: { question: "Continue to specification audit?", answer: "Continue" }
    },
    {
      id: "phase-6",
      name: "Audit specification",
      icon_hint: "verify",
      status: "completed",
      started: "2026-08-11T21:30:00Z",
      completed: "2026-08-11T21:30:00Z",
      skip_reason: null,
      summary: "Verdict pass-with-concerns: 0 critical, 7 warning, 10 info. Every load-bearing claim independently confirmed against the generated jOOQ schema, migrations and domain code. W1-W3 changed what an implementer writes and were resolved in a binding spec addendum rather than a spec rewrite.",
      decisions: [
        { decision: "Zero criticals despite a long finding list", rationale: "No finding makes the endpoint wrong for the common case or leaks tenant data; W2/W3 are correctness risks on specific data shapes, not the happy path" },
        { decision: "W2 (recurring double-count) rated most consequential", rationale: "Only finding where spec and schema disagree about what a number on the tile means, and no named test would catch it" },
        { decision: "Distinct-activity semantics adopted (W2 resolution)", rationale: "A recurring course completed three times counts as one activity and its duration is summed once - 'completed activities' reads literally" },
        { decision: "lastActivityAt widens to GREATEST(MAX(last_access_at), MAX(completed_at), MAX(started_at))", rationale: "last_access_at alone is stamped only by /play and LEDGER commits, so classroom-only employees would get a non-null count beside a null timestamp" },
        { decision: "Audit findings folded into an addendum + the plan, not a spec rewrite", rationale: "No spec round trip; the planner carries W1/W3/W6 as binding constraints C1-C4" }
      ],
      risks: [
        "The distinct-activity dedup needs a rule for which row's duration wins when the same activity was enrolled under editions of differing length. Rule chosen: highest-weight row, ties broken by the largest resolved duration. A judgement call, not a derived fact.",
        "activitiesCountedCount is now a count of distinct activities, so the coverage ratio reads \"activities with a known duration / distinct activities counted\". The DTO javadoc must say distinct or the frontend will misread the denominator.",
        "Unanswered: does a RECURRING activity completed three times count as 3 or 1 on the tile? The schema permits both readings; the addendum picks 1.",
        "Unanswered: are DRAFT-status activities deliberately included? D6 excluded only ARCHIVED, leaving DRAFT in by omission (I1)."
      ],
      artifacts: [
        { path: "verification/spec-audit.md", label: "Spec Audit - pass-with-concerns, 0/7/10", html: null },
        { path: "implementation/spec-addendum.md", label: "Spec Addendum - audit resolutions (binding, overrides spec.md)", html: null }
      ],
      gate: { question: "Continue to implementation planning?", answer: "Continue" }
    },
    {
      id: "phase-7",
      name: "Plan implementation",
      icon_hint: "plan",
      status: "completed",
      started: "2026-08-11T22:00:00Z",
      completed: "2026-08-12T07:04:44Z",
      skip_reason: null,
      summary: "Five task groups, 28 steps, 12-22 tests. Groups 1-2 build the two-level jOOQ query (inner per-activity dedup, outer aggregate) test-first; Group 3 wires the controller and runs parallel with Group 2 once Group 1 lands. Group 4 is review + quality gates. Group 5 is the acme-portal.d.ts regen, deliberately terminal. C1-C4 each map to a named step AND a named test assertion.",
      decisions: [
        { decision: "Query split across two groups, not one", rationale: "Group 1 proves the aggregate shape and arithmetic (C2), Group 2 layers filters and distinct-activity dedup (C1); ten query tests in one group would breach the 2-8 limit" },
        { decision: "Controller group depends only on Group 1", rationale: "It needs the DTO and service signature, not final query semantics - lets Groups 2 and 3 run concurrently on disjoint files" },
        { decision: "acme-portal.d.ts regen is its own terminal group, after the testing group", rationale: "Inverts the usual 'testing last' convention on purpose - any subsequent Maven test run silently reverts the regen and fails CI" },
        { decision: "Follow-up ticket drafting folded into Group 4", rationale: "Success criterion #9 is a deliverable of the [INV] ticket, not a code change; belongs with the review pass" },
        { decision: "The D2 weight clamp is implemented in Group 1 but asserted in Group 2", rationale: "The clamp is arithmetic; the attendance-completed-TRAINING scenario is a filter/semantics fixture - cross-group dependency made explicit" }
      ],
      risks: [
        "Shared-file contention on AbstractControllerTest - a repo-wide test base. Group 3 is the only group that touches it; a concurrent branch edit fails every controller test in the repo on merge, not on build.",
        "The GREATEST fold (R2) must be verified as SQL, not Java. jOOQ's DSL.greatest(...) over three max(...) aggregates should render server-side; a Java-side fold silently changes null handling. No test can distinguish the two - it is a code-review item.",
        "The dedup tie-break rule (max(weight), ties -> max(resolved_duration)) is a judgement call. If the number looks wrong in review, question this first.",
        "activitiesCountedCount changed meaning under C1 - distinct activities, not enrollments. If the DTO javadoc omits \"distinct\", ACME-1002 will misread the coverage denominator.",
        "The endpoint ships with no consumer in this repo. docs/acme-portal.d.ts is the only handoff artifact; a shape error surfaces in the frontend repo, not here."
      ],
      artifacts: [
        { path: "implementation/implementation-plan.md", label: "Implementation Plan - 5 groups, 28 steps", html: "implementation/implementation-plan.html" }
      ],
      gate: { question: "Continue to Phase 8: implementation?", answer: "Continue to implementation (parallel waves)" }
    },
    {
      id: "phase-8",
      name: "Execute implementation",
      icon_hint: "code",
      status: "completed",
      started: "2026-08-12T07:04:44Z", completed: "2026-08-12T09:41:55Z", skip_reason: null,
      summary: "All 5 task groups and 28 steps complete across 4 waves (Groups 2 and 3 ran in parallel). 23 feature tests green, compile and checkstyle clean, acme-portal.d.ts regenerated to a clean +15/-0 diff. Endpoint GET /widget/enrollments/my/summary ships with 3 new files and 4 modified. Full project suite deliberately NOT run - it would re-emit the raw acme-portal.d.ts.",
      decisions: [
        { decision: "Group 1 implemented the C1 dedup projections and R2 GREATEST ahead of plan", rationale: "The outer aggregate cannot compile without inner columns to aggregate; Group 2's 2.3/2.5 became verification + regression tests rather than construction" },
        { decision: "currently_in_progress computed at the OUTER level, not the inner", rationale: "The addendum's max(status = IN_PROGRESS and not ever_completed) cannot be expressed inside a single grouped select - ever_completed is itself an aggregate of the same group. Outer filterWhere(EVER_IN_PROGRESS.eq(1).and(EVER_COMPLETED.eq(0))) is semantically identical" },
        { decision: "Private asLong(Field<Integer>) helper casting to BIGINT", rationale: "jOOQ types count() as Field<Integer> while Postgres returns bigint; aliasing onto Field<Long> produced ClassCastException. Load-bearing, not incidental" },
        { decision: "Two strategic tests added in Group 4 (budget was 10)", rationale: "The max(resolved_duration) tie-break was documented but untested (the addendum's own flagged judgement call), and NOT_STARTED/PENDING_APPROVAL zero-weight-but-counted was untested" },
        { decision: "Single-statement query-log assertion NOT added", rationale: "Group 2's rendered SQL already proves the inner grouped select is a derived table; a statement-counting listener would couple the suite to implementation against test-writing.md" },
        { decision: "Full project test suite NOT run at finalization", rationale: "It would silently re-emit the raw acme-portal.d.ts and reintroduce the 38-line discriminator regression Group 5 just repaired. build-workflow.md, the plan's terminal-group design, and step 5.5 all forbid it. Deferred to the operator" },
        { decision: "AbstractControllerTest mock declared with an FQCN", rationale: "Every one of that file's @MockitoBean declarations uses FQCNs; importing would break the established local convention. Checkstyle passes" }
      ],
      risks: [
        "Full project test suite has NOT been run. If the operator wants it, the safe ordering is run suite -> re-run the two-step regen -> commit. Never git checkout docs/acme-portal.d.ts as the repair.",
        "docs/acme-portal.d.ts must go into the SAME commit as the Java changes, and no Maven test lifecycle may run between now and the commit.",
        "resolved: the R2 GREATEST fold was a code-review item no test could settle - Group 2 captured the rendered SQL and confirmed a server-side greatest(...), no Java-side fold.",
        "resolved: docs/acme-portal.d.ts was found as a RAW re-emit (20 ins / 38 del, discriminator aliases stripped) from an earlier test run. Group 5's two-step regen repaired it to a clean +15/-0.",
        "Parallel waves share one Maven target/ directory - a sibling recompile caused a transient NoClassDefFoundError during Spring context load. Re-run resolved it; no code defect.",
        "fix-acme-portal-dts-discriminators.sh appends the permission-scope alias block unconditionally with cat >>; running it twice against one generated file duplicates the block. Never run it standalone against an already-fixed file.",
        "check-acme-portal.d.ts.sh exits 1 until the file is committed - its second gate is an uncommitted-changes check. The discriminator gates themselves pass."
      ],
      artifacts: [
        { path: "implementation/work-log.md", label: "Work Log - 5 groups, 4 waves, standards trail", html: null },
        { path: "implementation/follow-up-tickets.md", label: "Follow-Up Ticket Drafts - 5 tickets with evidence", html: null },
        { path: "implementation/implementation-plan.md", label: "Implementation Plan - 28/28 steps checked", html: "implementation/implementation-plan.html" }
      ],
      gate: { question: "Full suite handling + continue to verification?", answer: "Run suite then re-run the regen; continue to Phase 10" }
    },
    {
      id: "phase-10",
      name: "Prompt verification options",
      icon_hint: "verify",
      status: "completed",
      started: "2026-08-12T09:41:55Z", completed: "2026-08-12T09:41:55Z", skip_reason: null,
      summary: "All four standard verifications enabled (code review, pragmatic review, reality check, production readiness). Test suite re-enabled per the Phase 8 decision. User docs skipped - backend endpoint with no UI surface.",
      decisions: [
        { decision: "Test suite re-enabled (skip_test_suite: false)", rationale: "Operator chose the full suite at the Phase 8 gate; Phase 11 runs it so it executes once, with the acme-portal.d.ts regen re-run afterwards as the final pre-commit action" },
        { decision: "User documentation skipped", rationale: "Backend endpoint with no UI and no end-user surface; the docs generator drives Playwright and would have nothing to screenshot" },
        { decision: "Reality check and production readiness run despite weak fit", rationale: "Operator elected full coverage after being told both were thin here - no config/migration/permission change, and no in-repo consumer of the endpoint" }
      ],
      risks: [],
      artifacts: [],
      gate: { question: "Which verifications + generate user docs?", answer: "All four verifications; skip user docs" }
    },
    {
      id: "phase-11",
      name: "Verify implementation & resolve issues",
      icon_hint: "verify",
      status: "completed",
      started: "2026-08-12T09:41:55Z", completed: "2026-08-12T12:16:02Z", skip_reason: null,
      summary: "Five verifications ran. Initial: 1 critical / 5 warning / 9 info. All five warnings plus two info items fixed in one pass and re-verified - 6668 tests, 6648 passing, +3/+3 delta and zero regressions. Production readiness GO; pragmatic review found it not over-engineered. The one critical (acme-portal.d.ts raw re-emit) was resolved by the terminal regen.",
      decisions: [
        { decision: "W4 resolved as WINNING-ROW semantics - the javadoc was right, the code was wrong", rationale: "Operator decision. spec-addendum.md contradicted itself (prose: winning-row; pseudocode: independent-max); independent-max overstated learning time on multi-edition recurring enrollments, always upward" },
        { decision: "Targeted re-verification (test suite only) rather than all five agents", rationale: "Four of the five had no findings against the changed lines; the W4 query change is what needed regression cover" },
        { decision: "The AbstractControllerTest FQCN was NOT raised as a finding", rationale: "Two independent reviewers judged local consistency should win in a 670-line file where every declaration uses FQCNs; it belongs in a whole-file pass or nowhere" },
        { decision: "Success criterion #2 accepted as verified-by-inspection", rationale: "A query-log counting test asserts an implementation detail against test-writing.md; the structural guarantee (one .from(perActivity), no second fetch) is stronger than a count" },
        { decision: "Operator handles the design-thread conversation and Jira ticket creation directly", rationale: "Both are outside the code; the drafts were deliberately held back from Jira for review" }
      ],
      risks: [
        "W4 is a live behaviour change for existing users - anyone whose highest-weight enrollment is not their longest-duration enrollment sees estimatedLearningSeconds DROP. Always downward; the old value was the inflated one. No DTO shape change, so no frontend contract impact.",
        "The 4->3 metric change never went back to the 'Mockup - dashboard + Strefa Rozwoju' thread. Raising it now costs a conversation; in September it costs a redesign. Operator is handling it.",
        "The five follow-up ticket drafts are the only durable record of why the number is an estimate - they die with this task directory if never created in Jira. Operator is handling it.",
        "The 'it's an estimate' caveat does not cross the repo boundary - typescript-generator emits doc comments for controller methods only, so the DTO interface in acme-portal.d.ts carries none.",
        "resolved: docs/acme-portal.d.ts raw re-emit - repaired by the terminal two-step regen (+15/-0, aliases restored).",
        "resolved: three load-bearing predicates (person_uuid scoping, lastActivityAt widening, not-ever_completed guard) had no test that would fail on deletion - each now has one."
      ],
      artifacts: [
        { path: "verification/implementation-verification.md", label: "Verification Report - post-fix verdict + Fix History", html: "verification/implementation-verification.html" },
        { path: "verification/code-review-report.md", label: "Code Review - 0/3/3", html: null },
        { path: "verification/pragmatic-review.md", label: "Pragmatic Review - not over-engineered", html: null },
        { path: "verification/production-readiness-report.md", label: "Production Readiness - GO, 0 blockers", html: null },
        { path: "verification/reality-check.md", label: "Reality Check - 2 false completions named", html: null },
        { path: "verification/test-suite-results.md", label: "Test Suite - baseline 6645/6665", html: null },
        { path: "verification/test-suite-results-reverify.md", label: "Test Suite - post-fix 6648/6668", html: null }
      ],
      gate: { question: "Continue to Phase 14?", answer: "Run the regen, then finalize" }
    },
    {
      id: "phase-12",
      name: "Run E2E tests",
      icon_hint: "verify",
      status: "skipped",
      started: null, completed: null,
      skip_reason: "e2e_enabled false - backend-only task, no browser surface in this repo",
      summary: null, decisions: [], risks: [], artifacts: [], gate: null
    },
    {
      id: "phase-13",
      name: "Generate user documentation",
      icon_hint: "docs",
      status: "skipped",
      started: null, completed: null,
      skip_reason: "Operator decision at Phase 10 - backend endpoint with no UI surface to document or screenshot",
      summary: null, decisions: [], risks: [], artifacts: [], gate: null
    },
    {
      id: "phase-14",
      name: "Finalize workflow",
      icon_hint: "done",
      status: "completed",
      started: "2026-08-12T19:59:24Z", completed: "2026-08-12T19:59:24Z", skip_reason: null,
      summary: "Terminal acme-portal.d.ts regen executed and verified clean (+15/-0, discriminator aliases and PermissionScopeDtoUnion restored). Working tree is commit-ready: 3 new files, 4 modified. No Maven lifecycle may run before commit.",
      decisions: [
        { decision: "Regen run as the final action, after all test execution", rationale: "Any ./mvnw test/verify re-emits the raw file and fails CI's up-to-date gate - this ordering is the whole reason Group 5 was designed as terminal" }
      ],
      risks: [
        "docs/acme-portal.d.ts must go into the SAME commit as the Java changes, and no Maven test lifecycle may run between now and the commit - a later run silently reverts it.",
        "check-acme-portal.d.ts.sh exits 1 until the file is committed (uncommitted-changes gate only - the discriminator gates pass). It goes green on commit."
      ],
      artifacts: [
        { path: "implementation/follow-up-tickets.md", label: "Follow-Up Ticket Drafts - 5 tickets, held for review", html: null },
        { path: "analysis/codebase-analysis.md", label: "Investigation deliverable - verdict per metric", html: null }
      ],
      gate: null
    }
  ],
  verification: {
    status: "passed_with_issues",
    reverify_count: 1,
    issues: [
      { severity: "critical", category: "build", description: "docs/acme-portal.d.ts was a RAW re-emit - discriminator aliases stripped; CI gate 1 failed. Repaired by the terminal two-step regen: diff is now +15/-0, CompareOp/CompoundOp aliases and PermissionScopeDtoUnion restored", fixable: true, fixed: true },
      { severity: "warning", category: "correctness", description: "Dedup took max(weight) and max(duration) as INDEPENDENT aggregates, overstating learning time on multi-edition recurring enrollments (1h-completed + 24h-partial yielded 86400s, not 3600s)", fixable: true, fixed: true },
      { severity: "warning", category: "test-coverage", description: "person_uuid scoping had no test that would fail if deleted - would have leaked company-wide totals to every employee", fixable: true, fixed: true },
      { severity: "warning", category: "test-coverage", description: "lastActivityAt had no non-null assertion; reverting the R2 GREATEST widening would have left all 12 tests green", fixable: true, fixed: true },
      { severity: "warning", category: "test-coverage", description: "The 'and not ever_completed' guard was never the reason any assertion held", fixable: true, fixed: true },
      { severity: "warning", category: "documentation", description: "DTO javadoc omitted what lastActivityAt is composed of - the DTO is the frontend's only handoff artifact", fixable: true, fixed: true },
      { severity: "info", category: "semantics", description: "activitiesCountedCount includes NOT_STARTED/PENDING_APPROVAL, so coverage reads best exactly where the estimate is thinnest - spec-deliberate, code matches spec", fixable: false, fixed: false },
      { severity: "info", category: "documentation", description: "The estimate caveat does not cross the repo boundary - typescript-generator emits doc comments for controller methods only, so the DTO interface carries none", fixable: false, fixed: false },
      { severity: "info", category: "documentation", description: "spec.md was never edited for R2/R4/R6 - a reader landing there alone gets three superseded statements", fixable: true, fixed: true },
      { severity: "info", category: "test-fixture", description: "Test fixture stamped STARTED_AT unconditionally, modelling a state the domain cannot produce", fixable: true, fixed: true },
      { severity: "info", category: "error-handling", description: "No QueryTimeoutException mapping - a timeout is a bare 500. Failing loudly is arguably correct; the fix belongs in frontend copy", fixable: true, fixed: false },
      { severity: "info", category: "observability", description: "http.server.requests is disabled platform-wide by the metrics allow-list - no per-endpoint latency series for any endpoint. Pre-existing, own ticket", fixable: false, fixed: false },
      { severity: "info", category: "correctness", description: "Only ARCHIVED is excluded, so a DRAFT activity with a live enrollment would count. Unreachable today", fixable: true, fixed: false },
      { severity: "info", category: "simplification", description: "Triple null defence - only the coalesce around sum can fire; ~8 redundant lines", fixable: true, fixed: false },
      { severity: "info", category: "environment", description: "SpringBatchJobRepositorySchemaTest fails deterministically from stale reused Testcontainers holding committed batch rows. Remedy: docker rm -f upbeat_lumiere confident_cori", fixable: false, fixed: false }
    ],
    fixes: [
      "W4 - winningRowDuration(...) helper rendering (array_agg(resolved_duration ORDER BY weight DESC NULLS LAST, resolved_duration DESC NULLS LAST))[1]; still one statement, one grouping level",
      "W1 - new test shouldExcludeAnotherPersonsEnrollmentsInTheSameCompany",
      "W2 - exact-value isEqualTo(COMPLETED_AT) added to the existing attendance test (no 13th test)",
      "W3 - new test shouldCountActivityCompletedAndInProgressAgainAsCompletedOnly",
      "W5 - DTO javadoc composition sentence",
      "I8 - fixture stamps timestamps only for states the domain can produce",
      "I3 - one-line precedence pointer under spec.md's H1",
      "Re-verified: 6668 total / 6648 passing / 0 regressions (+3 = exactly the added tests)"
    ]
  }
};
