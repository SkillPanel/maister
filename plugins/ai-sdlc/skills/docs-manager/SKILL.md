---
name: docs-manager
description: Manages project documentation and technical standards in .ai-sdlc/docs/. Use this skill to initialize docs, maintain INDEX.md, manage project documentation (vision, roadmap, tech-stack), and technical standards (coding conventions, best practices).
---

# Documentation Manager

This skill manages comprehensive project documentation and technical standards. It bundles baseline standards and templates as resources within the plugin.

## Core Principles

**PROJECT DOCUMENTATION IS SUPERIOR**: This skill operates under the principle that project-level documentation in `.ai-sdlc/docs/` is the source of truth. Plugin-bundled documentation serves as:
- **Initial baseline** when setting up a new project
- **Reference material** for teams creating their own documentation
- **Optional fallback** if a project wants to reset to defaults

The documentation manager helps teams:
- Maintain current project documentation (vision, roadmap, tech-stack)
- Keep technical standards up-to-date (coding conventions, best practices)
- Ensure INDEX.md provides a clear map of all documentation
- Integrate documentation references into CLAUDE.md for AI assistance
- Use plugin documentation as a starting point, not an ongoing sync source

## Documentation Structure

```
.ai-sdlc/docs/
├── INDEX.md                      # Master index - READ THIS FIRST
├── project/                      # Project-level documentation
│   ├── vision.md                # Project vision and goals
│   ├── roadmap.md               # Development roadmap
│   ├── tech-stack.md            # Technology choices and rationale
│   └── architecture.md          # System architecture (optional)
└── standards/                    # Technical standards and conventions
    ├── global/                  # Language-agnostic standards
    │   ├── error-handling.md
    │   ├── validation.md
    │   ├── conventions.md
    │   ├── coding-style.md
    │   └── commenting.md
    ├── frontend/                # Frontend-specific standards
    │   ├── css.md
    │   ├── components.md
    │   ├── accessibility.md
    │   └── responsive.md
    ├── backend/                 # Backend-specific standards
    │   ├── api.md
    │   ├── models.md
    │   ├── queries.md
    │   └── migrations.md
    └── testing/                 # Testing standards
        └── test-writing.md
```

## Bundled Resources

This skill bundles the following resources within the plugin:

- **Project Templates**: Baseline templates for vision, roadmap, tech-stack, and architecture documentation
- **Standards Directory**: Contains baseline technical standards organized by category:
  - `global/` - Global standards (error handling, validation, conventions, etc.)
  - `frontend/` - Frontend-specific standards (CSS, components, accessibility, etc.)
  - `backend/` - Backend-specific standards (API design, database, queries, etc.)
  - `testing/` - Testing standards (test writing, coverage, etc.)
- **INDEX.md Template**: Master template for documentation index

## Location Reference

- **Plugin bundles** (read-only baseline): This skill's `docs/` subdirectory within the plugin
- **Project documentation** (source of truth): `.ai-sdlc/docs/` in the project root
- **Project configuration**: `CLAUDE.md` in the project root

## Capabilities

### 1. Initialize Documentation in Project

Use this when a project doesn't have `.ai-sdlc/docs/` or needs documentation for the first time. This is a **one-time baseline setup** that gives the project a starting point.

**IMPORTANT**: This operation now accepts an optional `standards_selection` parameter (array of standard categories) to control which standards to initialize. If not provided, all standards are copied (backward compatible).

**What to do:**
1. Check if `.ai-sdlc/docs/` exists in the project root
2. If it exists, warn the user that initialization will overwrite existing documentation and ask for confirmation
3. Create the directory structure based on standards_selection:
   ```
   .ai-sdlc/docs/
   ├── project/
   └── standards/
       ├── global/      (if 'global' in standards_selection or no selection provided)
       ├── frontend/    (if 'frontend' in standards_selection or no selection provided)
       ├── backend/     (if 'backend' in standards_selection or no selection provided)
       └── testing/     (if 'testing' in standards_selection or no selection provided)
   ```
