# ADR-0021 — The pro edition ships as an assembled superset, and W1 lands its packaging foundation only

**Status**: Accepted · **Date**: 2026-09-19 · **Sources**: `.maister/tasks/research/2026-09-14-pro-plugin-packaging/outputs/decision-log.md` (PRO-ADR-001, PRO-ADR-003, PRO-ADR-004, PRO-ADR-005, PRO-ADR-006); `.maister/tasks/research/2026-09-14-pro-plugin-packaging/outputs/high-level-design.md`; `.maister/tasks/development/2026-09-19-pro-edition-packaging-foundation/implementation/spec.md`

## TL;DR
A private `SkillPanel/maister-pro` assembles the open plugin tree — pinned as a submodule — with a small proprietary overlay on top, so the open tooling runs unchanged in both repositories and the pro delta is enumerable by construction. The plugin keeps its name, `maister`, and moves to a new marketplace, `maister-pro`; the pro edition is the only place driver mode (gate-suspend) and the compatibility contracts apparatus exist, both closing rather than opening a public protocol. None of this record is executed yet: this wave (W1) records the decision, makes four provably inert preparations in the open repository, and bootstraps the pro repository against a pinned commit. Tier 1's move out of the open plugin, the immutable release tag, and the dispatch credential are all deferred to W2.

## ADR-0021: The pro edition ships as an assembled superset, and W1 lands its packaging foundation only {#adr-0021}

### Status
Accepted. This record settles the packaging shape and the sequencing of its first wave; it does not itself move a file out of the open plugin, cut a tag, or push anything beyond the local commits this wave produces.

### Context
The plugin currently ships as one open, MIT repository, `SkillPanel/maister`, consumed by exactly one marketplace. A pro edition needs a second distribution — a private repository, a second marketplace — that a user installs under the same plugin name `maister`, because `workflow:` built-ins and `maister:` targets never resolve across plugins, and the cockpit hard-codes `maister:chain-planner` and finds the plugin only through its own umbrella-runtime configuration. The research task at `.maister/tasks/research/2026-09-14-pro-plugin-packaging` converged on an **assembled superset**: the pro repository holds `upstream/` as a git submodule pinned to a commit of the open repository, plus a small `overlay/` directory of proprietary additions and a bounded, reasoned allow-list of replacements, assembled by a script into a pro plugin tree. This is the only shape in which `build.sh`, the contract runner and the cockpit run unchanged against both trees while the pro delta stays a list rather than a diff.

Two further decisions from that research bear directly on what the open repository loses, and when. First, **Tier 1** — the chain planner, the `plan`/`change`/`fix` definitions, the Stop nudge, the liveness beacon, the `--settings` template and the Copilot hook registration — is cockpit-only surface with few suite edges and no import edges, and is the piece the pro edition eventually carries instead of the open plugin. In this wave it does not move: nothing leaves the open repository, and Tier 1's departure is scheduled for W2. Second, **driver mode** (gate-suspend, the fail-closed `PreToolUse` hook and the engine's `gate-request` verb) becomes pro-only by the *absence* of a module rather than by a marker file or a licence read: `skills/workflow-engine/scripts/lib/gate.mjs` and the second `hooks.json` `PreToolUse` group ship only in the pro overlay, and the shared `workflow.mjs` verb loader already fails with a named, non-crashing error when a verb's module file is missing. No free session can suspend a run; nothing in the free tree can "edit back" an absent module the way it could ignore a marker.

Because driver mode moves to pro-only, the register that governs it cannot stay a public protocol either. The **compatibility contracts apparatus** — the register at `plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md`, its 19 schemas, the 64-row-and-growing runner, the fixtures, the tarball builder, the evaluation harness and the `contracts-vN` tag line — moves to the pro repository as the only place every carrier exists. The register and the schemas re-enter the assembled pro tree as overlay additions at their current in-plugin paths, so the cockpit's schema-diff path and `buildContext` need no edition flag; pro customers receive the register as documentation, the same way the open repository does today. The open repository keeps `make build` and `make validate`; `make test` and the `contracts-v*` tag line leave.

`contracts-v6` is the first tag the pro repository cuts, once its own runner and register exist there; the batch already tracked for issue #18 in the open repository's queue is renumbered to `contracts-v7` rather than colliding with the pro repository's first tag. Nothing is tagged in this wave.

The pro repository's `upstream/` submodule pins commit `69811e5` **by SHA**, not by tag, because `release.yml` publishes a GitHub Release on every `v*` tag pushed to the open repository, and this wave's beta commit is not ready to carry that publication — an immutable tag is deferred to W2, when the pin itself moves. The SHA is already reachable at `origin/feature/v3`, so the submodule resolves without an open-repository push. Pinning by SHA on a mutable branch is a known, accepted narrowness of this wave: a rewritten branch would break a fresh clone, which is exactly why the pin is provisional and the tag work is not skipped, only sequenced after it.

