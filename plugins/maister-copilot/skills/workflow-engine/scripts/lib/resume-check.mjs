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
 * apart by the plugin's own manifest name: the Copilot CLI variant renames
 * itself, and installs from Copilot's shell commands rather than Claude Code's
 * slash commands.
 *
 * A run waiting on a gate is also told what is on disk for that gate, because a
 * session given no stamped line may have nothing else to go on: its tools may
 * not list `gates/`, and nothing else names the file an answer sits in. Which
 * answer file can be used is judged here, once, so no prose re-derives it. With
 * no state named, `findWaiting` finds the runs waiting under the project root.
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
import { fileURLToPath } from 'node:url';
import { parse, isPlainObject } from './state-read.mjs';
import { TIMESTAMP, childRootOf, dashboardUrl, legacyMirrorWarning, projectRootOf } from './state.mjs';
import { stamp } from '../../../../lib/canonical.mjs';
import { isSetAside, runFolders } from '../../../../lib/run-dirs.mjs';
import { publishPointer } from './display-files.mjs';
import { openRevision } from './revise.mjs';

/** The manifest name the Copilot CLI variant carries. */
const COPILOT_VARIANT = 'maister-copilot';

/** The 2.x line's install commands, per host. */
const INSTALL_2X = {
  claude: '`/plugin marketplace add SkillPanel/maister#release/2.x`, then `/plugin install maister@maister-plugins-2x` '
    + '(uninstall any other maister channel first, for example `/plugin uninstall maister@maister-plugins`). ',
  copilot: '`copilot plugin marketplace add SkillPanel/maister#release/2.x`, then '
    + '`copilot plugin install maister-copilot@maister-plugins-2x` (uninstall any other maister channel first, '
    + 'for example `copilot plugin uninstall maister-copilot@maister-plugins`). ',
};

/**
 * What an operator reads when a 2.x directory is offered for resume, with the
 * install line for the plugin named `pluginName` (this copy's own by default).
 */
export function writtenBy2x(pluginName = ownPluginName()) {
  return [
    'This task was started on the maister 2.x plugin — its `orchestrator-state.yml` has no `workflow:` block — ',
    'and maister 3.0 does not resume it. Nothing in the directory was changed, and its artifacts are still ',
    'readable in place. To finish it, install the 2.x line and resume it there: ',
    INSTALL_2X[pluginName === COPILOT_VARIANT ? 'copilot' : 'claude'],
    'To start the work over on 3.0, run the command again without a task path; a development or research run ',
    'started with `--context=<this task directory>` reads this task\'s files as background.',
  ].join('');
}

/** This copy's plugin name, read off the manifest four directories up; null when unreadable. */
function ownPluginName() {
  try {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof manifest?.name === 'string' ? manifest.name : null;
  } catch {
    return null;
  }
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
 * or `{ok: false, code, message}` for one it does not resume.
 *
 * A run whose context block still carries the retired phase-summary mirror
 * resumes all the same; the result then carries `warnings`, the one
 * `legacy-mirror-ignored` line (`legacyMirrorWarning`), which the verb prints
 * on stderr and keeps out of the JSON. A session pointer that could not be
 * written is a line there too.
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
  ];
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
    dashboard: dashboardUrl(doc, dir),
    // Additive, and only while a gate's revise is open: a resume that finds it
    // not yet applied runs `gate-revise` before it walks the ready set.
    ...(revision ? { revision: { gate: revision.gate, option: revision.option, reruns: revision.reruns, revision: revision.revision, applied: revision.applied } } : {}),
    ...(gate ? { gate } : {}),
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
 * `{node, request, asked_at, answer_state, answer_files}`. `answer_state` is the verdict a
 * session chooses its words from: `none` with no answer file, `one` or `several`
 * by how many are usable, `unusable` with files of which none is. Files stay on
 * disk after a revise asks the gate again, so a usable file beside an earlier
 * round's still reads `one`.
 */
function waitingGate(doc, dir) {
  const pending = isPlainObject(doc.orchestrator) ? doc.orchestrator.gate_pending : null;
  if (!isPlainObject(pending) || typeof pending.node !== 'string') return null;
  const { node } = pending;
  const gates = path.join(dir, 'gates');
  const request = `${node}.request.yml`;
  const askedAt = askedAtOf(path.join(gates, request));
  const files = answerFileNames(gates, node).map(file => judgeAnswerFile(gates, file, askedAt));
  const usable = files.filter(each => each.usable).length;
  return {
    node,
    request: `gates/${request}`,
    asked_at: askedAt,
    answer_state: files.length === 0 ? 'none' : usable === 0 ? 'unusable' : usable === 1 ? 'one' : 'several',
    answer_files: files,
  };
}

/** The request's `asked_at`, or null when the request cannot be read or holds no valid one. */
function askedAtOf(file) {
  try {
    const askedAt = parse(fs.readFileSync(file, 'utf8')).asked_at;
    return typeof askedAt === 'string' && TIMESTAMP.test(askedAt) ? askedAt : null;
  } catch {
    return null;
  }
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
 * run moved to another machine no longer has. A child run's root is found
 * through its parent link (`childRootOf`), every other run's four levels up
 * (`projectRootOf`), under either run root. The umbrella's run listing reports
 * the same root through the facade.
 */
export function runRoot(doc, dir) {
  const parent = isPlainObject(doc.orchestrator) ? doc.orchestrator.parent : null;
  return isPlainObject(parent) && typeof parent.run === 'string' && parent.run !== ''
    ? childRootOf(dir, parent)
    : projectRootOf(dir);
}

function refuse(code, message) {
  return { ok: false, code, message };
}
