# Delegation Enforcement

Orchestrators must delegate work to skills and subagents instead of executing inline.

## Core Rule

**Always use Skill/Task tools to delegate. Never execute delegated work inline.**

When a phase requires a skill or subagent:
1. Use the `Skill` tool for skills
2. Use the `Task` tool for subagents
3. Wait for completion before continuing

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| "I'll analyze the codebase..." | Bypasses codebase-analyzer skill | Use `Skill` tool with `maister:codebase-analyzer` |
| "Let me create the specification..." | Bypasses specification-creator | Use `Task` tool with `maister:specification-creator` subagent |
| "Looking at the gaps between..." | Bypasses gap-analyzer subagent | Use `Task` tool with `maister:gap-analyzer` |
| "I'll implement this by..." | Bypasses implementer skill | Use `Skill` tool with `maister:implementer` |
| Reading a SKILL.md then doing the work | Skill files are instructions FOR skills | Use Skill tool to invoke |
| Spawning Explore agents in orchestrator | Codebase-analyzer manages its own agents | Invoke skill, let IT spawn agents |

---

## When Inline Execution is Acceptable

These do NOT require delegation:

1. **Clarifying questions phases** (1.5, 3.5, 4.5, 5.5) - AskUserQuestion is direct
2. **State updates** - Reading/writing orchestrator-state.yml
3. **Phase announcements** - Outputting status messages
4. **Simple decisions** - Enabling/disabling optional phases
5. **Finalization** - Creating summary, updating metadata

For all analysis, planning, implementation, and verification phases: **ALWAYS DELEGATE**.

**Never acceptable inline** (regardless of perceived task simplicity):
- Specification creation → always delegate to `maister:specification-creator` subagent
- Implementation planning → always delegate to `maister:implementation-planner` subagent
- Gap analysis → always delegate to `maister:gap-analyzer` subagent
- Codebase analysis → always delegate to `maister:codebase-analyzer` skill
- Code review → always delegate to `maister:code-reviewer` subagent
- Test execution → always delegate to `maister:test-suite-runner` subagent
- Implementation completeness → always delegate to `maister:implementation-completeness-checker` subagent

"The task is simple" is NOT a valid reason to skip delegation. Subagents provide context isolation regardless of complexity.

---

## Skill Invocation

```
Tool: Skill
Parameters:
  skill: "maister:[skill-name]"
```

Wait for skill completion before continuing.

---

## Task (Subagent) Invocation

```
Tool: Task
Parameters:
  subagent_type: "maister:[agent-name]"
  description: "[brief description]"
  prompt: |
    [Context and instructions]
    Task path: [task-path]
```

Wait for subagent completion before continuing.

---

## Parallel Task Invocation

For phases requiring multiple parallel agents (e.g., research information gathering):

Launch all agents in a SINGLE message with multiple Task tool calls. Wait for ALL to complete.

---

## Context Passing

All subagent prompts must include context from prior phases:

```
prompt: |
  [Task instructions]
  Task path: [path]

  ## RESEARCH CONTEXT (if research_reference exists)
  Research question: [research_reference.research_question]
  Confidence: [research_reference.confidence_level]
  Summary: [phase_summaries.research.summary]

  ## CONTEXT FROM PRIOR PHASES
  [Key state fields from orchestrator-state.yml]
  [Summaries of completed phases from phase_summaries]

  ## ARTIFACTS TO READ
  [List relevant files for full details]
```

**Why**: Subagents run in isolated context. Without summaries, they must re-parse entire files and miss prior decisions.

---

## Context Extraction

After each phase, extract key findings into `[domain]_context.phase_summaries`:

1. Parse subagent output for key fields
2. Create 1-2 sentence summary
3. Update state: `[domain]_context.phase_summaries.[phase_name]`

This enables context passing to downstream phases and supports resume.

---

## Decision Enforcement

When a subagent returns `decisions_needed` items, the orchestrator MUST present them to the user (interactive) or log them (YOLO). Decisions are never silently skipped.

### Anti-Patterns (NEVER do this)

| Anti-Pattern | Why It's Wrong |
|---|---|
| "I'll accept the recommended defaults" | User loses control over critical scope decisions |
| Logging decisions without asking (interactive mode) | Documentation ≠ user consent |
| "The recommendations are clear, no need to ask" | Clarity ≠ consent. User may disagree with "clear" recommendation |
| Skipping decisions because task seems simple | Simple tasks can have non-obvious scope implications |

### Decision Gate Pattern

After receiving subagent output with `decisions_needed`:

1. **Parse**: Extract all critical and important decisions from subagent output
2. **Present** (Interactive): Use `AskUserQuestion` for each critical decision; batch important decisions into multi-select
3. **Accept** (YOLO): Auto-accept defaults, log each decision (id, issue, chosen option, rationale) to `analysis/scope-clarifications.md`
4. **SELF-CHECK**: "Did I present/log ALL decisions from `decisions_needed`? If not, STOP."

### YOLO Mode Logging

Even in YOLO mode, decisions must be logged to create an audit trail:
- Write to `analysis/scope-clarifications.md`
- Format: decision ID, issue, chosen option, rationale
- User can review auto-accepted decisions after workflow completes
