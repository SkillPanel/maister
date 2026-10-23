# ADR-0052 — Implementation's waves run in a runner subagent, on the verification runner's contract

**Status**: Accepted · **Date**: 2026-10-22 · **Builds on**: ADR-0051 (the runner contract), ADR-0050 (models on each call) · **Sources**: `plugins/maister/agents/implementation-runner.md`; `skills/implementation-plan-executor/SKILL.md`; `skills/workflow-engine/scripts/lib/runner.mjs`, `display-files.mjs`, `dashboard.mjs`; `skills/orchestrator-framework/references/orchestrator-patterns.md` § 1 and § 8; the `implementation` prose of `development.md` and `performance.md`, and migration's `execution`; `tests/engine/implementation-runner.test.mjs`, `delegation.test.mjs`

## TL;DR
- **One subagent runs the waves.** Where the run recorded `delegation.mode: nested` at the
  freeze, `implementation-plan-executor` dispatches `implementation-runner`, which computes the
  waves, dispatches one `task-group-implementer` per group on the model `dispatch-model --tier`
  resolves, records every `wave-start` and `group-done`, escalates a failed group once, keeps the
  model budget, refreshes the docs index, runs the full suite and writes the closing entry.
- **The same two verbs.** `runner-result` and `runner-step` take `--runner=implementation`; the
  runner's files live in `implementation/` beside the plan and the work log.
- **Decisions are question sets.** What the executor asked in session — a group that failed
  after its escalation, a skipped test step, a wave past the budget — the runner writes as one
  question set and returns; the node asks it under the run's driver, and the answers travel to
  the next dispatch in `implementation/decisions-<pass>.json`.
- **Inline stays**, in the main session, with every group still a subagent call.

## ADR-0052 {#adr-0052}

### Status
Accepted. No workflow definition changes and no graph hash moves: every implementation node
keeps `uses: skill:implementation-plan-executor` (the dashboard finds the executor by that line),
and the skill becomes the hand-off. The runner's files are new files of the run; no state key is
added.

### Context
The executor ran every step of the implementation phase in the main session: per wave a model
resolution, a wave start, one implementer call per group, a group return per report, failure
analysis, escalations and questions, then the docs refresh and the closing entry — each a call in
a context that already carried the whole run. ADR-0051 settled how a loop moves into a runner
and comes back; the waves had their resume record already, in the plan's checkboxes and the work
log.

### Considered Options
1. **The verification contract over waves, the two verbs generalised by a flag** (chosen). One
   pair of verbs, one asking ladder, one crash path; the loop's resume record stays the plan and
   the log.
2. **A second pair of verbs for implementation.** Clearer names, but two copies of the
   ask/suspend/default ladder and of the result checks to keep in step.
3. **A state block for the waves**, like `verification_context`. Would let the result be judged
   against a recorded wave, but duplicates what the plan and the log already say and adds a key
   every reader must learn.

### Decision
1. **The result.** `done` with the work log and a summary — groups done of total, the model
   tally, the full suite, the documents changed, the standard candidates, and `stopped` when a
   person chose Stop; `needs_decision` with its kind (`groups` or `budget`), its wave and a
   question set the engine's question-set check accepts; or `unavailable`.
2. **The pass.** A result is stamped with its pass, one more than the decisions files of the
   node's attempt, so a decision's answers file is named without a state key. A decision whose
   answers file exists is re-dispatched with it; the runner carries out only answers not already
   carried out, read from the plan and the log, so a crash after a re-dispatch takes the same
   path again safely.
3. **Fresh or auto** is the work log's presence: the plan's checkboxes say which groups are done,
   the log which wave started, and `group-done` writes nothing twice.
4. **Answers** are read from the node summary under each question's own id; a question nobody
   answered takes its default. A group already retried on a default answer in the attempt gets
   Stop as its default, so a run nobody can ask never loops on one group.
5. **The runner's model** has no entry in maister's own table: it judges whether a report is
   accepted and what a failure calls for, so it inherits the session's model.
6. **The mode is shown** on the status line and the dashboard card while the executor's node
   runs, as for the verifier's.

### Consequences
- **Good:** the main session's implementation work shrinks to one dispatch per pass, at most one
  question set per pass and the node's own writes. Resume, a cleared session and a compaction
  need no new path. The verbs stay one pair.
- **Bad:** each answered decision costs one runner start. A wave's decision waits for every
  sibling to return before anyone is asked, as before. A depth-1 setting gets no saving.
