# Delegation Enforcement Patterns

This document defines mandatory patterns for ensuring orchestrators properly delegate work to skills and subagents instead of executing inline.

## Problem

Orchestrators may "optimize" by executing work inline instead of invoking skills/subagents, especially in YOLO mode. This bypasses:
- Specialized skill logic
- Subagent context isolation
- Proper tool invocation tracking
- Expected artifact generation

## Mandatory Enforcement Patterns

All delegation points in orchestrators MUST include these 4 patterns:

---

## Pattern 1: Anti-Pattern Block

**Purpose**: Explicitly show what NOT to do. Claude tends to follow the path of least resistance; showing the wrong approach prevents it.

**Template**:

```markdown
**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading [skill-name]/SKILL.md and following its instructions directly
❌ WRONG: Spawning your own Explore/Plan subagents to do this work
❌ WRONG: Doing this analysis/planning/implementation inline in the orchestrator thread
❌ WRONG: Skipping this phase because you "already know" the answer

✅ RIGHT: Using the tool call below and waiting for completion
```

**Variations by delegation type**:

For **Skill** delegations:
```markdown
❌ WRONG: Reading [skill-name]/SKILL.md and following its instructions directly
```

For **Task** (subagent) delegations:
```markdown
❌ WRONG: Reading agents/[agent-name].md and following its instructions directly
```

---

## Pattern 2: Standardized Invocation Block

**Purpose**: Make tool calls look like executable code, not prose suggestions.

**Template for Skill tool**:

```markdown
**INVOKE NOW:**

Tool: `Skill`
Parameters:
  skill: "ai-sdlc:[skill-name]"

⏳ Wait for skill completion before continuing.
```

**Template for Task tool (subagent)**:

```markdown
**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:[agent-name]"
  description: "[brief description]"
  prompt: |
    [Task-specific context]
    Task path: [task-path]
    [Additional inputs]

⏳ Wait for subagent completion before continuing.
```

**Template for parallel Task invocations**:

```markdown
**INVOKE NOW (PARALLEL):**

Launch these agents in a SINGLE message with multiple Task tool calls:

Agent 1:
  Tool: `Task`
  Parameters:
    subagent_type: "ai-sdlc:[agent-1]"
    description: "[description]"
    prompt: "[prompt]"

Agent 2:
  Tool: `Task`
  Parameters:
    subagent_type: "ai-sdlc:[agent-2]"
    description: "[description]"
    prompt: "[prompt]"

⏳ Wait for ALL agents to complete before continuing.
```

---

## Pattern 3: Pre-Delegation Announcement

**Purpose**: Make delegation visible to users. If Claude outputs this announcement, it's committed to delegating.

**Template**:

```markdown
**Output before invoking:**
```
📤 Delegating Phase [N] to: [skill/agent name]
Method: [Skill tool / Task tool]
Expected outputs: [list of files]
```
```

**Example**:

```
📤 Delegating Phase 1 to: codebase-analyzer skill
Method: Skill tool
Expected outputs: analysis/codebase-analysis.md
```

---

## Pattern 4: Post-Delegation Self-Check

**Purpose**: Force verification that delegation actually happened before proceeding.

**Template**:

```markdown
**SELF-CHECK (before proceeding to Phase [N+1]):**

- [ ] Did you invoke the Skill/Task tool? (not just read the SKILL.md)
- [ ] Did you wait for the tool to return results?
- [ ] Are the expected outputs present?

If NO to any: STOP - go back and invoke the required tool.
```

---

## Complete Pattern (Copy-Paste Template)

Use this complete pattern for each delegation point:

### For Skill Delegation

```markdown
### Phase [N]: [Phase Name]

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading [skill-name]/SKILL.md and following its instructions directly
❌ WRONG: Spawning your own subagents to do this work
❌ WRONG: Doing this work inline in the orchestrator thread
❌ WRONG: Skipping this phase because you "already know" the answer

✅ RIGHT: Using the tool call below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase [N] to: [skill-name] skill
Method: Skill tool
Expected outputs: [list]
```

**INVOKE NOW:**

Tool: `Skill`
Parameters:
  skill: "ai-sdlc:[skill-name]"

⏳ Wait for skill completion before continuing.

**SELF-CHECK (before proceeding to Phase [N+1]):**

- [ ] Did you invoke the Skill tool? (not just read the SKILL.md)
- [ ] Did you wait for the tool to return results?
- [ ] Are the expected outputs present?

If NO to any: STOP - go back and invoke the Skill tool.
```

### For Task (Subagent) Delegation

```markdown
### Phase [N]: [Phase Name]

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/[agent-name].md and following its instructions directly
❌ WRONG: Doing this analysis inline in the orchestrator thread
❌ WRONG: Skipping this phase because you "already know" the answer

✅ RIGHT: Using the tool call below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase [N] to: [agent-name] subagent
Method: Task tool
Expected outputs: [list]
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:[agent-name]"
  description: "[Phase Name]"
  prompt: |
    [Context and instructions for the subagent]

