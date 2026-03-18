---
name: product-design
description: Interactive product/feature design orchestrator. Transforms fuzzy ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Adaptive phases detect design complexity and adjust depth.
user-invocable: true
---

# Product Design Orchestrator

Interactive workflow for product and feature design -- from fuzzy idea to development-ready product brief. Phases adapt based on detected design characteristics (greenfield vs enhancement, simple vs complex, UI-focused vs backend). Uses a hybrid interaction architecture: agents for unbiased generative work, inline interactive phases for convergent and evaluative work. Visual companion renders HTML/CSS mockups in a browser for rich design feedback.

## Initialization

**BEFORE executing any phase, you MUST complete these steps:**

### Step 1: Load Framework Patterns

**Read the framework reference file NOW using the Read tool:**

1. `../orchestrator-framework/references/orchestrator-patterns.md` - Delegation rules, interactive mode, state schema, initialization, context passing, issue resolution

### Step 2: Detect Design Context

**If argument is a design task path** (matches `.maister/tasks/product-design/*`):
- This is a resume — read `orchestrator-state.yml` from that path
- Determine current phase from `completed_phases` and resume from next phase
- If `--from=PHASE` provided, resume from that specific phase

**If `--research=<path>` flag provided**:
- Read research artifacts from specified path (report, synthesis, solution exploration)
- Copy relevant context to `context/research-context/`
- Set `research_reference` in state

### Step 3: Initialize Workflow

1. **Create Task Items**: Use `TaskCreate` for all phases (see Phase Configuration), then set dependencies with `TaskUpdate addBlockedBy`
2. **Create Task Directory**: `.maister/tasks/product-design/YYYY-MM-DD-task-name/`
   - Create `context/` folder with `README.md` instructing users to drop relevant files there (meeting transcripts, existing designs, spreadsheets, docs, PDFs, images)
   - Create `analysis/` and `outputs/` directories
3. **Initialize State**: Create `orchestrator-state.yml` with design context schema (see Domain Context section)

**Output**:
```
Product Design Orchestrator Started

Task: [description]
Directory: [task-path]

Starting Phase 0: Initialize & Gather Context...
```

---

## When to Use

Use for **product and feature design**: defining what to build before building it. Greenfield products, new features, enhancements, API designs, workflow designs.

**DO NOT use for**: Implementation tasks (use `/maister-development`), pure research (use `/maister-research`), bug fixes, performance optimization, migrations.

**When to use this vs development orchestrator**: If you need to explore the problem space, evaluate alternatives, and define requirements interactively before any code is written, use this. If you already know what to build and need to plan and execute, use development.

---

## Local References

| File | When to Read | Purpose |
|------|-------------|---------|
| `references/characteristic-detection.md` | Phase 0 (before detecting characteristics) | Detection signals, phase activation matrix, adaptive depth scaling |
| `references/interaction-patterns.md` | Phase 2 (before first interactive phase) | Cognitive modes, refinement loop pattern, ask_user option design |
| `references/visual-companion.md` | Phase 7 (before visual prototyping) | Server architecture, communication protocol, graceful degradation |

---

## Phase Configuration

| Phase | content | activeForm | Activation | Agent/Skill |
|-------|---------|------------|------------|-------------|
| 0 | "Initialize, gather context & detect characteristics" | "Gathering context & detecting characteristics" | Always | Direct (interactive) |
| 1 | "Synthesize all context sources" | "Synthesizing context" | Always (scope adapts) | codebase-analyzer (if enhancement), information-gatherer (if mini-research) |
| 2 | "Explore problem space" | "Exploring problem space" | Always (depth adapts) | Direct (interactive) |
| 3 | "Explore users & personas" | "Exploring users & personas" | When `is_greenfield` OR `is_complex` | Direct (interactive) |
| 4 | "Generate design alternatives" | "Generating design alternatives" | Always | solution-brainstormer (Task tool) |
| 5 | "Converge on design direction" | "Converging on direction" | Always | Direct (interactive) |
| 6 | "Specify features section-by-section" | "Specifying features" | Always (depth adapts) | Direct (interactive) |
| 7 | "Create visual prototypes" | "Creating visual prototypes" | When `is_ui_focused` | Visual companion + ui-mockup-generator fallback |
| 8 | "Review & hand off product brief" | "Reviewing & assembling brief" | Always | Direct (interactive) |

