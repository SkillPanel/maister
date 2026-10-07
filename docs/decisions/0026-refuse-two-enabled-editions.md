# ADR-0026 — Two enabled editions are detected, warned about and refused

**Status**: Accepted · **Date**: 2026-09-29 · **Sources**: `plugins/maister/lib/editions.mjs`; `plugins/maister/hooks/edition-check.mjs`, `hooks/hooks.json`; `plugins/maister/skills/workflow-engine/scripts/workflow.mjs` (`runWriteState`, `readSources`); `plugins/maister/skills/workflow-engine/SKILL.md` § "When a write is refused"; `tests/engine/editions.test.mjs`; ADR-0007, ADR-0012

## TL;DR
The free and pro editions share the plugin name `maister`. When both are enabled, Claude Code
resolves skills **per skill directory**, not per plugin, so one session can draw skill bodies from
both editions, and a workflow then fails on a file only the other edition ships, with
nothing but `ENOENT` to say why. The plugin now detects the case from the settings scopes and acts
on it in two places:
- a **SessionStart hook** warns the operator (`systemMessage`) and the model (`additionalContext`);
- **`write-state`**, the verb that freezes a run and carries every write after it, **refuses** with
  `edition-collision`, so neither a start nor a resume lands.

A definition that can't be read while the collision holds reports it next to the missing file.
Detection reads files only and **fails open**.

## ADR-0026: Two enabled editions are detected, warned about and refused {#adr-0026}

### Status
Accepted. It adds one refusal code, raised by the engine's entry point before the writer runs, so
ADR-0012's closed writer vocabulary is unchanged. It adds the plugin's first Node session-start
hook, in the exec form ADR-0007 settled.

### Context
Hook registration de-duplicates same-name plugins down to one edition's hooks, and skill
resolution mixes the two editions. So the check has to run whichever edition's copy wins. A
SessionStart hook can't block a session, and a driven session never reads a warning, so a warning
alone isn't enough. The engine has to refuse as well. Resolving the collision, or refusing same-name
plugins outright, belongs to Claude Code's loader, not to a plugin.

### Considered Options
1. **Merge the settings scopes by reading files** ← chosen
2. `claude plugin list --json` in a subprocess
3. Both, with the subprocess as a fallback

### Decision Outcome
Chosen option: **the settings-scope merge**.

`enabledPlugins` is read from these files, in rising precedence, with each later scope winning key
by key, so a `false` above overrides a `true` below:
1. user (`$CLAUDE_CONFIG_DIR` or `~/.claude`)
2. project `.claude/settings.json`
3. local `.claude/settings.local.json`
4. managed (`managed-settings.json`, then `managed-settings.d/*.json` in name order)

The format is documented and the reads cost milliseconds, which matters on every `write-state` and
inside a 10-second hook. The subprocess would add a CLI spawn to every write, a dependency on
`claude` being on PATH, and a call the docs don't describe as safe inside a hook. It would see no
layer the files miss, and a fallback would only double the surface.

**When it's a collision.** Three conditions must all hold:
- the plugin's own manifest name is `maister`;
- at least two distinct `maister@<marketplace>` ids are effectively enabled, excluding `@inline`;
- the copy running the check is one of them.

The running copy's marketplace comes from its own path:
- a cached copy (`…/plugins/cache/<marketplace>/<name>/<version>`) names it in the path;
- a directory-source marketplace loads in place, so the check takes the name from the
  `marketplace.json` above the plugin root that lists this plugin with a source resolving to this
  exact directory.

Anything else is an inline (`--plugin-dir`) or unfamiliar copy. Such a copy skips every installed
plugin of the same name, so it's never a collision. For the same reason, a `--plugin-dir` copy
beside installed editions disabled in `settings.local.json` isn't a collision.

**Fails open.** An absent settings file counts as empty. An unreadable or malformed one, or any
other error, answers "no collision": nothing is warned and nothing is refused.

**Copilot variant.** The check is a no-op there. Its manifest name is `maister-copilot`, and the
build drops `hooks/`, so the SessionStart hook is never emitted.

### Consequences
- A run can't start or continue under a mixed plugin. The refusal names every enabled edition with
  its scope and the `claude plugin disable <id> --scope <scope>` that fixes it. The fix takes effect
  after a restart.
- Free-edition sessions now run one Node hook at session start. The engine already requires Node
  20 (ADR-0025). Without Node the hook exits non-zero, which Claude Code reports as a non-blocking
  error.
- **Blind spot: `--settings`.** A disable passed only through `--settings` lives in the session and
  isn't visible to any file reader. Such a session is reported as a collision.
- **Blind spot: an inline copy loaded from a marketplace's own plugin directory.** Take a
  `--plugin-dir` session loaded from a directory-source marketplace's own plugin directory, while
  that marketplace and another edition are both still enabled. By path it can't be told apart from
  that marketplace's installed copy, so it's reported as a collision even though the inline copy
  wins. Disabling either edition clears it.
- The check keys on the plugin name the editions share. A third edition under the same name is
  covered without a change.
