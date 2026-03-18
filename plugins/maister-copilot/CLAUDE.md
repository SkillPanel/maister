# AI SDLC Plugin

This plugin provides AI-powered Software Development Lifecycle (SDLC) capabilities for Claude Code projects.

## Purpose

The AI SDLC plugin helps teams streamline software development workflows by providing:

- **Workflow Commands**: Slash commands for common SDLC tasks like feature development, bug fixes, and code reviews
- **Specialized Agents**: AI agents optimized for specific development tasks (spec writing, implementation, verification)
- **Skills**: Reusable capabilities for managing standards, documentation, and development workflows
- **Coding Standards**: Project-level standards and best practices that can be customized and enforced

## Installation

Install this plugin in your project to gain access to structured development workflows and standards management.

## Features

- Step-by-step guided development workflows
- Automated task planning and tracking
- Reusable skills for common development tasks
- Customizable coding standards
- Verification and quality assurance capabilities

## Critical Principle: User-Confirmed Rollback

**NEVER automatically rollback or revert code changes without user confirmation.**

All workflows in this plugin follow this pattern when failures occur:

1. **STOP** - Don't attempt automatic fixes for critical failures
2. **ANALYZE** - Examine the root cause (config issue? test setup? actual logic error?)
3. **CHECK FOR EASY FIXES** - Often failures are simple config/setup issues
4. **ASK USER** - Use `ask_user` with options:
   - "Try suggested fix" (if easy fix identified)
   - "Rollback changes" (user confirms rollback)
   - "Let me investigate" (pause for manual investigation)
5. **EXECUTE** - Only perform rollback if user explicitly confirms

**Rationale**: Automatic rollback discards potentially valid work, hides root causes, and frustrates users. Many failures are simple configuration issues with easy 1-line fixes.

## Workflow Types Supported

This plugin supports 4 workflow types that route to specialized orchestrators:

| Workflow Type | Purpose | Orchestrator | Classification Keywords |
|---------------|---------|-------------|------------------------|
| **Development** | Bug fixes, enhancements, new features | development | "fix", "bug", "add", "new", "improve", "enhance", "create" |
| **Performance** | Optimize speed/efficiency | performance | "slow", "optimize", "speed up", "faster" |
| **Migration** | Move tech/patterns | migration | "migrate", "move from X to Y", "upgrade" |
| **Research** | Investigate and document findings | research | "research", "investigate", "explore options" |
| **Product Design** | Design features/products before building | product-design | "design", "product design", "feature design", "wireframe", "prototype" |

### Design Principles

- **Adaptive Phases**: The development orchestrator's phases activate based on detected task characteristics, not predetermined types
- **Characteristic Detection**: The gap-analyzer detects whether a task involves reproducible defects, existing code modifications, new capabilities, data operations, or UI changes
- **Flexible Granularity**: Complex steps can have substeps when needed
- **Consistent Core**: All workflows share planning, specification, implementation, and verification phases
- **Conditional Stages**: Phases activate based on context (e.g., TDD gates when defects detected, UI mockups when UI-heavy)

## Terminology

To avoid confusion, this plugin uses specific terminology:

**Development Task** (or simply "Task")
- The high-level work item: a bug fix, new feature, enhancement, refactoring, etc.
- Represents the overall piece of work from start to finish
- Located in: `.maister/tasks/[workflow-type]/YYYY-MM-DD-task-name/`
- Contains: specification, requirements, implementation plan, and verification results

**Implementation Step** (or "Implementation Task")
- Specific actionable steps executed during the implementation phase
- The detailed breakdown of HOW to build the development task
- Listed in: `implementation-plan.md` within each development task folder
- Example: "1.1 Create User model", "2.3 Write API endpoint", "3.5 Add form validation"

**Key Distinction**: A "development task" is WHAT to build (the feature/fix), while "implementation steps" are HOW to build it (the specific actions).

## User-Centric Development Focus

This plugin prioritizes usability and user experience throughout development:

### User Journey Analysis

**During Requirements Gathering** (when creating new capabilities):
- Asks how users will discover the feature
- Identifies target personas (admin, regular user, power user, etc.)
- Maps feature into existing workflows
- Documents access patterns and navigation paths

