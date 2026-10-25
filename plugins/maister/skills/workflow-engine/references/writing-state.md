# Writing state

The workflow engine's rules for writing a run's state. A refused `write-state` names
*When a write is refused*, and a refused `run-complete` names *When `run-complete` refuses*.

**Every state change goes through `write-state`. Never edit `orchestrator-state.yml` with an
editor tool** — not to fix a stray line, not to record one small field, not when a write has
just been refused. The one exception is answering a pending gate, which records the decision
with editor tools and hands the file straight back to the writer for re-validation
(`references/gates.md` § *Driver-suspended mode — resume*). The writer emits at a fixed
canonical indent, writes the whole file once per invocation, and self-checks the candidate
before it publishes anything.

The patch vocabulary is closed, and it is exactly the set of state blocks a run has to be
able to write:

- `orchestrator` and `task` — the two required core blocks. Scalars replace, and so does
  `orchestrator.driver`, which is one contract-shaped value written whole — a dispatched run's
  is `{kind: cockpit, cwd, dispatch_id}`, the dispatch it runs, which the writer keeps; the engine
  reads the id only to know the run is dispatched (engine skill, *A dispatched run is told by its
  `dispatch_id`*), and a legacy `{kind: dispatch, …}` reads as a dispatched run with or without
  one. `cwd` is absolute and records the directory the run
  was started in, which a driver needs to start a session there again; nothing reads it to find
  the run. A run is located by its state file, four levels below its checkout under one of two
  roots — `<checkout>/.maister/tasks/<type>/<date-name>`, or
  `<checkout>/.maister/umbrella/runs/<run-id>` for the run that drives a chain — so a run moved
  to another machine is found where it now is; `resume-check` prints that checkout as `root`. A
  folder named `<run>.moved-<digits>` (the copy a machine kept after the run moved) or
  `<run>.failed-<digits>` (a rolled-back copy) is not a run: no listing names it and
  `resume-check` refuses it. The four **open
  maps** under `orchestrator:` — `options`, `task_ids`, `auto_fix_attempts`, `skipped_phases`
  — merge key by key instead: a write recording `user_docs_enabled` leaves an `html_output` an
  earlier node set alone. `task.status` is the writer's at one moment: the first write that
  moves a node off `pending` records `in_progress` when the status is absent or `pending`; a
  status already set otherwise, or one the same patch sends, is left alone, and the run's
  ending is the closing patch's to record.
- `workflow` and `nodes` — the workflow block installed whole, and its one-line node entries
  edited in place afterwards. Never send a node's `started` or `completed`, or
  `orchestrator.updated`: the writer stamps all three from its own clock on each status change
  and drops, with a `note:` line on stderr, any value a patch carries for them.
- `context` — written into the run's context block, whose name the
  writer derives from `workflow.name`: `<name>_context`, the name's dashes written as
  underscores, so `acme-review` writes `acme_review_context`. Two built-ins keep older blocks:
  `development` writes `task_context` and `product-design` writes `design_context`. A workflow
  named `project` or `verification` would derive one of the shared blocks below, so its context
  writes are refused with `state-context-block-unknown`. `node_summaries` is its own top-level
  block, keyed by node id.
  A step's summary goes on `node_summaries` alone. `phase_summaries`, the retired phase-summary
  mirror, is dropped with one `note:` line, sent top-level or nested under `context`, whose
  other keys each replace whole; an older run's copy is never read, and `resume-check` and
  `prior-context` each announce one holding a decision or a risk with one
  `warning: legacy-mirror-ignored:` line. `node_summaries` merges entry by entry, and
  **each node summary merges field by field**: a field you send replaces that field whole, and
  a field you leave out keeps its value. So a later node retagging one earlier risk `resolved`
  sends only that node's `risks`, and its summary, artifacts and answers stay. Send a field as
  `null` to clear it. **The user's answers are history**: a write of a node's `decisions` keeps every
  earlier `by: operator` item it leaves out, unless it carries the same `question_id`, question
  and `attempt` (none is the first) — a question asked again replaces its own answer. That holds
  across a revise, so a node that re-runs records only what it settled this time; a question set
  a driver asks again in the node's new attempt keeps the earlier attempt's answers as history
  (`references/in-node-questions.md` § *In-node questions*). **Under a `cockpit` or `dispatch`
  driver, a person answers only through a recorded answer**: an operator-shaped item the node
  sends with no name, `via` or `actor` is recorded `by: run`, unless the writer folded it from an
  answer block, already holds it as an answer, or it carries `on_behalf_of`. An answer given in a
  dispatched run's session is stamped `via: dispatch` on either driver form, one under a cockpit
  driving its run directly `via: cockpit`. An answer's `actor` is `{kind, id}`, recorded as sent;
  its `kind` is the actor's role — `person`, or `coordinator` for the cockpit's coordinator
  answering on a person's behalf (`references/gates.md` § *Provenance*).
