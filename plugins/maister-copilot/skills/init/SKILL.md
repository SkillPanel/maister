---
name: init
description: Initialize Maister framework with intelligent project analysis and documentation generation
argument-hint: "[--standards-from=PATH]"
---

# Initialize Maister Framework

Initialize `.maister/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

**NOTE**: This skill invokes other skills and subagents at specific phases. Use the **Task tool with `docs-operator` subagent** (subagent_type: `maister-copilot:docs-operator`) for all docs-manager operations, and **Task tool** for project-analyzer. Use the **Skill tool** only for standards-discover (Phase 8, last phase). The Task tool returns control to this skill after completion; the Skill tool does not.

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

**Task Tracking**: Before Phase 1, use `TaskCreate` for all phases (pending), then set sequential dependencies with `TaskUpdate addBlockedBy`. At each phase: `TaskUpdate` to `in_progress` → execute → `TaskUpdate` to `completed`. If skipped (e.g., the user chooses to update the existing docs), mark skipped phases as `completed` with `metadata: {skipped: true}`.

---

## PHASE 1: Pre-flight Checks

**If `--standards-from=PATH` is provided:**
1. Resolve the path (absolute or relative to current working directory)
2. Check if `PATH/.maister/docs/standards/` exists. If not, inform the user and stop — the specified project doesn't have maister standards initialized.
3. Store the resolved standards source path for use in Phases 4 and 5.

Check if `.maister/` directory already exists.

**If exists**, use ask_user — "Maister is already set up here. What now?":
- "Update the docs, keep my edits (Recommended)": skip to PHASE 6 (documentation generation only); the standards and the team's own edits stay
- "Start over: the old docs move to `.maister.backup-<date>/`": move `.maister/` to `.maister.backup-$(date +%Y%m%d-%H%M%S)/` with the Bash tool, then continue with PHASE 2. The docs-operator is told the re-initialization is decided, so it does not ask again

Leaving without changes is the Other answer: stop.

---

## PHASE 2: Project Analysis

Invoke `project-analyzer` subagent via the Task tool.

Wait for completion. Store analysis results for use in Phases 3 and 6.

---

## PHASE 3: Confirm Findings & Gather Context

Every question here carries its own context — the findings go in the question, never in a message above it.

**Step 1 — Confirm the analysis.** One ask_user whose question lists what was detected, one line each: project type, language and framework, architecture, the main tech stack, and anything the analyzer flagged as custom or low confidence. Options: "Looks right (Recommended)" and up to three generated corrections, drawn from what the analyzer was least sure of ("It's a monorepo, not a single app", "The backend is Fastify, not Express"). A free-text correction is the Other answer. Apply corrections before going on.

**Step 2 — Project context, one page.** One ask_user call with up to three questions:
- **Description**: drafted from the README and the analysis in one or two sentences, quoted in the question itself ("Describe the project as: '…'?"), with "Use this (Recommended)"; the user's own wording is the Other answer. The project name comes from the manifest or folder and is not asked.
- **Goals** (optional): up to three generated goals fitting a new, existing or legacy project, plus "Skip".
- **Team context** (optional): generated options ("Solo project", "Small team", "Several teams") plus "Skip".

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

**Invoke `docs-operator` subagent** via Task tool (subagent_type: `maister-copilot:docs-operator`) with prompt:

> "Initialize documentation structure. Standards selection: [array from Phase 4]. [If --standards-from was provided: Standards source path: [resolved path]/.maister/docs/standards/. Copy standards from this external path instead of built-in defaults.] Only copy selected standard categories. Do NOT copy project templates — only create the project/ directory. Project documentation will be generated in Phase 6 with real content from project analysis. Create placeholder sections in INDEX.md for skipped categories."

Wait for docs-operator to complete, then immediately proceed to Phase 6.

**Step 2 — Scaffold project config** (Write tool, directly — not via docs-operator): if `.maister/config.yml` does not already exist, create it with the documented default so users have a discoverable place to toggle output. Do not overwrite an existing config. The block below is the normative definition of the keys, their types and their defaults in this edition — write it verbatim.

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

**Step 1**: Invoke `docs-operator` subagent via Task tool (subagent_type: `maister-copilot:docs-operator`) with prompt:

> "Regenerate INDEX.md to include all newly created project documentation. Then verify .github/copilot-instructions.md is properly integrated with .maister/docs/ documentation."

Wait for docs-operator to complete, then immediately continue with Step 2.

**Step 2**: Display comprehensive summary. Include any failure docs-operator reported.
- Project analysis results (type, language, framework, architecture)
- Structure created (tree with check marks for created items)
- Documentation status (which docs generated, which standards initialized)
- Key findings (strengths, opportunities)
- Next steps:
  1. Review generated documentation
  2. Customize for your team
  3. Start development with `/maister-copilot:work`
  4. Keep documentation current

---

## PHASE 8: Discover Coding Standards

Invoke the `standards-discover` skill via Skill tool with `--scope=full` to automatically discover coding standards from the project's config files, source code patterns, documentation, and external sources.

> "Run standards discovery with --scope=full. This is being invoked as part of project initialization."

The standards-discover skill handles its own user interaction (presenting findings by confidence tier, asking for approval). Let it run its full workflow — this is the last phase of init, so context handoff is fine here.

After completion, display a brief summary of how many standards were discovered and applied.

---

## Error Handling Principles

- If `.maister/docs/` creation fails: check permissions, suggest manual creation
- If project-analyzer or docs-operator fails: ask with the cause in the question — "\<What\> failed: \<cause\>. What now?" — "Retry (Recommended)" / "Continue with manual input". Two retries at most, then manual instructions
- docs-operator asks nothing: a choice it returns under `decisions_needed` is asked here, in the same form, and the operation is called again with the answer
- Never auto-rollback — always ask user before destructive actions
