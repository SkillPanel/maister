# Target State Plan -- rosterbook CommonJS -> native ESM

## TL;DR
The target is a `"type": "module"` package with plain `.js` files, four static named exports assembled by
`export *`, and a `node:test` suite -- 27 concrete changes across 6 files, 24 of them required and 21 purely
mechanical. Strategy is **big-bang in a single atomic commit**: `"type"` is directory-scoped and all-or-nothing,
and the `.mjs` incremental path costs roughly double the edits while adding a runtime-flag dependency, so it is
not worth it for 82 lines. External research closed two Phase 1 evidence gaps and **corrected a third**: on the
installed Node v20.18.0 `require(esm)` is available behind `--experimental-require-module` (added v20.17.0),
not absent -- it became default-on in v20.19.0 / v22.12.0. Risk is **Low-Medium**: the mechanics are trivial,
but the migration's stated success criterion cannot be tested here because the consumer does not exist in this tree.

## Key Decisions
- **Big-bang, single commit** -- the package is broken from the first edit to the last under *any* ordering, so incremental sequencing buys no safety, only narrative.
- **`export *` barrel, no default export** -- this is the whole point of the migration, and it is also the one change that can break the unobserved consumer in the opposite direction (see BC2).
- **Dependency-order sequencing is demoted from a safety property to a review convention** -- this corrects a Phase 1 key decision; see "Correction to Phase 1" below.
- **Pin the test script to `node --test test/`, not bare `node --test`** -- bare form recursively scans the whole cwd including `.maister/`.
- **Defer the `exports` map** -- carried forward from Phase 1 unchanged; still the right call and still unverifiable.
- **No `.mjs`, no dual build, no `bin`** -- carried forward from Phase 1 unchanged.

## Open Questions / Risks
- **The ESM-only front end remains unobserved.** Every statement in this plan about the target *export surface*
  is conditional on an assumption, not a fact. `clarifications_resolved` is still `false`; all five Phase 1
  questions are open and none of their working assumptions have been confirmed by anyone.
- **NEW -- the migration may break the consumer it is meant to fix (BC2).** Today the *only* import form that
  works from ESM is `import rosterbook from 'rosterbook'` (a default import of the CJS `module.exports` object).
  After the migration there is **no default export at all**, so that exact line becomes a `SyntaxError`. If the
  front end is currently working around the problem with a default import, this migration breaks it. Phase 1 did
  not enumerate this. It is the single highest-value question to put to the operator.
- **`node --test` discovery is now confirmed by documentation but still NOT measured.** The sandbox again denied
  both `node --test` and the creation of a scratch fixture. Confidence is raised from "assumed" to
  "double-confirmed against official Node 20.x docs", not to "observed".
- **Deep imports change shape silently (BC4)** -- `rosterbook/src/calendar` resolves today and will require the
  explicit `.js` suffix afterwards, even though no `exports` map is being added.
- The README goes stale on landing and there is still no usage example to replace it.
- `DAYS` remains exported mutable by reference. Pre-existing, unchanged, out of scope.

---

## 1. Migration Classification

| | |
|---|---|
| **Migration type** | **code** |
| **Risk level** | **Low-Medium** |
| **Effort** | **Low** |
| **Strategy** | **big-bang** (single atomic commit) |
| **Gap count** | **27** (24 required, 3 optional/deferred) |

**Justification for `code`:** the change is confined to source-level module linkage syntax and one manifest
field. There is no data at rest, no schema, no serialized format, and no persisted state -- so it is not a *data*
migration. The module graph is **identical before and after** (same DAG: calendar -> roster -> index -> {cli, test};
same four public members; same call signatures; same runtime behaviour), so it is not an *architecture*
migration either. Only the mechanism by which files reference each other changes. The single genuinely semantic
change -- object spread -> `export *` -- alters *how* the barrel is assembled, not *what* it exposes.

---

