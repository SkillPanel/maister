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

**Why skills MUST use Skill tool**: Skills like `codebase-analyzer`, `implementation-plan-executor`, and `implementation-verifier` spawn their own subagents (Explore agents, reporters, planners) and work inside the run — its state, its gates and the questions it asks the user. A skill runs in the context that invokes it, so these run in the main agent via the Skill tool. Subagents can dispatch subagents of their own, to a depth each host limits, but orchestrators, not leaf agents, run workflows: every agent carries one sentence saying it never starts another workflow, a command or an orchestrator skill, and loads only a skill its own instructions name.

**A runner agent** carries a whole loop for a skill that would otherwise make every call of it in the main session. `implementation-verifier` hands its verification loop to `verification-runner`, and `implementation-plan-executor` its waves to `implementation-runner`, when the run recorded `orchestrator.options.delegation.mode: nested` at the freeze, and each keeps its loop in the main session when the mode is `inline`: the runner dispatches the leaf agents itself (reviewers and fix agents, or one implementer per task group), makes the loop's records, and returns one result per dispatch. Every continuation is a fresh dispatch from the files the runner left — after an answered decision, a crash or a compaction alike — and the engine's `runner-step` says which. A runner is always dispatched in the foreground, with `run_in_background: false` set explicitly.

**Companion agent pattern** (e.g., `docs-operator`): For skills that do NOT spawn subagents (like `docs-manager` which only does file operations). A companion agent preloads the skill via the `skills` frontmatter field and is invoked via Task tool. A skill that spawns subagents runs in the main agent instead: in a companion each of its agents would sit a level deeper, against the host's depth limit.

Reading a SKILL.md and then doing its work inline is not delegation: invoke the skill, and let it spawn its own agents (an orchestrator never spawns the Explore agents `codebase-analyzer` manages).

### Model and Effort on Every Agent Call

A project chooses the model and effort its subagents run on (`subagents` in `.maister/config.yml`, § 4 *Project Configuration*), and the engine resolves the choice; the call only carries it. An `agent:` node's call takes the values its brief's `runs:` line prints. Every other agent call — a skill's or a command's fan-out, a `direct:` step's delegate, a fix, an HTML companion or an index refresh — takes them from the engine's `dispatch-model` verb:

