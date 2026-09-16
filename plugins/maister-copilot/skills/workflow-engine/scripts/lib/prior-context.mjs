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

// ---------------------------------------------------------------------------
// reading the document
// ---------------------------------------------------------------------------

/**
 * The state file as a plain object.
 *
 * A reader and not a YAML library, for the reason every reader in this plugin
 * is one: a consumer checkout carries no packages. It covers exactly the forms
 * a state file holds — block maps, block sequences, one-line flow maps and
 * sequences, quoted and plain scalars, and the folded and literal block scalars
 * a hand-written file may still carry — and nothing else. An indent it cannot
 * account for is a throw, never a silently half-read document, because a
 * half-read `phase_summaries` is precisely the dropped item this module exists
 * to prevent.
 */
function parse(raw) {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const cur = { i: 0 };
  const value = parseNode(lines, cur, 0);
  return isPlainObject(value) ? value : {};
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** Skip blank lines and whole-line comments. Returns the next content index. */
function advance(lines, cur) {
  while (cur.i < lines.length) {
    const body = lines[cur.i].trim();
    if (body === '' || body.startsWith('#')) cur.i++;
    else return cur.i;
  }
  return cur.i;
}

/** A map or a sequence at `indent`, decided by the first content line. */
function parseNode(lines, cur, indent) {
  advance(lines, cur);
  if (cur.i >= lines.length) return null;
  const body = lines[cur.i].trim();
  return body === '-' || body.startsWith('- ') ? parseSeq(lines, cur, indent) : parseMap(lines, cur, indent);
}

function parseMap(lines, cur, indent) {
  const map = {};
  while (cur.i < lines.length) {
    advance(lines, cur);
    if (cur.i >= lines.length) break;
    const line = lines[cur.i];
    const ind = indentOf(line);
    if (ind < indent) break;
    const body = line.trim();
    if (body === '-' || body.startsWith('- ')) break;
    const pair = splitKey(body);
    if (!pair) throw new Error(`line ${cur.i + 1} is neither a key nor a sequence item`);
    cur.i++;
    map[pair.key] = parseValue(pair.rest, lines, cur, ind);
  }
  return map;
}

function parseSeq(lines, cur, indent) {
  const items = [];
  while (cur.i < lines.length) {
    advance(lines, cur);
    if (cur.i >= lines.length) break;
    const line = lines[cur.i];
    const ind = indentOf(line);
    if (ind < indent) break;
    const body = line.trim();
    if (!(body === '-' || body.startsWith('- '))) break;
    const rest = body === '-' ? '' : body.slice(2).trim();
    cur.i++;
    if (rest === '') {
      items.push(parseNested(lines, cur, ind));
      continue;
    }
    // `- >-` and `- |`: the item itself is a block scalar, which is how a
    // hand-written run records a risk long enough to wrap. Its lines are the
    // more-indented ones that follow, exactly as for a keyed block scalar.
    const itemFold = /^([|>])([0-9+-]*)$/.exec(rest);
    if (itemFold) {
      items.push(parseBlockScalar(lines, cur, ind, itemFold[1]));
      continue;
    }
    // An item that opens with a quote or with flow punctuation is a scalar or a
    // flow collection, never a `key: value` pair, even though it carries a
    // colon — and several recorded risks and every flow-mapped decision do.
    // Deciding on the first character is what keeps `- "defaulted: …"` and
    // `- {decision: …, rationale: …}` from being read as one-key maps whose key
    // is `"defaulted` or `{decision`.
    const pair = /^["'{[]/.test(rest) ? null : splitKey(rest);
    if (!pair) {
      items.push(parseScalar(rest));
      continue;
    }
    // A mapped item: its first pair sits on the dash line, the rest of its
    // fields at the dash's own indent plus two.
    const entry = { [pair.key]: parseValue(pair.rest, lines, cur, ind + 2) };
    Object.assign(entry, parseMap(lines, cur, ind + 2));
    items.push(entry);
  }
  return items;
}

const KEY = /^(?:"([^"]*)"|'([^']*)'|([^:#'"]+?))\s*:(?:\s+(.*))?$/;

function splitKey(body) {
  const hit = KEY.exec(body);
  if (!hit) return null;
  const key = hit[1] ?? hit[2] ?? hit[3];
  return { key: key.trim(), rest: (hit[4] ?? '').trim() };
}

/** The value of `key:` — inline when `rest` is present, nested when it is not. */
function parseValue(rest, lines, cur, indent) {
  if (rest === '') return parseNested(lines, cur, indent);
  const fold = /^([|>])([0-9+-]*)$/.exec(rest);
  if (fold) return parseBlockScalar(lines, cur, indent, fold[1]);
  return parseScalar(rest);
}

/** Whatever is indented under the line just consumed, or null if nothing is. */
function parseNested(lines, cur, indent) {
  const at = advance(lines, cur);
  if (at >= lines.length || indentOf(lines[at]) <= indent) return null;
  return parseNode(lines, cur, indentOf(lines[at]));
}

/** A `|` or `>` scalar: every more-indented line, joined by newline or space. */
function parseBlockScalar(lines, cur, indent, style) {
  const parts = [];
  while (cur.i < lines.length) {
    const line = lines[cur.i];
    if (line.trim() !== '' && indentOf(line) <= indent) break;
    parts.push(line.trim());
    cur.i++;
  }
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return style === '|' ? parts.join('\n') : parts.join(' ').replace(/\s+/g, ' ').trim();
}

function parseScalar(text) {
  const body = stripComment(text.trim());
  if (body === '') return null;
  if (body.startsWith('{') && body.endsWith('}')) {
    const map = {};
    for (const part of splitFlow(body.slice(1, -1))) {
      const pair = splitFlowPair(part);
      if (pair) map[pair.key] = parseScalar(pair.rest);
    }
    return map;
  }
  if (body.startsWith('[') && body.endsWith(']')) {
    return splitFlow(body.slice(1, -1)).map(part => parseScalar(part));
  }
  if (body.startsWith('"') && body.endsWith('"') && body.length > 1) {
    try {
      return JSON.parse(body);
    } catch {
      return body.slice(1, -1);
    }
  }
  if (body.startsWith("'") && body.endsWith("'") && body.length > 1) return body.slice(1, -1).replace(/''/g, "'");
  if (body === 'null' || body === '~') return null;
  if (body === 'true' || body === 'false') return body === 'true';
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(body)) return Number(body);
  return body;
}

/** A trailing `# comment`, but only outside quotes and only after whitespace. */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && i > 0 && /\s/.test(text[i - 1])) return text.slice(0, i).trim();
  }
  return text;
}

/** Split a flow body on commas that are outside quotes and nested brackets. */
function splitFlow(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map(part => part.trim()).filter(part => part !== '');
}

/** `key: value` inside a flow map, split at the first colon outside quotes. */
function splitFlowPair(part) {
  let quote = null;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ':') return { key: part.slice(0, i).trim().replace(/^["']|["']$/g, ''), rest: part.slice(i + 1).trim() };
  }
  return null;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
