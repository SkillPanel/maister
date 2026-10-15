# ADR-0044 — A step reads a derived brief, and its guide section follows one template

**Status**: Accepted · **Date**: 2026-10-12 · **Amends**: ADR-0008 (the consequence that a `direct:` node whose section is renamed stops validating) · **Builds on**: ADR-0029 (`absent`, now named in `brief:`), ADR-0040 (the in-node question ids and their defaults), ADR-0043 (`run-context`, the precedent `node-brief` copies; `html_companions`, the precedent `brief:` copies) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/node-brief.mjs` (the verb); `scripts/lib/brief.mjs` (`briefOf`, `briefOfRun`); `scripts/lib/graph.mjs` (`BRIEF_KEYS`, `proseSection`, the `conventions` resolution, `orphan-prose-section`); `scripts/lib/state.mjs` (`withAsRecommended`); `scripts/workflow.mjs` (the verb and its `rules:` line); `SKILL.md` § *Node conventions*; `references/grammar.md` § 3.3, § 11, § 14; `skills/workflow-author/SKILL.md` (*Authoring checks*); `tests/guide-template-lint.mjs`; `tests/engine/guide-template-lint.test.mjs`, `node-brief.test.mjs`, `node-brief-size.test.mjs`, `brief-block.test.mjs`, `skill-statements.test.mjs`, `custom-workflow.test.mjs`, `validate.test.mjs`

## TL;DR
A step's instructions were a whole guide section, and most of each section restated what the
engine already held or what is true of every step of its kind: how it is delegated, the files it
writes, its question defaults, the checkpoint it feeds, its retry budget. Now a read-only verb
prints a step's brief — a header derived from the frozen definition, its `brief:` block and the
run's state, the header lines and convention rows that apply now, then only the step's own section.
Each section follows one template whose structure a lint holds, and a `direct:` step with nothing of
its own needs no section.

## ADR-0044: A step reads a derived brief, and its guide section follows one template {#adr-0044}

### Status
Accepted. No definition's graph hash moves; the five built-in diagrams are byte-identical.
- `brief:` sits outside the hashed envelope, like `display` and `html_companions`, and outside
  `resolve`.
- The five built-in guides shrink by about two fifths, from 34,352 words at beta.17 to 19,788;
  every parsed line of each — its node headings, its 41 question-set markers, its close-out
  paragraph — survives.
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
   `with:` values, the paths it writes and which may be absent, the pages it owes, its question
   ids under the run's driver, the checkpoint it feeds and its budget — then the convention rows
   that apply, a `rules:` line, and last the step's own section of its guide. The header is read
   before every step, so it prints only what applies now: a line that would only state the
   default is left out, and the `named by a revise` row prints whole only while a recorded revise
   names the step, the `has a budget` row only on the last budgeted attempt; before then both are
   named on one pointer line.
   It is read-only. It refuses an unreadable state, a state with no `workflow:` block and a node
   the frozen graph does not carry; drift, an unreadable definition and an unreadable table are
   warnings, and the brief still prints. The engine reads it before executing any node.
2. **A non-hashed `brief:` block carries the data.** A top-level `brief:` maps a node id to an
   entry of four closed keys: `summary_keys`, `absent`, `budget` and `recommends`. A question's
   default is not one of them: it is written once, in the Without line of the step's section, and
   under a driver nobody can be asked through the brief names the question ids and points there.
   An earlier draft carried the defaults in a `questions` key as well, and nothing checked that
   the two copies agreed; the key was dropped to keep one source.
   An overlay and its profile carry the same key; layers merge node by node and key by key, and
   `null` removes. A malformed entry or an unknown key is an error; an unknown node, artifact,
   input or option is a warning, and nothing is printed for it. The budget is printed as a prose
   rule, never enforced.
3. **The conventions are stated once.** A `### Node conventions` table in the engine `SKILL.md`
   holds what every step of a kind does by default, one row per fixed key — the four schemes,
   `gate`, `every step`, `asks`, `feeds a checkpoint`, `named by a revise`, `has a budget`.
   `node-brief` selects the rows by key and prints them, so the table stays the one copy.
