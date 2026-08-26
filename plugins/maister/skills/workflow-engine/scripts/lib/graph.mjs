/**
 * The workflow validator, the overlay resolver and the graph hash.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. The reader next door
 * answers what the document said; this module answers what the document is
 * allowed to say, what it means once every overlay has been folded in, and what
 * identity the resulting graph has.
 *
 * Three decisions shape everything below.
 *
 * **Warn where a static check cannot decide, error where it can.** A `skill:`,
 * `agent:` or `direct:` target that does not resolve is a run that will fail on
 * its first step, so it is an error. A `workflow:` target that does not resolve
 * may still be provided by a workspace the validator cannot see, so it is a
 * warning. A declared value output typed `bool`, `id` or `enum` is provably
 * safe to carry through a one-line flow map; one typed `string` is not provably
 * unsafe either, so it is a warning. Loosening the strict half to keep the
 * undecidable half quiet is the silent-failure class this module exists to
 * prevent, and the two halves are kept apart deliberately.
 *
 * **Validation runs on the resolved graph, not on the file.** Overlays are
 * folded in first, so a check reads the nodes that will actually execute rather
 * than the ones that happen to be typed in the base. The frozen order is base,
 * then `disable`, then `tune`, then `add`, then the selected profile.
 *
 * **The hash covers the node set and nothing else.** Provenance — where the
 * definition came from, which overlays were applied, which profile was chosen,
 * what the document calls itself — is deliberately outside it, because the same
 * graph reached by an overlay and by a hand-written eject must carry one
 * identity. If provenance entered the hash the two routes could never agree,
 * and comparing them would be meaningless.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeOf } from './definition.mjs';

// ---------------------------------------------------------------------------
// the closed vocabularies
// ---------------------------------------------------------------------------

/** Node ids reach file names and markers, so the character set is closed. */
const NODE_ID = /^[a-z][a-z0-9-]{1,40}$/;

/** Gate option ids are recorded verbatim in state, under the same rule. */
const OPTION_ID = /^[a-z][a-z0-9-]*$/;

/** Exactly one reference, optionally negated. There is no expression language. */
const WHEN_REF = /^!?\$\{(inputs|[a-z][a-z0-9-]*)\.(values\.)?[a-z_]+\}$/;

/** Every `${…}` occurrence inside a `with` value, wherever it is nested. */
const INTERPOLATION = /\$\{([^}]*)\}/g;

/**
 * A workflow, a skill, an agent or a prose section, named. The set is closed
 * because every one of these names reaches a file path, and a name carrying `/`
 * or `..` would drive a filesystem lookup outside the plugin root on nothing
 * but the word of an operator-supplied definition.
 */
const TARGET_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * The prefix a built-in workflow is named with. Both `builtin:<name>` and a bare
 * `<name>` denote the same workflow: the prefix says where the name is expected
 * to resolve, not what the file is called. It is stripped before any lookup —
 * a `builtin:research.yml` on disk would additionally be an illegal filename on
 * Windows.
 */
const BUILTIN_PREFIX = 'builtin:';

/**
 * What an overlay's `extends` may name: a built-in, a bare workflow name, or a
 * relative path to a definition file. The path alternative carries a YAML suffix
 * so a typo, a wrong casing or a stray directory is refused here rather than
 * silently accepted and then applied to whatever base the caller happened to
 * supply.
 */
const BASE_REF = /^(?:builtin:)?[a-z][a-z0-9-]*$|^[^/].*\.ya?ml$/;

/** The four target schemes. The list is closed; anything else is an error. */
const SCHEMES = ['skill', 'agent', 'direct', 'workflow'];

/** The only three node fields an overlay may tune. `uses` is immutable by design. */
const TUNABLE = ['with', 'optional', 'provider'];

/** The declared value types a static check can prove flow-safe. */
const FLOW_SAFE_TYPES = ['bool', 'id'];

/**
 * Contract R. Matched by dotted-path suffix, which is why the shipped graph may
 * not name a node or a key after one of them: a node id that matched would be
 * warned about, correctly, as a reserved occurrence. The three value-qualified
 * entries are carried by their key half only — the warning names the key a later
 * version will claim, not the value that happened to be written under it.
 */
const RESERVED_PATHS = [
  'foreach',
  'loop',
  'assertions',
  'validation',
  'session.substrate',
  'mirror.scope',
  'backing',
  'routing.tiers',
];

/**
 * The canonical key order for a resolved node, and the recognised half of what
 * the hash covers — the unrecognised half follows it, sorted. Absent keys are
 * omitted rather than emitted null, so adding an optional field to a definition
 * that does not use it cannot move the hash.
 *
 * `ask` and `options` are in here because they are what makes a gate a gate: the
 * question an operator answers, and the option id that is recorded in state and
 * decides continue-from-stop. A hash blind to them would call two graphs the
 * same while they asked different questions and stopped on different answers.
 */
