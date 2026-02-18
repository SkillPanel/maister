---
name: maister:reviews-spec-audit
description: Independent specification audit to verify completeness and clarity before implementation
---

**ACTION REQUIRED**: This command delegates to a different skill. The `<command-name>` tag refers to THIS command, not the target. Call the Task tool with subagent_type="maister:spec-auditor" NOW. Pass the spec path in the prompt. Do not read files, explore code, or execute workflow steps yourself.

You are running an independent specification audit using the `spec-auditor` agent.

## Your Task

You are performing senior auditor review of specifications to verify completeness, clarity, and implementability.

## Parse User Request

**Determine the following from the user's request:**

1. **Specification path**:
   - If provided: Use the specified spec file path
   - If not provided: Use AskUserQuestion to ask for spec.md path

2. **Audit type**:
   - **Pre-implementation**: Audit spec before building (default)
   - **Post-implementation**: Audit spec vs actual implementation (if implementation exists)

## Your Instructions

**Invoke the spec-auditor agent NOW using the Task tool:**

```
Task Tool:
- subagent_type: spec-auditor
- description: Specification audit
- prompt: |
    You are the spec-auditor agent. Audit the specification at: [spec-path]

    Your task:
    1. Read and comprehend the specification thoroughly
    2. [If pre-implementation]: Identify ambiguities, missing details, unclear sections
    3. [If post-implementation]: Examine actual implementation independently
    4. [If post-implementation]: Compare specification vs implementation
    5. Categorize gaps (Missing/Incomplete/Incorrect/Extra/Ambiguous)
    6. Assign severity to each finding (Critical/High/Medium/Low)
    7. Request clarification for ambiguous specifications
    8. Generate comprehensive audit report

    [If post-implementation]:
    - Use az CLI to verify Azure resources if applicable
    - Use gh CLI to verify GitHub integration if applicable
    - Examine codebase, database schemas, API endpoints, configurations
    - Trust nothing, verify everything independently

    Save report to: verification/spec-audit.md

    Focus on: Evidence-based assessment. Every finding must have file:line references or clear evidence.
```

**Wait for the agent to complete before proceeding.**

The spec-auditor agent will:
1. Thoroughly read and understand specification
2. Identify ambiguities, unclear sections, missing details
3. (If post-impl) Independently examine actual implementation
4. (If post-impl) Compare specification vs implementation using external tools
5. Categorize gaps with evidence
6. Assign severity with justification
7. Ask clarifying questions for ambiguities
8. Provide recommendations for compliance

## Examples

**Example 1**: Pre-implementation spec audit
```
User: /maister:reviews-spec-audit .maister/tasks/new-features/2025-11-17-user-auth/implementation/spec.md
```

**Example 2**: Post-implementation audit
```
User: /maister:reviews-spec-audit .maister/tasks/new-features/2025-11-17-user-auth/ --post-implementation
```

**Example 3**: Audit with clarification focus
```
User: /maister:reviews-spec-audit spec.md --focus=ambiguity
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