- `project_context`, `related_tasks`, `verification_context`, `external_research` — the four
  optional top-level blocks, each a **top-level sibling** of `orchestrator:` and of the context
  block. A mapping is merged key by key; `related_tasks` is a list and is replaced whole, so a
  caller that means to append sends the whole list.

Anything else is an error rather than a silent no-op.

**The writer judges a gate's triage itself**, on the write that records its answer and on the
re-validation of a driven answer (`references/gates.md`). These `warning:` lines on stderr are
never refusals — the write lands and the exit code does not move:
- **`policy-hash-mismatch:<gate>`** — the policy loaded now would classify the gate, but its hash
  is not the run's `policy_hash`, or the run recorded none. Nothing is classified; relay it. A
  classing write warns it naming the node, and every question is printed under `ask:`.
- **`held-gate-skipped:<gate>`** — the write recorded `skipped` on a gate the held rule asks while
  choices wait for approval (engine § *The ready set*). The status was written as sent: ask the gate, and its
  continue approves the held choices.
- **`autonomy-ceiling-parent-unread:<run>`** — a child run's freeze could not read its parent's
  state, so it copied no autonomy ceiling from it. Relay it.
- **`driver-features-parent-unread:<run>`** — the same, for the driver's features: in-node
  questions take their defaults. Relay it.
- **`skip-guard-skipped:<gate>`** — the write recorded `skipped` on a gate the skip-guard rule
  asks whatever its guard reads (grammar § 7). The status was written as sent: ask the gate and
  record its answer.
- **`provenance-unusable:<node>:<key>`** — an answer's provenance value holds a map key the state
  file cannot carry, so it was left off the decision; relay it, naming the request file it gives.

A `note:` line says the write dropped something the patch sent and landed without it. Beside the
clock fields, `policy_hash` and `task.base_commit`, the writer drops, each with its note: an
`orchestrator.options.ceiling` wider than the run's autonomy ceiling, or one removing it (engine Step 4);
`orchestrator.classes_questions` and a node's `asking`, which only the writer records; a
`phase_summaries`, the retired phase-summary mirror, top-level or under `context`; a `workflow`
block re-sent identical to the frozen one; and, in a run that records `classes_questions`, a
`by: run` or `by: default` item sent for a question the writer classed, and any `triage` sent on
a node's decisions. Two more are corrected rather than dropped, each with its note: a `headline`
that spans lines or runs past 220 characters is folded onto one line and cut at the last
sentence that fits, and the run's own context block sent as a top-level key (`task_context` in a
development run) is written as `context`. Correct the prose that sent it rather than re-sending.

## What the freeze write adds

The freeze patch carries what engine Step 4 lists; the writer checks it and adds the rest.

**The writer proves the freeze before it installs it.** It re-resolves the recorded `source`,
`overlays` and `profile` from the run's own project root, and writes nothing when the result
disagrees with the patch — the hash, the name, the node set, or a required input with no value.
Each refusal has its row under *When a write is refused*.

**It seeds what every run carries**, each only when the patch does not supply it and the file
does not already hold it: `orchestrator.completed_phases: []` and `orchestrator.failed_phases: []`
at the top of the block, `orchestrator.task_ids: {}`, and `orchestrator.created` from its own
clock — a child run's freeze included.

**The phase fields are the writer's.** On every write of a frozen run it derives
`orchestrator.completed_phases`, `failed_phases` and `started_phase` from `workflow.nodes`: the
non-gate nodes recorded `completed`, and those recorded `failed`, in frozen order; and the first
non-gate node under way, else the one started last, else null. A value a patch sends for any of
them is dropped with one `note:` line; never send them.

