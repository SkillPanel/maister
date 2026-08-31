# Compatibility Contracts

The normative register of every file shape the maister plugin writes or reads and that other tools may depend on: what writes each shape, where its version lives, how a reader must tolerate it, which schema validates it and which fixtures pin it. It binds everything that touches those files — the plugin's orchestrators and engine, the cockpit daemon, and the gate hook scripts. `make test` validates the schemas, the fixtures and the hooks against this register, and the `contracts-v*` release tarball vendors it for readers outside this repository. Contracts are **additive only**: fields may be added, never renamed, removed or re-typed, and a contract version bump ships as a new tag rather than as an edit to an existing one. Each contract carries a short key — `A1`-`A6`, `B1`-`B3`, `C1`-`C8`, `E1`, `E2`, `H1`, `R`, `T1` — used in fixture manifests, schema descriptions and cross-references such as `compatibility-contracts.md § E2`; the keys are the register's stable identifiers, and nothing on disk is named after one.

---

## 1. Hard rules

1. **One change.** A contract-bearing shape moves only when this register, its schema and its fixtures move together.
2. **Additive only.** Add fields; never rename, remove or re-type one. A breaking need takes a new file with a new name.
3. **Absence is the default.** A missing optional key reads as empty or null, never as an error, and never as a reason to refuse the document.
4. **Unknown version degrades.** A `version` higher than the reader knows renders what the reader recognises, records `newer-format`, and never throws.
5. **Unknown keys are preserved.** A reader that rewrites a document carries every key it did not understand through untouched.
6. **No migrations.** No script converts an old task dir, and none will exist. Below the floor a dir is an inventory row.
7. **Keys are labels.** Schema files, fixture directories and fixture ids are named by subject. `A1` … `R` appear in prose, tables and schema `description` / `x-contract` fields only.

## 2. Compatibility floor

The floor is **plugin 2.2.3**. Everything written by plugin 2.2.3 or later renders and resumes unchanged, forever; contracts `A1`-`A6` describe the shapes those versions write. Golden fixtures are sampled only from runs at or above the floor — real runs, pseudonymized — and every fixture records the `writer_version` that produced it. A writer version above the floor whose plugin tree is shape-neutral against the floor tag samples as a floor artifact.

**Floor-detection rule (A1)**: a task dir is **at the floor** when `orchestrator-state.yml` parses, `orchestrator.created` matches A6 (a full, non-midnight datetime) and `task.title` exists. Otherwise it is **inventory-only**: listed by directory name, date prefix and type; never parsed for state, never rendered from `dashboard-data.js`, never resumed. Its files stay browsable as plain artifacts.

**A state file that parses but carries no `orchestrator:` block is an inventory row** carrying its title, not a run. The cockpit path such a dir exercises is the degraded one: the document is read and reported, never refused.

**Legacy type dirs** — `bug-fixes/`, `enhancements/`, `new-features/`, `refactoring/`, `mockups/` — are inventory-only regardless of what their state files contain.

## 3. Contract register

Column meanings: **Owner** = who writes it (engine = the orchestrator or model in the driver session; daemon = the cockpit process; both). **Version** = where a reader finds the format version. **Tolerance** = the read rule. **Schema** = a file under `../schemas/` (`#/$defs/x` where one file carries several roots). **Fixtures** = classes under `fixtures/contracts/`.

