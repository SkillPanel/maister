# Auto-Recovery

How intelligent failure handling and automatic recovery work in workflows.

> **Note**: Auto-recovery is implemented via the phase execution pattern. See
> `plugins/ai-sdlc/skills/orchestrator-framework/references/phase-execution-pattern.md` (STEP 5: Error Handling)

## Overview

Auto-recovery is the system's ability to automatically detect and fix common failures during workflow execution, reducing manual intervention and improving success rates.

**Key Principle**: Fix common, predictable errors automatically. **NEVER rollback or halt without user confirmation** - always analyze first, then ask user.

## How It Works

### Detection → Classification → Strategy → Retry

```
Error occurs
↓
Detect error type
↓
Classify (fixable vs not fixable)
↓
If fixable:
  Apply auto-fix strategy
  Retry phase execution
  Update attempt counter
↓
If not fixable OR max attempts exceeded:
  Persist state with failure details
  ANALYZE root cause
  ASK USER (try fix / rollback / investigate)
  Execute user's choice
```

## Auto-Fix Strategies by Error Type

### 1. Syntax Errors

**Detection**: Compilation/parsing errors

**Strategy**: Auto-correct common syntax mistakes

**Examples**:
- Missing semicolons → Add semicolons
- Mismatched brackets → Balance brackets
- Invalid indentation → Fix indentation

**Max Attempts**: 2

---

### 2. Missing Dependencies

**Detection**: Import errors, module not found

**Strategy**: Install missing dependency

**Examples**:
```bash
Error: Cannot find module 'lodash'
→ Auto-fix: npm install lodash
→ Retry
```

**Max Attempts**: 2

---

### 3. Linting Errors

**Detection**: ESLint, Prettier, or other linter errors

**Strategy**: Apply auto-fix from linter

**Examples**:
```bash
Error: 'variable' is assigned a value but never used
→ Auto-fix: eslint --fix
→ Retry
```

**Max Attempts**: 2

---

### 4. Test Failures (Transient)

**Detection**: Flaky tests, timing issues

**Strategy**: Re-run tests (limited retries)

**Examples**:
- Network timeouts
- Race conditions
- Non-deterministic tests

**Max Attempts**: 2 (then HALT - likely logic error)

---

### 5. Import Errors

**Detection**: Wrong import paths, missing imports

**Strategy**: Correct import paths

**Examples**:
```typescript
Error: Cannot find module './User'
→ Auto-fix: Change to './models/User'
→ Retry
```

**Max Attempts**: 2

---

### 6. Missing Standards

**Detection**: Standards compliance check fails

**Strategy**: Apply missing standards

**Examples**:
```
Error: Component missing error boundary
→ Auto-fix: Add error boundary
→ Retry verification
```

**Max Attempts**: 2

---

## Hard Stop Scenarios (User Confirmation Required)

Some errors cannot be auto-fixed - but **ALWAYS ask user before halting or rolling back**:

### 1. Test Failures (After 2 Retries)

**Reason**: Indicates logic error, not transient issue

**Action**:
1. ANALYZE root cause (config issue? test setup? actual logic error?)
2. ASK USER with AskUserQuestion: "Try suggested fix" / "Halt workflow" / "Let me investigate"
3. Execute user's choice

---

### 2. Behavior Changes (Refactoring)

**Reason**: Refactoring must preserve behavior exactly

**Action**:
1. ANALYZE the discrepancy (real behavior change? config/mock issue?)
2. ASK USER with AskUserQuestion: "Try suggested fix" / "Rollback changes" / "Let me investigate"
3. Execute user's choice (rollback only if user confirms)
4. **NEVER rollback automatically**

---

### 3. Security Vulnerabilities Introduced

**Reason**: Cannot automatically fix security issues safely

**Action**:
1. ANALYZE the vulnerability
2. ASK USER with AskUserQuestion: "Try suggested fix" / "Halt workflow" / "Let me investigate"
3. Execute user's choice

---

### 4. Breaking Changes (Enhancements)

**Reason**: Backward compatibility must be preserved

**Action**:
1. ANALYZE what broke and why
2. ASK USER with AskUserQuestion: "Try suggested fix" / "Halt workflow" / "Let me investigate"
3. Execute user's choice

---

### 5. Compilation Errors (After Auto-Fix)

**Reason**: Auto-fix didn't work, needs manual intervention

**Action**:
1. ANALYZE the compilation error
2. ASK USER with AskUserQuestion: "Try alternative fix" / "Halt workflow" / "Let me investigate"
3. Execute user's choice

---

## Auto-Recovery by Workflow Phase

### Specification Phase

