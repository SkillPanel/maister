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
 * When the definition cannot be read at all and the freeze recorded no needs,
 * the nodes this gate closes are unknown. The brief still renders: the summary
 * is the nearest node recorded before the gate that carries one, and a warning
 * says so. Only when no node carries a summary does it refuse.
 *
 * The refusals, split by who can fix them. Two are fixed by a state write, and
 * their message carries the patch: `gate-brief-no-summary` and
 * `gate-brief-value-missing`. Four name no write: `gate-brief-unknown-node` and
 * `gate-brief-not-a-gate` (the invocation is wrong), `state-unreadable`, and
 * `gate-brief-no-graph` (no definition, no frozen needs and no summary to fall
 * back on).
 *
 * Three forms, one reading. The plain form is what an operator reads in
 * session: the summary, at most three decisions and three risks on one line
 * each, and a `Next:` line naming the node that runs and any work skipped on the
 * way — never a gate. It carries no recommendation and no paths: the picker
 * marks the recommended option, and the dashboard link is shown once, at the
 * run's start, resume and end, rather than at every gate. `--json` wraps the
 * plain form into what a picker takes — the question (the brief, a blank line
 * and the gate's `ask:`), a header of at most `HEADER_MAX` characters, and the
 * options in order, recommended first, each with its id, its label and a
 * description — so the model maps fields rather than composing a question.
 * `--oneline` is the driven form a gate request carries, and it is the shape a
 * cockpit and a driver read: every line of the brief, `Recommended: <id>` and
 * the `Run: … · Dashboard: …` line included, folded onto one line.
 *
 * The budget. A picker cuts a question off at about 2,000 characters, and what
 * it cut was the tail — the risks, `Next:` and the ask. So the brief keeps
 * inside `BUDGET`, trimming the summary, the decisions and the risks with a
 * pointer to the dashboard — or to the state file, when the run has no
 * dashboard or its viewer is missing — and never its closing lines: `Next:`,
 * and in the driven form `Recommended:` and the run line.
 *
 * The guard evaluation and the ready-set simulation live here and nowhere else:
 * `walk` for a gate's `Next:` line, `atClose` for what a completed run still owes.
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
import { displayOf, headerOf, labelOf, titleOf } from './display.mjs';
import { definitionPathOf, htmlOutput, projectRootOf } from './state.mjs';

/** The context blocks a summary may also be recorded in, beside `node_summaries`. */
const CONTEXT_SUFFIX = '_context';

/** The warning `workflow.mjs` records for a format this build does not know. */
const NEWER_FORMAT = 'newer-format';

/** Statuses that satisfy a `needs` entry under the default `on`. */
const ENDED_OK = new Set(['completed', 'skipped']);

/** Statuses that end a need badly: what `on: failure` runs on and `on: always` runs through. */
const ENDED_BADLY = new Set(['failed', 'stopped']);

/** Statuses under which a node's declared values read as false. */
const NO_VALUES = new Set(['skipped', 'stopped', 'failed']);

/** One `when` reference: an optional `!`, then `${inputs.k}` or `${node.values.k}`. */
const WHEN = /^(!?)\$\{([a-z][a-z0-9-]*)\.(?:(values)\.)?([a-z_]+)\}$/;

/** The drift form of the Next line, and the recommendation when no option is known. */
const NEXT_UNKNOWN = 'Next: unknown — the definition changed since the freeze';
const RECOMMENDED_UNKNOWN = 'the continue option';

/**
 * The most a brief prints, in characters. A picker showed every question of
 * 1,896 characters in full and cut every one of 2,325; the brief keeps well
 * under the first so the blank line and the gate's own ask still fit.
 */
export const BUDGET = 1600;

/** How long one decision or risk may run before it is cut short. */
const ITEM_MAX = 200;

/** How many decisions, and how many risks, the plain form shows before pointing at the rest. */
const LIST_CAP = 3;

/**
 * A slug key leading a list item — `goods-currency-contract: …` — which names
 * the entry for a machine and says nothing to an operator. At least one dash or
 * underscore, so the prefixes that carry meaning (`open:`, `defaulted:`,
 * `recommend stop:`) are never taken for one.
 */
const SLUG_KEY = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+:\s+/;
const SLUG = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/;

/** What a stop option says it does, in the picker. */
const STOP_DESCRIPTION = 'End the run here; nothing further runs.';

/** The least of a summary kept while list items can still be dropped instead. */
const SUMMARY_FLOOR = 400;

/**
 * Render the brief for the gate `node` of the run whose state file is `state`.
 * `oneline` folds it onto one flow-safe line for a driven gate request; `json`
 * returns the picker — `{question, header, options}` — beside the plain text.
 */
export function gateBrief({ state, node, oneline = false, json = false }) {
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

  const { direct: candidates, stretch } = closingCandidates(recorded, byId, node);
  let closing;
  if (candidates.length) {
    closing = closingStretch(doc, recorded, candidates, stretch, current.display.titles);
    if (!closing) {
      return refuse('gate-brief-no-summary',
        `no node this gate closes has recorded a summary (looked at: ${candidates.join(', ')}); `
        + `send {"node_summaries":{"${candidates[0]}":{"summary":"…"}}} for the node that closed, through write-state, and run gate-brief again`,
        warnings);
    }
  } else {
    // Neither the definition nor the freeze says what this gate closes. The
    // nearest node recorded before it that carries a summary is the best guess
    // there is, and the warning says it is one.
    closing = closingNode(doc, Object.keys(recorded).slice(0, Object.keys(recorded).indexOf(node)).reverse());
    if (!closing) {
      return refuse('gate-brief-no-graph',
        'the definition cannot be read, the freeze recorded no needs for this gate, and no node before it carries a summary; '
        + 'no state write fixes this — ask the gate without a brief and report this message',
        warnings);
    }
    warnings.push({
      code: 'gate-brief-needs-unknown',
      message: `gate-brief-needs-unknown: what this gate closes is unknown, so the summary is ${closing.id}'s, the nearest node before it that carries one`,
    });
  }

  // The options only when the current definition still holds this node as a
  // gate — under drift that is the best knowledge there is, and without it the
  // line names the option by role rather than inventing an id.
  const gateNode = byId.get(node);
  const options = gateNode?.type === 'gate' && isPlainObject(gateNode.options) ? gateNode.options : null;

  let walked = null;
  if (!current.drift) {
    walked = walk({ graph, recorded, gate: node, inputs: inputsOf(doc), defaults: current.defaults });
    if (!walked.ok) return { ok: false, text: '', errors: walked.errors, warnings };
  }
  const { titles } = current.display;
  const recommended = recommend(options, closing.risks);

  if (oneline) {
    const next = walked ? nextLine(walked, titles) : NEXT_UNKNOWN;
    const tail = [next, `Recommended: ${recommended}`, runLine(doc, runDir)];
    return { ok: true, text: fit(closing, DRIVEN, tail, pointerOf(doc, runDir)), errors: [], warnings };
  }

  const gateId = id => isGate(recorded, byId, id);
  const next = walked ? readableNext(walked, titles, gateId) : NEXT_UNKNOWN;
  const text = fit(closing, READABLE, [next], placeOf(doc, runDir));
  if (!json) return { ok: true, text, errors: [], warnings };

  const ask = typeof gateNode?.ask === 'string' ? gateNode.ask.trim() : '';
  const picker = {
    question: ask ? `${text.trimEnd()}\n\n${ask}` : text.trimEnd(),
    header: headerOf(current.display, node, closing.id),
    options: pickerOptions(options, recommended, node, current.display.option_labels, next),
  };
  return { ok: true, text, picker, errors: [], warnings };
}

/**
 * The options a picker lists, in the gate's order with the recommended one
 * moved first: each with the id the answer is recorded by, the label the
 * operator reads, and a description — the `Next:` line for the continue option,
 * a plain statement for a stop. Empty when the current definition no longer
 * holds the gate's options, and the caller asks with the gate's own.
 */
function pickerOptions(options, recommended, gate, labels, next) {
  if (!isPlainObject(options)) return [];
  const listed = Object.entries(options).map(([id, option]) => {
    const effect = isPlainObject(option) ? option.effect : option;
    return {
      id,
      label: labelOf(labels, gate, id),
      description: effect === 'continue' ? next : STOP_DESCRIPTION,
      recommended: id === recommended,
    };
  });
  return [...listed.filter(option => option.recommended), ...listed.filter(option => !option.recommended)];
}

function refuse(code, message, warnings = []) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }], warnings };
}

