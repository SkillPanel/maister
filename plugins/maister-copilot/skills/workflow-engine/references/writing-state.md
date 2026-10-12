# Writing state

The workflow engine's rules for writing a run's state. A refused `write-state` names
*When a write is refused*, and a refused `run-complete` names *When `run-complete` refuses*.

**Every state change goes through `write-state`. Never edit `orchestrator-state.yml` with an
editor tool** — not to fix a stray line, not to record one small field, not when a write has
just been refused. There is exactly one exception, and it is not a fallback: answering a
pending gate, where the engine's shell calls cannot run and the writer is therefore
unreachable, records the decision with editor tools and then hands the file straight back to
the writer for re-validation (see `references/gates.md` § *Driver-suspended mode — resume*). Outside that window, an editor-tool
write is the corruption this writer exists to prevent. The writer owns the `workflow:` block and its one-line node entries, the
per-node summaries and their mirrored phase summaries, and the scalars beside them; it emits
at a fixed canonical indent, writes the whole file once per invocation, and self-checks the
candidate through the shared state reader before it publishes anything.

The patch vocabulary is closed, and it is exactly the set of state blocks a run has to be
able to write:

- `orchestrator` and `task` — the two required core blocks. Scalars replace, and so does
  `orchestrator.driver`, which is one contract-shaped value written whole — a dispatched run's
  carries an optional `dispatch_id` beside `kind` and `cwd`, the dispatch it runs, which the
  writer keeps and the engine never reads. The four **open
  maps** under `orchestrator:` — `options`, `task_ids`, `auto_fix_attempts`, `skipped_phases`
  — merge key by key instead, because different nodes write different keys of them at
  different times: a write recording `user_docs_enabled` leaves an `html_output` an earlier
  node set alone. Send the whole map only when you mean to add to it. `task.status` is the
  writer's at one moment: the first write that moves a node off `pending` — the run starting
  to execute — records `in_progress` when the status is absent or `pending`. The freeze runs
  nothing and records none; a status already set otherwise, or one the same patch sends, is
  left alone, and the run's ending is the closing patch's to record.
- `workflow` and `nodes` — the workflow block installed whole, and its one-line node entries
  edited in place afterwards. Never send a node's `started` or `completed`, or
  `orchestrator.updated`: the writer stamps all three from its own clock on each status change
  and drops, with a `note:` line on stderr, any value a patch carries for them.
- `context` and `phase_summaries` — written into the run's context block, whose name the
  writer derives from `workflow.name`: `<name>_context`, the name's dashes written as
  underscores, so `acme-review` writes `acme_review_context`. Two built-ins keep the blocks they
  had before the name was the rule: `development` writes `task_context` and `product-design`
  writes `design_context`. A workflow named `project` or `verification` would derive one of
  the shared blocks below, so its context writes are refused with
  `state-context-block-unknown` and the workflow has to be renamed. `node_summaries` is its
  own top-level block, keyed by node id.
  A phase summary is always sent as the **top-level** `phase_summaries` patch key, never nested
  under `context`, although the file keeps the map inside the context block: the top-level key
  merges entry by entry, while every `context` key is free-form and replaces whole, so a nested
  map would erase every summary earlier phases wrote. The writer refuses the nested shape with
  `state-patch-invalid`. `node_summaries` merges entry by entry the same way, and **each node
  summary merges field by field**: a field you send replaces that field whole, and a field you
  leave out keeps its value. So a later node retagging one earlier risk `resolved` sends only
  that node's `risks`, and its summary, artifacts and answers stay. Send a field as `null` to
  clear it. **The user's answers are history**: a write of a node's `decisions` keeps every
  earlier `by: operator` item it leaves out, unless it carries the same `question_id`, question
  and `attempt` (none is the first) — a question asked again replaces its own answer. That holds
  across a revise, so a node that re-runs records only what it settled this time; a question set
  a driver asks again in the node's new attempt keeps the earlier attempt's answers as history
  (`references/in-node-questions.md` § *In-node questions*).
