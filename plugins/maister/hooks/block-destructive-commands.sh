#!/bin/bash
# Block destructive commands from non-implementation subagents.
# Uses a whitelist approach: only explicitly trusted execution agents bypass the check.
# New agents are automatically protected by default.
#
# Requires: bash, grep, sed, tr — no JSON parser. The two fields it needs are
# read from the raw hook input by pattern, so the guard works on every machine
# the plugin runs on.
#
# Hook input (stdin): JSON with agent_type, tool_input.command, etc.
# Hook output: JSON with permissionDecision: "deny" to block, or exit 0 with no output to allow.

INPUT=$(cat)

# Read a top-level string field's raw JSON value. Inside a JSON string every
# quote is escaped, so a key spelled out in the command text never matches.
json_field() {
  printf '%s' "$INPUT" \
    | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" \
    | head -n 1 \
    | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//"
}

# Allow main agent (no agent_type) — user's permission system handles that.
# Agent names are plain identifiers; anything else is dropped so the name can
# be quoted into the deny payload safely.
AGENT_TYPE=$(json_field agent_type | tr -cd 'A-Za-z0-9:_.-')
if [ -z "$AGENT_TYPE" ]; then
  exit 0
fi

# Allow agents that legitimately need full Bash access (implementation, test execution)
# Note: task-group-implementer is NOT whitelisted — destructive commands are blocked
# to prevent rogue git stash/reset --hard from clobbering sibling implementers
# running in parallel waves.
case "$AGENT_TYPE" in
  test-suite-runner|e2e-test-verifier|user-docs-generator|docs-operator)
    exit 0
    ;;
esac

# JSON escapes for whitespace become spaces, so `git\tstash` still matches.
COMMAND=$(json_field command | sed -E 's/\\[ntr]/ /g')

# Block destructive patterns for all other agents
if printf '%s' "$COMMAND" | grep -qEi 'git[[:space:]]+stash|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+checkout[[:space:]]+--[[:space:]]+\.|git[[:space:]]+checkout[[:space:]]+\.[[:space:]]*$|git[[:space:]]+clean|git[[:space:]]+push[[:space:]]+(-f|--force)|rm[[:space:]]+-rf'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive command blocked for agent %s: git stash, reset --hard, checkout ., clean, push --force and rm -rf are not allowed for this agent."}}\n' "'$AGENT_TYPE'"
  exit 0
fi

exit 0
