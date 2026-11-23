---
name: maister:workflow-engine
description: Runs a workflow definition — a graph of nodes with declared needs, guards and outputs — as an orchestrated run. Loads a definition plus any overlays, freezes the resolved graph into task state, executes the ready set, asks gates in session or suspends on them according to the run's driver, and writes every state change through the workflow tooling. Machinery invoked by a workflow's own orchestrator, or by `/maister:run` for a workflow started by name; not a workflow a user starts directly. A person asking to carry on a driven run that is waiting on an answer gets, through it, a report of where the run stands.
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
engine command and no engine entry point of its own, and nothing a user reads needs the
word "engine" in it.

**The grammar a definition is written in** — its keys, the target schemes and how a
target resolves, gates, guards, interpolation, the prose companion and overlays — is
[`references/grammar.md`](references/grammar.md). This skill executes that grammar and
does not restate it.

**The gate mode follows the run's driver.** With no driver block, or one whose `kind` is
`terminal`, the engine asks its gates in session and answers them in the same turn. With
`kind` `cockpit` or `dispatch` it suspends on them instead — request file, pending marker,
`GATE-PENDING` line, turn over. Every rule marked *mode-scoped* — most of them in
`references/gates.md` — names which of the two it holds for.

**A dispatched run is told by its `dispatch_id`, not by a kind of its own.** It is a run a
worker runs for a dispatch of a chain: its `orchestrator.driver` is `{kind: cockpit, cwd,
dispatch_id}`, the form a dispatch seed records, or carries the legacy `kind: dispatch`, with or
without a `dispatch_id` — a run recorded that way reads exactly as before. A dispatched run
suspends on its gates like any cockpit run, owes its close-out to the outbox (*Ending a
dispatched run*), is given question sets when its cockpit driver lists `question-sets` — exactly
as a run the cockpit drives directly — and keeps the named defaults when it does not, and stamps
an answer given in its session `via: dispatch`. A cockpit driver with no `dispatch_id` drives its
run directly. Every rule that says *a dispatched run* or *under dispatch* means this one.

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

An apostrophe inside the JSON is `'\''`. On Windows every shell, Git Bash included, takes the
patch file instead. Both rules, and the forms never to use, are in *The invocation contract*.

**3. One verb, one call.** When a step needs two verbs, that is two calls.

**4. Every delegate prompt carries the run's context, fetched.** In the turn that writes the
prompt, run `run-context --state=<state> --node=<node>`, or `prior-context --node=<node>` where
the delegate also needs the earlier phases, and paste its stdout unedited (framework § 3).

**5. Every state change goes through `write-state`.** Never edit `orchestrator-state.yml` or the
dashboard files with an editor tool; the one exception is answering a pending gate
(`references/gates.md` § *Driver-suspended mode — resume*). The patch vocabulary and the
one-write-per-moment rule are in `references/writing-state.md`.

**6. Read what a `rules:` line names.** A verb that prints `rules:` names the reference and the
section that govern this moment. On a refusal it is the section holding the recovery: always read
it before acting. On a brief, read it the first time in a session, and again after a compaction,
which drops what was read.

**7. A missing companion.** **A `write-state` that prints `companion-missing: <node> <path>`**
completed a node whose owed `.html` is not on disk. Recover it as
`../orchestrator-framework/references/orchestrator-patterns.md` § 9 *Recovery on
`companion-missing:`* says: one `html-companion-writer` run for that file, never a re-run of
the node. **A `companion-stale: <node> <path>` line**, from a write that completed a node, or a
`warning: companion-stale:` line from `gate-brief`, names a page older than its markdown — a
later step edited the document after its page was written. Regenerate it the same way, from
the markdown as it reads now, before the checkpoint that shows it is asked.

**8. `run-complete` is the last call.** Its marker is the turn's last line, and every
`missing-artifact:` and `missing-companion:` line it prints goes under **Needs you** in the
wrap-up (*Operator visibility*).

---

## Initialization

**BEFORE executing any node, you MUST complete these steps:**

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `AskUserQuestion` at a gate. They apply only to your discretionary clarifications. Invoke `AskUserQuestion` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine's `references/gates.md`, *Driver-suspended mode*.

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

**There is no editor-tool fallback for state writing**: a model-written state file drifts out
of canonical shape, and its readers then disagree about what the run is.

### Step 3: Resolve the workflow by name

