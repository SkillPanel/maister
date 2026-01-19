---
name: ai-sdlc:development:new
description: Start a new development workflow (bug fix, enhancement, or new feature) with unified orchestration through all phases
---

> **CRITICAL**: Invoke the `ai-sdlc:development-orchestrator` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass all arguments to the skill.

# Development Workflow: New

Start any development task—bug fix, enhancement, or new feature. Task type is auto-detected from description or can be explicitly set.

## Usage

```bash
/ai-sdlc:development:new [description] [--type=TYPE] [--yolo] [--from=PHASE] [--e2e] [--user-docs] [--code-review] [--research=PATH]
```

### Options

- `--type=TYPE`: Set task type (`bug`, `enhancement`, `feature`). Default: auto-detected
- `--yolo`: Continuous execution without pauses. Default: interactive mode
- `--from=PHASE`: Start from phase (`analysis`, `gap`, `spec`, `plan`, `implement`, `verify`)
- `--e2e` / `--no-e2e`: Enable/skip E2E testing
- `--user-docs` / `--no-user-docs`: Enable/skip user documentation
- `--code-review` / `--no-code-review`: Enable/skip code review
- `--research=PATH`: Link to completed research task for enriched context

### Research-Based Development

Start development informed by a completed research workflow. Research context flows through ALL phases without skipping any—development-specific analysis is more targeted and still executes fully.

**Auto-Detection**: If the first argument is a research task folder path (contains `orchestrator-state.yml` with `task.type: research`), it's automatically treated as `--research=PATH`:

```bash
# These are equivalent:
/ai-sdlc:development:new .ai-sdlc/tasks/research/2026-01-12-oauth-research
/ai-sdlc:development:new --research=.ai-sdlc/tasks/research/2026-01-12-oauth-research
```

**Detection logic**:
1. Check if first arg is a path (starts with `.` or `/` or contains `/`)
2. Check if `[path]/orchestrator-state.yml` exists
3. Read `task.type` from that file
4. If `task.type: research`, treat as research-based mode
5. Extract task description from research question in state file

**What happens**:
- Research artifacts copied to `analysis/research-context/`
- Research findings stored in `phase_summaries.research`
- All phases receive research context via Pattern 7 (context passing)
- No phases are skipped—research INFORMS but doesn't REPLACE analysis

## Examples

```bash
# Auto-detect task type
/ai-sdlc:development:new "Fix crash when clicking submit"

# Explicit type
/ai-sdlc:development:new "Update login flow" --type=enhancement

# Fast execution
/ai-sdlc:development:new "Add dark mode" --yolo --e2e

# From completed research (auto-detect)
/ai-sdlc:development:new .ai-sdlc/tasks/research/2026-01-12-oauth-research

# From completed research (explicit)
/ai-sdlc:development:new "Implement OAuth" --research=.ai-sdlc/tasks/research/2026-01-12-oauth-research
```

## See Also

- Workflow details: `skills/development-orchestrator/SKILL.md`
- Task output: `.ai-sdlc/tasks/[type]/YYYY-MM-DD-name/`
