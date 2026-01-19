---
name: ai-sdlc:development:new
description: Start a new development workflow (bug fix, enhancement, or new feature) with unified orchestration through all phases
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Development Workflow: New

Start any development task—bug fix, enhancement, or new feature. Task type is auto-detected from description or can be explicitly set.

## Usage

```bash
/ai-sdlc:development:new [description] [--type=TYPE] [--yolo] [--from=PHASE] [--e2e] [--user-docs] [--code-review]
```

### Options

- `--type=TYPE`: Set task type (`bug`, `enhancement`, `feature`). Default: auto-detected
- `--yolo`: Continuous execution without pauses. Default: interactive mode
- `--from=PHASE`: Start from phase (`analysis`, `gap`, `spec`, `plan`, `implement`, `verify`)
- `--e2e` / `--no-e2e`: Enable/skip E2E testing
- `--user-docs` / `--no-user-docs`: Enable/skip user documentation
- `--code-review` / `--no-code-review`: Enable/skip code review

## Examples

```bash
# Auto-detect task type
/ai-sdlc:development:new "Fix crash when clicking submit"

# Explicit type
/ai-sdlc:development:new "Update login flow" --type=enhancement

# Fast execution
/ai-sdlc:development:new "Add dark mode" --yolo --e2e
```

## See Also

- Workflow details: `skills/development-orchestrator/SKILL.md`
- Task output: `.ai-sdlc/tasks/[type]/YYYY-MM-DD-name/`
