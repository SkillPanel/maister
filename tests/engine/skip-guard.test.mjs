// The skip-guard rule: a gate whose guard reads a value the run itself
// records is asked whatever that guard reads, unless it is a pure
// confirmation — exactly one continue, with no sets and no grants. One
// predicate drives validate, the brief's Next line, revise's skipped-again
// judgement, run-complete and the write-state warning; the fixture
// `skip-guard.yml` trips it end to end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, scratch, verb, write } from '../helpers.mjs';
import { skippedAgain } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs';

const SKIP_GUARD = path.join(FIXTURES, 'definitions/skip-guard.yml');
const BUILTINS = fs.readdirSync(path.join(ENGINE_DIR, 'workflows'))
  .filter(name => name.endsWith('.yml'))
  .map(name => path.join(ENGINE_DIR, 'workflows', name));

const ruleWarnings = report => report.warnings.filter(warning => warning.startsWith('skip-guard-not-pure:'));

/** The fixture with `edit` applied to its text, written beside its prose companion in a scratch directory. */
function edited(t, edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-skip-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const definition = path.join(dir, 'skip-guard.yml');
  fs.writeFileSync(definition, edit(fs.readFileSync(SKIP_GUARD, 'utf8')));
  fs.copyFileSync(SKIP_GUARD.replace(/\.yml$/, '.md'), path.join(dir, 'skip-guard.md'));
  return definition;
}

function validate(definition) {
  const result = verb(['validate', `--definition=${definition}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

/** The fixture frozen, its review completed with `findings_to_review` false, and the first gate answered or not. */
function reviewed(t, { approved = false } = {}) {
  const run = scratch(t);
  const graph = freeze(run, { definition: SKIP_GUARD });
  write(run, {
    nodes: { review: { status: 'completed', values: { findings_to_review: false } } },
    node_summaries: { review: { summary: 'Reviewed the work; nothing to review.' } },
  });
  if (approved) {
    write(run, {
      nodes: { 'review-approval': { status: 'completed' } },
      node_summaries: { 'review-approval': { decisions: [{ decision: 'Continue', option: 'continue-on', by: 'operator' }] } },
    });
  }
  return { run, graph };
}

test('validate warns skip-guard-not-pure on a gate guarded by a task value that is more than a confirmation', () => {
  const report = validate(SKIP_GUARD);
  assert.equal(report.ok, true);
  const warnings = ruleWarnings(report);
  assert.equal(warnings.length, 1, JSON.stringify(report.warnings));
  assert.match(warnings[0], /^skip-guard-not-pure:findings-approval — .+/, 'the code, then its explanatory tail');
  assert.match(warnings[0], /asked whatever/);
});

test('no built-in workflow trips the skip-guard rule', () => {
  for (const definition of BUILTINS) {
    assert.deepEqual(ruleWarnings(validate(definition)), [], path.basename(definition));
  }
});

test('a pure confirmation does not warn, a negated operand is in scope, and a grant makes a confirmation more than one', t => {
  // `confirmation` reads the review's value negated and is one continue, a revise and a stop: no warning.
  assert.ok(!ruleWarnings(validate(SKIP_GUARD)).some(warning => warning.startsWith('skip-guard-not-pure:confirmation')));

  const negated = edited(t, text => text.replace('when: "${review.values.findings_to_review}"', 'when: "!${review.values.findings_to_review}"'));
  assert.deepEqual(ruleWarnings(validate(negated)).map(warning => warning.split(' ')[0]), ['skip-guard-not-pure:findings-approval']);

  const granting = edited(t, text => text.replace('continue-to-design: continue', 'continue-to-design: {effect: continue, grants: [push]}'));
  assert.deepEqual(ruleWarnings(validate(granting)).map(warning => warning.split(' ')[0]),
    ['skip-guard-not-pure:findings-approval', 'skip-guard-not-pure:confirmation']);
});

test('the brief keeps such a gate on the path: its Next line names it although its guard reads false', t => {
  const { run } = reviewed(t);
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=review-approval', '--oneline']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Next: Findings approval/);
  assert.doesNotMatch(result.stdout, /skipped: Findings approval/);
});

test('run-complete owes such a gate while it is pending, and offers it no record-skipped recovery', t => {
  const { run } = reviewed(t, { approved: true });
  write(run, {
    task: { status: 'completed' },
    nodes: {
      confirmation: { status: 'completed' },
      design: { status: 'skipped' },
      finish: { status: 'completed' },
    },
  });
  const result = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
  assert.match(result.stderr, /not finished: findings-approval \(pending; /);
  assert.match(result.stderr, /asked whatever its guard reads/);
  assert.doesNotMatch(result.stderr, /record skipped/);
});

test('write-state records such a gate skipped, exits 0 and warns; a pure confirmation recorded skipped warns nothing', t => {
  const { run } = reviewed(t, { approved: true });
  const asked = verb(['write-state', `--state=${run.state}`], { nodes: { 'findings-approval': { status: 'skipped' } } });
  assert.equal(asked.code, 0, asked.stderr);
  assert.match(asked.stderr, /^warning: skip-guard-skipped:findings-approval — .*asked whatever its guard reads/m);

  const pure = verb(['write-state', `--state=${run.state}`], { nodes: { confirmation: { status: 'skipped' } } });
  assert.equal(pure.code, 0, pure.stderr);
  assert.doesNotMatch(pure.stderr, /skip-guard-skipped/);
});

test('a revise never counts such a gate as skipped again, while it still judges a task node', t => {
  const { graph } = reviewed(t);
  const recorded = {
    review: { kind: 'task', status: 'completed', values: { findings_to_review: false } },
    'review-approval': { kind: 'gate', status: 'completed' },
    'findings-approval': { kind: 'gate', status: 'completed', values: { design_enabled: false } },
    confirmation: { kind: 'gate', status: 'pending' },
    design: { kind: 'task', status: 'pending' },
    finish: { kind: 'task', status: 'pending' },
  };
  const guards = {
    byId: new Map(graph.nodes.map(entry => [entry.id, entry])),
    recorded,
    status: new Map(Object.entries(recorded).map(([id, entry]) => [id, entry.status])),
    inputs: {},
    defaults: {},
  };
  // Neither guard reads a node of the stretch, and each reads false.
  assert.equal(skippedAgain('design', ['design', 'finish'], guards), true, 'a task node behind a false guard is skipped again');
  assert.equal(skippedAgain('findings-approval', ['findings-approval', 'confirmation'], guards), false);
});
