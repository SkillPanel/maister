/**
 * The shapes this plugin publishes: the driven gate request and the checkpoint
 * it carries, each key declared once with its type and whether every one of
 * them carries it.
 *
 * Why this module exists. A reader of a gate request — a driver, a cockpit, a
 * validator in another edition — used to keep its own list of the keys a
 * request may hold, and a key added here reached it only when someone noticed.
 * The builders (`requestOf`, `questionRequest`, `buildCheckpoint`,
 * `questionCheckpoint`) take their kinds, their version and the suggestion's
 * keys from here, and the plugin's interface file is generated from here, so
 * the file a reader diffs between two commits is the shape the builders emit.
 * A test holds every builder to it: a key a builder emits that is not declared
 * here fails it.
 *
 * A declaration is `{type, required}`, and for a map `keys`, for a list
 * `items`, for a closed string `values`, for a value described elsewhere `see`.
 * `type` is one JSON type, or several joined by `|`: `string`, `boolean`,
 * `integer`, `object`, `array`, `null`. `required` is true only for a key every
 * request (or checkpoint) of that kind carries.
 *
 * Pure: no I/O. Zero dependencies, Node >= 20.
 */

/** The version every checkpoint carries, raised when its shape changes in a way a reader must know. */
export const CHECKPOINT_VERSION = 1;

/** The kinds a checkpoint, and the request carrying it, may be: a gate (`held-approval` included), or a node's question set. */
export const CHECKPOINT_KIND = { gate: 'gate', question: 'question' };

/** What a request option does when chosen. */
export const OPTION_EFFECTS = ['continue', 'revise', 'stop'];

const text = { type: 'string', required: true };
const optionalText = { type: 'string', required: false };
const flag = { type: 'boolean', required: true };
const optionalFlag = { type: 'boolean', required: false };
const paths = required => ({ type: 'array', required, items: { type: 'string' } });

/** One suggested note on a revise option: the gate contract's `{label, note, recommended}`. */
export const REQUEST_SUGGESTION = {
  label: text,
  note: text,
  recommended: optionalFlag,
};

/** One option of a request, or of one question of a request's set. */
export const REQUEST_OPTION = {
  id: text,
  label: text,
  effect: { type: 'string', required: true, values: OPTION_EFFECTS },
  description: optionalText,
  recommended: optionalFlag,
  note: optionalFlag,
  suggestions: { type: 'array', required: false, items: { type: 'object', keys: REQUEST_SUGGESTION } },
};

const options = { type: 'array', required: true, items: { type: 'object', keys: REQUEST_OPTION } };

/** One question of a `kind: question` request's set. */
export const REQUEST_QUESTION = {
  id: text,
  question: text,
  options,
  multi_select: flag,
  evidence: paths(false),
};

/** The request's `context`: the one-line summary, the files to review, and the checkpoint whole. */
export const REQUEST_CONTEXT = {
  summary: text,
  artifacts: paths(true),
  checkpoint: { type: 'object', required: true, see: 'checkpoint' },
};

/** The driven gate request, as `gate-brief --request` returns it. */
export const GATE_REQUEST = {
  node: text,
  kind: { type: 'string', required: true, values: Object.values(CHECKPOINT_KIND) },
  question: text,
  context: { type: 'object', required: true, keys: REQUEST_CONTEXT },
  options,
  multi_select: flag,
  evidence: paths(false),
  questions: { type: 'array', required: false, items: { type: 'object', keys: REQUEST_QUESTION } },
  triage: { type: 'object', required: false },
};

/** A gate's subject: the one output the gate asks to approve. Its kinds are `SUBJECT_KINDS`. */
export const CHECKPOINT_SUBJECT = {
  path: text,
  kind: text,
};

/** The keys every checkpoint carries, whatever its kind. */
const COMMON = {
  version: { type: 'integer', required: true },
  kind: { type: 'string', required: true, values: Object.values(CHECKPOINT_KIND) },
  node: text,
  header: text,
  ask: text,
  headline: { type: 'string|null', required: true },
  progress: { type: 'object', required: true },
  run: { type: 'object', required: true },
  truncated: flag,
};

/** The checkpoint's keys, by kind. */
export const CHECKPOINT_KEYS = {
  [CHECKPOINT_KIND.gate]: {
    ...COMMON,
    next: { type: 'object|null', required: true },
    subject: { type: 'object', required: false, keys: CHECKPOINT_SUBJECT },
    review: { type: 'array', required: true },
    closed: { type: 'array', required: true },
    fixes: { type: 'array', required: true },
    held: { type: 'array', required: false },
    decisions: { type: 'object', required: true },
    risks: { type: 'object', required: true },
    recommended: { type: 'object', required: true },
    evidence: paths(false),
    options: { type: 'array', required: true },
    grants: { type: 'object', required: true },
    approves: { type: 'array', required: true },
  },
  [CHECKPOINT_KIND.question]: {
    ...COMMON,
    questions: { type: 'array', required: true },
  },
};

/** The names of a shape's keys, in declared order. */
export function keysOf(shape) {
  return Object.keys(shape);
}
