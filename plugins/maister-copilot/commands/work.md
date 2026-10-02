---
name: work
description: Unified entry point — auto-classifies tasks and routes to appropriate workflow. ALWAYS execute when invoked via slash command.
---

**NOTE**: This is a multi-step workflow that invokes the task-classifier subagent and orchestrator skills at specific steps. The `<command-name>` tag refers to THIS command only — you MUST still use the Skill tool to invoke those other skills when instructed below. Follow ALL steps in order.

# Unified Work Entry Point

Auto-classifies tasks and routes to the appropriate workflow orchestrator. Supports resuming existing tasks or starting new ones.

## Usage

```bash
/work [task description | task folder path | issue identifier]
```

### Input Types

| Input Type | Example |
|------------|---------|
| Task folder path | `.maister/tasks/development/2025-10-23-login-timeout` |
| Folder name only | `2025-10-26-user-auth` (searches all task types) |
| Task description | `"Fix login timeout error on mobile"` |
| GitHub issue | `#456`, `GH-456`, `https://github.com/owner/repo/issues/456` |
| Jira ticket | `PROJ-456`, `https://company.atlassian.net/browse/PROJ-456` |
| Azure DevOps | `AB#123`, `https://dev.azure.com/org/project/_workitems/edit/123` |
| No argument | Prompts for input |

## Examples

```bash
# Resume existing task
/work ".maister/tasks/development/2025-10-23-login-timeout"
/work "2025-10-26-user-auth"

# New task (auto-classifies)
/work "Fix login timeout error on mobile devices"
/work "Add user authentication with email/password"
/work "Improve dashboard loading performance"

# From issue tracker
/work "#456"
/work "PROJ-123"
/work "AB#789"
```

## How It Works

1. **Detect existing task** - If input is a task folder path, route to resume
2. **Classify new task** - Invoke task-classifier subagent to determine workflow type
3. **Route to workflow** - Use Skill tool to invoke appropriate orchestrator skill

## Workflow Type Routing

| Classification | Routes To (Skill) |
|----------------|-------------------|
| development | `development` |
| performance | `performance` |
| migration | `migration` |
| research | `research` |
| product-design | `product-design` |
| workflow (one the project defines) | `run` |

A project's own workflows — definitions in `.maister/workflows/` — are candidates beside the five
types: Step 3 lists them and the classifier may choose one, which then runs by name.

---

## Workflow

### Step 1: Parse Input and Detect Task Folder

**Check if input is an existing task folder:**

1. Try path as-is (absolute path)
2. Try prepending `.maister/` (relative path)
3. Search `.maister/tasks/*/` for folder name match

**If folder exists AND contains `orchestrator-state.yml`:**
- Go to **Step 2: Resume Existing Task**

**If NOT a task folder:**
- Go to **Step 3: Classify & Route New Task**

**If no argument provided:**
- Prompt user: "What would you like to work on?" with input examples
- Then check if input is task folder or description

### Step 2: Resume Existing Task

**When existing task detected:**

1. Read `orchestrator-state.yml` from task folder.

   **A run started by name** carries a `workflow:` block whose `workflow.name` is none of the five
   types in the table below. Its folder is that name, which no row maps, so do not look it up:
   invoke `run` with the Skill tool and the task path as `args`. That skill reads the name,
   overlays and profile from the state and resumes the run; the rest of this step does not apply.

   **No `workflow:` block under `development/`, `performance/`, `migrations/`, `research/` or
   `product-design/`** means the task was started on the 2.x plugin. Skip the status menu and route it straight to its
   orchestrator (step 5) with the task path: the workflow engine refuses it before anything runs,
   and its message — where to finish the task — is the answer to relay.
2. Determine workflow type from folder path:

| Folder | Workflow Type |
|--------|--------------|
| `development/` | development |
| `performance/` | performance |
| `migrations/` | migration |
| `research/` | research |
| `product-design/` | product-design |

3. Extract status from state file:
   - `task.status`: in progress, completed, stopped or failed
   - `workflow.nodes`: the active node is the first one not yet completed, skipped or stopped

4. Present status to user with ask_user:

**For In-Progress Tasks:**
```
Options:
1. Resume from the active node
2. Cancel
```

**For Completed Tasks:**
```
Options:
1. View task details
2. Create follow-up development task
3. Re-run verification phase
4. Cancel
```

**For Failed Tasks:**
```
Options:
1. Resume, re-driving the failed node
2. Cancel
```

No workflow offers a phase restart or fresh attempts. Every one runs on the workflow engine,
which resumes by recomputing which nodes are ready from frozen state: there is no mid-graph entry
point and no attempt counter, and it declines `--from=PHASE` and `--reset-attempts` by name. When
an operator asks for either, say so plainly; re-entry is planned for the engine.

5. **Route using Skill tool:**

```
Use Skill tool:
  skill: "[orchestrator-name]"
  args: "[task_path] [flags]"
```

