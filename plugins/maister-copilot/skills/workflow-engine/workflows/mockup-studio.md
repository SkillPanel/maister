# Mockup studio workflow — node prose

The node-by-node companion to `mockup-studio.yml`. The engine executes every
`direct:` node from the section below that carries its id, and hands the
per-node context in `with:` to whatever the node names. The workflow draws one
new version of a set of UI mockups in a single turn and asks nothing.

## `turn`

**Does.** Invoke the skill with the `with:` values and `record` set to
`<this run's task directory>/turn-result.json`, taken from `run-context`.
Record the node values from the `values` block `finish` prints, verbatim. As
the closing node, call `run-complete` and relay its `missing-artifact:` and
`missing-companion:` lines.

A terminal run ends on the skill's closing message, followed by the command
that draws the next version:
`/maister-copilot:mockup-studio --turn "<note>" --task=<folder>`, with `<folder>` the
target root relative to the project root — `task_path`, or this run's record
folder when `task_path` is absent — and `--subdir=<output_subdir>` added when
`output_subdir` is not `analysis/mockups`.

No close-out while a choice is held: when the freeze recorded
`orchestrator.classes_questions`, this node runs `gate-brief --node=held-approval` before its
closing patch and before any close-out, as the engine's *Ending a dispatched run* says, and
closes as that section's outcomes direct.

**Under a dispatch driver, publish the close-out through the outbox close-out
verb before this node ends** — the summary the seed's close-out contract asks
for, carrying the version, the changed slugs and the gallery path, published
before the node records its outcome. The engine refuses a dispatched run that
reaches its end with no close-out in the outbox
(`RUN-FAILED: closeout-unpublished`). Under a terminal driver there is no
outbox, and the skill's closing message is what the user gets instead.

**Writes.** The sanctioned writes outside the run folder: the target
`<task_path>/<output_subdir>/`, and the grounding pack when the turn built it.

**Summary.** The headline names the version, the folder and the changed count,
for example "v003 of analysis/mockups — 2 of 5 screens changed; open
versions/v003/index.html". Each `degraded` reason goes in `risks` as `open`.
The note to commit the grounding pack, and the note to run `--ground`, go in
as `followup`.
