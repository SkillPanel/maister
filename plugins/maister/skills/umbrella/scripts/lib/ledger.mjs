/**
 * The dispatch ledger: seven ops over file-canonical entries.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. Three files make up a
 * ledger and each answers a different question:
 *
 *   entries/<dispatch_id>.yml   what is true of this dispatch now (C3)
 *   index.yml                   what is true of every dispatch, regenerated
 *   ledger.log                  what happened, append-only, never rewritten
 *
 * The entry is canonical. The index is a derived summary and is rebuilt whole
 * on every mutation rather than patched, so it can never drift into a state no
 * entry supports. The log is neither: it is the record of completed facts, and
 * a line is appended **after** the entry rename, never before. Intent is not
 * recorded, because a log of intents cannot be replayed — a reader would have
 * no way to tell a line that landed from a line whose writer died between the
 * append and the rename.
 *
 * **The seven ops are the whole write surface** and their names are frozen by
 * C3. They are named exports first and a CLI second: the cockpit daemon vendors
 * this module out of the contracts archive and calls `closeOut(...)` in process,
 * with no subprocess and no JSON round trip. That is the reason the shared
 * primitives arrive through the sibling shims `./canonical.mjs` and
 * `./definition.mjs` — the same import lines resolve in the plugin tree and at
 * the flattened root of the archive, and nothing is rewritten at staging time.
 *
 * **Ownership is documented, not enforced** (`OWNERSHIP`). The engine owns
 * `create-entry`, `claim` and `update-status`; the daemon owns
 * `add-constraint`, `add-followup` and `close-out`; `query` is read-only.
 * Enforcing the split here would lock the daemon out of the very library it
 * vendors. It holds instead because each op writes only the fields its owner
 * owns, so two writers cannot contend for one field: the `updated` + actor
 * precedence rule resolves on read, and the only cross-writer effect left is
 * `updated`, which is why it is advanced with `laterOf` and never moved
 * backwards by a call that arrives late carrying an older `at`.
 *
 * **The lock is the temp.** A mutation opens `entries/<id>.yml.tmp` with `'wx'`,
 * writes the candidate into that descriptor and renames it over the entry — so
 * acquiring the lock and preparing the write are one act, and publishing it
 * releases the lock. Contention is named `ledger-locked` and the recovery is to
 * wait and re-issue the same op, never to delete the lock; a leftover older than
 * `STALE_TEMP_MS` is reclaimed automatically, which is what keeps a killed
 * writer from locking a dispatch forever.
 *
 * **Why the index write retries.** The entry lock is consumed by the rename, so
 * a second writer can enter its own critical section while the first is still
 * regenerating `index.yml`. The index temp is one name shared by every writer,
 * so that overlap is ordinary contention rather than a fault, and answering it
 * with a refusal after the entry is already on disk would report a failure for
 * a write that succeeded. It is retried a bounded number of times and only then
 * refused, with the entry reported as written and the index as behind.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Refusal, flow, commit, openTemp, claimLock, stamp, STALE_TEMP_MS } from './canonical.mjs';
import { readDefinition } from './definition.mjs';

// ---------------------------------------------------------------------------
// the frozen vocabulary
// ---------------------------------------------------------------------------

/**
 * Who owns each op. Documentation, addressed to a reader and to the two
 * runtimes that share this module — nothing here consults it.
 */
export const OWNERSHIP = Object.freeze({
  'create-entry': 'engine',
  claim: 'engine',
  'update-status': 'engine',
  'add-constraint': 'daemon',
  'add-followup': 'daemon',
  'close-out': 'daemon',
  query: 'reader',
});

/**
 * The closed refusal set, each with the recovery a caller is owed. Re-issuing
 * the same op is the correct move for exactly one of them — `ledger-locked` —
 * and is the failure mode for every caller defect below it.
 */
