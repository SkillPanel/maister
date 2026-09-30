---
name: maister:run
description: Starts or resumes a workflow by name from the terminal — a workflow the project defines in `.maister/workflows/`, an eject or an overlay of a built-in, or a built-in itself. Looks the name up, validates the definition, collects the inputs it declares (asking only for required ones that are missing) and hands the run to the workflow engine, which owns the task directory, the freeze, every node and every gate from there. Given a run's task directory instead of a name, it resumes that run; with `--list`, it lists the project's own workflows. Chains — definitions whose nodes dispatch into member repositories — are started from maister cockpit, not here.
argument-hint: "<name> [\"title\"] [key=value ...] [--profile=NAME] [--overlay=PATH ...] | <run directory> | --list"
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

The first word decides the mode: a directory holding `orchestrator-state.yml` (tried as given,
then under `.maister/tasks/*/`) is a resume; `--list` is a listing; anything else is a name.

**Listing.** Run `locate` with no name. It lists the definitions the project keeps in
`.maister/workflows/` — overlays, built-in names and generated chains left out — each with its
name, its companion's title and opening paragraph, whether it is a `chain`, and an `error` when
it cannot be run by its name. Print one line per workflow, marking chains ("started from maister
cockpit") and broken ones (with the error), and stop. `/maister:work` reads this list to offer the
project's workflows beside the built-in ones.

**With no argument**, list them the same way, then ask with AskUserQuestion which to start,
offering none marked chain or broken. When nothing is listed, say where a workflow lives
(`.maister/workflows/<name>.yml`, with its prose in `<name>.md`) and stop.

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
  input, naming its type. Never ask for an optional input or one with a default, and never for
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

`MAISTER_WORKFLOW_PROSE` plays no part in this entry: it selects a built-in's prose twin, and a
twin is reached only through that workflow's own command. `/maister:run <built-in>` runs the
built-in on the engine, which is also the way to give a built-in a profile.

---

## Resuming a run

Read the run's `orchestrator-state.yml` with the Read tool and take `workflow.name`,
`workflow.overlays` and `workflow.profile` from its `workflow:` block, with `task.title` and
`task.status`.

- **No `workflow:` block** — the run was started by a prose orchestrator and has no frozen graph
  to resume. Say that `/maister:work <run directory>` resumes those, and stop.
- **`task.status` is `completed` or `failed`** — there is nothing left to run. Say so, with the
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
