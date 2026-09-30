import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DECLARED, FIXTURES, freeze, freezePatch, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

// The writer holds a run to the definition it froze: the freeze is refused
// unless the graph it records re-resolves from the provenance it records, and
// every later node write is held to the frozen node set, the node-status
// vocabulary, the declared value types and the options each gate offers.

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

/** A frozen declared-outputs run, its scan node completed, at the review gate. */
function atReview(t) {
  const run = scratch(t, { type: 'survey' });
  write(run, declared().patch);
  write(run, { nodes: { scan: { status: 'completed', values: { blocking: false, risk_level: 'low', verdict: 'pass' } } } });
  return run;
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


test('freeze: a node status outside the vocabulary is refused', t => {
  const run = scratch(t, { type: 'survey' });
  const { patch } = declared();
  patch.workflow.nodes.scan = { kind: 'direct', status: 'bogus' };
  refused(run, patch, 'state-node-status-unknown');
});

// ---------------------------------------------------------------------------
// node writes
// ---------------------------------------------------------------------------

test('nodes: a status outside the vocabulary is refused, naming the vocabulary', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: SUBJECT });
  const result = refused(run, { nodes: { scan: { status: 'bogus' } } }, 'state-node-status-unknown');
  assert.match(result.stderr, /pending, running, waiting, suspended, completed, skipped, failed, stopped/);
  refused(run, { nodes: { scan: { status: 'in_progress' } } }, 'state-node-status-unknown');
  refused(run, { nodes: { scan: { status: null } } }, 'state-node-status-unknown');
});

test('nodes: each of the eight statuses is accepted', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: SUBJECT });
  for (const status of ['pending', 'running', 'waiting', 'suspended', 'completed', 'skipped', 'failed', 'stopped']) {
    write(run, { nodes: { scan: { status } } });
    assert.equal(readState(run).workflow.nodes.scan.status, status);
  }
});

test('nodes: a node the frozen graph does not carry is refused, and never reaches the dashboard', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: SUBJECT });
  const result = refused(run, { nodes: { ghost: { status: 'completed', values: { x: true } } } }, 'state-node-unknown');
  assert.match(result.stderr, /ghost/);
  assert.match(result.stderr, /scan, review, probe/);
  assert.equal(readDashboard(run).phases.some(phase => phase.id === 'ghost'), false);
});

test('an adopted run keeps its frozen node set and the status vocabulary', t => {
  const run = scratch(t, { fixture: 'adopted' });
  refused(run, { nodes: { approval: { status: 'answered' } } }, 'state-node-status-unknown');
  refused(run, { nodes: { implementation: { status: 'running' } } }, 'state-node-unknown');
  write(run, { nodes: { approval: { status: 'completed' } } });
});

// ---------------------------------------------------------------------------
// declared values
// ---------------------------------------------------------------------------

for (const [label, values, named] of [
  ['a bool recorded as a string', { blocking: 'false', risk_level: 'low' }, /blocking.*bool/],
  ['a bool recorded as null', { blocking: null }, /blocking.*bool/],
  ['an enum member the declaration does not list', { blocking: false, risk_level: 'maybe' }, /risk_level.*high, medium, low/],
  ['a string recorded as a number', { verdict: 42 }, /verdict.*string/],
]) {
  test(`values: ${label} is refused`, t => {
    const run = scratch(t, { type: 'survey' });
    freeze(run, { definition: DECLARED, inputs: SUBJECT });
    const result = refused(run, { nodes: { scan: { status: 'completed', values } } }, 'state-value-invalid');
    assert.match(result.stderr, named);
  });
}

test('values: declared values land, and a skipped node records its strings as null', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: SUBJECT });
  const clean = write(run, { nodes: { scan: { status: 'completed', values: { blocking: false, risk_level: 'low', verdict: 'pass' } } } });
  assert.doesNotMatch(clean.stderr, /^warning:/m);
  write(run, { nodes: { scan: { status: 'skipped', values: { blocking: false, risk_level: null, verdict: null } } } });
  assert.deepEqual(readState(run).workflow.nodes.scan.values, { blocking: false, risk_level: null, verdict: null });
});

test('values: a key the node does not declare lands, with a warning naming it', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: SUBJECT });
  const result = write(run, { nodes: { scan: { status: 'completed', values: { blocking: false, score: 97 } } } });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /^warning: wrote workflow\.nodes\.scan\.values\.score, which the definition does not declare/m);
  assert.equal(readState(run).workflow.nodes.scan.values.score, 97);
});

