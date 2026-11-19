# File Discovery — Prompt Templates

Replace `[description]` with the actual task description.

## Bug
```
IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

Explore the codebase to find files related to: "[description]"

Focus on:
1. Find files where the bug likely occurs (search for error keywords, related functionality)
2. Trace the code path - entry points, handlers, processing logic
3. Look for related error handling, validation, edge cases
4. Find configuration files that might affect this behavior

Output a list of relevant files with their paths and why they're relevant.
Be thorough - check multiple naming conventions (PascalCase, kebab-case, snake_case).
```

## Enhancement
```
IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

Explore the codebase to find files that implement: "[description]"

Focus on:
1. Find the main files for this feature (components, services, controllers)
2. Look for related files (types, utilities, hooks, styles)
3. Check multiple naming patterns: *{keyword}*, {Domain}{Component}, etc.
4. Search in likely directories: src/components/, src/services/, src/features/

Output a ranked list of files with confidence indicators.
Include file paths, approximate line counts, and why each file is relevant.
```

## Feature
```
IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

Explore the codebase to find patterns and integration points for: "[description]"

Focus on:
1. Find similar existing features/components to use as templates
2. Identify where this new feature should live (directory structure)
3. Look for shared utilities, hooks, or base classes to extend
4. Find entry points where this feature needs to integrate (routes, menus, etc.)

List the files that serve as good examples or integration points.
Include reasoning for why each pattern/location is appropriate.
```
