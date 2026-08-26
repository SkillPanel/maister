# Specification: Catalog Applications UI (`src/features/applications/`)

**Revision 2** - 2026-08-12, post-audit. Supersedes revision 1. Audit: `../verification/spec-audit.md` (7 critical / 26 major / 14 minor) as revised by its **ORCHESTRATOR CORRECTION** (C1-C3 false positives -> 4 critical). Every finding is dispositioned in Sec.D.

## TL;DR
Build a new `src/features/applications/` module implementing "one feature module, one detail route, three doors": a requester WIDGET tab + enrollment CTA, a handler arriving from the My-actions inbox, and a coordinator console - all converging on one capability-driven full-page detail at `/e/applications/:requestId` that embeds the existing survey responder. Revision 2 folds in the independent audit: the FriendlyID alarm was a false positive and the identity comparisons stand (Sec.T3a), but 4 real criticals and all 40 major/minor findings are applied - every error literal now carries its `APPLICATION_` prefix, the `"application-request"` subject key is stated verbatim, the amendment register is rebuilt as a single `CC1-CC22` series, and the requester process picker is gated behind BE ask #5. The console is renamed **`/admin/applications`** for multi-type readiness, since the Angular host enumerates admin slugs and a type-specific slug would cost a cross-repo PR per future type.

## Key Decisions
- **The approved feature spec is the contract; this spec amends it.** Sec.1-Sec.8 stay binding except where a `CC` entry (Sec.T3b) or a supersession note (Sec.T17) overrides them - every override is now enumerated exactly once.
- **Identity encoding is a non-issue and is recorded as such (Sec.T3a).** `FriendlyIdModule` is registered globally, so `java.util.UUID` fields serialize *as* base62 and deserialize *from* base62. `isOwner`, the `subjectUuid === editionId` lookup and the flat `sources[]` payload all stand unchanged.
- **Console renamed `/admin/catalog` -> `/admin/applications`.** The host enumerates admin slugs, so a type-specific slug costs a cross-repo host PR per future application type; one generic slug is registered once. Catalog becomes a type *context inside* the console, not a URL segment. The rest of the generalization is deliberately **not** built (Sec.T16).
- **The requester process picker requires BE ask #5.** `GET /applications/processes` is `applications:manage`-only, so a requester 403s. Interim: omit `processId`, let the server resolve the sole enabled process, surface `APPLICATION_PROCESS_AMBIGUOUS` as an error - valid **only while one process exists per company**.
- **Every error literal carries the `APPLICATION_` prefix** and is reproduced with its verified HTTP status in Sec.T8a. Without this, every race/conflict branch falls through to the generic toast and three requirements plus Success Criterion 4 quietly fail.
- **The `SUBJECT_ROUTE_BUILDERS` key is `"application-request"`, stated verbatim** - three near-miss literals live in the same BE file and a wrong key 404s silently on the handler's only entry point.
- **`ApplicationAnswerDto.value` is a jsonb-as-text envelope**, `JSON.parse`d in try/catch, tolerant of both `"2026-10-05"` and `[2026,10,5]` payload forms.
- **`acme-portal.d.ts` is edited surgically** - 26 interfaces + 8 unions + 3 `Permission` members + `SurveyResponseStatus.WITHDRAWN`, enumerated in Sec.T2 (audited as line-accurate; unchanged in this revision).
- **The handler picker composes `TeamSelect` + `PersonMultiSelect`**, a recorded deviation from `standards/frontend/shared-audience-picker.md` - the BE contract is a flat `sources[]`, not a `CriteriaUnion`. **The standard is not being amended**; the deviation is documented here as the record.

## Open Questions / Risks
- **BE ask #5 (requester-readable process list) is open.** Until it lands, requirement 4's multi-process picker is unbuildable and the interim single-process path is the only correct behaviour. It expires the moment a second type or a second process ships.
- **`/e/applications` and `/admin/applications` break on refresh and deep-link until the host PR lands** (Sec.T14). The handler's inbox CTA crosses `/m/` -> `/e/` and therefore opens a **new tab** - a fresh URL load - so the employee host route is a functional blocker for the handler journey, not polish.
- **Identity encoding is verified by reading the auto-configuration, not at the wire** (Sec.T3a). The first live-API smoke test must confirm a request payload round-trips; cheap to check, expensive to be wrong about.
- **The jsonb date form is unconfirmed at runtime** - nothing pins `WRITE_DATES_AS_TIMESTAMPS` and no BE test asserts the literal text of a `DateAnswer`. The parser therefore accepts both string and `[y,m,d]` array forms (Sec.T6).
- **`CC9` (no edition dates or location on the detail/list/pending DTOs) degrades eight binding surfaces**, not the two revision 1 admitted. BE follow-up ask filed alongside `outcomeReason` exposure and batch drill-down.
- **Withdraw/cancel reasons are write-only** - persisted to `outcomeReason` but exposed on no response DTO, so the timeline cannot show them (Sec.CC11).
- **Live API is unavailable** until the `auth` repo ships the `applications` permission domain (every endpoint 403s). Gates E2E only. Also pending BE-side: `definedOnPerson=true` confirmation on `APPLICATIONS_REQUEST`/`APPLICATIONS_DECIDE`; 3 Notifier templates x 2 languages.
- **`askedPeople` is request-level, not step-level** - `canDecide` is optimistic; the server is authoritative, handled by the read-only downgrade.
- **`ActivityCatalogView.tsx` has no tab registry** - five unstructured in-file edits; mitigated by an activeTab spec. Extraction is deliberately not attempted.

---

## Goal
Give employees a first-class way to request catalog for a training edition, give the people asked to decide a two-click decision surface reached from their existing inbox, and give the coordinator a console to configure processes, export approved requests to the provider, and record what was handed off - all on one shared, capability-driven request detail, on a module that a second application type can join without a cross-repo change.
