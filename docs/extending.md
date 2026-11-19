# Extending Maister

For people who write workflows of their own, or change a built-in workflow for their project,
without modifying the plugin. Everything on this page works from inside a project: nothing here
asks you to fork the plugin, patch a shipped skill, or wait for a release.

There are three extension points, and one boundary:

| You want to | Do this |
|---|---|
| Run a graph of your own design | Write a workflow definition in `.maister/workflows/` with `direct:` nodes for the steps you describe in prose, and start it with `/maister:run <name>` |
| Use your own skills and agents as steps | Name them from a node; the engine finds them in your project, in your own directories, in the plugin, or in any installed plugin |
| Change a shipped workflow without copying it | Lay an overlay over it, or eject it into your project |
| Change what the grammar can say | That is a contract change — see [What needs a contract change](#what-needs-a-contract-change) |

The grammar is the same one the built-in workflows use, so a definition you write is checked by
the same validator, frozen into a run's state the same way, and run like any built-in, from the
terminal with `/maister:run <name>`. The only thing the plugin keeps closed is the *shape* of
that grammar.

**`/maister:workflow-author` helps you write them.** `new <name>` interviews you and writes the
definition with its companion, giving a section only to a `direct:` step that needs prose.
`overlay <builtin>` shows what a built-in lets an overlay attach to or disable, and then writes
the overlay. `check` validates like `/maister:run --check` and adds checks the validator does not
make, on the skills and agents your nodes call, on prose sections and on code changes. `nodes
<builtin>` lists what an overlay can attach to or disable. `preview` draws the graph in the
terminal with every guard in words. It writes only under `.maister/workflows/` and never starts a
run.

## A first workflow

A workflow of your own is two files in `.maister/workflows/`: the definition, and a prose
companion beside it that says in plain language what each `direct:` step does. This one drafts
release notes, stops for your approval, and then publishes them:

```yaml
# .maister/workflows/release-notes.yml
name: release-notes
version: 1
description: "Drafts release notes from the changes since the last tag, for review before they are published."
inputs:
  version: {type: string, required: true}

nodes:
  draft:
    uses: direct:draft
    needs: []
    with: {version: "${inputs.version}"}
    outputs:
      artifacts: {notes: outputs/release-notes.md}

  approve:
    type: gate
    needs: [draft]
    ask: "Release notes drafted. Publish them?"
    options:
      publish: continue
      revise: {effect: revise, reruns: draft}
      stop: stop

  publish:
    uses: direct:publish
    needs: [approve]
```

The companion opens with a title and one paragraph, then gives each `direct:` step a section
headed with its name:

```markdown
# Release notes

Drafts release notes for a version from the changes since the last tag, and publishes them once
you approve the draft.

## `draft`

**Does.** List the commits since the last tag with `git log <last-tag>..HEAD`. Group them into
features, fixes and other changes, and write one plain sentence for each change a user would
notice. Leave out merges and changes to tests or tooling alone.

**Writes.** The notes open with a `# <version>` heading.

**Re-run.** Keep the sections the note did not mention, and change what it asked for.

## `publish`

**Does.** Prepend the approved notes to `CHANGELOG.md` under the version's heading. Do not
commit, tag or push.
```

Check it, then run it:

```bash
/maister:run release-notes --check
/maister:run release-notes version=3.1.0
```

The check reports no errors and no warnings for these two files, and resolves both `direct:`
steps to their sections in the companion. The run then works like a built-in, with a task
directory under `.maister/tasks/release-notes/`, a dashboard and resume: `draft` writes
`outputs/release-notes.md` in the run's task directory, the `approve` gate asks its question, and
`revise` sends the run back to `draft` with your note.

## Your own workflows

A workflow of your own is a definition the project owns: `.maister/workflows/<name>.yml`, with a
prose companion `.maister/workflows/<name>.md` beside it. A node is one entry under `nodes:`; its
`uses:` names what runs it, in one of four schemes:

| Scheme | What runs |
|---|---|
| `direct:<name>` | The engine itself, following the section of that name in the prose companion, or only the engine's node conventions when there is none |
| `skill:<name>` | A skill, invoked by the host's Skill tool |
| `agent:<name>` | An agent, invoked by the host's Task tool |
| `workflow:<name>` | Another workflow definition, as a child run of its own |

A gate is a node with `type: gate`, a question under `ask:` and its answers under `options:`. At
least one option continues the run, any number revise, and a gate with a single continue offers
at least one stop. Nodes declare their dependencies with `needs:`, their guards with `when:`, and
the values they hand downstream with `outputs:`. A node's `on:` says which endings of its needs
let it run: `success`, the default, needs every one completed or skipped; `failure` runs only
when one of them failed, and is skipped when none did; `always` runs once they have all ended,
however. A guard that reads a value the run itself records may skip a gate only when the gate
merely confirms — one continue, setting nothing and granting nothing; any other gate it guards is
asked whatever the guard reads, and validation warns `skip-guard-not-pure`. Guard a gate that
decides something on an input or on another gate's answer. The definition's `name` is lower-case
letters, digits and dashes, starting with a letter, and matches the file name; `version: 1` is
the bare number, never quoted; and each entry under `inputs:` declares its `type` as `string`,
`bool` or `path`. A declared artifact is a literal path relative to the run's task directory:
`${…}` references belong in `with:` and `ask:`, and one inside an artifact path, or one left
without its closing `}`, is a validation error. Every key, scheme and rule — the full node shape,
gates and guards, inputs and outputs, interpolation, overlays, the companion's heading rule, and
recipes for a child-capable workflow and a fix loop — is in the
[workflow definition grammar](../plugins/maister/skills/workflow-engine/references/grammar.md)
that ships with the plugin. [workflows.md](workflows.md) describes the built-in workflows written
in it, and [workflow-reference.md](workflow-reference.md) lists each one's node ids.

**A `direct:` node is yours entirely.** Its body is the section in the prose companion whose
heading *is* the name after `direct:` — conventionally the node id: `uses: direct:assess-scope`
runs `## assess-scope`, in backticks or bare, at any heading level, never a heading that merely
mentions it. Write what is the step's own — its steps, fan-outs, self-checks and the questions it
asks inline; the engine reads that section before running the node, not after it fails. The
section is optional: a step with nothing of its own to say beyond the engine's node conventions
gets none, and validation resolves it `from: conventions`. The companion file itself is required
— a `direct:` target whose `<name>.md` does not exist is a validation error. Because a renamed
node or a mistyped target would now fall back to the conventions silently, a `` ## `x` `` heading
that no node finds its section by warns `orphan-prose-section`.

