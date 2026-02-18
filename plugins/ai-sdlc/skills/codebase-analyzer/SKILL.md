---
name: codebase-analyzer
description: Analyzes codebase using adaptive parallel Explore subagents based on task complexity. Selects agent roles from a pool, launches Explore agents, then delegates report generation to codebase-analysis-reporter subagent.
---

# Codebase Analyzer Skill

Orchestrates parallel codebase analysis using built-in Explore subagents. Adaptively selects which agent roles to activate based on task complexity, then delegates report synthesis to a specialized subagent.

## Core Principles

1. **Adaptive Agent Selection**: Select roles from a pool based on task complexity — no fixed count
2. **Task-Type Awareness**: Adapt prompts and focus based on task type
3. **Delegated Reporting**: Raw findings go to `codebase-analysis-reporter` subagent for synthesis

---

## Input Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_type` | Yes | One of: `bug`, `enhancement`, `feature` |
| `description` | Yes | Task description from user |
| `task_path` | Yes | Path to task directory |
| `artifact_name` | No | Override output filename (default: `codebase-analysis.md`) |

---

## Execution Workflow

### Step 1: Parse Input and Determine Focus

Extract keywords, component names, file hints, domain, and technology hints from the description.

| Task Type | Primary Focus | Key Questions |
|-----------|---------------|---------------|
| `bug` | Find buggy code path | Where does the bug occur? What's the execution flow? |
| `enhancement` | Find existing feature | What files implement this feature? How does it work? |
| `feature` | Find patterns/integration points | What similar patterns exist? Where should this integrate? |

### Step 2: Select Agent Roles

Choose which roles to activate from the pool. Each role is a distinct analysis concern.

| Role | Purpose | When Needed |
|------|---------|-------------|
| **File Discovery** | Find relevant files by patterns, keywords, naming | Almost always |
| **Code Analysis** | Analyze code structure, patterns, execution flow | When understanding existing behavior matters |
| **Context Discovery** | Find tests, consumers, dependencies | When understanding impact/coverage matters |
| **Pattern Mining** | Find similar implementations as templates | New features following existing patterns |
| **Migration Target** | Analyze target technology/compatibility | Migrations comparing current vs target |

**Decision signals:**
- **Specificity** (exact files mentioned → fewer agents)
- **Scope breadth** (multiple domains → more agents)
- **Uncertainty** (unclear location → more agents)
- **Task type** (bugs tend focused, features broad, migrations broadest)

**Examples:**

| Task Description | Roles Selected | Count |
|------------------|---------------|-------|
| "Fix null check in `utils/parser.ts`" | File Discovery + Code Analysis (combined) | 1 |
| "Add sorting to user table" | File Discovery, Code Analysis | 2 |
| "Fix login timeout" | File Discovery + Code Analysis (combined), Context Discovery | 2 |
| "Add OAuth authentication system" | File Discovery, Code Analysis, Context Discovery | 3 |
| "Add export feature similar to import" | File Discovery, Code Analysis, Pattern Mining | 3 |
| "Migrate from REST to GraphQL" | File Discovery, Code Analysis, Context Discovery, Migration Target | 4 |

When selecting fewer agents, merge related concerns into a single prompt — don't drop concerns.

State which roles you selected and why (1 sentence).

### Step 3: Read Prompt Templates and Launch Agents

> **STOP — Do NOT skip this step. Do NOT write prompts from memory.**
>
> Before launching ANY Explore agent, you MUST use the Read tool to load the prompt template for each selected role. This is non-negotiable.

**3a. Read templates** — Use the Read tool to load ONLY the files for your selected roles:

| Role | Read This File |
|------|--------------|
| File Discovery | `references/file-discovery.md` |
| Code Analysis | `references/code-analysis.md` |
| Context Discovery | `references/context-discovery.md` |
| Pattern Mining | `references/pattern-mining.md` |
| Migration Target | `references/migration-target.md` |

If combining roles into one agent, also read `references/combined.md` for merging guidance.

**3b. Adapt templates** — Replace `[description]` with the actual task description. Select the correct task-type section (Bug / Enhancement / Feature).

**3c. Launch agents** — Use the Task tool with `subagent_type="Explore"` — one call per selected role, all in ONE message.

**SELF-CHECK**: Did you read the template files with the Read tool? If not, go back to 3a. Do not proceed.

### Step 4: Delegate Report Generation

After all Explore agents complete, delegate to `codebase-analysis-reporter` subagent via Task tool:

```
Task tool:
  subagent_type: "maister:codebase-analysis-reporter"
  description: "Merge findings into analysis report"
  prompt: |
    You are the codebase-analysis-reporter. Merge these raw findings into a structured analysis report.

    Task type: [task_type]
    Description: [description]
    Agent roles used: [list of roles]
    Agent count: [N]
    Output path: [task_path]/analysis/[artifact_name]

    ## Raw Findings

    ### [Role 1 Name]
    [paste raw output from agent 1]

    ### [Role 2 Name]
    [paste raw output from agent 2]

    [... for each agent]
```

The subagent produces the final report at `{task_path}/analysis/{artifact_name}` and returns structured results.

### Step 5: Return Results to Orchestrator

Pass through the subagent's structured output:

```yaml
status: success|partial|failed
report_path: analysis/[artifact_name]
summary: "[1-2 sentence summary]"
files_found: [count]
complexity: simple|moderate|complex
risk_level: low|low-medium|medium|medium-high|high
```

---

## Error Handling

- **No files found**: Report partial results, suggest user provide more specific hints
- **Agent timeout**: Use results from completed agents, note incomplete analysis
- **Conflicting results**: Pass all perspectives to reporter subagent, which highlights conflicts

---

## Integration

| Orchestrator | Phase | artifact_name |
|-------------|-------|---------------|
| development-orchestrator | Phase 1 | `codebase-analysis.md` (default) |
| migration-orchestrator | Phase 1 | `current-state-analysis.md` |
| performance-orchestrator | Phase 1 | `codebase-analysis.md` (default) |
