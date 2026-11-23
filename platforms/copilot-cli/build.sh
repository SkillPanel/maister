#!/bin/bash
# Builds the GitHub Copilot CLI copy of the plugin from plugins/maister.
#   usage: build.sh [--out DIR] [--baseline FILE] [--require-baseline]
#   --out DIR           where the build goes (default dist/copilot); replaced whole
#   --baseline FILE     the interface file this build replaces, to version against
#   --require-baseline  refuse to build when there is no baseline at all
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE="$ROOT/plugins/maister"

usage() {
  echo "usage: build.sh [--out DIR] [--baseline FILE] [--require-baseline]" >&2
  exit 2
}

OUT_ARG="$ROOT/dist/copilot"
BASELINE=""
REQUIRE_BASELINE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out=?*) OUT_ARG="${1#--out=}" ;;
    --out) [ -n "${2:-}" ] || usage; OUT_ARG="$2"; shift ;;
    --baseline=?*) BASELINE="${1#--baseline=}" ;;
    --baseline) [ -n "${2:-}" ] || usage; BASELINE="$2"; shift ;;
    --require-baseline) REQUIRE_BASELINE=1 ;;
    *) usage ;;
  esac
  shift
done

# Cross-platform sed in-place (macOS needs '' arg, Linux doesn't)
sedi() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# The output folder, resolved against the current directory with its symlinks
# followed, so the guards below compare real paths. A drive-letter path is
# absolute too: Git Bash on Windows is handed C:/... forms.
case "$OUT_ARG" in
  /*|[A-Za-z]:[/\\]*) ;;
  *) OUT_ARG="$PWD/$OUT_ARG" ;;
esac
if [ -d "$OUT_ARG" ]; then
  OUT="$(cd "$OUT_ARG" && pwd -P)"
else
  mkdir -p "$(dirname "$OUT_ARG")"
  OUT="$(cd "$(dirname "$OUT_ARG")" && pwd -P)/$(basename "$OUT_ARG")"
fi
CORE_REAL="$(cd "$CORE" && pwd -P)"

# The build starts by deleting its output folder, and that folder is an
# argument, so it only ever replaces one that looks like a build: never the
# plugin source, a folder inside it or one holding it (the repository, plugins/,
# /), and never an existing folder with something in it but no plugin manifest.
# Both are decided before anything is deleted.
case "${OUT%/}/" in
  "$CORE_REAL/"*)
    echo "build: $OUT is or sits in the plugin source $CORE_REAL; refusing to replace it" >&2
    exit 2 ;;
esac
case "$CORE_REAL/" in
  "${OUT%/}/"*)
    echo "build: $OUT holds the plugin source $CORE_REAL; refusing to replace it" >&2
    exit 2 ;;
esac
if [ -e "$OUT" ] && [ ! -d "$OUT" ]; then
  echo "build: $OUT is a file, not a build folder; refusing to replace it" >&2
  exit 2
fi
if [ -d "$OUT" ] && [ -n "$(ls -A "$OUT")" ] && [ ! -f "$OUT/.claude-plugin/plugin.json" ]; then
  echo "build: $OUT is not empty and holds no .claude-plugin/plugin.json; refusing to replace a folder that is not a build" >&2
  exit 2
fi

# The build's interface file is versioned against the one it replaces (see the
# end of this file): the file --baseline names, else the one in the output
# folder. It is decided, and kept aside, before the tree is rebuilt, so a
# refusal here deletes nothing and a baseline inside the output folder outlives
# that folder's removal. A published build must never fall back to 1.0 without
# a word, so an explicit baseline has to be an interface file, and
# --require-baseline refuses to build without one.
is_interface() {
  node -e 'try { const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).interface_version; process.exit(typeof v === "string" && /^\d+\.\d+$/.test(v) ? 0 : 1); } catch { process.exit(1); }' "$1"
}
PREVIOUS_INTERFACE="$(mktemp)"
trap 'rm -f "$PREVIOUS_INTERFACE"' EXIT
if [ -n "$BASELINE" ]; then
  if ! is_interface "$BASELINE"; then
    echo "build: $BASELINE is not an interface file; refusing to version against it" >&2
    exit 1
  fi
  cp "$BASELINE" "$PREVIOUS_INTERFACE"
elif [ -f "$OUT/interface.json" ] && { [ "$REQUIRE_BASELINE" = 0 ] || is_interface "$OUT/interface.json"; }; then
  cp "$OUT/interface.json" "$PREVIOUS_INTERFACE"
elif [ "$REQUIRE_BASELINE" = 1 ]; then
  echo "build: no interface baseline; refusing to version the interface file from 1.0 (give --baseline FILE)" >&2
  exit 1
fi

# The prefix rewrite (step 4) marks what it has rewritten with a placeholder; a
# source file already holding it would come out with the namespace in its place.
if grep -rl --include='*.md' '@@MAISTER_NS@@' "$CORE" >&2; then
  echo "build: the source files above hold the placeholder @@MAISTER_NS@@, which the prefix rewrite uses" >&2
  exit 1
fi

rm -rf "$OUT"
cp -r "$CORE" "$OUT"
# A Windows checkout hands the markdown over with CRLF line ends: .gitattributes
# forces LF only on the scripts and data files. Several rewrites below are
# anchored at a line's end, and the plan-mode guard would then stop the build,
# so every copied *.md holding a carriage return is rewritten without them. tr,
# not sed: GNU and BSD sed differ on \r.
grep -rl --include='*.md' "$(printf '\r')" "$OUT" | while IFS= read -r f; do
  tr -d '\r' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
# The hooks. Copilot CLI loads a plugin's hooks/hooks.json -- Claude's nested
# matcher format and PascalCase events included -- and runs each command with
# CLAUDE_PLUGIN_ROOT set to the plugin's directory. What only Claude Code can
# run is dropped, and the variant's own hooks.json registers the rest:
#   - display.mjs is a Claude Code hooks module, so it goes, with its state
#     contract, the API declarations and the tsconfig.json Claude Code lays
#     beside a plugin it loads from a folder;
#   - post-compact-reminder.mjs: Copilot starts no session after compaction
#     (a start's source is startup, resume or new) and applies no matcher to a
#     SessionStart hook, so the compact-only reminder would speak at every start;
#   - edition-check.mjs: it looks for two enabled editions in Claude Code's
#     settings, which Copilot does not use.
# The scripts that stay are switched to Copilot's output shape further down.
rm -rf "$OUT/types" "$OUT/.claude-plugin/types" "$OUT/tsconfig.json" \
  "$OUT/hooks/display.mjs" "$OUT/hooks/post-compact-reminder.mjs" "$OUT/hooks/edition-check.mjs"
cp "$ROOT/platforms/copilot-cli/hooks.json" "$OUT/hooks/hooks.json"

# 1. Update plugin.json description and drop the dropped contract
sedi 's/for Claude Code/for GitHub Copilot CLI/' "$OUT/.claude-plugin/plugin.json"
sedi '/"types":/d' "$OUT/.claude-plugin/plugin.json"

# 2. Strip plugin prefix from command names: "maister:foo" → "foo"
#    Plugin system adds the plugin-id prefix automatically
find "$OUT/commands" -name "*.md" | while read f; do
  sedi 's/^name: maister:/name: /' "$f"
done

# 3. Strip plugin prefix from skill names: "maister:foo" → "foo"
find "$OUT/skills" -name "*.md" | while read f; do
  sedi 's/^name: maister:/name: /' "$f"
done

# 4. Rewrite every remaining `maister:` reference into the name Copilot CLI
#    registers for it. Copilot namespaces a plugin's commands, skills and agents
#    under the manifest name, so the namespace is read from the manifest rather
#    than spelled here. The plugin is `maister` on both hosts, so a user types
#    the same command on either, and any other name stops the build. Three
#    forms, in order:
#      /maister:<name>        → /<ns>:<name>   a slash command or skill the user types
#      maister:<agent>        → <ns>:<agent>   the agent type the task tool dispatches
#      maister:<skill>        → <skill>        the bare name the skill tool takes
#    The first two write the placeholder @@MAISTER_NS@@ in place of the
#    namespace, and a fourth pass swaps it for the namespace after the third:
#    written as `maister:` directly, what they wrote would be stripped by the
#    third pass whenever the namespace is itself `maister`. The placeholder is
#    upper case, so the passes that match `maister:` never see it; a source
#    file holding it is refused before the copy, and a build file still
#    holding it after the passes stops the build.
#    Run AFTER the name: transforms so frontmatter names are already clean.
NS=$(sed -n 's/^[[:space:]]*"name":[[:space:]]*"\([^"]*\)".*/\1/p' "$OUT/.claude-plugin/plugin.json" | head -1)
if [ -z "$NS" ]; then
  echo "build: no plugin name in $OUT/.claude-plugin/plugin.json; cannot derive the command namespace" >&2
  exit 1
