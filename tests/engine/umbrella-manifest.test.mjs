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

// A member may name its own workflow for a kind of work, so whatever chooses a
// member's workflow by kind reads the member's choice before the built-in. The
// mapping is judged for shape always, and each name is looked up in the
// member's own `.maister/workflows/` whenever the member is on disk.

/** Declare the member `web` at `repos/web` with the given `workflows:` value. */
function webMember(ws, workflows) {
  const text = fs.readFileSync(ws.manifest, 'utf8');
  fs.writeFileSync(ws.manifest, text.replace('members: {}',
    `members:\n  web:\n    path: repos/web\n    kind: repo\n    workflows: ${workflows}`));
}

/** Put `web` on disk, holding its own workflow `name` when one is given. */
function webCheckout(ws, name = null) {
  const home = path.join(ws.root, 'repos/web/.maister/workflows');
  fs.mkdirSync(home, { recursive: true });
  if (name !== null) {
    fs.writeFileSync(path.join(home, `${name}.yml`),
      `name: ${name}\nversion: 1\nnodes:\n  only:\n    uses: direct:only\n    needs: []\n`);
  }
}

const atWorkflows = (report) => [...report.errors, ...report.warnings].filter((entry) => entry.path.startsWith('members.web.workflows'));

test('validate: a member mapping a kind to a workflow it keeps passes with no finding', (t) => {
  const ws = workspace(t);
  webMember(ws, '{change: frontend-change}');
  webCheckout(ws, 'frontend-change');
  const { code, report } = validate(ws);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(atWorkflows(report), []);
});

test('validate: a workflows value that is not a kind-to-name mapping is refused at its path', (t) => {
  for (const [value, at] of [['frontend-change', 'members.web.workflows'], ['{change: Frontend_Change}', 'members.web.workflows.change']]) {
    const ws = workspace(t);
    webMember(ws, value);
    const { code, report } = validate(ws);
    assert.equal(code, 1, value);
    assert.deepEqual(report.errors.map((entry) => entry.path), [at], value);
  }
});

test('validate: an unknown kind of work is warned about, not refused', (t) => {
  const ws = workspace(t);
  webMember(ws, '{refactor: frontend-change}');
  webCheckout(ws, 'frontend-change');
  const { code, report } = validate(ws);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.warnings.map((entry) => entry.path), ['members.web.workflows.refactor']);
});

test('validate: a named workflow the member on disk does not keep is refused', (t) => {
  for (const name of ['frontend-change', 'development']) {
    const ws = workspace(t);
    webMember(ws, `{change: ${name}}`);
    webCheckout(ws);
    const { code, report } = validate(ws);
    assert.equal(code, 1, name);
    assert.deepEqual(report.errors.map((entry) => entry.path), ['members.web.workflows.change'], name);
    assert.match(report.errors[0].message, new RegExp(name));
  }
});

test('validate: control — a member not yet on disk is judged on shape alone', (t) => {
  const ws = workspace(t);
  webMember(ws, '{change: frontend-change, fix: web-fix}');
  const { code, report } = validate(ws);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(atWorkflows(report), []);
});
