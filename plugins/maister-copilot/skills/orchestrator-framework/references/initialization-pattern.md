# Initialization Pattern

All orchestrators follow this initialization sequence before executing any workflow phases.

---

## Initialization Steps

1. **Parse Command Arguments**: Extract description, mode (`--yolo`), type, entry point (`--from`), optional flags
2. **Determine Starting Phase**: New task starts Phase 1; resume reads state and finds first incomplete phase
3. **Create Task Directory**: Standard structure with analysis/, implementation/, verification/, documentation/
4. **Create State File**: `orchestrator-state.yml` (see state-management.md for schema)
5. **Create Task Items**: Use `TaskCreate` for all phases as pending tasks for progress visibility, then set dependencies with `TaskUpdate addBlockedBy`
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
| Bug fixes | `.maister/tasks/bug-fixes/` |
| Enhancements | `.maister/tasks/enhancements/` |
| New features | `.maister/tasks/new-features/` |
| Performance | `.maister/tasks/performance/` |
| Security | `.maister/tasks/security/` |
| Migrations | `.maister/tasks/migrations/` |
| Refactoring | `.maister/tasks/refactoring/` |
| Research | `.maister/tasks/research/` |
| Documentation | `.maister/tasks/documentation/` |

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
| Wrong task type directory | Organization confusion (don't put bugs in new-features/) |
| Starting execution before summary | User doesn't see full workflow plan |