export const REFUSALS = Object.freeze({
  'ledger-locked': 'Another writer holds the entry or the allocation lock. Nothing was written. Wait and re-issue the same op; never delete the lock by hand — a leftover older than a minute is reclaimed by the next writer.',
  'ledger-entry-missing': 'No entry file exists for that dispatch id. Check the id, or create the entry first; re-issuing changes nothing.',
  'ledger-entry-exists': 'An entry file already exists for that dispatch id. Address it with the op you meant instead of creating it again.',
  'ledger-entry-unreadable': 'An entry file is on disk but outside the definition reader\'s subset. Repair the named file by hand; every write is blocked until it parses, because the index is regenerated from every entry.',
  'ledger-op-unknown': 'The op is not one of the frozen seven. Correct the op name; the set does not grow without a contract bump.',
  'ledger-args-invalid': 'The op arguments are missing a required field or carry an unusable value. Correct the arguments and re-issue.',
  'ledger-status-illegal': 'The status is outside the frozen enum, or the entry is closed and closed is terminal. Nothing was written.',
  'ledger-unwritable': 'The filesystem refused a read or a write the op depends on. Read `entry_written` before deciding: false (or absent) means nothing was published and the op may be re-issued once the path is writable; true means the entry is written and only the index regeneration failed, so the index is behind and any later op regenerates it — do not re-issue this one.',
  'ledger-temp-exists': 'The index temp is held by another writer and stayed held across every retry. The entry is written and the index is behind; re-issuing any op regenerates it. Do not re-issue this one — the mutation already landed and applying it twice is the failure this refusal is most often mistaken for.',
  'ledger-log-unappendable': 'The entry is written and the index is current, but ledger.log could not be appended to, so the log is behind by one line. Do not re-issue the op — the mutation already landed and applying it twice is the failure this refusal is mistaken for. Repair the log path; the entry itself is not in doubt.',
  'value-not-flow-safe': 'A value cannot be spelled on one line the readers can parse. It is refused rather than escaped; correct the value and re-issue.',
});

/** The frozen status enum (C3 `#/$defs/status`). */
const STATUSES = ['dispatched', 'claimed', 'in_progress', 'blocked', 'closed'];

/** The frozen grade enum, reached through C2 in the schema. */
const GRADES = ['success', 'partial', 'failed'];

const PROVIDERS = ['claude', 'copilot'];
const SESSION_STATUSES = ['spawned', 'running', 'paused', 'lost', 'closed'];
const SUBSTRATES = ['p', 'bg', 'manual'];
const FOLLOWUP_TO = ['parent', 'sibling'];
const FOLLOWUP_STATUSES = ['open', 'dispatched', 'dismissed'];

/** `common#/$defs/short_id` and `common#/$defs/timestamp`, restated. */
const SHORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The id form the fixture freezes, and the ordinal reader that matches it. */
const ID_PREFIX = 'd-';
const ID_WIDTH = 4;
const ORDINAL = /^d-(\d+)$/;

/** One `create-entry` line, read back for the allocation high-water mark. */
const CREATE_LINE = /^\S+ create-entry (\S+) \S+$/;

const ENTRIES_DIR = 'entries';
const INDEX_NAME = 'index.yml';
const INDEX_TMP = 'index.yml.tmp';
const LOG_NAME = 'ledger.log';
const ALLOCATION_LOCK = 'allocation.tmp';

/** The refusal names this module lends the shared publish path. */
const COMMIT_CODES = { unwritable: 'ledger-unwritable', tempExists: 'ledger-temp-exists' };

/** How hard the index regeneration tries before it calls contention a failure. */
const INDEX_ATTEMPTS = 6;
const INDEX_BACKOFF_MS = 25;

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

/**
 * Every path a ledger root implies. Exported because the daemon addresses the
 * same files, and a second spelling of `allocation.tmp` living somewhere else
 * is precisely the drift this module exists to avoid.
 *
 * Note where the allocation lock sits: beside `entries/`, never inside it, so
 * no scan of `entries/` ever has to know it is not an entry.
 */
export function ledgerPaths(root) {
  const base = path.resolve(String(root));
  return {
    base,
    entries: path.join(base, ENTRIES_DIR),
    index: path.join(base, INDEX_NAME),
    indexTmp: path.join(base, INDEX_TMP),
    log: path.join(base, LOG_NAME),
    allocation: path.join(base, ALLOCATION_LOCK),
  };
}

const entryPath = (p, id) => path.join(p.entries, `${id}.yml`);
const entryTemp = (p, id) => path.join(p.entries, `${id}.yml.tmp`);

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

function accepted(id, entry, extra) {
  return { ok: true, dispatch_id: id, entry, errors: [], ...extra };
}

/**
 * A refusal as a result. The `Refusal` message already carries its code as a
 * prefix — useful when it surfaces as an exception, noise when the code is a
 * field beside it — so the prefix is stripped here and nowhere else.
 */
function refused(err, id) {
  const prefix = `${err.code}: `;
  const message = err.message.startsWith(prefix) ? err.message.slice(prefix.length) : err.message;
  return {
    ok: false,
    dispatch_id: err.dispatch_id ?? id ?? null,
    entry: err.entry ?? null,
    errors: [{ code: err.code, message }],
    ...(err.report ?? {}),
  };
}

/**
 * Every op body runs inside this. A `Refusal` becomes a result the caller can
 * render; anything else propagates, because an unexpected throw is the tooling
 * failing rather than the input being wrong, and the entry point answers those
 * two with different exit codes.
 */
