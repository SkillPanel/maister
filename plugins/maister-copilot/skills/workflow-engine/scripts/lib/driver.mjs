/**
 * What the run's driver can carry, and whether it runs a dispatch, read off
 * `orchestrator.driver` in one place.
 *
 * Why this module exists. The engine decides two things from the driver: who
 * answers a gate (its `kind`), and whether a question asked inside a node can
 * reach a person at all. The second depends on the driver, not on the engine: a
 * driver that cannot show a set of questions and write their answers back would
 * leave a run suspended on a question nobody can answer. So the driver
 * advertises what it carries in `driver.features`, a list the cockpit seeds,
 * and every reader asks here rather than reading the list its own way.
 *
 * The features:
 *
 * - `question-sets` — the driver carries every question a node asks as one
 *   `kind: question` request, and writes the answers back as `answer.answers`.
 *   Honoured under `kind: cockpit` only, and never in a dispatched run
 *   (`isDispatchedRun`): a dispatch worker has no form to show a set on, so
 *   its runs keep the defaults their node prose names.
 *
 * A dispatched run is one a worker runs for a dispatch of a chain: its driver
 * is a cockpit that records the `dispatch_id` it belongs to, or carries the
 * legacy `kind: dispatch`, which reads as a dispatched run whether or not it
 * records the id.
 *
 * An absent list, a value that is not a list and an unknown feature all mean
 * the feature is not there: what the driver did not say it carries, it does
 * not carry.
 *
 * Pure: no imports, no I/O.
 */

/** The feature that lets an in-node question suspend to the operator. */
export const QUESTION_SETS = 'question-sets';

/** The driver kinds a question set can be carried under. */
const QUESTION_SET_KINDS = new Set(['cockpit']);

/** The legacy driver kind a dispatched run once recorded; still read as one. */
const LEGACY_DISPATCH = 'dispatch';

/** The `orchestrator.driver` block of a parsed state document, or null. */
function driverOf(doc) {
  const orchestrator = doc?.orchestrator;
  const driver = orchestrator && typeof orchestrator === 'object' ? orchestrator.driver : null;
  return driver && typeof driver === 'object' && !Array.isArray(driver) ? driver : null;
}

/** The features the run's driver advertises, as a list of strings; empty when it says none. */
export function driverFeatures(doc) {
  const features = driverOf(doc)?.features;
  return Array.isArray(features) ? features.filter(each => typeof each === 'string') : [];
}

/**
 * Whether the run is a dispatched run: its driver records the legacy
 * `kind: dispatch`, or is a cockpit carrying a non-empty `dispatch_id`. A
 * terminal run, or a cockpit with no dispatch id, is not.
 */
export function isDispatchedRun(doc) {
  const driver = driverOf(doc);
  if (driver?.kind === LEGACY_DISPATCH) return true;
  return driver?.kind === 'cockpit' && typeof driver.dispatch_id === 'string' && driver.dispatch_id.trim() !== '';
}

/**
 * Whether an in-node question suspends to the operator in this run: the driver
 * is a cockpit that lists `question-sets` and the run is not dispatched.
 * Otherwise the node takes the default its prose names.
 */
export function questionSets(doc) {
  const driver = driverOf(doc);
  return QUESTION_SET_KINDS.has(driver?.kind) && !isDispatchedRun(doc) && driverFeatures(doc).includes(QUESTION_SETS);
}

/**
 * Whether a person can be asked an in-node question in this run: the driver is
 * absent, names no kind or is `terminal` (the question is asked in session), or
 * is a cockpit that lists `question-sets` and runs no dispatch. A dispatched
 * run, a cockpit without the feature and any unknown kind cannot ask.
 */
export function canAsk(doc) {
  return isTerminalDriver(doc) || questionSets(doc);
}

/**
 * Whether the run is watched from the terminal it runs in: its driver is
 * absent, names no kind or is `terminal`. A cockpit or a dispatch is not.
 */
export function isTerminalDriver(doc) {
  const driver = driverOf(doc);
  return driver === null || driver.kind === undefined || driver.kind === null || driver.kind === 'terminal';
}
