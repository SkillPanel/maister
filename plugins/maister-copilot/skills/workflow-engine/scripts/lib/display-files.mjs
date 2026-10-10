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
 *   task, the phase by `phaseOf`'s rule, the next checkpoint by
 *   `checkpointOf`'s, the run's status, `line`, the status line composed, when
 *   the run started, the nodes — each one's title and status, and the ones
 *   this write changed — the artifact paths the nodes declare, relative to
 *   the run directory, and `parts`: the parts of the phase under way, when it
 *   has any — the implementation plan's task groups, or the reviews the
 *   verification phase dispatched — one state each and a line composed to
 *   name them.
 * - `<run>/display/banner.json`, from the freeze: the start banner's lines, the
 *   ones the freeze prints for the model, without the line addressed to it, and
 *   the same facts as fields, for a reader that draws a card of its own.
 * - `<run>/display/next.json`, from `gate-brief`: the checkpoint's panel, the
 *   question it belongs to and the glance fitted to the rows a panel above that
 *   question holds (`panelOf` in `checkpoint.mjs`) — or, for a question set a
 *   step asks, the step, its place among the phases, the first question's
 *   header and the count (`questionPanelOf`), its `kind` saying which. Every
 *   state write removes it: a write after a brief means its gate or its set
 *   was answered or sent back.
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
 * and the model reading those paths has no use for them. Nor does any of them
 * show in the project's `git status`: each display directory carries a
 * `.gitignore` of its own that ignores everything in it.
 *
 * No stdio. Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as canonical from '../../../../lib/canonical.mjs';
import { isPlainObject } from './state-read.mjs';
import { humanize, titleOf } from './display.mjs';
import { HELD_APPROVAL } from './question-triage.mjs';

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

/** A display directory's own `.gitignore`: everything in it, itself included. */
const IGNORE_ALL = '*\n';

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

/** The node statuses of a phase under way. */
const ONGOING = new Set(['running', 'waiting', 'suspended']);

/** The states a part can be in. */
const PART_STATES = new Set(['done', 'running', 'reverted', 'skipped', 'to_run']);

/** The node statuses after which a gate is behind the run. */
const SETTLED = new Set(['completed', 'skipped']);

/**
 * The phase a run is in, by the one rule every display file uses: the frozen
 * nodes in frozen order, less its gates — a checkpoint is not a phase. `total`
 * counts those, and holds for the whole run: a node recorded skipped keeps its
 * place, and `skipped` lists the places of those, counted from one, so a
 * reader can draw it apart from one done or one still to come. The current
 * phase is the first under way; when none is — the run waits at a checkpoint,
 * or has just started or finished — it is the last one completed, or else the
 * first not skipped. `index` is its place, `title` its title; both are null
 * only for a run with no phase at all.
 *
 * Never a pending node after a completed one: a guard may skip it, and only
 * the brief's walk knows, so naming it would name work that never runs.
 */
export function phaseOf(doc, titles) {
  const { phases, at, nodes } = currentPhase(doc);
  if (!phases.length) return { index: null, total: 0, title: null, skipped: [] };
  const skipped = phases.flatMap((id, place) => (nodes[id].status === 'skipped' ? [place + 1] : []));
  return { index: at + 1, total: phases.length, title: titleOf(titles, phases[at]), skipped };
}

/** The phases `phaseOf` counts, and the place of the current one among them. */
function currentPhase(doc) {
  const nodes = nodesOf(doc);
  const phases = Object.keys(nodes).filter(id => nodes[id].kind !== 'gate');
  let at = phases.findIndex(id => ONGOING.has(nodes[id].status));
  if (at === -1) at = phases.findLastIndex(id => nodes[id].status === 'completed');
  if (at === -1) at = phases.findIndex(id => nodes[id].status !== 'skipped');
  if (at === -1) at = 0;
  return { phases, at, nodes };
}

/**
 * The checkpoint the run reaches next: the first frozen gate neither completed
 * nor skipped, `index` its place among all the frozen gates and `total` their
 * count — the numbering a gate's brief uses. Null once no gate is left. The
 * reserved closing checkpoint's status entry is no frozen gate: it is never
 * counted, and never the next checkpoint.
 */
export function checkpointOf(doc, titles) {
  const nodes = nodesOf(doc);
  const gates = Object.keys(nodes).filter(id => id !== HELD_APPROVAL && nodes[id].kind === 'gate');
  const at = gates.findIndex(id => !SETTLED.has(nodes[id].status));
  if (at === -1) return null;
  return { index: at + 1, total: gates.length, title: titleOf(titles, gates[at]) };
}

