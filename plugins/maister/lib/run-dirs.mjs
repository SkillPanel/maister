/**
 * Where a run's folder sits, and which folders beside a run are not runs.
 *
 * A run's state folder sits four levels below its checkout, under one of two
 * roots: `<checkout>/.maister/tasks/<type>/<date-name>` for an ordinary run,
 * `<checkout>/.maister/umbrella/runs/<run-id>` for the run that drives a chain.
 * A chain's own runs sit one level deeper, at `<run-id>/runs/<sub-run>`.
 * Beside a run there may be a copy set aside: `<run>.moved-<digits>`, the copy a
 * machine kept after the run moved to another, and `<run>.failed-<digits>`, a
 * rolled-back copy. Either holds a state file that looks like a run's, and
 * neither is one: a reader that lists runs leaves it out, and a resume refuses it.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. It sits at the plugin
 * root because the engine's resume check and the umbrella's run listing share
 * the one rule, and the engine's state writer and gate previews the other.
 */

import fs from 'node:fs';
import path from 'node:path';

const SET_ASIDE = /\.(moved|failed)-\d+$/;

/**
 * The checkout a run's folder belongs to, derived from the folder and from
 * nothing else. The run directory is the only thing a write knows for certain:
 * `CLAUDE_PROJECT_DIR` and the process cwd are no property of the run, and a
 * dispatched worker started elsewhere would resolve another project's files.
 */
export function projectRootOf(runDir) {
  return path.resolve(runDir, '..', '..', '..', '..');
}

/** Whether the folder `dir` (a path or a bare name) is a set-aside copy of a run. */
export function isSetAside(dir) {
  return SET_ASIDE.test(path.basename(String(dir).replace(/[\\/]+$/, '')));
}

/** The folders directly under `dir`, sorted; none when it cannot be listed. */
function foldersIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every folder under `checkout` that sits where a run sits, set-aside copies
 * left out, and with one anything under it.
 */
export function runFolders(checkout) {
  const maister = path.join(checkout, '.maister');
  const kept = dirs => dirs.filter(dir => !isSetAside(dir));
  return [
    ...kept(foldersIn(path.join(maister, 'tasks')).flatMap(foldersIn)),
    ...kept(foldersIn(path.join(maister, 'umbrella', 'runs')))
      .flatMap(run => [run, ...kept(foldersIn(path.join(run, 'runs')))]),
  ];
}
