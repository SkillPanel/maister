---
name: maister:standards-update
description: Update or create project standards, or record project knowledge (a decision, a fact about the system) in a project document, from conversation context, an explicit description, or the standard candidates a finished workflow run handed over, or bring the plugin's changed built-in standards to a project set up on an earlier version
argument-hint: "[standard, convention or project fact] [--from=PATH] [--built-in] [--refresh-index]"
---

# Update Project Standards

Update or create standards in `.maister/docs/standards/` based on conversation context, a provided description or the candidates a finished workflow run left in its task directory — or, when the knowledge is a decision or a fact about the system rather than a way of writing code, record it in a project document under `.maister/docs/project/`. What makes a good candidate and where one belongs is described once, in docs-manager's standard candidates reference, `<plugin root>/skills/docs-manager/references/standard-candidates.md`, the plugin root two levels above this skill's base directory; read it before Phase 1, and the project's own wording in its `CLAUDE.md` block or at the top of INDEX.md over it. Automatically detects the best-matching category and file. Works with every folder under `standards/`, the ones init copied and the project's own alike, with sub-folders as groups within them; it also splits a file that has outgrown its size guidance and refreshes the documentation index.

Every write goes through the `docs-operator` subagent, which preloads docs-manager. Each call that changes documents names the docs index check for it: `check` is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, the plugin root being two levels above this skill's base directory, written as an absolute path.

## Usage

```bash
/maister:standards-update                                    # Detect from conversation (a run's close included), else offer the latest run's candidates
/maister:standards-update "always use React.memo for lists"  # From description
/maister:standards-update --from=/path/to/other-project      # Sync from another project
/maister:standards-update "split standards/backend/storage.md" # Split a file past its size guidance
/maister:standards-update --built-in                         # Review the built-in rules changed since setup
/maister:standards-update --refresh-index                    # Bring INDEX.md back in shape
```

---

## Mode: Refresh the Index (`--refresh-index`)

For a project whose INDEX.md has grown long, been hand-edited or been merged badly — one command, run once, by the operator or for them.

1. Invoke `docs-operator` via Task tool (subagent_type: `maister:docs-operator`, model and effort from `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude`, run just before — `../workflow-engine/references/verbs.md` § *Model and effort on every agent call*, for every `docs-operator` call here):
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

Invoke `docs-operator` subagent via Task tool (subagent_type: `maister:docs-operator`, model and effort from `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude`, run just before):
> "Refresh INDEX.md. Changed: [the added and updated standards paths]. Check: [check path]. Verify CLAUDE.md integration."

Wait for docs-operator to complete, then immediately proceed to SYNC STEP 5.

### SYNC STEP 5: Summarize

Display: standards added, standards updated, standards skipped, and total count. Suggest reviewing the imported standards and committing.

---

## Mode: Built-in Standards (`--built-in`)

For a project set up on an earlier plugin version: bring its built-in rules up to date with the ones the plugin ships now — each rule the plugin has since rewritten, merged, moved, removed or added. The map of what became of each rule is data the resolver reads; this mode never restates it. It bypasses Phases 1-3 and uses the flow below. It runs from `/maister:init`'s update path, which hands over the groups it resolved, or typed alone.

Prerequisites are those of § Prerequisites. Every `docs-operator` call here takes the model and effort from `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude`, run just before. Phase 1 Step 4 is not asked: the map fixes each rule's place.

### BUILT-IN STEP 1: Run the verb

From the project root, run `node <plugin root>/skills/docs-manager/scripts/standards.mjs built-in candidates`, the plugin root two levels above this skill's base directory, written as an absolute path.

- Pass the `--add-groups="…"`, `--signals="…"` and `--monorepo` the invocation carries. Init's hand-off carries them; typed alone, the mode passes none. List values go in double quotes; a path holding a space goes in single quotes.
- **A refusal** (exit 1): correct the input its error names and run once more.
- **An internal failure** (exit 2): ask "The built-in standards could not be compared: \<cause\>. What now?" with "Retry (Recommended)" / "Stop", and write nothing.
- **No candidates**: say the built-in standards are current, with the held count, give the summary of Step 6 and ask nothing.

The report's `candidates` are in the order the questions use. A candidate's `group`, `action`, `recommended`, `covers`, `sections`, `home` and `reason` are what the steps below read.

### BUILT-IN STEP 2: The bulk question

