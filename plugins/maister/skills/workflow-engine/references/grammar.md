# Workflow definition grammar

The grammar a workflow definition, its prose companion and its overlays are written in —
version 1. The built-in workflows beside this skill are written in it, and so is every workflow
a project keeps in `.maister/workflows/`. A definition says which nodes exist, what each one
needs, what guards it, what it runs and what it declares. The companion says how each `direct:`
node does its work. Everything below is enforced by the same validator the engine runs before it
freezes a run, so `/maister:run <name> --check` (§ 14) is the way to find out whether a file says
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
`/maister:run`.

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
double-quoted escape other than JSON's (`\n \t \r \b \f \\ \" \/` and `\u` with four hex
digits). A decoded newline, carriage return or tab is refused in any node value.

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
| `description` | no | One line of plain text: what the workflow is for and when to use it. `/maister:work` offers the workflow by it, ahead of the companion's first paragraph. Outside the recorded identity |
| `inputs` | no | Input name → declaration (§ 8.1) |
| `outputs` | no | What a parent run may read when this workflow runs as its child (§ 8.3) |
| `display` | no | Icons, titles, option labels and gate headers for the dashboard and the gate question (§ 3.1) |
| `nodes` | yes | Node id → node (§ 4) |
| `html_companions` | no | Node id → the artifact keys whose markdown owes an HTML companion (§ 3.2) |
| `brief` | no | Node id → the data a node's brief prints beside its prose (§ 3.3) |

`profiles:` is not a definition key: profiles belong to an overlay, and a definition's own are
refused rather than silently ignored. Nor is there a `title:` key: a workflow's title is its
companion's `# Title` line (§ 11).

### 3.1 `display`

<!-- vocabulary: DISPLAY_KEYS -->
| Key | Shape |
|---|---|
| `icons` | Node id → one icon hint from the table below |
| `titles` | Node id → a one-line title; a node without one is shown as its id in title case. A gate's title is also the question its brief asks when its `ask` asks to continue ("Approve the specification?"), so give every gate its own; without one the brief asks the lead of the `ask` |
| `option_labels` | Gate id → option id → a one-line label the operator picks; an option without one is shown as its id in sentence case. A continue option labelled `Continue` alone — or with no label, an option id of `continue` — is completed with where the run actually goes once guards are read ("Continue to implementation planning", "Finish the run"), so a gate whose next step a guard decides never names two destinations. In a run another run started, the end of this run is named by the parent's next step ("Continue to release notes"), and a stop labelled `Stop here` names the parent it also stops. The recorded answer is still the option id |
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

### 3.2 `html_companions`

Which markdown artifacts owe an HTML companion — a page written beside the `.md` for a reader
to open in a browser:

```yaml
html_companions:
  specification: [spec]
  e2e-verification: [e2e, fidelity]
```

Keys are node ids; values list the node's artifact keys, the names under `outputs.artifacts`.
The owed page is the declared path with `.html` in place of `.md`. Who writes it follows from
how the node runs and is never declared.

**Merge.** The base, then each overlay's block, then the selected profile's. A later list
replaces the earlier one for its node, and `[]` clears it. A node an overlay or the profile
disables owes nothing.

**Checks.** A block that is not a mapping, a key that is not a node id, a value that is not a
list, an item that is not a one-line name, or a name listed twice is an error. A node the
resolved graph does not carry, a key the node does not declare, and a declared path that does
not end in `.md` each warn (§ 14), and owe nothing.

**At run time**, with HTML output on, a node's run context lists the pages it owes; completing
the node without one prints `companion-missing:`, and closing the run prints
`missing-companion:` for each still absent. A definition without the block owes nothing.
The block is outside the recorded identity: declaring a companion moves no frozen run. It is
not the prose companion of § 11, which is the definition's own `.md` file.

### 3.3 `brief`

What a node's brief prints beside its prose section — data a step reads, kept out of the prose
so every workflow states it the same way and an overlay can change one item:

```yaml
brief:
  specification:
    absent: {technical_clarifications: "Written only when clarifications were needed."}
    recommends: {audit_flag: {"yes": continue-to-spec-audit, "no": continue-to-planning}}
```

Keys are node ids; each entry holds any of these keys:

