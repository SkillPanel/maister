# ADR-0035 — Research decides its optional stretches at its gates

**Status**: Accepted · **Date**: 2026-10-08 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (`checkNodeShape`, `WHEN_REF`, `guardOperands`, `checkWhen`); `scripts/lib/gate-brief.mjs` (`evaluate`, `evaluateReference`, `skippedAgain`); `references/grammar.md` § 6, § 7; `SKILL.md` § Gates, § The ready set; `workflows/research.yml`, `research.md`; `tests/engine/research-routes.test.mjs`, `grammar.test.mjs`, `checkpoint.test.mjs`; ADR-0034

## TL;DR
Research asked its two optional stretches on a page of their own right after the foundation gate
had asked to continue, and chose the design before any solution was explored. The foundation gate
now offers the three ways on — to brainstorming, to the design without it, or to the end — and the
brainstorming gate decides the design. Two grammar limits stood in the way, and each moved by the
smallest step: a gate with several continues may leave out its stop, and a guard may join
references with `||`.

## ADR-0035: Research decides its optional stretches at its gates {#adr-0035}

### Status
Accepted. A grammar change, amending ADR-0034's gate rule and § 7's one-reference guard.
- The gate rule becomes: at least one continue, any number of revise, and a gate with a single
  continue at least one stop.
- A `when` guard is one reference, or several joined by `||`, each optionally negated; true when any
  is.
- The research definition adopts both, so its hash moves. No other built-in changes.

### Context
ADR-0034 moved development's opt-ins onto its gates and left research's `optional-phases-decision`
as it was: two independent choices would have needed four continues beside a revise and a stop, more
than a gate's question holds. The operator settled the shape instead of the count. The choices are
not independent once they are asked where they are known:
- after the research, the way on is brainstorming, the design without brainstorming, or the end;
- after brainstorming, the way on is the design or the end.

Two things blocked that shape:
- **The foundation gate has no stop.** Its four options are the three continues and the revise.
  "Finish with the research" is the way out, and it still writes the final summary, so it is a
  continue, not a stop.
- **The design has two deciders.** It runs when the foundation gate chose it, or when the
  brainstorming gate chose it after brainstorming ran. A guard was one reference, and a skipped gate
  reads false, so no single gate value says "the design was chosen at either gate".

### Decision
**The gate rule.** A gate with one continue still needs a stop: without one it could not end the
run. A gate with several continues decides the route, and one of its ways on may be the shortest way
to the end, so its stop is the author's choice. The recommendation already falls to the preferred
continue when a gate offers no stop, and the picker, the checkpoint and the driven request carry the
options generically, so nothing else changes.

**The guard.** `||` joins references, each checked exactly as a single reference is: a declared
`bool` input, or a `bool` value of a node or gate inside the node's `needs` closure. The guard is
true when any reference is. When none reads true and one reads a value a completed node never
recorded, the brief refuses as before. A revise's stretch reports a node as skipped again only when
every reference reads outside the stretch. There is no `&&`, no parentheses and no comparison; an
all-of condition is still a `bool` an earlier node records. The guard is hashed as written.

**Research.** `optional-phases-decision` is gone.
- `foundation-approval` offers `continue-to-brainstorming`, `continue-to-design` and
  `finish-with-research`, setting `brainstorming_enabled` and `design_enabled` to (true, false),
  (false, true) and (false, false), beside `revise-research`.
- `convergence-approval` offers `continue-to-design` and `finish-without-design`, setting
  `design_enabled`, beside its revise and its stop.
- The brainstorm stretch reads the foundation gate's `brainstorming_enabled`. The design and its
  gate read `${foundation-approval.values.design_enabled} || ${convergence-approval.values.design_enabled}`.
- `research-foundation` and `solution-convergence` name the continue they recommend, and
  `--brainstorm` / `--design` set that recommendation, as `--audit` and `--e2e` do in development.
- The gate answers are also recorded as `orchestrator.options.brainstorming_enabled` and
  `design_enabled`, for readers of the run's options.

### Alternatives considered

| Alternative | Why not |
|---|---|
| A skipped gate inherits a value of the same key from a gate upstream | No new syntax, but the coupling is by key name and invisible at the guard, and it changes what every skipped gate records |
| A node between the gates that records "design chosen at either" | Puts back a node whose only job is a condition the graph can state, and adds a row to every dashboard |
| Keep a stop at the foundation gate as a fifth option | The rich picker holds four; the stop would push out a way on or the revise |
| Two design nodes, one per decider | Two nodes writing the same artifacts, and two sets of parent outputs to keep in step |

### Consequences
- The research definition's hash moves. Frozen runs of the old graph keep their own graph.
- The Pro Edition's contract lint and the cockpit's graph checks must accept a gate with several
  continues and no stop, and a guard of references joined by `||`, before a driven run of the new
  research definition validates there. Both re-pin the research hash. The gate request carries no
  new field.
- The in-node question ids `brainstorm-opt-in` and `design-opt-in` no longer occur.

### Follow-up: a run for its findings only
A parent cannot narrow a child's gate, and the foundation gate always offers both stretches. The
`findings_only` input adds a second gate, `findings-approval`, in line after `foundation-approval`
under the opposite guard: one continue, `continue-to-completion`, beside `revise-research` and
`stop-research`. Gates are static, so two gates under opposite guards is the shape, and the
findings gate stands after the foundation gate rather than beside it so the chain stays linear and
`research-foundation` stays the node the foundation gate closes. No grammar changed. The research
hash moves again, and the Pro Edition re-pins it.
