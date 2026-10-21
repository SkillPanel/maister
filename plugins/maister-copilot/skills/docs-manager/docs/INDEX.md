<!-- Maintained by  edit the source documents, not this file. -->
# Documentation Index

A map of this project's documentation: one entry per file, saying what it is for and when to open it. Open the files themselves; an entry never holds their content.

## Standards: global

### Coding Style (`standards/global/coding-style.md`)
How code is named, shaped and formatted everywhere. Read in full before: naming, formatting, function size, dead code, duplication, compatibility shims.

### Commenting (`standards/global/commenting.md`)
When code earns a comment and what it says. Read in full before: writing or reviewing comments.

### Development Conventions (`standards/global/conventions.md`)
How the project is organised and changed. Read in full before: file layout, environment variables, dependencies, feature flags, changelog, reviews.

### Error Handling (`standards/global/error-handling.md`)
How failures are raised, handled and reported. Read in full before: exception types, user-facing messages, retries, degradation, resource cleanup.

### Minimal Implementation (`standards/global/minimal-implementation.md`)
What gets built and what is left out. Read in full before: new abstractions, stubs, helper code, exploration leftovers.

### Validation (`standards/global/validation.md`)
Where and how input is checked. Read in full before: server and client validation, sanitization, error messages, business rules.

## Standards: frontend

### Accessibility (`standards/frontend/accessibility.md`)
How the interface stays usable for everyone. Read in full before: markup structure, keyboard and focus, contrast, labels, ARIA.

### Components (`standards/frontend/components.md`)
How UI components are cut and composed. Read in full before: new components, props, local state, component naming.

### CSS (`standards/frontend/css.md`)
How styles are written and shipped. Read in full before: styling approach, design tokens, custom CSS, production builds.

### Responsive Design (`standards/frontend/responsive.md`)
How layouts adapt across screens. Read in full before: breakpoints, fluid layouts, units, touch targets, mobile performance.

## Standards: backend

### API Design (`standards/backend/api.md`)
How HTTP endpoints are shaped. Read in full before: routes and naming, versioning, query parameters, status codes, rate limits.

### Database Migrations (`standards/backend/migrations.md`)
How schema and data changes are written and rolled out. Read in full before: new migrations, rollbacks, zero-downtime changes, indexes.

### Models (`standards/backend/models.md`)
How data models and their tables are defined. Read in full before: model naming, column types, constraints, relationships, normalization.

### Database Queries (`standards/backend/queries.md`)
How data is read and written safely and fast. Read in full before: SQL and ORM queries, N+1 risks, transactions, timeouts, caching.

## Standards: testing

### Test Writing (`standards/testing/test-writing.md`)
What gets tested and how tests are written. Read in full before: new tests, mocking, test naming, coverage choices.