- **Run it once, just before the fan-out**, naming every agent type the fan-out uses: `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=<type>[,<type>…] --host=copilot`. Inside a run add `--state=<task path>/orchestrator-state.yml --node=<the node under way>` (its `orchestrator.started_phase`); standalone, add neither. Run it again before each later fan-out rather than reusing an earlier line, so the value is in context at the call and survives a compaction.
- **Copy, never work out.** Each line reads `<agent>: model <m>, effort <e> — source: …`; copy its two values into the call's `model` and `reasoning_effort` fields, beside `subagent_type`, and leave out a field printed as `omit`, so the host's own choice applies. A `note:` line is acted on where the caller says so (the implementation executor's budget); otherwise it needs nothing.
- **When the host refuses a field** — a model it lacks, an effort an older host does not take — send the call again without that field and write one warning line saying which field and agent: in the work log when the caller keeps one, else in the node summary's `risks` as a `tradeoff`, else in the reply. A verb that cannot run at all is the same: dispatch without either field and say so once. A missing value costs money, never the call.

### When Inline Execution is Acceptable

These do NOT require delegation:

1. **Clarifying questions phases** — ask_user is direct
2. **State updates** — reading `orchestrator-state.yml`, and writing it through the engine's `write-state` verb, never an editor tool
3. **Phase announcements** — Outputting status messages
4. **Simple decisions** — Enabling/disabling optional phases
5. **Finalization** — Creating summary, updating metadata

For all analysis, planning, implementation, and verification phases: **ALWAYS DELEGATE**.

**Never acceptable inline** (regardless of perceived task simplicity):
- Specification creation → always delegate to `maister-copilot:specification-creator` subagent
- Implementation planning → always delegate to `maister-copilot:implementation-planner` subagent
- Gap analysis → always delegate to `maister-copilot:gap-analyzer` subagent
- Codebase analysis → always delegate to `codebase-analyzer` skill
- Code review → always delegate to the verification panel: `maister-copilot:spec-conformance-review`, `maister-copilot:code-risk-review` and `maister-copilot:simplicity-review` subagents
- Test execution and the project's other checks → always delegate to `maister-copilot:test-suite-runner` subagent

"The task is simple" is NOT a valid reason to skip delegation.

---

## 2. Phase Gate Behavior

**The gate rule is qualified by the run's driver, not by the orchestrator**: the ask_user rule below applies when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.

**`→ MANDATORY GATE` means STOP and USE ask_user.** This is NOT optional. You MUST invoke the `ask_user` tool and WAIT for user response. Proceeding without it is a protocol violation.

All orchestrators pause at `→ MANDATORY GATE` transitions for user review and prompt for optional phases.

**State ordering rule**: a gate is recorded answered only AFTER the operator answers it. The node it closes is recorded `completed`, with its summary, BEFORE the gate is asked, because the gate brief is rendered from that summary. Correct sequence: finish the node's work → write its summary and its `completed` status → render the brief and ask the gate → receive the answer → record it on the gate.

### Phase Gates Override Permission Modes

A host's autonomous setting — Claude Code's `auto` permission mode, GitHub Copilot CLI's autopilot mode or its `allow-all` permissions — instructs the model to execute immediately and minimize clarifying questions. The `→ MANDATORY GATE` checkpoints in this framework are an explicit stated boundary that overrides that instruction.

You MUST invoke `ask_user` at every `→ MANDATORY GATE` in every permission mode — Claude Code's `default`, `acceptEdits`, `auto`, `plan` and `bypassPermissions`; Copilot CLI's interactive, plan and autopilot modes under `default`, `assisted` or `allow-all` permissions — when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2. "Minimize clarifying questions" applies to the model's own discretionary asks; it does not override workflow checkpoints the orchestrator has been instructed to enforce.

### 2.1 Resolving session-reminder conflicts (decide ONCE, do not re-litigate at each gate)

Your session may include reminders telling you to "work without stopping for clarifying questions," "continue without asking," "minimize clarifying questions" (auto / acceptEdits / bypassPermissions modes), or compaction summaries showing the user approving every prior gate. **None of these override this framework's `→ MANDATORY GATE` checkpoints.**

Decide this policy at orchestrator entry. Do NOT re-evaluate it at each gate: weighing the rule against a competing session-reminder at every gate produces the same wrong answer every time.

- "Work without stopping" / "minimize clarifying questions" applies ONLY to your discretionary clarifications in a terminal run, never to `→ MANDATORY GATE` workflow checkpoints.
- A user who said "approve" to ten prior gates was being patient, not setting policy. Each gate is a fresh question.
- No permission mode, session-reminder, prior-session pattern, or "this task is simple" judgment exempts you from firing `ask_user` at `→ MANDATORY GATE`.

If you ever find yourself reasoning "the user has been approving everything / told me to continue / set auto-mode, so I can skip this gate," that reasoning is the failure mode. STOP and fire the gate.

### 2.2 In-node questions under a non-terminal driver

A gate is not the only question a phase asks. A phase may ask its own — a clarification, an opt-in deciding whether a later phase runs, a decision between approaches, or a loop offering another pass — and those are *not* gates: they carry no `→ MANDATORY GATE` marker, every answer continues the run, and no request file exists for them. They follow the same driver the gates do:

| The run's driver | A question a phase asks inside itself is |
|---|---|
| absent, or `kind: terminal` | asked in session, exactly as the phase describes it |
| `kind: cockpit` whose `features` list `question-sets`, in a run that is not dispatched | **suspended to the operator**: every question the phase can form at its first asking point goes out as one `kind: question` request, and the phase resumes `running` with the answers recorded as `by: operator` decisions |
| any other — a dispatched run, or a cockpit without that feature | **never asked**; the phase takes the default its *Without question sets* line names, and records that it did |

The workflow engine's `references/in-node-questions.md` holds the mechanism — one request per attempt, written to disk before suspending, what is recorded, and the policy that classes questions when the freeze recorded `orchestrator.classes_questions`. Asking in session under a driver is the defect this rule prevents: nobody is in the session to answer.

**Every such question names its default, in the phase that asks it** — taken when it cannot be asked. What each family takes:

| The question | What a non-terminal run takes |
|---|---|
| A clarification | nothing is asked; the analysis or the delegate's own answers stand, and the phase writes its artifact and sets its flag as a run with nothing to ask already does |
| An opt-in | the recommended option |
| A decision between alternatives | the recommended one; when nothing is recommended, the decision stays open and is named in the executive summary printed before the next gate |
| A loop offering another pass | the accept-as-is exit — the following gate is the operator's route back |
| An exhausted recovery budget | the phase fails rather than choosing retry or skip on the operator's behalf |

**A recommendation keeps every criterion the task states**, so a default taken from one never narrows the task either. Each default taken is recorded on the phase's summary `decisions` as `{decision: <default taken>, by: default, question_id: <question-id>}`; a phase that had nothing to ask records nothing.

**A run started under a driver has its inputs**, so a task description or research question is never invented: if one is genuinely missing, stop with `RUN-FAILED` rather than inventing one.

**Two things this never defaults past.** It settles who answers, not what may be waived: an unresolved critical issue is not proceeded past — the default fixes what is fixable and carries the remainder into the following gate (§ 6 Exit Conditions holds unchanged) — and a decision the phase owes is still *resolved* rather than skipped, since a defaulted decision satisfies a completeness self-check and an unasked, unrecorded one does not.

### Anti-Patterns

| Anti-Pattern | Why It's Wrong |
|--------------|----------------|
| Proceeding without ask_user at phase gates | User loses control, can't review or stop |
| Saying "I'll pause here" without tool call | Words are not pauses. Tool invocation required. |
| Auto-accepting subagent decisions without asking | User must consent to scope/approach decisions |
| Outputting a summary after phase work, then ending turn before reaching `→ MANDATORY GATE` | Gate is skipped; user loses control at the most critical review point. The gate must be the FIRST action after phase work completes — no summaries, no output before it. |
| Recording a gate answered before the operator answers it | Downstream nodes become ready on an answer nobody gave. Gate → operator's answer → record it. |
| "The subagent works autonomously, so the orchestrator should too" | Subagents have no user channel; the orchestrator IS the user channel. |
| Treating an empty `decisions_needed` as license to skip the phase exit gate | The DECISION GATE (mandatory-when-decisions-exist) and the phase exit `→ MANDATORY GATE` (mandatory-always) are separate. Empty `decisions_needed` only skips the former. |

---

## 3. Context Passing & Decisions

### Context Passing

All subagent prompts must include context from prior phases, and **that context is
fetched, not composed**:

```
prompt: |
  [Task instructions]

  [the stdout of `run-context --state=<task path>/orchestrator-state.yml --node=<this node>`
   — or, for a delegate that writes an artifact, of
   `prior-context --state=<task path>/orchestrator-state.yml --node=<this node>`,
   which prints the same block followed by the prior-phase passage —
   pasted in unedited; it opens with its own heading]

  ## ARTIFACTS TO READ
  [List relevant files for full details]
```

**Why**: Subagents run in isolated context. The run-context block carries what every delegate needs — `task_path:`, the `html:` line (§ 9), the project's `docs (read-only):` list, the `scratch:` rule, the summary contract of § 7 and the `companions:` the node owes — so none of it is typed by hand and none of it is forgotten.

**The prior-phase passage is fetched, not composed** — a hand-written `## CONTEXT FROM PRIOR PHASES` block drops items without a trace. The read-only `prior-context` verb prints every phase, its decisions and its risks, one bullet each with the count beside the heading, for every workflow (`workflow-engine/SKILL.md` § *Delegation by scheme* has the invocation). Call it **at each consuming delegate** — one call per prompt, in the turn that composes it — and paste its stdout unedited: trimming, re-ordering or tightening it is the same defect by hand, and a rendering taken for an earlier delegate is stale once a summary is written in between. The verb writes nothing, so the extra call costs nothing.

### Context Extraction

After each step, extract key findings into the step's own `node_summaries.<node>` entry:

1. Parse subagent output for key fields
2. Create 1-2 sentence summary
3. Extract `decisions`, `risks`, and `artifacts` from the artifact's summary block (§ 7)
4. Update state: `node_summaries.<node>` — every successful `write-state` also projects the operator dashboard (§ 8), so there is nothing else to refresh

This enables context passing to downstream phases and supports resume.

**Critical**: Some subagent outputs contain structured fields that control downstream phase logic (e.g., `task_characteristics` from gap-analyzer gates Phase 4 and Phase 10 defaults). These MUST be extracted and written to state immediately — not just summarized. Re-read state after writing to verify the values were stored correctly.

### Decision Enforcement

When a subagent returns `decisions_needed` items, the orchestrator MUST present them to the user via ask_user. Decisions are never silently skipped, accepted on the user's behalf because the recommendation looks clear or the task simple, or logged without asking — documentation is not consent.

**Decision Gate Pattern**:

1. **Parse**: Extract all critical and important decisions from subagent output
2. **Present**: every decision is its own **single-select question with its own option set** — NEVER flatten several decisions' options into a single question's option list (the user could pick two conflicting options from one decision, or none from another). Critical decisions: one `ask_user` call each, with full context in the question itself — what was found and why it needs the user — and each option's description saying what it changes, the recommended one first with its reason; a message above the call is never relied on. Important decisions: may be grouped as up to 4 **separate questions within one `ask_user` call**. A question may allow selecting multiple options ONLY when those options are genuinely non-exclusive (e.g. "which verifications to run?") — never as a way to bundle decisions.
3. **Record each answer** on the phase's summary `decisions` as `{decision, by: operator, question_id, question, answer, recommended, as_recommended}` (the workflow engine's `references/in-node-questions.md` fills who answered, when and how). More details is never recorded.
4. **SELF-CHECK**: "Did I present ALL decisions from `decisions_needed`? If not, STOP."

