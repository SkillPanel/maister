# Code Analysis — Prompt Templates

Replace `[description]` with the actual task description.

## Bug
```
Analyze the code related to: "[description]"

Focus on:
1. Trace execution flow from input to output
2. Identify state changes and side effects
3. Look for edge cases, error conditions, race conditions
4. Find validation logic and where it might fail
5. Check for recent changes that might have introduced the bug

Output:
- Execution flow diagram (text-based)
- Key functions/methods involved
- Potential problem areas
- State management approach
```

## Enhancement
```
Analyze the existing implementation of: "[description]"

Focus on:
1. Understand current functionality and capabilities
2. Identify the component/service architecture
3. Document the data flow (props, state, API calls)
4. Note coding patterns used (hooks, classes, functional)
5. Assess complexity (simple/moderate/complex)

Output:
- Current functionality summary
- Architecture overview
- Key functions and their purposes
- Coding patterns observed
```

## Feature
```
Analyze the codebase architecture for adding: "[description]"

Focus on:
1. Understand the overall project structure
2. Identify architectural patterns in use (MVC, component-based, etc.)
3. Document naming conventions and code style
4. Find the data layer patterns (API, state management)
5. Note any relevant abstractions or base classes

Output:
- Project structure overview
- Architectural patterns to follow
- Naming conventions to match
- Recommended approach for new feature
```
