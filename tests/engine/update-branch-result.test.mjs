import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE, ENGINE_DIR, freeze, git, gitScratch, readState, run, verb } from '../helpers.mjs';

const { UPDATE_BRANCH_RESULT, UPDATE_BRANCH_RESULT_FILE } = await import(path.join(ENGINE_DIR, 'scripts/lib/interface-shapes.mjs'));
const { validate } = await import(path.join(ENGINE_DIR, 'scripts/lib/update-branch-result.mjs'));

// `update-branch` ends every call by writing one result a caller reads instead
// of its closing prose. The session sends what only it knows; the verb adds
// what git and the run record, so the file cannot misstate the merge commit,
// the start commit or the checks.

const FILES = { 'src/app.mjs': 'export const a = 1;\n' };

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

/** A run frozen on a feature branch, the default branch moved on and merged in. */
function mergedRun(t, orchestrator = {}) {
  const scratchRun = gitScratch(t, FILES);
  git(scratchRun.root, ['checkout', '-q', '-b', 'feature']);
  freeze(scratchRun, { orchestrator });
  write(scratchRun.root, 'src/feature.mjs', 'export const feature = 1;\n');
  git(scratchRun.root, ['add', 'src/feature.mjs']);
  git(scratchRun.root, ['commit', '-q', '-m', 'the run\'s work']);
  git(scratchRun.root, ['checkout', '-q', 'main']);
  write(scratchRun.root, 'lib/one.mjs', 'export const one = 1;\n');
  git(scratchRun.root, ['add', 'lib']);
  git(scratchRun.root, ['commit', '-q', '-m', 'the default branch moves on']);
  const tip = git(scratchRun.root, ['rev-parse', 'HEAD']).trim();
  git(scratchRun.root, ['checkout', '-q', 'feature']);
  git(scratchRun.root, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
  const merge = git(scratchRun.root, ['rev-parse', 'HEAD']).trim();
  return { run: scratchRun, tip, merge };
}

function result(args, draft, cwd) {
  const out = cwd === undefined ? verb(['update-branch-result', ...args], draft) : run(ENGINE, ['update-branch-result', ...args], draft, {}, cwd);
  return { ...out, json: out.code === 0 ? JSON.parse(out.stdout) : null };
}

function readResult(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function conforms(document) {
  const errors = [];
  validate(document, { type: 'object', keys: UPDATE_BRANCH_RESULT }, 'the result', errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(document), Object.keys(UPDATE_BRANCH_RESULT));
}

test('update-branch-result: a merged run records the merge commit and the start commit move-base moved', t => {
  const { run: scratchRun, tip, merge } = mergedRun(t);
  const before = readState(scratchRun).task.base_commit.sha;
  const moved = verb(['move-base', `--state=${scratchRun.state}`, '--reason=merged main']);
  assert.equal(moved.code, 0, moved.stderr);

  const out = result([`--state=${scratchRun.state}`], {
    outcome: 'merged', merged_ref: 'main', merged_tip: tip.slice(0, 8), base_status: 'moved', checks_reason: 'no checks in this project',
  });
  assert.equal(out.code, 0, out.stderr);
  const file = path.join(scratchRun.dir, UPDATE_BRANCH_RESULT_FILE);
  assert.equal(out.json.file, file);
  const document = readResult(file);
  conforms(document);
  assert.equal(document.outcome, 'merged');
  assert.equal(document.branch, 'feature');
  assert.equal(document.merged_tip, tip);
  assert.equal(document.merge_commit, merge);
  assert.equal(document.driver, 'terminal');
  assert.equal(document.pushed, false);
  assert.deepEqual(document.run, {
    task_path: scratchRun.path, base_status: 'moved', start_commit: { from: before, to: tip }, refusal: null,
  });
  assert.deepEqual(document.checks, { status: 'not-run', reason: 'no checks in this project', tests: null, checks: [] });
});

test('update-branch-result: the driver is read from the run, and conflicts accepted by the skill are kept', t => {
  const { run: scratchRun, tip } = mergedRun(t, { driver: { kind: 'cockpit', cwd: '/work' } });
  const conflicts = [{ path: 'src/app.mjs', kept: 'both changes', why: 'the spec keeps the old export', resolved: true }];
  const resolutions = { decided_by: 'skill', reason: 'every conflict settled by the run\'s spec' };
  const out = result([`--state=${scratchRun.state}`], {
    outcome: 'merged-with-conflicts-resolved', merged_ref: 'main', merged_tip: tip, conflicts, resolutions, checks_reason: 'skipped in the test',
  });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.json.result.driver, 'cockpit');
  assert.deepEqual(out.json.result.conflicts, conflicts);
  assert.deepEqual(out.json.result.resolutions, resolutions);
  assert.equal(out.json.result.run.base_status, 'none');
  assert.equal(out.json.result.run.start_commit, null);
});

test('update-branch-result: --checks copies the runner\'s tests and checks, base failures marked', t => {
  const { run: scratchRun, tip } = mergedRun(t);
  const scratchDir = fs.mkdtempSync(path.join(scratchRun.root, '..', 'checks-'));
  t.after(() => fs.rmSync(scratchDir, { recursive: true, force: true }));
  const findings = path.join(scratchDir, 'test-suite-findings.json');
  fs.writeFileSync(findings, JSON.stringify({
    cycle: 1,
    issues: [],
    tests: { status: 'failed', passed: 40, failed: 2, errors: 0, skipped: 1, command: 'make test', failed_on_base: 2 },
    checks: [
      { name: 'lint', command: 'make lint', status: 'failed', fails_on_base: true },
      { name: 'build', command: 'make build', status: 'passed' },
      { name: '', status: 'passed' },
    ],
  }));
  const out = result([`--state=${scratchRun.state}`, `--checks=${findings}`], { outcome: 'merged', merged_ref: 'main', merged_tip: tip });
  assert.equal(out.code, 0, out.stderr);
  conforms(out.json.result);
  assert.deepEqual(out.json.result.checks, {
    status: 'ran',
    reason: null,
    tests: { status: 'failed', passed: 40, failed: 2, errors: 0, skipped: 1, command: 'make test', failed_on_base: 2 },
    checks: [
      { name: 'lint', command: 'make lint', status: 'failed', fails_on_base: true },
      { name: 'build', command: 'make build', status: 'passed' },
    ],
  });
});

test('update-branch-result: without a run, --result names the file and the project is the working directory', t => {
  const scratchRun = gitScratch(t, FILES);
  const file = path.join(scratchRun.root, 'out', 'result.json');
  const out = result([`--result=${file}`], { outcome: 'refused', reason: 'the index holds staged changes' }, scratchRun.root);
  assert.equal(out.code, 0, out.stderr);
  const document = readResult(file);
  conforms(document);
  assert.equal(document.outcome, 'refused');
  assert.equal(document.run, null);
  assert.equal(document.merge_commit, null);
  assert.equal(document.branch, 'main');
  assert.equal(document.checks.reason, 'the call stopped before merging');
});

test('update-branch-result: a stopped merge keeps its unresolved files and needs no merge commit', t => {
  const { run: scratchRun } = mergedRun(t);
  const out = result([`--state=${scratchRun.state}`], {
    outcome: 'stopped',
    reason: 'src/app.mjs could not be settled from the run\'s evidence',
    merged_ref: 'main',
    conflicts: [{ path: 'src/app.mjs', kept: 'nothing yet', why: 'both sides rename the export', resolved: false }],
    resolutions: null,
  });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.json.result.merge_commit, null);
  assert.equal(out.json.result.conflicts[0].resolved, false);
});

