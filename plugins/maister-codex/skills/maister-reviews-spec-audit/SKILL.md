---
name: maister-reviews-spec-audit
description: Audit a software specification for completeness, consistency, feasibility, ambiguity, acceptance coverage, user-flow reachability, and alignment with the codebase and standards. Use before implementation planning or when a Maister workflow selects specification audit.
---

# Maister Specification Audit

Remain read-only. Delegate to the installed `maister-spec-auditor` agent when available; otherwise perform the audit inline under the same contract. Read the complete specification, requirements and analysis artifacts, applicable standards, and targeted code paths. Verify that the document defines the problem, users, behavior, scope, non-goals, acceptance criteria, failure modes, data and security implications, observability, documentation, rollout, and rollback where relevant.

Distinguish blockers from improvements. For every finding cite the affected requirement or missing section, explain implementation impact, and propose exact wording or a decision to obtain. Check that every acceptance criterion is testable and every user-facing capability is reachable through a complete flow.

When invoked from a task, write `verification/spec-audit.md`. Return `passed`, `passed_with_issues`, or `failed`, with issue counts and the minimum changes required before planning.
