window.MAISTER_DATA = {
  "generated": "2026-09-12T14:30:47Z",
  "task": {
    "title": "Stocktake report is slow and degrades as the catalogue grows",
    "type": "performance",
    "status": "in_progress",
    "description": "npm run report takes 3.4s on 4000 counted lines and degrades as the catalogue grows; it used to be instant. Find and fix the bottlenecks.",
    "path": ".maister/tasks/performance/2026-09-12-stocktake-report-slow",
    "current_activity": "Analyzing performance bottlenecks"
  },
  "characteristics": {},
  "phases": [
    {"id": "phase-1", "name": "Analyze codebase", "icon_hint": "analysis", "status": "completed", "started": "2026-09-12T14:17:20Z", "completed": "2026-09-12T14:24:08Z", "skip_reason": null,
     "summary": "Two independent algorithmic defects in 54 lines explain the 3.4s runtime: a per-call full catalogue re-read/re-parse in catalogue.js, and a nested self-join in report.js. Both fixable in place, but the test suite pins almost nothing.",
     "decisions": [
       {"decision": "Treat the fix as two separate, independently shippable changes -- catalogue caching/indexing and the shelf self-join", "rationale": "they have different risk profiles and different observable side effects"},
       {"decision": "Pin current CLI stdout with a golden-output test before touching code", "rationale": "no existing assertion covers ordering, rounding, or the pair count, so a correct-looking refactor can silently change published numbers"},
       {"decision": "Preserve the doubled ordered-pair semantics of duplicateShelves() (each unordered pair emitted twice) rather than \"fixing\" it", "rationale": "the printed count is an observable contract, and halving it is a behaviour change disguised as an optimisation"},
       {"decision": "Keep findBySku returning null (not undefined) for misses", "rationale": "a naive Map.get swap changes the documented return value for a currently dead but exported API"}
     ],
     "risks": [
       "Unresolved data-shape discrepancy on data/catalogue.json: Agent 1 reports 4,000 rows / 24,001 lines / 370,792 bytes; Agent 2 reports 2,800 items / 16,801 lines (derived from the diffstat of commit 12f0abc, which added +16,800 lines). Line arithmetic favours 4,000; recorded as unresolved -- it changes the magnitude of m, not the shape of the bottleneck.",
       "if (!item) continue (report.js:13) appears never to fire on current data; the miss path is untested and must be preserved on faith, not on evidence.",
       "Caching the parsed catalogue changes freshness semantics -- load()'s doc comment reads as a deliberate statement, and load() is exported, so treat it as public.",
       "README is stale (\"1,200 counted lines\"); the data now holds 4,000. Any timing claim quoted from the README is wrong.",
       "AskUserQuestion is unavailable in this non-interactive session; the five Phase 1 clarifying questions went unasked and are recorded as documented assumptions in analysis/clarifications.md."
     ],
     "artifacts": [
       {"path": "analysis/codebase-analysis.md", "label": "Codebase Analysis", "html": null},
       {"path": "analysis/clarifications.md", "label": "Clarifications (unasked -- assumptions documented)", "html": null}
     ], "gate": null},
    {"id": "phase-2", "name": "Analyze performance bottlenecks", "icon_hint": "analysis", "status": "in_progress", "started": "2026-09-12T14:24:08Z", "completed": null, "skip_reason": null,
     "summary": "Six bottlenecks (1 P0, 2 P1, 2 P2, 1 P3). The P0 per-call catalogue re-read/re-parse is ~75-90% of the 3.4 s but is a constant-factor fix; both quadratic terms survive it. Catalogue resolved at 4,000 rows. All timing figures are reasoned, not measured -- Bash was denied.",
     "decisions": [
       {"decision": "Rank the catalogue re-parse P0 and the two asymptotic defects P1", "rationale": "biggest-clock-share first, but with an explicit note that P1 must ship too or the slowdown returns with the next data growth"},
       {"decision": "Treat the redundant counts.json parse (report.js:9 + report.js:21) as P3, not P2", "rationale": "it is real but ~0.1 % of the clock; ranking it higher would misdirect effort"},
       {"decision": "Split the duplicateShelves cost into two separate findings -- iteration count (B3, fixed by bucketing) and allocation volume (B4, not fixed by bucketing)", "rationale": "bucketing alone leaves ~129 k throwaway arrays untouched"},
       {"decision": "Recommend the bucketed self-join be driven by an outer loop still in counts file order", "rationale": "so the returned array is element-for-element identical, not merely the same length"}
     ],
     "risks": [
       "Zero measurements. Bash is blanket-denied here (node -e ... and wc -l both refused). Every millisecond figure is reasoned from data shape and known V8 throughput, presented as a range. The first implementation step must record a real baseline.",
       "Pair count disagreement with Phase 1. Phase 1 quotes recount pairs: 129120. The verified shelf distribution gives 129,360. Neither is measured. Since the printed number is being treated as a contract, the golden test must capture the actual value before any rewrite -- do not hard-code either figure from these reports.",
       "Caching load() introduces aliasing. Today every caller gets a fresh array. A module-level cache hands the same array to every caller; one mutation by any consumer silently corrupts all later calls. load() is exported with zero in-repo consumers, so this is a latent external-contract hazard, not a current bug.",
       "The if (!item) continue miss path (report.js:13) is unreachable on current data -- all 4,000 counted SKUs exist in the catalogue. It must be preserved without test evidence.",
       "resolved: data/catalogue.json row count dispute -- resolved at 4,000 by direct file read (final element SKU-03999, array closes at line 24,002); the 2,800 figure was the commit delta."
     ],
     "artifacts": [
       {"path": "analysis/performance-analysis.md", "label": "Performance Analysis", "html": null}
     ], "gate": null},
    {"id": "phase-3", "name": "Gather requirements & create specification", "icon_hint": "spec", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null},
    {"id": "phase-4", "name": "Audit specification", "icon_hint": "verify", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null},
    {"id": "phase-5", "name": "Plan implementation", "icon_hint": "plan", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null},
    {"id": "phase-6", "name": "Execute implementation", "icon_hint": "code", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null},
    {"id": "phase-7", "name": "Prompt verification options", "icon_hint": "verify", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null},
    {"id": "phase-8", "name": "Verify implementation & resolve issues", "icon_hint": "verify", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null},
    {"id": "phase-9", "name": "Finalize workflow", "icon_hint": "done", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null}
  ],
  "verification": {"status": null, "issues": [], "fixes": [], "reverify_count": 0}
};
