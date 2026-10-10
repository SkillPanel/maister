# ADR-0041 — A review finding that needs a decision is asked as its own question

**Status**: Accepted · **Date**: 2026-10-10 · **Builds on**: ADR-0039 (the engine renders a question set from a record), ADR-0040 (in-node questions classed under the autonomy ceiling), ADR-0037 (settlement items on a gate answer) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/finding-brief.mjs`; `scripts/lib/state.mjs` (`judgeGates`); `scripts/lib/gate-brief.mjs` (`policyReading`); `SKILL.md` § *Findings that need a decision*, § Gates; `workflows/development.md`, `performance.md`, `migration.md` (`spec-audit`, `verification`, `issue-resolution`); `orchestrator-patterns.md` § 6; `agents/spec-auditor.md`; `skills/implementation-verifier/SKILL.md`; `tests/engine/finding-decisions.test.mjs`, `triage.test.mjs`, `same-questions.test.mjs`

## TL;DR
A specification audit asked nothing inside its step, and the verification fix loop asked its
decisions only when they were the step's first ask. Findings that needed a person reached the
gate as a list of open risks, and the gate offered only continue, revise or stop for all of them
together. Now each such finding is its own question, built by the engine from the reviewer's
findings: the proposed change, the alternatives, "Accept the risk and list it", the recommendation
with its reason, and the evidence. A continue that sets gate values under a classed gate now
records each value as its own item.

## ADR-0041: A review finding that needs a decision is asked as its own question {#adr-0041}

### Status
Accepted. No definition changes and no built-in hash moves.
- New verb: `finding-brief`. It reads a findings file in the run (closed keys) and writes no
  state.
- New declared question ids: `spec-audit-findings` (development, performance),
  `verification-findings` (development, performance) and `issue-resolution-findings`
  (migration). Each finding's question is `<declared>-<finding id>`.
- New refusals: `finding-brief-state-unreadable`, `finding-brief-unknown-node`,
  `finding-brief-not-running` and `finding-brief-undeclared`. New warnings: `finding-list-missing`,
  `finding-list-invalid` and `finding-list-unwritable`.
- The reviewer's structured result gains `name`, `title`, `evidence`, `options`, `recommended` and
  `reason` on each finding that needs a decision.
- **Settlement items:**
  - A value a classed gate's continue sets is recorded even when the policy classes the value
    itself not. It carries the gate's class.
  - The checkpoint's `approves` lists it the same way.

### Context
A person should decide each finding that needs a decision on its own. A crash left open, or
two plausible fixes, should never be folded into one continue. The engine already had every step
after the asking: the classing write, the request, the fold into one decision per question, and
one approval per held choice. What was missing was the set itself. Each node composed it in prose,
and the specification audit composed none.

### Decision
**The engine builds the set from the reviewer's record.** The node writes the findings to a JSON
file in the run, and `finding-brief` turns each finding into one question, most severe first,
with the generated accept option. It never classes. The classing write classes the set through
the prose-declared `<node>-findings` id, so one policy row covers every finding of a step. In
session, one cockpit request, or a policy that holds an approval-class finding, the set travels
as any in-node set does. An unusable file is a fallback, and the node composes the same questions
itself.

**The review steps ask after their own fixes.** The audit's fix pass and the fix loop's automatic
fixes and re-checks run first. Only then are the findings still needing a person asked.
- A chosen change is applied.
- An accepted risk is a `tradeoff` risk.
- A finding nobody could be asked about stays an `open` risk, unless the policy settles,
  defaults or holds it.

The stopping question of the fix loop follows the set, and under a cockpit it takes its default,
because the set was the step's one request.

**A continue folds nothing.** A gate the policy classes records each value its continue sets as
its own settlement item. The item carries the value's class, or the gate's when the policy names
none for the value. Under the built-in default policy nothing is recorded beyond the answer.

### Consequences
- The specification audit can now ask, which adds one in-node ask to development and one to
  performance.
- A policy can class review findings by one id per step.
- A dispatched run holds an approval-class finding for the next checkpoint instead of leaving it
  as an unnoticed open risk.
- Settlement items appear for values that were silent before, under a classed gate only.

### Alternatives considered
- **Ask the findings at the gate.** A gate offers a fixed set of options and records one answer,
  so it cannot carry a choice per finding.
- **Compose the set in prose, as before.** The terminal and a cockpit would read two
  model-written texts, and no test could pin the generated options.
