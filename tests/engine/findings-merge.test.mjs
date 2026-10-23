import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, gitScratch, scratch, verb } from '../helpers.mjs';

// `findings-merge` folds one cycle's reviewer findings into the run's one
// numbered list: duplicates across reviewers become one finding, ids stay put
// across cycles, silence is never a fix, and a re-check's new findings count
// only inside the fixes. Most briefs here are written by hand; where a fix
// matters they are built by `review-brief` in a git project, because the merge
// works out a fix's hunks from git itself, from the two snapshots its brief
// names.

function project(t) {
  const run = scratch(t);
  freeze(run);
  fs.mkdirSync(path.join(run.dir, 'verification'), { recursive: true });
  return run;
}

/** A git project whose `src/upload.mjs` has 80 lines, frozen, so `review-brief` can measure its fixes. */
function gitProject(t) {
  const run = gitScratch(t, { 'src/upload.mjs': upload() });
  freeze(run);
  fs.mkdirSync(path.join(run.dir, 'verification'), { recursive: true });
  return run;
}

/** `src/upload.mjs`, line n reading `line n`, with the lines in `edited` rewritten. */
function upload(edited = []) {
  return Array.from({ length: 80 }, (_, i) => (edited.includes(i + 1) ? `fixed ${i + 1}` : `line ${i + 1}`)).join('\n') + '\n';
}

function realBrief(run, flags = []) {
  const result = verb(['review-brief', `--state=${run.state}`, ...flags]);
  assert.equal(result.code, 0, result.stderr);
}