fi
if [ "$NS" != maister ]; then
  echo "build: the variant manifest is named '$NS', not 'maister'; Copilot would register its commands under another prefix" >&2
  exit 1
fi
AGENTS=$(find "$CORE/agents" -name "*.md" -exec basename {} .md \; | sort | paste -sd'|' -)
find "$OUT" -name "*.md" | while read f; do
  sedi -E \
    -e "s#/maister:#/@@MAISTER_NS@@:#g" \
    -e "s#maister:($AGENTS)([^A-Za-z0-9_-]|\$)#@@MAISTER_NS@@:\\1\\2#g" \
    -e 's#maister:##g' \
    -e "s#@@MAISTER_NS@@#$NS#g" \
    "$f"
done
if grep -rl --include='*.md' '@@MAISTER_NS@@' "$OUT" >&2; then
  echo "build: the placeholder @@MAISTER_NS@@ survives the prefix rewrite in the files above" >&2
  exit 1
fi

# 4b. An agent's skill preload names the skill as Copilot registers it,
#     `<ns>:<skill>`: the bare name step 4 leaves is not found there, and the
#     preload is dropped. Each entry of a frontmatter `skills:` list is
#     rewritten, and one naming no skill of the build stops it.
find "$OUT/agents" -name "*.md" | sort | while read f; do
  awk -v ns="$NS" -v skills="$OUT/skills" -v file="$f" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm==1 && $0=="---" { fm=2; list=0 }
    fm==1 && /^skills:[[:space:]]*$/ { list=1; print; next }
    fm==1 && list && /^[[:space:]]+-[[:space:]]+[A-Za-z0-9_-]+[[:space:]]*$/ {
      name=$2
      if (system("test -f \"" skills "/" name "/SKILL.md\"") != 0) {
        print "build: " file " preloads the skill " name ", which the build does not hold" > "/dev/stderr"; bad=1
      }
      sub(/-[[:space:]]+[A-Za-z0-9_-]+/, "- " ns ":" name)
      print; next
    }
    fm==1 { list=0 }
    { print }
    END { exit bad }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f" || { rm -f "$f.tmp"; exit 1; }
