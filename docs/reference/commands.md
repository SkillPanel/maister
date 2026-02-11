# Commands Reference

Complete reference of all available slash commands in the AI SDLC plugin.

## Table of Contents

- [Workflow Commands](#workflow-commands)
- [Resume Commands](#resume-commands)
- [Utility Commands](#utility-commands)
- [Command Syntax](#command-syntax)
- [Common Options](#common-options)

---

## Workflow Commands

Commands to start new workflows for different task types.

### /work

**Auto-classify and route to appropriate workflow**

```bash
/work [description]
```

The `/work` command analyzes your task description and automatically classifies it to route to the best workflow. Most intelligent starting point when you're not sure which workflow to use.

**Classification**:
- Analyzes codebase context (enhancement vs new-feature)
- Fetches GitHub/Jira issues for context
- Shows confidence score and proposed workflow
- Requests confirmation before proceeding

**Examples**:
```bash
/work "Add sorting to user table"                                 # → enhancement
/work "Fix login timeout error"                                   # → bug-fix
/work "Optimize dashboard loading time"                           # → performance
```

---

### /init-sdlc

**Initialize AI SDLC framework**

```bash
/init-sdlc
```

Sets up `.ai-sdlc/` directory structure with intelligent, elastic documentation generation. Run this once when first using the plugin in a project.

**What it does**:
1. Analyzes codebase (project type, tech stack, architecture)
2. Prompts for documentation selection (vision, roadmap, tech-stack, architecture)
3. Prompts for standards selection (frontend, backend, testing, global)
4. Generates selected documentation with smart defaults
5. Creates task organization folders

**Output**: `.ai-sdlc/docs/` with INDEX.md, selected project docs, and selected standards

---

### /ai-sdlc:development:new (Recommended)

**Unified development workflow for bugs, enhancements, and features**

```bash
/ai-sdlc:development:new [description] [options]
```

The recommended way to start any development task. Auto-detects task type from description or use `--type` flag.

**Options**:
- `--type=TYPE` - Task type: `bug`, `enhancement`, or `feature` (auto-detected if omitted)
- `--yolo` - Run in continuous mode without pausing
- `--from=PHASE` - Start from specific phase (0-14)
- `--e2e` - Auto-enable E2E testing
- `--user-docs` - Auto-enable user documentation

**Phases**: 15 adaptive phases (0-14) that adjust based on task type

**Task Directories**:
- Features: `.ai-sdlc/tasks/new-features/`
- Enhancements: `.ai-sdlc/tasks/enhancements/`
- Bug fixes: `.ai-sdlc/tasks/bug-fixes/`

**Examples**:
```bash
/ai-sdlc:development:new "Add user profile page"              # auto-detects as feature
/ai-sdlc:development:new "Fix login timeout" --type=bug       # explicit bug fix
/ai-sdlc:development:new "Add sorting to table" --type=enhancement --yolo
```

[Skill Documentation](../../plugins/ai-sdlc/skills/development-orchestrator/SKILL.md)

---

### /ai-sdlc:quick:plan

**Enter planning mode with standards awareness**

```bash
/ai-sdlc:quick:plan [task description]
```

Low-friction entry point that enters Claude Code's planning mode while automatically discovering and applying project standards from `.ai-sdlc/docs/INDEX.md`.

**Best For**: Well-understood tasks needing planning but not full orchestration

**Example**:
```bash
/ai-sdlc:quick:plan "Add pagination to user list"
```

---

### /ai-sdlc:quick:dev

**Direct implementation with standards awareness**

```bash
/ai-sdlc:quick:dev [task description]
```

Immediately starts implementation (no planning mode) while automatically discovering and applying project standards from `.ai-sdlc/docs/INDEX.md`.

**Best For**: Small, well-defined tasks where requirements are clear

**Example**:
```bash
/ai-sdlc:quick:dev "Add email validation to signup form"
```

---

## Legacy Development Commands

These commands still work but route to the unified `development-orchestrator`:

### /ai-sdlc:feature:new

**Alias for**: `/ai-sdlc:development:new --type=feature`

```bash
/ai-sdlc:feature:new [description] [options]
```

**Examples**:
```bash
/ai-sdlc:feature:new "Add user profile page with avatar upload"
/ai-sdlc:feature:new "Build admin dashboard" --e2e --user-docs
```

[Detailed Guide](../guides/feature-development.md)

---

### /ai-sdlc:bug-fix:new

**Alias for**: `/ai-sdlc:development:new --type=bug`

```bash
/ai-sdlc:bug-fix:new [description] [options]
```

**Key Feature**: Mandatory TDD Red→Green discipline (test must fail before fix, pass after)

**Examples**:
```bash
/ai-sdlc:bug-fix:new "Login timeout after 5 minutes of inactivity"
/ai-sdlc:bug-fix:new "Null pointer exception in profile" --yolo
```

[Detailed Guide](../guides/bug-fixing.md)

---

### /ai-sdlc:enhancement:new

**Alias for**: `/ai-sdlc:development:new --type=enhancement`

```bash
/ai-sdlc:enhancement:new [description] [options]
```

**Key Feature**: Analyzes existing feature first, ensures backward compatibility

**Examples**:
```bash
/ai-sdlc:enhancement:new "Add sorting and filtering to user table"
/ai-sdlc:enhancement:new "Add export to CSV" --yolo
```

[Detailed Guide](../guides/enhancement-workflow.md)

---

### /ai-sdlc:performance:new

**Start performance optimization**

```bash
/ai-sdlc:performance:new [description] [options]
```

**Options**:
- `--yolo` - Run in continuous mode
- `--from=PHASE` - Start from specific phase

**Phases**: 5 phases (Baseline & Profiling → Bottleneck Analysis → Implementation → Verification → Load Testing)

**Key Feature**: Benchmark-driven optimization (prove every improvement with metrics)

**Examples**:
```bash
/ai-sdlc:performance:new "Optimize dashboard loading time"
```

[Detailed Guide](../guides/performance-optimization.md)

---

### /ai-sdlc:migration:new

**Start migration workflow**

```bash
/ai-sdlc:migration:new [description] [options]
```

**Options**:
- `--yolo` - Run in continuous mode
- `--from=PHASE` - Start from specific phase
- `--type=TYPE` - Migration type (code/data/architecture)

**Phases**: 6 phases (Current State → Target State → Strategy → Rollback Planning → Implementation → Cutover Verification)

**Key Feature**: Auto-classifies migration type, recommends strategy, rollback procedures for every phase

**Examples**:
```bash
/ai-sdlc:migration:new "Migrate from REST API to GraphQL"
```

[Detailed Guide](../guides/migrations.md)

---

### /ai-sdlc:research:new

**Start research workflow**

```bash
/ai-sdlc:research:new [research-question] [options]
```

**Options**:
- `--yolo` - Run in continuous mode
- `--type=TYPE` - Research type (technical/requirements/literature/mixed)
- `--verify` - Enable verification phase
- `--integrate` - Enable integration phase

**Phases**: 5 phases (Planning → Information Gathering → Analysis & Synthesis → Documentation → Verification [optional])

**Key Feature**: Multi-source data collection with citations, evidence-based findings

**Examples**:
```bash
/ai-sdlc:research:new "How does the payment processing system work?"
```

[Detailed Guide](../guides/research.md)

---

## Resume Commands

Commands to resume interrupted workflows.

### /ai-sdlc:development:resume (Recommended)

```bash
/ai-sdlc:development:resume [task-path] [options]
```

Resume interrupted development workflows (bugs, enhancements, or features).

**Options**:
- `--from=PHASE` - Override resume point (0-14)
- `--reset-attempts` - Reset auto-fix attempt counters
- `--clear-failures` - Clear failure history
- `--reconstruct` - Reconstruct state from artifacts if state file lost

**Example**:
```bash
/ai-sdlc:development:resume .ai-sdlc/tasks/new-features/2025-11-17-user-profile
/ai-sdlc:development:resume [path] --from=8 --reset-attempts
```

---

### Legacy Resume Commands

These still work but route to the unified development-orchestrator:

```bash
/ai-sdlc:feature:resume [task-path] [options]
/ai-sdlc:bug-fix:resume [task-path] [options]
/ai-sdlc:enhancement:resume [task-path] [options]
```

---

### Other Resume Commands

All other workflows support resume with similar syntax:

```bash
/ai-sdlc:performance:resume [task-path] [options]
/ai-sdlc:migration:resume [task-path] [options]
/ai-sdlc:research:resume [task-path] [options]
```

---

## Utility Commands

### /ai-sdlc:standards:discover

**Auto-discover coding standards**

```bash
/ai-sdlc:standards:discover [options]
```

**Options**:
- `--scope=SCOPE` - Discovery scope (full/frontend/backend/testing/quick)
- `--confidence=N` - Minimum confidence score (0-10)
- `--auto-apply` - Automatically create standards files

**What it does**:
- Analyzes configuration files (eslint, prettier, etc.)
- Examines code patterns
- Reviews documentation
- Scans pull requests
- Checks CI/CD configs

**Output**: Discovery report + created/updated standards in `.ai-sdlc/docs/standards/`

**Example**:
```bash
/ai-sdlc:standards:discover --scope=frontend --confidence=7
```

---

### /ai-sdlc:standards:update

**Update or create project standards**

```bash
/ai-sdlc:standards:update [standard-path]
```

Auto-extracts conventions from conversation context or explicit input. Categorizes by type (global/frontend/backend/testing) and updates INDEX.md.

**Example**:
```bash
/ai-sdlc:standards:update .ai-sdlc/docs/standards/frontend/component-patterns.md
```

---

### /ai-sdlc:reviews:code

**Run automated code quality analysis**

```bash
/ai-sdlc:reviews:code [path] [--scope=SCOPE]
```

**Scope options**:
- `all` - Quality, security, performance (default)
- `quality` - Code quality only
- `security` - Security only
- `performance` - Performance only

**Output**: `code-review-report.md` with findings by severity

**Example**:
```bash
/ai-sdlc:reviews:code src/ --scope=all
```

---

### /ai-sdlc:reviews:pragmatic

**Check for over-engineering**

```bash
/ai-sdlc:reviews:pragmatic [path]
```

Detects over-engineering, unnecessary complexity, and ensures code matches project scale.

**Output**: `pragmatic-review-report.md` with complexity assessment

**Example**:
```bash
/ai-sdlc:reviews:pragmatic src/components/
```

---

### /ai-sdlc:reviews:spec-audit

**Audit specification completeness**

```bash
/ai-sdlc:reviews:spec-audit [spec-path]
```

Independent specification audit before implementation. Verifies completeness, detects ambiguities, validates implementability.

**Output**: `spec-audit-report.md` with PASS/FAIL verdict

**Example**:
```bash
/ai-sdlc:reviews:spec-audit .ai-sdlc/tasks/new-features/2025-11-17-feature/implementation/spec.md
```

---

### /ai-sdlc:reviews:reality-check

**Validate work actually solves problem**

```bash
/ai-sdlc:reviews:reality-check [task-path]
```

Comprehensive reality assessment. Ensures work solves actual problem and is production-ready.

**Output**: `reality-assessment-report.md` with action plan

**Example**:
```bash
/ai-sdlc:reviews:reality-check .ai-sdlc/tasks/new-features/2025-11-17-feature
```

---

### /ai-sdlc:reviews:production-readiness

**Verify production deployment readiness**

```bash
/ai-sdlc:reviews:production-readiness [path] [--target=ENV]
```

**Target options**:
- `prod` - Production environment (default)
- `staging` - Staging environment

**Output**: `production-readiness-report.md` with GO/NO-GO decision

**Example**:
```bash
/ai-sdlc:reviews:production-readiness src/ --target=prod
```

---

## Command Syntax

### General Pattern

```bash
/ai-sdlc:[workflow]:[action] [arguments] [options]
```

**Components**:
- `workflow` - Workflow type (feature, bug-fix, enhancement, etc.)
- `action` - Action to perform (new, resume, status)
- `arguments` - Required parameters (description, path)
- `options` - Optional flags (--yolo, --from, etc.)

### Shortcuts

- `/work` - Auto-classify and route (no workflow prefix needed)
- `/init-sdlc` - Initialize framework (no workflow prefix needed)

---

## Common Options

### Execution Mode

**`--yolo`** - YOLO mode (continuous execution)
- Runs all phases without pausing
- Auto-decides on optional phases
- Best for: Simple tasks, experienced users

**Default** - Interactive mode
- Pauses between phases for review
- Prompts for optional phases
- Best for: Complex tasks, careful review

### Resume Options

**`--from=PHASE`** - Start/resume from specific phase
- Override default resume point
- Skip completed phases
- Values: phase names (spec, plan, implement, verify, etc.)

**`--reset-attempts`** - Reset auto-fix attempt counters
- Use when auto-recovery exhausted
- Gives fresh attempts for error recovery

**`--clear-failures`** - Clear failure history
- Remove previous failure records
- Clean slate for resuming

**`--reconstruct`** - Reconstruct state from artifacts
- Use when state file corrupted/missing
- Reads spec.md, implementation-plan.md to rebuild state

### Optional Phase Enablement

**`--e2e`** - Auto-enable E2E testing
- Skip prompt, always run E2E tests
- For UI features

**`--user-docs`** - Auto-enable user documentation
- Skip prompt, always generate user docs
- For user-facing features

---

## Command Categories

### By Task Type

| Task Type | New Command | Resume Command |
|-----------|-------------|----------------|
| **Development** (Unified) | `/ai-sdlc:development:new` | `/ai-sdlc:development:resume` |
| Performance | `/ai-sdlc:performance:new` | `/ai-sdlc:performance:resume` |
| Migration | `/ai-sdlc:migration:new` | `/ai-sdlc:migration:resume` |
| Research | `/ai-sdlc:research:new` | `/ai-sdlc:research:resume` |

**Legacy Commands** (aliases to development):

| Task Type | Legacy Command | Equivalent |
|-----------|----------------|------------|
| New Feature | `/ai-sdlc:feature:new` | `/ai-sdlc:development:new --type=feature` |
| Bug Fix | `/ai-sdlc:bug-fix:new` | `/ai-sdlc:development:new --type=bug` |
| Enhancement | `/ai-sdlc:enhancement:new` | `/ai-sdlc:development:new --type=enhancement` |

### By Purpose

**Starting Work**:
- `/work` - Auto-route to best workflow
- `/ai-sdlc:development:new` - Unified workflow for bugs/enhancements/features (recommended)
- `/ai-sdlc:[workflow]:new` - Start other specific workflows

**Quick Development** (low-friction):
- `/ai-sdlc:quick:plan` - Planning mode with standards awareness
- `/ai-sdlc:quick:dev` - Direct implementation with standards awareness

**Managing Work**:
- `/ai-sdlc:development:resume` - Resume interrupted development work
- `/ai-sdlc:[workflow]:resume` - Resume other workflows
**Quality Assurance**:
- `/ai-sdlc:reviews:code` - Code quality analysis
- `/ai-sdlc:reviews:pragmatic` - Over-engineering check
- `/ai-sdlc:reviews:spec-audit` - Specification audit
- `/ai-sdlc:reviews:reality-check` - Reality validation
- `/ai-sdlc:reviews:production-readiness` - Deployment readiness

**Standards Management**:
- `/ai-sdlc:standards:discover` - Auto-discover standards
- `/ai-sdlc:standards:update` - Update standards

**Setup**:
- `/init-sdlc` - Initialize framework

---

## Related Resources

- [Workflow Guides](../guides/) - Detailed guides for each workflow
- [Architecture](../Architecture.md) - How commands work internally
- [Troubleshooting](../Troubleshooting.md) - Common command issues

---

**Quick reference for all AI SDLC plugin commands**
