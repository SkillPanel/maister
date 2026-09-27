import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { SAMPLE, freeze, readState, scratch, verb, write } from '../helpers.mjs';

/** Send a patch expected to be refused; return the result and assert nothing moved. */
function refused(run, patch) {
  const before = fs.existsSync(run.state) ? fs.readFileSync(run.state, 'utf8') : null;
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 1, `expected a refusal, got exit ${result.code}: ${result.stderr}`);
  assert.equal(result.stdout, '', 'a refused write reports no changed paths');
  const after = fs.existsSync(run.state) ? fs.readFileSync(run.state, 'utf8') : null;
  assert.equal(after, before, 'a refused write leaves the state file byte-for-byte as it was');
  return result;
}

test('freeze: installs the task and the graph in one write, every node pending', t => {
  const run = scratch(t);
  const graph = freeze(run, { inputs: { ticket: 'ALPHA-42' }, task: { key: 'ALPHA-42' } });
  const state = readState(run);

  assert.equal(state.task.title, 'Sample run');
  assert.equal(state.task.key, 'ALPHA-42');
  assert.equal(state.workflow.name, 'development');
  assert.equal(state.workflow.graph_hash, graph.graph_hash, 'the hash is copied through exactly as resolve printed it');
  assert.equal(state.workflow.source, SAMPLE);
  assert.deepEqual(Object.keys(state.workflow.nodes), graph.nodes.map(node => node.id));
  for (const entry of Object.values(state.workflow.nodes)) assert.equal(entry.status, 'pending');
  assert.deepEqual(state.workflow.nodes.research, { kind: 'workflow', status: 'pending' });
  assert.deepEqual(state.orchestrator.options.inputs, { ticket: 'ALPHA-42' });
});

test('freeze: resolve names the tracker-key input the freeze reads task.key from', () => {
  const graph = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  assert.equal(graph.tracker_key, 'ticket');
});

test('freeze: seeds completed_phases and failed_phases as empty lists at the top of the block', t => {
  const run = scratch(t);
  const result = verb(['write-state', `--state=${run.state}`], {
    task: { title: 'Seeded', status: 'in_progress' },
    workflow: { name: 'development', nodes: { analysis: { kind: 'direct' } } },
  });
  assert.equal(result.code, 0, result.stderr);
  const changed = result.stdout.trim().split('\n');
  assert.deepEqual(changed.slice(0, 2), ['orchestrator.completed_phases', 'orchestrator.failed_phases']);
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^orchestrator:\n  completed_phases: \[\]\n  failed_phases: \[\]\n/);
});

test('freeze: a sequence the patch supplies is not re-seeded', t => {
  const run = scratch(t);
  write(run, {
    task: { title: 'Seeded', status: 'in_progress' },
    workflow: { name: 'development', nodes: { analysis: { kind: 'direct' } } },
    orchestrator: { completed_phases: ['intake'] },
  });
  const state = readState(run);
  assert.deepEqual(state.orchestrator.completed_phases, ['intake']);
  assert.deepEqual(state.orchestrator.failed_phases, []);
});

test('nodes: a status change stamps its clock field and leaves every other entry byte-identical', t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  write(run, { nodes: { analysis: { status: 'running' } } });
  let state = readState(run);
  assert.match(state.workflow.nodes.analysis.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(state.workflow.nodes.analysis.completed, undefined);

  write(run, { nodes: { analysis: { status: 'completed' } } });
  state = readState(run);
  assert.equal(state.workflow.nodes.analysis.status, 'completed');
  assert.ok(state.workflow.nodes.analysis.completed >= state.workflow.nodes.analysis.started);

  const untouched = line => line.startsWith('    approval:') || line.startsWith('    research:');
  const after = fs.readFileSync(run.state, 'utf8');
  assert.deepEqual(after.split('\n').filter(untouched), before.split('\n').filter(untouched));
});

