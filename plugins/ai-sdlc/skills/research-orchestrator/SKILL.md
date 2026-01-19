---
name: research-orchestrator
description: Orchestrates comprehensive research workflows from question definition through findings documentation. Handles technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based reporting. Supports standalone research tasks and embedded Phase 0 in other workflows.
---

# Research Orchestrator

Systematic research workflow from question definition to evidence-based documentation.

## MANDATORY Initialization (Before Any Phase Work)

**CRITICAL: You MUST complete these steps BEFORE executing any workflow phase:**

### Step 0: Load Framework Patterns

**STOP. You MUST read these files NOW using the Read tool before continuing:**

1. `../orchestrator-framework/references/phase-execution-pattern.md` - 7-step phase loop
2. `../orchestrator-framework/references/delegation-enforcement.md` - Delegation patterns and subagent result handling
3. `../orchestrator-framework/references/interactive-mode.md` - Phase gates and AUTO-CONTINUE
4. `../orchestrator-framework/references/state-management.md` - State file operations

**⚠️ FAILURE TO READ THESE FILES IS A WORKFLOW VIOLATION.**

These patterns define:
- How to execute each phase (7-step loop)
- How to delegate to skills (mandatory patterns)
- When to auto-continue vs pause (Phase Gates and ⚡ AUTO)
- How to consume subagent results and continue workflow
- How to manage orchestrator-state.yml

**SELF-CHECK:**
- [ ] Did you use the Read tool to read all 4 files?
- [ ] Do you understand the AUTO-CONTINUE pattern in interactive-mode.md?
- [ ] Do you understand Pattern 6 (Consuming Subagent Results) in delegation-enforcement.md?

If NO to any: STOP and read the files now.

### Step 1: Create TodoWrite with All Phases

**Immediately use the TodoWrite tool** to create todos for all phases:

```
Use TodoWrite tool with todos:
[
  {"content": "Initialize research", "status": "pending", "activeForm": "Initializing research"},
  {"content": "Plan research methodology", "status": "pending", "activeForm": "Planning research methodology"},
  {"content": "Gather information (parallel)", "status": "pending", "activeForm": "Gathering information in parallel"},
  {"content": "Merge findings", "status": "pending", "activeForm": "Merging findings"},
  {"content": "Analyze and synthesize", "status": "pending", "activeForm": "Analyzing and synthesizing"},
  {"content": "Generate outputs", "status": "pending", "activeForm": "Generating outputs"},
  {"content": "Verify findings", "status": "pending", "activeForm": "Verifying findings"},
  {"content": "Integrate into project", "status": "pending", "activeForm": "Integrating into project"}
]
```

Note: Phase 2 runs 4 agents in parallel. Phases 5-6 (Verify findings, Integrate into project) are optional based on context.

### Step 2: Output Initialization Summary

**Output this summary to the user:**

```
🚀 Research Orchestrator Started

Task: [research question]
Mode: [Interactive/YOLO]
Directory: [task-path]

Workflow phases:
[Todos list with status]

[Interactive mode] You'll be prompted for review after each phase.
[YOLO mode] All phases will run continuously.

Starting Phase 0: Initialize research...
```

### Step 3: Only Then Proceed to Phase 0

After completing Steps 1 and 2, proceed to Phase 0 (Research Initialization).

---

## When to Use This Skill

Use when:
- Need comprehensive research on a topic
- Exploring codebase patterns or architecture
- Gathering requirements or best practices
- Want systematic evidence-based answers
- Research will feed into development workflows

## Core Principles

1. **Evidence-Based**: Every finding must have source citation
2. **Systematic**: Follow structured methodology for consistent results
3. **Multi-Source**: Gather from codebase, docs, config, external sources
4. **Synthesized**: Cross-reference findings, identify patterns
5. **Actionable**: Produce outputs that enable next steps

---

## Local References

Read these during relevant phases:

| File | When to Use | Purpose |
|------|-------------|---------|
| `references/research-methodologies.md` | Phase 1 | Research methodology selection and approach patterns |

