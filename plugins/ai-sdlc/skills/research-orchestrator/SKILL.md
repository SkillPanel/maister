---
name: research-orchestrator
description: Orchestrates comprehensive research workflows from question definition through findings documentation. Handles technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based reporting. Supports standalone research tasks and embedded research phase in other workflows.
---

# Research Orchestrator

Systematic research workflow from question definition to evidence-based documentation.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 1: Load Framework Patterns

**Read ALL framework reference files NOW using the Read tool:**

1. `../orchestrator-framework/references/phase-execution-pattern.md`
2. `../orchestrator-framework/references/interactive-mode.md`
3. `../orchestrator-framework/references/delegation-enforcement.md`
4. `../orchestrator-framework/references/state-management.md`
5. `../orchestrator-framework/references/initialization-pattern.md`
6. `../orchestrator-framework/references/issue-resolution-pattern.md`

### Step 2: Initialize Workflow

1. **Create Task Items**: Use `TaskCreate` for all phases (see Phase Configuration), then set dependencies with `TaskUpdate addBlockedBy`
2. **Create Task Directory**: `.maister/tasks/research/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with mode and research context

**Output**:
```
🚀 Research Orchestrator Started

Task: [research question]
Mode: [Interactive/YOLO]
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
| `references/design-techniques.md` | Phase 4 | Decision documentation (MADR), ADR guidance, decision linking |

---

## Phase Configuration

| Phase | content | activeForm | Agent/Skill |
|-------|---------|------------|-------------|
| 1 | "Research foundation (init, plan, gather, synthesize)" | "Executing research foundation" | Direct + research-planner + information-gatherer (xN) + research-synthesizer |
| 2 | "Evaluate brainstorming value" | "Evaluating brainstorming value" | Direct |
| 3 | "Brainstorm solutions" | "Brainstorming solutions" | Direct + solution-brainstormer |
| 4 | "Design high-level architecture" | "Designing high-level architecture" | Direct + solution-designer |
| 5 | "Review outputs" | "Reviewing outputs" | Direct |
| 6 | "Verify findings" | "Verifying findings" | Direct (optional) |
| 7 | "Integrate into project" | "Integrating into project" | Direct (optional) |
| 8 | "Spawn development" | "Spawning development" | Direct (optional) |

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

#### Step 2: Plan (Subagent)

**Artifacts**: `planning/research-plan.md`, `planning/sources.md`
**Resume check**: If `planning/research-plan.md` AND `planning/sources.md` exist, skip to Step 3

**Read `references/research-methodologies.md` NOW using the Read tool** — research type classification, methodology selection, gathering strategies

**INVOKE NOW**: Use Task tool with `subagent_type: maister:research-planner`

**Context to pass**: task_path, research_brief_path, research_type, research_question, scope

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

**INVOKE NOW**: Use Task tool with `subagent_type: maister:research-synthesizer`

**Context to pass**: task_path, findings_directory_path, research_question, research_type, methodology

**Synthesizer produces**:
- Pattern analysis and cross-references (`analysis/synthesis.md`)
- Comprehensive research report answering research question (`outputs/research-report.md`)
- Confidence levels for each finding
- Documented gaps and uncertainties

Update state: `research_context.confidence_level`

---

→ Pause

**Interactive**: AskUserQuestion - "Research foundation complete (initialized, planned, gathered, synthesized). Continue to brainstorming evaluation?"
**YOLO**: "→ Continuing to Phase 2..."

---

### Phase 2: Brainstorming Decision

**Purpose**: Evaluate whether brainstorming/design phases would be valuable and present recommendation to user
**Execute**: Direct
**Output**: Updated `orchestrator-state.yml`
**State**: Set `options.brainstorming_enabled`, `options.design_enabled`

**Auto-resolve if**: `--brainstorm` flag (force enable) or `--no-brainstorm` flag (force skip)

**Process**:
1. Read `analysis/synthesis.md` summary and `research_type` from state
2. Evaluate brainstorming value based on:
   - Research type (requirements/literature/mixed → likely valuable; technical → depends on synthesis findings)
   - Number of viable approaches identified in synthesis (multiple → valuable)
   - Problem novelty (new domain → valuable; well-understood → less so)
   - Whether synthesis identified competing trade-offs (yes → valuable)
3. Formulate recommendation with brief explanation (2-3 sentences)
4. AskUserQuestion:
   - "[Recommendation explanation]. Would you like to run brainstorming and design phases?"
   - Options: "Yes, explore solutions" / "No, skip to outputs"
5. Update state: set `brainstorming_enabled` and `design_enabled` based on user choice

**YOLO**: Auto-enable brainstorming (brainstorming is valuable by default; YOLO trusts the process)

