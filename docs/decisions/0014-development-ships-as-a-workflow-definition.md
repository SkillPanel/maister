# ADR-0014 — Development ships as a workflow definition

**Status**: Accepted · **Date**: 2026-08-27 · **Sources**: `plugins/maister/skills/workflow-engine/workflows/development.yml`, `workflows/development.md`, `workflows/development.mmd`; `compatibility-contracts.md` § B1 (definition and overlay grammar); ADR-0008, ADR-0010, ADR-0013

## TL;DR
The development workflow, until now a fourteen-phase prose orchestrator, also exists as a graph the engine executes: **twenty-six nodes — fifteen that perform a phase and eleven that seek an approval — in one linear chain**, expressed on the frozen grammar with **no new contract tag and no grammar addition**. Conditional stretches are carried by five declared guard booleans repeated across twelve nodes, because a skip does not cascade. The two loop-shaped behaviours the prose has — the verification fix loop and the mockup revise cycle — live in **node prose**, not in the graph, because the grammar has no loop construct.

## ADR-0014: Development ships as a workflow definition {#adr-0014}

### Status
Accepted. Nothing here changes a registered shape: the definition is written against the grammar as frozen, and adds no tag, no schema and no fixture pair.

### Context
The engine executes a workflow from a definition — a graph of nodes with `needs` edges, each naming its mechanism explicitly (ADR-0008) — and had one shipped definition to execute. Development is the largest workflow in the plugin and the one operators run most, so it is both the strongest case for the engine and the hardest test of whether the grammar as frozen is enough.

It is hard for three reasons. It is long, so a reader needs to see its shape rather than infer it from prose. Roughly half of it is conditional: a test-driven pair, a mockup pair, an audit, browser tests and a user guide each run or do not, on answers the run itself produces. And two of its stretches are described in the prose as loops — verification failures come back for a fix and are verified again, mockups are revised until an operator accepts them — while the graph is by construction acyclic, because `needs` edges that cycle have no ready set.

The question was therefore not whether to write the definition but whether writing it honestly required extending the grammar, which is the expensive half: a grammar addition is a registered shape and permanent.

### Decision Drivers
- A definition that needs a grammar extension to be honest is evidence the grammar is wrong, and should be treated as such rather than worked around
- Conditional behaviour must be visible in the graph, since the graph is what the operator's dashboard and the generated diagram show
- Loop-shaped behaviour must live where it is actually enforced, not where it merely looks expressed

### Considered Options
1. Add a routing or branch construct to the grammar so conditional stretches are edges rather than repeated guards
2. Add a loop or retry construct so the fix cycle and the revise cycle are graph features
3. Model the whole workflow as a smaller graph of coarse nodes, hiding the phases inside them
4. Express it on the grammar as frozen: guards for conditions, node prose for loops ← chosen

### Decision Outcome
Chosen option: **express it on the grammar as frozen**. The chain is linear because gates serialize the run anyway — a wider fan-in would buy no concurrency, only a harder picture. Each conditional stretch is guarded by a **declared boolean** produced by an earlier node, and the guard is repeated on **every** node of the stretch including its closing gate. That repetition is not redundancy: a skipped node satisfies its successors rather than cascading a skip to them, so an unguarded gate at the end of a skipped stretch would fire and ask an operator to approve work that never happened. Five distinct booleans guard twelve nodes; the seven repeats are the closing gates and the second halves of the paired stretches.

Options 1 and 2 were rejected on the same ground, from opposite directions. A branch construct would express, as a permanent registered shape, exactly what a boolean guard already expresses correctly — the only thing it would add is a second way to read the same graph. A loop construct is worse than unnecessary: the two cycles it would model are **agent behaviour inside a phase**, not scheduling. The fix loop is a phase that keeps working until its own exit condition holds; the revise cycle is a gate whose operator answer sends work back into the node that produced it. Neither is a scheduling decision the runner could make, so a loop construct would be a grammar feature whose semantics the runner does not implement — a reserved word carrying no behaviour, which is the failure mode the grammar freeze exists to prevent. The budgets that bound those cycles live in the node prose beside the definition for the same reason: written into the definition they would read like an engine feature while being data the engine never consults.

Option 3 was rejected because coarse nodes hide precisely what an operator needs to see. A phase that is a node is a phase the dashboard can report, the frozen graph can record and an overlay can disable; a phase buried inside a coarse node is none of those.

**The node ids are public API on the same terms as every other shipped definition** (ADR-0010), and they follow the same naming rule: a node that performs a phase carries the phase's name, a node that seeks an approval reads as the approval it seeks.

### Consequences

#### Good
- The grammar was shown sufficient for the hardest workflow in the plugin without gaining a single construct, which is the strongest evidence available that the freeze was set in the right place
- The conditional structure is visible in the definition, the generated diagram and the frozen graph, rather than inferred from prose
- Every phase is independently addressable: reportable on the dashboard, recordable in a run's frozen graph, and disable-able by an overlay

#### Bad
- A guard repeated across a stretch is a correctness requirement that reads like duplication, and a stretch extended later must have the guard added to the new node or the stretch will half-run
- Loop-shaped behaviour is invisible in the graph and in the diagram, so a reader of the definition alone will not see that verification can go round again
- The workflow is authored twice while the prose twin remains (ADR-0013), and this is the larger of the two pairs to keep honest
