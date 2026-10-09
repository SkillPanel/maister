/**
 * The autonomy policy a run applies: loaded once, identified by a hash, and read
 * for the class of an item a person may be asked about.
 *
 * Why this module exists. A run records which policy it applied
 * (`orchestrator.policy_hash`), and an answer or a gate request may carry a
 * `triage` that says how much a person must see of it. Both come from one
 * policy file, and every reader must agree on what that file says, what it
 * hashes to and what it classes. So the file is read here, judged here as a
 * whole, hashed here, and read for triage here — nowhere else.
 *
 * Where the policy comes from, first match wins:
 *
 * 1. a path the caller gives;
 * 2. `policy/autonomy-policy.json` in this engine's own skill folder;
 * 3. the built-in `{"version": 1}`, which classes nothing.
 *
 * No file is not a fault: the built-in default applies, silently. A file that
 * exists but cannot be applied is refused whole — never half-read — and the
 * built-in default applies instead, with one `policy-refused:<path>:<reason>`
 * warning returned as data. The hash is always the hash of the policy applied,
 * so a refused file records the default's hash.
 *
 * The autonomy policy file's shape (version 1). Every key but `version` is
 * optional, and a key this module does not know is ignored at every level —
 * though it still counts in the hash:
 *
 *     version          the integer 1
 *     floor            {<floor id>: {description}}
 *     families         {<name>: {class, max?, floor?, description}}
 *     unknown_family   a family name, read for an item with no row
 *     table            [{workflow, id, kind: gate|question, families, values?}]
 *     bands            {<band>: {description, at_least?, without_evidence?}}
 *     ceilings         {<ask level>: {settles, delegates, description?}}
 *     default_ceiling  an ask level
 *
 * Floor ids are opaque non-empty strings, never checked against a list. A
 * family's `floor` is a unique list of them, and its `max` (absent: its own
 * class) is read and checked but bounds nothing yet. A row's `families` lists
 * at least one family, each once, the first being its default reading;
 * `values` maps a gate value key to a family and sits only on a gate row.
 * Family names and a row's `workflow` match `^[a-z][a-z0-9-]*$`, a row's `id`
 * matches the engine's node id pattern, and value keys match `^[a-z_]+$`. A
 * ceiling settles anything below `approve` and says whether it delegates.
 * Beyond the shape, every family a row, `values` or `unknown_family` names
 * must exist, (workflow, id) must be unique across the table, and
 * `default_ceiling` must name a ceiling.
 *
 * Pure apart from the one file read in `loadPolicy`: no stdio, and warnings are
 * returned, never printed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalValue } from './graph.mjs';

/** The policy applied when no file is found or a file is refused. It classes nothing. */
export const DEFAULT_POLICY = Object.freeze({ version: 1 });

/** Where the engine looks when the caller names no path: its own skill folder. */
export const POLICY_LOCATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../policy/autonomy-policy.json');

/** What `source` reads when no file was applied. */
export const BUILT_IN = 'built-in';

/** The triage classes, lowest first: a raise moves an item rightwards, never back. */
export const CLASSES = ['decide-alone', 'record', 'consult', 'approve'];

/** The bands an item can carry. */
export const BANDS = ['clear', 'leaning', 'toss-up'];

/** The ask levels: the keys of `ceilings` and the values of `default_ceiling`. */
export const ASK_LEVELS = ['approve', 'advice', 'decide'];

/** The classes a ceiling may settle without a person: all but the top one. */
const SETTLES = CLASSES.slice(0, -1);

/** The class any floor id sets. */
const FLOOR_CLASS = 'approve';

/** The item kinds a table row can name. A value is read off its gate's row. */
const ROW_KINDS = ['gate', 'question'];

/** What set the final class when it ended above the family's own. */
const RAISED_BY = { floor: 'floor', band: 'band' };

/**
 * Why a file was refused — the last segment of a `policy-refused` warning. A
 * shape fault or a failed cross-check is followed by ` at <where>`, a dotted
 * path into the file (`(root)` for the document itself).
 */
export const REFUSAL = {
  unreadable: 'unreadable',
  notJson: 'not-json',
  version: 'version',
  missingKey: 'missing-key',
  wrongType: 'wrong-type',
  tooShort: 'too-short',
  notInEnum: 'not-in-enum',
  badPattern: 'bad-pattern',
  duplicate: 'duplicate',
  tooFew: 'too-few',
  valuesOnQuestion: 'values-on-question',
  unknownFamilyUndefined: 'unknown-family-undefined',
  familyUndefined: 'family-undefined',
  duplicateRow: 'duplicate-row',
  ceilingUndefined: 'ceiling-undefined',
};

