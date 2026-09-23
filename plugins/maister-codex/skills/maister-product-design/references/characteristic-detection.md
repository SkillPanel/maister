# Characteristic Detection

Guides how the product-design orchestrator detects design characteristics to adapt phase depth. Prevents "specification as bureaucracy" for simple tasks while ensuring complex designs get thorough exploration.

---

## Purpose

Not every design task needs the same depth. A quick "add a settings page" should not go through the same 8-question exploration as "design a new SaaS product from scratch." Characteristic detection runs once during Phase 0 (Initialization) and shapes every subsequent phase.

**Core idea**: Detect early, confirm with user, adapt throughout.

---

## Six Design Characteristics

| Characteristic | Detection Signals | Mutually Exclusive With |
|---|---|---|
| `is_greenfield` | No existing codebase, "new product/app/tool" language, no `.maister/docs/` present | `is_enhancement` |
| `is_enhancement` | Existing codebase, "add/improve/enhance/extend" language, references existing features | `is_greenfield` |
| `is_ui_focused` | "UI/UX/interface/page/screen/dashboard/form" language, UI framework detected in codebase | -- (can coexist with `is_backend`) |
| `is_backend` | "API/endpoint/service/data/model/schema" language, no UI framework detected | -- (can coexist with `is_ui_focused`) |
| `is_complex` | Long description (>200 words), multiple user types mentioned, cross-cutting concerns, safety-critical domain | `is_simple` |
| `is_simple` | Short description (<50 words), single clear feature, well-defined scope | `is_complex` |

**Mutual exclusivity**: `is_greenfield` and `is_enhancement` cannot both be true. `is_complex` and `is_simple` cannot both be true. UI and backend characteristics can coexist (full-stack designs).

**Default when ambiguous**: When signals are mixed or insufficient, default to higher complexity. Better to ask too many questions and have the user approve-and-move-on than to miss critical context.

---

## Phase Activation Matrix

Characteristics gate which phases activate and at what depth.

| Phase | is_greenfield | is_enhancement | is_ui_focused | is_backend | is_complex | is_simple |
|---|---|---|---|---|---|---|
| 1 (Context Synthesis) | User context only | Codebase + user context | -- | -- | -- | -- |
| 2 (Problem Exploration) | Full depth (8-10 Qs) | Abbreviated (2-3 Qs) | -- | -- | Full depth | Abbreviated |
| 3 (Personas) | Full (2-3 personas) | Skipped | -- | -- | Full | Skipped |
| 4 (Ideation) | Full brainstorm | Constrained by existing patterns | -- | -- | Full | Abbreviated |
| 5 (Convergence) | Multiple decision areas | Focused on enhancement scope | -- | -- | Multiple areas | 1-2 areas |
| 6 (Specification) | Comprehensive sections | Targeted sections | -- | -- | 6-8 sections | 3-4 sections |
| 7 (Visual Prototyping) | -- | -- | Active | Skipped | -- | -- |
| 8 (Refinement) | Full review | Targeted review | -- | -- | Full review | Quick review |

**Reading the matrix**: "--" means the characteristic does not influence that phase. Multiple characteristics combine: a `is_greenfield + is_complex + is_ui_focused` task gets full depth everywhere plus visual prototyping.

---

## Adaptive Depth Scaling

The complexity axis (`is_simple` / standard / `is_complex`) controls depth across interactive phases.

| Complexity | Exploration Questions | Convergence Areas | Spec Sections | Section Depth | Refinement Patience |
|---|---|---|---|---|---|
| Simple | 2-3 | 1-2 | 3-4 | Summary: captures *what* to build (~20-50 lines/section) | 2 iterations (soft cap) |
| Standard | 4-6 | 2-3 | 5-6 | Design-level: *what* + key *how* decisions (~50-100 lines/section) | 3 iterations (soft cap) |
| Complex / Greenfield | 8-10 | 3-5 | 6-8 | Implementation-level: *what* + *how* + edge cases + schemas/contracts (~100-300 lines/section). Developer should be able to start implementation from sections alone. | 3 iterations (soft cap) |

**Standard** is the implicit default when neither `is_simple` nor `is_complex` is detected.

**Refinement patience**: The soft cap on iterative refinement loops before suggesting approval. Not a hard limit -- users can always extend with "One more revision."

---

## User Override Pattern

Detected characteristics are presented to the user at the Phase 0 exit gate for confirmation.

**Flow**:
1. Orchestrator detects characteristics from task description and codebase signals
2. Phase 0 exit gate presents detected characteristics with rationale
3. User confirms or corrects misclassification
4. Override updates `design_characteristics` in orchestrator-state.yml before any phase uses them

**Why this matters**: Automated detection can misread intent. A short description might describe a complex system. An existing codebase might be getting a greenfield module. User confirmation prevents the workflow from optimizing for the wrong depth.

---

## Detection Quality Guidance

**Prefer over-detection**: When description is ambiguous, lean toward higher complexity. The cost of unnecessary depth (user approves-and-moves-on through questions) is much lower than the cost of insufficient depth (missing critical requirements discovered during implementation).

**Codebase signals supplement, not override**: A detected UI framework suggests `is_ui_focused`, but the user's task description takes precedence. If they say "add an API endpoint" in a React codebase, trust the description.

**Re-detection is not supported**: Characteristics are set once during Phase 0 and confirmed by the user. They do not change mid-workflow. If scope changes significantly, the user should start a new design task.

---

This reference provides detection patterns and depth-scaling frameworks. The orchestrator's SKILL.md defines the specific phase logic that consumes these characteristics.