4. Copy baseline documentation from this skill's bundled `docs/` directory to the project's `.ai-sdlc/docs/` directory:
   - **Project documentation**: Always copy all project templates (vision, roadmap, tech-stack, architecture)
   - **Standards**: Only copy selected standard categories based on standards_selection parameter:
     - If `standards_selection` is empty or not provided: Copy ALL standards (backward compatible)
     - If `standards_selection` is provided: Only copy specified categories
     - Examples:
       - `['global', 'frontend', 'testing']` → Copy only these three categories
       - `['global', 'backend', 'testing']` → Skip frontend standards
       - `['global', 'testing']` → Only global and testing standards
5. Generate INDEX.md with entries for all copied documentation (see "Manage INDEX.md" operation):
   - For skipped standard categories, add placeholder sections with "Not initialized - run standards discovery if needed"
   - Example: If frontend standards are skipped, INDEX.md shows:
     ```markdown
     ### Frontend Standards

     *Not initialized for this project. If you need frontend standards, you can:*
     - *Add them manually using the docs-manager skill*
     - *Run `/ai-sdlc:standards:discover --scope=frontend` to auto-discover*
     ```
6. **MANDATORY - Update CLAUDE.md:**
   - Check if `CLAUDE.md` exists in the project root; if not, ask the user if they want to create it
   - Add the documentation reference section (see "Manage CLAUDE.md Integration" operation)
   - Ensure it emphasizes reading INDEX.md at the beginning of any task
7. Inform the user about the documentation structure and encourage customization
8. **IMPORTANT - Gather project information:**
   - Ask the user key questions about their project:
     - Project name and description
     - Primary goals and vision
     - Current tech stack
     - Team size and structure
   - Update the project documentation files (vision.md, tech-stack.md) with this information
   - This makes the documentation immediately useful rather than just placeholder templates

**Parameters:**
- `standards_selection` (optional, array of strings): Standard categories to initialize
  - Valid values: `['global', 'frontend', 'backend', 'testing']`
  - If omitted or empty: Initialize all standards (backward compatible)
  - If provided: Only initialize specified categories

**Result:** The project now has baseline documentation in `.ai-sdlc/docs/`, a comprehensive INDEX.md, and CLAUDE.md integration that ensures AI assistance is documentation-aware. Only selected standard categories are initialized.

**Important:** After this initial setup, the project's documentation becomes the source of truth. Teams should customize it for their specific needs.

**Note on Skipped Standards**: If standard categories are skipped during initialization, teams can add them later using:
- "Add Documentation File" operation to add specific standards
- `/ai-sdlc:standards:discover` command to auto-discover standards from codebase

---

### 2. Manage INDEX.md

Use this to create or update the INDEX.md file that serves as the master documentation map.

**What to do:**
1. Scan the `.ai-sdlc/docs/` directory structure
2. For each documentation file found:
   - Read the first few lines to extract description (look for frontmatter or first paragraph)
   - Determine the file's purpose and category
3. Generate or update INDEX.md with this structure:

```markdown
# Documentation Index

**IMPORTANT**: Read this file at the beginning of any development task to understand available documentation and standards.

## Quick Reference

### Project Documentation
Project-level documentation covering vision, goals, architecture, and technology choices.

### Technical Standards
Coding standards, conventions, and best practices organized by domain.

---

## Project Documentation

Located in `.ai-sdlc/docs/project/`

### Vision (`project/vision.md`)
[Brief description of what this file contains]

### Roadmap (`project/roadmap.md`)
[Brief description of what this file contains]

### Tech Stack (`project/tech-stack.md`)
[Brief description of what this file contains]

### Architecture (`project/architecture.md`)
[Brief description of what this file contains - if exists]

---

## Technical Standards

### Global Standards

Located in `.ai-sdlc/docs/standards/global/`

#### Error Handling (`standards/global/error-handling.md`)
[Brief description]

#### Validation (`standards/global/validation.md`)
[Brief description]

[... continue for all standards ...]

### Frontend Standards

Located in `.ai-sdlc/docs/standards/frontend/`

[... list all frontend standards ...]

### Backend Standards

Located in `.ai-sdlc/docs/standards/backend/`

[... list all backend standards ...]

### Testing Standards

Located in `.ai-sdlc/docs/standards/testing/`

[... list all testing standards ...]

---

## How to Use This Documentation

1. **Start Here**: Always read this INDEX.md first to understand what documentation exists
2. **Project Context**: Read relevant project documentation before starting work
3. **Standards**: Reference appropriate standards when writing code
4. **Keep Updated**: Update documentation when making significant changes
5. **Customize**: Adapt all documentation to your project's specific needs

## Updating Documentation

- Project documentation should be updated when goals, tech stack, or architecture changes
- Technical standards should be updated when team conventions evolve
- Always update INDEX.md when adding, removing, or significantly changing documentation
- Run the Documentation Manager skill to help maintain this index
```

