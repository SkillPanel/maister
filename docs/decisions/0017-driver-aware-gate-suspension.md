# ADR-0017 — Driver-aware gate suspension and the resume-path editor exception

**Status**: Accepted · **Date**: 2026-08-30 · **Sources**: `compatibility-contracts.md` § A2, § E2; `plugins/maister/skills/workflow-engine/SKILL.md` § "Gates"; `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs`, `scripts/lib/gate.mjs`; `plugins/maister/hooks/gate-enforce.mjs`, `hooks/gate-lib.mjs`; ADR-0001, ADR-0009, ADR-0012

## TL;DR
The engine now chooses its gate behaviour from the run's driver rather than being terminal-only: absent or `terminal` asks in session, `cockpit` and `dispatch` suspend on a request file. Suspending needed **no change to the enforcement hook**, because a write-order rule replaced the allow-list widening that was first proposed — every dispatch, ledger and outbox write for the ready set completes *before* the pending marker goes up, so nothing in the run needs writing while the gate is pending. Answering a suspended gate is the one sanctioned exception to ADR-0012's "no editor tool ever touches the state file": under a pending gate the shell is denied, so the decision is recorded with editor tools and then handed straight back to the writer, which re-reads and re-publishes it. Terminal mode is unchanged, and stays as ADR-0009 decided it rather than as the original gate-suspend design sketched it.

## ADR-0017: Driver-aware gate suspension and the resume-path editor exception {#adr-0017}

### Status
Accepted. It amends ADR-0012 in one narrow place and completes what ADR-0009 left mode-scoped. No frozen shape changes meaning; the writer accepts one value it previously refused.

### Context
The gate-suspend protocol (ADR-0001) has always described a run that suspends: a request file, a pending marker, a printed line, an ended turn, and a fail-closed hook that denies everything else until the decision is recorded. What did not exist was an orchestrator that behaved that way. Every one of them asked its gates in session, and the engine's own prose said so in a banner — terminal mode only, with the driver-aware mode deferred to "a later change". This is that change.

Three things had to be settled to make it real, and they interlock.

**Suspending a run collides with the hook that makes the suspension real.** The hook allows a fixed, small set of paths while a gate is pending and denies everything else, including the shell — which means it cannot see inside a script invocation and treats the run's own state writer as opaque. A run that still had work to write when it suspended would have its own writes denied by its own gate. The obvious answer was to widen the hook's allow-list to cover the dispatch, ledger and outbox paths.

**Answering a gate needs a writer that is not reachable.** The deny is total by design: under a pending marker the shell is denied, so `write-state` cannot run, so the decision cannot be recorded by the sanctioned route. ADR-0012's rule — every state change through one script verb, no editor tool, no fallback writer — has no answer for a state in which the script is unreachable and the state must still change.

**Terminal mode had two descriptions.** The original gate-suspend design had the request file and marker written in every mode, terminal included. ADR-0009 later decided the opposite for terminal mode, on the ground that marking a gate pending when the answer arrives in the same turn would deny the engine's own writer for no benefit. Both statements were on record, and the engine's implementation had to follow one of them.

### Decision Drivers
- A gate is only fail-closed if the hook that enforces it is not adjusted to accommodate each new caller
- An exception to a no-fallback rule is only safe if it is bounded and self-checking; an unbounded one repeals the rule
- Terminal mode is in use today, and any change to it is a regression with no upside
- Two live descriptions of the same behaviour is a defect, whichever one the code follows

### Considered Options
1. Widen the hook's allow-list so a suspending run can finish its dispatch, ledger and outbox writes after the marker goes up
2. Order the writes instead — finish everything for the ready set, *then* write the request file and the marker ← chosen
3. Let the resume path record the decision with editor tools and stop there, trusting the edits
4. Deny editor tools on the resume path too, and require the operator to clear the marker by hand before answering
5. Record the decision with editor tools and immediately re-validate through the writer ← chosen
6. Bring terminal mode into line with the original design — write the request file and marker there too
7. Keep terminal mode exactly as ADR-0009 decided, and record the divergence ← chosen