---

## Process Flow Graph

<!-- GraphViz dot notation: phase-level routing overview. -->

```dot
digraph product_design_orchestrator {
    rankdir=TB;
    node [fontname="Helvetica", fontsize=10];
    edge [fontname="Helvetica", fontsize=9];

    // Entry
    entry [label="Entry", shape=doublecircle, style=bold];

    // Phases
    p0 [label="Phase 0:\nInitialize, Gather\nContext & Detect\nCharacteristics", shape=box];
    p1 [label="Phase 1:\nContext Synthesis", shape=box];
    p2 [label="Phase 2:\nProblem Exploration", shape=box];
    p3 [label="Phase 3:\nUser & Persona\nExploration", shape=box];
    p4 [label="Phase 4:\nIdea Generation\n(agent, unbiased)", shape=box];
    p5 [label="Phase 5:\nIdea Convergence", shape=box];
    p6 [label="Phase 6:\nFeature Specification", shape=box];
    p7 [label="Phase 7:\nVisual Prototyping", shape=box];
    p8 [label="Phase 8:\nReview & Handoff", shape=box];

    // Decision diamonds
    d_refine_problem [label="user satisfied\nwith problem\nstatement?", shape=diamond];
    d_personas [label="is_greenfield\nOR is_complex?", shape=diamond];
    d_refine_convergence [label="user satisfied\nwith direction?", shape=diamond];
    d_refine_spec [label="section\napproved?", shape=diamond];
    d_ui [label="is_ui_focused?", shape=diamond];
    d_refine_mockup [label="mockup\napproved?", shape=diamond];

    // Exit
    end_node [label="End", shape=doublecircle, style=bold];

    // Flow
    entry -> p0;
    p0 -> p1 [label="Pause:\nconfirm characteristics"];

    // Phase 1 always runs (adapts scope)
    p1 -> p2 [label="Pause"];

    // Phase 2 iterative refinement loop
    p2 -> d_refine_problem;
    d_refine_problem -> p2 [label="refine\n(max 3)"];
    d_refine_problem -> d_personas [label="approved"];

    // Phase 3 conditional activation
    d_personas -> p3 [label="true"];
    d_personas -> p4 [label="false\n(skip personas)"];

    // Phase 3 to Phase 4
    p3 -> p4 [label="Pause"];

    // Phase 4 (agent, non-interactive) to Phase 5
    p4 -> p5 [label="AUTO-CONTINUE"];

    // Phase 5 iterative refinement loop
    p5 -> d_refine_convergence;
    d_refine_convergence -> p4 [label="explore more\n(re-generate)"];
    d_refine_convergence -> p5 [label="refine direction\n(max 3)"];
    d_refine_convergence -> p6 [label="approved"];

    // Phase 6 section-by-section with refinement
    p6 -> d_refine_spec;
    d_refine_spec -> p6 [label="revise section\n(max 3 per section)"];
    d_refine_spec -> d_ui [label="all sections\napproved"];

    // Phase 7 conditional on UI focus
    d_ui -> p7 [label="true"];
    d_ui -> p8 [label="false"];

    // Phase 7 mockup refinement loop
    p7 -> d_refine_mockup;
    d_refine_mockup -> p7 [label="revise mockup\n(max 3)"];
    d_refine_mockup -> p8 [label="approved"];

    // Phase 8 to end
    p8 -> end_node [label="Pause:\nfinal approval"];
}
```

---

## Workflow Phases

### Phase 0: Initialize & Gather Context

**Purpose**: Create task directory, detect design characteristics, gather user-supplied context (files, URLs, mini-research topics)
**Execute**: Direct, interactive

1. Create task directory structure (see Task Structure section)
2. **Read `references/characteristic-detection.md` NOW** using the Read tool
3. Analyze user's description to detect the 6 design characteristics: `is_greenfield`, `is_enhancement`, `is_ui_focused`, `is_backend`, `is_complex`, `is_simple`
4. Derive `complexity_level` from characteristics: "simple" (if `is_simple`), "complex" (if `is_complex` or `is_greenfield`), "standard" (otherwise)

5. ask_user — "Do you have additional context to provide?" with options:
   - "I have files to add (I'll drop them in the context/ folder)"
   - "I have external links/URLs to reference"
   - "I need specific topics researched from the web"
   - "Multiple of the above"
   - "No additional context — let's proceed"

