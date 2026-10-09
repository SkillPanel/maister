import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readState, scratch, verb, write } from '../helpers.mjs';

// What every built-in asks, and how each question reaches a person under each
// driver, pinned against a snapshot taken from the engine before the autonomy
// model changed anything. A change that moves a gate, an option, an in-node
// question or the way any of them is carried shows here as a diff against
// `fixtures/asked-questions.json`.
//
// The projection holds questions, options and transports only — no hash,
// timestamp or state key — so a change that adds bookkeeping beside a question
// leaves the snapshot as it is. Regenerate it only when a question is meant to
// change: `SNAPSHOT_QUESTIONS=1 node --test tests/engine/same-questions.test.mjs`.

const WORKFLOWS_DIR = path.join(ENGINE_DIR, 'workflows');
const SNAPSHOT = path.join(FIXTURES, 'asked-questions.json');

/** The built-ins, each with the required inputs a freeze takes. */
const BUILT_INS = {
  development: { task_description: 'Add a settings page' },
  migration: { task_description: 'Move the store to SQLite' },
  performance: { task_description: 'Speed up the report' },
  'product-design': { task_description: 'Design a notes app' },
  research: { question: 'Which store keeps notes safe?' },
};

/**
 * The three drivers. A gate goes to the in-session picker when no driver asks
 * for it and to a gate request under a cockpit or a dispatch driver — the gate
 * rule every orchestrator follows; the engine renders each form.
 */
const DRIVERS = {
  terminal: { driver: { kind: 'terminal' }, gate: 'picker' },
  cockpit: { driver: { kind: 'cockpit', cwd: '/work', features: ['question-sets'] }, gate: 'gate-request' },
  dispatch: { driver: { kind: 'dispatch', cwd: '/work' }, gate: 'gate-request' },
};

/** The in-node question ids each node-prose file names, counted by hand. */
const IN_NODE_COUNTS = {
  development: 9,
  migration: 3,
  performance: 5,
  'product-design': 11,
  research: 6,
};

/** The built-in default policy's hash, which every run frozen under it records. */
const DEFAULT_HASH = 'sha256:2430f1a2ad2982d0067885488a4c89e21ad1d7c83b115ba8f1b20acc88dfaea8';

/**
 * What the projection saw beside the questions, kept out of the snapshot: each
 * frozen run's state after its last write, and every gate request it built.
 */
const seen = { states: [], requests: [] };

/** The dotted paths of every `triage` key anywhere in `value`. */
function triageKeys(value, at = '') {
  if (Array.isArray(value)) return value.flatMap((each, index) => triageKeys(each, `${at}.${index}`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, each]) => [
    ...(key === 'triage' ? [`${at}.${key}`] : []),
    ...triageKeys(each, `${at}.${key}`),
  ]);
}

/** The summary every node before a gate records, so each gate's brief renders. */
const SUMMARY = { status: 'completed', summary: 'Done.', decisions: [], risks: [] };

// ---------------------------------------------------------------------------
// In-node questions, parsed from the node prose
// ---------------------------------------------------------------------------

/** A node's heading in the prose: `## \`node-id\``. */
const NODE_HEADING = /^## `([a-z0-9-]+)`\s*$/;

/** A question-set line, its parenthesis optional: `**With question sets** (the studio's \`id\`):`. */
const QUESTION_LINE = /\*\*(With|Without) question sets\*\*(?:\s*\(([^)]*)\))?/;

/** The backticked id inside a question-set line's parenthesis, any qualifier before it. */
const QUESTION_ID = /`([a-z0-9-]+)`/;

/**
 * Every `{node, id}` a node-prose file names on its With/Without question-set
 * lines, in file order, each pair counted once. A line with no parenthesis — the
 * file's preamble, or a `With` line whose `Without` partner carries the id —
 * names no question.
 */
