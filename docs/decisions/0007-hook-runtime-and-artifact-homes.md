# ADR-0007 — Hook runtime and artifact homes

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § H1; `plugins/maister/hooks/hooks.json`, `hooks/gate-enforce.mjs`; `platforms/claude-code/gate-hooks.settings.json`; `eval/README.md`

## TL;DR
The gate, Stop-nudge and beacon hooks are one zero-dependency Node module invoked in exec form, registered per provider; the destructive-command guard stays bash. Node ≥ 20 is a chain-mode prerequisite only. Schemas ship in the plugin, fixtures live at the repository root, the contract runner ships in the tarball, and no hook writes anything into the consumer's tree.

## ADR-0007: Hook runtime and artifact homes {#adr-0007}

### Status
Accepted. Contract `H1` in `compatibility-contracts.md`; the `${CLAUDE_PLUGIN_ROOT}`-in-`args` question is settled by the eval probe recorded below.

### Context
Two providers with different payload vocabularies, response conventions and registration mechanisms have to be served by one enforcement rule. Claude Code is a native binary that guarantees neither Node nor `jq`, and on Windows may run hooks through PowerShell; Copilot resolves hooks from the consumer repository rather than from `--plugin-dir`. Meanwhile every file the tooling produces has to be homed somewhere that neither pollutes a consumer's git status nor bloats the Copilot build.

### Decision Drivers
- One implementation for both providers: two payload dialects, one predicate
- Fail-closed must survive shells, shebangs, executable bits and CRLF — none of which are portable
- Runtime artifacts ship with the plugin; development artifacts must not

### Considered Options
1. Pure bash + `jq` hooks, as the destructive-command guard already is
2. Per-provider implementations in each provider's most native form
3. One zero-dependency Node `.mjs` per event, invoked in exec form ← chosen (a bash state reader was drafted and rejected — reading the one-line `gate_pending` form portably in shell took more code than the whole Node predicate, and `jq` is no more guaranteed to be present than `node` is; per-provider implementations would implement fail-closed twice and let one side drift silently)

### Decision Outcome
Chosen option: **Node in exec form**. Gate hooks matter only in chain mode, where the cockpit (`npx maister-cockpit`) already guarantees Node — so **Node ≥ 20 is declared as a chain-mode prerequisite only**, and the node-absent terminal path is accepted as unverified: with `node` absent the plugin entry exits 127 and fails open per call, and what an interactive user sees when it does is untested (`eval/scenarios/node-missing.json` covers only the headless half, where the session is classified untrusted because no beacon appears). Registration: `hooks.json` registers `gate-enforce.mjs` on `PreToolUse` with matcher `Write|Edit|MultiEdit|NotebookEdit|Bash|mcp__` and `timeout: 10`, in exec form (`"command": "node"`, `"args": ["${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.mjs"]`) — **the form in force**; the recorded fallback, if `${CLAUDE_PLUGIN_ROOT}` does not expand inside `args`, is the one-line shell form `"command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.mjs\""`. `gate-stop-nudge.mjs` and `gate-beacon.mjs` are registered only through `platforms/claude-code/gate-hooks.settings.json` (a `--settings` template whose `__PLUGIN_ROOT__` placeholder the spawner substitutes), because `Stop` was believed not to be plugin-registrable and a beacon is meaningless outside a driven session. Copilot registration is `platforms/copilot-cli/hooks/maister-gates.json`, emitted by the build into `plugins/maister-copilot/.github/hooks/` and installed by the consumer into their git root's `.github/hooks/` or into `~/.copilot/hooks/`; each entry carries dual `bash` and `powershell` keys wrapping `node` (the shipped repo-root file is a template — the user-hooks variant needs its script directory rewritten), and `-p` mode additionally needs `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` in the environment or a trusted folder, while `~/.copilot/hooks/` always fires. Fail-closed is per-provider: Claude gets deny-JSON **and** exit 2; Copilot gets deny-JSON at exit 0, because there an exit 2 discards stdout and the reason with it. The gate hook allows instantly — no state read at all — when no `gate_pending` exists under `cwd`. The beacon's home is `$MAISTER_BEACON_DIR`, else `~/.maister-cockpit/beacons/`, else `os.tmpdir()`; never the working directory, where a per-session file would surface in every `git status`. `block-destructive-commands.sh` stays bash (advisory, subagent-only) and documents its bash + `jq` requirement. Artifact homes: schemas ship inside the plugin (`skills/orchestrator-framework/schemas/`) because the grammar validator and cockpit pre-flight read them at runtime; fixtures live at the repository root (`fixtures/contracts/`) because nothing at runtime reads them and the root keeps them out of the Copilot build's copy-and-rewrite path; the contract runner ships in the `contracts-v1` tarball; `ajv` and `yaml` are root devDependencies only, never a consumer dependency.

