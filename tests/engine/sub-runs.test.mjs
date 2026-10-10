import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DECLARED, ENGINE_DIR, freeze, freezePatch, lastLine, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';

const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');

/**
 * A parent whose `workflow:` node has started a child run and is waiting on it:
 * the terminal-driver walk's W1 (the node starts), W2 (the child freezes with
 * its parent link) and W3 (the parent records the link). The report the
 * parent's completed analysis declares is on disk, so its close prints only
 * what the sub-run decides.
 */
function waiting(t) {
  const parent = scratch(t);
  freeze(parent);
  fs.mkdirSync(path.join(parent.dir, 'analysis'), { recursive: true });
  fs.writeFileSync(path.join(parent.dir, 'analysis/report.md'), '');
  write(parent, {
    nodes: {
      analysis: { status: 'completed' },
      approval: { status: 'completed' },
      implementation: { status: 'completed' },
      research: { status: 'running' },
    },
  });

  const child = sibling(parent, { type: 'research', name: '2026-01-05-open-questions' });
  freeze(child, {
    definition: RESEARCH,
    task: { title: 'Open questions', description: 'What did the implementation leave open?' },
    inputs: { question: 'What did the implementation leave open?', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'research' } },
  });

  write(parent, { nodes: { research: { status: 'waiting', values: { task_path: child.path, run_id: child.name } } } });
  return { parent, child };
}

function complete(run) {
  return verb(['run-complete', `--state=${run.state}`]);
}

test('the child freezes with its parent link, its inputs and its own context block', t => {
  const { parent, child } = waiting(t);
  const state = readState(child);
  assert.deepEqual(state.orchestrator.parent, { run: parent.path, node: 'research' });
  assert.deepEqual(state.orchestrator.driver, { kind: 'terminal' });
  assert.deepEqual(state.orchestrator.options.inputs, { question: 'What did the implementation leave open?', embedded: true });
  assert.equal(state.workflow.name, 'research');
  assert.equal(state.orchestrator.started_phase, null, 'a child freeze seeds started_phase like a parent freeze');
  assert.match(state.orchestrator.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, 'a child freeze stamps created although its patch carried none');
  write(child, { context: { research_type: 'technical' } });
  assert.equal(readState(child).research_context.research_type, 'technical');
});

const SHOWS_SETS = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const BARE_COCKPIT = { kind: 'cockpit', cwd: '/work' };

/**
 * A child of `parent` frozen with `driver` through the shipped writer, linked to
 * `link` (the parent's own directory unless given); the write is not asserted.
 */
function childFreeze(parent, driver, { name = '2026-01-05-child', link = parent.path } = {}) {
  const child = sibling(parent, { type: 'research', name });
  const { patch } = freezePatch({
    definition: RESEARCH,
    task: { title: 'Open questions' },
    inputs: { question: 'What is open?', embedded: true },
    orchestrator: { driver, parent: { run: link, node: 'research' } },
  });
  return { child, result: verb(['write-state', `--state=${child.state}`], patch) };
}

function drivenParent(t, driver) {
  const parent = scratch(t);
  freeze(parent, { orchestrator: driver ? { driver } : {} });
  return parent;
}

test('features: a cockpit child copies its parent\'s driver features at the freeze', t => {
  const parent = drivenParent(t, SHOWS_SETS);
  const { child, result } = childFreeze(parent, BARE_COCKPIT);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(readState(child).orchestrator.driver, SHOWS_SETS);
});

test('features: a child never gains a feature its parent lacks', t => {
  const parent = drivenParent(t, SHOWS_SETS);
  const { child: narrowed } = childFreeze(parent, { ...BARE_COCKPIT, features: ['question-sets', 'other'] });
  assert.deepEqual(readState(narrowed).orchestrator.driver.features, ['question-sets']);

  const bare = drivenParent(t, BARE_COCKPIT);
  const { child: claimed } = childFreeze(bare, SHOWS_SETS);
  assert.deepEqual(readState(claimed).orchestrator.driver, BARE_COCKPIT, 'no features key is left');
});

