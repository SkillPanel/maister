---
name: workflow-engine
description: Runs a workflow definition — a graph of nodes with declared needs, guards and outputs — as an orchestrated run. Loads a definition plus any overlays, freezes the resolved graph into task state, executes the ready set, asks gates in session or suspends on them according to the run's driver, and writes every state change through the workflow tooling. Machinery invoked by a workflow's own orchestrator; not a workflow a user starts directly.
user-invocable: true
---

# Workflow Engine

The execution half of the workflow grammar. A definition file says which nodes exist,
what each one needs, what guards it and what it declares; this skill turns that graph
into a run — one ready set at a time, with state written by a script rather than by a
model holding a file open.

**This is machinery, not a feature.** A user reaches a workflow through that workflow's
own command, and that command's orchestrator hands the run here with a workflow name.
There is no engine command and no engine entry point of its own. Nothing in a user's
mental model needs the word "engine" in it.

**The gate mode follows the run's driver.** With no driver block, or one whose `kind` is
`terminal`, the engine asks its gates in session and answers them in the same turn. With
`kind` `cockpit` or `dispatch` it suspends on them instead — request file, pending marker,
`GATE-PENDING` line, turn over. Every rule below marked *mode-scoped* names which of the
two it holds for.

---

## Initialization

**BEFORE executing any node, you MUST complete these steps:**

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `ask_user` at a gate. They apply only to your discretionary clarifications. Invoke `ask_user` when `orchestrator.driver.kind` is absent or `terminal`; when it is `cockpit` or `dispatch` you MUST NOT ask in session — suspend the run with one `gate-request` call, which writes the request file, the gate index and `gate_pending` together, then rewrite the dashboard data, print `GATE-PENDING: <node>` as the last line and end the turn instead (`compatibility-contracts.md § E2`).

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.

### Step 1: Load framework patterns

Read `../orchestrator-framework/references/orchestrator-patterns.md` now. Delegation
rules, the state schema, initialization and resume, the artifact summary contract, the
dashboard and the companion reports all live there. This skill adds graph execution on
top of them and restates none of them.

### Step 2: Probe the runtime, before writing anything

Run `node --version` once. On failure, stop immediately: print `RUN-FAILED: node-unavailable`
and hand the run to the workflow's prose orchestrator, which needs no script — unless the
workflow has no prose orchestrator, in which case there is nowhere to hand it to: a
dispatched worker reports `blocked` through the outbox verb and stops, and a terminal-driver
run says the same to the operator in session and stops. Never run such a workflow by hand.

**There is deliberately no editor-tool fallback for state writing.** Model-authored state
is the corruption this engine exists to remove: a state file whose blocks drift out of
canonical shape is read as empty by one reader and as a pending run by another, which
denies every subsequent write in the session. Half a writer is worse than none.

This is the one place the engine diverges from the mockup skill's precedent. That skill's
fallback swaps one *rendering* for another and loses only fidelity; a fallback here would
swap the *writer*, and that is not a degraded mode but a different failure surface.

### Step 3: Resolve the workflow by name

**The name may arrive prefixed.** A workflow's orchestrator hands the run over naming its
workflow `builtin:<name>`, so the prefix is stripped before any filesystem lookup and
both forms are accepted — `builtin:research` and `research` resolve to the same three
candidates below. A prefix left on the name turns the lookup into a search for a file called
`builtin:research.yml`, which exists nowhere.

Search `.maister/workflows/` in the current project root, then its `generated/`
subdirectory, then the built-ins shipped beside this file:

| Found | Meaning |
|---|---|
| `.maister/workflows/<name>.yml` | an **eject** — it shadows the built-in entirely |
| `.maister/workflows/generated/<name>.yml` | a **generated** chain — published by the chain planner for one ticket, complete in itself |
| `.maister/workflows/<name>.overlay.yml` | an **overlay** — merged over the built-in |
| `workflows/<name>.yml` beside this skill | the shipped **built-in** |

Resolution order is eject → generated → overlay → built-in, and the first hit wins. A
generated chain is never overlaid and never ejected: there is no `generated/<name>.overlay.yml`
candidate, and a definition of the same name at the top of the directory would simply win —
which the planner's collision check prevents. Its path is what the freeze records as
`workflow.source`, exactly as for an eject, and the graph hash is computed from the resolved
graph, never from the path, so where a chain lives changes nothing about the run. Authoring an
eject or an overlay, and running an arbitrary definition file, are not this skill's business.

