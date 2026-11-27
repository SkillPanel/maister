# engine-turns — turns, tokens and time per step, from a host transcript

`tools/engine-turns.mjs` reads a Claude Code session file or a Copilot CLI events file and counts
model turns, engine-only turns, tokens by kind, and generation time against tool time — per
session, per moment of the run and per step. `compare` puts two saved reports side by side, so a
change to the engine's call sequences is judged on the same figures each time.

It is contributor tooling: one dependency-free file (Node 20 or newer, `node:fs` and `node:path`
only), never shipped with the plugin. The story it is meant to measure is under
`tests/benchmark/` (how to run it there); its tests are `tests/engine/engine-turns.test.mjs`.

## Use

```
node tools/engine-turns.mjs measure [--json=<out.json>] [--table=<out.txt>] [--quiet]
                                    [--host=claude|copilot] [--no-subagents]
                                    [<label>=]<transcript> [[<label>=]<transcript> ...]
node tools/engine-turns.mjs compare <before.json> <after.json> [--table=<out.txt>] [--all]
```

- A transcript is a Claude Code session file (`<session>.jsonl`; its
  `<session>/subagents/agent-*.jsonl` files are found beside it) or a Copilot CLI `events.jsonl`
  (subagents are in the same file). The host is detected from the first records; `--host`
  overrides it.
- A label names the session in every output (`driver=<path>`). Without one a session is
  `session-1`, `session-2`, … A subagent file may be given a label of its own; it is then reported
  as a section and still attributed to its parent.
- Every path is an argument. Nothing printed or saved holds a path, a prompt, a tool result or a
  session id — only labels, step ids, verb names, tool categories, agent types, model ids and
  numbers. A refused argument is named by its position.
- `compare` matches sessions by label, prints only the rows that differ (`--all` prints every row)
  and needs both reports at the same `schema`. A report against itself prints
  `no difference in any compared metric`.

## What it prints

Per session: turns and transcript records, turn kinds, engine calls by verb with the turns that
called nothing else, steps the engine recorded as skipped, tokens by kind, generation, tool,
question and agent-wait time, the host's own totals beside the script's, then three tables —
interactions (a prompt and every turn it led to, with what came before the first act), moments in
order (one row per start, step, gate, sub-run, resume and end, with the subagent turns each
dispatched), and the same rolled up by moment. The JSON holds all of it plus a roll-up by step.

## Definitions

