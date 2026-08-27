# ADR-0016 — Mid-graph entry is not an engine feature

**Status**: Accepted · **Date**: 2026-08-27 · **Sources**: `plugins/maister/commands/work.md`; `docs/commands.md`, `docs/workflows.md`; `plugins/maister/skills/workflow-engine/SKILL.md` § "Resume"; ADR-0013, ADR-0014

## TL;DR
Two resume options the prose orchestrators offer — restarting from a named phase, and clearing a phase's accumulated attempts — have **no expression in a graph**. `needs` is acyclic, so there is no edge back to an earlier node; attempt budgets are node prose rather than run state, so there is nothing to reset. The engine path therefore **declines both explicitly** rather than accepting a flag it would silently ignore, and the prose twin remains the sanctioned route for the case they serve.

## ADR-0016: Mid-graph entry is not an engine feature {#adr-0016}

### Status
Accepted. Nothing here changes a registered shape; it fixes what the engine path does with two options it cannot honour.

### Context
A prose orchestrator is a sequence a reader follows, so re-entering it partway is a matter of telling the reader where to start. Two resume options fall out of that naturally: start again from a named phase, and clear the count of attempts a phase has already spent. Both are documented, both are useful, and both are reached for exactly when a run has gone wrong in a way the operator understands better than the workflow does.

The engine is not a sequence. It resumes by recomputing a ready set from the frozen graph and the recorded per-node statuses: a node is ready when everything it needs is satisfied. Under that model, "start from phase seven" is not an instruction the runner can carry out. There is no edge from a later node to an earlier one, because `needs` edges that cycle have no ready set — acyclicity is what makes the ready set computable at all. Honouring the request would mean rewriting the recorded statuses of an in-flight run so the desired node computes as ready, which is editing history rather than resuming.

Attempt budgets fail the same request differently. They bound the loop-shaped behaviour inside a phase (ADR-0014), and they live in the node prose beside the definition rather than in the definition or in the run's state — deliberately, so they do not read as an engine feature the runner implements. Nothing counts them into state, so there is no counter for a flag to clear.

The question was what the engine path should do when an operator passes one of these anyway.

### Decision Drivers
- A flag accepted and ignored is worse than a flag refused, because the operator believes it worked
- The frozen graph is the record of what a run did; rewriting it to satisfy a flag makes the record untrue
- The prose twin still exists, and it genuinely serves this case

### Considered Options
1. Accept both flags on the engine path and ignore them, keeping one command surface across both paths
2. Implement mid-graph entry by rewriting recorded node statuses so the named node computes as ready
3. Add a cycle or a jump construct to the grammar so re-entry is expressible
4. Introduce a run-state attempt counter so at least the attempt flag has something to clear
5. Decline both explicitly on the engine path, and name the prose route as the sanctioned one ← chosen

### Decision Outcome
Chosen option: **decline both explicitly**. The engine path refuses the two options by name and says why, and the operator documentation marks them as belonging to the prose route. The runtime instruction files the agent itself reads no longer offer them for a workflow the engine actually executes — that half matters most, since a file telling the agent to pass a flag the path declines is a defect the operator never sees the cause of. The converse matters as much: withdrawing them from a workflow still running its prose phases refuses an option that works.

Option 1 is the failure this decision exists to avoid. An operator who passes a phase to restart from, and gets a run that quietly starts wherever it would have started anyway, has been told the wrong thing by the tool at the moment they were already recovering from something. Option 2 was rejected because the frozen graph is evidence: a run's recorded statuses are what a later reader, a dashboard and a resumed session all trust. A flag that edits them to make a node ready produces a run whose record says something that did not happen. Option 3 buys a permanent grammar construct for a recovery case that already has a working route, and it would reintroduce cycles into the one property that makes the ready set computable. Option 4 was rejected because it inverts the reasoning: the counter does not exist because attempt budgets were deliberately kept out of state, and adding state solely so a flag has something to clear is adding the feature to justify its flag.

**The prose route is sanctioned, not merely tolerated — and it is named for what it actually offers.** While the prose twin exists (ADR-0013), an operator who needs mid-run re-entry has a supported way to get it, and the documentation says so plainly rather than leaving the decline as a dead end. What that way *is* differs by workflow, and the decline has to say which: development's prose phases document a named entry point and honour `--from=PHASE` directly, while research's re-enter by artifact presence — each phase skips ahead when its outputs are already on disk — and carry no phase flag at all. Pointing an operator at a phase jump that a given twin does not implement replaces one inert flag with another, which is the same defect one level down. When the prose twin is retired, this becomes an open gap and will need its own answer — most likely a narrower one, since by then the case will have been observed rather than anticipated.

**The decline follows the engine path, not the definition file.** A workflow declines the two options exactly when a run of it is executed by the engine — which is a property of how it is reached, not of whether a definition exists on disk. Shipping a definition and being reached through it are separate events, and conflating them withdraws working options from a workflow whose behaviour has not changed. A workflow still reached by its prose phases keeps both options in full, and gains the decline at the moment its entry point switches over.

### Consequences

#### Good
- An operator learns immediately that an option does not apply, at the moment they pass it, rather than by inspecting a run that ignored it
- The frozen graph stays a truthful record, because nothing edits recorded statuses to manufacture readiness
- The grammar gains no construct for a case that already has a route

#### Bad
- The two paths differ in their operator surface, so a workflow's documented options depend on which path runs it
- Retiring the prose twin removes the sanctioned route and leaves the case unserved until something replaces it
- An operator whose habit is the flag has to learn the opt-out that selects the prose path, which is a second thing to know at the worst moment to learn it
- The decline's advice is per-workflow rather than uniform, because a prose twin's re-entry mechanism is its own: a twin without a phase flag can only be re-entered by re-running it