**A `workflow:` node starts a child run.** The named workflow gets a task directory of its own —
an ordinary dated one, of its own type, sitting beside the parent's rather than inside it — with
its own frozen graph and its own checkpoints. The node waits while the child runs, takes the
child's outcome as its own, and then exposes the keys the child declares, which a later node reads
as `${<node>.artifacts.<key>}` and `${<node>.values.<key>}`. Not every workflow can be a child:
only one whose definition declares an `embedded` input and an `outputs:` block, which is the next
paragraph.

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
identity, so adding one moves that identity.

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
a run, so a definition that does not validate never becomes one. The grammar's § 14 lists every
warning and what it means.

`/maister:workflow-author check <name>` runs the same check and adds more. It checks that
a skill or agent your project provides is registered under the name the node uses. It flags an
installed plugin's skill named without its plugin, and a workflow that implements a change
without saying `changes_code: true`. It names a step whose `brief:` data has no section to explain
it, a question declared with only one of its two lines, and an orphan heading, with the fix for
each. `check --all` checks every workflow and overlay in the project at once, which is the pass to
run after a plugin upgrade.

**Writing the companion.** The companion `<name>.md` is what makes a definition runnable and
findable:

- **Open it with a `# Title` line and one paragraph** saying what the workflow is for and when to
  use it. `/maister:work` offers your workflow by that paragraph when a task description matches
  it, and `/maister:run --list` shows both. A one-line `description:` in the definition does the
  same job and is preferred when present. A project workflow with neither is valid but warns
  `workflow-undescribed`, because nothing would offer it. There is no `title:` key: the heading is
  the title.
- **Write a section only for a step that needs one**, headed with the name after `direct:`. The
  engine's node conventions already state what every step does — check its declared artifacts,
  record its values, hand a page to the HTML writer, run again in place after a revise, keep the
  summary a gate reads — so a step that only does what its title and the conventions say needs no
  section. One that asks a question, keeps a retry budget or owes its summary a hint gets one.
- **Write the section in the template.** Bold run-in parts, in this order and each only when the
  step has something of its own there: **Does.** what it does; **Asks.** its questions, one
  ``**With question sets** (`id`): …`` and one ``**Without question sets** (`id`): …`` line per
  question at the start of a line, the second saying what it takes when nobody is at the keyboard
  — the one place that default is written;
  **Writes.** what it writes beyond its declared outputs; **Summary.** a hint for its closing
  summary; **Re-run.** what it does after a revise beyond the convention; **Budget.** what each
  further attempt does differently. A gate gets no section unless it carries an **Exception.**;
  `## Embedded mode` is written only where the workflow behaves differently as a child run.
