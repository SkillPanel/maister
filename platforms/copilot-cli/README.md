# Maister for GitHub Copilot CLI

Structured, standards-aware SDLC workflows as Copilot CLI skills, agents and commands.
This directory is the GitHub Copilot CLI variant; everything in it is generated from the
Claude Code plugin, so the two stay one codebase with two vocabularies.

## Install

From a registered marketplace, on the stable channel:

```bash
copilot plugin marketplace add SkillPanel/maister
copilot plugin install maister-copilot@maister-plugins
```

Or on the beta channel:

```bash
copilot plugin marketplace add SkillPanel/maister#beta
copilot plugin install maister-copilot@maister-plugins-beta
```

Install one channel only: uninstall the other first, for example
`copilot plugin uninstall maister-copilot@maister-plugins`.

Straight from the repository, without a marketplace, using the CLI's
`<owner>/<repo>:<subdirectory>` form -- the repository is `SkillPanel/maister` and the
subdirectory is `plugins/maister-copilot`:

```bash
copilot plugin install <owner>/<repo>:<subdirectory>
```

Or run a local checkout with `copilot --plugin-dir /path/to/maister/plugins/maister-copilot`.
Add `--add-dir` for the same path when the checkout sits outside your working directory --
that grants file access to it. `--add-dir` on its own does not load a plugin.

## Run a workflow

Copilot CLI names a plugin's commands and skills under the plugin, so every command is typed
`/maister-copilot:<name>`:

```
/maister-copilot:init
/maister-copilot:development Add a multiply(a, b) function
/maister-copilot:reviews-code src/
```

A bare `/development` is reported as an unknown command.

## The plugin root -- optional

Several of this variant's skills -- the workflow engine's among them -- tell an agent to run a
script under the plugin's own directory, spelled `${MAISTER_PLUGIN_ROOT}`. You do not need to
set it: Copilot CLI hands every skill its base directory, the agent builds the script's path
from it, and the scripts themselves resolve the plugin from their own location.

Export it when you want that path fixed rather than worked out -- for example when you run the
engine's scripts by hand, or a model keeps guessing the directory. Point it at the directory
holding `.claude-plugin/plugin.json`, which depends on how you installed:

```bash
# from a marketplace
export MAISTER_PLUGIN_ROOT=~/.copilot/installed-plugins/<marketplace>/maister-copilot

# straight from a repository
export MAISTER_PLUGIN_ROOT=~/.copilot/installed-plugins/_direct/<source>

# a local checkout -- the path you passed to --plugin-dir
export MAISTER_PLUGIN_ROOT=/path/to/maister/plugins/maister-copilot
```

`copilot plugin list` names what is installed. Put the export in your shell profile: it is read
at spawn time and there is no flag for it.

## Hooks

The variant ships two of the plugin's hooks, which Copilot CLI loads from the plugin's
`hooks/hooks.json`:

- **A session-start reminder** that tells the model to run a `/maister-copilot:` command
  through its skill and to ask at every workflow gate.
- **The destructive-command guard**, which denies a subagent's `git stash`,
  `git reset --hard`, `git checkout .`, `git clean`, `git push --force` and `rm -rf`. Agents
  that need full shell access are exempt, and the main session is left to your own permission
  settings. The guard reads the subagent's identity from the hook's input, and it needs `jq`
  to do that: without `jq`, every shell call a subagent makes is denied.

**No reminder after compaction.** On Claude Code, a second reminder runs when a session
resumes after its context is compacted, and points the model back at the run's state file.
Copilot CLI starts no session after compaction, so that reminder is not shipped here. After a
long session is compacted, tell the model to re-read the run's `orchestrator-state.yml` before
it continues a workflow.

**Web search depends on the session.** The research agents are granted web search through
Copilot's `web` alias, but an agent gets only the tools its session has. Where the session has
no web search tool of its own, the agents can still fetch a page whose URL they know, and the
research draws on the codebase and those pages.

## Requirements

- GitHub Copilot CLI 1.0.100 or newer. That is the release this variant was verified on, and
  the first one whose hook input names the subagent that made the call, which the
  destructive-command guard needs.
- Node.js 20 or newer -- required: every workflow runs on the workflow engine, which needs it
- `jq` on `PATH`, for the destructive-command guard

## Updating

`copilot plugin update maister-copilot@<marketplace>` fetches and installs the latest version.

## Staying on 2.x

The 2.x maintenance line has a Copilot variant too:

```bash
copilot plugin marketplace add SkillPanel/maister#release/2.x
copilot plugin install maister-copilot@maister-plugins-2x
```

Uninstall any other channel first.

## Answering gates

When a workflow pauses at a gate, you answer it in the session; that needs no setup here.
Driven sessions, resumed headlessly without an in-session answer, are a Pro Edition feature.

## Where the documentation lives

The workflow reference, the command reference and the extension guide ship with the source
repository at `SkillPanel/maister`.
