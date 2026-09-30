# ADR-0028 — Gates carry a bounded back-edge

**Status**: Accepted · **Date**: 2026-09-30 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (`OPTION_KEYS`, `OPTION_EFFECTS`, `checkRevise`, `reviseStretch`); `scripts/lib/revise.mjs` (`gate-revise`, `openRevision`); `scripts/lib/state.mjs` (`rerunsOf`, `assertForward`, `reset`, `earlierRevisions`); `scripts/lib/gate-brief.mjs` (`revisionsOf`, `suggestionsFor`); `references/grammar.md` § 6, § 13.3; `SKILL.md` § Gates, *Revising at a gate*; `tests/engine/gate-revise.test.mjs`; ADR-0014, ADR-0016, ADR-0025

## TL;DR
A gate could only continue or stop. An operator who wanted a document redone had to stop the run
and start again. This record adds one bounded way back:
- **A gate option `{effect: revise, reruns: <node>}`.** A gate still has exactly one continue and at
  least one stop, and may now have any number of revise options. `reruns` names a task node the
  gate waits on.
- **One verb resets the stretch.** `gate-revise` resets every node from `reruns` to the gate in a
  single write. It records the operator's note on the gate and counts each node's attempt.
- **Three revisions per gate.** The limit is an engine constant.
- **The edge lives on the option, not in `needs`.** The graph stays acyclic, and the ready set,
  `Next:`, `run-complete` and the freeze behave exactly as before.
- **An ordinary write can no longer rewind a node.** It is refused `state-node-regressed`.
- **The note is chosen from generated suggestions.** Typed text is only the fallback.

## ADR-0028: Gates carry a bounded back-edge {#adr-0028}

### Status
Accepted. It amends ADR-0016: a jump construct and a run-state attempt counter now exist, scoped to
a gate's revise option. It narrows ADR-0014's "node prose carries its loops" so that a loop across
nodes, closed by a gate, belongs to the graph. The built-in hashes move once, when their approval
gates adopt the option.

### Context
The first attended runs made the gap concrete. An operator reads a specification at its approval
gate, sees what is wrong, and can only say continue or stop. The grammar spelled "revise" as a stop,
and the built-in prose said outright that revise was a third effect the grammar lacked. The two
in-node loops (the mockup revise round and the verification fix loop) cover their own nodes, but
nothing covered "send the specification back after the audit". The audit is a separate node after
the specification's own gate, so no in-node loop can reach it.

The engine was closer to supporting a way back than ADR-0016 suggests:
- the writer already treats a node that goes `running` after it ended as a new attempt;
- node lines already carry their `needs`, so a reset set can be computed from the state alone;
- `run-complete` already owes any reachable `pending` node;
- the gate brief already computes the stretch a gate closes.

Four things were missing: an effect with an upstream target, a write that resets the stretch whole,
a bound, and a way for the operator's reason to reach the re-run node.

### Decision Drivers
- **The ready set stays computable.** Acyclic `needs` is what makes the ready set computable, and no
  answer may break that.
- **A revise is bounded, and the bound is enforced.** It is not merely stated.
- **The record stays true.** A reset says why it happened, and a node's history never silently goes
  backwards.
- **A revise works on a run whose definition changed since it froze.** That is the run an operator
  most wants to send back.
- **Questions offer generated choices.** Typed text is a fallback, and no option is a no-op.

### Considered Options
1. A `revise` effect with `reruns`, a reset verb and a fixed budget ← chosen
2. A general `goto: <node>` restricted to nodes upstream of the gate
3. Option `values` plus an enum `when`, with answer-dependent forward branches unrolled per pass
4. Keep revise loops in node prose
5. A node-level `retry:` key
6. Defer to operator-initiated re-entry at a named node

### Decision Outcome
Chosen option: **a `revise` effect**, carried out by `gate-revise`.

**The shape.** An option map may carry `reruns` beside `effect`, and only a revise option carries it.
Validation refuses a `reruns` that is:
- outside the gate's needs closure;
- a gate;
- a `workflow:` node;
- the start of a stretch that holds a sub-run. A child run's directory is derived from its parent
  and its node, so re-running the node would adopt the finished child rather than start a new one.

The map is hashed whole. A definition's hash therefore moves only when it adopts a revise option.

