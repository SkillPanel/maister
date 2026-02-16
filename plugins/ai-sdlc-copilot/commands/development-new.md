---
name: development-new
description: Start a new development workflow (bug fix, enhancement, or new feature) with unified orchestration through all phases
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="ai-sdlc-copilot/development-orchestrator" NOW. Pass all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Development Workflow: New

Start any development task—bug fix, enhancement, or new feature. Task type is auto-detected or set with --type.

## Usage

```
/ai-sdlc-copilot/development:new [description] [--type=TYPE] [--yolo] [--from=PHASE] [--e2e] [--user-docs] [--code-review] [--research=PATH]
```

## Examples

```
/ai-sdlc-copilot/development:new "Fix crash when clicking submit"
/ai-sdlc-copilot/development:new "Update login flow" --type=enhancement
/ai-sdlc-copilot/development:new .ai-sdlc/tasks/research/2026-01-12-oauth-research
```

## See Also

- Workflow details: `skills/development-orchestrator/SKILL.md`
- Task output: `.ai-sdlc/tasks/[type]/YYYY-MM-DD-name/`
