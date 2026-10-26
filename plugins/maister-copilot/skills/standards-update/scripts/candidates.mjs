/**
 * The standard candidates a finished workflow run handed over: which run holds
 * some still to apply, and which of them a person has applied since.
 *
 *   node <path to this file> latest [--tasks=<dir>]
 *   node <path to this file> applied --run=<task dir> --id=<id> [--id=<id> ...]
 *
 * A run's finalization writes `standard-candidates.json` into its task
 * directory, in the shape docs-manager's standard candidates reference
 * describes (*The run's candidates file*). This script never changes that
 * file: what has been applied is kept beside it, in
 * `standard-candidates-applied.json` (`{applied: [id, ...]}`), so the
 * candidates file's modification time stays the moment its run finished.
 *
 * `latest` looks at every `<tasks>/<type>/<run>/standard-candidates.json`
 * (`--tasks` defaults to `.maister/tasks` under the current directory, so a
 * caller runs it from the project root), sets aside the candidates already
 * applied, and passes over a run with none left. Of the rest the newest file
 * wins, its path breaking a tie. It prints `{run, candidates, already_held,
 * others, problems}`: `run` is `{dir, type, name}` or null when no run holds a
 * candidate to apply; `others` is every other run that does, `{dir, count}`,
 * newest first; `problems` names each file that could not be read and each
 * entry that is not a candidate, `{path, message}` — never a reason to fail.
 *
 * `applied` adds the ids to the run's applied file, once each, written whole
 * through a temporary file and a rename. An id the run's candidates file does
 * not hold is refused and nothing is recorded.
 *
 * Exit 0 when the verb did its work, 1 when `applied` refused, 2 on a usage
 * error or a file this script could not write. Exec form, no shebang, zero
 * dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };

const CANDIDATES = 'standard-candidates.json';
const APPLIED = 'standard-candidates-applied.json';
const DEFAULT_TASKS = path.join('.maister', 'tasks');
const USAGE = 'usage: node candidates.mjs latest [--tasks=<dir>] | applied --run=<task dir> --id=<id> [--id=<id> ...]';

/** The fields every candidate carries as a non-empty string. */
const REQUIRED = ['id', 'label', 'line', 'destination'];

class UsageError extends Error {}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (verb !== 'latest' && verb !== 'applied') throw new UsageError(verb ? `unknown verb ${verb}` : 'a verb is required');
  const flags = { verb, ids: [] };
  for (const arg of rest) {
    const match = /^--(tasks|run|id)=(.+)$/.exec(arg);
    if (!match) throw new UsageError(`unknown argument ${arg}`);
    const [, name, value] = match;
    if (name === 'id') flags.ids.push(value);
    else flags[name] = value;
  }
  if (verb === 'latest' && (flags.run || flags.ids.length)) throw new UsageError('latest takes only --tasks');
  if (verb === 'applied' && (!flags.run || !flags.ids.length || flags.tasks)) throw new UsageError('applied takes --run and at least one --id');
  return flags;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The ids recorded as applied for the run at `dir`; an absent or unreadable file records none. */
function appliedIds(dir, problems) {
  const file = path.join(dir, APPLIED);
  if (!fs.existsSync(file)) return new Set();
  try {
    const doc = readJson(file);
    return new Set(Array.isArray(doc?.applied) ? doc.applied.filter(id => typeof id === 'string') : []);
  } catch (error) {
    problems.push({ path: file, message: `could not read what was applied: ${error.message}` });
    return new Set();
  }
}

/** A run's candidates file, its entries checked; null when it cannot be read. */
function readRun(dir, problems) {
  const file = path.join(dir, CANDIDATES);
  let doc;
  try {
    doc = readJson(file);
  } catch (error) {
    problems.push({ path: file, message: `could not read the candidates: ${error.message}` });
    return null;
  }
  const candidates = [];
  for (const [index, entry] of (Array.isArray(doc?.candidates) ? doc.candidates : []).entries()) {
    const missing = REQUIRED.filter(field => typeof entry?.[field] !== 'string' || entry[field].trim() === '');
    if (missing.length) {
      problems.push({ path: file, message: `candidate ${index + 1} has no ${missing.join(', ')}` });
      continue;
    }
    candidates.push({ ...entry, recommended: entry.recommended === true });
  }
  const held = Array.isArray(doc?.already_held) ? doc.already_held.filter(entry => typeof entry?.line === 'string') : [];
  return { file, candidates, already_held: held, mtime: fs.statSync(file).mtimeMs };
}

/** Every `<tasks>/<type>/<run>` directory holding a candidates file. */
function runDirs(tasks) {
  const dirs = [];
  if (!fs.existsSync(tasks)) return dirs;
  for (const type of fs.readdirSync(tasks, { withFileTypes: true })) {
    if (!type.isDirectory()) continue;
    for (const run of fs.readdirSync(path.join(tasks, type.name), { withFileTypes: true })) {
      const dir = path.join(tasks, type.name, run.name);
      if (run.isDirectory() && fs.existsSync(path.join(dir, CANDIDATES))) dirs.push({ dir, type: type.name, name: run.name });
    }
  }
  return dirs;
}

function latest(tasks) {
  const problems = [];
  const open = [];
  for (const where of runDirs(tasks)) {
    const read = readRun(where.dir, problems);
    if (!read) continue;
    const applied = appliedIds(where.dir, problems);
    const left = read.candidates.filter(candidate => !applied.has(candidate.id));
    if (left.length) open.push({ ...where, ...read, candidates: left });
  }
  open.sort((a, b) => b.mtime - a.mtime || b.dir.localeCompare(a.dir));
  const [chosen, ...rest] = open;
  return {
    run: chosen ? { dir: chosen.dir, type: chosen.type, name: chosen.name } : null,
    candidates: chosen ? chosen.candidates : [],
    already_held: chosen ? chosen.already_held : [],
    others: rest.map(each => ({ dir: each.dir, count: each.candidates.length })),
    problems,
  };
}

function applied(dir, ids) {
  const problems = [];
  const read = readRun(dir, problems);
  if (!read) return { ok: false, refused: problems.map(problem => problem.message) };
  const known = new Set(read.candidates.map(candidate => candidate.id));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) return { ok: false, refused: unknown.map(id => `${id} is not a candidate of this run`) };
  const recorded = appliedIds(dir, problems);
  for (const id of ids) recorded.add(id);
  const file = path.join(dir, APPLIED);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ applied: [...recorded] }, null, 2)}\n`);
  fs.renameSync(temporary, file);
  return { ok: true, applied: [...recorded], left: read.candidates.filter(candidate => !recorded.has(candidate.id)).length };
}

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`candidates: ${error.message}\n${USAGE}\n`);
    return EXIT.INTERNAL;
  }
  let result;
  try {
    result = flags.verb === 'latest'
      ? latest(path.resolve(flags.tasks ?? DEFAULT_TASKS))
      : applied(path.resolve(flags.run), flags.ids);
  } catch (error) {
    process.stderr.write(`candidates: ${error.message}\n`);
    return EXIT.INTERNAL;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok === false ? EXIT.REFUSED : EXIT.OK;
}

process.exitCode = main();
