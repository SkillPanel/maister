# ADR-0065 — A guard may require two values with `&&`

**Status**: Accepted · **Date**: 2026-11-03 · **Amends**: ADR-0035 (its guard: "There is no `&&`") · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (`GUARD_OPERATORS`, `guardTerms`, `guardOperands`, `checkWhen`); `scripts/lib/gate-brief.mjs` (`evaluate`); `scripts/lib/diagram.mjs` (`ESCAPES`); `references/grammar.md` § 7; `tools/interface.mjs`; `tests/engine/guard-and.test.mjs`, `grammar.test.mjs`

## TL;DR
A `when` guard joined references only with `||`, so a stretch that needs two values at once had
to be one `bool` an earlier node records. A gate that splits the way on three ways from two
values — a pull request, a push only, or nothing beyond the local commit — cannot be written that
way without a combination that leaves every following gate off. A guard may now join references
with `&&` as well. `&&` binds tighter than `||`; there are still no parentheses. No built-in
definition changes, so no graph hash moves.

## ADR-0065 {#adr-0065}

### Status
Accepted. It amends ADR-0035's guard, which joined references with `||` only and said an all-of
condition is a `bool` an earlier node records. Every other rule of the guard is unchanged.

### Context
Two `bool` values set by one gate — `push` and `pr` — describe three ways on. With `||` alone,
the gate for "push only" cannot say "push and not a pull request": it reads `push`, and runs
beside the pull-request gate when both are true; or the author adds a node whose only job is to
record the combination. ADR-0035 rejected exactly such a node for the design stretch, for the same
reason: it puts a row on every dashboard for a condition the graph can state.

### Decision
- **The grammar.** A guard is one or more terms joined by `||`; a term is one or more references
  joined by `&&`; a reference is `"${…}"`, optionally negated with a leading `!`. `&&` binds
  tighter than `||`, so `a || b && c` reads as `a || (b && c)` — the reading every C-family
  language gives it, and the one that lets "push and not a pull request, or local" be written
  without parentheses. There are no parentheses, no `and` / `or` words and no comparison.
- **Whitespace.** Spaces around either operator are optional, as they already were
  around `||`; none goes inside a reference or between `!` and its `${`. The guard is hashed as
  written.
- **Validation.** The guard is split at `||`, then each term at `&&`, and every piece must be one
  reference. A dangling or doubled operator, a single `&` or `|`, `&&&`, a word or a parenthesis
  leaves a piece that is not one, and the guard is refused at `nodes.<id>.when` with one message
  naming the grammar. Every reference then goes through the checks it always did: a declared
  `bool` input, or a `bool` value of a node or gate inside the node's `needs` closure, one error
  per bad reference.
- **Reading.** A guard is true when any term is; a term is true when every reference in it is.
  A reference reading false settles its term, and a term reading true settles the guard,
  whatever another reference would have said — so the value-missing refusal is given only when no
  term reads true and some term with no reference reading false reads a value a completed node
  never recorded. A node that did not complete still reads false, so its negation reads true.
- **Every reader.** The validator, the ready-set walk, the reach a gate's answer reports, a
  revise's skipped-again check, the node brief's `when:` line and the `answered_in` stamp all read
  a guard through the same two helpers: the terms for the truth value, and every reference,
  whatever term it sits in, for "does this guard read X". The diagram escapes `&` in its labels.
- **The interface file** names the guard's operators under `grammar.guard_operators`. The
  section is new, so the step is a minor one: 1.9 to 1.10.

### Alternatives considered

| Alternative | Why not |
|---|---|
| A node that records the combination as one `bool` | The reason ADR-0035 gave for `||`: a node whose only job is a condition the graph can state, and a row on every dashboard |
| Parentheses | A real expression parser for a need two levels of precedence already meet; every reader would have to walk a tree |
| `&&` and `||` at equal precedence, left to right | Reads against every C-family language; "a or b and c" would silently mean "(a or b) and c" |
| `and` / `or` words | Two spellings of one grammar, and `${…} and ${…}` is easy to mistake for prose |

### Consequences
- Existing definitions are unchanged and freeze to the hashes they had.
- A reader of guards outside this plugin — a graph check, a lint, a dashboard that draws guards —
  must split at `&&` too before it meets a definition that uses it. The interface file's
  `grammar.guard_operators` is where it learns that the set grew.
- The `answered_in` stamp keeps its rule (every reference leads to one child answer). It is
  sound for either operator and stays conservative: a skip one reference of a term explains is
  not stamped.
