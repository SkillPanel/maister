# Maister Codex plugin guidance

This directory is the Codex-native Maister plugin. Preserve the workflow principles from `plugins/maister/`: standards awareness, explicit phase gates, user-confirmed rollback, focused verification, and resumable task artifacts. Do not add Claude-only tool directives or treat `plugins/maister-copilot/` as a source.

Use skills for reusable workflows and compose them by loading the named skill and following its instructions. Use Codex subagents only when the user, repository guidance, or the active skill explicitly requests delegation. Keep durable project guidance in `AGENTS.md`; keep workflow state under `.maister/tasks/`.

At a required user decision gate, prefer `request_user_input` when available. Otherwise ask the equivalent concise question in the final response and pause. Use execution approval only for sensitive tool actions, never as a substitute for a product, scope, design, or workflow choice. Never infer approval for rollback, destructive recovery, scope expansion, or acceptance of critical findings.

Codex custom agents are project-scoped, not plugin components. Maintain their distributable templates under `skills/maister-init/assets/agents/`; `$maister-codex:maister-init` copies selected templates into a project's `.codex/agents/` without replacing existing files unless the user approves it.

Keep plugin lifecycle hooks in `hooks/hooks.json`, which Codex discovers by default. Hook commands are inlined with `node --input-type=module -e` because plugin-root path variables are not reliably expanded across harnesses. Edit the readable `hooks/*.mjs` sources, then run `node scripts/sync-codex-hooks.mjs --write` from the repository root; validation checks the generated commands for drift. Keep bundled MCP configuration in `.mcp.json` and declare it through `mcpServers` in `.codex-plugin/plugin.json`. The current repository validator does not accept a manifest `hooks` field, so do not add one while the default hook path is used.

Keep skills focused and self-contained. Put detailed reusable guidance in `references/`, deterministic helpers in `scripts/`, and templates in `assets/`; do not create a `README.md` inside a skill folder. Validate every changed skill and the plugin before handoff.
