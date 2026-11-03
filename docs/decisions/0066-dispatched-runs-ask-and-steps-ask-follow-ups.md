# ADR-0066 — A dispatched run carries question sets, and a step may ask two follow-up rounds

**Status**: Accepted · **Date**: 2026-11-03 · **Amends**: ADR-0032 (one request per node attempt; no question sets under dispatch), ADR-0048 (decision 4, question sets in a dispatched run), ADR-0051 (decision 2, a runner decision's answers) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/driver.mjs` (`questionSets`); `scripts/lib/question-set.mjs` (`ROUNDS_MAX`, `roundsAsked`, `questionRequest`); `scripts/lib/gate-brief.mjs` (`questionBrief`); `scripts/lib/state.mjs` (`seedFeatures`, `foldQuestionAnswer`, `keepRounds`); `scripts/lib/runner.mjs` (`decide`); `scripts/lib/interface-shapes.mjs` (`GATE_REQUEST.round`); `SKILL.md`; `references/in-node-questions.md`, `references/gates.md`, `references/sub-runs.md`; `orchestrator-framework/references/orchestrator-patterns.md` § 2.2, § 6; the five workflow node-prose files; `tests/engine/in-step-questions.test.mjs`, `dispatched-run.test.mjs`, `sub-runs.test.mjs`, `verification-runner.test.mjs`, `implementation-runner.test.mjs`

## TL;DR
- **A dispatched run carries question sets when its cockpit driver lists `question-sets`**,
  exactly as a run the cockpit drives directly. Without the feature, and under the legacy
  `kind: dispatch`, its in-step questions keep their named defaults.
- **A step may send follow-up sets in the same attempt**: everything known goes in the first
  request; a question only an answer raised may go in a follow-up, two follow-up rounds at most.
  `gate-brief --request` refuses a fourth request in one attempt `gate-brief-rounds-spent`.
- **Each question request carries its `round`** (1, 2 or 3), and an answer folded from a
  follow-up is stamped with its round.

## ADR-0066 {#adr-0066}

### Status
Accepted. It amends ADR-0032's "one request per node attempt" and its rejected alternative
"Suspend under `dispatch` as well", and ADR-0048's decision 4, which kept that rejection when
dispatched runs moved to the cockpit kind. Every other rule of both stands: the request shape,
the fold, "write before asking", the attempt stamps, the reading rule for a dispatched run, `via:
dispatch`. No workflow definition changes, so no `graph_hash` moves.

### Context
ADR-0032 rejected question sets under dispatch because "a worker has no form to show a set on;
its run would wait on a question nobody can answer". That premise no longer holds: a dispatched
run's gates already suspend, and the driver mirrors them and answers them by proxy. A question
set is a request of the same kind, carried the same way; only the engine kept it from a
dispatched run. In a multi-repository chain that meant every in-step question of a member's
step — a gap analysis's scope decisions, a specification's clarifications — was defaulted.

"One request per node attempt" assumed the session that asked might not be the one the answer
returns to, so nothing could depend on the session's own context across a second ask. In
practice the answer is delivered into the same session when it is attached, the same
conversation is resumed when it is not, and a fresh session starts only when that one is lost —
and "write before asking" already covers that case. Meanwhile a two-stage step (a clarifying page,
then a proposal built from its answers) could not ask its second stage, and the fix loop's
stopping point never reached a person after the finding questions.

### Decision
1. **The reading rule.** `questionSets` is true for a `kind: cockpit` driver whose `features`
   list `question-sets`, dispatched or not. The legacy `kind: dispatch` never carries them,
   whatever it lists. A sub-run inherits `question-sets` only from a parent that carries them.
2. **Rounds.** At its first asking point a node asks everything it can form there, as before. It
   may send one more set only for questions an answer raised that it could not have formed
   before, up to `ROUNDS_MAX` (3) requests in one attempt. A revise's new attempt counts afresh.
3. **Counting.** The engine counts the rounds from the node's own summary: the highest `round`
   among the operator answers of this attempt, an answer with none counting as round 1.
   `gate-brief --request` (and `--checkpoint`) builds the next request as that count plus one,
   and refuses `gate-brief-rounds-spent`, writing nothing, past the third. The node then takes
   each question's named default and records it `by: default`. In-session asking (`--ask`) is
   not capped: no request is written.
4. **Recording.** The request carries `round`, an integer; the interface file declares it as an
   optional key of the request, so the step is a minor one (1.10 to 1.11), and the new refusal
   is listed under `gate-brief`. The fold stamps `round` on each answer from a round past the
   first, as it stamps `attempt` on an attempt past the first; a closing write re-sending those
   answers without it keeps the held round.
5. **Runner loops.** The verification and implementation runners' decisions under question sets
   follow the same rounds: each decisions file records `rounds_seen`, the rounds answered when it
   was written; a decision is answered when a round came back since the newest file, asked while
   a round is left, and defaulted once the rounds are spent. A file without `rounds_seen` spent
   its attempt's one request under the old rule, so the attempt keeps the defaults.
6. **Write before asking, every round.** Each round's questions, the work they rest on and the
   earlier rounds' answers are on disk before it suspends.

### Consequences
- A host that does not seed `question-sets` into a dispatched worker's driver is unaffected: its
  runs keep the defaults, so the engine can ship ahead of the host.
- A driver that renders a question request may show its `round`; one that ignores the key loses
  nothing.
- Node prose names "the first request" where it said "the node's one request", and a question
  that once took its default because it came after the first ask now goes in a follow-up round.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the cap in prose only | A model that loses count would ask a fourth time, and the driver would show one more card than the rule allows; the verb that builds every request is the one place it holds |
| A separate counter on the node summary | A second record of what the folded answers already say; it could drift from them on a re-sent summary |
| No cap | A step that keeps asking turns a run into a conversation the operator never agreed to; two follow-ups cover a clarifying stage and a proposal built from it |
| Count the rounds in the request writer | That writer is not part of every edition, and the request it takes is the brief's output, so the brief already holds the cap for both |
