# Product Brief - Maister v3: `maister` + `maister cockpit`

**Task**: `.maister/tasks/product-design/2026-08-25-maister-v3-platform-and-gui` | **Assembled**: 2026-08-25T15:33:26Z | **Status**: for final approval | **Hand-off**: `/maister:development <this task path>`

## TL;DR
Maister v3 is one product in two artifacts: **`maister`** - the free plugin (Claude Code + Copilot CLI builds) with a YAML workflow engine, cross-repo chains and an engine-native umbrella - and **`maister cockpit`** - a licensed local daemon + browser SPA (Observer free / Fleet paid) that is the *chain driver*: it observes every workspace, answers gates via the gate-suspend contract, relays approvals, and mirrors runs to the tracker. **No central server or database**: workspaces are umbrella repos, multi-operator coordination rides an orphan `maister/coordination` git branch with event-sourced files, and everything else is derived from git hosts and the (optional) issue tracker. Launch = a ~8-month solo, contract-first slice: cockpit + a richtext-class chain across two repos on both providers, gates answered from the cockpit, tracker mirror on.

## Key Decisions
- Free plugin / paid cockpit; **Fleet tier = the chain driver** - umbrella runs need it structurally, not via a license check (2D).
- **Gate-suspend contract** (1C): engine writes a request file and exits; any cockpit with push access commits an answer file; the driver machine's daemon resumes the driver, which records the decision first (hook-enforced).
- **Full v3.0 grammar at launch** (`when:`, overlays, eject) with `research` + `development` as YAML built-ins; node ids = today's phase names.
- **No central DB**: workspace = umbrella repo; coordination = orphan git branch mounted at `.maister/umbrella/`, event files, single writer per mutable file; push access = authorization.
- **Tracker optional, mirrored one-way** (Jira + GitHub Issues at launch): epic/child tickets for runs, tasks, follow-ups; close-out transitions. Git-host read (GitHub, GitLab).
- **Two providers at full parity**: Claude Code >= 2.1.233 and Copilot CLI >= 1.0.80 (hooks, named resume, OTel, ACP verified live 2026-08-25).
- **Navigation** = hybrid Miller columns (Home > Run > Task > Session) collapsing older levels into rails; ten reference mockups.

## Open Questions / Risks
- ~~Month-1 spikes are load-bearing~~ **Resolved 2026-08-25** (spec Sec. 10, decisions Sec. 6): 1C holds on both providers; Copilot drives with Claude models now and with GPT models once engine state writes are script-based/JSON (task 3); hook matrices captured - gate hooks are fail-closed only by construction of the script, and the approval relay moves to `PreToolUse` on Claude.
- `builtin:development` YAML parity by month 3 is the schedule's critical path (fallback: research-only overlays at launch).
- Approval-shim UX go/no-go at month 4 (fallback: observe-only approvals flag); shim redesigned after task 0 (spec Sec. 10.3).
- Coordination-branch growth and fetch-interval latency for remote operators; tracker mirror correctness across Jira/GitHub state maps.
- All demand evidence is n=1 (one power user + one single-author tool); S4 (a paying umbrella user outside the author) is the validation.

---

## Layer 0 - Core Brief

### Problem
Maister v2 proved structured AI workflows on single repositories, but real work spans fleets: many repos, many concurrent AI sessions, many pause points, several people. Coordinating that is manual glue - hand-built triage, dispatch and ledger tooling, terminal-hopping to answer gates and approvals, follow-ups hand-carried between workers. Meanwhile v2's ~214k-token instruction surface is rotting and degrades modern models, and maister has no commercial shape. *(full: `analysis/problem-statement.md`)*

### v3 in one sentence
A leaner, engine-driven maister plugin (free) that chains workflows across repositories, plus a licensed fleet cockpit (daemon + browser SPA) that is required to run, watch and unblock those multi-repo workflows - with all shared state living in git and the tracker, never in a server.

### Target users
P1 **Umbrella operator** (primary) | P2 **Tech lead adopting for a team** (buyer) | P3 **Single-repo user** (do-no-harm) | P4 **Org platform owner** (post-launch). *(Layer 1)*

