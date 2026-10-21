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
 * It reads the state file and never writes: not the state, not the dashboard,
 * not anything else in the directory. Zero dependencies, `node:` builtins only,
 * Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, isPlainObject } from './state-read.mjs';
import { childRootOf, dashboardUrl, legacyMirrorWarning, projectRootOf } from './state.mjs';
import { isSetAside } from '../../../../lib/run-dirs.mjs';
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
 * Returns `{ok: true, workflow: {name, overlays, profile}, title, status, task_path,
 * root, dashboard, revision?}` for a run the engine froze — `root` the run's
 * checkout, derived from where the state file is (`runRoot`) — `revision` only while a
 * gate's revise is open (`openRevision`) — `dashboard` the `file://` link a
 * resume shows the operator once, or null when the run has none — or
 * `{ok: false, code, message}` for one it does not resume.
 *
 * A run whose context block still carries the retired phase-summary mirror
 * resumes all the same; the result then carries `warnings`, the one
 * `legacy-mirror-ignored` line (`legacyMirrorWarning`), which the verb prints
 * on stderr and keeps out of the JSON.
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
  return {
    ok: true,
    workflow: {
      name: workflow.name,
      overlays: Array.isArray(workflow.overlays) ? workflow.overlays.map(String) : [],
      profile: workflow.profile ?? null,
    },
    title: typeof task.title === 'string' ? task.title : null,
    status: typeof task.status === 'string' ? task.status : null,
    task_path: dir,
    root: runRoot(doc, dir),
    dashboard: dashboardUrl(doc, dir),
    // Additive, and only while a gate's revise is open: a resume that finds it
    // not yet applied runs `gate-revise` before it walks the ready set.
    ...(revision ? { revision: { gate: revision.gate, option: revision.option, reruns: revision.reruns, revision: revision.revision, applied: revision.applied } } : {}),
    ...(mirror === null ? {} : { warnings: [mirror] }),
  };
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