---

## Phase Configuration

| Phase | content | activeForm | Agent/Skill |
|-------|---------|------------|-------------|
| 0 | "Initialize research" | "Initializing research" | orchestrator |
| 1 | "Plan research methodology" | "Planning research methodology" | research-planner |
| 2 | "Gather information (parallel)" | "Gathering information in parallel" | information-gatherer (x4) |
| 2.5 | "Merge findings" | "Merging findings" | orchestrator |
| 3 | "Analyze and synthesize" | "Analyzing and synthesizing" | research-synthesizer |
| 4 | "Generate outputs" | "Generating outputs" | orchestrator |
| 5 | "Verify findings" | "Verifying findings" | orchestrator (optional) |
| 6 | "Integrate into project" | "Integrating into project" | orchestrator (optional) |

**Workflow Overview**: 6-8 phases (Phase 2 runs 4 agents in parallel, Phases 5-6 optional)

**CRITICAL TodoWrite Usage**:
1. At workflow start: Create todos for ALL phases using the Phase Configuration table above (all status=pending)
2. Before each phase: Update that phase to status=in_progress
3. After each phase: Update that phase to status=completed

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

### Phase 0: Research Initialization

**Execution**: Main orchestrator (direct)

**Process**:

1. **Parse Research Question** - Extract from command or prompt user
2. **Classify Research Type** - Auto-detect from keywords or use `--type` flag
3. **Determine Scope** - What's in scope, what's excluded, constraints
4. **Define Success Criteria** - How we know research is complete
5. **Create Research Brief** - Save to `planning/research-brief.md`

**Outputs**: `orchestrator-state.yml`, `planning/research-brief.md`

**Success**: Research question clear, type classified, scope defined

**POST-PHASE VALIDATION (Phase 0):**

Before proceeding, verify required files exist:
```bash
ls -la [task-path]/orchestrator-state.yml
ls -la [task-path]/planning/research-brief.md
```

**If any file is missing**: Do NOT proceed. Create the missing file(s) before continuing.

---

