/**
 * The prior-phase context block, rendered from state for a delegate prompt.
 *
 * Why this module exists at all. Every artifact-writing delegate must receive
 * the prior phases' decisions and risks complete — N items in state arriving as
 * N distinct items, none dropped and none merged. That rule was stated in the
 * workflow definitions, in the prose twins and in the framework patterns, and
 * measured across four attended runs it held in one delegate prompt out of
 * three. The diagnosis the runs support is narrow: the rule holds where the
 * lift is mechanical and happens once — the state write, which a writer now
 * performs — and fails where a node *composes a prompt afresh* from an artifact
 * it has already read, under length pressure. Thirteen items become seven
 * clauses on one line, and nothing in the prompt records that they were ever
 * thirteen.
 *
 * So the composing step is removed. This module turns the run's accumulated
 * `phase_summaries` into text a node pastes, and a node that pastes cannot
 * condense. The counts are printed beside every list for the same reason: a
 * reader — operator or reviewer — can hold the output against state without
 * reading state, and a truncation shows up as a number that does not match its
 * own bullets.
 *
 * What it does not do. It does not write. It reads the state file, renders, and
 * returns; there is no patch, no temp file, no key introduced. `phase_summaries`
 * is a key A1 already freezes and the run already carries, and nothing here
 * depends on a shape that is not already in the contract.
 *
 * Generic on purpose. The per-workflow context block is *found*, not named by a
 * flag: the root carries exactly one of the five, so a workflow key would be a
 * second place to get the same fact wrong. Every workflow whose context block
 * carries `phase_summaries` — development, research, product-design, migration,
 * performance — is served by the same call with the same flag.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
// The one state reader (`state-read.mjs`): this module used to carry its own,
// which is exactly the duplication that reader exists to end.
import { parse, isPlainObject } from './state-read.mjs';

/** The five per-workflow context blocks (A1 layer 2). Exactly one is present. */
const CONTEXT_BLOCKS = ['task_context', 'research_context', 'design_context', 'performance_context', 'migration_context'];

/**
 * The two fields the R3 contract is written against. They lead every phase
 * section and they are printed even when empty, because an absent list and an
 * empty one are different facts and a delegate is owed the difference.
 */
const CONTRACT_LISTS = ['decisions', 'risks'];

/** Printed first when present: one line of orientation before the items. */
const LEAD = 'summary';

/** Carried in the section heading rather than as a field of its own. */
const HEADING_FIELDS = new Set(['node', LEAD]);

/**
 * Render the prior-phase context of the run whose state file is `state`.
 *
 * Returns `{ok, text, errors}`. `text` is printed on stdout whether or not the
 * run has recorded anything yet: a run at its first node prints the sentence
 * saying so, which is a fact a delegate needs and an empty stdout is not.
 */
export function priorContext({ state }) {
  let raw;
  try {
    raw = fs.readFileSync(state, 'utf8');
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read: ${err.message}`);
  }

  let doc;
  try {
    doc = parse(raw);
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read as a state document: ${err.message}`);
  }

  const key = CONTEXT_BLOCKS.find(name => isPlainObject(doc[name]));
  if (!key) {
    return refuse('prior-context-absent',
      `${state} carries none of the per-workflow context blocks (${CONTEXT_BLOCKS.join(', ')}), so there is no prior-phase context to render`);
  }

  const summaries = doc[key].phase_summaries;
  if (summaries !== undefined && summaries !== null && !isPlainObject(summaries)) {
    return refuse('prior-context-absent',
      `${key}.phase_summaries is not a map, so its entries cannot be rendered`);
  }

  return { ok: true, text: render(key, isPlainObject(summaries) ? summaries : {}), errors: [] };
}

function refuse(code, message) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }] };
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/**
 * The paste-ready block.
 *
 * Markdown, because that is what a delegate prompt already is, and because a
 * bullet is the one form that cannot quietly hold two items.
 */
