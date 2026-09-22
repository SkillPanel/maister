# Sub-runs — a `workflow:` node executed as a child run

A node whose `uses` names the `workflow:` scheme and carries no `dir:` starts a **child run**: a
sibling task directory with its own frozen graph, its own state file and its own driver, linked
back to the node that started it. The parent node waits, adopts the child's terminal status, and
exposes the keys the child's definition declares. A `workflow:` node that *does* carry `dir:`
keeps its dispatch meaning and is not a sub-run at all — one scheme, two mechanisms, told apart by
one key, which is why the first refusal below exists rather than a silent choice between them.

The engine's `SKILL.md` carries the summary; the walks, the matrix and the refusal table are here.

---

## Before any write — the checks that refuse

Performed in this order, each failing the **parent node** (and the run, unless a downstream node
catches it with `on:`) before anything is created:

1. the node carries `dir:` → `subrun-on-dir-node`;
2. the parent run's state carries `orchestrator.parent` → `subrun-recursion`. One level of nesting
   is what the design needs, and refusing on the link makes a cycle impossible without cycle
   detection;
3. the target resolves in none of the four homes → `subrun-target-unresolved`;
4. the interpolated `with:` misses an input the child declares required, or names one it does not
   declare → `subrun-input-missing` / `subrun-input-unknown`;
5. a key the node declares under `outputs:` has no entry of that name in the child definition's
   workflow-level `outputs:` → `subrun-output-unmatched`.

**All five are performed by the driver, from this prose.** No verb runs them: the graph module
spells the vocabulary, it does not decide these refusals. What it guarantees is that there is one
spelling of each code — an exported constant is their single source, so this file and any code that
ever raises them cannot drift into two names for one refusal. Of the checks the module's constant
covers, only the reserved-name one runs as code, at validate time. Read this list as the operative
statement of *when* each refusal fires, and the module as the authority on *how it is spelled*.
Checks 4
and 5 also run at validate time, as warnings, whenever the child definition resolves: the warnings
are what an author sees first, the refusals are what fail a run.

---

## Walk one — a terminal driver, one turn, no marker

| Moment | The write | What it carries |
|---|---|---|
| **W1 — the node starts** | `write-state` against the **parent** state | `nodes.<node>`: `kind: workflow`, `status: running`. The writer stamps `started` |
| — | *no write* | resolve the name, interpolate `with:`, run the checks above, derive the child directory name, create it, `validate` and `resolve` the child definition |
| **W2 — the child freezes** | one `write-state` against the **child** state | `task` (title, description, status `in_progress`, and `task.key` when the child marks a tracker key input); `workflow` (`source`, `overlays`, `profile`, `graph_hash` exactly as `resolve` printed it, `grammar_version`, `name`) **together with** its `nodes`; `orchestrator.options.inputs` (the interpolated `with:`, plus `embedded: true` when the child declares that input); `orchestrator.driver` (`{kind: terminal}`); `orchestrator.parent` (`{run, node}`); and `orchestrator.created` and `orchestrator.updated`, carried in the patch like any other run's first write — the writer stamps `updated` *after* applying the patch, by the same append rule that lands a key the region does not already carry at the end of it, so a freeze that omits the two ends the block with `updated` below `parent` and in the opposite key order to the worked block this file draws. A child's freeze is necessarily that run's first write: a state file carrying no `workflow:` block is refused `state-incomplete`, so there is no initialise-first, freeze-second two-step to spread it over. |
| **W3 — the parent records the link** | `write-state` against the **parent** state | `nodes.<node>`: `status: waiting`, `values: {task_path, run_id}` |
| — | *the child runs, in session* | the ordinary engine loop against the child's state. Child gates are asked with the host's question tool and answered in the same turn; the child's own close-out prints its marker |
| — | *no write: the re-resolve* | read the child's state, re-resolve the definition **it** names, compare hashes, read its declared `outputs:` and the producing nodes' declared paths |
| **W4 — the parent adopts the outcome** | `write-state` against the **parent** state | `nodes.<node>`: the mapped status, `values` re-sent whole as `{task_path, run_id, …copied values}`; `node_summaries.<node>`; the `phase_summaries` key the node prose names when it mirrors one |
| — | continue | the parent resumes its ready-set walk; `${<node>.artifacts.<key>}` and `${<node>.values.<key>}` resolve |

