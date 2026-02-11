---
name: ai-sdlc:init-sdlc
description: Initialize AI SDLC framework with intelligent project analysis and documentation generation
---

**NOTE**: This is a multi-step workflow that invokes other skills (docs-manager, project-analyzer) at specific phases. The `<command-name>` tag refers to THIS command only — you MUST still use the Skill tool and Task tool to invoke those other skills when instructed below.

## Initialization Process

Initialize `.ai-sdlc/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

## PHASE 1: Pre-flight Checks

Check for existing structure:
```bash
# Check if .ai-sdlc/ already exists
if [ -d ".ai-sdlc" ]; then
    echo "⚠️  .ai-sdlc/ directory already exists"
    echo ""
    echo "Contents:"
    ls -la .ai-sdlc/
fi
```

**If .ai-sdlc/ exists**, use AskUserQuestion:
- Options: "Backup and reinitialize", "Update existing documentation", "Cancel"
- If "Backup": Create `.ai-sdlc.backup-$(date +%Y%m%d-%H%M%S)/` using Bash tool
- If "Update": Skip to PHASE 5 (documentation population only)
- If "Cancel": Stop execution

**If proceeding**: Continue to PHASE 2

## PHASE 2: Project Analysis

**Run subagent project-analyzer**

**Wait for the subagent to complete before proceeding.**

Store the analysis results - you will use them in PHASE 5.


## PHASE 3: Present Findings & Gather Context

Present the analysis results to the user:

```markdown
# Project Analysis Complete

## Summary
- **Project Type**: [new/existing/legacy] (confidence: [high/medium/low])
- **Primary Language**: [language] ([version])
- **Primary Framework**: [framework] ([version])
- **Architecture**: [pattern]

## Tech Stack Detected
[Show detected technologies with confidence levels]

## Architecture
[Show discovered patterns and structure]

## Conventions
[Show naming and organization patterns]

## Current State
**Strengths**: [list]
**Opportunities**: [list]
```

**Use AskUserQuestion to confirm analysis**:
- Question: "Is this analysis accurate? Are there any missing technologies or incorrect classifications?"
- Options: "Yes, accurate", "No, let me provide corrections"

**If corrections needed**: Collect corrections from user.

**Gather additional context using AskUserQuestion**:

Ask the user (adapt questions based on project type):

1. **Project Name** (if not obvious): Use AskUserQuestion or prompt for input
2. **Project Description**: Brief 1-2 sentence description
3. **Primary Goals**:
   - New project: "What are you building? Who is it for?"
   - Existing project: "What are the main goals for the next 6-12 months?"
   - Legacy project: "What are your modernization priorities?"
4. **Team Context** (optional): Team size, development practices
5. **Special Requirements** (optional): Compliance, performance targets, constraints

Store all responses. Merge auto-detected information with user-provided context.

**IMPORTANT: Ask which project documentation to generate:**

Use AskUserQuestion with multi-select enabled:
- Question: "Which project documentation should we generate?"
- Options:
  - "Vision" - "Project vision, goals, and purpose" (selected by default)
  - "Roadmap" - "Development roadmap and planned features" (selected by default)
  - "Tech Stack" - "Technology choices and rationale" (ALWAYS selected, required)
  - "Architecture" - "System architecture and design patterns" (optional)
- Smart defaults based on projectArchitectureType from analysis:
  - **Standard/Frontend-only/Backend-only projects**: All selected by default
  - **Monorepo/Umbrella projects**: Only "Tech Stack" selected by default
- Store selected documentation types for Phase 5

---

## PHASE 3.5: Select Standards to Initialize

**NEW PHASE: Standards Selection with Smart Defaults**

Based on project analysis (projectArchitectureType and detected tech stack), present a standards checklist using AskUserQuestion.

**Smart Defaults Logic:**

Calculate smart defaults based on analysis:
```
smart_defaults = []

# Global standards - ALWAYS recommended
smart_defaults.append('global')

# Frontend standards - if frontend detected
if (frontend_framework_detected OR
    projectArchitectureType in ['frontend-only', 'mixed'] OR
    has_frontend_files):
    smart_defaults.append('frontend')

# Backend standards - if backend detected
if (backend_framework_detected OR
    projectArchitectureType in ['backend-only', 'mixed'] OR
    has_backend_files):
    smart_defaults.append('backend')

