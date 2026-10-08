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

| The run's driver | A question a phase asks inside itself is |
|---|---|
| absent, or `kind: terminal` | asked in session, exactly as the phase describes it |
| `kind: cockpit` whose `features` list `question-sets` | **suspended to the operator**: every question the phase can form at its first asking point goes out as one `kind: question` request, and the phase resumes `running` with the answers recorded as `by: operator` decisions |
| any other — `dispatch`, or a cockpit without that feature | **never asked**; the phase takes the default its own prose names, and records that it did |

**One request per attempt, written before asking.** A phase under question sets asks once per attempt, so a question that only exists after an answer — a follow-up, another round, a retry — takes its default; and whatever it needs after the answer is on disk before it suspends, because the answer may reach a fresh session. The workflow engine's *In-node questions* holds the mechanism. Asking in session under a driver is the defect this rule prevents: nobody is in the session to answer.

**Every such question names its default, in the phase that asks it** — taken when it cannot be asked. What each family takes:

| The question | What a non-terminal run takes |
|---|---|
| A clarification | nothing is asked; the analysis or the delegate's own answers stand, and the phase writes its artifact and sets its flag as a run with nothing to ask already does |
| An opt-in | the recommended option |
| A decision between alternatives | the recommended one; when nothing is recommended, the decision stays open and is named in the executive summary printed before the next gate |
| A loop offering another pass | the accept-as-is exit — the following gate is the operator's route back |
| An exhausted recovery budget | the phase fails rather than choosing retry or skip on the operator's behalf |

**What is recorded.** One entry per defaulted question on that phase's summary `decisions` list — `{decision: <default taken>, by: default, question_id: <question-id>}` — where the id is the one the phase prose names and the decision is the default this run actually used, in the user's words. A state written before this shape may carry the older `defaulted: <id> -> <taken>` string; it still reads as a default. A phase that asked nothing because it had nothing to ask records nothing. The entry is an ordinary decision item and reaches the dashboard the way every other decision does (§ 4, § 8).

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
2. **Present**: every decision is its own **single-select question with its own option set** — NEVER flatten several decisions' options into a single question's option list (the user could pick two conflicting options from one decision, or none from another). Critical decisions: one `AskUserQuestion` call each, with full context in the question itself — what was found and why it needs the user — and each option's description saying what it changes, the recommended one first with its reason; a message above the call is never relied on. Important decisions: may be grouped as up to 4 **separate questions within one `AskUserQuestion` call**. A question may allow selecting multiple options ONLY when those options are genuinely non-exclusive (e.g. "which verifications to run?") — never as a way to bundle decisions.
3. **Record each answer** on the phase's summary `decisions` as `{decision, by: operator, question_id, question, answer, recommended, as_recommended}` (the workflow engine's § *In-node questions* fills who answered, when and how). More details is never recorded.
4. **SELF-CHECK**: "Did I present ALL decisions from `decisions_needed`? If not, STOP."

**Scope note**: this grouping guidance applies to `decisions_needed` triage (pre-analyzed, independent decisions). Interactive convergence flows (e.g. research Phase 4) override it with strictly ONE question per call — later areas depend on earlier answers.

---

## 4. State Schema

All orchestrators use `orchestrator-state.yml` at `.maister/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml`. The `[type]` dir matches the workflow name except for migration, whose type dir is `migrations/` (plural). A workflow the project defines and starts by name (`/maister:run <name>`) follows the same rule: its name is its type dir.

### Timestamp Rule (applies to ALL timestamps everywhere)

Every timestamp — `created`, `updated`, `phases[].started/completed`, `generated` in `dashboard-data.js`, dates in work-log entries — MUST be a **full ISO 8601 date AND time in UTC** (`2026-06-11T14:32:07Z`).

- **NEVER write a date-only value** (`2026-06-11`) and **NEVER zero-fill the time** (`T00:00:00Z`) — you do not know the clock time from context, so GET it from the system: `date -u +"%Y-%m-%dT%H:%M:%SZ"` (one Bash call can serve every timestamp written in the same turn). Work-log headings are the exception: each entry reads the clock right before it is written (`implementation-plan-executor/SKILL.md` § Work-Log Updates).
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

