# Workflow definition grammar

The grammar a workflow definition, its prose companion and its overlays are written in —
version 1. The built-in workflows beside this skill are written in it, and so is every workflow
a project keeps in `.maister/workflows/`. A definition says which nodes exist, what each one
needs, what guards it, what it runs and what it declares. The companion says how each `direct:`
node does its work. Everything below is enforced by the same validator the engine runs before it
freezes a run, so `/maister-copilot:run <name> --check` (§ 14) is the way to find out whether a file says
what you meant.

A version 1 document is **closed**. A key the grammar does not define is an error at every level
— the definition, a node, a gate option, `display:`, an overlay and its profiles — and the error
names the accepted keys and the one you probably meant. Only the reserved keys of § 10 are exempt.
Each table below that lists a closed vocabulary is checked against the validator's own list by
the plugin's test suite, so the table and the code cannot disagree.

---

## 1. Files, names and where they live

| File | What it is |
|---|---|
| `.maister/workflows/<name>.yml` | A definition: a workflow of your own, or an **eject** — a copy of the built-in of that name, which shadows it entirely |
| `.maister/workflows/<name>.md` | Its prose companion (§ 11) |
| `.maister/workflows/<name>.overlay.yml` | An **overlay** of the definition named `<name>`, applied whenever that name runs (§ 12) |
| `.maister/workflows/<name>.overlay.md` | The overlay's companion: the sections of `direct:` nodes the overlay adds |
| `.maister/workflows/generated/<name>.yml` | A generated chain, published by the chain planner for one ticket — never written by hand, never overlaid |

A name is looked up in one order, first hit winning: the eject, then the generated chain, then the
overlay laid over the built-in, then the built-in. An overlay beside an eject or a generated chain
of its name is **never applied**, and validation warns `overlay-ignored`. An overlay needs a base:
one whose name has no definition to lay it over — no eject and no built-in — is refused, naming
the missing base. An extra overlay passed with `--overlay` may be named anything; its companion
is the same path with `.md`.

**A chain is a definition with a node carrying `dir:`**, judged on the folded graph — base,
overlays and profile — so an overlay that adds a `dir:` node turns the workflow into a chain.
Chains dispatch into member repositories and are started from maister cockpit, never from
`/maister-copilot:run`.

**The file name and `name:` agree.** A run is looked up, stored and resumed under the workflow's
name — its runs live in `.maister/tasks/<name>/` — so a file whose `name:` says something else
is refused by the lookup.

## 2. The YAML subset

The reader is small and strict: it accepts what a definition needs and refuses the rest with a
located `line N:` error rather than guessing.

**Accepted:** block maps and block sequences; flow maps `{a: 1}` and flow sequences `[a, b]` on
one line; bare, single-quoted and double-quoted scalars; full-line and inline comments (an inline
`#` counts after whitespace, outside quotes and brackets); `- key: value` opening a map on the
dash line; CRLF line endings. `null` and `~` are null, `true` and `false` are booleans, a bare
number is a number, and every other bare word — `yes`, `on`, `off` included — is a string.

**Refused:** anchors and aliases (`&`, `*`); block scalars (`|`, `>`); tags (`!`) — which is why
a negated guard is quoted, `when: "!${inputs.embedded}"`; multiple documents (`---`, `...`);
tab indentation; duplicate keys; a flow collection or a quoted scalar spanning lines; a
double-quoted escape other than `\n \t \r \\ \" \/`. A decoded newline, carriage return or tab
is refused in any node value.

**`version: 1`**, written as the bare number. A quoted, fractional or zero version is a
misspelling and an error. A whole number above 1 declares a newer grammar: every verb degrades on
it the same way — it checks the structure and the `needs` cycle, reports `newer-format`, and
judges nothing else — so a newer definition in a mixed fleet is a diagnostic, not a dead run.

## 3. The definition