| Id | Contract | Owner | Version | Tolerance rule | Schema | Fixture classes |
|---|---|---|---|---|---|---|
| A1 | `orchestrator-state.yml` | engine | implicit v1 — absence of any version field is v1; floor-detection rule § 2 | strict core (`orchestrator`, `task`), typed optional core keys, open per-workflow `$defs`, unknown keys preserved, absence is empty/null | `orchestrator-state` | valid (5 runs), invalid (3), tolerated (product-design), synthetic (performance, migration, skipped/failed, chain-run) |
| A2 | `dashboard-data.js` | engine | `generated` + shape | write-strict one statement / read-tolerant bare-key literal; severity emit set 3, tolerate 7; `fixes[]` and `decisions[]` string or object; `resolved:` prefix or `(resolved` marker | `dashboard-data` | valid (5), invalid (2), tolerated (bare-key, legacy global), synthetic (performance, migration) |
| A3 | `.maister/config.yml` | engine (scaffolded at init) | keys | open map; absent file is defaults; read once at init; `repo_id` additive | `project-config` | synthetic (default, `repo_id`), invalid (bad `mockup_format`) |
| A4 | task-dir layout + artifact path patterns | engine | — | path-pattern register; enumeration rule; non-task children ignored; unregistered task-root files ignored; dot-prefixed non-contractual; artifact paths task-root-relative, `task_path` repo-root-relative, and neither absolute nor escaping its root | `common#/$defs/rel_path` (every relative path field), otherwise none (this register + the suite enumerator) | synthetic (tree listing) |
| A5 | artifact summary block | engine + agents | — | positional form; `&` heading tolerated on read, slash on write; exempt list | none (§ A5 + runner lint) | valid (md per run), tolerated (`&` form), invalid (TL;DR over 5 lines, block after another section) |
| A6 | timestamps | engine | — | `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` on the field-path list, never `T00:00:00Z`; task-dir name prefix exempt | `common#/$defs/timestamp` | invalid (midnight, date-only) |
| B1 | workflow definition + overlay grammar | engine | `version: 1` | additive; unknown `version` degrades; R keys accepted with a warning | `workflow-definition`, `workflow-overlay` | synthetic (research-shaped, richtext, overlay, `version: 99`, reserved keys, gate options carrying values), invalid (cycle, bad node id, two continue options, option values not a map) |
| B2 | `workflow:` block in state | engine | `grammar_version` | one-line flow-map node entries (§ E2); additive | `workflow-state` | synthetic (chain template), invalid (block-form node) |
| B3 | `node_summaries` entry | engine | — | the `phase_summaries` value shape | `node-summary` (refs `common#/$defs/phase_summary_value`) | synthetic |
| C1 | `.maister/umbrella.yml` | engine (umbrella init) | `version: 1` | additive — the branch convention, coordination, tracker, git host, per-person member list and per-member `autonomy` are one such addition; `routing.tiers` reserved | `umbrella-manifest` | synthetic (6-member), invalid (member without path, person members not a list) |
| C2 | dispatch envelope | engine | `version: 1` | additive — the optional `statement` and `workspace_root` are two such additions | `dispatch-envelope` | synthetic (envelope, worker-seed chain), invalid (bad `autonomy`) |
| C3 | ledger entry + 7 ops + `ledger.log` line | engine (`create-entry`, `claim`, `update-status`), daemon (rest) | `version: 1` | additive; op names closed; log line `ts op dispatch_id actor` | `ledger-entry` (`#/$defs/entry`, `op`, `#/$defs/op_call`, `log_line`) | synthetic (entry, op transcript), invalid (illegal status, op call without actor) |
| C4 | outbox message | worker | `version: 1` | additive; one `type` per file; append-only | `outbox-message` | synthetic (one per `type`), invalid (unknown `type`) |
| C5 | stdout markers + outcome rule | engine prints; daemon reads | — | exit code is not a signal; outcome from on-disk E2, marker, denials | `markers` (`#/$defs/marker_line`, `prompt_line`, `outcome`) | valid (result records, both providers), synthetic (outcome records) |
| C6 | coordination branch layout | daemon | `COORDINATION.md` `version: 1` | path-pattern register only at v1; no document schema | none | none (register rows, § C6) |
| C7 | event schema | engine / daemon / cockpit (`actor.via`) | `version: 1` | immutable files; fold in `at` order; `mirror` data carries T1 | `event` (`#/$defs/mirror_data` is T1) | synthetic (one per `type`), invalid (unknown `type`, non-UUIDv7 id) |
| C8 | worker seed descriptor | engine (dispatch node) | `version: 1` | additive; the five section ids, their order and the 60-line cap are frozen; section wording is free | `worker-seed` (`#/$defs/seed`, `section`, `section_marker`, `line_cap`) | synthetic (descriptor), invalid (missing the siblings section) |
| T1 | tracker mirror map | daemon | via C7 `mirror` events | key stored per event; idempotent | inside `event` | synthetic (`mirror` event) |
| E1 | `orchestrator.driver` | engine writes at init; daemon rewrites `session` before re-spawn | field presence | absent is terminal; `kind` in `terminal\|cockpit\|dispatch`; `cwd` absolute; `session.model` optional | `driver` | synthetic (3 kinds, both providers), invalid (relative `cwd`) |
| E2 | `gate_pending` + `gates/<node>.request.yml` + `gates/index.yml` | engine (request, pending, answer); daemon never writes | `version: 1` in request and index | one-line form (§ E2); commit point is `gate_pending: null` written last; an unanswered request is a second signal; `kind` in `gate\|decision\|convergence` | `gate` (`#/$defs/pending`, `request`, `index`) | synthetic (pending, request per kind, answered, index), invalid (block-form pending, request without answer, option id collision) |
| H1 | hook payload floors | providers | Claude 2.1.233, Copilot 1.0.80 | payload shapes per provider and event; response vocabularies; provider enablement env; beacon required before trust | `hook-payloads` (`#/$defs/claude_pretooluse`, `claude_stop`, `claude_sessionstart`, `copilot_pretooluse`, `copilot_agentstop`, `copilot_sessionstart`, `response_*`) | valid (captured payloads per class per provider), synthetic (quoted guard, corrupt state, multi-file patch, unknown tool) |
| R | reserved keys | — | — | accepted and ignored with a warning (§ R) | inside `workflow-definition` / `umbrella-manifest` (`$defs.reserved`) | synthetic (definition carrying all eight) |