- `project_context`, `related_tasks`, `verification_context`, `external_research` — the four
  optional top-level blocks. Each is written as a **top-level sibling** of `orchestrator:`
  and of the context block, never nested inside either. A mapping is merged key by key, so
  one write recording `verification_context.fixes_applied` leaves a `reverify_count` another
  write put there alone; `related_tasks` is a list and is replaced whole, so a caller that
  means to append sends the whole list.

Anything else is an error rather than a silent no-op. Never work around a refusal with an
editor tool.

**`orchestrator.policy_hash` is the writer's** (engine Step 4): never send it. The writer judges a gate's
triage itself, on the write that records its answer and on the re-validation of a driven answer
(`references/gates.md`). These warnings print as plain `warning:` lines on stderr, and none is ever a
refusal — the write lands and the exit code does not move:
- **`policy-hash-mismatch:<gate>`** — the policy loaded now would classify the gate, but its hash
  is not the run's `policy_hash`, or the run recorded none. Nothing is classified; relay it.
  `gate-brief --request` warns the same on the request it builds. A classing write warns it
  naming the node: nothing was classed or recorded, and every question is printed under `ask:`.
- **`held-gate-skipped:<gate>`** — the write recorded `skipped` on a gate the held rule asks while
  choices wait for approval (engine § *The ready set*). The status was written as sent: ask the gate, and its
  continue approves the held choices.
- **`autonomy-ceiling-parent-unread:<run>`** — a child run's freeze could not read its parent's
  state, so it copied no autonomy ceiling from it; the freeze landed with the patch's own, if any.
  Relay it.
- **`driver-features-parent-unread:<run>`** — a child run's freeze could not read its parent's
  state, so its driver carries no features: in-node questions take their defaults. Relay it.
- **`skip-guard-skipped:<gate>`** — the write recorded `skipped` on a gate the skip-guard rule
  asks whatever its guard reads (grammar § 7). The status was written as sent, and nothing
  checks it later: ask the gate and record its answer.
- **`provenance-unusable:<node>:<key>`** — an answer's provenance value holds a map key the state
  file cannot carry, so it was left off the decision; relay it, naming the request file it gives.

A `note:` line says the write dropped something the patch sent and landed without it. Beside the
clock fields and `policy_hash`, the writer drops, each with its note: an
`orchestrator.options.ceiling` wider than the run's autonomy ceiling, or one removing it (engine Step 4);
`orchestrator.classes_questions` and a node's `asking`, which only the writer records; and, in a
run that records `classes_questions`, a `by: run` or `by: default` item sent for a question the
writer classed — its own item stays — and any `triage` sent on a node's decisions. A note is
never a refusal: correct the prose that sent it rather than re-sending.

## What the freeze write adds

The freeze patch carries what engine Step 4 lists; the writer checks it and adds the rest.

**The writer proves the freeze before it installs it**, because the freeze is written once and
every reader lays the run out from it. It re-resolves the recorded `source`, `overlays` and
`profile` from the run's own project root, and writes nothing when the result does not hash to
the recorded `graph_hash` (`state-freeze-unproven`), when `workflow.name` is not the
definition's own (`state-freeze-name-mismatch`), when the nodes are not exactly the resolved
set under the kinds engine Step 4 gives (`state-freeze-nodes-mismatch`), or when an input the definition
declares `required` with no default has no value under `orchestrator.options.inputs`
(`state-freeze-input-missing`). Each is corrected in the patch and the freeze sent again
(*When a write is refused*).

**The freeze patch carries `orchestrator.completed_phases: []` and
`orchestrator.failed_phases: []`.** The state contract requires both on every run, from its
first write. The writer seeds each as an empty list, at the top of the block, when the write
that installs the `workflow:` block does not supply it and the file does not already carry it,
so the freeze patch need not spell them and a freeze that omits them still lands valid. A
later write of either replaces the whole list; there is no key to merge on, so a caller that
means to append sends the whole list.

**The writer stamps `orchestrator.created` at the freeze** from the write's own clock, when the
patch does not supply it and the file does not already carry it — a child run's freeze
included. A driver drives no run without it, so it is never left to the caller; a value the
patch does supply is kept.

