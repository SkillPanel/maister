/**
 * The decision areas a brainstorm writes beside its markdown: read, judged
 * whole, checked for freshness, and rendered as the questions a convergence
 * node asks.
 *
 * Why this module exists. Convergence used to read the brainstorm's markdown
 * and compose each area's question itself, so the terminal picker and a
 * cockpit's question set were two model-written texts that could disagree with
 * each other and with the document. The brainstormer now writes the areas as
 * data (`decision-areas.json`), and every question is rendered from that data
 * here, the same way for every surface. Every content string a user sees comes
 * verbatim from the file; this module only selects, orders by the recorded
 * rank, clips previews to the preview budget and the header to its length,
 * drops backticks for a labels-only picker, and adds the fixed labels below.
 *
 * The shape (version 1; the whole of it is `references/decision-areas.md`):
 *
 *     version   the bare number 1
 *     source    {path, sha256}: the markdown, task-relative, and its bytes' SHA-256
 *     areas     [{id, area, question, why, depends_on?, recommendation, alternatives}]
 *               alternatives: [{id, title, description, pros, cons, key_pro, key_con}]
 *               recommendation: {alternative, reason} or null
 *
 * Keys are closed at every level. A file is judged whole and refused with its
 * first fault, `<reason> at <dotted.path>` (the root as `(root)`), the reason
 * one of `FAULT`'s sixteen. No area is ever rendered from a refused file.
 *
 * The codes `loadAreas` returns, as `<code>:<task-relative path>[:<detail>]`:
 *
 *     decision-areas-missing      the file is not there
 *     decision-areas-unreadable   it exists but cannot be read (detail: the error code)
 *     decision-areas-invalid      not JSON, or the shape fails (detail: the fault)
 *     decision-areas-stale        the markdown's SHA-256 differs from the stamp
 *                                 (detail: the source path, plus `:source-unreadable`)
 *
 * Each is a warning for the caller to relay, never a refusal: the node composes
 * the areas from the markdown instead.
 *
 * The fixed labels (`FIXED_LABELS`) are the only words this module adds: `Why
 * it matters:`, `Depends on:`, `Pro:`, `Con:`, `Recommended:`,
 * `(Recommended)`, `More details` and its description, `Also considered — type
 * one to choose it:`, `**Pros**`, `**Cons**`, `**Why recommended**:`, `Pros:`,
 * `Cons:`, `Choose this to see the rest.`, and the ` — ` and ` · ` separators.
 * Each area is asked and recorded as `convergence-decisions-<area id>`.
 *
 * Pure apart from the reads in `loadAreas`: no stdio, no writes, and warnings
 * are returned, never printed. `node:` builtins and engine libs only, Node >= 20.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DETAILS_CUT, MORE_DETAILS_ID, PREVIEW_BUDGET, RECOMMENDED_MARK, clip, unmarked } from './checkpoint.mjs';
import { clipHeader } from './question-set.mjs';

/** The id every area's answer is recorded under, before the area's own id. */
export const QUESTION_PREFIX = 'convergence-decisions-';

/** Why a file was refused: the reason before ` at <path>`. A closed set. */
export const FAULT = {
  notJson: 'not-json',
  wrongType: 'wrong-type',
  version: 'version',
  missingKey: 'missing-key',
  unknownKey: 'unknown-key',
  empty: 'empty',
  notOneLine: 'not-one-line',
  badId: 'bad-id',
  duplicate: 'duplicate',
  tooFew: 'too-few',
  reservedId: 'reserved-id',
  unknownAlternative: 'unknown-alternative',
  unknownArea: 'unknown-area',
  dependsOrder: 'depends-order',
  badPath: 'bad-path',
  badDigest: 'bad-digest',
};

/** The warning codes `loadAreas` returns. */
export const WARNING = {
  missing: 'decision-areas-missing',
  unreadable: 'decision-areas-unreadable',
  invalid: 'decision-areas-invalid',
  stale: 'decision-areas-stale',
};

