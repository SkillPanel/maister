# Specification: ACME-1001 "My progress" - employee progress summary endpoint

> **Precedence:** `implementation/spec-addendum.md` overrides this document wherever they conflict - notably FR6 (`lastActivityAt` is `greatest(max(last_access_at), max(completed_at), max(started_at))`, not `MAX(last_access_at)`), the DTO table's `lastActivityAt` type, and NFR5's index wording.

## TL;DR
One new self-scoped read endpoint, `GET /widget/enrollments/my/summary`, returns the signed-in employee's all-time WIDGET learning summary in a single SQL statement: completed count, in-progress count, an **estimated** learning-time figure with two coverage counters, and a last-activity timestamp.
Build is additive: one jOOQ query service, one DTO record, one method on the already-registered `WidgetEnrollmentController`, one `@MockitoBean` in `AbstractControllerTest`, plus a `acme-portal.d.ts` regeneration.
No migration, no new table, no new index, no new permission, no `pom.xml` change.
Certificates, real elapsed-time capture, and the `Enrollment.complete()` domain fix are **out of scope** and become five drafted follow-up tickets.

## Key Decisions
- **Six response fields, not the three the tile shows** - `inProgressCount`, the two coverage counters and `lastActivityAt` are free in the same statement; widening the DTO later costs a `acme-portal.d.ts` regen plus a frontend round trip.
- **Learning time is an estimate, labelled as one** - `weight x declared duration`, never measured time. Real elapsed-time capture (D1) is deferred.
- **Query-side completion clamp instead of a domain fix (D2)** - `CASE WHEN status = 'COMPLETED' THEN 1.0 ELSE progress/100.0 END`. `Enrollment.complete()` never sets `progress = 100`, so 4 of 6 completion paths would otherwise contribute zero time. Read-only, zero blast radius, works on all historical rows.
- **Exclude `LEARNING_PATH`-typed activities (D3)** - the container's progress is a derived aggregate of its steps, so counting both double-books. Filter on `development_activity.type`, **not** on `path_enrollment_id`.
- **Exclude `ARCHIVED` activities (D6) and `DROPPED`/`FAILED` enrollments (D5)** - both in the `WHERE`, so the exclusion applies uniformly to every field including the coverage denominator.
- **Strictly self-scoped (FR8)** - `CompanyId`/`PersonId` from `SecurityHelper`; no request parameter accepts a person id. A manager variant is a different endpoint on a different ticket.
- **Reuse `WidgetEnrollmentController` and its `repo-alpha:widget:enroll` authority (D7, D8)** - controller-local consistency, already in `pom.xml <classes>`.

## Open Questions / Risks
- **The tile is not monotonic.** D6 means an employee's completed count and learning time **drop retroactively** when an admin archives an old course. Deliberate, but ACME-1002 must know.
- **`lastActivityAt` is computed over the filtered set.** A person whose only recent activity was on an archived, dropped or failed course sees an older timestamp than they expect.
- **The estimate rests on two soft inputs**: `progress` is client-declared and unverified for non-LEDGER types, and `duration_seconds` is author-optional and nullable on both source tables. The coverage counters are the only mitigation - the frontend must be able to caveat or hide the number.
- **The tile drops from four metrics to three** (certificates removed). This is a design change against the agreed mockups and must go back to the "Mockup - dashboard + Strefa Rozwoju" email thread before layouts freeze.
- **No mockup is available in either repo.** The DTO shape is inferred from the ticket's named metrics; if the mockup demands something else, the DTO changes and `acme-portal.d.ts` regenerates.
- **Build-order hazard**: running `./mvnw test`/`verify` *after* the `acme-portal.d.ts` regen silently re-emits the raw file and fails CI. Regen must be the last step before commit (`build-workflow.md`).

---

## Goal

Give the ACME-1002 employee dashboard a single backend call that returns the signed-in employee's all-time WIDGET learning summary, so the "My progress" tile renders from one request with no N+1 and no client-side aggregation.
