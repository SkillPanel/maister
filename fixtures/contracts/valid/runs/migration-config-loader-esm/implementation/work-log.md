# Work log  -  config loader to ESM

## What changed

| File | Change |
|---|---|
| `packages/config-loader/package.json` | one ESM entry point; the CommonJS entry point shipped beside it for the length of the run and was removed in the last group |
| `packages/config-loader/src/load.js` | the three JSON files are read through an import attribute instead of `require` |
| `packages/config-loader/src/index.js` | the merged config is a named export, and each import site gets its own structured copy |
| `services/api/src/config.js`, `services/worker/src/config.js` | the two mutating consumers now import the named export and mutate their own copy |
| `services/reporting/src/config.js`, `services/admin/src/config.js` | the two reading consumers moved to the named import unchanged otherwise |

## The four groups

**The ESM entry point.** The package gained an ESM entry point and kept the
CommonJS one beside it. That pairing is what made every later group revertible
on its own: until the last group ran, a consumer that had not moved still
resolved the package the old way.

**The JSON reads.** The loader read its three JSON files with `require`, which
ESM has no equivalent for. They are read through an import attribute now. This
is the change that raises the package's minimum Node version, and that is the
one consequence of the move that reaches past this repository.

**The consumers.** Four of them, the two mutating ones first. They were first
on purpose: they are the only consumers whose behaviour actually changes, so a
red suite after them pointed at the mutation rather than at the import. The two
reading consumers moved with a one-line change each.

**Removing the CommonJS entry point.** Last, once nothing resolved it. The
package now resolves as ESM only.

## The suite

`npm test` at 412 passed, 0 failed. Five assertions were added: the named export
is importable, each import site gets an independent copy, the three JSON files
load through the attribute, and the two previously mutating consumers no longer
reach each other's config.

## Rollback

Unused. The rollback plan is one revert of the package commit, and the dual
entry point kept it a single revert at every step of the run.