### Decision Outcome

**The write order replaces the allow-list widening.** Option 1 was dropped. A suspending run completes every envelope, ledger and outbox write for its current ready set *first*, and only then writes the request file, sets the marker, rewrites the dashboard, prints the pending line and ends the turn. With that order held, no write is ever attempted inside the run while its own gate is pending, so no path needs allowing — the hook's allow-list, its deny reason and its decision logic are untouched. Widening would also have bought nothing where it looks most useful: a write belonging to a *different* run is denied whatever this run's list says, because the hook builds the list from the pending run rather than from the run doing the writing. That cross-run behaviour is unchanged, documented, and has an operator recovery of its own.

The order is normative rather than advisory, because reversing steps 1 and 3 produces a run that denies its own writes and looks, from the outside, like a broken hook. The request file and the marker are written by one verb call, not two, and cannot be split into two: each of them is on its own a pending signal to the hook — an unanswered request file counts as pending, and so does a non-null marker — so whichever half is written first raises the gate, and the call that would write the other half arrives as a shell invocation the hook cannot see inside, is classed opaque, and is denied. The deadlock is symmetric in the two orderings, so it is not an ordering bug to be fixed by resequencing; the only shape that works is a single call that performs both writes before returning.

**The resume path gets a bounded editor-tool exception, and pays for it immediately.** Options 3 and 4 were both rejected — 3 accepts model-authored state on trust, which is the drift the writer exists to remove, and 4 asks an operator to hand-edit a state file to unblock a protocol that exists to keep them out of it. Option 5 is what shipped: the decision is recorded with editor tools on allow-listed files in a fixed order — the answer block, then the node summary and status, then the pending marker to `null` **last** — and the instant the marker is null, the very next action is the state writer with an empty patch.

The empty patch is not a no-op and is not decorative. The writer reads the file the editor tools just wrote, self-checks it through the enforcement hook's own reader, and re-publishes it; the file changes by one line, its updated stamp. What that buys is the exact guarantee ADR-0012 was written for — no state file is accepted until the writer has read it back and agreed — recovered on a path where the writer could not go first. A refusal there is `RUN-FAILED: <code>` and the run is handed to the prose orchestrator; it is never repaired in place, because a refusal means the recorded decision did not survive the reader, and editing further with the same tools that produced it compounds the drift.

The exception is scoped by construction: it is available only while a gate is pending, only on the files the hook already allows, and only until the marker is null — at which point the shell is reachable again and ADR-0012 applies in full. It is an amendment to ADR-0012, not a repeal of it.

**Terminal mode does not move.** Option 7. The engine writes no request file in terminal mode, prints no pending line, and the marker is only ever the literal `null`. This diverges from the original gate-suspend design, which had those steps happen in every mode; ADR-0009 supersedes that for terminal mode and its reasoning still holds — a gate asked and answered inside one turn is never awaited, so marking it pending would deny the engine's own writer and buy nothing. The divergence is recorded here so that the older text is read as history rather than as a rule the implementation ignores.

**ADR-0001 is not retro-edited.** Its closing sentence — that orchestrators are terminal-mode only until a later change makes them driver-aware — was true on its date and is superseded by this decision, not corrected in place. An ADR is a record of what was decided when; editing one to match the present erases the reason the present looks the way it does.

### Consequences

#### Good
- A gate suspends without the hook learning anything about the runtime that suspends on it, which keeps the fail-closed property independent of its callers
- The write order is a rule a reader can check by inspection, where an allow-list is a rule only the hook knows
- The editor-tool exception cannot silently widen: it ends at the marker, and the writer has to agree before the run continues
- Terminal mode is byte-identical, so nothing in use today changes behaviour

#### Bad
- The write order is a discipline the orchestrator has to hold, and holding it wrongly fails in a way that looks like a hook bug rather than an ordering bug
- ADR-0012's rule now has an exception, so "never with an editor tool" has to be read together with its one bounded case rather than on its own
- The resume path costs one extra write — the re-validation — on every answered gate
- Two gate behaviours now exist, so a reader of any gate-related prose has to know which driver it describes
