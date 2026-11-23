# Code Pattern Analyzer — Scanner Brief

Analyze source code patterns to discover coding conventions and standards used in the project.

## Task

Sample code files, detect consistent patterns in naming/imports/structure, write the findings to the output file as YAML.

## Sampling Strategy

For performance, sample rather than exhaustive analysis:

- **With a `files:` line**: sample up to 50 of the files it names
- **Otherwise**, sample as follows:
  - **Frontend files**: Sample up to 50 files (`*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.vue`, `*.svelte`)
  - **Backend files**: Sample up to 50 files (`*.py`, `*.rb`, `*.java`, `*.go`, `*.rs`)
  - **Test files**: Sample up to 30 files (`*.test.*`, `*.spec.*`, `*_test.*`)
  - **Also, wherever the repository has them**, up to 20 each of command entry modules, migrations and `*.sql`, `ios/` and `android/` sources, job and DAG modules, and `*.tf` and manifest files

## Patterns to Detect

1. **File Naming**: PascalCase, kebab-case, snake_case, camelCase — calculate consistency %
2. **Import Patterns**: Absolute vs relative, path aliases (`@/`), import grouping/sorting
3. **Error Handling**: try/catch usage, custom error classes, error wrapping, logging patterns
4. **Component Structure** (frontend): Functional vs class components, hooks usage, props patterns
5. **API Patterns** (backend): Endpoint naming, resource naming (plural/singular), versioning
6. **Function Style**: Arrow functions vs declarations, async/await vs promises
7. **Type Patterns**: TypeScript strictness, type vs interface usage, generics patterns
8. Command output (cli): stdout against stderr, exit codes; migrations (data): one change per file, naming

## Consistency Threshold

Only report patterns with **>= 60% consistency** across sampled files.

Calculate: `(files following pattern / total files sampled) * 100`

## Groups

Your prompt's `groups:` line lists the groups this project's standards use, each with its title, and any folder of the project's own. Begin each finding's `category` with the id of the group it fits, chosen by what the group's title says it holds, then `/` and the topic as before (`data/migrations`, `cli/output`), whether or not that folder exists yet. A finding that fits no listed group goes to `global` when it holds for all code, or names a new group in one word.

With a `files:` line, read only the files it names.

## Confidence Range

Code pattern findings: **60-88%** confidence. Higher when consistency is >= 90%.

## Output Format

Write this YAML to `[output_file]` (the `output_file` your prompt names):

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
- Write an empty findings list if no clear patterns emerge
- Focus on actionable, consistent patterns — not one-off occurrences
