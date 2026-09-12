---
name: maister:chain-planner
description: Turns a one-paragraph task description into a validated multi-repository chain. Reads the workspace manifest for its members, their providers and its defaults, decides which nodes exist and how they depend on one another, and drafts the definition together with the prose companion that carries its inline steps. The draft is proved with the workspace's own validator before anything is published — three files land under `.maister/workflows/` only after the loop ends clean, and a run that will not validate is reported rather than written. For a user this is `/maister:chain-planner "<task>"`, run from inside the workspace; the derived file stem, every refusal and every warning are reported in plain language, and the chain is then reviewed in the cockpit's dry-run before any run starts. It authors only constructs the grammar actually has, and it starts nothing. With `--generated` the chain is published for one ticket into the generated home, `.maister/workflows/generated/`, where it is ignored by git and pruned once its run closes.
argument-hint: "\"<task>\" [--name STEM] [--root DIR] [--generated] [--force] [--draft-to DIR]"
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

**It leaves the workspace's chain set as it was on a refusal, and says so
first.** Every row of the refusal table below ends with no chain published,
because the loop drafts into a scratch directory and publishes only at the end.
The scratch directory and the outcome marker are the two things that do land
under `.maister/`, and both are accounted for below.

---

## Invocation

The planner owns no validator. Its oracle is the umbrella runtime's `validate`
verb, reached exactly as that skill reaches it:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/umbrella/scripts/umbrella.mjs validate --root <root> --definition <draft>
```

The plugin root is this plugin's own directory — the one holding
`.claude-plugin/plugin.json` — and the variable naming it is set in the session
environment. Use it as written; do not work the directory out and substitute a
path of your own.

The exec form belongs here and nowhere a user reads. The plugin's command
reference documents the slash command and names no script — a user types
`/maister:chain-planner`, and this file is where the invocation behind it is
recorded.

| A user types | What runs |
|---|---|
| `/maister:chain-planner "<task>"` | the loop below: derive the stem, draft into the scratch directory, validate the draft against the current working directory, publish into `<cwd>/.maister/workflows/` |
| `/maister:chain-planner "<task>" --name STEM` | the same, with the derivation skipped — `STEM` is used as given and still held to the charset and length rules |
| `/maister:chain-planner "<task>" --root DIR` | the same against `DIR` as the workspace root |
| `/maister:chain-planner "<task>" --generated` | the same, published into `<root>/.maister/workflows/generated/` — the home of chains authored for one ticket or one run rather than kept for reuse |
| `/maister:chain-planner "<task>" --force` | the same, permitted to publish over files of that stem that already exist |
| `/maister:chain-planner "<task>" --draft-to DIR` | the same loop, drafted into `DIR` and **published nowhere** — the workspace's chain directory is not written to at all |
| `/maister:chain-planner` | one AskUserQuestion for the task text, then as above |

`--force` and `--generated` are bare booleans, as `--force` is on the workspace
scaffold verb: each takes the bare form or an explicit `--force=false`, and
never consumes the token after it. `--root` defaults to the current working
directory, because a user runs this from inside the workspace they mean.

**A generated chain is a chain like any other, kept apart.** It is resolved by
the engine by name, second in its order — after an eject at the top of the
workflow directory, before an overlay and the built-in — and it validates by
the same rules. What differs is its life: it carries the text of one ticket,
so its home is ignored by git; it is complete in itself, so it is never
overlaid and never ejected; and it is deleted by the workspace runtime's
`prune` verb once every run that named it has closed. A chain that will be
started more than once is not generated, and does not take the flag.

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
  is the floor because that is B1's floor for the identifiers in the file —
  `^[a-z][a-z0-9-]{1,40}$`, two characters at minimum — and a stem the grammar
  would reject as an identifier is a stem to refuse before anything is drafted.
- **Begins with a digit** — prefix it so it starts with a letter rather than
  dropping the digit, which would silently change what the name says.
- **Collides** with a built-in workflow name, with a file already under
  `.maister/workflows/`, or with one under `.maister/workflows/generated/` —
  refuse, whichever home the draft is bound for: the engine looks a name up
  across both, so a collision in either shadows. The planner never disambiguates
  by appending a number, because a chain called `<task>-2` tells a later reader
  nothing about how it differs from `<task>`.

  **Name both ways out in the message, every time**: `--name STEM` to publish
  under a different stem, or `--force` to publish over the files that are there.
  Neither is guessable from a refusal that only says the name is taken, and a
  shared workspace meets this by design rather than by accident — the stem is
  derived from the task paragraph by an algorithm, so two operators planning one
  task derive one name and the second of them is refused. Say that too, so the
  collision reads as the guard working rather than as a defect.
- **Otherwise** — the stem satisfies `/^[a-z][a-z0-9-]*$/` and is at least two
  characters. A `--name` given explicitly is held to the same two rules; it
  skips the derivation, not the check.

### Node identifiers are chosen, not derived

The chain name is derived: the algorithm above turns one paragraph into one stem,
and three sessions reading the same paragraph produce the same file name
character for character. **Node identifiers are not.** They follow the
decomposition — which nodes exist at all, and what each one is for — and the
decomposition is a judgement this skill makes rather than a function of the text.
Three sessions planning one paragraph have produced the same chain name and
different node identifiers, and that is the expected result, not a defect to fix
by hashing the paragraph: a scheme that stabilized only the spelling would
advertise a stability the planner cannot deliver, because the set of nodes would
still differ.

So **nothing downstream may use a node identifier as a reference that holds
across runs.** Not a report keyed on one, not a tracker row, not a comparison of
two plannings of one task. Within a single chain an identifier is exactly a
reference — it is what `needs:`, a guard and the prose companion's headings all
match on, by exact equality — and that is its whole scope. The references that do
hold across runs are the **chain name**, which is derived, and the **run id**,
which the engine mints; name those when something outside one chain needs to
point at work.

Choose identifiers for the reader, then, since nothing else constrains them: name
the node for what it does, keep the hyphenated charset (§ 2.4 of the reference),
and avoid the reserved words (§ 2.5).

### What it reads

- `<root>/.maister/umbrella.yml` — the member names and their paths, the
  per-member default provider, `defaults.autonomy`, `defaults.worktree` and the
  branch convention. This is the whole of what the planner knows about the
  workspace; it never walks a member repository to find out more.
- `<root>/.maister/workflows/*.yml` and `<root>/.maister/workflows/generated/*.yml`
  — for the collision check, and for nothing else.
- **The driver-capable target set, discovered rather than listed.** Which
  skills can honour a driver — the workspace's own, the plugin's, any installed
  plugin's — is read off the skill files by the same rule the dispatch check
  applies; `references/plan-time-rules.md` names the rule, the two ways a skill
  declares it and the order the file is looked for in. No inventory of capable
  targets is kept in this file or anywhere else, because an inventory drifts the
  moment a skill is added.
- **The engine is excluded from what the planner authors, not from the rule.**
  The workflow engine's own skill satisfies the capability rule and remains
  dispatchable as far as the runtime is concerned. The planner simply never
  emits it as a `dir:` target and never offers it among the alternatives it
  lists on a refusal — a chain that dispatches the engine into a member is a
  chain running the runner inside the run.
- `references/plan-time-rules.md` — the rules the validator does not report in
  time to help.
- `skills/workflow-engine/workflows/development.{yml,md}`, `research.{yml,md}`
  and `plan.{yml,md}` — the three shipped pairs, as worked examples of the
  shape.

### What it writes, and nothing else

Three files, all under one directory: `<root>/.maister/workflows/` by default,
`<root>/.maister/workflows/generated/` with `--generated`:

| File | What it carries |
|---|---|
| `<name>.yml` | the definition |
| `<name>.md` | the prose companion — one section per inline node, keyed by the node id |
| `<name>.plan.md` | the reasoning a dry-run reviewer reads |

It writes nothing under a member directory, nothing into another workspace, and
nothing outside the framework directory. It starts no run and edits no run's
frozen definition.

**The generated home is created on first use when the workspace predates it.**
The workspace scaffold verb creates `.maister/workflows/generated/` with an
ignore file inside it, so nothing ticket-derived is committed by default. A
workspace scaffolded before that verb learned to may lack the directory; a
generated publish then creates it, and drops the same ignore file into it,
spelled exactly as the scaffold verb spells it — these two lines and no others:

```
*
!.gitignore
```

An ignore file already there is left alone, whatever it says.

### Drafting without publishing

`--draft-to DIR` runs the whole loop and stops before the publish: the three
files land in `DIR`, the draft is validated there, the report says what it says,
and **nothing is written under `<root>/.maister/workflows/`** — not the chain, not
the scratch directory, not the generated home. `DIR` is created if it is not
there; a caller who names a directory with files of that stem in it already is
refused the same way a publish is, because overwriting a draft someone is reading
is the same mistake as overwriting a chain.

**The collision check still reads the real name set.** That is the point of the
flag rather than an aside: the reason the dogfood had to build a read-only mirror
of a real workspace by hand was that seeing a chain before it exists meant
copying the manifest and the existing chain files so the check saw the true
names. So a draft is told about a collision it *would* have hit — against the
built-ins, against `<root>/.maister/workflows/` and against its generated home —
and reports it as a warning about the eventual publish rather than as a refusal,
because there is no publish to refuse. Everything else the planner reads, it
still reads from `--root`: the members, their providers, the defaults, the
driver-capable set.

`--generated` still decides which home the name is checked against, and which
path the report names as where the chain *would* go. `--force` is meaningless
here and is reported as ignored rather than silently dropped — there is nothing
to publish over.

The outcome marker is written beside the draft, in `DIR`, as it would be beside a
published chain. A draft is an attempt, and an attempt has an outcome.

### The draft-validate-publish loop

**The scratch directory is named, and it is inside the target home**:

```
<target home>/.<name>.draft/
```

— so `.maister/workflows/.docs-refresh.draft/` for a reusable chain, and
`.maister/workflows/generated/.docs-refresh.draft/` for a generated one. Not a
system temporary directory, which is the trap this replaced: one of the two
supported providers refuses a write there even under a blanket tool grant,
because its file tool verifies the path against the directories the session was
given rather than asking about the tool. No grant flag makes that go away, and a
session that meets it drafts wherever it can — which was its own session-state
directory, a location nothing else can find. Both providers grant a write under
the working directory, and the draft sitting beside its destination makes
publication a rename inside one directory. The leading dot keeps it
non-contractual, so nothing enumerating the workflow home reads it as a chain.

**Remove it on both endings**, success and refusal alike: a draft left behind is
a half-chain in the home a reviewer browses. The outcome marker is what records
that the attempt happened; the draft directory is not.

The pair is drafted **side by side** in there — both files, same stem, differing
only by extension, because the prose companion is found by swapping the
extension of the definition's own path. The draft is validated where it lies,
against `--root`; the validator uses the definition path as given and re-anchors
nothing, so a draft outside its eventual home validates exactly as the published
file would.

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

**A chain planned from a ticket marks its ticket input.** When the task the chain
is planned from is a tracker ticket, declare the input that carries its key as
`ticket: {type: string, required: true, tracker_key: true}`. The mark is what
makes the run's `task.key` the ticket, and so what makes the tracker mirror adopt
that ticket as the run's parent instead of opening a fresh epic beside it — and
what makes every dispatch envelope the run builds carry the ticket too, so a
chain finds its own earlier dispatches for a ticket by matching a field rather
than by grepping a statement. One mark, both consequences; nothing else to
declare. At
most one input per definition carries the mark and it must be `type: string`;
the checker rejects a second one and a non-string one. Details and the reason it
needs no schema change: `references/plan-time-rules.md` § 4.4.

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

- **the definition's path relative to the workspace root, first** — for a
  generated chain, `.maister/workflows/generated/<name>.yml` — so a chain whose
  node invoked this skill can carry it onward as a declared `string` value, and
  then the other two paths. **Under `--draft-to` the paths are the draft's, and
  the report says nothing was published** before it says anything else: a caller
  who reads a path and a clean verdict and nothing about publication will treat a
  draft as a chain;
- **the node count and the gate count, quoted from the verdict** — the validator
  reports them per definition, so the numbers on the report are the ones the
  oracle produced rather than a second count taken here;
- a node-by-node reading: what each node does, where it dispatches, what guards
  it;
- every warning with its file, node and path, and whose file it is;
- the next step, exactly: open the cockpit's *Start a chain*, pick `<name>.yml`
  — from the generated group, for a generated chain — and read the dry-run.

---

## When a plan is refused

Every row writes nothing. Say that first, then the recovery.

| Refusal | Recovery |
|---|---|
| **Not a workspace** — `--root` holds no manifest at `.maister/umbrella.yml`. | There is nothing to plan against: member names, providers and defaults all come from the manifest. Run the workspace init command in the directory that holds the repositories, then plan again. Point `--root` at the workspace if the current directory was not it. |
| **No members declared** — the manifest is there and declares none. | Nothing can be dispatched, so the chain would be gates and inline nodes only, entirely inside the coordinating repository. Say so, and ask whether that is what was meant. If members were expected, the workspace init command registers them; a member is a checkout under the workspace or its members root. |
| **The task needs fan-out, routing, or a loop** — one node over an unknown set, a choice of branch decided at run time, or a repeat-until. | Say what the chain would need, and why it cannot be written — `references/plan-time-rules.md` § 4.1 carries the reason. Then offer the shape that does exist: explicit nodes, one per known target, each behind its own guard — which is the reason the member set has to be known at plan time. |
| **A dispatch names a member the manifest does not declare.** | List the members the manifest does declare, with their paths, so the intended one can be named or added. A member name is not a repository name and not a path — it is the key the manifest uses, and a `dir:` accepts only that key. A path is refused: the member reaches the branch a worker hands to git, and a path carries a separator no branch segment may. |
| **A dispatch target cannot honour a driver.** | Name the target the task implied and say why it cannot be dispatched: dispatched work runs with no one to answer a question, so the target has to be one that suspends at a gate instead of asking. Then list the driver-capable alternatives **as discovered** — never the engine, which is the runner rather than a target — or drop the dispatch and run the step in the coordinating repository. |
| **`--name` is empty, too short, or off the charset.** | Say which of the three, quote what was derived or given, and ask for `--name` explicitly. The stem is lowercase letters, digits and hyphens, starts with a letter, and is at least two characters. |
| **`<name>` collides with a built-in workflow name.** | A workspace definition of that name shadows the built-in one wherever the built-in is named, so the collision is not cosmetic. Ask for a different stem with `--name STEM`; do not append a number. `--force` is not an option here — there is no file to publish over, and shadowing a built-in is not something to force past. |
| **`<name>.yml` already exists in the target home and `--force` was not given.** | This is the guard working, and the message names both ways out: `--name STEM` to publish under a different stem, or `--force` to publish over the files that are there. Say which files exist, and say why two operators reach this on one task — the stem is derived, so one paragraph yields one name. And check first whether a run of that chain is in flight: a run freezes its graph, so republishing over the definition it froze drifts the graph out from under it, and the next dispatch of that run is refused rather than silently running the new shape. |

---

## What this skill does not do

- **It does not start anything.** No run, no dispatch, no worker. The chain it
  writes is reviewed in the cockpit's dry-run and started there.
- **It does not publish under `--draft-to`.** A draft is a file to read, in the
  directory the caller named. Planning twice with that flag leaves the
  workspace's chain directory exactly as it was, both times.
- **It does not validate anything itself.** One oracle, invoked as above. A
  second opinion written here would be a second grammar to keep in step.
- **It does not repair a workspace.** A missing manifest, a member that is not
  declared, a target that cannot be dispatched — each is reported with its
  recovery and handed back. The user decides.
- **It does not disambiguate a name.** A collision is a question for whoever
  named the task, not a suffix.
- **It does not write outside `.maister/workflows/`** under the root it was
  given — the generated home and the scratch directory are both inside it — and
  it never writes into a member repository. Nothing it writes reaches a system
  temporary directory, a home directory or a session-state directory.
- **It does not delete a generated chain.** That is the workspace runtime's
  `prune` verb, once the chain's runs have closed.
