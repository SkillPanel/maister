# Configuration

For people who want to tune how Maister runs in their project: the `.maister/config.yml` keys,
where a run's files go, which models the subagents use, what the reviewers check, and which
browser tool a run uses.

Everything here is optional. A project with no `.maister/config.yml` runs on the defaults below.

## The `.maister/` folder

`/maister:init` creates `.maister/` at the project root. Runs add to it.

```
.maister/
├── config.yml          # Project settings (below)
├── docs/               # Standards and project documents
│   ├── INDEX.md        #   The map every run reads; refreshed for you, never edited by hand
│   ├── standards/      #   Coding standards, one folder per category
│   ├── project/        #   Vision, roadmap, tech stack, architecture, and any doc you add
│   └── design-context/ #   The grounding pack mockups are drawn from, when you build one
├── workflows/          # Workflows your project defines, overlays and ejects of the built-ins
├── tasks/              # One folder per run (Task directories, below)
└── display/            # What the terminal draws beside a session; ignored by git
```

- Standards and project documents: [Standards](standards.md).
- The grounding pack: [Mockups](mockups.md).
- `.maister/workflows/`: [Extending maister](extending.md).

## `.maister/config.yml`

`/maister:init` writes the file. If you already have one, init adds the `subagents` and `project`
blocks when they are missing and leaves everything else as it is; run init again later to be offered
any other key that is missing. Four keys are read:

| Key | Type | Default | Effect |
|---|---|---|---|
| `html_output` | `true` or `false` | `true` | With `false`, runs write no dashboard (`dashboard.html`, `dashboard-data.js`), open nothing in a browser and write no HTML companion pages and no explainer page. The Markdown documents and the run's state file are written either way. |
| `mockup_format` | `html` or `ascii` | `html` | How UI mockups are drawn when a run makes them: HTML pages with a gallery, or ASCII in the terminal, which needs no browser. A written scope is chosen per turn, never here. Details: [Mockups](mockups.md). |
| `subagents` | map | Maister's own table | Which model and effort each subagent runs on, per host. See [Subagent models](#subagent-models). |
| `project` | map | none | What the project is, so the reviewers check what applies to it. See [The project profile](#the-project-profile). |

A run reads the file when it starts and keeps what it read. An edit applies to the next run, never
to one already under way, including one you resume.

A minimal file:

```yaml
html_output: true
mockup_format: html
```

`/maister:run <workflow> --check` validates the `subagents` and `project` keys along with the
workflow, and starts nothing.

## Task directories

Every run gets its own folder:

```
.maister/tasks/<type>/<YYYY-MM-DD-task-name>/
```

`<type>` is the workflow's name, except for migration, which uses `migrations/`. The name is the
date the run started plus a few words from the task; when that folder exists, `-2`, `-3` and so on
are added.

```
.maister/tasks/
├── development/
├── performance/
├── migrations/
├── research/
├── product-design/
├── mockup-studio/   # Standalone mockup runs
├── design/          # /maister:quick-design: decision.md, and mockups/ when made; no state or dashboard
└── <name>/          # A workflow your project defines, started with /maister:run <name>
```

Every run folder holds:

| File | What it is |
|---|---|
| `orchestrator-state.yml` | The run's state. Resuming reads it. Never edit it by hand. |
| `dashboard.html` | The run's dashboard. Open it in a browser. |
| `dashboard-data.js` | The data the dashboard draws, rewritten after every change. |
| `display/` | Files the terminal draws from; ignored by git. |

The dashboard files are left out when `html_output` is `false`.

What sits beside them depends on the workflow. Some files appear only when the step that writes
them runs.

| Workflow | Folders and main files |
|---|---|
| development | `analysis/`: codebase analysis, clarifications, gap analysis, requirements; `research-context/`, `design-context/`, `architecture-context/` and `work-context/` when you pass a research task, a design, an architecture or a context pack; the UI mockups in `design-context/`. `implementation/`: `spec.md`, `implementation-plan.md`, `work-log.md`, the failing-test and passing-test records for a bug fix. `verification/`: the specification audit, `implementation-verification.md`, the browser check reports and `screenshots/`. `documentation/`: `user-guide.md` and its `screenshots/`. At the root: `commit-message.txt` and `standard-candidates.json`. |
| performance | `analysis/`: codebase analysis, `performance-analysis.md`, requirements, `user-profiling-data/` for files you add. `implementation/`: spec, plan, work log. `verification/`: the specification audit and `implementation-verification.md`. At the root: `standard-candidates.json`. |
| migration | `analysis/`: current state, target state plan, requirements, `rollback-plan.md`. `implementation/`: spec, plan, work log. `verification/`: `implementation-verification.md`, `compatibility-test-results.md`. `documentation/migration-guide.md` with `--user-docs`. At the root: `standard-candidates.json`. |
| research | `planning/`: research brief, plan, sources. `analysis/`: `findings/`, `synthesis.md`, `work-context/` when you pass a context pack. `outputs/`: `research-report.md`, `research-explainer.html` (with `html_output` on), and with brainstorming or a design `solution-exploration.md`, `high-level-design.md`, `decision-log.md`. |
| product-design | `context/research-context/` when you name a research task. `analysis/`: `scope.md`, `explore/`, problem statement, personas, alternatives, design decisions, the feature specification when you ask for one, `work-context/` when you pass a context pack, and `mockups/` with every version under `mockups/versions/`. `outputs/`: `product-brief.md` and `delivery-scope.yml`. |
| mockup-studio | The run's state and `turn-result.json`; the mockups under `analysis/mockups/versions/vNNN/`, or under the folder you name. See [Mockups](mockups.md). |

With `html_output` on, the main documents also get an `.html` page beside the `.md`, for reading:
the specification, the plan and the verification report in development, performance and
migration, and the browser check reports in development; the research report, the research explainer, the solution
exploration, the design and the decision log in research; the alternatives, the design decisions,
the specification and the brief in product design.

## Subagent models

Most of a run's work is done by subagents. The `subagents` key says which model and effort each
one runs on, on Claude Code and on GitHub Copilot CLI.

### The defaults

| Agents | Claude Code | Copilot CLI |
|---|---|---|
| The clerical agents (project analysis, task classification, the test-suite runner, the HTML companion writer, the question reader) and the codebase scouts Maister starts (`Explore`) | `light` tier: a lightweight model on high effort | `light` |
| The docs operator and the standards scanner | your session's model | `standard` |
| The three reviewers and the specification audit | `deep` | `standard` |
| Implementers | the tier the plan gives each task group, up to `deep` | the same, up to `standard` |
| The fixes the verification fix loop makes, and the implementation and verification runners | your session's model | your session's model |
| Every other agent | your session's model | your session's model |

Copilot bills its deep model at 15 times the standard rate, which is why the reviewers and
implementers stop at `standard` there.

`/maister:init` writes these defaults into `.maister/config.yml` as a `subagents` block you can
edit. It adds the block to a file that has none and leaves an existing block alone. In a codebase
of more than 2,000 files it puts `Explore` on `standard`, still on high effort, and says so in its
summary. The block covers the agent calls Maister makes; the agents your host's own plan mode
starts are outside it.

### The block

```yaml
subagents:
  tiers:
    light:    { claude: haiku,  copilot: claude-haiku-5.5, effort: high }
    standard: { claude: sonnet, copilot: claude-sonnet-5.5 }
    deep:     { claude: opus,   copilot: claude-opus-5.5, premium: true }
  agents:
    Explore: { tier: light }
    spec-conformance-review: { tier: { claude: deep, copilot: standard } }
    task-group-implementer:
      choose: by-plan-tier
      allowed: [light, standard, deep]
      unassessed: standard
      ceiling: { claude: deep, copilot: standard }
      # budget: { deep: 3 }
  workflows:
    research:
      agents: { information-gatherer: { tier: standard } }
  # presets:
  #   scout: { claude: haiku, copilot: gpt-6-luna, effort: low }
  # default: { tier: standard }
```

This is a shortened copy of what init writes; init's file lists every agent it assigns.

- **`tiers`** — the ladder: `light`, `standard` and `deep`, each with a model per host. A `claude`
  cell is `haiku`, `sonnet`, `opus` or `fable`. A `copilot` cell is a model id as Copilot's
  `/model` lists it; mark one billed above one request with `premium: true`. `inherit`, in a cell
  or as an entry's `model`, means your session's model. Only the project's `config.yml` can remap
  the ladder.
- **`agents`** — an entry per agent: a `tier`, a `preset`, or a `model` with an `effort`. A tier
  can differ by host: `{ claude: deep, copilot: standard }`. When a per-host tier leaves a host out,
  the entry is passed over there and the next entry or default answers.
- **`workflows`** — entries for one workflow, `workflows.<name>.agents`, or for one step of it,
  `workflows.<name>.nodes.<step>.agents`. The step names are listed in
  [Built-in workflow reference](workflow-reference.md).
- **`presets`** — named model and effort pairs to point entries at.
- **`default`** — the entry for every agent nobody names.
- **`effort`** — `low`, `medium`, `high`, `xhigh` or `max`; `inherit` sends none. A tier's effort
  applies to every agent on it unless the agent's entry sets its own. Remapping a tier's models
  keeps its effort unless you set one.

**Which entry wins.** The most specific entry naming an agent wins: a step's, then a workflow's,
then the project's `agents`, then Maister's own table. Any entry naming an agent beats every
`default`, so a `default` covers only the agents nobody names, and the clerical agents stay on the
light tier until you name them. An overlay or a profile of a workflow can carry the same block,
without `tiers` ([Extending maister](extending.md)).

### Implementers by plan tier

The implementation plan gives each task group a tier, with a one-line reason. With
`task-group-implementer: { choose: by-plan-tier }`, the default, each group runs on the model of its
tier, under the `ceiling`. A group the plan gives no tier runs on `unassessed` (`standard`). A
group that fails is retried once on the next tier up, never past the ceiling, before you are asked.

A `budget` caps how many groups of a run go to a tier: with `budget: { deep: 3 }` the run asks
before it sends a fourth group to `deep`. Maister sets no budget. The work log records the model
each group ran on, and the implementation summary gives the tally.

### When a change takes effect

A run copies the block into its state when it starts, so a resumed run keeps its models and an edit
applies to the next run. A block with an error is set aside whole, with a warning, and the defaults
apply; the run still starts. `/maister:run <workflow> --check` shows the warnings without starting
anything.

If your host refuses a model or an effort, for example an older release, the call is sent again
without that field and the run notes it once.

## Implementation and verification in one subagent

Implementation runs in waves. Each wave starts the task groups that can run side by side, one
implementer subagent each, and every group that comes back is checked and recorded before the next
wave starts. Verification runs the tests and the project's other checks, three reviews, the merge
of their findings, the fixes made without asking and their re-checks, and the report.

Where your host lets a subagent start subagents of its own, the run hands each of these loops to
one subagent, the implementation runner and the verification runner, and your session makes one
call per pass instead of several per step. You are asked exactly the same questions either way:

- implementation: a group that failed again after moving up a tier, a group that skipped its test
  step, or a wave past a model budget you set;
- verification: a finding that needs your decision, a risky fix, or what to do once the automatic
  re-checks are spent.

**When the runners are used.** The run decides when it starts.

- **Claude Code**: used unless `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set to 1.
- **GitHub Copilot CLI**: never. Copilot runs each level of subagents under a session of its own,
  so no Maister agent there starts subagents, and both loops run in your session.

Where the runners cannot be used, or a runner finds it cannot start subagents, the loop runs in
your session as before. While verification runs, the status shows `nested` or `inline` to say
which. A run that stops part way through picks up from the plan, the work log and the files the
last pass left, whichever way it ran.

Some hosts start a subagent's own subagents in the background, so a runner may hand back before its
implementers are done. It then reports which groups are still running, and your session waits for
them instead of taking the loop over. A group is never given a second implementer while its first is
still running.

## What the reviewers check

Every verification pass runs the same three reviews:

- **Spec conformance** — does the code obey what the specification, the clarifications and your
  decisions say? It writes down the rules first, quoted (who may do what, what must never happen,
  ordering, what a failure must do), checks every operation the change adds against them, then each
  requirement and story, the work log's claims against the code and tests, and any document the
  change made false.
- **Code risk** — what can break, leak or fall over where your project runs: correctness, failure
  paths, security and resilience keyed to the project profile, how CI and the build run the change,
  operational hygiene where the project is operated, and the standards that govern the change.
- **Simplicity** — complexity the project does not need for its scale.

**What each reviewer is given.** One review brief, a small file of facts: the commit the run started
from, the files it changed (generated files such as lock files and data files such as fixtures are
marked, and skipped unless a finding turns on them), the test result, the result of every other check
the project runs (lint, format, typecheck, build), the paths of the run's documents and the project
profile. Nobody writes a reviewer a prompt for your change: each reads the specification, the plan
and the work log and decides where to look. Code risk reads freely (diffs, callers, history, CI and
build files); spec conformance and simplicity read the changed files and only what a finding turns
on.

Every review covers only what the run changed. A defect found outside the change counts only when it
is critical, and a deviation you decided on is not reported as a defect. Code risk takes the
standards the run says it applied, together with those it judges relevant from your
`.maister/docs/INDEX.md`, and reports each rule the code breaks.

**What gets fixed.** Critical and warning findings are fixed without asking when the fix is safe.
Info findings are listed in the report and fixed only when you choose them. How the fix loop asks
you is in [Getting started](getting-started.md).

The same three reviews run on their own with `/maister:reviews-spec`,
`/maister:reviews-code-risk` and `/maister:reviews-simplicity` ([Commands](commands.md)).

## The project profile

The reviews check what applies to your project, not a fixed web-service checklist. A CLI or a plugin
is not asked for a health endpoint, rate limiting or CORS, and a project with no database is not
asked for down-migrations or connection pooling. What the project is comes from the `project:` key:

```yaml
project:
  kind: cli                  # web-app | service | daemon | cli | library | plugin | desktop | mobile | data-pipeline | infra
  runtime: "node 20"         # the language and its version, free text
  deploy: package-registry   # none | local | container | kubernetes | serverless | package-registry | app-store
  exposure: local            # local | internal | public: who can reach its entry points
  data: []                   # the stores it writes, e.g. [postgres, files]; [] for none
  scale: team                # single-user | team | multi-tenant: who uses it
  ui: none                   # none | web | tui | native
```

Every field is optional, and a field left out rules no check out. What some values rule out:

| The profile says | Not checked |
|---|---|
| `kind` `cli`, `plugin` or `library` | health and readiness endpoints, rate limiting, CORS, HTTPS, security headers, CSP, request size limits, error tracking, metrics, a staging environment |
| `exposure: local` | authentication and authorization on entry points, rate limiting, CORS, HTTPS |
| `deploy` `none`, `local` or `package-registry` | health and readiness endpoints, graceful shutdown, error tracking, metrics, zero-downtime deploys |
| `data` with no database (`[]`, or files only) | migrations, down-migrations, connection pooling, transactions, N+1 queries, indexes, query pagination |
| `ui` `none`, `tui` or `native` | XSS, CSP, loading and error states of web requests |

A `cli`, `plugin` or `library` is checked instead for exit codes and error messages, cross-platform
paths and shells, behaviour with no network, install and upgrade paths, and a published surface
that stays compatible.

The reviews judge a safeguard (a pool, a cache, a rate limit, a feature flag) from the same profile:
a missing one is a code risk finding only when the project needs it, and one that is there is a
simplicity finding only when the project does not. The two never ask for opposite things.

`/maister:init` fills the key in from its project analysis when your config has none. Fields it
could not settle are left commented out, and an existing key is left alone; its summary shows what
it wrote. Correct any line by hand. A value Maister does not know is a warning and that field is left
out; it never stops a run.

Without the key, each reviewer works the profile out from `.maister/docs/project/` and says in its
report what it inferred.

## Browser tools

Three steps use a browser: development's browser checks, the user guide's screenshots, and looking
at the HTML mockup gallery. Maister ships no browser tool. A step uses whichever one your session
has, in this order:

1. `playwright-cli`
2. a Playwright MCP server you configured
3. Claude in Chrome
4. the Claude desktop app's built-in browser

To add one:

```bash
# playwright-cli
npm install -g @playwright/cli

# or a Playwright MCP server, on Claude Code
claude mcp add playwright -- npx @playwright/mcp@latest
```

On GitHub Copilot CLI, use `playwright-cli`: it runs through the shell, which every agent can reach
([Maister on GitHub Copilot CLI](copilot.md)).

A browser step needs to load a page, click and type, read the page, run a script in it and take
screenshots. One tool serves a whole step, and the step's report names which. Screenshots go into
the run's `verification/screenshots/` and `documentation/screenshots/`. A browser step leaves
nothing else in the project.

**With no browser tool**, the run says so where it would offer a browser step, names the tools that
would add one, and recommends the way on without a browser:

| Step | Without a browser tool |
|---|---|
| Browser checks | Recommends continuing without them. Chosen anyway, the step reports that it could not run, as a follow-up rather than a defect of the change. |
| User guide | Recommends leaving it off. On, the guide is written without screenshots and says so. |
| Mockup gallery | HTML mockups still render: the gallery opens in your default browser when you are at the terminal, and its path is named either way. ASCII mockups are the alternative. |

A missing browser tool never fails a run.