**Max Attempts**: 2

**Auto-Fix Strategies**:
- Re-generate spec if verification fails
- Address over-engineering automatically
- Add missing sections

**Hard Stop**:
- Ambiguous requirements (need user clarification)
- Conflicting requirements

---

### Planning Phase

**Max Attempts**: 2

**Auto-Fix Strategies**:
- Regenerate plan if incomplete
- Fix incorrect dependencies
- Add missing task groups

**Hard Stop**:
- Invalid dependency graph (circular dependencies)

---

### Implementation Phase

**Max Attempts**: 5 (overall), 2 per error type

**Auto-Fix Strategies**:
- Fix syntax errors
- Add missing imports
- Install missing dependencies
- Apply linter fixes
- Apply missing standards

**Hard Stop**:
- Logic errors (test failures after 2 retries)
- Complex compilation errors

---

### Verification Phase

**Max Attempts**: 2

**Auto-Fix Strategies**:
- Fix failing tests (simple cases only)
- Generate missing documentation
- Re-run verification after fixes

**Hard Stop**:
- Persistent test failures (<90% pass rate)
- Missing critical functionality

---

## Attempt Tracking

Auto-fix attempts are tracked in `orchestrator-state.yml`:

```yaml
auto_fix_attempts:
  specification: 1
  planning: 0
  implementation: 3
  verification: 1
```

**Purpose**:
- Prevent infinite loops
- Know when to halt
- Track recovery history

---

## Failure Documentation

Failures are documented in state file:

```yaml
failures:
  - phase: implementation
    error: "Test failures: 5/50 tests failing"
    attempts: 2
    max_attempts: 2
    status: exhausted
    timestamp: 2025-11-17T14:30:00Z

  - phase: verification
    error: "Standards compliance: 3/5 standards missing"
    attempts: 1
    max_attempts: 2
    status: recovered
    recovery_action: "Applied missing standards"
    timestamp: 2025-11-17T15:00:00Z
```

**Benefits**:
- Audit trail of issues
- Resume intelligence (know what failed)
- Debugging information

---

## Resume After Failure

When resuming after auto-recovery exhaustion:

### Option 1: Reset Attempts

```bash
/ai-sdlc:feature:resume [path] --reset-attempts
```

**Effect**: Resets all attempt counters to 0, gives fresh attempts

**Use When**: You fixed the underlying issue manually

---

### Option 2: Clear Failures

```bash
/ai-sdlc:feature:resume [path] --clear-failures
```

**Effect**: Clears failure history

**Use When**: Failures are no longer relevant

---

### Option 3: Override Resume Point

```bash
/ai-sdlc:feature:resume [path] --from=implementation
```

**Effect**: Starts from specified phase, ignoring previous failures

**Use When**: Want to retry phase from scratch

---

## Auto-Recovery Best Practices

### For Plugin Developers

1. **Be Conservative**: Only auto-fix predictable, safe errors
2. **Limit Attempts**: Max 2-5 attempts to prevent loops
3. **Document Everything**: Track all attempts and failures
4. **NEVER Rollback Automatically**: Always analyze first, then ask user
5. **Provide Context**: Clear error messages with analysis for user decision
6. **Use AskUserQuestion**: Present options (try fix / rollback / investigate) for user to choose

### For Users

1. **Trust the System**: Auto-recovery handles common issues
2. **Check Logs**: Review work-log.md for recovery actions
3. **Manual Fix When Needed**: Some errors need human judgment
4. **Reset Attempts**: Use `--reset-attempts` after manual fixes
5. **Report Patterns**: If same error occurs repeatedly, report it

---

## Auto-Recovery Metrics

Track in verification reports:

```markdown
## Auto-Recovery Summary

**Specification Phase**: No issues
**Planning Phase**: No issues
**Implementation Phase**: 
  - 3 auto-fixes applied
    - Missing import (lodash) → Fixed (1 attempt)
    - Syntax error (missing semicolon) → Fixed (1 attempt)
    - Linting error → Fixed (1 attempt)

**Verification Phase**: No issues

**Total Auto-Fixes**: 3
**Success Rate**: 100% (3/3 recovered)
```

---

## Related Resources

- [State Management](state-management.md) - How state tracks recovery
- [Troubleshooting](../Troubleshooting.md) - Common recovery scenarios
- [Architecture](../Architecture.md) - Auto-recovery system design

---

**Auto-recovery improves success rates while maintaining safety and user control**

**Critical Principle**: NEVER rollback or halt without user confirmation. Always analyze the failure first, check for easy fixes, and ask user via AskUserQuestion before taking destructive actions.
