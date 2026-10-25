---
name: research
description: Orchestrates comprehensive research workflows from question definition through findings documentation. Handles technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based reporting. Supports standalone research tasks and runs as a sub-run of another run.
user-invocable: true
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` on a fresh project — run `mkdir -p` on that folder first.

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

# Research Orchestrator

Systematic research workflow from question definition to evidence-based documentation.

## Entry Point

This workflow runs on the workflow engine, which interprets its definition,
`../workflow-engine/workflows/research.yml`, and reads each step's part of the guide beside it,
`research.md`, through `node-brief` — never the whole guide.

**Hand the run over before Initialization.** Invoke the `workflow-engine` skill with the
Skill tool, naming the workflow `builtin:research` and passing the task description, the resume
target and the invocation's flags. The engine owns the run from there: it probes for Node 20,
which this workflow requires, freezes the graph, runs the nodes and asks every gate.
**The run's first message tells the user what the engine's start banner says**: the workflow
and the task, how many checkpoints they will be asked at, the run's directory, its dashboard
link and the first phase, composed from the lines the freeze prints first, the paths copied as
printed. The terminal collapses that output, so the banner is not on screen until you write it;
before the next call, check that you did (engine Step 4).

- **The flags are inputs of the definition**, handed to the engine as such: `--type=TYPE` is
  `research_type`; `--brainstorm` and `--no-brainstorm` are `brainstorm: yes` and
  `brainstorm: no`; `--design` and `--no-design` are `design: yes` and `design: no`; `--context=PATH` is
  `context`, a context pack the first phase copies in. The brainstorm and design
  flags set which way on the checkpoint that decides each stretch recommends; the checkpoint is
  still asked. A flag that was not passed supplies no input, and the run recommends from what it
  found. An invocation
  with no question takes it from the conversation.
  Any other flag, apart from the two resume flags below, is not an input of this workflow: name
  it as not taken, in one line, and continue without it — never drop one in silence.
  `embedded` and `findings_only` are inputs too, but a calling run supplies them and no flag
  sets them: at the checkpoint after the research, finishing with the research already gives
  an operator the findings alone.
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

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1. The questions this workflow asks *inside* a phase follow the same driver: § 2.2 states what a non-terminal run takes instead of asking, and every one of them names its default where its phase is defined — in the workflow's node prose, `../workflow-engine/workflows/research.md`.
