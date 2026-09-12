# Codebase Analysis Report

## TL;DR
The 3.4 s runtime comes from two independent algorithmic defects in 54 lines of source, not from architecture.
`catalogue.findBySku` re-reads and re-parses the entire 370 KB catalogue from disk on every one of 4,000 calls (O(n-m) with a huge I/O constant), and `report.duplicateShelves` runs a full nested self-join over counts (O(n^2) = 16 M iterations).
Both are fixable in place behind the existing four-function public API.
The real hazard is not the fix but the tests: the only test asserts "some department, all positive", so output ordering, `toFixed(2)` rounding, and the deliberately doubled `recount pairs:` number are all unprotected.
Characterisation tests pinning current stdout byte-for-byte must land before any optimisation.

## Key Decisions
- Treat the fix as two separate, independently shippable changes -- catalogue caching/indexing and the shelf self-join -- because they have different risk profiles and different observable side effects.
- Pin current CLI stdout with a golden-output test before touching code -- no existing assertion covers ordering, rounding, or the pair count, so a correct-looking refactor can silently change published numbers.
- Preserve the doubled ordered-pair semantics of `duplicateShelves()` (each unordered pair emitted twice) rather than "fixing" it -- the printed count is an observable contract, and halving it is a behaviour change disguised as an optimisation.
- Keep `findBySku` returning `null` (not `undefined`) for misses -- a naive `Map.get` swap changes the documented return value for a currently dead but exported API.

## Open Questions / Risks
- **Unresolved data-shape discrepancy on `data/catalogue.json`.** Agent 1 reports 4,000 rows / 24,001 lines / 370,792 bytes (from reading the file). Agent 2 reports 2,800 items / 16,801 lines (derived partly from the diffstat of commit `12f0abc`, which added +16,800 lines). Direct `wc` by the reporter confirms 24,001 lines / 370,792 bytes; at the file's 6-lines-per-object pretty-print that arithmetic favours 4,000 rows, and 2,800 rows x 6 = 16,800 is exactly the *added* line count, suggesting Agent 2 measured the delta rather than the total. This is recorded as unresolved rather than decided: it changes the magnitude of the multiplier `m`, not the shape of the bottleneck. Confirm with `node -e "console.log(require('./data/catalogue.json').length)"` before quoting any speedup figure.
- Line count of `data/counts.json` also differs by one (20,001 vs 20,002); immaterial, both agents agree on 4,000 entries. Reporter `wc` gives 20,001.
- `if (!item) continue` (report.js:13) appears never to fire on current data -- every counted SKU exists in the catalogue. The miss path is therefore untested and unexercised; it must be preserved on faith, not on evidence.
- Caching the parsed catalogue changes freshness semantics. `load()`'s doc comment ("read from disk on every call") reads as a deliberate statement. `load()` has zero in-repo consumers, so the risk is external/future callers only -- but it is exported, so treat it as public.
- README is stale ("1,200 counted lines"); the data now holds 4,000. Any timing claim quoted from the README is wrong.

---

**Date**: 2026-09-12
**Task**: Performance analysis of the stocktake report CLI -- `npm run report` takes 3.4 s on 4,000 counted lines and degrades superlinearly as the catalogue grows.
**Analyzer**: codebase-analyzer skill (2 Explore agents: File Discovery + Code Analysis, Context Discovery)

---

## Summary

The project is three JavaScript files, 54 lines of runtime source, zero dependencies, no async, no framework. Both agents independently converged on the same two bottlenecks: a missing catalogue cache/index in `src/catalogue.js`, and a quadratic self-join in `src/report.js`. The slowdown is fully explained by commit `12f0abc`, which grew the data files without touching a line of code -- turning an already-quadratic design into a visible 3.4 s. The technical fix is small and local; the genuine difficulty is that the test suite pins almost nothing, so several plausible "optimisations" would change published output undetected.

---