const NODE_KEYS = [
  'id', 'uses', 'needs', 'when', 'with', 'outputs', 'type', 'ask', 'options', 'on', 'dir', 'provider', 'optional',
];

/** The warning vocabulary, so no call site spells a prefix by hand. */
const WARN = {
  reservedKey: (suffix) => `reserved-key:${suffix}`,
  unresolved: (node, target) => `unresolved-reference:${node}:${target}`,
  valueType: (path) => `undecidable-value-type:${path}`,
};

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

/**
 * Validate a definition, a set of overlays, or both.
 *
 * `mode` is decided by the caller from what was supplied and is not re-derived
 * here. In `standalone` mode the overlays are judged on their own shape and the
 * base is never looked for — which is the only way an overlay over a workflow
 * this build does not ship can be checked at all. In `resolved` mode the full
 * order applies on top: base-node existence, `uses` immutability and the `tune`
 * whitelist all become reachable because there is a base to compare against.
 */
export function validate({ definition, overlays = [], profile = null, mode = 'resolved' }) {
  return inspect({ definition, overlays, profile, mode }).report;
}

/**
 * The one pass both entry points read. It returns the report and the graph that
 * report was made about, so `resolve` hashes exactly what was validated rather
 * than building a second graph whose own findings nothing would ever look at.
 */
function inspect({ definition, overlays, profile, mode }) {
  const errors = [];
  const warnings = [];

  for (const overlay of overlays) {
    checkOverlayShape(overlay, errors);
    scanReserved(overlay.doc, warnings);
  }

  if (mode === 'standalone') {
    return { report: { ok: errors.length === 0, errors, warnings, degraded: [] }, graph: null };
  }

  for (const overlay of overlays) checkOverlayBase(overlay, definition, errors);
  scanReserved(definition?.doc, warnings);
  const graph = buildGraph({ definition, overlays, profile, errors });
  if (graph) checkGraph(graph, errors, warnings);
  return { report: { ok: errors.length === 0, errors, warnings, degraded: [] }, graph };
}

/**
 * Resolve a definition and its overlays into the canonical graph plus its hash.
 *
 * A graph that does not validate is never hashed: an identity for a document
 * that cannot run would be a value callers could compare and act on, and the
 * whole point of the hash is that two things carrying the same one are the same
 * executable graph.
 */
export function resolve({ definition, overlays = [], profile = null, degraded = [] }) {
  const provenance = {
    name: definition?.doc?.name ?? null,
    source: definition?.file ?? null,
    overlays: overlays.map((overlay) => overlay.file),
    profile,
  };

  // A degraded document declares a format whose grammar this build does not
  // know, so the checks below — which describe exactly one grammar — do not
  // apply to it. It is folded, canonicalized and hashed on its structure alone.
  // `validate` runs this same call on the same input, so the two verbs agree
  // because they are one code path, not because two of them were written to
  // match.
  //
  // The structural pass finds things even here — a missing `nodes`, an overlay
  // `disable` naming a node the base does not declare — and every one of them
  // is returned. Returning a graph and dropping the errors beside it is the
  // silently-ignored `disable` that `applyOps` exists to make impossible.
  if (degraded.length) {
    const errors = [];
    const graph = buildGraph({ definition, overlays, profile, errors });
    if (!graph || errors.length) {
      return { ok: false, errors, warnings: [], ...provenance, degraded, graph_hash: null, nodes: [] };
    }
    const folded = canonicalNodes(graph);
    return { ok: true, errors: [], warnings: [], ...provenance, degraded, graph_hash: hashNodes(folded), nodes: folded };
  }

  const { report, graph } = inspect({ definition, overlays, profile, mode: 'resolved' });
  if (!report.ok) return { ...report, ...provenance, degraded, graph_hash: null, nodes: [] };

  const nodes = canonicalNodes(graph);
  return {
    ok: true,
    errors: [],
    warnings: report.warnings,
    degraded,
    ...provenance,
    graph_hash: hashNodes(nodes),
    nodes,
  };
}

// ---------------------------------------------------------------------------
// located errors
// ---------------------------------------------------------------------------

/**
 * Every rejection carries `{file, node, path, message}` — the same shape the
 * reader produces, so a caller renders one error vocabulary rather than two.
 */
function fail(errors, file, dotted, message, node = undefined) {
  errors.push({ file, node: node === undefined ? nodeFor(dotted) : node, path: dotted, message });
}

/**
 * The node a path sits under. The reader knows the definition half; overlay
 * paths name their node one segment into `add` or `tune` instead.
 */
function nodeFor(dotted) {
  const parts = String(dotted).split('.');
  if ((parts[0] === 'add' || parts[0] === 'tune') && parts.length >= 2) return parts[1];
  return nodeOf(dotted);
}

// ---------------------------------------------------------------------------
// the plugin root, and reference resolution against it
// ---------------------------------------------------------------------------

