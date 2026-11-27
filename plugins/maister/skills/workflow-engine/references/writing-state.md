# Writing state

The workflow engine's rules for writing a run's state. A refused `write-state` names
*When a write is refused*, and a refused `run-complete` names *When `run-complete` refuses*.
Every verb's row and every verb's refusals are in `references/verbs.md` § *The verbs every run calls*, § *The verbs some steps call* and § *Refusals*.

**Every state change goes through `write-state`. Never edit `orchestrator-state.yml` with an
editor tool** — not to fix a stray line, not to record one small field, not when a write has
just been refused. The one exception is answering a pending gate, which records the decision
with editor tools and hands the file straight back to the writer for re-validation
(`references/gates.md` § *Driver-suspended mode — resume*). The writer emits at a fixed
canonical indent, writes the whole file once per invocation, and self-checks the candidate
before it publishes anything.

Every successful write also projects the run's `dashboard-data.js`: the projection is the file's
only writer, so no node writes or rewrites it.

The patch vocabulary is closed, and it is exactly the set of state blocks a run has to be
able to write:

- `orchestrator` and `task` — the two required core blocks. Scalars replace, and so does
  `orchestrator.driver`, which is one contract-shaped value written whole — a dispatched run's
  is `{kind: cockpit, cwd, dispatch_id}`, the dispatch it runs, which the writer keeps; the engine
  reads the id only to know the run is dispatched (engine skill, *A dispatched run is told by its
  `dispatch_id`*), and a legacy `{kind: dispatch, …}` reads as a dispatched run with or without
  one. `cwd` is absolute and records the directory the run
  was started in, which a driver needs to start a session there again; nothing reads it to find
  the run. A run is located by its state file, and its checkout is the folder holding the
  `.maister/` it sits in — `<checkout>/.maister/tasks/<type>/<date-name>`,
  `<checkout>/.maister/umbrella/runs/<run-id>` for the run that drives a chain, or
  `<run-id>/runs/<child>` under it for a chain's own run — so a run moved to another machine is
  found where it now is, and every read of the project's `config.yml` takes that one checkout;
  `resume-check` prints it as `root`. A
  folder named `<run>.moved-<digits>` (the copy a machine kept after the run moved) or
  `<run>.failed-<digits>` (a rolled-back copy) is not a run: no listing names it and
  `resume-check` refuses it. The four **open
  maps** under `orchestrator:` — `options`, `task_ids`, `auto_fix_attempts`, `skipped_phases`
  — merge key by key instead: a write recording `user_docs_enabled` leaves an `html_output` an
  earlier node set alone. `task.status` is the writer's at the freeze, which records
  `in_progress` — as does the first write that moves a node off `pending`, for a state frozen
  without one — when the status is absent or `pending`; a status already set otherwise, or one
  the same patch sends, is left alone, and the run's ending is the closing patch's to record.
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
  (`references/in-node-questions.md` § *In-node questions*); within one attempt, a later round's answer to the same question is the one in effect and the earlier round's stays as history. **Under a `cockpit` or `dispatch`
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
  caller that means to append sends the whole list. `verification_context.suite_run` — whether
  the cycle's full test suite ran — takes `passed`, `failed`, `skipped`, `not_run` or null
  (§ *The verification block*); any other value is refused.

Anything else is an error rather than a silent no-op.

**`write-state` checks the document it wrote structurally, not against a schema, and that
is deliberate.** It re-reads the candidate through the shared state reader
(the plugin root's `lib/state-scan.mjs`), then holds it to the rules a line-oriented writer can state for
itself: no duplicate key at any column, no top-level block that neither the prior file nor
this patch introduced, and a task, a workflow and a non-empty node map present; a consumer
checkout carries no YAML package and no schema validator. So a document can be structurally
sound and still carry a wrong value. Two things follow for a caller. Send values in the
shapes the engine skill and its references document rather than relying on a refusal to catch a
wrong one; and never rewrite the `workflow:`
block. It is written once, at the freeze, and never again: a later patch identical to it
changes nothing, and one that differs in a node or in any scalar beside `workflow.nodes` —
`graph_hash` among them — is refused with `state-workflow-frozen`. Nothing is carried
forward into the block and nothing is dropped from it.

**The writer judges a gate's triage itself**, on the write that records its answer and on the
re-validation of a driven answer (`references/gates.md` § *Driver-suspended mode — resume*). These `warning:` lines on stderr are
never refusals — the write lands and the exit code does not move:
- **`policy-hash-mismatch:<gate>`** — the policy loaded now would classify the gate, but its hash
  is not the run's `policy_hash`, or the run recorded none. Nothing is classified; relay it. A
  classing write warns it naming the node, and every question is printed under `ask:`.
- **`held-gate-skipped:<gate>`** — the write recorded `skipped` on a gate the held rule asks while
  choices wait for approval (`references/in-node-questions.md` § *When the policy classes a question*). The status was written as sent: ask the gate, and its
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
`orchestrator.classes_questions` and a node's `asking` and `asked_triage`, which only the writer
records; a `phase_summaries`, the retired phase-summary mirror, top-level or under `context`; a
`workflow` block re-sent identical to the frozen one; and, in a run that records
`classes_questions`, a `by: run` or `by: default` item sent for a question the writer classed, a
`by: run` item for a question it left to ask, and any `triage` sent on a node's decisions — but
the triage the writer put on a person's answer, sent back with it, is dropped silently and put
back. Two more are corrected rather than dropped, each with its note: a `headline`
that spans lines or runs past 220 characters is folded onto one line and cut at the last
sentence that fits, and the run's own context block sent as a top-level key (`task_context` in a
development run) is written as `context`. Correct the prose that sent it rather than re-sending.

## What the freeze write adds

