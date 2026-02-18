---
name: standards-update
description: Update or create project standards from conversation context or explicit description
argument-hint: "[description of standard/convention]"
---

# Update Project Standards

Update or create standards in `.maister/docs/standards/` based on conversation context or a provided description. Automatically detects the best-matching category and file. Supports both baseline categories (global, frontend, backend, testing) and custom user-defined categories.

## Usage

```bash
/maister:standards-update                                    # Detect from conversation
/maister:standards-update "always use React.memo for lists"  # From description
```

---

## PHASE 1: Detect Standard

**Step 1: Gather input**
- **If argument provided**: Use the description as primary input. Also scan last 15-20 messages for additional context, examples, or related conventions.
- **If no argument**: Scan last 15-20 messages for convention discussions. Look for patterns like "we should always...", "our convention is...", "prefer X over Y", "never use...", code examples showing patterns.

**Step 2: Discover existing categories and files**

Scan `.maister/docs/standards/*/` to find all existing categories and standard files. This determines what's available — not limited to baseline categories.

**Step 3: Match to category and file**

Based on the topic detected, suggest the best-matching existing category and file. Consider:
- File names and their content (read existing files if topic is close)
- Whether the convention fits an existing file or needs a new one

**Step 4: Present suggestion**

- **If confident match** → AskUserQuestion: "This convention about [topic] fits [category/file]. Update it?" (Yes / Choose different / Cancel)
- **If ambiguous** → AskUserQuestion listing possible categories/files + "Create new category" + "Create new file in [category]"
- **If nothing detected** (no argument, no conversation context) → ask user to describe the convention they want to document

---

## PHASE 2: Determine Action

Check if the target file exists:
- **Exists** → update mode
- **Doesn't exist** → create mode (if new category, create the directory too)

No user prompt needed — just inform: "Updating existing standard: [name]" or "Creating new standard: [category/name]"

---

## PHASE 3: Gather Standard Content

### If updating

1. Read current content
2. Show summary of existing practices
3. Ask what to add/change
4. Extract: new practices, modifications, removals, code examples

### If creating

1. Inform user of target path
2. Ask for practices, conventions, code examples, do's/don'ts
3. Optionally show plugin baseline if similar standard exists in docs-manager's bundled docs

---

## PHASE 4: Apply via docs-manager

> Each standard uses a `###` heading with 1-10 lines description (excluding code snippets). Multiple standards per topic file. Split large topics into sub-topic files.

**Invoke docs-manager skill** via Skill tool with context:

For **updates**:
> "Update documentation file: standards/[category]/[name].md. Current content: [content]. Add/change: [new conventions]. Integrate new practices, maintain markdown formatting, organize logically, preserve existing unless conflicts. Update INDEX.md entry with practice-specific description (enumerate actual practices, not generic category)."

For **creates**:
> "Create documentation file: standards/[category]/[name].md. Category: [category]. Content: [conventions]. Create with proper markdown, organized sections, code examples. Add to INDEX.md with practice-specific description. Verify CLAUDE.md integration."

Wait for completion.

---

## PHASE 5: Validate & Summarize

1. Verify standard file exists and has content
2. Verify INDEX.md references the standard with practice-specific description (not generic)
3. Verify CLAUDE.md integration
4. Display summary: what was updated/created, practices added, next steps (review, commit, share with team)

---

## Prerequisites

If `.maister/docs/` doesn't exist, offer to run `/maister:init` first.
