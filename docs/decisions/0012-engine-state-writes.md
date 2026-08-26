# ADR-0012 — Engine state writes

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § A2, § E2; `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs`, `SKILL.md` § "Writing state"; `plugins/maister/hooks/gate-lib.mjs`

## TL;DR
Every state change an engine run makes goes through one script verb; no editor tool ever touches the state file. The writer emits at a single canonical indent because two readers consult these files and disagree about every other width, keeps the shapes both readers require on one line and refuses any value that cannot go there, and validates each candidate through the enforcement hook's own reader — imported, not re-implemented — before renaming it into place. There is deliberately **no fallback writer**: if the script cannot run, the run is handed to the prose orchestrator instead.

## ADR-0012: Engine state writes {#adr-0012}

### Status
Accepted. The state shape is `A2` and the pending marker's form is `E2`; this record covers how those shapes are produced.

### Context
A task directory's state file is read by more than one thing. The enforcement hook reads it on every mutating tool call to decide whether a gate is pending. The contract suite reads it to verify the frozen shapes. An operator reads it. And, until now, a model wrote it — holding the file open in an editor tool and re-emitting regions of it by hand.

That last part is the problem this decision exists to remove. The two readers are not equivalent: one derives a block's child column from that block's first child, the other hardcodes the columns it expects. A file written uniformly at some other width is read correctly by one and read as **empty** by the other — and an empty node map beside a present workflow key is exactly the shape the pending predicate treats as a run awaiting an operator. A single wrongly indented block therefore does not merely look untidy; it denies every subsequent write in the session, and the only tool left to fix it is the editor tool that caused it.

### Decision Drivers
- A write that is read two ways is worse than a write that fails
- The failure mode is a blocked operator, not a cosmetic diff
- Anything a consumer needs at run time must be dependency-free

### Considered Options
1. Keep model-authored state, and lint the file afterwards
2. Round-trip the file through a YAML library and dump it back
3. A line-oriented writer that owns four shapes by structural position, with a hook-reader gate before publishing ← chosen
4. Option 3, plus an editor-tool fallback for when the script cannot run

### Decision Outcome
Chosen option: **the line-oriented writer**, invoked as one verb of the engine's script, taking its patch on stdin so no quoting has to survive a shell. It locates the shapes it owns by structural position, replaces or inserts only those regions, and passes every other line through untouched — so unknown keys and comments survive by construction rather than by parser fidelity. One whole-file write per invocation, written to a temp file and renamed; the temp file's name is fixed rather than configurable, because the allow-list that lets the engine keep writing is a list of names.

A YAML round-tripper was rejected for two reasons, the second decisive. It would be a dependency, and a consumer checkout has none. And a generic dumper emits block maps, while the readers require a frozen one-line form — so it would produce valid YAML and a blocked session. Linting after the fact was rejected because by the time the lint runs the damage is already on disk and the writes it would take to repair it are the writes now being denied.

Four rules make the output safe, and each is here because breaking it blocks someone:

- **The canonical indent is mandated, not preferred.** Column 0, then 2, then 4, then two more per level, is the only emission both readers interpret identically. The writer never mixes: adopting a file at another width normalizes the whole file or refuses it outright and writes nothing, because a canonical block inserted into a non-canonical file is the one thing the hook actively rejects.
- **The one-line shapes stay on one line, and their text is constrained.** A node entry, a summary and the pending marker are single-line forms. A value that cannot be written safely inline — one carrying a quote, a newline or a carriage return, or a key that is not usable in a flow map — is refused rather than escaped, because an escape that survives one reader and not the other reproduces the original failure at a lower level. No line the readers consult carries a trailing comment.
- **The acceptance oracle is the reader itself.** Before the rename, the candidate text is passed through the enforcement hook's reader, **imported** from the hook library rather than approximated. That reader has more rejection paths than any short list captures, and a hand-written copy of it drifts from the original on the first change to either — at which point the writer would be validating against a reader nobody uses.
- **A refusal is an answer.** The refusal codes are a closed set and a refused write publishes nothing: the file on disk is byte-for-byte what it was. Re-sending the same patch, or reaching for an editor tool because the script said no, is the failure mode the whole design removes.

**There is no fallback writer**, and this is where the engine deliberately diverges from the precedent set elsewhere in the plugin, where a skill that cannot render one way renders another. That precedent swaps one *rendering* for another and loses only fidelity. A fallback here would swap the *writer*, and the alternative writer is the one known to corrupt — so it would not be a degraded mode but a different failure surface, reached exactly when things are already going wrong. Half a writer is worse than none. When the script cannot run at all, the engine stops before writing anything and hands the run to the workflow's prose orchestrator, which needs no script.

### Consequences

#### Good
- State that both readers agree on, verified against the real reader before anything is published
- Comments, unknown keys and untouched lines survive byte-for-byte, so a state file stays reviewable
- A refused write leaves the directory exactly as it was, so there is no partially applied state to reason about

#### Bad
- The engine requires a working script runtime, and a consumer without one gets the prose workflow rather than a degraded engine run
- A value an author would consider ordinary can be refused for being unsafe inline, and the fix is to change the value rather than the writer
- Importing the hook's reader couples the writer to the hook library, so a change to the reader can fail a write path that has not otherwise changed
- The closed patch vocabulary means every new state field is a change to the writer, not only to its caller