**Scope note**: this grouping guidance applies to `decisions_needed` triage (pre-analyzed, independent decisions). Interactive convergence flows (e.g. research Phase 4) override it with strictly ONE question per call — later areas depend on earlier answers.

---

## 4. State Schema

All orchestrators use `orchestrator-state.yml` at `.maister/tasks/[type]/YYYY-MM-DD-task-name/orchestrator-state.yml`. The `[type]` dir matches the workflow name except for migration, whose type dir is `migrations/` (plural). A workflow the project defines and starts by name (`/maister-copilot:run <name>`) follows the same rule: its name is its type dir.

### Timestamp Rule (applies to ALL timestamps everywhere)

Every timestamp — `created`, `updated`, `phases[].started/completed`, `generated` in `dashboard-data.js`, dates in work-log entries — MUST be a **full ISO 8601 date AND time in UTC** (`2026-06-11T14:32:07Z`).

- **NEVER write a date-only value** (`2026-06-11`) and **NEVER zero-fill the time** (`T00:00:00Z`) — you do not know the clock time from context, so GET it from the system: `date -u +"%Y-%m-%dT%H:%M:%SZ"` (one Bash call can serve every timestamp written in the same turn). Work-log headings are the exception: each entry reads the clock right before it is written (`agents/implementation-runner.md` § Work-log entries).
- Why it matters: phase durations, "elapsed" displays, and freshness indicators on the operator dashboard are computed from these values — a midnight placeholder renders as nonsense durations.
- Task *directory names* keep their date-only `YYYY-MM-DD-` prefix — that is a name, not a timestamp.

### Project Configuration (`.maister/config.yml`)

An optional project-level config file at `.maister/config.yml` (sibling of `.maister/docs/` and `.maister/tasks/`) holds defaults that apply to every workflow. It is scaffolded by `/maister-copilot:init` but is not required — when absent, every key falls back to its default.

```yaml
# Maister project configuration.
html_output: true     # Generate the operator dashboard + HTML companion reports. false = markdown-only.
mockup_format: html   # UI mockups: html (visual companion) or ascii (ascii-mockup-generator).
subagents: {…}        # Optional: the model and effort per subagent, per host (below).
project: {…}          # Optional: what the project is, for the reviewers (below).
```

