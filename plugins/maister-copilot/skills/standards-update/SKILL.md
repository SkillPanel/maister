---
name: standards-update
description: Update or create project standards from conversation context or explicit description
argument-hint: "[description of standard/convention] [--from=PATH]"
---

# Update Project Standards

Update or create standards in `.maister/docs/standards/` based on conversation context or a provided description. Automatically detects the best-matching category and file. Supports both baseline categories (global, frontend, backend, testing) and custom user-defined categories.

## Usage

```bash
/maister-copilot:standards-update                                    # Detect from conversation
/maister-copilot:standards-update "always use React.memo for lists"  # From description
/maister-copilot:standards-update --from=/path/to/other-project      # Sync from another project
```

---

## Mode: Sync from External Project (`--from=PATH`)

When `--from=PATH` is provided, the skill switches to **sync mode** — importing standards from another project's `.maister/docs/standards/` into the current project. This bypasses Phases 1-3 and uses a dedicated flow.

### SYNC STEP 1: Validate Source

1. Resolve the path (absolute or relative to cwd)
2. Check `PATH/.maister/docs/standards/` exists. If not, inform the user and stop.
3. Check `.maister/docs/standards/` exists in the current project. If not, follow § Prerequisites.

### SYNC STEP 2: Analyze Differences

1. Scan source project's `standards/*/` — list all categories and files
2. Scan current project's `standards/*/` — list all categories and files
3. For each source file, compare against the local counterpart:
   - **Missing locally**: Category or file doesn't exist in the current project
   - **Differs**: Both exist but content differs (read and compare)
   - **Identical**: No action needed
4. Ask once with ask_user, the counts and the files named in the question by what they cover ("3 new: API errors, React components, test naming; 2 changed: validation, CSS"):
   - "All new and changed (Recommended)"
   - "New only" — leaves the local versions of the changed files as they are
   - "Choose individually" — then a multi-select of the files, each labeled by what it covers with its category in the description, none marked recommended

### SYNC STEP 3: Apply Selected Standards

For each selected standard:
- **Missing locally**: Copy the file from source. Create category directory if needed.
- **Differs**: ask_user per file — up to four files to a page — the diff summary in the question ("Validation standards: the source adds 2 rules (email format, max lengths) and words 1 differently"):
  - "Merge new sections (Recommended): keeps your edits" — append the source's `###` sections that don't exist locally
  - "Replace with the source version" — overwrites the local file
  - "Skip" — leave the local file unchanged

### SYNC STEP 4: Update INDEX.md

Invoke `docs-operator` subagent via Task tool (subagent_type: `maister-copilot:docs-operator`):
> "Regenerate INDEX.md to include all newly added/updated standards. Verify .github/copilot-instructions.md integration."

Wait for docs-operator to complete, then immediately proceed to SYNC STEP 5.

### SYNC STEP 5: Summarize

Display: standards added, standards updated, standards skipped, and total count. Suggest reviewing the imported standards and committing.

---

## Mode: Conversation / Description (default)

When `--from` is NOT provided, the skill uses the standard detect-and-update flow below.

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

**Step 4: Confirm the target** — one ask_user, the convention in a few words in the question:

- "Add it to the \<Category\> standards (\<file name\>)?" — "Yes (Recommended)" for the best match, up to two other candidate files by name with what each covers, and "New file" (its name and category the follow-up answer, or a new category). With no clear best match, the likeliest candidate is still offered first and recommended, the question saying why it is uncertain.
- **If nothing detected** (no argument, no conversation context) → ask the user to describe the convention, free text, with an example in the question

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
2. Take what to add or change from the argument and the conversation. Ask only when they say nothing about it — free text, the file's current practices summarized in the question
3. Extract: new practices, modifications, removals, code examples

### If creating

1. Inform user of target path
2. Take the practices, examples and do's/don'ts from the argument and the conversation. Ask only for what they leave out — free text, what is already known stated in the question
3. Optionally show plugin baseline if similar standard exists in docs-manager's bundled docs

---

## PHASE 4: Apply via docs-manager

> Each standard uses a `###` heading with 1-10 lines description (excluding code snippets). Multiple standards per topic file. Split large topics into sub-topic files.

**Invoke `docs-operator` subagent** via Task tool (subagent_type: `maister-copilot:docs-operator`) with context:

For **updates**:
> "Update documentation file: standards/[category]/[name].md. Current content: [content]. Add/change: [new conventions]. Integrate new practices, maintain markdown formatting, organize logically, preserve existing unless conflicts. Update INDEX.md entry with practice-specific description (enumerate actual practices, not generic category)."

For **creates**:
> "Create documentation file: standards/[category]/[name].md. Category: [category]. Content: [conventions]. Create with proper markdown, organized sections, code examples. Add to INDEX.md with practice-specific description. Verify .github/copilot-instructions.md integration."

Wait for docs-operator to complete, then immediately proceed to Phase 5.

---

## PHASE 5: Summarize

Display a summary: what was updated/created, practices added, and next steps (review, commit, share with team). If docs-operator reported a failure, say so.

---

## Prerequisites

If `.maister/docs/` doesn't exist, ask once — "Set up Maister first? (runs the setup, then this)": "Set it up (Recommended)" runs `init` with the Skill tool, then continues here; any other answer stops. This is the one rule for both modes.

docs-operator asks nothing: a choice it returns under `decisions_needed` is asked here, in the same form, and the operation is called again with the answer.
