---
name: ai-sdlc:security:new
description: Start a security remediation workflow with vulnerability analysis, prioritized fixes, and compliance audit
---

> **CRITICAL**: Invoke the `ai-sdlc:security-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Security Remediation Workflow: New

Start comprehensive security remediation from vulnerability analysis through compliance-ready deployment.

## Usage

```bash
/ai-sdlc:security:new [description] [--yolo] [--from=PHASE]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--from=PHASE`: Start from phase (baseline, planning, implementation, verification, compliance)

## Examples

```bash
/ai-sdlc:security:new "Fix authentication vulnerabilities"
/ai-sdlc:security:new "npm audit shows critical CVEs" --yolo
/ai-sdlc:security:new --from=implementation
```

## See Also

- Workflow details: `skills/security-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/security/YYYY-MM-DD-name/`
