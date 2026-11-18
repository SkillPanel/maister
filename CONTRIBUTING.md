# Contributing

## License

This project is MIT-licensed (see `LICENSE`). Contributions are accepted under the same
license as the project — inbound = outbound. There is no CLA, and there has been a single
author to date.

## Making a change

1. Make your change under `plugins/maister/` (or the relevant top-level directory). The Copilot
   CLI build is generated from it and never committed.
2. `make build` — regenerate `plugins/maister/interface.json` and build the Copilot CLI variant
   into `dist/copilot/`, which git ignores.
3. `make validate` — build the variant afresh, then lint it and the plugin source.
4. `make test` — run the engine verb suite (`tests/`). It builds its own copy of the variant
   first. Needs Node 20 or newer and nothing installed.
5. `make test-mod` — when you change `hooks/display.mjs` or its contract in `types/`: the
   Claude Code CLI validates the plugin and runs the hooks module's tests (`tests/mod/`).
   Skipped where the `claude` CLI is not installed.
6. Commit the source change, with `plugins/maister/interface.json` when `make build` changed it.
   Nothing under `dist/` is committed: CI publishes the Copilot build to the `dist/beta` and
   `dist/stable` branches.

`make validate` checks that every command `hooks.json` names resolves on disk and that the
marketplace files agree on the marketplace name and version, plus the flat-command,
no-colon, picker-rendering and plugin-root-vocabulary lints, and the guide template lint
(`tests/guide-template-lint.mjs`), which holds every workflow guide to the step template's
structure, and the frontmatter lint (`tests/frontmatter-lint.mjs`), which holds every skill,
agent and command frontmatter to valid YAML.

`make test` runs the workflow engine's verbs the way a driver runs them — `validate`,
`resolve`, `write-state` (the freeze, merges and refusals), the dashboard projection, a gate
suspended and answered, a sub-run waited on and adopted, `run-complete` and `sync-plan` —
against committed fixtures under `tests/fixtures/`, each test in its own scratch copy. It uses
Node's built-in test runner only. Keep tests and fixtures under `tests/`, never under
`plugins/`: the Copilot build copies the plugin directory whole. A change to an engine script
should arrive with a test here that fails without it.

## Scope

This file covers the contribution loop only. It does not enumerate skills, agents, or
commands — those are self-describing via frontmatter; see `CLAUDE.md` for how the
repository is laid out. It does not describe runtime behavior either — that lives in each
skill's `SKILL.md` and in the agent files under `plugins/maister/agents/`.
