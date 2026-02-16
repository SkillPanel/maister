---
name: development-resume
description: Resume an interrupted or failed development workflow from where it left off
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="ai-sdlc-copilot/development-orchestrator" NOW. Pass the task path and all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Development Workflow: Resume

Resume an interrupted development workflow from where it left off.

## Usage

```bash
/ai-sdlc-copilot/development:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (`analysis`, `gap`, `spec`, `plan`, `implement`, `verify`)
- `--reset-attempts`: Reset auto-fix attempt counters (use if stuck in retry loop)

## Examples

```bash
# Resume most recent incomplete task
/ai-sdlc-copilot/development:resume

# Resume specific task
/ai-sdlc-copilot/development:resume .ai-sdlc/tasks/enhancements/2025-01-15-add-sorting/

# Resume from specific phase
/ai-sdlc-copilot/development:resume --from=implement

# Reset retry counters
/ai-sdlc-copilot/development:resume --reset-attempts
```

## See Also

- Workflow details: `skills/development-orchestrator/SKILL.md`
