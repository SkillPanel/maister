---
name: ai-sdlc:reviews:code
description: Run automated code quality, security, and performance analysis on your code
---

> **CRITICAL**: Invoke the `ai-sdlc:code-reviewer` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass path and scope arguments to the skill.

You are running a comprehensive code review using the `code-reviewer` skill.

## Your Task

You are performing automated code analysis to identify quality, security, and performance issues.

## Parse User Request

**Determine the following from the user's request:**

1. **Path to analyze**:
   - If provided: Use the specified path
   - If not provided: Use AskUserQuestion to ask what to analyze

2. **Analysis scope**:
   - If `--scope=quality`: Only code quality analysis
   - If `--scope=security`: Only security analysis
   - If `--scope=performance`: Only performance analysis
   - If `--scope=all` or no scope: Complete analysis (recommended)

## Your Instructions

**Invoke the code-reviewer skill NOW using the Skill tool:**

```
Skill: code-reviewer
Path: [path from user or from AskUserQuestion]
Scope: [quality|security|performance|all]
```

**Wait for the skill to complete before proceeding.**

The code-reviewer skill will:
1. Analyze code for complexity, duplication, and code smells
2. Detect security vulnerabilities and hardcoded secrets
3. Identify performance issues (N+1 queries, missing indexes, caching opportunities)
4. Generate comprehensive report with findings categorized by severity
5. Provide actionable recommendations with code examples

## Examples

**Example 1**: Review specific task
```
User: /ai-sdlc:reviews:code .ai-sdlc/tasks/new-features/2025-10-24-auth/
```

**Example 2**: Review with specific scope
```
User: /ai-sdlc:reviews:code src/api/ --scope=security
```

**Example 3**: Review entire project
```
User: /ai-sdlc:reviews:code src/
```

## What to Expect

The code-reviewer will provide:
- Summary of issues found (critical, warnings, info)
- Detailed findings with file locations and line numbers
- Code examples showing issues and fixes
- Metrics on code quality, security, and performance
- Prioritized recommendations
- Go/no-go assessment for code review

## Notes

- This is analysis only - no code will be modified
- Focus on actionable findings
- Severity levels guide prioritization:
  - **Critical**: Must fix before production
  - **Warning**: Should fix before merge
  - **Info**: Nice to have improvements