/**
 * Whether the run has a dashboard to point at: turned on, and its viewer in the
 * run directory. A page that is not there is not named — the freeze installs
 * it, so a run without one predates that or had it removed.
 */
function hasViewer(doc, runDir) {
  return htmlOutput(doc) && fs.existsSync(path.join(runDir, 'dashboard.html'));
}

/** Where a trimmed brief sends the reader for the rest: the dashboard, or the state file without one. */
function pointerOf(doc, runDir) {
  return `see ${placeOf(doc, runDir)}`;
}

/** The place itself, which the plain form names after "more in". */
function placeOf(doc, runDir) {
  return hasViewer(doc, runDir) ? 'the dashboard' : "the run's state file";
}

/**
 * Where the run lives and where its dashboard is — the brief's last line. With
 * `html_output` off it says there is none; with the viewer missing it names the
 * run alone.
 */
function runLine(doc, runDir) {
  if (!htmlOutput(doc)) return `Run: ${runDir} · Dashboard: none (html_output is false)`;
  return hasViewer(doc, runDir) ? `Run: ${runDir} · Dashboard: ${path.join(runDir, 'dashboard.html')}` : `Run: ${runDir}`;
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
 * The frozen definition, re-read and re-resolved: `{graph, defaults, display,
 * digest, drift}`. `graph` is kept even under a hash mismatch — its needs and
 * options are still the best knowledge of the gate — and is null only when
 * nothing resolves. `defaults` is the re-read document's `inputs.<k>.default`
 * map, since the resolved graph carries no inputs. `display` is the merged
 * display block: the titles the `Next:` line names nodes by — read off the same
 * sources, so the brief and the dashboard call a node the same thing — and the
 * option labels and headers the picker shows.
 */
function reread(doc, workflow, runDir) {
  const drifted = (graph = null, defaults = {}, display = displayOf()) => ({ graph, defaults, display, digest: digest(graph?.graph_hash), drift: true });
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
  const display = displayOf({ definition, overlays, profile: workflow.profile ?? null });
  if (!graph.ok) return drifted(null, defaults, display);

  const frozen = digest(workflow.graph_hash);
  const now = digest(graph.graph_hash);
  return { graph, defaults, display, digest: now, drift: frozen === null || frozen !== now };
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
 * What this gate closes, as `{direct, stretch}`.
 *
 * `direct` is the nodes it needs, in order. A need that is itself a gate is
 * replaced by that gate's own needs, recursively, so the brief never renders
 * another gate's answer as this one's summary. One of these must have recorded
 * a summary, because they are the nodes that just closed.
 *
 * `stretch` is everything behind them: their needs, walked back until a gate,
 * which is where the previous brief already reported. A node an overlay placed
 * before a node this gate closes is in here, and so is any node since the
 * previous gate that no gate needed directly — neither was ever shown to the
 * operator, and this is the gate that moves past them.
 */
function closingCandidates(recorded, byId, gate) {
  const direct = [];
  const stretch = [];
  const seen = new Set([gate]);
  const visit = id => {
    for (const need of needsOf(recorded, byId, id)) {
      if (seen.has(need)) continue;
      seen.add(need);
      if (isGate(recorded, byId, need)) visit(need);
      else direct.push(need);
    }
  };
  const behind = id => {
    for (const need of needsOf(recorded, byId, id)) {
      if (seen.has(need)) continue;
      seen.add(need);
      if (isGate(recorded, byId, need)) continue;
      stretch.push(need);
      behind(need);
    }
  };
  visit(gate);
  for (const id of direct) behind(id);
  return { direct, stretch };
}

/**
 * Every node of the stretch that recorded a summary, folded into the one
 * `{id, summary, decisions, risks}` the renderer draws, or null when none of the
 * `direct` nodes carries one — a summary further back never stands in for the
 * summary of the node that closed.
 *
 * The direct nodes come first and the rest after them, each group in frozen
 * order, so the budget, which trims from the end, gives up the stretch before
 * the node the gate closes. One node renders exactly as it always has. Several
 * are each named by title in front of their summary, and their decisions and
 * risks are pooled in the same order, so a `recommend stop:` from any of them
 * decides the recommendation.
 */
function closingStretch(doc, recorded, direct, stretch, titles) {
  const sources = summarySources(doc);
  const order = Object.keys(recorded);
  const summarized = ids => [...ids]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(id => summaryOf(sources, id))
    .filter(Boolean);
  const closing = summarized(direct);
  if (!closing.length) return null;
  const entries = [...closing, ...summarized(stretch)];
  if (entries.length === 1) return entries[0];
  return {
    id: entries[0].id,
    summary: entries.map(entry => `${titleOf(titles, entry.id)}: ${entry.summary.trim()}`).join('\n\n'),
    decisions: entries.flatMap(entry => entry.decisions),
    risks: entries.flatMap(entry => entry.risks),
  };
}

/**
 * The first of `candidates` with a filled summary — the fallback's nearest
 * recorded node, when what the gate closes is unknown.
 */
function closingNode(doc, candidates) {
  const sources = summarySources(doc);
  for (const id of candidates) {
    const found = summaryOf(sources, id);
    if (found) return found;
  }
  return null;
}

/**
 * One node's `{id, summary, decisions, risks}`, or null when it carries no summary.
 *
 * Each field is picked on its own from the first source carrying it filled — the
 * dashboard's `pick` rule, mirrored rather than imported so the projection stays
 * free to change what it draws. One addition: a context-block entry counts when
 * its key *or* its `node:` names the node, because the context blocks are keyed
 * by phase and name the node inside the entry.
 */
function summaryOf(sources, id) {
  const entries = sources.flatMap(source => source(id));
  const picked = {};
  for (const field of ['summary', 'decisions', 'risks']) {
    const entry = entries.find(candidate => filled(candidate[field]));
    if (entry) picked[field] = entry[field];
  }
  if (typeof picked.summary !== 'string') return null;
  return { id, summary: picked.summary, decisions: list(picked.decisions), risks: list(picked.risks) };
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
 * The gate is simulated as completed. Then, in resolved order, the first pending in-scope node whose needs are all
 * settled is taken. An `on: failure` node none of whose needs ended badly is
 * simulated as skipped and the loop goes on; otherwise, without a `when` it is
 * next, and with one a true guard makes it next and a false one simulates a
 * skip and the loop goes on.
 */
export function walk({ graph, recorded, gate, inputs = {}, defaults = {} }) {
  const nodes = graph?.nodes ?? [];
  const byId = new Map(nodes.map(entry => [entry.id, entry]));
  const downstream = downstreamOf(nodes, gate);

  const status = new Map();
  for (const entry of nodes) status.set(entry.id, entryOf(recorded, entry.id).status ?? 'pending');
  status.set(gate, 'completed');

  const skipped = [];
  for (;;) {
    const ready = nodes.find(entry => downstream.has(entry.id)
      && status.get(entry.id) === 'pending'
      && readinessOf(entry, status) !== 'waiting');
    if (!ready) return { ok: true, next: null, skipped, waiting: blockers(nodes, downstream, status) };
    // An `on: failure` node whose needs all ended well has nothing to recover
    // from: it is skipped exactly as a false guard skips a node.
    if (readinessOf(ready, status) === 'skip') {
      status.set(ready.id, 'skipped');
      skipped.push(ready.id);
      continue;
    }
    if (typeof ready.when !== 'string') return { ok: true, next: ready.id, skipped };

    const guard = evaluate(ready.when, { byId, recorded, status, inputs, defaults });
    if (!guard.ok) return guard;
    if (guard.value) return { ok: true, next: ready.id, skipped };
    status.set(ready.id, 'skipped');
    skipped.push(ready.id);
  }
}

/**
 * What the downstream nodes still pending wait on, once nothing downstream is
 * ready: every unmet need that is not itself one of those pending nodes — a
 * parallel branch outside the gate's reach, most often. Empty when nothing
 * downstream is pending, which is the end of the run.
 */
function blockers(nodes, downstream, status) {
  const pending = new Set(nodes.filter(entry => downstream.has(entry.id) && status.get(entry.id) === 'pending').map(entry => entry.id));
  const waiting = new Set();
  for (const entry of nodes) {
    if (!pending.has(entry.id)) continue;
    for (const need of list(entry.needs)) {
      if (!pending.has(need) && !settles(status.get(need), entry.on)) waiting.add(need);
    }
  }
  return nodes.map(entry => entry.id).filter(id => waiting.has(id));
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

/**
 * Whether a predecessor in `state` no longer holds back a node with this `on`.
 * Under the default (`success`) only a need that ended well does; under
 * `failure` and `always` any need that has ended does. Which of those a
 * `failure` node then does — run, or be skipped because nothing failed — is
 * the walker's decision, made once every need has settled.
 */
function settles(state, on) {
  if (ENDED_OK.has(state)) return true;
  return ENDED_BADLY.has(state) && (on === 'failure' || on === 'always');
}

/** `readiness` for a graph node, read off the statuses its needs hold now. */
function readinessOf(entry, status) {
  return readiness(list(entry.needs).map(need => status.get(need)), entry.on);
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
function evaluate(when, { byId, recorded, status, inputs, defaults }) {
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

  // A gate records the option chosen and no value — the validator refuses a
  // gate that declares one — so a guard on a gate reads false rather than
  // refusing over a write nobody could make.
  if (entryOf(recorded, owner).kind === 'gate' || byId.get(owner)?.type === 'gate') return negate(false);

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

/**
 * The driven form's `Next:` line, naming each node by its title: the line is
 * read by the operator, and nothing parses it back. The ids stay everywhere a
 * write or an answer is keyed — the refusals' patches and the `Recommended:`
 * option.
 */
function nextLine({ next, skipped, waiting = [] }, titles) {
  const name = id => titleOf(titles, id);
  const suffix = skipped.length ? ` — skipped: ${skipped.map(name).join(', ')}` : '';
  if (next === null && waiting.length) return `Next: waiting on ${waiting.map(name).join(', ')}${suffix}`;
  return `Next: ${next == null ? 'end of run' : name(next)}${suffix}`;
}

/**
 * The plain form's `Next:` line: the node that runs, and the work skipped on the
 * way in parentheses — `Next: Specification (skipping TDD red and UI mockups)`.
 * A skipped gate is left out: it is an approval of work that did not happen,
 * not work, and naming it only doubles the list.
 */
function readableNext({ next, skipped, waiting = [] }, titles, gateId) {
  const name = id => titleOf(titles, id);
  const work = skipped.filter(id => !gateId(id)).map(name);
  const suffix = work.length ? ` (skipping ${andList(work)})` : '';
  if (next === null && waiting.length) return `Next: waiting on ${andList(waiting.map(name))}${suffix}`;
  return `Next: ${next == null ? 'end of run' : name(next)}${suffix}`;
}

/** `A`, `A and B`, `A, B and C`. */
function andList(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// ---------------------------------------------------------------------------
// the run's close
// ---------------------------------------------------------------------------

/** The statuses a node has ended in. Any other, `pending` aside, started and never ended. */
const ENDED = new Set([...ENDED_OK, ...ENDED_BADLY]);

/**
 * What a run that recorded `completed` still owes, for `run-complete`:
 * `{owed, graph, drift}`.
 *
 * `owed` lists, in frozen order, every node that has not finished and that the
 * ready set cannot rule out, as `{id, status, guard}`; `guard` names the guard
 * when that guard reads a value its owner never recorded, which is the only
 * reason such a node is owed. A node that started and never ended — `running`,
 * `suspended`, `waiting`, or a status no reader knows — is owed outright. A
 * pending one is judged the way `walk` judges one, over the whole graph instead
 * of one gate's reach: the first pending node its rule lets through is taken, a
 * false guard or a skip the rule itself decides simulates `skipped` — which
 * satisfies what follows — and anything else is owed. An owed node is then
 * simulated `completed`, so the nodes behind it are judged too rather than
 * passed as blocked. What the loop never reaches waits on a need that ended
 * `failed` or `stopped` and that its `on` does not accept: it can never run, so
 * it is not owed.
 *
 * The edges are the freeze's. `on` and `when` are the re-resolved definition's,
 * and only when it hashes to the freeze: under drift nothing the re-read says is
 * trusted, so every node keeps the default `on`, no guard is evaluated, and
 * `drift` says so. `graph` is that trusted graph, for the reader that checks
 * declared artifacts, and null under drift.
 */
export function atClose({ doc, runDir }) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const ids = Object.keys(recorded);
  if (!ids.length) return { owed: [], graph: null, drift: false };

  const current = reread(doc, workflow, runDir);
  const graph = current.drift ? null : current.graph;
  const byId = new Map((graph?.nodes ?? []).map(entry => [entry.id, entry]));
  const recordedStatus = id => entryOf(recorded, id).status ?? 'pending';
  const status = new Map(ids.map(id => [id, recordedStatus(id)]));
  const owed = new Map();
  const owe = (id, guard = null) => {
    owed.set(id, { id, status: recordedStatus(id), guard });
    status.set(id, 'completed');
  };

  for (const id of ids) {
    if (status.get(id) !== 'pending' && !ENDED.has(status.get(id))) owe(id);
  }
  for (;;) {
    let next = null;
    let decision = 'waiting';
    for (const id of ids) {
      if (status.get(id) !== 'pending') continue;
      decision = readiness(needsOf(recorded, byId, id).map(need => status.get(need)), byId.get(id)?.on);
      if (decision !== 'waiting') {
        next = id;
        break;
      }
    }
    if (next === null) break;
    if (decision === 'skip') {
      status.set(next, 'skipped');
      continue;
    }
    const when = byId.get(next)?.when;
    if (typeof when !== 'string') {
      owe(next);
      continue;
    }
    const guard = evaluate(when, { byId, recorded, status, inputs: inputsOf(doc), defaults: current.defaults });
    if (guard.ok && !guard.value) status.set(next, 'skipped');
    else owe(next, guard.ok ? null : when);
  }
  return { owed: ids.filter(id => owed.has(id)).map(id => owed.get(id)), graph, drift: current.drift };
}

/**
 * One pending node's readiness, from its needs' statuses and its `on`: `ready`,
 * `waiting`, or `skip` — taken off the path by the rule itself, which is allowed
 * and satisfies what follows, exactly like a false guard. `skip` is an
 * `on: failure` node whose needs all ended well: nothing failed, so there is
 * nothing to recover. The one ready-set rule both readers ask — `walk` for a
 * gate's `Next:` line and `atClose` for what a run still owes.
 */
function readiness(needStatuses, on) {
  if (!needStatuses.every(state => settles(state, on))) return 'waiting';
  if (on === 'failure' && !needStatuses.some(state => ENDED_BADLY.has(state))) return 'skip';
  return 'ready';
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
 * `readable` also drops what only a machine reads: a leading slug key, and a
 * map value that is nothing but a slug.
 */
function itemText(item, readable = false) {
  if (isPlainObject(item)) {
    return Object.values(item).map(scalarText)
      .filter(text => text !== '' && !(readable && SLUG.test(text)))
      .join(' — ');
  }
  const text = scalarText(item);
  return readable ? text.replace(SLUG_KEY, '') : text;
}

function scalarText(value) {
  if (typeof value === 'string') return value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function items(values, readable) {
  return values.map(value => itemText(value, readable)).filter(text => text !== '');
}

/** The pointer the driven form leaves where something was trimmed. */
function more(count, where, unit = '') {
  return `(+${count} more${unit ? ` ${unit}` : ''} — ${where})`;
}

/** `text` cut short, never inside a surrogate pair. */
function sliced(text, room) {
  const cut = text.slice(0, room);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * `text` cut to at most `max` characters at a word, the cut named with the
 * exact count it removed — the driven form's cut. When `max` leaves no room
 * for the note beside some of the text, nothing is kept at all: the note alone
 * would overrun the budget it is there to keep.
 */
function shorten(text, max, where) {
  if (text.length <= max) return text;
  // Sized for the largest count it could report, so the real one never makes it longer.
  const room = max - ` … ${more(text.length, where, 'characters')}`.length;
  if (room <= 0) return '';
  const cut = sliced(text, room);
  const word = cut.lastIndexOf(' ');
  const kept = (word > room / 2 ? cut.slice(0, word) : cut).trimEnd();
  return `${kept} … ${more(text.length - kept.length, where, 'characters')}`;
}

/**
 * `text` cut to at most `max` characters at the end of a sentence — at a word
 * when no sentence ends far enough in — followed by `… (more in <place>)`: the
 * plain form's cut, which says where the rest is rather than how long it was.
 */
function toSentence(text, max, where) {
  if (text.length <= max) return text;
  const note = ` … (more in ${where})`;
  const room = max - note.length;
  if (room <= 0) return '';
  const cut = sliced(text, room);
  let end = -1;
  for (const match of text.matchAll(/[.!?](?=\s|$)/g)) {
    if (match.index + 1 > cut.length) break;
    end = match.index + 1;
  }
  const word = cut.lastIndexOf(' ');
  const kept = end > room / 3 ? cut.slice(0, end) : (word > room / 2 ? cut.slice(0, word) : cut).trimEnd();
  return `${kept}${note}`;
}

/** A risk that decides the recommendation, and so has to stay in view. */
const decidesStop = text => text.startsWith('recommend stop:');

/**
 * How each form draws and trims. The driven form is the shape a cockpit and a
 * driver have always read and is kept as it was: every list item, the stop risk
 * moved first only when trimming starts, and each cut counted. The plain form
 * shows at most `LIST_CAP` of each list with the stop risk always first, and
 * says where the rest is.
 */
const DRIVEN = {
  readable: false,
  cap: Infinity,
  stopFirst: false,
  cut: shorten,
  pointer: (count, where) => more(count, where),
  render: renderOneline,
};
const READABLE = {
  readable: true,
  cap: LIST_CAP,
  stopFirst: true,
  cut: toSentence,
  pointer: (count, where) => `(+${count} in ${where})`,
  render: renderPlain,
};

/**
 * The brief rendered inside `BUDGET`. Nothing is trimmed from one that fits
 * beyond the form's own list cap. Otherwise a risk that recommends stopping
 * moves to the front of the risks, so the reason for the recommendation is the
 * last risk to go, and then, in order, until it fits: each list item is cut to
 * `ITEM_MAX`; the summary gives up what it can down to `SUMMARY_FLOOR`;
 * decisions are dropped from the end down to one, then risks down to one, then
 * the last decision, then the last risk; the summary gives up the rest; and last
 * the pointers the drops left go too. `tail` is never touched, so a tail longer
 * than the budget on its own is the one brief that exceeds it.
 */
function fit(closing, form, tail, where) {
  const summary = closing.summary.trim();
  const decisions = items(closing.decisions, form.readable);
  let risks = items(closing.risks, form.readable);
  const stopFirst = () => {
    risks = [...risks.filter(decidesStop), ...risks.filter(risk => !decidesStop(risk))];
  };
  if (form.stopFirst) stopFirst();
  const view = {
    summary: summary.length,
    item: Infinity,
    decisions: Math.min(decisions.length, form.cap),
    risks: Math.min(risks.length, form.cap),
    pointers: true,
  };
  const list = (values, count) => {
    const kept = values.slice(0, count).map(text => form.cut(text, view.item, where));
    const rest = values.length - count;
    return { kept, rest: rest > 0 && view.pointers ? form.pointer(rest, where) : null };
  };
  const draw = () => form.render({
    summary: form.cut(summary, view.summary, where),
    decisions: list(decisions, view.decisions),
    risks: list(risks, view.risks),
    tail,
  });

  let text = draw();
  if (text.length <= BUDGET) return text;
  stopFirst();
  view.item = ITEM_MAX;
  text = draw();
  if (text.length > BUDGET && summary.length > SUMMARY_FLOOR) {
    view.summary = Math.max(SUMMARY_FLOOR, summary.length - (text.length - BUDGET));
    text = draw();
  }
  const drops = [
    () => view.decisions > 1 && view.decisions--,
    () => view.risks > 1 && view.risks--,
    () => view.decisions > 0 && view.decisions--,
    () => view.risks > 0 && view.risks--,
  ];
  for (const drop of drops) {
    while (text.length > BUDGET && drop()) text = draw();
  }
  if (text.length > BUDGET) {
    view.summary = Math.max(0, view.summary - (text.length - BUDGET));
    text = draw();
  }
  if (text.length > BUDGET) {
    view.pointers = false;
    text = draw();
  }
  return text;
}

/**
 * The plain form: the summary, then one line each for the decisions and the
 * risks with any pointer to the rest after them, then `Next:`.
 */
function renderPlain({ summary, decisions, risks, tail }) {
  const out = [summary];
  const line = (label, { kept, rest }, separator) => {
    if (!kept.length && !rest) return;
    out.push(`${label}: ${[kept.join(separator), rest].filter(Boolean).join(' ')}`);
  };
  line('Decisions', decisions, '; ');
  line('Risks', risks, ' · ');
  out.push(...tail);
  return `${out.filter(text => text !== '').join('\n')}\n`;
}

/**
 * The driven form: one line a gate request's `context.summary` can carry. The
 * request writer refuses a newline or a double quote in a flow scalar, so every
 * line break folds to a space and every `"` becomes `'`.
 */
function renderOneline({ summary, decisions, risks, tail }) {
  const all = ({ kept, rest }) => (rest ? [...kept, rest] : kept);
  const sections = [summary];
  if (all(decisions).length) sections.push(`Decisions: ${all(decisions).join('; ')}`);
  if (all(risks).length) sections.push(`Risks: ${all(risks).join('; ')}`);
  sections.push(...tail);
  const line = sections.join(' · ').replace(/\s*[\r\n]+\s*/g, ' ').replace(/"/g, "'").trim();
  return `${line}\n`;
}
