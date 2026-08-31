/**
 * The shared write primitives.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. Two things live here
 * and nothing else does: the restricted flow emitter that decides whether a
 * value can be spelled on one line at all, and the publish path — exclusive
 * temp, fsync, rename — that every writer in this plugin uses to put bytes on
 * disk. Both were `state.mjs`'s private helpers until a second writer needed
 * them; this module is that extraction, unchanged in behaviour.
 *
 * Why the emitter refuses rather than escapes. The readers that guard an
 * operator's session parse one-line flow collections with a quote scanner that
 * has no escape awareness and an unquoter that strips only the outer pair. One
 * embedded quote does not produce a slightly wrong line, it produces a line the
 * reader throws on — and a reader that throws is a blocked session, not a
 * cosmetic defect. So a value that cannot be emitted flow-safely is refused,
 * and the refusal carries `where`, the dotted location, because a state file
 * with forty nodes gives a caller no other way to find the offending value.
 *
 * Why the publish path is exclusive and self-healing. The temp names are frozen
 * by contract — the allow-list that lets a writer keep working while a gate is
 * pending is a list of names, not a glob — so exclusivity has to come from the
 * open rather than from a unique name. That turns a process killed between the
 * open and the rename into a permanent refusal unless the recovery is in band,
 * and the moment a long turn is most likely to be cut is a gate answer, which
 * is exactly when the operator has no tool that can delete the leftover: the
 * enforcement hook denies Bash, and an editor tool can write an allow-listed
 * temp name but not remove it. Hence `STALE_TEMP_MS`.
 *
 * Why the refusal codes are injected. Every caller owns a closed refusal
 * vocabulary of its own — `state-unwritable` and `state-temp-exists` for the
 * state writer, `umbrella-unwritable` and `umbrella-temp-exists` for the
 * umbrella writer — and those names are what the suite and the operator-facing
 * reports are written against. A shared primitive that emitted one shared code
 * would collapse those vocabularies into one, so `commit` and `openTemp` take
 * the caller's names in through `codes` and `claimLock` through `code`. The
 * one code spelled here is `value-not-flow-safe`, which is shared on purpose:
 * it names a property of the value, not of the writer that met it.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * A refusal: the input cannot be written safely. A caller turns it into exit 1,
 * and by the time one is thrown nothing on disk has changed.
 */
export class Refusal extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** Scalars that YAML would read as something other than a string. */
const RESERVED = /^(?:true|false|yes|no|on|off|null|~)$/i;
const NUMBERISH = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * What may appear between flow punctuation without quotes. Note what it
 * excludes: `:` and `\`, which is why an absolute Windows path is always
 * quoted. A bare `C:\Users\x` would split the entry at the colon.
 */
const BARE_FLOW = /^[A-Za-z0-9._/-]+$/;

/** A key in a flow-map position. Emitted raw between the braces. */
const FLOW_KEY = /^[A-Za-z0-9._-]+$/;

/**
 * One value in a flow position, without recursing into collections.
 *
 * `where` is the dotted location the refusal reports. It is optional only so
 * that a caller emitting a lone value need not invent one; every caller inside
 * a document supplies it, and `flow` extends it key by key on the way down.
 */
export function scalar(value, where = 'the value') {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Refusal('value-not-flow-safe', `${where} is not a finite number`);
    return String(value);
  }

  const text = String(value);
  if (/["\n\r]/.test(text)) {
    throw new Refusal('value-not-flow-safe',
      `${where} carries a quote, a newline or a carriage return, which the one-line reader cannot parse`);
  }
  // A value already spelled as a balanced flow collection is passed through:
  // this is how a `needs` or a `values` read back out of an existing entry
  // keeps its own shape instead of being re-quoted into a scalar.
  if (isBalancedFlow(text)) return text;
  if (BARE_FLOW.test(text) && !RESERVED.test(text) && !NUMBERISH.test(text)) return text;
  // Once a backslash is in the value the quoting style stops being cosmetic.
  // A double-quoted YAML scalar gives the backslash meaning, so `"C:\Users\x"`
  // — the exact shape contract E1 requires of `driver.cwd` on Windows — is not
  // a path, it is `BAD_DQ_ESCAPE`: no YAML reader parses that line at all.
  // Escaping it as `"C:\\Users\\x"` fixes the YAML readers and breaks the
  // ones this module exists to serve, because `state.mjs`'s scanner and
  // `gate-lib.mjs`'s unquoter strip the outer pair and decode nothing, so they
  // would hand a caller a cwd with every separator doubled.
  //
  // A single-quoted scalar is the one spelling both sides read alike: YAML
  // gives the backslash no meaning inside single quotes, and stripping the
  // outer pair is the correct decode. Only `'` is special, and it doubles.
  // Reached solely when a backslash is present, so every other value — the
  // whole of what the writers emit today — keeps its double-quoted bytes.
  if (text.includes('\\')) return `'${text.replace(/'/g, "''")}'`;
  return `"${text}"`;
}

