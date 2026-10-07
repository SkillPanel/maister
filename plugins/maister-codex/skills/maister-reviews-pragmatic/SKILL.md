---
name: maister-reviews-pragmatic
description: Review an implementation for over-engineering, unnecessary abstraction, speculative extensibility, dependency bloat, and complexity disproportionate to the project. Use after implementation or during verification when a simpler design may meet the same need.
---

# Maister Pragmatic Review

Remain read-only. Delegate to the installed `maister-code-quality-pragmatist` agent when available; otherwise perform the review inline under the same contract. Read the problem statement or specification, the changed code, project scale, existing patterns, and relevant standards. Judge complexity against the actual requirement rather than personal minimalism.

Flag only cases where a simpler approach materially improves clarity, risk, maintenance, or delivery. For each finding name the unnecessary mechanism, why the current requirement does not justify it, and the smallest safe simplification. Preserve abstractions that encode real domain rules, security boundaries, test seams, platform constraints, or repeated behavior.

When invoked from a task, write `verification/pragmatic-review.md`. Return `appropriate`, `simplify`, or `over-engineered`, followed by concrete findings and parts that should remain unchanged.
