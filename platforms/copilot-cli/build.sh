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
rm -rf "$OUT/hooks"

# 1. Update plugin.json name
sedi 's/"name": "maister"/"name": "maister-copilot"/' "$OUT/.claude-plugin/plugin.json"

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

# 7. Add platform note to plugin's CLAUDE.md
cat >> "$OUT/CLAUDE.md" << 'EOF'

## Platform: Copilot CLI

This is the Copilot CLI variant. Key differences from Claude Code:
- **No multi-select**: When asking users to select multiple options, ask sequential single-select questions instead
- **Command names**: No plugin prefix in names (e.g., `development-new`); the plugin system adds the plugin-id prefix automatically
- **Project instructions file**: Use `.github/copilot-instructions.md` instead of `CLAUDE.md`. If the project uses `AGENTS.md`, support that as well.
EOF

echo "Built Copilot CLI variant at $OUT"
