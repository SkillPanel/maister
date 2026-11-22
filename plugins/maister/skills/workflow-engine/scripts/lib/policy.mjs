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
 * The same holds for the autonomy ceiling, the most a run may settle alone:
 * `ceilingOf` reads it, `effectiveCeiling` and `narrowerLevel` are the one rule
 * every clamp uses, and `questionOutcome` says what a classed in-node question
 * comes to under it and the run's driver.
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
 * family's `floor` is a unique list of them, and its `max` is a class, read
 * and checked but bounding nothing yet. A row's `families` lists at least one
 * family, each once, the first being its default reading; `values` maps a gate
 * value key to a family and sits only on a gate row. A row's `workflow` is the
 * name of the run it classes, with one reserved name: a run whose definition
 * the engine finds in the project's generated-chain home
 * (`.maister/workflows/generated/`) is classed by the rows under `generated`,
 * whatever its file and `name:` are, because each such chain is planned under
 * a name of its own. Family names and a row's `workflow` match `^[a-z][a-z0-9-]*$`, a
 * row's `id` matches the engine's node id pattern, and value keys match
 * `^[a-z_]+$`. A ceiling's `settles` is a class below `approve` and its
 * `delegates` a boolean. Beyond the shape, every family a row, `values` or
 * `unknown_family` names must exist, (workflow, id) must be unique across the
 * table, and `default_ceiling` must name a ceiling.
 *
 * Pure apart from the one file read in `loadPolicy`: no stdio, and warnings are
 * returned, never printed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalValue } from './graph.mjs';
import { TRIAGE_CLASSES } from './interface-shapes.mjs';

/** The policy applied when no file is found or a file is refused. It classes nothing. */
export const DEFAULT_POLICY = Object.freeze({ version: 1 });

/** Where the engine looks when the caller names no path: its own skill folder. */
export const POLICY_LOCATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../policy/autonomy-policy.json');

/** The workflow name every generated chain's run is classed under, whatever its own name. */
export const GENERATED_WORKFLOW = 'generated';

/** What `source` reads when no file was applied. */
export const BUILT_IN = 'built-in';

/** The triage classes, lowest first: a raise moves an item rightwards, never back. Declared with the interface. */
export const CLASSES = TRIAGE_CLASSES;

/** The bands an item can carry. */
export const BANDS = ['clear', 'leaning', 'toss-up'];

/** The ask levels: the keys of `ceilings` and the values of `default_ceiling`. */
export const ASK_LEVELS = ['approve', 'advice', 'decide'];

/** The classes a ceiling's `settles` may name: all but the top one. */
const SETTLES = CLASSES.slice(0, -1);

/** The class any floor id sets. */
const FLOOR_CLASS = 'approve';

/** The item kinds a table row can name. A value is read off its gate's row. */
const ROW_KINDS = ['gate', 'question'];

/**
 * What set the final class when it ended above the family's own: a floor id, a
 * band, a choice's own wording, or the second reader's raise.
 */
export const RAISED_BY = Object.freeze({ floor: 'floor', band: 'band', wording: 'wording', reader: 'reader' });

/**
 * What a choice lifts a question to: the lowest class the run never settles.
 * A choice may be asked or defaulted with its advice not obtained, never settled
 * as a fact.
 */
const CHOICE_CLASS = 'consult';

/**
 * The classes each lift raises from, to `CHOICE_CLASS`. A choice's wording lifts
 * the class the run settles as a fact, `record`, and leaves `decide-alone` —
 * the routine choices a policy lets the run take on purpose — as the policy
 * reads it. The reader's raise lifts every class below `CHOICE_CLASS`.
 */
const LIFTS = { [RAISED_BY.wording]: ['record'], [RAISED_BY.reader]: ['decide-alone', 'record'] };

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

/** What a family's name matches: a question set's proposed `family` is checked against it. */
export const FAMILY_NAME = NAME;
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
 * not class it. The family is the one `familyChoice` gives; from there the
 * class is raise-only: it starts at that family's own, and only the floor and
 * the band raise it — neither is bounded by the family's `max`, and nothing
 * lowers it.
 *
 * - `kind` is `gate`, `question` or `value`. A gate's `id` is its node id; a
 *   question's `id` is its question id, read against the asking node's
 *   `declaredIds`; a value's `id` is its gate's node id and `key` its value key.
 * - `family` is a proposed family, `reader` the second reader's verdict on a
 *   question and `carried` the triage the question carries of its own; see
 *   `familyChoice` for when a proposal is applied.
 * - `floorIds` are floor ids found on the item; they join the family's floor.
 * - `band` is the item's band; its `without_evidence` is applied once when the
 *   item carries no `evidence`.
 *
 * Writes `{version: 1, class, floor?, family, band?, raised_by?}`: `floor` when
 * any id applies, `band` when one was applied, `raised_by` when the final class
 * is above the family's own. Never `advice` or `held`.
 */
