/**
 * A question set: every question a node asks inside itself, carried to the
 * operator as one `kind: question` request and folded back as one decision per
 * question.
 *
 * Why this module exists. A question asked inside a node used to reach nobody
 * under a driver: the node took the default its prose names, because a request
 * was gate-shaped and no request kind carried a question. A driver that lists
 * `question-sets` (`driver.mjs`) can now carry them, and two verbs meet the set
 * from opposite ends — `gate-brief` builds the request from the node's set, and
 * the state writer folds the answer file back into the node's decisions. Both
 * read the set the same way, so the rules live here once: what a valid set is,
 * what the checkpoint holds, and what an answer means.
 *
 * One request per node attempt. A node asks everything it has at once, so a set
 * is never capped here: the four-question limit belongs to the terminal picker,
 * which splits a long set across several calls in one turn, and never to the
 * request.
 *
 * Pure: no I/O. Zero dependencies beyond the checkpoint, display and item helpers.
 */

import { flowLine } from './checkpoint.mjs';
import { HEADER_MAX } from './display.mjs';
import { PROVENANCE_KEYS, oneLine } from './items.mjs';

/** The keys a question may carry; any other is a typo the operator would never see answered. */
const QUESTION_KEYS = ['id', 'header', 'question', 'why', 'multi_select', 'allow_other', 'options', 'default', 'triage'];

/** The keys an option may carry. */
const OPTION_KEYS = ['id', 'label', 'description', 'recommended'];

/** The keys the set itself may carry, beside its questions. */
const SET_KEYS = ['ask', 'headline', 'questions'];

/**
 * The option id an answer in the operator's own words is recorded under: a
 * first question answered `{other}` sends it as the request's `option`. An
 * option of that id could not be told apart from such an answer.
 */
const OTHER_ID = 'other';

/** The fewest options a question offers: one option is no choice. */
const OPTIONS_MIN = 2;

/** Between the labels of a multi-select answer, as a decision reads it. */
const LABEL_JOIN = ', ';

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim() !== '';
const isLine = value => isText(value) && !/[\r\n]/.test(value);

/**
 * Check a question set as a node wrote it, and fill what it left out. Returns
 * `{ok: true, set}` with every question normalised — `multi_select` false and
 * `allow_other` true unless said, `header` from the id, `default` the
 * recommended option (or options) — or `{ok: false, errors}`, each error naming
 * the question and the field.
 */
export function checkSet(input) {
  const errors = [];
  if (!isMap(input)) return { ok: false, errors: ['the question set must be a JSON object with a "questions" list'] };
  for (const key of Object.keys(input)) {
    if (!SET_KEYS.includes(key)) errors.push(`the key "${key}" is not one of ${SET_KEYS.join(', ')}`);
  }
  for (const key of ['ask', 'headline']) {
    if (Object.hasOwn(input, key) && !isLine(input[key])) errors.push(`"${key}" must be one line of text`);
  }
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    errors.push('"questions" must be a non-empty list: a node with nothing to ask writes no set');
    return { ok: false, errors };
  }
  const ids = new Set();
  const questions = input.questions.map((question, index) => {
    const where = isMap(question) && isText(question.id) ? `question "${question.id}"` : `questions[${index}]`;
    if (!isMap(question)) {
      errors.push(`${where} must be an object`);
      return null;
    }
    for (const key of Object.keys(question)) {
      if (!QUESTION_KEYS.includes(key)) errors.push(`${where}: the key "${key}" is not one of ${QUESTION_KEYS.join(', ')}`);
    }
    if (!isLine(question.id)) errors.push(`${where}: "id" must be a one-line id`);
    else if (ids.has(question.id)) errors.push(`${where}: the id is used twice; each question needs its own`);
    else ids.add(question.id);
    if (!isText(question.question)) errors.push(`${where}: "question" must be the question's text`);
    for (const key of ['header', 'why']) {
      if (Object.hasOwn(question, key) && !isText(question[key])) errors.push(`${where}: "${key}" must be text`);
    }
    for (const key of ['multi_select', 'allow_other']) {
      if (Object.hasOwn(question, key) && typeof question[key] !== 'boolean') errors.push(`${where}: "${key}" must be true or false`);
    }
    const multi = question.multi_select === true;
    const options = checkOptions(question.options, where, errors);
    const recommended = options.filter(option => option.recommended).map(option => option.id);
    if (!multi && recommended.length > 1) {
      errors.push(`${where}: ${recommended.length} options are recommended in a single choice; recommend one at most`);
    }
    let fallback;
    if (Object.hasOwn(question, 'default')) {
      fallback = question.default;
      const named = Array.isArray(fallback) ? fallback : [fallback];
      const known = new Set(options.map(option => option.id));
      if ((Array.isArray(fallback) && !multi) || !named.length || named.some(id => !known.has(id))) {
        errors.push(`${where}: "default" must name ${multi ? 'options' : 'one option'} of this question by id`);
      }
    } else if (recommended.length) {
      fallback = multi ? recommended : recommended[0];
    }
    const header = isText(question.header) ? question.header : clipHeader(sentenceOf(String(question.id ?? '')));
    return {
      id: question.id,
      header,
      question: question.question,
      ...(isText(question.why) ? { why: question.why } : {}),
      multi_select: multi,
      allow_other: question.allow_other !== false,
      options,
      ...(fallback !== undefined ? { default: fallback } : {}),
      ...(Object.hasOwn(question, 'triage') ? { triage: question.triage } : {}),
    };
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, set: { ask: input.ask ?? null, headline: input.headline ?? null, questions } };
}

