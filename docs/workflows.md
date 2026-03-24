# Workflow Details

Maister provides five workflow types, each with phases tailored to its needs. All workflows pause between phases for your review and input.

## Development Workflow

The unified development workflow handles features, enhancements, and bug fixes through a 14-phase adaptive pipeline. Phases activate or skip based on task type.

```
/maister:development
/maister:development "Add two-factor authentication"
/maister:development "Fix login timeout" --type=bug
```

When run without arguments, the plugin extracts the task description from your conversation and auto-detects the type (feature, bug, or enhancement). Use `--type=` only when you want to override the auto-detection.

**Flags**: `--type=bug|enhancement|feature`, `--e2e`, `--user-docs`, `--code-review`, `--research=PATH`, `--from=PHASE`

### Phases

| # | Phase | Applies To |
|---|-------|-----------|
| 1 | Codebase analysis + clarifications | All |
| 2 | Gap analysis with decision gates | All |
| 3 | TDD Red gate (write failing test first) | Bug fixes only |
| 4 | UI mockups (ASCII) | Features & enhancements (UI-heavy) |
| 5 | Requirements + specification | All |
| 6 | Specification audit | All (recommended) |
| 7 | Implementation planning | All |
| 8 | Implementation execution | All |
| 9 | TDD Green gate (verify test passes) | Bug fixes only |
| 10 | Verification options selection | All |
| 11 | Verification + issue resolution | All |
| 12 | E2E testing | Optional (`--e2e`) |
| 13 | User documentation | Optional (`--user-docs`) |
| 14 | Finalization | All |

### Research-Based Development

Start development informed by a completed research workflow. Research context flows through all phases:

```
/maister:development "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
```

Research artifacts are copied to `analysis/research-context/` and summaries pass to every subagent.

### Resume

