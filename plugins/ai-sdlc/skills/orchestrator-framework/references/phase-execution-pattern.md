# Phase Execution Pattern

Orchestrators execute phases using the simple "Phase Blocks" model.

## Phase Block Structure

Each phase in an orchestrator follows this structure:

```markdown
### Phase N: [Name]

**Purpose**: [1-2 sentences describing what this phase accomplishes]
**Execute**: [Skill tool / Task tool with agent / Direct execution]
**Output**: [Files created by this phase]
**State**: [orchestrator-state.yml fields updated]

→ [Transition instruction]

---
```

## Transition Instructions

Each phase ends with ONE transition instruction:

| Instruction | Syntax | Behavior |
|-------------|--------|----------|
| **Continue** | `→ Continue to Phase X` | Proceed immediately to next phase |
| **Pause** | `→ Pause` | Check mode, then continue or prompt |
| **Conditional** | `→ Conditional: if [condition] then [action] else [action]` | Evaluate condition first |

### Continue Transitions (AUTO-CONTINUE)

Use when the next phase handles user interaction or when phases are tightly coupled:

```markdown
→ **AUTO-CONTINUE** — Do NOT summarize, do NOT end turn, do NOT prompt user. Proceed immediately to next phase.
```

**Rules**:
- You MAY output a brief phase summary (1-2 lines)
- Do NOT end your turn
- Do NOT use AskUserQuestion
- Do NOT wait for user input
- After any summary, proceed immediately to the next phase

**Common mistake**: Outputting a summary and then stopping/ending the turn. The summary is fine — stopping is not.

### Pause Transitions

Use at phase boundaries where user review is valuable:

```markdown
→ Pause

**Interactive mode**: MANDATORY - You MUST use AskUserQuestion:
  Question: "Phase N complete. Continue to Phase N+1?"
  Options: ["Continue", "Review outputs", "Stop workflow"]

  DO NOT proceed until user responds.

**YOLO mode**: Output "→ Continuing to Phase N+1..." and proceed
```

**Critical**: In interactive mode, proceeding without AskUserQuestion is a protocol violation.

### Conditional Transitions

Use when different paths are needed based on state:

```markdown
→ Conditional: if task_type=bug AND tdd_enabled then continue to Phase 3, else skip to Phase 4

**Evaluation**:
1. Read `orchestrator-state.yml` for condition values
2. Follow the matching path
```

---

## Phase Execution Steps

For each phase:

1. **Check completion**: Read `orchestrator-state.yml` → if phase in `completed_phases`, skip
2. **Mark task in progress**: `TaskUpdate` the phase's task to `in_progress` (shows spinner with `activeForm`)
3. **Execute**: Run the phase content (delegate via Skill/Task tool or execute directly)
4. **Update state**: Add phase to `completed_phases`, update `current_phase`
5. **Mark task completed**: `TaskUpdate` the phase's task to `completed`. Optionally set `metadata` with timing and artifact paths. Set `owner` if phase was delegated to a skill/agent.
6. **Follow transition**: Execute the `→` instruction at phase end

---

## Task Status Lifecycle

| Phase Event | TaskUpdate Action |
|-------------|-------------------|
| Phase starting | `status: "in_progress"`, `activeForm` from Phase Configuration |
| Phase completed | `status: "completed"`, `metadata: {completed_at, artifact_paths}` |
| Phase skipped | `status: "completed"`, `metadata: {skipped: true, reason: "..."}` |
| Phase delegated | `owner: "maister:[skill-or-agent-name]"` |
| Phase failed | Keep as `in_progress` (state file tracks failure details) |

---

## Delegation Enforcement

When a phase requires delegation to a skill or subagent:

1. **Invoke the tool** (Skill or Task) - do NOT execute inline
2. **Wait for completion** before proceeding
3. **Process results** and update state

**Anti-patterns to AVOID**:
- Reading a SKILL.md file and following its instructions directly
- Spawning your own subagents to do delegated work
- Executing analysis/planning/implementation inline
- Skipping delegation because you "already know" the answer

**See**: `delegation-enforcement.md` for complete enforcement patterns.

---

## Invocation Patterns

### Invoking Skills

Use the `Skill` tool:

```
Use Skill tool:
  skill: "maister:[skill-name]"
```

**Skills**: `implementer`, `implementation-verifier`, `codebase-analyzer`, `docs-manager`

### Invoking Agents

Use the `Task` tool with `subagent_type`:

```
Use Task tool:
  subagent_type: "maister:[agent-name]"
  description: "[brief description]"
  prompt: "[detailed prompt]"
```

**Agents**: `gap-analyzer`, `specification-creator`, `implementation-planner`, `implementation-completeness-checker`, `test-suite-runner`, `code-reviewer`, `production-readiness-checker`, `spec-auditor`, `ui-mockup-generator`, `e2e-test-verifier`, `user-docs-generator`, `bottleneck-analyzer`, etc.

### Key Difference

| Type | Tool | When to Use |
|------|------|-------------|
| **Skill** | `Skill` | Structured workflows with phases |
| **Agent** | `Task` | Specialized analysis tasks |

---

## Standards Discovery

Before specification, planning, implementation, and verification phases, check `.maister/docs/INDEX.md` for applicable standards:

```
📋 Standards Discovery
Reading .maister/docs/INDEX.md to check applicable standards...

[If found] Applying: [list relevant standards]
[If not found] No INDEX.md found. Consider running /maister:init.
```

---

## Error Handling

If a phase fails:

1. Increment `auto_fix_attempts.[phase]` in state
2. If under max attempts (typically 3): Try auto-fix strategy
3. If max exceeded: Use AskUserQuestion with options:
   - "Retry with guidance"
   - "Skip this phase"
   - "Stop workflow"

**NEVER automatically rollback changes.** Always ask the user first.
