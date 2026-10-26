/**
 * Open the run's dashboard in the operator's browser, from the engine itself.
 *
 * Why this module exists. The freeze installs `dashboard.html` and prints its
 * link, but a page nobody opens is a page nobody watches, and a step in the
 * orchestrating model's prose that runs the opener is a step the model may skip.
 * So the two verbs every run passes through once — the freeze's `write-state`
 * and a resume's `resume-check` — open it themselves, and no prose does.
 *
 * Only a run a person watches from the terminal opens anything: a driver that
 * is absent or `terminal`. A cockpit shows the run its own way and a dispatch
 * worker has nobody in front of it. A run with `html_output` off has no page to
 * open, and neither does one whose page is not on disk.
 *
 * The opener is spawned detached, unref'd and with its output ignored, so the
 * verb never waits on the browser; the only thing awaited is whether the
 * process started. A failure is returned as a reason for the caller to print,
 * never thrown: the run goes on whether the page opened or not.
 *
 * Opting out: `--no-open` on either verb, or `MAISTER_NO_OPEN` set to anything
 * but empty or `0` in the environment, which the test suites and smoke runs set
 * so no window ever opens from them. `MAISTER_DASHBOARD_OPENER` is a seam for
 * those tests only: a JSON array naming the command and its leading arguments,
 * run in place of the platform opener with the path appended.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. No stdio.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isTerminalDriver } from './driver.mjs';
import { htmlOutput } from './state.mjs';

/** The environment variable that turns opening off everywhere. */
export const NO_OPEN_ENV = 'MAISTER_NO_OPEN';

/** The test seam: a JSON array of the command and its arguments, the path appended. */
export const OPENER_ENV = 'MAISTER_DASHBOARD_OPENER';

const VIEWER = 'dashboard.html';

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
 * The absolute path of the dashboard to open for the run whose parsed state is
 * `doc` in `runDir`, or null when the run opens none: its driver is a cockpit
 * or a dispatch, `html_output` is off, or the page is not there.
 */
export function dashboardToOpen(doc, runDir) {
  if (!isTerminalDriver(doc) || !htmlOutput(doc)) return null;
  const file = path.join(path.resolve(runDir), VIEWER);
  return fs.existsSync(file) ? file : null;
}

/**
 * Start the opener on `file`. Resolves to null once the process started, or to
 * the reason it could not start. Never rejects.
 */
export function openDashboard(file, { env = process.env, platform = process.platform } = {}) {
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
