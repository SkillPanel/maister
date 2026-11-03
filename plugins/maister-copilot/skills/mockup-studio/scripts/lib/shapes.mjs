/**
 * The mockup studio's contract: the workflow's inputs and run record, the
 * folder layout a turn writes, and the shape of every file in it, each key
 * declared once with its type and whether every file of that kind carries it.
 *
 * Why this module exists. A driver binding to the `mockup-studio` workflow, a
 * caller reading a mockups folder and the scripts that write it all need the
 * same names. The scripts (`turn.mjs`, `frames.mjs`) take their shapes from
 * here, and the plugin's interface file is generated from here, so what a
 * reader diffs between two commits is what the scripts write.
 *
 * A declaration is `{type, required}`, and for a map `keys`, for a list
 * `items`, for a closed string `values`, for a value described elsewhere `see`
 * — the form of the workflow engine's `interface-shapes.mjs`. `type` is one
 * JSON type, or several joined by `|`: `string`, `boolean`, `integer`,
 * `object`, `array`, `null`. A value that can be null is a union such as
 * `string|null`. A workflow input also carries `input_type` (the engine's
 * input type), `default` when it has one and `maps_to` (the turn input it
 * becomes); a run-record value carries `value_type` (the engine's value type).
 *
 * No command text lives here: the next-turn recipe is described by workflow,
 * inputs and values, and the scripts return codes, never a command to type.
 *
 * Pure: no I/O. Zero dependencies, Node >= 20.
 */

/** The built-in workflow a driver binds to, and its one node. */
export const WORKFLOW_NAME = 'mockup-studio';
export const TURN_NODE = 'turn';

/** The version `grounding.json` carries, raised when its shape changes in a way a reader must know. */
export const GROUNDING_SCHEMA_VERSION = 1;

/** The formats a version can be written in. */
export const FORMATS = ['html', 'ascii'];

/** How far a version goes: still screens, or a working page the screens are exported from. */
export const FIDELITIES = ['sketch', 'prototype'];

/** Why a version holds less than the note asked for. A closed set: the manifest's `degraded` names only these. */
export const DEGRADED_REASONS = ['no-node', 'render-touches-dom', 'render-failed', 'grounding-unavailable', 'incomplete'];

/** What a grounding source is. */
export const SOURCE_KINDS = ['theme', 'tokens', 'lockfile', 'shell', 'i18n'];

/** A version id, and a screen slug, as patterns (strings, so the declarations stay plain data). */
export const VERSION_PATTERN = '^v\\d{3,}$';
export const SLUG_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';

const text = { type: 'string', required: true };
const optionalText = { type: 'string', required: false };
const nullableText = { type: 'string|null', required: true };
const flag = { type: 'boolean', required: true };
const strings = required => ({ type: 'array', required, items: { type: 'string' } });
const reasons = required => ({ type: 'array', required, items: { type: 'string', values: DEGRADED_REASONS } });

/**
 * The workflow's inputs, as `mockup-studio.yml` declares them. `input_type` is
 * the engine's type, `type` what the turn receives (an optional input with no
 * default arrives as null), and `maps_to` the turn input it becomes.
 */
export const TURN_INPUTS = {
  task_path: { type: 'string|null', input_type: 'path', required: false, maps_to: 'task_path' },
  output_subdir: { type: 'string', input_type: 'string', required: false, default: 'analysis/mockups', maps_to: 'output_subdir' },
  note: { type: 'string', input_type: 'string', required: true, maps_to: 'turn.note' },
  against: { type: 'string|null', input_type: 'string', required: false, maps_to: 'turn.against' },
  scope: { type: 'string|null', input_type: 'string', required: false, maps_to: 'turn.scope' },
  fidelity: { type: 'string', input_type: 'string', required: false, default: 'sketch', values: FIDELITIES, maps_to: 'fidelity' },
  format: { type: 'string|null', input_type: 'string', required: false, values: [...FORMATS, null], maps_to: 'format' },
  brief: { type: 'string|null', input_type: 'string', required: false, maps_to: 'brief' },
  grounding: { type: 'string', input_type: 'path', required: false, default: '.maister/docs/design-context', maps_to: 'grounding' },
};

/**
 * What one run of the workflow records: the `turn` node's values, which
 * `finish` prints ready to record (lists comma-joined, the count a decimal
 * string), and the run-folder artifact `finish --record` writes.
 */