4. Write the generated INDEX.md to `.ai-sdlc/docs/INDEX.md`
5. Verify that CLAUDE.md references this index (see "Manage CLAUDE.md Integration" operation)

**Result:** A comprehensive, up-to-date INDEX.md that provides a clear map of all project documentation.

---

### 3. Add Documentation File

Use this to add new documentation to the project, either from plugin baseline or custom.

**What to do:**
1. Determine the type of documentation to add:
   - Project documentation (vision, roadmap, tech-stack, architecture, custom)
   - Technical standard (global, frontend, backend, testing)
2. If adding from plugin baseline:
   - Check if the requested documentation exists in this skill's bundled `docs/` directory
   - Copy it to the appropriate location in `.ai-sdlc/docs/`
3. If creating custom documentation:
   - Ask for the category (project/ or standards/category/)
   - Ask for the filename and purpose
   - Create a template file with appropriate frontmatter and structure
4. Update INDEX.md to include the new documentation (see "Manage INDEX.md" operation)
5. If this is a technical standard and corresponds to a Claude Code Skill, ensure consistency

**Result:** New documentation is added to the project and indexed in INDEX.md.

---

### 4. Update Documentation

Use this to help the user update or modify existing project documentation.

**What to do:**
1. Accept the documentation identifier from the user (e.g., "project/vision", "standards/global/error-handling")
2. Check if the documentation exists in `.ai-sdlc/docs/`
3. If the documentation exists:
   - Read the current documentation
   - Ask the user what they want to change or update
   - Help them edit the documentation file directly
   - Optionally, show them the plugin's baseline version for reference if they ask
4. If the documentation doesn't exist:
   - Offer to add it from the plugin baseline (see "Add Documentation File" operation)
   - Or offer to help them create custom documentation from scratch
5. After updating:
   - Check if INDEX.md needs updating (if the purpose/description changed significantly)
   - If updating tech-stack.md or architecture.md, suggest reviewing CLAUDE.md for consistency
6. For technical standards:
   - If a corresponding Claude Code Skill exists, suggest reviewing it for consistency
   - Standards should align with actual code patterns in the project

**Result:** Documentation is updated to reflect current project state and team decisions.

---

### 5. Use Plugin Documentation as Reference

Use this when a team wants to see the plugin's baseline documentation for reference, or reset specific docs to plugin defaults.

**What to do:**
1. Compare the documentation in this skill's bundled `docs/` directory with the project's `.ai-sdlc/docs/` directory to identify differences
2. Show the user which documents differ and how they differ
3. Explain that plugin documentation is baseline/reference only, and project documentation is superior
4. **WARNING**: Copying plugin documentation to the project will overwrite any project-specific customizations
5. Ask the user if they want to:
   - View the differences for reference only (no changes)
   - Reset specific documentation to plugin baseline (selective overwrite)
   - Reset all documentation to plugin baseline (full overwrite - rarely recommended)
6. If the user chooses to copy any documentation:
   - Copy the selected files from this skill's bundled `docs/` directory to the project's `.ai-sdlc/docs/` directory
   - Update INDEX.md to reflect any changes
   - Review CLAUDE.md for any necessary updates

**Important:** This operation should be used rarely, mainly when a team wants to reset to baseline. Project documentation is the source of truth and should be maintained by the team.

**Result:** User can reference plugin baseline documentation and optionally reset specific docs to plugin versions.

---

### 6. List Available Documentation

Use this to show what documentation is bundled with this plugin and their installation status in the project.

**What to do:**
1. List all documentation in this skill's bundled `docs/` directory, organized by category
2. For each bundled document:
   - Show the category and name
   - Check if it exists in the project at `.ai-sdlc/docs/[category]/[name].md`
   - Show installation status (bundled only, installed, or customized)
   - If installed, show whether it differs from the baseline (customized)
