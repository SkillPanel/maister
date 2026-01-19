---
name: ai-sdlc:feature:new
description: Start a new feature development workflow (alias for /ai-sdlc:development:new --type=feature)
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY with `task_type=feature`.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# New Feature Workflow

Alias for `/ai-sdlc:development:new --type=feature`. Starts a new feature development workflow.

## Usage

```bash
/ai-sdlc:feature:new [description] [--yolo] [--from=PHASE] [--e2e] [--user-docs]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--from=PHASE`: Start from phase (`analysis`, `gap`, `spec`, `plan`, `implement`, `verify`)
- `--e2e`: Enable E2E testing
- `--user-docs`: Enable user documentation generation

## Examples

```bash
/ai-sdlc:feature:new "Add shopping cart functionality"
/ai-sdlc:feature:new "Build user dashboard" --yolo --e2e
```

## See Also

- Unified command: `/ai-sdlc:development:new --type=feature`
- Workflow details: `skills/development-orchestrator/SKILL.md`
- Task output: `.ai-sdlc/tasks/new-features/YYYY-MM-DD-name/`