Once the contracts apparatus is pro-only, an open engine change that drifts a frozen shape becomes invisible to open CI. The chosen mitigation, `repository_dispatch` from the open repository's own workflow into the pro repository's, needs a write-capable credential — a fine-grained personal access token with `contents: write` on the private repository, issued from the public one. That credential does not exist yet; it is a named prerequisite for W2, not something this wave provisions or exercises.

Separately, cutting a `contracts-v*` tag is the pro repository's release trigger, and an accidental tag push must not publish anything while the register and runner inside the pro repository are still new. A tag-protection ruleset was the first choice for holding that job shut — protect the `contracts-v*` pattern at the repository-settings level, before a workflow run is even scheduled — but `gh api repos/SkillPanel/maister-pro/rulesets` returns 403, because the organisation is on GitHub's free plan and the rulesets API is a paid-tier feature. In its place, `contracts.yml` takes a **job-level `if:` guard** on a repository variable (for example, `if: vars.CONTRACTS_RELEASE_ENABLED == 'true'`), left unset through this wave, so an accidental tag still starts the job but the job itself skips immediately. The guard is visible in the workflow file a reader already opens, rather than hidden in a settings page the free plan cannot even offer.

### Decision Drivers
- Every open tool — `build.sh`, the contract runner, the tag flow — must keep running unchanged against both the open and the pro tree, so the pro delta stays enumerable rather than a maintained fork
- Driver mode must close as a protocol, not merely hide behind a marker a free session could still read or fake
- The register and schemas must live where every carrier they check actually exists, or the lockstep check itself becomes unrunnable
- Nothing in this wave may be irreversible or externally visible: no tag cut, no push beyond local commits, no credential provisioned before it is needed
- A held-shut release job must be visible in the tree a contributor already reads, given that the organisation's plan forecloses the settings-level alternative

### Considered Options
1. A superseding fork of the open repository, merged forward at every open tag
2. A private monorepo as the source of truth, with the open repository generated as a filtered export
3. One public repository with licence-scoped proprietary paths mixed into the same tree
4. **The assembled superset — pinned submodule plus a small proprietary overlay, in its own repository** ← chosen

### Decision Outcome
Chosen option: **the assembled superset**, sequenced so that this wave only records the decision and proves its open-repository preparations inert.

**The fork and the filtered-export shapes were rejected on the same ground**: neither produces an enumerable delta. A forked repository merged per tag accumulates drift that is only visible as a diff against a moving target; a private-monorepo export reverses authorship and would bind the pro repository's contract tags to a mirror rather than to the tree that actually runs. **The single mixed-licence repository was rejected because it is not closed source** — a licence-scoped path inside a public repository is still a public repository, and the entire point of moving driver mode and the contracts apparatus out is that they stop being publicly readable.

**Landing all of this in one change was rejected on scope**, which is why this ADR exists separately from execution. Moving Tier 1, replacing the contracts apparatus, cutting the first pro tag and provisioning the dispatch credential are none of them reversible for free: a moved file needs a corresponding open-repository removal to stay a superset, a cut tag publishes a release, and a live PAT is a standing credential in the public repository's secrets. Recording the shape now and proving the open-repository edits inert first — the four preparations this wave actually makes — means every later step in W2 starts from an open repository that is already known not to have changed behaviour for any user.

### Consequences

#### Good
- The pro delta is a list — the overlay directory's contents — rather than a diff a maintainer must keep re-deriving against a moving open repository
- Driver mode closes cleanly: no free session can suspend a run, and there is no marker file for a free tree to read, fake, or "restore"
- The register and schemas move to where their carriers actually are, so the lockstep and carrier checks run in one checkout instead of split across two
- This wave's four open-repository edits are each proven inert before the pro repository exists at all, so the packaging change starts from a baseline nobody has to take on faith

#### Bad
- The pro repository mirrors part of the open layout (`platforms/`, `docs/`, the build half of the `Makefile`) purely so the runner's fixed relative paths resolve, which is duplicated structure to keep in step
- The pinned interface the cockpit depends on becomes private: no third-party cockpit alternative can be built against it, and no outside contributor can run the compatibility suite at all
- The SHA pin on a mutable branch is a real fragility accepted for this wave only — a rewritten `feature/v3` breaks a fresh clone until the pin moves to an immutable tag in W2
- The `repository_dispatch` PAT, once provisioned in W2, is a write-capable credential living in the public repository's secrets, needing a rotation calendar the project does not yet have
- The contracts suite goes from 69 rows to 70. That is an addition to the contributor-facing apparatus, not a behaviour change, and no consumer can observe it: nothing this wave moves out of the open plugin, and the row exists to prove the open-repository preparations are inert, not to change what any installed plugin does

Once the register and schemas leave, ADR-0006's compatibility-floor discipline moves with them to pro guidance, and driver mode's move to pro-only amends the reasoning of ADR-0007 and ADR-0017 in the same spirit — both stay in place here as public history with a pointer to this record.
