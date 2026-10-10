/**
 * What the run's driver can carry, read off `orchestrator.driver` in one place.
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
 *   Honoured under `kind: cockpit` only: a dispatch worker has no form to show
 *   a set on, so its runs keep the defaults their node prose names.
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
 * Whether an in-node question suspends to the operator in this run: the driver
 * is a cockpit and lists `question-sets`. Otherwise the node takes the default
 * its prose names.
 */
export function questionSets(doc) {
  const driver = driverOf(doc);
  return QUESTION_SET_KINDS.has(driver?.kind) && driverFeatures(doc).includes(QUESTION_SETS);
}

/**
 * Whether a person can be asked an in-node question in this run: the driver is
 * absent, names no kind or is `terminal` (the question is asked in session), or
 * is a cockpit that lists `question-sets`. A dispatch worker, a cockpit without
 * the feature and any unknown kind cannot ask.
 */
export function canAsk(doc) {
  const driver = driverOf(doc);
  if (driver === null || driver.kind === undefined || driver.kind === null || driver.kind === 'terminal') return true;
  return questionSets(doc);
}
