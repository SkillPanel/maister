<div align="center">

# Maister

**Structured, standards-aware development workflows for Claude Code**

Describe what you want to build, and the plugin handles the rest - from specification through implementation to verification - while enforcing your project's coding standards at every step.

</div>

## What You Get

- **Guided workflows** for features, bug fixes, enhancements, performance, migrations, research, and product design
- **Auto-discovered standards** from your codebase - config files, source patterns, and documentation are analyzed and enforced throughout every workflow
- **Test-driven implementation** with automated planning, incremental verification, and full test suite runs before completion
- **Pause and resume** any workflow - state is preserved across sessions
- **Production readiness checks** including code review, reality assessment, and pragmatic over-engineering detection

## Getting Started

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI installed and configured — version 2.1.233 or newer (or GitHub Copilot CLI 1.0.80+ with the `maister-copilot` variant)
- `jq` on `PATH` — used by the destructive-command guard
- Node.js 20 or newer — the plugin registers its gate hook for every session, so Node is required wherever the plugin is installed, not only in chain mode; without it a terminal session prints a non-blocking hook error on each mutating tool call and loses nothing else (a terminal operator answers gates in-session, so there is nothing there to enforce), while chain-mode gate enforcement, `make test`, `make eval` and HTML mockups need it outright

### Installation

```bash
/plugin marketplace add SkillPanel/maister
/plugin install maister@maister-plugins
```

After installing, restart Claude Code (`/exit` and relaunch) to ensure the plugin is fully loaded.

### Initial project setup

Initialize your project to auto-detect coding standards and generate project documentation:

```bash
/maister:init
```

This scans your codebase and creates `.maister/` with standards, docs, and task folders. May take a few minutes on larger projects.

If you have another project already using Maister, you can reuse its standards as a starting point:

```bash
/maister:init --standards-from=/path/to/other-project
```

### First Workflow

```bash
/maister:development Add user profile page with avatar upload
```

Or just discuss your task with Claude and then run:

```bash
/maister:development
```

The plugin picks up context from your conversation - no arguments needed.

## How It Works

1. You describe a task - either as an argument or just in conversation
2. The plugin classifies it (feature, bug, enhancement, etc.) and proposes a workflow
3. You confirm, and it guides you through phases: **requirements → spec → plan → implement → verify**
4. At each phase, it asks for your input and decisions
5. You get tested, verified code with a detailed work log

All artifacts are saved in `.maister/tasks/` organized by type and date.

### Context-Aware Commands

Every workflow command works without arguments. The plugin reads your current conversation to extract the task description and auto-detect the task type:

```
You: "The login page throws a 500 error when the session expires"
You: /maister:development
→ Auto-detects: bug fix, extracts description from conversation
```

```
You: /maister:standards-update
→ Scans conversation for patterns like "we always use..." or "prefer X over Y"
```

You can always be explicit when you prefer - arguments and flags simply override the auto-detection.

## Supported Workflows

| Command | Use When |
|---------|----------|
| `/maister:development` | Features, bug fixes, enhancements |
| `/maister:research` | Research with synthesis and solution design |
| `/maister:performance` | Optimizing speed or resource usage |
| `/maister:migration` | Changing technologies or patterns |
| `/maister:product-design` | Product and feature design |

Task type (feature/bug/enhancement) is auto-detected from context. Override with `--type=feature|bug|enhancement` if needed. Or use `/maister:work` as a single entry point that routes to the right workflow.

### Quick Commands

For smaller tasks that don't need a full workflow:

| Command | Use When |
|---------|----------|
| `/maister:quick-plan` | You want a plan with standards awareness before coding |
| `/maister:quick-dev` | You know what to do - just implement with standards applied |
| `/maister:quick-bugfix` | Quick TDD-driven bug fix — write failing test, fix, verify |

## Standards-Aware Development

This is the key differentiator. Maister doesn't just run workflows - it learns your project's conventions and enforces them:

- **`/maister:init`** scans config files, source code, and documentation to auto-detect your coding standards
- **Continuous checking** - standards are consulted before specification, during planning, and while coding (not just at the start)
- **`/maister:standards-discover`** refreshes standards from your evolving codebase
- **`/maister:standards-update`** lets you add or refine standards manually, or sync from another project with `--from=PATH`

Standards live in `.maister/docs/standards/` and are indexed in `.maister/docs/INDEX.md`.

**Important**: Run workflows with **auto-accept edits** enabled. Do not use Claude Code's plan mode with workflows (see [Best Practices](#best-practices) below).

## Gate hooks (chain mode)

When a workflow pauses at a gate, the plugin's `PreToolUse` hook refuses every other write until the decision is recorded — so a paused run cannot quietly carry on. In ordinary terminal sessions this needs no setup: the hook ships with the plugin and allows instantly whenever nothing is pending.

Chain mode — a run driven headlessly and resumed from outside the terminal — needs two more hooks (a stop nudge and a liveness beacon), and those are registered per session rather than by the plugin.

**Claude Code.** Pass the settings template on every spawn *and* every resume; nothing about it persists inside a session. Replace `__PLUGIN_ROOT__` in `platforms/claude-code/gate-hooks.settings.json` with the installed plugin directory, then:

```bash
claude -p "<prompt>" --resume <session> --settings /path/to/gate-hooks.settings.json
```

