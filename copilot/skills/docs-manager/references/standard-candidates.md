# Standard Candidates

The one description of a standard candidate: the implementer and the fix loop write them to it,
finalization consolidates and files them by it, and every other step points here.

## What a candidate is

Knowledge that helps the next change get it right the first time: a convention the code follows,
a pitfall met during the work, or an important fact about the code. Each comes with its reason —
what went wrong without it, or what it protects.

The idea is kept open on purpose. A project uses its standards as a knowledge base, so none of
these is set aside for what it is — once offered, a candidate is closed only by a person's choice
or by time (*Closing a candidate*):

- one whose scope is a domain, a module or a single feature rather than the whole project;
- one that a test also enforces — offered, though never recommended (*Offered, not recommended*);
- one that cannot be checked by reading a diff.

**A project's own wording wins.** A project may widen or narrow this description in its `.github/copilot-instructions.md`
block or at the top of its standards index; read both before writing or judging a candidate, and
follow them over this file.

## How one is written

One bullet, on one line, compact — a few clauses, never a section:

```
- <the rule or fact> — why: <what went wrong or what it protects>; where: <the class of code it governs, naming a place beyond this change>; shown by: <what in this work showed it>[; caught by: <the check>]
```

- **The rule first**, in the words the standard would use, then the reason, then the scope.
- **The hazard, not the feature.** The rule names the mistake a future change in another feature
  or module would plausibly make; this change is only its example, in `shown by`. A lesson met in
  one feature usually states a general hazard ("a check holds only until the next await").
- **`where` names a second place.** The class of code the rule governs — a project,
  domain, module or feature — with at least one place in it other than this change. When no
  second place comes to mind, the line is a fact about this module (*Where one belongs*) or
  "None".
- **Not caught already.** When a check failed on the mistake and its failure said what to do, the
  line ends with `caught by: <the check>` (*Offered, not recommended*).
- **Not a helper trick or a process note.** A workaround for one test helper, library quirk or
  fixture is a code comment beside that helper, part of the change, never a candidate. A note
  about how the work is done goes to the contributor guide, never to a standard (*Where one
  belongs*).
- **Nothing that goes stale**: no exact counts, line numbers, dates, ticket references or
  identifiers that only hold today. Name the concept, not the current call site.
- **"None" is a good answer.** Prefer it over restating what an existing standard already says,
  and over something true only for this one change.
- **A decision is not a rule about code.** A product or authority decision met in the work
  ("a reopened decision is the owner's alone") is still a candidate, written like any other; its
  destination is a project document, not a standards file.

## Where one belongs

- **A standards file** (`.maister/docs/standards/<category>/<topic>.md`) — a way of writing code:
  a convention, a pattern, a pitfall to avoid.
- **A project document** — any file under `.maister/docs/project/`, whatever the project calls it
  (a decision log, a glossary, an architecture note). The better fit for a decision, or for a
  fact about the system rather than a way of writing code. Any Markdown file is accepted as it
  is, with no frontmatter or fixed name.
- **The project's architecture note** — for a fact about how one module works today: what it
  holds, what it owns, how it is wired. It is the project document that describes the system's
  structure, whatever it is called; with none, the suggestion is a new
  `.maister/docs/project/architecture.md`.
- **The project's contributor guide** — for a note about how the work is done: gates, sessions,
  worktrees, commands run, merge tactics. It is the guide the project names in its `.github/copilot-instructions.md`
  block, else a `CONTRIBUTING.md` at the project root, else a project document already written
  for contributors. With none, the suggestion is a new `.maister/docs/project/contributing.md` —
  never a file at the project root created unasked; the person may still choose one when the
  destination is confirmed.

A process note or a module fact is still offered like any candidate, but never as a standard:
neither is a way of writing code.

## Offered, not recommended

A candidate a test, lint rule, type check or build already fails on, with a failure that says
what to do, is still offered — the knowledge stays open to the person — but never recommended,
however many runs met it. Its line names the check (`caught by: <check>`), and consolidation
copies it to `caught_by`. A check whose failure does not explain the rule — a timeout that names
nothing, a type error far from its cause — does not catch it: the line names no check, and the
candidate is judged like any other.