const NAME = /^[a-z][a-z0-9-]*$/;
const ROW_ID = /^[a-z][a-z0-9-]{1,40}$/;
const VALUE_KEY = /^[a-z_]+$/;

/** A file is absent, not unreadable, when the path or a folder on it does not exist. */
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

/**
 * The canonical hash of a policy: keys sorted by code unit at every depth,
 * arrays in order, serialised with no whitespace, SHA-256 over the UTF-8
 * bytes, lowercase hex behind `sha256:`. Taken over the whole parsed file —
 * unknown keys included — never over a normalised reading of it.
 */
export function policyHash(value) {
  const text = JSON.stringify(canonicalValue(value));
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Load the policy a run applies. Returns `{policy, hash, source, warnings}`:
 * `policy` the parsed file as written (or the built-in default), `hash` its
 * canonical hash, `source` the file's path or `built-in`, and `warnings` the
 * `policy-refused` line when a file was refused, else empty.
 */
export function loadPolicy({ path: given } = {}) {
  const file = given ? path.resolve(given) : POLICY_LOCATION;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (ABSENT.has(error?.code)) return builtIn([]);
    return refused(file, REFUSAL.unreadable);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refused(file, REFUSAL.notJson);
  }
  const fault = judge(parsed);
  if (fault) return refused(file, fault);
  return { policy: parsed, hash: policyHash(parsed), source: file, warnings: [] };
}

function builtIn(warnings) {
  return { policy: { ...DEFAULT_POLICY }, hash: policyHash(DEFAULT_POLICY), source: BUILT_IN, warnings };
}

function refused(file, reason) {
  return builtIn([`policy-refused:${file}:${reason}`]);
}

// ---------------------------------------------------------------------------
// Judging a file
// ---------------------------------------------------------------------------

/** A refusal raised while judging; caught by `judge`, never escapes the module. */
class Fault extends Error {
  constructor(code, where) {
    super(where === null ? code : `${code} at ${where || '(root)'}`);
  }
}

/** The first reason the parsed file cannot be applied, or null when it can. */
function judge(doc) {
  if (!isMap(doc)) return new Fault(REFUSAL.wrongType, '').message;
  if (doc.version !== 1) return REFUSAL.version;
  try {
    checkShape(doc);
    crossCheck(doc);
    return null;
  } catch (error) {
    if (error instanceof Fault) return error.message;
    throw error;
  }
}

function checkShape(doc) {
  if (has(doc, 'floor')) {
    names(doc.floor, 'floor', text, (entry, at) => {
      map(entry, at);
      required(entry, 'description', at);
      text(entry.description, `${at}.description`);
    });
  }
  if (has(doc, 'families')) {
    names(doc.families, 'families', pattern(NAME), (family, at) => {
      map(family, at);
      required(family, 'class', at);
      required(family, 'description', at);
      oneOf(family.class, CLASSES, `${at}.class`);
      if (has(family, 'max')) oneOf(family.max, CLASSES, `${at}.max`);
      if (has(family, 'floor')) {
        list(family.floor, `${at}.floor`);
        unique(family.floor, `${at}.floor`, text);
      }
      text(family.description, `${at}.description`);
    });
  }
  if (has(doc, 'unknown_family')) matches(doc.unknown_family, NAME, 'unknown_family');
  if (has(doc, 'table')) {
    list(doc.table, 'table');
    doc.table.forEach((row, index) => checkRow(row, `table.${index}`));
  }
  if (has(doc, 'bands')) {
    names(doc.bands, 'bands', among(BANDS), (band, at) => {
      map(band, at);
      required(band, 'description', at);
      string(band.description, `${at}.description`);
      if (has(band, 'at_least')) oneOf(band.at_least, CLASSES, `${at}.at_least`);
      if (has(band, 'without_evidence')) oneOf(band.without_evidence, BANDS, `${at}.without_evidence`);
    });
  }
  if (has(doc, 'ceilings')) {
    names(doc.ceilings, 'ceilings', among(ASK_LEVELS), (ceiling, at) => {
      map(ceiling, at);
      required(ceiling, 'settles', at);
      required(ceiling, 'delegates', at);
      oneOf(ceiling.settles, SETTLES, `${at}.settles`);
      if (typeof ceiling.delegates !== 'boolean') throw new Fault(REFUSAL.wrongType, `${at}.delegates`);
      if (has(ceiling, 'description')) string(ceiling.description, `${at}.description`);
    });
  }
  if (has(doc, 'default_ceiling')) oneOf(doc.default_ceiling, ASK_LEVELS, 'default_ceiling');
}

