# Extending maister

Maister is built to be extended by people who cannot, or would rather not, modify the plugin.
Everything on this page works from inside a project or an umbrella workspace: nothing here asks
you to fork the plugin, patch a shipped skill, or wait for a release.

There are three extension points, and one boundary:

| You want to | Do this |
|---|---|
| Run a graph of your own design | Write a workflow definition in `.maister/workflows/` with `direct:` nodes for the steps you describe in prose, and start it with `/maister:run <name>` |
| Use your own skills and agents as steps | Name them from a node; the engine finds them in your project, in the plugin, or in any installed plugin |
| Change a shipped workflow without copying it | Lay an overlay over it, or eject it into your workspace |
| Change what the grammar can say | That is a contract change — see the last section |

The grammar itself is the same one the built-in workflows use, so a definition you write is checked
by the same validator, frozen into a run's state the same way, and run like any built-in — from
the terminal with `/maister:run <name>`, or driven by the cockpit. The only surface the plugin keeps closed is the *shape* of that grammar.

## Your own workflows

A workflow of your own is a definition the project or workspace owns: `.maister/workflows/<name>.yml`,
with a prose companion `.maister/workflows/<name>.md` beside it. A node is one entry under `nodes:`; its
`uses:` names what runs it, in one of four schemes:

| Scheme | What runs |
|---|---|
| `direct:<name>` | The engine itself, following the section of that name in the prose companion |
| `skill:<name>` | A skill, invoked by the host's Skill tool |
| `agent:<name>` | An agent, invoked by the host's Task tool |
| `workflow:<name>` | Another workflow definition — as a child run of its own, or dispatched into a member when the node carries `dir:` |

A gate is a node with `type: gate`, a question under `ask:` and its answers under `options:`,
exactly one of which continues the run and at least one of which stops it. Nodes declare their
dependencies with `needs:`, their guards with `when:`, and the values they hand downstream with
`outputs:`. A node's `on:` says which endings of its needs let it run: `success`, the default, needs
every one completed or skipped; `failure` runs only when one of them failed, and is skipped when
none did; `always` runs once they have all ended, however. The definition's `name` is lower-case letters, digits and dashes, starting with a letter;
`version: 1` is the bare number, never quoted; and each entry under `inputs:` declares its `type` as
`string`, `bool` or `path`. A declared artifact is a literal path relative to the run's task
directory: `${…}` references belong in `with:`, `dir:` and `ask:`, and one inside an artifact path,
or one left without its closing `}`, is a validation error. Every key, scheme and rule — the full
node shape, gates and guards, inputs and outputs, interpolation, overlays, the companion's heading
rule, and recipes for a child-capable workflow and a fix loop — is in the
[workflow definition grammar](../plugins/maister/skills/workflow-engine/references/grammar.md)
that ships with the plugin. [workflows.md](workflows.md) describes the built-in definitions written
in it, and the cockpit's
[umbrellas and chain files](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/umbrellas.md)
page covers what is specific to chains.

**A `direct:` node is yours entirely.** Its body is the section in the prose companion whose
heading *is* the name after `direct:` — conventionally the node id: `uses: direct:assess-scope`
runs `## assess-scope`, in backticks or bare, at any heading level, never a heading that merely
mentions it. Write the steps, the fan-outs, the self-checks and the questions the step asks inline;
the engine reads that section before running the node, not after it fails. A `direct:` target with
no section is a validation error, because the companion is the one reference a definition fully
controls.

**A `workflow:` node without `dir:` starts a child run.** The named workflow gets a task directory
of its own — an ordinary dated one, of its own type, sitting beside the parent's rather than inside
it — with its own frozen graph, its own driver and its own pauses. The node waits while the child
runs, takes the child's outcome as its own, and then exposes the keys the child declares, which a
later node reads as `${<node>.artifacts.<key>}` and `${<node>.values.<key>}`. The same node *with*
`dir:` keeps its dispatch meaning and hands the work to a member repository instead; one key tells
the two apart, and a node cannot do both. Not every workflow can be a child: only one whose
definition declares an `embedded` input and an `outputs:` block, which is the next paragraph.

**Declare what a parent may read with a workflow-level `outputs:` block.** It sits beside `name`,
`version`, `inputs` and `nodes` in the definition, and maps an exposed key to the node output it
comes from — a key a parent cannot see does not exist to it:

```yaml
outputs:
  artifacts:
    report: research-foundation.artifacts.report
  values:
    conclusions: research-foundation.values.conclusions
```

The named node must exist and must declare that output, or validation errors. The calling node
declares the same keys on its own side, an artifact by the path the child writes it to and a value
by its type:

```yaml
nodes:
  probe:
    uses: workflow:research
    with: {question: "How should the adapter be scoped?"}
    outputs:
      artifacts: {report: outputs/research-report.md}
      values: {conclusions: string}
```

Binding is by name, both ways — there is no renaming — and `task_path` and `run_id` are reserved,
because the node always carries those two itself. Once the child has run, the declared artifacts it
wrote are listed on the calling node and linked from the parent's dashboard; a declared artifact
may be a single file or a whole directory. The block is part of the definition's recorded
identity, so adding one moves that identity: regenerate the diagram of any definition that ships
with one.

**A run is held to the definition it froze.** The engine refuses to start a run unless the graph
it records resolves from the definition, overlays and profile the run names, and every input the
definition marks `required` has a value. After that, every write is refused if it names a node the
graph does not carry, gives a node a status outside the eight it can have, records a declared
value in the wrong form, or records a gate answer that is not one of that gate's options. A value in
the wrong form is a `bool` that is not `true` or `false`, or an `enum` value that is not one of
its members. A value recorded under a key the node does not declare is written with a warning:
nothing can read it, so declare it under the node's `outputs` if a later node needs it.

**Validate before you run.** `/maister:run <name> --check` finds the workflow by name, lays its
overlays over it — the `<name>.overlay.yml` beside it, then any `--overlay` you add — selects
`--profile` when you give one, and validates the result without starting anything:

```bash
/maister:run onboarding --check
/maister:run development --check --profile=quick   # a profile .maister/workflows/development.overlay.yml declares
```

It parses the file, checks ids and the graph, resolves every target and checks gate shape. Each
error names the file, the node and the field, with a one-line fix where the fix is mechanical.
Warnings never block, and each one is listed. `/maister:run` runs the same check before it starts
a run, so a definition that does not validate never becomes one. In an umbrella workspace,
`/maister:umbrella validate --definition .maister/workflows/<name>.yml` also checks every `dir:`
against the members the manifest declares. It needs that manifest, and it judges each definition
as written, without overlays.

**Writing the companion.** The companion `<name>.md` is what makes a definition runnable and
findable:

- **Open it with a `# Title` line and one paragraph** saying what the workflow is for and when to
  use it. `/maister:work` offers your workflow by that paragraph when a task description matches
  it, and `/maister:run --list` shows both. A one-line `description:` in the definition does the
  same job and is preferred when present. A project workflow with neither is valid but warns
  `workflow-undescribed`, because nothing would offer it. There is no `title:` key: the heading is
  the title.
- **Give every `direct:` node one section**, headed with the name after `direct:`. The section
  holds the node's steps, its self-checks, the questions it asks inline and the answer each takes
  when nobody is at the keyboard, what it writes into its closing summary for the next gate, and
  its retry budget.
- **HTML companions are the node's to ask for.** When a node's artifact deserves an HTML
  companion and the run's `html_output` is on, the node prose says so. An artifact written by a
  delegate gets its companion from that delegate, handed the HTML style guide's path. One your
  `direct:` node writes itself gets one by handing the finished markdown to the plugin's
  `html-companion-writer` agent. Either way the companion's path is registered as the `html` of
  that artifact in the node's summary, which is what the dashboard links.
- **Reconciliation is the closing node's job.** The engine registers each completing node's
  declared artifacts that exist, and `run-complete` names the declared ones that are missing. A
  node's summary can list more than the definition declares, though — HTML companions, and files
  its prose asked for. Have your last node check every path the summaries list against disk, the
  way the built-ins' finalization nodes do, and report what is missing.

**How a run closes.** Every run ends through the engine's `run-complete` verb, which prints the
run's closing marker. A run recorded `completed` is refused while a node it can still reach has
not run: a node still running, or a pending one whose needs are met and that no false guard
keeps off the path. The refusal names each one. A node a false guard skips is not owed, and
neither is one waiting on a need that failed, unless its `on:` says to run anyway. The verb
also prints one `missing-artifact: <node> <path>` line above the marker for each artifact a
completed node declared that is not on disk. That line is a warning for you to read, never a
refusal. Both checks read the resolved graph, overlays included, so a node you add is held to
the same rule as the built-in ones.

**Running your workflow.** `/maister:run <name>` starts it from the terminal:

```bash
/maister:run onboarding team=payments
/maister:run onboarding "Payments onboarding" team=payments   # with a title of your own
```

It finds the definition by name, validates it and asks for any required input you did not pass
as `key=value`. Then it starts the run in `.maister/tasks/<name>/YYYY-MM-DD-<title>/`, because a
workflow's name is its task folder. From there the run has the same dashboard, gates and resume
as a built-in.