**The stretch.** A revise resets:
- the `reruns` node;
- the gate;
- every node that waits on `reruns` and that the gate waits on.

A side branch off `reruns` that the gate does not wait on is left alone. So is everything
downstream of the gate. An earlier gate inside the stretch is asked again, and its own attempt
counts up.

**The write.** `gate-revise` performs one temp-then-rename through the writer's internal reset. It
does the following:
- every node of the stretch goes to `pending`, with its clocks and values removed and its `attempt`
  raised by one;
- the gate's summary gains the decision `{option, answered_by, at, attempt, reruns, note}`;
- `orchestrator.completed_phases` loses the phases the stretch owned.

A second call is refused, because the gate is no longer the current question, and the file stays
untouched. An ordinary `write-state` that sends an ended node back to `pending` is refused
`state-node-regressed`. The one sanctioned way back therefore records its reason. A re-drive, which
goes `running`, is unchanged.

**The freeze records the targets.** Each gate that offers a revise records `reruns: {option: node}`
on its node line, so the verb reads the state alone. Option 2, a re-resolve under drift, would
refuse exactly the runs that need a revise most.

**Budget.** Three revisions per gate, kept as the gate's `attempt`. The brief stops offering the
option once the budget is spent, and the verb refuses a fourth. Attempts only grow, and each revise
raises its own gate's attempt. The revisions in a run are therefore bounded by three per gate, even
when stretches nest.

**History.** The counter sits on the node line, and the history sits on the gate's decisions:

- A later answer at the gate is added after the revise decisions, never over them.
- A list of attempts on a one-line node entry would grow the line that the hook's reader parses.
- Changing the counter into a list later would be a re-type. The shape is therefore decided now.

**Suggestions and the note.** `gate-brief --json` gives each revise option `note: true` and up to
four suggested notes:
- the open risks of the stretch, as things to resolve;
- its decisions, as things to revisit;
- nearest the gate first, with the first recommended;
- two plain edits of the rerun node when the stretch recorded too few.

In session, the suggestions are asked as a multi-select question, with typed text as the fallback.
Under a driver, the request option carries the suggestions, and the note travels on the answer file
beside the request. `prior-context` prints the note under its own heading while the stretch
re-runs. Each rerun target's prose carries a *When re-run after a revise* paragraph, which tells it
to revise its artifacts in place rather than start over.

**Scope of the built-ins.** Only gates that close a document-producing node with no review loop of
their own get the option. The mockup gate is excluded, because its in-node loop keeps the studio
warm between rounds. So are the verification gates, whose fix loop handles a request for changes.

**Why not the others:**
- **Option 2** is option 1 with a worse name. `goto` names a mechanism, so an author reads it as
  forward routing, and a `goto` on a continue option would blur the one-continue rule that `Next:`,
  the recommendation and the cockpit all depend on.
- **Option 3** is the right tool for A/B choices and escalation. It is the wrong tool for revise:
  every extra pass would need an unrolled copy of the stretch.
- **Option 4** cannot reach across a gate, and it degrades to "accept" under a driver.
- **Option 5** moves a number the model already follows from prose into data nothing enforces.
- **Option 6** puts nothing on the gate the operator is looking at. Built second, it becomes a thin
  front-end over this reset primitive.

**It does not serve post-close acceptance.** A finished run has no pending gate to answer. Changing
finished work stays a new run, or later an operator-initiated re-entry over the same primitive.

### Consequences

#### Good
- The operator can send a document back from the gate they are reading, with a reason. Under a
  driver it works the same way.
- The graph stays acyclic, so every reader of the ready set keeps working unchanged.
- A revise is bounded, enforced, and recorded: the dashboard tags each attempt, and the gate keeps
  every note.
- A node's record only moves forward, apart from the one route that says why.
- The same reset primitive is what operator-initiated re-entry will need.

#### Bad
- Every rerun target's prose has to say how it runs again over its own output. A node without that
  paragraph repeats its first attempt, or skips work because its artifacts exist.
- A re-run overwrites its artifacts in place, so an earlier attempt survives only in its summary and
  the gate's notes.
- A revise that re-asks an earlier gate spends one of that gate's revisions too.
- An overlay cannot add a revise option to a built-in gate. That needs its own overlay operation.
- The compatibility contracts, the pro gate request and the cockpit must learn the new effect, the
  note and the node fields in one contract round.
