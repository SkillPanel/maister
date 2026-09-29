import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, lastLine, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';

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
