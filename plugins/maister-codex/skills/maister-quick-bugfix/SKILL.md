---
name: maister-quick-bugfix
description: Diagnose and fix a small, reproducible defect with an approved root-cause plan, TDD red-to-green evidence, applicable Maister standards, and bounded retries. Use for isolated bugs; escalate multi-system, security-sensitive, data-affecting, or unclear defects to `$maister-codex:maister-development`.
---

# Maister Quick Bugfix

Establish expected versus actual behavior, reproduction, and the likely code path. Read `.maister/docs/INDEX.md` and every matched standard; when absent, proceed and recommend `$maister-codex:maister-init`.

Escalate before editing when two or more apply: at least five files across modules, schema/data migration, competing architecture fixes, security-sensitive code, or unclear root cause after focused investigation.

Present a plan artifact or response containing Bug Analysis, Proposed Fix, Test Strategy, Applicable Standards, and Standards Compliance Checklist. Unless the user explicitly authorized an autonomous fix, request approval with `request_user_input` when available, offering apply, revise, or stop; otherwise ask the same concise choice in the final response. Pause before editing.

Write the smallest regression test that fails for the observed reason. If it passes, stop and correct the reproduction rather than forcing code changes. Implement the smallest fix, make the red test green, run the full relevant test file and related checks, and verify every standard. After three unsuccessful fix-and-verify attempts, stop and recommend `$maister-codex:maister-development`; never roll back automatically.

Summarize root cause, fix, files, red/green commands and results, standards checklist, remaining risk, and a concise commit suggestion.
