---
name: init
description: Initialize Maister framework with intelligent project analysis and documentation generation
argument-hint: "[--standards-from=PATH]"
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` on a fresh project — run `mkdir -p` on that folder first.

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

# Initialize Maister Framework

Initialize `.maister/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

**NOTE**: This skill invokes other skills and subagents at specific phases. Use the **Task tool with `docs-operator` subagent** (agent_type: `maister-copilot:docs-operator`) for all docs-manager operations, and **Task tool** for project-analyzer. Use the **Skill tool** only for standards-discover (Phase 8, last phase). The Task tool returns control to this skill after completion; the Skill tool does not.

## Phase Configuration

| Phase | Subject | activeForm |
|-------|---------|------------|
| 1 | Pre-flight checks | Running pre-flight checks |
| 2 | Analyze project codebase | Analyzing project codebase |
| 3 | Confirm findings & gather context | Gathering project context |
| 4 | Select standards to initialize | Selecting standards |
| 5 | Initialize documentation structure | Initializing documentation |
| 6 | Generate project documentation | Generating project documentation |
| 7 | Validate | Validating initialization |
| 8 | Discover coding standards | Discovering coding standards |

**Task Tracking**: Before Phase 1, use `TaskCreate` for all phases (pending), then set sequential dependencies with `TaskUpdate addBlockedBy`. At each phase: `TaskUpdate` to `in_progress` → execute → `TaskUpdate` to `completed`. If skipped, mark skipped phases as `completed` with `metadata: {skipped: true}`. On the update path, Phases 2–8 are skipped and its five steps are tracked the same way instead.

---

## PHASE 1: Pre-flight Checks

**If `--standards-from=PATH` is provided:**
1. Resolve the path (absolute or relative to current working directory)
2. Check if `PATH/.maister/docs/standards/` exists. If not, inform the user and stop — the specified project doesn't have maister standards initialized.
3. Store the resolved standards source path for use in Phases 4 and 5.

Check if `.maister/` directory already exists.

**If exists**, use ask_user — "Maister is already set up here. What now?":
- "Update the docs, keep my edits (Recommended)": follow the UPDATE PATH below — survey what is out of date, ask once, change only what is chosen; the standards and the team's own edits stay
- "Start over: the old docs move to `.maister.backup-<date>/`": move `.maister/` to `.maister.backup-$(date +%Y%m%d-%H%M%S)/` with the Bash tool, then continue with PHASE 2. The docs-operator is told the re-initialization is decided, so it does not ask again

Leaving without changes is the Other answer: stop.

---

## PHASE 2: Project Analysis

Invoke `project-analyzer` subagent via the Task tool, with the model and effort `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister-copilot:project-analyzer --host=copilot` prints just before (`../orchestrator-framework/references/orchestrator-patterns.md` § 1, *Model and Effort on Every Agent Call*; each `docs-operator` call below runs it the same way, with `--agent=maister-copilot:docs-operator`).

**The analyzer runs whatever the project's size.** The analysis is its work: never inspect the codebase in its place, and a small, simple or familiar project is no reason to. Phase 3's confirmation is built from its report, and the same holds for standards-discover's subagents in Phase 8.

Wait for completion. Store analysis results for use in Phases 3 and 6.

---

## PHASE 3: Confirm Findings & Gather Context

Every question here carries its own context — the findings go in the question, never in a message above it. Every question offers at least two real options — one option is nothing to choose, and Claude Code's question tool refuses it: a finding with nothing to choose is stated, never asked.

**Step 1 — Confirm the analysis.** One ask_user whose question lists what was detected, one line each: project type, language and framework, architecture, the main tech stack, anything the analyzer flagged as custom or low confidence, and the project profile fields (Phase 5 Step 3) the analysis could not settle, by what each asks ("Not found: where it deploys, who reaches it, who uses it"), so a correction can settle them. Options: "Looks right (Recommended)" and one to three generated corrections, drawn from what the analyzer was least sure of ("It's a monorepo, not a single app", "The backend is Fastify, not Express"). A free-text correction is the Other answer. Apply corrections before going on.