export function inNodeQuestions(text) {
  const found = [];
  const seen = new Set();
  let node = null;
  for (const line of text.split('\n')) {
    const heading = NODE_HEADING.exec(line);
    if (heading) {
      node = heading[1];
      continue;
    }
    const match = QUESTION_LINE.exec(line);
    if (!match || match[2] === undefined) continue;
    const id = QUESTION_ID.exec(match[2])?.[1];
    if (!id || node === null) continue;
    const key = `${node}\0${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ node, id });
  }
  return found;
}

function proseOf(name) {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, `${name}.md`), 'utf8');
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

/** A value a declared output type accepts: false for a bool, the first member of an enum. */
function valueOf(type) {
  if (type === 'bool') return false;
  if (type && Array.isArray(type.enum)) return type.enum[0];
  return 'x';
}

/** The option ids of a gate, in the definition's order. */
function optionIds(gate) {
  return Object.keys(gate.options ?? {});
}

/** A gate's first continue option: the answer each gate before the asked one records. */
function firstContinue(gate) {
  return Object.entries(gate.options ?? {})
    .find(([, option]) => (typeof option === 'string' ? option : option.effect) === 'continue')?.[0];
}

/** The record a node before the asked gate leaves: completed, its declared values set. */
function completedEntry(node) {
  const entry = { status: 'completed' };
  if (node.outputs?.values) {
    entry.values = Object.fromEntries(Object.entries(node.outputs.values).map(([key, type]) => [key, valueOf(type)]));
  }
  return entry;
}

function ok(result, what) {
  if (result.code !== 0) throw new Error(`${what} exited ${result.code}: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** How each gate of `name` is carried under `driverName`: its form and the options it offers. */
function gatesUnder(t, name, driverName) {
  const { driver, gate: form } = DRIVERS[driverName];
  const run = scratch(t, { type: name, name: `2026-10-09-${name}-${driverName}` });
  const graph = freeze(run, {
    definition: path.join(WORKFLOWS_DIR, `${name}.yml`),
    inputs: BUILT_INS[name],
    orchestrator: { driver },
  });
  const gates = {};
  let done = 0;
  for (const [index, node] of graph.nodes.entries()) {
    if (node.type !== 'gate') continue;
    // Everything before this gate ends: a node with a summary, a gate with its first continue.
    const nodes = {};
    const node_summaries = {};
    for (const earlier of graph.nodes.slice(done, index)) {
      nodes[earlier.id] = completedEntry(earlier);
      node_summaries[earlier.id] = earlier.type === 'gate'
        ? { decisions: [{ option: firstContinue(earlier), answered_by: 'operator', at: '2026-10-09T09:00:00Z' }] }
        : SUMMARY;
    }
    if (Object.keys(nodes).length) write(run, { nodes, node_summaries });
    done = index;
    const base = ['gate-brief', `--state=${run.state}`, `--node=${node.id}`];
    let offered;
    if (form === 'picker') {
      const picker = JSON.parse(ok(verb([...base, '--json', '--picker=rich']), `gate-brief ${node.id}`));
      offered = { transport: 'picker', options: picker.options.map(option => option.id) };
    } else {
      const request = JSON.parse(ok(verb([...base, '--request']), `gate-brief ${node.id}`));
      seen.requests.push({ at: `${name}/${driverName}/${node.id}`, request });
      offered = { transport: 'gate-request', kind: request.kind, options: request.options.map(option => option.id) };
    }
    gates[node.id] = offered;
  }
  seen.states.push({ at: `${name}/${driverName}`, state: readState(run) });
  return { graph, gates };
}

/**
 * How an in-node question is carried under a driver, as the engine decides it:
 * a question-set request when it builds one, else in session when no driver
 * asks for it, else the default the node prose names.
 */
function inNodeUnder(t, name, driverName, questions) {
  const { driver } = DRIVERS[driverName];
  const run = scratch(t, { type: name, name: `2026-10-09-${name}-${driverName}-asked` });
  freeze(run, { definition: path.join(WORKFLOWS_DIR, `${name}.yml`), inputs: BUILT_INS[name], orchestrator: { driver } });
  const file = path.join(run.dir, '.state-patch.json');
  const carried = [];
  for (const { node, id } of questions) {
    write(run, { nodes: { [node]: { status: 'running' } } });
    fs.writeFileSync(file, JSON.stringify({ questions: [probe(id)] }));
    const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--request', `--patch-file=${file}`]);
    let transport;
    if (result.code === 0) {
      const request = JSON.parse(result.stdout);
      seen.requests.push({ at: `${name}/${driverName}/${node}/${id}`, request });
      transport = request.kind === 'question' ? 'question-set' : `request:${request.kind}`;
    } else if (/^gate-brief-questions-unsupported: /.test(result.stderr)) {
      transport = driver.kind === 'terminal' ? 'in-session' : 'default';
    } else {
      throw new Error(`gate-brief ${node}/${id} exited ${result.code}: ${result.stderr}`);
    }
    carried.push({ node, id, transport });
    write(run, { nodes: { [node]: { status: 'pending' } } });
  }
  seen.states.push({ at: `${name}/${driverName}/asked`, state: readState(run) });
  return carried;
}

/** A one-question set carrying `id`, the smallest the engine accepts. */
function probe(id) {
  return {
    id,
    header: 'Probe',
    question: 'Which way?',
    multi_select: false,
    allow_other: false,
    options: [
      { id: 'one', label: 'One', description: 'The first way.', recommended: true },
      { id: 'two', label: 'Two', description: 'The second way.' },
    ],
  };
}

/** The whole projection: per built-in, its gates and in-node questions under each driver. */
function project(t) {
  const out = {};
  for (const name of Object.keys(BUILT_INS)) {
    const questions = inNodeQuestions(proseOf(name));
    const perDriver = {};
    let graph = null;
    for (const driverName of Object.keys(DRIVERS)) {
      const gated = gatesUnder(t, name, driverName);
      graph = gated.graph;
      perDriver[driverName] = { gates: gated.gates, in_node: inNodeUnder(t, name, driverName, questions) };
    }
    const gates = graph.nodes.filter(node => node.type === 'gate').map(node => ({ id: node.id, options: optionIds(node) }));
    out[name] = { gates, in_node: questions, drivers: perDriver };
  }
  return out;
}

/** JSON with every object's keys sorted, two-space indented, a trailing newline. */
function stable(value) {
  const sort = each => Array.isArray(each) ? each.map(sort)
    : each && typeof each === 'object' ? Object.fromEntries(Object.keys(each).sort().map(key => [key, sort(each[key])]))
      : each;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('the in-node question parser finds every id each node-prose file names', () => {
  for (const [name, count] of Object.entries(IN_NODE_COUNTS)) {
    const found = inNodeQuestions(proseOf(name));
    assert.equal(found.length, count, `${name}.md: ${found.map(each => `${each.node}/${each.id}`).join(', ')}`);
    for (const { node } of found) assert.ok(node, `${name}.md: a question id outside any node section`);
  }
});

test('the product-design mockup pair: no id on the With line, a qualifier before the Without line\'s id', () => {
  const lines = proseOf('product-design').split('\n');
  const withLine = lines.find(line => line.startsWith('**With question sets**: the same'));
  const withoutLine = lines.find(line => line.includes('(the studio\'s `mockup-refinement`)'));
  assert.ok(withLine && withoutLine, 'the visual-prototyping pair is where the snapshot expects it');
  assert.deepEqual(inNodeQuestions(`## \`visual-prototyping\`\n${withLine}\n`), []);
  assert.deepEqual(inNodeQuestions(`## \`visual-prototyping\`\n${withLine}\n${withoutLine}\n`), [{ node: 'visual-prototyping', id: 'mockup-refinement' }]);
  assert.ok(inNodeQuestions(proseOf('product-design')).some(each => each.node === 'visual-prototyping' && each.id === 'mockup-refinement'));
});

test('every built-in asks the same questions, carried the same way, under each driver', t => {
  const projected = stable(project(t));
  if (process.env.SNAPSHOT_QUESTIONS === '1') fs.writeFileSync(SNAPSHOT, projected);
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(BUILT_INS).sort());
  for (const [name, built] of Object.entries(snapshot)) {
    assert.deepEqual(Object.keys(built.drivers).sort(), Object.keys(DRIVERS).sort(), name);
    for (const gate of built.gates) assert.ok(gate.options.length, `${name}: ${gate.id} offers no option`);
    for (const carried of Object.values(built.drivers)) {
      for (const [id, gate] of Object.entries(carried.gates)) assert.ok(gate.options.length, `${name}: ${id} carries no option`);
    }
  }
  assert.deepEqual(JSON.parse(projected), snapshot);

  // Under the built-in default every frozen built-in records the default's
  // hash, and nothing the runs wrote or were asked carries a triage.
  assert.equal(seen.states.length, Object.keys(BUILT_INS).length * Object.keys(DRIVERS).length * 2);
  for (const { at, state } of seen.states) {
    assert.equal(state.orchestrator.policy_hash, DEFAULT_HASH, at);
    assert.deepEqual(triageKeys(state), [], at);
  }
  assert.ok(seen.requests.length, 'the projection built gate requests');
  for (const { at, request } of seen.requests) assert.deepEqual(triageKeys(request), [], at);
});
