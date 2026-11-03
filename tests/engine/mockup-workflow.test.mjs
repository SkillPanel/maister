import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, write } from '../helpers.mjs';

// The mockup-studio built-in: one node, no gate. Every case goes through engine
// verbs (validate, freeze, node-brief, a completing write, run-complete); no
// test reads the state file by hand to decide an outcome.

const DEFINITION = path.join(ENGINE_DIR, 'workflows/mockup-studio.yml');

const VALUES = {
  version: 'v003',
  against: 'v002',
  screens: 'login,settings',
  changed: 'settings',
  degraded: false,
  notes_count: '2',
  format: 'html',
  fidelity: 'sketch',
};

function frozen(t, inputs) {
  const run = scratch(t, { type: 'mockup-studio' });
  freeze(run, { definition: DEFINITION, inputs });
  return run;
}

test('validate: the definition is clean, with no unread-node and no undecidable-value warning', () => {
  const result = verb(['validate', `--definition=${DEFINITION}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  const codes = (report.warnings ?? []).map(warning => `${warning.code ?? ''} ${warning.message ?? ''} ${warning.path ?? ''}`).join('\n');
  assert.doesNotMatch(codes, /node-no-dependents/);
  assert.doesNotMatch(codes, /undecidable-value-type/);
});

test('freeze: a task_path naming another task folder is recorded as given and the turn brief prints it', t => {
  const other = '.maister/tasks/product-design/2026-01-02-other';
  const run = frozen(t, { note: 'Draw the settings page', task_path: other });
  assert.equal(readState(run).orchestrator.options.inputs.task_path, other);
  const brief = verb(['node-brief', `--state=${run.state}`, '--node=turn']);
  assert.equal(brief.code, 0, brief.stderr);
  assert.ok(brief.stdout.includes(`- task_path: ${other}`), brief.stdout);
});

test('run-complete: the eight values and turn-result.json on disk end the run with the marker alone', t => {
  const run = frozen(t, { note: 'Draw the settings page' });
  fs.writeFileSync(path.join(run.dir, 'turn-result.json'), '{}\n');
  write(run, { task: { status: 'completed' }, nodes: { turn: { status: 'completed', values: VALUES } } });
  const result = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('run-complete: a missing turn-result.json is reported missing-artifact', t => {
  const run = frozen(t, { note: 'Draw the settings page' });
  write(run, { task: { status: 'completed' }, nodes: { turn: { status: 'completed', values: VALUES } } });
  const result = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'missing-artifact: turn turn-result.json\nRUN-COMPLETE\n');
});
