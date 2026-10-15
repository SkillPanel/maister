# ADR-0046 — Each step's summary is recorded once, on `node_summaries`

**Status**: Accepted · **Date**: 2026-10-15 · **Amends**: ADR-0006 (an exception to additive-only: the phase-summary mirror is no longer read), ADR-0024 (a phase card reads its node summary alone), ADR-0044 (`summary_keys` is retired) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs` (the writer, `MIRROR_NOTE`); `scripts/lib/prior-context.mjs`, `dashboard.mjs`, `gate-brief.mjs`, `revise.mjs` (the readers); `scripts/lib/resume-check.mjs`, `scripts/workflow.mjs` (the `legacy-mirror-ignored` warning); `scripts/lib/state-read.mjs` (comments only); `scripts/lib/graph.mjs` (`BRIEF_KEYS`, `brief-retired-key`); `scripts/lib/brief.mjs`, `node-brief.mjs`; `workflows/development.yml`, `research.yml`, `performance.yml`, `migration.yml`, `product-design.yml` and the guides beside them; `references/writing-state.md`; `skills/orchestrator-framework/references/orchestrator-patterns.md`; `tests/engine/prior-context.test.mjs`, `resume-check.test.mjs`, `write-state.test.mjs`, `projection.test.mjs`, `gate-brief.test.mjs`, `brief-block.test.mjs`

## TL;DR
A step's summary, decisions and risks are recorded once, on its own `node_summaries` entry, and
every reader — the earlier-steps passage a later step pastes, gate briefs, revise, the dashboard —
reads them from there. The writer no longer keeps the copy each built-in also held in its context
block (`phase_summaries`): a write that still sends it lands without it and says so in a note.
`summary_keys` in a `brief:` block is accepted with any non-null value, with a warning, and does
nothing. A mirror already in an older run's state stays on disk and is not read; `resume-check`
and `prior-context` announce it with one warning.

## ADR-0046: Each step's summary is recorded once, on `node_summaries` {#adr-0046}

### Status
Accepted. No graph hash moves: `brief:` sits outside the hashed envelope, and no node, edge or
`with:` entry changed.
- `development`: `sha256:7e3c72d7…ed605295`.
- `research`: `sha256:95b869ae…09872cc166`.
- `performance`: `sha256:183605fc…b8fbbcce62`.
- `migration`: `sha256:04f475d1…5d4ebc1546`.
- `product-design`: `sha256:08bd2d76…f5af669c9e00`.

### Context
- A step's summary had two homes: the node's own `node_summaries.<id>` entry, and a
  `phase_summaries.<key>` entry in the run's context block, which the built-in guides told each
  step to fill alongside it. Nothing kept the two in step, and they drifted: a decision or a risk
  recorded on one was often missing from the other.
- The reader that mattered most, the earlier-steps passage a later step pastes into its
  delegate's prompt, chose one source by whether the run had a context block at all. The writer
  seeded that block on every built-in run, so the passage always read the mirror and never the
  steps' own records.
- A step that recorded its summary on `node_summaries` only — every checkpoint, every gate answer,
  every project step that never heard of the mirror — therefore never reached the steps after it,
  and nothing said so.
- `brief:` carried `summary_keys`, which named the mirror's keys a step was to fill. It existed
  only to keep the mirror written.

### Decision
1. **Readers read `node_summaries` alone.** The earlier-steps passage, gate briefs, revise and the
   dashboard projection take a step's summary, decisions, risks and artifacts from its node entry.
   A context block's `phase_summaries` is not read into any passage, brief or card, whether or not
   it exists; it is only counted for the `legacy-mirror-ignored` warning.
2. **The writer drops the mirror with a note.** It no longer seeds `phase_summaries` in a new
   run's context block. A top-level `phase_summaries` patch key is ignored: the rest of the write
   lands, the exit code stays 0, and one line on stderr says
   `note: ignored the supplied phase_summaries; the phase-summary mirror is retired, so record each step's summary, decisions and risks on its node_summaries entry`.
   `phase_summaries` nested under `context` is dropped the same way, with the same one note even
   when both forms are sent, so the mirror cannot return as a free-form context key. A mirror
   already in the file is preserved untouched as an unknown key.
3. **`summary_keys` is retired.** `validate` and `/maister:run --check` accept the key with any
   non-null value and only the warning `brief-retired-key:<path>:<node>` (an overlay's `null`
   removal stays silent), the brief merge drops it, `node-brief` no longer prints it, and no
   built-in carries it. `brief:` keeps three active keys: `budget`, `absent` and `recommends`.
4. **The guides point at the one record.** Every built-in guide, the engine skill and the
   framework patterns tell a step to put its summary, decisions and risks on its own
   `node_summaries` entry. The steps that complete in two writes — `codebase-analysis`,
   `gap-analysis` and `specification` — are told to put every decision and risk on that entry, not
   split them across the two writes.

### Considered options

| Option | Why not |
|---|---|
| Keep reading an older run's mirror as a fallback | A phase key does not map one-to-one to a node id, so the fallback would guess; and it would keep two sources alive, the condition that caused the drift |
| Refuse a write that sends `phase_summaries` | It would stop a session still running the earlier prose mid-run; dropping the key with a note lets that write land and tells the session what to do instead |
| Delete `summary_keys` from the accepted `brief:` keys | A project definition or overlay that still carries it would stop validating; a warning names it and changes nothing else |

### Consequences
- The earlier-steps passage now lists every recorded step, checkpoints included, with gate
  answers and held-choice notes. It is longer than it was.
- A phase card on the dashboard shows exactly what the step recorded; the field-by-field fallback
  to the mirror is gone.
- **Runs written by 3.0.0-beta.28 or earlier are a stated break.** Their mirror stays in the state
  file and no reader consults it, so decisions and risks recorded only there no longer reach the
  run's later steps. Finish such a run on the version that started it, or accept that loss.
- **The break is announced.** `resume-check` and `prior-context` each print one read-only
  `warning: legacy-mirror-ignored: <block>.phase_summaries holds <n> decisions and <n> risks that no step reads; …`
  line on stderr when a run's context block still carries a mirror holding at least one decision
  or risk, exit `0`; a mirror with entries but no items prints nothing, and nothing
  of the mirror reaches the passage.
- A project workflow or overlay that carries `summary_keys` validates with a warning until the
  key is removed.