**Step 2 — Project context, one page.** One ask_user call with up to three questions:
- **Description**: drafted from the README and the analysis in one or two sentences, quoted in the question itself ("Describe the project as: '…'?"), with "Use this (Recommended)" and one generated alternative — a shorter wording, or one built on another reading of what the project is — its full text in the option's description; the user's own wording is the Other answer. When no real alternative exists, the description is not asked: Phase 7's summary states it, and the documents it lands in can be edited. The project name comes from the manifest or folder and is not asked.
- **Goals** (optional): one to three generated goals fitting a new, existing or legacy project, plus "Skip". The goal the analysis best supports comes first, marked "(Recommended)", the question saying in a few words what it rests on.
- **Team context** (optional): generated options ("Solo project", "Small team", "Several teams") plus "Skip". The option the repository's history supports — the number of distinct commit authors — is marked "(Recommended)", the question naming that count; with no history to read, "Skip" is. It says who builds the project, never who uses it, so it settles no profile field.

Each question's default is its recommended option. "Skip" is offered on an optional question, never its default, unless it is the option recommended: a user who confirms the page as it stands takes what the analysis supports.
The page is one form of up to three properties, each `"type": "string"` — the question tool refuses a property without its type — and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label, "(Recommended)" on the recommended one), never a bare `enum` of labels — with `default` the recommended option's id.

**Step 3 — Which project documents.** ask_user — "Which project documents should be written? The tech stack is always included.":
- "Vision, roadmap, tech stack and architecture (Recommended)" — recommended for a standard, frontend-only or backend-only project
- "Tech stack only" — recommended instead for a monorepo or umbrella
- "Choose individually" — then a multi-select of Vision, Roadmap and Architecture, none marked recommended

Store selections for Phase 6.

---

## PHASE 4: Select Standards to Initialize

**Determine available categories:**
- **If `--standards-from` was provided**: Scan `PATH/.maister/docs/standards/*/` to discover all available categories from the external project (may include custom categories beyond the baseline global/frontend/backend/testing).
- **Otherwise**: Use built-in baseline categories (global, frontend, backend, testing).

Calculate smart defaults based on analysis:
- **Global**: Always recommended (if available)
- **Frontend**: If frontend framework detected or projectArchitectureType includes frontend (if available)
- **Backend**: If backend framework detected or projectArchitectureType includes backend (if available)
- **Testing**: Always recommended (if available)

Also scan `.maister/docs/standards/*/` for any existing custom categories to include.

Ask once with ask_user, the defaults and their source in the question — "Start with these standards: \<categories\>? They come from \<the referenced project | Maister's built-in set\> and can be edited later.":
- "Use them (Recommended)" → proceed with the calculated defaults
- "Choose individually" → a multi-select of all discovered categories (a new category is the Other answer), none marked recommended

Custom categories: if user adds a new category, create the directory and include it in the selection.

Store selection for Phase 5.

---

## PHASE 5: Initialize Documentation Structure

**Invoke `docs-operator` subagent** via Task tool (agent_type: `maister-copilot:docs-operator`, model and effort from `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister-copilot:docs-operator --host=copilot`, run just before) with prompt — here and in Phase 7, `[check path]` is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, the plugin root two levels above this skill's base directory, written as an absolute path:

> "Initialize documentation structure. Standards selection: [array from Phase 4]. [If --standards-from was provided: Standards source path: [resolved path]/.maister/docs/standards/. Copy standards from this external path instead of built-in defaults.] Only copy selected standard categories. Do NOT copy project templates — only create the project/ directory. Project documentation will be generated in Phase 6 with real content from project analysis. Create placeholder sections in INDEX.md for skipped categories. Check: [check path]."

Wait for docs-operator to complete, then continue with Steps 2 and 3 and go on to Phase 6.

**Step 2 — Scaffold project config** (directly — not via docs-operator). `.maister/config.yml` is where a project toggles output and chooses its subagents' models. The blocks below are the normative definition of the keys, their types and their defaults in this edition — write them verbatim, apart from the one `Explore` line the size rule picks.

- **No `.maister/config.yml`**: create it (Write tool) with the output keys and then the `subagents` block.
- **A `config.yml` with no top-level `subagents:` key** (a line beginning `subagents:`; a commented one does not count): append the `subagents` block at the end of the file, after one blank line, and change no other line of it.
- **A `config.yml` that has a `subagents:` key**: leave the file as it is.

