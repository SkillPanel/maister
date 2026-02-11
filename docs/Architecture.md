# Architecture Overview

This document explains how the AI SDLC plugin is architected, how components interact, and how workflows execute from user command to completion.

## System Overview

The AI SDLC plugin is built on four core component types that work together to provide structured development workflows:

```
┌─────────────────────────────────────────────────────────────┐
│                         User Input                           │
│                    (Slash Commands)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Command Layer                              │
│  (/work, /ai-sdlc:feature:new, /ai-sdlc:bug-fix:new, ...)  │
│                                                              │
│  - Auto-classification (task-classifier agent)              │
│  - Input validation                                         │
│  - Workflow routing                                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Skill Layer                               │
│  (feature-orchestrator, bug-fix-orchestrator, ...)          │
│                                                              │
│  - Workflow orchestration                                   │
│  - Phase management                                         │
│  - State persistence                                        │
│  - Auto-recovery logic                                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Layer                               │
│  (Specialized subagents for specific tasks)                 │
│                                                              │
│  - Analysis agents (gap-analyzer, bottleneck-analyzer)       │
│  - Planning agents (implementation-planner, research-planner)│
│  - Verification agents (spec-auditor, e2e-verifier)         │
│  - Utility agents (ui-mockup-generator, task-classifier)    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Execution Output                            │
│                                                              │
│  - Task directories (.ai-sdlc/tasks/[type]/...)            │
│  - Documentation files (spec.md, work-log.md)               │
│  - Code changes (actual implementation)                     │
│  - Verification reports (verification/*.md)                 │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Commands (User Interface Layer)

Commands are the user-facing entry points, implemented as slash commands in Claude Code.

**Location**: `commands/` directory

**Purpose**:
- Accept user input and parameters
- Route to appropriate skills
- Provide user-friendly interface

**Types**:

| Category | Commands | Example |
|----------|----------|---------|
| **Workflow Entry** | `/work` | Auto-classifies and routes to workflow |
| **Specific Workflows** | `/ai-sdlc:feature:new` | Starts specific workflow directly |
| **Resume Commands** | `/ai-sdlc:feature:resume` | Resumes interrupted workflow |
| **Utility Commands** | `/init-sdlc` | Framework initialization |
| **Status Commands** | `/ai-sdlc:initiative:status` | Progress tracking |

**Example Command Flow**:

```
User types: /work "Add user profile page"
     ↓
Command invokes: task-classifier agent
     ↓
Classifier returns: "new-feature" (95% confidence)
     ↓
Command routes to: feature-orchestrator skill
     ↓
Skill executes: 6-phase workflow
```

### 2. Skills (Workflow Orchestration Layer)

Skills are autonomous workflows that orchestrate complex multi-phase tasks.

**Location**: `skills/` directory

**Purpose**:
- Orchestrate multi-phase workflows
- Manage workflow state
- Handle auto-recovery
- Delegate to specialized agents

#### Shared Orchestration Framework

All orchestrators use common patterns from `skills/orchestrator-framework/references/`:

| Pattern | Purpose |
|---------|---------|
| **Phase Execution Loop** | 7-step pattern for consistent phase management |
| **State Management** | orchestrator-state.yml schema for pause/resume |
| **Interactive Mode** | Post-phase reviews and user decisions |
| **Initialization** | Task directory and state setup |

This reduces duplication (~64% line reduction) and ensures consistent behavior across all orchestrators. Each orchestrator references these patterns via relative paths and implements domain-specific logic.

See: `skills/orchestrator-framework/SKILL.md`

**Architecture of a Skill**:

```
skills/feature-orchestrator/
├── SKILL.md              # Main skill documentation
├── references/           # Conceptual guides
│   ├── phases.md        # Phase workflow details
│   ├── state-management.md
│   └── auto-fix-strategies.md
└── assets/              # Templates (optional)
    └── spec-template.md
```

**Key Orchestrator Skills**:

```
Orchestrator Skills (4 total):
├── development-orchestrator   → Unified workflow: bugs, enhancements, features (15 phases)
├── performance-orchestrator   → Performance optimization (5 phases)
├── migration-orchestrator     → Tech migrations (6 phases)
└── research-orchestrator      → Research workflows (8 phases)
```

**Utility Skills (8 total)**:
- `specification-creator` - Creates detailed specifications
- `implementation-planner` - Breaks work into implementation steps
- `implementer` - Executes implementation plans
- `implementation-verifier` - Verifies completed implementations
- `code-reviewer` - Automated code quality/security/performance review
- `production-readiness-checker` - Deployment readiness verification
- `docs-manager` - Manages `.ai-sdlc/docs/` structure
- `task-classifier` - Auto-classifies task descriptions

### 3. Agents (Specialized Execution Layer)

Agents are focused subagents that perform specific analysis, planning, or verification tasks.

**Location**: `agents/` directory

**Purpose**:
- Perform specialized tasks (read-only analysis, planning, verification)
- Provide expertise in specific domains
- Return structured results to skills

**Agent Categories**:

```
Analysis Agents:
├── project-analyzer           → Deep codebase analysis
├── bottleneck-analyzer        → Performance bottleneck detection
├── gap-analyzer              → Gap detection and user journey analysis
└── codebase-analysis-reporter → Merge parallel findings into report