test('values: a workflow node carries task_path and run_id without a warning', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: SUBJECT });
  const values = { task_path: '.maister/tasks/research/2026-01-05-probe', run_id: '2026-01-05-probe', conclusions: 'two gaps' };
  const result = write(run, { nodes: { probe: { status: 'completed', values } } });
  assert.doesNotMatch(result.stderr, /^warning:/m);
});

test('values: a run whose definition changed since the freeze is not held to it', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: SUBJECT });
  const text = fs.readFileSync(run.state, 'utf8').replace(/graph_hash: "?sha256:[0-9a-f]+"?/, `graph_hash: "sha256:${'0'.repeat(64)}"`);
  fs.writeFileSync(run.state, text);
  const result = write(run, { nodes: { scan: { status: 'completed', values: { blocking: 'false' } } } });
  assert.doesNotMatch(result.stderr, /^warning:/m);
});

test('values: an adopted run with no graph to prove is not held to a definition', t => {
  const run = scratch(t, { fixture: 'adopted' });
  const result = write(run, { nodes: { analysis: { status: 'completed', values: { anything: 'goes' } } } });
  assert.doesNotMatch(result.stderr, /^warning:/m);
});

// ---------------------------------------------------------------------------
// gate answers
// ---------------------------------------------------------------------------

const ANSWER = option => ({ option, answered_by: 'operator', at: '2026-01-05T09:05:00Z' });

test('gates: a recorded option the gate does not offer is refused, naming the options it does', t => {
  const run = atReview(t);
  const result = refused(run, {
    nodes: { review: { status: 'completed' } },
    node_summaries: { review: { decisions: [ANSWER('maybe-later')] } },
  }, 'state-gate-option-unknown');
  assert.match(result.stderr, /maybe-later/);
  assert.match(result.stderr, /abandon, approve, revise/);
});

test('gates: an offered option lands, and a decision that names no option is not checked', t => {
  const run = atReview(t);
  write(run, {
    nodes: { review: { status: 'completed' } },
    node_summaries: { review: { decisions: ['looked at the evidence', ANSWER('revise')] } },
  });
  assert.equal(readState(run).node_summaries.review.decisions[1].option, 'revise');
});

// ---------------------------------------------------------------------------
// sanctioned absences
// ---------------------------------------------------------------------------

/** A frozen sample run whose analysis node completes with `absent` on its summary. */
function absentPatch(absent) {
  return { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'no report needed', absent } } };
}

test('absent: a declared artifact key with a reason lands on the node summary', t => {
  const run = scratch(t);
  freeze(run);
  write(run, absentPatch({ report: 'nothing to analyse' }));
  assert.deepEqual(readState(run).node_summaries.analysis.absent, { report: 'nothing to analyse' });
});

test('absent: a key the node does not declare is refused, naming the keys it does', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, absentPatch({ 'analysis/report.md': 'named by its path' }), 'state-absent-invalid');
  assert.match(result.stderr, /does not declare as an artifact; it declares report\./);
});

test('absent: a node that declares no artifacts sanctions none', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, {
    nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'completed' } },
    node_summaries: { implementation: { absent: { plan: 'no plan' } } },
  }, 'state-absent-invalid');
  assert.match(result.stderr, /it declares none/);
});

for (const [label, reason] of [['empty', ''], ['blank', '   '], ['non-string', 42], ['null', null]]) {
  test(`absent: an ${label} reason is refused`, t => {
    const run = scratch(t);
    freeze(run);
    const result = refused(run, absentPatch({ report: reason }), 'state-absent-invalid');
    assert.match(result.stderr, /carries its reason as text/);
  });
}

test('absent: a map is the only shape', t => {
  const run = scratch(t);
  freeze(run);
  for (const absent of [['report'], 'report', true]) refused(run, absentPatch(absent), 'state-absent-invalid');
});

test('absent: a definition changed since the freeze still holds the reason, never the key', t => {
  const run = scratch(t);
  freeze(run);
  const text = fs.readFileSync(run.state, 'utf8').replace(/graph_hash: "?sha256:[0-9a-f]+"?/, `graph_hash: "sha256:${'0'.repeat(64)}"`);
  fs.writeFileSync(run.state, text);
  refused(run, absentPatch({ report: '' }), 'state-absent-invalid');
  write(run, absentPatch({ anything: 'the key cannot be judged without the frozen graph' }));
  assert.deepEqual(Object.keys(readState(run).node_summaries.analysis.absent), ['anything']);
});
