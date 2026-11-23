# Config Standards Analyzer — Scanner Brief

Analyze project configuration files to discover coding standards and conventions.

## Task

Find and analyze configuration files, extract standards, write the findings to the output file as YAML.

## Configuration Files to Analyze

1. **Formatter and linter configs**: `.eslintrc.*`, `eslint.config.*`, `.prettierrc*`, `biome.json`, `.editorconfig`, `pylintrc`, `.pylintrc`, `.rubocop.yml`, `ruff.toml`
2. **Compiler configs**: `tsconfig.json`, `jsconfig.json`
3. **Package managers**: `package.json` (scripts, conventions), `requirements.txt`, `Gemfile`, `pom.xml`, `go.mod`
4. **Container configs**: `Dockerfile`, `docker-compose.yml`
5. **Group configs**: for a group scope, the configs its `files:` line names (Terraform, `Chart.yaml`, `app.json`, `dbt_project.yml`)

## What to Extract

For each config file found, extract rules/settings that indicate coding standards:

- **Formatters and linters** (Prettier, ESLint, Biome, EditorConfig, Pylint, RuboCop, Ruff): one finding that names the commands that enforce them, as the project runs them — `npm run lint`, `prettier --check .`, `ruff check` — taken from `package.json` scripts, a Makefile, pre-commit hooks or CI. Each setting (quotes, semicolons, indentation, line length, line endings) is the tool's to enforce: record the commands, never one standard per setting.
- **TypeScript**: Compiler strictness (strict, noImplicitAny), module resolution, path aliases
- **Package.json**: Script patterns, testing conventions, pre-commit hooks (husky/lint-staged)

## Groups

Your prompt's `groups:` line lists the groups this project's standards use, each with its title, and any folder of the project's own. Begin each finding's `category` with the id of the group it fits, chosen by what the group's title says it holds, then `/` and the topic as before (`data/migrations`, `cli/output`), whether or not that folder exists yet. A finding that fits no listed group goes to `global` when it holds for all code, or names a new group in one word.

With a `files:` line, also read the configs it names, beside the formatter, linter and compiler configs above.

## Confidence Range

Config-based findings: **70-85%** confidence (explicit configuration = strong evidence).

## Output Format

Write this YAML to `[output_file]` (the `output_file` your prompt names):

```yaml
findings:
  - category: "[category/subcategory]"
    standard_name: "[Short Name]"
    description: "[What the standard requires]"
    confidence: [70-85]
    evidence:
      - "[config-file]: [specific rule or setting]"
    source: "config"
    examples:
      - "[Brief correct example if applicable]"
```

## Rules

- Only include findings with clear evidence from actual config files
- Be specific in descriptions (not "follow the TypeScript config" but "TypeScript runs in strict mode: no implicit any")
- Include exact file paths in evidence
- Write an empty findings list if no config files found
- Focus on actionable, verifiable standards
