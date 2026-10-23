# .github/copilot-instructions.md Documentation Section Template

Add this section to the project's `.github/copilot-instructions.md` file. Place it prominently near the top. Verify the INDEX.md path is correct and the file exists before adding.

```markdown
## Project Documentation & Standards

Before writing or changing any code — even for quick, direct requests that don't go through a `/maister-copilot:*` workflow — ground yourself in the project's documentation:

1. Read @.maister/docs/INDEX.md to see what's documented. It is the map to everything the team maintains — coding standards by domain, project vision/tech-stack/architecture, and any other project knowledge (business domain, glossaries, decisions, etc.).
2. Then open and read the specific files it points to that are relevant to your task — standards AND any project/domain docs. The index alone is not enough.
3. Follow the standards as you work (they represent team decisions; if one conflicts with the task, ask the user) and use the project docs as context.
4. Never edit INDEX.md: it is maintained by maister. Change the source document instead, and say which documents you changed.

### Standards Evolution

When the work shows something the next change should know — a convention, a pitfall met, an important fact about the code — that no standard or project document holds yet, suggest it in one line: the rule, why it matters, where it applies. Prefer nothing over restating an existing standard or something true only for this change; a decision or a fact about the system belongs in a project document under `.maister/docs/project/`. When the user agrees, run `/maister-copilot:standards-update` with it — it asks where to put it, so do not ask again first.

## Maister Workflows

This project uses the maister plugin for structured development workflows. When any `/maister-copilot:*` command is invoked, execute it via the Skill tool immediately — do not skip workflows for "straightforward" tasks. The user chose the workflow intentionally; complexity assessment is the workflow's job.
```
