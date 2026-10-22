# ADR-0055 — Three reviewers read the run themselves

**Status**: Accepted · **Date**: 2026-10-22 · **Builds on**: ADR-0051 (the verification runner), ADR-0053 (the project profile), ADR-0054 (the brief holds shared facts) · **Supersedes**: ADR-0054's runner-written prompts · **Sources**: `plugins/maister/agents/spec-conformance-review.md`, `code-risk-review.md`, `simplicity-review.md`, `verification-runner.md`, `test-suite-runner.md`; `skills/implementation-verifier/references/review-findings.md`; `skills/workflow-engine/scripts/lib/review-brief.mjs`, `findings-merge.mjs`, `subagents.mjs`

## TL;DR
- **Three reviewers replace five:**
  - spec conformance: does the code obey the spec, the clarifications and the recorded decisions;
  - code risk: what breaks, leaks or falls over where the project runs, the standards that govern
    the change, CI and build, and operational hygiene;
  - simplicity: complexity the project does not need.

  The completeness checker, code reviewer, pragmatist, production-readiness checker and reality
  assessor are removed, with their commands.
- **No prompt is written for the change.** Each reviewer gets the brief and its paths, reads the
  run's documents and decides where to look. ADR-0054's `review-prompts.md` is gone.
- **One pass.** The reviews are not chosen per run, and their four option keys are gone.
- **Checks travel as facts.** The test-suite runner also runs lint, format, typecheck and build,
  even when the suite is skipped, and the brief carries them as `checks`. The implementation's
  closing work-log entry lists *Known open problems*.
- **Only critical and warning findings are fixed without asking**; info findings are listed.

## ADR-0055 {#adr-0055}

### Status
Accepted. No definition changes and no graph hash moves: the panel, the contract and the runner
are agent prose and engine code. The `verification-options` prose of development, performance and
migration no longer asks which reviews to run.

### Context
A review-panel trial and a study of past runs measured the five-reviewer panel against
alternatives. The trial ran the reviewers on pinned pre-fix snapshots of real tasks, with pooled
ground truth and two judge passes. The study covered 50 recent verification runs across
maister-cockpit, beamforge, map, skillpanel-embeddable, boost-react-webapp and this plugin.

What it found:
- **What got acted on.** Of 865 findings acted on, 146 were important, 376 useful and 343 churn.
  Code review found most of what mattered. Reality and production readiness found the rest of
  the important requirement gaps, failure paths, ops hygiene and CI defects. Completeness and the
  pragmatist produced mostly churn: 70% and 67% of what was acted on.
- **Where the important findings came from.** 89% came at least partly from a line the
  orchestrator wrote. Those lines were mostly a few rules quoted from the spec and focus areas,
  and most of what they carried was already in the run's documents. The exception was check
  results seen during implementation: lint and format failures, a crash.
- **Runner-written prompts did not raise what mattered.** Prompts that list every boundary and
  requirement grew to 1,400 words a reviewer and still compressed a requirement until its point
  was lost. Three reviewers with no prompt caught as many of the important findings per run as
  five with prompts, at about half the cost and with the lowest noise. They also caught classes
  nothing else did, such as an authority asymmetry between sibling operations. On held-out tasks
  the important findings held. Recall of the lower-impact tail is lower. Runs catch different
  important findings, so a second pass adds more than longer instructions do.

### Considered Options
1. **Three reviewers, each with a method, reading the run themselves** (chosen).
2. **Five reviewers with runner-written prompts** (ADR-0054): no better on the important
   findings, twice the cost, and the prompts can anchor or compress.
3. **Three reviewers with runner-written prompts:** the merged prompts got longer, not sharper,
   and caught fewer important findings than the same reviewers without them.
4. **Generic bug hunters with a refuting verifier:** found a security critical others missed,
   but the verifier refuted nothing at the measured noise level, and recall was lowest.

### Decision
1. **The panel.**
   - **Spec conformance** first writes down, quoted, the rules the spec, the clarifications and
     the decisions set. It then checks every operation the change adds against them, including
     the rule its sibling operation has where the documents are silent, and what it does on a
     failed read or a repeat. Then each requirement and story, the work log's claims against the
     code and tests, and documents the change made false.
   - **Code risk** keys its checks to the profile. It reads CI and build. It checks operational
     hygiene where the project is operated. It takes its standards from the run's claims together
     with those it judges, from one read of INDEX.md, to govern the change; a broken rule is the
     finding, "not claimed" alone is not.
   - **Simplicity** is capped at `info` unless the complexity blocks the next change, with at
     most five findings.
2. **The runner** writes no prompt and dispatches the three in one message with the brief. The
   docs-index check is not a review: it stays with the flows that edit documentation.
3. **Facts, not prompts.** `checks` in the brief, from the test-suite runner. A *Known open
   problems* list closes the implementation's work log.
4. **The fix loop** fixes critical and warning findings it judges safe; an info finding is fixed
   only when a person chooses it.
5. **Commands.** `/maister:reviews-spec`, `/maister:reviews-code-risk` and
   `/maister:reviews-simplicity` run each reviewer on its own, without a brief.

### Consequences
- **Good:**
  - about half the reviewer cost per pass;
  - lower noise and less churn fixed;
  - one reviewer owns each rule;
  - no prompt to anchor a reviewer or lose a requirement;
  - check results reach the reviewers whether or not the orchestrator remembered them.
- **Bad:**
  - a single pass catches about half the important findings, and different ones each run;
  - the lower-impact tail that production readiness and reality used to raise is thinner;
  - the five old commands are gone, and their users move to the three new ones.
