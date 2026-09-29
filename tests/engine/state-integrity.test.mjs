import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DECLARED, FIXTURES, freezePatch, readState, scratch, verb, write } from '../helpers.mjs';

// The writer holds a run to the definition it froze: the freeze is refused
// unless the graph it records re-resolves from the provenance it records.

const OVERLAY = path.join(FIXTURES, 'definitions/sample.overlay.yml');
const SUBJECT = { subject: 'acme-api' };

/** A proven freeze of the declared-outputs fixture, with its required input. */
const declared = (options = {}) => freezePatch({ definition: DECLARED, inputs: SUBJECT, ...options });

/**
 * Send a patch expected to be refused with `code`; assert nothing moved and
 * return the result. A refused first write leaves no state file behind.
 */
function refused(run, patch, code) {
  const before = fs.existsSync(run.state) ? fs.readFileSync(run.state, 'utf8') : null;
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 1, `expected ${code}, got exit ${result.code}: ${result.stderr}`);
  assert.equal(result.stdout, '', 'a refused write reports no changed paths');
  assert.match(result.stderr, new RegExp(`^${code}: `));
  const after = fs.existsSync(run.state) ? fs.readFileSync(run.state, 'utf8') : null;
  assert.equal(after, before, 'a refused write leaves the state file byte-for-byte as it was');
  return result;
}

// ---------------------------------------------------------------------------
// the freeze
// ---------------------------------------------------------------------------

// A graph_hash the definition does not resolve to is pinned beside the other
// freeze tests in write-state.test.mjs.

test('freeze: a graph resolved with an overlay but recorded without it is refused', t => {
  const run = scratch(t);
  const { patch } = freezePatch({ overlays: [OVERLAY] });
  patch.workflow.overlays = [];
  refused(run, patch, 'state-freeze-unproven');
});

test('freeze: a freeze recording no source and no graph_hash is refused', t => {
  const run = scratch(t);
  refused(run, {
    task: { title: 'Unproven', status: 'in_progress' },
    workflow: { name: 'development', nodes: { analysis: { kind: 'direct' } } },
  }, 'state-freeze-unproven');
});

test('freeze: a freeze naming a definition nothing can find is refused', t => {
  const run = scratch(t);
  const { patch } = freezePatch();
  patch.workflow.source = path.join(run.root, 'nowhere.yml');
  patch.workflow.name = 'nowhere-at-all';
  refused(run, patch, 'state-freeze-unproven');
});

for (const name of ['task', 'development', undefined]) {
  test(`freeze: a workflow name ${name === undefined ? 'left out' : `relabelled "${name}"`} is refused`, t => {
    const run = scratch(t, { type: 'survey' });
    const { patch } = declared();
    if (name === undefined) delete patch.workflow.name;
    else patch.workflow.name = name;
    const result = refused(run, patch, 'state-freeze-name-mismatch');
    assert.match(result.stderr, /"survey"/);
  });
}

test('freeze: a node set that adds a node and drops another is refused, naming both', t => {
  const run = scratch(t, { type: 'survey' });
  const { patch } = declared();
  delete patch.workflow.nodes.probe;
  patch.workflow.nodes.ghost = { kind: 'direct' };
  const result = refused(run, patch, 'state-freeze-nodes-mismatch');
  assert.match(result.stderr, /ghost/);
  assert.match(result.stderr, /probe/);
});

for (const [node, kind] of [['scan', 'skill'], ['scan', 'agent'], ['scan', undefined], ['review', 'task'], ['probe', 'task'], ['probe', 'skill']]) {
  test(`freeze: ${node} recorded as ${kind ?? 'no kind'} is refused`, t => {
    const run = scratch(t, { type: 'survey' });
    const { patch } = declared();
    patch.workflow.nodes[node] = kind === undefined ? {} : { kind };
    const result = refused(run, patch, 'state-freeze-nodes-mismatch');
    assert.match(result.stderr, new RegExp(node));
  });
}

test('freeze: a task node may be recorded as task or as its own scheme', t => {
  for (const kind of ['task', 'direct']) {
    const run = scratch(t, { type: 'survey' });
    const { patch } = declared();
    patch.workflow.nodes.scan = { kind };
    write(run, patch);
    assert.equal(readState(run).workflow.nodes.scan.kind, kind);
  }
});

test('freeze: a required input the freeze does not record is refused, naming it', t => {
  const run = scratch(t, { type: 'survey' });
  const { patch } = freezePatch({ definition: DECLARED });
  const result = refused(run, patch, 'state-freeze-input-missing');
  assert.match(result.stderr, /subject/);
  assert.match(result.stderr, /orchestrator\.options\.inputs/);
  refused(run, declared({ inputs: { subject: null } }).patch, 'state-freeze-input-missing');
});

test('freeze: a proven freeze of a workflow of its own name lands with its resolved needs', t => {
  const run = scratch(t, { type: 'survey' });
  const { patch, graph } = declared();
  const result = write(run, patch);
  assert.match(result.stdout, /^Maister run started$/m);
  const nodes = readState(run).workflow.nodes;
  for (const node of graph.nodes) assert.deepEqual(nodes[node.id].needs, node.needs, node.id);
  assert.equal(readState(run).workflow.name, 'survey');
});

test('freeze: a graph resolved with an overlay and a profile, recorded with both, lands', t => {
  const run = scratch(t);
  const { patch } = freezePatch({ overlays: [OVERLAY], profile: 'quick' });
  write(run, patch);
  const state = readState(run);
  assert.deepEqual(state.workflow.overlays, [OVERLAY]);
  assert.equal(state.workflow.profile, 'quick');
  assert.deepEqual(state.workflow.nodes.review.needs, ['implementation']);
});

