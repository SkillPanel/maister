# ADR-0064 — The product-design mockup gate carries a back-edge

**Status**: Accepted · **Date**: 2026-11-03 · **Amends**: ADR-0028 (its exclusion of the mockup gate) · **Builds on**: ADR-0063 · **Sources**: `plugins/maister/skills/workflow-engine/workflows/product-design.yml` and `product-design.md`; `tests/engine/product-design.test.mjs`, `same-questions.test.mjs`, `html-companions.test.mjs`, `brief-block.test.mjs`

## TL;DR
ADR-0028 left the mockup gate out of the gates that may send a run back, because the studio's in-node loop kept it warm between rounds. A mockup turn has no loop, so the reason is gone. Product-design gains a `mockup-approval` gate after `visual-prototyping`, with a continue, a stop and `revise-mockups`, which re-runs `visual-prototyping`. The product-design graph hash moves.

## ADR-0064 {#adr-0064}

### Status
Accepted. It amends ADR-0028's scope of the built-ins: the mockup gate is no longer excluded in product-design. The product-design definition's hash moves; frozen runs keep their own graph. Development's `mockup-approval` already offers a revise, and its definition changes only in its `ui-mockups` inputs.

### Context
ADR-0028 gave the document-producing approval gates a revise option and excluded the mockup gate: the studio looped inside its node, so a person asked for changes there and the run never needed to go back. Product-design had no gate of its own after the screens; they were approved together with the specification, which could send the run back only to the specification.

With ADR-0063 the node draws one version and ends. Nothing inside it asks, so a run needs somewhere to say the screens are wrong, and the gate is the one place that can send the run back with a note.

### Decision
- **A new gate, `mockup-approval`,** needs `visual-prototyping` and carries the same guard, so it is skipped when no screens are drawn. Its options are one continue (no `sets`, no `grants`, so a pure confirmation), `revise-mockups: {effect: revise, reruns: visual-prototyping}` and a stop. It asks "Screens drawn. Continue to the specification review?".
- **`specification-approval` now waits on `feature-specification` and `mockup-approval`.** A revise at the specification therefore re-runs the specification, the screens, the screens' gate and the specification gate, in that order, and the screens are redrawn against the revised specification.
- **A re-run is one more turn** against the latest version, with the revise note as its note. The earlier versions stay in the folder.
- **ADR-0028's rule is unchanged:** gates with a review loop of their own, such as the verification gates, still offer no revise. The only gate it excluded for a loop no longer has one.
- **The hash moves once.** The new gate, the changed `needs` and the revise option are all part of the hashed graph, so the product-design hash moves, and the hashes the tests pin for the companion and brief baselines move with it. A run frozen before keeps its graph and resumes on it.

### Consequences

#### Good
- The screens can be sent back from the gate that approves them, with a note, in session and under a driver alike.
- The specification gate stays a decision about the specification.

#### Bad
- One more pause in a design that draws screens, and one more place a cockpit must render.
- The product-design hash moves, so the fixtures and baselines that pin it are regenerated.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep approving the screens with the specification | The revise would send the run back to the specification only, and a person who wants different screens would have to stop |
| Put the question inside `visual-prototyping` | That is the loop ADR-0063 removes; a run that cannot ask would take its default |
| Make the gate unconditional | A design with no screens has nothing to approve; the guard of `visual-prototyping` keeps the gate out of its way |
