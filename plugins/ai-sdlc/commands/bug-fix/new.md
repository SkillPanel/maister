---
name: ai-sdlc:bug-fix:new
description: Start a comprehensive bug fixing workflow (alias for /ai-sdlc:development:new --type=bug)
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY with `task_type=bug`.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Bug Fix Workflow

Alias for `/ai-sdlc:development:new --type=bug`. Starts a bug fix workflow with TDD Red→Green gates.

## Usage

```bash
/ai-sdlc:bug-fix:new [description] [--yolo] [--from=PHASE]
```

### Options

- `--yolo`: Continuous execution (TDD gates still enforced)
- `--from=PHASE`: Start from phase (`analysis`, `gap`, `tdd-red`, `spec`, `plan`, `implement`, `tdd-green`, `verify`)

## Examples

```bash
/ai-sdlc:bug-fix:new "Fix login timeout with special characters"
/ai-sdlc:bug-fix:new "Null pointer in profile page" --yolo
```

## See Also

- Unified command: `/ai-sdlc:development:new --type=bug`
- Workflow details: `skills/development-orchestrator/SKILL.md`
- Task output: `.ai-sdlc/tasks/bug-fixes/YYYY-MM-DD-name/`
