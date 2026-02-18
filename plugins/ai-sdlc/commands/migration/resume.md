---
name: maister:migration-resume
description: Resume an interrupted or failed migration workflow from where it left off
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="maister:migration-orchestrator" NOW. Pass the task path and all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Migration Workflow: Resume

Resume an interrupted migration from where it left off.

## Usage

```bash
/maister:migration-resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (analysis, target, spec, plan, execute, verify, docs)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/maister:migration-resume .maister/tasks/migrations/2025-10-20-express-fastify
/maister:migration-resume --from=verify
/maister:migration-resume --reset-attempts
```

## See Also

- Workflow details: `skills/migration-orchestrator/skill.md`
- Task output: `.maister/tasks/migrations/YYYY-MM-DD-name/`
