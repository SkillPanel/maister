---
name: maister-reviews-production-readiness
description: Review a change or service for deployment readiness across configuration, security, migrations, rollback, observability, reliability, capacity, operational ownership, and documentation. Use before deployment or as an optional high-risk Maister verification lane.
---

# Maister Production Readiness

Remain read-only. Delegate to the installed `maister-production-readiness-checker` agent when available; otherwise perform the review inline under the same contract. Resolve the deployment target and environment from the request or task state. Read the implementation, configuration, deployment files, migrations, runbooks, tests, and relevant standards.

Assess secrets and environment configuration, backwards compatibility, data integrity, rollout and rollback, health checks, logging and metrics, alerts, failure isolation, resource limits, scaling assumptions, dependency availability, security hardening, and operator documentation. Separate release blockers from post-release improvements and do not invent infrastructure requirements unsupported by the project.

When invoked from a task, write `verification/production-readiness.md`. Return `go`, `go_with_conditions`, or `no_go`, with blocker and concern counts, evidence, required mitigations, and residual risk.
