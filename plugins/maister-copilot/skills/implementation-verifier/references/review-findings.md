# Review Brief and Findings Contract

The one contract every verification reviewer follows: the spec conformance review, the code risk
review, the simplicity review and the test-suite runner. The verification runner hands each of
them a `review_brief` path and nothing written for the change; the brief names this file as its
`contract`. Each reviewer keeps its own method and markdown report. This file covers only what
all of them share: the brief, the project profile, the findings file each one writes, and
re-check mode.

## Why it exists

Reviewers used to work out the change on their own and graded in five severity vocabularies, and
the verifier merged their prose by hand. Now the facts every reviewer needs are measured once per
cycle, by the workflow engine's `review-brief`; each reviewer reads the run's own documents and decides
where to look; and each writes its findings as data. The engine's `findings-merge` folds them: duplicates across reviewers become one
finding, issue numbers stay the same across cycles, and a re-check's new findings count only
inside the fixes. Do not coordinate with the other reviewers, because the merge folds any overlap.

## The brief

**Nobody writes you a prompt for the change.** Your own method decides where to look, and the
run's documents, which the brief names, are your source for the rules, the requirements, the
standards the run claimed and its known open problems. A deviation a recorded decision covers is
not a finding; at most it is an `info` naming it.

**The brief holds the shared facts,** so you do not scan for them. It is JSON at
`verification/review-brief-<N>.json`; run files in it are relative to the task directory, code
paths relative to the repository's top.
- **`base` and `snapshot`**: the commit the run started from, and the working tree of this cycle as
  a tree id.
- **`changed`**: every path that differs from `base`, the project's `.maister/` never, with its
  status (`A`, `M`, `D`, `T`) and line counts. `untracked` marks a file `git diff <base>` does not
  show. `generated` and `data` mark files to skip unless a finding turns on them.
  `dirty_at_freeze` marks a path already modified before the run started: review it, and say in a
  finding there that the change may predate the run.
- **`tests`**: the cycle's test result (`pending` before the suite has run, `skipped` when the
  run skips it), with `failed_on_base`, how many of its failures the base has too, when the
  runner established it. **`checks`**: the project's other checks (lint, format, typecheck,
  build), each `{name, command, status}` with `status` `passed` or `failed`, and
  `fails_on_base: true` on a failed one the base fails the same way, from the test-suite runner.
  **The test-suite runner alone files a failing test or check as a finding.** Every other reviewer
  reads them as context and reports only what a failure means beyond itself — the same edit also
  breaking a guarded pin, or a rule the failing code was meant to keep — never the failure
  itself. `plan` holds the plan's group counts.
- **`documents`**: the paths of the run's documents — spec, plan, work log, clarifications,
  audits, and `state`, whose phase summaries record the decisions. Open what your method needs.
- **`profile`**: the project profile, its fields and `source` (§ The project profile).
- **`fix`** and **`recheck`**: § Re-check mode.
- **A part the verb could not fill is `null`.** For example, `changed` is null when the snapshot
  failed. For that part only, find it yourself, and say so in your report.

**Review the range; read as your review needs.** The change under review is `base` to the
working tree, never another range. How far you read depends on your review:
- **The code risk review and the test-suite runner read freely:**
  per-file diffs (`git diff <base> -- <path>`), the files as they are now, the base version,
  history, callers, config, CI and build files, tests. Who can reach a value, and how CI and the
  build run the change, sit in the environment around it.
- **The spec conformance review and the simplicity review read narrowly:** the changed files, the
  documents, and only what one of your findings depends on, such as the code that enforces a rule
  or the caller a claim turns on. Do not explore history, CI or unrelated modules: your questions
  are about the change against its spec and its scale, not the environment it runs in.

A defect
outside the changed files may be reported when the change exposes it, marked
`"outside_change": true`; it counts toward the verdict only when it is `critical`.

## The project profile

The profile says what the project is, so a reviewer checks what applies to it rather than a
fixed web-service checklist. Every field is optional:

| Field | Values |
|---|---|
| `kind` | `web-app`, `service`, `daemon`, `cli`, `library`, `plugin`, `desktop`, `mobile`, `data-pipeline`, `infra` |
| `runtime` | free text: the language and its version |
| `deploy` | `none`, `local`, `container`, `kubernetes`, `serverless`, `package-registry`, `app-store` |
| `exposure` | `local`, `internal`, `public` — who can reach its entry points |
| `data` | the stores it writes, such as `[postgres, files]`; `[]` for none |
| `scale` | `single-user`, `team`, `multi-tenant` |
| `ui` | `none`, `web`, `tui`, `native` |

