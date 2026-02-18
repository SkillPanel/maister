---
name: maister:migration-new
description: Start a new migration workflow with guided orchestration through all phases
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="maister:migration-orchestrator" NOW. Pass all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Migration Workflow: New

Start comprehensive migration from current system analysis through execution and verification.

## Usage

```bash
/maister:migration-new [description] [--yolo] [--from=PHASE] [--type=TYPE]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--from=PHASE`: Start from phase (analysis, target, spec, plan, execute, verify, docs)
- `--type=TYPE`: Migration type (code, data, architecture, general)

## Examples

```bash
/maister:migration-new "Migrate from Express to Fastify"
/maister:migration-new "Upgrade React 16 to 18" --yolo
/maister:migration-new "Move to GraphQL" --type=architecture
```

## See Also

- Workflow details: `skills/migration-orchestrator/skill.md`
- Task output: `.maister/tasks/migrations/YYYY-MM-DD-name/`
