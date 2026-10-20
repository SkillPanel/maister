# Maister on GitHub Copilot CLI

Maister ships a build for GitHub Copilot CLI, `maister-copilot`. It has the same workflows,
agents and engine as the Claude Code plugin, renamed into Copilot's vocabulary. This guide is for
someone who already knows Copilot CLI and is new to Maister: how to install it, run a workflow,
answer its questions, and keep a long run from stalling on permissions. What each workflow does
phase by phase is in [Workflow Details](workflows.md); this guide covers what is different on
Copilot.

## Install

### Requirements

- **GitHub Copilot CLI 1.0.100 or newer.** That release is the first whose hook input names the
  subagent that made a call, which the destructive-command guard needs.
- **Node.js 20 or newer.** Every workflow runs on the workflow engine, which needs it. Without
  Node, a workflow command stops before it creates a task folder and says why. The plugin's hooks
  run on Node too, so they need neither bash nor `jq`.

### From the marketplace

The stable channel:

```bash
copilot plugin marketplace add SkillPanel/maister
copilot plugin install maister-copilot@maister-plugins
```

The beta channel:

```bash
copilot plugin marketplace add 'SkillPanel/maister#beta'
copilot plugin install maister-copilot@maister-plugins-beta
```

Quote the beta source: an unquoted `#` starts a comment in most shells.

The marketplace lists two plugins: `maister-copilot`, the Copilot build, and `maister`, the Claude
Code build. Install `maister-copilot`. The other one is registered but disabled and is no use on
Copilot.

Install one channel only. To switch, uninstall the other first, for example
`copilot plugin uninstall maister-copilot@maister-plugins`.

To install straight from the repository without a marketplace, name the subdirectory:

```bash
copilot plugin install SkillPanel/maister:plugins/maister-copilot
```

### Updating

```bash
copilot plugin update maister-copilot@maister-plugins
```

Use `maister-plugins-beta` on the beta channel. Start a new session afterwards so the new version
loads.

### Running a local checkout

To run a clone of the repository instead of an installed copy, load its Copilot build with
`--plugin-dir`:

```bash
copilot --plugin-dir /path/to/maister/plugins/maister-copilot \
        --add-dir /path/to/maister/plugins/maister-copilot
```