test('update-branch-result: up to date needs HEAD to hold the merged tip', t => {
  const { run: scratchRun, tip } = mergedRun(t);
  const out = result([`--state=${scratchRun.state}`], { outcome: 'up-to-date', merged_ref: 'main', merged_tip: tip });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.json.result.checks.reason, 'nothing was merged');

  write(scratchRun.root, 'later.mjs', 'export const later = 1;\n');
  git(scratchRun.root, ['checkout', '-q', 'main']);
  git(scratchRun.root, ['add', 'later.mjs']);
  git(scratchRun.root, ['commit', '-q', '-m', 'later']);
  const later = git(scratchRun.root, ['rev-parse', 'HEAD']).trim();
  git(scratchRun.root, ['checkout', '-q', 'feature']);
  const behind = result([`--state=${scratchRun.state}`], { outcome: 'up-to-date', merged_ref: 'main', merged_tip: later });
  assert.equal(behind.code, 1);
  assert.match(behind.stderr, /^update-branch-result-not-merged: /);
});

test('update-branch-result: the draft can come from its one file beside the result, deleted once written', t => {
  const { run: scratchRun, tip } = mergedRun(t);
  const draft = path.join(scratchRun.dir, '.update-branch-draft.json');
  fs.writeFileSync(draft, JSON.stringify({ outcome: 'merged', merged_ref: 'main', merged_tip: tip, checks_reason: 'none' }));
  const out = result([`--state=${scratchRun.state}`, `--patch-file=${draft}`]);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(fs.existsSync(draft), false);

  const elsewhere = path.join(scratchRun.root, 'draft.json');
  fs.writeFileSync(elsewhere, '{}');
  const wrong = result([`--state=${scratchRun.state}`, `--patch-file=${elsewhere}`]);
  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /the draft file must be/);
});

