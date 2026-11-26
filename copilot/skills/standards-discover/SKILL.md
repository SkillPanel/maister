---
name: standards-discover
description: Discover coding standards from project configuration files, code patterns, documentation, and external sources (PRs, CI/CD)
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a subfolder of a run, or `.maister/docs/` or `.github/` on a fresh project — run `mkdir -p` on that folder first. A run's own folder is never one: the freeze creates it.

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`, and a model printed as `session` replaced by your own model id. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

# Standards Discovery Skill

Analyzes multiple project sources in parallel to discover coding standards, conventions, and best practices. Aggregates findings with confidence scoring, asks the user which to keep, and applies approved standards via `docs-manager` skill.

## Core Principles

1. **Parallel Execution**: Launch discovery subagents concurrently, never one after another
2. **Evidence-Based**: Every finding must cite specific files, line counts, or config rules as evidence
3. **Confidence Scoring**: Multi-factor confidence based on source count, consistency, and explicitness
4. **Deduplication**: Same standard found across sources merges into single finding with combined evidence
5. **Graceful Degradation**: Skip unavailable sources (no gh CLI, no docs) without failing entire workflow — a source that is not there is skipped and named, never an error
6. **Node Is Enough**: Every command this skill runs is a plain read-only command or one of its Node scripts by absolute path, each run as a command of its own — no `&&`, `;`, pipe, here-string or inline `node -e` script — so it reads the same in bash, PowerShell and cmd.exe. Nothing here calls `python` or needs `gh`: a host may have neither

---

## Input Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--scope` | `full` | Discovery scope: `full`, `quick`, a group the group table holds (Phase 1 lists them), or a folder already under `.maister/docs/standards/` |
| `--confidence` | `60` | Minimum confidence threshold (0-100) for displaying findings |
| `--auto-apply` | `false` | Auto-apply standards with confidence >= 90% without asking |
| `--skip-external` | `false` | Skip GitHub PR analysis and CI/CD sources |
| `--pr-count` | `20` | Number of recent merged PRs to analyze |

**Scope determines which phases run:**

| Scope | Config (P1) | Code (P2) | Docs (P3) | External (P4) |
|-------|-------------|-----------|-----------|----------------|
| `full` | Yes | Yes | Yes | Yes |
| `quick` | Yes | No | No | No |
| `<group>` | Configs bearing on the group | Files its filter names | Yes | Yes |
| `<folder of the project's own>` | Relevant configs | Files matching the folder's subject | Yes | Yes |

