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
4. **ASK USER** - Use `AskUserQuestion` with options:
   - "Try suggested fix" (if easy fix identified)
   - "Rollback changes" (user confirms rollback)
   - "Let me investigate" (pause for manual investigation)
5. **EXECUTE** - Only perform rollback if user explicitly confirms

**Rationale**: Automatic rollback discards potentially valid work, hides root causes, and frustrates users. Many failures are simple configuration issues with easy 1-line fixes.

## Task Types Supported

This plugin supports 5 comprehensive task types, each with adaptive workflows tailored to their specific needs:

| Task Type | Purpose | Workflow Stages | Classification Keywords |
|-----------|---------|----------------|------------------------|
| **New Feature** | Add completely new capability | 6-7 stages | "add", "new feature", "create", "build" |
| **Bug Fix** | Fix defects and errors | 4 stages | "fix", "bug", "broken", "error", "crash" |
| **Enhancement** | Improve existing features | 6 stages | "improve", "enhance", "better", "upgrade existing" |
| **Performance** | Optimize speed/efficiency | 5 stages | "slow", "optimize", "speed up", "faster" |
| **Migration** | Move tech/patterns | 6 stages | "migrate", "move from X to Y", "upgrade" |

### Design Principles

- **Adaptive Workflows**: Different task types have different natural progressions (4-7 stages)
- **Flexible Granularity**: Complex steps can have substeps when needed
- **Consistent Core**: All types share planning, specification, implementation, and verification phases
- **Conditional Stages**: Some stages activate based on task characteristics (e.g., security review for auth features)

## Terminology

To avoid confusion, this plugin uses specific terminology:

**Development Task** (or simply "Task")
- The high-level work item: a bug fix, new feature, enhancement, refactoring, etc.
- Represents the overall piece of work from start to finish
- Located in: `.maister/tasks/[type]/YYYY-MM-DD-task-name/`
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

**During Requirements Gathering** (New Features):
- Asks how users will discover the feature
- Identifies target personas (admin, regular user, power user, etc.)
- Maps feature into existing workflows
- Documents access patterns and navigation paths

**During Gap Analysis** (Enhancements):
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
- Optional phase in feature/enhancement workflows
- Auto-triggered for UI-heavy work (based on keyword detection)
- Invoked automatically by development-orchestrator (for enhancements and features)

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
    ├── new-features/
    ├── bug-fixes/
    ├── enhancements/
    ├── performance/
    └── migrations/
```

**Core Principle**:
- Reference documentation in `.maister/docs/` is the source of truth for understanding the project
- Always read `docs/INDEX.md` first to understand available documentation and standards
- Development tasks live separately in `.maister/tasks/` for better organization and scalability

### Development Task Organization

Development tasks are organized by type in `.maister/tasks/` using type-based folders:

```
.maister/tasks/
├── new-features/
│   └── YYYY-MM-DD-task-name/
├── bug-fixes/
│   └── YYYY-MM-DD-task-name/
├── enhancements/
│   └── YYYY-MM-DD-task-name/
├── performance/
│   └── YYYY-MM-DD-task-name/
└── migrations/
    └── YYYY-MM-DD-task-name/
