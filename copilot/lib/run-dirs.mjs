/**
 * Where a run's folder sits, and which folders beside a run are not runs.
 *
 * A run's project root is the folder holding the `.maister/` its folder sits
 * in — the innermost one on its path — and nothing else (`runPlace`). Under it
 * a run sits in one of three places: `.maister/tasks/<type>/<date-name>` for an
 * ordinary run, `.maister/umbrella/runs/<run-id>` for the run that drives a
 * chain, and `.maister/umbrella/runs/<run-id>/runs/<sub-run>` for a chain's own
 * runs. A child run may also sit deeper, inside its parent's folder; its root is
 * still the folder holding that `.maister/`.
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
 * Where the run folder `runDir` sits: `{root, shape, legal}`, derived from the
 * folder and from nothing else. The run directory is the only thing a write
 * knows for certain: `CLAUDE_PROJECT_DIR` and the process cwd are no property
 * of the run, and a dispatched worker started elsewhere would resolve another
 * project's files.
 *
 * - `root`: the folder holding the innermost `.maister` on the folder's path.
 *   On a path with no `.maister`, the nearest ancestor under which the parent
 *   link `parent.run` holds a state file, when a link is given and one does,
 *   else the folder four levels up.
 * - `shape`: `task` (`.maister/tasks/<type>/<name>`), `umbrella`
 *   (`.maister/umbrella/runs/<id>`), `member` (`.maister/umbrella/runs/<id>/runs/<child>`),
 *   `inside` (anywhere else under `.maister/`, a child run in its parent's
 *   folder among them), or null (no `.maister` on the path).
 * - `legal`: whether the folder is one a top-level run may live in — `task`,
 *   `umbrella` or `member`. A child run is held to its parent's record instead.
 */
export function runPlace(runDir, parent = null) {
  const resolved = path.resolve(runDir);
  const parts = resolved.split(path.sep);
  const at = parts.lastIndexOf('.maister');
  if (at <= 0) return { root: rootWithout(resolved, parent), shape: null, legal: false };
  const root = path.resolve(resolved, ...Array(parts.length - at).fill('..'));
  const shape = shapeOf(parts.slice(at + 1).filter(part => part !== ''));
  return { root, shape, legal: shape !== 'inside' };
}

/** The project root `runPlace` gives: the one rule every reader of a run's root takes. */
export function projectRootOf(runDir, parent = null) {
  return runPlace(runDir, parent).root;
}

/** The shape of the segments below `.maister`. */
function shapeOf(below) {
  const [top, runs, , child, , ...rest] = below;
  if (top === 'tasks' && below.length === 3) return 'task';
  if (top !== 'umbrella' || runs !== 'runs' || rest.length > 0) return 'inside';
  if (below.length === 3) return 'umbrella';
  return below.length === 5 && child === 'runs' ? 'member' : 'inside';
}

/** A root on a path with no `.maister`: the ancestor holding the parent, else four up. */
function rootWithout(runDir, parent) {
  const fourUp = path.resolve(runDir, '..', '..', '..', '..');
  const link = parent !== null && typeof parent === 'object' && typeof parent.run === 'string' && parent.run !== '' ? parent.run : null;
  if (link === null) return fourUp;
  const holds = dir => {
    try {
      return fs.statSync(path.join(dir, ...link.split('/'), 'orchestrator-state.yml')).isFile();
    } catch {
      return false;
    }
  };
  if (holds(fourUp)) return fourUp;
  for (let dir = path.dirname(runDir); ; dir = path.dirname(dir)) {
    if (holds(dir)) return dir;
    if (path.dirname(dir) === dir) return fourUp;
  }
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