**Where it comes from.** `source: config` is the project's `project:` key in
`.maister/config.yml`, as the run froze it. `source: none` means the project has none: read
`.maister/docs/project/tech-stack.md` and `architecture.md` once (the manifests when those are
absent), infer the same fields, and state the profile in your report's first lines as
`source: inferred`. Without a brief, read the `project:` key yourself, then infer the same way.
Never assume a web service. **A field neither set nor inferable rules nothing out**: keep the
checks it governs.

**What a profile rules out**, for every reviewer that keys checks to it:

| The profile says | Not checked |
|---|---|
| `kind` `cli`, `plugin` or `library` | health and readiness endpoints, rate limiting, CORS, HTTPS, security headers, CSP, request size limits, error-tracking services, metrics, a staging environment |
| `exposure: local` | authentication and authorization on entry points, rate limiting, CORS, HTTPS |
| `deploy` `none`, `local` or `package-registry` | health and readiness endpoints, graceful shutdown on SIGTERM, error-tracking services, metrics, zero-downtime deploys |
| `data` names no database (`[]`, or files only) | migrations, down-migrations, connection pooling, transactions, N+1 queries, indexes, pagination of queries |
| `ui` `none`, `tui` or `native` | XSS, CSP, loading and error states of web requests |

What a `cli`, `plugin` or `library` gets instead: exit codes and error messages, cross-platform
paths and shells, behaviour with no network, install and upgrade paths, and the published
surface (exports, flags, manifest) staying compatible. A ruled-out check is not run and never
reported, at any severity. The report names the profile used and lists the checks it ruled out
in one line.

**Safeguards: absence against presence.** Pooling, caching, rate limiting, circuit breakers,
observability, feature flags and multi-environment configuration are judged from the same
profile by two sides, so no item is ever graded in opposite directions:
- their **absence** is the code risk review's finding, and
  only when the profile needs them — pooling, for example, only for a new connection path in a
  long-running process with a database in `data`, and caching only where the change makes a
  repeated expensive read measurably worse at the profile's `scale`;
- their **presence** is the simplicity review's finding, and only when the profile does not need
  them — a pool in a CLI that opens one connection, a cache in front of a file read at
  `scale: single-user`.

## The findings file

Beside your markdown report, always write `verification/<stem>-findings.json`, even when you
found nothing, with `cycle` and `mode` copied from the brief:

| Reviewer | Stem |
|---|---|
| spec-conformance-review | `spec` |
| code-risk-review | `code-risk` |
| simplicity-review | `simplicity` |
| test-suite-runner | `test-suite` |

```json
{"reviewer": "code-risk", "cycle": 1, "mode": "full",
 "findings": [{"id": "cr-1", "severity": "warning", "category": "resilience",
   "location": {"path": "src/upload.mjs", "line": 42, "end_line": 48},
   "title": "Upload retries never back off",
   "evidence": "upload.mjs:42 loops on 503 with no delay; no test covers it",
   "fixable": true, "risky": false, "suggestion": "add a capped backoff",
   "refs": ["2", "user-story-retry"]}]}
```

- **`id`** is your own label (`cr-1`, `cr-2` …), unique within the file. The run's issue numbers
  are given by the merge, never by you.
- **`severity`** uses one scale: `critical`, `warning` or `info`. Map your report's own
  vocabulary onto it: Critical and Blocker → `critical`; High, Medium, Warning and Concern →
  `warning`; Low, Info and Nice-to-have → `info`. Only `critical` fails the verdict, so grade it
  for what it does to this change.
- **`category`** is one of `delivery` (built as specified: requirements, stories, plan), `docs`,
  `tests`, `correctness`, `security`, `resilience`, `performance`, `simplicity` or `standards`.
  The merge folds two reviewers' findings only within one family: delivery/docs/tests,
  correctness/security/resilience/performance, simplicity, or standards.
- **`location`** gives the path as `changed` spells it, with the line range when the finding has
  one. Leave it out (`null`) for a finding with no place, such as a story nobody can reach.
- **`fixable`** is `true` for a change contained in the item: a lint error, a missing guard, a
  wrong constant. It is `false` for a decision a person must make. **`risky`** is `true` when the
  fix would reach beyond the item into behaviour the change did not set out to alter.
- **`refs`** names the requirement and story ids, as the spec spells them, that the finding bears
  on.
