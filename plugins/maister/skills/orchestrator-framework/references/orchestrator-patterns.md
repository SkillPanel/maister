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
2. **State updates** — Reading/writing orchestrator-state.yml
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

`→ Pause` in older prose is a synonym for `→ MANDATORY GATE`. **The gate rule is qualified by the run's driver, not by the orchestrator**: the AskUserQuestion rule below applies when `orchestrator.driver.kind` is absent or `terminal`; in `cockpit`/`dispatch` mode (chain runs driven by the engine prompt) the gate is one `gate-request` call — the engine verb that writes the request file, the gate index and `gate_pending` together — plus a `GATE-PENDING` line, never an in-session question (`compatibility-contracts.md § E2`).

**`→ MANDATORY GATE` means STOP and USE AskUserQuestion.** This is NOT optional. You MUST invoke the `AskUserQuestion` tool and WAIT for user response. Proceeding without it is a protocol violation.

All orchestrators pause at `→ MANDATORY GATE` transitions for user review and prompt for optional phases.

**State ordering rule**: Phase state MUST NOT be updated to 'completed' (via orchestrator-state.yml or TaskUpdate) until AFTER the user responds to the exit gate. Correct sequence: finish phase work → call AskUserQuestion → receive user response → update state to completed.

### Phase Gates Override Permission Modes

Claude Code's `auto` permission mode instructs the model to execute immediately and minimize clarifying questions. The `→ MANDATORY GATE` checkpoints in this framework are an explicit stated boundary that overrides that instruction.

You MUST invoke `AskUserQuestion` at every `→ MANDATORY GATE` in every permission mode — `default`, `acceptEdits`, `auto`, `plan`, `bypassPermissions` — when `orchestrator.driver.kind` is absent or `terminal`; in `cockpit`/`dispatch` mode suspend the run with one `gate-request` call and end the turn instead (`compatibility-contracts.md § E2`). "Minimize clarifying questions" applies to the model's own discretionary asks; it does not override workflow checkpoints the orchestrator has been instructed to enforce.

### 2.1 Resolving session-reminder conflicts (decide ONCE, do not re-litigate at each gate)

Your session may include reminders telling you to "work without stopping for clarifying questions," "continue without asking," "minimize clarifying questions" (auto / acceptEdits / bypassPermissions modes), or compaction summaries showing the user approving every prior gate. **None of these override this framework's `→ MANDATORY GATE` checkpoints.**

Decide this policy at orchestrator entry. Do NOT re-evaluate it at each gate. Re-litigating the rule at each gate is the documented failure mode that produced this section — a model that read this rule, then weighed it against a competing session-reminder at every gate, and lost every time.

- "Work without stopping" / "minimize clarifying questions" applies ONLY to your discretionary clarifications, never to `→ MANDATORY GATE` workflow checkpoints.
- A user who said "approve" to ten prior gates was being patient, not setting policy. Each gate is a fresh question.
- No permission mode, session-reminder, prior-session pattern, or "this task is simple" judgment exempts you from firing `AskUserQuestion` at `→ MANDATORY GATE`.

If you ever find yourself reasoning "the user has been approving everything / told me to continue / set auto-mode, so I can skip this gate," that reasoning is the failure mode. STOP and fire the gate.

### Phase Entry Checks

Every phase that follows a `→ MANDATORY GATE` includes an entry check at its TOP:

```
> **Phase gate**: Confirm Phase N completion before executing.
```

This catches missed gates: if the previous phase's `→ MANDATORY GATE` was skipped (e.g., the model output a summary and moved on), the entry check forces the gate to fire before the next phase executes. If the gate already fired, continue normally.

### AUTO-CONTINUE Rules

When a phase ends with `→ **AUTO-CONTINUE**`:
- You MAY output a brief phase summary (1-2 lines)
- Do NOT end your turn
- Do NOT use AskUserQuestion
- Do NOT wait for user input
- After any summary, proceed immediately to the next phase