function render(contextKey, summaries) {
  // A phase recorded as a bare sequence is a list of decisions and nothing
  // else — a shape one frozen run fixture carries. It is adopted rather than
  // skipped: an entry this module declines to read is an entry whose items
  // never reach the delegate, which is the whole defect.
  const entries = Object.entries(summaries)
    .filter(([, value]) => isPlainObject(value) || Array.isArray(value))
    .map(([key, value]) => [key, Array.isArray(value) ? { decisions: value } : value]);
  const out = [];

  let decisions = 0;
  let risks = 0;
  for (const [, entry] of entries) {
    decisions += listOf(entry.decisions).length;
    risks += listOf(entry.risks).length;
  }

  out.push('## Prior-phase context — decisions and risks carried forward');
  out.push('');
  out.push(`Pasted from \`${contextKey}.phase_summaries\` in this run's \`orchestrator-state.yml\`: `
    + `${entries.length} ${entries.length === 1 ? 'phase' : 'phases'}, ${decisions} `
    + `${decisions === 1 ? 'decision' : 'decisions'}, ${risks} ${risks === 1 ? 'risk' : 'risks'}. `
    + 'These are binding. Every item below is one item in state — do not drop one, '
    + 'do not merge two, and do not re-word them.');
  out.push('');

  if (!entries.length) {
    out.push('No phase has recorded a summary yet: this is the run\'s first artifact-writing node, '
      + 'and there is no prior decision or risk to carry forward.');
    out.push('');
    return `${out.join('\n')}\n`;
  }

  for (const [key, entry] of entries) {
    const node = scalarText(entry.node);
    out.push(`### ${key}${node ? ` — node: ${node}` : ''}`);
    out.push('');
    const lead = scalarText(entry[LEAD]);
    if (lead) {
      out.push(`Summary: ${lead}`);
      out.push('');
    }
    for (const field of CONTRACT_LISTS) out.push(...section(field, listOf(entry[field]), true));
    for (const [field, value] of Object.entries(entry)) {
      if (HEADING_FIELDS.has(field) || CONTRACT_LISTS.includes(field)) continue;
      if (Array.isArray(value)) out.push(...section(field, listOf(value), false));
      else {
        const text = scalarText(value);
        if (text) out.push(`${label(field)}: ${text}`, '');
      }
    }
  }

  return `${out.join('\n')}\n`;
}

/**
 * One labelled list. `always` keeps `decisions` and `risks` on the page when
 * they are empty — the state said "none", and a delegate that is told nothing
 * cannot tell that apart from a node that forgot.
 */
function section(field, items, always) {
  if (!items.length && !always) return [];
  if (!items.length) return [`${label(field)} (0): none recorded.`, ''];
  return [`${label(field)} (${items.length}):`, ...items.map(item => `- ${itemText(item)}`), ''];
}

function label(field) {
  const words = String(field).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * One item, on one line.
 *
 * A scalar item is its own text. A mapped item — the `{decision, rationale}`
 * pair the summary contract asks for, and the `{path, label, html}` an artifact
 * entry carries — is spelled field by field, joined by an em dash, keeping the
 * field names so that nothing is lost by a reader who cannot see the state.
 * Null-valued fields are dropped rather than printed as `null`, which is noise
 * in a prompt and never information.
 */
function itemText(item) {
  if (!isPlainObject(item)) {
    if (Array.isArray(item)) return item.map(itemText).join('; ');
    return scalarText(item) || 'null';
  }
  const parts = [];
  for (const [field, value] of Object.entries(item)) {
    if (Array.isArray(value)) {
      if (value.length) parts.push(`${field}: ${value.map(itemText).join('; ')}`);
      continue;
    }
    const text = isPlainObject(value) ? itemText(value) : scalarText(value);
    if (text) parts.push(`${field}: ${text}`);
  }
  return parts.length ? parts.join(' — ') : 'null';
}

/**
 * A scalar as prompt text. Newlines are folded to spaces: an item is one line,
 * and an embedded newline would turn one item into two on the page — the exact
 * miscount the counts beside each list exist to make visible.
 */
function scalarText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string') return '';
  return value.replace(/\s*\n\s*/g, ' ').trim();
}
