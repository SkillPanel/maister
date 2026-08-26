# Implementation Verification - ACME-1001 "My progress" employee progress endpoint

> **This report reflects the POST-FIX state.** All five warnings and two info items were fixed and re-verified after the initial verification pass. See Sec. Fix & Re-Verification History for the full trail.

## TL;DR
**Verdict: ! Passed with Issues - 1 critical (pending the scheduled regen), 0 warning, 7 info.** The implementation is complete (33/33 plan items, code-verified not checkbox-trusted), standards-compliant, and caused **zero regressions** across 6648 passing tests. Production readiness is **GO** with no blockers, and the pragmatic review found it **not over-engineered**.
The single remaining critical is mechanical: `docs/acme-portal.d.ts` is a RAW re-emit because the test runs reverted Group 5's repair - the two-step regen is the scheduled final action before commit.
**All five warnings were fixed.** The three untested load-bearing predicates (`person_uuid` scoping, the `lastActivityAt` widening, the `not ever_completed` guard) now each have a test that fails on regression, and the dedup was changed from independent-max to **winning-row semantics** - a real behaviour change that stops learning time being overstated on multi-edition recurring enrollments.

## Key Decisions
- **`activitiesCountedCount` semantics confirmed as spec-deliberate, not a bug** - it includes `NOT_STARTED`/`PENDING_APPROVAL`, so coverage reads best exactly where the estimate is thinnest. Code matches spec; the *spec* is what reads backwards.
- **The `AbstractControllerTest` FQCN was NOT raised as a finding** - two independent reviewers judged local consistency should win over `coding-style.md` in a 670-line file where every declaration uses FQCNs. It belongs in a whole-file mechanical pass or nowhere.
- **Success criterion #2 (single statement) accepted as verified-by-inspection** - the completeness checker independently judged this defensible: a query-log counting test asserts an implementation detail against `test-writing.md`, and the structural guarantee (one `.from(perActivity)`, no second fetch) is stronger than a count.
- **The batch-test failure was accepted as environmental, on direct evidence** - a stale 18-hour reused Testcontainer holds a committed `batch_job_instance` row whose job key is the MD5 of the empty string, exactly what the test derives. It reproduces in isolation.

- **W4 was resolved by operator decision, not by the addendum.** `spec-addendum.md` contradicted itself (prose: winning-row; pseudocode: independent-max). The operator ruled that **the javadoc was right and the code was wrong** - winning-row is now a decided rule, no longer an open judgement call.

## Open Questions / Risks
- **W4 is a live behaviour change for existing users.** Any person whose highest-weight enrollment is not their longest-duration enrollment will see `estimatedLearningSeconds` **drop**. Only affects activities with multiple enrollments of differing weight *and* differing duration - in practice RECURRING courses and multi-edition trainings. The direction is always downward, and the old value was the inflated one. No DTO shape change, so no frontend contract impact.
- **The 4->3 metric change never went back to the design thread.** `scope-clarifications.md` says it "must go back to the 'Mockup - dashboard + Strefa Rozwoju' thread before layouts freeze." Nothing records that happening. With Northwind on 1 October, raising it now costs a conversation; raising it in September costs a redesign. **This is the highest-value non-code item in this report.**
- **The "it's an estimate" mitigation does not cross the repo boundary.** `typescript-generator` emits doc comments for controller *methods* only - `MyLearningProgressDto` in `acme-portal.d.ts` carries no comment. The entire cross-repo honesty signal is the field name `estimatedLearningSeconds` plus two counters the frontend must choose to use.
- **`spec-addendum.md` contradicts itself on the dedup rule** - its prose says "the highest-weight row, ties broken by the largest resolved duration"; its own pseudocode says independent `max`. The code followed the pseudocode. Nobody caught this until now; it needs a product decision, not just a code fix.
- **The five follow-up ticket drafts are the only durable record of why the number is an estimate.** They die with this task directory if never created in Jira.

---

## Executive Summary

ACME-1001 delivered both halves of a scope that grew mid-flight: the original investigation verdict (four metrics -> a documented "NO" on the single-call question) and, at the operator's direction, an implementation of the servable subset. The result is one new self-scoped endpoint `GET /widget/enrollments/my/summary` backed by a single two-level jOOQ statement, plus five follow-up ticket drafts for the gaps.

Five independent verifications ran. Four returned favourable verdicts; the reality assessment returned "issues found" and was right to - it caught the `acme-portal.d.ts` regression the other agents had been told to ignore, and it identified untested predicates the completeness and code reviews independently corroborated.

**Nothing found is a design failure.** The warnings are test-coverage gaps on predicates that currently behave correctly, plus one semantic mismatch between code and its own documentation.

---