<!-- vocabulary: BRIEF_KEYS -->
| Key | Shape |
|---|---|
| `summary_keys` | Retired: accepted with any non-null value and ignored; validate warns `brief-retired-key` (§ 14) |
| `absent` | Artifact key → a one-line reason the node may leave that artifact unwritten |
| `budget` | A whole number from 1 to 10: the recovery attempts the node may make, printed as a rule and not enforced. A node with no recovery budget has no `budget` key |
| `recommends` | `with:` key → (value → continue option id): which option the gate the node feeds should recommend for each value. Values are read as text, so quote `"yes"`, `"no"`, `"true"`, `"false"` |

A question the node asks inside itself has no key here: its default is stated once, in the
*Without question sets* line of the node's section (§ 11), which the brief prints.

**Merge.** The base, then each overlay's block, then the selected profile's, node by node and
key by key: a later key replaces the earlier one, a key set to `null` removes it, and an entry
set to `null` removes the node's entry. `null` is an overlay's or a profile's removal, and an
error in a definition. A node an overlay or the profile disables gets no brief data.

**Checks.** A block that is not a mapping, a key that is not a node id, an entry that is not a
mapping, a key outside the table, and a value of the wrong shape or with a line break are errors,
each located at its path (`brief.<node>.<key>…`, prefixed `profiles.<name>.` in a profile). A
node the resolved graph does not carry, an `absent` key the node does not declare, a `recommends`
key that is not one of its `with:` keys, a recommended option that is not a continue option
of a gate the node feeds, and a `summary_keys` key each warn (§ 14); nothing is printed for that item. A node feeds the
gates whose closing nodes hold it: a gate's needs, with a need that is itself a gate replaced by
that gate's own needs — the nodes the brief's `feeds:` lines name.

The block is outside the recorded identity: changing a budget or an absence moves no frozen
run, and `resolve` never prints it.

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
  answered it — `project`, `user`, `plugin` or `installed`; for a `direct:` target, `companion`
  when the companion carries its section and `conventions` when it has none (§ 11). A target you
  meant to come from your project that answers `plugin` is the shadowing case caught early.

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
the option id the operator chose — and, when that option sets gate values, those values. It must
carry `ask` and `options`, and may not carry `uses` or `outputs`.

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
revise option only `reruns`, and on a continue option only `grants` and `sets`;
`approve: continue` and `approve: {effect: continue}` mean the same.

<!-- vocabulary: OPTION_KEYS -->
| Option key | Meaning |
|---|---|
| `effect` | what the option does — one of the effects below |
| `reruns` | a revise option's target: the task node the run is sent back to |
| `grants` | a continue option's list of what answering it authorises beyond the run — names from the closed set below |
| `sets` | a continue option's gate values: a map of value key to `true` or `false`, recorded on the gate when it is the answer |

<!-- vocabulary: OPTION_EFFECTS -->
| Effect | What the answer does |
|---|---|
| `continue` | the run goes on past the gate |
| `stop` | the run ends here; nothing downstream becomes ready |
| `revise` | the stretch from `reruns` to the gate runs again, with the operator's note, and the gate is asked again |

**The gate rule:** at least one option continues, any number revise, and a gate with a single
continue offers at least one stop. More than one continue is allowed only when every continue
carries `sets`, all of them name the same keys, and no two set the same combination — otherwise
two answers would be one route. Such a gate decides the route, and it may leave out the stop when
one of its continues is the way to the end — a continue that turns every optional stretch off,
say, so the run finishes with its closing node rather than stopping before it. An option id
is lower-case letters, digits and dashes, starting with a letter. A continue or a stop routes
nowhere: what happens next is decided by the graph and the guards, and the gate brief's `Next:`
line names the node that actually runs. Under the default `on:`, nothing
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
  the prior context. A `reruns` target re-runs over its own earlier output by the engine's re-run
  convention, and its *Re-run* part says only what differs (§ 11).

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
| `tag` | creating a release tag and pushing it |
| `tracker-write` | writing to the issue tracker |
| `browser-remote` | browsing named hosts beyond this machine |
| `spend` | starting or steering runs that spend budget |

`grants` is a non-empty list, each name once, on the continue option only — a stop ends the run
and a revise asks the gate again, so no node after either answer would act on it. The engine
itself grants no permission and acts on none. It shows each grant wherever the gate is shown, in
the option's label and in the checkpoint, and that makes the answer an informed approval. A
driver that delivers the answer registers the grants for the worker. The node prose after the
gate does what each grant names, and asks nothing more. The grants are part of the graph's
identity, in the closed set's order, so adopting one moves the definition's hash; a name is only
ever appended to the set, so a definition's hash stays where it was. No grant merges.

