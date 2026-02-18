---
name: maister:reviews-reality-check
description: Comprehensive reality assessment of completed work to verify it actually works and is production-ready
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Task tool with subagent_type="maister:reality-assessor" NOW. Pass the task path in the prompt. Do not read files, explore code, or execute workflow steps yourself.

You are running a comprehensive reality check using the `reality-assessor` agent.

## Your Task

You are performing no-nonsense reality assessment to determine if completed work actually works and solves the business problem.

## Parse User Request

**Determine the following from the user's request:**

1. **Task path**:
   - If provided: Use the specified task directory path
   - If not provided: Use AskUserQuestion to ask for task path

## Your Instructions

**Invoke the reality-assessor agent NOW using the Task tool:**

```
Task Tool:
- subagent_type: reality-assessor
- description: Reality assessment
- prompt: |
    You are the reality-assessor agent. Assess the reality of completion for: [task-path]

    Your task:
    1. Load all available verification reports (implementation-verifier, pragmatic-review.md, code-review-report.md, spec-audit.md)
    2. Assess claimed completion (check implementation-plan.md markers, test results, verification status)
    3. Validate functional completeness:
       - Run tests yourself (don't trust reports)
       - Test end-to-end workflows (not just unit tests)
       - Try error scenarios (invalid inputs, edge cases, realistic data)
       - Test integration with dependent systems
       - Test under realistic conditions
    4. Identify reality gaps (functionality, quality, production readiness)
    5. Check integration points (data flow, API contracts, auth, external systems)
    6. Generate reality assessment report with clear deployment decision

    Save report to: verification/reality-check.md

    Focus on: Does this ACTUALLY work for intended purpose? Functional reality over technical perfection.

    Provide clear deployment decision: ✅ Ready | ⚠️ Issues Found | ❌ Not Ready
```

**Wait for the agent to complete before proceeding.**

The reality-assessor agent will:
1. Review all available verification reports
2. Validate claimed completions through independent testing
3. Test end-to-end functionality (not just isolated tests)
4. Identify gaps between claims and reality
5. Check integration with rest of system
6. Assess production readiness
7. Provide pragmatic action plan (if gaps exist)
8. Make clear GO/NO-GO deployment decision

## Examples

**Example 1**: Reality check before deployment
```
User: /maister:reviews-reality-check .maister/tasks/new-features/2025-11-17-payment-processing/
```

**Example 2**: Verify claimed completion
```
User: /maister:reviews-reality-check .maister/tasks/bug-fixes/2025-11-17-login-timeout/
```

**Example 3**: Production readiness check
```
User: /maister:reviews-reality-check .maister/tasks/enhancements/2025-11-17-user-dashboard/ --production
```

## What to Expect

The reality-assessor will provide:
- Reality vs claims gap analysis
- Critical gaps preventing deployment (Critical severity)
- Quality gaps affecting reliability (High/Medium severity)
- Integration issues with system components
- Functional completeness percentage assessment
- Pragmatic action plan with specific steps
- Clear deployment decision (✅ Ready | ⚠️ Issues | ❌ Not Ready)
- Evidence-based assessment (test results, error messages, observed behavior)

## Notes

- This is validation only - no code will be modified
- Runs actual tests and workflows, doesn't just read reports
- Tests with realistic data and scenarios
- Checks production configuration and deployment readiness
- Focus on: Does it ACTUALLY work and solve the problem?
- Severity levels guide deployment decision:
  - **Critical**: Must fix before deployment (prevents GO decision)
  - **High**: Should fix soon (allows conditional GO with monitoring)
  - **Medium**: Can deploy with known issues
  - **Low**: Minor issues, acceptable