3. Show whether INDEX.md exists and is up-to-date
4. Show whether CLAUDE.md has documentation integration
5. Remind the user that plugin documentation is baseline/reference only, and project documentation (if installed) is the source of truth

**Result:** The user sees a complete inventory of available baseline documentation and their installation status in the current project.

---

### 7. Manage CLAUDE.md Integration

Use this to ensure the project's CLAUDE.md properly integrates with the documentation system, encouraging AI to read and use the documentation.

**What to do:**
1. Check if `CLAUDE.md` exists in the project root
2. If it doesn't exist, ask the user if they want to create it
3. Look for a documentation reference section in CLAUDE.md
4. If the section doesn't exist or is incomplete, create/update it with this template:

```markdown
## Project Documentation

**CRITICAL**: Before starting any task, read @.ai-sdlc/docs/INDEX.md to understand:
- Project vision, goals, and roadmap
- Technology stack and architectural decisions
- Coding standards and conventions
- Best practices and patterns

### Documentation Structure

All project documentation is located in `.ai-sdlc/docs/`:

- **@.ai-sdlc/docs/INDEX.md** - Master documentation map (READ THIS FIRST)
- **project/** - Project vision, roadmap, tech stack, architecture
- **standards/** - Technical standards organized by domain (global, frontend, backend, testing)

### Using Documentation

1. **Always start** by reading @.ai-sdlc/docs/INDEX.md
2. **Load relevant documentation** based on the task:
   - For project context: Read `.ai-sdlc/docs/project/vision.md`, `.ai-sdlc/docs/project/tech-stack.md`
   - For architecture decisions: Read `.ai-sdlc/docs/project/architecture.md`
   - For coding patterns: Read appropriate standards from `.ai-sdlc/docs/standards/`
3. **Follow standards** when writing code - they represent team decisions and conventions
4. **Keep documentation updated** - update docs when making significant changes
5. **Ask if unclear** - if documentation conflicts or is unclear, ask the user for clarification

### Documentation Priority

When in doubt, this is the priority order:
1. Project documentation in `.ai-sdlc/docs/` (highest priority)
2. Code patterns and conventions visible in the codebase
3. User's direct instructions
4. General best practices (lowest priority)

**The documentation in `.ai-sdlc/docs/` represents team decisions and should be followed unless the user explicitly overrides them.**

## AI SDLC Workflows

This project uses the ai-sdlc plugin for structured development. Available orchestrators:
- `/ai-sdlc:development:new` - Development workflow for features, enhancements, and bug fixes
- `/ai-sdlc:migration:new` - Technology/platform migrations (with rollback planning)

All orchestrators read @.ai-sdlc/docs/INDEX.md continuously to apply project standards.
Use interactive mode (default) or `--yolo` for continuous execution.
```

5. Ensure the documentation section is placed prominently in CLAUDE.md (near the top)
6. Verify that the INDEX.md path is correct and the file exists
7. If `.ai-sdlc/docs/` doesn't exist, suggest running the initialization operation first

**Result:** CLAUDE.md properly integrates with the documentation system, ensuring AI assistance is documentation-aware and follows team conventions.

---

### 8. Validate Documentation Consistency

Use this to check that documentation is consistent, up-to-date, and properly integrated.

**What to do:**
1. **Check structure:**
   - Verify `.ai-sdlc/docs/` directory exists
   - Verify all expected subdirectories exist (project/, standards/global/, etc.)
2. **Check INDEX.md:**
   - Verify it exists and is readable
   - Check that all files in `.ai-sdlc/docs/` are listed in INDEX.md
   - Check that all files listed in INDEX.md actually exist
   - Report any orphaned files or broken references
3. **Check CLAUDE.md integration:**
   - Verify CLAUDE.md exists
   - Verify it contains documentation reference section
   - Verify it uses valid file reference format: @.ai-sdlc/docs/INDEX.md (with @ prefix, without backticks)
   - Warn if using incorrect formats like `.ai-sdlc/docs/INDEX.md` or `@.ai-sdlc/docs/INDEX.md` (backticks)
4. **Check project documentation:**
   - Verify critical files exist (vision.md, tech-stack.md)
   - Check if they contain placeholder text vs. actual project information
   - Warn if critical documentation is missing or empty