**`WAITING-SUBRUN` is never printed under a terminal driver.** That is a rule, not an implication.
The turn does not end at W3, so a marker printed there would be a line nobody will ever answer and
a run an operator would believe was suspended.

---

## Walk two — a cockpit or dispatch driver, freeze, print, end the turn

W1, W2 and W3 are identical but for one field: W2's `orchestrator.driver` is
`{kind: cockpit, cwd: <project root>}` (or `{kind: dispatch, cwd: …}`) and carries **no
`session`**. The daemon assigns a session when it adopts the run; the engine never writes one.

Then, and only then:

4. `dashboard-data.js` is rewritten to show the waiting node, by the same prose that rewrites it
   after any other phase;
5. `WAITING-SUBRUN: <node> run=<child-run-id>` is printed as the **last** line of the turn;
6. the turn ends. Nothing polls, nothing waits, no session is left idle.

**`WAITING-SUBRUN` is typed by the driver, and no verb emits it.** The engine's other two closing
markers come out of the `run-complete` verb — that is why the rule elsewhere is to echo the verb's
line and never to type a marker it did not give you — but nothing the engine ships prints the
string `WAITING-SUBRUN`: not a verb, not a module, not a constant. A driver that goes looking for
a tool to produce it will not find one, and a suite that greps the scripts for it will not find it
either. The line above is composed by the driver from two things it has just written: the node id
and the child's `values.run_id`. Hence the grammar is pinned in prose rather than deferred to a
tool's output, and hence the ordering rule that W2 and W3 both land before step 5.

The distinction matters to whoever is about to trust one of these lines. A verb marker is printed
by the engine's own tooling at the point a run closes, after the closing write has landed and
whatever the verb does check has passed — a dispatched run's published close-out among them.
`WAITING-SUBRUN` asserts only that the driver *believes* it froze a child
and recorded the link — nothing re-read the disk to confirm it. So a reader takes it as a signal to
go look at the child run, never as evidence of its state, and the parent's own wake-up path takes
the same view: **the disk wins, always** (see the ending table and the `SUB-RUN-DONE` rule). Treat
the marker as the engine's testimony and a re-drive becomes a way to be told a comfortable lie;
treat it as a pointer and a lost, duplicated or stale line costs nothing but a re-drive.

**The parent does not drive a cockpit child and spawns nothing.** What it starts is a directory
and a frozen state file; the daemon discovers the child in its ordinary task-directory sweep — the
reason a child is a sibling directory and not a subdirectory of the parent — and spawns its
driver. Say what the parent does not do, or a reader assumes it owes the child a process it cannot
create.

**A sub-run serialises the parent's ready set.** Ready nodes execute one at a time in frozen-graph
order and the turn ends at the marker, so a second ready node — one in an unrelated parallel
branch included — does not execute while the child runs; each re-drive re-prints and ends until
the child is terminal. Under a terminal driver the same serialisation holds invisibly. An author
who wants work to proceed beside a sub-run needs two runs, not two branches.

---

## Ending, and the re-resolve that precedes W4

| Child `task.status` | Parent node | Parent run |
|---|---|---|
| `completed` | `completed` | continues its walk; declared outputs are exposed |
| `failed` | `failed` | ends `RUN-FAILED: sub-run <child-run-id> failed`, unless a downstream node declares `on: failure` or `on: always` |
| `stopped` | `stopped` | **stops outright**: one patch carries `task.status: stopped` and every unexecuted node `stopped`, then `run-complete` closes the run. No `RUN-FAILED` — a stop is a legitimate outcome |
| anything else (absent, `in_progress`) | unchanged, stays `waiting` | the waiting path runs again |

