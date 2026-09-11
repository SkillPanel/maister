# Extending maister

Maister is built to be extended by people who cannot, or would rather not, modify the plugin.
Everything on this page works from inside a project or an umbrella workspace: nothing here asks
you to fork the plugin, patch a shipped skill, or wait for a release.

There are three extension points, and one boundary:

| You want to | Do this |
|---|---|
| Run a graph of your own design | Write a chain file — a workflow definition in `.maister/workflows/` — with `direct:` nodes for the steps you describe in prose |
| Use your own skills and agents as steps | Name them from a node; the engine finds them in your project, in the plugin, or in any installed plugin |
| Change a shipped workflow without copying it | Lay an overlay over it, or eject it into your workspace |
| Change what the grammar can say | That is a contract change — see the last section |

The grammar itself is the same one the built-in workflows use, so a definition you write is checked
by the same validator, frozen into a run's state the same way, and driven by the cockpit like any
built-in. The only surface the plugin keeps closed is the *shape* of that grammar.

## Your own chains

A chain file is a workflow definition the workspace owns: `.maister/workflows/<name>.yml`, with a
prose companion `.maister/workflows/<name>.md` beside it. A node is one entry under `nodes:`; its
`uses:` names what runs it, in one of four schemes:

| Scheme | What runs |
|---|---|
| `direct:<name>` | The engine itself, following the section of that name in the prose companion |
| `skill:<name>` | A skill, invoked by the host's Skill tool |
| `agent:<name>` | An agent, invoked by the host's Task tool |
| `workflow:<name>` | Another workflow definition — dispatched into a member when the node carries `dir:` |

A gate is a node with `type: gate`, a question under `ask:` and its answers under `options:`,
exactly one of which continues the run and at least one of which stops it. Nodes declare their
dependencies with `needs:`, their guards with `when:`, and the values they hand downstream with
`outputs:`. The full node shape, the `dir:` and `provider:` keys and a worked example are in the
cockpit's [umbrellas and chain files](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/umbrellas.md)
page; [workflows.md](workflows.md) describes the built-in definitions this grammar ships with.

**A `direct:` node is yours entirely.** Its body is the section in the prose companion whose
heading *is* the node id — `## assess-scope`, in backticks or bare, never a heading that merely
mentions it. Write the steps, the fan-outs, the self-checks and the questions the step asks inline;
the engine reads that section before running the node, not after it fails. A `direct:` target with
no section is a validation error, because the companion is the one reference a definition fully
controls.

**Validate before you run.** `/maister:umbrella validate --definition .maister/workflows/<name>.yml`
parses the file, checks ids and the graph, resolves every target, checks gate shape and — in a
workspace — checks every `dir:` against the members the manifest declares. Errors name the file,
the node and the field. Warnings never block.

**Where a chain runs.** A chain with a name of its own is started from the cockpit's Start-a-chain
form and driven there; a single project outside a workspace runs the built-in workflows through
their commands, and extends them through overlays and eject (below). Shorter than writing a chain by
hand: describe the work to `/maister:chain-planner` and review what it writes.

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
takes effect on the next run of `/maister:development`.

**An overlay changes a built-in without copying it.** It carries `extends: builtin:<name>` and up to
three operations, applied in a fixed order after the base: `disable` removes nodes by id, `tune`
adjusts a node's `with`, `optional` or `provider` — and nothing else, `uses` is immutable by design —
and `add` introduces new nodes with their own `needs`. Named `profiles` let one overlay carry
alternatives, selected by name when the graph is resolved. The result is validated as a whole, so an overlay that disables
a node another node still needs is an error, never a silent gap.

**The node ids you attach to are a public API.** An overlay names nodes of the built-in —
in `needs`, in `disable`, in `tune` — so a rename in a built-in would unresolve every
overlay in every project at once, silently and all on the same upgrade. Renaming one is
therefore a deprecation, not an edit: the old id keeps working alongside the new one for
at least two releases, which is time to move. Two rules follow for you. Attach to ids you
can read in the built-in rather than to positions, and validate after an upgrade — a
definition that resolves is an overlay that still applies.

**An eject copies the built-in into your workspace and shadows it entirely.** Take one when the
change is larger than an overlay expresses well — a different gate, a reordered phase — and keep in
mind that an ejected definition no longer follows the plugin's updates to that workflow. Its prose
companion travels with it: `direct:` nodes in an eject resolve against the `.md` beside the eject,
not against the plugin's copy.

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

## What the planner will and will not generate

`/maister:chain-planner` writes a chain from a description of the work and the workspace's manifest,
proves it with the same validator you would run, and publishes the definition, its prose companion
and a plan file that explains every node. It is bounded on purpose:

- **It authors only what the grammar has.** Explicit nodes, one per known target, each behind its
  own guard. Work that needs fan-out over a set discovered at run time, a branch chosen while the
  run is going, or a repeat-until is refused with what the shape would have to be instead.
- **It offers dispatch targets it discovered.** Which skills can be dispatched is read off the skill
  files by the rule above, through the same resolution order — so a skill of your own that declares
  `driver_aware: true` is offered where a `dir:` node needs a target, and one that does not is
  never emitted there.
- **It refuses a name a built-in already uses**, because a workspace definition of that name would
  shadow the built-in wherever the built-in is named.
- **It starts nothing.** Review the plan file, run the dry run in the cockpit, then start the chain.

Anything the planner refuses, you can still write by hand — provided the grammar can say it.

## What needs a contract change

The grammar's *shape* is frozen by a compatibility contract that the plugin, the cockpit and the gate
hooks all read, and it changes only by a new contract tag, never by an edit. Inside a project you
cannot add to:

- **The target schemes.** `skill:`, `agent:`, `direct:` and `workflow:` are the four; a fifth is a
  grammar change.
- **The node types.** `type: gate` is the only typed node; everything else is a task node.
- **The gate effects.** An option continues or stops, and a gate offers exactly one continue.
- **The declared value types**, `bool`, `id`, `enum` and `string`, and the one-line shapes of the
  state block, the gate marker and the prompt lines the cockpit composes.

Say what you need on the issue tracker: these are tracked for a future contract tag, and a request
that names the chain it would unblock is the most useful form. Until then, the reserved keys the
validator warns about — `foreach`, `loop`, `routing.tiers` and their kin — parse, warn and do
nothing, precisely so that a later version can claim them without breaking a file written today.

## Related reading

- [Workflow details](workflows.md) — the built-in definitions, their phases and how they resolve.
- [Command reference](commands.md) — every command, including the workspace verbs.
- [Umbrellas and chain files](https://github.com/SkillPanel/maister-cockpit/blob/main/docs/umbrellas.md)
  — the node shape, a worked example, and the cockpit's dry run.
- [Compatibility contracts](../plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md)
  — the register of every frozen shape, for when you need the exact rule.
