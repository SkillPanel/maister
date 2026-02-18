---
name: maister-research-new
description: Start a new research workflow with guided orchestration through all phases
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="maister-copilot/research-orchestrator" NOW. Pass all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Research Workflow: New

Start comprehensive research to investigate a topic, analyze findings, and generate actionable outputs.

## Usage

```bash
/maister-copilot/research-new [question] [--yolo] [--type=TYPE] [--brainstorm] [--no-brainstorm]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--type=TYPE`: Research type (technical, requirements, literature, mixed)
- `--brainstorm`: Force brainstorming/design phases (skips Phase 1 decision, auto-enables)
- `--no-brainstorm`: Skip brainstorming/design phases (go directly to output generation)

## Examples

```bash
/maister-copilot/research-new "How does authentication work in this codebase?"
/maister-copilot/research-new "Best practices for real-time notifications" --type=literature
/maister-copilot/research-new "Requirements for reporting feature" --yolo
/maister-copilot/research-new "Best architecture for notifications" --brainstorm
/maister-copilot/research-new "How does auth work?" --no-brainstorm
```

## See Also

- Workflow details: `skills/research-orchestrator/skill.md`
- Task output: `.maister/tasks/research/YYYY-MM-DD-name/`
