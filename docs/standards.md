# Standards

For people who want Maister to follow their team's conventions: where the standards live, how
they get there, how workflows apply them and how to keep them current. The flags of each command
are in the [Command Reference](commands.md).

## What lives in `.maister/docs/`

```
.maister/docs/
├── INDEX.md             # one short entry per document; workflows read this first
├── project/             # what the project is: vision, roadmap, tech stack, architecture, and your own
├── standards/           # how code is written here, one folder per category
│   ├── global/
│   ├── frontend/
│   ├── backend/
│   └── testing/
├── <any folder>/        # any other Markdown you keep here
└── design-context/      # the mockup studio's grounding pack (see Mockups); not indexed
```

**Standards** are short rules about how code is written in this project. Each file is one topic,
`standards/<category>/<topic>.md`, with a `###` heading per rule and a few lines under it, and at
most a short example. A category is just a folder: the four above are the starting set, and you can
add your own, or group a large topic into a sub-folder (`standards/backend/storage/locking.md`).
A file reads best under about 12 KB or 15 rules; past that, Maister suggests splitting it, but
never refuses a larger one.

**Project documents** say what the project is and why it is that way: the vision, the roadmap, the
tech stack, the architecture, and whatever else your team writes, such as a decision log or a
glossary.

**INDEX.md** is a map: one short entry per document, saying what it is for and when to open it.
Maister writes it; do not edit it by hand. Change the document instead, and the next refresh
updates its entry. A merge conflict in INDEX.md is settled by a refresh too
(`/maister:standards-update --refresh-index`), not by merging entries by hand.

**The pointer.** Your project's `CLAUDE.md` carries a line that loads `@.maister/docs/INDEX.md`,
so every session starts from the index. On GitHub Copilot CLI the pointer goes in
`.github/copilot-instructions.md` instead. On Copilot the pointer line reads
`@../.maister/docs/INDEX.md`. Maister adds it when it is missing. A pointer an earlier init wrote
on Copilot reads `@.maister/docs/INDEX.md`, which never loaded the index; change it to
`@../.maister/docs/INDEX.md`.

## Setting up: `/maister:init`

`/maister:init` analyzes the codebase, confirms what it found with you, and then writes:

- **Project documents** under `.maister/docs/project/`, filled in from the analysis: the tech
  stack always, and the vision, roadmap and architecture unless you choose otherwise.
- **Starter standards** under `.maister/docs/standards/`, in the categories that fit the code it
  found: global and testing always recommended, frontend and backend when the code has them. You
  can choose the categories, or add one of your own. A recommended category you leave out
  gets no section in INDEX.md; init's closing summary names it with the command that adds it later.
- **INDEX.md** for everything it wrote, and the pointer in `CLAUDE.md` (it creates the file when
  there is none).
- **`.maister/config.yml`**, with the project profile; the keys are in
  [Configuration](configuration.md).

It ends by running standards discovery over the whole project (below), so the starter rules are
checked against what your code really does. Where a discovered rule contradicts a starter rule, it
asks which one holds.

**Starting from another project's standards.** `/maister:init --standards-from=../other-project`
copies the categories from that project's `.maister/docs/standards/` instead of the built-in set.
Use it when a new project should follow the same conventions as an existing one.

**Running init again.** On a project that already has `.maister/`, init asks what to do:

- **Update the docs, keep my edits** (recommended). It re-analyzes the code without writing
  anything, compares the config, the project profile and the four project documents with what it
  finds, and asks one question listing every proposed change. Only additions are recommended:
  missing config keys, missing profile fields, missing documents. A value or a passage that
  differs is offered one line or one file at a time, and kept unless you take the change.
  Standards are never changed; a category your stack needs and `standards/` lacks is named with
  its `/maister:standards-discover --scope=<category>` command. Your other documents are never
  rewritten; they only get an index entry when they have none. Whatever you choose, INDEX.md is
  refreshed and the pointer repaired.
- **Start over.** The existing `.maister/` is moved to a dated backup,
  `.maister.backup-<date and time>/`, and init runs as on a new project.

Leaving without changes is the free-text answer.

## Finding the rules your code already follows: `/maister:standards-discover`

Standards discovery reads your project and proposes the rules it already follows. It looks at
four sources:

- **configuration files**: linter, formatter, compiler, editor and package settings;
- **code**: patterns that recur across the source files;
- **documentation**: conventions your README, contributing guide, architecture notes and other
  docs state outright;
- **pull requests and CI**: review feedback that recurs across recent merged pull requests, and
  what your CI pipelines and pre-commit hooks enforce.

Each source is read by its own read-only scanner, all of them at the same time. A source that
cannot be read (no pull request history, for example) is skipped, and the others go on. The
findings are then merged: the same rule seen in several places becomes one finding with all its
evidence, and each gets a confidence score from how many sources show it, how consistently and how
explicitly.

