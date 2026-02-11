---
name: task-classifier
description: Classifies task descriptions to determine task type and routes to appropriate workflow. Delegates classification logic to task-classifier subagent for context isolation.
---

# Task Classifier Skill

This skill provides intelligent task type classification by delegating all classification logic to the task-classifier subagent. The subagent executes in an isolated context to prevent main agent context pollution.

## When to Use This Skill

Use this skill when:
- Starting work on a task but unsure of the best workflow
- Need to route a task description to the appropriate orchestrator
- Want to classify a GitHub issue or Jira ticket automatically
- Need confidence scoring for task type decisions
- Want context-aware classification based on codebase state

## How It Works

This skill is a **thin wrapper** that delegates to the task-classifier subagent:

1. **Receives** task description or issue reference from `/work` command
2. **Invokes** task-classifier subagent via Task tool (isolated execution)
3. **Returns** structured classification result to `/work` command for routing

The subagent handles all classification logic including:
- Issue detection and fetching (GitHub, Jira)
- Codebase context analysis
- Keyword matching and confidence scoring
- User confirmation flows
- Structured output generation

**Benefits of delegation:**
- ✅ Isolated execution prevents main agent context pollution
- ✅ Complex classification logic doesn't bloat main conversation
- ✅ Better debuggability (subagent operates independently)
- ✅ Cleaner separation of concerns

## Your Task

When this skill is invoked, you must:

1. **Extract Task Description**: Get the task description or issue reference from the invocation prompt

2. **Invoke Subagent**: Use the Task tool to invoke the task-classifier subagent:
   ```
   Task tool parameters:
   - subagent_type: "task-classifier"
   - description: "Classify task type"
   - prompt: "Classify the following task into one of 8 types.

   Task to classify: [insert task description here]

   Follow the 5-phase classification workflow:
   1. Input Processing & Issue Fetching
   2. Context Analysis
   3. Keyword Classification
   4. User Confirmation
   5. Output Classification

   Return the result in YAML format as specified in your agent definition."
   ```

3. **Parse Result**: Extract the structured classification result from the subagent's response

4. **Return to Caller**: Pass the classification result back to the calling command (/work) in the expected YAML format

**Important**: Do NOT perform classification logic yourself. Always delegate to the subagent to maintain context isolation.

## Supported Task Types

The subagent classifies into 6 task types:

| Type | Purpose | Confidence Typical |
|------|---------|-------------------|
| **bug-fix** | Fix defects/errors | High (80-94%) |
| **enhancement** | Improve existing features | High (80-94%) |
| **new-feature** | Add completely new capability | Medium (60-79%) |
| **performance** | Optimize speed/efficiency | High (80-94%) |
| **migration** | Move to new tech/pattern | High (80-94%) |
| **research** | Investigate and document findings | High (80-94%) |

## Input Format

Accepts task description or issue reference:
- Direct description: `"Fix login timeout error"`
- GitHub short: `"#123"` or `"GH-123"`
- GitHub URL: `"https://github.com/owner/repo/issues/123"`
- Jira ticket: `"PROJ-456"`
- Jira URL: `"https://company.atlassian.net/browse/PROJ-456"`
- Generic URL: Any issue tracker URL

## Output Format

Returns structured classification in YAML format:

```yaml
classification:
  task_type: [bug-fix|enhancement|new-feature|performance|migration|research]
  confidence: [percentage as integer]
  keywords_matched: [list of matched keywords]

  context_analysis:
    codebase_search_performed: [true|false]
    component_found: [true|false|not-searched]
    error_patterns_found: [list or null]
    git_history_relevant: [true|false|not-checked]

  issue_source:
    type: [github|jira|manual|none]
    identifier: [issue ID or null]
    title: [issue title or null]
    labels: [list or null]

  user_interaction:
    confirmation_level: [critical|high|medium|low]
    user_confirmed: [true|false]
    user_overrode: [true|false]
    original_classification: [type if overridden, or null]

  reasoning: "[Brief explanation of why this classification was chosen]"
```

Plus human-readable summary for user feedback.

## Core Principles

The subagent follows these principles:

1. **Evidence-Based Classification**: Uses keywords, context analysis, and codebase inspection
2. **Dynamic Issue Integration**: Automatically fetches details from GitHub/Jira when available
3. **Security First**: Security-related tasks always flagged as critical priority (100% detection)
4. **User Confirmation**: Confidence-based confirmation flow (auto-proceed, quick confirm, or full choice)
5. **Transparent Reasoning**: Shows keywords matched, confidence score, and context findings

