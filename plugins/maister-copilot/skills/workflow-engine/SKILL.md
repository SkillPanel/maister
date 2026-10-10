---
name: workflow-engine
description: Runs a workflow definition — a graph of nodes with declared needs, guards and outputs — as an orchestrated run. Loads a definition plus any overlays, freezes the resolved graph into task state, executes the ready set, asks gates in session or suspends on them according to the run's driver, and writes every state change through the workflow tooling. Machinery invoked by a workflow's own orchestrator, or by `/maister-copilot:run` for a workflow started by name; not a workflow a user starts directly.
user-invocable: false
---

# Workflow Engine

The execution half of the workflow grammar. A definition file says which nodes exist,
what each one needs, what guards it and what it declares; this skill turns that graph
into a run — one ready set at a time, with state written by a script rather than by a
model holding a file open.

**This is machinery, not a feature.** A user reaches a workflow through that workflow's
own command, whose orchestrator hands the run here with a workflow name — or, for a
workflow the project defines itself, through `/maister-copilot:run <name>`, which looks the name
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

**Everything the user reads follows *Speaking to the user*** (below): your narration, every
question, every summary written for a gate and the closing message. The bar is a first-time
user who can follow the run from the terminal alone.

---

## Initialization

**BEFORE executing any node, you MUST complete these steps:**

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `ask_user` at a gate. They apply only to your discretionary clarifications. Invoke `ask_user` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.

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
canonical shape is read as empty by one reader and as a pending run by another. Half a
writer is worse than none.

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

**A run started by name arrives with more than a name.** `/maister-copilot:run` hands over the bare
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
directory it has. **The freeze creates the folders inside it**: the first folder of every
artifact path the resolved graph declares — `analysis/`, `implementation/`, or whatever a
project's own workflow names — so a node or an agent writing a declared artifact finds its
folder there. A deeper folder, a directory artifact included, is its writer's to create.

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
the one fact a node reads before it asks (*When the policy classes a question*).

**The freeze records the run's autonomy ceiling** as `orchestrator.options.ceiling` when the patch
carries one — a dispatched run's seed names the level to record, beside the driver. The autonomy
ceiling bounds what the run may settle without asking: `approve` < `advice` < `decide`, an
unknown value reading as `approve`. A child run's freeze records the narrower of its parent's
effective autonomy ceiling and its own (*Sub-runs*). After the freeze it may narrow, never widen:
a later write naming a wider level, or removing a recorded one, is dropped with a `note:` line,
and the rest of the patch lands.

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

**The freeze write prints the startup banner first; your next message, before any other call,
tells the user what it says.** The write that installs the `workflow:` block into a file that had
none prints this first, then a blank line, then its changed paths:

```
Tell the user, in your own message before any other call: the workflow and the task, the checkpoints, the directory, the dashboard and the first phase below.
Maister run started: <the workflow's name, made readable>
Task: <task.title, or (untitled)>
Checkpoints: <up to N | one | none> where you decide
Directory: <the run's absolute task directory>
Dashboard: file://<that directory>/dashboard.html   (or: none (html_output is false))
First phase: <the first node's title>
```

The first line is the instruction, not part of the banner. The terminal collapses the call's
output to a one-line count, so the user sees none of it; runs showed the model going straight
on to its next call, and no user ever learned where the run lives. **The run's first message
is yours, composed from the banner — output all of (a)–(d) before any other call:**
a. **What started**: the workflow and the task, in a sentence.
b. **How often the user decides**: the checkpoints, as the banner counts them.
c. **Where it lives**: the directory as an absolute path, and the dashboard link exactly as
   printed (or that there is none) — paths and links are copied, never shortened.
d. **What happens first**: the first phase by its title.

> **ANTI-PATTERN**: Do NOT open the run with "Dashboard is open. Intake found no project
> docs…" or go straight to the next call. The banner is not on the user's screen until you
> write it.

> **SELF-CHECK before the call after the freeze**: does your message since the freeze name the
> workflow and task, the checkpoints, the directory and the dashboard link? If not, STOP and
> write it first.

The banner prints once: a later write that re-sends `workflow:` prints none. That includes a retried
freeze — the identical patch sent again because the first call's output was lost. The retry is
a no-op for the block (no `workflow` path is reported) and prints no banner; the first call's
write stands, and the task directory, the dashboard and the first phase are read off the state
file instead. Take every fact from the freeze's output, never from memory — a directory or a
dashboard link recalled rather than copied drifts from the run it describes. A sub-run child's freeze prints its own banner too; the parent does not relay it, and its node
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
node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs <verb> [flags]
```

The plugin root is this plugin's own directory — the one holding
`.claude-plugin/plugin.json`, two levels above the base directory the loader shows
for this skill. Run the script by that absolute path, never through the variable:
where a command here still reads `${MAISTER_PLUGIN_ROOT}`, write the directory in its
place. The shell expands a variable from its own state, so a call spelled through it
is not the literal path a permission rule or hook can match, and the operator is asked
to approve it. A root holding a space goes in single quotes.

**The invocation is the whole command.** No `cd` in front of it, no `set -e`, no
variable assigned first and used in it, no second command after it, no redirection,
no pipe, no heredoc, no substitution — and never several verbs packed into one shell
script. Flag values are written bare; a path holding a space goes in single quotes,
never double quotes or a backslash.

**A patch or a request document travels in the patch file.** Write the JSON to
`.state-patch.json` in the run directory — beside `orchestrator-state.yml` — with the
file-writing tool (Write, or the host's own file-creating tool), then name it on the call:

```
node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml --patch-file=<run>/.state-patch.json
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

This is not style: a permission rule or hook can recognise this plugin's own call only
in this exact form — the command by its text, the patch file by its name inside a run —
so anything else brings the approval prompt back. The operator's own permission rules
decide: an allow rule for the script, and an edit rule for `**/.state-patch.json`, spare
them the prompts.

One verb, one call. When a step needs two verbs, that is two calls.