- **Put the step's data in `brief:`.** A top-level `brief:` block, keyed by node id, holds what a
  step reads as data rather than prose: `budget` (the attempts it may make),
  `absent` (an artifact it may leave unwritten, and why) and `recommends` (which continue option a
  gate after it recommends for a value). It sits outside the graph hash, an overlay or profile may
  change one item, and the grammar's § 3.3 has its shape.
- **What a step runs from.** Before each node the run reads the engine's `node-brief` for it: a short
  header, the convention rows that apply, the step's `brief:` data, then its section — or
  `section: none` for a step without one. The `brief:` block and the section are what you write.
- **Declare the HTML companions.** A markdown artifact that people read as a page gets an HTML
  companion beside it when the project's `html_output` setting is on (see
  [configuration.md](configuration.md)). List those artifacts in a top-level `html_companions:`
  block, node id to artifact keys — `html_companions: {research: [report]}` — as the
  [grammar's § 3.2](../plugins/maister/skills/workflow-engine/references/grammar.md) describes.
  The page is the declared path with `.html` in place of `.md`. A definition without the block
  owes nothing, and the block sits outside the graph hash, so adding it moves no frozen run.
- **Hand delegates the run context.** Before every delegate prompt the run fetches the run
  context for the node and pastes it unedited. Its `html:` line carries the style guide's path
  when the node owes a companion and `off` when it does not, and the delegate returns
  `companion: written | disabled | failed | not-requested`. A `direct:` node that writes its own
  markdown hands it to the plugin's `html-companion-writer` agent before its completion write,
  not after. A project agent that owes a companion takes `html:` and returns `companion:` the
  same way. The engine registers each companion as the `html` of its artifact in the node's
  summary, which is what the dashboard links.
- **The engine checks what was declared.** You write no reconciliation of your own. When a
  node completes without a companion it owes, the engine prints
  `companion-missing: <node> <path>`, and the run writes the page once and goes on, without
  re-running the node.

**How a run closes.** Every run ends through the engine, which prints the run's closing marker. A
run recorded `completed` is refused while a node it can still reach has not run: a node still
running, or a pending one whose needs are met and that no false guard keeps off the path. The
refusal names each one. A node a false guard skips is not owed, and neither is one waiting on a
need that failed, unless its `on:` says to run anyway. A gate asked whatever its guard reads
(above) is owed even when its guard is false. Above the marker the engine prints two kinds of
line:

- `missing-artifact: <node> <path>` for each artifact a completed node declared that is not on
  disk;
- `missing-companion: <node> <path>`, when HTML output is on, for each companion the
  `html_companions` block owes that is not on disk, while its markdown is.

Both are warnings for you to read, never a refusal, and the run's wrap-up lists them under what
needs you. A node that legitimately completes without one of its artifacts — say, a report
written only when some input was given — names it in its `brief:` `absent`, and records it on
its summary as `absent: {<artifact-key>: "<reason>"}`. The engine prints neither line for it, and
the dashboard shows the artifact as not produced, with that reason. Both checks read the resolved
graph and the `html_companions` block merged over your overlays and profile, so a node you add is
held to the same rule as the built-in ones.

**Running your workflow.** `/maister:run <name>` starts it from the terminal:

```bash
/maister:run onboarding team=payments
/maister:run onboarding "Payments onboarding" team=payments   # with a title of your own
```

It finds the definition by name, validates it and asks for any required input you did not pass
as `key=value`. Then it starts the run in `.maister/tasks/<name>/YYYY-MM-DD-<title>/`, because a
workflow's name is its task folder. From there the run has the same dashboard, checkpoints and
resume as a built-in.

To resume, use `/maister:run <task-path>` or `/maister:work <task-path>`. Both read the workflow's
name from the run, so the folder it sits in does not matter. `--profile` and `--overlay` work here
exactly as they do for a built-in (below). Every flag is in [commands.md](commands.md).

`/maister:work` also offers your workflow when a task description matches what it is for. It
learns that from a `description:` line in the definition — one line saying what the workflow is
for and when to use it — or, without one, from the paragraph under the `# Title` line of
`<name>.md` (*Writing the companion*, above). The title labels the offer. Validation warns
`workflow-undescribed` when a workflow says neither, and `/maister:run --list` shows what
`/maister:work` will see.

**Saying that it changes code.** A workflow that changes the project's code says so with
`changes_code: true` in its definition; without the line it reads as `false`. This tells whoever
reads the definition what the workflow does. It changes nothing about a run, and the validator
checks only that it is true or false, so `/maister:workflow-author check` is what flags a workflow
that implements a change and doesn't say so. An overlay or a profile that adds code-changing work
to a built-in may write `changes_code: true`, and none may write `false`: to say a workflow no
longer changes code, eject it. The built-ins that carry it are `development`, `migration` and
`performance`.

**Keys this page does not cover.** The grammar also defines `dir:` and `provider` on a node, which
hand the node's work to another repository. `/maister:run` does not start a definition whose
nodes carry `dir:`, whether the definition declares them or an overlay or profile adds them: it
names those nodes and stops. Everything on this page runs in a single project from the terminal.

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
is run from. Both hosts' layouts are searched whatever host is running, so a project opened under
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
workflow will run in may still provide the name — a plugin installed later, a project the file is
not being validated in. The cost is that a typo surfaces when the node is reached rather than at
validation, so read the warnings. To see what *did* resolve, and where, read the report's `resolved`
list: one entry per target, naming the node, the target as written, which of the four places
answered (`project`, `user`, `plugin` or `installed`) and the file it found. A skill you meant to come from
your project that shows up as `plugin` is the shadowing case caught early. A `direct:` target
reads `companion` when its section answered and `conventions` when the step has none.

**How the node runs.** The engine hands a `skill:` target to the host's Skill tool and an `agent:`
target to the Task tool, by the name as written. The bare names of this plugin's own skills gain
their plugin prefix at invocation, which is why a definition never writes a provider prefix into a
target: one file stays correct under every variant of the plugin. Your own skills and agents follow
the host's rules for what they may do — a project-local agent has the tools its frontmatter grants,
and a skill runs in the main session with everything that implies.

## Overlays and eject over the built-ins

A workflow is resolved by name, first hit winning: an **eject** at
`.maister/workflows/<name>.yml`, then an **overlay** at `.maister/workflows/<name>.overlay.yml`
laid over the **built-in** shipped with the plugin, then the built-in alone. So
`builtin:development` can be replaced or adjusted from inside a project, and the change takes
effect on the next run of `/maister:development`. An overlay needs something to lay itself over:
one whose name has no eject and no built-in behind it is refused, naming the missing base.

**Look up the node ids first.** [workflow-reference.md](workflow-reference.md) lists each
built-in's node ids in order, which of them are gates, their guards and the workflow's inputs.
`/maister:workflow-author nodes <builtin>` shows the same surface from inside your project, with
which nodes disable cleanly and which to anchor `before:` on, and folds in an overlay you already
have.

**An overlay changes a built-in without copying it.** It carries `extends: builtin:<name>` and up to
three operations, applied in a fixed order after the base: `disable` removes nodes by id, `tune`
adjusts a node's `with` — `uses` is immutable by design — and `add` introduces new nodes with
their own `needs`. Named `profiles` let one overlay carry alternatives, selected by name with
`--profile`. Every profile is validated whether or not it is selected, and selecting one that no
overlay declares is an error; a definition carries no profiles of its own. The result is
validated as a whole, so an overlay that disables a node another node still needs is an error,
never a silent gap. An overlay, or one of its profiles, may also carry a `display:` block that
adds or overrides phase icons and titles — the title of a node it adds, say — without changing
the graph. The grammar's § 12 lists every key an overlay takes.

This overlay adds a security review to development, between verification and the checkpoint that
approves it:

```yaml
# .maister/workflows/development.overlay.yml
extends: builtin:development
version: 1
add:
  security-review:
    uses: agent:security-review
    needs: [verification]
    before: [verification-approval]
    outputs:
      artifacts: {report: verification/security-review.md}
display:
  titles:
    security-review: Security review
```

With a project agent at `.claude/agents/security-review.md`, `/maister:run development --check`
reports no errors and no warnings, and resolves `agent:security-review` from `project`. Without
the agent file, the same check warns `unresolved-reference:security-review:agent:security-review`.
From then on every `/maister:development` run includes the step.

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
holds nothing, under the name of the one you removed. Validation refuses it, whichever overlay or
profile did the disabling. To change what a node receives, `tune` it; to put a different node in
its place, add it under a new id and attach it upstream with `before:` (below).

**`before:` puts an added node upstream of existing ones.** An added node's `needs` say what it
waits for; its `before:` lists the nodes that wait for it, and each of them gains the added node
in its own `needs`. That is how a phase goes *between* two phases and how a verifier holds a gate,
as in the overlay above — the gate's brief then shows the verifier's summary beside the node the
gate closes, and a stop recommendation among its risks becomes the gate's recommendation.

Without `before:`, nothing waits for an added node, so it runs as a side branch wherever the
frozen order happens to put it — ties are broken by id — and no gate waits for it. Validation
warns about such a node (`added-node-no-dependents`), naming the position it will run at. `before:`
only ever adds a wait: it never removes or reroutes a need the built-in declares, so an overlay
cannot step around a gate with it. It is refused when it names a node the graph does not carry
(one an overlay disabled included), the added node itself, or a node the added node already
needs, which would close a cycle. The graph is the same one an eject declaring those edges by
hand would give, and it hashes the same.

An added node is a full node of the run. Its declared artifacts are registered on its summary
when it completes, its icon and title come from the overlay's `display:` block, and a plan
executor added in place of the built-in's carries the plan's progress on the dashboard.

**The node ids you attach to are your contract with the built-in.** An overlay names nodes of the
built-in — in `needs`, in `before`, in `disable`, in `tune` — so attach to ids you can read in the
built-in rather than to positions, and validate again after every plugin upgrade: a definition
that resolves is an overlay that still applies. `/maister:workflow-author check --all` checks
every overlay in the project at once.

**An eject copies the built-in into your project and shadows it entirely.** Take one when the
change is larger than an overlay expresses well — a different gate, a reordered phase — and keep in
mind that an ejected definition no longer follows the plugin's updates to that workflow. Its prose
companion travels with it: `direct:` nodes in an eject resolve against the `.md` beside the eject,
not against the plugin's copy. An eject also hides any overlay of the same name — the overlay is
never applied — and validation warns `overlay-ignored` when it finds the two side by side.

**Overlay or eject, in one line each.** An overlay can disable a node, tune its `with`, add a node
with `needs` and `before:`, carry profiles, retitle and raise `changes_code` to true. Only an
eject can change what runs a node, reword a gate or change its options, change a guard or a node's
`needs`, or reorder phases. `/maister:workflow-author overlay <builtin>` routes each change to the
operation that does it, or says that it needs an eject.

## What needs a contract change

The grammar's *shape* is fixed: it changes only in a plugin release, never by a project's edit.
Inside a project you cannot add to:

- **The target schemes.** `skill:`, `agent:`, `direct:` and `workflow:` are the four; a fifth is a
  grammar change.
- **The node types.** `type: gate` is the only typed node; everything else is a task node.
- **The gate effects.** An option continues, stops or revises. A revise sends the run back to a
  node before the gate; each gate allows up to ten revisions, a safety ceiling against a runaway
  loop, after which the option is no longer offered.
- **The declared value types**, `bool`, `id`, `enum` and `string`.

Say what you need on the issue tracker: these are tracked for a future grammar version, and a
request that names the workflow it would unblock is the most useful form. Until then, the reserved
keys the validator warns about — `foreach`, `loop`, `routing.tiers` and their kin — parse, warn
and do nothing, precisely so that a later version can claim them without breaking a file written
today. Every other key the grammar does not define is an error, at every level of a `version: 1`
document — the definition, a node, a gate option, `display:`, an overlay and its profiles — and
the error lists the accepted keys and names the one you probably meant. A misspelt `when:` is
refused rather than quietly dropping the guard.

## The interface file

A tool that pins a commit of the plugin — a dashboard, a validator, a script that reads run
state — can read what that commit offers from one file instead of keeping its own list:
`interface.json` at the plugin's root (`plugins/maister/interface.json`). The GitHub Copilot build
carries its own, because its hooks and tool names are that host's: `copilot/interface.json` on the
`dist/stable` and `dist/beta` branches. Diff it between two pins to see what changed.

It lists the agents, skills and commands the plugin ships, its hooks, the MCP tool names it calls,
the built-in workflows, the engine's verbs with their flags and the refusal codes each can raise,
the state file's schema version with the keys and statuses the engine writes, and the shapes of a
checkpoint and a gate request. It is generated from the plugin's code at build time and never
edited by hand.

**Versioning.** `interface_version` is `MAJOR.MINOR`, worked out by the build against the file it
replaces. An additive change — a new key, verb, flag, refusal, name or value — raises the minor. A
changed type, required flag or value, or anything removed, raises the major. A reader that accepts
any key the file declares needs nothing new for a minor step; a major step is the one to look at.

## Related reading

- [Workflow definition grammar](../plugins/maister/skills/workflow-engine/references/grammar.md)
  — every key, scheme and rule a definition, its companion and an overlay can use.
- [Built-in workflow reference](workflow-reference.md) — each built-in's node ids, gates, guards
  and inputs.
- [Workflow details](workflows.md) — the built-in workflows, their steps and checkpoints.
- [Command reference](commands.md) — every command and flag, including `/maister:run` and
  `/maister:workflow-author`.
- [Troubleshooting](troubleshooting.md) — what to do when a workflow of your own fails validation.
