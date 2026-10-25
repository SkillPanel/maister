---
name: implementation-plan-executor
description: Execute implementation plans by delegating each task group to the task-group-implementer subagent. Hands a workflow run's waves — group dispatch, group returns, escalation, failure handling and the work-log bookkeeping — to the implementation runner subagent when the run can nest subagents, and runs the same loop in the main session when it cannot. Asks the user only the decisions the loop returns. Every wave start and group return is recorded through the workflow engine; standards are loaded per task group.
user-invocable: false
---

You are the hand-off between an implementation node and its waves. The loop itself — the waves
from the plan, each group's `task-group-implementer` call on the model `dispatch-model` resolves
for its tier, every `wave-start` and `group-done`, the one-step escalation, the budget, the docs
index refresh, the full test suite and the closing work-log entry — is written once, in the
implementation runner's instructions (`<plugin root>/agents/implementation-runner.md`, the
plugin root two levels above this skill's base directory, as an absolute path). Where the run
can nest subagents, the runner runs it and this skill makes one call per runner pass; where it
cannot, this skill runs the same procedure here.

## Inputs

- **`node`** — the node running the waves: the invoking node, `implementation` by default;
  migration's `execution` names itself.
- The plan at `implementation/implementation-plan.md` and the spec beside it. The node records
  its `sequential` input as `orchestrator.options.sequential` before invoking this skill; the
  loop reads that key.

**Standalone** (no `orchestrator-state.yml` at the task path): there is no run, so no runner and
no state. Follow the runner's procedure here, in the main session, as its § *In the main
session* says, then return § *Structured output*.

## The hand-off

Each step below is one call. The engine's `runner-step` reads the run and says what to do next;
never work it out from the files yourself:

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs runner-step --state=<task path>/orchestrator-state.yml --node=<node> --runner=implementation
```

It prints one JSON object. Act on its `next`, then run `runner-step` again, until it says `close`
or `inline`:

- **`dispatch`** — dispatch the runner. First run `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs
  dispatch-model --agent=maister:implementation-runner --host=claude --state=<task path>/orchestrator-state.yml
  --node=<node>` and copy its `model` and `effort` into the call
  (`../orchestrator-framework/references/orchestrator-patterns.md` § 1). One agent call, the only
  one in its message:
  - `subagent_type: maister:implementation-runner`, `description: Run the implementation waves`;
  - **`run_in_background: false`, set explicitly on every host.** Where the agent tool takes a
    `mode` instead, the foreground one, never `background`. Left unset, the host may start the
    runner in the background: the call returns at once, and the turn ends before the waves do.
    If a host starts it in the background anyway, wait for its completion notice — never run
    `runner-step` while it still runs, and never end the turn there;
  - the prompt: `task_path`, `state`, `node`, `plugin_root` (the absolute path above), and
    `resume` exactly as `runner-step` printed it.

  When the runner returns, its reply is its result; `runner-step` reads the same result from disk.
- **`ask`** — the runner returned a decision a person makes: groups that failed after their
  escalation, a test step a group skipped, or a wave past the model budget (`kind`: `groups` or
  `budget`). The questions are ready in `questions_file`, each with its own context and its
  options. Ask them under the run's driver (`asking`):
  - `session` — ask in session with AskUserQuestion, a question per entry, four to a page and
    further pages in the same turn: each its `question`, its options' labels and descriptions,
    the recommended one marked "(Recommended)". Record each answer on the node summary as the node records any
    answer, under the question's `id`, then `runner-step --answered`;
  - `suspend` — the node's one request of its attempt: the set in the patch file, `gate-brief
    --request --patch-file`, and suspend. On the answer the run comes back here, and
    `runner-step` finds the answers itself;
  - `none` — nobody can be asked and the run's policy classes questions: send the set in the
    classing write, then `runner-step --answered`. (When nobody can be asked and nothing
    classes, `runner-step` takes each question's default itself and never prints `ask`.)
- **`unavailable`** — the runner could not dispatch subagents. Narrow the run's delegation: one
  `write-state` of `{"orchestrator": {"options": {"delegation": {"mode": "inline", "reason":
  "<the reason, one line>"}}}}`. Then `runner-step` says `inline`.
- **`inline`** — the run keeps its waves in the main session (its delegation is `inline`, with
  the reason printed). Follow the runner's procedure here, from § *Where to start* with `resume`
  as the files say, asking where the runner would hand back a decision. **Every task group is
  still a `task-group-implementer` call**, and the full suite and the docs refresh are still
  subagent calls: what moves into this session is the loop's bookkeeping, never a group's code.
- **`close`** — the waves are done, and the plan and the work log say so. Return § *Structured
  output*, read from the printed `summary`, to the node. Do not complete the node: its status
  stays as it is, because the orchestrator owns completing it.

A crash, a cleared session or a compaction at any point resumes the same way: the engine re-runs
the `running` node, this skill runs `runner-step`, and the plan, the work log and the runner's
files say where the waves stand.

## Output artifacts

| Artifact | Condition |
|----------|-----------|
| `implementation/implementation-plan.md` | Its checkboxes ticked by `group-done`, its HTML companion synced |
| `implementation/work-log.md` | Always: the opening entry, each wave start and group return, reverts, the closing entry |
| `implementation/test-suite-results.md` | The full suite, at the end |
| `implementation/runner-result.json`, `decision-wave-<K>.json`, `decisions-<N>.json` | When the runner runs the waves: its last result, each decision's questions, and each decision's answers |

## Structured output

Returned to the invoking node on `close`, and by a standalone run:

```yaml
groups_done: 4            # of groups_total
groups_total: 4
models: "light 1, standard 3, escalations 1"   # for the node summary's model tally
test_suite: "passed: 40 of 40"
docs_changed: []          # paths under .maister/docs/
standard_candidates: []   # one line each, offered at finalization
stopped: null             # or why a person stopped the waves
```

A `stopped` summary is a stop: the node records it as it records any stop, the groups done so far
standing as they are.

## Validation checklist

- `runner-step --runner=implementation` asked before every move, and acted on as printed
- The runner dispatched with `run_in_background: false` and the `dispatch-model` values
- Every decision asked from its questions file, the answers recorded under each question's id
  before `--answered`
- `unavailable` narrowed through `write-state` before running inline
- No wave start, group return or work-log entry of the loop's own here while the runner runs it:
  the runner makes them
