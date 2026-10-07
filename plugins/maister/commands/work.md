---
name: maister:work
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
| No argument | Asks what to work on |

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
| development | `maister:development` |
| performance | `maister:performance` |
| migration | `maister:migration` |
| research | `maister:research` |
| product-design | `maister:product-design` |
| workflow (one the project defines) | `maister:run` |

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
- Ask once, free text, with the examples in the question itself: "What would you like to work on? A task (\"Fix the login timeout on mobile\"), an issue (\"#456\", \"PROJ-123\") or a task folder to resume."
- Then check if input is task folder or description

### Step 2: Resume Existing Task

**When existing task detected:**

1. Read `orchestrator-state.yml` from task folder.

   **A run started by name** carries a `workflow:` block whose `workflow.name` is none of the five
   types in the table below. Its folder is that name, which no row maps, so do not look it up:
   invoke `maister:run` with the Skill tool and the task path as `args`. That skill reads the name,
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

3. Read the run's status from the state: `task.status` (in progress, completed, stopped or
   failed) and, for a failed or stopped run, the step it ended on — the first node in
   `workflow.nodes` not completed or skipped, named by its title — and the cause its summary
   records.

4. **Ask only when there is a real choice.** The status and the cause go in the question itself,
   never in a message above it:

| Status | What happens |
|---|---|
| In progress | Resume without asking — the user named the run to continue it |
| Failed | "\<Step\> failed: \<cause\>. Resume?" — "Resume and retry \<step\> (Recommended)" / "Leave it" |
| Completed | "\<Title\> is finished. What next?" — "Start a follow-up development task (Recommended)" / "Show what this run produced" |
| Stopped | As completed, the question saying where it stopped: "\<Title\> was stopped at \<step\>; a stopped run does not resume. What next?" |

   A follow-up starts `maister:development` with a description that names the finished run; "Show
   what this run produced" lists the run's artifacts and dashboard and ends. "Leave it" ends with
   one line saying how to resume later (`/maister:work <task folder>`).

No workflow offers a phase restart or fresh attempts. Every one runs on the workflow engine,
which resumes by recomputing which nodes are ready from frozen state: there is no mid-graph entry
point and no attempt counter, and it declines `--from=PHASE` and `--reset-attempts` by name. When
an operator asks for either, say so plainly; re-entry is planned for the engine.

5. **Route using Skill tool:**

```
Use Skill tool:
  skill: "maister:[orchestrator-name]"
  args: "[task_path] [flags]"
```

Examples:
- Resume development: `skill: "maister:development"` with `args: ".maister/tasks/development/2025-10-23-fix"`
- Resume product-design: `skill: "maister:product-design"` with `args: ".maister/tasks/product-design/2025-10-26-onboarding"`

Pass only the flags the workflow's resume signature lists — see **Resume Skill Reference** below.

### Step 3: Classify & Route New Task

**For new task descriptions:**

0. **List the project's own workflows.** Invoke `maister:run` with the Skill tool and
   `args: "--list"`; it prints the workflows the project defines — each one's name, title and
   summary — and starts nothing. Keep the entries not marked as a chain (chains are started from
   maister cockpit) and not marked broken. When none remain, classify among the five types as
   usual.

1. **Invoke task-classifier subagent** to rank the workflow types:

```
Use Task tool:
  subagent_type: "maister:task-classifier"
  description: "Classify task type"
  prompt: "Classify this task into a workflow type: [task description].
           [When step 0 kept any:] The project's own workflows, candidates beside
           the five types: [one line each — name, title, summary].
           Return structured YAML classification result."
```

   The agent asks nothing. It fetches any issue the description names, and returns `type`,
   `confidence`, a one-line `reason`, up to three ranked `alternatives` each with its reason, and
   `compound` or `needs_description` when they apply.

2. **Route once, asking at most once:**

   - **High confidence (80% or more), a built-in type**: route without asking, with one line:
     "Starting \<Workflow\>: \<reason\>" — "Starting Development: it fixes a bug in the login
     timeout."
   - **A project workflow** (`type: workflow`): ask once, whatever the confidence — the user may
     not expect a team workflow to match. "Use your team's '\<title\>' workflow? It matches
     '\<matched words\>'." — "Run '\<title\>' (Recommended): written for this kind of task" / "Pick
     a built-in workflow" (then the question below, without project workflows).
   - **Otherwise** (lower confidence, a compound description): one question. The classifier's
     `type` first as "(Recommended)" with its reason as the description, then up to three
     `alternatives`, each with its reason; any type left out is named in the question ("…or say
     Migration or Product Design"), so every route stays one answer away. A compound description
     asks which part to start with, the first recommended, and names splitting in the question.
   - **`needs_description`**: ask the no-argument question of Step 1.

3. **Start the workflow** with the Skill tool — `maister:<type>` with the description as `args`,
   or `maister:run` with `args: "<workflow_name> \"<description>\""` for a project workflow.

---

## Error Handling

### Classification Fails

When the classifier returns an error, ask once: "Which workflow fits this task? (The task could
not be classified automatically.)" — Development (Recommended), Performance, Research and
Migration as options with a one-line description each, Product Design and any project workflows
named in the question. Route the answer as Step 3 does.

### User Cancels

```
Display:
"Task cancelled. You can:
- Run /work again when ready
- Use specific workflow commands directly:
  /maister:development, /maister:performance, etc.
- Run one of your own workflows by name: /maister:run <name>"
```

---

## Resume Skill Reference

| Workflow Type | Skill | Args |
|---------------|-------|------|
| development | `maister:development` | `[path]` |
| performance | `maister:performance` | `[path]` |
| migration | `maister:migration` | `[path]` |
| research | `maister:research` | `[path]` |
| product-design | `maister:product-design` | `[path]` |
| any other workflow, started by name | `maister:run` | `[path]` |

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
- Asks the user nothing — this command owns the one question, when there is one
- Returns a ranked classification with a reason for each candidate

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
6. **One question at most** - High confidence routes with one line; otherwise one ask with the best guess recommended
