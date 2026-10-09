# Interaction Patterns

Guides interaction quality in the product-design workflow's interactive nodes. Defines two cognitive modes, the iterative refinement loop, and AskUserQuestion option design.

---

## Purpose

Product design is a conversation, not a form. The workflow alternates between exploring the problem space and converging on solutions. These patterns ensure that interaction feels like working with a thoughtful design partner rather than filling out a requirements template.

**Core idea**: Exploration opens possibilities. Convergence narrows them. Both require different interaction strategies.

---

## Cognitive Mode Framework

### Exploration Mode

**When**: `problem-exploration` and `persona-exploration`

**Purpose**: Understand the design space before proposing solutions. Discover constraints, motivations, and context that shape the design.

**Principles**:
- **Avoid anchoring bias**: Do not propose solutions during exploration. Premature solutions close off discovery.
- **Pages of independent questions**: Up to four questions to a page, each standing on its own; a question whose framing depends on another's answer waits for the next page, which builds on the answers before it. Decision areas are never paged — they belong to convergence.
- **Context-aware questions**: Each question carries its own synthesis line — what the run already understands that bears on it, from the codebase analysis, the user-supplied context or earlier answers — and two or three answers generated from it. Generic questions waste the user's time.
- **Escape hatches**: Always allow the user to say "Not sure yet" without blocking progress, and to ask for More details — the full context written out, then the same question again.

**Signal to user**: Announce exploration mode explicitly to set expectations.
> "Let's explore who this feature is really for and what problem it solves..."

**Anti-pattern**: Asking "What do you want?" when you have enough context to ask something specific. Exploration questions should demonstrate understanding of the domain.

### Convergence Mode

**When**: `idea-convergence`, `feature-specification`, the review of the screens in `visual-prototyping`, and the brief's approval in `review-handoff`

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

At every convergence point where a node produces a draft artifact:
- `problem-exploration`: the problem statement
- `persona-exploration`: the persona cards
- `idea-convergence`: each decision area (the overall direction is approved at `direction-approval`, which follows directly)
- `feature-specification`: each specification section
- `visual-prototyping`: the screens, inside the mockup studio's own loop
- `review-handoff`: the assembled brief

### Flow

```
Draft → AskUserQuestion carrying the draft (approve / change A / change B / More details)
  → [revision] → complete revised draft → AskUserQuestion (same options)
  → [after soft cap] → same options, approve's description naming the rounds taken
```

**Standard options**: "Approve (Recommended)", "Change [aspect A]", "Change [aspect B]", More details — four slots, so a fourth change option moves More details to a typed "details". A rethink, or any change the options do not name, is the user's own words through the free-text answer.

**Soft cap**: after the iteration limit the options stay the same; approve's description says how many rounds were taken, and the user can still take one more.

### Key Rules

**Complete drafts always**: Every revision presents the COMPLETE updated artifact. Never present a diff, a summary of changes, or a table of what changed. The user should be able to evaluate the artifact on its own merits without referencing the previous version.

**Soft cap, not hard limit**: `design_context.refinement_iterations` tracks the rounds each loop took, in the run's state. After reaching the soft cap (2 for simple tasks, 3 for standard/complex), the options shift to encourage approval. But the user can always choose "One more revision."

**A rethink**: When the user asks for one — an option where a node offers it, or their own words — it is a significant action. It signals that incremental changes will not fix the problem. Step back, re-examine assumptions, and present a substantially different draft -- not a minor variation of the previous one.

**Exploring more alternatives is a gate option, not a loop option**: when none of the generated alternatives feels right, the answer is "Brainstorm new alternatives" at `direction-approval`, which re-runs the brainstorm and then the convergence. A loop inside `idea-convergence` cannot reach back to the node before it.

### State Tracking

```yaml
design_context:
  refinement_iterations:
    problem_statement: 1
    personas: 0
    specification_sections: {user_stories: 2}
    prototypes: 1
```

Track per loop (and per section in `feature-specification`) to apply soft caps independently. A heavily-iterated persona definition should not consume the refinement budget for specification sections.

---

## AskUserQuestion Option Design

Options are not just UI -- they shape the conversation. Well-designed options anticipate what the user is likely thinking. Every ask fits four options, and each option is an answer that can be applied as it stands, never a category that needs a second question.

### Exploration Mode Options

Structure: topical choices + escape hatches

**Pattern**:
- 2-3 topical answers generated from the synthesis line, the best-supported first and marked "(Recommended)" with why — best-supported among the answers that keep every criterion the task states
- "Not sure yet" (does not block progress), or More details where the question's context is long (the workflow engine's rule for it)
- The user's own words are the question tool's free-text answer, not an option slot

