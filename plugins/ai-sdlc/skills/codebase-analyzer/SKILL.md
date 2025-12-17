---
name: codebase-analyzer
description: Analyzes codebase using 3 parallel Explore subagents for comprehensive understanding. Adapts analysis focus based on task type (bug/enhancement/feature). Produces structured analysis report for downstream workflow phases. Reusable across multiple orchestrators.
---

# Codebase Analyzer Skill

This skill orchestrates parallel codebase analysis using built-in Explore subagents. It provides comprehensive understanding of existing code before development work begins.

## When to Use This Skill

Use this skill when:
- Starting Phase 0 of development-orchestrator (bug/enhancement/feature)
- Starting Phase 0 of migration-orchestrator (current state analysis)
- Need comprehensive codebase understanding before making changes
- Analyzing existing code for any development task

## Core Principles

1. **Parallel Execution**: Always launch 3 Explore agents in parallel for speed
2. **Task-Type Awareness**: Adapt prompts and focus based on task type
3. **Structured Output**: Produce consistent artifact format for downstream phases
4. **Comprehensive Coverage**: File discovery + code analysis + context discovery

---

## Input Parameters

When invoked, expect these parameters from the orchestrator:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_type` | Yes | One of: `bug`, `enhancement`, `feature` |
| `description` | Yes | Task description from user |
| `task_path` | Yes | Path to task directory (e.g., `.ai-sdlc/tasks/enhancements/2025-01-15-add-sorting/`) |
| `artifact_name` | No | Override output filename (default: `codebase-analysis.md`) |

---

## Execution Workflow

### Step 1: Parse Input and Determine Focus

**Extract key information from description:**
- Identify keywords, component names, file hints
- Determine domain (user, product, auth, etc.)
- Detect technology hints (React, API, database, etc.)

**Set analysis focus based on task_type:**

| Task Type | Primary Focus | Key Questions |
|-----------|---------------|---------------|
| `bug` | Find buggy code path | Where does the bug occur? What's the execution flow? |
| `enhancement` | Find existing feature | What files implement this feature? How does it work? |
| `feature` | Find patterns/integration points | What similar patterns exist? Where should this integrate? |

---

### Step 2: Launch 3 Parallel Explore Subagents

**CRITICAL: You MUST use the built-in Explore agent via the Task tool.**

```
Use Task tool 3 times in ONE message with subagent_type="Explore":

Task 1: File Discovery Agent (subagent_type: "Explore")
Task 2: Code Analysis Agent (subagent_type: "Explore")
Task 3: Context Discovery Agent (subagent_type: "Explore")
```

**Required Task tool parameters:**
- `subagent_type`: MUST be `"Explore"` - the built-in fast exploration agent
- `description`: Short 3-5 word description (e.g., "Find relevant files")
- `prompt`: Task-type-specific prompt from templates below

**Why Explore agent?** The built-in Explore agent is optimized for codebase exploration with access to Glob, Grep, and Read tools. It's faster and more reliable than general-purpose agents for file discovery tasks.

#### Agent 1: File Discovery

**Purpose**: Locate relevant files by patterns, keywords, and naming conventions.

**Prompt template by task type:**

**Bug:**
```
Explore the codebase to find files related to: "[description]"

Focus on:
1. Find files where the bug likely occurs (search for error keywords, related functionality)
2. Trace the code path - entry points, handlers, processing logic
3. Look for related error handling, validation, edge cases
4. Find configuration files that might affect this behavior

Output a list of relevant files with their paths and why they're relevant.
Be thorough - check multiple naming conventions (PascalCase, kebab-case, snake_case).
```

**Enhancement:**
```
Explore the codebase to find files that implement: "[description]"

Focus on:
1. Find the main files for this feature (components, services, controllers)
2. Look for related files (types, utilities, hooks, styles)
3. Check multiple naming patterns: *{keyword}*, {Domain}{Component}, etc.
4. Search in likely directories: src/components/, src/services/, src/features/

Output a ranked list of files with confidence indicators.
Include file paths, approximate line counts, and why each file is relevant.
```

**Feature:**
```
Explore the codebase to find patterns and integration points for: "[description]"

