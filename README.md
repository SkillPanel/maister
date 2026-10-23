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
- **Workflows you can extend** - write your own, adjust a built-in with an overlay, and run them like any other with `/maister:run`

## Getting Started

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI installed and configured — version 2.1.233 or newer (or GitHub Copilot CLI 1.0.100+ with the `maister-copilot` variant — see [Maister on GitHub Copilot CLI](docs/copilot.md))
- Node.js 20 or newer — required, with no fallback. Every workflow runs on the workflow engine, which needs it: without Node, a workflow command stops before it creates a task directory and says why. The plugin's hooks and HTML mockups need it too
- Optional: a browser tool, for browser checks, user documentation with screenshots and the mockup gallery — `playwright-cli`, a Playwright MCP server, Claude in Chrome or the Claude desktop app's built-in browser. Maister ships none; without one, those steps are offered without the browser

### Installation

```bash
/plugin marketplace add SkillPanel/maister
/plugin install maister@maister-plugins
```

After installing, restart Claude Code (`/exit` and relaunch) to ensure the plugin is fully loaded. To move to a newer version later, see [Upgrading](#upgrading).

On GitHub Copilot CLI, follow [Maister on GitHub Copilot CLI](docs/copilot.md), the guide to installing, running and troubleshooting the Copilot build. In short: install the `maister-copilot` variant with `copilot plugin install` — from a registered marketplace (`copilot plugin marketplace add SkillPanel/maister`, then `copilot plugin install maister-copilot@maister-plugins`) or straight from the repository subdirectory (`copilot plugin install SkillPanel/maister:plugins/maister-copilot`). To run a local checkout instead, load it with `copilot --plugin-dir /path/to/maister/plugins/maister-copilot`; add `--add-dir` for the same path when the checkout sits outside your working directory, which grants file access to it. `--add-dir` on its own does not load a plugin. The beta channel installs the same way from `SkillPanel/maister#beta` as `maister-copilot@maister-plugins-beta`.

**Copilot names the commands under the plugin.** Every command and workflow in this README is typed `/maister-copilot:<name>` on Copilot CLI, where Claude Code takes `/maister:<name>` — `/maister-copilot:development`, `/maister-copilot:init`, `/maister-copilot:reviews-code-risk`. A bare `/development` is reported as an unknown command.

**The plugin root is optional.** Several of the variant's skills — the workflow engine's among them — tell an agent to run a script under the plugin's own directory, spelled `${MAISTER_PLUGIN_ROOT}`. Nothing has to be set: Copilot CLI hands every skill its base directory, the agent builds the script's path from it, and the scripts resolve the plugin from their own location. Export the variable when you want the path fixed rather than worked out — when you run the engine's scripts by hand, or a model keeps guessing the directory. Point it at the directory holding `.claude-plugin/plugin.json`, which is a different place on each install path:

```bash
# installed from a marketplace — <marketplace> is the one you added, e.g. maister-plugins
export MAISTER_PLUGIN_ROOT=~/.copilot/installed-plugins/<marketplace>/maister-copilot
# installed straight from the repository, without a marketplace
export MAISTER_PLUGIN_ROOT=~/.copilot/installed-plugins/_direct/<source>
# running a local checkout — the same path you passed to --plugin-dir
export MAISTER_PLUGIN_ROOT=/path/to/maister/plugins/maister-copilot
```

`copilot plugin list` names what is installed. Put the export in your shell profile: it is read at spawn time and there is no flag for it. On Claude Code nothing is needed here — that host exports the same directory under its own name.

**Hooks on Copilot.** The variant ships the session-start reminder and the destructive-command guard, which Copilot CLI loads from the plugin. Claude Code's second reminder, the one that runs after a session's context is compacted, has no Copilot equivalent — Copilot starts no session after compaction — so after a long Copilot session is compacted, tell the model to re-read the run's `orchestrator-state.yml` before it continues a workflow.

**Two directory flags, and only one of them loads a plugin.** Both hosts have them and they are easy to confuse:

| Flag | What it does |
|---|---|
| `--plugin-dir <path>` | Loads the plugin at that path. This is the one that makes the workflows available. |
| `--add-dir <path>` | Grants file access to that directory, and picks up any `.claude/skills` or `.claude/agents` it contains — which a plugin directory does not have, because a plugin's skills live in its own `skills/`. It loads no plugin. |

Pointing only `--add-dir` at a checkout starts a session that can read the files and has none of the workflows: asking for one reports the skill as not found. Pass `--plugin-dir`, and add `--add-dir` for the same path as well when the checkout sits outside your working directory.

**Checking what loaded.** `claude plugin list` and `copilot plugin list` report a plugin loaded from a directory alongside the installed ones. The skill listing is the narrower answer — it is the session's own view, so read it inside the session rather than expecting an external command to confirm discovery.

### Initial project setup

Initialize your project to auto-detect coding standards and generate project documentation:

```bash
/maister:init
```

This scans your codebase and creates `.maister/` with standards, docs, and task folders.

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

All five run on the workflow engine. A task started on the 2.x plugin is finished on 2.x — see [Staying on 2.x](#staying-on-2x).

Whether a task is a bug fix is detected by the analysis, which then writes a failing test first. Or use `/maister:work` as a single entry point that routes to the right workflow.

Workflows your project defines in `.maister/workflows/` run with `/maister:run <name>`; see [Extending maister](docs/extending.md).

### Quick Commands

For smaller tasks that don't need a full workflow:

| Command | Use When |
|---------|----------|
| `/maister:quick-plan` | You want a plan with standards awareness before coding |
| `/maister:quick-dev` | You know what to do - just implement with standards applied |
| `/maister:quick-bugfix` | Quick TDD-driven bug fix — write failing test, fix, verify |
| `/maister:quick-design` | One small design question — options, a recommendation, one decision, a one-page decision record |

## Standards-Aware Development

This is the key differentiator. Maister doesn't just run workflows - it learns your project's conventions and enforces them:

- **`/maister:init`** scans config files, source code, and documentation to auto-detect your coding standards
- **Continuous checking** - standards are consulted before specification, during planning, and while coding (not just at the start)
- **`/maister:standards-discover`** refreshes standards from your evolving codebase
- **`/maister:standards-update`** lets you add or refine standards manually, or sync from another project with `--from=PATH`

Standards live in `.maister/docs/standards/` and are indexed in `.maister/docs/INDEX.md`.

**Important**: Run workflows with **auto-accept edits** enabled. Do not use Claude Code's plan mode with workflows (see [Best Practices](#best-practices) below).

## Answering gates

When a workflow pauses at a gate, you answer it in the session — every ordinary session works this way, and it needs no setup. Sessions the cockpit drives headlessly, which suspend at each gate until you answer from outside the terminal, are a Pro Edition feature (see [Pro Edition](#pro-edition) below).

## Upgrading

Automatic updates are off for this marketplace unless you turn them on, on the **Marketplaces** tab in `/plugin`. To update now, open `/plugin`, select `maister` on the **Installed** tab and choose **Update now** — or, from your shell:

```bash
claude plugin marketplace update maister-plugins
claude plugin update maister@maister-plugins
```

Then run `/reload-plugins`, or start a new session. On GitHub Copilot CLI, `copilot plugin update maister-copilot@maister-plugins` does the same.

Read the new version's entry in the [changelog](CHANGELOG.md) before you upgrade a workspace with work in flight: anything you have to do on upgrade day is under its **Upgrading** heading.

### Upgrading from 2.x

3.0 runs every workflow on the workflow engine, so it needs Node.js (see [Prerequisites](#prerequisites)), and it resumes only task directories its engine started. Before you upgrade, finish any task still in flight on 2.x, or plan to start it over on 3.0. Trying is safe: given a 2.x task directory, `/maister:work`, `/maister:run` and each workflow's own command say so and change nothing in it.

A development or research task in flight can also continue on 3.0 as a new run: start it with `--context=<the 2.x task directory>`, for example `/maister:development "finish the export feature" --context=.maister/tasks/development/2026-05-04-export`. The new run's first phase copies the whole folder — its state file, analysis, specification, plan and any other files — into the new task's `analysis/work-context/` and reads it as background for every phase. Nothing is resumed: the new run starts from its first phase and decides each step again, and the 2.x folder is left as it was. Performance, migration and product-design runs take no `--context`; finish those on 2.x or start them over.

Finished task directories need nothing. Those written by 2.2.3 or newer stay listed and shown in the dashboard like any other; older ones are listed by directory name, date and type only. There is nothing to migrate.

The [3.0.0 changelog entry](CHANGELOG.md#300) lists every breaking change.

### Staying on 2.x

To keep using 2.x — or to finish a task you started there — install from the 2.x maintenance line:

```bash
# Add the 2.x marketplace
/plugin marketplace add SkillPanel/maister#release/2.x

# Install the 2.x plugin
/plugin install maister@maister-plugins-2x
```

If another channel is installed, uninstall it first (for example `/plugin uninstall maister@maister-plugins`).

The 2.x line receives fixes only — no new features — for six months after 3.0.0 is released.

On GitHub Copilot CLI, the 2.x line installs the same way: `copilot plugin marketplace add SkillPanel/maister#release/2.x`, then `copilot plugin install maister-copilot@maister-plugins-2x`.

## Beta Channel

Want to try experimental features before they hit stable? Install from the beta channel:

```bash
# Add the beta marketplace
/plugin marketplace add SkillPanel/maister#beta

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

## Pro Edition

The Pro Edition adds what unattended and multi-repository work needs: driven sessions, which the cockpit resumes headlessly and which suspend at each gate until you answer from outside the terminal, with gate enforcement on every tool call; the `plan`, `change` and `fix` workflows that a chain dispatches into member repositories; and the compatibility contracts register, the normative record of every on-disk shape. It installs from a private marketplace:

```bash
# Add the pro marketplace (private — access is granted per customer)
/plugin marketplace add SkillPanel/maister-pro

# Install the pro plugin
/plugin install maister@maister-pro
```

Because both editions use the plugin name `maister`, uninstall the other channel first. With both enabled, Claude Code can load each skill from either edition. Maister detects this: a warning at session start names both editions and the command that disables each, and the workflow engine won't start or resume a run until only one is enabled and Claude Code has been restarted:

```bash
/plugin uninstall maister@maister-plugins
```

To switch back to the free edition:

```bash
/plugin uninstall maister@maister-pro
/plugin install maister@maister-plugins
```

GitHub Copilot CLI follows the same two-command flow with `copilot plugin marketplace add` / `copilot plugin install`, as described in [Installation](#installation).

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
| Set up a multi-repository workspace for the cockpit to drive (the umbrella runtime) and author a chain | [Umbrellas and chain files](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/umbrellas.md) |
| Understand what an autonomy tier actually enforces | [Autonomy tiers and permissions](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/autonomy.md) |
| See what asks you, and what a gate answer grants, in a run the cockpit drives | [Permissions in a run the cockpit drives](docs/workflows.md#permissions-in-a-run-the-cockpit-drives) |
| Write your own chains, use your own skills and agents as nodes, or overlay a built-in | [Extending maister](docs/extending.md) |

## Learn More

- [Workflow Details](docs/workflows.md) - phases, examples, and task structure for each workflow type
- [Extending maister](docs/extending.md) - your own chains, skills and agents as nodes, overlays and eject, and what needs a contract change
- [Full Command Reference](docs/commands.md) - all workflow, review, utility, and quick commands
- [Decision Log](docs/decisions/README.md) - the ADRs behind the gate protocol, the coordination shapes, and the compatibility floor
- [Cockpit quickstart](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/quickstart.md) - the browser-side path, from a first workflow to a chain across repositories