| Term | Rule |
|---|---|
| Turn | One model response: on Claude Code the `assistant` records sharing `message.id`, folded over the whole file (they are not adjacent: a call's result is written between two blocks of one response); on Copilot one `assistant.message`, keyed by `apiCallId`. Claude Code's `<synthetic>` messages are not turns. |
| Engine call | A shell call whose command holds `workflow.mjs <verb>`, searched only before a here-string (`<<`, `<<<`), so a patch body naming a verb is not counted. One command may hold several. |
| Engine-only turn | Every tool call in the turn is an engine call. "Engine or patch only" is reported beside it. |
| Patch-file turn | The turn holds a write of `.state-patch.json`. |
| Hand edit of a state file | A write tool aimed at `orchestrator-state.yml` or `gates/<id>.request.yml`. |
| Workflow read | A read, or a shell `grep`/`cat`/`sed`/`head` and the like, of a file under `.maister/` or a skill's `SKILL.md`, `references/`, `workflows/`, `scripts/` or `assets/`. |
| Engine-recorded skip | One `skipped: <id>` line in an engine call's result, read only before that result's first `next:` line. |
| Moment | `start`, `node` (a step), `gate` (terminal or driven), `sub-run`, `resume`, `end` — see below. |
| A turn's step | The step of the segment its first tool call falls in; each call keeps the segment in force when it was issued, so one response that closes a step and opens the next is counted call by call. |
| Generation time | Request start to the response's last record (Claude Code), or the usage record's `duration` (Copilot). |
| Tool time | The union of each call's start-to-result intervals; question tools and agent calls are kept apart. Time waiting on a person is question time and is never compared between runs. |

Turn kinds, mutually exclusive: `text` (no call), `engine`, `patch`, `engine+patch`, `skill`,
`wf-read`, `state-edit`, `mixed` (engine calls beside others), `work`.

### How a run is cut into moments

The transcript does not name a step; the script reads it from the engine calls the session made
and their results.

| What the script sees | Opens |
|---|---|
| A write's result with a `next: <id>` line (`id` not `none`) | A step `<id>`, from the next turn. What follows decides its kind: a `node-brief` for it changes nothing; a question-tool call or a gate call makes it a gate; a hand-off call makes it a sub-run. |
| `node-brief --node=<id>` | `node`, `<id>` |
| `gate-brief`, `gate-request`, `gate-revise`, `area-brief`, `finding-brief`, or a question-tool call (`AskUserQuestion`, `ask_user`) | `gate` — *driven* when it holds `gate-request`, *terminal* when it holds a question-tool call; the step in force when no `--node` is named |
| `subrun-path`, `subrun-handoff` | `sub-run`, likewise |
| `resume-check` | `resume`, tagged with what came before it: a gate, a sub-run or a new session |
| `gate-brief --node=held-approval`, `run-complete`, a write whose patch sets `task.status`, or the turn after a write that printed `next: none` | `end` |
| Nothing yet, and the session has called the engine | `start` |

The first row reads both forms of a step's start: a closing write that prints
`next: <id> … — run node-brief for it` and is followed by that call, and a write that prints its
`skipped:` lines and `next:` line and then the next step's brief, so no brief call follows. Only the
line prefixes `skipped: ` and `next: <id>` are matched, never the words after the id, and one
version of the script cuts both.

Three refinements:

1. A step that only briefed itself before a gate or a sub-run call is that gate or sub-run.
2. A question asked inside a step is a gate only until it is answered: the first call after the
   answer that works on the project opens the step again.
3. A turn belongs to the segment its first call falls in (`spanning_turns` counts the turns that
   crossed one).

### Where each figure is read

| Figure | Claude Code | Copilot CLI |
|---|---|---|
| Tool call | `assistant` record, `message.content[]` block `tool_use` (`id`, `name`, `input`); result in a `user` record's `tool_result` with `tool_use_id` | `assistant.message` `data.toolRequests[]` (`toolCallId`, `name`, `arguments`); `tool.execution_start` and `tool.execution_complete` |
| Request start | the `api-request` record joined by `id` to the `assistant` record's `requestRef` | the usage record's `timestamp` minus `data.usage.duration` |
| Input, not cached | `message.usage.input_tokens` | `inputTokens − cacheReadTokens − cacheWriteTokens` (Copilot's `inputTokens` is the whole prompt) |
| Cache read / write | `cache_read_input_tokens` / `cache_creation_input_tokens` | `cacheReadTokens` / `cacheWriteTokens` |
| Output / thinking | `output_tokens` / `output_tokens_details.thinking_tokens` | `outputTokens` / `reasoningTokens` |
| Model / effort | `message.model` / `effort` on the record | `data.model` / `usage.reasoningEffort` |
| Thinking time, argument streaming time | `thinkingDurationMs`, `toolInputStreamMs` | not given (`timeToFirstTokenMs` instead) |
| A subagent's turns | `<session>/subagents/agent-<agentId>.jsonl`, tied to the parent's `Agent` call by `toolUseId` in `agent-<agentId>.meta.json`, or by `toolUseResult.agentId` on the parent's result | the same file under a top-level `agentId`, tied by `subagent.started` `data.toolCallId` |
| Whether a model was named on the dispatch | `modelNotNamed` in the meta file | `modelSelectionSource` (`explicit_override`) |
| The host's own totals | `cost-state` record, `modelUsage[<model>]` | `session.shutdown`, `data.modelMetrics[<model>]` |

Claude Code repeats a response's whole usage on each of its records, so summing usage per record
overstates output; the report keeps that sum (`output_tokens_if_summed_per_record`) only so such a
figure can be recognised. The per-response reading must equal the host's totals record: the table
prints it as `host totals check`, and a measured session that fails it is not a measurement.

## Known limits

- Moments are inferred from the order of calls and the `next:` and `skipped:` lines; they are the
  part most likely to need care after an engine change. Neither transcript says whether a step is
  a gate, a task or a sub-run.
- Generation time on Claude Code needs the `api-request` records, which are not a documented part
  of the transcript. Without them the start falls back to the previous record's time and
  `start_source` says so; without `cost-state` the totals check says the transcript holds none.
- "Calls overlapped" means a later call of one response began before an earlier one returned.
  Copilot records when each call started running, so there it is a real overlap. Claude Code
  records when a call was issued and when its result came back, so there it can also be a batch
  that ran one after another.
- The whole file is read into memory; a transcript of several hundred megabytes needs a streaming
  reader.
- No money figure: prices differ by plan and date.