# Testing standards - ALWAYS recommended
smart_defaults.append('testing')
```

**Ask user to customize standards:**

First, show the smart defaults summary:
```markdown
## Standards Smart Defaults

Based on project analysis:
- **Project Type**: [projectArchitectureType]
- **Frontend Detected**: [Yes/No - frameworks]
- **Backend Detected**: [Yes/No - frameworks]

**Recommended Standards**:
- ✓ Global (error-handling, validation, conventions, coding-style, commenting)
- [✓/-] Frontend (css, components, accessibility, responsive)
- [✓/-] Backend (api, models, queries, migrations)
- ✓ Testing (test-writing)
```

Then use AskUserQuestion:
- Question: "Customize which technical standards to initialize? (Smart defaults pre-selected based on your project)"
- Multi-select: true
- Options:
  - "Global Standards" - "Error handling, validation, conventions, coding style, commenting" (always pre-selected)
  - "Frontend Standards" - "CSS, components, accessibility, responsive design" (pre-selected if frontend detected)
  - "Backend Standards" - "API design, models, database queries, migrations" (pre-selected if backend detected)
  - "Testing Standards" - "Test writing guidelines and best practices" (always pre-selected)
- Store selected standards as array for Phase 4

**Alternative: "Customize standards?" bypass:**

Alternatively, use a simpler two-step approach:
1. Show smart defaults summary
2. Ask: "Use smart defaults or customize standards selection?"
   - "Use smart defaults" → proceed with smart_defaults array
   - "Customize selection" → show multi-select question above

Choose the simpler approach to reduce friction.

---

## PHASE 4: Initialize Documentation Structure

**Invoke the docs-manager skill NOW using the Skill tool:**

```
command: docs-manager
```

Provide context: "Initialize documentation structure in this project with selected standards. Use analysis report from project-analyzer to inform structure.

**Standards Selection**: [Pass the standards_selection array from Phase 3.5]

Examples:
- ['global', 'frontend', 'backend', 'testing'] → Initialize all standards
- ['global', 'frontend', 'testing'] → Skip backend standards
- ['global', 'testing'] → Only global and testing standards

The docs-manager will only copy selected standard categories and create placeholder sections in INDEX.md for skipped categories."

The docs-manager skill will:
1. Create `.ai-sdlc/docs/` directory structure
2. Copy baseline standards from plugin (ONLY selected categories from Phase 3.5)
3. Create initial INDEX.md (with placeholders for skipped standards)
4. Update CLAUDE.md integration

**Wait for docs-manager to complete before proceeding.**

---

## PHASE 5: Create Project Documentation

Now create meaningful documentation using the analysis report and user input you gathered.

**IMPORTANT**: Only generate documentation that was selected in Phase 3. Check the selected_documentation array from Phase 3.

### 5.1 Create vision.md

**Only if "Vision" was selected in Phase 3.**

Use the Write tool to create `.ai-sdlc/docs/project/vision.md`.

Select the appropriate template based on project type:

**For NEW projects**:
```markdown
# Project Vision

## Pitch
[PROJECT_NAME] is a [TYPE] that helps [TARGET_USERS] [SOLVE_PROBLEM] by [VALUE_PROPOSITION].

## Problem Statement
[What problem are you solving? Why does it matter?]

## Target Users
[Who will use this? What are their needs?]

## Key Features
[Core features that deliver value]

## Success Criteria
[How will you measure success?]

## Differentiators
[What makes this unique?]
```

**For EXISTING projects**:
```markdown
# Project Vision

## Overview
[PROJECT_NAME] is a [TYPE] that [CURRENT_PURPOSE].

## Current State
- **Age**: [X years/months]
- **Status**: [Active development/Maintenance/etc.]
- **Users**: [Current user base]
- **Tech Stack**: [Primary technologies]

## Purpose
[Why this project exists, what problem it solves]

## Goals (Next 6-12 Months)
[Planned improvements and new features]

