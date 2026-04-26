#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE="$ROOT/plugins/maister"
OUT="$SCRIPT_DIR/output"

# Cross-platform sed in-place (macOS needs '' arg, Linux doesn't)
sedi() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

echo "=== Maister → OpenCode Build ==="
echo "Source: $CORE"
echo "Output: $OUT"
echo ""

# ─────────────────────────────────────────────────────────────
# Phase 1: Copy source
# ─────────────────────────────────────────────────────────────
echo "[Phase 1] Copying source..."
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$CORE/." "$OUT/"

# ─────────────────────────────────────────────────────────────
# Phase 2: Strip Claude Code artifacts
# ─────────────────────────────────────────────────────────────
echo "[Phase 2] Stripping Claude Code artifacts..."
rm -rf "$OUT/.claude-plugin"
rm -rf "$OUT/hooks"
rm -rf "$OUT/skills"
rm -f  "$OUT/.mcp.json"
rm -rf "$OUT/agents"
mkdir -p "$OUT/agents"

# ─────────────────────────────────────────────────────────────
# Phase 3: Transform commands
# ─────────────────────────────────────────────────────────────
echo "[Phase 3] Transforming commands..."

# Mapping: command filename (no extension) → agent name
get_agent_for_command() {
  local cmd="$1"
  case "$cmd" in
    work)                       echo "maister-development" ;;
    development)                echo "maister-development" ;;
    research)                   echo "maister-research" ;;
    performance)                echo "maister-performance" ;;
    migration)                  echo "maister-migration" ;;
    product-design)             echo "maister-product-design" ;;
    quick-plan)                 echo "maister-planner" ;;
    quick-dev)                  echo "maister-developer" ;;
    quick-bugfix)               echo "maister-bugfix" ;;
    reviews-code)               echo "maister-code-reviewer" ;;
    reviews-pragmatic)          echo "maister-code-quality-pragmatist" ;;
    reviews-spec-audit)         echo "maister-spec-auditor" ;;
    reviews-reality-check)      echo "maister-reality-assessor" ;;
    reviews-production-readiness) echo "maister-production-readiness-checker" ;;
    *)                          echo "maister-development" ;;
  esac
}

find "$OUT/commands" -name "*.md" | while read -r f; do
  cmd_name="$(basename "$f" .md)"
  agent_name="$(get_agent_for_command "$cmd_name")"

  # Strip "name:" line from frontmatter
  sedi '/^name: /d' "$f"

  # Add agent: and subtask: true into frontmatter (after the opening ---)
  # Only if frontmatter exists (file starts with ---)
  if head -1 "$f" | grep -q '^---$'; then
    sedi "0,/^---\$/{/^---\$/!b; a\\
agent: $agent_name\\
subtask: true
}" "$f"
  fi

  # Replace Skill(name="X") invocations with OpenCode instruction references
  # Pattern: Skill(name="maister:foo") → Follow the workflow in @.opencode/instructions/maister-foo.md
  sedi 's|Skill(name="maister:\([^"]*\)")|Follow the workflow in @.opencode/instructions/maister-\1.md|g' "$f"
  sedi "s|Skill(name='maister:\([^']*\)')|Follow the workflow in @.opencode/instructions/maister-\1.md|g" "$f"

  # Strip maister: prefix from command references in body
  sedi 's|/maister:\([a-z-]*\)|/\1|g' "$f"
done

# ─────────────────────────────────────────────────────────────
# Phase 4: Transform agents → build agent-fragment.json
# ─────────────────────────────────────────────────────────────
echo "[Phase 4] Transforming agents and building agent-fragment.json..."

mkdir -p "$OUT/agents"

# We'll accumulate agent JSON entries in a temp file, build with Python at end
AGENT_ENTRIES_FILE="$(mktemp)"
echo "{}" > "$AGENT_ENTRIES_FILE"

