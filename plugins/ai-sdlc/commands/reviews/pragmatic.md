---
name: maister:reviews-pragmatic
description: Run pragmatic code review to detect over-engineering and ensure code matches project scale
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Task tool with subagent_type="maister:code-quality-pragmatist" NOW. Pass the path to analyze in the prompt. Do not read files, explore code, or execute workflow steps yourself.

You are running a pragmatic code review using the `code-quality-pragmatist` agent.

## Your Task

You are performing pragmatic analysis to identify over-engineering, unnecessary complexity, and developer experience issues.

## Parse User Request

**Determine the following from the user's request:**

1. **Path to analyze**:
   - If provided: Use the specified path
   - If not provided: Use AskUserQuestion to ask what to analyze (file, directory, or task path)

## Your Instructions

**Invoke the code-quality-pragmatist agent NOW using the Task tool:**

```
Task Tool:
- subagent_type: code-quality-pragmatist
- description: Pragmatic code review
- prompt: |
    You are the code-quality-pragmatist agent. Review the code at: [path]

    Your task:
    1. Assess overall complexity relative to project scale (check .maister/docs/project/ for scale)
    2. Detect over-engineering patterns (infrastructure overkill, excessive abstraction, enterprise patterns in simple code)
    3. Assess developer experience (setup complexity, feedback loops, error messages, consistency)
    4. Verify requirements alignment (if spec.md available, compare implementation to requirements)
    5. Recommend specific simplifications with before/after examples
    6. Prioritize top 3 changes with highest impact

    Generate comprehensive pragmatic review report.
    Save to: verification/pragmatic-review.md

    Focus on: Simple solutions for simple problems. Code should match project needs, not theoretical best practices.
```

**Wait for the agent to complete before proceeding.**

The code-quality-pragmatist agent will:
1. Assess complexity relative to project scale (MVP vs Enterprise)
2. Detect over-engineering (Redis in MVP, excessive layers, premature optimization)
3. Identify developer experience friction points
4. Compare implementation to requirements (if spec available)
5. Recommend concrete simplifications with impact estimates
6. Provide top 3 priority actions

## Examples

**Example 1**: Review specific feature
```
User: /maister:reviews-pragmatic .maister/tasks/new-features/2025-11-17-user-management/
```

**Example 2**: Review source directory
```
User: /maister:reviews-pragmatic src/features/payments/
```

**Example 3**: Review specific file
```
User: /maister:reviews-pragmatic src/services/cache-service.ts
```

## What to Expect

The code-quality-pragmatist will provide:
- Complexity assessment (Low/Medium/High) relative to project scale
- Over-engineering patterns with severity (Critical/High/Medium/Low)
- Developer experience issues and friction points
- Requirements alignment assessment
- Concrete simplification recommendations with before/after examples
- Top 3 priority actions with estimated impact
- Summary statistics (LOC reduction potential, dependencies removable)

## Notes

- This is analysis only - no code will be modified
- Focus on pragmatism: appropriate complexity for actual needs
- Identifies unnecessary infrastructure, abstractions, and patterns
- Severity levels guide prioritization:
  - **Critical**: Severe over-engineering blocking development
  - **High**: Significant unnecessary complexity
  - **Medium**: Moderate complexity issues
  - **Low**: Minor improvements