**Reading the opt-out switch, on every platform.** A workflow's own orchestrator hands runs
here by default, and `MAISTER_WORKFLOW_PROSE` is what sends a run to the prose twin instead —
so the way it is read has to work wherever the plugin runs. Read it as
`node -p "process.env.MAISTER_WORKFLOW_PROSE ?? ''"`: the same one line is correct under
zsh, bash, PowerShell and cmd.exe, and `node` is already a hard prerequisite of the engine.
`printenv` is not — it does not exist in cmd.exe or PowerShell, and a read that fails there
looks exactly like a variable that was never set.

**Which way a failed read falls matters more now than it did.** While the engine was opt-in,
a read that silently failed left the operator on the prose path with no engine and no error.
Now it leaves them on the engine path — so the reading rule above is what keeps an opt-out
honoured on a platform whose shell has no `printenv`, and the orchestrator that owns the
branch, not this skill, is where that read belongs.

### Step 4: Freeze the graph before executing anything

Validate, then resolve, then write the resolved graph into `orchestrator-state.yml` as the
`workflow:` block with one line per node — before any node runs. A run executes the frozen
graph, never the file on disk, so an edit to a definition mid-run changes nothing until the
next run.

**The freeze patch must carry `workflow.name`** — the bare name, after the prefix strip. The
writer derives the run's per-workflow context block from it, so a later write to `context` or
`phase_summaries` with no name recorded is refused with `state-context-block-unknown` rather
than landing in some default block. The name is already part of the frozen key order, so
this costs nothing at freeze time and cannot be recovered later without re-installing the
block.

**The freeze patch carries `task.key` when the definition declares a tracker key.** An input
marked `tracker_key: true` says its value *is* the ticket the run was started from — a chain
started from ALPHA-42 declares `ticket: {type: string, required: true, tracker_key: true}` and
the operator supplies `ALPHA-42` at start. `resolve` reports the marked input's name as
`tracker_key` (null when no input carries the mark), so the freeze reads the name from the
resolved graph and writes that input's supplied value as `task.key` in the same `write-state`
call that installs the `workflow:` block. A run whose definition marks nothing writes nothing:
`task.key` stays absent rather than becoming an empty string or the workflow's name.

Why it belongs at the freeze and nowhere else: the tracker mirror adopts an existing ticket as
the run's parent when `task.key` is present, and creates a fresh epic when it is not. The
decision is made from the state the first time it is read, so a key written later is a key
written after a duplicate epic already exists. The validator holds the mark to one input and
to `type: string`, so the value the freeze reads is unambiguous.

If `validate` rejects the definition, stop with `RUN-FAILED:` carrying the validator's first
error. A definition that does not validate cannot be executed part-way.

### Step 5: Decline the resume flags the graph cannot express

An invocation may arrive carrying `--from=PHASE` or `--reset-attempts`, because the prose
orchestrators offer both. Neither has an expression here. Resume recomputes the ready set from
the frozen graph, so there is no mid-graph entry point to start from; and no attempt counter
lives in state, because budgets are node prose rather than data.

**Say so by name, before the first node runs.** Name the flag that arrived, state which of the
two facts above makes it inert, and name the route that still serves it — the workflow's prose
twin, reached by setting `MAISTER_WORKFLOW_PROSE` to any non-empty value before the workflow's
own command. Then continue with the flag dropped: an ordinary run, or an ordinary resume from
the frozen state.

**Describe that route as the twin actually behaves, which differs by workflow.** Some prose
orchestrators document a named entry point and honour `--from=PHASE` directly; others carry no
phase flag at all and re-enter by artifact presence instead — each step checks whether its own
output is already on disk and skips ahead when it is, so a plain re-run picks up near where the
last one stopped. Read the workflow's own resume signature before promising an operator either
one. Promising a phase jump to a twin that has none replaces one dead flag with another.

**Never accept one silently.** Dropping a flag without a word is the failure this step exists
to prevent — the operator asked to re-enter a run partway, watched it start somewhere else, and
was given no reason for it.

