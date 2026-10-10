# ADR-0039 — The engine briefs each decision area from the brainstorm's own record

**Status**: Accepted · **Date**: 2026-10-10 · **Builds on**: ADR-0032 (in-step questions suspend as one question set), ADR-0037 (triage under a classifying policy) · **Sources**: `plugins/maister/skills/workflow-engine/references/decision-areas.md`; `scripts/lib/decision-areas.mjs` (`loadAreas`, `areaPicker`, `areaDetails`, `areaEntry`); `scripts/lib/area-brief.mjs`; `scripts/lib/question-set.mjs` (`QUESTION_KEYS`, `checkSet`, `questionCheckpoint`); `workflows/research.yml` (`solution-generation`, `solution-convergence`); `workflows/product-design.yml` (`idea-generation`, `idea-convergence`); `plugins/maister/agents/solution-brainstormer.md`; `tests/engine/area-brief.test.mjs`, `in-step-questions.test.mjs`; `tests/fixtures/decision-areas/`

## TL;DR
At research's and product design's convergence, each decision area used to be a question the
model composed from the brainstorm's markdown, once for the terminal and again for a cockpit. The
solution brainstormer now also writes `decision-areas.json` beside its markdown, stamped with the
markdown's SHA-256, and the brainstorm node declares it as its `decision_areas` artifact. A new
engine verb, `area-brief`, checks that file and renders each area from it: one area's picker or its
full write-up for the terminal, or every area's question set for a cockpit, each question carrying
its write-up as `details`. The verb adds no words of its own beyond a fixed list of labels. A
missing, unreadable, invalid or stale file is a warning, and the node composes the area as before.

## ADR-0039: The engine briefs each decision area from the brainstorm's own record {#adr-0039}

### Status
Accepted. Both definitions that declare the file move their hash once: research from
`sha256:8b9f964401011ff6823332a8ad4fb01b2172b6e697f30e91431bf992ce608655` to
`sha256:e2bdfcbcb2cddbaf0d0c972c07ed51cddddf8abe33fc171092c038e925e688a5`, and product design from
`sha256:2c0683f8cf73a16a4d62d6d5d0085e4ad1f252672ba4212cd808a9d936d4de36` to
`sha256:08bd2d76e6c1472b130e22ca7a2a8f5d10fb46fd2d380522edb9f5af669c9e00`. Both values hold
with the user-story change merged in: that change adds a declared question id to product design's
prose but leaves its graph, so product design's hash is the same with or without it. The verb adds four
refusal codes, `area-brief-state-unreadable`, `area-brief-unknown-node`, `area-brief-not-running`
and `area-brief-unknown-area`, and four warning codes, `decision-areas-missing`,
`decision-areas-unreadable`, `decision-areas-invalid` and `decision-areas-stale`; a missing file
carries the detail `not-declared` or `producer-not-completed` when no path could be followed.

### Context
A design decision is asked one area at a time, each with every alternative, its pros and cons and
the recommendation. The words came from the model, which read the brainstorm's markdown and wrote
the picker; under a cockpit driver it wrote a question set instead. The two were separate
compositions of the same document, so the terminal and the cockpit could show different text,
a recommendation could be reworded on the way, and a cockpit question carried only a short
summary: the operator had to open the exploration file to see an area's full trade-offs. Nothing
pinned what an area question said, so a change to it was never a reviewed change.

### Decision
**A shape, written by the brainstormer.** `decision-areas.json` is `version: 1`, with keys closed
at every level: `source` (the markdown's task-relative path and its SHA-256), then `areas`, each
with an id, a name, a one-line question, why it matters, optional `depends_on` on earlier areas,
at least two alternatives in rank order (title, description, pros, cons, `key_pro`, `key_con`) and
a required `recommendation` that is `{alternative, reason}` or an explicit `null` for an area left
open. A file is judged whole and refused with its first fault, `<reason> at <dotted.path>`, from a
closed set of sixteen reasons. The shape is documented in the engine's
`references/decision-areas.md`; no schema file ships. The brainstormer writes the file after the
markdown is final, rewrites it whenever the markdown is revised, and registers it with
`role: evidence`, so a gate's review list keeps naming the markdown alone.

**Declared, not derived.** The brainstorm node declares `outputs.artifacts.decision_areas`, and
the convergence node names it through `with: decision_areas: "${<producer>.artifacts.decision_areas}"`.
`area-brief` re-reads the frozen definition the way `gate-brief` does, follows that exact
reference to a producer that is one of the node's needs and `completed` in state, and joins the
declared path onto the run directory. It never interpolates a node that may have been skipped.

**One verb, three forms.** `area-brief --state --node` with `--area=<id> --json --picker=rich|plain`
prints one area's picker in `gate-brief --json`'s field shape; with `--area=<id>` alone it prints
the area's full write-up, which is what More details shows; with `--patch-file` it writes every
area's question entry (or the repeated `--area` ones, for a re-ask after a revise) into the run's
`.state-patch.json`, which `gate-brief --request --patch-file` then turns into the request. That
keeps `gate-brief --request` the only code that builds a request. The question id is
`convergence-decisions-<area id>` in every form. In the `rich` profile an area lists the
recommended alternative first and at most three alternatives, keeping the last slot for More
details, and names any others in the question; the labels-only profile lists every alternative.
The verb chooses nothing: it selects, orders by the recorded rank, clips previews and the header,
drops backticks for the labels-only picker, and adds only the labels the reference lists. Golden
files pin every form.

**Fresh or not used.** The markdown's SHA-256 is compared with the stamp on every read. A missing,
unreadable, invalid or stale file prints one `warning: <code>:<path>[:<detail>]` line and exits 0;
the `--json` form reports `fallback: true`, and the set form writes nothing. The node then composes
the area from the markdown as it did before, so a run frozen against the old hash, whose
brainstorm wrote no file, still converges.

**`details` on the checkpoint question.** A question in a set gains one optional key, `details`:
the area's full write-up as text, byte-identical to the terminal's More details. It is carried on
the checkpoint question item only, never on the request's top-level questions, and never folded
into a summary or a flow line. A reader that does not know the key ignores it and shows the
question without it.

**Triage per area, in the set form only.** When the run's recorded policy hash matches the policy
on disk, each area entry carries the `triage` the policy gives the declared question id
`convergence-decisions`; a policy that classes nothing leaves the key out. When the hashes differ
and the policy would class an area, no entry is classed and one `policy-hash-mismatch:<node>`
warning is printed. When the policy file itself is refused, the set form relays its
`policy-refused` warning and classes nothing. The class never comes from the file or the model.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Derive the file's path beside the markdown, declaring nothing | No hash would move, but `run-complete` and the dashboard would never see the file, and a skipped brainstorm could not be told from a missing file |
| Carry a structured `area` object on the request question | A new shape every cockpit would have to learn; the write-up as text shows the same content the terminal shows, and an older reader degrades to the question alone |
| Put `triage` on the request's top-level questions | The top-level request carries no triage anywhere else; the checkpoint question item is where a class is read |
| Let the model keep composing, with stricter prose | The two surfaces would stay two compositions, and nothing could pin what a user sees |

### Consequences
- Research and product design move their hashes once. Chains frozen against the old hashes see them as drift; a run already in flight converges through the fallback.
- A driven convergence request grows by every area's write-up, several kilobytes for a large design.
- The brainstormer computes the SHA-256 itself; where that command prompts for permission, the file may be missing and the run falls back.
- No asked-questions snapshot is expected to move: convergence still asks under `convergence-decisions`, through the same transports.
