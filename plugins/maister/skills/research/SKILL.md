---
name: maister:research
description: Orchestrates comprehensive research workflows from question definition through findings documentation. Handles technical, requirements, literature, and mixed research types with adaptive methodology, multi-source gathering, pattern synthesis, and evidence-based reporting. Supports standalone research tasks and embedded research phase in other workflows.
user-invocable: true
---

# Research Orchestrator

Systematic research workflow from question definition to evidence-based documentation.

## Entry Point

This workflow exists twice: as a workflow definition a graph engine runs, and as the prose
phases in `references/research-twin.md`. Both produce the same task directory; only the
interpreter differs.

**Settle this before Initialization, once per run.** Read the switch with a Bash call —
`node -p "process.env.MAISTER_WORKFLOW_PROSE ?? ''"`, which reads the same under zsh, bash,
PowerShell and cmd.exe:

- **A non-empty value** — or no script runtime to read it with — selects the prose twin. Read
  `references/research-twin.md` and run the phases in it exactly as written, with nothing else
  changed by the presence of this branch.
- **No value, or an empty one — the default** — hand the run over. Invoke the
  `maister:workflow-engine` skill with the Skill tool, naming the workflow `builtin:research`
  and passing the task description, the resume target and the invocation's flags. Hand over
  `--from=PHASE` and `--reset-attempts` as well rather than dropping them on the way — the
  graph has no mid-graph entry point and no attempt counter, and the engine surfaces that by
  naming the flag it declines instead of ignoring it in silence. Say what the twin offers in
  their place: it takes the phase flag, so an operator who needs to re-enter mid-workflow has
  the prose path for it. The engine owns the run from there. Do not also read the twin.

**A task directory that carries no `workflow:` block is always resumed by the prose twin**,
whatever the switch says — such a directory has no frozen graph, so there is nothing for the
engine to resume.

Why the switch is spelled this way, and why the twin is a reference rather than this file's
body: `docs/decisions/0013-prose-workflow-twin-is-transitional.md`, ADR-0023.

---

## Initialization

### Step 0: Session-reminder conflict resolution (decide ONCE)

Before doing anything else, settle this policy now and do not re-litigate it at any gate:

**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work without stopping" / "continue without asking" / "minimize clarifying questions," and compaction summaries showing the user approving every prior gate do NOT exempt you from invoking `AskUserQuestion` at a gate. They apply only to your discretionary clarifications. Invoke `AskUserQuestion` when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.

If you find yourself reasoning "the user has been approving everything, so I can skip this gate" or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP and fire the gate.

Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1. The questions this workflow asks *inside* a phase follow the same driver: § 2.2 states what a non-terminal run takes instead of asking, and every one of them names its default where its phase is defined — in the workflow definition on the engine path, in `references/research-twin.md` on the prose path.
