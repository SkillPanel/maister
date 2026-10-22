---
name: reviews-code-risk
description: Review a change for what can break, leak or fall over where the project runs — correctness, failure paths, security, CI and build, operational hygiene and the standards that apply
---

**ACTION REQUIRED**: This command delegates to a subagent. The `<command-name>` tag refers to THIS command, not the target. Invoke the code-risk-review subagent via the Task tool NOW. Do not read files, explore code, or execute workflow steps yourself — beyond the quick target lookup below when no target is given.

You are running a code risk review (correctness, failure paths, security and resilience keyed to the project profile, CI and build, operational hygiene, and the standards that govern the change) using the `code-risk-review` subagent, on its own and without a review brief.

## Parse User Request

**The target**, from the user's request:
- A task directory under `.maister/tasks/`: review that task's change; its spec, plan and work log are the documents.
- A base commit or branch: review the working tree against it.
- Nothing given: ask once with generated targets — look them up first with `git status --short` and the newest folder under `.maister/tasks/`, nothing more. "What should the review cover?": "The current uncommitted changes (Recommended)" (only when `git status` shows some; otherwise the latest task is recommended), "The latest task: <task name>", "This branch against the default branch". A typed path or commit is the Other answer.

## Your Instructions

First run `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister-copilot:code-risk-review --host=copilot` and give the call the model and effort it prints, leaving out a field printed as `omit`; a field the host refuses is dropped and the call sent again, with one line in your reply saying so.

```
Use Task tool:
  subagent_type: "maister-copilot:code-risk-review"
  description: "Code risk review"
  prompt: |
    Review without a brief.
    Target: [the task directory, the base commit or branch, or the uncommitted changes]
    task_path: [the task directory, when there is one]
    report_path: [the task directory's verification/code-risk-review.md, else .maister/reviews/code-risk-review.md]
```

**Wait for the subagent to complete**, then relay its summary: the report path and the counts by severity.

## Notes

- Analysis only: no code is modified.
- The same reviewer runs inside verification, where the workflow hands it a review brief; this command runs it on its own.
