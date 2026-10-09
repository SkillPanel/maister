import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';
import { walk } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs';

// The gates of the built-in definitions that are shaped by what they must not
// repeat: a gate never re-approves an answer given a moment before, and a gate
// that closes a document the operator may want changed carries a way back to
// it rather than leaving Stop as the only alternative to continuing.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');

/** A fresh run of `name` with every node before `gate` completed. */
function atGate(t, name, gate, inputs) {
  const run = scratch(t, { type: name, name: `2026-10-06-${name}` });
  const graph = freeze(run, { definition: path.join(WORKFLOWS, `${name}.yml`), inputs });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === gate) break;
    nodes[node.id] = { status: 'completed' };
  }
  write(run, { nodes });
  return { run, graph };
}

function revise(run, node, option, note) {
  return verb(['gate-revise', `--state=${run.state}`, `--node=${node}`, `--option=${option}`], { note });
}

test('development: the mockup gate sends the run back to the mockups with the note', t => {
  const { run } = atGate(t, 'development', 'mockup-approval', { task_description: 'Add a settings page' });
  write(run, { nodes: { 'gap-analysis': { values: { mockups_needed: true } } } });
  const result = revise(run, 'mockup-approval', 'revise-mockups', 'Put the save button at the top');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: mockup-approval reruns=ui-mockups revision=1\/10 reset=ui-mockups,mockup-approval$/m);
});

test('development: the passing test has no approval of its own; the checks follow it directly', t => {
  const { graph } = atGate(t, 'development', 'verification-options', { task_description: 'Fix the parser' });
  assert.equal(graph.nodes.some(node => node.id === 'tdd-green-approval'), false);
  assert.deepEqual(graph.nodes.find(node => node.id === 'verification-options').needs, ['tdd-green']);
});

test('performance: the chosen checks are not re-approved; verification follows the choice directly', t => {
  const { graph } = atGate(t, 'performance', 'verification', { task_description: 'Speed up the report' });
  assert.equal(graph.nodes.some(node => node.id === 'verification-options-approval'), false);
  assert.deepEqual(graph.nodes.find(node => node.id === 'verification').needs, ['verification-options']);
});

test('research: the convergence gate sends the run back to the decision areas with the note', t => {
  const { run } = atGate(t, 'research', 'convergence-approval', { question: 'Which store keeps notes safe?' });
  const result = revise(run, 'convergence-approval', 'revise-convergence', 'Reconsider the release split');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: convergence-approval reruns=solution-convergence revision=1\/10 reset=solution-convergence,convergence-approval$/m);
});

// The plan gate comes in two forms and a run asks one: the `publish` input
// picks the form whose continue also grants the push of the run's branch and
// the pull request from it. Without the input the run asks the plain gate,
// exactly as it did before the input existed.

