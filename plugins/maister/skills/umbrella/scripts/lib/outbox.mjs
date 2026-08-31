/**
 * The outbox writer — one worker-to-parent message per file (contract C4).
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. Messages land at
 * `outbox/<dispatch_id>/<seq>-<type>.yml` with `seq` zero-padded to four
 * digits, and they are **append-only**: no file this writer has created is ever
 * opened for writing again, by this module or by any other. That is not a
 * convention, it is the mechanism — the sequenced name is claimed with
 * `openSync(…, 'wx')`, the exclusive create that is this repo's only locking
 * primitive, so two workers racing on the same dispatch cannot both take a
 * number. There is deliberately **no rename** here. Every other writer in this
 * plugin publishes through temp → fsync → rename because it overwrites a file
 * that already exists and a reader must never see it half-written; this one
 * writes a file no reader has ever seen, so the exclusivity has to live in the
 * name rather than in the swap.
 *
 * The five types and what each one owes, straight from C4's conditionals:
 *
 *   status     — nothing beyond the envelope
 *   followup   — `summary`
 *   artifact   — `path`
 *   blocked    — `reason`
 *   closeout   — `grade`
 *
 * The body is checked against that table *before* the filesystem is touched, so
 * a malformed message costs no directory, no descriptor and no sequence number.
 *
 * DEGRADED BEHAVIOUR, AND WHY IT COVERS ONLY TWO TYPES. When the outbox cannot
 * be written the information in the message is about to be lost, and C5's
 * marker vocabulary offers exactly two dispatch lines to save it with:
 * `DISPATCH-RESULT:` and `DISPATCH-FOLLOWUP:`. So `closeout` and `followup`
 * degrade — they report `{ok: true, degraded: true}` and hand the entry point a
 * `marker` to print as the last line, exit 0 — and `status`, `artifact` and
 * `blocked` refuse `outbox-unwritable` at exit 1. Inventing a third dispatch
 * line for them would freeze a sixth marker spelling into C5 to carry a status
 * update, and a lost status line is not a lost result: the caller retries once
 * the path is writable, or folds the fact into the eventual closeout summary.
 * Both printed strings are already frozen; nothing new is frozen here.
 *
 * The degradation is scoped to `outbox-unwritable` and to nothing else. A
 * `value-not-flow-safe` body would degrade into a marker built from the very
 * value that could not be spelled, and an `outbox-unreadable` or
 * `outbox-sequence-taken` outbox is one whose directory the writer *can* reach
 * — the recovery there is to run again, not to print and move on.
 *
 * This module prints nothing. The marker reaches stdout through the entry
 * point's generic mechanism (`umbrella.mjs`'s `report()`: the JSON document,
 * then a string `marker` as the last line), so the last-line rule is stated in
 * one place for every verb rather than re-implemented per module.
 *
 * The closed refusal set, with the recovery each one carries in its message:
 *
 *   outbox-type-invalid     the type is not one of C4's five
 *   outbox-message-invalid  the body fails the type's conditional requirement,
 *                           contradicts the flags, or claims a writer-owned key
 *   outbox-sequence-taken   the candidate name stayed taken for every attempt
 *   outbox-unwritable       the directory could not be created, the exclusive
 *                           open failed for a reason other than EEXIST, or the
 *                           fsync/close failed after a successful open — in
 *                           that last case the partial file is removed first
 *   outbox-unreadable       the dispatch directory exists but cannot be listed,
 *                           so no sequence number can be chosen
 *   value-not-flow-safe     a value cannot be spelled on one line; raised by
 *                           the shared emitter, never caught and re-coded here
 */

import fs from 'node:fs';
import path from 'node:path';

import { Refusal, flow, scalar, stamp } from './canonical.mjs';

/** C4's message types, and the one field each conditionally requires. */
const TYPES = {
  status: null,
  followup: 'summary',
  artifact: 'path',
  blocked: 'reason',
  closeout: 'grade',
};

/**
 * The prose fields, whose value is a sentence a model wrote rather than an
 * identifier a caller chose. A newline in one of them is collapsed on the way
 * in; every other value is emitted as it was given, or refused.
 *
 * `summary` is the field the whole degraded path exists for: a close-out or a
 * follow-up that cannot be written falls back to a printed line built from it.
 * Refusing a summary that carries a newline made that fallback unreachable for
 * exactly the message it was built to save.
 */
const PROSE = new Set(['summary', 'reason', 'detail']);

/** C4's grade enum, borrowed from the dispatch envelope it closes out. */
const GRADES = ['success', 'partial', 'failed'];

/** The envelope fields this writer owns; a body may not carry them. */
const WRITER_OWNED = ['version', 'at'];

/**
 * Fields a body may restate only in agreement with the flags. They are already
 * on the command line, and a body that disagrees is a caller bug worth naming
 * rather than a preference worth honouring.
 */
const ECHOED = ['type', 'dispatch_id'];

/** C4's `short_id`: what may be a dispatch id, and therefore a path segment. */
const SHORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A top-level key, emitted raw before its colon. Same rule as a flow key. */
const BLOCK_KEY = /^[A-Za-z0-9._-]+$/;

