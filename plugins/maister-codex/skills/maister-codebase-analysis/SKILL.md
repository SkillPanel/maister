---
name: maister-codebase-analysis
description: Analyze an unfamiliar codebase before a Maister implementation, bug fix, performance task, migration, or verification. Use to map responsible code paths, execution flow, callers, patterns, dependencies, tests, migration targets, and risks without changing application code.
---

# Maister Codebase Analysis

Produce evidence, not a design or implementation. Do not modify application source files. Read the task type, description, task path, and any existing state before selecting investigation lanes.

Choose the narrowest independent set:

- file discovery (`references/file-discovery.md`) — entry points, symbols, ownership, generated surfaces;
- execution analysis (`references/code-analysis.md`) — data/control flow, state, failure modes;
- context discovery (`references/context-discovery.md`) — callers, consumers, tests, configuration, dependencies;
- pattern mining (`references/pattern-mining.md`) — analogous implementations and conventions to reuse;
- migration target (`references/migration-target.md`) — current/target APIs, compatibility boundaries, and conversion surface.

Read each selected lane's reference file for its detailed prompt. For broad work, delegate non-overlapping read-only investigations concurrently and give each a specific lane and output contract. For small work, combine the selected lanes into one exploration using `references/combined.md`. Synthesize once — delegate synthesis to the installed `maister-codebase-analysis-reporter` agent when available, otherwise synthesize inline: deduplicate files and findings, cross-check contradictions, distinguish observed facts from inference, and retain line/symbol evidence.

Write `<task_path>/analysis/codebase-analysis.md` when a task path is supplied, otherwise return the analysis directly. Include TL;DR, task interpretation, scope, files and symbols, current execution flow, reusable patterns, tests/consumers/configuration, task-type findings, risks, unknowns, and recommended next actions.

End with `status`, `summary`, `files_found`, `complexity`, and `risk_level`. Do not propose a detailed solution unless the caller explicitly requests one.