The three keys above are the only `options` keys every orchestrator shares. `options` is an **open map**: per-workflow keys are listed in each workflow definition's node prose (`workflow-engine/workflows/<name>.md`). The keys the state writer seeds and merges beside them are the engine's (`workflow-engine/SKILL.md` § *Writing state*).

### Extension Pattern

Workflows add domain-specific fields in their context block, at the **top level** of the state file — never nested under `orchestrator:`. The block's name is derived from the workflow's name: `<name>_context`, with the name's dashes written as underscores, and the state writer applies the rule (`workflow-engine/SKILL.md` § *Writing state*). The root carries exactly one context block, or none (a chain run, or a workflow whose nodes record only `node_summaries`, has none). The built-ins' blocks are below; development and product design are the two whose block does not carry their own name:

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
  issues_found: []           # [{id, severity, source, description, fixable, risky, fixed}]
  fixes_applied: []
  decisions_made: []
  reverify_count: 0          # re-checks run; two run without asking (§ 6)
  reviews: {chosen: [], done: []}  # the reviews dispatched this cycle and those returned, by short name
```

Record every issue in `issues_found` as an object, never as a bare string: `severity` is `critical`, `warning` or `info` as the report graded it, `id` is the report's own number for the finding — kept across re-checks, a new finding taking the next unused number — `risky` is the verifier's grading of whether its fix would reach beyond the item, and `fixed: true` marks one fixed since (keep its original severity). The dashboard shows each issue under its `severity`. A string carries no severity field, so its severity has to be guessed from the text.

### Shared: phase_summaries entry shape

Every `phase_summaries.[phase_name]` entry uses this base shape (orchestrators may add phase-specific fields):

```yaml
phase_summaries:
  [phase_name]:
    headline: null       # one sentence (≤ 220 chars) for the stretch a gate closes; on the node the gate needs
    summary: null        # 1-2 sentence prose summary; the top findings go here, never in risks
    decisions: []        # [{decision, by, rationale?}] — by: run | audit | default | operator
    fixes_applied: []    # [{finding, change}] — what the phase fixed without asking
    risks: []            # [{risk, tag, change?}] — tag: open | tradeoff | followup | stop | resolved
    artifacts: []        # [{path, label, html}] — paths relative to task root; html is the
                         #   optional companion report (§ 9), null when absent
