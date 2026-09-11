# ADR-0007 — Hook runtime and artifact homes

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § H1; `plugins/maister/hooks/hooks.json`, `hooks/gate-enforce.mjs`; `platforms/claude-code/gate-hooks.settings.json`; `eval/README.md`

## TL;DR
The gate, Stop-nudge and beacon hooks are one zero-dependency Node module invoked in exec form, registered per provider; the destructive-command guard stays bash. Node ≥ 20 is a prerequisite for every session, because the gate hook is registered for every session (see the 2026-09-11 amendment); without it the hook fails open and a terminal operator loses nothing but the error. Schemas ship in the plugin, fixtures live at the repository root, the contract runner ships in the tarball, and no hook writes anything into the consumer's tree.

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

### Amendment 2026-09-11 — Node is a prerequisite for every session, and the nudge is not registrable as written

Two of the findings accepted when the contracts were frozen, revisited against what shipped.

**Node ≥ 20 is not a chain-mode prerequisite only.** The decision above says it is, and that was true of the hooks it was reasoning about — but the plugin registers the gate hook on `PreToolUse` for *every* session, so a consumer without Node gets a non-blocking hook error on every mutating call whether or not they ever run a chain. Nothing is lost when that happens: a terminal operator answers gates in session, so there is no enforcement to lose, and the hook fails open. But the prerequisite is unconditional, and the shipped installation notes already say so; this record was the one still describing it as scoped. It is a documentation reconciliation, not a change of decision. What stays unverified is the same thing it always was: what an interactive user actually *sees* per call when Node is absent, which needs a machine without Node to answer.

**The stop nudge cannot simply be registered in `hooks.json`.** The probe recorded above disproved the assumption that a plugin cannot register `Stop`, and the follow-up it left was to register the nudge there too. That follow-up is refused, on a second blocker the finding did not consider. The nudge blocks a stop whenever a gate node is `running` and its request file does not exist — and terminal mode, by ADR-0009, deliberately writes no request file and no marker at all, because the answer arrives in the same turn. Registering the nudge plugin-wide would therefore block the stop of a correct terminal run. Replayed 2026-09-11 against a terminal-driver run with a running gate and no request file: the hook returns a block. The nudge would have to read the run's driver and stay silent under `terminal` before it could be registered for everyone, which is a behaviour change to a hook rather than a registration move, and it is filed separately.

The beacon stays out of `hooks.json` for its own reason, unchanged and now written down: it classifies a session for the approval relay and writes a marker file outside the project. Registering it plugin-wide would produce those files for every terminal user, none of whom asked for chain mode, and the consequence recorded above — that they accumulate until something prunes them — is the reason not to.

### Amendment 2026-09-11 — argument-prefix denies, re-probed

The shipped autonomy guidance says an argument-prefix rule such as `Bash(git push:*)` is advisory rather than an enforcement mechanism, and lists the ways command text can slip past it. That came from one observation on a machine with an accumulated profile, and it was never clear whether the finding was about the provider or about that machine. Re-probed, because a tier-enforcement decision should not rest on an unexamined measurement.

**What was run.** Four `claude -p` calls against provider build 2.1.268, each granting the shell broadly and denying one argument prefix, in a throwaway repository whose only remote is unreachable. The result is read off the session's own denial record, not off the model's narration. Arms: the literal denied command; a control using a command no local hook rewrites; that control as a compound `cd . && <denied>`; and that control with a doubled space.

**What it found.** The text-shape evasions the guidance listed no longer work. The doubled space is normalized and denied; the compound command is decomposed and denied part by part. The control's prefix rule **bound** — the denial is recorded with the exact command as its input.

The literal `git push origin HEAD` arm, on the same machine and in the same invocation shape, was **not** denied: no denial was recorded and the command ran, failing only on the unreachable remote. The difference between the two is that this machine carries a `PreToolUse` hook that rewrites `git` commands and does not touch the control's. That is what isolates the cause: not prefix matching, but a hook changing the command before the rule sees it.

**What it settles.** The guidance is about the operator's machine, not about the provider. A prefix rule is not inert — it binds, including against the evasions the sentence named. It remains unusable as enforcement, because what it depends on is a property of the machine a spawner cannot see, and because this is a behaviour measured at one build rather than anything guaranteed. The shipped sentence is narrowed to say that, with the rewrite named as the decisive gap.

**Limitation, stated because it bounds the claim.** The probe ran on the authoring machine's own profile rather than a clean one: a fresh home reports the CLI as not logged in, and authenticating it needs an interactive step. The control arm is what substitutes for the clean profile — same machine, same profile, same call, one command the local hook rewrites and one it does not — and it isolates the rewrite without removing it. What is still unmeasured is a profile carrying no hooks at all, where the expectation from these results is that every arm binds.

