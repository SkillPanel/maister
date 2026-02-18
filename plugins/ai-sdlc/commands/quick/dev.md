---
name: maister:quick-dev
description: Implement task directly with AI SDLC standards awareness (no planning mode)
---

# Quick Development with Standards Awareness

Implement a task directly without entering planning mode, while still applying project standards from `.maister/docs/`.

## Usage

```bash
/maister:quick-dev [task description]
```

## Examples

```bash
/maister:quick-dev "Add a logout button to the navbar"
/maister:quick-dev "Fix the typo in the error message"
/maister:quick-dev "Update the API endpoint to accept JSON"
```

---

## When to Use

**Use `/maister:quick-dev` when:**
- Task is clear and well-defined
- You know what needs to be done
- No architectural decisions needed
- Quick fixes, small features, or straightforward changes

**Use `/maister:quick-plan` instead when:**
- Task scope is uncertain
- Multiple implementation approaches possible
- Architectural decisions required
- You want user approval before coding

---

## Workflow

### Step 1: Parse Input

**Get the task description:**

- If provided as argument, use it directly
- If not provided, use AskUserQuestion to prompt:
  ```
  "What would you like to implement? Please describe the task."
  ```

### Step 2: Discover Standards

**Check if `.maister/docs/INDEX.md` exists:**

**If exists:**
1. Read INDEX.md to discover available documentation and standards
2. Identify which standards are relevant based on:
   - The categories and files listed in INDEX.md
   - The nature of the task
   - Keywords in the task description
3. **READ the applicable standard files** (see Standards Reading Enforcement below)

**If not exists:**
- Note that no standards are available
- Suggest running `/maister:init` in completion message

### Standards Reading Enforcement (MANDATORY)

**BLOCKING**: Reading INDEX.md alone is NOT sufficient. You MUST read actual standard files.

**Enforcement Process**:
1. Read INDEX.md to discover available standards
2. Identify which standards apply based on task description
3. **READ each applicable standard file** using Read tool (not just note it exists)
4. Apply standards during implementation
5. List applied standards in completion summary

**Examples of standard discovery**:
- Task mentions "upload" → Read file-handling standards
- Task mentions "form" → Read validation and accessibility standards
- Task mentions "API" → Read api and error-handling standards

### Step 3: Implement with Standards

**MANDATORY**: During implementation:

1. Explore the codebase to understand context (using Glob, Grep, Read)
2. **Apply discovered standards** - Reference the standard files you read
3. For each code change, verify it follows applicable standards
4. If you encounter new areas while coding (e.g., auth, database), read applicable standards before proceeding
5. Make the necessary code changes
6. Run relevant tests if applicable

### Step 4: Verify Standards Compliance

**After implementation, verify:**

1. Review changes against applicable standards
2. Confirm key guidelines were followed
3. Note any standards that were applied

### Step 5: Summary

**Provide completion summary:**

- What was implemented
- Which standards from INDEX.md were applied
- Any tests run and their results
- Suggestions for follow-up (if any)

---

## What This Does

1. **Parses** task description from user input
2. **Discovers** applicable standards from `.maister/docs/INDEX.md`
3. **READS** actual standard files (MANDATORY - not just INDEX.md)
4. **Implements** directly without planning mode approval
5. **Verifies** standards were followed
6. **Summarizes** what was done and which standards were read and applied

## Graceful Fallback

**If `.maister/docs/` does not exist:**

Proceed with implementation normally, then note:

```
"No AI SDLC standards found. Consider running `/maister:init` to initialize
project documentation and coding standards for better consistency."
```
