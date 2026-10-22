# ADR-0054 — The brief holds shared facts; the runner aims each reviewer

**Status**: Accepted · **Date**: 2026-10-22 · **Builds on**: ADR-0051 (the verification runner), ADR-0053 (the project profile in the brief) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/review-brief.mjs`, `findings-merge.mjs`, `git-tree.mjs`; `skills/implementation-verifier/references/review-findings.md`; `agents/verification-runner.md` § *A verification cycle*; the six reviewer agents; `tests/engine/review-brief.test.mjs`, `findings-merge.test.mjs`, `review-contract.test.mjs`

## TL;DR
- **The brief carries only facts every reviewer would otherwise scan for**, the same for all of
  them: `base`, `snapshot`, `changed` (marked `untracked`, `generated`, `data`), the test result,
  the run's `documents` by path, the plan's counts, the profile, and on a re-check the issue ids
  and the fix's snapshots and files.
- **Gone from the brief:** the whole-change patch file, the fix patch file, the parsed requirement
  and story ids, and the keyword-matched standards.
- **Reviewers read freely and review the range** `base` to the working tree. A defect outside the
  change is marked `outside_change` and counts only when critical. A deviation a recorded decision
  covers is not a finding.
- **The runner writes each reviewer a short prompt** at the first cycle, from the spec,
  clarifications, plan, work log, decisions and audits, and re-uses it.
- **Standards by judgement:** the code reviewer checks the standards the run claimed against the
  code; the completeness checker judges, over INDEX.md, each standard that covers the change and
  was never claimed.

## ADR-0054 {#adr-0054}

### Status
Accepted. No workflow definition changes and no graph hash moves: the brief, the merge and the
contract are engine code and agent prose. The brief's shape changes; nothing outside verification
reads it.

### Context
The brief was meant to save every reviewer the same scans. In practice its parts that needed
judgement were wrong often enough to mislead: requirement ids parsed from specs whose layout varies
by run, standards matched by words in paths (too many, too few, or none without a warning), and a
whole patch file reviewers paged instead of reading what mattered. Its scope rule — "this list is
your scope; never `git diff`" — kept reviewers away from the CI and build files a change runs in.
The defects the earlier, prompt-led reviews found came from prompts written for the change: one
naming a shallow-clone risk in CI, one quoting a membership rule from the clarifications.

### Considered Options
1. **Shared facts in the brief, judgement in a runner-written prompt** (chosen). The runner reads
   the run's documents once per run and aims each reviewer; the brief stays exact.
2. **A richer brief**: better parsers for ids and standards. Spec and index layouts vary; a parser
   that is wrong silently is worse than none, and it still cannot say where to look hardest.
3. **No brief**: every reviewer scans for the base, the changed files and the test result again,
   differently each time.

### Decision
1. **The brief.** A field earns its place only when it is a fact every reviewer would otherwise
   scan for and it is the same for all of them. `generated` marks lock files, minified output and
   paths the repository marks `linguist-generated`; `data` marks fixtures, snapshots, data files,
   and a file of a data or config format past a line threshold — never a source file for its
   size.
2. **The fix.** The brief names the fix's two snapshots and its files; `findings-merge` reads the
   hunks from git itself, and where git cannot answer it matches the fix by its files, with a
   warning.
3. **The contract.** The prompt comes first and marks where to look hardest, never where to stop;
   the reviewer reads whatever serves it and reviews the range. `findings-merge` sets a non-critical
   `outside_change` finding aside as out of scope.
4. **Prompts.** At the first cycle the runner writes `verification/review-prompts.md`: per
   reviewer, where to look hardest, what must hold, environment facts, what it owns and what is
   decided. Later cycles and dispatches re-use it; a re-check names only its ids and fixed files.
5. **CI and build.** Production readiness checks how CI and the build run what the change adds:
   checkout depth, platforms, services, packaging.
6. **Standards.** Claimed standards come from the spec's and the plan's Standards Compliance
   sections and the work log's Standards Applied. A missed standard is one finding naming the
   INDEX entry and the files; without a readable INDEX.md the check is skipped with a warning.

### Consequences
- **Good:** the brief is exact again; reviewers reach CI, build and caller files; the requirement
  ids and standards each reviewer owns come from a reader of the documents, not a parser.
- **Bad:** the runner spends one read of the run's documents per run, and a prompt that aims badly
  can anchor a reviewer; the reviewer's own checklist still covers the whole change.
