#!/bin/bash
# Block destructive commands from non-implementation subagents.
# Uses a whitelist approach: only explicitly trusted execution agents bypass the check.
# New agents are automatically protected by default.
#
# Requires: bash. jq is required only to judge a subagent — advisory, and
# subagents only: the main agent is always allowed through (the user's own
# permission system governs it), so a terminal user without jq keeps every
# Bash call.
#
# Hook input (stdin): JSON with agent_type, tool_input.command, etc.
# Hook output: JSON with permissionDecision: "deny" to block, or exit 0 with no output to allow.
# Exit 2 with a static deny payload on stdout and its reason on stderr when jq is
# missing and the caller is a subagent (fail closed — never fail open).
#
# The deny goes out in the host's PreToolUse output shape: Claude Code reads it
# under hookSpecificOutput, GitHub Copilot CLI as a top-level permissionDecision.
# The Copilot build sets HOOK_SHAPE to copilot in the variant's copy. A host
# names a plugin's agent with its plugin as a prefix (`maister-copilot:docs-operator`),
# so the whitelist is matched on the bare name or on this plugin's own spellings
# of it, `maister:` and `maister-copilot:`. Another plugin's or a project's agent
# of the same name is judged like any other.
HOOK_SHAPE=copilot

# One deny payload, in the host's shape, from a reason that is already JSON-escaped.
deny_json() {
  if [ "$HOOK_SHAPE" = copilot ]; then
    printf '{"permissionDecision":"deny","permissionDecisionReason":%s}\n' "$1"
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$1"
  fi
}

INPUT=$(cat)

# Allow main agent (no agent_type) — user's permission system handles that.
# Read without jq, because this answer must not depend on jq being installed;
# the jq read below is what actually decides for a subagent.
if ! printf '%s' "$INPUT" | grep -qE '"agent_type"[[:space:]]*:[[:space:]]*"[^"]+"'; then
  exit 0
fi

# The deny on stdout is what the model reads; the reason also goes to stderr,
# which is the only channel the operator watching the terminal sees.
command -v jq >/dev/null 2>&1 || {
  deny_json '"maister guard: jq missing"'
  echo 'maister guard: jq missing; a subagent Bash call cannot be judged, so it is denied. Install jq to re-enable the guard.' >&2
  exit 2
}

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$AGENT_TYPE" ]; then
  exit 0
fi

# Allow agents that legitimately need full Bash access (implementation, test execution)
# Note: task-group-implementer is NOT whitelisted — destructive commands are blocked
# to prevent rogue git stash/reset --hard from clobbering sibling implementers
# running in parallel waves.
case "$AGENT_TYPE" in
  maister:*|maister-copilot:*) AGENT_NAME=${AGENT_TYPE#*:} ;;
  *) AGENT_NAME=$AGENT_TYPE ;;
esac
case "$AGENT_NAME" in
  test-suite-runner|e2e-test-verifier|user-docs-generator|docs-operator)
    exit 0
    ;;
esac

# Block destructive patterns for all other agents
if echo "$COMMAND" | grep -qEi 'git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf'; then
  deny_json "$(jq -n --arg agent "$AGENT_TYPE" --arg cmd "${COMMAND:0:80}" '"Destructive command blocked for agent '\''" + $agent + "'\'': " + $cmd')"
  exit 0
fi

exit 0
