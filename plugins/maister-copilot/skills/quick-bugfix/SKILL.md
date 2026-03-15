---
name: quick-bugfix
description: Quick bug fix with TDD red/green gates and complexity escalation
argument-hint: "[bug description]"
---

# Quick Bug Fix

Lightweight TDD-driven bug fix workflow with planning mode. Analyze the bug, present a fix plan for approval, then reproduce with a failing test, fix, and verify. No orchestrator state, no task directory, no subagents.

For complex bugs that grow beyond a quick fix, suggests escalating to the full development workflow (`/maister-development-new`).

## Usage

```bash
/maister-quick-bugfix "Login form submits twice on slow connections"
/maister-quick-bugfix "API returns 500 when email contains special characters"
/maister-quick-bugfix "Dark mode toggle doesn't persist after refresh"
```

## When to Use

**Use `/maister-quick-bugfix` when:**
- Bug is reasonably scoped and reproducible
- You have a clear description of expected vs actual behavior
- Fix likely touches a small number of files

**Use `/maister-development-new` instead when:**
- Bug requires architectural changes
- Multiple subsystems are involved
- You need formal specification and planning

---

## Workflow

### Step 1: Parse Input

**Get the bug description:**

- If provided as argument, use it directly
- If not provided, scan the recent conversation for bug context (error messages, reproduction steps, discussed symptoms). If found, use that as the bug description.
- Only if no argument AND no bug context in session, use AskUserQuestion:
  ```
  "Describe the bug — what's the expected behavior vs actual behavior?"
  ```

### Step 2: Discover Standards

**CRITICAL: This step MUST complete before entering plan mode.**

**Check if `.maister/docs/INDEX.md` exists:**

**If exists:**
1. Read INDEX.md to discover available documentation and standards
2. Identify which standards are relevant based on:
   - The categories and files listed in INDEX.md
   - The area of the bug (e.g., API, frontend, database)
   - Keywords in the bug description
3. **READ the applicable standard files** (see Standards Reading Enforcement below)

**If not exists:**
- Note that no standards are available
- Suggest running `/maister-init` in completion message

### Standards Reading Enforcement (MANDATORY)

**BLOCKING**: Reading INDEX.md alone is NOT sufficient. You MUST read actual standard files.

**Enforcement Process**:
1. Read INDEX.md to discover available standards
2. Identify which standards apply based on the bug area
3. **READ each applicable standard file** using Read tool (not just note it exists)
4. Apply standards during fix implementation
5. List applied standards in completion summary

**Examples of standard discovery**:
- Bug in API handler → Read API and error-handling standards
- Bug in form validation → Read validation and frontend standards
- Bug in database query → Read database and backend standards

### Step 3: Analyze & Assess Complexity

**Explore the codebase to understand the bug:**

1. Search for relevant files (Glob, Grep, Read)
2. Trace the code path where the bug occurs
3. Identify: likely root cause, affected files, existing tests
4. Form a root cause hypothesis

**Complexity Escalation Check:**

Assess whether this bug exceeds quick-fix scope. If **2 or more** of these signals are detected, suggest escalation:

| Signal | Example |
|--------|---------|
| Changes span 5+ files across multiple modules | Bug in shared utility affects API, frontend, and background jobs |
| Requires database schema or data model changes | Missing column, wrong relationship, migration needed |
| Multiple valid fix approaches with architectural trade-offs | Could fix at API layer, middleware layer, or client layer |
| Security-sensitive code | Auth, crypto, permissions, input sanitization |
| Root cause unclear after initial analysis | Symptoms don't point to a single location |

**If escalation triggered:**

Use AskUserQuestion:
- Question: "This bug appears more complex than a quick fix — [describe why]. How would you like to proceed?"
- Options:
  1. "Continue with quick fix" — proceed, accepting the complexity
  2. "Switch to full development workflow" — stop here and suggest running `/maister-development-new` with the bug description and analysis context

**If no escalation needed or user chooses to continue:** proceed to Step 4.

### Step 4: Enter Planning Mode

**Use the `EnterPlanMode` tool to present the fix plan for user approval.**

Standards context from Step 2 and analysis from Step 3 MUST inform the plan.

**Plan file content:**

```markdown
## Bug Analysis

**Root Cause**: [hypothesis with evidence — file paths, code references]
**Affected Files**: [list of files that need changes]

## Proposed Fix

[Description of the fix approach — what changes, why this approach]

## Test Strategy

[What the failing test will assert — setup conditions, expected behavior]

## Applicable Standards

[List each standard file read, with key guidelines extracted from each.
If no standards exist: "No AI SDLC standards found. Consider running `/maister-init`."]

## Standards Compliance Checklist

- [ ] [Guideline from standard file] (from `standards/[path]`)
- [ ] [Guideline from standard file] (from `standards/[path]`)
```

### ExitPlanMode Gate: Mandatory Sections

**BLOCKING: Do NOT call `ExitPlanMode` until the plan file contains:**

1. **"## Bug Analysis"** — root cause hypothesis with evidence
2. **"## Proposed Fix"** — what changes and why
3. **"## Test Strategy"** — what the TDD red test will assert
4. **"## Applicable Standards"** — standards read and key guidelines
5. **"## Standards Compliance Checklist"** — checkboxes for applicable guidelines

If any section is missing, add it before calling ExitPlanMode.

### Step 5: TDD Red Gate

**Write a failing test that reproduces the bug.**

1. Identify the appropriate test file (existing test suite or create new test file following project conventions)
2. Write a test that:
   - Sets up the conditions that trigger the bug
   - Asserts the **correct** (expected) behavior
   - Should FAIL with current code (proving the bug exists)
3. Run the test

**The test MUST fail.** This proves the bug is real and reproducible.

**If the test passes:**
- The bug may not be what we think, or it's already fixed
- Investigate further — re-read the bug description, check if conditions are correct
- Use AskUserQuestion: "The reproduction test passes — the expected behavior already works under these conditions. Is the bug description accurate, or are there additional conditions?"

### Step 6: Fix & Verify (TDD Green)

**Implement the fix:**

1. Apply the fix based on the approved plan from Step 4
2. **Apply discovered standards** from Step 2
3. Run the failing test — it MUST now pass
4. Run the full test file and related test files to check for regressions

**If tests fail after fix:**
- Analyze the failure
- Adjust the fix
- Re-run tests
- Maximum 3 fix-and-verify iterations

**If still failing after 3 attempts:**
- Stop and present findings to the user
- Suggest escalating to `/maister-development-new` for a more thorough approach

### Step 7: Summary

**Provide completion summary:**

- **Root cause**: What caused the bug
- **Fix**: What was changed and why
- **Files modified**: List of changed files
- **Standards applied**: Which standards from INDEX.md were followed
- **Tests**: Which tests were run and their results (including the TDD red→green transition)
- **Commit suggestion**: Propose a commit message

**Post-implementation: verify standards compliance using the checklist from the plan file.**

---

## What This Does

1. **Parses** bug description from user input
2. **Discovers** applicable standards from `.maister/docs/INDEX.md`
3. **Analyzes** codebase to find root cause and assess complexity
4. **Escalates** to full development workflow if bug is too complex
5. **Plans** the fix and presents for user approval via planning mode
6. **Reproduces** bug with a failing test (TDD Red)
7. **Fixes** the bug and verifies test passes (TDD Green)
8. **Summarizes** root cause, fix, standards applied, and test results

## Graceful Fallback

**If `.maister/docs/` does not exist:**

Proceed with the bug fix normally, then note:

```
"No AI SDLC standards found. Consider running `/maister-init` to initialize
project documentation and coding standards for better consistency."
```
