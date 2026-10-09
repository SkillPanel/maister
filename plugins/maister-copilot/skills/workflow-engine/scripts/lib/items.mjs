/**
 * The items a node summary records — decisions, risks, artifacts — read in one
 * typed shape, whatever shape a run wrote them in.
 *
 * Why this module exists. A summary's lists began as free strings, with meaning
 * carried by a prefix (`open:`, `recommend stop:`, `defaulted:`), and every
 * reader parsed the prefixes its own way: the gate brief, the dashboard and the
 * prior-phase context each kept a private reading, and a map item was joined
 * field by field, so who decided and whether it was the recommended answer read
 * as part of the decision's text. The record now carries the type itself —
 * `{decision, by}` and `{risk, tag, change}` — and the strings stay valid, so
 * every reader asks this module rather than keeping its own reading.
 *
 * The legacy reading. Any state written since the compatibility floor reads:
 *
 * | Stored                                         | Read as                                        |
 * |------------------------------------------------|------------------------------------------------|
 * | a decision string                              | `{decision, by: run}`                          |
 * | `defaulted: <id> -> <taken>`                   | `{decision: <taken>, by: default, question_id}`|
 * | `asked: <q> -> <a> (answered by <who> at <t>)` | `{decision: <a>, by: operator, question, …}`   |
 * | `{decision, rationale}` with no `by`           | `by: run`                                      |
 * | `{question, answer}`                           | `{decision: <answer>, by: operator}`           |
 * | `{option, answered_by, at, …}` (a gate answer) | `{decision: <label>, by: operator, …}`         |
 * | a risk string with no tag                      | `{risk, tag: open}`, the arrow split off       |
 * | `open:` `tradeoff:` `followup:` prefixes       | that tag                                       |
 * | `left for later:`                              | `followup`                                     |
 * | `recommend stop:`                              | `stop`                                         |
 * | `resolved:` or `(resolved …)`                  | `resolved`                                     |
 * | a bare-string artifact                         | `{path, label: null, html: null, role: null}`  |
 * | a fix string                                   | `{finding: null, change: <text>}`              |
 *
 * A fix — something a node changed without asking, recorded in its summary's
 * `fixes_applied` as `{finding, change}` — is neither a decision nor a risk:
 * the run settled nothing, it repaired what was found.
 *
 * Nothing here rewrites what is stored: a reader normalises on the way in, and
 * the writer keeps every item as it was sent.
 *
 * Pure: no imports beyond the display helper, no I/O.
 */

import { sentence } from './display.mjs';

/** Who settled a decision: a person, the run's own analysis, an audit, or a default taken for nobody. */
export const DECISION_BY = ['operator', 'run', 'audit', 'default'];

/** What a risk is: still open, a trade-off accepted, a follow-up for later, a reason to stop, or settled. */
export const RISK_TAGS = ['open', 'tradeoff', 'followup', 'stop', 'resolved'];

/** What an artifact is for: the document a phase produced, one to review beside it, evidence, or a log. */
export const ARTIFACT_ROLES = ['primary', 'review', 'evidence', 'log'];

/** How long a `headline` may run: one sentence a reader takes in at a glance. */
export const HEADLINE_MAX = 220;

/** Between a risk and the change that would resolve it: `<risk> → <what would change>`. */
const CHANGE_ARROW = /\s+(?:→|->)\s+/;

/** A risk's leading tag, in every spelling a run has written one. */
const RISK_PREFIX = /^(open|trade-?off|follow-?up|left for later|recommend stop|resolved)\s*:\s*/i;

/** Each prefix spelling, lower-cased and dashes dropped, to the tag it reads as. */
const PREFIX_TAG = {
  open: 'open',
  tradeoff: 'tradeoff',
  followup: 'followup',
  'left for later': 'followup',
  'recommend stop': 'stop',
  resolved: 'resolved',
};