6. Based on response:
   - **Files**: Instruct user to drop files in `[task-path]/context/`. Wait for confirmation. Read and catalog files.
   - **URLs**: Collect URLs via ask_user (one question, user provides list). Store in `design_context.collected_urls`.
   - **Mini-research**: Collect research topics via ask_user. Store in `design_context.research_topics`.

7. Present detected characteristics with rationale for user confirmation:

ask_user — "I detected these design characteristics. Please confirm or correct:" with options:
   - "Correct, proceed with these"
   - "Override: [list characteristic corrections]"
   - "Let me explain my thinking"

8. Apply any user overrides to characteristics

**Output**: `orchestrator-state.yml` (characteristics, collected URLs, research topics, user files list)
**State**: Set `design_context.design_characteristics`, `design_context.complexity_level`, `design_context.collected_urls`, `design_context.research_topics`, `design_context.user_files_list`

-> Pause

---

### Phase 1: Context Synthesis

> **Phase gate**: Confirm Phase 0 completion before executing.

**Purpose**: Synthesize ALL context sources into a unified design context document that informs all downstream phases
**Execute**: Skill/Agent + Direct (adapts based on characteristics)

**For enhancements** (`is_enhancement = true`):

**ANTI-PATTERN -- DO NOT DO THIS:**
- "Let me analyze the codebase..." -- STOP. Delegate to codebase-analyzer.
- "I'll look through the project..." -- STOP. Delegate to codebase-analyzer.

**INVOKE NOW** -- Skill tool call:
1. Skill tool - `maister-codebase-analyzer` (to understand existing product context, tech stack, UI patterns)

**SELF-CHECK**: Did you invoke the Skill tool with `maister-codebase-analyzer`? Or did you start reading project files yourself? If the latter, STOP and invoke the Skill tool.

**POST-SKILL CONTINUATION**: After codebase-analyzer returns control:
1. Read `orchestrator-state.yml` to confirm you are the orchestrator
2. Extract codebase analysis summary for context synthesis

**For all tasks** (both greenfield and enhancement):

2. Read all files in `context/` folder (PDFs, images, docs — whatever the user provided)
3. Fetch external links collected in Phase 0 using WebFetch tool for each URL in `design_context.collected_urls`
4. If `design_context.research_topics` is non-empty: launch information-gatherer agents for each topic

   **ANTI-PATTERN -- DO NOT DO THIS:**
   - "Let me research that topic..." -- STOP. Delegate to information-gatherer.
   - "I'll look that up..." -- STOP. Delegate to information-gatherer.

   **INVOKE NOW** -- Task tool call (parallel, one per topic):
   Task tool - `maister-information-gatherer` subagent per research topic

   **Context to pass**: research topic, scope constraints, task_path

   **SELF-CHECK**: Did you invoke the Task tool with information-gatherer for each research topic? Or did you start searching yourself? If the latter, STOP and invoke the Task tool.

5. **Synthesize ALL sources** into `analysis/design-context.md`:
   - Codebase summary (if enhancement): tech stack, UI patterns, existing features, data models
   - User-supplied context summary: key takeaways from each file/link
   - Mini-research findings: relevant discoveries from web research
   - Cross-reference insights: connections between sources
   - Implications for design: what the context means for the design task

6. ask_user — "Context synthesis complete. Key findings: [2-3 bullet summary]. Any corrections or additions before we explore the problem space?"

**Output**: `analysis/design-context.md`
**State**: Update `phase_summaries.context_synthesis`

-> Pause

---

### Phase 2: Problem Exploration

> **Phase gate**: Confirm Phase 1 completion before executing.

**Purpose**: Explore the problem space through structured questioning to produce a refined problem statement, constraints, and success criteria
**Execute**: Direct, inline, interactive

**Read `references/interaction-patterns.md` NOW** using the Read tool — exploration mode patterns

**Mode: Exploration** (announce to user)

> "Let's explore the problem space. I want to understand the core challenge before we start designing solutions..."

1. Ask context-aware exploration questions one at a time. Number of questions scales with complexity:
   - Simple: 2-3 questions
   - Standard: 4-6 questions
   - Complex / greenfield: 8-10 questions