**Run `locate --name=<name>` rather than testing paths by hand.** It takes the name bare or
`builtin:`-prefixed, searches the homes in the order `references/grammar.md` § 1 gives — eject,
generated chain, overlay over the built-in, built-in — and prints the `--definition` and
`--overlay` values `validate` and `resolve` take, so the run is validated against the file the
lookup found. **An overlay beside an eject or a generated chain of its name is never applied**:
say so to the operator rather than letting them believe it is in effect (`validate` reports it as
`overlay-ignored:<name>:<home>`). Whatever the lookup found is what the freeze records as
`workflow.source`.

**A run started by name arrives with more than a name.** `/maister:run` hands over the bare
name, the run's inputs as a map, the overlays, the profile and a title. Its overlays are the
lookup's own followed by any the operator named, in that order, and they and the profile go to
`validate`, `resolve` and the freeze exactly as given (Step 4); the inputs are the freeze's
`orchestrator.options.inputs`, and the title is `task.title`. It has already refused a chain and
validated the definition; both checks are cheap and are run again here regardless, with the same
overlays and profile.

**A run starts from a name the lookup resolves, never from a path.** A definition whose resolved
graph — overlays and profile included — has a node carrying `dir:` is a chain, started and driven
by maister cockpit, never under an absent or `terminal` driver. **A definition declaring
`chain_only: true`** runs only as a step a chain dispatches: its freeze under an absent or
`terminal` driver is refused `state-freeze-chain-only` before anything is written, so no
dashboard opens; relay the message and stop.

### Step 4: Freeze the graph before executing anything

Three calls, in this order, before any node runs: `validate --definition=<path> [--overlay=<path>…] [--profile=<name>]`, then `resolve` with the same flags, then the
`write-state` that installs the resolved graph in `orchestrator-state.yml` as the `workflow:`
block with one line per node. A run executes the frozen graph, never the file on disk, so an
edit to a definition mid-run changes nothing until the next run. **The freeze's `write-state`
names the host**: add `--host=claude` to that call, as `dispatch-model` takes it, so the writer
records how the run's subagents can delegate (`orchestrator.options.delegation`). The freeze also
copies the project profile, the `project:` key of `.maister/config.yml`, into
`orchestrator.options.project`, which `review-brief` hands to the reviewers; a bad value is a
`warning: project-profile: …` line and the field is left out, never a refusal.

**The run's task directory is the freeze's to create.** It is
`.maister/tasks/<type>/<YYYY-MM-DD-slug>/` under the project root, where `<type>` is the
workflow's name — the one rule for every workflow, a workflow started by name included, with
migration's `migrations/` the single exception — and the slug follows the framework's task-name
rule (`orchestrator-patterns.md` § 5), with `-2`, `-3` … appended when a directory of that name
already exists. The writer derives the project root from that depth, so the directory sits
exactly there and nowhere deeper. Do not make it yourself: the freeze creates it, with the state
file inside, and the freeze patch records its repository-relative path as
`orchestrator.task_path`. A resume keeps the directory it has. A child run's directory is not
named by this rule: it is the one `subrun-path` prints (*Sub-runs*). **The freeze creates the
folders inside it**: the first folder of every artifact path the resolved graph declares, so a
node or an agent writing a declared artifact finds its folder there. A deeper folder, a directory
artifact included, is its writer's to create.

**`resolve` does not stand in for `validate`**: only `validate` reports where each target was
found.

**The `workflow` block is `resolve`'s output, copied through.** `source`, `overlays`,
`profile`, `graph_hash` and `name` go into the freeze exactly as `resolve` printed them, beside
`grammar_version: 1`, **and no `nodes`**: the writer lays out one entry per resolved node itself,
each `pending` under its kind, with its `needs`, on a gate that offers a revise its
`reruns`, and on a node that carries `dir:` that `dir` as the definition spells it, which no
later write changes. The whole patch is then a few short values, sent as a here-string: never save
`resolve`'s output to a file or script the block out of it. A patch that does send `nodes` is
held to the graph: one entry per node `resolve` printed and no other, `kind: gate` for a gate,
`kind: workflow` for a `workflow:` node and `kind: task` for every other node. Copy `graph_hash` without reformatting it: it arrives in the spelling the
state block accepts. The overlays and the profile are the ones the run was resolved with. The
writer proves the freeze before it installs it, and its refusal names the recovery.

**The freeze patch carries, beside the block:**
- **`workflow.name`** — the definition's own `name`, as `resolve` printed it; for a built-in,
  the bare name without `builtin:`. The writer derives the run's context block,
  `<name>_context`, from it, so a later `context` write with no name
  recorded is refused `state-context-block-unknown`.
