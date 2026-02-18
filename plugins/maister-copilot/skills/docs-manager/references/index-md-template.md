# INDEX.md Template

Use this structure when generating or updating `.maister/docs/INDEX.md`. Scan the actual `.maister/docs/` directory to populate sections dynamically — do not hardcode file lists.

For technical standards, the description MUST enumerate specific practices/conventions documented in the file, not just a generic category description.

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

Located in `.maister/docs/project/`

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

### [Category Name] Standards

Located in `.maister/docs/standards/[category]/`

#### [Standard Name] (`standards/[category]/[name].md`)
[Practice-specific description — enumerate actual conventions, not generic text]

[... repeat for all categories and standards discovered in the directory ...]

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
```
