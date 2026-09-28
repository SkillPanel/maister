/**
 * The gate brief: what an operator reads at a gate, rendered from state.
 *
 * Why this module exists. A gate question used to depend on the model composing
 * three things before it asked: a summary of the node that just closed, the node
 * that will actually run next, and which answer it recommends. Attended runs
 * showed all three skipped or wrong — a summary printed after the question or not
 * at all, a "next" read off the gate's own wording while a guard skipped that
 * stretch, a recommendation never named. Each is a fact the engine already holds
 * or can compute, so the engine renders them and the model pastes the result.
 *
 * What it reads. The state file, and the definition the run froze — re-read and
 * re-resolved here without writing anything, because the frozen state carries no
 * `ask`, `options` or `when`. The re-read feeds only the `Next:` line and the
 * option ids; execution never re-resolves a definition, and nothing here changes
 * that. When the definition has drifted since the freeze the brief degrades
 * rather than refusing: the summary and the recommendation still render, `Next:`
 * says it is unknown, and a warning names the two digests. A run started before
 * an upgrade keeps working at every gate.
 *
 * The refusals, split by who can fix them. Two are fixed by a state write, and
 * their message carries the patch: `gate-brief-no-summary` and
 * `gate-brief-value-missing`. Three say the invocation itself is wrong and name
 * no write: `gate-brief-unknown-node`, `gate-brief-not-a-gate` and
 * `state-unreadable`.
 *
 * The guard evaluation and the ready-set simulation live here and nowhere else.
 * `umbrella/scripts/lib/envelope.mjs` re-resolves a frozen definition the same
 * way and is the pattern for it, never an import: the umbrella's drift is a
 * refusal and this module's is a degradation, and one shared helper would have to
 * carry both meanings.
 *
 * Pure: no stdio, no writes. Returns `{ok, text, errors, warnings}` and leaves
 * printing to `workflow.mjs`. Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { KNOWN_VERSION, readDefinition } from './definition.mjs';
import { resolve } from './graph.mjs';
import { definitionPathOf, projectRootOf } from './state.mjs';

/** The context blocks a summary may also be recorded in (A1 layer 2). */
const CONTEXT_SUFFIX = '_context';

/** The warning `workflow.mjs` records for a format this build does not know. */
const NEWER_FORMAT = 'newer-format';

/** Statuses that satisfy a `needs` entry under the default `on`. */
const ENDED_OK = new Set(['completed', 'skipped']);

/** Statuses that satisfy a `needs` entry only under `on: failure|always`. */
const ENDED_BADLY = new Set(['failed', 'stopped']);

/** Statuses under which a node's declared values read as false. */
const NO_VALUES = new Set(['skipped', 'stopped', 'failed']);

/** One `when` reference: an optional `!`, then `${inputs.k}` or `${node.values.k}`. */
const WHEN = /^(!?)\$\{([a-z][a-z0-9-]*)\.(?:(values)\.)?([a-z_]+)\}$/;

/** The drift form of the Next line, and the recommendation when no option is known. */
const NEXT_UNKNOWN = 'Next: unknown — the definition changed since the freeze';
const RECOMMENDED_UNKNOWN = 'the continue option';

/**
 * Render the brief for the gate `node` of the run whose state file is `state`.
 * `oneline` folds it onto one flow-safe line for a driven gate request.
 */
