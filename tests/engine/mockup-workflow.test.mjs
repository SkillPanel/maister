import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT, freeze, readState, run as runScript, scratch, sibling, verb, write } from '../helpers.mjs';

// The mockup-studio built-in: one node, no gate. Every case goes through engine
// verbs (validate, freeze, node-brief, a completing write, run-complete); no
// test reads the state file by hand to decide an outcome.

const DEFINITION = path.join(ENGINE_DIR, 'workflows/mockup-studio.yml');
const TURN = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/turn.mjs');

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

/** One whole mockup turn on `target` from the project root: begin, the input file, finish with a record. */
function mockupTurn(root, target, record, screens, against = null) {
  const call = (name, args) => {
    const result = runScript(TURN, [name, `--task-path=${target}`, '--subdir=analysis/mockups', ...args], undefined, {}, root);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const started = call('begin', against ? [`--against=${against}`] : []);
  fs.writeFileSync(path.join(started.version_dir, '.turn.json'), JSON.stringify({
    note: 'a note', format: 'html', fidelity: 'sketch', grounding: { digest: null, stale: false }, screens,
  }));
  return call('finish', [`--version=${started.version}`, `--record=${record}`]);
}

test('turn N+1 is a run of its own: a second record folder over the first run\'s versions', t => {
  const first = frozen(t, { note: 'Draw the settings page' });
  const firstRecord = path.join(first.dir, 'turn-result.json');
  const one = mockupTurn(first.root, first.dir, firstRecord, [{ slug: 'settings', title: 'Settings', html: '<p>one</p>' }]);
  assert.equal(one.values.version, 'v001');
  const firstResult = fs.readFileSync(firstRecord, 'utf8');

  const second = sibling(first, { type: 'mockup-studio', name: '2026-01-06-sidebar' });
  freeze(second, { definition: DEFINITION, inputs: { note: 'Add a sidebar', task_path: first.path, against: 'v001' } });
  const inputs = readState(second).orchestrator.options.inputs;
  assert.equal(inputs.task_path, first.path);
  assert.equal(inputs.against, 'v001');
  const brief = verb(['node-brief', `--state=${second.state}`, '--node=turn']);
  assert.equal(brief.code, 0, brief.stderr);
  assert.ok(brief.stdout.includes(`- task_path: ${first.path}`), brief.stdout);
  assert.ok(brief.stdout.includes('- against: v001'), brief.stdout);

  const secondRecord = path.join(second.dir, 'turn-result.json');
  const two = mockupTurn(first.root, first.dir, secondRecord, [{ slug: 'settings', title: 'Settings', html: '<p>two</p>' }], 'v001');
  assert.equal(two.values.version, 'v002');
  assert.equal(two.values.against, 'v001');
  const recorded = JSON.parse(fs.readFileSync(secondRecord, 'utf8'));
  assert.equal(recorded.version, 'v002');
  assert.equal(recorded.against, 'v001');
  assert.equal(fs.readFileSync(firstRecord, 'utf8'), firstResult, 'the first run\'s record is untouched');
  assert.equal(JSON.parse(firstResult).against, null);

  const versions = path.join(first.dir, 'analysis/mockups/versions');
  assert.equal(JSON.parse(fs.readFileSync(path.join(versions, 'index.json'), 'utf8')).latest, 'v002');
  assert.equal(fs.existsSync(path.join(second.dir, 'analysis')), false, 'the second record folder holds no versions');

  write(second, { task: { status: 'completed' }, nodes: { turn: { status: 'completed', values: two.values } } });
  const done = verb(['run-complete', `--state=${second.state}`]);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(done.stdout, 'RUN-COMPLETE\n');
});
