# ADR-0034 — A gate's continue options set the values a later guard reads

**Status**: Accepted · **Date**: 2026-10-08 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (`OPTION_KEYS`, `checkSets`, `checkContinues`, `gateValueKeys`, `canonicalOptions`); `scripts/lib/state.mjs` (`setsOf`, `WRITER_FIELDS`, `stampGateValues`, `assertRecommends`); `scripts/lib/gate-brief.mjs` (`walk`, `preferredContinue`, `recommend`, `buildCheckpoint`); `scripts/lib/checkpoint.mjs` (`waysOf`, `glance`); `references/grammar.md` § 6, § 7; `SKILL.md` § Gates; `workflows/development.yml`, `development.md`; `tests/engine/grammar.test.mjs`, `write-state.test.mjs`, `gate-brief.test.mjs`; `tests/fixtures/definitions/optional-step.yml`; ADR-0028, ADR-0030, ADR-0033

## TL;DR
An optional step was switched on by a question asked inside a node, right before the gate that
approved the same work. The operator answered twice in a row: "audit the spec?" on the assumptions
page, then "specification complete, continue?" at the gate. A gate may now offer one continue per
way on. Each continue declares `sets: {<key>: true|false}`, the writer records the chosen
option's values on the gate, and the step's guard reads `${<gate>.values.<key>}`. The node the
gate closes says which continue it recommends and why. Development's specification audit and its
browser checks are now decided at the gate before each, and the steps ask nothing.

## ADR-0034: A gate's continue options set the values a later guard reads {#adr-0034}

### Status
Accepted. This is a grammar change, and it amends the gate rule ADR-0028 and ADR-0030 worked
within: a gate had exactly one continue.
- `OPTION_KEYS` gains `sets`, a sibling of ADR-0028's `reruns` and ADR-0033's `grants`.
- The gate rule becomes: at least one continue, at least one stop, any number of revise. More
  than one continue only when each carries `sets`.
- A node summary gains `recommends: {option, reason}`.
- The development definition adopts it, so its hash moves. No other built-in does.

### Context
Two stretches of development were opt-ins asked inside a node:
- `specification` asked the audit as the last tab of its assumptions page, and
  `specification-approval` then asked to continue.
- `verification-options` asked for browser checks before verification ran. The operator decided
  without having seen the verification report, and the gate after it asked again.

The in-node question existed only because a gate could not express two ways on: its options were
routes, and both answers continued. The guard already expressed the branch. What was missing was a
way for the gate's answer to be the value the guard reads.

### Decision
**Grammar.** A continue option in its map form may carry `sets`.
- `sets` is a non-empty map of value key to `true` or `false`. A key is lower-case letters and
  underscores, the form a guard reference ends in.
- Only a continue may carry it. A stop ends the run and a revise asks the same gate again, so
  neither leaves the gate completed with a value a later guard could read.
- A gate with several continues needs `sets` on every one, all naming the same keys, and no two
  setting the same combination. Otherwise two answers would be one route.
- A single continue may carry `sets`; that is harmless.
- The keys any continue sets are the gate's declared bool values. `${<gate>.values.<key>}` is a
  legal guard and reference wherever the gate is inside the node's `needs` closure.
- A gate still declares no `outputs`. The retired `values` option key's message now points at
  `sets`.

**Identity.** `sets` is hashed with the option, its keys sorted, because it changes what an answer
does. An option written `{effect: continue}` without it still reduces to the bare effect, so no
definition that does not adopt it moves its hash.

**State.** The freeze records each gate's `sets` per option as a writer field on the node entry,
`workflow.nodes.<gate>.sets`, beside `reruns`. It is carried forward like `reruns`, so no write
re-resolves the definition.
- When a write leaves the gate `completed` with an answer whose option carries `sets`, the writer
  records that map as `workflow.nodes.<gate>.values` itself.
- A caller that sends `values` for a gate is refused `state-gate-values-sent`.
- A skipped gate records every key false, exactly as a skipped task node's bools.
- A revise that resets the gate clears its values with it.

**Checkpoint.** `walk` runs once per continue, with that option's `sets` simulated as the gate's
values. Each continue in the checkpoint options gains `sets` and its own `next`, an additive
field. The top-level `next` stays the recommended continue's walk, so the contract field is
unchanged.

**Surfaces.**
- Each continue's label is completed from its own walk ("Continue" becomes "Continue to the
  specification audit"), and its consequence names its own next node.
- The `plain` profile's glance gives each continue its own *Next* line, named by its label.
- `--oneline` prints one `Next (<option id>):` line per continue, then `Recommended:`.
- `--request` keeps its option shape, with two `effect: continue` entries.
- With four options the picker has no slot for More details, so the question ends with the typed
  "details" fallback that already existed.

**The recommendation.** The closing node's summary may name the continue it recommends:
`node_summaries.<node>.recommends: {option: <continue id>, reason: "<one line>"}`.
- The writer validates it as a continue option of a gate waiting on this node, with a one-line
  reason.
- The brief recommends that continue and shows the reason on it. Without it, the continue that
  turns the most steps on is recommended, read from what each continue sets: the resolved
  graph keeps a gate's options in key order, not as written, so position decides nothing. A `stop` risk still recommends stopping.
- This is how development's `--audit` / `--no-audit` and `--e2e` / `--no-e2e` still count. A
  supplied flag makes the node recommend the matching continue, with the reason that it was asked
  for, or declined, when the run started. The gate is always asked, so a flag no longer skips a
  question.

### Alternatives considered

| Alternative | Why not |
|---|---|
| The guard reads the gate's answer directly, `${gate.chose.option}` | A guard would name an option id, which is display-adjacent and changes when an option is renamed. A skipped gate has no answer to read, and a revise would need its own clearing rule. A value keeps one reader shape for task nodes and gates alike |
| Keep the in-node question | It is the double ask this removes. For browser checks it also asks before the operator has seen the verification report |
| The gate declares `outputs.values`, and each option names which it sets | Two places to keep in step for one fact. The keys the continues set are the declaration |
| A separate recommend-when guard on each option | A second expression on an option, for a choice that depends on prose context the graph cannot see: a flag, the gap analysis's seed, whether the change has a user interface. The closing node already writes the summary the brief reads, so it writes the recommendation there |

### Consequences
- The development definition's hash moves. Frozen runs of the old graph keep their own frozen
  graph, and a gate brief over a drifted run reports the drift as before.
- Research's `optional-phases-decision` is the same double ask, after `foundation-approval`, and is
  left as it is. Its two choices are independent, and deciding both at the gate would need four
  continues beside its revise and its stop, more than a gate's question holds.
- The Pro Edition's contract lint and the cockpit's graph checks enforce exactly one continue.
  Both need the new rule, and their gate-option schema needs `sets`, before a driven run of the new
  development definition validates there. Both re-pin the development hash.
- The frozen node entry gains the writer field `sets`, beside `reruns`. The Pro register's state
  row lists it.
- Development's `orchestrator.options.spec_audit_enabled` is no longer written: nothing read it
  but the node prose, and the gate's recorded value is the answer. `e2e_enabled` stays the gap
  analysis's seed for the verification node's recommendation, and is not mirrored from the answer.