`--plugin-dir` loads the plugin. `--add-dir` only grants file access to the folder; it loads
nothing. You need both when the checkout sits outside your project: the workflows run scripts from
the plugin's folder, and without `--add-dir` Copilot treats that folder as outside the workspace
(see [Permissions](#permissions)).

## First run

Open Copilot CLI in your project and run:

```
/maister-copilot:init
```

`init` reads the codebase, then asks you a handful of questions:

1. whether its reading of the project (type, language, framework, architecture, stack) is right;
2. a short form for the project's description, goals and team;
3. which project documents to write (vision, roadmap, tech stack, architecture);
4. which built-in standards to start from (global, frontend, backend, testing);
5. which coding standards it found in your code and configuration to keep, grouped by how sure it
   is, and how to settle any that conflict with the built-in set.

Taking the recommended answer each time is a sound first setup; everything it writes can be edited
later.

It writes:

- `.maister/docs/`: the project documents, the standards, and `INDEX.md`, which every workflow
  reads to find the standards that apply to a task;
- `.github/copilot-instructions.md`: a section pointing Copilot at `.maister/docs/`, added to the
  file if it already exists.

Commit both, so the rest of the team shares them. Run `init` again to refresh the docs later; it
offers to keep your edits.

## Running workflows

Copilot names a plugin's commands under the plugin, so every Maister command is typed
`/maister-copilot:<name>`. A bare `/development` is reported as an unknown command. Wherever the
other Maister docs write `/maister:<name>`, type `/maister-copilot:<name>` on Copilot.

Give a workflow a task in plain words:

```
/maister-copilot:development Add rate limiting to the login endpoint
```

### Picking a workflow

`/maister-copilot:work <task>` reads the task, picks the workflow that fits and starts it. Use it
when you are not sure which one you need. To choose yourself:

| Command | Use it for |
|---|---|
| `development` | Features, enhancements and bug fixes: analysis, specification, plan, test-driven implementation and verification, with a pause for your review between phases. |
| `research` | A question to answer before building: gathers evidence from the codebase and the pages it can fetch, and writes a report with a recommendation. See [Research and the web](#research-and-the-web). |
| `performance` | Slow code: finds bottlenecks by reading the code (N+1 queries, missing indexes, quadratic loops, blocking I/O), then fixes them like a development run. |
| `migration` | Moving to another library, platform or architecture pattern, step by step, with rollback planning and compatibility checks. |
| `product-design` | A fuzzy idea: explores the problem and options with you, prototypes screens, and ends with a product brief. |
| `quick-plan` | A bounded change: drafts a plan that follows your standards, asks you to approve it, then implements it. |
| `quick-dev` | A small change you want made directly, with your standards applied and checked at the end. |
| `quick-bugfix` | A bug with a clear symptom: reproduces it with a failing test first, then fixes it. |
| `quick-design` | A small design question: lays out the options, recommends one, asks you once and writes a one-page decision record. |
| `reviews-code`, `reviews-pragmatic`, `reviews-production-readiness`, `reviews-reality-check`, `reviews-spec-audit` | One review on its own: code quality and security, over-engineering, deployment readiness, whether finished work really works, and a specification audit. |

The five workflows at the top are described in full, with their flags, in
[Workflow Details](workflows.md); every command is listed in [Commands](commands.md).

### Research and the web

Copilot CLI has web search built in, but GitHub turns it on account by account, on its side, and
not every account has it yet. To get it:

1. Turn on "Copilot can search the web using model native search" in your GitHub Copilot settings.
2. Sign out and back in (`/logout`, then `/login`) so new sessions pick up the change.

Even then a session may have no search until GitHub enables it for your account. There is no
local switch for it; `--experimental` does not turn it on. When search is available, Copilot shows
"Searching the web" in the session. Maister's research agents name Copilot's search tool, so they
use it wherever Copilot offers it to them; check a research run's sources to see whether it did.

Until then, the research agents read pages at addresses they already know or that you give them.

- **Give the run its sources.** Put the URLs that matter in the research question.
- **What works well:** questions about your codebase and about well-documented libraries, whose
  official docs and READMEs the agents can read.
- **What is weak:** anything that needs discovery, such as recent releases, vendor or market scans
  and third-party comparisons. The run leans on the model's own knowledge instead.
- **Allow the sites it needs.** Fetches follow Copilot's URL permission rules (`url(...)` rules,
  `--allow-url`, `--allow-all-urls`). A subagent cannot stop to ask, so under stricter settings
  allow the domains a research task needs before you start it.
- **A search server you add does not reach research.** A search MCP server added to Copilot
  reaches Copilot's built-in agents, but not Maister's research agents, whose tool lists are fixed.

### Where the work goes

Each workflow run gets its own task folder:

```
.maister/tasks/<workflow>/<YYYY-MM-DD-task-name>/
```

It holds the run's state (`orchestrator-state.yml`), the analysis, specification, plan, work log
and reports, many of them with an HTML companion you can open in a browser. Nothing a workflow
writes about its own progress lands outside that folder; the code changes land in your project as
usual.

### Resuming

A run survives the session. To continue it, in the same session or a new one, pass its task folder
to the workflow's command:

```
/maister-copilot:development .maister/tasks/development/2026-10-20-rate-limiting
```

The run picks up at the first step it has not finished and asks only what is still open.

### Task folders from 2.x

A task folder started on the 2.x plugin cannot be resumed on 3.0. Given one, the command refuses
it, changes nothing, and tells you how to install the 2.x line to finish it there:

```bash
copilot plugin marketplace add SkillPanel/maister#release/2.x
copilot plugin install maister-copilot@maister-plugins-2x
```

Or carry a development or research task over as background for a new run:

```
/maister-copilot:development --context=.maister/tasks/development/2025-06-02-old-task Finish the export feature
```

The new run copies the old folder in as reading material and starts from its first phase. See
[Task directories from 2.x](workflows.md#task-directories-from-2x).

## Answering questions

A workflow stops to ask you things: to confirm what it found, to choose between options, and at the
end of each phase to approve the result before it moves on. Copilot shows these as its own forms:

- A single question is a list. The first option is highlighted; ↑/↓ moves, Enter accepts.
- Several questions at once are a form with a tab per field. Tab moves to the next field,
  Shift+Tab back.
- Copilot adds **Other (type your answer)** to every list. Pick it to answer in your own words,
  for example to send a phase back with a correction.

Copilot shows each option's label and nothing else. Maister writes its questions for that: the
recommended option comes first and is marked *(Recommended)*, and the reason for the
recommendation and what each choice leads to are in the question text above the list. Read the
question, not just the options.

Every pause between phases asks in the session, whatever your permission settings. Allow-all
approves tools; it does not answer a workflow's questions.

### Run workflows in interactive mode, not autopilot

Copilot's autopilot mode answers questions itself: a question that would wait for you is answered
with the model's best guess ("Making best guess on autopilot"). In autopilot, Copilot would answer
every one of Maister's approvals for you, and the run would go from analysis to implementation
without you seeing a single phase. If you want to answer the gates, run workflows in Copilot's
interactive mode.

This is not the same as allow-all. Allow-all approves tool calls and still leaves every question
to you; autopilot answers the questions too.

## Permissions

Maister runs under Copilot's own permission settings and adds none of its own, apart from the
destructive-command guard below.

### Approving the engine's commands

The workflow engine records each step by running a `node` command against the run's state. With
Copilot's normal approval, you are asked before the first of these, and before some other shell
commands the run makes (tests, commands with pipes or here-strings). Two ways to keep a run
flowing:

- **Approve `node` for the session** when Copilot asks. Later `node` commands in that session run
  without asking. Everything else is still asked about. This is the narrower choice.
- **Allow all** (`/allow-all`, or start with `--allow-all-tools`). Every tool runs without asking,
  for the whole session: file edits, shell commands and the engine's writes alike. Use it in a
  project where you are happy for the run to change files and run commands unattended. Copilot
  still asks about a few command shapes even then. Allow-all leaves the workflow's questions to
  you; autopilot does not (see
  [Run workflows in interactive mode, not autopilot](#run-workflows-in-interactive-mode-not-autopilot)).

### Subagents cannot ask

Most of a workflow's work is done by Maister's subagents. A subagent cannot stop to ask you for
permission: a command it needs that your settings do not already allow is denied, and Copilot
reports "Permission denied and could not request permission from user". The agent then works
around it or the step fails.

So anything a subagent needs must already be allowed before it runs. The plugin's own folder,
where the engine's scripts live, already is when the plugin is installed: Copilot allows commands
touching a folder under `~/.copilot/installed-plugins/` without asking, in the main session and in
subagents. Only a local checkout loaded with `--plugin-dir` from outside your project needs
allowing; add it with `--add-dir` as shown in
[Running a local checkout](#running-a-local-checkout).

### Copilot's shell validator

Copilot refuses some command shapes outright, whatever you have allowed, for example
`kill $(cat server.pid)` or commands with certain shell expansions ("Command blocked: contains
dangerous shell expansion patterns"). Maister's agents choose another way and carry on, but each
refusal costs a retry.

### The destructive-command guard

The plugin ships a hook that denies a subagent's `git stash`, `git reset --hard`,
`git checkout .`, `git clean`, `git push --force` and `rm -rf`, so an implementer working in
parallel with others cannot throw away work. The few agents that need full shell access are exempt,
and your own commands in the main session are left to your permission settings. A denied command
shows as "Denied by preToolUse hook" and the agent continues without it.

## Models and cost

**Maister's agents run on the session's model.** Pick the model with `/model` before you start;
the plugin does not choose one for you.

**You can choose a subagent's model in your prompt.** Name the agent and a Copilot model id:

```
/maister-copilot:development Add rate limiting to the login endpoint. Use claude-haiku-5.5 for the task-group-implementer subagents.
```

Use the ids `/model` lists (`claude-sonnet-5.5`, not `sonnet`); Claude Code's short aliases are
not Copilot model ids. To set it for every session instead, use `/subagents`, which sets a model
per agent.

**Copilot's built-in `explore` agent picks its own model.** Maister uses it for the codebase
analysis at the start of a development, performance or migration run. Copilot runs it on a
lightweight model whatever the session's model is. If its findings look thin, or it keeps guessing
wrong paths, give `explore` a stronger model in `/subagents`.

**Cost.** Copilot bills each request by the model's multiplier. A full workflow makes many
requests, across many subagents, so the model you choose matters more than for a single prompt.
Check the multipliers in `/model` before you start a long workflow on a premium model, and
consider a lighter model for the implementer subagents, as above.

## Differences from Claude Code

- **Web search depends on your account.** Research can search the web only once GitHub has
  enabled search for your account; until then it reads pages at addresses it knows. See
  [Research and the web](#research-and-the-web).
- **No reminder after compaction.** On Claude Code, a reminder after a compacted context points
  the model back at the run's state. Copilot has no such moment. If a workflow loses its place
  after `/compact`, run the workflow's command again with the task folder, as in
  [Resuming](#resuming).
- **Plan mode.** `quick-plan` and `quick-bugfix` draft their plan without editing anything, then ask
  you to approve it before any change. They do not switch Copilot into plan mode. If you want
  Copilot itself to block edits while planning, enter `/plan` first.
- **Missing folders.** Copilot's file tool does not create a missing parent folder. Maister's agents
  create a folder before writing into it.
- **The guard is a plugin hook.** Copilot loads it from the plugin and runs it with Node, so it
  needs no setup.
- **`MAISTER_PLUGIN_ROOT` is optional.** Copilot tells each skill where it lives, and the scripts
  find the plugin from their own location. Set the variable only if a model keeps guessing the
  plugin's folder wrong, pointing it at the folder that holds `.claude-plugin/plugin.json`
  (`copilot plugin list` shows where the plugin is installed).

## Extending

Everything in [Extending maister](extending.md) works the same on Copilot, with the commands
renamed:

- an **overlay**, `.maister/workflows/<builtin>.overlay.yml`, adds steps to a built-in workflow or
  turns some off, and applies whenever that workflow runs;
- an **eject** is your own copy of a built-in at `.maister/workflows/<name>.yml`, which replaces
  the shipped one for your project and no longer follows the plugin's updates to it;
- a **custom workflow** is your own definition in `.maister/workflows/`;
- `/maister-copilot:workflow-author` interviews you and writes a new workflow or an overlay, checks
  it, and previews its steps;
- `/maister-copilot:run <name>` starts a workflow by name, `/maister-copilot:run --list` lists the
  project's own, and `/maister-copilot:run <name> --check` validates one without starting it.

## Troubleshooting

**"Failed to load 1 skill" at startup.** A skill's description could not be read. Update to the
latest version (`copilot plugin update maister-copilot@<marketplace>`). `copilot skill list` shows which skill failed.

**"Path does not exist" or "Parent directory does not exist", again and again.** The model is
guessing a path wrong, or writing into a folder that is not there yet. A few of these are normal and
the agent recovers. If a step loops on one, answer with the right path, or tell it to create the
folder first. When the guesses come from the codebase analysis, give `explore` a stronger model in
`/subagents`.

**"Permission denied and could not request permission from user".** A subagent needed something
your settings do not allow, and subagents cannot ask. Approve `node` for the session, or the
command shape it needed; for a local checkout, add its folder with `--add-dir`. See
[Subagents cannot ask](#subagents-cannot-ask).

**"Command blocked: contains dangerous shell expansion patterns"** (or a similar "Command
blocked"). Copilot's shell validator refused the command shape. The agent normally tries another
way; nothing needs changing on your side.

**"Denied by preToolUse hook".** The destructive-command guard stopped a subagent's destructive
command. That is intended.

**A command is unknown, or a workflow is missing.** Check what loaded:

- `copilot plugin list` shows installed plugins and where they live; `maister-copilot` should be
  there and enabled;
- `copilot skill list` shows the skills each plugin loaded, and any that failed;
- inside a session, `/skills` shows the session's own view.

Type commands with the plugin name, `/maister-copilot:<name>`. If you loaded a checkout with
`--add-dir` alone, add `--plugin-dir`: `--add-dir` loads no plugin.
