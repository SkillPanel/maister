# Command Reference

## Git-package launcher

```sh
npm exec --yes --package='github:mateuszrapacz/maister#v2.2.19' -- maister install --target codex
npm exec --yes --package='github:mateuszrapacz/maister#0123456789abcdef0123456789abcdef01234567' -- maister verify --target cursor --json
```

Commands are exactly `install`, `update`, `status`, `verify`, `uninstall`, `rollback`, and `recover`; targets are exactly `codex`, `cursor`, and `kiro-cli`. `recover` alone may receive `--journal-id <uuid>`. Branches, `latest`, ranges, short SHAs, package-registry Maister specs, custom source/ref/URL flags, and token-bearing Git URLs are rejected or unsupported. `status`, `verify`, `uninstall`, `rollback`, and `recover` delegate through the validated active receipt and make no launcher acquisition call.

## Exact agent dispatch

Workflow configuration uses exact `maister:<role_id>` values only. `advisor_agent` and `arbiter_agent` both default to `maister:advisor`, while Advisor and Arbiter retain separate decision/attempt identities. Bare `advisor`, aliases, legacy model fields, and legacy Codex TOML profiles are rejected; a v1 receipt is a clean-install rejection before mutation. A managed Codex worker receives the complete canonical prompt with pinned policy. Cursor and Kiro require exact observed native identities; if a safe runtime, authentication, or scenario is absent, E5/E6 is `unavailable`, never passed.

## Unified Entry Point

### `/maister:work [input]`

Auto-classifies your task and routes to the appropriate workflow. Accepts:

- **No arguments**: Extracts the task from your current conversation context
- Task description: `/maister:work "Add user profile page"`
- Task folder path: `/maister:work .maister/tasks/new-features/2026-02-17-user-profile` (resumes)
- GitHub issue URL: `/maister:work https://github.com/org/repo/issues/42`

The plugin classifies the task type with confidence scoring, asks for confirmation, then launches the matching orchestrator.

---

## Unified lifecycle commands

The portable core ships the same six prefixed flow-control skills for every
host: `maister-bye`, `maister-dev`, `maister-next`, `maister-resume`,
`maister-status`, and `maister-work`. Installation projects that canonical set
into each host's native command vocabulary:

| Skill | Codex | Cursor | Kiro CLI | Pi |
| --- | --- | --- | --- | --- |
| `maister-bye` | `$maister:maister-bye` | `/maister-bye` | `/maister-bye` | `/maister-bye` |
| `maister-dev` | `$maister:maister-dev` | `/maister-dev` | `/maister-dev` | `/maister-dev` |
| `maister-next` | `$maister:maister-next` | `/maister-next` | `/maister-next` | `/maister-next` |
| `maister-resume` | `$maister:maister-resume` | `/maister-resume` | `/maister-resume` | `/maister-resume` |
| `maister-status` | `$maister:maister-status` | `/maister-status` | `/maister-status` | `/maister-status` |
| `maister-work` | `$maister:maister-work` | `/maister-work` | `/maister-work` | `/maister-work` |

`maister-dev` is the only convenience alias and routes to
`maister-development`; no unprefixed lifecycle aliases are installed. Pi
registers these public commands through its extension and forwards internally
to `/skill:maister-*`. Arguments are passed unchanged. `maister-bye` never marks an in-progress
workflow as completed; `maister-next` and `maister-status` are read-only.

The Codex package keeps the same identity at the filesystem boundary: every
skill is materialized below `skills/maister-*`, projected agent prompt/schema
leaves use `maister-*`, and hook scripts use `maister-*.sh`. The `$maister:`
namespace identifies the plugin; the second `maister-` identifies the resource
and prevents short-name collisions with another plugin.
Example:

`/maister-development Add filtering --e2e`

## Development

### `/maister:development [description | task-path]`

Starts the unified development workflow (14 adaptive phases) or resumes an existing one. All arguments are optional — when run without a description, the plugin extracts it from your current conversation. Pass an existing task path to resume. Task type (bug/enhancement/feature) is auto-detected from context when `--type` is omitted.

