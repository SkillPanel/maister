/**
 * The state document as a plain object: the one reader every path shares.
 *
 * **The defect that split it out.** Five private state readers existed — in the
 * gate library, in the prior-phase renderer, in the diagram writer, in the
 * completion check and in the graph walker — and none of them was shared. Each
 * covered the subset of YAML its own caller happened to need, so the same state
 * file could be read five ways, and a form one reader accepted could be a form
 * another silently dropped. The write path made that a wall rather than an
 * untidiness: a writer must read the document it is about to rewrite, and with
 * no reader it could import it had exactly two options — duplicate one of the
 * five and become the sixth, or read less than it writes. Both end in a run
 * whose state says something no reader agrees on.
 *
 * So the reader moved out here and both halves import it. Nothing in this
 * module knows what a state file *means* — no key is named, no block is looked
 * for, no contract is enforced. It turns bytes into a plain object and stops,
 * which is why a renderer and a writer can share it without either inheriting
 * the other's opinions.
 *
 * A reader and not a YAML library, for the reason every reader in this plugin
 * is one: a consumer checkout carries no packages. It covers exactly the forms
 * a state file holds and nothing else, and `parse` normalizes `\r\n?` to `\n`
 * before it does anything, so a Windows checkout reads the same as any other.
 *
 * **The retained rule: an unaccountable indent is a throw.** This is the one
 * piece of behaviour the extraction was not allowed to soften, and it is
 * deliberately not the return-don't-throw shape the rest of the boundary uses.
 * A block sequence whose items sit at their own key's indent rather than deeper
 * is *accounted for* and not merely tolerated — it is ordinary YAML, and it used
 * to end the document at the dash line and drop every sibling key after it, so
 * it is read as belonging to that key and the map resumes at the key's indent.
 * An indent the reader cannot account for means the document is not the
 * document it thinks it is, and the alternative to stopping is a map that is
 * missing entries no caller can know were there: a half-read `phase_summaries`
 * is precisely the dropped item this module exists to prevent. Callers wrap the
 * call and turn the throw into their own refusal — `state-unreadable` in the
 * prior-phase renderer — which keeps the decision about *how loudly* to fail
 * with the caller and the decision about *whether* the document was read here.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

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
export function parse(raw) {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const cur = { i: 0 };
  const value = parseNode(lines, cur, 0);
  return isPlainObject(value) ? value : {};
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** A dash alone opens a nested item; `- ` carries one inline. */
const SEQ_DASH = '-';
const SEQ_ITEM_PREFIX = '- ';

/**
 * Does this trimmed line open a block sequence item?
 *
 * One definition, shared by every site that decides between a map entry and a
 * sequence item: the node dispatcher, the map reader, the sequence reader, and
 * the nesting rule below, which needs the same answer as of this change. They
 * spelled the two comparisons out separately before, and separate copies of this
 * predicate are how a form one reader accepts becomes a form another drops.
 */
function isSeqItem(body) {
  return body === SEQ_DASH || body.startsWith(SEQ_ITEM_PREFIX);
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
  return isSeqItem(body) ? parseSeq(lines, cur, indent) : parseMap(lines, cur, indent);
}

function parseMap(lines, cur, indent) {
  // Null-prototype, because every key here comes from the file and `__proto__`
  // is a setter on `Object.prototype`. Assigned onto an ordinary `{}` it writes
  // *through* the map instead of into it, so `Object.keys` and `Object.hasOwn`
  // both say the key is absent while a plain read returns what the file said —
  // a state file could forge any field the projection publishes. `dashboard.mjs`
  // declares exactly this invariant for the maps it builds; holding it there and
  // not here left the guards defeated one level up.
  const map = Object.create(null);
  while (cur.i < lines.length) {
    advance(lines, cur);
    if (cur.i >= lines.length) break;
    const line = lines[cur.i];
    const ind = indentOf(line);
    if (ind < indent) break;
    const body = line.trim();
    if (isSeqItem(body)) break;
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
    if (!isSeqItem(body)) break;
    const rest = body === SEQ_DASH ? '' : body.slice(SEQ_ITEM_PREFIX.length).trim();
    cur.i++;
    if (rest === '') {
      // A bare `-` takes what is written *deeper* than it. What follows at the
      // dash's own indent is the next item of this same sequence, never this
      // item's contents: reading it as contents turns `items:\n-\n- alpha\n- beta`
      // into `[["alpha","beta"]]`, one silent wrong answer in a module whose
      // contract is that an unaccountable shape throws. The parent-indent form
      // `parseNested` accounts for belongs to a *key*, which is why only that
      // caller may ask for it.
      items.push(parseNested(lines, cur, ind, false));
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
    // Null-prototype for the reason `parseMap` is: `Object.assign` copies with
    // [[Set]], so a `__proto__` key in the item's remaining fields would hit the
    // prototype setter on an ordinary `{}`.
    const entry = Object.create(null);
    entry[pair.key] = parseValue(pair.rest, lines, cur, ind + 2);
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

/**
 * Whatever belongs to the line just consumed, or null if nothing does.
 *
 * Two forms belong. The plainly nested one is written deeper than its key. The
 * other is a block sequence whose items sit at the **key's own** indent, which
 * is ordinary YAML and is what a hand-written state file looks like:
 *
 *     orchestrator:
 *       completed_phases:
 *       - phase-1
 *       options:
 *         html_output: false
 *
 * That form used to end the document. This function saw an indent no deeper
 * than the key and returned null, and then the enclosing `parseMap` broke on
 * the dash line — so `completed_phases` read null and `options` was gone
 * entirely, along with every other sibling after it. A caller reading
 * `html_output` off that got `undefined` and defaulted it to the opposite of
 * what the file said, with nothing to tell it the key had been dropped. Items at
 * the key's indent belong to the key, and the map resumes at the key's indent
 * once they end, which is where `parseSeq` leaves the cursor.
 *
 * Widening what can be accounted for is not the same as softening the rule an
 * indent below: an indent that still fits neither form is still a throw.
 *
 * `sameIndentSeq` says whether the second form is on offer, and only the caller
 * that reads a **key's** value passes it. A bare `-` reaches here too, and for it
 * a sequence item at the same indent is the next item of the sequence it is
 * already in, not its own contents — so that caller passes `false` and the shape
 * throws rather than nesting the rest of the sequence inside one item.
 */
function parseNested(lines, cur, indent, sameIndentSeq = true) {
  const at = advance(lines, cur);
  if (at >= lines.length) return null;
  const ind = indentOf(lines[at]);
  if (ind === indent && isSeqItem(lines[at].trim())) {
    if (sameIndentSeq) return parseSeq(lines, cur, indent);
    throw new Error(`line ${at + 1} is a sequence item at the indent of the bare '-' above it`);
  }
  if (ind <= indent) return null;
  return parseNode(lines, cur, ind);
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
    // Null-prototype: a flow mapping's keys come from the file too.
    const map = Object.create(null);
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

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
