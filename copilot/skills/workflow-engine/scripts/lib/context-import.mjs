/**
 * Copy context into a run's task directory: the one way a node brings a file
 * or a directory in from elsewhere.
 *
 * Why this module exists. A node that imports context — a research report, a
 * product brief and its mockups, an architecture document, a context pack —
 * used to copy it with a shell command. A driven session's permissions allow
 * the file tools inside the task directory and this engine's script, and not
 * an arbitrary shell copy, so the copy was refused and the node failed with it.
 * The file tools are no substitute: a mockup is often binary, and they write
 * text. So the copy is done here, by the script every session can already run,
 * byte for byte.
 *
 * Given the run's state, a destination directory inside the run and one or
 * more sources, it copies each source to `<to>/<its name>` — a directory
 * recursively — or, with `as`, the one source to `<to>/<as>`. Links are copied
 * as what they point at, so nothing in the run points outside it, and a copy
 * already there is replaced, so importing again on a re-run gives the source as
 * it is now. Each source is judged on its own: one that is missing, lies
 * outside the area it may come from, overlaps the destination or fails to
 * copy is reported and the rest are still copied.
 *
 * Sources come from inside the project only, judged with every link resolved:
 * a path outside it, a link out of it, or a directory holding such a link is
 * skipped and nothing of it is copied. The call is allowed where an arbitrary
 * read is not, and a task directory may leave the machine, so it must not
 * carry a file the host's own permissions would have asked about. The
 * directory is checked whole before anything is copied, so a refused one
 * leaves no part of itself in the run.
 *
 * One wider area is admitted: the workspace a member run belongs to. A run the
 * cockpit starts in a member of a workspace lives in that member's checkout,
 * or in a worktree under its `.worktrees/`, while every input it is handed —
 * the context pack, a research report, a design — lies under the workspace
 * root, which the session is already granted. So for a run the cockpit drives,
 * the workspace root is admitted beside the project, by the same rule: a link
 * out of it, or a directory holding one, is still skipped. A terminal run is
 * judged against its project alone, wherever it lies.
 *
 * The workspace is found on disk, never taken from a path a session gives or
 * records: it is the nearest directory above the project holding
 * `.maister/umbrella.yml`, and it counts only when that manifest declares a
 * member whose checkout is this project, or holds it directly under
 * `.worktrees/`, compared with links resolved. A member is a link to a
 * repository elsewhere as often as not, so a run reached by its real path
 * has no workspace above it; the cwd its driver records is then searched the
 * same way, and only when it is the project under another spelling. A member
 * path that is absolute or climbs with `..` declares nothing here. A
 * manifest a session could write itself lies inside its project or inside the
 * workspace already, so no state or argument widens the area further.
 *
 * It writes no state. Recording what was imported, and what a skipped source
 * means for the node, stays with the node's own `write-state`.
 *
 * Refusals of the whole call, as `{ok: false, code, message}`, nothing copied:
 * `import-state-unreadable`, `import-not-a-run`, `import-destination-outside`,
 * `import-destination-reserved`. A skipped source carries one of
 * `import-source-missing`, `import-source-outside`, `import-source-overlaps`,
 * `import-copy-failed`.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { projectRootOf } from './state.mjs';
import { readDefinition } from './definition.mjs';
import { isTerminalDriver } from './driver.mjs';

/** The run's own folders, written by the engine alone: never a destination. */
const RESERVED = ['gates', 'display'];

/** The workspace manifest, under the workspace root, and the folder a member's worktrees sit in. */
const MANIFEST = ['.maister', 'umbrella.yml'];
const WORKTREES = '.worktrees';

/**
 * Copy `from` (a list of paths, each absolute or relative to the project root)
 * into `to` (a directory relative to the run directory of `state`), the one
 * source renamed to `as` when it is given.
 *
 * Returns `{ok, to, copied: [{from, to, files}], skipped: [{from, code,
 * message}]}` — `ok` false when anything was skipped — or `{ok: false, code,
 * message}` for a refusal. Every path it reports is relative to the run
 * directory and spelled with `/`.
 */
