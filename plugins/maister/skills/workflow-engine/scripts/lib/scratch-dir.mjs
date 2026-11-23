/**
 * The `scratch-dir` verb: a fresh, empty directory inside the project for a
 * file a step writes and a session or an agent later reads back.
 *
 * Why this module exists. A file in the system temp directory is outside the
 * project, and a host may stop the run to ask before a session reads it back:
 * Claude Code's auto mode asks at the first read outside the working
 * directories, and one answer can block every later one. So a file that is
 * read back lives under the project, in a folder git never sees.
 *
 * The contract. With `--state`, the directory is made under the run's own
 * `scratch/` folder, `<run>/scratch/<for>-<random>`; without it, under the
 * project's `.maister/scratch/`, the project being the working directory (or
 * `CLAUDE_PROJECT_DIR`). `--for` names what the directory holds, a kebab
 * label. Each call makes a new directory, atomically, so two callers never
 * share one. The scratch folder holds a `.gitignore` of `*`, written once and
 * never over a file already there, so nothing in it is committed. Nothing is
 * ever deleted here: the folder is ignored, and a caller may leave its
 * directory where it is.
 *
 * Returns `{ok, path}` — the absolute path of the new directory — or
 * `{ok: false, errors}` with one refusal: `scratch-dir-bad-label` (`--for` is
 * not a kebab label), `scratch-dir-no-run` (`--state` names no file) or
 * `scratch-dir-unwritable` (the directory could not be made). `node:`
 * builtins and engine libs only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../../../../lib/canonical.mjs';
import { ignoreAll } from './display-files.mjs';

/** The scratch folder's name, in a run and under `.maister/`. */
export const SCRATCH_DIR = 'scratch';

const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LABEL_MAX = 40;

/** A new empty directory for `label`, under the run of `state` or the project at `root`. */
export function scratchDir({ label, state = null, root }) {
  if (typeof label !== 'string' || !LABEL.test(label) || label.length > LABEL_MAX) {
    return refuse('scratch-dir-bad-label',
      `--for=${label} is not a label: it takes a few lower-case words joined by hyphens, at most ${LABEL_MAX} characters, naming what the directory holds (standards-discover, decisions). Nothing was made`);
  }
  let home;
  if (state !== null) {
    const file = path.resolve(state);
    if (!fs.existsSync(file)) {
      return refuse('scratch-dir-no-run',
        `--state=${state} names no file, so there is no run to make the directory in. Nothing was made. Point --state at the run's orchestrator-state.yml, or leave it out outside a run`);
    }
    home = path.join(path.dirname(file), SCRATCH_DIR);
  } else {
    home = path.join(path.resolve(root), '.maister', SCRATCH_DIR);
  }
  try {
    ignoreAll(home);
    return { ok: true, path: fs.mkdtempSync(path.join(home, `${label}-`)) };
  } catch (err) {
    return refuse('scratch-dir-unwritable', `${home} could not hold a new directory: ${err.message}. Nothing was made`);
  }
}

function refuse(code, message) {
  return { ok: false, errors: [new Refusal(code, message)] };
}