**The writer records `orchestrator.policy_hash` at the freeze** — which autonomy policy the run
applies, so every later reader of a classified answer can tell what classed it. The policy is an
optional file, `policy/autonomy-policy.json` in this skill's folder; none ships, and without one
the built-in `{"version": 1}` applies, which classifies nothing, so every gate is asked and shown
as it would be with no policy at all. The hash is `sha256:` over the whole parsed file, its keys
sorted at every depth, arrays kept in order, no whitespace. A file that exists but cannot be
applied — unreadable, not JSON, a `version` other than `1`, or a fault in its shape — is refused
whole: the run applies the built-in default, records that hash, and the freeze prints
`warning: policy-refused:<path>:<reason>`, with ` at <dotted path>` for a shape fault. Relay the
warning; it is never a refusal, and the run goes on. The key is the writer's alone: a value a
patch sends is ignored with a `note:` line, a sub-run's freeze records its own, and no later
write adds, changes or removes it.

**The writer records `orchestrator.classes_questions: true` at the freeze when the policy classes
in-node questions** for this workflow, and writes nothing otherwise — never under the built-in
default. The key is the writer's too, dropped with a `note:` line when a patch sends it. It is
the one fact a node reads before it asks (`references/in-node-questions.md` § *When the policy classes a question*).

**The freeze records the run's autonomy ceiling** as `orchestrator.options.ceiling` when the patch
carries one — a dispatched run's seed names the level to record, beside the driver. The autonomy
ceiling bounds what the run may settle without asking: `approve` < `advice` < `decide`, an
unknown value reading as `approve`. A child run's freeze records the narrower of its parent's
effective autonomy ceiling and its own (engine § *Sub-runs*). After the freeze it may narrow, never widen:
a later write naming a wider level, or removing a recorded one, is dropped with a `note:` line,
and the rest of the patch lands.

**The writer seeds `orchestrator.task_ids: {}`** beside
the two phase sequences, on the same terms — unless the patch supplies it or the file already
holds it — and that empty map records that no task items exist.

**The freeze write installs the dashboard viewer.** When `html_output` is not false and the run
directory holds no `dashboard.html`, the freeze copies the plugin's viewer there and reports
`dashboard.html` among the changed paths. It never replaces a file already there, and a copy
that fails is a warning on stderr — the state write still lands. No later write copies it.

## Recording an outcome — the detail

The engine skill's *Recording an outcome* holds what a node records; here is what the writer
checks, and why.

**A node is recorded only with one of eight statuses, and only if the run froze it.** The
statuses are `pending`, `running`, `waiting`, `suspended`, `completed`, `skipped`, `failed` and
`stopped`. Any other status is refused with `state-node-status-unknown`, including the summary
spelling `in_progress`: no reader knows what it means, and every reader would otherwise read the
node as never started. A node the frozen graph does not carry is refused with
`state-node-unknown`, because a node the graph lacks has no place in it, and nothing downstream
would ever wait on it.

**A node's values are held to the outputs it declares.** Each declared type has one form:
- `bool`: `true` or `false`;
- `string` or `id`: a string;
- `enum`: one of its members.

A skipped node records its declared strings and enums as null. Any other value for a declared
key is refused with `state-value-invalid`, because a guard or a later node would misread it
without any error: a guard reading `"false"` finds no bool at all. A key the node does not
declare is still written, and a `warning:` line names it. Nothing reads an undeclared value, so
the key either belongs in the node's `outputs` or should not be sent. A `workflow:` node's
`task_path` and `run_id` are exempt: the node records those two about its child itself. This
check and the gate-answer check (`references/gates.md` § *Terminal mode*) read the definition, so they apply only while
the frozen block still resolves to its recorded hash.

