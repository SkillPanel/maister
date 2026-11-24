# Standard Candidates

The one description of a standard candidate. The implementer writes candidates to it, a fix loop
writes one to it, finalization's consolidation reads them against it and against the open queue
of earlier runs, and hands them over in the run's candidates file; `standards-update` and the
project's `CLAUDE.md` block point here rather than restating it.

## What a candidate is

Knowledge that helps the next change get it right the first time: a convention the code follows,
a pitfall met during the work, or an important fact about the code. Each comes with its reason —
what went wrong without it, or what it protects.

The idea is kept open on purpose. A project uses its standards as a knowledge base, so none of
these is set aside for what it is:

- one whose scope is a domain, a module or a single feature rather than the whole project;
- one that a test also enforces;
- one that cannot be checked by reading a diff.

**A project's own wording wins.** A project may widen or narrow this description in its own words
— in its `CLAUDE.md` block or at the top of its standards index. Read both before writing or
judging a candidate, and follow what they say over this file.

## How one is written

One bullet, on one line, compact — a few clauses, never a section:

```
- <the rule or fact> — why: <what went wrong or what it protects>; where: <project, domain, module or feature>; shown by: <what in this work showed it>
```

- **The rule first**, in the words the standard would use, then the reason, then the scope.
- **Nothing that goes stale**: no exact counts, line numbers, dates, ticket references or
  identifiers that only hold today. Name the concept, not the current call site.
- **"None" is a good answer.** Prefer it over restating what an existing standard already says,
  and over something true only for this one change.
- **A decision is not a rule about code.** A product or authority decision met in the work
  ("a reopened decision is the owner's alone") is still worth keeping — write it as a candidate
  like any other; its destination is then a project document, not a standards file.

## Where one belongs

- **A standards file** (`.maister/docs/standards/<category>/<topic>.md`) — a way of writing code:
  a convention, a pattern, a pitfall to avoid.
- **A project document** — any file under `.maister/docs/project/`, whatever the project calls it
  (a decision log, a glossary, an architecture note). The better fit for a decision, or for a
  fact about the system rather than a way of writing code. Any Markdown file is accepted as it
  is; none needs frontmatter or a fixed name.

## Consolidation

Run once at finalization, before the run hands its candidates over, by the docs-manager
operation of that name. It reads; it never writes a document.

1. **Merge duplicates.** The same lesson from different groups, in different words, becomes one
   candidate in the clearest wording; every source line stays as its evidence.
2. **Match against the open queue** — the open candidates of earlier runs, which the caller passes
   as *The open queue* prints them. Match by hazard, not by wording: a line that teaches the same
   lesson as a queued candidate — the same failure mode, whatever the feature or module it was
   met in — is that candidate seen again. It is not offered again: it becomes an attachment,
   `{run, id, evidence}`, naming the queued candidate and carrying this run's groups or fixes as
   its evidence. With no queue passed, every line goes on to the next step.
3. **Match against what the project holds.** Scan INDEX.md and read the standards and project
   documents it points to that touch each candidate's topic — their text, not only their
   headings.
   - A near-duplicate of an existing rule becomes **extend**: the rule's file and heading, and
     what the candidate adds to it.
   - A candidate an existing rule already says in full is **already held**: named with that rule,
     not offered, so the person sees it was not lost.
4. **Tidy the wording** to *How one is written*: the rule, the reason, the scope; counts, line
   numbers and stale identifiers taken out. The meaning is never changed.
5. **Suggest a destination** for each, by *Where one belongs*: an existing file, or a new one
   named for its topic.
6. **Return**, for each candidate offered: a label of a few words, the candidate line, the action
   (new or extend, with the rule extended), the suggested destination, and the evidence (which
   groups or fixes showed it). Then each attachment, and each already-held line with the rule
   that holds it.

The person still chooses: consolidation orders and places, it never decides what is kept.

## The run's candidates file

A workflow run never writes a standard and asks nothing about its candidates. Finalization writes
what consolidation returned to `standard-candidates.json` in the task directory, lists the
candidates in its close with that task directory, and names `/maister:standards-update` once
under **Next**. Run with no argument in the same session, standards-update finds the close and
offers that run's candidates; in a fresh session it finds the most recent run whose file still
holds something to apply and offers it — its own candidates and the open ones it attached to.
Either way an applied candidate is not offered again. The file is JSON:

- `version` — `2` for a file written to this description. A file without it was written
  earlier and is read the same way: no attachments, nothing dismissed.
- `candidates` — each one offered: `id` (short, unique in the file), `label` (its few words),
  `line` (the candidate line), `action` (`new` or `extend`), `extends` (the rule's file and
  heading, for `extend`), `destination` (the suggested file), `evidence` (which groups or fixes
  showed it), `recommended` (true when well supported — its evidence in more than one place, or
  its action extending a rule the project already has) and `reason` (why, when recommended).
- `attached` — each `{run, id, evidence, line}`: a lesson of this run that an open candidate of
  an earlier run already teaches. `run` names that candidate's run as `<type>/<name>` — its task
  directory's last two folders, always with a forward slash — and `id` the candidate in it;
  `evidence` is this run's groups or fixes, and `line`, optional, this run's own wording. An
  attachment is never offered on its own: it adds this run to that candidate's `seen_in`.
- `already_held` — each `{line, held_by}`: the rule that already says it.
- `consolidated` — false when consolidation failed and the lines are the work log's as written
  (each then `action` `new`, its destination the likeliest file by *Where one belongs*, and
  `recommended` false).

`id`, `label`, `line` and `destination` are required; an entry without them is not offered.
Which candidates have been applied is recorded beside it, in `standard-candidates-applied.json`,
by standards-update's script — never by hand, and never in the candidates file itself.

**`seen_in`** is never written: the script reads it across runs. A candidate's `seen_in` is its
own run, then every other run whose `attached` names it, each once, ordered by run date and then
by name. A run's date is the `YYYY-MM-DD` that opens its directory name, else the day its
candidates file was last written. Applying a candidate closes every attachment that names it.

## The open queue

Every open candidate of every run under `.maister/tasks/`, one line each, as
`node <plugin root>/skills/standards-update/scripts/candidates.mjs queue` prints it from the
project root. `--skip=<task dir>` leaves one run out — the run being consolidated — and `--tasks`
names another tasks folder. The output is stable: consolidation reads the text, and a tool reads
`--json`.

**Text**, oldest run first and each run's candidates in file order:

```
<run>#<id> [<action>; seen in <N>] <label>: <rule>
```

`<action>` is `new`, or `extend <extends>`; `<N>` is the length of `seen_in`; `<rule>` is the
candidate line without its leading `- ` and without everything from ` — why:` on. With no open
candidate it prints nothing. A file it cannot read, or an entry that is not a candidate or an
attachment, is one line on stderr, `candidates: <path>: <message>`, and never a failure: the exit
is 0, and 2 only on a usage error.

**`--json`** prints one document, `{queue, problems}`:

- `queue` — each open candidate, in the text's order: `run` (`<type>/<name>`), `dir` (its task
  directory, absolute), `date` (the run's date), `id`, `label`, `rule`, `action` (`new` or
  `extend`), `extends` (null for `new`), `destination` and `seen_in` (run names, its own first).
- `problems` — each `{path, message}`, as stderr names them in the text form.
