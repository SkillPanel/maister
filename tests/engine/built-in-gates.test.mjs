import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';

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