function checkRow(row, at) {
  map(row, at);
  for (const key of ['workflow', 'id', 'kind', 'families']) required(row, key, at);
  matches(row.workflow, NAME, `${at}.workflow`);
  matches(row.id, ROW_ID, `${at}.id`);
  oneOf(row.kind, ROW_KINDS, `${at}.kind`);
  list(row.families, `${at}.families`);
  if (row.families.length < 1) throw new Fault(REFUSAL.tooFew, `${at}.families`);
  unique(row.families, `${at}.families`, (name, where) => matches(name, NAME, where));
  if (has(row, 'values')) {
    if (row.kind !== 'gate') throw new Fault(REFUSAL.valuesOnQuestion, `${at}.values`);
    names(row.values, `${at}.values`, pattern(VALUE_KEY), (family, where) => matches(family, NAME, where));
  }
}

function crossCheck(doc) {
  const families = isMap(doc.families) ? doc.families : {};
  const exists = name => Object.hasOwn(families, name);
  if (has(doc, 'unknown_family') && !exists(doc.unknown_family)) {
    throw new Fault(REFUSAL.unknownFamilyUndefined, 'unknown_family');
  }
  const seen = new Set();
  (doc.table ?? []).forEach((row, index) => {
    const at = `table.${index}`;
    row.families.forEach((name, position) => {
      if (!exists(name)) throw new Fault(REFUSAL.familyUndefined, `${at}.families.${position}`);
    });
    for (const [key, name] of Object.entries(row.values ?? {})) {
      if (!exists(name)) throw new Fault(REFUSAL.familyUndefined, `${at}.values.${key}`);
    }
    const identity = JSON.stringify([row.workflow, row.id]);
    if (seen.has(identity)) throw new Fault(REFUSAL.duplicateRow, at);
    seen.add(identity);
  });
  if (has(doc, 'default_ceiling') && !(isMap(doc.ceilings) && Object.hasOwn(doc.ceilings, doc.default_ceiling))) {
    throw new Fault(REFUSAL.ceilingUndefined, 'default_ceiling');
  }
}

function has(value, key) {
  return Object.hasOwn(value, key);
}

function required(value, key, at) {
  if (!has(value, key)) throw new Fault(REFUSAL.missingKey, `${at}.${key}`);
}

function map(value, at) {
  if (!isMap(value)) throw new Fault(REFUSAL.wrongType, at);
}

function string(value, at) {
  if (typeof value !== 'string') throw new Fault(REFUSAL.wrongType, at);
}

function text(value, at) {
  string(value, at);
  if (value.length < 1) throw new Fault(REFUSAL.tooShort, at);
}

function matches(value, shape, at) {
  text(value, at);
  if (!shape.test(value)) throw new Fault(REFUSAL.badPattern, at);
}

function oneOf(value, allowed, at) {
  string(value, at);
  if (!allowed.includes(value)) throw new Fault(REFUSAL.notInEnum, at);
}

function list(value, at) {
  if (!Array.isArray(value)) throw new Fault(REFUSAL.wrongType, at);
}

function unique(items, at, each) {
  const seen = new Set();
  items.forEach((item, index) => {
    each(item, `${at}.${index}`);
    if (seen.has(item)) throw new Fault(REFUSAL.duplicate, `${at}.${index}`);
    seen.add(item);
  });
}

/** A key judge: the key matches `shape`. */
function pattern(shape) {
  return (key, at) => matches(key, shape, at);
}

/** A key judge: the key is one of `allowed`. */
function among(allowed) {
  return (key, at) => oneOf(key, allowed, at);
}