test('features: a parent with none gives a child with none, and a terminal child is left as sent', t => {
  const bare = drivenParent(t, BARE_COCKPIT);
  const { child, result } = childFreeze(bare, BARE_COCKPIT);
  assert.equal(result.stderr, '');
  assert.deepEqual(readState(child).orchestrator.driver, BARE_COCKPIT);

  const terminal = drivenParent(t, null);
  const { child: plain, result: plainResult } = childFreeze(terminal, { kind: 'terminal' });
  assert.equal(plainResult.stderr, '');
  assert.deepEqual(readState(plain).orchestrator.driver, { kind: 'terminal' });
});

test('features: an unreadable parent vouches for none and warns', t => {
  const root = scratch(t);
  const { child, result } = childFreeze(root, SHOWS_SETS, { name: '2026-01-05-orphan', link: '.maister/tasks/development/2026-01-05-missing' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^warning: driver-features-parent-unread:\.maister\/tasks\/development\/2026-01-05-missing\n$/);
  assert.deepEqual(readState(child).orchestrator.driver, BARE_COCKPIT);
});

test('waiting: the node is not finished, and the dashboard reads it as in progress', t => {
  const { parent, child } = waiting(t);
  const node = readState(parent).workflow.nodes.research;
  assert.equal(node.status, 'waiting');
  assert.deepEqual(node.values, { task_path: child.path, run_id: child.name });
  assert.match(node.started, /Z$/, 'started was stamped when the node went running');
  assert.equal(node.completed, undefined, 'a waiting node carries no completed stamp');
  assert.equal(readDashboard(parent).phases.find(phase => phase.id === 'research').status, 'in_progress');
});

test('waiting: the parent run has not ended, so run-complete refuses it', t => {
  const { parent } = waiting(t);
  const result = complete(parent);
  assert.equal(result.code, 1);
  assert.equal(lastLine(result.stdout), 'RUN-FAILED: run-not-ended');
});

test('completion: the child ends, the parent adopts it and ends RUN-COMPLETE', t => {
  const { parent, child } = waiting(t);
  const childNodes = Object.keys(readState(child).workflow.nodes);
  write(child, { task: { status: 'completed' }, nodes: Object.fromEntries(childNodes.map(id => [id, { status: 'completed' }])) });
  assert.equal(lastLine(complete(child).stdout), 'RUN-COMPLETE');

  write(parent, {
    task: { status: 'completed' },
    nodes: { research: { status: 'completed', values: { task_path: child.path, run_id: child.name, conclusions: 'two gaps' } } },
    node_summaries: { research: { status: 'completed', summary: `Sub-run ${child.name} completed.` } },
  });
  const node = readState(parent).workflow.nodes.research;
  assert.equal(node.status, 'completed');
  assert.equal(node.values.conclusions, 'two gaps');
  assert.match(node.completed, /Z$/);

  const result = complete(parent);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('a failed child fails the parent with the sub-run named in the marker', t => {
  const { parent, child } = waiting(t);
  write(child, { task: { status: 'failed' }, nodes: { 'research-foundation': { status: 'failed' } } });
  assert.equal(lastLine(complete(child).stdout), 'RUN-FAILED: node research-foundation failed');

  write(parent, { task: { status: 'failed' }, nodes: { research: { status: 'failed' } } });
  const result = complete(parent);
  assert.equal(result.code, 1);
  assert.equal(lastLine(result.stdout), `RUN-FAILED: sub-run ${child.name} failed`);
});

test('a stopped child stops the parent: a notice line, then RUN-COMPLETE last', t => {
  const { parent, child } = waiting(t);
  write(parent, {
    task: { status: 'stopped' },
    nodes: { research: { status: 'stopped' } },
    node_summaries: { research: { status: 'skipped', summary: `Sub-run ${child.name} stopped.` } },
  });
  const result = complete(parent);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `run stopped: research - sub-run ${child.name} stopped\nRUN-COMPLETE\n`);
  assert.equal(readDashboard(parent).phases.find(phase => phase.id === 'research').status, 'skipped');
});

/**
 * A parent whose `workflow:` node declares the child's artifacts, waiting on a
 * research child that has run: the same walk as `waiting`, on a definition
 * whose sub-run node declares a report file and a findings directory.
 */
function declaring(t) {
  const parent = scratch(t, { type: 'survey' });
  freeze(parent, { definition: DECLARED, inputs: { subject: 'What is left open?' } });
  write(parent, {
    nodes: {
      scan: { status: 'completed', values: { blocking: false } },
      review: { status: 'completed' },
      probe: { status: 'running' },
    },
  });
  const child = sibling(parent, { type: 'research', name: '2026-01-05-left-open' });
  freeze(child, {
    definition: RESEARCH,
    task: { title: 'Left open' },
    inputs: { question: 'What is left open?', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'probe' } },
  });
  write(parent, { nodes: { probe: { status: 'waiting', values: { task_path: child.path, run_id: child.name } } } });
  return { parent, child };
}

/** Put a file into a run directory, creating its folder. */
function place(run, relative) {
  const file = path.join(run.dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${relative}\n`);
}

/** The parent's adopting write (W4) for a completed child, its summary listing no artifacts. */
function adopt(parent, child, values = { task_path: child.path, run_id: child.name, conclusions: 'two gaps' }) {
  write(parent, {
    nodes: { probe: { status: 'completed', values } },
    node_summaries: { probe: { summary: `Sub-run ${child.name} completed.` } },
  });
}

test('adoption: the child\'s declared artifacts are registered on the parent, relative to the parent\'s directory', t => {
  const { parent, child } = declaring(t);
  place(child, 'outputs/research-report.md');
  place(child, 'outputs/research-report.html');
  place(child, 'analysis/findings/source-1.md');
  adopt(parent, child);
  const at = `../../research/${child.name}`;
  const expected = [
    { path: `${at}/outputs/research-report.md`, label: null, html: `${at}/outputs/research-report.html` },
    { path: `${at}/analysis/findings`, label: null, html: null },
  ];
  assert.deepEqual(readState(parent).node_summaries.probe.artifacts, expected);
  assert.deepEqual(readDashboard(parent).phases.find(phase => phase.id === 'probe').artifacts, expected);
  for (const artifact of expected) assert.ok(fs.existsSync(path.join(parent.dir, artifact.path)), artifact.path);
});

test('adoption: a file of the same name in the parent\'s own directory is never claimed for the child', t => {
  const { parent, child } = declaring(t);
  place(parent, 'outputs/research-report.md');
  adopt(parent, child);
  assert.equal(Object.hasOwn(readState(parent).node_summaries.probe, 'artifacts'), false);
});

test('adoption: a workflow node that records no task_path registers nothing', t => {
  const { parent, child } = declaring(t);
  place(child, 'outputs/research-report.md');
  place(parent, 'outputs/research-report.md');
  adopt(parent, child, { conclusions: 'two gaps' });
  assert.equal(Object.hasOwn(readState(parent).node_summaries.probe, 'artifacts'), false);
});

for (const [label, parentLink] of [
  ['climbs out of the repository root', { run: '../elsewhere', node: 'research' }],
  ['is absolute', { run: '/tmp/run', node: 'research' }],
  ['names no node', { run: '.maister/tasks/development/x' }],
]) {
  test(`refusal: a parent link that ${label}`, t => {
    const parent = scratch(t);
    const child = sibling(parent, { type: 'research', name: '2026-01-05-child' });
    const result = verb(['write-state', `--state=${child.state}`], {
      task: { title: 'Child', status: 'in_progress' },
      workflow: { name: 'research', nodes: { 'research-foundation': { kind: 'direct' } } },
      orchestrator: { parent: parentLink },
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^state-patch-invalid\b/);
    assert.equal(fs.existsSync(child.state), false, 'a refused first write creates no state file');
  });
}
