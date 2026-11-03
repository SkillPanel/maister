# ADR-0067 — On Copilot, a hook hands the engine's question call to `ask_user`

**Status**: Accepted · **Date**: 2026-11-03 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/workflow.mjs` (`printCall`, `ASK_RECORD`); `plugins/maister/hooks/hand-over-question.mjs`; `platforms/copilot-cli/hooks.json`; `skills/workflow-engine/references/gates.md` (*Terminal mode*, the plain picker); `tests/engine/ask-form.test.mjs`, `tests/engine/area-brief.test.mjs`, `tests/engine/hooks.test.mjs`

## TL;DR
- **The engine records every question-tool call it prints.** `gate-brief --ask` and `area-brief --ask`
  write the printed call to `.ask.json` beside the run's state, as well as printing it.
- **A Copilot preToolUse hook on `ask_user` hands that record over** in place of the arguments the
  session typed. It uses Copilot's `modifiedArgs`, and only when the record is fresh (under ten minutes old)
  and asks the same questions with the same option ids. It renames the record to `.ask.used.json` once
  used.
- **The hook fails open, never blocks a call and never forces a question.** It is not gate enforcement,
  and it ships with the Copilot variant only.

## ADR-0067 {#adr-0067}

### Status
Accepted. No workflow definition changes, so no `graph_hash` moves. Interface 1.11 → 1.12 (the variant's
hooks gain a `PreToolUse` matcher, `ask_user`).

### Context
On Copilot the session asks a gate with `ask_user`. It is told to pass the output of `gate-brief --ask`
as the call's arguments, unchanged. It still has to retype that output into the call: a brief of about two
kilobytes, the message holding *Done*, *Found*, *Next*, *Decided by the run* and the counts. Some runs pass
it whole and others do not. In one development run, eight of nine calls reached the form shortened:
- the run's own decisions were dropped;
- the "(skipping …)" notes on *Next* were dropped;
- the model counts were dropped;
- *Found* lines were reworded.

The option labels and ids were kept every time. The tool definition, the session's system prompt and the
plugin text were byte-identical to an earlier run that passed ten of ten unchanged, so the variance is the
session's own retyping. Earlier rounds of the same failure had already moved the call to a single printed
document. More wording does not stop a model from editing what it types.

### Decision
1. **The engine keeps the call it printed.** Every `--ask` that prints a call writes the same bytes, by an
   atomic rename, to `<run>/.ask.json`, the folder of `--state`. A later `--ask` replaces it. `--details`
   prints text and leaves the file alone, as does a refusal. A run folder that cannot be written leaves the
   printed call as it is: the record is a convenience, never the verb's result.
2. **A preToolUse hook on `ask_user` hands it over.** It acts on the main session's call only (no
   `agent_type`), and only with a record that:
   - is younger than ten minutes, because a workflow's gate ids repeat in every run and an old record can
     match a later question;
   - asks the same property ids with the same option ids.

   Of several matching records, the run whose `orchestrator-state.yml` was written last wins. A matching
   record is renamed `.ask.used.json`: after it is handed over, or when the call already equals it. A
   question asked again without a fresh `--ask` (a More details re-ask, a re-ask with other marks) therefore
   goes through as the session wrote it. The hook answers with `modifiedArgs` under the variant's
   `HOOK_SHAPE` line.
3. **Copilot only.** The hook script lives with the other hooks in `plugins/maister/hooks/` and is
   registered only by `platforms/copilot-cli/hooks.json`. On Claude Code the gate is asked from
   `gate-brief --json` through AskUserQuestion's own fields, a different call shape, and it reaches the form
   unchanged. Nothing there has been seen to need a hand-over.

### Why this is not gate enforcement
Gate enforcement, refusing to go on until a gate is asked, is not in this repository, and this hook adds
none:
- **It fails open.** Unreadable input, no record, a stale or different record, an agent's call or any error
  each leave the call exactly as the session wrote it.
- **It never blocks.** It emits no `permissionDecision` and denies nothing.
- **It never forces a question.** It runs only when the session has already chosen to call `ask_user`, and
  it changes what that call shows to what the engine built for the same question.

### Consequences
- What the person reads at a gate on Copilot is what the engine built, whatever the session retyped.
- Both runs of the live check confirmed it on Copilot CLI 1.0.105:
  - the form recorded as shown carried the record's top-level schema `type` where the session had dropped
    it;
  - a call typed as "Short probe?" was shown as the record's full message.
- The rule in `gates.md` stays: the session still passes the output unchanged, and the hand-over is a
  safety net.
- A task folder now holds `.ask.json` or `.ask.used.json` beside its state. Both are dot files the run
  rewrites, and nothing reads them back except the hook.

### Rejected alternatives
- **Louder wording at the call.** The rule was already explicit and placed at the call, and the variance
  persisted.
- **Matching on ids alone, with no age limit and no consumption.** A gate's ids repeat in every run, so a
  stale record could replace a later question with an earlier run's text.
- **Denying a call that differs from the record.** That would block a gate, which is enforcement, and it
  would trade a shortened question for a stalled run.
