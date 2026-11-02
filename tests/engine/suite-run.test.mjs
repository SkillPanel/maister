import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, delegating, freeze, readDashboard, readState, scratch, verb, write as writeState } from '../helpers.mjs';

// `verification_context.suite_run` records whether a verification cycle's full
// test suite ran: `findings-merge` derives it from the cycle's test result,
// the writer refuses a value no reader knows, the dashboard projects it, and
// the gate after verification recommends no way on when the suite did not run
// or its run is not recorded — nor when the verification node withholds a
// recommendation over work it could not confirm.

const write = (run, patch) => writeState(run, delegating(patch));

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const PERFORMANCE = path.join(ENGINE_DIR, 'workflows/performance.yml');
const MIGRATION = path.join(ENGINE_DIR, 'workflows/migration.yml');

const SUMMARY = {
  status: 'completed',
  summary: 'Verification passed with 2 warnings.',
  decisions: [],
  risks: [],
  artifacts: [{ path: 'verification/implementation-verification.md', label: 'Report', html: null }],
};

function put(run, name, value) {
  const dir = path.join(run.dir, 'verification');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

/** One cycle whose test suite reported `tests` (none when null), merged with --state. */
function mergeWith(t, tests, briefTests = undefined) {
  const run = scratch(t);
  freeze(run);
  put(run, 'review-brief-1.json', { cycle: 1, mode: 'full', fix: null, recheck: null, ...(briefTests === undefined ? {} : { tests: briefTests }) });
  put(run, 'test-suite-findings.json', { reviewer: 'test-suite', cycle: 1, mode: 'full', findings: [], ...(tests === null ? {} : { tests }) });
  const result = verb(['findings-merge', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  return { run, report: JSON.parse(result.stdout) };
}

for (const [status, expected] of [
  ['passed', 'passed'],
  ['passed_with_issues', 'failed'],
  ['failed', 'failed'],
  ['skipped', 'skipped'],
  ['pending', 'not_run'],
]) {
  test(`suite-run: a cycle whose suite reported ${status} records suite_run ${expected}`, t => {
    const { run, report } = mergeWith(t, { status, passed: 10, failed: 0, errors: 0, skipped: 0, command: 'npm test' });
    assert.equal(report.suite_run, expected);
    assert.equal(readState(run).verification_context.suite_run, expected);
  });
}

test('suite-run: a cycle with no test result anywhere records not_run, never a run', t => {
  const { run, report } = mergeWith(t, null);
  assert.equal(report.suite_run, 'not_run');
  assert.equal(readState(run).verification_context.suite_run, 'not_run');
});

test('suite-run: the brief\'s skipped result stands when the suite wrote no tests block', t => {
  const { report } = mergeWith(t, null, { status: 'skipped', reason: 'the full suite passed during implementation' });
  assert.equal(report.suite_run, 'skipped');
});

test('suite-run: the writer refuses a value no reader knows, and takes each known one and null', t => {
  const run = scratch(t);
  freeze(run);
  const refused = verb(['write-state', `--state=${run.state}`], JSON.stringify({ verification_context: { suite_run: 'ran' } }));
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /state-patch-invalid/);
  assert.match(refused.stderr, /suite_run/);
  for (const value of ['passed', 'failed', 'skipped', 'not_run', null]) {
    write(run, { verification_context: { suite_run: value } });
    assert.equal(readState(run).verification_context.suite_run ?? null, value);
  }
});

test('suite-run: the dashboard projects suite_run, null when the run never recorded it', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { verification_context: { last_status: null, issues_found: [] } });
  assert.equal(readDashboard(run).verification.suite_run, null);
  write(run, { verification_context: { suite_run: 'skipped' } });
  assert.equal(readDashboard(run).verification.suite_run, 'skipped');
});

