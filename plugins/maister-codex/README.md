# Maister for Codex

Maister provides Codex-native, standards-aware workflows for software delivery. It preserves resumable task artifacts, explicit approval gates, test-first implementation, focused verification, and user-confirmed rollback while leaving the Claude Code source package untouched.

## Workflows

- `$maister-codex:maister-work` classifies and routes software tasks, including resumes from existing `.maister/tasks/` directories.
- `$maister-codex:maister-development`, `$maister-codex:maister-performance`, `$maister-codex:maister-migration`, `$maister-codex:maister-research`, and `$maister-codex:maister-product-design` run full resumable workflows.
- `$maister-codex:maister-quick-dev`, `$maister-codex:maister-quick-plan`, and `$maister-codex:maister-quick-bugfix` handle focused work.
- `$maister-codex:maister-codebase-analysis`, `$maister-codex:maister-implementation-plan-executor`, `$maister-codex:maister-verify`, and `$maister-codex:maister-mockup-studio` provide reusable workflow stages.
- `$maister-codex:maister-reviews-code`, `$maister-codex:maister-reviews-pragmatic`, `$maister-codex:maister-reviews-production-readiness`, `$maister-codex:maister-reviews-reality-check`, and `$maister-codex:maister-reviews-spec-audit` provide focused read-only reviews.
- `$maister-codex:maister-init`, `$maister-codex:maister-docs-manager`, `$maister-codex:maister-standards-discover`, and `$maister-codex:maister-standards-update` initialize and maintain project guidance.

The plugin bundles Playwright MCP for browser verification, mockups, and screenshot-backed documentation. It also includes Node-based lifecycle hooks: reminders for explicit skill invocation and state recovery after compaction, plus a PreToolUse guard that denies destructive shell commands (`git stash`, `git reset --hard`, `git clean`, force-push, `rm -rf`) from non-whitelisted subagents so parallel implementers cannot clobber each other's work. Codex asks you to review and trust plugin hooks before they run. Node.js is required for hooks, the HTML mockup companion, and Playwright MCP; no separate `jq` or Bash dependency is used.

## Specialist agents

`$maister-codex:maister-init` can copy 25 optional specialist templates into the current repository's `.codex/agents/` directory. This is the Codex-native distribution path for project-scoped custom agents; installing the plugin alone does not modify a repository's agent configuration. Existing templates are preserved unless you explicitly approve replacement. Maister workflows delegate to these agents by name when they are installed (for example `maister-task-group-implementer` during implementation waves, `maister-code-reviewer` during verification) and fall back to inline execution when they are absent.

## Installation

Install directly from GitHub:

```bash
codex plugin marketplace add SkillPanel/Maister
codex plugin add maister-codex@maister-plugins
```

Add `--ref <branch>` to install from a branch instead of the default one.

## Local testing

Register a local checkout as a marketplace, then install the plugin:

```bash
codex plugin marketplace add /absolute/path/to/Maister
codex plugin add maister-codex@maister-plugins
```

Codex reads the native catalog at `.agents/plugins/marketplace.json` (named `maister-plugins`), which lists only the Codex package; `.claude-plugin/marketplace.json` remains the Claude Code / Copilot catalog. Start a new Codex thread after installation, then invoke a skill with `$maister-codex:maister-init` or `$maister-codex:maister-work`.

Use `/hooks` to review bundled hooks and `/mcp verbose` to confirm the Playwright server. The first Playwright use may require `npx` to download `@playwright/mcp` under the active sandbox and network policy.
