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

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