<!-- vocabulary: DEFINITION_KEYS -->
| Key | Required | Shape |
|---|---|---|
| `name` | yes | Lower-case letters, digits and dashes, starting with a letter; the file's name without `.yml` |
| `version` | yes | `1` |
| `description` | no | One line of plain text: what the workflow is for and when to use it. `/maister-copilot:work` offers the workflow by it, ahead of the companion's first paragraph. Outside the recorded identity |
| `inputs` | no | Input name → declaration (§ 8.1) |
| `outputs` | no | What a parent run may read when this workflow runs as its child (§ 8.3) |
| `display` | no | Icons, titles, option labels and gate headers for the dashboard and the gate question (§ 3.1) |
| `nodes` | yes | Node id → node (§ 4) |

`profiles:` is not a definition key: profiles belong to an overlay, and a definition's own are
refused rather than silently ignored. Nor is there a `title:` key: a workflow's title is its
companion's `# Title` line (§ 11).

### 3.1 `display`

<!-- vocabulary: DISPLAY_KEYS -->
| Key | Shape |
|---|---|
| `icons` | Node id → one icon hint from the table below |
| `titles` | Node id → a one-line title; a node without one is shown as its id in title case |
| `option_labels` | Gate id → option id → a one-line label the operator picks; an option without one is shown as its id in sentence case. A continue option labelled `Continue` alone — or with no label, an option id of `continue` — is completed with where the run actually goes once guards are read ("Continue to implementation planning", "Finish the run"), so a gate whose next step a guard decides never names two destinations. The recorded answer is still the option id |
| `headers` | Gate id → a one-line chip of at most 12 characters shown above the gate's question; without one, the title of the node the gate closes when it fits |

<!-- vocabulary: ICON_HINTS -->
| Icon hint | Reads as |
|---|---|
| `analysis` | Gathering or analysing |
| `spec` | Specifying |
| `plan` | Planning |
| `code` | Implementing |
| `verify` | Verifying |
| `docs` | Writing documentation |
| `done` | Closing out |

A hint or a title for a node the graph does not carry warns rather than errors, and so does a
label or a header for a node that is not a gate, or a label for an option its gate does not
offer. `display:` is outside the recorded identity, so retitling a node or relabelling an option
never invalidates a frozen run. Overlays and profiles may carry their own `display:` block; the
later one wins, key by key, and option labels option by option.

## 4. Nodes

A node is one entry under `nodes:`. Its **id** is the map key: lower-case letters, digits and
dashes, starting with a letter, two to forty-one characters. Ids reach file names, markers and
state, which is why the set is closed. An `id:` written inside a node is refused.

<!-- vocabulary: NODE_KEYS -->
| Key | On | Meaning |
|---|---|---|
| `id` | — | The map key the node is written under; never a key inside the node |
| `uses` | task | What runs the node, as `<scheme>:<name>` (§ 5). A gate may not carry it |
| `needs` | both | The node ids this one waits for. Absent or empty makes it a root |
| `when` | both | A guard: one reference, optionally negated (§ 7) |
| `with` | task | Free-form context handed to whatever runs the node; may interpolate (§ 9) |
| `outputs` | task | The artifacts and values the node declares (§ 8.2). A gate may not carry it |
| `type` | gate | `gate` — the only node type; everything else is a task node |
| `ask` | gate | The question the gate asks; may interpolate. A task node may not carry it |
| `options` | gate | The gate's answers and their effects (§ 6). A task node may not carry it |
| `on` | both | Which endings of the node's needs let it run (§ 7) |
| `dir` | task | A member repository this node dispatches into, which makes the definition a chain; may interpolate |
| `provider` | task | The host a dispatched node's worker runs on, `claude` or `copilot`; only on a node that carries `dir:` |

**Order.** Execution follows the ready set, not the file. Among nodes ready at once, the frozen
order breaks the tie by id, and the order `needs` lists its entries in carries no meaning. A cycle
in `needs` is an error that prints the cycle.

## 5. What runs a node: `uses`

