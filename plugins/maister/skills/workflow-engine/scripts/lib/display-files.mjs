/**
 * The run's display files: what a screen beside the session draws, written by
 * the engine so nothing that draws it has to work anything out.
 *
 * Why this module exists. A gate's context and a run's progress reached the
 * operator only through what the orchestrating model chose to write, and runs
 * showed it skipping both: the start banner sat in a collapsed tool result, a
 * checkpoint's context was written at some gates and not at others. An editor
 * extension can draw them where the model cannot leave them out — beside the
 * prompt, above the question — but only if it is handed them whole. One that
 * found the run by reading the model's shell commands, or counted phases for
 * itself, broke on the first command quoted differently and counted gates as
 * phases. So the engine writes small files, already composed, and a reader
 * draws them as they stand.
 *
 * The files:
 *
 * - `<run>/display/status.json`, from every state write: the workflow, the
 *   task, the phase by `phaseOf`'s rule, the run's status, and `line`, the
 *   status line composed.
 * - `<run>/display/banner.json`, from the freeze: the start banner's lines, the
 *   ones the freeze prints for the model, without the line addressed to it.
 * - `<run>/display/next.json`, from `gate-brief`: the checkpoint's panel, the
 *   question it belongs to and the glance fitted to the rows a panel above that
 *   question holds (`panelOf` in `checkpoint.mjs`). Every state write removes it:
 *   a write after a brief means its gate was answered or sent back.
 * - `<project>/.maister/display/sessions/<session id>.json`, from every state
 *   write: the run this session wrote last. A reader knows its own session and
 *   nothing else, so this is how it finds the run. It is keyed by the session
 *   because the session is its caller: one fixed file for the project would be
 *   shared by two sessions running two workflows there, and each would draw the
 *   other's run. Without a session id — no host that sets one — none is written.
 *
 * Every write here is a projection of something that already landed, so a
 * failure is a warning and never a refusal, on the dashboard's terms: the state
 * write or the brief stands, and the warning names the file. None of these
 * files is reported among a write's changed paths: they are for the screen,
 * and the model reading those paths has no use for them.
 *
 * No stdio. Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as canonical from '../../../../lib/canonical.mjs';
import { isPlainObject } from './state-read.mjs';
import { humanize, titleOf } from './display.mjs';

/** The directory beside the state file that holds a run's display files. */
export const DISPLAY_DIR = 'display';

/** The three files of a run, by what they hold. */
export const STATUS = 'status.json';
export const BANNER = 'banner.json';
export const NEXT = 'next.json';

/** Where a session's run pointer lives, under the project root. */
export const SESSIONS_DIR = path.join('.maister', 'display', 'sessions');

/** The environment variable a host names its session in, and the shape an id must have to name a file. */
const SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The format every display file declares, for a reader to refuse one it does not know. */
const VERSION = 1;

/**
 * The two codes a display write can fail with — injected into the shared
 * publish path as the dashboard's are, and never leaving this module as
 * refusals: each becomes a warning.
 */
const CODES = { unwritable: 'display-unwritable', tempExists: 'display-temp-exists' };

/** The run statuses after which the status line names how the run ended rather than a phase. */
const ENDINGS = new Set(['completed', 'failed', 'stopped']);

/** How long the task may run in the status line before it is cut. */
const TASK_MAX = 60;

/**
 * The phase a run is in, by the one rule every display file uses: the frozen
 * nodes in frozen order, less its gates — a checkpoint is not a phase — and less
 * the nodes recorded skipped, which the run will not run. `total` counts those;
 * the current phase is the first of them not completed, `index` its place among
 * them. When none is left, `index` is the total and `title` null.
 *
 * A guarded node still pending is counted until it is recorded skipped: the
 * total is what the run may still run, and it shrinks as guards settle.
 */
export function phaseOf(doc, titles) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const phases = Object.keys(nodes).filter(id => {
    const entry = isPlainObject(nodes[id]) ? nodes[id] : {};
    return entry.kind !== 'gate' && entry.status !== 'skipped';
  });
  const at = phases.findIndex(id => (isPlainObject(nodes[id]) ? nodes[id].status : undefined) !== 'completed');
  if (at === -1) return { index: phases.length, total: phases.length, title: null };
  return { index: at + 1, total: phases.length, title: titleOf(titles, phases[at]) };
}

