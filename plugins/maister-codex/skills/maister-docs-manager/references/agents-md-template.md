# AGENTS.md Documentation Section Template

Merge this section near the top of the repository's `AGENTS.md`. Preserve unrelated guidance, avoid duplicate headings, and verify that `.maister/docs/INDEX.md` exists.

```markdown
## Project documentation and standards

Before planning, writing, or changing code:

1. Read `.maister/docs/INDEX.md` to discover maintained project documentation and coding standards.
2. Read the specific project and standard files relevant to the task. The index alone is not sufficient.
3. Follow direct user instructions and this `AGENTS.md` first. Treat `.maister/docs/` as the project's next source of truth; surface conflicts instead of silently choosing.

When implementation reveals a recurring convention that is not documented, suggest adding it with `$maister-codex:maister-standards-update`. Useful signals include repeated fixes, recurring review feedback, and adoption of a new library or pattern.

## Maister workflows

Use the matching `$maister-codex:maister-*` skill when the user explicitly requests a Maister workflow. Let `$maister-codex:maister-work` classify ambiguous engineering requests. Preserve workflow state and never roll back work without explicit approval.

At a required user decision gate, prefer `request_user_input` when available. Otherwise ask the equivalent concise question in the final response and pause. Use execution approval only for permission to perform a sensitive tool action, not as a substitute for a product or workflow decision.
```
