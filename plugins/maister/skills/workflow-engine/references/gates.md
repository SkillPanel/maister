# Gates

The workflow engine's rules for asking a gate. `gate-brief` names *Before every gate — the gate
brief*, and `gate-revise` names *Revising at a gate*.

A gate node is a question with a closed set of options, at least one of which continues the
run. A gate with several continues tells them apart by the gate values each one sets, which a
later guard reads, and may offer no stop when one of them is the way to the end (grammar § 6). What the engine does with it follows the run's driver, and nothing else:

| `orchestrator.driver.kind` | The gate is |
|---|---|
| absent, or `terminal` | asked in session and answered in the same turn |
| `cockpit`, `dispatch` | written to a request file; the run suspends and a later turn answers it |

Decide which of the two applies once, when the run starts, from the driver block the state
file already carries. A gate never changes mode partway through a run.

A continue option may declare `grants` — what answering it authorises beyond the run, such as
pushing the branch and opening the pull request (grammar § 6). Every picker label and the
checkpoint's `grants` show it, and the node after the gate acts on it without asking again; the
engine itself grants nothing and pushes nothing.

A continue option may declare `sets` — the gate values its answer records, such as whether an
optional audit runs next (grammar § 6). This is how a gate decides an optional step in the same
question that approves the work before it, so the step itself asks nothing. The writer records
the chosen option's values on the gate from its recorded answer, on every write once the gate is
completed — the empty write that re-publishes a driven answer included — and a guard downstream
reads them like any node's. A gate's values are the writer's alone: never send `values` for a gate.

**Who answered, and how much a person had to see, is recorded with the answer — by the writer.
Send the answer only**: never compose provenance stamps, triage, settlement or approval items.
- **Provenance.** An answer may carry `actor`, `on_behalf_of`, `policy`, `evidence` and
  `override_of`; the writer copies each one supplied onto the answer's decision item, and a
  driven answer's from the request file's answer block. An answer given at the terminal gains
  `actor: {kind: person, id: <answered_by>}`. The five keys are record-only: `prior-context`
  never prints them.
- **Triage**, under a policy that classifies the gate (engine Step 4) and whose hash is the run's
  recorded `policy_hash`: the writer adds `triage` to the answer item, and right after it one
  settlement item per value the chosen continue `sets`; the gate's answer is still its last
  decision with an `option`.
- **Approvals.** A continue at a gate — or at `held-approval` — while choices are held for
  approval (`references/in-node-questions.md` § *When the policy classes a question*) approves
  every one of them: the writer records one approval item per held choice. A held question with
  no choice taken (`no_choice: true`) is never approved by a continue: it stays held until a
  revise of its step supplies the choice in its note. A revise or a stop approves nothing.
  Approvals are history: no later write and no revise removes them.

## Before every gate — the gate brief

What a gate asks is built by the engine, never written by hand. The engine reads it from the summaries the closing nodes wrote, so what those summaries say is what the user decides on.

- **Every node a gate needs writes a non-empty `summary`** in its closing `node_summaries`
  entry, in the same patch that marks it `completed`. The fields beside it — `headline`,
  `decisions` and their `by`, `fixes_applied`, `risks` and their tags — mean what the summary
  contract says (`orchestrator-patterns.md` § 4, *Shared: phase_summaries entry shape*), and
  every one is written for the user, by engine § *Speaking to the user*. What the gate adds:
  - **`headline`**, at most 220 characters, opens the checkpoint as *Done*; without it, *Done*
    is the summary's first sentence.
  - **Nothing earlier is restated.** Before writing `decisions` and `risks`, read what
    `prior-context` prints and leave out each decision or risk an earlier node already holds,
    including an artifact's own Key Decisions that carry an earlier choice forward. A node that
    builds on an earlier answer says so in `summary`; a node that settles an earlier risk
    retags it `resolved` on the node that raised it.
  - **Only `open` and `stop` risks become a revise's suggested notes**, so give each its
    `change`: `{risk: "list(null) now throws", tag: open, change: "keep list(null) returning
    every note"}`.
  - **`artifacts`** may carry a `role`: `primary`, `review`, `evidence` or `log`. Evidence and
    logs are never offered for review. A node may add `metrics`, a list of
    `{label, value, unit?, of?}`.
  - **`recommends`** — on a node closed by a gate with several continues, the one this node
    recommends and why: `{option: <continue option id>, reason: "<one line>"}`. It keeps every
    stated criterion, as an in-node recommendation does (`references/in-node-questions.md`
    § *In-node questions*). Without it the continue that turns the most steps on is
    recommended, and a `stop` risk still recommends stopping on a gate that offers a stop.

  Items written as strings are still read (`open:`, `tradeoff:`, `followup:`, `left for later:`,
  `recommend stop:` prefixes; untagged reads as `open`); write new items typed. The writer
  refuses an unknown `by`, tag or role, a fix naming neither its finding nor its change, or a
  `recommends` that is not a continue of a gate waiting on this node or lacks a one-line reason,
  with `state-summary-item-invalid`. The node prose's "Gate brief content" paragraph names what
  belongs in each field.
