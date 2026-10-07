# ADR-0030 — One checkpoint object, projected to every surface

**Status**: Accepted · **Date**: 2026-10-06 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs` (`buildCheckpoint`, `askOf`); `scripts/lib/checkpoint.mjs` (`richPicker`, `plainPicker`, `moreDetails`, `requestOf`); `scripts/lib/items.mjs` (`decisionOf`, `riskOf`, `artifactOf`); `scripts/lib/state.mjs` (`assertItems`, `foldAnswers`); `scripts/lib/dashboard.mjs`; `orchestrator-framework/assets/dashboard.html`; `SKILL.md` *Before every gate*, *Terminal mode*, *Driver-suspended mode — the write order*; `tests/engine/checkpoint.test.mjs`, `gate-brief.test.mjs`, `write-state.test.mjs`; ADR-0006, ADR-0012, ADR-0017, ADR-0024

## TL;DR
A gate was rendered three ways by three code paths: the in-session question, its previews and the
driven one-line summary. Each path chose for itself what to show. The question grew to eight lines
with full paths. The focused preview filled its 2,000 characters with every risk. The driven
request reached a cockpit as one flattened string, built by the model from two verbs.

`gate-brief` now builds **one checkpoint object** per gate, and every surface is a projection of
it. The state record gains typed fields so the object is built from data, not from parsed
prefixes. Every addition is optional, and every older shape is still read.

## ADR-0030: One checkpoint object, projected to every surface {#adr-0030}

### Status
Accepted. No grammar change and no built-in hash change.
- The state writer gains one refusal code, `state-summary-item-invalid`.
- `gate-brief` gains two forms, `--checkpoint` and `--request`.
- The `--json` picker output drops the `brief`, `summaries`, `decisions` and `risks` fields it
  carried for a composed message, and gains `more_details`.

Amended by ADR-0031: operator decision 3 no longer keeps the checkpoint out of every display file. `gate-brief` writes one, `display/next.json` beside the run, the panel an editor extension draws above the question; every state write removes it, so it cannot go stale between two asks. The checkpoint still travels in the gate request.

### Context
At a gate, the user needs to know four things:
- what finished;
- where the run goes;
- what to open;
- what was decided for them.

The model was asked to compose a message carrying all of this above the question. In measured
runs it did so in at most two of five. The engine's own question carried the same items again,
cut down, and the preview carried them a third time, whole.

The `risks` list mixed open questions, trade-offs already accepted, follow-ups and findings. So a
gate alarmed the user with things already settled, and the revise suggestions restated them.

Decisions mixed the run's choices with the user's own answers, and gave no way to tell them apart.

A cockpit received only `context.summary`, one string, and dropped every structured field it could
not split out of it. A gate answered in the terminal was missing from its gate history, because the
engine recorded only the option id.

### Decision
**One structured source.** `gate-brief` builds the checkpoint once:
- `version`, `kind`, `node`, `header`;
- the generated `ask`;
- `headline`, `progress`, `next` (with skipped work), `review`, `closed`;
- `decisions`, grouped by who settled them;
- `risks`, grouped by tag;
- `recommended`, with its reason;
- `options`, each with its consequence and, for revise and stop, its details;
- the reserved `grants` and `approves`;
- `run` and `truncated`.

The one-line ask is generated from the title of the node the walk reaches, never from the frozen
`ask:` destination.

**Projections.** Each surface lays the same object out its own way, in `checkpoint.mjs`:
- **The rich picker** (option previews). The question is the one-line ask. The continue option
  previews a glance: *Done*, *Next*, *Review*, up to three run decisions, and one counted line for
  the user's own choices. It stays within nine lines and 900 characters, and holds no risk of any
  tag. Revise, stop and More details each preview what choosing them does.
- **The plain picker** (labels only). It carries the same glance in the question, with the ask
  last, and each option title carries its consequence.
- **More details** is the full brief, with its risks grouped by tag.
- **`--request`** is the whole E2 request. It carries the checkpoint as `context.checkpoint`, beside
  the unchanged one-line `context.summary` and `context.artifacts`. The driven path becomes one
  verb whose output the model writes unchanged, so the model composes nothing.
- **`--checkpoint`** prints the object itself, for a reader that renders its own layout.

At a terminal gate, the model writes one lead-in line at most and passes the picker as given.

**Additive shapes on a node summary.**
- `headline`: one sentence of at most 220 characters.
- Decisions as `{decision, by, …}`, where `by` is `operator`, `run`, `audit` or `default`. A
  person's answer also carries `answered_by`, `at`, `via`, `question_id`, `question`, `answer`,
  `recommended` and `as_recommended`.
- A reserved `triage` object.
- Risks as `{risk, tag, change}`, where `tag` is `open`, `tradeoff`, `followup`, `stop` or
  `resolved`.
- An artifact `role` of `primary`, `review`, `evidence` or `log`.
- An optional `metrics` list.

The writer validates each typed value and never rewrites a stored item. A gate answer gains its
option's label as `decision`, and `by: operator`, on the way in.

**The legacy reading.** One normaliser per item kind, in `items.mjs`, serves the gate brief, the
dashboard projection and the prior-phase context:
- a decision string reads as `by: run`;
- `defaulted: <id> -> <taken>` reads as `by: default`;
- the spike's `asked:` string, `{question, answer}` and a gate answer read as `by: operator`;
- a risk's `open:`, `tradeoff:`, `followup:`, `left for later:`, `recommend stop:` and
  `resolved:` prefixes read as their tags;
- an untagged risk reads as `open`;
- a bare-string artifact reads as a path with nothing else known.

Under ADR-0006, any state written since 2.2.3 renders.

**Operator decisions (2026-10-06).**
1. **A person's decision is `by: operator`, with `answered_by` naming them.** The terminal renders
   it as "you". On a surface several people read, "you" means the viewer, not the person who
   answered.
2. **Risks are stored as objects** `{risk, tag, change}`. Today's prefix strings are still read.
3. **The checkpoint travels in the gate request as `context.checkpoint`,** beside the unchanged
   `context.summary`. A reader that wants it outside a request runs `gate-brief --checkpoint`
   itself. No display file is written, so nothing can go stale between two asks.
4. **No risks at the glance.** They are one focus away, in More details.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the prefix strings and parse them everywhere | Every reader parses prefixes and arrows itself. A risk that begins "Open question:" collides with the tag. A cockpit shows the prefix verbatim |
| Store the rendered text for each surface | Freezes one presentation into the state. Every new surface would need a new stored string |
| An engine-written display file beside the run | Needs a writing verb, and goes stale between two asks |

### Consequences
- Every gate is shorter at a glance. The full brief is one focus away, and a cockpit receives typed
  data instead of a string to split.
- The revise suggestions come only from open items. Trade-offs and follow-ups no longer reappear
  as changes to make.
- The prose of every closing node is expected to write `headline` and typed items. Until it does,
  the legacy reading renders today's strings: *Done* is the first sentence of the summary, and
  every untagged risk counts as open.
- A cockpit that does not read `context.checkpoint` keeps working from `context.summary`. That
  string must never stop being sent.
- `prior-context` prints a typed risk as `<tag>: <risk> → <change>`, and leaves a decision's
  bookkeeping fields (`at`, `via`, `triage`) out of the prompt.