/** A run of `definition` paused at its `verification-approval`, with `context` as its verification_context. */
function atGate(t, { definition = DEVELOPMENT, context, summary = {} } = {}) {
  const run = scratch(t);
  const graph = freeze(run, { definition, inputs: { task_description: 'Fix the parser' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'verification-approval') break;
    nodes[node.id] = { status: 'completed' };
  }
  // The values the gate's later guards read, as each workflow's nodes record them.
  if (nodes['verification-options'] && definition === DEVELOPMENT) nodes['verification-options'].values = { user_docs_enabled: false };
  if (definition === MIGRATION) nodes.verification.values = { issues_to_resolve: false };
  write(run, { nodes, node_summaries: { verification: { ...SUMMARY, ...summary } } });
  if (context !== undefined) write(run, { verification_context: context });
  return run;
}

function picker(run) {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=verification-approval', '--json']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function checkpoint(run) {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=verification-approval', '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function oneline(run) {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=verification-approval', '--oneline']);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

const ran = suite => ({ node: 'verification', attempt: 1, suite_run: suite });

function assertNoneRecommended(run, reason) {
  const { options } = picker(run);
  assert.deepEqual(options.filter(option => option.recommended), [], 'no option is marked');
  assert.match(oneline(run), / · Recommended: none · /);
  const shown = checkpoint(run);
  assert.equal(shown.recommended.option, null);
  assert.match(shown.recommended.reason, reason);
  for (const option of shown.options.filter(each => each.effect === 'continue')) {
    assert.match(option.consequence, /Not recommended: /, `${option.id} says why it is not marked`);
  }
}

test('suite-run: the gate recommends no continue when the suite did not run', t => {
  assertNoneRecommended(atGate(t, { context: ran('not_run') }), /did not run/);
});

test('suite-run: the gate recommends no continue when the run never recorded whether the suite ran', t => {
  assertNoneRecommended(atGate(t, { context: { node: 'verification', attempt: 1, last_status: 'passed' } }), /not recorded/);
  assertNoneRecommended(atGate(t), /not recorded/);
});

test('suite-run: a suite_run of an earlier attempt of the node is not this attempt\'s record', t => {
  const run = atGate(t, { context: { node: 'verification', attempt: 2, suite_run: 'passed' } });
  assertNoneRecommended(run, /not recorded/);
});

for (const suite of ['passed', 'failed', 'skipped']) {
  test(`suite-run: a suite recorded ${suite} keeps the usual recommendation`, t => {
    const { options } = picker(atGate(t, { context: ran(suite) }));
    assert.equal(options.filter(option => option.recommended).length, 1);
    assert.equal(options[0].effect ?? 'continue', 'continue');
  });
}

test('suite-run: a stop risk still recommends the stop over an unchecked suite', t => {
  const run = atGate(t, { context: ran('not_run'), summary: { risks: [{ risk: 'A critical issue is still open', tag: 'stop' }] } });
  const shown = checkpoint(run);
  assert.equal(shown.recommended.option, 'stop-development');
});

test('suite-run: a verification node that withholds a recommendation over unconfirmed done-when lines gets none', t => {
  const run = atGate(t, {
    context: ran('passed'),
    summary: {
      risks: [{ risk: 'Not confirmed: done when the parser accepts empty input', tag: 'open' }],
      recommends: { option: null, reason: 'One done-when line is not confirmed: the parser accepts empty input' },
    },
  });
  assertNoneRecommended(run, /done-when line is not confirmed/);
  assert.ok(checkpoint(run).risks.open.some(each => /Not confirmed: done when/.test(each.risk)), 'the gate names the line');
});

test('suite-run: the writer refuses a null recommendation without its reason', t => {
  const run = atGate(t, { context: ran('passed') });
  const refused = verb(['write-state', `--state=${run.state}`], JSON.stringify({ node_summaries: { verification: { recommends: { option: null } } } }));
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /state-summary-item-invalid/);
});

for (const [name, definition] of [['performance', PERFORMANCE], ['migration', MIGRATION]]) {
  test(`suite-run: ${name}'s verification gate recommends no continue when the suite did not run`, t => {
    assertNoneRecommended(atGate(t, { definition, context: ran('not_run') }), /did not run/);
  });
}
