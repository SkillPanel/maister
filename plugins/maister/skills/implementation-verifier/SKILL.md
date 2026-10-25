---
name: implementation-verifier
description: Verify completed implementations for quality assurance. Hands a workflow run's verification loop — the tests and the project's other checks, the spec conformance, code risk and simplicity reviews, the fixes they call for and their re-checks — to the verification runner subagent when the run can nest subagents, and runs the same loop in the main session when it cannot. Asks the user only the decisions the loop returns, and closes on one verification report. Use after implementation is complete and before code review/commit.
user-invocable: false
---

You are the hand-off between a verification node and its loop. The loop itself — the review
brief, the test suite, the review panel, the findings merge, the report, the fix passes and their
re-checks, and every `verification_context` record — is written once, in the verification
runner's instructions (`<plugin root>/agents/verification-runner.md`, the plugin root two levels
above this skill's base directory, as an absolute path). Where the run can nest subagents, the
runner runs it and this skill makes one call per runner pass; where it cannot, this skill runs
the same procedure here.

## Inputs

From the node that invoked this skill, or the defaults:

- **`node`** — the node running the loop: the invoking node, `verification` by default; migration's
  `issue-resolution` names itself.
- **`fixes`** — `on` by default; migration's `verification` passes `off`: one verification cycle,
  no fixes, its fix loop belonging to `issue-resolution`.
- **`findings_file`** — `verification/<node>-findings.json` by default; the list a decision's
  findings are written to, which the node's `finding-brief` call reads.
- **`work_log`** — `true` when the node logs each fix in the work log as well (development and
  migration).
- **`hold`** — finding categories the loop never fixes (migration: `data-integrity`).

**Standalone** (no `orchestrator-state.yml` at the task path): there is no run, so no runner and
no state. Follow the runner's procedure here, in the main session, as its § *In the main session*
says, then return § *Structured output*.

## The hand-off