export const RUN_RECORD = {
  values: {
    version: { type: 'string', value_type: 'id', required: true },
    against: { type: 'string|null', value_type: 'id', required: true },
    screens: { type: 'string', value_type: 'id', required: true },
    changed: { type: 'string', value_type: 'id', required: true },
    degraded: { type: 'boolean', value_type: 'bool', required: true },
    notes_count: { type: 'string', value_type: 'id', required: true },
    format: { type: 'string', value_type: { enum: FORMATS }, required: true, values: FORMATS },
    fidelity: { type: 'string', value_type: { enum: FIDELITIES }, required: true, values: FIDELITIES },
  },
  artifacts: {
    turn_result: { type: 'string', required: true, path: 'turn-result.json', see: 'turn_result' },
  },
};

/**
 * Turn N+1. A fresh run of the same workflow over the same folder; there is no
 * verb that reopens a finished run. Each run's `values.version` and
 * `values.against` bind it to its version without reading the index.
 */
export const NEXT_TURN = {
  workflow: WORKFLOW_NAME,
  fresh_run: true,
  inputs: {
    task_path: 'the same as the previous turn',
    output_subdir: 'the same as the previous turn',
    note: 'the new note',
    against: "the previous run's values.version, or latest in versions/index.json",
  },
  binds: ['values.version', 'values.against'],
};

/**
 * What a turn returns, and what `turn-result.json` holds: `finish`'s output
 * minus `ok` and `values`. `screens` and `changed` are slug lists; `gallery`
 * is `versions/<version>/index.html` relative to `task_path`, null for ASCII;
 * `task_path` is the target, relative to the project root.
 */
export const TURN_RESULT_KEYS = {
  version: text,
  against: nullableText,
  screens: strings(true),
  changed: strings(true),
  notes: strings(true),
  degraded: reasons(false),
  format: { type: 'string', required: true, values: FORMATS },
  fidelity: { type: 'string', required: true, values: FIDELITIES },
  task_path: text,
  output_subdir: text,
  gallery: nullableText,
};

/**
 * Where a turn writes, under `<task_path>/<output_subdir>/`. `<version>` is a
 * version id, `<slug>` a screen slug. Dot-files are the scripts' own and are
 * skipped by every reader that counts files.
 */
export const LAYOUT = {
  root: '<task_path>/<output_subdir>',
  version_id: VERSION_PATTERN,
  slug: SLUG_PATTERN,
  versions: {
    index: 'versions/index.json',
    lock: 'versions/.lock',
    dir: 'versions/<version>',
    files: {
      manifest: 'versions/<version>/manifest.json',
      pages: 'versions/<version>/<slug>.html',
      gallery: 'versions/<version>/index.html',
      ascii: 'versions/<version>/ascii-mockups.md',
      prototype: 'versions/<version>/prototype.html',
      mockups_json: 'versions/<version>/.mockups.json',
    },
    transient: ['versions/<version>/.turn.json', 'versions/<version>/.frames.json'],
  },
  flat: {
    pages: '<slug>.html',
    ascii: 'ascii-mockups.md',
    mockups_json: '.mockups.json',
  },
  index_rows: '<task_path>/analysis/design-context/INDEX.md',
  note: 'No per-turn design-context/design-resources.md is written: the manifest\'s grounding_digest and grounding_stale record what a turn grounded on, and the grounding pack holds the resolved values.',
};

/** One entry of `versions/index.json`, oldest first. */
const VERSION_ENTRY = {
  version: text,
  created: text,
  note: text,
  parent: nullableText,
  changed: strings(true),
};

/** `versions/index.json`. `bookmarked` is edited by hand; no verb writes it, and `finish` keeps it as found. */
export const VERSIONS_INDEX_KEYS = {
  latest: nullableText,
  versions: { type: 'array', required: true, items: { type: 'object', keys: VERSION_ENTRY } },
  bookmarked: optionalText,
};

/** One screen of a version's manifest. */
const MANIFEST_SCREEN = {
  slug: text,
  title: text,
  changed: flag,
  live: optionalText,
  behaviour: strings(false),
};

/** `versions/<version>/manifest.json`. */
export const MANIFEST_KEYS = {
  version: text,
  created: text,
  note: text,
  parent: nullableText,
  format: { type: 'string', required: true, values: FORMATS },
  fidelity: { type: 'string', required: true, values: FIDELITIES },
  prototype: optionalText,
  screens: { type: 'array', required: true, items: { type: 'object', keys: MANIFEST_SCREEN } },
  grounding_digest: nullableText,
  grounding_stale: flag,
  degraded: reasons(false),
};

/** One screen of `.mockups.json`; `id` is the slug. */
const MOCKUP = {
  id: text,
  title: text,
  html: text,
  css: text,
  annotations: { type: 'array', required: true },
};

