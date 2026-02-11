# Workflow Overview

This guide explains how to use the AI SDLC plugin's development workflows - from choosing the right approach to understanding each phase.

## Choosing Your Workflow Approach

### Option A: Orchestrated Workflow (Recommended)

Use specialized orchestrator skills for guided, automated workflows. Best for most users.

| Task Type | Command | Best For |
|-----------|---------|----------|
| **Development** (Unified) | `/ai-sdlc:development:new` | Bugs, enhancements, or new features (auto-detects type) |
| **Migration** | `/ai-sdlc:migration:new` | Technology/platform migrations |
| **Performance** | `/ai-sdlc:performance:new` | Optimization with benchmarks |
| **Research** | `/ai-sdlc:research:new` | Pre-development investigation |

**Legacy Commands** (still work as aliases):
- `/ai-sdlc:feature:new` → `/ai-sdlc:development:new --type=feature`
- `/ai-sdlc:enhancement:new` → `/ai-sdlc:development:new --type=enhancement`
- `/ai-sdlc:bug-fix:new` → `/ai-sdlc:development:new --type=bug`

**All orchestrators provide:**
- Interactive mode (pause between phases) or YOLO mode (continuous)
- Auto-recovery from common failures
- Pause/resume capability with state management
- Guided workflow from start to finish
- Common orchestration patterns from the shared framework

### Using `/work` Command (Automatic Classification)

The `/work` command automatically classifies your task and routes to the appropriate orchestrator:

```bash
/work "Add sorting to user table"                               # → enhancement or new-feature
/work "Fix login timeout error"                                 # → bug-fix
/work "Migrate from Redux to Zustand"                          # → migration
```

Features:
- Analyzes codebase context for enhancement vs new-feature
- Shows confidence score and proposed workflow
- Requests confirmation before proceeding

### Option B: Quick Commands (Low-Friction)

For smaller tasks that don't need full orchestration:

```bash
/ai-sdlc:quick:plan "Add pagination to user list"   # Planning mode with standards
/ai-sdlc:quick:dev "Add email validation"           # Direct implementation
```

**Features**:
- Automatically discovers standards from `.ai-sdlc/docs/INDEX.md`
- No state files or task folders created
- Best for well-defined, smaller tasks

### Option C: Manual Workflow (Phase-by-Phase)

Execute each phase individually for more control:
- **More control**: Run each skill/command manually
- **Flexible**: Skip phases, repeat phases as needed
- **Best for**: Specific use cases, troubleshooting, non-standard workflows

---

## Workflow Phases

All orchestrators follow similar underlying phases, adapted to task type.

### Phase 0: Initialize Framework (First Time Only)

**Command**: `/init-sdlc`

Sets up the AI SDLC framework in your project:
- Creates `.ai-sdlc/docs/` structure with INDEX.md
- Auto-detects and documents tech stack
- Generates project vision, roadmap, and standards

### Phase 1: Create Specification

**Skill**: `specification-creator`

Creates comprehensive specs through four sub-phases:
1. **Initialize**: Create task folder in `.ai-sdlc/tasks/[type]/`
2. **Research**: Gather requirements, check visual assets, identify reuse
3. **Write**: Create spec.md with user stories and acceptance criteria
4. **Verify**: Validate requirements accuracy

**Output**: `implementation/spec.md`, `analysis/requirements.md`

### Phase 2: Create Implementation Plan

**Skill**: `implementation-planner`

Breaks specification into actionable steps:
- Task groups organized by specialty (database, API, frontend, testing)
- Implementation steps with test-driven approach
- Dependencies and acceptance criteria
- Expected test count (2-8 per group)

**Output**: `implementation/implementation-plan.md`

### Phase 3: Execute Implementation

**Skill**: `implementer`

Executes the implementation plan:
- Continuous standards discovery from `docs/INDEX.md`
- Adaptive execution mode (direct/delegated/orchestrated)
- Test-driven implementation (tests → implement → verify)
- Incremental verification per task group

**Output**: Implemented code, updated plan, `work-log.md`

### Phase 4: Verify Implementation

**Skill**: `implementation-verifier`

Comprehensive quality assurance:
- Verify all implementation steps complete
- Run full test suite (entire project)
- Check standards compliance
- Validate documentation completeness
- Optional: code review, production readiness check

**Output**: `verification/implementation-verification.md`

### Phase 5: Review & Commit

Manual step:
- Review implemented changes
- Address any verification issues
- Commit to version control

---

## Optional Phases

Some orchestrators include optional phases based on task characteristics:

| Phase | Orchestrators | When Triggered |
|-------|---------------|----------------|
| **E2E Testing** | feature, enhancement | `--e2e` flag or UI-heavy feature |
| **User Documentation** | feature, enhancement | `--user-docs` flag |
| **UI Mockups** | feature, enhancement | UI keywords in spec |
| **Load Testing** | performance | Production readiness check |

---

## Resuming Interrupted Workflows

All orchestrators support resume via `*:resume` commands:

```bash
/ai-sdlc:development:resume .ai-sdlc/tasks/new-features/2025-01-15-my-feature/
/ai-sdlc:development:resume --from=8    # Resume from specific phase (0-14)
/ai-sdlc:development:resume --reset-attempts  # Reset auto-fix attempts
```

Legacy resume commands (`feature:resume`, `enhancement:resume`, `bug-fix:resume`) still work.

State is stored in `orchestrator-state.yml` within each task directory.

---

## Progress Tracking

Orchestrators use `TodoWrite` for real-time progress visibility:
- At workflow start: Creates todos for all phases (pending)
- At each phase: Marks current as `in_progress`, then `completed`
- On failure: Keeps as `in_progress`; state file tracks details

---

## Common Orchestration Patterns

All orchestrators follow shared patterns defined in `skills/orchestrator-framework/references/`:

| Pattern | Purpose |
|---------|---------|
| **Phase Execution** | 7-step loop for consistent phase management |
| **State Management** | YAML-based state persistence for pause/resume |
| **Interactive Mode** | Post-phase reviews and user decisions |
| **Initialization** | Task directory setup and state initialization |

These patterns ensure consistent behavior across all workflows. For implementation details, see the [orchestrator framework documentation](../../plugins/ai-sdlc/skills/orchestrator-framework/SKILL.md).

---

## Related Guides

- [Feature Development](./feature-development.md)
- [Bug Fixing](./bug-fixing.md)
- [Enhancement Workflow](./enhancement-workflow.md)
- [Migrations](./migrations.md)
- [Performance Optimization](./performance-optimization.md)
- [Research](./research.md)
