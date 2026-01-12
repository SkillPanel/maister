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

Located in `.ai-sdlc/docs/standards/global/`

These standards apply across the entire codebase, regardless of frontend/backend context.

#### Error Handling (`standards/global/error-handling.md`)
Standards for error handling, exception management, error messages, and error propagation. Follow these patterns when implementing error handling logic.

#### Validation (`standards/global/validation.md`)
Standards for input validation, data sanitization, and validation error messages. Apply these rules when validating user input or external data.

#### Conventions (`standards/global/conventions.md`)
General coding conventions including naming, file organization, and code structure. Follow these conventions for consistency across the codebase.

#### Coding Style (`standards/global/coding-style.md`)
Code formatting, indentation, spacing, and style guidelines. Follow these rules for consistent, readable code.

#### Commenting (`standards/global/commenting.md`)
Standards for code comments, documentation comments, and inline explanations. Apply these guidelines when documenting code.

#### Minimal Implementation (`standards/global/minimal-implementation.md`)
Standards for avoiding speculative code, unused methods, and "just in case" abstractions. Follow these principles to keep code lean and maintainable.

---

### Frontend Standards

Located in `.ai-sdlc/docs/standards/frontend/`

These standards apply to frontend code (UI components, client-side logic, styling).

#### CSS (`standards/frontend/css.md`)
CSS/styling standards including naming conventions, organization, and best practices. Follow these rules when writing styles.

#### Components (`standards/frontend/components.md`)
Standards for UI component structure, composition, props, and lifecycle. Apply these patterns when building components.

#### Accessibility (`standards/frontend/accessibility.md`)
Accessibility standards for keyboard navigation, screen readers, ARIA, and WCAG compliance. Follow these guidelines for inclusive interfaces.

#### Responsive Design (`standards/frontend/responsive.md`)
Standards for responsive layouts, breakpoints, and mobile-first design. Apply these principles when building responsive UIs.

---

### Backend Standards

Located in `.ai-sdlc/docs/standards/backend/`

These standards apply to backend code (APIs, services, data layer).

#### API Design (`standards/backend/api.md`)
Standards for REST/GraphQL API design, endpoints, request/response formats, and versioning. Follow these patterns when building APIs.

#### Models (`standards/backend/models.md`)
Standards for data models, schemas, and business logic. Apply these patterns when defining domain models.

#### Queries (`standards/backend/queries.md`)
Standards for database queries, optimization, and query patterns. Follow these guidelines when writing database queries.

#### Migrations (`standards/backend/migrations.md`)
Standards for database migrations, schema changes, and data migrations. Apply these practices when modifying database schema.

---

### Testing Standards

Located in `.ai-sdlc/docs/standards/testing/`

These standards apply to all testing code (unit, integration, E2E).

#### Test Writing (`standards/testing/test-writing.md`)
Standards for writing tests, test organization, naming, and best practices. Follow these guidelines when creating tests.

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

1. **Project documentation** in `.ai-sdlc/docs/` (highest priority)
   - Represents team decisions and project-specific requirements
2. **Code patterns** visible in the codebase
   - Shows how the team actually implements things
3. **User's direct instructions**
   - Specific guidance for the current task
4. **General best practices** (lowest priority)
   - Default to industry standards when no specific guidance exists

**The documentation in `.ai-sdlc/docs/` represents team decisions and should be followed unless the user explicitly overrides them.**

---

**Last Generated**: [Automatically updated by Documentation Manager]
**Maintained by**: Documentation Manager skill
