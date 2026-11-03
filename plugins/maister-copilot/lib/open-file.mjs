/**
 * Open one local file in the person's default browser, best effort.
 *
 * It sits at the plugin root because two skills open a page this way: the
 * workflow engine a run's dashboard, the mockup studio a finished version's
 * gallery. Whether anything should open is each caller's decision; this module
 * only knows how.
 *
 * The opener is spawned detached, unref'd and with its output ignored, so the
 * caller never waits on the browser; the only thing awaited is whether the
 * process started. A failure is returned as a reason, never thrown.
 *
 * Opting out: `MAISTER_NO_OPEN` set to anything but empty or `0` in the
 * environment, which the test suites and smoke runs set so no window ever opens
 * from them. `MAISTER_OPENER` is a seam for those tests only: a JSON array naming
 * the command and its leading arguments, run in place of the platform opener
 * with the path appended.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. No stdio.
 */

import { spawn } from 'node:child_process';

/** The environment variable that turns opening off everywhere. */
export const NO_OPEN_ENV = 'MAISTER_NO_OPEN';

/** The test seam: a JSON array of the command and its arguments, the path appended. */
export const OPENER_ENV = 'MAISTER_OPENER';

/**
 * The command line that opens `file` on `platform`: `{command, args, options}`
 * for `spawn`. The plain absolute path, never a `file://` URL. On Windows
 * `start` is a `cmd` builtin whose first quoted argument is a window title, so
 * an empty title goes first and the arguments are passed verbatim, the path
 * quoted, so a path holding a space reaches `start` whole.
 */
export function openerCommand(file, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [file], options: {} };
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '""', `"${file}"`], options: { windowsVerbatimArguments: true } };
  }
  return { command: 'xdg-open', args: [file], options: {} };
}

/** Whether the environment opts out of opening. */
export function optedOut(env = process.env) {
  const value = env[NO_OPEN_ENV];
  return typeof value === 'string' && value !== '' && value !== '0';
}

/**
 * Start the opener on `file`. Resolves to null once the process started, or to
 * the reason it could not start. Never rejects.
 */
export function openFile(file, { env = process.env, platform = process.platform } = {}) {
  let line;
  try {
    line = env[OPENER_ENV] ? seamCommand(env[OPENER_ENV], file) : openerCommand(file, platform);
  } catch (err) {
    return Promise.resolve(reasonOf(err));
  }
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(line.command, line.args, { ...line.options, detached: true, stdio: 'ignore', windowsHide: true });
    } catch (err) {
      resolve(reasonOf(err));
      return;
    }
    child.once('error', err => resolve(reasonOf(err)));
    child.once('spawn', () => {
      child.unref();
      resolve(null);
    });
  });
}

function seamCommand(value, file) {
  const parts = JSON.parse(value);
  if (!Array.isArray(parts) || parts.length === 0 || !parts.every(part => typeof part === 'string')) {
    throw new Error(`${OPENER_ENV} is not a JSON array of strings`);
  }
  return { command: parts[0], args: [...parts.slice(1), file], options: {} };
}

function reasonOf(err) {
  return err && err.message ? String(err.message) : String(err);
}
