# Plan-time rules

The rules a chain has to satisfy **at plan time** — the ones the validator does
not report in time to help, or does not report at all. A rule that fails loudly
on the first validate pass is not here: the loop fixes those, and repeating them
in prose is how three copies of one grammar start to disagree. What is here is
everything a first draft gets wrong *before* a verdict exists, plus everything
dispatch enforces that a clean verdict never mentions.

This is a reference for the planner, not a grammar. It cites the grammar rather
than restating it.

---

## 1. Where the grammar is written down

| What | Where to read it |
|---|---|
| The definition and overlay shape — top-level keys, the node key set, the node-id pattern, the gate rule | the contract register, § 10 (B1) |
| The reserved words that parse, warn and do nothing | the contract register, § 15 (R), whose canonical list is a `const` array in the definition schema |
| The workspace manifest, the dispatch envelope and the worker seed — including the frozen seed sections and their cap | the contract register, § 13 (C1, C2, C8) |
| A chain that dispatches into members, with a gate and a guard, written out | `skills/workflow-engine/workflows/development.yml` and its companion `development.md` |
| The smaller shape — a short chain whose gate options and value outputs are worth copying literally | `skills/workflow-engine/workflows/research.yml` and `research.md` |

**Read the two shipped pairs before authoring anything.** They are the only
examples in the tree that are simultaneously valid, dispatching and reviewed,
and both of them state in their own opening prose that there is no routing
construct because the grammar has none. A planner that starts from a shipped
pair and edits it is already past most of section 3.

**Why anything is restated below at all.** The rules in section 2 are the ones a
first draft breaks and no prose a planner reads states — not the register, not
the engine's own skill, not either shipped chain. Three of them are carried by
a contract JSON Schema as a `$defs` pattern or type, which is a machine-readable
constraint rather than a sentence anyone drafts against; the fourth is a
consequence of two rules that are each written down separately and whose
interaction is not. So each rule here is cited to the code symbol that enforces
it and, where a schema carries it too, to the `$defs` that does — edit either
and this file is one grep away. Nothing in section 2 is a second copy of a
register table; where the register carries the rule, this file points at it and
stops.

---

## 2. Five rules no prose a planner reads carries

### 2.1 The `when:` form: exactly one reference, optionally negated

A guard is **one reference and nothing else**. There is no expression language —
no `and`, no `or`, no comparison, no parentheses, no literal. The whole accepted
form is a single interpolation, optionally prefixed with `!`:

```yaml
when: "${inputs.skip_beta}"        # the input's own boolean
when: "!${inputs.skip_beta}"       # its negation
when: "${research.values.has_gap}" # a value output of an upstream node
```

The pattern that decides this is `WHEN_REF` in the graph checker (`graph.mjs`);
the definition schema carries the same pattern and the same sentence as
`$defs/when_ref` in `workflow-definition.schema.json`. It accepts exactly two
subjects: `inputs.<name>`, and `<node-id>.values.<name>`. Anything else is a
located error at the node's `when` path.

Two semantic rules ride on top of the form (`checkWhen` in `graph.mjs`, reading
the needs closures `closuresOf` computes):

- an `inputs.<name>` guard requires that input to be declared `type: bool`;
- a `<node>.values.<name>` guard requires that node to declare `<name>` as a
  `bool` output **and** to sit inside the guarded node's needs closure. Not
  merely earlier in the file — reachable through `needs`.

The closure rule is the one a first draft breaks. A guard reading a value from a
node three steps away is legal only if `needs` actually connects them; adding the
guard without extending `needs` produces an error whose message names the value
rather than the missing edge.

**The planning consequence.** A condition that is genuinely two conditions has to
become two nodes, or one upstream node that computes the conjunction and
declares it as a single `bool` output. Reaching for `and` is the reflex; the
answer is always to move the decision upstream into a node that can make it.

### 2.2 Gate `options:` is a map, not a sequence

The most common first-draft failure, and it looks correct in every direction
except the one that matters. Options are a **mapping from option id to effect**:

```yaml
approve:
  type: gate
  needs: [research]
  ask: "Research is complete. Proceed?"
  options:
    proceed: continue
    revise: stop
    abort: stop
```

Not a sequence of maps, not a sequence of strings. The checker reads the value as
a map and rejects anything else (`checkNodeShape` in `graph.mjs`), and it
enforces three further things: every option id matches the target-name charset; **exactly one**
option has the effect `continue`; and **at least one** has `stop`.

