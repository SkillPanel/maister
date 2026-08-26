/**
 * The workflow definition reader.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20: no `fs.glob`, no
 * package resolution, no shebang reliance. A YAML package is a development
 * dependency of the repository's own tooling and is simply absent in a consumer
 * checkout, so the reader is hand-rolled over the narrow subset the shipped
 * workflows and the frozen fixtures actually use — block maps, block sequences,
 * flow maps, flow sequences, quoted and bare scalars, full-line and inline
 * comments.
 *
 * The design rule that matters is the one about everything else. Anchors,
 * aliases, multi-document streams, block scalars and tags are not "best effort"
 * here: each one stops the read with an error naming the file, the node, the
 * path and the line. A duplicate key is refused under the same rule and for a
 * sharper reason — it is the one construct that would change the graph without
 * looking like an error at all. A reader that guessed at any of them would hand
 * the validator a graph that differs from the one the author wrote, and the
 * whole point of validating a definition before executing it is that no such gap
 * exists.
 *
 * Nothing in this file interprets the grammar. It answers one question — what
 * did the document say — and leaves what the document may say to the validator.
 */

import fs from 'node:fs';

/**
 * The definition format this reader understands. A document declaring anything
 * else is not an error: the caller degrades, renders what it recognises and
 * keeps going. The constant lives here because the reader is what sees the
 * declaration first.
 */
export const KNOWN_VERSION = 1;

/**
 * A mapping entry. The key is lazy and forbids `:` and `#`, so a value that
 * carries a colon — every `skill:` and `workflow:` target does — is not split
 * at the wrong place.
 */
const ENTRY = /^("(?:[^"\\]|\\.)*"|'(?:[^'])*'|[^:#]+?)\s*:(?:\s+(.*))?$/;

/** A block sequence entry, in both its inline and its nested-block forms. */
const SEQUENCE_ENTRY = /^-(?:\s+(.*))?$/;

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/**
 * Read and parse one definition or overlay file. An unreadable file is reported
 * in the same located shape as a malformed one, so a caller has exactly one
 * error vocabulary to render.
 */
export function readDefinition(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { file, doc: null, errors: [located(file, '', `cannot be read: ${err.message}`)], warnings: [] };
  }
  return parseDefinition(text, file);
}

/**
 * Parse definition text. Returns `{file, doc, errors, warnings}`; on any
 * rejection `doc` is null and `errors` carries exactly one
 * `{file, node, path, message}` entry. Parsing stops at the first rejection
 * because a document that has left the subset cannot be scanned further
 * without guessing.
 */
export function parseDefinition(text, file) {
  try {
    const lines = scanLines(text);
    if (lines.length === 0) return { file, doc: {}, errors: [], warnings: [] };
    if (lines[0].indent !== 0) {
      throw new SubsetError('', lines[0].number, 'the document must begin at column 0');
    }
    const cursor = { lines, at: 0 };
    const doc = parseMap(cursor, 0, '');
    if (cursor.at < lines.length) {
      const line = lines[cursor.at];
      throw new SubsetError('', line.number, `"${line.body}" sits at an indentation no block opened`);
    }
    return { file, doc, errors: [], warnings: [] };
  } catch (err) {
    if (!(err instanceof SubsetError)) throw err;
    return { file, doc: null, errors: [located(file, err.path, err.message)], warnings: [] };
  }
}

/**
 * The node a path sits under, or null for anything outside the node map. The
 * validator reports per node, so the reader hands it that half already
 * extracted rather than making every caller re-derive it from the path.
 */
export function nodeOf(dotted) {
  const parts = String(dotted).split('.');
  return parts.length >= 2 && parts[0] === 'nodes' ? parts[1] : null;
}

function located(file, path, message) {
  return { file, node: nodeOf(path), path, message };
}

