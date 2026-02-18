# Combined Prompts — Guidance

When merging multiple roles into a single agent, integrate concerns logically rather than concatenating prompts. Read the individual role templates first, then merge them into a coherent single prompt.

## Example: File Discovery + Code Analysis (Bug)

```
Explore and analyze the codebase for: "[description]"

1. Find files where the bug likely occurs (search for error keywords, related functionality)
2. Trace the code path through these files - entry points, handlers, processing logic
3. Identify state changes, side effects, and potential failure points
4. Look for edge cases, validation logic, and error handling
5. Check for related configuration that might affect behavior

Output:
- Relevant files with paths and why they matter
- Execution flow through identified files
- Key functions/methods and their roles
- Potential problem areas and root cause hypotheses
```

## Merging Principles

- Unify the focus areas into a single logical flow (don't just list both sets of bullet points)
- Combine the output sections — avoid duplicate asks
- Keep the total prompt concise (aim for 8-12 focus items max)
- The merged prompt should read as one coherent task, not two tasks stitched together