export function importContext({ state, to, from, as = null }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('import-state-unreadable',
      `${state} cannot be read as a state document (${err.message}). Point --state at the run's orchestrator-state.yml.`);
  }
  if (!isPlainObject(doc) || !isPlainObject(doc.workflow)) {
    return refuse('import-not-a-run',
      `${state} carries no workflow block, so the engine never froze it. Import into a frozen run.`);
  }

  const runDir = path.dirname(path.resolve(state));
  const destination = destinationOf(runDir, to);
  if (!destination.ok) return destination;
  const { dir } = destination;

  const root = projectRootOf(runDir);
  const project = realOf(root);
  const workspace = workspaceOf(doc, root, project);
  const areas = workspace === null ? [project] : [project, workspace];
  const reach = workspace === null ? 'the project' : 'the project and its workspace';
  const admitted = workspace === null ? root : `${root} or the workspace it belongs to, ${workspace}`;
  const copied = [];
  const skipped = [];
  for (const given of from) {
    const source = path.resolve(root, given);
    if (!fs.existsSync(source)) {
      skipped.push({ from: given, code: 'import-source-missing', message: `${given} does not exist (read as ${source})` });
      continue;
    }
    let outside;
    try {
      outside = outsideOf(source, areas);
    } catch (err) {
      skipped.push({ from: given, code: 'import-copy-failed', message: `${given} could not be read to check its links: ${err.message}` });
      continue;
    }
    if (outside !== null) {
      const through = outside.link === null ? '' : ` through the link ${outside.link}`;
      skipped.push({ from: given, code: 'import-source-outside', message: `${given} reaches outside ${reach}${through} (read as ${outside.real}); import copies only from inside ${admitted}. Have the person copy the file into the project first, then import it from there.` });
      continue;
    }
    const target = path.join(dir, as ?? path.basename(source));
    if (overlaps(realOf(source), realOf(target))) {
      skipped.push({ from: given, code: 'import-source-overlaps', message: `${given} holds the destination or lies inside it, so it cannot be copied there` });
      continue;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(source, target, { recursive: true, dereference: true, force: true });
      copied.push({ from: given, to: posix(runDir, target), files: countFiles(target) });
    } catch (err) {
      skipped.push({ from: given, code: 'import-copy-failed', message: `${given} could not be copied: ${err.message}` });
    }
  }
  return { ok: skipped.length === 0, to: posix(runDir, dir), copied, skipped };
}

/**
 * The destination directory `to` names inside `runDir`, or the refusal: one
 * that is absolute, climbs with `..` or reaches outside the run through a link
 * is outside it; the run directory itself and the engine's own folders are
 * reserved.
 */
function destinationOf(runDir, to) {
  const segments = to.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.');
  if (path.isAbsolute(to) || /^[a-zA-Z]:/.test(to) || segments.includes('..')) {
    return refuse('import-destination-outside',
      `--to=${to} is not a directory inside the run. Name it relative to the run directory, with no "..".`);
  }
  if (segments.length === 0 || RESERVED.includes(segments[0])) {
    return refuse('import-destination-reserved',
      `--to=${to} is ${segments.length === 0 ? 'the run directory itself' : `under ${segments[0]}/, which the engine writes`}. Import into a folder of the run's own, such as analysis/research-context.`);
  }
  const dir = path.join(runDir, ...segments);
  if (!isWithin(realOf(dir), realOf(runDir))) {
    return refuse('import-destination-outside',
      `--to=${to} leads outside the run through a link. Name a folder that lies inside the run directory.`);
  }
  return { ok: true, dir };
}

/**
 * `file` with every link in its existing part resolved: the real path of its
 * deepest ancestor that exists, the rest appended as written.
 */
function realOf(file) {
  const rest = [];
  let at = path.resolve(file);
  for (;;) {
    try {
      return path.join(fs.realpathSync(at), ...rest.reverse());
    } catch {
      const parent = path.dirname(at);
      if (parent === at) return path.join(at, ...rest.reverse());
      rest.push(path.basename(at));
      at = parent;
    }
  }
}