Planning Agents:
├── research-planner           → Research methodology planning
└── implementation-changes-planner → Change plans without modifying files

Verification Agents:
├── e2e-test-verifier           → Browser-based E2E testing
├── spec-auditor                → Independent spec verification
└── reality-assessor            → Multi-agent validation orchestrator

Utility Agents:
├── task-classifier             → Auto-classify task descriptions
├── ui-mockup-generator         → ASCII mockups with component refs
├── user-docs-generator         → User documentation with screenshots
├── information-gatherer        → Multi-source data collection
├── research-synthesizer        → Research findings synthesis
└── code-quality-pragmatist     → Over-engineering detection
```

**Agent Execution Model**:

```
Skill invokes agent
     ↓
Agent receives context + task
     ↓
Agent performs specialized work (read-only or analysis)
     ↓
Agent returns structured result
     ↓
Skill continues workflow with result
```

### 4. Documentation & Standards (Knowledge Layer)

The `.ai-sdlc/docs/` directory contains project-specific documentation and standards.

**Purpose**:
- Provide project context to all workflows
- Define coding standards and conventions
- Track project vision, roadmap, tech stack
- Serve as single source of truth

**Structure**:

```
.ai-sdlc/docs/
├── INDEX.md                  # Master index (READ THIS FIRST)
│
├── project/                  # Project-level documentation
│   ├── vision.md            # Project goals and vision
│   ├── roadmap.md           # Development roadmap
│   ├── tech-stack.md        # Technology choices
│   ├── architecture.md      # System architecture (optional)
│   └── initiatives/         # Epic-level initiative tracking
│       └── YYYY-MM-DD-initiative-name/
│
└── standards/                # Technical standards
    ├── global/              # Language-agnostic standards
    │   ├── naming-conventions.md
    │   ├── code-organization.md
    │   └── documentation.md
    ├── frontend/            # Frontend-specific
    │   ├── component-patterns.md
    │   ├── state-management.md
    │   └── styling.md
    ├── backend/             # Backend-specific
    │   ├── api-design.md
    │   ├── database-conventions.md
    │   └── error-handling.md
    └── testing/             # Testing standards
        ├── unit-testing.md
        ├── integration-testing.md
        └── e2e-testing.md
```

**Continuous Standards Discovery**:

Skills and agents check `INDEX.md` throughout execution, not just at start:

```
Phase 1: Specification
     ↓ Check INDEX.md for project vision and tech stack
Phase 2: Planning
     ↓ Check INDEX.md for standards relevant to task groups
Phase 3: Implementation
     ↓ Check INDEX.md before each task group
     ↓ Check INDEX.md before each implementation step
     ↓ Check INDEX.md before applying changes
Phase 4: Verification
     ↓ Check INDEX.md for all standards (ensure nothing missed)