2. After each answer, synthesize understanding before asking the next question. Show the user their previous answer was heard and integrated.

3. After exploration, transition to convergence mode and present a draft problem statement:

> "Based on our exploration, here's what I think we've established..."

Present: problem statement, key constraints, success criteria

4. Enter **iterative refinement loop** (see `references/interaction-patterns.md`):

ask_user — with options:
   - "Approve and continue"
   - "Change the problem scope"
   - "Change the constraints"
   - "Change the success criteria"
   - "Rethink the approach"
   - "Let me explain my thinking"

5. If revision requested: incorporate feedback, present complete revised draft, re-ask. Track `refinement_iterations.phase_2`. After soft cap (2 for simple, 3 for standard/complex): shift options to encourage approval.

**Output**: Problem statement, constraints, success criteria (stored in state, written to `analysis/design-context.md` as appendix or separate section)
**State**: Update `phase_summaries.problem_exploration` with `problem_statement`, `constraints`, `success_criteria`

-> Conditional: check `is_greenfield OR is_complex` -> Phase 3, else -> Phase 4

ask_user — "Problem space explored. [If Phase 3 skipped: 'Skipping persona exploration (enhancement scope). ']Continue to [Phase 3: Persona Exploration / Phase 4: Idea Generation]?"

---

### Phase 3: User & Persona Exploration

> **Phase gate**: Requires `ask_user` confirmation from Phase 2 before executing.

**Purpose**: Develop persona cards and user journeys for the design
**Execute**: Direct, inline, interactive

**Skip if**: NOT (`is_greenfield` OR `is_complex`)

**Mode: Exploration -> Convergence** (transition within phase)

1. **Exploration**: Ask about user types, their goals, pain points, discovery paths. Reference design context from Phase 1.

ask_user — one question at a time about user types and their needs

2. After sufficient exploration, **transition to convergence**:

> "Based on what you've described, let me draft persona cards..."

3. Present persona cards (1-3 depending on complexity) with: name, role, goals, pain points, key journey

4. Enter **iterative refinement loop**:

ask_user — with options:
   - "Approve personas and continue"
   - "Change [persona name]"
   - "Add another persona"
   - "Remove a persona"
   - "Let me explain my thinking"

5. Track `refinement_iterations.phase_3`. Apply soft cap.

**Output**: Persona cards and user journeys (stored in phase summaries)
**State**: Update `phase_summaries.persona_exploration` with `personas`, `user_journeys`

-> Pause

ask_user — "Personas defined. Continue to Idea Generation?"

---

### Phase 4: Idea Generation

> **Phase gate**: Requires `ask_user` confirmation from the preceding phase (Phase 3 if ran, or Phase 2) before executing.

**Purpose**: Generate unbiased design alternatives using the solution-brainstormer agent
**Execute**: Agent via Task tool (deliberately non-interactive to avoid anchoring bias)

**ANTI-PATTERN -- DO NOT DO THIS:**
- "Let me brainstorm some approaches..." -- STOP. Delegate to solution-brainstormer.
- "Here are some alternatives I see..." -- STOP. Delegate to solution-brainstormer.
- "The obvious approach would be..." -- STOP. Anchoring bias. Delegate to solution-brainstormer.

**INVOKE NOW** -- Task tool call:

Task tool - `maister-solution-brainstormer` subagent

**Context to pass** (Pattern 7):
- `task_path`
- `output_path`: `analysis/alternatives.md` -- brainstormer MUST write to this exact path
- `problem_statement` (from Phase 2)
- `constraints` (from Phase 2)
- `personas` (from Phase 3, if available)
- `design_context_summary` (from Phase 1)
- Accumulated context: `complexity_level`, `design_characteristics`, `phase_summaries` (Phases 0-3)

**SELF-CHECK**: After Task tool returns, verify `analysis/alternatives.md` exists and contains alternatives with trade-off analysis. If missing: re-invoke brainstormer with corrected context. If second attempt fails, ask_user to report failure and ask whether to retry or proceed with inline alternatives.

**Output**: `analysis/alternatives.md`
**State**: Update `phase_summaries.idea_generation` with summary of alternatives generated

-> **AUTO-CONTINUE** -- Do NOT end turn, do NOT prompt user. Proceed immediately to Phase 5.

---

### Phase 5: Idea Convergence

