/**
 * The project's standard candidate store: the knowledge finished workflow runs
 * handed over, kept in one folder the project commits, one file per candidate.
 * The store is the queue's one source of truth: every verb here reads it, and
 * only `file`, `applied`, `dismiss`, `merge` and the import write it.
 *
 *   node <path to this file> file --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> close --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> queue [--tasks=<dir>] [--skip=<task dir>] [--today=<YYYY-MM-DD>] [--json]
 *   node <path to this file> latest [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> show --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> applied --id=<id> [--id=<id> ...] [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> dismiss (--id=<id> ... | --run=<task dir> --all) --reason=<text> --by=<name> [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> merge --into=<id> --id=<id> [--id=<id> ...] [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> import [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *
 * `--tasks` defaults to `.maister/tasks` under the current directory, so a
 * caller runs this from the project root; the store is the folder beside it,
 * `.maister/standard-candidates/`. Docs-manager's standard candidates
 * reference describes the store's file, the run's candidates file, the queue's
 * two shapes and the close (*The candidate store*, *The run's candidates
 * file*, *The open queue*, *The close*).
 *
 * A candidate's file holds what it says, its stored state (`open`, `applied`,
 * `dismissed` or `merged`, with `closed` recording the day and, for a
 * dismissal, the reason and who, for a merge the candidate it went into) and
 * `seen_in`, one `{run, date, evidence}` line per run that
 * met it, the run that filed it first. `expired` is worked out on read: open,
 * seen in one run only, that sighting dated more than 30 days before `--today`
 * (default: today, in UTC). A run is named `<type>/<name>`, its task
 * directory's last two folders, with a forward slash on every system, and
 * dated by the `YYYY-MM-DD` its name opens with, else by its candidates file's
 * modification day.
 *
 * A candidate's id is `<run date>-<label slug>-<hash>`, the hash the first six
 * hex digits of sha256 over `<run>#<its id in the run's file>`: two branches'
 * runs are different task folders, so they never pick one file name, and the
 * same run filed again finds its own files by the hash.
 *
 * A sighting is appended as one line that opens with its comma, just before
 * the list's closing bracket, and the store holds a `.gitattributes` asking
 * git to merge its files by union: two branches that each add a sighting to
 * one candidate merge to both lines, still valid JSON.
 *
 * `file` files a run's candidates file in the store: its first five new
 * candidates (any more are counted as dropped), and a sighting of this run on
 * each candidate it attached to; then it writes the run's file back as version
 * 3, each candidate naming its store id. Filing the same run again adds
 * nothing. `close` prints the lines a run's close carries. `queue`, `latest`
 * and `show` report from the store. `applied` and `dismiss` close candidates
 * by their store ids; `dismiss --all` takes every candidate the run named
 * filed that is neither applied nor merged. `merge` closes candidates that
 * teach the lesson another one does as merged into it, adding their sightings
 * to it; a merged candidate's sightings count for the one it went into,
 * wherever they were written, and an attachment naming it is filed on that one.
 *
 * Before any verb, run folders whose candidates file was written before the
 * store (no `version`, or 1 or 2) are folded in: the candidates that would
 * still read as open — neither applied nor dismissed in the run's
 * `standard-candidates-applied.json`, and seen in two runs or dated 30 days
 * or less before `--today` — and the attachments onto them. The rest are
 * left out, nothing written for them, and one line on stderr counts them.
 * Each folded run's file is then written back as version 3, each candidate
 * in the store naming its store id, with `folded: {expired, closed}` counting
 * what was left out, so no later verb folds it in again; `file` files only
 * the candidates such a file names in the store. A candidate or sighting
 * already there is skipped; `import` folds in alone. A sighting already there
 * that holds no evidence where the run's file gives a list is filled in.
 *
 * Evidence, wherever it is read (a run's candidates and attachments, a store
 * sighting), is one string: text as it is, a list of text joined with `, `.
 * Anything else is a problem named with its file's path and read as none.
 *
 * Exit 0 when the verb did its work, 1 when `file`, `applied`, `dismiss` or
 * `merge` refused, 2 on a usage error or a file this script could not write. Exec
 * form, no shebang, zero dependencies, `node:` builtins only, Node >= 20.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };

const CANDIDATES = 'standard-candidates.json';
const APPLIED = 'standard-candidates-applied.json';
const STORE = 'standard-candidates';
const DEFAULT_TASKS = path.join('.maister', 'tasks');
const RUN_VERSION = 3;
const USAGE = [
  'usage: node candidates.mjs file --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
  '| close --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
  '| queue [--tasks=<dir>] [--skip=<task dir>] [--today=<YYYY-MM-DD>] [--json]',
  '| latest [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
  '| show --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
  '| applied --id=<id> [--id=<id> ...] [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
  '| dismiss (--id=<id> ... | --run=<task dir> --all) --reason=<text> --by=<name> [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
  '| merge --into=<id> --id=<id> [--id=<id> ...] [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
  '| import [--tasks=<dir>] [--today=<YYYY-MM-DD>]',
].join(' ');
const VERBS = ['file', 'close', 'queue', 'latest', 'show', 'applied', 'dismiss', 'merge', 'import'];

/** Days a candidate seen in one run only stays open. */
const EXPIRY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a sighting dated `newest` is more than 30 days before `today`, both `YYYY-MM-DD`. */
const expiredOn = (newest, today) => (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / DAY_MS > EXPIRY_DAYS;

/** Lines for stderr that are neither the result nor a problem: what a fold-in left out. */
const notices = [];

/** New candidates one run files at most. */
const CAP = 5;

/** The fields every candidate carries as a non-empty string. */
const REQUIRED = ['id', 'label', 'line', 'destination'];

/** The store file's keys before `seen_in`, in the order they are written. */
const KEYS = ['id', 'label', 'line', 'action', 'extends', 'destination', 'guards', 'caught_by', 'state', 'closed'];
const STATES = ['open', 'applied', 'dismissed', 'merged'];
const GUARDS = { security: 'security', 'data-loss': 'data loss' };

const GITATTRIBUTES = [
  '# Two branches that each add a sighting to one candidate keep both lines when merged.',
  '*.json merge=union',
  '',
].join('\n');

class UsageError extends Error {}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (!VERBS.includes(verb)) throw new UsageError(verb ? `unknown verb ${verb}` : 'a verb is required');
  const flags = { verb, ids: [], json: false, all: false };
  for (const arg of rest) {
    if (arg === '--json' || arg === '--all') {
      flags[arg.slice(2)] = true;
      continue;
    }
    const match = /^--(tasks|run|id|skip|today|reason|by|into)=(.+)$/.exec(arg);
    if (!match) throw new UsageError(`unknown argument ${arg}`);
    const [, name, value] = match;
    if (name === 'id') flags.ids.push(value);
    else flags[name] = value;
  }
  const given = { run: flags.run, id: flags.ids.length, skip: flags.skip, json: flags.json, tasks: flags.tasks, today: flags.today, reason: flags.reason, by: flags.by, all: flags.all, into: flags.into };
  const only = allowed => Object.entries(given).every(([name, value]) => !value || allowed.includes(name));
  if ((verb === 'file' || verb === 'close' || verb === 'show') && (!flags.run || !only(['run', 'tasks', 'today']))) throw new UsageError(`${verb} takes --run and optionally --tasks and --today`);
  if (verb === 'latest' && !only(['tasks', 'today'])) throw new UsageError('latest takes only --tasks and --today');
  if (verb === 'queue' && !only(['tasks', 'skip', 'today', 'json'])) throw new UsageError('queue takes --tasks, --skip, --today and --json, each optional');
  if (verb === 'import' && !only(['tasks', 'today'])) throw new UsageError('import takes only --tasks and --today');
  if (verb === 'applied' && (!flags.ids.length || !only(['id', 'tasks', 'today']))) throw new UsageError('applied takes at least one --id, and optionally --tasks and --today');
  if (verb === 'merge' && (!flags.into || !flags.ids.length || !only(['into', 'id', 'tasks', 'today']))) throw new UsageError('merge takes --into and at least one --id, and optionally --tasks and --today');
  if (verb === 'dismiss') {
    const scoped = flags.all ? Boolean(flags.run) && !flags.ids.length : flags.ids.length > 0 && !flags.run;
    if (!scoped || !flags.reason?.trim() || !flags.by?.trim() || !only(['run', 'id', 'all', 'reason', 'by', 'tasks', 'today'])) {
      throw new UsageError('dismiss takes either --id ones or --run with --all, then --reason and --by, and optionally --tasks and --today');
    }
  }
  if (flags.today !== undefined && !isDay(flags.today)) throw new UsageError(`--today takes a day as YYYY-MM-DD, not ${flags.today}`);
  return flags;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Write `text` to `file` whole, through a temporary file and a rename. */
function writeWhole(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

const isText = value => typeof value === 'string' && value.trim() !== '';

/**
 * Evidence as one string: text as it is, a list of text joined with `, `,
 * none as empty. Anything else is named under `problems` with `file` and read
 * as none.
 */
function evidenceOf(value, file, what, problems) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join(', ');
  problems.push({ path: file, message: `${what}'s evidence is not text or a list of text; read as none` });
  return '';
}

/** A run's name: `<type>/<name>`, a forward slash on every system. */
function runId(dir) {
  return `${path.basename(path.dirname(dir))}/${path.basename(dir)}`;
}

function isDay(text) {
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

/** The day a run is dated: its directory name's `YYYY-MM-DD` prefix, else `mtime`'s day. */
function runDate(name, mtime) {
  const prefix = /^(\d{4}-\d{2}-\d{2})(?:-|$)/.exec(name)?.[1];
  if (prefix && isDay(prefix)) return prefix;
  return new Date(mtime).toISOString().slice(0, 10);
}

/** The rule part of a candidate line: its leading `- ` and everything from ` — why:` taken off. */
function ruleOf(line) {
  const text = line.replace(/^\s*-\s+/, '');
  const cut = text.indexOf(' — why:');
  return (cut === -1 ? text : text.slice(0, cut)).trim();
}

// --- the store ------------------------------------------------------------

/** The six hex digits that tie a store id to the run that filed it and its id in that run's file. */
function hashOf(run, localId) {
  return crypto.createHash('sha256').update(`${run}#${localId}`).digest('hex').slice(0, 6);
}

/** A label as a file-name slug: lowercase letters, digits and hyphens, at most 40 characters. */
function slugOf(label) {
  let slug = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > 40) {
    slug = slug.slice(0, 40);
    const cut = slug.lastIndexOf('-');
    if (cut > 0) slug = slug.slice(0, cut);
  }
  return slug || 'candidate';
}

/** A store candidate's file text: one key a line, one sighting a line, each sighting after the first opening with its comma. */
function serialize(record) {
  const lines = ['{'];
  for (const key of KEYS) lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(record[key] ?? null)},`);
  lines.push('  "seen_in": [');
  record.seen_in.forEach((sighting, index) => {
    const text = JSON.stringify({ run: sighting.run, date: sighting.date, evidence: sighting.evidence ?? '' });
    lines.push(index === 0 ? `    ${text}` : `  , ${text}`);
  });
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

/**
 * The store at `dir`: every readable candidate file, by id (its file name).
 * A file that cannot be read, or holds no candidate, is named under `problems`
 * and left out.
 */
function readStore(dir, problems) {
  const records = new Map();
  if (!fs.existsSync(dir)) return records;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(dir, entry.name);
    const id = entry.name.slice(0, -'.json'.length);
    let doc;
    try {
      doc = readJson(file);
    } catch (error) {
      problems.push({ path: file, message: `could not read the candidate: ${error.message}` });
      continue;
    }
    const missing = ['label', 'line', 'destination'].filter(field => !isText(doc?.[field]));
    const seen = [];
    for (const sighting of Array.isArray(doc?.seen_in) ? doc.seen_in : []) {
      if (!isText(sighting?.run) || seen.some(each => each.run === sighting.run)) continue;
      seen.push({ run: sighting.run, date: isDay(sighting.date) ? sighting.date : null, evidence: evidenceOf(sighting.evidence, file, `the sighting of ${sighting.run}`, problems) });
    }
    if (!seen.length || !seen[0].date) missing.push('seen_in');
    if (missing.length) {
      problems.push({ path: file, message: `the candidate has no ${missing.join(', ')}` });
      continue;
    }
    let state = doc.state ?? 'open';
    if (!STATES.includes(state)) {
      problems.push({ path: file, message: `the candidate's state ${state} is not one of ${STATES.join(', ')}; read as open` });
      state = 'open';
    }
    records.set(id, {
      file, id, label: doc.label, line: doc.line, action: doc.action === 'extend' ? 'extend' : 'new',
      extends: doc.action === 'extend' && isText(doc.extends) ? doc.extends : null, destination: doc.destination,
      guards: Object.hasOwn(GUARDS, doc.guards) ? doc.guards : null, caught_by: isText(doc.caught_by) ? doc.caught_by : null,
      state, closed: state === 'open' || !doc.closed || typeof doc.closed !== 'object' ? null : doc.closed,
      seen_in: seen.map(each => ({ ...each, date: each.date ?? seen[0].date })),
    });
  }
  return records;
}

