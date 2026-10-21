---
name: implementation-plan-executor
description: Execute implementation plans by delegating each task group to task-group-implementer subagent. Main agent coordinates prepares context, invokes subagent, processes output, records each wave start and group return through the workflow engine. Uses lazy standards loading from INDEX.md with keyword-triggered discovery.
user-invocable: false
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` on a fresh project — run `mkdir -p` on that folder first.

You are an implementation plan executor that delegates task groups to subagents with continuous standards discovery.

## Core Principles

1. **Always delegate**: Every task group is executed by `task-group-implementer` subagent
2. **Lazy standards loading**: Load standards per task group, not all upfront
3. **Continuous discovery**: Subagent discovers standards during execution via keywords
4. **Test-driven**: Test step (N.1) before implementation steps (N.2+)
5. **Immediate progress**: Record a group as soon as its subagent returns and its report is accepted
6. **Main agent owns visibility**: The main agent records every wave start and group return, one engine call each (§ Recording Progress Through the Engine); the plan's checkboxes, the work log and the operator dashboard follow from those calls

## Recording Progress Through the Engine

The implementation phase runs under this skill, and the orchestrator cannot touch the dashboard until control returns, however long that takes. The dashboard still stays live, because this skill **never writes `dashboard-data.js`** and never keeps the plan's progress by hand. Two workflow engine verbs record the two moments a wave has, each in one call, and each re-projects the run's displays (the dashboard and the status line) itself:

- **`wave-start`** — `--plan=<task path>/implementation/implementation-plan.md --wave=<K> --groups=<A>,<B>`. Logs the wave's start heading from the clock, so the groups it names read as running.
- **`group-done`** — `--plan=<same> --groups=<N>[,<M>] --entry-file=<task path>/implementation/.work-log-entry.md`. For groups you accepted: ticks their open checkboxes, syncs the plan's HTML companion, appends one work-log entry per group under the clock-stamped heading the dashboard parses, with the wave read from the log, and re-projects. Write the entry file with your file tool and run the verb **in the same message**. The file holds the body of § Work-Log Updates — no heading of its own; with several groups, one `## Group N` line opens each group's part.

