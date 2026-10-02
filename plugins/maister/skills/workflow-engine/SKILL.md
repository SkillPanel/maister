---
name: maister:workflow-engine
description: Runs a workflow definition — a graph of nodes with declared needs, guards and outputs — as an orchestrated run. Loads a definition plus any overlays, freezes the resolved graph into task state, executes the ready set, asks gates in session or suspends on them according to the run's driver, and writes every state change through the workflow tooling. Machinery invoked by a workflow's own orchestrator, or by `/maister:run` for a workflow started by name; not a workflow a user starts directly.
user-invocable: false
---

# Workflow Engine

The execution half of the workflow grammar. A definition file says which nodes exist,
what each one needs, what guards it and what it declares; this skill turns that graph
into a run — one ready set at a time, with state written by a script rather than by a
model holding a file open.

**This is machinery, not a feature.** A user reaches a workflow through that workflow's
own command, whose orchestrator hands the run here with a workflow name — or, for a
workflow the project defines itself, through `/maister:run <name>`, which looks the name
up, validates it, gathers its inputs and hands the run here the same way. There is no
engine command and no engine entry point of its own — which is what
`user-invocable: false` in the frontmatter above says, so the declaration and this
paragraph cannot disagree. Nothing in a user's mental model needs the word "engine" in
it.

**The grammar a definition is written in** — its keys, the target schemes and how a
target resolves, gates, guards, interpolation, the prose companion and overlays — is
[`references/grammar.md`](references/grammar.md). This skill executes that grammar and
does not restate it.

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

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `AskUserQuestion` at a gate. They apply only to your discretionary clarifications. Invoke `AskUserQuestion` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.

### Step 1: Load framework patterns

Read `../orchestrator-framework/references/orchestrator-patterns.md` now. Delegation
rules, the state schema, initialization and resume, the artifact summary contract, the
dashboard and the companion reports all live there. This skill adds graph execution on
top of them and restates none of them.

### Step 2: Probe the runtime, before writing anything

Run `node --version` once. On failure, or on a version below 20, stop immediately, before any
task directory exists: print `RUN-FAILED: node-unavailable`. A terminal-driver run tells the
operator that this workflow needs Node.js 20 or newer, and that an install which cannot run it
stays on the 2.x line (`/plugin marketplace add SkillPanel/maister#release/2.x`, then
`/plugin install maister@maister-plugins-2x`). A dispatched worker reports `blocked` through the
outbox verb and stops. There is no second interpreter to hand the run to. Never run such a
workflow by hand.

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
both forms are accepted — `builtin:<name>` and `<name>` resolve to the same candidates
below. A prefix left on the name turns the lookup into a search for a file called
`builtin:<name>.yml`, which exists nowhere.

**The `locate` verb performs this lookup; run it rather than testing paths by hand.**
`locate --name=<name>` searches the homes below in their order and prints the
`--definition` and `--overlay` values `validate` and `resolve` take, so the file the run is
validated against is the file the lookup found — the same function `validate` uses for a
`workflow:` target. It searches `.maister/workflows/` in the current project root, then its
`generated/` subdirectory, then the built-ins shipped beside this file:

| Found | Meaning |
|---|---|
| `.maister/workflows/<name>.yml` | an **eject** — it shadows the built-in entirely |
| `.maister/workflows/generated/<name>.yml` | a **generated** chain — published by the chain planner for one ticket, complete in itself |
| `.maister/workflows/<name>.overlay.yml` | an **overlay** — merged over the built-in, and a hit only when that built-in exists |
| `workflows/<name>.yml` beside this skill | the shipped **built-in** |

Resolution order is eject → generated → overlay → built-in, and the first hit wins. A
generated chain is never overlaid and never ejected: there is no `generated/<name>.overlay.yml`
candidate, and a definition of the same name at the top of the directory would simply win —
which the planner's collision check prevents. An overlay for a name no built-in carries is not a
workflow: `locate` refuses the name, naming the overlay and the base it lacks. **An overlay beside an eject or a generated chain
of its name is never applied.** Say so to the operator when you find one, rather than letting
them believe it is in effect; `validate` reports the same fact as `overlay-ignored:<name>:<home>`. Its path is what the freeze records as
`workflow.source`, exactly as for an eject, and the graph hash is computed from the resolved
graph, never from the path, so where a chain lives changes nothing about the run.

**A run started by name arrives with more than a name.** `/maister:run` hands over the bare
name, the run's inputs as a map, the overlays, the profile and a title. Its overlays are the
lookup's own followed by any the operator named, in that order, and they and the profile go to
`validate`, `resolve` and the freeze exactly as given (Step 4); the inputs are the freeze's
`orchestrator.options.inputs`, and the title is `task.title`. It has already refused a chain and
validated the definition; both checks are cheap and are run again here regardless, with the same
overlays and profile.

**A run starts from a name the lookup resolves, never from a path.** A definition file kept
anywhere else is not a workflow this skill runs, and a definition whose resolved graph —
overlays and profile included — has a node carrying `dir:` is a chain, which dispatches into
member repositories and is started and driven by maister cockpit, never under an absent or
`terminal` driver. Authoring an eject or an overlay is not this
skill's business either.

### Step 4: Freeze the graph before executing anything

Three calls, in this order, before any node runs: `validate`, then `resolve`, then the
`write-state` that installs the resolved graph in `orchestrator-state.yml` as the `workflow:`
block with one line per node. A run executes the frozen graph, never the file on disk, so an
edit to a definition mid-run changes nothing until the next run.

**The run's task directory exists before the freeze**, because the state file the freeze writes
lives in it. It is `.maister/tasks/<type>/<YYYY-MM-DD-slug>/` under the project root, where
`<type>` is the workflow's name — the one rule for every workflow, a workflow started by name
included, with migration's `migrations/` the single exception — and the slug follows the
framework's task-name rule (`orchestrator-patterns.md` § 5), with `-2`, `-3` … appended when a
directory of that name already exists. The writer derives the project root from that depth, so
the directory sits exactly there and nowhere deeper. Create it once, on a first run, and record
its repository-relative path as `orchestrator.task_path` in the freeze; a resume keeps the
directory it has.

**`resolve` does not stand in for `validate`**, although it re-runs the same checks and refuses
the same errors. Only `validate` reports where each target was found and how many nodes and
gates the graph holds, and `resolve` drops both from its output. A run that skips `validate`
has frozen a graph whose skills and agents nobody has confirmed resolve to the files the
operator expects. The call is the same for every workflow, whichever orchestrator handed the
run over.

**The `workflow` block is `resolve`'s output, copied through.** `source`, `overlays`,
`profile`, `graph_hash` and `name` go into the freeze exactly as `resolve` printed them, beside
`grammar_version: 1`, and `nodes` carries one entry per node `resolve` printed and no other:
`kind: gate` for a gate, `kind: workflow` for a `workflow:` node and `kind: task` for every other
node, each `status: pending`. The writer fills in each node's `needs` from the graph itself, and
on a gate that offers a revise its `reruns` — where each revise option sends the run. Copy
`graph_hash` without reformatting it: it arrives in the spelling the state block accepts, and
adding a prefix it already has, or stripping the one it needs, produces a run whose recorded
identity no longer matches the graph it is running. The overlays and the profile are the ones
the run was resolved with; an overlay left out of the freeze describes a graph the run does not
have.

**The writer proves the freeze before it installs it**, because the freeze is written once and
every reader lays the run out from it. It re-resolves the recorded `source`, `overlays` and
`profile` from the run's own project root, and writes nothing when the result does not hash to
the recorded `graph_hash` (`state-freeze-unproven`), when `workflow.name` is not the
definition's own (`state-freeze-name-mismatch`), when the nodes are not exactly the resolved
set under the kinds above (`state-freeze-nodes-mismatch`), or when an input the definition
declares `required` with no default has no value under `orchestrator.options.inputs`
(`state-freeze-input-missing`). Each is corrected in the patch and the freeze sent again
(§ When a write is refused).

**The freeze patch must carry `workflow.name`** — the definition's own `name`, as `resolve`
printed it; for a built-in, that is the bare name after the prefix strip. The
writer derives the run's context block, `<name>_context`, from it (§ Writing state has the
rule), so a later write to `context` or
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

**The freeze patch carries the run's supplied inputs, under `orchestrator.options.inputs`.**
A start brief carries a chain's inputs once. The four resume lines carry none — each is a run
id, at most a reason or a steer, and a measured `at=`, and that is the whole of the contract —
so a re-driven or crash-resumed driver has no source for its own inputs unless the run recorded
them. One chain worked around it by persisting them into its own run options at run start;
every chain that did not lost its inputs on the first re-drive.

So the engine records them, not the message that woke it: the same `write-state` call that
installs the `workflow:` block writes the supplied values into `orchestrator.options.inputs`,
a map of input name to the value the run was started with. `options` is an open map whose keys
belong to the workflow that owns them, so this adds no key to any closed shape and the resume
lines do not move. A run started with no inputs writes no key.

**A resumed driver reads its inputs from the state, never from the line that woke it.** The
line says which run and when; it never carried a value and is not going to. Read
`orchestrator.options.inputs` off the state at Step 1 and treat it as the run's own record —
it is, because the run wrote it. A run frozen before the engine recorded them has no key, and
that is a run whose inputs are genuinely unknown: say so rather than guessing one.

**The freeze patch carries `orchestrator.completed_phases: []` and
`orchestrator.failed_phases: []`.** The state contract requires both on every run, from its
first write. The writer seeds each as an empty list, at the top of the block, when the write
that installs the `workflow:` block does not supply it and the file does not already carry it,
so the freeze patch need not spell them and a freeze that omits them still lands valid. A
later write of either replaces the whole list; there is no key to merge on, so a caller that
means to append sends the whole list.