```

`decisions`, `risks`, and `artifacts` feed the operator dashboard (§ 8) and downstream context passing. Populate them at context extraction time (§ 3) — empty lists are fine when a phase produced none.

**Who settled a decision** is its `by`: `run` for what the phase itself decided, `audit` for what a spec audit or the verification reviews settled, `default` for a question a driven run did not ask (§ 2.2), and `operator` for a person's answer — recorded with the question it answered, never credited to anyone else; the writer stamps who answered (`answered_by`, `via`). A phase's `decisions` hold only what that phase settled: an earlier phase's decision or answer, whoever gave it and however reworded, is never restated as its own. Its `risks` likewise hold only what it raised: a risk an earlier phase recorded stays there, never restated. **A fix is not a decision.** What a phase changed without asking — a verification fix, a spec-audit fix, a trim to a guide — goes in `fixes_applied`, each as `{finding, change}`: what was wrong and what changed, a few words each. It never also goes in `decisions`: the run settled nothing by it, and the gate lists it under "Fixed by the run", apart from what was decided. **What a risk is** is its `tag`: `open` for an uncertainty the user can still change, with `change` naming what would change (a revise at the gate offers it); `tradeoff` for a consequence of a choice already made; `followup` for work outside this run; `stop` when the user should stop here (it makes Stop the recommended answer at the next gate); `resolved` for one a later phase settled. A finding is neither: it belongs in `summary` and `headline`. Plain strings written by older runs still read — a decision as `by: run`, a risk as `open`.

`summary`, `decisions` and `risks` are read by the operator, at a gate and on the dashboard, so write them in the operator's words: what was found and what it means, never a state key, a value name, an internal flag or a slug used as a label ("no UI work, so no mockups" — not "ui_heavy false, mockups off"). List decisions and risks most important first, and lead each with a short sentence that stands on its own: a gate question shows the first three of each by that sentence alone, and the dashboard shows the whole item.

---

## 5. Initialization & Resume

### Initialization Steps

1. **Hand the run to the engine**: a workflow's command passes the description, the resume target and the flags to the workflow engine, which probes the runtime, freezes the graph and runs the first node (`workflow-engine/SKILL.md`). `--from=PHASE` and `--reset-attempts` are declined by name: the graph has no mid-graph entry and no attempt counter.
2. **Capture the clock**: run `date -u +"%Y-%m-%dT%H:%M:%SZ"` via Bash NOW — you do NOT know the time from context. Use the result for every timestamp written in this turn (`created`, `updated`, `generated`, `phases[].started`). This is a MANDATORY step, not optional: writing `created: 2026-06-12` or `T00:00:00Z` without having run `date` is the documented failure mode (§ 4 Timestamp Rule).
3. **Read project config**: read `.maister/config.yml` if it exists; set `orchestrator.options.html_output` from its `html_output` key (default `true` when the file or key is absent — § 4 "Project Configuration"). This single read seeds the state; all dashboard/companion gates below read `options.html_output` from state.
4. **Create task directory**: `.maister/tasks/<type>/<YYYY-MM-DD-slug>/` *(skip on resume)*. The folders inside it come from the freeze, read off the artifacts the workflow declares (`workflow-engine/SKILL.md` Step 4); there is no structure shared by every workflow
5. **The state file is written by the freeze**, the engine's first `write-state`, and by nothing but that verb afterwards.
6. **Open the operator dashboard** (§ 8) — *skip this entire step when `options.html_output` is false*: the freeze copies `../assets/dashboard.html` (sibling `assets/` directory of this references/ file) to the task root when absent, and every `write-state` projects `dashboard-data.js`. **Auto-open it in the user's browser** with the platform opener — `open "[abs-task-path]/dashboard.html"` (macOS), `xdg-open` (Linux), `start ""` (Windows). Pass the **plain absolute filesystem path — NEVER construct a `file://` URL** (hand-built URLs get mangled, e.g. `file///` missing the colon; the opener resolves plain paths itself). If the command fails, just print the path hint — never block initialization. On resume, open it again (same opener — if the tab is already open the OS focuses it rather than duplicating).
7. **Show the start banner** the freeze printed as the run's first message — the workflow, the task, the checkpoint count, the directory, the dashboard and the first phase; compose none of your own.

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

**A budget bounds a loop nobody is watching; a choice the user makes needs none.** So the
obvious fixes happen without asking, inside a small budget, and the user is asked only what
needs them. The workflow engine's `verification` node prose (development and performance) and
`issue-resolution` (migration) carry it, each naming its report path and anything it adds.

1. **Apply without asking** every unfixed issue the verifier marked `fixable` and not `risky`.
   A fix is risky when it reaches beyond its item into behaviour the change did not set out to
   alter — a departure from the specification, a change to what callers see, anything beyond
   the code such as staging files in git. Record each fix in `verification_context.fixes_applied`
   and in the node summary's `fixes_applied` as `{finding, change}` — never as a decision — and
   clear `skip_test_suite` when one changed code.