**Example** (`problem-exploration`):
```
- "The main problem is [user frustration with X] (Recommended)"
- "Actually, it's more about [business need Y]"
- "Both are important, but prioritize [X]"
- "Not sure yet"
```

**Why topical options work in exploration**: They demonstrate that the conversation is listening and synthesizing. The user confirms, corrects, or elaborates -- all of which deepen understanding faster than open-ended "What else should I know?"

### Convergence Mode Options

Structure: approve + aspect-specific changes + structural options + escape hatch

**Pattern**:
- "Approve (Recommended)" (always first; its description says what the draft settles)
- "Change [aspect A]" / "Change [aspect B]" (specific refinement targets, each description naming the likeliest change)
- More details last, or typed as "details" when a third change option or a structural one ("Add more detail", "Rethink it") takes the fourth slot
- The draft itself rides in the approve option's preview where the tool shows previews, and as its points in the question where it does not

**Aspect-specific "Change" options**: Anticipate the most likely refinement areas for the artifact type:
- For a persona: "Change role", "Change goals", "Change pain points"
- For a problem statement: "Change scope", "Change priority", "Change constraints"
- For a spec section: "Change requirements", "Change acceptance criteria", "Change scope"
- For a mockup: "Change layout", "Change content", "Change interactions"

### Universal Rules

**Always leave an open-ended escape hatch**: the question tool's free-text answer covers cases where none of the structured options match the user's intent, so it costs no option slot; say in the question that the user can type their own answer when it matters. Without it, users feel trapped in a multiple-choice quiz.

**Never recommend a narrower task**: the recommended answer keeps every acceptance criterion and requirement the description states, and where an earlier checkpoint flagged a criterion as open to two readings, it is the reading that keeps the criterion whole. A narrower option may be offered, naming what it gives up, but is never marked recommended. The workflow engine's *In-node questions* states the rule.

**Never present all decision areas in a single batch**: One area at a time with full context. Batch decisions produce shallow answers because users optimize for completion speed rather than quality.

**Order matters**: Put the most likely action first. In convergence, that is usually "Approve" (most drafts are close enough). In exploration, lead with the option that advances the conversation most.

---

## Interaction Quality Principles

### Prose is the Conversation

The questions are the design conversation, so each one carries its context in its own text, options and previews (the workflow engine's rule for in-node questions): prose printed before a question may never reach the screen. A short message between calls is welcome — a mode label, a bridge — but nothing the user needs depends on it.

**In the question**: Synthesize what you have learned in the question's own synthesis line. Show the user that their previous answer was heard and integrated.
> "The key constraint is that existing users should not need to re-learn navigation, so the design extends the current sidebar. Where should the new view sit?"

**After receiving an answer**: Acknowledge and bridge to the next question or draft.
> "That makes sense. The two-persona approach (admin vs. viewer) gives us clear boundaries for feature scoping. Let me draft the admin persona first since they have the more complex workflow."

### Synthesis Over Repetition

After each answer, synthesize -- do not merely acknowledge. The synthesis shows understanding and gives the user a chance to correct misinterpretation before it compounds.

**Pattern**: "So what I'm hearing is [synthesis]. [Bridge to next step]."

### Mode Labels at Transitions

Every transition between exploration and convergence gets an explicit label. This is not optional -- users need the narrative context to understand why the interaction style is changing.

---

## Anti-Patterns

| Anti-Pattern | Why It Fails | Better Approach |
|---|---|---|
| Summary table of changes across iterations | User must mentally diff two versions | Present complete revised draft every time |
| Skipping mode labels | User is confused by sudden shift from questions to proposals | Always announce "Now let's converge..." |
| Single-round approve-or-reject | No room for iterative refinement | Use the refinement loop with aspect-specific options |
| "What do you want?" in convergence | Shifts cognitive burden to user when you have enough to propose | Use propose-and-refine: present a draft |
| All decision areas in one batch | Produces shallow answers | One area at a time with full context |
| Form-filling: questions without synthesis | Feels like a bureaucratic intake process | Each question carries its synthesis line; each page builds on the answers before it |
| Context only in a message above the question | The message may never reach the screen | Put it in the question, the options and the previews |
| More than four options, or an option that only opens another question | Cannot render, or costs a round trip | Bundle, generate concrete answers, take the rest as typed text |
| Proposing solutions during exploration | Anchors thinking, closes off discovery | Explore fully before proposing |
| Generic questions ignoring context | Wastes user's time, signals lack of understanding | Reference codebase analysis and prior answers |

---

This reference provides interaction patterns and frameworks. The workflow's node prose, `skills/workflow-engine/workflows/product-design.md`, defines the node logic that applies these patterns, and what each question takes under a `cockpit` or `dispatch` driver, where none of them is asked.
