/**
 * The prior-phase context block, rendered from state for a delegate prompt.
 *
 * Why this module exists at all. Every artifact-writing delegate must receive
 * the prior phases' decisions and risks complete — N items in state arriving as
 * N distinct items, none dropped and none merged. That rule was stated in the
 * workflow definitions and in the framework patterns, and measured across four
 * attended runs it held in one delegate prompt out of three. The diagnosis the runs support is narrow: the rule holds where the
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
 * is a key the state contract already defines and the run already carries.
 *
 * Generic on purpose. The context block is *found*, by its suffix, not named by
 * a flag: the root carries exactly one, so a workflow key would be a second
 * place to get the same fact wrong. Every workflow is served by the same call
 * with the same flag — a built-in's block and one derived from any other
 * workflow's name alike. A run with no context block at all, a workflow whose
 * nodes record only `node_summaries`, has those rendered instead: they are the
 * run's prior record, and a refusal would hand its next delegate nothing.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
// The one state reader (`state-read.mjs`): this module used to carry its own,
// which is exactly the duplication that reader exists to end.
import { parse, isPlainObject } from './state-read.mjs';
// The writer decides which keys are context blocks, so the reader asks it
// rather than keeping a list of its own: a block the writer derives is a block
// this module finds, and a reserved `project_context` is one neither mistakes
// for the run's.
import { isContextBlock } from './state.mjs';
// A revise the run is in the middle of is found the way `resume-check` finds it.
import { openRevision } from './revise.mjs';
import { PROVENANCE_KEYS, riskOf, riskText } from './items.mjs';

/**
 * The two fields the artifact summary contract is written against. They lead
 * every phase section and they are printed even when empty, because an absent
 * list and an empty one are different facts and a delegate is owed the
 * difference.
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
export function priorContext({ state, background = false }) {
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

  const key = Object.keys(doc).find(name => isContextBlock(name) && isPlainObject(doc[name]));
  if (key) {
    const summaries = doc[key].phase_summaries;
    if (summaries !== undefined && summaries !== null && !isPlainObject(summaries)) {
      return refuse('prior-context-absent',
        `${key}.phase_summaries is not a map, so its entries cannot be rendered`);
    }
    return { ok: true, text: render(`${key}.phase_summaries`, 'phase', isPlainObject(summaries) ? summaries : {}, background) + revisionOf(doc), errors: [] };
  }

  // No context block. A run — one the engine froze, or one whose nodes have
  // recorded summaries — is rendered from `node_summaries`; a file that is
  // neither is not a run this verb can say anything about.
  const nodes = doc.node_summaries;
  if (!isPlainObject(doc.workflow) && (nodes === undefined || nodes === null)) {
    return refuse('prior-context-absent',
      `${state} carries no context block, no node_summaries and no workflow block, so there is no prior context to render`);
  }
  if (nodes !== undefined && nodes !== null && !isPlainObject(nodes)) {
    return refuse('prior-context-absent', 'node_summaries is not a map, so its entries cannot be rendered');
  }
  return { ok: true, text: render('node_summaries', 'node', isPlainObject(nodes) ? nodes : {}, background) + revisionOf(doc), errors: [] };
}

/**
 * The operator's note, while the run is re-running a stretch they sent back.
 * It is the one input the re-run has that the first attempt did not, so it is
 * printed under its own heading after the prior context rather than left among
 * the gate's decisions, where a delegate would read it as history. Nothing when
 * no revise is open, or when its reset has not happened yet.
 */
function revisionOf(doc) {
  const open = openRevision(doc);
  if (!open || !open.applied || !open.note) return '';
  return [
    `## Revision requested — ${open.gate}`,
    '',
    `The user sent this run back from \`${open.gate}\` to re-run \`${open.reruns}\` `
      + `(revision ${open.revision} at that checkpoint). The note is binding: revise the earlier output in place to `
      + 'address it, keep what it does not reopen, and say in the summary what changed.',
    '',
    `Note: ${scalarText(open.note)}`,
    '',
    '',
  ].join('\n');
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
 * bullet is the one form that cannot quietly hold two items. `source` is the
 * map's path in state and `unit` what one of its entries records — a phase for
 * a context block's `phase_summaries`, a node for `node_summaries`.
 */
function render(source, unit, summaries, background = false) {
  // Every entry the state writer records is a map — it refuses any other shape —
  // so an entry that is not one was written by hand, and is not read.
  const entries = Object.entries(summaries).filter(([, value]) => isPlainObject(value));
  const out = [];

  let decisions = 0;
  let risks = 0;
  for (const [, entry] of entries) {
    decisions += listOf(entry.decisions).length;
    risks += listOf(entry.risks).length;
  }

  const counts = `Pasted from \`${source}\` in this run's \`orchestrator-state.yml\`: `
    + `${entries.length} ${entries.length === 1 ? unit : `${unit}s`}, ${decisions} `
    + `${decisions === 1 ? 'decision' : 'decisions'}, ${risks} ${risks === 1 ? 'risk' : 'risks'}. `;
  if (background) {
    out.push('## Background — what earlier phases decided');
    out.push('');
    out.push(`${counts}These are background for a document written for end users: keep what you write consistent `
      + 'with them, and do not reproduce them. No list of decisions, risks or run history belongs in the document, '
      + 'and none of their internal codes or wording does either.');
  } else {
    out.push('## Prior-phase context — decisions and risks carried forward');
    out.push('');
    out.push(`${counts}These are binding. Every item below is one item in state — do not drop one, `
      + 'do not merge two, and do not re-word them.');
  }
  out.push('');

  if (!entries.length) {
    out.push(`No ${unit} has recorded a summary yet: this is the run's first artifact-writing node, `
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
  return [`${label(field)} (${items.length}):`, ...items.map(item => `- ${listItemText(field, item)}`), ''];
}

/**
 * The bookkeeping a typed decision carries — when and through which surface it
 * was answered, the reserved triage block, the assumption and the reversal a
 * settled record-class choice is kept with, and the answer's provenance (who
 * acted, for whom, under which rule, on what evidence, what it overrode) —
 * which says nothing a delegate acts on.
 */
const RECORD_ONLY = new Set(['at', 'via', 'triage', 'assumption', 'reversal', ...PROVENANCE_KEYS]);

/**
 * One item of a contract list. A typed risk reads `<tag>: <risk> → <change>`,
 * the way a run wrote one before risks were typed, so a delegate reads one form
 * either way; a typed decision keeps its fields by name, less its bookkeeping. A
 * string is its own text, exactly as written.
 */
function listItemText(field, item) {
  if (field === 'risks' && isPlainObject(item)) {
    const risk = riskOf(item);
    if (risk) return `${risk.tag}: ${riskText(risk)}`;
  }
  if (field === 'decisions' && isPlainObject(item)) {
    return itemText(Object.fromEntries(Object.entries(item).filter(([key]) => !RECORD_ONLY.has(key))));
  }
  return itemText(item);
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
