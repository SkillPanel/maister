# Orchestrator Patterns

Shared execution rules, schemas, and patterns for all workflow orchestrators.

---

## 1. Delegation Rules

**Always use Skill/Task tools to delegate. Never execute delegated work inline.**

When a phase requires delegation:
1. Use the **Skill tool** for **skills** — loads SKILL.md instructions into the main agent's context; the main agent executes the skill's instructions and continues with the orchestrator workflow afterward
2. Use the **Task tool** for **subagents/agents** — spawns an isolated subprocess that returns results when complete
3. Wait for completion before continuing

**Skills and agents are NOT interchangeable.** Skills always use Skill tool; agents always use Task tool. Never invoke a skill via Task tool (`subagent_type`) — it will fail with "Agent type not found."

**Why skills MUST use Skill tool**: Skills like `codebase-analyzer`, `implementation-plan-executor`, and `implementation-verifier` spawn their own subagents (Explore agents, reporters, planners). Subagents cannot spawn other subagents — so these skills must run in the main agent context via Skill tool.

**Companion agent pattern** (e.g., `docs-operator`): Only works for skills that do NOT spawn subagents (like `docs-manager` which only does file operations). A companion agent preloads the skill via the `skills` frontmatter field and is invoked via Task tool. This pattern fails for any skill that needs to spawn subagents.

### Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| "I'll analyze the codebase..." | Bypasses codebase-analyzer skill | Use `Skill` tool with `maister:codebase-analyzer` |
| "Let me create the specification..." | Bypasses specification-creator | Use `Task` tool with `maister:specification-creator` subagent |
| "Looking at the gaps between..." | Bypasses gap-analyzer subagent | Use `Task` tool with `maister:gap-analyzer` |
| "I'll implement this by..." | Bypasses implementation-plan-executor skill | Use `Skill` tool with `maister:implementation-plan-executor` |
| Reading a SKILL.md then doing the work | Skill files are instructions FOR skills | Use Skill tool to invoke |
| Spawning Explore agents in orchestrator | Codebase-analyzer manages its own agents | Invoke skill, let IT spawn agents |

### When Inline Execution is Acceptable

These do NOT require delegation:

1. **Clarifying questions phases** — AskUserQuestion is direct
2. **State updates** — reading `orchestrator-state.yml`, and writing it through the engine's `write-state` verb, never an editor tool
3. **Phase announcements** — Outputting status messages
4. **Simple decisions** — Enabling/disabling optional phases
5. **Finalization** — Creating summary, updating metadata

For all analysis, planning, implementation, and verification phases: **ALWAYS DELEGATE**.

**Never acceptable inline** (regardless of perceived task simplicity):
- Specification creation → always delegate to `maister:specification-creator` subagent
- Implementation planning → always delegate to `maister:implementation-planner` subagent
- Gap analysis → always delegate to `maister:gap-analyzer` subagent
- Codebase analysis → always delegate to `maister:codebase-analyzer` skill
- Code review → always delegate to `maister:code-reviewer` subagent
- Test execution → always delegate to `maister:test-suite-runner` subagent
- Implementation completeness → always delegate to `maister:implementation-completeness-checker` subagent

"The task is simple" is NOT a valid reason to skip delegation.

---

## 2. Phase Gate Behavior

**The gate rule is qualified by the run's driver, not by the orchestrator**: the AskUserQuestion rule below applies when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.

**`→ MANDATORY GATE` means STOP and USE AskUserQuestion.** This is NOT optional. You MUST invoke the `AskUserQuestion` tool and WAIT for user response. Proceeding without it is a protocol violation.

All orchestrators pause at `→ MANDATORY GATE` transitions for user review and prompt for optional phases.

**State ordering rule**: a gate is recorded answered only AFTER the operator answers it. The node it closes is recorded `completed`, with its summary, BEFORE the gate is asked, because the gate brief is rendered from that summary. Correct sequence: finish the node's work → write its summary and its `completed` status → render the brief and ask the gate → receive the answer → record it on the gate.

### Phase Gates Override Permission Modes

Claude Code's `auto` permission mode instructs the model to execute immediately and minimize clarifying questions. The `→ MANDATORY GATE` checkpoints in this framework are an explicit stated boundary that overrides that instruction.

You MUST invoke `AskUserQuestion` at every `→ MANDATORY GATE` in every permission mode — `default`, `acceptEdits`, `auto`, `plan`, `bypassPermissions` — when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2. "Minimize clarifying questions" applies to the model's own discretionary asks; it does not override workflow checkpoints the orchestrator has been instructed to enforce.

### 2.1 Resolving session-reminder conflicts (decide ONCE, do not re-litigate at each gate)