## Classification Workflow

The subagent executes a 5-phase workflow:

### Phase 1: Input Processing & Issue Fetching
- Parse input for issue identifiers (GitHub, Jira, etc.)
- Detect available MCPs for integration
- Fetch issue details if identifier found and MCP available
- Enhance description with fetched details

### Phase 2: Context Analysis
- Read project documentation (.ai-sdlc/docs/INDEX.md)
- Search codebase for components (enhancement vs new-feature)
- Analyze error patterns in code (bug verification)
- Check git history for recent related work

### Phase 3: Keyword Classification
- Extract keywords from description
- Match against embedded keyword matrix (all 6 types)
- Calculate confidence scores with context boosts
- Resolve multi-type matches with priority rules

### Phase 4: User Confirmation
- High (80-94%): Quick confirmation with override option
- Medium (60-79%): Show classification, ask to confirm
- Low (<60%): Present all 6 options, let user choose

### Phase 5: Output Classification
- Generate structured YAML result
- Create human-readable summary
- Return to skill for routing

## Integration Points

### With /work Command

This skill is typically invoked by the `/work` command:
1. `/work` parses arguments and task description
2. Invokes task-classifier skill (this file)
3. Skill delegates to task-classifier subagent
4. Subagent performs classification and returns result
5. Skill passes result back to `/work`
6. `/work` routes to appropriate orchestrator based on task_type

### With Orchestrators

Classification result routes to:
- **bug-fix** → development-orchestrator skill (task_type=bug)
- **enhancement** → development-orchestrator skill (task_type=enhancement)
- **new-feature** → development-orchestrator skill (task_type=feature)
- **performance** → performance-orchestrator skill
- **migration** → migration-orchestrator skill
- **research** → research-orchestrator skill

### With External Systems

The subagent integrates with:
- **GitHub** via MCP GitHub tools (if available)
- **Jira** via MCP Jira tools (if available)
- **Generic** via WebFetch fallback or manual input

## Special Cases Handled

The subagent handles:
- **Compound Tasks**: Detects multiple tasks, prompts user to split
- **Vague Descriptions**: Requests clarification with specific questions
- **Unclear Context**: Distinguishes existing vs new through codebase search
- **Ambiguous Types**: Presents options when confidence < 80%

## Reference Documentation

For developers extending or understanding the classification methodology, design documentation is available in:

- **`references/classification-design.md`** - Classification patterns, keyword matrices, and confidence scoring methodology

> **Note**: This file serves as **design documentation** for developers. The actual runtime classification logic is embedded in the `agents/task-classifier.md` subagent file for path-independence when the plugin runs in user projects.

## Performance Targets

- **Classification time**: < 3 seconds (without external fetch)
- **With issue fetch**: < 8 seconds (depends on API speed)
- **Accuracy**: ≥ 90% for high confidence cases

- **User satisfaction**: ≥ 85% with suggested classifications

## Example Usage

**From /work command:**
```
User: /work "Fix login timeout error on mobile devices"

Flow:
1. /work invokes task-classifier skill
2. Skill delegates to task-classifier subagent
3. Subagent analyzes:
   - Keywords: "fix" (bug), "timeout" (bug), "error" (bug)
   - Confidence: 88% (high)
   - Type: bug-fix
4. Subagent presents: "Classification: Bug Fix (88%)"
5. User confirms
6. Subagent returns structured result
7. /work routes to development-orchestrator
```

**With GitHub issue:**
```
User: /work "https://github.com/acme/app/issues/456"

Flow:
1. /work invokes task-classifier skill
2. Skill delegates to task-classifier subagent
3. Subagent fetches issue via GitHub MCP:
   - Title: "Login fails with special characters"
   - Labels: ["bug", "authentication"]
4. Subagent classifies: bug-fix (91%)
5. User confirms
6. /work routes to development-orchestrator
```

---

## Implementation Note

**This skill delegates all logic to the subagent**. If you need to understand or modify classification behavior, see:
- **Runtime logic**: `agents/task-classifier.md` (subagent implementation)
- **Design docs**: `references/classification-design.md` (classification patterns)
- **Integration**: `commands/work.md` (how skill is invoked)

The skill itself simply acts as an invocation point and result pass-through to keep the main agent context clean.
