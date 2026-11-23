---
name: maister:workflow-engine
description: Runs a workflow run for a workflow's own skill or `/maister:run` — freezes the definition's graph, runs its nodes, asks or suspends on its gates by the run's driver, and writes every state change through its script. Machinery, never a workflow a user starts directly. A person asking to carry on a driven run that is waiting on an answer gets, through it, a report of where the run stands.
user-invocable: false
---

# Workflow Engine

Turns a definition's graph into a run, one ready set at a time, with every state change written
by a script rather than by a model holding a file open. A user reaches it only through a
workflow's own command or `/maister:run <name>`, which hand the run here; nothing a user reads
needs the word "engine". The grammar a definition is written in is
[`references/grammar.md`](references/grammar.md); this skill executes it and does not restate it.

**A dispatched run is told by its `dispatch_id`, not by a kind of its own**: its
`orchestrator.driver` is a `cockpit` driver carrying one, or the legacy `kind: dispatch` with or
without one. It suspends on its gates like any `cockpit` run and owes its close-out to the outbox
(*Ending a dispatched run*). Every rule that says *a dispatched run* or *under dispatch* means
this one.

## Before anything else

Seven things no verb tells you. Everything else a moment needs, the verb that runs at it names.

**The invocation.** Every verb is one command of its own — two verbs are two calls — starting
with the engine path as an absolute directory, its JSON a here-string in single quotes at the end
(*The invocation contract* has apostrophes, Windows and the patch file):

```
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml <<< '<json>'
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs gate-request --state=<run>/orchestrator-state.yml <<< '<json>'
node <plugin root>/skills/workflow-engine/scripts/workflow.mjs gate-revise --state=<run>/orchestrator-state.yml --node=<gate> --option=<revise option> <<< '<json>'
```

**Run `node-brief` before every node**, `node-brief --state=<state> --node=<id>`, and read its
output whole: how the node runs, its `with:` filled in, the conventions that apply and its
section of the guide.

**Every delegate prompt carries the run's context, fetched**, in the turn that writes it:
`run-context --state=<state> --node=<node>`, or `prior-context --node=<node>` where the delegate
needs the earlier phases, pasted unedited — whole, never sliced, never a path or an earlier
delegate's copy; `--background` for a document written for end users.

**Every state change goes through `write-state`** — never an editor tool on
`orchestrator-state.yml` or the dashboard files, not even when a verb fails: a model-written state
file drifts out of canonical shape, and its readers then disagree about the run. The one exception
is answering a pending gate (`references/gates.md` § *Driver-suspended mode — resume*); the patch
vocabulary is `references/writing-state.md`.

**Read what a `rules:` line names** before acting. On a refusal it holds the recovery; on a
brief, read it the first time in a session and again after a compaction, which drops what was read.

**A missing companion.** `companion-missing: <node> <path>` from `write-state`, or
`companion-stale:` from it or from `gate-brief`, asks for one `html-companion-writer` run for that
page, from the markdown as it reads now and before the next checkpoint — never a re-run of the
node (`references/writing-state.md` § *A missing or stale companion*).

**`run-complete` is the last call** once nothing is left to run (*Operator visibility*).

---

## Initialization

Before any node runs:

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `AskUserQuestion` at a gate. They apply only to your discretionary clarifications. Invoke `AskUserQuestion` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine's `references/gates.md`, *Driver-suspended mode*.

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
  (`references/in-node-questions.md`).
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
section — reads `${CLAUDE_PLUGIN_ROOT}`, put the directory in its place, because a permission
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

Every verb's flags, output and refusals are in `references/verbs.md`. Each step here spells the whole call of the verbs every run makes, where its moment is. Read a verb's row there only for a call no step spells.

**A changed definition never re-freezes an open run.** The graph a run froze is its graph
for its whole life, and no verb or flag replaces it. A read verb's `…-graph-drift` warning,
`subrun-graph-drifted`, `dispatch-graph-drifted` and `state-workflow-frozen` share two ways on:
Put back the definition the run froze (`workflow.source`, with its overlays) and the run goes
on where it stopped, or start a new run from the changed definition. Never revert a person's
own edit unasked: name both ways and let the person choose.

---

## Operator visibility

**How a run ends depends on who reads its end.**

