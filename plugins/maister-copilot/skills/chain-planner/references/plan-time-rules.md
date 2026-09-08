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

**Why anything is restated below at all.** Three of the rules in section 2 are
enforced by code and appear in no prose anywhere — not in the register, not in
the engine's own skill, not in either shipped chain. A fourth is a consequence
of two rules that are each written down separately and whose interaction is
not. A rule that exists nowhere in prose has to live somewhere, so it lives
here, each one cited to the code that enforces it. Nothing in section 2 is a
second copy of a register table; where the register carries the rule, this file
points at it and stops.

---

## 2. Four rules the register does not carry

### 2.1 The `when:` form: exactly one reference, optionally negated

A guard is **one reference and nothing else**. There is no expression language —
no `and`, no `or`, no comparison, no parentheses, no literal. The whole accepted
form is a single interpolation, optionally prefixed with `!`:

```yaml
when: "${inputs.skip_beta}"        # the input's own boolean
when: "!${inputs.skip_beta}"       # its negation
when: "${research.values.has_gap}" # a value output of an upstream node
```

The pattern that decides this lives in the graph checker (`graph.mjs:52`,
`WHEN_REF`), and it accepts exactly two subjects: `inputs.<name>`, and
`<node-id>.values.<name>`. Anything else is a located error at the node's
`when` path.

Two semantic rules ride on top of the form (`graph.mjs:718-739`, closures at
`:798-812`):

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
a map and rejects anything else (`graph.mjs:624-655`), and it enforces three
further things: every option id matches the target-name charset; **exactly one**
option has the effect `continue`; and **at least one** has `stop`.

An option may also carry values, in which case its value is a map rather than a
bare effect string — `{effect: continue, values: {...}}`. A `values` that is not
a map is an error (`graph.mjs:601-604`, `:639-641`).

A gate node carries no `uses:`; its `ask` must be non-empty; and `type` has
exactly one legal member, `gate` (`graph.mjs:613-615`). The register carries the
one-continue-and-a-stop rule (§ 10, B1); the *map* shape it does not, which is
precisely why drafts fail on it.

### 2.3 Value-output names are `[a-z_]+`

Node ids are hyphenated. Value output names are **not**: they are lowercase
letters and underscores only (`graph.mjs:90`, checked at `:672-694`), and the
guard pattern in 2.1 accepts nothing else either.

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
interpolates them (`graph.mjs:787-789`).

### 2.4 A node id that is a reserved word warns

Reserved keys match by **dotted-path suffix** (`graph.mjs:99-108`, `:360-376`).
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
(`envelope.mjs:315-327`, refusing `dispatch-workflow-not-driver-capable`):

- `workflow:` targets always pass — the engine runs them, and the engine
  suspends;
- `skill:` targets pass only if the shipped skill file says it honours a driver;
- `agent:` and `direct:` targets never pass. An inline step and an agent are
  work for the coordinating session, not work to hand to a member.

**The capable set is discovered, never listed.** The check reads
`skills/<name>/SKILL.md` and matches the driver rule literal
`orchestrator.driver.kind` in the text (`envelope.mjs:329-341`); the rationale
recorded beside it is that capability is read off the shipped artifact rather
than from a list kept in code. Discover the set the same way and offer what you
found — a list written down anywhere is wrong the first time a skill is added.

Two consequences worth carrying:

- **The grep reads exactly `skills/<name>/SKILL.md`.** A skill whose own file
  quotes that literal passes the check, whatever the skill actually does. That
  is why the planner's own skill file must not contain it — a planner that
  passed as a dispatch target could be dispatched into a member, where it would
  hang on its own question. The literal belongs in this file, which the grep
  never reads.
- **The engine is capable and is still not a target.** The workflow engine's
  skill carries the literal, so the rule passes it. Dispatching the engine into
  a member is running the runner inside the run: never emit it as a dispatch
  target, and never list it among the alternatives offered on a refusal. This
  is a rule about what a planner authors, not a change to the check.

Since the validate-side check landed, a `dir:` node whose target cannot honour a
driver is a located error at that node's `uses` path — the same shape as the
undeclared-member error, and reported by the workspace validator rather than by
the engine. It is the one dispatch rule the loop catches for you.

### 3.2 A `with:` value containing `${` never reaches the worker

The envelope builder turns a node's `with:` map into the worker's inputs, and it
**skips any value containing `${`** (`envelope.mjs:450-458`). It also skips
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
(`envelope.mjs:350-356`). For a planned chain that means: put the sentence a
worker should read in `with.statement`.

