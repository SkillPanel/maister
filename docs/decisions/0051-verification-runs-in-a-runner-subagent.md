# ADR-0051 — Verification's loop runs in a runner subagent, continued by re-dispatch

**Status**: Accepted · **Date**: 2026-10-22 · **Builds on**: ADR-0050 (models on each call), ADR-0041 (findings asked one question each), ADR-0006 (additive state) · **Sources**: `plugins/maister/agents/verification-runner.md`; `skills/implementation-verifier/SKILL.md`; `skills/workflow-engine/scripts/lib/runner.mjs`, `state.mjs` (`seedDelegation`, `narrowDelegation`); `skills/orchestrator-framework/references/orchestrator-patterns.md` § 1, § 4 and § 6; the `verification` prose of `development.md`, `performance.md` and `migration.md`, and migration's `issue-resolution`; `tests/engine/verification-runner.test.mjs`, `delegation.test.mjs`

## TL;DR
- **One subagent runs the loop.** Where the run recorded `delegation.mode: nested` at the freeze,
  `implementation-verifier` dispatches `verification-runner`, which runs the cycles, the review
  panel, `findings-merge`, the batched fix passes, the re-checks and the report, and makes every
  `verification_context` write. The main session makes one call per runner pass.
- **Re-dispatch is the contract.** The runner ends every dispatch with one result —
  `verdict`, `needs_decision` or `unavailable` — in `verification/runner-result.json`. The node
  asks a decision as it did before, writes `verification/decisions-<cycle>.json` and dispatches
  again. A crash, a cleared session or a compaction take the same path; the engine's
  `runner-step` says which move is next.
- **Inline stays.** A run recorded `inline`, or a runner that finds it cannot start subagents,
  runs the same procedure in the main session — the runner's instructions are the one copy.
- **The runner always runs in the foreground**: `run_in_background: false`, explicitly, on every
  host.

## ADR-0051 {#adr-0051}

### Status
Accepted. No workflow definition changes and no graph hash moves: every verification node keeps
`uses: skill:implementation-verifier` (the status line finds the verifier by that line), and
migration's `issue-resolution` stays `direct:`. The new `verification_context` keys (`cycle`,
`snapshot`, `node`, `attempt`) and the delegation's `reason` are additive.

### Context
The verification loop ran in the main session: a brief, the test suite, up to five reviews, a
merge, a report, fix agents and re-checks within a budget of two, each step a call and a state
write in a context that had already carried the whole run. Both hosts let a subagent dispatch
subagents (Claude Code three levels below the main session, Copilot four), and a runner needs
two. The open questions were how a runner gets a person's answer, and how a run resumes when the
runner's process is gone.

### Considered Options
1. **Re-dispatch, batched fixes, the runner owns the cycle writes** (chosen). One continuation
   path on every host, which is also the crash path; each answered decision costs one fresh
   runner start.
2. **Resume the finished runner first** (Claude Code's message to a finished agent, Copilot's
   background mode), re-dispatch after a crash. Saves a start, but answers arrive asynchronously,
   there are two paths, and on Copilot every runner would have to run in the background.
3. **Re-dispatch with fixes made inside the runner**, per-review writes dropped. Fewer dispatches,
   but the runner's context grows, its own model makes the fixes, and the status line moves once
   per cycle.

### Decision
1. **The contract.** `runner-result` checks the result's closed shape and stamps the node, its
   attempt and the cycle. `runner-step` compares the result with `verification_context`: a result
   of another node or attempt, or one older than the recorded cycle, is not acted on, and the
   runner is dispatched to continue from the cycle files (`resume: auto`); no cycle recorded in
   this node's attempt starts a fresh one; a decisions file for the result's cycle resumes with it.
2. **Decisions.** The answers are read from the node summary, where any in-node answer is
   recorded: in session after `--answered`; under a driver that carries question sets, the
   attempt's one request, used once (a later decision in the attempt takes the defaults); where
   nobody can be asked and the policy classes nothing, the defaults at once. The stopping
   question keeps its id, `verification-fix-loop`.
3. **Fixes are batched** by file or area into `task-group-implementer` calls on what
   `dispatch-model --node` prints, never one agent per finding.
4. **The HTML companion is written once**, at the final verdict, never on a decision.
5. **The runner's model** has no entry in maister's own table: like the fix loops, it inherits the
   session's model, because it judges what is fixable, what is risky and what a re-check covers.
6. **Narrowing.** `delegation` stays the freeze's record, with one exception: after the freeze a
   `nested` run may narrow to `inline` with a one-line reason, which is how the hand-off records a
   runner's `unavailable`. It never widens.
7. **Migration.** Its `verification` node runs one cycle with no fixes; its four migration checks
   become a findings file merged into the same numbered list, so the runner's later writes keep
   them; `issue-resolution` asks its data-integrity question first, then hands the fix loop to the
   runner with data-integrity findings held.

### Consequences
- **Good:** the main session's verification work shrinks to one dispatch, at most one question
  set, one re-dispatch per answered decision and the node's own writes. Resume needs no new path.
  The same contract carries over to an implementation runner.
- **Bad:** each answered decision costs one runner start. Containment rests on the sentence every
  agent carries and the host's depth limit. A depth-1 setting gets no saving until a flat mode
  exists.