```

## Workflow Execution Flow

Let's trace a complete workflow execution from start to finish:

### Example: New Feature Development

**User Command**:
```bash
/ai-sdlc:feature:new "Add user profile page with avatar upload"
```

**Execution Flow**:

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 0: Initialization                                     │
├─────────────────────────────────────────────────────────────┤
│ feature-orchestrator skill starts                           │
│   → Validates input                                         │
│   → Creates task directory                                  │
│   → Initializes state management                            │
│   → Checks .ai-sdlc/docs/INDEX.md                          │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Specification                                      │
├─────────────────────────────────────────────────────────────┤
│ Invokes: specification-creator skill                        │
│   → Gathers requirements via Q&A                            │
│   → Checks for visual assets                               │
│   → Identifies reusability opportunities                    │
│   → Creates spec.md                                         │
│   → Verifies specification completeness                     │
│                                                              │
│ Output: implementation/spec.md, analysis/requirements.md    │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Implementation Planning                            │
├─────────────────────────────────────────────────────────────┤
│ Invokes: implementation-planner skill                       │
│   → Reads spec.md                                           │
│   → Determines task groups (DB, API, Frontend, Testing)    │
│   → Creates implementation steps (2-8 per group)            │
│   → Sets dependencies between groups                        │
│   → Defines acceptance criteria                            │
│                                                              │
│ Output: implementation/implementation-plan.md               │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Implementation                                     │
├─────────────────────────────────────────────────────────────┤
│ Invokes: implementer skill                                  │
│   → Loads implementation-plan.md                            │
│   → Checks INDEX.md for standards (continuous)              │
│   → Selects execution mode (direct/plan-execute/orchestrate)│
│   → For each task group:                                    │
│       → Checks specialty-specific standards                 │
│       → For each step:                                      │
│           → Writes tests first (TDD)                        │
│           → Implements functionality                        │
│           → Runs tests for this group                       │
│           → Updates work-log.md                             │
│       → Marks group complete                                │
│   → Final standards compliance check                        │
│                                                              │
│ May delegate to: implementation-changes-planner agent       │
│                                                              │
│ Output: Code changes, updated implementation-plan.md,       │
│         implementation/work-log.md                          │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Verification                                       │
├─────────────────────────────────────────────────────────────┤
│ Invokes: implementation-verifier skill                      │
│   → Verifies all implementation steps complete              │
│   → Runs FULL project test suite (not just feature tests)  │
│   → Checks standards compliance against INDEX.md            │
│   → Validates documentation completeness                    │
│   → (Optional) Invokes code-reviewer skill                  │
│   → (Optional) Invokes production-readiness-checker skill   │
│   → Creates comprehensive verification report               │
│   → Updates roadmap if exists                               │
│                                                              │
│ Output: verification/implementation-verification.md         │
│         Overall Status: PASSED/PASSED WITH ISSUES/FAILED    │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 5 (Optional): E2E Testing                            │
├─────────────────────────────────────────────────────────────┤
│ Invokes: e2e-test-verifier agent                           │
│   → Uses Playwright to test UI workflows                    │
│   → Captures screenshots of each step                       │
│   → Validates acceptance criteria                           │
│   → Creates E2E verification report                         │
│                                                              │
│ Output: verification/e2e-verification-report.md             │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 6 (Optional): User Documentation                     │
├─────────────────────────────────────────────────────────────┤
│ Invokes: user-docs-generator agent                         │
│   → Creates user-friendly documentation                     │
│   → Captures screenshots using Playwright                   │
│   → Writes step-by-step instructions                        │
│   → Includes troubleshooting tips                           │
│                                                              │
│ Output: documentation/user-guide.md, screenshots/           │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Completion                                                   │
├─────────────────────────────────────────────────────────────┤
│ feature-orchestrator finalizes:                             │
│   → Updates metadata.yml (status: completed)                │
│   → Persists final state                                    │
│   → Returns summary to user                                 │
└─────────────────────────────────────────────────────────────┘
```

## State Management

All workflows support pause/resume through file-based state management.

### State File Location

```
.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/
└── orchestrator-state.yml
```

### State Contents

```yaml
workflow: feature
current_phase: implementation
phase_history:
  - specification: completed
  - planning: completed
  - implementation: in_progress
execution_mode: interactive
options:
  yolo: false
  e2e: true
  user_docs: false
auto_fix_attempts:
  implementation: 1
failures: []
created_at: 2025-11-17T10:30:00Z
updated_at: 2025-11-17T11:00:00Z
```

### Resume Mechanism

```
User: /ai-sdlc:feature:resume [task-path]
     ↓
Command reads orchestrator-state.yml
     ↓
Validates state consistency
     ↓
feature-orchestrator skill resumes from current_phase
     ↓
Continues execution
```

## Auto-Recovery System

Workflows include intelligent auto-recovery for common failure scenarios.

### Auto-Recovery Flow

```
Phase execution starts
     ↓
Error detected (test failure, syntax error, etc.)
     ↓
Check auto_fix_attempts[phase] < max_attempts
     ↓
If within limit:
     ↓
     Apply auto-fix strategy for error type
     ↓
     Retry phase execution
     ↓
     Update auto_fix_attempts counter
     ↓
If exceeds limit or unfixable:
     ↓
     Persist state with failure details
     ↓
     HALT and report to user
```

### Common Auto-Fix Strategies

| Error Type | Strategy |
|------------|----------|
| Missing dependency | Install dependency, retry |
| Linting errors | Apply auto-fix, retry |
| Test failures (transient) | Re-run tests (max 2 retries) |
| Import errors | Fix import paths, retry |
| Syntax errors | Correct syntax, retry |

**Hard Stop Scenarios** (No auto-fix):
- Test failures after 2 retries (indicates logic error)
- Compilation errors after auto-fix
- Behavior changes in refactoring
- Security vulnerabilities introduced
- Breaking changes in enhancements

## Extension Points

The plugin is designed for extensibility at multiple levels.

### 1. Adding New Skills

Create a new skill directory:

```
skills/my-custom-orchestrator/
├── SKILL.md              # Skill documentation
├── references/           # Conceptual guides (optional)
│   └── workflow.md
└── assets/              # Templates (optional)
```