function resolved(name) {
  const result = verb(['resolve', `--definition=${path.join(WORKFLOWS, `${name}.yml`)}`]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

/** The plan gate a run reaches once its plan is written, under `inputs`. */
function planGateOf(inputs) {
  const graph = resolved('development');
  const defaults = Object.fromEntries(Object.entries(graph.inputs ?? {})
    .filter(([, input]) => input && Object.hasOwn(input, 'default'))
    .map(([name, input]) => [name, input.default]));
  const walked = walk({ graph, recorded: {}, gate: 'planning', inputs, defaults });
  assert.equal(walked.ok, true, JSON.stringify(walked));
  return walked;
}

/** A run paused at `gate`, its plan written and summarized. */
function atPlanGate(t, gate, inputs) {
  const { run } = atGate(t, 'development', gate, { task_description: 'Add a settings page', ...inputs });
  write(run, {
    nodes: {
      'gap-analysis': { values: { has_reproducible_defect: false, mockups_needed: false, risk_level: 'low' } },
      'specification-approval': { decisions: [{ option: 'continue-to-planning' }] },
      'spec-audit': { status: 'skipped' },
      'spec-audit-approval': { status: 'skipped' },
    },
    node_summaries: { planning: { status: 'completed', headline: 'Two task groups.', summary: 'Planned.' } },
  });
  return run;
}

function gateForm(run, gate, ...flags) {
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${gate}`, ...flags]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('development: without the publish input the run asks the plain plan gate, which grants nothing', t => {
  for (const inputs of [{ task_description: 'Add a settings page' }, { task_description: 'Add a settings page', publish: false }]) {
    const walked = planGateOf(inputs);
    assert.equal(walked.next, 'planning-approval');
    assert.deepEqual(walked.skipped, []);
  }
  const run = atPlanGate(t, 'planning-approval', {});
  const checkpoint = gateForm(run, 'planning-approval', '--checkpoint');
  assert.deepEqual(checkpoint.grants, {});
  const picker = gateForm(run, 'planning-approval', '--json', '--picker=rich');
  assert.ok(picker.options.every(option => !/pushes the branch/.test(option.label)), JSON.stringify(picker.options));
  const continuing = checkpoint.options.find(option => option.id === 'continue-to-implementation');
  assert.equal(continuing.consequence, 'Runs implementation next.');
  assert.doesNotMatch(JSON.stringify(checkpoint), /Waits on/);
});

test('development: with publish on the run skips the plain plan gate and asks the publishing one', () => {
  const walked = planGateOf({ task_description: 'Add a settings page', publish: true });
  assert.equal(walked.next, 'planning-approval-publish');
  assert.deepEqual(walked.skipped, ['planning-approval']);
});

test('development: the publishing plan gate grants the push and the pull request on its continue only', t => {
  const gate = resolved('development').nodes.find(node => node.id === 'planning-approval-publish');
  assert.equal(gate.when, '${inputs.publish}');
  assert.match(gate.ask, /Continue to implementation, then push the branch and open a pull request\?$/);
  assert.deepEqual(gate.options['continue-to-implementation'], { effect: 'continue', grants: ['push', 'pr-create'] });

  const run = atPlanGate(t, 'planning-approval-publish', { publish: true });
  const checkpoint = gateForm(run, 'planning-approval-publish', '--checkpoint');
  assert.deepEqual(checkpoint.grants, { 'continue-to-implementation': ['push', 'pr-create'] });
  for (const profile of ['rich', 'plain']) {
    const options = gateForm(run, 'planning-approval-publish', '--json', `--picker=${profile}`).options;
    const granting = options.filter(option => /pushes the branch and opens the pull request/.test(option.label));
    assert.deepEqual(granting.map(option => option.id), ['continue-to-implementation'], profile);
  }
  const request = gateForm(run, 'planning-approval-publish', '--request');
  assert.deepEqual(request.context.checkpoint.grants, { 'continue-to-implementation': ['push', 'pr-create'] });
});

test('development: the publishing plan gate sends the run back to the plan with the note', t => {
  const run = atPlanGate(t, 'planning-approval-publish', { publish: true });
  const result = revise(run, 'planning-approval-publish', 'revise-plan', 'Split the store change into its own group');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: planning-approval-publish reruns=planning revision=1\/10 reset=planning,planning-approval,planning-approval-publish$/m);
});

test('development: the two plan gates stand in line, so a stop at either ends the run', () => {
  const graph = resolved('development');
  const needs = id => graph.nodes.find(node => node.id === id).needs;
  assert.deepEqual(needs('planning-approval'), ['planning']);
  assert.deepEqual(needs('planning-approval-publish'), ['planning-approval']);
  assert.deepEqual(needs('implementation'), ['planning-approval-publish']);
  const runs = [
    { publish: false, recorded: { 'planning-approval': { status: 'stopped' } } },
    { publish: true, recorded: { 'planning-approval': { status: 'skipped' }, 'planning-approval-publish': { status: 'stopped' } } },
  ];
  for (const { publish, recorded } of runs) {
    const asked = publish ? 'planning-approval-publish' : 'planning-approval';
    const walked = walk({ graph, recorded, gate: 'planning', inputs: { publish } });
    // The walker simulates `planning` completed; nothing after a stopped
    // gate becomes ready.
    assert.equal(walked.next, null, `${asked} stopped`);
  }
});