Examples:
- Resume development: `skill: "development"` with `args: ".maister/tasks/development/2025-10-23-fix"`
- Resume product-design: `skill: "product-design"` with `args: ".maister/tasks/product-design/2025-10-26-onboarding"`

Pass only the flags the workflow's resume signature lists — see **Resume Skill Reference** below.

### Step 3: Classify & Route New Task

**For new task descriptions:**

0. **List the project's own workflows.** Invoke `run` with the Skill tool and
   `args: "--list"`; it prints the workflows the project defines — each one's name, title and
   summary — and starts nothing. Keep the entries not marked as a chain (chains are started from
   maister cockpit) and not marked broken. When none remain, classify among the five types as
   usual.

1. **Invoke task-classifier subagent** to determine workflow type:

```
Use Task tool:
  subagent_type: "maister-copilot:task-classifier"
  description: "Classify task type"
  prompt: "Classify this task into a workflow type: [task description].
           [When step 0 kept any:] The project's own workflows, candidates beside
           the five types: [one line each — name, title, summary].
           Return structured YAML classification result."

The subagent will:
- Detect issue identifiers (GitHub, Jira)
- Fetch issue details if available
- Analyze codebase context
- Match keywords and calculate confidence
- Confirm with user if needed
- Return classification in YAML format
```

2. **Parse classification result:**
```yaml
classification:
  task_type: [development|performance|migration|research|product-design|workflow]
  workflow_name: [a listed project workflow, when task_type is workflow]
  confidence: [percentage]
  reasoning: [explanation]
```

3. **Route to appropriate workflow using Skill tool:**

```
Display:
  Task classified as: [task_type] ([confidence]% confidence)
  Routing to [task_type] workflow...

Use Skill tool:
  skill: "[orchestrator-name]"
  args: "[description]"
```

**When the classification is a project workflow**, offer it rather than route silently — the
operator may not expect their description to match a workflow their team wrote. Ask with
ask_user: run that workflow (recommended, naming its title), choose a built-in workflow
instead (then the manual selection below), or cancel. On the first answer, invoke `run`
with the Skill tool and `args: "<workflow_name> \"<description>\""`.

**Routing examples:**
- development (92%): `skill: "development"` with `args: "Fix login timeout error"`
- development (88%): `skill: "development"` with `args: "Add filtering to user table"`
- performance (95%): `skill: "performance"` with `args: "Optimize slow dashboard queries"`

---

## Error Handling

### Classification Fails

If task-classifier returns error:
```
Display:
"Unable to automatically classify this task. Please select manually:"

Use ask_user with options:
1. Development - Fix bugs, improve features, or add new capabilities
2. Performance - Optimize speed/efficiency
3. Migration - Move to new tech/pattern
4. Research - Investigate and document findings
5. Product Design - Design features or products before building them

When Step 3 kept any project workflows, offer them too, by name and title. When the choices
outnumber what one question holds, ask first whether to use a built-in workflow or one of the
project's own, then which.

Then route to selected workflow using Skill tool — a project workflow through `run`.
```

### User Cancels

```
Display:
"Task cancelled. You can:
- Run /work again when ready
- Use specific workflow commands directly:
  /maister-copilot:development, /maister-copilot:performance, etc.
- Run one of your own workflows by name: /maister-copilot:run <name>"
```

---

## Resume Skill Reference

| Workflow Type | Skill | Args |
|---------------|-------|------|
| development | `development` | `[path]` |
| performance | `performance` | `[path]` |
| migration | `migration` | `[path]` |
| research | `research` | `[path]` |
| product-design | `product-design` | `[path]` |
| any other workflow, started by name | `run` | `[path]` |

Every workflow runs on the workflow engine, which resumes by recomputing the ready set from
frozen state. Mid-graph entry and attempt counters have no expression there, so `--from=PHASE` and
`--reset-attempts` are declined by name rather than silently ignored, and a task directory started
on the 2.x plugin is refused with a message that says where to finish it.

---

## Integration Notes

### With Task Classifier

The `/work` command delegates classification to the task-classifier subagent via Task tool, which:
- Fetches issue details from GitHub/Jira/Azure DevOps (via MCP, CLI tools, or WebFetch)
- Analyzes codebase context for better classification
- Uses confidence-based user confirmation
- Returns structured classification result

### With Orchestrators

After classification/detection, this command routes to the appropriate orchestrator via Skill tool:
- Each orchestrator handles its specific workflow (spec, plan, implement, verify, etc.)
- State is persisted in `orchestrator-state.yml` for pause/resume
- Auto-recovery handles common failures

### With Project Documentation

Uses project documentation for context:
- `.maister/docs/INDEX.md` - Project overview and standards
- `.maister/tasks/` - Existing task directories

---

## Key Behaviors

1. **Single entry point** - One command for all workflow types
2. **Auto-classification** - Intelligent routing based on task description
3. **Resume support** - Detects and resumes existing tasks
4. **Issue integration** - Fetches details from GitHub/Jira/Azure DevOps
5. **Direct skill invocation** - Uses Skill tool for immediate orchestrator loading
6. **Graceful fallback** - Manual selection if classification fails
