# Interaction Patterns

Guides interaction quality in the product-design orchestrator's interactive phases. Defines two cognitive modes, the iterative refinement loop, and ask_user option design.

---

## Purpose

Product design is a conversation, not a form. The orchestrator alternates between exploring the problem space and converging on solutions. These patterns ensure that interaction feels like working with a thoughtful design partner rather than filling out a requirements template.

**Core idea**: Exploration opens possibilities. Convergence narrows them. Both require different interaction strategies.

---

## Cognitive Mode Framework

### Exploration Mode

**When**: Phases 2 (Problem Exploration) and 3 (Persona Development)

**Purpose**: Understand the design space before proposing solutions. Discover constraints, motivations, and context that shape the design.

**Principles**:
- **Avoid anchoring bias**: Do not propose solutions during exploration. Premature solutions close off discovery.
- **One major question at a time**: Deep understanding of one area before moving to the next. Batch questions overwhelm and produce shallow answers.
- **Context-aware questions**: Reference codebase analysis findings, user-supplied context, and previous answers. Generic questions waste the user's time.
- **"Need more info" escape hatches**: Always allow the user to say "I need to think about this" or "Not sure yet" without blocking progress.

**Signal to user**: Announce exploration mode explicitly to set expectations.
> "Let's explore who this feature is really for and what problem it solves..."

**Anti-pattern**: Asking "What do you want?" when you have enough context to ask something specific. Exploration questions should demonstrate understanding of the domain.

### Convergence Mode

**When**: Phases 5 (Idea Convergence), 6 (Specification), 7 (Visual Prototyping review), 8 (Specification Refinement)

**Purpose**: Narrow down from explored possibilities to concrete decisions. Present drafts for reaction rather than asking open-ended questions.

**Principles**:
- **Propose-and-refine**: "Editing is cognitively easier than creating." Present concrete drafts for the user to react to rather than asking them to create from scratch.
- **Structured drafts**: Present complete artifacts (not summaries or bullet points) so the user can evaluate the actual output.
- **Aspect-specific feedback**: Guide refinement toward specific dimensions rather than asking "What would you change?"

**Signal to user**: Announce convergence mode to mark the narrative transition.
> "Based on our exploration, here's what I think we've agreed on..."

### Mode Transition

Explicitly announce transitions between modes. This creates a narrative arc that helps the user understand where they are in the process.

> "We've explored the problem space thoroughly. Now let me synthesize what we've discussed into a concrete direction."

**Why explicit transitions matter**: Without them, the shift from open-ended questions to concrete proposals feels abrupt. The user may still be in exploration mindset when you need them to evaluate specifics.

---

## Iterative Refinement Loop Pattern

A new maister pattern for convergence points where artifacts need user approval.

### When to Apply

At every convergence point where the orchestrator produces a draft artifact:
- Phase 2: Problem statement synthesis
- Phase 5: Idea convergence and direction selection
- Phase 6: Specification sections
- Phase 7: Visual mockups
- Phase 8: Final specification review

### Flow

```
Present complete draft → ask_user (approve / change / rethink / add detail / explain)
  → [revision] → present complete revised draft → ask_user (same options)
  → [after soft cap] → ask_user (approve current / one more revision / step back)
```

**Standard options**: "Approve and continue", "Change [aspect A]", "Change [aspect B]", "Rethink the approach", "Add more detail", "Let me explain my thinking"

**Soft cap options** (after iteration limit): "Approve current version and move on", "One more revision", "Step back and rethink"

### Key Rules

**Complete drafts always**: Every revision presents the COMPLETE updated artifact. Never present a diff, a summary of changes, or a table of what changed. The user should be able to evaluate the artifact on its own merits without referencing the previous version.

**Soft cap, not hard limit**: `refinement_iterations.[phase]` tracks iteration count in orchestrator-state.yml. After reaching the soft cap (2 for simple tasks, 3 for standard/complex), the options shift to encourage approval. But the user can always choose "One more revision."

**"Rethink the approach"**: This is a significant action. It signals that incremental changes will not fix the problem. The orchestrator should step back, re-examine assumptions, and present a substantially different draft -- not a minor variation of the previous one.

**Special option in Phase 5**: "Explore more" triggers re-generation by returning to Phase 4 (Ideation) for fresh brainstorming. This acknowledges that sometimes none of the converged ideas feel right.

### State Tracking

