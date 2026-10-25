---
name: maister:standards-update
description: Update or create project standards from conversation context or explicit description
argument-hint: "[description of standard/convention] [--from=PATH] [--refresh-index]"
---

# Update Project Standards

Update or create standards in `.maister/docs/standards/` based on conversation context or a provided description — or, when the knowledge is a decision or a fact about the system rather than a way of writing code, record it in a project document under `.maister/docs/project/`. What makes a good candidate and where one belongs is described once, in docs-manager's standard candidates reference, `<plugin root>/skills/docs-manager/references/standard-candidates.md`, the plugin root two levels above this skill's base directory; read it before Phase 1, and the project's own wording in its `CLAUDE.md` block or at the top of INDEX.md over it. Automatically detects the best-matching category and file. Supports both baseline categories (global, frontend, backend, testing) and custom user-defined categories, sub-folders as groups within them, splitting a file that has outgrown its size guidance, and refreshing the documentation index.

Every write goes through the `docs-operator` subagent, which preloads docs-manager. Each call that changes documents names the docs index check for it: `check` is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, the plugin root being two levels above this skill's base directory, written as an absolute path.

## Usage

```bash
/maister:standards-update                                    # Detect from conversation
/maister:standards-update "always use React.memo for lists"  # From description
/maister:standards-update --from=/path/to/other-project      # Sync from another project
/maister:standards-update "split standards/backend/storage.md" # Split a file past its size guidance
/maister:standards-update --refresh-index                    # Bring INDEX.md back in shape
```

---

## Mode: Refresh the Index (`--refresh-index`)

For a project whose INDEX.md has grown long, been hand-edited or been merged badly — one command, run once, by the operator or for them.

1. Invoke `docs-operator` via Task tool (subagent_type: `maister:docs-operator`, model and effort from `dispatch-model --agent=maister:docs-operator` — `../orchestrator-framework/references/orchestrator-patterns.md` § 1, *Model and Effort on Every Agent Call*, for every `docs-operator` call here):
   > "Refresh INDEX.md with reshape. Check: [check path]. Rewrite every entry the check warns on and every structural failure, keep the entries that already follow the rules, bring the layout to the template, and return the check's result."
2. Show what changed — entries rewritten, added and removed — and the check's result: no failures, and any warnings left. A `standards-file-over-guide` warning names a file to split: offer `/maister:standards-update "split <path>"` for each, and never split one here.

No document other than INDEX.md is touched in this mode.

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
4. Ask once with AskUserQuestion, the counts and the files named in the question by what they cover ("3 new: API errors, React components, test naming; 2 changed: validation, CSS"):
   - "All new and changed (Recommended)"
   - "New only" — leaves the local versions of the changed files as they are
   - "Choose individually" — then a multi-select of the files, each labeled by what it covers with its category in the description, none marked recommended

### SYNC STEP 3: Apply Selected Standards

For each selected standard:
- **Missing locally**: Copy the file from source. Create category directory if needed.
- **Differs**: AskUserQuestion per file — up to four files to a page — the diff summary in the question ("Validation standards: the source adds 2 rules (email format, max lengths) and words 1 differently"):
  - "Merge new sections (Recommended): keeps your edits" — append the source's `###` sections that don't exist locally
  - "Replace with the source version" — overwrites the local file
  - "Skip" — leave the local file unchanged

### SYNC STEP 4: Refresh INDEX.md

Invoke `docs-operator` subagent via Task tool (subagent_type: `maister:docs-operator`, model and effort from `dispatch-model --agent=maister:docs-operator`):
> "Refresh INDEX.md. Changed: [the added and updated standards paths]. Check: [check path]. Verify CLAUDE.md integration."

Wait for docs-operator to complete, then immediately proceed to SYNC STEP 5.

### SYNC STEP 5: Summarize

Display: standards added, standards updated, standards skipped, and total count. Suggest reviewing the imported standards and committing.

---

## Mode: Conversation / Description (default)

When `--from` is NOT provided, the skill uses the standard detect-and-update flow below.

---

## PHASE 1: Detect Standard

**Step 1: Gather input**
- **If the argument or the conversation asks to split a file**: go to § Splitting a Standards File instead.
- **If argument provided**: Use the description as primary input. Also scan last 15-20 messages for additional context, examples, or related conventions.
- **If no argument**: Scan last 15-20 messages for convention discussions. Look for patterns like "we should always...", "our convention is...", "prefer X over Y", "never use...", code examples showing patterns.

**Step 2: Discover existing categories and files**

Scan `.maister/docs/standards/*/` to find all existing categories and standard files, and `.maister/docs/project/` for the project's own documents (a decision log, a glossary, an architecture note — any name). This determines what's available — not limited to baseline categories.

**Step 3: Match to category and file**

