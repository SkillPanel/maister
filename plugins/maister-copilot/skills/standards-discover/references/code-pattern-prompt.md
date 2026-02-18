# Code Pattern Analyzer — Subagent Prompt Template

Analyze source code patterns to discover coding conventions and standards used in the project.

## Task

Sample code files, detect consistent patterns in naming/imports/structure, return findings as YAML.

## Sampling Strategy

For performance, sample rather than exhaustive analysis:

- **Frontend files**: Sample up to 50 files (`*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.vue`, `*.svelte`)
- **Backend files**: Sample up to 50 files (`*.py`, `*.rb`, `*.java`, `*.go`, `*.rs`)
- **Test files**: Sample up to 30 files (`*.test.*`, `*.spec.*`, `*_test.*`)

Use Glob to find files, then Read a representative sample from different directories.

## Patterns to Detect

1. **File Naming**: PascalCase, kebab-case, snake_case, camelCase — calculate consistency %
2. **Import Patterns**: Absolute vs relative, path aliases (`@/`), import grouping/sorting
3. **Error Handling**: try/catch usage, custom error classes, error wrapping, logging patterns
4. **Component Structure** (frontend): Functional vs class components, hooks usage, props patterns
5. **API Patterns** (backend): Endpoint naming, resource naming (plural/singular), versioning
6. **Function Style**: Arrow functions vs declarations, async/await vs promises
7. **Type Patterns**: TypeScript strictness, type vs interface usage, generics patterns

## Consistency Threshold

Only report patterns with **>= 60% consistency** across sampled files.

Calculate: `(files following pattern / total files sampled) * 100`

## Categorization

Discover existing categories from `.maister/docs/standards/*/`. Baseline categories: `global/`, `frontend/`, `backend/`, `testing/`. Propose new categories if patterns don't fit existing ones.

## Confidence Range

Code pattern findings: **60-88%** confidence. Higher when consistency is >= 90%.

## Output Format

Return YAML:

```yaml
findings:
  - category: "[category/subcategory]"
    standard_name: "[Short Name]"
    description: "[What the convention is]"
    confidence: [60-88]
    evidence:
      - "[X] of [Y] files follow this pattern"
      - "Examples: [file1], [file2], [file3]"
    source: "code-patterns"
    examples:
      - "[Correct pattern example]"
```

## Rules

- Sample files randomly across directories for representative results
- Report file counts in evidence (e.g., "247 of 250 .tsx files use PascalCase")
- Only report patterns with >= 60% consistency
- Return empty findings list if no clear patterns emerge
- Focus on actionable, consistent patterns — not one-off occurrences