The freeze patch carries what engine Step 4 lists; the writer checks it and adds the rest.
A `workflow` block sent without `nodes` gets them from the graph the proof below re-resolves:
one `pending` entry per node, under its kind.

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
` at <dotted path>` for a shape fault. Relay the warning; the run goes on. A policy row names the
workflow it classes by the run's `workflow.name`, with one reserved name: a run whose definition is a
file in `.maister/workflows/generated/` is classed by the rows under `generated`, whatever its file
and `name:` are, while its own name, task directory and recorded source stay as they are. A value a patch sends
is ignored with a `note:` line, a sub-run's freeze records its own, and no later write changes it — `move-base` alone moves `task.base_commit` (below).

**It records `task.status: in_progress`** when the patch sends no status: a frozen run is under
way from the freeze on.

**It records `task.base_commit`** — where the run starts: `{sha, dirty}`, HEAD at the freeze and
the paths already modified, staged or untracked then, the project's `.maister/` left out.
`review-brief` measures every verification cycle from it. A project outside git records none and
says nothing; a repository with no commit yet records none and prints
`warning: base-commit-unrecorded`, and a status it cannot read keeps the base with no dirty paths
and prints `warning: base-dirty-unread`. A value a patch sends is ignored with a `note:` line, a
sub-run's freeze records its own, and no `write-state` changes it. The one exception is `move-base`, which moves the base to the merged tip after a merge and keeps each replaced base: `{sha, dirty, previous: [{sha, dirty, at, reason}, …]}`, oldest first, `dirty` being the paths still dirty that were already dirty before. A run that never moves keeps the two-key `{sha, dirty}`.

**It records `orchestrator.options.delegation`** — whether the run's subagents can dispatch
subagents of their own: `{mode, depth, source}`, from the host the freeze's `--host` names, else
the host this build ships for — so every freeze records one, `inline` on Copilot.
`depth` is how many levels of subagents the host allows below the main session: on `claude` the
value of `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` when it is a whole number, else 3; on `copilot`
4. `mode` is `nested` at a depth of 2 or more and `inline` below it, and `source` says where the
depth came from. On `copilot` the mode is always `inline`, with a one-line `reason`: Copilot runs
every subagent level under a session of its own, so the runners keep their loops in the main
session there, and `runner-step` reads a run frozen `nested` on Copilot as `inline` too. A
`cockpit` or `dispatch` driver follows the same rule, with a `source` naming
the SDK release nesting was checked under. A run that records none reads as `inline`. The mode shows on the status line while the review step
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
run's freeze records the narrower of its parent's effective ceiling and its own
(`references/sub-runs.md` § *Walk two — a cockpit or dispatch driver, freeze, print, end the turn*). After the freeze it may narrow, never widen: a later write naming a wider level,
or removing a recorded one, is dropped with a `note:` line, and the rest of the patch lands.

**It creates the run directory**, at the path `--state` names, under the rule engine Step 4
gives, and derives the project root from that depth. Do not make it yourself: the freeze creates
it, with the state file inside. A top-level run whose folder is not
`.maister/tasks/<type>/<name>/` or an umbrella run's `.maister/umbrella/runs/<id>/` (a chain's own
run in its `runs/<child>/`) is refused `state-run-folder-misplaced`. **It records
`orchestrator.task_path`**, the run's folder relative to the project root, from where the state
file is; a value the freeze patch sends is dropped with a `note:` line, and a later write of the
key lands as sent. A child run's directory is the one `subrun-path` prints
(`references/sub-runs.md` § *The child directory name*). **It creates the folders inside it**: the first folder of every
artifact path the resolved graph declares, so a node or an agent writing a declared artifact
finds its folder there. A deeper folder, a directory artifact included, is its writer's to create.

**It records `task.key`**, the ticket the run was started from: the value of the input `resolve`
names as `tracker_key`, when that input has one and the patch sends no key.

**It records `orchestrator.options.html_output` and `orchestrator.options.mockup_format`** from
the top-level keys of `.maister/config.yml`, each only when the patch sends none, so a driver that
sends one keeps it. With no file or no key it records `true` and `html`. A `mockup_format` other
than `html` or `ascii` is recorded `html`, with one `warning: mockup-format-replaced:<value>` to
relay.

**A graph with a `dir:` node is a chain**, and its freeze under an absent or `terminal` driver is
refused `state-freeze-chain-only`.

**It records the project profile**, the `project:` key of `.maister/config.yml`, as
`orchestrator.options.project`, which `review-brief` hands to the reviewers; a bad value is a
`warning: project-profile: …` line and the field is left out, never a refusal.

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

**A skipped gate may name the child answer that skipped it.** On the write that records a gate
`skipped`, the writer traces its guard. When every operand reads a value a completed `workflow:`
node adopted from its child, that value is what makes the operand false, the child's definition
exposes it from a gate's `sets`, and that gate is completed with an answer that set the same value
— all of them one answer — it records `answered_in: {run, node, option}` on the gate's entry: the
child's run id as the parent node recorded it, the child's gate, and the option chosen there. In
every other case the key is absent: a guard on an input or on a value a child's step recorded, two
answers behind one guard, a child that cannot be read or no longer proves against its definition.
A reader shows an absent key as a plain skip. Like `sets`, the key is the writer's own. A patch
that sends it has it dropped and noted, and a revise that resets the gate clears it.

**Artifacts are never copied into a node's values**; only declared *values* are. A declared path
resolves against the task directory of the run that wrote it — the child's, the node's recorded
`values.task_path`, for a `workflow:` node — and is literal: `validate` refuses a `${…}` inside it.

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

