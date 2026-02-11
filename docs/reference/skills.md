# Skills Reference

Complete reference of all skills (workflows and utilities) in the AI SDLC plugin.

## Overview

Skills are autonomous workflows that orchestrate complex tasks. There are two types:
- **Orchestrator Skills**: Multi-phase workflows for complete task execution
- **Utility Skills**: Specialized capabilities invoked by orchestrators

## Orchestrator Framework (Shared Patterns)

All orchestrator skills share common patterns documented in `skills/orchestrator-framework/references/`:

| Pattern | File | Purpose |
|---------|------|---------|
| Phase Execution | `phase-execution-pattern.md` | 7-step loop for each phase |
| State Management | `state-management.md` | orchestrator-state.yml schema |
| Interactive Mode | `interactive-mode.md` | Post-phase prompts, user decisions |
| Initialization | `initialization-pattern.md` | Startup sequence, directory setup |

This is a **non-executable reference skill** - it provides documentation, not workflow execution. All orchestrators reference these patterns via relative paths (`../orchestrator-framework/references/`).

[Framework Documentation](../../plugins/ai-sdlc/skills/orchestrator-framework/SKILL.md)

---

## Orchestrator Skills

### development-orchestrator
**Purpose**: Unified workflow for bug fixes, enhancements, and new features

**Phases**: 15 adaptive phases (0-14) that adjust based on task type

**Key Features**:
- Auto-detects task type from description keywords (or use `--type=bug|enhancement|feature`)
- TDD Red→Green gates mandatory for bugs (Phases 3, 9)
- Gap analysis and codebase analysis for all task types
- Optional UI mockup generation for UI-heavy work
- Optional E2E testing and user documentation
- Dual execution modes (Interactive/YOLO)
- State management for pause/resume
- Auto-recovery from failures

**Use When**: Building new features, improving existing features, or fixing bugs

**Commands**:
- `/ai-sdlc:development:new` - Start unified workflow (recommended)
- `/ai-sdlc:development:resume` - Resume interrupted workflow

**Legacy Commands** (still work as aliases):
- `/ai-sdlc:feature:new` → `/ai-sdlc:development:new --type=feature`
- `/ai-sdlc:enhancement:new` → `/ai-sdlc:development:new --type=enhancement`
- `/ai-sdlc:bug-fix:new` → `/ai-sdlc:development:new --type=bug`

**Task Directories**:
- Features: `.ai-sdlc/tasks/new-features/`
- Enhancements: `.ai-sdlc/tasks/enhancements/`
- Bug fixes: `.ai-sdlc/tasks/bug-fixes/`

[Skill Documentation](../../plugins/ai-sdlc/skills/development-orchestrator/SKILL.md)

---

### performance-orchestrator
**Purpose**: Performance optimization with benchmarking

**Phases**: 5 (Baseline & Profiling → Bottleneck Analysis → Implementation → Verification → Load Testing)

**Key Features**:
- Benchmark-driven optimization
- Bottleneck detection (N+1 queries, missing indexes)
- Prove every improvement with metrics
- Load testing for production readiness

**Use When**: Application slow, high resource usage

**Command**: `/ai-sdlc:performance:new`

[Detailed Guide](../guides/performance-optimization.md) | [Skill Documentation](../../skills/performance-orchestrator/SKILL.md)

---

### migration-orchestrator
**Purpose**: Technology and pattern migrations

**Phases**: 6 (Current State → Target State → Strategy → Rollback Planning → Implementation → Cutover Verification)

**Key Features**:
- Auto-classifies migration type (code/data/architecture)
- Recommends strategy (incremental/big-bang/dual-run/phased)
- Rollback procedures for every phase
- Dual-run support for data migrations

**Use When**: Technology upgrades, platform changes

**Command**: `/ai-sdlc:migration:new`

[Detailed Guide](../guides/migrations.md) | [Skill Documentation](../../skills/migration-orchestrator/SKILL.md)

---

### research-orchestrator
**Purpose**: Systematic research workflows

**Phases**: 5 (Planning → Information Gathering → Analysis & Synthesis → Documentation → Verification)

**Key Features**:
- Multi-source data collection (codebase, docs, web)
- Evidence-based findings with citations
- Adapts methodology by research type
- Reusable research artifacts

**Use When**: Understanding codebase, exploring best practices

**Command**: `/ai-sdlc:research:new`

[Detailed Guide](../guides/research.md) | [Skill Documentation](../../skills/research-orchestrator/SKILL.md)

---

## Utility Skills

### codebase-analyzer
**Purpose**: Deep codebase analysis using parallel exploration agents