done

# 5. Replace CLAUDE.md references with copilot equivalents in skills.
#    A path that only puts CLAUDE.md in a directory (`.claude/CLAUDE.md`) is
#    turned first into AGENTS.md, which Copilot reads, so the general pass never
#    leaves a directory in front of .github/.
find "$OUT/skills" -name "*.md" | while read f; do
  sedi -e 's#\.claude/CLAUDE\.md#AGENTS.md#g' -e 's/CLAUDE\.md/.github\/copilot-instructions.md/g' "$f"
done

# 5a. Copilot resolves an @-import in .github/copilot-instructions.md against
#     .github/, so the import of the docs index climbs to the project root. Only
#     the docs-manager template and its validation text name it. The pattern
#     needs the @ directly before .maister, so a rewritten @../.maister is left
#     alone. The old form is then added to the wrong-formats line, after the
#     rewrite so it is not rewritten again.
for f in "$OUT/skills/docs-manager/references/claude-md-template.md" "$OUT/skills/docs-manager/SKILL.md"; do
  sedi -e 's#@\.maister/docs/INDEX\.md#@../.maister/docs/INDEX.md#g' "$f"
done
sedi -e 's#^\(.*incorrect formats like .*\)$#\1 or @.maister/docs/INDEX.md (resolved against .github/, it never loads the index)#' "$OUT/skills/docs-manager/SKILL.md"

# 6. Replace AskUserQuestion with copilot's ask_user tool, and Claude Code's
#    web tools with this host's: web_fetch by name, and web search as a plain
#    phrase, since a session may offer no search tool at all.
find "$OUT" -name "*.md" | while read f; do
  sedi -e 's/AskUserQuestion/ask_user/g' -e 's/WebFetch/web_fetch/g' -e 's/WebSearch/web search/g' "$f"
