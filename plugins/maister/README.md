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

Workflows pause at checkpoints for your decisions and save their state in the task folder under `.maister/tasks/`. To resume one, pass its task folder to the same command, for example `/maister:development .maister/tasks/development/2026-01-12-profile-page`; the run picks up from its saved state. Task folders created by Maister 2.x are not resumed.

## Commands

| Command | Use When |
|---------|----------|
| `/maister:work` | Single entry point: classifies the task and routes to the right workflow |
| `/maister:development` | Features, bug fixes, enhancements, refactors |
| `/maister:research` | Research with synthesis and solution design |
| `/maister:performance` | Finding and fixing performance bottlenecks |
| `/maister:migration` | Changing technologies, platforms, or architecture patterns |
| `/maister:product-design` | Turning a fuzzy idea into a product brief and prototypes |
| `/maister:run` | Starting or resuming a workflow by name, including ones your project defines |
| `/maister:workflow-author` | Writing your project's own workflows or overlays of a built-in one |
| `/maister:umbrella` | Setting up and validating a workspace of several repositories |
| `/maister:quick-plan` | A plan with standards awareness before coding |
| `/maister:quick-dev` | Implementing directly with standards applied |
| `/maister:quick-bugfix` | TDD-driven bug fix: failing test, fix, verify |
| `/maister:mockup-studio` | UI mockups bound to your project's design language |
| `/maister:init` | Setting up Maister in a project |
| `/maister:standards-update` | Adding or changing standards from conversation context |
| `/maister:standards-discover` | Re-scanning the project for standards |
| `/maister:reviews-code` | Code quality, security, and performance review |
| `/maister:reviews-pragmatic` | Checking for over-engineering against the project's scale |
| `/maister:reviews-production-readiness` | Deployment readiness check |
| `/maister:reviews-reality-check` | Checking that finished work actually solves the problem |
| `/maister:reviews-spec-audit` | Auditing a specification before implementation |

## Requirements

- **Node.js 20 or newer** is required. Every workflow runs on the workflow engine, which needs it; without Node.js, a workflow command stops before it creates a task folder and says why.
- **`jq`** on `PATH`. The destructive-command guard uses it to judge a subagent's shell commands, and denies them all without it.
- **Playwright MCP** is bundled (`.mcp.json`, pinned version) and starts locally via `npx`, so it is available in Claude Code but not on claude.ai on the web. It drives the optional browser steps of the development workflow, browser checks and user documentation with screenshots, which you switch on when verification options are offered, and opens the HTML mockup gallery. Without a browser, mockups can be produced as ASCII instead, and the browser steps are left off.

## Hooks

The plugin registers four hooks. None of them sends data anywhere:

- **SessionStart**: injects a short reminder to run `/maister:*` commands through their skill and to ask at every workflow checkpoint.
- **SessionStart (after compaction)**: when the project has `.maister/tasks/`, reminds Claude to re-read the active workflow's `orchestrator-state.yml` so a long workflow resumes at the right step.
- **SessionStart (edition check)**: warns when two editions of the plugin are enabled at once. It reads local settings only.
- **PreToolUse (Bash)**: blocks destructive commands (`git stash`, `git reset --hard`, `git checkout .`, `git clean`, `git push --force`, `rm -rf`) from subagents that should not run them. Your own commands in the main session are left to Claude Code's permission system.

A Pro Edition, for driven sessions and multi-repository work, installs from a private marketplace; see the repository README.

## Learn More

Full documentation, workflow details, and the command reference: https://github.com/SkillPanel/maister