/**
 * The real path of the workspace a run the cockpit drives belongs to, or null:
 * the nearest directory above `root` whose manifest declares `project` (the
 * real project root) as a member checkout or a worktree of one. `root` as the
 * run reached it is searched first, then the driver's recorded cwd when that
 * is the same directory spelled another way — the spelling through a member's
 * link. A terminal run belongs to no workspace here.
 */
function workspaceOf(doc, root, project) {
  if (isTerminalDriver(doc)) return null;
  const spellings = [root];
  const cwd = doc.orchestrator.driver.cwd;
  if (typeof cwd === 'string' && path.isAbsolute(cwd) && realOf(cwd) === project) spellings.push(path.resolve(cwd));
  for (const spelled of spellings) {
    const found = manifestAbove(spelled, project);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The real path of the nearest directory above `spelled` holding a workspace
 * manifest, when that manifest declares `project`; null otherwise, the nearest
 * manifest deciding alone.
 */
function manifestAbove(spelled, project) {
  let at = path.resolve(spelled);
  while (path.dirname(at) !== at) {
    at = path.dirname(at);
    const file = path.join(at, ...MANIFEST);
    if (isFile(file)) return declares(at, readDefinition(file).doc, project) ? realOf(at) : null;
  }
  return null;
}

/**
 * Whether the manifest `doc`, read at `base`, declares a member whose checkout
 * is `project`, or holds it directly under its worktrees folder. A member's
 * path defaults to its name, as the dispatch envelope reads it; one that is
 * absolute or holds `..` is not inside the workspace and declares nothing.
 */
function declares(base, doc, project) {
  const members = isPlainObject(doc?.members) ? doc.members : {};
  return Object.entries(members).some(([name, entry]) => {
    const declared = isPlainObject(entry) && typeof entry.path === 'string' && entry.path !== '' ? entry.path : name;
    if (path.isAbsolute(declared) || /^[a-zA-Z]:/.test(declared) || declared.split(/[\\/]+/).includes('..')) return false;
    const checkout = path.join(base, declared);
    return realOf(checkout) === project || realOf(path.join(checkout, WORKTREES)) === path.dirname(project);
  });
}

/**
 * Where `source` leaves every one of `areas` (real paths), or null when it
 * stays inside one: `{link, real}`, `link` null for the source itself, else
 * the first link below it whose target lies outside them all. A link to a
 * directory inside is walked as well, each real directory once, so a cycle of
 * links ends.
 */
function outsideOf(source, areas) {
  const inside = file => areas.some(area => isWithin(file, area));
  const real = realOf(source);
  if (!inside(real)) return { link: null, real };
  const seen = new Set();
  const walk = dir => {
    if (seen.has(dir)) return null;
    seen.add(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = realOf(at);
        if (!inside(target)) return { link: at, real: target };
        if (isDirectory(target)) {
          const found = walk(target);
          if (found !== null) return found;
        }
      } else if (entry.isDirectory()) {
        const found = walk(realOf(at));
        if (found !== null) return found;
      }
    }
    return null;
  };
  return isDirectory(real) ? walk(real) : null;
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Whether `inner` is `outer` or lies inside it. */
function isWithin(inner, outer) {
  const relative = path.relative(outer, inner);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Whether copying `source` to `target` would copy a directory into itself, or a file onto itself. */
function overlaps(source, target) {
  return isWithin(target, source) || isWithin(source, target);
}

/** How many files `target` holds: one for a file, every file below it for a directory. */
function countFiles(target) {
  if (!fs.statSync(target).isDirectory()) return 1;
  return fs.readdirSync(target, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length;
}

/** `file` relative to `runDir`, spelled with `/` on every platform. */
function posix(runDir, file) {
  return path.relative(runDir, file).split(path.sep).join('/');
}

function refuse(code, message) {
  return { ok: false, code, message };
}
