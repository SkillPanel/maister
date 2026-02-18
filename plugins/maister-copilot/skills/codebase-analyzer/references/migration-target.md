# Migration Target — Prompt Template

Primarily for migrations. Replace `[description]` with the actual task description.

```
Analyze the target state for migration: "[description]"

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