**During Gap Analysis** (when modifying existing features):
Comprehensive analysis ensuring complete, usable features:

**User Journey Impact Assessment**:
- **Feature Reachability**: Current vs new access paths, dead end analysis, discoverability scoring (1-10 scale)
- **Multi-Persona Analysis**: Per-persona workflow impact assessment with value/learning curve metrics
- **Flow Integration**: How enhancement fits existing workflows without disruption
- **Navigation Consistency**: Alignment with app-wide UI/navigation patterns
- **Discoverability Before/After**: Quantified improvement metrics showing usability impact

**Data Entity Lifecycle Analysis**:
- **Three-Layer Verification Framework**: Backend capability + UI component + User accessibility (all required)
- **Backend ≠ User Operability**: API endpoints alone don't confirm users can actually perform operations
- **Orphaned Display Detection**: Flags features that display data with no way to input it (useless feature)
- **Orphaned Input Detection**: Flags data capture with nowhere to view/use it (user frustration)
- **Layer 3 Critical Checks**: Component rendering, page routing, navigation access, permissions
- **Multi-Touchpoint Discovery**: Finds ALL places where data should appear, not just user-mentioned locations
- **CRUD Completeness**: Ensures data has complete lifecycle with verified user accessibility
- **Scope Expansion Recommendations**: Suggests phased approach when critical gaps found
- **Safety-Critical Awareness**: Heightened analysis for healthcare, finance, legal domains

**Why This Matters**:
- Prevents orphaned features that users can't find
- Ensures logical user flows and navigation
- Identifies discoverability issues early
- Analyzes impact from multiple persona perspectives
- Documents navigation integration concerns
- **Prevents incomplete features**: Catches "display allergy info" requests that lack input mechanisms
- **Ensures safety**: Identifies missing critical touchpoints (e.g., allergies in prescription workflow)

**Real-World Example**:
User requests: "Display allergy info on patient summary"

*Without data lifecycle analysis*:
- ✅ Implements display component
- ❌ No way to input allergies (feature useless)
- ❌ Missing from prescription workflow (safety issue)

*With data lifecycle analysis*:
- ⚠️ Detects orphaned display (no input mechanism)
- ⚠️ Discovers 5 additional critical touchpoints (prescriptions, appointments, emergencies)
- ✅ Recommends phased approach: Phase 1 (input + 3 critical displays), Phase 2 (remaining displays), Phase 3 (edit/delete)
- ✅ Result: Complete, safe, usable feature

**Output**: Ensures features are discoverable, accessible, complete, and logically integrated into the application

### ASCII Mockup Generation

For UI-heavy features/enhancements, the plugin can generate ASCII mockups:
- Shows how new UI integrates with existing layout structure
- Identifies reusable components from current codebase
- Visualizes navigation patterns and placement
- Annotates with actual component file references
- Ensures consistency with existing app patterns

**When Used**:
- Optional phase in development workflow
- Auto-triggered when `task_characteristics.ui_heavy` is true
- Invoked automatically by development orchestrator

**Output**: `analysis/ui-mockups.md` with ASCII diagrams

**Example**:
```
┌──────────────────────────────────────┐
│ Toolbar: [Existing] [Buttons] [NEW] │
│          └─ Integration point here   │
└──────────────────────────────────────┘
```

**Benefits**:
- Visualize layout before implementation
- Ensure consistency with existing UI
- Identify reusable components early
- Prevent navigation confusion
- No external design tools needed

## Structure Organization

### Separation of Concerns

This plugin separates reference documentation from work items:

**`.maister/docs/`** - Reference documentation (stable)
- Project vision, roadmap, tech stack
- Coding standards and conventions
- Architecture documentation
- Read these to understand the project

**`.maister/tasks/`** - Work items (active, growing)
- Individual development tasks
- Feature implementations, bug fixes, etc.
- Active work in progress
- Create/reference these when building

**Why separate?**
- Keeps INDEX.md focused on project understanding (not task lists)
- Better scalability (tasks grow independently from docs)
- Clearer navigation (docs = learn, tasks = work)
- Different lifecycle (docs = stable reference, tasks = active work)

## Documentation & Task Organization

### Project Documentation Structure

The maister plugin uses this structure:

```
.maister/
├── docs/                         # Reference documentation (stable)
│   ├── INDEX.md                 # Master index - READ THIS FIRST
│   ├── project/                 # Project-level documentation
│   │   ├── vision.md           # Project vision and goals
│   │   ├── roadmap.md          # Development roadmap
│   │   ├── tech-stack.md       # Technology choices and rationale
│   │   └── architecture.md     # System architecture (optional)
│   └── standards/               # Technical standards and conventions
│       ├── global/             # Language-agnostic standards
│       ├── frontend/           # Frontend-specific standards
│       ├── backend/            # Backend-specific standards
│       └── testing/            # Testing standards
└── tasks/                        # Development tasks (active, growing)
    ├── development/
    ├── performance/
    ├── migrations/
    ├── research/
    └── product-design/
```

**Core Principle**:
- Reference documentation in `.maister/docs/` is the source of truth for understanding the project
- Always read `docs/INDEX.md` first to understand available documentation and standards
- Development tasks live separately in `.maister/tasks/` for better organization and scalability

### Development Task Organization

Development tasks are organized by workflow type in `.maister/tasks/`:

```
.maister/tasks/
├── development/
│   └── YYYY-MM-DD-task-name/
├── performance/
│   └── YYYY-MM-DD-task-name/
├── migrations/
│   └── YYYY-MM-DD-task-name/
├── research/
│   └── YYYY-MM-DD-task-name/
└── product-design/
    └── YYYY-MM-DD-task-name/
```

**Benefits of workflow-based organization:**
- Clear routing to orchestrator
- Date-prefixed naming provides chronological sorting
- Scales well to 100s of tasks

### Base Task Structure

Each development task follows a common structure with core directories:

```
YYYY-MM-DD-task-name/
├── orchestrator-state.yml        # Execution state and task metadata
├── analysis/                     # Analysis and planning artifacts
│   ├── research-context/        # From research (if --research provided)
│   │   └── research-report.md   # Full research findings
│   ├── requirements.md          # Gathered requirements
│   └── visuals/                 # Design mockups and wireframes
├── implementation/               # Implementation work
│   ├── spec.md                  # Main specification (WHAT to build)
│   ├── implementation-plan.md   # Implementation steps breakdown (HOW to build)
│   └── work-log.md              # Chronological activity log
├── verification/                 # Verification results
│   └── spec-audit.md            # Independent spec audit (conditional, complex tasks only)
└── documentation/                # User-facing docs (if applicable)
```

Task types can add specialized subdirectories as needed (e.g., `analysis/bug-analysis/` for bug fixes, `implementation/metrics/` for performance tasks).

**Note**: The `implementation/implementation-plan.md` file contains implementation steps (the detailed breakdown of actions), created by the implementation-planner subagent after the specification is approved.

### Naming Conventions

**Workflow Type Directories:**
- Use workflow names: `development/`, `performance/`, `migrations/`, `research/`, `product-design/`

**Task Directories:**
- Format: `YYYY-MM-DD-task-name`
- Example: `2025-10-23-user-authentication`
- Example: `2025-10-23-fix-login-timeout`
- Date prefix enables chronological sorting
- Concise but descriptive name (3-5 words)

### Integration

- **Documentation Discovery**: Always read `.maister/docs/INDEX.md` before starting work to understand project context
- **Task Discovery**: Browse `.maister/tasks/` to find development tasks by workflow type
- **Standards Compliance**: Follow standards from `.maister/docs/standards/` during implementation
- **Task Tracking**: Task status, priority, tags, and time tracking are in the `task:` section of `orchestrator-state.yml`
- **Activity Logging**: Record work in `implementation/work-log.md` for transparency

## Plugin Documentation Principles

These principles guide how we document skills, commands, orchestrators, and agents in this plugin to avoid verbosity and duplication while trusting Claude to reason effectively.

### Philosophy

**Trust Claude to reason.** Provide principles and patterns, not prescriptive implementations. Claude can discover technical details from skill.md files when needed—CLAUDE.md and commands should guide thinking, not dictate exact steps.

### Core Principles

