/**
 * The walk a closing write runs once it has landed (`write-state --next`):
 * the run read from disk, its off-path steps recorded skipped through the
 * walk `skipWalk` shares, and the brief of the step it stops at rendered as
 * `node-brief` renders it — the start recorded and `brief.json` published —
 * so one call does what the write, its skip writes and a `node-brief` did.
 *
 * Kept apart from the state writer, which cannot import the brief, and from
 * the entry point, which stays a dispatcher: the entry point loads it only
 * for a landed write with the flag, and prints what it returns.
 *
 * Nothing here refuses and nothing throws. The write it follows has landed,
 * so a skip write refused, the bound reached or a brief that refused or threw
 * comes back as one `warning:` line naming what did not happen, with the step
 * due next read from the state as it now stands.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { dueNext, skipWalk } from './gate-brief.mjs';
import { frozenIds } from './question-triage.mjs';
import { writeState } from './state.mjs';
import { nodeBrief } from './node-brief.mjs';

/**
 * Walk the run whose state file is `state` after a landed write. `rules` is
 * the pointer `node-brief` prints, handed on to the brief. `writer(patch, id)`,
 * `bound` and `brief(node)` stand in for the state writer, the turn limit (one
 * per frozen node, and one more) and `nodeBrief`; a caller leaves them out.
 *
 * Returns `{lines, next, brief, warnings}`: `lines` the walk's own lines in
 * walk order (`skipped: …`); `next` the step due next as the state writer's
 * `next:` line takes it — `{id, title}`, `{id: null}` when only the closing
 * patch is left, or null when nothing is due; `brief` the brief's text when
 * the walk stopped at a step and its brief printed, else null, and then
 * `next` is the step the brief is of; `warnings` whole `warning:` lines for
 * stderr, the walk's writes' and the brief's included.
 */
export function closingWalk({ state, rules, writer = null, bound = null, brief = null }) {
  const runDir = path.dirname(path.resolve(state));
  const read = () => parse(fs.readFileSync(state, 'utf8'));
  const render = brief ?? (node => nodeBrief({ state, node, rules }));
  const out = { lines: [], next: null, brief: null, warnings: [] };
  const write = writer ?? (patch => {
    const result = writeState({ state, patch });
    out.warnings.push(...writeWarnings(result));
    return result;
  });
  try {
    const doc = read();
    const limit = bound ?? frozenIds(isPlainObject(doc.workflow) ? doc.workflow.nodes : {}).length + 1;
    const { skipped, stop } = skipWalk({ doc, runDir, writer: write, reread: read, bound: limit });
    out.lines.push(...skipped.map(skippedLine));
    if (stop.kind === 'due') return briefed(out, stop, render, read, runDir);
    if (stop.kind === 'refused') out.warnings.push(stop.id === null ? stopped(stop.code ?? stop.error?.message) : skipRefused(stop));
    if (stop.kind === 'bound') out.warnings.push(`warning: next-walk-unsettled: the walk did not settle within ${stop.bound} steps; nothing after the writes above was walked or briefed`);
  } catch (error) {
    out.warnings.push(stopped(error.message));
  }
  out.next = todaysNext(read, runDir);
  return out;
}

/**
 * The walk stopped at a step that must run: its brief, rendered in this
 * process. A brief that refuses or throws leaves the warning and the step due
 * next as the state now reads.
 */
function briefed(out, stop, render, read, runDir) {
  let result;
  try {
    result = render(stop.id);
  } catch (error) {
    result = { ok: false, message: error.message };
  }
  if (result?.ok === true && typeof result.text === 'string') {
    out.warnings.push(...(result.warnings || []).map(warning => `warning: ${warning}`));
    return { ...out, next: { id: stop.id, title: stop.title }, brief: result.text };
  }
  const why = result?.message ?? (Array.isArray(result?.errors) ? result.errors[0]?.code : null) ?? 'no brief came back';
  out.warnings.push(`warning: next-brief-failed: the brief of ${stop.id} could not be printed (${why})`);
  return { ...out, next: todaysNext(read, runDir) };
}

/** One skip the walk recorded, with why the step is off the path. */
function skippedLine({ id, title, reason, guard }) {
  return reason === 'failure'
    ? `skipped: ${id} (${title}) — it runs only on a failure, and nothing failed`
    : `skipped: ${id} (${title}) — its guard ${guard} reads false`;
}

/** A skip write refused, or a writer or rule that threw while the walk stood at a step. */
function skipRefused(stop) {
  return `warning: next-skip-refused: ${stop.id} was not recorded skipped (${stop.code ?? stop.error?.message}); nothing after it was walked or briefed`;
}

/** The walk stopped where no step was at stake: the state unread, before or after a skip that landed. */
function stopped(why) {
  return `warning: the walk after the write stopped (${why}); nothing after the lines above was walked or briefed`;
}

/**
 * The step due next as the state on disk reads now, as the state writer's
 * `next:` line takes it, or null when nothing is due or the state cannot be
 * read.
 */
function todaysNext(read, runDir) {
  try {
    return dueNext({ doc: read(), runDir });
  } catch {
    return null;
  }
}

/** A skip write's own warnings, as whole `warning:` lines: a projection not written, a rule's warning code. */
function writeWarnings(result) {
  if (!result?.ok) return [];
  return [
    ...(result.warnings || []).map(warning => `warning: ${warning.file ?? 'dashboard-data.js'} was not written (${warning.code}: ${warning.message}); the state write is unaffected`),
    ...(result.writeWarnings || []).map(code => `warning: ${code}`),
  ];
}