| Key | Default | Effect |
|-----|---------|--------|
| `html_output` | `true` | When `false`, workflows skip the operator dashboard (§ 8) AND the HTML companion reports (§ 9): no `dashboard.html`/`dashboard-data.js`, no browser auto-open, no `.html` companions. Markdown artifacts, their § 7 TL;DR blocks, and `orchestrator-state.yml` are produced regardless. |
| `mockup_format` | `html` | How UI mockups are rendered when a workflow generates them (development's `ui-mockups` node, product-design's `visual-prototyping` node, standalone `/maister-copilot:mockup-studio`). `html` → the `mockup-studio` visual companion (browser preview, `.html` files). `ascii` → the `ascii-mockup-generator` agent (no Node/browser). Auto-falls back to `ascii` when Node.js is unavailable. Independent of `html_output` (mockups are design deliverables, not report companions). In product-design, `mockup_format: ascii` is equivalent to the `--no-visual` flag; the flag is a per-run override (flag > config). |
| `subagents` | maister's own table: the `light` rung on `effort: high`; `Explore`, `project-analyzer`, `docs-operator`, `task-classifier`, `test-suite-runner` and `html-companion-writer` on `light`; `task-group-implementer` on `choose: by-plan-tier` (all three rungs, `unassessed: standard`, `ceiling: {claude: deep, copilot: standard}`, `budget: {deep: 3}`), except at the built-in fix loops (development's and performance's `verification`, migration's `issue-resolution`), where it takes `model: inherit`; every other agent on the host's choice | The model and effort each subagent is dispatched with, for Claude Code and for Copilot. `tiers` remaps the `light` / `standard` / `deep` ladder (a `claude` cell is an alias — `haiku`, `sonnet`, `opus`, `fable` — and a `copilot` cell a model id, `premium: true` on one billed above one request; `inherit`, in a cell or an entry's `model`, is the session's model); `presets` names model + effort pairs (an effort is `low` … `max`, or `inherit` to send none; an entry's own effort beats its rung's, and a project's rung cell keeps the shipped `high` on `light` unless it sets one); `default`, `agents` and `workflows.<w>[.nodes.<n>].agents` assign an entry — `tier`, `preset`, `model` + `effort`, or for `task-group-implementer` `choose: by-plan-tier` with `allowed`, `unassessed`, `ceiling` (a rung, or one per host) and `budget`. Order: the plan tier, then any entry naming the agent (profile, overlay, the project's step, workflow and agent scopes, maister's own table), then the defaults in that layer order, then the host — so a `default` covers only agents nobody names, and maister's own `light` picks hold until a project names those agents. Overlays and profiles carry the same key without `tiers`. `/maister-copilot:init` writes maister's own table out as a real block, its fix-loop node entries included — into a new `config.yml`, or appended to one without a `subagents` key, never over an existing block — with `Explore` on `standard` at high effort for a codebase over its file-count threshold, and presets, a `default` and another per-workflow entry as commented examples. The block governs the agent calls maister makes; the explore agents a host's own plan mode starts are outside it. The workflow engine's grammar (*Subagent models*) holds the full vocabulary and precedence. |
| `project` | none: every reviewer infers the profile from `.maister/docs/project/` | The project profile, so the reviewers check what applies to the project instead of a fixed web-service checklist. Every field optional: `kind` (`web-app`, `service`, `daemon`, `cli`, `library`, `plugin`, `desktop`, `mobile`, `data-pipeline`, `infra`), `runtime` (free text), `deploy` (`none`, `local`, `container`, `kubernetes`, `serverless`, `package-registry`, `app-store`), `exposure` (`local`, `internal`, `public`), `data` (the stores it writes; `[]` for none), `scale` (`single-user`, `team`, `multi-tenant`), `ui` (`none`, `web`, `tui`, `native`). A field left out rules no check out. `/maister-copilot:init` fills it in from its project analysis and writes it only when the file has no `project:` key, the fields it could not settle commented out. What each field rules out, and how the code reviewer, the production-readiness checker and the pragmatic reviewer split a safeguard's absence from its presence: `implementation-verifier/references/review-findings.md` § The project profile. |

**How it is read**: at initialization (§ 5) the orchestrator reads `.maister/config.yml` if present and seeds `orchestrator.options.html_output` and `orchestrator.options.mockup_format` into state (defaults `true` / `html` when the file or key is absent). All downstream gates read these from state, not the file — so resume is consistent and the file is read once. `subagents` is read by the engine's freeze instead: it judges the block, folds in the overlays' and the profile's, and records the result as `orchestrator.options.subagents`, which `dispatch-model` and the `runs:` line of a node's brief read (§ 1, *Model and Effort on Every Agent Call*). A block with an error is refused whole, with a warning, and maister's own table applies; an edit of the file reaches the next run, never one under way. `project` is read by the freeze too: a field with a bad value is a warning and is left out, never a refusal, and the profile is recorded as `orchestrator.options.project`, which `review-brief` copies into each cycle's brief as `profile` with `source: config`. A run frozen with no profile hands its reviewers `source: none`, and each infers the profile from the project's docs. `/maister-copilot:run --check` judges the key the same way.

### Common Fields

