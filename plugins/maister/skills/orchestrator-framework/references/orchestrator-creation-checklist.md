# Orchestrator Creation Checklist

Use when creating a NEW built-in workflow or auditing an existing one. Not loaded during normal
execution. Every built-in workflow is a definition the workflow engine runs: a graph
(`workflow-engine/workflows/<name>.yml`), its node prose (`<name>.md` beside it), a generated
diagram (`<name>.mmd`) and a thin hand-off skill. The grammar is
`workflow-engine/references/grammar.md`; this list is what a built-in adds on top of it.

---

## Required Elements

Before considering a workflow complete, verify ALL items:

- [ ] **Definition** — `name:` equals the file stem; a `description:` that says what the workflow is for; every input the command's flags carry, a tri-state flag as a string a node turns into a declared bool, or into the continue it recommends when a gate decides the stretch
- [ ] **Node ids** — named for what the node does, or for the approval a gate seeks; never a phase number or a process identifier
- [ ] **Display block** — a title for every node, an icon from the closed set of seven for every node (a gate takes the icon of the node it closes), a label for every gate option and a header of at most 12 characters for every gate
- [ ] **Gates** — at least one continue, and at least one stop on a gate with a single continue; several continues only to decide the optional steps after the gate, each setting the same gate values (`sets`) to its own combination — such a gate leaves out its stop only when one of its continues is the way to the end — and which it recommends set by the closing node's `brief:` `recommends`, with the why in that node's *Summary* part; a revise only on a gate that closes a document, its `reruns` a task node the gate waits on; a node whose own loop refines its output keeps that loop instead
- [ ] **Guards** — a guard reads one declared bool or one gate value; the closing gate of a guarded stretch repeats the guard, unless it also closes an unguarded document before it, in which case it needs both nodes of its stretch
- [ ] **No interpolation from a skippable node** — a `${node.…}` reference only into a node that shares the referenced node's guard; anything else reads the state and the disk
- [ ] **Step template** — the H1 and one opening paragraph, then a `` ## `<id>` `` section only for a node with something of its own, built from the parts *Does*, *Asks*, *Writes*, *Summary*, *Re-run* and *Budget* in that order; nothing the engine's node conventions already say; the template lint in `make validate` passes
- [ ] **Brief data** — a `brief:` entry for every node with data: the `summary_keys` it mirrors, the `absent` artifacts it may leave unwritten, its `budget`, and the continue its input `recommends`
- [ ] **No gate section without an exception** — a gate has a section only when it holds an *Exception* part: behaviour the definition, the gates reference and the conventions do not carry
- [ ] **Embedded mode only where it differs** — an `## Embedded mode` section only in a workflow that can run as a child and behaves differently as one
- [ ] **No icon section** — the dashboard reads each icon from the display block alone, so the prose never tells a node to write one
- [ ] **Every in-node question names its default** under a `cockpit` or `dispatch` driver, by a question id: the *Without question sets* line in the *Asks* part of the section that asks it, the one place the default is written (§ 2.2)
- [ ] **Sanctioned absences** — a declared artifact a node may legitimately not write is listed under its `brief:` `absent` with the reason, and recorded under `absent`
- [ ] **Delegation** — each delegated node names its skill or agent in its scheme, and the scheme's row of the engine's node conventions says how it is called; its section adds only what that row does not
- [ ] **Standards discovery** — `.maister/docs/INDEX.md` referenced in the nodes that specify, plan, implement and verify
- [ ] **Closing node** — calls `run-complete`, relays its `missing-artifact:` and `missing-companion:` lines and checks any undeclared path a summary lists (§ 10), ends a terminal run with a readable wrap-up, and publishes the close-out under a dispatch driver
- [ ] **Diagram** — `make diagram` regenerates `<name>.mmd`; `make validate` fails on a stale one
- [ ] **Hand-off skill** — names `builtin:<name>`, passes the description, the resume target and the flags, and keeps the Step-0 gate block byte-identical
- [ ] **Suite** — the generic built-in tests pass for the new file, and a run fixture replays the workflow's particular gates

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong |
|---|---|
| A routing decision written as prose instead of a guard | The graph, the diagram and the gate brief's `Next:` line cannot see it |
| A gate question that names where the run goes next | It is frozen into the graph hash; the brief's `Next:` line names the real next node |
| A continue label naming a step a guard can skip | It reads wrong whenever the guard skips that step; label it `Continue` and the brief completes it from the walk |
| An in-node question with no default | A driven run has nobody to ask and no way to suspend inside a node |
| A revise whose suggestions the operator must type | The engine generates them from the stretch's open and stop risks; give each its `change` so each suggestion is concrete |
| A budget written into `with:` | Inert data the engine never consults; the number belongs in `brief:` `budget` |
| Vague delegation ("invoke X") | Name the Skill or Task call and its parameters |
| Inline execution to "save time" | Delegate regardless of perceived simplicity |
| Finishing without relaying `run-complete`'s missing lines | A declared artifact or companion that never reached disk closes the run in silence |
| Auto-accepting a delegate's decisions | The operator consents through a question or a gate |

---

## Reference

- **`orchestrator-patterns.md`** — Execution rules, schemas, and patterns
- **Existing workflows** — development, performance, migration, research and product-design are definitions under `workflow-engine/workflows/`; product-design is the one whose gates close a guarded node and whose convergence is left for a gate under a driver
- **Library consumers** — `implementation-plan-executor` and `implementation-verifier` read and write the same state and artifacts without being orchestrators
