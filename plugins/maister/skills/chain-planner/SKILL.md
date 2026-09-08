---
name: maister:chain-planner
description: Turns a one-paragraph task description into a validated multi-repository chain. Reads the workspace manifest for its members, their providers and its defaults, decides which nodes exist and how they depend on one another, and drafts the definition together with the prose companion that carries its inline steps. The draft is proved with the workspace's own validator before anything is published — three files land under `.maister/workflows/` only after the loop ends clean, and a run that will not validate is reported rather than written. For a user this is `/maister:chain-planner "<task>"`, run from inside the workspace; the derived file stem, every refusal and every warning are reported in plain language, and the chain is then reviewed in the cockpit's dry-run before any run starts. It authors only constructs the grammar actually has, and it starts nothing.
argument-hint: "\"<task>\" [--name STEM] [--root DIR] [--force]"
user-invocable: true
---

# Chain Planner

A paragraph in, a proved chain out. A user describes work that spans several
repositories of one workspace; this skill reads the workspace manifest, decides
which nodes exist and how they depend on one another, writes the definition and
the prose companion that carries its inline steps, and proves the pair against
the workspace's own validator before publishing anything.

**It is a generator, not a runtime.** It never starts a run, never builds an
envelope, never touches a ledger or an outbox, and never edits the definition a
run has already frozen. Everything it produces is a file a person reads before
anything is launched — the review step is the cockpit's dry-run, and it is not
optional.

**It authors only what the grammar has.** A task that would need a construct the
grammar lacks is refused with what the shape would have to be, rather than
written in a spelling the reader would only warn about — a chain that reads as
if it worked. `references/plan-time-rules.md` § 4.1 is where the absent
constructs are named and where the consequence that catches drafts is worked
through; this file states it nowhere else, so there is one copy to keep true.

**It writes nothing on a refusal, and says so first.** Every row of the refusal
table below leaves the workspace byte-for-byte as it was, because the loop
drafts into a temporary directory and publishes only at the end.

---

## Invocation