```yaml
orchestrator:
  # Phase tracking — derived by the state writer from workflow.nodes on every write
  started_phase: [phase-name]  # the non-gate node under way, else the one started last, else null
  completed_phases: []         # non-gate nodes recorded completed, in frozen order
  failed_phases: []            # non-gate nodes recorded failed, in frozen order

  # Optional phase flags — shared keys only; `options` is an open map
  options:
    sequential: true | false | null  # Set by --sequential. Read by the implementation loop to disable parallel wave dispatch.
    html_output: true | false        # Seeded from .maister/config.yml at init (default true). Gates dashboard + HTML companions — see "Project Configuration" below.
    subagents: {…}                   # Recorded by the freeze from .maister/config.yml, the overlays and the profile; read by dispatch-model. Never written by hand.
    project: {…}                     # Recorded by the freeze from the project key of .maister/config.yml; read by review-brief. Never written by hand.
    mockup_format: html | ascii      # Seeded from .maister/config.yml at init (default html). Passed to mockup-studio (development's ui-mockups node / product-design's visual-prototyping node). See "Project Configuration" below.
    # per-orchestrator keys (development's e2e_enabled, user_docs_enabled, skip_test_suite, …) live here too

  # Who drives the run — absent means terminal; written whole, never merged
  driver:
    kind: terminal | cockpit | dispatch  # The gate rule keys on this (§ 2); dispatch is the legacy form of a dispatched run
    cwd: [absolute path]                 # Required beside cockpit or dispatch; where the run was started — the run is located by its state file, never by this
    dispatch_id: [id]                    # A dispatched run's: {kind: cockpit, cwd, dispatch_id} is how a dispatch seed records one, never given question sets (workflow-engine skill, "A dispatched run is told by its dispatch_id"); also tells apart runs sharing one checkout
    session: {id: [session id]}          # A cockpit's, set when it adopts the run; the engine never writes one
    features: []                         # What the driver carries, e.g. question-sets (§ 2.2); a sub-run's freeze copies its parent's, else the engine only reads it

  # Timestamps
  created: [ISO 8601 timestamp]
  updated: [ISO 8601 timestamp]
  task_path: .maister/tasks/[type]/YYYY-MM-DD-task-name
  policy_hash: [sha256:…]  # writer-owned, recorded at freeze

# Task metadata
task:
  title: [human-readable task title]
  description: [full task description]
  status: pending | in_progress | completed | failed | blocked  # in_progress: the state writer, at the first node start
  tags: []
  priority: null  # high | medium | low
  base_commit: {sha: [commit], dirty: []}  # writer-owned, recorded at freeze: HEAD then, and the paths already dirty; absent outside git
```

The three keys above are the only `options` keys every orchestrator shares. `options` is an **open map**: per-workflow keys are listed in each workflow definition's node prose (`workflow-engine/workflows/<name>.md`). The keys the state writer seeds and merges beside them are the engine's (`workflow-engine/references/writing-state.md`).

### Extension Pattern

Workflows add domain-specific fields in their context block, at the **top level** of the state file — never nested under `orchestrator:`. The block's name is derived from the workflow's name: `<name>_context`, with the name's dashes written as underscores, and the state writer applies the rule (`workflow-engine/references/writing-state.md`). The root carries exactly one context block, or none (a chain run, or a workflow whose nodes record only `node_summaries`, has none). The built-ins' blocks are below; development and product design are the two whose block does not carry their own name:

| Domain | Context Field | Example Fields |
|--------|---------------|----------------|
| Development | `task_context` | risk_level, architecture_decision, task_characteristics (`ui_heavy` nests here), research_reference, work_reference, architecture_reference |
| Performance | `performance_context` | bottlenecks_identified, user_data_available, bottleneck_priorities |
| Migration | `migration_context` | migration_type, migration_strategy, breaking_changes, rollback_plan_created |
| Research | `research_context` | research_type, research_question, confidence_level, gathering_strategy, work_reference |
| Product design | `design_context` | design_characteristics, complexity_level, refinement_iterations, visual_companion |

The state writer maps each workflow to its block (`workflow-engine/references/writing-state.md`); for product design the block's shape is "The context block" in `workflow-engine/workflows/product-design.md`. A step's summary is never kept in the context block: it is the step's `node_summaries` entry (*Shared: node_summaries entry shape*).

### Shared: research_reference

When development starts from completed research (`--research` flag):

```yaml
task_context:
  research_reference:
    path: null
    research_question: null
    research_type: null           # technical | requirements | literature | mixed
    confidence_level: null        # high | medium | low
```

Research context flows to ALL phases via context passing. Artifacts are also copied to `analysis/research-context/`.

### Shared: work_reference

When a development or research run is started with a context pack (`--context` flag, the
`context` input), the run's context block records where it came from, and the pack is copied to
`analysis/work-context/`:

```yaml
task_context:          # research_context in a research run
  work_reference:
    path: null         # the path as given, relative to the project root
```

The pack is background, not a specification; a path that is missing or unreadable is reported in
the first node's summary and the run continues without it.

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
  cycle: 1                   # the cycle under way, the review brief's number
  snapshot: null             # the brief's tree id for that cycle
  node: verification         # the node and its attempt that ran the cycle, so a re-dispatch
  attempt: 1                 #   tells a crash in this attempt from a new attempt
