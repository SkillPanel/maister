// Source of the inline `node -e` command in hooks.json (kept path-free there because
// plugin-root variables are not reliably expanded). Keep both in sync when editing.
// Block destructive shell commands from non-implementation subagents.
// Whitelist approach: only explicitly trusted execution agents bypass the check,
// so new agents are protected by default. The main agent (no agent identifier)
// passes through — the user's approval system governs it.

let input = '';
for await (const chunk of process.stdin) input += chunk;

let event = {};
try {
  event = input.trim() ? JSON.parse(input) : {};
} catch {
  event = {};
}

const agentType =
  event.agent_type || event.agentType || event.subagent_type || event.agent || '';
const command =
  (event.tool_input && (event.tool_input.command || event.tool_input.cmd)) ||
  (event.toolInput && (event.toolInput.command || event.toolInput.cmd)) ||
  '';

// Main agent: allow (execution approval handles sensitive actions there).
if (!agentType) process.exit(0);

// Agents that legitimately need full shell access (test execution, docs capture).
// maister-task-group-implementer is intentionally NOT whitelisted: destructive git
// commands are blocked so one implementer cannot clobber parallel siblings.
const trusted = new Set([
  'maister-test-suite-runner',
  'maister-e2e-test-verifier',
  'maister-user-docs-generator',
  'maister-docs-operator',
]);
if (trusted.has(String(agentType))) process.exit(0);

const destructive =
  /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf/i;

if (typeof command === 'string' && destructive.test(command)) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Destructive command blocked for agent '${agentType}': ${String(command).slice(0, 80)}`,
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

process.exit(0);