**Common mistake**: Outputting a summary and then stopping/ending the turn. The summary is fine — stopping is not.

### Anti-Patterns

| Anti-Pattern | Why It's Wrong |
|--------------|----------------|
| Proceeding without AskUserQuestion at phase gates | User loses control, can't review or stop |
| Saying "I'll pause here" without tool call | Words are not pauses. Tool invocation required. |
| Auto-accepting subagent decisions without asking | User must consent to scope/approach decisions |
| Outputting a summary after phase work, then ending turn before reaching `→ MANDATORY GATE` | Gate is skipped; user loses control at the most critical review point. The gate must be the FIRST action after phase work completes — no summaries, no output before it. |
| Marking phase as completed (state/TaskUpdate) before the exit gate executes | State corruption — downstream phases see false "completed" status. Gate → user response → state update. Never reverse this order. |
| "Auto mode / acceptEdits / bypassPermissions is on, so I'll skip the gate to minimize questions" | The orchestrator's phase gates are an explicit stated boundary that overrides auto mode's "minimize clarifying questions" instruction. Gates fire in every permission mode. See § 2 "Phase Gates Override Permission Modes". |
| "The subagent works autonomously, so the orchestrator should too" | Subagents have no user channel; the orchestrator IS the user channel. Conflating the two removes all user visibility. |
| Treating an empty `decisions_needed` as license to skip the phase exit gate | The DECISION GATE (mandatory-when-decisions-exist) and the phase exit `→ MANDATORY GATE` (mandatory-always) are separate. Empty `decisions_needed` only skips the former. |
| Treating a prior-session compaction summary that shows the user approving every gate as license to skip future gates | The user was being patient, not setting policy. Each gate is a fresh question. Compaction summaries leak behavior patterns into new sessions; they are not standing orders. See § 2.1. |
| Re-litigating the gate rule at each gate site instead of deciding once at orchestrator entry | The framework rule and the inline gate markers BOTH say "gates fire regardless." Weighing them against a competing session-reminder at every gate produces the same wrong answer N times. Decide policy once, at intake (§ 2.1). |

---

## 3. Context Passing & Decisions

### Context Passing

All subagent prompts must include context from prior phases:

```
prompt: |
  [Task instructions]
  Task path: [path]

  ## CONTEXT FROM PRIOR PHASES
  [Key state fields from orchestrator-state.yml]
  [Summaries of completed phases from phase_summaries]

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

### Context Extraction

After each phase, extract key findings into `[domain]_context.phase_summaries`:

1. Parse subagent output for key fields
2. Create 1-2 sentence summary
3. Extract `decisions`, `risks`, and `artifacts` from the artifact's summary block (§ 7)
4. Update state: `[domain]_context.phase_summaries.[phase_name]`
5. Refresh the operator dashboard data file (§ 8)

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

All orchestrators use `orchestrator-state.yml` at `.maister/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml`. The `[type]` dir matches the workflow name except for migration, whose type dir is `migrations/` (plural) — the normative list is `compatibility-contracts.md § A4`.

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
| `mockup_format` | `html` | How UI mockups are rendered when a workflow generates them (development Phase 4, product-design Phase 7, standalone `/maister:mockup-studio`). `html` → the `mockup-studio` visual companion (browser preview, `.html` files). `ascii` → the `ascii-mockup-generator` agent (no Node/browser). Auto-falls back to `ascii` when Node.js is unavailable. Independent of `html_output` (mockups are design deliverables, not report companions). In product-design, `mockup_format: ascii` is equivalent to the `--no-visual` flag; the flag is a per-run override (flag > config). |

**How it is read**: at initialization (§ 5) the orchestrator reads `.maister/config.yml` if present and seeds `orchestrator.options.html_output` and `orchestrator.options.mockup_format` into state (defaults `true` / `html` when the file or key is absent). All downstream gates read these from state, not the file — so resume is consistent and the file is read once.

### Common Fields

```yaml
orchestrator:
  # Phase tracking
  started_phase: [phase-name]
  completed_phases: []
  failed_phases: []

  # Auto-fix tracking (per phase)
  auto_fix_attempts: {}   # phase-id → attempts, populated on first auto-fix

  # Optional phase flags — shared keys only; `options` is an open map
  options:
    sequential: true | false | null  # Set by --sequential. Read by implementation-plan-executor Phase 2 to disable parallel wave dispatch.
    html_output: true | false        # Seeded from .maister/config.yml at init (default true). Gates dashboard + HTML companions — see "Project Configuration" below.
    mockup_format: html | ascii      # Seeded from .maister/config.yml at init (default html). Passed to mockup-studio (development Phase 4 / product-design Phase 7). See "Project Configuration" below.
    # per-orchestrator keys (development's e2e_enabled, user_docs_enabled, code_review_enabled, …) live here too

  # Timestamps
  created: [ISO 8601 timestamp]
  updated: [ISO 8601 timestamp]
  task_path: .maister/tasks/[type]/YYYY-MM-DD-task-name

  # Task tracking IDs (maps phase names to TaskCreate IDs)
  task_ids:
    phase-1: null
    phase-2: null