test('orchestrator.options merges key by key: a later option write keeps html_output', t => {
  const run = scratch(t);
  freeze(run, { inputs: { ticket: 'ALPHA-1' } });
  write(run, { orchestrator: { options: { html_output: false } } });
  write(run, { orchestrator: { options: { spec_audit_enabled: true } } });
  const options = readState(run).orchestrator.options;
  assert.equal(options.html_output, false);
  assert.equal(options.spec_audit_enabled, true);
  assert.deepEqual(options.inputs, { ticket: 'ALPHA-1' });
});

test('phase_summaries: lands in the workflow\'s own context block and merges entry by entry', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    phase_summaries: { analysis: { node: 'analysis', status: 'completed', summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } },
  });
  write(run, {
    phase_summaries: { implementation: { node: 'implementation', status: 'in_progress', summary: 'Wave 1.' } },
    context: { risk_level: 'low' },
  });
  const state = readState(run);
  assert.deepEqual(Object.keys(state.task_context.phase_summaries), ['analysis', 'implementation']);
  assert.deepEqual(state.task_context.phase_summaries.analysis.decisions, ['keep the parser']);
  assert.equal(state.task_context.risk_level, 'low');
});

test('a context write on a fresh freeze seeds an empty phase_summaries map', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { context: { risk_level: 'low' } });
  assert.deepEqual(readState(run).task_context.phase_summaries, {});
});

test('an adopted prose-written state keeps its unknown blocks, options and comments', t => {
  const run = scratch(t, { fixture: 'adopted' });
  write(run, { nodes: { approval: { status: 'completed' } }, orchestrator: { options: { html_output: false } } });
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^# Written by a prose orchestrator/);
  const state = readState(run);
  assert.deepEqual(state.project_context, { tech_stack: 'node', notes: 'kept through every write' });
  assert.equal(state.orchestrator.started_phase, 'analysis');
  assert.deepEqual(state.orchestrator.completed_phases, ['analysis']);
  assert.deepEqual(state.orchestrator.options, { html_output: false, mockup_format: 'html' });
  assert.equal(state.workflow.nodes.analysis.status, 'completed');
});

test('an empty patch is a sanctioned republish; empty stdin is a usage failure', t => {
  const run = scratch(t);
  freeze(run);
  assert.equal(verb(['write-state', `--state=${run.state}`], {}).code, 0);
  const empty = verb(['write-state', `--state=${run.state}`], '');
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /^usage: the patch on stdin is empty/);
});

test('refusal: phase_summaries nested under context', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { context: { phase_summaries: { analysis: { summary: 'x' } } } });
  assert.match(result.stderr, /^state-patch-invalid\b/);
  assert.match(result.stderr, /top-level phase_summaries/);
});

test('refusal: a patch key outside the closed vocabulary', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { nodez: { analysis: { status: 'running' } } });
  assert.match(result.stderr, /^state-patch-unknown-key\b/);
});

test('refusal: a workflow name no context block derives from', t => {
  const run = scratch(t);
  const result = refused(run, {
    task: { title: 'Unnamed', status: 'in_progress' },
    workflow: { name: 'custom-thing', nodes: { analysis: { kind: 'direct' } } },
    context: { risk_level: 'low' },
  });
  assert.match(result.stderr, /^state-context-block-unknown\b/);
});

test('refusal: a workflow block without a task block', t => {
  const run = scratch(t);
  const result = refused(run, { workflow: { name: 'development', nodes: { analysis: { kind: 'direct' } } } });
  assert.match(result.stderr, /^state-workflow-without-task\b/);
});

test('refusal: a node id the graph grammar would never produce', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { nodes: { __proto__x: { status: 'running' } } });
  assert.match(result.stderr, /^state-patch-invalid\b/);
});

test('refusal: a summary key that would spill onto its own lines', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { phase_summaries: { 'design: draft': { summary: 'x' } } });
  assert.match(result.stderr, /^state-patch-invalid\b/);
});
