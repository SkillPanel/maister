# ADR-0020 — The context-block shared core is unblocked, and deferred to its own change

**Status**: Accepted · **Date**: 2026-09-16 · **Sources**: `plugins/maister/skills/orchestrator-framework/schemas/orchestrator-state.schema.json` (the five per-workflow `$defs`); `plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md` § 4 (A1, layer 2); ADR-0015

## TL;DR
ADR-0015 rejected factoring a shared core out of the per-workflow context blocks as **premature**, and named the precondition: it required knowing what performance and migration actually need, and neither had been written. Both are now written and shipped as definitions, so the precondition is met. The evidence that the five blocks overlap is strong — one confidence scalar under three names, project documentation recorded three ways, readiness booleans scattered across all five — and the genuinely domain-specific residue is small. This record **does not refactor**. It records that the question is open rather than premature, what the evidence shows, the shape a factoring should take (a thin shared core, not a generic bag), and that execution belongs to its own change with a migration story of its own.

## ADR-0020: The context-block shared core is unblocked, and deferred to its own change {#adr-0020}

### Status
Accepted. Nothing here changes a registered shape, a schema, a fixture or any runtime file. It is a decision to *record* a question and defer its execution, not to answer it in code.

### Context
A run's state carries exactly one per-workflow context block, chosen from five: `task_context`, `research_context`, `design_context`, `performance_context`, `migration_context`. Each is declared as an open object with typed known keys. They were written one at a time, by different workflows, over a long stretch, and nothing ever compared them side by side.

Compared side by side, they overlap heavily, and the overlap is mostly **the same idea under different names**:

- **`phase_summaries`** is declared in four of the five. Migration carries it in practice all the same — both frozen migration run fixtures have it, and the migration workflow requires it from intake onward — while the schema's own description still calls migration "the only context block that carries no `phase_summaries`". That is stale prose sitting on a contract surface, and the register's layer-2 line repeats it.
- **Project documentation** is recorded three ways: `project_doc_paths` (research, design), `project_context_summary` (design), and the top-level `project_context` block, which exists for exactly this and holds both keys already.
- **One confidence scalar under three names**: `risk_level` (development, migration), `confidence_level` (research), `complexity_level` (design).
- **One classification map under two names**: `task_characteristics`, `design_characteristics`.
- **Sibling-task references**: `research_reference` (development, design), `design_reference` (development).
- **Readiness booleans** across all five: `clarifications_resolved`, `scope_expanded`, `tech_clarified`, `user_data_available`, `rollback_plan_created`, `dual_run_configured` — each a "this precondition has been met" flag, each named for its own workflow.

What is left after the overlap is removed is genuinely domain-specific, and it is a short list: bottleneck counts and priorities; migration systems, strategy and breaking changes; research methodology and sources; design visuals and resources.

Two further observations bear on the shape of any fix.

**A frozen field name carries a phase number.** `design_context.phase7_scope_revision` bakes a process identifier into a contract surface. It is a name the project's conventions would not accept today, and it lies the moment that phase moves.

**The typed keys do not constrain anything.** All five blocks are open objects, so nothing refuses an unnamed key. Three real runs of one workflow added 0, 1 and 11 unnamed keys to `performance_context`. The typed keys are therefore documentation of what a reader may expect, not a gate on what a writer may produce — which is worth being precise about, because it is exactly what a genericisation would throw away.

### Decision Drivers
- ADR-0015 deferred this with a stated precondition; a precondition that has been met should be recorded as met, or the deferral silently becomes a permanent omission
- The blocks are a frozen contract surface, so a factoring is a compatibility change and cannot ride along inside an unrelated one
- Typed known keys are how a reader knows what a block holds without running a workflow; that property is worth more than the deduplication
- Evidence gathered once, and not written down, is evidence that will be gathered again

### Considered Options
1. Factor a **thin shared core** now, inside the change that gathered the evidence
2. Genericise the blocks into one untyped bag of workflow-supplied keys
3. Leave the five blocks exactly as they are and record nothing
4. **Record the question as unblocked, with its evidence and its recommended shape, and defer execution to its own change** ← chosen

### Decision Outcome
Chosen option: **record now, execute separately**.

**Option 1 was rejected on scope, not on merit.** A factoring touches the state schema, the register's layer-2 rules and every fixture that carries a context block, and it needs a read-tolerance story for the runs already written against the old names — a frozen surface cannot simply be renamed. That is a change with its own review, not a tail appended to one that merely noticed the problem. Doing it here would also mean the evidence and the migration were reviewed as one indivisible thing, which is the harder review.

**Option 2 is rejected on principle, and this is the load-bearing rejection.** Collapsing the five blocks into one open map keyed by whatever a workflow writes would remove every name collision at a stroke, and it would remove the reason the blocks are readable. Typed known keys are what let a reader — or a dashboard, or an auditor of a run recorded a year ago — know what to expect without running the workflow that wrote it. The blocks are *already* open, so a bag adds no expressive power the writers lack; it only deletes the declarations. The overlap is a naming problem, and the fix for a naming problem is names, not the absence of names.

**Option 3 was rejected because the evidence expires.** The comparison above only exists because all five blocks were read against each other while two of them were being written. Discarding it means the next person to notice the overlap re-derives it from scratch, and ADR-0015's deferral keeps reading as "premature" long after its precondition stopped holding.

**The recommended shape, for whoever takes it up.** A thin shared core, not a wide one: the small set of keys that provably mean the same thing in every block — the confidence scalar, the readiness flags, `phase_summaries`, the sibling-task references — lifted into one shared definition each block references, with the domain-specific residue staying exactly where it is. Project documentation is not lifted but **deleted from the blocks**, because the top-level `project_context` already holds it. The phase-numbered field name is renamed in the same change, since renaming a frozen name is the expensive part and there is no reason to pay for it twice. A read tolerance for the old names is part of that change, not an afterthought to it.

### Consequences

#### Good
- ADR-0015's deferral is closed out honestly: its precondition is recorded as met, so the next reader starts from the evidence rather than from the word "premature"
- The recommended shape is written down while the five blocks are fresh in one reader's head, which is the only moment the comparison is cheap
- The rejection of full genericisation is recorded with its reason, so the cheapest-looking fix does not get picked up later as the obvious one
- This change stays prose-only, so the contract surface is untouched and nothing needs a fixture, a register row or a tolerance rule

#### Bad
- The duplication and the three names for one scalar stay in the schema, and every new workflow written before the factoring will copy one of them
- A known-stale description stays on a contract surface deliberately, which is uncomfortable to leave in place even as a filed item
- The phase-numbered field name survives another release, and every run written in the meantime records it
- A deferral recorded twice is a deferral that may be recorded a third time; nothing here forces the factoring to happen
