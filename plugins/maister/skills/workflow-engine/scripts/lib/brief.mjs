/**
 * The `brief:` block a definition carries, merged: per node, the data a node's
 * brief prints beside its prose — the artifacts it may leave unwritten and
 * why, its recovery budget and the `with:` values that recommend a continue
 * option. A question's default is not here: it is stated once, in the
 * Without line of the node's section.
 *
 * Why it exists: each of these was a sentence or a table row in a node's prose,
 * where a step had to find it and a check could not hold anyone to it. As
 * declared data it is printed the same way for every node of every workflow,
 * and an overlay can change one key without rewriting the prose.
 *
 * It is a top-level block and not a node field for the reason `html_companions:`
 * is one (`companions.mjs`): a node field enters the canonical node list and the
 * graph hash, and a run whose only change is a recovery budget is the same
 * executable graph. `resolve` never prints it.
 *
 * What it drops: a value not of its key's shape (`briefValueProblems`, the rule
 * the validator holds an author to), a key outside `BRIEF_KEYS`, an entry or a
 * block that is not a mapping, and every entry of a node an overlay or the
 * selected profile disabled. A drop is silent here — the validator is where an
 * author hears of it — and never throws, because an ejected or hand-edited
 * definition reaches a reader without passing the validator.
 *
 * Zero dependencies beyond the engine's own modules, `node:` builtins only,
 * Node >= 20.
 */

import { BRIEF_KEYS, briefValueProblems } from './graph.mjs';
import { sourcesOf } from './state.mjs';

/**
 * The merged block: a null-prototype map from node id to a null-prototype entry
 * holding the brief keys that survived the merge.
 *
 * Base first, then each overlay's own block in order, then the block of each
 * overlay's selected profile — the order the resolver applies operations in.
 * Merging is node by node and key by key: a later key replaces the earlier one,
 * a key set to `null` removes it, and a node's entry set to `null` removes the
 * entry. An entry left with no key is left out. A node any overlay or the
 * selected profile disables yields nothing.
 *
 * `definition` and each overlay are the `{file, doc}` pairs the reader returns;
 * a bare document is accepted too.
 */
export function briefOf({ definition = null, overlays = [], profile = null } = {}) {
  const merged = Object.create(null);
  const blocks = [docOf(definition)?.brief];
  const disabled = new Set();
  const layers = Array.isArray(overlays) ? overlays : [];
  for (const overlay of layers) {
    blocks.push(docOf(overlay)?.brief);
    collectDisabled(docOf(overlay)?.disable, disabled);
  }
  if (profile !== null) {
    for (const overlay of layers) {
      const profiles = docOf(overlay)?.profiles;
      if (!isMap(profiles) || !isMap(profiles[profile])) continue;
      blocks.push(profiles[profile].brief);
      collectDisabled(profiles[profile].disable, disabled);
    }
  }
  for (const block of blocks) {
    if (!isMap(block)) continue;
    for (const [id, entry] of Object.entries(block)) {
      if (entry === null) {
        delete merged[id];
        continue;
      }
      if (!isMap(entry)) continue;
      const into = merged[id] ?? Object.create(null);
      for (const key of BRIEF_KEYS) {
        if (!Object.hasOwn(entry, key)) continue;
        if (entry[key] === null) delete into[key];
        else if (briefValueProblems(key, entry[key]).length === 0) into[key] = structuredClone(entry[key]);
      }
      if (Object.keys(into).length === 0) delete merged[id];
      else merged[id] = into;
    }
  }
  for (const id of disabled) delete merged[id];
  return merged;
}

/**
 * The merged block of the definition a run froze, with the overlays and the
 * profile it recorded, read by the same `sourcesOf` `companionsOfRun` reads
 * them by. An overlay that cannot be read is left out of the merge. Null when
 * no definition is found or the base cannot be read, so a caller can tell
 * "nothing to print" from "cannot say". A caller that has already read the
 * sources passes them as `read`.
 */
export function briefOfRun(doc, runDir, read = undefined) {
  try {
    const workflow = isMap(doc?.workflow) ? doc.workflow : {};
    const sources = read !== undefined ? read : sourcesOf(workflow, runDir);
    if (sources === null || !isMap(sources.definition?.doc)) return null;
    return briefOf({ ...sources, overlays: sources.overlays.filter(overlay => isMap(overlay.doc)) });
  } catch {
    return null;
  }
}

function collectDisabled(list, into) {
  if (!Array.isArray(list)) return;
  for (const id of list) if (typeof id === 'string') into.add(id);
}

function docOf(source) {
  if (!isMap(source)) return null;
  return isMap(source.doc) ? source.doc : Object.hasOwn(source, 'doc') ? null : source;
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