Asked when any candidate is `recommended`. Write the full list first, then ask once, keeping the question compact.

**The list file.** With the file tool, write `built-in-standards-changes.md` in the directory `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs scratch-dir --for=built-in-standards` makes and prints, run from the project root as a command of its own: a fresh directory under `.maister/scratch/`, which git ignores, so the file is read back with no permission prompt. It holds one line per recommended candidate, under a heading per `group`: the groups in the group table's order, each group's lines in report order. A line gives the action, the heading or headings the candidate removes, and the new rule's heading with its file. For example:
- "Replace Environment Variables with No Secrets in the Repository (global/conventions.md)"
- "Move Avoid N+1 to data/queries.md (new file; backend/queries.md removed once empty)"
- "Add Output Streams (cli/output.md, new file)"

The file is never under `.maister/docs/`, is never read by any later run, and is never cleaned up by the mode.

**The question.** One line per `group`, in table order, counting that group's recommended candidates by action: replaced, merged, moved, removed and added. A candidate counts once, so a merge covering four rules is one merged. A move names the folder it moves to, or the file when it stays in its own folder, with one count per destination. The counts of every line sum to the N of "Apply all N". For example: "backend: 1 replaced, 4 merged, 10 moved to data/, 9 removed, 2 added".

The question names the list file by its absolute path, then states three things:
- how many rules are already current (`counts.held`), and how many of the project's own rules are left alone (`counts.team`);
- how many candidates are asked next, one at a time and never recommended: the rules the team edited, and rules folded into a section the team edited (`counts.edited`);
- that nothing is recorded.

Options: "Apply all N (Recommended)" / "Go through them" / "More details". "More details" writes the list file's lines out in the session, then asks the question again without "More details".

### BUILT-IN STEP 3: Going through them

On "Go through them", each recommended candidate is its own question, four to a page, each page one AskUserQuestion call. A question holds the candidate's line and its `reason`. Options: "Apply it (Recommended)" / "Skip it".
<!-- plain-picker
A page is one form of up to four properties, each `"type": "string"` — the question tool refuses a property without its type — and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label, "(Recommended)" on the recommended one), with `default` the recommended option's id.
-->

### BUILT-IN STEP 4: Apply the chosen ones

With "Apply all N", every recommended candidate is chosen; after "Go through them", the ones chosen. Make one `docs-operator` call for the whole set, carrying each chosen candidate in report order. It names the Update Documentation operation, and `[check path]` is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, written as an absolute path:

> "Update Documentation, built-in standard edits, in `.maister/docs/standards/`. Apply each edit below in order as section edits; leave every section an edit does not name as it is. Edit `<id>` (`<action>`): remove these sections, only while each still reads as the text given; when any of them does not, apply nothing of this edit and name that section — `<path>` "`<heading>`": `<text>`; …. [When it writes:] Write this section to `standards/<home.path>`: `<home.text>`, unless after this edit's removals the file already holds a `###` section with this heading (an earlier edit in this call wrote it): then write nothing, and the removals still apply. When the file is missing, create it with the title line `<home.file_title>`. Put the section in place of the first removed section in that file when there is one; else, when the list of headings is empty, directly after the file's `#`/`##` title lines; else after the first of these headings the file holds: `<home.preceding>`; else, when it holds none of them, at the end. [When `home` is null or held:] Write nothing. Delete a file left with nothing but its headings. Then refresh INDEX.md with every path changed, created or deleted as changed. Check: [check path]. Return each edit as applied or not applied, with the reason."

A candidate writes its home when `home` is not null and `home.held` is false; otherwise it only removes. When nothing was chosen, no call is made.

Compose the edits yourself, from the report you already hold: in the call's own text, or, when the set is long, with the file tool as `built-in-standard-edits.md` beside the list file, which the call then names to read. Never build them with a shell heredoc or an inline interpreter (`python3 -c`, `node -e`, a `<<` here-document): the host flags such a command as one it cannot read, and an unattended run blocks on it.

### BUILT-IN STEP 5: The verb again, then the edited candidates

