---
name: maister:workflow-author
description: Helps a project author its own workflow definitions in `.maister/workflows/` — a new workflow, or an overlay of a built-in — and check them before anything runs. `new <name>` interviews the author and writes the definition with its prose companion; `overlay <builtin>` shows the built-in's attachable surface, then writes the overlay; `check` validates a workflow the way `/maister:run --check` does and adds the checks the engine does not make on executors and artifact paths; `nodes <builtin>` lists what an overlay can attach to or disable; `preview <name>` draws the resolved graph as ASCII with every guard in words. Says plainly when a change needs an eject rather than an overlay, and what an eject costs. Writes only under `.maister/workflows/`, never freezes, writes state or runs a node — running stays with `/maister:run`.
argument-hint: "new <name> | overlay <builtin> | check [<name> | --all] [--profile=NAME] [--overlay=PATH ...] | nodes <builtin> | preview <name> [--profile=NAME] [--overlay=PATH ...]"
user-invocable: true
---

# Author a Workflow

A workflow of the project's own is a definition, `.maister/workflows/<name>.yml`, and a prose
companion, `<name>.md`, written in the grammar every built-in uses. An overlay,
`<builtin>.overlay.yml`, changes a built-in without copying it. This skill helps write both and
check them before a run: it scaffolds, it shows what a built-in lets an overlay touch, it adds
the checks the validator does not make, and it draws the graph readably. It is an editor's
assistant, not a runner.

**The grammar is the authority.** Every key, rule and recipe is in the workflow engine's
`references/grammar.md` (two levels above this skill's base directory, then
`skills/workflow-engine/references/grammar.md`). Read the section a step needs, cite it to the
author by number, and never restate it here or in a file you write — a second copy drifts.

---

## Boundaries

- **Writes only under `.maister/workflows/`.** Definitions, companions and overlays — nothing in
  the plugin, nothing under `.maister/tasks/`, nothing elsewhere in the project. A skill or agent
  a node should call is the author's to write in `.claude/`; say where it goes, do not create it.
- **Never runs anything.** No freeze, no state write, no node, no invocation of the workflow
  engine skill. Starting a run is `/maister:run <name>`; name it at the end, do not do it.
- **Not an orchestrator.** It fires no gates. It asks ordinary interview questions with
  AskUserQuestion, one decision per question, each with a recommended answer. When no question
  tool is available — a headless session — take the answers from the arguments and the free text,
  choose the conservative default for anything unsaid, and list every assumption in the report.
- **Never overwrites without asking.** A file that already exists is extended or left alone;
  replacing it is the author's explicit choice.

## Calling the engine's verbs

Use the verbs exactly as `/maister:run` does — its § *Calling the engine's verbs* is the
contract: the script `skills/workflow-engine/scripts/workflow.mjs` under the plugin root, written
as its absolute path, one verb per call, from the project root; exit `0` success, `1` a rejection
whose reasons are in the JSON on stdout, `2` a runtime that did not start (quote stderr and stop).
This skill uses four, all read-only:

| Verb | Gives |
|---|---|
| `locate --name=<name>` | Where the name resolves: `from` (`eject`, `generated`, `overlay`, `builtin`), the `definition` and `overlays` paths the next verbs take, `ignored`, `inputs`, `dispatches`. Without `--name`: the project's own workflows |
| `validate --definition=… [--overlay=…] [--profile=…]` | `errors`, `warnings`, `resolved` (each target, the tier that answered and the file), `counts` |
| `resolve` (same flags) | The folded graph: `nodes` in frozen order, each with `needs`, `when`, `on`, `with`, `outputs`, and a gate's `ask` and `options`; the `graph_hash` |
| `diagram` (same flags) | Mermaid text carrying each node's title. Read it for the titles; **never print it** — a terminal does not render Mermaid |

Overlays passed to a verb are always the ones `locate` found, then the author's `--overlay`s, in
that order, with `--profile` when given.

---

## With no argument

List what the project has: `locate` without a name for its workflows (name, title, broken or
chain), then every `*.overlay.yml` in `.maister/workflows/` with the built-in it extends and
whether an eject beside it means it is ignored. Then show the five subcommands in one line each
and stop.

## `new <name>`

**Refuse first**, each with its reason and the way on:

- a name outside the grammar's charset (§ 3) — suggest the nearest legal spelling;
- a name that already has a file in `.maister/workflows/` — offer `check` or `preview` on it;
- a built-in's name (`locate` answers `from: builtin`) — a new file under that name is an eject;
  route to `overlay <name>` and *Overlay or eject* below;
- a legacy task-folder name (`bug-fixes`, `enhancements`, `new-features`, `refactoring`,
  `mockups`) — a run's folder is its workflow's name, and those folders are skipped by every run
  reader.

**Interview**, short, in this order — each answer shapes the next question. **Ask by meaning**:
the question and the option labels say what the author is deciding ("Should someone approve
after this step?", "What does someone give it when they start it?"), and the engine's term —
`direct:`, a gate, a guard, `bool` — appears only in an option's description, so an author who
has never read the definition format can still answer. The headings below are for you, not the
questions:

1. **What is it for, and when should someone use it?** One line. It becomes `description:`, which
   is how `/maister:work` offers the workflow; the companion's opening paragraph expands it.
2. **Inputs** — name, type (`string`, `bool`, `path`), required or defaulted (§ 8.1). A run can
   carry at most one `tracker_key`.
3. **Phases, in order.** For each: an id, a one-line title, and what does the work —
   - `direct:` — the engine follows a section the author writes in the companion; the default
     for a step described in words;
   - `skill:` / `agent:` — something that already exists. Offer what resolves: the project's
     `.claude/skills` and `.claude/agents`, the author's own, this plugin's, installed plugins
     (§ 5.1). A name that resolves nowhere is allowed but warns — say so;
   - `workflow:` — another workflow as a child run, only if that workflow is child-capable
     (§ 13.1).
4. **Gates.** After which phases should a person approve before the run goes on? Propose one after
   each phase that produces something reviewable; each gate gets one continue option and at least
   one stop (§ 6), or one continue per way on when the gate decides the optional phase after it. Where the author wants a way to send a document back, add a revise option
   naming the node that wrote it, and give that node's section its re-run paragraph (§ 6, § 11).
5. **Optional stretches.** A phase that runs only sometimes is guarded by a `bool` — an input, a
   value an earlier node records, or a value the answer to the gate before it sets (§ 6, § 7). A
   stretch either of two gates can switch on joins their values with `||`; there is no other
   operator, so say so if the author describes an all-of condition, and turn it into one recorded `bool`.
6. **Artifacts and values** each phase declares (§ 8.2): literal paths relative to the run's task
   directory; values as `bool`, `id` or `enum` rather than `string` where they are handles.
7. **Will another workflow call this one?** Only on request, apply the child-capable recipe
   (§ 13.1): the `embedded` input, the guarded closing node, a workflow-level `outputs:` block, a
   default for every in-node question, and the `## Embedded mode` section.

**Write the pair.**

- `<name>.yml` — `name`, `version: 1`, `description`, `inputs`, `nodes` wired by `needs` in the
  order given, gates after the phases chosen, guards, outputs, `display.titles` for every node.
  Pass what a node needs from earlier ones through `with:` using `${…}` references inside its
  `needs` closure (§ 9); a value a skipped node may leave null is read from state by the prose,
  not interpolated (§ 9).
- `<name>.md` — an `# H1` title; an opening paragraph saying what the workflow is for and when to
  use it; then **one `## <id>` section per `direct:` node**, headed exactly with the name after
  `direct:` (§ 11). Each section is a short, honest stub the author will finish: the steps in
  outline, what the node writes and records, what its closing summary must carry for the next
  gate, the questions it may ask with the default each takes when nobody can answer, and its retry
  budget. A fix loop inside one node follows § 13.2. The last `direct:` node that does work also
  reconciles: it checks every path the run's node summaries list against disk and reports what
  is missing, because the engine checks only the artifacts the definition declares.

Then run **check** on the new name and report. End with the next steps: finish each `## <id>`
section, `/maister:workflow-author preview <name>`, then `/maister:run <name>`.

## `overlay <builtin>`

**Refuse** a name that is not a built-in (`locate` answers anything but `builtin` or `overlay`),
and warn before writing when an eject or a generated chain of that name exists — the overlay would
be **ignored** (§ 1). An existing `<builtin>.overlay.yml` is read and extended, never replaced
without asking.

**Show the surface first** — run **nodes** for the built-in, so the author picks ids they can see.

**Ask what should change, and route each wish** to the one operation that does it (§ 12):

| The author wants | Write |
|---|---|
| A new phase between two existing ones, or a verifier that holds a gate | `add` the node with `needs` on the phase before and `before:` naming the phase or gate that must wait for it |
| A step's inputs changed | `tune: {<id>: {with: {…}}}` — merged key by key, `null` deletes a key; restate a map-valued key whole |
| A phase gone | `disable` — clean only when **nodes** says so; otherwise also `tune` each dependent's `with` to drop the key that referred to it, or eject when the reference is a guard |
| Variants of the same change | `profiles`, selected with `--profile` |
| Different titles or icons | `display` |
| A different executor, gate wording or options, a guard, a reorder | an eject — see *Overlay or eject* |

An added node without `before:` is a side branch nothing waits for; propose the `before:` anchor
from **nodes** every time. Never disable a node and add it back under the same id — pick a new id.

**Write** `<builtin>.overlay.yml` (`extends: builtin:<builtin>`, `version: 1`, the operations,
`display.titles` for added nodes) and, only when the overlay adds a `direct:` node,
`<builtin>.overlay.md` with one `## <id>` stub per added `direct:` node, as in `new`. Then run
**check** on the built-in's name, which picks the overlay up, and report.

## `check [<name> | --all]`

1. **The validator's report.** Invoke `maister:run` with the Skill tool, as `<name> --check` plus
   any `--overlay` and `--profile` the author gave, and relay its report as it prints it — the
   error lines, their `fix:` hints, the warnings, what resolved, the inputs. That skill's hint
   table is the only one; do not add hints to its findings, and leave out its line pointing back
   here.
2. **What the validator does not check.** Run `locate` and `validate` for the JSON, and `resolve`,
   then add a section headed *Authoring checks*, each finding as `<file> · <node> — <problem>`
   with a `fix:` line:
   - **Executors** — for each `skill:` and `agent:` entry in `resolved` whose `from` is `project`
     or `user`, read the file at `at`:
     - its frontmatter `name:` differs from the name the target was found by (the skill's
       directory or the agent's file name). The engine finds it by the file name while the host
       registers it by `name:`, so the node calls something else, or nothing. Fix: make them
       agree.
     - it was found only under `.github/` — Copilot CLI reads that layout and Claude Code does
       not. Fix: move or copy it to `.claude/`, unless the workflow only ever runs under Copilot.
     - its name equals one of this plugin's skills or agents. `validate` reports yours as the
       winner, but a built-in's prose calls the plugin's by its prefixed name, so a built-in or an
       overlay of one may still run the plugin's. Fix: give yours a distinct name and attach it
       with `add` — or accept the shadow knowingly for your own `new` workflows only.

     And for an entry whose `from` is `installed` with a bare target: the host registers an
     installed plugin's skills and agents under that plugin's namespace, so the bare name may not
     be callable. Fix: write `skill:<plugin>:<name>` (§ 5.1). A target in no tier is already a
     warning in the report above; add nothing.
   - **Artifacts** — one reminder, once per report, when the definition declares artifacts at
     all (a path that leaves the run's task directory is already an error in the report above):
     the node prose asks for an artifact's HTML companion (a `direct:` node hands its finished
     markdown to this plugin's `html-companion-writer` agent and registers the result as that
     artifact's `html` in its summary), and the closing node reconciles every listed file against
     disk. The engine does neither on its own.
   - **Dangling leaves** — the validator warns for these itself, for a definition's own node
     and for one an overlay adds; they are in the report above. Add nothing.
   - **Gates asked whatever their guard reads** — the validator warns `skip-guard-not-pure` for
     a gate guarded by a value a non-gate node records that is more than a pure confirmation;
     it is in the report above. Add nothing, but say what it means: the run asks that gate even
     when its guard is false.
   - **Overlay or eject** — when an error is a refusal only an eject lifts (a key that may not be
     tuned, a disabled id added back, a guard or a target changed), say so and point to
     *Overlay or eject*.
3. **Close** with the counts from both parts and the next step: `preview <name>`, or `/maister:run
   <name>` when clean.

**`--all`** checks every workflow `locate` lists and every built-in with an overlay in
`.maister/workflows/`, one after another, and ends with one summary line each — name, errors,
warnings, authoring findings. This is the pass to run after a plugin upgrade: an overlay attaches
to a built-in's node ids, and an eject has stopped following the built-in.

## `nodes <builtin>`

The attachable surface of a built-in: what an overlay may name. Run `resolve` on the built-in as
shipped (`locate`'s `definition` with no overlays); when the project already has an overlay of it,
say so and offer the folded view too. Read `diagram` for the node titles.

**One row per node, in frozen order:** id, title, gate or executor (`uses`), `needs`, the guard in
words, the `on:` when it is not `success`, declared values with their types, declared artifacts.

**Then two lists:**

- **Disables cleanly.** A node disables cleanly when no remaining node refers to its outputs —
  no `${<id>.…}` in another node's `with`, `ask` or `dir`, no `when` on its values — and the
  workflow's `outputs:` block does not name it. Its dependents are rewired to what it waited for.
  For every other node, name the nodes that refer to it and how: a `with` reference can be freed
  with a `tune` that sets that key to `null`; a `when` reference cannot be tuned, so disabling that
  node means an eject.
- **`before:` anchors.** A gate is the anchor for a verifier that must hold it: the gate waits, and
  its brief shows the verifier's summary. The node that starts the next phase is the anchor for an
  inserted phase. `before:` is refused on the added node itself, on a node the graph does not
  carry, and on a node the added one already needs (§ 12).

## `preview <name>`

Run `locate`, then `validate` — with errors, stop and point to `check` — then `resolve` and
`diagram`. Draw the graph in the terminal as ASCII:

- **A header:** the workflow, where it came from in plain words (the project's own, an eject, an
  overlay over the built-in, the built-in), the overlays applied in order, the profile, the node
  and gate counts.
- **The flow, top to bottom,** one box per node with its title and id, gates visibly different,
  nodes that can run at the same time side by side, joins where a node needs several.
- **Every guard in words,** next to its node — "runs only when gap analysis found a reproducible
  defect", "skipped when this run is a child of another", "runs when either gate chose the
  design" — and every `on:` other than `success`
  ("runs only if a need failed", "runs however its needs ended").
- **A gate the skip-guard rule asks** — one guarded by a value a non-gate node records that is
  more than a single plain continue — is drawn with its guard and "asked whatever its guard
  reads", never as skippable.
- **Dangling leaves:** a node nothing waits for that is not where the run ends. Name each, say
  where the frozen order puts it (ties are broken by id), and say what it means — no gate waits
  for it, and the run can close past it. For a definition's own node the fix is a later node's
  `needs`; for an overlay's added node it is `before:`. An `on: failure` or `on: always` node is a
  handler, a leaf by design, and is not one.

Never print the Mermaid text itself.

---

## Overlay or eject

Prefer an overlay: it keeps following the built-in as the plugin improves it, and it states only
what the project changed.

**An overlay can** disable a node, tune a node's `with` or `provider`, add a node with its own
`needs` and a `before:` that makes existing nodes wait for it, carry profiles, and retitle.

**Only an eject can** change what runs a node (`uses` is immutable), reword a gate or change its
options, change or drop a guard, change a node's `needs` or declared outputs, reorder existing
phases, or remove a node that a guard reads.

**What an eject costs.** It is a copy of the built-in's definition and companion under the same
name in `.maister/workflows/`, and it shadows the built-in entirely:

- it stops following plugin updates — every fix to that workflow's prose and graph must be
  carried over by hand. Measure the size of what is being taken on and say it: the line counts of
  the built-in's `.yml` and `.md` beside the workflow engine's `workflows/`;
- any overlay of that name is ignored from then on (`overlay-ignored`); fold it into the eject;
- after each plugin upgrade, compare the eject with the new built-in; `check --all` finds what no
  longer validates, but not what the built-in improved.

When the author chooses an eject, copy the built-in's `.yml` and `.md` into `.maister/workflows/`
on request, make the change there, fold in any overlay of the same name and remove it with the
author's agreement, then run **check**.

## What this skill does not do

- **Run, resume or dry-run a workflow.** `/maister:run <name>` starts it; `/maister:run
  <name> --check` is the validator alone.
- **Author a chain.** A node with `dir:` dispatches into member repositories; chains are
  planned and started from maister cockpit, and judged in a workspace by `/maister:umbrella
  validate`.
- **Write the skills and agents a node calls,** or anything outside `.maister/workflows/`.
