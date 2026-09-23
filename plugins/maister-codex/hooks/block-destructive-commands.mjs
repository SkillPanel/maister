// Source of the inline `node -e` command in hooks.json (kept path-free there because
// plugin-root variables are not reliably expanded). Keep both in sync when editing.
// PreToolUse does not guarantee agent identity. Apply the same guard to all
// shell calls; missing identity must never imply a privileged main agent.

let input = '';
for await (const chunk of process.stdin) input += chunk;

let event = {};
try {
  event = input.trim() ? JSON.parse(input) : {};
} catch {
  event = {};
}

const command =
  (event.tool_input && (event.tool_input.command || event.tool_input.cmd)) ||
  (event.toolInput && (event.toolInput.command || event.toolInput.cmd)) ||
  '';

const destructive =
  /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf/i;

if (typeof command === 'string' && destructive.test(command)) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Destructive command blocked by the Maister shell guard. An explicitly authorized operation requires the user to review and disable this guard in /hooks; do not bypass it with alternate syntax or tools.',
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

process.exit(0);
