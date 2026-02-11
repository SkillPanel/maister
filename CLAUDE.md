# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Claude Code plugin marketplace repository containing bundled plugins for AI-driven SDLC workflows. The main plugin is `ai-sdlc` which provides structured development workflows.

## Structure

```
.claude-plugin/marketplace.json    # Marketplace manifest (lists all plugins)
plugins/
└── ai-sdlc/                       # Main plugin
    ├── .claude-plugin/plugin.json # Plugin manifest
    ├── CLAUDE.md                  # Detailed plugin documentation (READ THIS)
    ├── agents/                    # Subagent definitions (*.md)
    ├── commands/                  # Slash commands (organized by workflow type)
    ├── skills/                    # Skills with SKILL.md entry points
    └── .mcp.json                  # MCP server configuration
docs/                              # User-facing documentation and guides
```

## Key Files

- **`@plugins/ai-sdlc/CLAUDE.md`**: Comprehensive plugin documentation with all skills, commands, agents, and workflow principles. Read this when working on plugin internals.
- **`README.md`**: User-facing documentation for plugin consumers.

## Plugin Development

### Adding a New Skill

1. Create directory: `plugins/ai-sdlc/skills/[skill-name]/`
2. Create `SKILL.md` with workflow phases and execution instructions
3. Optionally add `references/` directory for supporting documentation
4. Document in `@plugins/ai-sdlc/CLAUDE.md` under "Available Skills"

### Adding a New Command

1. Create markdown file: `plugins/ai-sdlc/commands/[category]/[command].md`
2. Commands are thin wrappers that invoke skills
3. Document in `plugins/ai-sdlc/CLAUDE.md` under "Available Commands"

### Adding a New Agent

1. Create markdown file: `plugins/ai-sdlc/agents/[agent-name].md`
2. Define agent purpose, tools, and workflow
3. Document in `plugins/ai-sdlc/CLAUDE.md` under "Available Subagents"

## Documentation Principles

This plugin follows specific documentation guidelines (see @plugins/ai-sdlc/CLAUDE.md section "Plugin Documentation Principles"):

- Trust Claude to reason—provide principles, not prescriptive implementations
- Commands are thin wrappers; orchestration logic lives in skills
- Reference files guide implementation, not provide complete code
- Single source of truth: technical details in `SKILL.md`, not scattered across files

## Testing Changes

1. Navigate to a test project
2. Run `/init-sdlc` to initialize the framework
3. Test commands like `/ai-sdlc:development:new "test feature"`
4. Use `--yolo` flag for continuous execution during testing
