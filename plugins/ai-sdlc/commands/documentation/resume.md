---
name: ai-sdlc:documentation:resume
description: Resume an interrupted or failed documentation workflow from where it left off
---

> **CRITICAL**: Invoke the `ai-sdlc:documentation-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Documentation Workflow: Resume

Resume an interrupted documentation workflow from where it left off.

## Usage

```bash
/ai-sdlc:documentation:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (planning, content, review, publication)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:documentation:resume .ai-sdlc/tasks/documentation/2025-11-17-user-guide
/ai-sdlc:documentation:resume --from=content
/ai-sdlc:documentation:resume --reset-attempts
```

## See Also

- Workflow details: `skills/documentation-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/documentation/YYYY-MM-DD-name/`
