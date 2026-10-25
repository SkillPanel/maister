---
name: workflow-engine
description: Runs a workflow definition — a graph of nodes with declared needs, guards and outputs — as an orchestrated run. Loads a definition plus any overlays, freezes the resolved graph into task state, executes the ready set, asks gates in session or suspends on them according to the run's driver, and writes every state change through the workflow tooling. Machinery invoked by a workflow's own orchestrator, or by `/maister-copilot:run` for a workflow started by name; not a workflow a user starts directly.
user-invocable: false
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` on a fresh project — run `mkdir -p` on that folder first.

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

# Workflow Engine

The execution half of the workflow grammar. A definition file says which nodes exist,
what each one needs, what guards it and what it declares; this skill turns that graph
into a run — one ready set at a time, with state written by a script rather than by a
model holding a file open.

**This is machinery, not a feature.** A user reaches a workflow through that workflow's
own command, whose orchestrator hands the run here with a workflow name — or, for a
workflow the project defines itself, through `/maister-copilot:run <name>`, which looks the name
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
dispatched run*), is never given question sets whatever `features` it lists, and stamps an
answer given in its session `via: dispatch`. A cockpit driver with no `dispatch_id` drives its
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
the node.

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
stays on the 2.x line (`copilot plugin marketplace add SkillPanel/maister#release/2.x`, then
`copilot plugin install maister-copilot@maister-plugins-2x`). A dispatched worker reports `blocked` through the
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

**A run started by name arrives with more than a name.** `/maister-copilot:run` hands over the bare
name, the run's inputs as a map, the overlays, the profile and a title. Its overlays are the
lookup's own followed by any the operator named, in that order, and they and the profile go to
`validate`, `resolve` and the freeze exactly as given (Step 4); the inputs are the freeze's
`orchestrator.options.inputs`, and the title is `task.title`. It has already refused a chain and
validated the definition; both checks are cheap and are run again here regardless, with the same
overlays and profile.

**A run starts from a name the lookup resolves, never from a path.** A definition whose resolved
graph — overlays and profile included — has a node carrying `dir:` is a chain, started and driven
by maister cockpit, never under an absent or `terminal` driver.

### Step 4: Freeze the graph before executing anything

Three calls, in this order, before any node runs: `validate`, then `resolve`, then the
`write-state` that installs the resolved graph in `orchestrator-state.yml` as the `workflow:`
block with one line per node. A run executes the frozen graph, never the file on disk, so an
edit to a definition mid-run changes nothing until the next run. **The freeze's `write-state`
names the host**: add `--host=copilot` to that call, as `dispatch-model` takes it, so the writer
records how the run's subagents can delegate (`orchestrator.options.delegation`). The freeze also
copies the project profile, the `project:` key of `.maister/config.yml`, into
`orchestrator.options.project`, which `review-brief` hands to the reviewers; a bad value is a
`warning: project-profile: …` line and the field is left out, never a refusal.

**The run's task directory exists before the freeze**, because the state file the freeze writes
lives in it. It is `.maister/tasks/<type>/<YYYY-MM-DD-slug>/` under the project root, where
`<type>` is the workflow's name — the one rule for every workflow, a workflow started by name
included, with migration's `migrations/` the single exception — and the slug follows the
framework's task-name rule (`orchestrator-patterns.md` § 5), with `-2`, `-3` … appended when a
directory of that name already exists. The writer derives the project root from that depth, so
the directory sits exactly there and nowhere deeper. Create it once, on a first run, and record
its repository-relative path as `orchestrator.task_path` in the freeze; a resume keeps the
directory it has. A child run's directory is not named by this rule: it is the one `subrun-path`
prints (*Sub-runs*). **The freeze creates the folders inside it**: the first folder of every
artifact path the resolved graph declares, so a node or an agent writing a declared artifact
finds its folder there. A deeper folder, a directory artifact included, is its writer's to create.

**`resolve` does not stand in for `validate`**: only `validate` reports where each target was
found.

**The `workflow` block is `resolve`'s output, copied through.** `source`, `overlays`,
`profile`, `graph_hash` and `name` go into the freeze exactly as `resolve` printed them, beside
`grammar_version: 1`, and `nodes` carries one entry per node `resolve` printed and no other:
`kind: gate` for a gate, `kind: workflow` for a `workflow:` node and `kind: task` for every other
node, each `status: pending`. The writer fills in each node's `needs`, and on a gate that offers
a revise its `reruns`. Copy `graph_hash` without reformatting it: it arrives in the spelling the
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
adds*): never send `policy_hash`, `classes_questions`, `task.base_commit` or
`orchestrator.options.delegation`, and relay a
`warning: policy-refused:<path>:<reason>` or `warning: base-…` line; the run goes on. The engine creates no task
items: the state file and the dashboard are the run's tracker.

**The freeze write prints the startup banner first; your next message, before any other call,
tells the user what it says.** The banner's first line is that instruction, and the terminal
collapses the call's output, so the user sees none of it until you write it. Your message names
the workflow and the task, how many checkpoints the user decides at, the directory as an absolute
path, the dashboard link exactly as printed (or that there is none) and the first phase by its
title — paths and links copied, never shortened.

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
two facts above makes it inert. No route in this plugin serves either flag: say that re-entry is
planned for the engine, and that a run which genuinely needs a phase jump today is one to finish
on the 2.x line. Promise no date. Then continue with the flag dropped: an ordinary run, or an
ordinary resume from the frozen state. **Never drop one silently.**

---

## The invocation contract

One script, twenty-two verbs, one exit-code table — `0` success, `1` the input was rejected
(the report is still printed), `2` an internal failure where nothing ran.

```
node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs <verb> [flags]
```

The plugin root is this plugin's own directory — the one holding
`.claude-plugin/plugin.json`, two levels above the base directory the loader shows
for this skill. Run the script by that absolute path, never through the variable:
where a command here still reads `${MAISTER_PLUGIN_ROOT}`, write the directory in its
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
Never the JSON escape `'`, which a tool call decodes into a bare quote that ends the
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

