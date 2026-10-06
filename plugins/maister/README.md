# Maister

Structured, standards-aware development workflows for Claude Code. Describe what you want to build, and Maister guides it from requirements through specification, planning, and implementation to verification, applying your project's coding standards at every step.

## Getting Started

1. Initialize your project. This scans the codebase and creates `.maister/` with detected standards, project docs, and task folders:

   ```bash
   /maister:init
   ```

2. Start a workflow:

   ```bash
   /maister:development Add user profile page with avatar upload
   ```

   Every workflow command also works without arguments: it picks up the task from your conversation.

Workflows pause at phase gates for your decisions, save their state in `.maister/tasks/`, and can be resumed later by passing the task folder path.

## Commands

| Command | Use When |
|---------|----------|
| `/maister:work` | Single entry point: classifies the task and routes to the right workflow |
| `/maister:development` | Features, bug fixes, enhancements |
| `/maister:research` | Research with synthesis and solution design |
| `/maister:performance` | Optimizing speed or resource usage |
| `/maister:migration` | Changing technologies or patterns |
| `/maister:product-design` | Product and feature design |
| `/maister:quick-plan` | A plan with standards awareness before coding |
| `/maister:quick-dev` | Implement directly with standards applied |
| `/maister:quick-bugfix` | TDD-driven bug fix: failing test, fix, verify |
| `/maister:mockup-studio` | UI mockups bound to your project's design language |
| `/maister:standards-update` | Add or change standards from conversation context |
| `/maister:standards-discover` | Re-scan the project for standards |
| `/maister:reviews-code` | Code quality, security, and performance review |

## Requirements

- **Node.js 20 or newer** (optional) for HTML mockups and the bundled Playwright MCP server. Without Node.js, mockups fall back to ASCII.
- **Playwright MCP** is bundled (`.mcp.json`, pinned version) and used only by the optional browser steps: runtime E2E verification (`--e2e`) and user documentation with screenshots (`--user-docs`). It starts locally via `npx`, so it is available in Claude Code but not on claude.ai on the web.

## Hooks

The plugin ships three hooks. None of them sends data anywhere:

- **SessionStart**: injects a short reminder to run `/maister:*` commands through their skill and to stop at workflow phase gates.
- **SessionStart (after compaction)**: reminds Claude to re-read the active workflow's `orchestrator-state.yml` so a long workflow resumes at the right phase.
- **PreToolUse (Bash)**: blocks destructive commands (`git stash`, `git reset --hard`, `git checkout .`, `git clean`, `git push --force`, `rm -rf`) from subagents that should not run them.

## Learn More

Full documentation, workflow details, and the command reference: https://github.com/SkillPanel/maister