/**
 * A whole nested value as a single-line flow map or sequence.
 *
 * The second argument is not decoration. `where` is what makes a
 * `value-not-flow-safe` message locatable in a document the caller did not
 * write by hand, and it is threaded through every level, so a refusal names
 * `nodes.build.session.dir` rather than "a value somewhere".
 */
export function flow(value, where) {
  if (Array.isArray(value)) return `[${value.map(item => flow(item, where)).join(', ')}]`;
  if (isPlainObject(value)) {
    const parts = Object.entries(value).map(([key, item]) => {
      assertFlowKey(key, where);
      return `${key}: ${flow(item, `${where}.${key}`)}`;
    });
    return `{${parts.join(', ')}}`;
  }
  return scalar(value, where);
}

/**
 * A key in a flow-map position — a nested map inside a value, and a field name
 * inside an entry. Both are emitted raw between the braces, so both obey the
 * one rule. Reported as `value-not-flow-safe` because that is the code callers
 * already tell apart from a fault in the file itself.
 */
function assertFlowKey(key, where) {
  if (!FLOW_KEY.test(key)) {
    throw new Refusal('value-not-flow-safe',
      `${where}.${JSON.stringify(String(key))} is not a usable flow-map key`);
  }
}

function isBalancedFlow(text) {
  if (!/^[[{]/.test(text)) return false;
  let depth = 0;
  for (const ch of text) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * How old a temp file has to be before it is a crashed writer's leftover
 * rather than a live writer's working file. A write is a whole-file
 * `writeFileSync`, one `fsync` and a rename — milliseconds — so a minute is
 * three orders of magnitude past any writer that is still running. Exported so
 * every caller documents the same number instead of restating it.
 */
export const STALE_TEMP_MS = 60_000;

/**
 * One whole-file write, temp-then-rename, under a name the caller chooses.
 *
 * `codes` names the two refusals this may throw — `{unwritable, tempExists}` —
 * so each caller keeps its own prefix. `tmp` is passed rather than derived
 * because the temp names are frozen by contract and differ per writer.
 *
 * `target` is used verbatim in the refusal messages and resolved only for the
 * rename, so a caller that reports a path back to an operator reports the path
 * that operator supplied.
 */
export function commit({ target, text, tmp, codes }) {
  const resolved = path.resolve(target);

  // The parent creation is inside the mapped region, not before it. A regular
  // file sitting where the parent directory belongs makes `mkdirSync` throw
  // `ENOTDIR`/`EEXIST`, and outside the region that escapes as a raw Error —
  // which every entry point spells as exit 2, "the tooling failed, nothing
  // ran". It is not a tooling fault: the caller named a path that cannot hold
  // a file, which is a rejected input, so it takes `codes.unwritable` like
  // every other way this target cannot be written.
  //
  // Exclusive, with a stale leftover reclaimed rather than refused forever —
  // see `openTemp`, which carries the reasoning and the age rule.
  let fd;
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fd = openTemp({ tmp, codes });
  } catch (err) {
    if (err instanceof Refusal) throw err;
    throw new Refusal(codes.unwritable, `${target} could not be written: ${err.message}`);
  }

  try {
    fs.writeFileSync(fd, text, 'utf8');
    // The rename is atomic against a concurrent reader; without this it is not
    // atomic against a crash, which is the case the docstring claims.
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, resolved);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor is being abandoned either way.
      }
    }
    // Only the temp this call created is removed — never one another writer holds.
    fs.rmSync(tmp, { force: true });
    throw new Refusal(codes.unwritable, `${target} could not be written: ${err.message}`);
  }
}

