import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, git, gitScratch, readState, verb } from '../helpers.mjs';

// The freeze records the commit a run starts from, and `review-brief` measures
// one verification cycle from it, once: changed files through a temporary
// index that never touches the user's own, the spec's ids, the plan, the test
// result, the matching standards and, on a re-check, the fix diff.

const FILES = {
  'src/app.mjs': 'export const a = 1;\nexport const b = 2;\n',
  'src/gone.mjs': 'export const gone = true;\n',
  'README.md': '# App\n',
};

/** A git project with a frozen run; `before` runs between the first commit and the freeze. */
function frozen(t, before = () => {}) {
  const run = gitScratch(t, FILES);
  before(run);
  freeze(run);
  return run;
}

function brief(run, flags = [], env = {}) {
  const result = verb(['review-brief', `--state=${run.state}`, ...flags], undefined, env);
  const file = result.stdout.trim();
  const json = result.code === 0 ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return { ...result, file, json };
}

function merge(run) {
  const result = verb(['findings-merge', `--state=${run.state}`]);
  return { ...result, report: result.code === 0 ? JSON.parse(result.stdout) : null };
}

function write(run, file, text) {
  fs.mkdirSync(path.dirname(path.join(run.root, file)), { recursive: true });
  fs.writeFileSync(path.join(run.root, file), text);
}

