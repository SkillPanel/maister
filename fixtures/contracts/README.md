# Compatibility fixtures

The golden corpus behind `make test`. Every on-disk shape the register
(`plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md`)
freezes has at least one fixture here, and the suite (`scripts/verify-contracts.mjs`)
reads nothing but this tree and `skills/orchestrator-framework/schemas/`.

## The four classes

| Class | Meaning |
|---|---|
| `valid/` | Sampled from real runs written by plugin 2.2.3 or newer. Must pass its schema unchanged. |
| `invalid/` | A shape that must be *rejected*. `expect.error_path` and `expect.error_keyword` pin why. |
| `tolerated/` | Fails the schema and must still be read by the tolerant reader. `expect.degraded` names every reason it must report. |
| `synthetic/` | Hand-built to a frozen shape because no real sample exists yet (umbrella contracts, hook payload variants, gate seeds). `synthetic: true`, `source: "synthetic"`. |

Directories below each class are subject-named (`orchestrator-state/`,
`dashboard-data/`, `gate/`, `hook-payloads/`). Contract ids are citation labels
only: they never appear in a path.

## A fixture

One directory, one `manifest.json`, and the data files it lists. Required fields:
`id`, `contracts[]`, `verdict`, `synthetic`, `source`, `files[]` (each `path` plus
the `schema` it validates against, or `null` when a lint checks it instead).
Optional: `pseudonymized`, `writer_version`, `sampled_at`, `strict_a2`,
`dashboard_html_md5`, `notes`, and `expect`.

`expect` is a *closed* object: an unknown key is an error, not a no-op, so a typo
cannot silently disable an assertion. Its vocabulary (`error_path`,
`error_keyword`, `warnings`, `degraded`, `task_dirs`, `inventory_only`,
`platform_outcome`, `replay`) is defined once, with per-key descriptions, in
`skills/orchestrator-framework/schemas/fixture-manifest.schema.json`
(`#/$defs/expect`). Read it there; this file does not restate it.

## Adding one

1. Put the files in a new subject-named directory under the right class.
2. Write `manifest.json` against `fixture-manifest.schema.json`; list every file:
   an unlisted file fails the suite's orphan lint.
3. Pseudonymize (below) and run the pre-pass grep.
4. `make test`. A new invalid fixture must fail for the reason its `expect` names,
   not merely fail.

Changing a frozen shape is never a fixture-only edit: register row, schema and
fixture move together in one change.

## Pseudonymization

Nothing sampled from a real repository keeps its origin. Replace client and
product nouns (one substitute per concept, consistently), non-English strings, OS
usernames inside paths, and branch or worktree names; keep the *structure* of a
path while replacing its org segments. `source` carries a provenance alias
(`<repo-alias>/<workflow>/<dated-dir>`), never an original absolute path. Set
`pseudonymized: true`. Fixture bytes are ASCII-only.

The pre-pass, run over the whole tree before staging. It must print nothing:

```bash
LC_ALL=C grep -rEn --exclude=README.md \
  'devskiller|mapskiller|DEV-[0-9]|SKP-[0-9]|/Users/|boost|accommodation|dac_|[^\x00-\x7F]' \
  fixtures/contracts/
```

Extend the token list with any identifier the new source repository introduces.
