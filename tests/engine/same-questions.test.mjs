import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readState, scratch, verb, write } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { walk } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs';
import { inNodeQuestions } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs';

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
//
// A second snapshot, `fixtures/asked-questions-text.json`, pins the words: per
// built-in and driver, each gate's question, header and option labels as the
// rich picker (`gate-brief --json --picker=rich`) or the gate request
// (`--request`, its checkpoint included, less the run's own paths) puts them, and the gates a walk from
// the start reaches when every gate is answered with its first continue. The
// checkpoint's `decisions.operator.actors` and every `actor_kind` are masked:
// they are bookkeeping the autonomy model added beside the question. It was
// taken after the autonomy model landed, which is sound: under the built-in
// default policy an independent comparison of every gate's brief, pickers,
// checkpoint and request, old engine against new, found no difference beyond
// those masked keys, so this text is the text from before. Regenerate it with
// the same variable, and only when a question's words are meant to change.

const WORKFLOWS_DIR = path.join(ENGINE_DIR, 'workflows');
const SNAPSHOT = path.join(FIXTURES, 'asked-questions.json');
const TEXT_SNAPSHOT = path.join(FIXTURES, 'asked-questions-text.json');

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
  development: 10,
  migration: 3,
  performance: 5,
  'product-design': 12,
  research: 6,
};

/** The built-in default policy's hash, which every run frozen under it records. */
const DEFAULT_HASH = 'sha256:2430f1a2ad2982d0067885488a4c89e21ad1d7c83b115ba8f1b20acc88dfaea8';

/**
 * What the projection saw beside the questions, kept out of the snapshot: each
 * frozen run's state after its last write, and every gate request it built.
 * `texts` is what the second snapshot pins, keyed `<built-in>/<driver>`.
 */
const seen = { states: [], requests: [], texts: {} };

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
// In-node questions, parsed from the node prose by the engine's own parser
// ---------------------------------------------------------------------------

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
  const texts = {};
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
      texts[node.id] = {
        question: picker.question,
        header: picker.header,
        options: picker.options.map(({ id, label, description }) => ({ id, label, description })),
      };
    } else {
      const request = JSON.parse(ok(verb([...base, '--request']), `gate-brief ${node.id}`));
      seen.requests.push({ at: `${name}/${driverName}/${node.id}`, request });
      offered = { transport: 'gate-request', kind: request.kind, options: request.options.map(option => option.id) };
      // The checkpoint less `run`, which names the scratch directory.
      const { run: _run, ...checkpoint } = request.context.checkpoint;
      texts[node.id] = { question: request.question, options: request.options, checkpoint: withoutActors(checkpoint) };
    }
    gates[node.id] = offered;
  }
  seen.states.push({ at: `${name}/${driverName}`, state: readState(run) });
  seen.texts[`${name}/${driverName}`] = { gates: texts, reached: reachedUnder(t, name, driverName) };
  return { graph, gates };
}

/** `value` without `decisions.operator.actors` or any `actor_kind`, the keys the text snapshot masks. */
function withoutActors(value) {
  if (Array.isArray(value)) return value.map(withoutActors);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'actor_kind')
    .map(([key, each]) => {
      if (key === 'decisions' && each?.operator && typeof each.operator === 'object') {
        const { actors: _actors, ...operator } = each.operator;
        return [key, withoutActors({ ...each, operator })];
      }
      return [key, withoutActors(each)];
    }));
}

/** The defaults a built-in's inputs declare, which its guards read when the run sets none. */
function defaultsOf(name) {
  const inputs = readDefinition(path.join(WORKFLOWS_DIR, `${name}.yml`)).doc?.inputs ?? {};
  return Object.fromEntries(Object.entries(inputs)
    .filter(([, declared]) => declared && typeof declared === 'object' && Object.hasOwn(declared, 'default'))
    .map(([key, declared]) => [key, declared.default]));
}

/**
 * The gates a run of `name` under `driverName` reaches from its start, every
 * node recorded through the writer as it ends — a task completed with its
 * declared values, a gate with its first continue — and each next node found
 * by the engine's own walker over what the run recorded, the nodes it skips
 * recorded skipped.
 */
