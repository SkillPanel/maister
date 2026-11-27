# Context Discovery — Prompt Templates

Put the task description in place of `[description]` word for word: every line, quote and backslash as the person typed it, never escaped and never wrapped in quotes.

## Bug
```
IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

Find testing and context information for the task below.

The task, exactly as the person wrote it, between the marker lines:
--- task ---
[description]
--- end of task ---

Focus on:
1. Find existing tests that cover this functionality
2. Look for test files that might help reproduce the bug
3. Identify test data or fixtures used
4. Find related integration or E2E tests
5. Check for any existing bug reports or TODOs in comments

Output:
- Relevant test files and what they test
- Test coverage gaps
- Reproduction hints from tests
- Related issues or TODOs found in code
```

## Enhancement
```
IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

Find dependencies and consumers of the code the task below changes.

The task, exactly as the person wrote it, between the marker lines:
--- task ---
[description]
--- end of task ---

Focus on:
1. Find all files that import/use this feature (consumers)
2. Identify what this feature depends on (dependencies)
3. Locate test files and assess coverage
4. Find API endpoints or routes related to this feature
5. Check for documentation or comments

Output:
- Consumer list (who uses this)
- Dependency list (what this uses)
- Test files and coverage assessment
- Integration points
```

## Feature
```
IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

Find integration requirements for the task below.

The task, exactly as the person wrote it, between the marker lines:
--- task ---
[description]
--- end of task ---

Focus on:
1. Identify where this feature needs to be registered/routed
2. Find existing integration patterns (how other features connect)
3. Look for shared dependencies this feature will need
4. Check for authentication/authorization patterns to follow
5. Find configuration or environment requirements

Output:
- Required integration points
- Patterns to follow for registration
- Shared dependencies to use
- Configuration requirements
```