**The freeze patch carries `orchestrator.options.html_output`**, read from `.maister/config.yml`
(default `true` when the file or the key is absent). The freeze's banner names the dashboard from
it, so a freeze that left it for intake to write would announce a dashboard an operator had turned
off. Intake still records it and may repeat the same value.

**The engine path creates no task items.** It never calls `TaskCreate` or `TaskUpdate`: the state
file and the dashboard are the run's tracker. The writer seeds `orchestrator.task_ids: {}` beside
the two phase sequences, on the same terms — unless the patch supplies it or the file already
holds it — and that empty map records that no task items exist.

**The freeze write installs the dashboard viewer.** When `html_output` is not false and the run
directory holds no `dashboard.html`, the freeze copies the plugin's viewer there and reports
`dashboard.html` among the changed paths. It never replaces a file already there, and a copy
that fails is a warning on stderr — the state write still lands. No later write copies it.

**The freeze write prints the startup banner; relay it verbatim as visible text in the same
turn.** After the changed paths and one blank line, the write that installs the `workflow:`
block into a file that had none prints five lines:

```
Maister run started
Task: <task.title, or (untitled)>
Directory: <the run's absolute task directory>
Dashboard: file://<that directory>/dashboard.html   (or: none (html_output is false))
First node: <the first node of the frozen graph>
```

It prints once: a later write that re-sends `workflow:` prints none. That includes a retried
freeze — the identical patch sent again because the first call's output was lost. The retry is
a no-op for the block (no `workflow` path is reported) and prints no banner; the first call's
write stands, and the task directory, the dashboard and the first node are read off the state
file instead. Compose no banner of your own — the freeze's output is the banner, and a
paraphrase drifts from the run it describes. A sub-run child's freeze prints its own banner too; the parent does not relay it, and its node
summary names the child's path instead.

**The freeze patch carries the definition's context seed, when its node prose names one.** Some
workflows keep context fields that are known before the first node runs — the input the run
was started with, restated where that workflow's readers look for it. Such a definition's prose
names them, and the freeze sends them as `context`. The writer resolves the context block from
the `workflow.name` in the same patch, so the run's per-workflow block exists from the first
write rather than appearing at some later node. A definition that names no seed sends none.

If `validate` rejects the definition, stop with `RUN-FAILED:` carrying the validator's first
error. A definition that does not validate cannot be executed part-way.

**A workflow-level `outputs:` entry whose node an overlay or a profile disabled warns; it does
not stop the run.** The warning is `exposed-output-disabled:outputs.<kind>.<key>:<node>`, and
the entry is **dropped from the canonical block**, the same way the disabled node itself is, so
the graph never exposes a key no node can produce. Fewer keys means a different `graph_hash`,
deliberately: a run exposing five artifacts is not the same executable graph as one exposing
six, and a hash that stayed still would say it was.

**A node an overlay or a profile added that nothing needs warns; it does not stop the run.** The
warning is `added-node-no-dependents:<path>:<node>`, and its text names the position the node
runs at in the frozen order. No node and no gate waits for it, so it runs where that order puts
it, like any other ready node; making a later node wait for it is the overlay's `before:`, never
a decision the run makes. A definition's own node in the same position — nothing needs it, the
run does not end on it, and it is no `on: failure` or `on: always` handler — warns the same way
as `node-no-dependents:<path>:<node>`.

**A reference to a node the base definition never declared stays a hard error.** The two look
alike in the resolved graph and are nothing alike in origin: a name no base node carries is the
author's own mistake, both halves of the contradiction in one file; a name an overlay or profile
removed is not the base's mistake at all.

### Step 5: Decline the resume flags the graph cannot express

An invocation may arrive carrying `--from=PHASE` or `--reset-attempts`, because operators who
used the 2.x plugin know both. Neither has an expression here. Resume recomputes the ready set
from the frozen graph, so there is no mid-graph entry point to start from; and no attempt counter
lives in state, because budgets are node prose rather than data.

**Say so by name, before the first node runs.** Name the flag that arrived and state which of the
two facts above makes it inert. No route in this plugin serves either flag: say that re-entry is
planned for the engine, and that a run which genuinely needs a phase jump today is one to finish
on the 2.x line. Promise no date. Then continue with the flag dropped: an ordinary run, or an
ordinary resume from the frozen state.

**Never accept one silently.** Dropping a flag without a word is the failure this step exists
to prevent — the operator asked to re-enter a run partway, watched it start somewhere else, and
was given no reason for it.

---

## The invocation contract

One script, twelve verbs, one exit-code table — `0` success, `1` the input was rejected
(the report is still printed), `2` an internal failure where nothing ran.

```
node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs <verb> [flags]
```

The plugin root is this plugin's own directory — the one holding
`.claude-plugin/plugin.json`, two levels above the base directory the loader shows
for this skill. Run the script by that absolute path, never through the variable:
where a command here still reads `${CLAUDE_PLUGIN_ROOT}`, write the directory in its
place. The shell expands a variable from its own state, and that expansion is not
the path the enforcement hook verified, so a call spelled through it is not
recognised as this plugin's own and the operator is asked to approve it. A root
holding a space goes in single quotes.

**The invocation is the whole command.** No `cd` in front of it, no `set -e`, no
variable assigned first and used in it, no second command after it, no redirection,
no pipe, no heredoc, no substitution — and never several verbs packed into one shell
script. Flag values are written bare; a path holding a space goes in single quotes,
never double quotes or a backslash.

