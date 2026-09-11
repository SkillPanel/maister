# Maister for GitHub Copilot CLI

Structured, standards-aware SDLC workflows as Copilot CLI skills, agents and commands.
This directory is the GitHub Copilot CLI variant; everything in it is generated from the
Claude Code plugin, so the two stay one codebase with two vocabularies.

## Install

From a registered marketplace:

```bash
copilot plugin marketplace add SkillPanel/maister
copilot plugin install maister-copilot@maister-plugins
```

Straight from the repository, without a marketplace, using the CLI's
`<owner>/<repo>:<subdirectory>` form -- the repository is `SkillPanel/maister` and the
subdirectory is `plugins/maister-copilot`:

```bash
copilot plugin install <owner>/<repo>:<subdirectory>
```

Or run a local checkout with `copilot --plugin-dir /path/to/maister/plugins/maister-copilot`.
Add `--add-dir` for the same path when the checkout sits outside your working directory --
that grants file access to it. `--add-dir` on its own does not load a plugin.

## Export the plugin root -- required

Copilot CLI exports no plugin-directory variable of its own: the four it does export name the
session and the CLI build, not where a plugin was loaded from. Four of this variant's skills
tell an agent to run a script under the plugin's own directory, and they spell that directory
`${MAISTER_PLUGIN_ROOT}`. With the variable unset the instruction does not resolve, and the
agent works the directory out and substitutes a path -- exactly the guessing the variable
exists to remove.

Point it at the directory holding `.claude-plugin/plugin.json`. Which directory that is
depends on how you installed:

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

The runtime shipped here reads the same variable, so the path a skill tells an agent to run and
the path the runtime resolves from are one answer rather than two.

## Requirements

- GitHub Copilot CLI 1.0.80 or newer
- Node.js 20 or newer
- `jq` on `PATH`, for the destructive-command guard

## Gate hooks

Copilot resolves hooks from your own repository, never from a plugin directory. The
registration and the scripts it names are staged in `.github/hooks/` here; that directory's own
`README.md` covers copying them into the repository Copilot runs in, the headless opt-in, and
the user-hooks alternative.

## Where the documentation lives

The workflow reference, the command reference and the extension guide ship with the source
repository at `SkillPanel/maister`.
