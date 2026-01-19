---
name: ai-sdlc:performance:new
description: Start a performance optimization workflow with profiling, benchmarking, and load testing
---

> **CRITICAL**: Invoke the `ai-sdlc:performance-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Performance Optimization Workflow: New

Start comprehensive performance optimization from profiling through production-ready deployment.

## Usage

```bash
/ai-sdlc:performance:new [description] [--yolo] [--from=PHASE]
```

### Options

- `--yolo`: Continuous execution without pauses
- `--from=PHASE`: Start from phase (baseline, analysis, implementation, verification, load-testing)

## Examples

```bash
/ai-sdlc:performance:new "Dashboard page loading slowly"
/ai-sdlc:performance:new "API response time >1 second" --yolo
/ai-sdlc:performance:new --from=implementation
```

## See Also

- Workflow details: `skills/performance-orchestrator/skill.md`
- Task output: `.ai-sdlc/tasks/performance/YYYY-MM-DD-name/`