**Companion pairs (A4)**: the 9 pairs in `orchestrator-patterns.md` § 9 plus the 4 product-design pairs (`analysis/alternatives`, `analysis/design-decisions`, `analysis/feature-spec`, `outputs/product-brief`) — 13 rows, listed in § A4.

### 3.1 Closed enums

Strictness lives in the enums (§ 1), and the schema is where each one is spelled — never this file, so the two cannot disagree. Every closed enum the contracts carry, and the `$def` that is its single source of truth:

| Contract | Field | Canonical list |
|---|---|---|
| A1 | `orchestrator.workflow_type` | `common#/$defs/workflow_type` |
| A1 | `phases[].status` | `common#/$defs/phase_status` |
| A1 | `task.status` | `common#/$defs/task_status` |
| A1 | per-workflow `research_type`, `complexity_level`, `migration_type`, `approach`, `priority`, `last_status` | `orchestrator-state` (inline, per `$defs` branch) |
| A2 | `phases[].icon_hint`, finding severity | `dashboard-data` (inline) |
| B1 | reserved keys | `workflow-definition#/$defs/reserved` |
| C1 | `autonomy` | `umbrella-manifest#/$defs/autonomy` |
| C2 | `provider`, `substrate`, `grade` | `dispatch-envelope#/$defs/substrate`, `#/$defs/grade` |
| C3 | the seven op names, ledger `status`, `grade`, followup `status`, followup `to` | `ledger-entry#/$defs/op`, `#/$defs/status`, `#/$defs/grade` |
| C4 | message `type`, `need`, `to` | `outbox-message#/$defs/type`, `#/$defs/need` |
| C5 | marker vocabulary, outcome classification | `markers#/$defs/marker_line`, `#/$defs/outcome` |
| C7 | event `type`, `actor.via`, `mirror.tracker` | `event#/$defs/type` |
| C8 | seed `section` | `worker-seed#/$defs/section` |
| E1 | `driver.kind`, `session.provider`, `session.status` | `driver` (inline), `driver#/$defs/session` |
| E2 | request `kind`, option `effect`, answer `via`, index `status` | `gate#/$defs/request`, `#/$defs/option`, `#/$defs/answer`, `#/$defs/index` |
| H1 | `hook_event_name`, `permissionDecision`, stop `decision`, SessionStart `source` | `hook-payloads` (`const` per `$def`) |

A value outside its list is an invalid document, not a degradation: readers reject it rather than tolerate it. Adding a member is additive and allowed; removing or renaming one is not (§ 1).

## 4. Orchestrator state — `orchestrator-state.yml` (A1)

Three layers, and only the first is strict.

1. **Core.** `orchestrator` requires `started_phase` (string or null), `completed_phases[]`, `failed_phases[]`, `created`, `updated`, `task_path` (repo-root-relative). Typed optional: `auto_fix_attempts`, `options`, `task_ids`, `next_phase`, `type`, `skipped_phases`, `driver` (§ E1), `gate_pending` (§ E2). `task` requires `title` and `status`; `description`, `tags[]`, `priority`, `key` are optional. Core-optional at the top level: `project_context`, `related_tasks`, `verification_context`, `external_research`, `workflow` (§ B1), `node_summaries` (§ B1).
2. **Per-workflow `$defs`.** `task_context`, `research_context`, `design_context`, `performance_context`, `migration_context` — each an open object with typed known keys, each carrying `phase_summaries` except migration. The root accepts exactly one of the five, or none: a chain run has none. Each is a **top-level sibling** of `orchestrator:`, never nested inside it.
3. **Shared summary value.** `phase_summaries.<phase>` is either an entry (`summary`, `decisions[]`, `risks[]`, `artifacts[]`, plus any writer-added key such as `key_findings`) **or** a bare `decision_item[]`. A phase whose summary is a list of resolved questions is written as the bare array, in both the `{decision, rationale}` and the `{question, answer}` shapes; both are valid values, and neither is rewritten into the entry form.