5. **Check standards consistency:**
   - If Claude Code Skills exist, check if corresponding standards documentation exists
   - If standards exist without skills, suggest creating skills (if appropriate)
   - Report any inconsistencies
6. **Generate validation report:**
   - Summary of documentation status
   - List of issues found
   - Recommendations for fixes
7. **Offer to fix issues:**
   - Ask if the user wants to automatically fix found issues
   - Fix missing INDEX.md entries
   - Fix missing CLAUDE.md integration
   - Create missing directory structure

**Result:** A comprehensive validation report with optional automatic fixes for common issues.

---

## Usage Examples

**Initialize documentation in a new project:**
```
User: "Set up documentation for this project"
Claude: [Executes Initialize Documentation - creates structure, copies baseline docs, generates INDEX.md, updates CLAUDE.md, gathers project info]
```

**Update project vision:**
```
User: "I want to update our project vision to include AI-first approach"
Claude: [Executes Update Documentation - reads current vision.md, helps user edit it, updates INDEX.md if needed]
```

**Add custom documentation:**
```
User: "Add documentation for our deployment process"
Claude: [Executes Add Documentation File - creates custom project/deployment.md, updates INDEX.md]
```

**Reference plugin baseline:**
```
User: "Show me the plugin's baseline error handling standard"
Claude: [Executes Use Plugin Documentation as Reference - shows plugin baseline, compares with project version, no changes unless user requests]
```

**Validate documentation:**
```
User: "Check if our documentation is complete and consistent"
Claude: [Executes Validate Documentation Consistency - checks structure, INDEX.md, CLAUDE.md integration, generates report]
```

**Manage INDEX.md:**
```
User: "Rebuild the documentation index"
Claude: [Executes Manage INDEX.md - scans .ai-sdlc/docs/, regenerates comprehensive INDEX.md]
```

---

## Important Notes

- **PROJECT DOCUMENTATION IS SUPERIOR**: This skill operates on the principle that project-level documentation in `.ai-sdlc/docs/` is the source of truth. Plugin-bundled documentation serves as baseline/reference only.

- **One-time baseline setup**: The "Initialize Documentation" operation is typically used once when setting up a project. After that, project documentation should be maintained by the team.

- **Customization encouraged**: Teams should customize their documentation in `.ai-sdlc/docs/` to fit their specific needs, tech stack, and preferences.

- **INDEX.md is critical**: INDEX.md serves as the master map. It should always be up-to-date and referenced in CLAUDE.md. This ensures AI assistance starts with proper context.

- **CLAUDE.md integration is essential**: The documentation system only works effectively if CLAUDE.md instructs AI to read INDEX.md first. This integration is mandatory for the system to function.

- **Documentation vs. Skills**:
  - Documentation in `.ai-sdlc/docs/standards/` describes team conventions and standards
  - Claude Code Skills in `.claude/skills/` provide AI with actionable guidance based on those standards
  - These should be kept in sync - if standards change, corresponding skills should be updated

- **Living documentation**: Documentation should be updated as the project evolves. Outdated documentation is worse than no documentation. Encourage regular reviews and updates.

- **Project documentation first**: When starting any task, AI should read INDEX.md first, then load relevant project and standards documentation. This ensures consistency with team decisions.

---

## Relationship with Standards Manager

The Documentation Manager and Standards Manager work together:

- **Documentation Manager** (this skill):
  - Manages `.ai-sdlc/docs/` - documentation and standards as markdown files
  - Focuses on human-readable documentation
  - Maintains INDEX.md for documentation discovery
  - Provides baseline standards as reference material

- **Standards Manager**:
  - Manages `.claude/skills/` - Claude Code Skills
  - Focuses on AI-actionable guidance
  - Converts standards into skill descriptions
  - Ensures skills are discoverable by Claude Code

**Workflow:**
1. Initialize documentation → Baseline standards copied to `.ai-sdlc/docs/standards/`
2. Initialize standards (Standards Manager) → Corresponding skills created in `.claude/skills/`
3. Update standard in `.ai-sdlc/docs/` → Run improve-skills to sync the skill
4. Both INDEX.md and CLAUDE.md should reference both systems

This separation ensures:
- Documentation is version-controlled and human-readable
- Skills provide AI with contextual, actionable guidance
- Teams can customize both independently
- Both systems reference the same source of truth (project standards)
