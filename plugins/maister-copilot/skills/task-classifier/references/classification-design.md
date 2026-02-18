# Task Classification Design Guide

**Design documentation** for developers extending classification methodology. Runtime logic is embedded in `agents/task-classifier.md` for path-independence.

---

## Classification Priority

When multiple types match:
1. **Keyword count** - Type with most matches wins
2. **Context analysis** - Component found, error verified
3. **User confirmation** - If still ambiguous, ask user

---

## Task Type Patterns

### Bug Fix

| Category | Keywords |
|----------|----------|
| **Primary** | fix, bug, broken, error, crash, defect, regression |
| **Error indicators** | timeout, exception, null pointer, stack trace, fails |
| **State** | incorrect behavior, wrong output, unexpected result |

**Context boosters** (+10% each): Error found in code, stack trace matches files, issue labeled "bug"

### Enhancement (Requires "existing" context)

| Category | Keywords |
|----------|----------|
| **Primary** | improve, enhance, better, upgrade existing, extend existing |
| **Quality** | optimize existing, refine, polish, strengthen |
| **Scope** | expand existing, add feature to, more features for |

**Disambiguation**: If component NOT found in codebase → reclassify as new-feature

### New Feature

| Category | Keywords |
|----------|----------|
| **Creation** | add new, create, build, implement new, introduce |
| **Feature** | feature, functionality, capability, capability |
| **System** | system, module, component (when new) |

**Disambiguation**: If component FOUND in codebase → reclassify as enhancement

### Performance

| Category | Keywords |
|----------|----------|
| **Speed** | slow, optimize, speed up, faster, latency |
| **Efficiency** | memory usage, CPU, bottleneck, efficient |
| **Scaling** | scale, throughput, load, concurrent |

### Migration

| Category | Keywords |
|----------|----------|
| **Move** | migrate, move from X to Y, transition, switch to |
| **Upgrade** | upgrade from, update from, replace X with Y |
| **Platform** | new platform, new framework, new database |

### Research

| Category | Keywords |
|----------|----------|
| **Investigate** | research, investigate, explore, analyze |
| **Compare** | compare options, evaluate alternatives |
| **Document** | document findings, spike, proof of concept |

---

## Confidence Calculation

| Confidence | Meaning | User Flow |
|------------|---------|-----------|
| **80-94%** | High | Quick confirmation with override |
| **60-79%** | Medium | Show classification, ask to confirm |
| **<60%** | Low | Present all options, user chooses |

### Base Formula

```
Base: 50%
3+ primary keywords: +30%
2 primary keywords: +25%
1 primary keyword: +15%
Each context booster: +10%
Issue labels match: +5%
Cap at 94%
```

---

## Context Analysis

### Codebase Search (Enhancement vs New-Feature)

1. Extract component nouns from description
2. Search codebase for existing files/classes
3. If found → Enhancement (improving existing)
4. If not found → New Feature (creating new)

### Error Verification (Bug Fix)

1. Extract error patterns from description
2. Search codebase for matching errors
3. If found → Boost bug-fix confidence +10%
4. If not found → May still be bug (runtime error)

### Git History

1. Check recent commits for related changes
2. If recent fix → May be regression
3. If recent feature → May be enhancement to new code

---

## Issue Integration

### Detection Patterns

| Source | Pattern | Tool |
|--------|---------|------|
| GitHub short | `#123`, `GH-123` | mcp__github |
| GitHub URL | `github.com/.../issues/` | mcp__github |
| Jira ticket | `PROJ-456` | mcp__jira |
| Jira URL | `atlassian.net/browse/` | mcp__jira |
| Generic | Other URLs | WebFetch |

### Label Mapping

| Issue Label | Task Type | Confidence Boost |
|-------------|-----------|-----------------|
| bug, defect | bug-fix | +10% |
| enhancement | enhancement | +10% |
| feature | new-feature | +10% |
| performance | performance | +10% |

---

## Special Cases

### Compound Tasks

If multiple distinct tasks detected:
- Suggest splitting into separate tasks
- Ask user which to work on first
- Route to appropriate orchestrator

### Vague Descriptions

If <60% confidence on any type:
- Request clarification
- Ask specific questions about intent
- Present all 6 options

