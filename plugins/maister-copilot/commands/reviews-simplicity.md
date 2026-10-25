---
name: reviews-simplicity
description: Check a change for complexity the project does not need — needless abstraction, infrastructure beyond its scale, configuration sprawl and developer friction
---

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

**ACTION REQUIRED**: This command delegates to a subagent. The `<command-name>` tag refers to THIS command, not the target. Invoke the simplicity-review subagent via the Task tool NOW. Do not read files, explore code, or execute workflow steps yourself — beyond the quick target lookup below when no target is given.

You are running a simplicity review (needless abstraction, infrastructure beyond the project's scale, configuration sprawl, indirection and developer friction) using the `simplicity-review` subagent, on its own and without a review brief.

## Parse User Request

**The target**, from the user's request:
- A task directory under `.maister/tasks/`: review that task's change; its spec, plan and work log are the documents.
- A base commit or branch: review the working tree against it.
- Nothing given: ask once with generated targets — look them up first with `git status --short` and the newest folder under `.maister/tasks/`, nothing more. "What should the review cover?": "The current uncommitted changes (Recommended)" (only when `git status` shows some; otherwise the latest task is recommended), "The latest task: <task name>", "This branch against the default branch". A typed path or commit is the Other answer.

## Your Instructions

First run `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister-copilot:simplicity-review --host=copilot` and give the call the model and effort it prints, leaving out a field printed as `omit`; a field the host refuses is dropped and the call sent again, with one line in your reply saying so.

```
Use Task tool:
  agent_type: "maister-copilot:simplicity-review"
  name: "simplicity-review"
  description: "Simplicity review"
  prompt: |
    Review without a brief.
    Target: [the task directory, the base commit or branch, or the uncommitted changes]
    task_path: [the task directory, when there is one]
    report_path: [the task directory's verification/simplicity-review.md, else .maister/reviews/simplicity-review.md]
```

**Wait for the subagent to complete**, then relay its summary: the report path and the counts by severity.

## Notes

- Analysis only: no code is modified.
- The same reviewer runs inside verification, where the workflow hands it a review brief; this command runs it on its own.