**Core key rules**:
- `orchestrator.next_phase` is `string | null`. The writer form is a phase id (`phase-N`); a sentence in that field is read and reported.
- `orchestrator.type` is the workflow-type enum of five (§ 3.1). `orchestrator.skipped_phases` is an `object<string,string>` — phase id to reason.
- `orchestrator.options` is an **open map**. The keys every orchestrator shares are `html_output`, `mockup_format` and `sequential`; the rest belong to one orchestrator each and are listed in its own skill definition.
- `task.key` is an optional string carrying a tracker id. T1 adopts it as the intake key.
- `project_context` is top-level, `{project_doc_paths[], project_context_summary}`. `related_tasks[]` entries are `{path, relation}`.
- The variants that nest `task_context` under `orchestrator:`, or `project_context` under `task_context`, are read and reported (`task-context-nested-under-orchestrator`) rather than refused.

**Known optional keys inside the per-workflow `$defs`**, typed rather than free-form: development's characteristic vocabulary at `task_context.task_characteristics.{has_reproducible_defect, modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy}` with `task_context.{risk_level, architecture_decision}` beside it; `task_context.program_inputs`; `task_context.{change_type, compatibility_requirements, effort_estimate, tech_clarified, clarifications_resolved, scope_expanded}`; `research_reference.local_copy`; `design_reference.*`; `design_context.{visual_companion.shut_down_at, scope_decision, phase7_scope_revision, design_resources}`; `research_context.project_doc_paths`. `research_reference.path` is `string | string[] | null`. Everything else is a preserved unknown key.

The performance and migration context shapes are derived from their orchestrators' own definitions and pinned by synthetic fixtures — no real run at or above the floor existed when the contract was written. The first real run replaces those fixtures without changing the shape.

**A1/A2 consistency.** Three rules relate the state to its dashboard, and the third is deliberately the weakest:

- `started_phase` must not already appear in `completed_phases` — unless `task.status` is one of `completed`, `failed`, `stopped`, where the last started phase is legitimately done.
- `task.status` in the state and in the dashboard agree.
- `completed_phases` is a subset of the dashboard phases marked `completed` or `skipped` — **asserted for terminal runs only**. A run in progress writes its state before it rewrites its dashboard, so a lagging phase row is an expected intermediate shape: a warning, never a failure.

`skipped` counts as done on both sides. Array-valued `phase_summaries` entries are skipped by the entry-level checks and counted valid.

## 5. Dashboard data — `dashboard-data.js` (A2)

**Serialization rule.** The file is exactly one statement:

```js
window.MAISTER_DATA = <strict JSON>;
```

Double-quoted keys, optional trailing newline, nothing else in the file. Readers additionally accept a JavaScript object literal as the right-hand side — bare keys, single quotes — evaluated in a sandbox with a stubbed `window` and a short timeout. `window.DASHBOARD_DATA` is **not** A2: a reader accepts it and reports the document as degraded. Write-strict, read-tolerant: every fixture carries a `strict_a2` flag recording which of the two forms its file is.

The schema validates the parsed object: `generated`; `task {title, type, status, description, path, current_activity}`; `characteristics`; `phases[] {id, name, icon_hint, status, started, completed, skip_reason, summary, decisions, risks, artifacts, gate}`; `verification {status, issues[], fixes[], reverify_count}`.

**Rules**:
- **Severity.** Writers emit `critical`, `warning` or `info`. Readers additionally accept `high`, `medium`, `low` and `resolved` and report the document as degraded — the schema enum carries all seven, the writer lint allows three.
- **Resolved risks.** The writer form is a `resolved:` prefix. A mid-string `/\(resolved\b/i` marker is read and counted as resolved.
- `fixes[]` and `decisions[]` entries are either a string or an object.
- `phases[].icon_hint` is an enum of seven, canonical in the schema. A writer picks the closest member; it never invents a value.

The `dashboard.html` asset that renders this data is pinned in § A4.

## 6. Project config — `.maister/config.yml` (A3)

An open map, read once at initialization. An absent file is the default configuration; an absent key is that key's default. This section is the only definition: the patterns reference keeps its table and the init skill keeps its scaffold, and both cite here.

| Key | Type | Default | Effect |
|---|---|---|---|
| `html_output` | bool | `true` | false disables every HTML companion |
| `mockup_format` | enum `html\|ascii` | `html` | selects the mockup rendering path |
| `repo_id` | string | absent | stable identity for a repository across workspaces |

Unknown keys are preserved. The config is never rewritten by a workflow.

## 7. Task-directory layout and artifact paths (A4)

Everything a workflow produces lives under `.maister/tasks/<type>/<YYYY-MM-DD-slug>/`. Type dirs are `development/`, `performance/`, `migrations/` (plural), `research/`, `product-design/`.

**Generic task root** — present in every workflow:

```
<task-root>/
  orchestrator-state.yml     # A1
  dashboard.html             # fixed asset, MD5 pinned below
  dashboard-data.js          # A2
  gates/                     # E2, chain runs only
  dispatch/                  # C2 envelopes, dispatching runs only
```