/**
 * Publish the run's display files after a state write: the status, the banner
 * when this write was the freeze, the session's pointer, and the removal of a
 * gate's panel the write has answered. `doc` is the committed state, parsed;
 * `banner` the freeze's banner (`{lines, ...fields}`) or null; `dashboard` the
 * run's link or null; `artifacts` the declared artifact paths, run-relative;
 * `progress` the implementation progress keyed by its node, as the dashboard
 * projects it; `verifier` the node that runs the reviews, or null.
 * Returns the warnings, `{file, code, message}` each.
 */
export function publishRun({ runDir, root, doc, now, titles, dashboard, artifacts = [], progress = {}, verifier = null, banner = null, session = process.env[SESSION_ENV] }) {
  const warnings = [];
  const dir = path.join(runDir, DISPLAY_DIR);
  attempt(warnings, `${DISPLAY_DIR}/${NEXT}`, () => remove(path.join(dir, NEXT)));
  const started = banner !== null ? now : startedOf(dir, doc);
  const before = previousNodes(dir);
  attempt(warnings, `${DISPLAY_DIR}/${STATUS}`, () => publish(dir, STATUS, statusOf({ runDir, doc, now, titles, dashboard, artifacts, progress, verifier, started, before })));
  if (banner !== null) {
    const { lines, ...card } = banner;
    attempt(warnings, `${DISPLAY_DIR}/${BANNER}`, () => publish(dir, BANNER, { version: VERSION, frozen: now, lines, ...card }));
  }
  if (typeof session === 'string' && SESSION_ID.test(session)) {
    const file = `${session}.json`;
    attempt(warnings, path.join(SESSIONS_DIR, file).split(path.sep).join('/'),
      () => publish(path.join(root, SESSIONS_DIR), file, { version: VERSION, run_dir: runDir, updated: now }, path.dirname(path.join(root, SESSIONS_DIR))));
  }
  return warnings;
}

/**
 * Publish a brief's panel: `{node, header, question, glance, parts}`, a gate's
 * unless the panel names its own `kind`. Returns the warnings, as `publishRun`
 * does.
 */
export function publishNext({ runDir, panel }) {
  const warnings = [];
  attempt(warnings, `${DISPLAY_DIR}/${NEXT}`, () => publish(path.join(runDir, DISPLAY_DIR), NEXT, { version: VERSION, kind: 'gate', ...panel }));
  return warnings;
}

/**
 * The status file's document, its `line` composed for a status line to show as
 * it stands. Beside it: when the run started, the checkpoint it reaches next,
 * every frozen node's title and status, the nodes this write changed against
 * the status file it replaces (`saved`), whether a gate is under way now, the
 * declared artifact paths (`artifacts`) and the running phase's `parts`.
 */
function statusOf({ runDir, doc, now, titles, dashboard, artifacts, progress, verifier, started, before }) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const task = isPlainObject(doc.task) ? doc.task : {};
  const name = typeof workflow.name === 'string' && workflow.name !== '' ? humanize(workflow.name) : 'Workflow';
  const title = typeof task.title === 'string' ? task.title.replace(/\s+/g, ' ').trim() : '';
  const status = typeof task.status === 'string' && task.status !== '' ? task.status : null;
  const phase = phaseOf(doc, titles);
  let where = status ?? 'not started';
  if (!ENDINGS.has(status) && phase.title) where = `phase ${phase.index}/${phase.total} · ${phase.title}`;
  const line = [name, where, ...(title ? [clip(title, TASK_MAX)] : [])].join(' · ');
  const nodes = {};
  for (const [id, entry] of Object.entries(nodesOf(doc))) {
    nodes[id] = { title: titleOf(titles, id), status: typeof entry.status === 'string' ? entry.status : 'pending' };
  }
  const saved = before === null ? [] : Object.entries(nodes)
    .filter(([id, node]) => before[id]?.status !== node.status)
    .map(([id, node]) => ({ node: id, title: node.title, status: node.status }));
  const gateOpen = Object.values(nodesOf(doc)).some(entry => entry.kind === 'gate' && ONGOING.has(entry.status));
  return {
    version: VERSION,
    workflow: name,
    task: title || null,
    phase,
    checkpoint: checkpointOf(doc, titles),
    status,
    line,
    run_dir: runDir,
    run_url: pathToFileURL(runDir).href,
    dashboard,
    started,
    nodes,
    saved,
    gate_open: gateOpen,
    artifacts,
    parts: partsOf(doc, progress, verifier),
    updated: now,
  };
}

