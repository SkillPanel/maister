/**
 * The sub-run hand-off: a parent adopts a child that ended and starts its next
 * child, in one engine call.
 *
 * Why this is a verb. A parent's adoption was a dozen calls a session composed
 * from prose: read the child, re-resolve its definition and compare hashes,
 * adopt the outcome (W4), record the nodes a false guard now skips, then for
 * the next `workflow:` node start it (W1), find its child's directory, fill in
 * and check its inputs and outputs, freeze the child (W2) and record the link
 * (W3). Every one of those steps is decided by the state on disk, so the
 * engine takes them here, in that order, each through the state writer as the
 * one durable write the walk gives it (sub-runs reference, *The hand-off
 * verb*). A crash between two of them leaves exactly what the separate writes
 * would have left, and the next call continues from it.
 *
 * What it keeps. The disk wins: the child's `task.status` decides, never a
 * wake-up line. W2 lands before W3, and W3 before the driver types its waiting
 * marker — this verb never prints that marker, nor any `RUN-` marker: it ends
 * on one line the driver reads (`waiting:`, `started:`, `stopped:` or the
 * writer's `next:` line). It never runs a node of another scheme, asks a gate
 * or writes a gate request.
 *
 * Whatever the named node's status, it continues from disk: a `waiting` node is
 * adopted; one already adopted continues at the guard skips; a `running` one
 * (W1 landed, no link yet) goes on at its child's directory; a `pending` one
 * the walk is due at starts. A re-run is never an error that strands the run.
 *
 * Refusals, as `{ok: false, code, message}`, nothing written by the refused
 * step: `subrun-path-state-unreadable`, `subrun-path-not-a-run`,
 * `subrun-path-unknown-node`, `subrun-path-not-a-subrun`, the sub-run codes
 * `subrun-on-dir-node`, `subrun-recursion`, `subrun-target-unresolved`,
 * `subrun-child-foreign`, `subrun-state-missing`, `subrun-graph-drifted`,
 * `subrun-input-missing`, `subrun-input-unknown` and `subrun-output-unmatched`,
 * `subrun-path-definition-unread`, `state-freeze-unproven` for a child
 * definition that does not validate, and every refusal of the state writer it
 * passes on (`state-subrun-held-open` among them).
 *
 * Zero dependencies, `node:` builtins and engine libs only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { SUBRUN_REFUSAL, resolve as resolveGraph, validate } from './graph.mjs';
import { dueNext, reread, skipWalk } from './gate-brief.mjs';
import { childRun, projectRootOf, provenGraph, writeState } from './state.mjs';
import { subrunPath } from './subrun-path.mjs';
import { filledWith } from './node-brief.mjs';
import { runHost } from './brief.mjs';
import { isNewerVersion, readDefinition } from './definition.mjs';
import { locate } from './locate.mjs';
import { titleOf } from './display.mjs';
import { isTerminalDriver } from './driver.mjs';
import { HELD_APPROVAL, frozenIds } from './question-triage.mjs';

/** The child statuses a parent adopts; any other leaves the node waiting. */
const ENDED = new Set(['completed', 'failed', 'stopped']);

/** The longest a walk may run in one call: one step per node, twice over, then it stops. */
const STEP_LIMIT = 2;

/** A walk that wrote a step per node twice over and never settled: a tooling fault, never a refusal. */
const UNSETTLED = 'the hand-off walk did not settle within its step budget; nothing past the writes listed above was made';

/**
 * Hand off the `workflow:` node `node` of the parent run whose state file is
 * `state`. `at` is the wake-up line's stamp; no write the hand-off makes
 * records a decision time, so it is accepted and recorded nowhere, as with the
 * separate writes. Returns `{ok: true, writes, warnings, line}` or
 * `{ok: true, writes, warnings, next}` — `next` as the state writer's `next:`
 * line takes it — or `{ok: false, code, message, writes, warnings}`.
 */