function reachedUnder(t, name, driverName) {
  const { driver } = DRIVERS[driverName];
  const run = scratch(t, { type: name, name: `2026-10-09-${name}-${driverName}-walk` });
  const inputs = BUILT_INS[name];
  const graph = freeze(run, { definition: path.join(WORKFLOWS_DIR, `${name}.yml`), inputs, orchestrator: { driver } });
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const defaults = defaultsOf(name);
  const reached = [];
  let current = graph.nodes.find(node => !(node.needs ?? []).length) ?? null;
  while (current) {
    const { id } = current;
    if (current.type === 'gate') {
      reached.push(id);
      write(run, {
        nodes: { [id]: { status: 'completed' } },
        node_summaries: { [id]: { decisions: [{ option: firstContinue(current), answered_by: 'operator', at: '2026-10-09T09:00:00Z' }] } },
      });
    } else {
      write(run, { nodes: { [id]: completedEntry(current) }, node_summaries: { [id]: SUMMARY } });
    }
    const step = walk({ graph, recorded: readState(run).workflow.nodes, gate: id, inputs, defaults });
    if (!step.ok) throw new Error(`${name}/${driverName}: the walk from ${id} failed: ${JSON.stringify(step.errors)}`);
    if (step.skipped.length) write(run, { nodes: Object.fromEntries(step.skipped.map(each => [each, { status: 'skipped' }])) });
    current = step.next === null ? null : byId.get(step.next);
  }
  return reached;
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

  // The words: every gate's question and option labels under each driver, and
  // the gates a walk from the start reaches on each gate's first continue.
  const texts = stable(seen.texts);
  if (process.env.SNAPSHOT_QUESTIONS === '1') fs.writeFileSync(TEXT_SNAPSHOT, texts);
  const pinned = JSON.parse(fs.readFileSync(TEXT_SNAPSHOT, 'utf8'));
  assert.equal(Object.keys(pinned).length, Object.keys(BUILT_INS).length * Object.keys(DRIVERS).length);
  for (const [at, { gates, reached }] of Object.entries(pinned)) {
    assert.ok(reached.length, `${at}: the walk reached no gate`);
    for (const id of reached) assert.ok(Object.hasOwn(gates, id), `${at}: the walk reached ${id}, which has no pinned text`);
  }
  assert.deepEqual(JSON.parse(texts), pinned);
});

// ---------------------------------------------------------------------------
// The prose the classing write adds, read from the shipped files
// ---------------------------------------------------------------------------

/** The engine's SKILL.md. */
function skillText() {
  return fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8');
}

/** The text of the section headed exactly `heading`, up to the next heading of its level or above. */
function sectionOf(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line === heading);
  assert.ok(start >= 0, `no section headed ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, at) => at > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The paragraphs of `text` that mention `needle`. */
function paragraphsNaming(text, needle) {
  return text.split(/\n\s*\n/).filter(paragraph => paragraph.includes(needle));
}

/** The publish paragraph every closing node carries under a dispatch driver. */
const PUBLISH = '**Under a dispatch driver, publish the close-out through the outbox close-out';

/** What the close-out order rule names. */
const HELD_BRIEF = '`gate-brief --node=held-approval`';

test('every closing node, and the engine\'s dispatched ending, asks held-approval before the close-out publish', () => {
  for (const name of Object.keys(BUILT_INS)) {
    const text = proseOf(name);
    const publish = text.indexOf(PUBLISH);
    assert.ok(publish >= 0, `${name}.md: no close-out publish paragraph`);
    const sectionStart = text.lastIndexOf('\n## `', publish);
    const section = text.slice(sectionStart, text.indexOf('\n## ', publish) === -1 ? undefined : text.indexOf('\n## ', publish));
    const rule = section.indexOf(HELD_BRIEF);
    assert.ok(rule >= 0, `${name}.md: the closing node's section never names ${HELD_BRIEF}`);
    assert.ok(sectionStart + rule < publish, `${name}.md: ${HELD_BRIEF} comes after the close-out publish`);
  }
  const ending = sectionOf(skillText(), '### Ending a dispatched run');
  assert.ok(ending.includes(HELD_BRIEF), `SKILL.md § Ending a dispatched run never names ${HELD_BRIEF}`);
  assert.ok(ending.includes('`task.status: completed`'), 'the fallback\'s closing patch records task.status completed');
  assert.ok(ending.includes('`gate-brief-nothing-held`'), 'the ending names the nothing-held refusal');
});

test('the classing preamble and close-out lines add no question-set marker, so the parser counts stay', () => {
  for (const [name, count] of Object.entries(IN_NODE_COUNTS)) {
    const text = proseOf(name);
    const added = [...paragraphsNaming(text, '`ask:`'), ...paragraphsNaming(text, 'held-approval')];
    assert.ok(added.length >= 2, `${name}.md: the classing preamble or the close-out order rule is missing`);
    for (const paragraph of added) {
      assert.ok(!/\*\*(With|Without) question sets\*\*/.test(paragraph), `${name}.md: a question-set marker in ${paragraph.slice(0, 80)}…`);
    }
    assert.equal(inNodeQuestions(text).length, count, `${name}.md: the parser count moved`);
  }
});

test('every new refusal and warning has its row in the engine SKILL.md', () => {
  const skill = skillText();
  const rows = {
    'gate-brief-nothing-to-ask': '### Before every gate — the gate brief',
    'gate-brief-nothing-held': '### Before every gate — the gate brief',
    'run-held-unapproved': '### When `run-complete` refuses',
    'held-gate-skipped': '## Writing state',
    'autonomy-ceiling-parent-unread': '## Writing state',
  };
  for (const [code, heading] of Object.entries(rows)) {
    const section = sectionOf(skill, heading);
    const row = section.split('\n').find(line => /^\s*(?:- |\| )/.test(line) && line.includes(`\`${code}`));
    assert.ok(row, `${heading} has no row for ${code}`);
  }
  const triage = sectionOf(skill, '## In-node questions');
  assert.ok(triage.includes('### When the policy classes a question'), 'the classing subsection closes § In-node questions');
});