**A patch or a request document travels in the patch file.** Write the JSON to
`.state-patch.json` in the run directory — beside `orchestrator-state.yml` — with the
file-writing tool (Write, or the host's own file-creating tool), then name it on the call:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml --patch-file=<run>/.state-patch.json
```

That one name, in that one place, is the only file the verbs read a document from:
any other name or directory, a `..` segment or a link is refused at exit `2`. When the
write lands, the verb deletes the file, so the next write creates it afresh. When it is
refused, the file stays: correct it and run the verb again — it is a file this session
wrote, so the file tool overwrites it; one left by an earlier session is read first.
Never send the document through a heredoc, `echo`, a pipe or `< file`: an agent
host's shell-safety check refuses a JSON heredoc outright — braces beside quotes —
and allow-listing the script does not lift it, while a file needs no quoting in any
shell, PowerShell included. And the file is written by the file tool, never by the
shell.

This is not style. The enforcement hook recognises this plugin's own call and answers
it, so the operator is not asked to approve their own workflow once per write — the
call by reading the command, and the patch file by its name inside a run — so a command
doing anything else is not that call and the prompt comes back. Measured 2026-09-14: a
run that wrapped its verbs in shell scripts was recognised **zero** times out of
seven. Where no hook answers, the operator's own permission rules decide: an allow
rule for the script, and an edit rule for `**/.state-patch.json`, spare them the
prompts.

One verb, one call. When a step needs two verbs, that is two calls.

| Verb | Flags | Gives |
|---|---|---|
| `validate` | `--definition`, repeatable `--overlay`, `--profile` | `{ok, errors[], warnings[], resolved[]}` on stdout — `resolved` says where each target was found. Every profile the overlays declare is judged, selected or not, and a finding only one profile produces is prefixed with its name. A version 1 document is closed: a key the grammar does not define, at any level, is an error that names the accepted keys, and only a reserved key warns instead. An overlay given without `--definition` is judged on its shape, and a base it names by workflow name must exist — a built-in or a project definition. A workflow in the project's `.maister/workflows/` that says nowhere what it is for — no `description:`, no paragraph under its companion's title — warns `workflow-undescribed`, because `/maister:work` cannot match a task to it |
| `resolve` | `--definition`, `--overlay…`, `--profile` (a profile one of the overlays declares; selecting any other is refused) | the canonical graph, its `graph_hash` **in the spelling state records** — write it through unchanged, never re-spell it — and `tracker_key`, the input the freeze reads for `task.key`, or null |
| `diagram` | same, plus `--out` | deterministic Mermaid text; its header names the overlays (by file name) and the profile applied, and a gate box carries its question and its options as `id: effect` |
| `locate` | optional `--name` (bare or `builtin:`-prefixed); with it, repeatable `--overlay` and `--profile` — the run's own | with a name, where the run-by-name lookup (Step 3) finds it: `{ok, errors[], name, from, definition, overlays[], ignored, companion, title, summary, inputs, dispatches[]}` — `definition` and `overlays` are the `--definition` and `--overlay` values the three verbs above take (the lookup's own, before any the caller adds), a project path written relative to the project root; `inputs` is the definition's declared `inputs:`; `title` is the companion's H1, and `summary` the definition's `description:`, else the paragraph under that H1; `dispatches` names the nodes that carry `dir:` in the graph folded from the definition, every overlay and the profile. Exit `1` when the name is found nowhere, is not a workflow name, finds only an overlay with no built-in beneath it, or finds a file whose `name:` is another. With no name, `{ok, errors[], workflows[]}` — the project's own definitions, each with `name`, `definition`, `title`, `summary`, `chain` and `error`, overlays, built-in names and generated chains left out. Reads only |
| `write-state` | `--state`, `--patch-file` — the patch as JSON in the patch file | the changed paths, one per line; the freeze adds a blank line and the startup banner (Step 4) |
| `gate-request` | `--state`, `--patch-file` — the request as JSON in the patch file | the files written, one per line |
| `gate-revise` | `--state`, `--node` (the gate), `--option` (its revise option), `--patch-file` — `{note, answered_by?, at?}` in the patch file | the changed paths, one per line, then a blank line and `revised: <gate> reruns=<node> revision=<n>/3 reset=<ids>`; the stretch from the option's rerun node to the gate reset in one write, with the note on the gate (§ Gates) |
| `run-complete` | `--state`, and under a dispatch driver `--outbox` and `--dispatch-id` | the run's closing marker as the **last** line of stdout, with any `missing-artifact:` lines and a stop's notice above it; the refusal on stderr |
| `prior-context` | `--state` | the prior phases' decisions and risks as markdown on stdout, to paste into a delegate prompt — reads the run, writes nothing |
| `gate-brief` | `--state`, `--node` (the gate), optional `--json` or `--oneline` | the gate brief on stdout — the closing node's summary, at most three decisions and three risks, and a `Next:` line naming the node that actually runs next (with any work a guard skips), kept within 1,600 characters. `--json` returns the in-session picker: `{ok, question, header, options[{id, label, description, recommended}], errors, warnings}`, the recommended option first; a revise option adds `note: true`, `reruns`, `revision` and `suggestions[{label, note, recommended}]`. `--oneline` is the driven form: every decision and risk, the `Next:` line with every skipped node, one `revise: <id> reruns=<node> revision=<n>/3` section per revise option still offered, a `Recommended: <option id>` and a `Run: <dir> · Dashboard: <path>` section, on one flow-safe line within the same budget — reads the run, writes nothing (§ Gates) |
| `resume-check` | `--state` | JSON on stdout: the frozen workflow's `name`, `overlays` and `profile` and the run's `dashboard` link (`null` when it has none), or, exit `1`, the refusal of a directory the engine does not resume — a 2.x one among them — with an operator `message` (§ Resume) — reads the run, writes nothing |
| `sync-plan` | `--plan` (the run's `implementation/implementation-plan.md`) | sets the plan companion's `data-group` / `data-step` markers to the plan's checkbox state; JSON on stdout with `written` and the groups the companion has no marker for — idempotent, and a no-op that names its reason when there is no companion or the run's `html_output` is off |

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

`run-complete` ends a run and, under a dispatch driver, only once the close-out it owes is
on disk. It takes three flags where the other two state verbs take one, because the outbox
root and the dispatch id belong to the dispatch rather than to the run: the state file
records the driver's kind and nothing that would locate an outbox. A dispatched worker
already holds both — its seed hands them over under exactly these two spellings for the
outbox verb it publishes with — so pass them through unchanged. Omitting them under a
dispatch driver is refused the same way an unpublished close-out is: the verb cannot show
the message landed, and an unprovable close-out is the defect itself. It reads the outbox
through the umbrella runtime's own reader and never builds one of those paths itself.

**`write-state` checks the document it wrote structurally, not against a schema, and that
is deliberate.** It re-reads the candidate through the enforcement hook's own reader, then
holds it to the rules a line-oriented writer can state for itself: no duplicate key at any
column, no top-level block that neither the prior file nor this patch introduced, and a
task, a workflow and a non-empty node map present. What it cannot do is validate against
the contract schemas — a consumer checkout carries no YAML package and no schema validator,
and a check that only ran where this repository's own tests run would be checking the one
place that needs it least. So a document can be contract-invalid and still be written: the
schemas are the suite's instrument, and the gate they back is the compatibility suite, not
this verb. Two things follow for a caller. Send values in the shapes the register declares
rather than relying on a refusal to catch a wrong one; and never rewrite the `workflow:`
block. It is written once, at the freeze, and never again: a later patch identical to it
changes nothing, and one that differs in a node or in any scalar beside `workflow.nodes` —
`graph_hash` among them — is refused with `state-workflow-frozen`. Nothing is carried
forward into the block and nothing is dropped from it.

The patch arrives in a file so no quoting has to survive a shell — Windows without a POSIX
shell is a supported target. A newer version — a whole number above 1 — degrades **the same
way in every verb** — `validate`, `resolve` and `diagram` alike short-circuit on it, render
what they recognise, warn, and still exit `0` — so a newer definition in a mixed fleet is a
diagnostic rather than a dead run, and never a document one verb accepts while another
rejects it. Two things are still refused on the degraded path: what the structural fold
itself finds, and a cycle in `needs`. Any other version that is not `1` — quoted, fractional,
a word — is a misspelling of this grammar, not a newer one, and `validate` refuses it.

---

## Executing the graph

### The ready set

A node is ready when all three hold:

1. **Every `needs` entry is satisfied.** Under the default, `on: success`, `completed` and
   `skipped` satisfy. Under `on: failure` and `on: always`, `failed` and `stopped` satisfy
   too — any need that has ended.
2. **An `on: failure` node has something to recover from:** at least one need ended `failed`
   or `stopped`. When every need ended `completed` or `skipped`, the node is not run.
3. **Its `when` guard evaluates true** against the values declared by completed nodes.

A node whose guard is false, and an `on: failure` node with nothing that failed, is marked
`skipped`, and **a skip satisfies everything downstream** — that is how a definition expresses
an optional phase without any routing construct. `on: always` runs once every need has ended,
however it ended.

**A `waiting` node is not ready.** It is a `workflow:` node whose child run has not reached a
terminal status, and three separate readers need to be told so separately: it is not ready, so
the walk does not execute it again; it satisfies **no** `needs`, not even one declaring
`on: always`, because the node has not ended; and it does **not** make the run gate-pending,
because no gate was asked and no request file exists. What a run with a waiting node does on its
next turn is the waiting path of *Sub-runs*, not a ready-set walk that skips it.

**No node in the shipped built-in carries `on:`**, and that is precisely what makes a stop
option terminate a run: under the default, nothing downstream of a stopped node ever
becomes ready.

Execute ready nodes one at a time, in the order the frozen graph lists them. When nothing
is pending — or a node failed with no downstream `on:` to take it, or a stop option ended the
run — record `task.status` in the closing patch and end the run through the `run-complete`
verb. It reads that status and prints the marker from it:

- `completed` → `RUN-COMPLETE`, once nothing the run can still reach is left: a node still
  `running`, `suspended` or `waiting`, or a `pending` one whose needs are met and which no false
  guard keeps off the path, is refused `run-nodes-unfinished` (*When `run-complete` refuses*);
- `failed` → `RUN-FAILED: node <id> failed`, naming the first failed node, or
  `RUN-FAILED: sub-run <child-run-id> failed` when that node is a `workflow:` node;
- `stopped` → `RUN-COMPLETE` too, because the vocabulary has no stopped marker and a stop is
  not a failure — preceded by one plain line, `run stopped: <node> - <option>`, read from
  the state so a person reading the terminal does not take the stop for a success. The marker
  stays the last line, and `task.status` on disk is what says the run stopped.

Whatever the ending, one `missing-artifact: <node> <path>` line precedes the marker for each
artifact a `completed` node declared that is not on disk and that its summary does not record
under `absent` — a sub-run node's path joined onto its child's task directory. It is a warning,
never a refusal, and the exit code does not move: whether an absence is a defect was the node's
own check to make (*Recording an outcome*). Because a sanctioned absence prints nothing, a line
that remains is a genuine gap, and the operator's cue to re-drive that node. How the lines reach
the operator depends on the driver (*Operator visibility*).

A dispatched run that owes a close-out it never published gets `RUN-FAILED:
closeout-unpublished` whatever its status. Echo the verb's lines, the marker last; do not
type a marker the verb did not give you.

### Ending a dispatched run

**Under `driver.kind: dispatch` a run's close-out publishes through the outbox close-out
verb** — carrying the grade and the summary the seed's close-out contract asks for — **and
the closing node records its outcome value only after that publish succeeded.** The outbox
is the chain's only way to learn a dispatch is over: a run that commits, pushes and records
`closed-out` without publishing leaves its chain waiting forever with every local sign
saying success. That is why the `run-complete` verb refuses such a run rather than letting
it print `RUN-COMPLETE`.

If the outbox cannot be written, the outbox verb hands back a `DISPATCH-RESULT:` line
instead; that line is then the turn's last line and no `RUN-COMPLETE` is owed. The two are
alternatives, never a sequence.

Under an absent, `terminal` or `cockpit` driver nothing changes: there is no outbox, because
nothing dispatched the run, and the verb prints `RUN-COMPLETE` as it always did.

### Delegation by scheme

The node's `uses` names both the mechanism and the target:

| Scheme | How it runs |
|---|---|
| `skill:<name>` | the Skill tool |
| `agent:<name>` | the Task tool |
| `direct:<name>` | inline, by this engine, following the node's section in the definition's prose companion |
| `workflow:<name>` | with no `dir:`, it **starts a child run** — its own task directory, its own frozen graph, its own driver — and the node waits for it (*Sub-runs*). With `dir:` it keeps its dispatch meaning and is refused as a sub-run |

**A `skill:` or `agent:` target is looked for in four tiers — the project, then the
operator's own, then this plugin, then every installed plugin — and the first hit wins.**
The project is the directory the host declares as the project, else the one the verb runs
in; both hosts' layouts are searched there (`.claude/skills/<name>/SKILL.md` or
`.github/skills/<name>/SKILL.md`, and the agent files beside them, in either spelling). The
operator's own are the same layouts under each host's home, `~/.claude/` (or
`CLAUDE_CONFIG_DIR`) and `~/.copilot/`, and sit above this plugin because the host resolves
them first when it runs the node. A target may name the plugin it means with one colon —
`skill:acme-tools:review` — and is then looked for only in that plugin, this one included
by its own name, never in the first two tiers. `validate` reports where each target was
found in its `resolved` list: the node, the target as written, the tier (`project`, `user`,
`plugin` or `installed`) and the file. The directories each tier searches are in
`references/grammar.md` § 5.1.

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

**Prior-phase context is read out of state, never composed.** A prompt for an
artifact-writing delegate carries everything earlier phases decided and flagged, complete:
`N` items in state must arrive as `N` distinct items, none dropped and none merged. Writing
that passage by hand does not hold — measured across four attended runs, a node composing it
afresh from an artifact it had already read condensed thirteen items into seven clauses on
one line — so the passage is not written, it is fetched. Run `prior-context` against the run's
state file **at each consuming delegate** — one call per prompt, in the turn that composes it —
and paste its stdout into the prompt under its own heading, unedited. The stdout is pasted as
text, whole: never slice it with `sed`, `head`, `tail` or the like, and never pass a file path
or a saved copy in place of the pasted text — a delegate handed a path reads what it chooses
to, and a sliced passage is a trimmed one. It renders
every `phase_summaries` entry the run has accumulated: the phase key, the node that owns it,
its summary line, then its decisions and its risks as one bullet each with the count beside
the heading, so a truncation is visible as a number that disagrees with its own bullets. It
finds the run's context block itself, by its `_context` suffix, so every workflow is served by
the same call. A run with no context block — one whose nodes record only `node_summaries` —
gets those rendered instead, one section per node, and a freshly frozen run gets the sentence
saying nothing has been recorded yet. Re-using a rendering produced for an earlier
delegate is not licensed however recent it looks: a summary written in between makes it stale,
the prompt records nothing about when it was taken, and a prompt that happens to be current is
current by timing rather than by construction. The verb reads the run and writes nothing, so
the extra call costs nothing. Trimming its output, re-ordering it or summarizing it puts the
composing step back.

A `direct:` node's prose is the node's body: its steps, its fan-outs, its self-checks, the
questions it asks inline, and how many times it may be re-driven. Read the section before
executing the node, not after it fails. Whether those inline questions are asked at all
follows the run's driver — see *In-node questions*.

### Run-scoped context

Four things reach every delegate without appearing in any node's `with:`, because they
belong to the run rather than to a node. Every workflow's delegates get them; a workflow's
companion says only what it adds.

- `task_path` — the run's task directory, which every declared artifact path is relative to.
- `html_style_guide_path` — the absolute path of the framework's `html-report-style.md`,
  passed **only** when `orchestrator.options.html_output` is not false. When it is false, no
  companion is requested, no dashboard file is written, and an existing data file is removed.
- The project's documentation paths, when a node of the workflow has recorded them — its
  companion names the node and the key.
- The prior-phase passage — the `prior-context` output, fetched at each consuming delegate as
  *Delegation by scheme* above says, never composed.

Anything node-scoped is in `with:`, interpolated as below. Every prompt that asks a delegate to
write an artifact also carries the artifact summary contract (framework § 7), so the summary
lifted into state is one the delegate wrote rather than one the engine invented. Which artifacts
also get an HTML companion is the node prose's to say (framework § 9). A delegate that writes one
is handed `html_style_guide_path`; an artifact a `direct:` node writes inline gets its companion
from the `html-companion-writer` agent. Each companion is registered under `artifacts[].html` on
the summary entry that owns the artifact. Reconciling what state lists against what is on disk is
the closing node's job (framework § 10).

### Interpolating `${…}`

Before a node runs, the driver substitutes every `${…}` in its `with:` — however deeply nested —
and in its `dir:`. Before a gate is asked, it substitutes the ones in its `ask:`. Nothing else is
interpolated: an artifact path is literal, a `when` is evaluated by the ready-set rule, and `uses`
names a target as written. Each reference reads the run's state, never a recollection of it:

| Reference | Resolves to |
|---|---|
| `${inputs.<name>}` | `orchestrator.options.inputs.<name>`; else the input's declared `default`; else null |
| `${<node>.values.<key>}` | the value the node recorded in `workflow.nodes.<node>.values`. A skipped node recorded its bools false and its strings and enums null |
| `${<node>.artifacts.<key>}` | the path the node declares, joined onto the task directory of the run that wrote it and spelled repository-root-relative (*Recording an outcome*) |

**A value keeps its type when the reference is the whole string.** `with: {deep:
"${intake.values.deep}"}` hands over the bool `true`, and a null stays null. A reference inside
longer text becomes text, and a null there becomes empty. That silent empty is why a node never
interpolates a value that a node which may have been skipped left null. Its prose reads the value
from state instead, where the absence is visible and can be said.

**The sub-run join.** A `workflow:` node's own `with:` is interpolated first. The result, plus
`embedded: true` when the child declares that input, is what the child freezes as its inputs (W2
in *Sub-runs*). Once the parent has adopted the child's outcome (W4), a later node reads the child
through the parent node:

- `${<node>.values.<key>}` is the value W4 copied from the child onto the node;
- `${<node>.artifacts.<key>}` is the child's declared path, joined onto the node's recorded
  `values.task_path`.

Before W4 neither resolves, and nothing downstream of a waiting node is ready anyway.

**A reference never resolves by guessing.** The validator has already refused a reference to an
undeclared input or output, or to a node outside the referencing node's `needs` closure. A
reference that still finds nothing in state at run time — a completed node that never recorded a
declared value — is the earlier node's defect. Re-drive that node, or record the value through
`write-state`, rather than substituting a plausible one.

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
check and the gate-answer check (*Terminal mode*) read the definition, so they apply only while
the frozen block still resolves to its recorded hash.

**A `workflow:` node's outcome is the child run's, mapped rather than judged.** The node has no
self-check of its own — the child ran its own — so the parent reads the child's `task.status` at
the node's recorded `values.task_path` and maps it:

| Child `task.status` | Parent node | Parent run |
|---|---|---|
| `completed` | `completed` | continues its walk; the declared outputs are exposed |
| `failed` | `failed` | ends `RUN-FAILED: sub-run <child-run-id> failed`, unless a downstream node declares `on: failure` or `on: always` |
| `stopped` | `stopped` | stops outright — one patch carries `task.status: stopped` and every unexecuted node, then `run-complete`. No `RUN-FAILED`: a stop is a legitimate outcome |
| anything else | unchanged, stays `waiting` | the waiting path runs again (*Sub-runs*) |

A child can complete without an artifact its parent's node declares, when a guard skipped the
child node that writes it. The write that adopts the outcome records that artifact under the
parent node's `absent`, with the skip as the reason (*Recording an outcome*). Any other absence
is left unrecorded, so `run-complete` reports it.

**A declared artifact path resolves against the task directory of the run that wrote it.** Stated
once, covering every scheme: for a `direct:`, `skill:` or `agent:` node that is the run's own task
directory, as it always has been; for a `workflow:` node it is the **child's**, named by the
node's recorded `values.task_path`, because the path the parent declares is the path as the child
writes it. The join applies to both readers of a declared artifact — the existence check above and
`${<node>.artifacts.<key>}` downstream — and the joined value is repository-root-relative.
Artifacts are therefore never copied into the parent node's values; only declared *values* are.
Storing the joined path as well would be a third copy of one fact, kept in step by hand. The
writer makes the same join when it registers a completing node's artifacts, and spells the result
relative to the parent's own run directory instead, because that is what the dashboard links it
against. The declared path itself is literal: nothing substitutes a `${…}` inside it, so
`validate` refuses one there.

**The two budget-exhausted rows need an operator, so they need a driver.** Asking whether to
retry or to skip is itself an in-node question, and under a `cockpit` or `dispatch` driver
nobody is there to answer it: the node is recorded `failed` and the run stops with
`RUN-FAILED`, which is the last row rather than either of the two above. That is not a dead
end — a re-drive is what an operator reaches such a run with, and it carries the context the
question would have gathered. See *In-node questions* for the rule and what it records.

**A node that did not produce its declared artifacts has not completed.** Before recording
a node `completed`, check that every path the node declares under `outputs.artifacts` exists
— one `test -e` per declared path, against the path resolved from the task directory. A
declared artifact that is missing is one of exactly two things, and the node prose is what
tells them apart:

| The node prose | The missing path means |
|---|---|
| sanctions the absence by name — the artifact's source may legitimately not exist | no such context; record `completed` with the absence on the node summary (below) |
| says nothing about it, or says the file is written either way | the delegate skipped work it was asked to do; the node has **not** completed |

Treat the second as a failed self-check and re-drive the node within its budget, naming the
missing path in the context handed back. When the budget is exhausted, the node's outcome
follows the table above rather than being recorded green with a hole in it.

**A sanctioned absence is recorded, not just described.** The completing write's node summary
carries `absent: {<artifact-key>: "<reason>"}` — one entry per declared artifact the node
completed without, named by its declared key (never its path), with the reason in a few words.
Its `summary` still says it in prose for the gate brief. The entry is what the tools read, since
none of them can read prose: `run-complete` prints no `missing-artifact:` line for it, and the
dashboard shows the artifact as *not produced* with the reason instead of leaving a gap. The
writer refuses an entry that names an artifact the node does not declare or gives no reason
(`state-absent-invalid`). Record it only where the node prose sanctions the absence; an
artifact the node owed and did not write is the second row above, never an absence to sanction.

The check costs one existence test per declared path and needs nothing the engine does not
already hold: the definition declares every artifact, so the list is free. Without it, a
delegate that returns successfully having written nothing is indistinguishable from one that
wrote everything, and the absence surfaces only when a later node reads the path — or when a
human compares two lists by hand. `run-complete` repeats the comparison once more at the end,
over every completed node and less the absences each node recorded, but only to report: its
`missing-artifact:` lines never refuse, because this check — the one that can read the prose —
is where the judgement belongs.

**A phase key is never a node id.** `node_summaries` is keyed by node id, and the workflow's
own `phase_summaries` map is keyed by the workflow's phase keys. The node prose names the
key each mirroring node writes under; a node whose prose names none writes a node summary
and nothing else. Reading a phase key off the node id is the mirroring defect to watch for,
because the write succeeds and the run keeps going with a key nothing else reads.

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

### Before every gate — the gate brief

What the operator reads at a gate is rendered by the engine, never composed:

- **Every node a gate needs writes a non-empty `summary`** in its closing `node_summaries`
  entry, in the same patch that marks it `completed`. Gate-relevant extras go beside it: the
  choices made in `decisions`, open items in `risks`, each list most important first — the
  question shows the first three of each. Write all three for the operator: what was found and
  what it means, in plain words, never a state key, a value name, an internal flag or a slug
  used as a label. A stop recommendation is a risk starting
  `recommend stop:`; an open decision or a still-critical issue is a risk starting `open:`; a
  defaulted question is the `defaulted:` decision *In-node questions* describes. The node
  prose's "Gate brief content" paragraph names what belongs there.
- **Run `gate-brief --state=<state> --node=<gate>` in its own call** — with `--json` when the
  gate is asked in session, with `--oneline` when a driver suspends on it — before asking the gate,
  and only once the closing write — the patch carrying the node's summary and its `completed`
  status — has returned successfully. Never issue the two in parallel: a brief that reads the
  state before the write lands is refused for a summary that is about to exist. Its output is
  the question, whole; ask it, never write one by hand, and never print a summary of your own
  before the gate instead.
- **`gate-brief-no-summary` or `gate-brief-value-missing`**: send the patch the message names
  through `write-state`, then run the verb again. The value-missing patch carries the node's
  whole `values` map, because a node's values are replaced whole on patch.
- **`gate-brief-unknown-node` or `gate-brief-not-a-gate`**: the `--node` argument is wrong;
  correct it. Nothing is written.
- **`gate-brief-no-graph`**: the definition cannot be read, the freeze recorded no needs and no
  node carries a summary. No write fixes it: relay the message and ask the gate with its `ask:`
  alone.
- **A `gate-brief-graph-drift` warning** means the definition changed since the freeze. Relay
  the warning as-is; the brief still printed, its `Next:` line says the next node is unknown,
  and the gate is still asked. A `gate-brief-needs-unknown` warning beside it says the summary
  is the nearest recorded one, because what the gate closes is unknown; relay it too.

**The brief covers the whole stretch the gate closes.** It renders the summary of the node the
gate needs and, after it, the summary of every other node back to the previous gate that recorded
one — a node an overlay placed before this gate among them. With more than one, each summary is
named by its node's title, their decisions and risks are listed together — the closing node's
first, so the budget below trims the others before it — and a `recommend stop:` risk from any of
them makes the stop option the recommended one. A summary further back never
stands in for the closing node's own: without that, the brief is refused `gate-brief-no-summary`.

**What the operator reads is the plain form.** The summary; one `Decisions:` line and one
`Risks:` line, each showing at most three items with `(+N in the dashboard)` for the rest; and
the `Next:` line. A risk that opens `recommend stop:` is always shown first, so the reason for the
recommendation stays in view. A slug key leading an item (`some-decision-id: …`) is dropped. It
carries no recommendation — the picker marks the recommended option — and no paths: the
dashboard link is shown at the run's start, at a resume and at its end instead (*Operator
visibility*).

The brief stays within 1,600 characters, so that the brief and the ask fit in the picker. A
longer summary is cut at the end of a sentence and says `… (more in the dashboard)`; list items
are cut and dropped the same way. Each pointer names `the run's state file` instead when the run
has no dashboard or its run directory holds no `dashboard.html`. The `Next:` line is never
trimmed.

The brief's `Next:` line names the node that actually runs once the continue option is
chosen — guards evaluated, each node by its title — and the work skipped on the way, never a
gate: `Next: Specification (skipping TDD red and UI mockups)`. No gate question or prose needs
to say where the run goes next. When that node waits on a branch the gate does not reach, the
line reads `Next: waiting on <titles>`; `Next: end of run` means nothing after the gate is left.

**The driven form is unchanged.** `--oneline` keeps what a cockpit and a driver read: every
decision and risk, each cut counted as `(+N more — see the dashboard)`, the `Next:` line with
every skipped node — gates included — after `— skipped:`, a `Recommended: <option id>`, and a
last `Run: <dir> · Dashboard: <path>` section, which reads `Dashboard: none (html_output is
false)` without a dashboard and `Run: <dir>` alone when the viewer is missing. Its `Next:`,
`Recommended:` and run sections are never trimmed.

### Terminal mode — asked and answered in one turn

1. **Asks it in session** with `AskUserQuestion`, built from `gate-brief --json` field by
   field: `question` is the question, verbatim — the brief, a blank line and the node's `ask:`;
   `header` is the header; `options` are the options, in the order given, each shown by its
   `label` with its `description`, and the first — the recommended one — labelled
   `<label> (Recommended)`. Where the picker has no header or no description, leave them out; the
   labels still carry the choice. The recorded answer is the chosen option's `id`, never its
   label. When `options` is empty — the definition changed and no longer holds the gate — ask
   with the gate's own option ids.
2. **Records the answer** — the chosen option id, who answered and when — on the node's
   summary, and marks the node `completed`. A revise option — its `note` is `true` — is
   recorded by `gate-revise` instead (*Revising at a gate*). The option is one of the gate's own ids, spelled as
   the gate spells it. The writer refuses any other with `state-gate-option-unknown`.
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
   request document arrives in the patch file as JSON, written before the call, while nothing
   is pending yet: the node id, the kind, the question, its options
   and the multi-choice flag (`gate.schema.json` declares the shape). The question is the
   node's `ask:`; `context.summary` is the `gate-brief --oneline` stdout without its trailing
   newline; the option the brief recommends carries `recommended: true`. `since` is the request's
   own `asked_at`, so the marker and the file agree about when the operator was asked.
   The gate card the operator sees lands inside this same write, alongside the pending marker,
   so nothing needs writing after it.
   **There is no second call here, and there must not be**: the run is pending from the moment
   the request file lands, and a shell call against a pending run is denied.
3. `GATE-PENDING: <node>` is printed as the **last** line of the turn.
4. The turn ends. Nothing polls, nothing waits, no session is left idle.

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

**A sub-run suspends on the same shape, with its own two writes in place of step 2.** The child
freeze (W2) and the parent's record of the link (W3) both complete **before** the write that
projects the dashboard and before `WAITING-SUBRUN` is printed, and that ordering is the contract rather than a
convenience. A gate pending in a run whose `driver.session.id` is absent binds *every* session, so
a child that suspends while a parent write is still outstanding would deny that write, and the
parent could no longer record the link it has already created. This is the umbrella's "the ledger
entry is written before the waiting marker is printed", at the scale of a run rather than a
dispatch. W2 precedes W3 for a second reason — the parent's `values.task_path` must name a
directory that exists — and *Sub-runs* carries both walks in full.

### Driver-suspended mode — resume

A resume always arrives as a first line in one of five shapes — `GATE-ANSWER`, `RE-DRIVE`,
`STEER`, `RESUME` or `SUB-RUN-DONE` — and **all five end with `at=<timestamp>`**. That stamp is the turn's
measured time and it is the only one the engine has: nothing in a resumed turn may read a
clock of its own or reuse a time from an earlier turn. Record it exactly as a `GATE-ANSWER`
stamp is recorded — as the `at` of the decision the turn writes — on a re-drive and a steer
no less than on an answer. A first line with
no `at=` is below the contract: print `RUN-FAILED: prompt-line-unstamped`, write nothing, and
leave the run where it was. Inventing a time there is what puts a midnight timestamp into a
run's permanent record, and a fabricated stamp is worse than a refused turn.

**None of the five carries a value, so none of them carries the run's inputs.** A resumed
driver reads those off `orchestrator.options.inputs`, which the freeze wrote — see Step 4.
Re-deriving an input from the line, the run directory's name or a task description is inventing
one, and an invented input is the same class of defect as an invented timestamp.

**The fifth shape wakes a parent whose sub-run has ended**, and its grammar is total:

```
SUB-RUN-DONE run=<parent-run> node=<node> child=<child-run> status=<completed|failed|stopped> at=<ts>
```

Every field is required, appears exactly once, and the order is fixed with **`at=` last**; a sixth
field is a malformed line rather than a forward-compatible one. `run=` and `child=` carry an
opaque run token, `\S+` — the engine writes a task-directory basename because that is the only
spelling it can produce, and a daemon writes its own colon address, so **the match rule is to
compare the token's last colon-separated segment** against the run's task-directory basename and
against the node's recorded `values.run_id`. A token with no colon is its own last segment, which
is how the two spellings meet in the one part they share. Defining the field as a basename instead
would make every line the cockpit sends unparseable.

A malformed line, a `run=` or `node=` that is not this run's, or a `child=` that is not the
recorded one, all print `SUB-RUN-INVALID: <reason>` and write nothing — the reason names the field
at fault in that field's own spelling, a vocabulary *Sub-runs* fixes; a `node=` that is no longer
`waiting` prints `SUB-RUN-ALREADY-DONE` and writes nothing. A missing `at=` falls to the rule
above — a fifth line shape is not a fifth way to be unstamped.

**The disk wins, always.** `status=` is a hint about why the parent was woken; the child's
`task.status` is the outcome, and when they disagree the state decides and the line is ignored.
A parent woken `completed` by a child still running stays waiting; a parent woken `failed` by a
child that completed completes. Without the rule a daemon bug becomes a wrong outcome recorded
permanently in a run's history. A re-drive carrying no `SUB-RUN-DONE` at all reaches the same
waiting node and takes the same path, which is what makes it idempotent under a sweep.

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
   `write-state --state=<state>` with the empty patch, `{}`, as the patch file's body (§ The
   invocation contract) — the marker is already null, so the file may be written. It is
   not a no-op: the writer reads the file the editor tools just wrote, self-checks it through
   the enforcement hook's own reader, and re-publishes it. The file changes by one line
   (`orchestrator.updated`), and that is the expected result. This is what keeps the editor-
   tool exception honest — model-authored state is accepted only after the writer has read
   it back and agreed.
