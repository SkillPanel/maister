# ADR-0011 — Generated workflow diagrams are non-contractual

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/diagram.mjs`, `workflows/research.mmd`; `plugins/maister/skills/workflow-engine/SKILL.md` § "The invocation contract"; `compatibility-contracts.md` (register scope)

## TL;DR
The engine renders a workflow definition as a diagram, and the shipped built-in ships one beside it. The renderer is pure — same graph, same bytes — so the file is golden-file tested and cannot silently disagree with the definition it came from. It is deliberately **not** a registered shape: nothing parses it back and no run depends on its text, so it gets no register row, no schema and no fixture pair. Promoting it later is a defined move with a stated trigger.

## ADR-0011: Generated workflow diagrams are non-contractual {#adr-0011}

### Status
Accepted. Nothing here adds to the contract register; the absence is the decision.

### Context
A workflow graph with guards on some of its nodes and a stop path out of each of its gates is legible as a picture and tedious as a list — and the larger the graph, the wider that gap. A diagram is worth shipping. But this repository has a strong convention that a shape which crosses a boundary gets a register row, a schema and a fixture pair — and that convention exists because reversing a shape after consumers depend on it is expensive. The question was whether a diagram is that kind of shape.

There is a second question underneath it. A hand-drawn diagram beside a machine-readable definition is a liability with a delay fuse: it is correct on the day it is drawn and wrong on the first day nobody remembers to redraw it, and nothing detects the drift.

### Decision Drivers
- A diagram that can disagree with its source is worse than no diagram
- A registered id is permanent; adding one that is not needed is the expensive half
- Operators need to see where a run can stop and where it can branch

### Considered Options
1. Hand-author the diagram alongside the definition and keep it in step by review
2. Generate it, register it as a contract shape with a schema and a fixture pair
3. Generate it, golden-file test it, and register nothing ← chosen
4. Generate it on demand only, shipping no file

### Decision Outcome
Chosen option: **generated, tested, unregistered**. The renderer is a function of the resolved graph and of nothing else — no clock, no randomness, no reliance on a map order it did not fix itself — so the same definition produces the same bytes on every run and on every platform. That byte-stability is what makes the output golden-file testable, and golden-file testability is why the built-in ships a generated file rather than a drawn one: the test fails the moment the definition and the diagram disagree, which is the only guarantee a diagram actually needs. The file carries a banner saying it was generated and must be regenerated rather than edited, and it is shipped beside the definition so that a reader who opens one finds the other.

It is not registered because nothing reads it back. No runner parses it, no hook consults it, no state file references it, and no behaviour changes if its text changes. A register row would freeze the rendering choices — the layout direction, the node shapes, the class names — and freezing those buys nothing except a future migration when one of them turns out to be wrong. Shipping it now costs a golden file; registering it now costs an id we would have to honour forever.

Option 1 was rejected on the drift argument alone. Option 4 was rejected because a diagram that exists only when someone runs a command is a diagram nobody reads, and reviewing a definition change without seeing its effect on the graph is the situation the diagram is meant to remove.

**Promotion is defined rather than left open.** The diagram becomes a contract shape the moment something outside this repository depends on its text: a consumer tool that parses it, an operator surface that renders it as a live view rather than as documentation, or a second producer that must emit a byte-compatible file. Any of those makes divergence a breaking change rather than a cosmetic one, and at that point it earns a register row, a schema for its grammar and a fixture pair, on the same terms as every other registered shape. Until one of them is real, the golden file is the whole guarantee.

### Consequences

#### Good
- The diagram cannot silently disagree with the definition, and the test says so on the same commit
- Rendering choices stay revisable, because none of them is frozen
- Reviewers see the shape of a graph change, not only its text

#### Bad
- A golden file makes every deliberate rendering improvement a diff in a checked-in artefact, which reads like churn
- The diagram shows only what the definition carries: a node's inline questions and its retry budget live in the prose companion and are invisible in the picture
- "Generated, do not edit" is enforced by a banner and a test, not by the filesystem, so a hand edit is caught after the fact rather than prevented
