/**
 * The explainer check: does an explainer page say only what its sources say?
 *
 *   node <path to this file> --page=<file> --source=<file or folder> [--source=<file or folder> ...]
 *
 * `--page` names the explainer page and is required. `--source` names a file
 * or a folder the page was built from; it repeats, and at least one is
 * required. A folder is read recursively for `.md`, `.html`, `.txt`, `.json`,
 * `.yml`, `.yaml` and `.csv` files; a file named directly is read whatever its
 * type. Paths are taken against the current directory, so a source may sit
 * anywhere, a decisions file in a scratch directory included. The page is never
 * read as one of its own sources, even when a folder source holds it. Exec
 * form, no shebang, zero dependencies, `node:` builtins only, Node >= 20.
 *
 * What it reads on the page: every text node outside `<style>`, `<script>`
 * and comments (`<title>` and SVG `<text>` included), and the `title`,
 * `aria-label` and `alt` attributes. No other attribute is read, so SVG and
 * CSS geometry (`viewBox`, `x`, `d`, `points`, `width`, `style`, `data-*`)
 * raises no figure. Named and numeric entities are decoded. An `.html` source
 * is read the same way; any other source as plain text.
 *
 * Each figure belongs to a section: the `<section>` around it, named by its
 * first `<h2>`, or the `<header>` that holds an `<h1>`, named by that `<h1>`.
 * A figure outside both has no section (`null`).
 *
 * What it ignores, on the page and in sources alike: ISO dates and datetimes,
 * month-name dates, versions (`v`-prefixed, or three or more dotted parts,
 * through any `-<label>.<n>` pre-release suffix), `§`-prefixed section numbers
 * (`§3`, `§ 3`), a digit run directly after a letter or underscore (`sha256`,
 * `L340`, `h2`, `x86`), and spelled-out numbers.
 *
 * How it normalises a figure: thousands separators (a comma, a no-break space
 * or a thin space before exactly three digits) are dropped; so are `%`, a
 * trailing `×` or `x`, a leading `×`, a unit glued on the right (`38min`,
 * `1.2GB`) and any sign. A range between two numbers (`6–8`, `6—8`, `6-8`) is
 * two figures. A vulgar fraction after digits reads as its decimal value
 * (`3½` is 3.5). Values compare as numbers, so `0.50` equals `.5`. A clock time
 * `H:MM` or `H:MM:SS` is one figure, compared as text with the hour's leading
 * zero dropped (`01:30` equals `1:30`).
 *
 * Evidence links: an `<a>` whose class list holds `evidence`. One anywhere
 * inside a block counts for that block and every block around it. Its href is
 * taken against the page's folder; it must be a relative path to a file (no
 * scheme, no leading `/`, not a bare `#fragment`), and its fragment one of the
 * target's anchors. A `.md` target's anchors are the GitHub-style slugs of its
 * ATX headings outside fenced and indented code. To slug a heading: (1) remove
 * inline code marks and `*`; (2) replace a link by its text, keeping `_`;
 * (3) lowercase; (4) delete every character that is not a Unicode letter,
 * mark, number, `_`, `-` or space; (5) turn each space into `-`, so "A — B"
 * becomes `a--b`; (6) suffix a repeat with `-1`, `-2` and so on. An `.html`
 * target's anchors are its `id` values; any other file has none.
 *
 * Findings, each `{code, message}` plus the fields named here:
 *   - `untraced-number` (`figure` as written, `section`): a figure on the page
 *     that no source states. Reported once per figure and section.
 *   - `section-without-evidence` (`section`): a `<section>`, or the `<header>`
 *     that holds an `<h1>`, with no evidence link inside it.
 *   - `evidence-target-missing` (`href`, `section`): an evidence link that is
 *     not a relative path, or whose file is missing or unreadable.
 *   - `evidence-anchor-missing` (`href`, `section`): an evidence link with no
 *     fragment, or one that is not an anchor of its target.
 *   - `backlink-missing` (`href`, the target as the link writes it): an `.html`
 *     evidence target holding a `<nav class="crumbs">` with no `<a>` whose
 *     href, taken against the target's own folder, is this page. A target
 *     with no crumbs bar, and an `.md` target, raise none. Once per target.
 *   - `external-resource` (`section`): anything the page would load from
 *     outside itself — any `<link>`, any `<script src>`, an `<iframe>`,
 *     `<object>` or `<embed>`, a `src`, `srcset` candidate or `poster` starting
 *     `http:`, `https:` or `//`, and any `@import` or a `url(` to such a URL in
 *     a `<style>` block or a `style` attribute. A relative image is none.
 *   - `raw-mermaid` (`section`): a `mermaid` or `language-mermaid` class, or a
 *     mermaid fence (three or more backticks or tildes, then `mermaid`) in text.
 *
 * Link and containment findings are reported once per code, href or resource,
 * and section.
 *
 * Output: one JSON object on stdout, `{ok, page, sources, figures, sections,
 * evidence_links, findings}`. `page` and `sources` are as given; `figures`
 * (figures read on the page), `sections` (sections plus answer headers) and
 * `evidence_links` (`<a class="evidence">` links) are counts; `ok` is true
 * exactly when `findings` is empty. Exit 0 when there are no findings, 1 when
 * there is one or more, 2 when the check could not run — a usage error, or a
 * page or a source that is missing or unreadable — or an error the check did
 * not expect, which is never reported as findings. On exit 2 stdout is empty
 * and stderr holds `check-explainer: <message>` and a usage line (an unexpected
 * error: the single line `check-explainer: unexpected error: <message>`).
 */

