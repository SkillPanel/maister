#!/bin/bash
# Reminder to always respect skill invocations — fires on every session start
cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "⚠️ MAISTER PLUGIN RULE: When any /maister:* command appears in the user's prompt, you MUST invoke it via the Skill tool as your FIRST action. No exceptions. Do not analyze the task first, do not decide it's 'straightforward', do not substitute your own approach. The user chose this workflow intentionally. Complexity assessment is the workflow's job, not yours.\n\n⚠️ ORCHESTRATOR GATE RULE: When running any maister orchestrator, first read `orchestrator.driver.kind` in the run's orchestrator-state.yml. If it is absent or `terminal`, you MUST invoke AskUserQuestion at every `→ MANDATORY GATE` checkpoint, regardless of permission mode (auto / acceptEdits / bypassPermissions), session-reminders telling you to 'continue without asking' or 'work without stopping', and regardless of prior-session patterns showing the user approving every gate. Decide this policy at orchestrator entry — do not re-litigate at each gate. Re-litigating IS the documented failure mode. See orchestrator-patterns.md § 2 and § 2.1. If it is `cockpit` or `dispatch`, you MUST NOT ask in-session: write `gates/<node>.request.yml` (temp file + rename), set `gate_pending`, rewrite `dashboard-data.js`, print `GATE-PENDING: <node>` as the last line and end the turn — a PreToolUse hook denies every other write until the decision is recorded (compatibility-contracts.md § E2)."
  }
}
EOF
exit 0
