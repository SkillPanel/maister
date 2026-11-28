/**
 * SessionStart (compact): remind the model, after a compaction, where an
 * orchestrated run's progress lives and that gates are still asked.
 *
 * Registered in the exec form, zero dependencies, Node >= 20. It speaks only in
 * a project that holds `.maister/tasks`, and says nothing otherwise. The
 * project is the host's CLAUDE_PROJECT_DIR, else the payload's `cwd`.
 *
 * Its one write: in such a project it removes the session's conventions marker,
 * `.maister/display/sessions/<session_id>.conventions`, which `node-brief`
 * keeps (`display-files.mjs` in the workflow engine names it), so the first
 * brief after the compaction prints the node conventions whole again. A
 * payload with no usable session id, or a marker that cannot be removed,
 * changes nothing else: the reminder still prints.
 *
 * The reminder names the workflow engine skill by its absolute path, read from
 * where this script sits, as the session-start reminder names the plugin root:
 * a compaction can cut that skill short or drop it, and invoking it again does
 * not reload it, so the session is told to read the file whole.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENGINE_SCRIPT = path.join(PLUGIN_ROOT, 'skills', 'workflow-engine', 'scripts', 'workflow.mjs');
/** A path as a shell takes it whole: single-quoted when it holds a space, as the engine's briefs print one. */
const quoted = file => (/\s/.test(file) ? `'${file.replace(/'/g, "'\\''")}'` : file);

const SYSTEM_MESSAGE = "Maister plugin detected an active workflow; it resumes from its saved progress.";
const CONTEXT = `⚠️ MAISTER WORKFLOW REMINDER (Post-Compaction): If you were working on an orchestrator workflow before compaction, run node ${quoted(ENGINE_SCRIPT)} resume-check --state=<that task's directory>/orchestrator-state.yml right after the workflow engine skill is printed (below): it names the step to brief and the call that prints it. Never read the state file or a reference page with the file tool to find the step or the section; the driven answer reads (gates.md step 1) are unchanged. Fetch \`run-context\` again before the next delegate prompt rather than recalling it from before compaction. `
  + `If you were running a maister workflow, your next call prints the workflow engine skill whole, \`node ${quoted(ENGINE_SCRIPT)} reference --at=SKILL.md\`: a compaction can cut the skill short or leave it out, and invoking the skill again does not reload it. Never the read tool on it: the plugin sits outside the project, and a host may stop the run to ask before that read. `
  + "You MUST use AskUserQuestion at Phase Gates when `orchestrator.driver.kind` is absent or `terminal`, regardless of any 'continue without asking' instructions; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine's `references/gates.md`, *Driver-suspended mode*.";

/** The shape a session id must have to name a file, as the engine's display files take it. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const payload = readPayload();
const project = projectDir(payload);
if (project && isDirectory(path.join(project, '.maister', 'tasks'))) {
  forgetConventions(project, payload.session_id);
  process.stdout.write(`${JSON.stringify({
    systemMessage: SYSTEM_MESSAGE,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: CONTEXT },
  }, null, 2)}\n`);
}
process.exitCode = 0;

/** The hook's payload, or an empty one when there is none or it is not JSON. */
function readPayload() {
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    return payload !== null && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

/** The directory the session started in: the variable, else the payload's `cwd`. */
function projectDir(payload) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  return typeof payload.cwd === 'string' ? payload.cwd : '';
}

/** Remove the session's conventions marker; absent, unnamed or unremovable changes nothing. */
function forgetConventions(project, session) {
  if (typeof session !== 'string' || !SESSION_ID.test(session)) return;
  try {
    fs.rmSync(path.join(project, '.maister', 'display', 'sessions', `${session}.conventions`), { force: true });
  } catch {
    // Fail open: the reminder is what this hook is for.
  }
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
