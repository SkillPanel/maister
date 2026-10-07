# ADR-0024 — The dashboard is projected at write time

**Status**: Accepted · **Date**: 2026-09-26 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs`, `scripts/lib/dashboard.mjs`, `scripts/lib/graph.mjs`; `plugins/maister/skills/orchestrator-framework/references/orchestrator-patterns.md` § 8; ADR-0006, ADR-0009, ADR-0012, ADR-0013, ADR-0017

## TL;DR
On the engine path `dashboard-data.js` is no longer something an orchestrator remembers to rewrite: every successful `write-state` projects it from the state it just committed, so no turn between phases owes it a rewrite. As first accepted it was not the file's only writer: the implementation and verification phase interiors run under a skill rather than under the engine, so `implementation-plan-executor` and `implementation-verifier` still carried three rewrites inside them as prose obligations. The 2026-09-30 amendment retires those, and the projection becomes the only writer. The projection call sits deliberately **after** `commit()`, the opposite side of the rename from its sibling `refreshIndex`, because it projects a state that has to exist first. A projection failure is a **warning, never a refusal** — the state write already landed, and un-publishing it is not on offer — and the warning travels out of the library as data in `writeState`'s return rather than as a stderr write, so no module under `scripts/lib/` becomes the first one to perform stdio. When `html_output` is false the projection **deletes** the file instead of skipping it, because a guard alone would leave the stale file this change exists to abolish. Icon hints move into a top-level `display` block that sits outside the hashed `{nodes, outputs}` envelope, so a cosmetic edit cannot move a graph's identity.

## ADR-0024: The dashboard is projected at write time {#adr-0024}

### Status
Accepted. It scopes — rather than repeals — the framework's dashboard-rewrite obligations to the prose path, and it amends ADR-0012's all-or-nothing writer contract in one bounded place: the projection that follows a committed write. No frozen shape changes meaning; `writeState`'s return grows one key.

### Context
`dashboard-data.js` is the data file the operator's dashboard and the cockpit both poll. Until now it was written by prose: the framework named seven moments at which an orchestrator was obliged to rewrite it — run start, each phase transition, each gate, resume, and so on — and one workflow's prose said the mechanism out loud, that the file is only ever as fresh as the last turn that rewrote it by hand.

That is a freshness contract enforced by nothing. An orchestrator that skipped a moment, was interrupted between two of them, or handed off mid-phase left a file that still parsed, still rendered, and still looked current — a dashboard an operator read as live while it described a state from hours earlier. Staleness had no symptom, so it had no bug report either.

Meanwhile the engine path already had something the prose path does not: a single chokepoint through which every state change passes. ADR-0012 put every state change behind one script verb, with no fallback writer. If the dashboard is a *projection* of state rather than a document about it, that chokepoint is exactly where it belongs, and the obligation disappears into the machinery instead of being assigned to a reader.

Four things had to be settled to make that real.

**Where the projection sits relative to the rename.** `writeState` already calls two things around its commit. `refreshIndex` runs *before* `commit(state, text)`, so that a refusal out of the index publishes nothing. If the projection followed that pattern it would describe a state the run might never have.

**What a projection failure does to the write.** The writer's contract is all-or-nothing: a refusal is an answer, and a refused write publishes nothing. A projection that can fail after the rename has no such option available to it.

**How a warning gets to the operator.** No module under `scripts/lib/` performs stdio. Every refusal already travels to the entry point as data and is printed there. A projection warning either joins that convention or breaks it.

**What happens when the dashboard is switched off.** Runs can set `html_output` false. A projection that merely declines to write when the flag is false leaves whatever was last published sitting on disk, being polled and parsed.

And one presentational question came with the feature: the per-phase icon the viewer renders had been carried as prose tables the orchestrator transcribed by hand. Moving that into the definition makes it data — but a definition's node set is hashed, and graph hashes are identity.

### Decision Drivers
- A freshness rule that depends on a reader remembering it is not a rule; the only durable fix is to remove the opportunity to forget
- A write that has already landed must not be reported as refused, whatever fails afterwards
- A convention held by every module in a directory is worth more than the one line of convenience that would break it
- Presentation must never participate in identity: a cosmetic edit that moves a hash invalidates every frozen child and dispatched chain downstream of it
- Two sibling calls with opposite orderings must carry their reasons in the code, or the next reader will "fix" one of them

### Considered Options
1. Keep the prose obligations and add a reminder at each moment — rejected: more prose enforcing the same unenforceable rule
2. Add a dedicated engine verb the orchestrator calls after each state write — rejected (see below)
3. Project inside `write-state`, from the state just committed ← chosen
4. Project **before** `commit()`, matching `refreshIndex` — rejected
5. Project **after** `commit()`, and record the asymmetry in the code ← chosen
6. Refuse the whole write when the projection fails — rejected
7. Warn, with the library writing the line to stderr itself — rejected
8. Warn, returning `warnings: [{code, message}]` from `writeState` and printing at the entry point ← chosen
9. Under `html_output: false`, skip the write and leave the existing file — rejected
10. Under `html_output: false`, delete the file ← chosen
11. Carry icon hints per node, inside `nodes:` — rejected
12. Carry icon hints in a top-level `display` block, outside the hashed envelope ← chosen

### Decision Outcome

**The projection rides inside `write-state`.** Option 3. After every successful state write, the writer regenerates `dashboard-data.js` from the state it just committed. The framework's seven rewrite moments are not deleted — they still bind the prose path, which remains the maintained fallback (ADR-0013) and the only path for workflows that ship no definition — but they no longer bind an engine run, and the prose that claimed otherwise is scoped accordingly. This is the ownership move: between phases the file's freshness stops being an instruction and becomes a property of the routine that changes the state it describes. Inside the implementation and verification phases it stays an instruction, on the two skills that own those interiors.

What the projection emits is held to the write-strict half of the tolerance rules (ADR-0006): readers of this file tolerate what they are given, but the writer emits exactly the one frozen shape and nothing broader, so the file being generated rather than hand-written narrows what appears in it instead of widening it.

Option 2 was rejected for a reason specific to gates. Under a pending gate the engine's shell calls cannot run (ADR-0009, ADR-0017), so a separate verb would be unavailable at exactly the two moments the dashboard most needs updating — the moment a gate goes up and the moment it is answered. Riding inside the write the engine is already making costs no new verb.

**The projection sits after `commit()`, and the asymmetry is deliberate.** Options 4 and 5. `refreshIndex` runs before the commit because it mirrors request files that are *already on disk*: publishing that index early can never be wrong, and doing it early means a refusal publishes nothing. The projection runs after the commit because it is a projection *of this write*: rendered before the rename it would describe a state the run might never reach, which is a different flavour of the same staleness this change exists to remove. Two sibling calls in one function with opposite rationales is a maintenance hazard, so both reasons are written at both call sites. Without them the asymmetry reads as an oversight and gets tidied into a bug.

**A projection failure is a warning, never a refusal.** Option 6 was rejected on simple grounds: the projection runs after the rename, so refusing could not un-publish the state anyway — it could only misreport a landed write as a failed one, which is worse than a missing dashboard. The state write stays successful, the changed-file list simply does not name the dashboard, and the run continues. This is the one place where ADR-0012's all-or-nothing contract is amended, and it is bounded to the projection: the dashboard is derived output, not state, and every refusal the *writer* owns behaves exactly as before. The writer's refusal vocabulary does not grow — the codes the projection can raise are caught at its call site and converted, so they never leave the module as refusals.

**The warning is returned as data, not printed from the library.** Options 7 and 8 were both recorded, because option 7 is genuinely cheaper: one stderr write, no signature change, no caller to update. It was rejected because no module under `scripts/lib/` performs stdio today, and this feature is a poor reason to make one the first. Every refusal in the engine already travels to the entry point as data and is printed there; a warning that printed itself would be the single exception a reader has to know about, and the one place where library output cannot be captured, suppressed or reformatted by the caller. So `writeState` returns `{ok, changed, errors, warnings}` and the entry point prints each warning on one line, prefixed so it cannot be mistaken for a refusal — whose code is the first stderr token by contract — with the exit status unchanged. The cost is recorded honestly: `writeState`'s return shape grows a key, which any consumer pinning that shape must accommodate.

**`html_output: false` deletes.** Option 10. Option 9 — a write guard alone — recreates the defect inside its own fix: after a true-to-false flip the last-published file stays on disk and keeps being polled and parsed, which is precisely the stale dashboard this change exists to abolish, now with no writer left to refresh it. So the projection removes the file, reports it among the changed paths only if a file was actually there, and treats a failed removal as a warning like any other projection failure. The rendered HTML page beside it is never touched; only the data file is projected.

**Icon hints live in a top-level `display` block, outside the hash.** Option 12. A definition may carry `display: {icons: {<node-id>: <name>}}` as a sibling of `nodes:` and `outputs:`, with values drawn from a closed set that matches the viewer's own icon map, and may omit the block entirely. The placement is the decision: the graph hash digests exactly the serialised `{nodes, outputs}` envelope, so a top-level sibling is provably outside it. That matters because a graph hash is identity — a frozen child run and a dispatched chain both compare against it — and if a presentational field were part of that envelope, relabelling one phase's icon would drift every downstream run that had already pinned the graph. A cosmetic field must not be able to invalidate work. The property was verified by execution rather than inferred: with the block added, the graph hash is identical and the generated diagram byte-identical, so the diagram check stays green with nothing regenerated.

The validator earns its keep here, because unknown top-level keys are otherwise ignored in silence: `display` must be a mapping, its icons must be a mapping of node id to name, a value outside the closed set is an **error** naming the offence and the admitted values, and an entry for a node the graph does not declare is a **warning** — an overlay may legitimately have disabled that node, and a hint pointing at a node that is not there cannot break a run. The block is carried from the base definition only, raw, exactly as declared outputs already are, on the grounds that overlay operations apply to nodes and there is nothing an overlay could say about presentation. At projection time a definition that cannot be found, read or parsed yields no hints at all and never fails the write; the viewer's default icon covers the gap.

**The duplication with the prose tables is accepted.** The four per-workflow prose icon tables now say the same thing as the four `display` blocks. Deleting them is not available: those tables belong to the prose twins, which stay maintained as the fallback (ADR-0013), and the twin has to be readable on its own. So the duplication is deliberate and recorded here rather than left for a reader to discover and "resolve" by deleting one side. The `display` block is the machine-read source on the engine path; the table is the human-read source on the prose path; they are kept in step by hand.

**One clarification on ADR-0012's fixed temp-file name.** The reason ADR-0012 gives holds for the **state** temp file alone and does not generalise to engine temp files as a class: the engine publishes through a shell call whose targets are not matched by name. So the dashboard's temp file needs no fixed-name entry, and the hook library is left unchanged. The temp-then-rename publish still stands entirely on its own merits: both the viewer and the cockpit poll the data file on a timer, so a torn read is reachable and worth spending a rename on.

### Consequences

#### Good
- The engine path's dashboard cannot go stale between phases: the routine that changes the state is the routine that publishes the projection of it
- Seven prose obligations disappear from the engine path without being deleted from the prose path, so nothing regresses for workflows that ship no definition. The three that remained inside the two phases the engine does not enter, moments 8-10, are retired by the 2026-09-30 amendment
- No new verb, and the dashboard updates correctly at the two gate moments where a separate verb could not have run
- The stdio convention holds: every module in the library still communicates outcomes as data, and the entry point remains the only thing that prints
- A landed state write is never reported as a refusal, whatever the projection does
- Switching the dashboard off removes the file rather than freezing it
- Presentation is outside the hash, proved by execution, so icon edits drift nothing and regenerate nothing

#### Bad
- `writeState`'s return shape grows a `warnings` key, which any pinned consumer of that shape must accommodate
- The writer's all-or-nothing contract now has a bounded exception, so ADR-0012 has to be read together with this record rather than on its own
- Two sibling calls in one function have opposite orderings around the commit; the reasons are in the code, but the shape stays surprising on first read
- The icon tables and the `display` blocks say the same thing in two places and are kept in step by hand
- A definition that cannot be resolved at projection time yields no icon hints and, by design, no warning — the dashboard renders default icons and looks correct, so this failure is silent and has to be caught by explicit acceptance rather than by a check
- The projection is the one impure part of an otherwise pure rendering module, and it reads the run's workflow definition, so the writer now depends on definition resolution

### Amendment 2026-09-27 — a phase card's prose is chosen field by field
A phase card's `summary`, `decisions`, `risks` and `artifacts` come from two places: the node's own `node_summaries.<id>` entry and, where the key equals the node id, the context block's `phase_summaries.<id>`. The projection first took the first of the two that carried an entry at all, whole. Driven runs showed the cost: closing writes put decisions and artifacts on the phase summary and wrote the node summary with empty lists, so the empty entry shadowed the populated one and every phase card rendered no decisions and no artifacts.

The rule is now per field: each of the four comes from the first source that carries it **filled** (a non-empty string or a non-empty list), node summary first. The sources are still never concatenated. A field filled on both is the node summary's alone, because concatenation would show the same decision twice whenever a closing write mirrors it into both places. The framework's § 8 states the rule for readers of the dashboard.

### Amendment 2026-09-30 — the dashboard has one writer
The record above left three rewrite moments standing inside the two phases the engine does not enter. `implementation-plan-executor` rewrote the file at entry, after every wave and at finalize, and `implementation-verifier` rewrote it at entry and after each cycle. That was the last place where the model maintained both the state and a document describing it, and so the last place the two could drift. It is retired: on the engine path the projection is now the file's **only** writer.

**The interiors reach the dashboard by writing state.** The executor sends the empty patch, `{}`, through `write-state` at each of its three moments. The call changes nothing but the `updated` stamp, and its only effect is to republish. The verifier writes the fact that actually changed: at entry it clears `verification_context.last_status` and `issues_found`, so a re-verification never shows the pre-fix verdict as current, and after its report it records the cycle's verdict and issues. Both are ordinary patch-file writes through the one verb, so no new verb is needed, for the same reason option 2 was rejected above.

**No projection change was needed, and that was checked rather than assumed.** Every field the hand rewrites set is one the projection already derives. `progress` comes from the plan's checkboxes and the work log's contract headings, which the executor already wrote for exactly this reader. `verification` comes from `verification_context`. What was missing was not a derivation but a write at the moments that matter. The frozen dashboard shape is unchanged. One value differs from what the hand rewrite produced: after finalize `current_wave` keeps the last wave's number instead of being cleared, because the projection reads the log and does not know the phase has ended. The field stays nullable, and a finished phase showing its last wave is accurate.

**`verification_context.last_status` and `issues_found` move to the verifier.** Before, the workflow node's closing write recorded them once, after every cycle was over, so the verification panel was blank or stale for the whole phase. The verifier now records them on every cycle. The node prose no longer repeats them, which leaves one writer per key. `fixes_applied`, `reverify_count` and `decisions_made` stay with the node's fix loop, and because the block merges key by key the two writers never overwrite each other.

**Standalone runs get no dashboard.** Run standalone, either skill has no `orchestrator-state.yml`: no workflow run, no viewer, nothing to project. A standalone file would bring a second writer back for a frozen shape, which is exactly what this amendment removes. The operator of a standalone run is sitting in that session, and the plan, its companion, the work log and the verification report already record its progress.

**Moments 8-10 are deleted, not scoped.** Moments 1-7 were kept for the prose path. These three had no prose-path owner left, because the one remaining prose orchestrator runs neither skill.

Consequences. Freshness inside the long phases is now one state write per wave or per cycle instead of a hand-built document, so the dashboard can no longer show a progress figure or a verdict that the plan, the log or the state do not back. A skill that skips a moment leaves the dashboard one step behind. It is still consistent with state, and the next write catches it up. A refused write is a warning in the work log or the verifier's summary, and it never blocks the phase.

### Amendment 2026-10-02 — moments 1-7 are removed
Moments 1-7 were kept for the prose path, and product design was its last user. With it on the
engine (ADR-0025, amendment 2026-10-02), the framework's moments table and the clock rule for
writing the file by hand are removed. The projection is now the file's only writer for every
workflow, and no node or orchestrator owes a rewrite moment.