An option may also carry values, in which case its value is a map rather than a
bare effect string — `{effect: continue, values: {...}}`, which `optionEffect`
reads through so both spellings stay one rule. A `values` that is not a map is
an error (`checkNodeShape`).

A gate node carries no `uses:`; its `ask` must be non-empty; and `type` has
exactly one legal member, `gate` (all of them in `checkNodeShape`). The register
carries the one-continue-and-a-stop rule (§ 10, B1), and the map shape is typed
in the definition schema — `options` under `$defs/node` in
`workflow-definition.schema.json`, an object keyed by option id. Neither is a
sentence a planner reads while drafting a gate, which is precisely why drafts
fail on it.

### 2.3 A gate's summary is serialized like a state value, so it is one line

A gate's `ask` is frozen into the graph hash, so it cannot say anything that
depends on the run: whatever the run worked out - which member was selected, how
many checks failed, which route is about to be taken - reaches the operator only
through the **summary** the suspending call carries.

That summary goes through the same canonical serializer as a state write. It
refuses a quote, a newline or a carriage return outright (`value-not-flow-safe`)
rather than escaping them, and it refuses **the whole call**: the request file is
not written, the marker is not set, and the run keeps going instead of
suspending. There is no partial gate.

A multi-line summary template is the natural thing to draft - a heading, then a
bullet per finding - and it is the shape that fails. One chain shipped exactly
that and found it only by running the recipe against the runtime. So:

- One line, no quotes, no newlines. Separate findings with a dash or a
  semicolon, not a line break.
- Say the numbers rather than laying them out. `3 of 7 checks failed; docs-site
  untouched` is a summary; a table is not.
- Long is worse than terse, but long is not what breaks it. A quote breaks it.

Section 3.3 is the same rule for per-run text reaching a worker, for the same
reason and through the same emitter.

### 2.4 Value-output names are `[a-z_]+`

Node ids are hyphenated (`NODE_ID` in `graph.mjs`, and `$defs/node_id` in
`common.schema.json`). Value output names are **not**: they are lowercase letters
and underscores only. The charset is embedded in the guard pattern rather than
checked at the declaration — `WHEN_REF` in `graph.mjs` and `$defs/when_ref` in
`workflow-definition.schema.json` both spell it `[a-z_]+` — so a hyphenated value
name is one no guard can ever read, while what `checkDeclaredValues` judges at
the declaration is the type.

```yaml
outputs:
  values: {has_gap: bool, chosen_path: id}
  artifacts: {report: outputs/research-report.md}
```

So `has_gap`, never `has-gap` — while the node that declares it is `research-
phase`, never `research_phase`. Two charsets, one file, adjacent lines. Getting
them the wrong way round produces an error at the outputs path that reads like a
type problem.

Artifact names are free-form and only checked for existence when something
interpolates them (`checkInterpolations` in `graph.mjs`, through
`referenceProblem`).

### 2.5 A node id that is a reserved word warns

Reserved keys match by **dotted-path suffix** (`RESERVED_PATHS` and
`scanReserved` in `graph.mjs`).
A node's own id becomes part of that path, so naming a node after a reserved
word emits a reserved-key warning against a chain that is otherwise perfect:

```
nodes.loop        →  reserved-key:loop
nodes.validation  →  reserved-key:validation
```

Four of the reserved words are ordinary English a planner reaches for without
thinking: `loop`, `validation`, `assertions`, `backing`. The register (§ 15)
carries the list and what each is claimed by; what it does not say is that the
match is by suffix and therefore catches node ids.

The warning is harmless — reserved words parse, warn and carry no behaviour —
but it is noise on a report whose whole value is that a real warning stands out.
Name the node for what it does: `verify-schema`, not `validation`; `retry-build`,
not `loop`.

---

## 3. Dispatch rules a clean verdict never mentions

Everything in this section is enforced when a node is dispatched into a member
repository, which happens long after validate has said the chain is fine.
Validate reports **one** of them (the driver-capability check, 3.1); the rest
surface as a refused dispatch mid-run, which is the most expensive place to
learn about them.

### 3.1 Driver capability, and how the set is discovered

