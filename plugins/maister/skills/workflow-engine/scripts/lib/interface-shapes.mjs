/**
 * The shapes this plugin publishes: the driven gate request and the checkpoint
 * it carries, and the result `update-branch` leaves, each key declared once
 * with its type and whether every one of them carries it.
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

/** A cited line range: whole numbers from 1, `start` <= `end`; one line when they are equal. */
export const REQUEST_CITE_LINES = {
  start: { type: 'integer', required: true },
  end: { type: 'integer', required: true },
};

/** One place a question cites: a repository-relative file, a line range in it, a section anchor without the `#`. */
export const REQUEST_CITE = {
  path: text,
  lines: { type: 'object', required: false, keys: REQUEST_CITE_LINES },
  section: optionalText,
};

const cites = { type: 'array', required: false, items: { type: 'object', keys: REQUEST_CITE } };

/** One question of a `kind: question` request's set. */
export const REQUEST_QUESTION = {
  id: text,
  question: text,
  options,
  multi_select: flag,
  evidence: paths(false),
  cites,
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
  cites,
  questions: { type: 'array', required: false, items: { type: 'object', keys: REQUEST_QUESTION } },
  triage: { type: 'object', required: false },
  round: { type: 'integer', required: false },
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

/** What a workflow definition declares about itself for a reader, not for a run. */
export const WORKFLOW_DECLARATIONS = {
  changes_code: { type: 'boolean', required: false, default: false },
};

/** The names of a shape's keys, in declared order. */
export function keysOf(shape) {
  return Object.keys(shape);
}

/**
 * The result `update-branch` leaves: one file per call, written by the
 * `update-branch-result` verb, which validates what the session sends and
 * derives every fact git or the run records. A caller that started the skill
 * reads it instead of the closing prose. The file is
 * `<run>/update-branch.json` when the call names a run, or the path the call
 * gives; a later call replaces it.
 */
export const UPDATE_BRANCH_RESULT_VERSION = 1;

/** The result's file name inside a run's task directory. */
export const UPDATE_BRANCH_RESULT_FILE = 'update-branch.json';

/**
 * How the call ended. `refused`: stopped before merging, nothing changed.
 * `stopped`: a merge was started or adopted and is not committed.
 */
export const UPDATE_BRANCH_OUTCOMES = ['merged', 'merged-with-conflicts-resolved', 'up-to-date', 'refused', 'stopped'];

/**
 * What happened to the run's start commit. `none`: no run, or the call ended
 * before the move. `left-alone`: HEAD's merge brought in something other than
 * the merged ref, so the base was not moved.
 */
export const UPDATE_BRANCH_BASE_STATUSES = ['moved', 'unchanged', 'refused', 'left-alone', 'none'];

/** Who accepted the conflict resolutions: a person in session, or the skill on its own evidence under a driver. */
export const UPDATE_BRANCH_DECIDERS = ['person', 'skill'];

/** Whether the project's checks ran after the merge was staged. */
export const UPDATE_BRANCH_CHECK_STATUSES = ['ran', 'not-run'];

const sha = { type: 'string|null', required: true };
const count = { type: 'integer|null', required: true };

/** The start commit before and after the move; present only when it moved. */
export const UPDATE_BRANCH_START_COMMIT = { from: text, to: text };

/** The run the call moved, or would have moved. */
export const UPDATE_BRANCH_RUN = {
  task_path: text,
  base_status: { type: 'string', required: true, values: UPDATE_BRANCH_BASE_STATUSES },
  start_commit: { type: 'object|null', required: true, keys: UPDATE_BRANCH_START_COMMIT },
  refusal: { type: 'string|null', required: true },
};

/** A run the search set aside, and why. */
export const UPDATE_BRANCH_SKIPPED_RUN = { task_path: text, reason: text };

/** One conflicting file: what was kept and why, and whether it is resolved and staged. */
export const UPDATE_BRANCH_CONFLICT = { path: text, kept: text, why: text, resolved: flag };

/** Who accepted the resolutions, and on what. */
export const UPDATE_BRANCH_RESOLUTIONS = {
  decided_by: { type: 'string', required: true, values: UPDATE_BRANCH_DECIDERS },
  reason: text,
};

/** The test suite's result, as the test-suite runner wrote it. */
export const UPDATE_BRANCH_TESTS = {
  status: { type: 'string|null', required: true },
  passed: count,
  failed: count,
  errors: count,
  skipped: count,
  command: { type: 'string|null', required: true },
  failed_on_base: { type: 'integer', required: false },
};

/** One other check the runner ran: lint, typecheck, build. */
export const UPDATE_BRANCH_CHECK = {
  name: text,
  command: { type: 'string|null', required: true },
  status: { type: 'string', required: true, values: ['passed', 'failed'] },
  fails_on_base: { type: 'boolean', required: false },
};

/** The checks, run on the staged merge before its commit. */
export const UPDATE_BRANCH_CHECKS = {
  status: { type: 'string', required: true, values: UPDATE_BRANCH_CHECK_STATUSES },
  reason: { type: 'string|null', required: true },
  tests: { type: 'object|null', required: true, keys: UPDATE_BRANCH_TESTS },
  checks: { type: 'array', required: true, items: { type: 'object', keys: UPDATE_BRANCH_CHECK } },
};

/** The result file's keys. Shas are full; `merge_commit` is set only on a merged outcome. */
export const UPDATE_BRANCH_RESULT = {
  version: { type: 'integer', required: true },
  outcome: { type: 'string', required: true, values: UPDATE_BRANCH_OUTCOMES },
  reason: { type: 'string|null', required: true },
  driver: text,
  branch: { type: 'string|null', required: true },
  merged_ref: { type: 'string|null', required: true },
  merged_tip: sha,
  merge_commit: sha,
  adopted: flag,
  run: { type: 'object|null', required: true, keys: UPDATE_BRANCH_RUN },
  skipped_runs: { type: 'array', required: true, items: { type: 'object', keys: UPDATE_BRANCH_SKIPPED_RUN } },
  conflicts: { type: 'array', required: true, items: { type: 'object', keys: UPDATE_BRANCH_CONFLICT } },
  resolutions: { type: 'object|null', required: true, keys: UPDATE_BRANCH_RESOLUTIONS },
  checks: { type: 'object', required: true, keys: UPDATE_BRANCH_CHECKS },
  notes: { type: 'array', required: true, items: { type: 'string' } },
  pushed: flag,
  written_at: text,
};
