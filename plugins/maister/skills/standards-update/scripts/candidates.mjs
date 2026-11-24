/**
 * The standard candidates finished workflow runs handed over: the open queue
 * across runs, which run holds some still to apply, and which of them a person
 * has applied since.
 *
 *   node <path to this file> latest [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> show --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>]
 *   node <path to this file> queue [--tasks=<dir>] [--skip=<task dir>] [--today=<YYYY-MM-DD>] [--json]
 *   node <path to this file> applied --run=<task dir> --id=<id> [--id=<id> ...]
 *   node <path to this file> dismiss --run=<task dir> (--id=<id> ... | --all) --reason=<text> --by=<name> [--today=<YYYY-MM-DD>]
 *
 * A run's finalization writes `standard-candidates.json` into its task
 * directory, in the shape docs-manager's standard candidates reference
 * describes (*The run's candidates file*). This script never changes that
 * file: what has been applied or dismissed is kept beside it, in
 * `standard-candidates-applied.json` (`{applied: [id, ...], dismissed: {id:
 * {reason, by, date}}}`), so the candidates file's modification time stays the
 * moment its run finished.
 *
 * A candidate's state is read, never stored: `applied`, else `dismissed`, else
 * `expired` — seen in one run only, that run dated more than 30 days before
 * `--today` (default: today, in UTC) — else `open`. A run is dated by the
 * `YYYY-MM-DD` its directory name opens with, else by its candidates file's
 * modification day. Only an open candidate is offered or queued; the reports'
 * `closed` counts the rest, `{applied, dismissed, expired}`.
 *
 * A run is named `<type>/<name>`, its task directory's last two folders, with a
 * forward slash on every system. A candidates file's `attached` entries,
 * `{run, id, evidence}`, are that run's repeats of an earlier run's candidate:
 * each counts toward that candidate's `seen_in`, the runs that met the lesson,
 * its own run first.
 *
 * `latest` looks at every `<tasks>/<type>/<run>/standard-candidates.json`
 * (`--tasks` defaults to `.maister/tasks` under the current directory, so a
 * caller runs it from the project root), sets aside the candidates closed,
 * and passes over a run with nothing left to offer: no open candidate
 * of its own and no open candidate it attached to. Of the rest the newest file
 * wins, its path breaking a tie. It prints `{run, candidates, already_held,
 * attached, others, problems}`: `run` is `{dir, type, name}` or null when no
 * run holds a candidate to apply; each candidate carries its `run`, its
 * `seen_in`, and `recommended` with its `reason`, worked out here — seen in two
 * runs or more, or guarding security or data loss, never with a `caught_by` —
 * the recommended listed first and those a check catches last; `attached` is the run's attachments, each with the `state` of the
 * candidate it names and that `candidate` while it is open; `others` is every
 * other run with an open candidate, `{dir, count}`, newest first; `problems`
 * names each file that could not be read and each entry that is not a
 * candidate or an attachment, `{path, message}` — never a reason to fail.
 *
 * `show` prints the same report for the one run named — the run whose close a
 * person has in front of them — its candidates less the ones already applied
 * (none, when all are), and `others` the runs under `--tasks` that still hold
 * some. A run whose candidates file cannot be read is `run: null`, the file
 * named under `problems`.
 *
 * `queue` lists every open candidate under `--tasks`, the run `--skip` names
 * left out: one line each, oldest run first, or with `--json` one document.
 * The reference's *The open queue* gives both shapes.
 *
 * `applied` adds the ids to the run's applied file, once each, and takes them
 * off its dismissed ones; `dismiss` records the ids, or with `--all` every
 * candidate of the run not applied, with the reason, who dismissed them and
 * the day. Either writes the file whole through a temporary file and a rename;
 * an id the run's candidates file does not hold is refused, and so is
 * dismissing an applied one, and then nothing is recorded.
 *
 * Exit 0 when the verb did its work, 1 when `applied` or `dismiss` refused, 2 on a usage
 * error or a file this script could not write. Exec form, no shebang, zero
 * dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };

const CANDIDATES = 'standard-candidates.json';
const APPLIED = 'standard-candidates-applied.json';
const DEFAULT_TASKS = path.join('.maister', 'tasks');
const USAGE = 'usage: node candidates.mjs latest [--tasks=<dir>] [--today=<YYYY-MM-DD>] | show --run=<task dir> [--tasks=<dir>] [--today=<YYYY-MM-DD>] | queue [--tasks=<dir>] [--skip=<task dir>] [--today=<YYYY-MM-DD>] [--json] | applied --run=<task dir> --id=<id> [--id=<id> ...] | dismiss --run=<task dir> (--id=<id> ... | --all) --reason=<text> --by=<name> [--today=<YYYY-MM-DD>]';
const VERBS = ['latest', 'show', 'queue', 'applied', 'dismiss'];

/** Days a candidate seen in one run only stays open. */
const EXPIRY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields every candidate carries as a non-empty string. */
const REQUIRED = ['id', 'label', 'line', 'destination'];

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
    const match = /^--(tasks|run|id|skip|today|reason|by)=(.+)$/.exec(arg);
    if (!match) throw new UsageError(`unknown argument ${arg}`);
    const [, name, value] = match;
    if (name === 'id') flags.ids.push(value);
    else flags[name] = value;
  }
  const given = { run: flags.run, id: flags.ids.length, skip: flags.skip, json: flags.json, tasks: flags.tasks, today: flags.today, reason: flags.reason, by: flags.by, all: flags.all };
  const only = allowed => Object.entries(given).every(([name, value]) => !value || allowed.includes(name));
  if (verb === 'latest' && !only(['tasks', 'today'])) throw new UsageError('latest takes only --tasks and --today');
  if (verb === 'show' && (!flags.run || !only(['run', 'tasks', 'today']))) throw new UsageError('show takes --run and optionally --tasks and --today');
  if (verb === 'queue' && !only(['tasks', 'skip', 'today', 'json'])) throw new UsageError('queue takes --tasks, --skip, --today and --json, each optional');
  if (verb === 'applied' && (!flags.run || !flags.ids.length || !only(['run', 'id']))) throw new UsageError('applied takes --run and at least one --id');
  if (verb === 'dismiss' && (!flags.run || !flags.reason?.trim() || !flags.by?.trim() || (flags.ids.length > 0) === flags.all || !only(['run', 'id', 'all', 'reason', 'by', 'today']))) {
    throw new UsageError('dismiss takes --run, either --id ones or --all, --reason and --by, and optionally --today');
  }
  if (flags.today !== undefined && !isDay(flags.today)) throw new UsageError(`--today takes a day as YYYY-MM-DD, not ${flags.today}`);
  return flags;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** A run's name in the files: `<type>/<name>`, a forward slash on every system. */