done

# 6a. Plan without a plan-mode tool. quick-plan and quick-bugfix enter Claude
#     Code's plan mode with EnterPlanMode and leave it with ExitPlanMode; Copilot
#     has neither -- its plan mode is one the user starts with /plan or --plan,
#     left through an exit_plan_mode tool offered only inside it. The passages
#     are rewritten into what to do here: draft the plan without editing, ask
#     for approval with the question tool, then implement. A session the user
#     started in plan mode has the host block edits, and exit_plan_mode asks
#     for the approval that leaves it. Any spelling that survives stops the build.
sedi \
  -e 's|^2\. \*\*Enter plan mode\*\* .*$|2. **Plan without editing** — This host has no plan-mode tool for you to enter. Explore the codebase, design the approach and write the plan without creating, editing or deleting any project file and without running a command that changes one. Then present the plan and ask for approval with `ask_user`; implement only after it is approved. If the session is already in Copilot'"'"'s plan mode (the user started it with `/plan` or `--plan`), the host itself blocks edits: present the plan with `exit_plan_mode`, which asks for that approval and leaves plan mode.|' \
  -e 's|Do not call `ExitPlanMode` until the plan|Do not ask for approval until the plan|' \
  "$OUT/skills/quick-plan/SKILL.md"
sedi \
  -e 's|^### Step 4: Enter Planning Mode$|### Step 4: Plan the Fix|' \
  -e 's|^\*\*Use the `EnterPlanMode` tool to present the fix plan for user approval\.\*\*$|**Draft the fix plan without creating, editing or deleting any project file, then present it and ask for approval with `ask_user`; write the test and the fix only after it is approved.** This host has no plan-mode tool for you to enter. If the session is already in Copilot'"'"'s plan mode (the user started it with `/plan` or `--plan`), the host itself blocks edits: present the plan with `exit_plan_mode`, which asks for that approval and leaves plan mode.|' \
  -e 's|^\*\*Plan file content:\*\*$|**Plan content:**|' \
  -e 's|^### ExitPlanMode Gate: Mandatory Sections$|### Approval Gate: Mandatory Sections|' \
  -e 's|Do NOT call `ExitPlanMode` until the plan file contains|Do NOT ask for approval until the plan contains|' \
  -e 's|add it before calling ExitPlanMode\.|add it before asking for approval.|' \
  "$OUT/skills/quick-bugfix/SKILL.md"
if grep -rlE 'EnterPlanMode|ExitPlanMode' "$OUT" >&2; then
  echo "build: a Claude Code plan-mode tool survives in the files above; Copilot has none" >&2
  exit 1
fi

# 6b. Name the agent type Copilot knows. Its built-in read-only search agent is
#     `explore`, lowercase, and its task tool takes the type as agent_type; a
#     dispatch of `Explore` is refused as an unknown agent type. Only a
#     dispatch's type is rewritten -- the word in prose stays.
find "$OUT" -name "*.md" | while read f; do
  sedi -E "s/subagent_type([=:][[:space:]]*[\"'\`]?)Explore([^A-Za-z]|\$)/agent_type\1explore\2/g" "$f"
done

# 6b2. Name every dispatch's fields as Copilot's task tool takes them. It calls
#      the agent type agent_type, and refuses a call that carries no `name` (a
#      short id the caller picks), where Claude Code's tool has no such field.
#      So `subagent_type` becomes `agent_type` everywhere, and each call block --
#      a `subagent_type: "<agent>"` line of its own -- gets a `name` line after
#      it, named for the agent. Prose dispatches are covered by TASK_RULE (8c).
find "$OUT" -name "*.md" | while read f; do
  sedi -E \
    -e 's/^([[:space:]]*)subagent_type: "([A-Za-z0-9_:-]*:)?([A-Za-z0-9_-]+)"[[:space:]]*$/\1agent_type: "\2\3"\
\1name: "\3"/' \
    -e 's/subagent_type/agent_type/g' \
    "$f"
done