---

## The invocation contract

One script, five verbs, one exit-code table — `0` success, `1` the input was rejected
(the report is still printed), `2` an internal failure where nothing ran.

```
node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs <verb> [flags]
```

| Verb | Flags | Gives |
|---|---|---|
| `validate` | `--definition`, repeatable `--overlay` | `{ok, errors[], warnings[], resolved[]}` on stdout — `resolved` says where each target was found |
| `resolve` | `--definition`, `--overlay…`, `--profile` | the canonical graph, its `graph_hash`, and `tracker_key` — the input the freeze reads for `task.key`, or null |
| `diagram` | same, plus `--out` | deterministic Mermaid text; a gate box carries its question and its options as `id: effect` |
| `write-state` | `--state`, the patch as JSON on **stdin** | the changed paths, one per line |
| `gate-request` | `--state`, the request as JSON on **stdin** | the files written, one per line |

`gate-request` suspends a run at one gate, whole: it writes `gates/<node>.request.yml`, a
regenerated `gates/index.yml`, **and** the pending marker — `orchestrator.gate_pending` plus
the node's `status: suspended`, through the state writer, in that order. The marker is not a
second call, and it cannot be one: the enforcement hook reads a run as pending the moment an
unanswered request file sits beside its state, so a `write-state` issued after the request
file is a shell call against an already-pending run and is denied — and reversing the two
fails identically from the other side. Whichever write goes first suspends the run, so both
belong inside one invocation. Everything the verb needs is derived from `--state`: the
run directory, the `gates/` directory beside it, and the frozen graph the node id is checked
against, so a request for a node the graph does not carry is refused rather than written
somewhere nothing will look for it. Send `{node, kind, question, context?, options[], the
flag that says whether more than one option may be picked, run_id?}`; the verb supplies
`version`, `asked_at` and `answer: null` itself and **refuses a caller that sends any of the
three**, so a caller can neither pre-answer its own gate nor stamp a time it did not measure.
Its own four refusals are `gate-request-invalid` (fix the document and re-run),
`gate-request-exists` (a *different* gate has already been asked at that node — read the file
rather than re-asking), `gate-unwritable` and `gate-temp-exists` (handled exactly like
`state-unwritable` and `state-temp-exists` in the table below). Because the marker rides along,
the verb may also return any refusal `write-state` names, verbatim and with its own code; both
sets are closed and both are in the table below. The request document's shape is
`gate.schema.json`; the options it carries are the options the operator is offered.

**A refusal leaves the run unsuspended.** If anything after the request file refuses, the
request file this call published is removed and the index regenerated without it, so the run
is not pending, the shell is still available, and the same call can be re-issued. And a
re-issue that finds its own identical, still-unanswered request file — the shape a kill in
that window leaves — adopts it and finishes the marker rather than refusing, keeping the
gate askable. A file that is answered, or that spells a different question, still refuses.

The patch arrives on stdin so no quoting has to survive a shell — Windows without a POSIX
shell is a supported target. An unknown version degrades **the same way in every verb** —
`validate`, `resolve` and `diagram` alike short-circuit on it, render what they recognise,
warn, and still exit `0` — so a newer definition in a mixed fleet is a diagnostic rather
than a dead run, and never a document one verb accepts while another rejects it.

---

## Executing the graph

### The ready set

A node is ready when both hold:

1. **Every `needs` entry is satisfied.** `completed` and `skipped` satisfy; `failed` and
   `stopped` satisfy only for a node that declares `on: failure` or `on: always`.
2. **Its `when` guard evaluates true** against the values declared by completed nodes.

A node whose guard is false is marked `skipped`, and **a skip satisfies everything
downstream** — that is how a definition expresses an optional phase without any routing
construct.

**No node in the shipped built-in carries `on:`**, and that is precisely what makes a stop
option terminate a run: under the default, nothing downstream of a stopped node ever
becomes ready.

Execute ready nodes one at a time, in the order the frozen graph lists them. When nothing
is pending, set the task status and print `RUN-COMPLETE`.

### Delegation by scheme

The node's `uses` names both the mechanism and the target:

| Scheme | How it runs |
|---|---|
| `skill:<name>` | the Skill tool |
| `agent:<name>` | the Task tool |
| `direct:<name>` | inline, by this engine, following the node's section in the definition's prose companion |
| `workflow:<name>` | **stops the run** with a clear message — sub-run execution is out of scope; the validator resolves the target, nothing executes it |

**A `skill:` or `agent:` target is looked for in the project, then in this plugin, then in
every installed plugin — first hit wins.** The project is the directory the host declares
as the project, else the one the verb runs in; both hosts' layouts are searched there
(`.claude/skills/<name>/SKILL.md` or `.github/skills/<name>/SKILL.md`, and the agent
files beside them, in either spelling). A target may name the plugin it means with one
colon — `skill:acme-tools:review` — and is then looked for only in that plugin, this one
included by its own name. `validate` reports where each target was found in its `resolved`
list: the node, the target as written, the place (`project`, `plugin` or `installed`) and
the file.

**A target found nowhere warns; it no longer errors.** Like a `workflow:` target, it may
be provided by an environment `validate` cannot see — a plugin installed later, a project
the file is not being validated in — so `validate` accepts the document and reports
`unresolved-reference:<node>:<target>`. The cost is that a mistyped name surfaces when the
node is reached rather than at validation time. Only `direct:` stays an error, because its
implementation is the section beside the definition in hand.

**The relaxation stops at a node carrying `dir:`.** Such a node hands its work to a member
repository, and the workspace validator errors on one whose target it cannot read — the
runtime that builds the worker's envelope reads the same file, so a target invisible here is
a dispatch that refuses there rather than a reference some environment may still supply.

**Target names in a definition are bare, and the provider prefix is applied at invocation.**
Resolution is rooted at the plugin root, so one shipped definition is correct under every
generated variant with no rewrite pass. A prefix written into a definition file breaks the
other variant and is a defect, not a style choice.

A `direct:` node's prose is the node's body: its steps, its fan-outs, its self-checks, the
questions it asks inline, and how many times it may be re-driven. Read the section before
executing the node, not after it fails.

### Recording an outcome

Every node's outcome maps onto a status deterministically, because a downstream `needs`
treats `failed` and `skipped` differently. The mapping is the same for all three executable
schemes:

| Outcome | Status | Downstream |
|---|---|---|
| Completed, self-check passes | `completed` | satisfies `needs` |
| Self-check failed, the re-drive succeeded | `completed` | satisfies `needs` |
| Budget exhausted, the operator chose to retry, and it then succeeded | `completed` | satisfies `needs` |
| Budget exhausted, the operator chose to skip | `skipped` | satisfies `needs`; declared boolean outputs default false, declared string outputs to null |
| Hard failure with no operator path | `failed` | satisfies nothing by default; the run stops with `RUN-FAILED` |

**A node that did not produce its declared artifacts has not completed.** Before recording
a node `completed`, check that every path the node declares under `outputs.artifacts` exists
— one `test -e` per declared path, against the path resolved from the task directory. A
declared artifact that is missing is one of exactly two things, and the node prose is what
tells them apart:

| The node prose | The missing path means |
|---|---|
| sanctions the absence by name — the artifact's source may legitimately not exist | no such context; record `completed` and say in the summary which declared path was absent and why |
| says nothing about it, or says the file is written either way | the delegate skipped work it was asked to do; the node has **not** completed |

Treat the second as a failed self-check and re-drive the node within its budget, naming the
missing path in the context handed back. When the budget is exhausted, the node's outcome
follows the table above rather than being recorded green with a hole in it.

The check costs one existence test per declared path and needs nothing the engine does not
already hold: the definition declares every artifact, so the list is free. Without it, a
delegate that returns successfully having written nothing is indistinguishable from one that
wrote everything, and the absence surfaces only when a later node reads the path — or when a
human compares two lists by hand.

**A phase key is never a node id.** `node_summaries` is keyed by node id, and the workflow's
own `phase_summaries` map is keyed by the workflow's phase keys. The node prose names the
key each mirroring node writes under; a node whose prose names none writes a node summary
and nothing else. Reading a phase key off the node id is the mirroring defect to watch for,
because the write succeeds and the run keeps going with a key nothing else reads.

