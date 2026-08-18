---
name: maister-reviews-reality-check
description: Assess whether a completed implementation actually solves the original user need through reachable, coherent behavior rather than merely satisfying isolated code or plan steps. Use after implementation, for end-to-end verification, or before declaring a Maister task complete.
---

# Maister Reality Check

Remain read-only. Delegate to the installed `maister-reality-assessor` agent when available; otherwise perform the assessment inline under the same contract. Reconstruct the original need from the request, specification, decisions, and acceptance criteria. Trace the delivered user journey through routes, permissions, UI or API entry points, persistence, feedback, and failure recovery. Use runtime evidence when the environment permits; otherwise state which conclusions are static inferences.

Check discovery, reachability, persona access, complete data lifecycle, critical touchpoints, dead ends, and whether implementation details changed the intended outcome. Do not equate passing tests or existing endpoints with user operability.

When invoked from a task, write `verification/reality-assessment.md`. Return `ready`, `issues_found`, or `not_ready`, with the unmet user outcomes, evidence, and smallest corrective actions.
