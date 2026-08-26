# Feature Specification - Maister v3 Platform + GUI

**Task**: `.maister/tasks/product-design/2026-08-25-maister-v3-platform-and-gui` | **Started**: 2026-08-25T11:45:54Z | **Phase**: 6 | **Basis**: `analysis/design-decisions.md` (1C/2D/3D/4A/5D/6A), `analysis/problem-statement.md` (C1-C6, S1-S4), `analysis/personas.md`

> **Provenance**: ADR-001...012 and the v3 HLD come from `.maister/tasks/research/2026-08-12-maister-v3-directions/outputs/`; GUI-ADR-001...013 and the GUI HLD from `.maister/tasks/research/2026-08-25-maister-gui-options/outputs/`. Copies: `context/research-context/`.

## TL;DR
Ten implementation-ready sections (Sec. 9 added during visual prototyping; Sec. 10 records the task-0 spike amendments of 2026-08-25 and supersedes Secs. 3, 5.4, 7, 8 where they conflict): one brand / two artifacts (`maister` free plugin, `maister cockpit` Observer-free / Fleet-licensed); the **full v3.0 grammar at launch** (`when:`, overlays, eject) with `research` and `development` shipped as YAML built-ins; the **gate-suspend contract** (request file + `gate_pending` + exit + resume-with-decision, hook-enforced on both providers); an engine-native umbrella (manifest, envelope with autonomy tiers, 7-op file ledger, outbox) driven by a thin daemon loop; a loopback daemon with two-provider adapters (Claude Code >= 2.1.233, Copilot CLI >= 1.0.80), approval relay with policy presets, NDJSON event log + SSE; a 5-screen SPA (Fleet, Attention strip, Run view, iframe leaf, session tail + start-a-chain); a frozen Layer-0 contract register; a 6-7-month contract-first roadmap with month-1 spikes - extended to **~8 months** by Sec. 9: **no central DB**, workspaces = umbrella repos, an orphan `maister/coordination` branch with an event-sourced ledger and gate answer files (multi-operator without a server), an optional tracker mirror (Jira + GitHub Issues: epic/child tickets for runs, tasks, follow-ups) and read-only git-host integration.

## Key Decisions
- Full grammar at launch (user override of trade-off #2) - pulls `builtin:research` + `builtin:development` YAML into the slice; roadmap 6-7 months.
- Gate-suspend applies to chain runs only; single-repo terminal gates unchanged (P3 invariant).
- Daemon spawns/resumes only the *driver*; the engine spawns workers - ADR-007 and 2D both hold.
- Daemon write surface = ledger 7 ops only; everything else read-only, CI-asserted.
- Autonomy tiers (attended / auto-low/medium/high) on the envelope map to approval presets (Factory.ai borrow); attended always queues push/merge/PR.
- Copilot and Claude at full parity for observe, drive, relay, telemetry; per-capability degradation, version floors pinned with fixtures.
- **No centralized app/DB** (Sec. 9): coordination through git (orphan branch, event files, driver-local resume); tracker optional with one-way mirror; people derived from git/tracker identity, no live presence in v1.

## Open Questions / Risks
- ~~Month-1 spikes are load-bearing~~ **Resolved 2026-08-25 (Sec. 10)**: 1C holds on both providers; Copilot drives with Claude models today and with GPT models once state writes are script-based/JSON (task 3); hook fail-open/closed matrix captured for both providers.
- `builtin:development` YAML parity by month 3 is the schedule's critical path; fallback ships research-only overlays.
- Approval-shim UX (timeouts/races) has a go/no-go at month 4 with an observe-only flag as fallback. **Sec. 10.3 redesigns the shim**: Claude `PermissionRequest` never fires headless, so the relay rides `PreToolUse`.
- Solo bandwidth across two tracks; cut list pre-agreed (Sec. 8.4).
- Copilot hook schema is young (absent < 1.0.80); fixture re-capture on every provider release. **Repo hooks are inert in `-p` mode without `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` (undocumented, Sec. 10.2 H1).**
- Coordination-branch growth from run artifacts (archive/prune policy, Sec. 9.3d); fetch-interval latency for remote operators; tracker mirror correctness across Jira/GitHub state maps.

---

## 1. Product Surface & Tiers

### 1.1 Artifacts

| Artifact | Distribution | License | Runtime | Contents |
|---|---|---|---|---|
| **`maister`** plugin | Claude Code marketplace (`maister-plugins`) + generated Copilot build (`maister-copilot`, via `make`) | Open (as today) | Inside a Claude Code or Copilot CLI session | Engine (grammar subset), built-in workflows, umbrella manifest + `init --umbrella`, dispatch executor + envelope, ledger writes, gate-suspend engine side, enforcement hooks, per-task dashboard + companions |
| **`maister cockpit`** | `npx maister-cockpit` (npm), later brew / single binary | Closed; offline ed25519 key | User-level daemon (127.0.0.1 + token) + browser SPA | Watcher/parser over `.maister/**`, event log, REST+SSE, provider adapters, approval relay, chain driver, SPA |

"Daemon" never appears in user-facing UI or docs; it is "the cockpit" (running / not running).

### 1.2 Tiers

| Capability | Plugin only | Cockpit **Observer** (free) | Cockpit **Fleet** (licensed) |
|---|---|---|---|
| Single-repo workflows, gates in terminal | [x] | [x] | [x] |
| Per-task dashboard + HTML companions | [x] | [x] (embedded) | [x] |
| Fleet grid across registered repos, liveness, gate/approval badges | - | [x] | [x] |
| Task drill-down (iframe), session tail, TL;DR peeks | - | [x] | [x] |
| Approval relay (permission prompts answered in cockpit) | - | [x] | [x] |
| Spawn / interrupt / kill / resume single sessions | - | [x] | [x] |
| `init --umbrella`, author chain files, dry-run validate | [x] (authoring only) | [x] | [x] |
| **Run a chain** (driver: spawn umbrella run, dispatch `dir:` workers) | [ ] "requires maister cockpit (Fleet)" | [ ] same + *Start trial* | [x] |
| Gate answering (gate-suspend resume) | - | [ ] (shown, deep-link only) | [x] |
| Outbox ingest -> ledger, Run view, follow-ups, close-out summary | - | [ ] (ledger files rendered read-only if present) | [x] |
| Start-a-chain form | - | greyed, opens trial | [x] |

Rule: derivable from files alone -> Observer; *drives* a chain -> Fleet.

### 1.3 Activation & trial
- Key: ed25519-signed JSON `{licensee, email, tier: "fleet", issued, expires?, seats: 1}`; verified offline with an embedded public key; stored in `~/.maister-cockpit/license.json`. Pluggable `ActivationProvider` (offline-key impl only at launch).
- Trial: `fleet_trial_started_at` written on the **first Fleet action** (first *Start chain*), not on install; 14 days; one trial per machine id. Observer unlimited.
