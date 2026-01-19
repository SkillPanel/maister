---
name: ai-sdlc:initiative:new
description: Start a new epic-level initiative with guided orchestration through all phases
---

> **CRITICAL**: Invoke the `ai-sdlc:initiative-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Initiative Workflow: New

Orchestrate epic-level initiatives that coordinate 3-15 related tasks with dependency management.

## Usage

```bash
/ai-sdlc:initiative:new [description] [--yolo] [--from=PHASE]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--from=PHASE`: Start from phase (planning, task-creation, dependency-resolution, task-execution, verification, finalization)

## Examples

```bash
/ai-sdlc:initiative:new "User authentication system with SSO and MFA"
/ai-sdlc:initiative:new "Payment processing overhaul" --yolo
/ai-sdlc:initiative:new "Multi-tenant support" --from=task-creation
```

## See Also

- Workflow details: `skills/initiative-orchestrator/skill.md`
- Check progress: `/ai-sdlc:initiative:status [path]`
- Initiative output: `.ai-sdlc/docs/project/initiatives/YYYY-MM-DD-name/`
