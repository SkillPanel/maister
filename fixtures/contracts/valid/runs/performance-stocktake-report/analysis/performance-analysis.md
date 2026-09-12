# Performance Analysis -- Stocktake Report CLI

## TL;DR
Six bottlenecks in 54 lines; one of them owns the clock. `catalogue.load()` re-reads and re-parses the entire 370 KB catalogue on every one of 4,000 `findBySku` calls -- ~1.48 GB re-read and ~16 million objects allocated per run -- which accounts for an estimated 75-90 % of the 3.4 s.
That is a **constant-factor I/O/parse defect**, not an asymptotic one: caching the parse is the big win today, but it leaves both quadratic terms (`O(n-m)` linear scan, `O(n^2)` self-join) intact, so the report would still degrade as the catalogue grows.
The asymptotic fixes (SKU `Map`, shelf bucketing) are cheap individually and only become *visible* after the cache lands -- at which point the `O(n^2)` self-join becomes the new dominant term.
Catalogue row count is now **resolved at 4,000** by direct file read; the disputed 2,800 figure was the commit delta.
All timing splits are REASONED, not measured -- every Bash invocation in this sandbox was denied.

## Key Decisions
- Rank the catalogue re-parse P0 and the two asymptotic defects P1 -- biggest-clock-share first, but with an explicit note that P1 must ship too or the slowdown returns with the next data growth.
- Treat the redundant `counts.json` parse (report.js:9 + report.js:21) as P3, not P2 -- it is real but ~0.1 % of the clock; ranking it higher would misdirect effort.
- Split the `duplicateShelves` cost into two separate findings -- iteration count (B3, fixed by bucketing) and allocation volume (B4, *not* fixed by bucketing) -- because bucketing alone leaves ~129 k throwaway arrays untouched.
- Recommend the bucketed self-join be driven by an **outer loop still in counts file order**, so the returned array is element-for-element identical, not merely the same length.

## Open Questions / Risks
- **Zero measurements.** Bash is blanket-denied here (`node -e ...` and `wc -l` both refused). Every millisecond figure below is reasoned from data shape and known V8 throughput, presented as a range. The first implementation step must record a real baseline.
- **Pair count disagreement with Phase 1.** Phase 1 quotes `recount pairs: 129120`. The verified shelf distribution gives **129,360**. Neither is measured. Since the printed number is being treated as a contract, the golden test must capture the *actual* value before any rewrite -- do not hard-code either figure from these reports.
- **Caching `load()` introduces aliasing.** Today every caller gets a fresh array. A module-level cache hands the *same* array to every caller; one mutation by any consumer silently corrupts all later calls. `load()` is exported with zero in-repo consumers, so this is a latent external-contract hazard, not a current bug.
- The `if (!item) continue` miss path (report.js:13) is unreachable on current data -- all 4,000 counted SKUs exist in the catalogue. It must be preserved without test evidence.

---

**Date**: 2026-09-12
**Task path**: `.maister/tasks/performance/2026-09-12-stocktake-report-slow`
**Method**: Static code analysis only. `user_data_incorporated: false`.
**Scope**: `src/report.js`, `src/catalogue.js`, `src/report.test.js`, `data/catalogue.json`, `data/counts.json`.

---

## 1. Data Sources and Evidence Quality

### What is MEASURED (direct file read, this session)

| Fact | Evidence |
|---|---|
| `data/catalogue.json` = **4,000 rows** | Final element at lines 23,996-24,001 is `"sku": "SKU-03999"`, `"name": "item 3999"`; array closes at line 24,002. 4,000 x 6 lines + 2 = 24,002. **This resolves the 4,000 vs 2,800 dispute carried from Phase 1 -- 4,000 is correct.** The 2,800 figure was derived from commit `12f0abc`'s `+16,800` diffstat, i.e. the delta, not the total. |
| `data/counts.json` = **4,000 rows** | Final element at lines 19,997-20,001 is `"sku": "SKU-03999"`; array closes at line 20,002. 4,000 x 5 + 2 = 20,002. |
| Catalogue row shape | `{sku, name, department, price}`, pretty-printed, 1-space indent, 6 lines/row. |
| Counts row shape | `{sku, qty, shelf}`, pretty-printed, 5 lines/row. |
| SKU ordering is **aligned** between the two files | Both files run `SKU-00000` -> `SKU-03999` in ascending order. Verified at head (rows 0-5), midpoint (rows 119-121), and tail (rows 3,998-3,999) of both files. |
| Shelf assignment is `S(i mod 120)` | Verified: row 0 -> `S0`, row 119 -> `S119`, row 120 -> `S0`, row 121 -> `S1`, row 3,998 -> `S38`, row 3,999 -> `S39`. |
| File sizes | 370,792 B (catalogue), 234,202 B (counts) -- carried from Phase 1's `wc`, consistent with the line counts above. |

### What is DERIVED (arithmetic on measured facts -- high confidence, not executed)

| Quantity | Derivation | Value |
|---|---|---|
| Shelf bucket sizes | 4,000 counts over 120 shelves, last row lands on `S39` -> shelves `S0`-`S39` hold 34 counts, `S40`-`S119` hold 33. Check: 40-34 + 80-33 = 4,000 ok | 40 x 34, 80 x 33 |
| Ordered same-shelf pairs (`recount pairs:`) | sum k(k-1) = 40*34*33 + 80*33*32 = 44,880 + 84,480 | **129,360** |
| `findBySku` comparison count | SKU order is aligned, so `.find` on row *i* scans *i+1* entries. sum(i+1) for i=0..3999 | **8,002,000** string comparisons (avg. scan depth 2,000.5 -- effectively the worst realistic case) |
| Bytes re-read from disk per run | 4,000 x 370,792 B | **~= 1.48 GB** |
| Objects allocated by catalogue re-parses | 4,000 parses x 4,000 objects x 4 properties | **16 M objects / 64 M property slots**, all immediately garbage |
| Self-join iterations | n^2 = 4,000^2 | **16,000,000** |

### What is REASONED (engineering estimate -- treat as a range, never as a measurement)

All wall-clock attributions in section 3-section 8. They are built from the derived volumes above plus conventional V8 throughput assumptions (`JSON.parse` on pretty-printed small-object JSON ~= 0.4-1.0 GB/s effective; a tight `for...of` loop body with two property reads and two comparisons ~= 5-15 ns/iteration; short-string `===` on interned strings ~= 5-15 ns; small-array allocation + GC ~= 100-300 ns amortised).

### What could NOT be obtained

- **No profiling data.** `analysis/user-profiling-data/` is empty; the session is non-interactive and the user could not be prompted. `user_data_incorporated: false`.
- **No execution measurements.** Both attempted read-only commands -- a `node -e` data-shape probe and `wc -l` on the data directory -- were **denied by the sandbox approval gate**. `time npm run report` was therefore not attempted and **no observed runtime is reported anywhere in this document**. The 3.4 s figure is the user's, carried from the task description.

---