function checkOptions(options, where, errors) {
  if (!Array.isArray(options) || options.length < OPTIONS_MIN) {
    errors.push(`${where}: "options" must list at least ${OPTIONS_MIN} options`);
    return [];
  }
  const ids = new Set();
  return options.map((option, index) => {
    const at = `${where} option ${isMap(option) && isText(option.id) ? `"${option.id}"` : index + 1}`;
    if (!isMap(option)) {
      errors.push(`${at} must be an object`);
      return { id: null, label: null };
    }
    for (const key of Object.keys(option)) {
      if (!OPTION_KEYS.includes(key)) errors.push(`${at}: the key "${key}" is not one of ${OPTION_KEYS.join(', ')}`);
    }
    if (!isLine(option.id)) errors.push(`${at}: "id" must be a one-line id`);
    else if (option.id === OTHER_ID) errors.push(`${at}: the id "${OTHER_ID}" is reserved for an answer in the operator's own words; name the option otherwise`);
    else if (ids.has(option.id)) errors.push(`${at}: the id is used twice in this question`);
    else ids.add(option.id);
    if (!isLine(option.label)) errors.push(`${at}: "label" must be one line of text`);
    if (Object.hasOwn(option, 'description') && !isText(option.description)) errors.push(`${at}: "description" must be text`);
    if (Object.hasOwn(option, 'recommended') && typeof option.recommended !== 'boolean') errors.push(`${at}: "recommended" must be true or false`);
    return {
      id: option.id,
      label: option.label,
      ...(isText(option.description) ? { description: option.description } : {}),
      ...(option.recommended === true ? { recommended: true } : {}),
    };
  });
}