⏳ Wait for subagent completion before continuing.

**SELF-CHECK (before proceeding to Phase [N+1]):**

- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Are the expected outputs present?

If NO to any: STOP - go back and invoke the Task tool.
```

---

## Loop and Conditional Patterns

### Loop-Based Skill Invocation

For phases that invoke skills in a loop (e.g., initiative orchestrator executing multiple tasks):

```markdown
**INVOKE FOR EACH TASK:**

For each task in `tasks` array where status != "completed":

1. Output announcement:
   ```
   📤 Executing task [N]/[total]: [task name]
   Type: [task type]
   Orchestrator: [orchestrator skill name]
   ```

2. Invoke orchestrator:
   Tool: `Skill`
   Parameters:
     skill: "ai-sdlc:[task-type]-orchestrator"

3. Update state after completion

⚠️ Do NOT batch execute - invoke one skill, wait for completion, then proceed to next.
```

### Conditional Delegation

For phases that may or may not delegate based on conditions:

```markdown
**CONDITIONAL DELEGATION:**

IF [condition]:
  - Output: "📤 Condition met, delegating to [agent]"
  - Invoke Task tool (pattern above)
ELSE:
  - Output: "⏭️ Skipping [phase] - condition not met: [reason]"
  - Proceed to next phase

⚠️ If condition is TRUE, you MUST delegate - do NOT execute inline.
```

---

## Common Anti-Patterns to Avoid

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| "I'll analyze the codebase to find..." | Bypasses codebase-analyzer skill | Invoke `ai-sdlc:codebase-analyzer` |
| "Let me create the specification..." | Bypasses specification-creator | Invoke `ai-sdlc:specification-creator` |
| "Looking at the gaps between..." | Bypasses gap-analyzer subagent | Invoke `ai-sdlc:gap-analyzer` Task |
| "I'll implement this by..." | Bypasses implementer skill | Invoke `ai-sdlc:implementer` |
| Reading a SKILL.md then doing the work | Skill files are instructions FOR skills | Use Skill tool to invoke |
| Spawning Explore agents in orchestrator | Codebase-analyzer manages its own agents | Invoke skill, let IT spawn agents |

---

## Enforcement in Phase Execution Pattern

The 7-step phase execution loop (see `phase-execution-pattern.md`) includes delegation verification:

**STEP 4: Execute Phase** includes:
- Pre-delegation announcement (Pattern 3)
- Tool invocation (Pattern 2)
- Wait for completion

**STEP 6: Verify Success** includes:
- Self-check (Pattern 4)
- Output verification

---

## When Inline Execution is Acceptable

These phase types do NOT require delegation:

1. **Clarifying questions phases** (1.5, 3.5, 4.5, 5.5) - AskUserQuestion is direct
2. **State updates** - Reading/writing orchestrator-state.yml
3. **Phase announcements** - Outputting status messages
4. **Simple decisions** - Enabling/disabling optional phases
5. **Finalization** - Creating summary, updating metadata

For all analysis, planning, implementation, and verification phases: **ALWAYS DELEGATE**.

---

## Pattern 5: Post-Return Continuation Instruction

**Purpose**: Ensure orchestrator executes next action immediately after tool returns.

**For AUTO-CONTINUE phases** (marked ⚡ AUTO in Phase Flow):

After invoking a skill/subagent that has AUTO-CONTINUE:
1. Process the return value
2. Verify outputs exist
3. **IMMEDIATELY proceed to next phase** - do NOT:
   - Output phase completion summary
   - Ask user if they want to continue
   - Stop and wait for input

The next phase handles any needed user interaction.

**See `interactive-mode.md`** for the full list of AUTO-CONTINUE transitions.

---

## Pattern 6: Consuming Subagent Results

**Purpose**: Define how orchestrators handle results returned by delegated skills/subagents.

**Critical Rule**: When a delegated skill completes, **you do NOT stop** - you continue the orchestrator workflow. The skill completion is just one step in the orchestrator's phase execution.

**When a skill (like codebase-analyzer) returns results:**

1. **You are still in the orchestrator context** - the skill has completed, you are back in the orchestrator
2. **Read the structured output** - extract key fields (status, report_path, risk_level, etc.)
3. **Update orchestrator state** - write relevant fields to orchestrator-state.yml
4. **Check the Phase Flow table** - determine if next transition is GATE or AUTO
5. **Execute the appropriate transition**:
   - If ⚡ AUTO: Continue immediately to next phase (Pattern 5)
   - If 🚦 GATE: Check mode and prompt/continue accordingly

**Template after skill returns:**

```
[Skill tool returns result]

✅ Skill completed. Processing results...

Structured output received:
- status: [value]
- report_path: [value]
- [other fields]

State update: Updated orchestrator-state.yml with [fields]

Phase Flow check: Phase [N] → [N+1] is [GATE/AUTO]

[If AUTO: Proceeding immediately to Phase [N+1]...]
[If GATE: Checking mode and prompting/continuing...]
```