Two constraints on it:

- **One physical line.** Envelope and ledger values are emitted as one-line
  entries, and a value that cannot be emitted safely on one line is refused
  (`value-not-flow-safe`) rather than escaped. A decoded newline, carriage
  return or tab anywhere in a node is additionally a validate-time error
  (`graph.mjs:451-472`) — so the block-scalar reflex fails twice over, and the
  reader has no block scalars anyway (section 5).
- **Short.** See 3.4.

`with.autonomy`, `with.statement` and `with.task` are **control** for the seed,
not arguments to the work (`seed.mjs:82`). Everything else in `with:` is an
argument, subject to 3.2.

### 3.4 The worker seed has a line budget

The rendered seed prompt is capped at 60 lines (`seed.mjs:79`, `:392-399`), and a
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

**Provider** (`envelope.mjs:407-419`): the node's own `provider:`, then the run
state's, then the member's `default_provider` in the manifest. Nothing found is
`dispatch-node-incomplete`. Note what is *not* in the chain: the manifest's
`defaults` block is deliberately not consulted for a provider.

**Autonomy** (`envelope.mjs:426-442`): `with.autonomy`, then the member's, then
`defaults.autonomy`. Nothing found is `dispatch-autonomy-unresolved`; a value
outside the four-tier enum is `dispatch-autonomy-unknown`.

Autonomy is the safer of the two, because a scaffolded manifest always carries
`defaults.autonomy`. Provider is not: a member with no `default_provider` and a
node with no `provider:` is a chain that validates perfectly and refuses at
dispatch. **Write `provider:` on every dispatching node** unless the manifest
demonstrably carries the member default — it costs one line and removes a
mid-run refusal.

`provider:` on a base node is unvalidated by the graph checker; only an overlay
tune checks it against the two known values (`graph.mjs:1036-1038`). A typo in a
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

### 4.2 Prose sections are keyed by exact heading equality

An inline node's step text lives in the companion `.md` beside the definition,
found by swapping `.yml` for `.md`. The section is matched by scanning heading
lines, stripping the leading hashes and **all backticks**, trimming, and
requiring the result to **equal** the node id (`graph.mjs:295-307`):

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
(`graph.mjs:672-694`).

That warning is the signal to think again. A `string` output is usually one of
three things wearing the wrong type: a boolean the author did not want to commit
to; a closed set that deserves an `enum`; or an artifact, which belongs under
`outputs.artifacts` as a path rather than under `values` as prose. Only the
genuinely open-ended remainder should stay a `string`, and a guard can never
read one anyway — guards require `bool` (2.1).

### 4.4 The top-level `inputs:` map, and why guards should not read it

`inputs:` is a mapping of input name to a small map carrying at least `.type`.
**No type enum is validated** — `string`, `bool`, `path` all parse
(`graph.mjs:432`, `:718-722`). The one place a type is enforced is a guard: an
input a `when:` reads must be declared `type: bool`.

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
takes block maps and sequences, flow maps and sequences **closed on one line**,
single- and double-quoted scalars, bare scalars, comments, and the usual
scalars — `null`, `~`, `true`, `false`, numbers.

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
- **a block mapping opened on a sequence dash** — `- key: value` is refused,
  while a flow map on the dash is fine;
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

## 7. A checklist worth running before publishing

Not a substitute for the loop — a list of what the loop cannot tell you.

1. Does every guard read a `bool` from a node inside its needs closure, rather
   than an input? (2.1, 4.4)
2. Are gate options a **map**, with exactly one `continue` and at least one
   `stop`? (2.2)
3. Are value names `[a-z_]+` and node ids hyphenated? (2.3)
4. Is any node named after a reserved word? (2.4)
5. Does every `dir:` node name a declared member, a driver-capable target, and
   its own `provider:`? (3.1, 3.5)
6. Does any `with:` value contain `${`? If so, it will vanish. (3.2)
7. Is the statement one short physical line, and is the `with:` map small enough
   that a wide wave still renders? (3.3, 3.4)
8. Does the guard repeat on every node of each conditional stretch, the closing
   gate included? (4.1)
9. Does the companion carry one heading per inline node, equal to the node id?
   (4.2)
10. Is every `string` value output genuinely open-ended? (4.3)
11. Does the definition stay inside the reader's subset — no block scalars, no
    anchors? (5)