Your session may include reminders telling you to "work without stopping for clarifying questions," "continue without asking," "minimize clarifying questions" (auto / acceptEdits / bypassPermissions modes), or compaction summaries showing the user approving every prior gate. **None of these override this framework's `→ MANDATORY GATE` checkpoints.**

Decide this policy at orchestrator entry. Do NOT re-evaluate it at each gate. Re-litigating the rule at each gate is the documented failure mode that produced this section — a model that read this rule, then weighed it against a competing session-reminder at every gate, and lost every time.

- "Work without stopping" / "minimize clarifying questions" applies ONLY to your discretionary clarifications in a terminal run, never to `→ MANDATORY GATE` workflow checkpoints.
- A user who said "approve" to ten prior gates was being patient, not setting policy. Each gate is a fresh question.
- No permission mode, session-reminder, prior-session pattern, or "this task is simple" judgment exempts you from firing `AskUserQuestion` at `→ MANDATORY GATE`.

If you ever find yourself reasoning "the user has been approving everything / told me to continue / set auto-mode, so I can skip this gate," that reasoning is the failure mode. STOP and fire the gate.

### 2.2 In-node questions under a non-terminal driver

A gate is not the only question a phase asks. A phase may ask its own — a clarification, an opt-in deciding whether a later phase runs, a decision between approaches, or a loop offering another pass — and those are *not* gates: they carry no `→ MANDATORY GATE` marker, every answer continues the run, and no request file exists for them. They follow the same driver the gates do:

| `orchestrator.driver.kind` | A question a phase asks inside itself is |
|---|---|
| absent, or `terminal` | asked in session, exactly as the phase describes it |
| `cockpit`, `dispatch` | **never asked**; the phase takes the default its own prose names, and records that it did |

**Why a default and not a suspension.** Suspending is gate-shaped: a request carries a node id, a kind, a question and its options, and there is no request kind for a question asked inside a phase. A run under a driver therefore has two honest outcomes and no third — take the stated default, or fail. Asking anyway is the defect this rule prevents: nobody is in the session to answer.

**Every such question names its default, in the phase that asks it.** What each family takes:

| The question | What a non-terminal run takes |
|---|---|
| A clarification | nothing is asked; the analysis or the delegate's own answers stand, and the phase writes its artifact and sets its flag as a run with nothing to ask already does |
| An opt-in | the recommended option |
| A decision between alternatives | the recommended one; when nothing is recommended, the decision stays open and is named in the executive summary printed before the next gate |
| A loop offering another pass | the accept-as-is exit — the following gate is the operator's route back |
| An exhausted recovery budget | the phase fails rather than choosing retry or skip on the operator's behalf |

**What is recorded.** One entry per defaulted question on that phase's summary `decisions` list, as a plain string — `defaulted: <question-id> -> <default taken>` — where the id is the one the phase prose names and the text after the arrow is the default this run actually used. A phase that asked nothing because it had nothing to ask records nothing. The entry is an ordinary decision item and reaches the dashboard the way every other decision does (§ 4, § 8).

**A run started under a driver has its inputs**, so a task description or research question is never invented: if one is genuinely missing, stop with `RUN-FAILED` rather than inventing one.

**Two things this never defaults past.** It settles who answers, not what may be waived: an unresolved critical issue is not proceeded past — the default fixes what is fixable and carries the remainder into the following gate (§ 6 Exit Conditions holds unchanged) — and a decision the phase owes is still *resolved* rather than skipped, since a defaulted decision satisfies a completeness self-check and an unasked, unrecorded one does not.

### Anti-Patterns

| Anti-Pattern | Why It's Wrong |
|--------------|----------------|
| Proceeding without AskUserQuestion at phase gates | User loses control, can't review or stop |
| Saying "I'll pause here" without tool call | Words are not pauses. Tool invocation required. |
| Auto-accepting subagent decisions without asking | User must consent to scope/approach decisions |
| Outputting a summary after phase work, then ending turn before reaching `→ MANDATORY GATE` | Gate is skipped; user loses control at the most critical review point. The gate must be the FIRST action after phase work completes — no summaries, no output before it. |
| Recording a gate answered before the operator answers it | State corruption — downstream nodes become ready on an answer nobody gave. Gate → operator's answer → record it. Never reverse this order. |
| "Auto mode / acceptEdits / bypassPermissions is on, so I'll skip the gate to minimize questions" | The orchestrator's phase gates are an explicit stated boundary that overrides auto mode's "minimize clarifying questions" instruction. Gates fire in every permission mode. See § 2 "Phase Gates Override Permission Modes". |
| "The subagent works autonomously, so the orchestrator should too" | Subagents have no user channel; the orchestrator IS the user channel. Conflating the two removes all user visibility. |
| Treating an empty `decisions_needed` as license to skip the phase exit gate | The DECISION GATE (mandatory-when-decisions-exist) and the phase exit `→ MANDATORY GATE` (mandatory-always) are separate. Empty `decisions_needed` only skips the former. |
| Treating a prior-session compaction summary that shows the user approving every gate as license to skip future gates | The user was being patient, not setting policy. Each gate is a fresh question. Compaction summaries leak behavior patterns into new sessions; they are not standing orders. See § 2.1. |
| Re-litigating the gate rule at each gate site instead of deciding once at orchestrator entry | The framework rule and the inline gate markers BOTH say "gates fire regardless." Weighing them against a competing session-reminder at every gate produces the same wrong answer N times. Decide policy once, at intake (§ 2.1). |

