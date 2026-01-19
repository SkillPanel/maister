---
name: ai-sdlc:refactoring:resume
description: Resume an interrupted or failed refactoring workflow from where it left off
---

> **CRITICAL**: Invoke the `ai-sdlc:refactoring-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Refactoring Workflow: Resume

Resume an interrupted refactoring from where it left off.

## Usage

```bash
/ai-sdlc:refactoring:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (baseline, planning, snapshot, execution, verification, quality)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:refactoring:resume .ai-sdlc/tasks/refactoring/2025-11-14-extract-validation
/ai-sdlc:refactoring:resume --from=execution
/ai-sdlc:refactoring:resume --reset-attempts
```

## See Also

- Workflow details: `skills/refactoring-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/refactoring/YYYY-MM-DD-name/`