## Consolidation

Run once at finalization, by the docs-manager operation of that name, before the run hands its
candidates over. It never writes a document.

1. **Merge duplicates.** The same lesson from different groups, in different words, becomes one
   candidate in the clearest wording; every source line stays as its evidence.
2. **Match against the open queue** — the open candidates of earlier runs, which the caller passes
   as *The open queue* prints them. Match by hazard, not by wording: a line that teaches the same
   lesson as a queued candidate — the same failure mode, whatever the feature or module it was
   met in — is that candidate seen again. It is not offered again: it becomes an attachment
   naming the queued candidate by the id its queue line opens with, with this run's evidence and
   wording (`attached` in *The run's candidates file*). With no queue passed, every line goes on
   to the next step. Then match the queue's candidates against each other the same way: two or
   more that teach one lesson, as runs on separate branches leave, are a merge pair, the oldest
   (first in the queue) its target.
3. **Match against what the project holds.** Scan INDEX.md and read the standards and project
   documents it points to that touch each candidate's topic — their text, not only their
   headings.
   - A near-duplicate of an existing rule becomes **extend**: the rule's file and heading, and
     what the candidate adds to it.
   - A candidate an existing rule already says in full is **already held**: named with that rule,
     not offered, so the person sees it was not lost.
4. **Tidy the wording** to *How one is written*: the rule, the reason, the scope, nothing that
   goes stale. The meaning is never changed.
5. **Suggest a destination** for each, by *Where one belongs*: an existing file, or a new one
   named for its topic. Route by what the line is, whatever destination it suggests: a note
   about how the work is done — its `shown by` a command run rather than code — goes to the
   contributor guide, and a fact about how one module works, its `where` that module alone with
   no class of code, to the architecture note; neither is ever suggested a standards file. A
   helper trick is left out (*How one is written*).
6. **Keep at most five new lessons.** Attachments and already-held lines do not count: they file
   nothing new. Rank the rest — first a candidate that guards security or data loss and names
   the failure it prevents; then one whose evidence spans more than one group or fix of this
   run; then an extend that changes what a contributor would do; then the others, with one a
   check already catches last. Offer the first five and drop the rest, counting them.
7. **Return** each candidate offered — its label, line, action and the rule it extends,
   destination and evidence, with `guards` and `caught_by` when they apply, as *The run's
   candidates file* describes them — then each attachment, each already-held line with the rule
   that holds it, how many new lessons were dropped over the cap, and each merge pair.

The person still chooses: consolidation orders and places, it never decides what is kept.

## The run's candidates file

A workflow run never writes a standard and asks nothing about its candidates. Finalization writes
what consolidation returned to `standard-candidates.json` in the task directory, then files it in
the project's candidate store with
`node <plugin root>/skills/standards-update/scripts/candidates.mjs file --run=<task dir>` from the
project root, relays the candidate lines its wrap-up carries (*The close*), and names
`/maister:standards-update` once under **Next**. Run with no argument, standards-update
offers that run's candidates in the same session, and in a fresh one the most recent run that
still has something to apply — its own candidates and the open ones it attached to; a closed
candidate (*Closing a candidate*) is never offered again.

The run's file stays in its task directory as the record of what that run found; the store is
what every later step reads. The file is JSON:

- `version` — `3` for a file written to this description, or folded in; a file without it, or
  with `1` or `2`, predates the store and is folded into it once (*Folding in earlier runs*).
- `candidates` — each one offered: `id` (short, unique in the file), `label` (its few words),
  `line` (the candidate line), `action` (`new` or `extend`), `extends` (the rule's file and
  heading, for `extend`), `destination` (the suggested file), `evidence` (which groups or fixes
  showed it, as text or a list), `guards` (`security` or `data-loss`, only when the candidate
  guards one and its why names the failure it prevents) and `caught_by` (the check that already
  catches it, only then). Filing adds `store`, the candidate's id in the store. An earlier file's
  `recommended` and `reason` are ignored.
- `attached` — each `{id, evidence, line}`: an open candidate this run met again, `id` its store
  id as the queue printed it, `evidence` this run's groups or fixes, and `line`, optional, this
  run's own wording. An attachment is never offered on its own:
  filing adds this run to that candidate's `seen_in`. A file written before the store names the
  candidate as `{run, id}` instead, its run and its id in that run's file.
- `already_held` — each `{line, held_by}`: the rule that already says it.
- `dropped` — how many new lessons were left out over the cap of five; 0 or absent when none
  were. Filing keeps the first five new candidates of the file and adds any more to this count.
- `merges` — each `{into, ids}`: a merge pair, `into` its target. After filing, finalization
  runs `candidates.mjs merge --into=<into> --id=<id>…` for each.
- `consolidated` — false when consolidation failed and the lines are the work log's as written
  (each then `action` `new`, its destination the likeliest file by *Where one belongs*, and no
  `guards`).

`id`, `label`, `line` and `destination` are required; an entry without them is not filed. Filing
the same run again adds nothing.

## The candidate store

`.maister/standard-candidates/`, beside `.maister/docs/` and never under `standards/`, so it is
neither read nor indexed as a standard. It holds one file per candidate, `<id>.json`, and is the
open queue's one source of truth: filing, the queue, the offer, applying, dismissing and merging
read and write it, and nothing else does. The folder is meant to be committed
with the standards, its `.gitattributes` included, so the queue is the same in every clone and
worktree and a teammate's candidates, sightings and dismissals reach everyone once merged.

**The id** is `<run date>-<label slug>-<hash>`: the filing run's date, the label in lowercase
words joined by hyphens (at most 40 characters), and the first six hex digits of sha256 over
`<run>#<id in the run's file>`. The run and its own id make it unique in the project, across
branches too, and stable: filing the same run again finds its file by the hash.

**The file** keeps one key to a line and one sighting to a line:

```
{
  "id": "2026-11-20-token-check-before-await-3f9a2c",
  "label": "Token check before await",
  "action": "new", … "state": "open", "closed": null,
  "seen_in": [
    {"run":"development/2026-11-20-auth-retry","date":"2026-11-20","evidence":"groups 2 and 3"}
  , {"run":"performance/2026-11-28-cache","date":"2026-11-28","evidence":"fix 1"}
  ]
}
```

Its keys, in this order: `id`, `label`, `line`, `action`, `extends`, `destination`, `guards`,
`caught_by` (each as the run's file gives it, null when absent), `state` (`open`, `applied`,
`dismissed` or `merged`), `closed` (null while open; `{date}` when applied; `{reason, by, date}`
when dismissed; `{into, date}` when merged) and `seen_in`, one `{run, date, evidence}` per run that met it, the filing run first.
A run is named `<type>/<name>`, its task directory's last two folders, always with a forward
slash, and dated by the `YYYY-MM-DD` that opens its name, else the day its candidates file was
last written. No other date or time is written.

**Merging branches.** A new candidate is a new file, so two branches filing candidates never conflict.
Two branches that attach to the same candidate each add a sighting at the same place, just
before the closing bracket; each sighting after the first opens with its comma, and the store's
`.gitattributes` (`*.json merge=union`, written once with the folder and never overwritten) has
git keep both lines, which still parse. Two branches that close the same candidate differently
keep both sides' `state` and `closed` lines; the later line wins on read. A merge is the same:
closing lines on the merged file, appended sightings on its target. Reading takes one
sighting a run, the first in the file, and the next write to that file leaves it in shape. A file that does not parse is named under the
script's problems and left out, never a failure.

## Folding in earlier runs

Any verb of the script first takes in run folders written before the store, and only what would
still read as open: a valid candidate that its run's `standard-candidates-applied.json` neither
applies nor dismisses, and that another earlier run attached to or whose run is dated 30 days or
less before `--today` (*Closing a candidate*), becomes a store file with its run's sighting; then
each attachment `{run, id}` onto one adds its run's sighting. The rest are left out, no file
written for them, and one line on stderr counts them. Each folded run's file is then written back as version 3, every entry kept, each one
in the store given `store`, with `folded: {expired, closed}` counting what was left out; so no
later verb folds it in again, and `file` files only the entries it names in the store.
`candidates.mjs import` folds in alone and the same way; anything already in the store is skipped.

## Closing a candidate

A candidate stays open until one of four things closes it — the first three stored in its file,
the fourth worked out each time the script reads it:

1. **applied** — a person wrote it into a standard or document through standards-update.
2. **dismissed** — a person reviewed it and declined it, with a reason.
3. **merged** — it teaches another candidate's lesson, and `merge --into=<id> --id=<id>…` closed
   it into that one: its sightings join the target's, one a run, and count for it even when
   written to it later. Refused for an unknown id, itself, or a closed candidate or target;
   merging again writes nothing.
4. **expired** — no second run has met it (`seen_in` holds its filing run alone) and that
   sighting, its newest, is dated more than 30 days before today. Nothing is written or deleted:
   it stays in the store, reported as expired, and a later run that meets the same lesson files
   it as new, since the queue no longer holds it.
5. otherwise **open** — offered, and listed in the queue.

A run's attachment shares the state of the candidate it names, so closing a candidate closes
every attachment to it. The script's `applied`, `dismiss` and `merge` verbs are the only writers,
by store id; `dismiss --run=<task dir> --all` takes every candidate that run filed and is open or
dismissed. Applying a dismissed candidate takes its dismissal back; applying or dismissing a
merged one, or dismissing an applied one, is refused.

**`recommended`** is never written: the script works it out on read, with its `reason`. A
candidate is recommended when it has been seen in two runs or more (`reason`: "seen in N runs"),
or when it guards security or data loss and names the failure it prevents (`reason`: "guards
security" or "guards data loss") — unless it has a `caught_by`, which no support outweighs.
Nothing else recommends one: not that it extends a rule the project has, and not evidence from
several groups of one run, which only orders it. A candidate the standards already hold is not a
candidate at all (`already_held`).

## The open queue

Every open candidate in the store, one line each, as
`node <plugin root>/skills/standards-update/scripts/candidates.mjs queue` prints it from the
project root. `--skip=<task dir>` leaves one run out — the run being consolidated: its candidates
are not listed and its sightings not counted — `--tasks` names another tasks folder (the store is
the folder beside it), and `--today=<YYYY-MM-DD>` sets the day expiry is judged on (default:
today, in UTC). The output is stable: consolidation reads the text, and a tool reads `--json`.

**Text**, oldest filing run first and each run's candidates by id:

```
<id> [<action>; seen in <N>] <label>: <rule>
```

`<id>` is the store id an attachment names; `<action>` is `new`, or `extend <extends>`; `<N>` is
the length of `seen_in`; `<rule>` is the candidate line without its leading `- ` and without
everything from ` — why:` on. With no open candidate it prints nothing. A file it cannot read, or
an entry that is not a candidate or an attachment, is one line on stderr,
`candidates: <path>: <message>`, and never a failure: the exit is 0, and 2 only on a usage error.

**`--json`** prints one document, `{queue, closed, problems}`:

- `queue` — each open candidate, in the text's order: `run` (the filing run, `<type>/<name>`),
  `dir` (that run's task directory under the tasks folder, absolute — a teammate's run may not be
  in this checkout), `date` (the filing sighting's date), `id` (the store id), `label`, `rule`,
  `action` (`new` or `extend`), `extends` (null for `new`), `destination`, `seen_in` (run names,
  the filing run first), `recommended`, `reason` (null when not recommended) and `caught_by`
  (null when no check catches it).
- `closed` — `{applied, dismissed, expired, merged}`: how many candidates each state holds.
- `problems` — each `{path, message}`, as stderr names them in the text form.

## The close

`node <plugin root>/skills/standards-update/scripts/candidates.mjs close --run=<task dir>` prints
the lines a run's close carries about its candidates, from the store and the run's file: a line
naming the run, its task directory and the store; each candidate it filed, in its file's order,
with its action, why it is recommended or how many runs saw it, the check that catches it, its
label, destination, evidence and store id, and whether it is closed; each candidate it met again
and each merge it made, with how many runs have now seen it; each already-held line with its
rule; how many lessons were dropped over the cap; and a line when consolidation failed. A run
that filed nothing prints nothing. `run-complete` prints these lines in the wrap-up, below its
pointer, and the close relays them as printed.