A node's summary carries the shorter phase-status vocabulary, so the node status is mapped
rather than copied: `running` becomes `in_progress`, and the other four map to themselves.
`suspended` occurs only on a node the run is suspended at while its gate awaits an answer,
which is a driver-suspended mode only — in terminal mode the answer arrives in the same turn
and the node goes straight to `completed`. `stopped` occurs only on nodes a stop option left
unexecuted, and those carry no summary at all.

**Retry budgets are prose, never `with:` data.** `with:` is an unconstrained free-form
object handed to the node; a budget written there would read like a grammar feature while
being inert data nothing consults. Budgets live in the node prose, and the engine follows
them from there.

---

## Gates

A gate node is a question with a closed set of options, exactly one of which continues the
run. What the engine does with it follows the run's driver, and nothing else:

| `orchestrator.driver.kind` | The gate is |
|---|---|
| absent, or `terminal` | asked in session and answered in the same turn |
| `cockpit`, `dispatch` | written to a request file; the run suspends and a later turn answers it |

Decide which of the two applies once, when the run starts, from the driver block the state
file already carries. A gate never changes mode partway through a run.

### Terminal mode — asked and answered in one turn

1. **Asks it in session** with `ask_user`, carrying the node's own question text and
   its own options.
2. **Records the answer** — the chosen option id, who answered and when — on the node's
   summary, and marks the node `completed`.
3. **Writes no `gate_pending` and no gate request file.** The pending marker is only ever
   written as the one-line null form.

Terminal mode is exactly this and nothing more: no request file is written, no
`GATE-PENDING` line is printed, and `gate_pending` never holds anything but the literal
`null`. A request file without a marker would be a gate nothing enforces, which is worse
than no gate at all.

**Why nothing is marked pending.** A pending gate is what the enforcement hook reads to
deny writes while an answer is awaited, and it cannot see inside a shell invocation — so a
pending marker would deny the engine's own call to its state writer and leave editor-tool
writes as the only way forward. That is exactly the corruption path the writer exists to
remove. Asking and answering inside one turn means nothing is ever awaited across turns,
so nothing needs marking.

**The cross-run deadlock: a pending gate in another run still stops this one.** Never
marking pending solves the within-run case only. The enforcement hook cannot see inside a
shell invocation, so it treats the engine's call to its own state writer as opaque and scans
**every run under
`.maister/` project-wide** before allowing it. One abandoned run holding a pending gate —
in a different task directory, from a different workflow, possibly weeks old — therefore
denies a healthy run's writes, and the refusal names the stale run rather than anything
this run did wrong.

The operator's recovery is to clear the stale gate, in one of two ways: **answer** it, by
resuming that run and taking its gate to a decision, or **remove** it, by deleting the
abandoned task directory — or its gate request file and the pending marker in its state —
once it is genuinely dead. Do neither on the operator's behalf: another run's state is not
this run's to edit, and a deleted directory is not recoverable. Report the offending path
and let the operator choose.

**All of the above is mode-scoped.** It holds because the engine asks in session, where
nothing is ever awaited across turns. A driver-suspended run *does* write the request file
and *does* mark the gate pending — the reasoning above is the reason terminal mode does not,
never a reason no mode may.

### Driver-suspended mode — the write order

With `driver.kind` `cockpit` or `dispatch` the engine does not ask. It suspends, in this
order, and the order is the contract:

1. **Every dispatch envelope, ledger and outbox write for the current ready set completes
   first** — before the request file exists and before the pending marker is set.
2. `workflow.mjs gate-request --state=<state>` writes `gates/<node>.request.yml` through a
   temp file and a rename, regenerates `gates/index.yml`, and then sets
   `orchestrator.gate_pending` to `{node, request, since}` **and** the node's `status` to
   `suspended` through the state writer — one invocation, three writes, in that order. The
   request document arrives on stdin as JSON: the node id, the kind, the question, its options
   and the multi-choice flag (`gate.schema.json` declares the shape). `since` is the request's
   own `asked_at`, so the marker and the file agree about when the operator was asked.
   **There is no second call here, and there must not be**: the run is pending from the moment
   the request file lands, and a shell call against a pending run is denied.
3. `dashboard-data.js` is rewritten to show the gate card — by the same prose that rewrites
   it after any other phase, because there is no dashboard verb and the dashboard is a
   whole-file rewrite rather than a state edit.