/** A map whose keys pass `judgeKey`, each entry judged by `entry`. */
function names(value, at, judgeKey, entry) {
  map(value, at);
  for (const [key, item] of Object.entries(value)) {
    judgeKey(key, `${at}.${key}`);
    entry(item, `${at}.${key}`);
  }
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/**
 * The `triage` v1 an item carries under `policy`, or null when the policy does
 * not class it. Raise-only: the class starts at the family's own, and only the
 * floor and the band raise it — neither is bounded by the family's `max`, and
 * nothing lowers it.
 *
 * - `kind` is `gate`, `question` or `value`. A gate's `id` is its node id; a
 *   question's `id` is its question id, read against the asking node's
 *   `declaredIds`; a value's `id` is its gate's node id and `key` its value key.
 * - `family` is a proposed family, used only when the row lists it.
 * - `floorIds` are floor ids found on the item; they join the family's floor.
 * - `band` is the item's band; its `without_evidence` is applied once when the
 *   item carries no `evidence`.
 *
 * Writes `{version: 1, class, floor?, family, band?, raised_by?}`: `floor` when
 * any id applies, `band` when one was applied, `raised_by` when the final class
 * is above the family's own. Never `advice` or `held`.
 */
export function triageFor({ policy, workflow, kind, id, declaredIds, key, family, floorIds, band, evidence } = {}) {
  const families = isMap(policy?.families) ? policy.families : {};
  const name = familyOf({ policy, workflow, kind, id, declaredIds, key, proposed: family });
  if (name === null || !isMap(families[name])) return null;
  const own = families[name];
  let level = rank(own.class);
  if (level < 0) return null;
  const start = level;
  let raisedBy = null;

  const floor = [...new Set([...ids(own.floor), ...ids(floorIds)])];
  if (floor.length > 0 && rank(FLOOR_CLASS) > level) {
    level = rank(FLOOR_CLASS);
    raisedBy = RAISED_BY.floor;
  }

  const applied = bandOf(policy, band, evidence);
  if (applied !== null) {
    const atLeast = rank(policy.bands[applied].at_least);
    if (atLeast > level) {
      level = atLeast;
      raisedBy = RAISED_BY.band;
    }
  }

  const triage = { version: 1, class: CLASSES[level] };
  if (floor.length > 0) triage.floor = floor;
  triage.family = name;
  if (applied !== null) triage.band = applied;
  if (level > start) triage.raised_by = raisedBy;
  return triage;
}

/** The family an item reads as, or null when it is unclassified. */
function familyOf({ policy, workflow, kind, id, declaredIds, key, proposed }) {
  const fallback = typeof policy?.unknown_family === 'string' ? policy.unknown_family : null;
  const rowKind = kind === 'value' ? 'gate' : kind;
  const rowId = kind === 'question' ? declaredIdOf(id, declaredIds) : id;
  const row = Array.isArray(policy?.table)
    ? policy.table.find(each => isMap(each) && each.workflow === workflow && each.kind === rowKind && each.id === rowId)
    : undefined;
  if (!row) return fallback;
  if (kind === 'value') {
    const named = isMap(row.values) && Object.hasOwn(row.values, key) ? row.values[key] : null;
    return typeof named === 'string' ? named : fallback;
  }
  const listed = Array.isArray(row.families) ? row.families : [];
  if (typeof proposed === 'string' && listed.includes(proposed)) return proposed;
  return typeof listed[0] === 'string' ? listed[0] : fallback;
}

/**
 * The declared question id an asked id reads as. A declared id reads as
 * itself. An undeclared one — a per-area slug a node builds at run time — reads
 * as the longest declared id it extends (`<declared>-…`), else as the node's
 * only declared id. With several declared ids and none it extends, it reads as
 * itself and so finds no row of its own.
 */
function declaredIdOf(id, declaredIds) {
  const declared = Array.isArray(declaredIds) ? declaredIds.filter(each => typeof each === 'string') : [];
  if (declared.length === 0 || declared.includes(id)) return id;
  const extended = declared.filter(each => typeof id === 'string' && id.startsWith(`${each}-`));
  if (extended.length > 0) return extended.sort((a, b) => b.length - a.length)[0];
  return declared.length === 1 ? declared[0] : id;
}

/** The band applied: the given one, moved once by `without_evidence` when there is no evidence. */
function bandOf(policy, band, evidence) {
  const bands = isMap(policy?.bands) ? policy.bands : {};
  if (typeof band !== 'string' || !isMap(bands[band])) return null;
  const moved = bands[band].without_evidence;
  if (evidence == null && typeof moved === 'string' && isMap(bands[moved])) return moved;
  return band;
}

function rank(value) {
  return CLASSES.indexOf(value);
}

function ids(value) {
  return Array.isArray(value) ? value.filter(each => typeof each === 'string' && each.length > 0) : [];
}
