# ADR-0022 — A `workflow:` node runs as a sub-run: an ordinary sibling task directory, frozen through the existing path

**Status**: Accepted · **Date**: 2026-09-22 · **Sources**: `plugins/maister/skills/workflow-engine/SKILL.md` and `references/sub-runs.md`; `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs`, `scripts/lib/state.mjs`; `plugins/maister/hooks/gate-lib.mjs`; `plugins/maister/skills/umbrella/SKILL.md` § the write-order contract; ADR-0008, ADR-0012, ADR-0017

## TL;DR
A `workflow:<name>` node that carries no `dir:` stops meaning "stop the run" and starts meaning
"freeze a child run of that workflow and wait on it". The child is frozen by the same
`validate` → `resolve` → `write-state` path that freezes any run — no new verb — into an
**ordinary sibling task directory** whose name is derived deterministically from the parent run
and the node. Three writes bracket the start, and their order is the contract: the child freezes
(W2), the parent records the link (W3), and only then may a marker be printed or the child
execute. `task_path` and `run_id` are reserved against a `workflow:` node's declared outputs. A
definition may declare a workflow-level `outputs:` block, and that block enters `graph_hash`
through **one unconditional envelope** — `{nodes, outputs}` for every definition, block or no
block — which moves all four built-in hashes once, deliberately and in the open.

## ADR-0022: A `workflow:` node runs as a sub-run {#adr-0022}

### Status
Accepted. This record fixes where a child run lives, the order its three writes land in, the two
reserved names, the hash envelope, and the five scope lines the mechanism is drawn at. It amends
ADR-0008, which stands: the scheme list, its resolution rules and its warning severity are
unchanged — only the sentence that nothing executes a sub-run stops being true.

### Context
The `workflow:` scheme has been in the definition grammar since the grammar was frozen, and
nothing ever ran it. Reaching such a node stopped the run with a message saying so. That was
honest while no caller needed composition, and it stopped being honest the moment a triage chain
needed to run research before it could route: without a runtime for the scheme, the only way to
compose two workflows is a second coordination mechanism — a chain, a dispatch, an operator
copying a report between two task directories by hand.

Giving the scheme a runtime means answering three questions that reach past this repository,
because two other programs read what a run writes: the gate hook that decides whether a session
may write, and the cockpit daemon that discovers and drives runs by sweeping task directories.
Where does a child run live? In what order are the parent's and the child's state written? And
what does a definition's declared interface do to its identity?

### Decision Drivers
- Nothing may change in the gate hook: it is fail-closed by construction (ADR-0001) and every
  edit to it is a compatibility event
- A new engine verb is expensive in three places at once — the hook's engine-entry list, the pro
  edition's verb family, and a cockpit allow-list pinned to the previous contract tag
- A gate pending in a run with no session id binds *every* session, so any ordering that lets a
  child suspend while a parent write is outstanding is a deadlock, not a race
- A definition's identity must not depend on whether an optional key happens to be present
- The mechanism must name no workflow: research is the first child-capable definition, not a
  special case in the engine

### Considered Options
1. A dedicated engine verb that creates and freezes a child run
2. The child as a subdirectory of the parent's own task directory
3. No runtime at all — express composition as a workspace chain of two independent runs
4. **The child frozen through the existing freeze path, into an ordinary sibling task directory
   with a deterministic name** ← chosen

### Decision Outcome
Chosen option: **the existing freeze path, into an ordinary sibling task directory**.

**The child is an ordinary task directory, and that is load-bearing rather than tidy.** Its name is
`<child-type>/<parent-date>-<parent-slug>-<node>/`: the child workflow's own task type, the parent
run directory's date and slug, and the parent node id verbatim. It is never nested under the
parent. The reason is the gate hook's own state walk, which enumerates
`.maister/tasks/<type>/<name>/` and reads the state file it finds there. A nested child would be
invisible to that walk — a run whose gates no hook could see — and the alternative to being
ordinary is teaching the hook a second layout, which is the one change this design exists to
avoid. The same property is what lets the cockpit daemon adopt a child in its ordinary sweep, and
what makes a child list and resume like any other run. **A later refactor of that walk must treat
the sibling layout as a contract**, which is why it is recorded here and not only in the engine's
prose.

The name being *derived* rather than timestamped is the second half of that decision. Every input
is the parent directory's name and the node id, so a parent re-driven after a crash between W2 and
W3 computes the same name, finds the directory and adopts the child already in it. Without
determinism that crash window starts a second child on every re-drive, and nothing would notice
but an operator's disk. A directory that exists but holds a run whose parent link names another
run or another node is refused by name rather than overwritten.