**Purpose**: Present brainstorming alternatives to user for evaluation and direction selection
**Execute**: Direct, inline, interactive

**Read `references/interaction-patterns.md` NOW** using the Read tool — convergence mode patterns

**Mode: Convergence** (announce to user)

> "The brainstormer generated several alternative approaches. Let me walk through each decision area so you can evaluate them..."

**ANTI-PATTERN -- DO NOT DO THIS:**
- Do NOT present all decision areas in a single summary table and ask one combined question. Each area MUST get its own detailed presentation and ask_user.
- Do NOT shortcut remaining areas after showing full detail for the first one. EVERY area gets the SAME level of detail.

1. Read `analysis/alternatives.md`
2. For each decision area sequentially:
   a. **Area header**: name and why this decision matters (1-2 sentences)
   b. **Alternatives detail**: For EVERY alternative, show name, description, pros, cons
   c. **Recommendation**: which alternative is recommended and why
   d. ask_user — alternatives as options (mark recommended with "(Recommended)") + "Need more info" + "Let me explain my thinking"
   e. Record choice, move to next area

> **SELF-CHECK before each ask_user**: Did you output the full alternatives with pros/cons for THIS area? If you only showed a recommendation line, STOP and output the full detail.

3. After all areas resolved, present a brief summary of the chosen direction

4. Enter **iterative refinement loop** on the overall direction:

ask_user — with options:
   - "Approve direction and continue to specification"
   - "Refine the direction (adjust choices)"
   - "Explore more (re-generate alternatives)" -> returns to Phase 4
   - "Let me explain my thinking"

5. Track `refinement_iterations.phase_5`. If "Explore more" selected, return to Phase 4 for fresh brainstorming (reset Phase 5 iteration count).

**Output**: Selected approach with rationale (stored in state)
**State**: Update `phase_summaries.idea_convergence` with `selected_approach`, `trade_offs_accepted`, `key_decisions`

-> Pause

ask_user — "Design direction approved. Continue to Feature Specification?"

---

### Phase 6: Feature Specification

> **Phase gate**: Requires `ask_user` confirmation from Phase 5 before executing.

**Purpose**: Build a complete feature specification section-by-section using propose-and-refine
**Execute**: Direct, inline, interactive

**Mode: Convergence** (section-by-section propose-and-refine)

> "Now let's define the specification in detail. I'll draft each section for you to review and refine..."

**ANTI-PATTERN -- DO NOT DO THIS:**
- Do NOT draft all specification sections at once and ask for approval. Each section MUST be proposed, reviewed, and approved individually.
- Do NOT delegate to specification-creator agent. The product brief is authored inline during interactive convergence, not delegated.

Specification sections scale with complexity:
- Simple: 3-4 sections (problem, features, constraints, acceptance criteria)
- Standard: 5-6 sections (+ target users, success metrics)
- Complex: 6-8 sections (+ user journeys, technical considerations, phasing)

For each section:

1. Draft complete section content based on all prior phase context
2. Present the draft section in full

3. Enter **iterative refinement loop** per section:

ask_user — with options:
   - "Approve this section"
   - "Change the scope"
   - "Change the requirements"
   - "Add more detail"
   - "Rethink this section"
   - "Let me explain my thinking"

4. Track `refinement_iterations.phase_6_sections.[section_name]`. Apply soft cap per section.

5. After each approved section, briefly acknowledge and transition to the next

6. After all sections approved, present a brief specification summary

**Output**: Approved specification sections (stored in phase summaries, assembled into product brief in Phase 8)
**State**: Update `phase_summaries.feature_specification` with `spec_sections` (individually approved), `sections_count`

-> Conditional: check `is_ui_focused` -> Phase 7, else -> Phase 8

ask_user — "Specification complete. [If Phase 7 skipped: 'No UI prototyping needed (backend-focused design). ']Continue to [Phase 7: Visual Prototyping / Phase 8: Review & Handoff]?"

---

### Phase 7: Visual Prototyping

> **Phase gate**: Requires `ask_user` confirmation from Phase 6 before executing.

**Purpose**: Generate visual mockups (HTML/CSS via visual companion or ASCII fallback) for UI-focused designs
**Execute**: Visual companion + Direct, with ui-mockup-generator fallback

**Skip if**: NOT `is_ui_focused`