export function subrunHandoff({ state, node, at = null }) {
  const run = { state, runDir: path.dirname(path.resolve(state)), writes: [], warnings: [], at };
  const doc = readParent(run);
  if (doc.refusal) return doc.refusal;
  const recorded = isPlainObject(doc.workflow.nodes) ? doc.workflow.nodes : {};
  if (node === HELD_APPROVAL || !Object.hasOwn(recorded, node)) {
    return refused('subrun-path-unknown-node', `${node} is not a node of this run. Name the workflow: node, exactly as workflow.nodes spells it.`, run);
  }
  const entry = isPlainObject(recorded[node]) ? recorded[node] : {};
  if (entry.kind !== 'workflow') {
    return refused('subrun-path-not-a-subrun', `${node} is a ${entry.kind ?? 'node'} step, not a workflow: node, so it adopts and starts no child run. Run node-brief for it.`, run);
  }
  if (typeof entry.dir === 'string' && entry.dir !== '') {
    return refused(SUBRUN_REFUSAL.onDirNode, `${node} carries dir: and dispatches into that directory; its outcome is the dispatch's close-out, never a hand-off.`, run);
  }
  return handle(run, node, doc, frozenIds(recorded).length * STEP_LIMIT + 1);
}

/** One node's turn of the walk: by its recorded status, what is left of its hand-off. */
function handle(run, node, doc, budget) {
  if (budget <= 0) throw new Error(UNSETTLED);
  const entry = doc.workflow.nodes[node] ?? {};
  const status = entry.status ?? 'pending';
  if (status === 'waiting') return adopt(run, node, doc, budget);
  if (status === 'running') return start(run, node, doc, { begun: true });
  if (status === 'failed') return done(run, { next: dueNext({ doc, runDir: run.runDir }) ?? { id: null } });
  if (status === 'stopped') return done(run, { line: stoppedLine(node, entry) });
  return walk(run, doc, budget);
}

/**
 * Steps 1 to 4: read the child, let its state decide, prove its definition,
 * and adopt its outcome (W4). A completed child continues the walk.
 */
function adopt(run, node, doc, budget) {
  const entry = doc.workflow.nodes[node];
  const values = isPlainObject(entry.values) ? entry.values : {};
  const runId = typeof values.run_id === 'string' && values.run_id !== '' ? values.run_id : basename(String(values.task_path ?? ''));
  const child = childRun(values.task_path, run.runDir);
  if (child === null) {
    return refused(SUBRUN_REFUSAL.stateMissing, `no child run is found at ${values.task_path ?? '(no task_path recorded)'}, the task_path ${node} recorded. `
      + 'Nothing was written and nothing is re-created: restore the directory, or correct the run, then run the verb again.', run);
  }
  const parentRun = relativeTo(projectRootOf(run.runDir), run.runDir);
  const link = child.state.orchestrator?.parent;
  if (!isPlainObject(link) || spelled(String(link.run ?? '')) !== spelled(parentRun) || link.node !== node) {
    const named = isPlainObject(link) ? `${link.run} node ${link.node}` : 'no parent';
    return refused(SUBRUN_REFUSAL.childForeign, `${values.task_path} holds a run whose parent link names ${named}, not ${parentRun} node ${node}. `
      + 'Nothing was written: the node adopts only the child it started.', run);
  }
  const childStatus = child.state.task?.status;
  const pending = child.state.orchestrator?.gate_pending;
  // A10: a gate the child raised before the daemon gave it a session holds
  // every write back, so the child is not done whatever its status says.
  const unsessioned = isPlainObject(pending) && !child.state.orchestrator?.driver?.session;
  if (!ENDED.has(childStatus) || unsessioned) return done(run, { line: `waiting: ${node} run=${runId} — the sub-run has not ended; nothing was written` });

  const proof = provenGraph(child.state.workflow, child.dir);
  if (!proof.graph) {
    return refused(SUBRUN_REFUSAL.graphDrifted, `the child ${runId} was frozen on a graph its definition no longer gives: ${proof.reason}. `
      + 'Nothing was written. Put the child\'s definition back and run the verb again, or start a new run; nothing re-freezes either run.', run);
  }
  const declared = declaredOf(run, doc, node);
  const childNodes = isPlainObject(child.state.workflow.nodes) ? child.state.workflow.nodes : {};
  const copied = { task_path: values.task_path, run_id: runId };
  const exposedValues = isPlainObject(proof.outputs.values) ? proof.outputs.values : {};
  for (const key of Object.keys(isPlainObject(declared?.outputs?.values) ? declared.outputs.values : {})) {
    const [owner, , valueKey] = String(exposedValues[key] ?? '').split('.');
    const producer = isPlainObject(childNodes[owner]) ? childNodes[owner] : {};
    if (isPlainObject(producer.values) && Object.hasOwn(producer.values, valueKey)) copied[key] = producer.values[valueKey];
  }
  const absent = {};
  const exposedArtifacts = isPlainObject(proof.outputs.artifacts) ? proof.outputs.artifacts : {};
  for (const key of Object.keys(isPlainObject(declared?.outputs?.artifacts) ? declared.outputs.artifacts : {})) {
    const [owner] = String(exposedArtifacts[key] ?? '').split('.');
    if (childNodes[owner]?.status === 'skipped') absent[key] = `the sub-run skipped ${owner}, which writes it`;
  }
  const summary = { summary: `Sub-run ${runId} ${childStatus}.`, ...(Object.keys(absent).length ? { absent } : {}) };
  const nodes = { [node]: { status: childStatus, values: copied } };
  const patch = { nodes, node_summaries: { [node]: summary } };
  if (childStatus === 'stopped') {
    // One stop patch: the run stops outright, every node not yet run with it.
    for (const id of frozenIds(doc.workflow.nodes)) {
      if (id !== node && (doc.workflow.nodes[id]?.status ?? 'pending') === 'pending') nodes[id] = { status: 'stopped' };
    }
    patch.task = { status: 'stopped' };
  }
  const written = write(run, run.state, patch, `W4 adopting ${node}`);
  if (written.refusal) return written.refusal;
  if (childStatus === 'stopped') return done(run, { line: stoppedLine(node, { values: copied }) });
  const after = readParent(run);
  if (after.refusal) return after.refusal;
  if (childStatus === 'failed') return done(run, { next: dueNext({ doc: after, runDir: run.runDir }) ?? { id: null } });
  return walk(run, after, budget - 1);
}

