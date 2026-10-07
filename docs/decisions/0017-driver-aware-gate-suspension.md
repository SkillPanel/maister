# ADR-0017 — Driver-aware gate suspension and the resume-path editor exception

**Status**: Accepted · **Date**: 2026-08-30 · **Sources**: `plugins/maister/skills/workflow-engine/SKILL.md` § "Gates"; `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs`; `plugins/maister/lib/state-scan.mjs`; ADR-0009, ADR-0012

## TL;DR
The engine now chooses its gate behaviour from the run's driver rather than being terminal-only: absent or `terminal` asks in session, `cockpit` and `dispatch` suspend on a request file. Suspension is a Pro Edition feature and does not live in this repository; the open engine reaches it only through the `gate-request` verb. Answering a suspended gate is the one sanctioned exception to ADR-0012's "no editor tool ever touches the state file": the decision is recorded with editor tools and then handed straight back to the writer, which re-reads and re-publishes it. Terminal mode is unchanged, and stays as ADR-0009 decided it rather than as the original gate-suspend design sketched it.

## ADR-0017: Driver-aware gate suspension and the resume-path editor exception {#adr-0017}

### Status
Accepted. It amends ADR-0012 in one narrow place and completes what ADR-0009 left mode-scoped. No frozen shape changes meaning; the writer accepts one value it previously refused.

### Context
Driven runs suspend at a gate instead of asking in session; that protocol is a Pro Edition feature and does not live in this repository. What did not exist was an orchestrator that behaved that way. Every one of them asked its gates in session, and the engine's own prose said so in a banner — terminal mode only, with the driver-aware mode deferred to "a later change". This is that change.

Two things had to be settled to make it real.

**Answering a gate needs a writer that is not reachable.** While a driven gate is pending `write-state` cannot run, so the decision cannot be recorded by the sanctioned route. ADR-0012's rule — every state change through one script verb, no editor tool, no fallback writer — has no answer for a state in which the script is unreachable and the state must still change.

**Terminal mode had two descriptions.** An earlier design marked a gate pending in every mode, terminal included. ADR-0009 later decided the opposite for terminal mode, on the ground that marking a gate pending when the answer arrives in the same turn would block the engine's own writer for no benefit. Both statements were on record, and the engine's implementation had to follow one of them.

### Decision Drivers
- An exception to a no-fallback rule is only safe if it is bounded and self-checking; an unbounded one repeals the rule
- Terminal mode is in use today, and any change to it is a regression with no upside
- Two live descriptions of the same behaviour is a defect, whichever one the code follows

### Considered Options
1. Let the resume path record the decision with editor tools and stop there, trusting the edits
2. Deny editor tools on the resume path too, and require the operator to clear the marker by hand before answering
3. Record the decision with editor tools and immediately re-validate through the writer ← chosen
4. Bring terminal mode into line with the earlier design — mark the gate pending there too
5. Keep terminal mode exactly as ADR-0009 decided, and record the divergence ← chosen

### Decision Outcome

**The resume path gets a bounded editor-tool exception, and pays for it immediately.** Options 1 and 2 were both rejected — 1 accepts model-authored state on trust, which is the drift the writer exists to remove, and 2 asks an operator to hand-edit a state file to unblock a protocol that exists to keep them out of it. Option 3 is what shipped: the decision is recorded with editor tools and, once the pending marker is `null`, the very next action is the state writer with an empty patch.

The empty patch is not a no-op and is not decorative. The writer reads the file the editor tools just wrote, self-checks it through the shared state reader, and re-publishes it; the file changes by one line, its updated stamp. What that buys is the exact guarantee ADR-0012 was written for — no state file is accepted until the writer has read it back and agreed — recovered on a path where the writer could not go first. A refusal there is `RUN-FAILED: <code>` and the run is handed to the prose orchestrator; it is never repaired in place, because a refusal means the recorded decision did not survive the reader, and editing further with the same tools that produced it compounds the drift.

The exception is scoped by construction: it is available only while a gate is pending, and only until the marker is null — at which point ADR-0012 applies in full. It is an amendment to ADR-0012, not a repeal of it.

**Terminal mode does not move.** Option 5. The engine writes no request file in terminal mode, prints no pending line, and the marker is only ever the literal `null`. This diverges from the earlier design, which marked a gate pending in every mode; ADR-0009 supersedes that for terminal mode and its reasoning still holds — a gate asked and answered inside one turn is never awaited, so marking it pending would deny the engine's own writer and buy nothing. The divergence is recorded here so that the older text is read as history rather than as a rule the implementation ignores.

### Consequences

#### Good
- The editor-tool exception cannot silently widen: it ends at the marker, and the writer has to agree before the run continues
- Terminal mode is byte-identical, so nothing in use today changes behaviour

#### Bad
- ADR-0012's rule now has an exception, so "never with an editor tool" has to be read together with its one bounded case rather than on its own
- The resume path costs one extra write — the re-validation — on every answered gate
- Two gate behaviours now exist, so a reader of any gate-related prose has to know which driver it describes