test('update-branch-result: a draft that breaks its shape or its rules is refused, nothing written', async t => {
  const { run: scratchRun, tip } = mergedRun(t);
  const file = path.join(scratchRun.dir, UPDATE_BRANCH_RESULT_FILE);
  const cases = [
    [{ outcome: 'merged', merged_ref: 'main', merged_tip: tip, checks_reason: 'x', extra: 1 }, /unknown key extra/],
    [{ outcome: 'done' }, /outcome must be one of/],
    [{ outcome: 'refused' }, /needs a reason/],
    [{ outcome: 'merged', merged_ref: 'main', merged_tip: tip, checks_reason: 'x', conflicts: [{ path: 'a', kept: 'b', why: 'c', resolved: true }] }, /merged-with-conflicts-resolved/],
    [{ outcome: 'merged-with-conflicts-resolved', merged_ref: 'main', merged_tip: tip, checks_reason: 'x', conflicts: [{ path: 'a', kept: 'b', why: 'c', resolved: true }] }, /needs resolutions/],
    [{ outcome: 'merged', merged_ref: 'main', merged_tip: tip }, /needs checks_reason/],
    [{ outcome: 'merged', merged_ref: 'main', merged_tip: tip, checks_reason: 'x', base_status: 'refused' }, /needs base_refusal/],
  ];
  for (const [draft, message] of cases) {
    const out = result([`--state=${scratchRun.state}`], draft);
    assert.equal(out.code, 1, JSON.stringify(draft));
    assert.match(out.stderr, /^update-branch-result-invalid: /);
    assert.match(out.stderr, message);
    assert.equal(fs.existsSync(file), false);
  }
});

test('update-branch-result: claims git or the run contradicts are refused', t => {
  const { run: scratchRun, tip } = mergedRun(t);
  const base = { outcome: 'merged', merged_ref: 'main', checks_reason: 'x' };

  const unknown = result([`--state=${scratchRun.state}`], { ...base, merged_tip: 'f'.repeat(40) });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /^update-branch-result-bad-commit: /);

  const first = git(scratchRun.root, ['rev-parse', 'HEAD^1']).trim();
  const notTheMerge = result([`--state=${scratchRun.state}`], { ...base, merged_tip: first });
  assert.equal(notTheMerge.code, 1);
  assert.match(notTheMerge.stderr, /^update-branch-result-not-merged: /);

  const notMoved = result([`--state=${scratchRun.state}`], { ...base, merged_tip: tip, base_status: 'moved' });
  assert.equal(notMoved.code, 1);
  assert.match(notMoved.stderr, /^update-branch-result-base-not-moved: /);

  const noRun = result([`--result=${path.join(scratchRun.root, 'r.json')}`], { ...base, merged_tip: tip, base_status: 'unchanged' }, scratchRun.root);
  assert.equal(noRun.code, 1);
  assert.match(noRun.stderr, /base_status unchanged needs --state/);

  const unreadable = result([`--state=${scratchRun.state}`, `--checks=${path.join(scratchRun.root, 'missing.json')}`], { outcome: 'merged', merged_ref: 'main', merged_tip: tip });
  assert.equal(unreadable.code, 1);
  assert.match(unreadable.stderr, /^update-branch-result-checks-unreadable: /);
});

test('update-branch-result: a merge still in progress is not reported merged', t => {
  const { run: scratchRun } = mergedRun(t);
  git(scratchRun.root, ['checkout', '-q', 'main']);
  write(scratchRun.root, 'lib/two.mjs', 'export const two = 2;\n');
  git(scratchRun.root, ['add', 'lib']);
  git(scratchRun.root, ['commit', '-q', '-m', 'more']);
  const tip = git(scratchRun.root, ['rev-parse', 'HEAD']).trim();
  git(scratchRun.root, ['checkout', '-q', 'feature']);
  git(scratchRun.root, ['merge', '-q', '--no-ff', '--no-commit', 'main']);
  const out = result([`--state=${scratchRun.state}`], { outcome: 'merged', merged_ref: 'main', merged_tip: tip, checks_reason: 'x' });
  assert.equal(out.code, 1);
  assert.match(out.stderr, /^update-branch-result-not-merged: a merge is still in progress/);
});

test('update-branch-result: the verb needs a run or a file to write', () => {
  const out = verb(['update-branch-result'], { outcome: 'refused', reason: 'x' });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /needs --state .* --result/);
});
