# OpenCode Setup Guide

This guide explains how to install and configure the Maister plugin for use with [OpenCode](https://github.com/anomalyco/opencode).

## Prerequisites

- **OpenCode installed**: See the [OpenCode repository](https://github.com/anomalyco/opencode) for installation instructions.
- **Node.js ≥ 18**: Required for running the plugin.
- **jq**: Installed for merging configuration fragments.
- **git, make, bash**: Standard development tools.

## Quick Start

```bash
git clone https://github.com/SkillPanel/Maister.git maister-src
cd maister-src
make opencode-build
# copy output to your project
cp -r platforms/opencode/output/commands/ /path/to/your-project/.opencode/commands/
cp -r platforms/opencode/output/agents/ /path/to/your-project/.opencode/agents/
cp -r platforms/opencode/output/instructions/ /path/to/your-project/.opencode/instructions/
cp platforms/opencode/output/plugins/maister-plugin.ts /path/to/your-project/.opencode/plugins/maister-plugin.ts
```

## Build from Source

The `make opencode-build` command runs the `platforms/opencode/build.sh` script, which transforms the core Maister plugin into OpenCode-compatible artifacts. It produces:

- `platforms/opencode/output/commands/`: 8 command files (e.g., `work.md`, `quick-dev.md`).
- `platforms/opencode/output/agents/`: 24 agent definitions.
- `platforms/opencode/output/instructions/`: 14 instruction files (workflows).
- `platforms/opencode/output/agent-fragment.json`: Configuration fragment for agents.
- `platforms/opencode/output/mcp-fragment.json`: Configuration fragment for MCP servers.

## Installation (Per-Project)

To install Maister in your project, copy the built artifacts into your project's `.opencode/` directory:

```bash
mkdir -p .opencode/commands .opencode/agents .opencode/instructions .opencode/plugins

cp -r platforms/opencode/output/commands/* .opencode/commands/
cp -r platforms/opencode/output/agents/* .opencode/agents/
cp -r platforms/opencode/output/instructions/* .opencode/instructions/
```

Note: References in `agent-fragment.json` resolve relative to the project root, so paths like `.opencode/agents/...` are used.

## Configuration — Merging Fragments

You need to merge the generated fragments into your `opencode.json` configuration file.

### Merging Agent Fragment

If `opencode.json` already exists:

```bash
jq -s '.[0] * {"agent": (.[0].agent // {} + .[1])}' opencode.json platforms/opencode/output/agent-fragment.json > opencode.json.tmp && mv opencode.json.tmp opencode.json
```

If starting fresh:

```bash
cp platforms/opencode/output/agent-fragment.json opencode.json
```

### Merging MCP Fragment

Merge the MCP server configuration:

```bash
jq -s '.[0] * {"mcpServers": (.[0].mcpServers // {} + .[1])}' opencode.json platforms/opencode/output/mcp-fragment.json > opencode.json.tmp && mv opencode.json.tmp opencode.json
```

### Adding Instructions

Add the Maister instructions to the `"instructions"` array in `opencode.json`:

```json
{
  "instructions": [
    ".opencode/instructions/maister-rules.md"
  ]
}
```

## Plugin Setup

OpenCode loads plugins as top-level `.opencode/plugins/*.ts` or `*.js` files.

```bash
# In your project root:
mkdir -p .opencode/plugins
cp platforms/opencode/output/plugins/maister-plugin.ts .opencode/plugins/maister-plugin.ts

# Install plugin dependency
cd .opencode
npm init -y 2>/dev/null || true
npm install @opencode-ai/plugin
cd ..
```

## Verify Installation

Confirm the setup by checking the file structure and running the validation command:

```bash
# From the Maister source directory:
make opencode-validate

# In your target project:
ls .opencode/commands/      # Should show 8 .md files
ls .opencode/agents/        # Should show 24 .md files
```

## Available Commands

Maister provides several entry points for different development tasks:

| Command | Description |
|---------|-------------|
| `work` | Unified entry point — auto-classifies tasks and routes to appropriate workflow. |
| `quick-dev` | Implement task directly with standards awareness (no planning mode). |
| `quick-plan` | Enter planning mode with standards awareness. |
| `quick-bugfix` | Quick TDD-driven bug fix — write failing test, fix, verify. |
| `reviews-code` | Run automated code quality, security, and performance analysis. |
| `reviews-pragmatic` | Run pragmatic code review to detect over-engineering. |
| `reviews-production-readiness` | Verify production deployment readiness with comprehensive checks. |
| `reviews-reality-check` | Comprehensive reality assessment of completed work. |
| `reviews-spec-audit` | Independent specification audit to verify completeness and clarity. |

## Differences from Claude Code Version

The OpenCode version of Maister has some differences due to platform variations:

- **Conversational Interaction**: There is no structured option selection (like `AskUserQuestion`). Instead, the AI asks questions conversationally.
- **Todo Management**: State tracking uses the `todo` tool rather than internal `TaskCreate`/`TaskUpdate` primitives.
- **Static Skills**: Skills are implemented as instruction files rather than dynamically invocable tools.
- **Step Limits**: The `steps` limit in agents may require more frequent manual intervention for very long orchestration workflows.
- **Command Syntax**: Use command names directly as slash commands (e.g., `/work` instead of `/maister:work`).
