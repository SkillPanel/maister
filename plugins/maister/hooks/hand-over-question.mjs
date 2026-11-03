/**
 * PreToolUse (ask_user): hand the question tool the call the engine printed.
 *
 * At a gate, and for a question set, the workflow engine prints the question
 * tool's whole call (`gate-brief --ask`, `area-brief --ask`) and the session is
 * told to pass it unchanged. The session still retypes it into the tool, and
 * a session retyping a long brief rewords and shortens it on the way: the
 * decisions the run made, the steps it skips and the counts drop out of the
 * question the person reads. The engine also records each printed call as
 * `.ask.json` in the run's directory; this hook puts that record in place of
 * the call's arguments, so what the person reads is what the engine built.
 *
 * It hands a record over only when the record is the call being made:
 *   - the call is the main session's (an agent never asks the person);
 *   - the record is younger than FRESH_MS, since a gate's ids repeat in every
 *     run of a workflow and an old record can match a later question;
 *   - the record asks the same questions with the same option ids as the call.
 * Of several matching records it takes the one whose run wrote its state last.
 * A record is used once: after it is handed over, or found equal to the call,
 * it is renamed to `.ask.used.json`, so a question asked again without a new
 * `--ask` goes through as the session wrote it.
 *
 * It fails open and never blocks: input it cannot read, no record, a stale or
 * a different one, or any error, and the call goes through as written. It
 * never denies a call and never asks one. Registered for the Copilot variant
 * only (`platforms/copilot-cli/hooks.json`), where the engine's `--ask` form is
 * the question tool's call; the output goes out under the HOOK_SHAPE line the
 * build switches to Copilot's top-level `modifiedArgs`.
 *
 * Registered in the exec form, zero dependencies, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

const HOOK_SHAPE = 'claude';

/** How long a printed call stays the call being made. */
const FRESH_MS = 10 * 60 * 1000;
const RECORD = '.ask.json';
const USED = '.ask.used.json';
const STATE = 'orchestrator-state.yml';

/** The tool's arguments, as either host spells them. */
function argumentsOf(input) {
  const args = input?.tool_input ?? input?.toolArgs;
  if (typeof args === 'string') return JSON.parse(args);
  return args;
}

/** The ids that make a call the same question: each property's id and its option ids. */
function signature(call) {
  const properties = call?.requestedSchema?.properties;
  if (!properties || typeof properties !== 'object') return null;
  const ids = Object.keys(properties).sort().map(key => {
    const field = properties[key] || {};
    const options = [
      ...(field.oneOf || []).map(option => option?.const),
      ...(field.enum || []),
      ...(field.items?.enum || []),
      ...(field.items?.anyOf || []).map(option => option?.const),
    ].map(String).sort();
    return [key, options];
  });
  return JSON.stringify(ids);
}

/** Each run directory's fresh record under the project's tasks. */
function freshRecords(root, now) {
  const tasks = path.join(root, '.maister', 'tasks');
  const records = [];
  for (const type of fs.readdirSync(tasks, { withFileTypes: true })) {
    if (!type.isDirectory()) continue;
    for (const run of fs.readdirSync(path.join(tasks, type.name), { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const dir = path.join(tasks, type.name, run.name);
      const file = path.join(dir, RECORD);
      let written;
      try { written = fs.statSync(file).mtimeMs; } catch { continue; }
      if (now - written > FRESH_MS) continue;
      let stateWritten = 0;
      try { stateWritten = fs.statSync(path.join(dir, STATE)).mtimeMs; } catch { /* a run with no state yet ranks last */ }
      records.push({ dir, file, written, stateWritten });
    }
  }
  return records.sort((a, b) => b.stateWritten - a.stateWritten || b.written - a.written);
}

function handOver(call) {
  return JSON.stringify(HOOK_SHAPE === 'copilot'
    ? { modifiedArgs: call }
    : { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: call } });
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const agentType = typeof input?.agent_type === 'string' ? input.agent_type : '';
  const call = argumentsOf(input);
  const wanted = signature(call);
  if (agentType === '' && wanted) {
    const root = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    for (const record of freshRecords(root, Date.now())) {
      let printed;
      try { printed = JSON.parse(fs.readFileSync(record.file, 'utf8')); } catch { continue; }
      if (signature(printed) !== wanted) continue;
      fs.renameSync(record.file, path.join(record.dir, USED));
      if (JSON.stringify(printed) !== JSON.stringify(call)) process.stdout.write(`${handOver(printed)}\n`);
      break;
    }
  }
} catch {
  // Fail open: the call goes through as the session wrote it.
}
process.exitCode = 0;
