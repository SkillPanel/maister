---
name: init
description: Initialize AI SDLC framework with intelligent project analysis and documentation generation
argument-hint: (no arguments)
---

# Initialize AI SDLC Framework

Initialize `.maister/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

**NOTE**: This skill invokes other skills and subagents at specific phases. Use the Skill tool for docs-manager and Task tool for project-analyzer.

## Phase Configuration

| Phase | Subject | activeForm |
|-------|---------|------------|
| 1 | Pre-flight checks | Running pre-flight checks |
| 2 | Analyze project codebase | Analyzing project codebase |
| 3 | Present findings & gather context | Gathering project context |
| 4 | Select standards to initialize | Selecting standards |
| 5 | Initialize documentation structure | Initializing documentation |
| 6 | Generate project documentation | Generating project documentation |
| 7 | Finalize & validate | Finalizing initialization |

**Task Tracking**: Before Phase 1, use `TaskCreate` for all phases (pending), then set sequential dependencies with `TaskUpdate addBlockedBy`. At each phase: `TaskUpdate` to `in_progress` → execute → `TaskUpdate` to `completed`. If skipped (e.g., user selects "Update existing"), mark skipped phases as `completed` with `metadata: {skipped: true}`.

---

## PHASE 1: Pre-flight Checks

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

**Step 4**: Ask which project documentation to generate using AskUserQuestion (multi-select):
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

Calculate smart defaults from baseline categories based on analysis:
- **Global**: Always recommended
- **Frontend**: If frontend framework detected or projectArchitectureType includes frontend
- **Backend**: If backend framework detected or projectArchitectureType includes backend
- **Testing**: Always recommended

Also scan `.maister/docs/standards/*/` for any existing custom categories to include.

Show smart defaults summary, then use AskUserQuestion:
- "Use smart defaults" → proceed with calculated defaults
- "Customize selection" → show multi-select with all discovered categories + "Add custom category" option

Custom categories: if user adds a new category, create the directory and include it in the selection.

Store selection for Phase 5.

---

## PHASE 5: Initialize Documentation Structure

**Invoke docs-manager skill** via Skill tool with context:

> "Initialize documentation structure. Standards selection: [array from Phase 4]. Only copy selected standard categories. Do NOT copy project templates — only create the project/ directory. Project documentation will be generated in Phase 6 with real content from project analysis. Create placeholder sections in INDEX.md for skipped categories."

Wait for docs-manager to complete.

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

## PHASE 7: Finalize & Validate

**Step 1**: Invoke docs-manager skill via Skill tool:

> "Regenerate INDEX.md to include all newly created project documentation. Then verify CLAUDE.md is properly integrated with .maister/docs/ documentation."

**Step 2**: Run validation checks:
- Verify INDEX.md exists
- Verify tech-stack.md exists (required)
- Verify selected docs exist
- Verify selected standards directories exist
- Verify CLAUDE.md integration

**Step 3**: Display comprehensive summary:
- Project analysis results (type, language, framework, architecture)
- Structure created (tree with check marks for created items)
- Documentation status (which docs generated, which standards initialized)
- Key findings (strengths, opportunities)
- Next steps:
  1. Review generated documentation
  2. Customize for your team
  3. Run `/maister:standards-discover` to discover existing coding standards
  4. Start development with `/work`
  5. Keep documentation current

---

## Error Handling Principles

- If `.maister/docs/` creation fails: check permissions, suggest manual creation
- If project-analyzer fails: offer to proceed with manual input only
- If docs-manager fails: offer retry (max 2 attempts), then manual instructions
- Never auto-rollback — always ask user before destructive actions
