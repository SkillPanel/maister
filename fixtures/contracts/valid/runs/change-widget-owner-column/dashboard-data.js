window.MAISTER_DATA = {
  "generated": "2026-09-12T09:41:06Z",
  "task": {
    "title": "Show the owner column in the widget list response",
    "type": "change",
    "status": "completed",
    "description": "Show the owner column in the widget list response",
    "path": ".maister/tasks/change/2026-09-12-widget-owner-column",
    "current_activity": null
  },
  "characteristics": {},
  "phases": [
    {
      "id": "standards-discovery",
      "name": "Standards discovery",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-09-12T09:14:30Z",
      "completed": "2026-09-12T09:15:48Z",
      "skip_reason": null,
      "summary": "Read the member's docs index and the two standards it names for this area; the API response-shape rules and the migration rules both apply to this change.",
      "decisions": [
        {
          "decision": "Read the index at the conventional path",
          "rationale": "no docs_index input was supplied and .maister/docs/INDEX.md is present in widget-api"
        }
      ],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "change",
      "name": "Change",
      "icon_hint": "code",
      "status": "completed",
      "started": "2026-09-12T09:15:48Z",
      "completed": "2026-09-12T09:27:11Z",
      "skip_reason": null,
      "summary": "Added the owner column to the widget list projection and to the serializer, behind the existing rollout flag, with one test covering the flag on and off.",
      "decisions": [
        {
          "decision": "Project the column rather than joining the owner record",
          "rationale": "the list endpoint is paginated and a join per row is the N+1 the response-shape standard names"
        },
        {
          "decision": "Keep the change behind the existing rollout flag",
          "rationale": "the flag already gates this endpoint's shape, so a second switch would be a second thing to retire"
        }
      ],
      "risks": [
        "The flag's default is off in every environment, so nothing observes the new column until it is turned on."
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
      "id": "verify",
      "name": "Verify",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-09-12T09:27:11Z",
      "completed": "2026-09-12T09:31:52Z",
      "skip_reason": null,
      "summary": "Full suite run: 142 passed, 0 failed. The two new assertions cover the flag on and off; nothing else moved.",
      "decisions": [
        {
          "decision": "Run the whole suite rather than the touched file",
          "rationale": "the serializer is shared, so a regression would surface outside the file the change touched"
        }
      ],
      "risks": [],
      "artifacts": [
        {
          "path": "verification/verification-report.md",
          "label": "Verification report",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "change-approval",
      "name": "Change approval",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-09-12T09:31:52Z",
      "completed": "2026-09-12T09:38:40Z",
      "skip_reason": null,
      "summary": "Gate answered by the dispatching operator: continue-to-closeout. The change and its verification stand and the run proceeds to close-out.",
      "decisions": [
        {
          "decision": "continue-to-closeout",
          "rationale": "the dispatching operator accepted the change and the green suite and chose to continue"
        }
      ],
      "risks": [],
      "artifacts": [],
      "gate": {
        "question": "Change verified. Continue to close-out?",
        "answer": "continue-to-closeout"
      }
    },
    {
      "id": "close-out",
      "name": "Close out",
      "icon_hint": "done",
      "status": "completed",
      "started": "2026-09-12T09:38:40Z",
      "completed": "2026-09-12T09:41:06Z",
      "skip_reason": null,
      "summary": "Committed the two touched files on the dispatch branch and pushed it. No pull request: the dispatch declared pr_required false, so the close-out message names the branch a reviewer opens instead.",
      "decisions": [
        {
          "decision": "No pull request opened",
          "rationale": "the dispatch node declared closeout_contract.pr_required false and the seed's close-out section says so"
        }
      ],
      "risks": [],
      "artifacts": [],
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
