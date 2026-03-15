---
name: init
description: Initialize AI SDLC framework with intelligent project analysis and documentation generation
argument-hint: [--standards-from=PATH]
---

# Initialize AI SDLC Framework

Initialize `.maister/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

**NOTE**: This skill invokes other skills and subagents at specific phases. Use the **Task tool with `docs-operator` subagent** (subagent_type: `maister-docs-operator`) for all docs-manager operations, and **Task tool** for project-analyzer. Use the **Skill tool** only for standards-discover (Phase 8, last phase). The Task tool returns control to this skill after completion; the Skill tool does not.

## Phase Configuration

| Phase | Subject | activeForm |
|-------|---------|------------|
| 1 | Pre-flight checks | Running pre-flight checks |
| 2 | Analyze project codebase | Analyzing project codebase |
| 3 | Present findings & gather context | Gathering project context |
| 4 | Select standards to initialize | Selecting standards |
| 5 | Initialize documentation structure | Initializing documentation |
| 6 | Generate project documentation | Generating project documentation |
| 7 | Validate | Validating initialization |
| 8 | Discover coding standards | Discovering coding standards |

**Task Tracking**: Before Phase 1, use `TaskCreate` for all phases (pending), then set sequential dependencies with `TaskUpdate addBlockedBy`. At each phase: `TaskUpdate` to `in_progress` → execute → `TaskUpdate` to `completed`. If skipped (e.g., user selects "Update existing"), mark skipped phases as `completed` with `metadata: {skipped: true}`.

---

## PHASE 1: Pre-flight Checks

**If `--standards-from=PATH` is provided:**
1. Resolve the path (absolute or relative to current working directory)
2. Check if `PATH/.maister/docs/standards/` exists. If not, inform the user and stop — the specified project doesn't have maister standards initialized.
3. Store the resolved standards source path for use in Phases 4 and 5.

Check if `.maister/` directory already exists.

**If exists**, use AskUserQuestion:
- Options: "Backup and reinitialize", "Update existing documentation", "Cancel"
- If "Backup": Create `.maister.backup-$(date +%Y%m%d-%H%M%S)/` using Bash tool
- If "Update": Skip to PHASE 6 (documentation generation only)
- If "Cancel": Stop execution

---

## PHASE 2: Project Analysis

Invoke `project-analyzer` subagent via the Task tool.

Wait for completion. Store analysis results for use in Phases 3 and 6.

---

## PHASE 3: Present Findings & Gather Context

**Step 1**: Present analysis results to the user (project type, primary language/framework, architecture, tech stack, conventions, strengths/opportunities).

**Step 2**: Use AskUserQuestion to confirm analysis accuracy. If corrections needed, collect them.

**Step 3**: Gather additional context via AskUserQuestion (adapt to project type):
1. Project name (if not obvious)
2. Project description (1-2 sentences)
3. Primary goals (adapt question to new/existing/legacy project)
4. Team context (optional)
5. Special requirements (optional)

**Step 4**: Ask which project documentation to generate using AskUserQuestion (sequential single-select):
- "Vision" — Project vision, goals, and purpose
- "Roadmap" — Development roadmap and planned features
- "Tech Stack" — Technology choices and rationale (ALWAYS selected, required)
- "Architecture" — System architecture and design patterns (optional)

Smart defaults based on `projectArchitectureType`:
- Standard/Frontend-only/Backend-only: All selected
- Monorepo/Umbrella: Only "Tech Stack" selected

Store selections for Phase 6.

---

## PHASE 4: Select Standards to Initialize

Before presenting options, explain to the user:
- **What standards are**: Coding standards are documented conventions and best practices (naming, error handling, testing patterns, etc.) that guide consistent development across the project.
- **Starting point**: If `--standards-from` was provided, standards come from the referenced project. Otherwise, the plugin includes generic built-in standards. Either way, they serve as a starting point and can be fully customized or extended later.

**Determine available categories:**
- **If `--standards-from` was provided**: Scan `PATH/.maister/docs/standards/*/` to discover all available categories from the external project (may include custom categories beyond the baseline global/frontend/backend/testing).
- **Otherwise**: Use built-in baseline categories (global, frontend, backend, testing).

Calculate smart defaults based on analysis:
- **Global**: Always recommended (if available)
- **Frontend**: If frontend framework detected or projectArchitectureType includes frontend (if available)
- **Backend**: If backend framework detected or projectArchitectureType includes backend (if available)
- **Testing**: Always recommended (if available)

Also scan `.maister/docs/standards/*/` for any existing custom categories to include.

Show smart defaults summary (noting the source: external project or built-in), then use AskUserQuestion:
- "Use smart defaults" → proceed with calculated defaults
- "Customize selection" → show sequential single-select with all discovered categories + "Add custom category" option

Custom categories: if user adds a new category, create the directory and include it in the selection.

Store selection for Phase 5.

---

## PHASE 5: Initialize Documentation Structure

**Invoke `docs-operator` subagent** via Task tool (subagent_type: `maister-docs-operator`) with prompt:

> "Initialize documentation structure. Standards selection: [array from Phase 4]. [If --standards-from was provided: Standards source path: [resolved path]/.maister/docs/standards/. Copy standards from this external path instead of built-in defaults.] Only copy selected standard categories. Do NOT copy project templates — only create the project/ directory. Project documentation will be generated in Phase 6 with real content from project analysis. Create placeholder sections in INDEX.md for skipped categories."

Wait for docs-operator to complete, then immediately proceed to Phase 6.

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

**Step 1**: Invoke `docs-operator` subagent via Task tool (subagent_type: `maister-docs-operator`) with prompt:

> "Regenerate INDEX.md to include all newly created project documentation. Then verify .github/copilot-instructions.md is properly integrated with .maister/docs/ documentation."

Wait for docs-operator to complete, then immediately continue with Step 2.

**Step 2**: Run validation checks:
- Verify INDEX.md exists
- Verify tech-stack.md exists (required)
- Verify selected docs exist
- Verify selected standards directories exist
- Verify .github/copilot-instructions.md integration

**Step 3**: Display comprehensive summary:
- Project analysis results (type, language, framework, architecture)
- Structure created (tree with check marks for created items)
- Documentation status (which docs generated, which standards initialized)
- Key findings (strengths, opportunities)
- Next steps:
  1. Review generated documentation
  2. Customize for your team
  3. Start development with `/maister-work`
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
- If project-analyzer fails: offer to proceed with manual input only
- If docs-manager fails: offer retry (max 2 attempts), then manual instructions
- Never auto-rollback — always ask user before destructive actions