The planner owns no validator. Its oracle is the umbrella runtime's `validate`
verb, reached exactly as that skill reaches it:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/umbrella/scripts/umbrella.mjs validate --root <root> --definition <draft>
```

The exec form belongs here and nowhere a user reads. The plugin's command
reference documents the slash command and names no script — a user types
`/maister:chain-planner`, and this file is where the invocation behind it is
recorded.

| A user types | What runs |
|---|---|
| `/maister:chain-planner "<task>"` | the loop below: derive the stem, draft into a temporary directory, validate the draft against the current working directory, publish into `<cwd>/.maister/workflows/` |
| `/maister:chain-planner "<task>" --name STEM` | the same, with the derivation skipped — `STEM` is used as given and still held to the charset and length rules |
| `/maister:chain-planner "<task>" --root DIR` | the same against `DIR` as the workspace root |
| `/maister:chain-planner "<task>" --force` | the same, permitted to publish over files of that stem that already exist |
| `/maister:chain-planner` | one AskUserQuestion for the task text, then as above |

`--force` is the bare boolean, as it is on the workspace scaffold verb: it takes
the bare form or an explicit `--force=false`, and never consumes the token after
it. `--root` defaults to the current working directory, because a user runs this
from inside the workspace they mean.

### Exit codes

The oracle's exit code is the loop's stop condition, and there are four
outcomes, not three — a budget that runs out is its own ending.

| Exit | Meaning | What the planner does |
|---|---|---|
| `0` | The draft is accepted. Warnings may still be present; warnings alone never block. | Stop and publish. Report every warning with its file, node and path. |
| `1` | Rejected. The report carries either **located** errors (`{file, node, path, message}`) or a **refusal** (`{code, message}`) — two different shapes from the same exit code. | Located: edit the draft at those paths and re-validate, at most three passes. Refusal-shaped: this is not a definition error. Stop, publish nothing, and report the code with its recovery from the workspace runtime's own table. |
| `2` | The runtime did not start — a missing module, malformed flags, or input that was not JSON. Nothing was attempted. | Stop immediately, quote the stderr message verbatim, publish nothing. Do **not** do by hand what the script would not do. |
| — | Three passes spent and errors remain. | Publish nothing. Say that first, then name every remaining error with its file, node, path and message, and where the draft can be read. |

The `2` row and the refusal half of the `1` row are the two that tempt an
editor: the validator would not judge the draft, so the draft looks
publishable. It is not. A chain published without a verdict is exactly the drift
the oracle exists to prevent.

---

## When a user invokes this skill

### The arguments

The first quoted string of the invocation is the task text. Everything else is a
flag, and every flag has a default.

**Exactly one question is ever asked, with AskUserQuestion, and only when the
task text is absent.** Nothing else is asked — not the stem, not the root, not
whether to overwrite. The planner runs headless under a dispatch driver as
readily as it runs in a terminal, and a session with no one at the keyboard
cannot answer a second question. Where a flag is missing, its default applies;
where a default would be wrong, the answer is a refusal with its recovery, not a
prompt.

### Deriving `--name`

The stem is derived by an algorithm, not by judgement, so two providers reading
one paragraph produce one file name. Run it in order:

1. Lowercase the task text.
2. Replace every run of non-alphanumeric characters with a single hyphen.
3. Drop leading and trailing hyphens.
4. Take the first three hyphen-separated words.
5. Cap the result at 40 characters, trimming back to a word boundary rather than
   cutting a word in half.

Then four cases decide what happens to it:

- **Empty, or shorter than two characters** — refuse and ask for `--name`. Two
  is the floor rather than one because node ids derived from the stem are held
  to a longer minimum than file names are, so a one-letter stem is a legal file
  name that yields an illegal node id.
- **Begins with a digit** — prefix it so it starts with a letter rather than
  dropping the digit, which would silently change what the name says.
- **Collides** with a built-in workflow name or with a file already under
  `.maister/workflows/` — refuse. The user names it; the planner never
  disambiguates by appending a number, because a chain called `<task>-2` tells a
  later reader nothing about how it differs from `<task>`.
- **Otherwise** — the stem satisfies `/^[a-z][a-z0-9-]*$/` and is at least two
  characters. A `--name` given explicitly is held to the same two rules; it
  skips the derivation, not the check.

### What it reads

- `<root>/.maister/umbrella.yml` — the member names and their paths, the
  per-member default provider, `defaults.autonomy`, `defaults.worktree` and the
  branch convention. This is the whole of what the planner knows about the
  workspace; it never walks a member repository to find out more.
- `<root>/.maister/workflows/*.yml` — for the collision check, and for nothing
  else.
- **The driver-capable target set, discovered rather than listed.** Which
  shipped skills can honour a driver is read off the shipped artifacts by the
  same rule the dispatch check applies; `references/plan-time-rules.md` names
  the rule and the file it is read from. No inventory of capable targets is kept
  in this file or anywhere else, because an inventory drifts the moment a skill
  is added.
- **The engine is excluded from what the planner authors, not from the rule.**
  The workflow engine's own skill satisfies the capability rule and remains
  dispatchable as far as the runtime is concerned. The planner simply never
  emits it as a `dir:` target and never offers it among the alternatives it
  lists on a refusal — a chain that dispatches the engine into a member is a
  chain running the runner inside the run.
- `references/plan-time-rules.md` — the rules the validator does not report in
  time to help.
- `skills/workflow-engine/workflows/development.{yml,md}` and
  `research.{yml,md}` — the two shipped pairs, as worked examples of the shape.

### What it writes, and nothing else

Three files, all under `<root>/.maister/workflows/`:

| File | What it carries |
|---|---|
| `<name>.yml` | the definition |
| `<name>.md` | the prose companion — one section per inline node, keyed by the node id |
| `<name>.plan.md` | the reasoning a dry-run reviewer reads |

It writes nothing under a member directory, nothing into another workspace, and
nothing outside the framework directory. It starts no run and edits no run's
frozen definition.

### The draft-validate-publish loop

The pair is drafted **side by side in a temporary directory** — both files, same
stem, differing only by extension, because the prose companion is found by
swapping the extension of the definition's own path. The draft is validated
there, against `--root`; the validator uses the definition path as given and
re-anchors nothing, so a draft outside the workspace validates exactly as the
published file would.

Publication happens once, at the end, and only on a clean ending: all three
files, or none of them. A publish over an existing `<name>.yml` is refused
unless `--force` was given.

### Warnings

Warnings never block, and they are not all the planner's to fix.

- **An `unresolved-reference` warning naming a target the planner itself
  authored is the planner's own defect.** It authored from the discovered set,
  so a reference that did not resolve means it emitted a target that is not
  there. Fix it once, re-validate, and surface the result.
- **Every other warning is surfaced and never retried.** Retrying a warning the
  chain cannot influence spends the budget on nothing.
- **A warning whose `file` is the manifest is the workspace's, not the chain's.**
  A freshly scaffolded workspace always carries one reserved-key advisory. Say
  so explicitly — reporting it as a defect of the generated chain sends the user
  looking through a file that is correct.

### The rules the planner enforces itself

The validator does not report these, or does not report them in time to help.
They are enumerated in exactly one place — `references/plan-time-rules.md` § 7,
whose eleven items each cite the section that explains the rule and the code
that enforces it. **Run that checklist against the draft before publishing**, and
read the sections it points at for anything the draft does not obviously
satisfy. The list is not repeated here: three copies of one grammar is how the
copies start to disagree, and the checklist is a file read away.

### Inputs

**The default shape is: no inputs.** Every guard's boolean comes from an
upstream node's declared value outputs, and that node sits inside the guarded
node's needs closure — the validator checks the closure, and a boolean that
comes from the run itself is a boolean a person had to remember to set.

A top-level `inputs:` map is declared only for values a run genuinely supplies
at start time. When the planner does declare one, the plan file says how a run
supplies it; an input nobody knows how to set is a chain that cannot be started
by the person who reads it.

### The plan file

`<name>.plan.md` carries four required headings, spelled exactly as below and in
this order. The prose under each is free; the headings are not, so a reviewer
knows what to expect — and the contract suite pins them against a checked-in
plan file, in both directions:

1. **The task, as given** — the user's text verbatim, not a paraphrase.
2. **The nodes** — a table saying what each node does and why it exists.
3. **The guards** — every guard, and where its boolean comes from.
4. **Refusals considered and rejected** — what the planner declined to author,
   and why. A reader who wonders why there is no fan-out node finds the answer
   here rather than assuming it was forgotten.

### The success report

Plain language, never the raw JSON unless the user asks for it:

- the three paths written;
- **the node count and the gate count, computed by the planner** — the verdict
  carries neither, so a report that quotes the validator has no counts to quote;
- a node-by-node reading: what each node does, where it dispatches, what guards
  it;
- every warning with its file, node and path, and whose file it is;
- the next step, exactly: open the cockpit's *Start a chain*, pick `<name>.yml`,
  and read the dry-run.

---

## When a plan is refused

Every row writes nothing. Say that first, then the recovery.

| Refusal | Recovery |
|---|---|
| **Not a workspace** — `--root` holds no manifest at `.maister/umbrella.yml`. | There is nothing to plan against: member names, providers and defaults all come from the manifest. Run the workspace init command in the directory that holds the repositories, then plan again. Point `--root` at the workspace if the current directory was not it. |
| **No members declared** — the manifest is there and declares none. | Nothing can be dispatched, so the chain would be gates and inline nodes only, entirely inside the coordinating repository. Say so, and ask whether that is what was meant. If members were expected, the workspace init command registers them; a member is a checkout under the workspace or its members root. |
| **The task needs fan-out, routing, or a loop** — one node over an unknown set, a choice of branch decided at run time, or a repeat-until. | Say what the chain would need, and why it cannot be written — `references/plan-time-rules.md` § 4.1 carries the reason. Then offer the shape that does exist: explicit nodes, one per known target, each behind its own guard — which is the reason the member set has to be known at plan time. |
| **A dispatch names a member the manifest does not declare.** | List the members the manifest does declare, with their paths, so the intended one can be named or added. A member name is not a repository name and not a path — it is the key the manifest uses. |
| **A dispatch target cannot honour a driver.** | Name the target the task implied and say why it cannot be dispatched: dispatched work runs with no one to answer a question, so the target has to be one that suspends at a gate instead of asking. Then list the driver-capable alternatives **as discovered** — never the engine, which is the runner rather than a target — or drop the dispatch and run the step in the coordinating repository. |
| **`--name` is empty, too short, or off the charset.** | Say which of the three, quote what was derived or given, and ask for `--name` explicitly. The stem is lowercase letters, digits and hyphens, starts with a letter, and is at least two characters. |
| **`<name>` collides with a built-in workflow name.** | A workspace definition of that name shadows the built-in one wherever the built-in is named, so the collision is not cosmetic. Ask for a different stem; do not append a number. |
| **`<name>.yml` already exists and `--force` was not given.** | This is the guard working. Decide deliberately: a different stem, or `--force`. And check first whether a run of that chain is in flight — a run freezes its graph, so republishing over the definition it froze drifts the graph out from under it, and the next dispatch of that run is refused rather than silently running the new shape. |

---

## What this skill does not do

- **It does not start anything.** No run, no dispatch, no worker. The chain it
  writes is reviewed in the cockpit's dry-run and started there.
- **It does not validate anything itself.** One oracle, invoked as above. A
  second opinion written here would be a second grammar to keep in step.
- **It does not repair a workspace.** A missing manifest, a member that is not
  declared, a target that cannot be dispatched — each is reported with its
  recovery and handed back. The user decides.
- **It does not disambiguate a name.** A collision is a question for whoever
  named the task, not a suffix.
- **It does not write outside `.maister/workflows/`** under the root it was
  given, and it never writes into a member repository.