Focus on:
1. Find similar existing features/components to use as templates
2. Identify where this new feature should live (directory structure)
3. Look for shared utilities, hooks, or base classes to extend
4. Find entry points where this feature needs to integrate (routes, menus, etc.)

Output files that serve as good examples or integration points.
Include reasoning for why each pattern/location is appropriate.
```

#### Agent 2: Code Analysis

**Purpose**: Analyze code structure, patterns, and current behavior.

**Prompt template by task type:**

**Bug:**
```
Analyze the code related to: "[description]"

Focus on:
1. Trace execution flow from input to output
2. Identify state changes and side effects
3. Look for edge cases, error conditions, race conditions
4. Find validation logic and where it might fail
5. Check for recent changes that might have introduced the bug

Output:
- Execution flow diagram (text-based)
- Key functions/methods involved
- Potential problem areas
- State management approach
```

**Enhancement:**
```
Analyze the existing implementation of: "[description]"

Focus on:
1. Understand current functionality and capabilities
2. Identify the component/service architecture
3. Document the data flow (props, state, API calls)
4. Note coding patterns used (hooks, classes, functional)
5. Assess complexity (simple/moderate/complex)

Output:
- Current functionality summary
- Architecture overview
- Key functions and their purposes
- Coding patterns observed
```

**Feature:**
```
Analyze the codebase architecture for adding: "[description]"

Focus on:
1. Understand the overall project structure
2. Identify architectural patterns in use (MVC, component-based, etc.)
3. Document naming conventions and code style
4. Find the data layer patterns (API, state management)
5. Note any relevant abstractions or base classes

Output:
- Project structure overview
- Architectural patterns to follow
- Naming conventions to match
- Recommended approach for new feature
```

#### Agent 3: Context Discovery

**Purpose**: Find tests, dependencies, consumers, and integration context.

**Prompt template by task type:**

**Bug:**
```
Find testing and context information for: "[description]"

Focus on:
1. Find existing tests that cover this functionality
2. Look for test files that might help reproduce the bug
3. Identify test data or fixtures used
4. Find related integration or E2E tests
5. Check for any existing bug reports or TODOs in comments

Output:
- Relevant test files and what they test
- Test coverage gaps
- Reproduction hints from tests
- Related issues or TODOs found in code
```

**Enhancement:**
```
Find dependencies and consumers for: "[description]"

Focus on:
1. Find all files that import/use this feature (consumers)
2. Identify what this feature depends on (dependencies)
3. Locate test files and assess coverage
4. Find API endpoints or routes related to this feature
5. Check for documentation or comments

Output:
- Consumer list (who uses this)
- Dependency list (what this uses)
- Test files and coverage assessment
- Integration points
```

**Feature:**
```
Find integration requirements for: "[description]"

Focus on:
1. Identify where this feature needs to be registered/routed
2. Find existing integration patterns (how other features connect)
3. Look for shared dependencies this feature will need
4. Check for authentication/authorization patterns to follow
5. Find configuration or environment requirements

Output:
- Required integration points
- Patterns to follow for registration
- Shared dependencies to use
- Configuration requirements
```

---

### Step 3: Collect and Merge Results

**Wait for all 3 agents to complete, then merge findings:**

1. **Deduplicate files**: Combine file lists, remove duplicates
2. **Consolidate analysis**: Merge code analysis from all agents
3. **Cross-reference**: Connect files → analysis → tests
4. **Identify gaps**: Note areas where agents found limited information

---

### Step 4: Generate Analysis Report

**Create artifact at**: `{task_path}/analysis/{artifact_name}`

Default: `{task_path}/analysis/codebase-analysis.md`

**Report Template:**

```markdown
# Codebase Analysis Report

**Date**: [timestamp]
**Task Type**: [bug/enhancement/feature]
**Description**: [task description]
**Analyzer**: codebase-analyzer skill (3 parallel Explore agents)

---

## Summary

[2-3 sentence overview of what was found. For bugs: where the issue likely is. For enhancements: what exists today. For features: recommended integration approach.]

---

## Files Identified

### Primary Files

[List main files with line counts and brief descriptions]