6. A refusal at step 5 is `RUN-FAILED: <code>`, reported verbatim, and the run
   stops there: the operator repairs the directory or starts a new task. **Never repair the state file to get past it** — a
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
never re-ask a gate the operator has already answered — a gate a revise reset is the one gate
asked again, because the operator asked for exactly that.

### Revising at a gate

A revise option sends the run back: the stretch from the option's `reruns` node to the gate runs
again with the operator's note, and the gate is asked again once it has. The grammar's § 6 has
the rule; here is what the engine does with the answer.

**Terminal mode.** When the operator picks an option whose `note` is `true`, ask what should change
before writing anything: offer that option's `suggestions` to pick from, multi-select, built field
by field — header `Revise`, the question "What should change?", each suggestion shown by its
`label` with its `note` as the description, the recommended one first and labelled
`<label> (Recommended)`. The operator's typed answer, through Other, is the fallback and is added
to whatever they chose. The note is the chosen suggestions' `note`s joined by `; `, then the
typed text. When nothing is chosen and nothing typed, there is no note: ask the gate again from
its brief. Then write `{"note": "<the note>"}` to the patch file and run `gate-revise
--state=<state> --node=<gate> --option=<id> --patch-file=<the patch file>`. That one call is the
whole record — the answer, the note, the reset and the dashboard. Take the ready set from the
state again: the `reruns` node is the next to run, and its prompt carries the note through
`prior-context`.

