/**
 * Liveness beacon, both providers (contract H1, § T5).
 *
 * A daemon cannot tell "the hooks are live in this session" from "the session
 * started without them" — Node missing, the script skipped, repository hooks
 * not enabled, the environment variable not passed through. So every session
 * start writes one marker file, and the daemon trusts a driver session only
 * after it has seen that session's marker.
 *
 * The marker is never written under the working directory: `.maister/` is
 * tracked in real consumer repositories, and a per-session file there would
 * show up as an untracked file in every chain session. That holds even when
 * `MAISTER_BEACON_DIR` says otherwise — such a directory is refused, with a
 * note on stderr, and the default one is used.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HOOK_VERSION, detectProvider, readPayload, resolvePath, stamp, write } from './gate-lib.mjs';

const HOME_DIR = ['.maister-cockpit', 'beacons'];
const TMP_DIR = 'maister-beacons';

/**
 * Where the marker goes: the directory the daemon or harness passed in (one per
 * daemon instance), else the cockpit's own home, else a temporary directory
 * when home is unwritable.
 *
 * A passed directory that resolves inside the working directory is refused
 * rather than honoured. The promise above is that no marker lands in the
 * consumer tree, and a caller cannot opt out of it: a `MAISTER_BEACON_DIR`
 * exported one repository up, or a daemon started from inside the project,
 * would otherwise put a per-session file where `.maister/` is tracked.
 */
function beaconDir(cwd) {
  const passed = process.env.MAISTER_BEACON_DIR;
  if (passed && !insideCwd(passed, cwd)) return passed;
  if (passed) {
    write(2, `gate beacon: MAISTER_BEACON_DIR ${passed} is inside the working directory; using the default directory instead\n`);
  }
  const home = os.homedir();
  if (home) return path.join(home, ...HOME_DIR);
  return path.join(os.tmpdir(), TMP_DIR);
}

/** Whether `dir` is `cwd` itself or below it, compared through symlinks. */
function insideCwd(dir, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return false;
  const target = resolvePath(path.resolve(dir));
  const root = resolvePath(path.resolve(cwd));
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * The session id is provider-owned text, and here it becomes a file name, so it
 * is reduced to the characters a name may carry. A provider UUID passes through
 * unchanged; anything carrying a separator or a `..` does not, and the marker
 * still records the id it was given verbatim.
 */
function markerName(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '');
  return `${safe.slice(0, 128) || 'session'}.json`;
}

try {
  const payload = readPayload();
  const provider = detectProvider(payload);
  const sessionId = payload.session_id ?? payload.sessionId;
  if (!sessionId) throw new Error('the session-start payload carries no session id');

  const marker = {
    provider,
    session_id: sessionId,
    source: payload.source ?? null,
    at: stamp(),
    node: process.version,
    hook_version: HOOK_VERSION,
    cwd: payload.cwd,
  };

  let dir = beaconDir(payload.cwd);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    dir = path.join(os.tmpdir(), TMP_DIR);
    fs.mkdirSync(dir, { recursive: true });
  }
  // Belt and braces: the name is already sanitised, and the resolved path is
  // checked to still be a direct child of the directory before anything is
  // written to it.
  const file = path.resolve(dir, markerName(sessionId));
  if (path.dirname(file) !== path.resolve(dir)) {
    throw new Error(`the beacon path would leave ${dir}`);
  }
  fs.writeFileSync(file, `${JSON.stringify(marker)}\n`);
  process.exit(0);
} catch (err) {
  // A session start is never blocked by a marker that could not be written; the
  // daemon reads the absence of one as "hooks are not live here".
  write(2, `gate beacon: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(0);
}