A node that names a member directory hands its work to a session with **no one
at the keyboard**. A target that asks a question there hangs. So the dispatch
check requires the target to be one that suspends at a gate instead of asking
(`driverCapability` in `envelope.mjs`, whose dispatch-side reading
`assertDriverCapable` refuses `dispatch-workflow-not-driver-capable`):

- `workflow:` targets always pass — the engine runs them, and the engine
  suspends;
- `skill:` targets pass only if the shipped skill file says it honours a driver;
- `agent:` and `direct:` targets never pass. An inline step and an agent are
  work for the coordinating session, not work to hand to a member.

**The capable set is discovered, never listed.** The check reads the skill's
`SKILL.md` — found through the same resolution order the graph checker applies:
the workspace's own `.claude/skills/<name>/` or `.github/skills/<name>/`, then
the plugin's `skills/<name>/`, then every installed plugin's, or exactly the
plugin a `skill:<plugin>:<name>` target names — and accepts it on either of two
declarations: the frontmatter field `driver_aware: true`, which is the
documented way a skill outside the plugin declares it, or the driver rule
literal `orchestrator.driver.kind` in the body, which the built-ins carry
(`DRIVER_AWARE`, `DRIVER_RULE` and `skillText` in `envelope.mjs`). The
rationale recorded beside it is that capability is read off the artifact rather
than from a list kept in code. Discover the set the same way and offer what you
found — a list written down anywhere is wrong the first time a skill is added,
and a workspace skill declaring the field is as much a target as a shipped one.

Three consequences worth carrying:

- **The check reads exactly the file the target resolves to.** A skill whose
  own file carries either declaration passes the check, whatever the skill
  actually does. That is why the planner's own skill file must contain neither
  — a planner that passed as a dispatch target could be dispatched into a
  member, where it would hang on its own question. The literal belongs in this
  file, which the check never reads.
- **The engine is capable and is still not a target.** The workflow engine's
  skill carries the literal, so the rule passes it. Dispatching the engine into
  a member is running the runner inside the run: never emit it as a dispatch
  target, and never list it among the alternatives offered on a refusal. This
  is a rule about what a planner authors, not a change to the check.
- **Work that needs a plan is dispatched as `workflow:plan`.** When a node's
  share of the chain is to decide *how* a member will do something rather than
  to do it, author `workflow:plan` and let the plan the run publishes be what
  the node hands downstream. It passes the check for the ordinary reason — it
  is a `workflow:` target, and the engine suspends — so this is guidance about
  which target fits work of that shape, not an entry in a list of capable
  targets. Discover the set as above; this only says what to reach for.

Since the validate-side check landed, a `dir:` node whose target cannot honour a
driver is a located error at that node's `uses` path — the same shape as the
undeclared-member error, and reported by the workspace validator rather than by
the engine. It is the one dispatch rule the loop catches for you.

The check reports two cases, and they read differently. A target that was read
and does not state the rule is a planning defect. A `skill:` target the
installation holds no file for was never read at all, so the message says that
instead of asserting anything about the file — and the same node also collects
the graph checker's `unresolved-reference` warning, which is not a contradiction:
an unresolved reference is tolerated everywhere except on a node that dispatches,
where the runtime building the envelope has to read the same file. A planner
authoring from the discovered set should never emit either.

### 3.2 A `with:` value containing `${` never reaches the worker

The envelope builder turns a node's `with:` map into the worker's inputs, and it
**skips any value containing `${`** (`inputsOf` in `envelope.mjs`). It also skips
non-strings, and keeps only values that look like paths. The `with:` key becomes
the input's role.

So this reaches the worker:

```yaml
with: {brief: docs/briefs/richtext.md}
```

and this does not:

```yaml
with: {brief: "${inputs.brief}"}
```

The second validates cleanly — interpolation is legal in `with:` and the
reference resolves — and then arrives at the worker as nothing at all. **This is
the single most dangerous plan-time mistake in the file**, because every signal
available before the run says the chain is correct.

Interpolation is not how per-run data reaches a worker. It is how the *engine*
resolves values inside the run.

### 3.3 Per-run text travels through the statement, on one physical line

What a worker is asked to do arrives as the envelope's statement, resolved from
the first non-blank of the dispatch override, `with.statement`, then `with.task`
(`statementOf` in `envelope.mjs`). For a planned chain that means: put the sentence a
worker should read in `with.statement`.

Two constraints on it:

- **One physical line.** Envelope and ledger values are emitted as one-line
  entries, and a value that cannot be emitted safely on one line is refused
  (`value-not-flow-safe`) rather than escaped. A decoded newline, carriage
  return or tab anywhere in a node is additionally a validate-time error
  (`CONTROL_CHARS`, scanned by `scanControlCharacters` in `graph.mjs`) — so the
  block-scalar reflex fails twice over, and the
  reader has no block scalars anyway (section 5).
- **Short.** See 3.4.

`with.autonomy`, `with.statement` and `with.task` are **control** for the seed,
not arguments to the work (`CONTROL_ARGS` in `seed.mjs`). Everything else in `with:` is an
argument, subject to 3.2.

### 3.4 The worker seed has a line budget

The rendered seed prompt is capped at 60 lines (`SEED_LINE_CAP` in `seed.mjs`,
enforced in `renderSeed`), and a
descriptor that would render past the cap is **refused, never truncated** —
`seed-over-cap`. Truncation would silently drop the close-out contract at the
bottom of the prompt, which is the part that tells a worker how to report back.

What spends the budget: the statement's length, the number of `with:` entries
that survive 3.2, and the sibling list — the other dispatches in the same wave,
which is what lets the prompt say how many workers are in flight.

The planning consequence is a shape, not a number: **a small `with:` map and a
short statement.** A node that needs a page of context should name a path to a
document in the member repository rather than carry the page. Wide waves cost
budget too — five simultaneous dispatches put four siblings in every one of the
five prompts.

### 3.5 Provider and autonomy resolve down a chain, and refuse at the end of it

Both resolve, neither defaults silently.

**Provider** (`resolveProvider` in `envelope.mjs`): the node's own `provider:`, then the run
state's, then the member's `default_provider` in the manifest. Nothing found is
`dispatch-node-incomplete`. Note what is *not* in the chain: the manifest's
`defaults` block is deliberately not consulted for a provider.

**Autonomy** (`resolveAutonomy` in `envelope.mjs`): `with.autonomy`, then the member's, then
`defaults.autonomy`. Nothing found is `dispatch-autonomy-unresolved`; a value
outside the four-tier enum is `dispatch-autonomy-unknown`.

Autonomy is the safer of the two, because a scaffolded manifest always carries
`defaults.autonomy`. Provider is not: a member with no `default_provider` and a
node with no `provider:` is a chain that validates perfectly and refuses at
dispatch. **Write `provider:` on every dispatching node** unless the manifest
demonstrably carries the member default — it costs one line and removes a
mid-run refusal.

`provider:` on a base node is unvalidated by the graph checker; only an overlay
tune checks it against the two known values (`checkOps` in `graph.mjs`). A typo in a
provider name is therefore a dispatch-time refusal, not a validate-time error.

---

## 4. Shape rules

These are legal-and-wrong rather than illegal: the validator accepts them, the
run does something other than what the author meant.

### 4.1 There is no fan-out, so a guard repeats

There is no `foreach:`, no routing construct and no loop. The words exist as
reserved warnings and nothing else, and both shipped chains say so in their own
opening prose. A chain over three repositories has three nodes.

The consequence that catches drafts is subtler than the absence itself.
**A skipped node satisfies everything downstream.** A false guard marks its node
`skipped`, and `skipped` counts as satisfied for `needs` — so a stretch of nodes
behind one condition does not inherit the condition from its first node. Every
node in the stretch repeats the guard, **including the gate that closes it**:

```yaml
dev-beta:   {uses: workflow:development, needs: [approve], dir: repo-beta, when: "${plan.values.do_beta}"}
test-beta:  {uses: workflow:development, needs: [dev-beta], dir: repo-beta, when: "${plan.values.do_beta}"}
sign-beta:  {type: gate, needs: [test-beta], when: "${plan.values.do_beta}", ask: "…", options: {ok: continue, no: stop}}
```

Drop the guard from `sign-beta` and a run that skipped the whole stretch still
stops at a gate asking about work it did not do. This is the rule most worth
checking twice before publishing, because a review of the definition reads
correctly — the mistake only appears in a run.

**One deliberate exception, and it has to be written down.** Sometimes the gate
asking about work that did not happen is the point: a routing gate whose whole
job is to report which way the run went should fire on the no-target route too,
or a chain that selected nothing ends silently and the operator never learns it
selected nothing. An unguarded closing gate is the only way to say that — the
grammar has no way to write "always ask, even when the stretch was skipped" — so
a chain that needs it leaves the guard off on purpose and **says so in the prose
companion, in that node's own section**. Without the sentence the definition is
indistinguishable from the mistake above, and the next reader corrects it.

