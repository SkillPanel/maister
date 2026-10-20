# Maister for GitHub Copilot CLI

Structured, standards-aware SDLC workflows as Copilot CLI skills, agents and commands.
This directory is the GitHub Copilot CLI variant; everything in it is generated from the
Claude Code plugin, so the two stay one codebase with two vocabularies.

**The user guide is `docs/copilot.md` in the source repository at `SkillPanel/maister`:**
<https://github.com/SkillPanel/maister/blob/master/docs/copilot.md>. It covers installing,
the first run, running and resuming workflows, answering questions, permissions, models and
cost, the differences from Claude Code, extending, and troubleshooting.

## Install

On the stable channel:

```bash
copilot plugin marketplace add SkillPanel/maister
copilot plugin install maister-copilot@maister-plugins
```

Or on the beta channel:

```bash
copilot plugin marketplace add 'SkillPanel/maister#beta'
copilot plugin install maister-copilot@maister-plugins-beta
```

Install `maister-copilot`; the marketplace also lists `maister`, the Claude Code build. Install
one channel only: uninstall the other first, for example
`copilot plugin uninstall maister-copilot@maister-plugins`.
`copilot plugin update maister-copilot@<marketplace>` fetches the latest version.

To run a local checkout, pass both `--plugin-dir` and `--add-dir` for
`/path/to/maister/plugins/maister-copilot`: the first loads the plugin, the second grants file
access to it.

## Requirements

- GitHub Copilot CLI 1.0.100 or newer
- Node.js 20 or newer: every workflow runs on the workflow engine, which needs it
- `jq` on `PATH`, for the destructive-command guard

## Run a workflow

Every command is typed `/maister-copilot:<name>`:

```
/maister-copilot:init
/maister-copilot:work Add a multiply(a, b) function
/maister-copilot:reviews-code src/
```

A bare `/development` is reported as an unknown command.

`MAISTER_PLUGIN_ROOT` need not be set: Copilot hands every skill its base directory and the
scripts find the plugin from their own location. Export it, pointing at the directory holding
`.claude-plugin/plugin.json` (`copilot plugin list` shows where that is), only when a model
keeps guessing the plugin's folder wrong.

## Staying on 2.x

The 2.x maintenance line has a Copilot variant too:

```bash
copilot plugin marketplace add SkillPanel/maister#release/2.x
copilot plugin install maister-copilot@maister-plugins-2x
```

Uninstall any other channel first.

## Where the documentation lives

The Copilot guide, the workflow reference, the command reference and the extension guide ship
with the source repository at `SkillPanel/maister`, under `docs/`.