const WHY_LABEL = 'Why it matters:';
const DEPENDS_LABEL = 'Depends on:';
const PRO_LABEL = 'Pro:';
const CON_LABEL = 'Con:';
const RECOMMENDED_LABEL = 'Recommended:';
const DASH = ' — ';
const DOT = ' · ';
const MORE_DETAILS_LABEL = 'More details';
const MORE_DETAILS_DESCRIPTION = 'Shows every alternative in full, then asks this again. Nothing is recorded.';
const ALSO_CONSIDERED = 'Also considered — type one to choose it:';
const PREVIEW_PROS = '**Pros**';
const PREVIEW_CONS = '**Cons**';
const WHY_RECOMMENDED = '**Why recommended**:';
const PROS_LABEL = 'Pros:';
const CONS_LABEL = 'Cons:';

/**
 * Every fixed label and separator the renderers add, as the shape reference
 * writes them. A test holds this list against the reference, so a label added
 * here and not documented there fails.
 */
export const FIXED_LABELS = [
  WHY_LABEL, DEPENDS_LABEL, PRO_LABEL, CON_LABEL, RECOMMENDED_LABEL, RECOMMENDED_MARK.trim(),
  MORE_DETAILS_LABEL, MORE_DETAILS_DESCRIPTION, ALSO_CONSIDERED, PREVIEW_PROS, PREVIEW_CONS,
  WHY_RECOMMENDED, PROS_LABEL, CONS_LABEL, DETAILS_CUT, DASH, DOT,
];

/** The most alternatives the `rich` profile offers; the rest are named in the question. */
const RICH_CAP = 3;

const SLUG = /^[a-z][a-z0-9-]*$/;
const DIGEST = /^[0-9a-f]{64}$/;
const RESERVED = new Set(['other', MORE_DETAILS_ID]);
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

const ROOT_KEYS = { required: ['version', 'source', 'areas'], optional: [] };
const SOURCE_KEYS = { required: ['path', 'sha256'], optional: [] };
const AREA_KEYS = { required: ['id', 'area', 'question', 'why', 'recommendation', 'alternatives'], optional: ['depends_on'] };
const ALTERNATIVE_KEYS = { required: ['id', 'title', 'description', 'pros', 'cons', 'key_pro', 'key_con'], optional: [] };
const RECOMMENDATION_KEYS = { required: ['alternative', 'reason'], optional: [] };

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

/**
 * Read the decision areas at `file` (absolute) for the run in `taskDir`: one
 * read, the shape check, then the hash of `source.path`'s bytes against the
 * stamp. Returns `{areas}` for a fresh, valid file, else `{warning}` — never
 * both, so no area is ever taken from a file that failed.
 */
export function loadAreas({ file, taskDir }) {
  const where = relativeTo(taskDir, file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (ABSENT.has(error?.code)) return { warning: `${WARNING.missing}:${where}` };
    return { warning: `${WARNING.unreadable}:${where}:${error?.code ?? 'error'}` };
  }
  const judged = judgeAreas(text);
  if (judged.fault) return { warning: `${WARNING.invalid}:${where}:${judged.fault}` };
  const { source, areas } = judged.doc;
  let bytes;
  try {
    bytes = fs.readFileSync(path.join(taskDir, ...source.path.split('/')));
  } catch {
    return { warning: `${WARNING.stale}:${where}:${source.path}:source-unreadable` };
  }
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
    return { warning: `${WARNING.stale}:${where}:${source.path}` };
  }
  return { areas };
}

/** `file` as the run names it: relative to the task directory, `/`-separated. */
function relativeTo(taskDir, file) {
  return path.relative(taskDir, file).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// judging a file
// ---------------------------------------------------------------------------

/** A fault raised while judging; caught by `judgeAreas`, never escapes the module. */
class Fault extends Error {
  constructor(reason, where) {
    super(`${reason} at ${where || '(root)'}`);
  }
}

/**
 * Judge the file's text whole. Returns `{doc}` when it holds the version 1
 * shape, else `{fault}`: the first fault, `<reason> at <dotted.path>`.
 */
export function judgeAreas(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { fault: new Fault(FAULT.notJson, '').message };
  }
  try {
    checkDocument(doc);
    crossCheck(doc);
    return { doc };
  } catch (error) {
    if (error instanceof Fault) return { fault: error.message };
    throw error;
  }
}