**It records `orchestrator.policy_hash`** — which autonomy policy the run applies. The policy is
an optional file, `policy/autonomy-policy.json` in this skill's folder; none ships, and without
one the built-in `{"version": 1}` applies, which classifies nothing. The hash is `sha256:` over
the whole parsed file, its keys sorted at every depth, arrays kept in order, no whitespace. A
file that exists but cannot be applied is refused whole: the run applies the built-in default,
records that hash, and the freeze prints `warning: policy-refused:<path>:<reason>`, with
` at <dotted path>` for a shape fault. Relay the warning; the run goes on. A value a patch sends
is ignored with a `note:` line, a sub-run's freeze records its own, and no later write changes it.

**It records `task.base_commit`** — where the run starts: `{sha, dirty}`, HEAD at the freeze and
the paths already modified, staged or untracked then, the project's `.maister/` left out.
`review-brief` measures every verification cycle from it. A project outside git records none and
says nothing; a repository with no commit yet records none and prints
`warning: base-commit-unrecorded`, and a status it cannot read keeps the base with no dirty paths
and prints `warning: base-dirty-unread`. A value a patch sends is ignored with a `note:` line, a
sub-run's freeze records its own, and no later write changes it.

**It records `orchestrator.options.delegation`** — whether the run's subagents can dispatch
subagents of their own: `{mode, depth, source}`, from the host the freeze's `--host` names.
`depth` is how many levels of subagents the host allows below the main session: on `claude` the
value of `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` when it is a whole number, else 3; on `copilot`
4. `mode` is `nested` at a depth of 2 or more and `inline` below it, and `source` says where the
depth came from. On `copilot` the mode is always `inline`, with a one-line `reason`: Copilot runs
every subagent level under a session of its own, so the runners keep their loops in the main
session there, and `runner-step` reads a run frozen `nested` on Copilot as `inline` too. A
`cockpit` or `dispatch` driver follows the same rule, with a `source` naming
the SDK release nesting was checked under. A terminal freeze naming no host
records nothing, which reads as `inline`. The mode shows on the status line while the review step
runs, and on that step's dashboard card. A value a patch sends is ignored with a `note:` line, a
sub-run's freeze records its own, and no later write widens it. After the freeze a run recorded
`nested` may narrow to `inline`, once its verification runner finds it cannot dispatch
subagents: the patch is exactly `{mode: inline, reason}`, the reason one line, and it lands as the
recorded map with the mode and the reason replaced, the depth and the source kept. Any other
value is ignored with the same note.

**Who writes a run's state.** Only two kinds of caller run the verbs that change a run's files
(`write-state`, `runner-result`, `findings-merge`, `wave-start` and `group-done` among them): the session that drives the run, and — where the run records
`mode: nested` — the runner subagents that session dispatched. Every other agent only reads the
run. Which session a call comes from is a field of the hook payload, named differently by each
CLI. On Claude Code it is `session_id`, and a subagent's calls carry its main session's
`session_id` at every depth. On Copilot CLI it is camelCase `sessionId`: in the main session it
is the session's id, and in a subagent it is that subagent's own id, so every subagent level
carries one of its own — and no Copilot subagent runs a state-writing verb, because no Copilot run
nests. A host-side guard that binds a run to its driver's session
(`orchestrator.driver.session.id`) can therefore hold any state-writing call aimed at that run
whose payload session id — `session_id` on Claude Code, `sessionId` on Copilot CLI — differs from
it. The guard reads the id from the hook payload, never from the tool call's arguments or the
state file, which any caller can copy.

**It records `orchestrator.classes_questions: true` when the policy classes in-node questions**
for this workflow, and nothing otherwise. The key is the writer's too, dropped with a `note:`
line when a patch sends it. It is the one fact a node reads before it asks
(`references/in-node-questions.md` § *When the policy classes a question*).

**It records the run's autonomy ceiling** as `orchestrator.options.ceiling` when the patch
carries one: `approve` < `advice` < `decide`, an unknown value reading as `approve`. A child
run's freeze records the narrower of its parent's effective ceiling and its own (engine
§ *Sub-runs*). After the freeze it may narrow, never widen: a later write naming a wider level,
or removing a recorded one, is dropped with a `note:` line, and the rest of the patch lands.

**It installs the dashboard viewer.** When `html_output` is not false and the run directory
holds no `dashboard.html`, the freeze copies the plugin's viewer there and reports it among the
changed paths. It never replaces a file already there, and a copy that fails is a warning.

## Recording an outcome — the detail

The engine skill's *Recording an outcome* holds what a node records; here is what the writer
checks.

