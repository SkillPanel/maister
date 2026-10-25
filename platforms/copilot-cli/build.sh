#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE="$ROOT/plugins/maister"
OUT="$ROOT/plugins/maister-copilot"

# Cross-platform sed in-place (macOS needs '' arg, Linux doesn't)
sedi() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# The variant's interface file is versioned against the one it replaces, so
# that one is kept aside before the tree is rebuilt (see the end of this file).
PREVIOUS_INTERFACE="$(mktemp)"
trap 'rm -f "$PREVIOUS_INTERFACE"' EXIT
if [ -f "$OUT/interface.json" ]; then cp "$OUT/interface.json" "$PREVIOUS_INTERFACE"; fi

rm -rf "$OUT"
cp -r "$CORE" "$OUT"
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
#   - edition-check.mjs: the collision it looks for is between editions that
#     share the plugin name, which this renamed variant never carries.
# The two scripts that stay are switched to Copilot's output shape further down.
rm -rf "$OUT/types" "$OUT/.claude-plugin/types" "$OUT/tsconfig.json" \
  "$OUT/hooks/display.mjs" "$OUT/hooks/post-compact-reminder.mjs" "$OUT/hooks/edition-check.mjs"
cp "$ROOT/platforms/copilot-cli/hooks.json" "$OUT/hooks/hooks.json"

# 1. Update plugin.json name and description, and drop the dropped contract
sedi 's/"name": "maister"/"name": "maister-copilot"/' "$OUT/.claude-plugin/plugin.json"
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
#    under the manifest name, so the namespace is read from the manifest step 1
#    just wrote rather than spelled here. Three forms, three passes, in order —
#    each pass consumes its own matches, so the next one never sees them:
#      /maister:<name>        → /<ns>:<name>   a slash command or skill the user types
#      maister:<agent>        → <ns>:<agent>   the agent type the task tool dispatches
#      maister:<skill>        → <skill>        the bare name the skill tool takes
#    Run AFTER the name: transforms so frontmatter names are already clean.
NS=$(sed -n 's/^[[:space:]]*"name":[[:space:]]*"\([^"]*\)".*/\1/p' "$OUT/.claude-plugin/plugin.json" | head -1)
if [ -z "$NS" ]; then
  echo "build: no plugin name in $OUT/.claude-plugin/plugin.json; cannot derive the command namespace" >&2
  exit 1
fi
AGENTS=$(find "$CORE/agents" -name "*.md" -exec basename {} .md \; | sort | paste -sd'|' -)
find "$OUT" -name "*.md" | while read f; do
  sedi -E \
    -e "s#/maister:#/$NS:#g" \
    -e "s#maister:($AGENTS)([^A-Za-z0-9_-]|\$)#$NS:\\1\\2#g" \
    -e 's#maister:##g' \
    "$f"
done

# 5. Replace CLAUDE.md references with copilot equivalents in skills.
#    A path that only puts CLAUDE.md in a directory (`.claude/CLAUDE.md`) is
#    turned first into AGENTS.md, which Copilot reads, so the general pass never
#    leaves a directory in front of .github/.
find "$OUT/skills" -name "*.md" | while read f; do
  sedi -e 's#\.claude/CLAUDE\.md#AGENTS.md#g' -e 's/CLAUDE\.md/.github\/copilot-instructions.md/g' "$f"
done

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

# 6c. Give install commands in Copilot's form. Claude Code installs from a
#     slash command and names the plugin `maister`; Copilot installs from its
#     shell command under the manifest name.
find "$OUT" -name "*.md" | while read f; do
  sedi -E \
    -e 's#/plugin marketplace add #copilot plugin marketplace add #g' \
    -e "s#/plugin (install|uninstall) maister@#copilot plugin \\1 $NS@#g" \
    "$f"
done

# 6d. The hook scripts: Copilot's output shape and this variant's names. Each
#     script names its shape on one line, `const HOOK_SHAPE = 'claude';`;
#     Copilot reads a SessionStart's context and a PreToolUse's decision only
#     at the top level of the output and drops Claude's hookSpecificOutput
#     wrapper. The hooks are Node, run by Node alone, so neither bash nor jq is
#     needed to run them on either host. The reminder
#     text gets the same renames as the skills, the skill tool's own name and
#     Copilot's autonomy settings in place of Claude Code's permission modes.
for f in "$OUT"/hooks/*.mjs; do
  sedi -E \
    -e "s/^const HOOK_SHAPE = 'claude';\$/const HOOK_SHAPE = 'copilot';/" \
    -e "s#/maister:#/$NS:#g" \
    -e 's/AskUserQuestion/ask_user/g' \
    -e 's/the Skill tool/the skill tool/g' \
    -e 's#regardless of permission mode \(auto / acceptEdits / bypassPermissions\)#regardless of mode or permissions (autopilot / allow-all)#g' \
    "$f"
  if ! grep -q "^const HOOK_SHAPE = 'copilot';\$" "$f"; then
    echo "build: $f names no HOOK_SHAPE line; Copilot would drop its output" >&2
    exit 1
  fi
done

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
DIR_RULE='**Create a file'"'"'s directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` on a fresh project — run `mkdir -p` on that folder first.'
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
#     the agents use.
find "$OUT/skills" -name "SKILL.md" | sort | while read f; do
  awk -v dirrule="$DIR_RULE" '
    NR==1 && $0=="---" { fm=1; print; next }
    fm==1 && $0=="---" { fm=2; print; print ""; print dirrule; next }
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
# It is copied last because the prefix pass rewrites `maister:` wherever it
# appears, and this file's install commands legitimately contain it: run earlier,
# that pass turned `copilot plugin install SkillPanel/maister:plugins/...` into a
# command that does not exist.
cp "$ROOT/platforms/copilot-cli/README.md" "$OUT/README.md"

# The shared write primitives and the state reader are plugin-root libraries,
# not a skill's scripts: the engine's state writer and the umbrella writer
# import them from ../../../../lib/. `cp -r` above carries the directory across
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