Based on the topic detected, suggest the best-matching existing category and file. Consider:
- File names and their content (read existing files if topic is close)
- Whether the convention fits an existing file or needs a new one
- Whether it is a way of writing code (a standards file) or a decision or fact about the system (a project document)
- **A suggested destination in the description** — `(suggested: <destination>)`, as a workflow's finalization writes it — is the best match unless the file no longer exists

**Step 4: Confirm the target** — one AskUserQuestion, the convention in a few words in the question. This step is always asked: a suggested destination makes the recommended answer, never the answer. Several conventions handed over together — a workflow's chosen standard candidates — are confirmed together, a question each and up to four to a page, before any is written. When the best-matching file is already past its size guidance (about 12 KB or 15 `###` rules), the recommended answer is a new file beside it, named from the convention, the question saying the matched file is full; adding to that file stays an option.

- "Add it to the \<Category\> standards (\<file name\>)?" — "Yes (Recommended)" for the best match, up to two other candidate files by name with what each covers, and "New file" (its name and category the follow-up answer, or a new category). With no clear best match, the likeliest candidate is still offered first and recommended, the question saying why it is uncertain.
- For a project document the question names it instead — "Add it to the project's \<document\> (project/\<file name\>)?" — with the same options; a standards file stays among the alternatives, and a project document among a standard's when the knowledge reads as a decision or a fact.
- **If nothing detected** (no argument, no conversation context) → ask the user to describe the convention, free text, with an example in the question

---

## PHASE 2: Determine Action

Check if the target file exists:
- **Exists** → update mode
- **Doesn't exist** → create mode (if new category, create the directory too)

A project document follows the same two modes; it is written in the document's own form — any Markdown, no `###`-per-rule shape and no frontmatter required.

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

> Each standard uses a `###` heading with 1-10 lines description (excluding code snippets). Multiple standards per topic file. A rule holds no inventory of call sites, no dates and no ticket references. A file past about 12 KB or 15 rules is split into topic files or a sub-folder (§ Splitting a Standards File).
>
> Wording, for a standard or a project document alike: the rule first, then the reason, then its scope; no exact counts, line numbers or identifiers that will go stale (*How one is written* in the standard candidates reference). A rule extending an existing one is merged into it, not added beside it.

**Invoke `docs-operator` subagent** via Task tool (subagent_type: `maister:docs-operator`, model and effort from `dispatch-model --agent=maister:docs-operator`) with context:

For **updates**:
> "Update documentation file: standards/[category]/[name].md. Current content: [content]. Add/change: [new conventions]. Integrate new practices, maintain markdown formatting, organize logically, preserve existing unless conflicts. Then refresh INDEX.md with this path as changed. Check: [check path]. Report the file's size and rule count against its guidance."

For a **project document**, the same calls with its `project/[name].md` path — the Update or Add Documentation File operation — adding the knowledge where it reads naturally in the document.

For **creates**:
> "Create documentation file: standards/[category]/[name].md. Category: [category]. Content: [conventions]. Create with proper markdown, organized sections, code examples. Then refresh INDEX.md with this path as changed. Check: [check path]. Verify CLAUDE.md integration."

Wait for docs-operator to complete, then immediately proceed to Phase 5.

---

## PHASE 5: Summarize

Display a summary: what was updated/created, practices added, and next steps (review, commit, share with team). If docs-operator reported a failure, say so. When the file is past its size guidance, say so and suggest `/maister:standards-update "split <path>"` — a warning, never a refusal.

---

## Splitting a Standards File

For a file past its size guidance, on request — the argument, the conversation, or an offer this skill made.

1. Read the file and group its `###` rules by topic into two to four new files, each named for its topic: in the same folder, or in a sub-folder named for the file when its topics belong together (`standards/backend/storage.md` → `standards/backend/storage/layout.md`, `standards/backend/storage/locking.md`).
2. **One AskUserQuestion**: the proposed split in the question — each new file with the rules it takes, a line each — offering "Split it this way (Recommended)" and "Keep it in one file". An answer through Other that renames or regroups is applied as typed.
3. Invoke `docs-operator`: "Move these rules, unchanged, into [new files]; delete [old file] once every rule has moved. Then refresh INDEX.md with the old and new paths as changed. Check: [check path]." Rules move word for word; a split edits no rule.
4. Summarize the new files, and name any reference to the old path elsewhere in the project for the user to update.

---

## Prerequisites

If `.maister/docs/` doesn't exist, ask once — "Set up Maister first? (runs the setup, then this)": "Set it up (Recommended)" runs `maister:init` with the Skill tool, then continues here; any other answer stops. This is the one rule for every mode.

docs-operator asks nothing: a choice it returns under `decisions_needed` is asked here, in the same form, and the operation is called again with the answer.
