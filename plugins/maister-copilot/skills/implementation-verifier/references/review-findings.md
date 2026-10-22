# Review Brief and Findings Contract

The one contract every verification reviewer follows: the completeness checker, the test-suite
runner, the code reviewer, the pragmatic reviewer, the production-readiness checker and the reality
assessor. The implementation verifier hands each of them a `review_brief` path; the brief names
this file as its `contract`. Each reviewer keeps its own checklist and markdown report. This file
covers only what all of them share: how to read the brief, the findings file each one writes, and
re-check mode.

## Why it exists

Reviewers used to work out the change on their own, each with its own `git diff`, and graded in
five severity vocabularies. The verifier then merged their prose by hand. Now the change is
measured once per cycle, by the workflow engine's `review-brief`, and each reviewer writes its
findings as data. The engine's `findings-merge` folds them: duplicates across reviewers become one
finding, issue numbers stay the same across cycles, and a re-check's new findings count only
inside the fixes. Do not coordinate with the other reviewers, because the merge folds any overlap.

## Reading the brief

The brief is JSON at `verification/review-brief-<N>.json`. Read it before anything else.
- **Paths.** Run files (the spec, the plan, the patch files) are relative to the task directory.
  Code paths are relative to the repository's top.
- **Scope.** `changed` lists every path the run changed, from its base commit to the working
  tree, untracked files included, the project's `.maister/` never. Each entry gives the status
  (`A`, `M`, `D`, `T`) and the line counts. **This list is your scope.** Read these files and
  `diff_path` (the whole patch); never work out the scope with `git diff`, `git log` or
  `git status`. Git reads beyond scope, such as the history of one line a finding turns on, stay
  yours to make.
- **`dirty_at_freeze: true`** marks a path already modified before the run started. Review it,
  and say in a finding there that the change may predate the run.
- **`spec`** holds the requirement numbers and story ids, `plan` the group counts, and `tests` the
  cycle's test result (`pending` before the suite has run, `skipped` when the run skips it).
  `standards` holds the standards matching the change, each with why. Open a standard file only
  when its rules bear on what you review.
- **`fix`** is present from the second cycle on. It holds what changed since the previous cycle:
  `diff_path`, `files` and new-side `hunks`.
- **`recheck`** is present on a re-check cycle. It holds the issues being re-checked and
  `by_reviewer`, the ids each reviewer answers.
- **A part the verb could not fill is `null`.** For example, `changed` is null when the snapshot
  failed. For that part only, fall back to finding it yourself, and say so in your report.

## The findings file

Beside your markdown report, always write `verification/<stem>-findings.json`, even when you
found nothing, with `cycle` and `mode` copied from the brief:

| Reviewer | Stem |
|---|---|
| implementation-completeness-checker | `completeness` |
| test-suite-runner | `test-suite` |
| code-reviewer | `code-review` |
| code-quality-pragmatist | `pragmatic` |
| production-readiness-checker | `production-readiness` |
| reality-assessor | `reality` |

```json
{"reviewer": "code-review", "cycle": 1, "mode": "full",
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
- **`refs`** names the requirement numbers and story ids from `spec` that the finding bears on.
- **One finding per defect**, the same ones your report lists as issues. Strengths, scores and
  statistics stay in the markdown.

The test-suite runner also writes a `tests` block, `{status, passed, failed, errors, skipped,
command}` with `status` being `passed`, `passed_with_issues` or `failed`. Its findings are the
failures (`category: tests`, located at the test file). The brief reads the cycle's test result
from that block.

## Re-check mode

A re-check cycle looks only at the fixes. You are in one when the brief's `mode` is `recheck` and
your prompt names issue ids (also in `recheck.by_reviewer[<your stem>]`).

**In:**
- the ids, with each issue's severity, title and location (`recheck.issues`);
- the fix diff (`fix.diff_path`);
- your own previous findings file, which you read before you overwrite it.

**Do:**
- For each id, decide from the fix diff and the code now whether the issue is `resolved` or
  `residual`, with one line of evidence.
- Look for new defects only in the lines the fix diff changed. A re-check is not a second full
  review.

**Out:**

```json
{"reviewer": "code-review", "cycle": 2, "mode": "recheck",
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
- **Silence is not a fix.** A finding you do not report again in a full review stays open, marked
  `not_reported`. It closes only when a fix touched its place or a re-check answers it resolved.
- **The result** is `verification/findings.json`. The verifier's report and the run's
  `issues_found` are read from that file.
