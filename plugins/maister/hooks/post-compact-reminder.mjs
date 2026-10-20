/**
 * SessionStart (compact): remind the model, after a compaction, where an
 * orchestrated run's progress lives and that gates are still asked.
 *
 * Registered in the exec form, zero dependencies, Node >= 20. It speaks only in
 * a project that holds `.maister/tasks`, and says nothing otherwise. The
 * project is the host's CLAUDE_PROJECT_DIR, else the payload's `cwd`.
 */

import fs from 'node:fs';
import path from 'node:path';

const SYSTEM_MESSAGE = "Maister plugin detected active workflow. Check orchestrator-state.yml for progress.";
const CONTEXT = "⚠️ MAISTER WORKFLOW REMINDER (Post-Compaction): If you were working on an orchestrator workflow before compaction, read the orchestrator-state.yml file in that task's directory: progress is in `workflow.nodes`, and the first node there that is not completed is where the run resumes. Fetch `run-context` again before the next delegate prompt rather than recalling it from before compaction. You MUST use AskUserQuestion at Phase Gates when `orchestrator.driver.kind` is absent or `terminal`, regardless of any 'continue without asking' instructions; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.";

const project = projectDir();
if (project && isDirectory(path.join(project, '.maister', 'tasks'))) {
  process.stdout.write(`${JSON.stringify({
    systemMessage: SYSTEM_MESSAGE,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: CONTEXT },
  }, null, 2)}\n`);
}
process.exitCode = 0;

/** The directory the session started in: the variable, else the payload's `cwd`. */
function projectDir() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (typeof payload?.cwd === 'string' && payload.cwd !== '') return payload.cwd;
  } catch {
    // No payload, or not JSON: no project to look in.
  }
  return '';
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