```yaml
# Maister project configuration.
# html_output — generate the operator dashboard (dashboard.html + dashboard-data.js,
# auto-opened in your browser) and the HTML companion reports (.html twins of spec,
# implementation plan, verification, and research/design outputs). Set to false for
# markdown-only runs. Markdown artifacts, their TL;DR summary blocks, and
# orchestrator-state.yml are produced regardless. Default: true.
html_output: true

# mockup_format — how UI mockups are rendered when a workflow generates them
# (development's ui-mockups node, product-design's visual-prototyping node, or /maister-copilot:mockup-studio).
#   html  (default): rendered HTML/CSS via the visual companion (browser preview, saved as .html).
#   ascii          : terminal ASCII mockups via the ascii-mockup-generator agent (no Node/browser needed).
# Auto-falls back to ascii when Node.js is unavailable. Default: html.
mockup_format: html
```

The `subagents` block holds maister's built-in values, written out so the team sees and edits what applies:

```yaml
# subagents — which model and effort maister's subagents run on, per host. These are
# maister's built-in values; an agent no entry names runs on your session's model.
# A run freezes this block when it starts, so an edit applies to the next run.
subagents:
  tiers:                       # the ladder; a task group's planner tier picks a rung
    light:    { claude: haiku,  copilot: claude-haiku-5.5, effort: high }
    standard: { claude: sonnet, copilot: claude-sonnet-5.5 }
    deep:     { claude: opus,   copilot: claude-opus-5.5, premium: true }  # Copilot bills it 15x
  agents:
    Explore: { tier: light }   # the codebase scouts maister starts
    project-analyzer: { tier: light }
    # the docs operator and the standards scans: your session's model on Claude Code, standard on Copilot
    docs-operator: { tier: { claude: inherit, copilot: standard } }
    standards-scanner: { tier: { claude: inherit, copilot: standard } }
    task-classifier: { tier: light }
    test-suite-runner: { tier: light }
    html-companion-writer: { tier: light }
    # the reviewers: deep on Claude Code, standard on Copilot, which bills its deep model 15x
    spec-conformance-review: { tier: { claude: deep, copilot: standard } }
    code-risk-review: { tier: { claude: deep, copilot: standard } }
    simplicity-review: { tier: { claude: deep, copilot: standard } }
    spec-auditor: { tier: { claude: deep, copilot: standard } }
    task-group-implementer:
      choose: by-plan-tier     # each task group on the cheapest model for its planner tier
      allowed: [light, standard, deep]
      unassessed: standard     # a group the plan gives no tier
      ceiling:                 # a failed group is retried once a rung up, never past this
        claude: deep
        copilot: standard      # Copilot bills its deep model 15x
      # budget: { deep: 3 }    # cap the groups a run sends to a rung: a fourth deep group asks first
  workflows:                   # the verification fix loops' fixes run on your session's model
    development: { nodes: { verification: { agents: { task-group-implementer: { model: inherit } } } } }
    performance: { nodes: { verification: { agents: { task-group-implementer: { model: inherit } } } } }
    migration: { nodes: { issue-resolution: { agents: { task-group-implementer: { model: inherit } } } } }
    # research:                # entries for one workflow only
    #   agents: { information-gatherer: { preset: scout } }
  # presets:                   # named model + effort pairs to pin an agent to
  #   scout: { claude: haiku, copilot: gpt-6-luna, effort: low }
  # default: { tier: standard }  # every agent no entry names, here or in maister's own table
# Copilot cells are model ids as /model lists them; Claude cells are haiku, sonnet, opus or fable;
# inherit, in a cell or as an entry's model, is your session's model.
# effort is low, medium, high, xhigh or max; inherit sends none. An entry's own effort beats its rung's.
```

**The size rule.** `LARGE_CODEBASE_FILES = 2000`. Count the project's files: in a git repository, the files `git ls-files` lists outside `.maister/`; outside one, every file under the project root, skipping `node_modules`, `vendor`, `dist`, `build` and every directory whose name starts with a dot. When the count is above `LARGE_CODEBASE_FILES`, write the `Explore` line as

```yaml
    Explore: { tier: standard, effort: high }  # over 2000 files: a codebase this size needs a stronger scout
```