/**
 * Where `skill:`, `agent:` and `workflow:` targets are looked up. Read at call
 * time rather than at import time so a caller can point it at another tree, and
 * derived from this file's own location when the environment says nothing —
 * which is the normal case, since the engine is invoked by absolute path.
 *
 * Rooting resolution here is what makes one shipped definition correct under
 * every generated variant: the skill and agent directory names are unprefixed
 * everywhere, so a bare target name resolves without a rewrite pass.
 */
function pluginRoot() {
  const declared = process.env.CLAUDE_PLUGIN_ROOT;
  if (declared) return declared;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..');
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether the prose companion beside a definition carries a section for a node.
 * `direct:` nodes are executed by the engine itself from that section, so a
 * missing one is a node with no implementation at all.
 *
 * The heading must *be* the node id, not mention it: a section titled "Notes on
 * assess-scope failure modes" is prose about the node, and accepting it would
 * report an implementation that is not there.
 */
function hasProseSection(file, name) {
  if (!file) return false;
  const companion = file.replace(/\.ya?ml$/i, '.md');
  if (companion === file || !isFile(companion)) return false;
  const text = fs.readFileSync(companion, 'utf8');
  for (const row of text.split('\n')) {
    const line = row.replace(/\r$/, '');
    if (!line.startsWith('#')) continue;
    const heading = line.replace(/^#+\s*/, '').replace(/`/g, '').trim();
    if (heading === name) return true;
  }
  return false;
}

/**
 * Resolve one node target. Returns null when it resolves, a message when it is
 * an error, and `{warning}` when it is undecidable — the `workflow:` case,
 * whose target may be provided by a workspace eject or overlay this static
 * check cannot see.
 */
function resolveTarget(uses, origin) {
  const at = String(uses).indexOf(':');
  const scheme = at < 0 ? '' : uses.slice(0, at);
  const written = at < 0 ? '' : uses.slice(at + 1);
  if (!SCHEMES.includes(scheme) || written === '') {
    return { message: `"${uses}" is not a target: expected one of ${SCHEMES.map((each) => `${each}:`).join(' ')}` };
  }
  // The name is checked against the closed set before it reaches path.join, and
  // an unnameable target is an error under every scheme — including the sub-run
  // scheme, whose warning would otherwise present a traversal as an ordinary
  // reference this build cannot see.
  const name = scheme === 'workflow' ? bareWorkflowName(written) : written;
  if (name === null || !TARGET_NAME.test(name)) {
    return { message: `"${written}" is not a ${scheme} name: expected ${TARGET_NAME.source}` };
  }
  const root = pluginRoot();
  if (scheme === 'skill') {
    return isDirectory(path.join(root, 'skills', name)) ? null : { message: `no skill named "${name}" is available` };
  }
  if (scheme === 'agent') {
    return isFile(path.join(root, 'agents', `${name}.md`)) ? null : { message: `no agent named "${name}" is available` };
  }
  if (scheme === 'direct') {
    return hasProseSection(origin, name) ? null : { message: `the prose companion carries no section for "${name}"` };
  }
  const builtin = path.join(root, 'skills', 'workflow-engine', 'workflows', `${name}.yml`);
  return isFile(builtin) ? null : { warning: true };
}

/**
 * A workflow named either way, reduced to the one form a lookup can use. Callers
 * that resolve a workflow by name go through here so that `builtin:research` and
 * `research` cannot diverge, and so the prefix never reaches a file path.
 */
export function bareWorkflowName(ref) {
  const written = String(ref);
  const bare = written.startsWith(BUILTIN_PREFIX) ? written.slice(BUILTIN_PREFIX.length) : written;
  return TARGET_NAME.test(bare) ? bare : null;
}

// ---------------------------------------------------------------------------
// reserved keys
// ---------------------------------------------------------------------------

/** One warning per occurrence, in document order, carrying the key half only. */
function scanReserved(doc, warnings) {
  walk(doc, '');

  function walk(value, prefix) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, prefix === '' ? String(index) : `${prefix}.${index}`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const dotted = prefix === '' ? key : `${prefix}.${key}`;
      const reserved = RESERVED_PATHS.find((each) => dotted === each || dotted.endsWith(`.${each}`));
      if (reserved) warnings.push(WARN.reservedKey(reserved));
      walk(child, dotted);
    }
  }
}

// ---------------------------------------------------------------------------
// building the resolved graph
// ---------------------------------------------------------------------------

/**
 * Base, then every overlay body in order, then every selected profile — the
 * frozen order, with the profile last because it is chosen at invocation and
 * must be able to override what the overlay it lives in decided.
 *
 * Returns `{file, inputs, nodes, origins}` where `origins` records which file
 * each node came from. Origins never reach the canonical form or the hash; they
 * exist so an error can name the file the operator has to edit, and so a
 * `direct:` target is looked for beside the file that declared it.
 */
