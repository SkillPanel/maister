# Change workflow — node prose

The node-by-node companion to `change.yml`. The engine executes every `direct:`
node from the section below that carries its id, and hands the per-node context
in `with:` to whatever the node names.

**What this file carries that the graph cannot.** The definition says which
nodes exist, what they need and what they declare. It says nothing about what
"one bounded change" means in practice, what the verification node runs, or what
finishing a dispatched run involves — and those are the three things a reader of
this workflow most needs.

**This workflow has no user surface.** There is no orchestrator skill for it and
no slash command, and therefore no `SKILL.md` twin for a parity checklist to
hold this definition in step with. This file is not that twin: it is the node
prose the engine executes from, and the definition requires it. The workflow is
reached as `workflow:change` from a chain node that carries a `dir:`, and
nowhere else — so the prose below is written for a dispatched worker acting on a
seed, not for an operator who read a command's help.

**Its sibling is `fix.md`.** That definition is this spine with the
reproduce-first discipline added, and the sections the two share —
`Run-scoped context`, `Phase summary keys`, `standards-discovery`, `verify` and
`close-out` — are written to be identical in both files. They are held equal by
the contracts suite rather than by intent: an edit to one that the other does
not receive turns the suite red. Edit them together.

**If the engine cannot run, there is nowhere to hand the run to.** The engine
skill's degraded path prints `RUN-FAILED: node-unavailable` and hands the run to
the workflow's prose orchestrator; this definition has none, so for a change run
that path ends nowhere. The answer is the one a dispatched worker already has
for anything else it cannot do: report `blocked` through the outbox verb its
seed names, with the reason, and stop. A run under a terminal driver has neither
a seed nor an outbox, so it has nowhere to report to: say to the operator in
session that the engine is unavailable and that this workflow has no prose route
around it, and stop there. Under either driver, do not run the workflow by hand
instead — the state, the gate files and the artifact declarations are what
anything outside the run reads, and none of them is writable correctly without
the engine.

---

## Run-scoped context

Two fields reach every delegate without appearing in any node's `with:`, because
they belong to the run rather than to a node:

- `task_path` — the task directory every artifact path is relative to.
- `project_doc_paths` — discovered by the first node and read from state after.

That is the whole list, and the two absences are deliberate:

- **No `html_style_guide_path`.** Neither artifact this workflow writes takes an
  `.html` companion, so no companion is ever requested and no style guide is
  ever passed.
- **No accumulated `phase_summaries`.** A run this short accumulates none worth
  naming; see the next section for what is written instead.

Anything node-scoped is in `with:` instead.

---

## Phase summary keys

**There are none, and that is the point.** Every node writes a node summary
under its own id in `node_summaries`, and nothing is mirrored anywhere else.

This run carries **no per-workflow context block**, the way a chain run carries
none. There is therefore no second namespace for a phase key to live in, and a
node that invented one would be writing into a block the engine cannot derive.
Read `node_summaries` by node id; that is the only place a summary of this run
exists.

---

## Icon hints

The dashboard needs an `icon_hint` for every node it draws, and the value is not
derivable from the node id. Each node writes the hint named here:

| Node | `icon_hint` |
|---|---|
| `standards-discovery` | `analysis` |
| `change` | `code` |
| `verify` | `verify` |
| `close-out` | `done` |

The gate is not in that table on purpose: **a gate node renders the icon of the
phase it gates**, so `change-approval` writes `verify`. A gate inherits rather
than owns its icon, so a gate that picked its own would break the visual pairing
between a stretch and the approval that closes it.

---

## Embedded mode

**This definition declares no `embedded` input.** Its input table is exactly
`statement` and `docs_index`, no node is guarded on an embedded flag, and no
node is skipped for a parent's benefit. **A change run is never embedded.**

`research.yml` has an `## Embedded mode` section because it declares that input
and guards its final node on it. Nothing here does, so there is no embedded path
to describe and none to be written later without changing the definition first.

What a caller gets instead is the close-out: the work is committed and pushed in
the member repository, and the outbox message is what the dispatching chain
reads — see the `close-out` section for what does and what does not cross the
dispatch boundary.

---

## `standards-discovery`

Executed inline, writes no files, and does one job: find the standards the work
must satisfy, so the node that makes the change is not left to infer the
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
   what exists; the files are what the work must satisfy.

