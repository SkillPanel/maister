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
never work it out from the files yourself. Its row, `runner-result`'s and `in-flight`'s, and
their refusals, are in `<plugin root>/skills/workflow-engine/references/verbs.md`:

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs runner-step --state=<task path>/orchestrator-state.yml --node=<node>
```

It prints one JSON object. Act on its `next`, then run `runner-step` again, until it says `close`
or `inline`:

- **`dispatch`** — dispatch the runner. First run `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs
  dispatch-model --agent=maister:verification-runner --host=claude --state=<task path>/orchestrator-state.yml
  --node=<node>` and copy its `model` and `effort` into the call
  (`../workflow-engine/references/verbs.md` § *Model and effort on every agent call*). One agent call, the only
  one in its message:
  - `subagent_type: maister:verification-runner`, `description: Run the verification loop`;
  - **`run_in_background: false`, set explicitly on every host.** Where the agent tool takes a
    `mode` instead, the foreground one, never `background`. Left unset, the host may start the
    runner in the background: the call returns at once, and the turn ends before the loop
    does. If a host starts it in the background anyway, wait for its completion notice — never
    run `runner-step` while it still runs, and never end the turn there;
  - the prompt: `task_path`, `state`, `node`, `plugin_root` (the absolute path above), `fixes`,
    `findings_file`, `work_log`, `hold`, and `resume` exactly as `runner-step` printed it.

  When the runner returns — its reply, or its completion notice when the host ran it in the
  background — run `runner-step` at once, whatever the reply says: it reads the result from disk,
  and only its `next` says what comes next. A runner can hand back `waiting` and still be woken
  afterwards; a reply in prose is no result at all.
- **`ask`** — the runner returned a decision a person makes (`kind`: `findings`, `budget` or
  `no_progress`). Ask it as the node's prose says, under the run's driver (`asking`):
  - the findings, when `findings_file` is set: `finding-brief --state=<state> --node=<node>
    --findings-file=<findings_file>` builds the set, one question per finding;
  - the stopping question, when `stop_question` is true: "One more
    round", "Continue as is" or "Stop", recommended in this order — "One more round" while
    progress was made and a fixable warning or critical issue is open; else "Stop" with a
    critical left; else "Continue as is" when no critical is left, info-only included. The id
    follows this rule, read from the printed `open` counts and `kind` (`budget` means
    progress made with a fixable warning or critical issue open; `no_progress` means not):
    `verification-go-on` when the recommended answer leaves the loop — "Continue as is" or
    "Stop" — with a warning or critical open; `verification-fix-loop` when it recommends "One
    more round", or when only info is left. With a critical open, the go-on question carries
    `triage: {version: 1, class: approve}` in the set, and so does the stopping question under
    either id when `runner-step` prints `stop_triage`: the run has granted itself all the rounds
    it may, so a person answers. The stopping question names no `default` of its own: its
    recommended option is its default;
  - `session` — ask in session (paged as the engine's in-node questions say), record the answers
    on the node summary as the node records any answer, then `runner-step --answered`;
  - `suspend` — a request of the node's attempt, its first or a follow-up round (`runner-step`
    asks only while a round is left; `gate-request --node --patch-file`), which suspends. On the answer the run comes back here, and `runner-step` finds the answers itself;
  - `none` — nobody can be asked and the run's policy classes questions: send the set in the
    classing write as the node's prose says, then `runner-step --answered`. (When nobody can be
    asked and nothing classes, `runner-step` takes the defaults itself — the stop `undecided`
    with a warning or critical open, `continue` otherwise — and never prints `ask`.)
- **`wait`** — agents the runner sent (the suite runner, reviewers, fix batches) are still out:
  the runner ended `waiting`, or ended without a result, on a host that runs a subagent's own
  agent calls in the background. `pending` lists each one's `id`, the host's `agent` id when
  recorded, and the `output` it owes. Those agents outlive the runner. Their completion
  notices come to this session or, on a host that wakes the runner for them, to the runner,
  which then ends again with a completion notice of its own. Run `runner-step` again on every
  completion notice — a pending agent's or the runner's — and never end the turn here, never
  narrow the delegation, never dispatch the runner while one is out. A pending agent whose
  completion notice or reply came to this session while its output is still missing: when the
  reply holds a fix batch's report, write it to `<task path>/<output>`, its first line saying it was
  copied from the agent's reply, so the runner adopts it; otherwise it ended without it: run
  `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs in-flight --state=<state>
  --node=<node> --runner=verification --ended=<id>`. Then `runner-step` again. **The runner's
  own completion notice releases its agents** where the host says the notice comes only once
  the runner has no agent of its own still running (its reply, which can come earlier, does
  not): every pending agent whose output is still missing then ended without it, and is marked
  `--ended` the same way before `runner-step`.
- **`unavailable`** — the runner could not run at all: no agent tool, or no way to dispatch
  subagents. It is never a loop with agents still out — that is `wait`, and the engine refuses
  `unavailable` while one is. Narrow the run's delegation: one
  `write-state` of `{"orchestrator": {"options": {"delegation": {"mode": "inline", "reason":
  "<the reason, one line>"}}}}`. Then `runner-step` says `inline`.
- **`inline`** — the run keeps its loop in the main session (its delegation is `inline`, with
  the reason printed). Print the runner's file, by its own headings, in the two calls one print
  each holds — `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs reference --at="agents/verification-runner.md § Verification Runner" --at="agents/verification-runner.md § Inputs" --at="agents/verification-runner.md § Where to start" --at="agents/verification-runner.md § A verification cycle"`, then `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs reference --at="agents/verification-runner.md § The fix pass" --at="agents/verification-runner.md § Ending a dispatch" --at="agents/verification-runner.md § In the main session"` — never with the file-read tool and never into a scratch copy: the
  plugin sits outside the project. Follow its procedure here, from § *Where to start* with `resume`
  as the files say, asking where the runner would hand back a decision — today's loop, one step
  at a time. **Every review, the test suite and every fix is still a subagent call**: what moves
  into this session is the loop's bookkeeping, never a check. Never run the tests, review the
  code or write a reviewer's report or findings file here.
- **`close`** — the verdict is final, and the report and its companion are on disk. Return
  § *Structured output*, read from `findings_path`, to the node, which writes its summary and
  completes. When `runner-step` prints `undecided: true`, the loop ended undecided: return it,
  and the node records the not-taken choice and recommends no way on
  (`../workflow-engine/references/in-node-questions.md` § *Findings that need a decision*).

A crash, a cleared session or a compaction at any point resumes the same way: the engine re-runs
the `running` node, this skill runs `runner-step`, and the files say where the loop stands.

## Output artifacts

| Artifact | Condition |
|----------|-----------|
| `verification/implementation-verification.md` | Always; rewritten every cycle |
| `verification/implementation-verification.html` | Once, at the final verdict, unless `orchestrator.options.html_output` is false |
| `verification/<review>-report.md` and `<review>-findings.json` | Each review that ran (`node <plugin root>/skills/workflow-engine/scripts/workflow.mjs reference --at="skills/implementation-verifier/references/review-findings.md § The findings file"`) |
| `verification/review-brief-<N>.json`, `findings.json`, `findings-<N>.json` | Each cycle, by the engine's `review-brief` and `findings-merge` |
| `verification/runner-result.json`, `decisions-<N>.json` | When the runner runs the loop: its last result, and each decision's answers |
| `verification/in-flight.json`, `verification/fix-reports/fix-<cycle>-<n>.md` | In a run: the agents sent and not yet reported, and each fix batch's report |

## The runner's result

What `runner-result` writes and the runner returns, with the node, the attempt and the cycle
stamped on:

```yaml
result: verdict | needs_decision | waiting | unavailable
verdict: passed | passed_with_issues | failed      # a verdict only
report_path / findings_path / html_path / counts   # counts: critical, warning, info, fixed
decision: {kind: findings | budget | no_progress, findings_file, resume_token: {cycle, snapshot}}
pending: [<agent ids>]                             # waiting: agents still out
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
undecided: true     # present only when the loop ended undecided: from `close` on the nested
                    # route; set by the session on the inline route, when the session itself
                    # ended the loop undecided
```

## Grading fixability

The reviewers grade each finding, and the loop acts on the grade (the verification runner's
§ *The fix pass*):

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
- `unavailable` narrowed through `write-state` before running inline; a `wait` never narrowed,
  and the runner not dispatched while an agent it sent is still out
- No state write of the loop's own here while the runner runs it: the runner makes them