color_to_hex() {
  case "$1" in
    purple) echo "#9B59B6" ;;
    blue)   echo "#3498DB" ;;
    green)  echo "#2ECC71" ;;
    red)    echo "#E74C3C" ;;
    orange) echo "#E67E22" ;;
    yellow) echo "#F1C40F" ;;
    cyan)   echo "#1ABC9C" ;;
    pink)   echo "#E91E63" ;;
    gray)   echo "#95A5A6" ;;
    *)      echo "#95A5A6" ;;
  esac
}

# Process each agent file
for src_agent in "$CORE/agents/"*.md; do
  filename="$(basename "$src_agent")"
  agent_slug="${filename%.md}"
  agent_id="maister-${agent_slug}"
  dest="$OUT/agents/maister-${filename}"

  # Parse YAML frontmatter fields
  name_val="$(awk '/^---/{f++; next} f==1{print}' "$src_agent" | grep '^name:' | sed 's/^name:[[:space:]]*//')"
  desc_val="$(awk '/^---/{f++; next} f==1{print}' "$src_agent" | grep '^description:' | sed 's/^description:[[:space:]]*//')"
  model_val="$(awk '/^---/{f++; next} f==1{print}' "$src_agent" | grep '^model:' | sed 's/^model:[[:space:]]*//')"
  color_val="$(awk '/^---/{f++; next} f==1{print}' "$src_agent" | grep '^color:' | sed 's/^color:[[:space:]]*//')"

  hex_color="$(color_to_hex "$color_val")"

  # Strip frontmatter: write body only (after second ---) to dest
  awk 'BEGIN{f=0} /^---/{f++; if(f==2){found=1; next}} found{print}' "$src_agent" > "$dest"

  # Build JSON entry with Python to handle special chars
  python3 -c "
import json, sys

agent_id = sys.argv[1]
desc = sys.argv[2]
color = sys.argv[3]
model = sys.argv[4]
slug = sys.argv[5]

entry = {
    'description': desc,
    'mode': 'subagent',
    'prompt': '{file:.opencode/agents/maister-' + slug + '.md}',
    'color': color
}

# Only add model if not 'inherit' and not empty
if model and model != 'inherit':
    entry['model'] = model

# Read existing JSON, add entry, write back
with open(sys.argv[6], 'r') as fh:
    data = json.load(fh)
data[agent_id] = entry
with open(sys.argv[6], 'w') as fh:
    json.dump(data, fh, indent=2)
" "$agent_id" "$desc_val" "$hex_color" "$model_val" "$agent_slug" "$AGENT_ENTRIES_FILE"
done

# ─────────────────────────────────────────────────────────────
# Phase 5: Global text replacements across all output files
# ─────────────────────────────────────────────────────────────
echo "[Phase 5] Running global text replacements..."

run_global_replacements() {
  local f="$1"
  sedi 's/`AskUserQuestion`/ask the user conversationally/g' "$f"
  sedi 's/AskUserQuestion(\([^)]*\))/ask the user conversationally about \1/g' "$f"
  sedi 's/AskUserQuestion/ask the user conversationally/g' "$f"
  sedi 's/`TaskCreate`/Create a todo item/g' "$f"
  sedi 's/`TaskUpdate`/Update the todo item/g' "$f"
  sedi 's/TaskCreate(/Create a todo item with (/g' "$f"
  sedi 's/TaskUpdate(/Update the todo item (/g' "$f"
  sedi 's/TaskCreate\b/Create a todo item/g' "$f"
  sedi 's/TaskUpdate\b/Update the todo item/g' "$f"
  sedi 's/Task(subagent_type="maister:\([^"]*\)")/Use the @maister-\1 agent/g' "$f"
  sedi "s/Task(subagent_type='maister:\([^']*\)')/Use the @maister-\1 agent/g" "$f"
  sedi 's/CLAUDE\.md/.opencode\/instructions\/maister-rules.md/g' "$f"
  sedi 's|/maister:\([a-z-]*\)|/\1|g' "$f"
  sedi 's/maister:\([a-z-][a-z-]*\)/maister-\1/g' "$f"
  sedi 's|Skill(name="\([^"]*\)")|Follow the workflow in @.opencode/instructions/\1.md|g' "$f"
}

