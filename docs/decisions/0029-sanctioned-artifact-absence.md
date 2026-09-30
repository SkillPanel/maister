# ADR-0029 — A node records the artifacts it completed without, and a terminal run ends in words

**Status**: Accepted · **Date**: 2026-09-30 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs` (`assertAbsent`, `declaredOf`); `scripts/lib/complete.mjs` (`reconcile`, `absencesOf`); `scripts/lib/dashboard.mjs` (`absencesOf`); `orchestrator-framework/assets/dashboard.html`; `SKILL.md` *Recording an outcome*, *Operator visibility*; `references/sub-runs.md` W4; `tests/engine/run-complete.test.mjs`, `state-integrity.test.mjs`, `projection.test.mjs`; ADR-0024, ADR-0028

## TL;DR
Some declared artifacts are legitimately missing. Intake's research and design context exist only
when the run is given research or a design. The planner's visual-coverage report exists only when
there is a design index. `run-complete` printed every one of these as `missing-artifact:`. At the
end of a terminal run those lines appeared raw, beside the `RUN-COMPLETE` marker. This record makes
two changes:
- **`absent: {<artifact-key>: "<reason>"}` on the node summary.** A node records each declared
  artifact it completed without on purpose. The writer checks the entry. `run-complete` skips it,
  and the dashboard shows "not produced: <reason>" in its place.
- **A terminal run ends with a wrap-up for the reader.** The final message gives the outcome, the
  key files, the next steps, any genuinely missing artifact in plain words, and the dashboard link.
  The verb's lines are for the engine and are never shown. Driven runs still end on the marker.

## ADR-0029: A node records the artifacts it completed without {#adr-0029}

### Status
Accepted. No grammar change and no built-in hash change. The state writer gains one refusal code,
`state-absent-invalid`, so its vocabulary grows from twenty-four codes to twenty-five. The dashboard
gains one additive phase field, `absent`.

### Context
The engine already allowed an absence: the node's prose may sanction a missing artifact, and the
node then completes. But only the prose said so, and only the node's own existence check could
read it. `run-complete` checks every declared artifact again at the close, but it cannot read
prose. So it reported each sanctioned absence as a gap. The first attended development run ended
on three such lines, and all three were false alarms. The grammar once had an `optional` flag on
artifacts. It was removed, because whether an artifact is required depends on the run, not on
the definition.

### Decision
- **The judgement stays with the node, and the node now records it.** A completing node summary
  may carry `absent`. Each key is a declared artifact key, never a path, and each value is a
  non-empty reason. The writer holds the entry to both rules. It checks the reason on every
  write. It checks the key against the node's declared artifacts only while the frozen graph
  proves, which is the rule every definition-backed check follows. A bad entry is refused with
  `state-absent-invalid`, and nothing is written.
- **The close reads it.** `run-complete` prints no `missing-artifact:` line for a sanctioned key,
  so any line that remains is a real gap.
- **The dashboard shows it.** A phase whose node recorded an absence gets
  `absent: [{artifact, path, reason}]`. The field is additive and omitted when empty. `path` is
  the declared path spelled the way the summary would register it, or null when the definition
  cannot be read. The viewer lists these under *Not produced*. A hero card whose artifact was
  sanctioned shows the reason instead of "not produced yet".
- **The built-in prose records it wherever an artifact is conditional within a node that still
  completes.** A sub-run parent records the child's guard-skipped outputs the same way when it
  adopts the child's outcome.
- **A terminal run ends in words.** Under an absent or `terminal` driver, the run calls
  `run-complete` first. It then ends with a wrap-up and never shows the verb's raw lines. Under a
  `cockpit` or `dispatch` driver, tooling reads the last line, so nothing changes there.

### Consequences
- A node that forgets to record an absence is still correct. `run-complete` reports the line, as
  before.
- An artifact the node owed and did not write must never be recorded as an absence. The prose
  rule says so. The writer cannot tell the two cases apart; it can only refuse a key the node does
  not declare, or an entry with no reason.
- The compatibility register, which lives in the pro edition, must document `node_summaries.<id>.absent`,
  the phase field and the new refusal code. The cockpit must render the phase field.
