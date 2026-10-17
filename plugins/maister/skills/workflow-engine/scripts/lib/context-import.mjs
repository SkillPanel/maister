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
 * it is now. Each source is judged on its own: one that is missing, overlaps
 * the destination or fails to copy is reported and the rest are still copied.
 *
 * It writes no state. Recording what was imported, and what a skipped source
 * means for the node, stays with the node's own `write-state`.
 *
 * Refusals of the whole call, as `{ok: false, code, message}`, nothing copied:
 * `import-state-unreadable`, `import-not-a-run`, `import-destination-outside`,
 * `import-destination-reserved`. A skipped source carries one of
 * `import-source-missing`, `import-source-overlaps`, `import-copy-failed`.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { projectRootOf } from './state.mjs';

/** The run's own folders, written by the engine alone: never a destination. */
const RESERVED = ['gates', 'display'];

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
  const copied = [];
  const skipped = [];
  for (const given of from) {
    const source = path.resolve(root, given);
    if (!fs.existsSync(source)) {
      skipped.push({ from: given, code: 'import-source-missing', message: `${given} does not exist (read as ${source})` });
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
