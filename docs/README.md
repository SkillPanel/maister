# Maister documentation

Maister is distributed from one common source through explicit Codex, Cursor, and Kiro CLI overlays. The target-aware installer accepts a clean local Git checkout, a self-contained Maister archive, or a GitHub source, then materializes a staging tree, validates it, and commits through a journaled transaction. GitHub installation resolves one immutable commit, creates a bounded temporary detached checkout, verifies it, selects the overlay from that same checkout, and cleans it up after the transaction.

## GitHub-only package acquisition

Maister itself is never published to a package registry. Run it from the public canonical repository using `npm exec --yes --package='github:mateuszrapacz/maister#v2.2.7' -- maister ...`, or replace the tag with a lowercase full 40-hex commit. Equivalent `npm install 'github:mateuszrapacz/maister#v2.2.7'` is supported. Moving selectors, arbitrary repositories, token-bearing URLs, and `--ignore-scripts` are unsupported. npmjs access is limited to read-only acquisition of the exact locked `tar@7.5.20` dependency.

Public Release access is anonymous-first. Private Git credentials belong to Git/npm; optional Release API credentials use `GH_TOKEN`, then `GITHUB_TOKEN`, then bounded `gh auth token --hostname github.com`. State-only commands use the active receipt-bound control plane without launcher network or credential lookup.

## Operator guide

- Use `plugins/maister/bin/maister-install.mjs` for install, update, status, verify, uninstall, rollback, and recovery.
- For production, use a clean local checkout with `HEAD` set to the intended full commit SHA, or use `github:owner/repo` with a full commit SHA. Safe branch/tag refs are resolved to a full commit before checkout; short SHAs, unsafe refs, and dirty/ignored inputs are rejected.
- GitHub fetch/checkout operations are bounded to 30 seconds by default; set `MAISTER_GIT_TIMEOUT_MS` explicitly when a different value is required, within the supported 1 ms–10 minute range.
- Use `MAISTER_ALLOW_DIRTY_LOCAL=1` only for explicit development experiments; it bypasses the clean-checkout guard and must not be used in release or support instructions.
- State and receipts live below `$XDG_STATE_HOME/maister/<target>` or `~/.local/state/maister/<target>`.
- A drift conflict stops the operation until the managed target or settings ownership is reconciled.
- `recover` follows the journal and restores file content, modes, links, existence, and topology. Preserve the target-scoped state and journal if code 7 is returned, then verify the resulting receipt before retrying a lifecycle command.
- Stop the host application and every external writer to the selected target or shared settings before a lifecycle command. The target lock coordinates Maister processes only; it cannot lock editors, synchronization tools, shell scripts, or malicious same-user/privileged processes.

## State and permissions

For target `<target>`, state is under `$XDG_STATE_HOME/maister/<target>` or `~/.local/state/maister/<target>` and contains `active-receipt.json`, `receipts/`, `journals/`, `backups/`, `staging/`, and `install.lock`. Keep directories private (`0700`) and files containing receipts, settings snapshots, or lock metadata private (`0600`). Never hand-edit a receipt or journal and never remove a lock while its owning process may still be running.

Maister owns only receipt-listed inventory and allowlisted managed settings keys. Unlisted files and settings remain operator-owned. Identity checks, drift detection, and rollback detect or repair supported races, but arbitrary external mutation is outside the transaction protocol. If another writer races a lifecycle command, stop all writers, preserve the target and state directories, and treat any drift, integrity, or code-7 result as unresolved until recovery and verification succeed.

## Exit codes and recovery

The installer returns: `0` success, `2` usage/settings format, `3` source/Git, `4` overlay/materializer/settings validation, `5` drift, `6` lock busy, `7` transaction/recovery/rollback failure, and `8` integrity failure. On `5`, inspect the reported drift before retrying. On `6`, confirm the competing process. On `7` or `8`, preserve the state directory, inspect the journal and backup, run `recover` only after the process has stopped, and verify the resulting receipt before another lifecycle command. A failed rollback is not repaired by repeated rollback attempts.

## Compatibility

The evidence schema distinguishes E1–E6. E5/E6 records are `unavailable` when a host executable, authentication, safe adapter, or configured versioned scenario is missing. Unavailable never satisfies a passed capability and must remain visible in receipts and support statements. Structural and transactional evidence may permit provisional packaging, but unavailable E5/E6 does not certify host-native discovery or runtime semantics; re-probe when the prerequisite becomes available or the evidence expires.

## Migration boundary (historical)

The migration removed legacy host support, committed generated target trees, old host builders, and repository-owned marketplace projections. Those artifacts are parity history only. Codex's native marketplace handoff is generated privately by the transactional installer from the selected materialized tree; maintainers still edit only the common source and versioned overlays, then validate a selected target.

