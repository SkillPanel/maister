# Migration Target — Prompt Template

Primarily for migrations. Put the task description in place of `[description]` word for word: every line, quote and backslash as the person typed it, never escaped and never wrapped in quotes.

```
IMPORTANT: Do NOT create, write, or modify any files. Output all findings as text in your response only.

Analyze the target state of the migration the task below describes.

The task, exactly as the person wrote it, between the marker lines:
--- task ---
[description]
--- end of task ---

Focus on:
1. Find any existing usage of the target technology/pattern in the codebase
2. Look for partial migration attempts or hybrid implementations
3. Identify compatibility layers, adapters, or shims already in use
4. Check for migration-related configuration (build tools, transpilers, polyfills)
5. Document the target conventions and patterns to follow

Output:
- Existing target technology usage (if any)
- Partial migration progress found
- Compatibility concerns identified
- Target conventions to follow
- Migration configuration requirements
```
