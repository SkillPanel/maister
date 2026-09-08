# Plan workflow — node prose

The node-by-node companion to `plan.yml`. The engine executes every `direct:`
node from the section below that carries its id, and hands the per-node context
in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need and what they declare. It says nothing about which
delegate writes the plan, and that is the one thing about this workflow a reader
most needs: the `plan` node **branches on provider**, and the branch is prose
here because neither host's planning agent is expressible as a target.

**State the consequence plainly**: a reader of `plan.yml` alone cannot see that
one provider hands the work to a built-in subagent and the other to a plugin
agent, and the generated diagram does not show it either.

**This workflow has no user surface.** There is no `plan` orchestrator skill and
no `/maister-quick-plan`-style command for it, and therefore no `SKILL.md` twin
for a parity checklist to hold this definition in step with. This file is not
that twin: it is the node prose the engine executes from, and the definition
requires it. The workflow is reached as `workflow:plan` from a chain node that
carries a `dir:`, and nowhere else — so the prose below is written for a
dispatched worker acting on a seed, not for an operator who read a command's
help.

**If the engine cannot run, there is nowhere to hand the run to.** The engine
skill's degraded path prints `RUN-FAILED: node-unavailable` and hands the run to
the workflow's prose orchestrator; this definition is the first with none, so
for a plan run that path ends nowhere. The answer is the one a dispatched worker
already has for anything else it cannot do: report `blocked` through the outbox
verb its seed names, with the reason, and stop. A run under a terminal driver
has neither a seed nor an outbox, so it has nowhere to report to: say to the
operator in session that the engine is unavailable and that this workflow has
no prose route around it, and stop there. Under either driver, do not run the
workflow by hand instead — the state, the gate files and the artifact
declarations are what anything outside the run reads, and none of them is
writable correctly without the engine.

---

## Run-scoped context

Two fields reach every delegate without appearing in any node's `with:`, because
they belong to the run rather than to a node:

- `task_path` — the task directory every artifact path is relative to.
- `project_doc_paths` — discovered by the first node and read from state after.

That is the whole list, and the two absences are deliberate:

- **No `html_style_guide_path`.** The plan file takes no `.html` companion, so
  no companion is ever requested and no style guide is ever passed.
- **No accumulated `phase_summaries`.** A four-node run accumulates none worth
  naming; see the next section for what is written instead.

Anything node-scoped is in `with:` instead. The prompt that asks a delegate to
write the plan also carries the artifact summary contract, so the summary this
workflow lifts into state is one the delegate wrote rather than one the engine
invented.

---

## Phase summary keys

**There are none, and that is the point.** Every node writes a node summary
under its own id in `node_summaries`, and nothing is mirrored anywhere else.

A plan run carries **no per-workflow context block** — no `plan_context`, the
way a chain run carries none. There is therefore no second namespace for a
phase key to live in, and a node that invented one would be writing into a
block the engine cannot derive. Read `node_summaries` by node id; that is the
only place a summary of this run exists.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `standards-discovery` | `analysis` |
| `plan` | `plan` |
| `handoff` | `done` |

The gate is not in that table on purpose: **a gate node renders the icon of the
phase it gates**, so `plan-approval` writes `plan`. A gate inherits rather than
owns its icon, so a gate that picked its own would break the visual pairing
between a stretch and the approval that closes it.

---

## Embedded mode

**This definition declares no `embedded` input.** Its input table is exactly
`statement` and `docs_index`, no node is guarded on an embedded flag, and no
node is skipped for a parent's benefit. **A plan run is never embedded.**

`research.yml` has an `## Embedded mode` section because it declares that input
and guards its final node on it at `when: "!${inputs.embedded}"`. Nothing here
does, so there is no embedded path to describe and none to be written later
without changing the definition first.

What a caller gets instead is the hand-off: `handoff` records the plan path and
the run's outcome in this run's state, and the plan file itself is what a
dispatching chain has afterwards — see the `handoff` section for what does and
what does not cross the dispatch boundary.

---

## `standards-discovery`

Executed inline, writes no files, and does one job: find the standards the plan
must be written against, so the planning delegate is not left to infer the
project's conventions from the code it happens to read.

**Read the index first, then the files it points at.**

1. When `docs_index` was supplied, that path **is** the index — read it and skip
   the search. A caller that already knows where the index lives has settled the
   question.
2. Otherwise read `.maister/docs/INDEX.md` in the project root when it is
   present.
3. **Then read the specific standard files the index points at that are relevant
   to the statement.** Reading the index alone is NOT sufficient — this is
   mandatory, and it is the step that most often gets skipped. The index names
   what exists; the files are what the plan must satisfy.

**The greenfield fallback.** When no index exists — a new project, or one that
never ran an initialization — do not stop and do not invent standards. Plan
normally, and record in the plan itself that no project standards were found and
that running the initialization command would establish them. A project with no
index is a project whose conventions live only in its code; say so rather than
implying a standard was checked.

**Where the result lands.** Record every path read as
`project_context.project_doc_paths` in the run's state. That is the run-scoped
field the `plan` node reads; a path discovered and not recorded there is a path
the planning delegate never sees.

**No per-workflow context block.** A plan run writes `project_context` and its
node summaries and nothing else. There is no `plan_context` block to write into
— like a chain run, this workflow has none — so a worker must not invent one.

**Recovery budget**: one attempt. An unreadable index is the greenfield case;
treat it as such and say so rather than retrying against a file that is not
there.

