# ADR-0018 — Dispatch worktrees are named for the run and the node

**Status**: Accepted · **Date**: 2026-09-08 · **Sources**: `plugins/maister/skills/umbrella/scripts/lib/envelope.mjs` (`worktreeOf`, `branchOf`); `plugins/maister/skills/umbrella/SKILL.md` § refusals; `fixtures/contracts/synthetic/umbrella-manifest/umbrella.yml`; `dispatch-envelope.schema.json`, `ledger-entry.schema.json`; `compatibility-contracts.md` §§ 10, 13

## TL;DR
A dispatch into a member works in `.worktrees/<run_id>-<node>`, not in `.worktrees/<node>`. The node alone was ambiguous across runs: a second run of the same chain into the same member landed in the first run's checkout. Because the run id is now load-bearing in the path, a dispatch that would mint a worktree without a resolvable run id is refused by name rather than falling back to a shape that collides again. Neither this nor the sibling relaxation of reference resolution is contract-bearing: the schemas type `worktree` as a pattern-free string-or-null and the register says nothing about reference resolution, so no register row and no schema edit follow.

## ADR-0018: Dispatch worktrees are named for the run and the node {#adr-0018}

### Status
Accepted.

### Context
A dispatching node hands a worker a member checkout to work in, and the workspace's `defaults.worktree` decides whether that is a dedicated worktree or the member checkout itself. The dedicated tree was named after the node — `.worktrees/<node>` — which reads as unambiguous only while one run exists. A workspace exists to be driven repeatedly: two runs of one chain, or a re-run after a failure, dispatch the same node into the same member, and both computed the same path. The second worker then opened a tree the first was still holding, and the very promise the workspace guide makes about dispatches not fighting over a working tree was false in the case that matters most.

The run id was already available where the path is built — the envelope builder resolves it before it names anything — so the fix is a naming decision rather than a plumbing one. That immediately raises the second question: what should happen when no run id resolves at all.

### Decision Drivers
- Two dispatches that can run at the same time must never compute one path
- A path a person reads should say which run put it there
- A shape a value can silently be absent from is a shape that collides again later
- Nothing outside this repository parses the path, so the cost of choosing is low and the cost of being wrong is a collision in someone's checkout

### Considered Options
1. Keep `.worktrees/<node>` and serialise dispatches per member instead
2. Name it after the run and the node — `.worktrees/<run_id>-<node>` ← chosen
3. Mirror the branch convention: expose the path as a manifest-configurable template with literal tokens

### Decision Outcome
Chosen option: **`.worktrees/<run_id>-<node>`**, with an absent run id refused rather than defaulted.

Option 1 was rejected because serialising is a runtime constraint bought to protect a naming choice. It makes two independent runs wait on each other for no reason a reader of either one could see, and it does nothing for the case where the collision is not concurrent — a stale tree left by an earlier run is still the wrong tree to hand a new worker.

Option 3 is the more interesting rejection, because the precedent is already on disk: the branch convention is exactly such a template, and the shipped fixture manifest carries `branch_convention: "feature/{run_id}-{node}"` — the same segment pair, rendered by literal token substitution. Adopting that spelling for the worktree would have made the two symmetric. It was rejected because the symmetry is superficial. A branch name is a thing operators negotiate with their host's conventions, which is why it is configurable; a worktree path is an implementation detail of dispatch, and the only property anyone depends on is that it is unique per run and per node. Making it configurable hands a workspace the ability to configure that property away — a template that omits `{run_id}` reintroduces exactly this collision, and nothing would catch it. The fixed shape borrows the branch convention's segment pair, which is where the precedent is genuinely useful, without borrowing its configurability.

**The null run id is refused, not defaulted.** With the run id in the path, a dispatch that cannot resolve one has no correct path to compute: any fallback is a name two runs can share. So `worktreeOf` raises `dispatch-run-unresolved`, naming the node, the three recoveries (point at the run directory whose basename is the run id, record the run's task path in its state, or set `defaults.worktree: false` to work in the member checkout itself) and the fact that nothing was written.

That refusal is **a guard rather than a live failure mode**, and this record says so deliberately. The run id is the resolved basename of the run directory, which is empty only for a path that resolves to the filesystem root — a value the envelope builder will not reach in normal use. A reader should not go hunting for the field it protects, because there is no field: the guard exists so that a future caller which computes the run id some other way cannot quietly produce a colliding name. It is also why the function is exported — a direct call is the only way to provoke the code, and therefore the only way to pin it.

**Neither fix is contract-bearing.** This change lands beside a second one, which relaxes an unresolved skill or agent reference from an error to a warning because such a target may be supplied by an environment the validator cannot see. Both were checked against the register before being recorded here rather than there. `worktree` is typed `["string", "null"]` with no pattern in both the dispatch-envelope and ledger-entry schemas, so the path shape was never frozen and no schema edit expresses it; and the register says nothing about whether an unresolved reference is an error or a warning, so the relaxation changes no registered shape either. No register row and no schema edit follow from either. This ADR is the whole of the record, which is the point of writing it: without it, the reasoning behind a path shape that nothing validates would live only in a commit message.

### Consequences

#### Good
- Two runs of one chain into one member can proceed at once, which is what a workspace is for
- A worktree on disk names the run that created it, so an abandoned tree is attributable
- The collision cannot be configured back in, because there is nothing to configure

#### Bad
- Paths are longer and less pretty, and a run id chosen carelessly is now visible in the filesystem
- Worktrees from earlier runs accumulate under names nothing prunes; cleaning them up stays the operator's job
- The worktree and the branch now derive their names by two different mechanisms — one fixed, one templated — and a reader who notices the asymmetry has to come here to learn it was deliberate
