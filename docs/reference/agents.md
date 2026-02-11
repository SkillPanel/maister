# Agents Reference

Complete reference of all specialized agents (subagents) in the AI SDLC plugin.

## Overview

Agents are specialized subagents that perform focused tasks like analysis, planning, or verification. They are invoked by skills and return structured results.

## Agent Categories

### Analysis Agents

**Purpose**: Pre-phase analysis to establish baselines

| Agent | Purpose | Invoked By | Output |
|-------|---------|------------|--------|
| **project-analyzer** | Deep codebase analysis for documentation generation | docs-manager (init-sdlc) | Project analysis report |
| **bottleneck-analyzer** | Identify performance bottlenecks (N+1 queries, missing indexes) | performance-orchestrator | optimization-plan.md |
| **gap-analyzer** | Gap detection and user journey impact analysis | development-orchestrator | gap-analysis.md |

### Planning Agents

**Purpose**: Create detailed plans for execution

| Agent | Purpose | Invoked By | Output |
|-------|---------|------------|--------|
| **research-planner** | Research methodology and data sources | research-orchestrator | research-plan.md |
| **implementation-changes-planner** | Detailed change plans without modifying files | implementer | change-plan.md |

### Verification Agents

**Purpose**: Post-implementation verification (read-only)

| Agent | Purpose | Invoked By | Output |
|-------|---------|------------|--------|
| **e2e-test-verifier** | Browser-based E2E testing with Playwright | development-orchestrator (optional) | e2e-verification-report.md |
| **spec-auditor** | Independent specification audit | Standalone or orchestrators | spec-audit-report.md |

### Utility Agents

**Purpose**: Helper agents for specialized tasks

| Agent | Purpose | Invoked By | Output |
|-------|---------|------------|--------|
| **task-classifier** | Auto-classify task descriptions into task types | /work command | Classification with confidence |
| **ui-mockup-generator** | ASCII mockups showing UI integration | development-orchestrator | ui-mockups.md |
| **user-docs-generator** | User documentation with screenshots | development-orchestrator (optional) | user-guide.md |
| **information-gatherer** | Multi-source data collection with citations | research-orchestrator | findings/*.md |
| **research-synthesizer** | Research findings synthesis | research-orchestrator | synthesis.md, research-report.md |
| **code-quality-pragmatist** | Over-engineering and complexity detection | implementation-verifier | pragmatic-review-report.md |
| **reality-assessor** | Multi-agent validation orchestrator | implementation-verifier | reality-assessment-report.md |

---

## Analysis Agents Details

### project-analyzer
**Deep codebase analysis for documentation generation**

**Capabilities**:
- Project type classification (new/existing/legacy)
- Tech stack detection (languages, frameworks, databases, tools)
- Architecture discovery (MVC, layered, microservices)
- Conventions analysis (naming, code organization, style)
- Current state assessment (strengths, weaknesses, technical debt)

**Tools**: Read, Glob, Grep, Bash (read-only), WebFetch

**Philosophy**: Evidence-based analysis. Every finding references actual code.

[Agent Documentation](../../agents/project-analyzer.md)

---

### bottleneck-analyzer
**Identifies performance bottlenecks**

**Detects**:
- N+1 query patterns
- Missing database indexes
- Inefficient algorithms
- Memory leaks
- Blocking I/O

**Prioritization**: Impact vs Effort matrix

**Tools**: Read, Grep, Glob, Bash (read-only)

[Agent Documentation](../../agents/bottleneck-analyzer.md)

---

### gap-analyzer
**Compares current vs desired state**

**Analyzes**:
- Enhancement type classification (additive/modificative/refactor-based)
- User journey impact assessment
- Data entity lifecycle analysis (3-layer verification)
- Orphaned feature detection
- Discoverability scoring

**Critical Feature**: Detects incomplete features (e.g., display without input mechanism)

**Tools**: Read, Glob, Grep, Bash, AskUserQuestion

[Agent Documentation](../../agents/gap-analyzer.md)

---

## Verification Agents Details

All verification agents are **strictly read-only** - they report issues but never fix them.

### e2e-test-verifier
**Browser-based E2E testing with Playwright**

**Tests**:
- User stories from spec
- Acceptance criteria
- UI behavior
- JavaScript errors

**Evidence**: Screenshots of each step

**Tools**: Read, Write, Bash, Playwright MCP tools

[Agent Documentation](../../agents/e2e-test-verifier.md)

---

### spec-auditor
**Independent specification audit with senior auditor perspective**

**Verifies**:
- Completeness
- Ambiguity detection
- Implementability
- External verification (Azure/GitHub CLI)

**Philosophy**: Never trusts claims - examines codebase for evidence

**Tools**: Read, Grep, Glob, Bash, Azure CLI, GitHub CLI

[Agent Documentation](../../agents/spec-auditor.md)

---

## Related Resources

- [Commands Reference](commands.md) - Commands that invoke agents
- [Skills Reference](skills.md) - Skills that delegate to agents
- [Architecture](../Architecture.md) - Agent execution model

---

**Complete reference for all AI SDLC plugin agents**