2. **Re-check, as cheaply as the fixes allow — without asking.** After a fix that changed
   behaviour, re-verify in full: the test suite, then the reviews. After fixes that changed no
   behaviour — comments, docs, regenerated HTML, the run's own bookkeeping — re-check with the
   test suite only (the verifier's `recheck: tests-only`). When only info items were left, the
   non-risky ones are fixed in the same pass and no new cycle starts for them. Raise
   `verification_context.reverify_count` by one for each re-check that ran.
3. **Budget: two automatic re-checks**, the same in a terminal run and under a driver.
4. **Ask only when one of these holds**, and otherwise go on to the gate:
   - an issue needs the user's decision (`fixable: false`);
   - a fix is risky;
   - the budget is spent with fixable issues still open;
   - there is **no progress**: the same issues come back, or new ones keep appearing.

   **An item whose recommendation is to leave it is not a decision.** A pre-existing info item
   that predates the change, recommended "leave", is not asked: record it in the node summary's
   `risks` as `{risk: <item and the fix, if wanted>, tag: followup}`, so the end of the run lists
   it. When such items arrive beside real decisions, the page carries at most one "Leave all N
   for later (Recommended)" choice for them, never one tab each.
5. **One decision per issue, in pages.**
   A page is one picker call of up to four questions, one tab per issue,
   most severe first, each tab offering generated ways to tackle it — never a
   bare Other — with the recommended one first and its reason in its description. Issues with
   one root cause (the same missing guard in three places) are one decision. Each tab's own
   question carries its issue's file and line and what is wrong, and each option's description
   what it would change — never "the issue above" — and the page's first question names the
   report's path from the project root, never "the verification report" alone. A tab whose
   issue needs more than its question holds offers More details (workflow engine § *In-node
   questions*). Further pages follow in the same turn.
6. **Triage first when more than about eight issues need a decision**: one question showing the
   counts by severity and offering "Go through them, most severe first", "Only the critical ones
   now — the rest become open risks for the checkpoint", and "Continue as is".
7. **The question at the stopping point** — budget spent, or no progress — names what is
   left in the question (counts by severity, the worst item in a few words) and offers "One
   more round", "Continue as is" and "Stop", one of them recommended with its reason in its
   description: "Continue as is" when only warnings remain, "One more round" when the last
   round made progress, "Stop" when a critical issue is left.
8. **What the gate is handed.** Issues still needing a decision become `open` risks, with the
   fix as their `change`; items left for later stay `followup` risks; a spent budget with
   critical issues still open is a `stop` risk, which makes Stop the gate's recommended answer.
9. **Under a driver** with question sets, the issues needing a decision go out as one
   question set, one question per issue, when that is the first thing the phase asks in its
   attempt; otherwise, and under any other driver, nothing is asked: the decisions stay open as `open` risks,
   and the stopping point takes "Continue as is".

Issue numbers stay stable across cycles: an issue keeps the `id` it was first given, and a new
one takes the next unused number. Never announce a fix before it is made; once made, name
each by a few words beside its number ("2, the missing tag trim"), never by numbers alone. Say
each re-check by its count ("re-check 1 of 2"). The gate after the loop stays the user's checkpoint:
its brief lists every fix made without asking, with the report's path, and an unresolved
critical issue is never proceeded past without an explicit answer saying so.

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
| Nothing fixable or undecided is left | Proceed to the gate |
| User chooses "Continue as is" | Proceed; open issues become `open` risks for the gate |
| Two automatic re-checks spent, or no progress | Ask: one more round, continue as is, or stop |
| Critical issues remain unresolved | **MUST NOT proceed** — require user approval first |

### The Specification Audit's Fix Pass

The same idea, scaled down, before any code exists. The workflow engine's `spec-audit` node
prose (development and performance) carries it. The spec auditor grades each finding
*fixable* — one clear change, no scope or behaviour change beyond what the spec, the
requirements or an earlier answer already implies — or *needs decision*, and names the change.

1. **Apply without asking** every fixable finding, in **one fix pass**: the specification
   creator in its amend mode applies exactly those changes to `implementation/spec.md` (and to
   `analysis/requirements.md` where a fix reaches it). The audit report stays the auditor's —
   the run never edits or annotates it.
2. **Re-audit once, and only when a fix changed a requirement.** A fix that adds a planned test
   case, a limit or a sentence stating an existing requirement more precisely needs no
   re-audit. The re-audit rewrites the report; its new fixable findings are not fixed again.
3. **No progress stops it**: a fixed finding coming back, or a fix the creator could not apply,
   stays open.
4. **Nothing is asked in the node**, in a terminal run or under a driver: the gate after it is
   the operator's moment. Record each fix in the node summary's `fixes_applied` as
   `{finding, change}` (and the re-audits in `reaudit_count`), never as a decision, so the gate
   lists it as fixed by the run.
5. **What the gate is handed**: only the findings still open — needing a decision, not applied,
   or found by the re-audit — as `open` risks with their `change`, the critical ones first; a
   finding about something outside the change as a `followup`. The gate's revise suggestions
   come from those alone, never from a fix already made.

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
- These lines reach the user at a gate, so they follow the workflow engine's *Speaking to the user*: no code (B1, T5, M2) without its meaning, "the user" or "you" rather than "the operator", and each decision credited to whoever made it — the user, an audit, the analysis or a default — never to the user for a choice they did not make. A reviewer's own grading notes (why it rated a finding medium) belong in the body, not in Key Decisions.
- Write a risk the user could act on as `<risk> → <what would change>`: it is lifted as an `open` risk whose `change` is the part after the arrow, and a revise at the gate offers that change. A trade-off already accepted or a follow-up outside this run says so in its text, so it is lifted with that tag instead.
- Omit `Key Decisions` / `Open Questions / Risks` sections entirely when empty — never write "None".
- Full detail follows below the block, unchanged. The block is a lens, not a replacement.
- Applies to every artifact-writing subagent and skill. Orchestrators MUST include the contract in every artifact-writing prompt (§ 3 context template).
- At context extraction (§ 3), the orchestrator lifts the block's content into `phase_summaries.[phase_name].decisions` / `.risks` in the object shapes of § 4 — this is what feeds the operator dashboard (§ 8).

**Exempt**: `orchestrator-state.yml`, `dashboard-data.js`, raw mockup files, screenshots, and incremental logs (`work-log.md` — append-only, gets no retroactive TL;DR).

---

## 8. Operator Dashboard

> **Config gate**: `options.html_output` false disables this section — see § 4 Project Configuration.

Each task directory carries a self-contained HTML dashboard so the operator can monitor workflow progress at a glance and deep-dive only when needed.

**Files** (both at task root):
- `dashboard.html` — static viewer, copied verbatim from `[plugin]/skills/orchestrator-framework/assets/dashboard.html` at initialization (§ 5). NEVER generated or modified by the model — it is a maintained plugin asset. `dashboard.html` is a frozen asset.
- `dashboard-data.js` — data projection. The state writer projects it from state on every successful `write-state`; nothing else writes it. The viewer reads it via `<script>` (`window.MAISTER_DATA = {...}`), so it works from `file://` with no server.

**There are no rewrite moments: the projection is the file's only writer.** It is a full projection of `orchestrator-state.yml` plus the summaries, never an incremental patch, and its `generated` stamp is the writer's own clock. A node that wants the dashboard current writes state. The implementation and verification phases run under a skill, outside the engine's turns, and the skill keeps the dashboard current from inside them the same way, never by writing the file. `implementation-plan-executor` sends the empty patch through `write-state` at entry, after every wave and at finalize; the projection derives the phase's `progress` from the plan's checkboxes and the work log's wave and revert headings. `implementation-verifier` records each cycle's `last_status` and `issues_found` in `verification_context`, and the verification panel is projected from that block. A skill run standalone, with no workflow run and so no state file, has no dashboard.

**Schema** — the file is exactly one statement, `window.MAISTER_DATA = <strict JSON>;`, with double-quoted keys and nothing else; readers additionally accept an object literal and report it as degraded:

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
    decisions: [],                // [{decision, rationale}]; a bare string is read and reported
    risks: [],                    // [string]; a resolved risk keeps its entry with a `resolved:` prefix
    artifacts: [],                // [{path, label, html}] — paths relative to task root; a bare
                                  // path string is read and reported as {path, label: null,
                                  // html: null}
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
                                  // When an issue gets fixed, KEEP its original severity and
                                  // set fixed: true (the viewer dims it and shows ✓ fixed)
    fixes: [],                    // [{description, …}] or [string]; both are read
    reverify_count: 0
  }
}
```

**Cost discipline**: the data file repeats what the orchestrator already writes to state — keep summaries terse (1-2 sentences, no markdown). Do not duplicate artifact content into the data file; the dashboard links to artifacts instead.

**Verbatim rule for decisions and risks**: `decisions` and `risks` entries are copied **verbatim** from the artifact's Key Decisions / Open Questions / Risks blocks (§ 7) — never re-summarized or shortened. The contract already caps their length at the source; compressing them again strips the meaning the operator needs.

**Resolved risks**: when a previously recorded risk gets resolved in a later phase, keep the entry and set its `tag` to `resolved` (e.g. `{risk: "transient warning — query lookup chosen", tag: resolved}`; an older string entry is prefixed `resolved:` instead). The viewer dims and strikes resolved entries, separating live risks from settled ones.

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
