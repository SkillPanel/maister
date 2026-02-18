---
name: maister:work
description: Unified entry point - auto-classifies tasks and routes to appropriate workflow
---

**NOTE**: This is a multi-step workflow that invokes the task-classifier skill and orchestrator skills at specific steps. The `<command-name>` tag refers to THIS command only — you MUST still use the Skill tool to invoke those other skills when instructed below. Follow ALL steps in order.

# Unified Work Entry Point

Auto-classifies tasks and routes to the appropriate workflow orchestrator. Supports resuming existing tasks or starting new ones.

## Usage

```bash
/work [task description | task folder path | issue identifier]
```

### Input Types

| Input Type | Example |
|------------|---------|
| Task folder path | `.maister/tasks/bug-fixes/2025-10-23-login-timeout` |
| Folder name only | `2025-10-26-user-auth` (searches all task types) |
| Task description | `"Fix login timeout error on mobile"` |
| GitHub issue | `#456`, `GH-456`, `https://github.com/owner/repo/issues/456` |
| Jira ticket | `PROJ-456`, `https://company.atlassian.net/browse/PROJ-456` |
| No argument | Prompts for input |

## Examples

```bash
# Resume existing task
/work ".maister/tasks/bug-fixes/2025-10-23-login-timeout"
/work "2025-10-26-user-auth"

# New task (auto-classifies)
/work "Fix login timeout error on mobile devices"
/work "Add user authentication with email/password"
/work "Improve dashboard loading performance"

# From issue tracker
/work "#456"
/work "PROJ-123"
```

## How It Works

1. **Detect existing task** - If input is a task folder path, route to resume
2. **Classify new task** - Invoke task-classifier skill to determine type
3. **Route to workflow** - Use Skill tool to invoke appropriate orchestrator skill

## Task Type Routing

| Classification | Routes To (Skill) |
|----------------|-------------------|
| bug-fix | `maister:development-orchestrator` (task_type=bug) |
| new-feature | `maister:development-orchestrator` (task_type=feature) |
| enhancement | `maister:development-orchestrator` (task_type=enhancement) |
| performance | `maister:performance-orchestrator` |
| migration | `maister:migration-orchestrator` |
| research | `maister:research-orchestrator` |

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

1. Read `orchestrator-state.yml` from task folder
2. Determine task type from folder path:

| Folder | Task Type |
|--------|-----------|
| `bug-fixes/` | bug-fix |
| `new-features/` | new-feature |
| `enhancements/` | enhancement |

| `performance/` | performance |

| `migrations/` | migration |

| `research/` | research |


3. Extract status from state file:
   - `completed`: null = in-progress, timestamp = finished
   - `current_phase`: what phase is active
   - `failed_phases`: array of failed attempts

4. Present status to user with AskUserQuestion:

**For In-Progress Tasks:**
```
Options:
1. Resume from current phase ([current_phase])
2. Restart from specific phase
3. Cancel
```

**For Completed Tasks:**
```
Options:
1. View task details
2. Create enhancement to this feature
3. Re-run verification phase
4. Cancel
```

**For Failed Tasks:**
```
Options:
1. Resume with fresh attempts (--reset-attempts --clear-failures)
2. Retry failed phase
3. Restart from specific phase
4. Cancel
```

5. **Route using Skill tool:**

```
Use Skill tool:
  skill: "maister:[orchestrator-name]"
  args: "--resume [task_path] [flags]"
```

Examples:
- Resume bug-fix: `skill: "maister:development-orchestrator"` with `args: "--resume .maister/tasks/bug-fixes/2025-10-23-fix"`
- Restart feature: `skill: "maister:development-orchestrator"` with `args: "--resume .maister/tasks/new-features/2025-10-26-auth --from=verify"`
- Fresh attempts: `skill: "maister:migration-orchestrator"` with `args: "--resume .maister/tasks/migrations/2025-10-20-redux --reset-attempts"`

### Step 3: Classify & Route New Task

**For new task descriptions:**

1. **Invoke task-classifier skill** to determine task type:

```
Use Skill tool:
  skill: "maister:task-classifier"

The skill will:
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
  task_type: [bug-fix|enhancement|new-feature|performance|migration|research]
  confidence: [percentage]
  reasoning: [explanation]
```

3. **Route to appropriate workflow using Skill tool:**

```
Display:
  Task classified as: [task_type] ([confidence]% confidence)
  Routing to [task_type] workflow...

Use Skill tool:
  skill: "maister:[orchestrator-name]"
  args: "[description]"
```

**Routing examples:**
- bug-fix (92%): `skill: "maister:development-orchestrator"` with `args: "--type=bug Fix login timeout error"`
- enhancement (88%): `skill: "maister:development-orchestrator"` with `args: "--type=enhancement Add filtering to user table"`
- new-feature (85%): `skill: "maister:development-orchestrator"` with `args: "--type=feature Add user authentication"`
- performance (95%): `skill: "maister:performance-orchestrator"` with `args: "Optimize slow dashboard queries"`

---

## Error Handling

### Classification Fails

If task-classifier returns error:
```
Display:
"Unable to automatically classify this task. Please select manually:"

Use AskUserQuestion with options:
1. Bug Fix - Fix defects or errors
2. Enhancement - Improve existing features
3. New Feature - Add completely new capability
4. Performance - Optimize speed/efficiency
5. Migration - Move to new tech/pattern
6. Research - Investigate and document findings

Then route to selected workflow using Skill tool.
```

### User Cancels

```
Display:
"Task cancelled. You can:
- Run /work again when ready
- Use specific workflow commands directly:
  /maister:development-new, /maister:performance-new, etc."
```

---

## Resume Skill Reference

| Task Type | Skill | Args |
|-----------|-------|------|
| bug-fix | `maister:development-orchestrator` | `--resume [path] [--from=PHASE] [--reset-attempts]` |
| new-feature | `maister:development-orchestrator` | `--resume [path] [--from=PHASE]` |
| enhancement | `maister:development-orchestrator` | `--resume [path] [--from=PHASE]` |
| performance | `maister:performance-orchestrator` | `--resume [path] [--from=PHASE]` |
| migration | `maister:migration-orchestrator` | `--resume [path] [--from=PHASE]` |
| research | `maister:research-orchestrator` | `--resume [path] [--from=PHASE]` |

---

## Integration Notes

### With Task Classifier

The `/work` command delegates classification to the task-classifier skill, which:
- Fetches issue details from GitHub/Jira when available
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

1. **Single entry point** - One command for all task types
2. **Auto-classification** - Intelligent routing based on task description
3. **Resume support** - Detects and resumes existing tasks
4. **Issue integration** - Fetches details from GitHub/Jira
5. **Direct skill invocation** - Uses Skill tool for immediate orchestrator loading
6. **Graceful fallback** - Manual selection if classification fails