with `LARGE_CODEBASE_FILES`'s value as the number in the comment. Otherwise write the block as it stands. The count and the choice go in Phase 7's summary.

**Step 3 — Write the project profile.** The `project:` key of `.maister/config.yml` says what the project is, so the reviewers check what applies to it — no health endpoint or rate limits for a CLI, no down-migrations without a data store. Fill its fields from Phase 2's analysis, with Phase 3's corrections applied (the update path fills in only the fields an existing block lacks, UPDATE PATH Step 3):

| Field | From |
|---|---|
| `kind` | the project type and entry points: `web-app`, `service`, `daemon`, `cli`, `library`, `plugin`, `desktop`, `mobile`, `data-pipeline` or `infra` |
| `runtime` | the main language and its version, as free text (`"node 20"`) |
| `deploy` | the infrastructure found: `none`, `local`, `container`, `kubernetes`, `serverless`, `package-registry` or `app-store` |
| `exposure` | who reaches its entry points: `local`, `internal` or `public` |
| `data` | the stores it writes (`[postgres, files]`); `[]` for none |
| `scale` | who uses it, from what the code shows — per-user accounts or sessions, tenant or organisation keys on its data — or the user's answer: `single-user`, `team` or `multi-tenant` |
| `ui` | `none`, `web`, `tui` or `native` |

Leave out any field the analysis or a correction does not settle; a guess is worse than a gap, because a field rules checks out. `deploy`, `exposure` and `scale` are settled only by something found — a deploy configuration, a container or infrastructure file, a bind address, a public route, accounts or tenant keys in the data model — or by the user's answer; finding nothing settles nothing, so `none`, `local` or `single-user` is never written for lack of evidence, and the team context, which says who builds the project, never settles `scale`. A field Step 1 named as not found stays out unless a correction settled it, as that question told the user. Send the fields as one JSON object to the workflow engine's `project-profile` verb, from the project root: `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs project-profile <<< '<json>'`. It writes the block only when `config.yml` has no top-level `project:` key — appended after one blank line, every other line unchanged — and leaves an existing key alone; a field left out, or one with a value it does not take, is written commented out with the values it takes, the latter with a `warning:` line. Its JSON reply says what it did (`action`: `created`, `appended` or `kept`) and the block it wrote; keep both for Phase 7's summary.

---

## PHASE 6: Generate Project Documentation

**IMPORTANT**: Only generate docs selected in Phase 3.

For each selected doc type, read the corresponding reference template:
- Vision selected → Read `references/vision-templates.md`, select template by project type (new/existing/legacy)
- Roadmap selected → Read `references/roadmap-templates.md`, select template by project type
- Tech Stack (always) → Read `references/tech-stack-template.md`
- Architecture selected → Read `references/architecture-template.md`

Fill templates using:
- Analysis report data (tech stack, age, structure)
- User-provided context from Phase 3 (goals, users, requirements)
- Auto-detected project characteristics

Write each file to `.maister/docs/project/`.

---

## PHASE 7: Validate

**Step 1**: Invoke `docs-operator` subagent via Task tool (agent_type: `maister-copilot:docs-operator`, model and effort from `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister-copilot:docs-operator --host=copilot`, run just before) with prompt:

> "Refresh INDEX.md with the project documentation written in Phase 6 as changed. Check: [check path]. Then verify .github/copilot-instructions.md is properly integrated with .maister/docs/ documentation."

Wait for docs-operator to complete, then immediately continue with Step 2.

**Step 2**: Display comprehensive summary. Include any failure docs-operator reported.
- Project analysis results (type, language, framework, architecture), and the project description as written when Phase 3 did not ask it
- Structure created (tree with check marks for created items)
- Documentation status (which docs generated, which standards initialized)
- Project config: whether `.maister/config.yml` was created, had the `subagents` block appended, or already held a `subagents` block and was left alone; the file count and the `Explore` tier it chose; and the `subagents` block written or appended, as written. Note that the block governs the agent calls maister makes; the explore agents a host's own plan mode starts are outside it
- Project profile: whether the `project:` block was written or appended, or an existing one was left alone; the block written, as written, with each field it left commented out and any `warning:` line, and a line asking the user to fill in those fields, since they decide which checks the reviewers apply; and that a run freezes the profile when it starts, so a correction reaches the next run
- Key findings (strengths, opportunities)
- Next steps:
  1. Review generated documentation
  2. Customize for your team
  3. Start development with `/maister-copilot:work`
  4. Keep the documents current; INDEX.md is refreshed for you, never edited by hand