/**
 * Steps 5 to 7: record each due node a false guard (or the `on: failure` rule)
 * takes off the path, through the walk `skipWalk` shares, then start the due
 * `workflow:` node, or hand the driver the writer's `next:` line for anything
 * else. Each skip is one of this call's labelled writes.
 */
function walk(run, doc, budget) {
  const writer = (patch, id) => {
    const written = write(run, run.state, patch, `skip ${id}`);
    return written.refusal ? { ok: false, code: written.refusal.code, refusal: written.refusal } : { ok: true };
  };
  const readAgain = () => {
    const after = readParent(run);
    return after.refusal ? { ok: false, code: after.refusal.code, refusal: after.refusal } : after;
  };
  const { skipped, stop, doc: current } = skipWalk({ doc, runDir: run.runDir, writer, reread: readAgain, bound: budget });
  if (stop.error) throw stop.error;
  if (stop.kind === 'refused') return stop.result.refusal;
  if (stop.kind === 'bound') throw new Error(UNSETTLED);
  if (stop.kind === 'settled') return settled(run, current, budget - skipped.length);
  if (stop.kind === 'closing') return done(run, { next: { id: null } });
  const entry = current.workflow.nodes[stop.id] ?? {};
  if (entry.kind === 'workflow' && !(typeof entry.dir === 'string' && entry.dir !== '')) return start(run, stop.id, current, { begun: false });
  return done(run, { next: { id: stop.id, title: stop.title } });
}

/**
 * Nothing is pending and due while the run is not done: a sub-run is in
 * flight, or a step started and has not ended. A `workflow:` node waiting or
 * started is handed off; any other started step is the driver's to brief.
 */
function settled(run, doc, budget) {
  const nodes = doc.workflow.nodes;
  const ids = frozenIds(nodes);
  const subrun = ids.find(id => nodes[id]?.kind === 'workflow' && !nodes[id]?.dir && ['waiting', 'running'].includes(nodes[id]?.status));
  if (subrun !== undefined) return handle(run, subrun, doc, budget - 1);
  const started = ids.find(id => ['running', 'waiting'].includes(nodes[id]?.status));
  const current = reread(doc, doc.workflow, run.runDir);
  return done(run, { next: started === undefined ? { id: null } : { id: started, title: titleOf(current.display?.titles, started) } });
}

/**
 * Step 6: the next child — W1 (unless it landed already), its directory and
 * checks 1–3 from `subrun-path`, its inputs and checks 4–5, the freeze (W2,
 * skipped when the directory holds this node's child already) and the link (W3).
 */