# Task metadata
task:
  title: [human-readable task title]
  description: [full task description]
  status: pending | in_progress | completed | failed | blocked
  tags: []
  priority: null  # high | medium | low
```

The three keys above are the only `options` keys every orchestrator shares. `options` is an **open map**: per-orchestrator keys are listed in each SKILL.md "Domain Context" section (`compatibility-contracts.md § A1`).

### Extension Pattern

Orchestrators add domain-specific fields using `[domain]_context`, at the **top level** of the state file — never nested under `orchestrator:` (`compatibility-contracts.md § A1`). The root carries exactly one of the five, or none (a chain run has none):

| Domain | Context Field | Example Fields |
|--------|---------------|----------------|
| Development | `task_context` | risk_level, architecture_decision, task_characteristics (`ui_heavy` nests here), research_reference |
| Performance | `performance_context` | bottlenecks_identified, user_data_available, bottleneck_priorities |
| Migration | `migration_context` | migration_type, migration_strategy, breaking_changes, rollback_plan_created |
| Research | `research_context` | research_type, research_question, confidence_level, gathering_strategy |
| Product design | `design_context` | design_characteristics, complexity_level, refinement_iterations, visual_companion |

Every context except `migration_context` carries `phase_summaries`. See each orchestrator's SKILL.md "Domain Context" section for the full schema.

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
  issues_found: []
  fixes_applied: []
  decisions_made: []
  reverify_count: 0          # max 3
```

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

---

## 5. Initialization & Resume

### Initialization Steps