<!-- vocabulary: SCHEMES -->
| Scheme | Written | What runs |
|---|---|---|
| `skill` | `skill:<name>` or `skill:<plugin>:<name>` | A skill, through the host's Skill tool |
| `agent` | `agent:<name>` or `agent:<plugin>:<name>` | An agent, through the host's Task tool |
| `direct` | `direct:<name>` | The engine itself, following the companion section named `<name>` (§ 11) |
| `workflow` | `workflow:<name>` or `workflow:builtin:<name>` | Another workflow: a child run of its own, or — with `dir:` — a dispatch into a member repository |

A name is lower-case letters, digits and dashes, starting with a letter. A skill or an agent may
name the plugin that ships it with one colon; anything else — a path, a second colon, a scheme
inside the name — is an error. Target names are bare: the plugin prefix a host needs is added
at invocation, so one definition stays correct under every variant of the plugin.

### 5.1 Executor resolution for `skill:` and `agent:`

A bare name is looked for in four tiers, in this order, and the first hit wins:

<!-- vocabulary: RESOLUTION_ORDER -->
| Tier | Skills | Agents |
|---|---|---|
| `project` | `.claude/skills/<name>/SKILL.md`, then `.github/skills/<name>/SKILL.md` | `.claude/agents/<name>.md`, then `.github/agents/<name>.md` (also `<name>.agent.md`) |
| `user` | `~/.claude/skills/<name>/SKILL.md` (or under `CLAUDE_CONFIG_DIR`), then `~/.copilot/skills/<name>/SKILL.md` | the same homes' `agents/<name>.md` (also `<name>.agent.md`) |
| `plugin` | this plugin's `skills/<name>/SKILL.md` | this plugin's `agents/<name>.md` |
| `installed` | `skills/<name>/SKILL.md` under every other installed plugin — Claude Code's plugin cache and install index, Copilot CLI's installed-plugins directory | `agents/<name>.md` under each |

The project is the directory the host declares, else the one the run starts in; in a workspace it
is the workspace root. Both hosts' layouts are searched whatever host is running.

- **Shadowing.** Your project's and your own skills sit above this plugin's on purpose, because
  the host resolves them that way when it finally runs the node. A skill of yours named like one
  of this plugin's replaces it wherever a definition names it bare.
- **Namespacing.** `skill:acme-tools:review` is looked for only in the plugin named `acme-tools`
  — this plugin under its own name included — and never in the project or user tiers. Name the
  plugin when two ship the same name, or when you mean the plugin's and not a shadow.
- **Not found** is a warning, `unresolved-reference:<node>:<target>`, not an error: a plugin
  installed later or the project the chain runs in may still provide it. A typo therefore
  surfaces only when the node is reached — read the warnings.
- **What resolved, and where.** The check's `resolved` list names each target and the tier that
  answered it — `project`, `user`, `plugin` or `installed`, and `companion` for a `direct:`
  section. A target you meant to come from your project that answers `plugin` is the shadowing
  case caught early.

A node that carries `dir:` is stricter: its target must resolve and must be able to run with
nobody at the keyboard. The workspace validator judges that: a `workflow:` target always
qualifies, because the engine runs it, and a `skill:` target qualifies only when its `SKILL.md`
frontmatter declares `driver_aware: true`.

### 5.2 `workflow:` targets

A `workflow:` target resolves by the lookup of § 1. **Without `dir:`** it starts a child run — its
own task directory beside this run's, its own frozen graph — and the node waits for it and adopts
its outcome (§ 13.1). **With `dir:`** it keeps its dispatch meaning and hands the work to a member
repository instead. One key tells the two apart, and a node cannot do both. A target found nowhere
warns, as above.

## 6. Gates

A gate is a node with `type: gate`. It runs nothing, asks one question, and records the answer as
the option id the operator chose. It must carry `ask` and `options`, and may not carry `uses` or
`outputs`.

```yaml
spec-approval:
  type: gate
  needs: [specification]
  ask: "The specification is ready. Continue to planning?"
  options:
    approve: continue
    revise-spec: {effect: revise, reruns: specification}
    abandon: stop
```

