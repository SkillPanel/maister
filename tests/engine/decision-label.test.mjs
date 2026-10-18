import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';

// A gate answer is recorded under the label the person was asked with: a bare
// "Continue" the brief completed with where it leads, a stop under a parent
// scoped to it. The option id is recorded as sent.

const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');

/** A research run at its foundation gate. */
function atFoundation(t, { at = null, inputs = {}, orchestrator = {} } = {}) {
  const child = at ?? scratch(t, { type: 'research', name: '2026-10-18-label' });
  freeze(child, { definition: RESEARCH, inputs: { question: 'Which store keeps notes safe?', ...inputs }, orchestrator });
  write(child, {
    nodes: { 'research-foundation': { status: 'completed', values: { confidence_level: 'high', conclusions: 'store-is-safe' } } },
    node_summaries: { 'research-foundation': { summary: 'The store is safe under load.' } },
  });
  return child;
}

/** The research run past convergence, at its convergence gate. */
function atConvergence(child) {
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { answer: 'continue-to-brainstorming' } } });
  write(child, {
    nodes: { 'solution-generation': { status: 'completed' }, 'solution-convergence': { status: 'completed', values: { selected_approach: 'append-only-log' } } },
    node_summaries: { 'solution-convergence': { summary: 'Converged on an append-only log.' } },
  });
  return child;
}

/** A research child started by a `delivery` parent that has a step after it. */
function underParent(t) {
  const parent = scratch(t, { type: 'development', name: '2026-10-18-parent' });
  const definition = path.join(parent.root, 'parent.yml');
  fs.writeFileSync(definition, [
    'name: delivery',
    'version: 1',
    'display:',
    '  titles:',
    '    ship: "Release notes"',
    'nodes:',
    '  analysis:',
    '    uses: direct:analysis',
    '    needs: []',
    '  research:',
    '    uses: workflow:research',
    '    needs: [analysis]',
    '    with:',
    '      question: "Which store keeps notes safe?"',
    '  ship:',
    '    uses: direct:ship',
    '    needs: [research]',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(parent.root, 'parent.md'), '# Delivery\n\n## `analysis`\n\nAnalyse.\n\n## `ship`\n\nShip.\n');
  freeze(parent, { definition });
  write(parent, { nodes: { analysis: { status: 'completed' }, research: { status: 'running' } } });
  const child = sibling(parent, { type: 'research', name: '2026-10-18-parent-research' });
  atFoundation(t, {
    at: child,
    inputs: { embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'research' } },
  });
  write(parent, { nodes: { research: { status: 'waiting', values: { task_path: child.path, run_id: child.name } } } });
  return child;
}

function answerOf(child, gate) {
  const decisions = readState(child).node_summaries[gate].decisions;
  return decisions.at(-1);
}

test('decision label: a bare "Continue" is recorded as the brief completed it', t => {
  const child = atFoundation(t);
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { decisions: [{ option: 'finish-with-research' }] } } });
  const answer = answerOf(child, 'foundation-approval');
  assert.equal(answer.option, 'finish-with-research');
  assert.equal(answer.decision, 'Continue to final summary', 'was the definition\'s bare "Continue"');
});

test('decision label: a flat answer is recorded under the same completed label', t => {
  const child = atFoundation(t);
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { answer: 'finish-with-research' } } });
  assert.equal(answerOf(child, 'foundation-approval').decision, 'Continue to final summary');
});

test('decision label: under a parent, the completed continue and the scoped stop are recorded as asked', t => {
  const finishing = underParent(t);
  write(finishing, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { decisions: [{ option: 'finish-with-research' }] } } });
  assert.equal(answerOf(finishing, 'foundation-approval').decision, 'Continue to release notes');

  const stopping = atConvergence(underParent(t));
  const stop = JSON.parse(verb(['gate-brief', `--state=${stopping.state}`, '--node=convergence-approval', '--checkpoint']).stdout)
    .options.find(option => option.effect === 'stop');
  write(stopping, { nodes: { 'convergence-approval': { status: 'stopped' } }, node_summaries: { 'convergence-approval': { decisions: [{ option: stop.id }] } } });
  const answer = answerOf(stopping, 'convergence-approval');
  assert.equal(answer.option, stop.id);
  assert.equal(answer.decision, 'Stop delivery here (nothing further runs)');
});

