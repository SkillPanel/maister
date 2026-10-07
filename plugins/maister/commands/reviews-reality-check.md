---
name: maister:reviews-reality-check
description: Comprehensive reality assessment of completed work to verify it actually works and is production-ready
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Task tool with subagent_type="maister:reality-assessor" NOW. Pass the task path in the prompt. Do not read files, explore code, or execute workflow steps yourself — beyond the quick target lookup below when no path is given.

You are running a comprehensive reality check using the `reality-assessor` agent.

## Your Task

You are performing no-nonsense reality assessment to determine if completed work actually works and solves the business problem.

## Parse User Request

**Determine the following from the user's request:**

1. **Task path**:
   - If provided: Use the specified task directory path
   - If not provided: ask once with generated targets — the newest folders under `.maister/tasks/`, nothing more. "Which task should the reality check assess?": "The latest task: <task name> (Recommended)" and the next two most recent tasks by name, each with its workflow type and date as the description. A typed path is the Other answer.

## Your Instructions

**Invoke the reality-assessor agent NOW using the Task tool:**

```
Task Tool:
- subagent_type: "maister:reality-assessor"
- description: Reality assessment
- prompt: |
    Assess completion reality for task: [task-path]
    Write the report to: [task-path]/verification/reality-check.md
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
User: /maister:reviews-reality-check .maister/tasks/development/2025-11-17-payment-processing/
```

**Example 2**: Verify claimed completion
```
User: /maister:reviews-reality-check .maister/tasks/development/2025-11-17-login-timeout/
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