An option is written either as its bare effect or as a map. The map carries the effect, on a
revise option only `reruns`, and on the continue option only `grants`; `approve: continue` and
`approve: {effect: continue}` mean the same.

<!-- vocabulary: OPTION_KEYS -->
| Option key | Meaning |
|---|---|
| `effect` | what the option does — one of the effects below |
| `reruns` | a revise option's target: the task node the run is sent back to |
| `grants` | the continue option's list of what answering it authorises beyond the run — names from the closed set below |

<!-- vocabulary: OPTION_EFFECTS -->
| Effect | What the answer does |
|---|---|
| `continue` | the run goes on past the gate |
| `stop` | the run ends here; nothing downstream becomes ready |
| `revise` | the stretch from `reruns` to the gate runs again, with the operator's note, and the gate is asked again |

**The gate rule:** exactly one option continues, at least one stops, and any number revise. An
option id is lower-case letters, digits and dashes, starting with a letter. A continue or a stop
routes nowhere and emits nothing: what happens next is decided by the graph and the guards, and the
gate brief's `Next:` line names the node that actually runs. Under the default `on:`, nothing
downstream of a stopped gate ever becomes ready, which is what makes a stop end the run.

**A revise option is the one way back, and it is bounded.** Its `reruns` names a task node the gate
waits on — inside its `needs` closure, never a gate, never a `workflow:` node. Choosing it resets
the *stretch*: the `reruns` node, the gate, and every node between them — each node that waits on
`reruns` and that the gate waits on. A side branch off `reruns` the gate does not wait on is left
alone, and so is everything downstream of the gate. The reset nodes run again in the usual order,
an earlier gate inside the stretch is asked again, and so is this one. The edge lives on the
option, not in `needs`, so the graph stays acyclic and the ready set is computed exactly as before.

- **Ceiling.** Each gate allows up to ten revisions — a safety ceiling against a runaway loop, not
  a budget on the user; the engine counts them, and at the ceiling the option is no longer offered.
  A revise from a later gate that resets an earlier one counts at the earlier gate too, because
  that gate is asked again.
- **Sub-runs.** A stretch that holds a `workflow:` node is refused: the child run it started is
  already finished, and running the node again would adopt it rather than run it anew.
- **The note.** The operator's reason travels with the answer, and the re-run node reads it from
  the prior context. The node prose of a `reruns` target says how it re-runs over its own earlier
  output (§ 11).

**A continue option may declare what its answer grants.** Approving a plan can also mean "push
the branch and open the pull request", and the option says so, so the operator approves both with
one answer and is not asked a second time:

```yaml
    options:
      approve: {effect: continue, grants: [push, pr-create]}
      stop-after-plan: stop
```

<!-- vocabulary: OPTION_GRANTS -->
| Grant | What answering the option authorises |
|---|---|
| `push` | pushing the run's own branch |
| `pr-create` | opening a pull request from it; never merging one |

`grants` is a non-empty list, each name once, on the continue option only — a stop ends the run
and a revise asks the gate again, so no node after either answer would act on it. The engine
itself grants no permission and pushes nothing. It shows the grant wherever the gate is shown, in
the option's label and in the checkpoint, and that makes the answer an informed approval. A
driver that delivers the answer registers the grant for the worker. The node prose after the
gate does the push and opens the pull request, and asks nothing more. The grants are part of the
graph's identity, in the closed set's order, so adopting one moves the definition's hash.

When the question needs a value from earlier in the run, interpolate it into `ask` (§ 9). The
gate brief — the closing node's summary, decisions, risks and a recommended option — is rendered
beside the question by the engine; the node prose feeds it through its summary (engine § Gates).

## 7. Guards, `on:` and the ready set

A node is ready when every need is satisfied, its `on:` allows it, and its guard is true. A node
whose guard is false is recorded `skipped`, and **a skip satisfies everything downstream** — that
is how an optional stretch is written without any routing construct.