**A gate may decide an optional step.** When the step after a gate is optional, the gate that
approves the work before it asks both at once, with one continue per way on, and the step's
guard reads the value the answer set:

```yaml
    options:
      continue-to-audit:    {effect: continue, sets: {audit_enabled: true}}
      continue-to-planning: {effect: continue, sets: {audit_enabled: false}}
      stop-here: stop
  audit:
    uses: direct:audit
    needs: [spec-approval]
    when: "${spec-approval.values.audit_enabled}"
```

A `sets` key is lower-case letters and underscores, the form a guard reference ends in, and each
value is `true` or `false`. The writer records the chosen option's map as the gate's values when
it records the answer, a skipped gate records every key false, and a revise that resets the gate
clears them. The brief walks each continue on its own answer, so each option names where it leads,
and the closing node may say which one it recommends and why (`references/gates.md`). `sets` is part of
the graph's identity, its keys in sorted order, so adopting it moves the definition's hash.

When the question needs a value from earlier in the run, interpolate it into `ask` (§ 9). The
gate brief — the closing node's summary, decisions, risks and a recommended option — is rendered
beside the question by the engine; the node prose feeds it through its summary (`references/gates.md` § *Before every gate — the gate brief*).

## 7. Guards, `on:` and the ready set

A node is ready when every need is satisfied, its `on:` allows it, and its guard is true. A node
whose guard is false is recorded `skipped`, and **a skip satisfies everything downstream** — that
is how an optional stretch is written without any routing construct.

**`when`** is one reference, or several joined by `||`, each optionally negated with a leading
`!`, the whole quoted. A guard with several references is true when any of them is:

| Form | Reads |
|---|---|
| `"${inputs.<name>}"` | A declared input of type `bool`: its value, else its default, else false |
| `"${<node>.values.<key>}"` | A `bool` value declared by a node inside this node's `needs` closure |
| `"${<gate>.values.<key>}"` | A value a continue option of a gate inside this node's `needs` closure sets |

There is no further expression language: no `and`, no parentheses, no comparison, no enum test,
no artifact, and no gate answer by option id — a gate is read through the values its continues
set. `||` exists for one shape: a stretch two gates can each switch on, the earlier one when the
stretch between them is skipped and the later one when it ran —

```yaml
  design:
    needs: [convergence-approval]
    when: "${foundation-approval.values.design_enabled} || ${convergence-approval.values.design_enabled}"
```

An all-of condition is still a `bool` an earlier node records. A reference to a node that
did not complete — skipped, failed or stopped — reads false. A completed node that never recorded
the value is a defect the gate brief refuses to paper over. The closing gate of a guarded stretch repeats the stretch's guard,
because an unguarded gate would fire for a stretch that never ran.

**A guard may skip a gate only when someone chose the value it reads, or when the gate only
confirms.** An input or a gate's value is a choice an operator made, so a guard on either may
skip any gate. A value a non-gate node records — a `workflow:` node included, the reference
negated or not — is the run's own finding, and nobody chose it. A gate guarded by one is skipped
by its guard only when it is a **pure confirmation**: exactly one continue, with no `sets` and no
`grants`; a revise or a stop beside it is allowed. Any other such gate decides something — which
way the run goes, or what the answer grants — and is **asked whatever its guard reads**: the ready
set takes it as ready once its needs are met, the brief walks to it, and `run-complete` holds it
owed and never offers to record it skipped. Validation warns `skip-guard-not-pure:<node>`; nothing
is refused. A write that records such a gate `skipped` lands and warns `skip-guard-skipped:<node>`.
The fix is a guard on an input or a gate's value, or a gate reduced to a single plain continue.
A gate whose guard reads false and that neither this rule nor a held choice asks (engine
§ *The ready set*) is never asked: `gate-brief` and `gate-request` refuse it `gate-guard-false`,
naming the write that records it skipped.

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
A node that does not produce a declared artifact has not completed — unless its `brief:` `absent`
sanctions the absence by name (§ 3.3), and the node then records it on its summary under `absent`,
keyed by the artifact's declared key (engine § *Recording an outcome*).

| Value type | Recorded as |
|---|---|
| `bool` | `true` or `false` |
| `id` | A short identifier-like string |
| `{enum: [a, b, c]}` | One of the listed strings; the map carries `enum` and nothing else |
| `string` | Free text. Warns `undecidable-value-type`, because free text is not provably safe on the one-line shapes state carries |