Note what the gate can then show: a skipped node contributes no artifact, so the
request lists one fewer than a full run would, and the summary (2.3) is where the
run says a no-target route was taken. A grammar that could express the intent
directly is a contract change, not something a chain can ask for today.

### 4.2 Prose sections are keyed by exact heading equality

An inline node's step text lives in the companion `.md` beside the definition,
found by swapping `.yml` for `.md`. The section is matched by scanning heading
lines, stripping the leading hashes and **all backticks**, trimming, and
requiring the result to **equal** the node id (`hasProseSection` in `graph.mjs`):

```markdown
## `collect-results`     ✓ matches node id collect-results
## collect-results       ✓ matches
## Collect results       ✗ no match
## Notes on collect-results   ✗ no match
```

Not a prefix, not a case-insensitive comparison, not a slug. An unmatched
inline reference is an error and always will be: the companion is the one
reference a definition fully controls, which is why it stays an error while an
unresolved skill or agent reference only warns.

Write one section per inline node, and name the heading with the node id in
backticks — the shipped pairs do, and it reads as the identifier it is.

### 4.3 Prefer `bool`, `id` and `enum` value outputs over `string`

A value output typed `bool`, `id` or an `enum` of non-empty strings is provably
safe to carry on a one-line flow entry. One typed `string` is not provably
unsafe either, so it is accepted with a warning rather than refused
(`checkDeclaredValues` in `graph.mjs`).

That warning is the signal to think again. A `string` output is usually one of
three things wearing the wrong type: a boolean the author did not want to commit
to; a closed set that deserves an `enum`; or an artifact, which belongs under
`outputs.artifacts` as a path rather than under `values` as prose. Only the
genuinely open-ended remainder should stay a `string`, and a guard can never
read one anyway — guards require `bool` (2.1).

### 4.4 The top-level `inputs:` map, and why guards should not read it

`inputs:` is a mapping of input name to a small map carrying at least `.type`.
**No type enum is validated** — `string`, `bool`, `path` all parse: `buildGraph`
carries the `inputs:` map through untouched. The one place a type is enforced at
all is a guard (`checkWhen`): an input a `when:` reads must be declared
`type: bool`.

