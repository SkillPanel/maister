window.MAISTER_DATA = {
  "generated": "2026-08-24T10:41:05Z",
  "task": {
    "title": "Widget rollout chain",
    "type": "development",
    "status": "in_progress",
    "description": "Chain run: research, then an operator gate, then one per-repo development run, then close-out.",
    "path": ".maister/umbrella/runs/019260a2-1122-7c33-8d44-5e6677889900",
    "current_activity": "Gate approve is awaiting an operator decision."
  },
  "characteristics": {
    "chain": true,
    "provider": "claude"
  },
  "phases": [
    {
      "id": "research",
      "name": "Research",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-24T09:00:12Z",
      "completed": "2026-08-24T10:41:03Z",
      "skip_reason": null,
      "summary": "Two candidate rollout orders; the per-repo order is forced by the shared client package.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "outputs/research-report.md",
          "label": "Research report",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "approve",
      "name": "Operator gate",
      "icon_hint": "verify",
      "status": "in_progress",
      "started": "2026-08-24T10:41:03Z",
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": {
        "question": "Research is complete. Proceed to the per-repo implementation runs?",
        "answer": null
      }
    },
    {
      "id": "dev",
      "name": "Per-repo development",
      "icon_hint": "code",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "close-out",
      "name": "Close out",
      "icon_hint": "done",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
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