/**
 * The exclusive open, with the recovery that makes it survivable.
 *
 * A temp younger than `STALE_TEMP_MS` belongs to a live writer and is never
 * touched; an older one is a leftover and is reclaimed. That is safe because
 * publishing is one rename of a whole, fsynced file: nothing reads the temp,
 * and no write is ever partially applied from it.
 *
 * A temp whose mtime is in the *future* is stale too. Age was a subtraction, so
 * a future mtime gave a negative age, a negative age is never `>=` the
 * threshold, and the resource was wedged forever behind a refusal that says to
 * wait a minute — with no `--reclaim`, no TTL override and, under a pending
 * gate, no shell to delete the file by hand. The triggers are ordinary: NTP
 * stepping the clock back, a network filesystem whose server clock runs ahead,
 * a backup restore that preserves mtimes. A live writer holds its temp for
 * milliseconds and cannot have stamped it a minute ahead, so treating that as a
 * leftover reclaims exactly the files no writer holds.
 *
 * The guidance in the refusal names waiting and retrying rather than deleting,
 * because deleting is not a route the operator has while a gate is pending.
 *
 * Anything other than `EEXIST` is rethrown raw: it is a fault in the
 * filesystem rather than contention, and `commit` is the layer that decides
 * what to call it.
 */
export function openTemp({ tmp, codes }) {
  try {
    return fs.openSync(tmp, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let age;
    try {
      // Distance from now, in either direction: a temp stamped in the future is
      // as certainly not held by a live writer as one stamped an hour ago.
      age = Math.abs(Date.now() - fs.statSync(tmp).mtimeMs);
    } catch {
      // It vanished between the open and the stat: the writer that held it
      // finished. Take the retry, and let a second EEXIST refuse normally.
      age = 0;
    }
    if (age < STALE_TEMP_MS) {
      throw new Refusal(codes.tempExists,
        `${tmp} already exists and is less than a minute old, so another writer holds it — a write takes milliseconds. Nothing was written; run the same write again in a minute, and if the temp is still there it is a crashed writer's leftover and this write reclaims it.`);
    }
    fs.rmSync(tmp, { force: true });
    try {
      return fs.openSync(tmp, 'wx');
    } catch (retry) {
      if (retry.code !== 'EEXIST') throw retry;
      throw new Refusal(codes.tempExists,
        `${tmp} was reclaimed as stale and immediately taken by another writer. Nothing was written; run the same write again.`);
    }
  }
}

/**
 * `openTemp` in its lock role — the repo's only locking primitive.
 *
 * A lock is the same exclusive open as a temp, held for a critical section
 * instead of for a write, so it inherits the same stale reclamation: a holder
 * that died leaves a file, and a minute later the next caller takes it rather
 * than finding the resource locked forever. The single `code` is what a caller
 * reports on contention; there is only one because a lock has no second
 * failure mode worth a separate name.
 *
 * Returns the release function. Releasing twice is not an error — a caller
 * releasing in a `finally` after an early release should not turn a handled
 * failure into an unhandled one.
 */
export function claimLock(lockPath, { code, unwritable = code }) {
  // Mapped for the same reason `commit`'s is: a regular file where the lock's
  // parent directory belongs makes `mkdirSync` throw, and unmapped that is a
  // raw Error, which every entry point spells as exit 2 — "nothing ran" — for
  // an input the caller named. `lockPath` is used unresolved so the message
  // names the path the caller passed, which is what `openTemp`'s own refusals
  // do with it.
  //
  // It is reported under `unwritable`, not `code`: a directory that cannot be
  // created is a filesystem fault, and `code` is the caller's *contention*
  // name, whose recovery — wait, re-issue, a leftover older than a minute is
  // reclaimed — is wrong in all three clauses for a permissions fault. A
  // caller that has only one name may still pass one; the default keeps the
  // old spelling for it rather than inventing a code it does not own.
  try {
    fs.mkdirSync(path.dirname(path.resolve(lockPath)), { recursive: true });
  } catch (err) {
    throw new Refusal(unwritable, `${lockPath} could not be locked: ${err.message}`);
  }
  const fd = openTemp({ tmp: lockPath, codes: { unwritable, tempExists: code } });
  fs.closeSync(fd);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    fs.rmSync(lockPath, { force: true });
  };
}

/**
 * The A6 timestamp — whole seconds, UTC, never a formatted midnight.
 *
 * This is `hooks/gate-lib.mjs`'s expression, adopted verbatim so the two
 * spellings that survive in this plugin are one expression rather than two.
 * The third spelling, `state.mjs`'s deleted `timestamp()`, produced the same
 * bytes from a different expression (`toISOString().slice(0, 19)` plus a `Z`)
 * — equivalent, not identical. Recorded here so a reviewer checking "behaviour
 * unchanged" across that deletion does not have to re-derive it.
 */
export function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