A skipped node records its bools false and its strings and enums null. A value a later guard
reads must be a `bool`, declared here or set by a gate's continue option (§ 6) — a gate declares
no `outputs`.

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
| `${<node>.values.<key>}` | A value a node declares, or a gate's continue options set |
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
| `values` | A gate option key | An option emits no values of its own; a continue option sets a gate value with `sets` (§ 6), and a task node declares its own in `outputs` |

## 11. The prose companion

A `direct:` node is the engine following the companion section named after its target. The
section is found by its heading:

- a heading at any level whose text, backticks removed, **equals the name after `direct:`** —
  `## assess-scope` and ``## `assess-scope` `` both match `direct:assess-scope`, while
  `## Notes on assess-scope` does not. By convention the name is the node id;
- the companion is `<name>.md` beside the definition, or, for a node an overlay adds, the
  `.md` beside that overlay;
- a line inside a fenced code block is never a heading, so a heading quoted in an example neither
  opens a section nor closes one.

**The section is optional.** A `direct:` node whose companion carries no section for it runs from
the engine's node conventions alone, and the check's `resolved` list says `conventions` for it
rather than `companion`. The companion file itself is required: a `direct:` target whose
companion does not exist is an error, `"<name>" has no prose companion: <path> does not exist`.
Because a renamed node or a mistyped target would now fall back to the conventions without a
word, every `` ## `x` `` heading outside a fence must name a section some node finds: the name
after `direct:` for a `direct:` node, the node id for any other node or gate. One that names none
warns `orphan-prose-section` (§ 14).

**The section is the node's own part of its brief.** The engine's node conventions (engine
`SKILL.md` § *Node conventions*) already say how each scheme runs, how a gate is asked, what every
step checks before it completes, what a closing summary carries and how a re-run works; a section
states only what is the node's own and never restates them. `node-brief` prints the node's
header, the conventions that apply to it and then its section, and the engine reads that before
running the node. A section is built from up to six parts, each opened by a paragraph that starts
with its bold label, in this order, each at most once:

| Part | Carries |
|---|---|
| `**Does.**` | The steps, fan-outs, self-checks and judgement; the only part that may hold subheadings |
| `**Asks.**` | Framing for the questions the node asks inline, then its question-set lines |
| `**Writes.**` | What the header cannot print about its files: a required shape, an undeclared write |
| `**Summary.**` | An example headline and what goes into its decisions, risks and `recommends` |
| `**Re-run.**` | Only what differs from the re-run convention, for a node a revise option names |
| `**Budget.**` | What happens between recovery attempts; the number is `brief:` `budget` (§ 3.3) |

A gate has a section only for an exception — behaviour neither its definition,
`references/gates.md` nor the conventions carry — held in a single `**Exception.**` part. The data
a step reads (its sanctioned absences, budget, recommendation and question defaults)
lives in `brief:`, never in the prose, and a budget never in `with:`, where it would be inert.

**The top of the companion introduces the workflow.** Its `# Title` line is the workflow's title,
and its first paragraph is the summary `/maister:run --list` shows and `/maister:work` offers the
workflow by — unless the definition carries a `description:`, which is preferred. A project
workflow with neither warns `workflow-undescribed`, because `/maister:work` has nothing to match
a task against. Node sections follow it. A workflow that can run as a child and behaves
differently as one adds an `## Embedded mode` section saying how (§ 13.1); one that runs the same
way as a child carries none.

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
| `html_companions` | Companions owed, including by added nodes; a node's list replaces the base's (§ 3.2) |
| `brief` | Brief data, including for added nodes; merged key by key, `null` removing (§ 3.3) |
| `subagents` | The models and effort this workflow's subagents run on, without `tiers` (*Subagent models* below) |

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
| `html_companions` | As above; the profile's wins |
| `brief` | As above; the profile's wins, key by key |
| `subagents` | As above; the profile's wins over the overlay's |

Every profile is validated whether or not it is selected, and a finding only one profile produces
is prefixed with its name. Selecting a profile no overlay declares is an error.