function runId(dir) {
  return `${path.basename(path.dirname(dir))}/${path.basename(dir)}`;
}

function isDay(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

/** The day a run is dated: its directory name's `YYYY-MM-DD` prefix, else its candidates file's modification day. */
function runDate(name, mtime) {
  const prefix = /^(\d{4}-\d{2}-\d{2})(?:-|$)/.exec(name)?.[1];
  if (prefix && isDay(prefix)) return prefix;
  return new Date(mtime).toISOString().slice(0, 10);
}

/**
 * What has been settled for the run at `dir`: the ids applied and the ids
 * dismissed, each with its record. An absent file settles none; so does an
 * unreadable one, named under `problems`. An earlier file holds no
 * `dismissed`, and so none.
 */
function settledOf(dir, problems) {
  const file = path.join(dir, APPLIED);
  const none = { applied: new Set(), dismissed: new Map() };
  if (!fs.existsSync(file)) return none;
  try {
    const doc = readJson(file);
    const applied = new Set(Array.isArray(doc?.applied) ? doc.applied.filter(id => typeof id === 'string') : []);
    const dismissed = new Map();
    const recorded = doc?.dismissed && typeof doc.dismissed === 'object' && !Array.isArray(doc.dismissed) ? doc.dismissed : {};
    for (const [id, record] of Object.entries(recorded)) {
      if (record && typeof record === 'object') dismissed.set(id, { reason: String(record.reason ?? ''), by: String(record.by ?? ''), date: String(record.date ?? '') });
    }
    return { applied, dismissed };
  } catch (error) {
    problems.push({ path: file, message: `could not read what was applied: ${error.message}` });
    return none;
  }
}

/** Write a run's settled file whole, through a temporary file and a rename. */
function writeSettled(dir, settled) {
  const file = path.join(dir, APPLIED);
  const temporary = `${file}.${process.pid}.tmp`;
  const doc = { applied: [...settled.applied], dismissed: Object.fromEntries(settled.dismissed) };
  fs.writeFileSync(temporary, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

const isText = value => typeof value === 'string' && value.trim() !== '';

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
    const missing = REQUIRED.filter(field => !isText(entry?.[field]));
    if (missing.length) {
      problems.push({ path: file, message: `candidate ${index + 1} has no ${missing.join(', ')}` });
      continue;
    }
    // `recommended` and `reason` are worked out on read, never taken from the
    // file: support grows after a run writes it, and an earlier file used a
    // looser bar.
    const { recommended: _recommended, reason: _reason, ...rest } = entry;
    candidates.push(rest);
  }
  const attached = [];
  for (const [index, entry] of (Array.isArray(doc?.attached) ? doc.attached : []).entries()) {
    const missing = ['run', 'id'].filter(field => !isText(entry?.[field]));
    if (missing.length) {
      problems.push({ path: file, message: `attachment ${index + 1} has no ${missing.join(', ')}` });
      continue;
    }
    attached.push({ run: entry.run, id: entry.id, evidence: isText(entry.evidence) ? entry.evidence : '', ...(isText(entry.line) ? { line: entry.line } : {}) });
  }
  const held = Array.isArray(doc?.already_held) ? doc.already_held.filter(entry => typeof entry?.line === 'string') : [];
  return { file, candidates, attached, already_held: held, mtime: fs.statSync(file).mtimeMs };
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

/** One run, read whole: its candidates, attachments and applied ids; null when its file cannot be read. */
function loadRun(where, problems) {
  const read = readRun(where.dir, problems);
  if (!read) return null;
  return { ...where, run: runId(where.dir), ...read, date: runDate(where.name, read.mtime), settled: settledOf(where.dir, problems) };
}

const byAge = (a, b) => a.date.localeCompare(b.date) || a.run.localeCompare(b.run);

/**
 * Every readable run under `tasks` (and `extra`, when it lies elsewhere), the
 * run `skip` names left out, with what reading them across runs gives: each
 * candidate found by `<run>#<id>` and the runs that met it.
 */
function loadIndex(tasks, problems, { extra = null, skip = null, today }) {
  const wheres = runDirs(tasks).filter(where => where.dir !== skip);
  if (extra && !wheres.some(where => where.dir === extra.dir)) wheres.push(extra);
  const runs = wheres.map(where => loadRun(where, problems)).filter(Boolean);
  const byKey = new Map();
  for (const each of runs) for (const candidate of each.candidates) byKey.set(`${each.run}#${candidate.id}`, { owner: each, candidate });
  const sightings = new Map();
  for (const each of runs) {
    for (const attachment of each.attached) {
      const key = `${attachment.run}#${attachment.id}`;
      if (skip && attachment.run === runId(skip)) continue;
      if (!byKey.has(key)) {
        problems.push({ path: each.file, message: `attachment ${key} names no candidate` });
        continue;
      }
      if (!sightings.has(key)) sightings.set(key, new Map());
      sightings.get(key).set(each.run, each);
    }
  }
  const seenIn = (owner, candidate) => {
    const others = [...(sightings.get(`${owner.run}#${candidate.id}`)?.values() ?? [])].filter(each => each.run !== owner.run).sort(byAge);
    return [owner.run, ...others.map(each => each.run)];
  };
  return { runs, byKey, seenIn, today };
}

/** A candidate's state, worked out on read: applied, dismissed, expired or open. */
function stateOf(index, owner, candidate) {
  if (owner.settled.applied.has(candidate.id)) return 'applied';
  if (owner.settled.dismissed.has(candidate.id)) return 'dismissed';
  const age = (Date.parse(`${index.today}T00:00:00Z`) - Date.parse(`${owner.date}T00:00:00Z`)) / DAY_MS;
  if (age > EXPIRY_DAYS && index.seenIn(owner, candidate).length < 2) return 'expired';
  return 'open';
}

/** How many candidates under the index are closed, by state. */
function closedOf(index) {
  const closed = { applied: 0, dismissed: 0, expired: 0 };
  for (const owner of index.runs) {
    for (const candidate of owner.candidates) {
      const state = stateOf(index, owner, candidate);
      if (state !== 'open') closed[state] += 1;
    }
  }
  return closed;
}

const GUARDS = { security: 'security', 'data-loss': 'data loss' };

/**
 * Whether a candidate is recommended, and why: seen in two runs or more, or
 * guarding security or data loss. Nothing else earns it, and a candidate a
 * check already catches never does.
 */
function support(candidate, seenIn) {
  if (isText(candidate.caught_by)) return { recommended: false, reason: null };
  const reasons = [];
  if (seenIn.length >= 2) reasons.push(`seen in ${seenIn.length} runs`);
  if (Object.hasOwn(GUARDS, candidate.guards)) reasons.push(`guards ${GUARDS[candidate.guards]}`);
  return { recommended: reasons.length > 0, reason: reasons.length ? reasons.join('; ') : null };
}

/** A candidate as the reports print it: its run, the runs that met it, and whether it is recommended. */
function decorate(index, owner, candidate) {
  const seenIn = index.seenIn(owner, candidate);
  return { ...candidate, run: owner.run, seen_in: seenIn, ...support(candidate, seenIn) };
}

/** A run's open candidates: the recommended, then the rest, then those a check already catches, each group in file order. */
function openOf(index, owner) {
  const open = owner.candidates.filter(candidate => stateOf(index, owner, candidate) === 'open').map(candidate => decorate(index, owner, candidate));
  const caught = open.filter(each => isText(each.caught_by));
  const rest = open.filter(each => !isText(each.caught_by));
  return [...rest.filter(each => each.recommended), ...rest.filter(each => !each.recommended), ...caught];
}

/** A run's attachments, each with the state of the candidate it names and that candidate while it is open. */
function attachedOf(index, owner) {
  return owner.attached.map(attachment => {
    const target = index.byKey.get(`${attachment.run}#${attachment.id}`);
    const state = target ? stateOf(index, target.owner, target.candidate) : 'unknown';
    const candidate = state === 'open' ? { ...decorate(index, target.owner, target.candidate), dir: target.owner.dir } : null;
    return { ...attachment, state, candidate };
  });
}

const offers = (index, owner) => openOf(index, owner).length > 0 || attachedOf(index, owner).some(each => each.state === 'open');

const newestFirst = (a, b) => b.mtime - a.mtime || b.dir.localeCompare(a.dir);

function report(index, chosen, problems) {
  const rest = index.runs.filter(each => each !== chosen && openOf(index, each).length).sort(newestFirst);
  return {
    run: chosen ? { dir: chosen.dir, type: chosen.type, name: chosen.name } : null,
    candidates: chosen ? openOf(index, chosen) : [],
    already_held: chosen ? chosen.already_held : [],
    attached: chosen ? attachedOf(index, chosen) : [],
    others: rest.map(each => ({ dir: each.dir, count: openOf(index, each).length })),
    closed: closedOf(index),
    problems,
  };
}

function latest(tasks, today) {
  const problems = [];
  const index = loadIndex(tasks, problems, { today });
  const chosen = index.runs.filter(each => offers(index, each)).sort(newestFirst)[0] ?? null;
  return report(index, chosen, problems);
}

function show(dir, tasks, today) {
  const problems = [];
  const where = { dir, type: path.basename(path.dirname(dir)), name: path.basename(dir) };
  const exists = fs.existsSync(path.join(dir, CANDIDATES));
  if (!exists) problems.push({ path: path.join(dir, CANDIDATES), message: 'could not read the candidates: no such file' });
  const index = loadIndex(tasks, problems, { extra: exists ? where : null, today });
  return report(index, index.runs.find(each => each.dir === dir) ?? null, problems);
}

/** The rule part of a candidate line: its leading `- ` and everything from ` — why:` taken off. */
function ruleOf(line) {
  const text = line.replace(/^\s*-\s+/, '');
  const cut = text.indexOf(' — why:');
  return (cut === -1 ? text : text.slice(0, cut)).trim();
}

function queue(tasks, skip, today) {
  const problems = [];
  const index = loadIndex(tasks, problems, { skip, today });
  const entries = [];
  for (const owner of [...index.runs].sort(byAge)) {
    const open = new Map(openOf(index, owner).map(candidate => [candidate.id, candidate]));
    for (const candidate of owner.candidates.map(each => open.get(each.id)).filter(Boolean)) {
      entries.push({
        run: owner.run, dir: owner.dir, date: owner.date, id: candidate.id, label: candidate.label,
        rule: ruleOf(candidate.line), action: candidate.action === 'extend' ? 'extend' : 'new',
        extends: candidate.action === 'extend' && isText(candidate.extends) ? candidate.extends : null,
        destination: candidate.destination, seen_in: candidate.seen_in,
        recommended: candidate.recommended, reason: candidate.reason,
        caught_by: isText(candidate.caught_by) ? candidate.caught_by : null,
      });
    }
  }
  return { queue: entries, closed: closedOf(index), problems };
}

/** One queue entry as its text line. */
function queueLine(entry) {
  const action = entry.action === 'extend' && entry.extends ? `extend ${entry.extends}` : entry.action;
  return `${entry.run}#${entry.id} [${action}; seen in ${entry.seen_in.length}] ${entry.label}: ${entry.rule}`;
}

function applied(dir, ids) {
  const problems = [];
  const read = readRun(dir, problems);
  if (!read) return { ok: false, refused: problems.map(problem => problem.message) };
  const known = new Set(read.candidates.map(candidate => candidate.id));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) return { ok: false, refused: unknown.map(id => `${id} is not a candidate of this run`) };
  const settled = settledOf(dir, problems);
  for (const id of ids) {
    settled.applied.add(id);
    settled.dismissed.delete(id);
  }
  writeSettled(dir, settled);
  return { ok: true, applied: [...settled.applied], left: leftOf(read, settled) };
}

/** How many of a run's candidates are neither applied nor dismissed. */
function leftOf(read, settled) {
  return read.candidates.filter(candidate => !settled.applied.has(candidate.id) && !settled.dismissed.has(candidate.id)).length;
}

function dismiss(dir, { ids, all, reason, by, today }) {
  const problems = [];
  const read = readRun(dir, problems);
  if (!read) return { ok: false, refused: problems.map(problem => problem.message) };
  const settled = settledOf(dir, problems);
  const known = new Set(read.candidates.map(candidate => candidate.id));
  const chosen = all ? read.candidates.map(candidate => candidate.id).filter(id => !settled.applied.has(id)) : ids;
  const refused = [
    ...chosen.filter(id => !known.has(id)).map(id => `${id} is not a candidate of this run`),
    ...chosen.filter(id => settled.applied.has(id)).map(id => `${id} is already applied`),
  ];
  if (refused.length) return { ok: false, refused };
  for (const id of chosen) settled.dismissed.set(id, { reason: reason.trim(), by: by.trim(), date: today });
  writeSettled(dir, settled);
  return { ok: true, dismissed: [...settled.dismissed.keys()], left: leftOf(read, settled) };
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
    if (flags.verb === 'latest') result = latest(tasks, today);
    else if (flags.verb === 'show') result = show(path.resolve(flags.run), tasks, today);
    else if (flags.verb === 'queue') result = queue(tasks, flags.skip ? path.resolve(flags.skip) : null, today);
    else if (flags.verb === 'dismiss') result = dismiss(path.resolve(flags.run), { ...flags, today });
    else result = applied(path.resolve(flags.run), flags.ids);
  } catch (error) {
    process.stderr.write(`candidates: ${error.message}\n`);
    return EXIT.INTERNAL;
  }
  if (flags.verb === 'queue' && !flags.json) {
    for (const problem of result.problems) process.stderr.write(`candidates: ${problem.path}: ${problem.message}\n`);
    process.stdout.write(result.queue.map(entry => `${queueLine(entry)}\n`).join(''));
    return EXIT.OK;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok === false ? EXIT.REFUSED : EXIT.OK;
}

process.exitCode = main();
