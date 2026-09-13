window.MAISTER_DATA = {
  "generated": "2026-09-12T14:38:29Z",
  "task": {
    "title": "Rate-limited responses omit the Retry-After header",
    "type": "fix",
    "status": "completed",
    "description": "Rate-limited responses omit the Retry-After header",
    "path": ".maister/tasks/fix/2026-09-12-retry-after-header",
    "current_activity": null
  },
  "characteristics": {},
  "phases": [
    {
      "id": "standards-discovery",
      "name": "Standards discovery",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-09-12T14:04:02Z",
      "completed": "2026-09-12T14:05:19Z",
      "skip_reason": null,
      "summary": "Read the member's docs index and the two standards relevant to a rate-limit response: the API error-shape rules and the HTTP header conventions.",
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
      "id": "reproduce",
      "name": "Reproduce",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-09-12T14:05:19Z",
      "completed": "2026-09-12T14:14:44Z",
      "skip_reason": null,
      "summary": "Red proven. A request over the limit returns 429 with no Retry-After header; the new test asserts the header is present and carries the bucket's seconds-to-refill, and it failed for that reason.",
      "decisions": [
        {
          "decision": "Assert the header value, not only its presence",
          "rationale": "a header present with a wrong value is the same outage for a client that backs off on it, and the header conventions standard fixes the unit as whole seconds"
        },
        {
          "decision": "Trace before writing the test",
          "rationale": "the 429 is raised in two places and only one of them was the one the statement describes"
        }
      ],
      "risks": [
        "The limiter also raises 429 from the burst path, which this reproduction does not cover."
      ],
      "artifacts": [
        {
          "path": "implementation/tdd-red-gate.md",
          "label": "Reproduction",
          "html": null
        }
      ],
      "gate": null
    },
    {
      "id": "fix",
      "name": "Fix",
      "icon_hint": "code",
      "status": "completed",
      "started": "2026-09-12T14:14:44Z",
      "completed": "2026-09-12T14:24:07Z",
      "skip_reason": null,
      "summary": "Root cause confirmed: the deny branch built the response from the error body helper, which sets no headers. The branch now sets Retry-After from the bucket's refill estimate, and the reproduction test is green.",
      "decisions": [
        {
          "decision": "Set the header in the deny branch rather than in the error helper",
          "rationale": "the helper serves every error shape and Retry-After is meaningful for exactly one of them"
        },
        {
          "decision": "Round the refill estimate up to whole seconds",
          "rationale": "the header conventions standard fixes the unit, and rounding down tells a client to retry while it is still limited"
        }
      ],
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
      "id": "verify",
      "name": "Verify",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-09-12T14:24:07Z",
      "completed": "2026-09-12T14:29:33Z",
      "skip_reason": null,
      "summary": "Full suite run: 143 passed, 0 failed. The reproduction test is green and the three other limiter tests are unchanged.",
      "decisions": [
        {
          "decision": "Run the whole suite rather than the limiter tests",
          "rationale": "the error helper is shared by every endpoint, so a regression would surface outside the limiter"
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
      "id": "fix-approval",
      "name": "Fix approval",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-09-12T14:29:33Z",
      "completed": "2026-09-12T14:36:10Z",
      "skip_reason": null,
      "summary": "Gate answered by the dispatching operator: continue-to-closeout. The reproduction was proved, the fix addresses the traced cause and the suite is green.",
      "decisions": [
        {
          "decision": "continue-to-closeout",
          "rationale": "the dispatching operator accepted the red-to-green transition and the green suite and chose to continue"
        }
      ],
      "risks": [],
      "artifacts": [],
      "gate": {
        "question": "Fix verified. Continue to close-out?",
        "answer": "continue-to-closeout"
      }
    },
    {
      "id": "close-out",
      "name": "Close out",
      "icon_hint": "done",
      "status": "completed",
      "started": "2026-09-12T14:36:10Z",
      "completed": "2026-09-12T14:38:29Z",
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