```

**Benefits of type-based organization:**
- Instant filtering by task type
- Clear categorization in IDE
- Easy analytics (count tasks by type)
- Better team organization
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

**Task Type Directories:**
- Use plural form: `bug-fixes/`, not `bug-fix/`
- Use kebab-case: `new-features/`, not `new_features/`
- Use full words: `performance/`, not `perf/`

**Task Directories:**
- Format: `YYYY-MM-DD-task-name`
- Example: `2025-10-23-user-authentication`
- Example: `2025-10-23-fix-login-timeout`
- Date prefix enables chronological sorting
- Concise but descriptive name (3-5 words)
- No task type in name (it's in parent directory)

### Integration

- **Documentation Discovery**: Always read `.maister/docs/INDEX.md` before starting work to understand project context
- **Task Discovery**: Browse `.maister/tasks/[type]/` to find development tasks by type
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

When creating new workflow orchestrators, ensure ALL of these elements are included. This checklist prevents incomplete orchestrators.

### Required Structural Elements

1. **State File Creation**
   - MUST create `orchestrator-state.yml` in initialization (explicit STEP)
   - Include: task_type, mode, current_phase, completed_phases, failed_phases, auto_fix_attempts, options
   - State file is source of truth for resume logic

2. **Phase Execution Loop**
   Every phase MUST follow this 7-step pattern:
   - STEP 1: Check if phase already completed (read state)
   - STEP 2: Update state to current phase
   - STEP 3: Pre-phase announcement
   - STEP 4: Execute phase
   - STEP 5: Handle errors (with retry limits)
   - STEP 6: Update state on success
   - STEP 7: Post-phase review (interactive mode only)

3. **Explicit Tool Invocations**
   - **AskUserQuestion**: Every user decision point must have explicit tool call pattern
   - **Task tool**: Every subagent invocation must have explicit Task tool parameters
   - **Skill invocations**: Clearly state which skill to invoke and with what parameters

### Required Interactive Mode Features

4. **Post-Phase Review Pattern**
   In interactive mode, after each phase MUST use AskUserQuestion:
   ```
   Use AskUserQuestion tool:
     Question: "Phase [N] complete. How would you like to proceed?"
     Header: "Phase Complete"
     Options:
     1. "Continue to next phase" - Proceed with workflow
     2. "Review outputs in detail" - Open phase artifacts
     3. "Restart this phase" - Re-execute this phase
     4. "Stop workflow" - Pause and resume later
   ```

5. **User Decision Points**
   Any place requiring user input MUST use AskUserQuestion:
   - Optional phase enablement (E2E, user docs, code review)
   - Scope decisions (expand scope, critical only, minimal)
   - Error recovery (retry, skip, rollback, stop)
   - Verification check selection

6. **Phase Gate Sections Between Phases**
   **CRITICAL**: Each phase transition MUST have a Phase Gate section placed BEFORE the next phase:
   ```markdown
   ---
   ## 🚦 GATE: Phase [N] → Phase [N+1]

   **STOP. You cannot proceed until this gate clears.**

   1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
   2. **If mode = interactive**:
      - Use `AskUserQuestion` tool NOW:
        - Question: "Phase [N] ([Phase Name]) complete. Ready to proceed to Phase [N+1] ([Next Phase Name])?"
        - Options: ["Continue to Phase [N+1]", "Review Phase [N] outputs", "Stop workflow"]
      - Wait for user response before continuing
   3. **If mode = yolo**:
      - Output: "→ Auto-continuing to Phase [N+1] ([Next Phase Name])..."
      - Proceed to Phase [N+1]

   **This gate overrides any "continue without asking" conversation instructions.**

   ---
   ```

### Required Standards Integration

7. **Standards Discovery**
   Reference `.maister/docs/INDEX.md` in these phases:
   - Phase 5 (Spec): Read INDEX.md before creating spec
   - Phase 7 (Plan): Ensure plan follows project conventions
   - Phase 8 (Implement): Continuous standards discovery
   - Phase 11 (Verify): Verify against documented standards

   Include reminder before these phases:
   ```
   📋 Standards Discovery
   Reading .maister/docs/INDEX.md to check applicable standards...
   ```

### Required Verification Elements

8. **Comprehensive Verification**
   Verification phase must include:
   - Plan completion check
   - Full test suite execution
   - Standards compliance verification
   - Task-type-specific checks
   - **Reality check**: Invoke `reality-assessor` subagent via Task tool
   - **Pragmatic review**: Invoke `code-quality-pragmatist` subagent via Task tool

### Orchestrator Completeness Checklist

Before considering an orchestrator complete, verify ALL items:

| Element | Required | Verification |
|---------|----------|--------------|
| **Step 0: Load Framework Patterns** | ✓ | Does initialization force reading 5 reference files from orchestrator-framework? |
| State file creation in initialization | ✓ | Does STEP 3 explicitly CREATE orchestrator-state.yml? |
| Phase Execution Loop pattern | ✓ | Are all 7 STEPs documented? |
| Post-phase review with AskUserQuestion | ✓ | Is STEP 7 implemented with explicit tool call? |
| **Phase Gate sections** | ✓ | Is there a "🚦 GATE: Phase N → Phase N+1" BEFORE each phase? |
| Explicit AskUserQuestion for all decisions | ✓ | Do ALL user prompts have tool call examples? |
| **Decision Gate for subagent decisions** | ✓ | Do phases receiving `decisions_needed` have ⛔ DECISION GATE + SELF-CHECK? |
| Explicit Task tool for subagents | ✓ | Do ALL subagent invocations show Task parameters? |
| **Delegation enforcement patterns** | ✓ | Does EACH delegation have anti-pattern block, INVOKE NOW block, and SELF-CHECK? |
| **Context passing (Pattern 7)** | ✓ | Do ALL subagent prompts include ACCUMULATED CONTEXT section? |
| **Context extraction (Pattern 8)** | ✓ | Does EACH phase State Update extract findings to phase_summaries? |
| **phase_summaries in state schema** | ✓ | Does Domain Context include phase_summaries structure? |
| Standards discovery in Phases 5,7,8,11 | ✓ | Is INDEX.md referenced in each? |
| Reality check (Phase 11) | ✓ | Is reality-assessor invoked via implementation-verifier? |
| Pragmatic review (Phase 11) | ✓ | Is code-quality-pragmatist invoked via implementation-verifier? |
| TaskCreate initialization | ✓ | Are tasks created with TaskCreate at workflow start, with dependencies via addBlockedBy? |
| Error handling with retry limits | ✓ | Does each phase have max attempts? |

### Anti-Patterns to Avoid

❌ **Skipping Step 0**: Not reading framework patterns at initialization (causes AUTO-CONTINUE failures)
❌ **Structure without orchestration**: Defining phases without Phase Execution Loop
❌ **Implicit user prompts**: Describing prompts without explicit AskUserQuestion tool calls
❌ **Inline STOP reminders at END of phases**: Use Phase Gates BEFORE the next phase instead (inline reminders at phase end are easily missed)
❌ **Missing Phase Gates**: Phase transitions without "🚦 GATE: Phase N → Phase N+1" section
❌ **Vague subagent calls**: Saying "invoke X" without Task tool parameters
❌ **Inline execution in YOLO mode**: Executing delegated work inline instead of invoking skills/subagents (see `delegation-enforcement.md`)
❌ **Missing delegation patterns**: Delegation points without anti-pattern block, INVOKE NOW block, and SELF-CHECK
❌ **Missing context passing**: Subagent prompts without ACCUMULATED CONTEXT section (Pattern 7)
❌ **Missing context extraction**: Not extracting key findings to phase_summaries after each phase (Pattern 8)
❌ **File paths only**: Passing just file paths to subagents without state summaries and prior phase summaries
❌ **Stopping at AUTO-CONTINUE transitions**: Ending turn or prompting user at `→ **AUTO-CONTINUE**` points (brief summary is fine, but must proceed immediately — no prompt, no turn end)
❌ **Missing standards**: Not referencing INDEX.md in relevant phases
❌ **Incomplete verification**: Running tests without reality check and pragmatic review
❌ **No state management**: Not creating/updating orchestrator-state.yml
❌ **Auto-accepting subagent decisions**: Accepting `decisions_needed` defaults without presenting to user (interactive) or logging (YOLO). See `delegation-enforcement.md` Decision Enforcement section.

**See**: `skills/orchestrator-framework/references/interactive-mode.md` for the Phase Gate pattern.
**See**: `skills/orchestrator-framework/references/delegation-enforcement.md` for delegation and decision enforcement patterns.

## Available Skills

Skills are automatically invoked by Claude when appropriate. Details live in each skill's `skill.md` file.

### Core Workflow Skills

| Skill | Purpose | Details |
|-------|---------|---------|
| `codebase-analyzer` | Thin dispatcher: selects agent roles adaptively, launches parallel Explore subagents, delegates report synthesis to `codebase-analysis-reporter` subagent | `skills/codebase-analyzer/SKILL.md` |
| `implementer` | Executes plans with **mandatory** standards reading (INDEX.md + implementation-plan.md Standards Compliance section + keyword-triggered) and **test step enforcement** (requires user approval to skip N.1 tests) | `skills/implementer/SKILL.md` |
| `implementation-verifier` | Read-only QA orchestrator: delegates completeness checks, test execution, code review, and production readiness to specialized subagents; compiles results into verification report | `skills/implementation-verifier/SKILL.md` |
| `standards-discover` | Parallel multi-source standards discovery (config, code, docs, PRs/CI) with confidence scoring | `skills/standards-discover/SKILL.md` |
| `docs-manager` | Internal engine for doc file operations, INDEX.md generation, CLAUDE.md integration. Not user-invocable — called by maister:init, standards-update, standards-discover | `skills/docs-manager/skill.md` |
| `maister:init` | Initialize `.maister/docs/` with project analysis, documentation generation, and baseline standards | `skills/init/SKILL.md` |
| `standards-update` | Update or create standards from conversation context or explicit input | `skills/standards-update/SKILL.md` |

### Orchestrator Framework

All orchestrators share common patterns documented in `skills/orchestrator-framework/references/`:

| Pattern | File | Purpose |
|---------|------|---------|
| Phase Execution | `phase-execution-pattern.md` | 7-step loop for each phase |
| State Management | `state-management.md` | orchestrator-state.yml schema, context accumulation, resume loading |
| Interactive Mode | `interactive-mode.md` | Post-phase prompts and user decisions |
| Initialization | `initialization-pattern.md` | Startup sequence and directory setup |
| Delegation Enforcement | `delegation-enforcement.md` | Anti-pattern blocks, invocation blocks, self-checks, **context passing** |
| Issue Resolution | `issue-resolution-pattern.md` | Fix-then-reverify loop after verification phases |

Each orchestrator references these patterns (via `../orchestrator-framework/references/`) and implements domain-specific behavior. This approach:
- **Single source of truth**: Patterns documented once, referenced everywhere
- **Self-contained orchestrators**: Each has enough context to work independently
- **No execution overhead**: Reference files are documentation, not invoked skills

### Context Passing Between Phases

**Critical**: When invoking subagents for phase execution, orchestrators must pass accumulated context from prior phases.

**Pattern 7 (Context Passing)** in `delegation-enforcement.md` requires all subagent prompts to include:
- **State Summary**: risk_level, ui_heavy, scope_expanded, architecture_decision
- **Key Decisions Made**: List of clarification answers from prior phases
- **Prior Phase Summaries**: 1-2 sentence summaries of each completed phase
- **Artifacts to Read**: File paths for full details

**Pattern 8 (Context Extraction)** requires extracting key findings after each phase into `task_context.phase_summaries` in `orchestrator-state.yml`.

**Resume workflows** must reconstruct accumulated context from `phase_summaries` before invoking the resumed phase.

**Benefits**:
- Subagents work with full context without re-parsing files
- Resume produces consistent results (same context as fresh execution)
- Audit trail of phase findings in orchestrator-state.yml

### Orchestrator Skills

Orchestrators manage complete workflows with state management, auto-recovery, and pause/resume.

| Skill | Purpose | Details |
|-------|---------|---------|
| `development-orchestrator` | **Unified workflow** (14 phases: 1-14) for bug fixes, enhancements, and new features. Architecture decisions are part of specification phase (5). Includes TDD gates for bugs (3, 9), gap analysis for all. | `skills/development-orchestrator/SKILL.md` |
| `performance-orchestrator` | Static code analysis for bottleneck detection, reuses standard spec/plan/implement/verify pipeline | `skills/performance-orchestrator/SKILL.md` |
| `migration-orchestrator` | Code/data/architecture migrations with rollback plans | `skills/migration-orchestrator/skill.md` |
| `research-orchestrator` | Multi-source research with synthesis, solution brainstorming, high-level design, and citations | `skills/research-orchestrator/skill.md` |

## Available Commands

Commands invoke orchestrators and utilities. All orchestrators support `--yolo` (continuous) and `--from=phase` (resume point).

### Setup & Standards

| Command | Usage | Purpose |
|---------|-------|---------|
| `/maister:init` | `/maister:init` | Initialize framework with project analysis and smart defaults for docs/standards |
| `/maister:standards-update` | `/maister:standards-update [path]` | Update/create standards from conversation context |
| `/maister:standards-discover` | `/maister:standards-discover [--scope=SCOPE]` | Discover standards from config files and code patterns |

> **Note**: These are all skills (not commands). `/maister:init`, `/maister:standards-update`, and `/maister:standards-discover` invoke their respective skills which delegate file operations to the internal `docs-manager` skill.

### Workflow Commands

#### Unified Development Command (Recommended)

| Command | Usage | Description |
|---------|-------|-------------|
| `/maister:development-new` | `[desc] [--type=TYPE] [--yolo] [--e2e] [--user-docs] [--research=PATH]` | Start bug fix, enhancement, or new feature (auto-detected or `--type=bug\|enhancement\|feature`) |
| `/maister:development-resume` | `[path] [--from=PHASE] [--reset-attempts]` | Resume interrupted development workflow |

**Task directories by type**: `.maister/tasks/bug-fixes/`, `.maister/tasks/enhancements/`, `.maister/tasks/new-features/`

**Research-Based Development**: Start development informed by a completed research workflow:
```bash
# Auto-detect research folder (recommended)
/maister:development-new .maister/tasks/research/2026-01-12-oauth-research

