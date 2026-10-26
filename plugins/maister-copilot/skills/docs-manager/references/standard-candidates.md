# Standard Candidates

The one description of a standard candidate. The implementer writes candidates to it, a fix loop
writes one to it, finalization's consolidation reads them against it and hands them over in the
run's candidates file, and `standards-update` and the project's `.github/copilot-instructions.md` block point here
rather than restating it.

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
— in its `.github/copilot-instructions.md` block or at the top of its standards index. Read both before writing or
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
2. **Match against what the project holds.** Scan INDEX.md and read the standards and project
   documents it points to that touch each candidate's topic.
   - A near-duplicate of an existing rule becomes **extend**: the rule's file and heading, and
     what the candidate adds to it.
   - A candidate an existing rule already says in full is **already held**: named with that rule,
     not offered, so the person sees it was not lost.
3. **Tidy the wording** to *How one is written*: the rule, the reason, the scope; counts, line
   numbers and stale identifiers taken out. The meaning is never changed.
4. **Suggest a destination** for each, by *Where one belongs*: an existing file, or a new one
   named for its topic.
5. **Return**, for each candidate offered: a label of a few words, the candidate line, the action
   (new or extend, with the rule extended), the suggested destination, and the evidence (which
   groups or fixes showed it). Then each already-held line with the rule that holds it.

The person still chooses: consolidation orders and places, it never decides what is kept.

## The run's candidates file

A workflow run never writes a standard and asks nothing about its candidates. Finalization writes
what consolidation returned to `standard-candidates.json` in the task directory, lists the
candidates in its close with that task directory, and names `/maister-copilot:standards-update` once
under **Next**. Run with no argument in the same session, standards-update finds the close and
offers that run's candidates; in a fresh session it finds the most recent run whose file still
holds a candidate to apply and offers them. Either way an applied candidate is not offered again.
The file is JSON:

- `candidates` — each one offered: `id` (short, unique in the file), `label` (its few words),
  `line` (the candidate line), `action` (`new` or `extend`), `extends` (the rule's file and
  heading, for `extend`), `destination` (the suggested file), `evidence` (which groups or fixes
  showed it), `recommended` (true when well supported — its evidence in more than one place, or
  its action extending a rule the project already has) and `reason` (why, when recommended).
- `already_held` — each `{line, held_by}`: the rule that already says it.
- `consolidated` — false when consolidation failed and the lines are the work log's as written
  (each then `action` `new`, its destination the likeliest file by *Where one belongs*, and
  `recommended` false).

`id`, `label`, `line` and `destination` are required; an entry without them is not offered.
Which candidates have been applied is recorded beside it, in `standard-candidates-applied.json`,
by standards-update's script — never by hand, and never in the candidates file itself.
