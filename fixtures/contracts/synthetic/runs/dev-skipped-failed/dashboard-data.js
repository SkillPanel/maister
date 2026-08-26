window.MAISTER_DATA = {
  "generated": "2026-08-22T18:41:09Z",
  "task": {
    "title": "Widget export endpoint",
    "type": "development",
    "status": "failed",
    "description": "Add a paginated export endpoint for widgets.",
    "path": ".maister/tasks/development/2026-08-22-widget-export-endpoint",
    "current_activity": "Phase 9 failed after 2 auto-fix attempts; awaiting an operator decision."
  },
  "characteristics": {
    "has_reproducible_defect": false,
    "modifies_existing_code": true,
    "creates_new_entities": true,
    "involves_data_operations": true,
    "ui_heavy": false
  },
  "phases": [
    {
      "id": "phase-1",
      "name": "Analyze codebase & clarify requirements",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-22T10:00:00Z",
      "completed": "2026-08-22T11:12:33Z",
      "skip_reason": null,
      "summary": "Export helpers already exist for the catalog module and are reusable here.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "analysis/codebase-analysis.md",
          "label": "Codebase analysis",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-2",
      "name": "Gap analysis",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-22T11:12:33Z",
      "completed": "2026-08-22T12:04:18Z",
      "skip_reason": null,
      "summary": "One gap: no pagination cursor on the existing helper.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "analysis/gap-analysis.md",
          "label": "Gap analysis",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-3",
      "name": "Reproduce defect",
      "icon_hint": "code",
      "status": "skipped",
      "started": null,
      "completed": null,
      "skip_reason": "has_reproducible_defect false - additive feature, no defect to reproduce",
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-4",
      "name": "Generate mockups",
      "icon_hint": "plan",
      "status": "skipped",
      "started": null,
      "completed": null,
      "skip_reason": "ui_heavy false - no UI surface in this repo",
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-5",
      "name": "Create specification",
      "icon_hint": "spec",
      "status": "completed",
      "started": "2026-08-22T12:04:18Z",
      "completed": "2026-08-22T13:30:02Z",
      "skip_reason": null,
      "summary": "One endpoint, cursor pagination, streamed response.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "implementation/spec.md",
          "label": "Specification",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-6",
      "name": "Audit specification",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-08-22T13:30:02Z",
      "completed": "2026-08-22T14:00:41Z",
      "skip_reason": null,
      "summary": "Audit passed with two info findings.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "verification/spec-audit.md",
          "label": "Specification audit",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "phase-7",
      "name": "Plan implementation",
      "icon_hint": "plan",
      "status": "completed",
      "started": "2026-08-22T14:00:41Z",
      "completed": "2026-08-22T14:48:26Z",
      "skip_reason": null,
      "summary": "Three task groups, test-first.",
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
      "id": "phase-8",
      "name": "Implement",
      "icon_hint": "code",
      "status": "completed",
      "started": "2026-08-22T14:48:26Z",
      "completed": "2026-08-22T17:20:55Z",
      "skip_reason": null,
      "summary": "Groups 1-2 landed; group 3 left the suite red.",
      "decisions": [],
      "risks": [
        "Streaming writer leaks a file handle on the error path"
      ],
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
      "id": "phase-9",
      "name": "Verify implementation",
      "icon_hint": "verify",
      "status": "failed",
      "started": "2026-08-22T17:20:55Z",
      "completed": "2026-08-22T18:41:09Z",
      "skip_reason": null,
      "summary": "Verification failed twice: 3 issues, 1 critical, auto-fix exhausted.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "verification/implementation-verification.md",
          "label": "Implementation verification",
          "html": null
        }
      ],
      "gate": null
    }
  ],
  "verification": {
    "status": "failed",
    "issues": [
      {
        "severity": "critical",
        "category": "correctness",
        "description": "The export stream leaks a file handle when the consumer disconnects mid-page.",
        "fixable": true,
        "fixed": false
      },
      {
        "severity": "warning",
        "category": "tests",
        "description": "No test covers a cursor pointing past the last page.",
        "fixable": true,
        "fixed": false
      },
      {
        "severity": "info",
        "category": "style",
        "description": "The cursor encoder duplicates a helper already present in the catalog module.",
        "fixable": true,
        "fixed": false
      }
    ],
    "fixes": [],
    "reverify_count": 2
  }
};