**Process**: Adaptively select agent roles from a pool based on task complexity → Launch parallel Explore subagents → Delegate to `codebase-analysis-reporter` subagent for report synthesis

**Agent Roles** (selected per task):
- **File Discovery**: Locate relevant files by patterns and keywords
- **Code Analysis**: Deep dive into file implementations
- **Context Discovery**: Build integration patterns and dependencies
- **Pattern Mining**: Find similar implementations to use as templates
- **Migration Target**: Analyze target technology and compatibility

**Key Feature**: Task-type aware prompts (bug vs enhancement vs feature focus)

**Invoked By**: development-orchestrator (Phase 0), other orchestrators

**Output**: `analysis/codebase-analysis.md`

[Skill Documentation](../../plugins/ai-sdlc/skills/codebase-analyzer/SKILL.md)

---

### specification-creator
**Purpose**: Create comprehensive specifications

**Process**: Initialize → Research → Write → Verify

**Invoked By**: All orchestrators during specification phase

**Output**: `spec.md`, `requirements.md`

[Skill Documentation](../../skills/specification-creator/SKILL.md)

---

### implementation-planner
**Purpose**: Break work into implementation steps

**Process**: Analyze spec → Determine task groups → Create steps → Set dependencies → Define acceptance criteria

**Invoked By**: All orchestrators during planning phase

**Output**: `implementation-plan.md`

[Skill Documentation](../../skills/implementation-planner/SKILL.md)

---

### implementer
**Purpose**: Execute implementation plans with standards discovery

**Execution Modes**:
- Direct (1-3 steps)
- Plan-Execute (4-8 steps)
- Orchestrated (9+ steps)

**Key Feature**: Continuous standards discovery from INDEX.md

**Invoked By**: All orchestrators during implementation phase

**Output**: Code changes, `work-log.md`

[Skill Documentation](../../skills/implementer/SKILL.md)

---

### implementation-verifier
**Purpose**: Verify implementation complete and production-ready

**Verification Aspects**:
- Implementation completeness
- Full test suite execution
- Standards compliance
- Documentation completeness
- Optional code review
- Optional production readiness check

**Invoked By**: All orchestrators during verification phase

**Output**: `implementation-verification.md` with PASS/FAIL verdict

[Skill Documentation](../../skills/implementation-verifier/SKILL.md)

---

### code-reviewer
**Purpose**: Automated code quality, security, and performance analysis

**Analysis Scope**:
- Code quality (complexity, duplication, smells)
- Security (vulnerabilities, secrets, injection)
- Performance (N+1 queries, inefficiency)
- Best practices

**Invoked By**: implementation-verifier (optional), standalone command

**Output**: `code-review-report.md`

**Command**: `/ai-sdlc:code-review:review`

[Skill Documentation](../../skills/code-reviewer/SKILL.md)

---

### production-readiness-checker
**Purpose**: Deployment readiness verification

**Verification Categories**:
- Configuration management
- Monitoring & observability
- Error handling & resilience
- Performance & scalability
- Security hardening
- Deployment considerations

**Invoked By**: implementation-verifier (optional), standalone command

**Output**: `production-readiness-report.md` with GO/NO-GO decision

**Command**: `/ai-sdlc:deployment:check-readiness`

[Skill Documentation](../../skills/production-readiness-checker/SKILL.md)

---

### docs-manager
**Purpose**: Manage `.ai-sdlc/docs/` structure and standards

**Capabilities**:
- Initialize documentation structure
- Maintain INDEX.md
- Manage project documentation
- Manage technical standards
- Discover standards from codebase

**Commands**: `/init-sdlc`, `/ai-sdlc:standards:discover`, `/ai-sdlc:standards:update`

[Skill Documentation](../../skills/docs-manager/SKILL.md)

---

### task-classifier
**Purpose**: Auto-classify task descriptions

**Classification Types**: 6 types (new-feature, bug-fix, enhancement, performance, migration, research)

**Invoked By**: `/work` command

**Output**: Classification with confidence score

[Skill Documentation](../../skills/task-classifier/SKILL.md)

---

## Skill Invocation

Skills are invoked automatically by:
1. **Commands** - Slash commands invoke orchestrator skills
2. **Orchestrators** - Orchestrator skills invoke utility skills
3. **Agents** - Some skills delegate to specialized agents

Users typically interact with orchestrator skills via commands, not directly.

---

## Related Resources

- [Commands Reference](commands.md) - All available commands
- [Agents Reference](agents.md) - Specialized agents
- [Architecture](../Architecture.md) - How skills work internally

---

**Complete reference for all AI SDLC plugin skills**
