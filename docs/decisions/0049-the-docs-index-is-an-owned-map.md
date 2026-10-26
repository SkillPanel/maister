# ADR-0049 — The documentation index is an owned, written map with a check

**Status**: Accepted; amended 2026-10-26 (the check and the refresh run only where maister writes documentation — see *Fixed points*) · **Date**: 2026-10-22 · **Builds on**: ADR-0043 (run context), ADR-0040 (classed in-node questions) · **Sources**: `plugins/maister/skills/docs-manager/SKILL.md`, `references/index-md-template.md`, `scripts/docs-check.mjs`, `docs/INDEX.md`; `skills/standards-update/SKILL.md`; `skills/implementation-plan-executor/SKILL.md`; `skills/implementation-verifier/SKILL.md`; `agents/implementation-planner.md`, `task-group-implementer.md`, `implementation-completeness-checker.md`; `skills/orchestrator-framework/references/orchestrator-patterns.md` § 6; `skills/workflow-engine/workflows/{development,performance,migration}.md`; `skills/workflow-engine/scripts/lib/run-context.mjs`; `tests/engine/docs-check.test.mjs`, `run-context.test.mjs`, `same-questions.test.mjs`

## TL;DR
- **One writer.** Only docs-manager's Refresh INDEX.md writes `.maister/docs/INDEX.md`. It
  rewrites the entries of new, changed or gone documents and keeps every other entry byte for byte.
- **Short entries.** What a document is for and when to open it. A standard adds "Read in full
  before:" and its topics, never its rules. No counts, dates, ticket references or history.
- **Fixed points.** A refresh after implementation and after the fix loop when either changed
  documents; the check at verification, at finalization and in the quick skills that change files.
  Amended 2026-10-26: those runs and the quick skills no longer refresh or check — they still
  never edit the index or a standards file, and name the documents they changed. The check and
  the refresh run only where maister writes documentation: init, standards-update,
  standards-discover and docs-manager's own operations, a standard a finalization adds through
  standards-update included.
- **A format-agnostic check.** `docs-check.mjs` reads only the index and the file list. Structure
  fails; size and style only warn.
- **Any Markdown file can live in the docs** as it is: no frontmatter, schema or naming.

## ADR-0049 {#adr-0049}

### Status
Accepted. No workflow definition changes, so no `graph_hash` moves; every new step is node prose
or skill and agent prose. One in-node question is added to three finalization sections
(`standard-candidates`), so the in-node question snapshot gains it under each driver.

### Context
Project indexes grew from a few kilobytes to tens of kilobytes, and the import puts the whole file
into every session and every delegate. Three causes. Nothing owned the index and nothing forbade
editing it: the planner's file list accepted it, implementers and fix loops edited it, and the
only "update INDEX.md" instruction any agent saw shipped inside the index itself, in the template
footer. The entry rule asked each standards entry to enumerate the file's practices, so entries
restated their files and changed whenever a rule did. And a regenerate read every document in full
and rewrote the whole file, so a merge of two branches' indexes conflicted line by line.

A generated index — a summary in each document's frontmatter, rendered by a script — was
considered and rejected: projects keep documents copied in from elsewhere, and a project is never
asked to add metadata to its own documents.

### Decision
1. **Refresh INDEX.md is the one writer.** It replaces Manage INDEX.md in docs-manager. It runs the
   check, takes as targets the unindexed and dead paths, duplicates, the caller's changed paths (or,
   with none, what git shows changed since the index was last committed), reads a target's first
   heading and opening paragraph — the whole file only when those don't say what it is for — and
   writes its entry. Every other entry stays byte for byte. A conflicted index is settled by a
   refresh, never by hand. With `reshape`, which the operator starts with
   `/maister:standards-update --refresh-index`, it also rewrites every entry the check warns on.
2. **The kind follows from the path.** `standards/**` is a standard; anything else is a project
   document. Project documents sit under "Project documentation" sections, which the intakes read;
   standards under one section per folder. The entry shape is the same for both: a heading with
   title and path, then one or two sentences. A standard's names topics to recognise it by and asks
   for the file to be read in full, because an entry that lists the rules reads as the rules and
   is acted on instead of the file.
3. **Standards files keep a size guide**, about 12 KB or 15 rules. standards-update recommends a
   new file when the matched one is past it and proposes splits into topic files or a sub-folder.
   The check warns; nothing refuses.
4. **Runs never edit the index or standards.** The planner never lists them; implementers report
   Docs Changed and Standard Candidates; the executor refreshes after its last wave and the fix
   loop after its last fix when documents changed. Finalization offers the candidates once and adds
   the chosen ones through standards-update. The verifier's roadmap tick moves to finalization, so
   the verifier is read-only again.
5. **The check.** `docs-check.mjs`, zero-dependency Node. Fails: `index-missing`,
   `unindexed-file`, `dead-entry`, `duplicate-entry`, `conflict-marker`. Warns:
   `entry-over-guide` (about 240 characters, 300 for a standard), `entry-date`,
   `entry-ticket-ref`, `entry-count`, `standards-file-over-guide`. Exit 0, 1 or 2. The
   completeness checker reports its findings as documentation issues and never asks for index prose
   to change.
6. **The run context** labels its document list read-only and leaves INDEX.md out when the
   project's CLAUDE.md already imports it.

### Consequences
- The index stays bounded by its entries' guide times the number of documents, and two branches
  that refresh different documents merge without conflict.
- An existing oversized index needs one `--refresh-index`; oversized standards files are split when
  a team chooses to.
- The count warning is a heuristic and will sometimes flag a number that counts nothing. It only
  warns.
- Copilot CLI does not expand `@` imports; a project whose CLAUDE.md imports the index still names
  its path there, which a Copilot session reads as text.
