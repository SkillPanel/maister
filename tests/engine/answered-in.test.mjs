// A gate a sub-run's answer skipped says so: when the guard that skipped it
// reads a value the parent adopted from its child, and the child exposes that
// value from a gate it answered, the writer records the gate's `answered_in` —
// the child run, its gate and the option chosen there. Only a link it can
// trace is written; a skip for any other reason, or one two answers share,
// carries none. The fixture pair `answered-in.yml` and `answered-in-child.yml`
// holds one gate of each kind.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';

const PARENT = path.join(FIXTURES, 'definitions/answered-in.yml');
const CHILD = path.join(FIXTURES, 'definitions/answered-in-child.yml');
const ANSWER = option => ({ option, answered_by: 'operator', at: '2026-01-05T09:05:00Z' });
const GATES = ['findings-confirmation', 'both-confirmation', 'survey-confirmation', 'scope-confirmation'];

/**
 * The parent frozen, its research child run to its end with `findings` and
 * `scope` the options its two gates were answered with, and the parent's
 * sub-run node adopting the child's exposed values.
 */
function researched(t, { findings = 'approve-findings', scope = 'approve-scope', checked = true } = {}) {
  const run = scratch(t, { type: 'answered-in', name: '2026-01-05-parent' });
  freeze(run, { definition: PARENT });
  write(run, { nodes: { research: { status: 'running' } } });
  const child = sibling(run, { type: 'answered-in-child', name: '2026-01-05-research' });
  freeze(child, {
    definition: CHILD,
    inputs: { subject: 'the store', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: run.path, node: 'research' } },
  });
  write(run, { nodes: { research: { status: 'waiting', values: { task_path: child.path, run_id: child.name } } } });
  write(child, {
    nodes: { survey: { status: 'completed', values: { checked } }, 'findings-approval': { status: 'completed' } },
    node_summaries: { survey: { summary: 'Surveyed the store.' }, 'findings-approval': { decisions: [ANSWER(findings)] } },
  });
  write(child, {
    task: { status: 'completed' },
    nodes: { 'scope-approval': { status: 'completed' }, 'wrap-up': { status: 'skipped' } },
    node_summaries: { 'scope-approval': { decisions: [ANSWER(scope)] } },
  });
  const set = readState(child).workflow.nodes;
  const adopted = { approved: set['findings-approval'].values.approved, scoped: set['scope-approval'].values.scoped, checked };
  write(run, {
    nodes: { research: { status: 'completed', values: { task_path: child.path, run_id: child.name, ...adopted } } },
    node_summaries: { research: { summary: `Sub-run ${child.name} completed.` } },
  });
  return { run, child };
}

function skip(run, ids) {
  return write(run, { nodes: Object.fromEntries(ids.map(id => [id, { status: 'skipped' }])) });
}

const nodesOf = run => readState(run).workflow.nodes;

test('both fixtures validate, with no skip-guard warning on the parent\'s confirmations', () => {
  for (const definition of [PARENT, CHILD]) {
    const result = verb(['validate', `--definition=${definition}`]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(report.warnings.filter(warning => warning.startsWith('skip-guard')), []);
  }
});

test('a gate skipped by a child gate\'s answer records that answer; every other skip records none', t => {
  const { run, child } = researched(t);
  skip(run, GATES);
  const nodes = nodesOf(run);
  assert.deepEqual(nodes['findings-confirmation'].answered_in,
    { run: child.name, node: 'findings-approval', option: 'approve-findings' });
  // Two child gates behind one guard: no single answer skipped it.
  assert.equal(nodes['both-confirmation'].answered_in, undefined);
  // A value the child's survey step recorded: nobody answered it.
  assert.equal(nodes['survey-confirmation'].answered_in, undefined);
  // An input: chosen at the start, not in the child.
  assert.equal(nodes['scope-confirmation'].answered_in, undefined);
  for (const id of GATES) assert.equal(nodes[id].status, 'skipped');
});

test('a gate recorded skipped while its guard reads true names no answer', t => {
  const { run } = researched(t, { findings: 'leave-open' });
  skip(run, ['findings-confirmation']);
  assert.equal(nodesOf(run)['findings-confirmation'].answered_in, undefined);
});

test('the link is the writer\'s own: a patch that sends one has it dropped', t => {
  const { run } = researched(t, { findings: 'leave-open' });
  const sent = { run: 'elsewhere', node: 'findings-approval', option: 'approve-findings' };
  const result = write(run, { nodes: { 'findings-confirmation': { status: 'skipped', answered_in: sent } } });
  assert.match(result.stdout + result.stderr, /workflow\.nodes\.findings-confirmation\.answered_in/);
  assert.equal(nodesOf(run)['findings-confirmation'].answered_in, undefined);
});

test('a child the parent can no longer read leaves the field absent and refuses nothing', t => {
  const { run, child } = researched(t);
  fs.rmSync(child.state);
  const result = skip(run, ['findings-confirmation']);
  assert.equal(result.code, 0);
  assert.equal(nodesOf(run)['findings-confirmation'].answered_in, undefined);
});

test('the recorded link survives later writes, and resume reads the run', t => {
  const { run, child } = researched(t);
  skip(run, GATES);
  const line = () => fs.readFileSync(run.state, 'utf8').split('\n').find(each => each.startsWith('    findings-confirmation:'));
  const recorded = line();
  assert.match(recorded, /answered_in: \{run: /);
  write(run, { nodes: { report: { status: 'running' } } });
  assert.equal(line(), recorded);
  const resumed = verb(['resume-check', `--state=${run.state}`]);
  assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
  assert.equal(nodesOf(run)['findings-confirmation'].answered_in.run, child.name);
});

test('the dashboard says where a skipped gate was answered, and only for that gate', t => {
  const { run, child } = researched(t);
  skip(run, GATES);
  const phases = Object.fromEntries(readDashboard(run).phases.map(phase => [phase.id, phase]));
  assert.deepEqual(phases['findings-confirmation'].answered_in,
    { run: child.name, node: 'findings-approval', option: 'approve-findings', title: 'Research' });
  assert.equal(phases['findings-confirmation'].skip_reason, 'Answered in Research');
  for (const id of ['both-confirmation', 'survey-confirmation', 'scope-confirmation']) {
    assert.equal(Object.hasOwn(phases[id], 'answered_in'), false, id);
    assert.equal(phases[id].skip_reason, null, id);
  }
});

test('a run with no sub-run projects its skipped gates as it always did', t => {
  const run = scratch(t);
  freeze(run, { definition: path.join(FIXTURES, 'definitions/skip-guard.yml') });
  write(run, {
    nodes: { review: { status: 'completed', values: { findings_to_review: true } }, 'review-approval': { status: 'completed' } },
    node_summaries: { review: { summary: 'Reviewed the work.' }, 'review-approval': { decisions: [ANSWER('continue-on')] } },
  });
  write(run, { nodes: { confirmation: { status: 'skipped' } } });
  assert.equal(nodesOf(run).confirmation.answered_in, undefined);
  const phase = readDashboard(run).phases.find(each => each.id === 'confirmation');
  assert.equal(phase.status, 'skipped');
  assert.equal(Object.hasOwn(phase, 'answered_in'), false);
  assert.equal(phase.skip_reason, null);
});
