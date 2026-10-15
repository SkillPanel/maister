import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, freezePatch, scratch, sibling, verb, write } from '../helpers.mjs';

const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');

// `subrun-path` is the one source of a sub-run's task directory: the path the
// parent recorded, else the one the naming rule gives. It reads and never writes.

function subrunPath(run, node = 'research') {
  const result = verb(['subrun-path', `--state=${run.state}`, `--node=${node}`]);
  return { ...result, report: JSON.parse(result.stdout) };
}

/** Every file under `dir` with its bytes, for a no-write assertion. */
function snapshot(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    files[path.relative(dir, file)] = fs.readFileSync(file, 'utf8');
  }
  return files;
}

/** Freeze the research child at `child` with a parent link to `parent`'s node. */
function freezeChild(child, link) {
  const { patch } = freezePatch({
    definition: RESEARCH,
    task: { title: 'Open questions' },
    inputs: { question: 'What is open?', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: link },
  });
  return verb(['write-state', `--state=${child.state}`], patch);
}

test('subrun-path: a new child gets the derived directory and its run id, and nothing is written', t => {
  const parent = scratch(t);
  freeze(parent);
  const before = snapshot(parent.root);
  const { code, stderr, report } = subrunPath(parent);
  assert.equal(code, 0, stderr);
  assert.deepEqual(report, {
    ok: true,
    node: 'research',
    workflow: 'research',
    task_path: '.maister/tasks/research/2026-01-05-sample-research',
    run_id: '2026-01-05-sample-research',
    recorded: false,
    existing: 'absent',
  });
  assert.deepEqual(snapshot(parent.root), before, 'the verb wrote nothing');
});

test('subrun-path: a recorded task_path is printed as recorded', t => {
  const parent = scratch(t);
  freeze(parent);
  write(parent, { nodes: { research: { status: 'waiting', values: { task_path: '.maister/tasks/research/2026-01-05-elsewhere', run_id: '2026-01-05-elsewhere' } } } });
  const { code, report } = subrunPath(parent);
  assert.equal(code, 0);
  assert.equal(report.task_path, '.maister/tasks/research/2026-01-05-elsewhere');
  assert.equal(report.run_id, '2026-01-05-elsewhere');
  assert.equal(report.recorded, true);
});

test('subrun-path: the derived directory says whether to create, freeze into or adopt it', t => {
  const parent = scratch(t);
  freeze(parent);
  const child = sibling(parent, { type: 'research', name: '2026-01-05-sample-research' });
  assert.equal(subrunPath(parent).report.existing, 'empty');
  const frozen = freezeChild(child, { run: parent.path, node: 'research' });
  assert.equal(frozen.code, 0, frozen.stderr);
  assert.equal(subrunPath(parent).report.existing, 'adopt');
});

test('subrun-path: a directory holding another run\'s child is refused subrun-child-foreign', t => {
  const parent = scratch(t);
  freeze(parent);
  const child = sibling(parent, { type: 'research', name: '2026-01-05-sample-research' });
  const frozen = freezeChild(child, { run: '.maister/tasks/development/2026-01-05-missing', node: 'research' });
  assert.equal(frozen.code, 0, frozen.stderr);
  const { code, report } = subrunPath(parent);
  assert.equal(code, 1);
  assert.equal(report.code, 'subrun-child-foreign');
});

test('subrun-path: only the slug is normalised, an undated parent takes today, and a long slug is cut at a hyphen', t => {
  const odd = scratch(t, { name: '2026-02-03-Fix_The Login--Flow-' });
  freeze(odd);
  assert.equal(subrunPath(odd).report.task_path, '.maister/tasks/research/2026-02-03-fix-the-login-flow-research');

  const undated = scratch(t, { name: 'loose-notes' });
  freeze(undated);
  assert.match(subrunPath(undated).report.run_id, /^\d{4}-\d\d-\d\d-loose-notes-research$/, 'the date is the day it ran');

  const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join('-');
  const long = scratch(t, { name: `2026-01-05-${words}` });
  freeze(long);
  const { run_id: id } = subrunPath(long).report;
  assert.ok(id.length <= 100, `${id.length} characters`);
  assert.match(id, /^2026-01-05-word0-.*-word\d+-research$/, 'the slug ends on a whole word');
});

test('subrun-path: refuses an unknown node, a node that starts no child, a run that is itself a child, and an unreadable state', t => {
  const parent = scratch(t);
  freeze(parent);
  assert.equal(subrunPath(parent, 'nowhere').report.code, 'subrun-path-unknown-node');
  assert.equal(subrunPath(parent, 'analysis').report.code, 'subrun-path-not-a-subrun');

  const nested = scratch(t, { name: '2026-01-05-nested' });
  freeze(nested, { orchestrator: { driver: { kind: 'terminal' }, parent: { run: '.maister/tasks/development/2026-01-05-missing', node: 'research' } } });
  const recursion = subrunPath(nested);
  assert.equal(recursion.code, 1);
  assert.equal(recursion.report.code, 'subrun-recursion');

  const broken = scratch(t, { name: '2026-01-05-broken' });
  fs.writeFileSync(broken.state, 'task: {title: Hand-written}\n');
  assert.equal(subrunPath(broken).report.code, 'subrun-path-not-a-run');
  const missing = verb(['subrun-path', `--state=${path.join(broken.dir, 'nothing.yml')}`, '--node=research']);
  assert.equal(JSON.parse(missing.stdout).code, 'subrun-path-state-unreadable');
});

test('subrun-path: every refusal it owns has a recovery row in the engine skill', () => {
  const rows = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8').split(/\r?\n/);
  for (const code of ['subrun-path-state-unreadable', 'subrun-path-not-a-run', 'subrun-path-unknown-node', 'subrun-path-definition-unread', 'subrun-path-not-a-subrun']) {
    assert.ok(rows.some(line => line.startsWith(`| \`${code}\` |`)), `SKILL.md has no row for ${code}`);
  }
  assert.ok(rows.some(line => line.startsWith('| `subrun-path` |')), 'SKILL.md has a verb-table row');
});