/** Write each candidate `ids` names, the store's `.gitattributes` first when it has none. */
function writeStore(dir, records, ids) {
  if (!ids.size) return;
  fs.mkdirSync(dir, { recursive: true });
  const attributes = path.join(dir, '.gitattributes');
  if (!fs.existsSync(attributes)) fs.writeFileSync(attributes, GITATTRIBUTES);
  for (const id of ids) {
    const record = records.get(id);
    record.file = path.join(dir, `${id}.json`);
    writeWhole(record.file, serialize(record));
  }
}

/** The candidate a run filed under its own file's `localId`, found by the hash in its store id. */
function filedAs(records, run, localId) {
  const suffix = `-${hashOf(run, localId)}`;
  for (const record of records.values()) {
    if (record.id.endsWith(suffix) && record.seen_in[0].run === run) return record;
  }
  return null;
}

// --- run files --------------------------------------------------------------

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
  const version = Number.isInteger(doc?.version) ? doc.version : 1;
  const candidates = [];
  for (const [index, entry] of (Array.isArray(doc?.candidates) ? doc.candidates : []).entries()) {
    const missing = REQUIRED.filter(field => !isText(entry?.[field]));
    if (missing.length) {
      problems.push({ path: file, message: `candidate ${index + 1} has no ${missing.join(', ')}` });
      continue;
    }
    candidates.push({ index, entry, evidence: evidenceOf(entry.evidence, file, `candidate ${index + 1}`, problems), listed: Array.isArray(entry.evidence) });
  }
  const attached = [];
  for (const [index, entry] of (Array.isArray(doc?.attached) ? doc.attached : []).entries()) {
    const missing = (version < RUN_VERSION ? ['run', 'id'] : ['id']).filter(field => !isText(entry?.[field]));
    if (missing.length) {
      problems.push({ path: file, message: `attachment ${index + 1} has no ${missing.join(', ')}` });
      continue;
    }
    attached.push({ index, entry, evidence: evidenceOf(entry.evidence, file, `attachment ${index + 1}`, problems), listed: Array.isArray(entry.evidence) });
  }
  return { file, doc, version, candidates, attached, mtime: fs.statSync(file).mtimeMs };
}

