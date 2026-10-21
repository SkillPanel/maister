/**
 * Which folders beside a run are not runs.
 *
 * A run's state folder sits four levels below its checkout, under one of two
 * roots: `<checkout>/.maister/tasks/<type>/<date-name>` for an ordinary run,
 * `<checkout>/.maister/umbrella/runs/<run-id>` for the run that drives a chain.
 * Beside a run there may be a copy set aside: `<run>.moved-<digits>`, the copy a
 * machine kept after the run moved to another, and `<run>.failed-<digits>`, a
 * rolled-back copy. Either holds a state file that looks like a run's, and
 * neither is one: a reader that lists runs leaves it out, and a resume refuses it.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. It sits at the plugin
 * root because the engine's resume check and the umbrella's run listing share
 * the one rule.
 */

import path from 'node:path';

const SET_ASIDE = /\.(moved|failed)-\d+$/;

/** Whether the folder `dir` (a path or a bare name) is a set-aside copy of a run. */
export function isSetAside(dir) {
  return SET_ASIDE.test(path.basename(String(dir).replace(/[\\/]+$/, '')));
}