/** An already-written message file: `<seq>-<type>.yml`. */
const MESSAGE_FILE = /^(\d+)-[a-z]+\.yml$/;

/** The format version of every C4 document this writer emits. */
const VERSION = 1;

/**
 * How many times a taken candidate name is re-scanned before the writer gives
 * up. Each attempt re-reads the directory, so N attempts absorb N-1 messages
 * appended by other workers between this scan and this open — far past any real
 * dispatch, which appends a handful of messages over its whole life. The bound
 * exists so that a name that is permanently unavailable (something that is not
 * a message file sitting on it) ends in a named refusal rather than a spin.
 */
const MAX_ATTEMPTS = 8;

/**
 * The `outbox` verb.
 *
 * Synchronous, and returns rather than throws: `umbrella.mjs` calls it inside
 * `finish()`, which prints the result and maps `ok` onto the exit-code table.
 * Every refusal that is this writer's to make comes back as `{ok: false}` with
 * the code in `errors`; only a genuine internal fault is allowed to escape, and
 * the entry point turns that into exit 2.
 */
export function outbox({ outbox: outboxDir, dispatch_id: dispatchId, type, body }) {
  try {
    return writeMessage({ outbox: outboxDir, dispatch_id: dispatchId, type, body });
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    if (err.code === 'outbox-unwritable' && DEGRADES[type]) {
      return {
        ok: true,
        degraded: true,
        type,
        dispatch_id: dispatchId,
        written: null,
        marker: DEGRADES[type](body),
        errors: [{ code: err.code, message: err.message }],
      };
    }
    return {
      ok: false,
      degraded: false,
      type,
      dispatch_id: dispatchId,
      written: null,
      errors: [{ code: err.code, message: err.message }],
    };
  }
}

/**
 * The two degradations, keyed by the only two types C5 has a line for.
 *
 * The summary is collapsed onto one line because a marker *is* a line: a
 * reader takes the last line of the turn, and a newline in the middle of the
 * result would hand it half a sentence. Collapsing whitespace is not escaping
 * a stored value — nothing is stored on this path — it is fitting a printed
 * line to the shape the reader is frozen against.
 */
const DEGRADES = {
  closeout: body => `DISPATCH-RESULT: ${[body.grade, oneLine(body.summary)].filter(Boolean).join(' ')}`,
  followup: body => `DISPATCH-FOLLOWUP: ${oneLine(body.summary)}`,
};