**Driver-suspended mode.** The request's revise option carries `effect: revise`, `note: true` and
the `suggestions` from `gate-brief --json`, beside the brief. The answer's option id arrives on
`GATE-ANSWER` as any answer does; its note arrives on the answer file the driver writes beside the
request — `gates/<node>.answer.<operator>.yml`, under `answer.note`. Read it with the read-only
tools, fold the answer exactly as *Driver-suspended mode — resume* says, run the empty-patch
re-validation, then write `{"note", "answered_by", "at"}` — `at` the `GATE-ANSWER` stamp — to the
patch file and run `gate-revise`. It recognises the answer the fold recorded and completes it in
place. With no note on the answer file, the note is the recommended suggestion's, and the
decision carries `answered_by` from the line as usual.

**A revise is never recommended.** The brief recommends the continue option, or a stop when a
closing risk says so; a revise is the operator's choice. A driver that defaults an answer never
defaults to one.

**What the reset leaves.** Every node of the stretch is `pending` with its clocks and values gone
and its `attempt` one higher; a guarded node in it is judged again once the rerun node records
its values, and a gate in it is asked again. The summaries stay until the nodes re-complete and
replace them, so the brief and the prior context still show what the previous attempt found. The
gate's decisions keep every revise — its note, the attempt and the target — and a later answer at
the gate is added after them, never over them.

