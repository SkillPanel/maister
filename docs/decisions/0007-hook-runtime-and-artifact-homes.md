# ADR-0007 — Hook runtime and artifact homes

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `plugins/maister/hooks/hooks.json`, `hooks/block-destructive-commands.sh`

## TL;DR
The plugin's Node hooks are zero-dependency modules invoked in exec form; the destructive-command guard stays bash. Node ≥ 20 is a prerequisite for every session (see the 2026-09-11 amendment). No hook writes anything into the consumer's tree. The gate-enforcement hook set is a Pro Edition feature and does not live in this repository.

## ADR-0007: Hook runtime and artifact homes {#adr-0007}

### Status
Accepted. The `${CLAUDE_PLUGIN_ROOT}`-in-`args` question is settled by the probe recorded below.

### Context
Two providers with different payload vocabularies, response conventions and registration mechanisms have to be served by one hook implementation. Claude Code is a native binary that guarantees neither Node nor `jq`, and on Windows may run hooks through PowerShell; Copilot resolves hooks from the consumer repository rather than from `--plugin-dir`. Meanwhile every file the tooling produces has to be homed somewhere that neither pollutes a consumer's git status nor bloats the Copilot build.

### Decision Drivers
- One implementation for both providers: two payload dialects, one predicate
- A hook must survive shells, shebangs, executable bits and CRLF — none of which are portable
- Runtime artifacts ship with the plugin; development artifacts must not

### Considered Options
1. Pure bash + `jq` hooks, as the destructive-command guard already is
2. Per-provider implementations in each provider's most native form
3. One zero-dependency Node `.mjs` per event, invoked in exec form ← chosen (a bash reader was drafted and rejected — it took more code than the Node version, and `jq` is no more guaranteed to be present than `node` is; per-provider implementations would let one side drift silently)

### Decision Outcome
Chosen option: **Node in exec form**. A Node hook is registered in `hooks.json` in exec form (`"command": "node"`, `"args": ["${CLAUDE_PLUGIN_ROOT}/hooks/<hook>.mjs"]`) — **the form in force**; the recorded fallback, if `${CLAUDE_PLUGIN_ROOT}` does not expand inside `args`, is the one-line shell form `"command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/<hook>.mjs\""`. No hook writes a file into the working directory, where a per-session file would surface in every `git status`. `block-destructive-commands.sh` stays bash (advisory, subagent-only) and documents its bash + `jq` requirement.

Probe outcome: `probe-args-expansion` **pass** — `${CLAUDE_PLUGIN_ROOT}` expands inside an `args` array, so the exec form above is the form in force and the shell-form fallback is not taken.

### Consequences

#### Good
- Exec form removes shell quoting, shebang and CRLF from the failure surface, and `.gitattributes` keeps line endings out of it too

#### Bad
- Every session now has a runtime prerequisite the plugin itself never needed; without Node a Node hook reports a non-blocking error

### Amendment 2026-09-11 — Node is a prerequisite for every session

Revisited against what shipped.

**Node ≥ 20 is a prerequisite for every session.** The decision as first recorded scoped it to chain mode, but the plugin registers a Node hook for every session, so a consumer without Node gets a non-blocking hook error whether or not they ever run a chain. The shipped installation notes already say so; this record was the one still describing it as scoped. It is a documentation reconciliation, not a change of decision.

### Amendment 2026-09-11 — argument-prefix denies, re-probed

The shipped autonomy guidance says an argument-prefix rule such as `Bash(git push:*)` is advisory rather than an enforcement mechanism, and lists the ways command text can slip past it. That came from one observation on a machine with an accumulated profile, and it was never clear whether the finding was about the provider or about that machine. Re-probed, because a tier-enforcement decision should not rest on an unexamined measurement.

**What was run.** Four `claude -p` calls against provider build 2.1.268, each granting the shell broadly and denying one argument prefix, in a throwaway repository whose only remote is unreachable. The result is read off the session's own denial record, not off the model's narration. Arms: the literal denied command; a control using a command no local hook rewrites; that control as a compound `cd . && <denied>`; and that control with a doubled space.

**What it found.** The text-shape evasions the guidance listed no longer work. The doubled space is normalized and denied; the compound command is decomposed and denied part by part. The control's prefix rule **bound** — the denial is recorded with the exact command as its input.

The literal `git push origin HEAD` arm, on the same machine and in the same invocation shape, was **not** denied: no denial was recorded and the command ran, failing only on the unreachable remote. The difference between the two is that this machine carries a `PreToolUse` hook that rewrites `git` commands and does not touch the control's. That is what isolates the cause: not prefix matching, but a hook changing the command before the rule sees it.

**What it settles.** The guidance is about the operator's machine, not about the provider. A prefix rule is not inert — it binds, including against the evasions the sentence named. It remains unusable as enforcement, because what it depends on is a property of the machine a spawner cannot see, and because this is a behaviour measured at one build rather than anything guaranteed. The shipped sentence is narrowed to say that, with the rewrite named as the decisive gap.

**Limitation, stated because it bounds the claim.** The probe ran on the authoring machine's own profile rather than a clean one: a fresh home reports the CLI as not logged in, and authenticating it needs an interactive step. The control arm is what substitutes for the clean profile — same machine, same profile, same call, one command the local hook rewrites and one it does not — and it isolates the rewrite without removing it. What is still unmeasured is a profile carrying no hooks at all, where the expectation from these results is that every arm binds.

### Amendment 2026-09-20 — the gate hooks are a Pro Edition feature
The per-call gate-enforcement hook, the Stop nudge, the liveness beacon and the `--settings` template that registers them are a Pro Edition feature and do not live in this repository. Open `hooks.json` registers only the session-start hooks and the destructive-command guard.
