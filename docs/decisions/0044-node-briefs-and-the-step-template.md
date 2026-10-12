# ADR-0044 — A step reads a derived brief, and its guide section follows one template

**Status**: Accepted · **Date**: 2026-10-12 · **Amends**: ADR-0008 (the consequence that a `direct:` node whose section is renamed stops validating) · **Builds on**: ADR-0029 (`absent`, now named in `brief:`), ADR-0040 (the in-node question ids and their defaults), ADR-0043 (`run-context`, the precedent `node-brief` copies; `html_companions`, the precedent `brief:` copies) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/node-brief.mjs` (the verb); `scripts/lib/brief.mjs` (`briefOf`, `briefOfRun`); `scripts/lib/graph.mjs` (`BRIEF_KEYS`, `proseSection`, the `conventions` resolution, `orphan-prose-section`); `scripts/workflow.mjs` (the verb and its `rules:` line); `SKILL.md` § *Node conventions*; `references/grammar.md` § 3.3, § 11, § 14; `skills/workflow-author/SKILL.md` (*Authoring checks*); `tests/guide-template-lint.mjs`; `tests/engine/guide-template-lint.test.mjs`, `node-brief.test.mjs`, `node-brief-size.test.mjs`, `brief-block.test.mjs`, `skill-statements.test.mjs`, `custom-workflow.test.mjs`, `validate.test.mjs`

## TL;DR
A step's instructions were a whole guide section, and most of each section restated what the
engine already held or what is true of every step of its kind: how it is delegated, the files it
writes, its question defaults, the checkpoint it feeds, its retry budget. Now a read-only verb
prints a step's brief — a header derived from the frozen definition, its `brief:` block and the
run's state, the convention rows that apply, then only the step's own section. Each section
follows one template a lint holds, and a `direct:` step with nothing of its own needs no section.

## ADR-0044: A step reads a derived brief, and its guide section follows one template {#adr-0044}

### Status
Accepted. No definition's graph hash moves; the five built-in diagrams are byte-identical.
- `brief:` sits outside the hashed envelope, like `display` and `html_companions`, and outside
  `resolve`.
- The five built-in guides shrink by about a third; every parsed line of each — its node
  headings, its 41 question-set markers, its close-out paragraph — survives.
- The checkpoint, the request documents and the state shape are unchanged.

### Context
- Each guide repeated, per node, the delegation line, a gate-brief skeleton, a re-run skeleton,
  a recovery budget, a phase-summary key table, icon hints and a run-scoped context section. A
  rule read in full in one place and skipped in another was the one that mattered.
- The data a step needs — which phase keys it mirrors into, which artifact it may leave unwritten,
  how many attempts it gets, which gate option an input recommends, each question's default —
  lived in sentences, where nothing could check it against the graph.
- A step was handed its section by reading the guide, so its length was the guide's to keep
  down, and nothing measured it.
- A custom `direct:` step had to carry a section even when it had nothing to say beyond what
  every step does, and ADR-0008 accepted that a renamed section stops validation as the price of
  the coupling.

### Decision
1. **A verb prints the step's brief.** `node-brief --state --node` prints a header derived from
   the definition the run froze, its `brief:` block and the run's state — the step's scheme, its
   `with:` values, the paths it writes and which may be absent, the pages it owes, its questions
   and their defaults under the run's driver, the checkpoint it feeds and its budget — then the
   convention rows that apply, a `rules:` line, and last the step's own section of its guide.
   It is read-only. It refuses an unreadable state, a state with no `workflow:` block and a node
   the frozen graph does not carry; drift, an unreadable definition and an unreadable table are
   warnings, and the brief still prints. The engine reads it before executing any node.
2. **A non-hashed `brief:` block carries the data.** A top-level `brief:` maps a node id to an
   entry of five closed keys: `summary_keys`, `absent`, `budget`, `recommends` and `questions`.
   An overlay and its profile carry the same key; layers merge node by node and key by key, and
   `null` removes. A malformed entry or an unknown key is an error; an unknown node, artifact,
   input or option is a warning, and nothing is printed for it. The budget is printed as a prose
   rule, never enforced.
3. **The conventions are stated once.** A `### Node conventions` table in the engine `SKILL.md`
   holds what every step of a kind does by default, one row per fixed key — the four schemes,
   `gate`, `every step`, `asks`, `feeds a checkpoint`, `named by a revise`, `has a budget`.
   `node-brief` selects the rows by key and prints them, so the table stays the one copy. A row
   aims at 45 words.
4. **The step template.** A node section holds up to six parts in a fixed order, each opened by a
   bold run-in label — Does, Asks, Writes, Summary, Re-run, Budget — and states only what is the
   step's own. A gate keeps a section only for an Exception part. Each part has a word target;
   the targets are guidance, and a count over one warns and never fails.
5. **A lint holds the template.** `tests/guide-template-lint.mjs`, repository tooling run by
   `make validate`, checks each guide against its resolved graph and merged `brief:`: headings,
   the header, part labels and order, gate sections, question-set lines against `brief:`
   `questions`, a section where `brief:` needs one, and no restated convention. Each of those
   fails; only word counts warn. A size test measures every built-in node's `node-brief` output
   the same way: a warning over its target, never a failure.
6. **A `direct:` step may have no section.** When its companion exists but carries no section for
   it, the target resolves `from: conventions`, and the step does only what the convention rows
   say. A companion that does not exist is an error. This amends ADR-0008's consequence
   (`docs/decisions/0008-direct-scheme-for-workflow-node-references.md:47`: "a
   `direct:` node whose section is renamed stops validating"): such a node now validates from
   conventions. Two guards take that check's place — `validate` warns
   `orphan-prose-section:<companion>:<x>` for each `` ## `x` `` heading outside a fence that names
   no node the definition or overlay declares, and `workflow-author check` reports the same
   heading as a finding with a fix.

### Considered options

| Option | Why not |
|---|---|
| Keep the data in prose and read it with a parser | Sentences drift from the graph and nothing can check them |
| Put the data in node fields | Inside the node, it would move every definition's graph hash |
| Hard word limits that fail validation | Long steps carry judgement; a limit would force cuts by count, not by content |
| An exception table for steps over their limit | Nothing fails on size, so nothing needs an exception |
| Conventions in each guide's header | Five copies of one rule, and a step reading its slice would miss them |
| Keep the section required for every `direct:` step | Forces an empty or restating section on a step with nothing of its own |
| Let a heading that names no node pass silently | A renamed heading would fall back to conventions with nothing said |

### Consequences
- A custom guide written to the old shape still validates; a section's restated conventions are
  read twice until it is trimmed; the lint, given its definition with `--definition`, names them.
- A renamed or mistyped node heading no longer fails validation: it is warned about, and its
  step runs from conventions alone until the heading is fixed.
- A step's data changes in `brief:` and its prose together: a question default sits in both its
  `brief:` entry and its Without line, and nothing checks that the two agree.
- A change to what every step does is one table row, and every step's brief carries it.