---

## 3. Context Passing & Decisions

### Context Passing

All subagent prompts must include context from prior phases, and **that context is
fetched, not composed**:

```
prompt: |
  [Task instructions]
  Task path: [path]

  [the stdout of `prior-context --state <task path>/orchestrator-state.yml`,
   pasted in unedited — it opens with its own heading]

  ## RESEARCH CONTEXT (if research_reference exists)
  Research question: [research_reference.research_question]
  Summary: [phase_summaries.research.summary]

  ## ARTIFACTS TO READ
  [List relevant files for full details]

  ## ARTIFACT SUMMARY CONTRACT
  Open every markdown artifact you write with the summary block from
  orchestrator-patterns.md § 7 (TL;DR / Key Decisions / Open Questions / Risks).
  The writer heading is `## Open Questions / Risks`.
```

**Why**: Subagents run in isolated context. Without summaries, they must re-parse entire files and miss prior decisions.

**The prior-phase passage is fetched, not composed.** Four attended runs measured the same thing: the rule holds where the lift is mechanical and happens once, and fails where a phase writes the passage afresh from an artifact it has already read — thirteen items arrived as seven clauses on one line, and nothing in the prompt recorded that they had ever been thirteen. So the composing step is gone, and a hand-written `## CONTEXT FROM PRIOR PHASES` block is the superseded shape. The workflow engine's read-only `prior-context` verb takes the run's state file and prints the whole passage — every phase, its decisions and its risks, one bullet each with the count beside the heading, so a truncation shows up as a number that disagrees with its own bullets. It finds the run's context block itself, and renders `node_summaries` for a run that has none, so every workflow is served by the same call (`workflow-engine/SKILL.md` § *Executing a node* has the invocation). Call it **at each consuming delegate** — one call per prompt, in the turn that composes it — paste its stdout in, and leave it alone: trimming it, re-ordering it or tightening it is the same defect by hand. Re-using a rendering produced for an earlier delegate is not licensed however recent it looks: a summary written in between makes it stale, the prompt records nothing about when it was taken, and a prompt that happens to be current is current by timing rather than by construction. The verb reads the run and writes nothing, so the extra call costs nothing.

### Context Extraction

After each phase, extract key findings into the `phase_summaries` of the run's context block, `<name>_context` (§ 4 Extension Pattern says how the name is derived):

1. Parse subagent output for key fields
2. Create 1-2 sentence summary
3. Extract `decisions`, `risks`, and `artifacts` from the artifact's summary block (§ 7)
4. Update state: `<name>_context.phase_summaries.[phase_name]` — every successful `write-state` also projects the operator dashboard (§ 8), so there is nothing else to refresh

This enables context passing to downstream phases and supports resume.

**Critical**: Some subagent outputs contain structured fields that control downstream phase logic (e.g., `task_characteristics` from gap-analyzer gates Phase 4 and Phase 10 defaults). These MUST be extracted and written to state immediately — not just summarized. Re-read state after writing to verify the values were stored correctly.

### Decision Enforcement

When a subagent returns `decisions_needed` items, the orchestrator MUST present them to the user via AskUserQuestion. Decisions are never silently skipped.

**Anti-Patterns** (NEVER do this):

| Anti-Pattern | Why It's Wrong |
|---|---|
| "I'll accept the recommended defaults" | User loses control over critical scope decisions |
| Logging decisions without asking | Documentation is not consent |
| "The recommendations are clear, no need to ask" | Clarity is not consent. User may disagree. |
| Skipping decisions because task seems simple | Simple tasks can have non-obvious scope implications |

**Decision Gate Pattern**:

1. **Parse**: Extract all critical and important decisions from subagent output
2. **Present**: every decision is its own **single-select question with its own option set** — NEVER flatten several decisions' options into a single question's option list (the user could pick two conflicting options from one decision, or none from another). Critical decisions: one `AskUserQuestion` call each, with full context shown before the call. Important decisions: may be grouped as up to 4 **separate questions within one `AskUserQuestion` call**. A question may allow selecting multiple options ONLY when those options are genuinely non-exclusive (e.g. "which verifications to run?") — never as a way to bundle decisions.
3. **SELF-CHECK**: "Did I present ALL decisions from `decisions_needed`? If not, STOP."