| Flag | Description |
| ------ | ------------- |
| `--type=bug\|enhancement\|feature` | Specify task type (auto-detected if omitted) |
| `--e2e` | Include E2E testing phase |
| `--user-docs` | Generate user documentation phase |
| `--code-review` | Include code review phase |
| `--research=PATH` | Start development informed by a completed research task |
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

**Task directory**: `.maister/tasks/development/`
**Resume phases**: `analysis`, `gap`, `spec`, `plan`, `implement`, `verify`

---

## Performance

### `/maister:performance [description | task-path]`

Starts performance optimization with static bottleneck analysis (9 phases) or resumes an existing one. Can be run without arguments — the plugin extracts the optimization target from your conversation. Detects N+1 queries, missing indexes, O(n^2) algorithms, blocking I/O, and memory leak patterns.

| Flag | Description |
|------|-------------|
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

You can optionally provide profiling data (flame graphs, APM screenshots) — the workflow creates a directory for these.

**Task directory**: `.maister/tasks/performance/`
**Resume phases**: `analysis`, `specification`, `planning`, `implementation`, `verification`

---

## Migration

### `/maister:migration [description | task-path]`

Starts migration workflow (8 phases) with mandatory rollback planning and risk assessment, or resumes an existing one. Can be run without arguments — the plugin extracts migration details from your conversation.

| Flag | Description |
| ------ | ------------- |
| `--type=code\|data\|architecture\|general` | Migration type (affects risk focus) |
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

**Task directory**: `.maister/tasks/migrations/`
**Resume phases**: `analysis`, `target`, `spec`, `plan`, `execute`, `verify`, `docs`

---

## Research

### `/maister:research [question | task-path]`

Starts research workflow (8 phases) with multi-source gathering, synthesis, and optional solution brainstorming, or resumes an existing one. Can be run without arguments — the plugin extracts the research question from your conversation.

| Flag | Description |
| ------ | ------------- |
| `--type=technical\|requirements\|literature\|mixed` | Research methodology type |
| `--brainstorm` | Force brainstorming + design phases |
| `--no-brainstorm` | Skip brainstorming phases |
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

Research output can feed into development: `/maister:development --research=.maister/tasks/research/...`

**Task directory**: `.maister/tasks/research/`
**Resume phases**: `foundation`, `brainstorming-decision`, `brainstorming`, `design`, `outputs`, `verification`, `integration`

---

## Product Design

### `/maister:product-design [description | task-path]`

Starts the interactive product/feature design workflow (9 adaptive phases) or resumes an existing one. Transforms ideas into structured product briefs through collaborative exploration, iterative refinement, and visual prototyping. Can be run without arguments — the plugin extracts the design brief from your conversation.

| Flag | Description |
| ------ | ------------- |
| `--research=PATH` | Start design informed by a completed research task |
| `--no-visual` | Skip browser-based visual companion (use ASCII mockups only) |
| `--from=PHASE` | Start from or resume at a specific phase |
| `--reset-attempts` | Reset failed attempt counters (resume) |

Design output can feed directly into development: `/maister:development .maister/tasks/product-design/...`

**Task directory**: `.maister/tasks/product-design/`
**Resume phases**: `context`, `synthesis`, `problem`, `personas`, `alternatives`, `convergence`, `specification`, `prototyping`, `handoff`

---

## Reviews & Audits

Standalone review commands that can be run anytime, independent of workflows.

### `/maister:reviews-code [path]`

Automated code quality, security, and performance analysis.

| Flag | Description |
|------|-------------|
| `--scope=quality\|security\|performance\|all` | Focus area (default: `all`) |

Analyzes complexity, duplication, code smells, security vulnerabilities, and performance issues. Generates report with severity levels (Critical/Warning/Info).

### `/maister:reviews-pragmatic [path]`

Detects over-engineering and ensures code matches project scale. Identifies excessive abstraction, enterprise patterns in simple code, infrastructure overkill. Recommends specific simplifications with before/after examples.

### `/maister:reviews-reality-check [task-path]`

