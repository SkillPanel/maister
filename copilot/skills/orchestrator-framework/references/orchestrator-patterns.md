# Orchestrator Patterns

What is left of the shared orchestrator rules, kept because something still names it: the gate rule (§ 2, § 2.1, § 2.2) and the artifact summary contract (§ 7). Every other rule now lives with the workflow engine, at the place the index below gives.

**Where the other sections went**. Paths are the engine's, under `skills/workflow-engine/`, unless they name another.

- **§ 1 Delegation Rules** → engine `SKILL.md` § *Delegation by scheme*. The model and effort every agent call carries → `references/verbs.md` § *Model and effort on every agent call*.
- **§ 3 Context Passing & Decisions** → engine `SKILL.md` § *Before anything else* (the run context every delegate prompt carries). A decision a delegate returns is asked as `references/in-node-questions.md` § *In-node questions* says.
- **§ 4 State Schema** → `references/node-summaries.md` (the `node_summaries` entry, each decision's `by`, each risk's tag), and `references/writing-state.md` § *Project configuration*, § *The common fields* and § *The verification block*.
- **§ 5 Initialization & Resume** → engine `SKILL.md` § *Starting a run* (the run directory and the task-name rule are Step 4), and § *Resume*.
- **§ 6 Issue Resolution** → `agents/verification-runner.md` § *The fix pass* (the fix loop and the documents a fix may touch), `references/in-node-questions.md` § *Findings that need a decision* and § *The specification audit's fix pass*, and the `implementation-verifier` skill (the stopping question).
- **§ 8 Operator Dashboard** → engine `SKILL.md` § *Operator visibility*. Copying decisions and risks verbatim → `references/node-summaries.md` § *Lifting an artifact's summary block*.
- **§ 9 HTML Companion Reports** → `references/grammar.md` § 3.2 (which artifacts owe a page) and `references/writing-state.md` § *A missing or stale companion* (the recovery and the registration).
- **§ 10 Finalization: Artifact Reconciliation** → engine `SKILL.md` § *Recording an outcome* (a path a summary lists is checked too), and `references/writing-state.md` § *Ending the run — the wrap-up* (missing files go under **Needs you**).

---

## 2. Phase Gate Behavior

**The gate rule follows the run's driver**: invoke `ask_user` at every checkpoint when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine's `references/gates.md`, *Driver-suspended mode*. Step 0 of the workflow engine's `SKILL.md` carries it into every run.

### 2.1 Resolving session-reminder conflicts (decide ONCE, do not re-litigate at each gate)

Decide the gate policy once, at the run's start, and do not weigh it again at each gate. A permission mode, a reminder to work without stopping, or a compaction summary showing every earlier gate approved sets no policy. Earlier approvals were answers, not a standing yes, and "minimize clarifying questions" covers only your own discretionary asks. Reasoning your way past a gate on any of these is the failure mode: stop and ask it.

### 2.2 In-node questions under a non-terminal driver

A question a phase asks inside itself follows the run's driver: the workflow engine's `references/in-node-questions.md` § *In-node questions* holds the rule, the defaults a run takes when nobody can be asked (§ *When nobody can be asked*), and what is never defaulted past.

---

## 7. Artifact Summary Contract

Workflow artifacts accumulate deep detail for subagent context — but the human operator needs the signal, not the dump. Every markdown artifact written into the task directory MUST open with this block, before any other content (after the H1 title if one exists):

```markdown
## TL;DR
[3-5 lines max: what this artifact concludes / recommends / delivers]

## Key Decisions
- [decision] — [one-line rationale]

## Open Questions / Risks
- [question or risk the user should know about] → [what would change, when there is a fix to offer]
```

**Rules**:
- TL;DR is hard-capped at 5 lines. It states conclusions, not process ("Auth via middleware on 3 routes; no schema changes" — not "This document analyzes..."), in the user's words rather than state keys or internal flags.
- List Key Decisions and Open Questions / Risks most important first, each led by a short sentence that stands on its own: a gate question shows only the first three of each, by that sentence alone.
- These lines reach the user at a gate, so they follow the workflow engine's *Speaking to the user*.
- A risk or open question that waits on a choice is written to the person reading the gate — "you have not yet chosen between…", "confirm at this checkpoint" — and never names a role (owner, lead, operator, reviewer) as the one who decides: who is asked is decided outside the run, so a named role can send the reader to someone else.
- Write a risk the user could act on as `<risk> → <what would change>`: it is lifted as an `open` risk whose `change` is the part after the arrow, and a revise at the gate offers that change. A trade-off already accepted or a follow-up outside this run says so in its text, so it is lifted with that tag instead.
- Omit `Key Decisions` / `Open Questions / Risks` sections entirely when empty — never write "None".
- Full detail follows below the block, unchanged. The block is a lens, not a replacement.
- A reviewer's own grading notes (why it rated a finding medium) belong in the body, not in Key Decisions.
- Applies to every artifact-writing subagent and skill. Orchestrators MUST include the contract in every artifact-writing prompt (the `summary contract:` line of `run-context`).
- The step that ran the writer lifts the block into its `node_summaries` entry as the workflow engine's `references/node-summaries.md` says. What each risk tag means is its § *What a risk is*, and each decision's `by` its § *Who settled a decision*.

**Exempt**: `orchestrator-state.yml`, `dashboard-data.js`, raw mockup files, screenshots, and incremental logs (`work-log.md` — append-only, gets no retroactive TL;DR).