| Verb | Flags | Gives |
|---|---|---|
| `validate` | `--definition`, repeatable `--overlay`, `--profile` | `{ok, errors[], warnings[], resolved[]}` on stdout — `resolved` says where each target was found. Every profile the overlays declare is judged, selected or not, and a finding only one profile produces is prefixed with its name. A version 1 document is closed: a key the grammar does not define, at any level, is an error that names the accepted keys, and only a reserved key warns instead. An overlay given without `--definition` is judged on its shape, and a base it names by workflow name must exist — a built-in or a project definition. A workflow in the project's `.maister/workflows/` that says nowhere what it is for — no `description:`, no paragraph under its companion's title — warns `workflow-undescribed`, because `/maister-copilot:work` cannot match a task to it. A gate guarded by a value a non-gate node records that is more than a pure confirmation warns `skip-guard-not-pure:<gate>`: it is asked whatever its guard reads (grammar § 7) |
| `resolve` | `--definition`, `--overlay…`, `--profile` (a profile one of the overlays declares; selecting any other is refused) | the canonical graph, its `graph_hash` **in the spelling state records** — write it through unchanged, never re-spell it — and `tracker_key`, the input the freeze reads for `task.key`, or null |
| `diagram` | same, plus `--out` | deterministic Mermaid text; its header names the overlays (by file name) and the profile applied, and a gate box carries its question and its options as `id: effect` |
| `locate` | optional `--name` (bare or `builtin:`-prefixed); with it, repeatable `--overlay` and `--profile` — the run's own | with a name, where the run-by-name lookup (Step 3) finds it: `{ok, errors[], name, from, definition, overlays[], ignored, companion, title, summary, inputs, dispatches[]}` — `definition` and `overlays` are the `--definition` and `--overlay` values the three verbs above take (the lookup's own, before any the caller adds), a project path written relative to the project root; `inputs` is the definition's declared `inputs:`; `title` is the companion's H1, and `summary` the definition's `description:`, else the paragraph under that H1; `dispatches` names the nodes that carry `dir:` in the graph folded from the definition, every overlay and the profile. Exit `1` when the name is found nowhere, is not a workflow name, finds only an overlay with no built-in beneath it, or finds a file whose `name:` is another. With no name, `{ok, errors[], workflows[]}` — the project's own definitions, each with `name`, `definition`, `title`, `summary`, `chain` and `error`, overlays, built-in names and generated chains left out. Reads only |
| `write-state` | `--state`, `--patch-file` — the patch as JSON in the patch file | the changed paths, one per line; the freeze prints the startup banner and a blank line before them, the model's first message composed from it (Step 4). A write carrying a node's question set adds a blank line and `ask: <id> <id> …`, or `ask: none`, after them: the questions still to ask (*When the policy classes a question*). The answer to the closing checkpoint `held-approval` is written under `node_summaries.held-approval`, and its `status` — alone among ids outside the frozen graph — under `nodes`, as `pending`, `suspended` or `completed` (*The ready set*) |
| `gate-request` | `--state`, `--patch-file` — the request as JSON in the patch file | the files written, one per line |
| `gate-revise` | `--state`, `--node` (the gate), `--option` (its revise option), `--patch-file` — `{note, answered_by?, at?, via?}` in the patch file; without `answered_by`, the operator's own name is stamped, and without `via` the run's driver kind under a `cockpit` or `dispatch` driver, `terminal` otherwise | the changed paths, one per line, then a blank line and `revised: <gate> reruns=<node> revision=<n>/10 reset=<ids>`; the stretch from the option's rerun node to the gate reset in one write, with the note on the gate (§ Gates). With `--node=held-approval` and `--option=revise-<node>`, the stretch is that node and every node downstream of it, the closing node included (*Revising at a gate*) |
| `run-complete` | `--state`, and under a dispatch driver `--outbox` and `--dispatch-id` | the run's closing marker as the **last** line of stdout, with any `missing-artifact:` lines and a stop's notice above it; the refusal on stderr |
| `prior-context` | `--state`, optional `--background` | the prior phases' decisions and risks as markdown on stdout, to paste into a delegate prompt; `--background` frames them as background for a document written for end users, to stay consistent with rather than reproduce — reads the run, writes nothing |
| `gate-brief` | `--state`, `--node` (the gate), and at most one of: `--json` with `--picker=plain` — the profile the asking tool takes — `--checkpoint`, `--request` or `--oneline`; or `--node` (a running node) with `--checkpoint` or `--request` and `--patch-file` — the node's question set as JSON in the patch file | Every form reads the run and writes no state: its one write is the run's `display/next.json`, the panel an editor extension draws above the question (§ Gates). With no form, the brief as text: the summary of each node the gate closes, at most three fixes the run applied, three decisions and three risks by their lead sentences, the `Next:` line — one per continue, named by its label and in the options' order, when the gate's continues set its values — and the `Review:` line, within 1,600 characters. `--checkpoint` prints the **checkpoint**, the one structured object every other form projects from, as JSON: `{version, kind, node, header, ask, headline, progress, next, review, closed, fixes, decisions, risks, recommended, options, grants, approves, run, truncated}`. `fixes` lists what the closing nodes fixed without asking, each `{finding, change, node}`, apart from the decisions; `held`, after `fixes` and present only when a choice waits, lists every choice held for approval across the run, each `{node, question_id, question, decision, class, floor?, rationale?}`, and every form shows it first; `decisions` is grouped by who settled them (`run`, `audit`, `default`, and `operator` as `{count, actors, not_recommended}` — `actors` the answers counted by actor kind, present only when `count` is above zero, and each `not_recommended` entry carrying its `actor_kind`), `risks` by tag, and each option carries its `consequence` — a continue that sets gate values also `sets` and its own `next`, walked on its answer (the top-level `next` is the recommended continue's), and the recommended continue the `reason` a closing node's `recommends` gave, a revise also `reruns`, `revision` and `suggestions`, a stop also `keeps` and `not_run`; `grants` maps each option that declares grants to their names, `{}` when none does, `approves` lists the classified values the gate's continues set, `[]` when the policy classes none, and both pickers and `--oneline` say them in words. `--json` returns the in-session picker projected from it: `{ok, picker, question, header, options[{id, label, description, recommended, preview}], details, more_details, errors, warnings}`. The recommended option comes first, its label already marked `(Recommended)`. The `rich` profile's question is the one-line ask — the finished work, never the destination — its header the short chip, and every option has a `preview`; the `plain` profile's question is the glance followed by the ask, its header the title of the step the gate closes, and its options are titles that carry their consequence; its text keeps the code of inline code but drops the backticks, which a labels-only tool prints as typed (`more_details` keeps them, written out as markdown). Both profiles end with the More details option — `{id: "more-details", details: true}`, never an answer — while the tool has a slot free (`details: "option"`); otherwise the question ends `Type "details" for the full brief.` (`details: "typed"`). `more_details` is the full brief. A revise option adds `note: true`, `reruns`, `revision`, `suggestions[{label, description, note, recommended}]` — none of them recommended — and `note_question`, the note question built for the profile: `{header, question, multi_select, options}`, its `options` empty when there are fewer than two suggestions, its question then asking for the note typed. `--request` prints the whole driven gate request as JSON: `{node, kind, question, context: {summary, artifacts, checkpoint}, options, multi_select}`, ending with `triage` when the applied policy classes the gate and its hash is the run's `policy_hash` (§ Gates), each revise suggestion as `{label, note, recommended}`; with `--reask=<revise option>` its question opens with a sentence saying that option needs a note, every option still offered — the request a driven revise that came without its note is asked again with (§ Revising at a gate), never beside `--patch-file`. With a question set (*In-node questions*), `--checkpoint` prints `{version, kind: question, node, header, ask, headline, progress, questions, run, truncated}` and `--request` a `kind: question` request whose question and options repeat the first question's, with every question under `questions` and the checkpoint under `context.checkpoint`; every question a request carries is one line with no `"`, a line break folded to a space and a double quote turned single, the checkpoint keeping the text as written; the file is read and kept, for the request to be written over it. `--oneline` is that request's one-line summary: every risk prefixed by its tag, then every fix under `Fixed by the run:`, then every decision by who settled it, the `Next:` line with every skipped node — one `Next (<option id>):` line per continue, in the options' order, when the gate's continues set its values — one `revise: <id> reruns=<node> revision=<n>/10` section per revise option still offered, `Recommended: <option id>` and `Run: <dir> · Dashboard: <path>`, all within the same budget. `--node=held-approval` briefs the run's closing checkpoint, in every form (*The ready set*). When the asking node recorded `asking` (*When the policy classes a question*), a question set's `--checkpoint` and `--request` carry only those questions |
| `resume-check` | `--state` | JSON on stdout: the frozen workflow's `name`, `overlays` and `profile` and the run's `dashboard` link (`null` when it has none), or, exit `1`, the refusal of a directory the engine does not resume — a 2.x one among them — with an operator `message` (§ Resume) — reads the run, writes nothing |
| `sync-plan` | `--plan` (the run's `implementation/implementation-plan.md`) | sets the plan companion's `data-group` / `data-step` markers to the plan's checkbox state; JSON on stdout with `written` and the groups the companion has no marker for — idempotent, and a no-op that names its reason when there is no companion or the run's `html_output` is off |

`gate-request` suspends a run at one gate, whole: it writes `gates/<node>.request.yml`, a
regenerated `gates/index.yml`, **and** the pending marker — `orchestrator.gate_pending` plus
the node's `status: suspended`, through the state writer, in that order. The marker is not a
second call, and it cannot be one: a run reads as pending the moment an unanswered request
file sits beside its state, and while the gate is pending the engine's shell calls cannot
run, so a `write-state` issued after the request file never lands — and reversing the two
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
sets are closed and both are in the table below. The options the request carries are the
options the operator is offered.

**A refusal leaves the run unsuspended.** If anything after the request file refuses, the
request file this call published is removed and the index regenerated without it, so the run
is not pending, the shell is still available, and the same call can be re-issued. And a
re-issue that finds its own identical, still-unanswered request file — the shape a kill in
that window leaves — adopts it and finishes the marker rather than refusing, keeping the
gate askable. A file that is answered, or that spells a different question, still refuses.

`run-complete` ends a run and, under a dispatch driver, only once the close-out it owes is
on disk. It takes three flags where the other two state verbs take one, because the outbox
root and the dispatch id belong to the dispatch rather than to the run: the state file
records the driver's kind, and at most the dispatch id, but never the outbox root. A dispatched worker
already holds both — its seed hands them over under exactly these two spellings for the
outbox verb it publishes with — so pass them through unchanged. Omitting them under a
dispatch driver is refused the same way an unpublished close-out is: the verb cannot show
the message landed, and an unprovable close-out is the defect itself. It reads the outbox
through the umbrella runtime's own reader and never builds one of those paths itself.

**`write-state` checks the document it wrote structurally, not against a schema, and that
is deliberate.** It re-reads the candidate through the shared state reader
(`lib/state-scan.mjs`), then holds it to the rules a line-oriented writer can state for
itself: no duplicate key at any column, no top-level block that neither the prior file nor
this patch introduced, and a task, a workflow and a non-empty node map present; a consumer
checkout carries no YAML package and no schema validator. So a document can be structurally
sound and still carry a wrong value. Two things follow for a caller. Send values in the
shapes this skill and the framework document rather than relying on a refusal to catch a
wrong one; and never rewrite the `workflow:`
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
3. **Its `when` guard evaluates true** against the values completed nodes recorded: a task
   node's declared values, or the values a gate's chosen continue option set. A guard of
   several references joined by `||` is true when any of them is. **One exception, the
   skip-guard rule:** a gate whose guard reads a value a non-gate node records, negated or not,
   is asked whatever its guard reads unless it is a pure confirmation — exactly one continue,
   with no `sets` and no `grants` (grammar § 7).

A node whose guard is false, and an `on: failure` node with nothing that failed, is marked
`skipped`, and **a skip satisfies everything downstream** — that is how a definition expresses
an optional phase without any routing construct. `on: always` runs once every need has ended,
however it ended.

**The held rule.** While a choice is held for a person's approval (*When the policy classes a
question*), a gate whose guard reads a task node's value is asked whatever its guard reads, as the
skip-guard rule asks its gates: the first such checkpoint that runs lists the held choices first,
and its continue approves them (*Gates*). A gate guarded only by an input or another gate's value
is still skipped by its guard. A gate the held rule asks whose own work was all skipped is briefed
with `Skipped.` as its *Done* and the held choices first.

**The closing checkpoint `held-approval`.** When no checkpoint follows a held choice, the run
raises one of its own before it closes. `held-approval` is a reserved id, never a node of the
frozen graph, so no definition and no `graph_hash` changes. In a run that records
`classes_questions`, the closing node runs `gate-brief --node=held-approval` before its closing
patch and, under dispatch, before its close-out (*Ending a dispatched run*):
- `gate-brief-nothing-held` — nothing waits: close the run as usual;
- otherwise it is asked like a gate, by the run's driver: in session with the picker, or suspended
  with `gate-request` — the writer accepts its `status` writes for exactly this. Its options are
  continue ("Approve and finish"), one `revise-<node>` per node holding a choice, and stop; the
  `rich` profile's picker lists continue, the two revises nearest the end and stop, and its question
  names the rest, reached by typing. Its progress counts the frozen gates plus one;
- its answer is one `{option}` item under `node_summaries.held-approval`. A continue records the
  approvals, then the closing patch follows; a revise goes through `gate-revise` (*Revising at a
  gate*); a stop ends the run — the closing patch records the closing node and `task.status`
  `stopped` — with the held choices unapproved.

It is askable once nothing is owed but the running closing node; earlier it is refused
`gate-brief-not-askable`, naming what is still owed.

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
  guard keeps off the path — a gate the skip-guard rule asks is never kept off by its guard — is
  refused `run-nodes-unfinished` (*When `run-complete` refuses*), and a run with a held choice
  no approval matches is refused `run-held-unapproved`;
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

**No close-out while a choice is held.** In a run that records `classes_questions`, the closing
node runs `gate-brief --node=held-approval` before it publishes anything, and publishes only
after one of these:
- `gate-brief-nothing-held`: publish as usual;
- a continue: the approvals are recorded, then publish as usual;
- a stop: publish the close-out a stopped dispatch owes;
- the driver's request writer refusing the `held-approval` request: publish the close-out graded
  `failed`, its summary naming each held choice — node, question, choice — as awaiting approval;
  then write the closing patch recording `task.status: completed`, never `failed`, and run
  `run-complete`, which ends the run `RUN-FAILED: run-held-unapproved`. Only a completed run is
  judged for held choices; a failed one would end on a failed-node marker and hide them.

A revise publishes nothing: the stretch, the closing node included, runs again. `run-complete`
judges held choices before the close-out, so a close-out published too early never ends such a
run `RUN-COMPLETE`.

### Delegation by scheme

The node's `uses` names both the mechanism and the target:

| Scheme | How it runs |
|---|---|
| `skill:<name>` | the Skill tool |
| `agent:<name>` | the Task tool |
| `direct:<name>` | inline, by this engine, following the node's section in the definition's prose companion |
| `workflow:<name>` | with no `dir:`, it **starts a child run** — its own task directory, its own frozen graph, its own driver — and the node waits for it (*Sub-runs*). With `dir:` it keeps its dispatch meaning and is refused as a sub-run |

**While a delegate runs, say so — the prompt otherwise looks like it is waiting for the user.**
A delegate runs in the background: your turn ends and the user sees an empty prompt for as long
as it works. So, right after launching a node's delegate, print one line: *"<Phase title> is
running. Nothing needed from you; I'll continue when it finishes."* When a notification brings
you back and the work is not finished yet, print one short progress line — what is done and what
is left — before you wait again. Never predict how long a step will take: a run says where it is,
not when it will be done. An elapsed time a step reports is a fact and may be said as one. When
the run has a dashboard, the run's first such line ends *"Progress is on the dashboard in your
browser."*, and a later one repeats it now and then — after a gate, or on a long wait — never on
every line and never with its path. A run without a dashboard (`html_output` off) says nothing
about one. Questions never name the dashboard; the start banner and the end message keep its
link.

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
saying nothing has been recorded yet. **A delegate writing for end users — a user guide, user
documentation — gets `prior-context --background` instead:** the same items, framed as
background to stay consistent with rather than as content to carry into the document. The
binding framing made a user guide quote every decision and risk of the run in an appendix. Re-using a rendering produced for an earlier
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

Five things reach every delegate without appearing in any node's `with:`, because they
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
- Where scratch copies go. A delegate that needs a throwaway copy — a sandbox for a mutation
  probe, a copy of the project to try a change in — makes it with `mktemp -d` under the system
  temp directory and leaves it there: no cleanup step and no `rm -rf`, which the
  destructive-command guard blocks for most delegates. Say so in every delegate prompt. A
  copy left in the temp directory is not worth mentioning to the user.

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

**Who answered, and how much a person had to see, is recorded with the answer.**
- **Provenance.** An answer may carry `actor`, `on_behalf_of`, `policy`, `evidence` and
  `override_of`; the writer copies each one supplied onto the answer's decision item, and a
  driven answer's from the request file's answer block. An answer given at the terminal — its
  `via` stamped `terminal` — gains `actor: {kind: person, id: <answered_by>}`. A driven answer
  gets no `actor` from the engine, and a `run`, `audit` or `default` settlement carries none.
  The five keys are record-only: `prior-context` never prints them.
- **Triage**, under a policy that classifies the gate (Step 4) and whose hash is the run's
  recorded `policy_hash`: the writer adds `triage` — `{version: 1, class, family, floor?, band?,
  raised_by?}` — to the answer item, and one settlement item per classified value the chosen
  continue `sets` right after it; the gate's answer is still its last decision with an `option`.
  Send the answer only: never compose triage or a settlement item.
- **The checkpoint.** Under the same policy, `approves` lists each classified value across the
  gate's continues as `{node, ref, class, floor?}`, `[]` otherwise — always under the built-in
  default — and `gate-brief --request` ends with the gate's `triage`. `decisions.operator` gains `actors`,
  the answers counted by actor kind (`unknown` for one with none), whenever it counts any, and
  each `not_recommended` entry its `actor_kind`.
- **Approvals.** A continue at a gate — or at `held-approval` — while choices are held for
  approval (*When the policy classes a question*) approves every one of them: right after the
  answer the writer records one item per held choice, `{decision: "<question_id>: <decision>",
  by: operator, node, question_id, triage}`, with the answer's `answered_by`, `via` and
  provenance, and the held item's `attempt` when it has one. The dashboard then marks the choice
  approved, with its approver. A revise or a stop approves nothing. Approvals are history: no later
  write and no revise removes them, and the held item keeps `held: true`. Send the answer only.

### Before every gate — the gate brief

What a gate asks is built by the engine, never written by hand. The engine reads it from the summaries the closing nodes wrote, so what those summaries say is what the user decides on.

- **Every node a gate needs writes a non-empty `summary`** in its closing `node_summaries`
  entry, in the same patch that marks it `completed`, and beside it:
  - **`headline`** — one sentence of at most 220 characters, saying what the stretch since the
    previous gate produced and what it means. The checkpoint opens with it as *Done*. Without it,
    *Done* is the summary's first sentence.
  - **`decisions`** — what was settled, most important first, each as
    `{decision: "<what>", by: <source>}`. `by` is `run` (the step's own work), `audit` (a
    spec audit or a verification review), `default` (a question a driver could not ask, below)
    or `operator` (the user). The gate shows up to three of the `run`, `audit` and `default`
    ones; the user's own answers are only counted. A node's `decisions` hold only what **this
    node** settled. Never restate an earlier answer as this node's decision, whether the user's,
    a default's or another node's, in its words or in yours: it is already recorded where it was
    made, and the gate reads it from there. So before writing `decisions`, read what the run
    already holds — `prior-context` prints every earlier node's decisions — and leave out each
    one already there, including an artifact's own Key Decisions that carry an earlier node's
    choice forward. A node that builds on an earlier answer says so in `summary`.
  - **`fixes_applied`** — what this node fixed without asking, each as
    `{finding: "<what was wrong>", change: "<what changed>"}`, a few words each. A fix is not a
    decision: never record it in `decisions` too. The gate lists the fixes under "Fixed by the
    run", apart from what was settled.
  - **`risks`** — what is not settled, each as `{risk: "<what>", tag: <tag>, change: "<what would
    resolve it>"}`. The tags:
    - `open`: something in this output the user could still change;
    - `tradeoff`: a consequence of a choice already made, kept on purpose;
    - `followup`: something for later, outside this run;
    - `stop`: a reason to recommend stopping;
    - `resolved`: settled since it was raised.

    A node's `risks` hold only what **this node** raised. A risk an earlier node recorded
    stays on that node: never restate it here, in its words or in yours, since the gate already
    reads it there and a restated risk shows twice — so before writing `risks`, read the earlier
    nodes' risks `prior-context` prints and leave out each one already there. A node that settles one retags it
    `resolved` on the node that raised it, as the merge rule below describes.

    Only `open` and `stop` items become a revise's suggested notes, so give each one its `change`.
    Examples: `{risk: "list(null) now throws", tag: open, change: "keep list(null) returning
    every note"}`; `{risk: "Two breaking changes ship under 1.0.0", tag: tradeoff}`.
  - **`artifacts`** may carry a `role`: `primary`, `review`, `evidence` or `log`. Evidence and
    logs are never offered for review. A node may add `metrics`, a list of
    `{label, value, unit?, of?}`.
  - **`recommends`** — on a node closed by a gate with several continues, the one this node
    recommends and why: `{option: <continue option id>, reason: "<one line>"}`, such as the
    audit continue when the run was started asking for an audit. A recommended continue keeps
    every stated criterion, as an in-node recommendation does (*In-node questions*). The brief marks that option
    recommended and shows the reason on it. Without it the continue that turns the most steps on
    is recommended, and a `stop` risk still recommends stopping on a gate that offers a stop. The writer refuses an option
    that is not a continue of a gate waiting on this node, or a missing or multi-line reason,
    with `state-summary-item-invalid`.

  **Findings go in the summary and the headline, never in `risks`.** A risk is something open,
  not something found. Write every field for the user, by *Speaking to the user*: plain words,
  never a state key, a value name, an internal flag, a slug or an unexplained code. Items
  written as strings stay valid and are read the same way, as `open:`, `tradeoff:`,
  `followup:`, `left for later:` and `recommend stop:` prefixes, and an untagged risk reads as
  `open`. Write new items typed. The writer refuses an unknown `by`, tag or role, or a fix
  naming neither its finding nor its change, with `state-summary-item-invalid`. The node prose's "Gate brief content" paragraph names what
  belongs in each field.
- **Every answer the user gives inside a node is recorded** on that node's summary, one
  decision per answered question:
  `{decision, by: operator, question_id, question, answer, recommended, as_recommended}`.
  `recommended` is the text of the recommended answer, and `as_recommended` says whether the
  user took it. `question_id` names the question, never its page or tab group. Never write `answered_by` or `via` for an answer given in session: the writer
  stamps the person's name on every `by: operator` item that names nobody, and a `via` that is the run's driver kind under a `cockpit` or `dispatch` driver and `terminal` otherwise. This is how the gate counts the user's choices and names the ones that differed
  from the recommendation. An answer that came back from a driver's question set is folded
  into the same shape by the writer, `answered_by`, `at` and `via` copied from the answer
  (*In-node questions*). A question a driver could not ask is recorded as
  `{decision: "<what was taken>", by: default, question_id}` (*In-node questions*). Choosing More
  details, or typing "details", is never recorded.
- **Run `gate-brief --state=<state> --node=<gate>` in its own call** — with `--json --picker=plain`
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
  briefed from its question set (*In-node questions*).
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
  close-out, without `--patch-file`.
- **`gate-brief-questions-invalid`**: the set itself is wrong — empty, an id missing or used
  twice, a question with fewer than two options, an option without a label, an option with the
  id `other` (reserved for an answer in the operator's own words), two recommended in a single choice, a `default` naming no option, or a key the set does not have. The message
  names the question and the field. Nothing is written. Correct the question set in the patch
  file and run the verb again. It also refuses a set lacking an id the classing write left to
  ask: send the same set the writer classed.
- **`gate-brief-nothing-to-ask`**: the writer settled every question in the set (*When the policy
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

**The checkpoint covers the whole stretch the gate closes.** That is every node the gate needs
and, after them, every other node back to the previous gate that recorded a summary, including
any node an overlay placed before this gate. Their decisions and risks are pooled, each tagged
with the node that recorded it; an item two of them recorded is kept once. A `stop` risk from
any of them makes the stop option the recommended one. A node the gate needs that was skipped
and wrote no summary reads `Skipped.`. A summary further back never stands in for the closing
node's own, and neither does a skipped node: without one, the brief is refused
`gate-brief-no-summary` — unless a held choice is why the gate is asked (*The ready set*), when
its *Done* reads `Skipped.` and the held choices lead.

**What the checkpoint holds, and how each surface shows it:**

- **The ask** is one line, generated as `<what finished> Ready to go on?` at every gate: it asks
  about the work the gate approves, never where the run goes, which each continue option's label
  and the `Next:` line say. What finished is the lead of the gate's `ask:`, or the closing step's
  title and `complete.`; an `ask:` that does not ask to continue is kept as written.
- **Held choices come first** on every surface — the glance, More details, the plain and one-line
  briefs, the request and the panel — whenever a choice waits for approval: each its question, the
  choice and the step that made it. Trimming cuts them last, and never below one with a pointer to
  the rest. Without a held choice nothing here appears.
- **The glance** is each continue option's preview, and in the `plain` profile it is the question
  above the ask. It holds:
  - *Done*: the headline;
  - *Next*: the phase that runs, and any work skipped on the way. A gate whose continues set
    its values walks each one on its own answer: each continue's preview names where it leads,
    and the `plain` profile's glance gives each its own *Next* line, named by its label;
  - *Review*: up to three files, named by their paths inside the task folder, the main
    documents (`role: primary`) first. When there are more, a step's files inside one of its
    declared output folders are named once, by that folder with a closing `/`, so a stretch
    that drew several screens never loses one to the limit;
  - *Open risks*: up to three `stop` and `open` risks, a stop first, each without its change;
  - *Fixed by the run: N*: how many fixes the run applied, with up to three listed, each its
    finding and its change;
  - *Decided by …*: up to three decisions, each followed by the step that settled it ("—
    verification"), or by "— audit" or "— default", under a heading naming those sources
    ("Decided by the audit");
  - one counted line for the user's own choices, naming at most two that differ from the
    recommendation.

  A trade-off, a follow-up or a settled risk is never shown at a glance. It stays within nine
  lines and 900 characters: when they run short, the decisions give way before the fixes and
  both before the risks, and each list cut says how many more are under More details.
- **The revise preview** names what re-runs and how often this checkpoint has sent the run
  back, then the suggested notes, each whole: a `stop` or `open` item's risk, then its `change`.
- **The stop preview** says what is kept and what will not run. When a `stop` risk recommends
  stopping, Stop is the focused option and its preview opens with *Why stop*.
- **More details** previews the full brief, every fix included, risks grouped as Open,
  Trade-offs accepted and Follow-ups, and the recommended continue's reason whole, within 2,000
  characters. `more_details` is the same text, whole.
- **The driven request** carries the checkpoint itself as `context.checkpoint`, beside the
  one-line `context.summary` that older readers take. Its `Next:`, `Recommended:` and run
  sections are never trimmed.

### Terminal mode — asked and answered in one turn

1. **Asks it in session** with `ask_user`, built from `gate-brief --json`. **What you
   write before it is one lead-in line at most** ("The specification is ready."), never a brief
   of your own. The picker carries everything the user needs: the ask, the glance, what each
   option does, and the full brief one More details away. A second brief written above it only
   repeats what the user is about to read.

   **The picker is built field by field, never by hand.** `question` is the question, verbatim.
   `header` is the header. `options` are the options, in the order given, each shown by its
   `label` exactly as given — the recommended one first, already reading `(Recommended)`.
   The question tool takes a message and a form rather than these fields by name. Pass
   `question` whole as the `message`, verbatim: never reworded, shortened or moved into the
   form, even after More details has written the brief out. Its last line is the ask, so the ask
   stays on screen while the user decides. The form has one property, titled by `header`, whose
   choices are the options in the order given — each option's `id` as the value and its `label`
   as the title, which already says what the option does — with the recommended one as the
   default. After More details, the gate is asked again with the same `question`, verbatim, as
   the `message`.

   > **SELF-CHECK before the `ask_user` call** (the gate SELF-CHECK): is the `message`
   > you pass exactly `question`, every line through the ask? Is what you wrote before it one
   > line at most? If you shortened, reworded or split it, STOP and pass it whole. Then ask.

   Where the picker has no header or no description, leave them out; the labels still carry the
   choice. The recorded answer is the chosen option's `id`, never its label. **The
   `more-details` option is never recorded**: it is the More details request (*In-node
   questions*), and the writer refuses it as an answer.
   Write `more_details` out as your message, as given, then ask this gate again with the same
   picker, in the same turn.
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
`null`. A request file without a marker would be a gate nothing enforces, which is worse
than no gate at all.

**Why nothing is marked pending.** Asking and answering inside one turn means nothing is
ever awaited across turns, so nothing needs marking.

**A pending gate in another run can still stop this one.** Where pending gates are enforced,
a write may be refused naming a different, abandoned run.

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
   is pending yet: the node id, the kind, the question, its options and the multi-choice
   flag. **That document is `gate-brief --request` output, as it stands.** Write the verb's
   stdout into the patch file, unchanged; compose nothing and edit nothing in it. It carries
   the generated ask as the question, every option with its label, what it does and the
   recommendation, `context.summary` (the one-line form), `context.artifacts` (the files to
   review) and `context.checkpoint`. `since` is the request's own `asked_at`, so the marker and the file
   agree about when the operator was asked.
   The gate card the operator sees lands inside this same write, alongside the pending marker,
   so nothing needs writing after it.
   **There is no second call here, and there must not be**: the run is pending from the moment
   the request file lands, and while the gate is pending the engine's shell calls cannot run.
3. `GATE-PENDING: <node>` is printed as the **last** line of the turn.
4. The turn ends. Nothing polls, nothing waits, no session is left idle.

**A running node suspends on a question set the same way** (*In-node questions*): the node
writes its set to the patch file, `gate-brief --request` reads it from there and prints a
`kind: question` request, that output is written over the patch file unchanged, and
`gate-request` takes it. The node is `suspended` while the operator answers, exactly as a gate
is.

**Step 1 is the whole mechanism.** While a gate is pending, only the files the answer is
recorded into can be written. Holding step 1 means nothing in the run ever needs to be
written after step 2: the writes a pending gate would hold back already happened. The same
reasoning is why step 2 is one call — a run is pending from its first write, and its second
write would come too late. A write belonging to a *different* run can be held back by this
run's pending gate as well — the cross-run case described above, with the operator recovery
given there.

The run is suspended the moment step 2's marker publishes. **The commit point is
`gate_pending` back to `null`, and that is written on resume, not here.**

**A sub-run suspends on the same shape, with its own two writes in place of step 2.** The child
freeze (W2) and the parent's record of the link (W3) both complete **before** the write that
projects the dashboard and before `WAITING-SUBRUN` is printed, and that ordering is the contract rather than a
convenience. A gate pending in a run whose `driver.session.id` is absent holds back *every*
session's writes, so a child that suspends while a parent write is still outstanding would stop
that write, and the parent could no longer record the link it has already created. This is the umbrella's "the ledger
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

While the gate is pending, the engine's shell calls cannot run, so the state writer is
unreachable and the decision is recorded with editor tools, on the files this step writes
and no others. This is the one sanctioned exception to "never edit state with an editor tool",
and it is narrow: it lasts exactly until the marker is null, and it ends with an immediate
re-validation through the writer.

1. Read the request file and the state with read-only tools; those are answered before any
   state is read.
2. Validate the answer against the request's own option ids. Not one of them → print
   `GATE-INVALID: <reason>`, write nothing, stay suspended.
3. `gate_pending` already `null` → print `GATE-ALREADY-ANSWERED`, write nothing. A gate is
   answered once.
4. Otherwise record, **in this order**: the `answer:` block in `gates/<node>.request.yml` —
   the answer file's `answer` block copied whole, **less `grants`**, which never lands in a
   request's answer — then `node_summaries.<node>` and the node's `status: completed`, then
   **`gate_pending: null` last**. The order matters because the marker is what keeps the run
   pending: clearing it first would end the suspension before the decision was recorded.
5. The instant the marker is null the gate is no longer pending, so the very next action is
   `write-state --state=<state>` with the empty patch, `{}`, as the patch file's body (§ The
   invocation contract) — the marker is already null, so the file may be written. It is
   not a no-op: the writer reads the file the editor tools just wrote, self-checks it through
   the shared state reader, and re-publishes it. The expected change is
   `orchestrator.updated`; the gate's values, when the chosen continue sets any, recorded on
   its entry from the answer the editor tools wrote; the provenance keys (`actor`,
   `on_behalf_of`, `policy`, `evidence`, `override_of`) copied from the request's answer block
   onto the gate's answer item where it lacks them; and, under a policy that classifies the
   gate, that item's `triage` and one settlement item per classified value. None of that is
   drift. The same write regenerates
   `gates/index.yml`, closing the answered gate's row. This is what keeps the editor-
   tool exception honest — model-authored state is accepted only after the writer has read
   it back and agreed.
6. A refusal at step 5 is `RUN-FAILED: <code>`, reported verbatim, and the run
   stops there: the operator repairs the directory or starts a new task. **Never repair the state file to get past it** — a
   refusal there means the recorded decision did not survive the reader, and editing further
   with the same tools that produced it compounds the drift instead of clearing it.

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
   file and records one `by: operator` decision per question — the question, the answer in the
   option's words, the recommended answer and whether it was taken, who answered, when and
   through what, and the block's provenance keys — never its `grants`. Compose none of it. Then continue the node from what it wrote to disk before
   it asked.

A refusal at step 3 is `state-question-answer-invalid` (*When a write is refused*).

**`held-approval` answered.** A `GATE-ANSWER` at the closing checkpoint is folded as a gate's
answer, its status written `completed`. The suspend left the closing node `running`, and a
running node is never in the ready set, so do not take the ready set first:
- after a continue — the empty-patch re-validation records the approvals — or a stop, carry on
  with the closing node at its close-out step (*Ending a dispatched run*);
- after a revise, run `gate-revise --node=held-approval` with the note, as *Revising at a gate*
  says; it resets the stretch, the closing node included, and then the ready set is taken.
  `resume-check` reports such a revise `applied: false` until it has run.

### Choosing a stop option

A stop option ends the run, and ends it completely:

- `task.status` becomes `stopped`;
- **every unexecuted node is recorded `stopped`**, the final node included;
- no further node executes, and no completion or summary node gets a courtesy run.

A stopped run is a legitimate outcome, not a failure. Do not print `RUN-FAILED` for one, and
never re-ask a gate the operator has already answered — a gate a revise reset is the one gate
asked again, because the operator asked for exactly that, and a driven revise that came without
its note is asked again for it (*Revising at a gate*).

### Revising at a gate

A revise option sends the run back: the stretch from the option's `reruns` node to the gate runs
again with the operator's note, and the gate is asked again once it has. The grammar's § 6 has
the rule; here is what the engine does with the answer.

**Terminal mode.** When the operator picks an option whose `note` is `true`, ask what should change
before writing anything, and ask it at once: the question is the very next call after the gate's
answer, built from the `gate-brief --json` output the gate was asked from. Everything it needs is
already there, so run no second `gate-brief`, read none of the stretch's artifacts, compose no
suggestions of your own and print nothing in between — the operator who chose revise is waiting
on this question. Offer that option's `suggestions` to pick from, multi-select, built field
by field from that option's `note_question` — its `header`, its `question`, which says what
re-runs and how often this checkpoint has sent the run back, multi-select, and its `options` in
the order given, each by its `label` and, where it has one, its `description`. No suggestion is
recommended, marked `(Recommended)` or chosen in advance: a user who came to type a note never
has to untick one. The operator's typed answer, through Other, is added to whatever they chose. The note is the chosen suggestions' `note`s — `note_question.options` and `suggestions` are in the same order — joined by `; `, then the
typed text. When `note_question.options` is empty, the stretch left fewer than two open items
and a picker cannot list fewer than two, so there is nothing to pick: ask its `question` as text,
verbatim, and the reply is the note — a reply of "yes" sends the one suggestion's `note`. When nothing is chosen and nothing typed, there is no note: ask the gate again from
its brief. Then write `{"note": "<the note>"}` to the patch file and run `gate-revise
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
in its next attempt, the way a gate is asked again after a revise, its question opening with a
sentence saying that option needs a note, every option still offered. A gate asks once per attempt,
which is why the attempt is raised.

**What a driver asks again, and with which flag.** Two requests are asked again after a revise,
each from `gate-brief --request`, and never together:

- *A gate*, asked again in its next attempt: after a revise re-ran its stretch, with no flag; after
  a revise that came without its note, with `--reask=<the option id>`, whose request opens by
  asking for the note. Either counts in "Asked again N times".
- *A node's question set*, asked again because a revise re-ran the node: with `--patch-file`, as
  in its first attempt. Nothing about the earlier answer was missing, so there is nothing for
  `--reask` to name, and the verb refuses the two flags together. The request writer stamps the
  new attempt; the fold keeps the earlier attempt's answers as history (*In-node questions*).

**A revise is never recommended.** The brief recommends a continue option — the one the closing
node's `recommends` names, else the first — or a stop when a closing risk says so; a revise is the operator's choice. A driver that defaults an answer never
defaults to one.

**What the reset leaves.** Every node of the stretch is `pending` with its clocks and values gone
and its `attempt` one higher; a guarded node in it is judged again once the rerun node records
its values, and a gate in it is asked again. The option's description names only the nodes that
will run again: one whose guard reads an input or a node outside the stretch, and reads false
now, is reset and skipped again, so it is not named. The summaries stay until the nodes re-complete and
rewrite them field by field, so the brief and the prior context still show what the previous attempt
found, and the answers the user gave in the first attempt stay on them (*Writing state*). The
gate's decisions keep every revise — its note, the attempt and the target — and a later answer at
the gate is added after them, never over them.

**A ceiling, not a budget.** A revise the user chooses is theirs to make as often as they want;
the engine holds only a safety ceiling of ten per gate, against a runaway loop. A revise option says
how often its gate has been asked again so far ("Asked again 2 times so far at this checkpoint"),
counted from the gate's attempt, so a revise asked again for its missing note is in the count, and
names an earlier revise of the same document at another gate, never "revision 2 of 3". At the
ceiling the brief stops offering the option and its `Next:` line says no revises are left at this
checkpoint, leaving continue and stop; the verb refuses an eleventh. The driven form keeps its
`revision=<k>/<ceiling>` shape for the readers that parse it.

**Resume.** A run caught between a driven fold and `gate-revise` — the gate `completed`, its last
decision a revise option without an `attempt` — is found by `resume-check`, whose `revision`
field says `applied: false`. Run `gate-revise` for it before anything else, with the note from the
answer file; do not walk the ready set first, or the run moves past the gate as if the answer
had been continue.

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
| `revise-option-unknown` | `--option` is not one of the gate's revise options; the message lists them. Nothing was written. Correct the id — the option's id, never its label. A continue or a stop is recorded as an ordinary answer (*Terminal mode*), not through this verb. |
| `revise-note-missing` | The patch file carries no note, an empty one, or an `at` that is not a UTC timestamp. Nothing was written and the patch file is kept. Put the note the operator gave — the chosen suggestions and anything typed — into it, send the answer's own stamp or no `at` at all, and run the verb again. |
| `revise-gate-not-current` | The gate is not the question the run is asking: something it waits on has not ended, it is already answered, a revise already reset it, or a driver's answer is still awaited. Nothing was written. Do not repeat the call; take the ready set from the state and ask the gate the run is actually at. A second call after a revise that landed is refused this way, which is what makes it safe. |
| `revise-budget-exhausted` | The gate has reached its safety ceiling of ten revisions: no revises are left at this checkpoint. Nothing was written. Ask it again with its continue and stop options only; the brief no longer offers the revise, and the user decides between going on and stopping. |
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

| The run's driver | An in-node question is |
|---|---|
| absent, or `kind: terminal` | asked in session, exactly as the node prose describes it |
| `kind: cockpit` whose `features` list `question-sets` | **suspended to the operator** as one question set (*When a question suspends*) |
| any other — `dispatch`, or a cockpit without that feature | **never asked**; the node takes the default its own prose names, and records that it did |

`orchestrator.driver.features` is the driver's own list of what it carries, seeded by whatever
started the run; the engine only reads it. `question-sets` means the driver can show a set of
questions to the operator in one request and write the answers back. An absent list, or one
without that value, means it cannot. Decide this once, when the run starts, like the gate mode.

**Asked in session, a question offers answers, never their categories.** A question that
invites a correction or an addition offers the corrections and additions themselves: concrete
candidates generated from what the node found — its open gaps and its weakest inferences — each
one an answer that can be folded in as it stands, beside the option that changes nothing, with the
user's own words through Other folded in as typed. Never offer an option such as "add
something" whose only effect is a second question asking what kind of thing to add: each such
step costs the user a round trip, and the answer still ends up typed.

**A recommended set is offered as one single choice, never as empty checkboxes.** A multi-select
cannot pre-tick anything, so a recommended set shown as checkboxes is shown empty, and a user who
presses Next drops every option the run recommended. Offer the bundles instead, as one
single-select — "All four reviews (Recommended) / Code review only / Choose individually" — the
recommended bundle first, and open a multi-select only behind "Choose individually". An empty
set the user may want is a bundle of its own ("No extra constraints"), never an unticked
recommendation.

**A question carries its own context, and never points at "above".** This is the floor, on
every tool. Whatever a question or a tab refers to travels in its own text: an assumption to
confirm is stated in its tab, an issue to decide carries its file, line and what is wrong in its
tab, an "Accept all N" question lists the N items, one line each, a draft to approve is named
with what it settles, a retry-or-skip question says what failed and why, and a decision area's
question names the area, why it matters and each alternative in a line. Each option's description says what choosing it does or costs; where the
tool shows no option descriptions, that goes in the question, a line per option. Text
printed before the picker may never reach the screen — the terminal collapses tool output and
can show its own recap in place of a silent turn — so "the three assumptions above" asks the
user to confirm what they never saw. A message composed above a question is still welcome,
decision areas' and gates' included; nothing the user needs may depend on it.

**More details — one request, one rule.** Offer **More details** as the last option of every
question whose full context is longer than its question and descriptions hold: a gate (the
gate brief lists it), a decision area, a draft or section to approve, a page of fix-loop
decisions, assumptions to confirm. Its description: "Write out the full context, then ask this
again. Nothing is recorded." When the options already fill the tool's slots, end the question
with `Type "details" for the full context.` instead; a typed "details" is the same request.
Choosing it is **not an answer**: nothing is recorded, no state is written, and the question
stays open. Your next message is the full context, and the call after it is the same question,
with the same options, in the same turn:
1. **At a gate**: `more_details` from the picker output, as given — every closing node's summary
   by its title, every decision with who settled it, the risks grouped by tag, and the files
   to open — then the gate again. Where the More details option previews it, the gate is asked
   again at once instead (*Terminal mode*).
2. **At a decision area**: every alternative, each with a two-to-three-sentence description,
   its pros and its cons; then the recommendation and why; then the same area again.
3. **At any other question**: the full context of each item — an issue's file, line, what is
   wrong and what each option changes; an assumption and what it rests on; a draft or section
   in full; a failure's cause and what each way on would do — then the same question again.

> **ANTI-PATTERN**: Do NOT record More details, or treat it as a choice and move on. It asked
> for text, and the question is still unanswered.
>
> **ANTI-PATTERN**: Do NOT answer More details with headlines, a summary of the summary or a
> pointer to a report or the dashboard. What the user asked for is the text the screen did not
> show them.

> **SELF-CHECK after More details is chosen**: does your message enumerate every item the
> question rests on, whole? Is your next call the same question with the same options? If not,
> STOP and write it first.

Under a driver More details is never taken: a question set carries each question's full
context in its own fields, `why` and the options' descriptions, and the cockpit shows it.

**Ask only what the run does not know.** A question whose answer earlier phases already
recorded — visual assets or browser checks for a change the analysis found has no user
interface — is not asked: say the answer in one line where the question would have been
("Browser verification: off — this change has no user interface") and record it as the node
records an answered one.

**A recommendation never drops or narrows what was asked for.** The task states what done means
— its description, its acceptance criteria or "done when" lines, the research question — and the
recommended option keeps every one of them. An option that narrows one may still be offered, its
description naming the criterion it gives up, but it is never the recommendation, however much
smaller or closer to the existing code it is. Before recommending, read what earlier steps left
uncertain: the `open` risks in `prior-context` and the open questions of any research the run
imported. Where one of them says a criterion may be read two ways, recommend the reading that
keeps every criterion whole, and say so in the question ("Recommended because it keeps 'lists
shared notes', which the context checkpoint flagged as uncertain"). The person may still choose
the narrower reading; the run never makes it the default.

**Independent items go in pages; decision areas go one at a time.**
A picker call holds up to four questions, one tab each. Items that stand on their own — the fix
loop's per-issue decisions, confirmations of the run's own assumptions — are asked four to a
page, further pages following in the same turn. A later page opens by saying, in one line, how
many questions are left ("Two more scope questions"), so the user knows the end is near.
The question tool takes a message and a form: a page is one call whose form has a property per
question, each titled by its header, with its question — its own context included — as the
property's description and its options as the choices, each option's id as the value and its
label as the title, the recommended one as the default. The message names what the page is
about, and on a later page how many questions are left. A multi-select is one property of type
array whose items are the options, any of them, the recommended ones as its default.

The form shows no option descriptions, so a recommendation's reason rides in the question: the
property's description ends "Recommended: <option>, because <reason>." Write the form as plain
text, because it shows markdown as typed: no `**`, no backticks and no list markers in the
message or a description. A property's title is a short noun phrase in sentence case, with
nothing after its last word — the form adds a colon of its own, so "Explore alternatives?"
reads "Explore alternatives?:" — and every word spelled out: "Specification", never "Spec".
For assumption confirmations alone, "Accept all N as stated (Recommended)" may come
first — its question listing the N assumptions, one line each — going through the items only
when the user asks to. **Decision areas are never paged and
never offered as accept-all**: research's solution convergence, product design's convergence and
direction areas, and any step whose choices shape what comes next are asked one area per call,
each with its full context — every alternative's description, pros and cons, and the
recommendation with its reason — because a later area can depend on an earlier answer and the
user needs that context to decide. That context rides in the area's own question: the question
names the area, why it matters, each alternative in a line, and the recommendation with its
reason; each alternative's key pro and
con, in a few words, is its option's description — or its line in the question, where the tool
shows no descriptions; the full description, pros and cons are
in its preview where the tool shows previews; and More details is offered while a slot is free.
An area with more alternatives than the options hold offers the recommended one and its
strongest rivals, names the rest in the question, and the user reaches them by typing.
In a decision area, the message's last line before the ask is the recommendation:
"Recommended: <alternative> — <reason>."

### When a question suspends

Under a driver that carries question sets, a node asks what it would have asked in session —
the clarifications, the opt-ins, the decisions, the bundles — and suspends on them instead of
taking their defaults. Four rules hold:

- **One request per node attempt, carrying every question.** At its first asking point the node
  gathers every question it can form there into one set, one entry per question, and suspends
  once. A node cannot ask a second time in the same attempt, so a question that only exists
  after an answer or a pass — a follow-up, another refinement round, a retry after a spent
  budget, the fix loop's stopping point — takes its named default below.
- **Write before asking.** Whatever the node needs after the answer — its analysis, its draft,
  the candidates each option stands for — is on disk before it suspends. The answer may come
  back to a fresh session that never saw this conversation, and it continues from the files.
- **No cap.** A set holds as many questions as the node has. The four-to-a-page limit belongs to
  the terminal picker, which pages a long set in one turn; it is never written into a request.
- **Each question carries its own context**, by the floor above: `question` the question itself,
  `why` what makes it matter, each option's `description` what choosing it does or costs, and
  `recommended` on the recommended option, its reason in its description. `header` is a short
  sentence-case title. The multi-choice flag and `allow_other` (the operator's own words, on
  unless said) are per question. `default` is what a non-answer would take, the recommendation when
  absent. `triage` is reserved and passed through unread.

How it runs: the node writes `{ask?, headline?, questions: [...]}` to the patch file, runs
`gate-brief --request --patch-file=<the patch file>` for itself, and suspends exactly as a gate
does (*Driver-suspended mode — the write order*). The answer is folded as *A question set
answered* says, and the node carries on `running` with the answers recorded on its summary.
A node a gate's revise re-ran asks again in its new attempt (*Revising at a gate*), and the
operator's earlier answers are not lost: the writer keeps them on the summary, each stamped with
the `attempt` it was given in, ahead of the new answers, which carry theirs, even when the new
attempt words a question differently — the `question_id` is the question across attempts. The
earlier ones are history. The gate brief neither lists nor counts them, and the dashboard shows
them as earlier answers.
Anywhere else — no feature, `dispatch`, or a set the verb refuses as unsupported — nothing is
asked and the default is taken. Asking in session anyway is never right: nobody is there, and a
session hint saying to continue without asking is not an answer either.

### When nobody can be asked

**Every in-node question names its default, in its own node prose.** The prose that asks is
also what says what is taken when nobody can be asked — under a driver without question sets,
or for a question a node reaches after it has already asked — so a reader never has to infer
one. The families and what each takes:

| The question | What is taken when it cannot be asked |
|---|---|
| A clarification | nothing is asked; the analysis or the delegate's own answers stand, and the node writes its artifact and sets its flag as a run with nothing to ask already does |
| An opt-in | the recommended option |
| A decision between alternatives | the recommended one; when nothing is recommended, the decision stays open and is recorded as an `open` risk in the node's summary, which the next gate's More details shows |
| A set offered as bundles | the recommended bundle |
| A loop offering another pass | the accept-as-is exit — the pass the loop would have added is not taken, and the following gate is the operator's route back |
| A decision page of the automatic fix loop | nothing is asked; each issue stays open as an `open` risk for the gate |
| The automatic fix loop's stopping point | "Continue as is" — the open issues become `open` risks for the gate |
| An exhausted recovery budget | the node is recorded `failed`, per *Recording an outcome* |

`(Recommended)` appears once per question, on the recommended option, and that option's
description gives the reason — or, where the tool shows no option descriptions, the question
does. Behind "Choose individually", no option carries the label: the
bundle already carried the recommendation.

**What is recorded.** One entry per defaulted question on that node's summary `decisions`
list:

```
{decision: "All four reviews", by: default, question_id: standard-verifications}
```

`question_id` is the id the node prose names, and `decision` is the default actually taken —
not the option that was recommended in the abstract, but the one this run used. A node that
asked nothing because it had nothing to ask records nothing: there was no question to
default. An answered question is recorded the same way, `by: operator`, with the question and
the answer (*Before every gate*). The older string form, `defaulted: <id> -> <taken>`, is
still read as `by: default`. The entry is an ordinary decision item and reaches the dashboard
like every other decision.

**A run started under a driver has its inputs.** The first question in a workflow is usually
"what is the task?" or "what is the question?", and under a non-terminal driver it is never
reached: the start brief supplies the inputs and the freeze persists them under
`orchestrator.options.inputs` (see Step 4). If one is nevertheless missing, print
`RUN-FAILED: <code>` and stop. Inventing a task description is the documented failure mode,
and defaulting is not a licence to invent one.

**Two things this rule never defaults past.** It settles who answers, not what may be waived:

- An unresolved critical verification issue is not proceeded past. The automatic fix loop
  fixes what is fixable and not risky, within its two re-checks, in every mode, and records
  the remainder as `open` risks in the node's summary, which the following gate's brief
  renders for a person to see and answer.
- A decision the node owes is still *resolved* rather than skipped. A defaulted decision is a
  resolved one and satisfies a node's own completeness self-check; an unasked, unrecorded,
  unresolved one does not, and a node must not be marked complete with one outstanding.

### When the policy classes a question

**The fact.** Everything above holds in every run. When the freeze recorded
`orchestrator.classes_questions: true` (Step 4), the autonomy policy the run applies classes
in-node questions too, and one step comes first. Without the fact — always under the built-in
default — skip this subsection: nothing in it is written or called, and the node asks exactly as
above.

**The classing write.** At its asking point, before it asks anything or suspends, the node sends
the set it would ask to the writer, in one `write-state` patch on its own summary:
`node_summaries.<node>.question_set` — the same `{ask?, headline?, questions}` object the cockpit
form takes — and, optionally, `node_summaries.<node>.reasons`, `{<question id>: {rationale?,
assumption?, reversal?}}`, each one line. The writer consumes both and stores neither as sent. It
classes each question under the policy and the run's autonomy ceiling, records the outcome on the
node's `decisions`, stores the ids still to ask as the node's `asking`, and prints them last:

```
node_summaries.scoping

ask: scope-choice
```

**The four outcomes.** A question the policy does not class is left to ask, with no triage; a
classed one takes one of four outcomes, by its class, the autonomy ceiling and whether anybody can
be asked — a terminal run, or a cockpit carrying question sets:

| Outcome | When | The writer records | The node |
|---|---|---|---|
| settled | the class is within what the autonomy ceiling settles — never a consult or approval class; any driver | `by: run`, with the rationale and the triage | takes it; never asks it |
| asked | above the autonomy ceiling, and somebody can be asked | nothing; the id is printed under `ask:` | asks it, as the sections above say |
| defaulted | above it, nobody can be asked; a consult-class one is marked advice not obtained | `by: default`, with the triage | takes it |
| held | an approval-class question nobody can be asked | `by: default`, its triage `held: true` | goes on provisionally with it |

Under a terminal driver ask in session only the ids printed under `ask:`; under a cockpit with
question sets the request carries only those (*When a question suspends*); under any other
driver they are the unclassed ones, and each takes its named default, recorded as *When nobody can
be asked* says. `ask: none` means nothing is left to ask: ask nothing, suspend on nothing, and
carry on. Every question that will be classed names a default — a recommended option or its
`default` — or the write is refused `state-patch-invalid`.

**A held choice is provisional.** It shapes only the node's own work, and nothing irreversible is
done on its strength — nothing pushed, published, sent or deleted — before a person approves it.
It forces the next checkpoint that runs and is listed first there, and that checkpoint's continue
approves it (*The ready set*, *Gates*); when no checkpoint follows, the closing node asks
`held-approval` before it closes (*Ending a dispatched run*).

**What a node never does here.** It never composes a triage, never sends `asking` or
`classes_questions`, and never sends its own `by: run` or `by: default` item for a question the
writer classed: the writer drops each with a note and keeps its own. It never asks a question the
writer settled, defaulted or held, and never treats a held choice as approved. A later write may
re-send the writer's items unchanged or leave them out; they stay either way. A revise's reset
clears them, so the node's next attempt sends its set again and is classed afresh.

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
- **The child copies the autonomy ceiling.** Its freeze reads the parent's state and records the
  narrower of the parent's effective autonomy ceiling — its recorded one, else its policy's
  default when the parent's `policy_hash` matches — and the one the patch sends, or the parent's
  when the patch sends none. A parent whose state cannot be read gives nothing, and the freeze
  warns `autonomy-ceiling-parent-unread:<run>`.
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
pending gate, where the engine's shell calls cannot run and the writer is therefore
unreachable, records the decision with editor tools and then hands the file straight back to
the writer for re-validation (see *Driver-suspended mode — resume*). Outside that window, an editor-tool
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
  (*In-node questions*).
- `project_context`, `related_tasks`, `verification_context`, `external_research` — the four
  optional top-level blocks. Each is written as a **top-level sibling** of `orchestrator:`
  and of the context block, never nested inside either. A mapping is merged key by key, so
  one write recording `verification_context.fixes_applied` leaves a `reverify_count` another
  write put there alone; `related_tasks` is a list and is replaced whole, so a caller that
  means to append sends the whole list.

Anything else is an error rather than a silent no-op. Never work around a refusal with an
editor tool.

**`orchestrator.policy_hash` is the writer's** (Step 4): never send it. The writer judges a gate's
triage itself, on the write that records its answer and on the re-validation of a driven answer
(§ Gates). These warnings print as plain `warning:` lines on stderr, and none is ever a
refusal — the write lands and the exit code does not move:
- **`policy-hash-mismatch:<gate>`** — the policy loaded now would classify the gate, but its hash
  is not the run's `policy_hash`, or the run recorded none. Nothing is classified; relay it.
  `gate-brief --request` warns the same on the request it builds. A classing write warns it
  naming the node: nothing was classed or recorded, and every question is printed under `ask:`.
- **`held-gate-skipped:<gate>`** — the write recorded `skipped` on a gate the held rule asks while
  choices wait for approval (*The ready set*). The status was written as sent: ask the gate, and its
  continue approves the held choices.
- **`autonomy-ceiling-parent-unread:<run>`** — a child run's freeze could not read its parent's
  state, so it copied no autonomy ceiling from it; the freeze landed with the patch's own, if any.
  Relay it.
- **`skip-guard-skipped:<gate>`** — the write recorded `skipped` on a gate the skip-guard rule
  asks whatever its guard reads (grammar § 7). The status was written as sent, and nothing
  checks it later: ask the gate and record its answer.
- **`provenance-unusable:<node>:<key>`** — an answer's provenance value holds a map key the state
  file cannot carry, so it was left off the decision; relay it, naming the request file it gives.

A `note:` line says the write dropped something the patch sent and landed without it. Beside the
clock fields and `policy_hash`, the writer drops, each with its note: an
`orchestrator.options.ceiling` wider than the run's autonomy ceiling, or one removing it (Step 4);
`orchestrator.classes_questions` and a node's `asking`, which only the writer records; and, in a
run that records `classes_questions`, a `by: run` or `by: default` item sent for a question the
writer classed — its own item stays — and any `triage` sent on a node's decisions. A note is
never a refusal: correct the prose that sent it rather than re-sending.

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
| `gate-request` | one invocation, three writes, in the order *Driver-suspended mode — the write order* fixes — a run is pending from the moment its request file lands, so a second shell call against it cannot run |
| the empty patch on gate resume | the shell becomes reachable only the instant `gate_pending` goes null, which is what that write re-validates (*Driver-suspended mode — resume*) |

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

### When a write is refused

Exit `1` means **nothing was published** — no rename happened and the file on disk is
byte-for-byte what it was. The first token on stderr is the refusal code. The writer has
twenty-six, each with its response below; one more, `edition-collision`, is raised before the
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
| `state-gate-values-sent` | The write sends `values` for a gate. A gate's values are recorded by the writer from the answer, as the chosen continue option sets them. Nothing was written. Drop `values` from the gate's entry and record the answer the usual way — the gate `completed`, the chosen option under its `decisions` — and the writer records the values in the same write. |
| `state-value-invalid` | A value recorded under a key the node declares is not of the declared type. The message names the key, the value and the form it should take. Nothing was written. Send the node's whole `values` map again with that key corrected, because values are replaced whole. If the node produced no such value, the node prose decides whether it failed; never coerce one to get past the check. |
| `state-gate-option-unknown` | The gate's summary records an option the gate does not offer. The message lists the ones it does offer. Nothing was written. Record the id of the option the operator actually chose, exactly as the gate spells it and never its label, and send the write again. Never re-ask the gate: the answer was given, and only its spelling was wrong. At `held-approval` the options are the ones its brief offers — continue, a `revise-<node>` per node holding a choice, stop — and only continue and stop once its revises are spent. |
| `state-absent-invalid` | A node summary's `absent` map is not a map, names an artifact the node does not declare, or gives an entry no reason (*Recording an outcome*). The message lists the declared keys. Nothing was written. Name each artifact by its declared key, never by its path, give the reason in a few words, and send the write again. An artifact the node was meant to produce and did not is not an absence to sanction: the node has not completed. |
| `state-summary-item-invalid` | A typed field of a summary holds a value no reader knows: a decision's `by` outside `operator`, `run`, `audit` and `default`; a risk object with no `risk` text, or a `tag` outside `open`, `tradeoff`, `followup`, `stop` and `resolved`; an artifact `role` outside `primary`, `review`, `evidence` and `log`; a `headline` that is empty, spans lines or runs past 220 characters; an `as_recommended` that is not true, false or null; a `metrics` entry without a label and a value; a `decision_areas` that is not a list of `{area, alternatives_count, chosen_approach}` maps; or a `recommends` that names no continue option of a gate waiting on the node, or carries no one-line reason. The message names the field and the allowed values. Nothing was written. Correct that one value and send the write again. A string item is always accepted, so a source or tag you cannot place can be written as plain text. |
| `state-question-answer-invalid` | A node's `answer` block could not be folded into its decisions: the node's request file is missing or carries no question set, a question has no answer, an answer names an option the question does not offer, a list answers a single choice, own words answer a question that does not take them, or `answers` names a question the request does not hold. The message names each. Nothing was written — but the gate was already cleared, so the node is `running` and nothing is pending. Re-read the answer file and send its `answer` block again, whole and unchanged; a block retyped by hand is the usual cause. When the answer file itself holds the fault, record each question it cannot answer as `{decision: <its default>, by: default, question_id}`, with an `open` risk naming the answer that could not be read, and continue the node. Never ask the question again in this attempt. |
| `state-patch-invalid`, `state-patch-unknown-key`, `state-inline-collection`, `state-workflow-without-nodes`, `state-workflow-without-task`, `state-context-block-unknown` | The engine built a patch the writer will not apply. Stop with `RUN-FAILED: <code>` and report the writer's message verbatim. |
| `edition-collision` | Two editions of this plugin are enabled in the session's settings, so skills may load from either one. Nothing was written, and no write, whether a start or a resume, will land until one edition is disabled. Relay the message verbatim to the operator, since it names both editions and the command that disables each, and stop with `RUN-FAILED: edition-collision`. Don't retry within this session: the fix takes effect only after Claude Code restarts. |
| exit `2`, `usage: the patch file …` or `usage: the patch in …` | The document never reached the writer: the flag named another file, or the file is missing, empty or not JSON. Nothing was written and the file is kept. Write the document to the run's own `.state-patch.json`, name that path, and run the verb once more; the same message twice is `RUN-FAILED: writer-unavailable`. |
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
exactly the case the no-fallback rule in Step 2 was written for; an editor-tool write here
produces exactly the drifted state file the writer exists to prevent.

`state-patch-invalid` is the broadest of the caller-defect codes, and it now also refuses a
block-path map key that is not a plain identifier rather than emitting it — the shape that
corrupted state files before the guard existed. A key that arrives from a name rather than
from a literal is the one to watch.

Two of its causes are corrected in the patch rather than ending the run, because the message
names the fault and nothing was written:
- **A classing write it cannot class** — the node is a gate or is not `running`, the set fails the
  checks `gate-brief` makes, `reasons` arrive without a set, name an id the set does not hold or
  carry a key other than `rationale`, `assumption` and `reversal`, or a question that would be
  classed names no default. Correct the set or its reasons and send the write again.
- **A `held-approval` entry under `nodes`** carrying anything but `status`, or a status other than
  `pending`, `suspended` or `completed`. Send that status alone.

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

---

## Resume

Read `orchestrator-state.yml`, take the frozen graph from its `workflow:` block, recompute
the ready set from the recorded node statuses, and continue. Resume never re-resolves the
definition: the graph that ran is the graph that resumes. `gate-brief` is the one verb that
re-resolves the definition after the freeze, and it only reads: it re-resolves it to name the
next node and the option ids, and degrades to `Next: unknown` when the definition has drifted.

**A run started by name resumes the same way.** `/maister-copilot:run <run directory>` and
`/maister-copilot:work <run directory>` take `workflow.name` from the run's state, through
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

## Speaking to the user

One rule for everything a person reads during a run: your narration, in-node questions and
their options, the summaries, decisions and risks written for a gate, and the closing message.
The reader is a first-time user who sees only the terminal.

- **Say phases and checkpoints.** Never node, graph, freeze, stretch, state, ready set or a verb
  name such as `write-state` — "the specification is approved", not "gate approved"; "saved",
  not "the state write landed".
- **No internal labels.** A node prose's parts (Part A, Part B), step names and self-checks are
  for you; the user hears what is happening ("Four assumptions to confirm before I write the
  spec").
- **Expand every code the first time, or don't use it.** B1, T5, M2, R3, H12, D4 mean nothing on
  screen: write "the per-order customer lookup", or "B1 (the per-order customer lookup)" when
  the code is worth keeping because it recurs.
- **Say "you".** Never "the operator" or "a person".
- **Credit each decision to whoever made it** — you, the audit, the step that settled it, or a
  default the run took. Its `by` records that; never write the source into the decision text. Never "as you chose" for something the spec decided.
- **Every recommendation gives its reason**, in the option's description, and keeps every
  criterion the task states (*In-node questions*). "(Recommended)" appears once per question, on
  the option, never in the question text.
- **"Needs your decision"**, not "needs a hand".
- **Paths are anchored.** Name a run file by its path from the project root
  (`.maister/tasks/<type>/<run>/analysis/gap-analysis.md`), never relative to a directory the
  user cannot see. One exception: a gate's *Review* and its More details name files by their
  path inside the task folder (`analysis/gap-analysis.md`). The run's start banner has already
  named the folder, and a full path would take up most of a short glance.
- **Nothing about the machinery.** A command a hook blocked, a retried write, a condensed context
  passage: none of it is news to the user unless it changed the result.
- **Stay at the project root.** Run every command from there, and never `cd` into the task
  directory — not even as `cd <dir> && grep …`, which leaves the session there: pass the
  file's path from the project root to the command instead. The session's working directory
  is what the user's status line shows.

---

## Operator visibility

The engine honours the framework's contracts; it does not restate them. Follow
`../orchestrator-framework/references/orchestrator-patterns.md` for:

- the **artifact summary contract** (§ 7) in every prompt that asks a delegate to write an
  artifact, with the returned summary lifted into state verbatim rather than re-summarized;
- the **operator dashboard** (§ 8 — the config gate that turns it off and the browser open,
  which stay prose; the viewer itself is installed by the freeze write, Step 4, so an engine run
  copies nothing): every successful `write-state` projects `dashboard-data.js` itself, so no
  node owes a rewrite of it, and a projection that fails is a warning that never blocks. The projection is the file's only writer: inside the
  implementation and verification phases, which the engine does not enter,
  `implementation-plan-executor` and `implementation-verifier` keep it current by sending
  `write-state` calls, never by writing the file;
- the **HTML companions** (§ 9) and the style guide path passed to artifact-writing
  delegates, following `html-report-style.md`.

**The display files are the engine's alone.** Every successful `write-state` also writes the
run's `display/status.json` — the workflow, the task, the phase counted without gates or skipped
nodes, and the status line composed — and the freeze writes `display/banner.json`, the banner's
lines without the one addressed to you. `gate-brief`, in every form, writes `display/next.json`:
the gate's question and a glance at it, fitted to the rows a panel above the question may take —
for a question set, the step and its place among the phases, the first question's header and
how many questions it holds — which the next state write removes. Under a host that names its session, each write also
records the run in `.maister/display/sessions/<session id>.json`, so an editor extension finds
the run its session is driving. They are what such an extension draws beside the session: no
node writes them or relays them, and one that cannot be written is a warning on the dashboard's
terms.

**Phases are named by their titles.** A definition's top-level `display:` block may carry
`titles` — node id to a short one-line title — beside `icons`; an overlay or a profile may add or
override either, and neither moves `graph_hash`. The dashboard's phase names and the gate brief's
`Next:` line use them, falling back to the id made readable in sentence case, a known acronym in capitals
(`gap-analysis` → `Gap analysis`, `deliver-notes-api` → `Deliver notes API`);
name phases the same way in the executive summary. The same block's `option_labels` and `headers`
give a gate's options the words an operator picks and its question a short header; the picker
`gate-brief --json` returns uses them. Ids stay wherever something is keyed: state, gate files,
markers and option ids — a gate's answer is recorded by option id, never by label.

**The dashboard link is shown where a run starts, resumes and ends**: in the freeze banner as
the run starts, from `resume-check` as a resume begins, and once more at the end as
`Dashboard: <link>` — the same `file://` link each time. A gate never names it: the dashboard is
already open, and a gate's question and glance stay short. A run without a dashboard shows none.

**How a run ends depends on who reads its end.**

- **Under an absent or `terminal` driver a person reads it.** The verb's lines are for the
  engine, not for them. Write the closing patch and call `run-complete`; settle any refusal first
  (*When `run-complete` refuses*). Then close with one wrap-up message that fits one screen,
  and that message is the last thing the run prints — nothing after it. It is six labelled
  sections, in this order, and nothing else:
  - **Done:** the outcome in plain words — completed, stopped at a named checkpoint with the
    option taken, or failed at a named phase;
  - **Needs you:** each `open` risk still open as the run ends, one line each, or "nothing".
    State each as an item: what is open and where to take it ("Open in the design: no
    deprecation release before the old call is removed — take it into the development run").
    Each `missing-artifact:` line the verb printed goes here too, restated in plain words as a
    file a named phase should have written and did not. Never ask a question here: the run has
    ended, and an answer given now reaches nothing;
  - **Follow-ups:** each `followup` risk the run recorded, one line each, or "none";
  - **Next:** every next step, one line each: the workflow's own next step as the real command,
    with its real flags (`/maister-copilot:development --research=<task-dir>`), when there is one, then
    the rest the workflow's closing node names;
  - **Files:** the key files the run wrote, from the project root. Anything long — a commit
    message — goes into a file in the task directory, named here rather than printed;
  - **Dashboard:** `<link>`.

  **Nothing follows the Dashboard line.** No list, heading or paragraph comes after it: the
  choices the operator already made are not restated, a fix the run applied belongs under
  **Done** when it changed the result, and next steps live only under **Next**. Process notes
  stay out (*Speaking to the user*).

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

---

## When to use

**Use** when a workflow ships a definition and its orchestrator hands the run over, or when
`/maister-copilot:run` hands over a workflow started by name — including when a node of that definition
starts a child run of its own, which is this engine's job and is covered by *Sub-runs*.

**Do not use** to run a definition file by path, to start a chain, to author an eject or an
overlay, to dispatch a `workflow:` node carrying `dir:` into a member repository, or as a
workflow a user starts directly. Each of those is another skill's job — or the cockpit's — and
none of them is reachable by improvising here.
