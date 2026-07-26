# Build pipeline

`plugins/maister/common/`, canonical portable skills, and `plugins/maister/overlays/` are distribution inputs. There are no independently maintained generated target trees and no host builder that rewrites a second source of truth. Target-specific skill naming and invocation syntax is applied during materialization from the canonical source; do not add host-owned lifecycle skill copies. Cursor's checked-in compatibility projection is a deterministic, drift-checked migration exception; its source mappings, transformations, exclusions, and preserved exception hashes must remain explicit until the projection is removed.

Use the target-aware entry points:

```sh
make test-core
make test-runtime
make test-overlay TARGET=codex
make test-materializer TARGET=cursor
make test-evidence
make test-topology
make test
make validate
make test-install
make test-slow
make package TARGET=codex
```

`make test` is the fast local composition: core, runtime, Pi, evidence,
current-target-admission, and topology checks. `make validate` adds the Cursor
projection check and validation of every registered overlay, then runs that
same fast composition. Both commands exclude
`installer-transaction.test.mjs` and are expected to complete within the
ordinary 300-second local command budget.

Use `make test-install` for the canonical installer transaction aggregate and
`make test-slow` as its single-execution alias. The aggregate has a 15-minute
external hard bound; do not hide it behind `test`, `validate`, `test-targets`,
or the platform-independent wildcard.

Pull-request CI owns one visibly named Ubuntu `make test-slow` execution with a
budget above that bound. Release launcher and public-smoke matrices cover Ubuntu
and macOS only; each runs `make test-slow` once. The earlier Ubuntu `make
validate` remains fast. Abrupt-crash and multiple-journal suites remain
independent matrix commands.

Use the explicit `make test-overlay TARGET=<target>` entry point when
diagnosing one overlay.

Before release, validate the common core, every overlay, evidence policy,
topology, package contents, and a clean extracted-archive lifecycle for every
registered target. Run `make test-core`, then
`make generate-e3-attestation E3_RESULT=passed` with an explicit source version
and deterministic source-date epoch. Pass the generated file as
`E3_ATTESTATION` to every `make package` invocation. The package validator
checks its schema, freshness, commit/version binding, and portable-core digest
before embedding it at
`plugins/maister/.maister-e3-attestation.json`. Archive input paths are
explicitly sorted.

The release-package test compares two builds per target. Release CI invokes the
test against the produced archives, generates `dist/SHA256SUMS`,
`dist/SBOM.cdx.json`, and unsigned `dist/PROVENANCE.json`, binds the E3
digest/bytes in the metadata, and blocks publication if the E3-backed lifecycle
is not green. Unsigned sidecars do not authenticate the publisher and are
trustworthy only through a trusted release channel. E5/E6 may be unavailable
because a runtime, authentication, safe adapter, or scenario is missing; this
permits only explicitly provisional claims and never a native semantic pass.

Treat `dist/` as disposable output. A release job starts from an empty or
isolated output directory and publishes only artifacts generated and verified
in that same job. Existing archives, even with expected names, must not be
reused. Confirm the `plugins/maister/**` package shape, target isolation,
extracted lifecycle, checksums, SBOM, and provenance before upload.
