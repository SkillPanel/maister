# Implementation verification  -  config loader to ESM

## TL;DR

The suite is green at 412 passed, 0 failed, 0 skipped, in 41.2s.
Two fixable issues were found on the first pass; both were resolved and the suite was re-run once.
No data integrity issue was found, so nothing halted: the two issues are behavioural, not data.
All four migration-specific checks ran; the compatibility check passed against the four in-repository consumers.
The rollback plan was reviewed and not exercised, because nothing needed rolling back.

## Key Decisions

- Declared `issues_to_resolve` rather than fixing inside verification: a fix written by the
  verifier is one nothing re-verifies, and the resolution node owns the fix loop.
- Copied per import site rather than freezing the cached object. Freezing would turn a silent
  mutation into a thrown error in every consumer, which is wider than the specification asked.
- Re-verified the whole suite rather than the two touched files, because the loader is imported
  by every service in the repository.

## Open Questions / Risks

- The minimum Node version moved with the import attribute. Nothing outside this repository
  resolves the package today, so nothing was surveyed; a consumer added later has to meet it.
- The named export is a live binding and the merged config is copied per import site. A future
  consumer that expects to see another consumer's mutation will not, by design.

## What was checked

| Check | Outcome |
|---|---|
| Test suite | 412 passed, 0 failed, 0 skipped, 41.2s (after the fix round) |
| Entry-point resolution | ESM only; no path still resolves the CommonJS entry point |
| Consumer compatibility | all four in-repository consumers import the named export |
| Data integrity | not applicable: the migration moves module resolution, not data |
| Rollback plan | reviewed, one revert of the package commit, not exercised |

The two issues found on the first pass were the export handing out the cached object by
reference, and one consumer keeping a `require()` call behind a lazy branch. Both were
resolved in the resolution stretch and covered by an added assertion each.

## Verdict

The implementation is verified. The package resolves as ESM only, the merged config values
are unchanged, and the one consequence that reaches past this repository - the minimum Node
version - is named in the close-out.