function put(run, name, value) {
  fs.writeFileSync(path.join(run.dir, 'verification', name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function merge(run, flags = []) {
  const result = verb(['findings-merge', `--state=${run.state}`, ...flags]);
  return { ...result, report: result.code === 0 ? JSON.parse(result.stdout) : null };
}

function merged(run, cycle = null) {
  return JSON.parse(fs.readFileSync(path.join(run.dir, 'verification', cycle === null ? 'findings.json' : `findings-${cycle}.json`), 'utf8'));
}

const at = (file, line, end) => ({ path: file, line, ...(end === undefined ? {} : { end_line: end }) });

function finding(id, severity, category, location, title, extra = {}) {
  return { id, severity, category, location, title, evidence: `${title} (evidence)`, fixable: true, risky: false, suggestion: `fix ${title}`, ...extra };
}

function full(reviewer, cycle, findings, extra = {}) {
  return { reviewer, cycle, mode: 'full', findings, ...extra };
}

/** Cycle 1: two reviewers on one defect eight lines apart, a third finding apart from it, one more by itself. */
function cycleOne(run, { real = false } = {}) {
  if (real) realBrief(run);
  else put(run, 'review-brief-1.json', { cycle: 1, mode: 'full', fix: null, recheck: null });
  put(run, 'code-risk-findings.json', full('code-risk', 1, [
    finding('cr-1', 'warning', 'correctness', at('src/upload.mjs', 40, 42), 'Upload retries never back off'),
    finding('cr-2', 'info', 'correctness', at('src/upload.mjs', 45), 'Retry count is a magic number'),
  ]));
  put(run, 'spec-findings.json', full('spec', 1, [
    finding('pr-1', 'critical', 'resilience', at('src/upload.mjs', 48), 'No backoff on 503', { fixable: false }),
    finding('pr-2', 'warning', 'resilience', at('src/upload.mjs', 60), 'No timeout on the request'),
  ]));
  put(run, 'simplicity-findings.json', full('simplicity', 1, [
    finding('pg-1', 'info', 'simplicity', at('src/upload.mjs', 41), 'Retry helper is more general than needed'),
  ]));
  return merge(run);
}

test('findings-merge: one defect two reviewers found within ten lines is one finding, with both sources and the higher severity', t => {
  const run = project(t);
  const { code, stderr, report } = cycleOne(run);
  assert.equal(code, 0, stderr);
  const { findings } = merged(run);
  const backoff = findings.find(each => each.title === 'No backoff on 503');
  assert.deepEqual(backoff.sources, [{ reviewer: 'spec', id: 'pr-1' }, { reviewer: 'code-risk', id: 'cr-1' }]);
  assert.equal(backoff.severity, 'critical');
  assert.equal(backoff.severity_disagreement, true);
  assert.equal(backoff.fixable, false, 'fixable only when every reviewer says so');
  assert.deepEqual(backoff.evidence, ['spec: No backoff on 503 (evidence)', 'code-risk: Upload retries never back off (evidence)']);
  assert.ok(findings.some(each => each.title === 'No timeout on the request'), 'twelve lines away is another finding');
  assert.ok(findings.some(each => each.title === 'Retry helper is more general than needed'), 'another category family is another finding');
  assert.ok(findings.some(each => each.title === 'Retry count is a magic number'), 'one reviewer\'s own two findings never fold');
  assert.equal(findings.length, 4);
  assert.deepEqual(findings.map(each => each.id), [1, 2, 3, 4], 'numbered in rank order: critical, warning, info, then by line');
  assert.deepEqual(report.counts, { critical: 1, warning: 1, info: 2, fixed: 0, not_reported: 0, out_of_scope: 0 });
});

test('findings-merge: the issues_found projection has the state contract\'s shape and sources', t => {
  const run = project(t);
  const { report } = cycleOne(run);
  assert.deepEqual(report.issues_found, [
    { id: 1, severity: 'critical', source: 'spec_conformance', description: 'No backoff on 503', fixable: false, risky: false, fixed: false },
    { id: 2, severity: 'warning', source: 'spec_conformance', description: 'No timeout on the request', fixable: true, risky: false, fixed: false },
    { id: 3, severity: 'info', source: 'simplicity', description: 'Retry helper is more general than needed', fixable: true, risky: false, fixed: false },
    { id: 4, severity: 'info', source: 'code_risk', description: 'Retry count is a magic number', fixable: true, risky: false, fixed: false },
  ]);
  assert.equal(report.cycle, 1);
  assert.equal(report.file, path.join(run.dir, 'verification', 'findings.json'));
  assert.deepEqual(merged(run), merged(run, 1), 'findings.json is the latest cycle\'s copy');
});

test('findings-merge: ids stay stable across cycles, and a new finding takes the next number', t => {
  const run = project(t);
  cycleOne(run);
  put(run, 'review-brief-2.json', { cycle: 2, mode: 'full', fix: null, recheck: null });
  put(run, 'spec-findings.json', full('spec', 2, [
    finding('pr-1', 'critical', 'resilience', at('src/upload.mjs', 51), 'Still no backoff on 503'),
    finding('pr-2', 'warning', 'resilience', at('src/upload.mjs', 63), 'No timeout on the request'),
    finding('pr-3', 'warning', 'security', at('src/auth.mjs', 5), 'Token logged in clear'),
  ]));
  const { code, report } = merge(run);
  assert.equal(code, 0);
  const byTitle = Object.fromEntries(merged(run).findings.map(each => [each.title, each]));
  assert.equal(byTitle['Still no backoff on 503'].id, 1, 'three lines further down is the same finding');
  assert.equal(byTitle['No timeout on the request'].id, 2);
  assert.equal(byTitle['Token logged in clear'].id, 5);
  assert.equal(byTitle['Token logged in clear'].first_cycle, 2);
  assert.equal(byTitle['Still no backoff on 503'].first_cycle, 1);
  assert.equal(report.cycle, 2);

  const again = merge(run);
  assert.deepEqual(again.report, report, 'merging a cycle again gives the same result');
});

test('findings-merge: a finding a full review did not report again stays open as not_reported, unless a fix touched it', t => {
  const run = gitProject(t);
  cycleOne(run, { real: true });
  put(run, 'test-suite-findings.json', full('test-suite', 1, [
    finding('ts-1', 'critical', 'tests', at('test/upload.test.mjs', 12), 'upload retries test fails'),
  ], { tests: { status: 'failed', passed: 11, failed: 1 } }));
  merge(run);
  const before = Object.fromEntries(merged(run).findings.map(each => [each.title, each.id]));

  // Cycle 2: every reviewer runs in full and reports nothing; the fix rewrote line 60 of upload.mjs only,
  // a hunk of lines 57-63 with its context, which the merge reads from git.
  fs.writeFileSync(path.join(run.root, 'src/upload.mjs'), upload([60]));
  realBrief(run);
  for (const reviewer of ['code-risk', 'spec', 'simplicity']) put(run, `${reviewer}-findings.json`, full(reviewer, 2, []));
  put(run, 'test-suite-findings.json', full('test-suite', 2, [], { tests: { status: 'passed', passed: 12, failed: 0 } }));
  const { code, stderr, report } = merge(run);
  assert.equal(code, 0);
  assert.doesNotMatch(stderr, /findings-merge-fix-hunks/);
  const byId = Object.fromEntries(merged(run).findings.map(each => [each.id, each]));
  const timeout = byId[before['No timeout on the request']];
  assert.equal(timeout.status, 'resolved', 'the fix diff touched its line');
  assert.equal(timeout.fixed, true);
  const backoff = byId[before['No backoff on 503']];
  assert.equal(backoff.status, 'open', 'silence alone is not a fix');
  assert.equal(backoff.not_reported, true);
  assert.equal(byId[before['upload retries test fails']].status, 'resolved', 'a failing test the suite no longer reports is resolved');
  assert.equal(report.counts.not_reported, 3);
  assert.equal(report.counts.fixed, 2);
  assert.deepEqual(report.issues_found.find(each => each.id === backoff.id), {
    id: backoff.id, severity: 'critical', source: 'spec_conformance', description: 'No backoff on 503', fixable: false, risky: false, fixed: false,
  });
});

test('findings-merge: a re-check of the reviews resolves what its reviewer answered, keeps the unanswered open, and holds new findings to the fix diff', t => {
  const run = gitProject(t);
  cycleOne(run, { real: true });
  // The fix rewrote lines 41-49 of upload.mjs: a hunk of lines 38-52 with its context.
  fs.writeFileSync(path.join(run.root, 'src/upload.mjs'), upload([41, 42, 43, 44, 45, 46, 47, 48, 49]));
  realBrief(run, ['--recheck=reviews', '--fixed-issues=1,2,4']);
  put(run, 'spec-findings.json', {
    reviewer: 'spec', cycle: 2, mode: 'recheck',
    results: [{ id: 1, status: 'resolved', evidence: 'backoff added at upload.mjs:44' }, { id: 2, status: 'residual', evidence: 'timeout still missing' }],
    new: [
      finding('pr-9', 'warning', 'resilience', at('src/upload.mjs', 47), 'Backoff has no ceiling'),
      finding('pr-10', 'critical', 'security', at('src/auth.mjs', 3), 'Unrelated auth worry'),
    ],
  });
  put(run, 'code-risk-findings.json', { reviewer: 'code-risk', cycle: 2, mode: 'recheck', results: [], new: [] });
  const { code, stderr, report } = merge(run);
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(stderr, /findings-merge-fix-hunks/);
  const doc = merged(run);
  const byId = Object.fromEntries(doc.findings.map(each => [each.id, each]));
  assert.equal(byId[1].status, 'resolved');
  assert.equal(byId[1].fixed, true);
  assert.deepEqual(byId[1].history.at(-1), { cycle: 2, reviewer: 'spec', status: 'resolved', evidence: 'backoff added at upload.mjs:44' });
  assert.equal(byId[2].status, 'open');
  assert.equal(byId[4].status, 'open', 'a passing suite does not answer for a reviewer under a re-check of the reviews');
  assert.match(byId[4].note, /code-risk did not answer it/);
  assert.equal(byId[5].title, 'Backoff has no ceiling', 'a new finding inside the fix diff takes the next number');
  assert.equal(doc.out_of_scope.length, 1);
  assert.equal(doc.out_of_scope[0].title, 'Unrelated auth worry');
  assert.equal(doc.out_of_scope[0].reviewer, 'spec');
  assert.equal(report.counts.out_of_scope, 1);
  assert.equal(report.counts.critical, 0, 'an out-of-scope finding is never counted');
  assert.ok(!report.issues_found.some(each => each.description === 'Unrelated auth worry'));
  assert.equal(byId[3].status, 'open', 'a finding nobody re-checked carries forward as it was');
  assert.equal(byId[3].not_reported, undefined);
});

test('findings-merge: where git cannot read the fix, it is matched by its files alone, with one warning', t => {
  const run = project(t);
  cycleOne(run);
  put(run, 'review-brief-2.json', {
    cycle: 2, mode: 'recheck', fix: { from: 'a', to: 'b', files: ['src/upload.mjs'] },
    recheck: { kind: 'reviews', issues: [{ id: 1 }], by_reviewer: { 'spec': [1] } },
  });
  put(run, 'spec-findings.json', {
    reviewer: 'spec', cycle: 2, mode: 'recheck',
    results: [{ id: 1, status: 'resolved', evidence: 'fixed' }],
    new: [
      finding('pr-9', 'warning', 'resilience', at('src/upload.mjs', 200), 'Far from any hunk, in a fixed file'),
      finding('pr-10', 'warning', 'resilience', at('src/auth.mjs', 3), 'In a file the fix never touched'),
    ],
  });
  const { code, stderr } = merge(run);
  assert.equal(code, 0, stderr);
  assert.equal(stderr.match(/^warning: findings-merge-fix-hunks: .*matched by its files alone$/gm)?.length, 1);
  const doc = merged(run);
  assert.ok(doc.findings.some(each => each.title === 'Far from any hunk, in a fixed file'), 'a finding in a fixed file stays in scope');
  assert.deepEqual(doc.out_of_scope.map(each => each.title), ['In a file the fix never touched']);
});

test('findings-merge: a finding outside the change counts only when critical; any other is set aside, never counted', t => {
  const run = project(t);
  put(run, 'review-brief-1.json', { cycle: 1, mode: 'full', fix: null, recheck: null });
  put(run, 'spec-findings.json', full('spec', 1, [
    finding('pr-1', 'critical', 'resilience', at('.github/workflows/ci.yml', 12), 'CI clones shallow, and the new gate test reads history', { outside_change: true }),
    finding('pr-2', 'warning', 'resilience', at('src/legacy.mjs', 30), 'An old retry loop the change calls', { outside_change: true }),
    finding('pr-3', 'warning', 'resilience', at('src/upload.mjs', 5), 'A defect in the change'),
  ]));
  const { code, stderr, report } = merge(run);
  assert.equal(code, 0, stderr);
  const doc = merged(run);
  const ci = doc.findings.find(each => each.title.startsWith('CI clones shallow'));
  assert.equal(ci.outside_change, true, 'a critical outside the change is counted, and keeps its mark');
  assert.equal(doc.findings.find(each => each.title === 'A defect in the change').outside_change, undefined);
  assert.deepEqual(doc.out_of_scope.map(each => [each.title, each.reason]), [['An old retry loop the change calls', 'outside the change']]);
  assert.deepEqual([report.counts.critical, report.counts.warning, report.counts.out_of_scope], [1, 1, 1]);
  assert.ok(!report.issues_found.some(each => each.description === 'An old retry loop the change calls'));
});

/** Cycle 1 measured by `review-brief`, with the test suite's findings carried into it by `--refresh`. */
function suiteCycle(run, suite) {
  realBrief(run);
  put(run, 'test-suite-findings.json', full('test-suite', 1, suite.findings ?? [], { tests: suite.tests, checks: suite.checks }));
  realBrief(run, ['--refresh']);
}

test('findings-merge: a check the base fails the same way is listed, never counted, and leaves the change with no failure of its own', t => {
  const run = gitProject(t);
  fs.writeFileSync(path.join(run.root, 'src/upload.mjs'), upload([12]));
  suiteCycle(run, {
    tests: { status: 'passed_with_issues', passed: 9, failed: 1, errors: 0, skipped: 0, command: 'npm test', failed_on_base: 1 },
    checks: [
      { name: 'typecheck', command: 'npm run typecheck', status: 'failed', fails_on_base: true },
      { name: 'lint', command: 'npm run lint', status: 'passed' },
    ],
    findings: [
      finding('ts-1', 'critical', 'tests', at('src/legacy.mjs', 3), 'typecheck fails with the same errors as the base', { fails_on_base: true }),
      finding('ts-2', 'warning', 'tests', at('test/legacy.test.mjs', 8), 'legacy fixture test fails on the base too', { fails_on_base: true }),
    ],
  });
  const { code, stderr, report } = merge(run);
  assert.equal(code, 0, stderr);
  const doc = merged(run);
  assert.deepEqual(doc.findings, [], 'a failure the base has is not the change\'s finding, at any severity');
  assert.deepEqual(doc.out_of_scope.map(each => [each.id, each.reason]), [['ts-1', 'fails on the base too'], ['ts-2', 'fails on the base too']]);
  assert.deepEqual([report.counts.critical, report.counts.warning, report.counts.out_of_scope], [0, 0, 2]);
  assert.deepEqual(report.failures, { introduced: { checks: [], tests: 0 }, on_base: { checks: ['typecheck'], tests: 1 } });
  assert.deepEqual(doc.failures, report.failures);
});

test('findings-merge: a check that fails only on the change, or whose base nobody checked, is the change\'s failure', t => {
  const run = gitProject(t);
  fs.writeFileSync(path.join(run.root, 'src/upload.mjs'), upload([12]));
  suiteCycle(run, {
    tests: { status: 'failed', passed: 7, failed: 2, errors: 1, skipped: 0, command: 'npm test', failed_on_base: 1 },
    checks: [
      { name: 'format', command: 'npm run format:check', status: 'failed', fails_on_base: false },
      { name: 'typecheck', command: 'npm run typecheck', status: 'failed' },
      { name: 'lint', command: 'npm run lint', status: 'failed', fails_on_base: true },
    ],
    findings: [
      finding('ts-1', 'critical', 'tests', at('src/upload.mjs', 12), 'format check fails on the edited line'),
      finding('ts-2', 'warning', 'tests', at('src/old.mjs', 4), 'lint fails the same way on the base', { fails_on_base: true }),
    ],
  });
  const { code, stderr, report } = merge(run);
  assert.equal(code, 0, stderr);
  const doc = merged(run);
  assert.deepEqual(doc.findings.map(each => [each.title, each.severity]), [['format check fails on the edited line', 'critical']]);
  assert.deepEqual(doc.out_of_scope.map(each => each.id), ['ts-2']);
  assert.deepEqual(report.failures, {
    introduced: { checks: ['format', 'typecheck'], tests: 2 },
    on_base: { checks: ['lint'], tests: 1 },
  }, 'a check with no base status counts as the change\'s; failures and errors beyond the base\'s count are the change\'s');
});

test('findings-merge: a finding that claims the base fails it too but quotes no evidence counts as the change\'s, with a warning', t => {
  const run = project(t);
  put(run, 'review-brief-1.json', { cycle: 1, mode: 'full', fix: null, recheck: null });
  put(run, 'test-suite-findings.json', full('test-suite', 1, [
    finding('ts-1', 'critical', 'tests', at('test/upload.test.mjs', 8), 'upload retry test fails', { fails_on_base: true, evidence: '' }),
    finding('ts-2', 'warning', 'tests', at('src/old.mjs', 4), 'lint fails the same way on the base', { fails_on_base: true, evidence: 'base: src/old.mjs:4 no-unused-vars \'x\' is defined but never used' }),
  ]));
  const { code, stderr, report } = merge(run);
  assert.equal(code, 0, stderr);
  const doc = merged(run);
  assert.deepEqual(doc.findings.map(each => [each.title, each.severity, each.fails_on_base]), [['upload retry test fails', 'critical', undefined]]);
  assert.deepEqual(doc.out_of_scope.map(each => [each.id, each.reason]), [['ts-2', 'fails on the base too']]);
  assert.equal(report.counts.critical, 1);
  assert.match(stderr, /findings-merge-base-evidence: test-suite's "upload retry test fails"/);
});

test('findings-merge: with no test result and no checks there is no failure split', t => {
  const run = project(t);
  put(run, 'review-brief-1.json', { cycle: 1, mode: 'full', fix: null, recheck: null, tests: { status: 'pending' }, checks: null });
  const { report } = merge(run);
  assert.equal(report.failures, null);
});

test('findings-merge: a tests-only re-check resolves the fixed issues on a passing suite, and only then', t => {
  const run = project(t);
  cycleOne(run);
  const brief = { cycle: 2, mode: 'recheck', fix: null, recheck: { kind: 'tests-only', issues: [{ id: 2 }, { id: 4 }], by_reviewer: {} } };
  put(run, 'review-brief-2.json', brief);
  put(run, 'test-suite-findings.json', full('test-suite', 2, [], { tests: { status: 'failed', passed: 10, failed: 2 } }));
  merge(run);
  let byId = Object.fromEntries(merged(run).findings.map(each => [each.id, each]));
  assert.equal(byId[2].status, 'open');
  assert.match(byId[2].note, /did not pass/);

  put(run, 'test-suite-findings.json', full('test-suite', 2, [], { tests: { status: 'passed', passed: 12, failed: 0 } }));
  const { report } = merge(run);
  byId = Object.fromEntries(merged(run).findings.map(each => [each.id, each]));
  assert.equal(byId[2].status, 'resolved');
  assert.equal(byId[4].status, 'resolved');
  assert.equal(byId[1].status, 'open', 'an issue not being re-checked is untouched');
  assert.equal(report.issues_found.find(each => each.id === 2).fixed, true);
});

test('findings-merge: a tests-only re-check whose only failures fail on the base too confirms the fixes', t => {
  const run = project(t);
  cycleOne(run);
  put(run, 'review-brief-2.json', {
    cycle: 2, mode: 'recheck', fix: null, recheck: { kind: 'tests-only', issues: [{ id: 2 }], by_reviewer: {} },
    tests: { status: 'passed_with_issues', passed: 11, failed: 1, errors: 0, failed_on_base: 1 }, checks: [],
  });
  put(run, 'test-suite-findings.json', full('test-suite', 2, [], { tests: { status: 'passed_with_issues', passed: 11, failed: 1, errors: 0, failed_on_base: 1 } }));
  const { report } = merge(run);
  const byId = Object.fromEntries(merged(run).findings.map(each => [each.id, each]));
  assert.equal(byId[2].status, 'resolved');
  assert.match(byId[2].history.at(-1).evidence, /fail on the base too/);
  assert.deepEqual(report.failures, { introduced: { checks: [], tests: 0 }, on_base: { checks: [], tests: 1 } });
});

test('findings-merge: a severity outside the scale is mapped with a warning, a bad file is skipped, the finding-brief list is never read', t => {
  const run = project(t);
  put(run, 'review-brief-1.json', { cycle: 1, mode: 'full' });
  put(run, 'reality-findings.json', full('reality', 1, [finding('ra-1', 'High', 'delivery', null, 'Story retry is not reachable')]));
  put(run, 'completeness-findings.json', '{ not json');
  put(run, 'verification-findings.json', { findings: [{ id: 'x', severity: 'critical', title: 'a decision list', evidence: '', options: [], recommended: null, reason: '' }] });
  const { code, stderr, report } = merge(run);
  assert.equal(code, 0);
  assert.match(stderr, /^warning: findings-merge-severity: reality's "Story retry is not reachable" says "High"; read as warning$/m);
  assert.match(stderr, /^warning: findings-merge-file-invalid: verification\/completeness-findings\.json /m);
  assert.doesNotMatch(stderr, /verification-findings/);
  assert.deepEqual(report.issues_found, [
    { id: 1, severity: 'warning', source: 'reality', description: 'Story retry is not reachable', fixable: true, risky: false, fixed: false },
  ]);
});

test('findings-merge: with no brief and no findings there is nothing to merge, and nothing is written', t => {
  const run = project(t);
  const { code, stdout, stderr } = verb(['findings-merge', `--state=${run.state}`]);
  assert.equal(code, 1);
  assert.match(stdout, /"ok": false/);
  assert.match(stderr, /^findings-merge-no-cycle: /);
  assert.ok(!fs.existsSync(path.join(run.dir, 'verification', 'findings.json')));
});