Validates that completed work actually solves the intended problem. Runs tests, checks end-to-end workflows, and evaluates error scenarios. Returns deployment decision: Ready / Issues Found / Not Ready.

### `/maister:reviews-spec-audit [spec-path]`

Independent specification audit with senior auditor perspective.

| Flag | Description |
|------|-------------|
| `--post-implementation` | Compare spec vs actual implementation (default: pre-implementation) |

Identifies ambiguities, missing details, and gaps. Uses external tools (GitHub CLI, Azure CLI) for verification.

### `/maister:reviews-production-readiness [path]`

Pre-deployment verification across 7 dimensions: configuration, monitoring, error handling, performance, security, deployment, and GO/NO-GO recommendation.

| Flag | Description |
|------|-------------|
| `--target=prod\|staging` | Target environment (default: `prod` with full rigor) |

---

## Standards

### `/maister:init [--standards-from=PATH]`

Initialize the Maister framework. Scans your codebase with a project-analyzer subagent, presents findings for confirmation, then generates:

- `.maister/docs/` with INDEX.md, project docs (vision, roadmap, tech-stack), and coding standards
- `.maister/tasks/` directory structure
- Project-instructions integration

| Flag | Description |
|------|-------------|
| `--standards-from=PATH` | Copy standards from another project's `.maister/docs/standards/` instead of built-in defaults. Useful when starting a new project that should follow the same conventions as an existing one. |

If `.maister/` already exists, offers to backup, update, or cancel.

### `/maister:standards-discover [--scope=SCOPE]`

Auto-discovers coding standards from multiple sources in parallel: config files, source code patterns, documentation, pull requests, and CI/CD pipelines.

| Flag | Description |
| ------ | ------------- |
| `--scope=full\|quick\|frontend\|backend\|testing\|custom` | Discovery scope (default: `full`) |
| `--confidence=N` | Minimum confidence threshold, 0-100 (default: `60`) |
| `--auto-apply` | Auto-apply standards with 90%+ confidence |
| `--skip-external` | Skip PR and CI/CD analysis |
| `--pr-count=N` | Number of PRs to analyze (default: `10`, max: `20`) |

Presents findings in confidence tiers (high/medium/low) for review before applying.

### `/maister:standards-update [description] [--from=PATH]`

Update or create standards from conversation context or explicit description. When run without arguments, scans your current conversation for standards patterns like "we should always...", "our convention is...", "prefer X over Y" and proposes them as new standards.

| Flag | Description |
|------|-------------|
| `--from=PATH` | Sync standards from another project. Analyzes differences, shows what's missing or changed, and lets you select which standards to import. |

---

## Quick Commands

Lightweight commands for small tasks that don't need a full orchestrator workflow.

### `/maister:quick-dev [task description]`

Implement a task directly — exactly as the main agent normally would, no planning mode — with standards enforcement. Reads INDEX.md and the specific matched standard files relevant to what you touch, applies them while implementing, and verifies compliance (pass/fail checklist) afterward.

**When to use**: Task is clear, no architectural decisions needed, you know what needs doing.

### `/maister:quick-plan [task description]`

Works like the host's built-in plan mode, with standards enforcement folded in. While planning, it reads INDEX.md and the specific matched standard files (INDEX.md alone is not enough), and the plan must reference the applicable standards and include a Standards Compliance Checklist (verified after implementation) before exiting plan mode.

### `/maister:quick-bugfix [bug description]`

Lightweight TDD-driven bug fix without a full orchestrator workflow. Analyzes the bug, writes a failing test, implements the fix, and verifies the test passes.

**When to use**: Simple, isolated bugs where you can quickly identify the root cause. If the bug is too complex (multiple files, unclear root cause, architectural impact), the skill suggests escalating to `/maister:development`.

No task directory created — works directly in your codebase.

---

## On-Demand Skills

On-demand skills are installed host skills, not portable slash commands. Ask for the capability directly or select the skill name exposed by your host; target overlays may project different names.

See the [On-Demand Skills Guide](on-demand-skills.md) for the complete catalog and selection guidance.