/** A construct outside the accepted subset, or a document that contradicts itself. */
class SubsetError extends Error {
  constructor(path, line, message) {
    super(`line ${line}: ${message}`);
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// the line scanner
// ---------------------------------------------------------------------------

/**
 * Significant lines only, each with its column. Carriage returns are stripped
 * explicitly rather than left to a platform-dependent split: a definition
 * authored on Windows must read identically to its committed LF twin, and a
 * `\r` that survived into a scalar would reach the state writer as a value it
 * is contractually required to refuse.
 */
function scanLines(text) {
  const lines = [];
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].replace(/\r$/, '');
    const body = row.trim();
    const number = i + 1;
    if (body === '' || body.startsWith('#')) continue;
    if (row.startsWith('\t') || /^ *\t/.test(row)) {
      throw new SubsetError('', number, 'indentation must be spaces, never tabs');
    }
    if (body === '---' || body === '...' || body.startsWith('--- ')) {
      throw new SubsetError('', number, 'multi-document streams are outside the accepted subset');
    }
    lines.push({ number, indent: row.length - row.trimStart().length, body });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// block structure
// ---------------------------------------------------------------------------

/**
 * A mapping with no prototype. `__proto__` is an ordinary key in YAML and a
 * loaded gun in a plain object literal: assigning it would delete no sibling but
 * would replace the map's prototype, so a document could reshape every node map
 * that inherits from it. A null-prototype map has no such key to hijack.
 */
function emptyMap() {
  return Object.create(null);
}

/**
 * Refuse a key the mapping already carries. Every other out-of-subset construct
 * stops the read; a duplicate key is the one class that would otherwise change
 * the graph in silence — last write wins, and a repeated node id quietly
 * replaces the node above it. The YAML libraries this reader stands in for
 * reject duplicates too, so accepting them would make the two disagree about
 * the same file.
 */
function refuseDuplicate(map, key, path, line) {
  if (Object.hasOwn(map, key)) {
    throw new SubsetError(path, line.number, `the key "${key}" is declared twice in the same mapping`);
  }
}

function parseMap(cursor, indent, path) {
  const map = emptyMap();
  while (cursor.at < cursor.lines.length) {
    const line = cursor.lines[cursor.at];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new SubsetError(path, line.number, `"${line.body}" is indented past the mapping it belongs to`);
    }
    if (SEQUENCE_ENTRY.test(line.body)) {
      throw new SubsetError(path, line.number, 'a sequence entry where a mapping key was expected');
    }
    const entry = ENTRY.exec(line.body);
    if (!entry) {
      throw new SubsetError(path, line.number, `"${line.body}" is not a "key: value" mapping entry`);
    }
    const key = unquote(entry[1], path, line);
    refuseDuplicate(map, key, path, line);
    const child = path === '' ? key : `${path}.${key}`;
    cursor.at++;
    map[key] = parseValue(cursor, indent, child, entry[2], line);
  }
  return map;
}

function parseSequence(cursor, indent, path) {
  const list = [];
  while (cursor.at < cursor.lines.length) {
    const line = cursor.lines[cursor.at];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new SubsetError(path, line.number, `"${line.body}" is indented past the sequence it belongs to`);
    }
    const entry = SEQUENCE_ENTRY.exec(line.body);
    if (!entry) break;
    const child = `${path}.${list.length}`;
    if (entry[1] !== undefined && ENTRY.test(entry[1])) {
      // A mapping opened on the dash line is legal YAML and is deliberately not
      // accepted: nothing shipped or frozen writes one, and admitting it would
      // mean carrying a second indentation rule for the sake of a shape no
      // definition uses. Rejecting is the honest answer, not a silent misread.
      throw new SubsetError(child, line.number, 'a mapping opened on a sequence dash is outside the accepted subset');
    }
    cursor.at++;
    list.push(parseValue(cursor, indent, child, entry[1], line));
  }
  return list;
}

/**
 * The value of one mapping key or one sequence entry: whatever followed on the
 * same line, or the block indented beneath it, or null when neither is there.
 */
function parseValue(cursor, indent, path, rest, line) {
  const raw = rest === undefined ? '' : stripComment(rest).trim();
  if (raw !== '') return parseInline(raw, path, line);

  const next = cursor.lines[cursor.at];
  if (!next || next.indent <= indent) return null;
  return SEQUENCE_ENTRY.test(next.body)
    ? parseSequence(cursor, next.indent, path)
    : parseMap(cursor, next.indent, path);
}

// ---------------------------------------------------------------------------
// inline values
// ---------------------------------------------------------------------------

function parseInline(raw, path, line) {
  const first = raw[0];
  if (first === '"' || first === "'") return parseQuoted(raw, path, line);
  if (first === '&' || first === '*') {
    throw new SubsetError(path, line.number, 'anchors and aliases are outside the accepted subset');
  }
  if (first === '|' || first === '>') {
    throw new SubsetError(path, line.number, 'block scalars are outside the accepted subset');
  }
  if (first === '!') {
    throw new SubsetError(path, line.number, 'tags are outside the accepted subset');
  }
  if (first === '{') return parseFlowMap(raw, path, line);
  if (first === '[') return parseFlowSequence(raw, path, line);
  return parseBareScalar(raw);
}

