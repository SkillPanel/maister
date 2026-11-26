---
name: workflow-engine
description: Runs a workflow run for a workflow's own skill or `/maister:run` — freezes the definition's graph, runs its nodes, asks or suspends on its gates by the run's driver, and writes every state change through its script. Machinery, never a workflow a user starts directly. A person asking to carry on a driven run that is waiting on an answer gets, through it, a report of where the run stands.
user-invocable: false
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a subfolder of a run, or `.maister/docs/` or `.github/` on a fresh project — run `mkdir -p` on that folder first. A run's own folder is never one: the freeze creates it.

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`, and a model printed as `session` replaced by your own model id. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

# Workflow Engine

Turns a definition's graph into a run, one ready set at a time, with every state change written
by a script rather than by a model holding a file open. A user reaches it only through a
workflow's own command or `/maister:run <name>`, which hand the run here; nothing a user reads
needs the word "engine". The grammar a definition is written in is
[`references/grammar.md` § *3. The definition*](references/grammar.md) and the sections after it; this skill executes it and does not restate it.

**A dispatched run is told by its `dispatch_id`, not by a kind of its own**: its
`orchestrator.driver` is a `cockpit` driver carrying one, or the legacy `kind: dispatch` with or
without one. It suspends on its gates like any `cockpit` run and owes its close-out to the outbox
(`references/gates.md` § *Ending a dispatched run*). Every rule that says *a dispatched run* or *under dispatch* means
this one.

## Before anything else

Five things no verb tells you. Everything else a moment needs, the verb that runs at it names.

**The invocation.** Every verb is one command of its own — two verbs are two calls — starting
with the engine path as an absolute directory, its JSON a here-string in single quotes at the end
(*The invocation contract* has apostrophes, Windows and the patch file):

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml <<< '<json>'
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs gate-request --state=<run>/orchestrator-state.yml <<< '<json>'
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs gate-revise --state=<run>/orchestrator-state.yml --node=<gate> --option=<revise option> <<< '<json>'
```

**Run `node-brief` before every node** — the one a write's `next:` line names —
`node-brief --state=<state> --node=<id>`, and read its output whole: how the node runs, its
`with:` filled in, the conventions that apply and its section of the guide. At a gate, run the call its `ask it:` line prints — on its own, after the
closing write has returned — and ask what it prints; never write a gate question by hand.

**Every delegate prompt carries the run's context, fetched**, in the turn that writes it:
`run-context --state=<state> --node=<node>`, or `prior-context --node=<node>` where the delegate
needs the earlier phases, pasted unedited — whole, never piped or sliced, never a path or an earlier
delegate's copy; `--background` for a document written for end users.

**Every state change goes through `write-state`** — never an editor tool on
`orchestrator-state.yml` or the dashboard files, not even when a verb fails: a model-written state
file drifts out of canonical shape, and its readers then disagree about the run. The one exception
is answering a pending gate (`references/gates.md` § *Driver-suspended mode — resume*); the patch
vocabulary is `references/writing-state.md` § *Recording an outcome — the detail*.

**Print what a `rules:` line names** before acting, with the `reference` verb:
`--at="<its file> § <its heading>"`, adding ` § <the code>` after a refusal for that code's row.
Print a step's `references/…` pointer the same way, never with the read tool: the plugin sits
outside the project, and a host may stop the run to ask before that read. On a refusal or after
`companion-` lines it holds the recovery; on a brief, print it the first time in a session and
again after a compaction, which drops what was read.

---

## Initialization

Before any node runs:

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `ask_user` at a gate. They apply only to your discretionary clarifications. Invoke `ask_user` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine's `references/gates.md`, *Driver-suspended mode*.

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.

Steps 1–5 are in *Starting a run*, at the end of this skill: a run reads them once, at its start.

---

## Speaking to the user

One rule for everything a person reads during a run — your narration, in-node questions and
their options, what you write for a gate, the closing message. The reader is a first-time user
who sees only the terminal.