# Explicit --research flag
/maister:development-new "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
```
Research context flows through ALL phases without skipping any. Research artifacts are copied to `analysis/research-context/` and summaries pass to every subagent via Pattern 7.

#### Other Workflow Commands

| Command | Usage | Task Directory |
|---------|-------|----------------|
| `/maister:performance-new` | `[desc] [--yolo]` | `.maister/tasks/performance/` |
| `/maister:performance-resume` | `[path] [--from=phase]` | |
| `/maister:migration-new` | `[desc] [--yolo] [--type=TYPE]` | `.maister/tasks/migrations/` |
| `/maister:migration-resume` | `[path] [--from=phase]` | |
| `/maister:research-new` | `[question] [--yolo] [--type=TYPE] [--brainstorm] [--no-brainstorm]` | `.maister/tasks/research/` |
| `/maister:research-resume` | `[path] [--from=phase]` | |

### Review & Audit Commands

| Command | Usage | Purpose |
|---------|-------|---------|
| `/maister:reviews-code` | `[path] [--scope=SCOPE]` | Automated code quality, security, performance analysis |
| `/maister:reviews-pragmatic` | `[path]` | Detect over-engineering, ensure code matches project scale |
| `/maister:reviews-spec-audit` | `[spec-path]` | Independent spec audit for completeness and clarity |
| `/maister:reviews-reality-check` | `[task-path]` | Validate work actually solves the problem |
| `/maister:reviews-production-readiness` | `[path] [--target=ENV]` | Pre-deployment verification with GO/NO-GO recommendation |

### Quick Commands

| Command | Usage | Purpose |
|---------|-------|---------|
| `/maister:quick-plan` | `[task description]` | Enter planning mode with standards awareness from INDEX.md |
| `/maister:quick-dev` | `[task description]` | Implement directly with standards awareness (no planning) |

**See**: Individual `commands/*/` and `skills/*/skill.md` files for detailed documentation.

## Available Subagents

Subagents are specialized AI agents invoked by skills and orchestrators. All agents are read-only unless specified.

### Initialization & Analysis Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `project-analyzer` | Deep codebase analysis for tech stack, architecture, conventions | `/maister:init` | `agents/project-analyzer.md` |
| `task-classifier` | Classifies task descriptions into 6 types with confidence scoring | `/work` command | `agents/task-classifier.md` |
| `gap-analyzer` | Compares current vs desired state with task-type support (bug/enhancement/feature) | development-orchestrator | `agents/gap-analyzer.md` |
| `specification-creator` | Creates specs from gathered requirements with reusability search and self-verification | development-orchestrator, migration-orchestrator | `agents/specification-creator.md` |
| `implementation-planner` | Breaks specs into task groups with test-driven steps and dependency chains | development-orchestrator, migration-orchestrator | `agents/implementation-planner.md` |
| `codebase-analysis-reporter` | Merges raw Explore agent findings into structured analysis report with deduplication, cross-referencing, and risk assessment | codebase-analyzer skill | `agents/codebase-analysis-reporter.md` |

**Deprecated Agent**:
- `existing-feature-analyzer` → Replaced by `codebase-analyzer` skill (uses adaptive parallel Explore subagents)

### UI & Documentation Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `ui-mockup-generator` | ASCII mockups showing UI integration with existing layouts | development-orchestrator (feature/enhancement) | `agents/ui-mockup-generator.md` |
| `e2e-test-verifier` | Playwright browser testing with screenshots | development-orchestrator (optional) | `agents/e2e-test-verifier.md` |
| `user-docs-generator` | User documentation with Playwright screenshots | development-orchestrator (optional) | `agents/user-docs-generator.md` |

### Performance Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `bottleneck-analyzer` | Static code analysis detecting N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leak patterns. Optionally incorporates user-provided profiling data. | performance-orchestrator | `agents/bottleneck-analyzer.md` |

### Research Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `research-planner` | Creates methodology and identifies sources | research-orchestrator | `agents/research-planner.md` |
| `information-gatherer` | Multi-source data collection with citations | research-orchestrator | `agents/information-gatherer.md` |
| `research-synthesizer` | Pattern identification, insights generation | research-orchestrator | `agents/research-synthesizer.md` |
| `solution-brainstormer` | Solution alternatives with multi-perspective trade-off analysis | research-orchestrator | `agents/solution-brainstormer.md` |
| `solution-designer` | High-level C4 architecture design and ADR documentation | research-orchestrator | `agents/solution-designer.md` |

### Verification Agents

| Agent | Purpose | Invoked By | Details |
|-------|---------|------------|---------|
| `implementation-completeness-checker` | Plan completion + standards compliance + documentation completeness | implementation-verifier | `agents/implementation-completeness-checker.md` |
| `test-suite-runner` | Runs full test suite, analyzes results, flags regressions | implementation-verifier | `agents/test-suite-runner.md` |
| `code-reviewer` | Automated code quality, security, performance analysis | implementation-verifier, standalone command | `agents/code-reviewer.md` |
| `production-readiness-checker` | Pre-deployment verification with GO/NO-GO recommendation | implementation-verifier, performance-orchestrator, standalone command | `agents/production-readiness-checker.md` |

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

**Purpose**: Prevents interactive mode from being bypassed when Claude receives "continue without asking" instructions after compaction. The compacted context retains information about which task was being worked on, but may lose the explicit `mode: interactive` setting.

**Logging**: Hook executions are logged to `~/.maister-hooks.log` for debugging:
```
[2026-01-19 14:30:45] SessionStart(compact) | project=/Users/marek/myproject
```

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
