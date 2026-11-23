import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE, freeze, run, scratch, scratchTree, variantRoot } from '../helpers.mjs';

// `scratch-dir` makes the directory a step writes a file into that a session
// or an agent reads back: inside the project, so no host asks before the read,
// and under a folder git ignores. In a run it is the run's own `scratch/`;
// outside one, the project's `.maister/scratch/`.

/** The verb from `cwd`, the project root a session runs it from. */
const scratchDir = (args, cwd, engine = ENGINE) => run(engine, ['scratch-dir', ...args], undefined, {}, cwd);

/** The one path printed, after a clean exit. */
function made(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const lines = result.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, result.stdout);
  return lines[0];
}

/** `child`'s path below `parent`, `/`-separated whatever the platform's separator. */
const below = (parent, child) => path.relative(fs.realpathSync(parent), fs.realpathSync(child)).split(path.sep).join('/');

test('outside a run, a fresh directory under .maister/scratch/, which git ignores', t => {
  const root = scratchTree(t);
  const first = made(scratchDir(['--for=standards-discover'], root));
  const second = made(scratchDir(['--for=standards-discover'], root));
  assert.ok(path.isAbsolute(first), first);
  assert.match(below(root, first), /^\.maister\/scratch\/standards-discover-[A-Za-z0-9]{6}$/);
  assert.notEqual(first, second, 'each call makes its own directory');
  assert.deepEqual(fs.readdirSync(first), [], 'the directory starts empty');
  assert.equal(fs.readFileSync(path.join(root, '.maister/scratch/.gitignore'), 'utf8'), '*\n');
});

test('in a run, a fresh directory under the run\'s own scratch/', t => {
  const runDir = scratch(t);
  freeze(runDir);
  const root = path.resolve(runDir.dir, '..', '..', '..', '..');
  const made1 = made(scratchDir([`--state=${runDir.state}`, '--for=decisions'], root));
  assert.match(below(runDir.dir, made1), /^scratch\/decisions-[A-Za-z0-9]{6}$/);
  assert.equal(fs.readFileSync(path.join(runDir.dir, 'scratch/.gitignore'), 'utf8'), '*\n');
  assert.equal(fs.existsSync(path.join(root, '.maister/scratch')), false, 'nothing under the project\'s scratch folder');
});

test('an existing .gitignore in the scratch folder is kept as it is', t => {
  const root = scratchTree(t, { '.maister/scratch/.gitignore': '# kept\n*\n' });
  made(scratchDir(['--for=quick-design'], root));
  assert.equal(fs.readFileSync(path.join(root, '.maister/scratch/.gitignore'), 'utf8'), '# kept\n*\n');
});

test('a label that is not kebab, or a run that is not there, is refused and nothing is made', t => {
  const root = scratchTree(t);
  for (const label of ['Bad_Label', '../up', 'a/b', '-lead', 'x'.repeat(41)]) {
    const result = scratchDir([`--for=${label}`], root);
    assert.equal(result.code, 1, label);
    assert.equal(result.stdout, '', label);
    assert.match(result.stderr, /^scratch-dir-bad-label: /, label);
  }
  const absent = scratchDir([`--state=${path.join(root, 'nowhere', 'orchestrator-state.yml')}`, '--for=decisions'], root);
  assert.equal(absent.code, 1);
  assert.match(absent.stderr, /^scratch-dir-no-run: /);
  assert.equal(fs.existsSync(path.join(root, '.maister')), false, 'nothing was made');

  const usage = scratchDir([], root);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /scratch-dir needs --for/);
});

test('the Copilot build ships the same verb', t => {
  const root = scratchTree(t);
  const engine = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  assert.match(below(root, made(scratchDir(['--for=update-branch'], root, engine))), /^\.maister\/scratch\/update-branch-[A-Za-z0-9]{6}$/);
});