After the apply, or straight away when nothing was recommended or chosen, run the verb again with the same flags, handling a refusal and an exit 2 as in Step 1. Its `recommended: false` candidates are asked one at a time, four to a page, in report order, each never recommended:
- **An `edited:` candidate.** The question names the rule and its file and shows three texts in full: "Your text: …", "Shipped: …", and either "New rule (`<home.path>`): …" or "The plugin no longer ships this rule". When `home.held` is true it adds "A rule headed \<heading\> is already in \<path\>", with ", with the new text" only when `home.current` is true. Options: "Keep ours"; "Take the new rule" when the candidate writes its home (`home` is not null and `home.held` is false) or `home.current` is true, and "Remove it" when `home` is null, or when `home.held` is true and `home.current` is false (the home then holds the team's own section under that heading, and the edit only removes the rule); and "More details". "More details" prints the line-by-line difference between the team's text and the shipped text, then the candidate's `reason`, and asks the question again without "More details".
- **An unrecommended `update:` candidate**, asked in its place in report order. Its sections are unedited, so the question names each rule it covers and its file, shows the shipped text once, and gives its `reason`, which names the team's section keeping the heading. Options: "Keep ours" / "Remove it" / "More details". "More details" prints the team's section at `home.path` and the new rule's text, then asks again without "More details".
- **A recommended candidate that comes back** on this run is not asked again: it is named in the summary as kept when it was skipped, and as not applied when it was chosen.
<!-- plain-picker
A page is one form of up to four properties, each `"type": "string"` — the question tool refuses a property without its type — and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label), none marked "(Recommended)", with no `default`.
-->

"Take the new rule" and "Remove it" answers are applied together in one `docs-operator` call worded as in Step 4, each chosen candidate in report order. "Keep ours" writes nothing. The mode makes at most two `docs-operator` calls, each ending with the INDEX.md refresh and the check, and when nothing was applied nothing is written and no refresh runs.

### BUILT-IN STEP 6: Summarize

- Applied: one line per candidate, with the files created and deleted.
- Kept: each edited or folded candidate kept and each recommended one skipped, which are offered again next time; and each recommended one not applied, with the reason `docs-operator` gave.
- Already current: the held count, and the project's own rules left alone.
- Groups added, when any add was applied.
- For each id in `groups.not_recommended_held`, one line: "\<title\> is held although the profile no longer calls for it; its rules were updated like the others".
- When `groups.adding_from` is `"profile"`, one line: "A group only the code shows — such as `cli` for a command entry point — is not offered when this mode runs alone; `/maister:init`'s update path offers it".
- The refresh's changes, the check's result, and any failure `docs-operator` reported.
- "Nothing is recorded: a rule kept is offered again next time."

The mode never runs `candidates.mjs` and writes no file of its own, apart from the list file of Step 2, which nothing reads back.

---

## Mode: Conversation / Description (default)

When no mode flag (`--from`, `--built-in`, `--refresh-index`) is provided, the skill uses the standard detect-and-update flow below.

---

## PHASE 1: Detect Standard

**Step 1: Gather input**
- **If the argument or the conversation asks to split a file**: go to § Splitting a Standards File instead.
- **How far back to scan**: about the last 50 messages, or back to the most recent workflow run's close when that is further. A run's close comes at the end of a long stretch of work and is where it hands its standard candidates over, so reaching it matters more than a fixed count; the count is guidance, not a limit.
- **If argument provided**: Use the description as primary input. Also scan the conversation for additional context, examples, or related conventions.
- **If no argument**: Scan the conversation for convention discussions. Look for patterns like "we should always...", "our convention is...", "prefer X over Y", "never use...", code examples showing patterns.
- **A workflow run's close in the scan** — a close that lists the run's standard candidates and names its task directory: those are that run's candidates, not conventions of the conversation. Take them through § Candidates from a Workflow Run with that task directory, so the ones already applied are dropped and each one written is recorded. Conventions the scan finds elsewhere in the conversation are offered beside them in the same flow, through Step 2 onward — not instead of them, and a convention that repeats a run's candidate is offered once, as the candidate.
- **If no argument and the conversation holds none** — a fresh session, typically right after a workflow run named this command under **Next**: go to § Candidates from a Workflow Run, which looks up the latest run.

**Step 2: Discover existing categories and files**

Scan `.maister/docs/standards/*/` to find all existing categories and standard files, and `.maister/docs/project/` for the project's own documents (a decision log, a glossary, an architecture note — any name). This determines what's available — not limited to baseline categories.

**Step 3: Match to category and file**