**The write order is W2 → W3 → marker, and it is a contract, not an implementation detail.**

1. **W2 — the child freezes**, in exactly one `write-state` call carrying the task block, the
   workflow block with its nodes, the interpolated inputs, the driver and the parent link. It must
   stay one call: a state that carries a workflow block but no nodes and no task reads as
   *gate-pending* to the hook's own reader, so a two-call freeze makes the child look pending
   between the calls and the hook denies the second one — a child that can never be finished and a
   parent that can never proceed.
2. **W3 — the parent records the link**, `status: waiting` with `values.task_path` and
   `values.run_id`, and it completes **before the child may execute**. A gate pending in a run
   whose driver block carries no session id binds every session; a child that suspends while the
   parent's write is still outstanding denies that write, and the parent can no longer record a
   child it has already created. This is the umbrella's "record before you announce" rule at the
   scale of a run rather than a dispatch, quoted rather than reinvented.
3. **The marker last, and only under a driven run.** Under a cockpit or dispatch driver the
   turn's final line is `WAITING-SUBRUN`. Under a terminal driver it is never printed: the turn
   does not end at W3, and a marker there would be a line nobody will ever answer and a run an
   operator would believe was suspended.

W2 precedes W3 for a reason of its own: the parent's `values.task_path` must name a directory that
already exists, or a crash between the two leaves a parent pointing at nothing and the refusal
fires on the run an operator most wants to continue. In the reverse order the crash window leaves
a child with no parent record — which the derived name makes recoverable, and the forward order
makes impossible.

**`task_path` and `run_id` are reserved names.** A `workflow:` node may not declare either under
its `outputs.values` or `outputs.artifacts`; doing so is a validate-time error. A node's values map
is replaced whole on every patch, so a copied child output of either name would be merged over the
parent link and the parent would **silently lose the address of its own child** — the failure is
not a wrong value but an unfindable run. The reservation binds the parent's declaration only and
needs no twin on the child side: a child may expose a key of either name freely, because a parent
simply cannot declare it, which makes the key unreachable rather than dangerous.

**A verb was rejected on its blast radius.** Freezing a child needs nothing the existing
`validate`, `resolve` and `write-state` verbs do not already do; a new one would add an entry to
the gate hook's engine-entry list, a row to the pro edition's verb family and an entry to a cockpit
allow-list that is pinned to the previous contract tag — three coordinated changes across two
further repositories to express a sequence the engine can already write. **The nested-child shape
was rejected** for the walk, above. **Doing nothing and composing by chain was rejected** because a
chain is a second coordination mechanism with its own ledger, worktree and close-out, and a parent
that needs one child run does not need a workspace.

#### The hash decision, in full
A definition may now declare a workflow-level `outputs:` block — its interface to a caller,
mapping an exposed key to a dotted reference to a node's declared output. The block **enters
`graph_hash`**: a definition whose declared interface changed is a different graph, and until now
a definition could carry such a block and hash as if it did not.

**The envelope is unconditional.** The hashed input is always

```
{nodes, outputs}
```

with the canonical outputs reduced the same deterministic way the canonical node list already is,
and an absent block canonicalised to the same empty form an empty block produces. There is no
branch and no second spelling.

**The conditional envelope was weighed at the decision gate and rejected.** That form — wrap only
when a block is present, hash the bare node list otherwise — costs nothing today and keeps every
existing hash where it is. It was rejected because it makes a definition's identity depend on
whether an optional key is present: two definitions that declare nothing would hash from different
neighbourhoods depending on how they spell "nothing", and the exception would be invisible in the
value it produces. It holds for a year and then surprises whoever adds the first empty block, at
which point the surprise lands on a consumer comparing a frozen hash against a fresh resolve. One
envelope for every definition is the rule, and the cost is paid once, now, visibly.

**The cost is that every built-in's `graph_hash` moves — all four.** `research`, `development`,
`performance` and `migration` all re-hash, and so does every workspace chain, because the envelope
changed for all of them and not only for the definition that gained a block. Three consequences
follow and are named rather than left to be discovered: the four generated diagram files each pin
their definition's hash and all four are expected diffs; every recorded hash constant in the pro
tree re-pins for four definitions, not for research alone; and on the dispatch path a chain frozen
before this change refuses its next dispatch of **any** built-in with the graph-drifted refusal
until that run finishes or is re-started. A resume is unaffected — it runs the frozen graph and
never re-resolves — so the operator-visible window is the dispatch path, and it belongs in the
release note.

