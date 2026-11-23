---
name: maister:init
description: Initialize Maister framework with intelligent project analysis and documentation generation
argument-hint: "[--standards-from=PATH]"
---

# Initialize Maister Framework

Initialize `.maister/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

**NOTE**: This skill invokes other skills and subagents at specific phases. Use the **Task tool with `docs-operator` subagent** (subagent_type: `maister:docs-operator`) for all docs-manager operations, and **Task tool** for project-analyzer. Use the **Skill tool** only for standards-discover (Phase 8, the last phase) and, on the update path, standards-update's built-in mode (its last step). The Task tool returns control to this skill after completion; the Skill tool does not.

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

**Task Tracking**: Before Phase 1, use `TaskCreate` for all phases (pending), then set sequential dependencies with `TaskUpdate addBlockedBy`. At each phase: `TaskUpdate` to `in_progress` → execute → `TaskUpdate` to `completed`. If skipped, mark skipped phases as `completed` with `metadata: {skipped: true}`. On the update path, Phases 2–8 are skipped and its six steps are tracked the same way instead.

---

## PHASE 1: Pre-flight Checks

**If `--standards-from=PATH` is provided:**
1. Resolve the path (absolute or relative to current working directory)
2. Check if `PATH/.maister/docs/standards/` exists. If not, inform the user and stop — the specified project doesn't have maister standards initialized.
3. Store the resolved standards source path for use in Phases 4 and 5.

Check if `.maister/` directory already exists.

**If exists**, use AskUserQuestion — "Maister is already set up here. What now?":
- "Update the docs, keep my edits (Recommended)": follow the UPDATE PATH below — survey what is out of date, ask once, change only what is chosen; the standards and the team's own edits stay
- "Start over: the old docs move to `.maister.backup-<date>/`": move `.maister/` to `.maister.backup-$(date +%Y%m%d-%H%M%S)/` with the Bash tool, then continue with PHASE 2. The docs-operator is told the re-initialization is decided, so it does not ask again

Leaving without changes is the Other answer: stop.

---

## PHASE 2: Project Analysis

Invoke `project-analyzer` subagent via the Task tool, with the model and effort `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:project-analyzer --host=claude` prints just before (`../workflow-engine/references/verbs.md` § *Model and effort on every agent call*; each `docs-operator` call below runs it the same way, with `--agent=maister:docs-operator`).

**The analyzer runs whatever the project's size.** The analysis is its work: never inspect the codebase in its place, and a small, simple or familiar project is no reason to. Phase 3's confirmation is built from its report, and the same holds for standards-discover's subagents in Phase 8.

Wait for completion. Store analysis results for use in Phases 3 and 6.

---

## PHASE 3: Confirm Findings & Gather Context

Every question here carries its own context — the findings go in the question, never in a message above it. Every question offers at least two real options — one option is nothing to choose, and Claude Code's question tool refuses it: a finding with nothing to choose is stated, never asked.

**Step 1 — Confirm the analysis.** One AskUserQuestion whose question lists what was detected, one line each: project type, language and framework, architecture, the main tech stack, anything the analyzer flagged as custom or low confidence, and the project profile fields (Phase 5 Step 3) the analysis could not settle, by what each asks ("Not found: where it deploys, who reaches it, who uses it"), so a correction can settle them. Options: "Looks right (Recommended)" and one to three generated corrections, drawn from what the analyzer was least sure of ("It's a monorepo, not a single app", "The backend is Fastify, not Express"). A free-text correction is the Other answer. Apply corrections before going on.

**Step 2 — Project context, one page.** One AskUserQuestion call with up to three questions:
- **Description**: drafted from the README and the analysis in one or two sentences, quoted in the question itself ("Describe the project as: '…'?"), with "Use this (Recommended)" and one generated alternative — a shorter wording, or one built on another reading of what the project is — its full text in the option's description; the user's own wording is the Other answer. When no real alternative exists, the description is not asked: Phase 7's summary states it, and the documents it lands in can be edited. The project name comes from the manifest or folder and is not asked.
- **Goals** (optional): one to three generated goals fitting a new, existing or legacy project, plus "Skip". The goal the analysis best supports comes first, marked "(Recommended)", the question saying in a few words what it rests on.
- **Team context** (optional): generated options ("Solo project", "Small team", "Several teams") plus "Skip". The option the repository's history supports — the number of distinct commit authors — is marked "(Recommended)", the question naming that count; with no history to read, "Skip" is. It says who builds the project, never who uses it, so it settles no profile field.

Each question's default is its recommended option. "Skip" is offered on an optional question, never its default, unless it is the option recommended: a user who confirms the page as it stands takes what the analysis supports.
<!-- plain-picker
The page is one form of up to three properties, each `"type": "string"` — the question tool refuses a property without its type — and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label, "(Recommended)" on the recommended one), never a bare `enum` of labels — with `default` the recommended option's id.
-->

**Step 3 — Which project documents.** AskUserQuestion — "Which project documents should be written? The tech stack is always included.":
- "Vision, roadmap, tech stack and architecture (Recommended)" — recommended for a standard, frontend-only or backend-only project
- "Tech stack only" — recommended instead for a monorepo or umbrella
- "Choose individually" — then a multi-select of Vision, Roadmap and Architecture, none marked recommended

Store selections for Phase 6.

---

## PHASE 4: Select Standards to Initialize

The standards come in groups, one folder each. Which groups fit the project is the resolver's answer, from its group table: this phase never keeps a list of its own.

**Step 1 — Build the profile.** Build now the object Phase 5 Step 3 writes: its fields, filled by Step 3's table and evidence rules from Phase 2's analysis with Phase 3's corrections applied. A field nothing settles is left out. This is the one profile: the resolver reads it here, and Step 3 writes it as it stands.

**Step 2 — Run the resolver.** From the project root, run `node <plugin root>/skills/docs-manager/scripts/standards.mjs groups`, the plugin root two levels above this skill's base directory, written as an absolute path, with:
- each profile field the resolver takes, as its flag: `--kind`, `--ui`, `--deploy`, and `--data` as a list (`--data=""` for `[]`); a field the profile leaves out gets no flag
- `--signals` with the ids the analyzer reported found, after Phase 3's corrections; only ids of its eight signals
- `--monorepo` when the analyzer's architecture type or a correction says monorepo or umbrella
- with `--standards-from`, `--standards-dir` set to the source path Phase 1 stored

Write every list value in double quotes (`--signals="native-mobile,database"`); bash, PowerShell and cmd.exe all read that the same way. Paths follow init's convention for its other commands, which is the engine's invocation rule: a path holding a space, such as a `--standards-from` source, goes in single quotes.

- **A refusal** (exit 1): correct the input its error names and run once more.
- **An internal failure** (exit 2): ask as *Error Handling Principles* asks for a failed tool, with the cause in the question: "Retry (Recommended)" or "Continue with manual input". The latter offers the nine groups, the folders of the built-in standards (`<plugin root>/skills/docs-manager/docs/standards/`), paged as "Choose individually" pages them, with no option marked recommended.

**Step 3 — The defaults.** The defaults are the `recommended` ids. With `--standards-from`, they are the recommended ids the source holds plus its `custom` folders, as the resolver's `present` list reports them, leaving out one marked `empty`, which holds no standards to copy. A recommended group held there only through pre-change files (`via: "pre-change"`) is taken as the folder holding them.

**Step 4 — One question.** Ask once with AskUserQuestion, the groups, their reasons and their source in the question, such as: "Start with these standards? Always: global and testing. Recommended: mobile (kind: mobile; expo in package.json), data (data: sqlite; a migrations folder). They come from \<the referenced project | Maister's built-in set\> and can be edited later." Each recommended group is named with its `reasons`: a profile field as `field: value`, a signal as the evidence the analyzer gave for it. With `--standards-from`, the question also names a recommended group the source lacks, and each source folder of its own. With `--standards-from`, global and testing are stated as always given only when the source holds them; one the source lacks is named as not held there, like any recommended group, and Phase 7 names it.
- "Use them (Recommended)": takes the defaults
- "Choose individually": offers every group except global and testing, plus the source's own folders, in multi-select questions of at most four options, as one page. Split the options evenly so every question holds two to four (nine as 3, 3, 3); past four questions, a further page follows in the same turn. Each option is labelled with the group's title, and its description says why it was or was not recommended: its reasons, or, for a group in `not_recommended`, that nothing in the profile or the analysis calls for it, or the `outranked` signal precedence set aside. A source folder of its own says it comes from the referenced project. No option is marked recommended. The first question of the first page also offers "None of these", described as no group beyond global and testing, and it counts among that question's two to four. Global and testing stay in the selection as the defaults hold them.

An empty selection is an answer: every question left blank, or "None of these", means no group beyond global and testing. Take it as given and go on to Phase 5; never ask again in prose. "None of these" chosen beside a group leaves the group chosen.

A group of the project's own is the Other answer: its name joins the selection, and Phase 5 creates its folder.
<!-- plain-picker
A page is one form of up to four properties, one per question, each `"type": "array"` — the question tool refuses a property without its type — whose items are a choice of its options: `anyOf` entries of `const` (the folder name) and `title` (the group's title), none marked "(Recommended)", the first property's entries ending with `const` `none` and `title` "None of these" (`none` names no group); why each group was or was not recommended goes in the property's description, since the form shows titles only.
-->

Nothing is written in this phase. Store the selection for Phase 5, and the groups the resolver recommended for Phase 7's summary.

---

## PHASE 5: Initialize Documentation Structure

**Invoke `docs-operator` subagent** via Task tool (subagent_type: `maister:docs-operator`, model and effort from `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude`, run just before) with prompt — here and in Phase 7, `[check path]` is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, the plugin root two levels above this skill's base directory, written as an absolute path. `[standards path]` is `<plugin root>/skills/docs-manager/docs/standards/`, the built-in standards, written the same way as an absolute path, or with `--standards-from` the `[resolved path]/.maister/docs/standards/` Phase 1 stored:

> "Initialize documentation structure. Standards selection: [folder names from Phase 4]. Standards source path: [standards path]. Copy each selected folder by name, whole, from that path, and no other. Do NOT copy project templates — only create the project/ directory. Project documentation will be generated in Phase 6 with real content from project analysis. Write one INDEX.md section per copied folder and none for a folder that was not copied. Check: [check path]."

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
# (development's ui-mockups node, product-design's sketches and screens nodes, or /maister:mockup-studio).
# A mockup turn reads it when no format is passed.
#   html  (default): HTML pages and a version gallery page, written as .html files to open.
#   ascii          : terminal ASCII mockups via the ascii-mockup-generator agent (no Node/browser needed).
# Only html or ascii: a written scope is asked for per turn with `format: scope`, never set here.
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
    question-reader: { tier: light }
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

Leave out any field the analysis or a correction does not settle; a guess is worse than a gap, because a field rules checks out. `deploy`, `exposure` and `scale` are settled only by something found — a deploy configuration, a container or infrastructure file, a bind address, a public route, accounts or tenant keys in the data model — or by the user's answer; finding nothing settles nothing, so `none`, `local` or `single-user` is never written for lack of evidence, and the team context, which says who builds the project, never settles `scale`. A field Step 1 named as not found stays out unless a correction settled it, as that question told the user. The fields are the object Phase 4 built; write it as it stands, never built again. Write the fields as one JSON object, with the file tool, to `.maister/.project-profile.json` beside `config.yml`, and hand it to the workflow engine's `project-profile` verb, from the project root: `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs project-profile --patch-file=.maister/.project-profile.json`. The file carries the JSON so no shell has to quote it — PowerShell and cmd.exe have no here-string — and the verb deletes it once the block is written; a refusal keeps it, to correct and send again. It writes the block only when `config.yml` has no top-level `project:` key — appended after one blank line, every other line unchanged — and leaves an existing key alone; a field left out, or one with a value it does not take, is written commented out with the values it takes, the latter with a `warning:` line. Its JSON reply says what it did (`action`: `created`, `appended` or `kept`) and the block it wrote; keep both for Phase 7's summary.

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

**Step 1**: Invoke `docs-operator` subagent via Task tool (subagent_type: `maister:docs-operator`, model and effort from `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude`, run just before) with prompt:

> "Refresh INDEX.md with the project documentation written in Phase 6 as changed. Check: [check path]. Then verify CLAUDE.md is properly integrated with .maister/docs/ documentation."

Wait for docs-operator to complete, then immediately continue with Step 2.

**Step 2**: Display comprehensive summary. Include any failure docs-operator reported.
- Project analysis results (type, language, framework, architecture), and the project description as written when Phase 3 did not ask it
- Structure created (tree with check marks for created items)
- Documentation status (which docs generated, which standards initialized)
- Standards not copied: run the resolver again with Phase 4's flags plus `--chosen="<the selection Phase 5 copied>"`; its `not_copied` lists each group Phase 4 recommended that was not copied — deselected, or not held by the referenced project. Name exactly those, one line each with the command that adds it later, `/maister:standards-discover --scope=<group>`; a group Phase 4 never recommended is not named, nor any group the list does not hold, and the line is left out when `not_copied` is empty, as it is when every recommended group was copied
- Project config: whether `.maister/config.yml` was created, had the `subagents` block appended, or already held a `subagents` block and was left alone; the file count and the `Explore` tier it chose; and the `subagents` block written or appended, as written. Note that the block governs the agent calls maister makes; the explore agents a host's own plan mode starts are outside it
- Project profile: whether the `project:` block was written or appended, or an existing one was left alone; the block written, as written, with each field it left commented out and any `warning:` line, and a line asking the user to fill in those fields, since they decide which checks the reviewers apply; and that a run freezes the profile when it starts, so a correction reaches the next run
- Key findings (strengths, opportunities)
- Next steps:
  1. Review generated documentation
  2. Customize for your team
  3. Start development with `/maister:work`
  4. Keep the documents current; INDEX.md is refreshed for you, never edited by hand

---

## PHASE 8: Discover Coding Standards

Invoke the `standards-discover` skill via Skill tool with `--scope=full` to automatically discover coding standards from the project's config files, source code patterns, documentation, and external sources.

> "Run standards discovery with --scope=full. This is being invoked as part of project initialization."

The standards-discover skill handles its own user interaction (presenting findings by confidence tier, asking for approval, and asking which rule holds wherever a finding contradicts a starter standard Phase 5 copied). Let it run its full workflow — this is the last phase of init, so context handoff is fine here.

After completion, display a brief summary of how many findings were discovered and applied — the counts standards discovery closed with, as it gave them, never a recount — and name every contradiction with a starter standard: the rule that now holds for each settled one, and both rules with their files for each one left unsettled.
---

## UPDATE PATH: Bring an Existing Setup Up to Date

For a project that already has `.maister/`. It brings the config, the project profile and the four project documents init writes — vision, roadmap, tech stack and architecture — up to date with the code and with what this version of init writes, without losing the team's edits. Three rules hold throughout:
- **Only additions are recommended**: a missing key, block, profile field or project document. An existing config value, profile field or document changes only through a choice made for that one line or file.
- **Init writes no standard.** Nothing under `standards/` is copied or rewritten by init. A group the resolver recommends and `standards/` lacks is pointed at `/maister:standards-discover --scope=<group>`. The built-in rules changed since the setup was made are only counted here; reviewing them is standards-update's built-in mode, which init starts as its last step only when the person chooses it.
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
5. **Standards.** Run `node <plugin root>/skills/docs-manager/scripts/standards.mjs groups` from the project root, as Phase 4 does, with this analysis's `--signals` and `--monorepo` and no profile flag, so it reads the `project:` block as written. Each group in its `absent` list is a finding, with its `/maister:standards-discover --scope=<group>` command. A group whose rules an older setup keeps elsewhere counts as present, as the resolver reports it: data held in `backend/models.md`, `migrations.md` or `queries.md`. It passes only ids of the eight signals, and handles a refusal and an internal failure as Phase 4 Step 2 does. Then run `node <plugin root>/skills/docs-manager/scripts/standards.mjs built-in candidates` from the project root, with `--add-groups` set to the `absent` ids (`--add-groups=""` when none), the same `--signals` and `--monorepo`, and no profile flag. Its `counts` are the built-in changes: `candidates`, of which `recommended` (rules nobody edited, and new rules) and `edited` (rules the team edited, and rules folded into one). Nothing is written and nothing records them. A refusal: correct the input and run once more. An internal failure is a finding naming its cause, and no review is offered.
6. **Index.** Run the check (Phase 5's `[check path]`) from the project root. Its failures — unindexed documents, dead or duplicate entries, conflict markers, no index — are findings Step 4 repairs.

**Step 2 — One decision.** One AskUserQuestion, carrying the whole survey in the question: every proposed change by area (config, profile, project documents), one line each, marked recommended or offered, each offer saying what it would change; then the findings with nothing to choose, stated, not asked — the index check's failures, the missing standards groups, "N built-in standard changes (R for rules nobody edited and new rules, E asked one at a time: rules the team edited, and rules folded into one), offered for review after this question", the validate warnings with no replacement and the profile fields the analysis could not settle; then whatever the analyzer was unsure of that a proposal rests on; and that INDEX.md and the CLAUDE.md pointer are repaired whatever the answer. An absent group's finding adds that the review offers its built-in rules too, beside the discover command, which finds the project's own conventions. Options:
- "Apply the recommended changes (Recommended)": the additions, nothing else
- "Choose change by change": the pages below
- "Leave everything as it is": nothing from the survey is applied; Step 4 still runs

With offers but no addition, the first option would apply nothing, so it is left out and "Leave everything as it is" is the recommended one. A correction to the analysis is the Other answer: apply it, work out again the proposals it touches, and ask again. With nothing to add and nothing to offer, nothing is asked but the built-in standards offer below: go on to Step 4, and the summary says the setup is current only when the built-in standards are current too.

**Choose change by change.** Area by area, at most four questions to a page, each page one AskUserQuestion call:
- an area's additions together, listed in the question: "Add them (Recommended)" / "Skip them";
- every offer on its own — one config line, one profile field, one document: "Keep it as it is (Recommended)" / "Take the change", the question naming the line or the file, its current text and the change; for a document, each contradicted passage and its correction.
<!-- plain-picker
A page is one form of up to four properties, each `"type": "string"` and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label, "(Recommended)" on the recommended one), with `default` the recommended option's id.
-->

**The built-in standards.** When `counts.candidates` is above zero, the offer is an AskUserQuestion call of its own, made after the survey's answer and its pages have come back: never a question in the survey's call or on one of its pages, since the survey's answer decides what is applied before the review. The offer: "Review the N built-in standard changes now? Rules nobody edited are offered together, save those folded into a rule your team edited, which are asked after it; each rule your team edited is asked on its own; nothing changes without a choice." Options: "Review them (Recommended)" / "Not now". It is asked even when the survey itself asked nothing.
<!-- plain-picker
A form of one property, `"type": "string"`, a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label), with `default` the id of "Review them (Recommended)".
-->

**Step 3 — Apply only what was chosen.**
- **Config.** With no `config.yml`, or no `subagents` key, write it or append the block as Phase 5 Step 2 does. Otherwise each chosen change is a line-level edit with the Edit tool, so every other byte of the file stays: an addition goes in after the nearest key before it in the shipped block that the file has, at its siblings' indentation, with the shipped line's comment — a missing output key before the `subagents` block and its comment lines; a chosen value replaces that entry's line or lines with the shipped ones. An entry the file does not hold as lines of its own — a block written on one line, or laid out differently — is not edited: the summary gives the change as text to paste.
- **Profile.** For the additions, send the profile the analysis supports, as Phase 5 Step 3 builds it, as one JSON object in `.maister/.project-profile.json`, written with the file tool as Phase 5 Step 3 does, to `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs project-profile --fill --patch-file=.maister/.project-profile.json`. It writes only the fields the block lacks, leaves empty or holds commented out, and leaves every field the block sets alone; with no `project:` key it appends the block as a first run does. Keep its reply (`action`, the block, any `warning:` line) for the summary. A chosen change to a set field is a line-level edit of that line.
- **Project documents.** A missing document is written as Phase 6 writes it, from its template and the analysis, the project's description taken from the README and the existing documents — Phase 3 is not asked. A chosen refresh changes only the passages its question showed; every other line stays as the team wrote it.
- Nothing is written under `standards/`.

**Step 4 — Refresh INDEX.md and the pointer.** Always, whatever Step 2's answer: invoke docs-operator as Phase 7 Step 1 does, with the documents Step 3 wrote as changed — none after "Leave everything as it is". The refresh gives an unindexed document its entry and drops dead ones, keeping every other entry; the integration check adds a missing CLAUDE.md pointer. Both add only what the documentation system needs.

**Step 5 — Summary.** Include any failure docs-operator reported.
- Changed: each config line added or replaced; the profile reply, its block as it now reads, with each field still commented out and a line asking the user to fill those in; each document written or refreshed
- Kept: each offer declined or not taken, and each change given as text to paste
- Remaining drift: the validate warnings with no replacement, and the profile fields the analysis could not settle
- INDEX.md: what the refresh changed, and the check's result
- Each missing standards group with its `/maister:standards-discover --scope=<group>` command
- Built-in standards: the count Step 1 found, and that the review follows now, or that it was declined, with `/maister:standards-update --built-in` to run it later; or that the built-in standards are current. Nothing records the count.
- That a run freezes the config and the profile when it starts, so a change reaches the next run

**Step 6 — The built-in review.** Only when the review was chosen: invoke the `standards-update` skill via the Skill tool with `--built-in --add-groups="<the ids Step 1 passed>" --signals="<the ids Step 1 passed>"`, and `--monorepo` when Step 1 passed it. It asks its own questions and writes through docs-operator. After it completes, one line: what it applied and kept, as it gave them, never a recount.

---

## Error Handling Principles

- If `.maister/docs/` creation fails: check permissions, suggest manual creation
- If project-analyzer or docs-operator fails: ask with the cause in the question — "\<What\> failed: \<cause\>. What now?" — "Retry (Recommended)" / "Continue with manual input". Two retries at most, then manual instructions
- docs-operator asks nothing: a choice it returns under `decisions_needed` is asked here, in the same form, and the operation is called again with the answer
- Never auto-rollback — always ask user before destructive actions