## Evolution
[How the project has changed, where it's headed]
```

**For LEGACY projects**:
```markdown
# Project Vision

## Overview
[PROJECT_NAME] is a [TYPE] built [X years ago] to [ORIGINAL_PURPOSE].

## Current State
- **Age**: [X years]
- **Tech Stack**: [Current technologies - note outdated items]
- **Technical Debt**: [Assessment from analysis]
- **Status**: [Production/Maintenance/Migration planned]

## Modernization Goals
[What needs to be updated and why]

## Migration Strategy
[If applicable - path from legacy to modern stack]

## Business Value
[Why maintain/modernize this system]
```

Fill in the template with:
- Analysis report data (tech stack, age, structure)
- User-provided context (goals, users, requirements)
- Auto-detected project characteristics

### 5.2 Create tech-stack.md

**Always generated - Tech Stack is required documentation.**

Use the Write tool to create `.ai-sdlc/docs/project/tech-stack.md`.

Use the auto-detected tech stack as foundation:

```markdown
# Technology Stack

## Overview
This document describes the technology choices and rationale for [PROJECT_NAME].

## Languages

### [Primary Language] ([Version])
- **Usage**: [percentage]% of codebase
- **Rationale**: [Why this language? From analysis or user input]
- **Key Features Used**: [Notable language features]

[Repeat for other languages]

## Frameworks

### Frontend
[List detected frontend frameworks with versions and rationale]

### Backend
[List detected backend frameworks with versions and rationale]

### Testing
[List detected testing frameworks]

## Database

### [Database Name] ([Version])
- **Type**: [Relational/NoSQL/etc.]
- **ORM/Client**: [Detected library]
- **Rationale**: [Why this database?]

## Build Tools & Package Management
[From analysis: npm, Maven, pip, etc.]

## Infrastructure

### Containerization
[Docker, Docker Compose - if detected]

### CI/CD
[GitHub Actions, GitLab CI - if detected]

### Hosting
[Vercel, AWS, Heroku - if detected or known]

## Development Tools

### Linting & Formatting
[ESLint, Prettier, Black - from analysis]

### Type Checking
[TypeScript, MyPy - from analysis]

## Key Dependencies
[List major dependencies from package files]

## Version Management
[How versions are managed - from analysis]

## Migration Path (for legacy projects)
[If applicable - planned upgrades]

---

*Last Updated*: [Date]
*Auto-detected*: [List what was auto-detected vs user-provided]
```

Fill in all detected technologies, versions, and rationale.

### 5.3 Create roadmap.md

**Only if "Roadmap" was selected in Phase 3.**

Use the Write tool to create `.ai-sdlc/docs/project/roadmap.md`.

Select the appropriate format based on project type:

**For NEW projects** (feature-based roadmap):
```markdown
# Development Roadmap

This roadmap outlines the planned features and development phases for [PROJECT_NAME].

## Phase 1: MVP (Minimum Viable Product)
**Timeline**: [Estimated]

- [ ] **Feature 1** — [Description] `[Effort: S/M/L]`
- [ ] **Feature 2** — [Description] `[Effort: S/M/L]`
- [ ] **Feature 3** — [Description] `[Effort: S/M/L]`

## Phase 2: Core Features
**Timeline**: [Estimated]

- [ ] **Feature 4** — [Description] `[Effort: S/M/L]`
- [ ] **Feature 5** — [Description] `[Effort: S/M/L]`

[Continue...]

## Future Enhancements
- [ ] **Feature X** — [Nice to have]

---

**Effort Scale**:
- `S`: 2-3 days
- `M`: 1 week
- `L`: 2+ weeks
```

**For EXISTING projects** (evolution roadmap):
```markdown
# Development Roadmap

## Current State
- **Version**: [From analysis]
- **Key Features**: [List major current features]
- **Recent Updates**: [From git history]

## Planned Enhancements (Next 3-6 Months)

### High Priority
- [ ] **Enhancement 1** — [Description and why it matters]
- [ ] **Enhancement 2** — [Description and why it matters]

### Medium Priority
- [ ] **Enhancement 3** — [Description]

### Technical Debt
- [ ] **Debt Item 1** — [From analysis, if applicable]
- [ ] **Debt Item 2** — [From analysis, if applicable]

## Future Considerations
- **Feature Ideas**: [Long-term possibilities]
- **Scalability**: [Performance improvements needed]
```

**For LEGACY projects** (modernization roadmap):
```markdown
# Modernization Roadmap

## Current State Assessment
- **Technology Age**: [From analysis - e.g., "9 years old"]
- **Technical Debt**: [High/Medium/Low - from analysis]
- **Outdated Components**: [List from analysis]
- **Security Concerns**: [If identified]

## Modernization Goals

### Critical (Must Do)
- [ ] **Upgrade [Component]** — [e.g., "Java 8 → Java 17 LTS"] `Risk: High if delayed`
- [ ] **Security Patch** — [Address known vulnerabilities]

### Important (Should Do)
- [ ] **Framework Update** — [e.g., "Spring 3.x → Spring Boot 3.x"]
- [ ] **Improve Test Coverage** — [Current: 15%, Target: 70%]

### Improvements (Nice to Do)
- [ ] **Refactor Module X** — [Reduce technical debt]
- [ ] **Add Documentation** — [Architecture, deployment]

## Migration Strategy
[Step-by-step approach if major migration needed]

## Risk Mitigation
[How to reduce risk during modernization]

---

*Assessment based on project analysis performed [Date]*
```

Fill in roadmap items based on user-provided goals and analysis findings.

### 5.4 Create architecture.md (Optional)

**Only if "Architecture" was selected in Phase 3.**

Use the Write tool to create `.ai-sdlc/docs/project/architecture.md`:

```markdown
# System Architecture

## Overview
[HIGH-LEVEL description of system architecture]

## Architecture Pattern
**Pattern**: [From analysis - e.g., "Layered monolithic with REST API"]

[DESCRIPTION of how the pattern is implemented]

## System Structure

### [Component 1]
- **Location**: [From analysis - e.g., "src/api/"]
- **Purpose**: [What it does]
- **Key Files**: [List from analysis]

### [Component 2]
- **Location**: [From analysis]
- **Purpose**: [What it does]
- **Key Files**: [List from analysis]

[Continue for all major components]

## Data Flow
[Describe how data flows through the system]

## Key Components

### [Critical Component 1]
**File**: `[path from analysis]`
**Purpose**: [From analysis]
**Dependencies**: [What it depends on]

[Continue for critical components]

## External Integrations
[List integrations found in analysis - databases, APIs, services]

## Database Schema
[If ORM detected, reference schema file location]

## Configuration
[How configuration is managed - from analysis]

## Deployment Architecture
[If detected - Docker, K8s, cloud services]

---

*Based on codebase analysis performed [Date]*
```

Fill in architecture details from analysis report.

---

## PHASE 6: Update INDEX.md

**Invoke docs-manager again to regenerate INDEX.md:**

```
command: docs-manager
```

Provide context: "Regenerate INDEX.md to include all newly created project documentation."

Wait for completion.

---

## PHASE 7: Verify CLAUDE.md Integration

**Invoke docs-manager one final time:**

```
command: docs-manager
```

Provide context: "Ensure CLAUDE.md is properly integrated with .ai-sdlc/docs/ documentation."

Wait for completion.

---

## PHASE 8: Validate & Summarize

Run validation checks using the Bash tool:
```bash
# Check structure
ls -la .ai-sdlc/docs/

# Verify key files
test -f .ai-sdlc/docs/INDEX.md && echo "✓ INDEX.md"
test -f .ai-sdlc/docs/project/tech-stack.md && echo "✓ tech-stack.md (required)"

# Verify selected documentation (conditional checks based on Phase 3 selections)
test -f .ai-sdlc/docs/project/vision.md && echo "✓ vision.md"
test -f .ai-sdlc/docs/project/roadmap.md && echo "✓ roadmap.md"
test -f .ai-sdlc/docs/project/architecture.md && echo "✓ architecture.md"

# Verify selected standards directories (conditional checks based on Phase 3.5 selections)
test -d .ai-sdlc/docs/standards/global/ && echo "✓ standards/global/"
test -d .ai-sdlc/docs/standards/frontend/ && echo "✓ standards/frontend/"
test -d .ai-sdlc/docs/standards/backend/ && echo "✓ standards/backend/"
test -d .ai-sdlc/docs/standards/testing/ && echo "✓ standards/testing/"

# Verify CLAUDE.md integration
grep -q "ai-sdlc/docs/INDEX.md" CLAUDE.md && echo "✓ CLAUDE.md integrated"
```

**Display comprehensive summary to the user:**

```markdown
# ✅ AI SDLC Framework Initialized Successfully!

## 📊 Project Analysis

**Type**: [new/existing/legacy]
**Primary Language**: [language] ([version])
**Primary Framework**: [framework] ([version])
**Architecture**: [pattern]
**Confidence**: [high/medium/low]

## 📁 Structure Created

.ai-sdlc/docs/
├── INDEX.md                 ✓ Master documentation index
├── project/
│   ├── vision.md           [✓/- Based on selection]
│   ├── roadmap.md          [✓/- Based on selection]
│   ├── tech-stack.md       ✓ Technology stack (always generated)
│   └── architecture.md     [✓/- Based on selection]
└── standards/
    ├── global/             [✓/- Based on selection]
    ├── frontend/           [✓/- Based on selection]
    ├── backend/            [✓/- Based on selection]
    └── testing/            [✓/- Based on selection]

## 📝 Documentation Status

**Project Documentation**:
[✓/✗] **Vision** - [If selected: Summary of vision | If not: Skipped for this project type]
✅ **Tech Stack** - [X languages, Y frameworks] (always generated)
[✓/✗] **Roadmap** - [If selected: N items planned | If not: Skipped for this project type]
[✓/✗] **Architecture** - [If selected: System design documented | If not: Skipped]

**Standards Initialized**:
[✓/✗] **Global** - [M files | Skipped]
[✓/✗] **Frontend** - [M files | Skipped for backend-only project]
[✓/✗] **Backend** - [M files | Skipped for frontend-only project]
[✓/✗] **Testing** - [M files | Skipped]

✅ **CLAUDE.md integrated** - AI will read documentation automatically

## 🔍 Key Findings

**Strengths**:
[List from analysis]

**Opportunities**:
[List from analysis]

[If legacy project]
**Modernization Priorities**:
[List critical updates needed]

## 🎯 Next Steps

### 1. Review Documentation
```bash
# Read the generated documentation
cat .ai-sdlc/docs/INDEX.md
cat .ai-sdlc/docs/project/vision.md
cat .ai-sdlc/docs/project/tech-stack.md
cat .ai-sdlc/docs/project/roadmap.md
```

### 2. Customize for Your Team
- Update vision.md with specific product goals
- Adjust roadmap priorities
- Customize standards in .ai-sdlc/docs/standards/
- Add team-specific conventions

### 3. Discover Existing Standards (Recommended)

**Auto-discover coding standards from your codebase:**

```bash
/ai-sdlc:standards:discover
```

This will analyze:
- ✓ Configuration files (ESLint, Prettier, TypeScript, etc.)
- ✓ Code patterns and naming conventions
- ✓ Documentation (README, CONTRIBUTING)
- ✓ Pull request review comments (if GitHub available)
- ✓ CI/CD requirements

**Time**: ~2-4 minutes | **Benefit**: Automatically document your team's existing practices

**Alternative**: Skip and manually add standards later using `/ai-sdlc:standards:update`

### 4. Start Development
```bash
# Start working on your first task
/work

# The /work command will:
# - Classify your task type (feature, bug-fix, enhancement, etc.)
# - Route to appropriate workflow orchestrator
# - Guide you through spec → plan → implement → verify

# Or update existing documentation
/docs-manager update project/vision
```

### 5. Keep Documentation Current
- Update roadmap as features complete
- Document architectural decisions
- Update tech-stack.md when technologies change
- Run docs-manager to keep INDEX.md updated

## 💡 Tips

✨ **AI is now documentation-aware**: Claude will automatically read `.ai-sdlc/docs/INDEX.md` before starting any task

✨ **Standards are active**: When implementing features, AI will follow standards from `.ai-sdlc/docs/standards/`

✨ **Documentation evolves**: Update docs as your project grows - documentation is a living artifact

✨ **Re-run anytime**: You can run `/init-sdlc` again to refresh documentation (it will backup existing docs)

## 📚 Documentation

For more information:
- Read `.ai-sdlc/docs/INDEX.md` for complete documentation map
- See CLAUDE.md for AI integration details
- Use `/docs-manager` skill for documentation management

---

**Framework initialized in**: [X seconds/minutes]
**Files analyzed**: [N files]
**Documentation generated**: [M files]
```

**Initialization is now complete.** ✅
