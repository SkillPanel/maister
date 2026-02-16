---
name: research-resume
description: Resume an interrupted or failed research workflow from where it left off
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="ai-sdlc-copilot/research-orchestrator" NOW. Pass the task path and all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Research Workflow: Resume

Resume an interrupted research workflow from where it left off.

## Usage

```bash
/ai-sdlc-copilot/research:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (foundation, brainstorming-decision, brainstorming, design, outputs, verification, integration)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc-copilot/research:resume .ai-sdlc/tasks/research/2025-11-14-auth-research
/ai-sdlc-copilot/research:resume --from=brainstorming
/ai-sdlc-copilot/research:resume --reset-attempts
```

## See Also

- Workflow details: `skills/research-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/research/YYYY-MM-DD-name/`
