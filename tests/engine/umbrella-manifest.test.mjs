import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { umbrella } from '../helpers.mjs';

// A workspace manifest once carried a `coordination:` block — a branch, a
// worktree and a retention period — that nothing reads. `init` no longer writes
// it, and a manifest that still has one is read as it always was: no refusal
// and no warning, whatever the block holds, so nothing suggests it matters.

/** A scaffolded workspace; returns its root and manifest path. */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-umbrella-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const init = umbrella(['init', `--root=${root}`]);
  assert.equal(init.code, 0, init.stdout + init.stderr);
  return { root, manifest: path.join(root, '.maister/umbrella.yml') };
}

function validate(ws) {
  const result = umbrella(['validate', `--root=${ws.root}`]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

/** Insert `block` after the manifest's branch convention line. */
function addBlock(ws, block) {
  const text = fs.readFileSync(ws.manifest, 'utf8');
  fs.writeFileSync(ws.manifest, text.replace(/^(branch_convention: .*)$/m, `$1\n${block}`));
}

test('init: the scaffolded manifest carries no coordination block', (t) => {
  const ws = workspace(t);
  const lines = fs.readFileSync(ws.manifest, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter((line) => /coordination/.test(line)).length, 0, lines.join('\n'));
});

test('validate: the scaffolded manifest, with no coordination block, passes with no warning', (t) => {
  const ws = workspace(t);
  const { code, report } = validate(ws);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('validate: a legacy coordination block is accepted with no error and no warning', (t) => {
  const ws = workspace(t);
  addBlock(ws, [
    'coordination:',
    '  branch: maister/coordination',
    '  worktree: .maister/umbrella/.coordination',
    '  retention: {days: 90}',
  ].join('\n'));
  const { code, report } = validate(ws);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('validate: a coordination block of any shape is accepted silently, since nothing reads it', (t) => {
  for (const block of ['coordination: nope', 'coordination:\n  retention: {days: soon}']) {
    const ws = workspace(t);
    addBlock(ws, block);
    const { code, report } = validate(ws);
    assert.equal(code, 0, `${block}: ${JSON.stringify(report.errors)}`);
    assert.deepEqual(report.errors, [], block);
    assert.deepEqual(report.warnings, [], block);
  }
});
