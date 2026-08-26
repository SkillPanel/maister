# Gate eval harness

The contract suite (`make test`) proves the gate hook decides correctly when it is handed
a payload. This harness proves the other half: that a **real provider session, driven by a
real model, cannot walk past a pending gate** — and that the same session without the hook
can. That pair of runs is the whole point; a passing hooked run means nothing unless the
`--no-hooks` control run fails in exactly the way the hook is supposed to prevent.

It is local only. It spawns authenticated CLIs and spends money, so it never runs in CI and
`make eval` never appears in a workflow file.

## Prerequisites

- An authenticated `claude` CLI (≥ 2.1.233) and an authenticated `copilot` CLI (≥ 1.0.80) on
  `PATH`. The harness never logs either in; if a spawn fails on credentials it says so.
- Node ≥ 20 and `git` on `PATH`. `npm ci` once, for the `yaml` dev dependency the harness
  uses to read state files.
- Budget roughly **$4-5** for a full two-provider run and 15-20 minutes of wall clock at `--jobs=2`
  (measured: 23 cases, 876 s, $3.74 on the Claude side; Copilot reports no cost).

## Running

```bash
make eval EVAL_ARGS="--provider=claude --scenario=beacon"   # one scenario, one provider
make eval EVAL_ARGS="--provider=both --scenario=all"        # the full run
make eval EVAL_ARGS="--scenario=adversarial --no-hooks"     # the control run on its own
node scripts/eval-gates.mjs --list                          # what the scenarios are
```

| Flag | Meaning |
|---|---|
| `--provider=claude\|copilot\|both` | Which CLIs to spawn. Default `both`. |
| `--scenario=<id>\|all` | Which scenario files to run. Default `all`. |
| `--model=<id>` | Override the model for every provider. |
| `--claude-model=<id>`, `--copilot-model=<id>` | Per-provider override. Defaults: `sonnet`, `claude-sonnet-4.6`. |
| `--no-hooks` | Run the **control**: no hook registration reaches the session. |
| `--keep` | Keep the temporary case directories instead of removing them. |
| `--jobs=<n>` | Cases in flight at once. Default 1. |
| `--timeout=<seconds>` | Per-turn cap. Default 180. |
| `--list` | Print the scenario table and exit. |

Exit code: non-zero when any **scored** case fails. Probes and the one best-effort scenario
are reported and never fail the run.

## What `--no-hooks` means

Everything about the case is identical except the registration:

| Provider | Hooked | `--no-hooks` |
|---|---|---|
| Claude Code | `--settings <case>/gate-hooks.settings.json` (the tracked template with `__PLUGIN_ROOT__` resolved) | no `--settings`, no `--plugin-dir` |
| Copilot CLI | the six files copied into `<case>/.github/hooks/` and `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` in the environment | hooks not copied, the variable unset |

**`--no-hooks` removes this harness's registration, not every registration.** The lane keeps
the operator's own `HOME`, so anything installed in `~/.claude/settings.json` or
`~/.copilot/hooks/` still fires in the control run — including a Maister gate hook the
operator installed for their own use. A control that mysteriously behaves like the hooked
run is that, not a broken hypothesis; check the user-level registrations before reading
anything into it. Only the `copilot-user-hooks` variant builds a private `HOME` (below),
and it does so to *add* a registration rather than to isolate one. Isolating `HOME` for the
whole lane would also cut off the credentials both CLIs read from it, so it is not a
one-line change and is deliberately not done.

## A case

Each case is a throwaway git repository in a temp directory — `git init`-ed because Copilot
resolves `$COPILOT_PROJECT_DIR` to the git root — seeded with one run under
`.maister/umbrella/runs/<run_id>/` from `fixtures/contracts/synthetic/gate/`, with the E1
driver's `cwd`, `provider` and `model` rewritten to match the case. Every spawn exports
`MAISTER_BEACON_DIR` and `MAISTER_GATE_TRACE=<case>/trace.jsonl`. The
directory is removed with `fs.rmSync` when the case ends, unless `--keep` is passed.

`MAISTER_BEACON_DIR` points at a *sibling* temp directory, not at one inside the case: the
session-start hook refuses a beacon directory that resolves under the working directory and
falls back to `~/.maister-cockpit/beacons`, which would write into the operator's real home.
It is removed with the case.

