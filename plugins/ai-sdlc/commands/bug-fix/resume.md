---
name: ai-sdlc:bug-fix:resume
description: Resume an interrupted or failed bug fix workflow (alias for /ai-sdlc:development:resume)
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Resume Bug Fix Workflow

Alias for `/ai-sdlc:development:resume`. Resumes an interrupted bug fix workflow.

## Usage

```bash
/ai-sdlc:bug-fix:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (includes `tdd-red`, `tdd-green` phases)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:bug-fix:resume
/ai-sdlc:bug-fix:resume .ai-sdlc/tasks/bug-fixes/2025-01-15-fix-login-timeout/
```

## See Also

- Unified command: `/ai-sdlc:development:resume`
- Workflow details: `skills/development-orchestrator/SKILL.md`
