# Initialization Pattern

All orchestrators follow this initialization sequence before executing any workflow phases.

## Initialization Steps

### Step 1: Parse Command Arguments

Extract from invocation:
- **Task description**: What the user wants to do
- **Execution mode**: `--yolo` flag or default interactive
- **Task type**: From `--type` flag or auto-detect
- **Entry point**: `--from=phase` for mid-workflow start
- **Optional flags**: `--e2e`, `--user-docs`, `--code-review`, etc.
- **Task path**: If resuming existing task

### Step 2: Determine Starting Phase

**If resuming (task path provided)**:
1. Read `orchestrator-state.yml` if exists
2. Validate artifacts for completed phases (see `state-management.md`)
3. Determine first incomplete phase
4. Validate prerequisites for that phase

**If new task**:
1. Start from Phase 0 (default) or specified `--from` phase
2. If starting mid-workflow, validate required files exist

### Step 3: Create Task Directory Structure

For new tasks, create directory structure:

```
.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/
├── analysis/           # Analysis and planning artifacts
├── implementation/     # Specs, plans, work logs
├── verification/       # Test reports, verification results
└── documentation/      # User-facing docs (if applicable)
```

**Task Type Directories**:
- Bug fixes: `.ai-sdlc/tasks/bug-fixes/`
- Enhancements: `.ai-sdlc/tasks/enhancements/`
- New features: `.ai-sdlc/tasks/new-features/`
- Performance: `.ai-sdlc/tasks/performance/`
- Security: `.ai-sdlc/tasks/security/`
- Migrations: `.ai-sdlc/tasks/migrations/`
- Refactoring: `.ai-sdlc/tasks/refactoring/`
- Research: `.ai-sdlc/tasks/research/`
- Documentation: `.ai-sdlc/tasks/documentation/`

### Step 4: Create State Files

**Create `orchestrator-state.yml`** (see `state-management.md` for schema):

```yaml
orchestrator:
  mode: [interactive | yolo]
  started_phase: phase-0
  current_phase: phase-0
  completed_phases: []
  failed_phases: []
  auto_fix_attempts:
    # One entry per phase, all 0
  options:
    # All null initially
  created: [current ISO 8601 timestamp]
  updated: [current ISO 8601 timestamp]
  task_path: [full path]

  # Domain-specific context (all null initially)
```

**Create `metadata.yml`**:

```yaml
task:
  title: [task name from description]
  description: [full task description]
  type: [task type]
  status: in_progress
  created: [current ISO 8601 timestamp]
  updated: [current ISO 8601 timestamp]
```

### Step 5: Create TodoWrite with All Phases

**CRITICAL: Use TodoWrite tool immediately** to create todos for all phases:

```
Use TodoWrite tool with todos:
[
  {"content": "[Phase 0 name]", "status": "pending", "activeForm": "[Phase 0 active form]"},
  {"content": "[Phase 1 name]", "status": "pending", "activeForm": "[Phase 1 active form]"},
  ...
]
```

**Rules**:
- Create ALL phase todos at workflow start (all pending)
- Mark current phase `in_progress` before execution
- Mark phase `completed` immediately after success
- State file remains source of truth for resume logic
- TodoWrite provides real-time UX visibility

### Step 6: Output Initialization Summary

Output this summary to the user:

```
🚀 [Orchestrator Name] Started

[Task Type]: [description]
Mode: [Interactive/YOLO]
Starting Phase: [phase name]
Directory: [task-path]

Workflow Phases:
0.  [ ] [Phase 0 name] → [skill/agent]
1.  [ ] [Phase 1 name] → [skill/agent]
2.  [ ] [Phase 2 name] → [skill/agent]
...
N.  [ ] [Phase N name] → [skill/agent]

State file: [task-path]/orchestrator-state.yml

[Interactive mode] You'll be prompted for review after each phase.
[YOLO mode] All phases will run continuously.

Starting Phase 0: [Phase Name]...
```

---

## TodoWrite Phase Table Template

Each orchestrator defines its phases. Example format:

| Phase | content | activeForm |
|-------|---------|------------|
| 0 | "Analyze codebase" | "Analyzing codebase" |
| 1 | "Identify gaps" | "Identifying gaps" |
| 2 | "Create specification" | "Creating specification" |
| 3 | "Plan implementation" | "Planning implementation" |
| 4 | "Execute implementation" | "Executing implementation" |
| 5 | "Verify implementation" | "Verifying implementation" |

**Note**: Content uses imperative form ("Analyze"), activeForm uses present continuous ("Analyzing").

---

## Handling Prerequisites Missing

If starting mid-workflow and prerequisites are missing:

```
❌ Cannot start from [phase] - missing prerequisites!

Required files:
- [file1]: ❌ Missing
- [file2]: ✅ Found

Options:
1. Start from beginning (Phase 0)
2. Provide/create missing files manually
3. Specify different entry point with --from
```

Then prompt user:

```
Use AskUserQuestion tool:
  Question: "Cannot start from [phase] - prerequisites missing. What would you like to do?"
  Header: "Prerequisites"
  Options:
  1. "Start from Phase 0" - Begin workflow from the beginning
  2. "Specify different phase" - Choose another entry point
  3. "Exit" - Cancel and resolve manually
```

---

## Task Name Generation

Generate task directory name from description:

1. Extract 3-5 key words from description
2. Convert to lowercase kebab-case
3. Prepend current date in YYYY-MM-DD format

**Examples**:
- "Fix login timeout bug" → `2025-12-17-fix-login-timeout`
- "Add user authentication" → `2025-12-17-user-authentication`
- "Optimize database queries" → `2025-12-17-optimize-database-queries`

---

## Common Initialization Mistakes

### ❌ Skipping TodoWrite Creation

Always create TodoWrite at startup. This provides immediate progress visibility to the user.

### ❌ Not Creating State File

State file is required for resume capability. Create it even if you expect to complete in one session.

### ❌ Incorrect Directory Structure

Use the correct task type directory. Don't put bug fixes in `new-features/`.

### ❌ Starting Execution Before Summary

Always output the initialization summary before starting Phase 0. User should see the full workflow plan.