import fs from 'node:fs';
import path from 'node:path';

const EXIT = { OK: 0, FINDINGS: 1, INTERNAL: 2 };

const USAGE = 'usage: node check-explainer.mjs --page=<file> --source=<file or folder> [--source=<file or folder> ...]';

/** The file types a folder source is read for. */
const SOURCE_TYPES = new Set(['.md', '.html', '.txt', '.json', '.yml', '.yaml', '.csv']);

/** The only attributes whose values are read as text. */
const READ_ATTRIBUTES = ['title', 'aria-label', 'alt'];

/** Elements whose content is not markup, read whole up to their closing tag. */
const RAW_TEXT = new Set(['script', 'style']);

/** Elements that never hold content, so never wait for a closing tag. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

class UsageError extends Error {}
class ReadError extends Error {}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const flags = { page: null, sources: [] };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    const match = /^--(page|source)(?:=(.*))?$/s.exec(arg);
    if (!match) throw new UsageError(`unknown argument ${arg}`);
    let value = match[2];
    if (value === undefined) {
      value = argv[at + 1];
      at += 1;
      if (value !== undefined && value.startsWith('--')) value = undefined;
    }
    if (value === undefined || value === '') throw new UsageError(`--${match[1]} needs a value`);
    if (match[1] === 'page') {
      if (flags.page !== null) throw new UsageError('--page is given twice');
      flags.page = value;
    } else {
      flags.sources.push(value);
    }
  }
  if (flags.page === null) throw new UsageError('--page is required');
  if (flags.sources.length === 0) throw new UsageError('at least one --source is required');
  return flags;
}

// ---------------------------------------------------------------- entities

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ',
  ndash: '–', mdash: '—', minus: '−', hyphen: '‐', times: '×', divide: '÷', plusmn: '±', percnt: '%', num: '#',
  sect: '§', para: '¶', middot: '·', bull: '•', hellip: '…', deg: '°', micro: 'µ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', check: '✓', cross: '✗',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', approx: '≈', sim: '∼',
  half: '½', frac12: '½', frac13: '⅓', frac23: '⅔', frac14: '¼', frac34: '¾', frac15: '⅕', frac16: '⅙', frac18: '⅛',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', dollar: '$',
};

function decode(text) {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, (whole, dec, hex, name) => {
    if (name !== undefined) return NAMED[name] ?? whole;
    const point = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return point > 0 && point <= 0x10FFFF ? String.fromCodePoint(point) : whole;
  });
}

// ---------------------------------------------------------------- markup

const CLOSE_TAG = /<\/([A-Za-z][^\s/>]*)[^>]*>/y;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The index of the `>` that ends the tag whose name starts at `from`, quoted values respected. */
function tagEnd(html, from) {
  let quote = null;
  for (let at = from; at < html.length; at += 1) {
    const char = html[at];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return at;
    }
  }
  return -1;
}

