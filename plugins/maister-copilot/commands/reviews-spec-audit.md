---
name: reviews-spec-audit
description: Independent specification audit to verify completeness and clarity before implementation
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Task tool with subagent_type="maister-copilot:spec-auditor" NOW. Pass the spec path in the prompt. Do not read files, explore code, or execute workflow steps yourself — beyond the quick target lookup below when no path is given.

You are running an independent specification audit using the `spec-auditor` agent.

## Your Task

You are performing senior auditor review of specifications to verify completeness, clarity, and implementability.

## Parse User Request

**Determine the following from the user's request:**

1. **Specification path**:
   - If provided: Use the specified spec file path
   - If not provided: find the most recently changed `spec.md` under `.maister/tasks/` and ask once: "Audit the specification of <task name>?": "Audit this spec (Recommended)" with its path as the description, then up to two older specs by task name. A typed path is the Other answer. With no `spec.md` found, ask for the path in the question.

2. **Audit type**:
   Audit type: post-implementation when --post-implementation is passed or an implementation exists next to the spec; otherwise pre-implementation.

## Your Instructions

**Invoke the spec-auditor agent NOW using the Task tool:**

```
Task Tool:
- subagent_type: "maister-copilot:spec-auditor"
- description: Specification audit
- prompt: |
    Audit the specification at: [spec-path]
    Mode: [pre-implementation|post-implementation]
    Write the report to: [task dir]/verification/spec-audit.md
    List open ambiguities as questions in the report.
```

**Wait for the agent to complete before proceeding.**

The spec-auditor agent will:
1. Thoroughly read and understand specification
2. Identify ambiguities, unclear sections, missing details
3. (If post-impl) Independently examine actual implementation
4. (If post-impl) Compare specification vs implementation using external tools
5. Categorize gaps with evidence
6. Assign severity with justification
7. List clarifying questions for ambiguities in the report
8. Provide recommendations for compliance

## Examples

**Example 1**: Pre-implementation spec audit
```
User: /maister-copilot:reviews-spec-audit .maister/tasks/development/2025-11-17-user-auth/implementation/spec.md
```

**Example 2**: Post-implementation audit
```
User: /maister-copilot:reviews-spec-audit .maister/tasks/development/2025-11-17-user-auth/ --post-implementation
```

## What to Expect

The spec-auditor will provide:
- Specification completeness assessment
- Ambiguities and unclear sections identified
- (If post-impl) Gaps between spec and implementation (Missing/Incomplete/Incorrect/Extra)
- All findings with evidence (file:line references or absence proof)
- Severity assessment (Critical/High/Medium/Low)
- Clarification questions for stakeholders
- Compliance status (✅ Compliant | ⚠️ Mostly Compliant | ❌ Non-Compliant)
- Specific recommendations for each finding

## Notes

- This is analysis only - no code or specs will be modified
- Senior auditor perspective: healthy skepticism, verify independently
- Uses external tools (az CLI, gh CLI) for deployment verification
- Focus on functional reality, not theoretical compliance
- Severity levels guide prioritization:
  - **Critical**: Breaks core functionality, blocks deployment
  - **High**: Important feature missing/incorrect
  - **Medium**: Nice-to-have missing, workarounds exist
  - **Low**: Minor discrepancy, low user impact
