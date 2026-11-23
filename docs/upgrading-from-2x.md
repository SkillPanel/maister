# Upgrading from 2.x to 3.0

For people who use Maister 2.x and are moving to 3.0.

Maister 3.0 runs every workflow on a workflow engine. The workflow, quick and standards commands
keep their names, and your project's `.maister/` directory needs no conversion. Two things change
that you have to plan for: Node.js is now required, and a task started on 2.x is not resumed by
3.0.

## At a glance

| | 2.x | 3.0 |
|---|---|---|
| Node.js | Needed only for HTML mockups | Node.js 20 or newer, required |
| A task in flight | Resumed from its task directory | A 2.x task is not resumed. Finish it on 2.x, or start it again on 3.0 |
| Browser tool | A Playwright server was bundled | None is bundled. Maister uses the browser tool your session has |
| Review commands | `reviews-code`, `reviews-pragmatic`, `reviews-reality-check`, `reviews-production-readiness` | `reviews-code-risk`, `reviews-simplicity`, `reviews-spec` |
| Resuming at a chosen phase | `--from=PHASE` | Not available. A checkpoint's "revise" sends a run back |
| Your own workflows | Not available | `.maister/workflows/`, run with `/maister:run` |
| Hooks | Needed bash | Run on Node.js, on Windows too |
| Copilot CLI plugin and commands | `maister-copilot`, `/development` | `maister`, `/maister:development` |

## Before you upgrade