4. `GATE-PENDING: <node>` is printed as the **last** line of the turn.
5. The turn ends. Nothing polls, nothing waits, no session is left idle.

**Step 1 is the whole mechanism.** The enforcement hook allows a small list of paths while a
gate is pending and denies everything else, and that list is fixed. Holding step 1 means
nothing in the run ever needs to be written after step 2, so nothing ever needs allowing:
the writes that would have been denied already happened. The same reasoning is why step 2 is
one call — a run is pending from its first write, and its second write would need allowing. A write belonging to a
*different* run is denied whatever the list says — the hook builds it from the pending run,
not from the run doing the writing — and that cross-run behaviour is the deadlock described
above, with the operator recovery given there. This is why suspending a run required no
change to the hook's allow-list, its deny reason or its decision logic.

The run is suspended the moment step 2's marker publishes. **The commit point is
`gate_pending` back to `null`, and that is written on resume, not here.**

### Driver-suspended mode — resume

A resume always arrives as a first line in one of four shapes — `GATE-ANSWER`, `RE-DRIVE`,
`STEER` or `RESUME` — and **all four end with `at=<timestamp>`**. That stamp is the turn's
measured time and it is the only one the engine has: nothing in a resumed turn may read a
clock of its own or reuse a time from an earlier turn. Record it exactly as a `GATE-ANSWER`
stamp is recorded — as the `at` of the decision the turn writes, and as the `started` of any
node the turn begins — on a re-drive and a steer no less than on an answer. A first line with
no `at=` is below the contract: print `RUN-FAILED: prompt-line-unstamped`, write nothing, and
leave the run where it was. Inventing a time there is what puts a midnight timestamp into a
run's permanent record, and a fabricated stamp is worse than a refused turn.

Under a pending gate the whole tool surface is denied, the shell included, so the state
writer is unreachable and the decision is recorded with editor tools on the allow-listed
files only. This is the one sanctioned exception to "never edit state with an editor tool",
and it is narrow: it lasts exactly until the marker is null, and it ends with an immediate
re-validation through the writer.

1. Read the request file and the state with read-only tools; those are answered before any
   state is read.
2. Validate the answer against the request's own option ids. Not one of them → print
   `GATE-INVALID: <reason>`, write nothing, stay suspended.
3. `gate_pending` already `null` → print `GATE-ALREADY-ANSWERED`, write nothing. A gate is
   answered once.
4. Otherwise record, **in this order**: the `answer:` block in `gates/<node>.request.yml`,
   then `node_summaries.<node>` and the node's `status: completed`, then
   **`gate_pending: null` last**. The order matters because the marker is what the hook
   reads: clearing it first would open the tool surface before the decision was recorded.
5. The instant the marker is null the gate is no longer pending, so the very next action is
   `echo '{}' | node .../workflow.mjs write-state --state=<state>` — the empty patch. It is
   not a no-op: the writer reads the file the editor tools just wrote, self-checks it through
   the enforcement hook's own reader, and re-publishes it. The file changes by one line
   (`orchestrator.updated`), and that is the expected result. This is what keeps the editor-
   tool exception honest — model-authored state is accepted only after the writer has read
   it back and agreed.
6. Rewrite `dashboard-data.js` to clear the gate card, by the same means as the suspend
   path's step 3.
7. A refusal at step 5 is `RUN-FAILED: <code>`, reported verbatim, and the run is handed to
   the workflow's prose orchestrator. **Never repair the state file to get past it** — a
   refusal there means the recorded decision did not survive the reader, and editing further
   with the same tools that produced it compounds the drift instead of clearing it.

Unchanged in both modes: the enforcement hook itself, default-deny for a tool name it does
not recognise, and fail-closed on any error while deciding.

### Choosing a stop option

A stop option ends the run, and ends it completely:

- `task.status` becomes `stopped`;
- **every unexecuted node is recorded `stopped`**, the final node included;
- no further node executes, and no completion or summary node gets a courtesy run.

A stopped run is a legitimate outcome, not a failure. Do not print `RUN-FAILED` for one, and
never re-ask a gate the operator has already answered.

---

## Writing state

