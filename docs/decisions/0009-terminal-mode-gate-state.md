# ADR-0009 — Terminal-mode gate state

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § E2; `plugins/maister/hooks/gate-enforce.mjs`, `hooks/gate-lib.mjs`; `plugins/maister/skills/workflow-engine/SKILL.md` § "Gates in terminal mode"; ADR-0001

## TL;DR
When the engine asks a gate in session and receives the answer in the same turn, it writes no pending marker and no gate request file. The enforcement hook cannot see inside a shell invocation, so a pending marker would deny the engine's own call to its state writer and leave editor-tool writes as the only way forward — the corruption the writer exists to remove. This is **mode-scoped**: it holds because the answer arrives in the same turn. A driver-aware mode writes the request file, marks the gate pending and ends its turn, exactly as the gate-suspend protocol specifies.

## ADR-0009: Terminal-mode gate state {#adr-0009}

### Status
Accepted, and scoped to the mode it describes. The suspend protocol it does not use is `E2`; nothing here amends it.

### Context
The gate-suspend protocol (ADR-0001) makes a pause real by writing a pending marker that a fail-closed hook reads: while a gate is pending, every mutating tool call is denied until an answer is recorded. It was designed for a driven run, where the question leaves the process entirely — written to a request file, answered by something outside the session, and picked up on the next turn. Nothing can be trusted to wait politely across that boundary, so the marker enforces the wait.

The engine runs in terminal mode. It asks its gate in session, the operator answers, and the run continues — all inside one turn. There is no boundary to survive. The question was whether the engine should nonetheless write the marker and the request file, for uniformity with the driven path.

### Decision Drivers
- Enforcement must never deny the one writer that keeps state correct
- A marker whose wait is zero turns long enforces nothing and can only cost something
- The driven path must remain implementable later without re-deciding the protocol

### Considered Options
1. Write the pending marker and the request file in every mode, for uniformity
2. Write the request file but no marker, so the gate is visible without being enforced
3. Write neither while the answer arrives in the same turn ← chosen

### Decision Outcome
Chosen option: **write neither**. The pending marker is only ever written as the one-line null form, and a gate answered in session is recorded on the node's summary — the chosen option, who answered, when — with the node marked completed.

The reason uniformity loses is mechanical rather than aesthetic. The enforcement hook matches shell invocations as an opaque category: it cannot inspect what a shell command is about to do, so while a gate is pending it denies them all. The engine's state writer *is* a shell invocation. Marking a gate pending in the same turn the engine then needs to record its answer would therefore deny the engine's own write, and the only remaining way to record anything would be an editor tool holding the state file open — precisely the model-authored state whose drift the writer exists to eliminate. A uniform marker would not make terminal mode safer; it would make it structurally unable to record the answer it just received, and it would push the run onto the one writing path that is known to corrupt.

Option 2 fails more quietly and for that reason was rejected outright: a request file with no marker behind it is a gate that looks enforced and is not, and the failure would surface as a run that continued past a question nobody answered.

**This is mode-scoped, not a permanent rule.** The reasoning above depends entirely on the answer arriving in the same turn. A driver-aware mode — one that records a driver block and runs under something outside the session — does the opposite, and does it for the same reason: there the wait genuinely spans turns, nothing else guarantees the pause, and the writer's own call is separated from the pending window by the turn boundary. That mode writes the gate request file, sets the pending marker, prints the pending line and ends the turn. The rule to carry forward is not "the engine never marks a gate pending"; it is "a gate answered inside one turn needs no marker, and marking it would break the writer".

### Consequences

#### Good
- The state writer keeps working during a gate, so every answer is recorded by the script rather than by a model holding a file open
- Nothing is left pending on disk when a run ends, so a finished directory needs no cleanup pass and cannot deny writes in a later session
- The suspend protocol is untouched and remains available to the mode that actually needs it

#### Bad
- Terminal-mode gates are enforced by the orchestrator's own discipline and the session-start reminders, not by the hook — a gate skipped in prose is not caught on disk
- Two modes now answer the same question differently, so a reader of either path alone will draw the wrong general rule unless the scoping is stated where the behaviour is
- A terminal run interrupted mid-gate leaves no on-disk trace of the question having been asked, so it resumes at the node rather than at the question
