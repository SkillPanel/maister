---
name: maister-init
description: Initialize Maister framework with intelligent project analysis and documentation generation
argument-hint: "[--standards-from=PATH] [--advisor=on|off]"
---

**Cursor user-gate adapter:** Prefer the `AskQuestion` tool for mandatory gates and clarifying choices. If `AskQuestion` is not available in this session (for example `Tool not found: AskQuestion`, as with some Grok 4.5 sessions), fall back to an **inline chat question** that lists the same options, then WAIT for the user's reply before continuing. Never skip a gate because the tool is missing.

# Initialize Maister Framework

Initialize `.maister/docs/` with intelligent project analysis and meaningful documentation generation based on actual codebase inspection.

## Advisor intent (resolve only — no writes yet)

Resolve Advisor intent **before** creating backups, documentation, standards,
scaffolding, or any other project artifact — including `.maister/config.yml`.
Repeated identical `--advisor=on|off` flags are one effective value. Reject
mixed values, invalid values, and unexpected Advisor arguments before reading
or changing managed files. An explicit value wins and suppresses the question.

Without an explicit value, use the host's declared native question capability.
An interactive host asks `on` versus `off`, recommending the current valid
`advisor.enabled` value (or `off` when absent). A host without that capability
is non-interactive and resolves to `off`; do not infer interactivity from a TTY.

**Read-only only at this step.** You may read an existing `.maister/config.yml`
to recommend the current `advisor.enabled` value. Do **not** create `.maister/`,
write `config.yml`, or run reconcile yet — that write would poison Phase 1's
existence check and leave orphan files on Cancel.

Store the resolved `on|off` value for the Advisor commit at the end of Phase 1.

**Runtime seam:** Invoke `bin/maister-init-runtime.mjs` with the project root and resolved Advisor intent before Phase 1 writes. Treat its preflight classification, Git snapshots, candidate validation, selected action, and durable transaction result as authoritative; the runtime owns backup, repair/update writes, and reconciliation. A Cancel result must return immediately without creating `.maister/` or any backup/staging artifact.

**NOTE**: This skill invokes exact logical roles and other skills at specific phases. Resolve each role through the common runtime and retain its actor, work item, output, and bounded task context. Use the **Skill tool** only for standards-discover (Phase 8, last phase).

## Phase Configuration

| Phase | Subject | activity description in content |
| ------- | --------- | ------------ |
| 1 | Pre-flight checks | Running pre-flight checks |
| 2 | Analyze project codebase | Analyzing project codebase |
| 3 | Present findings & gather context | Gathering project context |
| 4 | Select standards to initialize | Selecting standards |
| 5 | Initialize documentation structure | Initializing documentation |
| 6 | Generate project documentation | Generating project documentation |
| 7 | Validate | Validating initialization |
| 8 | Discover coding standards | Discovering coding standards |

**Task Tracking**: Before Phase 1, use `TodoWrite` for all phases (pending), then set sequential dependencies with `TodoWrite ordering in todos array (merge: true)`. At each phase: `TodoWrite` to `in_progress` → execute → `TodoWrite` to `completed`. If skipped (e.g., user selects "Update existing"), mark skipped phases as `completed` with `status: "cancelled"`.

---

## PHASE 1: Pre-flight Checks

Advisor **intent** above must already be resolved (value stored; no writes yet).

**Classify the pre-run state before any write.** Capture `git status --short` and
`git diff --cached --name-status` for the final integrity check; never stage,
unstage, or reset user changes. Classify `.maister/` as:

- **fresh** — no `.maister/` directory
- **partial** — only config, only docs, or an incomplete docs/index structure
- **complete** — config, `docs/INDEX.md`, selected project docs, and standards exist

Keep this classification and the pre-run Git snapshot in workflow state. A rerun
must use it to offer repair/update instead of treating every existing directory
as a fresh reinitialization.

**If `--standards-from=PATH` is provided:**

1. Resolve the path (absolute or relative to current working directory)
2. Check if `PATH/.maister/docs/standards/` exists. If not, inform the user and stop — the specified project doesn't have maister standards initialized.
3. Store the resolved standards source path for use in Phases 4 and 5.

**Snapshot existence before any writes from this run.** Check whether `.maister/`
already exists on disk (pre-run state). Do not treat a directory this run has
not yet created as "existing."

**If state is not fresh**, use AskQuestion:

- **Backup and reinitialize** — copy the pre-run `.maister/` tree to a
  unique backup, then rebuild
- **Repair partial initialization** — preserve existing files and create only
  missing pieces
- **Update existing documentation** — keep config/standards and regenerate
  selected docs
- **Cancel** — stop immediately

For **Cancel**, write nothing: no config, docs, backup, staging, or reconcile.
For Backup, copy rather than move/delete. Preserve unrelated files and keep the
pre-run Git index unchanged.