**Scope note**: this grouping guidance applies to `decisions_needed` triage (pre-analyzed, independent decisions). Interactive convergence flows (e.g. research Phase 4) override it with strictly ONE question per call — later areas depend on earlier answers.

---

## 4. State Schema

All orchestrators use `orchestrator-state.yml` at `.maister/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml`. The `[type]` dir matches the workflow name except for migration, whose type dir is `migrations/` (plural) — the normative list ships with the pro register § A4. A workflow the project defines and starts by name (`/maister:run <name>`) follows the same rule: its name is its type dir.

### Timestamp Rule (applies to ALL timestamps everywhere)

Every timestamp — `created`, `updated`, `phases[].started/completed`, `generated` in `dashboard-data.js`, dates in work-log entries — MUST be a **full ISO 8601 date AND time in UTC** (`2026-06-11T14:32:07Z`).

- **NEVER write a date-only value** (`2026-06-11`) and **NEVER zero-fill the time** (`T00:00:00Z`) — you do not know the clock time from context, so GET it from the system: `date -u +"%Y-%m-%dT%H:%M:%SZ"` (one Bash call can serve every timestamp written in the same turn).
- Why it matters: phase durations, "elapsed" displays, and freshness indicators on the operator dashboard are computed from these values — a midnight placeholder renders as nonsense durations.
- Task *directory names* keep their date-only `YYYY-MM-DD-` prefix — that is a name, not a timestamp.

### Project Configuration (`.maister/config.yml`)

An optional project-level config file at `.maister/config.yml` (sibling of `.maister/docs/` and `.maister/tasks/`) holds defaults that apply to every workflow. It is scaffolded by `/maister:init` but is not required — when absent, every key falls back to its default.

```yaml
# Maister project configuration.
html_output: true     # Generate the operator dashboard + HTML companion reports. false = markdown-only.
mockup_format: html   # UI mockups: html (visual companion) or ascii (ascii-mockup-generator).
```

| Key | Default | Effect |
|-----|---------|--------|
| `html_output` | `true` | When `false`, workflows skip the operator dashboard (§ 8) AND the HTML companion reports (§ 9): no `dashboard.html`/`dashboard-data.js`, no browser auto-open, no `.html` companions. Markdown artifacts, their § 7 TL;DR blocks, and `orchestrator-state.yml` are produced regardless. |
| `mockup_format` | `html` | How UI mockups are rendered when a workflow generates them (development's `ui-mockups` node, product-design's `visual-prototyping` node, standalone `/maister:mockup-studio`). `html` → the `mockup-studio` visual companion (browser preview, `.html` files). `ascii` → the `ascii-mockup-generator` agent (no Node/browser). Auto-falls back to `ascii` when Node.js is unavailable. Independent of `html_output` (mockups are design deliverables, not report companions). In product-design, `mockup_format: ascii` is equivalent to the `--no-visual` flag; the flag is a per-run override (flag > config). |

**How it is read**: at initialization (§ 5) the orchestrator reads `.maister/config.yml` if present and seeds `orchestrator.options.html_output` and `orchestrator.options.mockup_format` into state (defaults `true` / `html` when the file or key is absent). All downstream gates read these from state, not the file — so resume is consistent and the file is read once.

### Common Fields

```yaml
orchestrator:
  # Phase tracking
  started_phase: [phase-name]
  completed_phases: []
  failed_phases: []

  # Optional phase flags — shared keys only; `options` is an open map
  options:
    sequential: true | false | null  # Set by --sequential. Read by implementation-plan-executor Phase 2 to disable parallel wave dispatch.
    html_output: true | false        # Seeded from .maister/config.yml at init (default true). Gates dashboard + HTML companions — see "Project Configuration" below.
    mockup_format: html | ascii      # Seeded from .maister/config.yml at init (default html). Passed to mockup-studio (development's ui-mockups node / product-design's visual-prototyping node). See "Project Configuration" below.
    # per-orchestrator keys (development's e2e_enabled, user_docs_enabled, code_review_enabled, …) live here too

  # Timestamps
  created: [ISO 8601 timestamp]
  updated: [ISO 8601 timestamp]
  task_path: .maister/tasks/[type]/YYYY-MM-DD-task-name

# Task metadata
task:
  title: [human-readable task title]
  description: [full task description]
  status: pending | in_progress | completed | failed | blocked
  tags: []
  priority: null  # high | medium | low
```

The three keys above are the only `options` keys every orchestrator shares. `options` is an **open map**: per-workflow keys are listed in each workflow definition's node prose (`workflow-engine/workflows/<name>.md`) (the pro register § A1). The keys the state writer seeds and merges beside them are the engine's (`workflow-engine/SKILL.md` § *Writing state*).