**Umbrella root** — present only in a workspace initialized as an umbrella:

```
.maister/umbrella.yml                  # C1
.maister/umbrella/runs/<uuid7>/        # one directory per chain run
.maister/umbrella/ledger/entries/      # C3, one file per dispatch
.maister/umbrella/ledger/index.yml     # C3, regenerated whole
.maister/umbrella/ledger/ledger.log    # C3, append-only
.maister/umbrella/outbox/<dispatch_id>/ # C4, one directory per dispatch
```

**Per-workflow subdirectories:**

| Workflow | Subdirectories |
|---|---|
| development | `analysis/` (`research-context/`, `design-context/` with `mockups/`, `ascii/`, `design-resources.md`, `brief.md`, `external-links.md`, `INDEX.md`), `implementation/`, `verification/`, `documentation/` |
| research | `planning/`, `analysis/` (`findings/`, `synthesis.md`), `outputs/` |
| product-design | `context/`, `analysis/` (`mockups/`), `outputs/` |
| performance | `analysis/` (`user-profiling-data/`), `implementation/`, `verification/` |
| migration | `analysis/`, `implementation/`, `verification/`, `documentation/` |

**Companion pairs** — each markdown artifact below has an `.html` sibling written by the same agent at the same time:

| Markdown | Written by |
|---|---|
| `implementation/spec.md` | specification-creator |
| `implementation/implementation-plan.md` | implementation-planner |
| `verification/implementation-verification.md` | implementation-verifier |
| `verification/e2e-verification-report.md` | e2e-test-verifier |
| `verification/visual-fidelity.md` | e2e-test-verifier |
| `outputs/research-report.md` | research-synthesizer |
| `outputs/solution-exploration.md` | solution-brainstormer |
| `outputs/high-level-design.md` | solution-designer |
| `outputs/decision-log.md` | solution-designer |
| `analysis/alternatives.md` | solution-brainstormer |
| `analysis/design-decisions.md` | html-companion-writer |
| `analysis/feature-spec.md` | html-companion-writer |
| `outputs/product-brief.md` | html-companion-writer |

**`dashboard.html` MD5**: `c45365ee20c4875a63fd063d977aff41`

The dashboard page is a maintained plugin asset, copied into every task dir and never model-generated. The suite asserts that this constant, the asset itself and every run fixture's recorded hash are the same value.

**Rules**:
- **Enumeration**: a child of a type dir is a task dir when its name matches `^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$` and it is a directory. Everything else under a type dir — a `README.md`, a stray `notes.txt` — is a non-task child and is ignored by enumerators.
- **Floor**: an enumerated task dir is at the floor or an inventory row, per § 2. Nothing in between.
- **Unregistered task-root files are ignored.** A file at the task root that this register does not list (an ad-hoc `SUMMARY.md`) is invisible to enumerators and to the A5 lint.
- **Dot-prefixed paths are non-contractual.** `.archive/`, `.mockups.json` and anything else beginning with a dot carries no contract and is never enumerated.
- **Mockups** live at `analysis/mockups/*.html` (any slug) and `analysis/design-context/mockups/*.html`. The glob is the contract; the sibling `INDEX.md` binds names to files.
- **Artifact paths are task-root-relative**; `task_path` in the state is **repo-root-relative**.
- **A relative path never escapes its root.** Wherever `common#/$defs/rel_path` is referenced, a leading slash and any `..` segment are refused. This is a tightening rather than an addition: the only document it turns from valid into invalid is one naming a directory outside the root its field is relative to, which no writer was ever scoped to.
- **Reserved path** (C6, month 2): `gates/<node>.answer.<actor>.yml`. Listed here, written by nothing at v1, validated by nothing.

## 8. Artifact summary block (A5)

Every registered artifact opens with a positional block. It is positional, not keyword-matched: the first other `## ` heading ends it.

Every line of the block below is indented by two spaces so that an outline tool
reading this file does not mistake the illustration for four sections of it. On
disk the headings start at column 1.

```markdown
  # Title                          (optional)
  **Task** · **Date** · **Status** (optional preamble, no `## ` heading)
  ## TL;DR                         (required; 1-5 non-empty lines)
  ## Key Decisions                 (optional; bullets)
  ## Open Questions / Risks        (optional; bullets)
  ## <anything else>               (ends the block)
```

**Rules**:
- Readers tolerate both spellings of the third heading; writers emit the slash form. `## Open Questions / Risks` is the writer form, `## Open Questions & Risks` is read and reported by the writer lint.
- A TL;DR of zero or more than five non-empty lines is a failure: past five lines it stops being the summary an operator reads first.
- A block that appears after another `## ` section is not a summary block at all — the artifact has none.
- **The lint walks registered A4 paths only.** Exempt registered paths: `work-log.md`, `README.md`, `INDEX.md`, `coordinator-handoff.md`, `design-resources.md`. Exempt by kind: `orchestrator-state.yml`, `dashboard-data.js`, raw mockups, screenshots.

