import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DECLARED, ENGINE_DIR, freeze, lastLine, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';

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
  fs.mkdirSync(path.join(parent.dir, 'analysis'));
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
  write(child, { context: { research_type: 'technical' } });
  assert.equal(readState(child).research_context.research_type, 'technical');
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
