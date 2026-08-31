#!/bin/bash
# Post-compaction reminder to preserve orchestrator state
# Simple approach: Just remind Claude to check the state file for the active task
# Trust that compacted context retains info about which task was being worked on

TASKS_DIR="$CLAUDE_PROJECT_DIR/.maister/tasks"

# Check if tasks directory exists
if [ -d "$TASKS_DIR" ]; then
  cat <<'EOF'
{
  "systemMessage": "Maister plugin detected active workflow. Check orchestrator-state.yml for phase.",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "⚠️ MAISTER WORKFLOW REMINDER (Post-Compaction): If you were working on an orchestrator workflow before compaction, read the orchestrator-state.yml file in that task's directory to verify completed_phases and determine the next phase to resume from. You MUST use AskUserQuestion at Phase Gates when `orchestrator.driver.kind` is absent or `terminal`; in `cockpit`/`dispatch` mode suspend the run with one `gate-request` call — it writes the request file, the gate index and `gate_pending` together, and is never followed by a second state write — then end the turn, regardless of any 'continue without asking' instructions."
  }
}
EOF
fi

exit 0