## 9. Timestamps (A6)

`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, and never `T00:00:00Z` — midnight is the signature of a date that was formatted rather than measured, so the pattern lives in the schema and the midnight rule is a separate lint.

**Field-path list**: `orchestrator.created`, `orchestrator.updated`, `orchestrator.gate_pending.since`, `phases[].started`, `phases[].completed`, `generated`, `asked_at`, `answer.at`, `workflow.nodes.*.started`, `workflow.nodes.*.completed`, and the C-series `created` / `updated` / `at` (including the `ts` field of a `ledger.log` line).

**Exempt**: the task-directory name prefix, and every other date embedded in a path. The exemption is the field-path list itself — no path-valued key is on it.

## 10. Workflow grammar — definition, state block, node summaries (B1/B2/B3)

**B1 — definition and overlay.** `name`, `version` (const 1), `inputs`, and `nodes` keyed by node id (`^[a-z][a-z0-9-]{1,40}$`). A node carries `uses`, `type`, `needs[]`, `with`, `outputs`, `when`, `dir`, `provider`, `ask`, `options`, `on`, `optional`. Cycle detection and reference resolution are runner logic, not schema keywords. An overlay carries `extends` (`builtin:<name>` or a path), `version`, `add`, `tune`, `disable[]`, `profiles`.

**Rules**:
- A gate node (`type: gate`) has no `uses`, exactly one option whose effect is `continue`, and at least one `stop`.
- The node-id set of a built-in workflow is a public API: a rename is a deprecation carrying an alias for at least two releases.
- Reserved keys (§ R) parse, warn and do nothing.

**B2 — the `workflow:` block in state.** `source`, `overlays[]`, `profile`, `graph_hash` (`^sha256:[0-9a-f]{64}$`), `grammar_version` (const 1), and `nodes` keyed by node id with `status` in `pending|running|suspended|completed|failed|skipped|stopped`. **Every entry occupies exactly one line** — see § E2. The one-line rule is text-level and checked by the suite, not by a schema keyword.

**B3 — `node_summaries` entry.** The `phase_summaries` value shape (§ A1), with an optional `status` on the entry form. `node_summaries` and `phase_summaries` never diverge: one alias, one shape.

## 11. Driver — `orchestrator.driver` (E1)

```yaml
driver: {kind: cockpit, cwd: /abs/umbrella, session: {id: "…", name: "…", provider: claude, model: "…"}}
```

**Rules**:
- An absent `driver` block means a terminal session. That is the default and always will be.
- `kind` is `terminal`, `cockpit` or `dispatch`. `cwd` is absolute and required whenever `kind` is not `terminal`.
- `session` is optional; its `id`, `name`, `provider`, `model` and `status` are all optional inside it.
- The engine writes the block at init. **The daemon rewrites `driver.session` before any re-spawn; the engine never edits it.** Resume is cwd-coupled on both providers, so a moved or copied run dir is re-entered only by a new session.

## 12. Gate protocol (E2)

Three files, one commit point.

**The one-line form.** Under `orchestrator:` the key `gate_pending` occupies exactly one line:

```yaml
  gate_pending: null
  gate_pending: {node: <id>, request: gates/<id>.request.yml, since: "<timestamp>"}
```

A flow map, keys in any order, scalars bare or double-quoted, no nesting. **The line carries the value and nothing else — a trailing `#` comment after the flow map makes it unparseable and the hook fails closed**, so emitters write `gate_pending: {…}` bare. Under `workflow:` → `nodes:`, every entry is one line `    <id>: {…}`. Any other shape under either key is a hook deny carrying an instructive reason. `answer:` in a request file is either the literal line `answer: null` or a map introduced by `answer:`; a reader treats "the line `answer: null` is present" as unanswered.

**One line, not one column.** The rule is about the *value* being on one line. `gate_pending` is whatever direct child of `orchestrator:` carries that name, and `nodes:` whatever direct child of `workflow:` does, at whatever indent the emitter chose — the reader finds them by structural position. A key that is present but not on one line, including one nested below its block's own child level, is a deny, never a shrug.

**Below the floor there is no gate.** A state file with no `orchestrator:` block is below the compatibility floor (§ 2): it is an inventory row, it is never resumed, and it never gates. Truncation *within* an `orchestrator:` block is a different thing and fails closed — a valid-but-truncated state must never fail open.

