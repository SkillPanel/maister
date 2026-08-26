# Research Report: Maister v3 Directions

**Research type**: Mixed (technical + requirements + literature) | **Date**: 2026-08-12 | **Task**: `.maister/tasks/research/2026-08-12-maister-v3-directions`

## TL;DR
The six directions are really three: (1) **cut the instruction surface ~50%** (D1 - independently corroborated at ~52% / 50-60%, mandated by the vendor's own "too prescriptive degrades model output" guidance, with rot bugs proving the duplication is unmaintainable); (2) **one declarative workflow mechanism** (D2/D5/D6 collapse into a single workflow-file artifact interpreted by the existing orchestrator kernel - hand-authored, chained, or AI-generated); (3) **umbrella coordination** (D3 has the strongest demand evidence - the user hand-built a parallel plugin - and is now natively feasible via `claude --bg`/`-p` dispatch; D4 attaches at its boundaries as tracker intake/close-out only). Recommended order: D1 -> workflow engine -> umbrella dispatch -> thin D6 planner -> minimal D4.

## Key Decisions
- **D2/D5/D6 are one mechanism** - one declarative workflow file + one engine, at three ambition levels distinguished only by who writes the file; do not design them as three features.
- **D3+D4 share a substrate** (dispatch envelope + cross-project state) **but D4 is descoped** to intake/close-out - tracker-as-agent-channel has zero observed demand; files/PR-ordering fill that role today.
- **D1 goes first** - it shrinks and de-rots everything later layers touch; gate enforcement must move from ~15k tokens of repeated prose to deterministic hooks *before* the text is cut.
- **Session, not subagent, is the cross-project dispatch unit** - confirmed independently by platform docs (subagents are cwd-pinned) and by the user's empirical agent-deck workaround.

## Open Questions / Risks
- Gate-compliance after the cut rests on hook-based enforcement (unproven; validate with `skill-creator` evals) - the codebase documents a model that read the rule and still skipped gates.
- All demand evidence for D3/D4/D5 comes from one power user (skillpanel-guru); generalization confidence Medium.
- Engine strategy (LLM-interpreted YAML vs compile-to-native platform workflows) unresolved - native workflows forbid mid-run user gates and cross-directory stages.
- Dynamic fan-out (`foreach:` one node per member repo) has no static-YAML donor pattern; unattended dispatch is unsolved on every substrate (workers pause at commit/push permissions).

---

## Contents
1. [Executive Summary](#1-executive-summary)
2. [Research Objectives](#2-research-objectives)
3. [Methodology](#3-methodology)
4. [Per-Direction Assessments](#4-per-direction-assessments)
5. [Overlap Resolution](#5-overlap-resolution)
6. [Candidate Shape for v3](#6-candidate-shape-for-v3)
7. [Prioritization Rationale](#7-prioritization-rationale)
8. [Gaps and Uncertainties](#8-gaps-and-uncertainties)
9. [Open Questions for the Design Phase](#9-open-questions-for-the-design-phase)
10. [Appendices](#10-appendices)

---
