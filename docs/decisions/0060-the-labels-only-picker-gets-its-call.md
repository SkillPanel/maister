# ADR-0060 — A labels-only question tool is handed its call, and nothing to rebuild it from

**Status**: Accepted · **Date**: 2026-10-25 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/workflow.mjs` (`runGateBrief`, `printAsk`, `runAreaBrief`); `lib/checkpoint.mjs` (`formOf`, `noteForm`); `lib/question-set.mjs` (`setForm`); `references/gates.md` § *Terminal mode*, § *Revising at a gate*; `references/in-node-questions.md`; `tests/engine/ask-form.test.mjs`

## TL;DR
`gate-brief --ask` prints the arguments of a message-and-form question tool's call and nothing
else: a gate's, a revise's note question's (`--note`), or a running node's question set's
(`--patch-file`); `--details` prints the full brief. `area-brief --ask` does the same for a decision
area. The Copilot build's prose sends every in-session gate and question through them.

## ADR-0060 {#adr-0060}

### Status
Accepted. No definition changes and no graph hash moves. `gate-brief --json --picker=plain` keeps
its shape.

### Context
`gate-brief --json --picker=plain` already returned the call as `form`, beside the question, the
options and the full brief it was built from. Sessions on the labels-only tool kept rebuilding the
call from those parts: most gates went out as a bare list of option ids, without titles,
`(Recommended)` or More details, and one gate's message was rewritten. In-step questions had no
built call at all, so the session composed each form by hand and dropped what the tool hides —
option descriptions — leaving the user choosing between ids. More wording had not held.

### Decision
1. **`--ask` prints only the call.** The whole output is the arguments, so there is no second copy
   of the question or the options to rebuild it from. A refusal is the plain form's.
2. **Every follow-up has its own `--ask` call.** `--note=<revise option>` prints the note question
   (one property `note`: the suggestions as an array, or text with fewer than two); `--details`
   prints the full brief to write out on More details.
3. **A question set is a call too.** With `--patch-file`, no driver needed, the node's set becomes
   one form, a property per question keyed by its id; each option's description, the question's
   `why` and the recommendation ride in the property's description, since the tool shows labels
   only, and the recommended title reads `(Recommended)`. The patch file is deleted once printed.
4. **The prose follows.** The plain-picker passages name `--ask` and nothing else; the rich profile
   is unchanged.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Strip `question` and `options` from `--json --picker=plain` | Same effect for gates, but every reader of the plain JSON changes shape, and in-step questions still have no call |
| More emphatic wording around `form` | Tried: the release before said "pass `form` unchanged" with a self-check, and the session still rebuilt it |

### Consequences
- A session on the labels-only tool composes no form, except a free-text property a node's own
  section names beside a set.
