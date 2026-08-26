# ADR-0001 — Gate-suspend protocol

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § E2 (gate protocol), § C5 (outcome rule), § H1 (hook floors); `plugins/maister/hooks/gate-enforce.mjs`; the gate eval harness (`eval/README.md`)

## TL;DR
In a chain run a gate suspends the driver process instead of asking in session: request file, `gate_pending`, dashboard, `GATE-PENDING: <node>`, end of turn. The resumed session must record the decision before it touches anything else, and a fail-closed hook is what makes that true rather than merely instructed.

## ADR-0001: Gate-suspend protocol {#adr-0001}

### Status
Accepted. The step order, commit point and failure rows are amended by ADR-0005.

### Context
A run driven by the cockpit has no operator at a terminal, so the v2 protocol — the orchestrator asking its question in session — has nothing to answer it. The question has to become a file that any operator can answer, and the answer has to re-enter a process that has already exited. Whether headless re-entry works at all was the open risk; roughly 160 headless sessions were spent measuring it before the protocol was frozen, and both providers passed.

### Decision Drivers
- A waiting gate must cost nothing: no idle session, no polling, no held context window
- The failure that matters is a driver that skips its gate — enforcement must not depend on the model's cooperation
- One protocol for both providers, verified rather than assumed, with terminal runs unchanged

### Considered Options
1. **1A** — terminal-only gating; the cockpit observes gates and never answers them
2. **1B** — keep the in-session question and hold the driver process open at a gate
3. **1C** — suspend to a request file, resume with a structured answer prompt ← chosen

1A was rejected because a cockpit that can see a gate but not answer it sends the operator back to the terminal it was meant to replace. 1B was rejected on cost: a gate that waits days holds a process, a session and its context window for the whole wait, on every machine in the chain.

### Decision Outcome
Chosen option: **1C**, because it is the only option where a pending gate consumes nothing and re-entry is deterministic — both confirmed empirically (clean suspend 6/6 on Claude Code 2.1.245 and 8/8 on Copilot CLI 1.0.80, resume-with-decision-first 6/6, deny honoured even under `--dangerously-skip-permissions`), and each of those behaviours is re-run as a scored eval scenario (`eval/scenarios/suspend.json`, `resume-answer.json`, `adversarial.json`). The step order is hook-enforced: `gates/<node>.request.yml` (temp + rename) → `gate_pending` + node `status: suspended` → `dashboard-data.js` → `GATE-PENDING: <node>` as the last line → end the turn. `hooks/gate-enforce.mjs` denies every other tool call until the decision is recorded, which makes the gate fail-closed by construction — the one hook in the plugin that does not fail open when it cannot decide. SKILL.md orchestrators are terminal-mode only until a later change makes them driver-aware; chain runs use the engine prompt, and `--driver` is reserved and parsed by no orchestrator today.

### Consequences

#### Good
- A gate cannot be skipped by a model that reasons its way past the instruction — the hook decides, not the prose
- Suspended runs are free, so a chain may wait days on an operator without holding a session or a cost

#### Bad
- Enforcement depends on the hook being registered on **every** spawn and resume, which nothing in the session persists — a missing registration is a silent loss of enforcement, covered only by the liveness beacon (ADR-0007)
- While a gate is pending the whole tool surface is denied, read-only `bash` included, so engine prose must use Read/Glob and editor writes rather than shell heredocs
- Duplicate answers cannot be deduplicated engine-side: a second answer for the same node ends the turn on `GATE-ALREADY-ANSWERED`, and the real guard is the daemon's single-flight lock per run