1. **Finish the tasks you have in flight**, or decide to start them again on 3.0. See
   [Tasks started on 2.x](#tasks-started-on-2x).
2. **Install Node.js 20 or newer** where you run Claude Code or Copilot CLI. `node --version` shows
   what you have. Without it, a workflow command stops before it creates anything and says why.
3. **Add a browser tool if you use browser checks**, user documentation with screenshots, or the
   mockup gallery. Any one of these works:
   - `playwright-cli`: `npm install -g @playwright/cli`
   - a Playwright MCP server: `claude mcp add playwright -- npx @playwright/mcp@latest`
   - Claude in Chrome, or the Claude desktop app's built-in browser

   On Copilot CLI, use `playwright-cli`. Without a browser tool, those steps are offered without
   the browser; the run does not fail. [Configuration](configuration.md) has the details.

## Upgrade

```bash
claude plugin marketplace update maister-plugins
claude plugin update maister@maister-plugins
```

Then run `/reload-plugins` or start a new session.

On Copilot CLI the plugin is now called `maister`, so `copilot plugin update` will not move you across. Reinstall it once:

```bash
copilot plugin uninstall maister-copilot@maister-plugins
copilot plugin install maister@maister-plugins
```

Then start a new session.

## After you upgrade

- **Expect a new permission prompt.** The engine records each step of a run with a command of its
  own. Approve it with "don't ask again", or allow it in your permission settings. See
  [Troubleshooting](troubleshooting.md).
- **Your `.maister/` directory works as it is.** Standards, project docs and finished tasks need no
  migration.
- **Optional: run `/maister:init` again and choose to update the docs.** It keeps your edits and
  offers what is missing: any of the vision, roadmap, tech stack and architecture documents you do
  not have, and two optional blocks in `.maister/config.yml` — `subagents`, which sets the models
  subagents run on, and `project`, a profile the reviews use. 3.0 works without them. Both blocks
  are described in [Configuration](configuration.md). The update also offers to bring the built-in
  standards up to date, rule by rule, keeping your edits; `/maister:standards-update --built-in` does
  the same later.
- **Optional: run `/maister:standards-update --refresh-index`** to rebuild the docs index.

## Tasks started on 2.x

3.0 resumes only runs its own engine started. Given a 2.x task directory, `/maister:work`,
`/maister:run` and each workflow's own command tell you so and change nothing in it. Trying is
safe.

You have three choices for a task in flight.

**Finish it on 2.x.** Do this before you upgrade, or install the 2.x line later (see
[Staying on 2.x](#staying-on-2x)).

**Continue it as a new run on 3.0.** Development, research and product design accept the old task
directory as background:

```bash
/maister:development "Finish the export feature" --context=.maister/tasks/development/2026-05-04-export
```

The new run copies the old folder into its own task directory and reads it at every step. It does
not resume: it starts at its first step and asks each checkpoint again. The 2.x folder is left as
it was. Performance and migration take no `--context`; finish those on 2.x or start them again.

**Start over.** Run the command again with the task description and no task path.

Finished task directories need nothing. Their files stay readable in place.

## Commands

Every workflow, quick and standards command keeps its name. The review commands changed:

| 2.x | 3.0 |
|---|---|
| `/maister:reviews-code` | `/maister:reviews-code-risk` |
| `/maister:reviews-pragmatic` | `/maister:reviews-simplicity` |
| `/maister:reviews-reality-check` | Removed. `/maister:reviews-spec` checks a change against its specification, and the run's claims against evidence |
| `/maister:reviews-production-readiness` | Removed. `/maister:reviews-code-risk` covers resilience, security and operational hygiene for the way your project is deployed |
| `/maister:reviews-spec-audit` | Unchanged |

`--scope` on `reviews-code` and `--target` on `reviews-production-readiness` are gone with those
commands. The new reviews take a task directory or a base commit or branch.

New in 3.0:

| Command | What it does |
|---|---|
| `/maister:run` | Starts, resumes, lists or checks a workflow by name, including ones your project defines |
| `/maister:workflow-author` | Writes and checks your own workflows and overlays |
| `/maister:quick-design` | Settles one small design question and records the decision |
| `/maister:reviews-spec` | Checks that a change does what its specification says |

Every command and flag is in the [command reference](commands.md).

## Flags

| Flag | 2.x | 3.0 |
|---|---|---|
| `--from=PHASE`, `--reset-attempts` (all workflows) | Honoured | Declined by name; the run continues without them. Resume with the task directory alone. To go back inside a run, choose "revise" at a checkpoint |
| `--type=bug\|enhancement\|feature` on development | Documented | Removed. The analysis finds out whether the task fixes a reproducible defect, and writes a failing test first if so |
| `--code-review` on development | Documented | Removed. The three reviews always run in verification |
| `--e2e` / `--no-e2e`, `--audit` / `--no-audit` on development | Forced or skipped the step | Set which answer the checkpoint recommends. The checkpoint is always asked |
| `--brainstorm` / `--no-brainstorm`, `--design` / `--no-design` on research | Forced or skipped the step | Set which answer the checkpoint recommends |
| `--no-visual` on product design | Present | Removed. Set `mockup_format: ascii` in `.maister/config.yml` for mockups drawn as text |
| `--context=PATH` on development, research, product design | Not available | New: a file or folder read as background at every step |
| `--design=PATH`, `--architecture=PATH`, `--publish` on development | Not available | New |
| `--refresh-index` on standards-update | Not available | New |
| `--built-in` on standards-update | Not available | New |

A flag a workflow does not take is named as not taken, and the run goes on without it.

## Workflows

- **Checkpoints can send a run back.** Where a checkpoint closes a document, "revise" returns the
  run to the step that wrote it, with a note from you. That step and the steps between it and the
  checkpoint run again, and the checkpoint asks again.
- **Clear fixes are made without asking.** When verification finds issues, fixes that are obvious
  and not risky are made and re-checked, up to two times, before you are asked about the rest.
- **Some approvals are gone.** Development no longer stops to approve a bug fix's passing test,
  and mockups are sent back from their checkpoint and have no review loop of their own.
- **Product design is shorter.** It has three checkpoints.

## Mockups

`/maister:mockup-studio` now draws one new version of a set of mockups each time you call it, and
never asks a question. Run it again with a note for the next version; earlier versions stay. Its
tasks are written under `.maister/tasks/mockup-studio/`. An existing `.maister/tasks/mockups/`
folder is left alone and no longer written to.

Mockups follow your project's design language through a grounding pack in
`.maister/docs/design-context/`, built on the first mockup and rebuilt with
`/maister:mockup-studio --ground`. More in [Mockups](mockups.md).

## Project files

- `.maister/workflows/` is new. It holds workflows and overlays your project defines.
- `.maister/config.yml` keeps `html_output` and `mockup_format`, and gains the optional
  `subagents` and `project` blocks.
- `/maister:init` now always adds its pointer to your `CLAUDE.md` (on Copilot CLI,
  `.github/copilot-instructions.md`), creating the file if there is none. On 2.x it asked first.
- Running `/maister:init` on an initialised project offers two choices: update the docs and keep
  your edits, or start over. Starting over moves the old directory to `.maister.backup-<date>/`.

## GitHub Copilot CLI

- **The plugin is `maister`, and commands carry its name**, as on Claude Code. Type
  `/maister:development`, not `/development`. A bare name is reported as an unknown command.
- **The plugin now ships hooks on Copilot**: a reminder at session start and the guard that stops
  subagents from running commands that throw work away.
- **No browser server is bundled** here either; use `playwright-cli`.

See [Maister on GitHub Copilot CLI](copilot.md).

## Staying on 2.x

To keep using 2.x, or to finish a task you started there, install the 2.x maintenance line. Only
one Maister channel can be enabled at a time, so uninstall the other first:

```bash
/plugin uninstall maister@maister-plugins
/plugin marketplace add SkillPanel/maister#release/2.x
/plugin install maister@maister-plugins-2x
```

On Copilot CLI:

```bash
copilot plugin uninstall maister@maister-plugins
copilot plugin marketplace add SkillPanel/maister#release/2.x
copilot plugin install maister-copilot@maister-plugins-2x
```

On Claude Code, if two channels are enabled together, a warning at session start names both and
gives the command that disables each. Workflows do not start or resume until only one is enabled
and you have restarted. See [Troubleshooting](troubleshooting.md).

The 2.x line receives fixes only, with no new features, for six months after 3.0.0 is released.