**Read `references/visual-companion.md` NOW** using the Read tool

**Step 1: Check/Start Visual Companion**

1. If `options.visual_enabled` is not `false` (not disabled by `--no-visual` flag):
   a. Check if visual companion server is running: `GET http://localhost:3847/status`
   b. If not running, attempt to start: spawn `node ${SKILL_DIR}/server/index.mjs`
   c. Verify ready: poll `GET /status` (timeout 3 seconds)
   d. If started successfully: open browser via Playwright MCP `browser_navigate` to `http://localhost:[port]` (fallback: `open` command, fallback: log URL)
   e. Update state: `design_context.visual_companion.available = true`, store port
2. If startup fails or `--no-visual` flag: set `visual_companion.fallback_to_ascii = true`

**Step 2: Generate and Review Mockups**

**If visual companion available**:
1. Generate HTML/CSS mockup from specification sections and design decisions
2. POST to visual companion server: `POST http://localhost:[port]/update` with `{type, title, html, css, annotations}`
3. Present for review in terminal (user views rendered mockup in browser)

**If visual companion unavailable** (ASCII fallback):

**ANTI-PATTERN -- DO NOT DO THIS:**
- "Let me create ASCII mockups..." -- STOP. Delegate to ui-mockup-generator.

**INVOKE NOW** -- Task tool call:
Task tool - `maister-ui-mockup-generator` subagent

**Context to pass**: task_path, spec sections from Phase 6, design context from Phase 1, selected approach from Phase 5

**SELF-CHECK**: Did you invoke the Task tool with ui-mockup-generator? Or did you start drawing ASCII mockups yourself? If the latter, STOP and invoke the Task tool.

**Step 3: Iterative Refinement**

Enter **iterative refinement loop**:

ask_user — with options:
   - "Approve mockup and continue"
   - "Change the layout"
   - "Change the content"
   - "Change the interactions"
   - "Add another view/screen"
   - "Let me explain my thinking"

For revisions: regenerate mockup (re-POST to visual companion or re-invoke ui-mockup-generator), present revised version.

Track `refinement_iterations.phase_7`. Apply soft cap.

**Step 4: Save Approved Mockups**

Save final approved mockup(s) to `analysis/mockups/` (HTML files for visual companion, markdown for ASCII)

**Output**: `analysis/mockups/` (mockup files)
**State**: Update `phase_summaries.visual_prototyping` with `mockup_references`, `design_context.visual_companion` status

-> Pause

ask_user — "Visual prototyping complete. Continue to Review & Handoff?"

---

### Phase 8: Review & Handoff

> **Phase gate**: Requires `ask_user` confirmation from the preceding phase before executing.

**Purpose**: Assemble the layered product brief, present for final approval, suggest development handoff
**Execute**: Direct, inline, interactive

1. **Assemble layered product brief** from all phase outputs:

   **Layer 0: Core Brief** (always present):
   - Problem Statement (from Phase 2)
   - Target Users (from Phase 3 if ran, or inline summary from Phase 2)
   - Feature Overview (from Phase 6)
   - Constraints (from Phase 2)
   - Success Criteria (from Phase 2 + Phase 6)
   - Acceptance Criteria (from Phase 6)

   **Layer 1: Persona Cards** (if Phase 3 executed):
   - Per-persona: role, goals, pain points, key journey

   **Layer 2: Design Decisions** (if Phase 5 explored alternatives):
   - Per-decision area: chosen approach, rationale, alternatives considered, trade-offs accepted

   **Layer 3: Mockup References** (if Phase 7 executed):
   - Links to mockup files in `analysis/mockups/`
   - ASCII mockups inline if no visual companion was used

2. Write `outputs/product-brief.md`

3. Present complete brief for final review:

> "Here's the assembled product brief. This is what will be handed off to development..."

4. Enter **iterative refinement loop** (final approval gate):

ask_user — with options:
   - "Approve product brief"
   - "Revise a section"
   - "Add missing information"
   - "Let me explain my thinking"

5. On approval, update task status and suggest next steps:

```
Product brief approved and saved to: [task-path]/outputs/product-brief.md

To start development based on this design, clear context first or start a new session, then run:
/maister-development [task-path]
```

**Output**: `outputs/product-brief.md`
**State**: Set `task.status: completed`, update `phase_summaries.review_handoff`

