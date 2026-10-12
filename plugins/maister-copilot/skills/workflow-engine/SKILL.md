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
`GATE-PENDING` line, turn over. Every rule marked *mode-scoped* — most of them in
`references/gates.md` — names which of the two it holds for.

**Everything the user reads follows *Speaking to the user*** (below): your narration, every
question, every summary written for a gate and the closing message. The bar is a first-time
user who can follow the run from the terminal alone.

## Before anything else

Eight things no verb tells you. Everything else a moment needs, the verb that runs at it names.

**1. The gate rule** is Step 0 below, this skill's one copy of it. Settle it before the first
node and do not re-litigate it at any gate.

**2. The invocation.** Every verb is one command starting with the engine path written as an
absolute directory (*The invocation contract*). **A patch or a request document travels as a
here-string.** Put the JSON in single quotes after `<<<`, at the end of the command, which still
starts with the engine path itself:

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml <<< '<json>'
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs gate-request --state=<run>/orchestrator-state.yml <<< '<json>'
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs gate-revise --state=<run>/orchestrator-state.yml --node=<gate> --option=<revise option> <<< '<json>'
```

An apostrophe inside the JSON is `'\''`; PowerShell and cmd take the patch file instead. Both
rules, and the forms never to use, are in *The invocation contract*.

**3. One verb, one call.** When a step needs two verbs, that is two calls.

**4. Every delegate prompt carries the run's context, fetched.** In the turn that writes the
prompt, run `run-context --state=<state> --node=<node>`, or `prior-context --node=<node>` where
the delegate also needs the earlier phases, and paste its stdout unedited (*Run-scoped context*).

**5. Every state change goes through `write-state`.** Never edit `orchestrator-state.yml` or the
dashboard files with an editor tool; the one exception is answering a pending gate
(`references/gates.md` § *Driver-suspended mode — resume*). The patch vocabulary and the
one-write-per-moment rule are in `references/writing-state.md`.

**6. Read what a `rules:` line names.** A verb that prints `rules:` names the reference and the
section that govern this moment — for a refusal, the section holding its recovery — read that
section before acting.

**7. A missing companion.** **A `write-state` that prints `companion-missing: <node> <path>`**
completed a node whose markdown is on disk and whose owed `.html` is not. Run
`html-companion-writer` once for that file, pasting `run-context --node=<node>` so it gets the
`html:` line. When the node already has a summary, then send `{"node_summaries":{"<node>":{}}}`
to register the companion; when it has none, its summary's own write — still owed — registers
it, and the empty summary is never sent then. Never re-run the node for a companion. A
companion that comes back `failed` is left for `run-complete`, which names it as
`missing-companion:`.

**8. `run-complete` is the last call.** Its marker is the turn's last line, and every
`missing-artifact:` and `missing-companion:` line it prints goes under **Needs you** in the
wrap-up (*Operator visibility*).

---

## Initialization

**BEFORE executing any node, you MUST complete these steps:**

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `ask_user` at a gate. They apply only to your discretionary clarifications. Invoke `ask_user` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.

### Step 1: Load framework patterns

Read § 1–§ 4 of `../orchestrator-framework/references/orchestrator-patterns.md` now:
delegation, phase gates, context passing and the state schema. The rest of it reaches you
through a verb: the artifact summary contract (§ 7) is in every `run-context` block, the HTML
companions (§ 9) through its `html:` line and the companion checks, and the closing
reconciliation (§ 10) through `run-complete`. This skill adds graph execution on top of the
framework and restates none of it.

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
artifact path the resolved graph declares, so a node or an agent writing a declared artifact
finds its folder there. A deeper folder, a directory artifact included, is its writer's to create.

**`resolve` does not stand in for `validate`**, although it re-runs the same checks. Only
`validate` reports where each target was found and how many nodes and gates the graph holds; a
run that skips it has frozen a graph whose skills and agents nobody has confirmed resolve to the
files the operator expects.

**The `workflow` block is `resolve`'s output, copied through.** `source`, `overlays`,
`profile`, `graph_hash` and `name` go into the freeze exactly as `resolve` printed them, beside
`grammar_version: 1`, and `nodes` carries one entry per node `resolve` printed and no other:
`kind: gate` for a gate, `kind: workflow` for a `workflow:` node and `kind: task` for every other
node, each `status: pending`. The writer fills in each node's `needs`, and on a gate that offers
a revise its `reruns`. Copy `graph_hash` without reformatting it: it arrives in the spelling the
state block accepts. The overlays and the profile are the ones the run was resolved with. The
writer proves the freeze before it installs it — it re-resolves the recorded `source`,
`overlays` and `profile` from the run's own project root — and writes nothing when the result
disagrees; its refusal names the recovery.

**The freeze patch carries, beside the block:**
- **`workflow.name`** — the definition's own `name`, as `resolve` printed it; for a built-in,
  the bare name after the prefix strip. The writer derives the run's context block,
  `<name>_context`, from it, so a later `context` or `phase_summaries` write with no name
  recorded is refused `state-context-block-unknown`.
- **`task.key`, when the definition declares a tracker key.** `resolve` reports the input marked
  `tracker_key: true` as `tracker_key` (null when none is), and the freeze writes that input's
  supplied value as `task.key` — the tracker mirror adopts that ticket as the run's parent rather
  than creating a fresh epic, and decides the first time it reads the state. A definition that
  marks nothing writes nothing: `task.key` stays absent, never an empty string.
- **The supplied inputs, under `orchestrator.options.inputs`** — a map of input name to the
  value the run was started with; a run started with none writes no key. The resume lines carry
  no values, so this record is a re-driven driver's only source for them. **A resumed driver
  reads its inputs from the state, never from the line that woke it**, and a run frozen with no
  key has inputs that are genuinely unknown: say so rather than guessing one.
- **`orchestrator.options.html_output`**, read from `.maister/config.yml` (default `true` when
  the file or the key is absent): the freeze's banner names the dashboard from it. Intake may
  repeat the same value.
- **`orchestrator.options.ceiling`**, when a dispatched run's seed names an autonomy ceiling
  (`approve` < `advice` < `decide`, an unknown value reading as `approve`). After the freeze it
  may narrow, never widen.
- **The definition's context seed, when its node prose names one**, as `context` — fields known
  before the first node runs. A definition that names no seed sends none.

**The writer adds the rest itself**, so the freeze patch need not send it: the two empty phase lists
`orchestrator.completed_phases` and `orchestrator.failed_phases`, `orchestrator.task_ids: {}`,
`orchestrator.created`, `orchestrator.policy_hash`, `orchestrator.classes_questions` when the
policy classes in-node questions, and the dashboard viewer (`references/writing-state.md`
§ *What the freeze write adds*). Never send `policy_hash` or `classes_questions`; a
`warning: policy-refused:<path>:<reason>` line means the
policy file could not be applied and the built-in default was: relay it; the run goes on. **The
engine path creates no task items**: it never calls `TaskCreate` or `TaskUpdate`, because the
state file and the dashboard are the run's tracker.

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
output to a one-line count, so the user sees none of it until you write it. **The run's first
message is yours, composed from the banner — output all of (a)–(d) before any other call:**
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

The banner prints once. A retried freeze — the identical patch sent again because the first
call's output was lost — is a no-op for the block and prints none: read the task directory, the
dashboard and the first phase off the state file instead, never from memory. A sub-run child's
freeze prints its own banner too; the parent does not relay it, and its node summary names the
child's path instead.

If `validate` rejects the definition, stop with `RUN-FAILED:` carrying the validator's first
error. A definition that does not validate cannot be executed part-way. Its warnings do not stop
the run — relay them: a workflow-level output whose node an overlay or a profile disabled
(`exposed-output-disabled`, dropped from the canonical block and so from `graph_hash`), and a
node nothing waits for (`added-node-no-dependents`, `node-no-dependents`), which runs where the
frozen order puts it (`references/grammar.md` § 14). A reference to a node the base definition
never declared stays a hard error.

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

One script, fifteen verbs, one exit-code table — `0` success, `1` the input was rejected
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
variable assigned first and used in it, no second command after it, no redirection
other than the here-string, no heredoc, no substitution — and never several verbs packed
into one shell script. Flag values are written bare; a path holding a space goes in single
quotes, never double quotes or a backslash.

A patch or a request document travels as a here-string (*Before anything else*, item 2).
Inside single quotes nothing is expanded: `$`, backticks and backslashes reach the verb as
written. An apostrophe inside the JSON is written `'\''` — close the quote, an escaped
quote, open it again — so `{"summary":"the operator'\''s note"}`. Never the JSON escape
`'`: a tool call decodes it into a bare quote before the shell reads the line, and the
bare quote ends the string early. The typographic `’` may stand for an apostrophe only in a
prose text value — a summary, a rationale — never in code, a command, a path or a quoted
identifier, where it changes what the value names. A pipe into the same command — with
`echo '<json>' |` in front of it — is accepted by the verb too, but the command then no
longer starts with the engine path, so an allow rule for the script may not match it as
written.
Never a heredoc: an agent host's shell-safety check refuses a heredoc whose body is a JSON
object — braces beside quotes — even one fed through `cat` into a pipe, and allow-listing
the script does not lift it.

