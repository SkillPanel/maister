// Source of the inline `node -e` command in hooks.json (kept path-free there because
// plugin-root variables are not reliably expanded). Keep both in sync when editing.
import fs from 'node:fs';
import path from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;

let event = {};
try {
  event = input.trim() ? JSON.parse(input) : {};
} catch {
  event = {};
}

const workspace = path.resolve(typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd());
if (fs.existsSync(path.join(workspace, '.maister', 'tasks'))) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'MAISTER RESUME CHECK: A .maister/tasks directory exists. If this chat was running a Maister orchestrator before compaction, read the active task orchestrator-state.yml and completed artifacts before continuing. Treat the state file, not recalled chat history, as the resume source of truth. Honor every remaining explicit phase approval gate.',
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