#### The five lines the mechanism is drawn at
Each was put to the operator and each is a deferral with a named refusal rather than a rejection.

- **A `workflow:` node carrying `dir:` keeps its dispatch meaning** and refuses a sub-run by name,
  pointing the author at dispatch. Two runtime meanings behind one spelling, with nothing telling
  an author which one they got, is the failure that refusal prevents. The member-repository child
  is deferred: dispatch already gives a member run a worktree, a session and a close-out that a
  sub-run would reach by a second route with neither.
- **No grandchildren.** A run whose state already carries a parent link starts no child. One level
  is what composition needs, and refusing here makes a cycle impossible without walking an
  arbitrary chain of state files at every child start — where the failure mode, while the walk is
  wrong, is unbounded directory creation.
- **The two cross-checks warn at validate time and refuse at run time.** The parent's `with:` map
  against the child's declared inputs, and the parent node's declared outputs against the child's
  declared block, are warnings when the child definition resolves and say nothing when it does
  not — matching how an unresolvable `workflow:` target already warns (ADR-0008). Erroring would
  fail exactly the workspace chains this feature exists for. The run-time refusal is the one that
  fails a node, and it is unconditional.
- **A stopped child stops the parent run.** The parent node records `stopped`, every unexecuted
  node is recorded `stopped`, the task status becomes `stopped`, and no failure marker is printed.
  A stop is an operator's decision, and a child's stop is not a parent's failure.
- **The engine freezes a cockpit-driven child and starts nothing.** It writes the child's state,
  inputs, parent link and a driver block with no session, prints the waiting marker and ends the
  turn. The daemon's ordinary sweep adopts the child, because the daemon and never the engine
  writes a driver session. Stating what the parent does *not* do is necessary: a reader otherwise
  assumes the parent owes the child a process it cannot create.

### Contracts-v7 delta
The shapes this change adds are additive, and the wave that lands them in the pro register § C5 —
the compatibility register, which lives in the pro edition and not in this repository — does not
have to re-derive them. The enumerated list is written as a deliverable into this change's own task
directory, at
`.maister/tasks/development/2026-09-21-engine-workflow-subruns/implementation/contracts-v7.md`,
with one row per shape: the child's parent link; the node status `waiting`; the parent node shape
and its two reserved names; the workflow-level `outputs:` block and its entry into `graph_hash`;
the `WAITING-SUBRUN` marker; the `SUB-RUN-DONE` prompt kind and its addressing rule; the refusal
names, two of which join the marker vocabulary; the child task-directory layout, which needs no new
layout row because it is an ordinary dated task directory; the research parity row, replaced rather
than shifted; and the four-built-in hash re-pin above. Three fixtures sit beside it — a
parent/child state pair, a marker sample and a prompt-line sample — because a captured fixture pins
a write order that prose cannot.

Until that wave lands, a driven consumer on the previous tag reads the two new line-level refusal
tokens as undetermined with no diagnostic, and reads the waiting marker as a turn it could not
classify and re-drives the parent on every sweep. The waiting path is idempotent under a re-drive,
so that is noisy rather than harmful.

### Consequences

#### Good
- A workflow composes another with no second coordination mechanism: no chain, no envelope, no
  ledger, no operator carrying a report between two task directories
- Nothing changed in the gate hook, and no verb was added, so the hook's engine-entry list, the pro
  verb family and the cockpit's allow-list are all untouched by this change
- The child is an ordinary run: it lists, resumes, gates and is swept exactly like one an operator
  started, and the cockpit's sub-run panel starts drawing a real child with no projection change
- A crash between the two bracketing writes is recoverable by construction rather than by cleanup,
  because the child's directory name is derived and adoption is by directory
- One hash envelope means a definition's identity never depends on the presence of an optional key,
  and the rule has no exception a later reader must discover

#### Bad
- Every built-in's `graph_hash` moves at once — the widest consequence of this change — and any
  chain frozen before it refuses its next dispatch of any built-in until that run is finished or
  re-started
- A sub-run serialises the parent's ready set: no second ready node executes while a child runs,
  including one in an unrelated parallel branch, so work beside a sub-run needs two runs rather
  than two branches
- The child-gate / parent-write ordering is a genuine deadlock whose only enforcement in this
  repository is prose; the fixtures exist so the pro suite can pin it
- A cockpit-driven sub-run is not end-to-end until the daemon half ships, and until then a cockpit
  on the previous tag re-drives a waiting parent on every sweep
- The member-repository child and the grandchild case are both deferred behind refusals, so a
  legitimate two-level composition has to wait for a record that reopens them
