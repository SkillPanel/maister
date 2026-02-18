---
name: maister-research-resume
description: Resume an interrupted or failed research workflow from where it left off
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="maister-copilot/research-orchestrator" NOW. Pass the task path and all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Research Workflow: Resume

Resume an interrupted research workflow from where it left off.

## Usage

```bash
/maister-copilot/research-resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (foundation, brainstorming-decision, brainstorming, design, outputs, verification, integration)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/maister-copilot/research-resume .maister/tasks/research/2025-11-14-auth-research
/maister-copilot/research-resume --from=brainstorming
/maister-copilot/research-resume --reset-attempts
```

## See Also

- Workflow details: `skills/research-orchestrator/skill.md`
- Task output: `.maister/tasks/research/YYYY-MM-DD-name/`
