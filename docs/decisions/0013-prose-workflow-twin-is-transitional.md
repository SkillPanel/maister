# ADR-0013 — The prose workflow twin is transitional

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `plugins/maister/skills/workflow-engine/SKILL.md` § "Probe the runtime", § "Resume"; `plugins/maister/skills/research/SKILL.md`; `README.md` (requirements); ADR-0009, ADR-0012

## TL;DR
A workflow that the engine runs from a definition also exists as a prose orchestrator, and the prose one is the fallback when the script runtime is missing. That pairing is **kept through rollout and then retired**, not maintained forever: two authored copies per workflow, each with its own parity checklist and its own several-hundred-check suite test, is a cost that grows with every workflow that gains a definition, and it polices paths nobody exercises. Retirement turns the runtime requirement from soft to hard, so it is a breaking change with a stated blocker in front of it.

## ADR-0013: The prose workflow twin is transitional {#adr-0013}

### Status
Accepted. Nothing here changes a registered shape; it fixes the lifetime of an implementation that already exists.

### Context
The engine writes every state change through a script and has deliberately no editor-tool fallback (ADR-0012), for the same reason a gate answered in one turn writes no pending marker (ADR-0009): the alternative writer is the one known to corrupt, so half a writer is worse than none. What a run falls back to instead is the prose orchestrator, which needs no script at all.

That makes the prose copy load-bearing in exactly one situation — an install with no script runtime — and the requirements already ask for one: the plugin registers its gate hook through it on every session. Today that requirement is soft. An install without it degrades gracefully; the hook prints a non-blocking error and prose workflows still run. Making the engine the only path would end that graceful degradation, which is why the question is a decision rather than a cleanup.

The other half of the context is arithmetic. Each workflow that gains a definition is authored twice, and keeping the two honest is not free: a parity checklist per pair, and a suite test of several hundred checks behind it. At four workflows that is on the order of twelve hundred checks guarding code paths that only run on machines nobody develops on — which is precisely where drift is worst and least visible.

### Decision Drivers
- A fallback that looks supported and silently differs is worse than one that is honestly absent
- Parity cost is per workflow and compounds, while the fallback's value is time-bounded
- A requirement that hardens is a breaking change and must be announced as one

### Considered Options
1. Maintain both implementations permanently, at parity, as a supported dual path
2. Delete the prose orchestrators now and make the runtime a hard requirement immediately
3. Keep the prose copies but stop maintaining them, as best-effort
4. Keep them through rollout as the escape hatch, then retire them and harden the requirement ← chosen

### Decision Outcome
Chosen option: **keep, then retire**. The prose orchestrator stays while the engine proves itself, and it stays *maintained* while it stays — the parity checklist is what makes that claim checkable. Once the engine is proven, the prose copy is removed and the runtime moves from soft-required to hard-required.

Option 1 loses on the arithmetic above, and it loses worse over time: the second implementation is the one nobody runs, so its checks are the ones that go stale, and every new workflow doubles the bill. Option 2 gives up something real while it is still needed — during rollout the prose path is the known-good escape hatch, and an operator who hits an engine defect unsets the opt-in and gets the previous behaviour back in one step. Option 3 is the worst of both: an unmaintained fallback still looks like a supported path, and the person who discovers otherwise is by definition the person whose machine cannot run the alternative.

**Retirement has a precondition, not a schedule.** A task directory written before the engine carries no frozen graph and is resumable only by the prose orchestrator. Retirement therefore waits until those runs have closed out, or until the engine can adopt a directory that has no graph in it. That is a blocker on the removal, not a caveat attached to it.

### Consequences

#### Good
- Nothing new is built on the assumption of a permanent second implementation, so the parity bill stops growing at the workflows that already carry one
- The escape hatch exists exactly while it is worth its cost, and its removal is a decision already taken rather than an argument to be had later
- After retirement there is one implementation of each workflow, so a behaviour question has one answer

#### Bad
- Until retirement, every definition-backed workflow is authored twice and both copies must be changed together
- The parity checklist is scaffolding with a defined end: it gates the switch, guards the rollout and retires with the twin, which is why it is kept with the run's verification evidence rather than in the shipped tree or in these docs
- Its suite check runs only where that evidence is present, so enforcement is local to a maintainer's checkout rather than continuous — accepted deliberately for a check that retires with the thing it guards
- Retirement breaks installs without a script runtime, so it needs a deprecation note ahead of it and a release of its own
