/**
 * Whether a task directory is a run this engine resumes, and what it froze.
 *
 * A resume arrives by three routes — the work command, the run command and a
 * workflow's own command, each given a directory — and every one of them has to
 * answer the same question before anything runs: was this directory written by
 * the engine? A directory whose state carries a `workflow:` block holds a
 * frozen graph and resumes from it. One without the block was written by the
 * 2.x plugin, which kept state by hand: there is no graph to resume and no
 * second interpreter to hand it to, so it is refused, with the one message
 * that says where it can be finished. The message lives here, once, so every route prints the same words.
 *
 * The refusal cannot name the version that wrote the directory: 2.x state never
 * recorded one, so the directory is told apart by its shape alone. Every
 * workflow runs on this engine, so the rule has no exception by workflow: a
 * directory under any type folder that carries no `workflow:` block is a 2.x
 * one. No message here spells a command's namespaced name: this file ships to
 * every host unchanged, and each host names the plugin's commands its own way.
 * The install line it gives is the one for the host this copy ships in, told
 * apart by `SHIPPED_HOST`, which the build records in `lib/host.mjs`: the plugin
 * carries the same name on every host, and the Copilot CLI copy installs from
 * Copilot's shell commands rather than Claude Code's slash commands.
 *
 * A run waiting on a gate is also told what is on disk for that gate, because a
 * session given no stamped line reports where the run stands and may have nothing
 * else to go on: its tools may not list `gates/`, and nothing else names the file
 * an answer sits in. Which answer file can be used is judged here, once, so no
 * prose re-derives it. A record left part-way through is named and never repaired.
 * With no state named, `findWaiting` finds the runs waiting under the project root.
 *
 * It reads the state file and writes nothing in the directory: not the state,
 * not the dashboard, not anything else. Its one write is outside the run and only
 * for a run it accepts: the session's pointer (`display-files.mjs`), so a screen
 * beside a session that resumes a run draws it from here on. A pointer that
 * cannot be written is a warning. Finding runs writes nothing at all, that
 * pointer included. Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { TIMESTAMP, dashboardUrl, legacyMirrorWarning, projectRootOf } from './state.mjs';
import { stamp } from '../../../../lib/canonical.mjs';
import { SHIPPED_HOST } from '../../../../lib/host.mjs';
import { isSetAside, runFolders } from '../../../../lib/run-dirs.mjs';
import { forgetConventionsShown, publishPointer } from './display-files.mjs';
import { openRevision } from './revise.mjs';
import { dueNext, reread } from './gate-brief.mjs';
import { titleOf } from './display.mjs';
import { isTerminalDriver } from './driver.mjs';
import { frozenIds } from './question-triage.mjs';
import { fileURLToPath } from 'node:url';

/** The engine's entry script, which the step and section calls name by its absolute path. */
const ENGINE = fileURLToPath(new URL('../workflow.mjs', import.meta.url));

/** The statuses a node, or the run, has ended in. */
const ENDED = new Set(['completed', 'skipped', 'failed', 'stopped']);
const RUN_ENDED = new Set(['completed', 'failed', 'stopped']);

/** The two sections a driven resume prints in one call. */
export const DRIVEN_SECTION_CALL = 'reference --at="references/gates.md § Driver-suspended mode — the write order" '
  + '--at="references/gates.md § Driver-suspended mode — resume"';

/** A path as a shell reads it: bare, or in single quotes when it holds whitespace. */
function quoted(file) {
  return /\s/.test(file) ? `'${file.replace(/'/g, "'\\''")}'` : file;
}

/**
 * What a resume briefs next, in the order the spec's table lists: `{step, step_title,
 * step_call, section_call}`, each null when nothing is named. Reads the state and the
 * definition only; a due node's guard is not read.
 */
