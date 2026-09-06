---
name: maister-init
description: Initialize or refresh Maister project documentation, configuration, baseline and discovered standards, AGENTS.md guidance, task directories, project documents, and optional Codex specialist templates. Use when setting up Maister or importing standards from another repository.
---

# Maister Init

Inspect the repository, build and test commands, existing documentation, `AGENTS.md`, `.codex/agents/`, and `.maister/`. If `.maister/` exists, show the difference and ask the user to choose update, timestamped backup, or stop using `request_user_input` when available; otherwise ask the same concise choice in the final response. Pause after the question. Never overwrite standards, guidance, configuration, or agents without approval.

Support `--standards-from=<path>` by validating `<path>/.maister/docs/standards/` and treating it as the baseline source. Otherwise use the bundled baseline shipped with `$maister-codex:maister-docs-manager` under its `assets/standards/{global,frontend,backend,testing}` (the single source of truth for baseline standards). Analyze the project type, stack, architecture, conventions, test setup, and relevant categories; present smart defaults and let the user correct the analysis or category selection.

## Initialize

1. Create `.maister/docs/project/`, `.maister/docs/standards/`, and `.maister/tasks/{development,performance,migrations,research,product-design,mockups}/`.
2. Create `.maister/config.yml` when absent with documented defaults `html_output: true` and `mockup_format: html`; preserve an existing file.
3. Select standards categories: `global` is recommended; select frontend, backend, testing, and custom categories from evidence. Never replace project standards silently.
4. Read the templates in `references/`. Always create `tech-stack.md`; offer vision, roadmap, and architecture according to project maturity and available evidence.
5. Load `$maister-codex:maister-docs-manager` to copy only the selected missing baseline categories from its `assets/standards/` (or the approved `--standards-from` source) and to generate `.maister/docs/INDEX.md` with practice-specific descriptions, links to every project document and standard, and placeholders for intentionally empty categories.
6. Create or update root `AGENTS.md`, starting from this skill's `assets/AGENTS.md` template, with durable build/test commands, documentation routing, generated-file rules, review expectations, standards evolution, artifact anchoring, and the prohibition on automatic rollback. Preserve unrelated instructions and resolve conflicts in favor of explicit user and repository rules.
7. Offer optional specialist templates from `assets/agents/` for `.codex/agents/`. Copy only missing files unless replacement was explicitly approved. Validate every selected TOML. Maister workflows delegate to these agents by name when installed (for example `maister-task-group-implementer`, `maister-code-reviewer`) and fall back to inline execution when they are absent.
8. Load `$maister-codex:maister-standards-discover --scope=full` and follow its source coverage contract, including `references/external-analyzer-prompt.md`. Forward original user exclusions without inventing new ones; apply only approved findings unless the user explicitly selected auto-apply.

Validate directory structure, INDEX links, configuration, project documents, standard content, AGENTS integration, and installed agents. Before marking initialization complete, inspect `analysis/standards-discovery.md`: every required source must be inspected, user-excluded, or unavailable with the evidence required by discovery. An agent's scope reduction or disclosure of an unchecked source cannot satisfy this gate. If coverage is pending, finish the missing checks or report initialization incomplete, distinguishing finished setup from unfinished discovery. Legitimate user exclusions and observed access failures allow completion with explicitly reported limitations, without asking for the same permission again. Report created, updated, skipped, preserved, and conflicted files plus recommended review/commit steps and discovery coverage.
