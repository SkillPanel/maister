/**
 * The shape of a dispatch outbox on disk, and its one reader.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. A dispatch's messages
 * live at `outbox/<dispatch_id>/<seq>-<type>.yml`; the umbrella runtime's
 * outbox writer is the only thing that creates them. Two readers need the same
 * naming convention: that writer, which picks the next sequence number from
 * the names already there, and the workflow engine's close-out guard, which
 * asks whether a dispatched run published its close-out. The convention is
 * spelled here once, at the plugin root, so the engine reads an outbox without
 * importing the umbrella and the two can never disagree on what a message file
 * is called.
 *
 * Code outside the umbrella reads an outbox only through this module; keep the
 * names, the signatures and the path stable.
 *
 * The codes this module raises: `outbox-message-invalid` (the dispatch id is
 * not a short id) and `outbox-unreadable` (the dispatch directory exists but
 * cannot be listed). The writer raises both as well, with its own recovery.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from './canonical.mjs';

/** The short id: what may be a dispatch id, and therefore a path segment. */
export const DISPATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** An already-written message file: `<seq>-<type>.yml`. */
export const MESSAGE_FILE = /^(\d+)-[a-z]+\.yml$/;

/**
 * What a dispatch has already published, newest sequence last.
 *
 * The one reader of an outbox, and it exists so that nothing has to know the
 * shape of `outbox/<dispatch_id>/<seq>-<type>.yml` but this file. The
 * alternative — a caller globbing that path itself — would put a second, silent
 * copy of the naming convention somewhere else, and the day the convention
 * moved one of the two would keep answering.
 *
 * The type comes off the *name* rather than out of the document. The name is
 * the exclusivity primitive the writer is built on, it is claimed before a byte
 * of the body is written, and it cannot disagree with the message it names.
 * Parsing the YAML to learn a fact the filename already carries would only add
 * a way to fail.
 *
 * A dispatch that has published nothing has no directory — that is the ordinary
 * state of a worker before its first message, not an error — so an absent
 * directory reads as an empty list. Every other listing failure is
 * `outbox-unreadable`, the same code and the same recovery the writer raises
 * when it cannot choose a sequence number: run again once the path is readable.
 */
export function published({ outbox: outboxDir, dispatch_id: dispatchId }) {
  if (typeof dispatchId !== 'string' || !DISPATCH_ID.test(dispatchId)) {
    throw new Refusal('outbox-message-invalid',
      `the dispatch id ${JSON.stringify(String(dispatchId))} is not a short id, and it names the outbox directory to read. Pass the id the ledger allocated.`);
  }
  const dir = path.join(path.resolve(outboxDir), dispatchId);

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Refusal('outbox-unreadable',
      `the dispatch directory ${dir} exists but could not be listed: ${err.message}, so what this dispatch has published cannot be known. Run again once the directory is readable.`);
  }

  const messages = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = MESSAGE_FILE.exec(entry.name);
    if (match === null) continue;
    const seq = Number(match[1]);
    if (!Number.isSafeInteger(seq)) continue;
    messages.push({ seq, type: entry.name.slice(match[1].length + 1, -'.yml'.length), file: path.join(dir, entry.name) });
  }
  return messages.sort((a, b) => a.seq - b.seq);
}
