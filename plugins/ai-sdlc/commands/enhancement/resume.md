---
name: ai-sdlc:enhancement:resume
description: Resume an interrupted or failed enhancement workflow (alias for /ai-sdlc:development:resume)
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Resume Enhancement Workflow

Alias for `/ai-sdlc:development:resume`. Resumes an interrupted enhancement workflow.

## Usage

```bash
/ai-sdlc:enhancement:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:enhancement:resume
/ai-sdlc:enhancement:resume .ai-sdlc/tasks/enhancements/2025-01-15-add-sorting/
```

## See Also

- Unified command: `/ai-sdlc:development:resume`
- Workflow details: `skills/development-orchestrator/SKILL.md`
