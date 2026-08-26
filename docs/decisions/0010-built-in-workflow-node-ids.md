# ADR-0010 — Built-in workflow node ids as public API

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § B1 (definition and overlay grammar); `plugins/maister/skills/workflow-engine/workflows/research.yml`, `workflows/research.md`; `plugins/maister/skills/orchestrator-framework/schemas/workflow-overlay.schema.json`

## TL;DR
The nine node ids in the shipped research definition are public API. An overlay names them to disable or tune a node, a frozen graph in a task directory records them, and a resumed run matches against them — so a rename breaks a consumer's file and an in-flight run, and costs a two-release deprecation. They are named by subject: a phase node is named for the phase it performs, a gate node for the approval it seeks. **No node carries an outcome clause**, and that omission is what makes every stop option terminate the run.

## ADR-0010: Built-in workflow node ids as public API {#adr-0010}

### Status
Accepted. The ids are frozen with the shipped definition; the grammar that makes them referenceable is `B1`.

### Context
A workflow definition is shipped, and a consumer can adapt it two ways without forking it: an overlay that disables, tunes or adds nodes over the built-in, and an eject that replaces the built-in wholesale. An overlay addresses the base definition **by node id**. Separately, a run freezes its resolved graph into the task directory before executing anything, one line per node keyed by id, and resume recomputes the ready set from those recorded ids rather than from the definition file.

That makes the ids load-bearing in two directions at once — a consumer's file on one side, a consumer's in-flight run on the other — and it makes naming them a compatibility decision rather than a style one.

### Decision Drivers
- A name a consumer can write in their own file is a name we cannot quietly change
- A reader of the definition, the diagram and the state file should see one vocabulary, not three
- Ids appear in operator-visible output, so they have to read as English

### Considered Options
1. Opaque or positional ids (`node-1`, `step-3`), stable by construction and meaningless to read
2. Ids named for the implementation each node delegates to
3. Ids named for the subject — the phase performed, or the approval sought ← chosen

### Decision Outcome
Chosen option: **named for the subject**. A node that performs a phase carries that phase's name; a gate node carries the name of the approval it asks for and reads as one. The result is that the definition, the generated diagram, the frozen graph in a task directory and the operator dashboard all name the same thing the same way, and an operator reading a run's state sees the workflow's own vocabulary rather than a numbering scheme.

Positional ids were rejected because they are stable in exactly the way that does not help: they never need renaming, and they never tell anyone anything, so every overlay that touches one has to be read alongside the definition to be understood at all. Implementation-named ids were rejected because they encode a choice that is allowed to change — the node's `uses` target — into a name that is not, so swapping a node's implementation would either force a rename or leave a misleading id behind.

**Renaming costs two releases.** Because an overlay in a consumer's workspace may address any id, and because a task directory frozen by an earlier release records the ids it ran, a rename cannot be a single change. It is: one release in which the old id keeps working as an alias and its use is warned about, and a second release in which the alias is removed. Anything shorter breaks an overlay silently on the first side and makes an in-flight run unresumable on the other. The practical consequence is to treat the shipped ids as settled and to resist cosmetic improvement of them.

**No node carries an outcome clause**, and the omission is deliberate. The grammar allows a node to declare that it should run on failure, or always. An always-run final node is the obvious thing to reach for — it is how a workflow in most other systems guarantees its summary step. Here it would be a defect. A predecessor left stopped by an operator's stop option satisfies an always-run successor, so a final node declared that way would execute after every stop, print a completion and file a summary for a run the operator chose to end. Every stop option in the workflow would stop nothing. Leaving the clause off means a stopped predecessor satisfies nothing downstream, so a stop genuinely ends the run — and the guarantee that would have been bought by an always-run node is instead bought by the rule that a stop marks every unexecuted node stopped, the final node included.

### Consequences

#### Good
- One vocabulary spans the definition, the diagram, the frozen graph and the operator's screen
- An overlay is readable on its own, because the id it names says what it is adapting
- Stop options terminate by construction rather than by a special case in the runner

#### Bad
- The ids are now costly to change, including the ones a later reading might find clumsy
- A workflow that genuinely wants a cleanup step running after a stop has no way to express it, and would need the outcome clause plus a rule the runner does not currently have
- Consumers can come to depend on ids in the shipped set that were never intended as extension points, and nothing distinguishes those from the rest