/** The ids an earlier run's `standard-candidates-applied.json` records as applied or dismissed. */
function settledOf(dir, problems) {
  const file = path.join(dir, APPLIED);
  if (!fs.existsSync(file)) return new Set();
  try {
    const doc = readJson(file);
    const dismissed = doc?.dismissed && typeof doc.dismissed === 'object' && !Array.isArray(doc.dismissed) ? Object.keys(doc.dismissed) : [];
    return new Set([...(Array.isArray(doc?.applied) ? doc.applied.filter(id => typeof id === 'string') : []), ...dismissed]);
  } catch (error) {
    problems.push({ path: file, message: `could not read what was applied: ${error.message}` });
    return new Set();
  }
}

/** Every `<tasks>/<type>/<run>` directory holding a candidates file. */
function runDirs(tasks) {
  const dirs = [];
  if (!fs.existsSync(tasks)) return dirs;
  for (const type of fs.readdirSync(tasks, { withFileTypes: true })) {
    if (!type.isDirectory()) continue;
    for (const run of fs.readdirSync(path.join(tasks, type.name), { withFileTypes: true })) {
      const dir = path.join(tasks, type.name, run.name);
      if (run.isDirectory() && fs.existsSync(path.join(dir, CANDIDATES))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

/** A run file's candidate as a new store record, filed by `run` on `date`. */
function recordOf(entry, evidence, run, date) {
  const label = entry.label.trim();
  const id = `${date}-${slugOf(label)}-${hashOf(run, entry.id)}`;
  return {
    id, label, line: entry.line, action: entry.action === 'extend' ? 'extend' : 'new',
    extends: entry.action === 'extend' && isText(entry.extends) ? entry.extends : null, destination: entry.destination,
    guards: Object.hasOwn(GUARDS, entry.guards) ? entry.guards : null, caught_by: isText(entry.caught_by) ? entry.caught_by : null,
    state: 'open', closed: null, seen_in: [{ run, date, evidence }],
  };
}

/**
 * The candidate a merged one went into, followed to one that is not merged:
 * `record` itself when it is not merged, null when the chain breaks or loops.
 */
function finalOf(records, record) {
  const passed = new Set();
  let at = record;
  while (at.state === 'merged') {
    if (passed.has(at.id)) return null;
    passed.add(at.id);
    at = isText(at.closed?.into) ? records.get(at.closed.into) : null;
    if (!at) return null;
  }
  return at;
}

/**
 * The candidate an attachment names: a store id, else an earlier file's
 * `{run, id}`; a merged one is followed to the candidate it went into.
 */
function targetOf(records, entry) {
  const named = records.has(entry.id) ? records.get(entry.id) : isText(entry.run) ? filedAs(records, entry.run, entry.id) : null;
  return named ? finalOf(records, named) ?? named : null;
}

/** Add `run`'s sighting to `record` unless it is there; whether it was added. */
function sight(record, run, date, evidence) {
  if (record.seen_in.some(each => each.run === run)) return false;
  record.seen_in.push({ run, date, evidence });
  return true;
}

/**
 * Fill in `run`'s sighting on `record` when it holds no evidence and the run's
 * file gave its evidence as a list, which an earlier import stored as empty;
 * whether it was filled in.
 */
function repair(record, run, { evidence, listed }) {
  const sighting = record.seen_in.find(each => each.run === run);
  if (!listed || !evidence || sighting?.evidence !== '') return false;
  sighting.evidence = evidence;
  return true;
}

/**
 * Fold every run folder written before the store into it: the candidates that
 * would still read as open, then attachments onto them as sightings; then mark
 * each folded run's file as version 3, so it is never folded in again. A
 * candidate applied or dismissed in its run, or seen in that run alone and
 * dated more than 30 days before `today`, is left out and counted. Anything
 * already in the store is skipped. Returns the ids created and attached, and
 * what was left out.
 */
function foldIn(tasks, store, records, problems, today) {
  const runs = [];
  for (const dir of runDirs(tasks)) {
    // A version 3 file is filed by `file`, or already folded in: its problems are not this fold-in's to name.
    const found = [];
    const read = readRun(dir, found);
    if (read?.version >= RUN_VERSION) continue;
    problems.push(...found);
    if (!read) continue;
    runs.push({ dir, run: runId(dir), date: runDate(path.basename(dir), read.mtime), read, expired: 0, closed: 0 });
  }
  runs.sort((a, b) => a.date.localeCompare(b.date) || a.run.localeCompare(b.run));
  // Each earlier candidate another earlier run attached to, as `<run>#<its id in the run's file>`: a second run keeps it open.
  const metAgain = new Set();
  for (const each of runs) {
    for (const { entry } of each.read.attached) {
      if (isText(entry.run) && entry.run !== each.run) metAgain.add(`${entry.run}#${entry.id}`);
    }
  }
  const changed = new Set();
  const imported = [];
  const attached = [];
  const leftOut = new Set();
  for (const each of runs) {
    const settled = settledOf(each.dir, problems);
    for (const read of each.read.candidates) {
      const { entry } = read;
      const filed = filedAs(records, each.run, entry.id);
      if (filed) {
        if (repair(filed, each.run, read)) changed.add(filed.id);
        entry.store = filed.id;
        continue;
      }
      const key = `${each.run}#${entry.id}`;
      if (settled.has(entry.id)) each.closed += 1;
      else if (!metAgain.has(key) && expiredOn(each.date, today)) each.expired += 1;
      else {
        const record = recordOf(entry, read.evidence, each.run, each.date);
        records.set(record.id, record);
        changed.add(record.id);
        imported.push(record.id);
        entry.store = record.id;
        continue;
      }
      leftOut.add(key);
    }
  }
  for (const each of runs) {
    for (const read of each.read.attached) {
      const { entry } = read;
      if (isText(entry.run) && leftOut.has(`${entry.run}#${entry.id}`)) continue;
      const target = targetOf(records, entry);
      if (!target) {
        problems.push({ path: each.read.file, message: `attachment ${entry.run}#${entry.id} names no candidate` });
        continue;
      }
      if (sight(target, each.run, each.date, read.evidence)) {
        changed.add(target.id);
        attached.push(target.id);
      } else if (repair(target, each.run, read)) changed.add(target.id);
    }
  }
  writeStore(store, records, changed);
  for (const each of runs) {
    const doc = { ...each.read.doc, version: RUN_VERSION, folded: { expired: each.expired, closed: each.closed } };
    try {
      writeWhole(each.read.file, `${JSON.stringify(doc, null, 2)}\n`);
      // A run with no date in its name is dated by this file's day: the mark keeps it.
      fs.utimesSync(each.read.file, new Date(), new Date(each.read.mtime));
    } catch (error) {
      problems.push({ path: each.read.file, message: `could not mark the run as folded in: ${error.message}` });
    }
  }
  const short = runs.filter(each => each.expired || each.closed);
  const left_out = {
    expired: short.reduce((sum, each) => sum + each.expired, 0),
    closed: short.reduce((sum, each) => sum + each.closed, 0),
    runs: short.length,
  };
  if (short.length) {
    const count = number => number.toLocaleString('en-US');
    const kinds = [['expired', left_out.expired], ['closed', left_out.closed]].filter(([, n]) => n).map(([kind, n]) => `${count(n)} ${kind}`).join(' and ');
    const noun = left_out.expired + left_out.closed === 1 ? 'candidate' : 'candidates';
    notices.push(`left out ${kinds} ${noun} from ${count(left_out.runs)} older run${left_out.runs === 1 ? '' : 's'}`);
  }
  return { imported, attached, left_out };
}

/** The store, earlier run folders folded in first, expiry judged on `today`. */
function loadStore(tasks, problems, today) {
  const store = path.join(path.dirname(tasks), STORE);
  const records = readStore(store, problems);
  foldIn(tasks, store, records, problems, today);
  return { store, records };
}

// --- reading the store across runs -------------------------------------------

/**
 * The store as the reports read it, the run `skip` names left out: its
 * candidates are not read, and its sightings do not count. A merged
 * candidate's sightings count for the candidate it went into, one a run, so a
 * sighting written to it on another branch after the merge still counts.
 */
function indexOf(tasks, records, { skip = null, today }) {
  const candidates = [...records.values()].filter(record => record.seen_in[0].run !== skip);
  const byAge = (a, b) => a.date.localeCompare(b.date) || a.run.localeCompare(b.run);
  const folded = new Map();
  for (const record of records.values()) {
    const into = record.state === 'merged' ? finalOf(records, record) : null;
    if (!into) continue;
    if (!folded.has(into.id)) folded.set(into.id, []);
    folded.get(into.id).push(...record.seen_in);
  }
  const sightings = record => {
    const first = record.seen_in[0];
    const met = new Set([first.run]);
    const rest = [];
    for (const each of [...record.seen_in.slice(1), ...(folded.get(record.id) ?? [])]) {
      if (each.run === skip || met.has(each.run)) continue;
      met.add(each.run);
      rest.push(each);
    }
    return [first, ...rest.sort(byAge)];
  };
  const runs = new Map();
  for (const record of candidates) {
    for (const each of sightings(record)) {
      if (runs.has(each.run)) continue;
      const cut = each.run.indexOf('/');
      const type = cut === -1 ? '' : each.run.slice(0, cut);
      const name = cut === -1 ? each.run : each.run.slice(cut + 1);
      runs.set(each.run, { run: each.run, type, name, dir: path.join(tasks, type, name), date: each.date });
    }
  }
  return { tasks, candidates, sightings, runs, today };
}

/** A candidate's state: its stored one, else expired when one run alone met it more than 30 days ago, else open. */
function stateOf(index, record) {
  if (record.state !== 'open') return record.state;
  const seen = index.sightings(record);
  const newest = seen.map(each => each.date).sort().at(-1);
  return seen.length < 2 && expiredOn(newest, index.today) ? 'expired' : 'open';
}

/** How many candidates are closed, by state. */
function closedOf(index) {
  const closed = { applied: 0, dismissed: 0, expired: 0, merged: 0 };
  for (const record of index.candidates) {
    const state = stateOf(index, record);
    if (state !== 'open') closed[state] += 1;
  }
  return closed;
}

/**
 * Whether a candidate is recommended, and why: seen in two runs or more, or
 * guarding security or data loss. Nothing else earns it, and a candidate a
 * check already catches never does.
 */
function support(record, seenIn) {
  if (isText(record.caught_by)) return { recommended: false, reason: null };
  const reasons = [];
  if (seenIn.length >= 2) reasons.push(`seen in ${seenIn.length} runs`);
  if (Object.hasOwn(GUARDS, record.guards)) reasons.push(`guards ${GUARDS[record.guards]}`);
  return { recommended: reasons.length > 0, reason: reasons.length ? reasons.join('; ') : null };
}

/** A candidate as the reports print it: its fields, the run that filed it, the runs that met it, its state and whether it is recommended. */
function decorate(index, record) {
  const seen = index.sightings(record);
  const seenIn = seen.map(each => each.run);
  return {
    id: record.id, label: record.label, line: record.line, action: record.action, extends: record.extends,
    destination: record.destination, evidence: seen[0].evidence, guards: record.guards, caught_by: record.caught_by,
    run: seen[0].run, seen_in: seenIn, state: stateOf(index, record), closed: record.closed, ...support(record, seenIn),
  };
}

const byId = (a, b) => a.id.localeCompare(b.id);

/** The open candidates `run` filed: the recommended, then the rest, then those a check already catches, each group by id. */
function openOf(index, run) {
  const open = index.candidates.filter(record => record.seen_in[0].run === run && stateOf(index, record) === 'open').sort(byId).map(record => decorate(index, record));
  const caught = open.filter(each => isText(each.caught_by));
  const rest = open.filter(each => !isText(each.caught_by));
  return [...rest.filter(each => each.recommended), ...rest.filter(each => !each.recommended), ...caught];
}

/**
 * The candidates `run` met again, each with its state and the candidate while
 * it is open. A merged one is left out: its sightings count for the candidate
 * it went into, which is listed instead.
 */
function attachedOf(index, run, lines = new Map()) {
  const out = [];
  for (const record of [...index.candidates].sort(byId)) {
    if (record.state === 'merged') continue;
    const sighting = index.sightings(record).slice(1).find(each => each.run === run);
    if (!sighting) continue;
    const state = stateOf(index, record);
    const owner = index.runs.get(record.seen_in[0].run);
    out.push({
      run: record.seen_in[0].run, id: record.id, evidence: sighting.evidence,
      ...(lines.has(record.id) ? { line: lines.get(record.id) } : {}),
      state, candidate: state === 'open' ? { ...decorate(index, record), dir: owner.dir } : null,
    });
  }
  return out;
}

/** A run's candidates file, read loosely for what only it holds: already-held lines, attachments' wording, the dropped count. */
function runExtras(dir) {
  try {
    const doc = readJson(path.join(dir, CANDIDATES));
    const lines = new Map();
    for (const entry of Array.isArray(doc?.attached) ? doc.attached : []) {
      if (isText(entry?.id) && isText(entry?.line) && !isText(entry?.run)) lines.set(entry.id, entry.line);
    }
    return {
      doc,
      already_held: Array.isArray(doc?.already_held) ? doc.already_held.filter(entry => typeof entry?.line === 'string') : [],
      lines,
    };
  } catch {
    return { doc: null, already_held: [], lines: new Map() };
  }
}

const offers = (index, run) => openOf(index, run).length > 0 || attachedOf(index, run).some(each => each.state === 'open');

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.run.localeCompare(a.run);

function report(index, chosen, problems) {
  const extras = chosen ? runExtras(chosen.dir) : null;
  // Runs compare by their `<type>/<name>` id, so the chosen run is left out however its path was spelled.
  const rest = [...index.runs.values()].filter(each => each.run !== chosen?.run && openOf(index, each.run).length).sort(newestFirst);
  return {
    run: chosen ? { dir: chosen.dir, type: chosen.type, name: chosen.name } : null,
    candidates: chosen ? openOf(index, chosen.run) : [],
    already_held: chosen ? extras.already_held : [],
    attached: chosen ? attachedOf(index, chosen.run, extras.lines) : [],
    others: rest.map(each => ({ dir: each.dir, count: openOf(index, each.run).length })),
    closed: closedOf(index),
    problems,
  };
}

function latest(tasks, today) {
  const problems = [];
  const { records } = loadStore(tasks, problems, today);
  const index = indexOf(tasks, records, { today });
  const chosen = [...index.runs.values()].filter(each => offers(index, each.run)).sort(newestFirst)[0] ?? null;
  return report(index, chosen, problems);
}

function show(dir, tasks, today) {
  const problems = [];
  const { records } = loadStore(tasks, problems, today);
  const index = indexOf(tasks, records, { today });
  const run = runId(dir);
  let chosen = index.runs.get(run) ?? null;
  if (chosen) chosen = { ...chosen, dir };
  else if (fs.existsSync(path.join(dir, CANDIDATES))) chosen = { run, type: path.basename(path.dirname(dir)), name: path.basename(dir), dir };
  else problems.push({ path: path.join(dir, CANDIDATES), message: 'could not read the candidates: no such file, and the store holds no candidate this run filed or met' });
  return report(index, chosen, problems);
}

function queue(tasks, skip, today) {
  const problems = [];
  const { records } = loadStore(tasks, problems, today);
  const index = indexOf(tasks, records, { skip: skip ? runId(skip) : null, today });
  const owners = [...index.runs.values()].sort((a, b) => a.date.localeCompare(b.date) || a.run.localeCompare(b.run));
  const entries = [];
  for (const owner of owners) {
    for (const record of index.candidates.filter(each => each.seen_in[0].run === owner.run && stateOf(index, each) === 'open').sort(byId)) {
      const candidate = decorate(index, record);
      entries.push({
        run: owner.run, dir: owner.dir, date: record.seen_in[0].date, id: record.id, label: record.label,
        rule: ruleOf(record.line), action: record.action, extends: record.extends,
        destination: record.destination, seen_in: candidate.seen_in,
        recommended: candidate.recommended, reason: candidate.reason, caught_by: record.caught_by,
      });
    }
  }
  return { queue: entries, closed: closedOf(index), problems };
}

/** One queue entry as its text line. */
function queueLine(entry) {
  const action = entry.action === 'extend' && entry.extends ? `extend ${entry.extends}` : entry.action;
  return `${entry.id} [${action}; seen in ${entry.seen_in.length}] ${entry.label}: ${entry.rule}`;
}

// --- writing: file, applied, dismiss, merge --------------------------------------

/**
 * File the run at `dir` in the store: its first five new candidates, and its
 * sighting on each candidate it attached to; then write its candidates file
 * back as version 3, each candidate naming its store id. A file a fold-in
 * marked files only the candidates it names in the store, and keeps the rest.
 */
function file(dir, tasks, today) {
  const problems = [];
  const read = readRun(dir, problems);
  if (!read) return { ok: false, refused: problems.map(problem => problem.message) };
  const { store, records } = loadStore(tasks, problems, today);
  const run = runId(dir);
  const date = runDate(path.basename(dir), read.mtime);
  const changed = new Set();
  const folded = Boolean(read.doc.folded);
  const kept = folded ? read.candidates.filter(each => isText(each.entry.store)) : read.candidates.slice(0, CAP);
  const over = folded ? 0 : read.candidates.length - kept.length;
  const filed = [];
  for (const { entry, evidence } of kept) {
    let record = filedAs(records, run, entry.id);
    if (!record) {
      record = recordOf(entry, evidence, run, date);
      records.set(record.id, record);
      changed.add(record.id);
    }
    entry.store = record.id;
    filed.push(record.id);
  }
  const attached = [];
  for (const { entry, evidence } of read.attached) {
    const target = targetOf(records, entry);
    if (!target) {
      problems.push({ path: read.file, message: `attachment ${entry.id} names no candidate in the store` });
      continue;
    }
    if (target.seen_in[0].run === run) continue;
    entry.id = target.id;
    delete entry.run;
    if (sight(target, run, date, evidence)) changed.add(target.id);
    attached.push(target.id);
  }
  writeStore(store, records, changed);
  const dropped = (Number.isInteger(read.doc.dropped) ? read.doc.dropped : 0) + over;
  const doc = { ...read.doc, version: RUN_VERSION, candidates: folded ? read.doc.candidates : kept.map(each => each.entry), dropped };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (fs.readFileSync(read.file, 'utf8') !== text) writeWhole(read.file, text);
  return { ok: true, run, filed, attached, dropped, problems };
}

/** How many candidates in the store are still open: neither applied, dismissed nor merged. */
const leftOf = records => [...records.values()].filter(record => record.state === 'open').length;

/** Why a closed candidate cannot be taken: what closed it. */
function closedAs(record) {
  if (record.state === 'applied') return `${record.id} is already applied`;
  if (record.state === 'merged') return `${record.id} is merged into ${record.closed?.into ?? 'another candidate'}`;
  return `${record.id} is dismissed`;
}

function applied(tasks, ids, today) {
  const problems = [];
  const { store, records } = loadStore(tasks, problems, today);
  const unknown = ids.filter(id => !records.has(id));
  if (unknown.length) return { ok: false, refused: unknown.map(id => `${id} is not a candidate in the store`) };
  const merged = [...new Set(ids)].filter(id => records.get(id).state === 'merged');
  if (merged.length) return { ok: false, refused: merged.map(id => closedAs(records.get(id))) };
  const changed = new Set();
  for (const id of ids) {
    const record = records.get(id);
    if (record.state === 'applied') continue;
    record.state = 'applied';
    record.closed = { date: today };
    changed.add(id);
  }
  writeStore(store, records, changed);
  return { ok: true, applied: [...new Set(ids)], left: leftOf(records) };
}

function dismiss(tasks, { ids, all, run, reason, by, today }) {
  const problems = [];
  const { store, records } = loadStore(tasks, problems, today);
  const owner = all ? runId(path.resolve(run)) : null;
  const chosen = all ? [...records.values()].filter(record => record.seen_in[0].run === owner && record.state !== 'applied' && record.state !== 'merged').map(record => record.id).sort() : [...new Set(ids)];
  const refused = [
    ...chosen.filter(id => !records.has(id)).map(id => `${id} is not a candidate in the store`),
    ...chosen.filter(id => ['applied', 'merged'].includes(records.get(id)?.state)).map(id => closedAs(records.get(id))),
  ];
  if (refused.length) return { ok: false, refused };
  for (const id of chosen) {
    const record = records.get(id);
    record.state = 'dismissed';
    record.closed = { reason: reason.trim(), by: by.trim(), date: today };
  }
  writeStore(store, records, new Set(chosen));
  return { ok: true, dismissed: chosen, left: leftOf(records) };
}

/**
 * Close each of `ids` as merged into `into`, its sightings added to `into`'s,
 * one a run. A candidate already merged into `into` is skipped, so merging
 * again writes nothing.
 */
function merge(tasks, into, ids, today) {
  const problems = [];
  const { store, records } = loadStore(tasks, problems, today);
  const chosen = [...new Set(ids)];
  const refused = [
    ...[into, ...chosen].filter(id => !records.has(id)).map(id => `${id} is not a candidate in the store`),
    ...(chosen.includes(into) ? [`${into} cannot be merged into itself`] : []),
  ];
  if (refused.length) return { ok: false, refused };
  const target = records.get(into);
  const todo = chosen.filter(id => !(records.get(id).state === 'merged' && records.get(id).closed?.into === into));
  refused.push(...todo.filter(id => records.get(id).state !== 'open').map(id => closedAs(records.get(id))));
  if (todo.length && target.state !== 'open') refused.push(`${closedAs(target)}, so nothing can be merged into it`);
  if (refused.length) return { ok: false, refused };
  const changed = new Set();
  for (const id of todo) {
    const record = records.get(id);
    for (const each of record.seen_in) {
      if (sight(target, each.run, each.date, each.evidence)) changed.add(into);
    }
    record.state = 'merged';
    record.closed = { into, date: today };
    changed.add(id);
  }
  writeStore(store, records, changed);
  return { ok: true, into, merged: chosen, seen_in: target.seen_in.length, left: leftOf(records) };
}

// --- the close ------------------------------------------------------------

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The lines a run's close carries about its candidates, in its candidates file's order. */
function close(dir, tasks, today) {
  const problems = [];
  const { store, records } = loadStore(tasks, problems, today);
  const index = indexOf(tasks, records, { today });
  const run = runId(dir);
  const extras = runExtras(dir);
  const order = (Array.isArray(extras.doc?.candidates) ? extras.doc.candidates : []).map(entry => entry?.store).filter(isText);
  const own = index.candidates.filter(record => record.seen_in[0].run === run)
    .sort((a, b) => ((order.indexOf(a.id) + 1) || Infinity) - ((order.indexOf(b.id) + 1) || Infinity) || byId(a, b));
  const met = attachedOf(index, run);
  const dropped = Number.isInteger(extras.doc?.dropped) ? extras.doc.dropped : 0;
  const unconsolidated = extras.doc?.consolidated === false;
  const merges = [];
  for (const entry of Array.isArray(extras.doc?.merges) ? extras.doc.merges : []) {
    const target = isText(entry?.into) ? records.get(entry.into) : null;
    const ids = (Array.isArray(entry?.ids) ? entry.ids : []).filter(id => records.get(id)?.state === 'merged' && records.get(id).closed?.into === entry.into);
    if (target && ids.length) merges.push({ target, ids });
  }
  if (!own.length && !met.length && !merges.length && !extras.already_held.length && !dropped) return { lines: [], problems };
  const where = path.relative(process.cwd(), store).split(path.sep).join('/') || '.';
  const closedNote = (state, record) => {
    if (state === 'open') return '';
    return state === 'merged' ? ` (merged into ${record.closed?.into ?? 'another candidate'})` : ` (${state})`;
  };
  const lines = [`Standard candidates of ${run} (${dir}), filed in ${where}/:`];
  for (const record of own) {
    const each = decorate(index, record);
    const kind = each.action === 'extend' ? `Extend${each.extends ? ` ${each.extends}` : ''}` : 'New';
    const backing = each.recommended ? `recommended (${each.reason})` : `seen in ${plural(each.seen_in.length, 'run')}${each.caught_by ? `, caught by ${each.caught_by}` : ''}`;
    lines.push(`- ${kind}, ${backing}: ${each.label} → ${each.destination}; evidence: ${each.evidence || 'none named'} [${each.id}]${closedNote(each.state, record)}`);
  }
  for (const each of met) {
    const record = records.get(each.id);
    const decorated = decorate(index, record);
    const backing = decorated.recommended ? `, recommended (${decorated.reason})` : '';
    lines.push(`- Seen again: ${record.label}, now seen in ${plural(decorated.seen_in.length, 'run')}${backing} [${each.id}]${closedNote(each.state, record)}`);
  }
  for (const { target, ids } of merges) {
    const decorated = decorate(index, target);
    const backing = decorated.recommended ? `, recommended (${decorated.reason})` : '';
    const labels = ids.map(id => records.get(id).label).join('; ');
    lines.push(`- Merged as one lesson: ${labels} into ${target.label}, now seen in ${plural(decorated.seen_in.length, 'run')}${backing} [${ids.join(', ')} → ${target.id}]${closedNote(decorated.state, target)}`);
  }
  for (const held of extras.already_held) lines.push(`- Already held: ${ruleOf(held.line)} — held by ${held.held_by ?? 'an existing rule'}`);
  if (dropped) lines.push(`- Dropped over the cap of five: ${plural(dropped, 'new lesson')}`);
  if (unconsolidated) lines.push('- Not consolidated: the work log\'s lines as written');
  return { lines, problems };
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
    const tasks = path.resolve(flags.tasks ?? DEFAULT_TASKS);
    const today = flags.today ?? new Date().toISOString().slice(0, 10);
    const runDir = flags.run ? path.resolve(flags.run) : null;
    if (flags.verb === 'file') result = file(runDir, tasks, today);
    else if (flags.verb === 'close') result = close(runDir, tasks, today);
    else if (flags.verb === 'latest') result = latest(tasks, today);
    else if (flags.verb === 'show') result = show(runDir, tasks, today);
    else if (flags.verb === 'queue') result = queue(tasks, flags.skip ? path.resolve(flags.skip) : null, today);
    else if (flags.verb === 'applied') result = applied(tasks, flags.ids, today);
    else if (flags.verb === 'dismiss') result = dismiss(tasks, { ...flags, today });
    else if (flags.verb === 'merge') result = merge(tasks, flags.into, flags.ids, today);
    else {
      const problems = [];
      const store = path.join(path.dirname(tasks), STORE);
      result = { ...foldIn(tasks, store, readStore(store, problems), problems, today), problems };
    }
  } catch (error) {
    process.stderr.write(`candidates: ${error.message}\n`);
    return EXIT.INTERNAL;
  }
  for (const notice of notices) process.stderr.write(`candidates: ${notice}\n`);
  if ((flags.verb === 'queue' && !flags.json) || flags.verb === 'close') {
    for (const problem of result.problems) process.stderr.write(`candidates: ${problem.path}: ${problem.message}\n`);
    const lines = flags.verb === 'close' ? result.lines : result.queue.map(queueLine);
    process.stdout.write(lines.map(line => `${line}\n`).join(''));
    return EXIT.OK;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok === false ? EXIT.REFUSED : EXIT.OK;
}

process.exitCode = main();