```
/maister:development [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `analysis`, `gap`, `spec`, `plan`, `implement`, `verify`

---

## Performance Optimization

Static code analysis to detect bottlenecks, followed by standard spec/plan/implement/verify pipeline.

```
/maister:performance
/maister:performance "Optimize dashboard loading time"
```

### Phases

| # | Phase |
|---|-------|
| 1 | Codebase analysis + clarifications |
| 2 | Static performance analysis (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks) |
| 3 | Requirements + specification |
| 4 | Specification audit (conditional) |
| 5 | Implementation planning |
| 6 | Implementation execution |
| 7 | Verification options |
| 8 | Verification + issue resolution |
| 9 | Finalization |

**Optional profiling data**: You can provide runtime profiling data, flame graphs, or APM screenshots. The workflow creates `analysis/user-profiling-data/` for these files.

### Resume

```
/maister:performance [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `analysis`, `specification`, `planning`, `implementation`, `verification`

---

## Migration

Technology, data, and architecture migrations with rollback planning and risk assessment.

```
/maister:migration
/maister:migration "Migrate from REST to GraphQL" --type=code
```

**Migration types**: `code`, `data`, `architecture`, `general`

### Phases

| # | Phase |
|---|-------|
| 1 | Current state analysis |
| 2 | Target state planning + gap identification |
| 3 | Migration requirements + strategy specification (includes rollback plan) |
| 4 | Implementation planning |
| 5 | Migration execution |
| 6 | Verification + compatibility testing |
| 7 | Issue resolution (conditional, halts on data integrity issues) |
| 8 | Documentation (optional) |

**Key behaviors**:
- Rollback planning is mandatory
- Dual-run support for zero-downtime migrations
- Halts on data integrity issues (no automatic recovery)
- External research for version upgrades via web search

### Resume

```
/maister:migration [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `analysis`, `target`, `spec`, `plan`, `execute`, `verify`, `docs`

---

## Research

Multi-source research with synthesis, optional solution brainstorming, and high-level design.

```
/maister:research
/maister:research "What authentication approach fits our architecture?" --type=technical
```

**Research types**: `technical`, `requirements`, `literature`, `mixed`

**Flags**: `--brainstorm` (force brainstorming phases), `--no-brainstorm` (skip them)

### Phases

| # | Phase |
|---|-------|
| 1 | Research foundation: initialize → plan methodology → gather information (parallel) → synthesize findings |
| 2 | Brainstorming decision (evaluate value) |
| 3 | Solution brainstorming (HMW questions + user preferences) |
| 4 | High-level design (C4 diagrams + ADR documentation) |
| 5 | Review outputs |
| 6 | Verification (optional) |
| 7 | Integration (optional) |
| 8 | Spawn development workflow (optional) |

Information gathering runs parallel subagents across multiple source categories (codebase, docs, config, external).

### Resume

```
/maister:research [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `foundation`, `brainstorming-decision`, `brainstorming`, `design`, `outputs`, `verification`, `integration`

---

## Product Design

Interactive workflow for designing features and products before building them. Transforms ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Phases adapt based on design characteristics (greenfield vs enhancement, simple vs complex, UI-focused vs backend).

```
/maister:product-design
/maister:product-design "Design a dashboard for monitoring API usage"
/maister:product-design --research=.maister/tasks/research/2026-01-12-auth-research
```

When run without arguments, the plugin extracts the design brief from your conversation.

**Flags**: `--research=PATH`, `--no-visual`, `--from=PHASE`

### Phases

| # | Phase | Activation |
|---|-------|------------|
| 0 | Initialize, gather context & detect characteristics | Always |
| 1 | Context synthesis (codebase analysis or mini-research) | Always (scope adapts) |
| 2 | Problem space exploration (interactive, iterative) | Always (depth adapts) |
| 3 | User & persona exploration | Greenfield or complex designs |
| 4 | Design alternatives generation (agent-driven, unbiased) | Always |
| 5 | Converge on design direction (interactive) | Always |
| 6 | Feature specification, section-by-section (interactive) | Always (depth adapts) |
| 7 | Visual prototyping (browser-based companion with ASCII fallback) | UI-focused designs |
| 8 | Review & hand off product brief | Always |

Phases 2, 5, and 6 include iterative refinement loops — you can request revisions before moving on. Phase 4 uses an agent to generate alternatives without anchoring bias.

The output is a structured product brief that can be passed directly to the development workflow:

```
/maister:development .maister/tasks/product-design/2026-03-10-api-dashboard
```

### Resume

```
/maister:product-design [task-path] [--from=PHASE] [--reset-attempts]
```

Resume phases: `context`, `synthesis`, `problem`, `personas`, `alternatives`, `convergence`, `specification`, `prototyping`, `handoff`

---

## Task Directory Structure

All workflows create structured directories in `.maister/tasks/`:

```
.maister/tasks/
├── development/           # All development tasks (features, bugs, enhancements)
├── performance/           # Performance optimization
├── migrations/            # Migrations
├── research/              # Research
└── product-design/        # Product design
```

Each task folder follows the pattern `YYYY-MM-DD-task-name/`:

```
2026-02-17-user-auth/
├── orchestrator-state.yml        # Workflow state (pause/resume, phase tracking)
├── analysis/
│   ├── requirements.md           # Gathered requirements
│   ├── research-context/         # Research artifacts (if --research used)
│   └── visuals/                  # UI mockups (if UI-heavy)
├── implementation/
│   ├── spec.md                   # Specification (WHAT to build)
│   ├── implementation-plan.md    # Step breakdown (HOW to build it)
│   └── work-log.md              # Chronological activity log
├── verification/                  # Verification reports
└── documentation/                 # User-facing docs (optional)
```

## Internal Skills

These skills are invoked automatically by the orchestrators — you don't call them directly:

| Skill | What It Does |
|-------|-------------|
| **codebase-analyzer** | Launches parallel Explore subagents to analyze your codebase, synthesizes findings into a report |
| **implementer** | Executes implementation plans with mandatory standards reading and test-driven enforcement |
| **implementation-plan-executor** | Adaptive execution (direct for ≤5 steps, delegated for 6+) with continuous standards discovery |
| **implementation-verifier** | Delegates verification to specialized subagents: test runner, code reviewer, pragmatic reviewer, reality assessor, production readiness checker |
| **task-classifier** | Classifies task descriptions into types (bug, feature, enhancement, performance, migration, research) with confidence scoring |
| **docs-manager** | Internal engine for managing `.maister/docs/` structure, INDEX.md, and standards files |