**The failed row's reason is pinned, not free text: `RUN-FAILED: sub-run <child-run-id> failed`,
with the child run id spelled exactly as the parent node recorded it in `values.run_id`.** The
marker's grammar is `RUN-FAILED: <reason>`, so leaving the reason to the driver would put a
different sentence in every implementation's closing line for the one ending an operator most
often has to explain. The run-level `subrun-*` codes are not available here: each of those names a
refusal the parent itself raised before or instead of running a child, and this ending is the
opposite — nothing refused, the child ran and reported `failed`. Pinning the spelling is what lets
a reader, or a sweep over closed runs, tell the parent's own failure from an adopted one, and go
straight to the child that carries the reason.

**The parent must re-resolve the child definition before it copies anything, because the frozen
state holds no declaration.** A node entry carries a fixed key set and the workflow block six
scalars beside its nodes; neither holds `uses`, neither holds `outputs`, so the mapping from an
exposed key to a producing node and its declared path exists in exactly one place — the child's
definition file. Between the child's terminal status and W4: read the child's state with a
read-only tool; re-resolve the definition **the child's own state names** — its `workflow.source`,
`workflow.overlays` and `workflow.profile`, never a path composed by the parent, because a caller
that could name the definition could name a different one; compare the freshly resolved
`graph_hash` with the recorded one and refuse `subrun-graph-drifted` on any disagreement; then
resolve each declared entry to its producing node and take the path and the recorded value there.

This is the dispatch runtime's rule, not a new one: it re-resolves at every dispatch for the same
reason and refuses `dispatch-graph-drifted` on a mismatch. Two runtimes that read a definition
after a freeze must both prove it has not moved underneath them.

---

## The child directory name

```
.maister/tasks/<child-type>/<parent-date>-<parent-slug>-<node>/
```

`<child-type>` is the child workflow's own task type. `<parent-date>` is the parent directory's
`YYYY-MM-DD` prefix, or the turn's measured date when it has none. `<parent-slug>` is the parent
basename with that prefix and its hyphen removed — the whole basename when there is no prefix.
`<node>` is the parent node id.

Normalisation applies **to the slug only**, in this order: lower-case; every character outside
`[a-z0-9-]` replaced with a hyphen; runs of hyphens collapsed to one; leading and trailing hyphens
trimmed. A slug that normalises to the empty string is omitted with its hyphen. If the assembled
name exceeds 100 characters the **slug** is truncated — never the date, never the node id — at the
last hyphen boundary that fits, and hard-cut when there is none.

**The node id is appended as the graph spells it and is never normalised.** A node id may end in a
hyphen, so a child directory may too. Rewriting it would break the one property the name exists
for: determinism. Both the directory-name pattern and the flow charset admit the trailing hyphen.

Three properties, each naming a failure. **Deterministic** — every input is the parent directory's
name and the node id, so a parent re-driven after a crash between W2 and W3 computes the same name
and adopts the existing child instead of starting a second one. **Unique** — the name carries the
parent's own, so two parents running the same child on one day do not collide. **Ordinary** — it
keeps the dated task-directory shape, so the existing walks find it and it lists and resumes like
any other run. Nothing about a child is special, which is why no hook changes.

Adoption is by directory, not by scan:

| The derived directory | The engine |
|---|---|
| does not exist | creates it and freezes the child into it (W2) |
| exists, holds a state file whose `orchestrator.parent` names this run and this node | **adopts** it: W2 is skipped and W3 records the existing child |
| exists, holds no state file — a crash between the creation and the freeze | freezes into it. An empty directory carries no run and nothing is overwritten |
| exists, holds a state file whose parent link names another run or another node | `RUN-FAILED: subrun-child-foreign` — it refuses rather than overwriting a stranger's run |

---

## The worked state pair

The parent node entry, in the writer's canonical one-line style, at four spaces, in the frozen key
order, every value through the flow emitter — a timestamp quoted because it carries a colon, a
task path not because it is inside the bare charset. While waiting:

```
    probe: {kind: workflow, status: waiting, started: "2026-09-21T14:03:11Z", needs: [intake-gate], values: {task_path: .maister/tasks/probe/2026-09-21-alpha-42-intake-probe, run_id: 2026-09-21-alpha-42-intake-probe}}
```