### Extension Pattern

Workflows add domain-specific fields in their context block, at the **top level** of the state file — never nested under `orchestrator:` (the pro register § A1). The block's name is derived from the workflow's name: `<name>_context`, with the name's dashes written as underscores, and the state writer applies the rule (`workflow-engine/SKILL.md` § *Writing state*). The root carries exactly one context block, or none (a chain run, or a workflow whose nodes record only `node_summaries`, has none). The built-ins' blocks are below; development and product design are the two whose block does not carry their own name:

| Domain | Context Field | Example Fields |
|--------|---------------|----------------|
| Development | `task_context` | risk_level, architecture_decision, task_characteristics (`ui_heavy` nests here), research_reference |
| Performance | `performance_context` | bottlenecks_identified, user_data_available, bottleneck_priorities |
| Migration | `migration_context` | migration_type, migration_strategy, breaking_changes, rollback_plan_created |
| Research | `research_context` | research_type, research_question, confidence_level, gathering_strategy |
| Product design | `design_context` | design_characteristics, complexity_level, refinement_iterations, visual_companion |

Every context carries `phase_summaries`. The state writer maps each workflow to its block (`workflow-engine/SKILL.md` § *Writing state*); the full schema of each block is in that workflow's node prose, `workflow-engine/workflows/<name>.md` ("Run-scoped context", "Phase summary keys", and for product design "The context block").

### Shared: research_reference

When development starts from completed research (`--research` flag):

```yaml
task_context:
  research_reference:
    path: null
    research_question: null
    research_type: null           # technical | requirements | literature | mixed
    confidence_level: null        # high | medium | low

  phase_summaries:
    research:
      summary: null
      key_findings: []
      recommended_approach: null
      decisions_made: []
```

Research context flows to ALL phases via context passing. Artifacts are also copied to `analysis/research-context/`.

### Shared: verification_context

All orchestrators with verification phases use:

```yaml
verification_context:
  last_status: passed | passed_with_issues | failed | null
  issues_found: []           # [{id, severity, source, description, fixable, fixed}]
  fixes_applied: []
  decisions_made: []
  reverify_count: 0          # max 3
```

Record every issue in `issues_found` as an object, never as a bare string: `severity` is `critical`, `warning` or `info` as the report graded it, `id` is the report's own number for the finding, and `fixed: true` marks one fixed since (keep its original severity). The dashboard shows each issue under its `severity`. A string carries no severity field, so its severity has to be guessed from the text.

### Shared: phase_summaries entry shape

Every `phase_summaries.[phase_name]` entry uses this base shape (orchestrators may add phase-specific fields):

```yaml
phase_summaries:
  [phase_name]:
    summary: null        # 1-2 sentence prose summary
    decisions: []        # [{decision, rationale}] — from artifact Key Decisions blocks + gate outcomes
    risks: []            # strings — from artifact Open Questions / Risks blocks
    artifacts: []        # [{path, label, html}] — paths relative to task root; html is the
                         #   optional companion report (§ 9), null when absent
```

`decisions`, `risks`, and `artifacts` feed the operator dashboard (§ 8) and downstream context passing. Populate them at context extraction time (§ 3) — empty lists are fine when a phase produced none.

`summary`, `decisions` and `risks` are read by the operator, at a gate and on the dashboard, so write them in the operator's words: what was found and what it means, never a state key, a value name, an internal flag or a slug used as a label ("no UI work, so no mockups" — not "ui_heavy false, mockups off"). List decisions and risks most important first; a gate question shows the first three of each.

---

## 5. Initialization & Resume

### Initialization Steps

