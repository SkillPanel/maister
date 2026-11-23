<!-- Maintained by maister — edit the source documents, not this file. -->
# Documentation Index

A map of this project's documentation: one entry per file, saying what it is for and when to open it. Open the files themselves; an entry never holds their content.

## Standards: global

### Coding Style (`standards/global/coding-style.md`)
How new code reuses and replaces existing code, and what comments say. Read in full before: a new helper or component, renaming or reshaping code, published APIs or formats, comments.

### Development Conventions (`standards/global/conventions.md`)
What a change carries besides code. Read in full before: changing a setup step, command or setting, secrets and keys, adding a dependency, generated files.

### Error Handling (`standards/global/error-handling.md`)
How failures are caught, reported and retried. Read in full before: catching or returning errors, error messages, fallbacks, retries and timeouts on remote calls, releasing resources.

### Minimal Implementation (`standards/global/minimal-implementation.md`)
What a change builds, touches and leaves behind. Read in full before: new abstractions, options or helpers, edits outside the task, finishing any change.

### Validation (`standards/global/validation.md`)
Where input is checked and injection stopped. Read in full before: handling input, building queries, shell commands, HTML, paths or log lines from data, parsing outside data, business rules.

## Standards: testing

### Test Writing (`standards/testing/test-writing.md`)
How tests are written and kept honest. Read in full before: writing or changing tests, mocks, a failing test or check.

## Standards: frontend

### Accessibility (`standards/frontend/accessibility.md`)
How a web interface stays usable by keyboard, screen reader, zoom and touch. Read in full before: controls and fields, headings, ARIA, dialogs and focus, colours, images, status messages, layout widths, font sizes, touch targets.

### Components and Styling (`standards/frontend/components.md`)
Where component state lives and where styles come from. Read in full before: component state, server data in a component, styling, colours, spacing, sizes, breakpoints.

## Standards: backend

### API Design (`standards/backend/api.md`)
How HTTP endpoints behave toward callers. Read in full before: new or changed endpoints, status codes, list endpoints, response bodies, fetching a URL from input.

## Standards: data

### Schema and Migrations (`standards/data/schema.md`)
How tables, constraints and migrations are written and rolled out. Read in full before: a new or existing migration, rollbacks, backfills, column types, constraints, foreign keys, indexes on live tables.

### Database Queries (`standards/data/queries.md`)
How data is read and written safely and fast. Read in full before: SQL and ORM queries, loading related rows, indexes for new queries, transactions, new connections.

## Standards: cli

### Command-Line Interface (`standards/cli/output.md`)
How a command talks to the terminal and to scripts. Read in full before: printing results, errors or progress, prompting, colour.

## Standards: mobile

### Mobile App (`standards/mobile/app.md`)
How a native app handles touch, labels, text size and permissions. Read in full before: tap targets, icon-only controls, text sizes, permission requests.

## Standards: jobs

### Jobs and Message Handlers (`standards/jobs/reruns.md`)
How scheduled jobs, pipeline steps and message handlers stay safe to rerun. Read in full before: job output, message consumers, backfills, reruns.

## Standards: infra

### Infrastructure as Code (`standards/infra/infrastructure.md`)
How infrastructure grants access and how a change reaches an environment. Read in full before: IAM policies, network rules, storage access, plans and applies.
