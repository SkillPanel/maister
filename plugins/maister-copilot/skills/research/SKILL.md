---
name: research
description: Orchestrates comprehensive research workflows from question definition through findings documentation. Handles technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based reporting. Supports standalone research tasks and embedded research phase in other workflows.
user-invocable: true
---

# Research Orchestrator

Systematic research workflow from question definition to evidence-based documentation.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).` / `→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `ask_user` at a gate. They apply only to your discretionary clarifications.

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.

### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md` - Delegation rules, interactive mode, state schema, initialization, context passing, issue resolution

### Step 2: Initialize Workflow

1. **Create Task Items**: Use `TaskCreate` for all phases (see Phase Configuration), then set dependencies with `TaskUpdate addBlockedBy`
2. **Create Task Directory**: `.maister/tasks/research/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with research context

**Output**:
```
🚀 Research Orchestrator Started

Task: [research question]
Directory: [task-path]

Starting Phase 1: Initialize research...
```

---

## When to Use

Use when:
- Need comprehensive research on a topic
- Exploring codebase patterns or architecture
- Gathering requirements or best practices
- Want systematic evidence-based answers
- Research will feed into development workflows

**DO NOT use for**: Development tasks, bug fixes, performance optimization.

---

## Core Principles

1. **Evidence-Based**: Every finding must have source citation
2. **Systematic**: Follow structured methodology for consistent results
3. **Multi-Source**: Gather from codebase, docs, config, external sources
4. **Synthesized**: Cross-reference findings, identify patterns
5. **Actionable**: Produce outputs that enable next steps

---

## Local References

| File | When to Use | Purpose |
|------|-------------|---------|
| `references/research-methodologies.md` | Phase 1 | Research type classification, methodology selection, gathering strategies, analysis frameworks |
| `references/brainstorming-techniques.md` | Phase 3 | Divergent/convergent thinking, interactive exploration, scope guardrails |
| `references/design-techniques.md` | Phase 5 | Decision documentation (MADR), ADR guidance, decision linking |

---

## Phase Configuration

| Phase | content | activeForm | Agent/Skill |
|-------|---------|------------|-------------|
| 1 | "Research foundation (init, plan, gather, synthesize)" | "Executing research foundation" | Direct + research-planner + information-gatherer (xN) + research-synthesizer |
| 2 | "Evaluate brainstorming value" | "Evaluating brainstorming value" | Direct |
| 3 | "Generate solution alternatives" | "Generating solution alternatives" | solution-brainstormer |
| 4 | "Evaluate brainstorming alternatives" | "Evaluating brainstorming alternatives" | Direct (interactive) |
| 5 | "Design high-level architecture" | "Designing high-level architecture" | Direct + solution-designer |
| 6 | "Summarize research and suggest next steps" | "Completing research" | Direct |

---

## Research Types

| Type | Keywords | Focus | Typical Outputs |
|------|----------|-------|-----------------|
| **Technical** | "how does", "where is", "implementation" | Codebase analysis | Knowledge base, architecture docs |
| **Requirements** | "what are requirements", "user needs" | User/business needs | Specifications, requirements doc |
| **Literature** | "best practices", "industry standards" | External research | Recommendations, comparisons |
| **Mixed** | Multiple keywords, broad questions | Comprehensive investigation | All output types |

---

## Workflow Phases

### Phase 1: Research Foundation

**Purpose**: Initialize research, plan methodology, gather information from all sources, and synthesize findings into a research report
**Execute**: Multi-step: Direct + research-planner + information-gatherer (xN) + research-synthesizer
**Output**: `planning/research-brief.md`, `planning/research-plan.md`, `planning/sources.md`, `analysis/findings/*.md`, `analysis/synthesis.md`, `outputs/research-report.md`
**State**: Set `research_context.research_type`, `research_question`, `scope`, `methodology`, `sources`, `confidence_level`, `gathering_strategy`

This phase executes 4 sequential steps. On resume, check existing artifacts to skip completed steps.

#### Step 1: Initialize (Direct)

**Artifacts**: `planning/research-brief.md`
**Resume check**: If `planning/research-brief.md` exists, skip to Step 2

1. Parse research question (from command or prompt user)
2. Classify research type (auto-detect from keywords or use `--type` flag)
3. Determine scope (included, excluded, constraints)
4. Define success criteria
5. Create research brief
6. Update state: set `research_context.research_type`, `research_question`, `scope`
7. **Discover project documentation**: Read `.maister/docs/INDEX.md` (if exists), extract ALL file paths from the "Project Documentation" section — includes predefined docs AND any user-added project docs. Store as `research_context.project_doc_paths` in state.

#### Step 2: Plan (Subagent)

**Artifacts**: `planning/research-plan.md`, `planning/sources.md`
**Resume check**: If `planning/research-plan.md` AND `planning/sources.md` exist, skip to Step 3

**Read `references/research-methodologies.md` NOW using the Read tool** — research type classification, methodology selection, gathering strategies

**INVOKE NOW**: Use Task tool with `subagent_type: maister-research-planner`

**Context to pass**: task_path, research_brief_path, research_type, research_question, scope, project_doc_paths (from state)

Update state: `research_context.methodology`, `sources`

#### Step 3: Gather + Merge (Parallel Subagents + Direct)

**Artifacts**: `analysis/findings/*.md` (category-specific)
**Resume check**: If any `analysis/findings/*.md` files exist, skip to Step 4

**Determine gatherer count and categories**:
1. Read `planning/research-plan.md` for **Gathering Strategy** section
2. If gathering strategy found: use specified categories and count (cap at 8 max)
3. If no gathering strategy: fall back to default 4 categories (codebase, documentation, configuration, external)
4. Update state: `research_context.gathering_strategy`

**CRITICAL: Launch all N agents in ONE message for parallel execution.**

**Parallel Execution Pattern**:
```
Read gathering strategy from research-plan.md
For each category in strategy:
  Use Task tool: source_category=[category_id] → analysis/findings/[prefix]-*.md
```

#### Step 4: Synthesize (Subagent)

**Artifacts**: `analysis/synthesis.md`, `outputs/research-report.md`
**Resume check**: If `analysis/synthesis.md` AND `outputs/research-report.md` exist, skip (Phase 1 complete)

**INVOKE NOW**: Use Task tool with `subagent_type: maister-research-synthesizer`

**Context to pass**: task_path, findings_directory_path, research_question, research_type, methodology

**Synthesizer produces**:
- Pattern analysis and cross-references (`analysis/synthesis.md`)
- Comprehensive research report answering research question (`outputs/research-report.md`)
- Confidence levels for each finding
- Documented gaps and uncertainties

Update state: `research_context.confidence_level`

---

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - "Research foundation complete (initialized, planned, gathered, synthesized). Continue to brainstorming evaluation?"

---

### Phase 2: Optional Phases Decision

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from Phase 1 in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Evaluate whether brainstorming and/or design phases would be valuable (independently)
**Execute**: Direct
**Output**: Updated `orchestrator-state.yml`
**State**: Set `options.brainstorming_enabled`, `options.design_enabled`

**Auto-resolve if**: `--brainstorm`/`--no-brainstorm` flags (brainstorming only), `--design`/`--no-design` flags (design only)

**Process**:
1. Read `analysis/synthesis.md` summary and `research_type` from state
2. Evaluate brainstorming value based on:
   - Number of viable approaches identified in synthesis (multiple → valuable)
   - Problem novelty (new domain → valuable; well-understood → less so)
   - Whether synthesis identified competing trade-offs (yes → valuable)
3. Evaluate design value based on:
   - Whether research suggests architectural decisions (yes → valuable)
   - Research type (requirements/mixed → likely valuable; technical → depends)
   - Whether design artifacts would feed into development workflow
4. If `brainstorming_enabled` not already set by flag, ask_user:
   - "[Brainstorming recommendation]. Would you like to explore solution alternatives?"
   - Options: "Yes, explore alternatives" / "No, skip brainstorming"
5. If `design_enabled` not already set by flag, ask_user:
   - "[Design recommendation]. Would you like to generate a high-level design?"
   - Options: "Yes, generate design" / "No, skip design"
6. Update state: set `brainstorming_enabled` and `design_enabled`

→ If brainstorming enabled: continue to Phase 3
→ If brainstorming disabled AND design enabled: skip to Phase 5
→ If both disabled: skip to Phase 6

---

### Phase 3: Solution Generation

**Purpose**: Generate solution alternatives from research evidence using specialized brainstormer subagent
**Execute**: solution-brainstormer subagent
**Output**: `outputs/solution-exploration.md`
**State**: Update `phase_summaries.phase-3`

**Skip if**: `brainstorming_enabled = false` (user chose to skip in Phase 2, or `--no-brainstorm` flag)

**Read `references/brainstorming-techniques.md` NOW using the Read tool** — divergent/convergent thinking techniques, scope guardrails

> **ANTI-PATTERN**: Do NOT generate solution alternatives inline. The solution-brainstormer agent has specialized multi-perspective analysis capabilities.

**INVOKE NOW**: Use Task tool with `subagent_type: maister-solution-brainstormer`

**Context to pass** (Pattern 7):
- `task_path`, `synthesis_path`, `research_report_path`
- `output_path`: `outputs/solution-exploration.md` — brainstormer MUST write to this exact path
- Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries` (Phase 1)
- `project_doc_paths` (from state)

> **SELF-CHECK**: After Task tool returns, verify `outputs/solution-exploration.md` exists and contains alternatives. If missing: **STOP. Do NOT proceed to Phase 4 or Phase 5.** Re-invoke the brainstormer with corrected context (ensure `output_path` is `outputs/solution-exploration.md`). If second attempt also fails, use ask_user to report the failure and ask whether to retry or skip brainstorming.

→ **AUTO-CONTINUE**

---

### Phase 4: Solution Convergence

**Purpose**: Present brainstorming alternatives to user for decision-making on each decision area
**Execute**: Direct (interactive)
**Output**: Updated `orchestrator-state.yml` with chosen approaches
**State**: Update `phase_summaries.phase-4` with `decision_areas` and `deferred_ideas`

**Skip if**: `brainstorming_enabled = false`
**Resume check**: If `phase_summaries.phase-4.decision_areas` has entries with `chosen_approach` set, skip already-resolved areas

> **ANTI-PATTERN**: Do NOT present all decision areas in a single summary table and ask one combined "do you agree?" question. Each area MUST get its own detailed presentation and its own ask_user call.
>
> **ANTI-PATTERN**: Do NOT show full alternatives/pros/cons for the first area and then shortcut remaining areas to just a recommendation line + question. EVERY area gets the SAME level of detail — all alternatives with descriptions, pros, and cons. No exceptions.

1. Read `outputs/solution-exploration.md`
2. For each decision area sequentially, output ALL of the following (steps a-d) BEFORE calling ask_user:
   a. **Area header**: area name and why this decision matters (1-2 sentences of context)
   b. **Alternatives detail**: For EVERY alternative in this area, show:
      - Name and description (2-3 sentences)
      - Pros (bullet list)
      - Cons (bullet list)
   c. **Recommendation**: which alternative is recommended and why (1 sentence)
   d. **ask_user**: this area's alternatives as options (mark recommended with "(Recommended)") + "Need more info" option
   e. If user picks → record choice, move to next area
   f. If "Need more info" → present the detailed trade-off analysis for the requested alternative, then re-ask

> **SELF-CHECK before each ask_user**: Did you output the alternatives with pros/cons for THIS area? If you only showed a recommendation line without listing all alternatives and their pros/cons, STOP and output the full detail before asking.

3. After all areas resolved, present a brief summary of the chosen combination
4. Update state with chosen approaches per decision area

> **GATE CHECK**: Verify that ask_user was called for EACH decision area. If any decision area was skipped for any reason (e.g., output file missing, read failure), STOP and resolve before continuing. Do NOT mark Phase 4 complete without user convergence on all decision areas.

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - "Brainstorming complete. Continue to high-level design?"

---

### Phase 5: High-Level Design

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from the preceding phase in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Create architecture design from selected solution approach
**Execute**: Orchestrator-Direct Hybrid
**Output**: `outputs/high-level-design.md`, `outputs/decision-log.md`
**State**: Update `phase_summaries.phase-5`

**Skip if**: `design_enabled = false`

**Read `references/design-techniques.md` NOW using the Read tool** — MADR format, ADR guidance, decision documentation patterns

**Part A — Design Direction (Direct)**:
1. If Phase 4 ran: confirm selected approaches from convergence
2. If Phase 4 was skipped: use research report recommendations as design input
3. ask_user for any design preferences or constraints (e.g., "Any architectural constraints or preferences?")

**Part B — Design Generation (Subagent)**:

> **ANTI-PATTERN**: Do NOT generate C4 architecture diagrams or ADRs inline. The solution-designer agent has specialized architecture and MADR documentation capabilities.

**INVOKE NOW**: Use Task tool with `subagent_type: maister-solution-designer`

**Context to pass** (Pattern 7):
- `task_path`, `synthesis_path`, `research_report_path`
- `solution_exploration_path` (only if Phase 3-4 ran)
- `selected_approach` (from Phase 4 convergence if ran, or from research report recommendations)
- `design_preferences` (from Part A)
- Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries`
- `project_doc_paths` (from state)

> **SELF-CHECK**: After Task tool returns, verify both `outputs/high-level-design.md` and `outputs/decision-log.md` exist. If missing: **STOP. Do NOT proceed to Part C.** Re-invoke the designer with corrected context. If second attempt also fails, use ask_user to report the failure and ask whether to retry or skip design.

**Part C — Summary (Direct)**:
3. Read `outputs/high-level-design.md` and `outputs/decision-log.md`
4. Present executive summary to user:
   - Architecture style and key components
   - Number of architectural decisions recorded
   - Key decision highlights (1 line each)
   - Integration points with existing system (if applicable)

→ **MANDATORY GATE** — fires regardless of permission mode, session-reminders, or prior approval patterns. Invoke `ask_user` now. Proceeding without a user response is a protocol violation (orchestrator-patterns.md § 2 / § 2.1).

ask_user - "Design complete. Continue to output generation?"

---

### Phase 6: Completion

> **Phase entry self-check**: Before executing this phase, locate the `ask_user` tool call from the preceding phase in this conversation. If you cannot point to its call ID, STOP and fire that gate now. State updates (`completed_phases`, `TaskUpdate`) without a corresponding `ask_user` call are protocol violations — never paper over a missed gate by updating state.

**Purpose**: Summarize research results and suggest next steps
**Execute**: Direct
**Output**: No new files — summarizes existing outputs

**Process**:
1. Inventory all generated outputs: `outputs/research-report.md` (always), plus conditional: `solution-exploration.md`, `high-level-design.md`, `decision-log.md`
2. Present executive summary to user:
   - Key findings and confidence level
   - Which optional phases ran (brainstorming, design)
   - Key decision highlights (if brainstorming/design ran)
3. If design artifacts exist, suggest starting development in a fresh session:
   ```
   To start development based on this research, clear context first or start a new session, then run:
   /maister-development [task-path]
   ```

→ End of workflow

---

## Domain Context (State Extensions)

Research-specific fields in `orchestrator-state.yml`:

```yaml
research_context:
  research_type: "technical" | "requirements" | "literature" | "mixed"
  research_question: "[user's question]"
  scope:
    included: []
    excluded: []
    constraints: []
  methodology: []
  sources: []
  confidence_level: "high" | "medium" | "low"
  gathering_strategy:
    categories: []       # e.g., ["codebase", "documentation", "external-apis"]
    count: 4             # number of gatherer instances
    source: "planner" | "default"  # where strategy came from
  phase_summaries:
    phase-1:
      summary: "..."
      steps_completed: []  # track which steps completed for resume
    phase-3:
      summary: "..."
    phase-4:
      summary: "..."
      decision_areas: []        # list of {area, alternatives_count, chosen_approach}
      deferred_ideas: []
    phase-5:
      summary: "..."
      architecture_style: null
      decisions_count: 0

options:
  brainstorming_enabled: null  # null=not yet decided, set by Phase 2 or --brainstorm/--no-brainstorm flag
  design_enabled: null          # independent, set by Phase 2 or --design/--no-design flag
```

---

## Task Structure

```
.maister/tasks/research/YYYY-MM-DD-research-name/
├── orchestrator-state.yml
├── planning/
│   ├── research-brief.md           # Phase 1, Step 1
│   ├── research-plan.md            # Phase 1, Step 2
│   └── sources.md                  # Phase 1, Step 2
├── analysis/
│   ├── findings/
│   │   ├── codebase-*.md           # Phase 1, Step 3
│   │   ├── docs-*.md               # Phase 1, Step 3
│   │   ├── config-*.md             # Phase 1, Step 3
│   │   ├── external-*.md           # Phase 1, Step 3
│   │   └── [custom-category]-*.md  # Phase 1, Step 3 (dynamic categories)
│   └── synthesis.md                # Phase 1, Step 4 (reasoning log)
├── outputs/
│   ├── research-report.md          # Phase 1, Step 4 (main deliverable)
│   ├── solution-exploration.md     # Phase 3 (conditional)
│   ├── high-level-design.md        # Phase 5 (conditional)
│   └── decision-log.md             # Phase 5 (conditional)
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 1 (Step 1) | 1 | Prompt user for clarification if question unclear |
| 1 (Step 2) | 2 | Expand search patterns, use fallback mixed methodology |
| 1 (Step 3) | 3 | Retry failed agents only, continue with successful categories |
| 1 (Step 4) | 2 | Request targeted re-gathering for gaps |
| 2 | 1 | Re-evaluate recommendation if synthesis unclear |
| 3 | 2 | Re-invoke solution-brainstormer with adjusted context |
| 4 | 1 | Re-read exploration file, re-present decision areas |
| 5 | 2 | Re-invoke solution-designer with adjusted context |
| 6 | 0 | Summary only |

---

## Integration with Other Workflows

### As Standalone Research

**Command**: `/maister-research [research-question]`
**Flow**: Complete all phases, save outputs in task directory

### As Embedded Research Phase

**Invoked by**: development orchestrator, migration orchestrator

**Integration**:
1. Parent orchestrator invokes research skill
2. Research executes phases 1-5 (skip Phase 6 completion — parent orchestrator handles next steps)
3. Design outputs fed into parent's specification phase
4. Research report saved in parent task's `analysis/research/` directory

**Handoff**:
```yaml
research_outputs:
  research_report: "[path to outputs/research-report.md]"
  findings_directory: "[path to analysis/findings/]"
  solution_exploration: "[path to outputs/solution-exploration.md]"
  high_level_design: "[path to outputs/high-level-design.md]"
  decision_log: "[path to outputs/decision-log.md]"
```

---

## Command Integration

Invoked via:
- `/maister-research [question] [--type=TYPE] [--brainstorm] [--no-brainstorm] [--design] [--no-design]` (new)
- `/maister-research [task-path] [--from=PHASE]` (resume)

**Brainstorming flags**:
- `--brainstorm`: Force brainstorming phase (auto-resolves Phase 2 brainstorming decision to "enable")
- `--no-brainstorm`: Skip brainstorming phase
- Neither: Phase 2 presents recommendation and asks user

**Design flags**:
- `--design`: Force high-level design phase (auto-resolves Phase 2 design decision to "enable")
- `--no-design`: Skip high-level design phase
- Neither: Phase 2 presents recommendation and asks user

Task directory: `.maister/tasks/research/YYYY-MM-DD-task-name/`
