import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { umbrella } from '../helpers.mjs';

// `runs` lists a workspace's runs with enough of each to tell it from the
// others, leaves set-aside copies out, and reports an unreadable state as an
// entry with an `error` rather than failing the whole listing.

const RUNS = ['.maister', 'umbrella', 'runs'];

const STATES = {
  'r-chain': [
    'orchestrator:',
    '  created: 2026-10-20T09:00:00Z',
    '  updated: 2026-10-20T10:30:00Z',
    '  options: {inputs: {task_description: "Add tags to notes"}}',
    'task:',
    '  title: Tags on notes',
    '  status: in_progress',
    'workflow:',
    '  name: tags-chain',
    '  source: .maister/workflows/generated/tags-chain.yml',
  ].join('\n'),
  'r-research': [
    'orchestrator:',
    '  options: {inputs: {question: "Which store keeps notes safe?"}}',
    'task:',
    '  status: completed',
    'workflow:',
    '  name: research',
  ].join('\n'),
  // A copy kept after the run moved: it looks like a run and is not one.
  'r-chain.moved-1739000000': 'task:\n  status: in_progress\nworkflow:\n  name: tags-chain\n',
  'r-broken': 'task: [unclosed\n',
};

/** A workspace holding every state in `STATES`, plus a run folder with no state yet. */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-runs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [id, text] of Object.entries(STATES)) {
    const dir = path.join(root, ...RUNS, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'orchestrator-state.yml'), `${text}\n`);
  }
  fs.mkdirSync(path.join(root, ...RUNS, 'r-unstarted'), { recursive: true });
  return root;
}

function runs(root) {
  const result = umbrella(['runs', `--root=${root}`]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

test('runs: one array of the workspace\'s runs in id order, set-aside copies and stateless folders left out', (t) => {
  const root = workspace(t);
  const { code, report } = runs(root);
  assert.equal(code, 0);
  assert.ok(Array.isArray(report), 'the report is the array itself');
  assert.deepEqual(report.map((run) => run.id), ['r-broken', 'r-chain', 'r-research']);
});

test('runs: each readable run carries its workflow, title, description, status, times and checkout', (t) => {
  const root = workspace(t);
  const { report } = runs(root);
  const byId = Object.fromEntries(report.map((run) => [run.id, run]));
  assert.deepEqual(byId['r-chain'], {
    id: 'r-chain',
    workflow: 'tags-chain',
    title: 'Tags on notes',
    description: 'Add tags to notes',
    status: 'in_progress',
    created: '2026-10-20T09:00:00Z',
    updated: '2026-10-20T10:30:00Z',
    root: path.resolve(root),
    state: path.posix.join(...RUNS, 'r-chain', 'orchestrator-state.yml'),
  });
  assert.equal(byId['r-research'].description, 'Which store keeps notes safe?', 'a research run is described by its question');
  assert.equal(byId['r-research'].title, null);
  assert.equal(byId['r-research'].created, null);
  assert.equal(byId['r-research'].root, path.resolve(root));
});

test('runs: an unreadable state is listed with an error naming the cause, and the others still list', (t) => {
  const root = workspace(t);
  const { code, report } = runs(root);
  assert.equal(code, 0);
  const broken = report.find((run) => run.id === 'r-broken');
  assert.deepEqual(Object.keys(broken).sort(), ['error', 'id', 'state']);
  assert.match(broken.error, /could not be read: .+/);
  assert.equal(report.filter((run) => run.error === undefined).length, 2);
});

test('runs: a workspace with no runs directory lists none', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-runs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { code, report } = runs(root);
  assert.equal(code, 0);
  assert.deepEqual(report, []);
});

test('runs: a root that is not a directory is refused at exit 1', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-runs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { code, report } = runs(path.join(root, 'missing'));
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'umbrella-root-unusable');
});