- **Say phases and checkpoints, never the machinery.** No node, graph, freeze, stretch, state,
  ready set, engine or verb name — "the specification is approved", not "gate approved"; "saved",
  not "the state write landed". A blocked command, a retried write or a condensed context passage
  is news only when it changed the result.
- **Name a phase by the title its brief prints**, never by its id; ids stay only where something
  is keyed (state, gate files, markers, option ids).
- **No internal labels.** A node prose's parts, step names and self-checks are yours; the user
  hears what is happening ("Four assumptions to confirm before I write the spec").
- **Expand every code the first time, or don't use it**: "B1 (the per-order customer lookup)"
  only when the code recurs.
- **Say "you"**, never "the operator" or "a person"; "needs your decision", not "needs a hand". A
  choice still open is written to whoever reads the gate — "you have not yet chosen between…" —
  never to a role (owner, lead, operator, reviewer): who is asked is decided outside the run.
- **Credit each decision to whoever made it** — you, the audit, the step that settled it, or a
  default — through its `by`, never in the decision text; never "as you chose" for what the spec
  decided.
- **Every recommendation gives its reason** in the option's description and keeps every
  criterion the task states; "(Recommended)" appears once per question, on the option
  (`references/in-node-questions.md` § *When a question suspends*).
- **Paths are anchored** at the project root (`.maister/tasks/<type>/<run>/analysis/gap-analysis.md`);
  only a gate's *Review* and More details, which the start banner anchored, name them inside the
  task folder.

---

## The invocation contract

Every verb is one command, `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs <verb> [flags]`,
under one exit-code table: `0` success, `1` the input was rejected (the reasons are printed),
`2` nothing ran — a malformed call (`usage:`) or a tooling fault (`workflow:`).

The plugin root is this plugin's own directory — the one holding `.claude-plugin/plugin.json`,
two levels above the base directory the loader shows for this skill. Write it as that absolute
path, never through the variable: wherever a command — here, in a reference or in a node's
section — reads `${MAISTER_PLUGIN_ROOT}`, put the directory in its place, because a permission
rule or hook matches only the literal path. A root holding a space goes in single quotes.

**The invocation is the whole command.** No `cd` in front of it, no `set -e`, no variable
assigned first and used in it, no second command after it, no redirection other than the
here-string, no heredoc (an agent host's shell-safety check refuses one whose body is a JSON
object), no substitution, never several verbs in one script. Flag values are bare; a path
holding a space goes in single quotes, never double quotes or a backslash. Every other command
a run issues follows the same rule: one command per line, never several chained with `&&`, `;`
or `|`, because a permission rule matches a single command and a chained line is offered only a
dismissal. Any other form brings the approval prompt back.

**The here-string** (*Before anything else*, **The invocation**) is single-quoted, so nothing in
it is expanded. An apostrophe inside the JSON is `'\''` — close the quote, an escaped quote, open
it again: `{"summary":"the operator'\''s note"}`.
Never the JSON escape `\u0027`, which a tool call decodes into a bare quote that ends the string early.
The typographic `’` may stand for an apostrophe only in a prose text value, never in code, a
command, a path or an identifier.