To resume, use `/maister:run <task-path>` or `/maister:work <task-path>`. Both read the workflow's
name from the run, so the folder it sits in does not matter. `--profile` and `--overlay` work here
exactly as they do for a built-in (below).

`/maister:work` also offers your workflow when a task description matches what it is for. It
learns that from the companion's opening paragraph or the definition's `description:` (*Writing
the companion*, above). `/maister:run --list` shows what `/maister:work` will see.

**Where a chain runs.** A definition whose nodes carry `dir:` dispatches work into member
repositories, which makes it a chain — judged after its overlays and profile are applied, so an
overlay that adds a `dir:` node makes one too. A chain is started from the cockpit's Start-a-chain form and
driven there, and `/maister:run` refuses it. Everything else on this page runs in a single project
from the terminal.

## Your own skills and agents as nodes

A node that reads `uses: skill:review` or `uses: agent:inspector` names a skill or an agent by
its bare name, and the engine looks for the file behind that name in four places.

**Resolution order:** the project first, then your own, then this plugin, then the installed plugins — the first hit wins.

| Place | Skills | Agents |
|---|---|---|
| The project | `.claude/skills/<name>/SKILL.md`, or `.github/skills/<name>/SKILL.md` | `.claude/agents/<name>.md`, or `.github/agents/<name>.md` (also `<name>.agent.md`) |
| Your own | `~/.claude/skills/<name>/SKILL.md`, or `~/.copilot/skills/<name>/SKILL.md` | `~/.claude/agents/<name>.md`, or `~/.copilot/agents/<name>.md` (also `<name>.agent.md`) |
| This plugin | its `skills/<name>/SKILL.md` | its `agents/<name>.md` |
| Installed plugins | `skills/<name>/SKILL.md` under each install | `agents/<name>.md` under each install |

The project is whatever the host declares as the project directory, or the directory the workflow
is run from; in a workspace it is the workspace root, so a skill kept beside your chain files is
found first. Both hosts' layouts are searched whatever host is running, so a project opened under
Claude Code and under Copilot CLI resolves the same names.

Your own directories sit above this plugin deliberately. The engine does not perform the lookup
that finally runs a target — it hands the name to the host, and the host resolves it, putting your
own skills ahead of a plugin's. Searching them later here would mean this engine reading a skill's
declaration off one file while the host ran another. So a skill of yours named like one of this
plugin's replaces it everywhere a definition names it bare, which is the point; name the plugin
explicitly, as below, where you mean the plugin's. Installed plugins are found through each
host's own install tree — Claude Code's plugin cache and its index of installs, Copilot CLI's
installed-plugins directory — so a skill from any plugin you have installed is a legal target.

**Naming a plugin explicitly.** When two plugins ship a skill of the same name, or when you want
to be sure which one you mean, write the plugin's name in front of the skill's with one colon:
`uses: skill:acme-tools:review`. A namespaced target is looked for only in the plugin it names,
never in the project; this plugin's own name works the same way. Exactly one colon is allowed in
the name part, and both halves are lower-case letters, digits and dashes starting with a letter —
anything else, including a path, is refused as an error rather than warned about.

**A name found nowhere is a warning, not an error.** The report carries
`unresolved-reference:<node>:<target>`, and the document is accepted, because the environment the
chain will run in may still provide the name — a plugin installed later, a project the file is not
being validated in. The cost is that a typo surfaces when the node is reached rather than at
validation, so read the warnings. To see what *did* resolve, and where, read the report's `resolved`
list: one entry per target, naming the node, the target as written, which of the four places
answered (`project`, `user`, `plugin` or `installed`) and the file it found. A skill you meant to come from
your project that shows up as `plugin` is the shadowing case caught early.

**How the node runs.** The engine hands a `skill:` target to the host's Skill tool and an `agent:`
target to the Task tool, by the name as written. The bare names of this plugin's own skills gain
their plugin prefix at invocation, which is why a definition never writes a provider prefix into a
target: one file stays correct under every variant of the plugin. Your own skills and agents follow
the host's rules for what they may do — a project-local agent has the tools its frontmatter grants,
and a skill runs in the main session with everything that implies.

## Overlays and eject over the built-ins

A workflow is resolved by name against four candidates, first hit winning: an **eject** at
`.maister/workflows/<name>.yml`, a **generated** chain at `.maister/workflows/generated/<name>.yml`,
an **overlay** at `.maister/workflows/<name>.overlay.yml`, then the **built-in** shipped with the
plugin. So `builtin:development` can be replaced or adjusted from inside a project, and the change
takes effect on the next run of `/maister:development`. An overlay needs something to lay itself
over: one whose name has no eject and no built-in behind it is refused, naming the missing base.

