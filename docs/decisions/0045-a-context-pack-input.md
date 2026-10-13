# ADR-0045 — A run takes a context pack by path, recorded as `work_reference`

**Status**: Accepted · **Date**: 2026-10-13 · **Builds on**: ADR-0020 (sibling-task references in the context block), ADR-0044 (`brief:` `absent`, the step template) · **Sources**: `plugins/maister/skills/workflow-engine/workflows/development.yml` and `development.md` (`intake`); `research.yml` and `research.md` (`research-foundation`); `skills/development/SKILL.md`, `skills/research/SKILL.md` (the flag); `skills/orchestrator-framework/references/orchestrator-patterns.md` (*Shared: work_reference*); `tests/engine/work-reference.test.mjs`

## TL;DR
`development` and `research` take an optional `context` input of type `path`, passed on the
command line as `--context=PATH`. The run's first node copies the file or directory it names into
`analysis/work-context/`, declares the copy as an artifact it may leave unwritten, and records
`work_reference: {path}` in the run's context block. Development hands the copy to codebase
analysis the way it hands the research context. The input is separate from `research` because a
context pack has no shape the run may assume.

## ADR-0045: A run takes a context pack by path, recorded as `work_reference` {#adr-0045}

### Status
Accepted. Both definitions' graph hashes move; the other three built-ins' do not.
- `development`: `sha256:07283f38…56d47c` → `sha256:7e3c72d7…ed605295`.
- `research`: `sha256:e2bdfcbc…925e688a5` → `sha256:95b869ae…09872cc166`.
- `inputs:` itself is outside the hashed envelope; the `with:` entries and the declared
  `work_context` artifacts are inside it.

### Context
- Whatever starts a run — a step taken from a work item, a chain node — often holds material the
  run should read first: notes, a ticket export, an excerpt of a design. It can only reach the
  run through the task description, which is free text, or through `research`, which expects a
  completed research task.
- `research` takes no path input at all.
- Development already ingests named sources at intake — research, design, architecture — each
  copied into `analysis/` and recorded as a reference in `task_context`.

### Decision
1. **One optional input, `context: {type: path, required: false}`,** on `development` and
   `research`, exposed by the hand-off skills as `--context=PATH`. An absent input changes
   nothing.
2. **The first node ingests it.** `intake` (development) and `research-foundation` (research)
   take it in `with:`, copy what it names under `analysis/work-context/` as it is, and declare
   that path as the `work_context` artifact, sanctioned absent in `brief:` when no pack was named
   or it could not be read. A missing or unreadable path is said in one line in the node summary
   and the run continues without it — the precedent the design and architecture inputs set.
3. **The record is `work_reference: {path}`,** the path as given, in the run's own context block:
   `task_context` for development, `research_context` for research, because the root carries
   exactly one block. It sits beside `research_reference`. The state writer already accepts any
   key in the context block, so the contract change is additive and the writer is unchanged.
4. **Delegates receive it the way they receive research.** Development's `codebase-analysis`
   takes `work_context` in `with:` beside `research_context`; research's foundation reads it while
   writing the brief and briefs its planner and gatherers.

### Considered options

| Option | Why not |
|---|---|
| Reuse `research` for any context | Research is a completed research task: its report, question, type and confidence are read and recorded. A pack has none of them, and loosening `research` would make every reader of `research_reference` guess which it got |
| Read the input from the run's frozen inputs, with no `with:` entry or artifact | No hash move, but the copy would reach delegates by prose alone, and its absence would be undeclared |
| Fail the run on an unreadable path | No ingest in the workflow fails on a missing source; the operator learns it from the summary |

### Consequences
- An eject or overlay of `development` or `research` revalidates against the new base hash; a run
  frozen before the change keeps its own graph and reports drift on its gate briefs.
- A pack is background: it informs every later node and skips none, and its contents are never
  treated as a specification.
- Any other workflow that wants a pack declares its own input; nothing here is engine-wide.
