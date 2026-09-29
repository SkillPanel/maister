/**
 * The display data: what a viewer draws beside a node and what it calls it.
 *
 * A definition's top-level `display:` block carries two sub-maps, each keyed by
 * node id: `icons`, one of the seven hints a viewer knows how to draw, and
 * `titles`, the words an operator reads in place of the id. Neither is graph
 * data. Both stay outside the canonical node list and therefore outside the
 * hash, so correcting a glyph or a title moves no frozen run and no chain.
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

/**
 * The display a resolved graph carries: `{icons, titles}`, each a null-prototyped
 * map of node id to value.
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
  }
  return { icons, titles };
}

function docOf(source) {
  if (!isMap(source)) return null;
  return isMap(source.doc) ? source.doc : Object.hasOwn(source, 'doc') ? null : source;
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
