---
name: maister:run
description: Starts or resumes a workflow by name from the terminal — a workflow the project defines in `.maister/workflows/`, an eject or an overlay of a built-in, or a built-in itself. Looks the name up, validates the definition, collects the inputs it declares (asking only for required ones that are missing) and hands the run to the workflow engine, which owns the task directory, the freeze, every node and every gate from there. Given a run's task directory instead of a name, it resumes that run; with `--list`, it lists the project's own workflows; with `--check`, it validates the named workflow — overlays and profile included — and prints each problem with its file, node and field, starting nothing. Chains — definitions whose nodes dispatch into member repositories — are started from maister cockpit, not here.
argument-hint: "<name> [\"title\"] [key=value ...] [--profile=NAME] [--overlay=PATH ...] | <name> --check [--profile=NAME] [--overlay=PATH ...] | <run directory> | --list"
user-invocable: true
---

# Run a Workflow by Name

The terminal entry for any workflow definition a project can name. A built-in workflow has a
command of its own; a workflow the project wrote has this one. Either way the same engine runs
it, so this skill does four things and stops: find the definition, prove it validates, gather its
inputs, and hand the run over. It never freezes state, writes state, runs a node or asks a gate —
the engine does all of that, under its own rules, and a second copy of them here would drift.

---

## Arguments

| Argument | Meaning |
|---|---|
| `<name>` | The workflow to start — the file name under `.maister/workflows/` without `.yml`, or a built-in's name |
| `"title"` | Free text: the run's title and task description |
| `key=value` | One declared input. Quote a value holding spaces: `team="Payments Core"` |
| `--profile=NAME` | A profile one of the run's overlays declares |
| `--overlay=PATH` | An extra overlay file, laid over the definition after any overlay the lookup finds; repeatable, applied in the order given |
| `<run directory>` | A run's task directory, or its folder name alone — resume that run instead of starting one |
| `--list` | List the project's own workflows and start nothing |
| `--check` | With a name: validate that workflow as it would run, report every problem, and start nothing |

The first word decides the mode: a directory holding `orchestrator-state.yml` (tried as given,
then under `.maister/tasks/*/`) is a resume; `--list` is a listing; anything else is a name. A
name given with `--check` is a check (*Checking a workflow*), never a start.