test('decision label: a label the brief does not complete is recorded as before', t => {
  const child = atFoundation(t);
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { decisions: [{ option: 'continue-to-brainstorming' }] } } });
  assert.equal(answerOf(child, 'foundation-approval').decision, 'Continue to brainstorming');

  const standalone = atConvergence(atFoundation(t));
  write(standalone, { nodes: { 'convergence-approval': { status: 'stopped' } }, node_summaries: { 'convergence-approval': { decisions: [{ option: 'stop-research' }] } } });
  assert.equal(answerOf(standalone, 'convergence-approval').decision, 'Stop here');
});

test('decision label: a decision sent with its own text keeps it', t => {
  const child = atFoundation(t);
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { decisions: [{ option: 'finish-with-research', decision: 'Wrap up' }] } } });
  assert.equal(answerOf(child, 'foundation-approval').decision, 'Wrap up');
});

test('decision label: the dashboard shows the earlier answer as it was asked', t => {
  const child = atFoundation(t);
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { decisions: [{ option: 'finish-with-research' }] } } });
  assert.match(JSON.stringify(readDashboard(child)), /"Continue to final summary"/);
  assert.doesNotMatch(JSON.stringify(readDashboard(child)), /"Continue"/);
});

/** A definition with two sibling gates under opposite input guards, joined after. */
function siblingGates(t, inputs) {
  const run = scratch(t, { type: 'development', name: '2026-10-18-siblings' });
  const definition = path.join(run.root, 'siblings.yml');
  fs.writeFileSync(definition, [
    'name: siblings',
    'version: 1',
    'inputs:',
    '  publish: {type: bool, required: false, default: false}',
    'display:',
    '  titles:',
    '    plan: "Planning"',
    '    approve: "Approve the plan"',
    '    approve-publish: "Approve the plan and publish"',
    '    build: "Implementation"',
    'nodes:',
    '  plan:',
    '    uses: direct:plan',
    '    needs: []',
    '  approve:',
    '    type: gate',
    '    needs: [plan]',
    '    when: "!${inputs.publish}"',
    '    ask: "Approve the plan?"',
    '    options:',
    '      continue: continue',
    '      stop-here: stop',
    '  approve-publish:',
    '    type: gate',
    '    needs: [plan]',
    '    when: "${inputs.publish}"',
    '    ask: "Approve the plan and publish?"',
    '    options:',
    '      continue: continue',
    '      stop-here: stop',
    '  build:',
    '    uses: direct:build',
    '    needs: [approve, approve-publish]',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'siblings.md'), '# Siblings\n\n## `plan`\n\nPlan.\n\n## `build`\n\nBuild.\n');
  freeze(run, { definition, inputs });
  write(run, { nodes: { plan: { status: 'completed' } }, node_summaries: { plan: { summary: 'Planned.' } } });
  return run;
}

test('gate walk: a sibling gate whose guard already reads false is never waited on', t => {
  for (const [publish, asked, other] of [[true, 'approve-publish', 'approve'], [false, 'approve', 'approve-publish']]) {
    const run = siblingGates(t, { publish });
    const result = verb(['gate-brief', `--state=${run.state}`, `--node=${asked}`, '--checkpoint']);
    assert.equal(result.code, 0, result.stderr);
    const continuing = JSON.parse(result.stdout).options.find(option => option.effect === 'continue');
    assert.equal(continuing.consequence, 'Runs implementation next.', `${asked}: ${continuing.consequence}`);
    assert.equal(readState(run).workflow.nodes[other].status, 'pending', 'the brief writes nothing');
  }
});
