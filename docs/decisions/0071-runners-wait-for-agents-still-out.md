# ADR-0071 — Runners wait for the agents they sent

**Status**: Accepted · **Date**: 2026-11-16 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/runner.mjs` (`in-flight`, `runner-step`'s `wait`, the `waiting` result); `agents/implementation-runner.md`, `agents/verification-runner.md`; `skills/implementation-plan-executor/SKILL.md`, `skills/implementation-verifier/SKILL.md`; `tests/engine/agents-in-flight.test.mjs`

## TL;DR
A runner records each agent before sending it, stamped with the session that sent it. A runner
that has to end with agents still running returns `waiting`. While an agent from this session has
not reported, `runner-step` prints `wait` instead of `dispatch`. The node then waits for those
agents' completion notices and asks again. `unavailable` now means only that the runner could not
run, and the engine refuses it while that runner's agents are still out.

## ADR-0071 {#adr-0071}

### Status
Accepted.

### Context
Some hosts run a subagent's own agent calls in the background, so each call returns at once. The
same hosts make a subagent hand back when it ends a turn idle. The implementation runner could not
block on its wave, and when it was made to hand back, its only result was `unavailable`. That
narrowed the run to inline delegation for good. Its implementers kept running, and a resume could
send a second implementer onto a group whose first was still live.

### Decision
- **A record before each agent acts.** `in-flight --record` writes `<runner>/in-flight.json` with
  each agent's id, the output it owes, the calling session and the clock. Verification's records
  also carry the cycle. Recording deletes the output's stale copy, so an output on disk always
  answers the latest dispatch. `--agents` attaches the ids a host returns at launch. `--ended`
  releases an agent whose completion came without its output.
- **Liveness is the session.** A background agent lives in its session's process. An agent counts
  as still out only while its record names the current session, it is not ended, and its output is
  missing. A record from another session, or from a host that names no session, is never waited
  for. That keeps the old resume behaviour there.
- **`waiting` and `wait`.** The `waiting` result names the agents still out, and each one must be
  recorded. `runner-step` turns any "continue from the files" dispatch into `wait` while an agent
  is out, whatever the result says, so a runner that died with no result is covered too.
- **Adopt, never re-send.** A resumed runner adopts an output on disk as if its agent had just
  returned.
- **A file, not a state key.** The record sits in the loop's folder, beside `runner-result.json`.
  The state's patch vocabulary stays closed and its frozen shapes are unchanged.
- **Both runners.** Verification sends three reviewers and parallel fix batches the same way, and
  a duplicate fix batch collides on files just as a duplicate implementer does.

### Consequences
- The implementer writes its report to the `report_path` its prompt names, as well as returning it.
- Unverified on the host itself:
  - that a subagent's shell sees the same session id as the main session's. If it sees another,
    nothing is waited for, which is the old behaviour;
  - what a cleared session does to background agents.
- The verb suite cannot see the model's side: ending with `waiting`, waiting for notices, judging
  an adopted report.
- The interface gains the `in-flight` verb and its refusals: 1.14 → 1.15, and the variant's
  1.15 → 1.16.
