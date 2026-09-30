---
name: performance
description: Orchestrates performance optimization workflows using static code analysis to identify bottlenecks (N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, memory leaks). Accepts optional user-provided profiling data. Reuses standard specification, planning, implementation, and verification phases.
user-invocable: true
---

# Performance Orchestrator

Static-analysis-first performance optimization workflow. Identifies bottlenecks by reading code, then uses the standard specification/planning/implementation/verification pipeline to fix them.

## Entry Point

This workflow runs on the workflow engine, which interprets its definition,
`../workflow-engine/workflows/performance.yml`, with the node prose beside it in `performance.md`.

**Hand the run over before Initialization.** Invoke the `workflow-engine` skill with the
Skill tool, naming the workflow `builtin:performance` and passing the task description, the resume
target and the invocation's flags. The engine owns the run from there: it probes for Node 20,
which this workflow requires, freezes the graph, runs the nodes and asks every gate.

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

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1. The questions this workflow asks *inside* a phase follow the same driver: § 2.2 states what a non-terminal run takes instead of asking, and every one of them names its default where its phase is defined — in the workflow's node prose, `../workflow-engine/workflows/performance.md`.
