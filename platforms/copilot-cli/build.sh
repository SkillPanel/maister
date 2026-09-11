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

rm -rf "$OUT"
cp -r "$CORE" "$OUT"
# Copilot resolves hooks from the consumer repository, not from --plugin-dir:
# drop the Claude-shaped hooks directory and emit the Copilot registration plus
# the scripts it names into .github/hooks/. No sed pass touches .mjs or .json.
rm -rf "$OUT/hooks"
mkdir -p "$OUT/.github/hooks"
cp "$CORE/hooks/"{gate-lib,gate-enforce,gate-stop-nudge,gate-beacon}.mjs "$OUT/.github/hooks/"
cp "$ROOT/platforms/copilot-cli/hooks/maister-gates.json" "$OUT/.github/hooks/"
cp "$ROOT/platforms/copilot-cli/hooks/README.md" "$OUT/.github/hooks/"
# The shared state reader is a library, not a hook registration: the engine's
# state writer imports it as its self-check oracle. Keep it at the path the
# shipped source imports, so no .mjs has to be rewritten to resolve.
mkdir -p "$OUT/hooks"
cp "$CORE/hooks/gate-lib.mjs" "$OUT/hooks/"

# 1. Update plugin.json name and description
sedi 's/"name": "maister"/"name": "maister-copilot"/' "$OUT/.claude-plugin/plugin.json"
sedi 's/for Claude Code/for GitHub Copilot CLI/' "$OUT/.claude-plugin/plugin.json"

# 2. Strip plugin prefix from command names: "maister:foo" → "foo"
#    Plugin system adds the plugin-id prefix automatically
find "$OUT/commands" -name "*.md" | while read f; do
  sedi 's/^name: maister:/name: /' "$f"
done

# 3. Strip plugin prefix from skill names: "maister:foo" → "foo"
find "$OUT/skills" -name "*.md" | while read f; do
  sedi 's/^name: maister:/name: /' "$f"
done

# 4. Replace maister: prefix with maister- for subagent/skill refs
# Run AFTER command name transform so name: lines are already clean
find "$OUT" -name "*.md" | while read f; do
  sedi 's/maister:/maister-/g' "$f"
done

# 5. Transform multi-select patterns to sequential
find "$OUT/skills" -name "*.md" | while read f; do
  sedi \
    -e 's/multi-select question/sequential single-select questions (one per option)/g' \
    -e 's/multi-select/sequential single-select/g' \
    -e 's/multiselect/sequential single-select/g' \
    -e 's/multiSelect/sequential single-select/g' \
    "$f"
done

# 6. Replace CLAUDE.md references with copilot equivalents in skills
find "$OUT/skills" -name "*.md" | while read f; do
  sedi 's/CLAUDE\.md/.github\/copilot-instructions.md/g' "$f"
done

# 7. Replace AskUserQuestion with copilot's ask_user tool
find "$OUT" -name "*.md" | while read f; do
  sedi 's/AskUserQuestion/ask_user/g' "$f"
done

# 8. Rename the plugin-root variable in every exec form.
#    CLAUDE_PLUGIN_ROOT is a Claude Code variable and is absent from this CLI's
#    environment, which exposes only its own four — so a skill telling an agent
#    to run `node ${CLAUDE_PLUGIN_ROOT}/...` here is stating something false and
#    leaves the agent to work the directory out and substitute a path. The
#    variant names its own variable instead, and .github/hooks/README.md says
#    how to export it. Skills and their references only: hooks.json is a Claude
#    surface this variant does not inherit, and no .mjs is rewritten — the
#    runtime code reads the variable at call time and already falls back to its
#    own module location.
find "$OUT/skills" -name "*.md" | while read f; do
  sedi 's/CLAUDE_PLUGIN_ROOT/MAISTER_PLUGIN_ROOT/g' "$f"
done

# The shared write primitives are a plugin-root library, not a skill's script:
# the engine's state writer and the umbrella writer both import them from
# ../../../../lib/canonical.mjs. `cp -r` above carries the directory across and
# no sed pass touches .mjs, so this is an assertion rather than a copy — if a
# future transform ever prunes or rewrites the tree, the build fails here rather
# than shipping a variant whose engine cannot resolve its own import.
if [ ! -f "$OUT/lib/canonical.mjs" ]; then
  echo "build: $OUT/lib/canonical.mjs is missing; the emitted engine cannot resolve its write primitives" >&2
  exit 1
fi

echo "Built Copilot CLI variant at $OUT"