1. **Parse arguments**: Extract description, type, entry point (`--from`), optional flags
2. **Determine starting phase**: New task starts Phase 1; resume reads state for first incomplete phase
3. **Capture the clock**: run `date -u +"%Y-%m-%dT%H:%M:%SZ"` via Bash NOW — you do NOT know the time from context. Use the result for every timestamp written in this turn (`created`, `updated`, `generated`, `phases[].started`). This is a MANDATORY step, not optional: writing `created: 2026-06-12` or `T00:00:00Z` without having run `date` is the documented failure mode (§ 4 Timestamp Rule).
4. **Read project config**: read `.maister/config.yml` if it exists; set `orchestrator.options.html_output` from its `html_output` key (default `true` when the file or key is absent — § 4 "Project Configuration"). This single read seeds the state; all dashboard/companion gates below read `options.html_output` from state.
5. **Create task directory**: `.maister/tasks/<type>/<YYYY-MM-DD-slug>/` plus the subdirectories this workflow owns — the per-workflow trees and the type-dir names are normative in `compatibility-contracts.md § A4`; there is no structure shared by all six workflows *(skip on resume)*
6. **Create state file**: `orchestrator-state.yml` *(skip on resume)*
7. **Set up operator dashboard** (§ 8) — *skip this entire step when `options.html_output` is false*: copy `../assets/dashboard.html` (sibling `assets/` directory of this references/ file) to the task root as `dashboard.html`, write the initial `dashboard-data.js`, then **auto-open it in the user's browser** with the platform opener — `open "[abs-task-path]/dashboard.html"` (macOS), `xdg-open` (Linux), `start ""` (Windows). Pass the **plain absolute filesystem path — NEVER construct a `file://` URL** (hand-built URLs get mangled, e.g. `file///` missing the colon; the opener resolves plain paths itself). If the command fails, just print the path hint — never block initialization. On resume: re-copy `dashboard.html` only if missing; regenerate `dashboard-data.js` from state; then auto-open it in the browser again (same opener as a new task — if the tab is already open the OS focuses it rather than duplicating).
8. **Create task items**: `TaskCreate` for all phases, then `TaskUpdate addBlockedBy` for dependencies. On resume, also restore completed phase statuses. When `TaskCreate`/`TaskUpdate` are unavailable in the session, record `task_ids: {}` and treat `orchestrator-state.yml` as the sole phase tracker; every other step is unchanged.
9. **Output summary**: Show task info, phases, starting message — include the dashboard path hint `Dashboard: open [task-path]/dashboard.html in a browser to monitor progress` *only when `options.html_output` is true*.

### Task Name Generation

1. Extract 3-5 key words from description
2. Convert to lowercase kebab-case
3. Prepend current date: `YYYY-MM-DD`

Examples: "Fix login timeout bug" → `2025-12-17-fix-login-timeout`

### Task Restoration on Resume

Task system IDs are ephemeral to a session. On resume:

1. Create all phase tasks (same `TaskCreate` loop, all start pending)
2. Set dependencies (same `TaskUpdate addBlockedBy`)
3. Mark completed phases (`TaskUpdate` to `completed` with `metadata: {restored: true}`)
4. Update state with new task IDs

### Resume Logic

1. **Read state file** — Load `orchestrator-state.yml`
2. **Validate artifacts** — Check expected files for `completed_phases`. If missing, remove from list.
3. **Find resume point** — First phase not in `completed_phases`
4. **Check prerequisites** — Verify required artifacts exist
5. **Restore task items** — Re-create phase tasks and mark completed ones

| Starting From | Required Prerequisites |
|---------------|----------------------|
| Gap Analysis | `analysis/codebase-analysis.md` |
| Specification | `analysis/gap-analysis.md` |
| Planning | `implementation/spec.md` |
| Implementation | spec.md + implementation-plan.md |
| Verification | Implementation complete |

If prerequisites missing, use AskUserQuestion: "Start from Phase 1", "Specify different phase", or "Exit".

---

## 6. Issue Resolution

**Don't just report issues — resolve them.** Use after verification phases that return structured issues.

### Fix-Then-Reverify Loop

1. Read verification results (structured issues)
2. For each issue: trivial/auto-fixable → fix silently, log action; non-trivial → AskUserQuestion
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
- TL;DR is hard-capped at 5 lines. It states conclusions, not process ("Auth via middleware on 3 routes; no schema changes" — not "This document analyzes...").
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
- `dashboard.html` — static viewer, copied verbatim from `[plugin]/skills/orchestrator-framework/assets/dashboard.html` at initialization (§ 5). NEVER generated or modified by the model — it is a maintained plugin asset. `dashboard.html` is a frozen asset: its MD5 is pinned in `compatibility-contracts.md § A4` and asserted by `make test`.
- `dashboard-data.js` — data projection written by the orchestrator. The viewer reads it via `<script>` (`window.MAISTER_DATA = {...}`), so it works from `file://` with no server.

