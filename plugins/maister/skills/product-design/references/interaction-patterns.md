# Interaction Patterns

Guides interaction quality in the product-design workflow's interactive nodes. Defines two cognitive modes, what the checkpoints offer, "Investigate first", and AskUserQuestion option design.

---

## Purpose

Product design is a conversation, not a form. The workflow alternates between exploring the problem space and converging on solutions. These patterns ensure that interaction feels like working with a thoughtful design partner rather than filling out a requirements template.

**Core idea**: Exploration opens possibilities. Convergence narrows them. Both require different interaction strategies.

---

## Cognitive Mode Framework

### Exploration Mode

**When**: the gap page of `intake`, once the explore has run

**Purpose**: Understand the design space before proposing solutions. Discover constraints, motivations, and context that shape the design.

**Principles**:
- **Avoid anchoring bias**: Do not propose solutions during exploration. Premature solutions close off discovery.
- **One page of independent questions**: Up to four questions, each standing on its own, and only what the explore could not answer. A gap the page cannot hold, or whose framing depends on another's answer, is written into the scope as an assumption to check. Decision areas are never paged — they belong to convergence.
- **One behaviour, one story**: Questions about one behaviour the feature must support — who may do it, where they start, what changes, who sees the result — are drafted into one journey-level story and asked as one question, never as separate tabs. A screen or a control appears in it only where the design context already names one, so the story records the journey without anchoring the layout. The workflow engine's `references/in-node-questions.md` states the rule.
- **Context-aware questions**: Each question carries its own synthesis line — what the run already understands that bears on it, from the explore briefs, the user-supplied context or earlier answers — and two or three answers generated from it. Generic questions waste the user's time.
- **Nothing on screen**: when the project has no screens, the design is the behaviour — what a client can do, what is refused and in what words, what order things come in. Never offer an API, a response or an endpoint as the thing to design; the contract is development's specification's.
- **Escape hatches**: Always allow the user to say "Not sure yet" without blocking progress, and to ask for More details — the full context written out, then the same question again.

**Signal to user**: Announce exploration mode explicitly to set expectations.
> "The project answers most of this. Here is what it could not tell me..."

**Anti-pattern**: Asking "What do you want?" when you have enough context to ask something specific. Exploration questions should demonstrate understanding of the domain.

### Convergence Mode

**When**: `convergence`, and the checkpoints `problem-approval`, `direction-approval` and `brief-approval`

**Purpose**: Narrow down from explored possibilities to concrete decisions. Present drafts for reaction rather than asking open-ended questions.

**Principles**:
- **Propose-and-refine**: "Editing is cognitively easier than creating." Present concrete drafts for the user to react to rather than asking them to create from scratch.
- **Structured drafts**: Present complete artifacts (not summaries or bullet points) so the user can evaluate the actual output.
- **Aspect-specific feedback**: Guide a change toward specific dimensions rather than asking "What would you change?"

**Signal to user**: Announce convergence mode to mark the narrative transition.
> "Based on our exploration, here's what I think we've agreed on..."

### Mode Transition

Explicitly announce transitions between modes. This creates a narrative arc that helps the user understand where they are in the process.

> "We've explored the problem space thoroughly. Now let me synthesize what we've discussed into a concrete direction."

**Why explicit transitions matter**: Without them, the shift from open-ended questions to concrete proposals feels abrupt. The user may still be in exploration mindset when you need them to evaluate specifics.

---

## The Checkpoints

A checkpoint is the engine's gate, and no node runs an approval loop of its own. The way back is the gate's revise, and the note it carries is the correction. A revised document comes back whole, never as a diff or a table of what changed.

### Checkpoint 1: The Scope Options (`problem-approval`)

The person chooses what this run produces, or corrects what it is about. `problem`'s summary recommends from the signals: the task's length, the screens it names, the decisions it implies, greenfield or not.

| Option | What it does | Recommended when |
|---|---|---|
| "A design brief" | Goes on, with no specification; screens are drawn when there is anything to see | The signals do not call for the specification |
| "A brief with a feature specification" | Goes on, and writes the design-level specification | Several interacting screens or rules, a development run to follow at once, or the `specification` input is true |
| "Correct the scope" | Re-runs `intake` from the note | Not recommended; each assumption's `change` is offered as a suggestion |
| "Revise the problem" | Re-runs `problem` from the note | Not recommended; each drafted story's `change` is offered as a suggestion |
| "Use quick-design instead" | Ends the run, its next step the quick-design command | The scope found one bounded question; a risk tagged `stop` carries it |

The reason says whether screens are drawn. When the intake found nothing a person sees, it says none are drawn on either outcome, and that the design settles behaviour, rules and wording. A picker that cannot list every option names the rest in the question, and they stay choosable: the engine decides which.

### Checkpoint 2: The Direction (`direction-approval`)

Closes the convergence. A revise re-asks only the areas its note reopens.

### Checkpoint 3: The Whole-Brief Review (`brief-approval`)

The brief, the screens and the delivery scope are reviewed once, together, with no section-by-section ask before it. What the person wants changed is the note on the engine's revise: "Change the brief only", or "Change the screens and brief", which runs again from the specification. `brief`'s summary is the review's preview, a line per layer, and it recommends the brief-only revise when the scope misses an agreed point.

---

## Investigate First

A person who cannot choose an area yet need not guess. Every decision area in `convergence` offers this: they say what to look at, the node checks it from the code or the docs, adds one line to the area's record and asks the same area again. It answers from what is already there, so it is a check and not a research phase, and the rounds of one attempt bound it.