function checkDocument(doc) {
  map(doc, '');
  // The version first: a later shape is refused as a version, never judged by these keys.
  if (!has(doc, 'version')) throw new Fault(FAULT.missingKey, 'version');
  if (doc.version !== 1) throw new Fault(FAULT.version, 'version');
  keys(doc, ROOT_KEYS, '');
  map(doc.source, 'source');
  keys(doc.source, SOURCE_KEYS, 'source');
  text(doc.source.path, 'source.path');
  if (!relativePath(doc.source.path)) throw new Fault(FAULT.badPath, 'source.path');
  string(doc.source.sha256, 'source.sha256');
  if (!DIGEST.test(doc.source.sha256)) throw new Fault(FAULT.badDigest, 'source.sha256');
  list(doc.areas, 'areas');
  if (!doc.areas.length) throw new Fault(FAULT.empty, 'areas');
  const ids = new Set();
  doc.areas.forEach((area, index) => checkArea(area, `areas.${index}`, ids));
}

function checkArea(area, at, ids) {
  map(area, at);
  keys(area, AREA_KEYS, at);
  slug(area.id, `${at}.id`);
  if (ids.has(area.id)) throw new Fault(FAULT.duplicate, `${at}.id`);
  ids.add(area.id);
  line(area.area, `${at}.area`);
  line(area.question, `${at}.question`);
  text(area.why, `${at}.why`);
  if (has(area, 'depends_on')) {
    list(area.depends_on, `${at}.depends_on`);
    const named = new Set();
    area.depends_on.forEach((id, index) => {
      const where = `${at}.depends_on.${index}`;
      string(id, where);
      if (named.has(id)) throw new Fault(FAULT.duplicate, where);
      named.add(id);
    });
  }
  list(area.alternatives, `${at}.alternatives`);
  if (area.alternatives.length < 2) throw new Fault(FAULT.tooFew, `${at}.alternatives`);
  const alternatives = new Set();
  area.alternatives.forEach((alternative, index) => checkAlternative(alternative, `${at}.alternatives.${index}`, alternatives));
  const recommendation = area.recommendation;
  if (recommendation === null) return;
  map(recommendation, `${at}.recommendation`);
  keys(recommendation, RECOMMENDATION_KEYS, `${at}.recommendation`);
  string(recommendation.alternative, `${at}.recommendation.alternative`);
  if (!alternatives.has(recommendation.alternative)) throw new Fault(FAULT.unknownAlternative, `${at}.recommendation.alternative`);
  line(recommendation.reason, `${at}.recommendation.reason`);
}

function checkAlternative(alternative, at, ids) {
  map(alternative, at);
  keys(alternative, ALTERNATIVE_KEYS, at);
  slug(alternative.id, `${at}.id`);
  if (RESERVED.has(alternative.id)) throw new Fault(FAULT.reservedId, `${at}.id`);
  if (ids.has(alternative.id)) throw new Fault(FAULT.duplicate, `${at}.id`);
  ids.add(alternative.id);
  line(alternative.title, `${at}.title`);
  text(alternative.description, `${at}.description`);
  for (const key of ['pros', 'cons']) {
    list(alternative[key], `${at}.${key}`);
    if (!alternative[key].length) throw new Fault(FAULT.empty, `${at}.${key}`);
    alternative[key].forEach((item, index) => text(item, `${at}.${key}.${index}`));
  }
  line(alternative.key_pro, `${at}.key_pro`);
  line(alternative.key_con, `${at}.key_con`);
}

/** What only the whole file can tell: every `depends_on` names an area listed earlier. */
function crossCheck(doc) {
  const position = new Map(doc.areas.map((area, index) => [area.id, index]));
  doc.areas.forEach((area, index) => {
    (area.depends_on ?? []).forEach((id, at) => {
      const where = `areas.${index}.depends_on.${at}`;
      if (!position.has(id)) throw new Fault(FAULT.unknownArea, where);
      if (position.get(id) >= index) throw new Fault(FAULT.dependsOrder, where);
    });
  });
}

/** A task-relative, `/`-separated path: not absolute, no `..`, no backslash, no empty segment. */
function relativePath(value) {
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every(segment => segment !== '' && segment !== '..');
}