- **`task.key`, when the definition declares a tracker key.** `resolve` reports the input marked
  `tracker_key: true` as `tracker_key` (null when none is), and the freeze writes that input's
  supplied value as `task.key`, the ticket the tracker mirror adopts as the run's parent. A
  definition that marks nothing writes nothing: `task.key` stays absent, never an empty string.
- **The supplied inputs, under `orchestrator.options.inputs`** — a map of input name to the
  value the run was started with; a run started with none writes no key. **A resumed driver
  reads its inputs from the state, never from the line that woke it**, and a run frozen with no
  key has inputs that are genuinely unknown: say so rather than guessing one.
- **`orchestrator.options.html_output`**, read from `.maister/config.yml` (default `true` when
  the file or the key is absent).
- **`orchestrator.options.ceiling`**, when a dispatched run's seed names an autonomy ceiling.
- **The definition's context seed, when its node prose names one**, as `context` — fields known
  before the first node runs. A definition that names no seed sends none.

**The writer adds the rest itself** (`references/writing-state.md` § *What the freeze write
adds*): never send `policy_hash`, `classes_questions`, `task.base_commit` (only `move-base` moves it) or
`orchestrator.options.delegation`, and relay a
`warning: policy-refused:<path>:<reason>` or `warning: base-…` line; the run goes on. The engine creates no task
items: the state file and the dashboard are the run's tracker.

**The freeze write prints the startup banner first; your next message, before any other call,
tells the user what it says.** The banner's first line is that instruction, and the terminal
collapses the call's output, so the user sees none of it until you write it. Your message names
the workflow and the task, how many checkpoints the user decides at, the directory as an absolute
path, the dashboard link exactly as printed (or that there is none) and the first phase by its
title — paths and links copied, never shortened. When the run is driven from the terminal the
freeze has already opened the dashboard in the browser, so run no opener; one that could not
start printed a `warning:` line with the page's path, and the dashboard link is where to open it.

> **SELF-CHECK before the call after the freeze**: does your message since the freeze name the
> workflow and task, the checkpoints, the directory and the dashboard link? If not, STOP and
> write it first.

The banner prints once. A retried freeze — the identical patch sent again because the first
call's output was lost — prints none: read the directory, the dashboard and the first phase off
the state file instead, never from memory. A sub-run child's freeze prints its own banner, which
the parent does not relay.

If `validate` rejects the definition, stop with `RUN-FAILED:` carrying the validator's first
error. Its warnings do not stop the run: relay them (`references/grammar.md` § 14 says what each
means).

### Step 5: Decline the resume flags the graph cannot express

An invocation may arrive carrying `--from=PHASE` or `--reset-attempts`, because operators who
used the 2.x plugin know both. Neither has an expression here. Resume recomputes the ready set
from the frozen graph, so there is no mid-graph entry point to start from; and no attempt counter
lives in state, because a budget is a prose rule rather than counted data.

**Say so by name, before the first node runs.** Name the flag that arrived and state which of the
two facts above makes it inert. No route in this plugin serves either flag. To run a step again,
send it back with the revise its checkpoint offers (`references/gates.md` § *Revising at a gate*).
Then continue with the flag dropped: an ordinary run, or an ordinary resume from the frozen state.
**Never drop one silently.**

---

## The invocation contract

One script, twenty-eight verbs, one exit-code table — `0` success, `1` the input was rejected
(the report is still printed), `2` an internal failure where nothing ran.

```
node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs <verb> [flags]
```

The plugin root is this plugin's own directory — the one holding
`.claude-plugin/plugin.json`, two levels above the base directory the loader shows
for this skill. Run the script by that absolute path, never through the variable:
where a command here still reads `${CLAUDE_PLUGIN_ROOT}`, write the directory in its
place, because a permission rule or hook matches only the literal path. A root holding a
space goes in single quotes.

**The invocation is the whole command.** No `cd` in front of it, no `set -e`, no
variable assigned first and used in it, no second command after it, no redirection
other than the here-string, no heredoc (an agent host's shell-safety check refuses one
whose body is a JSON object), no substitution — and never several verbs packed into one
shell script. Flag values are written bare; a path holding a space goes in single quotes,
never double quotes or a backslash. Any other form brings the approval prompt back.
Every other command a run issues follows the same rule: one command per line, never
several chained with `&&`, `;` or `|`, because a permission rule matches a single command
and a chained line is offered only a dismissal. The here-string and the pipe below are the
documented routes for a verb's JSON and stay as they are.

