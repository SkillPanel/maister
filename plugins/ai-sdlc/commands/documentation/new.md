---
name: ai-sdlc:documentation:new
description: Start a documentation creation workflow with content planning, screenshot generation, and publication
---

> **CRITICAL**: Invoke the `ai-sdlc:documentation-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Documentation Workflow: New

Start comprehensive documentation creation from planning through publication with screenshot automation.

## Usage

```bash
/ai-sdlc:documentation:new [description] [--yolo] [--from=PHASE] [--type=TYPE]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--from=PHASE`: Start from phase (planning, content, review, publication)
- `--type=TYPE`: Documentation type (user-guide, tutorial, reference, faq, api-docs)

## Examples

```bash
/ai-sdlc:documentation:new "User guide for project management"
/ai-sdlc:documentation:new "Quick start guide" --yolo
/ai-sdlc:documentation:new "FAQ for authentication" --type=faq
```

## See Also

- Workflow details: `skills/documentation-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/documentation/YYYY-MM-DD-name/`