-> End of workflow

---

## Domain Context (State Extensions)

Product-design-specific fields in `orchestrator-state.yml`:

```yaml
design_context:
  design_characteristics:
    is_greenfield: false
    is_enhancement: false
    is_ui_focused: false
    is_backend: false
    is_complex: false
    is_simple: false
  complexity_level: "standard"  # "simple" | "standard" | "complex"
  collected_urls: []
  research_topics: []
  user_files_list: []
  refinement_iterations:
    phase_2: 0
    phase_3: 0
    phase_5: 0
    phase_6_sections: {}  # per-section tracking: {problem_statement: 1, features: 0, ...}
    phase_7: 0
  visual_companion:
    available: null   # null=not yet checked, true/false after check
    port: null
    pid: null
    fallback_to_ascii: false
  research_reference:
    path: null
    research_question: null
  phase_summaries:
    context_synthesis: {summary: null, sources_count: 0}
    problem_exploration: {problem_statement: null, constraints: [], success_criteria: []}
    persona_exploration: {personas: [], user_journeys: []}
    idea_generation: {alternatives_count: 0, summary: null}
    idea_convergence: {selected_approach: null, trade_offs_accepted: [], key_decisions: []}
    feature_specification: {spec_sections: {}, sections_count: 0}
    visual_prototyping: {mockup_references: [], summary: null}
    review_handoff: {brief_layers: [], summary: null}

options:
  visual_enabled: null  # null=auto-detect, false=--no-visual flag
```

---

## Task Structure

```
.maister/tasks/product-design/YYYY-MM-DD-task-name/
  orchestrator-state.yml           # Phase tracking + design characteristics
  context/                         # User-supplied context materials (Phase 0)
    README.md                      # Instructions: "Drop files here for the design process"
  analysis/
    design-context.md              # Phase 1: unified synthesis of all context sources
    alternatives.md                # Phase 4: brainstormer alternatives
    mockups/                       # Phase 7: visual prototypes
      mockup-*.html                # Visual companion rendered HTML
      ascii-mockups.md             # ASCII fallback
  outputs/
    product-brief.md               # Phase 8: final layered product brief
```

---

## Auto-Recovery

| Phase | Max Attempts | Strategy |
|-------|--------------|----------|
| 0 | 1 | Prompt user for clarification if description unclear |
| 1 | 2 | Re-invoke codebase-analyzer or information-gatherer with adjusted context |
| 2 | 1 | Re-phrase questions if user feedback unclear |
| 3 | 1 | Re-present personas with adjusted framing |
| 4 | 2 | Re-invoke solution-brainstormer with adjusted context |
| 5 | 1 | Re-read alternatives file, re-present decision areas |
| 6 | 1 | Re-draft section with different approach |
| 7 | 2 | Restart visual companion; fallback to ASCII after 2nd failure |
| 8 | 1 | Re-assemble brief from phase outputs |

---

## Command Integration

Invoked via:
- `/maister-product-design [description] [--no-visual] [--research=PATH]` (new)
- `/maister-product-design [task-path] [--from=PHASE]` (resume)

**Flags**:
| Flag | Effect |
|------|--------|
| `--from=PHASE` | Resume from specific phase |
| `--research=PATH` | Import research artifacts into context |
| `--no-visual` | Disable visual companion, use ASCII mockups only |

**Resume**: Pass a task directory path to resume an existing design workflow. The orchestrator reads `orchestrator-state.yml`, determines the current phase from `completed_phases`, and continues.

Task directory: `.maister/tasks/product-design/YYYY-MM-DD-task-name/`

---

## Integration with Other Workflows

### Development Handoff

The product brief is consumed by the development orchestrator:

```
/maister-development .maister/tasks/product-design/YYYY-MM-DD-task-name/
```

The development orchestrator auto-detects the product-design task type and copies the product brief to `analysis/design-context/product-brief.md`, then flows design context through all development phases. The product brief's Layer 0 maps to requirements, design characteristics map to task characteristics, and mockup references feed into UI implementation phases.

### Research Input

A completed research workflow can feed into product design:

```
/maister-product-design "Design feature X" --research=.maister/tasks/research/YYYY-MM-DD-research/
```

Research findings are imported into `context/research-context/` and synthesized alongside other context sources in Phase 1.