A patch or a request document travels as a here-string (*Before anything else*, item 2).
Inside single quotes nothing is expanded. An apostrophe inside the JSON is written `'\''` —
close the quote, an escaped quote, open it again — so `{"summary":"the operator'\''s note"}`.
Never the JSON escape `\u0027`, which a tool call decodes into a bare quote that ends the
string early. The typographic `’` may stand for an apostrophe only in a prose text value,
never in code, a command, a path or a quoted identifier. A pipe (`echo '<json>' |` in front)
is accepted too, but the command then no longer starts with the engine path.
A verb never waits on stdin for ever: a terminal is refused unread, and input that stops
arriving without ending is refused after a short wait, with nothing written.

**bash and zsh take the here-string; on Windows every shell takes the patch file** —
PowerShell and cmd have no here-string, and Git Bash can lose the backslashes of a JSON escape
on its way into the command. Any shell may take the patch file as the fallback. A large
document (a big question set or summary) goes through `--patch-file`, because a command line is
limited in length
(about 32 KB on Windows). Write the JSON to `.state-patch.json` in the run directory —
beside `orchestrator-state.yml` — with the file-writing tool, then name it on the call:

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml --patch-file=<run>/.state-patch.json
```

That one name, in that one place, is the only file the verbs read a document from:
any other name or directory, a `..` segment or a link is refused at exit `2`. A write that
lands deletes the file; a refused one leaves it to correct and send again (one left by an
earlier session is read first). `area-brief --patch-file` and `finding-brief --patch-file`
write a question set there themselves.

Every verb's flags, output and refusals are in `references/verbs.md`. Each step here spells the whole call of the verbs every run makes, where its moment is. Read a verb's row there only for a call no step spells.

**A changed definition never re-freezes an open run.** The graph a run froze is its graph
for its whole life, and no verb or flag replaces it. Several things report a change: a read
verb's `…-graph-drift` warning, a parent's `subrun-graph-drifted` and a dispatch's
`dispatch-graph-drifted` refusal, and `state-workflow-frozen` on a `workflow` patch that
tries to install the new graph. Each has the same two ways on. Put back the definition the
run froze (`workflow.source`, with its overlays), and the run goes on where it stopped; an
edit outside the graph, such as a comment or a `display:` title, never changes the hash.
Or start a new run from the changed definition; the old run's task directory and its
artifacts stay where they are. Never revert a person's own edit unasked: name both ways and let the
person choose.

---

## Executing the graph

### The ready set

A node is ready when every `needs` entry is satisfied under its `on:`, an `on: failure` node has
a need that ended `failed` or `stopped`, and its `when` guard is true against the values completed
nodes recorded — the rule, the skip-guard exception for gates included, is `references/grammar.md`
§ 7. A node whose guard is false, and an `on: failure` node with nothing that failed, is recorded
`skipped`, and **a skip satisfies everything downstream**.

**The held rule.** While a choice is held for approval (`references/in-node-questions.md`
§ *When the policy classes a question*), a gate whose guard reads a task node's value is asked
whatever its guard reads: the first such checkpoint that runs lists the held choices first, and
its continue approves them. A gate guarded only by an input or another gate's value is still
skipped by its guard, and the engine refuses to ask it (`gate-guard-false`). When no checkpoint follows a held choice, the closing node asks the run's
own closing checkpoint, `held-approval` — a reserved id, never a node of the frozen graph —
before its closing patch and, under dispatch, before its close-out (`references/gates.md`
§ *The closing checkpoint `held-approval`*).

**A `waiting` node is not ready.** It is a `workflow:` node whose child run or dispatch has not
ended: the walk does not execute it again, it satisfies **no** `needs`, not even under
`on: always`, and it does **not** make the run gate-pending. Its next turn is the waiting path of
*Sub-runs*, or for a dispatch the close-out grade (*Recording an outcome*).

**No node in the shipped built-ins carries `on:`**, which is what makes a stop option terminate a
run: nothing downstream of a stopped node ever becomes ready.

Execute ready nodes one at a time, in the order the frozen graph lists them. When nothing
is pending — or a node failed with no downstream `on:` to take it, or a stop option ended the
run — record `task.status` in the closing patch and end the run through the `run-complete`
verb. It reads that status and prints the marker from it:

- `completed` → `RUN-COMPLETE`, once nothing the run can still reach is left; otherwise it
  refuses (`references/writing-state.md` § *When `run-complete` refuses*);
- `failed` → `RUN-FAILED: node <id> failed`, naming the first failed node, or
  `RUN-FAILED: sub-run <child-run-id> failed` when that node is a `workflow:` node;
- `stopped` → `RUN-COMPLETE` too, because a stop is not a failure — preceded by one plain line,
  `run stopped: <node> - <option>`. `task.status` on disk is what says the run stopped.

Whatever the ending, a `missing-artifact: <node> <path>` line precedes the marker for each
declared artifact of a `completed` node that is not on disk and not recorded under `absent`, and
a `missing-companion: <node> <path>` line for each owed `.html` companion that is not — warnings,
never refusals (framework § 10). A dispatched run that owes a close-out it never published gets
`RUN-FAILED: closeout-unpublished` whatever its status. Echo the verb's lines, the marker last;
do not type a marker the verb did not give you. How the lines reach the operator depends on the
driver (*Operator visibility*).

### Ending a dispatched run

**A dispatched run publishes its close-out through the outbox verb, and the closing node records
its outcome only after that publish succeeded** — in a run that records `classes_questions`,
never before `gate-brief --node=held-approval` has run. There `run-complete --state=<state>` also
takes `--outbox` and `--dispatch-id`, copied unchanged from the seed: the state records no outbox
root, and its `dispatch_id` only marks the run as dispatched. The outcomes, the `DISPATCH-RESULT:`
fallback and the `task.status: completed` a refused `held-approval` request still records are
`references/gates.md` § *Ending a dispatched run*.

### Delegation by scheme

**While a delegate runs, say so — the prompt otherwise looks like it is waiting for the user.**
Right after launching a node's delegate, print one line: *"<Phase title> is running. Nothing
needed from you; I'll continue when it finishes."* When a notification brings you back and the
work is not finished yet, print one short progress line — what is done and what is left — before
you wait again. Never predict how long a step will take; an elapsed time a step reports is a fact
and may be said as one. When the run has a dashboard, the first such line ends *"Progress is on
the dashboard in your browser."*, and a later one repeats it now and then — after a gate, or on a
long wait — never on every line and never with its path. Questions never name the dashboard.

Target names are bare; the provider prefix is applied at invocation (`references/grammar.md` § 5.1).

Before executing any node, run `node-brief --state=<state> --node=<id>` and read its output
whole. It prints what the run derives for the node and the conventions that apply to it, and
its last part is the node's section of the prose companion: for a `direct:` node its steps,
fan-outs, self-checks and the questions it asks inline. **It also records the start**: for a
ready `agent:`, `skill:` or `direct:` step still `pending` — not a dispatch — it writes the step
`running` and prints a `started:` line, so that step's start needs no write of its own. Without
that line (a gate, a `workflow:` step, a re-drive, or a skip still owed before it), the start is
your write, as `references/writing-state.md` § *One write per moment* says. Whether those inline questions are
asked at all follows the run's driver — see `references/in-node-questions.md`
§ *In-node questions*.

### Node conventions

Every node follows the rows that apply to it: a step its scheme's row and `every step`, a gate
the `gate` row, and any node each other row whose case it meets. A node's section states only
what is its own and never restates these. `node-brief` prints a row while it applies: the
`direct:` row only for a step that owes a page or has no section, `every step` only for a step
that declares an output, `named by a revise` while a recorded revise names the step and `has a
budget` on the last budgeted attempt; before then those two are named on one line that points
here. A row is printed whole the first time a session's briefs meet it, and after that named on
one `conventions in force (…)` line: the session has it in view from that brief, and this
section is at the brief's `rules:` path. A resume (`resume-check`) and a compaction both clear
what the session was shown, so the first brief after either prints every row it needs whole
again. A host that names no session gets every row whole on every brief.

| Applies to | Convention |
|---|---|
| `agent:` step | Task tool, passing the `model` and `effort` the `runs:` line prints beside the agent type; a field it prints as `omit` is left off the call. The prompt carries the `with:` values; each declared path the agent writes, never one the Writes part keeps for the step — an `output_path` agent gets it as `outputs.artifacts` declares it, relative to the task directory, since it joins it to `task_path`; and `prior-context --node` pasted unedited (`run-context` if nothing earlier is needed). Its `headline` is the summary headline. |
| `skill:` step | Skill tool, given the `with:` values and the `run-context` output; the skill's own result feeds the node summary. |
| `direct:` step | Run inline from the node's section, except the agents a `delegates:` line names: each is dispatched through the Task tool, never done in the session, and listed under `delegated` in the closing write, which is refused without it. A step that owes an HTML page hands its finished markdown to `html-companion-writer` before the completing write, on the model and effort its `companion writer:` line prints, the prompt carrying the `html:` line and that page's `md_path:` line printed under it, as printed. A step with no section does only what these rows say. |
| `workflow:` step | Starts a child run and waits for it (*Sub-runs*); its outcome is mapped, not judged (*Recording an outcome*). |
| gate | Asked from `gate-brief` (`references/gates.md`); record the answer, end the run on a stop, revise through `gate-revise`. A false guard skips it with its stretch, unless that guard reads a step's value and the gate is no pure confirmation, or reads a step's value while a choice is held. A false guard on inputs or other gates' values alone always skips it, held choices or not: `gate-brief` and `gate-request` refuse it `gate-guard-false`. Sections hold exceptions only. |
| every step | A throwaway file the step makes itself — a probe, a benchmark, a copy — goes in a directory `mktemp -d` makes (it uses `$TMPDIR`) or under `"${TMPDIR:-/tmp}"`, never a literal `/tmp` path: a fixed `/tmp` path can stop the run for a permission prompt. Before recording `completed`, check each declared artifact path. A missing one its `brief:` `absent` does not sanction is a failed self-check: re-drive the step, naming the path. Record a sanctioned absence under `absent` with its reason, and record every declared value. |
| asks | With question sets, ask everything known at the first asking point in one request, and a follow-up set only for what an answer raised, at most two follow-up rounds per attempt (`gate-brief-rounds-spent` past them: take the named defaults); without them, record the Without default `by: default`. Record each in-session answer as one `by: operator` decision with its `question_id`, question, answer, recommended answer and `as_recommended` on the step's own `node_summaries` entry (`references/gates.md`). Once `classes_questions` is recorded, give each question in the set the family that fits it from its id's `families` line, if the brief prints one; a lower family only with the question reader's verdict copied on as `reader` (`references/in-node-questions.md`), and the same verdict on each question of an id a `reader (<id>)` line names, a clarification the run settles only with it; and ask only the classing writer's `ask:` ids; held choices wait for the next checkpoint or `held-approval`. Before treating any answer as settled, apply the fact-or-choice test (`references/in-node-questions.md`, *A fact is what no answer would change*): an answer that would change what the product does, or who may do it, is a choice, asked or classed, never settled as a fact; a step's own triage may only raise a question's class. |
| feeds a checkpoint | The closing summary keeps the summary contract: a one-sentence `headline` within 220 characters; the artifact's decisions and risks item for item, tagged; `recommends` with a one-line reason as `brief:` directs once its input is set, or naming the gate's revise when the node finds its work short of what was agreed (`references/gates.md`). |
| named by a revise | Read the note from `prior-context`; revise the step's own artifacts in place; keep earlier answers unless the note reopens them; record the declared values again; say what changed and write the headline again. |
| has a budget | The attempt count in `brief:` `budget` is a prose rule nothing enforces. When the last attempt fails, the budget-exhausted rows of *Recording an outcome* decide. |

### Interpolating `${…}`

Before a node runs, the driver substitutes every `${…}` in its `with:` — however deeply nested —
and in its `dir:`; `node-brief` prints both filled in by the rules below, so a step takes them
from there rather than resolving them by hand. A gate's `ask:` is shown as written: `validate`
refuses a `${…}` there. Nothing else is
interpolated: an artifact path is literal, a `when` is evaluated by the ready-set rule, and `uses`
names a target as written. Each reference reads the run's state, never a recollection of it:

| Reference | Resolves to |
|---|---|
| `${inputs.<name>}` | `orchestrator.options.inputs.<name>`; else the input's declared `default`; else null |
| `${<node>.values.<key>}` | the value the node recorded in `workflow.nodes.<node>.values`. A skipped node recorded its bools false and its strings and enums null |
| `${<node>.artifacts.<key>}` | the path the node declares, joined onto the task directory of the run that wrote it and spelled repository-root-relative (`references/writing-state.md` § *Recording an outcome — the detail*). A node with `dir:` declares a member repository's path: a dispatch envelope reads it in that dispatch's worktree once its close-out is published; one that also runs a `workflow:` is read at the path its worker's close-out lists for the key, in that worktree (the umbrella skill, `seed`) |

**A value keeps its type when the reference is the whole string.** `with: {deep:
"${intake.values.deep}"}` hands over the bool `true`, and a null stays null. A reference inside
longer text becomes text, and a null there becomes empty — which is why a value a skipped node
may have left null is read from state by the node's prose, never interpolated.

**The sub-run join.** A `workflow:` node's own `with:` is interpolated first, and the result is
what the child freezes as its inputs (W2 in *Sub-runs*). Once the parent has adopted the child's
outcome (W4), `${<node>.values.<key>}` is the value W4 copied onto the node, and
`${<node>.artifacts.<key>}` the child's declared path joined onto the node's `values.task_path`.

**A reference never resolves by guessing.** One that finds nothing in state at run time — a
completed node that never recorded a declared value — is the earlier node's defect: re-drive that
node, or record the value through `write-state`, rather than substituting a plausible one.

### Recording an outcome

Every node's outcome maps onto a status deterministically, the same for all three executable
schemes:

| Outcome | Status | Downstream |
|---|---|---|
| Completed, self-check passes | `completed` | satisfies `needs` |
| Self-check failed, the re-drive succeeded | `completed` | satisfies `needs` |
| Budget exhausted, the operator chose to retry, and it then succeeded | `completed` | satisfies `needs` |
| Budget exhausted, the operator chose to skip | `skipped` | satisfies `needs`; declared boolean outputs default false, declared string outputs to null |
| Hard failure with no operator path | `failed` | satisfies nothing by default; the run stops with `RUN-FAILED` |

**A node is recorded only with one of eight statuses, and its values only in the types its
outputs declare** (`references/writing-state.md` § *Recording an outcome — the detail*); the
writer refuses anything else, and its refusal names the fix.

**An outcome that comes from elsewhere is mapped, never judged**: a `workflow:` node's is its child's
`task.status` (`references/sub-runs.md` § *Ending, and the re-resolve that precedes W4*), and a
dispatched node's (`dir:`) its close-out grade, the held `partial` question included
(`references/in-node-questions.md` § *A dispatch closed out partial*).

---

## Gates and in-node questions

**At a gate, the first call is `gate-brief --state=<state> --node=<gate>`**, on its own and only
after the closing write has returned — `gate-request --node=<gate>` in its place when a driver
suspends on it, and when the gate is asked in session:
<!-- rich-picker -->
with `--json --picker=rich`.
<!-- /rich-picker -->
<!-- plain-picker
with `--ask`, whose whole output is the question tool's arguments, passed as they stand.
-->
Its output is what the user is asked; never write a gate question by hand. The brief, asking in session, suspending under a driver,
resuming, a stop and a revise are `references/gates.md`, and the line `gate-brief` and
`gate-revise` print names the section that governs the moment.

**A question a node asks inside itself** is asked, suspended on or defaulted according to the
run's driver, and classed first when the freeze recorded `classes_questions` — read
`references/in-node-questions.md` before a node asks its first one. `area-brief` and
`finding-brief --patch-file` name the section for theirs.

---

## Sub-runs

A `workflow:` node starts a child run: read `references/sub-runs.md` before its first write —
the writes, the checks that refuse and the ending are there.

## Resume

Read `orchestrator-state.yml`, take the frozen graph from its `workflow:` block, recompute
the ready set from the recorded node statuses, and continue. Resume never re-resolves the
definition: the graph that ran is the graph that resumes. `/maister:run <run directory>` and
`/maister:work <run directory>` take `workflow.name` from the run's state, through
`resume-check`, and hand it here with the directory as the resume target.

**A run under a `cockpit` or `dispatch` driver takes its first line through `references/gates.md`
§ *Driver-suspended mode — resume*, by whichever route it came here.** A stamped line and a person's
words each have their rule there; neither takes the ready set while `gate_pending` is set. A person's
words get a report of where the run stands and write nothing. They start with this verb, and with no
`--state` when no run was named: it finds the waiting runs. Read the reference with the read tool, never
through a shell: a host may deny shell calls on a waiting run. On such a run a session given a person's
words records nothing at all, not even an answer on disk, and never takes an answer from the person in
the session: an answer is folded only on a stamped line.

**A resume declines the same two flags a first run does.** Resume skips Step 3 and Step 4 — the
graph is already frozen — but never Step 5, and a resume is where those flags usually arrive.

**Every resume starts with `resume-check`**, run right after Step 2's probe and before anything
else: `resume-check --state=<run directory>/orchestrator-state.yml`. Exit `0` prints the frozen
workflow's `name`, `overlays` and `profile`, the run's `root` — its checkout, derived from where
the state file is (`references/writing-state.md`) — and its `dashboard` link: when it is not
`null`, show it once as `Dashboard: <link>` as the resume begins — the verb has opened it in the
browser for a terminal run, so run no opener. Exit `1` is a directory this
engine does not resume, and its `message` is written for the operator:

- `written-by-2x` — the task was started on the 2.x plugin and there is no frozen graph to
  resume. Relay the `message` verbatim and stop. Write nothing into the directory, the dashboard
  included, create no task directory, and print no run marker, because no run started.
- `run-set-aside` — the directory is a `<run>.moved-<digits>` or `<run>.failed-<digits>` copy
  kept beside a run, not a run. Relay it and stop, writing nothing.
- `state-unreadable` — relay it and stop.

A `warning: legacy-mirror-ignored:` line on stderr beside an exit-`0` report means the run's
context block still carries the retired phase-summary mirror: the decisions and risks it counts
reach no later step. Relay the line once and resume as usual.

When a gate's revise is still open, the exit-`0` report carries `revision: {gate, option, reruns,
revision, applied}`. `applied: true` means the stretch is reset and waiting to re-run: resume as
usual, and the rerun node's prompt carries the note. `applied: false` means a driven fold recorded
the revise and `gate-revise` never ran: run it first (`references/gates.md` § *Revising at a gate*).

While a gate is pending, the report carries `gate: {node, request, asked_at, answer_state, answer_files}`:
each answer file's name, path, whether it is usable and why not, and what it holds, with the verdict
`answer_state` (`none`, `one`, `several` or `unusable`), and `part_recorded` only when the run's record
is part-way through. `driver_kind` is always there. What a person's
first line does with them is `references/gates.md` § *A first line from a person*.

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
- **A choice still open is the reader's.** A risk or open question that waits on a choice is
  written to whoever reads the gate — "you have not yet chosen between…", "confirm at this
  checkpoint" — and never names a role (owner, lead, operator, reviewer) as the one who decides:
  who is asked is decided outside the run.
- **Credit each decision to whoever made it** — you, the audit, the step that settled it, or a
  default the run took. Its `by` records that; never write the source into the decision text. Never "as you chose" for something the spec decided.
- **Every recommendation gives its reason**, in the option's description, and keeps every
  criterion the task states (`references/in-node-questions.md` § *In-node questions*). "(Recommended)" appears once per question, on
  the option, never in the question text.
- **"Needs your decision"**, not "needs a hand".
- **Paths are anchored.** Name a run file by its path from the project root
  (`.maister/tasks/<type>/<run>/analysis/gap-analysis.md`), never relative to a directory the
  user cannot see. One exception: a gate's *Review* and its More details name files by their
  path inside the task folder (`analysis/gap-analysis.md`), which the start banner has named.
- **Nothing about the machinery.** A command a hook blocked, a retried write, a condensed context
  passage: none of it is news to the user unless it changed the result.
- **Stay at the project root.** Run every command from there, and never `cd` into the task
  directory — not even as `cd <dir> && grep …`: pass the file's path from the project root
  instead. The session's working directory is what the user's status line shows.

---

## Operator visibility

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
    with its real flags (`/maister:development --research=<task-dir>`), when there is one, then
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
**The first two come from a verb; the third is typed.** For `RUN-COMPLETE` and `RUN-FAILED`,
echo the lines `run-complete` printed — the `missing-artifact:` and `missing-companion:` lines
and a stop's notice above the marker — and do not type a marker it did not give you. Everything
the operator is meant to read at the end —
the executive summary, the full list of next steps and the dashboard link — is printed before the
`run-complete` call, never after it, so the verb's marker stays the last line.
`WAITING-SUBRUN` has no verb behind it: the driver composes it from the node id and the child
run id it has just recorded — whole line, nothing before or after it, node id first and `run=`
second, no other field and no reordering — and prints it only once W2 and W3 have both landed.
The child's on-disk state, never the marker, decides the outcome (*Sub-runs*).

A marker carries **no `at=`**. `WAITING-SUBRUN` is **never printed under an absent or
`terminal` driver**, where the turn does not end at a sub-run.

---

## When to use

**Use** when a workflow's orchestrator or `/maister:run` hands a run over, including a child
run a node of that definition starts (*Sub-runs*).

**Do not use** to run a definition file by path, to start a chain, to author an eject or an
overlay, to dispatch a `workflow:` node carrying `dir:` into a member repository, or as a
workflow a user starts directly. Each of those is another skill's job, or the cockpit's. A
dispatch goes through the umbrella runtime's `envelope` verb, which opens the dispatch's ledger
entry itself; a run never writes `create-entry` for a dispatch.