<!-- rich-picker -->
They type it in the question tool's free-text answer, starting with "Check", so it costs no option slot.
<!-- /rich-picker -->
<!-- plain-picker
They take the option "Investigate first" and fill in its "What to check", or answer in their own words starting with "Check".
-->

The workflow engine's `references/in-node-questions.md`, *Decision areas from the brainstorm*, states how the answer is read and recorded.

---

## AskUserQuestion Option Design

Options are not just UI -- they shape the conversation. Well-designed options anticipate what the user is likely thinking. Every ask fits four options, and each option is an answer that can be applied as it stands, never a category that needs a second question.

### Exploration Mode Options

Structure: topical choices + escape hatches

**Pattern**:
- 2-3 topical answers generated from the synthesis line, the best-supported first and marked "(Recommended)" with why — best-supported among the answers that keep every criterion the task states
- "Not sure yet" (does not block progress), or More details where the question's context is long (the workflow engine's rule for it)
- The user's own words are the question tool's free-text answer, not an option slot

**Example** (`intake`):
```
- "[The screen the task names] and its [dialog] (Recommended)"
- "Only the [dialog]; [the screen] stays as it is"
- "Those two, and [the view the explore also found]"
- "Not sure yet"
```

**Why topical options work in exploration**: They demonstrate that the conversation is listening and synthesizing. The user confirms, corrects, or elaborates -- all of which deepen understanding faster than open-ended "What else should I know?"

### Convergence Mode Options

**In a decision area**, the options are the alternatives in rank order, strongest first, with the recommended one marked. `area-brief` renders them; composed from the markdown after a warning, they take the same form. Each is applied as it stands, and the node adds no "Approve" or "Change" of its own.

**At a checkpoint**, the options are the definition's and the engine renders them. What a node shapes is what it writes: its `recommends`, and each `open` risk whose `change` names a likely correction, which the gate offers as a revise suggestion.

**Aspect-specific corrections**: Anticipate the likeliest ones for the artifact type:
- For a problem statement: scope, priority, constraints
- For a mockup: layout, content, interactions

### Universal Rules

**Always leave an open-ended escape hatch**: the question tool's free-text answer covers cases where none of the structured options match the user's intent, so it costs no option slot; say in the question that the user can type their own answer when it matters. Without it, users feel trapped in a multiple-choice quiz.

**Never recommend a narrower task**: the recommended answer keeps every acceptance criterion and requirement the description states, and where an earlier checkpoint flagged a criterion as open to two readings, it is the reading that keeps the criterion whole. A narrower option may be offered, naming what it gives up, but is never marked recommended. The workflow engine's `references/in-node-questions.md` states the rule.

**Never present all decision areas in a single batch**: One area at a time with full context. Batch decisions produce shallow answers because users optimize for completion speed rather than quality.

**Order matters**: Put the most likely action first. In a decision area, that is the rank order. In exploration, lead with the option that advances the conversation most.

---

## Interaction Quality Principles

### Prose is the Conversation

The questions are the design conversation, so each one carries its context in its own text, options and previews (the workflow engine's rule for in-node questions): prose printed before a question may never reach the screen. A short message between calls is welcome — a mode label, a bridge — but nothing the user needs depends on it.

**In the question**: Synthesize what you have learned in the question's own synthesis line. Show the user that their previous answer was heard and integrated.
> "The key constraint is that existing users should not need to re-learn navigation, so the design extends the current sidebar. Where should the new view sit?"

**After receiving an answer**: Acknowledge and bridge to the next question or draft.
> "That makes sense. The share dialog stays as it is, so what is left to settle is where the guest link lives."

### Synthesis Over Repetition

After each answer, synthesize -- do not merely acknowledge. The synthesis shows understanding and gives the user a chance to correct misinterpretation before it compounds.

**Pattern**: "So what I'm hearing is [synthesis]. [Bridge to next step]."

### Mode Labels at Transitions

Every transition between exploration and convergence gets an explicit label. This is not optional -- users need the narrative context to understand why the interaction style is changing.

---

## Anti-Patterns

| Anti-Pattern | Why It Fails | Better Approach |
|---|---|---|
| Summary table of changes across revisions | User must mentally diff two versions | Present complete revised draft every time |
| Skipping mode labels | User is confused by sudden shift from questions to proposals | Always announce "Now let's converge..." |
| "What do you want?" in convergence | Shifts cognitive burden to user when you have enough to propose | Use propose-and-refine: present a draft |
| All decision areas in one batch | Produces shallow answers | One area at a time with full context |
| Form-filling: questions without synthesis | Feels like a bureaucratic intake process | Each question carries its synthesis line, from what the explore found |
| Context only in a message above the question | The message may never reach the screen | Put it in the question, the options and the previews |
| More than four options, or an option that only opens another question | Cannot render, or costs a round trip | Bundle, generate concrete answers, take the rest as typed text |
| Proposing solutions during exploration | Anchors thinking, closes off discovery | Explore fully before proposing |
| Generic questions ignoring context | Wastes user's time, signals lack of understanding | Reference what the explore found and prior answers |

---

This reference provides interaction patterns and frameworks. The workflow's node prose, `<plugin root>/skills/workflow-engine/workflows/product-design.md`, defines the node logic that applies these patterns, and what each question takes under a `cockpit` or `dispatch` driver, with question sets and without.