function parseAttributes(text) {
  const attrs = {};
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/**
 * The page as a flat list of tokens: `open` (`name`, `attrs`, `selfClosing`),
 * `close` (`name`), `text` (decoded), `raw` (the content of a `<style>` or
 * `<script>`, with its `name`) and `comment`. Names are lowercased. Lenient by
 * design: a `<` that opens no tag is text, and nothing is ever an error.
 */
function tokenize(html) {
  const tokens = [];
  let at = 0;
  let textFrom = 0;
  const flush = upto => {
    if (upto > textFrom) tokens.push({ type: 'text', text: decode(html.slice(textFrom, upto)) });
  };
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt < 0) break;
    const next = html[lt + 1] ?? '';
    if (html.startsWith('<!--', lt)) {
      flush(lt);
      const close = html.indexOf('-->', lt + 4);
      tokens.push({ type: 'comment', text: html.slice(lt + 4, close < 0 ? html.length : close) });
      at = textFrom = close < 0 ? html.length : close + 3;
    } else if (next === '!' || next === '?') {
      flush(lt);
      const close = html.indexOf('>', lt);
      at = textFrom = close < 0 ? html.length : close + 1;
    } else if (next === '/') {
      CLOSE_TAG.lastIndex = lt;
      const match = CLOSE_TAG.exec(html);
      if (!match) {
        at = lt + 1;
        continue;
      }
      flush(lt);
      tokens.push({ type: 'close', name: match[1].toLowerCase() });
      at = textFrom = CLOSE_TAG.lastIndex;
    } else if (/[A-Za-z]/.test(next)) {
      const end = tagEnd(html, lt + 1);
      if (end < 0) {
        at = lt + 1;
        continue;
      }
      flush(lt);
      const inner = html.slice(lt + 1, end);
      const name = /^[^\s/>]+/.exec(inner)[0];
      const lower = name.toLowerCase();
      const selfClosing = /\/\s*$/.test(inner);
      tokens.push({ type: 'open', name: lower, attrs: parseAttributes(inner.slice(name.length).replace(/\/\s*$/, '')), selfClosing });
      at = textFrom = end + 1;
      if (RAW_TEXT.has(lower) && !selfClosing) {
        const closing = new RegExp(`</${lower}(?=[\\s/>])`, 'gi');
        closing.lastIndex = at;
        const found = closing.exec(html);
        const stop = found ? found.index : html.length;
        tokens.push({ type: 'raw', name: lower, text: html.slice(at, stop) });
        at = textFrom = stop;
      }
    } else {
      at = lt + 1;
    }
  }
  flush(html.length);
  return tokens;
}

const classes = attrs => (attrs.class ?? '').split(/\s+/).filter(Boolean);
const collapse = text => text.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- containment