export function gateBrief({ state, node, oneline = false }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read as a state document: ${err.message}`);
  }

  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  if (!Object.hasOwn(recorded, node)) {
    return refuse('gate-brief-unknown-node',
      `--node=${node} names no node of this run (workflow.nodes has no "${node}"); correct the --node argument — no state write fixes this`);
  }
  if (entryOf(recorded, node).kind !== 'gate') {
    return refuse('gate-brief-not-a-gate',
      `--node=${node} names a node this run recorded as ${JSON.stringify(entryOf(recorded, node).kind ?? null)}, not a gate; correct the --node argument — no state write fixes this`);
  }

  const runDir = path.dirname(path.resolve(state));
  const current = reread(doc, workflow, runDir);
  const warnings = [];
  if (current.drift) {
    warnings.push({
      code: 'gate-brief-graph-drift',
      message: `gate-brief-graph-drift: ${digest(workflow.graph_hash) ?? 'none recorded'} vs ${current.digest ?? 'unresolvable'} — the Next line is unknown`,
    });
  }
  const graph = current.graph;
  const byId = new Map((graph?.nodes ?? []).map(entry => [entry.id, entry]));

  const closing = closingNode({ doc, recorded, byId, gate: node });
  if (!closing) {
    return refuse('gate-brief-no-summary',
      `no node this gate closes has recorded a summary (looked at: ${closingCandidates(recorded, byId, node).join(', ') || 'none — the gate\'s needs are unknown'}); `
      + `send {"node_summaries":{"<id>":{"summary":"…"}}} for the node that closed, through write-state, and run gate-brief again`);
  }

  // The options only when the current definition still holds this node as a
  // gate — under drift that is the best knowledge there is, and without it the
  // line names the option by role rather than inventing an id.
  const gateNode = byId.get(node);
  const options = gateNode?.type === 'gate' && isPlainObject(gateNode.options) ? gateNode.options : null;

  let next;
  if (current.drift) {
    next = NEXT_UNKNOWN;
  } else {
    const walked = walk({ graph, recorded, gate: node, inputs: inputsOf(doc), defaults: current.defaults, options });
    if (!walked.ok) return { ok: false, text: '', errors: walked.errors, warnings };
    next = nextLine(walked);
  }

  const recommended = recommend(options, closing.risks);
  const text = oneline
    ? renderOneline({ closing, next, recommended })
    : renderPlain({ closing, next, recommended });
  return { ok: true, text, errors: [], warnings };
}

function refuse(code, message) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}

function entryOf(recorded, id) {
  return isPlainObject(recorded[id]) ? recorded[id] : {};
}

/** Either spelling of a graph hash reduced to the digest itself. */
function digest(value) {
  if (typeof value !== 'string' || value === '') return null;
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}

// ---------------------------------------------------------------------------
// the read-only re-read
// ---------------------------------------------------------------------------

/**
 * The frozen definition, re-read and re-resolved: `{graph, defaults, digest,
 * drift}`. `graph` is kept even under a hash mismatch — its needs and options
 * are still the best knowledge of the gate — and is null only when nothing
 * resolves. `defaults` is the re-read document's `inputs.<k>.default` map, since
 * the resolved graph carries no inputs.
 */
function reread(doc, workflow, runDir) {
  const drifted = (graph = null, defaults = {}) => ({ graph, defaults, digest: digest(graph?.graph_hash), drift: true });
  const file = definitionPathOf(doc, runDir);
  if (file === null) return drifted();
  const definition = readDefinition(file);
  if (definition.doc === null || definition.errors.length) return drifted();

  const root = projectRootOf(runDir);
  const overlays = [];
  for (const overlay of Array.isArray(workflow.overlays) ? workflow.overlays : []) {
    const read = typeof overlay === 'string' ? readDefinition(path.resolve(root, overlay)) : null;
    if (!read || read.doc === null || read.errors.length) return drifted();
    overlays.push(read);
  }

  // A newer format is resolved on its structure alone, as the entry point does;
  // the hash comparison is what still has to hold.
  const version = definition.doc.version;
  const degraded = version !== undefined && version !== null && version !== KNOWN_VERSION ? [NEWER_FORMAT] : [];
  const graph = resolve({ definition, overlays, profile: workflow.profile ?? null, degraded });
  const defaults = defaultsOf(definition.doc);
  if (!graph.ok) return drifted(null, defaults);

  const frozen = digest(workflow.graph_hash);
  const now = digest(graph.graph_hash);
  return { graph, defaults, digest: now, drift: frozen === null || frozen !== now };
}

function defaultsOf(definition) {
  const inputs = isPlainObject(definition.inputs) ? definition.inputs : {};
  const defaults = {};
  for (const [key, declared] of Object.entries(inputs)) {
    if (isPlainObject(declared) && Object.hasOwn(declared, 'default')) defaults[key] = declared.default;
  }
  return defaults;
}

function inputsOf(doc) {
  const orchestrator = isPlainObject(doc.orchestrator) ? doc.orchestrator : {};
  const options = isPlainObject(orchestrator.options) ? orchestrator.options : {};
  return isPlainObject(options.inputs) ? options.inputs : {};
}

// ---------------------------------------------------------------------------
// the closing node
// ---------------------------------------------------------------------------

/** A node's needs: the frozen record when it carries one, else the resolved graph's. */
function needsOf(recorded, byId, id) {
  const frozen = entryOf(recorded, id).needs;
  if (Array.isArray(frozen)) return frozen.map(String);
  const resolved = byId.get(id)?.needs;
  return Array.isArray(resolved) ? resolved : [];
}

function isGate(recorded, byId, id) {
  return entryOf(recorded, id).kind === 'gate' || byId.get(id)?.type === 'gate';
}

/**
 * The nodes this gate closes, in order. A need that is itself a gate is replaced
 * by that gate's own needs, recursively, so the brief never renders another
 * gate's answer as this one's summary.
 */
function closingCandidates(recorded, byId, gate) {
  const out = [];
  const seen = new Set([gate]);
  const visit = id => {
    for (const need of needsOf(recorded, byId, id)) {
      if (seen.has(need)) continue;
      seen.add(need);
      if (isGate(recorded, byId, need)) visit(need);
      else out.push(need);
    }
  };
  visit(gate);
  return out;
}

/**
 * The first candidate with a filled summary, as `{id, summary, decisions, risks}`.
 *
 * Each field is picked on its own from the first source carrying it filled — the
 * dashboard's `pick` rule, mirrored rather than imported so the projection stays
 * free to change what it draws. One addition: a context-block entry counts when
 * its key *or* its `node:` names the candidate, because the context blocks are
 * keyed by phase and name the node inside the entry.
 */
function closingNode({ doc, recorded, byId, gate }) {
  const sources = summarySources(doc);
  for (const id of closingCandidates(recorded, byId, gate)) {
    const entries = sources.flatMap(source => source(id));
    const picked = {};
    for (const field of ['summary', 'decisions', 'risks']) {
      const entry = entries.find(candidate => filled(candidate[field]));
      if (entry) picked[field] = entry[field];
    }
    if (typeof picked.summary === 'string') {
      return { id, summary: picked.summary, decisions: list(picked.decisions), risks: list(picked.risks) };
    }
  }
  return null;
}

/** Each source as a function of a node id to the entries it holds for it. */
function summarySources(doc) {
  const sources = [];
  if (isPlainObject(doc.node_summaries)) {
    const map = doc.node_summaries;
    sources.push(id => (Object.hasOwn(map, id) && isPlainObject(map[id]) ? [map[id]] : []));
  }
  for (const key of Object.keys(doc)) {
    if (!key.endsWith(CONTEXT_SUFFIX) || !isPlainObject(doc[key]) || !isPlainObject(doc[key].phase_summaries)) continue;
    const map = doc[key].phase_summaries;
    sources.push(id => Object.entries(map)
      .filter(([phase, entry]) => isPlainObject(entry) && (phase === id || entry.node === id))
      .map(([, entry]) => entry));
  }
  return sources;
}

function filled(value) {
  return (typeof value === 'string' && value.trim() !== '') || (Array.isArray(value) && value.length > 0);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// the walker
// ---------------------------------------------------------------------------

/**
 * The node that will actually run once `gate` is answered with its continue
 * option: `{ok, next, skipped}` with `next` null at the end of the run, or a
 * `gate-brief-value-missing` refusal.
 *
 * Only nodes downstream of the gate are considered — those whose transitive
 * `needs` closure contains it. Everything else is history or a parallel branch,
 * and neither is what this answer moves forward.
 *
 * The gate is simulated as completed, carrying its continue option's `values`.
 * Then, in resolved order, the first pending in-scope node whose needs are all
 * satisfied is taken: without a `when` it is next; with one, a true guard makes it
 * next and a false one simulates a skip and the loop goes on.
 */
export function walk({ graph, recorded, gate, inputs = {}, defaults = {}, options = null }) {
  const nodes = graph?.nodes ?? [];
  const byId = new Map(nodes.map(entry => [entry.id, entry]));
  const downstream = downstreamOf(nodes, gate);

  const status = new Map();
  for (const entry of nodes) status.set(entry.id, entryOf(recorded, entry.id).status ?? 'pending');
  status.set(gate, 'completed');
  const values = new Map([[gate, continueValues(options)]]);

  const skipped = [];
  for (;;) {
    const ready = nodes.find(entry => downstream.has(entry.id)
      && status.get(entry.id) === 'pending'
      && list(entry.needs).every(need => satisfies(status.get(need), entry.on)));
    if (!ready) return { ok: true, next: null, skipped };
    if (typeof ready.when !== 'string') return { ok: true, next: ready.id, skipped };

    const guard = evaluate(ready.when, { byId, recorded, status, values, inputs, defaults });
    if (!guard.ok) return guard;
    if (guard.value) return { ok: true, next: ready.id, skipped };
    status.set(ready.id, 'skipped');
    skipped.push(ready.id);
  }
}

/** Every node whose transitive needs closure contains `gate`. */
function downstreamOf(nodes, gate) {
  const found = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of nodes) {
      if (found.has(entry.id)) continue;
      if (list(entry.needs).some(need => need === gate || found.has(need))) {
        found.add(entry.id);
        grew = true;
      }
    }
  }
  return found;
}

/** Whether a predecessor in `state` lets a node with this `on` run. */
function satisfies(state, on) {
  if (ENDED_OK.has(state)) return true;
  if (!ENDED_BADLY.has(state)) return false;
  const modes = Array.isArray(on) ? on : [on];
  return modes.includes('failure') || modes.includes('always');
}

/** The continue option's `values`, when it uses the `{effect, values}` form. */
function continueValues(options) {
  const key = optionWith(options, 'continue');
  const option = key === null ? null : options[key];
  return isPlainObject(option) && isPlainObject(option.values) ? option.values : {};
}

/** The first option id, in resolved order, whose effect is `effect`; else null. */
function optionWith(options, effect) {
  if (!isPlainObject(options)) return null;
  for (const [key, option] of Object.entries(options)) {
    if ((isPlainObject(option) ? option.effect : option) === effect) return key;
  }
  return null;
}

/**
 * One `when` reference, honouring a leading `!`. `{ok, value}`, or the
 * value-missing refusal when a completed node never recorded the value its
 * successor is guarded on.
 */
function evaluate(when, { byId, recorded, status, values, inputs, defaults }) {
  const match = WHEN.exec(when);
  if (!match) return { ok: true, value: false };
  const [, bang, owner, , key] = match;
  const negate = value => ({ ok: true, value: bang === '!' ? !value : value });

  if (owner === 'inputs') {
    if (Object.hasOwn(inputs, key)) return negate(inputs[key] === true);
    if (Object.hasOwn(defaults, key)) return negate(defaults[key] === true);
    return negate(false);
  }

  // A node that did not complete emits nothing, so every value it declares
  // reads as false (SKILL.md, recording an outcome).
  if (NO_VALUES.has(status.get(owner))) return negate(false);

  // A gate's values are the answer's; no write ever puts one there, so a
  // missing key is false rather than a refusal nobody could act on.
  if (values.has(owner) || entryOf(recorded, owner).kind === 'gate' || byId.get(owner)?.type === 'gate') {
    const held = values.get(owner) ?? entryOf(recorded, owner).values;
    return negate(isPlainObject(held) && held[key] === true);
  }

  const held = entryOf(recorded, owner).values;
  if (status.get(owner) === 'completed' && isPlainObject(held) && typeof held[key] === 'boolean') {
    return negate(held[key]);
  }

  const kept = isPlainObject(held) ? JSON.stringify({ ...held }).slice(1, -1) : '';
  const patch = `{"nodes":{"${owner}":{"values":{${kept}${kept ? ',' : ''}"${key}":<true|false>}}}}`;
  return {
    ok: false,
    errors: [{
      code: 'gate-brief-value-missing',
      message: `gate-brief-value-missing: the guard ${when} reads ${owner}.values.${key}, which ${owner} never recorded; `
        + `a node's values map is replaced whole on patch, so send the recorded values with the missing key through write-state — ${patch} — and run gate-brief again`,
    }],
  };
}