→ If brainstorming enabled: continue to Phase 3
→ If brainstorming disabled: skip to Phase 5

---

### Phase 3: Solution Brainstorming

**Purpose**: Explore solution alternatives through interactive dialogue and structured brainstorming
**Execute**: Orchestrator-Direct Hybrid
**Output**: `analysis/brainstorm-dialogue.md`, `outputs/solution-exploration.md`
**State**: Update `phase_summaries.phase-2`

**Skip if**: `brainstorming_enabled = false` (user chose to skip in Phase 2, or `--no-brainstorm` flag)

**Read `references/brainstorming-techniques.md` NOW using the Read tool** — divergent/convergent thinking techniques, scope guardrails, interactive exploration patterns

**Part A — HMW Generation (Direct)**:
1. Read `analysis/synthesis.md` + `outputs/research-report.md`
2. Generate 3-5 "How Might We" questions from research findings
3. Present to user via AskUserQuestion for validation and prioritization
4. Save validated HMW questions

**Part B — User Preferences (Direct)**:
5. AskUserQuestion for constraints, priorities, and preferences (4-6 questions, one at a time)
6. Questions build on previous answers (not canned sequences)
7. Save dialogue summary to `analysis/brainstorm-dialogue.md`

**Part C — Solution Generation (Subagent)**:

> **ANTI-PATTERN**: Do NOT generate solution alternatives inline. The solution-brainstormer agent has specialized multi-perspective analysis capabilities.

**INVOKE NOW**: Use Task tool with `subagent_type: maister:solution-brainstormer`

**Context to pass** (Pattern 7):
- `task_path`, `synthesis_path`, `research_report_path`
- `validated_hmw_questions` (from Part A)
- `user_preferences` (from Part B dialogue)
- `brainstorm_dialogue_path` (path to `analysis/brainstorm-dialogue.md`)
- Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries` (Phase 1)

> **SELF-CHECK**: After Task tool returns, verify `outputs/solution-exploration.md` exists and contains alternatives. If missing, this is a CRITICAL failure.

**Part D — Summary & Convergence (Direct)**:
8. Read `outputs/solution-exploration.md`
9. Present executive summary to user before asking for decisions:
   - Number of alternatives generated
   - Name and 1-sentence description of each alternative
   - Key trade-offs identified
   - Recommended approach and why
   - Any deferred ideas or open questions
10. Present recommended approach to user via AskUserQuestion
11. Options: "Proceed with recommended approach" / "Choose different alternative" / "Explore further"
12. If user chooses different: update state with chosen approach

**YOLO mode**: Skip Parts A+B+D. Subagent runs autonomously using research recommendations as defaults. Auto-accept recommended approach.

→ Pause

**Interactive**: AskUserQuestion - "Brainstorming complete. Continue to high-level design?"
**YOLO**: "→ Continuing to Phase 4..."

---

### Phase 4: High-Level Design

**Purpose**: Create architecture design from selected solution approach
**Execute**: Orchestrator-Direct Hybrid
**Output**: `outputs/high-level-design.md`, `outputs/decision-log.md`
**State**: Update `phase_summaries.phase-3`

**Skip if**: Phase 3 was skipped (brainstorming_enabled = false)

**Read `references/design-techniques.md` NOW using the Read tool** — MADR format, ADR guidance, decision documentation patterns

**Part A — Design Direction (Direct)**:
1. Confirm selected approach from Phase 3
2. AskUserQuestion for any design preferences or constraints (e.g., "Any architectural constraints or preferences?")

**Part B — Design Generation (Subagent)**:

> **ANTI-PATTERN**: Do NOT generate C4 architecture diagrams or ADRs inline. The solution-designer agent has specialized architecture and MADR documentation capabilities.

**INVOKE NOW**: Use Task tool with `subagent_type: maister:solution-designer`

**Context to pass** (Pattern 7):
- `task_path`, `solution_exploration_path`, `synthesis_path`, `research_report_path`
- `selected_approach` (from Phase 3 Part D convergence)
- `design_preferences` (from Part A)
- Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries` (Phase 1-3 including brainstorming summary and chosen approach)

> **SELF-CHECK**: After Task tool returns, verify both `outputs/high-level-design.md` and `outputs/decision-log.md` exist. If missing, this is a CRITICAL failure.

**Part C — Summary (Direct)**:
3. Read `outputs/high-level-design.md` and `outputs/decision-log.md`
4. Present executive summary to user:
   - Architecture style and key components
   - Number of architectural decisions recorded
   - Key decision highlights (1 line each)
   - Integration points with existing system (if applicable)

**YOLO mode**: Skip Part A design preferences question. Subagent generates design, present summary checkpoint only.

