import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, freezePatch, git, gitScratch, readState, scratch, verb } from '../helpers.mjs';

// The freeze records where a run starts, `task.base_commit`: HEAD, and the
// paths already dirty then. It is the writer's own record — a patch value is
// dropped — and a project outside git records none and says nothing about it.

const FILES = {
  'src/app.mjs': 'export const a = 1;\n',
  'README.md': '# App\n',
};

function frozen(t, before = () => {}) {
  const run = gitScratch(t, FILES);
  before(run);
  freeze(run);
  return run;
}

function write(run, file, text) {
  fs.mkdirSync(path.dirname(path.join(run.root, file)), { recursive: true });
  fs.writeFileSync(path.join(run.root, file), text);
}

test('base commit: the freeze records HEAD and the paths already dirty as task.base_commit', t => {
  const run = frozen(t, project => write(project, 'README.md', '# App\n\nedited before the run\n'));
  const head = git(run.root, ['rev-parse', 'HEAD']).trim();
  const { task } = readState(run);
  assert.deepEqual(task.base_commit, { sha: head, dirty: ['README.md'] });
});

test('base commit: a base_commit sent in a patch is dropped with a note, and a project outside git records none, silently', t => {
  const run = gitScratch(t, FILES);
  const { patch } = freezePatch({ task: { base_commit: { sha: 'deadbeef', dirty: [] } } });
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /note: ignored the supplied task\.base_commit/);
  assert.equal(readState(run).task.base_commit.sha, git(run.root, ['rev-parse', 'HEAD']).trim());

  const plain = scratch(t);
  const frozenPlain = verb(['write-state', `--state=${plain.state}`], freezePatch().patch);
  assert.equal(frozenPlain.code, 0, frozenPlain.stderr);
  assert.doesNotMatch(frozenPlain.stderr, /base-commit|base-dirty/);
  assert.equal(readState(plain).task.base_commit, undefined);
});

test('base commit: a later write never adds, changes or removes it', t => {
  const run = frozen(t);
  const recorded = readState(run).task.base_commit;
  write(run, 'src/app.mjs', 'changed after the freeze\n');
  git(run.root, ['commit', '-qam', 'a commit during the run']);
  const result = verb(['write-state', `--state=${run.state}`], { task: { title: 'Renamed' } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(readState(run).task.base_commit, recorded);
});