**[file_path]** ([X] lines)
- [What this file does]
- [Why it's relevant]

### Related Files

[List supporting files: types, utilities, styles, configs]

**[file_path]** ([X] lines)
- [Relationship to primary files]

---

## Current Functionality

[For bugs: describe the code path and where failure occurs]
[For enhancements: describe what the feature currently does]
[For features: describe similar patterns found]

### Key Components/Functions

- **[name]**: [description]
- **[name]**: [description]

### Data Flow

[Describe how data moves through the system]

---

## Dependencies

### Imports (What This Depends On)

- [dependency]: [purpose]
- [dependency]: [purpose]

### Consumers (What Depends On This)

- **[file]**: [how it uses this]
- **[file]**: [how it uses this]

**Consumer Count**: [N] files
**Impact Scope**: [Low/Medium/High] - [explanation]

---

## Test Coverage

### Test Files

- **[test_file]**: [what it tests]
- **[test_file]**: [what it tests]

### Coverage Assessment

- **Test count**: [N] tests
- **Coverage**: [percentage if available]
- **Gaps**: [what's not tested]

---

## Coding Patterns

### Naming Conventions

- **Components**: [pattern]
- **Functions**: [pattern]
- **Files**: [pattern]

### Architecture Patterns

- **Style**: [functional/class-based/etc.]
- **State Management**: [local/context/redux/etc.]
- **Styling**: [CSS modules/styled-components/tailwind/etc.]

---

## Complexity Assessment

### Factors

| Factor | Value | Level |
|--------|-------|-------|
| File Size | [X] lines | [Low/Med/High] |
| Dependencies | [X] imports | [Low/Med/High] |
| Consumers | [X] usages | [Low/Med/High] |
| Test Coverage | [X] tests | [Low/Med/High] |

### Overall: [Simple/Moderate/Complex]

[Brief explanation of complexity assessment]

---

## Key Findings

### Strengths
- [strength 1]
- [strength 2]

### Concerns
- [concern 1]
- [concern 2]

### Opportunities
- [opportunity 1]
- [opportunity 2]

---

## Impact Assessment

### Scope of Changes

- **Primary changes**: [files that will be modified]
- **Related changes**: [files that might need updates]
- **Test updates**: [testing impact]

### Risk Level: [Low/Low-Medium/Medium/Medium-High/High]

[Explanation of risk factors]

---

## Recommendations

### For Bug Fix
[If task_type = bug]
1. [Recommended fix approach]
2. [Testing strategy]
3. [Verification steps]

### For Enhancement
[If task_type = enhancement]
1. [Implementation strategy]
2. [Backward compatibility approach]
3. [Testing requirements]

### For New Feature
[If task_type = feature]
1. [Recommended architecture]
2. [Integration approach]
3. [Patterns to follow]

---

## Next Steps

[What the orchestrator should do next - typically invoke gap-analyzer]
```

---

### Step 5: Return Results to Orchestrator

**Return structured result:**

```yaml
status: success|partial|failed
report_path: analysis/codebase-analysis.md
summary: "[1-2 sentence summary]"
files_found: [count]
primary_files:
  - path: [file_path]
    lines: [count]
    relevance: [high/medium/low]
complexity: simple|moderate|complex
risk_level: low|low-medium|medium|medium-high|high
```

---

## Error Handling

### No Relevant Files Found

If agents find no relevant files:
1. Report partial results with low confidence
2. Include search strategies attempted
3. Suggest user provide more specific hints
4. Recommend manual file path input

### Agent Timeout

If an agent times out:
1. Use results from completed agents
2. Note which analysis is incomplete
3. Suggest re-running with focused scope

### Conflicting Results

If agents provide conflicting information:
1. Present all perspectives
2. Highlight conflicts for user review
3. Recommend verification before proceeding

---

## Integration with Orchestrators

### development-orchestrator

Invoked in Phase 0 for all task types (bug/enhancement/feature).
Output feeds into Phase 1 (Gap Analysis).

### migration-orchestrator

Invoked in Phase 0 for current state analysis.
Use `artifact_name: current-state-analysis.md` for migration context.

---

## Performance Notes

- **Parallel execution**: 3x faster than sequential analysis
- **Built-in Explore**: No custom agent maintenance required
- **Caching**: Results persist in task directory for resume
