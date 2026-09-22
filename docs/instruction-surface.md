# The instruction surface, measured

How much text this plugin puts in front of a model, what counts as "in front of", and how to
take the measurement again. Two different numbers answer two different questions, and they are
about two orders of magnitude apart, so which one is being quoted matters more than either
value.

Measured 2026-09-14. The previous measurement, 2026-09-11, is quoted below where the change
between them is the point.

## The corpus: every instruction file the plugin ships

The whole body of prose a run can pull in — skill bodies, the references they point at, agent
definitions and command files. Nothing here is loaded at session start; it is what *exists* to
be loaded, and it is the number a reduction effort is scored against.

| Layer | Files | Lines | Bytes | Tokens |
|---|---:|---:|---:|---:|
| Skills (`SKILL.md`) | 20 | 7,303 | 450,084 | 103,347 |
| References | 29 | 4,061 | 223,973 | 51,995 |
| Agents | 25 | 8,466 | 310,008 | 67,869 |
| Commands | 6 | 798 | 29,007 | 6,585 |
| **Total** | **80** | **20,628** | **1,013,072** | **229,796** |

**What moved since 2026-09-11.** Three reference files referenced by nothing were deleted:
1,199 lines, 39,759 bytes, 9,438 tokens, and the reason they could sit there unnoticed is that
nothing checked — a reachability check over the corpus now runs with the rest of the suite, in
both directions. The corpus is nevertheless *larger* than it was, because the skills and the
remaining references grew more over the same three days than the deletion removed. Both facts
belong here: a reduction effort that quotes only its own subtraction is measuring its intention
rather than the plugin.

**What moved since, 2026-09-21, not yet folded into the table above.** The prose twins of
`development`, `research` and `performance` moved out of their orchestrator `SKILL.md` files into
`references/<name>-twin.md` (ADR-0023): 117,534 bytes leave the Skills row and 122,483 arrive in the
References row, and the corpus total is unchanged but for the hand-offs' own framing. The number
this change is scored against is not in this section at all — it is what a *run* loads, and there
the three orchestrators fell from 129,071 B to 11,537 B on the default path. That is the distinction
this document opens with, in its sharpest form: a corpus measurement would have scored this change
at approximately zero.

## The session-start footprint: what a session pays before any work

Measured 2026-09-11 and not re-taken: deleting a reference body changes nothing here, because a
skill contributes its frontmatter and not its text. What the host actually reads into a session
that has done nothing yet. A skill contributes its
name and description, not its body; the body is read only if the skill is invoked. The same
holds for agents and commands. One hook fires on every session start and its text is context
too.

| What loads | Count | Tokens |
|---|---:|---:|
| Skill names and descriptions | 20 | 1,430 |
| Agent names and descriptions | 25 | 1,207 |
| Command names and descriptions | 6 | 130 |
| Session-start reminder | 1 | 381 |
| **Total** | | **3,148** |

So a session that loads this plugin and does nothing carries roughly **three thousand tokens**
of it, against a corpus of roughly **two hundred and thirty thousand**. Invoking one
workflow changes that immediately: a single orchestrator's body and the patterns reference it
reads at start are tens of thousands on their own. The footprint above is a floor, not a
budget.

## Method

**The corpus** is every `.md` under the plugin in the four layers above, counted whole. The
count excludes the documentation templates a skill ships as payload rather than as instructions,
and everything that is not prose — hooks, schemas, scripts and page assets are code.

**Tokens** are a real tokenizer's count, not a byte heuristic. The long-standing shortcut of
dividing bytes by four **overestimates this corpus by about 10%**: it tokenizes at 4.41 bytes
per token, so bytes/4 gives 253,268 against a measured 229,796. Anyone comparing against an
older figure should know which instrument produced it. The tokenizer used is not the one the
model uses — no exact tokenizer ships publicly — so treat the total as accurate to a few percent
and re-measure with the same tool when comparing over time.

**The session-start footprint** is the frontmatter the host reads plus the hook's own output,
tokenized the same way.

**Cross-checking it against a live session** was attempted and is reported here because the
result is a caveat worth keeping: running an identical trivial prompt with and without the
plugin, over five paired runs, gave deltas from 110 to 2,182 tokens. The with-plugin total was
stable across four of the five; the baseline was not, because a session's own prompt carries
dynamic content that moves between runs. The live A/B therefore confirms the order of magnitude
— single-digit thousands, not tens of thousands — and cannot resolve the plugin's share more
finely than the host's own variance of roughly a thousand tokens. The file measurement is the
more precise instrument; the A/B is the sanity check on it.

## Taking it again

Both numbers come from counting files in the tree, so a fresh measurement needs only the tree
and a tokenizer. The tokenizer is `gpt-tokenizer` at its default encoding, installed for the
measurement and not a dependency of anything here; the corpus is the four layers above, counted
whole. Keep both identical to these, or the comparison measures the change in method rather than
the change in the plugin — the agent and command rows are the control, unchanged across the two
measurements above because nothing in them changed.
