---
name: ai-sdlc:security:resume
description: Resume an interrupted or failed security remediation workflow from where it left off
---

> **CRITICAL**: Invoke the `ai-sdlc:security-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Security Remediation Workflow: Resume

Resume an interrupted security remediation from where it left off.

## Usage

```bash
/ai-sdlc:security:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (baseline, planning, implementation, verification, compliance)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:security:resume .ai-sdlc/tasks/security/2025-11-17-vulnerabilities
/ai-sdlc:security:resume --from=verification
/ai-sdlc:security:resume --reset-attempts
```

## See Also

- Workflow details: `skills/security-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/security/YYYY-MM-DD-name/`