**The allow-list is a list of names, not a glob.** While a run waits on an operator, the files the engine may still write in that run directory are exactly: `orchestrator-state.yml`, `gates/index.yml`, `dashboard-data.js`, `dashboard.html`, `gates/<node>.request.yml` for each pending node, and the temp twin of each whole-file rename — `orchestrator-state.yml.tmp` and `gates/<node>.request.yml.tmp`, spelled with that exact suffix. No other `*.tmp` is engine-owned: `notes.tmp` is denied like any other file.

**Rules**:
- **Write order is enforced, and it is the order inside one `gate-request` call**: request file (temp file, then rename) → `gate_pending` plus `status: suspended`; the dashboard is rewritten after that call returns. The order is normative and the single call is what makes it reachable — an unanswered request file already reads as pending, so a marker written by a second shell call is denied and the run wedges at a gate nothing recorded.
- **The commit point is `gate_pending: null`, written last.** A decision is recorded across two to four edits and readers tolerate every intermediate shape — `node_summaries.<node>` present while `gate_pending` is still set is normal.
- **The request file is a second signal.** An unanswered `gates/*.request.yml` with no matching `gate_pending` is treated as pending. A valid-but-truncated state file must never fail open.
- A request carries `version`, `run_id`, `node`, `kind` (`gate|decision|convergence`), `asked_at`, `question`, optional `context`, `options[]` with unique ids, the multi-choice flag, and `answer`. **The multi-choice flag key is spelled only in `gate.schema.json` and in fixtures** — prose everywhere calls it "the multi-choice flag". The suite lints every fixture for hyphenated spellings in key position.
- Option ids must be unique: an answer records an id, not a label.
- In terminal mode the gate is asked with the in-session question tool and the request file is optional. In `cockpit` and `dispatch` mode the request file **is** the question and the session ends its turn.
- `gates/index.yml` lists one entry per request (`node`, `request`, optional `sub_run`, `kind`, `asked_at`, `status`).

## 13. Coordination contracts (C1-C8)

| Id | Shape | Rules |
|---|---|---|
| C1 | `.maister/umbrella.yml` | `version: 1`; `members` is a map from member name to `{path, kind, default_provider, autonomy}`; additive — the branch convention, coordination block, tracker, git host and per-person member list are one such addition; `routing.tiers` reserved ; `attended` denies push, merge and pull-request creation as a **relay point** — the action is held for an operator to approve — while an auto tier has no operator and its denials are final |
| C2 | dispatch envelope | `version: 1`; additive; `autonomy` is a closed enum; `statement` is the work in one line, resolved override → `with.statement` → `with.task` and null when the node carried none; `workspace_root` is the absolute umbrella root, so a worker whose working directory is a worktree inside a member repo — often reached through a symlink out of the workspace — can still anchor every other path in the document; both are optional, and a reader that knows neither still reads the document. `closeout_contract.pr_required` is derived from the tier, never asserted: `attended` and `auto-high` reach a pull request, `auto-low` and `auto-medium` cannot |
| C3 | ledger entry, ops, log | `version: 1`; the seven op names `create-entry`, `claim`, `update-status`, `add-constraint`, `add-followup`, `close-out`, `query` are a closed set; a log line is `ts op dispatch_id actor` |
| C4 | outbox message | `version: 1`; one `type` per file; append-only, never rewritten |
| C5 | stdout markers + outcome | marker and prompt vocabularies are fixed regexes; the outcome rule is below |
| C6 | coordination branch | `COORDINATION.md` `version: 1`; an orphan branch, mounted as a worktree, never merged, single-writer; `runs/<uuid7>/`, `ledger/events/`, `outbox/`, `archive/`. Path register only — no document schema at v1 |
| C7 | event | `version: 1`; files are immutable and folded in `at` order; `mirror` event data is T1 (`{tracker, event_ref, key}`) |
| C8 | worker seed | `version: 1`; the five section ids `identity`, `task`, `outbox`, `closeout`, `siblings`, their order and the 60-line cap are frozen; each section opens with its marker line and the wording under it is free; a descriptor that would render over the cap is refused, never truncated |

**C2 enforcement rule.** `permissions` is **data, and the layer that spawns the worker owes its enforcement.** Nothing in the runtime enforces it: the runtime does not spawn, so it never sees the process to constrain. A spawner translates the denied atoms into the provider's own permission surface before the seed is delivered — verbatim on Copilot, whose tool vocabulary the atoms are (`--deny-tool='shell(git push)'`); by removing the tool, or by a `PreToolUse` gate, on Claude. **An argument-prefix rule such as `Bash(git push:*)` is not an enforcement mechanism** — it matches command text, so a flag before the subcommand, a compound command or a hook that rewrites the command defeats it. A spawner that cannot enforce a tier does not dispatch at it. The seed's close-out prose assumes the denial is real, so an unenforced tier does not merely fail to stop a worker: it tells the worker it will be stopped.

