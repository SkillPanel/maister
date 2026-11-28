/**
 * The walk a closing write runs once it has landed (`write-state --next`):
 * the run read from disk, its off-path steps recorded skipped through the
 * walk `skipWalk` shares, a gate the project's config continues recorded
 * continued where the walk stands, and the brief of the step it stops at
 * rendered as `node-brief` renders it — the start recorded and `brief.json`
 * published — so one call does what the write, its skip writes, the continue
 * and a `node-brief` did.
 * Where the run cannot go on from the write (`heldWalk`) it skips and briefs
 * nothing, and the write prints what it prints alone, or the line that says
 * why the run stands.
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
import { dueNext, reread, skipWalk } from './gate-brief.mjs';
import { frozenIds } from './question-triage.mjs';
import { stopAnswered, writeState } from './state.mjs';
import { openRevision } from './revise.mjs';
import { configContinue, nodeBrief } from './node-brief.mjs';

/** The `task.status` values a run's closing patch records. */
const RUN_ENDINGS = new Set(['completed', 'failed', 'stopped']);

/** The statuses of a step started and not yet ended. */
const ONGOING = new Set(['running', 'waiting', 'suspended']);

/**
 * Walk the run whose state file is `state` after a landed write. `rules` is
 * the pointer `node-brief` prints, handed on to the brief; `today` what the
 * write's own `next:` line names (`nextCheck`), or null when it prints none,
 * for the stops that print what the write prints alone. `writer(patch, id)`,
 * `bound` and `brief(node, continueOutcome)` stand in for the state writer, the
 * turn limit (one per frozen node, and one more) and `nodeBrief`; a caller
 * leaves them out.
 *
 * Each turn takes one pending node out of the way — a skip, or a gate the
 * config continues — or stops, so the whole walk stays within the bound. The
 * continue is attempted once per gate: on any outcome but its lines the gate is
 * briefed with that outcome handed in, and the brief does not attempt it again.
 *
 * Returns `{lines, next, brief, warnings}`: `lines` the walk's own lines in
 * walk order (`skipped: …`, and a continued gate's `decided: …` and `say: …`);
 * `next` the step due next as the state writer's
 * `next:` line takes it — `{id, title}`, `{id: null}` when only the closing
 * patch is left, `{id: null, stop}` for a gate answered with a stop, or null
 * when nothing is due; `brief` the brief's text when
 * the walk stopped at a step and its brief printed, else null, and then
 * `next` is the step the brief is of; `warnings` whole `warning:` lines for
 * stderr, the walk's writes' and the brief's included.
 */
export function closingWalk({ state, rules, today = null, writer = null, bound = null, brief = null }) {
  const runDir = path.dirname(path.resolve(state));
  const read = () => parse(fs.readFileSync(state, 'utf8'));
  const render = brief ?? ((node, continueOutcome) => nodeBrief({ state, node, rules, continueOutcome }));
  const out = { lines: [], next: null, brief: null, warnings: [] };
  const write = writer ?? (patch => {
    const result = writeState({ state, patch });
    out.warnings.push(...writeWarnings(result));
    return result;
  });
  try {
    let doc = read();
    const held = heldWalk(doc, runDir, today);
    if (held !== undefined) return { ...out, next: held };
    const limit = bound ?? frozenIds(isPlainObject(doc.workflow) ? doc.workflow.nodes : {}).length + 1;
    let left = limit;
    for (;;) {
      const { skipped, stop } = skipWalk({ doc, runDir, writer: write, reread: read, bound: left });
      out.lines.push(...skipped.map(skippedLine));
      left -= skipped.length;
      if (stop.kind === 'due') {
        const outcome = configContinue({ state, node: stop.id });
        if (!outcome.lines) return briefed(out, stop, render, read, runDir, outcome);
        // The gate is recorded continued: its lines in walk order, one turn spent, and on.
        out.lines.push(...outcome.lines);
        left -= 1;
        doc = read();
        continue;
      }
      if (stop.kind === 'refused') out.warnings.push(stop.id === null ? stopped(stop.code ?? stop.error?.message) : skipRefused(stop));
      if (stop.kind === 'bound') out.warnings.push(`warning: next-walk-unsettled: the walk did not settle within ${limit} steps; nothing after the writes above was walked or briefed`);
      break;
    }
  } catch (error) {
    out.warnings.push(stopped(error.message));
  }
  out.next = todaysNext(read, runDir);
  return out;
}

/**
 * Where the run cannot go on from the write, the rows checked before anything
 * is skipped, in this order, the first that matches deciding: the task's
 * ending recorded, a revise not yet applied (the resume orders `gate-revise`
 * first), a gate answered with a stop, a gate pending or a step under way — a
 * sub-run waited on among them — and a definition drifted from the frozen
 * graph. Each returns the `next:` the walk prints — `today` where the write
 * alone prints exactly that, the stop line for a stop, the step due now under
 * drift — or undefined when none matches and the walk goes on.
 */
function heldWalk(doc, runDir, today) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  if (RUN_ENDINGS.has(isPlainObject(doc.task) ? doc.task.status : null)) return today;
  if (openRevision(doc)?.applied === false) return today;
  const stop = stopAnswered(doc, runDir);
  if (stop !== null) return { id: null, stop };
  const pending = isPlainObject(doc.orchestrator) && isPlainObject(doc.orchestrator.gate_pending);
  if (pending || frozenIds(nodes).some(id => isPlainObject(nodes[id]) && ONGOING.has(nodes[id].status))) return today;
  if (reread(doc, workflow, runDir).drift) return dueNext({ doc, runDir });
  return undefined;
}

/**
 * The walk stopped at a step that must run: its brief, rendered in this
 * process, with the config continue's outcome handed in. A brief that refuses
 * or throws leaves the warning and the step due next as the state now reads.
 */
function briefed(out, stop, render, read, runDir, outcome) {
  let result;
  try {
    result = render(stop.id, outcome);
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
