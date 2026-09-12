# Codebase Analysis Report

## TL;DR
rosterbook is 82 lines of dependency-free CommonJS across 5 files with zero build step, zero CI, no cycles, and no `__dirname`/`fs`/`require.main` usage -- the three constructs that normally dominate a CJS->ESM move are all absent. Real work is three things: rewrite the object-spread barrel at `src/index.js:6` into static `export *` (this is the actual reason an ESM consumer is blocked today), rewrite `test/roster.test.js` from bare top-level asserts into `node:test` blocks, and append `.js` to five extensionless relative specifiers plus flip `"type"` to `"module"`. The ESM-only front end that motivates the migration is **not present anywhere in the tree** -- its import contract is entirely assumed. Installed Node is v20.18.0, below the 20.19/22.12 `require(esm)` line, so any out-of-tree CJS consumer would break hard.

## Key Decisions
- Target `"type": "module"` with plain `.js` files, not `.mjs` and not a dual CJS/ESM `exports` build -- the package is `private: true` with zero deps and no build step; dual-publish would introduce the one thing worth protecting (a transpiler).
- Convert `src/index.js:6` `module.exports = { ...calendar, ...roster }` to `export * from './calendar.js'; export * from './roster.js';` -- `cjs-module-lexer` cannot see through object spread, which is precisely why named imports fail from ESM today.
- Rewrite, not translate, `test/roster.test.js` -- left as bare top-level asserts under `node --test` it reports `tests 0 / pass 0` and green: a silently vacuous pass.
- Treat the `exports` map as OPTIONAL and defer it -- adding it closes off deep imports, and whether the unobserved consumer uses them cannot be checked.
- Migrate in dependency order (calendar -> roster -> index -> cli/test) and flip `"type"` LAST; flipping first breaks all 5 files simultaneously.

## Open Questions / Risks
- **The "ESM-only front end" is unobserved.** No file anywhere in the worktree imports or references `rosterbook`; the only evidence it exists is one English sentence at `README.md:7-9`. See the full assumption list below -- it must not be read as fact.
- **`node --test` discovery was NOT empirically confirmed.** The sandbox denied the `node --test` invocation. The claim that `test/roster.test.js` is auto-discovered rests on documented Node 20 default patterns only. Run it once before relying on it. (`npm test` on the current CJS script WAS run and passed.)
- **Installed Node is v20.18.0, below the `require(esm)` interop line** (unflagged in 22.12, backported to 20.19). Post-migration, any CJS caller doing `require('rosterbook')` fails with `ERR_REQUIRE_ESM`. None is checked in; out-of-tree ones are unknown.
- `export *` silently DROPS names exported by both sources, where the current spread resolves last-wins. No collision exists today, but the failure mode changes if one is introduced later.
- `DAYS` is exported by reference and is mutable -- a consumer can `push` to it and corrupt `build()` at `src/roster.js:7`. Pre-existing, unchanged by the migration.
- The README's "Why this needs moving" section goes stale the moment this lands and has no usage example to replace it.

---

**Date**: 2026-09-12
**Task**: Move rosterbook from CommonJS to native ES modules so an ESM-only front end can import it and tests can run under `node --test`
**Analyzer**: codebase-analyzer skill (2 Explore agents: File Discovery + Code Analysis + Context Discovery, Migration Target)

---

## Summary

rosterbook is a 5-file, 82-line, zero-dependency CommonJS package with no build tooling, no lockfile, no CI, and a single git commit. Both agents independently confirmed the same picture and disagreed on nothing factual. The migration is unusually clean: no circular imports, no CJS-only dependencies, no non-strict code, no `__dirname`/`fs`/`path`, no `require.main` guard, no dynamic or conditional requires. The substantive work is one conceptual change (the barrel re-export), one rewrite (the test file), and five mechanical `.js` suffix additions plus a `package.json` field flip.

---