**One input attribute has a meaning: `tracker_key: true`.** It marks the input
whose value is the ticket the run was started from. The engine reads it off the
`resolve` report (`tracker_key`, the marked input's name or null) and writes that
input's supplied value into `task.key` in the freeze patch, which is what makes
the cockpit's tracker mirror adopt the existing ticket as the run's parent
instead of opening a fresh epic beside it. The checker holds it to one input per
definition and to `type: string`; everything else about it is inert, and the mark
reaches no node, so adding it to a published chain does not move its graph hash.
It needs no schema change either — B1's input shape does not close its
properties, so a reader pinned to `contracts-v4` tolerates the attribute and
simply does not act on it.

**A chain planned from a ticket declares it.** The ticket input the plan already
requires — `ticket: {type: string, required: true}` — becomes
`ticket: {type: string, required: true, tracker_key: true}`, and the plan file
says the run supplies it with the ticket key. A chain not planned from a ticket
marks nothing, and its runs carry no `task.key`.

Inputs are the values a *run* supplies at start time. That is their whole
purpose, and it is also the reason a guard should rarely read one: a chain whose
branch depends on an input is a chain that behaves differently depending on
whether the person starting it remembered a flag, and nothing in the dry-run
tells them which flag mattered.

**Prefer a guard fed by an upstream node's `bool` value output.** The chain then
decides its own branch from work it actually did, the decision is visible in the
run, and the closure rule (2.1) guarantees the deciding node ran before the
guarded one. Declare an input when a run genuinely carries something in from
outside — a brief path, a target release — and say in the plan file how a run
supplies it.

### 4.5 What is never validated, and therefore never caught

Three keys pass through the checker untouched and are worth a second read before
publishing:

- **`on:`** is never validated at all — only scanned for interpolation and drawn
  in the diagram. Its semantics are prose: `completed` and `skipped` satisfy
  `needs`, while `failed` and `stopped` satisfy only under `on: failure` and
  `on: always`. A misspelled `on:` value is silent.
- **`dir:`** is not checked by the engine; the workspace validator checks it
  against the manifest's members, and an interpolated `dir:` is skipped
  entirely.
- **`optional:`** on a base node is unvalidated; only an overlay tune requires it
  to be a boolean.

---

## 5. The reader accepts a subset of YAML

The definition reader is a small hand-written subset, not a full YAML parser. It
takes block maps and sequences — including a block mapping opened on a sequence
dash — flow maps and sequences **closed on one line**, single- and
double-quoted scalars, bare scalars, comments, and the usual scalars — `null`,
`~`, `true`, `false`, numbers.

Everything else stops the read with one located error. The refusals a planner is
most likely to author:

- **block scalars `|` and `>`** — which is the reflex for a long `ask` or
  statement, and it fails twice, because the resulting newline would be an error
  anyway (3.3);
- **anchors and aliases** — the reflex for repeating a `with:` map across three
  member nodes. Repeat it literally instead;
- **multi-document markers** and a document not starting at column 0;
- **tags**, a duplicate key in one mapping, a multi-line quoted scalar, a flow
  collection left open across lines;
- **tabs in indentation**, and any escape outside `\n \t \r \\ \" \/` — there is
  no `\uXXXX`.

A read that stops produces a single located error and no document, so the loop
sees one problem where there may be several. Draft in the subset from the start:
the shipped pairs never leave it.

---

## 6. Reading the verdict

Two shapes come back under one exit code, and they mean opposite things:

- **located errors** — `{file, node, path, message}` — the definition is wrong,
  and the path says where. Edit and re-validate.
- **a refusal** — `{code, message}` — the *invocation* was wrong: an unusable
  root, an unreadable manifest. Re-validating changes nothing; look the code up
  in the workspace runtime's own refusal table and take its recovery.

Warnings are bare strings from a three-word vocabulary —
`reserved-key:<path>`, `unresolved-reference:<node>:<target>` and
`undecidable-value-type:<path>` — and warnings alone never fail a validate.

**The verdict carries no counts.** There is no node count and no gate count
anywhere in it; the "valid — N nodes, N gates" line a reviewer sees is computed
by the caller from the resolved node list. A planner reporting counts computes
them itself.

An unresolved `skill:` or `agent:` reference warns rather than errors, because
such a target may be provided by an environment the static check cannot see —
an external plugin, a workspace eject. The trade-off is deliberate and it costs
something: a typo in a skill name now surfaces at run time. A planner has no
excuse for one, since it authors from the discovered set; treat an
`unresolved-reference` naming a target you emitted as your own defect, fix it
once, and re-validate.

---

## 7. The checklist: every plan-time rule, once

**This is the one enumeration of these rules.** The skill points here rather
than carrying a second copy, and nothing else in the plugin should list them
either — a rule stated twice is a rule that will eventually be stated two ways.
Each item names the section above that explains it and cites the code.

It is not a substitute for the loop; it is the list of what the loop cannot tell
you. Run it against the draft before publishing.

1. Does every guard read a `bool` from a node inside its needs closure, rather
   than an input? (2.1, 4.4)
2. Are gate options a **map**, with exactly one `continue` and at least one
   `stop`? (2.2)
3. Is every gate summary one line, with no quote and no newline in it? (2.3)
4. Are value names `[a-z_]+` and node ids hyphenated? (2.4)
5. Is any node named after a reserved word? (2.5)
6. Does every `dir:` node name a declared member, a driver-capable target, and
   its own `provider:` — and does its autonomy tier resolve somewhere along the
   node/member/`defaults` chain? (3.1, 3.5)
7. Does any `with:` value contain `${`? If so, it will vanish. (3.2)
8. Is the per-run text carried by the statement, on one short physical line, and
   is the `with:` map small enough that a wide wave still renders inside the
   seed's line budget? (3.3, 3.4)
9. Does the guard repeat on every node of each conditional stretch, the closing
   gate included — or, where a gate is deliberately unguarded so that a skipped
   stretch is still reported, does the companion say so? (4.1)
10. Does the companion carry one heading per inline node, equal to the node id?
    (4.2)
11. Is every `string` value output genuinely open-ended? (4.3)
12. Does the definition stay inside the reader's subset — no block scalars, no
    anchors? (5)
