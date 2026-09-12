# Clarifications -- Stocktake report performance

## TL;DR
`AskUserQuestion` is unavailable in this session, so the five Phase 1 clarifying questions
could not be asked. They are recorded below with the working assumption the analysis proceeds
under. Each assumption is falsifiable and must be confirmed at the Phase 2 gate before any
code changes; the riskiest is A3 (the doubled `recount pairs:` number is a contract, not a bug).

## Key Decisions
- Proceed on documented assumptions rather than block -- the user bounded this run to the analysis phases, and every assumption is recorded for confirmation at the Phase 2 gate.
- Treat all current stdout output as a preserved contract by default -- the safest default when no user answer is available.

## Open Questions / Risks
- All five questions below are unanswered. A wrong answer on Q3 or Q4 changes what "correct" output means and therefore what the optimisation is allowed to do.
- No profiling data was supplied (`analysis/user-profiling-data/` is empty) and the user could not be prompted for it; Phase 2 runs as static analysis only.

---

## Method note

Phase 1 of the performance orchestrator calls for up to five clarifying questions via
`AskUserQuestion`. That tool is not present in this session's toolset (confirmed via
`ToolSearch`), and the session is non-interactive. Rather than stall, the questions are
recorded here with explicit working assumptions. Nothing downstream should treat these
assumptions as user-confirmed.

