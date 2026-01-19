---
name: ai-sdlc:development:resume
description: Resume an interrupted or failed development workflow from where it left off
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Development Workflow: Resume

Resume an interrupted development workflow from where it left off.

## Usage

```bash
/ai-sdlc:development:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (`analysis`, `gap`, `spec`, `plan`, `implement`, `verify`)
- `--reset-attempts`: Reset auto-fix attempt counters (use if stuck in retry loop)

## Examples

```bash
# Resume most recent incomplete task
/ai-sdlc:development:resume

# Resume specific task
/ai-sdlc:development:resume .ai-sdlc/tasks/enhancements/2025-01-15-add-sorting/

# Resume from specific phase
/ai-sdlc:development:resume --from=implement

# Reset retry counters
/ai-sdlc:development:resume --reset-attempts
```

## See Also

- Workflow details: `skills/development-orchestrator/SKILL.md`