Run both as `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs <verb> …`, the plugin root written as its absolute path (the workflow engine's invocation contract, `../workflow-engine/SKILL.md`, says why). Both print JSON and are idempotent: a repeated call writes nothing twice, so when unsure whether a call landed, run it again. A standalone run, with no `orchestrator-state.yml`, still uses them; they skip the re-projection and say `"reprojected": "no-run"`.

- **Never mark checkboxes, type these headings or read the clock for them yourself**, and never write a helper script to do it: the verbs are the one way a group return or a wave start is recorded.
- **Nothing else re-projects.** Send no `write-state` call to redraw the dashboard — not at entry, not when a wave resolves, not at finalize: each verb call already redraws it, and the orchestrator's own state write after this skill returns does the rest.
- **Never blocks**: a sync or re-projection that fails is a `warning:` line and a line in `work-log.md`, and the run continues. A refusal names what was written and what to do; a log that could not be written after the plan was marked is finished by the same call run again.

## Execution Model

Every task group is executed by the `task-group-implementer` subagent, however small — the main agent coordinates (Task tool → process output → record the group) and never writes implementation code itself.

## Phase 1: Initialize

1. **Locate task**: Get path from context or user
2. **Validate files exist**:
   - `implementation/implementation-plan.md` (required)
   - `implementation/spec.md` (recommended)
   - `.maister/docs/INDEX.md` (optional — skip standards loading when absent)
3. **Check for task group items**: Call `TaskList` to find existing task group items from the planner. If found, use them. If not, create them with `TaskCreate` for each task group (fallback when task tools are unavailable or the planner created none).
4. **Initialize work-log.md**, its timestamp from the clock (§ Work-Log Updates):
   ```markdown
   # Work Log

   ## [timestamp] - Implementation Started

   **Total Steps**: [N]
   **Task Groups**: [list]

   ## Standards Reading Log

   ### Loaded Per Group
   (Entries added as groups execute)
   ```
**Do NOT read all standards upfront.** Standards are loaded lazily per task group.

## Phase 2: Execute (wave-based, parallel by default)

**Dispatch unit is the wave**, not the individual group. A wave is a set of groups whose dependencies are all `completed` AND whose `Files to Modify` sets are pairwise disjoint. All groups in a wave fire in parallel from a single message; the next wave is computed once every member returns.

### Phase 2 Validation (before computing waves)

Read each group from `implementation-plan.md` and verify both `**Dependencies:**` and `**Files to Modify:**` are present. If any group is missing `Files to Modify`:

- Treat the entire run as `--sequential` (see opt-out below).
- Append a warning to `work-log.md`: `Plan missing 'Files to Modify' on Group N — falling back to sequential execution.`

Never assume missing `Files to Modify` means "None" — silent disjoint assumptions are how parallel implementers collide on the same file.

### Wave Computation

1. Parse `Dependencies:` (list of group numbers) and `Files to Modify:` (list of paths or `"None"`) for every group.
2. Build the directed dependency graph from `Dependencies:`.
3. The **ready set** = groups whose dependencies are all `completed` AND that have not yet been dispatched.
4. Greedily build the next wave from the ready set in plan order: a group joins the wave iff its `Files to Modify` does not overlap any group already in the wave. Conflicting groups stay in the ready set for the next wave.
5. Treat `"None"` as the empty set — review-only groups never conflict on files.
6. Glob entries (e.g. `src/migrations/*.sql`) match by glob expansion against other groups' declared paths.

### Wave Dispatch

For each wave:

0. For every group in the wave, `TaskUpdate` to `status: "in_progress"` with `owner: "maister-copilot:task-group-implementer"`. Then record the wave's start with **`wave-start`** (§ Recording Progress Through the Engine), before the fan-out: the groups it names show as running until each is completed or reverted. On a resumed run this is also the call that brings the dashboard up to date.

1. **Prepare group context** (per group):
   - Extract group content from `implementation-plan.md` (including `Visual References` section, if present)
   - Check "Standards Compliance" section — identify standards relevant to this group
   - Check INDEX.md for additional standards matching group topic
   - Get relevant spec sections
   - **Design context** (when `analysis/design-context/` exists): include `design-context/brief.md` excerpt (Layer 0 + the relevant screen sections from Layer 3) when relevant to this group. Do NOT inline HTML/binary mockups — pass paths only and rely on the implementer to Read them. ASCII mockup excerpts (small, text) MAY be inlined when directly relevant. The planner-supplied `locator` field already tells the implementer which region to focus on within large mockups.

2. **Fan out — CRITICAL: parallel dispatch in a single message**:

   All groups in the wave MUST be dispatched in **one assistant turn** containing **one `Task` tool call per group**. This is not a loop. This is one message with N tool calls.

   ❌ Wrong: Send `Task(G2)`, await result, send `Task(G3)`, await result, send `Task(G4)`. → That is serial execution wearing wave-shaped clothing. Wave duration becomes `sum(G2, G3, G4)` instead of `max(G2, G3, G4)` and defeats the entire wave optimization. The "comfortable" pattern of one-Task-per-turn is the exact anti-pattern this skill exists to prevent.

   ✅ Right: One assistant message with N `Task` tool-use blocks emitted before any of them returns. The runtime returns all N results before the next assistant turn.

   Per-call parameters:
   - subagent_type: `maister-copilot:task-group-implementer`
   - prompt: per-group content + initial standards + INDEX.md path + spec excerpt + sibling-wave note (see "Subagent Invocation")

   **SELF-CHECK before sending the message**: Are you about to emit a message with one `Task` call when the current wave has more than one group? If yes, STOP. Compose every wave member's prompt first, then emit them all in the same message. Awaiting one before composing the next violates this skill's contract. If the wave has exactly one group, a single `Task` call is correct.

3. **Process each wave member as it returns**, without waiting for its siblings:
   - Parse completed steps, standards applied, test results, and verify the test results are acceptable. Whether to accept the group is your judgement; the engine records only a group you accepted.
   - `TaskUpdate` to `status: "completed"` with `metadata: {completed_at, tests_passed, files_modified, standards_applied, wave: N}`.
   - Record it with **`group-done`** (§ Recording Progress Through the Engine): write its work-log entry body (§ Work-Log Updates) to the entry file and run the verb in the same message. That one call marks its checkboxes, logs the entry under the wave's clock-stamped heading, syncs the plan's HTML companion and redraws the dashboard and the status line, so the group reads as done while its siblings still read as running. Members that come back together are recorded together: one call with `--groups=<N>,<M>` and one `## Group N` part per group in the entry file.
   - A `warning: plan-sync-missed` names groups the companion has no marker for; the verb has already written the miss into the work log, so there is nothing to add.

   A member that returns failed is not processed here: it waits for the recovery flow in step 4, once the whole wave is back.

   Once every member is recorded, the wave has nothing left to write: the last `group-done` synced the companion and published the wave's outcome. The projection reads it from the plan and the log — groups done from the checkboxes, `current_wave` from the last `Group N Complete (wave K)` heading, skipped groups from `[~] … SKIPPED:` steps and reverted groups from `Group N Reverted (wave K): reason` entries — so a group the failure-recovery path skipped or reverted reaches the dashboard only if those marks are written first; the next `wave-start`, or the orchestrator's own state write once this skill returns, draws them.

4. **Partial-wave failure handling**:
   - Do NOT cancel sibling subagents in the same wave — they may produce valid work even when one peer fails.
   - After every wave member has returned, run the existing failure recovery flow (see "Error Handling" → "Subagent Failure") for each failed group individually.
   - Mark successful groups in the wave as `completed` normally. Keep failed groups `in_progress` with `metadata: {failed_at, failure_reason, wave: N}` until the ask_user recovery path resolves them.
   - The next wave is NOT computed until every failed group's recovery decision is made.

5. After the wave fully resolves (all members `completed` or recovered), recompute the ready set and proceed to the next wave.

   **SELF-CHECK before dispatching the next wave**: did every accepted member of this wave go through `group-done`? If unsure, run it again for that group: a group already recorded under its wave is not logged twice.

### `--sequential` Opt-Out

Read `orchestrator.options.sequential` from `orchestrator-state.yml` at Phase 2 entry. When true (or when the validation fallback above triggered):

- Treat every wave as size 1: dispatch groups one at a time in plan order, ignoring file-overlap analysis.
- Use cases: debugging a flaky group, constrained dev environments (single port, single DB schema), users who explicitly want serial execution.

## Continuous Standards Discovery

**Philosophy**: Standards are discovered when relevant, not memorized upfront.

### Three Sources of Standards

1. **Implementation Plan Standards**: The "Standards Compliance" section in implementation-plan.md lists standards identified during planning. Filter these per task group based on relevance.

2. **INDEX.md Discovery**: The file `.maister/docs/INDEX.md` maps topics to standard files. Use it to find standards not listed in the plan.

3. **Keyword-Triggered Discovery**: During execution, step descriptions may reveal need for additional standards.

### Keyword Triggers (Suggestive, Not Exhaustive)

These are **examples** to guide discovery. Do not limit discovery to only these triggers - use judgment to identify when other standards may apply.

| Example Keywords | May Suggest Standards For |
|------------------|---------------------------|
| file, upload, download | file handling, storage |
| auth, login, session | security, authentication |
| email, notification | external services |
| form, input, validation | forms, validation |
| API, endpoint | api design, error handling |
| migration, schema | database conventions |

**Key principle**: If a step involves a concept that likely has project standards, check INDEX.md even if no keyword explicitly matches.

### Discovery Flow

```
Per task group:
  1. Check "Standards Compliance" section in implementation-plan.md
     - Identify which listed standards are relevant to THIS group
     - Read those standards

  2. Check INDEX.md for additional standards matching group topic

  3. During step execution:
     - If step description suggests a standard may apply
     - Check INDEX.md, read if found and not yet loaded
     - Log discovery with trigger reason

  4. Apply discovered standards to implementation
```

### Standards Reading Log Format

```markdown
## Standards Reading Log

### Group 1: [Name]
**From Implementation Plan**:
- [x] .maister/docs/standards/backend/api.md - Listed in Standards Compliance

**From INDEX.md**:
- [x] .maister/docs/standards/global/naming.md - Group topic match

**Discovered During Execution**:
- [x] .maister/docs/standards/global/security.md - Step 1.3 (auth-related logic)

### Group 2: [Name]
**From Implementation Plan**:
- [x] .maister/docs/standards/frontend/forms.md - Listed in Standards Compliance
```

## Subagent Invocation

When delegating a task group, use this prompt structure:

```markdown
## Task: Execute Task Group [N]

### Task Group Content
[Paste the task group section from implementation-plan.md, including the `Visual References` block if present]

### Specification Excerpt
[Relevant sections from spec.md for this group]

### Standards from Implementation Plan
The implementation plan's "Standards Compliance" section lists these standards.
Identify which are relevant to this group and read them:
- [path/to/standard1.md] - [likely relevant because...]
- [path/to/standard2.md] - [likely relevant because...]

### Standards Discovery
You have access to `.maister/docs/INDEX.md` for continuous standards discovery.
- Check INDEX.md for additional standards matching this group's topic
- During implementation, discover more standards as step context reveals needs
- Do not limit discovery to explicit keyword matches - use judgment
- INDEX.md and `.maister/docs/standards/` are read-only for you: name a document you changed under Docs Changed, and a convention worth keeping under Standard Candidates

### Design Context
[OMIT this section entirely when no `Visual References` are present in the task group AND no `analysis/design-context/` exists.]
[OTHERWISE include:]
- Design context root: `analysis/design-context/`
- Brief excerpt (when present): [Layer 0 from `design-context/brief.md` + relevant screen sections]
- Mockup files referenced by this group: [list paths from `Visual References`]
- Inline ASCII excerpt (when ASCII mockup is small and directly relevant): [paste here]
- Binding rule: each mockup in `Visual References` MUST be read before implementing; layout, copy, field order, and explicit states are binding; self-check each `acceptance` criterion before declaring done.

### Sibling Wave
[None] OR [Group K (Files to Modify: ...) is running in parallel in the same wave. File sets are disjoint per the executor's wave-computation invariant; do not edit paths outside your declared `Files to Modify`.]

### Requirements
1. Execute in test-driven order: tests (N.1) → implementation (N.2+) → verify (N.n)
2. Log all standards applied (from plan, from INDEX.md, discovered during execution)
3. When `Visual References` present: read each mockup before implementing, log per-reference compliance in your report
4. Report any failures with root cause analysis
5. Do NOT mark checkboxes - main agent handles that

### Expected Output Format
[See Subagent Output Format section]
```

## Subagent Output Format

The task-group-implementer returns structured output:

```markdown
## Group [N] Execution Report

### Status: [SUCCESS/PARTIAL/FAILED]

### Steps Completed
- [x] N.1 - [description]
- [x] N.2 - [description]
- [ ] N.3 - [description] (if incomplete)

### Standards Applied
**From Implementation Plan**:
- .maister/docs/standards/backend/api.md

**From INDEX.md** (group topic):
- .maister/docs/standards/global/naming.md

**Discovered During Execution**:
- .maister/docs/standards/global/error-handling.md (step N.2, error handling logic)

### Visual Compliance
[OMIT this section entirely when the group had no `Visual References`.]
[OTHERWISE: one line per reference]
- ✓ analysis/design-context/mockups/login.html — screen:login — field order, error states, "Forgot password?" link match
- ⚠ analysis/design-context/mockups/dashboard.html — screen:dashboard — 3-column layout matched, but icon set differs (used Heroicons; mockup shows custom icons — flagged for review)

### Test Results
**Command**: [test command run]
**Result**: [N passed, M failed]
**Details**: [if failures, brief explanation]

### Files Modified
- path/to/file1.ts (created)
- path/to/file2.ts (modified)

### Docs Changed
- .maister/docs/project/architecture.md — [what changed] (or "None")

### Standard Candidates
- [one line, written as the rule would read] (or "None")

### Notes
[Any decisions made, blockers encountered, recommendations]
```

## Test-Driven Enforcement

### Pattern Per Task Group

```
N.1  - Write tests (2-8 focused tests)
N.2  - Implementation step
...
N.n-1 - Implementation step
N.n  - Run tests (only this group's tests)
```

### Enforcement

When processing a group's report, if its test step (N.1) is not marked done while later steps are, ask the user with ask_user, in plain words — step numbers, checkbox marks and "dispatch" stay in the plan and the work-log, never on screen:

- Question: "Group \<name\> skipped its tests. What now?" — the group's name from the plan, and what the report says about why, in a few words.
- "Write the tests first (Recommended)": runs the group again to write and run its tests.
- "Accept without tests: give a reason": the reason is the follow-up answer; mark the test step `- [~] N.1 SKIPPED: <reason>` and continue.
- "Stop": stop here; nothing more runs.

## Progress Tracking

### Checkbox Marking

**Format**: `- [ ]` → `- [x]` (or `- [~]` for skipped)

**Timing**: A group's checkboxes are marked by its `group-done` call, as soon as its subagent returns and its report is accepted — never before, and never for a group that has not reported.

**Responsibility**: Always the main agent, through `group-done` — the subagent does NOT mark checkboxes, and neither does a script of your own. The one mark you write by hand is a skipped step's `- [~] N.M SKIPPED: <reason>`, before the group's `group-done`, which keeps it as it is.

### Work-Log Updates

**Every `[timestamp]` in `work-log.md` comes from the clock.** The wave-start and group headings are stamped by `wave-start` and `group-done` themselves. For the entries you write — the opening entry, a revert and the closing entry — run `date -u +%Y-%m-%dT%H:%M:%SZ` right before the entry is written and copy its output into the heading — never a time typed, estimated or carried over from an earlier reading. Entries land minutes apart as groups return, and the log is the run's timeline: a typed time can read as later than the work it records.

Before each wave is dispatched — `--sequential` included, as a wave of one — `wave-start` writes `## [timestamp] - Wave [K] Started: Groups [A], [B]`.

After each task group, `group-done` writes the heading `## [timestamp] - Group [N] Complete (wave [K])` and, under it, the body you put in the entry file:

```markdown
**Steps**: N.1 through N.M completed
**Standards Applied**:
- From plan: [list]
- From INDEX.md: [list]
- Discovered: [list with trigger reason]
**Tests**: [N] passed
**Files Modified**: [list]
**Docs Changed**: [paths under `.maister/docs/`, or none]
**Standard Candidates**: [one line each, or none]
**Notes**: [any decisions or discoveries]
```

`Standard Candidates` lines are what finalization offers to add as standards when the run ends, so copy each as the implementer wrote it.

**The headings are a contract, not captions**, which is why the verbs write them: the
dashboard reads `current_wave` off the wave number in the last `Group [N] Complete (wave [K])`
heading, and `Wave [K] Started:` followed by the wave's group numbers is what tells the
dashboard and the status line which groups are running. The entry file therefore carries
no heading of its own — the verb refuses one — and an annotation such as "parallel with
Group 3" goes in the body.

When a group is reverted rather than completed, record it in the same shape:

```markdown
## [timestamp] - Group [N] Reverted (wave [K]): [reason]

**Reverted**: [what was undone]
**Next**: [retry, manual completion, or stopped for investigation]
```

The reason after the colon is what the dashboard shows in `reverted`, so write it
for an operator reading the run at a glance.

## Phase 3: Finalize

1. **Validate completion**:
   - No `- [ ]` checkboxes remain
   - All groups have work-log entries
   - Standards Reading Log is complete
   - All group tasks are `completed` via `TaskList` (cross-validate against markdown checkboxes)

2. **Run full project test suite** (all tests, not just feature tests — catches regressions in unrelated areas)

3. **Refresh the docs index when documents changed.** Collect the paths under `.maister/docs/` the groups reported under Docs Changed, plus any `git status -- .maister/docs` shows changed. When there are any, invoke `docs-operator` via Task tool (subagent_type: `maister-copilot:docs-operator`): "Refresh INDEX.md. Changed: [paths]. Check: [check path]" — the check is `<plugin root>/skills/docs-manager/scripts/docs-check.mjs`, as an absolute path. Log its outcome in the final entry below. A refresh that reports a failure is a warning in the work log, never a reason to stop the phase. Nothing here edits INDEX.md itself.

4. **Final work-log entry**, its timestamp from the clock (§ Work-Log Updates):
   ```markdown
   ## [timestamp] - Implementation Complete

   **Total Steps**: [N] completed
   **Total Standards**: [M] applied
   **Test Suite**: [status]
   **Docs Index**: [refreshed for N documents, check passed / not needed / check failed: what]
   **Duration**: [if tracked]
   ```

5. **Return summary** to calling orchestrator. The last `group-done` already published `groups_done == groups_total`, so nothing is re-projected here. Do not complete the phase: its status stays `in_progress`, because the orchestrator owns completing it (§ 2 state ordering).

## Error Handling

### Subagent Failure

If task-group-implementer reports failure:

1. **Do NOT auto-rollback** - User-confirmed rollback only
2. **Analyze root cause** from subagent output
3. **Check for easy fixes**: config issues, missing dependencies, test setup
4. **Use ask_user**, four options at most, the cause in the question — "Group \<name\> failed: \<cause in a sentence\>. What now?":
   - "Apply the suggested fix (Recommended): \<the fix\>" — only when step 3 found one; otherwise "Retry the group" is recommended.
   - "Retry the group": runs the group again with the failure in its prompt.
   - "Undo this group's changes": reverts what the group changed.
   - "Stop": stop here; the group's changes stay as they are.

   When several groups of one wave fail, ask once: one page — one call with a question per failed group, up to four — each worded as above.
5. **If "Undo this group's changes"**: after the revert, write the revert entry from § Work-Log
   Updates — `## [timestamp] - Group [N] Reverted (wave [K]): [reason]`, the time from the clock — and clear the
   group's checkboxes back to `- [ ]`. The entry is the only record of the revert the
   dashboard can read; a rollback that leaves nothing behind shows up as a group that
   simply stopped. The next `wave-start` — the retry's, if there is one — or the
   orchestrator's own state write draws it; send no write of your own for it.

### Test Failure

If tests fail after implementation:

1. Analyze failure output
2. If obvious fix: apply and re-run
3. If unclear: ask as § Subagent Failure does, the failing test and its cause in the question — "\<test name\> fails in group \<name\>: \<cause\>. What now?" — with the same four options

## Validation Checklist

Before returning success:

### Completion
- [ ] All steps marked `[x]` or `[~]` (skipped with reason)
- [ ] All task groups have work-log entries
- [ ] Full test suite passes

### Standards
- [ ] Standards Reading Log complete for all groups
- [ ] All three sources logged: from plan, from INDEX.md, discovered
- [ ] Standards applied appropriately per step

### Artifacts
- [ ] Every wave started with `wave-start` and every accepted group recorded with `group-done` — no checkbox, group heading or wave heading written by hand
- [ ] work-log.md complete with timeline
- [ ] No `write-state` call sent only to redraw the dashboard
- [ ] No uncommitted partial changes