```

Whoever runs the loop writes this block: the verification runner when the run nests, the main
session otherwise. The orchestrator's own writes around a runner are the node's start, its end and
the answers to the decisions the runner hands back.

The verifier copies `issues_found` from what the workflow engine's `findings-merge` prints over the cycle's reviewer findings files (`implementation-verifier/references/review-findings.md`), so the numbering and the shape below are kept in code. Record every issue in `issues_found` as an object, never as a bare string: `severity` is `critical`, `warning` or `info` as the report graded it, `id` is the report's own number for the finding — kept across re-checks, a new finding taking the next unused number — `risky` is the verifier's grading of whether its fix would reach beyond the item, and `fixed: true` marks one fixed since (keep its original severity). The dashboard shows each issue under its `severity`. A string carries no severity field, so its severity has to be guessed from the text.

### Shared: node_summaries entry shape

Every `node_summaries.<node>` entry uses this base shape (a workflow's guide may add step-specific fields):

```yaml
node_summaries:
  <node>:
    headline: null       # one sentence (≤ 220 chars) for the stretch a gate closes; on the node the gate needs; a gate shows it as Done
    summary: null        # 1-2 sentence prose summary; the top findings go here, never in risks; a gate shows it whole as Found
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

**Who runs which step.** Steps 1–4 — the fixes made without asking, the re-checks, the budget and
the decision to stop — are the loop's, carried out by whoever runs it: the verification runner
when the run nests (`agents/verification-runner.md`, which batches the fixes by file or area), or
the main session. Steps 5–10 — the questions, what each answer does, and what the gate is handed —
stay with the node: the runner hands the decision back as its result, the node asks it, and the
answers travel to the next runner dispatch in `verification/decisions-<cycle>.json`.

1. **Apply without asking** every unfixed critical or warning issue the verifier marked `fixable`
   and not `risky`. An info issue is listed in the report and never fixed without a person
   choosing it.
   A fix is risky when it reaches beyond its item into behaviour the change did not set out to
   alter — a departure from the specification, a change to what callers see, anything beyond
   the code such as staging files in git. A fix handed to `task-group-implementer` takes the
   model and effort `dispatch-model --agent=maister-copilot:task-group-implementer` prints with
   `--node=` this node and no `--tier` (§ 1, *Model and Effort on Every Agent Call*): a fix has
   no planner tier, and maister's own table gives the built-in fix loops the session's model. Record each fix in `verification_context.fixes_applied`
   and in the node summary's `fixes_applied` as `{finding, change}` — never as a decision — and
   clear `skip_test_suite` when one changed code.
2. **Re-check, as cheaply as the fixes allow — without asking.** Pass the verifier the numbers
   of the issues fixed since the last cycle as `fixed_issues`. After a fix that changed
   behaviour, `recheck: reviews`: the test suite, then only the reviews that raised a fixed
   issue, each re-checking its issues against the fix diff and reporting new findings inside it
   alone. After fixes that changed no behaviour — comments, docs, regenerated HTML, the run's own
   bookkeeping — `recheck: tests-only`: the test suite alone, which resolves the fixed issues
   when it passes. When only info items are left, no fix pass and no new cycle starts for
   them. Raise
   `verification_context.reverify_count` by one for each re-check that ran.
3. **Budget: two automatic re-checks**, the same in a terminal run and under a driver.
4. **Ask only when one of these holds**, and otherwise go on to the gate:
   - an issue needs the user's decision (`fixable: false`);
   - a fix is risky;
   - the budget is spent with fixable issues still open;
   - there is **no progress**: the same issues come back, or new ones keep appearing inside the
     fixes. An issue the merge marks `not_reported` — not found again, and not shown fixed — is
     still open; one it moved to `out_of_scope` was raised outside the fixes and is not progress
     lost.

   **An item whose recommendation is to leave it is not a decision.** A pre-existing info item
   that predates the change, recommended "leave", is not asked: record it in the node summary's
   `risks` as `{risk: <item and the fix, if wanted>, tag: followup}`, so the end of the run lists
   it. When such items arrive beside real decisions, the page carries at most one "Leave all N
   for later (Recommended)" choice for them, never one tab each.
5. **One question per issue, built by the engine.** Once the automatic fixes and re-checks are
   done, every issue still needing a person — a decision, a risky fix, a fixable one still open
   after the budget, one that keeps coming back — is written as a findings list and turned into
   one question set by the workflow engine's `finding-brief` (engine `references/in-node-questions.md` § *Findings that need a
   decision*): one question per issue, most severe first, each with the verifier's proposed fix
   and the alternatives it names, "Accept the risk and list it", the recommended choice with its
   reason, and the issue's evidence in the question. Issues with one root cause (the same
   missing guard in three places) are one finding. In session the set is paged as engine §
   *In-node questions* says, the first question naming the report's path from the project root.
6. **Triage first when more than about eight issues need a decision**: one question showing the
   counts by severity and offering "Go through them, most severe first", "Only the critical ones
   now — the rest become open risks for the checkpoint", and "Continue as is".
7. **What each answer does.** A chosen fix is applied, logged and re-checked like any fix; an
   accepted risk becomes a `tradeoff` risk; an issue nobody could be asked about stays an `open`
   risk, unless the run's autonomy policy classes it — then it is settled, defaulted or held as
   the engine's classing write says, and a held choice goes on provisionally until the next
   checkpoint approves it.
8. **The question at the stopping point** — budget spent, or no progress — names what is
   left in the question (counts by severity, the worst item in a few words) and offers "One
   more round", "Continue as is" and "Stop", one of them recommended with its reason in its
   description: "Continue as is" when only warnings remain, "One more round" when the last
   round made progress, "Stop" when a critical issue is left.
9. **What the gate is handed.** Issues still needing a decision become `open` risks, with the
   fix as their `change`; items left for later stay `followup` risks; accepted ones `tradeoff`
   risks; a spent budget with critical issues still open is a `stop` risk, which makes Stop the
   gate's recommended answer.
