# Getting started

For people new to Maister: set up a project, then walk one development run from the first command
to a finished change, checkpoint by checkpoint.

## Before you start

You need:

- Claude Code or GitHub Copilot CLI at the minimum version the [README](../README.md#quick-start) gives, or newer;
- Node.js 20 or newer. Every workflow needs it; without it a workflow command stops before it
  creates anything and says why.

Install the plugin as the [README](../README.md) shows, then restart your session. On Copilot CLI,
follow [Maister on GitHub Copilot CLI](copilot.md); the commands are typed the same way,
`/maister:<name>`.

## Set up the project

Run this once per project, from its root:

```
/maister:init
```

Init analyzes the codebase, then asks:

1. Whether its findings are right: project type, language and framework, architecture, tech
   stack, and anything it was unsure of. Pick a suggested correction or type your own.
2. A one-page form: a project description it drafted, the project's goals, and the team context.
   Each has a recommended answer, and goals and team context can be skipped.
3. Which project documents to write: vision, roadmap, tech stack and architecture, or the tech stack
   only, or a choice of them.
4. Which standards groups to start with: global and testing always, plus the groups that fit the
   stack (frontend, backend, data, cli, mobile, jobs, infra), each named with the reason it is
   recommended.
5. Then it scans the project for the coding standards it already follows and asks which to keep.

It writes:

- `.maister/docs/`: the standards under `standards/`, the project documents under `project/`, and
  `INDEX.md`, the map every run reads;
- `.maister/config.yml`: the output settings, the models your subagents run on, and a project
  profile for the reviewers ([Configuration](configuration.md));
- a section in your project's `CLAUDE.md` (created if missing) that points every session at the
  index.

Its summary lists what it wrote, including any profile fields it could not settle. Fill those in by
hand: they decide which checks the reviewers apply. Run `/maister:init` again later and it offers to
bring the setup up to date, keeping your edits. More on standards: [Standards](standards.md).

## Before your first run

- **Accept edits automatically.** A run writes many files into its task directory; approving each
  one gets in the way.
- **Don't use plan mode.** Planning is part of every workflow, and plan mode stops the run from
  writing its specification and plan.
- **Start in a fresh session**, especially when you build on an earlier research or product-design
  run: its task directory already holds the context the new run needs.

## Start a run

```
/maister:development "Add CSV export to the reports page"
```

Or describe the task in conversation first and run `/maister:development` with no description: the
run takes the task from the conversation.

The run starts by telling you:

- the workflow and the task;
- how many checkpoints you may be asked at;
- its task directory, under `.maister/tasks/development/`, as a full path;
- the dashboard link;
- the first step.

The dashboard opens in your browser.

### The permission prompt

The run saves its progress after every step with one command of its own, and your CLI asks
permission for it the first time. Approve it with *don't ask again*, or allow it in your permission
settings, and it stops asking. Accepting edits covers the files the run writes into its task
directory.

## Steps and checkpoints

The run goes step by step: codebase analysis, gap analysis, specification, planning,
implementation, verification and finalization, with optional steps the analysis or your answers
switch on. The full list is in [Workflows](workflows.md#development).

After the main steps it stops at a **checkpoint**. Each one opens with what finished, and then gives
you the checkpoint at a glance:

- **Done**: what the steps since the last checkpoint produced;
- **Found**: what the step found;
- **Next**: the step that runs next, and any it skips;
- **Review**: the files to open, inside the task directory;
- the risks still open, the fixes the run made without asking, the decisions it made and who made
  each, and a count of your own answers, naming any that differ from the recommendation.

You answer with one of three kinds of option:

- **Continue.** Where the next step is optional, the checkpoint has one continue for each way on,
  for example *Continue to the browser checks* and *Continue without browser checks*. The
  recommended one gives its reason.
- **Revise** (at some checkpoints): send the step back with a note. See
  [Sending a step back](#sending-a-step-back).
- **Stop.** The run ends there. Stop is recommended, with its reason, when a step found a reason to
  stop.

In a development run, these checkpoints are always asked:

| Checkpoint | What you approve | Options |
|---|---|---|
| Gap analysis | What has to change, and the decisions it needed | Continue, revise the gap analysis, stop |
| Specification | `implementation/spec.md`, after its audit fixed what it could and asked you the rest | Continue to the implementation plan, revise the specification, stop |
| Implementation plan | `implementation/implementation-plan.md` | Continue to the implementation, revise the plan, stop |
| Implementation | The code the task groups wrote | Continue, stop |
| Verification | The verification report | Continue to the browser checks, or without them; stop |

Steps that ran only for this task, such as the failing test of a bug fix or the UI mockups, add a
checkpoint of their own. The specification audit has none: it runs on every specification, before
the specification checkpoint, which shows what it fixed and what it left open.

## Answering a question

Steps also ask questions along the way: clarifications after the analysis, decisions in the gap
analysis, whether to write a user guide. Every question carries what you need to decide in its own
text.

- **The recommended answer gives its reason**, and keeps every criterion your task states.
- **In Claude Code, moving to an option shows its detail beside the options**: what choosing it
  does, or an alternative's pros and cons. On Copilot CLI, which shows no previews, the detail is in
  the question.
- **More details** writes the full context out and asks the same question again; it records
  nothing. When every option slot is taken, type *details* instead.
- **Independent questions come in pages of up to four**, such as assumptions to confirm or issues to
  decide.
- **Design decisions come one area at a time**, each with every alternative, its pros and cons and
  the recommendation, because a later area can depend on an earlier answer.
- **Questions about one behaviour come as one drafted story**: who does what, where, what is stored
  and what is visible afterwards, with the defaults filled in. Accept it, accept it with the
  corrections the run lists, take the alternative story where there is one, or write your own.
- **A question the run can already answer is not asked.** It says the answer in one line instead,
  for example "User guide: on, asked for when the run started".

Every answer is kept in the run's state, with whether you took the recommendation.

## Sending a step back

Some checkpoints offer **revise** beside continue and stop. It sends the run back to the step that
wrote what you are approving, with a note saying what to change. That step runs again over its own
output, everything between it and the checkpoint runs again, and the checkpoint asks you once more.

- **The note is chosen, not typed.** After you pick revise, the run offers suggested changes drawn
  from what the step left open, none ticked in advance. Pick any of them, or type your own.
- **Revise as often as you need.** The option says how often the checkpoint has sent the run back so
  far. A ceiling of ten per checkpoint stops a runaway loop; at it, only continue and stop are
  offered.
- **The dashboard tags each re-run step with its attempt**, and the checkpoint keeps every note.

Which checkpoints offer revise, per workflow, is in [Workflows](workflows.md). Verification offers
none: it fixes what it finds before it asks.

## Verification and the automatic fixes

Verification runs the tests and the project's other checks (lint, format, typecheck, build) and
three reviews: spec conformance, code risk and simplicity. When they find issues, the run fixes
every issue that is clear and not risky without asking, then checks again on its own, up to two
times. Only then does it ask:

- one question per issue that needs your decision: the proposed fix, its alternatives and *Accept
  the risk and list it*, with the recommendation and its reason;
- when the automatic re-checks are spent: one more round, continue as is, or stop.

The verification checkpoint lists every fix made without asking. What the reviewers check, and how
to tell them what kind of project this is: [Configuration](configuration.md#what-the-reviewers-check).

## Watching the run

**The dashboard** (`dashboard.html` in the task directory) shows every step with its status, summary,
decisions and risks, links to the documents, and the verification results. It updates after every
step. The run names its link when it starts, when it resumes and when it ends.

**In Claude Code's terminal** and the desktop app's Code tab, the plugin also draws the run beside
the session: a card when the run starts, a band above the prompt with the current step, for example
`phase 5 of 12 · Implementation planning`, and at each checkpoint a short panel above the question.
The step count leaves out checkpoints, and a skipped step keeps its place, so the total never
shrinks. Nothing is drawn in the VS Code extension, in `claude -p`, with plugin modules switched off,
or on Copilot CLI; each checkpoint question carries its context either way.

## Closing the session and resuming

You can stop at any point: close the session, or answer a checkpoint later. Everything the run needs
is in its task directory. To carry on, start a session and pass the directory:

```
/maister:development .maister/tasks/development/2026-11-18-csv-export
```

`/maister:work <task directory>` works too. The run picks up at the step it had reached and shows
the dashboard link again. If a run goes quiet after a long step, see
[Troubleshooting](troubleshooting.md).

## When the run ends

The run closes with one message:

- **Done**: what was built, or where the run stopped;
- **Needs you**: anything still open, or "nothing";
- **Follow-ups**: things to do after this run;
- **Next**: the next steps, commit first;
- **Files**: the key files the run wrote;
- **Dashboard**: the link.

The run does not commit. It writes the commit message to `commit-message.txt` in the task directory
and names it under **Next**. Review the diff, commit, and open a pull request as you normally would.
To have the run publish for you, start it with `--publish`: approving the plan then also approves a
commit on the run's own branch, a push and a pull request when it finishes ([Commands](commands.md)).

If the run noted standard candidates, **Next** ends with `/maister:standards-update`, which offers
them and adds the ones you choose ([Standards](standards.md)).

## Building on earlier work

A research or product-design run's task directory holds everything the next run needs. Start the
development run in a fresh session and pass it:

```
/maister:development "Implement OAuth" --research=.maister/tasks/research/2026-01-12-oauth-research
/maister:development "Build the API usage dashboard" --design=.maister/tasks/product-design/2026-03-10-api-dashboard
```

Passing the task directory as the only argument works too, optionally followed by instructions such
as `Implement only phase 1`.

## Where next

- [Workflows](workflows.md): the six built-in workflows, their steps and checkpoints.
- [Commands](commands.md): every command and flag.
- [Configuration](configuration.md): `.maister/config.yml`, task directories, subagent models,
  browser tools.
- [Troubleshooting](troubleshooting.md): what to do when something goes wrong.
