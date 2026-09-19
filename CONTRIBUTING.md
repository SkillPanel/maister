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
4. `make test` — run the compatibility contracts suite (schemas, fixtures, hook replay).
5. Commit the source change and the regenerated `plugins/maister-copilot/` output together.

`make eval` runs a local gate-hook evaluation against real provider CLIs; it spends money
and is never run in CI, so it isn't part of the standard loop above. See `eval/README.md`
if you're touching gate-hook behavior and need it.

## Scope

This file covers the contribution loop only. It does not enumerate skills, agents, or
commands — those are self-describing via frontmatter; see `CLAUDE.md` for how the
repository is laid out. It does not describe runtime behavior either — that lives in each
skill's `SKILL.md` and in the agent files under `plugins/maister/agents/`.