**Budget.** Three revisions per gate. The brief stops offering the option once they are spent and
says so on its `Next:` line; the verb refuses a fourth.

**Resume.** A run caught between a driven fold and `gate-revise` — the gate `completed`, its last
decision a revise option without an `attempt` — is found by `resume-check`, whose `revision`
field says `applied: false`. Run `gate-revise` for it before anything else, with the note from the
answer file; do not walk the ready set first, or the run moves past the gate as if the answer
had been continue.

| Refusal | Response |
|---|---|
| `revise-not-a-gate` | `--node` names no node of the run, or a node that is not a gate. Nothing was written. Correct `--node` to the gate the operator answered and run the verb again; no state write fixes this. |
| `revise-option-unknown` | `--option` is not one of the gate's revise options; the message lists them. Nothing was written. Correct the id — the option's id, never its label. A continue or a stop is recorded as an ordinary answer (*Terminal mode*), not through this verb. |
| `revise-note-missing` | The patch file carries no note, an empty one, or an `at` that is not a UTC timestamp. Nothing was written and the patch file is kept. Put the note the operator gave — the chosen suggestions and anything typed — into it, send the answer's own stamp or no `at` at all, and run the verb again. |
| `revise-gate-not-current` | The gate is not the question the run is asking: something it waits on has not ended, it is already answered, a revise already reset it, or a driver's answer is still awaited. Nothing was written. Do not repeat the call; take the ready set from the state and ask the gate the run is actually at. A second call after a revise that landed is refused this way, which is what makes it safe. |
| `revise-budget-exhausted` | The gate has been revised three times. Nothing was written. Ask it again with its continue and stop options only; the brief no longer offers the revise, and the operator decides between going on and stopping. |
| `revise-stretch-has-subrun` | The stretch holds a `workflow:` node, whose child run would be adopted rather than run again. Nothing was written. Validation refuses such a definition, so a run reaching this was frozen from one edited by hand: ask the gate again with continue and stop, and report the message. |
| any `state-*` code | The reset reached the writer and was refused; the writer's table below says what each means. Nothing was written. |

`stopped` is not only a status for unexecuted nodes: a `workflow:` node whose child run stopped
ran, waited and adopted that outcome, so it is recorded `stopped` **with** a summary, mirrored to
`skipped` per *Recording an outcome*. The unexecuted nodes carry none, which tells the two apart.

---

## In-node questions

A gate is not the only question a run asks. A node's prose may ask its own — a clarification,
an opt-in that decides whether a later stretch runs, a decision between approaches, or a loop
that offers a second pass — and those questions are in the node because the graph cannot say
them. They follow the same driver, and only the driver:

| `orchestrator.driver.kind` | An in-node question is |
|---|---|
| absent, or `terminal` | asked in session, exactly as the node prose describes it |
| `cockpit`, `dispatch` | **never asked**; the node takes the default its own prose names, and records that it did |

**Why a default rather than a suspension.** Suspending is gate-shaped: the request document
carries a node id, a kind, a question and its options (`gate.schema.json` declares the shape),
and there is no request kind for a question asked inside a node. So a non-terminal run has two
honest outcomes and no third — take the stated default, or fail. Asking anyway is the defect
this rule exists to prevent: nobody is in the session, and a session hint saying to continue
without asking is not an answer either.

**Every in-node question names its default, in its own node prose.** The prose that asks is
also what says what is taken when nobody can be asked, so a reader never has to infer one. The
families and what each takes:

| The question | What a non-terminal run takes |
|---|---|
| A clarification | nothing is asked; the analysis or the delegate's own answers stand, and the node writes its artifact and sets its flag as a run with nothing to ask already does |
| An opt-in | the recommended option |
| A decision between alternatives | the recommended one; when nothing is recommended, the decision stays open and is recorded as an `open:` risk in the node's summary, which the gate brief renders at the next gate |
| A multi-select | the recommended set its prose names, each member labelled (Recommended) |
| A loop offering another pass | the accept-as-is exit — the pass the loop would have added is not taken, and the following gate is the operator's route back |
| An exhausted recovery budget | the node is recorded `failed`, per *Recording an outcome* |

A multi-select's question text also carries a `Recommended: …` line naming that set. When the
question is asked as one yes/no single-select per option, the `(Recommended)` label goes on
"Yes" for a recommended member and on "No" otherwise.

**What is recorded.** One entry per defaulted question on that node's summary `decisions`
list, as a plain string:

```
defaulted: audit-opt-in -> the recommended option, run the audit
```

The id is the one the node prose names, and the text after the arrow is the default actually
taken — not the option that was recommended in the abstract, the one this run used. A node
that asked nothing because it had nothing to ask records nothing: there was no question to
default. Nothing else changes — the entry is an ordinary decision item, it reaches the
dashboard the way every other decision does, and no new state key is involved.

**A run started under a driver has its inputs.** The first question in a workflow is usually
"what is the task?" or "what is the question?", and under a non-terminal driver it is never
reached: the start brief supplies the inputs and the freeze persists them under
`orchestrator.options.inputs` (see Step 4). If one is nevertheless missing, print
`RUN-FAILED: <code>` and stop. Inventing a task description is the documented failure mode,
and defaulting is not a licence to invent one.

**Two things this rule never defaults past.** It settles who answers, not what may be waived:

- An unresolved critical verification issue is not proceeded past. The default fixes what is
  fixable and records the remainder as `open:` risks in the node's summary, which the
  following gate's brief renders for an operator to see and answer.
- A decision the node owes is still *resolved* rather than skipped. A defaulted decision is a
  resolved one and satisfies a node's own completeness self-check; an unasked, unrecorded,
  unresolved one does not, and a node must not be marked complete with one outstanding.

---

## Sub-runs

A `workflow:` node carrying no `dir:` starts a **child run**: an ordinary task directory beside
the parent's, with its own frozen graph, its own state file and its own driver, linked back by the
child's `orchestrator.parent` — `{run, node}`, written once at the freeze. The parent node holds
`status: waiting` while the child executes and adopts the child's terminal status when it ends.
The full contract — both driver walks, the interruption matrix, the refusal table, the worked
parent/child state pair, the child directory's derivation and the recipe for making a workflow
child-capable — is `references/sub-runs.md`. What the engine must hold in mind at the node:

- **Three writes bracket a start**: W1 the parent node `running`; W2 the whole child freeze, one
  call against the child's state; W3 the parent node `waiting` with `values: {task_path, run_id}`.
  W2 precedes W3, and both precede the write that projects the dashboard, and the marker.
  W2 prints the child's own startup banner; the parent does not relay it.