Any other `--scope` value is refused in Phase 1, before any scan, naming the valid values.

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
2. **Check prerequisites**: Verify `.maister/docs/` exists. If not, ask once — "Set up Maister first? (runs the setup, then this)": "Set it up (Recommended)" runs `init` with the Skill tool, which ends by running a full discovery; "Not now" stops here, and so does any other answer
2.5. **Read the groups** with `node <plugin root>/skills/docs-manager/scripts/standards.mjs groups` from the project root, the plugin root two levels above this skill's base directory, as a command of its own. Its `groups` list (each id, title and filter) and the `custom` entries of its `present` list are the group list. A `--scope` that is neither `full`, `quick`, one of those groups nor one of those folders stops here, naming the valid values. A failure of the call stops discovery with its message.
3. **Read existing standards** from `.maister/docs/INDEX.md` to identify updates vs creates and avoid duplicates; Phase 6 reads the rules of the files a finding lands in, to find the ones it contradicts
4. **Check the external sources** — unless `--skip-external` is set or the scope is `quick` — with `node <base directory>/scripts/external-sources.mjs` from the project root (this skill's base directory, as an absolute path). Its JSON says whether the external phase has anything to read (`scan`): pull requests through a signed-in `gh` and a git remote, CI configuration, or pre-commit hooks, and why pull requests are or are not readable. A missing or signed-out `gh` is a reported state, not an error. With `scan` false, Phase 5 is skipped, and Phase 9 names it with the reason
5. **Print the plan as one progress line** — scope and sources, a skipped external phase with its reason — and go on: the user asked for the discovery, so there is nothing to confirm

---

### Phase 2-5: Parallel Discovery

Launch all applicable subagents in one message so they run in parallel.

**Step 1: Determine which phases to run** based on scope and flags.

**Step 1.5: Create the output directory** — Run `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs scratch-dir --for=standards-discover` from the project root, as a command of its own. It makes a fresh directory under the project's `.maister/scratch/`, which git ignores, and prints its absolute path: store that path exactly as printed, as `{tmpdir}`. The files in it are read back, so it is never the system temp directory: a read outside the project can stop the run for a permission prompt. Each subagent will write its results to a dedicated file in this directory: `{tmpdir}/config.yml`, `{tmpdir}/code.yml`, `{tmpdir}/docs.yml`, `{tmpdir}/external.yml`.

**Step 2: Name the phase briefs**

Each phase's brief is a template under this skill's base directory: which source to scan, what to look for, the sampling bounds, the confidence range and the YAML schema the aggregation step depends on. Name each by its absolute path — never `cd` into the skill, since every later command, the engine's included, would then run from there instead of the project root. This session does not read, fill in or condense a brief: the scanner reads it itself, so nothing in it is lost on the way.

| Phase | Condition | Brief |
|-------|-----------|-------|
| 2: Config Analysis | Always | `references/config-analyzer-prompt.md` |
| 3: Code Patterns | scope != `quick` | `references/code-pattern-prompt.md` |
| 4: Documentation | scope != `quick` | `references/docs-extractor-prompt.md` |
| 5: External Sources | `--skip-external` not set, scope != `quick`, and the external sources check found something to read | `references/external-analyzer-prompt.md` |

**Step 3: Launch subagents in parallel** — Use the Task tool with `agent_type: maister:standards-scanner` for each phase. Its prompt is these lines, each filled in, and no part of the brief itself — never pasted, reworded or summed up:
- `brief:` the phase brief's absolute path
- `project_root:` the project root's absolute path
- `output_file:` the phase's file in `{tmpdir}`
- `scope:` the discovery scope, and `confidence:` the threshold
- `groups:` the group list, each table group as `<id> (<title>)` and each folder of the project's own by name, comma-separated
- `files:` for a group scope, that group's filter joined with `; `, sent to the config and code scanners only; omitted for `full`, `quick`, `global` (empty filter) and a folder of the project's own. The docs and external scanners never get a `files:` line
- `checker:` the absolute path of `scripts/check-findings.mjs` under this skill's base directory, which the scanner runs on its file
- `pr_count:` the number of pull requests, and `github:` `available` when the external sources check found pull requests readable, otherwise its reason — for the external phase only

The scanner carries the rest itself — read-only, absolute paths, one file written. Each call carries the model and effort `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:standards-scanner --host=copilot` prints once just before the launch, run as a command of its own (`../workflow-engine/references/verbs.md` § *Model and effort on every agent call*; likewise for the `docs-operator` call below).

Every applicable phase is a subagent of its own, whatever the size of the repository: a small repository, one commit or no linter config is no reason to run a phase's discovery in this session or to write its file yourself. The phases read different sources than this session has in view, which is what makes their findings worth scoring.

**Step 4: Wait** for ALL subagents to complete, then check each output file with `node <checker> <file>` — one command per file — and read each one that passes using the Read tool to collect findings. The checker needs only Node; never check a file with `python` or an inline script of your own. A phase whose file is missing or fails the check did not run: dispatch it once more, and report it as not run if it is still missing or failing.

**Step 5: Display progress** — Show count of findings per phase.

---

### Phase 6: Aggregation & Deduplication

**Print** the confidence scoring methodology, as Step 2.5 runs a command, never with the read tool: `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs reference --at="skills/standards-discover/references/aggregation-strategy.md"`.

1. **Combine** all findings from Phases 2-5
2. **Deduplicate** by grouping on `category + standard_name` — merge evidence and sources
3. **Calculate final confidence** using multi-factor scoring from the reference
4. **Detect conflicts** — flag contradictory standards (e.g., the contributing guide asks for default exports while the code uses named exports throughout)
   - **Against the standards already written.** Read the rules in each existing standards file a finding lands in, starter rules copied at setup included. A finding that says the opposite of a rule there is a conflict too, even with no second finding against it: "Use plural nouns for resources" in `backend/api.md` against discovered singular resource paths (`/user/{id}`) is one. Writing the finding beside the rule, or merging it in, would leave two rules that cannot both hold, and nothing later reports them.
5. **Categorize** into High (>= 80%), Medium (60-79%), Low (< 60%)
6. **Filter** by `--confidence` threshold
7. **Write the list once**, as `{tmpdir}/findings.yml`: every finding after the merge, numbered, each with its tier — high, medium, conflict or below the threshold, exactly one — its plain name, what it says and its sources. A finding in a conflict is listed once, as the conflict. This list is the one count from here to the close: every number Phases 7 to 9 print is read from it, never recounted from memory, and nothing is asked, written or reported that it does not hold.

A finding merged into another at the dedupe is said once, in Phase 7's count line, and never again.

---

### Phase 7: User Review & Approval

Print one line of counts from the list, then ask: "14 raw findings, 3 merged into others — 2 high, 7 medium, 2 conflicts, 0 below the threshold" (the merge clause only when one was merged). The counts split the findings once: a finding in a conflict counts as a conflict only, never also as high or medium, and each count is the number of findings asked or listed under it — the high question lists exactly the N it names, the medium pages ask every medium finding, the conflict pages every conflict, and Phase 9 lists every finding below the threshold. A count with nothing asked or listed under it is wrong: correct the count before asking. Each entry of the list is asked as one question, never split into two or merged with another, and nothing is asked that the list does not hold; a question that names its place counts against the list ("Medium 3 of 7", the total the count line printed, plus the high ones when the user chose to go through them). Each answer is recorded against its entry in the list, an accepted change keeping the entry's number. Every question carries its own findings — never a table above it for the question to point at. Name each standard in plain words, never as `category/file` alone.

- **High confidence (>= 80%)**: one question — "Apply these N standards?" with one line each in the question (what the standard says, in a few words). "Apply all N (Recommended)" / "Go through them". Going through them uses the medium-confidence pages below.

- **Medium confidence (60-79%)**: pages of up to four findings, one question per finding: what the standard says, its evidence in a line (where it was seen, how often) and its sources. Options "Accept (Recommended)" when the evidence is consistent, "Accept with a change" (the change is the follow-up answer), "Skip", and "Skip the rest" — this finding and every one not yet asked, so a long list never has to be walked to its end.
  A page is one form of up to four properties, each `"type": "string"` — the question tool refuses a property without its type — and a choice of its options: `oneOf` entries of `const` (the option's id) and `title` (its label, "(Recommended)" on the recommended one), never a bare `enum` of ids; the standard's rule, its evidence and its examples go in each property's description, since the form shows labels only.

- **Below the threshold**: not asked. The summary report (Phase 9) lists them so a later run with a lower `--confidence` can pick them up.

- **Conflicts**: pages of up to four, one question per conflict, both sides in the question with their evidence and sources. The better-evidenced side is recommended, its reason in its description; the other side and "Skip" are the remaining options, and a custom rule is the Other answer.
  - A conflict with a rule already written asks which rule holds. One side is the written rule — its file, its heading and where it came from (a starter rule, or the project's own) — and the other the discovered one with its evidence. The options are "Use the discovered rule" (it replaces the written one), "Keep the written rule" (the finding is dropped) and "Skip" (both stay as they are, and Phase 9 lists the pair as unsettled). Discovered evidence from the code itself is recommended over a starter rule nobody chose for this project; a rule the project wrote itself is recommended over a pattern seen in a few files. A conflict is never decided without asking, `--auto-apply` included.

If `--auto-apply` is set, automatically approve findings with confidence >= 90% and only ask about the rest.

---

### Phase 8: Application

Write standard files through the docs-operator subagent rather than Write/Edit, so INDEX.md and .github/copilot-instructions.md stay consistent with the files.

1. **Prepare content** for every approved standard, and for every conflict with a written rule settled for the discovered side, the replacement: the written rule's section rewritten as the discovered rule, never a second section beside it — standard name, description, examples (preferred/avoid), rationale from evidence, source citations. Format each as a `###` heading with a 1-10 line description (excluding code snippets); group related standards into one topic file; add brief code examples only where they clarify. A rule cites at most one example path — never an inventory of call sites, a date or a ticket reference. Note create vs update for each target file; a finding's target folder is the group it landed in, and the docs operator creates the folder when it is absent, and prefer a new topic file (or a sub-folder for a topic with several) over appending to a file already past about 12 KB or 15 rules. A rule already written — a starter rule or the project's own — is replaced or removed only through a conflict the user settled for the discovered side. A finding that overlaps one without contradicting it is written beside it, or added to it with its heading and its text kept; it is never folded into a new section that takes the written one's place.
2. **Invoke the `docs-operator` subagent once** via Task tool (agent_type: `maister:docs-operator`, model and effort from `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=copilot`, run just before) with all prepared standards, instructing it to apply each create/update — adding to existing content, every section the call does not name for replacement kept as it is, and naming each written rule a settled conflict replaces — then refresh INDEX.md with every written path as changed — `check` is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, the plugin root two levels above this skill's base directory, as an absolute path — and confirm .github/copilot-instructions.md references the standards directory.

Display the application summary in findings, read from the list: "N findings applied, in F files (c created, u updated)". A finding added to a rule already written is still one applied finding. An approved finding that was not written is named here, once, with the reason, and counted as not applied.

---

### Phase 9: Summary Report

Display final results. Every count is read from the list, and the counts add up to the count line's total: applied, skipped, below the threshold, and conflicts settled or left unsettled. Nothing merged or dropped is said again here; it was said where it happened.
- Sources analyzed (config files, code files sampled, docs parsed, PRs reviewed), and each source skipped with its reason — no `gh`, `gh` not signed in, no remote, nothing external to read
- Findings applied, by group
- Findings skipped (user declined, or skipped with the rest) and below the threshold, each named
- Conflicts with written rules: each settled one, with the rule that now holds, and each skipped one, both rules named with their files, for the user to settle
- Next steps (review, commit, re-run schedule)

---

## Error Handling

| Situation | Strategy |
|-----------|----------|
| `.maister/docs/` missing | Ask "Set up Maister first?" (Phase 1); stop if declined |
| gh CLI missing or signed out | Not an error: the external sources check reports it, the external scan skips pull requests (or the whole phase, with nothing else to read), and the summary names the skipped source |
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