**C5 outcome rule.** A run's outcome is derived in this order and no other:

1. **On-disk E2 state** — `gate_pending` and the `gates/` directory as they are on disk after the process exits.
2. **The last non-empty assistant line**, matched against the marker vocabulary (`GATE-PENDING: <node>`, `RUN-COMPLETE`, `RUN-FAILED: …`, `WAITING-DISPATCH`, `GATE-ALREADY-ANSWERED`, `GATE-INVALID: …`, `DISPATCH-RESULT: …`, `DISPATCH-FOLLOWUP: …`).
3. **Denials** — the provider's recorded permission denials and hook-end events.

**The process exit code is never consulted.** Both providers exit 0 for a failed run, a denied tool and a blocked stop, so an exit code carries no information about the run. A marker is advisory: on-disk state outranks it.

## 14. Hook payload floors (H1)

| | Claude Code | Copilot CLI |
|---|---|---|
| Version floor | 2.1.233 | 1.0.80 |
| Events | `PreToolUse`, `Stop`, `SessionStart` | `preToolUse`, `agentStop`, `sessionStart` |
| Registration | `--settings <file>` on every spawn and resume; nothing persists in the session | `.github/hooks/<name>.json` in the repository, or `~/.copilot/hooks/` which always fires |
| Enablement | none required | `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` or `COPILOT_ALLOW_ALL=true` **in the environment** — a flag does not count |
| Payload keys | `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, plus `tool_use_id`, `prompt_id`, `agent_id`, `agent_type` | `sessionId`, `timestamp`, `cwd`, `toolName`, `toolArgs` (**a JSON string**) |
| Stop payload adds | `stop_hook_active`, `last_assistant_message` | `transcriptPath`, `stopReason`, `stop_hook_active` |
| SessionStart adds | `source` | `source` (`new\|resume`), `initialPrompt` |
| Deny response | `{hookSpecificOutput: {hookEventName, permissionDecision: "deny", permissionDecisionReason}}` | `{permissionDecision: "deny", permissionDecisionReason}` — no envelope |
| Stop block response | `{decision: "block", reason}` | `{decision: "block", reason}` — advisory only; this provider cannot enforce a stop |
| Fail-closed exit | exit **2**, with the reason on stderr | exit **0** with a deny on stdout; a non-zero exit here is a bug |
| Timeout default | 10 minutes | 30 seconds |

**Rules**:
- **A policy deny is not a fail-closed exit.** An unknown tool name while a gate is pending is a *policy* decision: deny JSON on stdout and **exit 0 on both providers**. The fail-closed exits above are reserved for the runner being unable to decide at all — an internal error, or an unparseable state file.
- **The hooks own no deadline, because they cannot hang.** Each hook body is synchronous and ends in `process.exit`: it opens no socket, spawns no process and awaits nothing. Its only I/O is a bounded `readdirSync` over the three A4 directory levels and one `readFileSync` per run state and request file. A timer could therefore only fire after the decision had already been made, so there is none, and the provider's own timeout is the sole backstop for a filesystem that stalls. Anything a hook cannot decide it denies immediately.
- **A state file with no `orchestrator:` block never gates** (§ E2): it is below the floor, so it is an inventory row rather than a run, and a gate can be pending only in a run.
- **Default-deny unknown tool names** while a gate is pending. Models route around single-tool denies, so the match list is "everything that is not explicitly allowed".
- **A stop is never failed closed.** A stop hook blocks only for "a gate node is running with no request file", respects the provider's repeat-block cap and its active flag, and otherwise allows.
- **Beacon required.** The daemon trusts a driver session only after that session's start hook has written its liveness beacon. The beacon lives outside the consumer tree.
- Payload keys are provider-owned and additive. The floors pin what the captures prove; a provider adding a key is not a contract change.

## 15. Reserved keys (R)

Eight keys parse today, warn once, and carry no behaviour until a later version claims them. A reader emits `reserved-key:<path>` per occurrence and continues.

| Reserved | Where | Claimed by |
|---|---|---|
| `foreach` | node | fan-out execution |
| `loop` | node | retry-until execution |
| `assertions` | node | post-node validation |
| `validation` | node | post-node validation |
| `session.substrate: cloud` | node | remote execution substrate |
| `mirror.scope: followups` | definition root | tracker mirror scope (T1) |
| `backing: tracker` | definition root | tracker-backed state |
| `routing.tiers` | umbrella manifest | dispatch routing |

The canonical list is `workflow-definition.schema.json#/$defs/reserved` — a `const` array, so the register and the schema cannot disagree.
