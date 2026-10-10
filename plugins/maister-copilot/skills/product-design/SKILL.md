---
name: product-design
description: Interactive product/feature design orchestrator. Transforms fuzzy ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Adaptive phases detect design complexity and adjust depth.
user-invocable: true
---

# Product Design Orchestrator

Interactive workflow for product and feature design — from a fuzzy idea to a development-ready product brief. Phases adapt to the detected design characteristics, and the brief feeds the development workflow.

## Entry Point

This workflow runs on the workflow engine, which interprets its definition,
`../workflow-engine/workflows/product-design.yml`, with the node prose beside it in `product-design.md`.

**Hand the run over before Initialization.** Invoke the `workflow-engine` skill with the
Skill tool, naming the workflow `builtin:product-design` and passing the task description, the resume
target and the invocation's flags. The engine owns the run from there: it probes for Node 20,
which this workflow requires, freezes the graph, runs the nodes and asks every gate.
**The run's first message tells the user what the engine's start banner says**: the workflow
and the task, how many checkpoints they will be asked at, the run's directory, its dashboard
link and the first phase, composed from the lines the freeze prints first, the paths copied as
printed. The terminal collapses that output, so the banner is not on screen until you write it;
before the next call, check that you did (engine Step 4).

- **The four flags are inputs of the definition**: `--research=PATH` is `research`,
  `--no-visual` is `no_visual: true`, `--simple` is `simple: true`, the short
  design depth, and `--full` is `full: true`, the full design whatever the
  detected complexity. An invocation with no description takes it from the
  conversation, as the design brief the operator has been describing.
  Any other flag, apart from the two resume flags below, is not an input of this workflow: name
  it as not taken, in one line, and continue without it — never drop one in silence.
- **A resume target** is checked by the engine before anything runs. A task directory started on
  the 2.x plugin has no frozen graph and is refused with a message that says where to finish it;
  relay that message and stop, writing nothing.
- **`--from=PHASE` and `--reset-attempts`** are handed over rather than dropped on the way. The
  graph has no mid-graph entry point and no attempt counter, and the engine says so by naming the
  flag it declines instead of ignoring it in silence.

---

## Initialization

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `ask_user` at a gate. They apply only to your discretionary clarifications. Invoke `ask_user` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1. The questions this workflow asks *inside* a phase follow the same driver: § 2.2 states what a non-terminal run takes instead of asking, and every one of them names its default where its phase is defined — in the workflow's node prose, `../workflow-engine/workflows/product-design.md`.