**A node is recorded only with one of eight statuses, and only if the run froze it.** The
statuses are `pending`, `running`, `waiting`, `suspended`, `completed`, `skipped`, `failed` and
`stopped`. Any other status is refused with `state-node-status-unknown`, including the summary
spelling `in_progress`, and a node the frozen graph does not carry is refused with
`state-node-unknown`.

**A node's values are held to the outputs it declares.** Each declared type has one form:
- `bool`: `true` or `false`;
- `string` or `id`: a string;
- `enum`: one of its members.

A skipped node records its declared strings and enums as null. Any other value for a declared
key is refused with `state-value-invalid`: a guard reading `"false"` finds no bool at all. A key
the node does not declare is still written, and a `warning:` line names it; it belongs in the
node's `outputs` or should not be sent. A `workflow:` node's `task_path` and `run_id` are
exempt: the node records those two about its child itself. This check and the gate-answer check
(`references/gates.md` § *Terminal mode*) read the definition, so they apply only while the
frozen block still resolves to its recorded hash.

**Artifacts are never copied into a node's values**; only declared *values* are. A declared path
resolves against the task directory of the run that wrote it (engine § *Recording an outcome*),
and is literal: `validate` refuses a `${…}` inside it.

**An `absent` entry is what the tools read**, since none of them can read prose: `run-complete`
prints no `missing-artifact:` line for it, and the dashboard shows the artifact as *not
produced* with the reason. The writer refuses an entry that names an artifact the node does not
declare or gives no reason (`state-absent-invalid`). `run-complete`'s own comparison over every
completed node only reports; the completing check, which can read the prose, is where the
judgement belongs.

**A `delegated` list is what holds a `direct:` step to its delegates.** A step whose `brief:`
declares `delegates` lists, under `delegated`, each agent of the run's host's set it dispatched — in the closing write or
an earlier milestone write of the same step — and the writer refuses its completion while one is
missing (`state-delegates-unrecorded`). A delegate's work done in the session is not a dispatch:
dispatch the agent, then list it.

A node's summary carries the shorter phase-status vocabulary, so the node status is mapped
rather than copied. `pending`, `completed`, `skipped` and `failed` map to themselves; `running`
and `waiting` both become `in_progress`; and **`stopped` maps to `skipped`** — the member that
says *did not produce its outcome, and not because anything broke*. `suspended` has no mirror.
A node a stop option left unexecuted carries no summary, because it never ran.

**A completing node summary is checked against what the node declared.** When a
`node_summaries` entry is written for a node whose status is `completed`, the writer appends
every artifact path the definition declares for that node which exists, as a file or as a
directory, and which the entry does not already list. It also fills a missing `html` on each
listed markdown file whose sibling `.html` companion exists, unless `html_output` is off; a
directory gets none. For a `workflow:` node the paths are looked for under the child's task
directory, named by the node's recorded `values.task_path`, and registered as
`../../<type>/<run>/<path>`, relative to the parent's run directory; one that recorded no
`task_path` registers nothing. The writer adds only what is on disk and overwrites nothing the
entry states.

## One write per moment

**A patch may carry every block at once, and a moment that changes several things is one
write, not one write per thing.** The writer applies every key present in a single pass, and
`nodes` and `node_summaries` merge entry by entry, so any
number of entries ride in one patch. There are four moments:

- **A node starts.** One patch: the node's `status: running`, and the `orchestrator` scalars
  the start moves. For a ready `agent:`, `skill:` or `direct:` step, `node-brief` makes this write
  itself and says so on its `started:` line; then there is nothing left to send.
- **A node ends.** One patch: the node's status, its `node_summaries` entry and the `orchestrator`
  scalars the outcome moves. The writer mirrors the node's status onto its summary whichever
  arrives first; a summary written with its own `status` keeps it until the node's status
  next changes.
- **A ready-set walk skips nodes.** Every node a false guard skips goes in one patch, with
  their summaries, however many there are. That patch lands no later than the next
  executed node's `running` patch — either earlier, or as part of that same patch — so no
  node is ever recorded as started while a node the walk already passed still reads
  `pending`.
- **A run ends.** The closing node's outcome and `task.status` are one patch; a stop option is
  likewise one patch carrying `task.status: stopped` and every unexecuted node. `run-complete`
  follows it and publishes nothing, so it is not a write and never merges with one.

That leaves two writes around a node, one before the delegation and one after.

**A node's prose may name milestones inside it**, where a long node registers what it has
produced so far. Each milestone is one write carrying the node's summary entries and whatever
else that moment moves, and never the node's status, which only the node's own end writes.

