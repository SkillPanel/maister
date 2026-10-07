# Contributing

## License

This project is MIT-licensed (see `LICENSE`). Contributions are accepted under the same
license as the project — inbound = outbound. There is no CLA, and there has been a single
author to date.

## Making a change

1. Make your change under `plugins/maister/` (or the relevant top-level directory — never
   edit `plugins/maister-copilot/` by hand; it is generated).
2. `make build` — regenerate `plugins/maister-copilot/` from `plugins/maister/`.
3. `make validate` — lint the generated variant and the plugin source.
4. `make test` — run the engine verb suite (`tests/`). Needs Node 20 or newer and nothing
   installed.
5. `make test-mod` — when you change `hooks/display.mjs` or its contract in `types/`: the
   Claude Code CLI validates the plugin and runs the hooks module's tests (`tests/mod/`).
   Skipped where the `claude` CLI is not installed.
6. Commit the source change and the regenerated `plugins/maister-copilot/` output together.

`make validate` checks that every command `hooks.json` names resolves on disk and that the
committed generated variant matches a fresh `make build` byte for byte, plus the flat-command,
no-colon, picker-rendering and plugin-root-vocabulary lints.

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