- **Every answer the user gives inside a node is recorded** on that node's summary, one
  decision per answered question:
  `{decision, by: operator, question_id, question, answer, recommended, as_recommended}`.
  `recommended` is the text of the recommended answer, and `as_recommended` says whether the
  user took it. `question_id` names the question, never its page or tab group. Never write
  `answered_by` or `via`: the writer stamps both. A driver's answers are folded into the same
  shape by the writer; a question nobody could ask is recorded `by: default`
  (`references/in-node-questions.md` § *When nobody can be asked*). Choosing More details, or
  typing "details", is never recorded.
- **Run `gate-brief --state=<state> --node=<gate>` in its own call** — with `--json --picker=rich`
  when the gate is asked in session, with `--request` when a driver suspends on it — and only
  after the closing write (the patch carrying the node's summary and its `completed` status)
  has returned successfully. Never issue the two in parallel: a brief that reads the state
  before the write lands is refused for a summary that is about to exist. Its output is what the
  user is asked. Never write a gate question by hand.
- **`gate-brief-no-summary` or `gate-brief-value-missing`**: send the patch the message names
  through `write-state`, then run the verb again. The value-missing patch carries the node's
  whole `values` map, because a node's values are replaced whole on patch. A missing gate value
  names no patch: record that gate's answer again — the gate `completed`, the chosen option
  under its `decisions` — and the writer records the values the option sets.
- **`gate-brief-unknown-node` or `gate-brief-not-a-gate`**: the `--node` argument is wrong;
  correct it. Nothing is written. A question a node asks inside itself is not a gate: it is
  briefed from its question set (`references/in-node-questions.md` § *In-node questions*).
- **`gate-brief-reask-not-revise`**: `--reask` names an option that is not one of the gate's
  revise options it still offers; the message lists them. Nothing is written. Correct it to the
  revise option the answer named; when that option is gone because the gate reached its ceiling
  of ten, ask the gate again without `--reask`, with its continue and stop options.
- **`gate-brief-questions-unsupported`**: a question set was sent, but the run's driver carries
  none — only a cockpit whose features list `question-sets` does. Nothing is written. Do not
  suspend: in a terminal run ask the questions in session; under any other driver take the
  default the node prose names and record it `by: default`.
- **`gate-brief-not-askable`**: the question set names a gate, which is asked from its own
  brief, or a node that is not `running`, which has nothing to ask. Nothing is written. Name the
  node that is asking, or brief the gate without `--patch-file`. For `--node=held-approval` it
  means another node is still owed — the message names it — or a question set was sent with it:
  finish the owed nodes first and ask the closing checkpoint from the closing node, before its
  close-out, without `--patch-file`. For a gate while a held question has no choice yet, it means
  the gate offers no revise that re-runs any such question's step: answer the checkpoint the message
  names first — another reached gate whose revise does, else `--node=held-approval` — and revise
  the step there with the choice in your note.
- **`gate-brief-questions-invalid`**: the set itself is wrong — empty, an id missing or used
  twice, a question with fewer than two options, an option without a label, an option with the
  id `other` (reserved for an answer in the operator's own words), two recommended in a single choice, a `default` naming no option, or a key the set does not have. The message
  names the question and the field. Nothing is written. Correct the question set in the patch
  file and run the verb again. It also refuses a set lacking an id the classing write left to
  ask: send the same set the writer classed.
- **`gate-brief-nothing-to-ask`**: the writer settled every question in the set (`references/in-node-questions.md` § *When the policy
  classes a question*). Nothing was written and nothing is asked. Carry on with the node: the
  settled answers are on its summary.
- **`gate-brief-nothing-held`**: `--node=held-approval`, and nothing is held for approval. Nothing
  was written. Publish the close-out when the run is dispatched, write the closing patch and run
  `run-complete`.
- **`gate-brief-no-graph`**: the definition cannot be read, the freeze recorded no needs and no
  node carries a summary. No write fixes it: relay the message and ask the gate with its `ask:`
  alone.
- **A `gate-brief-graph-drift` warning** means the definition changed since the freeze. Relay
  the warning as it is. The brief still renders, *Next* says the next node is unknown, and the
  gate is still asked. A `gate-brief-needs-unknown` warning beside it says the summary is the
  nearest recorded one, because what the gate closes is unknown; relay it too.

**The checkpoint covers the whole stretch the gate closes**: every node the gate needs and every
other node back to the previous gate that recorded a summary, an overlay's included, their
decisions and risks pooled and tagged with the node that recorded them. A `stop` risk from any
of them makes the stop option the recommended one. A summary further back never stands in for
the closing node's own, and neither does a skipped node: without one, the brief is refused
`gate-brief-no-summary` — unless a held choice is why the gate is asked (engine § *The ready set*), when
its *Done* reads `Skipped.` and the held choices lead.

**What the checkpoint shows is the verb's to compose.** The one-line ask (`<what finished> Ready
to go on?`, about the work approved, never where the run goes), the glance each continue
previews — *Done*, *Next*, *Review*, open risks, fixes, decisions and the user's own choices —
the revise and stop previews, More details, and the held choices, which lead every surface
whenever one waits, are all selected, ordered and trimmed by `gate-brief`. Relay them as they
stand; never re-select, re-order or re-word them.

## The `gate-brief` forms

`gate-brief --state=<state> --node=<gate>` takes at most one form flag; with `--node` naming a
running node and `--patch-file`, it briefs that node's question set instead.

Every form reads the run and writes no state: its one write is the run's `display/next.json`,
the panel an editor extension draws above the question. With no form, the brief as text, within
1,600 characters — the trailing `rules:` line the verb adds sits outside that budget.

`--checkpoint` prints the **checkpoint**, the one structured object every other form projects
from, as JSON: `{version, kind, node, header, ask, headline, progress, next, review, closed,
fixes, held?, decisions, risks, recommended, options, grants, approves, run, truncated}` —
`held` present only when a choice waits for approval, `decisions` grouped by who settled them,
`risks` by tag, and each option carrying its `consequence` (a continue that sets gate values
also its `sets` and `next`, a revise its `reruns`, `revision` and `suggestions`, a stop its
`keeps` and `not_run`).

`--json` returns the in-session picker projected from it: `{ok, picker, question, header,
options[{id, label, description, recommended, preview}], details, more_details, errors,
warnings}`. The recommended option comes first, its label already marked `(Recommended)`. The
`rich` profile's question is the one-line ask and every option has a `preview`; the `plain`
profile's question is the glance followed by the ask, its header the title of the step the
gate closes, and its option labels carry their consequence. Both end with the More details
option — `{id: "more-details", details: true}`, never an answer — while the tool has a slot
free (`details: "option"`); otherwise the question ends `Type "details" for the full brief.`
(`details: "typed"`). `more_details` is the full brief. A revise option adds `note: true`,
`reruns`, `revision`, `suggestions[{label, description, note, recommended}]` — none of them
recommended — and `note_question`, the note question built for the profile: `{header,
question, multi_select, options}`, its `options` empty when there are fewer than two
suggestions, its question then asking for the note typed.

`--request` prints the whole driven gate request as JSON: `{node, kind, question, context:
{summary, artifacts, checkpoint}, options, multi_select}`, ending with `triage` when the applied
policy classes the gate and its hash is the run's `policy_hash`, each revise suggestion as
`{label, note, recommended}`; with `--reask=<revise option>` its question opens with a sentence
saying that option needs a note, every option still offered — the request a driven revise that
came without its note is asked again with (*Revising at a gate*), never beside `--patch-file`.
`--oneline` is that request's one-line summary, within the same budget.

With a question set (`references/in-node-questions.md` § *In-node questions*), `--checkpoint`
prints a `kind: question` checkpoint and `--request` a `kind: question` request whose question
and options repeat the first question's, with every question under `questions`, each folded to
one line with no `"`; the patch file is read and kept, for the request to be written over it.

`--node=held-approval` briefs the run's closing checkpoint, in every form (engine § *The ready
set*). When the asking node recorded `asking` (`references/in-node-questions.md` § *When the
policy classes a question*), a question set's `--checkpoint` and `--request` carry only those
questions.

## Terminal mode — asked and answered in one turn

1. **Asks it in session** with `AskUserQuestion`, built from `gate-brief --json`. **What you
   write before it is one lead-in line at most** ("The specification is ready."), never a brief
   of your own. The picker carries everything the user needs: the ask, the glance, what each
   option does, and the full brief one More details away. A second brief written above it only
   repeats what the user is about to read.

   **The picker is built field by field, never by hand.** `question` is the question, verbatim.
   `header` is the header. `options` are the options, in the order given, each shown by its
   `label` exactly as given — the recommended one first, already reading `(Recommended)`.
<!-- rich-picker -->
   Pass each option's `description`, and each option's `preview` as that option's preview, as
   given. Each continue option's preview is the glance; revise, stop and More details preview what
   choosing them does. Claude Code shows a preview beside the options while that option is
   focused, and shows no descriptions once any option has a preview.

   > **SELF-CHECK before the `AskUserQuestion` call** (the gate SELF-CHECK): is the question the
   > one line given, and is every option's preview passed as given, unshortened? Is what you wrote
   > before it one line at most? If not, STOP and fix the call. Then ask.
<!-- /rich-picker -->
<!-- plain-picker
   The question tool takes a message and a form rather than these fields by name. Pass
   `question` whole as the `message`, verbatim: never reworded, shortened or moved into the
   form, even after More details has written the brief out. Its last line is the ask, so the ask
   stays on screen while the user decides. The form has one property, titled by `header`, whose
   choices are the options in the order given — each option's `id` as the value and its `label`
   as the title, which already says what the option does — with the recommended one as the
   default. After More details, the gate is asked again with the same `question`, verbatim, as
   the `message`.

   > **SELF-CHECK before the `AskUserQuestion` call** (the gate SELF-CHECK): is the `message`
   > you pass exactly `question`, every line through the ask? Is what you wrote before it one
   > line at most? If you shortened, reworded or split it, STOP and pass it whole. Then ask.
-->

   Where the picker has no header or no description, leave them out; the labels still carry the
   choice. The recorded answer is the chosen option's `id`, never its label. **The
   `more-details` option is never recorded**: it is the More details request (`references/in-node-questions.md` § *In-node
   questions*), and the writer refuses it as an answer.
<!-- rich-picker -->
   Its preview already shows the full brief, so ask this gate again at once, with the same
   picker, in the same turn. Before it, write at most one line saying the full brief is in the
   More details preview — never a paraphrase or a summary of it, which only repeats what the
   user can read there, less exactly.
<!-- /rich-picker -->
<!-- plain-picker
   Write `more_details` out as your message, as given, then ask this gate again with the same
   picker, in the same turn.
-->
   When `details` is `typed`, the question already asks the user to type "details", and a
   typed "details" is the same request, answered by writing `more_details` out as given, since
   no option previews it. When `options` is empty — the definition changed and no longer holds the
   gate — ask with the gate's own option ids, and More details after them.
2. **Records the answer** as one item of the gate's `decisions`, `{option: <the chosen id>}`,
   and marks the node `completed`, in one write. That is the one shape of a gate answer: never a
   flat `answer:` on the summary, which the writer folds into this item anyway. The writer adds
   the option's label as `decision`, `by: operator`, and the person's name as `answered_by`
   with `via` the run's driver kind under a `cockpit` or `dispatch` driver, `terminal` otherwise. When the chosen continue sets gate values, the writer records them on
   the gate's entry in the same write; a `values` sent for a gate is refused
   `state-gate-values-sent`. A revise option — its `note` is `true` — is
   recorded by `gate-revise` instead, after its note is asked at once (*Revising at a gate*). The option is one of the gate's own ids, spelled as
   the gate spells it. The writer refuses any other with `state-gate-option-unknown`.
3. **Writes no `gate_pending` and no gate request file.** The pending marker is only ever
   written as the one-line null form.

Terminal mode is exactly this and nothing more: no request file is written, no
`GATE-PENDING` line is printed, and `gate_pending` never holds anything but the literal
`null`, since nothing is awaited across turns. A request file without a marker would be a
gate nothing enforces.

**A pending gate in another run can still stop this one.** Where pending gates are enforced,
a write may be refused naming a different, abandoned run. The operator clears it by
**answering** it (resuming that run) or **removing** it (deleting the dead task directory, or
its request file and pending marker). Do neither on the operator's behalf: report the
offending path and let the operator choose.

## Driver-suspended mode — the write order

With `driver.kind` `cockpit` or `dispatch` the engine does not ask. It suspends, in this
order, and the order is the contract:

1. **Every dispatch envelope, ledger and outbox write for the current ready set completes
   first** — before the request file exists and before the pending marker is set.
2. `workflow.mjs gate-request --state=<state>` writes `gates/<node>.request.yml` through a
   temp file and a rename, regenerates `gates/index.yml`, and then sets
   `orchestrator.gate_pending` to `{node, request, since}` **and** the node's `status` to
   `suspended` through the state writer — one invocation, three writes, in that order. The
   request document arrives in the patch file as JSON, written before the call, while nothing
   is pending yet. **That document is `gate-brief --request` output, as it stands.** Write the
   verb's stdout into the patch file, unchanged; compose nothing and edit nothing in it.
   **There is no second call here, and there must not be**: the run is pending from the moment
   the request file lands, and while the gate is pending the engine's shell calls cannot run.
   **When `gate-request` answers `gate-request-unavailable`, this edition carries no gate
   module and the run cannot suspend:** stop with `RUN-FAILED: gate-request-unavailable` —
   never ask in session and never take a default answer.
3. `GATE-PENDING: <node>` is printed as the **last** line of the turn.
4. The turn ends. Nothing polls, nothing waits, no session is left idle.

**A running node suspends on a question set the same way** (`references/in-node-questions.md` § *In-node questions*): the node
writes its set to the patch file, `gate-brief --request` reads it from there and prints a
`kind: question` request, that output is written over the patch file unchanged, and
`gate-request` takes it. The node is `suspended` while the operator answers, exactly as a gate
is.

**Step 1 is the whole mechanism.** While a gate is pending, only the files the answer is
recorded into can be written, so every write the run needs happens before step 2 — a write
belonging to a *different* run can be held back too (the cross-run case above). The run is
suspended the moment step 2's marker publishes. **The commit point is `gate_pending` back to
`null`, and that is written on resume, not here.**

**A sub-run suspends on the same shape**: the child freeze (W2) and the parent's record of the
link (W3) both complete **before** the write that projects the dashboard and before
`WAITING-SUBRUN` is printed (`references/sub-runs.md` carries both walks).

**The `gate-request` verb** derives everything from `--state` — the run directory, the `gates/`
directory and the frozen graph the node id is checked against. Send `{node, kind, question,
context?, options[], the multi-choice flag, run_id?}`; the verb supplies `version`, `asked_at`
and `answer: null` itself and **refuses a caller that sends any of the three**. `since` is the
request's own `asked_at`. Its own five refusals are `gate-request-unavailable` (above),
`gate-request-invalid` (fix the document and re-run), `gate-request-exists` (a *different* gate
has already been asked at that node — read the file rather than re-asking), `gate-unwritable`
and `gate-temp-exists` (handled exactly like `state-unwritable` and `state-temp-exists` in
`references/writing-state.md` § *When a write is refused*). Because the marker rides along, the
verb may also return any refusal `write-state` names, verbatim and with its own code.

**A refusal leaves the run unsuspended.** If anything after the request file refuses, the
request file this call published is removed and the index regenerated without it, so the same
call can be re-issued. A re-issue that finds its own identical, still-unanswered request file —
the shape a kill in that window leaves — adopts it and finishes the marker. A file that is
answered, or that spells a different question, still refuses.

## Driver-suspended mode — resume

A resume always arrives as a first line in one of five shapes — `GATE-ANSWER`, `RE-DRIVE`,
`STEER`, `RESUME` or `SUB-RUN-DONE` — and **all five end with `at=<timestamp>`**. That stamp is the turn's
measured time and the only one the engine has: never read a clock of your own or reuse an
earlier turn's time. Record it as the `at` of the decision the turn writes, on a re-drive and a
steer no less than on an answer. A first line with no `at=` is below the contract: print
`RUN-FAILED: prompt-line-unstamped`, write nothing, and leave the run where it was.

**None of the five carries the run's inputs.** A resumed driver reads those off
`orchestrator.options.inputs`, which the freeze wrote (engine Step 4); never re-derive one from
the line, the directory name or a task description.

**The fifth shape wakes a parent whose sub-run has ended**, and its grammar is total:

```
SUB-RUN-DONE run=<parent-run> node=<node> child=<child-run> status=<completed|failed|stopped> at=<ts>
```

Every field is required, appears exactly once, and the order is fixed with **`at=` last**; a sixth
field is a malformed line. `run=` and `child=` carry an opaque run token, `\S+` — a
task-directory basename or a daemon's colon address — so **the match rule is to compare the
token's last colon-separated segment** against the run's task-directory basename and against
the node's recorded `values.run_id`; a token with no colon is its own last segment.

A malformed line, a `run=` or `node=` that is not this run's, or a `child=` that is not the
recorded one, all print `SUB-RUN-INVALID: <reason>` and write nothing — the reason names the field
at fault in that field's own spelling (`references/sub-runs.md`); a `node=` that is no longer
`waiting` prints `SUB-RUN-ALREADY-DONE` and writes nothing. A missing `at=` falls to the rule
above.

**The disk wins, always.** `status=` is a hint about why the parent was woken; the child's
`task.status` is the outcome, and when they disagree the state decides and the line is ignored.
A parent woken `completed` by a child still running stays waiting; a parent woken `failed` by a
child that completed completes. A re-drive carrying no `SUB-RUN-DONE` at all reaches the same
waiting node and takes the same path.

While the gate is pending, the engine's shell calls cannot run, so the decision is recorded with
editor tools, on the files this step writes and no others — the one sanctioned exception to
"never edit state with an editor tool", lasting exactly until the marker is null and ending with
an immediate re-validation through the writer.

1. Read the request file and the state with read-only tools; those are answered before any
   state is read.
2. Validate the answer against the request's own option ids. Not one of them → print
   `GATE-INVALID: <reason>`, write nothing, stay suspended.
3. `gate_pending` already `null` → print `GATE-ALREADY-ANSWERED`, write nothing. A gate is
   answered once.
4. Otherwise record, **in this order**: the `answer:` block in `gates/<node>.request.yml` —
   the answer file's `answer` block copied whole, **less `grants`**, which never lands in a
   request's answer — then `node_summaries.<node>` and the node's `status: completed`, then
   **`gate_pending: null` last** — clearing the marker first would end the suspension before
   the decision was recorded.
5. The very next action is `write-state --state=<state>` with the empty patch, `{}`, as the
   patch file's body (engine § *The invocation contract*). It is not a no-op: the writer reads
   back the file the editor tools wrote, self-checks it and re-publishes it, recording what the
   answer implies — the gate's values, the provenance keys copied from the request's answer
   block, and under a classifying policy the triage and settlement items — and regenerating
   `gates/index.yml`. None of that is drift.
6. A refusal at step 5 is `RUN-FAILED: <code>`, reported verbatim, and the run stops there:
   the operator repairs the directory or starts a new task. **Never repair the state file to get
   past it** — editing further with the same tools compounds the drift.

**A question set answered.** A `GATE-ANSWER` for a node that asked a question set is folded
the same way, with three differences, because the node has not finished — it asked from inside
its work:

1. **Validate every question, not one option.** The answer file beside the request
   (`gates/<node>.answer.<operator>.yml`) carries `answer.answers`: each question's id mapped to
   an option id, a list of option ids for a multi-select question, or `{other: "<text>"}` where
   the question takes the operator's own words. The first question falls back to
   `answer.option`, which is what the `GATE-ANSWER` line carries. A question with no answer, an
   id the question does not offer, a list for a single choice, or own words where they are not
   taken → `GATE-INVALID: <reason>`, nothing written, still suspended.
2. **Record, in this order:** the answer block, whole **less `grants`**, in
   `gates/<node>.request.yml`; then the node's `status` back to **`running`** — never
   `completed`; then `gate_pending: null` last. Then the empty-patch re-validation, as in step 5.
3. **Then record the answers through the writer**: send
   `{"node_summaries": {"<node>": {"answer": <the answer block, whole>}}}`, the block copied
   from the answer file as it stands. The writer reads the questions from the node's request
   file and records one `by: operator` decision per question, never its `grants`. Compose none
   of it. Then continue the node from what it wrote to disk before it asked.

A refusal at step 3 is `state-question-answer-invalid` (`references/writing-state.md` § *When a write is refused*).

**`held-approval` answered.** A `GATE-ANSWER` at the closing checkpoint is folded as a gate's
answer, its status written `completed`. The suspend left the closing node `running`, and a
running node is never in the ready set, so do not take the ready set first:
- after a continue — the empty-patch re-validation records the approvals — or a stop, carry on
  with the closing node at its close-out step (engine § *Ending a dispatched run*);
- after a revise, run `gate-revise --node=held-approval` with the note, as *Revising at a gate*
  says; it resets the stretch, the closing node included, and then the ready set is taken.
  `resume-check` reports such a revise `applied: false` until it has run.

## Choosing a stop option

A stop option ends the run, and ends it completely:

- `task.status` becomes `stopped`;
- **every unexecuted node is recorded `stopped`**, the final node included;
- no further node executes, and no completion or summary node gets a courtesy run.

A stopped run is a legitimate outcome, not a failure. Do not print `RUN-FAILED` for one, and
never re-ask a gate the operator has already answered — a gate a revise reset is the one gate
asked again, because the operator asked for exactly that, and a driven revise that came without
its note is asked again for it (*Revising at a gate*).

## The closing checkpoint `held-approval`

When no checkpoint follows a held choice, the run raises one of its own before it closes, under
the held rule (engine § *The ready set*). `held-approval` is a reserved id, never a node of the
frozen graph, so no definition and no `graph_hash` changes. In a run that records
`classes_questions`, the closing node runs `gate-brief --node=held-approval` before its closing
patch and, under dispatch, before its close-out (engine § *Ending a dispatched run*):
- `gate-brief-nothing-held` — nothing waits: close the run as usual;
- otherwise it is asked like a gate, by the run's driver: in session with the picker, or suspended
  with `gate-request` — the writer accepts its `status` writes for exactly this. The brief
  composes its options: continue ("Approve and finish"), one `revise-<node>` per node holding a
  choice, and stop — and while a held question has no choice yet, no continue, the revise of its
  step recommended;
- its answer is one `{option}` item under `node_summaries.held-approval`. A continue records the
  approvals, then the closing patch follows; the writer refuses it
  `state-held-approval-not-askable` while the checkpoint is not askable, or under a driver unless
  this round's pending request answered continue. A revise goes through `gate-revise`
  (*Revising at a gate*); a stop ends the run — the closing patch records the closing node and
  `task.status` `stopped` — with the held choices unapproved.

It is askable once nothing is owed but the running closing node; earlier it is refused
`gate-brief-not-askable`, naming what is still owed. **One exception, the no-choice rule:** while
a held question has no choice yet, a reached checkpoint is asked only when one of its revises
re-runs a step holding one, recommending the revise that re-runs the most of them; another
reached checkpoint refuses `gate-brief-not-askable`, naming the one to ask. When no reached
checkpoint has such a revise — a sub-run ready to start after the step counts as one with none,
and the writer refuses to start it (`state-subrun-held-open`) — `held-approval` is asked at that
point instead, and its revise, with the choice in the note, re-runs the step and everything
after it.

## Revising at a gate

A revise option sends the run back: the stretch from the option's `reruns` node to the gate runs
again with the operator's note, and the gate is asked again once it has. The grammar's § 6 has
the rule; here is what the engine does with the answer.

**Terminal mode.** When the operator picks an option whose `note` is `true`, ask what should change
before writing anything, and ask it at once: the question is the very next call after the gate's
answer, built from the `gate-brief --json` output the gate was asked from. Everything it needs is
already there, so run no second `gate-brief`, read none of the stretch's artifacts, compose no
suggestions of your own and print nothing in between. Ask it multi-select, built field by field
from that option's `note_question` — its `header`, its `question`, and its `options` in the
order given, each by its `label` and, where it has one, its `description`. No suggestion is
recommended, marked `(Recommended)` or chosen in advance. The note is the chosen suggestions'
`note`s — `note_question.options` and `suggestions` are in the same order — joined by `; `,
then any text typed through Other. When `note_question.options` is empty, ask its `question` as
text, verbatim, and the reply is the note — a reply of "yes" sends the one suggestion's `note`.
When nothing is chosen and nothing typed, there is no note: ask the gate again from its brief.
Then write `{"note": "<the note>"}` to the patch file and run `gate-revise
--state=<state> --node=<gate> --option=<id> --patch-file=<the patch file>`. That one call is the
whole record — the answer, the note, the reset and the dashboard. Take the ready set from the
state again: the `reruns` node is the next to run, and its prompt carries the note through
`prior-context`.

**Driver-suspended mode.** The request's revise option carries `effect: revise`, `note: true` and
the `suggestions`, as `gate-brief --request` wrote them into the request. The answer's option id arrives on
`GATE-ANSWER` as any answer does; its note arrives on the answer file the driver writes beside the
request — `gates/<node>.answer.<operator>.yml`, under `answer.note`. Read it with the read-only
tools, fold the answer exactly as *Driver-suspended mode — resume* says, run the empty-patch
re-validation, then write `{"note", "answered_by", "at"}` — `at` the `GATE-ANSWER` stamp — to the
patch file and run `gate-revise`. It recognises the answer the fold recorded and completes it in
place. With no note on the answer file, the note is the first suggestion's, and the
decision carries `answered_by` from the line as usual.

**A driven revise with no note is asked again.** When the option offered no suggestion and the
answer file carries no note, or a blank one, there is nothing to send back with, and no note is
invented. The request was still answered, so fold it as one, minus the decision: record the
`answer:` block in the request file, then set the gate's `status: pending` and raise its `attempt`
by one — the same count a revise's reset raises — then write `gate_pending: null` last and run the
empty-patch re-validation. Write no `node_summaries` entry, no `completed` and no `gate-revise`:
nothing is recorded as a revise and nothing is reset. Then ask the same gate again by the driven
write order, from `gate-brief --request --reask=<the option id>`: a new request for the same node
in its next attempt — a gate asks once per attempt, which is why the attempt is raised.

**What a driver asks again, and with which flag.** A gate whose stretch a revise re-ran is asked
again with no flag; a node's question set a revise re-ran is asked again with `--patch-file`, as
in its first attempt — the verb refuses `--reask` beside it, and the fold keeps the earlier
attempt's answers as history (`references/in-node-questions.md` § *When a question suspends*).

**A revise is never recommended**, and a driver that defaults an answer never defaults to one.

**What the reset leaves.** Every node of the stretch is `pending` with its clocks and values gone
and its `attempt` one higher; a guarded node in it is judged again once the rerun node records
its values, and a gate in it is asked again. The summaries stay until the nodes re-complete and
rewrite them field by field, so the brief and the prior context still show what the previous
attempt found (`references/writing-state.md` § *Writing state*). The gate's decisions keep every
revise, and a later answer at the gate is added after them, never over them.

**A ceiling, not a budget.** A revise the user chooses is theirs to make as often as they want;
the engine holds only a safety ceiling of ten per gate, against a runaway loop. At the ceiling
the brief stops offering the option, leaving continue and stop; the verb refuses an eleventh.

**Resume.** A run caught between a driven fold and `gate-revise` — the gate `completed`, its last
decision a revise option without an `attempt` — is found by `resume-check`, whose `revision`
field says `applied: false`. Run `gate-revise` for it before anything else, with the note from the
answer file; do not walk the ready set first, or the run moves past the gate as if the answer
had been continue.

**For a held choice.** While choices are held for approval, a frozen gate offers, beside its own
options, one `revise-<node>` for each node holding a choice that sits behind it (in its needs
closure) and that none of its own revises already re-runs — its note required, never
recommended except under the no-choice rule (engine § *The ready set*). Its stretch, count and
ceiling are the gate's own; it is not offered at the ceiling, when its id is one of the gate's
own options, or when its stretch holds a sub-run that has started. `gate-revise
--node=<gate> --option=revise-<node>` applies it like any revise. It approves nothing; the other
held choices stay held for the next continue.

**At `held-approval`.** The closing checkpoint has a revise rule of its own: `revise-<node>` names a
node that holds a choice, and its stretch is that node and every frozen node downstream of it,
the closing node included, all reset in one write; a run already recorded `completed` goes back to
`in_progress`, and the checkpoint back to `pending`. Its revision count is the revises already
recorded on `node_summaries.held-approval`, plus one, against the same safety ceiling of ten. The note
reaches the re-run node through `prior-context`, as any revise's does. The refusals below hold
for it too: an option naming no node that holds a choice, the checkpoint not current — another
node still owed, or a driver's answer awaited on another gate — the safety ceiling reached, a stretch
holding a sub-run, a missing note.

| Refusal | Response |
|---|---|
| `revise-not-a-gate` | `--node` names no node of the run, or a node that is not a gate. Nothing was written. Correct `--node` to the gate the operator answered and run the verb again; no state write fixes this. |
| `revise-option-unknown` | `--option` is not one of the gate's revise options — its own, and a `revise-<node>` for a step holding a choice while it offers one (*For a held choice*); the message lists them. Nothing was written. Correct the id — the option's id, never its label. A continue or a stop is recorded as an ordinary answer (*Terminal mode*), not through this verb. |
| `revise-note-missing` | The patch file carries no note, an empty one, or an `at` that is not a UTC timestamp. Nothing was written and the patch file is kept. Put the note the operator gave — the chosen suggestions and anything typed — into it, send the answer's own stamp or no `at` at all, and run the verb again. |
| `revise-gate-not-current` | The gate is not the question the run is asking: something it waits on has not ended, it is already answered, a revise already reset it, or a driver's answer is still awaited. Nothing was written. Do not repeat the call; take the ready set from the state and ask the gate the run is actually at. A second call after a revise that landed is refused this way, which is what makes it safe. |
| `revise-budget-exhausted` | The gate has reached its safety ceiling of ten revisions: no revises are left at this checkpoint. Nothing was written. Ask it again with its continue and stop options only; the brief no longer offers the revise, and the user decides between going on and stopping. |
| `revise-stretch-has-subrun` | The stretch holds a `workflow:` node that has started, whose child run would be adopted rather than run again; one still `pending` or `skipped` has no child and is reset with the rest. Nothing was written. At a frozen gate, validation refuses such a definition, so a run reaching this was frozen from one edited by hand: ask the gate again with continue and stop, and report the message. At `held-approval`, the held choice came before a sub-run that has run: approve it or stop. |
| any `state-*` code | The reset reached the writer and was refused; the writer's table (`references/writing-state.md` § *When a write is refused*) says what each means. Nothing was written. |

`stopped` is not only a status for unexecuted nodes: a `workflow:` node whose child run stopped
ran, waited and adopted that outcome, so it is recorded `stopped` **with** a summary, mirrored to
`skipped` per engine § *Recording an outcome*. The unexecuted nodes carry none, which tells the two apart.