function guard(id, body) {
  try {
    return body();
  } catch (err) {
    if (err instanceof Refusal) return refused(err, id);
    throw err;
  }
}

/** Mark a refusal as having happened after the entry reached disk. */
function afterPublish(err, id, entry, report) {
  err.dispatch_id = id;
  err.entry = entry;
  err.report = { entry_written: true, ...report };
  return err;
}

// ---------------------------------------------------------------------------
// argument checking
// ---------------------------------------------------------------------------

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The actor, checked against the shape of the log line rather than against
 * taste: `<ts> <op> <dispatch_id> <actor>` is regex-frozen with `\S+` in the
 * last two fields, so an actor carrying a space would emit a line no reader of
 * the log can parse.
 */
function requireActor(actor) {
  if (typeof actor !== 'string' || actor === '' || /\s/.test(actor)) {
    throw new Refusal('ledger-args-invalid',
      `the actor ${JSON.stringify(String(actor))} must be one non-empty run of non-whitespace: it is the last field of the frozen ledger.log line`);
  }
  return actor;
}

function requireId(id, what = 'the dispatch id') {
  if (typeof id !== 'string' || !SHORT_ID.test(id) || /\s/.test(id)) {
    throw new Refusal('ledger-args-invalid', `${what} ${JSON.stringify(String(id))} is not a short id`);
  }
  return id;
}

/** An explicit `at` must be an A6 timestamp; an absent one is now. */
function requireAt(at) {
  if (at === null || at === undefined || at === '') return stamp();
  if (typeof at !== 'string' || !TIMESTAMP.test(at)) {
    throw new Refusal('ledger-args-invalid',
      `at ${JSON.stringify(String(at))} is not a whole-second UTC timestamp of the form 2026-08-30T09:15:00Z`);
  }
  return at;
}

function requireArgs(args) {
  if (args === null || args === undefined) return {};
  if (!isPlainObject(args)) throw new Refusal('ledger-args-invalid', 'the op arguments must be a map');
  return args;
}

function requireEnum(value, allowed, field, code = 'ledger-args-invalid') {
  if (!allowed.includes(value)) {
    throw new Refusal(code, `${field} ${JSON.stringify(String(value))} is outside the frozen set: ${allowed.join(', ')}`);
  }
  return value;
}

function requireMap(value, field) {
  if (!isPlainObject(value)) throw new Refusal('ledger-args-invalid', `${field} must be a map`);
  return value;
}

function requireList(value, field) {
  if (!Array.isArray(value)) throw new Refusal('ledger-args-invalid', `${field} must be a list`);
  return value;
}

/** Timestamps compare lexically in this form, which is the point of the form. */
const laterOf = (a, b) => (typeof a === 'string' && a > b ? a : b);

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * One entry, through the engine's reader. A file that is present but outside
 * the reader's subset is `ledger-entry-unreadable` rather than missing: the two
 * ask different things of an operator, and conflating them would let a
 * corrupted entry be silently overwritten by the next mutation.
 */
function readEntry(file) {
  if (!fs.existsSync(file)) {
    throw new Refusal('ledger-entry-missing', `${file} does not exist, so there is no entry to act on`);
  }
  const { doc, errors } = readDefinition(file);
  if (doc === null || !isPlainObject(doc)) {
    throw new Refusal('ledger-entry-unreadable', `${file} could not be read: ${errors[0]?.message ?? 'it is not a mapping'}`);
  }
  // A null-prototype map from the reader, lifted into an ordinary object so the
  // op bodies can spread and assign without inheriting the reader's shape.
  return Object.assign({}, doc);
}

/** Every entry file in the ledger, sorted, ignoring temps and anything else. */
function entryNames(p) {
  let names;
  try {
    names = fs.readdirSync(p.entries);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Refusal('ledger-entry-unreadable', `${p.entries} could not be listed: ${err.message}`);
  }
  return names
    .filter(name => name.endsWith('.yml'))
    .map(name => name.slice(0, -'.yml'.length))
    .filter(id => SHORT_ID.test(id))
    .sort();
}

