/**
 * The display data: what a viewer draws beside a node and what it calls it.
 *
 * A definition's top-level `display:` block carries four sub-maps: `icons`, one
 * of the seven hints a viewer knows how to draw, and `titles`, the words an
 * operator reads in place of the id, each keyed by node id; `option_labels`,
 * keyed by gate id and then option id, the words an operator picks in place of
 * an option id; and `headers`, keyed by gate id, the short chip a picker shows
 * above a gate's question. None is graph data. All stay outside the canonical
 * node list and therefore outside the hash, so correcting a glyph, a title or a
 * label moves no frozen run and no chain. An answer is still recorded by its
 * option id: a label is only what the operator reads.
 *
 * Every reader that shows a node to a person goes through this module — the
 * dashboard projection, the gate brief, the diagram — so the merge order and
 * the fallback exist once. Two copies of "what is this node called" would let
 * the dashboard and the gate question name one phase two ways.
 *
 * Pure: no filesystem, no clock. Zero dependencies, `node:` builtins only,
 * Node >= 20.
 */

/**
 * The icon hints a viewer knows how to draw, in the order the prose tables list
 * them. The validator refuses anything else and the projection filters to them,
 * so both read this one list.
 */
export const ICON_HINTS = ['analysis', 'spec', 'plan', 'code', 'verify', 'docs', 'done'];

/**
 * The characters a title may not carry. A title is one line: the gate brief's
 * `--oneline` form is carried by a flow-safe state value, and a line break in a
 * title would end a line the brief's grammar owns.
 */
export const TITLE_BREAKS = /[\r\n\t]/;

/** The most characters a gate header may carry: the width of a picker's chip. */
export const HEADER_MAX = 12;

/**
 * A node id made readable: dashes become spaces and every word is capitalized,
 * so `gap-analysis` reads `Gap Analysis`. The fallback for any node the
 * definition gives no title — a definition of your own is valid without one.
 */
export function humanize(id) {
  return String(id)
    .split('-')
    .filter(word => word !== '')
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** The title a reader shows for `id`: the definition's own, else the humanized id. */
export function titleOf(titles, id) {
  return titles && Object.hasOwn(titles, id) ? titles[id] : humanize(id);
}

/** Whether a title value is one a reader may show: a non-empty, one-line string. */
export function isTitle(value) {
  return typeof value === 'string' && value.trim() !== '' && !TITLE_BREAKS.test(value);
}

/** Whether a header value is one a picker can show whole: a title within `HEADER_MAX`. */
export function isHeader(value) {
  return isTitle(value) && [...value].length <= HEADER_MAX;
}

/**
 * An option id made readable as a choice: dashes become spaces and only the
 * first word is capitalized, so `continue-past-analysis` reads `Continue past
 * analysis`. The fallback for any option the definition gives no label.
 */
export function sentence(id) {
  const words = String(id).split('-').filter(word => word !== '');
  if (!words.length) return '';
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

/** The label a picker shows for `option` of `gate`: the definition's own, else the readable id. */
export function labelOf(labels, gate, option) {
  const own = labels && Object.hasOwn(labels, gate) ? labels[gate] : null;
  return own && Object.hasOwn(own, option) ? own[option] : sentence(option);
}

/**
 * The header a picker shows above `gate`'s question: the definition's own; else
 * the title of the node the gate closes, when it fits; else the gate's own
 * title cut to fit. Never longer than `HEADER_MAX`.
 */
export function headerOf({ headers, titles }, gate, closing = null) {
  if (headers && Object.hasOwn(headers, gate)) return headers[gate];
  if (closing !== null) {
    const title = titleOf(titles, closing);
    if ([...title].length <= HEADER_MAX) return title;
  }
  const own = [...titleOf(titles, gate)];
  return own.length <= HEADER_MAX ? own.join('') : `${own.slice(0, HEADER_MAX - 1).join('').trimEnd()}…`;
}

/**
 * The display a resolved graph carries: `{icons, titles, option_labels,
 * headers}`, each a null-prototyped map keyed by node id — `option_labels` one
 * level deeper, by option id, and merged option by option, so an overlay can
 * relabel one option of a gate and keep the base's label for the other.
 *
 * Base first, then each overlay's own `display:`, then the `display:` of each
 * overlay's selected profile — the order the resolver applies operations in, so
 * an overlay can title the nodes it adds and retitle the base's, and a profile
 * has the last word. Later entries win, key by key.
 *
 * Values are filtered here as well as in the validator: the validator guards
 * what an author writes and this guards what a reader is handed, and an ejected
 * or hand-edited definition passes through only one of the two. A malformed
 * block contributes nothing rather than failing the reader.
 *
 * `definition` and each overlay are the `{file, doc}` pairs the reader returns;
 * a bare document is accepted too.
 */
export function displayOf({ definition = null, overlays = [], profile = null } = {}) {
  const icons = Object.create(null);
  const titles = Object.create(null);
  const labels = Object.create(null);
  const headers = Object.create(null);
  const blocks = [docOf(definition)?.display];
  for (const overlay of overlays) blocks.push(docOf(overlay)?.display);
  if (profile !== null) {
    for (const overlay of overlays) {
      const profiles = docOf(overlay)?.profiles;
      if (isMap(profiles) && isMap(profiles[profile])) blocks.push(profiles[profile].display);
    }
  }
  for (const block of blocks) {
    if (!isMap(block)) continue;
    for (const [id, hint] of Object.entries(isMap(block.icons) ? block.icons : {})) {
      if (typeof hint === 'string' && ICON_HINTS.includes(hint)) icons[id] = hint;
    }
    for (const [id, title] of Object.entries(isMap(block.titles) ? block.titles : {})) {
      if (isTitle(title)) titles[id] = title;
    }
    for (const [gate, options] of Object.entries(isMap(block.option_labels) ? block.option_labels : {})) {
      if (!isMap(options)) continue;
      for (const [option, label] of Object.entries(options)) {
        if (!isTitle(label)) continue;
        labels[gate] ??= Object.create(null);
        labels[gate][option] = label;
      }
    }
    for (const [gate, header] of Object.entries(isMap(block.headers) ? block.headers : {})) {
      if (isHeader(header)) headers[gate] = header;
    }
  }
  return { icons, titles, option_labels: labels, headers };
}

function docOf(source) {
  if (!isMap(source)) return null;
  return isMap(source.doc) ? source.doc : Object.hasOwn(source, 'doc') ? null : source;
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
