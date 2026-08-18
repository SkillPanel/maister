# Maister repository guidance

This repository contains workflow plugins. Treat `plugins/maister/` as the Claude Code source and `plugins/maister-copilot/` as generated output; never edit the generated Copilot package directly.

The Codex port lives in `plugins/maister-codex/`. Keep it Codex-native: use `AGENTS.md` for durable project instructions, skills for reusable workflows, and `.codex/agents/*.toml` for project-scoped specialist subagents. Do not add Claude-only tool directives such as `AskUserQuestion`, `TaskCreate`, or `TaskUpdate` to the Codex port.

## Versioning

Releases keep all manifests at the same version (see `CLAUDE.md` "Beta Branch Management" for the branch workflow). Four manifests carry the version:

- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json` (Codex-native catalog; lists `maister-codex` only, no version field)
- `plugins/maister/.claude-plugin/plugin.json`
- `plugins/maister-copilot/.claude-plugin/plugin.json`
- `plugins/maister-codex/.codex-plugin/plugin.json`

## Validation

Run `make validate` (includes `validate-codex`) before handoff. Additionally validate with the local Codex tooling when available (path is machine-specific):

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/maister-codex
```

Validate every changed skill with:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py <skill-directory>
```
