# ADR-0027 — Overlays attach added nodes upstream with `before:`

**Status**: Accepted · **Date**: 2026-09-30 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (`applyOps`, `placeBefore`, `mergeWith`, `checkOps`); `scripts/lib/gate-brief.mjs` (the stretch a gate closes); `scripts/lib/state.mjs` (`definitionOf`); `docs/extending.md` § Overlays and eject over the built-ins; `tests/engine/overlays.test.mjs`; ADR-0015

## TL;DR
ADR-0015 kept `needs` immutable so an overlay could not reshape a graph. That rule left an overlay
able to add a node without being able to make anything wait for it, so an added phase or verifier
ran as a side branch: its place in the frozen order came from the spelling of its id, and no gate
held for it. This record amends ADR-0015 with one additive edge:
- **`add.<id>.before: [<node>, …]`** names the nodes that wait for the added node. Each of them
  gains the added node in its `needs`. No need the base declares is removed or rerouted.
- **Disabling a node and adding it back under the same id is refused.** That pair was the one way
  an overlay could already reshape a graph, and it is closed.
- **A tuned `with` merges into the node's own, key by key**, with `null` deleting a key.

## ADR-0027: Overlays attach added nodes upstream with `before:` {#adr-0027}

### Status
Accepted. Amends ADR-0015: `needs` stays untunable, and an overlay gains one additive way to write
an edge into a node it did not add. Built-in `graph_hash` values do not move, because none of the
three changes touches a graph resolved without an overlay.

### Context
The main reason to overlay a workflow is to put something *in* it: a threat model before planning,
a security verifier the verification gate waits for, a sign-off before implementation. ADR-0015's
narrow tuning surface allowed none of these. `add` could introduce the node and attach it
*downstream* through its own `needs`, but nothing *upstream* could be made to wait for it. The
consequences were all silent:
- the added node ran wherever the tie-break on ids placed it, so a verifier named to sort late ran
  after the run had reported completion;
- the next gate's brief never showed it;
- nothing required it to have run before the run completed.

Meanwhile one path could already reshape a graph. `disable` rewires a removed node's dependents to
its own needs, and `add` refused only an id the graph still carried. So disabling a gate and adding
it back under its own id validated, and it produced a gate of the right name that held nothing.
That was exactly the reroute-around-a-gate ADR-0015 set out to prevent.

`tune.with` had its own silent failure: it replaced the node's whole map, so tuning one input
dropped every input the base passed.

### Decision Drivers
- The overlay's guarantee is that a resolved graph stays reviewable against its base. Whatever is
  added must keep that property.
- An operator placing a verifier has to be able to make a gate wait for it, or the verifier is
  advisory at best.
- A reshape that validates is worse than one that is refused. Every silent path has to become a
  refusal or a defined meaning.

### Considered Options
1. Make `needs` tunable
2. An `insert` operation that splices a node between two named nodes
3. **`before:` on an added node, additive only** ← chosen

### Decision Outcome
Chosen option: **`before:` on an added node**.

Option 1 is what ADR-0015 rejected, and the reason stands: a tunable `needs` can drop an edge,
which is how a run steps around a gate. Option 2 has to decide which edge it replaces. When the
downstream node has several needs, or the spliced node has needs of its own, it either rewrites an
edge the base declared or grows rules for which one it means. `before:` needs neither. It only
*adds* waits, and only on the overlay's own node, so the base's edges all survive. An overlay can
make a node wait for more, never for less.

**What `before:` does.** Once every add of the body is in, each node that `before:` names gains
the added node in its `needs`. The key is consumed by the resolver and never carried on the node,
so the result is an ordinary graph. It hashes exactly as an eject declaring the same edges by
hand, which keeps ADR-0015's rule that provenance stays outside the hash.

**When `before:` is refused.** It is refused, located at the entry, when it names:
- a node the graph does not carry, and when an overlay disabled it, the refusal names the file;
- the added node itself;
- a node the added node already needs, which would close a cycle; the refusal names the path.

**`needs` stays required.** An added node still attaches downstream through `needs`, and `before:`
is the upstream half. A node attached only through `before:` would be a new root that runs before
the base's entry node, ahead of the intake that establishes what the run is about. That is not
admitted.

**The same-id re-add is refused.** An `add` under an id any overlay or profile disabled is refused,
naming this overlay or the file that did the disabling. The refusal points at `tune` for a changed
input, and at a new id with `before:` for a different node in the same place. With the back door
closed, `before:` is the only way an overlay writes into a base node's `needs`.

**`tune.with` merges.** A tuned `with` is laid over the node's own, key by key: a named key takes
the tuned value, `null` deletes the key, and every other key is kept. The merge is one level deep,
and a `with` that is not a mapping is refused. Deleting a key is also how a dependent stops reading
a node the overlay disables.

**What changes around it.**
- `validate` warns `added-node-no-dependents` for an added node that nothing needs. The warning
  names the position the node will run at and points at `before:`.
- A gate brief now gathers every node in the stretch the gate closes, back to the previous gate,
  so a node placed before a gate is reported at that gate.
- A run's definition is read with its overlays folded in, so an added node's declared artifacts,
  icon and progress reach the dashboard and the closing summary.

### Consequences

#### Good
- A phase can go between two phases, and a verifier can hold a gate, without an eject.
- Nothing an overlay adds can shorten the path a base declares. Reviewing an overlay still means
  reading what it adds.
- The same-id reroute is closed, so ADR-0015's guarantee holds without exception.
- A one-key tune means what it says.

#### Bad
- A tune that relied on the old replace semantics to drop inputs now keeps them. It has to write
  `null` for each key it meant to drop.
- An overlay can no longer replace a node in place. A replacement is a new id placed with
  `before:`, and a dependent that reads the old node's outputs must be tuned or ejected.
- Gate briefs grow when a stretch holds more than one summarised node. The budget trims the extras
  first, but a brief read at a busy gate is longer than it was.
- ADR-0015's reasons for keeping performance and migration out of overlays do not change. The
  context block is still derived from the workflow name.
