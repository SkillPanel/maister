import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';

// The external sources check standards discovery runs before it dispatches the
// external scan: is there anything to read — pull requests through a signed-in
// `gh` and a remote, CI configuration, pre-commit hooks? A missing `gh` is a
// state it reports, never an error. Run as a child process from the project
// root, the way the skill runs it.

const CHECK = path.join(ROOT, 'plugins/maister/skills/standards-discover/scripts/external-sources.mjs');
const WINDOWS = process.platform === 'win32';

/** A scratch project holding `files` (path → content), and an empty bin directory; removed when the test ends. */
function project(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-external-sources-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'project dir');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(dir);
  fs.mkdirSync(bin);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return { dir, bin };
}

/** Run the check from the project root with PATH set to `PATH` only. */
function check(where, PATH, args = []) {
  const result = run(CHECK, args, undefined, { PATH, Path: PATH }, where.dir);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no report: asserted by the test
  }
  return { ...result, report };
}

/** A stand-in `gh` on `bin` that exits with `status`, and a `git` that names one remote. */
function fakeTools(bin, status) {
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexit ${status}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\necho origin\n', { mode: 0o755 });
}

test('with no gh, no git and nothing configured there is nothing to scan, and no error', t => {
  const where = project(t);
  const { code, report, stderr } = check(where, where.bin);
  assert.equal(code, 0, stderr);
  assert.equal(report.scan, false);
  assert.equal(report.github, 'not-installed');
  assert.equal(report.remote, false);
  assert.equal(report.pull_requests.readable, false);
  assert.match(report.pull_requests.reason, /gh is not installed/);
  assert.deepEqual(report.ci, []);
  assert.deepEqual(report.hooks, []);
});

test('CI configuration alone is something to scan, with no gh', t => {
  const where = project(t, {
    '.github/workflows/ci.yml': 'on: push\n',
    '.github/workflows/notes.txt': 'not a workflow\n',
    '.gitlab-ci.yml': 'test: {}\n',
  });
  const { code, report } = check(where, where.bin);
  assert.equal(code, 0);
  assert.equal(report.scan, true);
  assert.equal(report.github, 'not-installed');
  assert.deepEqual(report.ci, ['.github/workflows/ci.yml', '.gitlab-ci.yml']);
});

test('pre-commit hooks are something to scan: husky, pre-commit, lint-staged in package.json', t => {
  const where = project(t, {
    '.husky/pre-commit': 'npm test\n',
    '.pre-commit-config.yaml': 'repos: []\n',
    'package.json': JSON.stringify({ name: 'x', 'lint-staged': { '*.js': 'eslint' } }),
  });
  const { report } = check(where, where.bin);
  assert.equal(report.scan, true);
  assert.deepEqual(report.hooks, ['.husky/', '.pre-commit-config.yaml', 'package.json (lint-staged)']);
});

test('a package.json without lint-staged, or one that does not parse, is no hook', t => {
  const where = project(t, { 'package.json': '{ not json' });
  const { code, report } = check(where, where.bin);
  assert.equal(code, 0);
  assert.deepEqual(report.hooks, []);
  assert.equal(report.scan, false);
});

test('a signed-in gh and a remote make pull requests readable', { skip: WINDOWS && 'a stand-in gh is a shell script' }, t => {
  const where = project(t);
  fakeTools(where.bin, 0);
  const { report } = check(where, where.bin);
  assert.equal(report.github, 'available');
  assert.equal(report.remote, true);
  assert.equal(report.pull_requests.readable, true);
  assert.equal(report.scan, true);
});

test('a gh that is not signed in leaves pull requests unread, and no error', { skip: WINDOWS && 'a stand-in gh is a shell script' }, t => {
  const where = project(t);
  fakeTools(where.bin, 1);
  const { code, report } = check(where, where.bin);
  assert.equal(code, 0);
  assert.equal(report.github, 'not-signed-in');
  assert.equal(report.pull_requests.readable, false);
  assert.match(report.pull_requests.reason, /not signed in/);
  assert.equal(report.scan, false);
});

test('--project names the project instead of the current directory', t => {
  const where = project(t, { '.travis.yml': 'language: node_js\n' });
  const elsewhere = project(t);
  const { report } = check(elsewhere, elsewhere.bin, [`--project=${where.dir}`]);
  assert.deepEqual(report.ci, ['.travis.yml']);
});

test('an unknown flag is a usage error', t => {
  const where = project(t);
  const result = check(where, where.bin, ['--nope']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage/);
});