- **Under an absent or `terminal` driver a person reads it.** Write the closing patch and call
  `run-complete`; settle any refusal first (`references/writing-state.md` § *When `run-complete`
  refuses*). Then close with one wrap-up message that fits one screen and is the last thing the
  run prints: six labelled sections, in this order, and nothing else.
  - **Done:** the outcome in plain words — completed, stopped at a named checkpoint with the
    option taken, or failed at a named phase;
  - **Needs you:** each `open` risk still open, one line each — what is open and where to take
    it — or "nothing". Every `missing-artifact:` and `missing-companion:` line goes here too,
    restated as a file a named phase should have written and did not. Never ask a question
    here: the run has ended;
  - **Follow-ups:** each `followup` risk, one line each, or "none";
  - **Next:** every next step, one line each: the workflow's own as the real command with its
    real flags (`/maister:development --research=<task-dir>`), then the rest its closing node
    names;
  - **Files:** the key files the run wrote, from the project root; anything long goes into a
    file in the task directory, named here;
  - **Dashboard:** `<link>`, or none when the run has none. Nothing follows it.

  Never show the raw `missing-artifact:`, `missing-companion:`, `run stopped:` or `RUN-` lines. A
  child run driven in session runs `run-complete` with no wrap-up: its parent's walk goes on.
- **Under a `cockpit` or `dispatch` driver tooling reads it.** Print everything the operator
  should read — the executive summary, the next steps, the dashboard link — before
  `run-complete`, and echo its lines, its marker last; never type a marker it did not print. A
  turn that ends at a sub-run ends on the typed `WAITING-SUBRUN` line (`references/sub-runs.md`).

---

## Executing the graph

### The ready set

Run ready nodes one at a time, in the frozen graph's order. A node is ready when its `needs`
have ended as its `on:` accepts and its `when` guard reads true (`node-brief`'s `when:` line
evaluates it; the rule is `references/grammar.md` § 7). A false guard, or an `on: failure`
node with nothing failed, is recorded `skipped`, and **a skip satisfies everything downstream**.
When nothing is pending — or a node failed with no `on:` downstream to take it, or a stop ended
the run — write the closing patch with `task.status` and end through `run-complete`, which
prints the marker from that status.

**The held rule.** While a choice is held for approval, a gate whose guard reads a step's value
is asked whatever its guard reads, and its continue approves the held choices; a gate guarded
only by inputs or other gates' values is still skipped (`gate-guard-false`). With no checkpoint
left, the closing node asks `held-approval` (`references/gates.md` § *The closing checkpoint
`held-approval`*).

**A `waiting` node is not ready** and satisfies no `needs`, not even under `on: always`: it is
never executed again and never makes the run gate-pending (*Sub-runs*; a dispatch's close-out,
*Recording an outcome*).

### Gates and in-node questions

**At a gate, run the `gate-brief` call its `node-brief` names**,
`gate-brief --state=<state> --node=<gate>`, on its own and only after the closing write has
returned — `gate-request --node=<gate>` in its place when a driver suspends on it, and when it is
asked in session
<!-- rich-picker -->
with `--json --picker=rich`.
<!-- /rich-picker -->
<!-- plain-picker
with `--ask`, whose whole output is the question tool's arguments, passed as they stand.
-->
Ask what it prints; never write a gate question by hand.

**A question a node asks inside itself** follows the run's driver and is classed first when the
freeze recorded `classes_questions`: read `references/in-node-questions.md` before a node asks
its first one.

### Interpolating `${…}`

`node-brief` prints a node's `with:` and `dir:` with every `${…}` filled in from state, a
reference that is the whole string keeping its type (`references/grammar.md` § 9): take them
from there, never resolve one by hand. **A reference never resolves by guessing**: one printed
`(not recorded yet)` for a completed node is that node's defect — re-drive it, or record the
value through `write-state`, never substitute a plausible one.

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

A `started:` line in a node's brief means the brief recorded the step's start; without one, the
start is your write (`references/writing-state.md` § *One write per moment*). Target names are
bare; the provider prefix is applied at invocation (`references/grammar.md` § 5.1).

**While a delegate runs, say so.** Right after launching one, print one line — *"<Phase title>
is running. Nothing needed from you; I'll continue when it finishes."* — and when a
notification brings you back before it is done, one short line on what is done and what is
left. Never predict how long a step takes; an elapsed time a step reports may be said. With a
dashboard, the first such line ends *"Progress is on the dashboard in your browser."*, repeated
only now and then, never with its path. Questions never name the dashboard.

### Node conventions