Each step below is one call. The engine's `runner-step` reads the run and says what to do next;
never work it out from the files yourself:

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs runner-step --state=<task path>/orchestrator-state.yml --node=<node>
```

It prints one JSON object. Act on its `next`, then run `runner-step` again, until it says `close`
or `inline`:

- **`dispatch`** — dispatch the runner. First run `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs
  dispatch-model --agent=maister:verification-runner --host=claude --state=<task path>/orchestrator-state.yml
  --node=<node>` and copy its `model` and `effort` into the call
  (`../orchestrator-framework/references/orchestrator-patterns.md` § 1). One agent call, the only
  one in its message:
  - `subagent_type: maister:verification-runner`, `description: Run the verification loop`;
  - **`run_in_background: false`, set explicitly on every host.** Where the agent tool takes a
    `mode` instead, the foreground one, never `background`. Left unset, the host may start the
    runner in the background: the call returns at once, and the turn ends before the loop
    does. If a host starts it in the background anyway, wait for its completion notice — never
    run `runner-step` while it still runs, and never end the turn there;
  - the prompt: `task_path`, `state`, `node`, `plugin_root` (the absolute path above), `fixes`,
    `findings_file`, `work_log`, `hold`, and `resume` exactly as `runner-step` printed it.

  When the runner returns, its reply is its result; `runner-step` reads the same result from disk.
- **`ask`** — the runner returned a decision a person makes (`kind`: `findings`, `budget` or
  `no_progress`). Ask it as the node's prose says, under the run's driver (`asking`):
  - the findings, when `findings_file` is set: `finding-brief --state=<state> --node=<node>
    --findings-file=<findings_file>` builds the set, one question per finding;
  - the stopping question, when `stop_question` is true (framework § 6, step 8): "One more
    round", "Continue as is" or "Stop", recommended as § 6 says, under the question id
    `verification-fix-loop`;
  - `session` — ask in session (paged as the engine's in-node questions say), record the answers
    on the node summary as the node records any answer, then `runner-step --answered`;
  - `suspend` — the node's one request of its attempt (`gate-brief --request --patch-file`), and
    suspend. On the answer the run comes back here, and `runner-step` finds the answers itself;
  - `none` — nobody can be asked and the run's policy classes questions: send the set in the
    classing write as the node's prose says, then `runner-step --answered`. (When nobody can be
    asked and nothing classes, `runner-step` takes the defaults itself and never prints `ask`.)
- **`unavailable`** — the runner could not dispatch subagents. Narrow the run's delegation: one
  `write-state` of `{"orchestrator": {"options": {"delegation": {"mode": "inline", "reason":
  "<the reason, one line>"}}}}`. Then `runner-step` says `inline`.
- **`inline`** — the run keeps its loop in the main session (its delegation is `inline`, with
  the reason printed). Follow the runner's procedure here, from § *Where to start* with `resume`
  as the files say, asking where the runner would hand back a decision — today's loop, one step
  at a time. **Every review, the test suite and every fix is still a subagent call**: what moves
  into this session is the loop's bookkeeping, never a check. Never run the tests, review the
  code or write a reviewer's report or findings file here.
- **`close`** — the verdict is final, and the report and its companion are on disk. Return
  § *Structured output*, read from `findings_path`, to the node, which writes its summary and
  completes.

A crash, a cleared session or a compaction at any point resumes the same way: the engine re-runs
the `running` node, this skill runs `runner-step`, and the files say where the loop stands.

## Output artifacts

| Artifact | Condition |
|----------|-----------|
| `verification/implementation-verification.md` | Always; rewritten every cycle |
| `verification/implementation-verification.html` | Once, at the final verdict, unless `orchestrator.options.html_output` is false |
| `verification/<review>-report.md` and `<review>-findings.json` | Each review that ran (`references/review-findings.md`) |
| `verification/review-brief-<N>.json`, `findings.json`, `findings-<N>.json` | Each cycle, by the engine's `review-brief` and `findings-merge` |
| `verification/runner-result.json`, `decisions-<N>.json` | When the runner runs the loop: its last result, and each decision's answers |

## The runner's result

What `runner-result` writes and the runner returns, with the node, the attempt and the cycle
stamped on:

```yaml
result: verdict | needs_decision | unavailable
verdict: passed | passed_with_issues | failed      # a verdict only
report_path / findings_path / html_path / counts   # counts: critical, warning, info, fixed
decision: {kind: findings | budget | no_progress, findings_file, resume_token: {cycle, snapshot}}
reason: "<one line>"                               # unavailable
```

## Structured output

Returned to the invoking node on `close`, and by a standalone run:

```yaml
status: "passed" | "passed_with_issues" | "failed"
report_path: "verification/implementation-verification.md"
companion: "written" | "disabled" | "failed"   # disabled when html_output is false in state
html_path: "verification/implementation-verification.html"  # null unless written
issues:   # from findings.json: id, source, severity, description, location, fixable, risky, fixed
issue_counts: {critical: 0, warning: 0, info: 0}
fixes_applied: []   # {finding, change}, for the node summary's fixes_applied — never a decision
```

## Grading fixability

The reviewers grade each finding, and the loop acts on the grade (framework § 6):

- **`fixable: true`** — lint errors, formatting, missing imports, obvious typos, simple config
  fixes. **`false`** — architecture decisions, design trade-offs, test logic errors, unclear
  requirements; its `suggestion` says what a person has to supply.
- **`risky: true`** — the fix reaches beyond its item into behaviour the change did not set out to
  alter: it departs from the specification, changes what callers see, or touches anything beyond
  the code (staging files in git, publishing). A fix wrongly graded safe is a change nobody
  chose, so grade it honestly.
- An issue a person decides carries its choices — the proposed fix first, never "decide later";
  the accept-the-risk choice is added for it. Fixability is graded the same way at every
  severity, but only critical and warning issues are fixed without asking: an info item is
  listed in the report, and fixed only when a person chooses it.

## Validation checklist

- `runner-step` asked before every move, and acted on as printed
- The runner dispatched with `run_in_background: false` and the `dispatch-model` values
- Every decision asked as the node's prose says, the answers recorded before `--answered`
- `unavailable` narrowed through `write-state` before running inline
- No state write of the loop's own here while the runner runs it: the runner makes them