function nextLine({ next, skipped }) {
  const suffix = skipped.length ? ` — skipped: ${skipped.join(', ')}` : '';
  return `Next: ${next ?? 'end of run'}${suffix}`;
}

// ---------------------------------------------------------------------------
// the recommendation and the rendering
// ---------------------------------------------------------------------------

/**
 * The continue option, unless a closing risk opens `recommend stop:` — then the
 * first stop option. Without the options the line names the role, not an id.
 */
function recommend(options, risks) {
  const stop = risks.some(risk => typeof risk === 'string' && risk.trim().startsWith('recommend stop:'));
  return (stop ? optionWith(options, 'stop') : null) ?? optionWith(options, 'continue') ?? RECOMMENDED_UNKNOWN;
}

/**
 * One list item on one line. A map is its non-empty scalar values in written
 * order, joined by an em dash, so `{decision, rationale}` reads as a sentence.
 */
function itemText(item) {
  if (isPlainObject(item)) {
    return Object.values(item).map(scalarText).filter(text => text !== '').join(' — ');
  }
  return scalarText(item);
}

function scalarText(value) {
  if (typeof value === 'string') return value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function items(values) {
  return values.map(itemText).filter(text => text !== '');
}

/** The terminal form: the summary verbatim, the lists, then Next and Recommended. */
function renderPlain({ closing, next, recommended }) {
  const out = [closing.summary.trim(), ''];
  const decisions = items(closing.decisions);
  const risks = items(closing.risks);
  if (decisions.length) out.push('Decisions:', ...decisions.map(text => `- ${text}`));
  if (risks.length) out.push('Risks:', ...risks.map(text => `- ${text}`));
  if (decisions.length || risks.length) out.push('');
  out.push(next, `Recommended: ${recommended}`);
  return `${out.join('\n')}\n`;
}

/**
 * The driven form: one line a gate request's `context.summary` can carry. The
 * request writer refuses a newline or a double quote in a flow scalar, so every
 * line break folds to a space and every `"` becomes `'`.
 */
function renderOneline({ closing, next, recommended }) {
  const decisions = items(closing.decisions);
  const risks = items(closing.risks);
  const sections = [closing.summary];
  if (decisions.length) sections.push(`Decisions: ${decisions.join('; ')}`);
  if (risks.length) sections.push(`Risks: ${risks.join('; ')}`);
  sections.push(next, `Recommended: ${recommended}`);
  const line = sections.join(' · ').replace(/\s*[\r\n]+\s*/g, ' ').replace(/"/g, "'").trim();
  return `${line}\n`;
}
