# ADR-0057 — A gate's checkpoint names the output it approves

**Status**: Accepted · **Date**: 2026-10-23 · **Builds on**: ADR-0030 (the checkpoint), ADR-0056 (an additive key on the checkpoint) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/gate-subject.mjs`; `gate-brief.mjs` (`buildCheckpoint`); `references/gates.md` § *The `gate-brief` forms*; `tests/engine/gate-subject.test.mjs`

## TL;DR
A gate checkpoint may carry `subject: {path, kind}`: the one output the gate asks the operator to
approve, so a reader can lead with it without guessing from file names. The key is optional and
additive; absent means no subject named.

## ADR-0057 {#adr-0057}

### Status
Accepted. No definition changes and no graph hash moves: the key is filled by engine code from
output keys the definitions already declare.

### Context
A checkpoint lists the files up for review, and a reader that wanted to lead with the thing being
approved — a delivery scope shown as its members — could only recognise it by its file name. The
engine already knows which output each closing node declared, and under which key.

### Decision
**The shape.** `subject: {path, kind}` on a `kind: gate` checkpoint, the closing checkpoint
`held-approval` included, after `next`. `path` is run-relative, in the form `review` uses, a
folder ending in `/`.

**A closed list of kinds, read off declared output keys.** In precedence order:

| kind | declared output key |
|---|---|
| `delivery-scope` | `delivery_scope` |
| `brief` | `brief` |
| `specification` | `spec` |
| `plan` | `plan` |
| `mockups` | `mockups` |

The first kind a node the gate closes declares, with a literal path that is on disk (a folder
counts when it holds a file that is not hidden), is the subject. A path outside the task
directory is passed over. Nothing found is no key.

**Which gates set it.** In the built-in workflows: development's mockup, specification and
planning gates; migration's and performance's specification and planning gates; product
design's specification gate (the specification, over the prototypes beside it) and the closing
checkpoint raised after the brief (the delivery scope, over the brief). Research's gates and
every other gate name none. A project's own workflow gets a subject wherever a closing node
declares one of the keys.

**Where it travels.** In the checkpoint, and so in the driven request's `context.checkpoint`.
The request's own keys are unchanged.

**In session nothing changes.** The picker and the text brief do not read it.

### Consequences
- A request writer that carries the checkpoint as given needs no change; a schema that lists the
  checkpoint's keys gains an optional `subject` with the kinds above.
- A reader leads with the subject when present, picks its view by `kind`, links to the path for a
  kind it does not know, and keeps any recognition by file name only for checkpoints written
  without the key.
- Adding a kind is a new entry at its place in the list, and a reader that does not know it yet
  still has the path.

### Considered Options
- **Recognising the subject by file name.** Rejected: it is a guess, and a project workflow is
  free to name its files otherwise.
- **Declaring the subject on each gate in the definition.** Rejected for now: it changes the
  grammar and the graph hash for something the output keys already say.
- **A top-level `subject` on the request as well.** Rejected: a reader already has the
  checkpoint, and a second copy would make every request writer that holds its keys closed
  register one more.
