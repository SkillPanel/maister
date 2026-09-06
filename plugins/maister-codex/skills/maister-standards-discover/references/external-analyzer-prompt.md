# External Standards Analyzer — Subagent Prompt Template

Analyze pull requests, CI/CD configurations, and pre-commit hooks to discover enforced standards.

## Task

Mine external sources for standards evidence, return findings as YAML.

## Sources to Analyze

### 1. Pull Requests (via gh CLI)

Honor original user exclusions supplied by the caller: if PRs are user-excluded, record that instruction and omit PR access checks. A caller's unsupported scope reduction does not count as a user exclusion. Otherwise **first check availability and, when installed, authentication:**
```bash
command -v gh && gh auth status
```

Record command outcomes and sanitized evidence without credentials. If gh is installed and authenticated:
- Get last `[pr_count]` merged PRs: `gh pr list --state merged --limit [pr_count] --json number,title`
- For each PR, check review comments for repeated feedback patterns
- Record the PR query and review evidence inspected; authentication alone is not PR discovery. A successful query returning no PRs is inspected with no findings.
- Look for: "Please use...", "Always...", "Avoid...", "Per our convention...", "Style:", "Nit:"
- Only report patterns that appear in **3+ different PRs** (significant feedback, not one-off)

If gh is missing, authentication fails, or repository/API access fails: record PR history as unavailable with the observed command failure and reason. Do not label an unattempted check unavailable, install/authenticate automatically, or repeatedly request permission for the same limitation. If access fails after partial inspection, retain inspected evidence and identify the remaining coverage limitation.

### 2. CI/CD Workflows

- **GitHub Actions**: `.github/workflows/*.yml`
- **GitLab CI**: `.gitlab-ci.yml`
- **Other**: `Jenkinsfile`, `.circleci/config.yml`, `.travis.yml`

Extract: lint steps, test requirements, coverage thresholds, build quality gates, pre-deployment checks.

### 3. Pre-commit Hooks

- **Husky**: `.husky/` directory (pre-commit, pre-push scripts)
- **pre-commit framework**: `.pre-commit-config.yaml`
- **lint-staged**: `lint-staged` config in `package.json` or `.lintstagedrc`

Extract: mandatory checks, formatting enforcement, commit message validation.

## Confidence Ranges

| Source | Confidence Range | Rationale |
|--------|-----------------|-----------|
| CI/CD enforced standards | 85-95% | Enforced by automation — very reliable |
| Pre-commit hooks | 80-90% | Actively enforced on every commit |
| PR review patterns (5+ PRs) | 70-80% | Strong team consensus |
| PR review patterns (3-4 PRs) | 60-70% | Emerging pattern |

## Output Format

Return YAML:

```yaml
github_available: true  # false for observed access failure; null if user-excluded
sources:
  - source: "pr-history"  # also return separate ci-cd and pre-commit rows
    disposition: "inspected"  # user-excluded or unavailable; pending if unsupported
    reason: "[coverage achieved, original user exclusion, or observed failure]"
    evidence:
      - "[command and outcome / inspected file / original user instruction reference]"
findings:
  - category: "[category/subcategory]"
    standard_name: "[Short Name]"
    description: "[What the standard requires]"
    confidence: [60-95]
    evidence:
      - "[source]: [specific evidence]"
    source: "[pr-reviews|ci-config|pre-commit]"
    examples: []
```

## Rules

- Handle gh CLI failures gracefully — return `github_available: false`, the unavailable source row with observed evidence, and any findings already supported by partial inspection
- Only report PR patterns appearing in 3+ different PRs
- For CI/CD: extract specific thresholds and rules, not just "runs tests"
- Return empty findings list if no external sources available
- Be specific: "80% coverage required" not "has coverage check"
- Do NOT write any files to the project directory. Write your YAML results to: `[output_file]` (the orchestrator replaces this placeholder with an actual temp file path when invoking you).
