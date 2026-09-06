---
name: maister-docs-manager
description: Manage `.maister/docs/`, baseline and project-specific coding standards, the documentation index, and durable `AGENTS.md` integration. Use when initializing, adding, updating, comparing, indexing, listing, or validating Maister project documentation.
---

# Maister Docs Manager

Manage documentation as an internal service for `$maister-codex:maister-init`, `$maister-codex:maister-standards-update`, and `$maister-codex:maister-standards-discover`. It may also handle an explicit documentation-management request. Return control to the calling workflow after the requested operation.

When an explicit request reaches a user decision gate, prefer `request_user_input` when available; otherwise ask the equivalent concise question in the final response and pause. When called by another workflow, return the decision needed so the coordinator can own the gate.

Project files under `.maister/docs/` are the source of truth. Bundled files under `assets/standards/` are starting points only. Preserve project customizations and require explicit approval before overwriting or resetting them.

## Structure and format

Maintain this shape:

```text
.maister/docs/
├── INDEX.md
├── project/
│   ├── vision.md
│   ├── roadmap.md
│   ├── tech-stack.md
│   └── architecture.md
└── standards/
    ├── global/
    ├── frontend/
    ├── backend/
    └── testing/
```

Custom project documents and standard categories are allowed. Standard files use `## Topic` followed by concise `### Standard Name` sections with actionable rules and short examples only when useful.

## Operations

### Initialize

1. Inspect existing `.maister/docs/`, `AGENTS.md`, and any external standards source supplied by the caller.
2. If initialization would replace project files, show the affected paths and obtain approval first.
3. Create `project/` and the selected standards categories. Copy selected baseline categories from `assets/standards/`, or from the approved external standards directory. Never copy placeholder project documents.
4. Generate `.maister/docs/INDEX.md` from the actual directory using `references/index-md-template.md`; see `references/index-md-example.md` for a fully populated example with practice-specific descriptions. Include useful placeholders for skipped baseline categories.
5. Add or merge the documentation guidance from `references/agents-md-template.md` into the repository `AGENTS.md`. Preserve unrelated instructions and avoid duplicate sections.

### Rebuild the index

Scan every file under `.maister/docs/` except `INDEX.md`. Link each actual file. For standards, summarize the concrete practices in the file rather than repeating its category name. Remove stale entries and report broken or orphaned references.

### Add or update documentation

- Put project knowledge in `.maister/docs/project/` and conventions in `.maister/docs/standards/<category>/`.
- Preserve existing content unless the requested change supersedes it.
- Compare against a bundled baseline when helpful, but never treat the baseline as higher authority.
- Regenerate the index after additions, removals, renames, or material purpose changes.
- Suggest updating tech-stack or architecture documentation when implementation changes invalidate it.

### Compare or reset

Compare project files with `assets/standards/` read-only first. Show exact files that differ. Reset only the individually approved paths; do not perform a blanket overwrite unless the user explicitly requests it. Rebuild the index afterward.

### List or validate

Report bundled, installed, customized, missing, and orphaned documents. Validate that:

- `.maister/docs/INDEX.md` exists and its links resolve;
- every documentation file is indexed;
- critical selected project documents contain real content rather than placeholders;
- standards use the expected section structure;
- the repository `AGENTS.md` routes agents to `.maister/docs/INDEX.md` without duplicating or contradicting existing guidance.

Offer safe fixes for issues. Apply destructive or overwriting fixes only after approval.

## Authority order

Follow direct user instructions first, then durable repository instructions, project documentation and standards, established code patterns, and general best practices. Surface conflicts instead of silently choosing.
