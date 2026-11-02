import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { umbrella } from '../helpers.mjs';

// `init` keeps the members out of the workspace's own history: its `.gitignore`
// gains the members root, or each member at the top level, beside the
// worktree rule. Lines already there are kept and never written twice, and the
// framework directory and the manifest are never ignored.

function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-umbrella-ignore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A member directory carrying a git entry, at `rel` under the workspace. */
function member(dir, rel) {
  fs.mkdirSync(path.join(dir, rel, '.git', 'info'), { recursive: true });
}

function init(dir, ...flags) {
  const result = umbrella(['init', `--root=${dir}`, ...flags]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

const ignore = (dir) => fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');

test('init: --members-root repos ignores repos/ beside .worktrees/, once, and a second run changes nothing', (t) => {
  const dir = root(t);
  member(dir, 'repos/alpha');
  member(dir, 'repos/beta');
  const first = init(dir, '--members-root=repos');
  assert.equal(ignore(dir), '.worktrees/\n/.maister/umbrella/\n/.maister/display/\n/.maister/tickets/\nrepos/\n');
  assert.ok(first.created.includes('.gitignore'));
  const second = init(dir, '--members-root=repos', '--force');
  assert.equal(ignore(dir), '.worktrees/\n/.maister/umbrella/\n/.maister/display/\n/.maister/tickets/\nrepos/\n');
  assert.ok(second.preserved.includes('.gitignore'));
  assert.equal(fs.readFileSync(path.join(dir, 'repos/alpha/.git/info/exclude'), 'utf8'), '.worktrees/\n', 'a member gets only the worktree rule');
});

test('init: an existing .gitignore keeps every line and gains only the missing rules', (t) => {
  const dir = root(t);
  member(dir, 'repos/alpha');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\nrepos/\n*.log');
  init(dir, '--members-root=repos');
  assert.equal(ignore(dir), 'node_modules/\nrepos/\n*.log\n.worktrees/\n/.maister/umbrella/\n/.maister/display/\n/.maister/tickets/\n');
});

test('init: members at the top level are each ignored, anchored; the framework directory never is', (t) => {
  const dir = root(t);
  member(dir, 'alpha');
  member(dir, 'beta');
  init(dir);
  const text = ignore(dir);
  assert.equal(text, '.worktrees/\n/.maister/umbrella/\n/.maister/display/\n/.maister/tickets/\n/alpha\n/beta\n');
  assert.doesNotMatch(text, /^\/?\.maister\/?$|umbrella\.yml|\.maister\/(tasks|workflows)/m);
});

test('init: members under the default projects/ root are ignored by that root', (t) => {
  const dir = root(t);
  member(dir, 'projects/alpha');
  member(dir, 'top');
  init(dir);
  assert.equal(ignore(dir), '.worktrees/\n/.maister/umbrella/\n/.maister/display/\n/.maister/tickets/\nprojects/\n/top\n');
});

test('init: the run-written folders are ignored at the root, and git leaves the rest of .maister tracked', (t) => {
  const dir = root(t);
  member(dir, 'repos/alpha');
  init(dir, '--members-root=repos');
  for (const rel of ['.maister/umbrella/ledger/index.yml', '.maister/display/s.json', '.maister/tickets/T-1.yml', '.maister/tasks/development/x/state.yml', '.maister/workflows/chain.yml']) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x\n');
  }
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  const ignored = (rel) => git('check-ignore', '-q', rel).status === 0;
  assert.ok(ignored('.maister/umbrella/ledger/index.yml'));
  assert.ok(ignored('.maister/display/s.json'));
  assert.ok(ignored('.maister/tickets/T-1.yml'));
  assert.ok(!ignored('.maister/tasks/development/x/state.yml'), 'task directories stay the workspace\'s choice');
  assert.ok(!ignored('.maister/workflows/chain.yml'));
  assert.ok(!ignored('.maister/umbrella.yml'), 'the manifest stays tracked');
  const exclude = fs.readFileSync(path.join(dir, 'repos/alpha/.git/info/exclude'), 'utf8');
  assert.equal(exclude, '.worktrees/\n', 'a member gets only the worktree rule');
});
