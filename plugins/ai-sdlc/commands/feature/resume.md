---
name: ai-sdlc:feature:resume
description: Resume an interrupted or failed feature development workflow (alias for /ai-sdlc:development:resume)
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Resume Feature Workflow

Alias for `/ai-sdlc:development:resume`. Resumes an interrupted feature development workflow.

## Usage

```bash
/ai-sdlc:feature:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:feature:resume
/ai-sdlc:feature:resume .ai-sdlc/tasks/new-features/2025-01-15-user-auth/
```

## See Also

- Unified command: `/ai-sdlc:development:resume`
- Workflow details: `skills/development-orchestrator/SKILL.md`
