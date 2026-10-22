# ADR-0050 — A subagent's model and effort travel on each call

**Status**: Accepted · **Date**: 2026-10-22 · **Builds on**: ADR-0044 (node briefs), ADR-0006 (additive state) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/subagents.mjs`, `dispatch-model.mjs`, `node-brief.mjs`; `skills/workflow-engine/references/grammar.md` (*Subagent models*); `skills/orchestrator-framework/references/orchestrator-patterns.md` § 1 and § 4; `skills/implementation-plan-executor/SKILL.md`; `agents/implementation-planner.md`; `skills/init/SKILL.md`; `platforms/copilot-cli/build.sh`; `Makefile`; `tests/engine/dispatch-model.test.mjs`

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
- **Built-in defaults, written out.** Without a block, the five clerical agents and `Explore` run
  on `light` at high effort, implementers on the planner's tier, and every other agent on the
  host's choice. `init` writes the same table into `config.yml` for the team to edit. A per-agent
  entry, maister's own included, outranks every `default`.

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
1. **The block and its precedence** are the grammar's *Subagent models*. First the plan tier,
   clamped; then every entry naming the agent, most specific layer first — the profile, the
   overlay, the project's step, workflow and agent scopes, maister's own table; then the
   defaults in the same layer order; then the host. **A per-agent entry beats every default**:
   a project default covers only the agents nobody names, so the clerical agents stay on `light`
   until a project names them. `inherit` prints as `omit`: the call carries no such field.
2. **Maister's own table**: the ladder Haiku / Sonnet / Opus (Copilot's `claude-haiku-5.5`,
   `claude-sonnet-5.5`, `claude-opus-5.5`), the `light` cell carrying `effort: high`; the five
   clerical agents and `Explore` on `light`; `task-group-implementer` on `choose: by-plan-tier`
   over all three rungs, `unassessed: standard`, `ceiling: deep`, `budget: {deep: 3}`; every other
   agent inherits. A rung's effort applies to what runs on it unless the entry sets its own; a
   project's cell is laid over the shipped one, so a remapped `light` keeps `high` unless the
   cell sets an effort, and `effort: inherit` on a cell or an entry sends none. A small model on
   high effort still costs far less than the next rung, and a light group that fails is retried
   a rung up.
3. **The freeze judges and records** the block in `orchestrator.options.subagents`. A block with
   an error is refused whole with a warning and maister's table applies; `config.yml` is read
   again only by the next run, and a changed file adds one note to `dispatch-model`'s output.
4. **Every agent call carries the values.** An `agent:` node copies its brief's `runs:` line;
   every other call — fan-outs in skills, `direct:` steps' delegates, fixes, companions, index
   refreshes, the review and work commands — runs `dispatch-model` just before it. The rule is
   written once, in `orchestrator-patterns.md` § 1; each site carries one line. A field the host
   refuses is dropped, the call sent again, and one warning line written. The block governs only
   the calls maister makes: the explore agents a host's own plan mode starts are outside it.
5. **The planner's tier** — `light` for mechanical work with a pattern to copy, `standard` for new
   behaviour in one layer, `deep` for cross-cutting work, concurrency, security, a schema change
   or brittle tests — is read only by an agent whose entry says `choose: by-plan-tier`, as the
   implementer's does unless a project replaces it.
6. **The executor's records**: a `**Model**:` line opening each group's work-log entry, which the
   engine's budget count parses; an `**Escalated**:` line when it escalated; the model and tier in
   the group's task metadata; and a tally the implementation node's summary carries.
7. **Source agents name no model** except `project-analyzer`'s `haiku`, the host-level fallback;
   `make validate` refuses `model: inherit`.
8. **The Copilot build** rewrites `--host=claude` to `--host=copilot`, so the verb answers with
   Copilot's ids, and the field pair `` `model` and `effort` `` to `` `model` and
   `reasoning_effort` ``; `make validate` refuses a `--host=claude` left in the variant's prose.
9. **`init` writes the table out.** A new `config.yml` gets the `subagents` block uncommented,
   holding maister's own values, with presets, a `default` and a per-workflow entry as commented
   examples; a `config.yml` with no `subagents` key gets the block appended and nothing else
   changed; an existing block is left alone and the summary says so. Where `git ls-files`
   (outside `.maister/`) lists more than 2,000 files — or, outside git, the same count skipping
   `node_modules`, `vendor`, `dist`, `build` and dot-directories — `Explore` is written on
   `standard` at high effort, since a scout over a codebase that size needs more than the light
   rung. A test holds the written block to the shipped table.

### Consequences
- Projects choose without forking agents, one block serves both hosts, and a resumed run keeps
  the models it started with.
- A model composing a call copies a printed value and never works out precedence itself.
- Nothing yet guarantees the value is passed: a forgotten one falls back to the session's model,
  as before. The work-log records make misses visible, and an enforcement hook stays possible.
- An escalated retry runs on top of the failed group's partial edits, as a manual retry does.
- The engine reads and judges `.maister/config.yml` for the first time.
- With no block, the clerical agents and `Explore` run on a small model at high effort, an
  implementation's groups run on Haiku, Sonnet or Opus by plan tier (a group without one on
  Sonnet, a fourth `deep` group asking first), and a user's own subagent model setting now
  reaches maister's other agents.
- The table lives twice, in the engine and in the block `init` writes; the test comparing them
  keeps the two in step, and a project's written block keeps the values it was initialised with
  when maister's own change.