function start(run, node, doc, { begun }) {
  if (!begun) {
    const written = write(run, run.state, { nodes: { [node]: { status: 'running' } } }, `W1 starting ${node}`);
    if (written.refusal) return written.refusal;
  }
  const where = subrunPath({ state: run.state, node });
  run.warnings.push(...(where.warnings ?? []));
  if (!where.ok) return refused(where.code, where.message, run);
  const root = projectRootOf(run.runDir);
  const current = reread(doc, doc.workflow, run.runDir);
  const declared = current.graph?.nodes.find(entry => entry.id === node) ?? null;
  const name = where.workflow ?? String(declared?.uses ?? '').slice('workflow:'.length).replace(/^builtin:/, '');

  const found = locate({ name, project: root });
  if (!found.ok) return refused(SUBRUN_REFUSAL.targetUnresolved, `${name} cannot be read where it was found: ${found.errors[0]?.message ?? 'no definition'}.`, run);
  const definition = readAt(root, found.definition);
  const overlays = found.overlays.map(file => readAt(root, file));
  const unreadable = [definition, ...overlays].find(source => source.errors.length);
  if (unreadable) return refused('state-freeze-unproven', `the child definition ${unreadable.file} cannot be read: ${unreadable.errors[0].message}.`, run);
  const degraded = isNewerVersion(definition.doc?.version) ? ['newer-format'] : [];
  if (!degraded.length) {
    const judged = validate({ definition, overlays, profile: null, mode: 'resolved', project: root });
    run.warnings.push(...judged.warnings.map(warning => `child definition ${name}: ${typeof warning === 'string' ? warning : warning.message ?? JSON.stringify(warning)}`));
    if (!judged.ok) return refused('state-freeze-unproven', `the child definition ${name} does not validate: ${judged.errors[0]?.message ?? 'no graph'}.`, run);
  }
  const graph = resolveGraph({ definition, overlays, profile: null, degraded, project: root });
  if (!graph.ok) return refused('state-freeze-unproven', `the child definition ${name} does not resolve: ${graph.errors[0]?.message ?? 'no graph'}.`, run);

  const filled = filledWith({ state: run.state, node });
  if (filled === null) return refused('subrun-path-definition-unread', 'the definition this run froze cannot be re-read, so the node\'s with: cannot be filled in. Restore it and run the verb again.', run);
  if (filled.missing.length) {
    const { owner, key } = filled.missing[0];
    return refused(SUBRUN_REFUSAL.inputMissing, `${node}'s with: reads \${${owner}.values.${key}}, which nothing recorded. Record it, or correct the definition, then run the verb again.`, run);
  }
  const childInputs = isPlainObject(definition.doc.inputs) ? definition.doc.inputs : {};
  const inputs = { ...filled.values };
  if (Object.hasOwn(childInputs, 'embedded')) inputs.embedded = true;
  const unknown = Object.keys(inputs).find(key => !Object.hasOwn(childInputs, key));
  if (unknown !== undefined) return refused(SUBRUN_REFUSAL.inputUnknown, `${node}'s with: names ${unknown}, an input ${name} does not declare.`, run);
  const lacking = Object.entries(childInputs).find(([key, input]) => isPlainObject(input) && input.required === true
    && !Object.hasOwn(input, 'default') && (inputs[key] === undefined || inputs[key] === null));
  if (lacking) return refused(SUBRUN_REFUSAL.inputMissing, `${node}'s with: misses ${lacking[0]}, an input ${name} declares required.`, run);
  const unmatched = unmatchedOutput(declared, definition.doc, graph);
  if (unmatched !== null) return refused(SUBRUN_REFUSAL.outputUnmatched, `${node} declares the output ${unmatched}, which ${name} does not expose as declared.`, run);

  const childDir = path.join(root, ...where.task_path.split('/'));
  const childState = path.join(childDir, 'orchestrator-state.yml');
  if (where.existing !== 'adopt') {
    fs.mkdirSync(childDir, { recursive: true });
    // The writer records the status a freeze starts a run with.
    const task = { title: titleOf(current.display?.titles, node) };
    if (typeof doc.task?.description === 'string' && doc.task.description !== '') task.description = doc.task.description;
    const parentDriver = doc.orchestrator?.driver;
    const driver = isTerminalDriver(doc) ? { kind: 'terminal' } : { kind: parentDriver.kind, cwd: root };
    const freeze = {
      task,
      // The lookup's spellings, as `locate` prints them and a driver passes them on.
      workflow: { source: found.definition, overlays: found.overlays, profile: graph.profile, graph_hash: graph.graph_hash, grammar_version: 1, name: graph.name },
      orchestrator: { options: { inputs }, driver, parent: where.parent },
    };
    const written = write(run, childState, freeze, `W2 freezing ${where.run_id}`, runHost(doc));
    if (written.refusal) return written.refusal;
  }
  const linked = write(run, run.state, { nodes: { [node]: { status: 'waiting', values: { task_path: where.task_path, run_id: where.run_id } } } }, `W3 linking ${node}`);
  if (linked.refusal) return linked.refusal;
  return done(run, { line: `started: ${node} run=${where.run_id} — the sub-run is frozen and linked` });
}

