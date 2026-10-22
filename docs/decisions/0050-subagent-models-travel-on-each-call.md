# ADR-0050 — A subagent's model and effort travel on each call

**Status**: Accepted · **Date**: 2026-10-22 · **Builds on**: ADR-0044 (node briefs), ADR-0006 (additive state) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/subagents.mjs`, `dispatch-model.mjs`, `node-brief.mjs`; `skills/workflow-engine/references/grammar.md` (*Subagent models*); `skills/orchestrator-framework/references/orchestrator-patterns.md` § 1 and § 4; `skills/implementation-plan-executor/SKILL.md`; `agents/implementation-planner.md`; `platforms/copilot-cli/build.sh`; `Makefile`; `tests/engine/dispatch-model.test.mjs`

## TL;DR
- **A project chooses**, in a `subagents` block of `.maister/config.yml`: a three-rung ladder
  (`light`, `standard`, `deep`) with a cell per host, named presets, and assignments per agent,
  per workflow and per step. Overlays and profiles carry the same key without the ladder.
- **The engine resolves, the call carries.** The freeze records the merged block in the run;
  `dispatch-model` prints one model and effort per agent, and every agent call copies them beside
  its type. Nothing in frontmatter decides it.
- **Implementers by plan tier.** The planner writes a tier and a reason on every task group; the
  executor runs each on the cheapest allowed model at or above it, escalates a failure once, one
  rung up, within a ceiling and a budget, and records what each group ran on.
- **Conservative defaults.** Without a block, five clerical agents run on `light` and every other
  agent on the host's choice, with no effort sent.

## ADR-0050 {#adr-0050}

### Status
Accepted. No workflow definition changes and no graph hash moves: the block is recorded under
`orchestrator.options`, the dispatch lines are node prose and skill prose, and the executor's
records go in work-log bodies whose headings are unchanged. State changes are additive.

### Context
Every agent ran on the session's model, fixed by `model: inherit` in its frontmatter — which also
outranks a user's own subagent model setting on Claude Code. A run spends most of its tokens in
subagents, and many of them (the clerical agents, a codebase scout, a task group that copies an
existing pattern) need far less than the session's model. Both hosts take a model on each agent
call, and that value outranks frontmatter, so the choice belongs at the call. The hosts differ:
Claude Code takes only its aliases (`haiku`, `sonnet`, `opus`, `fable`) and an `effort` it checks
before launch; Copilot takes model ids, silently replaces an alias with a model of its own, and
takes a `reasoning_effort` it never checks. Both honour a per-call model on their built-in
explore agent.

### Considered Options
1. **Frontmatter per agent.** One choice for every project, and no way to vary it per workflow,
   step or task group. Rejected: nobody wants the model hardcoded.
2. **The value in each node's brief only.** No call at the dispatch site, but standalone skills
   and commands get nothing, and a skill's fan-outs happen long after its brief was read.
3. **A verb run right before each fan-out** (chosen). One call per fan-out; the value is in
   context at the call, survives a compaction, and works with no run under way.
4. **Enforcement by a hook** rewriting each agent call. Feasible on both hosts, deferred: a miss
   costs money, never quality, and the records will show whether misses happen.

For escalation, always asking stops unattended runs on every miss, and a configurable switch
defaulting to ask would mostly go unused; one automatic rung up, then the existing failure
question, bounds the spend.

### Decision
1. **The block and its precedence** are the grammar's *Subagent models*: plan tier, profile,
   overlay, the project's step, workflow, agent and default scopes, maister's own table, then the
   host. `inherit` prints as `omit`: the call carries no such field.
2. **The freeze judges and records** the block in `orchestrator.options.subagents`. A block with
   an error is refused whole with a warning and maister's table applies; `config.yml` is read
   again only by the next run, and a changed file adds one note to `dispatch-model`'s output.
3. **Every agent call carries the values.** An `agent:` node copies its brief's `runs:` line;
   every other call — fan-outs in skills, `direct:` steps' delegates, fixes, companions, index
   refreshes, the review and work commands — runs `dispatch-model` just before it. The rule is
   written once, in `orchestrator-patterns.md` § 1; each site carries one line. A field the host
   refuses is dropped, the call sent again, and one warning line written.
4. **The planner's tier** — `light` for mechanical work with a pattern to copy, `standard` for new
   behaviour in one layer, `deep` for cross-cutting work, concurrency, security, a schema change
   or brittle tests — is read only by an agent whose entry says `choose: by-plan-tier`.
5. **The executor's records**: a `**Model**:` line opening each group's work-log entry, which the
   engine's budget count parses; an `**Escalated**:` line when it escalated; the model and tier in
   the group's task metadata; and a tally the implementation node's summary carries.
6. **Source agents name no model** except `project-analyzer`'s `haiku`, the host-level fallback;
   `make validate` refuses `model: inherit`.
7. **The Copilot build** rewrites `--host=claude` to `--host=copilot`, so the verb answers with
   Copilot's ids, and the field pair `` `model` and `effort` `` to `` `model` and
   `reasoning_effort` ``; `make validate` refuses a `--host=claude` left in the variant's prose.

### Consequences
- Projects choose without forking agents, one block serves both hosts, and a resumed run keeps
  the models it started with.
- A model composing a call copies a printed value and never works out precedence itself.
- Nothing yet guarantees the value is passed: a forgotten one falls back to the session's model,
  as before. The work-log records make misses visible, and an enforcement hook stays possible.
- An escalated retry runs on top of the failed group's partial edits, as a manual retry does.
- The engine reads and judges `.maister/config.yml` for the first time.
- With no block, behaviour changes only for the five clerical agents, and for users whose own
  subagent model setting now reaches maister's agents.