function join(at, key) {
  return at ? `${at}.${key}` : key;
}

function keys(value, { required, optional }, at) {
  for (const key of required) {
    if (!has(value, key)) throw new Fault(FAULT.missingKey, join(at, key));
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw new Fault(FAULT.unknownKey, join(at, key));
  }
}

function has(value, key) {
  return Object.hasOwn(value, key);
}

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function map(value, at) {
  if (!isMap(value)) throw new Fault(FAULT.wrongType, at);
}

function list(value, at) {
  if (!Array.isArray(value)) throw new Fault(FAULT.wrongType, at);
}

function string(value, at) {
  if (typeof value !== 'string') throw new Fault(FAULT.wrongType, at);
}

function text(value, at) {
  string(value, at);
  if (value.trim() === '') throw new Fault(FAULT.empty, at);
}

function line(value, at) {
  text(value, at);
  if (/[\r\n]/.test(value)) throw new Fault(FAULT.notOneLine, at);
}

function slug(value, at) {
  text(value, at);
  if (!SLUG.test(value)) throw new Fault(FAULT.badId, at);
}

// ---------------------------------------------------------------------------
// the renderers
// ---------------------------------------------------------------------------

/** The alternative the area recommends, or null when it is left open. */
function recommendedOf(area) {
  if (area.recommendation === null) return null;
  return area.alternatives.find(alternative => alternative.id === area.recommendation.alternative) ?? null;
}

/** The alternatives in picker order: the recommended first, then the rest in rank order. */
function ordered(area) {
  const recommended = recommendedOf(area);
  if (!recommended) return [...area.alternatives];
  return [recommended, ...area.alternatives.filter(alternative => alternative !== recommended)];
}

