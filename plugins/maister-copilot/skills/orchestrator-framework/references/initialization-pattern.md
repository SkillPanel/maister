# Initialization Pattern

All orchestrators follow this initialization sequence before executing any workflow phases.

---

## Initialization Steps

1. **Parse Command Arguments**: Extract description, mode (`--yolo`), type, entry point (`--from`), optional flags
2. **Determine Starting Phase**: New task starts Phase 1; resume reads state and finds first incomplete phase (first phase not in `completed_phases`)
3. **Create Task Directory**: Standard structure with analysis/, implementation/, verification/, documentation/ *(skip on resume — already exists)*
4. **Create State File**: `orchestrator-state.yml` (see state-management.md for schema) *(skip on resume — already exists)*
5. **Create Task Items**: Use `TaskCreate` for all phases as pending tasks for progress visibility, then set dependencies with `TaskUpdate addBlockedBy`. On resume, also restore completed phase statuses (see "Task Restoration on Resume" below).
6. **Output Summary**: Show task info, mode, phases, and starting message

---

## Task Item Creation Pattern

For each phase in the Phase Configuration table, call `TaskCreate`:

| Phase Config Column | TaskCreate Parameter |
|---------------------|---------------------|
| `content` | `subject` |
| `activeForm` | `activeForm` |
| Phase `**Purpose**:` line | `description` |

After creating all phase tasks, set up dependencies using `TaskUpdate` with `addBlockedBy`:
- Each phase task is blocked by its prerequisite phase task(s)
- Conditional phases only get dependencies if they will execute
- Dependencies mirror the workflow sequence (e.g., Specification blockedBy Gap Analysis)

Store task IDs in `orchestrator-state.yml` under `orchestrator.task_ids`:

```yaml
orchestrator:
  task_ids:
    phase-1: "1"    # populated with TaskCreate IDs during init
    phase-2: "2"
    phase-3: "3"
    # ... one entry per phase
```

---

## Task Restoration on Resume

Task system IDs are ephemeral to a session. On resume, re-create all phase tasks to restore progress visibility:

1. **Create all phase tasks** — same `TaskCreate` loop as new task (all start as `pending`)
2. **Set dependencies** — same `TaskUpdate addBlockedBy` setup as new task
3. **Mark completed phases** — for each phase in `completed_phases`, `TaskUpdate` to `completed` with `metadata: {restored: true}`
4. **Update state** — write new task IDs to `orchestrator-state.yml` under `orchestrator.task_ids` (replaces stale IDs from previous session)

The result: the task list shows completed phases as done, pending phases as blocked or available, and the resumed phase ready to start — matching the actual workflow state.

---

## Task Directory Structure

```
.maister/tasks/[type]/YYYY-MM-DD-task-name/
├── analysis/           # Analysis and planning artifacts
├── implementation/     # Specs, plans, work logs
├── verification/       # Test reports, verification results
└── documentation/      # User-facing docs (if applicable)
```

**Task Type Directories**:

| Task Type | Directory |
|-----------|-----------|
| Development | `.maister/tasks/development/` |
| Performance | `.maister/tasks/performance/` |
| Migrations | `.maister/tasks/migrations/` |
| Research | `.maister/tasks/research/` |

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

## Initialization Summary Output

Output this summary before starting Phase 1:

```
🚀 [Orchestrator Name] Started

Task: [description]
Mode: [Interactive/YOLO]
Directory: [task-path]

Starting Phase 1: [Phase Name]...
```

---

## Handling Prerequisites Missing

If starting mid-workflow with missing prerequisites:

1. List required files with status (missing/found)
2. Use AskUserQuestion with options:
   - "Start from Phase 1"
   - "Specify different phase"
   - "Exit"

---

## Common Mistakes

| Mistake | Why It's Wrong |
|---------|----------------|
| Skipping TaskCreate | No progress visibility for user |
| Not creating state file | Resume capability breaks |
| Wrong workflow directory | Organization confusion (use correct workflow type directory) |
| Starting execution before summary | User doesn't see full workflow plan |