/**
 * The escapes a double-quoted scalar may carry. Decoded rather than stripped:
 * `"a\nb"` is a two-line value in YAML, and dropping the backslash would hand
 * the validator the six-character string `anb` — a value the author never wrote.
 * The list is closed, so an escape outside it stops the read rather than
 * resolving to whatever character happened to follow the backslash. \u#### is
 * deliberately not in it: these files are UTF-8 and "é" is written as itself,
 * so the escape would be a second spelling of something already expressible —
 * and a reader that decodes it is a reader that can produce any code point,
 * including the ones the state writer refuses. An author who reaches for it is
 * told what the accepted list is, which is the whole point of closing it.
 *
 * Two of the accepted three do produce a value the writer refuses, and that is
 * why `lib/graph.mjs` rejects a decoded newline, return or tab at validate
 * time. Decoding is the reader's job; deciding the value is runnable is not.
 */
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/' };

/** A quoted scalar keeps its text exactly, punctuation and `${…}` refs included. */
function parseQuoted(raw, path, line) {
  const quote = raw[0];
  const end = closingQuote(raw, quote);
  if (end !== raw.length - 1) {
    throw new SubsetError(path, line.number, 'a quoted scalar must open and close on one line');
  }
  const body = raw.slice(1, -1);
  if (quote !== '"') return body.replace(/''/g, "'");

  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const escape = ESCAPES[body[i + 1]];
    if (escape === undefined) {
      throw new SubsetError(path, line.number,
        `"\\${body[i + 1] ?? ''}" is not an escape this reader accepts; the closed list is \\n \\t \\r \\\\ \\" \\/ — write any other character as itself`);
    }
    out += escape;
    i++;
  }
  return out;
}

/**
 * Where the scalar closes. A doubled `''` inside a single-quoted scalar is YAML's
 * own escape for one quote and therefore does not close it — the unquoting half
 * has always handled that form, and refusing to scan past it here is what made
 * the two halves disagree.
 */
function closingQuote(raw, quote) {
  for (let i = 1; i < raw.length; i++) {
    if (quote === '"' && raw[i] === '\\') {
      i++;
      continue;
    }
    if (raw[i] !== quote) continue;
    if (quote === "'" && raw[i + 1] === "'") {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

function parseFlowMap(raw, path, line) {
  if (!raw.endsWith('}')) {
    throw new SubsetError(path, line.number, 'a flow map must open and close on one line');
  }
  const map = emptyMap();
  for (const part of splitFlow(raw.slice(1, -1), ',')) {
    if (part.trim() === '') continue;
    const pieces = splitFlow(part, ':');
    if (pieces.length < 2) {
      throw new SubsetError(path, line.number, `"${part.trim()}" is not "key: value" inside a flow map`);
    }
    const key = unquote(pieces[0], path, line);
    refuseDuplicate(map, key, path, line);
    const value = pieces.slice(1).join(':').trim();
    map[key] = value === '' ? null : parseInline(value, `${path}.${key}`, line);
  }
  return map;
}

function parseFlowSequence(raw, path, line) {
  if (!raw.endsWith(']')) {
    throw new SubsetError(path, line.number, 'a flow sequence must open and close on one line');
  }
  const list = [];
  for (const part of splitFlow(raw.slice(1, -1), ',')) {
    if (part.trim() === '') continue;
    list.push(parseInline(part.trim(), `${path}.${list.length}`, line));
  }
  return list;
}

/**
 * A bare scalar, with the four resolutions the subset admits. Everything else
 * stays a string — including a target like `skill:quick-plan`, which is exactly
 * why the mapping-entry pattern refuses to split on a colon inside a value.
 */
function parseBareScalar(raw) {
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// lexical helpers
// ---------------------------------------------------------------------------

/**
 * Drop an inline comment. A `#` counts only at the start or after whitespace,
 * only outside quotes, and only outside a flow construct — so a `#` inside a
 * quoted question or a flow map stays part of the value.
 */
function stripComment(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

/** Split a flow body on `sep`, honouring nesting and both quote characters. */
function splitFlow(text, sep) {
  const parts = [];
  let quote = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (depth === 0 && ch === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * A key, unquoted by exactly the rule that unquotes a value.
 *
 * These are the two halves of one quoting rule and they used to disagree: this
 * one stripped the outer pair and stopped, while `parseQuoted` decoded the
 * closed escape list and undid `''` doubling. A file could therefore spell one
 * string two ways and get two different keys out — and `"a\tb"` as a key came
 * back with a literal backslash in it while the same text as a value came back
 * with a tab. One rule, one function.
 */
function unquote(text, path, line) {
  const value = text.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    return parseQuoted(value, path, line);
  }
  return value;
}
