window.MAISTER_DATA = {
  "generated": "2026-08-19T17:05:42Z",
  "task": {
    "title": "Move the ledger store from the embedded engine to the shared cluster",
    "type": "migration",
    "status": "completed",
    "description": "Incremental dual-run migration of the ledger store, one shard at a time.",
    "path": ".maister/tasks/migration/2026-08-18-ledger-store-swap",
    "current_activity": null
  },
  "characteristics": {
    "migration_type": "data",
    "approach": "dual-run",
    "risk_level": "high"
  },
  "phases": [
    {
      "id": "phase-1",
      "name": "Analyze current state",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-18T08:30:00Z",
      "completed": "2026-08-18T10:11:20Z",
      "skip_reason": null,
      "summary": "Embedded store, file-backed WAL, one node, no replication.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "analysis/current-state.md",
          "label": "Current state",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-2",
      "name": "External research",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-18T10:11:20Z",
      "completed": "2026-08-18T11:40:05Z",
      "skip_reason": null,
      "summary": "Vendor migration guide reviewed; sequence state is not replicated.",
      "decisions": [],
      "risks": [
        "Sequences must be advanced manually after cutover"
      ],
      "artifacts": [
        {
          "path": "analysis/external-research.md",
          "label": "External research",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-3",
      "name": "Assess risk",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-18T11:40:05Z",
      "completed": "2026-08-18T13:02:44Z",
      "skip_reason": null,
      "summary": "High risk; dual-run required before any read cutover.",
      "decisions": [
        {
          "decision": "Dual-run rather than big-bang",
          "rationale": "A per-shard read cutover is reversible; a single cutover is not."
        }
      ],
      "risks": [],
      "artifacts": [
        {
          "path": "analysis/risk-assessment.md",
          "label": "Risk assessment",
          "html": null
        }
      ],
      "gate": {
        "question": "Risk assessed as high. Continue with the dual-run strategy?",
        "answer": "Continue"
      }
    },
    {
      "id": "phase-4",
      "name": "Specify migration",
      "icon_hint": "spec",
      "status": "completed",
      "started": "2026-08-18T13:02:44Z",
      "completed": "2026-08-18T15:30:12Z",
      "skip_reason": null,
      "summary": "Three strategy phases specified with a rollback path each.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "implementation/spec.md",
          "label": "Migration specification",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-5",
      "name": "Plan implementation",
      "icon_hint": "plan",
      "status": "completed",
      "started": "2026-08-18T15:30:12Z",
      "completed": "2026-08-18T16:44:58Z",
      "skip_reason": null,
      "summary": "Shadow writes, then per-shard read cutover, then decommission.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "implementation/implementation-plan.md",
          "label": "Implementation plan",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-6",
      "name": "Execute migration",
      "icon_hint": "code",
      "status": "completed",
      "started": "2026-08-19T08:00:00Z",
      "completed": "2026-08-19T15:20:31Z",
      "skip_reason": null,
      "summary": "All shards cut over; sequences advanced manually as researched.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "implementation/work-log.md",
          "label": "Work log",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-7",
      "name": "Verify compatibility",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-08-19T15:20:31Z",
      "completed": "2026-08-19T17:05:42Z",
      "skip_reason": null,
      "summary": "Dual-run diff empty for 24 h; rollback path exercised once on a spare shard.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "verification/compatibility-verification.md",
          "label": "Compatibility verification",
          "html": null
        }
      ],
      "gate": null
    }
  ],
  "verification": {
    "status": "passed",
    "issues": [],
    "fixes": [],
    "reverify_count": 0
  }
};