10. **Under a driver** with question sets, the finding set is the phase's one request in its
   attempt, so the stopping point after it takes "Continue as is". Under any other driver
   nothing is asked: the findings stay `open` risks, or take what the policy's class gives them.

Issue numbers stay stable across cycles: an issue keeps the `id` it was first given, and a new
one takes the next unused number. Never announce a fix before it is made; once made, name
each by a few words beside its number ("2, the missing tag trim"), never by numbers alone. Say
each re-check by its count ("re-check 1 of 2"). The gate after the loop stays the user's checkpoint:
its brief lists every fix made without asking, with the report's path, and an unresolved
critical issue is never proceeded past without an explicit answer saying so.

**Documents in the loop.** A fix never edits `.maister/docs/INDEX.md` or anything under
`.maister/docs/standards/`. A stale fact is fixed in the document that holds it; a finding against
the index itself — a document with no entry, a dead or duplicate entry, a conflict marker — is
fixed by a refresh, never by hand. A convention, pitfall or fact a fix shows to be worth keeping
is written to the work log as a standard candidate, one line as docs-manager's
`references/standard-candidates.md` describes it, for finalization to consolidate and offer. When the loop's fixes
changed anything under `.maister/docs/`, invoke `docs-operator` once,
with its `dispatch-model` values (§ 1), after the last fix and before the gate: "Refresh INDEX.md. Changed: [paths]. Check: [check path]",
the check being docs-manager's `scripts/docs-check.mjs` by its absolute path. A refresh changes
no behaviour and starts no re-check of its own.

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
   creator in its amend mode, called with the model and effort `dispatch-model`
   prints for it (§ 1), applies exactly those changes to `implementation/spec.md` (and to
   `analysis/requirements.md` where a fix reaches it). The audit report stays the auditor's —
   the run never edits or annotates it.
2. **Re-audit once, and only when a fix changed a requirement.** A fix that adds a planned test
   case, a limit or a sentence stating an existing requirement more precisely needs no
   re-audit. The re-audit rewrites the report; its new fixable findings are not fixed again.
3. **No progress stops it**: a fixed finding coming back, or a fix the creator could not apply,
   stays open.
4. **Record the fixes**: each in the node summary's `fixes_applied` as `{finding, change}` (and
   the re-audits in `reaudit_count`), never as a decision, so the gate lists it as fixed by the
   run.
5. **Ask each finding that needs a decision on its own**, as the fix loop's step 5 does: the
   auditor's decision findings become one question set through `finding-brief`. The chosen
   changes go to the specification creator in one more amend pass, with no re-audit; an accepted
   risk becomes a `tradeoff` risk; a finding nobody could be asked about stays open unless the
   policy classes it.
6. **What the gate is handed**: only the findings still open — undecided, not applied, or found
   by the re-audit — as `open` risks with their `change`, the critical ones first; a finding
   about something outside the change as a `followup`. The gate's revise suggestions come from
   those alone, never from a fix already made.

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
- At context extraction (§ 3), the orchestrator lifts the block's content into `node_summaries.<node>.decisions` / `.risks` in the object shapes of § 4 — this is what feeds the operator dashboard (§ 8).

**Exempt**: `orchestrator-state.yml`, `dashboard-data.js`, raw mockup files, screenshots, and incremental logs (`work-log.md` — append-only, gets no retroactive TL;DR).

---

## 8. Operator Dashboard

> **Config gate**: `options.html_output` false disables this section — see § 4 Project Configuration.

Each task directory carries a self-contained HTML dashboard so the operator can monitor workflow progress at a glance and deep-dive only when needed.

**Files** (both at task root):
- `dashboard.html` — static viewer, copied verbatim from `[plugin]/skills/orchestrator-framework/assets/dashboard.html` at initialization (§ 5). NEVER generated or modified by the model — it is a maintained plugin asset. `dashboard.html` is a frozen asset.
- `dashboard-data.js` — data projection. The state writer projects it from state on every successful `write-state`; nothing else writes it. The viewer reads it via `<script>` (`window.MAISTER_DATA = {...}`), so it works from `file://` with no server.

**There are no rewrite moments: the projection is the file's only writer.** It is a full projection of `orchestrator-state.yml` plus the summaries, never an incremental patch, and its `generated` stamp is the writer's own clock. A node that wants the dashboard current writes state. The implementation and verification phases run under a skill, outside the engine's turns, and the skill keeps the dashboard current from inside them the same way, never by writing the file. The implementation loop — the implementation runner, or `implementation-plan-executor` in the main session — records each wave start and each group return through the engine's `wave-start` and `group-done` verbs, and each call re-projects the dashboard and the status line itself; the projection derives the phase's `progress` from the plan's checkboxes and the work log's wave and revert headings. The verification loop — the verification runner, or `implementation-verifier` in the main session — records each cycle's `last_status` and `issues_found` in `verification_context`, and the verification panel is projected from that block. A skill run standalone, with no workflow run and so no state file, has no dashboard.

**What it carries.** The file is one statement, `window.MAISTER_DATA = <strict JSON>;`, projected from state: the task (title, its workflow as `type`, status, path, the running phase's activity line), the task or design characteristics, one entry per phase (status, `started`/`completed` from the § 4 timestamps, skip reason, summary, decisions, risks, artifacts with their `html` companion, the gate's question and answer, and for the plan-executor phase a `progress` derived from the plan and the work log), and a verification panel mirrored from `verification_context`. Its shape is the projection's; nothing in a run composes it.