**A summary's artifact paths are task-relative, and each file is listed once.** The dashboard
sits in the task folder and links every `path` and `html` from there. So, for each list a write
sends, the writer spells a path that opens with the task path — repository-relative or
absolute — relative to the task folder, and one inside a recorded sub-run's folder as
`../../<type>/<run>/<path>`. A relative path is read from the repository root when it opens with
the task path, a sub-run's or `.maister/`, and from the task folder otherwise. A path left
outside both is refused with `state-summary-artifact-outside`. An entry naming a file already
listed, as a bare string or as `path:`, is dropped, keeping the one that carries an `html`
companion, else the first, in the first one's place. An entry already task-relative and unique
is kept exactly as sent. The dashboard reads a list written before this rule the same way: it
places each path, leaves out an entry it cannot place inside the task folder, and lists each
file once, so the state needs no rewrite.

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
  likewise one patch carrying `task.status: stopped` and every unexecuted node recorded
  `stopped`. In a patch that ends the run `stopped` or `failed`, the writer records a node sent
  `skipped` that is still on the run's path `stopped`, and keeps the record of one that already
  ended, with a `note:` line. `run-complete` follows it and publishes nothing, so it is not a
  write and never merges with one.

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
forty-three, each with its response below; two of them, `gate-unwritable` and `gate-temp-exists`,
come from the gate index a write regenerates, and `gate-request` raises them too. Two more are
raised before the writer runs, `edition-collision` and `gate-request-unavailable`, and three are
`gate-request`'s own: `gate-request-invalid`, `gate-request-exists` and `gate-request-pending`.
Exit `2` carries no code at all and has the table's last rows:

| Refusal | Response |
|---|---|
| `state-non-canonical` | The existing file cannot be re-indented safely. Stop with `RUN-FAILED: state-non-canonical`. There is no other interpreter to hand the run to: the operator repairs the file or starts a new task. |
| `state-unreadable`, `state-unwritable`, `state-incomplete`, `state-candidate-unsound` | The directory is not one the engine can own — unreadable, unwritable, a candidate the reader would not accept, or a candidate carrying a duplicate top-level key or one that neither the pre-write file nor the patch introduced. Stop with `RUN-FAILED: <code>`; the operator repairs the directory or starts a new task. **Never re-send the same patch**: the candidate is unsound for a reason the patch cannot change. |
| `value-not-flow-safe` | A declared output cannot go on a one-line entry. Record the node `failed` with that reason and stop with `RUN-FAILED: value-not-flow-safe`. |
| `state-entry-unserializable` | A node entry **already in the file** cannot be re-serialised. The patch is fine; the file needs repair. Stop with `RUN-FAILED: state-entry-unserializable` and report the message verbatim. This is **not** the `value-not-flow-safe` recovery — shortening the value the patch carries changes nothing here, and trying it loops. |
| `state-temp-exists` | The temp twin is on disk and less than a minute old, so another writer holds it — a write takes milliseconds. Nothing was written. **Do not delete anything**: wait a minute and issue the same write again. A temp older than a minute is a crashed writer's leftover, and the next write reclaims it itself. |
| `state-gate-pending-form` | The pending-gate marker has two legal spellings and this was neither. It is written as the literal `null`, or as `{node, request, since}` — `request` being `gates/<node>.request.yml` for that same `node`, and `since` a measured UTC timestamp — with an optional `asked_by_session` that, when present, is a session id (left out, never null or empty, when there is none), which the writer puts on one line itself. Send the marker as an object, never as pre-spelled text: text carrying a trailing comment or a quote reaches the file with its own bytes and the reader throws on it. Stop with `RUN-FAILED: state-gate-pending-form` and report the message verbatim. |
| `state-workflow-frozen` | A `workflow` patch after the freeze differs from the frozen block — a node left out, added or re-typed, or a scalar changed. Nothing was written. The freeze is written once; send node updates under the top-level `nodes` key, never under `workflow`, and never re-type the graph. A changed scalar is an attempt to re-freeze, which no verb does: the message names the frozen `workflow.source`, and the ways on are to put that definition back or start a new run (the paragraph below the table, *A changed definition never re-freezes an open run*). A re-send identical to the frozen block is dropped with a `note:` line, and the rest of its patch lands. |
| `state-freeze-unproven` | The freeze's `workflow` block does not re-resolve to its own `graph_hash` — no hash, a source that is not found, an overlay or a profile left out or changed, or a re-spelled hash. Nothing was written. Run `resolve` again with the `--definition`, `--overlay` and `--profile` the run was started with, and freeze with its output copied through (engine Step 4). When `resolve` itself fails, or the message says the definition cannot be read from the run's directory, stop with `RUN-FAILED: state-freeze-unproven` and report the message verbatim. |
| `state-freeze-name-mismatch` | `workflow.name` is absent, or is not the name of the definition the freeze resolves. Nothing was written. Send the `name` `resolve` printed and freeze again. Never relabel a run to borrow another workflow's context block: every reader keyed by the name would then read it as that workflow. |
| `state-freeze-nodes-mismatch` | The freeze's nodes are not exactly the nodes `resolve` printed — one added, one left out, or one recorded under a kind its node cannot have; the message names each. Nothing was written. Send one entry per resolved node with the kind the message names, and freeze again. |
| `state-freeze-chain-only` | The definition declares `chain_only: true`, or a node carries `dir:`, and the freeze, as it leaves the state, has no driver or a `terminal` one. Nothing was written, and no dashboard was opened. Relay the message to the operator as the run's end, with the next step — start the chain from maister cockpit — and stop: no node runs and nothing is retried. A run a chain dispatches records its driver in this same freeze; one that sent it separately sends the freeze again with the driver beside the block. |
| `state-run-folder-misplaced` | A top-level freeze — no parent link — whose state file is not in a run folder: `.maister/tasks/<type>/<name>/`, `.maister/umbrella/runs/<id>/`, or a chain's own run at `.maister/umbrella/runs/<id>/runs/<child>/`, under the project root. Nothing was written. Every reader that lists runs looks only there, and a folder at another depth would read another folder's configuration. Freeze again at the path the message names; the freeze creates the folder. A child run is held to `state-subrun-path-mismatch` instead. |
| `state-freeze-input-missing` | The definition requires an input the freeze records no value for. Nothing was written. Add the value the run was started with under `orchestrator.options.inputs` in the same freeze and send it again. When the invocation never carried one, ask the operator for it in a terminal run; a driven run stops with `RUN-FAILED: state-freeze-input-missing`, because an invented input is a defect. |
| `state-node-status-unknown` | A node was sent with a status outside the eight (engine § *Recording an outcome*). The message lists them. Nothing was written. Map the outcome onto one of the eight and send the write again. `in_progress` belongs to the summary vocabulary, and `running` is the node status that means the same. |
| `state-node-needs-unmet` | The write records a node `completed` while a node it needs, or a node behind that one, has not ended and is still on the path the run takes. A need the same write records `completed` or `skipped` counts as ended. Nothing was written. Run or ask each node the message names, then send the write again. A need off the path (its guard reads false) never refuses: the writer records it `skipped` in the same write and says so in a `note:` line. Never record a node `completed` or `skipped` to get past this. |
| `state-node-regressed` | The patch sends a node that already ended — completed, failed, skipped or stopped — back to `pending`. Nothing was written. A node's record only moves forward: to run it again, re-drive it (`running`), and to redo a stretch the operator sent back, answer the gate with its revise option through `gate-revise`, which resets the stretch in one write and records why. Never rewind a node by hand to make it ready. |
| `state-held-approval-not-askable` | The write records a continue at `held-approval` that nobody could have been asked: something besides the running closing node is still owed (and the checkpoint is not raised early before a checkpoint), or the run's `cockpit` or `dispatch` driver carried no request for it answered continue in this round (a request whose gate-index row an earlier answer already closed belongs to an earlier round). Nothing was written, and the held choices stay held. Finish what is owed and ask the checkpoint from its brief; under a driver, suspend on it with `gate-request` and fold the answer it brings. Where the driver cannot carry it, publish the close-out graded `failed`, naming each held choice, and let `run-complete` end the run `run-held-unapproved` (`references/gates.md` § *Ending a dispatched run*). Never record a continue to get past it. |
| `state-answer-needs-person` | The write records an answer at a checkpoint, completes a checkpoint, sends the run back, or records a checkpoint `skipped` while it is still on the run's path, but the question tool returned no person's answer to that question — under Copilot's autopilot it reports that nobody is available; a skipped, declined, cancelled or failed question, or one never asked with the tool, is the same — so the pick is the session's own. Nothing was written and the note beside the state stays. Stop the turn and name the checkpoint or question. Under autopilot, tell the person to switch Copilot to interactive mode and resume the run; then ask it again with the question tool from its brief, never in chat. Never send the answer again with a name, a `via` or an actor, never complete the gate node without an answer, and never record a checkpoint the run has to ask as `skipped`. |
| `state-skip-before-answer` | The write records a checkpoint `skipped` while it is still on the run's path, in the same write as a checkpoint answer that may take it off the path: the path is read on the state before the write, so the skip cannot be judged there. Nothing was written. Record the checkpoint's answer first, then skip what its answer takes off the path: send the answer alone, then each skip in a write of its own after the next node's brief. Nobody needs to be asked again. |
| `state-subrun-held-open` | The write starts a `workflow:` node while a step it follows holds a question with no choice yet, and once its child has run no revise can re-run that step. Nothing was written. Settle the question first: ask the checkpoint the run has reached whose revise re-runs that step, or `held-approval` when none does (`references/gates.md` § *The closing checkpoint `held-approval`*), revise the step with the choice in the note, and start the sub-run once nothing it follows holds a question with no choice. |
| `state-subrun-path-mismatch` | The write is to a child run — its state carries a parent link, or the freeze sends one — whose directory is not the `task_path` its parent's `workflow:` node recorded for it. Nothing was written. Every reader that follows the link goes to the recorded path, so a child written elsewhere is a run nobody reads. Write the child's state at the path the parent recorded; when this directory is the one holding the run, first correct the parent node's `task_path` and `run_id` through `write-state` on the parent, then send the write again. Never re-point the parent link to make the two agree. Before the parent records a `task_path` — the child's freeze comes first — the child is held to the task-directory shape, `.maister/tasks/<type>/<name>` under the project root, so a child frozen beside another kind of run or inside its parent's directory is refused the same way: take the directory from `subrun-path` on the parent's state and freeze the child there. The project root is found from the parent link, so a child placed too deep still reads its parent. Only a parent that cannot be read, or that does not carry the linked node, is not judged. |
| `state-node-unknown` | The patch names a node the run's frozen graph does not carry. The message lists the nodes it does carry. Nothing was written. Correct the id, which is usually a typo, and send the write again. Never add a node to a running graph: one the definition gained after the freeze belongs to the next run. |
| `state-gate-values-sent` | The write sends `values` for a gate. A gate's values are recorded by the writer from the answer, as the chosen continue option sets them. Nothing was written. Drop `values` from the gate's entry and record the answer the usual way — the gate `completed`, the chosen option under its `decisions` — and the writer records the values in the same write. |
| `state-gate-config-continued` | The write sends a decision, an answer or a status other than `completed` for a gate the project's config continued (its answer recorded `by: config`). Nothing was written. The gate is not asked or answered again: show the line `node-brief` printed for it and go on with the node due next, which `gate-brief` for the gate names in its refusal. |
| `state-value-invalid` | A value recorded under a key the node declares is not of the declared type. The message names the key, the value and the form it should take. Nothing was written. Send the node's whole `values` map again with that key corrected, because values are replaced whole. If the node produced no such value, the node prose decides whether it failed; never coerce one to get past the check. |
| `state-gate-option-unknown` | The gate's summary records an option the gate does not offer. The message lists the ones it does offer. Nothing was written. Record the id of the option the operator actually chose, exactly as the gate spells it and never its label, and send the write again. Never re-ask the gate: the answer was given, and only its spelling was wrong. While choices are held, a frozen gate also offers a `revise-<node>` for each step behind it holding one (`references/gates.md` § *For a held choice*), and only while it does. At `held-approval` the options are the ones its brief offers — continue, a `revise-<node>` per node holding a choice, stop — and only continue and stop once its revises are spent; while a held question with no choice yet waits there is no continue — only the revises and stop, and stop alone once the revises are spent too. |
| `state-absent-invalid` | A node summary's `absent` map is not a map, names an artifact the node does not declare, or gives an entry no reason (§ *Recording an outcome — the detail*). The message lists the declared keys. Nothing was written. Name each artifact by its declared key, never by its path, give the reason in a few words, and send the write again. An artifact the node was meant to produce and did not is not an absence to sanction: the node has not completed. |
| `state-delegates-unrecorded` | A write completes a `direct:` step whose `brief:` declares `delegates` for the run's host, and the step's summary does not list each of them under `delegated`. The message names the missing agents. Nothing was written. Dispatch each one through the Task tool as the brief's `delegates:` line says — never do its work in the session, whatever the size of the project — then send the closing write again listing every agent dispatched. |
| `delivery-scope-invalid` | A write completes a step that declares the output `delivery_scope`, and the file at its path is missing or breaks the shape product design's delivery-scope reference defines (§ *The shape*). One line per problem names the key and what to write instead; the last names the step and the file. Nothing was written. Rewrite the file as the lines say — lists of entries, each with its `name`, never a map keyed by member name — then send the same closing write again. Never drop or rename the output, record it absent, or change the check to get past it. |
| `state-summary-artifact-outside` | A summary's `artifacts` entry names a `path` or an `html` outside the task folder and every recorded sub-run's folder: a repository file such as `.maister/docs/INDEX.md`, a `../` path that climbs out, or an absolute path elsewhere (§ *Recording an outcome — the detail*). The message names the entry and the task folder. Nothing was written. Name the file relative to the task folder (`outputs/research-report.md`), or leave it out of the summary; a file outside the task folder is not the run's artifact. |
| `state-summary-item-invalid` | A typed field of a summary holds a value no reader knows: a decision's `by` outside `operator`, `run`, `audit` and `default`; a risk object with no `risk` text, or a `tag` outside `open`, `tradeoff`, `followup`, `stop` and `resolved`; an artifact `role` outside `primary`, `review`, `evidence` and `log`; a `headline` that is empty or not text (one that spans lines or runs past 220 characters is fitted with a `note:` line instead); an `as_recommended` that is not true, false or null; an `on_behalf_of` that is not a name on one line; a `metrics` entry without a label and a value; a `decision_areas` that is not a list of `{area, alternatives_count, chosen_approach}` maps; a `delegated` that is not a list of agent names or built-in agent types; or a `recommends` whose option is neither null nor a continue or revise option of a gate waiting on the node, or that carries no one-line reason. On Copilot it also refuses a checkpoint recorded `completed` after a person answered it with no answer item among its `decisions`; the message spells the shape, and the answer is sent again in it. The message names the field and the allowed values. Nothing was written. Correct that one value and send the write again. A string item is always accepted, so a source or tag you cannot place can be written as plain text. |
| `state-on-behalf-of-not-operator` | A decision carries `on_behalf_of` but was recorded by `run`, `audit` or `default`, or has a shape that reads as the run's. `on_behalf_of` names the person a relaying side says gave an answer, so it belongs only on an answer a person gave. The message names the decision. Nothing was written. If a person gave the answer, send it as theirs, either `by: operator` or the answer shape, keeping `on_behalf_of`. If the run decided it, drop `on_behalf_of`. Never move a decision the run made over to the operator just to keep the name. |
| `state-question-answer-invalid` | A node's `answer` block could not be folded into its decisions: the node's request file is missing or carries no question set, a question has no answer, an answer names an option the question does not offer, a list answers a single choice, own words answer a question that does not take them, or `answers` names a question the request does not hold. The message names each. Nothing was written — but the gate was already cleared, so the node is `running` and nothing is pending. Re-read the answer file and send its `answer` block again, whole and unchanged; a block retyped by hand is the usual cause. When the answer file itself holds the fault, record each question it cannot answer as `{decision: <its default>, by: default, question_id}`, with an `open` risk naming the answer that could not be read, and continue the node. Never ask the question again in this attempt. |
| `state-workflow-without-task` | The freeze patch carried no `task` block. Add `task.title` and `task.description` to the freeze patch and send it again. |
| `state-patch-invalid`, `state-patch-unknown-key`, `state-inline-collection`, `state-workflow-without-nodes`, `state-context-block-unknown` | The engine built a patch the writer will not apply. Stop with `RUN-FAILED: <code>` and report the writer's message verbatim. The run's own context block sent as a top-level key is not among them: it is written as `context`, with a `note:` line. |
| `edition-collision` | Two editions of this plugin are enabled in the session's settings — the settings files, plus the session's own `--settings` when `MAISTER_SESSION_SETTINGS` names it — so skills may load from either one. Nothing was written, and no write, whether a start or a resume, will land until one edition is disabled. Relay the message verbatim to the operator, since it names both editions, the command that disables each and how a session started with `--settings` makes that layer visible, and stop with `RUN-FAILED: edition-collision`. Don't retry within this session: the fix takes effect only after Claude Code restarts. |
| `gate-request-unavailable` | This edition of the plugin carries no gate module, so a driven run cannot suspend at a gate. Nothing was written and the request in the patch file is kept. Stop with `RUN-FAILED: gate-request-unavailable` — never ask in session and never take a default answer. |
| `gate-request-invalid` | The request document, or the question set `gate-request --node` built it from, breaks the request's shape; the message names the first fault: a key the request does not take, a node the frozen graph does not carry, a question set sent for a gate (a gate is asked with its own kind), a question id outside the id rule (`references/in-node-questions.md` § *When a question suspends*) or one two questions share, an option with no id or no label. Nothing was written and the patch file is kept. Correct that field in the document or the set and run `gate-request` again. Never ask in session instead, and never take a default answer. |
| `gate-request-exists` | A different request already stands in the node's request file: one answered in this attempt of the node, or one spelling another question. Nothing was written. A gate is asked once: read that file rather than asking again, and never overwrite or delete it, because it may already hold the answer. A node asks again in one attempt only as a later round of its question set, once the earlier round's answer is folded. |
| `gate-request-pending` | Another node of this run is still waiting for its answer, and a run asks one question at a time; the message names that node. Nothing was written. End the turn on that question, and ask this one after it is answered. |
| `gate-unwritable` | The run's `gates/` folder, a request file in it or the gate index cannot be read or written; `gate-request` writes them, and a write that records an answer regenerates the index. Nothing was left published. Handled exactly like `state-unwritable`: stop with `RUN-FAILED: gate-unwritable`; the operator repairs the directory or starts a new task. |
| `gate-temp-exists` | The temp twin of the gate index or of a request file is on disk and less than a minute old, so another writer holds it. Nothing was written. Handled exactly like `state-temp-exists`: **do not delete anything**, wait a minute and issue the same call again. |
| exit `2`, `usage: the patch file …` or `usage: the patch in …` | The document never reached the writer: the flag named another file, or the file is missing, empty or not JSON. Nothing was written and the file is kept. Write the document to the run's own `.state-patch.json`, name that path, and run the verb once more; the same message twice is `RUN-FAILED: writer-unavailable`. |
| exit `2`, `usage: the patch on stdin …`, or the shell's `argument list too long` | The here-string never delivered a document: it arrived empty or not JSON — most often an apostrophe that closed the single quotes early — or the command line was too long. Nothing was written. Write each apostrophe inside the JSON as `'\''` and run the verb once more, or send the document through the patch file, which a too-long command line always takes; the same message twice is `RUN-FAILED: writer-unavailable`. |
| exit `2`, any other message | The writer itself did not run — a module it imports is missing, or the verb and its flags were malformed. Nothing was published and nothing was even attempted. Stop with `RUN-FAILED: writer-unavailable` and report the message verbatim. |

**A changed definition never re-freezes an open run.** The graph a run froze is its graph
for its whole life, and no verb or flag replaces it. A read verb's `…-graph-drift` warning,
`subrun-graph-drifted`, `dispatch-graph-drifted` and `state-workflow-frozen` share two ways on:
Put back the definition the run froze (`workflow.source`, with its overlays) and the run goes
on where it stopped, or start a new run from the changed definition. Never revert a person's
own edit unasked: name both ways and let the person choose.

A `warning:` line on stderr is **not** in this table and never blocks: the state write landed,
and the exit code is `0`. Read the next write's output rather than re-sending the patch.

Exit `2` is not a refusal at all, and is never a reason to record the state change with an
editor tool instead (engine *Before anything else*, **Every state change goes through `write-state`**).

`state-patch-invalid` is the broadest of the caller-defect codes; it also refuses a block-path
map key that is not a plain identifier. Three of its causes are corrected in the patch rather than
ending the run, because the message names the fault and nothing was written:
- **A classing write it cannot class** — the node is a gate or is not `running`, the set fails the
  checks `gate-brief` makes, `reasons` arrive without a set, name an id the set does not hold or
  carry a key other than `rationale`, `assumption` and `reversal`. Correct the set or its reasons
  and send the write again.
- **A `held-approval` entry under `nodes`** carrying anything but `status`, or a status other than
  `pending`, `suspended` or `completed`. Send that status alone.
- **A `verification_context.suite_run` outside its values.** Send one of `passed`, `failed`,
  `skipped` and `not_run`, or null.

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
- `run-needs-unmet` — `task.status` is `completed`, but a completed node was recorded past a
  node it needs that never ended, usually a step whose guard was false and that nobody recorded
  `skipped`. Judged before `run-nodes-unfinished`. The message names each completed node and
  its unended needs, gives the patch that records the off-path ones `skipped` — send it through
  `write-state` as given — and names any node still on the path to run. Then run the verb again.
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

## Ending the run — the wrap-up

Under an absent or `terminal` driver a person reads the end: after `run-complete` succeeds, close
with one wrap-up message that fits one screen and is the last thing the run prints — six labelled
sections, in this order, and nothing else.

- **Done:** the outcome in plain words — completed, stopped at a named checkpoint with the
  option taken, or failed at a named phase — then, when the run filed standard candidates, the
  lines `run-complete` prints below its pointer, every one as printed;
- **Needs you:** each `open` risk still open, one line each — what is open and where to take
  it — or "nothing". Every `missing-artifact:` and `missing-companion:` line goes here too,
  restated as a file a named phase should have written and did not. Never ask a question
  here: the run has ended;
- **Follow-ups:** each `followup` risk, one line each, or "none";
- **Next:** every next step, one line each: the workflow's own as the real command with its
  real flags (`/maister:development --research=<task-dir>`), then the rest its closing node
  names. A command that repeats a person's text — the task, a question, a note — carries it
  exactly as they typed it, after the command and its flags: never inside quotes, never
  escaped, a text of several lines on the lines below the command;
- **Files:** the key files the run wrote, from the project root; anything long goes into a
  file in the task directory, named here;
- **Dashboard:** `<link>`, or none when the run has none. Nothing follows it.

Never show the raw `missing-artifact:`, `missing-companion:`, `run stopped:` or `RUN-` lines. A
child run driven in session runs `run-complete` with no wrap-up: its parent's walk goes on.

---

## Project configuration

An optional project-level config file at `.maister/config.yml` (sibling of `.maister/docs/` and `.maister/tasks/`) holds defaults that apply to every workflow. It is scaffolded by `/maister:init` but is not required — when absent, every key falls back to its default.

```yaml
# Maister project configuration.
html_output: true     # Generate the operator dashboard + HTML companion reports. false = markdown-only.
mockup_format: html   # UI mockups: html (pages and a gallery file) or ascii (ascii-mockup-generator), and nothing else; a turn reads it when no format is passed. A written scope is chosen per turn with `format: scope`, never here.
subagents: {…}        # Optional: the model and effort per subagent, per host (below).
project: {…}          # Optional: what the project is, for the reviewers (below).
workflows: {…}        # Optional: per workflow, its steps' HTML pages, its explainers and the gates it continues (below).
```

| Key | Default | Effect |
|-----|---------|--------|
| `html_output` | `true` | When `false`, workflows skip the dashboard AND the HTML companions (`references/grammar.md` § 3.2): no `dashboard.html`/`dashboard-data.js`, nothing opened in a browser, no `.html` companions. Markdown artifacts, their summary blocks (`orchestrator-patterns.md` § 7), and `orchestrator-state.yml` are produced regardless. |
| `mockup_format` | `html` | How UI mockups are rendered when a workflow generates them (development's `ui-mockups` node, product-design's `sketches` and `screens` nodes, standalone `/maister:mockup-studio`). `html` → the pages and version gallery a `mockup-studio` turn writes (`.html` files to open; no browser preview). `ascii` → the `ascii-mockup-generator` agent (no Node/browser). Takes only these two values: a written scope is chosen per turn, never here. Auto-falls back to `ascii` when Node.js is unavailable. Independent of `html_output` (mockups are design deliverables, not report companions). |
| `subagents` | maister's own table: the `light` rung on `effort: high`; `Explore`, `project-analyzer`, `task-classifier`, `test-suite-runner`, `html-companion-writer` and `question-reader` on `light`; `docs-operator` and `standards-scanner` on `{claude: inherit, copilot: standard}`; `task-group-implementer` on `choose: by-plan-tier` (all three rungs, `unassessed: standard`, `ceiling: {claude: deep, copilot: standard}`, no `budget`), except at the built-in fix loops (development's and performance's `verification`, migration's `issue-resolution`), where it takes `model: inherit`; every other agent on the host's choice | The model and effort each subagent is dispatched with, for Claude Code and for Copilot. `tiers` remaps the `light` / `standard` / `deep` ladder (a `claude` cell is an alias — `haiku`, `sonnet`, `opus`, `fable` — and a `copilot` cell a model id, `premium: true` on one billed above one request; `inherit`, in a cell or an entry's `model`, is the session's model); `presets` names model + effort pairs (an effort is `low` … `max`, or `inherit` to send none; an entry's own effort beats its rung's, and a project's rung cell keeps the shipped `high` on `light` unless it sets one); `default`, `agents` and `workflows.<w>[.nodes.<n>].agents` assign an entry — `tier`, `preset`, `model` + `effort`, or for `task-group-implementer` `choose: by-plan-tier` with `allowed`, `unassessed`, `ceiling` (a rung, or one per host) and `budget`. Order: the plan tier, then any entry naming the agent (profile, overlay, the project's step, workflow and agent scopes, maister's own table), then the defaults in that layer order, then the host — so a `default` covers only agents nobody names, and maister's own `light` picks hold until a project names those agents. Overlays and profiles carry the same key without `tiers`. `/maister:init` writes maister's own table out as a real block, its fix-loop node entries included — into a new `config.yml`, or appended to one without a `subagents` key, never over an existing block — with `Explore` on `standard` at high effort for a codebase over its file-count threshold, and presets, a `default`, another per-workflow entry and the implementer's `budget` as commented examples. The block governs the agent calls maister makes; the explore agents a host's own plan mode starts are outside it. The workflow engine's grammar (*Subagent models*) holds the full vocabulary and precedence. |
| `project` | none: every reviewer infers the profile from `.maister/docs/project/` | The project profile, so the reviewers check what applies to the project instead of a fixed web-service checklist. Every field optional: `kind` (`web-app`, `service`, `daemon`, `cli`, `library`, `plugin`, `desktop`, `mobile`, `data-pipeline`, `infra`), `runtime` (free text), `deploy` (`none`, `local`, `container`, `kubernetes`, `serverless`, `package-registry`, `app-store`), `exposure` (`local`, `internal`, `public`), `data` (the stores it writes; `[]` for none), `scale` (`single-user`, `team`, `multi-tenant`), `ui` (`none`, `web`, `tui`, `native`). A field left out rules no check out. `/maister:init` fills it in from its project analysis and writes it only when the file has no `project:` key, the fields it could not settle commented out. What each field rules out, and how the code reviewer, the production-readiness checker and the pragmatic reviewer split a safeguard's absence from its presence: `implementation-verifier/references/review-findings.md` § The project profile. |
| `workflows` | none | Per workflow name: `html_companions` (a step's list of artifact keys, `[]` for no page; the last layer over the definition, its overlays and the profile, `references/grammar.md` § 12), `explainers` (a step that declares an explainer page — an artifact whose path ends in `-explainer.html` — mapped to `false` to turn that page off: the step's `explainer:` line then reads `off` and the step records it absent with the config's reason; `true`, the default, keeps it) and `auto_continue` (gate ids the run continues without asking, recorded `by: config`; only a gate with one plain continue that grants nothing, `references/gates.md` § *A gate the project's config continues*). |

**How it is read**: once per run, into state, so a resume is consistent and an edit of the file reaches the next run, never one under way; every later reader reads state, not the file. The freeze fills `orchestrator.options.html_output` and `orchestrator.options.mockup_format` from the file when the patch sends none (`true` and `html` when the file or the key is absent; any `mockup_format` other than `html` or `ascii` is recorded `html`, with a warning) — § *What the freeze write adds*. `subagents` is read by the engine's freeze instead: it judges the block, folds in the overlays' and the profile's, and records the result as `orchestrator.options.subagents`, which `dispatch-model` and the `runs:` line of a node's brief read (`references/verbs.md` § *Model and effort on every agent call*). A block with an error is refused whole, with a warning, and maister's own table applies; an edit of the file reaches the next run, never one under way. `project` is read by the freeze too: a field with a bad value is a warning and is left out, never a refusal, and the profile is recorded as `orchestrator.options.project`, which `review-brief` copies into each cycle's brief as `profile` with `source: config`. A run frozen with no profile hands its reviewers `source: none`, and each infers the profile from the project's docs. `/maister:run --check` judges the key the same way. `workflows` is read by the freeze for the run's own workflow name: the entry is judged against the definition folded with the overlays and the profile, each bad entry (an unknown step or gate, a gate that grants or offers more than one plain continue, an explainer entry on a step that declares no explainer page, a malformed value) is a `workflows-config:` warning and dropped, and what survives is recorded as `orchestrator.options.workflow_config`, which every companion check, `node-brief` and the dashboard read. `--check` reports the same warnings, and an entry naming no workflow.

## The common fields

The keys every run's `orchestrator` and `task` blocks carry, and who writes each. Nothing marked
the writer's is ever sent: the writer drops it with a `note:` line (the opening section).

- `orchestrator.started_phase`, `completed_phases`, `failed_phases` — derived by the writer from `workflow.nodes` on every write.
- `orchestrator.created`, `updated`, `task_path`, `policy_hash` — the freeze's, `updated` restamped on every status change (§ *What the freeze write adds*).
- `orchestrator.options` — an open map merged key by key: `sequential` (set by `--sequential`, read by the implementation loop), `html_output` and `mockup_format` (§ *Project configuration*), `inputs` and `ceiling` (the freeze patch, engine Step 4), `subagents`, `project`, `workflow_config` and `delegation` (recorded by the freeze), and each workflow's own keys (its guide).
- `orchestrator.driver` — who drives the run, absent meaning terminal, written whole (the opening section).
- `orchestrator.classes_questions` — the writer's, recorded at the freeze (§ *What the freeze write adds*).
- `orchestrator.gate_pending` — the suspended gate's marker, set and cleared only as `references/gates.md` § *Driver-suspended mode — the write order* says.
- `orchestrator.parent` — a child run's link to its parent, sent by its freeze (`references/sub-runs.md` § *Walk one*).
- `task.title`, `task.description`, `task.key` — the freeze patch (engine Step 4). These and every value under `orchestrator.options.inputs` are a person's words: send them exactly as the person wrote them. The writer stores them as given, with quotes, apostrophes, backslashes, brackets and line breaks, and never refuses one, so never reword them.
- `task.status` — the writer's at the freeze, then the closing patch's (the opening section).
- `task.base_commit` — the writer's, recorded at the freeze and moved only by `move-base`.

## The verification block

Every workflow with a verification node uses:

```yaml
verification_context:
  last_status: passed | passed_with_issues | failed | null
  suite_run: passed | failed | skipped | not_run  # whether the cycle's full test suite ran; absent: not recorded
  issues_found: []           # [{id, severity, source, description, fixable, risky, fixed}]
  fixes_applied: []
  decisions_made: []
  reverify_count: 0          # re-checks run; two run without asking
  reviews: {chosen: [], done: []}  # the reviews dispatched this cycle and those returned, by short name
  cycle: 1                   # the cycle under way, the review brief's number
  snapshot: null             # the brief's tree id for that cycle
  node: verification         # the node and its attempt that ran the cycle, so a re-dispatch
  attempt: 1                 #   tells a crash in this attempt from a new attempt