function oneLine(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Append one message. The order is the contract: structure first, then the
 * directory, then the sequence, then the bytes — each step costing nothing if
 * the one before it failed.
 */
export function writeMessage({ outbox: outboxDir, dispatch_id: dispatchId, type, body }) {
  assertType(type);
  assertDispatchId(dispatchId);
  const document = assertBody({ dispatchId, type, body });

  const dir = path.join(path.resolve(outboxDir), dispatchId);
  makeDirectory(dir);

  const at = stamp();
  const text = render({ dispatchId, type, at, document });

  const { file, seq } = claimSequence(dir, type, text);
  return {
    ok: true,
    degraded: false,
    type,
    dispatch_id: dispatchId,
    seq,
    at,
    written: file,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// the structural check
// ---------------------------------------------------------------------------

function assertType(type) {
  if (!Object.hasOwn(TYPES, type)) {
    throw new Refusal('outbox-type-invalid',
      `"${type}" is not an outbox message type. Use one of ${Object.keys(TYPES).join(', ')}; nothing was written.`);
  }
}

function assertDispatchId(dispatchId) {
  if (typeof dispatchId !== 'string' || !SHORT_ID.test(dispatchId)) {
    throw new Refusal('outbox-message-invalid',
      `the dispatch id ${JSON.stringify(String(dispatchId))} is not a C4 short id, and it names the directory the message would go in. Pass the id the ledger allocated; nothing was written.`);
  }
}

/**
 * The body, checked and stripped down to what will be emitted after the
 * envelope. Returns the remaining entries in the caller's own order — a reader
 * comparing two messages by eye reads the fields in the order the writer
 * thought about them.
 */
function assertBody({ dispatchId, type, body }) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Refusal('outbox-message-invalid',
      'the message body must be a JSON object. Send the message document on stdin; nothing was written.');
  }

  const required = TYPES[type];
  if (required !== null && !present(body[required])) {
    throw new Refusal('outbox-message-invalid',
      `a ${type} message needs ${required} (contract C4). Add it to the body on stdin and run the same write again; nothing was written.`);
  }
  if (type === 'closeout' && !GRADES.includes(body.grade)) {
    throw new Refusal('outbox-message-invalid',
      `a closeout grade is one of ${GRADES.join(', ')}, not ${JSON.stringify(String(body.grade))}. Nothing was written.`);
  }

  for (const key of WRITER_OWNED) {
    if (Object.hasOwn(body, key)) {
      throw new Refusal('outbox-message-invalid',
        `the body may not carry ${key}: this writer supplies it, so that no caller can back-date a message or claim a format version it did not write. Drop the key and run the same write again; nothing was written.`);
    }
  }

  const flags = { type, dispatch_id: dispatchId };
  for (const key of ECHOED) {
    if (Object.hasOwn(body, key) && body[key] !== flags[key]) {
      throw new Refusal('outbox-message-invalid',
        `the body says ${key} is ${JSON.stringify(String(body[key]))} but the invocation says ${JSON.stringify(flags[key])}. Make them agree, or drop the key from the body; nothing was written.`);
    }
  }

  const rest = [];
  for (const [key, value] of Object.entries(body)) {
    if (ECHOED.includes(key)) continue;
    if (PROSE.has(key) && typeof value === 'string') {
      // The same judgement the degraded print path already makes, applied to
      // the stored value for the same reason. A message document is a set of
      // one-line values, so a newline in a prose field is not information the
      // format can carry — collapsing it is normalizing to the shape, not
      // escaping a value the reader could not parse. A quote still refuses:
      // there is no collapse that preserves it, and the rule is that an
      // unspellable value is refused rather than rewritten into another one.
      rest.push([key, oneLine(value)]);
      continue;
    }
    if (!BLOCK_KEY.test(key)) {
      // The same judgement the shared emitter makes about a flow key, made
      // here because a top-level key is emitted raw before its colon too.
      throw new Refusal('value-not-flow-safe',
        `${JSON.stringify(key)} is not a usable key in a message document. Nothing was written.`);
    }
    rest.push([key, value]);
  }
  return rest;
}

/** Present enough to satisfy a conditional requirement: not absent, not blank. */
function present(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// the document
// ---------------------------------------------------------------------------

/**
 * One message as YAML: the four envelope fields C4 requires, then the body.
 *
 * Every value goes through the shared `flow()` emitter, so a nested map or
 * sequence is spelled on the one line its key opens and a value that cannot be
 * spelled at all is refused rather than escaped. `where` is the dotted location
 * the refusal reports; a message with fifteen fields gives a caller no other
 * way to find the one that broke.
 */
function render({ dispatchId, type, at, document }) {
  const lines = [
    `version: ${VERSION}`,
    `type: ${type}`,
    `dispatch_id: ${flow(dispatchId, 'dispatch_id')}`,
    // Through the emitter like every other value. The stamp is safe under the
    // pinned YAML 1.2 core schema either way, but unquoted it is a timestamp to
    // a 1.1 reader, which hands a caller a Date where the contract says string.
    `at: ${scalar(at, 'at')}`,
  ];
  for (const [key, value] of document) lines.push(`${key}: ${flow(value, key)}`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// the sequence
// ---------------------------------------------------------------------------

function makeDirectory(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Refusal('outbox-unwritable',
      `the dispatch directory ${dir} could not be created: ${err.message}. Nothing was written; run the same write again once the path is writable.`);
  }
}

/**
 * Take the next free sequence number and write the message under it.
 *
 * Scan, open exclusively, and on `EEXIST` scan again — the re-scan is the point:
 * a competing worker that took the number also *left a file behind*, so the
 * next scan sees a higher maximum and the retry asks for a different name
 * rather than the same one. A name that is still taken after every attempt is
 * therefore not contention but something permanent sitting on it, and that gets
 * its own refusal instead of a spin.
 */
function claimSequence(dir, type, text) {
  let lastSeen = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seq = highestSeq(dir) + 1;
    const file = path.join(dir, `${String(seq).padStart(4, '0')}-${type}.yml`);
    lastSeen = file;

    let fd;
    try {
      fd = fs.openSync(file, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') continue;
      throw new Refusal('outbox-unwritable',
        `${file} could not be created: ${err.message}. Nothing was written; run the same write again once the path is writable.`);
    }

    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor is being abandoned either way.
      }
      // The name was claimed but never filled. Only this call's file is
      // removed, and only on this path — an existing message is never touched.
      fs.rmSync(file, { force: true });
      throw new Refusal('outbox-unwritable',
        `${file} was created but could not be completed: ${err.message}. The partial file was removed and nothing was appended; run the same write again.`);
    }
    return { file, seq };
  }

  throw new Refusal('outbox-sequence-taken',
    `${lastSeen} was already taken on every one of ${MAX_ATTEMPTS} attempts, so no sequence number could be claimed. Nothing was written. Either a writer is appending faster than this one can scan — run the same write again — or something that is not a message file occupies the name, which has to be cleared by hand.`);
}

/**
 * The highest sequence number already used in this dispatch directory.
 *
 * Only regular files count. A directory or a symlink wearing a message name is
 * not a message: counting it would let a stray entry silently reserve numbers,
 * and skipping it means the exclusive open meets it head-on and says so.
 */
function highestSeq(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Refusal('outbox-unreadable',
      `the dispatch directory ${dir} exists but could not be listed: ${err.message}, so no sequence number can be chosen. Nothing was written; run the same write again once the directory is readable.`);
  }

  let highest = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = MESSAGE_FILE.exec(entry.name);
    if (match === null) continue;
    const seq = Number(match[1]);
    if (Number.isSafeInteger(seq) && seq > highest) highest = seq;
  }
  return highest;
}