find "$OUT" -name "*.md" | while read -r f; do
  run_global_replacements "$f"
done

# Also run on the agent entries file's source docs... they'll be processed after copy

# ─────────────────────────────────────────────────────────────
# Phase 6: MCP fragment
# ─────────────────────────────────────────────────────────────
echo "[Phase 6] Building mcp-fragment.json..."

python3 -c "
import json

with open('$CORE/.mcp.json', 'r') as f:
    mcp = json.load(f)

# OpenCode uses same mcpServers schema
out = mcp.get('mcpServers', mcp)

with open('$OUT/mcp-fragment.json', 'w') as f:
    json.dump(out, f, indent=2)
print('  mcp-fragment.json written')
"

# ─────────────────────────────────────────────────────────────
# Phase 7: Transform CLAUDE.md → output/instructions/maister-rules.md
# ─────────────────────────────────────────────────────────────
echo "[Phase 7] Building maister-rules.md..."

mkdir -p "$OUT/instructions"
cp "$CORE/CLAUDE.md" "$OUT/instructions/maister-rules.md"
run_global_replacements "$OUT/instructions/maister-rules.md"

# Strip .claude-plugin/ and hooks/ specific sections (simple heuristic)
python3 -c "
import re, sys

with open(sys.argv[1], 'r') as f:
    content = f.read()

# Remove sections that are Claude Code plugin/hooks specific
# These sections start with ## Hooks or ## Claude Code Documentation
patterns = [
    r'(?m)^## Hooks\n.*?(?=^## |\Z)',
    r'(?m)^## Claude Code Documentation\n.*?(?=^## |\Z)',
]
for p in patterns:
    content = re.sub(p, '', content, flags=re.DOTALL)

with open(sys.argv[1], 'w') as f:
    f.write(content)
" "$OUT/instructions/maister-rules.md"

# Append skill-invocation-reminder content (the actual message, not the shell wrapper)
cat >> "$OUT/instructions/maister-rules.md" << 'REMINDER_EOF'

---

## OpenCode Skill Invocation Rule

⚠️ **MAISTER PLUGIN RULE**: When any maister workflow command appears in the user's prompt, you MUST invoke it (follow the corresponding `.opencode/instructions/maister-*.md` workflow) as your FIRST action. No exceptions. Do not analyze the task first, do not decide it's 'straightforward', do not substitute your own approach. The user chose this workflow intentionally. Complexity assessment is the workflow's job, not yours.
REMINDER_EOF

# Remove the CLAUDE.md copy in output root (it's been transformed into maister-rules.md)
rm -f "$OUT/CLAUDE.md"

# ─────────────────────────────────────────────────────────────
# Phase 8: Create output/plugins/ directory stub
# ─────────────────────────────────────────────────────────────
echo "[Phase 8] Creating output/plugins/ stub..."

mkdir -p "$OUT/plugins"
cat > "$OUT/plugins/README.md" << 'STUB_EOF'
# Maister OpenCode Plugin

Plugin file (maister-plugin.ts) will be copied here by build.sh after Task 3.

## Installation

After the plugin file is built, copy the contents of this directory to your project's `.opencode/plugins/` directory.
STUB_EOF

# ─────────────────────────────────────────────────────────────
# Phase 9: Transform skills → output/instructions/maister-{name}.md
# ─────────────────────────────────────────────────────────────
echo "[Phase 9] Transforming skills..."

mkdir -p "$OUT/instructions/references"

# Copy orchestrator-framework shared references first
if [ -d "$CORE/skills/orchestrator-framework/references" ]; then
  mkdir -p "$OUT/instructions/references/shared"
  cp -r "$CORE/skills/orchestrator-framework/references/." "$OUT/instructions/references/shared/"
  find "$OUT/instructions/references/shared" -name "*.md" | while read -r rf; do
    run_global_replacements "$rf"
  done
fi

