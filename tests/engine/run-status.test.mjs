import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, write } from '../helpers.mjs';

// What a run reports about where it is. A step is recorded `running` by the
// brief it reads before it runs, whatever scheme runs it, so the status line
// names the step under way rather than the last one finished. And the phase
// fields under `orchestrator:` are the writer's own, derived from the node
// statuses on every write, so they cannot drift from them.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');

function nodeBrief(run, node) {
  return verb(['node-brief', `--state=${run.state}`, `--node=${node}`]);
}

function devRun(t) {
  const run = scratch(t);
  freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  return run;
}

function statusFile(run) {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(run.state), 'display', 'status.json'), 'utf8'));
}

function phases(run) {
  const { completed_phases, failed_phases, started_phase } = readState(run).orchestrator;
  return { completed_phases, failed_phases, started_phase };
}

test('node-brief records a ready skill step running, and the status line names it while it runs', t => {
  const run = devRun(t);
  write(run, { nodes: { intake: { status: 'completed' } } });
  assert.equal(statusFile(run).phase.title, 'Intake', 'before the brief, the line still names the last step finished');

  const brief = nodeBrief(run, 'codebase-analysis');
  assert.equal(brief.code, 0, brief.stderr);
  assert.match(brief.stdout, /^started: recorded running by this brief/m);
  assert.equal(readState(run).workflow.nodes['codebase-analysis'].status, 'running');
  assert.equal(statusFile(run).phase.title, 'Codebase analysis');
  assert.equal(phases(run).started_phase, 'codebase-analysis');

  const again = nodeBrief(run, 'codebase-analysis');
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /^started:/m, 'a node already running is not started again');
});

test('node-brief records an agent step and a direct step the same way', t => {
  const run = devRun(t);
  const intake = nodeBrief(run, 'intake');
  assert.equal(intake.code, 0, intake.stderr);
  assert.equal(readState(run).workflow.nodes.intake.status, 'running', 'a direct: step');
  assert.equal(readState(run).task.status, 'in_progress');

  write(run, { nodes: { intake: { status: 'completed' }, 'codebase-analysis': { status: 'completed' } } });
  assert.equal(nodeBrief(run, 'gap-analysis').code, 0);
  assert.equal(readState(run).workflow.nodes['gap-analysis'].status, 'running', 'an agent: step');
});

test('node-brief writes nothing for a gate, a step not ready yet, or a step whose guard reads false', t => {
  const run = devRun(t);
  const before = fs.readFileSync(run.state, 'utf8');
  for (const node of ['codebase-analysis', 'gap-approval']) {
    const brief = nodeBrief(run, node);
    assert.equal(brief.code, 0, brief.stderr);
    assert.doesNotMatch(brief.stdout, /^started:/m, node);
  }
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'neither a step waiting on its needs nor a gate is started');

  write(run, {
    nodes: {
      intake: { status: 'completed' },
      'codebase-analysis': { status: 'completed' },
      'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false } },
      'gap-approval': { status: 'completed' },
    },
  });
  const guarded = nodeBrief(run, 'tdd-red');
  assert.equal(guarded.code, 0, guarded.stderr);
  assert.equal(readState(run).workflow.nodes['tdd-red'].status, 'pending', 'a false guard skips the step; the brief does not start it');
});

test('node-brief does not start a step while an earlier node the walk reaches first is still pending', t => {
  const run = devRun(t);
  write(run, {
    nodes: {
      intake: { status: 'completed' },
      'codebase-analysis': { status: 'completed' },
      'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false } },
      'gap-approval': { status: 'completed' },
    },
  });
  // tdd-red reads false and its skip is not recorded yet: specification is not started before it.
  write(run, { nodes: { 'tdd-red-approval': { status: 'skipped' }, 'ui-mockups': { status: 'skipped' }, 'mockup-approval': { status: 'skipped' } } });
  const brief = nodeBrief(run, 'specification');
  assert.equal(brief.code, 0, brief.stderr);
  assert.equal(readState(run).workflow.nodes.specification.status, 'pending');

  write(run, { nodes: { 'tdd-red': { status: 'skipped' } } });
  assert.equal(nodeBrief(run, 'specification').code, 0);
  assert.equal(readState(run).workflow.nodes.specification.status, 'running');
});

test('the phase fields follow the node statuses on every write', t => {
  const run = devRun(t);
  assert.deepEqual(phases(run), { completed_phases: [], failed_phases: [], started_phase: null }, 'the freeze');

  write(run, { nodes: { intake: { status: 'running' } } });
  assert.deepEqual(phases(run), { completed_phases: [], failed_phases: [], started_phase: 'intake' });

  write(run, { nodes: { intake: { status: 'completed' } } });
  assert.deepEqual(phases(run), { completed_phases: ['intake'], failed_phases: [], started_phase: 'intake' },
    'with nothing under way, the step started last');

  write(run, { nodes: { 'codebase-analysis': { status: 'completed' }, 'gap-analysis': { status: 'running' } } });
  assert.deepEqual(phases(run), { completed_phases: ['intake', 'codebase-analysis'], failed_phases: [], started_phase: 'gap-analysis' });

  write(run, { nodes: { 'gap-analysis': { status: 'failed' } } });
  assert.deepEqual(phases(run), { completed_phases: ['intake', 'codebase-analysis'], failed_phases: ['gap-analysis'], started_phase: 'gap-analysis' });
});

test('a gate is no phase: its completion leaves the phase lists alone', t => {
  const run = scratch(t);
  freeze(run);
  const nodes = readState(run).workflow.nodes;
  const gate = Object.keys(nodes).find(id => nodes[id].kind === 'gate');
  write(run, { nodes: Object.fromEntries(Object.keys(nodes).slice(0, Object.keys(nodes).indexOf(gate) + 1).map(id => [id, { status: 'completed' }])) });
  assert.ok(!phases(run).completed_phases.includes(gate));
  assert.ok(phases(run).completed_phases.length > 0);
});

test('a phase field a patch sends is dropped with a note; the derivation wins', t => {
  const run = devRun(t);
  write(run, { nodes: { intake: { status: 'completed' } } });
  const result = write(run, { orchestrator: { completed_phases: ['planning'], started_phase: 'planning', failed_phases: ['x'] } });
  assert.match(result.stderr, /^note: ignored the supplied orchestrator\.completed_phases, orchestrator\.failed_phases, orchestrator\.started_phase/m);
  assert.deepEqual(phases(run), { completed_phases: ['intake'], failed_phases: [], started_phase: 'intake' });
});
