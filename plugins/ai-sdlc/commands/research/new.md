---
name: ai-sdlc:research:new
description: Start a new research workflow with guided orchestration through all phases
---

> **CRITICAL**: Invoke the `ai-sdlc:research-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Research Workflow: New

Start comprehensive research to investigate a topic, analyze findings, and generate actionable outputs.

## Usage

```bash
/ai-sdlc:research:new [question] [--yolo] [--type=TYPE]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--type=TYPE`: Research type (technical, requirements, literature, mixed)

## Examples

```bash
/ai-sdlc:research:new "How does authentication work in this codebase?"
/ai-sdlc:research:new "Best practices for real-time notifications" --type=literature
/ai-sdlc:research:new "Requirements for reporting feature" --yolo
```

## See Also

- Workflow details: `skills/research-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/research/YYYY-MM-DD-name/`