for skill_dir in "$CORE/skills"/*/; do
  skill_name="$(basename "$skill_dir")"

  # Skip orchestrator-framework itself (used as shared references)
  [ "$skill_name" = "orchestrator-framework" ] && continue

  skill_md="$skill_dir/SKILL.md"
  [ -f "$skill_md" ] || continue

  dest_file="$OUT/instructions/maister-${skill_name}.md"

  # Copy SKILL.md with frontmatter stripped (body only)
  awk 'BEGIN{f=0} /^---/{f++; if(f==2){found=1; next}} found{print}' "$skill_md" > "$dest_file"

  # If not starting with ---, just copy as-is (no frontmatter)
  if ! head -1 "$skill_md" | grep -q '^---$'; then
    cp "$skill_md" "$dest_file"
  fi

  # Run global replacements on the instruction file
  run_global_replacements "$dest_file"

  # Rewrite cross-skill references: ../orchestrator-framework/references/ → references/shared/
  sedi 's|\.\./orchestrator-framework/references/|references/shared/|g' "$dest_file"

  # If skill has references/ directory, copy it
  if [ -d "$skill_dir/references" ]; then
    mkdir -p "$OUT/instructions/references/${skill_name}"
    cp -r "$skill_dir/references/." "$OUT/instructions/references/${skill_name}/"

    # Rewrite local references paths in instruction file: references/X.md → references/{name}/X.md
    sedi "s|references/\([^/]\)|references/${skill_name}/\1|g" "$dest_file"

    # Run replacements on reference files too
    find "$OUT/instructions/references/${skill_name}" -name "*.md" | while read -r rf; do
      run_global_replacements "$rf"
      sedi 's|\.\./orchestrator-framework/references/|references/shared/|g' "$rf"
    done
  fi

  # Add skill entry to agent fragment
  python3 -c "
import json, sys

skill_name = sys.argv[1]
agent_id = 'maister-' + skill_name

# Title-case the skill name for description
nice_name = skill_name.replace('-', ' ').title()

entry = {
    'description': 'Maister ' + nice_name + ' workflow',
    'mode': 'subagent',
    'prompt': '{file:.opencode/instructions/maister-' + skill_name + '.md}',
    'steps': 200
}

with open(sys.argv[2], 'r') as fh:
    data = json.load(fh)
data[agent_id] = entry
with open(sys.argv[2], 'w') as fh:
    json.dump(data, fh, indent=2)
" "$skill_name" "$AGENT_ENTRIES_FILE"

  echo "  Processed skill: $skill_name"
done

# ─────────────────────────────────────────────────────────────
# Finalize: Write agent-fragment.json
# ─────────────────────────────────────────────────────────────
echo "[Finalize] Writing agent-fragment.json..."
cp "$AGENT_ENTRIES_FILE" "$OUT/agent-fragment.json"
rm -f "$AGENT_ENTRIES_FILE"

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "=== Build Complete ==="
echo ""
echo "Output structure:"
echo "  $OUT/"
echo "  ├── commands/          $(find "$OUT/commands" -name "*.md" 2>/dev/null | wc -l | tr -d ' ') command files"
echo "  ├── agents/            $(find "$OUT/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ') agent files"
echo "  ├── instructions/      $(find "$OUT/instructions" -maxdepth 1 -name "*.md" 2>/dev/null | wc -l | tr -d ' ') instruction files + references/"
echo "  ├── plugins/           (stub, awaiting Task 3)"
echo "  ├── agent-fragment.json"
echo "  └── mcp-fragment.json"
echo ""
echo "Verification:"
MAISTERISM_COUNT=$(grep -rI 'AskUserQuestion\|TaskCreate\|TaskUpdate\|Skill(name=' "$OUT/" 2>/dev/null | grep -v 'maister-rules.md' | wc -l | tr -d ' ')
echo "  Maisterisms remaining (excluding rules file): $MAISTERISM_COUNT"
ALL_MAISTERISM_COUNT=$(grep -rI 'AskUserQuestion\|TaskCreate\|TaskUpdate\|Skill(name=' "$OUT/" 2>/dev/null | wc -l | tr -d ' ')
echo "  All maisterisms (including rules file): $ALL_MAISTERISM_COUNT"