Codex installation registers that private deployment with `codex plugin marketplace add` and `codex plugin add`; `status`/`verify` validate the recorded native plugin with `codex plugin list --json`. Start a new Codex session after install or update to reload the skills. The receipt-bound native deployment is also used by update, rollback, uninstall, and recovery.

## Package verification

`make package TARGET=<target>` creates a self-contained deterministic archive containing the distribution runtime, installer, canonical source, projection contract/projector, selected target support assets, `.maister-source.json`, and the recognized embedded E3 record. It carries contract-only inputs for the other targets because the manifest is shared, but never their assets. It excludes checked-in Cursor/Kiro behavior copies, parity baselines, foreign assets, and legacy Codex TOML profiles. Run `make test-core` first, then generate one deterministic record with `make generate-e3-attestation E3_RESULT=passed ...` and pass it as `E3_ATTESTATION` to every target package. The release-package test builds each target twice to verify determinism; release CI blocks publication unless the three-target lifecycle smoke consumes that embedded E3 record successfully.

## Logical roles and generated destinations

Workflow delegation accepts only `maister:<role_id>` (for example `maister:advisor`). Codex uses a managed `codex exec` worker with the canonical prompt; no `.codex/agents/*.toml` profile is installed or recognized. Cursor receives `maister-<role_id>` Markdown agents. Kiro receives receipt-owned descriptor leaves at `~/.kiro/agents/maister-<role_id>.json` and prompts at `~/.kiro/agents/instructions/maister-<role_id>.md`; unrelated Kiro agents remain operator-owned. Cursor `explore` and Kiro `explore`/`maister` are separately inventoried support roles, not canonical roles.

## Production agent-gate owner

After installation, hosts invoke `node plugins/maister/bin/maister-agent-gate.mjs` from the matching package and send the closed owner-v1 request on stdin. The request explicitly owns target, home, state root, working root, task state, gate context, role configuration, continuation capability, and an optional registered bridge-module path. The package containing the owner is the immutable source; callers cannot substitute another source tree. stdout is one typed JSON envelope and boundary failures exit `2`; unavailable runtime prerequisites produce a durable fail-closed gate result.

The complete closed v1 field sets and Codex/exact-native inspect and launch schemas are published in [Agent projections and dispatch](../README.md#agent-projections-and-dispatch). A bridge module exports `createMaisterAgentBridgeV1`. The host owns credentials and version discovery. Cursor/Kiro `cancel` is optional best-effort only; `inspect` and `launch` are required. Register the module explicitly for each invocation, replace it when host compatibility changes, and renew E5/E6 evidence for that bridge and host version. Omitting a bridge, returning a malformed schema, or failing authentication/version/control/identity checks never enables fallback.

The release job writes `dist/SHA256SUMS`, `dist/SBOM.cdx.json`, and unsigned `dist/PROVENANCE.json`, then uploads them with the archives. Actions in the release workflow are pinned to verified commit SHAs. The metadata records artifact hashes, source commit, source-date epoch, successful parity report, and the embedded E3 digest/bytes; it is not a cryptographic attestation, does not authenticate the publisher, and does not claim native E6. Checksums and metadata establish integrity only when obtained through a trusted release channel because an attacker who replaces an archive can replace unsigned sidecars too.

Treat local `dist/` as disposable output. Remove or isolate old artifacts before a manual release, build all targets in the same clean run, confirm each archive has the `plugins/maister/**` package shape and only its selected overlay, and publish only artifacts that passed that run's extracted lifecycle, strict parity, checksum, and metadata checks. A familiar filename or recent timestamp is not release evidence. Before installation, inspect `tar -tzf dist/maister-<target>.tar.gz` and verify the archive against `dist/SHA256SUMS`; retain the source commit, overlay/version, E3 record, parity report, SBOM, and provenance with the artifact.

## Checks

```sh
make test-core
make test-evidence
make test-parity-release
node --test tests/platform-independent/release-package.test.mjs
make test-topology
make validate
```

The parity release gate is migration-only but release-blocking: it reconstructs the reviewed immutable Git-tree oracle, materializes Codex, Cursor, and Kiro CLI from one checkout, and requires zero unresolved differences. It must pass from a clean checkout. `E_SOURCE_DIRTY` blocks publication, and `PARITY_ALLOW_DIRTY_LOCAL=1` is a diagnostic override whose result must never be used as release evidence. Expected differences are explicit, versioned, path-scoped, and fingerprint-bound. The portable-distribution workflow validates overlays and contracts rather than rebuilding independently maintained projections. The Cursor evidence workflow does not install a remote runtime; it probes only a preinstalled CLI and records `unavailable` when the host or required scenario is absent. The final topology check rejects legacy/generated trees, marketplace paths, and stale installation references.