function buildGraph({ definition, overlays, profile, errors }) {
  if (!definition || !definition.doc || typeof definition.doc !== 'object') {
    fail(errors, definition?.file ?? null, '', 'the definition could not be read as a mapping');
    return null;
  }
  const file = definition.file;
  const doc = definition.doc;

  for (const key of ['name', 'version', 'nodes']) {
    if (doc[key] === undefined || doc[key] === null) fail(errors, file, key, `the required key "${key}" is missing`);
  }
  if (doc.nodes !== undefined && doc.nodes !== null && !isMap(doc.nodes)) {
    fail(errors, file, 'nodes', 'nodes must be a mapping of node id to node');
    return null;
  }

  const nodes = new Map();
  const origins = new Map();
  for (const [id, node] of Object.entries(isMap(doc.nodes) ? doc.nodes : {})) {
    if (!isMap(node)) {
      fail(errors, file, `nodes.${id}`, 'a node must be a mapping', id);
      continue;
    }
    nodes.set(id, { ...node });
    origins.set(id, file);
  }

  for (const overlay of overlays) applyOps(overlay.doc, overlay.file, '', { nodes, origins }, errors);
  for (const overlay of overlays) {
    if (profile === null || !isMap(overlay.doc?.profiles)) continue;
    const selected = overlay.doc.profiles[profile];
    if (!isMap(selected)) {
      fail(errors, overlay.file, `profiles.${profile}`, `the overlay declares no profile named "${profile}"`, null);
      continue;
    }
    applyOps(selected, overlay.file, `profiles.${profile}.`, { nodes, origins }, errors);
  }

  for (const [id, node] of nodes) scanControlCharacters(node, origins.get(id) ?? file, id, `nodes.${id}`, errors);

  return { file, inputs: isMap(doc.inputs) ? doc.inputs : {}, nodes, origins };
}

/**
 * The characters a resolved value may not carry, mirroring the state writer's
 * own refusal set.
 *
 * The reader decodes `\n`, `\t` and `\r` inside a double-quoted scalar, because
 * dropping the backslash would hand the validator a string the author never
 * wrote. That is correct for the reader and it manufactures a value the writer
 * is contractually required to refuse: a run that validated clean then dies
 * mid-node with `value-not-flow-safe`, halfway through a graph, with a state
 * file recording nodes that already ran. `"docs\reports"` is the realistic
 * trigger — a Windows-looking path in a `with:` or a `dir:`, where the `\r` was
 * never meant as an escape at all.
 *
 * So it is a validate-time rejection: the run fails before it starts, at the
 * line that carries the value, rather than in the middle of the graph.
 */
const CONTROL_CHARS = { '\n': 'a newline', '\r': 'a carriage return', '\t': 'a tab' };

function scanControlCharacters(value, file, id, dotted, errors) {
  if (typeof value === 'string') {
    for (const [char, name] of Object.entries(CONTROL_CHARS)) {
      if (!value.includes(char)) continue;
      fail(errors, file, dotted,
        `the value carries ${name}, which the one-line state writer refuses; write it without the escape`, id);
      return;
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanControlCharacters(item, file, id, `${dotted}.${index}`, errors));
    return;
  }
  if (isMap(value)) {
    for (const [key, item] of Object.entries(value)) {
      scanControlCharacters(item, file, id, `${dotted}.${key}`, errors);
    }
  }
}

/**
 * One overlay body, or one profile body: disable, then tune, then add. Each
 * operation names an existing node, and naming one that does not exist is a
 * hard error rather than a no-op — a silently ignored `disable` would leave the
 * operator with a graph they believe they trimmed.
 */
function applyOps(body, file, prefix, graph, errors) {
  if (!isMap(body)) return;
  const { nodes, origins } = graph;

  for (const [index, id] of (Array.isArray(body.disable) ? body.disable : []).entries()) {
    const dotted = `${prefix}disable.${index}`;
    if (!nodes.has(id)) {
      fail(errors, file, dotted, `disable names "${id}", which the base does not declare`, id);
      continue;
    }
    // Dependents inherit the removed node's own needs, so removing a link from
    // a chain closes the chain rather than orphaning everything downstream.
    const inherited = needsOf(nodes.get(id));
    nodes.delete(id);
    origins.delete(id);
    for (const node of nodes.values()) {
      if (!needsOf(node).includes(id)) continue;
      const rewired = [];
      for (const need of needsOf(node)) {
        for (const replacement of need === id ? inherited : [need]) {
          if (!rewired.includes(replacement)) rewired.push(replacement);
        }
      }
      node.needs = rewired;
    }
  }

  for (const [id, patch] of Object.entries(isMap(body.tune) ? body.tune : {})) {
    const dotted = `${prefix}tune.${id}`;
    if (!nodes.has(id)) {
      fail(errors, file, dotted, `tune names "${id}", which the base does not declare`, id);
      continue;
    }
    if (!isMap(patch)) {
      fail(errors, file, dotted, 'a tune entry must be a mapping', id);
      continue;
    }
    for (const key of Object.keys(patch)) {
      if (TUNABLE.includes(key)) continue;
      fail(errors, file, `${dotted}.${key}`, `only ${TUNABLE.join(', ')} may be tuned; "${key}" may not`, id);
    }
    const node = nodes.get(id);
    for (const key of TUNABLE) {
      if (patch[key] !== undefined) node[key] = patch[key];
    }
  }

  for (const [id, node] of Object.entries(isMap(body.add) ? body.add : {})) {
    const dotted = `${prefix}add.${id}`;
    if (nodes.has(id)) {
      // Adding over an existing id is the back door around uses-immutability,
      // so it is refused by name rather than merged.
      fail(errors, file, dotted, `add names "${id}", which the base already declares`, id);
      continue;
    }
    if (!isMap(node)) {
      fail(errors, file, dotted, 'an added node must be a mapping', id);
      continue;
    }
    if (needsOf(node).length === 0) {
      fail(errors, file, `${dotted}.needs`, 'an added node must attach to the graph through needs', id);
    }
    nodes.set(id, { ...node });
    origins.set(id, file);
  }
}

