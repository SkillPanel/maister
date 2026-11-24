# Node summaries

A node summary is the `node_summaries.<node>` entry a step writes when it closes: what it found,
settled, fixed and left open, read by every later step's `prior-context`, by the gate that
closes the stretch and by the dashboard. The engine's Step 1 reads this file whole; the writer
merges an entry field by field (`references/writing-state.md` § *Writing state*), and a gate's own fields are
`references/gates.md` § *Before every gate — the gate brief*.

## The entry shape

Every `node_summaries.<node>` entry uses this base shape (a workflow's guide may add step-specific fields):

```yaml
node_summaries:
  <node>:
    headline: null       # one sentence (≤ 220 chars) for the stretch a gate closes; on the node the gate needs; a gate shows it as Done
    summary: null        # 1-2 sentence prose summary; the top findings go here, never in risks; a gate shows it whole as Found
    decisions: []        # [{decision, by, rationale?}] — by: run | audit | default | operator
    fixes_applied: []    # [{finding, change}] — what the phase fixed without asking
    risks: []            # [{risk, tag, change?}] — tag: open | tradeoff | followup | stop | resolved
    stories: []          # one-line strings — what the node drafted for the person to confirm; a gate lists each
    artifacts: []        # [{path, label, html}] — paths relative to task root; html is the optional companion
                         #   page (references/writing-state.md § A missing or stale companion), null when absent
```

`decisions`, `risks` and `artifacts` feed the dashboard and every later step's `prior-context`.
Empty lists are fine when a step produced none.

## Who settled a decision

**Who settled a decision** is its `by`: `run` for what the phase itself decided, `audit` for what
a spec audit or the verification reviews settled, `default` for a question a driven run did not
ask (`references/in-node-questions.md` § *When nobody can be asked*), and `operator` for a
person's answer — recorded with the question it answered, never credited to anyone else; the
writer stamps who answered (`answered_by`, `via`). A phase's `decisions` hold only what that
phase settled: an earlier phase's decision or answer, whoever gave it and however reworded, is
never restated as its own. Its `risks` likewise hold only what it raised: a risk an earlier phase
recorded stays there, never restated.

**A fix is not a decision.** What a phase changed without asking — a verification fix, a
spec-audit fix, a trim to a guide — goes in `fixes_applied`, each as `{finding, change}`: what
was wrong and what changed, a few words each. It never also goes in `decisions`: the run settled
nothing by it, and the gate lists it under "Fixed by the run", apart from what was decided.

## What a risk is

**What a risk is** is its `tag`: `open` for an uncertainty the user can still change, with
`change` naming what would change (a revise at the gate offers it); `tradeoff` for a consequence
of a choice already made; `followup` for work outside this run; `stop` when the user should stop
here (it makes Stop the recommended answer at the next gate); `resolved` for one a later phase
settled. A finding is neither a decision nor a risk: it belongs in `summary` and `headline`.

**A resolved risk keeps its entry**: when a later phase settles a risk recorded earlier, it sets
that entry's `tag` to `resolved` (e.g. `{risk: "transient warning — query lookup chosen", tag:
resolved}`; an older string entry is prefixed `resolved:` instead), and the dashboard dims and
strikes it. Plain strings written by older runs still read — a decision as `by: run`, a risk as
`open`.

## Lifting an artifact's summary block

A step whose delegate wrote a markdown artifact lifts the artifact's summary block into its
entry. `decisions` and `risks` entries are copied **verbatim** from the artifact's Key Decisions /
Open Questions / Risks blocks — never re-summarized or shortened. The contract already caps their
length at the source; compressing them again strips the meaning the operator needs. A risk
written as `<risk> → <what would change>` becomes an `open` risk whose `change` is the part after
the `→`.

## In the reader's words

`summary`, `decisions` and `risks` are read by the operator, at a gate and on the dashboard, so
write them in the operator's words: what was found and what it means, never a state key, a value
name, an internal flag or a slug used as a label ("no UI work, so no mockups" — not "ui_heavy
false, mockups off"). List decisions and risks most important first, and lead each with a short
sentence that stands on its own: a gate question shows the first three of each by that sentence
alone, and the dashboard shows the whole item. A risk that waits on a choice speaks to whoever
reads the gate and names no role as the one who decides (engine § *Speaking to the user*).