/** An id as a header in plain sentence case: `tag-case` reads "Tag case". */
function sentenceOf(id) {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function clipHeader(text) {
  const chars = [...text];
  return chars.length <= HEADER_MAX ? text : `${chars.slice(0, HEADER_MAX - 1).join('').trimEnd()}…`;
}

/**
 * The checkpoint a question set is carried in: the same envelope a gate's has —
 * version, kind, node, header, ask, headline, progress, run — with the
 * questions in place of a gate's options. `title` names the asking node; the
 * ask and the headline are generated from it where the node gave none.
 */
export function questionCheckpoint({ set, node, title, header, progress, run }) {
  const count = set.questions.length;
  const lowered = title.charAt(0).toLowerCase() + title.slice(1);
  return {
    version: 1,
    kind: 'question',
    node,
    header,
    ask: set.ask ?? `${title}: ${count} ${count === 1 ? 'question' : 'questions'} to answer`,
    headline: set.headline ?? `Answer ${count === 1 ? 'it' : `all ${count}`} to continue ${lowered}.`,
    progress,
    questions: set.questions,
    run,
    truncated: false,
  };
}

/** A question's options as the request carries them: each one continues the run. */
function requestOptions(question) {
  return question.options.map(option => ({
    id: option.id,
    label: option.label,
    effect: 'continue',
    ...(option.description ? { description: option.description } : {}),
    ...(option.recommended ? { recommended: true } : {}),
  }));
}

/**
 * The request a driver suspends on for a question set. The top-level question
 * and options repeat the first question, so a reader that knows one question
 * per request still answers it; `questions` carries the whole set, each entry
 * the four keys a request question has; and `context.checkpoint` carries the
 * set with its context — header, why, default — for a reader that renders it.
 * Each question the request carries is one flow-safe line (`flowLine`); the
 * checkpoint keeps the node's own text.
 */
export function questionRequest(checkpoint) {
  const [first] = checkpoint.questions;
  return {
    node: checkpoint.node,
    kind: 'question',
    question: flowLine(first.question),
    context: { summary: summaryOf(checkpoint), artifacts: [], checkpoint },
    options: requestOptions(first),
    multi_select: first.multi_select,
    questions: checkpoint.questions.map(question => ({
      id: question.id,
      question: flowLine(question.question),
      options: requestOptions(question),
      multi_select: question.multi_select,
    })),
  };
}

/** The one-line summary an older reader takes: the ask, then each question and its recommendation. */
function summaryOf(checkpoint) {
  const parts = checkpoint.questions.map((question, index) => {
    const recommended = question.options.filter(option => option.recommended).map(option => option.label);
    const tail = recommended.length ? ` Recommended: ${recommended.join(LABEL_JOIN)}.` : '';
    return `${index + 1}. ${oneLine(question.question)}${tail}`;
  });
  return [oneLine(checkpoint.ask), ...parts].join(' · ');
}

/**
 * The question set a request file carries, read back for the fold: the
 * checkpoint's questions when it has them, which say `allow_other`, else the
 * request's own `questions`. Null when the request holds no set.
 */
export function requestQuestions(request) {
  if (!isMap(request) || request.kind !== 'question') return null;
  const checkpoint = isMap(request.context) && isMap(request.context.checkpoint) ? request.context.checkpoint : null;
  const questions = Array.isArray(checkpoint?.questions) ? checkpoint.questions : request.questions;
  return Array.isArray(questions) && questions.length && questions.every(isMap) ? questions : null;
}

/**
 * An answer block — `{option, answers, answered_by, at, via}`, as the answer
 * file holds it — as one operator decision per question: what was chosen in
 * the operator's words, the question it answered, what was recommended and
 * whether it was taken, with the block's provenance (`PROVENANCE_KEYS`) on each. The first question falls back to `option` when
 * `answers` does not name it. Returns `{ok: true, decisions}` or
 * `{ok: false, errors}`.
 */
export function foldAnswer(questions, answer) {
  if (!isMap(answer)) return { ok: false, errors: ['the answer must be the answer file\'s answer block, an object'] };
  const answers = isMap(answer.answers) ? answer.answers : {};
  if (Object.hasOwn(answer, 'answers') && !isMap(answer.answers)) return { ok: false, errors: ['"answers" must map each question id to its answer'] };
  const errors = [];
  const known = new Set(questions.map(question => question.id));
  for (const id of Object.keys(answers)) {
    if (!known.has(id)) errors.push(`"answers" names "${id}", which is not a question of this request`);
  }
  const who = {};
  for (const key of ['answered_by', 'at', 'via']) if (isText(answer[key])) who[key] = answer[key];
  // The answer's provenance rides on every decision it becomes; `grants` never does.
  for (const key of PROVENANCE_KEYS) if (answer[key] !== undefined && answer[key] !== null) who[key] = answer[key];
  const decisions = questions.map((question, index) => {
    const where = `question "${question.id}"`;
    let given = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
    if (given === undefined && index === 0 && isText(answer.option)) given = answer.option;
    if (given === undefined) {
      errors.push(`${where} has no answer`);
      return null;
    }
    const options = Array.isArray(question.options) ? question.options.filter(isMap) : [];
    const byId = new Map(options.map(option => [option.id, option]));
    const recommended = options.filter(option => option.recommended === true);
    const multi = question.multi_select === true;
    let text;
    let chosen = null;
    if (isMap(given)) {
      if (Object.keys(given).length !== 1 || !isText(given.other)) {
        errors.push(`${where}: an answer in the operator's own words is {"other": "<text>"}`);
        return null;
      }
      if (question.allow_other === false) {
        errors.push(`${where} does not take an answer in the operator's own words`);
        return null;
      }
      text = given.other.trim();
    } else {
      const ids = Array.isArray(given) ? given : [given];
      if (Array.isArray(given) && !multi) {
        errors.push(`${where} is a single choice and was answered with a list`);
        return null;
      }
      if (!ids.length || ids.some(id => typeof id !== 'string' || !byId.has(id)) || new Set(ids).size !== ids.length) {
        errors.push(`${where} was answered with ${JSON.stringify(given)}; its options are ${[...byId.keys()].join(', ')}`);
        return null;
      }
      chosen = ids;
      text = ids.map(id => byId.get(id).label).join(LABEL_JOIN);
    }
    const asRecommended = recommended.length === 0 ? null
      : chosen !== null && chosen.length === recommended.length && recommended.every(option => chosen.includes(option.id));
    return {
      decision: text,
      by: 'operator',
      question_id: question.id,
      question: question.question,
      answer: text,
      recommended: recommended.length ? recommended.map(option => option.label).join(LABEL_JOIN) : null,
      as_recommended: asRecommended,
      ...who,
    };
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, decisions };
}
