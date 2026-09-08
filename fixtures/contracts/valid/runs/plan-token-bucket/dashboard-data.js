window.MAISTER_DATA = {
  "generated": "2026-09-08T15:55:25Z",
  "task": {
    "title": "Add a token bucket rate limiter to the request pipeline",
    "type": "plan",
    "status": "completed",
    "description": "Add a token bucket rate limiter to the request pipeline",
    "path": ".maister/tasks/plan/2026-09-08-token-bucket-rate-limiter",
    "current_activity": null
  },
  "characteristics": {},
  "phases": [
    {
      "id": "standards-discovery",
      "name": "Standards discovery",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-09-08T15:44:48Z",
      "completed": "2026-09-08T15:46:00Z",
      "skip_reason": null,
      "summary": "Greenfield: no docs index and no standards files found in api-service; planning proceeds against the repo's own ES-module conventions.",
      "decisions": [
        {
          "decision": "Plan against repo conventions rather than a standards index",
          "rationale": "No .maister/docs/INDEX.md exists and no docs_index input was supplied"
        }
      ],
      "risks": [
        "No project standards exist, so the plan cannot be checked against one; running the initialization command would establish them."
      ],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "plan",
      "name": "Plan",
      "icon_hint": "plan",
      "status": "completed",
      "started": "2026-09-08T15:46:00Z",
      "completed": "2026-09-08T15:49:45Z",
      "skip_reason": null,
      "summary": "Plan written to implementation/plan.md by the host Plan subagent: a dependency-free lazy-refill token bucket (core, keyed store, middleware) plus the minimal (ctx, next) pipeline it attaches to, in six task groups with 2-8 tests each.",
      "decisions": [
        {
          "decision": "In-process Map store, no Redis",
          "rationale": "the repo has zero dependencies and no deployment topology defined; a shared store is a documented extension point (BucketStore interface), not day-one scope"
        },
        {
          "decision": "Lazy refill on read, no timers",
          "rationale": "O(1) per request, no background interval to leak or to keep the event loop alive"
        },
        {
          "decision": "Monotonic clock injected as now()",
          "rationale": "wall clock is subject to NTP steps and adjustable jumps, which can grant infinite tokens or freeze a bucket"
        },
        {
          "decision": "Framework-agnostic core",
          "rationale": "TokenBucket knows nothing about HTTP, so the core is unit-testable without a server"
        },
        {
          "decision": "node:test + node:assert as the test runner",
          "rationale": "keeps the zero-dependency posture"
        },
        {
          "decision": "Add a package.json with type: module",
          "rationale": "src/index.js already uses export, which currently only works via .mjs or an implicit assumption"
        },
        {
          "decision": "Deny (429) by default when over limit, sweep idle buckets on a size threshold",
          "rationale": "an unbounded Map keyed by client IP is a memory-exhaustion vector"
        }
      ],
      "risks": [
        "No pipeline exists. The plan invents one; if a framework (Express/Fastify/Hono) is intended for api-service, the middleware adapter must be swapped before implementation starts.",
        "Multi-instance correctness: an in-process limiter allows N x rate in aggregate across N instances.",
        "Key selection is a security decision: remote address is wrong behind a proxy, X-Forwarded-For is spoofable without a trusted-proxy count.",
        "Fail-open vs fail-closed on store errors is deferred: the flag is reserved, the semantics are not decided.",
        "No CI, no lint config, no formatter in the repo, so nothing enforces the conventions the plan follows.",
        "No project standards were found; running the initialization command would establish them."
      ],
      "artifacts": [
        {
          "path": "implementation/plan.md",
          "label": "Implementation plan",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "plan-approval",
      "name": "Plan approval",
      "icon_hint": "plan",
      "status": "completed",
      "started": "2026-09-08T15:49:45Z",
      "completed": "2026-09-08T15:55:25Z",
      "skip_reason": null,
      "summary": "Gate answered by the dispatching operator: continue-to-handoff. The plan stands and the run proceeds to handoff.",
      "decisions": [
        {
          "decision": "continue-to-handoff",
          "rationale": "the dispatching operator approved the plan and chose to continue to handoff"
        }
      ],
      "risks": [],
      "artifacts": [],
      "gate": {
        "question": "Plan complete. Continue to handoff?",
        "answer": "continue-to-handoff"
      }
    },
    {
      "id": "handoff",
      "name": "Handoff",
      "icon_hint": "done",
      "status": "completed",
      "started": "2026-09-08T15:55:25Z",
      "completed": "2026-09-08T15:55:25Z",
      "skip_reason": null,
      "summary": "Handoff recorded: plan artifact implementation/plan.md and plan_outcome approved.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "implementation/plan.md",
          "label": "Implementation plan",
          "html": null
        }
      ],
      "gate": null
    }
  ],
  "verification": {
    "status": null,
    "issues": [],
    "fixes": [],
    "reverify_count": 0
  }
};