Probe outcome (the local eval run, all scored cases passing — see `eval/README.md`): `probe-args-expansion` **pass** — `${CLAUDE_PLUGIN_ROOT}` expands inside an `args` array (2 denials recorded with `--plugin-dir plugins/maister` and no `--settings`), so the exec form above is the form in force and the shell-form fallback is not taken; `probe-plugin-stop` **fires: true** — contrary to the assumption recorded above, a plugin `hooks.json` *can* register `Stop`, so routing the nudge through the `--settings` template is now a choice, not a constraint (follow-up: register `gate-stop-nudge.mjs` in `hooks.json` too; out of scope here, `hooks.json` and `platforms/claude-code/gate-hooks.settings.json` stay as decided); and the `copilot-user-hooks` beacon variant passes from `~/.copilot/hooks/` **without** `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS`, confirming that only the repo-root registration needs the opt-in.

### Consequences

#### Good
- One predicate, one deny vocabulary translation, and one place where fail-closed is implemented for both providers
- Exec form removes shell quoting, shebang and CRLF from the failure surface, and `.gitattributes` keeps line endings out of it too

#### Bad
- Chain mode now has a runtime prerequisite the plugin itself never needed, and a consumer without Node loses enforcement silently — the liveness beacon is the only thing that detects it
- Copilot enforcement depends on the consumer copying files into their own repository and, headless, on an undocumented environment variable found by decompilation
- The beacon writes outside the project by design, so its files are invisible to the project's own hygiene tooling and accumulate until something prunes them

### Amendment 2026-09-11 — what a pending gate binds

The decision above settled *how* the hook runs and said nothing about *whose* work it stops, and the implementation answered that question by accident: the pending set was computed from a walk of the whole `.maister/` tree, so one open gate anywhere denied every mutating call from every session under that working directory. Observed 2026-09-10: a `routing-gate` left open for nine hours on one run refused an unrelated chain-planner session that had read nothing and drafted nothing. The breadth was never argued — the hook's own rationale is singular, and the only note near the tree walk argues cost, not reach.

Scope is now part of the decision. A pending gate binds the session that asked it (the payload's session id against `orchestrator.driver.session.id`) and the gated run's own task directory; nothing else. That keeps all three things the block is worth having — the asking driver cannot proceed past its own question, it cannot corrupt the record it is waiting on, and nobody rewrites the artifacts the operator is deciding from — and drops the one it was never for. Where the hook cannot establish whose gate it is (no session id in the payload, or no `driver.session.id` in the run) it keeps the old whole-tree reach, and the deny reason says which case applied. The stop nudge and the beacon keep their unscoped walk: neither changes anything on disk.

Two residuals the register records rather than closes. Claude's subagents carry the parent's `session_id`, so the subagent-evasion worry is closed there; Copilot issues a subagent a fresh `sessionId`, so a Copilot driver's subagent reads as another session and is held only by the path rule — its shell is not. And a respawned driver is a new session id, so a run whose `driver.session` the daemon has not yet rewritten admits the session it should deny; E1 already makes that rewrite the daemon's job before the spawn, which is where the fix belongs if it bites.
