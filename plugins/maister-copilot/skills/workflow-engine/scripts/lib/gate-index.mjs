/**
 * The gate index: `gates/index.yml`, regenerated whole from the request files
 * beside it.
 *
 * **Why this is its own module.** The index has two moments, not one. It gains
 * a row when a gate is asked, and a row closes on the first state write that
 * leaves `gate_pending` null — whether that write's patch cleared it or an
 * editor already had. The gate writer imports `state.mjs`, so
 * the renderer cannot live in either without a cycle. It lives here and both
 * import it.
 *
 * **Why it is regenerated on both moments.** Regenerated only when the *next*
 * gate was asked, a run's final row read `pending` forever: the six earlier
 * rows of a seven-gate run read `answered` only as a side effect of the
 * suspension that followed them, so a completed run and a run suspended at its
 * final gate were the same bytes in the one file a chain watches. Observed on a
 * dispatched `builtin:performance` run whose `verification-approval` was
 * answered, whose `finalization` node then ran, and whose index still said
 * `pending` at `task.status: completed`.
 *
 * The index is a mirror and is always regenerated whole, never appended: a run
 * whose index was lost or half-written is repaired by the next write rather
 * than accumulating a second wrong answer. Entries are ordered by file name so
 * two regenerations of the same directory produce the same bytes.
 */

import fs from 'node:fs';
import path from 'node:path';

// `unansweredRequests` is imported rather than approximated for the same reason
// the state writer imports `scanState`: the status written into the index must
// be the status the shared reader derives, and a second implementation of
// "is this request still open" drifts on the first change to either.
import { unansweredRequests } from '../../../../lib/state-scan.mjs';
import * as canonical from '../../../../lib/canonical.mjs';
const { Refusal, flow } = canonical;

/** The request-file suffix every reader scans for, and the index's own name. */
export const REQUEST_SUFFIX = '.request.yml';
export const INDEX_FILE = 'index.yml';

/** Fixed key order inside an index entry. */
const ENTRY_KEYS = ['node', 'request', 'sub_run', 'kind', 'asked_at', 'status'];

/** The refusal codes the shared publish path raises when it writes the index. */
const COMMIT_CODES = { unwritable: 'gate-unwritable', tempExists: 'gate-temp-exists' };

/**
 * The index document for one run, as text.
 *
 * `gates` is the run's `gates/` directory and `runDir` the run directory the
 * shared reader wants — the two are passed separately because the reader
 * derives the `gates/` path itself and would otherwise be handed it twice.
 */
export function renderIndex(gates, runDir) {
  let names;
  try {
    names = fs.readdirSync(gates);
  } catch (err) {
    throw new Refusal('gate-unwritable', `${gates} cannot be listed, so the gate index cannot be regenerated: ${err.message}`);
  }
  let unanswered;
  try {
    unanswered = new Set(unansweredRequests(runDir));
  } catch (err) {
    throw new Refusal('gate-unwritable', `${gates} cannot be read back, so the gate index cannot be regenerated: ${err.message}`);
  }

  const lines = ['version: 1'];
  const entries = names
    .filter(name => name.endsWith(REQUEST_SUFFIX))
    .sort()
    .map(name => {
      const node = name.slice(0, -REQUEST_SUFFIX.length);
      const meta = requestMeta(path.join(gates, name));
      return ordered({
        node,
        request: `gates/${name}`,
        kind: meta.kind,
        asked_at: meta.asked_at,
        status: unanswered.has(node) ? 'pending' : 'answered',
      }, ENTRY_KEYS);
    });
  if (!entries.length) return `${lines.concat('entries: []').join('\n')}\n`;
  lines.push('entries:');
  for (const entry of entries) lines.push(`  - ${flow(entry, `entries.${entry.node}`)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Regenerate `gates/index.yml` for one run, through the same whole-file rename
 * every other contract shape is published with.
 *
 * Returns `true` when the file was rewritten and `false` when the run has no
 * `gates/` directory at all — a run that never asked a question has no index to
 * close, and that is not a fault. Every other failure is a `Refusal`, raised by
 * the renderer or by the publish path, so a caller that cannot tolerate a stale
 * index learns about it.
 */
export function refreshIndex(runDir) {
  const gates = gatesDir(runDir);
  if (!gates) return false;

  const indexFile = path.join(gates, INDEX_FILE);
  canonical.commit({ target: indexFile, text: renderIndex(gates, runDir), tmp: `${indexFile}.tmp`, codes: COMMIT_CODES });
  return true;
}

/**
 * Regenerate `gates/index.yml` only when its bytes would change.
 *
 * Returns `true` when the file was rewritten, and `false` both when the run has
 * no `gates/` directory and when the index already says what the request files
 * say. The state writer calls this on every write that leaves no gate pending,
 * so an ordinary write must not report the index as changed; `refreshIndex`
 * keeps its always-rewrite contract for the callers that rely on it.
 */
export function syncIndex(runDir) {
  const gates = gatesDir(runDir);
  if (!gates) return false;

  const indexFile = path.join(gates, INDEX_FILE);
  const text = renderIndex(gates, runDir);
  let current = null;
  try {
    current = fs.readFileSync(indexFile, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Refusal('gate-unwritable', `${indexFile} cannot be read, so the gate index cannot be regenerated: ${err.message}`);
    }
  }
  if (current === text) return false;
  canonical.commit({ target: indexFile, text, tmp: `${indexFile}.tmp`, codes: COMMIT_CODES });
  return true;
}

/** The run's `gates/` directory, or `null` when it has none. */
function gatesDir(runDir) {
  const gates = path.join(runDir, 'gates');
  let stat;
  try {
    stat = fs.statSync(gates);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Refusal('gate-unwritable', `${gates} cannot be read, so the gate index cannot be regenerated: ${err.message}`);
  }
  return stat.isDirectory() ? gates : null;
}

/**
 * `kind` and `asked_at` out of an existing request file.
 *
 * Deliberately a two-key top-level scan and not a parser: everything that
 * decides anything — whether the request is open, which node it belongs to —
 * comes from the shared reader and from the file name. These two are carried
 * into the index as a convenience for a reader that wants one place to look,
 * so a file that does not spell them is mirrored without them rather than
 * refusing a write about another node.
 */
function requestMeta(file) {
  const meta = { kind: undefined, asked_at: undefined };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Refusal('gate-unwritable', `${file} cannot be read, so the gate index cannot be regenerated: ${err.message}`);
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const found = /^(kind|asked_at):(.*)$/.exec(line);
    if (!found) continue;
    const value = found[2].trim().replace(/^"(.*)"$/, '$1');
    if (value !== '' && meta[found[1]] === undefined) meta[found[1]] = value;
  }
  return meta;
}

/** A value with its keys in the frozen order, and the absent ones left out. */
function ordered(value, keys) {
  const out = {};
  for (const key of keys) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}