Based on the topic detected, suggest the best-matching existing category and file. Consider:
- File names and their content (read existing files if topic is close)
- Whether the convention fits an existing file or needs a new one
- Whether it is a way of writing code (a standards file) or a decision or fact about the system (a project document)
- **A suggested destination** — a run's candidate's, or `(suggested: <destination>)` in the description — is the best match unless the file no longer exists

**Step 4: Confirm the target** — one AskUserQuestion, the convention in a few words in the question. This step is always asked: a suggested destination makes the recommended answer, never the answer. Several conventions handed over together — a run's chosen standard candidates — are confirmed together, a question each and up to four to a page, before any is written. When the best-matching file is already past its size guidance (about 12 KB or 15 `###` rules), the recommended answer is a new file beside it, named from the convention, the question saying the matched file is full; adding to that file stays an option.

- "Add it to the \<Category\> standards (\<file name\>)?" — "Yes (Recommended)" for the best match, up to two other candidate files by name with what each covers, and "New file" (its name and category the follow-up answer, or a new category). With no clear best match, the likeliest candidate is still offered first and recommended, the question saying why it is uncertain.
- For a project document the question names it instead — "Add it to the project's \<document\> (project/\<file name\>)?" — with the same options; a standards file stays among the alternatives, and a project document among a standard's when the knowledge reads as a decision or a fact.
- **If nothing detected** (no argument, no conversation context, no run's candidates) → ask the user to describe the convention, free text, with an example in the question

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
3. A rule the plugin ships changed since setup reaches the project through `/maister:standards-update --built-in`, never by copying the bundled docs here.

---

## PHASE 4: Apply via docs-manager

> Each standard uses a `###` heading with 1-10 lines description (excluding code snippets). Multiple standards per topic file. A rule holds no inventory of call sites, no dates and no ticket references. A file past about 12 KB or 15 rules is split into topic files or a sub-folder (§ Splitting a Standards File).
>
> Wording, for a standard or a project document alike: the rule first, then the reason, then its scope; no exact counts, line numbers or identifiers that will go stale (*How one is written* in the standard candidates reference). A rule extending an existing one is merged into it, not added beside it.

**Invoke `docs-operator` subagent** via Task tool (subagent_type: `maister:docs-operator`, model and effort from `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude`, run just before) with context:

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

## Candidates from a Workflow Run

A workflow run writes no standard. Its finalization leaves the consolidated candidates in its task directory (*The run's candidates file* in the standard candidates reference), lists them in its close with that task directory, and names this command once; this is where they are applied — in the session the run closed in, or in a fresh one.

1. **Find them.** From a run's close in the conversation, run `node <plugin root>/skills/standards-update/scripts/candidates.mjs show --run=<task dir>` with the task directory the close names; in a fresh session, `node <plugin root>/skills/standards-update/scripts/candidates.mjs latest`. Either runs from the project root, the plugin root as above, and prints the run (`run` — for `latest`, the most recent run whose candidates are not all applied yet), its candidates less the ones already applied, the ones it found already held, the other runs that still hold some (`others`) and any file it could not read (`problems`). From a close whose candidates are all applied, say so and go on with the conversation's other conventions alone. With `run` null, a close's candidates are taken from the close as conventions of the conversation, the problem named; from `latest`, go back to *If nothing detected* in Phase 1.
2. **Offer them** — one multi-select AskUserQuestion. The question names the run by its type and name, says how many candidates it offers, and, when `others` is not empty, that other runs hold candidates too (how many runs, named). Each candidate is an option: its `label` as the label; its destination, then its evidence, as the description. Each `recommended` candidate is marked recommended, its description opening with its `reason`; the candidates are separate choices, so more than one may be. When none is, the question says no candidate has support beyond one place yet. More than four candidates go in pages of four in the same call, each question counting its own out of the whole. The already-held ones are not offered; name them in the question with the rule that holds each. An unchosen candidate stays in the run's file and is offered again next time.
3. **Apply the chosen ones**, one after another, through Phase 1 Step 3 onward: the candidate line as the description and its `destination` as the suggested destination (for `extend`, the rule it extends) — the destination is asked in Step 4, never taken as given. Once a candidate has been written (Phase 4 succeeded), record it: `node <plugin root>/skills/standards-update/scripts/candidates.mjs applied --run=<run dir> --id=<id>`, so it is not offered again. A candidate whose write failed is not recorded.
4. **Summarize** as Phase 5 does, for all of them together, and say which candidates are left in that run and in the others.

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