function needsOf(node) {
  return Array.isArray(node?.needs) ? node.needs : [];
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// the checks the schema leaves to the runner
// ---------------------------------------------------------------------------

function checkGraph(graph, errors, warnings) {
  const { file, inputs, nodes, origins } = graph;

  for (const id of nodes.keys()) {
    if (!NODE_ID.test(id)) fail(errors, file, 'nodes',
      `the node id "${id}" is outside the closed character set: lower-case letters, digits and dashes, `
      + 'starting with a letter, at least two characters and at most forty-one', id);
  }

  for (const [id, node] of nodes) {
    const at = `nodes.${id}`;
    const origin = origins.get(id) ?? file;
    if (node.needs !== undefined && !Array.isArray(node.needs)) {
      fail(errors, origin, `${at}.needs`, 'needs must be a sequence of node ids', id);
    }
    for (const [index, need] of needsOf(node).entries()) {
      if (!nodes.has(need)) fail(errors, origin, `${at}.needs.${index}`, `needs names "${need}", which no node declares`, id);
    }
    checkNodeShape(node, id, at, origin, errors);
    checkReference(node, id, at, origin, errors, warnings);
    checkDeclaredValues(node, at, origin, errors, warnings, id);
  }

  const closures = closuresOf(nodes);
  for (const [id, node] of nodes) {
    const origin = origins.get(id) ?? file;
    checkWhen(node, id, `nodes.${id}`, origin, errors, { inputs, nodes, closure: closures.get(id) });
    checkInterpolations(node, id, `nodes.${id}`, origin, errors, { inputs, nodes, closure: closures.get(id) });
  }

  const cycle = findCycle(nodes);
  if (cycle) {
    fail(errors, file, 'nodes', `needs forms a cycle: ${cycle.join(' -> ')}`, cycle[0]);
  }
}

/**
 * The gate rule and its mirror image. A gate runs nothing and must be able to
 * stop the run; a task node must name something to run. Both halves matter: a
 * gate that cannot stop is not a gate, and a node with no target is a step the
 * engine would silently skip.
 */
function checkNodeShape(node, id, at, file, errors) {
  if (node.type !== undefined && node.type !== 'gate') {
    fail(errors, file, `${at}.type`, `type is a closed enum whose only member is "gate"; "${node.type}" is not`, id);
    return;
  }
  if (node.type !== 'gate') {
    if (typeof node.uses !== 'string' || node.uses === '') {
      fail(errors, file, `${at}.uses`, 'a task node must name what it runs', id);
    }
    return;
  }

  if (node.uses !== undefined) fail(errors, file, `${at}.uses`, 'a gate runs nothing and may not carry uses', id);
  if (typeof node.ask !== 'string' || node.ask.trim() === '') {
    fail(errors, file, `${at}.ask`, 'a gate must carry the question it asks', id);
  }
  if (!isMap(node.options)) {
    fail(errors, file, `${at}.options`, 'a gate must offer options', id);
    return;
  }

  let continues = 0;
  let stops = 0;
  for (const [option, effect] of Object.entries(node.options)) {
    if (!OPTION_ID.test(option)) {
      fail(errors, file, `${at}.options.${option}`, `the option id "${option}" is outside the closed character set`, id);
    }
    if (effect === 'continue') continues++;
    else if (effect === 'stop') stops++;
    else fail(errors, file, `${at}.options.${option}`, `an option effect is "continue" or "stop", never "${effect}"`, id);
  }
  if (continues !== 1 || stops < 1) {
    fail(
      errors,
      file,
      `${at}.options`,
      `a gate offers exactly one continue and at least one stop; this one offers ${continues} and ${stops}`,
      id,
    );
  }
}

function checkReference(node, id, at, file, errors, warnings) {
  if (typeof node.uses !== 'string' || node.uses === '') return;
  const verdict = resolveTarget(node.uses, file);
  if (verdict === null) return;
  if (verdict.warning) warnings.push(WARN.unresolved(id, node.uses));
  else fail(errors, file, `${at}.uses`, verdict.message, id);
}

/**
 * The declared value types. `bool` and `id` are proven flow-safe by their token
 * alone; an `enum` is proven by its members. A bare `string` is the only token
 * a static check cannot decide, and undecidable is a warning here — the same
 * reasoning that makes an unresolvable `workflow:` target a warning.
 */
function checkDeclaredValues(node, at, file, errors, warnings, id) {
  const values = node.outputs?.values;
  if (values === undefined) return;
  if (!isMap(values)) {
    fail(errors, file, `${at}.outputs.values`, 'declared value outputs must be a mapping of name to type', id);
    return;
  }
  for (const [name, type] of Object.entries(values)) {
    const dotted = `${at}.outputs.values.${name}`;
    if (FLOW_SAFE_TYPES.includes(type)) continue;
    if (type === 'string') {
      warnings.push(WARN.valueType(dotted));
      continue;
    }
    if (isMap(type) && Array.isArray(type.enum) && type.enum.length > 0 && Object.keys(type).length === 1) {
      const bad = type.enum.find((member) => typeof member !== 'string' || member === '');
      if (bad === undefined) continue;
      fail(errors, file, dotted, 'every enum member must be a non-empty scalar', id);
      continue;
    }
    fail(errors, file, dotted, `a declared value type is bool, id, enum or string; ${describe(type)} is none of them`, id);
  }
}

function describe(value) {
  if (isMap(value)) return `{${Object.keys(value).join(', ')}}`;
  return `"${value}"`;
}

/**
 * A `when` clause names one boolean and nothing else. The reference must clear
 * the frozen pattern, must reach either a declared `bool` input or a declared
 * boolean value output, and — for the output case — that node must be inside
 * the guarded node's own `needs` closure, because a value the engine has not
 * necessarily produced yet cannot decide whether to run.
 */
function checkWhen(node, id, at, file, errors, scope) {
  if (node.when === undefined) return;
  const dotted = `${at}.when`;
  if (typeof node.when !== 'string' || !WHEN_REF.test(node.when)) {
    fail(errors, file, dotted, 'a when clause is exactly one reference, optionally negated', id);
    return;
  }
  const inner = node.when.replace(/^!/, '').slice(2, -1);
  const parts = inner.split('.');

  if (parts[0] === 'inputs') {
    const input = scope.inputs[parts[1]];
    if (!isMap(input)) fail(errors, file, dotted, `when names the input "${parts[1]}", which is not declared`, id);
    else if (input.type !== 'bool') fail(errors, file, dotted, `when needs a bool input; "${parts[1]}" is declared ${input.type}`, id);
    return;
  }
  if (parts[1] !== 'values') {
    fail(errors, file, dotted, 'when names a declared value output, never an artifact', id);
    return;
  }
  const source = scope.nodes.get(parts[0]);
  if (!source) {
    fail(errors, file, dotted, `when names "${parts[0]}", which no node declares`, id);
    return;
  }
  if (!scope.closure.has(parts[0])) {
    fail(errors, file, dotted, `when names "${parts[0]}", which is outside this node's needs closure`, id);
    return;
  }
  if (source.outputs?.values?.[parts[2]] !== 'bool') {
    fail(errors, file, dotted, `when needs a declared bool output; "${parts[0]}.values.${parts[2]}" is not one`, id);
  }
}

/**
 * Every `${…}` in a node's interpolated fields, however deeply nested. A
 * reference names a declared input or a declared output of a node inside the
 * referencing node's `needs` closure — nothing else can have been produced by
 * the time the node runs, so nothing else can be interpolated into it.
 *
 * `with` is the bulk of it, but not the whole: `dir` reaches a file path, `ask`
 * is read aloud to the operator and `on` decides whether the node runs at all.
 * A reference left unchecked in any of them interpolates to nothing at run time,
 * which is a silent wrong answer rather than a rejection.
 */
const INTERPOLATED_KEYS = ['with', 'dir', 'ask', 'on'];

function checkInterpolations(node, id, at, file, errors, scope) {
  for (const key of INTERPOLATED_KEYS) visit(node[key], `${at}.${key}`);

  function visit(value, dotted) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${dotted}.${index}`));
      return;
    }
    if (isMap(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, `${dotted}.${key}`);
      return;
    }
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(INTERPOLATION)) {
      const message = referenceProblem(match[1], scope);
      if (message) fail(errors, file, dotted, message, id);
    }
  }
}

function referenceProblem(inner, scope) {
  const parts = inner.split('.');
  if (parts[0] === 'inputs') {
    if (parts.length !== 2) return `"${inner}" is not an input reference`;
    return isMap(scope.inputs[parts[1]]) ? null : `"${inner}" names an input that is not declared`;
  }
  if (parts.length !== 3 || (parts[1] !== 'values' && parts[1] !== 'artifacts')) {
    return `"${inner}" is not a reference to a declared input or output`;
  }
  const source = scope.nodes.get(parts[0]);
  if (!source) return `"${inner}" names "${parts[0]}", which no node declares`;
  if (!scope.closure.has(parts[0])) return `"${inner}" names "${parts[0]}", which is outside this node's needs closure`;
  if (source.outputs?.[parts[1]]?.[parts[2]] === undefined) {
    return `"${inner}" names an output "${parts[0]}" does not declare`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// graph walks
// ---------------------------------------------------------------------------

/** For each node, the set of nodes reachable through `needs`, transitively. */
function closuresOf(nodes) {
  const closures = new Map();
  for (const id of nodes.keys()) {
    const seen = new Set();
    const pending = [...needsOf(nodes.get(id))];
    while (pending.length) {
      const next = pending.pop();
      if (seen.has(next) || !nodes.has(next)) continue;
      seen.add(next);
      pending.push(...needsOf(nodes.get(next)));
    }
    closures.set(id, seen);
  }
  return closures;
}

/**
 * The members of one cycle, or null. Reported as a path rather than as a set so
 * the operator can see which edge to cut; a self-edge comes back as the
 * degenerate one-member path.
 */
function findCycle(nodes) {
  const state = new Map();
  const stack = [];
  let found = null;

  for (const id of nodes.keys()) {
    if (!state.has(id)) descend(id);
    if (found) return found;
  }
  return null;

  function descend(id) {
    state.set(id, 'open');
    stack.push(id);
    for (const need of needsOf(nodes.get(id))) {
      if (!nodes.has(need) || found) continue;
      if (state.get(need) === 'open') {
        found = [...stack.slice(stack.indexOf(need)), need];
        return;
      }
      if (!state.has(need)) descend(need);
      if (found) return;
    }
    stack.pop();
    state.set(id, 'closed');
  }
}

// ---------------------------------------------------------------------------
// the canonical form and the hash
// ---------------------------------------------------------------------------

/**
 * Nodes in topological order with a lexicographic tie-break, each carrying its
 * keys in the fixed order and nothing that is absent. Two graphs that execute
 * identically serialize identically, whatever order their files were written
 * in — which is the whole basis of the hash.
 *
 * A key this build does not recognise is carried through after the known ones,
 * in sorted order, rather than dropped. A newer definition must resolve to the
 * document it declared — an engine that quietly discarded the half it did not
 * understand would hand a caller a graph missing exactly the fields that made
 * the definition newer, and would hash it as though they had never been written.
 *
 * `needs` is deduplicated and sorted for the same reason. It is a dependency
 * set, not a sequence: execution is driven by the ready set, so the order a
 * definition happens to list its predecessors in carries no meaning. Leaving it
 * alone would make an ejected graph and its overlay-resolved twin hash
 * differently over nothing but authoring order — and rewiring a disabled node's
 * dependents necessarily appends, so the two routes would essentially never
 * agree.
 */
function canonicalNodes(graph) {
  const ordered = topological(graph.nodes);
  return ordered.map((id) => {
    const node = graph.nodes.get(id);
    const canonical = {};
    for (const key of NODE_KEYS) {
      if (key === 'id') canonical.id = id;
      else if (key === 'needs') canonical.needs = [...new Set(needsOf(node))].sort();
      else if (node[key] !== undefined) canonical[key] = canonicalValue(node[key]);
    }
    for (const key of Object.keys(node).sort()) {
      if (NODE_KEYS.includes(key) || node[key] === undefined) continue;
      canonical[key] = canonicalValue(node[key]);
    }
    return canonical;
  });
}

/** Free-form values keep their content and lose their authoring key order. */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isMap(value)) return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonicalValue(value[key]);
  return sorted;
}

/**
 * A deterministic topological order. Quadratic in the node count, and cubic
 * counting the `ordered.includes` scan inside it — which is stated rather than
 * optimised: the graphs this runs on have nine nodes, and a Kahn queue here
 * would trade a readable ordering rule for a saving nothing can measure. Worth
 * revisiting only if a definition ever carries hundreds of nodes.
 */
function topological(nodes) {
  const remaining = new Map();
  for (const [id, node] of nodes) remaining.set(id, needsOf(node).filter((need) => nodes.has(need)));

  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, needs]) => needs.every((need) => ordered.includes(need)))
      .map(([id]) => id)
      .sort();
    // A cycle leaves nothing ready. Validation has already rejected the graph by
    // then; emitting the rest in name order keeps this function total rather
    // than letting it loop.
    const next = ready.length ? ready : [...remaining.keys()].sort();
    for (const id of ready.length ? [ready[0]] : [next[0]]) {
      ordered.push(id);
      remaining.delete(id);
    }
  }
  return ordered;
}