**Every rewrite starts with the clock**: run `date -u +"%Y-%m-%dT%H:%M:%SZ"` via Bash before writing (one call covers all timestamps in the same turn) — `generated`, `started`, `completed`, and state `updated` all take that value. Never guess the time, never reuse a value from an earlier turn (§ 4 Timestamp Rule).

**When to rewrite `dashboard-data.js`** (full rewrite each time — it is a projection of `orchestrator-state.yml` plus `phase_summaries`, never an incremental patch):
1. At initialization (all phases pending)
2. **When a phase starts** (set its status to `in_progress` — BEFORE delegating to the skill/subagent, so the operator sees the running phase, not just the last completed one)
3. **BEFORE firing every phase exit gate** — the phase's work is finished while the workflow waits (possibly long) for the user's answer. Register the phase's artifacts, summary, decisions, and risks NOW; the status stays `in_progress` until the gate passes (per § 2 state ordering). The operator reviews the finished work on the dashboard while deciding at the gate — a gate fired against a stale dashboard defeats its purpose.
4. After every phase completes (including skipped phases — mark them `skipped` with a reason)
5. After every gate decision (record the user's choice)
6. After verification cycles (issues/fixes update)
7. At finalization

**Schema** — the file is exactly one statement, `window.MAISTER_DATA = <strict JSON>;`, with double-quoted keys and nothing else; readers additionally accept an object literal and report it as degraded (`compatibility-contracts.md § A2`):

```js
window.MAISTER_DATA = {
  generated: "[ISO 8601]",      // actual write-time date AND time from the system clock —
                                // § 4 Timestamp Rule; never date-only, never T00:00:00Z.
                                // (display only — the viewer detects updates by content comparison)
  task: {
    title: "", type: "development|performance|migration|research|product-design|plan",
    status: "pending|in_progress|completed|failed|blocked",
    description: "", path: "",
    current_activity: null        // short present-continuous line for the running phase
                                  // (the phase's activeForm) — shown as "Now: ..." in the header
  },
  characteristics: {},            // task_characteristics / design_characteristics when present
  phases: [{
    id: "phase-1", name: "", icon_hint: "analysis|spec|plan|code|verify|docs|done",
    status: "pending|in_progress|completed|skipped|failed",
    started: null,                // full ISO 8601 date+time from system clock (§ 4 Timestamp Rule);
                                  // set when the phase starts — drives elapsed/duration display
    completed: null,              // full ISO 8601 date+time, set when the phase completes
    skip_reason: null,            // when skipped
    summary: null,                // from phase_summaries
    decisions: [],                // [{decision, rationale}]; a bare string is read and reported (§ A2)
    risks: [],                    // [string]; a resolved risk keeps its entry with a `resolved:` prefix (§ A2)
    artifacts: [],                // [{path, label, html}] — paths relative to task root
    gate: null                    // {question, answer} after the exit gate fires
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

The viewer decides presentation (hero artifacts per workflow type, collapsed drawers, severity colors) — orchestrators only supply data.

---

## 9. HTML Companion Reports

> **Config gate**: `options.html_output` false disables this section — see § 4 Project Configuration. Not gated: product-design Phase 7 visual mockups are design deliverables, not report companions.

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
- Companions follow the shared style guide: `references/html-report-style.md` (sibling of this file). Self-contained single file, no external resources, relative links/images only.
- Orchestrators pass `html_style_guide_path` (the absolute path of that style guide — it sits next to the patterns file read at initialization) to every companion-writing **agent**, and omit it when `options.html_output` is false; an agent given no path writes only the `.md`. **Skills** that write companions (`implementation-verifier`) receive no such parameter: they resolve the guide themselves and gate on `orchestrator.options.html_output` in state.
- Register companions in `phase_summaries.[phase].artifacts[].html` so the dashboard (§ 8) links HTML first with md fallback (`html: null` when companions are disabled).
- Companion generation must never block the workflow: if it fails, keep the md, log the miss, continue.
