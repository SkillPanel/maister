/**
 * Where a node summary's artifact paths point: the one rule the writer and the
 * dashboard projection both read.
 *
 * A summary's `artifacts` are linked from `dashboard.html`, which sits in the
 * task folder, so every `path` and `html` is spelled relative to that folder.
 * The brief's `writes:` line prints each declared path repository-relative —
 * the spelling a delegate joins nothing onto — and a closing write that copied
 * it listed a link that resolved nowhere, beside the entry the writer had
 * registered for the same file. So a path is placed before it is kept:
 *
 * - one opening with the task path, repository-relative or absolute, is
 *   spelled task-relative;
 * - one inside the task folder of a sub-run the run records is spelled
 *   `../../<type>/<run>/<path>`, the spelling the writer registers a child's
 *   artifacts under;
 * - anything else that leaves the task folder has no place, and the caller
 *   decides: the writer refuses it, the projection leaves it out.
 *
 * A relative path is read from the repository root when it opens with the
 * task path, a recorded sub-run's task path or `.maister/`, and from the task
 * folder otherwise: `src/app.js` is the task folder's own `src/app.js`.
 *
 * A list then keeps one entry per placed path: the one carrying an `html`
 * companion, else the first, in the first one's position.
 *
 * Pure path arithmetic, `/`-separated whatever the platform. Zero
 * dependencies, `node:` builtins only, Node >= 20.
 */

import path from 'node:path';

/** A plain object, not an array. */
const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** `value` with `\` read as `/`, and a leading `./` dropped. */
function slashed(value) {
  return value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

/** Whether `inner` lies inside the folder `outer`, both repository-relative. */
function within(inner, outer) {
  return outer !== '' && inner.startsWith(`${outer}/`);
}

/**
 * Where a run's artifacts are placed: its task path and the recorded task
 * paths of its sub-runs, repository-relative, and the project root an absolute
 * path is read against, or null when the caller has none.
 *
 * `runDir` and `root` are absolute; without them the state's own
 * `orchestrator.task_path` names the task folder.
 */
export function whereOf({ state, runDir = null, root = null }) {
  const doc = isMap(state) ? state : {};
  const recorded = isMap(doc.orchestrator) && typeof doc.orchestrator.task_path === 'string' ? doc.orchestrator.task_path : '';
  const taskPath = runDir !== null && root !== null
    ? path.relative(root, runDir).split(path.sep).join('/')
    : path.posix.normalize(slashed(recorded)).replace(/\/+$/, '');
  const nodes = isMap(doc.workflow) && isMap(doc.workflow.nodes) ? doc.workflow.nodes : {};
  const subruns = Object.values(nodes)
    .map(node => (isMap(node) && isMap(node.values) ? node.values.task_path : undefined))
    .filter(value => typeof value === 'string' && value !== '' && !path.isAbsolute(value))
    .map(value => path.posix.normalize(slashed(value)).replace(/\/+$/, ''))
    .filter(value => value !== '.' && !value.startsWith('../'));
  return { taskPath: taskPath === '.' ? '' : taskPath, root, subruns };
}

/**
 * `value` spelled relative to the task folder, or null when it lies outside
 * the folder and every recorded sub-run's folder. A value that is not a path to
 * judge — not a string, empty, or interpolated — comes back as it is, and so
 * does one already spelled task-relative, the very same string.
 */
export function taskRelative(value, where) {
  if (typeof value !== 'string' || value === '' || value.includes('${')) return value;
  const { taskPath, root, subruns } = where;
  if (taskPath === '') return value;
  let repo;
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    if (root === null) return null;
    repo = path.relative(root, value).split(path.sep).join('/');
    if (repo === '' || repo.startsWith('../') || path.isAbsolute(repo)) return null;
  } else {
    const plain = path.posix.normalize(slashed(value));
    // A path naming a task folder itself, or opening with the `.maister/` the
    // task folders live under, is spelled from the repository root.
    const opensRepo = plain === taskPath || plain === '.maister' || plain.startsWith('.maister/')
      || [taskPath, ...subruns].some(folder => within(plain, folder));
    repo = opensRepo ? plain : path.posix.normalize(path.posix.join(taskPath, slashed(value)));
  }
  let placed = null;
  if (within(repo, taskPath)) placed = repo.slice(taskPath.length + 1);
  else if (subruns.some(folder => within(repo, folder))) placed = path.posix.relative(taskPath, repo);
  if (placed === null) return null;
  return placed === value ? value : placed;
}

/** The path an artifact entry names, or undefined for one that names none. */
function pathOf(entry) {
  if (typeof entry === 'string') return entry;
  return isMap(entry) && typeof entry.path === 'string' ? entry.path : undefined;
}

/** Whether an entry carries an `html` companion. */
const hasHtml = entry => isMap(entry) && typeof entry.html === 'string' && entry.html !== '';

/**
 * One entry per path: a later entry naming a path already listed is dropped,
 * unless it carries the `html` companion the earlier one lacks — then it takes
 * the earlier one's place. An entry naming no path is kept as it is.
 */
export function uniqueArtifacts(list) {
  const out = [];
  const at = new Map();
  for (const entry of list) {
    const key = pathOf(entry);
    if (key === undefined) {
      out.push(entry);
      continue;
    }
    if (!at.has(key)) {
      at.set(key, out.length);
      out.push(entry);
      continue;
    }
    const index = at.get(key);
    if (!hasHtml(out[index]) && hasHtml(entry)) out[index] = entry;
  }
  return out;
}

/**
 * A summary's artifact list with every `path` and `html` placed and duplicates
 * dropped. A bare string stays a bare string, and an entry placed unchanged is
 * the same value, so a list already task-relative and unique comes back equal
 * to what went in.
 *
 * `outside(index, field, value)` is called for each path with no place; it may
 * throw (the writer's refusal). Otherwise an entry whose `path` has no place is
 * left out and an `html` with no place becomes null.
 */
export function placedArtifacts(list, where, outside = () => {}) {
  const placed = [];
  list.forEach((entry, index) => {
    if (typeof entry === 'string') {
      const spelled = taskRelative(entry, where);
      if (spelled === null) outside(index, 'path', entry);
      else placed.push(spelled);
      return;
    }
    if (!isMap(entry) || typeof entry.path !== 'string') {
      placed.push(entry);
      return;
    }
    const spelled = taskRelative(entry.path, where);
    if (spelled === null) {
      outside(index, 'path', entry.path);
      return;
    }
    const html = typeof entry.html === 'string' ? taskRelative(entry.html, where) : entry.html;
    if (html === null && entry.html !== null) outside(index, 'html', entry.html);
    if (spelled === entry.path && html === entry.html) placed.push(entry);
    else placed.push({ ...entry, path: spelled, ...(Object.hasOwn(entry, 'html') ? { html } : {}) });
  });
  return uniqueArtifacts(placed);
}
