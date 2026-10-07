---
name: maister-verify
description: Verify a completed Maister implementation through the full test suite, plan and standards completeness, focused code and pragmatic reviews, production readiness, reality assessment, and canonical re-verification reporting. Use after implementation and before commit, deployment, or task finalization.
---

# Maister Verify

Remain read-only with respect to application code. Report issues; do not fix them. Read the task state, specification, implementation plan, work log, acceptance criteria, applicable standards, changed files, and existing verification artifacts. If the task path or required artifacts are absent, report the missing prerequisites and stop.

Read the verification options from state. Always run the full test suite and completeness review. Enable code, pragmatic, production-readiness, and reality reviews only when selected by the task or explicitly requested. Run the full test suite once before reviews that consume its results; never run competing full suites in parallel.

## Verification lanes

1. **Tests** — delegate to the installed `maister-test-suite-runner` agent when available, otherwise run inline: identify the project-standard full command, run it without altering tests or configuration, and write `verification/test-suite-results.md` with totals, failures, regression classification, and environment limitations.
2. **Completeness** — delegate to the installed `maister-implementation-completeness-checker` agent when available, otherwise run inline: reconcile every plan checkbox and acceptance criterion with code, tests, documentation, standards, and visual references; write `verification/completeness.md`.
3. **Code review** — load `$maister-codex:maister-reviews-code` and register its report when enabled.
4. **Pragmatic review** — load `$maister-codex:maister-reviews-pragmatic` when enabled.
5. **Production readiness** — load `$maister-codex:maister-reviews-production-readiness` when enabled.
6. **Reality assessment** — load `$maister-codex:maister-reviews-reality-check` after test results are available when enabled.

Independent read-only lanes may run concurrently after the single test run. Each finding must include severity, evidence, location, fixability, and recommendation. Aggregate duplicates without losing evidence. Critical correctness, security, data-integrity, or acceptance failures produce `failed`; unresolved warnings produce `passed_with_issues`; only a clean required set produces `passed`.

Write or refresh `verification/implementation-verification.md` with TL;DR, final verdict, issue counts, tests, acceptance and plan coverage, standards checklist, optional-review summaries, skipped lanes and reasons, environment limits, and prioritized recommendations. When HTML output is enabled, also write `verification/implementation-verification.html` following `references/html-report-style.md` from `$maister-codex:maister-orchestrator-framework` (delegate to the installed `maister-html-companion-writer` agent when available) and register it in the phase artifact's `html` field. Update a matching roadmap item only when the task state explicitly requests it.

On re-verification, read prior reports and `verification_context.fixes_applied`, rerun the full suite when application code changed, rerun affected lanes, and replace the canonical verdict. Include a fix and re-verification history; never leave a pre-fix report as the canonical result.
