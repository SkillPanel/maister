# ADR-0019 — Generated chains live in a subdirectory of the workflow home

**Status**: Accepted · **Date**: 2026-09-08 · **Sources**: `plugins/maister/skills/umbrella/scripts/lib/manifest.mjs` (`init`, `validate`, `prune`); `plugins/maister/skills/umbrella/SKILL.md` § verbs and refusals; `plugins/maister/skills/chain-planner/SKILL.md` § invocation; `plugins/maister/skills/workflow-engine/SKILL.md` § step 3; `fixtures/contracts/synthetic/generated-chain/`

## TL;DR
A chain the planner publishes for one ticket lives in `.maister/workflows/generated/<name>.yml`, a subdirectory of the one lookup root the engine already searches, and never beside the reusable chains at the top of that directory. The engine resolves it by name second in its order — after an eject, before an overlay and the built-in — and nothing else about a run changes: the graph hash is a function of the resolved graph, not the path, and the envelope re-resolves the frozen `workflow.source` as it always did. `init` drops a two-line ignore file into the subdirectory so ticket-derived text is not committed by default, and a `prune` verb on the workspace runtime deletes a generated chain once every run naming it has closed. Nothing here is contract-bearing: the workflow directory is not a registered shape, B1 is untouched, and the fixture added is a valid B1 document like any other.

## ADR-0019: Generated chains live in a subdirectory of the workflow home {#adr-0019}

### Status
Accepted.

### Context
A two-stage chain triages a ticket, gates, and then asks the chain planner to generate the dispatch chain for that one ticket, which the operator starts from the cockpit. Until now every surface assumed a single flat home: the planner published into `.maister/workflows/` and collision-checked there, the engine's name lookup tried `<name>.yml` then `<name>.overlay.yml` there before the built-in, `umbrella init` scaffolded only that directory, and the cockpit listed `*.yml` at depth one. Generated chains carry the text of the ticket they were made for and are meant to be started once, so keeping them beside chains a workspace maintains for reuse mixes two lifetimes in one listing and puts ticket-derived text under version control by default. The operator decided the two must be kept apart; this record settles how.

### Decision Drivers
- The frozen graph and its hash must be unaffected, and dispatch-time re-resolution must keep working unchanged
- A generated chain is complete in itself: overlays and ejects must not apply to it
- No grammar change: the reserved-key set is closed and adding a root key to B1 is a contract change
- Ticket-derived text should be ignored by git by default, without the runtime editing the project's own ignore file
- The cockpit's containment rule for a chain file name, and its watcher, should change as little as possible
- Something has to delete a generated chain, and the rule for when that is safe should exist once

### Considered Options
1. A subdirectory of the workflow home, `.maister/workflows/generated/` ← chosen
2. A `kind: generated` marker at the root of the definition, one directory, the split made by every reader
3. A sibling directory outside the workflow home, `.maister/generated/`

### Decision Outcome
Chosen option: **the subdirectory**, with an ignore file inside it, one extra candidate in the engine's resolution order, and a `prune` verb as the deletion path.

Option 2 was rejected because it is a grammar change in disguise. `kind` is not among the eight reserved keys, so a reader that honoured it would be reading a key the register does not name, and doing it properly means a B1 register row, a schema edit and a fixture in one change — for a split every listing would then have to parse YAML to make. It also gives no ignore boundary: a file's git status cannot depend on a key inside it, so the ticket-derived text would still need a naming convention to keep it out of history.

Option 3 was rejected because the ignore boundary it offers is exactly what an ignore file inside a subdirectory offers, at the cost of a second lookup root for the planner, the engine, the validator and the cockpit. The cockpit's brief composes a chain file's path from a bare name and relies on that name carrying no separator so the path lands under the workflow home; a sibling directory breaks that rule outright, while a subdirectory relaxes it by one optional prefix.

**The resolution order gains one candidate and no rule.** Eject, then generated, then overlay, then built-in. A generated chain is never overlaid — there is no `generated/<name>.overlay.yml` candidate — and never ejected, because an eject is a definition of the same name at the top of the directory, which would simply win; the planner's collision check spans both directories and the built-in names so that a planned chain never shadows or is shadowed. The freeze records the generated path as `workflow.source` exactly as it records an eject's, and the envelope's `definitionPath` already resolves a workspace-relative source, so dispatch needs no change and the hash is provably the same from either home — the suite asserts it.

**The ignore file is inside the subdirectory, written by `init`, and preserved once present.** Two lines, `*` and `!.gitignore`. Putting it inside the directory means the runtime never edits a project's own `.gitignore`, and a workspace that predates the subdirectory gets the same file from the planner on first generated publish — the planner quotes the two lines and the suite pins them equal to the runtime's constant. An operator who loosens the file to commit one generated chain on purpose is not overridden by a later `init --force`, on the same rule the ledger index follows.

**Deletion is a runtime verb, and the cockpit calls it.** The rule for when a generated chain may be deleted needs the run state — `workflow.source` and the run's status — which the runtime already reads to build an envelope, so the rule lives beside that reader rather than as a second reader in the daemon. `prune` deletes a chain's three files once at least one run named it and every such run has closed; a run is closed when its task status is terminal and its gate marker is clear. Deletion is safe then because the run froze the resolved graph before executing anything and the only later read of the definition is the envelope's, made while a node is dispatched, which a closed run never does again. A chain no run ever named is kept by a sweep, because the interval between publishing and starting is exactly when a sweep would otherwise delete it; naming the stem removes it deliberately. Only the generated home is ever a candidate, so a reusable chain cannot be pruned by accident. An unreadable run state is warned about rather than treated as blocking: dispatch reads the state before the definition and refuses on one it cannot read, so such a run cannot reach the chain file either.

### Consequences

#### Good
- Reusable and generated chains are listed apart without any reader parsing a definition to tell them
- Ticket-derived text stays out of version control by default, and the rule is one file the runtime owns
- The engine, the envelope and the hash are untouched; the change is one candidate in a lookup order
- There is one deletion rule, in one verb, testable in the suite and callable by an operator and by the cockpit alike

#### Bad
- A reusable chain and a generated chain of the same stem are a shadowing pair the planner prevents but a hand-placed file can still create; the engine's order says which wins, and nothing warns
- A workspace scaffolded before this change lacks the subdirectory until the planner or a forced `init` creates it, so the ignore file's presence is not guaranteed by the manifest's existence alone
- A generated chain that was published and never started accumulates until someone names it; the sweep deliberately leaves it
- The cockpit's file-name containment rule now admits one prefix, which is one more case its tests have to hold