/**
 * Check 5: a key the node declares under `outputs:` the child does not expose
 * by that name, or an artifact whose path is not the one the producing child
 * node declares. Returns the first such key, or null.
 */
function unmatchedOutput(declared, childDoc, graph) {
  const exposedBy = isPlainObject(childDoc.outputs) ? childDoc.outputs : {};
  for (const kind of ['artifacts', 'values']) {
    const wanted = isPlainObject(declared?.outputs?.[kind]) ? declared.outputs[kind] : {};
    const exposed = isPlainObject(exposedBy[kind]) ? exposedBy[kind] : {};
    for (const [key, value] of Object.entries(wanted)) {
      if (key === 'task_path' || key === 'run_id') continue;
      if (typeof exposed[key] !== 'string') return `${kind}.${key}`;
      if (kind !== 'artifacts') continue;
      const [owner, , artifact] = exposed[key].split('.');
      const written = graph.nodes.find(entry => entry.id === owner)?.outputs?.artifacts?.[artifact];
      if (written !== undefined && written !== value) return `${kind}.${key}`;
    }
  }
  return null;
}

/** The node as the parent's definition declares it now, or null under a definition that cannot be re-read. */
function declaredOf(run, doc, node) {
  const current = reread(doc, doc.workflow, run.runDir);
  return current.graph?.nodes.find(entry => entry.id === node) ?? null;
}

/** One write through the state writer, kept for the report; `{refusal}` when it was refused. */
function write(run, target, patch, label, host = null) {
  const result = writeState({ state: target, patch, host });
  if (!result.ok) {
    const [error] = result.errors;
    const code = error?.code ?? 'state-unwritable';
    // The writer's message opens with its code, which the refusal carries apart.
    const message = String(error?.message ?? 'refused').replace(new RegExp(`^${code}: `), '');
    return { refusal: refused(code, `${label}: ${message}`, run) };
  }
  run.writes.push({ label, target, result });
  return {};
}

/** The parent's state as it now stands on disk, or `{refusal}`. */
function readParent(run) {
  let doc;
  try {
    doc = parse(fs.readFileSync(run.state, 'utf8'));
  } catch (err) {
    return { refusal: refused('subrun-path-state-unreadable', `${run.state} cannot be read as a state document (${err.message}). Point --state at the parent run's orchestrator-state.yml.`, run) };
  }
  if (!isPlainObject(doc) || !isPlainObject(doc.workflow)) {
    return { refusal: refused('subrun-path-not-a-run', `${run.state} carries no workflow block, so the engine never froze it. Run the verb on the parent run's frozen state.`, run) };
  }
  return doc;
}

/** A definition file the lookup named, read at its absolute path, so its prose companion is found beside it. */
function readAt(root, shown) {
  return readDefinition(path.isAbsolute(shown) ? shown : path.join(root, ...shown.split('/')));
}

function stoppedLine(node, entry) {
  const values = isPlainObject(entry.values) ? entry.values : {};
  const runId = typeof values.run_id === 'string' && values.run_id !== '' ? values.run_id : basename(String(values.task_path ?? ''));
  return `stopped: ${node} run=${runId} — the sub-run stopped and the stop patch is written: run run-complete`;
}

function done(run, ending) {
  return { ok: true, writes: run.writes, warnings: run.warnings, ...ending };
}

/** A refusal, its message saying which of this call's writes landed before it. */
function refused(code, message, run) {
  const landed = run.writes.length ? ` Landed before this refusal: ${run.writes.map(each => each.label).join(', ')}.` : '';
  return { ok: false, code, message: `${message}${landed}`, writes: run.writes, warnings: run.warnings };
}

function relativeTo(root, dir) {
  return path.relative(root, dir).split(path.sep).join('/');
}

function spelled(value) {
  return value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

function basename(value) {
  return spelled(value).split('/').pop();
}