→ Pause

**Interactive**: AskUserQuestion - "Design complete. Continue to output generation?"
**YOLO**: "→ Continuing to Phase 5..."

---

### Phase 5: Review Outputs

**Purpose**: Present research outputs summary to user and confirm completeness
**Execute**: Direct
**Output**: No new files — reviews existing outputs
**State**: Track output inventory

**Process**:
1. Inventory all generated outputs: `outputs/research-report.md` (always), plus conditional: `solution-exploration.md`, `high-level-design.md`, `decision-log.md`
2. Present summary of what was produced and key findings
3. Ask user if anything is missing or needs expansion

→ Pause

**Interactive**: AskUserQuestion - "Research outputs ready. Continue to verification?"
**YOLO**: "→ Continuing to Phase 6..."

---

### Phase 6: Verification (Optional)

**Purpose**: Verify research quality and completeness
**Execute**: Direct - user review (interactive) or automated checks (YOLO)
**Output**: `verification/verification-report.md`
**State**: Update verification status

**Skip if**: Technical research with high confidence, simple exploratory
**Enable if**: Mixed research, medium/low confidence, critical gaps identified

**Interactive Mode**: Present report, request user review
**YOLO Mode**: Automated checks (citations present, evidence provided, question addressed)

→ Conditional: if integration_enabled continue to Phase 7, else skip to Phase 8 check

---

### Phase 7: Integration (Optional)

**Purpose**: Integrate outputs into project documentation
**Execute**: Direct - save to appropriate locations
**Output**: `integration-manifest.md`
**State**: Track integration status

**Skip if**: Exploratory research not for documentation
**Enable if**: Design artifacts generated, research-report useful as reference

**Process**:
- For design artifacts: Save paths for parent orchestrator
- For research report: Ask user where to reference in `.maister/docs/`

→ Conditional: if design artifacts exist continue to Phase 8, else complete workflow

---

### Phase 8: Spawn Development (Optional)

**Purpose**: Offer to start development workflow with research context
**Execute**: Direct - AskUserQuestion for user decision
**Output**: Development workflow started (if chosen)
**State**: Track spawn decision

**Skip if**: No design artifacts generated OR mode = yolo

**Interactive Mode**:
```
AskUserQuestion:
  Question: "Research produced design artifacts. Start development workflow?"
  Options:
  - "Start development with this research"
  - "Skip - I'll start manually later"
  - "Review outputs first"
```

If user chooses "Start development":
- Invoke Skill: `maister:development-new [current-research-task-path]`

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
      alternatives_count: 0
      chosen_approach: null
      deferred_ideas: []
    phase-4:
      summary: "..."
      architecture_style: null
      decisions_count: 0

options:
  brainstorming_enabled: null  # null=not yet decided, set by Phase 2 or --brainstorm/--no-brainstorm flag
  design_enabled: null          # follows brainstorming_enabled
  verification_enabled: null    # null=auto-detect
  integration_enabled: null
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
│   ├── synthesis.md                # Phase 1, Step 4 (reasoning log)
│   └── brainstorm-dialogue.md      # Phase 3 (interactive mode)
├── outputs/
│   ├── research-report.md          # Phase 1, Step 4 (main deliverable)
│   ├── solution-exploration.md     # Phase 3 (conditional)
│   ├── high-level-design.md        # Phase 4 (conditional)
│   └── decision-log.md             # Phase 4 (conditional)
└── verification/
    └── verification-report.md      # Phase 6 (optional)
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
| 4 | 2 | Re-invoke solution-designer with adjusted context |
| 5 | 1 | Review only, no generation |
| 6 | 0 | Read-only, report only |
| 7 | 0 | Read-only, provide manual guidance |
| 8 | 0 | User decision only |

---

## Integration with Other Workflows

### As Standalone Research

**Command**: `/maister:research-new [research-question]`
**Flow**: Complete all phases, save outputs in task directory

### As Embedded Research Phase

**Invoked by**: development-orchestrator, migration-orchestrator

**Integration**:
1. Parent orchestrator invokes research-orchestrator
2. Research executes phases 1-5 (skip optional phases 6-8)
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
- `/maister:research-new [question] [--yolo] [--type=TYPE] [--brainstorm] [--no-brainstorm]`
- `/maister:research-resume [task-path] [--from=PHASE]`

**Brainstorming flags**:
- `--brainstorm`: Force brainstorming/design phases (auto-resolves Phase 2 to "enable")
- `--no-brainstorm`: Skip brainstorming/design phases (auto-resolves Phase 2 to "skip")
- Neither: Phase 2 presents recommendation and asks user

Task directory: `.maister/tasks/research/YYYY-MM-DD-task-name/`