**`when`** is exactly one reference, optionally negated with a leading `!`, quoted:

| Form | Reads |
|---|---|
| `"${inputs.<name>}"` | A declared input of type `bool`: its value, else its default, else false |
| `"${<node>.values.<key>}"` | A `bool` value declared by a node inside this node's `needs` closure |

There is no expression language: no `and`, no comparison, no enum test, no artifact, and no gate
answer. A guard on a node that did not complete — skipped, failed or stopped — reads false, and
so does a guard on a gate. A completed node that never recorded the value is a defect the gate
brief refuses to paper over. The closing gate of a guarded stretch repeats the stretch's guard,
because an unguarded gate would fire for a stretch that never ran.

<!-- vocabulary: ON_VALUES -->
| `on` | The node runs when |
|---|---|
| `success` | The default: every need completed or was skipped |
| `failure` | Every need has ended and at least one failed or stopped; when all ended well, the node is skipped |
| `always` | Every need has ended, however it ended |

A node waiting on a failed need never runs unless its `on:` says to. A child run still going
satisfies no need, not even under `always`.

## 8. Inputs and outputs

### 8.1 Inputs

```yaml
inputs:
  release: {type: string, required: true, tracker_key: true}
  strict:  {type: bool, required: false, default: false}
```

<!-- vocabulary: INPUT_KEYS -->
| Attribute | Meaning |
|---|---|
| `type` | One of the input types below |
| `required` | `true` makes the run refuse to start without a value or a default |
| `default` | The value used when none is given |
| `tracker_key` | `true` on at most one `string` input: its value is the ticket the run starts from, recorded as the run's key |

These four are the whole set; any other attribute is an error.

<!-- vocabulary: INPUT_TYPES -->
| Type | Takes |
|---|---|
| `string` | Free text |
| `bool` | `true` or `false`, nothing else |
| `path` | A path, relative to the project root |

An input named `embedded` has one meaning: the engine sets it when this workflow runs as a child
(§ 13.1). An operator never passes it.

### 8.2 Node outputs

<!-- vocabulary: OUTPUT_KINDS -->
| Kind | Maps |
|---|---|
| `artifacts` | A name → the path the node writes, relative to the run's task directory |
| `values` | A name → the type of a short value the node records in state |