**Cost discipline**: the data file repeats what state holds — keep summaries terse (1-2 sentences, no markdown) and never copy artifact content into them; the dashboard links to artifacts instead.

**Verbatim rule for decisions and risks**: `decisions` and `risks` entries are copied **verbatim** from the artifact's Key Decisions / Open Questions / Risks blocks (§ 7) — never re-summarized or shortened. The contract already caps their length at the source; compressing them again strips the meaning the operator needs.

**Resolved risks**: when a previously recorded risk gets resolved in a later phase, keep the entry and set its `tag` to `resolved` (e.g. `{risk: "transient warning — query lookup chosen", tag: resolved}`; an older string entry is prefixed `resolved:` instead). The viewer dims and strikes resolved entries, separating live risks from settled ones.

**Where a phase card's prose comes from.** The projection reads `node_summaries.<node>` alone: `summary`, `decisions`, `risks` and `artifacts` come from the node's own entry, and a `phase_summaries` copy that an older run still carries in its context block is not read.

The viewer decides presentation (hero artifacts per workflow type — none for a type it has no hero map for — collapsed drawers, severity colors) — orchestrators only supply data.

---

## 9. HTML Companion Reports

> **Config gate**: `options.html_output` false disables this section — see § 4 Project Configuration. Not gated: product-design's `visual-prototyping` mockups are design deliverables, not report companions.

A companion is a rich HTML page beside a markdown artifact, for people to read. The markdown stays the source of truth — subagents read md, humans read HTML — and the companion adds visual structure (severity badges, matrices, embedded screenshots), never unique content.

**Declared, not listed here.** Which artifacts owe one is part of the workflow definition: a top-level `html_companions` block maps a node id to the artifact keys of that node whose `.md` owes a sibling `.html` (`workflow-engine/references/grammar.md` § 3.2). An overlay or a profile may add, replace or clear a node's list. A definition without the block owes nothing.

**Who writes it.** The delegate that writes the markdown writes the companion in the same pass, so the two never drift. A `direct:` node that owes one hands its finished md to html-companion-writer before its completion write. Every html-companion-writer run in this section carries the model and effort `dispatch-model --agent=maister-copilot:html-companion-writer` prints (§ 1, *Model and Effort on Every Agent Call*). Companions follow `html-report-style.md`, the file beside this one: one self-contained file, no external resources, relative links and images only.

**How a delegate learns of it.** The `run-context --node=<node>` block pasted into the prompt (§ 3) carries one `html:` line: `html: <absolute path of the style guide>` when the run has HTML output on and the node owes a companion, `html: off` otherwise, and a `companions:` list of the owed paths. A delegate returns `companion: written | disabled | failed | not-requested`:
- `written` — every owed companion is on disk.
- `disabled` — the prompt said `html: off`. Returned while `html:` was a path, it is a defect to report.
- `not-requested` — the prompt had no `html:` line; the delegate wrote the markdown and warned. An absent line is never read as off: re-delegate with the run context.
- `failed` — the markdown stands, the companion did not; run html-companion-writer once for it.

The verification loop writes its companion once, at the final verdict: the verification runner reads its `html:` line from `run-context`, and `implementation-verifier` in the main session resolves the guide itself and gates on the run's `html_output` in state.

**Registration.** A node's summary registers each companion as `artifacts[].html` beside its `path`, so the dashboard (§ 8) links HTML first with md fallback (`html: null` when companions are disabled). `write-state` fills it from disk when the summary is written.

**Never block.** A companion that fails never fails the node or the workflow: keep the md, name the miss, continue.

**Recovery on `companion-missing:`.** When a node completes without a companion it owes, `write-state` prints `companion-missing: <node> <path>` after its changed paths. Then:
1. Run html-companion-writer once for that file, pasting `run-context --node=<node>` so it gets `html:`.
2. When the node already has a summary, re-send `{"node_summaries":{"<node>":{}}}` to register the companion. When it has none, the summary's own write — still owed — registers it; never send the empty summary then.
3. Never re-run the node. A `failed` result is left for `run-complete` to report (§ 10).

---

## 10. Finalization: Artifact Reconciliation

State records what each phase produced; only disk records what each phase actually wrote. At
finalization — the closing node of every workflow — the two are reconciled before the task is
declared complete.

**What the engine compares**: `run-complete` checks every declared artifact of a completed node
and every companion the run's `html_companions` declares against disk. It prints one
`missing-artifact: <node> <path>` line per absent artifact, then one
`missing-companion: <node> <path>` line per absent companion. They are warnings: the run still
closes. A declared artifact a node recorded under its summary's `absent` is not missing.

**What the closing node does**: relays those lines in a **Missing artifacts** block of the
workflow summary, in plain words, naming the node that owed each path. It still checks any path a
summary lists beyond the declarations (`artifacts[].path` and a non-null `.html` beside it). An
artifact recorded under `absent` is named as *not produced*, with its reason, apart from the
block. When nothing is missing, omit the block — silence here means the declaration held.

**What not to do**: reconciliation reports, it never repairs. Do not re-run a node, regenerate a
companion or delete the stale entry from state; the entry is the evidence that the artifact was
promised. Nor does it block completion — a workflow with a missing artifact still finishes, with
the miss named.

**Why it exists**: an orchestrator can transcribe what a subagent returned, and the verdict then
reads as if the artifact existed. The transcription is the orchestrator's summary of a subagent's
words, not the subagent's own artifact, and nothing else in the run records that the substitution
took place. This comparison is what makes that visible.