---

## PHASE 8: Discover Coding Standards

Invoke the `standards-discover` skill via Skill tool with `--scope=full` to automatically discover coding standards from the project's config files, source code patterns, documentation, and external sources.

> "Run standards discovery with --scope=full. This is being invoked as part of project initialization."

The standards-discover skill handles its own user interaction (presenting findings by confidence tier, asking for approval, and asking which rule holds wherever a finding contradicts a starter standard Phase 5 copied). Let it run its full workflow — this is the last phase of init, so context handoff is fine here.

After completion, display a brief summary of how many standards were discovered and applied, and name every contradiction with a starter standard: the rule that now holds for each settled one, and both rules with their files for each one left unsettled.
---

## UPDATE PATH: Bring an Existing Setup Up to Date

For a project that already has `.maister/`. It brings the config, the project profile and the four project documents init writes — vision, roadmap, tech stack and architecture — up to date with the code and with what this version of init writes, without losing the team's edits. Three rules hold throughout:
- **Only additions are recommended**: a missing key, block, profile field or project document. An existing config value, profile field or document changes only through a choice made for that one line or file.
- **Standards are never touched.** A category the stack needs and `standards/` lacks is pointed at `/maister-copilot:standards-discover --scope=<category>`; nothing under `standards/` is copied or rewritten.
- **Other documents are only indexed.** Markdown the team added under `.maister/docs/` beyond the four is never rewritten, refreshed or called stale; Step 4 gives an unindexed one its entry. The index is never built from the documents' own metadata.

**Step 1 — Survey.** Read-only: nothing is written in this step.
1. **Analysis.** Invoke project-analyzer as Phase 2 does — its model and effort rule, and whatever the project's size.
2. **Config.** Compare `.maister/config.yml` with what Phase 5 Step 2 writes today: the output keys and the `subagents` block, its `Explore` line as the size rule picks it for the project now. Compare by key path and value; comments, spacing and order do not count, and a commented-out line is not a value. Each key the shipped blocks hold is one of three:
   - *missing* from the file — a top-level key, the `subagents` block, a block or an entry inside it (an agent the block now names, `workflows`): an addition, recommended;
   - *set to another value* — `docs-operator: { tier: light }` where the block now gives a tier per host, a `budget` line the block now ships commented out: offered, never recommended, because a value an earlier init wrote cannot be told apart from the team's choice;
   - *the same*: nothing to do.

   A key the file sets that the shipped blocks do not hold is the team's, and is left alone. Then run `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs validate --definition=<plugin root>/skills/workflow-engine/workflows/development.yml` from the project root and keep its `subagents-` and `project-profile:` warnings: one on a line the shipped block or the analysis gives a replacement for is offered like a differing value; any other is a finding.