**The greenfield fallback.** When no index exists — a new project, or one that
never ran an initialization — do not stop and do not invent standards. Work
normally against the code's own conventions, and record in this node's summary
that no project standards were found and that running the initialization command
would establish them. A project with no index is a project whose conventions live
only in its code; say so rather than implying a standard was checked.

**Where the result lands.** Record every path read as
`project_context.project_doc_paths` in the run's state. That is the run-scoped
field the following nodes read; a path discovered and not recorded there is a
path the rest of the run never sees.

**No per-workflow context block.** This run writes `project_context` and its
node summaries and nothing else, so a worker must not invent one.

**Recovery budget**: one attempt. An unreadable index is the greenfield case;
treat it as such and say so rather than retrying against a file that is not
there.

---

## `change`

The node that does the work. It makes **one bounded change** — the statement in
`with:` is the whole of what the work is — together with the test that proves it.

**Bounded is the operative word.** This workflow exists because a chain needs a
target smaller than a full development run. A statement that turns out to need a
specification, a design decision between approaches, or edits across subsystems
is not this workflow's work: record what was found, make no speculative change,
and say in the node summary what shape the work actually is so the gate's
context carries it to an operator. Growing the change to fit the discovery is
the failure this paragraph exists to prevent.

**The standards discovered upstream apply.** Read
`project_context.project_doc_paths` from state and satisfy what those files say
while writing. When a new area is reached mid-change — a part of the codebase
the first read did not cover — read its standards before coding it rather than
after.

**The test is part of the change, not after it.** A change with no test is not
finished here: write or extend the test that would fail without the change and
passes with it, in the project's own test suite, following the project's own
conventions for where such a test lives.

**The artifact is `implementation/work-log.md`.** It records what changed and
why: the files touched, the decision behind each non-obvious edit, the test
added or extended, and anything deliberately left alone. It is a log rather than
a summary document, so it carries no positional summary block — the summary this
node contributes is its node summary in state.

> **SELF-CHECK**: before this node is marked completed, verify that
> `implementation/work-log.md` exists and names both the change and its test. If
> it is missing: **STOP. Do NOT proceed.** Re-drive the node with the gap named
> in the context. The artifact-existence check runs **before** the node is
> completed, never after the gate has already fired on a file that is not there.

**Recovery budget**: two attempts, the second with the gap named in the context.

---

## `verify`

Executed inline. It runs the project's own test suite — the whole of it, not
only the test this run added — and writes a short report of what it found.

**Find the suite the way the project declares it**, from its manifest, its task
runner or its continuous-integration configuration, in that order. A project
that declares no suite is reported as such: say so in the report and in the node
summary rather than inventing a command, and treat the change's own test as the
only evidence there is.

**Regressions matter more than the new test.** A suite that passes the new test
and breaks two others has not verified the work. Report failures by area, and
separate the ones this run's change plausibly caused from the ones that were
already failing when the run started — an already-red suite is a fact about the
member repository, not a finding about this change.

**The artifact is `verification/verification-report.md`.** It opens with the
artifact summary block: `## TL;DR` of one to five non-empty lines, then the key
decisions and the open questions. Positional, before any other `## ` heading — a
summary block that appears after another section is not a summary block. After
it: the command run, the pass and fail counts, each failure with the area it
belongs to, and the verdict this node hands to the gate.

**When the suite fails, ask whether to fix and re-run.**

> Verification found failures. Fix them and verify again, or carry them to the
> approval as they are?
>
> **Default under a non-terminal driver** (`verification-fix-loop`): the
> accept-as-is exit — do not take another pass. Record the failures in the
> report and in the node summary, and carry them into the gate's context line,
> where an operator sees them and decides. The gate is the operator's route back
> into the work, which is why a loop that nobody can answer stops rather than
> repeating.

At most two fix-and-verify passes under a terminal driver. A third is the signal
that the work is larger than this workflow, and the honest move is to carry what
is left to the gate rather than to keep going.

> **SELF-CHECK**: before this node is marked completed, verify that
> `verification/verification-report.md` exists and opens with the summary block.
> If it is missing: **STOP. Do NOT proceed.** Re-drive the node with the gap
> named in the context.

**Recovery budget**: two attempts, the second with the gap named in the context.

---

## `change-approval`

