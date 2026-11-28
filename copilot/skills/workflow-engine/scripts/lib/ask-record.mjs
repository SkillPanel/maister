/**
 * The question record: the call the question tool is handed, kept beside the
 * run's state so a host hook that can replace a tool call's arguments hands
 * this file over in place of the call the session retyped (a session retyping
 * a long brief rewords and shortens it). The record is a convenience, never a
 * verb's result: a run directory it cannot be written to leaves the printed
 * call as it is.
 *
 * This module owns the three file names and the two writes that touch them,
 * so the verbs that print a call and the state writer agree on them:
 *
 *   ASK_RECORD       the call as printed, replaced by each question
 *   ASK_RESULT       the note the Copilot build's after-question hook leaves
 *                    (who answered the last question)
 *   ASK_RESULT_USED  the note once retired
 *
 * Every question recorded retires the note left by the one before it — on the
 * Copilot build only — so a person's answer to that question never counts for
 * this one.
 */
import fs from 'node:fs';
import path from 'node:path';

import { SHIPPED_HOST } from '../../../../lib/host.mjs';

export const ASK_RECORD = '.ask.json';
export const ASK_RESULT = '.ask.result.json';
export const ASK_RESULT_USED = '.ask.result.used.json';

/** The bytes of a call as printed and as recorded: the same text. */
export function askText(call) {
  return `${JSON.stringify(call, null, 2)}\n`;
}

/**
 * Retire the after-question note to its used name. Does nothing when this is
 * not the Copilot build, and nothing when there is no note or it cannot be
 * moved. `host` is the host the build ships for unless a caller names one.
 */
export function retireNote(runDir, host = SHIPPED_HOST) {
  if (host !== 'copilot') return;
  try {
    fs.renameSync(path.join(runDir, ASK_RESULT), path.join(runDir, ASK_RESULT_USED));
  } catch {
    // No note, or one that cannot be moved: the call is printed either way.
  }
}

/** Write the record atomically: a temp file beside it, then a rename. Never throws. */
export function writeRecord(runDir, text) {
  try {
    const record = path.join(runDir, ASK_RECORD);
    const scratchFile = `${record}.${process.pid}.tmp`;
    fs.writeFileSync(scratchFile, text, 'utf8');
    fs.renameSync(scratchFile, record);
  } catch {
    // The call is printed; a hand-over that cannot happen leaves it to the session.
  }
}

/**
 * Record one question: retire the previous note (Copilot only), then write
 * the record with the bytes of `askText(call)`. `runDir` is the run's
 * directory (the folder holding its state file); `host` defaults to the host
 * this build ships for. Returns the text, so a caller prints exactly what was
 * recorded. Never throws.
 */
export function recordAsk({ runDir, call, host = SHIPPED_HOST }) {
  const text = askText(call);
  retireNote(runDir, host);
  writeRecord(runDir, text);
  return text;
}