| Verb | Flags | Gives |
|---|---|---|
| `validate` | `--definition`, repeatable `--overlay`, `--profile` | `{ok, errors[], warnings[], resolved[]}` on stdout — `resolved` says where each target was found. Every profile the overlays declare is judged, selected or not, and a finding only one profile produces is prefixed with its name. What each warning means is `references/grammar.md` § 14 |
| `resolve` | `--definition`, `--overlay…`, `--profile` (a profile one of the overlays declares; selecting any other is refused) | the canonical graph, its `graph_hash` **in the spelling state records** — write it through unchanged, never re-spell it — and `tracker_key`, the input the freeze reads for `task.key`, or null |
| `diagram` | same, plus `--out` | deterministic Mermaid text; its header names the overlays (by file name) and the profile applied, and a gate box carries its question and its options as `id: effect` |
| `locate` | optional `--name` (bare or `builtin:`-prefixed); with it, repeatable `--overlay` and `--profile` — the run's own | with a name, where the lookup (Step 3) finds it: `{ok, errors[], name, from, definition, overlays[], ignored, companion, title, summary, inputs, dispatches[], html_companions}` — `definition` and `overlays` are the values the three verbs above take, a project path written relative to the project root; `dispatches` names the nodes carrying `dir:` in the folded graph, and `html_companions` is the block merged from every layer (`{}` when none declares one). Exit `1` when the name is found nowhere, is not a workflow name, finds only an overlay with no built-in beneath it, or finds a file whose `name:` is another. With no name, `{ok, errors[], workflows[]}` — the project's own definitions. Reads only |
| `write-state` | `--state`; the patch as JSON by here-string, or `--patch-file` naming it in the patch file; `--host=copilot` on the freeze (Step 4) | the changed paths, one per line; the freeze prints the startup banner and a blank line before them (Step 4). A write carrying a node's question set adds a blank line and `ask: <id> <id> …`, or `ask: none` (`references/in-node-questions.md` § *When the policy classes a question*). A write completing a node whose owed `.html` companion is not on disk ends with a blank line and one `companion-missing: <node> <path>` line per companion, exit `0` (*Before anything else*, item 7). The closing checkpoint `held-approval` is written under `node_summaries.held-approval`, and its `status` under `nodes` (`references/gates.md` § *The closing checkpoint `held-approval`*) |
| `gate-request` | `--state`; the request as JSON by here-string, or `--patch-file` naming it in the patch file | the files written, one per line: the request file, the gate index and the pending marker, in one call (`references/gates.md` § *Driver-suspended mode — the write order*) |
| `gate-revise` | `--state`, `--node` (the gate), `--option` (its revise option); `{note, answered_by?, at?, via?}` by here-string, or `--patch-file` naming it in the patch file | the changed paths, one per line, then a blank line and `revised: <gate> reruns=<node> revision=<n>/10 reset=<ids>`: the stretch from the option's rerun node to the gate reset in one write, with the note on the gate (`references/gates.md` § *Revising at a gate*) |
| `run-complete` | `--state`, and in a dispatched run `--outbox` and `--dispatch-id` | the run's closing marker as the **last** line of stdout, with any `missing-artifact:` lines, then any `missing-companion:` lines, and a stop's notice above it; the refusal on stderr |
| `prior-context` | `--state`, optional `--background`, optional `--node` | the prior phases' decisions and risks as markdown, to paste into a delegate prompt; `--background` frames them as background for a document written for end users; `--node` prints that node's `run-context` block first, then one blank line, then the same passage, with `run-context`'s refusals; a context block whose retired `phase_summaries` mirror still holds a decision or a risk adds one `warning: legacy-mirror-ignored:` line counting its decisions and risks, which `resume-check` already relayed at resume, so it is not repeated to the user, exit `0` — reads the run, writes nothing |
| `run-context` | `--state`, `--node` (the node about to delegate) | the run-scoped context a delegate prompt carries, as markdown to paste unedited (*Before anything else*, item 4); when the definition the run froze cannot be re-read, `companions: unknown` and one `warning: run-context-definition-unread` line, exit `0` — reads the run, writes nothing |
| `node-brief` | `--state`, `--node` (the node about to run) | What the node reads before it runs, as markdown: how it runs — for an `agent:` step with the model and effort its call carries, as `dispatch-model` resolves them, and for a `direct:` step whose `brief:` declares `delegates` for the run's host a `delegates:` line with each agent of that set beside its model and effort — its guard and attempt, its `with:` values and `dir:` filled in, the files it writes with the pages it owes and the absences `brief:` allows, its questions under this run's driver, the checkpoint it feeds, its `brief:` data, the convention rows that apply now — a row that applies only later, under a recorded revise or on a last attempt, named on one `convention (…): see rules` line — for an `agent:`, `skill:` or `direct:` step run here, a `closing patch` line giving the closing write's exact keys with each value a placeholder, and a `rules:` line, then the node's own section. A ready step still `pending` is recorded `running` by it, with a `started:` line; a write it could not make is one `warning: node-brief-start-unrecorded` line. A line that would only state the default (no guard, a first attempt not yet run, an unset recommends input) is left out. A gate gets the `gate-brief` call instead, unless its section carries an exception. Graph drift, an unread definition, a node the definition no longer carries or an unread conventions table is one `warning: node-brief-…` line, exit `0` — reads the run, writes nothing |
| `gate-brief` | `--state`, `--node` (the gate), and at most one of: `--json` with `--picker=plain`, `--checkpoint`, `--request` or `--oneline`; or `--node` (a running node) with `--checkpoint` or `--request` and `--patch-file` — the node's question set as JSON in the patch file | The brief for a gate, or for a running node's question set. It writes no state, only the run's `display/next.json`. With no form, the brief as text within 1,600 characters, plus the trailing `rules:` line; `--node=held-approval` briefs the run's closing checkpoint. Each form's shape is `references/gates.md` § *The `gate-brief` forms* |
| `area-brief` | `--state`, `--node` (the convergence node that is asking), and one form: `--area=<id>` with `--json` and `--picker=plain`; `--area=<id>` alone; or `--patch-file=<run>/.state-patch.json` with `--area` repeated or omitted | One decision area of the brainstorm, as a picker in the field shape of `gate-brief --json`, as its full write-up in markdown, or written as a driven question set to the patch file (`references/in-node-questions.md` § *Decision areas from the brainstorm*). A file it cannot use is one `warning: decision-areas-…` line on stderr, exit `0`, and the node composes the area itself. Writes no state and no `display/next.json` |
| `finding-brief` | `--state`, `--node` (the reviewing node that is asking), `--findings-file=<file in the run>`, and optionally `--patch-file=<run>/.state-patch.json` | The node's findings that need a decision as one question set, printed as JSON or written to the patch file (`references/in-node-questions.md` § *Findings that need a decision*). A file it cannot use is one `warning: finding-list-…` line on stderr, exit `0`, and the node composes the questions itself. Writes no state |
| `resume-check` | `--state` | JSON on stdout: the frozen workflow's `name`, `overlays` and `profile`, the run's `root` (its checkout, derived from where the state file is) and its `dashboard` link (`null` when it has none), or, exit `1`, the refusal of a directory the engine does not resume, with an operator `message` (*Resume*); a retired `phase_summaries` mirror in the context block that holds a decision or a risk is one `warning: legacy-mirror-ignored:` line on stderr, outside the JSON, exit `0` — reads the run, writes nothing |
| `subrun-path` | `--state` (the parent's), `--node` (its `workflow:` node) | JSON on stdout: `{ok, node, workflow, task_path, run_id, recorded, existing}` — the child run's directory relative to the project root and its run id, as the parent recorded them (`recorded: true`) or as the sub-run naming rule gives them, with `existing` `absent`, `empty` or `adopt` (*Sub-runs*). The only source of a child's directory: never work it out by hand. Exit `1` with `{ok: false, code, message}` for the refusals below and for `subrun-on-dir-node`, `subrun-recursion`, `subrun-target-unresolved` and `subrun-child-foreign` (`references/sub-runs.md`); a definition that drifted since the freeze is one `warning: subrun-path-graph-drift` line, exit `0` — reads the run, writes nothing |
| `import` | `--state`, `--to=<folder of the run>`, repeatable `--from=<file or directory>` (absolute, or relative to the project root), optional `--as=<name>` with a single `--from` | Each source copied into `<to>/<its name>` (`<to>/<as>` when renamed), byte for byte, a directory recursively and a link as what it points at, replacing an earlier copy; JSON on stdout: `{ok, to, copied: [{from, to, files}], skipped: [{from, code, message}]}`, every path relative to the run and spelled with `/`. **The only way a node brings context into its run: never a shell copy**, which a driven session's permissions refuse, and never the file tools, which cannot carry a binary. A source it could not copy is listed under `skipped` — `import-source-missing`, `import-source-overlaps` (it holds the destination or lies in it) or `import-copy-failed` — the rest are still copied, and the exit is `1`; what a skipped source means for the step is the step's to record. Exit `1` with `{ok: false, code, message}` for the refusals below — writes the copies, never state |
| `wave-start` | `--plan` (the run's `implementation/implementation-plan.md`), `--wave=<K>`, `--groups=<N>[,<M>…]` | appends `## <clock> - Wave K Started: Groups N, M` to the work log beside the plan and re-projects the run's displays through an empty state write; JSON on stdout `{ok, wave, groups, logged, reprojected}`. A repeated call appends nothing; a group the plan lacks or already marks done is refused (`wave-start-unknown-group`, `wave-start-group-done`), nothing written |
| `group-done` | `--plan`, `--groups=<N>[,<M>…]`, `--entry-file=<plan folder>/.work-log-entry.md` (the body; with several groups, one `## Group N` line opening each part) | records accepted groups in one call: marks their open step checkboxes, runs `sync-plan`, appends `## <clock> - Group N Complete (wave K)` with the body for each, the wave read from the last start naming the group, and re-projects; JSON on stdout `{ok, groups: [{group, wave, marked, logged}], sync, reprojected}`. Idempotent: an entry already logged under its wave is not appended again. A sync or re-projection that fails is a `warning:` line, exit `0`. Each refusal (`group-done-…`) says what was written and how to finish — a log that cannot be written after the plan was marked is finished by the same call run again; the entry file is deleted once its entry is in the log |
| `sync-plan` | `--plan` (the run's `implementation/implementation-plan.md`) | sets the plan companion's `data-group` / `data-step` markers to the plan's checkbox state; JSON on stdout with `written` and the groups the companion has no marker for — idempotent, and a no-op that names its reason when there is no companion or the run's `html_output` is off |
| `dispatch-model` | `--agent=<name>[,<name>…]`, `--host` (`claude` or `copilot`, the host the session runs on), optional `--state` (the run's), `--node` (with `--state`, the node that dispatches) and `--tier=light\|standard\|deep` (a task group's plan tier, read only for an agent whose entry is `choose: by-plan-tier`) | One line per agent, in the order asked: `<agent>: model <model>, effort <effort> — source: <level>`, where `omit` means the call carries no such field and the host decides. Copy the values into the agent call beside its type. Then, after a blank line, any `note:` lines: the agent's budget on the rung, saying to ask first once it is used up; the agents a `--tier` was ignored for, which resolve as without one; and one note when the project's `.maister/config.yml` changed since the freeze, the run keeping what it froze. With `--state` it reads the block the freeze recorded and scopes by the run's workflow and `--node`; without it, outside a run, it reads `.maister/config.yml`, and a finding about it is one `warning: subagents-…` line, exit `0` — reads only |
| `review-brief` | `--state` (the run's), or `--task-path` (a task directory outside a run) with `--base`; optional `--base` (the commit to measure from, for a run frozen before `task.base_commit` was recorded), `--cycle=<N>`, `--recheck=tests-only\|reviews` with `--fixed-issues=<id>[,<id>…]`, or `--refresh` | Writes `verification/review-brief-<N>.json` in the run and prints its absolute path: what one verification cycle reviews, measured once from the run's base commit — the changed files (untracked included, the project's `.maister/` never) with their status and line counts, each marked `untracked`, `generated` (a lock file, minified output, a path marked `linguist-generated`) or `data` (fixtures, data files, a large file of a data or config format — never source code for its size) where it is, the diffstat, from cycle 2 on the fix since the previous cycle's snapshot (`fix`: the two snapshots and the files between them), `documents` (the paths of the run's spec, plan, work log, clarifications, audit and the state holding its decisions, those present), the plan's group counts, the test result and the project's other checks (`checks`; a failure the base has too marked `failed_on_base` in the test result and `fails_on_base` on its check), the project profile (`profile`: its fields with `source: config` — in a run the copy the freeze recorded, standalone the `project:` key of `.maister/config.yml` — or `{source: none}`, when each reviewer infers it), the reviewers' findings contract, and on a re-check the issues with the reviewer owning each. The working tree is captured as a tree id through a temporary index: the user's index, commits and stash are never touched. Without `--cycle`, a cycle never merged is built again under its number, else the next one is taken; `--refresh` only re-reads the cycle's test result into its brief. A part it cannot fill — a snapshot that fails or outruns its budget included — is one `warning: review-brief-…` line and the brief is written without it, exit `0`. Refusals below |
| `findings-merge` | `--state`, or `--task-path`; optional `--cycle=<N>` (default: the last cycle with a brief) | Merges the cycle's `verification/<reviewer>-findings.json` files with the previous cycle's merged list into `verification/findings-<N>.json`, copied to `verification/findings.json`: duplicates across reviewers folded (one path, lines within ten, one category family; the highest severity, `severity_disagreement` when they differ), ids kept across cycles, a finding not reported again left open as `not_reported` unless a fix diff since touched it, a finding marked `outside_change` counted only when critical and otherwise moved to `out_of_scope`, a finding marked `fails_on_base` moved there at any severity when its evidence quotes the base (without evidence it is counted, with one `warning: findings-merge-base-evidence` line), a re-check's answers applied and its new findings outside the fix diff moved there too; the fix's hunks are read from git between the two snapshots its brief names (where git cannot answer, the fix is matched by its files, with one warning). JSON on stdout `{ok, file, cycle, mode, counts, failures, issues_found}` — `failures` the brief's failing tests and checks split into `introduced` and `on_base` (`{checks: [names], tests: <count>}` each; null with no test result and no checks; a check is in `on_base` only when the test suite's finding for it — its title naming the check or quoting its command, or its location a path the command names — was set aside with evidence), which the verdict reads, and `issues_found` in the state's issue shape, which a `--state` merge also records in the run's `verification_context` (a refused write is one `warning: findings-merge-state-unwritten` line, and the caller records it then). Running a cycle's merge again gives the same result. A file or finding it cannot use is one `warning: findings-merge-…` line, exit `0` |
| `project-profile` | the detected profile as one JSON object on stdin (`kind`, `runtime`, `deploy`, `exposure`, `data`, `scale`, `ui`, each optional) | Writes the project profile `init` detected into `.maister/config.yml` under a top-level `project:` key — appended after one blank line, the file created when absent, every other line unchanged — only when the file has no such key; an existing one is kept as it is. A field left out, null or with a value it does not take is written commented out with the values it takes, the last also a `warning: project-profile: …` line. Prints JSON: `action` (`created`, `appended` or `kept`), `file`, `profile` (the fields written) and `block` (the text written, null when kept), exit `0`; input that is not an object is refused `project-profile-bad-input`, exit `1`, nothing written |
| `runner-result` | `--state`, `--node` (the verification node the runner ran for); the result as JSON by here-string, or `--patch-file` naming it in the patch file | The verification runner's result, checked against its shape (`implementation-verifier/SKILL.md` § *The runner's result*), stamped with the node, the node's attempt and `verification_context.cycle`, and written to `verification/runner-result.json`; the file as written on stdout, which the runner returns as its final message. The patch file is deleted once it landed and kept on a refusal |
| `runner-step` | `--state`, `--node` (the verification node that is running), optional `--answered` (the node has just recorded the answers to the runner's decision) | The node's next step as one JSON object: `inline` with the reason when the run records no nested delegation; `dispatch` with `resume` — `fresh`, `auto` (continue from the cycle files) or `{cycle, decisions_file}`; `ask` with the cycle, the decision's kind, its findings list, whether the stopping question is put and `asking` (`session`, `suspend`, or `none` when only the policy can settle it); `close` with the verdict, the report, findings and companion paths and the counts; `unavailable` with the runner's reason. It writes `verification/decisions-<cycle>.json` from the answers recorded in the node's attempt, or from the defaults when nobody can be asked. A result file it cannot use is one `warning: runner-result-unusable` line, exit `0` |

`run-context`, `prior-context` with `--node`, `node-brief` and `dispatch-model` refuse with exit `1`, an empty stdout and the code first on stderr; nothing was written:

| Refusal | Response |
|---|---|
| `run-context-state-unreadable` | `--state` cannot be read or parsed as a state document, and nothing was read further. Point `--state` at the run's `orchestrator-state.yml` — the run directory this node belongs to — and run the verb again. |
| `run-context-not-a-run` | The file carries no `workflow:` block: the engine never froze it, so it has no nodes and no run context. Run the verb on the state of a frozen run — freeze it first through `write-state` (Step 4) — and never write the block by hand. |
| `run-context-unknown-node` | `--node` is not a node of the run's frozen graph, or names `held-approval`, which delegates nothing. Name the node about to delegate, exactly as `workflow.nodes` spells it, and run the verb again; no state write fixes this. |
| `node-brief-state-unreadable` | `--state` cannot be read or parsed as a state document, and nothing was read further. Point `--state` at the run's `orchestrator-state.yml` — the run directory this node belongs to — and run the verb again. |
| `node-brief-not-a-run` | The file carries no `workflow:` block: the engine never froze it, so it has no nodes to brief. Run the verb on the state of a frozen run — freeze it first through `write-state` (Step 4) — and never write the block by hand. |
| `node-brief-unknown-node` | `--node` is not a node of the run's frozen graph, or names `held-approval`, which is briefed by `gate-brief`. Name the node about to run, exactly as `workflow.nodes` spells it, and run the verb again; no state write fixes this. |
| `dispatch-model-state-unreadable` | `--state` cannot be read or parsed as a state document, and nothing was read further. Point `--state` at the run's `orchestrator-state.yml`, or leave it off outside a run, and run the verb again. |
| `dispatch-model-not-a-run` | The file carries no `workflow:` block: the engine never froze it, so it recorded no subagents block. Run the verb on a frozen run's state, or without `--state` when no run is under way. |
| `dispatch-model-unknown-node` | `--node` is not a node of the run's frozen graph. Name the node that dispatches, exactly as `workflow.nodes` spells it, and run the verb again; no state write fixes this. |

`review-brief` refuses with exit `1`, an empty stdout and the code first on stderr, and `findings-merge` with exit `1` and the refusal as JSON on stdout; nothing was written:

| Refusal | Response |
|---|---|
| `review-brief-state-unreadable` | `--state` cannot be read or parsed as a state document. Point it at the run's `orchestrator-state.yml` and run the verb again. |
| `review-brief-task-unreadable` | `--task-path` is not a directory. Point it at the task directory under review. |
| `review-brief-not-a-repository` | The project is not inside a git repository, or git is not installed, so there is no change to measure. Run verification from the project's checkout; without git the reviewers find their scope as they did without a brief. |
| `review-brief-no-base` | The run has no `task.base_commit` — it was frozen before the key was recorded — or a standalone call gave no `--base`. Run the verb again with `--base=<the commit the work started from>`; never guess one. |
| `review-brief-bad-base` | `--base`, or the run's recorded base, names no commit of the repository (history was rewritten since). Run the verb again with `--base` naming the commit the work started from. |
| `review-brief-no-previous` | A re-check builds on the previous cycle's brief, and there is none. Build a full brief instead (no `--recheck`), or name the right `--cycle`. |
| `review-brief-no-brief` | `--refresh` found no brief for the cycle. Build the cycle's brief first: the same call without `--refresh`. |
| `findings-merge-state-unreadable` | `--state` cannot be read or parsed as a state document. Point it at the run's `orchestrator-state.yml` and run the verb again. |
| `findings-merge-task-unreadable` | `--task-path` is not a directory. Point it at the task directory under review. |
| `findings-merge-no-cycle` | The run's `verification/` holds no review brief and no reviewer findings file, so there is no cycle to merge. Build the cycle's brief and run the reviews first. |

`runner-result` and `runner-step` refuse with exit `1`, an empty stdout and the code first on stderr; nothing was written:

| Refusal | Response |
|---|---|
| `runner-result-state-unreadable`, `runner-step-state-unreadable` | `--state` cannot be read or parsed as a state document. Point it at the run's `orchestrator-state.yml` and run the verb again. |
| `runner-result-unknown-node`, `runner-step-unknown-node` | `--node` names no node of the run, or names a gate. Name the verification node that runs the loop, exactly as `workflow.nodes` spells it. |
| `runner-result-not-running`, `runner-step-not-running` | The node is not `running`, and only a running node hands its loop to the runner. Start it through `write-state` first, or name the node that is running. |
| `runner-result-invalid` | The result breaks the runner's result shape at the field the message names. Correct that field and send the whole result again; the patch file is still there. |

`subrun-path` refuses with exit `1` and the refusal as JSON on stdout, like `resume-check`; nothing was written:

| Refusal | Response |
|---|---|
| `subrun-path-state-unreadable` | `--state` cannot be read or parsed as a state document. Point `--state` at the parent run's `orchestrator-state.yml` and run the verb again. |
| `subrun-path-not-a-run` | The file carries no `workflow:` block: the engine never froze it, so it has no `workflow:` node to start a child. Run the verb on the parent's frozen state. |
| `subrun-path-unknown-node` | `--node` is not a node of the run's frozen graph. Name the `workflow:` node that starts the child, exactly as `workflow.nodes` spells it; no state write fixes this. |
| `subrun-path-definition-unread` | The definition the parent froze cannot be re-read, so the workflow the node starts is unknown. Restore the file its `workflow.source` names, then run the verb again; never type the child's directory by hand instead. |
| `subrun-path-not-a-subrun` | The node runs a `skill:`, `agent:` or `direct:` target, not a `workflow:` one, so it starts no child run. Name the `workflow:` node. |

`import` refuses with exit `1` and the refusal as JSON on stdout; nothing was copied:

| Refusal | Response |
|---|---|
| `import-state-unreadable` | `--state` cannot be read or parsed as a state document. Point `--state` at the run's `orchestrator-state.yml` and run the verb again. |
| `import-not-a-run` | The file carries no `workflow:` block: the engine never froze it. Import into a frozen run; freeze first through `write-state` (Step 4). |
| `import-destination-outside` | `--to` is absolute, climbs with `..`, or reaches outside the run through a link. Name the folder relative to the run directory — the one the step's prose names — and run the verb again; never copy by hand instead. |
| `import-destination-reserved` | `--to` is the run directory itself, or lies under `gates/` or `display/`, which the engine writes. Name a folder of the run's own, such as the step's `analysis/…-context/`. |

**A skipped source is the step's to judge.** Supporting context, such as research, an
architecture or a context pack, becomes an `open` risk that names what was skipped and the
source path the later steps read instead. The step then goes on. Only an input the step says it
cannot work without fails it. Never ask a person to copy a file in by hand.

`run-complete` ends a run and, in a dispatched run, only once the close-out it owes is
on disk. There it takes `--outbox` and `--dispatch-id` as well, because the state never records
the outbox root, and the `dispatch_id` it records only marks the run as dispatched: pass them through unchanged from the seed, which hands them over under exactly
these spellings for the outbox verb. Omitting them is refused like an unpublished close-out.

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

**A dispatched run's close-out publishes through the outbox close-out verb** — carrying the
grade and the summary the seed's close-out contract asks for — **and the closing node records
its outcome value only after that publish succeeded.** The outbox is the chain's only way to learn a dispatch is over, so `run-complete` refuses a run that never
published. If the outbox cannot be written, the outbox verb hands back a `DISPATCH-RESULT:` line
instead; that line is then the turn's last line and no `RUN-COMPLETE` is owed. A run that is
not dispatched has no outbox.

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
| `direct:<name>` | inline, by this engine, from the node's `node-brief` output |
| `workflow:<name>` | with no `dir:`, it **starts a child run** — its own task directory, its own frozen graph, its own driver — and the node waits for it (*Sub-runs*). With `dir:` it keeps its dispatch meaning and is refused as a sub-run |

**While a delegate runs, say so — the prompt otherwise looks like it is waiting for the user.**
Right after launching a node's delegate, print one line: *"<Phase title> is running. Nothing
needed from you; I'll continue when it finishes."* When a notification brings you back and the
work is not finished yet, print one short progress line — what is done and what is left — before
you wait again. Never predict how long a step will take; an elapsed time a step reports is a fact
and may be said as one. When the run has a dashboard, the first such line ends *"Progress is on
the dashboard in your browser."*, and a later one repeats it now and then — after a gate, or on a
long wait — never on every line and never with its path. Questions never name the dashboard.

**A `skill:` or `agent:` target resolves through the four tiers of `references/grammar.md`
§ 5.1**, first hit winning, and `validate` reports where each was found. One found nowhere
warns `unresolved-reference:<node>:<target>` and surfaces when the node is reached. **Target
names in a definition are bare**; the provider prefix is applied at invocation, so one shipped
definition is correct under every generated variant.

**Prior-phase context is read out of state, never composed.** A prompt for an artifact-writing
delegate carries everything earlier phases decided and flagged: `N` items in state arrive as `N`
distinct items, none dropped and none merged. So run `prior-context` **at each consuming
delegate** — one call per prompt, in the turn that composes it — and paste its stdout into the
prompt under its own heading, unedited and whole: never slice it with `sed`, `head`, `tail` or
the like, never pass a file path or a saved copy in its place, and never re-use a rendering made
for an earlier delegate. **A delegate writing for end users — a user guide, user documentation —
gets `prior-context --background` instead.**

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
what is its own and never restates these. `node-brief` prints a row whole while it applies: the
`direct:` row only for a step that owes a page or has no section, `every step` only for a step
that declares an output, `named by a revise` while a recorded revise names the step and `has a
budget` on the last budgeted attempt; before then those two are named on one line that points
here.

| Applies to | Convention |
|---|---|
| `agent:` step | Task tool, passing the `model` and `reasoning_effort` the `runs:` line prints beside the agent type; a field it prints as `omit` is left off the call. The prompt carries the `with:` values; each declared path the agent writes, never one the Writes part keeps for the step — an `output_path` agent gets it as `outputs.artifacts` declares it, relative to the task directory, since it joins it to `task_path`; and `prior-context --node` pasted unedited (`run-context` if nothing earlier is needed). Its `headline` is the summary headline. |
| `skill:` step | Skill tool, given the `with:` values and the `run-context` output; the skill's own result feeds the node summary. |
| `direct:` step | Run inline from the node's section, except the agents a `delegates:` line names: each is dispatched through the Task tool, never done in the session, and listed under `delegated` in the closing write, which is refused without it. A step that owes an HTML page hands its finished markdown to `html-companion-writer` before the completing write. A step with no section does only what these rows say. |
| `workflow:` step | Starts a child run and waits for it (*Sub-runs*); its outcome is mapped, not judged (*Recording an outcome*). |
| gate | Asked from `gate-brief` (`references/gates.md`); record the answer, end the run on a stop, revise through `gate-revise`. A false guard skips it with its stretch, unless that guard reads a step's value and the gate is no pure confirmation, or reads a step's value while a choice is held. A false guard on inputs or other gates' values alone always skips it, held choices or not: `gate-brief` and `gate-request` refuse it `gate-guard-false`. Sections hold exceptions only. |
| every step | A throwaway file the step makes itself — a probe, a benchmark, a copy — goes in a directory `mktemp -d` makes, never a fixed path such as `/tmp`, which a host may not allow. Before recording `completed`, check each declared artifact path. A missing one its `brief:` `absent` does not sanction is a failed self-check: re-drive the step, naming the path. Record a sanctioned absence under `absent` with its reason, and record every declared value. |
| asks | With question sets, ask them all in one request per attempt; without them, record the Without default `by: default`. Record each in-session answer as one `by: operator` decision with its `question_id`, question, answer, recommended answer and `as_recommended` on the step's own `node_summaries` entry (`references/gates.md`). Once `classes_questions` is recorded, ask only the classing writer's `ask:` ids; held choices wait for the next checkpoint or `held-approval`. |
| feeds a checkpoint | The closing summary keeps the summary contract: a one-sentence `headline` within 220 characters; the artifact's decisions and risks item for item, tagged; `recommends` with a one-line reason as `brief:` directs once its input is set, or naming the gate's revise when the node finds its work short of what was agreed (`references/gates.md`). |
| named by a revise | Read the note from `prior-context`; revise the step's own artifacts in place; keep earlier answers unless the note reopens them; record the declared values again; say what changed and write the headline again. |
| has a budget | The attempt count in `brief:` `budget` is a prose rule nothing enforces. When the last attempt fails, the budget-exhausted rows of *Recording an outcome* decide. |

### Interpolating `${…}`

Before a node runs, the driver substitutes every `${…}` in its `with:` — however deeply nested —
and in its `dir:`; `node-brief` prints both filled in by the rules below, so a step takes them
from there rather than resolving them by hand. Before a gate is asked, it substitutes the ones in
its `ask:`. Nothing else is
interpolated: an artifact path is literal, a `when` is evaluated by the ready-set rule, and `uses`
names a target as written. Each reference reads the run's state, never a recollection of it:

| Reference | Resolves to |
|---|---|
| `${inputs.<name>}` | `orchestrator.options.inputs.<name>`; else the input's declared `default`; else null |
| `${<node>.values.<key>}` | the value the node recorded in `workflow.nodes.<node>.values`. A skipped node recorded its bools false and its strings and enums null |
| `${<node>.artifacts.<key>}` | the path the node declares, joined onto the task directory of the run that wrote it and spelled repository-root-relative (*Recording an outcome*) |

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

**A `workflow:` node's outcome is the child run's, mapped rather than judged**: the parent reads
the child's `task.status` at the node's recorded `values.task_path` and maps it:

| Child `task.status` | Parent node | Parent run |
|---|---|---|
| `completed` | `completed` | continues its walk; the declared outputs are exposed |
| `failed` | `failed` | ends `RUN-FAILED: sub-run <child-run-id> failed`, unless a downstream node declares `on: failure` or `on: always` |
| `stopped` | `stopped` | stops outright — one patch carries `task.status: stopped` and every unexecuted node, then `run-complete`. No `RUN-FAILED`: a stop is a legitimate outcome |
| anything else | unchanged, stays `waiting` | the waiting path runs again (*Sub-runs*) |

A child can complete without an artifact its parent's node declares, when a guard skipped the
child node that writes it: the adopting write records it under the parent node's `absent`, with
the skip as the reason. Any other absence is left unrecorded, so `run-complete` reports it.

**A dispatched node's outcome is its close-out grade, mapped rather than judged.** A node carrying
`dir:` is recorded `waiting` while its dispatch runs, and its outcome is the grade the dispatch's
close-out carries — `success`, `partial` or `failed`, given by the worker, or by whatever closed
a dispatch the worker never closed. The engine never grades on a worker's behalf:

| Close-out grade | Dispatched node | Run |
|---|---|---|
| `success` | `completed` | continues its walk; the declared outputs are exposed |
| `partial` | unchanged, stays `waiting`; `completed` when the held item is already resolved | asks the held-dispatch question, and its answer decides (below), unless the dispatch's ledger entry records its pull request in `closeout.prs` or its `needs: [permission]` follow-up is `resolved`; then nothing is asked |
| `failed` | `failed` | ends `RUN-FAILED: dispatch <dispatch-id> failed`, unless a downstream node declares `on: failure` or `on: always` |
| a stopped dispatch | `stopped` | stops outright, as for a stopped child run |
| no close-out yet | unchanged, stays `waiting` | nothing is recorded |

**`partial` is held, and the operator decides.** The work was done but something is still held —
a push or a pull request awaiting approval. The run asks one question, named after the node,
that says what is held, from the close-out's own summary or its held-command report, and offers
three options, none recommended and none taken on its own:
- **accept the work as done**: the node is recorded `completed`, and its summary gains an `open`
  risk naming what is held;
- **dispatch the node again**: the node goes back to `pending`, and the ready set dispatches it
  anew — a new dispatch, since ids are never reused;
- **stop the run**: one patch carries `task.status: stopped`, the node and every unexecuted node
  `stopped`, then `run-complete`, as for a stopped child run.

**A held item already resolved is not asked about.** Before asking, read the dispatch's ledger
entry (the umbrella runtime's `ledger` verb, op `query`). When its `closeout.prs` records the
dispatch's pull request, or its `needs: [permission]` follow-up is `resolved`, what was held has
happened: record the node `completed` with one decision naming what resolved it, `by: run` —
`{decision: "Held item resolved: pull request <url> recorded", by: run}`, `<url>` being the `url`
of the pull request's `{repo, number, url}` entry, or `{decision: "Held
item resolved: follow-up <id> resolved by <resolved_by>", by: run}` — and ask nothing. Never
`by: operator`: nobody answered. Otherwise the question is asked exactly as above.

It is asked in session with the question tool, and under a driver suspended as an in-node
question set from the waiting node; where the driver carries no question sets, the run stops
(`references/in-node-questions.md` § *A dispatch closed out partial*).

**A declared artifact path resolves against the task directory of the run that wrote it** — the
run's own for a `direct:`, `skill:` or `agent:` node, the child's (the node's recorded
`values.task_path`) for a `workflow:` node — for the existence check below and for
`${<node>.artifacts.<key>}` alike. The declared path itself is literal.

**The two budget-exhausted rows need an operator.** Under a `cockpit` or `dispatch` driver the
node is recorded `failed` and the run stops with `RUN-FAILED` (`references/in-node-questions.md`
§ *When nobody can be asked*).

**A node that did not produce its declared artifacts has not completed.** Before recording
a node `completed`, check that every path the node declares under `outputs.artifacts` exists
— one `test -e` per declared path, against the path resolved from the task directory. A
declared artifact that is missing is one of exactly two things, and the node's `brief:` `absent`
entry is what tells them apart (printed as "may be absent" on `node-brief`'s `writes:` line):

| The node's `brief:` `absent` entry | The missing path means |
|---|---|
| sanctions the absence by name — the artifact's source may legitimately not exist | no such context; record `completed` with the absence on the node summary (below) |
| names nothing for it | the delegate skipped work it was asked to do; the node has **not** completed |

Treat the second as a failed self-check and re-drive the node within its budget, naming the
missing path in the context handed back; when the budget is exhausted, the table above decides.

**A sanctioned absence is recorded, not just described.** The completing write's node summary
carries `absent: {<artifact-key>: "<reason>"}` — one entry per declared artifact the node
completed without, named by its declared key (never its path), with the reason in a few words —
and its `summary` still says it in prose. Record it only where the node's `brief:` `absent`
entry sanctions the absence.

**One summary per step.** A step's summary, decisions and risks are its `node_summaries` entry,
keyed by node id, and are recorded nowhere else: no copy goes into the context block, and the
writer drops a `phase_summaries` key, top-level or under `context`, with a `note:` line.

The writer mirrors a node's status onto its summary and registers, on a completing summary,
every declared artifact on disk the entry does not list; the closing write still lists what the
section asks for (`references/writing-state.md` § *Recording an outcome — the detail*).

**Retry budgets are prose, never `with:` data**: nothing consults a budget written in `with:`;
the number sits in the node's `brief:` `budget` and is printed as a prose rule.

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
`finding-brief --patch-file` name the section for theirs.

---

## Sub-runs

A `workflow:` node carrying no `dir:` starts a **child run**: an ordinary task directory beside
the parent's, with its own frozen graph, its own state file and its own driver, linked back by the
child's `orchestrator.parent` — `{run, node}`, written once at the freeze. The parent node holds
`status: waiting` while the child executes and adopts the child's terminal status when it ends.
The full contract is `references/sub-runs.md`. What the engine must hold in mind at the node:

- **Three writes bracket a start**: W1 the parent node `running`; W2 the whole child freeze, one
  call against the child's state; W3 the parent node `waiting` with `values: {task_path, run_id}`.
  W2 precedes W3, and both precede the marker. W2 prints the child's own startup banner; the
  parent does not relay it.
- **Under a terminal driver the child runs in session** and the turn continues to W4. Under a
  `cockpit` or `dispatch` driver the turn ends at `WAITING-SUBRUN` and the daemon discovers the
  child in its ordinary sweep — the parent drives nothing and spawns nothing.
- **Five checks refuse before anything is created**: `subrun-path` runs the first three; perform
  the last two from `references/sub-runs.md` § *Before any write — the checks that refuse*.
- **The child's freeze copies from the parent** the narrower autonomy ceiling and, under a driver
  that is not the terminal, the driver's features — never `question-sets` from a dispatched
  parent, which never carried them; a parent whose state cannot be read gives
  neither, and the freeze warns `autonomy-ceiling-parent-unread:<run>` or
  `driver-features-parent-unread:<run>`.
- **The child's directory comes from `subrun-path`, never worked out by hand**: the verb prints
  the `task_path` and `run_id` W3 records, so a parent re-driven after a crash gets the same
  directory and **adopts** the existing child (`existing: adopt`) instead of starting a second
  one. A child frozen anywhere else is refused `state-subrun-path-mismatch`.

## Resume

Read `orchestrator-state.yml`, take the frozen graph from its `workflow:` block, recompute
the ready set from the recorded node statuses, and continue. Resume never re-resolves the
definition: the graph that ran is the graph that resumes. `/maister-copilot:run <run directory>` and
`/maister-copilot:work <run directory>` take `workflow.name` from the run's state, through
`resume-check`, and hand it here with the directory as the resume target.

**A resume declines the same two flags a first run does.** Resume skips Step 3 and Step 4 — the
graph is already frozen — but never Step 5, and a resume is where those flags usually arrive.

**Every resume starts with `resume-check`**, run right after Step 2's probe and before anything
else: `resume-check --state=<run directory>/orchestrator-state.yml`. Exit `0` prints the frozen
workflow's `name`, `overlays` and `profile`, the run's `root` — its checkout, derived from where
the state file is (`references/writing-state.md`) — and its `dashboard` link: when it is not
`null`, show it once as `Dashboard: <link>` as the resume begins. Exit `1` is a directory this
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
  path inside the task folder (`analysis/gap-analysis.md`), which the start banner has named.
- **Nothing about the machinery.** A command a hook blocked, a retried write, a condensed context
  passage: none of it is news to the user unless it changed the result.
- **Stay at the project root.** Run every command from there, and never `cd` into the task
  directory — not even as `cd <dir> && grep …`: pass the file's path from the project root
  instead. The session's working directory is what the user's status line shows.

---

## Operator visibility

The artifact summary contract (§ 7), the operator dashboard (§ 8) and the HTML companions (§ 9)
are `../orchestrator-framework/references/orchestrator-patterns.md`'s; the engine honours them
and restates none. Every successful `write-state` projects `dashboard-data.js` itself, so no
node owes a rewrite of it, and a projection that fails is a warning that never blocks.

**The display files are the engine's alone.** Every successful `write-state` also writes the
run's `display/status.json`, the freeze writes `display/banner.json`, `gate-brief` in every
form writes `display/next.json`, which the next state write removes, and under a host that
names its session each write records the run in `.maister/display/sessions/<session id>.json`.
An editor extension draws them beside the session: no node writes them or relays them, and one
that cannot be written is a warning on the dashboard's terms.

**Phases are named by their titles** — the definition's `display.titles`
(`references/grammar.md` § 3.1), falling back to the id made readable in sentence case, a known
acronym in capitals (`gap-analysis` → `Gap analysis`, `deliver-notes-api` → `Deliver notes
API`); name phases the same way in the executive summary. Ids stay wherever something is keyed:
state, gate files, markers and option ids — a gate's answer is recorded by option id, never by
label.

**The dashboard link is shown where a run starts, resumes and ends**: in the freeze banner as
the run starts, from `resume-check` as a resume begins, and once more at the end as
`Dashboard: <link>` — the same `file://` link each time. A gate never names it. A run without a
dashboard shows none.

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

**Use** when a workflow's orchestrator or `/maister-copilot:run` hands a run over, including a child
run a node of that definition starts (*Sub-runs*).

**Do not use** to run a definition file by path, to start a chain, to author an eject or an
overlay, to dispatch a `workflow:` node carrying `dir:` into a member repository, or as a
workflow a user starts directly. Each of those is another skill's job, or the cockpit's. A
dispatch goes through the umbrella runtime's `envelope` verb, which opens the dispatch's ledger
entry itself; a run never writes `create-entry` for a dispatch.