**Copilot CLI.** Copilot resolves hooks from your own repository, never from `--plugin-dir`. Copy the generated variant's `.github/hooks/` into the git root Copilot runs in, or into `~/.copilot/hooks/` if the repository must stay untouched — the user-hooks copy needs its script directory rewritten, as its own `README.md` explains. Repository hooks are silently inert in headless `-p` mode unless the folder is trusted or the environment carries:

```bash
GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true copilot -p "<prompt>"
```

There is no flag for it — the variable has to be in the environment. Hooks under `~/.copilot/hooks/` always fire and need no opt-in.

**Checking that they are live.** The beacon writes one marker per session to `$MAISTER_BEACON_DIR`, or to `~/.maister-cockpit/beacons/` when that is unset — never inside your project. No marker means the hooks are not running here: Node missing, files not installed, or the Copilot variable not passed through.

**Environment variables.** Both are optional and read by the hooks at spawn time; neither has a flag.

| Variable | Effect |
|---|---|
| `MAISTER_BEACON_DIR` | Where the liveness marker for the session is written. Default `~/.maister-cockpit/beacons/`, falling back to a temp directory when home is unwritable. Never the working directory — a per-session file in a tracked tree would show up in every `git status`. |
| `MAISTER_GATE_TRACE` | Path to a file that gets one JSON line per hook decision (tool, decision, reason, exit, timing). Off by default; this is the first thing to turn on when a gate allows or denies something you did not expect. |

### Compatibility floor

The on-disk shapes are frozen for **task directories written by plugin 2.2.3 or newer**. Anything older is listed by directory name, date and type only — never parsed, rendered from its state, or resumed. There is no migration step and nothing to do: finished task directories are reference material, and a run that predates the floor was finished long before you upgraded. The normative register of every frozen shape, and the rules for changing one, is [`compatibility-contracts.md`](plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md).

## Beta Channel

Want to try experimental features before they hit stable? Install from the beta channel:

```bash
# Add the beta marketplace
/plugin marketplace add SkillPanel/Maister#beta

# Install the beta plugin
/plugin install maister@maister-plugins-beta
```

If you already have the stable version installed, uninstall it first to avoid conflicts:

```bash
/plugin uninstall maister@maister-plugins
```

To switch back to stable:

```bash
/plugin uninstall maister@maister-plugins-beta
/plugin install maister@maister-plugins
```

Beta versions may contain features that are not yet fully tested. Use at your own discretion.

## Best Practices

**Don't use plan mode when starting a workflow.** Planning is a built-in part of every workflow — the orchestrator creates specs, plans, and other files as it goes. Claude Code's plan mode restricts file creation, which conflicts with this. Let the workflow handle planning on its own.

**Start workflows in a fresh session.** This is especially useful when chaining workflows (e.g., research → development). Research and product-design artifacts already contain all the context needed, so a clean session avoids noise from prior conversation.

**Chain workflows by passing a task folder.** If you've completed a research or product-design workflow and want to build on those results, pass the task folder directly:

```bash
/maister:development .maister/tasks/research/2026-01-12-oauth-research
```

You can also append additional instructions to narrow scope or guide the workflow:

```bash
/maister:development .maister/tasks/product-design/2026-03-10-dashboard-redesign Implement only phase 1
```

## Known Issues

**Orchestrator may stall after long phases.** After context compaction (which typically happens after lengthy phases like implementation), the main agent may stop progressing automatically. If you notice it's idle, just type something like "continue" or "proceed" — it will pick up where it left off. You can also re-invoke the workflow in resume mode to reload the orchestrator state:

```bash
/maister:development .maister/tasks/development/2026-03-24-my-feature
```

## Watching and driving runs from a browser

The plugin runs workflows in one repository at a time, in your terminal. The
**[maister cockpit](https://github.com/SkillPanel/maister-cockpit)** is its companion: a local daemon
plus a browser tab that watches those runs live, starts and steers provider sessions, and drives
multi-repository chains across an umbrella workspace.

```sh
npx maister-cockpit
npx maister-cockpit repo add /absolute/path/to/your/repo
```

It runs entirely on your machine and never writes into a repository you register unless you opt into
chain driving. Its [quickstart](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/quickstart.md)
picks up where this README leaves off — install, `/maister:init`, a first workflow, then the cockpit
beside it — and continues into umbrella workspaces and chains.

| To | See |
|---|---|
| Watch a run you started in a terminal | [Cockpit README](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/README.md) |
| Turn a workspace into an umbrella (`/maister:umbrella init`, then `validate`) and author a chain | [Umbrellas and chain files](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/umbrellas.md) |
| Understand what an autonomy tier actually enforces | [Autonomy tiers and permissions](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/autonomy.md) |

## Learn More

- [Workflow Details](docs/workflows.md) - phases, examples, and task structure for each workflow type
- [Full Command Reference](docs/commands.md) - all workflow, review, utility, and quick commands
- [Decision Log](docs/decisions/README.md) - the ADRs behind the gate protocol, the coordination shapes, and the compatibility floor
- [Compatibility Contracts](plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md) - the normative register of every on-disk shape, and the rules for changing one
- [Cockpit quickstart](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/quickstart.md) - the browser-side path, from a first workflow to a chain across repositories
