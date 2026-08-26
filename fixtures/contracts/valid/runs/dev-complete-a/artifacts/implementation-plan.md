# Implementation Plan: ACME-1001 "My progress" - employee progress summary endpoint

## TL;DR
Five task groups, 28 steps, 12-22 tests. Groups 1 -> 2 build the two-level jOOQ query (inner per-activity dedup, outer aggregate) test-first; Group 3 wires the controller and can run in parallel with Group 2 once Group 1 lands. Group 4 is the review + quality gate (`compile`, `checkstyle`, follow-up ticket drafts). Group 5 is the `acme-portal.d.ts` regen, deliberately isolated as the last group because any `./mvnw test`/`verify` after it re-emits the raw file and fails CI.
The four binding addendum constraints C1-C4 each map to a named step **and** a named test assertion - see the traceability matrix below.

## Key Decisions
- **Query split across two groups, not one** - Group 1 proves the aggregate shape and the arithmetic (C2), Group 2 layers the filters and the distinct-activity dedup (C1). Ten query tests in one group would breach the 2-8 limit and would mix "does it sum" with "does it dedup" in a single red/green cycle.
- **Controller group depends only on Group 1** - it needs the DTO and the service signature, not the final query semantics. Declaring the dependency at Group 1 lets Groups 2 and 3 run concurrently; they share no files.
- **`acme-portal.d.ts` regen is its own terminal group, after the testing group** - inverts the usual "testing group last" convention on purpose. The regen is a build artifact that any subsequent Maven test run silently reverts (`build-workflow.md`); it must be the last write before commit.
- **Follow-up ticket drafting folded into Group 4** - success criterion #9 is a deliverable of the [INV] ticket, not a code change; it belongs with the review pass, not with the build.
- **The D2 weight clamp is implemented in Group 1 but asserted in Group 2** - the clamp is part of the weight expression (arithmetic), while the attendance-completed-TRAINING scenario is a filter/semantics fixture. The cross-group dependency is explicit.

## Open Questions / Risks
- **Shared-file contention on `AbstractControllerTest`** - a repo-wide test base. Group 3 is the only group that touches it; if another branch edits it concurrently, every controller test in the repo fails on merge, not on build.
- **The `GREATEST` fold (R2) must be verified as SQL, not Java** - jOOQ's `DSL.greatest(...)` over three `max(...)` aggregates should render server-side. If it degrades to a Java-side fold the null-handling semantics change silently. Group 2 step 2.5 calls this out; there is no test that can distinguish the two, so it is a code-review item.
- **The dedup tie-break rule (`max(weight)`, ties -> `max(resolved_duration)`) is a judgement call, not a derived fact** (addendum Sec. R1). If the number looks wrong in review, this is the first thing to question.
- **`activitiesCountedCount` changed meaning** under C1 - it is now a count of *distinct activities*, not enrollments. If the DTO javadoc omits the word "distinct", ACME-1002 will misread the coverage denominator.
- **The endpoint ships with no consumer in this repo.** `docs/acme-portal.d.ts` is the only handoff artifact; a shape error surfaces in the frontend repo, not here.

---

## Overview

| | |
|---|---|
| Total Steps | 28 (excluding the 5 parent steps) |
| Task Groups | 5 |
| Expected Tests | 12 written in Groups 1-3, up to 10 more in Group 4 -> **12-22 total** |
| Migrations | none |
| New permissions | none |
| `pom.xml` changes | none (controller already registered ~L1369) |

### Binding-constraint traceability (C1-C4)

Every constraint from the addendum maps to a step that implements it and a test that would fail if it regressed.

| # | Constraint | Implemented by step | Asserted by test |
|---|---|---|---|
| **C1** | Distinct-activity semantics - collapse to one row per `activity_id` before aggregating | **2.3** (inner `groupBy(ACTIVITY_ID)`, `max(weight)`, `max(resolved_duration)`, `ever_completed`, `currently_in_progress AND NOT ever_completed`) | **2.1(e)** `shouldCountRecurringActivityOnceAcrossThreeCompletedEnrollments` - `completedActivitiesCount = 1`, duration counted exactly once |
| **C2** | Integer-division trap - coerce `PROGRESS` to `NUMERIC` before dividing | **1.4** (weight expression built in `BigDecimal`/`NUMERIC` space; `.div(100)` on the raw `Field<Integer>` is forbidden) | **1.1(b)** `shouldCountPartialProgressAtExactWeightedDuration` - 3600 s activity at `progress = 50` asserts **exactly `1800`**, never `isGreaterThan(0)` |
| **C3** | `Instant` generates as `string`, not `Date` (`pom.xml:1596`) | **5.3** (verify against the regenerated file, not from memory) | **5.3** `git diff docs/acme-portal.d.ts` shows `lastActivityAt?: string` / `Nullable<string>`; the five counters non-optional |
| **C4** | D2 guard asserts **full** duration, not "non-zero" | **1.4** (the `CASE WHEN status = COMPLETED THEN 1.0` clamp inside the weight expression) | **2.1(a)** `shouldCountFullDeclaredDurationForAttendanceCompletedTraining` - `progress = 0`, `status = COMPLETED`, edition duration 7200 -> asserts **exactly `7200`** |

---