---

## `plan`

The node that produces the deliverable. **It branches on provider**, because the
two hosts offer different planning agents and neither is nameable as a target in
`plan.yml`: `agent:Plan` fails the target charset before any lookup, and the
lowercase spelling resolves against this plugin's own agents directory.

### On Claude Code

Delegate to the host's **built-in `Plan` subagent** through the Task tool, with
`subagent_type: "Plan"`. Pass it the statement from `with:` and the standards
paths `standards-discovery` recorded in `project_context.project_doc_paths`, and
ask for a plan that satisfies them.

**That subagent returns text and writes no files.** It is read-only by
construction — it cannot edit, write or spawn further agents. So **this node
writes `implementation/plan.md` itself**, from what the subagent returns. A node
that dispatches and then assumes a file appeared has produced nothing.

### On Copilot CLI

That host ships **no** such subagent, so delegate to this plugin's
`maister-implementation-planner` agent instead. The reason, stated so a reader
does not read the divergence as an oversight: its `task` tool accepts the agent
types `explore`, `task`, `general-purpose`, `rubber-duck`, `code-review`,
`research` and `security-review`, plus the installed plugin agents — there is no
`plan` value among them — and `--mode plan` is a **session mode**, not a
dispatchable subagent.

**The divergence this branch accepts, stated plainly.** That agent defaults to
writing `implementation/implementation-plan.md` and expects a specification
upstream of it. This workflow has no specification phase and its artifact is
`implementation/plan.md`, so:

- point the agent at `implementation/plan.md` explicitly, as the one path it
  writes; and
- read its own artifact-existence self-check **against that path**, not against
  the default the agent would otherwise check.

Pass it the statement and the discovered standards paths in place of the
specification it usually reads.

### Both branches

**The artifact is `implementation/plan.md`, and nothing else.** It opens with
the artifact summary block: `## TL;DR` of one to five non-empty lines, then the
key decisions and the open questions. Positional, before any other `## `
heading — a summary block that appears after another section is not a summary
block.

> **SELF-CHECK**: before this node is marked completed, verify that
> `implementation/plan.md` exists and opens with that block. If it is missing:
> **STOP. Do NOT proceed.** Re-drive the branch with the gap named in the
> context. The artifact-existence check runs **before** the node is completed,
> never after the gate has already fired on a file that is not there.

**Do not confuse this branch with the gate rule.** The provider decides *who
writes the plan*; `orchestrator.driver.kind` decides *how the gate after it is
asked*, and the two are read at different moments from different places. A run
dispatched into a member takes the Claude or the Copilot branch here according
to the provider it runs under, and answers `plan-approval` according to its
driver — see the next section.

**Recovery budget**: two attempts, the second with the gap named in the context.

---

## `plan-approval`

A gate, unguarded. Ask the question the definition carries and record the
answer. Its two options are `continue-to-handoff`, which continues, and
`stop-after-plan`, which stops.

**Stop ends the run.** No node in this definition carries `on:`, so a `needs`
entry is satisfied by a completed or a skipped predecessor and never by a
stopped one. `handoff` needs this gate and is the only node left, so after
`stop-after-plan` nothing is ever ready again and the run is over. That is the
whole mechanism — there is no termination construct beyond it.

**How the question is asked depends on the run's driver, not on this file.**
When `orchestrator.driver.kind` is absent or `terminal`, the question is put to
the operator in session. When it is `cockpit` or `dispatch` — which is every
dispatched plan run — it is not asked in session at all: the run suspends
instead, and an operator answers it from outside. The mechanism for suspending
belongs to the engine skill, which states it in full, and a dispatched worker's
seed states it again; this section only says which of the two branches a plan
run is in.

---

## `handoff`

Executed inline, unguarded, and reached only after the gate continued. It writes
no plan content: the plan already exists, and this node's whole job is to make
the run's result readable from the outside.

Two things are recorded, both through the engine's `write-state` verb — never by
editing the state file directly:

1. **The plan path as an artifact**: `plan` = `implementation/plan.md`, the
   artifact this node declares in `plan.yml`.
2. **The outcome as the declared enum**: `plan_outcome`, one of `approved` or
   `plan-only`. It is declared as an enum rather than as free text because a
   bare `string` is undecidable to the static check and warns, and a shipped
   definition resolves with exactly zero warnings.

**On the second member of that enum, honestly**: `plan-only` documents a state
no follower ever observes, because the gate's stop option ends the run before
anything downstream is reached. It is carried for the readability of the
declaration, not for a live consumer.

There is no gate after this node. The workflow ends here, and both records are
read from this run's own state — by an operator, by the dashboard, and by
anything that opens the task directory afterwards.

**None of these values crosses the dispatch boundary.** Nothing lifts a
dispatched run's declared outputs back into the chain: `${node.values.…}`
interpolation resolves against the declarations on the chain's own node,
nothing populates a dispatched node's values, and the return channel is the
outbox, which carries a grade and a summary. A follower node must not be
guarded on `plan_outcome`.

The plan itself is written at `implementation/plan.md` under this run's task
directory, inside the dispatch's own worktree in the member repository. Do not
read that as a route into a follower's input: the run directory is named at run
time and a follower's inputs are static literals, so the route from a
dispatched run's artifact to a follower's input is undefined at this version.
State where the plan is; promise nothing about who picks it up.

**Recovery budget**: none — this node records and nothing else.