/** The dashboard's older marking of a settled risk: `(resolved in round 2)` anywhere in the text. */
const RESOLVED_NOTE = /\(resolved\b/i;

/**
 * A slug key leading an item — `goods-currency-contract: …` — which names the
 * entry for a machine and says nothing to a reader. At least one dash or
 * underscore, so a prefix that carries meaning (`open:`, `Architecture:`) is
 * never taken for one.
 */
const SLUG_KEY = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+:\s+/;

/** A defaulted in-node question, as the defaults rule wrote it before decisions were typed. */
const DEFAULTED = /^defaulted:\s*(\S+)\s*->\s*(.+)$/is;

/** An in-node question a driver asked, as the question spike wrote it. */
const ASKED = /^asked:\s*(.+?)\s*->\s*(.+?)(?:\s*\(answered by\s+(.+?)\s+at\s+(\S+?)\))?\s*$/is;

/**
 * The end of a sentence: its stop, any closing quote or bracket after it, and
 * then a space or the end — so `… "Nothing yet." Then …` ends inside the quote.
 */
const SENTENCE_END = /[.!?]["'’”)\]]*(?=\s|$)/g;

/** An abbreviation whose full stop ends no sentence, read off the text before it. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf)$/i;

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A string on one line, trimmed; anything else is ''. */
export function oneLine(value) {
  if (typeof value === 'string') return value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * One decision item as `{decision, by, …}`, or null when it holds no decision
 * text. Every field the item carried is kept beside the two; `labelFor(option)`
 * names a gate answer's option, and without it the option reads as a sentence.
 * A `by` this build does not know reads as `run`, the conservative default: the
 * item is still shown, credited to the analysis.
 */
export function decisionOf(item, labelFor = null) {
  if (typeof item === 'string') {
    const text = oneLine(item);
    if (text === '') return null;
    const defaulted = DEFAULTED.exec(text);
    if (defaulted) return { decision: defaulted[2].trim(), by: 'default', question_id: defaulted[1] };
    const asked = ASKED.exec(text);
    if (asked) {
      return {
        decision: asked[2].trim(),
        by: 'operator',
        question: asked[1].trim(),
        answer: asked[2].trim(),
        ...(asked[3] ? { answered_by: asked[3] } : {}),
        ...(asked[4] ? { at: asked[4] } : {}),
      };
    }
    return { decision: text.replace(SLUG_KEY, ''), by: 'run' };
  }
  if (!isMap(item)) return null;
  const known = by => (DECISION_BY.includes(by) ? by : null);
  const text = oneLine(item.decision);
  if (text !== '') {
    const by = known(item.by) ?? (typeof item.option === 'string' ? 'operator' : 'run');
    return { ...item, decision: text, by };
  }
  if (typeof item.option === 'string' && item.option !== '') {
    const label = typeof labelFor === 'function' ? labelFor(item.option) : null;
    return { ...item, decision: label || sentence(item.option), by: known(item.by) ?? 'operator' };
  }
  const answer = oneLine(item.answer);
  if (answer !== '' && Object.hasOwn(item, 'question')) {
    return {
      ...item,
      decision: answer,
      by: known(item.by) ?? 'operator',
      as_recommended: typeof item.as_recommended === 'boolean' ? item.as_recommended : null,
    };
  }
  return null;
}

/**
 * The keys an answer's provenance is carried in, copied from an answer onto
 * the decision it becomes: who acted (`actor`), for whom (`on_behalf_of`),
 * under which rule (`policy`), on what (`evidence`) and which recommendation
 * it set aside (`override_of`). `grants` is never among them: what an answer
 * authorises belongs to the option, and is never copied onto a decision.
 */
export const PROVENANCE_KEYS = ['actor', 'on_behalf_of', 'policy', 'evidence', 'override_of'];

/**
 * The provenance keys `source` carries, as a map of just those keys. A key
 * holding null or nothing counts as absent; anything not a map carries none.
 */
export function provenanceOf(source) {
  if (!isMap(source)) return {};
  return Object.fromEntries(PROVENANCE_KEYS.filter(key => hasValue(source, key)).map(key => [key, source[key]]));
}

/**
 * `item` with each provenance key `source` carries and `item` lacks. A key
 * holding null or nothing counts as absent on either side.
 */
export function withProvenance(item, source) {
  if (!isMap(item)) return item;
  const missing = Object.entries(provenanceOf(source)).filter(([key]) => !hasValue(item, key));
  return missing.length ? { ...item, ...Object.fromEntries(missing) } : item;
}

/** What a model has written in place of the person's name. */
const PLACEHOLDER_NAMES = new Set(['', 'user', 'operator', 'you']);

/**
 * Does `name` name nobody: not a string, or — trimmed, in any case — empty or
 * one of the placeholders a model writes for the person (`user`, `operator`,
 * `you`)?
 */
export function isPlaceholderName(name) {
  return typeof name !== 'string' || PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}

/**
 * An operator answer given at this terminal credited to the person who gave
 * it: `actor: {kind: person, id: <answered_by>}` added when its `via` is
 * `terminal` and it carries no `actor`. An answer with no `via`, or one a
 * driver carried, is left as it is: the engine knows who sat at the terminal,
 * and nothing about who acted elsewhere.
 */
export function withPersonActor(item) {
  if (!isMap(item) || item.via !== 'terminal' || hasValue(item, 'actor')) return item;
  const id = typeof item.answered_by === 'string' ? item.answered_by.trim() : '';
  return id === '' ? item : { ...item, actor: { kind: 'person', id } };
}

function hasValue(map, key) {
  return Object.hasOwn(map, key) && map[key] !== null && map[key] !== undefined;
}

/**
 * A gate's answer among its decisions: the last item carrying a string
 * `option`, or null when none does. A gate's decisions may hold more than its
 * answer — a note the run recorded after it, an earlier attempt's revise — so
 * the last item is not the answer, and every reader of a gate's answer asks
 * here rather than taking the tail of the list.
 */
export function gateAnswer(decisions) {
  if (!Array.isArray(decisions)) return null;
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const item = decisions[index];
    if (isMap(item) && typeof item.option === 'string') return item;
  }
  return null;
}

/**
 * Whether a decision is an earlier attempt's answer to a question the node
 * asked again: it carries its own `attempt`, and `list` — the node's decisions
 * — holds an answer to the same `question_id` from a later one. Such an answer
 * is history, kept beside the current one and never counted as a choice. Read
 * off the list alone, so an answer a later attempt did not ask again stays
 * current.
 */
export function isEarlierAnswer(item, list) {
  const own = attemptNumber(item);
  if (own === null || typeof item.question_id !== 'string' || item.question_id === '') return false;
  return list.some(other => other !== item && isMap(other) && other.question_id === item.question_id
    && (attemptNumber(other) ?? 0) > own);
}

/** A decision's own `attempt` as a positive whole number — the reader hands it back as text — or null. */
export function attemptNumber(item) {
  if (!isMap(item) || !Object.hasOwn(item, 'attempt')) return null;
  const value = Number(item.attempt);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * One risk item as `{risk, tag, change}`, or null when it holds no text. A
 * string's leading tag says what it is, and one with no tag reads `open`: that
 * may feed a revise suggestion, but it is never hidden. The part after the
 * arrow is the change that would resolve it.
 */
export function riskOf(item) {
  if (typeof item === 'string') {
    let text = oneLine(item);
    if (text === '') return null;
    let tag = 'open';
    const prefix = RISK_PREFIX.exec(text);
    if (prefix) {
      tag = PREFIX_TAG[prefix[1].toLowerCase().replace('-', '')];
      text = text.slice(prefix[0].length).trim();
    } else if (SLUG_KEY.test(text)) {
      text = text.replace(SLUG_KEY, '');
    } else if (RESOLVED_NOTE.test(text)) {
      tag = 'resolved';
    }
    const [risk, ...rest] = text.split(CHANGE_ARROW);
    const change = rest.join(' ').trim();
    return { risk: risk.trim(), tag, change: change === '' ? null : change };
  }
  if (!isMap(item)) return null;
  const risk = oneLine(item.risk);
  if (risk === '') return null;
  const change = oneLine(item.change);
  return { risk, tag: RISK_TAGS.includes(item.tag) ? item.tag : 'open', change: change === '' ? null : change };
}

/**
 * One fix a node applied without asking as `{finding, change}` — what was
 * wrong and what changed — or null when it names neither. A string is the
 * change alone, as a fix loop's own log wrote it.
 */
export function fixOf(item) {
  if (typeof item === 'string') {
    const change = oneLine(item);
    return change === '' ? null : { finding: null, change };
  }
  if (!isMap(item)) return null;
  const finding = oneLine(item.finding);
  const change = oneLine(item.change);
  if (finding === '' && change === '') return null;
  return { finding: finding === '' ? null : finding, change: change === '' ? null : change };
}

/**
 * One artifact entry as `{path, label, html, role}` beside whatever else it
 * carries, or null when it names no file. A bare string in this field is a path
 * — the only thing it has ever meant — and the optional fields take null rather
 * than a guess derived from the path.
 */
export function artifactOf(entry) {
  if (isMap(entry)) return entry;
  if (typeof entry !== 'string') return null;
  return { path: entry, label: null, html: null, role: null };
}

/** A decision as a reader shows it: its text, and its rationale after a dash. */
export function decisionText(decision) {
  const rationale = oneLine(decision.rationale);
  return rationale ? `${decision.decision} — ${rationale}` : decision.decision;
}

/** A risk as a reader shows it: its text, and the change after the arrow. */
export function riskText(risk) {
  return risk.change ? `${risk.risk} → ${risk.change}` : risk.risk;
}

/** A fix as a reader shows it: what was wrong, and what changed after the arrow. */
export function fixText(fix) {
  if (fix.finding && fix.change) return `${fix.finding.replace(/\.$/, '')} → ${fix.change}`;
  return fix.finding ?? fix.change ?? '';
}

/**
 * A summary entry's one *Done* sentence: its `headline`, else the first
 * sentence of its `summary`, cut at a word to `HEADLINE_MAX`. '' when it has
 * neither.
 */
export function headlineOf(entry) {
  if (!isMap(entry)) return '';
  const own = oneLine(entry.headline);
  if (own !== '') return own;
  return clipWords(firstSentence(oneLine(entry.summary)), HEADLINE_MAX);
}

/**
 * `text` up to the end of its first sentence. A dash ends no sentence, so
 * `recommend stop: critical — <reason>` keeps the reason; nor does the stop of
 * an abbreviation.
 */
export function firstSentence(text) {
  for (const match of text.matchAll(SENTENCE_END)) {
    if (ABBREVIATION.test(text.slice(0, match.index))) continue;
    return text.slice(0, match.index + match[0].length).trimEnd();
  }
  return text;
}

/** `text` cut at a word to at most `max` characters, an ellipsis marking the cut. */
export function clipWords(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}