**Subagent models.** `subagents` says which model and effort the workflow's subagents run on,
in the shape of the `subagents` key of the project's `.maister/config.yml`, without `tiers`: only
the project remaps the ladder. The freeze reads the project's block, the overlays' and the
selected profile's, and records them in the run; a profile's entry wins over an overlay's, and an
overlay's over the project's. `dispatch-model` prints what an agent resolves to. A block with an
error is refused whole and the shipped defaults apply; its findings are warnings, never errors,
because a refused block stops no run. The block is no graph data, so it moves no hash.

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
4. Give every question a node asks inside itself a default in its *Without question sets* line,
   because a child under a cockpit or dispatch driver is never asked one. A question that truly needs a
   person becomes a gate.
5. Keep exposed values short and flow-safe; detail belongs in an artifact.
6. Where a step behaves differently as a child, say how under an `## Embedded mode` section of
   the companion; a workflow that runs the same way as a child needs none.

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
- **It states the budget:** the number of attempts in `brief:` `budget`, never in `with:`, and
  what happens between attempts in its *Budget* part.
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
only publish and abandon. The `draft` section carries its *Re-run* part (§ 11).

## 14. Checking a definition

`/maister:run <name> --check` finds the definition by name, lays the overlays the lookup finds and
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
| `workflow-undescribed:<name>` | A project workflow with neither a `description:` nor a companion paragraph, which `/maister:work` cannot offer |
| `exposed-output-disabled:<path>:<node>` | An exposed output whose node an overlay or profile removed; the key is dropped |
| `unresolved-subrun-input:<node>:<name>` | A required child input with no default missing from `with:`, or a `with:` key the child does not declare |
| `unresolved-subrun-output:<node>:<name>` | A key the calling node declares that the child does not expose, or exposes at another path |
| `undecidable-value-type:<path>` | A `string` value; prefer `bool`, `id` or an `enum` where the value is a handle |
| `skip-guard-not-pure:<node>` | A gate guarded by a value a non-gate node records that is more than a pure confirmation, so it is asked whatever its guard reads (§ 7); guard it on an input or a gate's value, or make it a single continue with no `sets` and no `grants` |
| `icon-hint-unknown-node:<path>:<node>`, `title-unknown-node:<path>:<node>` | Display for a node the graph does not carry |
| `html-companion-unknown-node:<path>:<node>`, `html-companion-unknown-artifact:<path>:<node>`, `html-companion-not-markdown:<path>:<node>` | An `html_companions` entry for a node the graph does not carry, a key the node does not declare, or a path that is not `.md`; nothing is owed for it |
| `brief-unknown-node:<path>:<node>` | A `brief` entry for a node the graph does not carry; a node an overlay or profile disabled counts as removed and does not warn |
| `brief-unknown-artifact:<path>:<node>` | An `absent` key the node does not declare under `outputs.artifacts` |
| `brief-unknown-input:<path>:<node>` | A `recommends` key that is not one of the node's `with:` keys |
| `brief-unknown-option:<path>:<node>` | A recommended option that is not a continue option of a gate the node feeds |
| `brief-retired-key:<path>:<node>` | A `summary_keys` entry: the phase-summary mirror it named is retired and nothing reads it; remove the key |
| `orphan-prose-section:<companion>:<name>` | A `` ## `name` `` heading outside a fence that no node of the definition or overlay beside it finds its section by (§ 11) — a renamed node or a mistyped `direct:` target; rename the heading to the name, or delete the section. A node an overlay or profile disables still counts |
| `subagents-error:<file>:<path>` | A `subagents` block the engine cannot apply — a `claude` cell or a pinned `model` that is not `haiku`, `sonnet`, `opus`, `fable` or `inherit`, a Claude Code alias in a `copilot` cell, an unknown tier or preset, an effort outside `low` … `max`, `allowed` outside the ladder, `tiers` in an overlay or profile, or a value of the wrong shape; the whole block is refused and the shipped defaults apply |
| `subagents-unknown-agent:<file>:<path>` | An agent no tier provides; the built-in `Explore`, `general-purpose` and `Plan` are known in any case |
| `subagents-premium-model:<file>:<path>` | A `copilot` cell naming a model Copilot bills above one request, without `premium: true` beside it |
| `subagents-unknown-key:<file>:<path>` | A key the `subagents` block does not take at that level; it is ignored |
| `reserved-key:<key>` | A reserved key (§ 10), parsed and ignored |
| `newer-format` | A version above 1: only the structure and the cycle check ran |

In a workspace, `/maister:umbrella validate` additionally checks every `dir:` against the members
the manifest declares and that each dispatched target can run unattended. It judges each
definition as written and applies no overlays, so an overlay is checked with `--check`.