1. **No Verbose Pseudocode** - Show conceptual patterns and decision frameworks, not complete implementations
2. **No Prescriptive Templates** - Guide thinking with principles, don't dictate exact prompts or scripts
3. **Avoid Duplication** - If technical details exist in skill.md, reference them in CLAUDE.md/commands
4. **Commands as Thin Wrappers** - User-facing guidance in commands, technical orchestration logic in skills
5. **Single Source of Truth** - Orchestration logic lives in skill.md, not scattered across multiple files
6. **Principle Over Process** - Explain WHY and WHEN, trust Claude to figure out HOW

### Content Guidelines

Target lengths for different documentation types:

| Documentation Type | Target Length | Focus |
|-------------------|---------------|-------|
| Skill descriptions (in CLAUDE.md) | 5-15 lines | Purpose, key capabilities, philosophy |
| Command descriptions (in CLAUDE.md) | 3-8 lines | What it does, when to use |
| Orchestrator sections (in CLAUDE.md) | 20-30 lines | Overview, key features, reference skill |
| Reference files (in skills/) | <1,000 lines | Conceptual patterns, not implementations |
| Agent files (in agents/) | 300-450 lines | Core mission, decision frameworks, workflow principles |
| Individual standards (### sections in standard files) | 1-10 lines (excluding code snippets) | ### heading + description + optional code example. Multiple standards per topic file. |

### When Adding New Content

Ask these questions before documenting:

1. **"Does this duplicate skill.md content?"** → Reference instead of duplicating
2. **"Am I providing exact implementation?"** → Simplify to principles
3. **"Would Claude need this spelled out?"** → Probably not, trust reasoning ability
4. **"Is this a manual or guidance?"** → Should be guidance, not manual

### Examples

**❌ Too Verbose** (Manual approach):
```markdown
**Process**:
1. Initialize: Check prerequisites, load state, validate inputs
2. Analyze: Parse task description, extract key entities, determine scope
3. Plan: Create task groups, define dependencies, set milestones
4. Execute: For each group: (a) run tests, (b) implement, (c) verify
5. Finalize: Generate report, update metadata, commit changes
```

**✅ Principle-Based** (Guidance approach):
```markdown
Orchestrates implementation from plan to verified code. Adapts execution complexity based on task size, maintains continuous standards discovery, follows test-driven approach.

**See**: `skills/implementer/skill.md` for execution modes and technical details.
```

## Reference Documentation Guidelines

Reference files (`references/*.md`) in skills provide conceptual patterns and decision frameworks. They guide implementation rather than provide complete code.

### Purpose of References

References should answer:
- **WHAT** patterns to use (strategies, approaches)
- **WHEN** to apply them (decision criteria)
- **WHY** certain approaches work (rationale)
- **HOW** (conceptually) to structure solutions (high-level)

References should NOT contain:
- Complete function implementations
- Production-ready code (>10 lines)
- Extensive pseudocode implementations
- Framework-specific boilerplate

### Size Guidelines

| Reference Type | Target Size | Max Size | Token Budget |
|---------------|-------------|----------|--------------|
| Orchestrator phase reference | 600-800 lines | 1,000 lines | ~8K tokens |
| Algorithm pattern reference | 400-600 lines | 800 lines | ~6K tokens |
| Strategy/decision reference | 300-500 lines | 600 lines | ~4K tokens |

**Total per skill**: Aim for <3,000 lines across all references (~24K tokens)

### Content Structure

**✅ Good Reference Style** (Conceptual):
```markdown
### Algorithm: Feature Detection

**Purpose**: Locate existing files using multi-strategy search

**Strategy**:
1. **Filename search**: Extract nouns → Generate patterns → Glob search
2. **Code pattern search**: Detect tech hints → Search for patterns → Grep
3. **Scoring**: Combine filename match + directory + size + tests + usage

**Decision Criteria**:
- High confidence (>80%): Present top 3 matches
- Medium confidence (50-80%): Present top 5 with warnings
- Low confidence (<50%): Expand search or prompt user

**Output**: Ranked list with confidence scores
```

**❌ Bad Reference Style** (Implementation):
```python
def detect_feature_files(description, codebase_root):
    """Complete 100-line implementation"""
    tokens = tokenize(description)
    patterns = []
    for token in tokens:
        # 50+ lines of detailed logic
        patterns.append(generate_pattern(token))
    # More implementation details...
    return scored_results
```

### When to Use Code Examples

Acceptable scenarios for code examples (keep <10 lines):
- **Test patterns**: Show expected test structure
- **Configuration examples**: YAML/JSON structure samples
- **API usage**: Brief integration examples
- **Decision pseudocode**: If-then logic (5-10 lines max)

### Review Checklist

Before finalizing reference documentation:

✓ Does this explain WHAT/WHEN/WHY rather than implement HOW?
✓ Are code examples <10 lines and conceptual?
✓ Is total file size under target guidelines?
✓ Could an experienced developer implement from this guide?
✓ Is it tool/framework agnostic where possible?
✓ Does it focus on patterns over implementation?

### Philosophy

**References are maps, not detailed instructions.**
- Maps show landmarks, routes, decision points
- Instructions show every step, every turn
- Skills/agents follow the map to create their own path

## Orchestrator Creation Guidelines

When creating or auditing orchestrators, follow the patterns established in existing orchestrators and consult the framework reference files.

**See**: `skills/orchestrator-framework/references/orchestrator-creation-checklist.md` for the complete creation checklist and anti-patterns.
**See**: `skills/orchestrator-framework/references/orchestrator-patterns.md` for execution rules, schemas, and patterns.

## Available Skills

Skills are automatically invoked by Claude when appropriate. Details live in each skill's `skill.md` file.

### Core Workflow Skills

| Skill | Purpose | Details |
|-------|---------|---------|
| `codebase-analyzer` | Thin dispatcher: selects agent roles adaptively, launches parallel Explore subagents, delegates report synthesis to `codebase-analysis-reporter` subagent | `skills/codebase-analyzer/SKILL.md` |
| `implementer` | Executes plans with **mandatory** standards reading (INDEX.md + implementation-plan.md Standards Compliance section + keyword-triggered) and **test step enforcement** (requires user approval to skip N.1 tests) | `skills/implementer/SKILL.md` |
| `implementation-verifier` | Read-only QA orchestrator: delegates completeness checks, test execution, code review, and production readiness to specialized subagents; compiles results into verification report | `skills/implementation-verifier/SKILL.md` |
| `standards-discover` | Parallel multi-source standards discovery (config, code, docs, PRs/CI) with confidence scoring | `skills/standards-discover/SKILL.md` |
| `docs-manager` | Internal engine for doc file operations, INDEX.md generation, CLAUDE.md integration. Not user-invocable — accessed via `docs-operator` agent (Task tool) by init, standards-update, standards-discover | `skills/docs-manager/skill.md` |
| `maister-init` | Initialize `.maister/docs/` with project analysis, documentation generation, and baseline standards | `skills/init/SKILL.md` |
| `standards-update` | Update or create standards from conversation context or explicit input | `skills/standards-update/SKILL.md` |
| `quick-bugfix` | Quick TDD-driven bug fix with complexity escalation to full development workflow | `skills/quick-bugfix/SKILL.md` |

### Orchestrator Framework

All orchestrators share patterns documented in a single reference file:

| File | Purpose |
|------|---------|
| `orchestrator-patterns.md` | Delegation rules, interactive mode, state schema, context passing, initialization, resume, issue resolution |
| `orchestrator-creation-checklist.md` | Authoring checklist for new orchestrators (not loaded at runtime) |

Each orchestrator reads `orchestrator-patterns.md` at initialization and implements domain-specific phases. Key principles: state-driven execution, resume capability, interactive phase gates, user-confirmed rollback, context passing between phases via `phase_summaries`, delegation enforcement (Skill tool for skills, Task tool for agents).

### Orchestrator Skills

Orchestrators manage complete workflows with state management, auto-recovery, and pause/resume.

| Skill | Purpose | Details |
|-------|---------|---------|
| `development` | **Unified workflow** (14 phases: 1-14) for all development tasks. Phases activate based on detected task characteristics (not predetermined types). TDD gates activate when defects detected, UI mockups when UI-heavy. | `skills/development/SKILL.md` |
| `performance` | Static code analysis for bottleneck detection, reuses standard spec/plan/implement/verify pipeline | `skills/performance/SKILL.md` |
| `migration` | Code/data/architecture migrations with rollback plans | `skills/migration/SKILL.md` |
| `research` | Multi-source research with synthesis, solution brainstorming, high-level design, and citations | `skills/research/SKILL.md` |
| `product-design` | **Interactive product/feature design** (9 phases: 0-8) with adaptive scope (feature-level default, product-level when detected), mixed interaction pattern (questioning for exploration, propose-and-refine for convergence), iterative refinement loops, browser-based visual companion, and layered product brief output. | `skills/product-design/SKILL.md` |

## Available Commands

Commands invoke orchestrators and utilities. All orchestrators support `--from=phase` (resume point).

### Setup & Standards

| Command | Usage | Purpose |
|---------|-------|---------|
| `/maister-init` | `/maister-init [--standards-from=PATH]` | Initialize framework with project analysis and smart defaults for docs/standards. Optionally copy standards from another project's `.maister/docs/standards/` instead of built-in defaults. |
| `/maister-standards-update` | `/maister-standards-update [description] [--from=PATH]` | Update/create standards from conversation context, or sync from another project |
| `/maister-standards-discover` | `/maister-standards-discover [--scope=SCOPE]` | Discover standards from config files and code patterns |

> **Note**: These are all skills (not commands). `/maister-init`, `/maister-standards-update`, and `/maister-standards-discover` invoke their respective skills which delegate file operations to the internal `docs-manager` skill.

### Workflow Commands

Each workflow skill handles both new tasks and resuming existing ones. Pass a task description to start new, or a task path to resume.

| Command | Usage | Task Directory |
|---------|-------|----------------|
| `/maister-development` | `[desc] [--e2e] [--user-docs] [--research=PATH]` (new) / `[task-path] [--from=PHASE] [--reset-attempts]` (resume) | `.maister/tasks/development/` |
| `/maister-performance` | `[desc]` (new) / `[task-path] [--from=PHASE]` (resume) | `.maister/tasks/performance/` |
| `/maister-migration` | `[desc] [--type=TYPE]` (new) / `[task-path] [--from=PHASE]` (resume) | `.maister/tasks/migrations/` |
| `/maister-research` | `[question] [--type=TYPE] [--brainstorm] [--no-brainstorm] [--design] [--no-design]` (new) / `[task-path] [--from=PHASE]` (resume) | `.maister/tasks/research/` |
| `/maister-product-design` | `[desc] [--research=PATH] [--no-visual]` (new) / `[task-path] [--from=PHASE]` (resume) | `.maister/tasks/product-design/` |

**Research-Based Development**: Start development informed by a completed research workflow:
```bash
# Auto-detect research folder (recommended)
/maister-development .maister/tasks/research/2026-01-12-oauth-research

# Explicit --research flag
/maister-development "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
```
Research context flows through ALL phases without skipping any. Research artifacts are copied to `analysis/research-context/` and summaries pass to every subagent via Pattern 7.

### Review & Audit Commands

| Command | Usage | Purpose |
|---------|-------|---------|
| `/maister-reviews-code` | `[path] [--scope=SCOPE]` | Automated code quality, security, performance analysis |
| `/maister-reviews-pragmatic` | `[path]` | Detect over-engineering, ensure code matches project scale |
| `/maister-reviews-spec-audit` | `[spec-path]` | Independent spec audit for completeness and clarity |
| `/maister-reviews-reality-check` | `[task-path]` | Validate work actually solves the problem |
| `/maister-reviews-production-readiness` | `[path] [--target=ENV]` | Pre-deployment verification with GO/NO-GO recommendation |

### Quick Commands

| Command | Usage | Purpose |
|---------|-------|---------|
| `/maister-quick-plan` | `[task description]` | Enter planning mode with standards awareness from INDEX.md |
| `/maister-quick-dev` | `[task description]` | Implement directly with standards awareness (no planning) |
| `/maister-quick-bugfix` | `[bug description]` | Quick bug fix with TDD red/green gates and complexity escalation |

**See**: Individual `commands/` and `skills/*/skill.md` files for detailed documentation.

## Available Subagents

Subagents are specialized AI agents invoked by skills and orchestrators. All agents are read-only unless specified.

### Initialization & Analysis Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `project-analyzer` | Deep codebase analysis for tech stack, architecture, conventions | `/maister-init` | `agents/project-analyzer.md` |
| `docs-operator` | Internal service agent: executes docs-manager operations mid-workflow via Task tool. Has docs-manager skill preloaded. **Special case**: companion agent pattern only works here because docs-manager does NOT spawn subagents (only file operations). Do not use this pattern for skills that spawn subagents. | init, standards-update, standards-discover | `agents/docs-operator.md` |
| `task-classifier` | Classifies task descriptions into workflow types with confidence scoring | `/work` command | `agents/task-classifier.md` |
| `gap-analyzer` | Compares current vs desired state with characteristic-detection-based analysis modules | development orchestrator | `agents/gap-analyzer.md` |
| `specification-creator` | Creates specs from gathered requirements with reusability search and self-verification | development, migration orchestrators | `agents/specification-creator.md` |
| `implementation-planner` | Breaks specs into task groups with test-driven steps and dependency chains | development, migration orchestrators | `agents/implementation-planner.md` |
| `codebase-analysis-reporter` | Merges raw Explore agent findings into structured analysis report with deduplication, cross-referencing, and risk assessment | codebase-analyzer skill | `agents/codebase-analysis-reporter.md` |

**Deprecated Agent**:
- `existing-feature-analyzer` → Replaced by `codebase-analyzer` skill (uses adaptive parallel Explore subagents)

### UI & Documentation Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `ui-mockup-generator` | ASCII mockups showing UI integration with existing layouts | development orchestrator (feature/enhancement), product-design orchestrator (Phase 7 ASCII fallback) | `agents/ui-mockup-generator.md` |
| `e2e-test-verifier` | Runtime browser verification via Playwright MCP tools (not test file generation) | development orchestrator (optional) | `agents/e2e-test-verifier.md` |
| `user-docs-generator` | User documentation with Playwright screenshots | development orchestrator (optional) | `agents/user-docs-generator.md` |

### Performance Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `bottleneck-analyzer` | Static code analysis detecting N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leak patterns. Optionally incorporates user-provided profiling data. | performance orchestrator | `agents/bottleneck-analyzer.md` |

### Research Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `research-planner` | Creates methodology and identifies sources | research orchestrator | `agents/research-planner.md` |
| `information-gatherer` | Multi-source data collection with citations | research orchestrator, product-design orchestrator (Phase 1 mini-research) | `agents/information-gatherer.md` |
| `research-synthesizer` | Pattern identification, insights generation | research orchestrator | `agents/research-synthesizer.md` |
| `solution-brainstormer` | Solution alternatives with multi-perspective trade-off analysis | research orchestrator, product-design orchestrator | `agents/solution-brainstormer.md` |
| `solution-designer` | High-level C4 architecture design and ADR documentation | research orchestrator | `agents/solution-designer.md` |

### Verification Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `implementation-completeness-checker` | Plan completion + standards compliance + documentation completeness | implementation-verifier | `agents/implementation-completeness-checker.md` |
| `test-suite-runner` | Runs full test suite, analyzes results, flags regressions | implementation-verifier | `agents/test-suite-runner.md` |
| `code-reviewer` | Automated code quality, security, performance analysis | implementation-verifier, standalone command | `agents/code-reviewer.md` |
| `production-readiness-checker` | Pre-deployment verification with GO/NO-GO recommendation | implementation-verifier, performance orchestrator, standalone command | `agents/production-readiness-checker.md` |

### Review & Audit Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `code-quality-pragmatist` | Detects over-engineering, ensures scale-appropriate code | implementation-verifier | `agents/code-quality-pragmatist.md` |
| `spec-auditor` | Independent spec audit with senior auditor perspective | orchestrators | `agents/spec-auditor.md` |
| `reality-assessor` | Validates work actually solves the problem | implementation-verifier | `agents/reality-assessor.md` |
| `implementation-changes-planner` | Creates detailed change plans (no file modifications) | implementer | `agents/implementation-changes-planner.md` |

**See**: Individual `agents/*.md` files for detailed workflows and philosophies.

## Key Workflow Principles

1. **Documentation First**: Always check docs/INDEX.md before and during work
2. **Specification Before Implementation**: Create clear specs before coding
3. **Planning Before Execution**: Break implementation into manageable steps
4. **Test-Driven Approach**: Write tests first, implement, then verify
5. **Continuous Standards Discovery**: Check standards throughout, not just at start
6. **Incremental Verification**: Run only new tests after each group, not entire suite
7. **Comprehensive Verification Before Commit**: Run full test suite and create verification report before code review
8. **Task Directory Artifact Anchoring**: ALL workflow artifacts (reports, documentation, screenshots) MUST be saved under the task directory (`.maister/tasks/[type]/[task-name]/`). NEVER save task artifacts to project directories like `docs/`, `src/`, or project root.

**For detailed workflow documentation, see**: individual skill `SKILL.md` files

## Progress Tracking with Task System

All orchestrators use `TaskCreate`/`TaskUpdate` for real-time progress visibility at two levels:

### Orchestrator Phase Tracking

- At workflow start: `TaskCreate` for all phases (pending), then `TaskUpdate addBlockedBy` for phase dependencies
- At each phase: `TaskUpdate` to `in_progress` (shows spinner with `activeForm`) → execute → `TaskUpdate` to `completed`
- Optionally set `owner` when delegating to skills/agents, and `metadata` for timing/artifacts
- State file (`orchestrator-state.yml`) is source of truth for resume logic
- Task system mirrors state for UX and provides dependency visualization

### Implementation Task Group Tracking

- At planning: `TaskCreate` for each task group with dependencies mirroring the plan
- During execution: `TaskUpdate` to `in_progress` with `owner` → execute → `TaskUpdate` to `completed` with metadata
- Markdown checkboxes in `implementation-plan.md` remain the step-level source of truth
- Task system provides group-level visibility with dependencies, timing, and ownership

See individual orchestrator `skill.md` files for phase-specific task tables.

## Hooks

The plugin includes hooks that fire at specific Claude Code lifecycle events.

### Post-Compaction State Reminder

**Hook**: `SessionStart` (matcher: `compact`)
**Location**: `hooks/post-compact-reminder.sh`

This hook fires after context compaction and injects a reminder into Claude's context to check the `orchestrator-state.yml` file for the active workflow.

**Purpose**: Reminds Claude to check `orchestrator-state.yml` for completed phases and use ask_user at phase gates after compaction, regardless of any "continue without asking" instructions in the compacted context.

**See**: `hooks/hooks.json` for hook configuration (auto-discovered by Claude Code).

## Claude Code Documentation

**IMPORTANT**: Always consult the latest Claude Code documentation when working with plugins and skills. The documentation is regularly updated with new features, best practices, and implementation details.

### Essential Reading

Before working with this plugin, read the following up-to-date documentation:

1. **Plugins Overview**: https://code.claude.com/docs/en/plugins
   - Understanding plugin architecture and capabilities
   - How plugins extend Claude Code functionality
   - Plugin installation and configuration

2. **Skills Documentation**: https://code.claude.com/docs/en/skills
   - How to create and use skills effectively
   - Skill best practices and patterns
   - Skill discovery and invocation

3. **Plugins Reference**: https://code.claude.com/docs/en/plugins-reference
   - Complete plugin API reference
   - Plugin structure and requirements
   - Available plugin features and hooks

4. **Sub-agents/Agents documentation**: https://code.claude.com/docs/en/sub-agents https://code.claude.com/docs/en/plugins-reference#agents
   - Sub-agent architecture and capabilities
   - Agent definition and tool access

5. **Built-in tools** available for usage: https://gist.github.com/bgauryy/0cdb9aa337d01ae5bd0c803943aa36bd

### Documentation Priority

When implementing or modifying plugin features:
1. **Current official documentation** (links above) - Always check for latest updates
2. **Project-specific documentation** (this file and .maister/docs/)
3. **Code patterns** in this plugin's codebase
4. **General best practices**

**Note**: Claude Code is actively developed. Always verify implementation details against the current documentation before making changes.

## Platform: Copilot CLI

This is the Copilot CLI variant. Key differences from Claude Code:
- **No multi-select**: When asking users to select multiple options, ask sequential single-select questions instead
- **Command names**: No plugin prefix in names (e.g., `development`); the plugin system adds the plugin-id prefix automatically
- **Project instructions file**: Use `.github/copilot-instructions.md` instead of `CLAUDE.md`. If the project uses `AGENTS.md`, support that as well.
- **User questions**: Use `ask_user` tool instead of `ask_user`