/**
 * The parts of the phase under way, or null: the current phase by `phaseOf`'s
 * rule, while it runs, when it has parts to show — the implementation plan's
 * groups from `progress`, or the reviews the verifier recorded it dispatched
 * (`verification_context.reviews`). Each part carries one state, and `line`
 * names them, its counts adding up to the total.
 */
function partsOf(doc, progress, verifier) {
  const nodes = nodesOf(doc);
  const { phases, at } = currentPhase(doc);
  const node = phases[at];
  if (node === undefined || !ONGOING.has(nodes[node].status)) return null;
  const derived = isPlainObject(progress) && Object.hasOwn(progress, node) ? progress[node] : null;
  if (isPlainObject(derived) && Array.isArray(derived.groups) && derived.groups.length) return groupParts(node, derived);
  const reviewer = verifier ?? (Object.hasOwn(nodes, 'verification') ? 'verification' : null);
  if (node === reviewer) return reviewParts(node, doc.verification_context);
  return null;
}

/** The task groups as parts: `groups 3 of 7 done · 2 running in wave 2 · 2 to run`. */
function groupParts(node, derived) {
  const items = derived.groups.map(group => ({ state: PART_STATES.has(group?.state) ? group.state : 'to_run' }));
  const count = state => items.filter(item => item.state === state).length;
  const wave = Number.isInteger(derived.running_wave) ? derived.running_wave : null;
  const terms = [`groups ${count('done')} of ${items.length} done`];
  if (count('running')) terms.push(`${count('running')} running${wave === null ? '' : ` in wave ${wave}`}`);
  if (count('reverted')) terms.push(`${count('reverted')} reverted`);
  if (count('skipped')) terms.push(`${count('skipped')} skipped`);
  if (count('to_run')) terms.push(`${count('to_run')} to run`);
  return { node, kind: 'groups', wave, items, line: terms.join(' · ') };
}

/** The reviews as parts: `reviews 2 of 5 done · 3 running: pragmatic, reality check, production readiness`. */
function reviewParts(node, context) {
  const reviews = isPlainObject(context) && isPlainObject(context.reviews) ? context.reviews : {};
  const names = list => (Array.isArray(list) ? list.filter(name => typeof name === 'string' && name.trim() !== '').map(name => name.trim()) : []);
  const chosen = [...new Set(names(reviews.chosen))];
  if (!chosen.length) return null;
  const done = new Set(names(reviews.done));
  const items = chosen.map(name => ({ name, state: done.has(name) ? 'done' : 'running' }));
  const running = items.filter(item => item.state === 'running').map(item => item.name);
  const terms = [`reviews ${items.length - running.length} of ${items.length} done`];
  if (running.length) terms.push(`${running.length} running: ${running.join(', ')}`);
  return { node, kind: 'reviews', wave: null, items, line: terms.join(' · ') };
}

/** The frozen nodes, each a plain object. */
function nodesOf(doc) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  return Object.fromEntries(Object.entries(nodes).map(([id, entry]) => [id, isPlainObject(entry) ? entry : {}]));
}

/**
 * When a run that is not freezing now started: the freeze stamp its banner file
 * holds, else the earliest node start the state records, else null.
 */
function startedOf(dir, doc) {
  const frozen = readDisplay(path.join(dir, BANNER))?.frozen;
  if (typeof frozen === 'string') return frozen;
  const stamps = Object.values(nodesOf(doc)).map(entry => entry.started).filter(stamp => typeof stamp === 'string').sort();
  return stamps[0] ?? null;
}

/** The node map of the status file this write replaces; null when there is none to compare with. */
function previousNodes(dir) {
  const nodes = readDisplay(path.join(dir, STATUS))?.nodes;
  return isPlainObject(nodes) ? nodes : null;
}

/** One of the run's own display files, parsed; null when it is missing or unreadable. */
function readDisplay(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * One display file, `name` in `dir`, written whole through the shared publish
 * path under its own temp name. `home` — `dir` unless given — first gets a
 * `.gitignore` of its own that ignores everything, itself included: what a
 * display directory holds belongs to this machine and this session, so none of
 * it ever shows in the project's `git status`.
 */
function publish(dir, name, document, home = dir) {
  ignoreAll(home);
  const target = path.join(dir, name);
  canonical.commit({ target, text: `${JSON.stringify(document, null, 2)}\n`, tmp: `${target}.tmp`, codes: CODES });
}

/** `dir/.gitignore` holding `*`, written once and never over a file already there. */
function ignoreAll(dir) {
  const file = path.join(dir, '.gitignore');
  if (fs.existsSync(file)) return;
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(file, IGNORE_ALL, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
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
