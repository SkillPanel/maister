# Implementer Execution Guide

Consolidated reference for execution modes, change plans, standards discovery, and progress tracking.

---

## Execution Mode Selection

### Decision Criteria

| Steps | Mode | Strategy | Use When |
|-------|------|----------|----------|
| 1-3 | Direct | Execute yourself | Simple bug fixes, config changes, single-file updates |
| 4-8 | Plan-Execute | Delegate planning, apply changes | Standard features, moderate complexity |
| 9+ | Orchestrated | Group-by-group delegation | Complex features, multiple layers |

### Secondary Factors

**Consider higher mode if**: Multiple tech layers, external integrations, complex logic, many files
**Consider lower mode if**: Single file, clear patterns, minimal dependencies, time-sensitive

### Mode Switching

You can switch modes mid-implementation if complexity differs from expectations. Document the switch in work-log.md.

---

## Change Plan Format

When subagent creates a change plan, expect this structure:

```markdown
# Change Plan: [Task Name]

## Standards Applied
- [List from docs/INDEX.md]
- Note any discovered during planning

## Task Group N: [Name]

### Step N.1: [Description]
**File**: [path]
**Action**: Create new file / Modify existing
**Changes**: [Exact content or FIND/REPLACE]
**Standards**: [Which standards applied]

### Step N.n: Verify Tests
**Command**: [test command for this group only]
**Expected**: [N] tests passing

## File Manifest
- New: [files to create]
- Modified: [files to change]

## Notes for Main Agent
- Re-check standards before each change
- Document any adjustments in work-log.md
```

**Key points**:
- Subagent creates plan only (no file modifications)
- Main agent applies all changes
- Follow test-driven order (tests → implement → verify)

---

## Standards Discovery and Enforcement

### Two Sources of Standards (BOTH MANDATORY)

1. **Implementation Plan Standards**: Files listed in "Standards Compliance" section of implementation-plan.md
2. **Keyword-Triggered Standards**: Discovered during step execution via keyword matching

### Phase 1: Read Standards Compliance Section (BLOCKING)

1. Parse `implementation-plan.md` for "## Standards Compliance" section
2. Extract all file paths (e.g., `skills/development-orchestrator/SKILL.md`, `.maister/docs/standards/global/`)
3. **READ each file** using Read tool - do NOT skip
4. Initialize Standards Reading Log in work-log.md

### When to Check docs/INDEX.md

| Phase | Purpose |
|-------|---------|
| Initial (Phase 1) | Understand available standards |
| Before each task group | Identify specialty-area standards |
| Before each step | Check if keywords suggest new standards |
| Final (Phase 3) | Ensure nothing missed |

### Discovery Triggers (MANDATORY when matched)

| Keywords in Step | Read These Standards |
|-----------------|----------------------|
| file, upload, download | file-handling, storage, security |
| auth, login, permission | security, authentication |
| email, notification | email, external-services |
| payment, billing | security, secrets, payment |
| form, input | forms, validation, accessibility |
| API, endpoint | api, error-handling |
| migration, schema | database, migrations |

**ENFORCEMENT**: When keywords match, you MUST:
1. **Read** the corresponding standard file(s) using Read tool
2. **Add** to Standards Reading Log under "Discovered During Implementation"
3. **Apply** the standard to current step

### Standards Reading Log Format

```markdown
## Standards Reading Log

### From Implementation Plan (Phase 1)
- [x] skills/development-orchestrator/SKILL.md - Read at 2025-01-15 10:30
- [x] .maister/docs/standards/global/naming.md - Read at 2025-01-15 10:31

### Discovered During Implementation
- [x] .maister/docs/standards/backend/api.md - Step 2.3 (keyword: "endpoint")
- [x] .maister/docs/standards/global/security.md - Step 3.2 (keyword: "auth")
```

### Phase 3 Verification

Before completing, verify:
1. All files from Standards Compliance are marked `[x]`
2. All keyword-triggered discoveries are logged
3. Final work-log entry lists total standards read

---

## Progress Tracking

### Checkbox Format

```markdown
Before: - [ ] 2.3 Step description
After:  - [x] 2.3 Step description
```

Use lowercase `x` only. Mark group header (`X.0`) only after ALL steps complete.

### When to Mark

**Immediately** after completing each step:
1. Complete the work
2. Mark checkbox with Edit tool
3. Verify it's marked (read file)
4. Log in work-log.md
5. Then proceed to next step

Never batch updates. Never mark ahead.

### Why It Matters

- Enables workflow resumption after interruptions
- Verification phase validates all complete
- Creates audit trail
- Shows progress to team

### Validation

Phase 3 runs blocking validation. No unmarked `- [ ]` steps can remain. If validation fails, mark missing steps before proceeding.

---

## Test Step Verification

### Pre-Implementation Check (BLOCKING)

Before executing step N.2 or higher in any task group:

1. **Locate test step N.1** in the same task group
2. **Verify N.1 checkbox is `[x]`**
3. **If unchecked**: STOP and prompt user

### User Prompt for Test Skip

```
Use AskUserQuestion tool:
  Question: "Test step [N.1] has not been completed. How would you like to proceed?"
  Header: "Test Step"
  Options:
  1. "Complete test step first" - Execute N.1 now
  2. "Skip tests with justification" - Document reason and proceed
  3. "Stop implementation" - Pause for investigation
```

### Documenting Test Skips

If user approves skip, add to work-log.md:

```markdown
## Test Skip: 2.1

**Reason**: [User-provided justification]
**Approved by**: User at [timestamp]
**Impact**: [Note any risks]
```

Mark in implementation-plan.md:
```
- [~] 2.1 SKIPPED: [reason]
```

### Valid Skip Reasons

- Tests already exist for this functionality
- Third-party/generated code (not our responsibility)
- Configuration-only change (no logic to test)
- Hotfix with post-hoc test commitment

### Invalid Skip Reasons (Require Further Discussion)

- "Too complex to test" - Suggest breaking down
- "No time for tests" - Tests save time long-term
- "Tests will slow us down" - Technical debt concern

---

## Work Log Format

Keep `implementation/work-log.md` updated:

```markdown
## [YYYY-MM-DD HH:MM] - [Event]

**Action**: [What was done]
**Files**: [Modified files]
**Standards**: [Applied standards]
**Notes**: [Decisions, discoveries]
```

Update after:
- Each task group completion
- Standards discovery
- Test execution
- Final completion

---

## Quick Reference

### Common Paths

- Task: `.maister/tasks/[type]/[dated-name]/`
- Plan: `[task]/implementation/implementation-plan.md`
- Spec: `[task]/implementation/spec.md`
- Work log: `[task]/implementation/work-log.md`
- Standards: `.maister/docs/standards/`
- Index: `.maister/docs/INDEX.md`

### Test-Driven Pattern

1. Write 2-8 tests (step X.1)
2. Implement (steps X.2 to X.n-1)
3. Run only new tests (step X.n) - not entire suite

### Subagent Roles

- `implementation-changes-planner`: Creates markdown plans only
- Main agent (you): Applies all file changes with Edit/Write tools