**Three writes stand alone:**

| The write | Why it cannot join anything |
|---|---|
| the freeze | it precedes node 1, and is already the merged write engine Step 4 lists |
| `gate-request` | one invocation, three writes, in the order `references/gates.md` § *Driver-suspended mode — the write order* fixes — a run is pending from the moment its request file lands, so a second shell call against it cannot run |
| the re-validation write on gate resume (patch `{}`) | the shell becomes reachable only the instant `gate_pending` goes null, which is what that write re-validates (`references/gates.md` § *Driver-suspended mode — resume*) |

**A sub-run start never merges**: W1 and W3 land in the parent's state and W2 in the child's,
and "one write per moment" is per state file. **W2 is one call and must stay one call**: a state
carrying a `workflow:` block but no `nodes` and no `task` reads as gate-pending, so a two-call
freeze leaves a child whose second call cannot land.

## When a write is refused

Exit `1` means **nothing was published** — no rename happened and the file on disk is
byte-for-byte what it was. The first token on stderr is the refusal code. The writer has
twenty-eight, each with its response below; two more are raised before the writer runs,
`edition-collision` and `gate-request-unavailable`. Exit `2` carries no code at all and has the table's last rows:

| Refusal | Response |
|---|---|
| `state-non-canonical` | The existing file cannot be re-indented safely. Stop with `RUN-FAILED: state-non-canonical`. There is no other interpreter to hand the run to: the operator repairs the file or starts a new task. |
| `state-unreadable`, `state-unwritable`, `state-incomplete`, `state-candidate-unsound` | The directory is not one the engine can own — unreadable, unwritable, a candidate the reader would not accept, or a candidate carrying a duplicate top-level key or one that neither the pre-write file nor the patch introduced. Stop with `RUN-FAILED: <code>`; the operator repairs the directory or starts a new task. **Never re-send the same patch**: the candidate is unsound for a reason the patch cannot change. |
| `value-not-flow-safe` | A declared output cannot go on a one-line entry. Record the node `failed` with that reason and stop with `RUN-FAILED: value-not-flow-safe`. |
| `state-entry-unserializable` | A node entry **already in the file** cannot be re-serialised. The patch is fine; the file needs repair. Stop with `RUN-FAILED: state-entry-unserializable` and report the message verbatim. This is **not** the `value-not-flow-safe` recovery — shortening the value the patch carries changes nothing here, and trying it loops. |
| `state-temp-exists` | The temp twin is on disk and less than a minute old, so another writer holds it — a write takes milliseconds. Nothing was written. **Do not delete anything**: wait a minute and issue the same write again. A temp older than a minute is a crashed writer's leftover, and the next write reclaims it itself. |
| `state-gate-pending-form` | The pending-gate marker has two legal spellings and this was neither. It is written as the literal `null`, or as `{node, request, since}` — `request` being `gates/<node>.request.yml` for that same `node`, and `since` a measured UTC timestamp — which the writer puts on one line itself. Send the marker as an object, never as pre-spelled text: text carrying a trailing comment or a quote reaches the file with its own bytes and the reader throws on it. Stop with `RUN-FAILED: state-gate-pending-form` and report the message verbatim. |
| `state-workflow-frozen` | A `workflow` patch after the freeze differs from the frozen block — a node left out, added or re-typed, or a scalar changed. Nothing was written. The freeze is written once; send node updates under the top-level `nodes` key, never under `workflow`, and never re-type the graph. A re-send identical to the frozen block is dropped with a `note:` line, and the rest of its patch lands. |
| `state-freeze-unproven` | The freeze's `workflow` block does not re-resolve to its own `graph_hash` — no hash, a source that is not found, an overlay or a profile left out or changed, or a re-spelled hash. Nothing was written. Run `resolve` again with the `--definition`, `--overlay` and `--profile` the run was started with, and freeze with its output copied through (engine Step 4). When `resolve` itself fails, or the message says the definition cannot be read from the run's directory, stop with `RUN-FAILED: state-freeze-unproven` and report the message verbatim. |
| `state-freeze-name-mismatch` | `workflow.name` is absent, or is not the name of the definition the freeze resolves. Nothing was written. Send the `name` `resolve` printed and freeze again. Never relabel a run to borrow another workflow's context block: every reader keyed by the name would then read it as that workflow. |
| `state-freeze-nodes-mismatch` | The freeze's nodes are not exactly the nodes `resolve` printed — one added, one left out, or one recorded under a kind its node cannot have; the message names each. Nothing was written. Send one entry per resolved node with the kind engine Step 4 gives it, and freeze again. |
| `state-freeze-input-missing` | The definition requires an input the freeze records no value for. Nothing was written. Add the value the run was started with under `orchestrator.options.inputs` in the same freeze and send it again. When the invocation never carried one, ask the operator for it in a terminal run; a driven run stops with `RUN-FAILED: state-freeze-input-missing`, because an invented input is a defect. |
| `state-node-status-unknown` | A node was sent with a status outside the eight (engine § *Recording an outcome*). The message lists them. Nothing was written. Map the outcome onto one of the eight and send the write again. `in_progress` belongs to the summary vocabulary, and `running` is the node status that means the same. |
| `state-node-regressed` | The patch sends a node that already ended — completed, failed, skipped or stopped — back to `pending`. Nothing was written. A node's record only moves forward: to run it again, re-drive it (`running`), and to redo a stretch the operator sent back, answer the gate with its revise option through `gate-revise`, which resets the stretch in one write and records why. Never rewind a node by hand to make it ready. |
| `state-held-approval-not-askable` | The write records a continue at `held-approval` that nobody could have been asked: something besides the running closing node is still owed (and the checkpoint is not raised early before a checkpoint), or the run's `cockpit` or `dispatch` driver carried no request for it answered continue in this round (a request whose gate-index row an earlier answer already closed belongs to an earlier round). Nothing was written, and the held choices stay held. Finish what is owed and ask the checkpoint from its brief; under a driver, suspend on it with `gate-request` and fold the answer it brings. Where the driver cannot carry it, publish the close-out graded `failed`, naming each held choice, and let `run-complete` end the run `run-held-unapproved` (engine § *Ending a dispatched run*). Never record a continue to get past it. |
| `state-subrun-held-open` | The write starts a `workflow:` node while a step it follows holds a question with no choice yet, and once its child has run no revise can re-run that step. Nothing was written. Settle the question first: ask the checkpoint the run has reached whose revise re-runs that step, or `held-approval` when none does (engine § *The ready set*), revise the step with the choice in the note, and start the sub-run once nothing it follows holds a question with no choice. |
| `state-subrun-path-mismatch` | The write is to a child run — its state carries a parent link, or the freeze sends one — whose directory is not the `task_path` its parent's `workflow:` node recorded for it. Nothing was written. Every reader that follows the link goes to the recorded path, so a child written elsewhere is a run nobody reads. Write the child's state at the path the parent recorded; when this directory is the one holding the run, first correct the parent node's `task_path` and `run_id` through `write-state` on the parent, then send the write again. Never re-point the parent link to make the two agree. Before the parent records a `task_path` — the child's freeze comes first — the child is held to the task-directory shape, `.maister/tasks/<type>/<name>` under the project root, so a child frozen beside another kind of run or inside its parent's directory is refused the same way: take the directory from `subrun-path` on the parent's state and freeze the child there. The project root is found from the parent link, so a child placed too deep still reads its parent. Only a parent that cannot be read, or that does not carry the linked node, is not judged. |
| `state-node-unknown` | The patch names a node the run's frozen graph does not carry. The message lists the nodes it does carry. Nothing was written. Correct the id, which is usually a typo, and send the write again. Never add a node to a running graph: one the definition gained after the freeze belongs to the next run. |
| `state-gate-values-sent` | The write sends `values` for a gate. A gate's values are recorded by the writer from the answer, as the chosen continue option sets them. Nothing was written. Drop `values` from the gate's entry and record the answer the usual way — the gate `completed`, the chosen option under its `decisions` — and the writer records the values in the same write. |
| `state-value-invalid` | A value recorded under a key the node declares is not of the declared type. The message names the key, the value and the form it should take. Nothing was written. Send the node's whole `values` map again with that key corrected, because values are replaced whole. If the node produced no such value, the node prose decides whether it failed; never coerce one to get past the check. |
| `state-gate-option-unknown` | The gate's summary records an option the gate does not offer. The message lists the ones it does offer. Nothing was written. Record the id of the option the operator actually chose, exactly as the gate spells it and never its label, and send the write again. Never re-ask the gate: the answer was given, and only its spelling was wrong. While choices are held, a frozen gate also offers a `revise-<node>` for each step behind it holding one (`references/gates.md` § *For a held choice*), and only while it does. At `held-approval` the options are the ones its brief offers — continue, a `revise-<node>` per node holding a choice, stop — and only continue and stop once its revises are spent; while a held question with no choice yet waits there is no continue — only the revises and stop, and stop alone once the revises are spent too. |
| `state-absent-invalid` | A node summary's `absent` map is not a map, names an artifact the node does not declare, or gives an entry no reason (engine § *Recording an outcome*). The message lists the declared keys. Nothing was written. Name each artifact by its declared key, never by its path, give the reason in a few words, and send the write again. An artifact the node was meant to produce and did not is not an absence to sanction: the node has not completed. |
| `state-delegates-unrecorded` | A write completes a `direct:` step whose `brief:` declares `delegates` for the run's host, and the step's summary does not list each of them under `delegated`. The message names the missing agents. Nothing was written. Dispatch each one through the Task tool as the brief's `delegates:` line says — never do its work in the session, whatever the size of the project — then send the closing write again listing every agent dispatched. |
| `state-summary-item-invalid` | A typed field of a summary holds a value no reader knows: a decision's `by` outside `operator`, `run`, `audit` and `default`; a risk object with no `risk` text, or a `tag` outside `open`, `tradeoff`, `followup`, `stop` and `resolved`; an artifact `role` outside `primary`, `review`, `evidence` and `log`; a `headline` that is empty or not text (one that spans lines or runs past 220 characters is fitted with a `note:` line instead); an `as_recommended` that is not true, false or null; an `on_behalf_of` that is not a name on one line; a `metrics` entry without a label and a value; a `decision_areas` that is not a list of `{area, alternatives_count, chosen_approach}` maps; a `delegated` that is not a list of agent names or built-in agent types; or a `recommends` that names no continue or revise option of a gate waiting on the node, or carries no one-line reason. The message names the field and the allowed values. Nothing was written. Correct that one value and send the write again. A string item is always accepted, so a source or tag you cannot place can be written as plain text. |
| `state-on-behalf-of-not-operator` | A decision carries `on_behalf_of` but was recorded by `run`, `audit` or `default`, or has a shape that reads as the run's. `on_behalf_of` names the person a relaying side says gave an answer, so it belongs only on an answer a person gave. The message names the decision. Nothing was written. If a person gave the answer, send it as theirs, either `by: operator` or the answer shape, keeping `on_behalf_of`. If the run decided it, drop `on_behalf_of`. Never move a decision the run made over to the operator just to keep the name. |
| `state-question-answer-invalid` | A node's `answer` block could not be folded into its decisions: the node's request file is missing or carries no question set, a question has no answer, an answer names an option the question does not offer, a list answers a single choice, own words answer a question that does not take them, or `answers` names a question the request does not hold. The message names each. Nothing was written — but the gate was already cleared, so the node is `running` and nothing is pending. Re-read the answer file and send its `answer` block again, whole and unchanged; a block retyped by hand is the usual cause. When the answer file itself holds the fault, record each question it cannot answer as `{decision: <its default>, by: default, question_id}`, with an `open` risk naming the answer that could not be read, and continue the node. Never ask the question again in this attempt. |
| `state-patch-invalid`, `state-patch-unknown-key`, `state-inline-collection`, `state-workflow-without-nodes`, `state-workflow-without-task`, `state-context-block-unknown` | The engine built a patch the writer will not apply. Stop with `RUN-FAILED: <code>` and report the writer's message verbatim. The run's own context block sent as a top-level key is not among them: it is written as `context`, with a `note:` line. |
| `edition-collision` | Two editions of this plugin are enabled in the session's settings, so skills may load from either one. Nothing was written, and no write, whether a start or a resume, will land until one edition is disabled. Relay the message verbatim to the operator, since it names both editions and the command that disables each, and stop with `RUN-FAILED: edition-collision`. Don't retry within this session: the fix takes effect only after Claude Code restarts. |
| `gate-request-unavailable` | This edition of the plugin carries no gate module, so a driven run cannot suspend at a gate. Nothing was written and the request in the patch file is kept. Stop with `RUN-FAILED: gate-request-unavailable` — never ask in session and never take a default answer. |
| exit `2`, `usage: the patch file …` or `usage: the patch in …` | The document never reached the writer: the flag named another file, or the file is missing, empty or not JSON. Nothing was written and the file is kept. Write the document to the run's own `.state-patch.json`, name that path, and run the verb once more; the same message twice is `RUN-FAILED: writer-unavailable`. |
| exit `2`, `usage: the patch on stdin …`, or the shell's `argument list too long` | The here-string never delivered a document: it arrived empty or not JSON — most often an apostrophe that closed the single quotes early — or the command line was too long. Nothing was written. Write each apostrophe inside the JSON as `'\''` and run the verb once more, or send the document through the patch file, which a too-long command line always takes; the same message twice is `RUN-FAILED: writer-unavailable`. |
| exit `2`, any other message | The writer itself did not run — a module it imports is missing, or the verb and its flags were malformed. Nothing was published and nothing was even attempted. Stop with `RUN-FAILED: writer-unavailable` and report the message verbatim. |

A `warning:` line on stderr is **not** in this table and never blocks: the state write landed,
and the exit code is `0`. Read the next write's output rather than re-sending the patch.

Exit `2` is not a refusal at all, and is never a reason to record the state change with an
editor tool instead (engine Step 2).

`state-patch-invalid` is the broadest of the caller-defect codes; it also refuses a block-path
map key that is not a plain identifier. Two of its causes are corrected in the patch rather than
ending the run, because the message names the fault and nothing was written:
- **A classing write it cannot class** — the node is a gate or is not `running`, the set fails the
  checks `gate-brief` makes, `reasons` arrive without a set, name an id the set does not hold or
  carry a key other than `rationale`, `assumption` and `reversal`. Correct the set or its reasons
  and send the write again.
- **A `held-approval` entry under `nodes`** carrying anything but `status`, or a status other than
  `pending`, `suspended` or `completed`. Send that status alone.

**Never re-send the same patch, or reach for an editor tool because the script said no**: a
refusal is a correct answer, not an obstacle.

## When `run-complete` refuses

`run-complete` publishes nothing. Each refusal is exit `1`, the message on stderr, and
`RUN-FAILED: <code>` on stdout.
A failed run's `RUN-FAILED: node <id> failed` is also exit `1`, but it is the run's ending
rather than a refusal: echo it, there is nothing to recover.

- `state-missing` — no state file at `--state`. There is no run there to close; check the
  path names the run's own `orchestrator-state.yml`.
- `run-not-ended` — `task.status` is absent or not one of `completed`, `failed`, `stopped`.
  The closing patch was never written: write it, with the status, then run the verb again.
- `state-unreadable` — the file cannot be read or parsed. Nothing was changed; this is the
  write table's `state-unreadable`, with the same hand-over.
- `run-nodes-unfinished` — `task.status` is `completed`, but the message names nodes that have
  not finished: one still `running`, `suspended` or `waiting`, or a `pending` one the ready set
  can still reach. A pending node is not owed when a false guard keeps it off the path, or when
  it waits on a need that ended `failed` or `stopped` which its `on:` does not accept; a node
  behind an owed one is owed too. A gate the skip-guard rule asks (grammar § 7) is owed even
  when its guard is false, and the message never offers it the record-skipped recovery.
  **The recovery is the work that was missed**: resume the run, run each named node — or record
  `skipped` for one whose guard is false, never for such a gate — write the closing patch again,
  and run the verb again. A run that cannot finish them ends `failed`, or `stopped`
  with every unexecuted node, instead. Never record a node `completed` that did not run to
  quiet the check. When the definition changed since the freeze no guard can be evaluated, the
  message says so, and a node whose guard is false must be recorded `skipped` through
  `write-state` before the run can close. A gate the held rule asks is named "asked because
  held choices wait for approval", and is never offered the record-skipped recovery either.
- `run-held-unapproved` — `task.status` is `completed`, but a choice held for approval has no
  approval; the message names each by node, question and choice. It is judged after
  `run-nodes-unfinished` and before the close-out, so it is the marker whether or not a close-out
  was published. Ask `held-approval` and run `run-complete` again. Under a driver whose request
  writer refused that checkpoint, this marker is the run's ending: echo it. A `stopped` or
  `failed` run is not judged.

`closeout-unpublished` says the run is dispatch-driven and
its outbox holds no close-out for this dispatch, or that the outbox root and the dispatch id
were not given, so nothing could be checked. **The recovery is the step that was missed, not
a retry**: publish the close-out through the umbrella runtime's outbox verb with the grade
and the summary the seed's close-out contract asks for, then run `run-complete` again with
the same `--outbox` root and `--dispatch-id`. Never print `RUN-COMPLETE` by hand.
