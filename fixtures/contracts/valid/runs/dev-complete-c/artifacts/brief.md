# Product Brief - Catalog Applications UI

**Task**: `.maister/tasks/product-design/2026-08-11-catalog-applications-ui` | **Date**: 2026-08-11 (delta-updated same day) | **Status**: Approved for development handoff

## TL;DR
Frontend for the `repo-alpha` backend's new `applications` module: employees enrolled in a WIDGET training edition request overnight catalog via a survey-backed form; a configured handler group decides (first decision wins); a coordinator exports approved requests as CSV and separately attests the handoff. The design is **"one feature module, one detail route, three doors"**: a new employee WIDGET tab + contextual CTAs (requester), a myActions deep-link into a shared capability-driven detail page (handler), and an `/admin/catalog` console (coordinator). Zero new UI machinery - everything composes the existing survey renderer, action inbox, WIDGET shell, and shared primitives. The **backend contract asks (D12) are settled** - all answered in the BE's `fe-contract-handoff.md` (2026-08-12); build against its Sec.1 shapes.

## Key Decisions
D1-D12 in `analysis/design-decisions.md`. Headlines: hybrid placement; shared detail route `/e/applications/:requestId`; detail-page-as-waiting-room for the async form gap; embedded `SurveyRespondentView`; chip pair + timeline (never a stepper); "Edit request" wrapping withdraw+replace; selection-preserving unrecorded-export banner; composed TeamsUPeople handler picker; honest "published != delivered" diagnostics.

## Open Questions & Risks
- **Sequencing (delta)**: BE Groups 12/14/15/16 are DONE (commit `57afcefb5`, PR #2562 open) + an uncommitted **Application Process** refactor that is the authoritative contract. Remaining blockers: PR #2562 merge + `auth`-repo permission-domain deploy.
- **BE asks - ALL ANSWERED** (BE `fe-contract-handoff.md`, 2026-08-12, BE @ `e1961c7a7`): detail-DTO flattening [x], plain-text labels [x] (`ApplicationAnswerDto`), `editionEndDate` [x] (rides PR #2562), event-grain resend [x] (`POST /{id}/notifications/{eventKey}/resend` - synthetic rows resendable, no FE degradation), process `warnings[]` [x] (stable codes, no survey-questions read); CTA URL [ ] -> `SUBJECT_ROUTE_BUILDERS` fallback is plan of record; batch drill-down deferred (agreed `GET /handoff/batches/{id}` follow-up; v1 hides re-download).
- `SurveyResponseStatus` gains `WITHDRAWN` on the next `acme-portal.d.ts` regen - repo-wide switch sweep required.
- Polish copy needs a native pass; host left-nav link for the admin console is a recorded follow-up.

---

## Layer 0 - Core Brief

### Problem
Employees enrolled in MAP trainings cannot request overnight catalog in-product; deciders have no reliable shared queue; coordinators have no auditable handoff to the external provider. The backend closes the loop; it has no UI. Full statement: `analysis/problem-statement.md`.

### Target users
- **Ewa - requester** (`applications:request`): raises a request from her training's context, tracks it in one place.
- **Tomasz - handler** (`applications:decide`, possibly nothing else): decides from his existing action inbox in one click; never needs a WIDGET-manager permission.
- **Agata - coordinator** (`applications:manage`, company-wide by design): configures survey + handler group, exports CSV, attests handoff, diagnoses notifications.
- Explicit non-persona: the line manager - **no surface in v1**.

### Feature overview
1. **Employee WIDGET tab "Catalog"** (`/e/development-center/catalog`, inside `ActivityCatalogView` shell) - cursor-infinite request list with status-chip pairs, New-request eligible-subjects picker; plus `CatalogCta` on enrollment/edition cards.
2. **Shared detail page** `/e/applications/:requestId` - one URL for the request's whole life: preparing state (polling, C2), embedded survey fill, awaiting/decided/withdrawn states, summary strip (check-in/out/nights via `referenceKey`), read-only survey embed, timeline with lineage, capability-driven action bars (Edit/Withdraw for owner; Approve/Reject-with-reason for asked handlers; Cancel + diagnostics for manage).
3. **Handler flow** - BE action item (already implemented) deep-links to the detail; first-decision-wins races and stale asked-sets resolve as page states, never error toasts.
4. **Coordinator console** `/admin/catalog` - Handoff (multi-select capped at 100, Download CSV, persistent "nothing recorded" banner, Confirm-handoff attest dialog), Batches (history; re-download arrives with the agreed `GET /handoff/batches/{id}` fast-follow), **Processes** (CRUD over `/applications/processes` - per-process SurveySelector + reference-key warning, TeamsUPeople handler picker with live resolved preview, enabled toggle, save blocked at zero; grouped by `typeKey`).
5. **Notification diagnostics** on the detail (manage-only) - event-grouped attempt log with first-class `EXPECTED_MISSING` synthetic rows, per-row resend, standing "published != delivered" caveat.

### Constraints (full list: problem-statement C1-C17)
Form is a survey (reuse renderer) | create can't return `surveyResponseId` (poll) | edit = withdraw+prefilled replacement | decide requires asked-set membership, no manage bypass | first-decision-wins 409s | `handedOff` orthogonal to status | coordinator unscoped by team | cursor pagination | no handed-off notification | one open request per (person, edition) | Chakra v3 tokens + WIDGET status colors | 8 locales | Sheriff/route/API standards | new host-nav entry deferred.

### Success criteria
S1-S12 in `analysis/problem-statement.md` Sec.5; measured by the acceptance criteria below.

### Acceptance criteria (condensed from `analysis/feature-spec.md` Sec.8.4)
1. Request raised from an enrollment card without navigation instruction; duplicates pre-empted (C10).
2. `FORM_PENDING` survives refresh/leave/return; patient >30s copy; no error state for normal latency.
3. Same URL flips to tracking view on submit with "sent to the catalog team" confirmation.
4. Decide-only handler reaches detail from inbox CTA, decides in <=2 clicks; race loss renders decided state, zero error toasts.
5. Reject impossible without reason; reason reaches requester verbatim.
6. Config with live resolved count; save at 0 impossible.
7. Export changes nothing; unrecorded banner persists until attest; Batches answers "what went out when".
8. `EXPECTED_MISSING` rows distinct; caveat always visible; resend repairs real rows.
9. Chip pair everywhere; handed-off never merged into status.
10. 8 locales, native Polish pass, "published" vocabulary held.
11. No new machinery beyond the Sec.7.1 component compositions.
12. BE ask list settled (fe-contract-handoff.md, 2026-08-12) - build against its Sec.1 shapes.