/** A URL that leaves the page's folder for the network: `http:`, `https:` or protocol-relative. */
const REMOTE = /^\s*(?:https?:|\/\/)/i;
const CSS_IMPORT = /@import\b/gi;
const CSS_REMOTE_URL = /url\(\s*(['"]?)\s*((?:https?:|\/\/)[^'")\s]*)/gi;
const MERMAID_CLASSES = new Set(['mermaid', 'language-mermaid']);
const MERMAID_FENCE = /(?:`{3,}|~{3,})[ \t]*mermaid(?![\w-])/i;

/** What in a piece of CSS would load from outside the page: every `@import`, and every `url(` to a remote URL. */
function cssResources(css) {
  const found = [];
  for (const _ of css.matchAll(CSS_IMPORT)) found.push('an @import');
  for (const match of css.matchAll(CSS_REMOTE_URL)) found.push(`url(${match[2]})`);
  return found;
}

/** What one opening tag would load from outside the page, one entry per resource. */
function tagResources({ name, attrs }) {
  const found = [];
  if (name === 'link') found.push(attrs.href ? `a <link> to ${attrs.href}` : 'a <link>');
  else if (name === 'script' && attrs.src !== undefined) found.push(`a <script src="${attrs.src}">`);
  else if (name === 'iframe' || name === 'object' || name === 'embed') found.push(`an <${name}>`);
  else {
    for (const attr of ['src', 'poster']) {
      if (attrs[attr] !== undefined && REMOTE.test(attrs[attr])) found.push(`${attr}="${attrs[attr].trim()}" on <${name}>`);
    }
    const remote = (attrs.srcset ?? '').split(',').map(each => each.trim()).find(each => REMOTE.test(each));
    if (remote !== undefined) found.push(`a srcset candidate ${remote.split(/\s+/)[0]} on <${name}>`);
  }
  if (attrs.style !== undefined) found.push(...cssResources(attrs.style).map(each => `${each} in a style attribute`));
  return found;
}

/**
 * What the check reads from a page: its text `chunks`, each with the block it
 * sits in; its `blocks` (every `<section>`, and every `<header>` that holds an
 * `<h1>`), each with its `heading` and its `evidence` count (the evidence links
 * anywhere inside it); its `evidence` links, each with its `href` and block;
 * the external `resources` it would load and the `mermaid` source it carries,
 * each with what it is and its block. A block is `{kind, heading, parent,
 * evidence}`; the page itself is the block of kind `page` with no heading.
 */
function readHtml(tokens) {
  const page = { kind: 'page', heading: null, parent: null, evidence: 0 };
  const raw = [];
  const chunks = [];
  const evidence = [];
  const resources = [];
  const mermaid = [];
  const stack = [];
  let capture = null;
  const current = () => {
    for (let at = stack.length - 1; at >= 0; at -= 1) if (stack[at].block) return stack[at].block;
    return page;
  };
  for (const token of tokens) {
    if (token.type === 'open') {
      const block = current();
      for (const name of READ_ATTRIBUTES) {
        if (token.attrs[name] !== undefined) chunks.push({ text: token.attrs[name], block });
      }
      if (token.name === 'a' && classes(token.attrs).includes('evidence')) evidence.push({ href: token.attrs.href ?? null, block });
      for (const what of tagResources(token)) resources.push({ what, block });
      for (const name of classes(token.attrs)) if (MERMAID_CLASSES.has(name)) mermaid.push({ what: `a ${name} class on <${token.name}>`, block });
      if (VOID.has(token.name) || token.selfClosing) continue;
      const entry = { name: token.name };
      if (token.name === 'section' || token.name === 'header') {
        entry.block = { kind: token.name, heading: null, parent: block, evidence: 0 };
        raw.push(entry.block);
      }
      const names = (token.name === 'h2' && block.kind === 'section') || (token.name === 'h1' && block.kind === 'header');
      if (!capture && names && block.heading === null) capture = { block, entry, parts: [] };
      stack.push(entry);
    } else if (token.type === 'close') {
      const at = stack.findLastIndex(entry => entry.name === token.name);
      if (at < 0) continue;
      const closed = stack.splice(at);
      if (capture && closed.includes(capture.entry)) {
        capture.block.heading = collapse(capture.parts.join(''));
        capture = null;
      }
    } else if (token.type === 'text') {
      chunks.push({ text: token.text, block: current() });
      if (capture) capture.parts.push(token.text);
      if (MERMAID_FENCE.test(token.text)) mermaid.push({ what: 'a mermaid fence', block: current() });
    } else if (token.type === 'raw' && token.name === 'style') {
      for (const what of cssResources(token.text)) resources.push({ what: `${what} in a <style> block`, block: current() });
    }
  }
  if (capture) capture.block.heading = collapse(capture.parts.join(''));

  // A `<header>` with no `<h1>` is not a block of its own: what it holds belongs to the block around it.
  const effective = block => {
    let at = block;
    while (at.kind === 'header' && at.heading === null) at = at.parent;
    return at;
  };
  // A link anywhere inside a block counts for it, and so for every block around it.
  for (const link of evidence) {
    for (let at = effective(link.block); at.kind !== 'page'; at = effective(at.parent)) at.evidence += 1;
  }
  const located = list => list.map(item => ({ ...item, block: effective(item.block) }));
  return {
    chunks: located(chunks),
    blocks: raw.filter(block => effective(block) === block),
    evidence: located(evidence),
    resources: located(resources),
    mermaid: located(mermaid),
  };
}

/** The name a finding gives a block: its heading, or null for the page itself. */
const sectionOf = block => (block.kind === 'page' ? null : block.heading);

// ---------------------------------------------------------------- figures

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?(?!\\p{L})';
const ORDINAL = '(?:st|nd|rd|th)?';
const PRERELEASE = '(?:-[A-Za-z][0-9A-Za-z]*(?:\\.[0-9A-Za-z]+)*)?';

/** Spans that are not figures, blanked before any figure is read. Order matters: dates before clocks, versions before glued digits. */
const IGNORED = [
  // ISO dates and datetimes.
  /(?<!\d)\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?!\d)/g,
  // Month-name dates: "July 27, 2031", "Jul 27", "27 July 2031", "July 2031".
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}${ORDINAL}(?:,?\\s+\\d{4})?(?!\\d)`, 'gu'),
  new RegExp(`(?<![\\d.])\\d{1,2}${ORDINAL}\\s+(?:of\\s+)?${MONTH}(?:,?\\s+\\d{4}(?!\\d))?`, 'gu'),
  new RegExp(`\\b${MONTH}\\s+\\d{4}(?!\\d)`, 'gu'),
  // Versions: v-prefixed, or three or more dotted parts, through a pre-release suffix.
  new RegExp(`(?<![\\p{L}\\d_])v\\d+(?:\\.\\d+)*${PRERELEASE}`, 'gu'),
  new RegExp(`(?<![\\d.])\\d+(?:\\.\\d+){2,}${PRERELEASE}`, 'g'),
  // Section numbers.
  /§[  ]?\d+(?:\.\d+)*/g,
  // A digit run directly after a letter or underscore: an identifier, not a figure.
  /(?<=[\p{L}_])\d+(?:\.\d+)*/gu,
];

const CLOCK = /(?<![\d:.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/g;

const FRACTIONS = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅐': 1 / 7, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8, '⅑': 1 / 9, '⅒': 1 / 10,
};

/** A thousands separator: a comma, a no-break space or a thin space (U+202F, the narrow no-break space, too). */
const SEPARATOR = '[,\\u00A0\\u2009\\u202F]';

/**
 * A figure: an optional leading `×`, the number (with thousands separators, or
 * plain, or a bare decimal `.5`), an optional vulgar fraction, then an optional
 * `%`, `×` or unit glued on the right. Signs and dashes before it are never part
 * of it, which is what drops a sign and splits a range in two.
 */
const NUMBER = new RegExp(
  `(×\\s?)?(\\d{1,3}(?:${SEPARATOR}\\d{3})+(?!\\d)(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)([${Object.keys(FRACTIONS).join('')}])?(%|×|\\p{L}+)?`,
  'gu',
);

const blank = match => ' '.repeat(match.length);

/**
 * The figures in a text, in order: each `{written, key}`, `key` being what two
 * figures compare by. With `fields`, a figure grouped by commas also yields
 * each comma-separated part, since a CSV or JSON source's `120,340` may be two
 * values (a row, an array) as well as one; prose sources and the page never
 * read it that way.
 */
function figuresIn(text, { fields = false } = {}) {
  let rest = text;
  for (const pattern of IGNORED) rest = rest.replace(pattern, blank);
  const found = [];
  rest = rest.replace(CLOCK, (whole, hour, minutes, seconds, offset) => {
    found.push({ at: offset, written: whole, key: `clock ${Number(hour)}:${minutes}${seconds === undefined ? '' : `:${seconds}`}` });
    return blank(whole);
  });
  for (const match of rest.matchAll(NUMBER)) {
    const fraction = match[3] ? FRACTIONS[match[3]] : 0;
    const value = Number(match[2].replace(new RegExp(SEPARATOR, 'g'), '')) + fraction;
    found.push({ at: match.index, written: match[0], key: `number ${value}` });
    if (!fields || !match[2].includes(',')) continue;
    const parts = match[2].split(',');
    parts.forEach((part, index) => {
      const each = Number(part.replace(new RegExp(SEPARATOR, 'g'), '')) + (index === parts.length - 1 ? fraction : 0);
      found.push({ at: match.index, written: part, key: `number ${each}` });
    });
  }
  return found.sort((one, other) => one.at - other.at).map(({ written, key }) => ({ written, key }));
}

// ---------------------------------------------------------------- reading files

function readText(file, label) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ReadError(`cannot read ${label}: ${error.code ?? error.message}`);
  }
}

const realpath = file => {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
};

/** Every file a folder source holds, recursively, of the listed types, in a stable order. */
function filesUnder(dir, label, seen = new Set()) {
  const real = realpath(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  let entries;
  try {
    entries = fs.readdirSync(dir).sort();
  } catch (error) {
    throw new ReadError(`cannot read the source ${label}: ${error.code ?? error.message}`);
  }
  const files = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) files.push(...filesUnder(full, label, seen));
    else if (stat.isFile() && SOURCE_TYPES.has(path.extname(name).toLowerCase())) files.push(full);
  }
  return files;
}

/** The plain text of one source file: an `.html` file read as the page is, any other as it stands. */
function sourceText(file, label) {
  const text = readText(file, label);
  if (path.extname(file).toLowerCase() !== '.html') return text;
  return readHtml(tokenize(text)).chunks.map(chunk => chunk.text).join('\n');
}

/**
 * The source types whose comma groups may be separate values (a CSV row, a JSON
 * array); in prose a comma group is one thousands-grouped figure only.
 */
const FIELD_SOURCES = new Set(['.csv', '.json']);

/** The keys of every figure the sources state; the page itself is never one of them. */
function statedFigures(sources, pageFile) {
  const page = realpath(pageFile);
  const keys = new Set();
  for (const given of sources) {
    const full = path.resolve(given);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (error) {
      throw new ReadError(`cannot read the source ${given}: ${error.code ?? error.message}`);
    }
    const files = stat.isDirectory() ? filesUnder(full, given) : [full];
    for (const file of files) {
      if (realpath(file) === page) continue;
      const fields = FIELD_SOURCES.has(path.extname(file).toLowerCase());
      for (const figure of figuresIn(sourceText(file, `the source ${path.relative(process.cwd(), file) || given}`), { fields })) keys.add(figure.key);
    }
  }
  return keys;
}

// ---------------------------------------------------------------- anchors

/** The text of each ATX heading of a markdown file, in order, skipping fenced and indented code. */
function markdownHeadings(markdown) {
  const headings = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      continue;
    }
    if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = marker[1];
      continue;
    }
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (atx) headings.push((atx[1] ?? '').replace(/(?:^|[ \t]+)#+$/, '').trim());
  }
  return headings;
}