**A declared artifact path resolves against the task directory of the run that wrote it.** Stated
once, covering every scheme: for a `direct:`, `skill:` or `agent:` node that is the run's own task
directory, as it always has been; for a `workflow:` node it is the **child's**, named by the
node's recorded `values.task_path`, because the path the parent declares is the path as the child
writes it. The join applies to both readers of a declared artifact — the existence check (engine § *Recording an outcome*) and
`${<node>.artifacts.<key>}` downstream — and the joined value is repository-root-relative.
Artifacts are therefore never copied into the parent node's values; only declared *values* are.
Storing the joined path as well would be a third copy of one fact, kept in step by hand. The
writer makes the same join when it registers a completing node's artifacts, and spells the result
relative to the parent's own run directory instead, because that is what the dashboard links it
against. The declared path itself is literal: nothing substitutes a `${…}` inside it, so
`validate` refuses one there.

**A sanctioned absence is recorded, not just described.** The completing write's node summary
carries `absent: {<artifact-key>: "<reason>"}` — one entry per declared artifact the node
completed without, named by its declared key (never its path), with the reason in a few words.
Its `summary` still says it in prose for the gate brief. The entry is what the tools read, since
none of them can read prose: `run-complete` prints no `missing-artifact:` line for it, and the
dashboard shows the artifact as *not produced* with the reason instead of leaving a gap. The
writer refuses an entry that names an artifact the node does not declare or gives no reason
(`state-absent-invalid`). Record it only where the node prose sanctions the absence; an
artifact the node owed and did not write is the second row of the engine's missing-artifact table, never an absence to sanction.

The engine's existence check costs one test per declared path and needs nothing the engine does not
already hold: the definition declares every artifact, so the list is free. Without it, a
delegate that returns successfully having written nothing is indistinguishable from one that
wrote everything, and the absence surfaces only when a later node reads the path — or when a
human compares two lists by hand. `run-complete` repeats the comparison once more at the end,
over every completed node and less the absences each node recorded, but only to report: its
`missing-artifact:` lines never refuse, because the completing check — the one that can read the prose —
is where the judgement belongs.

A node's summary carries the shorter phase-status vocabulary, so the node status is mapped
rather than copied. `pending`, `completed`, `skipped` and `failed` map to themselves; `running`
and `waiting` both become `in_progress`, a parent whose child run is still going being exactly
that in the shorter vocabulary; and **`stopped` maps to `skipped`**. `suspended` occurs only on
a node the run is suspended at while its gate awaits an answer — a driver-suspended mode only,
since in terminal mode the answer arrives in the same turn — so it has no mirror and needs none.

**A completing node summary is checked against what the node declared.** When a
`node_summaries` entry is written for a node whose status is `completed`, the writer appends
every artifact path the definition declares for that node which exists, as a file or as a
directory, and which the entry does not already list. It also fills a missing `html` on each
listed markdown file whose sibling `.html` companion exists, unless `html_output` is off; a
directory gets none. For a `workflow:` node the paths are looked for under the child's task
directory, named by the node's recorded `values.task_path`, and registered as
`../../<type>/<run>/<path>`. A `workflow:` node that recorded no `task_path` registers nothing,
because the parent's own directory is not where its child writes. The writer adds only what is on
disk and overwrites nothing the entry states. The closing write still lists what the node prose
asks for: the check catches a list that was forgotten, it does not replace the list.

**Why `stopped` mirrors to `skipped`.** The summary vocabulary has five members and none is
`stopped`, so the status is spelled as one of the five or not written at all. `skipped` is the
member that says *did not produce its outcome, and not because anything broke*, which is what
a stop is; `failed` would read as the `RUN-FAILED` the engine deliberately does not print for
one. Both halves of the rule hold at once, and the distinction is the point: a node a stop
option left **unexecuted** still carries no summary, because it never ran, while a `workflow:`
node that **did** run, waited and then saw its child stop is recorded `stopped` and its
adopting write carries a summary — which is the one that needed a spelling.

## One write per moment

**A patch may carry every block at once, and a moment that changes several things is one
write, not one write per thing.** The vocabulary above is a per-invocation union: the writer
applies every key present in a single pass, and `nodes`, `node_summaries` and the top-level
`phase_summaries` key are maps merged entry by entry, so any number of entries ride in one patch
and none of them disturbs an entry it does not name. A run that issues a
write per field is paying a process, a whole-file rename and — on a terminal session — an
operator's attention for each one.

What "a moment" means, and there are four of them:

- **A node starts.** One patch: the node's `status: running`, and the `orchestrator` scalars
  the start moves.
- **A node ends.** One patch: the node's status, its `node_summaries` entry, the
  `phase_summaries` key the node prose names when it mirrors one, and the `orchestrator`
  scalars the outcome moves. Splitting these is three writes instead of one. The writer
  still mirrors the node's status onto its summary either way. It mirrors from the node's
  recorded status when the summary arrives in a later call, and onto the recorded summary
  when the status arrives later. A summary written with its own `status` keeps it until
  the node's status next changes.
- **A ready-set walk skips nodes.** Every node a false guard skips goes in one patch, with
  their summaries, however many there are. That patch lands no later than the next
  executed node's `running` patch — either earlier, or as part of that same patch — so no
  node is ever recorded as started while a node the walk already passed still reads
  `pending`.
- **A run ends.** The closing node's outcome and `task.status` are one patch; a stop option is
  likewise one patch carrying `task.status: stopped` and every unexecuted node. `run-complete`
  follows it and publishes nothing, so it is not a write and never merges with one.

That leaves two writes around a node — one before the delegation and one after — which is the
floor, because the delegation happens between them and its outcome is what the second one
records.

**A node's prose may name milestones inside it**, where a long node registers what it has
produced so far so that the dashboard does not sit still for its whole length. Each milestone
is one write carrying the node's summary entries and whatever else that moment moves, and never
the node's status, which only the node's own end writes.

**Three writes stand alone, and each has its own reason:**

| The write | Why it cannot join anything |
|---|---|
| the freeze | it precedes node 1, and is already the merged write of the `workflow:` block, `task.key`, `orchestrator.options.inputs`, `orchestrator.options.html_output`, the two empty phase sequences and the empty `task_ids` (engine Step 4) |
| `gate-request` | one invocation, three writes, in the order `references/gates.md` § *Driver-suspended mode — the write order* fixes — a run is pending from the moment its request file lands, so a second shell call against it cannot run |
| the empty patch on gate resume | the shell becomes reachable only the instant `gate_pending` goes null, which is what that write re-validates (`references/gates.md` § *Driver-suspended mode — resume*) |

**A fifth pair can never merge, and for a different reason: it lands in two files.** Starting a
sub-run writes the parent's node (W1), then the whole child freeze (W2), then the parent's link
(W3). W2 is a write against the **child's** state file and the other two are against the parent's,
so no patch vocabulary could carry them together however close in time they are — "one write per
moment" is per state file, and a sub-run start is three moments across two runs.

**W2 is one call and must stay one call.** A state carrying a `workflow:` block but no `nodes` and
no `task` reads as *gate-pending* to the shared state reader, so a two-call freeze leaves the
child looking pending between the calls and the second call cannot land — a child that can never be
finished and a parent that can never proceed. It is the same reasoning that makes `gate-request`
one call, arriving from the other side.

## When a write is refused

Exit `1` means **nothing was published** — no rename happened and the file on disk is
byte-for-byte what it was. The first token on stderr is the refusal code. The writer has
twenty-six, each with its response below; two more are raised before the writer runs,
`edition-collision` and `gate-request-unavailable`. Exit `2` carries no code at all and has the table's last rows:

| Refusal | Response |
|---|---|
| `state-non-canonical` | The existing file cannot be re-indented safely. Stop with `RUN-FAILED: state-non-canonical`. There is no other interpreter to hand the run to: the operator repairs the file or starts a new task. |
| `state-unreadable`, `state-unwritable`, `state-incomplete`, `state-candidate-unsound` | The directory is not one the engine can own — unreadable, unwritable, a candidate the reader would not accept, or a candidate carrying a duplicate top-level key or one that neither the pre-write file nor the patch introduced. Stop with `RUN-FAILED: <code>`; the operator repairs the directory or starts a new task. **Never re-send the same patch**: the candidate is unsound for a reason the patch cannot change. |
| `value-not-flow-safe` | A declared output cannot go on a one-line entry. Record the node `failed` with that reason and stop with `RUN-FAILED: value-not-flow-safe`. |
| `state-entry-unserializable` | A node entry **already in the file** cannot be re-serialised. The patch is fine; the file needs repair. Stop with `RUN-FAILED: state-entry-unserializable` and report the message verbatim. This is **not** the `value-not-flow-safe` recovery — shortening the value the patch carries changes nothing here, and trying it loops. |
| `state-temp-exists` | The temp twin is on disk and less than a minute old, so another writer holds it — a write takes milliseconds. Nothing was written. **Do not delete anything**: wait a minute and issue the same write again. A temp older than a minute is a crashed writer's leftover, and the next write reclaims it itself. |
| `state-gate-pending-form` | The pending-gate marker has two legal spellings and this was neither. It is written as the literal `null`, or as `{node, request, since}` — `request` being `gates/<node>.request.yml` for that same `node`, and `since` a measured UTC timestamp — which the writer puts on one line itself. Send the marker as an object, never as pre-spelled text: text carrying a trailing comment or a quote reaches the file with its own bytes and the reader throws on it. Stop with `RUN-FAILED: state-gate-pending-form` and report the message verbatim. |
| `state-workflow-frozen` | A `workflow` patch after the freeze differs from the frozen block — a node left out, added or re-typed, or a scalar changed. Nothing was written. The freeze is written once; send node updates under the top-level `nodes` key, never under `workflow`, and never re-type the graph. A re-send identical to the frozen block changes nothing. |
| `state-freeze-unproven` | The freeze's `workflow` block does not re-resolve to its own `graph_hash` — no hash, a source that is not found, an overlay or a profile left out or changed, or a re-spelled hash. Nothing was written. Run `resolve` again with the `--definition`, `--overlay` and `--profile` the run was started with, and freeze with its output copied through (engine Step 4). When `resolve` itself fails, or the message says the definition cannot be read from the run's directory, stop with `RUN-FAILED: state-freeze-unproven` and report the message verbatim. |
| `state-freeze-name-mismatch` | `workflow.name` is absent, or is not the name of the definition the freeze resolves. Nothing was written. Send the `name` `resolve` printed and freeze again. Never relabel a run to borrow another workflow's context block: every reader keyed by the name would then read it as that workflow. |
| `state-freeze-nodes-mismatch` | The freeze's nodes are not exactly the nodes `resolve` printed — one added, one left out, or one recorded under a kind its node cannot have; the message names each. Nothing was written. Send one entry per resolved node with the kind engine Step 4 gives it, and freeze again. |
| `state-freeze-input-missing` | The definition requires an input the freeze records no value for. Nothing was written. Add the value the run was started with under `orchestrator.options.inputs` in the same freeze and send it again. When the invocation never carried one, ask the operator for it in a terminal run; a driven run stops with `RUN-FAILED: state-freeze-input-missing`, because an invented input is a defect. |
| `state-node-status-unknown` | A node was sent with a status outside the eight (engine § *Recording an outcome*). The message lists them. Nothing was written. Map the outcome onto one of the eight and send the write again. `in_progress` belongs to the summary vocabulary, and `running` is the node status that means the same. |
| `state-node-regressed` | The patch sends a node that already ended — completed, failed, skipped or stopped — back to `pending`. Nothing was written. A node's record only moves forward: to run it again, re-drive it (`running`), and to redo a stretch the operator sent back, answer the gate with its revise option through `gate-revise`, which resets the stretch in one write and records why. Never rewind a node by hand to make it ready. |
| `state-held-approval-not-askable` | The write records a continue at `held-approval` that nobody could have been asked: something besides the running closing node is still owed (and the checkpoint is not raised early before a checkpoint), or the run's `cockpit` or `dispatch` driver carried no request for it answered continue in this round (a request whose gate-index row an earlier answer already closed belongs to an earlier round). Nothing was written, and the held choices stay held. Finish what is owed and ask the checkpoint from its brief; under a driver, suspend on it with `gate-request` and fold the answer it brings. Where the driver cannot carry it, publish the close-out graded `failed`, naming each held choice, and let `run-complete` end the run `run-held-unapproved` (engine § *Ending a dispatched run*). Never record a continue to get past it. |
| `state-subrun-held-open` | The write starts a `workflow:` node while a step it follows holds a question with no choice yet, and once its child has run no revise can re-run that step. Nothing was written. Settle the question first: ask the checkpoint the run has reached whose revise re-runs that step, or `held-approval` when none does (engine § *The ready set*), revise the step with the choice in the note, and start the sub-run once nothing it follows holds a question with no choice. |
| `state-node-unknown` | The patch names a node the run's frozen graph does not carry. The message lists the nodes it does carry. Nothing was written. Correct the id, which is usually a typo or a phase key used as a node id, and send the write again. Never add a node to a running graph: one the definition gained after the freeze belongs to the next run. |
| `state-gate-values-sent` | The write sends `values` for a gate. A gate's values are recorded by the writer from the answer, as the chosen continue option sets them. Nothing was written. Drop `values` from the gate's entry and record the answer the usual way — the gate `completed`, the chosen option under its `decisions` — and the writer records the values in the same write. |
| `state-value-invalid` | A value recorded under a key the node declares is not of the declared type. The message names the key, the value and the form it should take. Nothing was written. Send the node's whole `values` map again with that key corrected, because values are replaced whole. If the node produced no such value, the node prose decides whether it failed; never coerce one to get past the check. |
| `state-gate-option-unknown` | The gate's summary records an option the gate does not offer. The message lists the ones it does offer. Nothing was written. Record the id of the option the operator actually chose, exactly as the gate spells it and never its label, and send the write again. Never re-ask the gate: the answer was given, and only its spelling was wrong. While choices are held, a frozen gate also offers a `revise-<node>` for each step behind it holding one (`references/gates.md` § *For a held choice*), and only while it does. At `held-approval` the options are the ones its brief offers — continue, a `revise-<node>` per node holding a choice, stop — and only continue and stop once its revises are spent; while a held question with no choice yet waits there is no continue — only the revises and stop, and stop alone once the revises are spent too. |
| `state-absent-invalid` | A node summary's `absent` map is not a map, names an artifact the node does not declare, or gives an entry no reason (engine § *Recording an outcome*). The message lists the declared keys. Nothing was written. Name each artifact by its declared key, never by its path, give the reason in a few words, and send the write again. An artifact the node was meant to produce and did not is not an absence to sanction: the node has not completed. |
| `state-summary-item-invalid` | A typed field of a summary holds a value no reader knows: a decision's `by` outside `operator`, `run`, `audit` and `default`; a risk object with no `risk` text, or a `tag` outside `open`, `tradeoff`, `followup`, `stop` and `resolved`; an artifact `role` outside `primary`, `review`, `evidence` and `log`; a `headline` that is empty, spans lines or runs past 220 characters; an `as_recommended` that is not true, false or null; a `metrics` entry without a label and a value; a `decision_areas` that is not a list of `{area, alternatives_count, chosen_approach}` maps; or a `recommends` that names no continue option of a gate waiting on the node, or carries no one-line reason. The message names the field and the allowed values. Nothing was written. Correct that one value and send the write again. A string item is always accepted, so a source or tag you cannot place can be written as plain text. |
| `state-question-answer-invalid` | A node's `answer` block could not be folded into its decisions: the node's request file is missing or carries no question set, a question has no answer, an answer names an option the question does not offer, a list answers a single choice, own words answer a question that does not take them, or `answers` names a question the request does not hold. The message names each. Nothing was written — but the gate was already cleared, so the node is `running` and nothing is pending. Re-read the answer file and send its `answer` block again, whole and unchanged; a block retyped by hand is the usual cause. When the answer file itself holds the fault, record each question it cannot answer as `{decision: <its default>, by: default, question_id}`, with an `open` risk naming the answer that could not be read, and continue the node. Never ask the question again in this attempt. |
| `state-patch-invalid`, `state-patch-unknown-key`, `state-inline-collection`, `state-workflow-without-nodes`, `state-workflow-without-task`, `state-context-block-unknown` | The engine built a patch the writer will not apply. Stop with `RUN-FAILED: <code>` and report the writer's message verbatim. |
| `edition-collision` | Two editions of this plugin are enabled in the session's settings, so skills may load from either one. Nothing was written, and no write, whether a start or a resume, will land until one edition is disabled. Relay the message verbatim to the operator, since it names both editions and the command that disables each, and stop with `RUN-FAILED: edition-collision`. Don't retry within this session: the fix takes effect only after Claude Code restarts. |
| `gate-request-unavailable` | This edition of the plugin carries no gate module, so a driven run cannot suspend at a gate. Nothing was written and the request in the patch file is kept. Stop with `RUN-FAILED: gate-request-unavailable` — never ask in session and never take a default answer. |
| exit `2`, `usage: the patch file …` or `usage: the patch in …` | The document never reached the writer: the flag named another file, or the file is missing, empty or not JSON. Nothing was written and the file is kept. Write the document to the run's own `.state-patch.json`, name that path, and run the verb once more; the same message twice is `RUN-FAILED: writer-unavailable`. |
| exit `2`, `usage: the patch on stdin …` | The here-string never delivered a document: it arrived empty or not JSON — most often an apostrophe that closed the single quotes early. Nothing was written. Write each apostrophe inside the JSON as `'\''` and run the verb once more, or send the document through the patch file; the same message twice is `RUN-FAILED: writer-unavailable`. |
| exit `2`, any other message | The writer itself did not run — a module it imports is missing, or the verb and its flags were malformed. Nothing was published and nothing was even attempted. Stop with `RUN-FAILED: writer-unavailable` and report the message verbatim. |