**An overlay changes a built-in without copying it.** It carries `extends: builtin:<name>` and up to
three operations, applied in a fixed order after the base: `disable` removes nodes by id, `tune`
adjusts a node's `with` or `provider` — and nothing else, `uses` is immutable by design —
and `add` introduces new nodes with their own `needs`. Named `profiles` let one overlay carry
alternatives, selected by name when the graph is resolved. Every profile is validated whether or not it is
selected, and selecting one that no overlay declares is an error; a definition carries no profiles of its own. The result is validated as a whole, so an overlay that disables
a node another node still needs is an error, never a silent gap. An overlay, or one of its profiles, may also carry a
`display:` block that adds or overrides phase icons and titles — the title of a node it adds, say — without changing the graph.

**A tuned `with` is merged into the node's own, key by key.** A key you name takes your value,
`null` deletes a key, and every key you leave out keeps the value the built-in passes — so a
one-key tune adds one input rather than replacing them all. The merge is one level deep: a key
whose value is a map is replaced as a whole. Deleting a key is also how a later node stops
reading a node you disable:

```yaml
disable: [ui-mockups, mockup-approval]
tune:
  specification: {with: {design_index: null}}
  planning: {with: {design_index: null}}
  e2e-verification: {with: {design_context: null}}
```

**A disabled node stays disabled.** Disabling a node rewires its dependents to wait for whatever it
waited for, so a node added back under the same id would be attached to nothing — a gate that
holds nothing, under the name of the one you removed. `validate` refuses it, whichever overlay or
profile did the disabling. To change what a node receives, `tune` it; to put a different node in
its place, add it under a new id and attach it upstream with `before:` (below).

**`before:` puts an added node upstream of existing ones.** An added node's `needs` say what it
waits for; its `before:` lists the nodes that wait for it, and each of them gains the added node
in its own `needs`. That is how a phase goes *between* two phases and how a verifier holds a gate —
the gate's brief then shows the verifier's summary beside the node the gate closes, and a stop
recommendation among its risks becomes the gate's recommendation:

```yaml
add:
  security-verification:
    uses: agent:security-verifier
    needs: [verification]
    before: [verification-approval]
```

Without `before:`, nothing waits for an added node, so it runs as a side branch wherever the
frozen order happens to put it — ties are broken by id — and no gate waits for it. `validate`
warns about such a node (`added-node-no-dependents`), naming the position it will run at. `before:`
only ever adds a wait: it never removes or reroutes a need the built-in declares, so an overlay
cannot step around a gate with it. It is refused when it names a node the graph does not carry
(one an overlay disabled included), the added node itself, or a node the added node already
needs, which would close a cycle. The graph is the same one an eject declaring those edges by
hand would give, and it hashes the same.

An added node is a full node of the run. Its declared artifacts are registered on its summary
when it completes, its icon and title come from the overlay's `display:` block, and a plan
executor added in place of the built-in's carries the plan's progress on the dashboard.

**The node ids you attach to are a public API.** An overlay names nodes of the built-in —
in `needs`, in `before`, in `disable`, in `tune` — so a rename in a built-in would unresolve every
overlay in every project at once, silently and all on the same upgrade. Renaming one is
therefore a deprecation, not an edit: the old id keeps working alongside the new one for
at least two releases, which is time to move. Two rules follow for you. Attach to ids you
can read in the built-in rather than to positions, and validate after an upgrade — a
definition that resolves is an overlay that still applies.

**An eject copies the built-in into your workspace and shadows it entirely.** Take one when the
change is larger than an overlay expresses well — a different gate, a reordered phase — and keep in
mind that an ejected definition no longer follows the plugin's updates to that workflow. Its prose
companion travels with it: `direct:` nodes in an eject resolve against the `.md` beside the eject,
not against the plugin's copy. An eject also hides any overlay of the same name — the overlay is
never applied — and validation warns `overlay-ignored` when it finds the two side by side.

A generated chain — one the planner published for a single ticket — is complete in itself and is
never overlaid or ejected.

## Making a skill dispatchable

A node carrying `dir:` hands its work to a member repository, where a worker session runs it with
nobody at the keyboard. Only a target that can run unattended is allowed there: a `workflow:` target
always qualifies, because the engine runs it, and a `skill:` target qualifies only when the skill
declares that it honours a driver. Declare it in the skill's frontmatter:

```yaml
---
name: release-runner
description: Cuts and verifies a release without asking in-session.
driver_aware: true
---
```