export function triageFor({ policy, workflow, kind, id, declaredIds, key, family, reader, carried, floorIds, band, evidence } = {}) {
  const { family: name } = familyChoice({ policy, workflow, kind, id, declaredIds, key, proposed: family, reader, carried });
  return triageUnder({ policy, family: name, floorIds, band, evidence });
}

/** The second reader's verdicts: `agree` lets a question take a lower family, `raise` keeps the first. */
export const VERDICT = Object.freeze({ agree: 'agree', raise: 'raise' });

/**
 * The `triage` v1 of an item read as `family` — a family `familyChoice`
 * already chose — or null when `family` is null or not one the policy
 * defines. The class rules are `triageFor`'s; a caller that needs the choice
 * itself (its reason, whether the proposal was a lowering) calls
 * `familyChoice` once and passes its family here.
 *
 * `lifts` names what marks the item as a choice — `wording` (its question is
 * worded as one), `reader` (the second reader raised it) — each lifting the
 * classes `LIFTS` lists to `consult` before the floor and the band apply,
 * `raised_by` naming the first lift that moved it. Raise-only, like the rest.
 */
export function triageUnder({ policy, family: name, floorIds, band, evidence, lifts = [] } = {}) {
  // The policy is one `loadPolicy` accepted (or the built-in default), so its
  // shape is not re-checked here: every family a row or `unknown_family`
  // names exists, and each class is a known one.
  if (name == null || !Object.hasOwn(policy?.families ?? {}, name)) return null;
  const own = policy.families[name];
  let level = rank(own.class);
  const start = level;
  let raisedBy = null;

  for (const lift of Array.isArray(lifts) ? lifts : []) {
    if (Object.hasOwn(LIFTS, lift) && LIFTS[lift].includes(CLASSES[level])) {
      level = rank(CHOICE_CLASS);
      raisedBy = lift;
    }
  }

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

/**
 * Why a proposed family was not applied — `familyChoice`'s `reason`. A caller
 * that notes a proposal it did not take words the note from this code.
 */
export const FAMILY_REASON = Object.freeze({
  noRow: 'no-row',
  unlisted: 'unlisted',
  flooredFirst: 'floored-first',
  choice: 'choice',
  carriesTriage: 'carries-triage',
  noVerdict: 'no-verdict',
  raised: 'raised',
});

/**
 * The one rule for the family an item reads as, and why a proposal was not
 * applied: `{family, reason, lower}`, `family` null when the item is
 * unclassified, `reason` null unless a proposal came and was not applied, and
 * `lower` true when the proposal is a family the row lists below its first —
 * whether or not it was applied.
 *
 * - No row: the policy's `unknown_family`, which a proposal never moves
 *   (`no-row` when one came).
 * - A value: its gate row's `values[key]`, else the unknown family; it takes
 *   no proposal.
 * - No proposal: the row's first family.
 * - A proposal the row lists that is at least as strict as the first family
 *   (`strictness`) is applied, with no verdict needed.
 * - A lower one the row lists is applied only to a question, only when the
 *   first family carries no floor, the question is not worded as a choice
 *   (`choice`), carries no version-1 triage of its own (`carried`) and the
 *   second reader agreed (`reader.verdict` is `agree`). A gate is never
 *   lowered: its `reader` is not read.
 * - Otherwise the first family, with the first reason that holds, in order:
 *   `unlisted`, `floored-first`, `choice`, `carries-triage`, `no-verdict`,
 *   `raised`.
 */
export function familyChoice({ policy, workflow, kind, id, declaredIds, key, proposed, reader, carried, choice = false } = {}) {
  const proposal = typeof proposed === 'string' ? proposed : null;
  const fallback = policy?.unknown_family ?? null;
  const row = rowOf({ policy, workflow, kind, id, declaredIds });
  if (!row) return { family: fallback, reason: proposal === null ? null : FAMILY_REASON.noRow, lower: false };
  if (kind === 'value') {
    return { family: row.values && Object.hasOwn(row.values, key) ? row.values[key] : fallback, reason: null, lower: false };
  }
  const first = row.families[0];
  if (proposal === null) return { family: first, reason: null, lower: false };
  if (!row.families.includes(proposal)) return { family: first, reason: FAMILY_REASON.unlisted, lower: false };
  const lower = isBelow(policy, proposal, first);
  if (!lower) return { family: proposal, reason: null, lower };
  const keep = reason => ({ family: first, reason, lower });
  if (carriesFloor(policy, first)) return keep(FAMILY_REASON.flooredFirst);
  // Only a question has a second reader; a gate's lowering reads as one with no verdict.
  if (kind !== 'question') return keep(FAMILY_REASON.noVerdict);
  if (choice === true) return keep(FAMILY_REASON.choice);
  if (isMap(carried) && carried.version === 1) return keep(FAMILY_REASON.carriesTriage);
  const verdict = isMap(reader) ? reader.verdict : undefined;
  if (verdict === VERDICT.agree) return { family: proposal, reason: null, lower };
  return keep(verdict === VERDICT.raise ? FAMILY_REASON.raised : FAMILY_REASON.noVerdict);
}

/** Whether family `name` is less strict than the row's `first` (`strictness`). */
function isBelow(policy, name, first) {
  return strictness(policy, name) < strictness(policy, first);
}

/** Whether family `name` carries a floor of its own. */
function carriesFloor(policy, name) {
  return ids(policy?.families?.[name]?.floor).length > 0;
}

/** The table row an item reads, or undefined: a value reads its gate's row, a question its declared id's. */
function rowOf({ policy, workflow, kind, id, declaredIds }) {
  const rowKind = kind === 'value' ? 'gate' : kind;
  const rowId = kind === 'question' ? declaredIdOf(id, declaredIds) : id;
  return (policy?.table ?? []).find(each => each.workflow === workflow && each.kind === rowKind && each.id === rowId);
}

/**
 * How strict a family is, as a class rank: its class, or the floor's class
 * when the family carries a floor of its own. One measure for every kind, so a
 * proposal never drops a floor the first family carries. -1 for a family the
 * policy does not define.
 */
function strictness(policy, name) {
  const families = policy?.families ?? {};
  if (!Object.hasOwn(families, name)) return -1;
  const own = families[name];
  return ids(own.floor).length > 0 ? Math.max(rank(own.class), rank(FLOOR_CLASS)) : rank(own.class);
}

/**
 * The families a node may propose for a question it asks, as
 * `[{name, description, lower?}]` in row order: the first family of the row
 * its declared id reads, every other the row lists that is at least as strict,
 * and — only when the first family carries no floor — the lower ones, each
 * marked `lower: true`, since one is applied only with the second reader's
 * agreement. Empty when no row of `kind: question` matches; the policy's
 * unknown family is never offered, since a proposal never applies to it.
 */
export function questionFamilies({ policy, workflow, id, declaredIds } = {}) {
  const row = rowOf({ policy, workflow, kind: 'question', id, declaredIds });
  if (!row) return [];
  const families = policy.families;
  const first = row.families[0];
  const lowerOffered = !carriesFloor(policy, first);
  const offered = [];
  for (const name of row.families) {
    const entry = { name, description: families[name].description };
    if (!isBelow(policy, name, first)) offered.push(entry);
    else if (lowerOffered) offered.push({ ...entry, lower: true });
  }
  return offered;
}

/**
 * The declared question id an asked id reads as. A declared id reads as
 * itself. An undeclared one — a per-area slug a node builds at run time — reads
 * as the longest declared id it extends (`<declared>-…`), else as the node's
 * only declared id. With several declared ids and none it extends, it reads as
 * itself and so finds no row of its own.
 */
export function declaredIdOf(id, declaredIds) {
  const declared = Array.isArray(declaredIds) ? declaredIds.filter(each => typeof each === 'string') : [];
  if (declared.length === 0 || declared.includes(id)) return id;
  const extended = declared.filter(each => typeof id === 'string' && id.startsWith(`${each}-`));
  if (extended.length > 0) return extended.sort((a, b) => b.length - a.length)[0];
  return declared.length === 1 ? declared[0] : id;
}

/** The band applied: the given one, moved once by `without_evidence` when there is no evidence. */
function bandOf(policy, band, evidence) {
  const bands = policy?.bands ?? {};
  if (typeof band !== 'string' || !Object.hasOwn(bands, band)) return null;
  const moved = bands[band].without_evidence;
  if (evidence == null && moved !== undefined && Object.hasOwn(bands, moved)) return moved;
  return band;
}

function rank(value) {
  return CLASSES.indexOf(value);
}

function ids(value) {
  return Array.isArray(value) ? value.filter(each => typeof each === 'string' && each.length > 0) : [];
}

// ---------------------------------------------------------------------------
// The autonomy ceiling, and what a classed question comes to under it
// ---------------------------------------------------------------------------

/** The most a run ever settles alone, whatever its autonomy ceiling names. */
const SETTLES_AT_MOST = 'record';

/** An ask level as recorded: a known level itself, anything else `approve`, the narrowest. */
function levelOf(value) {
  return ASK_LEVELS.includes(value) ? value : ASK_LEVELS[0];
}

/**
 * The autonomy ceiling a run reads: `{level, settles}`, or null when it has
 * none. The level is `options.ceiling` when that is a non-empty string — a
 * value outside `ASK_LEVELS` reads as `approve` — else the policy's
 * `default_ceiling`. `settles` is that level's `ceilings.<level>.settles`,
 * capped at `record`, or null when the policy does not define the level. The
 * level's `delegates` flag is not read here.
 *
 * The caller reads it only for a run whose recorded `policy_hash` is the
 * loaded policy's.
 */
export function ceilingOf({ options, policy } = {}) {
  const sent = options && typeof options === 'object' ? options.ceiling : undefined;
  let level;
  if (typeof sent === 'string' && sent !== '') level = levelOf(sent);
  else if (typeof policy?.default_ceiling === 'string') level = levelOf(policy.default_ceiling);
  else return null;
  const defined = isMap(policy?.ceilings) && isMap(policy.ceilings[level]) ? policy.ceilings[level].settles : null;
  if (!SETTLES.includes(defined)) return { level, settles: null };
  return { level, settles: rank(defined) > rank(SETTLES_AT_MOST) ? SETTLES_AT_MOST : defined };
}

/**
 * The autonomy ceiling in effect for a run, as a level or null: its recorded
 * `options.ceiling` (an unknown value reading as `approve`), else the policy's
 * `default_ceiling` when the run's `policy_hash` is `policyHash`, else none.
 * One rule for every reader that clamps by it: a later write, a child run's
 * freeze, a dispatch envelope.
 */
export function effectiveCeiling({ orchestrator, policy, policyHash: hash } = {}) {
  const options = isMap(orchestrator) && isMap(orchestrator.options) ? orchestrator.options : {};
  if (typeof options.ceiling === 'string' && options.ceiling !== '') return levelOf(options.ceiling);
  const matches = isMap(orchestrator) && typeof hash === 'string' && orchestrator.policy_hash === hash;
  if (matches && typeof policy?.default_ceiling === 'string') return levelOf(policy.default_ceiling);
  return null;
}

/**
 * The narrower of two ask levels, by `approve` < `advice` < `decide`, a value
 * outside them reading as `approve`. A null or undefined side is absent and
 * bounds nothing: the other is returned, and null when both are absent.
 */
export function narrowerLevel(a, b) {
  if (a == null) return b == null ? null : levelOf(b);
  if (b == null) return levelOf(a);
  const [one, two] = [levelOf(a), levelOf(b)];
  return ASK_LEVELS.indexOf(one) <= ASK_LEVELS.indexOf(two) ? one : two;
}

/**
 * What a question comes to: `{outcome, triage}`.
 *
 * - `triage` null: `unclassed`, carried as today.
 * - A class within `settles` (decide-alone or record, never above record):
 *   `settle`, under every driver.
 * - Otherwise, when a person can be asked (`canAsk`): `ask`.
 * - Otherwise a decide-alone or record question is `default`ed; a consult one
 *   is `default`ed with `advice: not_obtained`; an approve one — or one whose
 *   class this build does not know — is `hold`, with `held: true`.
 *
 * Pure: the triage given is copied, never changed. Consult and approve are
 * never settled.
 */
export function questionOutcome({ triage, settles, canAsk } = {}) {
  if (!isMap(triage)) return { outcome: 'unclassed', triage: null };
  const known = rank(triage.class);
  const level = known === -1 ? rank(FLOOR_CLASS) : known;
  const bound = SETTLES.includes(settles) ? Math.min(rank(settles), rank(SETTLES_AT_MOST)) : -1;
  if (level <= rank(SETTLES_AT_MOST) && level <= bound) return { outcome: 'settle', triage: { ...triage } };
  if (canAsk === true) return { outcome: 'ask', triage: { ...triage } };
  if (level === rank('consult')) return { outcome: 'default', triage: { ...triage, advice: 'not_obtained' } };
  if (level >= rank(FLOOR_CLASS)) return { outcome: 'hold', triage: { ...triage, held: true } };
  return { outcome: 'default', triage: { ...triage } };
}