**Listing.** Run `locate` with no name. It lists the definitions the project keeps in
`.maister/workflows/` — overlays, built-in names and generated chains left out — each with its
name, its companion's title and opening paragraph, whether it is a `chain`, and an `error` when
it cannot be run by its name. Print one line per workflow, marking chains ("started from maister
cockpit") and broken ones (with the error), and stop. `/maister:work` reads this list to offer the
project's workflows beside the built-in ones.

**With no argument**, take the same list, leave out chains and broken ones, and:

- **one workflow left** — start it without asking, saying which in one line;
- **several** — ask "Which workflow should start?" with AskUserQuestion, one option per
  workflow, its title as the label and its one-line summary as the description, no list printed
  above the question. Beyond four, offer the three most recently changed and name the rest in
  the question; any of them is the Other answer.

When nothing is listed, say where a workflow lives (`.maister/workflows/<name>.yml`, with its
prose in `<name>.md`) and stop.

## Calling the engine's verbs

Every lookup and check below is one of the workflow engine's verbs, run exactly as that skill's
§ *The invocation contract* prescribes: the script
`${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs`, where the plugin root is
two levels above this skill's base directory, written as that absolute path rather than through
the variable, one verb per call, from the project root. For example:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs locate --name=onboarding
```

Exit `0` is success, `1` a rejection whose reasons are in the JSON on stdout, `2` a runtime that
did not start — quote its stderr verbatim and stop. Never do by hand what a verb refused.

---

## Starting a run

### 1. Find it

Run `locate --name=<name>`, adding each `--overlay` and the `--profile` the operator gave. It
performs the engine's run-by-name lookup — an eject, then a generated chain, then an overlay over
the built-in, then the built-in, first hit winning — and prints what the next steps need:
`definition` and `overlays` (the values `validate` takes), the declared `inputs`, the nodes that
carry `dir:` as `dispatches`, and the companion's `title`.

- **Exit `1`** — relay the message as printed: the name is found nowhere, is not a workflow name,
  or finds a file whose `name:` says something else. When the name belongs to a workflow that
  has its own command and no definition, name that command.
- **`ignored` is set** — an overlay of this name sits beside an eject or a generated chain and is
  **not** applied. Say so before going on, so nobody believes it is in effect.

### 2. Refuse what this entry is not for

- **A chain.** A non-empty `dispatches` means nodes hand work to member repositories. That is a
  chain — whether the definition declares those nodes or an overlay or the profile adds them —
  and chains are started and driven from maister cockpit, which owns the dispatch ledger and the
  workers. Name the dispatching nodes and stop.
- **A legacy folder name.** `bug-fixes`, `enhancements`, `new-features`, `refactoring` and
  `mockups` are pre-v3 task folders that every run reader skips as inventory, and a run's folder
  is its workflow's name — so a run started under one of them could never be found again. Say
  so, suggest renaming the workflow, and stop.

### 3. Validate

Run `validate` with `--definition=` the located definition, one `--overlay=` for each located
overlay followed by each `--overlay` the operator gave, in order, and `--profile` when one was
given. The engine re-runs the same check before it freezes; running it here means a definition
that cannot run is reported before anyone is asked for an input.

- **Exit `1`** — report every error by its file, node, path and message, so the author can go
  straight to the line, and stop. Nothing has been created.
- **Warnings** — show each one; none of them blocks.

### 4. Collect the inputs

The definition declares its inputs, each with a `type` (`string`, `bool` or `path`), whether it is
`required`, and sometimes a `default`. Work from `locate`'s `inputs`:

- **Refuse a key the definition does not declare**, naming the ones it does. An undeclared input
  reaches nothing, and a misspelt one leaves the real one unset.
- **A `bool` takes `true` or `false`**, nothing else.
- **The title text fills one input** when exactly one required `string` input is still missing —
  `/maister:run research "How should retries back off?"` supplies `question`. With none or several
  missing, the text is the title only.
- **Ask for each required input that has no value and no default**, one AskUserQuestion per
  input, by what it means — "Which branch should it compare against?", never "Value for
  `base` (string)". Word the question from the input's description, or its name when it has
  none. A `bool` is asked as Yes / No; a `path` offers up to three likely files or folders
  from the project, the user's own being the Other answer; a `string` is free text with an
  example in the question. Never ask for an optional input or one with a default, and never for
  `embedded`: the engine supplies it when one run starts another, and an operator never does.

The title is the free text when there is one; otherwise the workflow's name followed by the value
of its first required `string` input, or the name alone.

### 5. Hand the run over

Invoke the `maister:workflow-engine` skill with the Skill tool, passing:

- the workflow's bare name, as `locate` printed it;
- the inputs, as a map of input name to value;
- the overlays, located ones first and then the operator's, in order;
- the profile, when one was given;
- the title and, when there is free text, the task description.

The engine owns the run from here: it re-resolves the name, freezes the graph with these inputs,
creates the run's task directory under `.maister/tasks/<name>/`, relays its startup banner, runs
the nodes and asks every gate. Do not also do any of that here.

`/maister:run <built-in>` runs the built-in on the engine, as its own command does, and is the
way to give a built-in a profile.

---

## Checking a workflow

`<name> --check` answers one question — would this workflow start, and if not, what must
change — and starts nothing: no input is asked for, no task directory is created, nothing is
frozen and the engine skill is not invoked. It is the validator a single project uses before a
run, overlays and profiles included. A title or a `key=value` given with it is ignored, and the
report says so.

1. **Find it.** Run `locate --name=<name>`, adding each `--overlay` and the `--profile` the
   operator gave, so a `dir:` node an overlay adds is found too. On exit `1`, the message is the
   one problem: print it as the report and stop. When `ignored` is set, record a problem — the
   overlay beside the eject or the generated chain is not applied — and go on.
2. **Validate.** Run `validate` exactly as Step 3 of *Starting a run* does. Exit `0` and exit `1`
   both print the whole report on stdout; read it either way. Exit `2` is the only stop.
3. **Report**, in this order:
   - **What was judged:** the definition, each overlay in the order applied, and the profile.
     Say where the definition came from in plain words. `from: eject` is the project's own
     definition in `.maister/workflows/` — an eject only when a built-in of that name exists.
     `overlay` is the built-in with the project's overlay laid over it, and `builtin` is the
     plugin's as shipped.
   - **Errors,** one line each — `<file> · <node> · <path> — <message>`, with `-` for a node
     that is null — followed by an indented `fix:` line when the message matches the table
     below. Never compose a hint the table does not give: a guessed fix is worse than none.
   - **Warnings,** one line each, with their `fix:` line where the table has one.
   - **Problems no verb reports:** a non-empty `dispatches` — the workflow is a chain, started
     from maister cockpit; in the workspace, `/maister:umbrella validate` adds the member and
     driver checks the engine cannot make. A name that is a legacy folder name. An `ignored`
     overlay.
   - **What resolved:** one line per `skill:`, `agent:` and `workflow:` target from `resolved`,
     with the tier or home that answered, so a shadowed name shows.
   - **The inputs** a start would ask for: each required input with no default, by name and
     type.
   - **A closing line:** the error and warning counts, the node and gate counts, and "nothing was
     started". With no errors and no problems, say the workflow would start.
   - **Where to go next,** only when a problem has no `fix:` line or a refusal means the change
     needs an eject rather than an overlay: `/maister:workflow-author check <name>` adds the
     executor and artifact checks and says whether an overlay can do the job.

| The message or warning says | `fix:` |
|---|---|
| `is not a … key; did you mean "X"?` | rename the key to `X` |
| `is not a … key; the accepted keys are …` | remove the key, or move it to the level that accepts it (the grammar reference lists each level's keys) |
| `"optional" is not a node key` | delete the line |
| `"values" is not an option key` | delete it; declare the value under a task node's `outputs.values` |
| `this grammar is version 1, written as the bare number` | write `version: 1`, unquoted |
| `the required key "X" is missing` | add `X:` at the top of the definition |
| `profiles belong to an overlay` | move the `profiles:` block into `<name>.overlay.yml` |
| `the prose companion carries no section for "X"` | add a `## X` heading to the `.md` beside the file that declares the node — the overlay's own for a node an overlay adds |
| `needs names "X", which no node declares` | correct the id, or declare node `X` |
| `names an input that is not declared`, `when names the input "X", which is not declared` | declare the input under `inputs:`, or correct the name |
| `which is outside this node's needs closure` | add the named node to this node's `needs` |
| `opens a reference with ${ and never closes it` | add the closing `}` |
| `an artifact path is written literally` | write the path literally; pass the varying part through `with:` |
| `an artifact path stays inside the run's task directory` | write a path relative to the run's task directory: no leading `/` or `\`, no drive letter, no `..` segment |
| `a gate offers at least one continue` | make at least one option `continue`, and give a gate with a single continue at least one `stop`; revise options are extra |
| `each must set the gate values that tell it from the others`, `every continue of a gate sets the same values`, `the two answers would be one route` | give every continue of the gate `sets:` naming the same keys, each continue its own combination of true and false — or keep a single continue |
| `a revise option names the node it sends the run back to`, `reruns names` | write the option as `{effect: revise, reruns: <node>}`, naming a task node the gate waits on — not a gate, not a `workflow:` node, and not one whose stretch to the gate holds a `workflow:` node |
| `a when clause is one reference, or several joined by \|\|` | write the guard as quoted `"${…}"` references, each optionally `!`, joined by `\|\|` when any of them should run the node; an all-of condition is a `bool` an earlier node records |
| `when needs a bool input`, `when needs a declared bool output` | declare that input or value `bool`, or guard on one that is |
| `no overlay declares a profile named` | select one of the profiles the message lists |
| `was selected with no overlay` | pass the overlay that declares the profile with `--overlay`, or drop `--profile` |
| `may be tuned` | tune only `with` or `provider`; a different target, gate or order is an eject |
| `a disabled node cannot come back under its own id` | add the node under a new id and attach it with `before:` |
| `unresolved-reference:` | check the spelling against the tiers in the grammar reference; leave it only when another environment provides the target |
| `added-node-no-dependents:` | list the nodes that must wait for it under the added node's `before:` |
| `node-no-dependents:` | add it to the `needs` of the node that must wait for it, or make it the node the run ends on |
| `overlay-ignored:` | fold the overlay's changes into the eject, or delete one of the two |
| `unresolved-subrun-input:` | pass the child's required input in `with:`, or remove the key the child does not declare |
| `undecidable-value-type:` | declare the value `bool`, `id` or an `enum` when it is a handle rather than prose |
| `skip-guard-not-pure:` | guard the gate on an input or on a gate's value, or make it a single continue with no `sets` and no `grants`; until then it is asked whatever its guard reads |
| `workflow-undescribed:` | open the companion with a `# Title` line and a paragraph saying what the workflow is for, or add a one-line `description:` |
| `reserved-key:` | remove the key; it does nothing yet |

A cycle, an unreadable file and every other message print without a hint: the message says what
is wrong, and the change is the author's call. A finding on a built-in's own node — one no
project file declares, such as a built-in's `string` value — belongs to the plugin, not the
author. Report it as the built-in's, with no `fix:` line, and do not count it against the
author's files.

The grammar every message refers to is the workflow engine's `references/grammar.md`; point the
author at the section a problem falls under when the message alone leaves them guessing.

---

## Resuming a run

Run `resume-check --state=<run directory>/orchestrator-state.yml`. It reads the state, writes
nothing, and prints the frozen `workflow.name`, `overlays` and `profile` with the run's `title`
and `status`.

- **Exit `1`** — a directory the engine does not resume, such as one started on the 2.x plugin.
  Relay its `message` verbatim and stop.
- **`status` is `completed` or `failed`** — there is nothing left to run. Say so, with the
  run's directory and its dashboard, and stop.
- **Otherwise** — say which run is resuming: its title, its workflow, its overlays and its
  profile. Then invoke `maister:workflow-engine` with the Skill tool, passing the workflow's name
  and the run directory as the resume target, plus any `--from=PHASE` or `--reset-attempts` the
  operator typed. The engine declines those two by name rather than dropping them.

A resume never re-resolves the definition: the graph the run froze is the graph it resumes, so
an overlay or a profile edited since has no effect on it. The name read from state is what the
engine is handed; the folder the run sits in is not consulted.

---

## What this entry does not do

- **Start a chain.** Chains dispatch into member repositories and are started from maister
  cockpit.
- **Run a file by path.** A run starts from a name `locate` resolves. A definition kept anywhere
  else is not a workflow this project can run until it is moved into `.maister/workflows/`.
- **Author anything.** Writing a definition, an eject or an overlay is the author's work; this
  skill reads them and never edits them.