- **Under a terminal driver the child runs in session** and the turn continues to W4. Under a
  `cockpit` or `dispatch` driver the turn ends at `WAITING-SUBRUN` and the daemon discovers the
  child in its ordinary sweep — the parent drives nothing and spawns nothing.
- **Five checks refuse before anything is created** — a node carrying `dir:`, a run that is
  already a child, a target resolving in none of the four homes, a `with:` map that misses or
  invents an input, and a declared output the child does not expose. **All five are performed
  here, from this prose** — no verb runs them for you. What the graph module contributes is the
  *spelling*: one exported constant is the single source of those four refusal codes, and of them
  only the reserved-name check runs as code, at validate time. The distinction decides what to
  trust: this list is operative for *when* a refusal fires, the module for *how it is named*.
- **`task_path` and `run_id` are reserved** against a `workflow:` node's declared outputs, because
  the node's values map is replaced whole on patch and a child output of either name would be
  merged over the parent's link to its own child.
- **The child directory name is derived, never chosen**, from the parent directory's date and
  slug and the node id, so a parent re-driven after a crash computes the same name and **adopts**
  the existing child instead of starting a second one.
- **Nothing here names a workflow.** A workflow becomes child-capable by declaring an `embedded`
  input, guarding its closing node and declaring a workflow-level `outputs:` block; the engine is
  unchanged either way, and the recipe is in the reference.

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
  `state-patch-invalid`. `node_summaries` merges entry by entry the same way.
- `project_context`, `related_tasks`, `verification_context`, `external_research` — the four
  optional top-level blocks. Each is written as a **top-level sibling** of `orchestrator:`
  and of the context block, never nested inside either. A mapping is merged key by key, so
  one write recording `verification_context.fixes_applied` leaves a `reverify_count` another
  write put there alone; `related_tasks` is a list and is replaced whole, so a caller that
  means to append sends the whole list.

Anything else is an error rather than a silent no-op. The set is pinned against the state
contract by the repository's own suite: a block the contract defines that the writer cannot
reach is a test failure, not something to work around with an editor tool.

### One write per moment

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
| the freeze | it precedes node 1, and is already the merged write of the `workflow:` block, `task.key`, `orchestrator.options.inputs`, `orchestrator.options.html_output`, the two empty phase sequences and the empty `task_ids` (Step 4) |
| `gate-request` | one invocation, three writes, in the order § E2 fixes — a run is pending from the moment its request file lands, so a second shell call against it is denied |
| the empty patch on gate resume | the shell becomes reachable only the instant `gate_pending` goes null, which is what that write re-validates (*Driver-suspended mode — resume*) |

**A fifth pair can never merge, and for a different reason: it lands in two files.** Starting a
sub-run writes the parent's node (W1), then the whole child freeze (W2), then the parent's link
(W3). W2 is a write against the **child's** state file and the other two are against the parent's,
so no patch vocabulary could carry them together however close in time they are — "one write per
moment" is per state file, and a sub-run start is three moments across two runs.

**W2 is one call and must stay one call.** A state carrying a `workflow:` block but no `nodes` and
no `task` reads as *gate-pending* to the enforcement hook's own reader, so a two-call freeze makes
the child look pending between the calls and the second call is denied — a child that can never be
finished and a parent that can never proceed. It is the same reasoning that makes `gate-request`
one call, arriving from the other side.

### When a write is refused

Exit `1` means **nothing was published** — no rename happened and the file on disk is
byte-for-byte what it was. The first token on stderr is the refusal code. The writer has
twenty-five, each with its response below; one more, `edition-collision`, is raised before the
writer runs. Exit `2` carries no code at all and is the table's last row:

| Refusal | Response |
|---|---|
| `state-non-canonical` | The existing file cannot be re-indented safely. Stop with `RUN-FAILED: state-non-canonical`. There is no other interpreter to hand the run to: the operator repairs the file or starts a new task. |
| `state-unreadable`, `state-unwritable`, `state-incomplete`, `state-candidate-unsound` | The directory is not one the engine can own — unreadable, unwritable, a candidate the reader would not accept, or a candidate carrying a duplicate top-level key or one that neither the pre-write file nor the patch introduced. Stop with `RUN-FAILED: <code>`; the operator repairs the directory or starts a new task. **Never re-send the same patch**: the candidate is unsound for a reason the patch cannot change. |
| `value-not-flow-safe` | A declared output cannot go on a one-line entry. Record the node `failed` with that reason and stop with `RUN-FAILED: value-not-flow-safe`. |
| `state-entry-unserializable` | A node entry **already in the file** cannot be re-serialised. The patch is fine; the file needs repair. Stop with `RUN-FAILED: state-entry-unserializable` and report the message verbatim. This is **not** the `value-not-flow-safe` recovery — shortening the value the patch carries changes nothing here, and trying it loops. |
| `state-temp-exists` | The temp twin is on disk and less than a minute old, so another writer holds it — a write takes milliseconds. Nothing was written. **Do not delete anything**: wait a minute and issue the same write again. A temp older than a minute is a crashed writer's leftover, and the next write reclaims it itself. |
| `state-gate-pending-form` | The pending-gate marker has two legal spellings and this was neither. It is written as the literal `null`, or as `{node, request, since}` — `request` being `gates/<node>.request.yml` for that same `node`, and `since` a measured UTC timestamp — which the writer puts on one line itself. Send the marker as an object, never as pre-spelled text: text carrying a trailing comment or a quote reaches the file with its own bytes and the reader throws on it. Stop with `RUN-FAILED: state-gate-pending-form` and report the message verbatim. |
| `state-workflow-frozen` | A `workflow` patch after the freeze differs from the frozen block — a node left out, added or re-typed, or a scalar changed. Nothing was written. The freeze is written once; send node updates under the top-level `nodes` key, never under `workflow`, and never re-type the graph. A re-send identical to the frozen block changes nothing. |
| `state-freeze-unproven` | The freeze's `workflow` block does not re-resolve to its own `graph_hash` — no hash, a source that is not found, an overlay or a profile left out or changed, or a re-spelled hash. Nothing was written. Run `resolve` again with the `--definition`, `--overlay` and `--profile` the run was started with, and freeze with its output copied through (Step 4). When `resolve` itself fails, or the message says the definition cannot be read from the run's directory, stop with `RUN-FAILED: state-freeze-unproven` and report the message verbatim. |
| `state-freeze-name-mismatch` | `workflow.name` is absent, or is not the name of the definition the freeze resolves. Nothing was written. Send the `name` `resolve` printed and freeze again. Never relabel a run to borrow another workflow's context block: every reader keyed by the name would then read it as that workflow. |
| `state-freeze-nodes-mismatch` | The freeze's nodes are not exactly the nodes `resolve` printed — one added, one left out, or one recorded under a kind its node cannot have; the message names each. Nothing was written. Send one entry per resolved node with the kind Step 4 gives it, and freeze again. |
| `state-freeze-input-missing` | The definition requires an input the freeze records no value for. Nothing was written. Add the value the run was started with under `orchestrator.options.inputs` in the same freeze and send it again. When the invocation never carried one, ask the operator for it in a terminal run; a driven run stops with `RUN-FAILED: state-freeze-input-missing`, because an invented input is a defect. |
| `state-node-status-unknown` | A node was sent with a status outside the eight (*Recording an outcome*). The message lists them. Nothing was written. Map the outcome onto one of the eight and send the write again. `in_progress` belongs to the summary vocabulary, and `running` is the node status that means the same. |
| `state-node-regressed` | The patch sends a node that already ended — completed, failed, skipped or stopped — back to `pending`. Nothing was written. A node's record only moves forward: to run it again, re-drive it (`running`), and to redo a stretch the operator sent back, answer the gate with its revise option through `gate-revise`, which resets the stretch in one write and records why. Never rewind a node by hand to make it ready. |
| `state-node-unknown` | The patch names a node the run's frozen graph does not carry. The message lists the nodes it does carry. Nothing was written. Correct the id, which is usually a typo or a phase key used as a node id, and send the write again. Never add a node to a running graph: one the definition gained after the freeze belongs to the next run. |
| `state-value-invalid` | A value recorded under a key the node declares is not of the declared type. The message names the key, the value and the form it should take. Nothing was written. Send the node's whole `values` map again with that key corrected, because values are replaced whole. If the node produced no such value, the node prose decides whether it failed; never coerce one to get past the check. |
| `state-gate-option-unknown` | The gate's summary records an option the gate does not offer. The message lists the ones it does offer. Nothing was written. Record the id of the option the operator actually chose, exactly as the gate spells it and never its label, and send the write again. Never re-ask the gate: the answer was given, and only its spelling was wrong. |
| `state-absent-invalid` | A node summary's `absent` map is not a map, names an artifact the node does not declare, or gives an entry no reason (*Recording an outcome*). The message lists the declared keys. Nothing was written. Name each artifact by its declared key, never by its path, give the reason in a few words, and send the write again. An artifact the node was meant to produce and did not is not an absence to sanction: the node has not completed. |
| `state-patch-invalid`, `state-patch-unknown-key`, `state-inline-collection`, `state-workflow-without-nodes`, `state-workflow-without-task`, `state-context-block-unknown` | The engine built a patch the writer will not apply. Stop with `RUN-FAILED: <code>` and report the writer's message verbatim. |
| `edition-collision` | Two editions of this plugin are enabled in the session's settings, so skills may load from either one. Nothing was written, and no write, whether a start or a resume, will land until one edition is disabled. Relay the message verbatim to the operator, since it names both editions and the command that disables each, and stop with `RUN-FAILED: edition-collision`. Don't retry within this session: the fix takes effect only after Claude Code restarts. |
| exit `2`, `usage: the patch file …` or `usage: the patch in …` | The document never reached the writer: the flag named another file, or the file is missing, empty or not JSON. Nothing was written and the file is kept. Write the document to the run's own `.state-patch.json`, name that path, and run the verb once more; the same message twice is `RUN-FAILED: writer-unavailable`. |
| exit `2`, any other message | The writer itself did not run — a module it imports is missing, or the verb and its flags were malformed. Nothing was published and nothing was even attempted. Stop with `RUN-FAILED: writer-unavailable` and report the message verbatim. |