/**
 * The graph's identity. Provenance is excluded by construction: nothing outside
 * the canonical node list reaches this function, so there is no field to forget
 * to strip.
 */
function hashNodes(nodes) {
  return createHash('sha256').update(JSON.stringify(nodes), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// standalone overlay shape
// ---------------------------------------------------------------------------

/**
 * What can be checked about an overlay without its base: that it declares one,
 * and that its four operation blocks are internally well formed. Deliberately
 * no `extends` resolution — an overlay over a workflow this build does not ship
 * is still an overlay whose own shape can be wrong, and refusing to look at it
 * would leave that class of mistake undetectable. Whether the declared base is
 * the base the overlay was actually applied to is a resolved-mode question, and
 * `checkOverlayBase` below answers it.
 */
function checkOverlayShape(overlay, errors) {
  const file = overlay.file;
  const doc = overlay.doc;
  if (!isMap(doc)) {
    fail(errors, file, '', 'the overlay could not be read as a mapping');
    return;
  }
  if (typeof doc.extends !== 'string' || !BASE_REF.test(doc.extends)) {
    fail(errors, file, 'extends', 'an overlay must declare the base it extends', null);
  }
  checkOps(doc, file, '', errors);

  if (doc.profiles !== undefined) {
    if (!isMap(doc.profiles)) {
      fail(errors, file, 'profiles', 'profiles must be a mapping of profile name to operations', null);
      return;
    }
    for (const [name, ops] of Object.entries(doc.profiles)) {
      if (!isMap(ops)) fail(errors, file, `profiles.${name}`, 'a profile must be a mapping of operations', null);
      else checkOps(ops, file, `profiles.${name}.`, errors);
    }
  }
}

/**
 * That the overlay is being applied to the base it declares. Shape alone never
 * caught this: an overlay written for one workflow applies cleanly to another —
 * `tune` and `disable` name ids, and ids collide across workflows — and the
 * result hashes as a legitimate graph nobody wrote. Only in resolved mode is
 * there a base to compare against, which is why this check lives beside the
 * shape check rather than inside it.
 *
 * A named base is matched against the definition's own name; a path is matched
 * against the file it points at, so an eject may be extended by the path an
 * operator actually typed.
 */
function checkOverlayBase(overlay, definition, errors) {
  const declared = overlay?.doc?.extends;
  if (typeof declared !== 'string' || !BASE_REF.test(declared)) return;
  const named = bareWorkflowName(declared);

  if (named !== null) {
    const base = definition?.doc?.name;
    if (base === named) return;
    fail(errors, overlay.file, 'extends', `the overlay extends "${named}", but the definition is "${base}"`, null);
    return;
  }

  const source = definition?.file;
  if (typeof source !== 'string' || source === '') return;
  const wanted = path.resolve(path.dirname(overlay.file ?? '.'), declared);
  if (path.resolve(source) === wanted || path.basename(source) === path.basename(declared)) return;
  fail(errors, overlay.file, 'extends', `the overlay extends "${declared}", which is not the definition it was applied to`, null);
}

function checkOps(body, file, prefix, errors) {
  if (body.disable !== undefined) {
    if (!Array.isArray(body.disable)) fail(errors, file, `${prefix}disable`, 'disable must be a sequence of node ids', null);
    else {
      for (const [index, id] of body.disable.entries()) {
        if (!NODE_ID.test(String(id))) {
          fail(errors, file, `${prefix}disable.${index}`, `"${id}" is not a node id`, null);
        }
      }
    }
  }

  if (body.tune !== undefined) {
    if (!isMap(body.tune)) {
      fail(errors, file, `${prefix}tune`, 'tune must be a mapping of node id to patch', null);
    } else {
      for (const [id, patch] of Object.entries(body.tune)) {
        const at = `${prefix}tune.${id}`;
        if (!NODE_ID.test(id)) fail(errors, file, at, `"${id}" is not a node id`, id);
        if (!isMap(patch)) {
          fail(errors, file, at, 'a tune entry must be a mapping', id);
          continue;
        }
        for (const key of Object.keys(patch)) {
          if (!TUNABLE.includes(key)) {
            fail(errors, file, `${at}.${key}`, `only ${TUNABLE.join(', ')} may be tuned; "${key}" may not`, id);
          }
        }
        if (patch.optional !== undefined && typeof patch.optional !== 'boolean') {
          fail(errors, file, `${at}.optional`, 'optional is a boolean', id);
        }
        if (patch.provider !== undefined && !['claude', 'copilot'].includes(patch.provider)) {
          fail(errors, file, `${at}.provider`, `"${patch.provider}" is not a known provider`, id);
        }
      }
    }
  }

  if (body.add !== undefined) {
    if (!isMap(body.add)) {
      fail(errors, file, `${prefix}add`, 'add must be a mapping of node id to node', null);
      return;
    }
    for (const [id, node] of Object.entries(body.add)) {
      const at = `${prefix}add.${id}`;
      if (!NODE_ID.test(id)) fail(errors, file, at, `"${id}" is not a node id`, id);
      if (!isMap(node)) {
        fail(errors, file, at, 'an added node must be a mapping', id);
        continue;
      }
      if (needsOf(node).length === 0) {
        fail(errors, file, `${at}.needs`, 'an added node must attach to the graph through needs', id);
      }
      checkNodeShape(node, id, at, file, errors);
    }
  }
}