and after the child completed, with one declared value copied beside the two reserved names:

```
    probe: {kind: workflow, status: completed, started: "2026-09-21T14:03:11Z", completed: "2026-09-21T15:22:48Z", needs: [intake-gate], values: {task_path: .maister/tasks/probe/2026-09-21-alpha-42-intake-probe, run_id: 2026-09-21-alpha-42-intake-probe, conclusions: adapter-scope-bounded}}
```

`values.task_path` is repository-root-relative — the address shape the layout rule requires and
the one a cockpit can open — and `values.run_id` is its basename, carried explicitly because the
marker and the wake-up line are both checked against it. **The values map is replaced whole on
patch**, so W4 re-sends both beside the copied values; dropping them there is not a partial
update, it is the parent link deleted.

The child's `orchestrator:` block, written by the freeze in canonical two-space form. `parent`
lands **last** because the writer appends a key the region does not already carry at the end of
that region — the position is emitted, not chosen:

```
orchestrator:
  options: {inputs: {question: "How should the adapter be scoped?", ticket: ALPHA-42, embedded: true}}
  driver: {kind: cockpit, cwd: /Users/alex/code/acme-workspace}
  gate_pending: null
  created: "2026-09-21T14:03:11Z"
  updated: "2026-09-21T14:03:11Z"
  task_path: .maister/tasks/probe/2026-09-21-alpha-42-intake-probe
  parent: {run: .maister/tasks/plan/2026-09-21-alpha-42-intake, node: probe}
```

`parent.run` is the parent's repository-root-relative task directory rather than its id, so a
child that must find its parent has the address in hand rather than a name to sweep for; the id
the wake-up line carries is that path's basename. `parent.node` is the parent node id. The key is
written once, at the freeze, and never edited, so it is replaced whole rather than merged.

**The parent reads this key with an ordinary read-only tool**, and that needs saying: the state
writer is the only thing that *writes* state, but the adoption check and the W4 read are reads —
the no-editor-tool rule is about writes and is untouched.

The writer holds the key to a shape — a plain object, exactly `run` and `node`, both strings,
`node` matching the node-id spelling, `run` flow-safe and relative under the task root — and
refuses anything else under the **existing** patch-invalid code. The refusal vocabulary is closed
and does not grow because a key gained a shape check.

---

## Refusals, in one place

Two line-level tokens, printed in the manner of `GATE-INVALID` and `GATE-ALREADY-ANSWERED`, and
ten run-level codes carried by `RUN-FAILED: <code>` in the manner of `closeout-unpublished`.
Neither family joins the writer's fifteen refusal codes: nothing here is a write refusal.

| Name | Family | Raised when |
|---|---|---|
| `SUB-RUN-INVALID: <reason>` | line-level, printed | the wake-up line is malformed or does not match the state |
| `SUB-RUN-ALREADY-DONE` | line-level, printed | the named node is no longer `waiting` |
| `subrun-on-dir-node` | run-level | a sub-run was asked for on a node carrying `dir:` — use dispatch |
| `subrun-recursion` | run-level | the run already carries `orchestrator.parent`; a child starts no grandchild |
| `subrun-target-unresolved` | run-level | the named workflow resolves in none of the four homes |
| `subrun-input-missing` | run-level | the interpolated `with:` misses an input the child declares required |
| `subrun-input-unknown` | run-level | the interpolated `with:` names an input the child does not declare |
| `subrun-output-unmatched` | run-level | the node declares an output the child definition does not expose, or declares a path the child's producing node does not |
| `subrun-output-reserved` | validate-time error | a `workflow:` node declares an output named `task_path` or `run_id` |
| `subrun-graph-drifted` | run-level | the child definition was edited while the child ran: the freshly resolved hash disagrees with the one it froze |
| `subrun-child-foreign` | run-level | the derived child directory holds a run whose parent link names another run or another node |
| `subrun-state-missing` | run-level | the child directory or state file is absent at the recorded `task_path` |

