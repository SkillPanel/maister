---
name: research-orchestrator
description: Orchestrates comprehensive research workflows from question definition through findings documentation. Handles technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based reporting. Supports standalone research tasks and embedded Phase 0 in other workflows.
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
2. **Create Task Directory**: `.ai-sdlc/tasks/research/YYYY-MM-DD-task-name/`
3. **Initialize State**: Create `orchestrator-state.yml` with mode and research context

**Output**:
```
🚀 Research Orchestrator Started

Task: [research question]
Mode: [Interactive/YOLO]
Directory: [task-path]

Starting Phase 0: Initialize research...
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
| `references/research-methodologies.md` | Phase 0 (Step 2), Phase 2 | Research methodology, brainstorming and design techniques |

---

## Phase Configuration

| Phase | content | activeForm | Agent/Skill |
|-------|---------|------------|-------------|
| 0 | "Research foundation (init, plan, gather, synthesize)" | "Executing research foundation" | Direct + research-planner + information-gatherer (xN) + research-synthesizer |
| 1 | "Evaluate brainstorming value" | "Evaluating brainstorming value" | Direct |
| 2 | "Brainstorm solutions" | "Brainstorming solutions" | Direct + solution-brainstormer |
| 3 | "Design high-level architecture" | "Designing high-level architecture" | Direct + solution-designer |
| 4 | "Generate outputs" | "Generating outputs" | Direct |
| 5 | "Verify findings" | "Verifying findings" | Direct (optional) |
| 6 | "Integrate into project" | "Integrating into project" | Direct (optional) |
| 7 | "Spawn development" | "Spawning development" | Direct (optional) |

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

### Phase 0: Research Foundation

**Purpose**: Initialize research, plan methodology, gather information from all sources, and synthesize findings into a research report
**Execute**: Multi-step: Direct + research-planner + information-gatherer (xN) + research-synthesizer
**Output**: `planning/research-brief.md`, `planning/research-plan.md`, `planning/sources.md`, `analysis/findings/*.md`, `analysis/findings/00-summary.md`, `analysis/findings/99-verification.md`, `analysis/synthesis.md`, `analysis/research-report.md`
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

**INVOKE NOW**: Use Task tool with `subagent_type: ai-sdlc:research-planner`

**Context to pass**: task_path, research_brief_path, research_type, research_question, scope

Update state: `research_context.methodology`, `sources`

#### Step 3: Gather + Merge (Parallel Subagents + Direct)

**Artifacts**: `analysis/findings/*.md` (category-specific), `analysis/findings/00-summary.md`, `analysis/findings/99-verification.md`
**Resume check**: If `analysis/findings/00-summary.md` AND `analysis/findings/99-verification.md` exist, skip to Step 4

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

**After all agents complete, merge findings:**

Read `analysis/findings/` directory using Glob `analysis/findings/*.md` (excluding `00-summary.md` and `99-verification.md`). Group files by their prefix (the category ID).

**Summary Structure** (`00-summary.md`):
- Research question (from brief)
- Sources investigated by category
- Key findings by category
- Gaps and uncertainties
- Next steps for synthesis

**Verification Structure** (`99-verification.md`):
- Cross-source verification checks
- Confidence assessment (high/medium/low)
- Identified contradictions
- Missing information

#### Step 4: Synthesize (Subagent)

**Artifacts**: `analysis/synthesis.md`, `analysis/research-report.md`
**Resume check**: If `analysis/synthesis.md` AND `analysis/research-report.md` exist, skip (Phase 0 complete)

**INVOKE NOW**: Use Task tool with `subagent_type: ai-sdlc:research-synthesizer`

**Context to pass**: task_path, findings_summary_path, research_question, research_type, methodology

**Synthesizer produces**:
- Pattern analysis and cross-references
- Comprehensive research report answering research question
- Confidence levels for each finding
- Documented gaps and uncertainties

Update state: `research_context.confidence_level`

---

→ Pause

**Interactive**: AskUserQuestion - "Research foundation complete (initialized, planned, gathered, synthesized). Continue to brainstorming evaluation?"
**YOLO**: "→ Continuing to Phase 1..."

---

### Phase 1: Brainstorming Decision

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

→ If brainstorming enabled: continue to Phase 2
→ If brainstorming disabled: skip to Phase 4

---

### Phase 2: Solution Brainstorming

**Purpose**: Explore solution alternatives through interactive dialogue and structured brainstorming
**Execute**: Orchestrator-Direct Hybrid
**Output**: `analysis/brainstorm-dialogue.md`, `outputs/solution-exploration.md`
**State**: Update `phase_summaries.phase-2`

**Skip if**: `brainstorming_enabled = false` (user chose to skip in Phase 1, or `--no-brainstorm` flag)

**Part A — HMW Generation (Direct)**:
1. Read `analysis/synthesis.md` + `analysis/research-report.md`
2. Generate 3-5 "How Might We" questions from research findings
3. Present to user via AskUserQuestion for validation and prioritization
4. Save validated HMW questions

**Part B — User Preferences (Direct)**:
5. AskUserQuestion for constraints, priorities, and preferences (4-6 questions, one at a time)
6. Questions build on previous answers (not canned sequences)
7. Save dialogue summary to `analysis/brainstorm-dialogue.md`

**Part C — Solution Generation (Subagent)**:

> **ANTI-PATTERN**: Do NOT generate solution alternatives inline. The solution-brainstormer agent has specialized multi-perspective analysis capabilities.

**INVOKE NOW**: Use Task tool with `subagent_type: ai-sdlc:solution-brainstormer`

**Context to pass** (Pattern 7):
- `task_path`, `synthesis_path`, `research_report_path`
- `validated_hmw_questions` (from Part A)
- `user_preferences` (from Part B dialogue)
- `brainstorm_dialogue_path` (path to `analysis/brainstorm-dialogue.md`)
- Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries` (Phase 0)

> **SELF-CHECK**: After Task tool returns, verify `outputs/solution-exploration.md` exists and contains alternatives. If missing, this is a CRITICAL failure.

**Part D — Convergence (Direct)**:
8. Read `outputs/solution-exploration.md`
9. Present recommended approach to user via AskUserQuestion
10. Options: "Proceed with recommended approach" / "Choose different alternative" / "Explore further"
11. If user chooses different: update state with chosen approach

**YOLO mode**: Skip Parts A+B+D. Subagent runs autonomously using research recommendations as defaults. Auto-accept recommended approach.

→ Pause

**Interactive**: AskUserQuestion - "Brainstorming complete. Continue to high-level design?"
**YOLO**: "→ Continuing to Phase 3..."

---

### Phase 3: High-Level Design

**Purpose**: Create architecture design from selected solution approach
**Execute**: Orchestrator-Direct Hybrid
**Output**: `outputs/high-level-design.md`, `outputs/decision-log.md`
**State**: Update `phase_summaries.phase-3`

**Skip if**: Phase 2 was skipped (brainstorming_enabled = false)

**Part A — Design Direction (Direct)**:
1. Confirm selected approach from Phase 2
2. AskUserQuestion for any design preferences or constraints (e.g., "Any architectural constraints or preferences?")

**Part B — Design Generation (Subagent)**:

> **ANTI-PATTERN**: Do NOT generate C4 architecture diagrams or ADRs inline. The solution-designer agent has specialized architecture and MADR documentation capabilities.

**INVOKE NOW**: Use Task tool with `subagent_type: ai-sdlc:solution-designer`

**Context to pass** (Pattern 7):
- `task_path`, `solution_exploration_path`, `synthesis_path`, `research_report_path`
- `selected_approach` (from Phase 2 Part D convergence)
- `design_preferences` (from Part A)
- Accumulated context: `research_type`, `research_question`, `confidence_level`, `phase_summaries` (Phase 0-2 including brainstorming summary and chosen approach)

> **SELF-CHECK**: After Task tool returns, verify both `outputs/high-level-design.md` and `outputs/decision-log.md` exist. If missing, this is a CRITICAL failure.

**YOLO mode**: Skip Part A design preferences question. Subagent generates design, present summary checkpoint only.

→ Pause

**Interactive**: AskUserQuestion - "Design complete. Continue to output generation?"
**YOLO**: "→ Continuing to Phase 4..."

---

### Phase 4: Generate Outputs

**Purpose**: Generate conditional outputs based on research type
**Execute**: Direct - create appropriate output files
**Output**: `outputs/recommendations.md`, `outputs/knowledge-base.md`, `outputs/specifications.md` (conditional)
**State**: Track generated outputs

**Note**: If brainstorming/design phases ran, `outputs/solution-exploration.md`, `outputs/high-level-design.md`, and `outputs/decision-log.md` already exist. This phase generates additional outputs as needed.

**Conditional Outputs**:
| Output | Generate If | Skip If |
|--------|------------|---------|
| **Recommendations** | Decision-oriented research, comparing approaches | Purely exploratory |
| **Knowledge Base** | Reusable knowledge, technical patterns | One-off research |
| **Specifications** | Feeds into dev workflow, embedded Phase 0 | Standalone research |

→ Pause

**Interactive**: AskUserQuestion - "Outputs generated. Continue to verification?"
**YOLO**: "→ Continuing to Phase 5..."

---

### Phase 5: Verification (Optional)

**Purpose**: Verify research quality and completeness
**Execute**: Direct - user review (interactive) or automated checks (YOLO)
**Output**: `verification/verification-report.md`
**State**: Update verification status

**Skip if**: Technical research with high confidence, simple exploratory
**Enable if**: Mixed research, medium/low confidence, critical gaps identified

**Interactive Mode**: Present report, request user review
**YOLO Mode**: Automated checks (citations present, evidence provided, question addressed)

→ Conditional: if integration_enabled continue to Phase 6, else skip to Phase 7 check

---

### Phase 6: Integration (Optional)

**Purpose**: Integrate outputs into project documentation
**Execute**: Direct - save to appropriate locations
**Output**: `integration-manifest.md`
**State**: Track integration status

**Skip if**: Exploratory research not for documentation
**Enable if**: Specifications generated, knowledge base created

**Process**:
- For specifications: Save path for parent orchestrator
- For knowledge base: Ask user where to place in `.ai-sdlc/docs/`
- For recommendations: Ask if decisions should be documented

→ Conditional: if specifications or design artifacts exist continue to Phase 7, else complete workflow

---

### Phase 7: Spawn Development (Optional)

**Purpose**: Offer to start development workflow with research context
**Execute**: Direct - AskUserQuestion for user decision
**Output**: Development workflow started (if chosen)
**State**: Track spawn decision

**Skip if**: No specifications or design artifacts generated OR mode = yolo

**Interactive Mode**:
```
AskUserQuestion:
  Question: "Research produced specifications/design. Start development workflow?"
  Options:
  - "Start development with this research"
  - "Skip - I'll start manually later"
  - "Review outputs first"
```

If user chooses "Start development":
- Invoke Skill: `ai-sdlc:development:new [current-research-task-path]`

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
    phase-0:
      summary: "..."
      steps_completed: []  # track which steps completed for resume
    phase-2:
      summary: "..."
      alternatives_count: 0
      chosen_approach: null
      deferred_ideas: []
    phase-3:
      summary: "..."
      architecture_style: null
      decisions_count: 0

options:
  brainstorming_enabled: null  # null=not yet decided, set by Phase 1 or --brainstorm/--no-brainstorm flag
  design_enabled: null          # follows brainstorming_enabled
  verification_enabled: null    # null=auto-detect
  integration_enabled: null
```

---

## Task Structure

```
.ai-sdlc/tasks/research/YYYY-MM-DD-research-name/
├── orchestrator-state.yml
├── planning/
│   ├── research-brief.md           # Phase 0, Step 1
│   ├── research-plan.md            # Phase 0, Step 2
│   └── sources.md                  # Phase 0, Step 2
├── analysis/
│   ├── findings/
│   │   ├── 00-summary.md           # Phase 0, Step 3 (merge)
│   │   ├── 99-verification.md      # Phase 0, Step 3 (merge)
│   │   ├── codebase-*.md           # Phase 0, Step 3
│   │   ├── docs-*.md               # Phase 0, Step 3
│   │   ├── config-*.md             # Phase 0, Step 3
│   │   ├── external-*.md           # Phase 0, Step 3
│   │   └── [custom-category]-*.md  # Phase 0, Step 3 (dynamic categories)
│   ├── synthesis.md                # Phase 0, Step 4
│   ├── research-report.md          # Phase 0, Step 4
│   └── brainstorm-dialogue.md      # Phase 2 (interactive mode)
├── outputs/
│   ├── solution-exploration.md     # Phase 2 (conditional)
│   ├── high-level-design.md        # Phase 3 (conditional)
│   ├── decision-log.md             # Phase 3 (conditional)
│   ├── recommendations.md          # Phase 4 (conditional)
│   ├── knowledge-base.md           # Phase 4 (conditional)
│   └── specifications.md           # Phase 4 (conditional)
└── verification/
    └── verification-report.md      # Phase 5 (optional)
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 0 (Step 1) | 1 | Prompt user for clarification if question unclear |
| 0 (Step 2) | 2 | Expand search patterns, use fallback mixed methodology |
| 0 (Step 3 gather) | 3 | Retry failed agents only, continue with successful categories |
| 0 (Step 3 merge) | 2 | Merge available findings, note missing categories |
| 0 (Step 4) | 2 | Request targeted re-gathering for gaps |
| 1 | 1 | Re-evaluate recommendation if synthesis unclear |
| 2 | 2 | Re-invoke solution-brainstormer with adjusted context |
| 3 | 2 | Re-invoke solution-designer with adjusted context |
| 4 | 2 | Generate standard outputs, ask user in interactive |
| 5 | 0 | Read-only, report only |
| 6 | 0 | Read-only, provide manual guidance |
| 7 | 0 | User decision only |

---

## Integration with Other Workflows

### As Standalone Research

**Command**: `/ai-sdlc:research:new [research-question]`
**Flow**: Complete all phases, save outputs in task directory

### As Embedded Phase 0

**Invoked by**: development-orchestrator, migration-orchestrator

**Integration**:
1. Parent orchestrator invokes research-orchestrator
2. Research executes phases 0-4 (skip optional phases 5-7)
3. Specifications and design outputs fed into parent's specification phase
4. Research report saved in parent task's `analysis/research/` directory

**Handoff**:
```yaml
research_outputs:
  specifications: "[path to specifications.md]"
  research_report: "[path to research-report.md]"
  findings_directory: "[path to findings/]"
  solution_exploration: "[path to solution-exploration.md]"
  high_level_design: "[path to high-level-design.md]"
  decision_log: "[path to decision-log.md]"
```

---

## Command Integration

Invoked via:
- `/ai-sdlc:research:new [question] [--yolo] [--type=TYPE] [--brainstorm] [--no-brainstorm]`
- `/ai-sdlc:research:resume [task-path] [--from=PHASE]`

**Brainstorming flags**:
- `--brainstorm`: Force brainstorming/design phases (auto-resolves Phase 1 to "enable")
- `--no-brainstorm`: Skip brainstorming/design phases (auto-resolves Phase 1 to "skip")
- Neither: Phase 1 presents recommendation and asks user

Task directory: `.ai-sdlc/tasks/research/YYYY-MM-DD-task-name/`
