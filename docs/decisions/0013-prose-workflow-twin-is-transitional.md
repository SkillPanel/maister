# ADR-0013 — The prose workflow twin is transitional

**Status**: Accepted, closed 2026-09-30 · **Date**: 2026-08-26 · **Sources**: `plugins/maister/skills/workflow-engine/SKILL.md` § "Probe the runtime", § "Resume"; `plugins/maister/skills/research/SKILL.md`; `plugins/maister/skills/development/SKILL.md`; `README.md` (requirements); ADR-0009, ADR-0012

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

**Rollout status: the default has changed over for three of the four definition-backed
workflows, and the prose has not been deleted.** Research switched first, development followed,
and performance after it — all on the same mechanism: one variable, `MAISTER_WORKFLOW_PROSE`,
set to a non-empty value, selects the prose phases for every workflow that has them. A second
variable was deliberately not introduced: per-workflow opt-outs would multiply with the
definitions, and an operator escaping an engine defect wants one switch, not a matrix.

Retirement is two events, not one, and only the first has happened — now for three of the four.
What licensed each was the condition this ADR set: a parity checklist walked green against real
runs. For research that was a full run exercising both optional stretches, all three gates asked
and answered in session, and a second run taking a stop option at the first gate. For
development it was three runs against a twenty-six-node graph — two exercising the guarded
stretches and the stop path, and a third closing the Skill-tool handover the switch itself
depends on. For performance it was five runs, two of them attended, walked against a parity
checklist until the count of failing rows reached zero. Those runs earned their keep in every
case: research's turned up a convergence instruction that could not be satisfied as written,
development's turned up a state-writer defect that silently discarded operator-set options, and
performance's turned up delegate prompts that re-wrote the prior phases' decisions instead of
carrying them, which no static sweep could have found.

**What still blocks deleting the prose.** Three things, and none of them is time passing:

- **Directories with no frozen graph.** A task directory written before the engine is resumable
  only by the prose phases, so the prose cannot go while such runs are still open. This is the
  precondition below, unchanged by the switch.
- **Installs with no script runtime.** The engine has deliberately no editor-tool fallback for
  state writing, so on a machine without Node the prose twin is not a preference but the only
  path. Deleting it turns a soft requirement hard, which is the breaking change this ADR says
  needs a deprecation note and a release of its own.
- **The workflows that are not switched over yet.** All four now ship a definition, so none of
  them is prose-only in the sense of having no engine path. But shipping a definition and
  running it by default are separate events: a definition-backed workflow keeps running its
  prose phases until its own entry point flips, and a definition may ship unflipped while its
  evidence is still being gathered. While any workflow still runs its prose phases by default,
  the prose orchestrators are load-bearing regardless of what the switched-over ones do, so
  nothing is saved by deleting a twin whose workflow has already switched over.

Until all three clear, the prose twin stays maintained rather than merely present, and the
parity checklist stays with it.

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

### Amendment 2026-09-27 — retirement is decided for 3.0
The retirement this record set is taken in plugin 3.0.0, a major release of its own, as the
Consequences above require (ADR-0025). Its three blockers are answered rather than waited out:
a directory with no frozen graph is refused on resume and finished on a maintained 2.x line; an
install with no script runtime stays on that line, because 3.0 requires Node 20; and of the two
workflows not switched over, `migration` switches before 3.0 and `product-design` stays a standalone
prose orchestrator until its own definition lands (ADR-0025). The twins,
the `MAISTER_WORKFLOW_PROSE` switch and the branches that reach them are removed there, by path.
This record stays as the reason the twin existed.

### Amendment 2026-09-30 — closed: the twins are removed
The retirement is done. The four prose twins — `development`, `research`, `performance` and
`migration`, the last added when `migration` switched to the engine — are deleted, the
`MAISTER_WORKFLOW_PROSE` switch is no longer read anywhere, and each orchestrator `SKILL.md` is a pure
hand-off to the engine. The engine's runtime probe stops without Node 20 instead of handing the run
over, and a task directory with no `workflow:` block is refused on resume by the engine's
`resume-check` verb rather than resumed by a twin. Nothing in this record is live any more; it stays
as the reason the twin existed.

### Amendment 2026-10-02 — no prose orchestrator is left
The exception the 2026-09-27 amendment kept — `product-design` as a standalone prose orchestrator
until its own definition lands — is gone. It ships a definition in 3.0 (ADR-0025, amendment
2026-10-02), so no workflow in the plugin has a prose implementation of any kind.
