<div align="center">

# Maister

**Structured, standards-aware development workflows for Claude Code**

Describe what you want to build, and the plugin handles the rest - from specification through implementation to verification - while enforcing your project's coding standards at every step.

</div>

## What You Get

- **Guided workflows** for features, bug fixes, enhancements, performance, migrations, and research
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

### First Workflow

```bash
/maister:development-new Add user profile page with avatar upload
```

Or just discuss your task with Claude and then run:

```bash
/maister:development-new
```

The plugin picks up context from your conversation - no arguments needed.

## How It Works

1. You describe a task - either as an argument or just in conversation
2. The plugin classifies it (feature, bug, enhancement, etc.) and proposes a workflow
3. You confirm, and it guides you through phases: **requirements → spec → plan → implement → verify**
4. At each phase, it asks for your input and decisions (or pass `--yolo` for continuous execution)
5. You get tested, verified code with a detailed work log

All artifacts are saved in `.maister/tasks/` organized by type and date.

### Context-Aware Commands

Every workflow command works without arguments. The plugin reads your current conversation to extract the task description and auto-detect the task type:

```
You: "The login page throws a 500 error when the session expires"
You: /maister:development-new
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
| `/maister:development-new` | Features, bug fixes, enhancements - auto-detects type from context |
| `/maister:research-new` | Evidence-based research with solution brainstorming and high-level design documents |
| `/maister:performance-new` | Optimizing speed or resource usage |
| `/maister:migration-new` | Changing technologies or patterns |

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
- **`/maister:standards-update`** lets you add or refine standards manually

Standards live in `.maister/docs/standards/` and are indexed in `.maister/docs/INDEX.md`.

## Execution Modes

- **Interactive** (default): pauses between phases for your review and input
- **YOLO** (`--yolo` flag): runs continuously through all phases, asking only critical questions

**Important**: Run workflows with **auto-accept edits** enabled. Do not use Claude Code's plan mode -- the orchestrators handle their own planning phases internally, and plan mode will interfere with execution.

## Learn More

- [Workflow Details](docs/workflows.md) - phases, examples, and task structure for each workflow type
- [Full Command Reference](docs/commands.md) - all workflow, review, utility, and quick commands