Every node follows the rows that apply to it — a step its scheme's row and `every step`, a gate
the `gate` row, any node each other row whose case it meets — and `node-brief` prints them for it
(*Before anything else*); a node's section never restates them. Each row is printed whole the
first time a session's briefs meet it, then named on one `conventions in force (…)` line, this
section being the brief's `rules:` path. A resume or a compaction clears what was shown, and a
host that names no session gets every row whole.

| Applies to | Convention |
|---|---|
| `agent:` step | Task tool, passing the `model` and `effort` the `runs:` line prints beside the agent type; a field it prints as `omit` is left off the call. The prompt carries the `with:` values; each declared path the agent writes, never one the Writes part keeps for the step — an `output_path` agent gets it as `outputs.artifacts` declares it, relative to the task directory, since it joins it to `task_path`; and `prior-context --node` pasted unedited (`run-context` if nothing earlier is needed). Its `headline` is the summary headline. |
| `skill:` step | Skill tool, given the `with:` values and the `run-context` output; the skill's own result feeds the node summary. |
| `direct:` step | Run inline from the node's section; its `delegates:` agents are dispatched as that line says. A step that owes an HTML page has each owed page written as its `companion writer:` line says, before the completing write. A step with no section does only what these rows say. |
| `workflow:` step | Starts a child run and waits for it (*Sub-runs*); its outcome is the child's `task.status`, mapped by `references/sub-runs.md` § *Ending, and the re-resolve that precedes W4*. One carrying `dir:` is a dispatch, mapped from its close-out grade (`references/in-node-questions.md` § *A dispatch closed out partial*). |
| gate | Asked from `gate-brief` (`references/gates.md`); record the answer, end the run on a stop, revise through `gate-revise`. Whether a false guard skips it is the ready-set rule (*The ready set*, `references/grammar.md` § 7); `gate-brief` and `gate-request` refuse a gate it skips, `gate-guard-false`. Sections hold exceptions only. |
| every step | A throwaway file the step makes itself — a probe, a benchmark, a copy — goes in a directory `mktemp -d` makes (it uses `$TMPDIR`) or under `"${TMPDIR:-/tmp}"`, never a literal `/tmp` path: a fixed `/tmp` path can stop the run for a permission prompt. Before recording `completed`, check each declared artifact path. A missing one its `brief:` `absent` does not sanction is a failed self-check: re-drive the step, naming the path. Record a sanctioned absence under `absent` with its reason, and record every declared value. |
| asks | With question sets, ask everything known at the first asking point in one request, and a follow-up set only for what an answer raised, at most two follow-up rounds per attempt (`gate-brief-rounds-spent` past them: take the named defaults); without them, record the Without default `by: default`. Record each in-session answer as one `by: operator` decision with its `question_id`, question, answer, recommended answer and `as_recommended` on the step's own `node_summaries` entry (`references/gates.md`). Once `classes_questions` is recorded, give each question in the set the family that fits it from its id's `families` line, if the brief prints one; a lower family only with the question reader's verdict copied on as `reader` (`references/in-node-questions.md`), and the same verdict on each question of an id a `reader (<id>)` line names, a clarification the run settles only with it; and ask only the classing writer's `ask:` ids; held choices wait for the next checkpoint or `held-approval`. Before treating any answer as settled, apply the fact-or-choice test (`references/in-node-questions.md`, *A fact is what no answer would change*): an answer that would change what the product does, or who may do it, is a choice, asked or classed, never settled as a fact; a step's own triage may only raise a question's class. |
| feeds a checkpoint | The closing summary keeps the summary contract: a one-sentence `headline` within 220 characters; the artifact's decisions and risks item for item, tagged; `recommends` with a one-line reason as `brief:` directs once its input is set, or naming the gate's revise when the node finds its work short of what was agreed (`references/gates.md`). |
| named by a revise | Read the note from `prior-context`; revise the step's own artifacts in place; keep earlier answers unless the note reopens them; record the declared values again; say what changed and write the headline again. |
| has a budget | The attempt count in `brief:` `budget` is a prose rule nothing enforces. When the last attempt fails, the operator chooses: a retry that then succeeds is `completed`; a skip is `skipped`, its declared bools false and its strings null. Where nobody can be asked the node is `failed` and the run ends `RUN-FAILED` (`references/in-node-questions.md` § *When nobody can be asked*). |

### Ending a dispatched run

**A dispatched run publishes its close-out through the outbox verb, and the closing node records
its outcome only after that publish succeeded** — in a run that records `classes_questions`,
never before `gate-brief --node=held-approval` has run. There `run-complete --state=<state>` also
takes `--outbox` and `--dispatch-id`, copied unchanged from the seed: the state records no outbox
root, and its `dispatch_id` only marks the run as dispatched. The outcomes, the `DISPATCH-RESULT:`
fallback and the `task.status: completed` a refused `held-approval` request still records are
`references/gates.md` § *Ending a dispatched run*.