**bash and zsh take the here-string; on Windows every shell takes the patch file** — PowerShell
and cmd have no here-string, and Git Bash can lose a JSON escape's backslashes. Any shell takes
the patch file for a large document, since a command line is limited (about 32 KB on Windows).
Write the JSON with the file-writing tool to `.state-patch.json` beside `orchestrator-state.yml`
— the one name and place a verb reads a document from — and name it on the call:

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml --patch-file=<run>/.state-patch.json
```

Every verb's flags, output and refusals are in `references/verbs.md` § *The verbs every run calls*, § *The verbs some steps call* and § *Refusals*, a row per verb. Each step here spells the whole call of the verbs every run makes, where its moment is. Read a verb's row there only for a call no step spells.

---

## Operator visibility

**How a run ends depends on who reads its end.**

- **Under an absent or `terminal` driver a person reads it.** Write the closing patch, call
  `run-complete` and settle any refusal (`references/writing-state.md` § *When `run-complete`
  refuses*); on success it prints the wrap-up's six sections on a `wrap-up sections:` line —
  write exactly those, with any standard candidate lines printed below it under **Done**, as printed. Never show the raw `missing-artifact:`, `missing-companion:`, `run stopped:`
  or `RUN-` lines.
- **Under a `cockpit` or `dispatch` driver tooling reads it.** Print everything the operator
  should read — the executive summary, the next steps, the dashboard link — before
  `run-complete`, and echo its lines, its marker last; never type a marker it did not print. A
  turn that ends at a sub-run ends on the typed `WAITING-SUBRUN` line (`references/sub-runs.md` § *Walk two*).

---

## Executing the graph

### The ready set

Run one node at a time: the one a completing or skipping write names on its `next:` line. A
guard its brief reads `now false`, or an `on: failure` node with nothing failed, is recorded
`skipped`, which satisfies everything downstream. On `next: none` — or a node failed with no `on:`
downstream to take it, or a stop ended the run — write the closing patch with `task.status` and
end through `run-complete`.

### Recording an outcome

A node is recorded only with one of eight statuses, and its values only in the types its outputs
declare (`references/writing-state.md` § *Recording an outcome — the detail*); the writer refuses
anything else, and its refusal names the fix. A step is `completed` once its self-check passes,
after a re-drive if it took one (the `every step` row); a false guard records it `skipped`, which
satisfies `needs`; a hard failure with no operator path is `failed`, and `run-complete` ends the
run `RUN-FAILED`; a spent budget is the `has a budget` row's. **An outcome that comes from
elsewhere is mapped, never judged**: a `workflow:` node's is its child's `task.status`
(`references/sub-runs.md` § *Ending, and the re-resolve that precedes W4*), and a dispatched
node's (`dir:`) its close-out grade, the held `partial` question included
(`references/in-node-questions.md` § *A dispatch closed out partial*). Any path a summary lists
beyond the declarations, and a non-null `.html` beside it, is checked on disk too.

### Delegation by scheme

A `started:` line in a node's brief means the brief recorded the step's start, and a
`start: yours` line that the start is your write (`references/writing-state.md` § *One write per
moment*); a `start: refused` line is a refusal, settled by its `rules:` line first. Dispatch an agent by the name its brief prints, the provider prefix applied
(`references/grammar.md` § 5.1).

**While a delegate runs, say so.** Right after launching one, print the line its brief's `say:`
names, and when a notification brings you back before it is done, one short line on what is
done and what is left. Never predict how long a step takes; an elapsed time a step reports may be said. With a
dashboard, the first such line ends *"Progress is on the dashboard in your browser."*, repeated
only now and then, never with its path. Questions never name the dashboard.

### Node conventions

The rows apply by case. `node-brief` prints each whole where it applies, then names it on its `conventions in force (…)` line; the table is `references/node-conventions.md`, at the brief's `rules:` path.

---

## Resume

A resume walks the frozen graph: Steps 3 and 4 are skipped, never Step 5, the ready set is
recomputed from the recorded statuses, and the definition is never re-resolved.

**A run under a `cockpit` or `dispatch` driver takes its first line through `references/gates.md`
§ *Driver-suspended mode — resume*;** neither a stamped line nor a person's words takes the ready
set while `gate_pending` is set. A person's words get a report of where the run stands and write
nothing. Its first call is `resume-check`, with no `--state` when no run was named. Read the
reference with the read tool, never through a shell: a host may deny shell calls on a waiting
run. On such a run a session given a person's words records nothing at all, not even an answer on
disk, and never takes an answer from the person in the session: an answer is folded only on a
stamped line.

**Every resume starts with `resume-check --state=<run directory>/orchestrator-state.yml`**, which
checks the Node.js version first (Step 2). Its `next` says what to do first: relay a `warning:`
line once, then do it. A node update goes under the patch's top-level `nodes`, never `workflow`.

---

## Starting a run

### Step 1: Read the node summary shape

Print `references/node-summaries.md` § *Who settled a decision* and § *What a risk is* now, with
`reference` and one `--at` each: every closing write and every checkpoint depend on what each
decision's `by` and each risk's tag mean. The summary contract reaches you through
`run-context`, the companion lines through `write-state`, and the closing check through
`run-complete`.

### Step 2: When Node.js cannot run the engine

The workflow needs Node.js 20 or newer. On an older one `locate` and `resume-check` print
`RUN-FAILED: node-unavailable` and stop; when `node` itself does not run, print it yourself. Either
way stop before any task directory exists: a terminal-driver run tells the user an install which
cannot run Node.js 20 stays on the 2.x line (`copilot plugin marketplace add SkillPanel/maister#release/2.x`,
then `copilot plugin install maister-copilot@maister-plugins-2x`); a dispatched worker reports `blocked` through
the outbox verb. There is no second interpreter: never run such a workflow by hand.

