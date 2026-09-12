window.MAISTER_DATA = {
  "generated": "2026-09-12T14:33:41Z",
  "task": {
    "title": "rosterbook: CommonJS -> native ES modules",
    "type": "migration",
    "status": "in_progress",
    "description": "Move the rosterbook package from CommonJS to native ES modules, so the ESM-only front end can import it and the tests can run under node --test.",
    "path": ".maister/tasks/migrations/2026-09-12-rosterbook-cjs-to-esm",
    "current_activity": "Planning target state and gaps"
  },
  "characteristics": { "migration_type": "code", "clarifications_resolved": false },
  "phases": [
    {
      "id": "phase-1",
      "name": "Analyze current state",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-09-12T14:17:45Z",
      "completed": "2026-09-12T14:25:57Z",
      "skip_reason": null,
      "summary": "rosterbook is 82 lines of dependency-free CJS with no build step, no cycles, and none of the usual ESM-hostile constructs; the real work is the object-spread barrel at src/index.js:6, a test-file rewrite, and five .js suffix additions. The motivating ESM front end is not present anywhere in the tree, so its import contract is assumed, not observed.",
      "decisions": [
        { "decision": "Target `\"type\": \"module\"` with plain `.js` files, not `.mjs` and not a dual CJS/ESM `exports` build", "rationale": "the package is `private: true` with zero deps and no build step; dual-publish would introduce the one thing worth protecting (a transpiler)" },
        { "decision": "Convert `src/index.js:6` `module.exports = { ...calendar, ...roster }` to `export * from './calendar.js'; export * from './roster.js';`", "rationale": "`cjs-module-lexer` cannot see through object spread, which is precisely why named imports fail from ESM today" },
        { "decision": "Rewrite, not translate, `test/roster.test.js`", "rationale": "left as bare top-level asserts under `node --test` it reports `tests 0 / pass 0` and green: a silently vacuous pass" },
        { "decision": "Treat the `exports` map as OPTIONAL and defer it", "rationale": "adding it closes off deep imports, and whether the unobserved consumer uses them cannot be checked" },
        { "decision": "Migrate in dependency order (calendar -> roster -> index -> cli/test) and flip `\"type\"` LAST", "rationale": "flipping first breaks all 5 files simultaneously" }
      ],
      "risks": [
        "**The \"ESM-only front end\" is unobserved.** No file anywhere in the worktree imports or references `rosterbook`; the only evidence it exists is one English sentence at `README.md:7-9`. See the full assumption list below -- it must not be read as fact.",
        "**`node --test` discovery was NOT empirically confirmed.** The sandbox denied the `node --test` invocation. The claim that `test/roster.test.js` is auto-discovered rests on documented Node 20 default patterns only. Run it once before relying on it. (`npm test` on the current CJS script WAS run and passed.)",
        "**Installed Node is v20.18.0, below the `require(esm)` interop line** (unflagged in 22.12, backported to 20.19). Post-migration, any CJS caller doing `require('rosterbook')` fails with `ERR_REQUIRE_ESM`. None is checked in; out-of-tree ones are unknown.",
        "`export *` silently DROPS names exported by both sources, where the current spread resolves last-wins. No collision exists today, but the failure mode changes if one is introduced later.",
        "`DAYS` is exported by reference and is mutable -- a consumer can `push` to it and corrupt `build()` at `src/roster.js:7`. Pre-existing, unchanged by the migration.",
        "The README's \"Why this needs moving\" section goes stale the moment this lands and has no usage example to replace it."
      ],
      "artifacts": [
        { "path": "analysis/current-state-analysis.md", "label": "Current State Analysis", "html": null },
        { "path": "analysis/clarifications.md", "label": "Clarifications (unresolved -- carried to Phase 2 gate)", "html": null }
      ],
      "gate": null
    },
    {
      "id": "phase-2",
      "name": "Plan target state and gaps",
      "icon_hint": "analysis",
      "status": "in_progress",
      "started": "2026-09-12T14:25:57Z",
      "completed": null,
      "skip_reason": null,
      "summary": "Target is a \"type\": \"module\" package with four static named exports via `export *` and a node:test suite -- 27 changes across 6 files, 24 required, 21 mechanical. Strategy is big-bang in a single commit. External research confirmed node --test discovery and corrected Phase 1's require(esm) claim; the newly surfaced BC2 is that the migration removes the default export, which is the only import form that works from ESM today.",
      "decisions": [
        { "decision": "**Big-bang, single commit**", "rationale": "the package is broken from the first edit to the last under *any* ordering, so incremental sequencing buys no safety, only narrative" },
        { "decision": "**`export *` barrel, no default export**", "rationale": "this is the whole point of the migration, and it is also the one change that can break the unobserved consumer in the opposite direction (see BC2)" },
        { "decision": "**Dependency-order sequencing is demoted from a safety property to a review convention**", "rationale": "this corrects a Phase 1 key decision" },
        { "decision": "**Pin the test script to `node --test test/`, not bare `node --test`**", "rationale": "bare form recursively scans the whole cwd including `.maister/`" },
        { "decision": "**Defer the `exports` map**", "rationale": "carried forward from Phase 1 unchanged; still the right call and still unverifiable" },
        { "decision": "**No `.mjs`, no dual build, no `bin`**", "rationale": "carried forward from Phase 1 unchanged" }
      ],
      "risks": [
        "**The ESM-only front end remains unobserved.** Every statement in this plan about the target *export surface* is conditional on an assumption, not a fact. `clarifications_resolved` is still `false`; all five Phase 1 questions are open and none of their working assumptions have been confirmed by anyone.",
        "**NEW -- the migration may break the consumer it is meant to fix (BC2).** Today the *only* import form that works from ESM is `import rosterbook from 'rosterbook'` (a default import of the CJS `module.exports` object). After the migration there is **no default export at all**, so that exact line becomes a `SyntaxError`. If the front end is currently working around the problem with a default import, this migration breaks it. Phase 1 did not enumerate this. It is the single highest-value question to put to the operator.",
        "**`node --test` discovery is now confirmed by documentation but still NOT measured.** The sandbox again denied both `node --test` and the creation of a scratch fixture. Confidence is raised from \"assumed\" to \"double-confirmed against official Node 20.x docs\", not to \"observed\".",
        "**Deep imports change shape silently (BC4)** -- `rosterbook/src/calendar` resolves today and will require the explicit `.js` suffix afterwards, even though no `exports` map is being added.",
        "The README goes stale on landing and there is still no usage example to replace it.",
        "`DAYS` remains exported mutable by reference. Pre-existing, unchanged, out of scope."
      ],
      "artifacts": [
        { "path": "analysis/target-state-plan.md", "label": "Target State Plan", "html": null }
      ],
      "gate": null
    },
    { "id": "phase-3", "name": "Gather requirements & create migration strategy", "icon_hint": "spec", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null },
    { "id": "phase-4", "name": "Plan implementation", "icon_hint": "plan", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null },
    { "id": "phase-5", "name": "Execute migration", "icon_hint": "code", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null },
    { "id": "phase-6", "name": "Verify and test compatibility", "icon_hint": "verify", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null },
    { "id": "phase-7", "name": "Resolve verification issues", "icon_hint": "verify", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null },
    { "id": "phase-8", "name": "Generate documentation", "icon_hint": "docs", "status": "pending", "started": null, "completed": null, "skip_reason": null, "summary": null, "decisions": [], "risks": [], "artifacts": [], "gate": null }
  ],
  "verification": { "status": null, "issues": [], "fixes": [], "reverify_count": 0 }
};