The four codes the graph module spells — the three pre-start ones and the reserved-name one — are
exported from it under one name, so this table and any code that raises them share one vocabulary
rather than two that drift. Spelling is all that is shared: only the reserved-name code is raised
from there, at validate time, while the three pre-start refusals are performed by the driver from
the list above. Validate-time warnings keep the shape the existing
unresolved-reference warning has: `unresolved-subrun-input:<node>:<name>` and
`unresolved-subrun-output:<node>:<name>`.

`subrun-state-missing` is never a licence to re-create the child: the directory was either never
written or deliberately deleted, and re-starting would duplicate a run that may still be
executing.

**It writes nothing either, and the silence is a decision.** The alternative was to record the
node `failed` and let the run end there, which reads as tidier and is worse: it is the parent
inventing an outcome for a child it cannot find, and it is irreversible — an operator who restores
a directory that was moved, or a mount that came back late, then has a run permanently recorded as
failed over a lookup that would now succeed. Writing nothing leaves the node `waiting` with the
`task_path` and `run_id` that name what is missing, so the refusal is repeatable, the diagnosis is
still on disk, and the run recovers by re-drive the moment the cause is fixed. The cost is that
the parent is stuck until somebody acts — which is the right cost for a missing run, and the same
shape as A2's "no write" row, where repetition without a write is likewise the correct behaviour.

### The `SUB-RUN-INVALID` reason vocabulary

The token is contractual and so is one property of the reason: **it names the field at fault, in
that field's own spelling — `run=`, `node=`, `child=`, `status=` or `at=`, trailing `=` included.**
The rest of the sentence is prose for an operator and is not fixed. Without that property two
conforming engines could both print `SUB-RUN-INVALID: malformed line` and neither would be wrong,
which turns the whole line into a `false` an operator has to debug by hand against a grammar with
five fields. With it, the line says which field to look at, whoever emitted it.

Five worked examples, one per way a line can be wrong — illustrative wording, contractual field
naming:

```
SUB-RUN-INVALID: the field child= is missing
SUB-RUN-INVALID: the field node= appears more than once
SUB-RUN-INVALID: the field why= is not one of run= node= child= status= at=
SUB-RUN-INVALID: the field at= must be last; status= follows it
SUB-RUN-INVALID: the field status= carries "done", not one of completed failed stopped
```

The third names the offending field even though the grammar has no such field — an unknown key is
still a field at fault, and quoting it back is what tells an operator they typed `why=` for
`status=`. A mismatch against the state names the field whose value disagreed (`run=`, `node=` or
`child=`) by the same rule.

**A suite checks the token and the field name, never the sentence.** Byte-matching one of these
five makes a fixture into a contract and fails the next engine that words its reason better, which
is exactly the freedom the rule leaves open on purpose.

---

## The two cross-checks, and the node they skip

Both warn at validate time — and only when the child definition resolves — and both refuse
unconditionally at run time. Every input the child declares `required: true` must be present in
the node's `with:`, and every key in `with:` must be an input the child declares. Every key the
node declares under `outputs.artifacts` or `outputs.values` must be exposed under the same name by
the child's workflow-level `outputs:`, and for an artifact the path the node declared must be the
one the child's producing node declares. Binding is by name; there is no renaming grammar.

**A node carrying `dir:` is skipped by both.** Such a node is a dispatch, and the workflow it
names resolves in the *member* repository rather than this one — so holding it against a local
file of the same name would warn about a disagreement that does not exist, on every node of every
workspace chain. **The reserved-name check still applies to it**, because that one is a rule about
what a `workflow:` node may declare, whatever ends up running it.

---

## The interruption matrix