The outcome of a case is read the way contract C5 says and no other way: **on-disk E2 state
first, the last non-empty assistant line second, recorded denials third. The process exit
code is never consulted** — both providers exit 0 for a failed run, a denied tool and a
blocked stop.

## Results

```
eval/results/<utc-timestamp>/
  summary.md
  <provider>/<scenario>[--no-hooks][--variant]/
    prompt.txt          every turn's prompt, engine prompt included
    result.json|jsonl   the provider's own output, one turn after another
    stderr.txt
    state-after.yml     orchestrator-state.yml as the process left it
    trace.jsonl         one line per hook decision (MAISTER_GATE_TRACE)
    beacon.json         the session's liveness marker, when one was written
    verdict.json        every predicate, its result and the facts behind it
```

`eval/results/` is git-ignored. Nothing under it is ever committed: it carries session ids,
absolute paths and provider output.

`summary.md` tabulates scenario × provider × hooked/`--no-hooks` → pass/fail, wall seconds,
hook p50/p95 and cost. Hook latency is the in-hook time from the trace, **deduplicated by
`tool_use_id`** — in chain mode the hook is registered twice (plugin `hooks.json` plus
`--settings`) and fires twice per call. It excludes the Node cold start, which the provider
absorbs and the trace cannot see.

## Scenarios

A scenario is one JSON file in `scenarios/`. The fields:

| Field | Meaning |
|---|---|
| `id` | Must match the filename. |
| `providers` | `claude`, `copilot` or `both`. |
| `seed` | `chain-template`, `pending`, `running-no-request` or `block-form`. |
| `engine_prompt` | `false` drops the engine stand-in prompt from turn 1. |
| `turns[]` | One prompt each; turn 1 spawns, the rest resume. `{RUN_ID}` and `{NOW}` are substituted. |
| `pass[]` | The predicates. A predicate marked `"advisory": true` is reported but cannot fail the case. |
| `pass_control[]` | The predicates for the `--no-hooks` run of the same scenario. |
| `control` | `true` also runs the `--no-hooks` control automatically. |
| `variants[]` | Extra spawn shapes, e.g. `copilot-user-hooks`. |
| `probe` / `soft` | Reported, never failed. |
| `strip_node` | Remove every `node` from the child's `PATH`. |
| `spawn` | `settings: false` and `plugin_dir` for the two probes. |

Predicates are names in the harness's `CHECKS` table — 24 of them, in source order:
`last_line_matches`, `file_exists`, `file_absent`, `request_unanswered`,
`request_answered`, `state_gate_pending_node`, `state_gate_pending_one_line`,
`node_status`, `node_decision_option`, `dashboard_rewritten`, `denial_count`,
`state_unchanged_between`, `trace_fail_closed`, `trace_block_count`, `wall_lt`,
`beacon_present`, `beacon_absent`, `beacon_field`,
`no_writes_under_maister_beyond_seed`, `classification`, `provider_ran`,
`stop_nudge_resolved`, `fail_closed_consistent`, `first_mutating_allowed`. The table in
`scripts/eval-gates.mjs` is the authority; regenerate this list with:

```bash
node --input-type=module -e "
  import fs from 'node:fs';
  const body = fs.readFileSync('scripts/eval-gates.mjs', 'utf8').split('const CHECKS = {')[1];
  const names = [...body.matchAll(/^  ([a-z_]+): /gm)].map(m => m[1]);
  console.log(names.length, names.join(', '));
"
```

`engine-prompt.md` is the workflow-engine stand-in the chain scenarios run under. It is not
the product engine — it exists so a model has a protocol to follow and a marker vocabulary
to end its turn with, which is what makes the on-disk outcome checkable.

## The `copilot-user-hooks` variant

The `beacon` scenario is repeated with the registration installed in `~/.copilot/hooks/`
instead of the repository, which is the variant that fires with no opt-in variable. The
harness builds a private `HOME` for that case: everything in the real home is symlinked
through, so credentials and settings still resolve, and only `~/.copilot/hooks/` is a real
directory holding the rewritten registration. Nothing is installed into the machine's home.