/** The ids named by `create-entry` lines in the log, which outlive their files. */
function loggedCreations(p) {
  let text;
  try {
    text = fs.readFileSync(p.log, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    // The log is half the allocation high-water mark, so a log that cannot be
    // read cannot be reasoned about: allocating on the `entries/` half alone
    // would recycle the ordinal of a deleted entry. Nothing has been published
    // at this point, which is exactly what `ledger-unwritable` reports.
    throw new Refusal('ledger-unwritable',
      `${p.log} could not be read (${err.message}), so no dispatch id can be allocated without risking a reused ordinal. Nothing was written.`);
  }
  const ids = [];
  for (const raw of text.split('\n')) {
    const match = CREATE_LINE.exec(raw.replace(/\r$/, ''));
    if (match) ids.push(match[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// emission
// ---------------------------------------------------------------------------

/**
 * The entry document: scalars at column 0, `chain`, `target` and `session` as
 * one-line flow maps, `constraints` and `followups` as one-line flow sequences
 * of flow maps, `closeout` as a block map whose values are flow.
 *
 * **Why the sequences are not block sequences of flow maps**, which is how the
 * frozen fixture `synthetic/ledger-entry/d-0142.yml` spells them. Step 2 of the
 * mutating sequence reads the entry back with the engine's `readDefinition`,
 * and that reader refuses a mapping opened on a sequence dash — a guard whose
 * `ENTRY` test also matches a *flow* map on a dash, so `- {kind: merge_after}`
 * is rejected along with `- kind: merge_after`. An entry emitted in the
 * fixture's spelling would therefore be unreadable by the very library that
 * wrote it, and the second op against it would refuse
 * `ledger-entry-unreadable`. A read-mutate-write loop that cannot read its own
 * output is not a style question, so the emission takes the spelling both
 * halves agree on. The fixture is unchanged and still valid C3; reconciling the
 * two is a reader change in `definition.mjs`, which this module does not own.
 *
 * The key order is fixed here rather than taken from the object, so an entry
 * rewritten by the daemon and one rewritten by the engine are the same document
 * — a diff between two ledger states then shows what changed rather than who
 * wrote it last. Keys the caller added beyond the declared set are emitted
 * after them, in their own order, because C3 is additive and dropping them
 * would lose data a future contract declares.
 */
const DECLARED = [
  'version', 'dispatch_id', 'chain', 'target', 'provider', 'session',
  'status', 'grade', 'created', 'updated', 'constraints', 'followups', 'closeout',
];
const FLOW_MAPS = new Set(['chain', 'target', 'session']);
const SEQUENCES = new Set(['constraints', 'followups']);

function renderEntry(entry) {
  const lines = [];
  const extra = Object.keys(entry).filter(key => !DECLARED.includes(key));
  for (const key of [...DECLARED, ...extra]) {
    if (!Object.hasOwn(entry, key)) continue;
    const value = entry[key];
    if (SEQUENCES.has(key)) {
      lines.push(`${key}: ${flow(requireList(value, key), key)}`);
      continue;
    }
    if (key === 'closeout' && isPlainObject(value)) {
      lines.push('closeout:');
      for (const name of ['prs', 'commits', 'summary', 'at', ...Object.keys(value).filter(k => !['prs', 'commits', 'summary', 'at'].includes(k))]) {
        if (Object.hasOwn(value, name)) lines.push(`  ${name}: ${flow(value[name], `closeout.${name}`)}`);
      }
      continue;
    }
    if (FLOW_MAPS.has(key) && value !== null && value !== undefined && !isPlainObject(value)) {
      throw new Refusal('ledger-args-invalid', `${key} must be a map`);
    }
    lines.push(`${key}: ${flow(value, key)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The index, regenerated whole from every entry on disk. It carries only what a
 * reader needs to choose an entry to open — the summary is derived, so a stale
 * row is impossible by construction rather than by discipline.
 */
function renderIndex(rows) {
  const lines = ['version: 1'];
  // One flow sequence, for the same reason the entry's sequences are one: a
  // reader that cannot parse a flow map on a dash cannot parse the index
  // either, and the daemon reads this file with the reader it vendored.
  lines.push(`entries: ${flow(rows, 'entries')}`);
  return `${lines.join('\n')}\n`;
}

function indexRows(p) {
  const rows = [];
  for (const id of entryNames(p)) {
    const doc = readEntry(entryPath(p, id));
    const chain = isPlainObject(doc.chain) ? doc.chain : {};
    const target = isPlainObject(doc.target) ? doc.target : {};
    rows.push({
      dispatch_id: doc.dispatch_id ?? id,
      status: doc.status ?? null,
      grade: doc.grade ?? null,
      member: target.member ?? null,
      node: chain.node ?? null,
      created: doc.created ?? null,
      updated: doc.updated ?? null,
    });
  }
  return rows;
}

/** A synchronous pause, with no timer and no dependency. */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Regenerate the index, tolerating the one failure that is ordinary contention.
 * Every other refusal is final on the first attempt: an unreadable entry does
 * not become readable by waiting.
 */
function regenerateIndex(p) {
  for (let attempt = 1; ; attempt++) {
    try {
      commit({ target: p.index, text: renderIndex(indexRows(p)), tmp: p.indexTmp, codes: COMMIT_CODES });
      return;
    } catch (err) {
      const contended = err instanceof Refusal && err.code === 'ledger-temp-exists';
      if (!contended || attempt >= INDEX_ATTEMPTS) throw err;
      pause(INDEX_BACKOFF_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// the log
// ---------------------------------------------------------------------------

/**
 * One line, appended and fsynced. This is the step that is deliberately **not**
 * advisory: the trace writer in the gate library swallows its own failures
 * because a missing trace costs an operator nothing, while a missing ledger
 * line costs the next `create-entry` its high-water mark and would let a
 * `dispatch_id` be reused after a deletion. So a failure here is a refusal, and
 * it says plainly that the entry itself is fine.
 */
function appendLog(p, line) {
  let fd = null;
  try {
    fs.mkdirSync(p.base, { recursive: true });
    fd = fs.openSync(p.log, 'a');
    fs.writeSync(fd, `${line}\n`, null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor is being abandoned either way.
      }
    }
    throw new Refusal('ledger-log-unappendable',
      `${p.log} could not be appended to: ${err.message}. The entry is written and the index is current; the log is behind by this one line: "${line}"`);
  }
}

// ---------------------------------------------------------------------------
// locking and publishing
// ---------------------------------------------------------------------------

/**
 * Take the per-entry lock, which is the temp the candidate is written into.
 * Contention is reported with this module's own recovery rather than the shared
 * primitive's, because the shared one cannot know that re-issuing is safe here.
 */
function lockEntry(p, id) {
  const tmp = entryTemp(p, id);
  try {
    fs.mkdirSync(p.entries, { recursive: true });
  } catch (err) {
    throw new Refusal('ledger-unwritable', `${p.entries} could not be created: ${err.message}`);
  }
  try {
    return { tmp, fd: openTemp({ tmp, codes: COMMIT_CODES }) };
  } catch (err) {
    if (err instanceof Refusal && err.code === 'ledger-temp-exists') {
      throw new Refusal('ledger-locked',
        `${tmp} is held by another writer, so ${id} is locked. Nothing was written. Wait and re-issue the same op; never delete the lock by hand — a leftover older than ${STALE_TEMP_MS / 1000} seconds is reclaimed by the next writer.`);
    }
    if (err instanceof Refusal) throw err;
    throw new Refusal('ledger-unwritable', `the lock ${tmp} could not be taken: ${err.message}`);
  }
}

/** Release a lock that will not be published — the abort path, and only that. */
function releaseEntry(lock) {
  if (lock.fd !== null) {
    try {
      fs.closeSync(lock.fd);
    } catch {
      // Abandoned either way.
    }
    lock.fd = null;
  }
  fs.rmSync(lock.tmp, { force: true });
}

/**
 * Publish the candidate through the descriptor the lock already holds: write,
 * fsync, close, rename. The shared `commit` cannot be reused verbatim here
 * because it opens the temp itself, and the temp is not free to be opened
 * twice — it is the lock, and a second open would either refuse or race.
 */
function publishEntry(lock, target) {
  return text => {
    let fd = lock.fd;
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      lock.fd = null;
      fs.renameSync(lock.tmp, target);
    } catch (err) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Abandoned either way.
        }
        lock.fd = null;
      }
      fs.rmSync(lock.tmp, { force: true });
      throw new Refusal('ledger-unwritable', `${target} could not be written: ${err.message}`);
    }
  };
}

/**
 * The allocation lock — a lock and nothing else, so the shared claim fits.
 *
 * Two names go in, not one. A directory that cannot be created is
 * `ledger-unwritable`; only a held lock file is `ledger-locked`. They were one
 * name, and a permissions fault came back telling the caller to wait a minute
 * for a leftover to be reclaimed — advice that is wrong in every clause and
 * loops forever.
 */
function lockAllocation(p) {
  try {
    return claimLock(p.allocation, { code: 'ledger-locked', unwritable: 'ledger-unwritable' });
  } catch (err) {
    if (err instanceof Refusal && err.code === 'ledger-locked') {
      throw new Refusal('ledger-locked',
        `${p.allocation} is held by another writer, so no dispatch id can be allocated right now. Nothing was written. Wait and re-issue the same op; a leftover older than ${STALE_TEMP_MS / 1000} seconds is reclaimed by the next writer.`);
    }
    if (err instanceof Refusal) throw err;
    throw new Refusal('ledger-unwritable', `the allocation lock could not be taken: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// the mutating sequence
// ---------------------------------------------------------------------------

/**
 * The one order every mutating op runs in, expressed once:
 *
 *   lock → read → mutate → write and rename → regenerate index → append log
 *
 * `apply` is handed the entry and returns the mutated one. Everything before
 * the rename leaves the ledger byte-for-byte as it was on any refusal;
 * everything after it reports the entry as written, because it is.
 */
function mutate(op, call, apply) {
  const p = ledgerPaths(call.ledger);
  const actor = requireActor(call.actor);
  const at = requireAt(call.at);
  const args = requireArgs(call.args);
  const id = requireId(call.dispatch_id);
  const file = entryPath(p, id);

  if (!fs.existsSync(file)) {
    throw new Refusal('ledger-entry-missing', `${file} does not exist, so ${op} has no entry to act on`);
  }

  const lock = lockEntry(p, id);
  let entry;
  try {
    entry = readEntry(file);
    entry = apply(entry, { actor, at, args, op });
    entry.updated = laterOf(entry.updated, at);
    publishEntry(lock, file)(renderEntry(entry));
  } catch (err) {
    releaseEntry(lock);
    throw err;
  }

  finishMutation(p, op, id, actor, at, entry);
  return accepted(id, entry);
}

/**
 * The two steps that follow the rename, and the reporting they share.
 *
 * **The log goes first, and that order is the durability rule.** The index is
 * derived: it is regenerated whole from `entries/` by the next op that runs, so
 * an index that is behind repairs itself. The log is not derived by anything —
 * a line that is never appended is gone, and `create-entry` lines are the
 * high-water mark that makes "an ordinal is never reused" true across an
 * out-of-band entry deletion. Regenerating the index first meant an index
 * refusal — ordinary contention, retried and then reported — dropped the log
 * line permanently, which falsified the append-only claim through a path that
 * is not even a fault.
 *
 * It is *not* moved before the rename. A line appended before the rename
 * records an intent, and `publishEntry` has reachable refusals, so every one of
 * those would leave a line describing a mutation that never landed — trading a
 * rare durability gap for a common correctness one. The log stays a record of
 * completed facts; the fact it records is the rename, and it is written as soon
 * as the rename has happened.
 *
 * An unappendable log does not skip the index. The recovery text for
 * `ledger-log-unappendable` promises the index is current, so it is made
 * current before that refusal is raised.
 */
function finishMutation(p, op, id, actor, at, entry) {
  let logFailure = null;
  try {
    appendLog(p, `${at} ${op} ${id} ${actor}`);
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    logFailure = err;
  }
  try {
    regenerateIndex(p);
  } catch (err) {
    throw afterPublish(err, id, entry, { index_behind: true, ...(logFailure ? { log_behind: true } : {}) });
  }
  if (logFailure) throw afterPublish(logFailure, id, entry, { log_behind: true });
}

// ---------------------------------------------------------------------------
// id allocation
// ---------------------------------------------------------------------------

/**
 * The next id, one past the high-water mark of the ordinals in `entries/` **and**
 * the ordinals named by `create-entry` lines in the log.
 *
 * The log half is what makes "never reused" true. A scan of `entries/` alone
 * recycles the id of a deleted entry, and the recycled id then collides with
 * every artefact that outlives the entry — the outbox directory, the worktree
 * name, the log lines themselves. Deleting an entry does not free its ordinal.
 *
 * Past `d-9999` the ordinal grows a digit rather than wrapping; `d-10000`
 * satisfies `short_id`, and there is no reuse at any width.
 */
function nextDispatchId(p) {
  let high = 0;
  for (const id of [...entryNames(p), ...loggedCreations(p)]) {
    const match = ORDINAL.exec(id);
    if (match) high = Math.max(high, Number(match[1]));
  }
  return `${ID_PREFIX}${String(high + 1).padStart(ID_WIDTH, '0')}`;
}

// ---------------------------------------------------------------------------
// the seven ops
// ---------------------------------------------------------------------------

/**
 * Open a dispatch. The only op that allocates, and the only one that holds two
 * locks: the allocation lock across the decision, and the per-entry lock for the
 * id it chose, taken before the allocation lock is released so no second
 * allocator can pick the same ordinal out from under it.
 *
 * An explicit `dispatch_id` is honoured — the daemon may be re-creating an entry
 * whose id is already published — and an id whose file exists refuses
 * `ledger-entry-exists` rather than overwriting a dispatch someone is running.
 */
export function createEntry(call) {
  return guard(call?.dispatch_id ?? null, () => {
    const p = ledgerPaths(call.ledger);
    const actor = requireActor(call.actor);
    const at = requireAt(call.at);
    const args = requireArgs(call.args);

    const release = lockAllocation(p);
    let id;
    let lock;
    try {
      id = call.dispatch_id ? requireId(call.dispatch_id) : nextDispatchId(p);
      if (fs.existsSync(entryPath(p, id))) {
        throw new Refusal('ledger-entry-exists', `${entryPath(p, id)} already exists; create-entry never overwrites an entry`);
      }
      lock = lockEntry(p, id);
    } catch (err) {
      release();
      throw err;
    }

    let entry;
    try {
      entry = buildEntry(id, at, args);
      publishEntry(lock, entryPath(p, id))(renderEntry(entry));
    } catch (err) {
      releaseEntry(lock);
      release();
      throw err;
    }
    // Both locks were held across the decision and the write; the allocation
    // lock is released only once the id is unmistakably taken on disk.
    release();

    finishMutation(p, 'create-entry', id, actor, at, entry);
    return accepted(id, entry);
  });
}

/** The opening document. Every declared key is present, so a reader never guesses. */
function buildEntry(id, at, args) {
  const entry = {
    version: 1,
    dispatch_id: id,
    status: args.status === undefined ? 'dispatched' : requireEnum(args.status, STATUSES, 'status', 'ledger-status-illegal'),
    grade: null,
    created: at,
    updated: at,
    constraints: [],
    followups: [],
    closeout: null,
  };
  // `chain` and `target` are declared as objects with no null member, so an
  // absent one is omitted rather than written as null: emitting the null would
  // produce an entry that fails C3 the moment nobody supplied a chain.
  if (args.chain !== undefined && args.chain !== null) entry.chain = requireMap(args.chain, 'chain');
  if (args.target !== undefined && args.target !== null) entry.target = requireMap(args.target, 'target');
  if (args.provider !== undefined && args.provider !== null) {
    entry.provider = requireEnum(args.provider, PROVIDERS, 'provider');
  }
  if (args.session !== undefined && args.session !== null) {
    entry.session = checkSession(requireMap(args.session, 'session'));
  }
  return entry;
}

function checkSession(session) {
  if (session.substrate !== undefined && session.substrate !== null) {
    requireEnum(session.substrate, SUBSTRATES, 'session.substrate');
  }
  if (session.status !== undefined && session.status !== null) {
    requireEnum(session.status, SESSION_STATUSES, 'session.status');
  }
  return session;
}

/**
 * Bind a dispatched entry to the session that will run it. `claim` applies only
 * to a `dispatched` entry: claiming one that is already claimed, running or
 * closed would silently re-point a live dispatch at a second session, so it
 * refuses instead.
 *
 * `args.session` takes both spellings the transcript uses — a bare session name,
 * which is what the engine has at claim time, and the fuller map.
 */
export function claim(call) {
  return guard(call?.dispatch_id ?? null, () => mutate('claim', call, (entry, { args }) => {
    if (entry.status !== 'dispatched') {
      throw new Refusal('ledger-status-illegal',
        `${entry.dispatch_id} is ${entry.status}; claim applies only to a dispatched entry, and re-claiming one would re-point a live dispatch at a second session`);
    }
    const given = typeof args.session === 'string' ? { name: args.session } : requireMap(args.session ?? {}, 'session');
    checkSession(given);
    entry.session = { ...(isPlainObject(entry.session) ? entry.session : {}), ...given };
    entry.status = 'claimed';
    return entry;
  }));
}

/**
 * Move an open entry to another status. `closed` is terminal: the entry carries
 * a grade and a closeout by then, and a reopening would leave both describing a
 * run that no longer holds.
 */
export function updateStatus(call) {
  return guard(call?.dispatch_id ?? null, () => mutate('update-status', call, (entry, { args }) => {
    if (args.status === undefined) throw new Refusal('ledger-args-invalid', 'update-status needs args.status');
    const next = requireEnum(args.status, STATUSES, 'status', 'ledger-status-illegal');
    if (entry.status === 'closed') {
      throw new Refusal('ledger-status-illegal',
        `${entry.dispatch_id} is closed and closed is terminal, so it cannot move to ${next}`);
    }
    entry.status = next;
    return entry;
  }));
}

/**
 * Record an ordering or deploy constraint between this dispatch and another.
 *
 * **Idempotent on `{kind, ref}`.** A constraint has no id of its own, so an
 * unconditional append made the re-issue that three post-publish refusals ask
 * for silently multiply it: the entry was already on disk when the index or the
 * log refused, and the caller doing as it was told added a second and a third
 * copy. `add-followup` had the property already, through its id. Re-adding a
 * constraint the entry already carries is accepted and leaves the list as it
 * is rather than refused, because a refusal would make the same retry a hard
 * error for a caller that has no way to tell which of the two it is.
 */
export function addConstraint(call) {
  return guard(call?.dispatch_id ?? null, () => mutate('add-constraint', call, (entry, { args }) => {
    if (typeof args.kind !== 'string' || args.kind === '') {
      throw new Refusal('ledger-args-invalid', 'add-constraint needs a non-empty args.kind');
    }
    const constraint = { kind: args.kind, ref: args.ref ?? null };
    if (constraint.ref !== null) requireId(constraint.ref, 'the constraint ref');
    const existing = Array.isArray(entry.constraints) ? entry.constraints : [];
    const already = existing.some(item =>
      isPlainObject(item) && item.kind === constraint.kind && (item.ref ?? null) === constraint.ref);
    entry.constraints = already ? existing : [...existing, constraint];
    return entry;
  }));
}

/**
 * Record a follow-up. A child never messages a sibling directly: `to: sibling`
 * still names the parent as the route, and the addressee is who the parent is
 * being asked to reach.
 */
export function addFollowup(call) {
  return guard(call?.dispatch_id ?? null, () => mutate('add-followup', call, (entry, { args }) => {
    if (typeof args.id !== 'string' || args.id === '') {
      throw new Refusal('ledger-args-invalid', 'add-followup needs a non-empty args.id');
    }
    const existing = Array.isArray(entry.followups) ? entry.followups : [];
    if (existing.some(item => isPlainObject(item) && item.id === args.id)) {
      throw new Refusal('ledger-args-invalid', `${entry.dispatch_id} already carries a follow-up with the id ${args.id}`);
    }
    const followup = {
      id: args.id,
      to: args.to === undefined ? 'parent' : requireEnum(args.to, FOLLOWUP_TO, 'followup.to'),
      addressee: args.addressee === undefined ? {} : requireMap(args.addressee, 'followup.addressee'),
      summary: args.summary ?? null,
      artifacts: args.artifacts === undefined ? [] : requireList(args.artifacts, 'followup.artifacts'),
      status: args.status === undefined ? 'open' : requireEnum(args.status, FOLLOWUP_STATUSES, 'followup.status'),
    };
    entry.followups = [...existing, followup];
    return entry;
  }));
}

/**
 * Close the dispatch out: the grade, what shipped, and the terminal status, in
 * one write. The status transition belongs to the engine everywhere else; here
 * it rides with the close-out because a graded entry that is not closed would
 * describe a state no reader can act on.
 */
export function closeOut(call) {
  return guard(call?.dispatch_id ?? null, () => mutate('close-out', call, (entry, { args, at }) => {
    if (args.grade === undefined) throw new Refusal('ledger-args-invalid', 'close-out needs args.grade');
    const grade = requireEnum(args.grade, GRADES, 'grade');
    if (entry.status === 'closed') {
      throw new Refusal('ledger-status-illegal', `${entry.dispatch_id} is already closed`);
    }
    entry.grade = grade;
    entry.status = 'closed';
    entry.closeout = {
      prs: args.prs === undefined ? [] : requireList(args.prs, 'closeout.prs'),
      commits: args.commits === undefined ? [] : requireList(args.commits, 'closeout.commits'),
      summary: args.summary ?? null,
      at,
    };
    return entry;
  }));
}

/**
 * Read one entry. The only op that takes no lock and writes nothing — not the
 * entry, not the index, and not a log line. A reader that locked would block the
 * writers it is watching, which is the opposite of what a cockpit refresh is
 * for; and a reader that logged would grow the append-only file without a fact
 * to record, since nothing happened.
 */
export function query(call) {
  return guard(call?.dispatch_id ?? null, () => {
    const p = ledgerPaths(call.ledger);
    requireActor(call.actor);
    const id = requireId(call.dispatch_id);
    return accepted(id, readEntry(entryPath(p, id)));
  });
}

// ---------------------------------------------------------------------------
// the verb
// ---------------------------------------------------------------------------

/** The seven, by their frozen names. This map is the whole dispatch table. */
const OPS = {
  'create-entry': createEntry,
  claim,
  'update-status': updateStatus,
  'add-constraint': addConstraint,
  'add-followup': addFollowup,
  'close-out': closeOut,
  query,
};

/**
 * The `ledger` verb: one op, named on the command line, over the same functions
 * the daemon calls directly. Nothing is validated here that the ops do not
 * validate themselves — including `--dispatch-id`, whose presence is a flag
 * dependency the entry point already enforces for the six addressing ops.
 *
 * `Object.hasOwn` rather than `in`, so `constructor` is not a ledger op.
 */
export function ledger(options) {
  const call = options ?? {};
  const op = String(call.op);
  if (!Object.hasOwn(OPS, op)) {
    return {
      ok: false,
      op,
      dispatch_id: call.dispatch_id ?? null,
      entry: null,
      errors: [{
        code: 'ledger-op-unknown',
        message: `"${op}" is not a ledger op; the frozen seven are ${Object.keys(OPS).join(', ')}`,
      }],
    };
  }
  return { op, ...OPS[op](call) };
}