3. **Profile.** Compare the `project:` block with the profile the analysis supports, by Phase 5 Step 3's table and its evidence rules. A field the block lacks, leaves empty or holds commented out, and the analysis settles, is an addition. A field the block sets and the analysis contradicts is offered, never recommended. A field the analysis cannot settle is a finding naming what it asks.
4. **Project documents.** Vision, roadmap, tech stack and architecture under `.maister/docs/project/`. A missing one is an addition, recommended — for a monorepo or umbrella only the tech stack, the others offered, as in Phase 3 Step 3. A present one is read against the analysis, and each statement the analysis contradicts — a framework replaced, a version moved, a component gone — is collected as the passage and its correction; a document with any is a refresh offer, never recommended. No other document is compared.
5. **Standards.** The categories Phase 4's defaults pick for this stack, against the folders under `.maister/docs/standards/`: each one missing is a finding, with its `/maister-copilot:standards-discover --scope=<category>` command.
6. **Index.** Run the check (Phase 5's `[check path]`) from the project root. Its failures — unindexed documents, dead or duplicate entries, conflict markers, no index — are findings Step 4 repairs.

**Step 2 — One decision.** One ask_user, carrying the whole survey in the question: every proposed change by area (config, profile, project documents), one line each, marked recommended or offered, each offer saying what it would change; then the findings with nothing to choose, stated, not asked — the index check's failures, the missing standards categories, the validate warnings with no replacement and the profile fields the analysis could not settle; then whatever the analyzer was unsure of that a proposal rests on; and that INDEX.md and the .github/copilot-instructions.md pointer are repaired whatever the answer. Options:
- "Apply the recommended changes (Recommended)": the additions, nothing else
- "Choose change by change": the pages below
- "Leave everything as it is": nothing from the survey is applied; Step 4 still runs

With offers but no addition, the first option would apply nothing, so it is left out and "Leave everything as it is" is the recommended one. A correction to the analysis is the Other answer: apply it, work out again the proposals it touches, and ask again. With nothing to add and nothing to offer, nothing is asked: go on to Step 4, and the summary says the setup is current.

**Choose change by change.** Area by area, at most four questions to a page, each page one ask_user call:
- an area's additions together, listed in the question: "Add them (Recommended)" / "Skip them";
- every offer on its own — one config line, one profile field, one document: "Keep it as it is (Recommended)" / "Take the change", the question naming the line or the file, its current text and the change; for a document, each contradicted passage and its correction.
A page is one form of up to four properties, each `"type": "string"` and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label, "(Recommended)" on the recommended one), with `default` the recommended option's id.

**Step 3 — Apply only what was chosen.**
- **Config.** With no `config.yml`, or no `subagents` key, write it or append the block as Phase 5 Step 2 does. Otherwise each chosen change is a line-level edit with the Edit tool, so every other byte of the file stays: an addition goes in after the nearest key before it in the shipped block that the file has, at its siblings' indentation, with the shipped line's comment — a missing output key before the `subagents` block and its comment lines; a chosen value replaces that entry's line or lines with the shipped ones. An entry the file does not hold as lines of its own — a block written on one line, or laid out differently — is not edited: the summary gives the change as text to paste.
- **Profile.** For the additions, send the profile the analysis supports, as Phase 5 Step 3 builds it, as one JSON object to `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs project-profile --fill <<< '<json>'`. It writes only the fields the block lacks, leaves empty or holds commented out, and leaves every field the block sets alone; with no `project:` key it appends the block as a first run does. Keep its reply (`action`, the block, any `warning:` line) for the summary. A chosen change to a set field is a line-level edit of that line.
- **Project documents.** A missing document is written as Phase 6 writes it, from its template and the analysis, the project's description taken from the README and the existing documents — Phase 3 is not asked. A chosen refresh changes only the passages its question showed; every other line stays as the team wrote it.
- Nothing is written under `standards/`.

**Step 4 — Refresh INDEX.md and the pointer.** Always, whatever Step 2's answer: invoke docs-operator as Phase 7 Step 1 does, with the documents Step 3 wrote as changed — none after "Leave everything as it is". The refresh gives an unindexed document its entry and drops dead ones, keeping every other entry; the integration check adds a missing .github/copilot-instructions.md pointer. Both add only what the documentation system needs.

**Step 5 — Summary.** Include any failure docs-operator reported.
- Changed: each config line added or replaced; the profile reply, its block as it now reads, with each field still commented out and a line asking the user to fill those in; each document written or refreshed
- Kept: each offer declined or not taken, and each change given as text to paste
- Remaining drift: the validate warnings with no replacement, and the profile fields the analysis could not settle
- INDEX.md: what the refresh changed, and the check's result
- Each missing standards category with its `/maister-copilot:standards-discover --scope=<category>` command
- That a run freezes the config and the profile when it starts, so a change reaches the next run

---

## Error Handling Principles

- If `.maister/docs/` creation fails: check permissions, suggest manual creation
- If project-analyzer or docs-operator fails: ask with the cause in the question — "\<What\> failed: \<cause\>. What now?" — "Retry (Recommended)" / "Continue with manual input". Two retries at most, then manual instructions
- docs-operator asks nothing: a choice it returns under `decisions_needed` is asked here, in the same form, and the operation is called again with the answer
- Never auto-rollback — always ask user before destructive actions