**Every state change goes through `write-state`. Never edit `orchestrator-state.yml` with an
editor tool** — not to fix a stray line, not to record one small field, not when a write has
just been refused. There is exactly one exception, and it is not a fallback: answering a
pending gate, where the shell is denied and the writer is therefore unreachable, records the
decision with editor tools and then hands the file straight back to the writer for
re-validation (see *Driver-suspended mode — resume*). Outside that window, an editor-tool
write is the corruption this writer exists to prevent. The writer owns the `workflow:` block and its one-line node entries, the
per-node summaries and their mirrored phase summaries, and the scalars beside them; it emits
at a fixed canonical indent, writes the whole file once per invocation, and self-checks the
candidate through the enforcement hook's own reader before it publishes anything.

The patch vocabulary is closed, and it is exactly the set of state blocks a run has to be
able to write:

- `orchestrator` and `task` — the two required core blocks. Scalars replace, and so does
  `orchestrator.driver`, which is one contract-shaped value written whole. The four **open
  maps** under `orchestrator:` — `options`, `task_ids`, `auto_fix_attempts`, `skipped_phases`
  — merge key by key instead, because different nodes write different keys of them at
  different times: a write recording `spec_audit_enabled` leaves an `html_output` an earlier
  node set alone. Send the whole map only when you mean to add to it.
- `workflow` and `nodes` — the workflow block installed whole, and its one-line node entries
  edited in place afterwards.
- `context` and `phase_summaries` — written into whichever per-workflow context block the
  run's name resolves to (`task_context` for development, `research_context` for research,
  and so on); `node_summaries` is its own top-level block, keyed by node id.
- `project_context`, `related_tasks`, `verification_context`, `external_research` — the four
  optional top-level blocks. Each is written as a **top-level sibling** of `orchestrator:`
  and of the context block, never nested inside either. A mapping is merged key by key, so
  one write recording `verification_context.fixes_applied` leaves a `reverify_count` another
  write put there alone; `related_tasks` is a list and is replaced whole, so a caller that
  means to append sends the whole list.

Anything else is an error rather than a silent no-op. The set is pinned against the state
contract by the repository's own suite: a block the contract defines that the writer cannot
reach is a test failure, not something to work around with an editor tool.

### When a write is refused

Exit `1` means **nothing was published** — no rename happened and the file on disk is
byte-for-byte what it was. The first token on stderr is the refusal code. There are fifteen,
and they fall into four responses. Exit `2` carries no code at all and is the table's last
row:

| Refusal | Response |
|---|---|
| `state-non-canonical` | The existing file cannot be re-indented safely. Stop with `RUN-FAILED: state-non-canonical` and hand the run to the prose orchestrator. |
| `state-unreadable`, `state-unwritable`, `state-incomplete`, `state-candidate-unsound` | The directory is not one the engine can own — unreadable, unwritable, a candidate the reader would not accept, or a candidate carrying a duplicate top-level key or one that neither the pre-write file nor the patch introduced. Stop with `RUN-FAILED: <code>` and hand the run to the prose orchestrator. **Never re-send the same patch**: the candidate is unsound for a reason the patch cannot change. |
| `value-not-flow-safe` | A declared output cannot go on a one-line entry. Record the node `failed` with that reason and stop with `RUN-FAILED: value-not-flow-safe`. |
| `state-entry-unserializable` | A node entry **already in the file** cannot be re-serialised. The patch is fine; the file needs repair. Stop with `RUN-FAILED: state-entry-unserializable` and report the message verbatim. This is **not** the `value-not-flow-safe` recovery — shortening the value the patch carries changes nothing here, and trying it loops. |
| `state-temp-exists` | The temp twin is on disk and less than a minute old, so another writer holds it — a write takes milliseconds. Nothing was written. **Do not delete anything**: wait a minute and issue the same write again. A temp older than a minute is a crashed writer's leftover, and the next write reclaims it itself. |
| `state-gate-pending-form` | The pending-gate marker has two legal spellings and this was neither. It is written as the literal `null`, or as `{node, request, since}` — `request` being `gates/<node>.request.yml` for that same `node`, and `since` a measured UTC timestamp — which the writer puts on one line itself. Send the marker as an object, never as pre-spelled text: text carrying a trailing comment or a quote reaches the file with its own bytes and the reader throws on it. Stop with `RUN-FAILED: state-gate-pending-form` and report the message verbatim. |
| `state-patch-invalid`, `state-patch-unknown-key`, `state-inline-collection`, `state-workflow-without-nodes`, `state-workflow-without-task`, `state-context-block-unknown` | The engine built a patch the writer will not apply. Stop with `RUN-FAILED: <code>` and report the writer's message verbatim. |
| exit `2`, any message | The writer itself did not run — a module it imports is missing, the patch on stdin was not JSON, or the verb and its flags were malformed. Nothing was published and nothing was even attempted. Stop with `RUN-FAILED: writer-unavailable`, report the message verbatim, and hand the run to the workflow's prose orchestrator. |

