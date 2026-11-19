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
 * How a page opens, and the environment's opt-out, are `lib/open-file.mjs`.
 * Opting out here also takes `--no-open` on either verb. A failure to open is
 * returned as a reason for the caller to print: the run goes on whether the page
 * opened or not.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. No stdio.
 */

import fs from 'node:fs';
import path from 'node:path';
import { openFile } from '../../../../lib/open-file.mjs';
import { isTerminalDriver } from './driver.mjs';
import { htmlOutput } from './state.mjs';

export { NO_OPEN_ENV, OPENER_ENV, openerCommand, optedOut } from '../../../../lib/open-file.mjs';

const VIEWER = 'dashboard.html';

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
 * Start the opener on the dashboard `file`. Resolves to null once the process
 * started, or to the reason it could not start. Never rejects.
 */
export const openDashboard = openFile;