/** `text` closed with a stop unless it already ends a sentence. */
function closed(text) {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** The `Depends on:` line, or null when the area depends on none. */
function dependsLine(area, areas) {
  const ids = area.depends_on ?? [];
  if (!ids.length) return null;
  const names = ids.map(id => areas.find(each => each.id === id)?.area ?? id);
  return `${DEPENDS_LABEL} ${closed(names.join(', '))}`;
}

/** An alternative's short line: `Pro: <key_pro> · Con: <key_con>`. */
function proCon(alternative) {
  return `${PRO_LABEL} ${alternative.key_pro}${DOT}${CON_LABEL} ${alternative.key_con}`;
}

/** The question every form opens with: the ask, why it matters, what it depends on, each alternative. */
function questionLines(area, areas) {
  const lines = [`${area.area}: ${area.question}`, `${WHY_LABEL} ${area.why}`];
  const depends = dependsLine(area, areas);
  if (depends) lines.push(depends);
  for (const alternative of area.alternatives) lines.push(`${alternative.title}${DASH}${proCon(alternative)}`);
  return lines;
}

/** An alternative's `rich` preview: title, description, pros, cons and, when recommended, why. */
function preview(alternative, reason) {
  const blocks = [
    `**${alternative.title}**`,
    alternative.description,
    [PREVIEW_PROS, ...alternative.pros.map(item => `- ${item}`)].join('\n'),
    [PREVIEW_CONS, ...alternative.cons.map(item => `- ${item}`)].join('\n'),
  ];
  if (reason !== null) blocks.push(`${WHY_RECOMMENDED} ${reason}`);
  return clip(blocks.join('\n\n'), PREVIEW_BUDGET);
}

/** The write-up cut to the preview budget, the cut saying how to see the rest — as a gate's is. */
function detailsPreview(details) {
  if (details.length <= PREVIEW_BUDGET) return details;
  const room = PREVIEW_BUDGET - DETAILS_CUT.length - 3;
  return `${clip(details, room)}\n\n${DETAILS_CUT}`;
}

/**
 * The picker an area is asked with in the terminal, for the `rich` profile (a
 * picker showing previews) or the plain one (labels only). Same field shape as
 * `gate-brief --json`: `{ok, picker, question, header, options, details,
 * more_details, question_id, errors, warnings}`. `more_details` is the
 * write-up, unclipped and with its markdown, in both profiles.
 */
export function areaPicker(area, areas, profile = 'rich') {
  const recommended = recommendedOf(area);
  const more_details = areaDetails(area, areas);
  const lines = questionLines(area, areas);
  const all = ordered(area);
  const isRecommended = alternative => alternative === recommended;
  let question;
  let header;
  let options;
  if (profile === 'plain') {
    if (recommended) lines.push(`${RECOMMENDED_LABEL} ${recommended.title}${DASH}${closed(area.recommendation.reason)}`);
    question = unmarked(lines.join('\n'));
    header = unmarked(area.area);
    options = all.map(alternative => ({
      id: alternative.id,
      label: unmarked(`${alternative.title}${isRecommended(alternative) ? RECOMMENDED_MARK : ''}`),
      recommended: isRecommended(alternative),
    }));
    options.push({ id: MORE_DETAILS_ID, label: MORE_DETAILS_LABEL, recommended: false, details: true });
  } else {
    const shown = all.slice(0, RICH_CAP);
    const left = all.slice(RICH_CAP);
    if (left.length) lines.push(`${ALSO_CONSIDERED} ${closed(left.map(alternative => alternative.title).join(', '))}`);
    question = lines.join('\n');
    header = clipHeader(area.area);
    options = shown.map(alternative => {
      const reason = isRecommended(alternative) ? area.recommendation.reason : null;
      return {
        id: alternative.id,
        label: `${alternative.title}${reason !== null ? RECOMMENDED_MARK : ''}`,
        description: reason ?? proCon(alternative),
        recommended: reason !== null,
        preview: preview(alternative, reason),
      };
    });
    options.push({
      id: MORE_DETAILS_ID,
      label: MORE_DETAILS_LABEL,
      description: MORE_DETAILS_DESCRIPTION,
      recommended: false,
      details: true,
      preview: detailsPreview(more_details),
    });
  }
  return {
    ok: true,
    picker: profile === 'plain' ? 'plain' : 'rich',
    question,
    header,
    options,
    details: 'option',
    more_details,
    question_id: `${QUESTION_PREFIX}${area.id}`,
    errors: [],
    warnings: [],
  };
}

/**
 * The area's full write-up — what More details shows and what a driven
 * question carries as `details`. Markdown, blocks apart by a blank line, never
 * clipped: the area, its question, why and dependencies; each alternative in
 * rank order with its description, pros and cons; then the recommendation.
 */
export function areaDetails(area, areas) {
  const recommended = recommendedOf(area);
  const head = [`**${area.area}**`, area.question, `${WHY_LABEL} ${area.why}`];
  const depends = dependsLine(area, areas);
  if (depends) head.push(depends);
  const blocks = [head.join('\n')];
  for (const alternative of area.alternatives) {
    blocks.push([
      `**${alternative.title}**${alternative === recommended ? RECOMMENDED_MARK : ''}\n${alternative.description}`,
      [PROS_LABEL, ...alternative.pros.map(item => `- ${item}`)].join('\n'),
      [CONS_LABEL, ...alternative.cons.map(item => `- ${item}`)].join('\n'),
    ].join('\n\n'));
  }
  if (recommended) blocks.push(`${RECOMMENDED_LABEL} ${recommended.title}${DASH}${area.recommendation.reason}`);
  return blocks.join('\n\n');
}

/**
 * The area as one entry of a driven question set: every alternative (no cap,
 * no More details), the recommended first and marked, with the descriptions
 * the `rich` profile shows. No `default` — the set check fills it from the
 * recommendation — and no `triage`, which the verb adds from the policy.
 */
export function areaEntry(area, areas) {
  const recommended = recommendedOf(area);
  const depends = dependsLine(area, areas);
  return {
    id: `${QUESTION_PREFIX}${area.id}`,
    header: clipHeader(area.area),
    question: `${area.area}: ${area.question}`,
    why: depends ? `${area.why} ${depends}` : area.why,
    options: ordered(area).map(alternative => (alternative === recommended
      ? { id: alternative.id, label: alternative.title, description: area.recommendation.reason, recommended: true }
      : { id: alternative.id, label: alternative.title, description: proCon(alternative) })),
    details: areaDetails(area, areas),
  };
}