The plugin's own orchestrators declare the same thing by stating the driver-qualified gate rule in
their body, and both forms are honoured; for a skill of your own, the field is the documented way.
Either way it is the `SKILL.md` that is read, never a file under its `references/` — which is why
the built-in orchestrators keep the gate rule in a body that is otherwise a hand-off, with their
prose phases moved out to `references/<name>-twin.md` (ADR-0023). Move a declaration into a
reference and the skill stops being dispatchable without anything else changing.
The declaration is read off the skill file the resolution order finds — the same file the workspace
validator reads when it judges a `dir:` node, and the same file the dispatch runtime reads when it
builds the worker's envelope — so a skill that resolves and declares the field is a legal dispatch
target everywhere it is checked, and one that does not is refused with the field named in the
recovery.

The field is a promise, and a driver-aware skill must keep four of them:

1. **Record the driver at init.** Read the driver block the run was started under and record it in
   the run's state under `orchestrator.driver` before doing anything else — its `driver.kind` is what
   every later decision branches on.
2. **Never ask in-session under a driver.** When `driver.kind` is absent or `terminal`, gates are
   answered in the session, with a question. When it is `cockpit` or `dispatch`, nobody is there:
   the skill must not ask, and must not treat a session hint to "continue without asking" as an
   answer either.
3. **Suspend at a gate with one `gate-request` call.** That single engine verb writes the request
   file, the gate index and the pending marker together; the skill then prints `GATE-PENDING: <node>`
   and ends its turn. A skill that writes any of those files itself, or writes them in two steps,
   wedges the run at a gate nothing recorded.
4. **Write state only through `write-state`.** Every change to the run's state goes through that
   verb, which validates the patch and keeps the one-line shapes the cockpit and the gate hooks read.
   Editing the state file directly is what the hooks exist to deny.

A skill that asks its questions in the session is a fine skill; it is simply not one to dispatch.
Run it on a node without `dir:`, in the coordinating repository.

## What needs a contract change

The grammar's *shape* is frozen by a compatibility contract that the plugin, the cockpit and the gate
hooks all read, and it changes only by a new contract tag, never by an edit. Inside a project you
cannot add to:

- **The target schemes.** `skill:`, `agent:`, `direct:` and `workflow:` are the four; a fifth is a
  grammar change.
- **The node types.** `type: gate` is the only typed node; everything else is a task node.
- **The gate effects.** An option continues or stops, and a gate offers exactly one continue.
- **The declared value types**, `bool`, `id`, `enum` and `string`.
- **The one-line shapes the cockpit and the gate hooks read.** They are fixed, and naming them is
  the point — a chain of yours consumes them, it does not add to them:
  - the state block a run writes, and the node statuses it may record;
  - the gate marker `GATE-PENDING: <node>`, and the run markers `RUN-COMPLETE`,
    `RUN-FAILED: <reason>` and `WAITING-SUBRUN: <node> run=<child-run-id>`;
  - the five prompt lines a driven run is resumed by — `GATE-ANSWER`, `RE-DRIVE`, `STEER`,
    `RESUME` and `SUB-RUN-DONE`, the last of which wakes a parent whose child run has ended.
    Every one of the five ends with `at=<timestamp>`, the turn's measured time.

  The two sub-run shapes — the `WAITING-SUBRUN` marker and the `SUB-RUN-DONE` line — are fixed by
  the grammar, but the cockpit does not read them yet, and nothing re-drives a parent when its child
  ends. A parent under the cockpit waits until it is woken; a terminal run never hits this, because
  its child runs in the same session.

Say what you need on the issue tracker: these are tracked for a future contract tag, and a request
that names the chain it would unblock is the most useful form. Until then, the reserved keys the
validator warns about — `foreach`, `loop`, `routing.tiers` and their kin — parse, warn and do
nothing, precisely so that a later version can claim them without breaking a file written today.
Every other key the grammar does not define is an error, at every level of a `version: 1` document —
the definition, a node, a gate option, `display:`, an overlay and its profiles — and the error lists
the accepted keys and names the one you probably meant. A misspelt `when:` is refused rather than
quietly dropping the guard.

## Related reading

- [Workflow definition grammar](../plugins/maister/skills/workflow-engine/references/grammar.md)
  — every key, scheme and rule a definition, its companion and an overlay can use.
- [Workflow details](workflows.md) — the built-in definitions, their phases and how they resolve.
- [Command reference](commands.md) — every command, including the workspace verbs.
- [Umbrellas and chain files](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/umbrellas.md)
  — the node shape, a worked example, and the cockpit's dry run.
- The compatibility contracts register, the normative record of every frozen shape, ships with the
  Pro Edition.
