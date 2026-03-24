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

- [Claude Code](https://claude.ai/code) CLI installed and configured

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
| `/maister:development` | Features, bug fixes, enhancements - auto-detects type from context |
| `/maister:research` | Evidence-based research with solution brainstorming and high-level design documents |
| `/maister:performance` | Optimizing speed or resource usage |
| `/maister:migration` | Changing technologies or patterns |
| `/maister:product-design` | Designing features or products before building them |

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

## Learn More

- [Workflow Details](docs/workflows.md) - phases, examples, and task structure for each workflow type
- [Full Command Reference](docs/commands.md) - all workflow, review, utility, and quick commands
