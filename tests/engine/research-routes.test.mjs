import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, write } from '../helpers.mjs';

// Research decides its optional stretches at its gates: the foundation gate
// offers the three ways on, the brainstorming gate decides the design, and the
// design's guard reads whichever of the two decided it. Every route the
// operator can take is walked here, as the gate brief walks it.

const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const FOUNDATION_OPTIONS = ['continue-to-brainstorming', 'continue-to-design', 'finish-with-research', 'revise-research'];
const CONVERGENCE_OPTIONS = ['continue-to-design', 'finish-without-design', 'revise-convergence', 'stop-research'];

/** A research run waiting at the foundation gate, its closing node summarised with `summary`. */
function atFoundation(t, { inputs = {}, summary = {} } = {}) {
  const run = scratch(t, { type: 'research', name: '2026-10-08-research-routes' });
  freeze(run, { definition: RESEARCH, inputs: { question: 'Which store keeps notes safe?', ...inputs } });
  write(run, {
    nodes: { 'research-foundation': { status: 'completed', values: { confidence_level: 'high', conclusions: 'store-is-safe' } } },
    node_summaries: { 'research-foundation': { summary: 'The store is safe under load.', ...summary } },
  });
  return run;
}

/** Record the operator's answer to `gate`; the writer records the values it sets. */
function answer(run, gate, option) {
  write(run, { nodes: { [gate]: { status: 'completed' } }, node_summaries: { [gate]: { answer: option } } });
}

/** The brainstorm stretch run through to its gate, after the foundation gate chose it. */
function atConvergence(t, options = {}) {
  const run = atFoundation(t, options);
  answer(run, 'foundation-approval', 'continue-to-brainstorming');
  write(run, {
    nodes: {
      'solution-generation': { status: 'completed' },
      'solution-convergence': { status: 'completed', values: { selected_approach: 'append-only-log' } },
    },
    node_summaries: { 'solution-convergence': { summary: 'Converged on an append-only log.', ...(options.convergence ?? {}) } },
  });
  return run;
}

