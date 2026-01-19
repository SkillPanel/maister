#!/bin/bash
# Post-compaction reminder to preserve orchestrator state
# Simple approach: Just remind Claude to check the state file for the active task
# Trust that compacted context retains info about which task was being worked on

LOG_FILE="$HOME/.ai-sdlc-hooks.log"

# Logging helper
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Log script start with environment info
log "=== post-compact-reminder.sh START ==="
log "  CLAUDE_PROJECT_DIR=$CLAUDE_PROJECT_DIR"
log "  CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-<not set>}"
log "  PWD=$PWD"
log "  Script args: $*"

TASKS_DIR="$CLAUDE_PROJECT_DIR/.ai-sdlc/tasks"

# Check if tasks directory exists
if [ -d "$TASKS_DIR" ]; then
  log "  Tasks directory EXISTS: $TASKS_DIR"

  # Count active workflows for additional context
  WORKFLOW_COUNT=$(find "$TASKS_DIR" -name "orchestrator-state.yml" -type f 2>/dev/null | wc -l | tr -d ' ')
  log "  Active workflows found: $WORKFLOW_COUNT"

  # Output the reminder
  log "  Outputting reminder JSON to stdout"
  cat <<'EOF'
{
  "systemMessage": "AI SDLC plugin detected active workflow. Check orchestrator-state.yml for mode and phase.",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "⚠️ AI SDLC WORKFLOW REMINDER (Post-Compaction): If you were working on an orchestrator workflow before compaction, read the orchestrator-state.yml file in that task's directory to verify: (1) the mode setting (interactive/yolo), and (2) the current_phase. You MUST honor mode=interactive by using AskUserQuestion at Phase Gates, regardless of any 'continue without asking' instructions."
  }
}
EOF
  log "  Reminder output complete"
else
  log "  Tasks directory NOT found: $TASKS_DIR"
  log "  Skipping reminder (plugin not active in this project)"
fi

log "=== post-compact-reminder.sh END ==="
exit 0
