---
name: standards-discover
description: Discover coding standards from project configuration files, code patterns, documentation, and external sources (PRs, CI/CD)
---

# Standards Discovery Skill

Analyzes multiple project sources in parallel to discover coding standards, conventions, and best practices. Aggregates findings with confidence scoring, presents for user approval, and applies approved standards via `docs-manager` skill.

## Core Principles

1. **Parallel Execution**: Launch discovery subagents concurrently for speed (~45-60s vs ~2-4min sequential)
2. **Evidence-Based**: Every finding must cite specific files, line counts, or config rules as evidence
3. **Confidence Scoring**: Multi-factor confidence based on source count, consistency, and explicitness
4. **Deduplication**: Same standard found across sources merges into single finding with combined evidence
5. **Graceful Degradation**: Skip unavailable sources (no gh CLI, no docs) without failing entire workflow

---

## Input Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--scope` | `full` | Discovery scope: `full`, `quick`, or any category name (baseline: `global`, `frontend`, `backend`, `testing`; custom categories also supported) |
| `--confidence` | `60` | Minimum confidence threshold (0-100) for displaying findings |
| `--auto-apply` | `false` | Auto-apply standards with confidence >= 90% without asking |
| `--skip-external` | `false` | Skip GitHub PR analysis and CI/CD sources |
| `--pr-count` | `20` | Number of recent merged PRs to analyze |

**Scope determines which phases run:**

| Scope | Config (P1) | Code (P2) | Docs (P3) | External (P4) |
|-------|-------------|-----------|-----------|----------------|
| `full` | Yes | Yes | Yes | Yes |
| `global` | Yes | Yes (limited) | Yes | Yes |
| `frontend` | FE configs | FE files | Yes | Yes |
| `backend` | BE configs | BE files | Yes | Yes |
| `testing` | Test configs | Test files | Yes | Yes |
| `quick` | Yes | No | No | No |
| `[custom]` | Relevant configs | Filtered files | Yes | Yes |

Custom scope values are matched against existing `.maister/docs/standards/*/` directories and filter analysis to relevant files.

---

## Phase Configuration

| Phase | Subject | activeForm |
|-------|---------|------------|
| 1 | Plan discovery scope | Planning discovery scope |
| 2 | Analyze configuration files | Analyzing configuration files |
| 3 | Mine code patterns | Mining code patterns |
| 4 | Extract documentation standards | Extracting documentation standards |
| 5 | Analyze external sources | Analyzing external sources |
| 6 | Aggregate & deduplicate findings | Aggregating findings |
| 7 | Review findings with user | Reviewing findings |
| 8 | Apply approved standards | Applying standards |
| 9 | Generate summary report | Generating summary |

**Task Tracking**: At start of Phase 1, use `TaskCreate` for all phases above (pending). Set dependencies: Phases 2-5 blocked by Phase 1 (they run in parallel after planning). Phase 6 blocked by Phases 2-5. Phases 7-9 sequential. At each phase start: `TaskUpdate` to `in_progress`. At each phase end: `TaskUpdate` to `completed`. For phases skipped due to scope (e.g., Phases 3-4 when `--scope=quick`), mark `completed` with `metadata: {skipped: true, reason: "scope=quick"}`.

---

## Execution Workflow

### Phase 1: Planning & Initialization

1. **Parse options** from command arguments
2. **Check prerequisites**: Verify `.maister/docs/` exists. If not, offer to run `/maister:init` first
3. **Read existing standards** from `.maister/docs/INDEX.md` to identify updates vs creates and avoid duplicates
4. **Display discovery plan** showing scope, sources, and estimated time
5. **Get user confirmation** via AskUserQuestion before proceeding

---

### Phase 2-5: Parallel Discovery

> **CRITICAL: Launch all applicable subagents in ONE message for parallel execution.**

**Step 1: Determine which phases to run** based on scope and flags.

**Step 2: Read prompt templates**

> **STOP — Do NOT skip this step. Do NOT write prompts from memory.**

Use the Read tool to load ONLY the reference files for phases you will execute:

| Phase | Condition | Read This File |
|-------|-----------|----------------|
| 2: Config Analysis | Always | `references/config-analyzer-prompt.md` |
| 3: Code Patterns | scope != `quick` | `references/code-pattern-prompt.md` |
| 4: Documentation | scope != `quick` | `references/docs-extractor-prompt.md` |
| 5: External Sources | `--skip-external` not set | `references/external-analyzer-prompt.md` |

**SELF-CHECK**: Did you read the template files with the Read tool? If not, go back and read them now.

**Step 3: Adapt templates** — Replace `[scope]`, `[confidence]`, and other placeholders with actual values.

**Step 4: Launch subagents** — Use the Task tool with `subagent_type: general-purpose` and `model: haiku` for each phase. Launch ALL applicable agents in a SINGLE message.

**Step 5: Wait** for ALL subagents to complete, then collect findings from each.