function stepOf({ doc, dir, state, gate, revision }) {
  const none = { step: null, step_title: null, step_call: null };
  const task = isPlainObject(doc.task) ? doc.task : {};
  if (RUN_ENDED.has(task.status)) return { ...none, section_call: null };
  if (gate) return { ...none, section_call: null };
  const section_call = isTerminalDriver(doc) ? null : `node ${quoted(ENGINE)} ${DRIVEN_SECTION_CALL}`;
  if (revision && revision.applied === false) return { ...none, section_call };
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const entry = id => (isPlainObject(recorded[id]) ? recorded[id] : {});
  const started = frozenIds(recorded).filter(id => {
    const status = entry(id).status ?? 'pending';
    return status !== 'pending' && !ENDED.has(status);
  });
  const subrun = started.find(id => entry(id).kind === 'workflow');
  const id = subrun ?? started[0] ?? dueNext({ doc, runDir: dir })?.id ?? null;
  if (id === null) return { ...none, section_call };
  const verb = subrun === id ? 'subrun-handoff' : 'node-brief';
  return {
    step: id,
    step_title: titleOf(reread(doc, workflow, dir).display.titles, id),
    step_call: `node ${quoted(ENGINE)} ${verb} --state=${quoted(path.resolve(state))} --node=${id}`,
    section_call,
  };
}

/** The 2.x line's install commands, per host. */
const INSTALL_2X = {
  claude: '`/plugin marketplace add SkillPanel/maister#release/2.x`, then `/plugin install maister@maister-plugins-2x` '
    + '(uninstall any other maister channel first, for example `/plugin uninstall maister@maister-plugins`). ',
  copilot: '`copilot plugin marketplace add SkillPanel/maister#release/2.x`, then '
    + '`copilot plugin install maister-copilot@maister-plugins-2x` (uninstall any other maister channel first, '
    + 'for example `copilot plugin uninstall maister@maister-plugins`). ',
};

/** The oldest Node.js major release the engine runs on. */
export const NODE_MAJOR = 20;

/** The marker a run that cannot start for want of Node.js ends on. */
export const NODE_UNAVAILABLE = 'RUN-FAILED: node-unavailable';

/**
 * Whether the Node.js running the engine is too old for it: null when it is
 * `NODE_MAJOR` or newer, else `{marker, message}` — the marker for stdout and
 * the message, with the 2.x line's install commands for this host, for stderr.
 * `locate` and `resume-check`, the first verbs a start and a resume run, print
 * it in place of their result and exit 1, before anything is read or written.
 * It is a marker and not a refusal: the run never began, so there is no code
 * for a driver to recover from, only an install to change.
 *
 * `version` is `process.versions.node` unless given, which is how a test fakes
 * an older one; no flag takes it. A version that cannot be read is let through:
 * the check only refuses a release it knows is too old.
 */
export function nodeUnavailable(version = process.versions.node) {
  const major = Number.parseInt(String(version).replace(/^v/, ''), 10);
  if (!Number.isFinite(major) || major >= NODE_MAJOR) return null;
  return {
    marker: NODE_UNAVAILABLE,
    message: [
      `This workflow needs Node.js ${NODE_MAJOR} or newer, and this is Node.js ${String(version).replace(/^v/, '')}. `,
      `Nothing was written. Install Node.js ${NODE_MAJOR} or newer and run the command again; an install that cannot run it `,
      'stays on the 2.x line: ',
      (INSTALL_2X[SHIPPED_HOST] ?? INSTALL_2X.claude).trimEnd(),
    ].join(''),
  };
}

/**
 * What an operator reads when a 2.x directory is offered for resume, with the
 * install line for the host this copy ships for.
 */
export function writtenBy2x() {
  return [
    'This task was started on the maister 2.x plugin — its `orchestrator-state.yml` has no `workflow:` block — ',
    'and maister 3.0 does not resume it. Nothing in the directory was changed, and its artifacts are still ',
    'readable in place. To finish it, install the 2.x line and resume it there: ',
    INSTALL_2X[SHIPPED_HOST] ?? INSTALL_2X.claude,
    'To start the work over on 3.0, run the command again without a task path; a development, research or product design run ',
    'started with `--context=<this task directory>` reads this task\'s files as background.',
  ].join('');
}