/** A heading's GitHub-style slug, before any repeat suffix. */
function slug(heading) {
  return heading
    .replace(/[`*]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-');
}

/** The anchors of a markdown file: each heading's slug, a repeat suffixed `-1`, `-2` and so on. */
function markdownAnchors(markdown) {
  const anchors = new Set();
  const repeats = new Map();
  for (const heading of markdownHeadings(markdown)) {
    const base = slug(heading);
    let anchor = base;
    if (anchors.has(base)) {
      let count = repeats.get(base) ?? 0;
      do {
        count += 1;
        anchor = `${base}-${count}`;
      } while (anchors.has(anchor));
      repeats.set(base, count);
    }
    anchors.add(anchor);
  }
  return anchors;
}

/** The anchors of an HTML file: its `id` values, markup only (never inside `<script>` or `<style>`). */
const htmlAnchors = tokens => new Set(tokens.filter(token => token.type === 'open' && token.attrs.id !== undefined).map(token => token.attrs.id));

// ---------------------------------------------------------------- links

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const decodeUri = text => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** An href split into its path (query dropped) and its fragment (null when it has no `#`). */
function splitHref(href) {
  const hash = href.indexOf('#');
  const before = hash < 0 ? href : href.slice(0, hash);
  const query = before.indexOf('?');
  return { file: query < 0 ? before : before.slice(0, query), fragment: hash < 0 ? null : href.slice(hash + 1) };
}

/** The file a relative href names, taken against `dir`; null when the href is not a relative path to a file. */
function localFile(href, dir) {
  if (href === null) return null;
  const given = href.trim();
  if (given === '' || SCHEME.test(given) || given.startsWith('/') || given.startsWith('\\')) return null;
  const { file } = splitHref(given);
  return file === '' ? null : path.resolve(dir, decodeUri(file));
}

/**
 * Evidence targets, each read once: `{exists, ext, anchors, crumbs}` by
 * resolved path. `crumbs` is the hrefs of the `<a>` links inside a
 * `<nav class="crumbs">`, or null when the target holds no crumbs bar.
 */
function targetReader() {
  const cache = new Map();
  return file => {
    if (cache.has(file)) return cache.get(file);
    let target = { exists: false };
    try {
      if (fs.statSync(file).isFile()) {
        const text = fs.readFileSync(file, 'utf8');
        const ext = path.extname(file).toLowerCase();
        target = { exists: true, ext, anchors: new Set(), crumbs: null };
        if (ext === '.md') target.anchors = markdownAnchors(text);
        if (ext === '.html') {
          const tokens = tokenize(text);
          target.anchors = htmlAnchors(tokens);
          target.crumbs = crumbLinks(tokens);
        }
      }
    } catch {
      target = { exists: false };
    }
    cache.set(file, target);
    return target;
  };
}

/** The hrefs of the links inside every `<nav class="crumbs">`, or null when there is none. */
function crumbLinks(tokens) {
  let hrefs = null;
  let depth = 0;
  for (const token of tokens) {
    if (token.type === 'open' && token.name === 'nav' && !token.selfClosing) {
      if (depth > 0) depth += 1;
      else if (classes(token.attrs).includes('crumbs')) {
        depth = 1;
        hrefs ??= [];
      }
    } else if (token.type === 'close' && token.name === 'nav' && depth > 0) {
      depth -= 1;
    } else if (depth > 0 && token.type === 'open' && token.name === 'a' && token.attrs.href !== undefined) {
      hrefs.push(token.attrs.href);
    }
  }
  return hrefs;
}

const where = section => (section === null ? 'outside any section' : `in "${section}"`);

/** A section or answer header with no evidence link anywhere inside it. */
function blocksWithoutEvidence(page) {
  return page.blocks.filter(block => block.evidence === 0).map(block => ({
    code: 'section-without-evidence',
    message: block.heading === null ? `a ${block.kind} with no heading has no evidence link (a.evidence)` : `"${block.heading}" has no evidence link (a.evidence)`,
    section: block.heading,
  }));
}

/**
 * Every evidence link whose target is not a file beside the page, or whose
 * fragment is not an anchor of it; then every `.html` target whose crumbs bar
 * holds no link back to the page, once per target.
 */
function linkFindings(page, pageFile) {
  const findings = [];
  const reported = new Set();
  const add = finding => {
    const id = JSON.stringify([finding.code, finding.href, finding.section]);
    if (reported.has(id)) return;
    reported.add(id);
    findings.push(finding);
  };
  const read = targetReader();
  const backlinkTargets = new Map();
  const pageDir = path.dirname(pageFile);
  for (const link of page.evidence) {
    const section = sectionOf(link.block);
    const file = localFile(link.href, pageDir);
    if (file === null) {
      const message = link.href === null ? `an evidence link ${where(section)} has no href` : `the evidence link ${link.href} ${where(section)} is not a relative path to a file`;
      add({ code: 'evidence-target-missing', message, href: link.href, section });
      continue;
    }
    const target = read(file);
    if (!target.exists) {
      add({ code: 'evidence-target-missing', message: `the evidence link ${link.href} ${where(section)} names no readable file`, href: link.href, section });
      continue;
    }
    const { file: written, fragment } = splitHref(link.href.trim());
    if (fragment === null || fragment === '') {
      add({ code: 'evidence-anchor-missing', message: `the evidence link ${link.href} ${where(section)} names no section of its target (no fragment)`, href: link.href, section });
    } else if (!target.anchors.has(decodeUri(fragment))) {
      add({ code: 'evidence-anchor-missing', message: `the evidence link ${link.href} ${where(section)} names an anchor ${written} does not hold`, href: link.href, section });
    }
    if (target.ext === '.html' && !backlinkTargets.has(file)) backlinkTargets.set(file, { written, target });
  }

  const self = realpath(pageFile);
  for (const [file, { written, target }] of backlinkTargets) {
    if (target.crumbs === null) continue;
    const back = target.crumbs.some(href => {
      const resolved = localFile(href, path.dirname(file));
      return resolved !== null && realpath(resolved) === self;
    });
    if (!back) add({ code: 'backlink-missing', message: `${written} has a crumbs bar with no link back to this page`, href: written, section: null });
  }
  return findings;
}

/** Each external resource the page would load and each piece of raw mermaid it carries, once per kind and section. */
function containmentFindings(page) {
  const findings = [];
  const reported = new Set();
  const report = (code, items, describe) => {
    for (const item of items) {
      const section = sectionOf(item.block);
      const id = JSON.stringify([code, item.what, section]);
      if (reported.has(id)) continue;
      reported.add(id);
      findings.push({ code, message: describe(item.what, section), section });
    }
  };
  report('external-resource', page.resources, (what, section) => `${what} ${where(section)} loads from outside the page`);
  report('raw-mermaid', page.mermaid, (what, section) => `${what} ${where(section)} is raw mermaid, which never renders here; draw the diagram instead`);
  return findings;
}

// ---------------------------------------------------------------- the check

/** Every figure on the page that no source states, once per figure and section. */
function untracedFigures(page, stated) {
  const findings = [];
  const reported = new Set();
  let figures = 0;
  for (const chunk of page.chunks) {
    for (const figure of figuresIn(chunk.text)) {
      figures += 1;
      if (stated.has(figure.key)) continue;
      const section = sectionOf(chunk.block);
      const id = JSON.stringify([figure.written, section]);
      if (reported.has(id)) continue;
      reported.add(id);
      findings.push({ code: 'untraced-number', message: `${figure.written} ${where(section)} is stated by no source`, figure: figure.written, section });
    }
  }
  return { figures, findings };
}

function check(flags) {
  const pageFile = path.resolve(flags.page);
  const html = readText(pageFile, `the page ${flags.page}`);
  const stated = statedFigures(flags.sources, pageFile);
  const page = readHtml(tokenize(html));
  const { figures, findings: untraced } = untracedFigures(page, stated);
  const findings = [...untraced, ...blocksWithoutEvidence(page), ...linkFindings(page, pageFile), ...containmentFindings(page)];
  return {
    ok: findings.length === 0,
    page: flags.page,
    sources: flags.sources,
    figures,
    sections: page.blocks.length,
    evidence_links: page.evidence.length,
    findings,
  };
}

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) return unexpected(error);
    process.stderr.write(`check-explainer: ${error.message}\n${USAGE}\n`);
    return EXIT.INTERNAL;
  }
  let result;
  try {
    result = check(flags);
  } catch (error) {
    if (!(error instanceof ReadError)) return unexpected(error);
    process.stderr.write(`check-explainer: ${error.message}\n${USAGE}\n`);
    return EXIT.INTERNAL;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? EXIT.OK : EXIT.FINDINGS;
}

/** An error the check did not expect ends the run as one that could not run, never as findings. */
function unexpected(error) {
  const message = String(error?.message ?? error).split('\n')[0];
  process.stderr.write(`check-explainer: unexpected error: ${message}\n`);
  return EXIT.INTERNAL;
}

process.exitCode = main();