1. **Hand the run to the engine**: a workflow's command passes the description, the resume target and the flags to the workflow engine, which probes the runtime, freezes the graph and runs the first node (`workflow-engine/SKILL.md`). `--from=PHASE` and `--reset-attempts` are declined by name: the graph has no mid-graph entry and no attempt counter.
2. **Capture the clock**: run `date -u +"%Y-%m-%dT%H:%M:%SZ"` via Bash NOW — you do NOT know the time from context. Use the result for every timestamp written in this turn (`created`, `updated`, `generated`, `phases[].started`). This is a MANDATORY step, not optional: writing `created: 2026-06-12` or `T00:00:00Z` without having run `date` is the documented failure mode (§ 4 Timestamp Rule).
3. **Read project config**: read `.maister/config.yml` if it exists; set `orchestrator.options.html_output` from its `html_output` key (default `true` when the file or key is absent — § 4 "Project Configuration"). This single read seeds the state; all dashboard/companion gates below read `options.html_output` from state.
4. **Create task directory**: `.maister/tasks/<type>/<YYYY-MM-DD-slug>/` plus the subdirectories this workflow owns — the per-workflow trees and the type-dir names are normative in the pro register § A4; there is no structure shared by all six workflows *(skip on resume)*
5. **The state file is written by the freeze**, the engine's first `write-state`, and by nothing but that verb afterwards.
6. **Open the operator dashboard** (§ 8) — *skip this entire step when `options.html_output` is false*: the freeze copies `../assets/dashboard.html` (sibling `assets/` directory of this references/ file) to the task root when absent, and every `write-state` projects `dashboard-data.js`. **Auto-open it in the user's browser** with the platform opener — `open "[abs-task-path]/dashboard.html"` (macOS), `xdg-open` (Linux), `start ""` (Windows). Pass the **plain absolute filesystem path — NEVER construct a `file://` URL** (hand-built URLs get mangled, e.g. `file///` missing the colon; the opener resolves plain paths itself). If the command fails, just print the path hint — never block initialization. On resume, open it again (same opener — if the tab is already open the OS focuses it rather than duplicating).
7. **Relay the startup banner** the freeze printed — task, directory, dashboard and first node; compose none of your own.

The engine creates no task items: it never calls `TaskCreate` or `TaskUpdate`, and the state file and the dashboard are the run's tracker.

### Task Name Generation

1. Extract 3-5 key words from description
2. Convert to lowercase kebab-case
3. Prepend current date: `YYYY-MM-DD`

Examples: "Fix login timeout bug" → `2025-12-17-fix-login-timeout`

### Resume

Resume is the engine's (`workflow-engine/SKILL.md` § *Resume*). Its read-only `resume-check` verb refuses a directory whose state carries no `workflow:` block — one started on the 2.x plugin — and a run it accepts resumes from its frozen graph: the ready set is recomputed from the recorded node statuses. There is no phase table to search and no task item to restore.

---

## 6. Issue Resolution

**Don't just report issues — resolve them.** Use after verification phases that return structured issues.

### Fix-Then-Reverify Loop

1. Read verification results (structured issues)
2. Ask which to fix, with options generated from the issues: the fixable ones of every severity as concrete choices (fix all, fix a subset, pick, proceed as is), the rest listed with why each needs a hand, one option recommended, and never an option that does nothing. The workflow engine's `verification` node prose is the worked example
3. If fixes applied → set `skip_test_suite: false` (code changed) → re-run verification
4. Loop until: passes OR user proceeds with known issues OR max iterations (3)

### Fixability Assessment

| Likely Fixable | Likely Not Fixable |
|----------------|-------------------|
| Lint errors | Architecture decisions |
| Formatting issues | Design trade-offs |
| Missing imports | Test logic errors |
| Obvious typos | Unclear requirements |
| Simple config fixes | Performance tuning choices |

### Exit Conditions

| Condition | Action |
|-----------|--------|
| Verification passes | Proceed to next phase |
| User chooses "Proceed with known issues" | Proceed with warning logged |
| Max iterations (3) reached | Ask user how to proceed |
| Critical issues remain unresolved | **MUST NOT proceed** — require user approval first |

---

## 7. Artifact Summary Contract

Workflow artifacts accumulate deep detail for subagent context — but the human operator needs the signal, not the dump. Every markdown artifact written into the task directory MUST open with this block, before any other content (after the H1 title if one exists):

```markdown
## TL;DR
[3-5 lines max: what this artifact concludes / recommends / delivers]

## Key Decisions
- [decision] — [one-line rationale]

## Open Questions / Risks
- [question or risk the operator should know about]
```

**Rules**:
- TL;DR is hard-capped at 5 lines. It states conclusions, not process ("Auth via middleware on 3 routes; no schema changes" — not "This document analyzes..."), in the operator's words rather than state keys or internal flags.
- List Key Decisions and Open Questions / Risks most important first: a gate question shows only the first three of each.
- Omit `Key Decisions` / `Open Questions / Risks` sections entirely when empty — never write "None".
- Full detail follows below the block, unchanged. The block is a lens, not a replacement.
- Applies to every artifact-writing subagent and skill. Orchestrators MUST include the contract in every artifact-writing prompt (§ 3 context template).
- At context extraction (§ 3), the orchestrator lifts the block's content into `phase_summaries.[phase_name].decisions` / `.risks` — this is what feeds the operator dashboard (§ 8).

**Exempt**: `orchestrator-state.yml`, `dashboard-data.js`, raw mockup files, screenshots, and incremental logs (`work-log.md` — append-only, gets no retroactive TL;DR).

---

## 8. Operator Dashboard

> **Config gate**: `options.html_output` false disables this section — see § 4 Project Configuration.

