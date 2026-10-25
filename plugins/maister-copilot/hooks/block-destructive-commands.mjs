/**
 * PreToolUse (Bash): block destructive commands from subagents.
 *
 * Registered in the exec form, zero dependencies, Node >= 20. A whitelist
 * approach: only explicitly trusted execution agents bypass the check, so a new
 * agent is protected by default. The main agent (no `agent_type`) is always let
 * through; the user's own permission system governs it.
 *
 * Hook input (stdin): JSON with agent_type, tool_input.command, etc.
 * Hook output: a deny in the host's PreToolUse shape to block, or exit 0 with no
 * output to allow. Input that is not JSON cannot be judged, so it is denied with
 * exit 2, the reason on stderr as well (fail closed — never fail open).
 *
 * The deny goes out in the host's PreToolUse output shape: Claude Code reads it
 * under hookSpecificOutput, GitHub Copilot CLI as a top-level permissionDecision.
 * The Copilot build sets HOOK_SHAPE to copilot in the variant's copy. A host
 * names a plugin's agent with its plugin and a colon as a prefix, so the
 * whitelist is matched on the bare name or on this plugin's own spellings of it,
 * prefixed with either of its two names, `maister` and `maister-copilot`. Another
 * plugin's or a project's agent of the same name is judged like any other.
 */

import fs from 'node:fs';

const HOOK_SHAPE = 'copilot';

// Agents that legitimately need full Bash access (test execution, docs).
// Note: task-group-implementer is NOT whitelisted — destructive commands are
// blocked to prevent a rogue git stash/reset --hard from clobbering sibling
// implementers running in parallel waves.
const WHITELIST = ['test-suite-runner', 'e2e-test-verifier', 'user-docs-generator', 'docs-operator'];
const OWN_PREFIXES = ['maister', 'maister-copilot'].map(name => `${name}:`);

// `git stash list` and `git stash show` only read the stash, so they pass;
// any other stash subcommand, a bare `git stash` included, is blocked.
const DESTRUCTIVE = /git\s+stash(?!\s+(?:list|show)\b)|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf/im;

/** One deny payload, in the host's shape. */
function denyJson(reason) {
  const decision = { permissionDecision: 'deny', permissionDecisionReason: reason };
  return JSON.stringify(HOOK_SHAPE === 'copilot' ? decision : { hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } });
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  // The deny on stdout is what the model reads; the reason also goes to stderr,
  // which is the only channel the operator watching the terminal sees.
  process.stdout.write(`${denyJson('maister guard: unreadable hook input')}\n`);
  process.stderr.write('maister guard: the hook input is not JSON, so the call cannot be judged and is denied.\n');
  process.exit(2);
}

const agentType = typeof input?.agent_type === 'string' ? input.agent_type : '';
const command = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : '';
const prefix = OWN_PREFIXES.find(own => agentType.startsWith(own));
const agentName = prefix ? agentType.slice(prefix.length) : agentType;

if (agentType !== '' && !WHITELIST.includes(agentName) && DESTRUCTIVE.test(command)) {
  const shown = Array.from(command).slice(0, 80).join('');
  process.stdout.write(`${denyJson(`Destructive command blocked for agent '${agentType}': ${shown}`)}\n`);
}
process.exitCode = 0;