## 🚦 GATE: Phase 0 → Phase 1

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 0 (Research Initialization) complete. Ready to proceed to Phase 1 (Research Planning)?"
     - Options: ["Continue to Phase 1", "Review Phase 0 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 1 (Research Planning)..."
   - Proceed to Phase 1

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 1: Research Planning

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/research-planner.md and following its instructions directly
❌ WRONG: Planning research methodology inline in the orchestrator thread
❌ WRONG: Identifying data sources yourself

✅ RIGHT: Using the Task tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 1 to: research-planner subagent
Method: Task tool
Expected outputs: planning/research-plan.md, planning/sources.md
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:research-planner"
  description: "Plan research methodology"
  prompt: |
    You are the research-planner agent. Design research methodology
    and identify data sources.

    Task directory: [task-path]
    Input: planning/research-brief.md

    Please:
    1. Analyze research question and type
    2. Select appropriate methodology
    3. Identify all relevant data sources (codebase, docs, config, external)
    4. Create phased research plan
    5. Define success criteria for each phase

    **MANDATORY FILE CREATION:**
    You MUST create these files before completing:
    - planning/research-plan.md (methodology, approach)
    - planning/sources.md (data sources with access paths)

    Do NOT consolidate this information into your response only.
    Do NOT skip file creation even if research question is simple.
    Write to the files using the Write tool.

    Use only Read, Grep, Glob, Write, and Bash tools. Do NOT modify code.

⏳ Wait for subagent completion before continuing.

**Outputs**: `planning/research-plan.md`, `planning/sources.md`

**SELF-CHECK (before proceeding to Phase 2):**
- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Are `planning/research-plan.md` and `planning/sources.md` present?

If NO to any: STOP - go back and invoke the Task tool.

**Success**: Methodology selected, sources identified (at least one), plan documented

**POST-PHASE VALIDATION (Phase 1):**

Before proceeding, verify required files exist:
```bash
ls -la [task-path]/planning/research-plan.md
ls -la [task-path]/planning/sources.md
```

**If any file is missing**:
- Do NOT proceed to Phase 2
- Re-invoke the research-planner agent with explicit instruction: "You MUST create planning/research-plan.md and planning/sources.md files"
- Only continue when both files exist

---

## 🚦 GATE: Phase 1 → Phase 2

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 1 (Research Planning) complete. Ready to proceed to Phase 2 (Information Gathering)?"
     - Options: ["Continue to Phase 2", "Review Phase 1 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 2 (Information Gathering)..."
   - Proceed to Phase 2

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 2: Information Gathering (Parallel)

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/information-gatherer.md and following its instructions directly
❌ WRONG: Gathering information from sources inline in the orchestrator thread
❌ WRONG: Spawning agents one at a time instead of in parallel
❌ WRONG: Doing information gathering yourself

✅ RIGHT: Using the Task tool 4 times in ONE message for parallel execution

**Output before invoking:**
```
📤 Delegating Phase 2 to: 4 parallel information-gatherer subagents
Method: Task tool (4 calls in ONE message)
Expected outputs: analysis/findings/codebase-*.md, docs-*.md, config-*.md, external-*.md
```

**CRITICAL: Spawn all 4 agents in ONE Task tool message for parallel execution.**

Each agent gathers from ONE source category, runs independently, and writes to non-overlapping files.

**INVOKE NOW (PARALLEL):**

Launch these 4 agents in a SINGLE message with multiple Task tool calls:

```
Use Task tool 4 times in ONE message:

Task 1: Codebase Gatherer
  subagent_type: "ai-sdlc:information-gatherer"
  description: "Gather codebase information"
  prompt: |
    You are the information-gatherer agent with source_category=codebase.

    Task directory: [task-path]
    Source category: codebase

    Inputs:
    - planning/research-plan.md
    - planning/sources.md (filter to "Codebase Sources" section only)

    Please:
    1. Read research plan and filter sources.md to codebase sources only
    2. Execute research phases for codebase sources only
    3. Gather from code files using Glob, Grep, Read
    4. Maintain strict source citations for EVERY finding
    5. Save findings to analysis/findings/codebase-*.md files

    **MANDATORY FILE CREATION:**
    You MUST create at least ONE file: analysis/findings/codebase-findings.md
    (or multiple files like codebase-auth.md, codebase-api.md if findings are large)

    Do NOT put findings only in your response - they MUST be saved to files.
    Even if findings are minimal, create the file with whatever you found.

    IMPORTANT:
    - Only process codebase sources (file patterns, key files, directories)
    - Do NOT create 00-summary.md or 99-verification.md (orchestrator will merge)
    - Use Read, Grep, Glob, Write, and Bash tools. Do NOT modify code.

Task 2: Documentation Gatherer
  subagent_type: "ai-sdlc:information-gatherer"
  description: "Gather documentation information"
  prompt: |
    You are the information-gatherer agent with source_category=documentation.

    Task directory: [task-path]
    Source category: documentation

    Inputs:
    - planning/research-plan.md
    - planning/sources.md (filter to "Documentation Sources" section only)

    Please:
    1. Read research plan and filter sources.md to documentation sources only
    2. Execute research phases for documentation sources only
    3. Gather from docs using Read, Grep on documentation paths
    4. Maintain strict source citations for EVERY finding
    5. Save findings to analysis/findings/docs-*.md files

    **MANDATORY FILE CREATION:**
    You MUST create at least ONE file: analysis/findings/docs-findings.md
    (or multiple files like docs-architecture.md, docs-readme.md if findings are large)

    Do NOT put findings only in your response - they MUST be saved to files.
    Even if findings are minimal, create the file with whatever you found.

    IMPORTANT:
    - Only process documentation sources (project docs, code docs, inline comments)
    - Do NOT create 00-summary.md or 99-verification.md (orchestrator will merge)
    - Use Read, Grep, Glob, Write, and Bash tools. Do NOT modify code.

Task 3: Configuration Gatherer
  subagent_type: "ai-sdlc:information-gatherer"
  description: "Gather configuration information"
  prompt: |
    You are the information-gatherer agent with source_category=configuration.

    Task directory: [task-path]
    Source category: configuration

    Inputs:
    - planning/research-plan.md
    - planning/sources.md (filter to "Configuration Sources" section only)

    Please:
    1. Read research plan and filter sources.md to configuration sources only
    2. Execute research phases for configuration sources only
    3. Gather from config files using Read
    4. Maintain strict source citations for EVERY finding
    5. Save findings to analysis/findings/config-*.md files

    **MANDATORY FILE CREATION:**
    You MUST create at least ONE file: analysis/findings/config-findings.md
    (or multiple files like config-dependencies.md, config-environment.md if findings are large)

    Do NOT put findings only in your response - they MUST be saved to files.
    Even if findings are minimal, create the file with whatever you found.

    IMPORTANT:
    - Only process configuration sources (package.json, .env, docker-compose, etc.)
    - Do NOT create 00-summary.md or 99-verification.md (orchestrator will merge)
    - Use Read, Grep, Glob, Write, and Bash tools. Do NOT modify code.

Task 4: External Gatherer
  subagent_type: "ai-sdlc:information-gatherer"
  description: "Gather external information"
  prompt: |
    You are the information-gatherer agent with source_category=external.

    Task directory: [task-path]
    Source category: external

    Inputs:
    - planning/research-plan.md
    - planning/sources.md (filter to "External Sources" section only)

    Please:
    1. Read research plan and filter sources.md to external sources only
    2. Execute research phases for external sources only
    3. Gather from web using WebSearch, WebFetch
    4. Maintain strict source citations for EVERY finding
    5. Save findings to analysis/findings/external-*.md files

    **MANDATORY FILE CREATION:**
    If external sources exist in sources.md:
    - You MUST create at least ONE file: analysis/findings/external-findings.md
    - Do NOT put findings only in your response - they MUST be saved to files.

    If NO external sources in sources.md:
    - Create analysis/findings/external-no-sources.md with content:
      "No external sources identified in research plan."
    - This confirms you checked but found no external sources to gather.

    IMPORTANT:
    - Only process external sources (URLs, web resources, framework docs)
    - Do NOT create 00-summary.md or 99-verification.md (orchestrator will merge)
    - Use WebSearch, WebFetch, Read, Write, and Bash tools. Do NOT modify code.
```

⏳ Wait for ALL 4 agents to complete before continuing.

**Outputs from Phase 2**: Category-specific findings files only (no summary/verification yet)
- `analysis/findings/codebase-*.md` (from Task 1)
- `analysis/findings/docs-*.md` (from Task 2)
- `analysis/findings/config-*.md` (from Task 3)
- `analysis/findings/external-*.md` (from Task 4, if sources exist)

**SELF-CHECK (before proceeding to Phase 2.5):**
- [ ] Did you invoke 4 Task tools in ONE message? (not sequentially)
- [ ] Did you wait for ALL agents to return results?
- [ ] Are findings files present in `analysis/findings/`?

If NO to any: STOP - go back and invoke all 4 Task tools in ONE message.

**Success**: All 4 agents complete, category-specific findings files exist in `analysis/findings/`

**Note**: If a category has no sources in sources.md, that agent completes quickly with a note.

**POST-PHASE VALIDATION (Phase 2):**

Before proceeding, verify at least one findings file exists:
```bash
ls -la [task-path]/analysis/findings/
```

**Required**: At least one file matching `codebase-*.md`, `docs-*.md`, `config-*.md`, or `external-*.md`

**If no findings files exist**:
- Do NOT proceed to Phase 2.5
- Re-invoke the information-gatherer agents with explicit instruction: "You MUST create findings files in analysis/findings/ directory"
- Only continue when at least one findings file exists

**⏸️ DO NOT STOP** - Proceed directly to Phase 2.5 (Merge Findings) after all agents complete.

---

### Phase 2.5: Merge Findings

**Execution**: Main orchestrator (direct)

**Purpose**: Consolidate parallel gathering results into summary and verification files.

**Process**:

1. **Verify all findings exist**:
   - List all files in `analysis/findings/`
   - Confirm at least one findings file per category (or note if category was empty)

2. **Generate Summary** (`analysis/findings/00-summary.md`):
   - Read all `codebase-*.md`, `docs-*.md`, `config-*.md`, `external-*.md` files
   - Extract key findings from each category
   - Create unified summary with this structure:

   ```markdown
   # Research Findings Summary

   ## Research Question
   [From research-brief.md]

   ## Sources Investigated

   ### Codebase Sources ([N] files)
   [List from codebase-*.md files]

   ### Documentation Sources ([N] docs)
   [List from docs-*.md files]

   ### Configuration Sources ([N] files)
   [List from config-*.md files]

   ### External Sources ([N] resources)
   [List from external-*.md files, or "None" if no external sources]

   ## Key Findings by Category

   ### Codebase Findings
   [Summarize key findings from codebase-*.md]

   ### Documentation Findings
   [Summarize key findings from docs-*.md]

   ### Configuration Findings
   [Summarize key findings from config-*.md]

   ### External Findings
   [Summarize key findings from external-*.md, or "No external sources gathered"]

   ## Gaps and Uncertainties
   [Aggregate gaps from all categories]

   ## Next Steps for Synthesis
   [What synthesis phase should focus on]
   ```

3. **Generate Verification** (`analysis/findings/99-verification.md`):
   - Cross-reference findings across categories
   - Identify contradictions between sources
   - Assess confidence levels for cross-category findings
   - Structure:

   ```markdown
   # Cross-Source Verification

   ## Verification Checks

   ### Code vs Documentation
   [Compare findings from codebase-*.md with docs-*.md]

   ### Code vs Configuration
   [Compare findings from codebase-*.md with config-*.md]

   ### Internal vs External
   [Compare internal findings with external-*.md best practices]

   ## Confidence Assessment

   ### High Confidence Findings
   [Multiple sources confirm]

   ### Medium Confidence Findings
   [Single source or partial evidence]

   ### Low Confidence Findings
   [Unclear or contradictory]

   ## Identified Contradictions
   [List any conflicting information between sources]

   ## Missing Information
   [Gaps identified across all categories]
   ```

**Outputs**: `analysis/findings/00-summary.md`, `analysis/findings/99-verification.md`

**Success**: Summary and verification files created, all findings integrated

**POST-PHASE VALIDATION (Phase 2.5):**

Before proceeding, verify required files exist:
```bash
ls -la [task-path]/analysis/findings/00-summary.md
ls -la [task-path]/analysis/findings/99-verification.md
```

**If any file is missing**: Do NOT proceed. Create the missing file(s) before continuing to Phase 3.

---

## 🚦 GATE: Phase 2.5 → Phase 3

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 2.5 (Merge Findings) complete. Ready to proceed to Phase 3 (Analysis & Synthesis)?"
     - Options: ["Continue to Phase 3", "Review Phase 2.5 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 3 (Analysis & Synthesis)..."
   - Proceed to Phase 3

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 3: Analysis & Synthesis

**⚠️ DELEGATION REQUIRED - DO NOT EXECUTE INLINE**

❌ WRONG: Reading agents/research-synthesizer.md and following its instructions directly
❌ WRONG: Synthesizing findings inline in the orchestrator thread
❌ WRONG: Creating research report yourself

✅ RIGHT: Using the Task tool below and waiting for completion

**Output before invoking:**
```
📤 Delegating Phase 3 to: research-synthesizer subagent
Method: Task tool
Expected outputs: analysis/synthesis.md, analysis/research-report.md
```

**INVOKE NOW:**

Tool: `Task`
Parameters:
  subagent_type: "ai-sdlc:research-synthesizer"
  description: "Analyze and synthesize"
  prompt: |
    You are the research-synthesizer agent. Analyze findings
    and generate comprehensive research report.

    Task directory: [task-path]
    Input: analysis/findings/ (all files)

    Please:
    1. Read all finding files systematically
    2. Cross-reference findings across sources
    3. Identify patterns, themes, relationships
    4. Generate synthesis with pattern analysis
    5. Generate comprehensive research report answering research question
    6. Mark confidence levels (high/medium/low)
    7. Document gaps and uncertainties

    **MANDATORY FILE CREATION:**
    You MUST create BOTH of these files before completing:
    - analysis/synthesis.md (patterns, key insights, cross-source analysis)
    - analysis/research-report.md (comprehensive report answering research question)

    Do NOT consolidate both into one file.
    Do NOT put content only in your response - it MUST be saved to files.
    Even if research is simple, create BOTH files.

    CRITICAL: Every insight must trace to findings, every conclusion evidence-based.

    Use Read, Grep, Glob, Write, and Bash tools. Do NOT modify code.

⏳ Wait for subagent completion before continuing.

**Outputs**: `analysis/synthesis.md`, `analysis/research-report.md`

**SELF-CHECK (before proceeding to Phase 4):**
- [ ] Did you invoke the Task tool? (not just read the agent file)
- [ ] Did you wait for the tool to return results?
- [ ] Are `analysis/synthesis.md` and `analysis/research-report.md` present?

If NO to any: STOP - go back and invoke the Task tool.

**Success**: Research question answered, patterns identified, confidence documented

**POST-PHASE VALIDATION (Phase 3):**

Before proceeding, verify required files exist:
```bash
ls -la [task-path]/analysis/synthesis.md
ls -la [task-path]/analysis/research-report.md
```

**If any file is missing**:
- Do NOT proceed to Phase 4
- Re-invoke the research-synthesizer agent with explicit instruction: "You MUST create analysis/synthesis.md and analysis/research-report.md files"
- Only continue when both files exist

---

## 🚦 GATE: Phase 3 → Phase 4

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 3 (Analysis & Synthesis) complete. Ready to proceed to Phase 4 (Generate Outputs)?"
     - Options: ["Continue to Phase 4", "Review Phase 3 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 4 (Generate Outputs)..."
   - Proceed to Phase 4

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 4: Generate Outputs

**Execution**: Main orchestrator (direct)

**Conditional Outputs** (based on research type):

| Output | Generate If | Skip If |
|--------|------------|---------|
| **Recommendations** | Decision-oriented research, literature comparing approaches | Purely exploratory |
| **Knowledge Base** | Reusable knowledge, technical patterns/architecture | One-off research |
| **Specifications** | Feeds into dev workflow, embedded Phase 0 | Standalone research |

**Process**:

1. **Determine Output Types** - Based on research type and context
2. **Generate Recommendations** (if applicable) - Prioritized, with rationale and evidence
3. **Generate Knowledge Base** (if applicable) - Overview, components, best practices
4. **Generate Specifications** (if applicable) - Requirements, approach, integration

**Outputs**: `outputs/recommendations.md`, `outputs/knowledge-base.md`, `outputs/specifications.md` (conditional)

**Success**: At least research report exists, conditional outputs match context

**POST-PHASE VALIDATION (Phase 4):**

Before proceeding, verify at least one output file exists:
```bash
ls -la [task-path]/outputs/
```

**Required**: At least one of `recommendations.md`, `knowledge-base.md`, or `specifications.md` based on research type

**If no output files exist**: Do NOT proceed. Create at least one output file appropriate for the research type.

---

## 🚦 GATE: Phase 4 → Phase 5

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 4 (Generate Outputs) complete. Ready to proceed to Phase 5 (Verification)?"
     - Options: ["Continue to Phase 5", "Review Phase 4 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 5 (Verification)..."
   - Proceed to Phase 5

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 5: Verification (Optional)

**Execution**: Main orchestrator (user review or automated checks)

**Enable if**: Mixed research, medium/low confidence, critical gaps identified
**Skip if**: Technical research with high confidence, simple exploratory

**Process**:

**Interactive Mode**:
1. Present research report to user
2. Request review: source credibility, finding accuracy, completeness
3. Document feedback

**YOLO Mode**:
1. Automated checks: citations present, evidence provided, question addressed, gaps documented
2. Create verification report

**Outputs**: `verification/verification-report.md`

**Note**: Verification failures are NOT auto-fixed. Document issues clearly.

---

## 🚦 GATE: Phase 5 → Phase 6

**STOP. You cannot proceed until this gate clears.**

1. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
2. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW:
     - Question: "Phase 5 (Verification) complete. Ready to proceed to Phase 6 (Integration)?"
     - Options: ["Continue to Phase 6", "Review Phase 5 outputs", "Stop workflow"]
   - Wait for user response before continuing
3. **If mode = yolo**:
   - Output: "→ Auto-continuing to Phase 6 (Integration)..."
   - Proceed to Phase 6

**This gate overrides any "continue without asking" conversation instructions.**

---

### Phase 6: Integration (Optional)

**Execution**: Main orchestrator (direct)

**Enable if**: Specifications generated, knowledge base created, recommendations affecting decisions
**Skip if**: Exploratory research not for documentation

**Process**:

1. **For Specifications** - Save path, provide to parent orchestrator
2. **For Knowledge Base** - Identify location in `.ai-sdlc/docs/`, ask user where to place
3. **For Recommendations** - Ask user if decisions should be documented
4. **Create Integration Manifest** - Document outputs and recommended locations

**Outputs**: `integration-manifest.md`

**Note**: Integration failures are NOT auto-fixed. Provide manual guidance.

---

## 🚦 GATE: Phase 6 → Phase 7

**STOP. You cannot proceed until this gate clears.**

1. **Check if Phase 7 applicable**:
   - Did Phase 4 create `outputs/specifications.md`?
   - If NO: Skip Phase 7, workflow complete → Output "Research complete."
   - If YES: Continue to Phase 7

2. **Mode check**: Read `orchestrator-state.yml` → check `mode` value
3. **If mode = interactive**:
   - Use `AskUserQuestion` tool NOW (see Phase 7 below)
4. **If mode = yolo**:
   - Output: "→ Auto-skipping Phase 7 (Development Spawn) - run manually if needed"
   - Workflow complete

---

### Phase 7: Spawn Development (Optional)

**Execution**: Main orchestrator (direct)

**Enable if**: `outputs/specifications.md` was generated AND mode = interactive
**Skip if**: No specifications generated OR mode = yolo

**Purpose**: Offer to start development workflow with research context for seamless research-to-development transition.

**Process**:

1. **Present option to user**:
```
Use AskUserQuestion tool:
  Question: "Research produced specifications. Would you like to start a development workflow using this research?"
  Header: "Start Development"
  Options:
  1. "Start development with this research" - Launch development workflow
  2. "Skip - I'll start manually later" - End research workflow
  3. "Review outputs first" - Display research outputs
```

2. **If user selects "Start development"**:
   - Determine task type from specifications (feature/enhancement based on content)
   - Get current research task path

   **INVOKE:**
   ```
   Tool: Skill
   Parameters:
     skill: "ai-sdlc:development:new"
     args: "[current-research-task-path]"
   ```

   The development workflow will auto-detect the research folder and load context.

3. **If user selects "Skip"**:
   - Output: "Research complete. To start development later, run:"
   - Display: `/ai-sdlc:development:new [task-path]`
   - Mark workflow complete

4. **If user selects "Review outputs"**:
   - Display paths to all generated outputs:
     - `analysis/research-report.md`
     - `outputs/specifications.md`
     - `outputs/recommendations.md` (if exists)
   - Re-prompt with same AskUserQuestion

**YOLO Mode**: Skip Phase 7 entirely (user can invoke development manually)

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

options:
  verification_enabled: null  # null=auto-detect
  integration_enabled: null
```

---

## Task Structure

```
.ai-sdlc/tasks/research/YYYY-MM-DD-research-name/
├── orchestrator-state.yml            # Execution state + task metadata
├── planning/
│   ├── research-brief.md
│   ├── research-plan.md
│   └── sources.md
├── analysis/
│   ├── findings/
│   │   ├── 00-summary.md
│   │   ├── codebase-*.md
│   │   ├── docs-*.md
│   │   ├── config-*.md
│   │   └── external-*.md
│   ├── synthesis.md
│   └── research-report.md
├── outputs/
│   ├── recommendations.md
│   ├── knowledge-base.md
│   └── specifications.md
└── verification/
    └── verification-report.md
```

---

## Mandatory Files by Phase

**CRITICAL**: These files MUST exist before proceeding to the next phase. Do NOT skip file creation even for simple research tasks.

| Phase | Required Files | Validation Criteria |
|-------|---------------|---------------------|
| 0 | `orchestrator-state.yml`, `planning/research-brief.md` | Both files must exist |
| 1 | `planning/research-plan.md`, `planning/sources.md` | Both files must exist with non-empty content |
| 2 | At least one file in `analysis/findings/` matching `codebase-*.md`, `docs-*.md`, `config-*.md`, or `external-*.md` | Directory contains at least one findings file |
| 2.5 | `analysis/findings/00-summary.md`, `analysis/findings/99-verification.md` | Both files must exist |
| 3 | `analysis/synthesis.md`, `analysis/research-report.md` | Both files must exist with substantive content |
| 4 | At least one file in `outputs/` (`recommendations.md`, `knowledge-base.md`, or `specifications.md`) | At least one output based on research type |

**Why This Matters**: Without intermediate artifacts, research is not traceable, not auditable, and cannot be resumed. Every phase builds on previous outputs.

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 0 | 1 | Prompt user for clarification if question unclear |
| 1 | 2 | Expand search patterns, use fallback mixed methodology |
| 2 | 3 | Retry failed agents only, continue with successful categories |
| 2.5 | 2 | Merge available findings, note missing categories in summary |
| 3 | 2 | Request targeted re-gathering for gaps, synthesize with limitations |
| 4 | 2 | Generate standard outputs based on type, ask user in interactive |
| 5 | 0 | Read-only, report only |
| 6 | 0 | Read-only, provide manual guidance |

---

## Integration with Other Workflows

### As Standalone Research

**Command**: `/ai-sdlc:research:new [research-question]`

**Flow**: Complete 7-phase workflow, save all outputs in task directory

### As Embedded Phase 0

**Invoked by**: development-orchestrator (feature, enhancement), migration-orchestrator

**Integration**:
1. Parent orchestrator invokes research-orchestrator
2. Research executes phases 0-4 (skip optional phases 5-6)
3. Specifications output fed into parent's specification phase
4. Research report saved in parent task's `analysis/research/` directory

**Handoff**:
```yaml
research_outputs:
  specifications: "[path to specifications.md]"
  research_report: "[path to research-report.md]"
  findings_directory: "[path to findings/]"
```

---

## Command Integration

Invoked via:
- `/ai-sdlc:research:new [question] [--yolo] [--type=TYPE]`
- `/ai-sdlc:research:resume [task-path]`

Task directory: `.ai-sdlc/tasks/research/YYYY-MM-DD-task-name/`

---

## Success Criteria

Workflow successful when:

- Research question clearly defined and classified
- Methodology selected and sources identified
- Information gathered from multiple sources with citations
- Findings synthesized with pattern identification
- Research report answers original question
- Appropriate conditional outputs generated
- Confidence levels documented
- Ready for integration or handoff to parent workflow
