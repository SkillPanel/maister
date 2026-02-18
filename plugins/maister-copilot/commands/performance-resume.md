---
name: maister-performance-resume
description: Resume an interrupted or failed performance optimization workflow from where it left off
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Skill tool with skill="maister-copilot/performance-orchestrator" NOW. Pass the task path and all arguments. Do not read files, explore code, or execute workflow steps yourself.

# Performance Optimization Workflow: Resume

Resume an interrupted performance optimization from where it left off.

## Usage

```bash
/maister-copilot/performance-resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (analysis, specification, planning, implementation, verification)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/maister-copilot/performance-resume .maister/tasks/performance/2026-02-09-dashboard-perf
/maister-copilot/performance-resume --from=implementation
/maister-copilot/performance-resume --reset-attempts
```

## See Also

- Workflow details: `skills/performance-orchestrator/SKILL.md`
- Task output: `.maister/tasks/performance/YYYY-MM-DD-name/`
