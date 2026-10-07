---
name: maister:quick-bugfix
description: Quick bug fix with TDD red/green gates and complexity escalation
argument-hint: "[bug description]"
---

# Quick Bug Fix

Lightweight TDD-driven bug fix workflow with planning mode. Analyze the bug, present a fix plan for approval, then reproduce with a failing test, fix, and verify. No orchestrator state, no task directory, no subagents.

For complex bugs that grow beyond a quick fix, offers to switch to a full development run, which it starts with the analysis so far.

## Usage

```bash
/maister:quick-bugfix "Login form submits twice on slow connections"
/maister:quick-bugfix "API returns 500 when email contains special characters"
/maister:quick-bugfix "Dark mode toggle doesn't persist after refresh"
```

## When to Use

**Use `/maister:quick-bugfix` when:**
- Bug is reasonably scoped and reproducible
- You have a clear description of expected vs actual behavior
- Fix likely touches a small number of files

**Use `/maister:development` instead when:**
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

Discover the project's standards as part of analysis and planning (Steps 3–4), relevant to the bug area — not as a bulk upfront read.

- Read `.maister/docs/INDEX.md` to find which standards exist.
- **Then read the specific standard files it points to that match the bug area** (e.g. API bug → api + error-handling standards; form bug → validation + frontend standards; query bug → database + backend standards). Reading INDEX.md alone is NOT sufficient — this is mandatory.
- Apply the matched standards in the fix plan (Step 4) and during implementation (Step 6).

If `.maister/docs/INDEX.md` does not exist, note it and suggest `/maister:init` in the completion summary.

### Step 3: Analyze & Assess Complexity

Investigate until you have a root-cause hypothesis backed by file/line evidence, the affected files, and the existing tests that cover them.

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

Use AskUserQuestion — "This bug looks bigger than a quick fix: \<the signals, in a few words\>. How should it go on?":
  1. "Switch to a full development run (Recommended): \<the strongest signal\>" — invoke `maister:development` with the Skill tool now, its argument the bug description followed by the analysis so far (root-cause hypothesis, affected files, covering tests), so the run starts from it; this quick fix ends here
  2. "Continue with the quick fix" — proceed, accepting the complexity

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
If no standards exist: "No Maister standards found. Consider running `/maister:init`."]

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
- Use AskUserQuestion — "The reproduction test passes: \<the conditions it tested\> already behave as expected. What now?":
  - "The bug's description is accurate: look for other conditions" — investigate further and write a new reproduction
  - up to three generated conditions the bug might need, from the analysis ("Only with an empty cart", "Only after a session timeout"), each rerunning the test under it
  - the user's own condition is the Other answer

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
- Stop and report the findings, then ask as the escalation check does: "Switch to a full development run (Recommended): three fixes did not pass" starts `maister:development` with the findings; "Stop here" leaves the change as it is

### Step 7: Summary

**Provide completion summary:**

- **Root cause**: What caused the bug
- **Fix**: What was changed and why
- **Files modified**: List of changed files
- **Standards applied**: Which standards from INDEX.md were followed
- **Tests**: Which tests were run and their results (including the TDD red→green transition)
- **Commit suggestion**: Propose a commit message

**Post-implementation standards check (mandatory):** after the test is green, go through the `## Standards Compliance Checklist` from the plan file and verify each item — mark pass/fail and report it in the summary. Address any failure before marking the task complete.

---

## Graceful Fallback

**If `.maister/docs/` does not exist:**

Proceed with the bug fix normally, then note:

```
"No Maister standards found. Consider running `/maister:init` to initialize
project documentation and coding standards for better consistency."
```