Each task directory carries a self-contained HTML dashboard so the operator can monitor workflow progress at a glance and deep-dive only when needed.

**Files** (both at task root):
- `dashboard.html` — static viewer, copied verbatim from `[plugin]/skills/orchestrator-framework/assets/dashboard.html` at initialization (§ 5). NEVER generated or modified by the model — it is a maintained plugin asset. `dashboard.html` is a frozen asset: its MD5 is pinned in the pro register § A4 and asserted by the pro suite.
- `dashboard-data.js` — data projection. The state writer projects it from state on every successful `write-state`; nothing else writes it. The viewer reads it via `<script>` (`window.MAISTER_DATA = {...}`), so it works from `file://` with no server.

**There are no rewrite moments: the projection is the file's only writer.** It is a full projection of `orchestrator-state.yml` plus the summaries, never an incremental patch, and its `generated` stamp is the writer's own clock. A node that wants the dashboard current writes state. The implementation and verification phases run for hours under a skill, and the skill keeps the dashboard current from inside them the same way, never by writing the file. `implementation-plan-executor` sends the empty patch through `write-state` at entry, after every wave and at finalize; the projection derives the phase's `progress` from the plan's checkboxes and the work log's wave and revert headings. `implementation-verifier` records each cycle's `last_status` and `issues_found` in `verification_context`, and the verification panel is projected from that block. A skill run standalone, with no workflow run and so no state file, has no dashboard.

**Schema** — the file is exactly one statement, `window.MAISTER_DATA = <strict JSON>;`, with double-quoted keys and nothing else; readers additionally accept an object literal and report it as degraded (the pro register § A2):

```js
window.MAISTER_DATA = {
  generated: "[ISO 8601]",      // actual write-time date AND time from the system clock —
                                // § 4 Timestamp Rule; never date-only, never T00:00:00Z.
                                // (display only — the viewer detects updates by content comparison)
  task: {
    title: "", type: "development",  // the run's workflow: the <type> folder of its task path,
                                      // as it is — a project's own workflow is its own type
    status: "pending|in_progress|completed|failed|blocked",
    description: "", path: "",
    current_activity: null        // short present-continuous line for the running phase
                                  // (the phase's activeForm) — shown as "Now: ..." in the header
  },
  characteristics: {},            // task_characteristics / design_characteristics when present
  phases: [{
    id: "phase-1", name: "", icon_hint: "analysis|spec|plan|code|verify|docs|done",
                                  // icon_hint is OPTIONAL — absent means the viewer's default applies
    status: "pending|in_progress|completed|skipped|failed",
    started: null,                // full ISO 8601 date+time from system clock (§ 4 Timestamp Rule);
                                  // set when the phase starts — drives elapsed/duration display
    completed: null,              // full ISO 8601 date+time, set when the phase completes
    skip_reason: null,            // when skipped
    summary: null,                // from phase_summaries
    decisions: [],                // [{decision, rationale}]; a bare string is read and reported (§ A2)
    risks: [],                    // [string]; a resolved risk keeps its entry with a `resolved:` prefix (§ A2)
    artifacts: [],                // [{path, label, html}] — paths relative to task root; a bare
                                  // path string is read and reported as {path, label: null,
                                  // html: null} (§ A2)
    gate: null,                   // {question, answer} after the exit gate fires
    progress: null                // interior progress of the plan-executor phase, derived by the
                                  // projection from the plan and the work log. Shape:
                                  // {groups_done, groups_total, current_wave, skipped: [], reverted: []}
                                  // skipped/reverted hold group labels ("Group 4 — flaky DB fixture").
                                  // Additive and optional: null/absent on every phase with no
                                  // interior progress, and the viewer renders such phases exactly
                                  // as before. Keep it on the phase when it completes, with
                                  // groups_done == groups_total — a finished phase that goes blank
                                  // reads as a phase that never ran.
  }],
  verification: {                 // mirror of verification_context, when it exists
    status: null,
    issues: [],                   // [{severity, category, description, fixable, fixed}]
                                  // writers emit severity critical|warning|info; readers tolerate more
                                  // (§ A2). When an issue gets fixed, KEEP its original severity and
                                  // set fixed: true (the viewer dims it and shows ✓ fixed)
    fixes: [],                    // [{description, …}] or [string]; both are read (§ A2)
    reverify_count: 0
  }
}
```

**Cost discipline**: the data file repeats what the orchestrator already writes to state — keep summaries terse (1-2 sentences, no markdown). Do not duplicate artifact content into the data file; the dashboard links to artifacts instead.

**Verbatim rule for decisions and risks**: `decisions` and `risks` entries are copied **verbatim** from the artifact's Key Decisions / Open Questions / Risks blocks (§ 7) — never re-summarized or shortened. The contract already caps their length at the source; compressing them again strips the meaning the operator needs.

