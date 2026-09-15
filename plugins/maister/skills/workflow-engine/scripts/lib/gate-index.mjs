/**
 * The gate index: `gates/index.yml`, regenerated whole from the request files
 * beside it.
 *
 * **Why this is its own module.** The index has two moments, not one. It gains
 * a row when a gate is asked — `gate.mjs` — and a row closes when a gate is
 * answered, which is the state write that sets `gate_pending: null` (E2: "the
 * commit point is `gate_pending: null`, written last") — `state.mjs`. Those two
 * modules already point one way, `gate.mjs` → `state.mjs`, so the renderer
 * cannot live in either without making that a cycle. It lives here and both
 * import it.
 *
 * **The defect that split it out.** While the renderer was private to
 * `gate.mjs` the index was regenerated only when the *next* gate was asked. The
 * six earlier rows of a seven-gate run therefore read `answered` as a side
 * effect of the suspension that followed them, and the last row of every run
 * ever recorded stayed `pending` — a completed run and a run suspended at its
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
// be the status the enforcement hook derives, and a second implementation of
// "is this request still open" drifts on the first change to either.
import { unansweredRequests } from '../../../../hooks/gate-lib.mjs';
import * as canonical from '../../../../lib/canonical.mjs';
const { Refusal, flow } = canonical;

/** E2: the frozen suffix the hook scans for, and the index's own name. */
export const REQUEST_SUFFIX = '.request.yml';
export const INDEX_FILE = 'index.yml';

/** Fixed key order inside an index entry (E2). */
const ENTRY_KEYS = ['node', 'request', 'sub_run', 'kind', 'asked_at', 'status'];

/** The refusal codes the shared publish path raises when it writes the index. */
const COMMIT_CODES = { unwritable: 'gate-unwritable', tempExists: 'gate-temp-exists' };

/**
 * The index document for one run, as text.
 *
 * `gates` is the run's `gates/` directory and `runDir` the run directory the
 * hook's reader wants — the two are passed separately because the reader
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
  const gates = path.join(runDir, 'gates');
  let stat;
  try {
    stat = fs.statSync(gates);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw new Refusal('gate-unwritable', `${gates} cannot be read, so the gate index cannot be regenerated: ${err.message}`);
  }
  if (!stat.isDirectory()) return false;

  const indexFile = path.join(gates, INDEX_FILE);
  canonical.commit({ target: indexFile, text: renderIndex(gates, runDir), tmp: `${indexFile}.tmp`, codes: COMMIT_CODES });
  return true;
}

/**
 * `kind` and `asked_at` out of an existing request file.
 *
 * Deliberately a two-key top-level scan and not a parser: everything that
 * decides anything — whether the request is open, which node it belongs to —
 * comes from the hook's reader and from the file name. These two are carried
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