/**
 * Judge the run whose state file is `state`.
 *
 * Returns `{ok: true, workflow: {name, overlays, profile}, title, status, driver_kind,
 * task_path, root, dashboard, revision?, gate?}` for a run the engine froze — `root`
 * the run's checkout, derived from where the state file is (`runRoot`) — `driver_kind`
 * the kind its driver records, or null — `revision` only while a gate's revise is open
 * (`openRevision`) — `gate` only while a gate is pending (`waitingGate`) — `dashboard`
 * the `file://` link a resume shows the operator once, or null when the run has none —
 * or `{ok: false, code, message, next}` for one it does not resume; both carry `next`, one string saying what to do now.
 *
 * A run whose context block still carries the retired phase-summary mirror
 * resumes all the same; the result then carries `warnings`, the one
 * `legacy-mirror-ignored` line (`legacyMirrorWarning`), which the verb prints
 * on stderr and keeps out of the JSON. A session pointer that could not be
 * written is a line there too, and so is a conventions marker that could not
 * be removed: an accepted resume removes this session's, so the run's next
 * `node-brief` prints the node conventions whole.
 */
export function resumeCheck({ state }) {
  const dir = path.dirname(path.resolve(state));
  if (isSetAside(dir)) {
    return refuse('run-set-aside',
      `${dir} is a copy set aside beside a run — a folder named \`<run>.moved-<digits>\` is kept after the run moved, `
      + 'one named `<run>.failed-<digits>` after a rollback — not a run, so it is not resumed. Nothing was changed. '
      + 'Resume the run from its own directory, the same path without the suffix, on the machine that holds it.');
  }

  let raw;
  try {
    raw = fs.readFileSync(state, 'utf8');
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read: ${err.message}`);
  }

  let doc;
  try {
    doc = parse(raw);
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read as a state document: ${err.message}`);
  }

  const workflow = doc.workflow;
  if (!isPlainObject(workflow)) return refuse('written-by-2x', writtenBy2x());

  if (typeof workflow.name !== 'string' || workflow.name === '') {
    return refuse('state-unreadable', `${state} carries a workflow block with no name, so there is no workflow to resume`);
  }
  const task = isPlainObject(doc.task) ? doc.task : {};
  const revision = openRevision(doc);
  const mirror = legacyMirrorWarning(doc);
  const root = runRoot(doc, dir);
  const gate = waitingGate(doc, dir);
  const warnings = [
    ...(mirror === null ? [] : [mirror]),
    ...publishPointer({ runDir: dir, root, now: stamp() })
      .map(({ file, code, message }) => `${file} was not written (${code}: ${message}); the resume check is unaffected`),
    // A resumed run's next brief prints the node conventions whole again.
    ...forgetConventionsShown({ root })
      .map(({ file, code, message }) => `${file} was not removed (${code}: ${message}); the resume check is unaffected`),
  ];
  const dashboard = dashboardUrl(doc, dir);
  const next = [
    ...(revision && revision.applied === false
      ? [`run gate-revise --node=${revision.gate} --option=${revision.option} with the note before anything else`] : []),
    ...(dashboard === null || dashboard === undefined ? [] : [`show Dashboard: ${dashboard} once; run no opener`]),
    gate ? 'a gate is pending: take the first line through references/gates.md § Driver-suspended mode — resume'
      : 'resume the ready set from the frozen graph; a node update goes under the patch\'s top-level nodes, never under workflow',
  ].join('; ');
  return {
    ok: true,
    workflow: {
      name: workflow.name,
      overlays: Array.isArray(workflow.overlays) ? workflow.overlays.map(String) : [],
      profile: workflow.profile ?? null,
    },
    title: typeof task.title === 'string' ? task.title : null,
    status: typeof task.status === 'string' ? task.status : null,
    driver_kind: driverKindOf(doc),
    task_path: dir,
    root,
    dashboard,
    // Additive, and only while a gate's revise is open: a resume that finds it
    // not yet applied runs `gate-revise` before it walks the ready set.
    ...(revision ? { revision: { gate: revision.gate, option: revision.option, reruns: revision.reruns, revision: revision.revision, applied: revision.applied } } : {}),
    ...(gate ? { gate } : {}),
    ...stepOf({ doc, dir, state, gate, revision }),
    next,
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * The runs under the project root `root` waiting on a gate, for a session that
 * was told no run. Always `{ok: true, root, waiting, unreadable?}`: none, one and
 * several are each an answer, not a refusal. Each entry of `waiting` carries the
 * whole `gate`, so one run found needs no second call. A state with no `workflow:`
 * block is no run of this engine and is left unparsed; one that cannot be read may
 * be waiting, so it is named under `unreadable` rather than taken as not waiting.
 *
 * Writes nothing: no pointer, because no run was chosen.
 */
export function findWaiting({ root }) {
  const waiting = [];
  const unreadable = [];
  for (const dir of runFolders(root)) {
    const state = path.join(dir, 'orchestrator-state.yml');
    try {
      const raw = fs.readFileSync(state, 'utf8');
      if (!/^workflow:/m.test(raw)) continue;
      const doc = parse(raw);
      const gate = waitingGate(doc, dir);
      if (!gate) continue;
      const task = isPlainObject(doc.task) ? doc.task : {};
      waiting.push({
        task_path: dir,
        state,
        title: typeof task.title === 'string' ? task.title : null,
        status: typeof task.status === 'string' ? task.status : null,
        driver_kind: driverKindOf(doc),
        gate,
      });
    } catch (err) {
      if (err.code !== 'ENOENT') unreadable.push({ task_path: dir, message: `${state} cannot be read: ${err.message}` });
    }
  }
  return { ok: true, root: path.resolve(root), waiting, ...(unreadable.length ? { unreadable } : {}) };
}

/** The kind of driver a run records, or null. */
function driverKindOf(doc) {
  const driver = isPlainObject(doc.orchestrator) ? doc.orchestrator.driver : null;
  return isPlainObject(driver) && typeof driver.kind === 'string' && driver.kind !== '' ? driver.kind : null;
}

/**
 * What is on disk for the gate a run waits on, or null when it waits on none:
 * `{node, request, asked_at, answer_state, answer_files, part_recorded?}`. `answer_state` is the verdict a
 * session chooses its words from: `none` with no answer file, `one` or `several`
 * by how many are usable, `unusable` with files of which none is. Files stay on
 * disk after a revise asks the gate again, so a usable file beside an earlier
 * round's still reads `one`.
 *
 * `part_recorded` is there only when a fold stopped before its last write: the
 * marker is cleared last, so a marker still set beside an answer block in the
 * request or a completed node is a record part-way through, and the verdict alone
 * would read as a clean wait. It lists what is already written.
 */
function waitingGate(doc, dir) {
  const pending = isPlainObject(doc.orchestrator) ? doc.orchestrator.gate_pending : null;
  if (!isPlainObject(pending) || typeof pending.node !== 'string') return null;
  const { node } = pending;
  const gates = path.join(dir, 'gates');
  const request = `${node}.request.yml`;
  const held = readRequest(path.join(gates, request));
  const askedAt = askedAtOf(held);
  const files = answerFileNames(gates, node).map(file => judgeAnswerFile(gates, file, askedAt));
  const usable = files.filter(each => each.usable).length;
  const written = partRecorded(doc, node, held);
  return {
    node,
    request: `gates/${request}`,
    asked_at: askedAt,
    answer_state: files.length === 0 ? 'none' : usable === 0 ? 'unusable' : usable === 1 ? 'one' : 'several',
    answer_files: files,
    ...(written.length ? { part_recorded: written } : {}),
  };
}

/** The parsed request, or null when it cannot be read. */
function readRequest(file) {
  try {
    return parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The request's `asked_at`, or null when the request cannot be read or holds no valid one. */
function askedAtOf(request) {
  const askedAt = request?.asked_at;
  return typeof askedAt === 'string' && TIMESTAMP.test(askedAt) ? askedAt : null;
}

/** What a fold has already written for a gate whose marker is still set. */
function partRecorded(doc, node, request) {
  const entry = isPlainObject(doc.workflow?.nodes) ? doc.workflow.nodes[node] : null;
  return [
    ...(request?.answer !== null && request?.answer !== undefined ? ['answer-block'] : []),
    ...(isPlainObject(entry) && entry.status === 'completed' ? ['node-completed'] : []),
  ];
}

/** The names of the answer files beside a node's request, `<node>.answer.<actor>.yml`, sorted. */
function answerFileNames(gates, node) {
  try {
    return fs.readdirSync(gates).filter(name => name.startsWith(`${node}.answer.`) && name.endsWith('.yml')).sort();
  } catch {
    return [];
  }
}

/** One answer file as a session is told it: its name and path, what it holds, whether it can be used. */
function judgeAnswerFile(gates, file, askedAt) {
  const named = { file, path: path.join(gates, file) };
  let doc;
  try {
    doc = parse(fs.readFileSync(named.path, 'utf8'));
  } catch {
    return { ...named, usable: false, reason: 'it cannot be read' };
  }
  const answer = isPlainObject(doc) && isPlainObject(doc.answer) ? doc.answer : null;
  if (answer === null) return { ...named, usable: false, reason: 'it holds no answer' };
  const held = Object.fromEntries(['option', 'answers', 'answered_by', 'at']
    .filter(key => answer[key] !== undefined && answer[key] !== null)
    .map(key => [key, answer[key]]));
  const reason = whyUnusable(answer, askedAt);
  return reason === null ? { ...named, usable: true, ...held } : { ...named, usable: false, reason, ...held };
}

/**
 * Why an answer block cannot be used, in words a person can be shown; null when it
 * can. A valid `at` not earlier than the request's `asked_at` is what ties an
 * answer to the question now being asked, and nothing else can supply it.
 */
function whyUnusable(answer, askedAt) {
  if (typeof answer.answered_by !== 'string' || answer.answered_by === '') return 'it does not say who answered';
  if (typeof answer.at !== 'string' || !TIMESTAMP.test(answer.at)) return 'it does not say when it was answered, as a UTC time';
  const chosen = (typeof answer.option === 'string' && answer.option !== '')
    || (isPlainObject(answer.answers) && Object.keys(answer.answers).length > 0);
  if (!chosen) return 'it holds no choice';
  if (askedAt === null) return 'the question it answers cannot be read';
  return answer.at < askedAt ? 'it is earlier than the question now being asked' : null;
}

/**
 * The run's checkout, from where its state file is and from nothing else:
 * `orchestrator.driver.cwd` names the directory the run was started in, which a
 * run moved to another machine no longer has. The root is the one the freeze
 * took (`projectRootOf`): the folder holding the `.maister/` the run sits in,
 * whichever run folder that is, with the run's parent link for a child placed
 * outside any. The umbrella's run listing reports the same root through the facade.
 */
export function runRoot(doc, dir) {
  const parent = isPlainObject(doc.orchestrator) ? doc.orchestrator.parent : null;
  return projectRootOf(dir, isPlainObject(parent) ? parent : null);
}

function refuse(code, message) {
  return { ok: false, code, message, next: 'relay the message verbatim and stop; write nothing, create no task directory, print no marker' };
}