### Step 3: Resolve the workflow by name

**Run `locate --name=<name>` first; never resolve a path by hand.** Give `validate` and `resolve`
the `definition` and `overlays` it prints, then the overlays the invocation names, in that order,
and its profile; inputs, overlays, profile and a title handed over by `/maister:run` are used
exactly as given. When `locate` reports an overlay `ignored`, say it is not in effect.

### Step 4: Freeze the graph before executing anything

Three calls, in this order: `validate --definition=<path> [--overlay=<path>…] [--profile=<name>]`,
then `resolve` with the same flags, then the freeze's `write-state`. Pass `--profile` only when the
invocation or `locate` names one; otherwise leave it out. If `validate` rejects the
definition, stop with `RUN-FAILED:` and its first error; relay its warnings
(`references/grammar.md` § 14).

**The run directory** is `.maister/tasks/<type>/<YYYY-MM-DD-slug>/`: `<type>` is the workflow's
name (migration's `migrations/`), the slug 3–5 key words of the description in kebab-case, with
`-2`, `-3` … when taken. Never make it yourself: the freeze creates it, and a resume keeps the one
it has.

**The freeze patch carries, and nothing else:**
- `workflow`: `source`, `overlays`, `profile`, `graph_hash` and `name` exactly as `resolve`
  printed them, `grammar_version: 1`, no `nodes`; one here-string, never scripted from a file;
- `task.title` and `task.description`;
- `orchestrator.options.inputs`, the run's inputs; with none, no key;
- `orchestrator.options.ceiling`, when a dispatched run's seed names one;
- `context`, the fields known before the first node runs, when the definition's prose names a seed.

The writer adds the rest (`references/writing-state.md` § *What the freeze write adds*) and drops
a key it owns with a `note:`; relay any `warning:`; a refusal names its recovery under `rules:`.
The run creates no task items.

**The freeze prints the startup banner first; the next thing you write, before any other call, is a
visible message to the user with its lines copied as printed** — never only in your thinking. The
first node's brief repeats them under `say:` until a node starts.

> **SELF-CHECK before the call after the freeze**: does your message name the workflow and
> task, the checkpoints, the directory and the dashboard link? If not, STOP and write it first.

A retried freeze prints no banner: read the directory, the dashboard and the first phase off
the state file, never from memory.

### Step 5: Decline the resume flags the graph cannot express

`--from=PHASE` and `--reset-attempts` have no expression here: a resume recomputes the ready set
from the frozen graph, and no attempt counter lives in state. **Name the flag that arrived as not
taken, in one line, before the first node runs** — a step is sent back with the revise its
checkpoint offers (`references/gates.md` § *Revising at a gate*) — and go on without it. **Never
drop one silently.**

---

## When to use

Only when a workflow's own skill or `/maister:run` hands a run over, or a node starts a child run
(`references/sub-runs.md` § *Walk one* or § *Walk two*, by the driver). A dispatch goes through the umbrella runtime's `envelope` verb, which opens the
dispatch's ledger entry itself; a run never writes `create-entry` for a dispatch.