Exit `2` is the one row that is not a refusal at all, which is why it is easy to mishandle:
there is no code to look up and no patch to correct, so the tempting next step is to record
the state change with an editor tool instead. **Do not.** A writer that could not start is
exactly the case the no-fallback rule in Step 2 was written for; an editor-tool write here
produces the drifted state file that denies every later write in the session.

`state-patch-invalid` is the broadest of the caller-defect codes, and it now also refuses a
block-path map key that is not a plain identifier rather than emitting it — the shape that
corrupted state files before the guard existed. A key that arrives from a name rather than
from a literal is the one to watch.

The last group is a defect in the caller, so it is worth naming what a defect looks like: a
`workflow:` block sent without its nodes, a pending marker sent as a block map, a node
summary sent as an inline collection, a patch key outside the closed vocabulary, a context
write sent before the workflow has a name. Fix the patch and re-run; **re-sending the same
patch, or reaching for an editor tool because the script said no, is the failure mode this
whole design removes.** A refusal is a correct answer, not an obstacle.

---

## Resume

Read `orchestrator-state.yml`, take the frozen graph from its `workflow:` block, recompute
the ready set from the recorded node statuses, and continue. Resume never re-resolves the
definition: the graph that ran is the graph that resumes.

**A resume declines the same two flags a first run does.** Step 5's rule is not scoped to a
fresh run: `--from=PHASE` and `--reset-attempts` are resume flags, so a resume is where they
usually arrive, and it is where the decline matters most. Resume skips Step 3 and Step 4 — the
graph is already frozen — but never Step 5. Name the flag, say which fact makes it inert, name
the route, and continue.

**A task directory with no `workflow:` block is not engine-resumable.** It carries no frozen
graph, so hand it to the workflow's prose orchestrator — which is exactly why that
orchestrator is kept rather than deleted. Step-level resume *inside* a node is that node's
prose, not the engine's business.

**The prose twin is transitional.** A workflow that exists both as a definition and as a
prose orchestrator keeps the prose copy only while the engine is proving itself: it is the
escape hatch during rollout, and it is retired once the engine is proven, at which point a
working script runtime becomes a hard requirement. Build nothing that assumes a permanent
second implementation. The reasoning is recorded in the repository's decision log.

---

## Operator visibility

The engine honours the framework's contracts; it does not restate them. Follow
`../orchestrator-framework/references/orchestrator-patterns.md` for:

- the **artifact summary contract** (§ 7) in every prompt that asks a delegate to write an
  artifact, with the returned summary lifted into state verbatim rather than re-summarized;
- the **operator dashboard** (§ 8) — the config gate that turns it off, the copied asset,
  and the rewrite points: node start, before every gate, node completion including a skip,
  every gate decision, and finalization;
- the **HTML companions** (§ 9) and the style guide path passed to artifact-writing
  delegates, following `html-report-style.md`.

The run's last line is a marker, read by tooling: `RUN-COMPLETE`, or `RUN-FAILED: <reason>`.
The vocabulary and the rule that on-disk state outranks a marker live in
`../orchestrator-framework/references/compatibility-contracts.md` § 13.

---

## When to use

**Use** when a workflow ships a definition and its orchestrator hands the run over.

**Do not use** to run an arbitrary definition file on request, to author an eject or an
overlay, to execute a `workflow:` sub-run node, or as a workflow a user starts directly.
Each of those is either another skill's job or out of scope, and none of them is reachable
by improvising here.
