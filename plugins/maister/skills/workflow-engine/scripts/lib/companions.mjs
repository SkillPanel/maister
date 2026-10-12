/**
 * The HTML companions a definition owes: which markdown artifacts of which
 * nodes get an `.html` sibling written beside them.
 *
 * A definition's top-level `html_companions:` block maps a node id to a list of
 * that node's artifact keys — the names it declares under `outputs.artifacts`.
 * The list says which of the node's markdown files a reader is meant to open in
 * a browser; the writer of the `.html` follows from how the node runs and is
 * never declared. Left to prose, which files owe a companion is a sentence a
 * model may skip, and a file nobody wrote is noticed by nobody: the run closes
 * with a markdown report and no page beside it. Declared, the list is something
 * a check can hold a completed node to.
 *
 * It is a top-level block and not a node field for the reason `display:` is
 * one: a node field enters the canonical node list and the graph hash, and
 * deciding that one more report deserves a page would then move every frozen
 * sub-run child and dispatched chain built on the definition. Nothing here is
 * graph data. A run executes the same nodes in the same order whatever the block
 * says.
 *
 * This module is separate from `display.mjs` on purpose. Display is cosmetic and
 * forgiving by design; what a node owes feeds checks that report a missing file,
 * and none of them may depend on how a phase is drawn.
 *
 * Pure: no filesystem, no clock. Zero dependencies, `node:` builtins only,
 * Node >= 20.
 */

/** The characters an artifact key may not carry: it is one line, as every key is. */
const KEY_BREAKS = /[\r\n\t]/;

/** Whether `value` is an artifact key a reader may use: a non-empty one-line string. */
export function isArtifactKey(value) {
  return typeof value === 'string' && value.trim() !== '' && !KEY_BREAKS.test(value);
}

/**
 * Whether `value` is a list the merge takes: an array of artifact keys, none of
 * them twice. Anything else is malformed and contributes nothing — neither its
 * keys nor a clear — because a half-taken list would owe files nobody named.
 */
export function isCompanionList(value) {
  return Array.isArray(value) && value.every(isArtifactKey) && new Set(value).size === value.length;
}

/**
 * The merged block a resolved graph carries: a null-prototype map from node id
 * to the list of artifact keys that node owes a companion for.
 *
 * Base first, then each overlay's own block in order, then the block of each
 * overlay's selected profile — the order the resolver applies operations in, so
 * an overlay can declare companions for the nodes it adds and change the
 * base's, and a profile has the last word. A later list replaces the earlier
 * one for its node whole; an empty list clears the node, which then owes
 * nothing and is left out of the map.
 *
 * Values are filtered here as well as in the validator: the validator guards
 * what an author writes and this guards what a reader is handed, and an ejected
 * or hand-edited definition passes through only one of the two. A malformed
 * block, or a malformed list, contributes nothing rather than failing the
 * reader.
 *
 * Nothing is dropped for a node the graph does not carry: whether a node exists
 * is the folded definition's answer, and `owedCompanions` asks it.
 *
 * `definition` and each overlay are the `{file, doc}` pairs the reader returns;
 * a bare document is accepted too.
 */
export function companionsOf({ definition = null, overlays = [], profile = null } = {}) {
  const merged = Object.create(null);
  const blocks = [docOf(definition)?.html_companions];
  for (const overlay of overlays) blocks.push(docOf(overlay)?.html_companions);
  if (profile !== null) {
    for (const overlay of overlays) {
      const profiles = docOf(overlay)?.profiles;
      if (isMap(profiles) && isMap(profiles[profile])) blocks.push(profiles[profile].html_companions);
    }
  }
  for (const block of blocks) {
    if (!isMap(block)) continue;
    for (const [id, keys] of Object.entries(block)) {
      if (!isCompanionList(keys)) continue;
      if (keys.length === 0) delete merged[id];
      else merged[id] = [...keys];
    }
  }
  return merged;
}

/**
 * What `nodeId` owes, in declaration order: one `{key, md, html}` per listed key
 * whose declared artifact is a literal path ending in `.md`, with `html` that
 * path's `.html` sibling. Paths stay as the definition declares them — relative
 * to the task directory the node writes into.
 *
 * `definition` is the folded document a run executes (`foldDefinition`), so a
 * node an overlay added is found and one it disabled is not. A key the node does
 * not declare, and a path that is not markdown, owe nothing here: the validator
 * warns about both, and a run is never held to a file it cannot name.
 */
export function owedCompanions({ merged = null, definition = null } = {}, nodeId) {
  const keys = merged && Object.hasOwn(merged, nodeId) ? merged[nodeId] : null;
  if (!Array.isArray(keys)) return [];
  const nodes = isMap(definition?.nodes) ? definition.nodes : {};
  const artifacts = isMap(nodes[nodeId]) && isMap(nodes[nodeId].outputs) && isMap(nodes[nodeId].outputs.artifacts)
    ? nodes[nodeId].outputs.artifacts
    : {};
  const owed = [];
  for (const key of keys) {
    if (!Object.hasOwn(artifacts, key)) continue;
    const md = artifacts[key];
    if (!isMarkdown(md)) continue;
    owed.push({ key, md, html: `${md.slice(0, -'.md'.length)}.html` });
  }
  return owed;
}

/** Whether a declared artifact path is a literal markdown file, the one kind a companion is written for. */
export function isMarkdown(value) {
  return typeof value === 'string' && value.endsWith('.md') && value.length > '.md'.length;
}

function docOf(source) {
  if (!isMap(source)) return null;
  return isMap(source.doc) ? source.doc : Object.hasOwn(source, 'doc') ? null : source;
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
