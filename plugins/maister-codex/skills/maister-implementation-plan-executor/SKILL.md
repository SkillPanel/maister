---
name: maister-implementation-plan-executor
description: Execute an approved Maister implementation plan in dependency-safe, test-first task groups while loading standards lazily, coordinating disjoint parallel work, updating checkboxes and work logs, and recovering safely from failures. Use during the implementation phase of a full Maister workflow.
---

# Maister Implementation Plan Executor

Execute `implementation/implementation-plan.md` as the coordination owner. Preserve the plan, work log, and durable workflow state as the operator-visible record. Delegate task groups when collaboration is available; the coordinator alone updates shared planning artifacts.

At a material deviation or recovery decision, prefer `request_user_input` when available; otherwise ask the equivalent concise question in the final response and pause. Do not use execution approval as a substitute for a scope, rollback, or known-failure decision.

## Initialize

1. Resolve the task directory and require `implementation/implementation-plan.md`. Read `implementation/spec.md`, `orchestrator-state.yml`, and `.maister/docs/INDEX.md` when present.
2. Parse every task group, dependency, test-first step, and `Files to Modify` declaration. Detect dependency cycles and stop with evidence if one exists.
3. If any group lacks an explicit file set, run sequentially and log why. Treat `None` as an empty set. Expand or conservatively compare globs; uncertain overlap means conflict.
4. Create or resume `implementation/work-log.md`. Do not erase earlier entries. Record the real UTC start time, groups, and total steps.
5. Mirror phase/group progress with the available progress mechanism when useful, but keep the plan checkboxes, work log, and orchestrator state canonical.

## Build and execute waves

The ready set contains unfinished groups whose dependencies are complete. Build the next wave in plan order from ready groups with pairwise disjoint file sets. When `orchestrator.options.sequential` is true, every wave contains one group.

Before dispatching a group, prepare:

- its complete plan section and relevant specification excerpt;
- standards named by the plan plus additional matching entries from `.maister/docs/INDEX.md`;
- relevant `analysis/design-context/brief.md` excerpts;
- paths and acceptance criteria for every visual reference;
- its exclusive writable file set and the file sets owned by sibling groups.

Delegate each group to the installed `maister-task-group-implementer` agent when available; otherwise implement the group inline under the same worker contract. Dispatch all groups in one wave concurrently only when delegation is available and file ownership is provably disjoint. Otherwise execute groups serially. Each implementation worker must:

1. edit only its declared file set;
2. read applicable standards and visual references before editing;
3. write or update focused tests before implementation unless the approved plan records a justified exception;
4. run focused checks and return status, completed steps, standards applied, visual compliance, test results, and files changed;
5. avoid editing the shared plan, state, or work log.

Wait for every worker in the wave before scheduling another wave. Do not cancel successful siblings because one group failed.

## Reconcile each wave

For every successful group:

- verify the reported files remain inside its ownership boundary;
- verify the red-to-green or approved test-first sequence and test evidence;
- mark completed plan checkboxes immediately;
- when `implementation/implementation-plan.html` exists (written at plan approval per the framework's companion table), update its matching group and step markers, then verify the marker change;
- append a timestamped work-log entry with steps, standards sources, tests, files, and deviations;
- update durable workflow state and progress.

Keep failed or partial groups incomplete. Record the root cause and preserve successful sibling work. Apply an obvious, safe fix and retry when it remains within the approved plan. Ask the user before changing scope, skipping required tests, rolling back, overwriting work, or accepting material failures. Never auto-rollback.

## Continuous standards discovery

Load standards per group rather than all at once:

1. start with the plan's Standards Compliance section;
2. match the group topic against `.maister/docs/INDEX.md`;
3. re-check the index when implementation reveals a new concern such as authentication, validation, APIs, migrations, files, or external services;
4. record every loaded standard and why it applied in the work log.

## Finalize

After all groups resolve:

1. confirm no unchecked steps remain except explicitly approved `[~]` skips with reasons;
2. confirm every group has a work-log entry and standards trail;
3. run the project-wide required checks, not only focused group tests;
4. append an implementation-complete entry with the real UTC timestamp and final check results;
5. update state and return a concise summary of changed files, checks, deviations, and remaining risks to the calling orchestrator.

Do not claim success while partial application changes or unexplained test failures remain.