An artifact path is **literal** and stays inside the run's task directory: no `${…}`, no absolute
path (a leading `/` or `\`, or a drive letter such as `C:`), no `..` segment. It may name a file or
a directory.
A node that does not produce a declared artifact has not completed — unless its prose sanctions
the absence by name, and the node then records it on its summary under `absent`, keyed by the
artifact's declared key (engine § *Recording an outcome*).

| Value type | Recorded as |
|---|---|
| `bool` | `true` or `false` |
| `id` | A short identifier-like string |
| `{enum: [a, b, c]}` | One of the listed strings; the map carries `enum` and nothing else |
| `string` | Free text. Warns `undecidable-value-type`, because free text is not provably safe on the one-line shapes state carries |

A skipped node records its bools false and its strings and enums null. A value a later guard
reads must be a `bool`, declared here — a gate records no values.

### 8.3 The workflow's own `outputs:` — what a parent may read

```yaml
outputs:
  artifacts:
    report: research-foundation.artifacts.report
  values:
    conclusions: research-foundation.values.conclusions
```

Each entry maps an exposed key to exactly one node output, `<node>.<kind>.<key>`, with the kind
matching the block it sits in. A value entry inherits its node's declared type. An entry naming a
node or an output the definition does not declare is an error. One whose node an overlay or a
profile disables warns `exposed-output-disabled` and is dropped. The block is read from the base
definition only and is part of the recorded identity: adding one changes the definition's
`graph_hash`, by design.

## 9. Interpolation

`${…}` is substituted in three keys only — `with`, `dir` and `ask` — however deeply nested inside
`with`. Every reference is one of:

| Reference | Is |
|---|---|
| `${inputs.<name>}` | A declared input |
| `${<node>.values.<key>}` | A value a node declares |
| `${<node>.artifacts.<key>}` | An artifact a node declares |

The node must be inside the referencing node's `needs` closure — reachable through `needs`,
transitively — because nothing else has run by then. A reference to anything else, a reference
outside the closure, and a `${` that never closes are all errors. There is nothing to substitute
in an artifact path, a `when` (which has its own form) or `uses`.

How the engine substitutes, including what a skipped node's value becomes and how a child run's
outputs are joined back, is engine § *Interpolating `${…}`*. The rule an author needs from it:
a string that is exactly one reference takes the value as it is, while a reference inside longer
text becomes text and a null becomes empty. **Do not interpolate a value a skipped node may have
left null** into a node that still runs — have that node's prose read the value from state
instead, where its absence is visible.

## 10. Reserved and retired keys

These keys are reserved for a later version of the grammar. They parse, warn `reserved-key:<key>`
and do nothing, so a later version can claim them without breaking a file written today — and a
node named after one warns too.

<!-- vocabulary: RESERVED_PATHS -->
| Reserved | At |
|---|---|
| `foreach` | Any level |
| `loop` | Any level |
| `assertions` | Any level |
| `validation` | Any level |
| `session.substrate` | Any level |
| `mirror.scope` | Any level |
| `backing` | Any level |
| `routing.tiers` | Any level |

These keys were accepted by an earlier grammar and are errors now, each with the fix in its
message rather than a did-you-mean:

<!-- vocabulary: RETIRED_NODE_KEYS RETIRED_OPTION_KEYS -->
| Retired | Was | Now |
|---|---|---|
| `optional` | A node key | It never changed how a run behaved. Remove it |
| `values` | A gate option key | An option emits no values; declare a value a later guard reads on a task node |

## 11. The prose companion

A `direct:` node is the engine following the companion section named after its target. The
section is found by its heading:

- a heading at any level whose text, backticks removed, **equals the name after `direct:`** —
  `## assess-scope` and ``## `assess-scope` `` both match `direct:assess-scope`, while
  `## Notes on assess-scope` does not. By convention the name is the node id;
- the companion is `<name>.md` beside the definition, or, for a node an overlay adds, the
  `.md` beside that overlay;
- a line inside a fenced code block that starts with `#` is read as a heading too, so keep such a
  line out of a fence;
- a `direct:` target with no section is an error, because the companion is the one reference a
  definition fully controls.

**The section is the node's body.** It holds the steps, the fan-outs, the self-checks, the
questions the node asks inline and the default each question takes when nobody can be asked, what
the node writes into its closing summary for the gate brief, and its recovery budget. The engine
reads it before running the node, not after it fails. Recovery budgets live here and never in
`with:`, where they would be inert data.

**A node a revise option names says how it runs again.** Its section carries a paragraph headed
*When re-run after a revise*: read the note from the prior context, revise its own artifacts in
place rather than start over, keep the answers it already has unless the note reopens them, record
its declared values again (a revise clears them), and say in the summary what changed. Without it
the node repeats its first attempt, or skips work because its artifacts already exist.

**The top of the companion introduces the workflow.** Its `# Title` line is the workflow's title,
and its first paragraph is the summary `/maister-copilot:run --list` shows and `/maister-copilot:work` offers the
workflow by — unless the definition carries a `description:`, which is preferred. A project
workflow with neither warns `workflow-undescribed`, because `/maister-copilot:work` has nothing to match
a task against. A companion also carries an `## Embedded mode` section saying whether the
workflow can run as a child (§ 13.1).

## 12. Overlays

An overlay changes a definition without copying it. It is applied in a fixed order, and the
result is validated as a whole: an overlay that breaks the graph is an error, never a silent gap.

<!-- vocabulary: OVERLAY_KEYS -->
| Key | Meaning |
|---|---|
| `extends` | Required. The definition it applies to: `builtin:<name>`, a bare name equal to the definition's `name:`, or a relative path to a `.yml` |
| `version` | `1` |
| `disable` | Node ids to remove |
| `tune` | Node id → changes to that node's tunable keys |
| `add` | Node id → a new node |
| `profiles` | Profile name → an alternative set of operations, applied only when selected |
| `display` | Icons, titles, option labels and headers, including for added nodes (§ 3.1) |

**Fold order:** the base, then for each overlay in order its `disable`, its `tune`, its `add`;
then the selected profile's `disable`, `tune` and `add`. Validation reads the graph that results.

**`disable`** removes a node and rewires its dependents to wait for whatever it waited for, so the
chain closes up rather than breaking. Naming a node the base does not carry is an error.

**`tune`** changes only these keys, and `uses` is immutable by design — a different target is an
eject:

<!-- vocabulary: TUNABLE -->
| Tunable | How it merges |
|---|---|
| `with` | Key by key, one level deep: a key you name takes your value, `null` deletes the key, a key you leave out keeps its value, and a key whose value is a map is replaced whole |
| `provider` | Replaces the node's own, `claude` or `copilot` |

**`add`** introduces a node under an id the graph does not carry. It must attach through a
non-empty `needs`. An added node takes every node key, plus one:

<!-- vocabulary: ADDED_NODE_KEYS -->
| Key | Meaning |
|---|---|
| `before` | Existing node ids that must wait for the added one; each gains it in its own `needs` |

`before:` is how a phase goes between two phases and how a verifier holds a gate: the gate then
waits for the verifier, and its brief shows the verifier's summary. It only ever adds a wait, so
an overlay cannot step around a gate with it. It is refused when it names the added node itself,
a node the graph does not carry, or a node the added one already needs. **Without `before:`**
nothing waits for the added node: it runs as a side branch wherever the frozen order puts it, no
gate waits for it, and validation warns `added-node-no-dependents` naming its position.

**A disabled id cannot come back.** An `add` under an id any overlay or profile disabled is
refused, because the node's dependents no longer wait for it. To change what a node receives,
`tune` it; to replace it, add a node under a new id and attach it with `before:`.

**`profiles`** carry alternatives in one overlay, selected by name with `--profile`:

<!-- vocabulary: PROFILE_KEYS -->
| Profile key | Meaning |
|---|---|
| `disable` | As above, applied after the overlay's own operations |
| `tune` | As above |
| `add` | As above |
| `display` | As above; the profile's wins |

Every profile is validated whether or not it is selected, and a finding only one profile produces
is prefixed with its name. Selecting a profile no overlay declares is an error.

**Identity.** An overlay and an eject that declare the same graph hash the same, because the
recorded identity covers the resolved nodes and the exposed outputs and nothing about where they
came from. The node ids an overlay attaches to are therefore its contract with the base: validate
again after every upgrade.

## 13. Recipes

### 13.1 A workflow that can run as a child

A `workflow:` node without `dir:` starts the named workflow as a child run. Only a workflow built
for it can be one:

1. Declare `embedded: {type: bool, required: false, default: false}` under `inputs:`.
2. Guard the node that exists only to tell an operator the run is over with
   `when: "!${inputs.embedded}"`.
3. Declare a workflow-level `outputs:` block (§ 8.3) naming every artifact and value a parent may
   read.
4. Give every question a node asks inside itself a default its prose names, because a child
   under a cockpit or dispatch driver is never asked one. A question that truly needs a person
   becomes a gate.
5. Keep exposed values short and flow-safe; detail belongs in an artifact.
6. Say so under the companion's `## Embedded mode` heading.

The calling node passes the child's inputs in `with:` and declares, under its own `outputs:`, the
same keys the child exposes — an artifact by the path the child's producing node declares, a value
by its type. Binding is by name, both ways. `task_path` and `run_id` are reserved: the engine
writes them onto the calling node as the address of its child. Validation warns
`unresolved-subrun-input` for a `with:` key the child does not declare or a required child input
with no default that is not passed, and `unresolved-subrun-output` for a key
the child does not expose. The walks, the refusals and the worked state pair are
`references/sub-runs.md`.

### 13.2 A fix loop inside one node

The grammar has no loop, and `loop` is reserved. A check-fix-recheck cycle lives inside one node,
in its prose:

- **The section states the loop:** run the check, fix what it found, run it again, and exit when
  the check passes.
- **It states the budget,** as a number of attempts, in prose — never in `with:`.
- **It states what exhaustion means.** Under a terminal driver, ask whether to proceed with the
  known issues or stop. Under a cockpit or dispatch driver nobody can answer, so the node records
  `failed`, or records the issues it could not fix as open risks in its summary so the next gate
  shows them.
- **It keeps the artifact current.** The report the gate is answered against must carry the
  final verdict, not the first one.
- **A decision that belongs to a person is a gate after the node,** not a question inside the
  loop. The gate's stop option is the operator's way out; a revise option on it is the way back
  (§ 13.3).

The built-in development workflow's `verification` node is a worked example.

### 13.3 A review loop across nodes

When a person, or a reviewing node, sends a draft back, the loop belongs on the gate: draft, then
review, then a gate whose revise option re-runs the draft.

```yaml
  review-approval:
    type: gate
    needs: [review]
    ask: "Review complete. Publish the draft?"
    options:
      publish: continue
      send-back: {effect: revise, reruns: draft}
      abandon: stop
```

Choosing *send back* resets `draft`, `review` and the gate; `draft` re-runs with the note, `review`
reviews the new draft, and the gate asks again. At its ceiling of ten revisions the gate offers
only publish and abandon. The `draft` section carries its *When re-run after a revise* paragraph (§ 11).

## 14. Checking a definition

`/maister-copilot:run <name> --check` finds the definition by name, lays the overlays the lookup finds and
any `--overlay` you pass over it, selects `--profile` when given, and validates the result. It
starts nothing. Each error names its file, its node, the dotted path of the field and a message;
where the fix is mechanical, a hint follows. A report with errors cannot become a run, because the
engine runs the same check before it freezes one.

Warnings never block, and each one is worth reading:

| Warning | Means |
|---|---|
| `unresolved-reference:<node>:<target>` | A `skill:`, `agent:` or `workflow:` target found in no tier or home — a typo, or something not installed here |
| `added-node-no-dependents:<path>:<node>` | An added node nothing waits for; list the nodes that should wait under `before:` |
| `node-no-dependents:<path>:<node>` | A definition's own node nothing waits for and the run does not end on; add it to a later node's `needs`. An `on: failure` or `on: always` node is exempt |
| `overlay-ignored:<name>:<home>` | An overlay beside an eject or a generated chain of its name, never applied |
| `workflow-undescribed:<name>` | A project workflow with neither a `description:` nor a companion paragraph, which `/maister-copilot:work` cannot offer |
| `exposed-output-disabled:<path>:<node>` | An exposed output whose node an overlay or profile removed; the key is dropped |
| `unresolved-subrun-input:<node>:<name>` | A required child input with no default missing from `with:`, or a `with:` key the child does not declare |
| `unresolved-subrun-output:<node>:<name>` | A key the calling node declares that the child does not expose, or exposes at another path |
| `undecidable-value-type:<path>` | A `string` value; prefer `bool`, `id` or an `enum` where the value is a handle |
| `icon-hint-unknown-node:<path>:<node>`, `title-unknown-node:<path>:<node>` | Display for a node the graph does not carry |
| `reserved-key:<key>` | A reserved key (§ 10), parsed and ignored |
| `newer-format` | A version above 1: only the structure and the cycle check ran |

In a workspace, `/maister-copilot:umbrella validate` additionally checks every `dir:` against the members
the manifest declares and that each dispatched target can run unattended. It judges each
definition as written and applies no overlays, so an overlay is checked with `--check`.