function checkpointOf(run, node) {
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function pickerOf(run, node) {
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--json', '--picker=rich']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

/**
 * Where each continue of `node` leads: `{option: [next step, ...skipped steps]}`,
 * the skipped steps the task nodes the walk passes over. A gate with one
 * continue walks it once, as the checkpoint's own `next`.
 */
function routes(run, node) {
  const checkpoint = checkpointOf(run, node);
  const routes = {};
  for (const option of checkpoint.options) {
    if (option.effect !== 'continue') continue;
    const next = option.next ?? checkpoint.next;
    routes[option.id] = [next.end ? 'end' : next.node, ...next.skipped.map(each => each.node)];
  }
  return routes;
}

test('research routes: the foundation gate offers the three ways on and its revise, and no stop', t => {
  const run = atFoundation(t);
  const checkpoint = checkpointOf(run, 'foundation-approval');
  assert.deepEqual(checkpoint.options.map(option => option.id).sort(), [...FOUNDATION_OPTIONS].sort());
  assert.equal(checkpoint.options.some(option => option.effect === 'stop'), false);
  const picker = pickerOf(run, 'foundation-approval');
  assert.deepEqual(picker.options.map(option => [option.id, option.label]), [
    ['continue-to-brainstorming', 'Continue to brainstorming (Recommended)'],
    ['continue-to-design', 'Continue to the design, skip brainstorming'],
    ['finish-with-research', 'Finish with the research'],
    ['revise-research', 'Revise the research'],
  ]);
  assert.equal(picker.details, 'typed', 'four options leave no slot for More details');
});

test('research routes: each foundation continue walks to its own next step', t => {
  assert.deepEqual(routes(atFoundation(t), 'foundation-approval'), {
    'continue-to-brainstorming': ['solution-generation'],
    'continue-to-design': ['high-level-design', 'solution-generation', 'solution-convergence'],
    'finish-with-research': ['completion', 'solution-generation', 'solution-convergence', 'high-level-design'],
  });
});

test('research routes: research only — finishing records both stretches off', t => {
  const run = atFoundation(t);
  answer(run, 'foundation-approval', 'finish-with-research');
  const state = readState(run);
  assert.deepEqual(state.workflow.nodes['foundation-approval'].values, { brainstorming_enabled: false, design_enabled: false });
});

test('research routes: design only — the design runs on the foundation gate\'s answer, the brainstorming gate skipped', t => {
  const run = atFoundation(t);
  answer(run, 'foundation-approval', 'continue-to-design');
  write(run, { nodes: { 'solution-generation': { status: 'skipped' }, 'solution-convergence': { status: 'skipped' }, 'convergence-approval': { status: 'skipped' } } });
  const nodes = readState(run).workflow.nodes;
  assert.deepEqual(nodes['foundation-approval'].values, { brainstorming_enabled: false, design_enabled: true });
  assert.deepEqual(nodes['convergence-approval'].values, { design_enabled: false }, 'a skipped gate reads false');
  write(run, { nodes: { 'high-level-design': { status: 'completed' } }, node_summaries: { 'high-level-design': { summary: 'Two components.' } } });
  assert.deepEqual(routes(run, 'design-approval'), { 'continue-to-completion': ['completion'] });
});

test('research routes: brainstorming, then the brainstorming gate decides the design either way', t => {
  const run = atConvergence(t);
  assert.deepEqual(readState(run).workflow.nodes['foundation-approval'].values, { brainstorming_enabled: true, design_enabled: false });
  assert.deepEqual(routes(run, 'convergence-approval'), {
    'continue-to-design': ['high-level-design'],
    'finish-without-design': ['completion', 'high-level-design'],
  });
});

test('research routes: brainstorming only — finishing without a design records it off', t => {
  const run = atConvergence(t);
  answer(run, 'convergence-approval', 'finish-without-design');
  assert.deepEqual(readState(run).workflow.nodes['convergence-approval'].values, { design_enabled: false });
});

test('research routes: brainstorming then design — the design runs on the brainstorming gate\'s answer', t => {
  const run = atConvergence(t);
  answer(run, 'convergence-approval', 'continue-to-design');
  assert.deepEqual(readState(run).workflow.nodes['convergence-approval'].values, { design_enabled: true });
});

test('research routes: the brainstorming gate offers two continues, its revise and its stop', t => {
  const run = atConvergence(t);
  const picker = pickerOf(run, 'convergence-approval');
  assert.deepEqual(picker.options.map(option => [option.id, option.label]), [
    ['continue-to-design', 'Continue to the design (Recommended)'],
    ['finish-without-design', 'Finish without a design'],
    ['revise-convergence', 'Ask the decision areas again'],
    ['stop-research', 'Stop here'],
  ]);
  assert.deepEqual(picker.options.map(option => option.id).sort(), [...CONVERGENCE_OPTIONS].sort());
  assert.equal(picker.details, 'typed');
});

test('research routes: in an embedded run, finishing with the research ends the run', t => {
  const run = atFoundation(t, { inputs: { embedded: true } });
  const finish = checkpointOf(run, 'foundation-approval').options.find(option => option.id === 'finish-with-research');
  assert.equal(finish.next.end, true);
  assert.equal(finish.consequence, 'Finishes the run.');
});

test('research routes: the closing node names the continue it recommends, with its reason', t => {
  const reason = 'Design asked for, brainstorming declined when the run started';
  const run = atFoundation(t, { summary: { recommends: { option: 'continue-to-design', reason } } });
  const checkpoint = checkpointOf(run, 'foundation-approval');
  assert.deepEqual(checkpoint.recommended, { option: 'continue-to-design', reason });
  assert.equal(pickerOf(run, 'foundation-approval').options[0].id, 'continue-to-design');

  const declined = 'Design declined when the run started';
  const converged = atConvergence(t, { convergence: { recommends: { option: 'finish-without-design', reason: declined } } });
  assert.deepEqual(checkpointOf(converged, 'convergence-approval').recommended, { option: 'finish-without-design', reason: declined });
});

test('research routes: the foundation node cannot recommend a continue of the brainstorming gate', t => {
  const run = atFoundation(t);
  const result = verb(['write-state', `--state=${run.state}`],
    { node_summaries: { 'research-foundation': { recommends: { option: 'finish-without-design', reason: 'No design wanted' } } } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^state-summary-item-invalid: node_summaries\.research-foundation\.recommends/);
});

// A run for its findings only asks the findings gate in the foundation gate's
// place: one continue to the end, its revise and its stop, and no way on to
// brainstorming or the design. The foundation gate is skipped, as the engine
// skips a node whose guard is false.

const FINDINGS_OPTIONS = ['continue-to-completion', 'revise-research', 'stop-research'];

/** A findings-only run waiting at the findings gate, the foundation gate skipped. */
function atFindings(t, inputs = {}) {
  const run = atFoundation(t, { inputs: { findings_only: true, ...inputs } });
  write(run, { nodes: { 'foundation-approval': { status: 'skipped' } } });
  return run;
}

test('research routes: findings only — the findings gate offers one continue, its revise and its stop', t => {
  const run = atFindings(t);
  const checkpoint = checkpointOf(run, 'findings-approval');
  assert.deepEqual(checkpoint.options.map(option => option.id).sort(), [...FINDINGS_OPTIONS].sort());
  assert.equal(checkpoint.options.some(option => /brainstorm|design/.test(option.id)), false);
  assert.deepEqual(pickerOf(run, 'findings-approval').options.map(option => [option.id, option.label]), [
    ['continue-to-completion', 'Continue to final summary (Recommended)'],
    ['revise-research', 'Revise the research'],
    ['stop-research', 'Stop here'],
    ['more-details', 'More details'],
  ]);
});

test('research routes: findings only — the skipped foundation gate reads false and every stretch after it is skipped', t => {
  const run = atFindings(t);
  assert.deepEqual(readState(run).workflow.nodes['foundation-approval'].values, { brainstorming_enabled: false, design_enabled: false });
  assert.deepEqual(routes(run, 'findings-approval'), {
    'continue-to-completion': ['completion', 'solution-generation', 'solution-convergence', 'high-level-design'],
  });
});

test('research routes: findings only, embedded — the findings gate\'s continue ends the run', t => {
  const run = atFindings(t, { embedded: true });
  const checkpoint = checkpointOf(run, 'findings-approval');
  const go = checkpoint.options.find(option => option.id === 'continue-to-completion');
  assert.equal((go.next ?? checkpoint.next).end, true);
});

test('research routes: findings only — a revise at the findings gate re-runs the research foundation', t => {
  const run = atFindings(t);
  const result = verb(['gate-revise', `--state=${run.state}`, '--node=findings-approval', '--option=revise-research'], { note: 'Add the second vendor' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: findings-approval reruns=research-foundation revision=1\/10 reset=research-foundation,foundation-approval,findings-approval$/m);
});

test('research routes: without findings only, the findings gate is skipped behind the foundation gate', t => {
  const run = atFoundation(t);
  answer(run, 'foundation-approval', 'finish-with-research');
  write(run, { nodes: { 'findings-approval': { status: 'skipped' } } });
  assert.equal(readState(run).workflow.nodes['findings-approval'].status, 'skipped');
  assert.deepEqual(routes(atFoundation(t), 'foundation-approval')['continue-to-brainstorming'], ['solution-generation']);
});

test('research decision areas: the brainstorm declares the areas file and the convergence is handed it', () => {
  const result = verb(['resolve', `--definition=${RESEARCH}`]);
  assert.equal(result.code, 0, result.stderr);
  const nodes = Object.fromEntries(JSON.parse(result.stdout).nodes.map(node => [node.id, node]));
  const generation = nodes['solution-generation'];
  assert.equal(generation.with.areas_output_path, 'outputs/decision-areas.json');
  assert.equal(generation.outputs.artifacts.decision_areas, 'outputs/decision-areas.json');
  assert.equal(nodes['solution-convergence'].with.decision_areas, '${solution-generation.artifacts.decision_areas}');
  assert.equal(nodes['solution-convergence'].when, generation.when);
});
