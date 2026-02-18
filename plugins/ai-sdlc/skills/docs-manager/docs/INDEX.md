# Documentation Index

**IMPORTANT**: Read this file at the beginning of any development task to understand available documentation and standards.

## Quick Reference

### Project Documentation
Project-level documentation covering vision, goals, architecture, and technology choices.

### Technical Standards
Coding standards, conventions, and best practices organized by domain.

---

## Project Documentation

Located in `.maister/docs/project/`

### Vision (`project/vision.md`)
Defines the project's mission, goals, target users, and long-term vision. Read this to understand the "why" behind the project and align development decisions with project objectives.

### Roadmap (`project/roadmap.md`)
Outlines development milestones, planned features, and timeline. Read this to understand project priorities and upcoming work.

### Tech Stack (`project/tech-stack.md`)
Documents all technologies, frameworks, libraries, and tools used in the project, with rationale for each choice. Read this before adding new dependencies or making technology decisions.

### Architecture (`project/architecture.md`)
Describes the system architecture, component structure, data flow, and design patterns. Read this to understand how the system is organized and how components interact.

---

## Technical Standards

### Global Standards

Located in `.maister/docs/standards/global/`

These standards apply across the entire codebase, regardless of frontend/backend context.

#### Error Handling (`standards/global/error-handling.md`)
Structured error types, error propagation patterns, user-facing vs internal error messages, try-catch placement guidelines, error logging conventions.

#### Validation (`standards/global/validation.md`)
Input validation at system boundaries, sanitization patterns, validation error message formatting, schema validation approach.

#### Conventions (`standards/global/conventions.md`)
Naming conventions (files, variables, functions, classes), file organization patterns, import ordering, code structure guidelines.

#### Coding Style (`standards/global/coding-style.md`)
Indentation and formatting rules, spacing conventions, line length limits, bracket style, consistent code readability patterns.

#### Commenting (`standards/global/commenting.md`)
When to comment (non-obvious logic only), documentation comment format, inline explanation guidelines, TODO/FIXME conventions.

#### Minimal Implementation (`standards/global/minimal-implementation.md`)
No speculative code, no unused methods, no "just in case" abstractions, YAGNI principle enforcement, lean code guidelines.

---

### Frontend Standards

Located in `.maister/docs/standards/frontend/`

These standards apply to frontend code (UI components, client-side logic, styling).

#### CSS (`standards/frontend/css.md`)
CSS naming conventions, stylesheet organization, utility-first vs component styles, CSS variable usage, responsive styling patterns.

#### Components (`standards/frontend/components.md`)
Component structure and composition patterns, props design, lifecycle management, smart vs presentational separation.

#### Accessibility (`standards/frontend/accessibility.md`)
Keyboard navigation requirements, screen reader support, ARIA attribute usage, WCAG compliance level, focus management patterns.

#### Responsive Design (`standards/frontend/responsive.md`)
Breakpoint definitions, mobile-first approach, responsive layout patterns, touch target sizing, viewport considerations.

---

### Backend Standards

Located in `.maister/docs/standards/backend/`

These standards apply to backend code (APIs, services, data layer).

#### API Design (`standards/backend/api.md`)
REST endpoint naming, request/response format conventions, versioning strategy, error response structure, pagination patterns.

#### Models (`standards/backend/models.md`)
Data model structure, schema conventions, business logic placement, relationship patterns, model validation rules.

#### Queries (`standards/backend/queries.md`)
Query optimization patterns, N+1 prevention, index usage guidelines, query builder conventions, raw query policies.

#### Migrations (`standards/backend/migrations.md`)
Migration naming conventions, schema change patterns, data migration approach, rollback requirements, migration testing.

---

### Testing Standards

Located in `.maister/docs/standards/testing/`

These standards apply to all testing code (unit, integration, E2E).

#### Test Writing (`standards/testing/test-writing.md`)
Test naming conventions, test file organization, arrange-act-assert structure, mocking guidelines, coverage expectations, test data management.

---

## How to Use This Documentation

1. **Start Here**: Always read this INDEX.md first to understand what documentation exists
2. **Project Context**: Read relevant project documentation before starting work
   - Vision and roadmap for understanding project goals
   - Tech stack for understanding technology constraints
   - Architecture for understanding system design
3. **Standards**: Reference appropriate standards when writing code
   - Global standards apply to all code
   - Domain-specific standards (frontend/backend/testing) apply to relevant code
4. **Keep Updated**: Update documentation when making significant changes
   - Update project docs when goals, tech stack, or architecture changes
   - Update standards when team conventions evolve
   - Update INDEX.md when adding or removing documentation
5. **Customize**: Adapt all documentation to your project's specific needs
   - Project documentation should reflect your actual project
   - Standards should reflect your team's conventions
   - Both should be version-controlled and reviewed regularly

## Updating Documentation

### When to Update

- **Project docs**: When project goals, tech stack, or architecture changes
- **Standards**: When team conventions evolve or new patterns are adopted
- **INDEX.md**: When adding, removing, or significantly changing documentation

### How to Update

1. Edit the relevant documentation file directly
2. Update INDEX.md if the file's purpose or description changes
3. Ensure CLAUDE.md still references this INDEX.md
4. Commit changes to version control
5. Notify the team of significant documentation changes

### Getting Help

Use the Documentation Manager skill to:
- Initialize documentation in a new project
- Add new documentation files
- Update existing documentation
- Validate documentation consistency
- Manage INDEX.md automatically
- Ensure CLAUDE.md integration

---

## Documentation Priority

When making development decisions, follow this priority order:

1. **Project documentation** in `.maister/docs/` (highest priority)
   - Represents team decisions and project-specific requirements
2. **Code patterns** visible in the codebase
   - Shows how the team actually implements things
3. **User's direct instructions**
   - Specific guidance for the current task
4. **General best practices** (lowest priority)
   - Default to industry standards when no specific guidance exists

**The documentation in `.maister/docs/` represents team decisions and should be followed unless the user explicitly overrides them.**

---

**Last Generated**: [Automatically updated by Documentation Manager]
**Maintained by**: Documentation Manager skill
