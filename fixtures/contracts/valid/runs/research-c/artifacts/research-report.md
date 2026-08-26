# Research Report: Maister GUI Options

**Type**: Mixed (technical + requirements + literature) | **Date**: 2026-08-25 | **Task**: `.maister/tasks/research/2026-08-25-maister-gui-options` | **Overall confidence: High**

## TL;DR
**Build fresh (closed-source) as a local daemon + browser SPA - do not base on or fork any existing tool.** Nothing in the landscape (agent-deck, cezar, 16 OSS tools) models multi-phase workflows with gates; all are session/worktree-shaped, and 4 of 8 starting candidates died, stalled, or pivoted within ~12 months. Borrow aggressively instead: vendor cezar's provider-normalization layer (MIT - mappers, golden fixtures, parity doctrine), re-implement agent-deck's six proven fleet features over maister contracts, and follow the npx-daemon platform archetype Vibe Kanban validated at 27.9k stars. v1 is a read-only observer over `.maister/**` files + a deep-link launcher into per-task dashboards; all session control routes through provider surfaces (all three providers satisfy one common adapter contract); the daemon becomes the org-central fleet agent later without a rewrite.

## Key Decisions
- **Build approach: build fresh + borrow** - no candidate reached base/fork; rejections are architecture-fit and upstream-mortality driven, not license driven (all finalists are MIT/Apache-2.0).
- **Platform: local daemon + browser SPA** (TypeScript, single-binary/npm distribution) - the only platform that natively embeds the existing per-task `dashboard.html` (serve-and-iframe), avoids the desktop signing wall, and makes org-central an additive step; a Tauri/Electron shell can wrap the same URL later (deferred, not rejected).
- **Provider abstraction: thread -> turn -> item + async pending-approval entity**, in the daemon from day one - independently converged on by cezar's shipped protocol and the provider-surfaces capability analysis; seed it by vendoring cezar's normalization layer.
- **v1 is read-only over maister files** - writes would violate single-writer discipline and hook-enforced gate ordering; future write paths go through the ledger's 7 operations only.
- **Complement boundary enforced**: the GUI never re-renders per-task or per-artifact views - it serves task dirs over its own origin and iframes/deep-links the built-in dashboard and HTML companions.

## Open Questions / Risks
- **Main-session-id gap**: no maister contract records the main workflow session id - session<->task correlation is heuristic (cwd/hook matching) until an additive engine contract closes it. Top design-phase item.
- **Gate answering**: no legitimate external channel exists (hooks enforce decision-before-state); v1 observes gates and deep-links the human to the session - remote gate-answering is engine contract work, not a GUI hack.
- **Codex app-server volatility**: the richest control surface is experimental-flagged with per-version schemas (local 0.40.0 predates it entirely) - adapter needs capability probing and a version floor; `codex exec --json` is the stable floor.
- **Claude Agent SDK ToS/branding** constraints if embedded in a closed-source product - v1 posture is spawning the user's own CLI + hook shims; counsel review before SDK embedding.
- Cost telemetry is absent from every maister contract and inconsistent across providers (Codex: tokens, no USD) - the GUI must own cost normalization.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Research Objectives](#2-research-objectives)
3. [Methodology](#3-methodology)
4. [Findings](#4-findings)
5. [Candidate Assessments (Reuse Scorecards)](#5-candidate-assessments-reuse-scorecards)
6. [Option Set: Build Approach x Platform](#6-option-set-build-approach--platform)
7. [Recommended Approach](#7-recommended-approach)
8. [v1 Scope Implications](#8-v1-scope-implications)
9. [Local -> Org-Central Evolution Path](#9-local--org-central-evolution-path)
10. [Gaps and Uncertainties](#10-gaps-and-uncertainties)
11. [Open Questions for Brainstorming / Design](#11-open-questions-for-brainstorming--design)
12. [Appendices](#12-appendices)

---
