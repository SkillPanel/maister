# The engine-turn benchmark's story

`story/` holds a small project workflow written to cost as few turns as possible outside the
engine's own calls, so a change to how a session drives the engine shows in what a run costs.
`tools/engine-turns.mjs` measures the transcripts a run leaves (`tools/engine-turns.md`).
`tests/engine/turn-cost-story.test.mjs` validates both definitions on every `make test`; nothing
here is installed anywhere or run by the suite.

| File | What it is |
|---|---|
| `story/turn-cost-story.yml`, `.md` | The parent: `intake`, `context` (guarded), `locate` (one Explore delegate), the gate `locate-approval`, `checks` (`agent:test-suite-runner`), the gate `checks-approval` (guarded), `probe` (a sub-run of the child), `wrap` |
| `story/turn-cost-probe.yml`, `.md` | The child: `probe`, the gate `settle` (its answer sets `settled`, which the parent reads), `wrap-up` (skipped when embedded) |

`context` and `checks-approval` are guarded on the `extras` input, false unless given, so every run
crosses a step and a gate the engine leaves off the path. The guard reads an input, so the
skip-guard rule never asks the gate.

## Running it

1. **A seed project**: a clone of one commit of a small repository with a fast test suite, its
   remote removed. Copy the four files of `story/` into its `.maister/workflows/`.
2. **The plugin, named by directory**, never the installed one:
   - Claude Code: `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 claude --plugin-dir <repo>/plugins/maister --setting-sources project,local --model <full model id> --session-id <uuid>`.
     Without the variable the host titles the session with a background model call that its
     totals count and no transcript holds, so the host totals check fails on every session.
   - Copilot CLI: build the variant (`bash platforms/copilot-cli/build.sh --out <dir>/copilot`),
     then `COPILOT_PLUGIN_DIR_ONLY=true copilot --plugin-dir <dir>/copilot --add-dir <dir>/copilot --model <full model id>`,
     with the session id chosen beforehand.
3. **Start it** in that session: `/maister:run turn-cost-story topic=<one fixed topic>`.
4. **Answer the same way each run**: `continue-to-checks` at `locate-approval`, `settle-findings` at
   the child's `settle` — these two even when the gate recommends another option, which a model
   sometimes does; the recommended option at any other question. A gate asked in the terminal
   needs an interactive session (print mode has no question tool on either host), driven by a
   terminal multiplexer script that picks those two options by their labels and otherwise the
   recommended one.
5. **The interruption**, when the run is to cover a resume: end the session after
   `locate-approval` is answered, start a new one and run `/maister:run <task folder>`.
6. Keep fixed between runs: the plugin directory, the model id, the permission mode, the seed
   commit, the topic, the answers and the point of the interruption. Compare per moment, by
   median over at least five runs per host.

## Where the transcripts are

| Host | Transcript |
|---|---|
| Claude Code | `~/.claude/projects/<project folder>/<session id>.jsonl`, with `<session id>/subagents/` beside it |
| Copilot CLI | `~/.copilot/session-state/<session id>/events.jsonl` |

A resumed run leaves one transcript per session; give each its own label.

## Measuring

```
node tools/engine-turns.mjs measure --json=<variant>-<n>.json driver=<transcript> [resumed=<transcript>]
node tools/engine-turns.mjs compare <baseline>-<n>.json <variant>-<n>.json
```

The `host totals check` line must read `every token kind matches` for every measured session.
Reports and transcripts stay outside the repository: a transcript holds paths and prompts.