function verification(run, name, value) {
  fs.mkdirSync(path.join(run.dir, 'verification'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'verification', name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

test('review-brief: a modified, an added, an untracked and a deleted file, measured without touching the user\'s index', t => {
  const run = frozen(t, project => write(project, 'README.md', '# App\n\nedited before the run\n'));
  write(run, 'src/app.mjs', 'export const a = 1;\nexport const b = 3;\nexport const c = 4;\n');
  write(run, 'src/staged.mjs', 'export const staged = 1;\n');
  git(run.root, ['add', 'src/staged.mjs']);
  write(run, 'src/untracked.mjs', 'export const loose = 1;\nexport const more = 2;\n');
  fs.rmSync(path.join(run.root, 'src/gone.mjs'));
  const index = fs.readFileSync(path.join(run.root, '.git/index'));
  const head = git(run.root, ['rev-parse', 'HEAD']);

  const { code, stderr, json, file } = brief(run);
  assert.equal(code, 0, stderr);
  assert.equal(file, path.join(run.dir, 'verification', 'review-brief-1.json'));
  assert.equal(json.cycle, 1);
  assert.equal(json.mode, 'full');
  assert.match(json.snapshot, /^[0-9a-f]{40,64}$/);
  assert.deepEqual(json.changed, [
    { path: 'README.md', status: 'M', added: 2, removed: 0, dirty_at_freeze: true },
    { path: 'src/app.mjs', status: 'M', added: 2, removed: 1 },
    { path: 'src/gone.mjs', status: 'D', added: 0, removed: 1 },
    { path: 'src/staged.mjs', status: 'A', added: 1, removed: 0 },
    { path: 'src/untracked.mjs', status: 'A', added: 2, removed: 0, untracked: true },
  ]);
  assert.equal(json.diffstat, '5 files changed, 7 insertions(+), 2 deletions(-)');
  assert.deepEqual(json.excluded, ['.maister/**']);
  assert.ok(!json.changed.some(entry => entry.path.startsWith('.maister/')), 'the run directory is never part of the change');
  assert.equal(json.diff_path, 'verification/review-diff-1.patch');
  assert.match(fs.readFileSync(path.join(run.dir, json.diff_path), 'utf8'), /\+export const c = 4;/);
  assert.match(json.contract, /implementation-verifier[\\/]references[\\/]review-findings\.md$/);
  assert.ok(fs.existsSync(json.contract), 'the contract the brief names ships with the plugin');

  assert.deepEqual(fs.readFileSync(path.join(run.root, '.git/index')), index, 'the user\'s index is byte for byte as it was');
  assert.equal(git(run.root, ['rev-parse', 'HEAD']), head);
  assert.equal(git(run.root, ['stash', 'list']), '');
  assert.match(git(run.root, ['status', '--porcelain']), /^\?\? src\/untracked\.mjs$/m, 'an untracked file stays untracked');
});

test('review-brief: a re-check carries the fix diff since the previous cycle and the issues with their reviewers', t => {
  const run = frozen(t);
  write(run, 'src/app.mjs', 'export const a = 1;\nexport const b = 3;\n');
  write(run, 'src/other.mjs', 'export const other = 1;\n');
  assert.equal(brief(run).code, 0);
  verification(run, 'code-review-findings.json', {
    reviewer: 'code-review', cycle: 1, mode: 'full',
    findings: [{ id: 'cr-1', severity: 'warning', category: 'correctness', location: { path: 'src/app.mjs', line: 2 }, title: 'b is off by one', evidence: 'app.mjs:2', fixable: true, risky: false }],
  });
  assert.equal(merge(run).code, 0);

  write(run, 'src/app.mjs', 'export const a = 1;\nexport const b = 2;\n');
  const { code, stderr, json } = brief(run, ['--recheck=reviews', '--fixed-issues=1']);
  assert.equal(code, 0, stderr);
  assert.equal(json.cycle, 2);
  assert.equal(json.mode, 'recheck');
  assert.equal(json.fix.from, json.previous_snapshot);
  assert.deepEqual(json.fix.files, ['src/app.mjs']);
  assert.deepEqual(json.fix.hunks, [{ path: 'src/app.mjs', start: 1, end: 2 }]);
  const fixDiff = fs.readFileSync(path.join(run.dir, json.fix.diff_path), 'utf8');
  assert.match(fixDiff, /-export const b = 3;\n\+export const b = 2;/);
  assert.doesNotMatch(fixDiff, /other\.mjs/, 'the fix diff holds only what changed since cycle 1');
  assert.deepEqual(json.recheck, {
    kind: 'reviews',
    issues: [{ id: 1, severity: 'warning', title: 'b is off by one', location: { path: 'src/app.mjs', line: 2 }, sources: ['code-review'] }],
    by_reviewer: { 'code-review': [1] },
  });
  assert.ok(json.changed.some(entry => entry.path === 'src/other.mjs'), 'the whole change is still listed beside the fix');
});

test('review-brief: a cycle never merged is built again under its number; a merged one moves to the next', t => {
  const run = frozen(t);
  assert.equal(brief(run).json.cycle, 1);
  assert.equal(brief(run).json.cycle, 1, 'a restarted cycle keeps its number');
  assert.equal(merge(run).code, 0);
  assert.equal(brief(run).json.cycle, 2);
  assert.equal(brief(run, ['--cycle=7']).json.cycle, 7);
});

test('review-brief: a run with no base refuses without --base and measures from it with one', t => {
  const run = frozen(t);
  const text = fs.readFileSync(run.state, 'utf8');
  fs.writeFileSync(run.state, text.replace(/^ {2}base_commit: .*\n/m, ''));
  assert.equal(readState(run).task.base_commit, undefined);

  const refused = brief(run);
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^review-brief-no-base: .*--base=/);
  assert.ok(!fs.existsSync(path.join(run.dir, 'verification', 'review-brief-1.json')), 'nothing was written');

  write(run, 'src/app.mjs', 'export const a = 9;\nexport const b = 2;\n');
  const based = brief(run, ['--base=HEAD']);
  assert.equal(based.code, 0, based.stderr);
  assert.deepEqual(based.json.changed.map(entry => entry.path), ['src/app.mjs']);

  const bad = brief(run, ['--base=no-such-ref']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /^review-brief-bad-base: /);
});

test('review-brief: standalone, a task directory and a base; --task-path without --base is a usage error', t => {
  const run = gitScratch(t, FILES);
  write(run, 'src/app.mjs', 'changed\n');
  const usage = verb(['review-brief', `--task-path=${run.dir}`]);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /--base/);
  const result = verb(['review-brief', `--task-path=${run.dir}`, '--base=HEAD']);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(fs.readFileSync(result.stdout.trim(), 'utf8'));
  assert.deepEqual(json.changed.map(entry => entry.path), ['src/app.mjs']);
  assert.equal(json.tests.status, 'pending');
});

test('review-brief: the spec\'s ids, the plan\'s groups, the matching standards, and the test result on --refresh', t => {
  const run = frozen(t);
  write(run, '.maister/docs/INDEX.md', [
    '# Documentation Index', '',
    '### Coding Style (`standards/global/coding-style.md`)', 'Read in full before: naming.', '',
    '### Test Writing (`standards/testing/test-writing.md`)', 'Read in full before: new tests.', '',
    '### CSS (`standards/frontend/css.md`)', 'Read in full before: styling.', '',
    '### Database Migrations (`standards/backend/migrations.md`)', 'Read in full before: new migrations.', '',
    '### Billing Rules (`standards/domain/billing.md`)', 'Read in full before: invoices, billing.', '',
  ].join('\n'));
  fs.mkdirSync(path.join(run.dir, 'implementation'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'implementation', 'spec.md'), [
    '# Specification: Sample', '', '## User Stories', '', '### user-story-upload', 'As a user …', '',
    '## Core Requirements', '', '1. Upload a file (user-story-upload)', '2. Retry on failure (user-story-retry)', '   1. nested detail', '3. Report progress', '',
    '## Out of Scope', '', '4. Not a requirement', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.dir, 'implementation', 'implementation-plan.md'), [
    '# Plan', '', '### Task Group 1: Upload', '- [x] 1.0 Group', '- [x] 1.1 Step', '',
    '### Task Group 2: Retry', '- [x] 2.0 Group', '- [ ] 2.1 Step', '',
  ].join('\n'));
  write(run, 'src/billing/invoice.mjs', 'export {};\n');
  write(run, 'test/invoice.test.mjs', 'export {};\n');

  const built = brief(run);
  assert.equal(built.code, 0, built.stderr);
  assert.doesNotMatch(built.stderr, /warning:/);
  assert.deepEqual(built.json.spec, { path: 'implementation/spec.md', requirements: ['1', '2', '3'], stories: ['user-story-upload', 'user-story-retry'] });
  assert.deepEqual(built.json.plan, { path: 'implementation/implementation-plan.md', groups: 2, done: 1 });
  assert.deepEqual(built.json.standards.map(entry => [entry.path, entry.why]), [
    ['.maister/docs/standards/global/coding-style.md', 'applies to every change'],
    ['.maister/docs/standards/testing/test-writing.md', 'tests changed (test/invoice.test.mjs)'],
    ['.maister/docs/standards/domain/billing.md', 'src/billing/invoice.mjs matches "billing"'],
  ]);
  assert.equal(built.json.tests.status, 'pending');

  const missing = brief(run, ['--refresh']);
  assert.equal(missing.code, 0);
  assert.match(missing.stderr, /^warning: review-brief-tests: /m);

  verification(run, 'test-suite-findings.json', {
    reviewer: 'test-suite', cycle: 1, mode: 'full', findings: [],
    tests: { status: 'passed', passed: 12, failed: 0, errors: 0, skipped: 1, command: 'npm test' },
  });
  const snapshotBefore = built.json.snapshot;
  write(run, 'src/after-tests.mjs', 'export {};\n');
  const refreshed = brief(run, ['--refresh']);
  assert.equal(refreshed.code, 0, refreshed.stderr);
  assert.equal(refreshed.json.cycle, 1);
  assert.deepEqual(refreshed.json.tests, {
    status: 'passed', passed: 12, failed: 0, errors: 0, skipped: 1, command: 'npm test',
    results: 'verification/test-suite-results.md', findings: 'verification/test-suite-findings.json',
  });
  assert.equal(refreshed.json.snapshot, snapshotBefore, '--refresh keeps the cycle\'s snapshot');
  assert.ok(!refreshed.json.changed.some(entry => entry.path === 'src/after-tests.mjs'));
});

test('review-brief: a part it cannot fill is one warning line, exit 0', t => {
  const run = frozen(t);
  const { code, stderr, json } = brief(run);
  assert.equal(code, 0);
  assert.match(stderr, /^warning: review-brief-spec: implementation\/spec\.md is not in the run/m);
  assert.match(stderr, /^warning: review-brief-plan: /m);
  assert.match(stderr, /^warning: review-brief-standards: /m);
  assert.deepEqual(json.spec, { path: 'implementation/spec.md', requirements: [], stories: [] });
  assert.equal(json.plan, null);
});

test('review-brief: a snapshot that outruns its budget degrades to a warning, and the brief is written without the diff parts', t => {
  const run = frozen(t);
  write(run, 'src/app.mjs', 'changed\n');
  const started = Date.now();
  const { code, stderr, json } = brief(run, [], { MAISTER_SNAPSHOT_TIMEOUT_MS: '1' });
  assert.equal(code, 0, stderr);
  assert.ok(Date.now() - started < 30_000, 'the verb does not wait on git past its budget');
  assert.match(stderr, /^warning: review-brief-snapshot: git \S+ did not finish within \d+ ms; the brief is written without its diff parts/m);
  assert.equal(json.snapshot, null);
  assert.equal(json.changed, null);
  assert.equal(json.diffstat, null);
  assert.equal(json.diff_path, null);
  assert.equal(json.fix, null);
  assert.deepEqual(json.spec.requirements, [], 'the parts that need no snapshot are still filled');
});

test('review-brief: a snapshot git cannot take degrades the same way, never a refusal', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const run = frozen(t);
  write(run, 'src/locked.mjs', 'secret\n');
  fs.chmodSync(path.join(run.root, 'src/locked.mjs'), 0o000);
  let result;
  try {
    result = brief(run);
  } finally {
    fs.chmodSync(path.join(run.root, 'src/locked.mjs'), 0o644);
  }
  const { code, stderr, json } = result;
  assert.equal(code, 0, stderr);
  assert.match(stderr, /^warning: review-brief-snapshot: git add exited/m);
  assert.equal(json.snapshot, null);
  assert.equal(json.changed, null);
});
