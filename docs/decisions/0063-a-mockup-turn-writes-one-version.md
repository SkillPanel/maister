# ADR-0063 — A mockup turn writes one version

**Status**: Accepted · **Date**: 2026-11-03 · **Builds on**: ADR-0025 (engine-only workflows) · **Sources**: `plugins/maister/skills/mockup-studio/SKILL.md` and its `scripts/turn.mjs`, `scripts/frames.mjs`, `references/turn-contract.md`, `references/grounding-pack.md`, `references/visual-companion.md`; `plugins/maister/skills/mockup-studio/server/index.mjs`; `plugins/maister/skills/workflow-engine/workflows/mockup-studio.yml`; `tests/engine/mockup-turn.test.mjs`

## TL;DR
The mockup studio no longer holds a session open between rounds. One call is one turn, and a turn writes one new version under a folder it is given, asks nothing and ends:
- **The folder is the state.** `versions/index.json` and one `vNNN/` folder per version say what exists. A turn needs no run record to build on an earlier one.
- **No reopen verb.** The next turn is a fresh run with the same folder and `against` set to the previous version.
- **A read-only loopback viewer** serves the folder for the turn's own look pass. It renders nothing and takes no input.
- **No per-turn `design-resources.md`.** The manifest records the grounding pack's digest and whether it was stale.
- **The entry skill carries no Step-0 gate block.** A built-in with no gate has nothing for that block to enforce.

## ADR-0063 {#adr-0063}

### Status
Accepted. It adds a built-in, `mockup-studio`, and moves the development graph hash: its `ui-mockups` node renames two `with:` inputs, `iteration` to `fidelity` and `scope` to `scope_clarifications`. ADR-0064 moves product-design's.

### Context
The studio ran a refinement loop inside the node that called it: it started a companion server, asked what to change, re-rendered and asked again until the person was content. That shape had three costs:
- every caller needed its own prose for the loop, the server and its teardown, and a run no one could ask took the loop's default;
- the mockups of one task were one mutable set of files, so an earlier round could not be looked at, compared or returned to;
- the loop could not be driven from outside the session, which is where most runs now come from.

### Decision
- **The turn contract.** A turn takes a note, an optional version to build on (`against`), optional screens to change (`scope`), a format and a fidelity. It begins a version, draws the screens, finishes the version and returns `{version, against, screens, changed, notes}`. It never asks a question, under any driver. A refusal from `begin` writes nothing and fails the node with the refusal's message; every other problem is recorded as a reason code on the manifest and the turn still finishes.
- **Versions are immutable and the folder is the state.** `versions/index.json` lists the versions oldest first and names the latest; each `versions/vNNN/` holds its manifest, its pages and a self-contained gallery. A version, once in the index, is never changed. Screen slugs are stable from one version to the next, and a flat view of the latest version sits beside `versions/` for the readers that predate it. Every file goes through a temp file and a rename, and the index is updated under a lock.
- **No reopen verb.** A run's record folder is not the version list: with a `task_path` given, the turn writes under `<task_path>/<output_subdir>/` and the record folder holds only the run's state and `turn-result.json`. The next turn is a fresh run with the same `task_path` and `output_subdir`, the new note and `against` set to the previous `version`. One folder therefore holds one version list however many runs wrote it, and nothing has to resume a finished run.
- **The loopback viewer.** `server/index.mjs` serves one folder, read-only, on `127.0.0.1`, refuses a request whose `Host` is not its own, serves no dot-file and nothing outside the root, and exits after fifteen idle minutes. A turn uses it only for its single look-and-fix pass, and only when the session has a browser tool. A server left behind by a crashed turn is reused for the same root and replaced otherwise. Without a browser tool the pages are still written and the notes say which file to open.
- **No per-turn `design-resources.md`.** An earlier design had each turn write a record of the design resources it bound. The version's manifest carries the grounding pack's `grounding_digest` and `grounding_stale` instead, and the turn's notes carry what was bound, in one line. Callers that kept a `design_resources` field record the digest and staleness there.
- **A gateless built-in's entry skill has no Step-0 block.** The orchestrator-creation checklist asks the hand-off skill of a built-in workflow to carry the gate-rule Step-0 block. `mockup-studio` has no gate, so the skill carries none: the block would instruct the model to ask at gates that do not exist, and the gate-rule lint holds those copies at an exact count. This is a stated exception to that checklist item, not a precedent for a workflow that has a gate.
- **Three entries over one turn.** Node mode (a workflow node or another skill calling it), `--turn`, and `--ground`, which builds or refreshes the grounding pack and touches no task folder. A bare `--turn` with no folder starts the `mockup-studio` workflow; with `--task=<dir>` the turn runs inline and writes no run record. The three shipped callers keep calling the skill from their own nodes.

### Consequences

#### Good
- A caller's mockup step is one turn, and a run that cannot ask behaves exactly like one that can.
- Every round survives, and a second round reads the first from disk.
- Callers drop their loop prose and their server teardown.

#### Bad
- Revising a screen is a new version, not an edit in place; the folder grows by one version per round.
- A turn that wants the next round must be handed the folder. The terminal entry's closing message prints the exact command for that reason, since a bare second `--turn` from the project root starts a new run at `v001`.
- A grounding pack a turn builds in a dispatch worktree is lost unless someone commits it; the turn's notes say so and nothing more enforces it.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the in-node refinement loop and add versions to it | The loop is what a driven run cannot take part in, and each caller would still carry its own copy of it |
| A `reopen` verb that resumes a finished run | The run's record is not the version list; the folder already holds what the next turn needs |
| Write a `design-resources.md` per turn | It repeats facts the grounding pack and the manifest already hold, and goes stale the moment the pack changes |
| Give the entry skill a Step-0 block for uniformity | There is no gate to ask at, and the block would be counted by the lint that holds the gate-rule copies |
