---
name: ai-sdlc:migration:resume
description: Resume an interrupted or failed migration workflow from where it left off
---

> **CRITICAL**: Invoke the `ai-sdlc:migration-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Migration Workflow: Resume

Resume an interrupted migration from where it left off.

## Usage

```bash
/ai-sdlc:migration:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (analysis, target, spec, plan, execute, verify, docs)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:migration:resume .ai-sdlc/tasks/migrations/2025-10-20-express-fastify
/ai-sdlc:migration:resume --from=verify
/ai-sdlc:migration:resume --reset-attempts
```

## See Also

- Workflow details: `skills/migration-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/migrations/YYYY-MM-DD-name/`