### Feature overview *(full: `analysis/feature-spec.md`, 9 sections + Appendix A)*
1. **Product surface & tiers** - `maister` plugin (open) + `maister cockpit` (`npx maister-cockpit`; Observer free: fleet, drill-down, session tail, approvals, gate answer files; Fleet licensed: chain driver, Run view, start-a-chain). Offline ed25519 key; 14-day trial starts on the first chain run. Positioning: local-first, BYO-CLI, workflow-file-native - the inverse of harness-replacement SaaS (Factory.ai).
2. **Workflow grammar** - full v3.0: definitions (`nodes/needs/gate/dir/when/on/provider`), overlays (`extends/add/tune/disable/profiles`), eject; deterministic validator + generated Mermaid; frozen resolved graph in state; `research` and `development` as YAML built-ins.
3. **Gate-suspend contract** - `gates/<node>.request.yml` (kinds: `gate`, `decision`, `convergence`), `gate_pending` + `driver` state fields, exit-and-resume, hook enforcement on both providers, answer files from any cockpit with push access.
4. **Umbrella runtime** - manifest (`members`, `branch_convention`, `coordination`, `tracker`, `git_host`, `people`), dispatch envelope with autonomy tiers (`attended | auto-low | auto-medium | auto-high` -> approval presets), event-sourced ledger, outbox messages, thin daemon driver loop (spawn / resume / ingest / re-drive), follow-ups -> new dispatch, conversational steering.
5. **Cockpit daemon** - loopback + token, watcher/parser over frozen contracts, NDJSON event log + SSE replay-then-live, provider adapters (Claude stream-json + http hook; Copilot JSONL + OTel + hooks), approval relay with policy presets, git sync loop, tracker + git-host adapters, REST API, task-dir server for iframes, security checklist.
6. **Cockpit SPA** - Home (inbox + work table + people/projects/integrations), Run view (graph, gate card, workers, follow-ups, git/PRs, ticket), Task (iframe leaf), Session (tail + composer + approvals), Start work, Settings; hybrid Miller navigation.
7. **Layer-0 freeze** - 18 + 3 contracts (state, dashboard data, config, task-dir layout, grammar, `workflow:` block, E1/E2, manifest, envelope, ledger events C7, outbox, markers, coordination branch C6, tracker mirror map T1, hook floors); old task dirs render and resume forever.
8. **Roadmap** - contract-first, two tracks: M1 contracts + spikes -> M2 engine alpha || Observer core (+ git sync) -> M3 development-as-YAML || session plane, Observer ships -> M4 umbrella || approval relay (risk gate) -> M5 integrate the richtext chain + tracker mirror + git-host read -> M6-7 harden, license, ship Fleet -> M8 buffer / v1.x.
9. **Workspaces, git coordination & integrations** - the no-central-DB model in full (layout, event schema, sync loop, mirror rules, identity, retention).

### Constraints
C1 plugin dispatches + writes ledger; daemon (licensed) required to drive, monitor, ingest | C2 gates answerable from the cockpit at launch | C3 Claude Code + Copilot CLI at launch | C4 Layer-0 frozen, no migrations | C5 solo, contract-first, vertical slice | C6 remaining 23 ADRs fixed | **C7 (Phase 7)** no centralized app/DB; derive from git and tracker; tracker optional.

### Success criteria (launch)
| # | Criterion | Proof |
|---|---|---|
| S1 | Richtext-class chain (research -> gate -> 2 ordered per-repo dev runs -> close-out) with zero manual glue; gates answered from the cockpit - including from a second operator's machine | e2e over a 2-member fixture umbrella, both providers |
| S2 | `npx maister-cockpit` + `repo add` on a clean machine -> populated Home over existing v2 dirs; `.maister/**` change -> UI <= 2 s locally | first-touch test on a clean VM |
| S3 | Gates 100 % hook-enforced in evals; instruction surface <= ~105k tokens (cut may complete post-launch) | eval harness (M1) + cut tranches |
| S4 | One paying umbrella user outside the author within one release | Fleet on npm + external trial |

### Acceptance highlights *(full lists per section in the spec)*
- Daemon stopped => both providers behave byte-identically to stock CLI (fail-open).
