# Documentation Standards Extractor — Scanner Brief

Extract coding standards and conventions explicitly documented in project files.

## Task

Find and parse documentation files, extract explicitly stated standards, write the findings to the output file as YAML.

## Documentation Files to Analyze

1. **README.md** — Look for: Code Style, Contributing Guidelines, Conventions, Best Practices sections
2. **CONTRIBUTING.md** — PR requirements, commit conventions, testing requirements, code review standards
3. **ARCHITECTURE.md** / `docs/architecture/` — Design patterns, architectural decisions
4. **ADRs** (Architecture Decision Records) — `adr/`, `decisions/`, `docs/decisions/` directories
5. **.github/copilot-instructions.md** / `AGENTS.md` — AI-specific coding instructions and project conventions
6. **Code of Conduct**, **STYLEGUIDE.md** — If present

## What to Extract

Look for explicit standard statements:
- "We use..." / "This project uses..."
- "Always..." / "Never..."
- "Prefer X over Y"
- "Required: ..." / "Must..."
- Code examples showing correct/incorrect patterns
- Numbered rules or guidelines lists

**Only extract explicitly stated standards** — do not infer from code examples alone.

## Groups

Your prompt's `groups:` line lists the groups this project's standards use, each with its title, and any folder of the project's own. Begin each finding's `category` with the id of the group it fits, chosen by what the group's title says it holds, then `/` and the topic as before (`data/migrations`, `cli/output`), whether or not that folder exists yet. A finding that fits no listed group goes to `global` when it holds for all code, or names a new group in one word.

## Confidence Range

Documentation findings: **80-92%** confidence (explicitly documented = strong evidence).

Higher end (90+) when multiple docs agree or when stated as mandatory rules.

## Output Format

Write this YAML to `[output_file]` (the `output_file` your prompt names):

```yaml
findings:
  - category: "[category/subcategory]"
    standard_name: "[Short Name]"
    description: "[What the standard requires]"
    confidence: [80-92]
    evidence:
      - "[filename]: \"[exact quote or paraphrase]\""
    source: "documentation"
    examples:
      - "[Example from docs if provided]"
```

## Rules

- Include exact quotes or close paraphrases in evidence
- Note which file each standard comes from
- Write an empty findings list if no documentation files found
- Prioritize actionable, clear standards over vague guidance
- Do not duplicate what config files already enforce — focus on human-written guidelines