**Resolved risks**: when a previously recorded risk gets resolved in a later phase, keep the entry and prefix it with `resolved:` (e.g. `"resolved: transient warning — query lookup chosen"`). The viewer dims and strikes resolved entries, separating live risks from settled ones.

**Where a phase card's prose comes from.** The projection reads `node_summaries.<node>` first and falls back to `[domain]_context.phase_summaries.<key>` only where the key equals the node id. It chooses **field by field**: `summary`, `decisions`, `risks` and `artifacts` each come from the first of the two that carries them non-empty, and the two are never concatenated — a field filled on both shows the node summary's. A node summary written with empty lists therefore no longer hides what its phase summary recorded, but a node summary that fills a field is the only source for that field.

The viewer decides presentation (hero artifacts per workflow type — none for a type it has no hero map for — collapsed drawers, severity colors) — orchestrators only supply data.

---

## 9. HTML Companion Reports

> **Config gate**: `options.html_output` false disables this section — see § 4 Project Configuration. Not gated: product-design's `visual-prototyping` mockups are design deliverables, not report companions.

Selected high-value artifacts get a rich HTML companion written by the **same subagent** that writes the markdown, at the same time (one context read, md and HTML never drift):

| Artifact (md) | Companion (html) | Written by |
|---------------|------------------|------------|
| `implementation/spec.md` | `implementation/spec.html` | specification-creator |
| `implementation/implementation-plan.md` | `implementation/implementation-plan.html` | implementation-planner |
| `verification/implementation-verification.md` | `verification/implementation-verification.html` | implementation-verifier |
| `verification/e2e-verification-report.md` | `verification/e2e-verification-report.html` | e2e-test-verifier |
| `verification/visual-fidelity.md` | `verification/visual-fidelity.html` | e2e-test-verifier |
| `outputs/research-report.md` | `outputs/research-report.html` | research-synthesizer |
| `outputs/solution-exploration.md` | `outputs/solution-exploration.html` | solution-brainstormer |
| `outputs/high-level-design.md` | `outputs/high-level-design.html` | solution-designer |
| `outputs/decision-log.md` | `outputs/decision-log.html` | solution-designer |
| `analysis/alternatives.md` | `analysis/alternatives.html` | solution-brainstormer |
| `analysis/design-decisions.md` | `analysis/design-decisions.html` | html-companion-writer |
| `analysis/feature-spec.md` | `analysis/feature-spec.html` | html-companion-writer |
| `outputs/product-brief.md` | `outputs/product-brief.html` | html-companion-writer |

**Rules**:
- The markdown remains the source of truth for subagent context passing — subagents read md, humans read HTML. The companion adds visual structure (severity badges, matrices, embedded screenshots), never unique content.
- Companions follow the shared style guide: `html-report-style.md`, the file beside this one. Self-contained single file, no external resources, relative links/images only.
- Orchestrators pass `html_style_guide_path` (the absolute path of that style guide — it sits next to the patterns file read at initialization) to every companion-writing **agent**, and omit it when `options.html_output` is false; an agent given no path writes only the `.md`. **Skills** that write companions (`implementation-verifier`) receive no such parameter: they resolve the guide themselves and gate on `orchestrator.options.html_output` in state.
- Register companions in `phase_summaries.[phase].artifacts[].html` so the dashboard (§ 8) links HTML first with md fallback (`html: null` when companions are disabled).
- Companion generation must never block the workflow: if it fails, keep the md, log the miss, continue.

---

## 10. Finalization: Artifact Reconciliation

State records what each phase produced; only disk records what each phase actually wrote. At
finalization — the closing phase of every workflow — reconcile the two before declaring the task
complete.

**What to compare**: every `artifacts[].path` and every non-null `.html` beside it, in the
`phase_summaries` of the run's context block (`<name>_context`, § 4) and in `node_summaries`.
Resolve each against the task root and check it exists.

**What to report**: a **Missing artifacts** block in the workflow summary, one line per absent
path, naming the phase or node that declared it and the subagent or skill that owed it. When nothing is
missing, omit the block — silence here means the declaration held. A declared artifact that a node
recorded under its summary's `absent` is not missing: name it as *not produced*, with the reason
recorded there, apart from the block.

**What not to do**: reconciliation reports, it never repairs. Do not re-run a phase, regenerate a
companion or delete the stale entry from state; the entry is the evidence that the artifact was
promised. Nor does it block completion — a workflow with a missing artifact still finishes, with
the miss named.

**Why it exists**: an orchestrator can transcribe what a subagent returned, and the verdict then
reads as if the artifact existed. The transcription is the orchestrator's summary of a subagent's
words, not the subagent's own artifact, and nothing else in the run records that the substitution
took place. This comparison is what makes that visible.
