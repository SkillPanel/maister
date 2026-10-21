# INDEX.md Template

The shape Refresh INDEX.md writes `.maister/docs/INDEX.md` in. Sections follow the directory as it is — never a hardcoded file list — and each entry follows the entry rules in `SKILL.md` (Refresh INDEX.md): a heading naming the document and its path, then one or two sentences on what it is for and when to open it. An entry never holds the document's content.

```markdown
<!-- Maintained by maister: edit the source documents, not this file. -->
# Documentation Index

A map of this project's documentation: one entry per file, saying what it is for and when to open it. Open the files themselves; an entry never holds their content.

## Project documentation

### Vision (`project/vision.md`)
[What question it answers]. Open when [the situation that needs it].

### Tech Stack (`project/tech-stack.md`)
[What question it answers]. Open when [the situation that needs it].

## Project documentation: [folder]

### [Title] (`[folder]/[file].md`)
[What question it answers]. Open when [the situation that needs it].

## Standards: [folder]

### [Title] (`standards/[folder]/[file].md`)
[What code or task it governs]. Read in full before: [topic], [topic], [topic].

[... one Standards section per folder under standards/, sub-folders included ...]
```

- **Project documentation** sections hold every document outside `standards/`: `project/` and the top-level files under "Project documentation", then one "Project documentation: <folder>" section per other folder. The workflows' intake reads its project documents from these sections.
- **Standards** sections run one per folder, `standards/backend/storage/` apart from `standards/backend/`.
- **Header comment and intro** stay as written. No "how to use" or "how to update" guidance goes in the index: it is imported into every session, and the only thing that updates it is a refresh.