**Advisor commit** (only after the action is selected): Ensure
`.maister/config.yml` exists with the documented project defaults, then invoke
`bin/reconcile-gate-config.sh reconcile .maister/config.yml on|off` using the
resolved intent. This is a project-only configuration transaction. A missing
`advisor:` mapping receives the complete exact defaults. A present mapping must
already be complete and canonical; legacy actor-model fields, unknown fields,
unsafe YAML, and any role value other than exact `maister:advisor` fail before
replacement. The managed top-level key must be the canonical plain `advisor:`
mapping.

If staging, replacement, or restoration fails, stop initialization and show the
actionable diagnostic. Never continue past Phase 1 after a failed or partial
transaction. On success, display the effective enabled value, all five gate
policies, exact logical Advisor/Arbiter roles, disagreement and retry settings,
and capability-matrix posture before continuing. Configuration alone is not an
Advisor decision: after each real gate dispatch, call
`bin/maister-init-runtime.mjs record-advisor --project-root ROOT --outcome FILE`
with the persisted gate result, actor, model, dispatch ID, selected option, and
confidence. The runtime manifest must report `configured`, `invoked`, and
`decision_recorded` independently. For configured init gates, use the executable
`bin/init-advisor-gate.mjs` adapter around the common `evaluateGate` runtime; do
not synthesize Advisor decisions in the skill host.

---

## PHASE 2: Project Analysis

Resolve `resolveAgent({ logical_role_id: "maister:project-analyzer" })`, then dispatch with the Phase 2 actor, project-analysis work item, conversation output contract, and bounded project context.

Wait for completion. Store analysis results for use in Phases 3 and 6.

---

## PHASE 3: Present Findings & Gather Context

**Step 1**: Present analysis results to the user (project type, primary language/framework, architecture, tech stack, conventions, strengths/opportunities).

**Step 2**: Use AskQuestion to confirm analysis accuracy. If corrections needed, collect them.

**Step 3**: Gather additional context. Present your best guesses (inferred from codebase analysis) and ask the user to confirm or correct in a **single** AskQuestion:

1. Project name (infer from package.json/README/repo name)
2. Project description (1-2 sentences — draft from README or code purpose)
3. Primary goals (infer from recent commits, TODOs, roadmap files)
4. Team context (optional — infer from git log authors)
5. Special requirements (optional — infer from CI/CD, compliance configs)

Format: present all inferred values as a numbered list in one message, ask "Does this look right? Correct anything by number."

**Step 4**: Ask which project documentation to generate using AskQuestion (multi-select):

- "Vision" — Project vision, goals, and purpose
- "Roadmap" — Development roadmap and planned features
- "Tech Stack" — Technology choices and rationale (ALWAYS selected, required)
- "Architecture" — System architecture and design patterns (optional)

Smart defaults based on `projectArchitectureType`:

- Standard/Frontend-only/Backend-only: All selected
- Monorepo/Umbrella: Only "Tech Stack" selected

Store selections for Phase 6.

---

## PHASE 4: Select Standards to Initialize

Before presenting options, explain to the user:

- **What standards are**: Coding standards are documented conventions and best practices (naming, error handling, testing patterns, etc.) that guide consistent development across the project.
- **Starting point**: If `--standards-from` was provided, standards come from the referenced project. Otherwise, the plugin includes generic built-in standards. Either way, they serve as a starting point and can be fully customized or extended later.

**Determine available categories:**

- **If `--standards-from` was provided**: Scan `PATH/.maister/docs/standards/*/` to discover all available categories from the external project (may include custom categories beyond the baseline global/frontend/backend/testing).
- **Otherwise**: Use built-in baseline categories (global, frontend, backend, testing).

Calculate smart defaults based on analysis:

- **Global**: Always recommended (if available)
- **Frontend**: If frontend framework detected or projectArchitectureType includes frontend (if available)
- **Backend**: If backend framework detected or projectArchitectureType includes backend (if available)
- **Testing**: Always recommended (if available)

Also scan `.maister/docs/standards/*/` for any existing custom categories to include.

Show smart defaults summary (noting the source: external project or built-in), then use AskQuestion:

- "Use smart defaults" → proceed with calculated defaults
- "Customize selection" → show multi-select with all discovered categories + "Add custom category" option

Custom categories: if user adds a new category, create the directory and include it in the selection.

Store selection for Phase 5.

---

## PHASE 5: Initialize Documentation Structure

Resolve `resolveAgent({ logical_role_id: "maister:docs-operator" })`, then dispatch with the init actor, documentation-structure work item, filesystem output contract, and this bounded task:

> "Initialize documentation structure. Standards selection: [array from Phase 4]. [If --standards-from was provided: Standards source path: [resolved path]/.maister/docs/standards/. Copy standards from this external path instead of built-in defaults.] Only copy selected standard categories. Do NOT copy project templates — only create the project/ directory. Project documentation will be generated in Phase 6 with real content from project analysis. Create placeholder sections in INDEX.md for skipped categories."

Wait for docs-operator to complete, then immediately proceed to Phase 6.

**Step 2 — Scaffold project config** (Write tool, directly — not via docs-operator): if `.maister/config.yml` does not already exist, create it with the documented default so users have a discoverable place to toggle output. Do not overwrite an existing config.

```yaml
# Maister project configuration.
# html_output — generate the operator dashboard (dashboard.html + dashboard-data.js,
# auto-opened in your browser) and the HTML companion reports (.html twins of spec,
# implementation plan, verification, and research/design outputs). Set to false for
# markdown-only runs. Markdown artifacts, their TL;DR summary blocks, and
# orchestrator-state.yml are produced regardless. Default: true.
html_output: true

# Advisor gate policy is opt-in. Gate types accept manual, advisor, or
# fully_automatic. The hard safety denylist in orchestrator-patterns.md cannot
# be overridden by this configuration.
advisor:
  enabled: false
  gate_policies:
    phase-exit: manual
    optional-phase: manual
    clarify: manual
    convergence: manual
    verify-matrix: manual
  advisor_agent: maister:advisor
  arbiter_agent: maister:advisor
  arbiter_enabled_on_disagreement: true
  retry:
    advisor_attempts: 3
    arbiter_attempts: 3
    backoff: exponential
```

Advisor configuration was already committed by the Phase 1 Advisor commit.
Verify the exact block above and do not overwrite unrelated project configuration.
Report Advisor status separately as `configured`; report `invoked` only when a
real Advisor gate call produced a persisted decision. Init configuration alone
is not an Advisor decision.

---

## PHASE 6: Generate Project Documentation

**IMPORTANT**: Only generate docs selected in Phase 3.

For each selected doc type, read the corresponding reference template:

- Vision selected → Read `references/vision-templates.md`, select template by project type (new/existing/legacy)
- Roadmap selected → Read `references/roadmap-templates.md`, select template by project type
- Tech Stack (always) → Read `references/tech-stack-template.md`
- Architecture selected → Read `references/architecture-template.md`

Fill templates using:

- Analysis report data (tech stack, age, structure)
- User-provided context from Phase 3 (goals, users, requirements)
- Auto-detected project characteristics

Write each file to `.maister/docs/project/`.

---

## PHASE 7: Validate

**Step 1**: Resolve `resolveAgent({ logical_role_id: "maister:docs-operator" })`, then dispatch with the validation actor, documentation-index work item, filesystem output contract, and this bounded task:

> "Regenerate INDEX.md to include all newly created project documentation. Then verify project instructions are properly integrated with `.maister/docs/` documentation."

Wait for docs-operator to complete, then immediately continue with Step 2.

**Step 2**: Run validation checks:

- Verify `INDEX.md`, required `tech-stack.md`, selected docs, and standards exist
- Validate config with `reconcile-gate-config.sh candidate` in a temp path;
  never mutate the project for validation
- Verify INDEX links and project-instruction integration
- Verify no init temp files remain and the pre-run Git index/status are
  unchanged
- Report Advisor as configured/invoked/decision-recorded separately; do not claim a decision from config alone. A configured `advisor` policy with no persisted `record-advisor` event is not approval

**Step 3**: Display comprehensive summary:

- Project analysis results (type, language, framework, architecture)
- Structure created (tree with check marks for created items)
- Documentation status (which docs generated, which standards initialized)
- Key findings (strengths, opportunities)
- Next steps:
  1. Review generated documentation
  2. Customize for your team
  3. Start development with `/maister-work`
  4. Keep documentation current

---

## PHASE 8: Discover Coding Standards

Before invoking discovery, ask the user to choose a tier:

- **Standard (recommended)** — `--scope=full --skip-external`
  (config, code, and docs)
- **Quick** — `--scope=quick` (configuration only)
- **Full** — `--scope=full` (includes GitHub/CI/external sources)
- **Skip** — finish init with the selected baseline standards

Invoke the `standards-discover` skill via Skill tool with the selected scope.
Only explicit/documented or CI-enforced findings may be batch-applied; code-only
inferences require the discovery skill's individual approval. The discovery
skill handles its own review and application workflow.

After completion, display counts for discovered, applied, skipped, and conflicted
standards. If skipped, state that discovery can be run later without reinit.

---

## Error Handling Principles

- If `.maister/docs/` creation fails: check permissions, suggest manual creation
- If project-analyzer fails: offer to proceed with manual input only
- If docs-manager fails: offer retry (max 2 attempts), then manual instructions
- Never auto-rollback — always ask user before destructive actions