A gate, unguarded. Ask the question the definition carries and record the
answer. Its two options are `continue-to-closeout`, which continues, and
`stop-before-closeout`, which stops.

**The context this gate carries is what makes it answerable.** A summary of what
changed, the verification verdict, and anything the nodes above left open —
failures not fixed, scope the statement turned out to exceed. An operator
answering from outside the session has only what the request document says.

**Stop ends the run.** No node in this definition carries `on:`, so a `needs`
entry is satisfied by a completed or a skipped predecessor and never by a
stopped one. `close-out` needs this gate and is the only node left, so after
`stop-before-closeout` nothing is ever ready again and the run is over. That is
the whole mechanism — there is no termination construct beyond it. The work
stays in the worktree, uncommitted, for whoever comes next.

**How the question is asked depends on the run's driver, not on this file.**
When `orchestrator.driver.kind` is absent or `terminal`, the question is put to
the operator in session. When it is `cockpit` or `dispatch` — which is every
dispatched run of this workflow — it is not asked in session at all: the run
suspends instead, and an operator answers it from outside. The mechanism for
suspending belongs to the engine skill, which states it in full, and a
dispatched worker's seed states it again; this section only says which of the
two branches a run is in.

---

## `close-out`

Executed inline, unguarded, and reached only after the gate continued. It makes
the run's work durable and readable from outside, and it writes no new content.

**Commit and push, because nothing else in the run does.** The nodes above edit
the worktree; this node is what turns those edits into history:

1. Commit the work on the branch the dispatch named, with a message that says
   what changed and why — the work log is what it is drawn from. Commit the
   files this run touched, by path; a dispatched worker shares its checkout with
   nothing, but committing by path is what keeps that true.
2. Push that branch.
3. **Under a dispatch driver, publish the close-out through the outbox close-out
   verb** — the grade and the summary the seed's close-out contract asks for,
   and with them the two fields a follower reads without parsing prose:
   `commits`, the sha or shas this node just made, and `prs`, the pull request
   URL when the contract required one and an explicit empty list when it did
   not. Write that empty list rather than leaving `prs` out: an omitted field
   and a deliberate none are the same absence to whoever reads the message
   next. The summary still says all of it in prose — the two are read by
   different readers. The order is commit, push, publish, and only then record:
   the outcome value below is written after the publish succeeded, never before
   it.

**Why the publish is named here rather than left to the seed.** It used to be.
This section said that how the close-out reaches the dispatching chain is stated
in the worker's seed and to read it there — and a worker did every other thing
this node asks, committed, pushed, recorded `closed-out`, and published nothing.
The seed is one rendering delivered at spawn, many turns before this node; an
instruction held only by reference did not survive to the last thing the run
does. The chain has no second channel to learn a dispatch is over, so it waited
forever while the branch sat pushed on the remote and the worker's own state said
success. The engine refuses such a run now — `RUN-FAILED: closeout-unpublished`
— but a node that has to be caught by a guard is a node missing a step.

**What still belongs to the seed**, because it is per-dispatch and this file is
not: whether a pull request is required, the grade vocabulary to grade against,
and what a reviewer has to open. Read those there and follow them.

**Under a terminal driver there is no seed**, so there is no close-out contract
and no outbox. Commit and push as above, then say to the operator in session
what was committed and what a reviewer has to open. Do not invent a pull
request nobody asked for.

**What is recorded**, through the engine's `write-state` verb — never by editing
the state file directly — is the outcome value this node declares in the
definition: `closed-out` when the commit and the push both landed — and, under a
dispatch driver, when the close-out was published too — and
`stopped-before-closeout` otherwise.

**On the second member of that enum, honestly**: it documents a state no
follower ever observes, because the gate's stop option ends the run before this
node is reached. It is carried for the readability of the declaration, not for a
live consumer.

**None of these values crosses the dispatch boundary.** Nothing lifts a
dispatched run's declared outputs back into the chain: `${node.values.…}`
interpolation resolves against the declarations on the chain's own node,
nothing populates a dispatched node's values, and the return channel is the
outbox, which carries a grade, a summary, and the commits and pull requests
published above. A follower node must not be guarded on this run's outcome
value. What crosses is the branch: pushed, named by the dispatch, and there for
whoever reviews it.

**Recovery budget**: two attempts. A push that is rejected is not a reason to
force one — report it and stop, through the outbox under a driver and to the
operator in session otherwise.