- **`outside_change`** is `true` for a defect in code the change did not touch, which the change
  exposes (§ The brief). Leave it out otherwise.
- **One finding per defect**, the same ones your report lists as issues. Strengths, scores and
  statistics stay in the markdown.

The test-suite runner also writes a `tests` block, `{status, passed, failed, errors, skipped,
command}` with `status` being `passed`, `passed_with_issues` or `failed`. Its findings are the
failures (`category: tests`, located at the test file). The brief reads the cycle's test result
from that block. Beside it the runner writes a `checks` list, one `{name, command, status}` per
other check it ran (lint, format, typecheck, build), `status` `passed` or `failed`; each failing
check is also one of its findings. The brief carries the list as `checks`.

**A failure the base has too.** For each failing check or test only, the runner establishes
whether the base fails it the same way: from what the run already recorded, or by re-running that
item alone on an export of `base`. It records `fails_on_base` (`true` or `false`) on the failed
check, `failed_on_base` (a count) in the `tests` block, and `fails_on_base: true` on each such
finding. Every doubtful case falls to the change, so a new failure is never marked as the base's:
- **Evidence, not judgement.** A failure is the base's only when the base's output shows the same
  test id, or the same check rule and message at the matching place, quoted in the finding's
  `evidence`. Without a quoted match it is the change's; the merge counts a `fails_on_base`
  finding with no evidence as the change's, with a warning.
- **A borrowed environment does not count.** When the re-run imports the project from the working
  tree rather than the export — an editable install, a workspace or `npm link` symlink, a path
  mapping into the repository — or the change touched a dependency manifest or lock file, the run
  measures the change, not the base. Where the export run resolves the project from tells.
- **Dirty at the start.** When the failing item turns on a file in `dirty_at_freeze`, the exported
  commit is not what the user was running.
- **A failure the run sets out to fix** is the change's, whatever the base says.

In each of these, and where the base could not be run, the field is left out, and the failure
counts as the change's.

## Re-check mode

A re-check cycle looks only at the fixes. You are in one when the brief's `mode` is `recheck` and
your prompt names issue ids (also in `recheck.by_reviewer[<your stem>]`).

**In:**
- the ids, with each issue's severity, title and location (`recheck.issues`);
- the fix: `fix.from` and `fix.to` are the previous and the current snapshot, `fix.files` the
  files the fixes touched — diff those files between the two (`git diff <from> <to> -- <file>`);
- your own previous findings file, which you read before you overwrite it.

**Do:**
- For each id, decide from the fix diff and the code now whether the issue is `resolved` or
  `residual`, with one line of evidence.
- Look for new defects only in the lines the fix diff changed. A re-check is not a second full
  review.

**Out:**

```json
{"reviewer": "code-risk", "cycle": 2, "mode": "recheck",
 "results": [{"id": 3, "status": "resolved", "evidence": "upload.mjs:44 now waits 2^n s, capped at 30"}],
 "new": []}
```

`new` holds findings in the shape above, inside the fix diff only.

- **Answer every id you were handed.** An id you leave out stays open, with a note that you did
  not answer it.
- **A new finding outside the fix diff** is moved aside by the merge as out of scope: reported,
  never counted. Do not pad the list.
- **The markdown.** Write the re-check as `<your report's name>-recheck-<cycle>.md` beside your
  report path. The full report from the earlier cycle stays as it is.

## What the merge does with it

For orientation only; the verifier runs it.
- **Duplicates fold.** Findings from two reviewers on one path, within ten lines and in one family,
  become one finding. It takes the highest severity, with `severity_disagreement` when the
  reviewers differ.
- **Issue numbers stay stable** across cycles. A new finding takes the next unused number.
- **Outside the change.** A finding marked `outside_change` counts only when it is `critical`; any
  other goes to `out_of_scope`, reported and never counted.
- **On the base too.** A finding marked `fails_on_base` goes to `out_of_scope` at any severity:
  listed, never counted, never fixed. The merge also splits the brief's failing tests and checks
  into those the change introduced and those the base has too (`failures`), which the verdict
  reads. A check marked `fails_on_base` is the base's only when its own finding was set aside
  with evidence — the finding's title names the check, or quotes its command, or its location is
  a path the command names; any other is the change's.
- **Silence is not a fix.** A finding you do not report again in a full review stays open, marked
  `not_reported`. It closes only when a fix touched its place or a re-check answers it resolved.
- **The result** is `verification/findings.json`. The verifier's report and the run's
  `issues_found` are read from that file.