A `warning:` line on stderr is **not** in this table and never blocks: the dashboard
projection runs after the state rename, so a projection that could not be published leaves the
state write untouched, `dashboard-data.js` simply absent from the reported files, and the exit
code at `0`. Read the next write's output rather than re-sending the patch. The same holds for
the warning that names values a node recorded but does not declare: the write landed with them.
Correct the node prose, or the definition's outputs, before the next run rather than re-sending.

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
summary sent as an inline collection, a patch key outside the closed vocabulary, a phase
summary nested under `context` instead of sent as the top-level key, a context write sent
before the workflow has a name. Fix the patch and re-run; **re-sending the same
patch, or reaching for an editor tool because the script said no, is the failure mode this
whole design removes.** A refusal is a correct answer, not an obstacle.

### When `run-complete` refuses

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
  behind an owed one is owed too. **The recovery is the work that was missed**: resume the run,
  run each named node — or record `skipped` for one whose guard is false — write the closing
  patch again, and run the verb again. A run that cannot finish them ends `failed`, or `stopped`
  with every unexecuted node, instead. Never record a node `completed` that did not run to
  quiet the check. When the definition changed since the freeze no guard can be evaluated, the
  message says so, and a node whose guard is false must be recorded `skipped` through
  `write-state` before the run can close.

`closeout-unpublished` says the run is dispatch-driven and
its outbox holds no close-out for this dispatch, or that the outbox root and the dispatch id
were not given, so nothing could be checked. **The recovery is the step that was missed, not
a retry**: publish the close-out through the umbrella runtime's outbox verb with the grade
and the summary the seed's close-out contract asks for, then run `run-complete` again with
the same `--outbox` root and `--dispatch-id`. Re-running it unchanged only repeats the
refusal, and printing `RUN-COMPLETE` by hand restores the exact silence the check exists to
break: the chain would wait forever on a run that looked finished.

---

## Resume

Read `orchestrator-state.yml`, take the frozen graph from its `workflow:` block, recompute
the ready set from the recorded node statuses, and continue. Resume never re-resolves the
definition: the graph that ran is the graph that resumes. `gate-brief` is the one verb that
re-resolves the definition after the freeze, and it only reads: it re-resolves it to name the
next node and the option ids, and degrades to `Next: unknown` when the definition has drifted.

**A run started by name resumes the same way.** `/maister:run <run directory>` and
`/maister:work <run directory>` take `workflow.name` from the run's state, through
`resume-check` — not from the folder it sits in — and hand it here with the directory as the
resume target.

**A resume declines the same two flags a first run does.** Step 5's rule is not scoped to a
fresh run: `--from=PHASE` and `--reset-attempts` are resume flags, so a resume is where they
usually arrive, and it is where the decline matters most. Resume skips Step 3 and Step 4 — the
graph is already frozen — but never Step 5. Name the flag, say which fact makes it inert, say
that no route in this plugin serves it, and continue.

**Every resume starts with `resume-check`**, run right after Step 2's probe and before anything
else: `resume-check --state=<run directory>/orchestrator-state.yml`. It reads the state and
writes nothing. Exit `0` prints the frozen workflow's `name`, `overlays` and `profile`, and the
run's `dashboard` link: when it is not `null`, show it once as `Dashboard: <link>` as the resume
begins. Exit `1`
is a directory this engine does not resume, and its `message` is written for the operator:

- `written-by-2x` — the state has no `workflow:` block, so the task was started on the 2.x
  plugin and there is no frozen graph to resume. Relay the `message` verbatim and stop. Write
  nothing into the directory, the dashboard included, create no task directory, and print no run
  marker, because no run started. Starting a new task afterwards is an ordinary first run. Every
  workflow runs on this engine, so this holds for a directory under any type folder.
- `state-unreadable` — relay it and stop.

When a gate's revise is still open, the exit-`0` report carries `revision: {gate, option, reruns,
revision, applied}`. `applied: true` means the stretch is reset and waiting to re-run: resume as
usual, and the rerun node's prompt carries the note. `applied: false` means a driven fold recorded
the revise and `gate-revise` never ran: run it first (*Revising at a gate*).

Listing, rendering and viewing a 2.x directory are unaffected; only resuming it is refused.
Step-level resume *inside* a node is that node's prose, not the engine's business.

---

## Operator visibility

The engine honours the framework's contracts; it does not restate them. Follow
`../orchestrator-framework/references/orchestrator-patterns.md` for:

- the **artifact summary contract** (§ 7) in every prompt that asks a delegate to write an
  artifact, with the returned summary lifted into state verbatim rather than re-summarized;
- the **operator dashboard** (§ 8 — the config gate that turns it off and the browser open,
  which stay prose; the viewer itself is installed by the freeze write, Step 4, so an engine run
  copies nothing): on the engine path every successful `write-state` projects
  `dashboard-data.js` itself, so an engine run owes none of moments 1-7 and a projection that
  fails is a warning that never blocks. The projection is the file's only writer: inside the
  implementation and verification phases, which the engine does not enter,
  `implementation-plan-executor` and `implementation-verifier` keep it current by sending
  `write-state` calls, never by writing the file;
- the **HTML companions** (§ 9) and the style guide path passed to artifact-writing
  delegates, following `html-report-style.md`.

**Phases are named by their titles.** A definition's top-level `display:` block may carry
`titles` — node id to a short one-line title — beside `icons`; an overlay or a profile may add or
override either, and neither moves `graph_hash`. The dashboard's phase names and the gate brief's
`Next:` line use them, falling back to the id made readable (`gap-analysis` → `Gap Analysis`);
name phases the same way in the executive summary. The same block's `option_labels` and `headers`
give a gate's options the words an operator picks and its question a short header; the picker
`gate-brief --json` returns uses them. Ids stay wherever something is keyed: state, gate files,
markers and option ids — a gate's answer is recorded by option id, never by label.

**The dashboard link is shown three times, never at a gate**: in the freeze banner as the run
starts, from `resume-check` as a resume begins, and once more at the end as `Dashboard: <link>`,
the last line of the closing text (below) — the same `file://` link the banner or `resume-check`
gave. A run without a dashboard shows none.

**How a run ends depends on who reads its end.**

- **Under an absent or `terminal` driver a person reads it.** The verb's lines are for the
  engine, not for them. Write the closing patch and call `run-complete`; settle any refusal first
  (*When `run-complete` refuses*). Then close with one short wrap-up message:
  - the outcome in plain words: completed, stopped at a named gate with the option taken, or
    failed at a named node;
  - the key files the run wrote;
  - the workflow's own next steps;
  - each `missing-artifact:` line the verb printed, restated in plain words as a file a named
    phase should have written and did not;
  - `Dashboard: <link>` last.

  Never show the raw `missing-artifact:`, `run stopped:` or `RUN-` lines, and never type a
  marker. A child run driven in session is the exception: it runs `run-complete` with no wrap-up,
  because its parent's walk goes on and the parent's own ending carries the wrap-up.
- **Under a `cockpit` or `dispatch` driver tooling reads it,** and everything below applies.

The run's last line is a marker, read by tooling: `RUN-COMPLETE`, `RUN-FAILED: <reason>`, or —
when a turn ends at a sub-run rather than at the run — `WAITING-SUBRUN: <node> run=<child-run-id>`.
**The first two come from a verb; the third is typed.** `RUN-COMPLETE` and `RUN-FAILED` are what
`run-complete` printed — which is what makes a dispatched run's unpublished close-out a
`RUN-FAILED: closeout-unpublished` instead of a silence its chain waits on forever — so for those
two, echo the verb's lines — the `missing-artifact:` lines and a stop's notice above the marker —
and do not type a marker it did not give you. Everything the operator is meant to read at the end —
the executive summary, the full list of next steps and the dashboard link — is printed before the
`run-complete` call, never after it, so the verb's marker stays the last line.
`WAITING-SUBRUN` has no
verb behind it: no tool the engine ships prints that string, and the driver composes the line
itself from the node id and the child run id it has just recorded. That is why its grammar is
spelled out here rather than read off a tool's output — whole line, nothing before or after it,
node id first and `run=` second, no other field and no reordering — and why the two rules are not
in conflict. It matters to whoever trusts the line: a verb marker is the engine's own account of
a run it just closed, while `WAITING-SUBRUN` asserts only what the driver believes it wrote, which
is why W2 and W3 must both land before it is printed and why the child's on-disk state, never the
marker, decides the outcome. *Sub-runs* carries the full version.

A marker carries **no `at=`**: it is not a prompt line and none of them is stamped. And
`WAITING-SUBRUN` is **never printed under an absent or `terminal` driver** — a rule, not an
implication, because the turn does not end there and the line would be one nobody will ever
answer.
The vocabulary and the rule that on-disk state outranks a marker ship with the pro register § 13.

---

## When to use

**Use** when a workflow ships a definition and its orchestrator hands the run over, or when
`/maister:run` hands over a workflow started by name — including when a node of that definition
starts a child run of its own, which is this engine's job and is covered by *Sub-runs*.

**Do not use** to run a definition file by path, to start a chain, to author an eject or an
overlay, to dispatch a `workflow:` node carrying `dir:` into a member repository, or as a
workflow a user starts directly. Each of those is another skill's job — or the cockpit's — and
none of them is reachable by improvising here.