```yaml
refinement_iterations:
  phase_2: 1
  phase_5: 0
  phase_6_section_user_stories: 2
  phase_7: 1
```

Track per-phase (or per-section in Phase 6) to apply soft caps independently. A heavily-iterated persona definition should not consume the refinement budget for specification sections.

---

## ask_user Option Design

Options are not just UI -- they shape the conversation. Well-designed options anticipate what the user is likely thinking.

### Exploration Mode Options

Structure: topical choices + escape hatches

**Pattern**:
- 2-4 topical options that advance exploration in specific directions
- "Need more info" or "Not sure yet" option (does not block progress)
- "Let me explain my thinking" (open-ended escape hatch)

**Example** (Phase 2 exploration):
```
- "The main problem is [user frustration with X]"
- "Actually, it's more about [business need Y]"
- "Both are important, but prioritize [X]"
- "Let me explain my thinking"
```

**Why topical options work in exploration**: They demonstrate that the orchestrator is listening and synthesizing. The user confirms, corrects, or elaborates -- all of which deepen understanding faster than open-ended "What else should I know?"

### Convergence Mode Options

Structure: approve + aspect-specific changes + structural options + escape hatch

**Pattern**:
- "Approve and continue" (always first)
- "Change [aspect A]" / "Change [aspect B]" (2-3 specific refinement targets)
- "Rethink the approach" / "Add more detail" (structural options)
- "Let me explain my thinking" (open-ended escape hatch)

**Aspect-specific "Change" options**: Anticipate the most likely refinement areas for the artifact type:
- For a persona: "Change role", "Change goals", "Change pain points"
- For a problem statement: "Change scope", "Change priority", "Change constraints"
- For a spec section: "Change requirements", "Change acceptance criteria", "Change scope"
- For a mockup: "Change layout", "Change content", "Change interactions"

### Universal Rules

**Always include an open-ended escape hatch**: "Let me explain my thinking" covers cases where none of the structured options match the user's intent. Without it, users feel trapped in a multiple-choice quiz.

**Never present all decision areas in a single batch**: One area at a time with full context. Batch decisions produce shallow answers because users optimize for completion speed rather than quality.

**Order matters**: Put the most likely action first. In convergence, that is usually "Approve" (most drafts are close enough). In exploration, lead with the option that advances the conversation most.

---

## Interaction Quality Principles

### Prose is the Conversation

Rich contextual prose BETWEEN ask_user calls is the actual design conversation. ask_user calls are punctuation marks -- they structure the conversation but do not replace it.

**Before asking**: Synthesize what you have learned. Show the user that their previous answer was heard and integrated.
> "Got it -- so the key constraint is that existing users should not need to re-learn navigation. That means we need to extend the current sidebar pattern rather than introducing a new navigation model."

**After receiving an answer**: Acknowledge and bridge to the next question or draft.
> "That makes sense. The two-persona approach (admin vs. viewer) gives us clear boundaries for feature scoping. Let me draft the admin persona first since they have the more complex workflow."

### Synthesis Over Repetition

After each answer, synthesize -- do not merely acknowledge. The synthesis shows understanding and gives the user a chance to correct misinterpretation before it compounds.

**Pattern**: "So what I'm hearing is [synthesis]. [Bridge to next step]."

### Mode Labels at Transitions

Every phase transition between exploration and convergence gets an explicit label. This is not optional -- users need the narrative context to understand why the interaction style is changing.

---

## Anti-Patterns

| Anti-Pattern | Why It Fails | Better Approach |
|---|---|---|
| Summary table of changes across iterations | User must mentally diff two versions | Present complete revised draft every time |
| Skipping mode labels | User is confused by sudden shift from questions to proposals | Always announce "Now let's converge..." |
| Single-round approve-or-reject | No room for iterative refinement | Use the refinement loop with aspect-specific options |
| "What do you want?" in convergence | Shifts cognitive burden to user when you have enough to propose | Use propose-and-refine: present a draft |
| All decision areas in one batch | Produces shallow answers | One area at a time with full context |
| Form-filling: rapid-fire questions without synthesis | Feels like a bureaucratic intake process | Synthesize between questions, show understanding |
| Proposing solutions during exploration | Anchors thinking, closes off discovery | Explore fully before proposing |
| Generic questions ignoring context | Wastes user's time, signals lack of understanding | Reference codebase analysis and prior answers |

---

This reference provides interaction patterns and frameworks. The orchestrator's SKILL.md defines the specific phase logic that applies these patterns.
