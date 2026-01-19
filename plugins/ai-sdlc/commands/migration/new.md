---
name: ai-sdlc:migration:new
description: Start a new migration workflow with guided orchestration through all phases
---

> **CRITICAL**: Invoke the `ai-sdlc:migration-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Migration Workflow: New

Start comprehensive migration from current system analysis through execution and verification.

## Usage

```bash
/ai-sdlc:migration:new [description] [--yolo] [--from=PHASE] [--type=TYPE]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--from=PHASE`: Start from phase (analysis, target, spec, plan, execute, verify, docs)
- `--type=TYPE`: Migration type (code, data, architecture, general)

## Examples

```bash
/ai-sdlc:migration:new "Migrate from Express to Fastify"
/ai-sdlc:migration:new "Upgrade React 16 to 18" --yolo
/ai-sdlc:migration:new "Move to GraphQL" --type=architecture
```

## See Also

- Workflow details: `skills/migration-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/migrations/YYYY-MM-DD-name/`