**bash, zsh and Git Bash take the here-string; PowerShell and cmd, which have none, take
the patch file** — and so may any shell, as the fallback. Write the JSON to
`.state-patch.json` in the run directory — beside `orchestrator-state.yml` — with the
file-writing tool (Write, or the host's own file-creating tool), then name it on the call:

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml --patch-file=<run>/.state-patch.json
```

That one name, in that one place, is the only file the verbs read a document from:
any other name or directory, a `..` segment or a link is refused at exit `2`. When the
write lands, the verb deletes the file, so the next write creates it afresh. When it is
refused, the file stays: correct it and run the verb again — it is a file this session
wrote, so the file tool overwrites it; one left by an earlier session is read first.
The file is written by the file tool, never by the shell, and needs no quoting in any
shell. `area-brief --patch-file` and `finding-brief --patch-file` write a question set
there themselves; each is the engine's own write, so no edit rule is involved.

This is not style: a permission rule or hook can recognise this plugin's own call only
in this exact form — the command by its text, the patch file by its name inside a run —
so anything else brings the approval prompt back. The operator's own permission rules
decide: an allow rule for the script, and where the patch file is used an edit rule for
`**/.state-patch.json`, spare them the prompts.

| Verb | Flags | Gives |
|---|---|---|
| `validate` | `--definition`, repeatable `--overlay`, `--profile` | `{ok, errors[], warnings[], resolved[]}` on stdout — `resolved` says where each target was found. Every profile the overlays declare is judged, selected or not, and a finding only one profile produces is prefixed with its name. A version 1 document is closed: a key the grammar does not define, at any level, is an error that names the accepted keys, and only a reserved key warns instead. An overlay given without `--definition` is judged on its shape, and a base it names by workflow name must exist — a built-in or a project definition. A workflow in the project's `.maister/workflows/` that says nowhere what it is for — no `description:`, no paragraph under its companion's title — warns `workflow-undescribed`, because `/maister-copilot:work` cannot match a task to it. A gate guarded by a value a non-gate node records that is more than a pure confirmation warns `skip-guard-not-pure:<gate>`: it is asked whatever its guard reads (grammar § 7) |
| `resolve` | `--definition`, `--overlay…`, `--profile` (a profile one of the overlays declares; selecting any other is refused) | the canonical graph, its `graph_hash` **in the spelling state records** — write it through unchanged, never re-spell it — and `tracker_key`, the input the freeze reads for `task.key`, or null |
| `diagram` | same, plus `--out` | deterministic Mermaid text; its header names the overlays (by file name) and the profile applied, and a gate box carries its question and its options as `id: effect` |
| `locate` | optional `--name` (bare or `builtin:`-prefixed); with it, repeatable `--overlay` and `--profile` — the run's own | with a name, where the run-by-name lookup (Step 3) finds it: `{ok, errors[], name, from, definition, overlays[], ignored, companion, title, summary, inputs, dispatches[], html_companions}` — `definition` and `overlays` are the `--definition` and `--overlay` values the three verbs above take (the lookup's own, before any the caller adds), a project path written relative to the project root; `inputs` is the definition's declared `inputs:`; `title` is the companion's H1, and `summary` the definition's `description:`, else the paragraph under that H1; `dispatches` names the nodes that carry `dir:` in the graph folded from the definition, every overlay and the profile. `html_companions` is the `html_companions:` block merged from the definition, every overlay and the profile, the nodes an overlay disables left out — `{}` when no layer declares one. Exit `1` when the name is found nowhere, is not a workflow name, finds only an overlay with no built-in beneath it, or finds a file whose `name:` is another. With no name, `{ok, errors[], workflows[]}` — the project's own definitions, each with `name`, `definition`, `title`, `summary`, `chain` and `error`, overlays, built-in names and generated chains left out. Reads only |
| `write-state` | `--state`; the patch as JSON by here-string, or `--patch-file` naming it in the patch file | the changed paths, one per line; the freeze prints the startup banner and a blank line before them, the model's first message composed from it (Step 4). A write carrying a node's question set adds a blank line and `ask: <id> <id> …`, or `ask: none`, after them: the questions still to ask (`references/in-node-questions.md` § *When the policy classes a question*). A write that completes a node whose markdown is on disk while the `.html` companion it owes is not ends with a blank line and one `companion-missing: <node> <path>` line per such companion — exit `0`, recovered as item 7 of *Before anything else* says. The answer to the closing checkpoint `held-approval` is written under `node_summaries.held-approval`, and its `status` — alone among ids outside the frozen graph — under `nodes`, as `pending`, `suspended` or `completed` (*The ready set*, `references/gates.md` § *The closing checkpoint `held-approval`*) |
| `gate-request` | `--state`; the request as JSON by here-string, or `--patch-file` naming it in the patch file | the files written, one per line: the request file, the gate index and the pending marker, in one call (`references/gates.md` § *Driver-suspended mode — the write order*) |
| `gate-revise` | `--state`, `--node` (the gate), `--option` (its revise option); `{note, answered_by?, at?, via?}` by here-string, or `--patch-file` naming it in the patch file; without `answered_by`, the operator's own name is stamped, and without `via` the run's driver kind under a `cockpit` or `dispatch` driver, `terminal` otherwise | the changed paths, one per line, then a blank line and `revised: <gate> reruns=<node> revision=<n>/10 reset=<ids>`; the stretch from the option's rerun node to the gate reset in one write, with the note on the gate (`references/gates.md`). With `--node=held-approval` and `--option=revise-<node>`, the stretch is that node and every node downstream of it, the closing node included (`references/gates.md` § *Revising at a gate*) |
| `run-complete` | `--state`, and under a dispatch driver `--outbox` and `--dispatch-id` | the run's closing marker as the **last** line of stdout, with any `missing-artifact:` lines, then any `missing-companion:` lines, and a stop's notice above it; the refusal on stderr |
| `prior-context` | `--state`, optional `--background`, optional `--node` | the prior phases' decisions and risks as markdown on stdout, to paste into a delegate prompt; `--background` frames them as background for a document written for end users, to stay consistent with rather than reproduce; `--node` prints that node's `run-context` block first, then one blank line, then the same passage, and its refusals are `run-context`'s — reads the run, writes nothing |
| `run-context` | `--state`, `--node` (the node about to delegate) | the run-scoped context a delegate prompt carries, as markdown on stdout to paste unedited: `task_path`, `html:` — the HTML report guide when the run's `html_output` is on and the node owes a companion, else `off` — the project documentation paths and the standards index when the project has one, the scratch-copy rule, the summary contract, and the `.html` companions the node owes in declaration order; when the definition the run froze cannot be re-read, `companions: unknown` and one `warning: run-context-definition-unread` line, exit `0` — reads the run, writes nothing |
| `gate-brief` | `--state`, `--node` (the gate), and at most one of: `--json` with `--picker=plain` — the profile the asking tool takes — `--checkpoint`, `--request` or `--oneline`; or `--node` (a running node) with `--checkpoint` or `--request` and `--patch-file` — the node's question set as JSON in the patch file | The brief for a gate, or for a running node's question set. Every form reads the run and writes no state: its one write is the run's `display/next.json`, the panel an editor extension draws above the question. With no form, the brief as text within 1,600 characters — the trailing `rules:` line the verb adds sits outside that budget. `--json` returns the in-session picker, `--request` the whole driven request document, `--checkpoint` the structured checkpoint every other form projects from, and `--oneline` the request's one-line summary; `--node=held-approval` briefs the run's closing checkpoint, in every form (*The ready set*). Each form's shape is `references/gates.md` § *The `gate-brief` forms* |
| `area-brief` | `--state`, `--node` (the convergence node that is asking), and one form: `--area=<id>` with `--json` and `--picker=plain` — the profile the asking tool takes, `rich` by default — or `--area=<id>` alone, or `--patch-file=<run>/.state-patch.json` with `--area` repeated or omitted | One decision area of the brainstorm, rendered from the file its brainstorm wrote (`references/in-node-questions.md` § *Decision areas from the brainstorm*). `--json` prints the picker in the field shape of `gate-brief --json` — `{ok, picker, question, header, options, details, more_details, question_id, errors, warnings}`, the answer recorded under `question_id`, `convergence-decisions-<area id>`; `--area` alone prints the area's full write-up as markdown, the text More details shows; `--patch-file` writes every area, or the named ones, as a driven question set to the patch file and prints its path. A file it cannot use is one `warning: decision-areas-…` line on stderr, exit `0` and nothing to paste — `{ok: true, fallback: true}` under `--json` — and the node composes the area itself. Reads the run; writes no state and no `display/next.json` |
| `finding-brief` | `--state`, `--node` (the reviewing node that is asking), `--findings-file=<file in the run>`, and optionally `--patch-file=<run>/.state-patch.json` | The node's findings that need a decision as one question set, `{questions}`, one question per finding (`references/in-node-questions.md` § *Findings that need a decision*): printed as JSON, or with `--patch-file` written to the patch file and its path printed. The node's prose must declare `<node>-findings`. A file it cannot use is one `warning: finding-list-…` line on stderr, exit `0` and nothing to paste, and the node composes the questions itself. Never classes; reads the run and writes no state |
| `resume-check` | `--state` | JSON on stdout: the frozen workflow's `name`, `overlays` and `profile` and the run's `dashboard` link (`null` when it has none), or, exit `1`, the refusal of a directory the engine does not resume — a 2.x one among them — with an operator `message` (*Resume*) — reads the run, writes nothing |
| `sync-plan` | `--plan` (the run's `implementation/implementation-plan.md`) | sets the plan companion's `data-group` / `data-step` markers to the plan's checkbox state; JSON on stdout with `written` and the groups the companion has no marker for — idempotent, and a no-op that names its reason when there is no companion or the run's `html_output` is off |

`run-context`, and `prior-context` with `--node`, refuse with exit `1`, an empty stdout and the code first on stderr; nothing was written:

| Refusal | Response |
|---|---|
| `run-context-state-unreadable` | `--state` cannot be read or parsed as a state document, and nothing was read further. Point `--state` at the run's `orchestrator-state.yml` — the run directory this node belongs to — and run the verb again. |
| `run-context-not-a-run` | The file carries no `workflow:` block: the engine never froze it, so it has no nodes and no run context. Run the verb on the state of a frozen run — freeze it first through `write-state` (Step 4) — and never write the block by hand. |
| `run-context-unknown-node` | `--node` is not a node of the run's frozen graph, or names `held-approval`, which delegates nothing. Name the node about to delegate, exactly as `workflow.nodes` spells it, and run the verb again; no state write fixes this. |

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

The patch arrives on standard input or in the patch file, never in an argument, so no
quoting beyond the here-string's single quotes has to survive a shell — and Windows without
a POSIX shell, a supported target, takes the file. A newer version — a whole number above 1 — degrades **the same
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

**The held rule.** While a choice is held for a person's approval (`references/in-node-questions.md` § *When the policy
classes a question*), a gate whose guard reads a task node's value is asked whatever its guard reads, as the
skip-guard rule asks its gates: the first such checkpoint that runs lists the held choices first,
and its continue approves them (`references/gates.md` § *Gates*). A gate guarded only by an input or another gate's value
is still skipped by its guard. A gate the held rule asks whose own work was all skipped is briefed
with `Skipped.` as its *Done* and the held choices first.

**The closing checkpoint `held-approval`.** When no checkpoint follows a held choice, the run
raises one of its own before it closes. `held-approval` is a reserved id, never a node of the
frozen graph, so no definition and no `graph_hash` changes. In a run that records
`classes_questions`, the closing node runs `gate-brief --node=held-approval` before its closing
patch and, under dispatch, before its close-out (*Ending a dispatched run*):
`gate-brief-nothing-held` means nothing waits — close the run as usual; otherwise it is asked
like a gate, by the run's driver (`references/gates.md` § *The closing checkpoint `held-approval`*). While a held
question has no choice yet, the checkpoint that asks for the choice may be an earlier one, or
`held-approval` raised early; `gate-brief-not-askable` names the one to ask instead.

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
  refused `run-nodes-unfinished` (`references/writing-state.md` § *When `run-complete` refuses*), and a run with a held choice
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
that remains is a genuine gap, and the operator's cue to re-drive that node. When the run's
`html_output` is on, one `missing-companion: <node> <path>` line follows them for each `.html`
companion a `completed` node owes whose markdown is on disk and whose companion is not — the same
warning, recovered by `html-companion-writer` (*Run-scoped context*), never by re-running the node.
How the lines reach the operator depends on the driver (*Operator visibility*).

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
operator's own, then this plugin, then every installed plugin — and the first hit wins.** A
target may name the plugin it means with one colon — `skill:acme-tools:review` — and is then
looked for only in that plugin. `validate` reports where each target was found in its
`resolved` list; the directories each tier searches are in `references/grammar.md` § 5.1. **A
target found nowhere warns** `unresolved-reference:<node>:<target>`, because an environment
`validate` cannot see may provide it, so a mistyped name surfaces when the node is reached.
Only `direct:` stays an error, and so does a node carrying `dir:`, whose target the workspace
validator must read.

**Target names in a definition are bare, and the provider prefix is applied at invocation.**
Resolution is rooted at the plugin root, so one shipped definition is correct under every
generated variant with no rewrite pass. A prefix written into a definition file breaks the
other variant and is a defect, not a style choice.

**Prior-phase context is read out of state, never composed.** A prompt for an
artifact-writing delegate carries everything earlier phases decided and flagged, complete:
`N` items in state must arrive as `N` distinct items, none dropped and none merged — a node
composing the passage afresh condenses it. So run `prior-context` against the run's state file
**at each consuming delegate** — one call per prompt, in the turn that composes it — and paste
its stdout into the prompt under its own heading, unedited and whole: never slice it with
`sed`, `head`, `tail` or the like, and never pass a file path or a saved copy in its place. It
renders every phase summary the run has accumulated — or, in a run with no context block, every
node summary — each with its decisions and risks counted, so a truncation shows as a number
that disagrees with its own bullets. **A delegate writing for end users — a user guide, user
documentation — gets `prior-context --background` instead:** the same items, framed as
background to stay consistent with rather than as content to carry into the document. Never
re-use a rendering produced for an earlier delegate: a summary written in between makes it
stale. The verb reads the run and writes nothing, so the extra call costs nothing.

A `direct:` node's prose is the node's body: its steps, its fan-outs, its self-checks, the
questions it asks inline, and how many times it may be re-driven. Read the section before
executing the node, not after it fails. Whether those inline questions are asked at all
follows the run's driver — see `references/in-node-questions.md` § *In-node questions*.

### Run-scoped context

What every delegate needs from the run rather than from its node — the task directory, the
HTML guide or `off`, the project's documentation paths and standards index, the scratch-copy
rule, the artifact summary contract and the `.html` companions the node owes — is fetched, never
composed: run `run-context --state=<state> --node=<node>` in the turn that writes the prompt and
paste its stdout unedited, or run `prior-context --node=<node>`, which prints the same block
before the prior-phase passage. A delegate reads its companion instruction from the `html:`
line: one whose prompt lacked the block writes no companion and returns `companion:
not-requested` — delegate it again with the block. Anything node-scoped is in `with:`,
interpolated as below.

An artifact a `direct:` node writes inline gets its companion from the `html-companion-writer`
agent, handed the same block. Each companion is registered under `artifacts[].html` on the
summary entry that owns the artifact; one a write reports missing is recovered as item 7 of
*Before anything else* says. Reconciling what state lists against what is on disk is the closing
node's job (framework § 10).

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

**A node is recorded only with one of eight statuses, and only if the run froze it:**
`pending`, `running`, `waiting`, `suspended`, `completed`, `skipped`, `failed` and `stopped` —
never the summary spelling `in_progress`. **Its values are held to the outputs it declares**:
`bool` is `true` or `false`, `string` or `id` a string, `enum` one of its members, and a skipped
node records its strings and enums as null. A `workflow:` node's `task_path` and `run_id` are
its own record of its child. The writer refuses anything else, and its refusal names the fix.

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
child node that writes it: the adopting write records it under the parent node's `absent`, with
the skip as the reason. Any other absence is left unrecorded, so `run-complete` reports it.

**A declared artifact path resolves against the task directory of the run that wrote it** — the
run's own for a `direct:`, `skill:` or `agent:` node, the child's (the node's recorded
`values.task_path`) for a `workflow:` node — for the existence check below and for
`${<node>.artifacts.<key>}` alike. The declared path itself is literal.

**The two budget-exhausted rows need an operator, so they need a driver.** Under a `cockpit` or
`dispatch` driver nobody is there to answer the retry-or-skip question: the node is recorded
`failed` and the run stops with `RUN-FAILED`, and a re-drive is how an operator reaches it
(`references/in-node-questions.md` § *When nobody can be asked*).

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
completed without, named by its declared key (never its path), with the reason in a few words —
and its `summary` still says it in prose. Record it only where the node prose sanctions the
absence; an artifact the node owed and did not write is the second row above.

**A phase key is never a node id.** `node_summaries` is keyed by node id, and the workflow's
own `phase_summaries` map is keyed by the workflow's phase keys. The node prose names the
key each mirroring node writes under; a node whose prose names none writes a node summary
and nothing else. Reading a phase key off the node id is the mirroring defect to watch for,
because the write succeeds and the run keeps going with a key nothing else reads.

The writer mirrors a node's status onto its summary — `running` and `waiting` as `in_progress`,
**`stopped` as `skipped`** — and registers, on a completing summary, every declared artifact on
disk the entry does not list, with its `.html` companion. The closing write still lists what the
node prose asks for. Why each works so, and what the tools read from `absent`:
`references/writing-state.md` § *Recording an outcome — the detail*.

**Retry budgets are prose, never `with:` data.** `with:` is an unconstrained free-form
object handed to the node; a budget written there would read like a grammar feature while
being inert data nothing consults. Budgets live in the node prose, and the engine follows
them from there.

---

## Gates and in-node questions

**At a gate, the first call is `gate-brief --state=<state> --node=<gate>`**, on its own and only
after the closing write has returned — with `--json --picker=plain` when the gate is asked in
session, with `--request` when a driver suspends on it. Its output is what the user is asked;
never write a gate question by hand. The brief, asking in session, suspending under a driver,
resuming, a stop and a revise are `references/gates.md`, and the line `gate-brief` and
`gate-revise` print names the section that governs the moment.

**A question a node asks inside itself** is asked, suspended on or defaulted according to the
run's driver, and classed first when the freeze recorded `classes_questions` — read
`references/in-node-questions.md` before a node asks its first one. `area-brief` and
`finding-brief` name the section for theirs.

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
- **The child copies the driver's features.** A child whose driver is not the terminal records
  its parent's `orchestrator.driver.features`, narrowed to any the patch sends, so a sub-run of a
  cockpit that shows question sets asks its in-node questions there too, and never gains a feature
  its parent lacks. The driver need not send them. A parent whose state cannot be read vouches for
  none: the child freezes without features and the freeze warns
  `driver-features-parent-unread:<run>`.
- **`task_path` and `run_id` are reserved** against a `workflow:` node's declared outputs, because
  the node's values map is replaced whole on patch and a child output of either name would be
  merged over the parent's link to its own child.
- **The child directory name is derived, never chosen**, from the parent directory's date and
  slug and the node id, so a parent re-driven after a crash computes the same name and **adopts**
  the existing child instead of starting a second one.
- **Nothing here names a workflow.** A workflow becomes child-capable by declaring an `embedded`
  input, guarding its closing node and declaring a workflow-level `outputs:` block; the engine is
  unchanged either way, and the recipe is in the reference.

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
the revise and `gate-revise` never ran: run it first (`references/gates.md` § *Revising at a gate*).

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
  criterion the task states (`references/in-node-questions.md` § *In-node questions*). "(Recommended)" appears once per question, on
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
  (`references/writing-state.md` § *When `run-complete` refuses*). Then close with one wrap-up message that fits one screen,
  and that message is the last thing the run prints — nothing after it. It is six labelled
  sections, in this order, and nothing else:
  - **Done:** the outcome in plain words — completed, stopped at a named checkpoint with the
    option taken, or failed at a named phase;
  - **Needs you:** each `open` risk still open as the run ends, one line each, or "nothing".
    State each as an item: what is open and where to take it ("Open in the design: no
    deprecation release before the old call is removed — take it into the development run").
    Every `missing-artifact:` and every `missing-companion:` line the verb printed goes here
    too, each restated in plain words as a file a named phase should have written and did not —
    the report itself, or its HTML companion. Never ask a question here: the run has
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

  Never show the raw `missing-artifact:`, `missing-companion:`, `run stopped:` or `RUN-` lines, and never type a
  marker. A child run driven in session is the exception: it runs `run-complete` with no wrap-up,
  because its parent's walk goes on and the parent's own ending carries the wrap-up.
- **Under a `cockpit` or `dispatch` driver tooling reads it,** and everything below applies.

The run's last line is a marker, read by tooling: `RUN-COMPLETE`, `RUN-FAILED: <reason>`, or —
when a turn ends at a sub-run rather than at the run — `WAITING-SUBRUN: <node> run=<child-run-id>`.
**The first two come from a verb; the third is typed.** `RUN-COMPLETE` and `RUN-FAILED` are what
`run-complete` printed — which is what makes a dispatched run's unpublished close-out a
`RUN-FAILED: closeout-unpublished` instead of a silence its chain waits on forever — so for those
two, echo the verb's lines — the `missing-artifact:` and `missing-companion:` lines and a stop's notice above the marker —
and do not type a marker it did not give you. Everything the operator is meant to read at the end —
the executive summary, the full list of next steps and the dashboard link — is printed before the
`run-complete` call, never after it, so the verb's marker stays the last line.
`WAITING-SUBRUN` has no verb behind it: the driver composes it from the node id and the child
run id it has just recorded — whole line, nothing before or after it, node id first and `run=`
second, no other field and no reordering — and prints it only once W2 and W3 have both landed.
The child's on-disk state, never the marker, decides the outcome (*Sub-runs*).

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
