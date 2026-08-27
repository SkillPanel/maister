# ADR-0015 — Overlays cannot repurpose a definition into another workflow

**Status**: Accepted · **Date**: 2026-08-27 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (the tunable-key set, the overlay base check); `scripts/lib/state.mjs` (the workflow-name-to-context-block map); `compatibility-contracts.md` § B1; ADR-0014

## TL;DR
The performance and migration workflows reuse most of development's phases, which makes them look like overlays of its definition. They are not, and cannot be. An overlay may tune only `with`, `optional` and `provider`; `needs` is immutable, so a workflow needing an extra node **in the chain** cannot get one. Independently of that, the state writer derives a run's context block from the **workflow name**, so an overlay of `development` would write development's context block into a run that requires its own. Both workflows are **deferred as separate definitions**, and this record exists so the constraint is not rediscovered.

## ADR-0015: Overlays cannot repurpose a definition into another workflow {#adr-0015}

### Status
Accepted. Nothing here changes a registered shape; it records a limit two shapes already impose, and a deferral that follows from it.

### Context
Performance and migration are, read as prose, development with edits. Performance adds an analysis phase near the front and narrows what the later phases work on. Migration adds artifacts of its own and asks different things at its gates. Both share development's planning, implementation and verification stretches almost verbatim. The overlay mechanism exists precisely so a graph can be adapted without being forked, so the obvious move is to ship each as an overlay over the development definition and save two-thirds of the authoring.

The obvious move does not work, and it fails in two unrelated places at once — which is what makes it worth recording rather than re-deriving.

**An overlay's tuning surface is deliberately narrow.** Of a node's keys, exactly three may be tuned: what it is called with, whether it is optional, and which provider runs it. `needs`, `uses`, `ask`, `when` and `outputs` are all immutable, and the resolver names the offending key when an overlay tries. That set was chosen so an overlay adapts a graph without being able to change its shape — an overlay cannot make a run take a path the base definition does not describe. The consequence here is direct: performance's analysis phase has to sit **between** two existing nodes, which means the downstream node's `needs` must point at it. `add` can introduce the node; nothing can attach it to the chain. Added but unreachable, it is not a phase.

The frozen `ask` and `when` keys close the smaller doors the same way: gate wording and guard expressions cannot be changed, so migration cannot re-ask a gate in its own terms, and neither workflow can re-condition a stretch on a boolean of its own.

**And the state writer keys off the workflow name.** A run's state carries exactly one context block, and which one is derived from the name of the workflow being run — a fixed map from name to block, with a refusal when a name derives nothing or derives a block the state file contradicts. An overlay does not rename its base; a run over an overlay of `development` is still a run of `development`, so it would derive development's context block. Performance and migration each require their own, and the writer refuses rather than guessing. This failure is independent of the first: even if the tuning surface were widened tomorrow, the context block would still be wrong.

### Decision Drivers
- A mechanism that almost fits is more expensive than one that plainly does not, because the near-miss is discovered late
- The tuning surface is narrow on purpose; widening it to fit this case would let any overlay reshape a graph
- Two workflows whose runs record the wrong context block are worse than two workflows that do not exist yet

### Considered Options
1. Ship both as overlays over the development definition, widening the tunable-key set to include `needs`
2. Ship both as overlays and derive the context block from something other than the workflow name
3. Ship a shared "core" definition that all three extend, factoring the common stretches out
4. Defer both, to be written as their own definitions when they are taken up ← chosen

### Decision Outcome
Chosen option: **defer both as separate definitions**. Neither is written now, and neither is written as an overlay when it is.

Option 1 was rejected because `needs` is the graph. Making it tunable turns an overlay from an adaptation into a rewrite: an overlay could reroute a run around a gate, or make a node depend on one that never runs, and the resolved graph would no longer be recognisably the base a reader reviewed. The narrow set is the whole guarantee that an overlay is reviewable against its base.

Option 2 was rejected because the workflow name is the only identifier a run reliably has at the moment the context block must be chosen, and every alternative source is either absent then or forgeable. A block declared by the overlay itself would let an overlay claim any context it liked, which is the same class of problem as option 1 in a different key.

Option 3 is the one worth revisiting later, and it is not rejected on principle — it is rejected as premature. Factoring a shared core out of three workflows requires knowing what the other two actually need, and neither has been written. Factoring first would freeze a shared shape derived from one workflow and two guesses, and the shared shape is the expensive thing to be wrong about.

There is a third, smaller reason the overlay route does not exist even in principle: an overlay must name the base it extends, and the check that enforces this compares the declared base against the definition's own name. There is no slot for a *shipped* overlay to be resolved in place of a base — an operator invoking the performance workflow resolves the name `performance`, which would have to resolve to something, and an overlay is not a something a name resolves to.

**What this means for the workflows when they are taken up.** Each gets its own definition file, its own node prose and its own generated diagram, and each may copy freely from development's. Copying is the accepted cost; it is bounded by the number of workflows, and it keeps each graph reviewable on its own.

### Consequences

#### Good
- The overlay mechanism keeps the property that makes it safe: a resolved graph is always the base's shape
- The state writer keeps a single unambiguous rule for the context block, with no per-run override to be got wrong
- The deferral is recorded with its evidence, so the next attempt starts from the constraint rather than from the near-miss

#### Bad
- Two future definitions will duplicate most of a third, and the three must be kept in step by review rather than by construction
- The shared-core option stays open and unexplored, so the duplication may turn out to have been avoidable
- Until both are written, two of the four workflows have no engine path at all, which keeps the prose twins load-bearing (ADR-0013)
