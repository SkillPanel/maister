# Characteristic Detection

Guides how the product-design workflow detects design characteristics to adapt the depth of its nodes. Prevents "specification as bureaucracy" for simple tasks while ensuring complex designs get thorough exploration.

---

## Purpose

Not every design task needs the same depth. A quick "add a settings page" should not go through the same 8-question exploration as "design a new SaaS product from scratch." Characteristic detection runs once, in the `intake` node, and shapes every node after it.

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

## Node Activation Matrix

Characteristics decide which nodes run and at what depth. Two of them are guards: `intake` turns "greenfield or complex" into `personas_enabled` and "UI-focused" into `prototyping_enabled`, the two bools the definition guards on.

| Node | is_greenfield | is_enhancement | is_ui_focused | is_backend | is_complex | is_simple |
|---|---|---|---|---|---|---|
| `context-synthesis` | User context only | Codebase + user context | -- | -- | -- | -- |
| `problem-exploration` | Full depth (8-10 Qs) | Abbreviated (2-3 Qs) | -- | -- | Full depth | Abbreviated |
| `persona-exploration` | Full (2-3 personas) | Skipped | -- | -- | Full | Skipped |
| `idea-generation` | Full brainstorm | Constrained by existing patterns | -- | -- | Full | Abbreviated |
| `idea-convergence` | Multiple decision areas | Focused on enhancement scope | -- | -- | Multiple areas | 1-2 areas |
| `feature-specification` | Comprehensive sections | Targeted sections | -- | -- | 6-8 sections | 3-4 sections |
| `visual-prototyping` | -- | -- | Active | Skipped | -- | -- |
| `review-handoff` | Full review | Targeted review | -- | -- | Full review | Quick review |

**Reading the matrix**: "--" means the characteristic does not influence that node. Multiple characteristics combine: a `is_greenfield + is_complex + is_ui_focused` task gets full depth everywhere plus visual prototyping. A skipped node's closing gate still fires: `problem-approval` and `specification-approval` close the document before the guarded node as well.

---

## Adaptive Depth Scaling

The complexity axis (`is_simple` / standard / `is_complex`) controls depth across the interactive nodes. `intake` records it as the `complexity_level` value, and the nodes that scale with it receive it in `with:`.

| Complexity | Exploration Questions | Convergence Areas | Spec Sections | Section Depth | Refinement Patience |
|---|---|---|---|---|---|
| Simple | 2-3 | 1-2 | 3-4 | Summary: captures *what* to build (~20-50 lines/section) | 2 iterations (soft cap) |
| Standard | 4-6 | 2-3 | 5-6 | Design-level: *what* + key *how* decisions (~50-100 lines/section) | 3 iterations (soft cap) |
| Complex / Greenfield | 8-10 | 3-5 | 6-8 | Implementation-level: *what* + *how* + edge cases + schemas/contracts (~100-300 lines/section). Developer should be able to start implementation from sections alone. | 3 iterations (soft cap) |

**Standard** is the implicit default when neither `is_simple` nor `is_complex` is detected.

**Refinement patience**: The soft cap on iterative refinement loops before suggesting approval. Not a hard limit -- users can always extend with "One more revision."

---

## User Override Pattern

Detected characteristics are presented to the user inside `intake`, at its confirmation question, before `characteristics-approval`.

**Flow**:
1. `intake` detects characteristics from the task description and codebase signals
2. Its confirmation question presents them with their rationale
3. The user confirms or corrects a misclassification
4. The override is recorded in `design_context.design_characteristics`, and the two guard values are derived from it, before any later node reads them

Under a `cockpit` or `dispatch` driver the question is not asked: the detection stands, and the rationale is in the summary `characteristics-approval` shows. An operator who disagrees stops the run there and restarts with a description that says what the design is.

**Why this matters**: Automated detection can misread intent. A short description might describe a complex system. An existing codebase might be getting a greenfield module. User confirmation prevents the workflow from optimizing for the wrong depth.

---

## Detection Quality Guidance

**Prefer over-detection**: When description is ambiguous, lean toward higher complexity. The cost of unnecessary depth (user approves-and-moves-on through questions) is much lower than the cost of insufficient depth (missing critical requirements discovered during implementation).

**Codebase signals supplement, not override**: A detected UI framework suggests `is_ui_focused`, but the user's task description takes precedence. If they say "add an API endpoint" in a React codebase, trust the description.

**Re-detection is not supported**: Characteristics are set once in `intake` and confirmed by the user. They do not change mid-workflow. If scope changes significantly, the user should start a new design task.

---

This reference provides detection patterns and depth-scaling frameworks. The workflow's node prose, `skills/workflow-engine/workflows/product-design.md`, defines the node logic that consumes these characteristics.
