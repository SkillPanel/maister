#!/usr/bin/env bash
# install.sh — Install Maister into an OpenCode project
# Usage: bash platforms/opencode/install.sh /path/to/your-project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAISTER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Args ────────────────────────────────────────────────────────────────────
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 /path/to/your-project"
  exit 1
fi

if [[ ! -d "$TARGET" ]]; then
  echo "Error: target directory '$TARGET' does not exist."
  exit 1
fi

# ── Build artifacts if output is stale/missing ───────────────────────────────
OUT="$SCRIPT_DIR/output"
if [[ ! -d "$OUT/commands" ]] || [[ ! -d "$OUT/agents" ]]; then
  echo "==> Building Maister artifacts..."
  bash "$SCRIPT_DIR/build.sh"
fi

echo "==> Installing Maister into $TARGET"

# ── 1. Copy commands / agents / instructions ─────────────────────────────────
mkdir -p "$TARGET/.opencode/commands" \
         "$TARGET/.opencode/agents" \
         "$TARGET/.opencode/instructions" \
         "$TARGET/.opencode/plugins"

cp -r "$OUT/commands/."      "$TARGET/.opencode/commands/"
rm -rf "$TARGET/.opencode/agents" && mkdir -p "$TARGET/.opencode/agents"
cp -r "$OUT/agents/."        "$TARGET/.opencode/agents/"
cp -r "$OUT/instructions/."  "$TARGET/.opencode/instructions/"
echo "    ✔ commands / agents / instructions copied"

# ── 2. Copy plugin (source file, no build step needed) ───────────────────────
cp "$SCRIPT_DIR/plugin/index.ts" "$TARGET/.opencode/plugins/maister-plugin.ts"
echo "    ✔ plugin copied"

# ── 3. Merge into opencode.json ───────────────────────────────────────────────
OPENCODE_JSON="$TARGET/opencode.json"

TMPJSON="$(mktemp)"

# Wrap agent-fragment.json under {"agent": {...}} and add instructions
jq '{ agent: ., instructions: [".opencode/instructions/maister-rules.md"] }' \
  "$OUT/agent-fragment.json" > "$TMPJSON"
if [[ -s "$TMPJSON" ]]; then
  cp "$TMPJSON" "$OPENCODE_JSON"
  echo "    ✔ opencode.json created (agents + instructions)"
else
  echo "Error: failed to build opencode.json" >&2; rm -f "$TMPJSON"; exit 1
fi
rm -f "$TMPJSON"

# ── 4. Install plugin npm dependency ─────────────────────────────────────────
PLUGIN_DIR="$TARGET/.opencode"
if ! node -e "require('@opencode-ai/plugin')" 2>/dev/null; then
  echo "==> Installing @opencode-ai/plugin..."
  (cd "$PLUGIN_DIR" && npm init -y 2>/dev/null || true && npm install @opencode-ai/plugin --silent)
  echo "    ✔ @opencode-ai/plugin installed"
else
  echo "    ✔ @opencode-ai/plugin already available"
fi

# ── 5. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "✅ Maister installed successfully!"
echo ""
echo "   Commands:     $(ls "$TARGET/.opencode/commands/" | wc -l) files"
echo "   Agents:       $(ls "$TARGET/.opencode/agents/"   | wc -l) files"
echo "   Instructions: $(ls "$TARGET/.opencode/instructions/" | wc -l) files"
echo "   Plugin:       $TARGET/.opencode/plugins/maister-plugin.ts"
echo "   Config:       $TARGET/opencode.json"
echo ""
echo "Next: cd $TARGET && opencode"
echo "Then try: /work Add a hello world function"
