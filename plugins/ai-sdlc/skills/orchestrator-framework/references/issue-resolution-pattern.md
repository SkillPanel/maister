# Issue Resolution Pattern

Pattern for resolving issues detected during verification phases. Use after any verification skill/agent that returns structured issues.

## When to Apply

After verification phases that return structured issues:
- `implementation-verifier` → development workflows
- `implementation-verifier` → performance workflows

## Core Principle

**Don't just report issues—resolve them.** Verification that only generates reports leaves issues unaddressed. This pattern creates a fix-then-reverify loop.

## Process

```
1. Read verification results (structured issues)
2. For each issue, reason about how to handle:
   - Trivial/auto-fixable → Fix silently, log action
   - Non-trivial → Use AskUserQuestion for user decision
3. If any fixes applied → Set skip_test_suite: false (code changed, tests must re-run) → Re-run verification
4. Loop until: passes OR user proceeds with known issues OR max iterations
```

## State Schema

Add to orchestrator's domain context:

```yaml
verification_context:
  last_status: passed | passed_with_issues | failed | null
  issues_found: []           # Issue summaries from verifier
  fixes_applied: []          # What was auto-fixed
  decisions_made: []         # User decisions on non-trivial issues
  reverify_count: 0          # Current iteration (max 3)

# Note: If orchestrator sets skip_test_suite: true for initial verification
# (test suite already passed during implementation), clear it to false
# before re-verification since code has changed after fixes.
```

## Fixability Assessment

Trust agent reasoning. General guidelines:

| Likely Fixable | Likely Not Fixable |
|----------------|-------------------|
| Lint errors | Architecture decisions |
| Formatting issues | Design trade-offs |
| Missing imports | Test logic errors |
| Obvious typos | Unclear requirements |
| Simple config fixes | Performance tuning choices |

## AskUserQuestion Pattern

For non-trivial issues:

```
Use AskUserQuestion tool:
  Question: "[Issue description] - How would you like to handle this?"
  Header: "[Issue source]"
  Options:
  1. "Try suggested fix" - If suggestion available
  2. "Skip this issue" - Proceed without fixing
  3. "Let me investigate" - Pause for manual investigation
```

## Exit Conditions

| Condition | Action |
|-----------|--------|
| Verification passes | Proceed to next phase |
| User chooses "Proceed with known issues" | Proceed with warning logged |
| Max iterations (3) reached | Ask user how to proceed |

## Logging

Log all actions to work-log.md:
- Issues detected (count, severity breakdown)
- Auto-fixes applied (what and how)
- User decisions for non-trivial issues
- Re-verification results

## Phase Flow Integration

Issue Resolution phases use `⚡ AUTO` continuation from their parent verification phase (since they handle their own user interaction).

```
Phase N (Verification) → ⚡ AUTO → Phase N.5 (Issue Resolution) → 🚦 GATE → Phase N+1
```

## Adaptation Notes

Each orchestrator adapts this pattern for its domain:

| Orchestrator | Verifier | Typical Fixable Issues |
|--------------|----------|----------------------|
| Development | implementation-verifier | Lint, formatting, missing tests |
| Performance | implementation-verifier | Cache settings, query optimization |
