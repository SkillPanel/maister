---
name: maister:standards-discover
description: Discover coding standards from project configuration files, code patterns, documentation, and external sources (PRs, CI/CD)
---

# Standards Discovery Skill

Analyzes multiple project sources in parallel to discover coding standards, conventions, and best practices. Aggregates findings with confidence scoring, asks the user which to keep, and applies approved standards via `docs-manager` skill.

## Core Principles

1. **Parallel Execution**: Launch discovery subagents concurrently, never one after another
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
2. **Check prerequisites**: Verify `.maister/docs/` exists. If not, ask once — "Set up Maister first? (runs the setup, then this)": "Set it up (Recommended)" runs `maister:init` with the Skill tool, which ends by running a full discovery; any other answer stops here
3. **Read existing standards** from `.maister/docs/INDEX.md` to identify updates vs creates and avoid duplicates; Phase 6 reads the rules of the files a finding lands in, to find the ones it contradicts
4. **Print the plan as one progress line** — scope, sources and rough time — and go on: the user asked for the discovery, so there is nothing to confirm

---

### Phase 2-5: Parallel Discovery

Launch all applicable subagents in one message so they run in parallel.

**Step 1: Determine which phases to run** based on scope and flags.

**Step 1.5: Create temp output directory** — Run `mktemp -d` via Bash to create a unique temp directory for this invocation. Store the path exactly as it prints — it differs per host and per run, so never assume `/tmp` or write a fixed path in its place. Each subagent will write its results to a dedicated file in this directory: `{tmpdir}/config.yml`, `{tmpdir}/code.yml`, `{tmpdir}/docs.yml`, `{tmpdir}/external.yml`.

**Step 2: Read prompt templates**

Read the template for each phase you will run — they define the YAML output schema the aggregation step depends on. Read each by its absolute path under this skill's base directory; never `cd` into the skill to read them, since every later command, the engine's included, would then run from there instead of the project root:

| Phase | Condition | Read This File |
|-------|-----------|----------------|
| 2: Config Analysis | Always | `references/config-analyzer-prompt.md` |
| 3: Code Patterns | scope != `quick` | `references/code-pattern-prompt.md` |
| 4: Documentation | scope != `quick` | `references/docs-extractor-prompt.md` |
| 5: External Sources | `--skip-external` not set | `references/external-analyzer-prompt.md` |

**Step 3: Adapt templates** — Replace `[scope]`, `[confidence]`, and other placeholders with actual values. Replace the `[output_file]` placeholder in each template with the actual temp file path for that phase (e.g., `{tmpdir}/config.yml`).

**Step 4: Launch subagents in parallel** — Use the Task tool with `subagent_type: general-purpose` for each phase, each with the model and effort `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=general-purpose --host=claude` prints once just before the launch (`../orchestrator-framework/references/orchestrator-patterns.md` § 1, *Model and Effort on Every Agent Call*; likewise for the `docs-operator` call below).

Every applicable phase is a subagent of its own, whatever the size of the repository: a small repository, one commit or no linter config is no reason to run a phase's discovery in this session or to write its file yourself. The phases read different sources than this session has in view, which is what makes their findings worth scoring.

**Step 5: Wait** for ALL subagents to complete, then read each temp file using the Read tool to collect findings. A phase whose file is missing did not run: dispatch it once more, and report it as not run if it is still missing.

**Step 6: Display progress** — Show count of findings per phase.

---

### Phase 6: Aggregation & Deduplication

**Read** `references/aggregation-strategy.md` for confidence scoring methodology.

1. **Combine** all findings from Phases 2-5
2. **Deduplicate** by grouping on `category + standard_name` — merge evidence and sources
3. **Calculate final confidence** using multi-factor scoring from the reference
4. **Detect conflicts** — flag contradictory standards (e.g., ESLint says semicolons, Prettier says no)
   - **Against the standards already written.** Read the rules in each existing standards file a finding lands in, starter rules copied at setup included. A finding that says the opposite of a rule there is a conflict too, even with no second finding against it: "Implement versioning (URL path or headers)" in `backend/api.md` against discovered plural, unversioned paths is one. Writing the finding beside the rule, or merging it in, would leave two rules that cannot both hold, and nothing later reports them.
5. **Categorize** into High (>= 80%), Medium (60-79%), Low (< 60%)
6. **Filter** by `--confidence` threshold

Display aggregation summary: total raw findings, unique standards, conflicts detected.

---

### Phase 7: User Review & Approval

Print one line of counts (high, medium, conflicts, below the threshold), then ask. Every question carries its own findings — never a table above it for the question to point at. Name each standard in plain words, never as `category/file` alone.

- **High confidence (>= 80%)**: one question — "Apply these N standards?" with one line each in the question (what the standard says, in a few words). "Apply all N (Recommended)" / "Go through them". Going through them uses the medium-confidence pages below.

