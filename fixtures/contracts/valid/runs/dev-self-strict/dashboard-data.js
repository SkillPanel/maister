window.MAISTER_DATA = {
  "generated": "2026-08-25T23:01:38Z",
  "task": {
    "title": "v3 task 1+2 - Layer-0 contract freeze + gate-enforcement hooks + eval harness",
    "type": "development",
    "status": "in_progress",
    "description": "Freeze Layer-0 contracts (doc, schemas, golden fixtures, compat suite, contracts-v1 tarball), gate-enforcement hooks for Claude Code + Copilot CLI, eval harness, plugin decision log, rot fixes.",
    "path": ".maister/tasks/development/2026-08-25-v3-layer0-contracts-and-gate-hooks",
    "current_activity": "Executing implementation"
  },
  "characteristics": {
    "risk_level": "medium-high",
    "compatibility_floor": "2.2.3",
    "has_reproducible_defect": false,
    "modifies_existing_code": true,
    "creates_new_entities": true,
    "involves_data_operations": true,
    "ui_heavy": false
  },
  "phases": [
    {
      "id": "phase-1",
      "name": "Analyze codebase & clarify requirements",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-25T18:07:05Z",
      "completed": "2026-08-25T19:25:59Z",
      "skip_reason": null,
      "summary": "Prose plugin with zero test surface; contracts A1-A6 exist as prose but diverge from real 2.2.3 dirs in 18 places; A4 lost its normative home; spike hook prototypes ship banned deps and fail open; Copilot build deletes hooks; session-start reminder contradicts gate-suspend. Complexity complex, risk medium-high.",
      "decisions": [
        {
          "decision": "Freeze A1 as three layers (strict core + open per-workflow `$defs` + shared `phase_summaries` entry), additive-only, unknown keys preserved",
          "rationale": "the real files freely add run-specific keys under `[domain]_context`; a closed schema fails against every existing task dir."
        },
        {
          "decision": "Split the human/LLM register (`layer0-contracts.md`, <=600 lines) from machine schemas (JSON Schema 2020-12 files beside it)",
          "rationale": "`.claude/rules/plugin-authoring.md` caps code examples at 10 lines and the reference at 600-800; inline schemas would breach both."
        },
        {
          "decision": "Freeze `dashboard-data.js` as `window.MAISTER_DATA = <strict JSON>;` (one statement)",
          "rationale": "the corpus has two serializations (quoted vs bare keys); mandating JSON body costs nothing (the current task's file already does it) and makes the cockpit parser trivial."
        },
        {
          "decision": "Normalize the A5 heading to `## Open Questions / Risks` (slash form) everywhere",
          "rationale": "every real artifact and 13 producing agents use it; Sec. 3, Sec. 8, all 5 SKILL.md \"Operator Visibility\" rules and `html-companion-writer.md` say `&`. Fixtures cannot be written until this is settled."
        },
        {
          "decision": "Re-home the deleted `plugins/maister/CLAUDE.md` \"Base Task Structure + Naming Conventions\" into `layer0-contracts.md` as a path-pattern register",
          "rationale": "A4 has no accurate normative home at HEAD; `docs/workflows.md:217-247` (its redirect target) is stale (`analysis/visuals/`, no dashboard files)."
        },
        {
          "decision": "Ship hooks as pure bash + `jq` + a zero-dep Node state reader (mockup-studio precedent); no python3",
          "rationale": "spike rule 5 bans PyYAML; `jq` is already an undeclared production dependency of `block-destructive-commands.sh`."
        },
        {
          "decision": "Copilot hooks are a purpose-built tree emitted by `build.sh`, not a sed of the Claude scripts",
          "rationale": "payload keys (`toolName`/`toolArgs`-as-string), response vocabulary (no `hookSpecificOutput`), and `apply_patch` parsing all differ."
        },
        {
          "decision": "**Reuse the prior half-run task dir's Phase 1 output** (`.maister/tasks/development/2026-08-25-maister-v3-platform-and-gui/analysis/{codebase-analysis.md (632), gap-analysis.md (270)}`) - same ground, quoted A1-A5 schemas at `codebase-analysis.md:199-330`; do not re-derive.",
          "rationale": ""
        },
        {
          "decision": "Fixtures at repo-root `fixtures/layer0/`",
          "rationale": "nothing at runtime reads them; keeps them out of the Copilot build's `cp -r` + md-sed path; the tarball is built from that directory."
        },
        {
          "decision": "Sample from real projects, once",
          "rationale": "latest complete >= 2.2.3 run per workflow type: `map` (development, research, performance, migration, product-design) and `repo-beta` (development, product-design, research); one state file + one `dashboard-data.js` + a few artifact md samples per run. Pseudonymization is a **full one-off pass at copy time** (org/product names, `ACME-xxxx` ids, people/emails, hostnames/URLs, business-domain nouns -> neutral equivalents; keys/enums/paths/timestamps untouched); replacement table recorded in the untracked work-log; user reviews the diff before commit. No script - future fixture sets come from synthetic runs on the fixture umbrella."
        },
        {
          "decision": "Compatibility floor = plugin 2.2.3 (option C, spec Sec. 10.7)",
          "rationale": "no legacy-type fixtures (`bug-fixes/`, `new-features/`, ...), no pre-2.2 parsing or resume; older dirs are listed by directory name/date/type only."
        },
        {
          "decision": "Runner deps: root `package.json` with `ajv` + `yaml` as devDependencies",
          "rationale": "dev-only; shipped hooks stay pure bash + `jq` (+ zero-dep node if a state reader is needed); the cockpit reuses the same validator."
        },
        {
          "decision": "**CI: new `test.yml` on push/PR for all branches (`make test`) + `contracts.yml` on `contracts-v*` tags** building the fixture tarball as a release asset; eval harness is local-only (`make eval`, needs authenticated CLIs).",
          "rationale": ""
        },
        {
          "decision": "Rot scope: 6a + 6d + 6e + reminder qualifier",
          "rationale": "restore the corrupted gate markers (5 orchestrators + checklist), fix Sec. 4 Extension-Pattern table and option keys, add the \"task tools unavailable -> state file is the sole tracker\" fallback, qualify the session-start/post-compact \"AskUserQuestion at every gate\" rule by `driver.kind` (terminal vs cockpit). 6b, 6c and the 6f Playwright tool names go to task 13."
        }
      ],
      "risks": [
        "**Where `fixtures/layer0/**` lives.** Task text says `plugins/maister/fixtures/layer0/**`; feature-spec `:445` says only \"shipped in the plugin repo\"; Context Discovery read it as repo-root. Anything under `plugins/maister/` is copied verbatim into the committed `plugins/maister-copilot/` by `build.sh:19` (`cp -r`), and every `*.md` inside is sed-mutated (passes 4 and 7). Options: (a) `plugins/maister/fixtures/` + add `rm -rf \"$OUT/fixtures\"` beside `build.sh:20`; (b) repo-root `fixtures/`; (c) accept duplication (spike captures alone are 6.3 MB). Golden bytes must be `.yml`/`.json`/`.js`/`.jsonl`, never `.md`, in any option.",
        "**devDependencies (`ajv`, `yaml`) vs zero-dep.** No `package.json` has ever existed. (a) Add a root `package.json` with exactly two devDependencies - precedent-setting but the cockpit repo will use `ajv` anyway and a hand-rolled validator will itself drift; (b) stay zero-dep with a ~150-line subset validator plus a shell-out for YAML->JSON. Code Analysis recommends (a); Context Discovery and Pattern Mining lean zero-dep for anything that *ships* (runtime hooks), which is compatible with (a) if the dependency is dev-only.",
        "**`contracts-v1` tag vs the `v*` release trigger, and CI not running on `feature/v3`.** `release.yml:4` is `tags: ['v*']`; `build-copilot.yml:4` is `branches: [master, v2]`. A `contracts-v1` tag fires nothing and no job runs on this branch. Options: rename the tag (`v3.0.0-contracts.1`), widen the trigger, or add `.github/workflows/contracts.yml` + `test.yml` on `push`/`pull_request` for all branches.",
        "**Qualifying the session-start \"AskUserQuestion at every gate\" rule by `driver.kind`.** `skill-invocation-reminder.sh:7`, `post-compact-reminder.sh:15`, and `CLAUDE.md` \"Non-obvious behaviors\" all say the rule is unconditional; feature-spec Sec. 3.1 says cockpit-driven runs must *not* call `AskUserQuestion` (write `gates/<node>.request.yml`, set `gate_pending`, print `GATE-PENDING:`, exit). Without a qualifier the model is told to ask while the PreToolUse hook denies every write until it writes a request file. Three places to edit in lockstep.",
        "**`make validate`'s `multi.select` regex vs the spec's `multi_select` key.** `Makefile:10` greps `multi.select` case-insensitively under `plugins/maister-copilot/skills/`; `.` matches `_`, so any skill prose quoting the E2 request-file key `multi_select: false` fails validate, while `build.sh:44-51` does not rewrite it. Either tighten the regex to `multi-select|multiselect|multiSelect` or keep the key out of `skills/**/*.md` (schemas live in non-md files anyway).",
        "**The deleted `plugins/maister/CLAUDE.md` leaves A4 without a normative home.** Root `CLAUDE.md` redirects \"task directory layout\" to `docs/workflows.md`, which is stale. Decision: re-home into `layer0-contracts.md` (recommended) or restore a section in `orchestrator-patterns.md` Sec. 5.",
        "**Reuse of the prior half-run task dir** `.maister/tasks/development/2026-08-25-maister-v3-platform-and-gui/` (Phase 1 complete: codebase-analysis, gap-analysis, clarifications, scope-clarifications, platform facts). Reuse as an input and mark it superseded, or leave it as an orphan.",
        "**Fail-closed gate hook + fail-closed Stop hook deadlocks the session** (~150 s / 8 turns, measured in spike-c). Stop hooks must be nudges only (rule 7); the harness must assert this.",
        "**Golden fixtures for `performance_context`, `migration_context`, `.maister/config.yml`, `work-log.md`, `spec-audit.md`, `documentation/*`, and any `status: skipped|failed` phase must be synthesized** - zero real samples exist in this repo.",
        "**The global `-> Pause` find/replace already corrupted all five orchestrators and the checklist** (rot 6a). Any bulk substitution this task performs (heading normalization, marker rename) must be reviewed file by file.",
        "**Copilot repo hooks are silently inert in `-p` mode** without `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` or a trusted folder, and Copilot resolves the hooks dir from the git root, not `--plugin-dir` - the emitted `.github/hooks/maister-gates.json` inside `plugins/maister-copilot/` is a *template*, never auto-loaded.",
        "**Claude hook timeout, `exit 1`, garbage stdout, and missing/non-exec script are all fail-open.** The gate hook must emit deny-JSON *and* `exit 2` via `trap`, with an internal deadline below the harness `timeout`.",
        "**`.claude/rules/plugin-authoring.md` is path-scoped to `plugins/maister/**`** - its \"code examples <=10 lines / references conceptual\" rules will auto-load against fixtures and hook scripts and needs a carve-out.",
        "**`jq` is an undeclared runtime prerequisite** (`README.md:23` lists only Claude Code); a missing `jq` must itself yield deny + exit 2, not a silent allow.",
        "Whether Copilot honours `~/.copilot/hooks/` for the gate hook when spawned by the daemon without a trusted folder - the harness verifies this in Phase 8.",
        "Pseudonymized fixtures must still parse byte-for-byte against the schemas; the replacement pass must not touch keys, enums, paths or timestamps."
      ],
      "artifacts": [
        {
          "path": "analysis/codebase-analysis.md",
          "label": "Codebase analysis",
          "html": null
        },
        {
          "path": "analysis/clarifications.md",
          "label": "Clarifications",
          "html": null
        }
      ],
      "gate": {
        "question": "Phase 1 clarifications (fixtures home/sampling/pseudonymization, compatibility scope, runner deps, CI & tagging, rot scope)",
        "answer": "repo-root fixtures from map+acme-portal (full one-off pseudonymization); floor 2.2.3 (option C); ajv+yaml devDeps; test.yml + contracts.yml; rot 6a+6d+6e+reminder"
      }
    },
    {
      "id": "phase-2",
      "name": "Analyze gaps & clarify scope",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-08-25T19:25:59Z",
      "completed": "2026-08-25T20:32:07Z",
      "skip_reason": null,
      "summary": "Every deliverable is net-new except the hook/build/CI/prose surfaces it amends; fixture-seed survey: strict-JSON A2 fails 9/10 real files, external product-design run non-conformant, no >=2.2.3 performance/migration run; verified fail-open defect in block-destructive-commands.sh on quoted commands. 2 critical + 6 important decisions.",
      "decisions": [
        {
          "decision": "`has_reproducible_defect = false` - rot 6a and the destructive-guard JSON bug are both deterministic and greppable/replayable, but neither has a runtime behaviour a Phase-3 TDD gate could exercise before the compat suite exists; they become red-first acceptance criteria inside the compat-suite task group instead of triggering the defect phases.",
          "rationale": ""
        },
        {
          "decision": "`involves_data_operations = true` - fixtures, schemas and the tarball have a real lifecycle (sample -> pseudonymize -> review -> commit -> tarball -> tag -> vendor) with producer/consumer orphan risk; the CRUD table is adapted to that lifecycle rather than to runtime entities.",
          "rationale": ""
        },
        {
          "decision": "`change_type = additive`, `compatibility_requirements = strict` - every contract is additive-only from the 2.2.3 floor; the only behaviour-changing edits (hook registration, reminder qualifier, `build.sh` emission) are staged last.",
          "rationale": ""
        },
        {
          "decision": "Compat floor evidence is \"written by 2.2.4-beta.1\" - the installed plugin on this machine has been `maister@maister-plugins-beta 2.2.4-beta.1` since 2026-08-03 (the v2.2.3 tag date); every qualifying external run was written by it. The freeze must record the writer version per fixture and the beta delta must be diffed against Sec. 4/Sec. 8 before \"2.2.3\" is claimed.",
          "rationale": ""
        },
        {
          "decision": "A2 write-strict / read-tolerant",
          "rationale": "contracts-v1 mandates strict JSON for new writers; schema validates the parsed object; runner + cockpit also parse bare-key JS-literal bodies (9/10 real files); strict lint only for fixtures with writer >= freeze."
        },
        {
          "decision": "Product-design golden seed = `.maister/tasks/product-design/2026-08-25-maister-v3-platform-and-gui`",
          "rationale": "conformant, no client data; `acme-portal/.../2026-08-11-catalog-applications-ui` goes under `fixtures/layer0/tolerated/` as the non-conformant/inventory-only sample (drift #24)."
        },
        {
          "decision": "Development seeds",
          "rationale": "`repo-alpha/development/2026-08-11-acme-1001-my-progress-backend` (completed), `repo-alpha/development/2026-08-11-applications-module-catalog` (in_progress sample), `acme-portal/development/2026-08-12-catalog-applications-ui`; research from `repo-alpha/research/2026-08-10-applications-module-grounding` (+ the two in-repo research runs, no client data)."
        },
        {
          "decision": "**Performance + migration A1/A2 fixtures hand-synthesized** from `performance/SKILL.md` and `migration/SKILL.md` shapes, labeled `synthetic: true` in the manifest, replaced by the first real >= 2.2.3 run.",
          "rationale": ""
        },
        {
          "decision": "Stop nudge via `--settings` only",
          "rationale": "daemon sessions always pass it; the eval harness probes whether a plugin-registered `Stop` fires; a follow-up adds it to `hooks.json` if so."
        },
        {
          "decision": "Gate-hook state reader = bash + grep/sed/jq over a frozen single-line E2 form",
          "rationale": "E2 gains: `gate_pending` is `null` or one flow map on one line; `workflow.nodes.<id>` entries are one-line flow maps; any other shape under those keys -> deny with an instructive reason. No node on the Claude hook path."
        },
        {
          "decision": "Tarball = everything",
          "rationale": "schemas + `valid/` + `invalid/` + `tolerated/` + `synthetic/` + H1 payload fixtures + `manifest.json` (writer version, source, synthetic flag, pseudonymized flag per fixture) + SHA-256 checksum file."
        },
        {
          "decision": "Fix `block-destructive-commands.sh` now",
          "rationale": "deny JSON built with `jq -n --arg`; H1 replay gains a red-first case with a `\"`-containing command."
        }
      ],
      "risks": [
        "The A2 strict-JSON coordinator call contradicts the corpus (see Critical decision 1); fixtures cannot be copied until it is resolved.",
        "Rot 6a happened through a bulk substitution; this task performs three more (A5 heading, Sec. 2 marker rename, `AskUserQuestion` qualifier) - review file by file, and add a `make validate` lint for the corrupted pattern so it cannot recur silently.",
        "`plugins/maister/hooks/block-destructive-commands.sh:30-38` is verified fail-open: a Bash command containing `\"` yields invalid JSON on stdout (exit 0), which Claude treats as allow - the guard the new gate hook will sit beside is bypassable today.",
        "Claude consumers are not guaranteed to have `node`; if the gate hook requires it and fails closed on its absence, every write in every maister project is denied on such machines - the reader choice (Important decision 4) must keep `node` off the Claude hook path or fall back to a grep path.",
        "Synthetic performance/migration fixtures freeze shapes that only exist in `performance/SKILL.md:354-388` and `migration/SKILL.md:311-348` (the Sec. 4 table was fabricated - drift #2/#3); they are unverified against any real run until a real run replaces them.",
        "All qualifying external runs were written by `2.2.4-beta.1`, not `2.2.3` - record `writer_version` per fixture and diff the beta delta before naming the floor in `layer0-contracts.md`.",
        "8 new drift items (#19-#26) from the seed survey (`orchestrator.skipped_phases`, `orchestrator.type`, `task.key`, free-form `options`, serialization split, non-conformant PD run, `&`-form A5 headings in acme-portal artifacts, writer version) join the reconciliation table."
      ],
      "artifacts": [
        {
          "path": "analysis/gap-analysis.md",
          "label": "Gap analysis",
          "html": null
        },
        {
          "path": "analysis/scope-clarifications.md",
          "label": "Scope clarifications",
          "html": null
        }
      ],
      "gate": {
        "question": "Decision gate (2 critical + 6 important) + continue to Phase 5?",
        "answer": "A2 write-strict/read-tolerant; in-repo PD seed; acme-1001+catalog+acme-portal; perf/migration synthetic; Stop via --settings; bash+grep reader; tarball everything; guard fix now -> Continue to Phase 5"
      }
    },
    {
      "id": "phase-3",
      "name": "Write failing test (TDD Red)",
      "icon_hint": "code",
      "status": "skipped",
      "started": null,
      "completed": null,
      "skip_reason": "has_reproducible_defect=false",
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-4",
      "name": "Generate UI mockups",
      "icon_hint": "spec",
      "status": "skipped",
      "started": null,
      "completed": null,
      "skip_reason": "ui_heavy=false",
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-5",
      "name": "Gather requirements & create specification",
      "icon_hint": "spec",
      "status": "completed",
      "started": "2026-08-25T20:32:07Z",
      "completed": "2026-08-25T21:47:59Z",
      "skip_reason": null,
      "summary": "Spec (543 lines): 20-row contract register, drift #1-#26 reconciliation, 15 schemas, fixture sampling + pseudonymization procedure, hook behaviour/registration for both providers, compat suite T01-T28 (T22/T23 red-first), CI + Makefile + tarball, 11 eval scenarios incl. 2 probes, ADR-0001..0007, file:line rot edits. Revised 2026-08-26 per audit (C1 + W1-W9 + info): 584 lines, revision log appended.",
      "decisions": [
        {
          "decision": "Beta delta is shape-neutral -> floor is 2.2.3 in fact",
          "rationale": "`git log v2.2.3..beta -- plugins/maister/` is one version-bump commit; every 2.2.4-beta.1-written fixture is a 2.2.3 shape; `writer_version` is still recorded per fixture."
        },
        {
          "decision": "One hook implementation, two vocabularies",
          "rationale": "`hooks/gate-enforce.mjs` detects `tool_name` (Claude) vs `toolName` (Copilot) from the payload; `build.sh` copies the same `.mjs` files into `.github/hooks/`; no sed, no second implementation."
        },
        {
          "decision": "Schemas are the writer contract; readers degrade",
          "rationale": "`valid/` must pass, `invalid/` must fail at the expected path, `tolerated/` must fail the schema but parse in the tolerant reader (what the cockpit's inventory/degraded path does). Enums are strict for writers; unknown top-level keys are always preserved."
        },
        {
          "decision": "`gate_pending: null` is the only fast path",
          "rationale": "a state file without the key is a v2 dir; the key present but neither `null` nor a one-line flow map is a deny. Read-only tools never spawn Node on the plugin path (matcher scoped to mutating tools); the `--settings` path matches every tool and allow-lists read-only names in the hook."
        },
        {
          "decision": "**Beacon and Stop nudge are chain-mode-only registrations** (`--settings` file + Copilot `maister-gates.json`), never in the plugin `hooks.json` - a terminal user of a 2.2.3 project sees zero behaviour change except the qualified reminder text.",
          "rationale": ""
        },
        {
          "decision": "E1 `driver.kind` gains `dispatch`",
          "rationale": "FS Sec. 4.3 already spawns workers with `--driver=dispatch`; the reminder rule keys on \"absent or `terminal` -> ask in-session; anything else -> request file\"."
        },
        {
          "decision": "ADR count stays at seven",
          "rationale": "A2 write-strict/read-tolerant folds into ADR-0006 (compatibility), devDependencies + fixture home into ADR-0007 (runtime + homes); GUI-ADR-006's fail-open doctrine is superseded inside ADR-0001."
        }
      ],
      "risks": [
        "`${CLAUDE_PLUGIN_ROOT}` expansion inside exec-form `args` is undocumented; if the eval probe fails, `hooks.json` falls back to shell form `command: \"node \\\"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.mjs\\\"\"` (same script, same tests) - the planner must keep that switch to one line in `hooks.json`.",
        "A Claude consumer without `node` gets a silently skipped hook (fail-open by platform); only the beacon makes this visible, and only chain mode requires the beacon. Accepted and documented (ADR-0007).",
        "Registering the gate hook in both `hooks.json` and the `--settings` file runs it twice per mutating call on daemon-spawned sessions (~2 x 50 ms); idempotent, first deny wins; measured by the harness.",
        "Whether Copilot honours `~/.copilot/hooks/` for daemon spawns without a trusted folder is verified only by the harness scenario `copilot-user-hooks`; if it fails, the daemon must install into the consumer git root.",
        "Pseudonymization is manual; the compat suite is the only proof the copies still validate. Task-dir names and `task_path` values are pseudonymized too (they carry tracker ids and domain nouns) but keep the A4 shape."
      ],
      "artifacts": [
        {
          "path": "implementation/spec.md",
          "label": "Specification",
          "html": "implementation/spec.html"
        },
        {
          "path": "analysis/requirements.md",
          "label": "Requirements",
          "html": null
        },
        {
          "path": "analysis/technical-clarifications.md",
          "label": "Technical clarifications",
          "html": null
        }
      ],
      "gate": {
        "question": "Specification complete. Continue to Phase 6: specification audit?",
        "answer": "Yes, run the audit"
      }
    },
    {
      "id": "phase-6",
      "name": "Audit specification",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-08-25T21:47:59Z",
      "completed": "2026-08-25T22:10:54Z",
      "skip_reason": null,
      "summary": "Spec audit: pass-with-concerns - 1 critical (A1 schema must allow phase_summaries.clarifications as decision_item[]), 9 warnings (PD dashboard is bare-key not strict; beacon dir untracked in consumer repos; Copilot exit-2 drops the reason; pseudonymization classes miss code identifiers/usernames/branches; --no-hooks undefined; manifest expect fields; orchestrator prose stays terminal-only; Makefile:10 tightening is a prerequisite), 13 info.",
      "decisions": [
        {
          "decision": "Critical is reserved for \"spec followed literally -> exit criterion fails and the fix needs a contract decision\"; the strict-JSON mislabel is a warning because it is a manifest flag, not a shape.",
          "rationale": ""
        },
        {
          "decision": "Line-number drift of <= 4 lines with unambiguous context is info, not warning - the planner can locate every edit.",
          "rationale": ""
        },
        {
          "decision": "The `${CLAUDE_PLUGIN_ROOT}`-in-`args` open question is downgraded: the hooks reference documents exec form and plain-string placeholder substitution; the probe stays as confirmation, not as a blocker.",
          "rationale": ""
        }
      ],
      "risks": [
        "resolved: Is `phase_summaries.<key>` frozen as `phase_summary_entry | decision_item[]` (what the corpus does) or is `clarifications` moved into an entry (`clarifications: {decisions: [...]}`) - the latter breaks \"every real >= 2.2.3 file validates unchanged\".",
        "resolved: Where does the beacon live for consumers that track `.maister/` (repo-alpha: 1,815 tracked files under `.maister/`; acme-portal shows `.maister/` in `git status`) - `.maister/.gate-beacon/` will appear as untracked files, one per session.",
        "resolved: Whether a Copilot driver ever sees the `GATE HOOK FAIL-CLOSED` instruction: on exit 2 Copilot shows only `hook exited with code 2` and discards stdout and stderr (spike-c-copilot report `:122,147`)."
      ],
      "artifacts": [
        {
          "path": "verification/spec-audit.md",
          "label": "Spec audit",
          "html": null
        }
      ],
      "gate": {
        "question": "Spec audit pass-with-concerns (1 critical, 9 warnings). How to proceed?",
        "answer": "Apply C1 + all warnings to the spec, then plan"
      }
    },
    {
      "id": "phase-7",
      "name": "Plan implementation",
      "icon_hint": "plan",
      "status": "completed",
      "started": "2026-08-25T22:10:54Z",
      "completed": "2026-08-25T23:01:38Z",
      "skip_reason": null,
      "summary": "Plan: 11 task groups, 103 steps, ~63 checks (T01-T28 + 6 validate assertions + 11 eval scenarios + group checks). Chain G1 -> {G2 || G3} -> G4 -> G5 -> G6 -> G7 -> G8 -> {G9 || G10} -> G11; manual stops at 2.11 (fixture review), 9.7 (eval run), 11.7-11.9 (bump/push/tag). Renamed 2026-08-26 per naming rule (no layer0 / contract-id prefixes in paths); aligned to spec names.",
      "decisions": [
        {
          "decision": "Rot fixes (Group 6) precede the hooks (Groups 7-8)",
          "rationale": "the reminder qualifier must land before the `hooks.json` PreToolUse registration (spec Staging steps 2 < 5; gap analysis \"qualifier must precede registration\"); the suggested skeleton's order 6->8 was swapped to 6(rot)->7(Claude)->8(Copilot)."
        },
        {
          "decision": "`make test` enters `test.yml` in Group 6, not Group 1",
          "rationale": "T22/T23 are red by design between Group 4 and Group 6; wiring the suite into CI only when they turn green keeps every pushed commit green. Group 1's `test.yml` runs `npm ci`, `make build && make validate` and the stale-variant diff only."
        },
        {
          "decision": "Runner tests follow the deliverable they test",
          "rationale": "T01 -> schemas (G3); T02-T07 + red-first T22/T23 -> readers/runner core (G4); T08-T12, T25, T26, T28 -> register-derived rules (G5); T13, T14, T16-T18, T20, T21 -> Claude hooks (G7); T15, T19, T24 -> Copilot side (G8); T27 -> release (G11). No group exceeds 8."
        },
        {
          "decision": "Makefile targets land with their scripts",
          "rationale": "`test` in G3 (runner skeleton), `eval` in G9, `tarball` in G11; `.PHONY` extended each time. A target never points at a script that does not exist yet."
        },
        {
          "decision": "Fixtures || schemas",
          "rationale": "G2 and G3 share no file; manifests cite schema file names fixed by Sec. T1 before the schemas exist. G2's checkpoint (2.11) is the *pseudonymization* review; the *validation* gate is G4's acceptance (T02/T03/T05 green); the fixture commit happens after both."
        },
        {
          "decision": "No separate \"Test Review & Gap Analysis\" group",
          "rationale": "the spec freezes the test inventory (T01-T28, v7-v12, 11 scenarios); G11 step 11.6 performs the inventory review and adds nothing beyond it."
        },
        {
          "decision": "G9 || G10",
          "rationale": "eval harness and decision log share no file; the probe outcomes (`probe-args-expansion`, `probe-plugin-stop`) are appended to ADR-0007 in G11 (11.6), after both finish."
        },
        {
          "decision": "**Task tools unavailable in the planning session** -> `task_ids: {}`; the checkboxes below are the sole progress tracker (the 6d fallback the spec itself introduces).",
          "rationale": ""
        }
      ],
      "risks": [
        "**Shared-file chain**: `Makefile` (G1, G3, G6, G8, G9, G11), `scripts/verify-contracts.mjs` (G3-G8, G11), `hooks/hooks.json` (G6 guard invocation, G7 gate group, G9 conditional shell-form switch), `CLAUDE.md` (G5, G6, G10), `orchestrator-framework/SKILL.md` (G5, G6), `.github/workflows/test.yml` (G1, G6). All pairs are serialized by `blocked_by`; the executor must not run two of them concurrently.",
        "**Stale-variant CI check**: `test.yml` fails when `plugins/maister-copilot/` is not regenerated - every group that touches `plugins/maister/` ends with `make build && make validate`, and the user commits the regenerated variant alongside (never edited by hand).",
        "**v12 (`maister:` grep over `*.json`/`*.mjs`)** is clean against today's variant (pre-flight run 2026-08-26); G8 re-runs it before adding the assertion and fixes only source strings if something new trips.",
        "**`.gitattributes` renormalization**: G1 verifies no tracked file is CRLF (`git ls-files --eol`) before adding `text eol=lf` rules; if any is, it is reported, not renormalized by the executor.",
        "**Eval run is maintainer-owned** (authenticated `claude` + `copilot`, ~$1-3): the executor stops at 9.7 when credentials are absent; results are attached to the task's `verification/`, never to CI.",
        "**`probe-args-expansion` failure** -> one-line switch of `hooks.json` to shell form (9.8), then T14/T24 + `make build && make validate` re-run; ADR-0007 records the result (11.6).",
        "**External fixture sources** (`~/Repos/repo-alpha`, `~/Repos/repo-beta`) are present today and are read only; G2 cannot proceed without them (the run-sampled set is not synthesizable).",
        "**Spec gaps hit while planning** (resolved here, flagged for the executor): (a) T1 cites `implementation-verifier/SKILL.md:187-188` for 6d while T11 names only `:58` - G6 applies the `html_style_guide_path` gating reword at `:187-188` if that is what the lines contain, else no-op and a work-log note; (b) requirement 8 says \"10 scenarios\", Sec. T9 lists 11 rows (+ the `copilot-user-hooks` variant of `beacon`) - the plan follows Sec. T9; (c) the tolerated fixtures for drift #6/#9 (nested `task_context`, nested `project_context`) have no path in Sec. T6 - named `tolerated/a1/task-context-nested/` and `tolerated/a1/project-context-nested/`, derived from `dev-complete-a`; (d) T13 tests `scanState`, a `gate-lib.mjs` export - assigned to G7, not the runner group."
      ],
      "artifacts": [
        {
          "path": "implementation/implementation-plan.md",
          "label": "Implementation plan",
          "html": "implementation/implementation-plan.html"
        }
      ],
      "gate": {
        "question": "Naming rule applied; continue to Phase 8: implementation?",
        "answer": "Continue to implementation (parallel waves allowed)"
      }
    },
    {
      "id": "phase-8",
      "name": "Execute implementation",
      "icon_hint": "code",
      "status": "in_progress",
      "started": "2026-08-25T23:01:38Z",
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-9",
      "name": "Verify test passes (TDD Green)",
      "icon_hint": "verify",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-10",
      "name": "Prompt verification options",
      "icon_hint": "verify",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-11",
      "name": "Verify implementation & resolve issues",
      "icon_hint": "verify",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-12",
      "name": "Run E2E tests",
      "icon_hint": "verify",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-13",
      "name": "Generate user documentation",
      "icon_hint": "docs",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    },
    {
      "id": "phase-14",
      "name": "Finalize workflow",
      "icon_hint": "done",
      "status": "pending",
      "started": null,
      "completed": null,
      "skip_reason": null,
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null
    }
  ],
  "verification": {
    "status": null,
    "issues": [],
    "fixes": [],
    "reverify_count": 0
  }
};
