# Contributing Guide

Thank you for your interest in contributing to the AI SDLC plugin! This guide will help you extend the plugin with new skills, commands, agents, and standards.

## Table of Contents

- [Development Setup](#development-setup)
- [Creating New Skills](#creating-new-skills)
- [Adding New Commands](#adding-new-commands)
- [Creating New Agents](#creating-new-agents)
- [Adding Standards](#adding-standards)
- [Testing Your Changes](#testing-your-changes)
- [Documentation Guidelines](#documentation-guidelines)
- [Submitting Changes](#submitting-changes)

---

## Development Setup

### Prerequisites

- **Claude Code** installed and configured
- **Git** for version control
- **Node.js** (if testing with JavaScript/TypeScript projects)
- **Python** (if testing with Python projects)
- **Text editor** (VS Code, vim, etc.)

### Local Plugin Development

1. **Clone the plugin repository**:
   ```bash
   git clone [repository-url]
   cd ai-sdlc
   ```

2. **Install in Claude Code**:
   The plugin is automatically recognized when in the Claude Code plugins directory.

3. **Test in a sample project**:
   ```bash
   cd /path/to/test-project
   /init-sdlc
   ```

4. **Make changes and test**:
   - Edit plugin files
   - Test commands in your sample project
   - Iterate until working

---

## Creating New Skills

Skills are autonomous workflows that orchestrate complex tasks. Here's how to create a new skill.

### Step 1: Create Skill Directory

```bash
mkdir -p skills/my-custom-orchestrator
cd skills/my-custom-orchestrator
```

### Step 2: Create SKILL.md

The `SKILL.md` file is the main entry point for the skill. Create it with this structure:

```markdown
# My Custom Orchestrator

**Purpose**: [Brief description of what this skill does]

**Use Cases**:
- [Use case 1]
- [Use case 2]
- [Use case 3]

**Workflow Overview**: [High-level description of the workflow]

---

## Workflow Phases

### Phase 0: Initialization

**Purpose**: [What this phase does]

**Actions**:
- [Action 1]
- [Action 2]

**Output**: [What gets created]

### Phase 1: [Phase Name]

[Continue for each phase...]

---

## Execution Instructions

When this skill is invoked, follow this workflow:

1. **Initialize**
   - Validate input parameters
   - Create task directory: `.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/`
   - Initialize state management (create orchestrator-state.yml)
   - Read INDEX.md for project context

2. **Execute Phases**
   - For each phase:
     - Execute phase logic
     - Update state file
     - Handle errors with auto-recovery
     - Persist results

3. **Finalize**
   - Update metadata.yml (status: completed)
   - Create summary
   - Return to user

---

## State Management

State file location: `[task-path]/orchestrator-state.yml`

State structure:
```yaml
workflow: my-custom
current_phase: phase-name
phase_history:
  - phase-1: completed
  - phase-2: in_progress
execution_mode: interactive
options: {}
auto_fix_attempts: {}
failures: []
created_at: YYYY-MM-DDTHH:MM:SSZ
updated_at: YYYY-MM-DDTHH:MM:SSZ
```

---

## Auto-Recovery Strategies

[Document error types and recovery strategies...]

---

## Agent Delegation

This skill delegates to these agents:

- **[agent-name]**: [Purpose and when invoked]
- **[agent-name]**: [Purpose and when invoked]

---

## Examples

[Provide usage examples...]

---

## References

See `references/` directory for:
- [Reference file 1 description]
- [Reference file 2 description]
```

### Step 3: Create References (Optional)

Create conceptual guides in `references/`:

```bash
mkdir references
```

Create files like:
- `references/phases.md` - Detailed phase descriptions
- `references/auto-fix-strategies.md` - Recovery strategies
- `references/workflow-examples.md` - Usage examples

**Important**: Keep references conceptual (patterns and principles), not prescriptive (exact implementations). See [Plugin Documentation Principles](../CLAUDE.md#plugin-documentation-principles).

**Size Guidelines**:
- Each reference file: 300-800 lines max
- Total references per skill: <3,000 lines
- Focus on WHAT/WHEN/WHY, not HOW

### Step 4: Create Assets (Optional)

If your skill uses templates:

```bash
mkdir assets
# Add template files
touch assets/spec-template.md
```

### Step 5: Register in Plugin Metadata

Edit `.claude-plugin/plugin.json`:

```json
{
  "name": "ai-sdlc",
  "version": "1.0.0",
  "skills": {
    "my-custom-orchestrator": {
      "description": "Brief description for skill discovery",
      "location": "skills/my-custom-orchestrator"
    }
  }
}
```

### Step 6: Test the Skill

Test via Skill tool or command:

```bash
# Via Skill tool (in Claude Code conversation)
[Use Skill tool to invoke my-custom-orchestrator]

# Via command (if you created one)
/ai-sdlc:my-custom:new "test description"
```

### Skill Best Practices

1. **Phase-based structure** - Break workflow into clear phases following the 7-step phase execution pattern
2. **State persistence** - Always persist state for pause/resume (see `orchestrator-framework/references/state-management.md`)
3. **Auto-recovery** - Implement intelligent error handling (max 3 attempts per phase)
4. **Agent delegation** - Delegate specialized work to agents
5. **Standards discovery** - Check INDEX.md throughout execution
6. **Evidence-based** - All analysis must reference actual code/files
7. **Read-only verification** - Verification phases never modify code

**For New Orchestrators**: Reference the shared patterns in `skills/orchestrator-framework/references/` instead of duplicating common logic. See existing orchestrators (development-orchestrator, security-orchestrator) for examples of how to reference framework patterns.

---

## Adding New Commands

Commands provide user-facing slash command interfaces.

### Step 1: Create Command Directory

```bash
mkdir -p commands/my-workflow
cd commands/my-workflow
```

### Step 2: Create Command Files

Create `new.md` for starting workflow:

```markdown
# /ai-sdlc:my-workflow:new

Start a new [workflow type] workflow.

## Usage

```bash
/ai-sdlc:my-workflow:new [description] [--options]
```

## Parameters

- `description` (required): Description of the task
- `--yolo` (optional): Run in continuous mode without pausing
- `--from=phase` (optional): Start from specific phase

## What This Command Does

1. Validates input
2. Invokes `my-custom-orchestrator` skill
3. Passes parameters and options
4. Returns results to user

## Examples

```bash
/ai-sdlc:my-workflow:new "Implement feature X"
/ai-sdlc:my-workflow:new "Implement feature X" --yolo
```

## Execution

When user runs this command:

1. **Validate Input**
   - Ensure description provided
   - Parse options

2. **Invoke Skill**
   Use Skill tool to invoke my-custom-orchestrator:
   - Pass description
   - Pass execution mode (interactive or yolo)
   - Pass start phase if specified

3. **Handle Response**
   - Display workflow progress
   - Show completion summary
   - Provide next steps

## See Also

- [Resume Command](resume.md)
- [Skill Documentation](../../skills/my-custom-orchestrator/SKILL.md)
```

Create `resume.md` for resuming workflow:

```markdown
# /ai-sdlc:my-workflow:resume

Resume an interrupted [workflow type] workflow.

## Usage

```bash
/ai-sdlc:my-workflow:resume [task-path] [--options]
```

## Parameters

- `task-path` (required): Path to task directory
- `--from=phase` (optional): Override resume point
- `--reset-attempts` (optional): Reset auto-recovery attempts
- `--clear-failures` (optional): Clear failure history

## What This Command Does

1. Loads saved state from orchestrator-state.yml
2. Validates state consistency
3. Resumes my-custom-orchestrator skill from saved phase
4. Continues execution

## Examples

```bash
/ai-sdlc:my-workflow:resume .ai-sdlc/tasks/[type]/2025-11-17-task-name
/ai-sdlc:my-workflow:resume .ai-sdlc/tasks/[type]/2025-11-17-task-name --from=implementation
/ai-sdlc:my-workflow:resume .ai-sdlc/tasks/[type]/2025-11-17-task-name --reset-attempts
```

## State Recovery

If state file is corrupted or missing:

```bash
/ai-sdlc:my-workflow:resume [task-path] --reconstruct
```

This reads artifacts (spec.md, implementation-plan.md) to rebuild state.

## See Also

- [New Command](new.md)
- [Skill Documentation](../../skills/my-custom-orchestrator/SKILL.md)
```

### Step 3: Register Command

Commands are auto-discovered from the `commands/` directory. Ensure files follow naming convention:
- `new.md` - Start new workflow
- `resume.md` - Resume workflow
- Other action files as needed

### Command Best Practices

1. **Clear usage examples** - Show common use cases
2. **Document all parameters** - Including optional flags
3. **Reference skill documentation** - Link to SKILL.md
4. **Handle errors gracefully** - Provide helpful error messages
5. **Thin wrapper pattern** - Commands route to skills, don't implement logic

---

## Creating New Agents

Agents are specialized subagents that perform focused tasks (analysis, planning, verification).

### Step 1: Create Agent File

```bash
touch agents/my-custom-analyzer.md
```

### Step 2: Document the Agent

```markdown
# my-custom-analyzer

**Type**: Analysis Agent

**Purpose**: [Brief description of what this agent analyzes]

**Capabilities**:
- [Capability 1]
- [Capability 2]
- [Capability 3]

**Tools Access**: Read, Grep, Glob, Bash (read-only)

---

## Workflow

When invoked, this agent follows this process:

### 1. Initialize & Validate

**Input**: [What input is required]

**Actions**:
- Validate input parameters
- Determine analysis scope
- Set up analysis context

### 2. [Analysis Step 1]

**Purpose**: [What this step does]

**Actions**:
- [Action 1]
- [Action 2]

**Tools**: [Which tools are used]

### 3. [Analysis Step 2]

[Continue for each step...]

### N. Generate Report

**Purpose**: Create structured analysis report

**Actions**:
- Compile findings
- Categorize by [criteria]
- Create markdown report

**Output Location**: `[path]/my-analysis-report.md`

---

## Output Format

The agent produces a markdown report with this structure:

```markdown
# My Analysis Report

## Summary
[High-level findings]

## Detailed Findings

### Category 1
[Findings in this category]

### Category 2
[Findings in this category]

## Recommendations
[Actionable recommendations]
```

---

## Usage

This agent is invoked by:
- **Skill**: [skill-name] during [phase]
- **Command**: [command] (if standalone)

**Invocation**:
```
Use Task tool with subagent_type: my-custom-analyzer
```

---

## Examples

[Provide usage examples showing input → output]

---

## Philosophy

[Agent's approach and principles, e.g., "Evidence-based analysis. Every finding must reference actual code."]
```

### Agent Categories

Choose the appropriate category for your agent:

- **Analysis Agents**: Pre-phase analysis (baseline metrics, code quality, security scan)
- **Planning Agents**: Create detailed plans (implementation steps, remediation plans)
- **Verification Agents**: Post-implementation verification (behavior verification, security verification)
- **Utility Agents**: Helper agents (task classification, UI mockups, documentation generation)

### Agent Best Practices

1. **Single responsibility** - Each agent does one thing well
2. **Read-only (for analysis)** - Analysis agents never modify code
3. **Evidence-based** - All findings reference actual code/files
4. **Structured output** - Return consistent, parseable results
5. **Tool access** - Request minimal necessary tools
6. **Reusability** - Design for use across multiple workflows

---

## Adding Standards

Standards are project-specific coding conventions discovered and applied by workflows.

### Step 1: Determine Category

Standards are organized by category:
- `global/` - Language-agnostic standards
- `frontend/` - Frontend-specific standards
- `backend/` - Backend-specific standards
- `testing/` - Testing standards

### Step 2: Create Standard File

Example: `.ai-sdlc/docs/standards/backend/api-design.md`

```markdown
# API Design Standards

## Purpose

This document defines standards for designing RESTful APIs in this project.

## Naming Conventions

### Endpoints
- Use plural nouns for resources: `/users`, `/posts`, `/comments`
- Use kebab-case for multi-word resources: `/user-profiles`
- Avoid verbs in endpoint names

**Examples**:
```
✓ GET /users
✓ POST /users
✓ GET /users/123
✗ GET /getUsers
✗ POST /createUser
```

### HTTP Methods
- `GET` - Retrieve resources
- `POST` - Create new resource
- `PUT` - Replace entire resource
- `PATCH` - Update partial resource
- `DELETE` - Remove resource

## Response Format

All API responses must follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "metadata": {
    "timestamp": "2025-11-17T10:30:00Z",
    "version": "1.0"
  }
}
```

**Error responses**:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "User-friendly error message",
    "details": { ... }
  }
}
```

## Status Codes

Use appropriate HTTP status codes:
- `200 OK` - Successful GET, PUT, PATCH, DELETE
- `201 Created` - Successful POST
- `400 Bad Request` - Validation error
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource doesn't exist
- `500 Internal Server Error` - Server error

## Pagination

For list endpoints, use cursor-based pagination:

```
GET /users?cursor=abc123&limit=20
```

Response includes pagination metadata:
```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "def456",
    "has_more": true
  }
}
```

## Versioning

Version APIs using URL prefix:
```
/api/v1/users
/api/v2/users
```

## Authentication

All endpoints require JWT authentication except:
- `POST /auth/login`
- `POST /auth/register`
- Health check endpoints

Include JWT in Authorization header:
```
Authorization: Bearer <token>
```

## Rate Limiting

Apply rate limiting:
- Authenticated: 1000 requests/hour
- Unauthenticated: 100 requests/hour

Return rate limit headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1637155200
```

## Examples

[Provide complete endpoint examples showing request/response]

---

**Last Updated**: 2025-11-17
**Applies To**: All backend API development
```

### Step 3: Update INDEX.md

Add reference to new standard in `.ai-sdlc/docs/INDEX.md`:

```markdown
## Backend Standards

- [API Design](standards/backend/api-design.md) - RESTful API conventions
- [Database Conventions](standards/backend/database-conventions.md)
- [Error Handling](standards/backend/error-handling.md)
```

### Step 4: Test Discovery

Run a workflow to verify the standard is discovered:

```bash
/ai-sdlc:feature:new "Add new API endpoint"
# Check work-log.md to see if standard was applied
```

### Standards Best Practices

1. **Specific and actionable** - Clear dos and don'ts
2. **Examples included** - Show correct and incorrect usage
3. **Project-specific** - Tailored to your tech stack
4. **Living document** - Update as practices evolve
5. **Discoverable** - Always referenced in INDEX.md

---

## Testing Your Changes

### Testing Skills

1. **Create test project**:
   ```bash
   mkdir test-project
   cd test-project
   git init
   ```

2. **Initialize SDLC**:
   ```bash
   /init-sdlc
   ```

3. **Test your skill**:
   ```bash
   /ai-sdlc:my-workflow:new "Test feature"
   ```

4. **Verify outputs**:
   - Check task directory created correctly
   - Review generated files (spec.md, implementation-plan.md)
   - Verify state management works
   - Test pause/resume capability

### Testing Commands

1. **Test command parsing**:
   ```bash
   /ai-sdlc:my-workflow:new "description" --yolo
   # Verify options parsed correctly
   ```

2. **Test error handling**:
   ```bash
   /ai-sdlc:my-workflow:new
   # Should show error: description required
   ```

3. **Test resume**:
   ```bash
   /ai-sdlc:my-workflow:resume [task-path]
   # Verify resumes from correct phase
   ```

### Testing Agents

1. **Create test scenario** - Set up codebase that needs analysis

2. **Invoke agent via skill** - Use your skill to trigger agent

3. **Verify output**:
   - Check report structure
   - Validate findings reference actual code
   - Ensure recommendations are actionable

### Integration Testing

Test complete workflow end-to-end:

```bash
# Start workflow
/ai-sdlc:my-workflow:new "Complete test"

# Pause mid-workflow (interrupt)

# Resume
/ai-sdlc:my-workflow:resume [task-path]

# Verify completes successfully
```

---

## Documentation Guidelines

### Documentation Principles

Follow the plugin's documentation philosophy (see [CLAUDE.md](../CLAUDE.md#plugin-documentation-principles)):

1. **Trust Claude to reason** - Provide principles, not prescriptive steps
2. **No verbose pseudocode** - Show patterns, not implementations
3. **No prescriptive templates** - Guide thinking, don't dictate prompts
4. **Avoid duplication** - Reference instead of repeating
5. **Single source of truth** - Orchestration logic in skill.md
6. **Principle over process** - Explain WHY and WHEN, trust Claude for HOW

### Target Lengths

| Documentation Type | Target Length |
|-------------------|---------------|
| Skill descriptions (in CLAUDE.md) | 5-15 lines |
| Command descriptions (in CLAUDE.md) | 3-8 lines |
| SKILL.md files | Variable, focus on workflow |
| Agent documentation | 200-400 lines |
| Reference files | 300-800 lines each, <3,000 total per skill |

### What to Document

**Must document**:
- Purpose and use cases
- Workflow phases
- Input/output formats
- State management
- Agent delegation
- Examples

**Don't document**:
- Complete code implementations
- Framework-specific boilerplate
- Obvious logic (Claude can infer)

### Style Guide

- **Active voice** - "Create specification" not "Specification is created"
- **Present tense** - "Agent analyzes" not "Agent will analyze"
- **Concise** - Remove unnecessary words
- **Scannable** - Use headers, bullets, tables
- **Linked** - Reference related docs

---

## Submitting Changes

### Before Submitting

1. **Test thoroughly** - Test all new functionality
2. **Update documentation** - Document all changes
3. **Follow principles** - Adhere to plugin philosophy
4. **Check consistency** - Match existing code style

### Submission Process

1. **Create feature branch**:
   ```bash
   git checkout -b feature/my-custom-orchestrator
   ```

2. **Commit changes**:
   ```bash
   git add .
   git commit -m "Add my-custom-orchestrator skill

   - Implements new workflow for [purpose]
   - Adds commands: /ai-sdlc:my-workflow:new and :resume
   - Includes comprehensive documentation
   - Tested end-to-end"
   ```

3. **Push to repository**:
   ```bash
   git push origin feature/my-custom-orchestrator
   ```

4. **Create pull request**:
   - Clear description of changes
   - Rationale for new feature
   - Testing performed
   - Documentation updates

### Pull Request Checklist

- [ ] Skill/Agent/Command tested end-to-end
- [ ] SKILL.md or agent documentation complete
- [ ] Command documentation created
- [ ] CLAUDE.md updated with new feature
- [ ] README.md updated if needed
- [ ] References follow size guidelines (<1,000 lines per file)
- [ ] No verbose pseudocode or prescriptive templates
- [ ] Examples provided
- [ ] Follows plugin philosophy

---

## Development Resources

### Key Files to Understand

- **CLAUDE.md** - Comprehensive plugin documentation (master reference)
- **Architecture.md** - Component relationships and execution flow
- **skills/feature-orchestrator/** - Reference implementation of orchestrator
- **agents/project-analyzer.md** - Reference implementation of analysis agent
- **commands/feature/new.md** - Reference implementation of command

### Useful Patterns

Study existing implementations:

**Orchestrator Framework** (start here for new orchestrators):
- `skills/orchestrator-framework/references/` - Shared patterns all orchestrators use
- `skills/orchestrator-framework/SKILL.md` - Framework overview

**Orchestrator Pattern**:
- skills/development-orchestrator - Unified workflow (bug/enhancement/feature)
- skills/security-orchestrator - Security remediation workflow
- skills/refactoring-orchestrator - Safe refactoring with behavior verification

**Analysis Pattern**:
- agents/refactoring-analyzer.md
- agents/security-analyzer.md
- agents/performance-profiler.md

**Verification Pattern**:
- agents/behavioral-verifier.md
- agents/performance-verifier.md
- agents/security-verifier.md

### Plugin Development Tips

1. **Start small** - Begin with a simple agent or utility skill
2. **Study existing code** - Learn from reference implementations
3. **Iterate** - Test early and often
4. **Ask questions** - Consult existing documentation
5. **Follow patterns** - Consistency makes the plugin easier to use

---

## Questions?

- **Documentation**: Check [CLAUDE.md](../CLAUDE.md) for comprehensive reference
- **Architecture**: See [Architecture.md](Architecture.md) for component details
- **Examples**: Study existing skills/agents/commands
- **Troubleshooting**: See [Troubleshooting.md](Troubleshooting.md)

---

**Thank you for contributing to the AI SDLC plugin!** Your extensions help teams adopt structured, test-driven development workflows.
