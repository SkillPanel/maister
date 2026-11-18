# Troubleshooting

For people whose Maister run does not behave as expected. Each entry gives the symptom, the
cause and the fix. Problems specific to GitHub Copilot CLI are in
[Maister on GitHub Copilot CLI](copilot.md#troubleshooting).

## A workflow stops at once and asks for Node.js

**Symptom.** A workflow command stops before it creates a task directory. It says the workflow
needs Node.js 20 or newer, and the run ends with `RUN-FAILED: node-unavailable`.

**Cause.** Every workflow runs on the workflow engine, which is a Node.js program. Before it writes
anything, the engine runs `node --version`. When that fails, or reports a version below 20, it
stops. The plugin's hooks also run on Node.js.

**Fix.** Install Node.js 20 or newer where you run Claude Code or Copilot CLI. Check it with
`node --version` in the same shell you start the session from, then start a new session and run
the command again. Nothing was created, so there is nothing to clean up. An install that cannot
run Node.js 20 can stay on the 2.x line: see [Upgrading from 2.x](upgrading-from-2x.md#staying-on-2x).

## Every step asks for permission

**Symptom.** You are asked to approve a file edit and a shell command several times in each phase,
for the same two things every time.

**Cause.** The engine records each change to a run's state in two steps. It writes the change to
one file in the task directory, `.state-patch.json`, and then runs its own command, which reads
that file and deletes it. Your permission settings decide whether either step asks first.

**Fix.** Allow both once:

- **The file.** Accept edits for the session, or add an edit rule for `**/.state-patch.json`.
- **The command.** When the engine's command asks, approve it with *don't ask again*, or add an
  allow rule for it in your permission settings.

Checkpoints are asked whatever your permission mode, so allowing these takes no decision away
from you. On Copilot CLI, see
[Approving the engine's commands](copilot.md#approving-the-engines-commands).

## The session stops progressing

**Symptom.** After a long step, often implementation, or after the context was compacted, the
session goes idle in the middle of a run.

**Cause.** The run's progress lives in the task directory's `orchestrator-state.yml`, not in the
conversation. After a compaction the session can lose track of where it was. On Claude Code, a
reminder at that moment points it back at the state file, but it may still stop.

**Fix.** Type `continue`. The session picks up where it left off. If it does not, resume the run
by passing its task directory to the workflow's command:

```bash
/maister:development .maister/tasks/development/2026-03-24-my-feature
```

`/maister:work <task directory>` and `/maister:run <task directory>` resume it too. The run
starts at the first step it has not finished and asks only what is still open.

## A task directory is refused on resume

**Symptom.** Resuming a task says it was started on the maister 2.x plugin and that 3.0 does not
resume it.

**Cause.** 3.0 resumes only runs its own engine started. A 2.x task directory has no recorded
workflow to resume from. Nothing in the directory was changed, and its files are still readable.

**Fix.** Finish it on the 2.x line, or start the work again on 3.0, optionally with the old task
directory as background. Both are described in
[Upgrading from 2.x](upgrading-from-2x.md#tasks-started-on-2x).

## A warning says two editions of the plugin are enabled

**Symptom.** On Claude Code, a warning at session start says that two (or more) editions of the
maister plugin are enabled, lists them with the settings each comes from, and gives a
`claude plugin disable <plugin>@<marketplace> --scope <scope>` command for each. Workflows refuse
to start or resume with an `edition-collision` message.

**Cause.** More than one Maister channel is enabled, for example the stable `maister-plugins` and
the beta `maister-plugins-beta`, or one of them and the 2.x `maister-plugins-2x`. Claude Code then
loads each skill from either copy, so a workflow can fail on a file only the other copy ships.

**Fix.** Keep one channel. Disable or uninstall the others with the command the warning gives,
then restart Claude Code. Workflows start and resume again once only one is enabled. A channel
enabled by managed settings can be changed only by the administrator who manages them.

## Browser steps are offered without the browser

**Symptom.** Where a run would offer the browser checks, a user guide with screenshots or the
HTML mockup gallery, it says there is no browser tool in the session and recommends going on
without it.

**Cause.** Maister ships no browser tool. It uses whichever one the session has: `playwright-cli`,
a Playwright MCP server you configured, Claude in Chrome, or the Claude desktop app's built-in
browser. A session with none is warned, and the run goes on; it never fails for this.

**Fix.** Add a browser tool and start a new session. Which tools work, the order they are used
in, and how to install them are in [Configuration](configuration.md). On Copilot CLI, use
`playwright-cli`. To skip browsers altogether for mockups, set `mockup_format: ascii` in
`.maister/config.yml`.

## A workflow does not work in plan mode

**Symptom.** A workflow started in Claude Code's plan mode cannot create its task directory or
write its documents.

**Cause.** Plan mode restricts file creation. A workflow writes its task directory, state and
documents as it goes, and plans as one of its own steps.

**Fix.** Leave plan mode before you start a workflow, and let the workflow do the planning. When a
plan is all you want, `/maister:quick-plan` enters plan mode itself.

## A workflow of your own does not start

**Symptom.** `/maister:run <name>` reports errors and starts nothing.

**Cause.** `/maister:run` validates a definition before it starts a run, and a definition that
does not validate never becomes one.

**Fix.** Run the check on its own, which starts nothing and names the file, node and field of each
error, with a fix where the fix is mechanical:

```bash
/maister:run <name> --check
/maister:workflow-author check <name>
```

The second adds checks the validator does not make, on the skills and agents your steps call and
on the prose companion. Common causes:

- The file name and the definition's `name:` differ. They must match.
- `version` is quoted or not `1`. Write the bare number.
- A key is misspelt. The error names the keys accepted there and the one you probably meant.
- The workflow is named `bug-fixes`, `enhancements`, `new-features`, `refactoring` or `mockups`.
  Those are old task folder names; rename the workflow.
- A step carries `dir:`. `/maister:run` names those steps and does not start the workflow.

A warning never blocks. `unresolved-reference` means a skill, agent or workflow your definition
names was found nowhere: a typo, or something not installed here. Writing definitions is covered
in [Extending Maister](extending.md).

## A subagent is blocked from running a command

**Symptom.** A subagent reports `Destructive command blocked for agent '<agent>': <command>`. On
Copilot CLI it shows as "Denied by preToolUse hook".

**Cause.** A hook stops subagents from running commands that throw work away: `git stash` (apart
from `git stash list` and `git stash show`), `git reset --hard`, `git checkout .`, `git clean`,
`git push --force` and `rm -rf`. Implementers run side by side, and one of these commands could
destroy another's work. The test-suite runner is the one exception, so it can run the project's
own check commands as written.

**Fix.** Nothing; this is intended, and the agent normally finds another way. The hook applies
only to subagents, never to your own session, so run the command yourself if it is really
needed.

## A flag is declined

**Symptom.** A run says it does not take `--from=PHASE` or `--reset-attempts`, and goes on
without it.

**Cause.** Both flags come from the 2.x plugin. A run resumes from its recorded state at the first
step not yet finished, so there is no phase to jump to and no attempt counter to reset. A
workflow command names any other flag it does not take in the same way.

**Fix.** Resume with the task directory alone. To go back inside a run, choose *revise* at a
checkpoint: it sends the run back to the step that wrote the document, with your note. The flags
each command takes are in the [command reference](commands.md).

## The review counts files the default branch brought in

**Symptom.** A run's review lists files you did not change in the run: files that came in when the
default branch was merged into the branch.

**Cause.** The review measures from the commit the run started on. A merge of the default branch
adds commits after that point, so the review counts the merged-in work as the run's own.

**Fix.** Run `/maister:update-branch` on the branch. It merges the default branch, runs the checks,
commits the merge and moves the run's start commit to the merged commit, so the next review counts
only the run's own work. Pass `--onto <branch>` when the branch was cut from a branch other than the
default one. The flags are in the [command reference](commands.md). A run that started after the
branch already had commits of its own cannot have its start commit moved past the merge: the command
leaves that run as it was and says so, and its review keeps measuring from its own start.