Nothing is written until you approve it:

- **High confidence** (80% or more): one question to apply them all, or go through them one by one.
- **Medium confidence**: pages of up to four, each with its evidence. Accept, accept with a
  change, skip, or skip the rest.
- **Conflicts**: two findings that cannot both hold, or a finding that contradicts a rule already
  in your standards. You choose which holds, each time; a conflict is never settled for you.
- **Below the threshold**: not asked, but listed in the summary, so a later run with a lower
  `--confidence` can pick them up.

Approved rules are written into the matching topic files, existing rules are kept unless you
settled a conflict against them, and INDEX.md is refreshed. Use `--scope` to look at one category
or only at configuration files, and `--skip-external` to leave pull requests and CI out. On a
project with no `.maister/docs/` yet, it offers to run `/maister:init` first.

## Adding a rule or a fact: `/maister:standards-update`

Use it when the team settles something worth keeping. It records two kinds of knowledge:

```
/maister:standards-update "prefer named exports over default exports"
→ a rule in a standards file, e.g. standards/global/conventions.md

/maister:standards-update "we chose Postgres over MongoDB because orders need transactions"
→ an entry in a project document, e.g. project/decisions.md
```

It picks the best-matching file and always asks before writing, offering other files or a new
one. When the matching file is already past its size guidance, it recommends a new file beside
it. `/maister:standards-update "split <path>"` proposes how to split a large file into topic files
or a sub-folder, moving the rules word for word.

**From the conversation.** With no argument, it scans your recent conversation for conventions
("we should always…", "our convention is…", "prefer X over Y") and proposes them.

**From a finished workflow run.** While a development, performance or migration run implements,
each task group notes knowledge the next change should have: a convention, a pitfall, an
important fact about the code. At the end, the run merges those notes, checks them against what
your standards and documents already hold, and leaves them in its task folder as standard
candidates. Its closing message lists them and names this command. A run never writes a standard
itself: run `/maister:standards-update` in the same session, or in a fresh one, where it finds the
most recent run with candidates left. The well-supported candidates are recommended, you choose
which to add, and each one added is not offered again. The ones you leave stay in the run's folder
for later.

**From another project.** `--from=PATH` compares that project's `.maister/docs/standards/` with
yours, lists what is new and what differs, and lets you choose. For a file that differs you can
merge in the new rules (keeping your edits), replace it, or skip it.

**Repairing the index.** `--refresh-index` brings INDEX.md back in shape after it has grown long,
been edited by hand or merged badly. It rewrites the entries that break the rules, adds missing
ones, removes dead ones and touches no other document.

**Your own wording.** What counts as a standard is kept deliberately open. If your team wants it
wider or narrower, say so in your `CLAUDE.md` block or at the top of INDEX.md; Maister reads both
and follows them when it writes or judges a candidate.

## Your own documents

Any Markdown file you put under `.maister/docs/` is read as it is: no frontmatter, no naming rules.
Put it under `project/`, or in a folder of its own anywhere outside `standards/`. It needs an entry
in INDEX.md to be found: run `/maister:standards-update --refresh-index`, and any later refresh
(init, discovery or an update writing something) adds the entry too. From then on, every workflow
run reads it at the start, beside the predefined project documents.

## How workflows apply standards

- **Specifying and planning.** The specification names the standards that apply to the change,
  and the implementation plan carries a standards section that each task group follows.
- **Implementing.** Each task group reads the standards the plan lists, and keeps checking
  INDEX.md as it reaches a new area (a database query, a form, an API route), reading those
  standards before writing that code. Where two standards disagree, the more specific one wins,
  and the task group's notes say so.
- **Verifying.** The code risk review checks the change against the standards the run claimed and
  the ones it judges relevant from INDEX.md. A broken rule is a finding that names the standard,
  the rule and the place.
- **Never edited by a run.** Workflows read `.maister/docs/standards/` and INDEX.md but do not
  change them. New knowledge comes back as standard candidates, which you add with
  `/maister:standards-update`.

## Quick commands and standards

The quick commands follow the same standards without a full workflow:

- **`/maister:quick-plan`** reads INDEX.md and the standard files that bear on the task, and the
  plan must include a **Standards Compliance Checklist**: one checkbox per applicable rule, each
  naming its file. After implementation, each item is checked and reported as pass or fail.
- **`/maister:quick-dev`** reads the same files while it implements and reports the same
  checklist, pass or fail per rule, in its summary.
- **`/maister:quick-bugfix`** reads the standards for the area of the bug; its fix plan lists them
  with a compliance checklist.
- **`/maister:quick-design`** takes the standards that bear on the question as constraints on the
  options.

None of them edits INDEX.md or a standards file; a convention worth keeping is suggested in one
line for `/maister:standards-update`. Without INDEX.md they work normally and suggest running
`/maister:init`.