A `warning:` line on stderr is **not** in this table and never blocks: the dashboard
projection and the display files are written after the state rename, so one that could not be
published leaves the state write untouched, `dashboard-data.js` simply absent from the reported
files, and the exit code at `0`. Read the next write's output rather than re-sending the patch. The same holds for
the warning that names values a node recorded but does not declare: the write landed with them.
Correct the node prose, or the definition's outputs, before the next run rather than re-sending.

Exit `2` is the one row that is not a refusal at all, which is why it is easy to mishandle:
there is no code to look up and no patch to correct, so the tempting next step is to record
the state change with an editor tool instead. **Do not.** A writer that could not start is
exactly the case the no-fallback rule in engine Step 2 was written for; an editor-tool write here
produces exactly the drifted state file the writer exists to prevent.

`state-patch-invalid` is the broadest of the caller-defect codes, and it now also refuses a
block-path map key that is not a plain identifier rather than emitting it — the shape that
corrupted state files before the guard existed. A key that arrives from a name rather than
from a literal is the one to watch.

Two of its causes are corrected in the patch rather than ending the run, because the message
names the fault and nothing was written:
- **A classing write it cannot class** — the node is a gate or is not `running`, the set fails the
  checks `gate-brief` makes, `reasons` arrive without a set, name an id the set does not hold or
  carry a key other than `rationale`, `assumption` and `reversal`. Correct the set or its reasons
  and send the write again.
- **A `held-approval` entry under `nodes`** carrying anything but `status`, or a status other than
  `pending`, `suspended` or `completed`. Send that status alone.

The last group is a defect in the caller, so it is worth naming what a defect looks like: a
`workflow:` block sent without its nodes, a pending marker sent as a block map, a node
summary sent as an inline collection, a patch key outside the closed vocabulary, a phase
summary nested under `context` instead of sent as the top-level key, a context write sent
before the workflow has a name. Fix the patch and re-run; **re-sending the same
patch, or reaching for an editor tool because the script said no, is the failure mode this
whole design removes.** A refusal is a correct answer, not an obstacle.

## When `run-complete` refuses

`run-complete` publishes nothing, so its refusals are not write refusals and do not belong in
the table above. Each is exit `1`, the message on stderr, and `RUN-FAILED: <code>` on stdout.
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
the same `--outbox` root and `--dispatch-id`. Re-running it unchanged only repeats the
refusal, and printing `RUN-COMPLETE` by hand restores the exact silence the check exists to
break: the chain would wait forever on a run that looked finished.
