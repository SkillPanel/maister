---
name: maister-standards-discover
description: Discover, score, deduplicate, review, and optionally apply evidence-backed coding standards from configuration, code patterns, documentation, CI, tests, and authorized pull-request history. Use to initialize or refresh `.maister/docs/standards/` for full, quick, frontend, backend, testing, or named-category scopes.
---

# Maister Standards Discovery

Read `.maister/docs/INDEX.md` and existing standards first. If `.maister/docs/` is absent, offer `$maister-codex:maister-init`. Parse `--scope`, `--confidence`, `--skip-external`, `--pr-count`, `--output-dir`, and `--auto-apply`; show the planned sources and exclusions before broad or external discovery.

At every finding-approval gate, prefer `request_user_input` when available; otherwise ask the equivalent concise question in the final response and pause. Use two or three mutually exclusive choices per question and preserve remaining findings for later questions rather than overloading one prompt.

Run up to four discovery lanes, each driven by its prompt reference: configuration (`references/config-analyzer-prompt.md`), code patterns (`references/code-pattern-prompt.md`), documentation (`references/docs-extractor-prompt.md`), and external evidence such as PRs and CI (`references/external-analyzer-prompt.md`). Full scope requires all four lanes, including PR availability and authentication checks unless the user excluded PRs. When delegation is available, give each lane's full prompt reference, required sources, and original user exclusions to a read-only subagent and run independent lanes concurrently; otherwise execute the lanes inline in sequence. Gracefully skip unavailable sources and record why. Every finding must include category and target file, rule, preferred behavior and exceptions, concrete evidence, sources, confidence factors, and conflicts.

## Source coverage contract

Track required sources in `analysis/standards-discovery.md` from planning through completion. For full scope, track configuration, code patterns, documentation, PR history, CI/CD, and pre-commit hooks separately. Each row records source, disposition, reason, and evidence reference:

- `inspected`: cite inspected files or tool results and the coverage achieved, even when no findings or no PRs were returned.
- `user-excluded`: cite the original user instruction or explicit `--skip-external` argument and its scope. A user instruction to skip PRs excludes only PR history; `--skip-external` excludes the external lane. Preserve these choices without repeatedly asking permission.
- `unavailable`: cite an observed file search, CLI/authentication check, or access failure with the command, outcome, and relevant sanitized output. An assumption about access is insufficient. Preserve legitimate failures without repeatedly requesting access; retry only when new evidence or user direction warrants it.

Keep unattempted or unsupported rows `pending`. An agent-created exclusion (including a parent agent declaring PRs "outside scope") is not user authorization, even if disclosed. Verify delegated evidence against the original request; return unsupported exclusions to pending and perform the missing checks. An empty findings list does not establish source coverage.

Aggregate by category and semantic rule, merge supporting evidence, detect contradictions, and calculate confidence using `references/aggregation-strategy.md`. Group results as high (80–100), medium (60–79), and low (below 60), then apply the requested confidence threshold.

Present all findings before writing:

- high confidence may be approved in a batch; auto-apply only when `--auto-apply` was explicit;
- medium confidence requires individual confirmation;
- low confidence remains a suggestion unless explicitly selected;
- conflicting or human-authored rules require the proposed diff and individual approval.

Load `$maister-codex:maister-docs-manager` for approved creates/updates and INDEX regeneration. Write `analysis/standards-discovery.md` under a supplied task directory or output directory. Report accepted, rejected, conflicted, deferred, filtered, and unavailable-source findings, then verify AGENTS documentation routing. Reconcile every required source before returning to a calling workflow: report discovery as complete only when every row has an evidence-backed disposition above; qualify completion with user exclusions and unavailable sources. If any row is pending, report discovery incomplete and name the remaining work. Report findings application separately from discovery coverage.