/** `.mockups.json`, per version and flat. `latestId` is the first changed slug, else the first screen. */
export const MOCKUPS_JSON_KEYS = {
  latestId: text,
  mockups: { type: 'array', required: true, items: { type: 'object', keys: MOCKUP } },
};

/** One recorded grounding source. `package` and `version` only on a `package-lock.json` entry. */
const GROUNDING_SOURCE = {
  path: text,
  hash: text,
  kind: { type: 'string', required: true, values: SOURCE_KINDS },
  package: optionalText,
  version: optionalText,
};

/** `grounding.json`, in the grounding pack. Paths are relative to the project root; hashes are git blob sha1 hex. */
export const GROUNDING_KEYS = {
  schema_version: { type: 'integer', required: true },
  built: text,
  sources: { type: 'array', required: true, items: { type: 'object', keys: GROUNDING_SOURCE } },
  images: { type: 'array', required: true, items: { type: 'object', keys: { path: text, hash: text } } },
  digest: text,
};

// The input files below are internal: the model writes them with its file
// tool, a script reads and deletes them, and no reader outside the skill sees
// them. They are declared here so the scripts check them against one shape.

/** One screen the turn sends in `.turn.json`. A missing `slug` is resolved by title, then made fresh. */
const TURN_SCREEN = {
  slug: optionalText,
  title: text,
  html: optionalText,
  css: optionalText,
  annotations: { type: 'array', required: false },
  description: optionalText,
  behaviour: strings(false),
  components: { type: 'array', required: false, items: { type: 'object', keys: { id: text, description: text } } },
};

/**
 * `versions/<version>/.turn.json`. `screens` is required for sketch and ascii
 * fidelity and absent for prototype, whose scenes come from `.frames.json`.
 * `against` is the version `begin` returned; absent, `finish` builds on the
 * latest.
 */
export const TURN_FILE = {
  note: text,
  format: { type: 'string', required: true, values: FORMATS },
  fidelity: { type: 'string', required: true, values: FIDELITIES },
  against: { type: 'string|null', required: false },
  scope: strings(false),
  grounding: { type: 'object', required: true, keys: { digest: nullableText, stale: flag } },
  screens: { type: 'array', required: false, items: { type: 'object', keys: TURN_SCREEN } },
  drop: strings(false),
  degraded: reasons(false),
  notes: strings(false),
  prototype: optionalText,
};

/** `versions/<version>/.frames.json`, written by `frames.mjs export`: one screen per scene. */
export const FRAMES_FILE = {
  screens: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      keys: {
        slug: text,
        title: text,
        html: text,
        css: text,
        annotations: { type: 'array', required: true },
        behaviour: strings(true),
      },
    },
  },
};

/** `<pack>/.sources.json`, read by `ground-seal`: what to hash. */
export const SOURCES_FILE = {
  sources: {
    type: 'array',
    required: true,
    items: { type: 'object', keys: { path: text, kind: { type: 'string', required: true, values: SOURCE_KINDS }, package: optionalText } },
  },
  images: { type: 'array', required: true, items: { type: 'object', keys: { path: text } } },
};

/**
 * Where `value` departs from `declaration`: a key the declaration does not
 * name, a required key missing, a type or a value outside it. Each departure
 * is one line naming its dotted location; an empty list means it conforms.
 */
export function departures(value, declaration, where = 'value') {
  const found = [];
  if (!typeAllowed(value, declaration.type)) return [`${where} is ${describe(value)}, not ${declaration.type}`];
  if (declaration.values && !declaration.values.includes(value)) {
    found.push(`${where} is ${JSON.stringify(value)}, not one of ${declaration.values.map(each => JSON.stringify(each)).join(', ')}`);
  }
  if (declaration.keys && isMap(value)) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(declaration.keys, key)) found.push(`${where}.${key} is not a key this file takes`);
      else found.push(...departures(value[key], declaration.keys[key], `${where}.${key}`));
    }
    for (const [key, spec] of Object.entries(declaration.keys)) {
      if (spec.required && !Object.hasOwn(value, key)) found.push(`${where}.${key} is required and missing`);
    }
  }
  if (declaration.items && Array.isArray(value)) {
    value.forEach((item, index) => found.push(...departures(item, declaration.items, `${where}[${index}]`)));
  }
  return found;
}

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function typeAllowed(value, type) {
  return type.split('|').some(each => ({
    string: typeof value === 'string',
    boolean: typeof value === 'boolean',
    integer: Number.isInteger(value),
    object: isMap(value),
    array: Array.isArray(value),
    null: value === null,
  })[each]);
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'a map' : `${typeof value} ${JSON.stringify(value)}`;
}