Register in `plugin.json`:

```json
{
  "skills": {
    "my-custom-orchestrator": {
      "description": "Custom workflow for ...",
      "location": "skills/my-custom-orchestrator"
    }
  }
}
```

### 2. Adding New Commands

Create command file:

```
commands/my-workflow/
├── new.md               # Start new workflow
└── resume.md            # Resume workflow
```

Commands invoke skills or agents as needed.

### 3. Adding New Agents

Create agent file:

```
agents/my-custom-analyzer.md
```

Document:
- Purpose and capabilities
- Workflow/process
- Tools access
- Input/output format
- Usage examples

Agents are invoked by skills via the Task tool.

### 4. Adding New Standards

Create standard files:

```
.ai-sdlc/docs/standards/[category]/my-standard.md
```

Update `INDEX.md` to reference the new standard. Skills will automatically discover and apply it during continuous standards checking.

## Directory Structure Reference

Complete directory structure of the plugin:

```
ai-sdlc/
├── CLAUDE.md                     # Comprehensive plugin documentation
├── README.md                     # User-facing overview
│
├── .claude-plugin/
│   └── plugin.json              # Plugin metadata
│
├── docs/                         # User documentation
│   ├── Quick-Start.md
│   ├── Architecture.md          # This file
│   ├── Troubleshooting.md
│   ├── Contributing.md
│   ├── guides/                  # Workflow-specific guides
│   ├── reference/               # Command/skill/agent reference
│   └── concepts/                # Advanced concepts
│
├── skills/                       # Skill implementations (18 total)
│   ├── feature-orchestrator/
│   ├── bug-fix-orchestrator/
│   ├── enhancement-orchestrator/
│   ├── ...
│   └── [skill-name]/
│       ├── SKILL.md
│       ├── references/
│       └── assets/
│
├── commands/                     # Command definitions (31 total)
│   ├── feature/
│   ├── bug-fix/
│   ├── enhancement/
│   ├── ...
│   └── work/
│       └── work.md              # Unified entry point
│
├── agents/                       # Agent definitions (28 total)
│   ├── project-analyzer.md
│   ├── task-classifier.md
│   ├── ...
│   └── [agent-name].md
│
└── .ai-sdlc/                    # Created in user projects
    ├── docs/                    # Project documentation
    │   ├── INDEX.md
    │   ├── project/
    │   └── standards/
    └── tasks/                   # Development tasks
        ├── new-features/
        ├── bug-fixes/
        ├── enhancements/
        ├── refactoring/
        ├── performance/
        ├── security/
        ├── migrations/
        └── documentation/
```

## Component Communication Patterns

### Pattern 1: Command → Skill

```
Command (slash command)
     ↓ Invokes via Skill tool
Skill (orchestrator)
     ↓ Returns completion message
Command outputs to user
```

### Pattern 2: Skill → Agent

```
Skill (orchestrator)
     ↓ Invokes via Task tool with subagent_type
Agent (specialized subagent)
     ↓ Executes read-only analysis
     ↓ Returns structured result
Skill continues with result
```

### Pattern 3: Skill → Skill

```
Skill (orchestrator)
     ↓ Delegates to another skill via Skill tool
Skill (utility)
     ↓ Performs specific task
     ↓ Returns result
Original skill continues
```

### Pattern 4: Continuous Standards Discovery

```
Skill execution
     ↓ At phase start
Read INDEX.md
     ↓ Extract relevant standards
Apply to current context
     ↓ Before each major action
Re-read INDEX.md
     ↓ Check for newly relevant standards
Update context
     ↓ Continue execution
```

## Design Principles

### 1. Separation of Concerns

- **Commands**: User interface, routing
- **Skills**: Workflow orchestration, state management
- **Agents**: Specialized execution, analysis
- **Documentation**: Project knowledge, standards

### 2. Composability

Skills compose agents for complex workflows. Agents are single-purpose and reusable across workflows.

### 3. State Persistence

All workflows persist state to enable pause/resume. State is file-based (YAML) for transparency.

### 4. Evidence-Based

All analysis agents must reference actual code/files. No assumptions without evidence.

### 5. Read-Only Verification

Verification agents (spec-auditor, reality-assessor, etc.) never modify code—they only report findings.

### 6. Progressive Disclosure

Users see high-level progress, can drill into details (work-log.md, verification reports) as needed.

## What's Next?

- **[Quick Start](Quick-Start.md)** - Get hands-on experience with workflows
- **[Contributing Guide](Contributing.md)** - Learn how to extend the plugin
- **[Troubleshooting](Troubleshooting.md)** - Debug common issues
- **[Concepts](concepts/)** - Deep dive into advanced features

---

**Understanding the architecture helps you leverage the plugin effectively and extend it for your team's needs.**