- **Medium confidence (60-79%)**: pages of up to four findings, one question per finding: what the standard says, its evidence in a line (where it was seen, how often) and its sources. Options "Accept (Recommended)" when the evidence is consistent, "Accept with a change" (the change is the follow-up answer), "Skip", and "Skip the rest" — this finding and every one not yet asked, so a long list never has to be walked to its end.
<!-- rich-picker -->
  Each Accept option's preview shows the standard as it would be written, with its preferred and avoided examples.
<!-- /rich-picker -->
<!-- plain-picker
  A page is one form of up to four properties, each a choice of its options — `oneOf` entries of `const` (the option's id) and `title` (its label, "(Recommended)" on the recommended one), never a bare `enum` of ids; the standard's rule, its evidence and its examples go in each property's description, since the form shows labels only.
-->

- **Below the threshold**: not asked. The summary report (Phase 9) lists them so a later run with a lower `--confidence` can pick them up.

- **Conflicts**: pages of up to four, one question per conflict, both sides in the question with their evidence and sources. The better-evidenced side is recommended, its reason in its description; the other side and "Skip" are the remaining options, and a custom rule is the Other answer.
  - A conflict with a rule already written asks which rule holds. One side is the written rule — its file, its heading and where it came from (a starter rule, or the project's own) — and the other the discovered one with its evidence. The options are "Use the discovered rule" (it replaces the written one), "Keep the written rule" (the finding is dropped) and "Skip" (both stay as they are, and Phase 9 lists the pair as unsettled). Discovered evidence from the code itself is recommended over a starter rule nobody chose for this project; a rule the project wrote itself is recommended over a pattern seen in a few files. A conflict is never decided without asking, `--auto-apply` included.

If `--auto-apply` is set, automatically approve findings with confidence >= 90% and only ask about the rest.

---

### Phase 8: Application

Write standard files through the docs-operator subagent rather than Write/Edit, so INDEX.md and CLAUDE.md stay consistent with the files.

1. **Prepare content** for every approved standard, and for every conflict with a written rule settled for the discovered side, the replacement: the written rule's section rewritten as the discovered rule, never a second section beside it — standard name, description, examples (preferred/avoid), rationale from evidence, source citations. Format each as a `###` heading with a 1-10 line description (excluding code snippets); group related standards into one topic file; add brief code examples only where they clarify. A rule cites at most one example path — never an inventory of call sites, a date or a ticket reference. Note create vs update for each target file, and prefer a new topic file (or a sub-folder for a topic with several) over appending to a file already past about 12 KB or 15 rules.
2. **Invoke the `docs-operator` subagent once** via Task tool (subagent_type: `maister:docs-operator`, model and effort from `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude`, run just before) with all prepared standards, instructing it to apply each create/update (merging updates with existing content), then refresh INDEX.md with every written path as changed — `check` is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, the plugin root two levels above this skill's base directory, as an absolute path — and confirm CLAUDE.md references the standards directory.

Display application summary: created count, updated count, total active.

---

### Phase 9: Summary Report

Display final results:
- Sources analyzed (config files, code files sampled, docs parsed, PRs reviewed)
- Standards applied (created/updated counts by category)
- Standards skipped (low confidence, user declined)
- Conflicts with written rules: each settled one, with the rule that now holds, and each skipped one, both rules named with their files, for the user to settle
- Next steps (review, commit, re-run schedule)

---

## Error Handling

| Situation | Strategy |
|-----------|----------|
| `.maister/docs/` missing | Ask "Set up Maister first?" (Phase 1); stop if declined |
| gh CLI unavailable | Skip PR analysis, continue with other sources |
| GitHub API rate limit | Skip PR analysis, note in report |
| Config file parse error | Skip that file, log warning, continue |
| No standards found | Suggest lowering threshold or checking specific scope |
| docs-operator fails | Ask with the cause in the question: "Retry (Recommended)" / "Skip these standards" |
| docs-operator returns `decisions_needed` | Ask each in the same form, then call it again with the answers |
| Subagent returns empty | Note in report, proceed with available findings |

---

## Integration

| Integrates With | How |
|-----------------|-----|
| `docs-manager` skill | Creates/updates standard files, refreshes INDEX.md |
| `implementation-plan-executor` skill | Discovered standards immediately available via INDEX.md |
| `standards-update` command | Complementary: discover = automated bulk, update = manual single |

---

## Examples

```bash
# Full discovery (default)
/maister:standards-discover

# Quick scan (config files only)
/maister:standards-discover --scope=quick

# Frontend standards only
/maister:standards-discover --scope=frontend

# High confidence, auto-apply
/maister:standards-discover --confidence=80 --auto-apply

# Skip external analysis (offline/no GitHub)
/maister:standards-discover --skip-external
```
