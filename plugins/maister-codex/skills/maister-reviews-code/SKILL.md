---
name: maister-reviews-code
description: Review code or a change set for correctness, security, performance, maintainability, regression risk, and test coverage without modifying application code. Use for focused code review, pre-merge review, or as an optional Maister verification lane.
---

# Maister Code Review

Remain read-only. Delegate the review to the installed `maister-code-reviewer` agent when available, passing the target and standards context; otherwise perform it inline under the same contract. Resolve the review target from the supplied file, directory, diff, branch, or task path. When no target is supplied, review the current worktree diff and its immediate consumers.

Read `.maister/docs/INDEX.md`, the applicable standards, relevant tests, and enough surrounding code to trace behavior. Prefer concrete defects over style preferences. For each finding provide severity, location, behavior or risk, reproducible evidence, and a specific remediation. Check:

- correctness, boundary cases, state transitions, and error paths;
- injection, authorization, data exposure, unsafe deserialization, and secret handling;
- avoidable complexity or performance regressions;
- API, schema, configuration, and compatibility changes;
- missing or misleading tests and documentation.

Report findings in severity order. Omit a findings section when empty and state the residual testing or environment limitations. When invoked from a task, write `verification/code-review.md`; otherwise return the report directly unless the user requested a file.
