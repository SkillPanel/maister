# ADR-0058 — On Copilot the runners do not nest

**Status**: Accepted · **Date**: 2026-10-25 · **Amends**: ADR-0051, ADR-0052 (where a runner is used) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs` (`seedDelegation`, `frozenOnCopilot`); `runner.mjs` (`runnerStep`); `platforms/copilot-cli/build.sh` § 8; `Makefile` (the allowlist lint); `references/writing-state.md` § *Who writes a run's state*; `tests/engine/delegation.test.mjs`, `tests/engine/verification-runner.test.mjs`

## TL;DR
A run frozen on Copilot records its delegation as `inline`, and no Copilot agent is granted the
agent tool. The verification and implementation loops run in the main session there, so no
Copilot subagent dispatches another and none runs a state-writing verb. Claude Code is unchanged.

## ADR-0058 {#adr-0058}

### Status
Accepted. No definition changes and no graph hash moves.

### Context
The runners need a subagent that dispatches subagents. Claude Code gives a subagent's calls its
main session's `session_id` at every depth; Copilot CLI gives every subagent level a `session_id`
of its own (seen in a recorded Copilot 1.0.102 session: a subagent's `preToolUse` input carries a
session id other than the main session's). A host-side guard that binds a run to its driver's
session therefore cannot tell a Copilot runner, or anything that runner dispatches, from an
unrelated caller — and it has to let the runner's state writes through, so it cannot hold them
either. While a run waited at a gate, a nested Copilot subagent could run Bash and the engine's
state-writing verbs on that run.

Only the two runners dispatch subagents, and only the two runners run state-writing verbs; every
other agent is a leaf that at most reads the run.

### Decision
1. **The freeze records `inline` on Copilot**, with the depth and source as before and a one-line
   `reason`, driven or not. `runner-step` also reads a record frozen `nested` on Copilot (its
   source naming `copilot default`) as `inline`, so a run frozen before this change resumes inline.
2. **No Copilot agent gets the agent tool.** The build's allowlist leaves it out, and `make
   validate` fails a variant agent that grants it. A runner dispatched anyway finds no agent tool
   and ends `unavailable`, and its node runs the loop in the session.
3. **The rule a guard can rely on is documented** in `writing-state.md`: the state-writing verbs are
   run only by the driving session and, where the run records `nested`, its runners, which on
   Claude Code carry the driving session's `session_id`. A guard compares the hook payload's
   `session_id` with `orchestrator.driver.session.id`.

### Rejected: a delegating-binding field on the runner verbs
A field on `runner-result` and the state verbs naming the session that delegated the runner would
be a value the caller supplies. Any process that can read the state file can read
`orchestrator.driver.session.id` and repeat it, so a guard that accepted the field would let
through exactly the caller it is meant to hold. With the runners inline on Copilot, no caller
needs the field: every legitimate write already comes from the driver's own session id.

### Consequences
- On Copilot implementation and verification make more main-session calls than a runner would.
- Flat mode (a runner that plans and returns a dispatch list for the main session to run at depth
  one) stays available as a later cost saving on hosts without session-bound nesting.
