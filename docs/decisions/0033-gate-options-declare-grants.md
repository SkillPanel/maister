# ADR-0033 — A gate's continue option declares what its answer grants

**Status**: Accepted · **Date**: 2026-10-07 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (`OPTION_KEYS`, `OPTION_GRANTS`, `checkGrants`, `canonicalOptions`); `scripts/lib/gate-brief.mjs` (`grantsOf`, `buildCheckpoint`); `scripts/lib/checkpoint.mjs` (`grantsText`, `richPicker`, `plainPicker`, `requestOf`); `references/grammar.md` § 6; `SKILL.md` § Gates; `tests/engine/grammar.test.mjs`, `gate-brief.test.mjs`; ADR-0028, ADR-0030

## TL;DR
Approving a plan at its gate should also mean "push the branch and open the pull request". The gate
had no way to say that. A worker that needed approval for every push treated the push as a second
decision, and asked for it where nobody was looking. A gate's continue option now declares
`grants: [push, pr-create]`. The checkpoint carries the grants and every surface says them in the
option's label. The driver that delivers the answer registers the grant, and the node after the
gate acts on it without asking again.

## ADR-0033: A gate's continue option declares what its answer grants {#adr-0033}

### Status
Accepted. This is a grammar change. No built-in definition uses it, so no built-in hash moves.
- `OPTION_KEYS` gains `grants`. The names form a closed set, `OPTION_GRANTS`: `push` and
  `pr-create`.
- The checkpoint's reserved `grants` (ADR-0030) is filled.

### Context
The decision that matters is approving the plan. The push and the pull request that follow add no
safety when they are asked again, and they stall a driven run on a question no surface shows. The
answer itself was the approval, but nothing in the gate said that it was.

### Decision
**Grammar.** A gate option in its map form may carry `grants`.
- `grants` is a non-empty list of names from `OPTION_GRANTS`, each named once.
- Only the continue option may carry it. A stop ends the run and a revise asks the same gate
  again, so after either answer no node would act on a grant. The refusal mirrors the one for
  `reruns` on a non-revise option.
- Each refusal is located at `nodes.<gate>.options.<option>.grants`:
  - an unknown name, with a did-you-mean;
  - a duplicate;
  - an empty list or a non-list;
  - a non-continue effect.
- `grants` outside an option is refused by the closed node key set.

**Identity.** The grants are hashed with the option, because they change what an answer
authorises. They are reduced to the closed set's order first, so `[pr-create, push]` and
`[push, pr-create]` are one graph. An option written `{effect: continue}` without grants still
reduces to the bare effect, so no existing hash moves.

**The checkpoint.** `grants` maps each option id that declares grants to their names in
closed-set order, and is `{}` when no option declares any. This is the shape ADR-0030 reserved:
one map, not a copy on each option, so there is one source.

**Surfaces.**
- Both pickers append the grant to the option's label in plain words: "— also pushes the branch
  and opens the pull request". The rich picker shows no description once options carry
  previews, so the label is the one place it is always seen.
- `--oneline` gains one section per granting option.
- `--request` leaves its top-level keys and its options' keys and labels as they were. The grant
  travels in `context.checkpoint.grants`, which a cockpit renders its own way, and in the
  one-line `context.summary`.

**Who acts on it.** The engine grants no permission and pushes nothing.
- A driver registers the grant for the worker when it delivers the answer.
- The node prose after the gate pushes the run's own branch and opens the pull request.
- In session, the operator's answer is itself the approval.
- Merging is never a grant.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Say it in the option label only | The label is display text, outside the hash. A cockpit could not register anything from it, and an overlay could relabel the option without changing what it authorised |
| Grants on any effect | After a stop or a revise no node runs that would act on the grant. It would be shown and hashed, and never used |
| `grants` copied onto each checkpoint option | Two sources for one fact. ADR-0030 had already reserved a single map |
| An open set of names | A driver must know what each name allows. An unknown name would be a grant nobody can honour |

### Consequences
- A workflow that adopts `grants` moves its own hash, and only its own.
- A cockpit that ignores `checkpoint.grants` still shows the request as before. The grant is then
  unregistered, and the worker asks again as it does today.
- Any new grant name is a grammar change, and needs a driver that knows what the name allows.