# 6c. Give install commands in Copilot's form. Claude Code installs from a
#     slash command and names the plugin `maister`; Copilot installs from its
#     shell command under the manifest name. The 2.x line is the exception: its
#     Copilot build ships as `maister-copilot`, so a 2.x install line names
#     that build, ahead of the general rewrite that would name 2.x Claude Code's.
find "$OUT" -name "*.md" | while read f; do
  sedi -E \
    -e 's#/plugin marketplace add #copilot plugin marketplace add #g' \
    -e 's#/plugin (install|uninstall) maister@maister-plugins-2x#copilot plugin \1 maister-copilot@maister-plugins-2x#g' \
    -e "s#/plugin (install|uninstall) maister@#copilot plugin \\1 $NS@#g" \
    "$f"
done

# 6d. The hook scripts: Copilot's output shape and this variant's names. Each
#     script names its shape on one line, `const HOOK_SHAPE = 'claude';`;
#     Copilot reads a SessionStart's context and a PreToolUse's decision only
#     at the top level of the output and drops Claude's hookSpecificOutput
#     wrapper. The hooks are Node, run by Node alone, so neither bash nor jq is
#     needed to run them on either host. The reminder
#     text gets the same renames as the skills, the skill and task tools' own names and
#     Copilot's autonomy settings in place of Claude Code's permission modes.
for f in "$OUT"/hooks/*.mjs; do
  sedi -E \
    -e "s/^const HOOK_SHAPE = 'claude';\$/const HOOK_SHAPE = 'copilot';/" \
    -e "s#/maister:#/$NS:#g" \
    -e 's/AskUserQuestion/ask_user/g' \
    -e 's/the Skill tool/the skill tool/g' \
    -e 's/the Task tool/the task tool/g' \
    -e 's#regardless of permission mode \(auto / acceptEdits / bypassPermissions\)#regardless of mode or permissions (autopilot / allow-all)#g' \
    "$f"
  if ! grep -q "^const HOOK_SHAPE = 'copilot';\$" "$f"; then
    echo "build: $f names no HOOK_SHAPE line; Copilot would drop its output" >&2
    exit 1
  fi
done

# 6d2. The host marker. The plugin is named `maister` on both hosts, so the
#      engine learns which host a copy ships for from one line of lib/host.mjs,
#      `export const SHIPPED_HOST = 'claude';`, switched here the way the hooks'
#      HOOK_SHAPE line is; a marker the switch cannot find stops the build.
if [ -f "$OUT/lib/host.mjs" ]; then
  sedi -e "s/^export const SHIPPED_HOST = 'claude';\$/export const SHIPPED_HOST = 'copilot';/" "$OUT/lib/host.mjs"
fi
if ! grep -q "^export const SHIPPED_HOST = 'copilot';\$" "$OUT/lib/host.mjs" 2>/dev/null; then
  echo "build: $OUT/lib/host.mjs names no SHIPPED_HOST line; the engine would take this build for Claude Code's" >&2
  exit 1
fi

# 6e. Ask the engine for this host's models. Every agent call carries the model
#     and effort the `dispatch-model` verb resolves, and the verb answers per
#     host: Claude Code takes a model alias, Copilot a model id (an alias it
#     accepts without a word and runs another model in its place). Copilot's
#     task tool also names the effort field `reasoning_effort`, so where prose
#     names the two fields together the second takes that name.
find "$OUT" -name "*.md" | while read f; do
  sedi -e 's/--host=claude/--host=copilot/g' -e 's/`model` and `effort`/`model` and `reasoning_effort`/g' "$f"
done

# 7. Rename the plugin-root variable in every exec form.
#    CLAUDE_PLUGIN_ROOT is absent from the shell this CLI gives an agent -- it
#    sets the variable only for the hooks it runs -- so a skill telling an agent
#    to run `node ${CLAUDE_PLUGIN_ROOT}/...` here names an empty variable. The
#    variant names its own variable instead; with it unset the agent builds the
#    path from the skill's base directory, which the CLI hands every skill, and
#    the variant's README.md says when exporting it helps. Skills, their
#    references and the commands, which run the engine's verbs too, only: hooks.json keeps CLAUDE_PLUGIN_ROOT, which the hooks do
#    get, and no .mjs is rewritten for it -- the runtime code reads the variable at
#    call time and already falls back to its own module location.
find "$OUT/skills" "$OUT/commands" -name "*.md" | while read f; do
  sedi 's/CLAUDE_PLUGIN_ROOT/MAISTER_PLUGIN_ROOT/g' "$f"
done

# 8. Give every agent a tool allowlist without the agent tool.
#    Copilot runs every subagent level under a session of its own, which a
#    binding to the driver's session does not cover, so on this host no agent
#    dispatches a subagent: the freeze records every Copilot run's delegation
#    as inline, the runners keep their loops in the main session, and every
#    agent the main session dispatches is a leaf. A Copilot agent gets every
#    tool unless its frontmatter narrows them, so each agent gets:
#    - A tool allowlist without the agent tool, so nothing below the main
#      session can dispatch. A runner dispatched anyway finds no agent tool and
#      returns unavailable, and its node runs the loop in the session. The list
#      names both the CLI's aliases and its own tool
#      names (before 1.0.100 the aliases resolved no search, fetch or todo
#      tool, and a model family that edits by patch gets apply_patch only by
#      name); names a model family or a session does not have are ignored. The
#      `web` alias is the documented route to web search, but a session with no
#      search tool of its own -- the main agent's included -- gives none to its
#      agents, by alias or by name. The research agents also name the GitHub
#      server's web_search, so they use it in a session that offers it; where
#      it is absent the name is ignored. The plugin ships no browser server, so
#      the agents that drive a browser are granted none: they reach
#      `playwright-cli` through `execute`.
#    Keeping an agent from re-entering an entry point -- a review agent invoking
#    its own reviews-* command, or an implementer loading an orchestrator
#    skill -- is the containment sentence every source agent carries, which
#    make validate checks.
#    The agent also gets DIR_RULE: Copilot's create tool refuses a path whose
#    directory is missing, where Claude Code's Write makes it. Step 8c gives
#    every skill the same rule.
#    Source agents declare no tools: of their own; one that did would be
#    silently overridden here, so the build refuses it instead.
DIR_RULE='**Create a file'"'"'s directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a subfolder of a run, or `.maister/docs/` or `.github/` on a fresh project — run `mkdir -p` on that folder first. A run'"'"'s own folder is never one: the freeze creates it.'
find "$OUT/agents" -name "*.md" | sort | while read f; do
  if awk 'NR==1 && $0=="---"{fm=1; next} fm && $0=="---"{exit} fm && /^tools:/{found=1} END{exit !found}' "$f"; then
    echo "build: $f already declares tools:; the Copilot allowlist would override it" >&2
    exit 1
  fi
  tools='"execute", "read", "edit", "search", "web", "todo", "grep", "glob", "rg", "apply_patch", "web_fetch", "update_todo"'
  case "$(basename "$f" .md)" in
    information-gatherer|research-planner) tools="$tools, \"github-mcp-server/web_search\"" ;;
  esac
  awk -v tools="tools: [$tools]" -v dirrule="$DIR_RULE" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm==1 && /^name:/ { print; print tools; next }
    fm==1 && $0=="---" {
      fm=2; print; print ""
      print dirrule
      next
    }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# 8b. Run each agent on a model Copilot knows. Source agents name no model,
#     so an agent runs on the session's unless its call carries one (6e), except
#     the lightweight ones, which name Claude Code's `haiku` as the host-level
#     fallback. `haiku` becomes a list of lightweight models in
#     `model`, which the runtime tries in order. (Copilot 1.0.100 did not apply
#     the same list given as `models` to a plugin agent: it ran on the
#     session's model.) Any other alias stops the build
#     rather than shipping an agent on a model nobody chose.
LIGHT_MODELS='[claude-haiku-5.5, claude-haiku-4.5, gpt-6-luna]'
find "$OUT/agents" -name "*.md" | sort | while read f; do
  awk -v light="$LIGHT_MODELS" -v file="$f" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm==1 && $0=="---" { fm=2 }
    fm==1 && /^model:[[:space:]]*haiku[[:space:]]*$/ { print "model: " light; next }
    fm==1 && /^model:[[:space:]]*(inherit|sonnet|opus|fable|fast|default)[[:space:]]*$/ {
      print "build: " file " names the Claude Code model alias " $2 ", which Copilot does not know" > "/dev/stderr"; bad=1
    }
    { print }
    END { exit bad }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f" || { rm -f "$f.tmp"; exit 1; }
done

# 8c. Every skill gets DIR_RULE too, after its frontmatter: the main session
#     writes task directories, docs and state files with the same create tool
#     the agents use. Every skill, and every command that dispatches an agent,
#     also gets TASK_RULE: the main session is the one that dispatches here,
#     the task tool refuses a call without `name`, and it names the effort
#     field `reasoning_effort`, so the rule spells out the call's fields where
#     a passage names only the agent.
TASK_RULE='**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.'
find "$OUT/skills" -name "SKILL.md" | sort | while read f; do
  awk -v dirrule="$DIR_RULE" -v taskrule="$TASK_RULE" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm==1 && $0=="---" { fm=2; print; print ""; print dirrule; print ""; print taskrule; next }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
grep -lE 'agent_type|Task tool' "$OUT"/commands/*.md | sort | while read f; do
  awk -v taskrule="$TASK_RULE" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm==1 && $0=="---" { fm=2; print; print ""; print taskrule; next }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# 9. Render the question picker for a tool without option previews.
#    The source is written for the rich picker: option previews, and an ask
#    whose fields the tool takes by name. Copilot's ask_user takes a message and
#    a form instead — a page is a form of several properties, shown as tabs, and
#    a multi-select an array property — and shows no previews, so the gate brief
#    is asked for in its plain profile and the source's two kinds of marked
#    passage are resolved — a rich-only passage is dropped, a plain-only one is
#    uncommented:
#      <!-- rich-picker -->            <!-- plain-picker
#      … Claude Code only …            … tools without previews …
#      <!-- /rich-picker -->           -->
#    Each marker sits on a line of its own. A second target — another CLI with a
#    plain picker — calls the same function.
render_plain_picker() {
  awk '
    /^[[:space:]]*<!-- rich-picker -->[[:space:]]*$/  { rich = 1; next }
    /^[[:space:]]*<!-- \/rich-picker -->[[:space:]]*$/ { rich = 0; next }
    rich { next }
    /^[[:space:]]*<!-- plain-picker[[:space:]]*$/ { plain = 1; next }
    plain && /^[[:space:]]*-->[[:space:]]*$/ { plain = 0; next }
    { print }
  ' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
  sedi 's/--picker=rich/--picker=plain/g' "$1"
}
find "$OUT/skills" -name "*.md" | while read f; do
  render_plain_picker "$f"
done

# The variant's own install surface, staged after every substitution rather than
# before. Copilot CLI chooses where a marketplace install lands, so the one
# thing an operator cannot work out for themselves -- the directory to point the
# plugin-root variable at -- has to be written down in the tree they installed.
# It is copied last because it is written for Copilot already, and no
# substitution applies to it.
cp "$ROOT/platforms/copilot-cli/README.md" "$OUT/README.md"

# The shared write primitives and the state reader are plugin-root libraries,
# not a skill's scripts: the engine's state writer and the other skills'
# scripts import them from ../../../../lib/. `cp -r` above carries the directory across
# and no sed pass touches .mjs, so these are assertions rather than copies — if
# a future transform ever prunes or rewrites the tree, the build fails here
# rather than shipping a variant whose engine cannot resolve its own import.
if [ ! -f "$OUT/lib/canonical.mjs" ]; then
  echo "build: $OUT/lib/canonical.mjs is missing; the emitted engine cannot resolve its write primitives" >&2
  exit 1
fi
if [ ! -f "$OUT/lib/state-scan.mjs" ]; then
  echo "build: $OUT/lib/state-scan.mjs is missing; the emitted engine cannot resolve its state reader" >&2
  exit 1
fi

# The interface file describes the tree it sits in: the engine is the same
# bytes, but the hooks this host registers and the tool names it calls are its
# own, so the copy carried over from the source is regenerated from this tree.
# It is removed first, so a generator that writes nothing fails the build below
# instead of leaving the source's copy in place.
rm -f "$OUT/interface.json"
node "$ROOT/tools/interface.mjs" --root "$OUT" --baseline "$PREVIOUS_INTERFACE" >/dev/null
if [ ! -f "$OUT/interface.json" ]; then
  echo "build: $OUT/interface.json was not written; the interface generator did not run" >&2
  exit 1
fi

echo "Built Copilot CLI variant at $OUT"