```

Whoever runs the loop writes this block: the verification runner when the run nests, the main
session otherwise.

**`suite_run` says whether the full test suite ran in the cycle**, written on every cycle so its
absence never reads as a run: `passed` — it ran and passed; `failed` — it ran and tests failed,
the base's failures included (the verdict tells them apart); `skipped` — it did not run again
because the implementation phase's full run passed and no fix has changed code since
(`skip_test_suite`); `not_run` — it did not run and no earlier run stands in. The cycle's entry
write sets `not_run`, and `findings-merge` records the cycle's value from the test suite's result.
A block without the key — a run recorded before it existed — is read as *not recorded*, never as
a suite that ran: the gate after verification then recommends no way on (`references/gates.md` §
*Before every gate — the gate brief*). The orchestrator's own writes around a runner are the node's start, its end and
the answers to the decisions the runner hands back.

The workflow engine's `findings-merge`, run with `--state` over the cycle's reviewer findings files (`implementation-verifier/references/review-findings.md`), records `issues_found` in the state itself, so the numbering and the shape below are kept in code. Record every issue in `issues_found` as an object, never as a bare string: `severity` is `critical`, `warning` or `info` as the report graded it, `id` is the report's own number for the finding — kept across re-checks, a new finding taking the next unused number — `risky` is the verifier's grading of whether its fix would reach beyond the item, and `fixed: true` marks one fixed since (keep its original severity). The dashboard shows each issue under its `severity`. A string carries no severity field, so its severity has to be guessed from the text.

## A missing or stale companion

**Registration.** A node's summary registers each companion as `artifacts[].html` beside its
`path`, so the dashboard links HTML first with md fallback (`html: null` when companions are
disabled). `write-state` fills it from disk when the summary is written. **A companion never
blocks**: one that fails never fails the node or the workflow — keep the md, name the miss,
continue.

**Recovery on `companion-missing:`.** When a node completes without a companion it owes, `write-state` prints `companion-missing: <node> <path>` after its changed paths. Then:
1. Run html-companion-writer once for that file, on the model and effort `dispatch-model` prints
   for it (`references/verbs.md` § *Model and effort on every agent call*), pasting
   `run-context --node=<node>` so it gets `html:`.
2. When the node already has a summary, re-send `{"node_summaries":{"<node>":{}}}` to register the companion. When it has none, the summary's own write — still owed — registers it; never send the empty summary then.
3. Never re-run the node. A `failed` result is left for `run-complete` to report (the engine's
   *Operator visibility*).

**Recovery on `companion-stale:`.** A page goes stale when a later step edits an earlier step's markdown — an audit applying its fixes to the specification. The next write that completes a node prints `companion-stale: <node> <path>` for each owed page older than its markdown, and `gate-brief` warns of one its checkpoint names. Run html-companion-writer once for that file, as above, before the next checkpoint is asked; its registration already stands, so no summary is re-sent.