---

## Sub-runs

A `workflow:` node starts a child run: read `references/sub-runs.md` before its first write —
the writes, the checks that refuse and the ending are there.

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

**Every resume starts with `resume-check --state=<run directory>/orchestrator-state.yml`**, right
after Step 2's probe. On exit `0`, show a non-null `dashboard` once as `Dashboard: <link>` (run
no opener), relay a `warning:` line once, and when `revision.applied` is `false` run
`gate-revise` before anything else (`references/gates.md` § *Revising at a gate*). On exit `1`
— `written-by-2x`, `run-set-aside`, `state-unreadable` — relay the `message` verbatim and stop:
write nothing, create no task directory, print no marker.

---

## Starting a run

### Step 1: Read the node summary shape

Read `references/node-summaries.md` whole now: every closing write and every checkpoint depend on
what each decision's `by` and each risk's tag mean. The summary contract reaches you through
`run-context`, the companion lines through `write-state`, and the closing check through
`run-complete`.

### Step 2: Probe the runtime, before writing anything

Run `node --version` once. On failure, or below 20, stop before any task directory exists: print
`RUN-FAILED: node-unavailable`. A terminal-driver run tells the user the workflow needs Node.js 20
or newer, and that an install which cannot run it stays on the 2.x line
(`/plugin marketplace add SkillPanel/maister#release/2.x`, then
`/plugin install maister@maister-plugins-2x`); a dispatched worker reports `blocked` through the
outbox verb and stops. There is no second interpreter: never run such a workflow by hand.

### Step 3: Resolve the workflow by name

**Run `locate --name=<name>` first; never resolve a path by hand.** Give `validate` and `resolve`
the `definition` and `overlays` it prints, then the overlays the invocation names, in that order,
and its profile; inputs, overlays, profile and a title handed over by `/maister:run` are used
exactly as given. When `locate` reports an overlay `ignored`, say it is not in effect.

**A non-empty `dispatches` is a chain**, which never runs under an absent or `terminal` driver:
name those nodes and stop. A `chain_only` refusal is relayed, then stop.

### Step 4: Freeze the graph before executing anything

Three calls, in this order: `validate --definition=<path> [--overlay=<path>…] [--profile=<name>]`,
then `resolve` with the same flags, then the freeze's `write-state` with `--host=claude`, so the
writer records how the run's subagents can delegate. If `validate` rejects the definition, stop
with `RUN-FAILED:` and its first error; relay its warnings (`references/grammar.md` § 14).

**The run directory** is `.maister/tasks/<type>/<YYYY-MM-DD-slug>/` under the project root:
`<type>` is the workflow's name (migration's `migrations/` the one exception), the slug is 3–5
key words of the description in lowercase kebab-case after the date
(`2025-12-17-fix-login-timeout`), with `-2`, `-3` … when the name is taken, and it sits nowhere
deeper. Never make it yourself: the freeze creates it, and a resume keeps the
one it has.

**The freeze patch carries, and nothing else:**
- `workflow`: `source`, `overlays`, `profile`, `graph_hash` and `name` exactly as `resolve`
  printed them, `grammar_version: 1`, no `nodes`; one here-string, never scripted from a file;
- `task.title` and `task.description`;
- `orchestrator.task_path`, the run directory relative to the repository;
- `task.key`: the value of the input `resolve` names as `tracker_key`, when it names one;
- `orchestrator.options.inputs`, the run's inputs; with none, no key;
- `orchestrator.options.html_output` from `.maister/config.yml` (default `true`);
- `orchestrator.options.ceiling`, when a dispatched run's seed names one;
- `context`, the fields known before the first node runs, when the definition's prose names a seed.

The writer adds the rest (`references/writing-state.md` § *What the freeze write adds*) and drops
a key it owns with a `note:`; relay any `warning:`; a refusal names its recovery under `rules:`.
The run creates no task items.

**The freeze prints the startup banner first; your next message, before any other call, tells
the user what it says**, paths and links as printed. On a terminal run the freeze has already
opened the dashboard: run no opener.

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
(*Sub-runs*). A dispatch goes through the umbrella runtime's `envelope` verb, which opens the
dispatch's ledger entry itself; a run never writes `create-entry` for a dispatch.