/**
 * Publish the run's display files after a state write: the status, the banner
 * when this write was the freeze, the session's pointer, and the removal of a
 * gate's panel the write has answered. `doc` is the committed state, parsed;
 * `banner` the banner's lines or null; `dashboard` the run's link or null.
 * Returns the warnings, `{file, code, message}` each.
 */
export function publishRun({ runDir, root, doc, now, titles, dashboard, banner = null, session = process.env[SESSION_ENV] }) {
  const warnings = [];
  const dir = path.join(runDir, DISPLAY_DIR);
  attempt(warnings, `${DISPLAY_DIR}/${NEXT}`, () => remove(path.join(dir, NEXT)));
  attempt(warnings, `${DISPLAY_DIR}/${STATUS}`, () => publish(path.join(dir, STATUS), statusOf({ runDir, doc, now, titles, dashboard })));
  if (banner !== null) {
    attempt(warnings, `${DISPLAY_DIR}/${BANNER}`, () => publish(path.join(dir, BANNER), { version: VERSION, frozen: now, lines: banner }));
  }
  if (typeof session === 'string' && SESSION_ID.test(session)) {
    const file = path.join(SESSIONS_DIR, `${session}.json`);
    attempt(warnings, file.split(path.sep).join('/'), () => publish(path.join(root, file), { version: VERSION, run_dir: runDir, updated: now }));
  }
  return warnings;
}

/**
 * Publish a gate's panel: `{node, header, question, glance}` from the brief.
 * Returns the warnings, as `publishRun` does.
 */
export function publishNext({ runDir, panel }) {
  const warnings = [];
  attempt(warnings, `${DISPLAY_DIR}/${NEXT}`, () => publish(path.join(runDir, DISPLAY_DIR, NEXT), { version: VERSION, kind: 'gate', ...panel }));
  return warnings;
}

/** The status file's document, its `line` composed for a status line to show as it stands. */
function statusOf({ runDir, doc, now, titles, dashboard }) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const task = isPlainObject(doc.task) ? doc.task : {};
  const name = typeof workflow.name === 'string' && workflow.name !== '' ? humanize(workflow.name) : 'Workflow';
  const title = typeof task.title === 'string' ? task.title.replace(/\s+/g, ' ').trim() : '';
  const status = typeof task.status === 'string' && task.status !== '' ? task.status : null;
  const phase = phaseOf(doc, titles);
  const where = ENDINGS.has(status)
    ? status
    : `phase ${phase.index}/${phase.total}${phase.title ? ` · ${phase.title}` : ''}`;
  const line = [name, where, ...(title ? [clip(title, TASK_MAX)] : [])].join(' · ');
  return { version: VERSION, workflow: name, task: title || null, phase, status, line, run_dir: runDir, dashboard, updated: now };
}

/** One display file, written whole through the shared publish path under its own temp name. */
function publish(target, document) {
  canonical.commit({ target, text: `${JSON.stringify(document, null, 2)}\n`, tmp: `${target}.tmp`, codes: CODES });
}

/** A display file removed; already absent is fine. */
function remove(target) {
  try {
    fs.rmSync(target, { force: true });
  } catch (err) {
    throw new canonical.Refusal(CODES.unwritable, `${target} could not be removed: ${err.message}`);
  }
}

/**
 * Run one display write, turning any failure into a warning for `file`. A
 * refusal's message opens with its code, which the warning carries as a field,
 * so the prefix is stripped rather than printed twice.
 */
function attempt(warnings, file, write) {
  try {
    write();
  } catch (err) {
    const code = err instanceof canonical.Refusal ? err.code : CODES.unwritable;
    const raw = err && err.message ? String(err.message) : String(err);
    const prefix = `${code}: `;
    warnings.push({ file, code, message: raw.startsWith(prefix) ? raw.slice(prefix.length) : raw });
  }
}

/** `text` cut at a word to at most `max` characters, an ellipsis marking the cut. */
function clip(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}
