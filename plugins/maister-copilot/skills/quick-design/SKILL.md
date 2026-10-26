---
name: quick-design
description: Settle one small design question in the session — frame it, lay out two to four options, recommend one, ask a single question set and write a one-page decision record. Use when a design question is bounded (how a card behaves, how many questions a step asks, which of two layouts) and a full product design would be too heavy. Decides on its own whether mockups help, and sketches one per option when they do.
argument-hint: "[design question]"
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` on a fresh project — run `mkdir -p` on that folder first.

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

# Quick Design

A light design pass in the session: frame the question, lay out the options, recommend one, ask
once, and write `decision.md`. No engine run, no state file, no phases.

## Rules

- **Never block on a gap.** A point you cannot settle from the question, the code or the docs
  becomes an "unknown, to check" line in the decision. Do not stop to ask about it.
- **Say when it's too small.** When the question needs research first (evidence you cannot read
  from the codebase or the docs) or has more than three independent decision areas, recommend
  `/maister-copilot:product-design` (or `/maister-copilot:research` when the gap is evidence), say why in two or
  three lines, and stop without writing anything. Never guess past it.
- **Keep it light.** No research phase, no personas, no HTML companions, no gates beyond the one
  decision step.

## Usage

```bash
/maister-copilot:quick-design "How should the decision card show a revised answer?"
/maister-copilot:quick-design "How many questions should one outcome step ask?"
```

## Workflow

### 1. Get the question

Use the argument. If none, take it from the recent conversation. Only when nothing there is
inferable, ask in plain text — "What design question should we settle?" — and wait for the answer:
with nothing to pick from it is not a question-tool call, which takes two options or more on
Claude Code.

### 2. Frame

Write the frame in the session, a few lines each:

- **The question**, in one sentence.
- **What is known**: the code, docs and behaviour it touches, read rather than assumed.
- **The constraints**: decisions already taken that it must respect, and the project standards it
  must follow. Read `.maister/docs/INDEX.md` when it exists, then the standard files it points to
  that bear on the question; INDEX.md alone is not enough. When it does not exist, note "No
  Maister standards found. Consider running `/maister-copilot:init`."
- **The decision areas**: the independent choices inside the question, at most three. More than
  three is the size check above.
- **Mockups: yes or no, and why.** Mockups are made when the decision turns on how something looks
  or is laid out: placing, grouping or showing information on a screen, comparing layouts, a new
  screen or card. A decision about behaviour, data, policy or wording only gets none. Write the
  choice with its reason, e.g. "Mockups: yes — the options differ in card layout".

### 3. Options

Per decision area, two to four concrete options. Each says what changes, its pros, its cons and a
rough cost (small, medium or large, with what drives it). Options are real alternatives a person
could pick, never a strawman beside the favourite.

**When mockups are on**, run the `mockup-studio` skill through the Skill tool once, for a
minimal set: one small sketch per option, so the options can be compared side by side — not a
design pass. Pass the task directory (step 6) as `task_path`, `output_subdir: mockups`,
`iteration: single`, `emit_index_rows: false`, the format from `.maister/config.yml`'s
`mockup_format` (default `html`), and as `context` the options and what each one changes on screen.
The studio binds to the project's design system when there is one. Show the sketches with the
options.

### 4. Recommendation

One recommended option per area, with the reason it wins against the runner-up in a line or two.

### 5. The decision step

One `ask_user` call holds the whole decision: one question per decision area, plus one
question for the mockups.

- **Each area question** names the area and what it decides. Its options are that area's options,
  the recommended one first, carrying the recommendation's reason in its description; every other
  option's description carries its main pro and con and its cost.
- **The mockup question** offers the override. When mockups were skipped: "Decide without
  mockups" (recommended) and "Show me mockups first". When they were made: "Keep the mockups"
  (recommended) and "Skip the mockups". The frame's reason goes in the recommended option's
  description.
  The call is one form with one property per question, each `"type": "string"` — the question tool refuses a
  property without its type — and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label, the recommended one's ending
  "(Recommended)"), never a bare `enum` of ids — with the recommended option as its default, and
  each option's description and the recommendation's reason as lines of the property's
  description, since the form shows labels only; the form shows each property on a tab of its own.

**"Show me mockups first"** makes the sketches as in step 3, shows them, and asks the area
questions once more with the answers just given marked recommended. **"Skip the mockups"** keeps
the decision and leaves the sketches out of it; the files stay in the task directory.

### 6. Output

Write `decision.md` under `.maister/tasks/design/<YYYY-MM-DD-name>/`, the name a few words from the
question in kebab case and the date today's. About a page, in ADR style:

- **Context**: the question, what is known and the constraints, from the frame.
- **Options considered**: per area, each option in a line or two with its pros, cons and cost.
- **Decision**: per area, the option chosen and the reason, saying when it differs from the
  recommendation. Then the mockup line from the frame, with any override.
- **Consequences**: what follows from the decision, good and bad.
- **Unknown, to check**: each gap the design could not settle, with how to settle it.
- **Proposed issues or slices**: a short list of the pieces of work the decision implies, each a
  line that could become an issue.

The mockups sit beside it under `mockups/` when they were made and kept; `decision.md` links them.
Close with the path of `decision.md` and the decision in one line per area.
