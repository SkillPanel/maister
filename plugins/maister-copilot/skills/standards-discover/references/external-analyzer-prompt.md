# External Standards Analyzer — Subagent Prompt Template

Analyze pull requests, CI/CD configurations, and pre-commit hooks to discover enforced standards.

## Task

Mine external sources for standards evidence, return findings as YAML.

## Sources to Analyze

### 1. Pull Requests (via gh CLI)

**First check availability:**
```bash
which gh && gh auth status
```

If gh CLI available:
- Get last `[pr_count]` merged PRs: `gh pr list --state merged --limit [pr_count] --json number,title`
- For each PR, check review comments for repeated feedback patterns
- Look for: "Please use...", "Always...", "Avoid...", "Per our convention...", "Style:", "Nit:"
- Only report patterns that appear in **3+ different PRs** (significant feedback, not one-off)

If gh CLI unavailable: skip PR analysis, note in output, not an error.

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
github_available: true  # or false
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

- Handle gh CLI gracefully — return `github_available: false` and empty PR findings, not error
- Only report PR patterns appearing in 3+ different PRs
- For CI/CD: extract specific thresholds and rules, not just "runs tests"
- Return empty findings list if no external sources available
- Be specific: "80% coverage required" not "has coverage check"