**Step 6: Display progress** — Show count of findings per phase.

---

### Phase 6: Aggregation & Deduplication

**Read** `references/aggregation-strategy.md` for confidence scoring methodology.

1. **Combine** all findings from Phases 2-5
2. **Deduplicate** by grouping on `category + standard_name` — merge evidence and sources
3. **Calculate final confidence** using multi-factor scoring from the reference
4. **Detect conflicts** — flag contradictory standards (e.g., ESLint says semicolons, Prettier says no)
5. **Categorize** into High (>= 80%), Medium (60-79%), Low (< 60%)
6. **Filter** by `--confidence` threshold

Display aggregation summary: total raw findings, unique standards, conflicts detected.

---

### Phase 7: User Review & Approval

**Step 1: Present full summary table** — Before any approval prompts, output ALL findings in a table grouped by confidence level. Each group has a header with count:

```
### High Confidence (>=80%) — 5 standards

| # | Standard | Category | Score | Sources | Description |
|---|----------|----------|-------|---------|-------------|
| 1 | no-semicolons | global | 92 | config, code, docs | Omit semicolons in all JS/TS files |
| 2 | ... | ... | ... | ... | ... |

### Medium Confidence (60-79%) — 3 standards
...

### Low Confidence (<60%) — 2 standards
...

### Conflicts — 1 detected
| # | Standard | Conflict | Sources A | Sources B |
```

The **Sources** column lists all contributing sources for each finding (config, code, docs, PRs, CI, pre-commit). This gives users full visibility before making decisions.

**Step 2: Approval flow** — After the summary table:

- **High confidence (>= 80%)**: Use AskUserQuestion offering batch approval ("Apply all N high-confidence standards") or individual drill-down review. For drill-down, show full detail per finding: all evidence items with source attribution, examples (preferred/avoid), and confidence score breakdown (which factors contributed how many points).

- **Medium confidence (60-79%)**: Present each individually with full detail (evidence, examples, confidence breakdown). Use AskUserQuestion with Accept/Modify/Skip options per finding.

- **Low confidence (< threshold)**: Show the summary table rows only. Offer to expand details or skip all.

- **Conflicts**: Present each conflict showing both sides with their evidence and sources. Use AskUserQuestion to resolve (pick side A, pick side B, skip, or custom).

If `--auto-apply` is set, automatically approve findings with confidence >= 90% and only prompt for the rest.

---

### Phase 8: Application

> **DELEGATION REQUIRED**: Do NOT write standard files directly using Write/Edit tools. ALL file operations MUST go through the `docs-manager` skill.
>
> **SELF-CHECK before each file operation**: "Am I about to write a file directly? STOP — invoke docs-manager instead."

For each approved standard:

1. **Prepare content** — Standard name, description, examples (preferred/avoid), rationale from evidence, source citations. Format each standard as a `###` heading with 1-10 lines description (excluding code snippets). Group related standards into the same topic file. Add brief code examples only when they clarify the practice.
2. **Check if file exists** — Determine create vs update action
3. **Invoke `docs-manager` skill** — Pass prepared content. For creates: new file. For updates: merge new findings with existing. The docs-manager handles file writing, path conventions, and format consistency.
4. **After all standards applied, invoke `docs-manager` skill** to regenerate INDEX.md
5. **Invoke `docs-manager` skill** to verify CLAUDE.md integration — ensure standards directory is referenced

Display application summary: created count, updated count, total active.

---

### Phase 9: Summary Report

Display final results:
- Sources analyzed (config files, code files sampled, docs parsed, PRs reviewed)
- Standards applied (created/updated counts by category)
- Standards skipped (low confidence, user declined)
- Next steps (review, commit, re-run schedule)

---

## Error Handling

| Situation | Strategy |
|-----------|----------|
| `.maister/docs/` missing | Offer `/maister:init`, abort if declined |
| gh CLI unavailable | Skip PR analysis, continue with other sources |
| GitHub API rate limit | Skip PR analysis, note in report |
| Config file parse error | Skip that file, log warning, continue |
| No standards found | Suggest lowering threshold or checking specific scope |
| docs-manager fails | Offer retry/skip/cancel per standard |
| Subagent returns empty | Note in report, proceed with available findings |

---

## Integration

| Integrates With | How |
|-----------------|-----|
| `docs-manager` skill | Creates/updates standard files, regenerates INDEX.md |
| `implementer` skill | Discovered standards immediately available via INDEX.md |
| `standards-update` command | Complementary: discover = automated bulk, update = manual single |

---

## Examples

```bash
# Full discovery (default)
/maister:standards-discover

# Quick scan (config files only, ~30-60s)
/maister:standards-discover --scope=quick

# Frontend standards only
/maister:standards-discover --scope=frontend

# High confidence, auto-apply
/maister:standards-discover --confidence=80 --auto-apply

# Skip external analysis (offline/no GitHub)
/maister:standards-discover --skip-external
```
