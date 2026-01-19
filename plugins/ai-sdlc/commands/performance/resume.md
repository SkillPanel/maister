---
name: ai-sdlc:performance:resume
description: Resume an interrupted or failed performance optimization workflow from where it left off
---

> **CRITICAL**: Invoke the `ai-sdlc:performance-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the task path to the skill.

# Performance Optimization Workflow: Resume

Resume an interrupted performance optimization from where it left off.

## Usage

```bash
/ai-sdlc:performance:resume [task-path] [--from=PHASE] [--reset-attempts]
```

### Options

- `--from=PHASE`: Override resume point (baseline, analysis, implementation, verification, load-testing)
- `--reset-attempts`: Reset auto-fix attempt counters

## Examples

```bash
/ai-sdlc:performance:resume .ai-sdlc/tasks/performance/2025-11-16-dashboard-perf
/ai-sdlc:performance:resume --from=verification
/ai-sdlc:performance:resume --reset-attempts
```

## See Also

- Workflow details: `skills/performance-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/performance/YYYY-MM-DD-name/`