| # | Interruption | Required behaviour |
|---|---|---|
| A1 | crash after W2, before W3 | the re-driven parent derives the same directory, finds it, reads its `orchestrator.parent`, confirms it names this run and this node, **adopts** it and writes W3. Exactly one child exists |
| A2 | a re-drive arrives while the child still runs | no write. The dashboard is rewritten, `WAITING-SUBRUN` re-printed unchanged, the turn ends. Repeatable without limit and without a second child |
| A3 | a duplicate wake-up after the node already completed | `SUB-RUN-ALREADY-DONE` is printed, nothing is written, the node keeps its recorded status and values |
| A4 | the child directory is missing at the recorded `task_path` | `RUN-FAILED: subrun-state-missing`, and **no write**: the node stays `waiting` with its recorded values, so every later re-drive reaches the same refusal until an operator restores the directory or edits the run. The child is never re-created and the run never silently re-started |
| A5 | the parent run is stopped while a child is waiting | the child keeps running and finishes as an ordinary run; its parent link dangles, which is tolerated. Nothing tells the child, and nothing should |
| A6 | the child fails | the parent node is `failed`; the run ends `RUN-FAILED` unless a downstream node declares `on: failure` or `on: always` |
| A7 | the child is stopped | the parent node is `stopped`, `task.status` becomes `stopped`, every unexecuted node is recorded `stopped` in one patch, and **no `RUN-FAILED` is printed** |
| A8 | a child gate is raised while a parent write is outstanding | cannot happen: W3 completes before the child executes. Verified by reading the write order in the captured state pair |
| A9 | the child's definition is edited between W2 and W4 | `RUN-FAILED: subrun-graph-drifted`. The parent copies nothing from an interface the child never froze |
| A10 | a cockpit child raises a gate before the daemon has written `driver.session` | a pending gate with no session binds **every** session, so the parent's next write would be denied — the protection is the write order: every parent write is finished before the turn ends, so there is no write left to deny. A re-driven parent treats a child pending with no session as non-terminal, re-prints the marker and ends, and **never** writes the child's `driver.session` itself. If the window persists the operator answers the child's gate directly, exactly as for any other pending run |
| A11 | the parent stops or fails while a cockpit child is frozen but **not yet adopted** | the child is an ordinary frozen run: the sweep still adopts it and it runs to its own terminal status with a dangling parent link. The engine deletes nothing — a frozen run an operator can drive by hand is not garbage to collect |

---

## Making a workflow child-capable

Seven steps, and none of them touches the engine. A second child-capable workflow is a definition
change and a companion paragraph.

1. **Declare the input.** Add `embedded: {type: bool, required: false, default: false}` to
   `inputs:`. The engine supplies it at the child freeze; an operator never types it.
2. **Guard the closing node.** Put `when: "!${inputs.embedded}"` on the node that exists only to
   tell an operator the run is over, and on anything else with no meaning for a parent.
3. **Declare the interface.** Add a workflow-level `outputs:` block naming, by key, every artifact
   and value a parent may read. A key a parent cannot see does not exist to it.
4. **Make every node driver-capable.** Either a minute's verification or the bulk of the seven
   steps, depending on where the workflow starts — nothing else here is close, so find out which
   before planning the change. The requirement is per node: every question a node asks *inside
   itself* must name, in its own prose, the answer a run with nobody to ask takes, because a child
   under a cockpit or dispatch driver is never asked one. Read each node in turn and look for a
   question with no such answer named; a workflow that has none is already driver-capable and this
   step is a read. A question that genuinely needs an operator gets no default: it moves to a gate
   node, which the child suspends on in its own Run view. Leave one unnamed and the node answers it
   unobserved — and the parent adopts, as an outcome, a run that decided something nobody saw.
5. **Keep the exposed values flow-safe and short** — no newline, no quote, the bare charset
   preferred. A value is a handle; the detail belongs in an artifact.
6. **Expect the recorded identity to move, then regenerate the diagram.** The `outputs:` block is
   part of what `graph_hash` covers, so a definition that declares an interface is no longer the
   one that declared none: the hash changing is the freeze telling the truth about a changed
   interface, not damage to undo. Regenerating the rendered diagram is a step of its own rather
   than part of declaring the block — it rewrites generated files, and may be batched with any
   other definition change in flight. What must not be deferred is the declaration: a diagram
   regenerated before the block is added records an identity no run will ever freeze.
7. **Say so in the companion.** Keep the workflow's `## Embedded mode` heading — every companion
   carries one — and rewrite its body: what the workflow declares, that the engine supplies
   `embedded`, and which node the guard skips.

A workflow that stays standalone says so in the same place and points here, rather than restating
the recipe where it will go stale.
