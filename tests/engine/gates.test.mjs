import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

// The request-writing verb is not part of this edition, so a suspend is set up
// the way it lands on disk — the request file beside the state, then the
// pending marker and the suspended node through the state writer — and the
// answer is taken the way every driver takes it: the answer in the request file,
// then one write clearing the marker.

const MARKER = { node: 'approval', request: 'gates/approval.request.yml', since: '2026-01-05T09:00:00Z' };

function suspended(t) {
  const run = scratch(t, { fixture: 'gate' });
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } } });
  write(run, { orchestrator: { gate_pending: MARKER }, nodes: { approval: { status: 'suspended' } } });
  return run;
}

function answer(run) {
  fs.copyFileSync(path.join(FIXTURES, 'gates/approval.answered.yml'), path.join(run.dir, 'gates/approval.request.yml'));
  return write(run, {
    orchestrator: { gate_pending: null },
    nodes: { approval: { status: 'completed' } },
    node_summaries: {
      approval: { status: 'completed', decisions: [{ option: 'continue', answered_by: 'operator', at: '2026-01-05T09:05:00Z' }] },
    },
  });
}

test('suspend: the marker and the suspended node land, and the card shows no answer yet', t => {
  const run = suspended(t);
  const state = readState(run);
  assert.deepEqual(state.orchestrator.gate_pending, MARKER);
  assert.equal(state.workflow.nodes.approval.status, 'suspended');
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^ {2}gate_pending: \{node: approval, request: gates\/approval\.request\.yml, since: "2026-01-05T09:00:00Z"\}$/m,
    'the marker is one flow line, the form the enforcement hook reads');
  const card = readDashboard(run).phases.find(phase => phase.id === 'approval').gate;
  assert.deepEqual(card, { question: 'Analysis complete. Continue to implementation?', answer: null });
});

test('answer: clearing the marker completes the node and regenerates the gate index', t => {
  const run = suspended(t);
  const result = answer(run);
  assert.match(result.stdout, /^gates\/index\.yml$/m);

  const state = readState(run);
  assert.equal(state.orchestrator.gate_pending, null);
  assert.match(fs.readFileSync(run.state, 'utf8'), /^ {2}gate_pending: null$/m, 'the cleared marker is the literal null');
  assert.equal(state.workflow.nodes.approval.status, 'completed');

  const index = fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8');
  assert.equal(index, [
    'version: 1',
    'entries:',
    '  - {node: approval, request: gates/approval.request.yml, kind: approval, asked_at: "2026-01-05T09:00:00Z", status: answered}',
    '',
  ].join('\n'));

  const phase = readDashboard(run).phases.find(entry => entry.id === 'approval');
  assert.equal(phase.status, 'completed');
  assert.deepEqual(phase.gate, { question: 'Analysis complete. Continue to implementation?', answer: 'Continue to implementation' });
  assert.equal(phase.decisions[0].decision, 'continue');
});

test('the index mirrors the request file, not the patch: cleared before the answer lands, it still reads pending', t => {
  const run = suspended(t);
  write(run, { orchestrator: { gate_pending: null } });
  assert.match(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), /status: pending\}$/m);
});

test('terminal mode: an in-session answer writes no gate files at all', t => {
  const run = scratch(t);
  freeze(run);
  const result = write(run, { orchestrator: { gate_pending: null }, nodes: { approval: { status: 'completed' } } });
  assert.doesNotMatch(result.stdout, /gates\//);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false);
});

for (const [label, marker] of [
  ['a marker missing since', { node: 'approval', request: 'gates/approval.request.yml' }],
  ['a marker with an extra key', { ...MARKER, answer: 'continue' }],
  ['a request file named for another node', { ...MARKER, request: 'gates/other.request.yml' }],
  ['a since that is not a measured UTC time', { ...MARKER, since: '2026-01-05 09:00' }],
  ['a marker sent as text', 'approval'],
]) {
  test(`refusal: ${label}`, t => {
    const run = scratch(t, { fixture: 'gate' });
    freeze(run);
    const before = fs.readFileSync(run.state, 'utf8');
    const result = verb(['write-state', `--state=${run.state}`], { orchestrator: { gate_pending: marker } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^state-gate-pending-form\b/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  });
}