4. **The step template.** A node section holds up to six parts in a fixed order, each opened by a
   bold run-in label — Does, Asks, Writes, Summary, Re-run, Budget — and states only what is the
   step's own. A gate keeps a section only for an Exception part. A part has no word target:
   length is judged by content in review, not counted by a tool.
5. **A lint holds the template.** `tests/guide-template-lint.mjs`, repository tooling run by
   `make validate`, checks each guide's structure against its resolved graph and merged
   `brief:`: headings, the header, part labels and order, gate sections, question-set lines
   inside the Asks part and each id's lines once, a section where `brief:` needs one, and no
   restated convention. Each of those fails; the lint counts no words. It reads a guide by the
   engine's own walk, so a fence, a heading or a picker passage is where `node-brief` finds it. A
   size test prints every built-in node's `node-brief` length as a per-node table, a diagnostic
   with no target.
6. **A `direct:` step may have no section.** When its companion exists but carries no section for
   it, the target resolves `from: conventions`, and the step does only what the convention rows
   say. A companion that does not exist is an error. This amends ADR-0008's consequence
   (`docs/decisions/0008-direct-scheme-for-workflow-node-references.md:47`: "a
   `direct:` node whose section is renamed stops validating"): such a node now validates from
   conventions. Two guards take that check's place — `validate` warns
   `orphan-prose-section:<companion>:<x>` for each `` ## `x` `` heading outside a fence that names
   no node the definition or overlay declares, and `workflow-author check` reports the same
   heading as a finding with a fix.
7. **An answer is recorded on the step that asked it.** A question a step asks in session is
   recorded on that step's summary as a decision with `by: operator` and its `question_id`; the
   `asks` convention row says so. The state writer fills `as_recommended` when the decision
   carries an `answer` and a `recommended` but not the key, comparing the two case-insensitively
   and ignoring a trailing "(Recommended)", the suffix a picker puts on the label an answer is
   often recorded as. Both rules had lived only in the guide headers; a live run driven only by
   the briefs lost both once the headers were cut, so they now sit in the convention row and the
   writer.

### Considered options

| Option | Why not |
|---|---|
| Keep the data in prose and read it with a parser | Sentences drift from the graph and nothing can check them |
| Put the data in node fields | Inside the node, it would move every definition's graph hash |
| Hard word limits that fail validation | Long steps carry judgement; a limit would force cuts by count, not by content |
| Word targets that warn, or ceilings at today's counts that warn only on growth | A warning on every validate hides a real one, and a ceiling still judges a part by count |
| Question defaults in `brief:` as well as the Without line | Two copies of one default, and nothing checks that they agree |
| Leave `as_recommended` to the step that records the answer | A step reading only its brief omitted it, and an exact match read a "(Recommended)" label as a choice against the recommendation |
| An exception table for steps over their limit | Nothing fails on size, so nothing needs an exception |
| Conventions in each guide's header | Five copies of one rule, and a step reading its slice would miss them |
| Keep the section required for every `direct:` step | Forces an empty or restating section on a step with nothing of its own |
| Let a heading that names no node pass silently | A renamed heading would fall back to conventions with nothing said |

### Consequences
- A custom guide written to the old shape still validates; a section's restated conventions are
  read twice until it is trimmed; the lint, given its definition with `--definition`, names them.
- A renamed or mistyped node heading no longer fails validation: it is warned about, and its
  step runs from conventions alone until the heading is fixed.
- A question default has one home, the step's Without line; `brief:` holds only what the header
  derives, and a change to a default is a prose change.
- Nothing measures a section's length: a guide that grows is caught in review, with the size
  test's per-node table as the evidence.
- A recorded in-session answer always says whether it took the recommendation, whether or not
  the step wrote the key.
- A change to what every step does is one table row, and every step's brief carries it.

### Amendment 2026-10-15 — `summary_keys` is retired
The key named the phase-summary mirror's entries a step was to fill, and the mirror is gone
(ADR-0046). `summary_keys` is still accepted in a `brief:` entry, with any non-null value and
the warning `brief-retired-key`, but `node-brief` prints it nowhere and no built-in carries it.
`brief:` now has three active keys: `budget`, `absent` and `recommends`.
